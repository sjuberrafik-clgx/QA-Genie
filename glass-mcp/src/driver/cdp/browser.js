'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER/CDP · BROWSER — minimal browser/page handles over raw CDP
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Ties launch + connection + flattened target-attach into the smallest useful
 * surface: `CdpBrowser.launch()` → `newPage()` → `{ evaluate, navigate, title, url }`.
 * This is the substrate the full CdpDriver + injected in-page agent build on; it
 * proves the transport works end-to-end WITHOUT Playwright driving the browser.
 *
 * Lifecycle events (load / domcontentloaded) come from `Page.*EventFired`, so waits
 * are event-driven (push), not polled.
 *
 * @module glass-mcp/driver/cdp/browser
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { launchChromium } = require('./launch');
const { CdpConnection } = require('./connection');
const { loadProtocolCatalog } = require('./capabilities');

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_NETWORK_IDLE_MS = 500;
const NETWORK_IDLE_IGNORED_TYPES = new Set(['WebSocket', 'EventSource']);
const OOPIF_TARGET_FILTER = [{ type: 'iframe', exclude: false }];

class CdpBrowser {
    constructor(launched, conn, version, protocolCatalog) {
        this._launched = launched;
        this._conn = conn;
        this._version = version;
        this._protocolCatalog = protocolCatalog;
        this._pages = new Map(); // targetId → CdpPage
        this._contexts = new Set(); // non-default browserContextId values
        this._frames = new Map(); // targetId → tracked OOPIF
        this._frameTokens = new Map(); // compact handle token → tracked OOPIF
        this._frameOwners = new Map(); // CDP frameId → owning execution target
        this._frameSequence = 0;
        this._oopifTrackingEnabled = false;
        this._oopifTrackingError = null;
        this._maximizeWindows = false; // headed mode: force-maximize each new window via CDP
        this._bindTargetEvents();
    }

    /**
     * @param {object} [opts] forwarded to launchChromium (headless, viewport, …)
     * @returns {Promise<CdpBrowser>}
     */
    static async launch(opts = {}) {
        const launched = await launchChromium(opts);
        let conn;
        try {
            conn = await CdpConnection.connect(launched.browserWsUrl, opts);
            const [version, protocolCatalog] = await Promise.all([
                conn.send('Browser.getVersion'),
                loadProtocolCatalog(launched.browserWsUrl, { timeout: opts.timeout }).catch(() => null),
            ]);
            const browser = new CdpBrowser(launched, conn, version, protocolCatalog);
            // Headed windows honor --start-maximized, but Chrome-for-Testing can ignore it;
            // force-maximize via CDP per new window (skipped for headless / explicit viewport).
            browser._maximizeWindows = opts.headless === false && opts.viewport == null;
            await browser._initTargetTracking();
            return browser;
        } catch (error) {
            if (conn) await conn.close().catch(() => {});
            launched.close();
            throw error;
        }
    }

    get connection() { return this._conn; }
    get browserWsUrl() { return this._launched.browserWsUrl; }
    get version() { return this._version; }
    get protocolCatalog() { return this._protocolCatalog; }
    send(method, params) { return this._conn.send(method, params); }

    _bindTargetEvents() {
        this._conn.on('Target.attachedToTarget', (params) => {
            this._adoptTarget(params).catch(() => {});
        });
        this._conn.on('Target.targetInfoChanged', (targetInfo) => {
            const info = targetInfo && targetInfo.targetInfo;
            const tracked = info && this._frames.get(info.targetId);
            if (tracked) {
                tracked.targetInfo = info;
                tracked.parentFrameId = info.parentFrameId || tracked.parentFrameId;
            }
        });
        this._conn.on('Target.detachedFromTarget', (params) => this._dropTarget(params && params.targetId, params && params.sessionId));
        this._conn.on('Target.targetDestroyed', (params) => {
            this._dropPage(params && params.targetId);
            this._dropTarget(params && params.targetId);
        });
    }

    async _initTargetTracking() {
        try {
            await this._conn.send('Target.setDiscoverTargets', { discover: true, filter: OOPIF_TARGET_FILTER });
            await this._conn.send('Target.setAutoAttach', {
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true,
                filter: OOPIF_TARGET_FILTER,
            });
            this._oopifTrackingEnabled = true;
        } catch (error) {
            this._oopifTrackingError = error;
            this._oopifTrackingEnabled = false;
            await this._conn.send('Target.setDiscoverTargets', { discover: false }).catch(() => {});
        }
    }

