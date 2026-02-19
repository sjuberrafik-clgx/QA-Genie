/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ADVANCED PLAYWRIGHT METHODS — Zero-Limitation Extensions
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Applied as a mixin to PlaywrightDirectBridge. Adds capabilities for:
 *   - iframe navigation & interaction
 *   - Shadow DOM traversal
 *   - Network interception & mocking (route/unroute)
 *   - Storage access (localStorage, sessionStorage, IndexedDB)
 *   - Multi-context & incognito
 *   - Visual testing (screenshot comparison)
 *   - Video recording
 *   - Auth/session persistence (storageState)
 *   - Accessibility audit
 *   - Geolocation & permissions
 *   - File system helpers for downloads
 *   - DOM mutation observation
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Apply advanced methods to a PlaywrightDirectBridge instance
 */
export function applyAdvancedMethods(bridge) {

    // ═══════════════════════════════════════════════════
    // IFRAME SUPPORT
    // ═══════════════════════════════════════════════════

    /**
     * List all iframes on the current page
     */
    bridge.listFrames = async function () {
        const frames = this.page.frames();
        return {
            frames: frames.map((f, i) => ({
                index: i,
                name: f.name(),
                url: f.url(),
                isMain: f === this.page.mainFrame(),
                isDetached: f.isDetached(),
            })),
            total: frames.length,
        };
    };

    /**
     * Switch focus to a specific iframe
     */
    bridge.switchToFrame = async function (args) {
        const { index, name, selector } = args;
        let frame;

        if (index !== undefined) {
            frame = this.page.frames()[index];
        } else if (name) {
            frame = this.page.frame(name);
        } else if (selector) {
            const elementHandle = await this.page.$(selector);
            if (elementHandle) {
                frame = await elementHandle.contentFrame();
            }
        }

        if (!frame) {
            throw new Error('Frame not found');
        }

        this._activeFrame = frame;
        return {
            success: true,
            frame: { name: frame.name(), url: frame.url() },
        };
    };

    /**
     * Switch back to main frame
     */
    bridge.switchToMainFrame = async function () {
        this._activeFrame = null;
        return { success: true, message: 'Switched to main frame' };
    };

    /**
     * Execute action within a specific frame
     */
    bridge.frameAction = async function (args) {
        const { selector: frameSelector, action, element, text, value } = args;

        const elementHandle = await this.page.$(frameSelector);
        if (!elementHandle) throw new Error(`Frame element not found: ${frameSelector}`);

        const frame = await elementHandle.contentFrame();
        if (!frame) throw new Error('Could not get content frame');

        switch (action) {
            case 'click':
                await frame.click(element);
                return { success: true, action: 'click', element };
            case 'type':
                await frame.fill(element, text || '');
                return { success: true, action: 'type', element };
            case 'getText':
                const content = await frame.textContent(element);
                return { success: true, text: content };
            case 'snapshot': {
                const html = await frame.content();
                const title = await frame.title();
                return { success: true, html: html.substring(0, 50000), title, url: frame.url() };
            }
            default:
                throw new Error(`Unknown frame action: ${action}`);
        }
    };

    // ═══════════════════════════════════════════════════
    // SHADOW DOM SUPPORT
    // ═══════════════════════════════════════════════════

    /**
     * Query inside Shadow DOM
     */
    bridge.shadowDomQuery = async function (args) {
        const { hostSelector, innerSelector, action = 'find', text, value } = args;

        const result = await this.page.evaluate(
            ({ hostSel, innerSel, act, txt, val }) => {
                const host = document.querySelector(hostSel);
                if (!host || !host.shadowRoot) {
                    return { error: 'Shadow root not found for: ' + hostSel };
                }

                const el = host.shadowRoot.querySelector(innerSel);
                if (!el) {
                    return { error: 'Element not found in shadow DOM: ' + innerSel };
                }

                switch (act) {
                    case 'find':
                        return {
                            found: true,
                            tagName: el.tagName,
                            text: el.textContent?.substring(0, 200),
                            id: el.id,
                            className: el.className,
                        };
                    case 'click':
                        el.click();
                        return { success: true, action: 'click' };
                    case 'type':
                        el.value = txt || '';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return { success: true, action: 'type' };
                    case 'getText':
                        return { text: el.textContent };
                    case 'getValue':
                        return { value: el.value };
                    case 'setAttribute':
                        el.setAttribute(txt, val);
                        return { success: true };
                    default:
                        return { error: 'Unknown action: ' + act };
                }
            },
            { hostSel: hostSelector, innerSel: innerSelector, act: action, txt: text, val: value }
        );

        return result;
    };

    /**
     * Pierce shadow DOM with >> syntax (Playwright built-in)
     */
    bridge.shadowPierce = async function (args) {
        const { selector, action = 'click', text } = args;
        // Playwright supports >> for shadow DOM piercing natively
        const locator = this.page.locator(selector);

        switch (action) {
            case 'click':
                await locator.click();
                return { success: true, clicked: selector };
            case 'type':
                await locator.fill(text || '');
                return { success: true, typed: selector };
            case 'getText':
                const content = await locator.textContent();
                return { text: content };
            case 'isVisible':
                const visible = await locator.isVisible();
                return { visible };
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    };

    // ═══════════════════════════════════════════════════
    // NETWORK INTERCEPTION & MOCKING
    // ═══════════════════════════════════════════════════

    /** @type {Map<string, Function>} Active route handlers */
    bridge._routeHandlers = new Map();

    /**
     * Intercept network requests matching a URL pattern
     */
    bridge.routeIntercept = async function (args) {
        const { urlPattern, action = 'abort', status, body, contentType, headers } = args;

        const handler = async (route) => {
            switch (action) {
                case 'abort':
                    await route.abort(args.errorCode || 'blockedbyclient');
                    break;
                case 'fulfill':
                    await route.fulfill({
                        status: status || 200,
                        contentType: contentType || 'application/json',
                        body: typeof body === 'object' ? JSON.stringify(body) : (body || ''),
                        headers: headers || {},
                    });
                    break;
                case 'continue':
                    await route.continue({
                        url: args.overrideUrl,
                        headers: headers,
                        postData: args.postData,
                    });
                    break;
                case 'log':
                    const request = route.request();
                    console.error(`[RouteIntercept] ${request.method()} ${request.url()}`);
                    await route.continue();
                    break;
                default:
                    await route.continue();
            }
        };

        await this.page.route(urlPattern, handler);
        this._routeHandlers.set(urlPattern, handler);

        return {
            success: true,
            intercepted: urlPattern,
            action,
            message: `Route handler set for ${urlPattern}`,
        };
    };

    /**
     * Remove a route intercept
     */
    bridge.routeRemove = async function (args) {
        const { urlPattern } = args;

        const handler = this._routeHandlers.get(urlPattern);
        if (handler) {
            await this.page.unroute(urlPattern, handler);
            this._routeHandlers.delete(urlPattern);
            return { success: true, removed: urlPattern };
        }

        // Try to unroute anyway (may have been set externally)
        await this.page.unroute(urlPattern);
        return { success: true, removed: urlPattern, note: 'Handler not found in registry but unroute called' };
    };

    /**
     * List active route intercepts
     */
    bridge.routeList = async function () {
        return {
            routes: Array.from(this._routeHandlers.keys()),
            total: this._routeHandlers.size,
        };
    };

    /**
     * Wait for a specific network request/response
     */
    bridge.waitForRequest = async function (args) {
        const { urlPattern, method, timeout = 30000 } = args;

        const request = await this.page.waitForRequest(
            (req) => {
                const urlMatch = typeof urlPattern === 'string'
                    ? req.url().includes(urlPattern)
                    : true;
                const methodMatch = method ? req.method() === method.toUpperCase() : true;
                return urlMatch && methodMatch;
            },
            { timeout }
        );

        return {
            url: request.url(),
            method: request.method(),
            headers: request.headers(),
            postData: request.postData()?.substring(0, 1000),
            resourceType: request.resourceType(),
        };
    };

    /**
     * Wait for a specific response
     */
    bridge.waitForResponse = async function (args) {
        const { urlPattern, status, timeout = 30000 } = args;

        const response = await this.page.waitForResponse(
            (res) => {
                const urlMatch = typeof urlPattern === 'string'
                    ? res.url().includes(urlPattern)
                    : true;
                const statusMatch = status ? res.status() === status : true;
                return urlMatch && statusMatch;
            },
            { timeout }
        );

        let body = null;
        try {
            body = await response.text();
            if (body.length > 5000) body = body.substring(0, 5000) + '... (truncated)';
        } catch (e) { /* binary response */ }

        return {
            url: response.url(),
            status: response.status(),
            statusText: response.statusText(),
            headers: response.headers(),
            body,
        };
    };

    // ═══════════════════════════════════════════════════
    // STORAGE ACCESS (localStorage, sessionStorage, IndexedDB)
    // ═══════════════════════════════════════════════════

    /**
     * Get localStorage items
     */
    bridge.getLocalStorage = async function (args = {}) {
        const { key } = args;

        const result = await this.page.evaluate((k) => {
            if (k) {
                return { [k]: localStorage.getItem(k) };
            }
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                items[key] = localStorage.getItem(key);
            }
            return items;
        }, key);

        return { storage: 'localStorage', items: result, count: Object.keys(result).length };
    };

    /**
     * Set localStorage item
     */
    bridge.setLocalStorage = async function (args) {
        const { key, value } = args;
        await this.page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value });
        return { success: true, key, storage: 'localStorage' };
    };

    /**
     * Remove localStorage item(s)
     */
    bridge.removeLocalStorage = async function (args) {
        const { key, clearAll = false } = args;
        if (clearAll) {
            await this.page.evaluate(() => localStorage.clear());
            return { success: true, cleared: 'all', storage: 'localStorage' };
        }
        await this.page.evaluate((k) => localStorage.removeItem(k), key);
        return { success: true, removed: key, storage: 'localStorage' };
    };

    /**
     * Get sessionStorage items
     */
    bridge.getSessionStorage = async function (args = {}) {
        const { key } = args;

        const result = await this.page.evaluate((k) => {
            if (k) {
                return { [k]: sessionStorage.getItem(k) };
            }
            const items = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                items[key] = sessionStorage.getItem(key);
            }
            return items;
        }, key);

        return { storage: 'sessionStorage', items: result, count: Object.keys(result).length };
    };

    /**
     * Set sessionStorage item
     */
    bridge.setSessionStorage = async function (args) {
        const { key, value } = args;
        await this.page.evaluate(({ k, v }) => sessionStorage.setItem(k, v), { k: key, v: value });
        return { success: true, key, storage: 'sessionStorage' };
    };

    /**
     * Remove sessionStorage item(s)
     */
    bridge.removeSessionStorage = async function (args) {
        const { key, clearAll = false } = args;
        if (clearAll) {
            await this.page.evaluate(() => sessionStorage.clear());
            return { success: true, cleared: 'all', storage: 'sessionStorage' };
        }
        await this.page.evaluate((k) => sessionStorage.removeItem(k), key);
        return { success: true, removed: key, storage: 'sessionStorage' };
    };

    /**
     * Query IndexedDB
     */
    bridge.queryIndexedDB = async function (args) {
        const { dbName, storeName, action = 'list', key, value, limit = 100 } = args;

        const result = await this.page.evaluate(
            async ({ db, store, act, k, v, lim }) => {
                return new Promise((resolve, reject) => {
                    // List databases
                    if (act === 'listDatabases') {
                        if (indexedDB.databases) {
                            indexedDB.databases().then(dbs => {
                                resolve({ databases: dbs.map(d => ({ name: d.name, version: d.version })) });
                            });
                        } else {
                            resolve({ databases: [], note: 'indexedDB.databases() not supported' });
                        }
                        return;
                    }

                    const request = indexedDB.open(db);
                    request.onerror = () => reject(new Error('Failed to open DB: ' + db));
                    request.onsuccess = () => {
                        const database = request.result;

                        if (act === 'listStores') {
                            const storeNames = Array.from(database.objectStoreNames);
                            database.close();
                            resolve({ stores: storeNames });
                            return;
                        }

                        try {
                            const tx = database.transaction(store, act === 'put' || act === 'delete' ? 'readwrite' : 'readonly');
                            const objectStore = tx.objectStore(store);

                            switch (act) {
                                case 'get':
                                    const getReq = objectStore.get(k);
                                    getReq.onsuccess = () => resolve({ value: getReq.result });
                                    break;
                                case 'getAll':
                                    const getAllReq = objectStore.getAll(null, lim);
                                    getAllReq.onsuccess = () => resolve({ values: getAllReq.result, count: getAllReq.result.length });
                                    break;
                                case 'put':
                                    objectStore.put(JSON.parse(v), k);
                                    tx.oncomplete = () => resolve({ success: true });
                                    break;
                                case 'delete':
                                    objectStore.delete(k);
                                    tx.oncomplete = () => resolve({ success: true });
                                    break;
                                case 'count':
                                    const countReq = objectStore.count();
                                    countReq.onsuccess = () => resolve({ count: countReq.result });
                                    break;
                                default:
                                    resolve({ error: 'Unknown action: ' + act });
                            }

                            tx.onerror = () => reject(new Error('Transaction failed'));
                        } catch (e) {
                            database.close();
                            reject(e);
                        }
                    };
                });
            },
            { db: dbName, store: storeName, act: action, k: key, v: typeof value === 'object' ? JSON.stringify(value) : value, lim: limit }
        );

        return result;
    };

    // ═══════════════════════════════════════════════════
    // MULTI-CONTEXT & INCOGNITO
    // ═══════════════════════════════════════════════════

    /** @type {Map<string, { context, pages }>} Named browser contexts */
    bridge._contexts = new Map();

    /**
     * Create a new browser context (incognito-like isolation)
     */
    bridge.createContext = async function (args = {}) {
        const { name, options = {} } = args;

        const contextName = name || `context-${this._contexts.size + 1}`;

        const context = await this.browser.newContext({
            viewport: options.viewport || this.config.viewport,
            userAgent: options.userAgent,
            locale: options.locale,
            timezoneId: options.timezoneId,
            geolocation: options.geolocation,
            permissions: options.permissions,
            colorScheme: options.colorScheme,
            storageState: options.storageState,
            ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? true,
        });

        const page = await context.newPage();
        page.setDefaultTimeout(this.config.timeout);

        // Attach event listeners
        this._attachEventListeners(page);

        this._contexts.set(contextName, { context, pages: [page] });

        return {
            success: true,
            name: contextName,
            message: `Context "${contextName}" created with isolated storage/cookies`,
        };
    };

    /**
     * Switch active page to a different context
     */
    bridge.switchContext = async function (args) {
        const { name } = args;

        const ctx = this._contexts.get(name);
        if (!ctx) {
            throw new Error(`Context "${name}" not found. Available: ${Array.from(this._contexts.keys()).join(', ')}`);
        }

        this.context = ctx.context;
        this.page = ctx.pages[0]; // Switch to first page in context
        await this.page.bringToFront();

        return { success: true, switched: name };
    };

    /**
     * List all contexts
     */
    bridge.listContexts = async function () {
        const contexts = [
            { name: 'default', pages: this.browser.contexts()[0]?.pages().length || 0, isActive: true },
        ];
        for (const [name, ctx] of this._contexts) {
            contexts.push({
                name,
                pages: ctx.pages.length,
                isActive: this.context === ctx.context,
            });
        }
        return { contexts };
    };

    /**
     * Close a named context
     */
    bridge.closeContext = async function (args) {
        const { name } = args;
        const ctx = this._contexts.get(name);
        if (ctx) {
            await ctx.context.close();
            this._contexts.delete(name);
            return { success: true, closed: name };
        }
        return { success: false, error: `Context "${name}" not found` };
    };

    // ═══════════════════════════════════════════════════
    // VISUAL TESTING (Screenshot Comparison)
    // ═══════════════════════════════════════════════════

    /**
     * Take a baseline screenshot for visual comparison
     */
    bridge.screenshotBaseline = async function (args) {
        const { name, selector, fullPage = false, dir = './visual-baselines' } = args;

        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${name}.png`);

        const options = { path: filePath, fullPage };
        if (selector) {
            const element = await this.page.$(selector);
            if (element) {
                await element.screenshot({ path: filePath });
            } else {
                throw new Error(`Element not found: ${selector}`);
            }
        } else {
            await this.page.screenshot(options);
        }

        // Compute hash for change detection
        const buffer = await readFile(filePath);
        const hash = createHash('sha256').update(buffer).digest('hex');

        return {
            success: true,
            baseline: filePath,
            hash,
            size: buffer.length,
        };
    };

    /**
     * Compare current screenshot against baseline
     */
    bridge.screenshotCompare = async function (args) {
        const { name, selector, fullPage = false, dir = './visual-baselines', threshold = 0.01 } = args;

        const baselinePath = path.join(dir, `${name}.png`);

        if (!existsSync(baselinePath)) {
            return { match: false, error: 'Baseline not found. Take a baseline first.', baselinePath };
        }

        // Take current screenshot to buffer
        let currentBuffer;
        if (selector) {
            const element = await this.page.$(selector);
            if (!element) throw new Error(`Element not found: ${selector}`);
            currentBuffer = await element.screenshot();
        } else {
            currentBuffer = await this.page.screenshot({ fullPage });
        }

        const baselineBuffer = await readFile(baselinePath);

        // Quick byte-level comparison
        const currentHash = createHash('sha256').update(currentBuffer).digest('hex');
        const baselineHash = createHash('sha256').update(baselineBuffer).digest('hex');

        if (currentHash === baselineHash) {
            return {
                match: true,
                identical: true,
                message: 'Screenshots are pixel-perfect identical',
            };
        }

        // Save diff for manual review
        const diffPath = path.join(dir, `${name}-diff.png`);
        await writeFile(diffPath, currentBuffer);

        // Size comparison as proxy for significant change
        const sizeDiff = Math.abs(currentBuffer.length - baselineBuffer.length) / baselineBuffer.length;

        return {
            match: sizeDiff < threshold,
            identical: false,
            sizeDifference: `${(sizeDiff * 100).toFixed(2)}%`,
            diffPath,
            currentHash,
            baselineHash,
            note: 'Pixel-level diff requires external image comparison library. Hash and size comparison provided.',
        };
    };

    // ═══════════════════════════════════════════════════
    // VIDEO RECORDING
    // ═══════════════════════════════════════════════════

    /**
     * Start video recording (must create a new context with video enabled)
     */
    bridge.startVideoRecording = async function (args = {}) {
        const { dir = './videos', width, height } = args;

        await mkdir(dir, { recursive: true });

        // Create a new context with video recording enabled
        const videoContext = await this.browser.newContext({
            viewport: this.config.viewport,
            recordVideo: {
                dir,
                size: {
                    width: width || this.config.viewport.width,
                    height: height || this.config.viewport.height,
                },
            },
        });

        const videoPage = await videoContext.newPage();
        videoPage.setDefaultTimeout(this.config.timeout);
        this._attachEventListeners(videoPage);

        // Store for later stop
        this._videoContext = videoContext;
        this._videoPage = videoPage;

        // Navigate to current URL
        const currentUrl = this.page.url();
        if (currentUrl && currentUrl !== 'about:blank') {
            await videoPage.goto(currentUrl);
        }

        return {
            success: true,
            recording: true,
            dir,
            message: 'Video recording started. Use stopVideoRecording to save.',
        };
    };

    /**
     * Stop video recording and get the video file path
     */
    bridge.stopVideoRecording = async function () {
        if (!this._videoContext || !this._videoPage) {
            return { success: false, error: 'No active video recording' };
        }

        const video = this._videoPage.video();
        let videoPath = null;

        if (video) {
            videoPath = await video.path();
        }

        await this._videoPage.close();
        await this._videoContext.close();

        this._videoPage = null;
        this._videoContext = null;

        return {
            success: true,
            recording: false,
            videoPath,
        };
    };

    // ═══════════════════════════════════════════════════
    // AUTH / SESSION PERSISTENCE (storageState)
    // ═══════════════════════════════════════════════════

    /**
     * Save current auth/session state (cookies + localStorage)
     */
    bridge.saveAuthState = async function (args = {}) {
        const { filePath = './auth-state.json' } = args;

        const state = await this.context.storageState({ path: filePath });

        return {
            success: true,
            filePath,
            cookies: state.cookies?.length || 0,
            origins: state.origins?.length || 0,
        };
    };

    /**
     * Load auth/session state into a new context
     */
    bridge.loadAuthState = async function (args = {}) {
        const { filePath = './auth-state.json' } = args;

        if (!existsSync(filePath)) {
            return { success: false, error: `Auth state file not found: ${filePath}` };
        }

        // Create new context with saved state
        const context = await this.browser.newContext({
            storageState: filePath,
            viewport: this.config.viewport,
        });

        const page = await context.newPage();
        page.setDefaultTimeout(this.config.timeout);
        this._attachEventListeners(page);

        // Replace current context
        const oldContext = this.context;
        this.context = context;
        this.page = page;

        // Close old context
        try { await oldContext.close(); } catch (e) { /* ignore */ }

        return {
            success: true,
            loaded: filePath,
            message: 'Auth state loaded into new context',
        };
    };

    // ═══════════════════════════════════════════════════
    // ACCESSIBILITY AUDIT
    // ═══════════════════════════════════════════════════

    /**
     * Run accessibility audit using the browser's built-in accessibility tree
     */
    bridge.accessibilityAudit = async function (args = {}) {
        const { selector } = args;

        let snapshot;
        if (selector) {
            const element = await this.page.$(selector);
            if (!element) throw new Error(`Element not found: ${selector}`);
            snapshot = await this.page.accessibility.snapshot({ root: element });
        } else {
            snapshot = await this.page.accessibility.snapshot();
        }

        // Analyze for common issues
        const issues = [];
        const walkTree = (node, depth = 0) => {
            if (!node) return;

            // Check for missing names on interactive elements
            const interactiveRoles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab'];
            if (interactiveRoles.includes(node.role) && !node.name) {
                issues.push({
                    severity: 'error',
                    rule: 'missing-label',
                    message: `${node.role} element has no accessible name`,
                    role: node.role,
                });
            }

            // Check for images without alt text
            if (node.role === 'img' && !node.name) {
                issues.push({
                    severity: 'error',
                    rule: 'img-alt',
                    message: 'Image has no alt text',
                    role: node.role,
                });
            }

            // Check for headings with no text
            if (node.role === 'heading' && !node.name) {
                issues.push({
                    severity: 'warning',
                    rule: 'empty-heading',
                    message: 'Empty heading element',
                    role: node.role,
                    level: node.level,
                });
            }

            // Recurse into children
            if (node.children) {
                for (const child of node.children) {
                    walkTree(child, depth + 1);
                }
            }
        };

        walkTree(snapshot);

        // Also check via DOM evaluation for additional issues
        const domIssues = await this.page.evaluate(() => {
            const issues = [];

            // Check for missing lang attribute
            if (!document.documentElement.lang) {
                issues.push({ severity: 'error', rule: 'html-lang', message: 'HTML element missing lang attribute' });
            }

            // Check for missing page title
            if (!document.title) {
                issues.push({ severity: 'error', rule: 'document-title', message: 'Page has no title' });
            }

            // Check for tabindex > 0
            document.querySelectorAll('[tabindex]').forEach(el => {
                if (parseInt(el.getAttribute('tabindex')) > 0) {
                    issues.push({
                        severity: 'warning',
                        rule: 'tabindex-positive',
                        message: `Element has positive tabindex: ${el.tagName}`,
                    });
                }
            });

            // Check for missing form labels
            document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select').forEach(el => {
                const id = el.id;
                const ariaLabel = el.getAttribute('aria-label');
                const ariaLabelledBy = el.getAttribute('aria-labelledby');
                const hasLabel = id && document.querySelector(`label[for="${id}"]`);

                if (!ariaLabel && !ariaLabelledBy && !hasLabel && !el.getAttribute('title')) {
                    issues.push({
                        severity: 'error',
                        rule: 'label',
                        message: `Form element missing label: ${el.tagName}[type=${el.type || 'text'}]`,
                    });
                }
            });

            // Check color contrast (approximate check for text elements)
            // Full contrast check requires more complex analysis
            const contrastWarnings = [];
            document.querySelectorAll('body *').forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.color === style.backgroundColor && el.textContent?.trim()) {
                    contrastWarnings.push({
                        severity: 'warning',
                        rule: 'color-contrast',
                        message: `Potential contrast issue: ${el.tagName}`,
                    });
                }
            });
            // Only report first 5 contrast issues
            issues.push(...contrastWarnings.slice(0, 5));

            return issues;
        });

        return {
            snapshot,
            issues: [...issues, ...domIssues],
            issueCount: issues.length + domIssues.length,
            errors: [...issues, ...domIssues].filter(i => i.severity === 'error').length,
            warnings: [...issues, ...domIssues].filter(i => i.severity === 'warning').length,
        };
    };

    // ═══════════════════════════════════════════════════
    // GEOLOCATION & PERMISSIONS
    // ═══════════════════════════════════════════════════

    /**
     * Set geolocation
     */
    bridge.setGeolocation = async function (args) {
        const { latitude, longitude, accuracy = 100 } = args;

        await this.context.setGeolocation({ latitude, longitude, accuracy });
        await this.context.grantPermissions(['geolocation']);

        return { success: true, latitude, longitude, accuracy };
    };

    /**
     * Grant browser permissions
     */
    bridge.grantPermissions = async function (args) {
        const { permissions, origin } = args;
        // Supported: 'geolocation', 'midi', 'midi-sysex', 'notifications', 'camera', 'microphone', etc.
        await this.context.grantPermissions(permissions, { origin });
        return { success: true, granted: permissions, origin };
    };

    /**
     * Clear granted permissions
     */
    bridge.clearPermissions = async function () {
        await this.context.clearPermissions();
        return { success: true, message: 'All permissions cleared' };
    };

    /**
     * Set timezone
     */
    bridge.setTimezone = async function (args) {
        const { timezoneId } = args;
        // Timezone must be set at context creation; we create a new context
        const context = await this.browser.newContext({
            viewport: this.config.viewport,
            timezoneId,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(this.config.timeout);
        this._attachEventListeners(page);

        const currentUrl = this.page.url();
        const oldContext = this.context;
        this.context = context;
        this.page = page;

        if (currentUrl && currentUrl !== 'about:blank') {
            await this.page.goto(currentUrl);
        }

        try { await oldContext.close(); } catch (e) { /* ignore */ }

        return { success: true, timezoneId };
    };

    /**
     * Set locale
     */
    bridge.setLocale = async function (args) {
        const { locale } = args;
        const context = await this.browser.newContext({
            viewport: this.config.viewport,
            locale,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(this.config.timeout);
        this._attachEventListeners(page);

        const currentUrl = this.page.url();
        const oldContext = this.context;
        this.context = context;
        this.page = page;

        if (currentUrl && currentUrl !== 'about:blank') {
            await this.page.goto(currentUrl);
        }

        try { await oldContext.close(); } catch (e) { /* ignore */ }

        return { success: true, locale };
    };

    // ═══════════════════════════════════════════════════
    // DOWNLOAD MANAGEMENT
    // ═══════════════════════════════════════════════════

    /**
     * List downloaded files from the most recent downloads
     */
    bridge.listDownloads = async function () {
        // Playwright tracks downloads per context
        // We track them via event listener
        return {
            downloads: this._downloads || [],
            total: (this._downloads || []).length,
        };
    };

    /**
     * Trigger a download and save it
     */
    bridge.triggerDownload = async function (args) {
        const { selector, savePath, timeout = 30000 } = args;

        const [download] = await Promise.all([
            this.page.waitForEvent('download', { timeout }),
            this.page.click(selector),
        ]);

        const suggestedFilename = download.suggestedFilename();
        const finalPath = savePath || path.join('./downloads', suggestedFilename);

        await mkdir(path.dirname(finalPath), { recursive: true });
        await download.saveAs(finalPath);

        return {
            success: true,
            filename: suggestedFilename,
            path: finalPath,
        };
    };

    // ═══════════════════════════════════════════════════
    // DOM MUTATION OBSERVATION
    // ═══════════════════════════════════════════════════

    /**
     * Start observing DOM mutations
     */
    bridge.observeMutations = async function (args = {}) {
        const { selector = 'body', attributes = true, childList = true, subtree = true, characterData = true, limit = 100 } = args;

        await this.page.evaluate(({ sel, opts, maxMutations }) => {
            // Clean up any existing observer
            if (window.__mcpMutationObserver) {
                window.__mcpMutationObserver.disconnect();
            }
            window.__mcpMutations = [];

            const target = document.querySelector(sel);
            if (!target) return;

            window.__mcpMutationObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const entry = {
                        type: mutation.type,
                        target: mutation.target.tagName + (mutation.target.id ? '#' + mutation.target.id : ''),
                        timestamp: Date.now(),
                    };

                    if (mutation.type === 'attributes') {
                        entry.attributeName = mutation.attributeName;
                        entry.oldValue = mutation.oldValue;
                        entry.newValue = mutation.target.getAttribute(mutation.attributeName);
                    } else if (mutation.type === 'childList') {
                        entry.addedNodes = mutation.addedNodes.length;
                        entry.removedNodes = mutation.removedNodes.length;
                    } else if (mutation.type === 'characterData') {
                        entry.oldValue = mutation.oldValue;
                        entry.newValue = mutation.target.textContent?.substring(0, 200);
                    }

                    window.__mcpMutations.push(entry);
                    if (window.__mcpMutations.length > maxMutations) {
                        window.__mcpMutations.shift();
                    }
                }
            });

            window.__mcpMutationObserver.observe(target, {
                attributes: opts.attributes,
                childList: opts.childList,
                subtree: opts.subtree,
                characterData: opts.characterData,
                attributeOldValue: true,
                characterDataOldValue: true,
            });
        }, { sel: selector, opts: { attributes, childList, subtree, characterData }, maxMutations: limit });

        return { success: true, observing: selector };
    };

    /**
     * Get observed DOM mutations
     */
    bridge.getMutations = async function (args = {}) {
        const { clear = false } = args;

        const mutations = await this.page.evaluate((doClear) => {
            const result = window.__mcpMutations || [];
            if (doClear) window.__mcpMutations = [];
            return result;
        }, clear);

        return { mutations, total: mutations.length };
    };

    /**
     * Stop observing DOM mutations
     */
    bridge.stopMutationObserver = async function () {
        await this.page.evaluate(() => {
            if (window.__mcpMutationObserver) {
                window.__mcpMutationObserver.disconnect();
                window.__mcpMutationObserver = null;
            }
        });
        return { success: true, message: 'Mutation observer stopped' };
    };
}
