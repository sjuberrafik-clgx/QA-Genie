/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * PLAYWRIGHT TRANSPORT — the high-level control channel  (Phase 3 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Wraps a Playwright Page in the BrowserTransport interface. This is the safe, cross-browser
 * default (actionability checks, auto-wait). The raw-CDP transport mirrors this surface for the
 * hot path; the router falls back here whenever CDP is unavailable or an op needs Playwright's
 * guarantees.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { BaseTransport } from './browser-transport.js';

export class PlaywrightTransport extends BaseTransport {
    /** @param {() => import('playwright').Page} getPage - Returns the current active page. */
    constructor(getPage) {
        super('playwright');
        this._getPage = getPage;
    }

    get page() { return this._getPage(); }

    async isAvailable() { return !!this.page && !this.page.isClosed(); }

    async evaluate(expression, arg) {
        // Accept a string expression or a function (parity with the raw transport, which only
        // takes a string). Strings are wrapped so Playwright evaluates them as an expression.
        if (typeof expression === 'string') {
            return this.page.evaluate(new Function('arg', `return (${expression});`), arg);
        }
        return this.page.evaluate(expression, arg);
    }

    async clickAt(x, y, opts = {}) {
        await this.page.mouse.click(x, y, { button: opts.button || 'left', clickCount: opts.clickCount || 1 });
    }

    async typeText(text) {
        await this.page.keyboard.insertText(String(text));
    }

    async pressKey(key) {
        await this.page.keyboard.press(key);
    }

    async getAXTree() {
        // Playwright's accessibility snapshot (interesting-only nodes).
        return this.page.accessibility.snapshot({ interestingOnly: true });
    }
}

export default PlaywrightTransport;