    async _enableRelatedTargetTracking(page) {
        if (!this._oopifTrackingEnabled) return;
        try {
            await page.send('Target.setAutoAttach', {
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true,
                filter: OOPIF_TARGET_FILTER,
            });
        } catch (error) {
            this._oopifTrackingError = error;
            this._oopifTrackingEnabled = false;
        }
    }

    async _adoptTarget(params) {
        const info = params && params.targetInfo;
        if (!info || info.type !== 'iframe' || !params.sessionId) return;
        const prior = this._frames.get(info.targetId);
        if (prior && prior.sessionId === params.sessionId) return prior.readyPromise;
        if (prior) this._dropTarget(info.targetId);

        const tracked = {
            targetId: info.targetId,
            target: 'f' + (++this._frameSequence).toString(36),
            sessionId: params.sessionId,
            parentFrameId: info.parentFrameId || null,
            targetInfo: info,
            page: null,
            ready: false,
            error: null,
        };
        const page = new CdpPage(this._conn, info.targetId, params.sessionId, {
            kind: 'iframe',
            onFrameSeen: (frameId) => this._assignFrameOwner(frameId, page),
            onFrameDetached: (frameId) => {
                if (this._frameOwners.get(frameId) === page) this._frameOwners.delete(frameId);
            },
        });
        tracked.page = page;
        this._frames.set(info.targetId, tracked);
        this._frameTokens.set(tracked.target, tracked);
        tracked.readyPromise = Promise.all([page._init(), this._enableRelatedTargetTracking(page)]).then(() => {
            tracked.ready = true;
            return tracked;
        }).catch((error) => {
            tracked.error = error;
            return tracked;
        });
        return tracked.readyPromise;
    }

    _dropTarget(targetId, sessionId) {
        let tracked = targetId && this._frames.get(targetId);
        if (!tracked && sessionId) tracked = [...this._frames.values()].find((candidate) => candidate.sessionId === sessionId);
        if (!tracked) return;
        this._frames.delete(tracked.targetId);
        this._frameTokens.delete(tracked.target);
        tracked.ready = false;
        tracked.page._dispose();
        for (const [frameId, owner] of this._frameOwners) {
            if (owner === tracked.page) this._frameOwners.delete(frameId);
        }
    }

    _dropPage(targetId) {
        const page = targetId && this._pages.get(targetId);
        if (!page) return;
        this._pages.delete(targetId);
        page._dispose();
    }

    _assignFrameOwner(frameId, page) {
        if (!frameId) return;
        const current = this._frameOwners.get(frameId);
        if (!current || current.kind !== 'iframe' || page.kind === 'iframe') {
            this._frameOwners.set(frameId, page);
        }
    }

    _rootPageFor(tracked, seen = new Set()) {
        if (!tracked || seen.has(tracked.targetId)) return null;
        seen.add(tracked.targetId);
        const owner = this._frameOwners.get(tracked.parentFrameId);
        if (owner) {
            if (this._pages.get(owner.targetId) === owner) return owner;
            return this._rootPageFor(this._frames.get(owner.targetId), seen);
        }
        const direct = this._pages.get(tracked.parentFrameId);
        if (direct) return direct;
        return this._rootPageFor(this._frames.get(tracked.parentFrameId), seen);
    }

    async framesForPage(page) {
        for (let pass = 0; pass < 3; pass++) {
            const pending = [...this._frames.values()].map((tracked) => tracked.readyPromise).filter(Boolean);
            await Promise.all(pending);
            if (pending.length === this._frames.size) break;
        }
        return [...this._frames.values()].filter((tracked) => tracked.ready && this._rootPageFor(tracked) === page);
    }

    frameForTarget(target, page) {
        const tracked = this._frameTokens.get(String(target || '')) || null;
        if (!tracked || !tracked.ready) return null;
        if (page && this._rootPageFor(tracked) !== page) return null;
        return tracked;
    }

