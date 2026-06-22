/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * RAW CDP TRANSPORT — direct Chrome DevTools Protocol fast-path  (Phase 3 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Talks to the browser over a raw CDP session (the same channel Playwright/Puppeteer use under
 * the hood) for the HOT path — the operations a perceive→act loop runs thousands of times:
 *
 *   • evaluate  → Runtime.evaluate  (returnByValue)  — skips Playwright's function serialization
 *                 + JSHandle lifecycle, so a simple expression is a single protocol round-trip.
 *   • clickAt   → Input.dispatchMouseEvent ×2 (pressed/released) at coordinates — skips Playwright
 *                 actionability waits. SAFE here because the Digital Twin already established the
 *                 element exists and supplied its bounds; we click its center directly.
 *   • typeText  → Input.insertText — single event vs per-key dispatch.
 *   • pressKey  → Input.dispatchKeyEvent (rawKeyDown/keyUp) for common keys.
 *   • getAXTree → Accessibility.getFullAXTree — the full accessibility tree in one call.
 *
 * Obtained via Playwright's `page.context().newCDPSession(page)` (Chromium only). Returns
 * isAvailable()=false on Firefox/WebKit so the router transparently falls back to Playwright.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { BaseTransport } from './browser-transport.js';

// Minimal CDP key descriptors for keys the runtime commonly presses.
const KEY_DEFS = {
    Enter: { keyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
    Tab: { keyCode: 9, key: 'Tab', code: 'Tab' },
    Escape: { keyCode: 27, key: 'Escape', code: 'Escape' },
    Backspace: { keyCode: 8, key: 'Backspace', code: 'Backspace' },
    ArrowDown: { keyCode: 40, key: 'ArrowDown', code: 'ArrowDown' },
    ArrowUp: { keyCode: 38, key: 'ArrowUp', code: 'ArrowUp' },
    ArrowLeft: { keyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' },
    ArrowRight: { keyCode: 39, key: 'ArrowRight', code: 'ArrowRight' },
};

export class RawCdpTransport extends BaseTransport {
    /**
     * @param {() => import('playwright').Page} getPage - Returns the current active page.
     * @param {object} [options]
     * @param {string} [options.browser='chromium'] - CDP is Chromium-only.
     */
    constructor(getPage, options = {}) {
        super('raw-cdp');
        this._getPage = getPage;
        this._browser = options.browser || 'chromium';
        this._session = null;
        this._sessionPage = null;
    }

    get page() { return this._getPage(); }

    /** Lazily create (and cache) a CDP session bound to the current page. */
    async _cdp() {
        const page = this.page;
        if (!page) throw new Error('No page for CDP session');
        if (this._session && this._sessionPage === page) return this._session;
        // Page changed (navigation to a new target keeps the same page object, so this mainly
        // guards tab switches). Detach the stale session first.
        if (this._session) { try { await this._session.detach(); } catch { /* ignore */ } this._session = null; }
        this._session = await page.context().newCDPSession(page);
        this._sessionPage = page;
        return this._session;
    }

    async isAvailable() {
        if (this._browser !== 'chromium') return false;
        if (!this.page || this.page.isClosed()) return false;
        try { await this._cdp(); return true; } catch { return false; }
    }

    async evaluate(expression, arg) {
        const cdp = await this._cdp();
        // Build a self-invoking expression so `arg` is available without a separate binding.
        const argJson = arg === undefined ? 'undefined' : JSON.stringify(arg);
        const wrapped = `(function(arg){ return (${typeof expression === 'string' ? expression : `(${expression})(arg)`}); })(${argJson})`;
        const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
            expression: wrapped,
            returnByValue: true,
            awaitPromise: true,
        });
        if (exceptionDetails) {
            throw new Error(`Runtime.evaluate failed: ${exceptionDetails.text || exceptionDetails.exception?.description || 'unknown'}`);
        }
        return result?.value;
    }

    async clickAt(x, y, opts = {}) {
        const cdp = await this._cdp();
        const button = opts.button || 'left';
        const clickCount = opts.clickCount || 1;
        const base = { x: Math.round(x), y: Math.round(y), button, buttons: 1, clickCount };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y, button: 'none', buttons: 0 });
        await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
        await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
    }

    async typeText(text) {
        const cdp = await this._cdp();
        await cdp.send('Input.insertText', { text: String(text) });
    }

    async pressKey(key) {
        const cdp = await this._cdp();
        const def = KEY_DEFS[key];
        if (!def) {
            // Fallback: a single printable char goes through insertText.
            if (typeof key === 'string' && key.length === 1) { await cdp.send('Input.insertText', { text: key }); return; }
            throw new Error(`RawCdpTransport.pressKey: unsupported key "${key}"`);
        }
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...def });
        if (def.text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', ...def });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...def });
    }

    async getAXTree() {
        const cdp = await this._cdp();
        await cdp.send('Accessibility.enable').catch(() => {});
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        return { nodes };
    }

    async dispose() {
        if (this._session) { try { await this._session.detach(); } catch { /* ignore */ } this._session = null; }
        this._sessionPage = null;
    }
}

export default RawCdpTransport;
