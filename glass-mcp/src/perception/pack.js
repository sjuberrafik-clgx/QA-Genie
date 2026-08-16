'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · PACK — collapse duplicates + fit affordances into a token budget
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Progressive disclosure with two anti-omission guarantees:
 *   1. Cluster collapse — N identical (kind,name) affordances → one representative
 *      with `count` + `sampleHandles` (e.g. "50 result cards").
 *   2. Coverage guarantee — at least one representative per region AND per kind
 *      survives the budget, so the action menu is complete-but-compact (nothing
 *      important is silently dropped).
 *
 * Output is the actionable menu the agent receives from see().
 *
 * @module glass-mcp/perception/pack
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { encodeHandle } = require('../handle');
const { redundancyKey } = require('./salience');

function handleFor(c) {
    return encodeHandle({
        role: c.role,
        name: c.name,
        sph: c.sph,
        fp: c.fp,
        doc: c.docId,
        frame: c.framePath,
        tab: c.tabId,
        epoch: c.documentEpoch,
        documentToken: c.documentToken,
        target: c.target,
    });
}

function toAffordance(c, group) {
    const aff = {
        h: handleFor(c),
        act: c.act,
        kind: c.kind,
        name: c.name,
        role: c.role,
        where: { vp: !!c.vp, region: c.region || 'main' },
        s: c.s,
    };
    if (c.state && Object.keys(c.state).length) aff.state = c.state;
    if (group && group.length > 1) {
        aff.count = group.length;
        aff.sampleHandles = group.slice(0, 3).map(handleFor);
    }
    return aff;
}

/** Rough token cost of an affordance (chars/4). */
function cost(aff) {
    return Math.ceil(JSON.stringify(aff).length / 4);
}

/**
 * @param {Object[]} scored  candidates with `.s` set (see salience.scoreAll)
 * @param {Object} [opts] { tokenBudget=1500 }
 * @returns {{affordances:Object[], budget:Object}}
 */
function pack(scored, opts = {}) {
    const tokenBudget = opts.tokenBudget || 1500;
    const elementsConsidered = scored.length;

    // 1. Cluster by (kind,name).
    const groups = new Map();
    for (const c of scored) {
        const k = redundancyKey(c);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
    }

    // 2. One representative (highest salience) per cluster.
    const items = [];
    for (const group of groups.values()) {
        group.sort((a, b) => b.s - a.s);
        items.push({ aff: toAffordance(group[0], group) });
    }
    items.sort((a, b) => b.aff.s - a.aff.s);

    // 3. Coverage must-includes: top item per region + per kind.
    const picked = new Set();
    const out = [];
    let used = 0;
    const include = (item) => {
        if (picked.has(item)) return;
        picked.add(item);
        out.push(item.aff);
        used += cost(item.aff);
    };
    const topPer = (keyFn) => {
        const seen = new Map();
        for (const item of items) {
            const key = keyFn(item.aff);
            if (!seen.has(key)) seen.set(key, item);
        }
        return [...seen.values()];
    };
    for (const item of topPer((a) => a.where.region)) include(item);
    for (const item of topPer((a) => a.kind)) include(item);

    // 4. Fill remaining budget by salience.
    for (const item of items) {
        if (picked.has(item)) continue;
        if (used + cost(item.aff) > tokenBudget) continue;
        include(item);
    }

    // 5. Present in salience order.
    out.sort((a, b) => b.s - a.s);

    return {
        affordances: out,
        budget: { tokens: tokenBudget, used, elementsConsidered, returned: out.length, clusters: groups.size },
    };
}

module.exports = { pack, toAffordance, handleFor, cost };