    async validateFrameHit(target, page, point, viewport) {
        let tracked = this.frameForTarget(target, page);
        if (!tracked) return { ok: false, code: 'GLASS_FRAME_UNAVAILABLE', error: `frame target is unavailable: ${target}` };
        let localPoint = point;
        let localViewport = viewport;

        for (;;) {
            const ownerPage = this._frameOwners.get(tracked.parentFrameId);
            if (!ownerPage) {
                return { ok: false, code: 'GLASS_FRAME_UNAVAILABLE', error: `frame owner is unavailable: ${tracked.target}` };
            }
            if (!localViewport || !localViewport.width || !localViewport.height) {
                localViewport = await tracked.page.viewportSize();
            }
            let hit;
            try {
                hit = await ownerPage.frameOwnerHit(tracked.targetId, localPoint, localViewport);
            } catch (error) {
                return { ok: false, code: 'GLASS_FRAME_UNAVAILABLE', error: `cannot validate frame owner: ${error.message}` };
            }
            if (!hit.visible) {
                return { ok: false, code: 'GLASS_FRAME_NOT_VISIBLE', error: `frame target is not visible: ${tracked.target}` };
            }
            if (!hit.unobstructed) {
                return { ok: false, code: 'GLASS_FRAME_OCCLUDED', error: `frame target is covered at the action point: ${tracked.target}` };
            }
            if (ownerPage === page) return { ok: true };

            tracked = this._frames.get(ownerPage.targetId);
            if (!tracked || this._rootPageFor(tracked) !== page) {
                return { ok: false, code: 'GLASS_FRAME_UNAVAILABLE', error: 'frame ancestry no longer belongs to the requested tab' };
            }
            localPoint = hit.parentPoint;
            localViewport = await ownerPage.viewportSize();
        }
    }

    /**
     * Create a page target and attach to it in flattened mode.
     * @param {string} [url]
     * @returns {Promise<CdpPage>}
     */
    async createContext(options = {}) {
        const maxContexts = Number.parseInt(options.maxContexts, 10);
        if (Number.isFinite(maxContexts) && this._contexts.size >= maxContexts) {
            const error = new Error(`browser context limit reached (${maxContexts})`);
            error.code = 'GLASS_CONTEXT_LIMIT';
            throw error;
        }
        const { browserContextId } = await this._conn.send('Target.createBrowserContext', {
            disposeOnDetach: true,
        });
        this._contexts.add(browserContextId);
        return browserContextId;
    }

    async disposeContext(browserContextId) {
        if (!browserContextId || !this._contexts.has(browserContextId)) return false;
        await this._conn.send('Target.disposeBrowserContext', { browserContextId });
        for (const [targetId, page] of this._pages) {
            if (page.browserContextId !== browserContextId) continue;
            this._pages.delete(targetId);
            page._dispose();
        }
        this._contexts.delete(browserContextId);
        return true;
    }

    async getCookies(browserContextId) {
        const params = browserContextId ? { browserContextId } : {};
        const result = await this._conn.send('Storage.getCookies', params);
        return result.cookies || [];
    }

    async setCookies(cookies, browserContextId) {
        if (!Array.isArray(cookies) || cookies.length === 0) return 0;
        const params = { cookies: cookies.map(cookieParam) };
        if (browserContextId) params.browserContextId = browserContextId;
        await this._conn.send('Storage.setCookies', params);
        return params.cookies.length;
    }

    get contextCount() { return this._contexts.size; }

    async newPage(url = 'about:blank', options = {}) {
        const createParams = { url };
        if (options.browserContextId) createParams.browserContextId = options.browserContextId;
        const { targetId } = await this._conn.send('Target.createTarget', createParams);
        if (this._maximizeWindows) await this._maximizeWindow(targetId);
        const { sessionId } = await this._conn.send('Target.attachToTarget', { targetId, flatten: true });
        let page;
        page = new CdpPage(this._conn, targetId, sessionId, {
            browserContextId: options.browserContextId || null,
            onFrameSeen: (frameId) => this._assignFrameOwner(frameId, page),
            onFrameDetached: (frameId) => {
                if (this._frameOwners.get(frameId) === page) this._frameOwners.delete(frameId);
            },
            onClose: () => this._pages.delete(targetId),
        });
        this._pages.set(targetId, page);
        try {
            await Promise.all([page._init(), this._enableRelatedTargetTracking(page)]);
            return page;
        } catch (error) {
            this._pages.delete(targetId);
            page._dispose();
            await this._conn.send('Target.closeTarget', { targetId }).catch(() => {});
            throw error;
        }
    }

