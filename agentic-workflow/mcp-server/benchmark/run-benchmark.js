/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MCP PERCEPTION BENCHMARK — proves the efficiency wins of the intelligent engine
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Runs the PlaywrightDirectBridge against a deterministic offline fixture page and
 * measures, for the snapshot engine:
 *   - payload size (bytes ≈ tokens/4) for compact vs verbose
 *   - wall-clock latency for first snapshot vs cached repeat
 *   - element counts (auto-filter effect)
 *   - action latency (resolve ref + click)
 *
 * No network or UAT required — fully offline and repeatable.
 *
 * Usage:  node benchmark/run-benchmark.js
 *         MCP_HEADLESS=false node benchmark/run-benchmark.js   (watch it run)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = pathToFileURL(path.join(__dirname, 'fixture.html')).href;

const bytes = (obj) => Buffer.byteLength(JSON.stringify(obj), 'utf8');
const tokens = (obj) => Math.ceil(bytes(obj) / 4);
const ms = (n) => `${n.toFixed(1)} ms`;
const pct = (from, to) => `${(((from - to) / from) * 100).toFixed(1)}%`;

async function time(fn) {
    const t0 = performance.now();
    const result = await fn();
    return { result, ms: performance.now() - t0 };
}

async function main() {
    const bridge = new PlaywrightDirectBridge({
        headless: process.env.MCP_HEADLESS !== 'false',
    });

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' MCP PERCEPTION BENCHMARK');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(` Fixture: ${FIXTURE_URL}\n`);

    await bridge.connect();
    try {
        await bridge.navigate({ url: FIXTURE_URL });

        // ── Compact (new default): first capture ───────────────────────────
        const compact1 = await time(() => bridge.snapshot({ useCache: false }));
        // ── Compact: cached repeat (no DOM change) ─────────────────────────
        const compactCached = await time(() => bridge.snapshot({ useCache: true }));
        // ── Verbose (legacy-equivalent: full elements + ARIA tree) ─────────
        const verbose = await time(() => bridge.snapshot({ verbose: true, autoFilter: false, useCache: false }));
        // ── Unfiltered compact (everything, no auto-filter) ────────────────
        const unfiltered = await time(() => bridge.snapshot({ autoFilter: false, useCache: false }));

        const rows = [
            ['Mode', 'Elements', 'Bytes', '~Tokens', 'Latency'],
            ['─────────────────────', '────────', '────────', '────────', '──────────'],
            ['compact (default)', compact1.result.elementCount, bytes(compact1.result), tokens(compact1.result), ms(compact1.ms)],
            ['compact (cached)', compactCached.result.elementCount, bytes(compactCached.result), tokens(compactCached.result), ms(compactCached.ms)],
            ['compact (no filter)', unfiltered.result.elementCount, bytes(unfiltered.result), tokens(unfiltered.result), ms(unfiltered.ms)],
            ['verbose (full+ARIA)', verbose.result.elementCount, bytes(verbose.result), tokens(verbose.result), ms(verbose.ms)],
        ];
        console.log(' SNAPSHOT PAYLOAD & LATENCY');
        for (const r of rows) {
            console.log('  ' + r.map((c, i) => String(c).padEnd([22, 9, 9, 9, 11][i])).join(''));
        }

        console.log('\n WINS (compact default vs verbose):');
        console.log(`  • Payload size : ${bytes(verbose.result)} → ${bytes(compact1.result)} bytes  (${pct(bytes(verbose.result), bytes(compact1.result))} smaller)`);
        console.log(`  • Token est.   : ${tokens(verbose.result)} → ${tokens(compact1.result)} tokens (${pct(tokens(verbose.result), tokens(compact1.result))} fewer)`);
        console.log(`  • Cache hit    : ${ms(compact1.ms)} → ${ms(compactCached.ms)} (${pct(compact1.ms, compactCached.ms)} faster on repeat)`);
        console.log(`  • Cache hit verified: ${compactCached.result._cache?.hit === true ? 'YES' : 'NO'}`);

        // ── Action latency: resolve refs and click (steady-state) ──────────
        const clickable = (compact1.result.elements || []).filter((e) => e.interactive && e.selector).slice(0, 4);
        if (clickable.length) {
            console.log('\n ACTION LATENCY (resolve ref + click, post-action settle):');
            for (const el of clickable) {
                const click = await time(() => bridge.click({ ref: el.ref }).catch((e) => ({ error: e.message })));
                console.log(`  • click(ref=${el.ref}, "${el.name || ''}") → ${ms(click.ms)}`);
            }
        }

        // ── Sanity: compact element keeps the essentials ───────────────────
        const sample = (compact1.result.elements || [])[0];
        console.log('\n SAMPLE COMPACT ELEMENT:');
        console.log('  ' + JSON.stringify(sample));

        console.log('\n══════════════════════════════════════════════════════════════\n');
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

main().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
