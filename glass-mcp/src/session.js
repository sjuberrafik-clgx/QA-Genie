'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · SESSION — browser lifecycle + tabs, shared by every verb
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lazily launches a browser on first use, manages pages/tabs with stable ids, and
 * owns the per-session Perceiver (so see()'s novelty baseline is session-scoped,
 * in memory — no disk, no workspace coupling). Standalone: nothing here imports
 * anything outside glass-mcp/.
 *
 * @module glass-mcp/session
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { Perceiver } = require('./perception/see');

function loadChromium() {
    for (const m of ['playwright', '@playwright/test', 'playwright-core']) {
        try { return require(m).chromium; } catch { /* next */ }
    }
    return null;
}

class BrowserSession {
    constructor(opts = {}) {
        this.opts = opts;
        this.browser = null;
        this.context = null;
        this._pages = [];
        this._ids = new WeakMap();
        this._active = null;
        this._seq = 0;
        this.perceiver = new Perceiver(opts);
    }

    async ensure() {
        if (this.browser) return;
        const chromium = loadChromium();
        if (!chromium) throw new Error('playwright is not installed. Run `npm i playwright` in glass-mcp/.');
        this.browser = await chromium.launch({ headless: this.opts.headless !== false });
        this.context = await this.browser.newContext({
            viewport: this.opts.viewport || { width: 1280, height: 800 },
        });
        // Popups (window.open / target=_blank) are auto-tracked.
        this.context.on('page', (p) => this._track(p));
        const first = await this.context.newPage();
        this._track(first);
        this._active = first;
    }

    _track(p) {
        if (this._ids.has(p)) return this._ids.get(p);
        const id = 't' + (++this._seq);
        this._ids.set(p, id);
        this._pages.push(p);
        if (!this._active) this._active = p;
        p.once('close', () => {
            this._pages = this._pages.filter((x) => x !== p);
            if (this._active === p) this._active = this._pages[this._pages.length - 1] || null;
        });
        return id;
    }

    get page() { return this._active; }
    activeTabId() { return this._active ? this._ids.get(this._active) : null; }
    listTabs() {
        return this._pages.map((p) => ({ id: this._ids.get(p), url: safeUrl(p), active: p === this._active }));
    }

    _resolveTab(tab) {
        if (tab == null) return this._active;
        for (const p of this._pages) if (this._ids.get(p) === tab) return p;
        const idx = parseInt(tab, 10);
        if (!Number.isNaN(idx) && this._pages[idx]) return this._pages[idx];
        return null;
    }

    async newTab(url) {
        await this.ensure();
        const p = await this.context.newPage();
        this._track(p);
        this._active = p;
        this.perceiver.resetBaseline();
        if (url) await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return p;
    }

    switchTab(tab) {
        const p = this._resolveTab(tab);
        if (!p) return false;
        this._active = p;
        this.perceiver.resetBaseline();
        return true;
    }

    async closeTab(tab) {
        const p = tab != null ? this._resolveTab(tab) : this._active;
        if (p) await p.close();
        return !!p;
    }

    async see(opts) {
        await this.ensure();
        return this.perceiver.see(this.page, opts);
    }

    /**
     * Lazily create (and cache per page) a Chrome DevTools Protocol session for
     * the `devtool` verb. Chromium only.
     * @param {import('playwright').Page} [page]
     */
    async cdpFor(page) {
        const p = page || this.page;
        if (!p) throw new Error('no active page');
        if (!this._cdp) this._cdp = new WeakMap();
        if (this._cdp.has(p)) return this._cdp.get(p);
        if (!this.context || typeof this.context.newCDPSession !== 'function') {
            throw new Error('CDP is only available on Chromium');
        }
        const cdp = await this.context.newCDPSession(p);
        this._cdp.set(p, cdp);
        return cdp;
    }

    async close() {
        if (this.browser) await this.browser.close();
        this.browser = null;
        this.context = null;
        this._pages = [];
        this._active = null;
        this._cdp = null;
        this._net = null;
    }
}

function safeUrl(p) {
    try { return p.url(); } catch { return ''; }
}

module.exports = { BrowserSession, loadChromium };