    pages() { return [...this._pages.values()]; }

    /** Best-effort: maximize the OS window owning a target (headed mode; no-op if unavailable). */
    async _maximizeWindow(targetId) {
        try {
            const { windowId, bounds } = await this._conn.send('Browser.getWindowForTarget', { targetId });
            if (!windowId || (bounds && bounds.windowState === 'maximized')) return;
            await this._conn.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
        } catch { /* no window manager / already maximized — --start-maximized already applied */ }
    }

    async close() {
        for (const tracked of this._frames.values()) tracked.page._dispose();
        for (const page of this._pages.values()) page._dispose();
        try { await this._conn.close(); } catch { /* ignore */ }
        this._launched.close();
        this._pages.clear();
        this._frames.clear();
        this._frameTokens.clear();
        this._frameOwners.clear();
        this._contexts.clear();
    }
}

class CdpPage {
    constructor(conn, targetId, sessionId, options = {}) {
        this._conn = conn;
        this.targetId = targetId;
        this.sessionId = sessionId;
        this._session = conn.session(sessionId);
        this.kind = options.kind || 'page';
        this.browserContextId = options.browserContextId || null;
        this._onClose = options.onClose || (() => {});
        this._onFrameSeen = options.onFrameSeen || (() => {});
        this._onFrameDetached = options.onFrameDetached || (() => {});
        this._frameIds = new Set();
        this._eventHandlers = [];
        this._mainFrameId = null;
        this._lastLoaderId = null;
        this._documentEpoch = 0;
        this._installedFunctions = new Map();
        this._lifecycleSequence = 0;
        this._lifecycleEvents = [];
        this._lifecycleWaiters = new Set();
        this._networkEnabled = false;
        this._domEnabled = false;
        this._networkInflight = new Map();
        this._networkWaiters = new Set();
        this._frameOwnerNodes = new Map();
        this._bindPageEvents();
    }

    /** Raw CDP against this page's session (backs the `devtool` verb later). */
    send(method, params) { return this._session.send(method, params); }
    on(event, handler) {
        this._session.on(event, handler);
        this._eventHandlers.push({ event, handler });
        return this;
    }
    off(event, handler) {
        const matches = this._eventHandlers.filter((entry) => entry.event === event && entry.handler === handler);
        for (const entry of matches) this._session.off(entry.event, entry.handler);
        this._eventHandlers = this._eventHandlers.filter((entry) => entry.event !== event || entry.handler !== handler);
        return this;
    }

    async _init() {
        await this._session.send('Page.enable');
        await this._session.send('Page.setLifecycleEventsEnabled', { enabled: true });
        const { frameTree } = await this._session.send('Page.getFrameTree');
        if (frameTree && frameTree.frame) {
            this._adoptMainFrame(frameTree.frame);
            this._rememberFrameTree(frameTree);
        }
    }

    _bindPageEvents() {
        this.on('Page.frameNavigated', (params) => {
            const frame = params && params.frame;
            if (!frame) return;
            if (!frame.parentId) {
                this._adoptMainFrame(frame);
            }
            this._rememberFrame(frame.id);
            this._recordLifecycle('commit', {
                frameId: frame.id,
                loaderId: frame.loaderId || null,
            });
        });
        this.on('Page.navigatedWithinDocument', (params) => {
            this._recordLifecycle('commit', {
                frameId: params && params.frameId,
                loaderId: null,
            });
        });
        this.on('Page.lifecycleEvent', (params) => {
            const name = normalizeLifecycleName(params && params.name);
            if (!name) return;
            this._recordLifecycle(name, {
                frameId: params.frameId,
                loaderId: params.loaderId || null,
            });
        });
        this.on('Page.frameAttached', (params) => this._rememberFrame(params && params.frameId));
        this.on('Page.frameDetached', (params) => this._forgetFrame(params && params.frameId));
    }

    _rememberFrame(frameId) {
        if (!frameId) return;
        this._frameIds.add(frameId);
        this._onFrameSeen(frameId);
    }

