/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT INTENT ROUTER — Deterministic RECALL + GUARD (NOT the decider)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Part of the "Semantic Router, LLM-decided, deterministically-guarded" design.
 *
 * This module is intentionally NOT the routing decider. Keyword/BM25 matching is
 * the wrong tool for understanding paraphrase / synonyms / multi-intent — that is
 * the LLM's job (the in-loop master agent, or the constrained micro-router for
 * headless). This module provides the two deterministic things keyword matching IS
 * good at:
 *
 *   1. RECALL  — shortlist the most plausible agents from a (potentially large)
 *      catalog so the LLM roster stays small and no relevant custom agent is
 *      dropped. shortlist() / recommend().
 *   2. GUARD   — validate that a chosen agent id actually exists in the candidate
 *      set (kills hallucinated agents), plus a TTL decision cache for consistency.
 *      validate() / cacheGet() / cacheSet().
 *
 * `recommend()` additionally returns a confident leader when there is a clear,
 * label-anchored winner — used by the optional `deterministic` routing mode and as
 * the hybrid fast-path. Even then, the GUARD (validate) is always applied by the
 * caller.
 *
 * Zero LLM cost. Rebuilds a tiny per-request BM25 index over the candidate roster.
 *
 * @module sdk-orchestrator/agent-intent-router
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// Reuse the grounding tokenizer (stemmer + stopwords) for consistency; fall back
// to a simple tokenizer if the grounding module is unavailable.
let _tokenize;
try {
    ({ tokenize: _tokenize } = require('../grounding/text-indexer'));
} catch {
    _tokenize = null;
}

// Agent-name suffix noise that should never drive routing (CommentGenie → comment).
const NAME_SUFFIX_STOPWORDS = new Set(['genie', 'bot', 'agent', 'ai', 'gpt', 'assistant']);

