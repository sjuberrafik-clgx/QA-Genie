/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HEALING RESOLVER — self-healing selector re-anchoring  (Phase 4 of the Cognitive Browser Runtime)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Converts the resident agent's stable IDENTITY (Phase 1) into selector reliability. When a
 * selector breaks after a re-render, this resolver re-anchors the target to the element that
 * still carries the same semantic identity (role|name|testid) — even though its DOM node and
 * dynamic id changed — and returns a fresh, validated selector.
 *
 * QA-INTEGRITY (non-negotiable): a heal is NEVER silent. Every heal emits a structured WARN
 * event {original, healedTo, identity, strategy, confidence} and is recorded to the HealStore.
 * The caller can surface it as "the selector changed — possible product change" rather than
 * masking a real regression. The resolver reports exactly which element it chose and why.
 *
 * Depends on the bridge exposing: page (Playwright), snapshot(), snapshotRefs, and the resident
 * agent (window.__cbr.identityOf / resolveIdentity). Degrades to {healed:false} without them.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { SelectorEngine } from '../utils/selector-engine.js';

export class HealingResolver {
    /**
     * @param {object} bridge - PlaywrightDirectBridge instance.
     * @param {object} [options]
     * @param {import('./heal-store.js').HealStore} [options.healStore] - Learning store.
     * @param {(evt: object) => void} [options.onHeal] - WARN sink (the bridge emits 'selector-heal').
     */
    constructor(bridge, options = {}) {
        this._bridge = bridge;
        this._healStore = options.healStore || null;
        this._onHeal = typeof options.onHeal === 'function' ? options.onHeal : null;
        this._stats = { heals: 0, captures: 0, misses: 0 };
    }

    get stats() { return { ...this._stats }; }

    /** True when the resident agent is available to provide stable identity. */
    _residentAvailable() {
        return this._bridge && this._bridge._residentAgentEnabled && this._bridge.page;
    }

    /**
     * Capture the stable semantic identity of a freshly-resolved element so a future break can
     * be healed. Also reinforces the working selector as "stable" in the learning store.
     * @returns {Promise<string|null>} the identity key, or null when unavailable.
     */
    async captureIdentity(ref, { selector, strategy } = {}) {
        if (!this._residentAvailable() || !ref) return null;
        let identity = null;
        try {
            identity = await this._bridge.page.evaluate((r) => (window.__cbr ? window.__cbr.identityOf(r) : null), ref);
        } catch { /* page navigated */ }
        if (identity) {
            this._stats.captures += 1;
            if (this._healStore && selector) this._healStore.recordResolve(identity, selector, strategy);
        }
        return identity;
    }

    /**
     * Re-anchor a broken selector to the element that still has `identity`. Returns a fresh,
     * validated selector and emits a WARN heal event. Returns { healed:false } if it cannot.
     *
     * @param {object} args
     * @param {string} [args.brokenSelector] - The selector that failed (for the audit trail).
     * @param {string} args.identity - The stable identity captured when the selector last worked.
     * @param {string} [args.reason] - Why healing was triggered (e.g. 'selector-miss').
     */
    async heal({ brokenSelector = null, identity, reason = 'selector-miss' } = {}) {
        if (!this._residentAvailable() || !identity) { this._stats.misses += 1; return { healed: false, reason: 'no-resident-or-identity' }; }

        // Refresh the resident model into snapshotRefs (cheap — served from the live twin),
        // so the re-anchored element carries a freshly-scored, validated selector.
        try { await this._bridge.snapshot({ useCache: true }); } catch { /* continue */ }

        let ref = null;
        try {
            ref = await this._bridge.page.evaluate((k) => {
                const fp = window.__cbr ? window.__cbr.resolveIdentity(k) : null;
                return fp ? fp.ref : null;
            }, identity);
        } catch { /* page navigated */ }

        if (!ref || !this._bridge.snapshotRefs.has(ref)) { this._stats.misses += 1; return { healed: false, reason: 'identity-not-found' }; }

        const el = this._bridge.snapshotRefs.get(ref);
        // Build a FRESH, validated selector from the re-anchored element's fingerprint in
        // stability order. We do NOT trust the snapshot's scored cssSelector here: for
        // role+name elements it can be a lossy CSS approximation (e.g. [aria-label="X"] when
        // the name comes from text) that never resolves. Each candidate is validated with the
        // matching API — querySelectorAll for CSS, locator.count for getByRole/getByText.
        const fresh = await this._buildFreshSelector(el);
        if (!fresh) { this._stats.misses += 1; return { healed: false, reason: 'no-validated-selector' }; }

        const strategy = `identity-reanchor:${fresh.strategy}`;
        const confidence = fresh.strategy === 'test-id' ? 0.97 : (fresh.strategy === 'role+name' ? 0.9 : 0.8);
        const heal = {
            type: 'selector-heal',
            level: 'warn',                 // QA-integrity: surfaced, not hidden
            original: brokenSelector,
            healedTo: fresh.selector,
            playwrightSelector: fresh.kind === 'css' ? null : fresh.selector,
            cssSelector: fresh.kind === 'css' ? fresh.selector : null,
            selectorKind: fresh.kind,      // 'css' | 'locator'
            ref,
            identity,
            strategy,
            confidence,
            reason,
            at: Date.now(),
        };
        this._stats.heals += 1;
        if (this._healStore) this._healStore.recordHeal({ identity, brokenSelector, healedSelector: fresh.selector, strategy });
        if (this._onHeal) { try { this._onHeal(heal); } catch { /* sink error isolated */ } }
        return { healed: true, ...heal };
    }