    _rememberFrameTree(frameTree) {
        if (!frameTree) return;
        if (frameTree.frame) this._rememberFrame(frameTree.frame.id);
        for (const child of frameTree.childFrames || []) this._rememberFrameTree(child);
    }

    _forgetFrame(frameId) {
        if (!frameId) return;
        this._frameIds.delete(frameId);
        this._frameOwnerNodes.delete(frameId);
        this._onFrameDetached(frameId);
    }

    _dispose() {
        for (const { event, handler } of this._eventHandlers) this._session.off(event, handler);
        this._eventHandlers = [];
        for (const frameId of [...this._frameIds]) this._forgetFrame(frameId);
        this._installedFunctions.clear();
        this._frameOwnerNodes.clear();
        this._networkInflight.clear();
    }

    _adoptMainFrame(frame) {
        const loaderId = frame.loaderId || null;
        const changedDocument = !this._mainFrameId || (loaderId && loaderId !== this._lastLoaderId);
        this._mainFrameId = frame.id;
        this._rememberFrame(frame.id);
        this._lastLoaderId = loaderId;
        if (changedDocument) {
            this._documentEpoch++;
            this._installedFunctions.clear();
            this._frameOwnerNodes.clear();
        }
    }

    get documentEpoch() { return this._documentEpoch; }
    get cachedFunctionCount() { return this._installedFunctions.size; }

    _recordLifecycle(name, details = {}) {
        const event = {
            name,
            frameId: details.frameId || null,
            loaderId: details.loaderId || null,
            sequence: ++this._lifecycleSequence,
            timestamp: Date.now(),
        };
        this._lifecycleEvents.push(event);
        if (this._lifecycleEvents.length > 100) this._lifecycleEvents.splice(0, this._lifecycleEvents.length - 100);
        for (const waiter of [...this._lifecycleWaiters]) waiter.notify(event);
    }

    /**
     * Navigate and wait for a lifecycle milestone (event-driven).
     * @param {string} url
     * @param {{waitUntil?:'commit'|'load'|'domcontentloaded'|'networkidle', timeout?:number}} [opts]
     */
    async navigate(url, opts = {}) {
        const waitUntil = normalizeWaitUntil(opts.waitUntil);
        const timeout = opts.timeout || DEFAULT_TIMEOUT;
        const deadline = Date.now() + timeout;
        if (waitUntil === 'networkidle') await this._ensureNetworkTracking();
        const afterSequence = this._lifecycleSequence;
        const res = await this._session.send('Page.navigate', { url });
        if (res.errorText) {
            throw new Error(`navigation failed (${res.errorText}) for ${url}`);
        }
        if (waitUntil === 'commit') return res;

        const criteria = {
            frameId: res.frameId || this._mainFrameId,
            loaderId: res.loaderId || null,
            afterSequence,
        };
        if (!res.loaderId) return res;

        const lifecycle = waitUntil === 'networkidle' ? 'load' : waitUntil;
        await this._waitForLifecycle(lifecycle, { ...criteria, timeout: remaining(deadline, lifecycle) }).promise;
        if (waitUntil === 'networkidle') {
            await this.waitForNetworkIdle({ timeout: remaining(deadline, 'networkidle') });
        }
        return res;
    }

