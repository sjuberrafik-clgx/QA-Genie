/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * INTENT PROTOCOL TEST — Phase 7 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the four semantic verbs and — critically — the TRANSPARENT resolution audit that
 * enforces QA-integrity (no silent routing):
 *   1. compile()           — legacy tool names map onto perceive/act/await/observe.
 *   2. perceive            — returns a token-budgeted view + records a perception audit.
 *   3. act + RESOLUTION-AUDIT — every act logs chosen element + candidates considered +
 *                            confidence + source (dom/vision/heal). NOTHING resolves silently.
 *   4. act via vision      — a DOM-blind icon button resolves by its vision-fused name; the
 *                            audit source is labeled 'vision:*'.
 *   5. act via heal        — a target whose selector broke is re-anchored; audit shows healed +
 *                            source 'heal:*' (surfaced as a possible product change).
 *   6. await               — push-based blocker wait via the reactive core (no polling).
 *   7. observe(goal)       — offline reasoning over the app graph ("how do I …").
 *
 *   node benchmark/test-intent-protocol.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { IntentProtocol, INTENT_VERBS } from '../runtime/intent-protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (p) => pathToFileURL(path.join(__dirname, p)).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function compileUnit() {
    console.log('\n 1. compile() — tools recompile onto verbs:');
    check('4 canonical verbs', INTENT_VERBS.join(',') === 'perceive,act,await,observe');
    check('unified_snapshot → perceive', IntentProtocol.compile('unified_snapshot', {}).verb === 'perceive');
    check('unified_click → act', IntentProtocol.compile('unified_click', { target: 'X' }).verb === 'act');
    check('browser_type → act(type)', (() => { const c = IntentProtocol.compile('browser_type', { target: 'F', text: 'hi' }); return c.verb === 'act' && c.args.action === 'type' && c.args.text === 'hi'; })());
    check('unified_wait_for → await', IntentProtocol.compile('unified_wait_for', {}).verb === 'await');
    check('unified_get_by_role → observe', IntentProtocol.compile('unified_get_by_role', { name: 'Save' }).verb === 'observe');
    check('unknown tool → passthrough (verb null)', IntentProtocol.compile('unified_screenshot', {}).verb === null);
}

async function browserTests() {
    const bridge = new PlaywrightDirectBridge({
        headless: process.env.MCP_HEADLESS !== 'false',
        residentAgent: true, visionFusion: true, appGraph: true,
        appGraphPersist: false, healPersist: false,
    });
    await bridge.connect();
    const intent = bridge._intent;
    try {
        // ── perceive ─────────────────────────────────────────────────────────
        console.log('\n 2. perceive:');
        await bridge.navigate({ url: fx('fixtures/spa-rerender.html') });
        const view = await intent.perceive({ maxElements: 20 });
        check('perceive returns elements', view.elements.length > 0, `n=${view.elements.length}`);
        check('perceive recorded an audit entry', intent.getAudit().some((a) => a.verb === 'perceive'));

        // ── act + resolution audit ──────────────────────────────────────────
        console.log('\n 3. act + RESOLUTION AUDIT (no silent routing):');
        const r1 = await intent.act({ action: 'click', target: 'Apply filters' });
        check('act succeeded', r1.ok === true, JSON.stringify(r1.error));
        const a1 = r1.audit;
        check('audit records the chosen element', !!a1.resolved && !!a1.resolved.name, JSON.stringify(a1.resolved));
        check('audit records candidates considered', Array.isArray(a1.candidatesConsidered) && a1.candidatesConsidered.length >= 1, `n=${a1.candidatesConsidered?.length}`);
        check('audit records a confidence', a1.confidence != null);
        check('audit labels the source (dom)', /^dom/.test(a1.source), a1.source);
        check('every act produced an audit (no silent routing)', intent.stats.act === intent.getAudit({ limit: 999 }).filter((a) => a.verb === 'act').length);

        // ── act via vision (DOM-blind icon button) ──────────────────────────
        console.log('\n 4. act via vision (DOM-blind control):');
        await bridge.navigate({ url: fx('fixtures/vision-ambiguous.html') });
        const rv = await intent.act({ action: 'click', target: 'Settings', vision: true });
        check('act resolved a DOM-blind control', rv.ok === true, JSON.stringify(rv.error));
        check('audit source is vision', /vision/.test(rv.audit.source), rv.audit.source);

        // ── act via heal (broken selector re-anchored) ──────────────────────
        console.log('\n 5. act via heal (selector re-anchor):');
        await bridge.navigate({ url: fx('fixtures/spa-rerender.html') });
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        // Capture a Tier-B element's identity + (soon-broken) selector, then re-render.
        let ident = null, brokenCss = null;
        for (const [ref, el] of bridge.snapshotRefs) {
            if ((el.computedLabel || el.text) === 'Save property 1') {
                brokenCss = el.selector?.cssSelector;
                ident = await bridge._healingResolver.captureIdentity(ref, { selector: brokenCss, strategy: 'test' });
                break;
            }
        }
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 3000 });
        const rh = await intent.act({ action: 'click', target: { selector: brokenCss, identity: ident } });
        check('act healed the broken selector', rh.ok === true && rh.audit.healed === true, JSON.stringify({ ok: rh.ok, healed: rh.audit?.healed }));
        check('audit source is heal', /heal/.test(rh.audit.source), rh.audit.source);

        // ── await (push-based) ──────────────────────────────────────────────
        console.log('\n 6. await (push-based blocker):');
        await bridge.navigate({ url: fx('fixtures/modal-storm.html') });
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 3000 });
        const waitP = intent.await_({ type: 'blocker', timeoutMs: 2000 });
        await bridge.page.evaluate(() => window.__fixture.openModal(0));
        const w = await waitP;
        check('await resolved on pushed blocker', w.satisfied === true && !!w.blocker, JSON.stringify(w));

        // ── observe(goal) — offline reasoning ───────────────────────────────
        console.log('\n 7. observe(goal) — reason over the app graph:');
        bridge._appGraph.recordTransition({ fromUrl: 'https://app/detail', toUrl: 'https://app/saved', action: 'Save property' });
        bridge._appGraph.recordTransition({ fromUrl: 'https://app/search', toUrl: 'https://app/detail', action: 'View 101 Oak St' });
        bridge._appGraph.recordTransition({ fromUrl: 'https://app/home', toUrl: 'https://app/search', action: 'Search properties' });
        const reason = await intent.observe({ goal: 'save a property' });
        check('observe answers from the graph', reason.found === true && reason.mode === 'reason');
        check('reasoned journey ends with Save property', reason.path.at(-1)?.action === 'Save property', reason.path?.map((p) => p.action).join(' → '));

        console.log('\n    intent stats: ' + JSON.stringify(intent.stats));
        console.log('    audit sample: ' + JSON.stringify(intent.getAudit({ limit: 1 })));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

async function main() {
    compileUnit();
    await browserTests();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` INTENT PROTOCOL TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
