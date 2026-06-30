/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HEAL STORE — cross-run selector-stability learning  (Phase 4 of the Cognitive Browser Runtime)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Persists what the self-healing resolver learns: for each logical element (keyed by its
 * semantic identity, e.g. "button|save property"), which selectors have broken, which
 * selector healed it, how often, and the most stable selector observed. Future resolutions
 * can prefer the learned-stable selector instead of a brittle one.
 *
 * This is the durable memory behind "selectors that don't break across runs". It mirrors the
 * grounding selector-registry's intent but stays self-contained for the runtime; a later pass
 * can feed these records into grounding/selector-registry.js.
 *
 * Pure Node, JSON-backed, debounced writes. No Playwright dependency.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, 'heal-data');

export class HealStore {
    /**
     * @param {object} [options]
     * @param {string} [options.filePath] - Where to persist (defaults to runtime/heal-data/heal-store.json).
     * @param {boolean} [options.persist=true] - Set false for ephemeral/in-memory use (tests).
     */
    constructor(options = {}) {
        this._persist = options.persist !== false;
        this._filePath = options.filePath || path.join(DEFAULT_DIR, 'heal-store.json');
        this._writeTimer = null;
        /** @type {Map<string, object>} identity → record */
        this._records = new Map();
        this._load();
    }

    _load() {
        if (!this._persist) return;
        try {
            if (fs.existsSync(this._filePath)) {
                const raw = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
                for (const [k, v] of Object.entries(raw.identities || {})) this._records.set(k, v);
            }
        } catch { /* corrupt/missing → start fresh */ }
    }

    _scheduleWrite() {
        if (!this._persist) return;
        if (this._writeTimer) return;
        this._writeTimer = setTimeout(() => {
            this._writeTimer = null;
            this._flush();
        }, 250);
        if (this._writeTimer.unref) this._writeTimer.unref();
    }

    _flush() {
        if (!this._persist) return;
        try {
            fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
            const out = { version: 1, updatedAt: new Date().toISOString(), identities: Object.fromEntries(this._records) };
            fs.writeFileSync(this._filePath, JSON.stringify(out, null, 2));
        } catch { /* best-effort persistence */ }
    }

    _ensure(identity) {
        let rec = this._records.get(identity);
        if (!rec) {
            rec = {
                identity,
                stableSelector: null,
                stableStrategy: null,
                resolveCount: 0,
                healCount: 0,
                brokenSelectors: {},
                healedSelectors: {},
                strategies: {},
                firstSeen: new Date().toISOString(),
                lastHealedAt: null,
            };
            this._records.set(identity, rec);
        }
        return rec;
    }

    /**
     * Record a successful (non-healed) resolution — reinforces the working selector as stable.
     */
    recordResolve(identity, selector, strategy) {
        if (!identity) return;
        const rec = this._ensure(identity);
        rec.resolveCount += 1;
        // A test-id / role-based selector that keeps working is our stable anchor.
        if (selector && (!rec.stableSelector || isMoreStable(strategy, rec.stableStrategy))) {
            rec.stableSelector = selector;
            rec.stableStrategy = strategy || rec.stableStrategy;
        }
        this._scheduleWrite();
    }

    /**
     * Record a heal: the brokenSelector failed and the resolver re-anchored to healedSelector
     * via `strategy`. Surfaced as a WARN by the resolver (never hidden) — this just persists it.
     */
    recordHeal({ identity, brokenSelector, healedSelector, strategy }) {
        if (!identity) return;
        const rec = this._ensure(identity);
        rec.healCount += 1;
        rec.lastHealedAt = new Date().toISOString();
        if (brokenSelector) rec.brokenSelectors[brokenSelector] = (rec.brokenSelectors[brokenSelector] || 0) + 1;
        if (healedSelector) rec.healedSelectors[healedSelector] = (rec.healedSelectors[healedSelector] || 0) + 1;
        if (strategy) rec.strategies[strategy] = (rec.strategies[strategy] || 0) + 1;
        // The selector that healed becomes the new stable anchor if it's more stable.
        if (healedSelector && (!rec.stableSelector || isMoreStable(strategy, rec.stableStrategy))) {
            rec.stableSelector = healedSelector;
            rec.stableStrategy = strategy || rec.stableStrategy;
        }
        this._scheduleWrite();
    }

    /** The best-known stable selector for an identity, or null. */
    bestSelector(identity) {
        return this._records.get(identity)?.stableSelector || null;
    }

    getRecord(identity) {
        const rec = this._records.get(identity);
        return rec ? { ...rec } : null;
    }

    stats() {
        let healCount = 0, resolveCount = 0;
        for (const rec of this._records.values()) { healCount += rec.healCount; resolveCount += rec.resolveCount; }
        return { identities: this._records.size, totalHeals: healCount, totalResolves: resolveCount };
    }

    /** Force a synchronous flush (call on shutdown). */
    flush() { if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; } this._flush(); }
}

// Selector strategy stability ranking — higher wins as the "stable" anchor.
const STRATEGY_RANK = {
    'test-id': 6, 'testid': 6, 'data-qa': 6,
    'identity-reanchor': 5,
    'role+name': 4, 'role': 4,
    'aria-label': 3, 'label': 3,
    'fuzzy-match': 2,
    'text': 1,
    'css': 1, 'selector': 1,
};
function isMoreStable(newStrategy, currentStrategy) {
    const a = STRATEGY_RANK[String(newStrategy || '').toLowerCase()] || 0;
    const b = STRATEGY_RANK[String(currentStrategy || '').toLowerCase()] || 0;
    return a >= b;
}

export default HealStore;
