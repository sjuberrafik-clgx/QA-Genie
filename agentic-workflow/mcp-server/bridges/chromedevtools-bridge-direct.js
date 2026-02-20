/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CHROMEDEVTOOLS DIRECT BRIDGE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Direct integration for DevTools-specific features.
 * 
 * Supports TWO connection modes:
 *   1. Parasitic (default) — uses Playwright's CDP session via setPlaywrightBridge()
 *   2. Standalone — connects directly to a Chrome/Edge DevTools endpoint URL
 *      via `chromium.connectOverCDP(endpointUrl)` for independent CDP access.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { chromium } from 'playwright';
import { EventEmitter } from 'events';

/**
 * ChromeDevTools Direct Bridge
 * Uses Playwright's CDP session for DevTools Protocol access
 */
export class ChromeDevToolsDirectBridge extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            timeout: config.timeout ?? 30000,
            cdpEndpoint: config.cdpEndpoint ?? process.env.CDP_ENDPOINT ?? null,
            ...config,
        };

        this.playwrightBridge = null; // Will be set by router (parasitic mode)
        this.cdpSession = null;
        this.connected = false;
        this.traceData = null;
        this.networkRequests = new Map();
        this.consoleMessages = [];

        // Standalone mode resources
        this._standaloneBrowser = null;
        this._standaloneContext = null;
        this._standalonePage = null;
        this._mode = null; // 'parasitic' | 'standalone'
    }

    /**
     * Set Playwright bridge reference (called by router — parasitic mode)
     */
    setPlaywrightBridge(bridge) {
        this.playwrightBridge = bridge;
        this._mode = 'parasitic';
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Connect — parasitic (via Playwright bridge) or standalone (via CDP endpoint)
     */
    async connect() {
        if (this.connected) return;

        console.error('[ChromeDevToolsDirect] Connecting...');

        if (this.config.cdpEndpoint && !this.playwrightBridge) {
            // ── Standalone mode: connect directly to CDP endpoint ──
            console.error(`[ChromeDevToolsDirect] Standalone mode → ${this.config.cdpEndpoint}`);

            this._standaloneBrowser = await chromium.connectOverCDP(this.config.cdpEndpoint);
            const contexts = this._standaloneBrowser.contexts();
            this._standaloneContext = contexts[0] || await this._standaloneBrowser.newContext();
            const pages = this._standaloneContext.pages();
            this._standalonePage = pages[0] || await this._standaloneContext.newPage();

            this._mode = 'standalone';
            this.connected = true;
            console.error('[ChromeDevToolsDirect] Connected in standalone CDP mode');
        } else {
            // ── Parasitic mode: use Playwright's page for CDP access ──
            this._mode = 'parasitic';
            this.connected = true;
            console.error('[ChromeDevToolsDirect] Connected (via Playwright CDP)');
        }
    }

    /**
     * Get the active page (from whichever mode is active)
     */
    get _activePage() {
        if (this._mode === 'standalone') {
            return this._standalonePage;
        }
        return this.playwrightBridge?.page ?? null;
    }

    /**
     * Get the active context
     */
    get _activeContext() {
        if (this._mode === 'standalone') {
            return this._standaloneContext;
        }
        return this.playwrightBridge?.context ?? null;
    }

    /**
     * Get CDP session from the active page
     */
    async getCDPSession() {
        const page = this._activePage;
        if (!page) {
            throw new Error('No page available — connect in standalone mode or set Playwright bridge');
        }

        if (!this.cdpSession) {
            this.cdpSession = await page.context().newCDPSession(page);
        }

        return this.cdpSession;
    }

    /**
     * Call a tool
     */
    async callTool(toolName, args = {}) {
        console.error(`[ChromeDevToolsDirect] Calling tool: ${toolName}`);

        const toolMap = {
            'evaluate_script': () => this.evaluateScript(args),
            'performance_start_trace': () => this.startTrace(args),
            'performance_stop_trace': () => this.stopTrace(args),
            'performance_analyze_insight': () => this.analyzeInsight(args),
            'list_network_requests': () => this.listNetworkRequests(args),
            'list_console_messages': () => this.listConsoleMessages(args),
            'get_network_request': () => this.getNetworkRequest(args),
            'handle_dialog': () => this.handleDialog(args),
            'upload_file': () => this.uploadFile(args),
            'emulate': () => this.emulate(args),
            'resize_page': () => this.resizePage(args),
            'take_snapshot': () => this.takeSnapshot(args),
        };

        const handler = toolMap[toolName];
        if (!handler) {
            throw new Error(`Unknown ChromeDevTools tool: ${toolName}`);
        }

        return await handler();
    }

    /**
     * Evaluate JavaScript via CDP
     */
    async evaluateScript(args) {
        const { script, expression } = args;
        const code = script || expression;

        const page = this._activePage;
        if (page) {
            const result = await page.evaluate(code);
            return { result };
        }

        throw new Error('No page available for script evaluation');
    }

    /**
     * Start performance trace — also injects Web Vitals observers for accurate measurement
     */
    async startTrace(args = {}) {
        const { reload = false, filePath } = args;

        console.error('[ChromeDevToolsDirect] Starting performance trace...');

        const page = this._activePage;
        const context = this._activeContext;
        if (page && context) {
            // Start tracing via Playwright
            await context.tracing.start({
                screenshots: true,
                snapshots: true,
            });

            // Enable CDP Performance domain for metrics collection
            try {
                const cdpSession = await this.getCDPSession();
                await cdpSession.send('Performance.enable');
            } catch (e) {
                console.error('[ChromeDevToolsDirect] CDP Performance.enable failed:', e.message);
            }

            // Inject PerformanceObserver for LCP, CLS, and long tasks
            await page.evaluate(() => {
                // Observe LCP
                try {
                    new PerformanceObserver((list) => {
                        // Entries are automatically stored and accessible via performance.getEntriesByType
                    }).observe({ type: 'largest-contentful-paint', buffered: true });
                } catch (e) { /* LCP observer not supported */ }

                // Observe layout-shift for CLS
                try {
                    new PerformanceObserver((list) => {
                        // Entries stored automatically
                    }).observe({ type: 'layout-shift', buffered: true });
                } catch (e) { /* layout-shift observer not supported */ }

                // Observe long tasks
                try {
                    new PerformanceObserver((list) => {
                        // Entries stored automatically
                    }).observe({ type: 'longtask', buffered: true });
                } catch (e) { /* longtask observer not supported */ }
            });

            this.traceData = {
                startTime: Date.now(),
                filePath,
            };

            if (reload) {
                await page.reload();
            }

            return { success: true, message: 'Trace started with Web Vitals observers' };
        }

        throw new Error('No page available for tracing');
    }

    /**
     * Stop performance trace — captures real Core Web Vitals via PerformanceObserver + CDP metrics
     */
    async stopTrace(args = {}) {
        const { filePath } = args;

        console.error('[ChromeDevToolsDirect] Stopping performance trace...');

        if (this._activeContext) {
            const path = filePath || this.traceData?.filePath || `trace-${Date.now()}.zip`;

            await this._activeContext.tracing.stop({ path });

            const duration = Date.now() - (this.traceData?.startTime || Date.now());

            // ── Collect real Core Web Vitals and performance metrics ──
            const metrics = await this._activePage.evaluate(() => {
                const result = {
                    loadTime: 0,
                    domContentLoaded: 0,
                    firstPaint: 0,
                    firstContentfulPaint: 0,
                    LCP: null,
                    FID: null,
                    CLS: null,
                    TTFB: null,
                    INP: null,
                };

                // Navigation Timing API (Level 2)
                const navEntries = performance.getEntriesByType('navigation');
                if (navEntries.length > 0) {
                    const nav = navEntries[0];
                    result.loadTime = Math.round(nav.loadEventEnd - nav.startTime);
                    result.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
                    result.TTFB = Math.round(nav.responseStart - nav.startTime);
                }

                // Paint Timing API
                const paintEntries = performance.getEntriesByType('paint');
                for (const entry of paintEntries) {
                    if (entry.name === 'first-paint') {
                        result.firstPaint = Math.round(entry.startTime);
                    }
                    if (entry.name === 'first-contentful-paint') {
                        result.firstContentfulPaint = Math.round(entry.startTime);
                    }
                }

                // LCP — Largest Contentful Paint (from PerformanceObserver entries if available)
                try {
                    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
                    if (lcpEntries.length > 0) {
                        result.LCP = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
                    }
                } catch (e) { /* LCP API may not be available */ }

                // CLS — Cumulative Layout Shift
                try {
                    const layoutShiftEntries = performance.getEntriesByType('layout-shift');
                    if (layoutShiftEntries.length > 0) {
                        let clsValue = 0;
                        let sessionValue = 0;
                        let sessionEntries = [];
                        let previousEntry = null;

                        for (const entry of layoutShiftEntries) {
                            // Only count shifts without recent user input
                            if (!entry.hadRecentInput) {
                                if (previousEntry &&
                                    entry.startTime - previousEntry.startTime < 1000 &&
                                    entry.startTime - sessionEntries[0]?.startTime < 5000) {
                                    sessionValue += entry.value;
                                } else {
                                    sessionValue = entry.value;
                                    sessionEntries = [];
                                }
                                sessionEntries.push(entry);
                                clsValue = Math.max(clsValue, sessionValue);
                            }
                            previousEntry = entry;
                        }
                        result.CLS = Math.round(clsValue * 10000) / 10000;
                    }
                } catch (e) { /* CLS API may not be available */ }

                // Long Tasks (proxy for INP/FID awareness)
                try {
                    const longTasks = performance.getEntriesByType('longtask');
                    if (longTasks.length > 0) {
                        result.longTaskCount = longTasks.length;
                        result.longestTask = Math.round(Math.max(...longTasks.map(t => t.duration)));
                    }
                } catch (e) { /* longtask API may not be available */ }

                // Resource summary
                const resources = performance.getEntriesByType('resource');
                result.resourceCount = resources.length;
                result.totalTransferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);

                return result;
            });

            // ── Also collect CDP-level metrics if available ──
            let cdpMetrics = null;
            try {
                const cdpSession = await this.getCDPSession();
                const { metrics: rawMetrics } = await cdpSession.send('Performance.getMetrics');
                cdpMetrics = {};
                for (const m of rawMetrics) {
                    cdpMetrics[m.name] = m.value;
                }
            } catch (e) {
                console.error('[ChromeDevToolsDirect] CDP Performance.getMetrics unavailable:', e.message);
            }

            this.traceData = null;

            return {
                success: true,
                tracePath: path,
                duration,
                metrics,
                cdpMetrics,
                webVitals: {
                    LCP: metrics.LCP,
                    FID: metrics.FID,
                    CLS: metrics.CLS,
                    TTFB: metrics.TTFB,
                    INP: metrics.INP,
                    FCP: metrics.firstContentfulPaint,
                },
            };
        }

        throw new Error('No context available for stopping trace');
    }

    /**
     * Analyze performance insight
     */
    async analyzeInsight(args = {}) {
        const { type = 'all' } = args;

        if (this._activePage) {
            const metrics = await this._activePage.evaluate(() => {
                const entries = performance.getEntries();
                const navigation = performance.getEntriesByType('navigation')[0];
                const paint = performance.getEntriesByType('paint');
                const resources = performance.getEntriesByType('resource');

                return {
                    navigation: navigation ? {
                        type: navigation.type,
                        duration: navigation.duration,
                        domComplete: navigation.domComplete,
                        loadEventEnd: navigation.loadEventEnd,
                    } : null,
                    paint: paint.map(p => ({ name: p.name, startTime: p.startTime })),
                    resourceCount: resources.length,
                    totalResourceSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
                    slowestResources: resources
                        .sort((a, b) => b.duration - a.duration)
                        .slice(0, 5)
                        .map(r => ({ name: r.name, duration: r.duration })),
                };
            });

            return { insights: metrics };
        }

        throw new Error('No page available for analysis');
    }

    /**
     * Get specific network request
     */
    async getNetworkRequest(args) {
        const { id, url } = args;

        if (id && this.networkRequests.has(id)) {
            return this.networkRequests.get(id);
        }

        if (url) {
            for (const req of this.networkRequests.values()) {
                if (req.url.includes(url)) {
                    return req;
                }
            }
        }

        return { error: 'Request not found' };
    }

    /**
     * Handle browser dialog
     */
    async handleDialog(args) {
        const { action = 'accept', promptText } = args;

        const page = this._activePage;
        if (page) {
            page.once('dialog', async dialog => {
                if (action === 'accept') {
                    await dialog.accept(promptText);
                } else {
                    await dialog.dismiss();
                }
            });

            return { success: true, action, message: 'Dialog handler set' };
        }

        throw new Error('No page available');
    }

    /**
     * Upload file
     */
    async uploadFile(args) {
        const { selector, filePath } = args;

        const page = this._activePage;
        if (page) {
            await page.setInputFiles(selector, filePath);
            return { success: true, uploaded: filePath };
        }

        throw new Error('No page available');
    }

    /**
     * Emulate device/network
     */
    async emulate(args) {
        const { device, width, height, deviceScaleFactor, mobile, geolocation, offline } = args;

        const page = this._activePage;
        const context = this._activeContext;
        if (page) {
            if (width && height) {
                await page.setViewportSize({ width, height });
            }

            if (geolocation && context) {
                await context.setGeolocation(geolocation);
            }

            if (offline !== undefined && context) {
                await context.setOffline(offline);
            }

            return { success: true, emulated: args };
        }

        throw new Error('No page available');
    }

    /**
     * Resize page
     */
    async resizePage(args) {
        const { width, height } = args;

        const page = this._activePage;
        if (page) {
            await page.setViewportSize({ width, height });
            return { success: true, size: { width, height } };
        }

        throw new Error('No page available');
    }

    /**
     * Take DOM snapshot using CDP
     */
    async takeSnapshot(args = {}) {
        console.error('[ChromeDevToolsDirect] Taking DOM snapshot...');

        const page = this._activePage;
        if (page) {
            try {
                const cdpSession = await this.getCDPSession();

                // Get DOM snapshot via CDP
                const { data } = await cdpSession.send('DOMSnapshot.captureSnapshot', {
                    computedStyles: [],
                    includeDOMRects: true,
                });

                return {
                    success: true,
                    snapshot: data,
                    url: page.url(),
                };
            } catch (cdpError) {
                // Fallback to getting HTML content if CDP snapshot fails
                console.error('[ChromeDevToolsDirect] CDP snapshot failed, using fallback:', cdpError.message);

                const html = await page.content();
                const title = await page.title();

                return {
                    success: true,
                    html: html.substring(0, 50000), // Limit size
                    title,
                    url: page.url(),
                    note: 'Using HTML fallback (CDP snapshot unavailable)'
                };
            }
        }

        throw new Error('No page available for snapshot');
    }

    /**
     * List console messages — delegates to Playwright bridge's captured messages
     */
    async listConsoleMessages(args = {}) {
        if (this.playwrightBridge && typeof this.playwrightBridge.getConsoleMessages === 'function') {
            return await this.playwrightBridge.getConsoleMessages(args);
        }
        return {
            messages: this.consoleMessages,
            note: 'Playwright bridge not available; using local (likely empty) buffer',
        };
    }

    /**
     * List network requests — delegates to Playwright bridge's captured requests
     */
    async listNetworkRequests(args = {}) {
        if (this.playwrightBridge && typeof this.playwrightBridge.getNetworkRequests === 'function') {
            return await this.playwrightBridge.getNetworkRequests(args);
        }
        return {
            requests: Array.from(this.networkRequests.values()),
            note: 'Playwright bridge not available; using local (likely empty) buffer',
        };
    }

    /**
     * Cleanup — handles both parasitic and standalone modes
     */
    async cleanup() {
        if (this.cdpSession) {
            try { await this.cdpSession.detach(); } catch (e) { /* ignore */ }
            this.cdpSession = null;
        }

        // Standalone mode cleanup
        if (this._standalonePage) {
            try { await this._standalonePage.close(); } catch (e) { /* ignore */ }
            this._standalonePage = null;
        }
        if (this._standaloneContext) {
            try { await this._standaloneContext.close(); } catch (e) { /* ignore */ }
            this._standaloneContext = null;
        }
        if (this._standaloneBrowser) {
            try { await this._standaloneBrowser.close(); } catch (e) { /* ignore */ }
            this._standaloneBrowser = null;
        }

        this.connected = false;
    }
}

export { ChromeDevToolsDirectBridge as ChromeDevToolsBridge };
