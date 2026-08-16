'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · HAPPY-PATH — rank affordances + predict the next state (Pillar 2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * "Anticipate the standard human workflow. Rank which interactive elements represent
 * the happy path (advancing the business flow) versus edge cases or error loops."
 *
 * Given the ranked affordance menu from see() and the inferred intent, this splits
 * the menu into:
 *   • happyPath  — affordances that advance the flow toward the archetype's goal,
 *   • edgeCases  — regressive / destructive / off-path affordances,
 * and emits a `nextExpectation`: the predicted next stage plus the success and
 * failure markers to look for AFTER acting. That expectation is the crux of
 * assertion-free validation — it is generated at runtime and handed to the verdict
 * engine as the thing to verify (predict-then-verify), replacing human-authored
 * expected results.
 *
 * @module glass-mcp/cognition/happy-path
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { countTerms, lc } = require('./signals');

/** Does an affordance name match any term? Returns the strongest (longest) match. */
function bestMatch(name, terms) {
    const n = lc(name);
    let best = '';
    for (const t of terms) {
        const lt = lc(t);
        if (lt && n.indexOf(lt) !== -1 && lt.length > best.length) best = lt;
    }
    return best;
}

/**
 * Rank the affordance menu into happy-path vs edge-case and predict the next state.
 * @param {Object} signals   from extractSignals()
 * @param {Object} intent    from inferIntent()
 * @param {Object} taxonomy  from buildTaxonomy()
 * @returns {Object} { happyPath[], edgeCases[], nextExpectation }
 */
function rankPath(signals, intent, taxonomy) {
    const arch = taxonomy.byId(intent.archetype);
    const flow = (arch && arch.flow) || [];
    const stage = flow[intent.stageIndex] || {};
    // The labels that advance THIS stage toward the next, plus the universal advance set.
    const stageAdvance = stage.advance || [];
    const advanceTerms = stageAdvance.concat(taxonomy.lexicon.advance);
    const regressTerms = taxonomy.lexicon.regress;

    const happyPath = [];
    const edgeCases = [];

    for (const a of signals.affordances) {
        if (!a.act || a.act === 'read') continue; // not an action
        const name = a.name || '';
        const adv = bestMatch(name, advanceTerms);
        const reg = bestMatch(name, regressTerms);
        const stageHit = bestMatch(name, stageAdvance);

        // Score: stage-specific advance beats generic advance; salience breaks ties.
        let advanceScore = 0;
        const reasons = [];
        if (stageHit) { advanceScore += 2; reasons.push(`advances "${stageHit}" → ${nextStageName(flow, intent.stageIndex)}`); }
        else if (adv) { advanceScore += 1; reasons.push(`advance verb "${adv}"`); }
        if (a.kind === 'button' || a.kind === 'field' || a.kind === 'select') advanceScore += 0.25;
        advanceScore += Math.min(0.5, (a.s || 0) * 0.5);

        const entry = {
            h: a.h,
            name: a.name,
            kind: a.kind,
            role: a.role,
            score: round(advanceScore),
        };

        if (reg && !stageHit) {
            entry.reason = `regressive / destructive ("${reg}")`;
            edgeCases.push(entry);
        } else if (advanceScore >= 1) {
            entry.reason = reasons.join('; ');
            happyPath.push(entry);
        } else {
            entry.reason = 'off-path (no advance signal for this stage)';
            edgeCases.push(entry);
        }
    }

    happyPath.sort((a, b) => b.score - a.score);
    edgeCases.sort((a, b) => b.score - a.score);

    return {
        happyPath: happyPath.slice(0, 8),
        edgeCases: edgeCases.slice(0, 8),
        nextExpectation: buildExpectation(intent, flow, taxonomy),
    };
}

/** The runtime-generated "assertion": what a correct next state should look like. */
function buildExpectation(intent, flow, taxonomy) {
    const cur = flow[intent.stageIndex] || {};
    const next = flow[intent.stageIndex + 1] || null;
    if (cur.terminal && cur.success) {
        return { at: 'goal', reached: true, stage: cur.stage, successMarkers: [], failureMarkers: taxonomy.lexicon.error.slice(0, 8) };
    }
    const target = next || cur;
    // Success markers: the NEXT stage's locating markers (we should arrive there) plus
    // the universal success lexicon; strongest when the next stage is the terminal goal.
    const successMarkers = uniq((target.markers || []).concat(target.success ? taxonomy.lexicon.success.slice(0, 8) : taxonomy.lexicon.success.slice(0, 4)));
    return {
        at: 'transition',
        fromStage: cur.stage || 'unknown',
        toStage: target.stage || 'unknown',
        expectsSuccessAtGoal: !!target.success,
        successMarkers: successMarkers.slice(0, 12),
        failureMarkers: taxonomy.lexicon.error.slice(0, 10),
        successUrlHints: taxonomy.urlHints.success.slice(0, 8),
        errorUrlHints: taxonomy.urlHints.error.slice(0, 8),
    };
}

function nextStageName(flow, idx) {
    const next = flow[idx + 1];
    return (next && next.stage) || 'goal';
}

function uniq(arr) { return Array.from(new Set(arr)); }
function round(n) { return Math.round(n * 1000) / 1000; }

module.exports = { rankPath, buildExpectation };
