'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · VERB `sense` — zero-mutation business intuition over the current state
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   sense({ mode:'intent'|'plan'|'verdict'|'full', expect?, tab? })
 *
 * The cognition primitive: it never mutates the page. It perceives (see), reads a
 * bounded slice of text (read), samples runtime signals (net/console), and runs the
 * deterministic kernel to answer three questions a human answers intuitively:
 *   • intent  — what kind of app is this, and where am I in its flow?  (Pillar 1)
 *   • plan    — which affordances advance the happy path vs edge cases? (Pillar 2)
 *   • verdict — did the last action succeed, error, or get blocked?     (Pillar 3)
 *
 * Driver-neutral: it talks to a tiny `cogHost` adapter (perceive/readText/runtime/
 * cognition), so the identical logic serves both the Playwright and raw-CDP drivers.
 *
 * @module glass-mcp/verbs/sense
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const TEXT_BUDGET = 8000;

/** Gather the driver-neutral observation bundle (perception + text + runtime). */
async function observe(cogHost, opts = {}) {
    const perception = opts.perception || await cogHost.perceive({ keepBaseline: true });
    const pageText = await safe(() => cogHost.readText(TEXT_BUDGET), '');
    const runtime = await safe(() => cogHost.runtime(), { netEvents: [], consoleEvents: [] });
    return { perception, pageText, runtime };
}

/**
 * The `sense` verb.
 * @param {Object} cogHost  { cognition(), perceive(opts), readText(max), runtime() }
 * @param {Object} args     { mode?, expect? }
 */
async function senseVerb(cogHost, args = {}) {
    const mode = args.mode || 'full';
    if (!['intent', 'plan', 'verdict', 'full'].includes(mode)) {
        return { ok: false, code: 'GLASS_SENSE_BAD_MODE', error: `unknown mode: ${mode}` };
    }
    try {
        const { perception, pageText, runtime } = await observe(cogHost);
        const cognition = cogHost.cognition();
        const result = await cognition.sense({ perception, pageText, runtime, mode, expect: args.expect });
        return { ok: true, ...result };
    } catch (e) {
        return { ok: false, code: 'GLASS_SENSE_ERROR', error: compact(e) };
    }
}

/**
 * Opt-in enrichment for a see() receipt (allow includes 'intuition'). Uses the
 * perception see() already computed — no second perception pass.
 */
async function enrichSeeReceipt(cogHost, seen) {
    try {
        const pageText = await safe(() => cogHost.readText(TEXT_BUDGET), '');
        const runtime = await safe(() => cogHost.runtime(), { netEvents: [], consoleEvents: [] });
        return await cogHost.cognition().enrichSee(seen, { pageText, runtime });
    } catch (e) {
        return { error: compact(e) };
    }
}

/**
 * Opt-in enrichment for a do() receipt (allow includes 'verdict'). Perceives the
 * state the action produced and judges it causally (before → after).
 */
async function enrichDoReceipt(cogHost, receipt, opts = {}) {
    try {
        const { perception, pageText, runtime } = await observe(cogHost);
        return await cogHost.cognition().enrichDo(
            { perception, pageText, runtime },
            { action: { action: receipt.action, target: opts.target, effect: receipt.effect }, expect: opts.expect },
        );
    } catch (e) {
        return { error: compact(e) };
    }
}

async function safe(fn, fallback) {
    try { const v = await fn(); return v == null ? fallback : v; } catch { return fallback; }
}
function compact(e) { return String((e && e.message) || e).slice(0, 200); }

module.exports = { senseVerb, enrichSeeReceipt, enrichDoReceipt };