    /**
     * Build a fresh, validated selector from an element fingerprint, trying anchors in
     * descending stability and validating each before returning. Returns
     * { selector, kind:'css'|'locator', strategy } or null.
     */
    async _buildFreshSelector(el) {
        const page = this._bridge.page;
        const uniqueCss = async (css) => {
            try { return await page.evaluate((s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } }, css); }
            catch { return false; }
        };
        const uniqueLocator = async (loc) => { try { return (await loc.count()) === 1; } catch { return false; } };

        // 1. Test id (most stable, pure CSS).
        const tid = el.dataTestId || el.dataTestIdAlt || el.dataQa;
        if (tid) {
            const css = `[data-testid="${cssEscape(tid)}"]`;
            // data-qa / data-test-id variants are also worth trying if the canonical one misses.
            if (await uniqueCss(css)) return { selector: css, kind: 'css', strategy: 'test-id' };
            for (const attr of ['data-test-id', 'data-qa']) {
                const alt = `[${attr}="${cssEscape(tid)}"]`;
                if (await uniqueCss(alt)) return { selector: alt, kind: 'css', strategy: 'test-id' };
            }
        }

        // 2. Role + accessible name (Playwright locator — robust to text-vs-aria-label).
        const role = el.role || SelectorEngine.mapAriaRole(el.role, el.tag) || el.tag;
        const name = (el.computedLabel || el.ariaLabel || el.associatedLabel || el.text || '').trim();
        if (role && name) {
            const loc = page.getByRole(role, { name, exact: true });
            if (await uniqueLocator(loc)) {
                return { selector: `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true })`, kind: 'locator', strategy: 'role+name' };
            }
        }

        // 3. Stable (non-dynamic) id.
        if (el.id && !SelectorEngine.isDynamicId(el.id)) {
            const css = `#${cssEscape(el.id)}`;
            if (await uniqueCss(css)) return { selector: css, kind: 'css', strategy: 'css-id' };
        }

        // 4. Exact accessible name via text (last resort).
        if (name) {
            const loc = page.getByText(name, { exact: true });
            if (await uniqueLocator(loc)) {
                return { selector: `getByText(${JSON.stringify(name)}, { exact: true })`, kind: 'locator', strategy: 'text' };
            }
        }

        return null;
    }

    /**
     * Convenience: try a selector; if it does not resolve to exactly one element, heal it via
     * the known identity. Returns { ok, selector, healed?, heal? }.
     */
    async resolveOrHeal({ selector, identity } = {}) {
        if (selector) {
            let count = 0;
            try { count = await this._bridge.page.locator(selector).count(); } catch { count = 0; }
            if (count === 1) return { ok: true, selector, healed: false };
        }
        const healed = await this.heal({ brokenSelector: selector, identity });
        if (healed.healed) return { ok: true, selector: healed.healedTo, selectorKind: healed.selectorKind, healed: true, heal: healed };
        return { ok: false, selector, healed: false, reason: healed.reason };
    }
}

/** Minimal CSS attribute/id value escape for building safe selectors. */
function cssEscape(value) {
    return String(value).replace(/["\\\]]/g, '\\$&');
}

export default HealingResolver;
