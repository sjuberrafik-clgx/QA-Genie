/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ACTION INTEGRITY TEST — verifies the four live-path fixes (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * These fixes close the gaps the live OneHome QA run exposed:
 *   Fix #1  browser_act routes through the IntentProtocol → every action carries a resolution
 *           audit (chosen element, candidates, confidence, source, effect/verified).
 *   Fix #2  post-action effect verification → a "silent success" (dispatch ok but the control was
 *           a no-op / blade never opened) is surfaced as verified:false + warning, not a bare ok:true.
 *   Fix #3  blocker detector tightened → a plain positioned button (class*="notice") is NOT
 *           classified as a modal overlay, while a genuine role="dialog" still is.
 *   Fix #4  auto-vision on miss → a DOM-blind icon button resolves via vision fusion without an
 *           explicit vision flag.
 *
 *   node benchmark/test-action-integrity.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = pathToFileURL(path.join(__dirname, 'fixtures', 'action-integrity.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const bridge = new PlaywrightDirectBridge({
        headless: process.env.MCP_HEADLESS !== 'false',
        residentAgent: true, visionFusion: true, healPersist: false,
    });
    await bridge.connect();
    try {
        await bridge.navigate({ url: URL });
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 5000 });

        // ── Fix #3: blocker false-positive ──────────────────────────────────
        console.log('\n Fix #3 — blocker detector does not flag a plain positioned button:');
        const initial = await bridge.getBlockingState();
        check('no blocker on a page with a positioned .notice button', initial.present === false, JSON.stringify(initial.blocker?.selectorHint));
        // A genuine dialog must still be detected.
        await bridge.page.evaluate(() => window.__fixture.openDialog());
        await sleep(60);
        const withDialog = await bridge.getBlockingState();
        check('a genuine role="dialog" IS still detected', withDialog.present === true, JSON.stringify(withDialog.blocker?.kind));
        await bridge.page.evaluate(() => window.__fixture.closeDialog());
        await sleep(60);

        // ── Fix #2: silent-success vs real effect ───────────────────────────
        console.log('\n Fix #2 — post-action effect verification (silent success surfaced):');
        const dead = await bridge.actIntelligent({ action: 'click', target: 'Dead Button' });
        check('no-op click still dispatches (ok:true)', dead.ok === true, JSON.stringify(dead.error));
        check('no-op click reports verified:false', dead.verified === false, JSON.stringify(dead.effect));
        check('no-op click carries a warning', typeof dead.warning === 'string' && dead.warning.length > 0);

        const real = await bridge.actIntelligent({ action: 'click', target: 'Open Panel' });
        check('real click reports verified:true', real.verified === true, JSON.stringify(real.effect));
        check('real click has NO warning', !real.warning);
        check('real click effect.domChanged is true', real.effect?.domChanged === true);

        // ── Fix #1: browser_act routes through the intent audit ─────────────
        console.log('\n Fix #1 — browser_act carries a resolution audit:');
        const routed = await bridge.callTool('browser_act', { action: 'click', target: 'Open Panel' });
        check('browser_act result includes an audit', !!routed.audit, JSON.stringify(Object.keys(routed)));
        check('audit records the source', !!routed.audit?.source, routed.audit?.source);
        check('audit records candidates considered', Array.isArray(routed.audit?.candidatesConsidered));
        check('audit outcome carries verified + effect', routed.audit?.outcome && typeof routed.audit.outcome.verified === 'boolean', JSON.stringify(routed.audit?.outcome));

        // ── Fix #4: auto-vision resolves a DOM-blind control ────────────────
        console.log('\n Fix #4 — auto-vision resolves a DOM-blind icon button (no explicit vision flag):');
        const vis = await bridge.actIntelligent({ action: 'click', target: 'Search' });
        check('DOM-blind "Search" icon resolved', vis.ok === true, JSON.stringify(vis.error || vis));
        check('resolution used vision provenance', vis.visual === true, JSON.stringify({ visual: vis.visual, source: vis.visualSource }));

        console.log('\n    sample audit: ' + JSON.stringify(routed.audit?.outcome));
        console.log('    sample silent-success: ' + JSON.stringify({ ok: dead.ok, verified: dead.verified, effect: dead.effect }));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` ACTION INTEGRITY TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
