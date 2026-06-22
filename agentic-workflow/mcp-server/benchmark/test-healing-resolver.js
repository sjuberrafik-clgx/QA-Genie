/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HEALING RESOLVER TEST — Phase 4 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves self-healing:
 *   1. HealStore unit       — records resolves/heals, prefers stable selectors, persists.
 *   2. Identity capture     — captureIdentity returns the resident agent's stable key.
 *   3. Heal re-anchor       — a selector broken by a re-render is re-anchored to its element
 *                             via identity, returning a fresh, validated selector.
 *   4. WARN event           — every heal emits a structured 'selector-heal' WARN (QA-integrity).
 *   5. Survival lift        — across ALL broken selectors on spa-rerender, effective survival
 *                             (raw + healed) approaches the identity ceiling (≫ raw survival).
 *
 *   node benchmark/test-healing-resolver.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { HealStore } from '../runtime/heal-store.js';
import { captureTrackedSelectors, checkSelectorSurvival, checkSelectorSurvivalWithHealing } from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RERENDER_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'spa-rerender.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function unitTests() {
    console.log('\n 1. HealStore unit (in-memory):');
    const store = new HealStore({ persist: false });
    store.recordResolve('button|save property 3', "[data-testid='save-prop-3']", 'test-id');
    check('records a resolve', store.stats().totalResolves === 1);
    check('best selector is the stable test-id', store.bestSelector('button|save property 3') === "[data-testid='save-prop-3']");

    store.recordHeal({ identity: 'button|save property 1', brokenSelector: '#save-x1', healedSelector: "getByRole('button',{name:'Save property 1'})", strategy: 'identity-reanchor' });
    check('records a heal', store.stats().totalHeals === 1);
    const rec = store.getRecord('button|save property 1');
    check('heal record tracks broken + healed', rec.brokenSelectors['#save-x1'] === 1 && rec.healCount === 1, JSON.stringify(rec.strategies));
    // A more-stable strategy should win the stable slot; a weaker one should not override.
    store.recordHeal({ identity: 'button|save property 1', brokenSelector: '#save-x2', healedSelector: '.weak', strategy: 'text' });
    check('weaker strategy does not override stable anchor', store.bestSelector('button|save property 1') !== '.weak', store.bestSelector('button|save property 1'));
}

async function browserTests() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', residentAgent: true, healPersist: false });
    await bridge.connect();

    const healEvents = [];
    bridge.on('selector-heal', (h) => healEvents.push(h));

    try {
        await bridge.navigate({ url: RERENDER_URL });
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 5000 });

        console.log('\n 2. identity capture:');
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        // Find a Tier-B element (dynamic-id selector that will break on re-render): "Save property 1".
        let targetRef = null, targetCss = null, targetIdentity = null;
        for (const [ref, el] of bridge.snapshotRefs) {
            const name = el.computedLabel || el.text;
            if (name === 'Save property 1' && el.isInteractive) { targetRef = ref; targetCss = el.selector?.cssSelector; break; }
        }
        check('found "Save property 1" with a selector', !!targetRef && !!targetCss, targetCss);
        targetIdentity = await bridge._healingResolver.captureIdentity(targetRef, { selector: targetCss, strategy: 'test' });
        check('captured a stable identity', !!targetIdentity, targetIdentity);

        console.log('\n 3. heal re-anchor after re-render:');
        // Re-render → dynamic ids change → the captured selector should break.
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 3000 });
        const stillResolves = await bridge.page.evaluate((s) => { try { return document.querySelectorAll(s).length; } catch { return -1; } }, targetCss);
        const healResult = await bridge._healingResolver.heal({ brokenSelector: targetCss, identity: targetIdentity, reason: 'test-rerender' });
        check('heal succeeded', healResult.healed === true, JSON.stringify(healResult.reason));
        check('healed selector is reported', !!healResult.healedTo, healResult.healedTo);
        check('heal is reported with provenance', !!healResult.identity && !!healResult.strategy, `${healResult.strategy}`);

        console.log(`    (original selector "${targetCss}" matched ${stillResolves} after re-render → healed to "${healResult.healedTo}" [${healResult.selectorKind}])`);

        console.log('\n 4. WARN event (QA-integrity):');
        check('a selector-heal event was emitted', healEvents.length >= 1, `events=${healEvents.length}`);
        check("event level is 'warn' (surfaced, not hidden)", healEvents[0]?.level === 'warn');
        check('event carries original + healedTo', !!healEvents[0]?.original && !!healEvents[0]?.healedTo);

        console.log('\n 5. survival lift across ALL broken selectors:');
        // Fresh capture + re-render, then measure raw vs effective(healed) survival.
        const tracked = await captureTrackedSelectors(bridge);
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 3000 });
        const raw = await checkSelectorSurvival(bridge, tracked);
        const healed = await checkSelectorSurvivalWithHealing(bridge, tracked);
        console.log(`    raw survival=${raw.survivalPct}% | identity ceiling=${raw.identityPct}% | effective(healed)=${healed.effectiveSurvivalPct}%`);
        check('healing lifts survival above raw', healed.effectiveSurvivalPct > raw.survivalPct, `${raw.survivalPct}% → ${healed.effectiveSurvivalPct}%`);
        check('effective survival approaches identity ceiling (≥90%)', healed.effectiveSurvivalPct >= 90, `${healed.effectiveSurvivalPct}%`);

        console.log('\n    heal store: ' + JSON.stringify(bridge._healStore.stats()));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

async function main() {
    unitTests();
    await browserTests();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` HEALING RESOLVER TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
