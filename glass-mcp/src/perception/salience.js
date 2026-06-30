'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · SALIENCE — rank affordances so the FEW that matter surface first
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pure, deterministic scoring over candidate affordances. The standout term is
 * NOVELTY: affordances that changed since the previous see() (not in the baseline
 * structural-hash set) rank to the top — purpose-built for the agent's
 * perceive→act loop (after an action, the new dialog ranks above the whole page).
 *
 *   salience = 0.30·interactable + 0.20·inViewport + 0.18·semantic
 *            + 0.15·novelty + 0.10·nameQuality − 0.08·redundancy − 0.07·occluded
 *
 * @module glass-mcp/perception/salience
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const WEIGHTS = {
    interactable: 0.30,
    viewport: 0.20,
    semantic: 0.18,
    novelty: 0.15,
    name: 0.10,
    redundancy: 0.08,
    occluded: 0.07,
};

/** Semantic weight per affordance kind (how action-bearing it is). */
const SEMANTIC = {
    button: 1.0, field: 1.0, toggle: 0.95, select: 0.9, link: 0.85,
    tab: 0.8, menu: 0.7, card: 0.7, option: 0.6, map: 0.6,
    media: 0.5, region: 0.3, text: 0.15,
};

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Cluster key for redundancy + collapsing (same kind + same name = a repeat). */
function redundancyKey(c) {
    return `${c.kind}|${c.name || ''}`;
}

/**
 * Score one candidate. ctx = { baseline:Set<sph>, dup:Map<key,count> }.
 * @returns {number} salience in [0,1]
 */
function salience(c, ctx) {
    const interactable = c.interactable ? 1 : 0;
    const viewport = c.vp ? 1 : 0;
    const semantic = SEMANTIC[c.kind] != null ? SEMANTIC[c.kind] : 0.3;
    // Novelty only meaningful once we have a baseline (a prior see() this session).
    const hasBaseline = ctx.baseline && ctx.baseline.size > 0;
    const novelty = hasBaseline ? (ctx.baseline.has(c.sph) ? 0 : 1) : 0;
    const name = clamp01(c.nameQuality);
    const dupCount = (ctx.dup && ctx.dup.get(redundancyKey(c))) || 1;
    const redundancy = Math.min(1, (dupCount - 1) / 8); // 9+ duplicates → full penalty
    const occluded = c.occluded ? 1 : 0;

    const s = WEIGHTS.interactable * interactable
        + WEIGHTS.viewport * viewport
        + WEIGHTS.semantic * semantic
        + WEIGHTS.novelty * novelty
        + WEIGHTS.name * name
        - WEIGHTS.redundancy * redundancy
        - WEIGHTS.occluded * occluded;
    return clamp01(s);
}

/**
 * Score every candidate in place (sets `.s`), building the duplicate map first.
 * @param {Object[]} candidates
 * @param {Set<string>} [baseline]  structural hashes seen in the previous see()
 * @returns {Object[]} the same array, each with `.s`
 */
function scoreAll(candidates, baseline) {
    const dup = new Map();
    for (const c of candidates) {
        const k = redundancyKey(c);
        dup.set(k, (dup.get(k) || 0) + 1);
    }
    const ctx = { baseline: baseline || new Set(), dup };
    for (const c of candidates) c.s = Math.round(salience(c, ctx) * 1000) / 1000;
    return candidates;
}

module.exports = { salience, scoreAll, redundancyKey, WEIGHTS, SEMANTIC };
