'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · VERDICT — autonomous expected-vs-unexpected judgment (Pillar 3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * "Evaluate the result of every action in real time to determine if the application
 * behaviour is correct or broken — recognising success states (confirmations, status
 * toasts, updated data) and failures (errors, infinite loaders, form resets) without
 * any pre-configured assertions."
 *
 * A deterministic, OODA-style weighted scorer (modelled on the repo's ooda-loop.js):
 * many independent signals each contribute weighted evidence into three buckets —
 * SUCCESS, ERROR, BLOCKED — and the strongest bucket wins, with a calibrated
 * confidence and the full evidence trail. Attribution comes from comparing the state
 * BEFORE vs AFTER the action (new copy, new roles, new console errors), so a verdict
 * reflects what the action CAUSED, not just what happens to be on the page.
 *
 * @module glass-mcp/cognition/verdict
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { countTerms } = require('./signals');

// Tunable evidence weights. Higher = stronger signal. Grouped by the bucket each feeds.
const W = {
    // SUCCESS
    successUrl: 3,
    successCopyNew: 2.5,
    successCopyStatic: 0.8,
    statusRole: 1.2,
    net2xxOnMutation: 1.2,
    stageProgress: 3,
    expectSuccessCopy: 2.5,
    expectSuccessUrl: 1.5,
    // ERROR
    errorCopyNew: 3,
    errorCopyStatic: 0.8,
    alertRole: 1.5,
    net4xx: 2.5,
    net5xx: 3,
    netFailed: 1.5,
    consoleErrorNew: 2,
    expectFailureCopy: 3,
    errorUrl: 3,
    formReset: 2,
    // BLOCKED / BROKEN
    loop: 3,
    spinner: 3,
    noEffect: 2,
    deadEnd: 1.5,
    unchanged: 1.5,
};

// Below this, there simply is not enough evidence to call anything — stay neutral.
const EVIDENCE_FLOOR = 2;

/** Terms present in `now` but not in `before` — the copy the action introduced. */
function newTerms(now, before, terms) {
    const nowHits = countTerms(now || '', terms).hits;
    if (!before) return nowHits;
    const beforeSet = new Set(countTerms(before, terms).hits);
    return nowHits.filter((t) => !beforeSet.has(t));
}

/**
 * Judge the current state, optionally attributing the change to a preceding action.
 * @param {Object} ctx
 * @param {Object} ctx.current  signals AFTER the action (from extractSignals)
 * @param {Object} [ctx.prev]   signals BEFORE the action (enables causal attribution)
 * @param {Object} [ctx.expect] a prior nextExpectation (predict-then-verify)
 * @param {Object} [ctx.world]  world-model observation for `current` (loop/deadEnd/progress)
 * @param {Object} [ctx.action] the do() receipt: { action, effect:{navigated,urlChanged,domChanged} }
 * @param {Object} taxonomy     from buildTaxonomy()
 * @returns {Object} verdict { state, confidence, evidence[], scores, progressed, expectationMet }
 */
function judge(ctx, taxonomy) {
    const current = ctx.current;
    const prev = ctx.prev || null;
    const expect = ctx.expect || null;
    const world = ctx.world || {};
    const action = ctx.action || null;
    const lex = taxonomy.lexicon;
    const urlHints = taxonomy.urlHints;

    const evidence = [];
    const scores = { success: 0, error: 0, blocked: 0 };
    const add = (bucket, weight, signal, detail) => {
        scores[bucket] += weight;
        evidence.push({ state: bucket, signal, weight, detail });
    };

    // ── SUCCESS evidence ──────────────────────────────────────────────────────
    const movedUrl = !prev || prev.path !== current.path;
    const successUrlHit = countTerms(current.path, urlHints.success);
    if (successUrlHit.count && movedUrl) add('success', W.successUrl, 'success-url', successUrlHit.hits.join(','));

    const newSuccessCopy = newTerms(current.corpus, prev && prev.corpus, lex.success);
    if (newSuccessCopy.length) add('success', W.successCopyNew, 'success-copy-new', newSuccessCopy.slice(0, 4).join(','));
    else {
        const staticSuccess = countTerms(current.corpus, lex.success);
        if (staticSuccess.count) add('success', W.successCopyStatic, 'success-copy', staticSuccess.hits.slice(0, 3).join(','));
    }
    if (current.hasStatusRole && newSuccessCopy.length) add('success', W.statusRole, 'status-role', 'live status region with positive copy');
    if (current.net.has2xx && action && isMutating(action)) add('success', W.net2xxOnMutation, 'net-2xx', 'server accepted the submission');
    if (world.progress) add('success', W.stageProgress, 'stage-progress', 'advanced to a later flow stage');

    if (expect) {
        const expSuccessCopy = countTerms(current.corpus, expect.successMarkers || []);
        if (expSuccessCopy.count) add('success', W.expectSuccessCopy, 'expectation-met', `predicted markers seen: ${expSuccessCopy.hits.slice(0, 3).join(',')}`);
        const expSuccessUrl = countTerms(current.path, expect.successUrlHints || []);
        if (expSuccessUrl.count) add('success', W.expectSuccessUrl, 'expectation-url', expSuccessUrl.hits.join(','));
    }

    // ── ERROR evidence ────────────────────────────────────────────────────────
    const errorUrlHit = countTerms(current.path, urlHints.error);
    if (errorUrlHit.count) add('error', W.errorUrl, 'error-url', errorUrlHit.hits.join(','));

    const newErrorCopy = newTerms(current.corpus, prev && prev.corpus, lex.error);
    if (newErrorCopy.length) add('error', W.errorCopyNew, 'error-copy-new', newErrorCopy.slice(0, 4).join(','));
    else {
        const staticError = countTerms(current.corpus, lex.error);
        if (staticError.count) add('error', W.errorCopyStatic, 'error-copy', staticError.hits.slice(0, 3).join(','));
    }
    if (current.hasAlertRole) add('error', W.alertRole, 'alert-role', 'live alert region present');
    if (current.net.has5xx) add('error', W.net5xx, 'net-5xx', 'server error response');
    else if (current.net.has4xx) add('error', W.net4xx, 'net-4xx', 'client error response');
    if (current.net.hasFailed) add('error', W.netFailed, 'net-failed', 'a request failed to complete');
    if (prev && current.console.errors > prev.console.errors) add('error', W.consoleErrorNew, 'console-error', `${current.console.errors - prev.console.errors} new console error(s)`);
    else if (!prev && current.console.errors > 0) add('error', W.consoleErrorNew * 0.5, 'console-error', `${current.console.errors} console error(s)`);
    if (formReset(prev, current, newErrorCopy.length > 0)) add('error', W.formReset, 'form-reset', 'stayed on the form with error copy (likely rejected)');

    if (expect) {
        const expFailureCopy = newTerms(current.corpus, prev && prev.corpus, expect.failureMarkers || []);
        if (expFailureCopy.length) add('error', W.expectFailureCopy, 'expected-failure', `predicted failure markers seen: ${expFailureCopy.slice(0, 3).join(',')}`);
        const expErrorUrl = countTerms(current.path, expect.errorUrlHints || []);
        if (expErrorUrl.count) add('error', W.errorUrl, 'error-url', expErrorUrl.hits.join(','));
    }

    // ── BLOCKED / BROKEN evidence ─────────────────────────────────────────────
    if (world.loop) add('blocked', W.loop, 'loop', `${world.loop.kind} detected in the recent path`);
    if (current.spinner) add('blocked', W.spinner, 'infinite-loader', 'loading indicator persists on a settled, sparse page');
    if (action && isMutating(action) && action.effect && !action.effect.urlChanged && !action.effect.domChanged) {
        add('blocked', W.noEffect, 'no-effect', 'a mutating action produced no observable URL/DOM change');
    }
    if (world.deadEnd) add('blocked', W.deadEnd, 'dead-end', 'no actionable affordances to advance from here');
    if (world.revisit && action && isMutating(action) && !world.progress) add('blocked', W.unchanged, 'unchanged', 'returned to a previously seen state without progress');

    // ── Decide ────────────────────────────────────────────────────────────────
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    const top = ranked[0];
    const topScore = scores[top];
    const secondScore = scores[ranked[1]] || 0;
    const totalEvidence = scores.success + scores.error + scores.blocked;

    let state;
    if (topScore < EVIDENCE_FLOOR) {
        state = 'neutral';
    } else {
        state = top;
    }

    const separation = topScore > 0 ? (topScore - secondScore) / topScore : 0;
    const magnitude = Math.min(1, topScore / 5);
    const share = totalEvidence > 0 ? topScore / totalEvidence : 0;
    const confidence = state === 'neutral'
        ? round(clamp01(0.3 - totalEvidence * 0.1))
        : round(clamp01(0.45 * share + 0.3 * separation + 0.25 * magnitude));

    return {
        state,
        confidence,
        scores: { success: round(scores.success), error: round(scores.error), blocked: round(scores.blocked) },
        evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 8),
        progressed: !!world.progress,
        expectationMet: expect ? state === 'success' : null,
    };
}

function isMutating(action) {
    const a = action && action.action;
    return a === 'click' || a === 'press' || a === 'check' || a === 'uncheck' || a === 'select' || a === 'upload';
}

/** Heuristic form-reset: after acting we are still on the same path, on a form, with error copy. */
function formReset(prev, current, hasNewError) {
    if (!prev) return false;
    const samePath = prev.path === current.path;
    const onForm = current.fieldCount > 0;
    return samePath && onForm && hasNewError;
}

function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
function round(n) { return Math.round(n * 1000) / 1000; }

module.exports = { judge, newTerms, W, EVIDENCE_FLOOR };