    _waitForLifecycle(what, options) {
        const opts = typeof options === 'number' ? { timeout: options } : (options || {});
        const timeout = opts.timeout || DEFAULT_TIMEOUT;
        const afterSequence = opts.afterSequence == null ? this._lifecycleSequence : opts.afterSequence;
        const matches = (event) => {
            if (!event || event.name !== what) return false;
            if (event.sequence <= afterSequence) return false;
            if (opts.since != null && event.timestamp < opts.since) return false;
            if (opts.frameId && event.frameId !== opts.frameId) return false;
            if (opts.loaderId && event.loaderId !== opts.loaderId) return false;
            return true;
        };
        const existing = this._lifecycleEvents.find(matches);
        if (existing) return { promise: Promise.resolve(existing), cancel() {} };

        let done = false;
        let timer;
        let waiter;
        let rejectPromise;
        const cleanup = () => {
            clearTimeout(timer);
            if (waiter) this._lifecycleWaiters.delete(waiter);
        };
        const finish = (resolve, reject, error, event) => {
            if (done) return;
            done = true;
            cleanup();
            if (error) reject(error);
            else resolve(event);
        };
        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            waiter = { notify: (event) => { if (matches(event)) finish(resolve, reject, null, event); } };
            this._lifecycleWaiters.add(waiter);
            timer = setTimeout(
                () => finish(resolve, reject, new Error(`timed out waiting for ${what} after ${timeout}ms`)),
                timeout,
            );
        });
        return {
            promise,
            cancel: (reason) => {
                if (done) return;
                done = true;
                cleanup();
                if (reason && rejectPromise) rejectPromise(reason);
            },
        };
    }

    async _ensureNetworkTracking() {
        if (this._networkEnabled) return;
        this.on('Network.requestWillBeSent', (params) => {
            if (!params || !params.requestId || NETWORK_IDLE_IGNORED_TYPES.has(params.type)) return;
            this._networkInflight.set(params.requestId, {
                frameId: params.frameId || null,
                loaderId: params.loaderId || null,
                type: params.type || 'Other',
                url: params.request && params.request.url,
            });
            this._notifyNetworkWaiters();
        });
        const complete = (params) => {
            if (!params || !params.requestId) return;
            this._networkInflight.delete(params.requestId);
            this._notifyNetworkWaiters();
        };
        this.on('Network.loadingFinished', complete);
        this.on('Network.loadingFailed', complete);
        await this._session.send('Network.enable', {});
        this._networkEnabled = true;
    }

    _notifyNetworkWaiters() {
        for (const waiter of [...this._networkWaiters]) waiter.notify();
    }

    async waitForNetworkIdle(options = {}) {
        await this._ensureNetworkTracking();
        const timeout = options.timeout || DEFAULT_TIMEOUT;
        const idleTime = options.idleTime == null ? DEFAULT_NETWORK_IDLE_MS : Math.max(0, options.idleTime);
        return new Promise((resolve, reject) => {
            let idleTimer;
            let timeoutTimer;
            let done = false;
            const cleanup = () => {
                clearTimeout(idleTimer);
                clearTimeout(timeoutTimer);
                this._networkWaiters.delete(waiter);
            };
            const finish = (error) => {
                if (done) return;
                done = true;
                cleanup();
                if (error) reject(error);
                else resolve({ idleTime, inflight: 0 });
            };
            const waiter = {
                notify: () => {
                    clearTimeout(idleTimer);
                    idleTimer = null;
                    if (this._networkInflight.size === 0) {
                        idleTimer = setTimeout(() => finish(), idleTime);
                    }
                },
            };
            this._networkWaiters.add(waiter);
            timeoutTimer = setTimeout(() => {
                const pending = [...this._networkInflight.values()].slice(0, 5).map((request) => request.url).filter(Boolean);
                const error = new Error(`timed out waiting for networkidle after ${timeout}ms (${this._networkInflight.size} request(s) in flight)`);
                error.pendingRequests = pending;
                finish(error);
            }, timeout);
            waiter.notify();
        });
    }

    /**
     * Evaluate an expression in the page's main world, returned by value.
     * @param {string} expression
     * @param {object} [opts] extra Runtime.evaluate params
     */
    async evaluate(expression, opts = {}) {
        const { result, exceptionDetails } = await this._session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
            ...opts,
        });
        if (exceptionDetails) throw evalError(exceptionDetails);
        return result ? result.value : undefined;
    }

    async title() { return this.evaluate('document.title'); }
    async url() { return this.evaluate('location.href'); }
    async viewportSize() {
        return this.evaluate('({width: window.innerWidth || 0, height: window.innerHeight || 0})');
    }

    async frameOwnerHit(frameId, point, childViewport) {
        if (!this._domEnabled) {
            await this._session.send('DOM.enable');
            this._domEnabled = true;
        }
        let backendNodeId = this._frameOwnerNodes.get(frameId);
        if (!backendNodeId) {
            const owner = await this._session.send('DOM.getFrameOwner', { frameId });
            backendNodeId = owner.backendNodeId;
            if (backendNodeId) this._frameOwnerNodes.set(frameId, backendNodeId);
        }
        if (!backendNodeId) return { visible: false, unobstructed: false };
        let model;
        try {
            ({ model } = await this._session.send('DOM.getBoxModel', { backendNodeId }));
        } catch {
            this._frameOwnerNodes.delete(frameId);
            const owner = await this._session.send('DOM.getFrameOwner', { frameId });
            backendNodeId = owner.backendNodeId;
            if (!backendNodeId) return { visible: false, unobstructed: false };
            this._frameOwnerNodes.set(frameId, backendNodeId);
            ({ model } = await this._session.send('DOM.getBoxModel', { backendNodeId }));
        }
        const quad = model && (model.content || model.border);
        if (!quad || quad.length !== 8 || !childViewport.width || !childViewport.height) {
            return { visible: false, unobstructed: false };
        }
        const u = Math.max(0, Math.min(1, point.x / childViewport.width));
        const v = Math.max(0, Math.min(1, point.y / childViewport.height));
        const parentPoint = pointInQuad(quad, u, v);
        const hit = await this._session.send('DOM.getNodeForLocation', {
            x: Math.round(parentPoint.x),
            y: Math.round(parentPoint.y),
            includeUserAgentShadowDOM: true,
        });
        return {
            visible: quadArea(quad) > 1,
            unobstructed: hit.backendNodeId === backendNodeId,
            parentPoint,
        };
    }

    /**
     * Call a self-contained in-page function (e.g. the agent's glassHitPoint),
     * passing one JSON-serializable argument. One round-trip; returned by value.
     * @param {Function} fn a function with NO outer references
     * @param {*} [arg]
     */
    async callFn(fn, arg, options = {}) {
        const a = arg === undefined ? 'undefined' : JSON.stringify(arg);
        const cacheKey = options.cacheKey ? String(options.cacheKey) : '';
        if (!cacheKey) return this.evaluate(`(${fn.toString()})(${a})`);

        const installedEpoch = this._installedFunctions.get(cacheKey);
        if (installedEpoch === this._documentEpoch) {
            const key = JSON.stringify(cacheKey);
            const cached = await this.evaluate(`(function(a){var r=window.__GLASS_FUNCTIONS__;var f=r&&r[${key}];if(typeof f!=="function")return {__glassMissingFunction:${key}};return f(a);})(${a})`);
            if (!cached || cached.__glassMissingFunction !== cacheKey) return cached;
            this._installedFunctions.delete(cacheKey);
        }

        const epoch = this._documentEpoch;
        const key = JSON.stringify(cacheKey);
        const result = await this.evaluate(`(function(a){var r=window.__GLASS_FUNCTIONS__||(window.__GLASS_FUNCTIONS__=Object.create(null));var f=(${fn.toString()});r[${key}]=f;return f(a);})(${a})`);
        if (this._documentEpoch === epoch) this._installedFunctions.set(cacheKey, epoch);
        return result;
    }

    /** Dispatch a TRUSTED click at viewport coords via CDP Input (real handlers fire). */
    async clickAtPoint(x, y, opts = {}) {
        const button = opts.button || 'left';
        const clickCount = opts.clickCount || 1;
        // Pipelined: commands are ordered over the single WS, so the browser still
        // processes moved→pressed→released in order, but the round-trip latency overlaps.
        await Promise.all([
            this._session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }),
            this._session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: 1, clickCount }),
            this._session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount }),
        ]);
    }

    /** Insert text at the focused element as if typed (trusted input events). */
    async insertText(text) {
        return this._session.send('Input.insertText', { text: String(text) });
    }

    /** Dispatch a trusted key press (keyDown + keyUp) by key name, e.g. 'Enter'. */
    async pressKey(key) {
        const k = keyDefinition(key);
        await this._session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
        await this._session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
    }

    /** Move the (trusted) pointer to viewport coords — drives :hover states. */
    async mouseMove(x, y) {
        await this._session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    }

    /** Reload and wait for a lifecycle milestone. */
    async reload(opts = {}) {
        const waitUntil = normalizeWaitUntil(opts.waitUntil);
        const timeout = opts.timeout || DEFAULT_TIMEOUT;
        const deadline = Date.now() + timeout;
        if (waitUntil === 'networkidle') await this._ensureNetworkTracking();
        const afterSequence = this._lifecycleSequence;
        await this._session.send('Page.reload', {});
        if (waitUntil === 'commit') {
            await this._waitForLifecycle('commit', { frameId: this._mainFrameId, afterSequence, timeout: remaining(deadline, 'commit') }).promise;
            return;
        }
        const lifecycle = waitUntil === 'networkidle' ? 'load' : waitUntil;
        await this._waitForLifecycle(lifecycle, { frameId: this._mainFrameId, afterSequence, timeout: remaining(deadline, lifecycle) }).promise;
        if (waitUntil === 'networkidle') await this.waitForNetworkIdle({ timeout: remaining(deadline, 'networkidle') });
    }

    /** Navigate session history by delta (−1 back, +1 forward) and wait for load. */
    async history(delta, opts = {}) {
        const timeout = opts.timeout || DEFAULT_TIMEOUT;
        const afterSequence = this._lifecycleSequence;
        const settled = this._waitForLifecycle('commit', { frameId: this._mainFrameId, afterSequence, timeout });
        await this.evaluate(`history.go(${Number(delta) || 0})`);
        await settled.promise;
    }

    /** Resolve a live agent token to a Runtime remote objectId (for CDP DOM calls). */
    async objectIdFor(token) {
        const { result } = await this._session.send('Runtime.evaluate', {
            expression: `window.__GLASS__ && window.__GLASS__.reg && window.__GLASS__.reg.get(${JSON.stringify(String(token))})`,
            returnByValue: false,
        });
        return result && result.objectId ? result.objectId : null;
    }

    /** Set files on a file <input> addressed by an agent token (trusted upload). */
    async setInputFiles(token, files) {
        const objectId = await this.objectIdFor(token);
        if (!objectId) throw new Error('cannot resolve element for upload (stale token)');
        const list = Array.isArray(files) ? files : [files];
        await this._session.send('DOM.setFileInputFiles', { files: list, objectId });
        return list;
    }

    async close() {
        try { await this._conn.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* ignore */ }
        this._dispose();
        this._onClose();
    }
}

