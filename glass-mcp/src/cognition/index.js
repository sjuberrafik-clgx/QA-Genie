'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION — the dual-process business-intuition kernel (orchestrator)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Ties the pure modules into one per-session cognitive engine:
 *
 *   signals → intent (Pillar 1) → world-model + happy-path (Pillar 2) → verdict (Pillar 3)
 *                                                                     ↘ critic (System 2)
 *
 * System 1 is this deterministic pipeline (zero tokens, byte-reproducible). System 2
 * is the host LLM, reached only via a `deliberationRequest` when confidence is low.
 * The engine remembers the last state + last prediction so verdicts are causal
 * (before → after) and assertion-free (predict-then-verify).
 *
 * Pure of any browser: it consumes the plain receipts that see()/read()/net() already
 * return, which is what makes the whole capability standalone and shareable.
 *
 * @module glass-mcp/cognition
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { buildTaxonomy } = require('./taxonomy');
const { extractSignals } = require('./signals');
const { inferIntent } = require('./intent');
const { WorldModel } = require('./world-model');
const { rankPath } = require('./happy-path');
const { judge } = require('./verdict');
const { resolveCritic, shouldEscalate, buildDeliberationRequest } = require('./critic');

const DEFAULT_ESCALATE_BELOW = 0.55;

class Cognition {
    /**
     * @param {Object} [opts]
     * @param {Object}  [opts.taxonomy]       additive archetypes/lexicons (never required)
     * @param {Object}  [opts.critic]         a CognitiveCritic instance (default: no-op / host-as-critic)
     * @param {number}  [opts.escalateBelow]  confidence threshold to request host deliberation
     */
    constructor(opts = {}) {
        this.taxonomy = buildTaxonomy(opts.taxonomy || {});
        this.world = new WorldModel(opts.world || {});
        this.critic = resolveCritic(opts.critic);
        this.escalateBelow = typeof opts.escalateBelow === 'number' ? opts.escalateBelow : DEFAULT_ESCALATE_BELOW;
        this._lastSignals = null;
        this._lastIntent = null;
        this._lastExpectation = null;
    }

    /**
     * The single cognition entrypoint. Observes the current state, and — per mode —
     * infers intent, ranks the happy path, and/or judges the outcome of an action.
     *
     * @param {Object} input
     * @param {Object} input.perception  see() receipt
     * @param {string} [input.pageText]  bounded page text (read({what:'text'}))
     * @param {Object} [input.runtime]   { netEvents, consoleEvents }
     * @param {'intent'|'plan'|'verdict'|'full'} [input.mode='full']
     * @param {Object} [input.expect]    caller-supplied expectation (else last prediction)
     * @param {Object} [input.action]    do() receipt for causal verdicts: { action, target, effect }
     * @returns {Promise<Object>}
     */
    async sense(input = {}) {
        const mode = input.mode || 'full';
        const prev = this._lastSignals;

        if (input.action) this.world.recordAction(input.action.action, input.action.target);

        const signals = extractSignals(input);
        const intent = inferIntent(signals, this.taxonomy);
        const world = this.world.observe(signals, intent);

        const result = {
            mode,
            url: signals.url,
            title: signals.title,
            intent: {
                archetype: intent.archetype,
                label: intent.label,
                confidence: intent.confidence,
                stage: intent.stage,
                stageIndex: intent.stageIndex,
                terminal: intent.terminal,
                evidence: intent.evidence,
                ranking: intent.ranking,
            },
            world: {
                ...this.world.summary(),
                isNew: world.isNew,
                revisit: world.revisit,
                loop: world.loop,
                deadEnd: world.deadEnd,
                progress: world.progress,
                regressed: world.regressed,
            },
        };

        if (mode === 'plan' || mode === 'full') {
            const ranked = rankPath(signals, intent, this.taxonomy);
            result.happyPath = ranked.happyPath;
            result.edgeCases = ranked.edgeCases;
            result.nextExpectation = ranked.nextExpectation;
            this._lastExpectation = ranked.nextExpectation;
        }

        if (mode === 'verdict' || mode === 'full') {
            result.verdict = judge({
                prev,
                current: signals,
                expect: input.expect || this._lastExpectation,
                world,
                action: input.action || null,
            }, this.taxonomy);
        }

        // System-2 escalation: gate on the most decision-relevant confidence.
        const gateConfidence = result.verdict ? result.verdict.confidence : intent.confidence;
        const gateKind = result.verdict ? 'verdict' : (mode === 'intent' ? 'intent' : 'plan');
        if (shouldEscalate(gateConfidence, this.escalateBelow)) {
            const request = buildDeliberationRequest(gateKind, result, signals);
            result.deliberationRequest = request;
            const decision = await this.critic.deliberate(request);
            if (decision) result.critic = decision;
        }

        this._lastSignals = signals;
        this._lastIntent = intent;
        return result;
    }

    /** Intuition block for an already-computed see() receipt (opt-in enrichment). */
    async enrichSee(perception, extras = {}) {
        const r = await this.sense({ perception, pageText: extras.pageText, runtime: extras.runtime, mode: 'plan' });
        return {
            intent: r.intent,
            happyPath: r.happyPath,
            edgeCases: r.edgeCases,
            nextExpectation: r.nextExpectation,
            world: r.world,
            ...(r.deliberationRequest ? { deliberationRequest: r.deliberationRequest } : {}),
        };
    }

    /** Verdict block for a just-performed action (opt-in enrichment). */
    async enrichDo(observation, extras = {}) {
        const r = await this.sense({
            perception: observation.perception,
            pageText: observation.pageText,
            runtime: observation.runtime,
            mode: 'verdict',
            action: extras.action,
            expect: extras.expect,
        });
        return {
            ...r.verdict,
            intent: r.intent,
            world: r.world,
            ...(r.deliberationRequest ? { deliberationRequest: r.deliberationRequest } : {}),
        };
    }

    reset() {
        this.world.reset();
        this._lastSignals = null;
        this._lastIntent = null;
        this._lastExpectation = null;
    }
}

module.exports = {
    Cognition,
    // re-exports for embedders + tests (pure, no browser)
    buildTaxonomy,
    extractSignals,
    inferIntent,
    WorldModel,
    rankPath,
    judge,
};
