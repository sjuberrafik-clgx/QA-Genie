/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CROSS-BROWSER TEST — Phase 8 verification (Chromium + Firefox + WebKit)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the CBR runtime is ENGINE-AGNOSTIC: the resident perception agent, the live Digital
 * Twin, identity persistence, and self-healing all run unchanged on every engine — because they
 * use only addInitScript + exposeBinding + standard web APIs. The Chromium raw-CDP fast path
 * (Phase 3) correctly disables on Firefox/WebKit, where the BiDi transport (Playwright's
 * cross-browser primitives) takes over.
 *
 * For each of chromium / firefox / webkit:
 *   • resident agent installs + perceive() returns a populated model
 *   • a logical element keeps its cbrRef across a full re-render (identity persistence)
 *   • the self-healing resolver re-anchors a broken selector
 *   • raw-CDP transport is available ONLY on chromium; the BiDi transport is available on the engine
 *
 *   node benchmark/test-cross-browser.js
 *   (requires: npx playwright install firefox webkit)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { RawCdpTransport } from '../transport/raw-cdp-transport.js';
import { BiDiTransport } from '../transport/bidi-transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPA_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'spa-rerender.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function testEngine(engine) {
    console.log(`\n ▸ ${engine}:`);
    const bridge = new PlaywrightDirectBridge({
        headless: process.env.MCP_HEADLESS !== 'false',
        browser: engine, residentAgent: true, rawCdp: true, healPersist: false,
    });
    await bridge.connect();
    const getPage = () => bridge.page;
    try {
        await bridge.navigate({ url: SPA_URL });
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 8000 });

        // 1. Resident agent + perception.
        const perceived = await bridge.page.evaluate(() => window.__cbr.perceive());
        check(`${engine}: resident agent installed + model populated`, perceived && perceived.elements.length > 0, `n=${perceived?.elements?.length}`);

        // 2. Identity persistence across re-render.
        const refOf = async (name) => bridge.page.evaluate((n) => {
            const hit = window.__cbr.perceive().elements.find((e) => (e.computedLabel || e.text) === n);
            return hit ? hit.ref : null;
        }, name);
        const before = await refOf('Save property 3');
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 4000 });
        const after = await refOf('Save property 3');
        check(`${engine}: identity persists across re-render`, !!before && before === after, `${before} → ${after}`);

        // 3. Self-healing on a broken selector.
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        let ident = null, brokenCss = null;
        for (const [ref, el] of bridge.snapshotRefs) {
            if ((el.computedLabel || el.text) === 'Save property 1') {
                brokenCss = el.selector?.cssSelector;
                ident = await bridge._healingResolver.captureIdentity(ref, { selector: brokenCss, strategy: 'test' });
                break;
            }
        }
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 4000 });
        const heal = await bridge._healingResolver.heal({ brokenSelector: brokenCss, identity: ident, reason: 'xbrowser' });
        check(`${engine}: self-healing re-anchors broken selector`, heal.healed === true, JSON.stringify(heal.reason));

        // 4. Transport availability per engine.
        const raw = new RawCdpTransport(getPage, { browser: engine });
        const bidi = new BiDiTransport(getPage, { engine });
        const rawAvail = await raw.isAvailable();
        const bidiAvail = await bidi.isAvailable();
        if (engine === 'chromium') {
            check(`${engine}: raw-CDP fast path available`, rawAvail === true);
        } else {
            check(`${engine}: raw-CDP correctly unavailable (non-chromium)`, rawAvail === false);
        }
        check(`${engine}: BiDi transport available + evaluate works`, bidiAvail === true && (await bidi.evaluate('6*7')) === 42);
        await raw.dispose();
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

async function main() {
    const engines = (process.env.CBR_ENGINES || 'chromium,firefox,webkit').split(',');
    for (const e of engines) {
        try { await testEngine(e.trim()); }
        catch (err) { fail++; console.log(`  ❌ ${e}: engine test crashed — ${err.message.split('\n')[0]}`); }
    }
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` CROSS-BROWSER TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
