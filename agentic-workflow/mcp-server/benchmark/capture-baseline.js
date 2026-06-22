/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CBR BASELINE CAPTURE — Phase 0 of the Cognitive Browser Runtime roadmap
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Runs the current PlaywrightDirectBridge against a battery of deterministic offline
 * fixtures and records the metrics every later phase is judged against:
 *
 *   • snapshot latency   — cold / warm(cache) / post-mutation(re-walk) / verbose
 *   • payload size       — bytes + ~tokens (compact vs verbose)
 *   • interaction        — resolve-ref + click latency (p50/p95)
 *   • selector survival  — % of winning selectors that still resolve after a re-render,
 *                          plus the identity-recoverable "healing headroom"
 *   • blocker latency    — modal-appear → detection time
 *
 * Output: benchmark/metrics/<label>.json  (default label: "P0-baseline").
 * Re-run after each phase with a new --label, then `node benchmark/compare-metrics.js`.
 *
 * Usage:
 *   node benchmark/capture-baseline.js
 *   node benchmark/capture-baseline.js --label=P1-resident-agent
 *   MCP_HEADLESS=false node benchmark/capture-baseline.js   (watch it run)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import {
    measureSnapshot, measureInteraction, captureTrackedSelectors, checkSelectorSurvival,
    checkSelectorSurvivalWithHealing, measureBlockerLatency, measurePostActionObservation,
    captureEnv, writeMetrics, round,
} from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = (rel) => pathToFileURL(path.join(__dirname, rel)).href;

// Each fixture declares which measurements apply to it.
const FIXTURES = [
    { name: 'static', file: 'fixture.html', snapshot: true, interaction: true },
    { name: 'spa-rerender', file: 'fixtures/spa-rerender.html', snapshot: true, interaction: true, survival: true },
    { name: 'infinite-scroll', file: 'fixtures/infinite-scroll.html', snapshot: true, growth: true },
    { name: 'modal-storm', file: 'fixtures/modal-storm.html', snapshot: true, blocker: true },
];

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (name, def) => {
        const hit = args.find((a) => a.startsWith(`--${name}=`));
        return hit ? hit.split('=').slice(1).join('=') : def;
    };
    return { label: get('label', 'P0-baseline') };
}

async function measureGrowth(bridge) {
    // Snapshot cost as the DOM grows — exposes the re-walk-everything cost that
    // a delta-pushing resident agent eliminates.
    const points = [];
    for (const target of [10, 50, 100]) {
        await bridge.page.evaluate((n) => {
            const cur = window.__fixture.count();
            if (n > cur) window.__fixture.loadN(n - cur);
        }, target);
        const t0 = performance.now();
        const snap = await bridge.snapshot({ useCache: false });
        points.push({ items: target, ms: round(performance.now() - t0, 2), elements: snap.elementCount, bytes: Buffer.byteLength(JSON.stringify(snap)) });
    }
    return { points };
}

async function runFixture(bridge, fx) {
    const url = fixtureUrl(fx.file);
    await bridge.navigate({ url });
    const out = { file: fx.file };

    if (fx.snapshot) out.snapshot = await measureSnapshot(bridge);
    if (fx.interaction) out.interaction = await measureInteraction(bridge);
    if (fx.growth) out.growth = await measureGrowth(bridge);

    if (fx.survival) {
        const tracked = await captureTrackedSelectors(bridge);
        await bridge.page.evaluate(() => window.__fixture.rerender());
        out.selectorSurvival = await checkSelectorSurvival(bridge, tracked);
        // Phase 4: effective survival once broken selectors are healed (resident agent only).
        const healed = await checkSelectorSurvivalWithHealing(bridge, tracked);
        if (healed) out.selectorHealing = healed;
    }

    if (fx.blocker) {
        out.blockerLatency = await measureBlockerLatency(bridge, {
            open: () => bridge.page.evaluate(() => window.__fixture.openModal(0)),
            close: () => bridge.page.evaluate(() => window.__fixture.closeModal()),
            samples: 5,
        });
        // The real P2 headline: post-action observation cost on the no-blocker path.
        await bridge.page.evaluate(() => window.__fixture.closeModal());
        out.postActionObservation = await measurePostActionObservation(bridge, { runs: 5 });
    }

    return out;
}

function printSummary(metrics) {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(` CBR METRICS — ${metrics.label}`);
    console.log('══════════════════════════════════════════════════════════════');
    for (const [name, fx] of Object.entries(metrics.fixtures)) {
        console.log(`\n ▸ ${name}`);
        if (fx.snapshot) {
            const s = fx.snapshot;
            console.log(`   snapshot  cold=${s.cold.ms}ms (${s.cold.tokens}tok) | warm=${s.warm.ms}ms hit=${s.warm.cacheHit} | post-mutation=${s.postMutation.ms}ms | verbose=${s.verbose.tokens}tok`);
        }
        if (fx.interaction) console.log(`   click     p50=${fx.interaction.p50}ms p95=${fx.interaction.p95}ms (n=${fx.interaction.count})`);
        if (fx.growth) console.log(`   growth    ${fx.growth.points.map((p) => `${p.items}→${p.ms}ms`).join('  ')}`);
        if (fx.selectorSurvival) {
            const v = fx.selectorSurvival;
            console.log(`   survival  selector=${v.survivalPct}% identity=${v.identityPct}% healableGap=${v.healableGapPct}% (tracked=${v.tracked}, broken=${v.broken.length})`);
        }
        if (fx.selectorHealing) {
            const h = fx.selectorHealing;
            console.log(`   healing   raw=${h.rawSurvivalPct}% → effective=${h.effectiveSurvivalPct}% (healed ${h.healed}/${h.healed + h.healFailed}, success=${h.healSuccessPct}%)`);
        }
        if (fx.blockerLatency) console.log(`   blocker   detect p50=${fx.blockerLatency.p50}ms p95=${fx.blockerLatency.p95}ms (${fx.blockerLatency.method})`);
        if (fx.postActionObservation) {
            const o = fx.postActionObservation;
            console.log(`   observe   no-blocker p50=${o.p50}ms | DOM round-trips mean=${o.domRoundTrips.mean} max=${o.domRoundTrips.max}`);
        }
    }
    console.log('\n══════════════════════════════════════════════════════════════\n');
}

async function main() {
    const { label } = parseArgs();
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false' });
    await bridge.connect();

    const metrics = { label, env: captureEnv(bridge), fixtures: {} };
    try {
        for (const fx of FIXTURES) {
            console.error(`[baseline] measuring ${fx.name}...`);
            metrics.fixtures[fx.name] = await runFixture(bridge, fx);
        }
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }

    const file = writeMetrics(label, metrics);
    printSummary(metrics);
    console.log(` Saved → ${path.relative(process.cwd(), file)}\n`);
}

main().catch((err) => {
    console.error('Baseline capture failed:', err);
    process.exit(1);
});
