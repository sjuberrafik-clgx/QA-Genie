/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * PERCEPTION STORE  — Node-side authoritative mirror of the in-page Digital Twin
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Receives delta pushes from the resident perception agent (via the __cbrPush binding) and
 * maintains a lightweight, per-page record of the live model's version and recent deltas.
 *
 * Phase 1 keeps this deliberately lean: it tracks version/freshness and a rolling delta log
 * so the bridge can (a) know whether a re-perceive is even necessary and (b) hand the
 * reactive core (P2) a stream of structural change events. The authoritative element
 * fingerprints still live in-page and are pulled on demand via __cbr.perceive(); this store
 * is the synchronization spine those later phases extend.
 *
 * Pure Node, no Playwright dependency — unit-testable in isolation.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export class PerceptionStore {
    /**
     * @param {object} [options]
     * @param {number} [options.maxDeltaLog=200] - Ring-buffer size for the recent delta log.
     * @param {(evt: object) => void} [options.onDelta] - Optional hook fired on every push
     *        (the seam the event-driven reactive core subscribes to in P2).
     */
    constructor(options = {}) {
        this._maxDeltaLog = options.maxDeltaLog ?? 200;
        this._onDelta = typeof options.onDelta === 'function' ? options.onDelta : null;

        /** @type {Map<string, { version, total, lastPushAt, ready, deltas: object[], totals }>} */
        this._pages = new Map();
        this._stats = { pushes: 0, readyEvents: 0, deltaEvents: 0 };
    }

    /** Stable key for a Playwright Page (falls back to a monotonic id). */
    _pageKey(page) {
        if (!page) return 'default';
        if (!page.__cbrKey) {
            Object.defineProperty(page, '__cbrKey', {
                value: 'page-' + (PerceptionStore._seq = (PerceptionStore._seq || 0) + 1),
                enumerable: false,
            });
        }
        return page.__cbrKey;
    }

    _ensure(key) {
        let rec = this._pages.get(key);
        if (!rec) {
            rec = { version: 0, total: 0, ready: false, lastPushAt: 0, deltas: [], totals: { added: 0, removed: 0, updated: 0 } };
            this._pages.set(key, rec);
        }
        return rec;
    }

    /**
     * Apply a push payload from the resident agent.
     * @param {object} page - Playwright Page the push originated from.
     * @param {object} payload - { type, version, added, removed, updated, total }
     */
    applyPush(page, payload) {
        if (!payload || typeof payload !== 'object') return;
        const key = this._pageKey(page);
        const rec = this._ensure(key);

        rec.version = payload.version ?? rec.version;
        rec.total = payload.total ?? rec.total;
        rec.lastPushAt = Date.now();
        this._stats.pushes += 1;

        if (payload.type === 'ready') {
            rec.ready = true;
            this._stats.readyEvents += 1;
        } else if (payload.type === 'perception-delta') {
            this._stats.deltaEvents += 1;
            rec.totals.added += (payload.added?.length || 0);
            rec.totals.removed += (payload.removed?.length || 0);
            rec.totals.updated += (payload.updated?.length || 0);
            rec.deltas.push({
                version: payload.version,
                added: payload.added?.length || 0,
                removed: payload.removed?.length || 0,
                updated: payload.updated?.length || 0,
                at: rec.lastPushAt,
            });
            if (rec.deltas.length > this._maxDeltaLog) rec.deltas.shift();
        }

        if (this._onDelta) {
            try { this._onDelta({ pageKey: key, ...payload }); } catch { /* subscriber error isolated */ }
        }
    }

    /** Current known model version for a page (0 if never pushed). */
    getVersion(page) {
        return this._pages.get(this._pageKey(page))?.version ?? 0;
    }

    /** Whether the resident agent has announced readiness for this page. */
    isReady(page) {
        return this._pages.get(this._pageKey(page))?.ready === true;
    }

    /** Snapshot of a page's perception record (for diagnostics / the reactive core). */
    getRecord(page) {
        const rec = this._pages.get(this._pageKey(page));
        if (!rec) return null;
        return {
            version: rec.version,
            total: rec.total,
            ready: rec.ready,
            lastPushAt: rec.lastPushAt,
            recentDeltas: rec.deltas.slice(-10),
            totals: { ...rec.totals },
        };
    }

    /** Drop a page's record (call on page close to avoid leaks). */
    forget(page) {
        this._pages.delete(this._pageKey(page));
    }

    stats() {
        return { ...this._stats, pages: this._pages.size };
    }
}

export default PerceptionStore;
