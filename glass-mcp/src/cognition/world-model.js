'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · WORLD-MODEL — a session flow graph for journey-level intuition
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Per-action verdicts see one page at a time. Real "business intuition" is a JOURNEY
 * property: a redirect loop, a dead end, or genuine forward progress only exist
 * across states. This is a bounded, in-memory, session-scoped state machine —
 * nodes are page states, edges are the actions that connected them — enabling
 * DETERMINISTIC detection of:
 *   • loop / redirect-oscillation  (a cycle in the recent path)
 *   • dead end                     (a state with no actionable affordances)
 *   • progress / regression        (movement along the archetype's flow stages)
 *
 * No disk, no clock as identity (a monotonic sequence counter orders events), no
 * workspace coupling — it lives and dies with the session, like see()'s baseline.
 *
 * @module glass-mcp/cognition/world-model
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { fnv1a } = require('../handle');

const MAX_NODES = 500;
const MAX_PATH = 50;
const LOOP_WINDOW = 8;

/**
 * A content-addressed identity for a page STATE. Two observations map to the same
 * node when they are on the same path AND expose the same structural affordance
 * signature — so a re-render of "the checkout form" is one node, but navigating to
 * a genuinely different screen is a new node. Deterministic (sorted, hashed).
 */
function stateKey(signals) {
    const top = signals.affordances
        .map((a) => `${a.kind}:${(a.name || '').toLowerCase().slice(0, 24)}`)
        .sort()
        .slice(0, 12)
        .join('|');
    return fnv1a(`${signals.path}\u241f${top}`);
}

class WorldModel {
    constructor(opts = {}) {
        this.nodes = new Map();      // key → node
        this.edges = [];             // { from, to, action, target, seq }
        this.path = [];              // recent sequence of state keys
        this._seq = 0;
        this._prevKey = null;
        this._prevStageIndex = null;
        this._prevArchetype = null;
        this._pending = null;        // { action, target } awaiting its resulting state
        this.maxNodes = opts.maxNodes || MAX_NODES;
    }

    /** Register the action just performed; the next observe() closes the edge. */
    recordAction(action, target) {
        this._pending = { action: action || 'act', target: target || null };
    }

    /**
     * Fold a new observation into the graph and return what it means for the journey.
     * @param {Object} signals  from extractSignals()
     * @param {Object} intent   from inferIntent()
     * @returns {Object} { key, isNew, revisit, visits, loop, deadEnd, progress, regressed, stageIndex }
     */
    observe(signals, intent) {
        const key = stateKey(signals);
        const seq = ++this._seq;
        const stageIndex = intent && typeof intent.stageIndex === 'number' ? intent.stageIndex : null;

        let node = this.nodes.get(key);
        const isNew = !node;
        if (!node) {
            node = { key, url: signals.url, stage: intent && intent.stage, firstSeq: seq, visits: 0 };
            this.nodes.set(key, node);
            this._evict();
        }
        node.visits += 1;
        node.lastSeq = seq;
        node.actionable = signals.actionable;

        // Close a pending edge from the previous state to this one.
        if (this._prevKey && this._pending) {
            this.edges.push({ from: this._prevKey, to: key, action: this._pending.action, target: this._pending.target, seq });
        }
        this._pending = null;

        this.path.push(key);
        if (this.path.length > MAX_PATH) this.path.shift();

        const loop = this._detectLoop(key);
        const deadEnd = signals.actionable === 0 && !(intent && intent.terminal && intent.stageSuccess);
        let progress = false;
        let regressed = false;
        // Stage indices are only comparable WITHIN one archetype — a mid-journey
        // re-classification is not "progress".
        const archetype = intent && intent.archetype;
        if (stageIndex != null && this._prevStageIndex != null && archetype === this._prevArchetype) {
            progress = stageIndex > this._prevStageIndex;
            regressed = stageIndex < this._prevStageIndex;
        }

        this._prevKey = key;
        if (stageIndex != null) { this._prevStageIndex = stageIndex; this._prevArchetype = archetype; }

        return {
            key,
            isNew,
            revisit: node.visits > 1,
            visits: node.visits,
            loop,
            deadEnd,
            progress,
            regressed,
            stageIndex,
            nodeCount: this.nodes.size,
        };
    }

    /**
     * Loop / redirect-oscillation detection over the recent path:
     *   • strict 2-cycle: …A B A B (bouncing between two states), or
     *   • hot revisit:    the same state key seen ≥ 3× inside the window.
     */
    _detectLoop(key) {
        const w = this.path.slice(-LOOP_WINDOW);
        const seen = w.filter((k) => k === key).length;
        if (seen >= 3) return { kind: 'revisit', count: seen };
        const n = this.path.length;
        if (n >= 4) {
            const [a, b, c, d] = this.path.slice(-4);
            if (a === c && b === d && a !== b) return { kind: 'oscillation', between: [a, b] };
        }
        return null;
    }

    _evict() {
        if (this.nodes.size <= this.maxNodes) return;
        // FIFO by insertion order — drop the oldest untouched node.
        const oldest = this.nodes.keys().next().value;
        if (oldest != null) this.nodes.delete(oldest);
    }

    /** Compact, serialisable snapshot for receipts/telemetry. */
    summary() {
        return { nodes: this.nodes.size, edges: this.edges.length, depth: this.path.length, seq: this._seq };
    }

    reset() {
        this.nodes.clear();
        this.edges = [];
        this.path = [];
        this._seq = 0;
        this._prevKey = null;
        this._prevStageIndex = null;
        this._prevArchetype = null;
        this._pending = null;
    }
}

module.exports = { WorldModel, stateKey };
