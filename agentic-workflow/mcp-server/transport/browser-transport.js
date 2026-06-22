/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * BROWSER TRANSPORT — pluggable browser control channel  (Phase 3 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Abstracts "how do we actually talk to the browser" behind a small interface so the runtime
 * can route each operation to the fastest available channel:
 *
 *   • PlaywrightTransport — Playwright's high-level API (actionability, auto-wait, cross-browser).
 *   • RawCdpTransport     — a raw Chrome DevTools Protocol session (Runtime.evaluate,
 *                           Input.dispatch*, Accessibility.getFullAXTree) for the HOT path, where
 *                           the Digital Twin has already established the element exists, so we can
 *                           skip Playwright's per-call actionability round-trips.
 *   • (future) BiDiTransport — WebDriver BiDi for Firefox/WebKit (Phase 8).
 *
 * CDP/WebDriver thus become low-level "device drivers"; the runtime reasons above them.
 *
 * Every transport implements the SAME surface so the router can A/B them and assert parity.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} BrowserTransport
 * @property {string} name
 * @property {() => Promise<boolean>} isAvailable
 * @property {(expression: string|Function, arg?: any) => Promise<any>} evaluate
 * @property {(x: number, y: number, opts?: object) => Promise<void>} clickAt
 * @property {(text: string) => Promise<void>} typeText
 * @property {(key: string) => Promise<void>} pressKey
 * @property {() => Promise<object>} getAXTree
 * @property {() => Promise<void>} dispose
 */

export class BaseTransport {
    constructor(name) { this._name = name; }
    get name() { return this._name; }
    async isAvailable() { return true; }
    async evaluate() { throw new Error(`${this._name}.evaluate() not implemented`); }
    async clickAt() { throw new Error(`${this._name}.clickAt() not implemented`); }
    async typeText() { throw new Error(`${this._name}.typeText() not implemented`); }
    async pressKey() { throw new Error(`${this._name}.pressKey() not implemented`); }
    async getAXTree() { throw new Error(`${this._name}.getAXTree() not implemented`); }
    async dispose() { /* no-op by default */ }
}

export default BaseTransport;
