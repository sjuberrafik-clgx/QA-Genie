/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * GRAPH RECORDER — feeds CBR perception into the AppGraph  (Phase 6 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Bridges live perception → the application knowledge graph. It captures the current page
 * state (URL, title, interactive element names) and records transitions between states,
 * labeled by the action that caused them. The bridge calls this on navigation and after
 * interactions when MCP_APP_GRAPH is enabled; tests can also drive it directly.
 *
 * Stateless beyond a small "what state were we in / what did we just do" memory, so it can
 * pair an action with the state change it produced.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export class GraphRecorder {
    /**
     * @param {object} bridge - PlaywrightDirectBridge (for page + snapshotRefs).
     * @param {import('./app-graph.js').AppGraph} appGraph
     */
    constructor(bridge, appGraph) {
        this._bridge = bridge;
        this._graph = appGraph;
        this._prevUrl = null;       // URL of the last recorded state
        this._pendingAction = null; // label of the action expected to cause the next transition
    }

    get graph() { return this._graph; }

    /** Note the action just performed (its resolved target name), to label the next transition. */
    noteAction(label) {
        if (label) this._pendingAction = String(label).slice(0, 80);
    }

    /** Interactive element names from the current snapshotRefs (best-effort, capped). */
    _currentElementNames() {
        const names = [];
        for (const [, el] of this._bridge.snapshotRefs || []) {
            if (!el.isInteractive) continue;
            const n = el.computedLabel || el.ariaLabel || el.text || el.name || el.visualLabel;
            if (n) names.push(String(n).slice(0, 80));
            if (names.length >= 60) break;
        }
        return names;
    }

    /**
     * Record the current page as a state, and — if the URL changed since the last recorded
     * state — record the transition that brought us here (labeled by the pending action).
     * @param {object} [opts]
     * @param {boolean} [opts.snapshot=false] - Take a fresh snapshot first to populate names.
     */
    async recordCurrent({ snapshot = false } = {}) {
        if (!this._bridge.page) return null;
        if (snapshot) { try { await this._bridge.snapshot({ useCache: true }); } catch { /* best-effort */ } }

        const url = this._bridge.page.url();
        let title = null;
        try { title = await this._bridge.page.title(); } catch { /* ignore */ }
        const elementNames = this._currentElementNames();

        // Transition first (so both endpoints exist), then reinforce the destination state.
        if (this._prevUrl && this.normalize(url) !== this.normalize(this._prevUrl)) {
            this._graph.recordTransition({ fromUrl: this._prevUrl, toUrl: url, action: this._pendingAction || 'navigate' });
        }
        const id = this._graph.recordState({ url, title, elementNames });
        this._prevUrl = url;
        this._pendingAction = null;
        return id;
    }

    normalize(url) { return this._graph.normalizeUrl(url); }

    /** Reset the journey memory (e.g. when starting a fresh exploration). */
    reset() { this._prevUrl = null; this._pendingAction = null; }
}

export default GraphRecorder;
