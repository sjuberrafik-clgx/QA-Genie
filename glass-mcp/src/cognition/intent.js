'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · INTENT — infer the application's business archetype (Pillar 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * "Dynamically categorise the type of web app by analysing UI text, semantic DOM
 * structure, and URL indicators upon landing."
 *
 * Deterministic, explainable scoring: every archetype accrues evidence from URL
 * fragments, page/heading text, and the affordance-kind fingerprint. The winner and
 * a calibrated confidence are returned WITH the evidence that produced them, plus
 * the current stage located within that archetype's canonical flow graph.
 *
 * @module glass-mcp/cognition/intent
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { countTerms } = require('./signals');

// Evidence weights — URL is the strongest single indicator, then vertical-specific
// text, then the affordance-kind fingerprint (weakest, most ambiguous).
const W = { url: 3, text: 1.5, kind: 1 };

/**
 * Score one archetype against the signals.
 * @returns {{ id, label, score, evidence:string[] }}
 */
function scoreArchetype(arch, signals) {
    const evidence = [];
    let score = 0;

    const urlHay = `${signals.host} ${signals.path} ${signals.query}`;
    const urlHit = countTerms(urlHay, arch.url || []);
    if (urlHit.count) {
        score += W.url * urlHit.count;
        evidence.push(`url:${urlHit.hits.slice(0, 3).join(',')}`);
    }

    const textHit = countTerms(signals.corpus, arch.text || []);
    if (textHit.count) {
        score += W.text * Math.min(textHit.count, 6); // saturate — avoid keyword stuffing bias
        evidence.push(`text:${textHit.hits.slice(0, 3).join(',')}`);
    }

    // Affordance-kind fingerprint: reward archetypes whose dominant kinds are present.
    let kindHits = 0;
    for (const k of arch.kinds || []) {
        if (signals.kinds[k]) kindHits += 1;
    }
    if (kindHits) {
        score += W.kind * kindHits;
        evidence.push(`kinds:${(arch.kinds || []).filter((k) => signals.kinds[k]).join(',')}`);
    }

    return { id: arch.id, label: arch.label, score, evidence };
}

/**
 * Locate the current stage within an archetype's flow graph by matching stage
 * markers against the content corpus + URL. Returns the best-matching stage index.
 * @returns {{ index:number, stage:string, terminal:boolean, success:boolean, matched:string[] }}
 */
function locateStage(arch, signals) {
    const flow = arch.flow || [];
    let best = { index: 0, matched: [], count: -1 };
    const hay = `${signals.path} \u241f ${signals.corpus}`;
    for (let i = 0; i < flow.length; i++) {
        const hit = countTerms(hay, flow[i].markers || []);
        // Prefer the LATER stage on ties — flows progress forward, and terminal copy
        // ("thank you") should win over generic early markers when both are present.
        if (hit.count >= 1 && hit.count >= best.count) {
            best = { index: i, matched: hit.hits, count: hit.count };
        }
    }
    if (best.count < 0) best = { index: 0, matched: [], count: 0 };
    const stage = flow[best.index] || {};
    return {
        index: best.index,
        stage: stage.stage || 'unknown',
        terminal: !!stage.terminal,
        success: !!stage.success,
        matched: best.matched,
    };
}

/**
 * Infer the application archetype + current stage from signals.
 * @param {Object} signals  from extractSignals()
 * @param {Object} taxonomy from buildTaxonomy()
 * @returns {Object} intent
 */
function inferIntent(signals, taxonomy) {
    const scored = taxonomy.archetypes
        .map((a) => scoreArchetype(a, signals))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const top = scored[0] || { id: 'unknown', label: 'Unknown', score: 0, evidence: [] };
    const runnerUp = scored[1] || { score: 0 };
    const total = scored.reduce((n, s) => n + s.score, 0) || 1;

    // Confidence is gated by ABSOLUTE evidence first: a single weak signal must read
    // as low confidence no matter how it compares to (equally empty) rivals. Share and
    // separation then modulate within that evidence ceiling.
    const share = top.score / total;
    const separation = top.score > 0 ? (top.score - runnerUp.score) / top.score : 0;
    const evidenceStrength = Math.min(1, top.score / 6);
    const confidence = round(clamp01(evidenceStrength * (0.5 + 0.3 * share + 0.2 * separation)));

    const arch = taxonomy.byId(top.id);
    const located = arch ? locateStage(arch, signals) : { index: 0, stage: 'unknown', terminal: false, success: false, matched: [] };

    return {
        archetype: top.id,
        label: top.label,
        confidence,
        stage: located.stage,
        stageIndex: located.index,
        terminal: located.terminal,
        stageSuccess: located.success,
        evidence: top.evidence,
        stageMatched: located.matched,
        ranking: scored.slice(0, 3).map((s) => ({ id: s.id, score: round(s.score) })),
    };
}

function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
function round(n) { return Math.round(n * 1000) / 1000; }

module.exports = { inferIntent, scoreArchetype, locateStage };
