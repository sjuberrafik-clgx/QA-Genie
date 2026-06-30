/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LLM ROUTER — Constrained Semantic Decider (headless / opt-in second opinion)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The DECIDE layer for when there is no in-loop master agent to make the routing
 * call (headless/CI), or when the caller wants an explicit second opinion.
 *
 * In the INTERACTIVE chat surface we do NOT use this — the TPM (already an LLM in
 * the loop) decides at zero extra cost. This module is the bounded fallback:
 *   - Uses a lightweight, tool-less session (optionally a cheaper/faster model).
 *   - Decides among a CONSTRAINED candidate set (typically the BM25 shortlist), so
 *     the prompt is small and the model cannot invent an agent.
 *   - Structured JSON output; defensively parsed.
 *   - GUARDED: the returned agentId must be one of the candidate ids, else → 'none'
 *     (no hallucinated agents ever escape).
 *
 * Deterministic-ish: callers set a decision cache + (optionally) low temperature so
 * identical asks route consistently.
 *
 * @module sdk-orchestrator/llm-router
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/**
 * Extract the first JSON object from a model response (handles code fences and
 * surrounding prose).
 * @param {string} text
 * @returns {Object|null}
 */
function extractJson(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    // Direct parse
    try { return JSON.parse(trimmed); } catch { /* continue */ }
    // Strip code fences
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
    }
    // First balanced object
    const start = trimmed.indexOf('{');
    if (start >= 0) {
        let depth = 0;
        for (let i = start; i < trimmed.length; i++) {
            if (trimmed[i] === '{') depth++;
            else if (trimmed[i] === '}') {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
                }
            }
        }
    }
    return null;
}

function buildSystemPrompt(candidates) {
    const roster = candidates.map((c, i) =>
        `${i + 1}. id="${c.id}" — ${c.label || c.id}${c.description ? `: ${c.description}` : ''}`
    ).join('\n');

    return [
        'You are a deterministic ROUTING classifier for a multi-agent QA platform.',
        'Given the user message, choose the single BEST specialist agent to handle it,',
        'or indicate that none fits or that clarification is needed.',
        '',
        'You MUST choose an id from this exact list (do not invent ids):',
        roster,
        '',
        'Decision rules:',
        '- Pick the agent whose purpose semantically matches the user INTENT (not just keywords).',
        '- If two agents fit a multi-part request, pick the one for the PRIMARY action.',
        '- If nothing fits, use decision "none".',
        '- If the request is too vague to route, use decision "clarify".',
        '',
        'Respond with ONLY a JSON object, no prose:',
        '{"decision":"route|none|clarify","agentId":"<one id from the list or null>","confidence":0.0-1.0,"rationale":"<short>"}',
    ].join('\n');
}

class LlmRouter {
    /**
     * @param {Object} deps
     * @param {Object} deps.sessionFactory - AgentSessionFactory (provides createLightweightSession).
     * @param {Object} [options]
     * @param {string} [options.model]   - Optional cheaper/faster model override.
     * @param {number} [options.timeoutMs=30000]
     * @param {boolean} [options.verbose]
     */
    constructor(deps = {}, options = {}) {
        this.sessionFactory = deps.sessionFactory;
        this.model = options.model || null;
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.verbose = !!options.verbose;
    }

    /**
     * Decide among candidates.
     *
     * @param {string} message
     * @param {Array<Object>} candidates - [{ id, label, description }] (e.g. BM25 shortlist)
     * @returns {Promise<{ decision: 'route'|'none'|'clarify', agentId: string|null, confidence: number, rationale: string }>}
     */
    async route(message, candidates = []) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return { decision: 'none', agentId: null, confidence: 0, rationale: 'no candidates' };
        }
        if (!this.sessionFactory || typeof this.sessionFactory.createLightweightSession !== 'function') {
            return { decision: 'none', agentId: null, confidence: 0, rationale: 'no session factory' };
        }

        const validIds = new Set(candidates.map(c => c.id));
        const systemPrompt = buildSystemPrompt(candidates);

        let session;
        try {
            session = await this.sessionFactory.createLightweightSession(
                'intent-router', systemPrompt, this.model ? { model: this.model } : {}
            );
        } catch (err) {
            return { decision: 'none', agentId: null, confidence: 0, rationale: `session error: ${err.message}` };
        }

        try {
            const raw = await session.sendAndWait(`User message:\n${message}`, this.timeoutMs);
            const parsed = extractJson(raw);
            if (!parsed || typeof parsed !== 'object') {
                return { decision: 'none', agentId: null, confidence: 0, rationale: 'unparseable router output' };
            }

            let decision = ['route', 'none', 'clarify'].includes(parsed.decision) ? parsed.decision : 'none';
            let agentId = parsed.agentId || null;

            // GUARD: never let a hallucinated id escape.
            if (decision === 'route') {
                if (!agentId || !validIds.has(agentId)) {
                    return { decision: 'none', agentId: null, confidence: 0, rationale: `chosen id not in candidate set (${agentId})` };
                }
            } else {
                agentId = null;
            }

            const confidence = typeof parsed.confidence === 'number'
                ? Math.max(0, Math.min(1, parsed.confidence))
                : 0.5;

            return { decision, agentId, confidence, rationale: String(parsed.rationale || '').slice(0, 200) };
        } catch (err) {
            return { decision: 'none', agentId: null, confidence: 0, rationale: `router call failed: ${err.message}` };
        } finally {
            try { await session.destroy(); } catch { /* best effort */ }
        }
    }
}

module.exports = {
    LlmRouter,
    // exported for tests
    _internals: { extractJson, buildSystemPrompt },
};
