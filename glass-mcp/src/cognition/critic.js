'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · CRITIC — the System-2 escalation seam (host LLM as critic)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * System 1 (the deterministic kernel) is fast, free, and byte-reproducible, but it
 * is a heuristic — sometimes the evidence is genuinely ambiguous. System 2 is the
 * slow, deliberative second opinion. In MCP, the HOST model already IS that second
 * agent, so Glass does not embed an LLM (no keys, preserves zero-config + determinism);
 * instead, when confidence is low it emits a compact `deliberationRequest` — the
 * structured intuition + evidence — for the host to reason over.
 *
 * `CognitiveCritic` is a pluggable seam: the default is a no-op (host-as-critic).
 * An embedder who WANTS an in-process LLM can subclass it and pass an instance via
 * opts.critic — the kernel stays oblivious to how deliberation is answered.
 *
 * @module glass-mcp/cognition/critic
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Base critic. The default implementation performs no deliberation and signals that
 * the host model should decide (`deferToHost: true`).
 */
class CognitiveCritic {
    /**
     * @param {Object} request  { kind, intent?, verdict?, plan?, signalsDigest }
     * @returns {Promise<Object|null>} a decision, or null to defer to the host
     */
    // eslint-disable-next-line no-unused-vars
    async deliberate(request) {
        return null;
    }
}

/** A critic that always defers — the shipped default (host is the critic via MCP). */
class NoopCritic extends CognitiveCritic {
    async deliberate() {
        return null;
    }
}

/**
 * Decide whether System-1 output warrants a System-2 second opinion.
 * @param {number} confidence  the deterministic confidence in [0,1]
 * @param {number} threshold   escalate below this
 */
function shouldEscalate(confidence, threshold) {
    return typeof confidence === 'number' && confidence < threshold;
}

/**
 * Build the compact, host-facing deliberation request. Deliberately small: enough
 * for the host to reason, without dumping raw DOM/token bloat into its context.
 */
function buildDeliberationRequest(kind, payload, signals) {
    return {
        kind,
        reason: 'low-confidence System-1 output; host deliberation requested',
        intent: payload.intent ? { archetype: payload.intent.archetype, stage: payload.intent.stage, confidence: payload.intent.confidence } : undefined,
        verdict: payload.verdict ? { state: payload.verdict.state, confidence: payload.verdict.confidence, topEvidence: (payload.verdict.evidence || []).slice(0, 3) } : undefined,
        expectation: payload.nextExpectation || undefined,
        signalsDigest: signals ? {
            url: signals.url,
            title: signals.title,
            actionable: signals.actionable,
            spinner: signals.spinner,
            net: { has4xx: signals.net.has4xx, has5xx: signals.net.has5xx, hasFailed: signals.net.hasFailed },
            consoleErrors: signals.console.errors,
            topAffordances: (signals.affordances || []).slice(0, 6).map((a) => ({ kind: a.kind, name: a.name })),
        } : undefined,
    };
}

/** Normalise an opts.critic into a usable critic instance (defaults to no-op). */
function resolveCritic(critic) {
    if (critic && typeof critic.deliberate === 'function') return critic;
    return new NoopCritic();
}

module.exports = { CognitiveCritic, NoopCritic, shouldEscalate, buildDeliberationRequest, resolveCritic };
