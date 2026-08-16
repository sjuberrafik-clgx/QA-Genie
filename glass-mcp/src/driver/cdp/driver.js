'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER/CDP · DRIVER — the 8 verbs over raw CDP + the in-page agent
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A full, transport-native implementation of the Glass verb surface (open/see/do/
 * read/wait/net/devtool/script) with ZERO Playwright at runtime. It reuses Glass's
 * real IP — glassExtract for perception, salience.scoreAll + pack for ranking, the
 * handle codec for identity, the in-page agent for resolution/actions — over the
 * lean CDP browser handles.
 *
 * Wins vs the Playwright driver:
 *   • do()  — resolve + scroll + occlusion-check + act collapse into ~1 in-page
 *             round-trip; pointer actions are TRUSTED CDP Input events.
 *   • see() — one CDP evaluate feeds the same deterministic scorer/packer.
 *   • net() — CDP Network events (push) + Fetch mocking; no polling.
 *
 * Output shapes mirror the legacy verbs exactly, so both drivers are A/B-comparable
 * and MCP-servable through the same tool descriptors.
 *
 * @module glass-mcp/driver/cdp/driver
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { CdpBrowser } = require('./browser');
const { OperationScheduler } = require('../../scheduler');
const { glassExtract } = require('../../perception/extract');
const { scoreAll } = require('../../perception/salience');
const { pack } = require('../../perception/pack');
const { glassAgent } = require('../../agent/resolve');
const { decodeHandle, isHandle } = require('../../handle');
const { urlPredicate } = require('../../match');
const { authDiagnostic, compactError, immediateMatchDetails, isTimeoutError, pageState, sanitizeUrl, waitFailure } = require('../../wait-diagnostics');
const { isVideoAction, stopAllVideoRecordings, stopVideoRecording, videoAction } = require('../../video-recorder');
const { Cognition } = require('../../cognition');
const { senseVerb } = require('../../verbs/sense');

const FAMILIES = ['Accessibility', 'Animation', 'CSS', 'DOM', 'Emulation', 'Fetch', 'Input', 'Log',
    'Memory', 'Network', 'Overlay', 'Page', 'Performance', 'Profiler', 'Runtime', 'Security',
    'Storage', 'Target', 'Tracing'];

