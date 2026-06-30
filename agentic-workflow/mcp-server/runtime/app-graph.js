/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * APP GRAPH — application knowledge graph / reasoning engine  (Phase 6 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A durable graph of the APPLICATION as the runtime explores it:
 *   • Nodes  = page states (keyed by normalized URL), each holding title, interactive element
 *              names, seen APIs, observation count, and a confidence level.
 *   • Edges  = journeys/actions (state → state via a labeled action, e.g. "Save property").
 *
 * Once explored, it answers product questions WITHOUT opening the browser:
 *     graph.howDoI("save a property")
 *        → [ {action:"Search properties"}, {action:"View 101 Oak St"}, {action:"Save property"} ]
 *
 * This realizes ChatGPT's "Browser Neural Map / answer-without-browser" idea while honoring the
 * decision to REUSE the Cognitive Context Mesh: it mirrors the CCM confidence vocabulary
 * (verified/strong/inferred/overview/ungrounded — see ccm/coverage-map.js) and persists into the
 * shared ccm-data/ directory, rather than inventing a parallel confidence scheme.
 *
 * Pure Node (ESM), JSON-backed, no Playwright dependency — unit-testable in isolation.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Persist alongside the rest of the CCM data (shared home, not a parallel store).
const DEFAULT_DATA_FILE = path.join(__dirname, '..', '..', 'ccm-data', 'app-graph.json');

// Mirrors ccm/coverage-map.js CONFIDENCE_LEVELS — the single conceptual source of truth.
export const CONFIDENCE_LEVELS = {
    VERIFIED: 'verified',
    STRONG: 'strong',
    INFERRED: 'inferred',
    OVERVIEW: 'overview',
    UNGROUNDED: 'ungrounded',
};

// Same thresholds as ccm/coverage-map.js confidenceToStatus().
function confidenceToStatus(c) {
    if (c >= 0.9) return CONFIDENCE_LEVELS.VERIFIED;
    if (c >= 0.65) return CONFIDENCE_LEVELS.STRONG;
    if (c >= 0.35) return CONFIDENCE_LEVELS.INFERRED;
    if (c >= 0.15) return CONFIDENCE_LEVELS.OVERVIEW;
    return CONFIDENCE_LEVELS.UNGROUNDED;
}

// Confidence rises with repeated observation (a state/edge seen many times is trustworthy;
// seen once is merely inferred). Saturates below 1 so nothing is ever "certain".
function observationConfidence(count) {
    return Math.min(0.95, 0.25 + 0.17 * Math.max(0, count));
}

const STOPWORDS = new Set(['how', 'do', 'i', 'to', 'a', 'an', 'the', 'can', 'me', 'my', 'is', 'on', 'of', 'in', 'and', 'with', 'for', 'please', 'want']);
function tokenize(text) {
    return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));
}

export class AppGraph {
    /**
     * @param {object} [options]
     * @param {string} [options.dataFile] - Persistence path (defaults to ccm-data/app-graph.json).
     * @param {boolean} [options.persist=true] - false for ephemeral/in-memory use (tests).
     * @param {boolean} [options.stripQuery=true] - Drop query/hash when keying state by URL.
     */
    constructor(options = {}) {
        this._persist = options.persist !== false;
        this._dataFile = options.dataFile || DEFAULT_DATA_FILE;
        this._stripQuery = options.stripQuery !== false;
        this._writeTimer = null;
        /** @type {Map<string, object>} stateId → node */
        this._states = new Map();
        /** @type {Map<string, object>} edgeId → edge */
        this._edges = new Map();
        this._load();
    }

    // ─── State identity ──────────────────────────────────────────────────────

