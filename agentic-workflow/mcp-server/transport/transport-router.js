/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TRANSPORT ROUTER — picks the fastest available channel per operation  (Phase 3 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Routes each hot operation to the raw-CDP transport when available (Chromium), transparently
 * falling back to Playwright otherwise (Firefox/WebKit, or if CDP errors). Lifecycle operations
 * (navigation, screenshots) stay on Playwright and are NOT routed here.
 *
 * Tracks per-transport usage + fallbacks so the benchmark can prove the fast-path is taken and
 * measure the latency delta. A single `preferRaw` switch lets callers force parity comparisons.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export class TransportRouter {
    /**
     * @param {object} transports
     * @param {import('./browser-transport.js').BaseTransport} transports.playwright
     * @param {import('./browser-transport.js').BaseTransport} [transports.rawCdp]
     * @param {object} [options]
     * @param {boolean} [options.preferRaw=true] - Prefer raw-CDP for hot ops when available.
     */
    constructor({ playwright, rawCdp } = {}, options = {}) {
        this._playwright = playwright;
        this._rawCdp = rawCdp || null;
        this._preferRaw = options.preferRaw !== false;
        this._rawOk = null; // cached availability (re-checked on fallback)
        this._stats = { raw: 0, playwright: 0, fallbacks: 0, byOp: {} };
    }

    get stats() { return { ...this._stats, byOp: { ...this._stats.byOp } }; }
    setPreferRaw(v) { this._preferRaw = !!v; this._rawOk = null; }

    async _rawAvailable() {
        if (!this._rawCdp || !this._preferRaw) return false;
        if (this._rawOk === null) {
            try { this._rawOk = await this._rawCdp.isAvailable(); } catch { this._rawOk = false; }
        }
        return this._rawOk;
    }

    _count(op, transport) {
        this._stats[transport] += 1;
        this._stats.byOp[op] = this._stats.byOp[op] || { raw: 0, playwright: 0 };
        this._stats.byOp[op][transport] += 1;
    }

    /** Run an op on raw-CDP if available, else Playwright; fall back on raw error. */
    async _route(op, fn) {
        if (await this._rawAvailable()) {
            try {
                const out = await fn(this._rawCdp);
                this._count(op, 'raw');
                return out;
            } catch (e) {
                // Raw path failed — fall back to Playwright and stop trusting raw for now.
                this._rawOk = false;
                this._stats.fallbacks += 1;
            }
        }
        const out = await fn(this._playwright);
        this._count(op, 'playwright');
        return out;
    }

    evaluate(expression, arg) { return this._route('evaluate', (t) => t.evaluate(expression, arg)); }
    clickAt(x, y, opts) { return this._route('clickAt', (t) => t.clickAt(x, y, opts)); }
    typeText(text) { return this._route('typeText', (t) => t.typeText(text)); }
    pressKey(key) { return this._route('pressKey', (t) => t.pressKey(key)); }
    getAXTree() { return this._route('getAXTree', (t) => t.getAXTree()); }

    async dispose() {
        if (this._rawCdp) { try { await this._rawCdp.dispose(); } catch { /* ignore */ } }
    }
}

export default TransportRouter;