const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s) || '';
const safe = (v) => (typeof v === 'string' && v.length > 100000 ? v.slice(0, 100000) : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function truncResult(r) {
    try { const s = JSON.stringify(r); if (s && s.length > 100000) return { _truncated: true, length: s.length, preview: s.slice(0, 100000) }; } catch { /* non-serializable */ }
    return r;
}

// Streaming resources never emit loadingFinished/Failed, so they must not enter the request map.
const NET_IGNORED_TYPES = new Set(['WebSocket', 'EventSource']);

function createNetworkState() {
    return { recording: false, attached: false, fetchEnabled: false, fetchListener: null, events: [], reqs: new Map(), mocks: [], max: 500 };
}

class CdpDriver {
    constructor(opts = {}) {
        this.kind = 'cdp';
        this.opts = opts;
        this.browser = null;
        this._tabs = [];       // [{ id, page }]
        this._active = null;   // { id, page }
        this._seq = 0;
        this._tabScope = new AsyncLocalStorage();
        this._scheduler = new OperationScheduler({
            enabled: opts.concurrencyEnabled !== false && process.env.GLASS_CONCURRENCY_ENABLED !== 'false',
            maxConcurrent: opts.maxLanes || process.env.GLASS_MAX_LANES || 2,
        });
        this._baselines = new Map(); // tabId → Set<sph> (see novelty)
        this._netByPage = new WeakMap();
        this._tokenBudget = opts.tokenBudget || 1500;
        this._maxElements = opts.maxElements || 1500;
        this._maxContexts = Number.parseInt(opts.maxContexts || process.env.GLASS_MAX_CONTEXTS, 10) || 2;
        this._defaultIsolation = opts.defaultIsolation || process.env.GLASS_DEFAULT_ISOLATION || 'shared';
        this._videoRecorders = new Map();
        this._cognitions = new Map();        // tabId → Cognition (per-tab journey)
        this._consoleByPage = new WeakMap(); // page → bounded console/error ring (opt-in)
        this._ensurePromise = null;
    }

    // ── lifecycle + tabs ──────────────────────────────────────────────────────
    async ensure() {
        if (this._ensurePromise) return this._ensurePromise;
        this._discardMissingTabs();
        const connected = this.browser && (!this.browser.connection || !this.browser.connection.closed);
        if (connected && this._active) return;

        this._ensurePromise = this._restoreSession(connected).finally(() => {
            this._ensurePromise = null;
        });
        return this._ensurePromise;
    }
    async _launchBrowser() {
        return CdpBrowser.launch({ ...this.opts, headless: this.opts.headless !== false });
    }
    async _restoreSession(connected) {
        if (!connected) {
            const staleBrowser = this.browser;
            this.browser = null;
            this._tabs = [];
            this._active = null;
            this._baselines.clear();
            this._cognitions.clear();
            this._netByPage = new WeakMap();
            await stopAllVideoRecordings(this._videoRecorders);
            this._videoRecorders = new Map();
            if (staleBrowser) await staleBrowser.close().catch(() => {});
            this.browser = await this._launchBrowser();
        }
        const page = await this.browser.newPage('about:blank');
        this._track(page, { contextId: page.browserContextId || null });
    }
    _discardMissingTabs() {
        if (!this.browser || typeof this.browser.pages !== 'function') return;
        const pages = new Set(this.browser.pages());
        const removed = this._tabs.filter((entry) => !pages.has(entry.page));
        if (removed.length === 0) return;
        this._tabs = this._tabs.filter((entry) => pages.has(entry.page));
        for (const entry of removed) this._baselines.delete(entry.id);
        for (const entry of removed) this._cognitions.delete(entry.id);
        if (!this._active || !pages.has(this._active.page)) {
            this._active = this._tabs[this._tabs.length - 1] || null;
        }
    }
    _track(page, metadata = {}) {
        const id = 't' + (++this._seq);
        const entry = {
            id,
            page,
            contextId: metadata.contextId || page.browserContextId || null,
            scenario: metadata.scenario || null,
        };
        this._tabs.push(entry);
        if (metadata.activate !== false) this._active = entry;
        return entry;
    }
    _resolveTab(tab) {
        if (tab == null) return this._tabScope.getStore() || this._active;
        return this._tabs.find((entry) => entry.id === tab) || null;
    }
    _page(tab) {
        const entry = this._resolveTab(tab);
        if (!entry) {
            const error = new Error(`tab not found: ${tab}`);
            error.code = 'GLASS_TAB_NOT_FOUND';
            throw error;
        }
        return entry.page;
    }
    _tabIdFor(page) {
        const entry = this._tabs.find((candidate) => candidate.page === page);
        return entry ? entry.id : null;
    }
    activeTabId() { return this._active ? this._active.id : null; }
    listTabs() { return this._tabs.map((t) => ({ id: t.id, url: t.page._lastUrl || '', active: t === this._active, isolation: t.contextId ? 'context' : 'shared', scenario: t.scenario })); }

    async runInTab(tab, handler, options = {}) {
        await this.ensure();
        const entry = this._resolveTab(tab);
        if (!entry) {
            const error = new Error(`tab not found: ${tab}`);
            error.code = 'GLASS_TAB_NOT_FOUND';
            throw error;
        }
        const run = async () => {
            let result = await this._tabScope.run(entry, handler);
            if (!result || typeof result !== 'object') return result;
            if (result.ok === false) {
                const state = await pageState(entry.page);
                const auth = authDiagnostic(state);
                if (auth) {
                    result = {
                        ...result,
                        page: result.page || state,
                        diagnostic: { ...(result.diagnostic || {}), ...auth },
                    };
                }
            }
            let currentPageUrl = result.pageUrl || null;
            if (!currentPageUrl) {
                try { currentPageUrl = await entry.page.url(); } catch { /* tab may have just closed */ }
            }
            return {
                ...result,
                tab: result.tab || entry.id,
                pageUrl: sanitizeUrl(currentPageUrl),
            };
        };
        const mode = options.operation || (options.serialize ? 'mutation' : 'read');
        const scheduled = await this._scheduler.schedule(run, {
            mode,
            resource: entry.page,
            signal: options.signal || null,
            label: options.label || null,
        });
        if (!scheduled.value || typeof scheduled.value !== 'object') return scheduled.value;
        return {
            ...scheduled.value,
            audit: {
                ...(scheduled.value.audit || {}),
                scheduler: scheduled.audit,
            },
        };
    }

    async close() {
        this._scheduler.cancelQueued('Glass driver closed');
        await stopAllVideoRecordings(this._videoRecorders);
        if (this.browser) await this.browser.close();
        this.browser = null;
        this._tabs = [];
        this._active = null;
        this._baselines = new Map();
        this._netByPage = new WeakMap();
        this._videoRecorders = new Map();
    }

    // ── open: navigation + tabs ───────────────────────────────────────────────
    async open(args = {}) {
        const action = args.action || 'goto';
        await this.ensure();
        if (action === 'tabs') return { ok: true, tabs: this.listTabs(), activeTab: this.activeTabId() };
        try {
            switch (action) {
                case 'goto': {
                    if (!args.url) return { ok: false, error: 'open requires a url' };
                    const page = this._page(args.tab);
                    await page.navigate(args.url, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 30000 });
                    return await this._receipt({}, page);
                }
                case 'back': { const page = this._page(args.tab); await page.history(-1, { timeout: args.timeout || 30000 }); return await this._receipt({}, page); }
                case 'forward': { const page = this._page(args.tab); await page.history(1, { timeout: args.timeout || 30000 }); return await this._receipt({}, page); }
                case 'reload': { const page = this._page(args.tab); await page.reload({ waitUntil: args.waitUntil || 'load', timeout: args.timeout || 30000 }); return await this._receipt({}, page); }
                case 'newTab': {
                    const source = this._resolveTab(args.tab) || this._active;
                    const p = await this.browser.newPage('about:blank', { browserContextId: source && source.contextId });
                    if (args.url) await p.navigate(args.url, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 30000 });
                    this._track(p, { contextId: source && source.contextId, scenario: args.scenario });
                    return await this._receipt({ opened: true }, p);
                }
                case 'fork': {
                    const source = this._resolveTab(args.sourceTab || args.tab) || this._active;
                    if (!source) return { ok: false, code: 'GLASS_TAB_NOT_FOUND', error: 'fork requires a source tab' };
                    const isolation = args.isolation || this._defaultIsolation;
                    if (!['shared', 'context'].includes(isolation)) {
                        return { ok: false, code: 'GLASS_ISOLATION_INVALID', error: `invalid isolation mode: ${isolation}` };
                    }
                    const targetUrl = args.url || await source.page.url();
                    const checkpoint = isolation === 'context' && args.checkpoint !== false
                        ? await this._captureCheckpoint(source)
                        : null;
                    let contextId = source.contextId;
                    let page = null;
                    if (isolation === 'context') {
                        contextId = await this.browser.createContext({ maxContexts: this._maxContexts });
                    }
                    try {
                        if (checkpoint) await this.browser.setCookies(checkpoint.cookies, contextId);
                        page = await this.browser.newPage('about:blank', { browserContextId: contextId });
                        if (checkpoint && checkpoint.storage && /^https?:/.test(checkpoint.storage.origin || '')) {
                            await page.navigate(checkpoint.storage.origin, { waitUntil: 'domcontentloaded', timeout: args.timeout || 30000 });
                            await this._restoreOriginStorage(page, checkpoint.storage);
                        }
                        if (targetUrl && targetUrl !== 'about:blank') {
                            await page.navigate(targetUrl, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 30000 });
                        }
                        const entry = this._track(page, { contextId, scenario: args.scenario, activate: false });
                        return await this._receipt({
                            forked: true,
                            sourceTab: source.id,
                            isolation,
                            scenario: entry.scenario,
                            checkpoint: checkpoint ? {
                                copied: true,
                                cookies: checkpoint.cookies.length,
                                localStorage: checkpoint.storage.local.length,
                                sessionStorage: checkpoint.storage.session.length,
                                storageAvailable: checkpoint.storage.available,
                            } : { copied: false },
                        }, page);
                    } catch (error) {
                        if (page) await page.close().catch(() => {});
                        if (isolation === 'context' && contextId) await this.browser.disposeContext(contextId).catch(() => {});
                        throw error;
                    }
                }
                case 'switchTab': {
                    const t = this._tabs.find((x) => x.id === args.tab);
                    if (!t) return { ok: false, error: `tab not found: ${args.tab}` };
                    this._active = t;
                    return await this._receipt({}, t.page);
                }
                case 'closeTab': {
                    const t = args.tab ? this._tabs.find((x) => x.id === args.tab) : this._active;
                    if (t) {
                        await stopVideoRecording(this._videoRecorders, t.page);
                        const remainingInContext = t.contextId && this._tabs.some((candidate) => candidate !== t && candidate.contextId === t.contextId);
                        if (t.contextId && !remainingInContext) await this.browser.disposeContext(t.contextId);
                        else await t.page.close();
                        this._tabs = this._tabs.filter((x) => x !== t);
                        if (this._active === t) this._active = this._tabs[this._tabs.length - 1] || null;
                    }
                    return this._active
                        ? await this._receipt({ closed: true }, this._active.page)
                        : { ok: true, closed: true, url: null, title: '', tab: null };
                }
                default: return { ok: false, error: `unknown open action: ${action}` };
            }
        } catch (e) {
            return { ok: false, error: e.message, code: e.code, action };
        }
    }
    async _receipt(extra = {}, page = this._page()) {
        let url = null;
        let title = '';
        try { url = await page.url(); page._lastUrl = url; } catch { /* ignore */ }
        try { title = await page.title(); } catch { /* ignore */ }
        return { ok: true, url, title, tab: this._tabIdFor(page), ...extra };
    }

    async _captureCheckpoint(entry) {
        const [cookies, storage] = await Promise.all([
            this.browser.getCookies(entry.contextId),
            entry.page.evaluate(`(function(){
                function entries(kind){
                    var out=[];
                    try {
                        var storage=window[kind];
                        for(var i=0;i<storage.length;i++){ var key=storage.key(i); out.push([key,storage.getItem(key)]); }
                    } catch(e) { return null; }
                    return out;
                }
                var local=entries('localStorage');
                var session=entries('sessionStorage');
                return { origin: location.origin, local: local || [], session: session || [], available: local!==null && session!==null };
            })()`),
        ]);
        return { cookies, storage };
    }

    async _restoreOriginStorage(page, storage) {
        await page.evaluate(`(function(state){
            if(location.origin!==state.origin) return false;
            function restore(target, entries){ for(var i=0;i<entries.length;i++) target.setItem(entries[i][0], entries[i][1]); }
            restore(localStorage, state.local || []);
            restore(sessionStorage, state.session || []);
            return true;
        })(${JSON.stringify(storage)})`);
    }

    // ── see: affordance perception (reuses scoreAll + pack) ───────────────────
    async see(opts = {}) {
        await this.ensure();
        const page = this._page(opts.tab);
        const t0 = Date.now();
        const frames = await this.browser.framesForPage(page);
        const surfaces = [{ page, target: null }, ...frames.map((frame) => ({ page: frame.page, target: frame.target }))];
        await Promise.all(surfaces.map((surface) => this._settle(surface.page, opts.maxSettleMs != null ? opts.maxSettleMs : 2000)));
        const maxElements = opts.maxElements || this._maxElements;
        const perSurfaceMax = Math.max(1, Math.floor(maxElements / surfaces.length));
        const snapshots = await Promise.all(surfaces.map(async (surface) => ({
            surface,
            snapshot: await surface.page.callFn(glassExtract, { maxElements: perSurfaceMax }, { cacheKey: 'extract' }),
        })));
        const candidates = [];
        let considered = 0;
        let truncated = false;
        const tabId = this._tabIdFor(page);
        for (const { surface, snapshot } of snapshots) {
            considered += snapshot.stats.considered;
            truncated = truncated || snapshot.stats.truncated;
            for (const candidate of snapshot.candidates) {
                candidate.tabId = tabId;
                candidate.documentEpoch = page.documentEpoch;
                candidate.target = surface.target;
                candidates.push(candidate);
            }
        }
        const baseline = this._baselines.get(tabId) || new Set();
        scoreAll(candidates, baseline);
        const novelVsBaseline = baseline.size ? candidates.reduce((n, c) => n + (baseline.has(c.sph) ? 0 : 1), 0) : 0;
        const { affordances, budget } = pack(candidates, { tokenBudget: opts.tokenBudget || this._tokenBudget });
        if (!opts.keepBaseline) this._baselines.set(tabId, new Set(candidates.map((c) => c.sph)));
        return {
            url: snapshots[0].snapshot.stats.url,
            title: snapshots[0].snapshot.stats.title,
            budget: { tokens: budget.tokens, used: budget.used, elementsConsidered: considered, returned: affordances.length, clusters: budget.clusters, truncated },
            affordances,
            audit: { pass: 'single', ms: Date.now() - t0, driver: 'cdp', elementsConsidered: considered, returned: affordances.length, novelVsBaseline, visionUsed: false },
        };
    }
    async _settle(page, cap) {
        if (!cap || cap <= 0) return;
        const end = Date.now() + cap;
        try {
            for (;;) {
                const rs = await page.evaluate('document.readyState');
                if (rs === 'complete' || rs === 'interactive') return;
                if (Date.now() > end) return;
                await sleep(50);
            }
        } catch { /* best effort */ }
    }

    // ── cognition (opt-in, driver-neutral kernel) ─────────────────────────────
    /** The zero-mutation `sense` verb over the CDP driver. */
    async sense(args = {}) {
        await this.ensure();
        return senseVerb(this.cogHost(args.tab), args || {});
    }

    /** Lazily create a per-tab Cognition and attach the console buffer once. */
    cognitionFor(page) {
        const tabId = this._tabIdFor(page);
        let cog = this._cognitions.get(tabId);
        if (!cog) {
            cog = new Cognition(this.opts.cognition || {});
            this._cognitions.set(tabId, cog);
            this._attachConsole(page).catch(() => { /* console capture is best-effort */ });
        }
        return cog;
    }

    /** Opt-in bounded console/error ring via the CDP Log domain (verdict input). */
    async _attachConsole(page) {
        if (this._consoleByPage.has(page)) return;
        const buf = [];
        this._consoleByPage.set(page, buf);
        const push = (e) => { buf.push(e); if (buf.length > 200) buf.splice(0, buf.length - 200); };
        try {
            page.on('Log.entryAdded', (p) => {
                const en = p && p.entry;
                if (!en) return;
                const type = en.level === 'error' ? 'error' : (en.level === 'warning' ? 'warning' : 'log');
                push({ type, text: String(en.text || '').slice(0, 300) });
            });
            page.on('Runtime.exceptionThrown', (p) => {
                const d = p && p.exceptionDetails;
                const text = (d && ((d.exception && d.exception.description) || d.text)) || 'exception';
                push({ type: 'pageerror', text: String(text).slice(0, 300) });
            });
            await page.send('Log.enable', {});
        } catch { /* best effort — verdict still works from url/lexicon/net/world signals */ }
    }

    /** Driver-neutral adapter the `sense` verb + see/do enrichment consume. */
    cogHost(tab) {
        const driver = this;
        const page = this._page(tab);
        return {
            cognition: () => driver.cognitionFor(page),
            perceive: (opts) => driver.see({ ...(opts || {}), tab: driver._tabIdFor(page) }),
            readText: async (max) => {
                try {
                    const text = await page.evaluate('document.body ? document.body.innerText || "" : ""');
                    return String(text || '').slice(0, max || 8000);
                } catch { return ''; }
            },
            runtime: () => ({
                netEvents: (driver._netFor(page).events || []).slice(-80),
                consoleEvents: driver._consoleByPage.get(page) || [],
            }),
        };
    }

    // ── do: act + verifiable effect receipt ───────────────────────────────────
    async do(args = {}) {
        await this.ensure();
        const page = this._page(args.tab);
        const action = args.action || 'click';
        if (action === 'screenshot') return this._screenshot(page, args);
        if (isVideoAction(action)) {
            return videoAction(this._videoRecorders, page, page, args, {
                artifactsDir: this.opts.artifactsDir,
                ffmpegPath: this.opts.ffmpegPath,
            });
        }

        const r = await this._resolveTarget(page, args.target, { withPageSig: true });
        if (!r || (!r.found && !r.at)) return this._targetFailure(r, { action });

        const targetPage = r._page || page;
        if (!r.at) {
            const guard = await this._mutationGuard(page, r, action);
            if (!guard.ok) return { ok: false, action, code: guard.code, error: guard.error, audit: this._audit(r) };
        }
        const before = (r && r.pageUrl !== undefined) ? { url: r.pageUrl, sig: r.pageSig } : await this._capture(targetPage);
        let uploaded = null;
        let immediateAfter = null;
        try {
            if (r.at) {
                await targetPage.clickAtPoint(r.at[0], r.at[1]);
            } else {
                switch (action) {
                    case 'click': await targetPage.clickAtPoint(r.x, r.y); break;
                    case 'hover': await targetPage.mouseMove(r.x, r.y); break;
                    case 'press': await this._callAgent(targetPage, { cmd: 'act', token: r.token, action: 'focus' }); await targetPage.pressKey(args.value || 'Enter'); break;
                    case 'type':
                    case 'fill': { const a = await this._callAgent(targetPage, { cmd: 'act', token: r.token, action: 'fill', value: args.value, captureAfter: true }); if (!a.ok) throw new Error(a.error || 'fill failed'); immediateAfter = a.after; break; }
                    case 'select': { const a = await this._callAgent(targetPage, { cmd: 'act', token: r.token, action: 'select', value: args.value, captureAfter: true }); if (!a.ok) throw new Error(a.error || 'select failed'); immediateAfter = a.after; break; }
                    case 'check':
                    case 'uncheck': { const a = await this._callAgent(targetPage, { cmd: 'act', token: r.token, action, captureAfter: true }); if (!a.ok) throw new Error(a.error || `${action} failed`); immediateAfter = a.after; break; }
                    case 'scrollIntoView': await this._callAgent(targetPage, { cmd: 'act', token: r.token, action: 'scrollIntoView' }); break;
                    case 'upload': {
                        const files = Array.isArray(args.files) ? args.files : (args.files != null ? [args.files] : (args.value != null ? [String(args.value)] : []));
                        if (!files.length) return { ok: false, error: 'upload requires { files: string | string[] }', action, audit: this._audit(r) };
                        await targetPage.setInputFiles(r.token, files);
                        uploaded = files;
                        break;
                    }
                    default: return { ok: false, error: `unknown action: ${action}`, action, audit: this._audit(r) };
                }
            }
        } catch (e) {
            return {
                ok: false,
                code: e.code || (isTimeoutError(e) ? 'GLASS_ACTION_TIMEOUT' : 'GLASS_ACTION_ERROR'),
                error: isTimeoutError(e) ? `${action} timed out` : compactError(e, `${action} failed`),
                action,
                audit: this._audit(r),
            };
        }

        const after = immediateAfter && immediateAfter.sig !== before.sig
            ? immediateAfter
            : (r.at ? await this._capture(targetPage) : await this._captureScope(targetPage, r._identity));
        const effect = { navigated: before.url !== after.url, urlChanged: before.url !== after.url, domChanged: before.sig !== after.sig };
        const out = { ok: true, action, effect, audit: this._audit(r) };
        if (args.value !== undefined && (action === 'type' || action === 'fill')) out.value = String(args.value);
        if (uploaded) out.files = uploaded;
        if (action === 'click' && !effect.urlChanged && !effect.domChanged) out.warning = 'click produced no observable effect (URL/DOM unchanged)';
        return out;
    }

    async _screenshot(page, args) {
        try {
            let clip;
            let audit;
            if (args.target) {
                const r = await this._resolveTarget(page, args.target);
                if (!r.found) return this._targetFailure(r, { action: 'screenshot' });
                page = r._page || page;
                audit = this._audit(r);
                clip = { x: r.rect.x, y: r.rect.y, width: r.rect.w, height: r.rect.h, scale: 1 };
            }
            const params = { format: 'png', captureBeyondViewport: !clip && args.fullPage !== false };
            if (clip) params.clip = clip;
            const { data } = await page.send('Page.captureScreenshot', params);
            const buf = Buffer.from(data, 'base64');
            const out = { ok: true, action: 'screenshot', bytes: buf.length, audit };
            if (args.returnData) { out.encoding = 'base64'; out.data = data; }
            else {
                const fs = require('node:fs');
                const os = require('node:os');
                const path = require('node:path');
                const dest = args.path || path.join(os.tmpdir(), `glass-shot-${Date.now()}.png`);
                fs.writeFileSync(dest, buf);
                out.path = dest;
            }
            return out;
        } catch (e) {
            return { ok: false, action: 'screenshot', error: e.message };
        }
    }

    // ── read: content extraction ──────────────────────────────────────────────
    async read(args = {}) {
        await this.ensure();
        const page = this._page(args.tab);
        const what = args.what || 'text';
        const max = args.max || 20000;
        if (!args.target) {
            try {
                switch (what) {
                    case 'url': return { ok: true, what, value: await page.url() };
                    case 'title': return { ok: true, what, value: await page.title() };
                    case 'html': { const html = await page.evaluate('document.documentElement ? document.documentElement.outerHTML : ""'); return { ok: true, what, value: cap(html, max), truncated: html.length > max }; }
                    case 'text':
                    default: { const text = await page.evaluate('document.body ? document.body.innerText || "" : ""'); return { ok: true, what: 'text', text: cap(text, max), truncated: (text || '').length > max, audit: { step: 'page' } }; }
                }
            } catch (e) { return { ok: false, error: e.message, what }; }
        }
        const r = await this._resolveTarget(page, args.target, { read: { what, name: args.name } });
        if (!r.found) return this._targetFailure(r, { what });
        if (what === 'attribute' && !args.name) return { ok: false, error: "read({what:'attribute'}) requires { name }" };
        const a = r.read || await this._callAgent(r._page || page, { cmd: 'read', token: r.token, what, name: args.name });
        if (!a.ok) return { ok: false, error: a.error || `unknown read 'what': ${what}`, what, audit: this._audit(r) };
        const audit = this._audit(r);
        switch (what) {
            case 'text': return { ok: true, what, text: cap(a.text, max), audit };
            case 'value': return { ok: true, what, value: a.value, audit };
            case 'attribute': return { ok: true, what, name: args.name, value: a.value, audit };
            case 'html': return { ok: true, what, value: cap(a.value, max), audit };
            case 'table': return { ok: true, what, rows: a.rows || [], audit };
            default: return { ok: false, error: `unknown read 'what': ${what}`, audit };
        }
    }

    // ── wait: bounded condition waits ─────────────────────────────────────────
    async wait(args = {}) {
        await this.ensure();
        const page = this._page(args.tab);
        const timeout = args.timeout || 15000;
        const forCond = args.for || (args.ms != null ? 'timeout' : 'load');
        const t0 = Date.now();
        let successDetails = {};
        try {
            switch (forCond) {
                case 'visible': case 'hidden': case 'attached': case 'detached': case 'enabled':
                    await this._pollTarget(page, args.target, forCond, timeout); break;
                case 'text': {
                    const needle = String(args.value == null ? '' : args.value);
                    await this._poll(timeout, async () => {
                        if (args.target) { const r = await this._resolveTarget(page, args.target); if (!r.found) return false; const a = await this._callAgent(r._page || page, { cmd: 'read', token: r.token, what: 'text' }); return a.ok && (a.text || '').includes(needle); }
                        const txt = await page.evaluate('document.body ? document.body.innerText || "" : ""'); return String(txt).includes(needle);
                    });
                    break;
                }
                case 'url': {
                    const pred = urlPredicate(args.value);
                    const observedAtStart = await page.url();
                    const result = await this._poll(timeout, async () => pred(await page.url()));
                    if (result.matchedImmediately) successDetails = immediateMatchDetails('url', observedAtStart);
                    break;
                }
                case 'title': { const needle = String(args.value == null ? '' : args.value); await this._poll(timeout, async () => (await page.title()).includes(needle)); break; }
                case 'load': case 'domcontentloaded': {
                    await this._poll(timeout, async () => { const rs = await page.evaluate('document.readyState'); return forCond === 'domcontentloaded' ? (rs === 'interactive' || rs === 'complete') : rs === 'complete'; });
                    break;
                }
                case 'networkidle': { await page.waitForNetworkIdle({ timeout }); break; }
                case 'timeout': { const ms = Math.min(Number(args.value == null ? args.ms || 0 : args.value), 60000); await sleep(ms); break; }
                default: return { ok: false, code: 'GLASS_WAIT_CONDITION_INVALID', error: `unknown wait 'for': ${forCond}` };
            }
        } catch (e) {
            if (e.code && e.code !== 'GLASS_WAIT_TIMEOUT') {
                return { ok: false, for: forCond, condition: forCond, error: e.message, code: e.code, waitedMs: Date.now() - t0 };
            }
            return waitFailure(page, forCond, timeout, t0, e);
        }
        return { ok: true, for: forCond, waitedMs: Date.now() - t0, ...successDetails };
    }
    async _pollTarget(page, target, cond, timeout) {
        await this._poll(timeout, async () => {
            const r = await this._resolveTarget(page, target);
            if (r && r.code) {
                const error = new Error(r.error);
                error.code = r.code;
                throw error;
            }
            if (cond === 'attached') return r.found;
            if (cond === 'detached') return !r.found;
            if (!r.found) return cond === 'hidden';
            if (cond === 'visible') return (await this._visibilityGuard(page, r)).ok;
            if (cond === 'hidden') return !r.visible;
            if (cond === 'enabled') return !!r.enabled && (await this._visibilityGuard(page, r)).ok;
            return false;
        });
    }
    async _poll(timeout, fn) {
        const end = Date.now() + timeout;
        let attempts = 0;
        for (;;) {
            attempts++;
            if (await fn()) return { attempts, matchedImmediately: attempts === 1 };
            if (Date.now() > end) {
                const error = new Error('condition not met within timeout');
                error.code = 'GLASS_WAIT_TIMEOUT';
                throw error;
            }
            await sleep(100);
        }
    }

    // ── net: observe/control network via CDP ──────────────────────────────────
    async net(args = {}) {
        await this.ensure();
        const page = this._page(args.tab);
        const state = this._netFor(page);
        const action = args.action || 'record';
        try {
            switch (action) {
                case 'record': { state.max = args.max || state.max || 500; state.recording = true; await this._attachNet(page, state); return { ok: true, action, recording: true }; }
                case 'stop': { state.recording = false; return { ok: true, action, recording: false, count: state.events.length }; }
                case 'clear': { state.events = []; return { ok: true, action, count: 0 }; }
                case 'list': {
                    let ev = state.events.slice();
                    if (args.urlPattern) { const p = urlPredicate(args.urlPattern); ev = ev.filter((e) => p(e.url)); }
                    if (args.method) ev = ev.filter((e) => (e.method || '').toUpperCase() === String(args.method).toUpperCase());
                    if (args.status) ev = ev.filter((e) => e.status === Number(args.status));
                    if (args.resourceType) ev = ev.filter((e) => e.resourceType === args.resourceType);
                    return { ok: true, action, count: ev.length, events: ev.slice(-(args.limit || 50)) };
                }
                case 'waitForResponse': {
                    await this._attachNet(page, state);
                    const p = await this._waitForNet(page, 'response', args.urlPattern, args.timeout || 15000);
                    const resp = p.response || {};
                    return { ok: true, action, status: resp.status, okStatus: resp.status >= 200 && resp.status < 300, url: resp.url, method: (state.reqs.get(p.requestId) || {}).method };
                }
                case 'waitForRequest': {
                    await this._attachNet(page, state);
                    const p = await this._waitForNet(page, 'request', args.urlPattern, args.timeout || 15000);
                    return { ok: true, action, url: p.request && p.request.url, method: p.request && p.request.method, resourceType: p.type };
                }
                case 'mock': {
                    if (!args.urlPattern) return { ok: false, error: 'mock requires { urlPattern }' };
                    await this._ensureFetch(page, state);
                    const hasJson = args.json !== undefined;
                    const body = hasJson ? JSON.stringify(args.json) : (args.body != null ? String(args.body) : '');
                    const contentType = args.contentType || (hasJson ? 'application/json' : 'text/plain');
                    state.mocks.push({ key: String(args.urlPattern), pred: urlPredicate(args.urlPattern), status: args.status || 200, body, contentType });
                    return { ok: true, action, urlPattern: String(args.urlPattern), status: args.status || 200 };
                }
                case 'unmock': {
                    const before = state.mocks.length;
                    state.mocks = state.mocks.filter((m) => args.urlPattern && m.key !== String(args.urlPattern));
                    if (!state.mocks.length && state.fetchEnabled) {
                        try { await page.send('Fetch.disable', {}); } catch { /* ignore */ }
                        if (state.fetchListener) { page.off('Fetch.requestPaused', state.fetchListener); state.fetchListener = null; }
                        state.fetchEnabled = false;
                    }
                    return { ok: true, action, removed: before - state.mocks.length };
                }
                case 'offline': {
                    await page.send('Network.enable', {});
                    await page.send('Network.emulateNetworkConditions', { offline: !!args.value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
                    return { ok: true, action, offline: !!args.value };
                }
                default: return { ok: false, error: `unknown net action: ${action}` };
            }
        } catch (e) {
            return { ok: false, action, error: e.message };
        }
    }
    _netFor(page) {
        let state = this._netByPage.get(page);
        if (!state) {
            state = createNetworkState();
            this._netByPage.set(page, state);
        }
        return state;
    }
    async _attachNet(page, state = this._netFor(page)) {
        if (state.attached) return;
        await page.send('Network.enable', {});
        page.on('Network.requestWillBeSent', (p) => {
            if (!p || !p.requestId || NET_IGNORED_TYPES.has(p.type)) return;
            this._trackReq(state, p.requestId, { method: p.request && p.request.method, url: p.request && p.request.url, type: p.type });
        });
        page.on('Network.responseReceived', (p) => { if (!state.recording) return; const r = state.reqs.get(p.requestId) || {}; this._push(state, { type: 'response', method: r.method, url: p.response && p.response.url, status: p.response && p.response.status, resourceType: p.type, ts: Date.now() }); });
        page.on('Network.loadingFinished', (p) => { state.reqs.delete(p.requestId); });
        page.on('Network.loadingFailed', (p) => {
            const r = state.reqs.get(p.requestId) || {};
            if (state.recording) this._push(state, { type: 'failed', method: r.method, url: r.url, resourceType: p.type, failure: p.errorText, ts: Date.now() });
            state.reqs.delete(p.requestId);
        });
        state.attached = true;
    }
    // Cap the in-flight request map so never-completing requests can't grow it without bound.
    _trackReq(state, requestId, info) {
        state.reqs.set(requestId, info);
        const cap = (state.max || 500) * 2;
        if (state.reqs.size > cap) {
            const overflow = state.reqs.size - cap;
            const it = state.reqs.keys();
            for (let i = 0; i < overflow; i++) state.reqs.delete(it.next().value);
        }
    }
    _push(state, event) { state.events.push(event); if (state.events.length > state.max) state.events.splice(0, state.events.length - state.max); }
    _waitForNet(page, kind, urlPattern, timeout) {
        const pred = urlPredicate(urlPattern);
        const evt = kind === 'request' ? 'Network.requestWillBeSent' : 'Network.responseReceived';
        return new Promise((resolve, reject) => {
            const onEvt = (p) => {
                const url = kind === 'request' ? (p.request && p.request.url) : (p.response && p.response.url);
                if (pred(url)) { clearTimeout(timer); page.off(evt, onEvt); resolve(p); }
            };
            const timer = setTimeout(() => { page.off(evt, onEvt); reject(new Error(`timeout waiting for ${kind}`)); }, timeout);
            page.on(evt, onEvt);
        });
    }
    async _ensureFetch(page, state = this._netFor(page)) {
        if (state.fetchEnabled) return;
        if (!state.fetchListener) {
            state.fetchListener = async (p) => {
                const url = p.request && p.request.url;
                const mock = state.mocks.find((m) => m.pred(url));
                try {
                    if (mock) {
                        const body = Buffer.from(mock.body || '', 'utf8').toString('base64');
                        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: mock.status || 200, responseHeaders: [{ name: 'Content-Type', value: mock.contentType }], body });
                    } else {
                        await page.send('Fetch.continueRequest', { requestId: p.requestId });
                    }
                } catch { /* request already gone */ }
            };
            page.on('Fetch.requestPaused', state.fetchListener);
        }
        await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
        state.fetchEnabled = true;
    }

    // ── devtool: raw CDP passthrough ──────────────────────────────────────────
    async devtool(args = {}) {
        await this.ensure();
        const catalog = this.browser.protocolCatalog;
        if (args.list) {
            return {
                ok: true,
                families: catalog ? catalog.domains : FAMILIES,
                protocol: {
                    protocolVersion: this.browser.version && this.browser.version.protocolVersion,
                    product: this.browser.version && this.browser.version.product,
                    domainCount: catalog ? catalog.domainCount : null,
                    commandCount: catalog ? catalog.commandCount : null,
                    eventCount: catalog ? catalog.eventCount : null,
                    typeCount: catalog ? catalog.typeCount : null,
                },
            };
        }
        if (!args.method || typeof args.method !== 'string' || !args.method.includes('.')) return { ok: false, error: "devtool requires { method:'Domain.command' } (e.g. 'Performance.getMetrics')" };
        if (catalog && !catalog.hasMethod(args.method)) {
            return { ok: false, code: 'GLASS_CDP_METHOD_NOT_FOUND', method: args.method, error: `CDP method is not supported by ${this.browser.version.product}: ${args.method}` };
        }
        const scope = args.scope || (catalog ? catalog.scopeFor(args.method) : 'page');
        if (!['browser', 'page'].includes(scope)) return { ok: false, code: 'GLASS_CDP_SCOPE_INVALID', method: args.method, error: `invalid CDP scope: ${scope}` };
        try {
            const endpoint = scope === 'browser' ? this.browser : this._page(args.tab);
            const result = await endpoint.send(args.method, args.params || {});
            return { ok: true, method: args.method, scope, result: truncResult(result) };
        } catch (e) {
            return { ok: false, method: args.method, scope, code: e.code, error: e.message };
        }
    }

    // ── script: audited page JS ───────────────────────────────────────────────
    async script(args = {}) {
        await this.ensure();
        const page = this._page(args.tab);
        try {
            if (args.target) {
                const fn = args.fn || args.expression;
                if (!fn) return { ok: false, error: 'script with a target requires { fn }' };
                const r = await this._resolveTarget(page, args.target);
                if (!r.found) return this._targetFailure(r);
                const targetPage = r._page || page;
                const expr = `(function(){ var el = window.__GLASS__ && window.__GLASS__.reg && window.__GLASS__.reg.get(${JSON.stringify(r.token)}); var f = (${String(fn)}); return f(el, ...(${JSON.stringify(args.args || [])})); })()`;
                return { ok: true, result: safe(await targetPage.evaluate(expr)), audit: this._audit(r) };
            }
            if (args.fn) {
                const expr = `(function(){ var f = (${String(args.fn)}); return f(...(${JSON.stringify(args.args || [])})); })()`;
                return { ok: true, result: safe(await page.evaluate(expr)) };
            }
            if (args.expression) return { ok: true, result: safe(await page.evaluate(String(args.expression))) };
            return { ok: false, error: 'script requires { expression } or { fn }' };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    // ── target resolution + shared helpers ────────────────────────────────────
    _callAgent(page, operation) {
        return page.callFn(glassAgent, operation, { cacheKey: 'agent' });
    }
    async _resolveTarget(page, target, extra = {}) {
        if (target == null) return { found: false, tried: [] };
        const resolveIdentity = async (identity) => {
            const tabId = this._tabIdFor(page);
            if (identity.tab && identity.tab !== tabId) {
                return {
                    found: false,
                    code: 'GLASS_CROSS_TAB_HANDLE',
                    error: `handle belongs to tab ${identity.tab}; requested tab is ${tabId}`,
                    identity,
                    tried: [],
                };
            }
            if (identity.epoch != null && identity.epoch !== page.documentEpoch) {
                return {
                    found: false,
                    code: 'GLASS_STALE_DOCUMENT_HANDLE',
                    error: `handle belongs to document epoch ${identity.epoch}; current epoch is ${page.documentEpoch}`,
                    identity,
                    tried: [],
                };
            }
            let targetPage = page;
            if (identity.target) {
                const frame = this.browser.frameForTarget(identity.target, page);
                if (!frame) {
                    return {
                        found: false,
                        code: identity.documentToken ? 'GLASS_STALE_DOCUMENT_HANDLE' : 'GLASS_FRAME_UNAVAILABLE',
                        error: `handle target is no longer available: ${identity.target}`,
                        identity,
                        tried: [],
                    };
                }
                targetPage = frame.page;
            }
            const resolved = await this._callAgent(targetPage, { cmd: 'resolve', identity, ...extra });
            if (resolved && typeof resolved === 'object') {
                resolved._page = targetPage;
                resolved._target = identity.target || null;
                resolved._identity = identity;
            }
            return resolved;
        };
        if (typeof target === 'string') {
            if (isHandle(target)) return resolveIdentity(decodeHandle(target));
            return this._resolveDescription(page, { text: target }, extra);
        }
        if (typeof target === 'object') {
            if (target.handle && isHandle(target.handle)) return resolveIdentity(decodeHandle(target.handle));
            if (Array.isArray(target.at) && target.at.length === 2) return { found: true, at: target.at, strategy: 'coordinates', tried: [{ step: 'coordinates' }] };
            return this._resolveDescription(page, target, extra);
        }
        return { found: false, tried: [] };
    }
    async _resolveDescription(page, desc, extra) {
        const frames = await this.browser.framesForPage(page);
        const surfaces = [{ page, target: null }, ...frames.map((frame) => ({ page: frame.page, target: frame.target }))];
        const attempts = await Promise.all(surfaces.map(async (surface, index) => {
            try {
                const result = await this._callAgent(surface.page, { cmd: 'resolveDesc', desc, ...extra });
                return { result, surface, index };
            } catch (error) {
                return { result: { found: false, error: error.message }, surface, index };
            }
        }));
        const matches = attempts.filter((attempt) => attempt.result && attempt.result.found);
        if (!matches.length) {
            const coded = attempts.find((attempt) => attempt.result && attempt.result.code);
            return coded ? coded.result : { found: false, tried: attempts.flatMap((attempt) => attempt.result.tried || []) };
        }
        matches.sort((left, right) => {
            const rank = (attempt) => {
                const result = attempt.result;
                return (result.visible && !result.occluded ? 4 : 0)
                    + (result.inViewport ? 2 : 0)
                    + (result.enabled ? 1 : 0)
                    + (result.confidence || 0);
            };
            return rank(right) - rank(left) || left.index - right.index;
        });
        const selected = matches[0];
        selected.result._page = selected.surface.page;
        selected.result._target = selected.surface.target;
        selected.result._identity = { frame: Array.isArray(desc.frame) ? desc.frame : null };
        return selected.result;
    }
    async _visibilityGuard(page, resolved) {
        if (!resolved.visible || !resolved.inViewport) {
            return { ok: false, code: 'GLASS_TARGET_NOT_VISIBLE', error: 'target is not visible at the action point' };
        }
        if (resolved.occluded) {
            return { ok: false, code: 'GLASS_TARGET_OCCLUDED', error: 'target is covered at the action point' };
        }
        if (!resolved._target) return { ok: true };
        return this.browser.validateFrameHit(
            resolved._target,
            page,
            { x: resolved.x, y: resolved.y },
            resolved.viewport,
        );
    }
    async _mutationGuard(page, resolved, action) {
        const visibility = await this._visibilityGuard(page, resolved);
        if (!visibility.ok) return visibility;
        if (['click', 'press', 'type', 'fill', 'select', 'check', 'uncheck', 'upload'].includes(action) && !resolved.enabled) {
            return { ok: false, code: 'GLASS_TARGET_DISABLED', error: 'target is disabled' };
        }
        return { ok: true };
    }
    _targetFailure(r, extra = {}) {
        return {
            ok: false,
            error: (r && r.error) || 'target not found',
            code: (r && r.code) || 'GLASS_TARGET_NOT_FOUND',
            ...extra,
            audit: this._audit(r),
        };
    }
    _audit(r) {
        if (!r) return { resolved: false };
        if (r.at) return { resolved: true, step: 'coordinates', at: r.at };
        const identity = r.identity || {};
        return { resolved: !!r.found, code: r.code, step: r.strategy, count: r.count, confidence: r.confidence, identity: { role: r.role || identity.role, name: r.name || identity.name, tab: identity.tab }, tried: r.tried };
    }
    async _capture(page) {
        try {
            const state = await this._callAgent(page, { cmd: 'capture', identity: {} });
            return state && state.ok ? state : { url: '', sig: '' };
        }
        catch { return { url: '', sig: '' }; }
    }
    async _captureScope(page, identity) {
        try {
            const state = await this._callAgent(page, { cmd: 'capture', identity: identity || {} });
            return state && state.ok ? state : await this._capture(page);
        } catch {
            return this._capture(page);
        }
    }
}

module.exports = { CdpDriver };
