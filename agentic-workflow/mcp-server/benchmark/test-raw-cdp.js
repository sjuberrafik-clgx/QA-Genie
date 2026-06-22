/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * RAW-CDP TRANSPORT TEST — Phase 3 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the raw-CDP fast-path transport and the router:
 *   1. Availability        — raw-CDP is available on Chromium; Playwright always is.
 *   2. evaluate parity      — Runtime.evaluate (raw) returns the same value as page.evaluate.
 *   3. click parity         — Input.dispatchMouseEvent (raw) triggers the same handler as a
 *                             Playwright click (a counter increments identically).
 *   4. type / AX tree       — Input.insertText types; Accessibility.getFullAXTree returns nodes.
 *   5. router fast-path      — the router routes hot ops to raw-CDP and falls back to Playwright.
 *   6. latency               — raw evaluate vs Playwright evaluate (informational).
 *   7. fastClickRef          — the bridge clicks a snapshot ref via the transport (twin bounds).
 *
 *   node benchmark/test-raw-cdp.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { PlaywrightTransport } from '../transport/playwright-transport.js';
import { RawCdpTransport } from '../transport/raw-cdp-transport.js';
import { TransportRouter } from '../transport/transport-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPA_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'spa-rerender.html')).href;

// Self-contained page with a click counter, so click parity is unambiguous.
const COUNTER_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent([
    '<!DOCTYPE html><html><head><title>Counter</title></head><body>',
    '<button id="b" style="position:absolute;left:40px;top:40px;width:120px;height:40px">Click me</button>',
    '<input id="t" style="position:absolute;left:40px;top:120px" />',
    '<script>window.__clicks=0;document.getElementById("b").addEventListener("click",()=>{window.__clicks++;});</script>',
    '</body></html>',
].join(''));

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const ms = (n) => `${n.toFixed(2)}ms`;

async function main() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', rawCdp: true });
    await bridge.connect();
    const getPage = () => bridge.page;
    const pw = new PlaywrightTransport(getPage);
    const raw = new RawCdpTransport(getPage, { browser: 'chromium' });

    try {
        await bridge.navigate({ url: COUNTER_PAGE });

        console.log('\n 1. availability:');
        check('Playwright transport available', await pw.isAvailable());
        check('raw-CDP transport available (chromium)', await raw.isAvailable());
        const rawFf = new RawCdpTransport(getPage, { browser: 'firefox' });
        check('raw-CDP reports unavailable on firefox', (await rawFf.isAvailable()) === false);

        console.log('\n 2. evaluate parity:');
        const rawVal = await raw.evaluate('1 + 2 + 3');
        const pwVal = await pw.evaluate('1 + 2 + 3');
        check('raw evaluate returns value', rawVal === 6, String(rawVal));
        check('raw === playwright', rawVal === pwVal);
        const argEval = await raw.evaluate('arg.a * arg.b', { a: 6, b: 7 });
        check('raw evaluate passes arg', argEval === 42, String(argEval));
        const domEval = await raw.evaluate('document.querySelectorAll("button").length');
        check('raw evaluate reads DOM', domEval === 1, String(domEval));

        console.log('\n 3. click parity (Input.dispatchMouseEvent):');
        const rect = await raw.evaluate('(() => { const r = document.getElementById("b").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
        await raw.evaluate('window.__clicks = 0');
        await raw.clickAt(rect.x, rect.y);
        const afterRaw = await raw.evaluate('window.__clicks');
        check('raw clickAt triggered the handler', afterRaw === 1, `clicks=${afterRaw}`);
        await pw.clickAt(rect.x, rect.y);
        const afterPw = await raw.evaluate('window.__clicks');
        check('playwright click parity (same handler)', afterPw === 2, `clicks=${afterPw}`);

        console.log('\n 4. type / AX tree:');
        await raw.evaluate('document.getElementById("t").focus()');
        await raw.typeText('hello');
        const typed = await raw.evaluate('document.getElementById("t").value');
        check('raw typeText inserted text', typed === 'hello', typed);
        const ax = await raw.getAXTree();
        check('raw getAXTree returns nodes', Array.isArray(ax.nodes) && ax.nodes.length > 0, `nodes=${ax.nodes?.length}`);

        console.log('\n 5. router fast-path + fallback:');
        const router = new TransportRouter({ playwright: pw, rawCdp: raw }, { preferRaw: true });
        const r1 = await router.evaluate('21 * 2');
        check('router routes to raw by default', r1 === 42 && router.stats.raw >= 1, JSON.stringify(router.stats));
        router.setPreferRaw(false);
        const r2 = await router.evaluate('21 * 2');
        check('router falls back to playwright when preferRaw off', r2 === 42 && router.stats.playwright >= 1, JSON.stringify(router.stats));

        console.log('\n 6. latency (raw vs playwright evaluate):');
        const N = 30;
        const tRaw = await timeN(() => raw.evaluate('document.title'), N);
        const tPw = await timeN(() => pw.evaluate('document.title'), N);
        console.log(`    raw evaluate mean ${ms(tRaw)} | playwright evaluate mean ${ms(tPw)} over ${N} runs`);
        check('raw evaluate completes', tRaw > 0);

        console.log('\n 7. fastClickRef (bridge, twin bounds):');
        await bridge.navigate({ url: SPA_URL });
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        let applyRef = null;
        for (const [ref, el] of bridge.snapshotRefs) {
            if ((el.computedLabel || el.text) === 'Apply filters') { applyRef = ref; break; }
        }
        const fc = await bridge.fastClickRef(applyRef);
        check('fastClickRef clicked via transport', fc.success === true && fc.via === 'transport', JSON.stringify(fc));

        console.log('\n    router stats: ' + JSON.stringify(router.stats));
    } finally {
        await raw.dispose();
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` RAW-CDP TRANSPORT TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

async function timeN(fn, n) {
    await fn();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await fn();
    return (performance.now() - t0) / n;
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
