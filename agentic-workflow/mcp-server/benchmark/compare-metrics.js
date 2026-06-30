/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CBR METRICS COMPARE — diff two captured metric sets and show the deltas
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Compares a baseline metrics file against a candidate (e.g. after a phase landed) and
 * prints the wins/regressions for the headline numbers. Exits non-zero if a guarded
 * metric regressed beyond tolerance, so it can gate CI for a phase.
 *
 * Usage:
 *   node benchmark/compare-metrics.js                                  (P0-baseline vs latest)
 *   node benchmark/compare-metrics.js --base=P0-baseline --candidate=P1-resident-agent
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import { readMetrics, METRICS_DIR, pctDelta, round } from './lib/metrics.js';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (name, def) => {
        const hit = args.find((a) => a.startsWith(`--${name}=`));
        return hit ? hit.split('=').slice(1).join('=') : def;
    };
    return { base: get('base', 'P0-baseline'), candidate: get('candidate', null) };
}

function latestLabelExcluding(exclude) {
    if (!fs.existsSync(METRICS_DIR)) return null;
    const files = fs.readdirSync(METRICS_DIR)
        .filter((f) => f.endsWith('.json') && f !== `${exclude}.json`)
        .map((f) => ({ f, t: fs.statSync(path.join(METRICS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    return files.length ? files[0].f.replace(/\.json$/, '') : null;
}

const arrow = (deltaPct) => (deltaPct == null ? '·' : deltaPct > 0 ? '▼ better' : deltaPct < 0 ? '▲ worse' : '= same');

function line(label, base, cand, { lowerIsBetter = true, unit = '' } = {}) {
    if (base == null && cand == null) return;
    const delta = lowerIsBetter ? pctDelta(base, cand) : pctDelta(cand, base);
    console.log(`   ${label.padEnd(26)} ${String(base ?? '–').padStart(10)}${unit} → ${String(cand ?? '–').padStart(10)}${unit}   ${delta == null ? '·' : (delta + '%').padStart(7)}  ${arrow(delta)}`);
}

function main() {
    const { base, candidate } = parseArgs();
    const candLabel = candidate || latestLabelExcluding(base);
    if (!candLabel) {
        console.error('No candidate metrics found. Run capture-baseline.js with a --label first.');
        process.exit(1);
    }

    const A = readMetrics(base);
    const B = readMetrics(candLabel);
    if (!A) { console.error(`Baseline "${base}" not found in ${METRICS_DIR}`); process.exit(1); }
    if (!B) { console.error(`Candidate "${candLabel}" not found in ${METRICS_DIR}`); process.exit(1); }

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(` COMPARE   base=${base}   candidate=${candLabel}`);
    console.log('══════════════════════════════════════════════════════════════');

    const regressions = [];
    const names = new Set([...Object.keys(A.fixtures || {}), ...Object.keys(B.fixtures || {})]);
    for (const name of names) {
        const a = A.fixtures?.[name] || {};
        const b = B.fixtures?.[name] || {};
        console.log(`\n ▸ ${name}`);

        if (a.snapshot || b.snapshot) {
            line('snapshot cold (ms)', a.snapshot?.cold?.ms, b.snapshot?.cold?.ms);
            line('snapshot warm (ms)', a.snapshot?.warm?.ms, b.snapshot?.warm?.ms);
            line('post-mutation (ms)', a.snapshot?.postMutation?.ms, b.snapshot?.postMutation?.ms);
            line('cold payload (tokens)', a.snapshot?.cold?.tokens, b.snapshot?.cold?.tokens);
        }
        if (a.interaction || b.interaction) {
            line('click p50 (ms)', a.interaction?.p50, b.interaction?.p50);
        }
        if (a.selectorSurvival || b.selectorSurvival) {
            line('selector survival (%)', a.selectorSurvival?.survivalPct, b.selectorSurvival?.survivalPct, { lowerIsBetter: false, unit: '%' });
            // Guard: survival must not regress.
            const da = a.selectorSurvival?.survivalPct, db = b.selectorSurvival?.survivalPct;
            if (da != null && db != null && db < da - 1) regressions.push(`${name}: selector survival ${da}% → ${db}%`);
        }
        if (a.selectorHealing || b.selectorHealing) {
            line('effective survival (%)', a.selectorHealing?.effectiveSurvivalPct, b.selectorHealing?.effectiveSurvivalPct, { lowerIsBetter: false, unit: '%' });
        }
        if (a.blockerLatency || b.blockerLatency) {
            line('blocker detect p50 (ms)', a.blockerLatency?.p50, b.blockerLatency?.p50);
        }
        if (a.postActionObservation || b.postActionObservation) {
            line('post-action observe (ms)', a.postActionObservation?.p50, b.postActionObservation?.p50);
            line('post-action DOM calls', a.postActionObservation?.domRoundTrips?.mean, b.postActionObservation?.domRoundTrips?.mean);
        }
    }

    console.log('\n──────────────────────────────────────────────────────────────');
    if (regressions.length) {
        console.log(' REGRESSIONS:');
        for (const r of regressions) console.log('   ✗ ' + r);
        console.log('');
        process.exit(2);
    }
    console.log(' No guarded regressions.\n');
}

main();
