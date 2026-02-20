/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * PLAYWRIGHT DIRECT BRIDGE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Direct integration with Playwright (no subprocess spawning)
 * This solves the timeout issues by using Playwright's API directly.
 * 
 * ENHANCED: Now includes 55+ additional methods from Playwright cheatsheet
 * for deep application exploration and accurate selector generation.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { chromium, firefox, webkit } from 'playwright';
import { EventEmitter } from 'events';
import { applyEnhancedMethods } from './enhanced-playwright-methods.js';
import { applyAdvancedMethods } from './advanced-playwright-methods.js';
import { SelectorEngine } from '../utils/selector-engine.js';

/**
 * Direct Playwright Bridge - Uses Playwright library directly
 * Enhanced with deep exploration capabilities
 */
export class PlaywrightDirectBridge extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            headless: config.headless ?? (process.env.MCP_HEADLESS !== 'false'),
            browser: config.browser ?? process.env.MCP_BROWSER ?? 'chromium',
            viewport: config.viewport ?? { width: 1280, height: 720 },
            timeout: config.timeout ?? (parseInt(process.env.MCP_TIMEOUT) || 30000),
            ...config,
        };

        this.browser = null;
        this.context = null;
        this.page = null;
        this.connected = false;
        this.snapshotRefs = new Map(); // Store element references from snapshots

        // Storage for multi-page and download handling
        this._lastNewPage = null;
        this._lastDownload = null;

        // Event capture storage (ring buffers with configurable max size)
        this._consoleMessages = [];
        this._networkRequests = new Map();
        this._pageErrors = [];
        this._dialogs = [];
        this._maxConsoleMessages = config.maxConsoleMessages ?? 1000;
        this._maxNetworkRequests = config.maxNetworkRequests ?? 500;
        this._maxPageErrors = config.maxPageErrors ?? 100;
        this._captureConsole = config.captureConsole ?? true;
        this._captureNetwork = config.captureNetwork ?? true;

        // Apply enhanced methods from Playwright cheatsheet
        applyEnhancedMethods(this);

        // Apply advanced methods (iframe, shadow DOM, network interception, storage, etc.)
        applyAdvancedMethods(this);
    }

    /**
     * Check if bridge is connected
     */
    isConnected() {
        return this.connected && this.browser !== null;
    }

    /**
     * Connect/Launch browser
     */
    async connect() {
        if (this.connected) {
            console.error('[PlaywrightDirect] Already connected');
            return;
        }

        console.error(`[PlaywrightDirect] Launching ${this.config.browser}...`);

        try {
            // Select browser type
            const browserType = {
                chromium: chromium,
                firefox: firefox,
                webkit: webkit,
            }[this.config.browser] || chromium;

            // Launch browser
            this.browser = await browserType.launch({
                headless: this.config.headless,
            });

            // Create context with viewport
            this.context = await this.browser.newContext({
                viewport: this.config.viewport,
            });

            // Create initial page
            this.page = await this.context.newPage();
            this.page.setDefaultTimeout(this.config.timeout);

            // Attach event listeners for console, network, errors
            this._attachEventListeners(this.page);

            this.connected = true;
            console.error('[PlaywrightDirect] Browser launched successfully');
            console.error('[PlaywrightDirect] Enhanced tools available: 90+ capabilities');
            console.error('[PlaywrightDirect] Event capture: console=' + this._captureConsole + ' network=' + this._captureNetwork);
        } catch (error) {
            console.error('[PlaywrightDirect] Failed to launch browser:', error.message);
            throw error;
        }
    }

    /**
     * Attach event listeners for console messages, network requests, page errors, and dialogs.
     * Called on initial page and should be called on any new page (tab) that is tracked.
     */
    _attachEventListeners(page) {
        if (!page) return;

        // ── Console Messages ──
        if (this._captureConsole) {
            page.on('console', (msg) => {
                const entry = {
                    type: msg.type(),           // 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace'
                    text: msg.text(),
                    location: msg.location(),    // { url, lineNumber, columnNumber }
                    timestamp: Date.now(),
                };
                this._consoleMessages.push(entry);
                // Ring buffer: evict oldest when over capacity
                if (this._consoleMessages.length > this._maxConsoleMessages) {
                    this._consoleMessages.shift();
                }
                this.emit('console', entry);
            });
        }

        // ── Page Errors (uncaught exceptions) ──
        page.on('pageerror', (error) => {
            const entry = {
                message: error.message,
                stack: error.stack,
                timestamp: Date.now(),
            };
            this._pageErrors.push(entry);
            if (this._pageErrors.length > this._maxPageErrors) {
                this._pageErrors.shift();
            }
            this.emit('pageerror', entry);
        });

        // ── Network Requests ──
        if (this._captureNetwork) {
            page.on('request', (request) => {
                const id = request.url() + '|' + Date.now() + '|' + Math.random().toString(36).slice(2, 8);
                const entry = {
                    id,
                    url: request.url(),
                    method: request.method(),
                    headers: request.headers(),
                    postData: request.postData(),
                    resourceType: request.resourceType(),
                    timestamp: Date.now(),
                    status: null,
                    responseHeaders: null,
                    responseBody: null,
                    duration: null,
                    failure: null,
                };
                this._networkRequests.set(id, entry);
                // Ring buffer for Map
                if (this._networkRequests.size > this._maxNetworkRequests) {
                    const firstKey = this._networkRequests.keys().next().value;
                    this._networkRequests.delete(firstKey);
                }
                // Tag request with id for response matching
                request.__mcpId = id;
            });

            page.on('response', (response) => {
                const request = response.request();
                const id = request.__mcpId;
                if (id && this._networkRequests.has(id)) {
                    const entry = this._networkRequests.get(id);
                    entry.status = response.status();
                    entry.statusText = response.statusText();
                    entry.responseHeaders = response.headers();
                    entry.duration = Date.now() - entry.timestamp;
                    this.emit('response', entry);
                }
            });

            page.on('requestfailed', (request) => {
                const id = request.__mcpId;
                if (id && this._networkRequests.has(id)) {
                    const entry = this._networkRequests.get(id);
                    entry.failure = request.failure()?.errorText || 'Unknown failure';
                    entry.duration = Date.now() - entry.timestamp;
                    this.emit('requestfailed', entry);
                }
            });
        }

        // ── Dialogs (alert, confirm, prompt, beforeunload) ──
        page.on('dialog', (dialog) => {
            const entry = {
                type: dialog.type(),
                message: dialog.message(),
                defaultValue: dialog.defaultValue(),
                timestamp: Date.now(),
            };
            this._dialogs.push(entry);
            this.emit('dialog', entry);
        });
    }

    /**
     * Ensure connected before operations
     */
    async ensureConnected() {
        // Check actual browser/page health, not just the boolean flag.
        // If the browser crashed mid-session (OOM, user closed window in headed mode),
        // this.connected is still true but the page object is dead.
        if (this.connected) {
            const browserAlive = this.browser && this.browser.isConnected();
            const pageAlive = this.page && !this.page.isClosed();
            if (!browserAlive || !pageAlive) {
                console.error('[PlaywrightDirect] Browser/page is dead — reconnecting...');
                // Reset stale state
                this.browser = null;
                this.context = null;
                this.page = null;
                this.connected = false;
            }
        }
        if (!this.connected) {
            await this.connect();
        }
    }

    /**
     * Call a tool by name
     * Note: Enhanced methods are injected by applyEnhancedMethods() and override this
     */
    async callTool(toolName, args = {}) {
        await this.ensureConnected();

        console.error(`[PlaywrightDirect] Calling tool: ${toolName}`);

        // Map tool names to methods
        const toolMap = {
            'browser_navigate': () => this.navigate(args),
            'browser_navigate_back': () => this.navigateBack(),
            'browser_snapshot': () => this.snapshot(args),
            'browser_click': () => this.click(args),
            'browser_type': () => this.type(args),
            'browser_hover': () => this.hover(args),
            'browser_drag': () => this.drag(args),
            'browser_select_option': () => this.selectOption(args),
            'browser_fill_form': () => this.fillForm(args),
            'browser_wait_for': () => this.waitFor(args),
            'browser_tabs': () => this.manageTabs(args),
            'browser_evaluate': () => this.evaluate(args),
            'browser_run_code': () => this.runCode(args),
            'browser_console_messages': () => this.getConsoleMessages(args),
            'browser_network_requests': () => this.getNetworkRequests(args),
            'browser_page_errors': () => this.getPageErrors(args),
            'browser_install': () => this.install(),
            'browser_press_key': () => this.pressKey(args),
            'browser_screenshot': () => this.screenshot(args),
            'browser_take_screenshot': () => this.screenshot(args),  // Alias for unified_screenshot mapping
            'browser_close': () => this.close(),
            'browser_file_upload': () => this.fileUpload(args),
            'browser_handle_dialog': () => this.handleDialog(args),
            'browser_resize': () => this.resize(args),
            'browser_generate_locator': () => this.generateLocator(args),
            'browser_verify_element_visible': () => this.verifyElementVisible(args),
            'browser_verify_text_visible': () => this.verifyTextVisible(args),
            'browser_verify_value': () => this.verifyValue(args),
            'browser_pdf_save': () => this.savePdf(args),
            'browser_mouse_click_xy': () => this.mouseClickXY(args),
            'browser_mouse_move_xy': () => this.mouseMoveXY(args),
            'browser_mouse_drag_xy': () => this.mouseDragXY(args),
            'browser_mouse_wheel': () => this.mouseWheel(args),

            // ── Advanced: Iframe ──
            'browser_list_frames': () => this.listFrames(),
            'browser_switch_to_frame': () => this.switchToFrame(args),
            'browser_switch_to_main_frame': () => this.switchToMainFrame(),
            'browser_frame_action': () => this.frameAction(args),

            // ── Advanced: Shadow DOM ──
            'browser_shadow_dom_query': () => this.shadowDomQuery(args),
            'browser_shadow_pierce': () => this.shadowPierce(args),

            // ── Advanced: Network Interception ──
            'browser_route_intercept': () => this.routeIntercept(args),
            'browser_route_remove': () => this.routeRemove(args),
            'browser_route_list': () => this.routeList(),
            'browser_wait_for_request': () => this.waitForRequest(args),
            'browser_wait_for_response': () => this.waitForResponse(args),

            // ── Advanced: Storage ──
            'browser_get_local_storage': () => this.getLocalStorage(args),
            'browser_set_local_storage': () => this.setLocalStorage(args),
            'browser_remove_local_storage': () => this.removeLocalStorage(args),
            'browser_get_session_storage': () => this.getSessionStorage(args),
            'browser_set_session_storage': () => this.setSessionStorage(args),
            'browser_remove_session_storage': () => this.removeSessionStorage(args),
            'browser_query_indexeddb': () => this.queryIndexedDB(args),

            // ── Advanced: Multi-Context ──
            'browser_create_context': () => this.createContext(args),
            'browser_switch_context': () => this.switchContext(args),
            'browser_list_contexts': () => this.listContexts(),
            'browser_close_context': () => this.closeContext(args),

            // ── Advanced: Visual Testing ──
            'browser_screenshot_baseline': () => this.screenshotBaseline(args),
            'browser_screenshot_compare': () => this.screenshotCompare(args),

            // ── Advanced: Video Recording ──
            'browser_start_video': () => this.startVideoRecording(args),
            'browser_stop_video': () => this.stopVideoRecording(),

            // ── Advanced: Auth Persistence ──
            'browser_save_auth_state': () => this.saveAuthState(args),
            'browser_load_auth_state': () => this.loadAuthState(args),

            // ── Advanced: Accessibility ──
            'browser_accessibility_audit': () => this.accessibilityAudit(args),

            // ── Advanced: Geolocation & Permissions ──
            'browser_set_geolocation': () => this.setGeolocation(args),
            'browser_grant_permissions': () => this.grantPermissions(args),
            'browser_clear_permissions': () => this.clearPermissions(),
            'browser_set_timezone': () => this.setTimezone(args),
            'browser_set_locale': () => this.setLocale(args),

            // ── Advanced: Downloads ──
            'browser_list_downloads': () => this.listDownloads(),
            'browser_trigger_download': () => this.triggerDownload(args),

            // ── Advanced: DOM Mutations ──
            'browser_observe_mutations': () => this.observeMutations(args),
            'browser_get_mutations': () => this.getMutations(args),
            'browser_stop_mutation_observer': () => this.stopMutationObserver(),
        };

        const handler = toolMap[toolName];
        if (!handler) {
            throw new Error(`Unknown Playwright tool: ${toolName}`);
        }

        return await handler();
    }

    /**
     * Navigate to URL
     */
    async navigate(args) {
        const { url, waitUntil = 'load' } = args;
        console.error(`[PlaywrightDirect] Navigating to: ${url}`);

        await this.page.goto(url, { waitUntil });
        return { success: true, url: this.page.url(), title: await this.page.title() };
    }

    /**
     * Navigate back
     */
    async navigateBack() {
        await this.page.goBack();
        return { success: true, url: this.page.url() };
    }

    /**
     * Take accessibility snapshot
     */
    async snapshot(args = {}) {
        const { verbose = true } = args;

        console.error('[PlaywrightDirect] Taking accessibility snapshot...');

        // Ensure page is available and ready
        if (!this.page) {
            throw new Error('No page available. Please navigate to a URL first.');
        }

        // Get ARIA snapshot using modern Playwright API (page.accessibility was removed in 1.41+)
        let ariaTree = null;
        try {
            ariaTree = await this.page.locator('body').ariaSnapshot({ timeout: 10000 });
        } catch (ariaError) {
            console.error('[PlaywrightDirect] ARIA snapshot failed:', ariaError.message);
            // Continue without ARIA tree - element extraction will still work
        }

        // Phase 1: Enriched DOM walk — captures all attributes the SelectorEngine needs
        const enrichedDomWalkerSource = SelectorEngine.getEnrichedDomWalkerSource();
        const elements = await this.page.evaluate(enrichedDomWalkerSource);

        // Phase 2: Uniqueness validation — count how many DOM nodes each candidate CSS selector matches
        let matchCounts = {};
        try {
            const validationScript = SelectorEngine.getUniquenessValidationScript(elements);
            matchCounts = await this.page.evaluate(validationScript);
        } catch (valError) {
            console.error('[PlaywrightDirect] Uniqueness validation failed (non-fatal):', valError.message);
        }

        // Phase 3: Score & rank selectors per element
        const enrichedElements = SelectorEngine.processSnapshotElements(elements, matchCounts);

        // Store refs for later use (click, type, hover, etc.)
        this.snapshotRefs.clear();
        for (const el of enrichedElements) {
            this.snapshotRefs.set(el.ref, el);
        }

        return {
            ariaTree: ariaTree,
            elements: enrichedElements,
            url: this.page.url(),
            title: await this.page.title(),
        };
    }

    /**
     * Click element
     */
    async click(args) {
        const { element, ref, description } = args;

        let selector;
        if (ref) {
            // Use SelectorEngine for consistent, ranked selector resolution
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else if (element) {
            selector = element;
        } else if (description) {
            selector = `text=${description}`;
        }

        console.error(`[PlaywrightDirect] Clicking: ${selector}`);
        await this.page.click(selector);
        return { success: true, clicked: selector };
    }

    /**
     * Type text
     */
    async type(args) {
        const { element, ref, text, clear = false } = args;

        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        console.error(`[PlaywrightDirect] Typing into: ${selector}`);

        if (clear) {
            await this.page.fill(selector, '');
        }
        await this.page.type(selector, text);
        return { success: true, typed: text, into: selector };
    }

    /**
     * Hover over element
     */
    async hover(args) {
        const { element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        await this.page.hover(selector);
        return { success: true, hovered: selector };
    }

    /**
     * Drag element
     */
    async drag(args) {
        const { source, target, sourceRef, targetRef } = args;
        let sourceSelector = source;
        let targetSelector = target;

        if (sourceRef) {
            const refData = this.snapshotRefs.get(sourceRef);
            if (refData) sourceSelector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Source ref "${sourceRef}" not found in snapshot.`);
        }
        if (targetRef) {
            const refData = this.snapshotRefs.get(targetRef);
            if (refData) targetSelector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Target ref "${targetRef}" not found in snapshot.`);
        }

        await this.page.dragAndDrop(sourceSelector, targetSelector);
        return { success: true, from: sourceSelector, to: targetSelector };
    }

    /**
     * Select option
     */
    async selectOption(args) {
        const { element, ref, value, label } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) selector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Element ref "${ref}" not found in snapshot.`);
        } else {
            selector = element;
        }

        const options = label ? { label } : { value };
        await this.page.selectOption(selector, options);
        return { success: true, selected: value || label };
    }

    /**
     * Fill form
     */
    async fillForm(args) {
        const { fields } = args;
        const results = [];

        for (const field of fields) {
            const { element, ref, value } = field;
            let selector;
            if (ref) {
                const refData = this.snapshotRefs.get(ref);
                if (refData) selector = SelectorEngine.resolveCssSelector(refData);
                else throw new Error(`Field ref "${ref}" not found in snapshot.`);
            } else {
                selector = element;
            }

            await this.page.fill(selector, value);
            results.push({ selector, value, success: true });
        }

        return { success: true, filled: results };
    }

    /**
     * Wait for condition
     */
    async waitFor(args) {
        const { text, selector, state, time } = args;

        if (time) {
            await this.page.waitForTimeout(time * 1000);
            return { success: true, waited: `${time} seconds` };
        }

        if (text) {
            await this.page.waitForSelector(`text=${text}`, { state: state || 'visible' });
            return { success: true, found: text };
        }

        if (selector) {
            await this.page.waitForSelector(selector, { state: state || 'visible' });
            return { success: true, found: selector };
        }

        return { success: false, error: 'No wait condition specified' };
    }

    /**
     * Manage tabs
     */
    async manageTabs(args) {
        const { action, index } = args;
        const pages = this.context.pages();

        switch (action) {
            case 'list':
                return {
                    tabs: pages.map((p, i) => ({
                        index: i,
                        url: p.url(),
                        active: p === this.page,
                    })),
                };

            case 'new':
                const newPage = await this.context.newPage();
                this._attachEventListeners(newPage);
                this.page = newPage;
                return { success: true, index: pages.length };

            case 'close':
                if (index !== undefined && pages[index]) {
                    await pages[index].close();
                    if (pages[index] === this.page) {
                        const fallbackPage = this.context.pages()[0] || await this.context.newPage();
                        if (fallbackPage !== pages[index]) {
                            this._attachEventListeners(fallbackPage);
                        }
                        this.page = fallbackPage;
                    }
                }
                return { success: true, closed: index };

            case 'select':
                if (index !== undefined && pages[index]) {
                    this.page = pages[index];
                    await this.page.bringToFront();
                }
                return { success: true, selected: index };

            default:
                return { error: `Unknown tab action: ${action}` };
        }
    }

    /**
     * Evaluate JavaScript
     */
    async evaluate(args) {
        const { script, expression } = args;
        const code = script || expression;

        const result = await this.page.evaluate(code);
        return { result };
    }

    /**
     * Run Playwright code
     */
    async runCode(args) {
        const { code } = args;

        // Execute the code with page context
        const fn = new Function('page', 'context', 'browser', `return (async () => { ${code} })()`);
        const result = await fn(this.page, this.context, this.browser);
        return { result };
    }

    /**
     * Get console messages (captured via event listeners)
     */
    async getConsoleMessages(args = {}) {
        const { type, limit, clear = false, since } = args;

        let messages = [...this._consoleMessages];

        // Filter by type if specified (log, error, warning, info, debug, trace)
        if (type) {
            messages = messages.filter(m => m.type === type);
        }

        // Filter by timestamp if specified
        if (since) {
            messages = messages.filter(m => m.timestamp >= since);
        }

        // Apply limit (return most recent N)
        if (limit && limit > 0) {
            messages = messages.slice(-limit);
        }

        // Optionally clear captured messages
        if (clear) {
            this._consoleMessages = [];
        }

        return {
            messages,
            total: messages.length,
            capturing: this._captureConsole,
            bufferSize: this._consoleMessages.length,
        };
    }

    /**
     * Get network requests (captured via event listeners)
     */
    async getNetworkRequests(args = {}) {
        const { url, method, resourceType, status, limit, clear = false, since } = args;

        let requests = Array.from(this._networkRequests.values());

        // Filter by URL pattern (substring match)
        if (url) {
            requests = requests.filter(r => r.url.includes(url));
        }

        // Filter by HTTP method
        if (method) {
            requests = requests.filter(r => r.method.toUpperCase() === method.toUpperCase());
        }

        // Filter by resource type (document, script, stylesheet, image, xhr, fetch, etc.)
        if (resourceType) {
            requests = requests.filter(r => r.resourceType === resourceType);
        }

        // Filter by status code
        if (status) {
            requests = requests.filter(r => r.status === status);
        }

        // Filter by timestamp
        if (since) {
            requests = requests.filter(r => r.timestamp >= since);
        }

        // Apply limit (return most recent N)
        if (limit && limit > 0) {
            requests = requests.slice(-limit);
        }

        // Strip large fields for response (headers can be verbose)
        const compactRequests = requests.map(r => ({
            url: r.url,
            method: r.method,
            resourceType: r.resourceType,
            status: r.status,
            statusText: r.statusText,
            duration: r.duration,
            failure: r.failure,
            timestamp: r.timestamp,
            postData: r.postData ? r.postData.substring(0, 500) : null,
        }));

        // Optionally clear captured requests
        if (clear) {
            this._networkRequests.clear();
        }

        return {
            requests: compactRequests,
            total: compactRequests.length,
            capturing: this._captureNetwork,
            bufferSize: this._networkRequests.size,
        };
    }

    /**
     * Get page errors (uncaught exceptions captured via event listeners)
     */
    async getPageErrors(args = {}) {
        const { limit, clear = false, since } = args;

        let errors = [...this._pageErrors];

        if (since) {
            errors = errors.filter(e => e.timestamp >= since);
        }

        if (limit && limit > 0) {
            errors = errors.slice(-limit);
        }

        if (clear) {
            this._pageErrors = [];
        }

        return {
            errors,
            total: errors.length,
            bufferSize: this._pageErrors.length,
        };
    }

    /**
     * Press keyboard key
     */
    async pressKey(args) {
        const { key } = args;
        await this.page.keyboard.press(key);
        return { success: true, pressed: key };
    }

    /**
     * Take screenshot
     */
    async screenshot(args = {}) {
        const { path, fullPage = false } = args;

        const buffer = await this.page.screenshot({ fullPage, path });
        return {
            success: true,
            path: path || 'screenshot taken',
            base64: buffer.toString('base64').substring(0, 100) + '...',
        };
    }

    /**
     * Install browser (no-op for direct integration)
     */
    async install() {
        return { success: true, message: 'Browser already available via Playwright' };
    }

    /**
     * Close browser
     */
    async close() {
        // Always reset state even if browser.close() throws — otherwise
        // ensureConnected() sees stale connected=true and tries to use a dead
        // page object, causing cascading "Target closed" errors.
        try {
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.error('[PlaywrightDirect] Browser close error (non-fatal):', error.message);
        } finally {
            this.browser = null;
            this.context = null;
            this.page = null;
            this.connected = false;
        }
        return { success: true };
    }

    /**
     * Upload file(s)
     */
    async fileUpload(args) {
        const { paths, element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else if (element) {
            selector = element;
        } else {
            selector = 'input[type="file"]';
        }

        const fileInput = await this.page.$(selector);
        if (fileInput) {
            await fileInput.setInputFiles(paths);
            return { success: true, uploaded: paths };
        }
        return { success: false, error: 'File input not found' };
    }

    /**
     * Handle browser dialogs
     */
    async handleDialog(args) {
        const { accept, promptText } = args;

        this.page.once('dialog', async dialog => {
            if (accept) {
                await dialog.accept(promptText || '');
            } else {
                await dialog.dismiss();
            }
        });

        return { success: true, action: accept ? 'accepted' : 'dismissed' };
    }

    /**
     * Resize browser viewport
     */
    async resize(args) {
        const { width, height } = args;
        await this.page.setViewportSize({ width, height });
        return { success: true, width, height };
    }

    /**
     * Generate locator for element
     */
    async generateLocator(args) {
        const { element, ref } = args;

        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                const locators = [];
                if (refData.id) locators.push(`#${refData.id}`);
                if (refData.name) locators.push(`[name="${refData.name}"]`);
                if (refData.ariaLabel) locators.push(`[aria-label="${refData.ariaLabel}"]`);
                if (refData.text) locators.push(`text=${refData.text}`);
                return { success: true, locators, element: refData };
            }
        }

        return { success: false, error: 'Could not generate locator' };
    }

    /**
     * Verify element is visible
     */
    async verifyElementVisible(args) {
        const { element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
            return { success: true, visible: true, selector };
        } catch (e) {
            return { success: false, visible: false, selector, error: e.message };
        }
    }

    /**
     * Verify text is visible on page
     */
    async verifyTextVisible(args) {
        const { text } = args;

        try {
            await this.page.waitForSelector(`text=${text}`, { state: 'visible', timeout: 5000 });
            return { success: true, visible: true, text };
        } catch (e) {
            return { success: false, visible: false, text, error: e.message };
        }
    }

    /**
     * Verify element has specific value
     */
    async verifyValue(args) {
        const { element, ref, value } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        const actualValue = await this.page.$eval(selector, el => el.value || el.textContent);
        const matches = actualValue === value;
        return { success: matches, expected: value, actual: actualValue, matches };
    }

    /**
     * Save page as PDF
     */
    async savePdf(args) {
        const { filename = 'page.pdf' } = args;
        await this.page.pdf({ path: filename });
        return { success: true, filename };
    }

    /**
     * Click at specific X,Y coordinates
     */
    async mouseClickXY(args) {
        const { x, y, button = 'left' } = args;
        await this.page.mouse.click(x, y, { button });
        return { success: true, x, y, button };
    }

    /**
     * Move mouse to specific coordinates
     */
    async mouseMoveXY(args) {
        const { x, y } = args;
        await this.page.mouse.move(x, y);
        return { success: true, x, y };
    }

    /**
     * Drag from one coordinate to another
     */
    async mouseDragXY(args) {
        const { startX, startY, endX, endY } = args;
        await this.page.mouse.move(startX, startY);
        await this.page.mouse.down();
        await this.page.mouse.move(endX, endY);
        await this.page.mouse.up();
        return { success: true, from: { x: startX, y: startY }, to: { x: endX, y: endY } };
    }

    /**
     * Scroll using mouse wheel
     */
    async mouseWheel(args) {
        const { deltaX = 0, deltaY = 0 } = args;
        await this.page.mouse.wheel(deltaX, deltaY);
        return { success: true, deltaX, deltaY };
    }

    /**
     * Cleanup
     */
    async cleanup() {
        await this.close();
    }
}

export { PlaywrightDirectBridge as PlaywrightBridge };