function simpleTokenize(text) {
    return String(text || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function tokenizeText(text) {
    let toks;
    if (_tokenize) {
        try {
            toks = _tokenize(String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2'), { stem: true, removeStopwords: true });
        } catch {
            toks = simpleTokenize(text);
        }
    } else {
        toks = simpleTokenize(text);
    }
    return toks.filter(t => t && !NAME_SUFFIX_STOPWORDS.has(t));
}

function normalizeMessage(message) {
    return String(message || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
}

// ─── Router ─────────────────────────────────────────────────────────────────

class AgentIntentRouter {
    /**
     * @param {Object} [options]
     * @param {number} [options.k1=1.5]
     * @param {number} [options.b=0.75]
     * @param {number} [options.shortlistK=8]
     * @param {number} [options.confidenceThreshold=0.55]
     * @param {number} [options.marginRatio=1.15]
     * @param {number} [options.cacheTtlMs=300000]
     */
    constructor(options = {}) {
        this.k1 = options.k1 ?? 1.5;
        this.b = options.b ?? 0.75;
        this.shortlistK = options.shortlistK ?? 8;
        this.confidenceThreshold = options.confidenceThreshold ?? 0.55;
        this.marginRatio = options.marginRatio ?? 1.15;
        this.cacheTtlMs = options.cacheTtlMs ?? 300000;
        this._cache = new Map(); // normalizedMessage -> { agentId, at }
    }

    /**
     * Build a weighted token bag for an agent.
     * label ×3 (identity), keywords ×2, description ×1.
     * @returns {{ tokens: string[], labelTokens: Set<string> }}
     */
    _agentTokens(agent) {
        const label = agent.label || agent.name || agent.id || '';
        const keywords = Array.isArray(agent.keywords) ? agent.keywords.join(' ') : (agent.keywords || '');
        const description = agent.description || '';

        const labelToks = tokenizeText(label);
        const kwToks = tokenizeText(keywords);
        const descToks = tokenizeText(description);

        const tokens = [
            ...labelToks, ...labelToks, ...labelToks,
            ...kwToks, ...kwToks,
            ...descToks,
        ];
        return { tokens, labelTokens: new Set(labelToks) };
    }

    /**
     * Rank candidate agents for a message using BM25 over a per-request corpus.
     * @param {string} message
     * @param {Array<Object>} agents - [{ id, label, description, keywords }]
     * @returns {Array<{ agent, score, sharedTerms, labelMatch }>} sorted desc by score
     */
    rank(message, agents = []) {
        const qTokens = tokenizeText(message);
        const qSet = new Set(qTokens);
        if (agents.length === 0 || qTokens.length === 0) {
            return agents.map(agent => ({ agent, score: 0, sharedTerms: 0, labelMatch: false }));
        }

        // Build docs
        const docs = agents.map(agent => {
            const { tokens, labelTokens } = this._agentTokens(agent);
            const tf = new Map();
            for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
            return { agent, tf, len: tokens.length, labelTokens };
        });

        const N = docs.length;
        const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;

        // df per query term
        const df = new Map();
        for (const t of qSet) {
            let c = 0;
            for (const d of docs) if (d.tf.has(t)) c++;
            df.set(t, c);
        }

        const scored = docs.map(d => {
            let score = 0;
            let shared = 0;
            let labelMatch = false;
            for (const t of qSet) {
                const f = d.tf.get(t);
                if (!f) continue;
                shared++;
                if (d.labelTokens.has(t)) labelMatch = true;
                const n = df.get(t);
                const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
                score += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / avgdl));
            }
            return { agent: d.agent, score, sharedTerms: shared, labelMatch };
        });

        scored.sort((a, b) => b.score - a.score || String(a.agent.id).localeCompare(String(b.agent.id)));
        return scored;
    }

    /**
     * RECALL: return the top-K candidate agents for a message.
     * @returns {Array<Object>} agent objects (subset of input), best first
     */
    shortlist(message, agents = [], k = this.shortlistK) {
        return this.rank(message, agents).slice(0, k).map(r => r.agent);
    }

    /**
     * Produce a routing recommendation.
     *
     * Decision semantics:
     *   - 'route'     : a clear, label-anchored leader (deterministic fast-path).
     *   - 'ambiguous' : candidates exist but no confident winner → let the LLM /
     *                   human decide among `shortlist`.
     *   - 'none'      : nothing relevant matched.
     *
     * Confidence rule (hard-won): a single shared term only counts when it hits the
     * agent's LABEL/identity word; otherwise require ≥2 shared terms. Prevents
     * misroutes via incidental words (e.g. "ticket").
     *
     * @returns {{ decision, top, confidence, margin, shortlist }}
     */
    recommend(message, agents = [], options = {}) {
        const ranked = this.rank(message, agents);
        const shortK = options.shortlistK ?? this.shortlistK;
        const shortlist = ranked.slice(0, shortK).map(r => r.agent);

        const top = ranked[0];
        const second = ranked[1];

        if (!top || top.score <= 0) {
            return { decision: 'none', top: null, confidence: 0, margin: 0, shortlist };
        }

        const margin = second && second.score > 0 ? top.score / second.score : Infinity;
        const confidence = second && second.score > 0
            ? top.score / (top.score + second.score)
            : 1;

        const confidenceThreshold = options.confidenceThreshold ?? this.confidenceThreshold;
        const marginRatio = options.marginRatio ?? this.marginRatio;

        const meetsConfidenceRule = top.labelMatch || top.sharedTerms >= 2;
        const isConfident =
            meetsConfidenceRule &&
            confidence >= confidenceThreshold &&
            margin >= marginRatio;

        return {
            decision: isConfident ? 'route' : 'ambiguous',
            top: { agent: top.agent, score: top.score, labelMatch: top.labelMatch, sharedTerms: top.sharedTerms },
            confidence,
            margin: margin === Infinity ? null : margin,
            shortlist,
        };
    }

    /**
     * GUARD: validate that a chosen agent id exists in the candidate set.
     * @returns {{ ok: boolean, agent: Object|null }}
     */
    validate(chosenId, agents = []) {
        if (!chosenId) return { ok: false, agent: null };
        const agent = agents.find(a => a.id === chosenId) || null;
        return { ok: !!agent, agent };
    }

    // ── Decision cache (consistency) ──
    cacheGet(message) {
        const key = normalizeMessage(message);
        const hit = this._cache.get(key);
        if (!hit) return null;
        if (Date.now() - hit.at > this.cacheTtlMs) { this._cache.delete(key); return null; }
        return hit.agentId;
    }

    cacheSet(message, agentId) {
        if (!agentId) return;
        this._cache.set(normalizeMessage(message), { agentId, at: Date.now() });
    }

    clearCache() { this._cache.clear(); }
}

module.exports = {
    AgentIntentRouter,
    normalizeMessage,
    // exported for tests
    _internals: { tokenizeText, simpleTokenize, NAME_SUFFIX_STOPWORDS },
};
