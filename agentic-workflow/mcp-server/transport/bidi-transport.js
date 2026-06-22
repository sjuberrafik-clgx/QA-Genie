/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * BiDi TRANSPORT — cross-browser control channel  (Phase 8 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Provides the BrowserTransport surface for non-Chromium engines (Firefox, WebKit), where the
 * raw-CDP fast path is unavailable. It is deliberately built on Playwright's cross-browser
 * primitives, which already speak each engine's native protocol:
 *
 *      WebDriver BiDi concept        Playwright cross-browser primitive (used here)
 *      ─────────────────────         ───────────────────────────────────────────────
 *      script.addPreloadScript   ↔   context.addInitScript        (resident-agent injection)
 *      script.callFunction       ↔   page.evaluate                (perception / actions)
 *      input.performActions      ↔   page.mouse / page.keyboard   (clickAt / typeText)
 *      browsingContext.*         ↔   page.goto / navigation        (lifecycle)
 *
 * Because the resident perception agent (Phase 1) uses only addInitScript + exposeBinding +
 * standard web APIs (MutationObserver/IntersectionObserver), the ENTIRE CBR stack — perception,
 * healing, vision — runs unchanged on Firefox and WebKit through this transport. The Chromium
 * raw-CDP transport (Phase 3) remains an accelerator for the hot path only.
 *
 * A future native WebDriver-BiDi client (bypassing Playwright) would slot in here unchanged: the
 * interface is identical, so nothing above the transport layer needs to know which engine or wire
 * protocol is in use. That is the point of the transport abstraction.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { PlaywrightTransport } from './playwright-transport.js';

export class BiDiTransport extends PlaywrightTransport {
    /**
     * @param {() => import('playwright').Page} getPage
     * @param {object} [options]
     * @param {string} [options.engine='firefox'] - Informational: 'firefox' | 'webkit'.
     */
    constructor(getPage, options = {}) {
        super(getPage);
        this._engine = options.engine || 'firefox';
        this._name = `bidi:${this._engine}`;
    }

    get name() { return this._name; }
    get engine() { return this._engine; }

    // Cross-browser availability: present whenever a live page exists (any engine).
    async isAvailable() { return !!this.page && !this.page.isClosed(); }

    // evaluate/clickAt/typeText/pressKey/getAXTree are inherited from PlaywrightTransport, which
    // dispatches over the active engine's protocol — no per-engine branching required.
}

export default BiDiTransport;