    normalizeUrl(url) {
        if (!url) return 'about:blank';
        try {
            const u = new URL(url);
            if (this._stripQuery) return `${u.origin}${u.pathname}`;
            return `${u.origin}${u.pathname}${u.search}${u.hash}`;
        } catch {
            return String(url).split(this._stripQuery ? /[?#]/ : /\s/)[0];
        }
    }

    stateId(url) {
        const norm = this.normalizeUrl(url);
        // Short, stable id derived from the normalized URL's tail (readable in queries).
        const tail = norm.replace(/\/$/, '').split('/').pop() || norm;
        return tail || norm;
    }

    // ─── Recording ───────────────────────────────────────────────────────────

    /**
     * Record (or reinforce) a page state.
     * @param {object} obs
     * @param {string} obs.url
     * @param {string} [obs.title]
     * @param {string[]} [obs.elementNames] - Interactive element names observed on the page.
     * @param {string[]} [obs.apis] - API paths seen while on this state.
     * @returns {string} stateId
     */
    recordState({ url, title = null, elementNames = [], apis = [] } = {}) {
        const id = this.stateId(url);
        let node = this._states.get(id);
        if (!node) {
            node = {
                id, url: this.normalizeUrl(url), title: title || null,
                elementNames: [], apis: [], observedCount: 0,
                firstSeen: new Date().toISOString(), lastSeen: null,
            };
            this._states.set(id, node);
        }
        if (title && !node.title) node.title = title;
        node.elementNames = unionCap(node.elementNames, elementNames, 60);
        node.apis = unionCap(node.apis, apis, 40);
        node.observedCount += 1;
        node.lastSeen = new Date().toISOString();
        node.confidence = observationConfidence(node.observedCount);
        node.status = confidenceToStatus(node.confidence);
        this._scheduleWrite();
        return id;
    }

    /**
     * Record (or reinforce) a transition between two states via a labeled action.
     * @param {object} t
     * @param {string} t.fromUrl
     * @param {string} t.toUrl
     * @param {string} t.action - The action that caused the transition (e.g. "Save property").
     * @returns {string} edgeId
     */
    recordTransition({ fromUrl, toUrl, action = '' } = {}) {
        const from = this.stateId(fromUrl);
        const to = this.stateId(toUrl);
        // A transition implies both endpoints are real states — ensure bare nodes exist so the
        // graph stays connected even if recordState() wasn't called for one of them.
        this._ensureStateNode(fromUrl);
        this._ensureStateNode(toUrl);
        const label = String(action || '').trim();
        const edgeId = `${from}->${to}:${label.toLowerCase()}`;
        let edge = this._edges.get(edgeId);
        if (!edge) {
            edge = { id: edgeId, from, to, action: label, observedCount: 0, firstSeen: new Date().toISOString(), lastSeen: null };
            this._edges.set(edgeId, edge);
        }
        edge.observedCount += 1;
        edge.lastSeen = new Date().toISOString();
        edge.confidence = observationConfidence(edge.observedCount);
        edge.status = confidenceToStatus(edge.confidence);
        this._scheduleWrite();
        return edgeId;
    }

    /** Ensure a bare state node exists for a URL (used to keep the graph connected). */
    _ensureStateNode(url) {
        const id = this.stateId(url);
        if (!this._states.has(id)) {
            this._states.set(id, {
                id, url: this.normalizeUrl(url), title: null, elementNames: [], apis: [],
                observedCount: 0, confidence: observationConfidence(0), status: confidenceToStatus(observationConfidence(0)),
                firstSeen: new Date().toISOString(), lastSeen: null,
            });
        }
        return id;
    }

    // ─── Query ───────────────────────────────────────────────────────────────

    /**
     * Answer "how do I <goal>?" from the graph alone (no browser). Returns the best journey:
     * a path of labeled actions ending at the edge/state that best matches the goal.
     * @param {string} goal
     * @returns {{found:boolean, path:Array, confidence:number, status:string, matched?:object}}
     */
    howDoI(goal) {
        const tokens = tokenize(goal);
        if (!tokens.length || this._edges.size === 0) return { found: false, path: [], confidence: 0, status: CONFIDENCE_LEVELS.UNGROUNDED };

        // 1. Score every edge by how well it matches the goal. The ACTION label dominates
        //    ("how do I X" is answered by the action that does X); the destination's title and
        //    element names are weak context only — otherwise a page that CONTAINS a "Save"
        //    button would wrongly match the edge that merely LEADS to that page.
        let best = null;
        for (const edge of this._edges.values()) {
            const dest = this._states.get(edge.to);
            const actionScore = overlapScore(tokens, edge.action);
            const destScore = overlapScore(tokens, [dest?.title, ...(dest?.elementNames || [])].join(' '));
            const score = actionScore + destScore * 0.2;
            if (score > 0 && (!best || score > best.score || (score === best.score && edge.confidence > best.edge.confidence))) {
                best = { edge, score, dest };
            }
        }
        if (!best) return { found: false, path: [], confidence: 0, status: CONFIDENCE_LEVELS.UNGROUNDED };

        // 2. Find the shortest action path from an entry state to the target edge's source,
        //    then append the target edge — the full "how to" journey.
        const pathEdges = this._shortestPathTo(best.edge.from);
        pathEdges.push(best.edge);

        const confidence = pathEdges.reduce((min, e) => Math.min(min, e.confidence ?? 0), 1);
        return {
            found: true,
            path: pathEdges.map((e) => ({
                action: e.action,
                from: e.from,
                to: e.to,
                fromUrl: this._states.get(e.from)?.url || null,
                toUrl: this._states.get(e.to)?.url || null,
                confidence: e.confidence,
                status: e.status,
            })),
            confidence,
            status: confidenceToStatus(confidence),
            matched: { action: best.edge.action, destination: best.dest?.title || best.edge.to },
        };
    }

    /** BFS over edges from an entry state (no incoming edges) to `targetStateId`. */
    _shortestPathTo(targetStateId) {
        const incoming = new Set([...this._edges.values()].map((e) => e.to));
        const entries = [...this._states.keys()].filter((id) => !incoming.has(id));
        const starts = entries.length ? entries : [...this._states.keys()];
        if (starts.includes(targetStateId)) return [];

        const adj = new Map();
        for (const e of this._edges.values()) {
            if (!adj.has(e.from)) adj.set(e.from, []);
            adj.get(e.from).push(e);
        }

        let bestPath = null;
        for (const start of starts) {
            const q = [{ id: start, path: [] }];
            const seen = new Set([start]);
            while (q.length) {
                const { id, path: p } = q.shift();
                if (id === targetStateId) { if (!bestPath || p.length < bestPath.length) bestPath = p; break; }
                for (const e of adj.get(id) || []) {
                    if (seen.has(e.to)) continue;
                    seen.add(e.to);
                    q.push({ id: e.to, path: [...p, e] });
                }
            }
        }
        return bestPath || [];
    }

    // ─── Accessors ───────────────────────────────────────────────────────────

    getState(url) { return this._states.get(this.stateId(url)) || null; }
    states() { return [...this._states.values()]; }
    edges() { return [...this._edges.values()]; }
    stats() {
        const byStatus = (items) => items.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {});
        return {
            states: this._states.size,
            edges: this._edges.size,
            stateConfidence: byStatus([...this._states.values()]),
            edgeConfidence: byStatus([...this._edges.values()]),
        };
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    _load() {
        if (!this._persist) return;
        try {
            if (fs.existsSync(this._dataFile)) {
                const raw = JSON.parse(fs.readFileSync(this._dataFile, 'utf8'));
                for (const s of raw.states || []) this._states.set(s.id, s);
                for (const e of raw.edges || []) this._edges.set(e.id, e);
            }
        } catch { /* corrupt/missing → start fresh */ }
    }

    _scheduleWrite() {
        if (!this._persist || this._writeTimer) return;
        this._writeTimer = setTimeout(() => { this._writeTimer = null; this._flush(); }, 300);
        if (this._writeTimer.unref) this._writeTimer.unref();
    }

    _flush() {
        if (!this._persist) return;
        try {
            fs.mkdirSync(path.dirname(this._dataFile), { recursive: true });
            const out = { version: 1, updatedAt: new Date().toISOString(), states: [...this._states.values()], edges: [...this._edges.values()] };
            fs.writeFileSync(this._dataFile, JSON.stringify(out, null, 2));
        } catch { /* best-effort */ }
    }

    flush() { if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; } this._flush(); }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function unionCap(existing, additions, cap) {
    const set = new Set(existing);
    for (const a of additions || []) { if (a) set.add(String(a).slice(0, 80)); }
    return [...set].slice(0, cap);
}

/** Fraction of goal tokens present in the haystack (0..1), weighted by how many matched. */
function overlapScore(tokens, haystack) {
    const hay = String(haystack || '').toLowerCase();
    let matched = 0;
    for (const t of tokens) if (hay.includes(t)) matched += 1;
    return tokens.length ? matched / tokens.length : 0;
}

export default AppGraph;