function cookieParam(cookie) {
    const out = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
    };
    if (cookie.sameSite) out.sameSite = cookie.sameSite;
    if (Number.isFinite(cookie.expires) && cookie.expires > 0) out.expires = cookie.expires;
    return out;
}

function normalizeLifecycleName(name) {
    const normalized = String(name || '').toLowerCase();
    if (normalized === 'domcontentloaded') return 'domcontentloaded';
    if (normalized === 'load') return 'load';
    return null;
}

function normalizeWaitUntil(value) {
    return ['commit', 'domcontentloaded', 'load', 'networkidle'].includes(value) ? value : 'load';
}

function remaining(deadline, milestone) {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error(`timed out waiting for ${milestone}`);
    return value;
}

function evalError(details) {
    const ex = details.exception;
    const msg = (ex && (ex.description || ex.value)) || details.text || 'evaluation failed';
    return new Error(String(msg).split('\n')[0]);
}

function pointInQuad(quad, u, v) {
    const topX = quad[0] + (quad[2] - quad[0]) * u;
    const topY = quad[1] + (quad[3] - quad[1]) * u;
    const bottomX = quad[6] + (quad[4] - quad[6]) * u;
    const bottomY = quad[7] + (quad[5] - quad[7]) * u;
    return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v };
}

function quadArea(quad) {
    let twiceArea = 0;
    for (let index = 0; index < 4; index++) {
        const next = (index + 1) % 4;
        twiceArea += quad[index * 2] * quad[next * 2 + 1] - quad[next * 2] * quad[index * 2 + 1];
    }
    return Math.abs(twiceArea) / 2;
}

/** Map a key name to a complete CDP key event (so Enter/Tab/etc fire real handlers). */
const KEYS = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
    End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};
function keyDefinition(key) {
    if (KEYS[key]) return { ...KEYS[key] };
    const s = String(key);
    if (s.length === 1) {
        const upper = s.toUpperCase();
        return { key: s, code: /[a-z]/i.test(s) ? 'Key' + upper : ('Digit' + s), windowsVirtualKeyCode: upper.charCodeAt(0), text: s };
    }
    return { key: s, code: s };
}

module.exports = { CdpBrowser, CdpPage };
