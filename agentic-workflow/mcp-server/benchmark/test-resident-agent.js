/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * RESIDENT PERCEPTION AGENT TEST — Phase 1 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the Digital Twin's core guarantees:
 *   1. Install + perceive         — window.__cbr is present and returns a populated model
 *   2. Parity                     — resident fingerprints match the legacy walker's element set
 *   3. Incremental updates        — a single attribute change yields a 1-element delta (no re-walk)
 *   4. Identity persistence       — a logical element keeps its cbrRef across a full re-render
 *   5. Delta push                 — the __cbrPush binding receives batches on mutation
 *   6. PURITY (critical for QA)   — injecting the agent does NOT alter the SUT: identical
 *                                   innerHTML, element count, and text vs a control load
 *
 *   node benchmark/test-resident-agent.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { getResidentAgentSource } from '../runtime/resident-agent.js';
import { SelectorEngine } from '../utils/selector-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RERENDER_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'spa-rerender.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
    // ── A. Bridge integration: resident agent enabled via config ────────────
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', residentAgent: true });
    await bridge.connect();

    const pushBatches = [];
    bridge.on('perception-delta', (d) => pushBatches.push(d));

    try {
        await bridge.navigate({ url: RERENDER_URL });
        // Allow the resident agent's DOMContentLoaded init + initial push to settle.
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 5000 });

        console.log('\n 1. install + perceive:');
        const perceived = await bridge.page.evaluate(() => window.__cbr.perceive());
        check('window.__cbr present', !!perceived);
        check('model is populated', perceived.elements.length > 0, `size=${perceived.elements.length}`);
        check('elements carry stable cbr refs', perceived.elements.every((e) => /^cbr-/.test(e.ref)), perceived.elements[0]?.ref);
        check('ready flag set', perceived.ready === true);

        console.log('\n 2. parity with legacy walker (same element set):');
        const walked = await bridge.page.evaluate(SelectorEngine.getEnrichedDomWalkerSource());
        // Compare on a stable identity signature (role|name|tag), order-independent.
        const sig = (e) => `${e.role || e.tag}|${(e.computedLabel || e.text || e.name || '').trim().toLowerCase()}`;
        const residentSigs = new Set(perceived.elements.map(sig));
        const walkerSigs = walked.map(sig);
        const missing = walkerSigs.filter((s) => !residentSigs.has(s));
        check('resident captures same count as walker (±2)', Math.abs(perceived.elements.length - walked.length) <= 2, `resident=${perceived.elements.length} walker=${walked.length}`);
        check('no walker element missing from resident model', missing.length === 0, `missing=${missing.slice(0, 3).join(' , ')}`);

        console.log('\n 3. incremental update (1 attr change → 1-element delta):');
        const beforeStats = await bridge.page.evaluate(() => window.__cbr.stats());
        await bridge.page.evaluate(() => { document.getElementById('apply-filters').setAttribute('aria-label', 'Apply all filters now'); });
        await bridge.page.waitForFunction((v) => window.__cbr.version() > v, beforeStats.version, { timeout: 3000 });
        const afterStats = await bridge.page.evaluate(() => window.__cbr.stats());
        check('incremental path used (no full rebuild)', afterStats.rebuilds === beforeStats.rebuilds, `rebuilds ${beforeStats.rebuilds}->${afterStats.rebuilds}`);
        check('exactly the changed element re-fingerprinted', afterStats.incremental === beforeStats.incremental + 1, `incremental ${beforeStats.incremental}->${afterStats.incremental}`);
        const updated = await bridge.page.evaluate(() => window.__cbr.perceive().elements.find((e) => e.ariaLabel === 'Apply all filters now'));
        check('updated fingerprint reflects the change', !!updated, JSON.stringify(updated?.ariaLabel));

        console.log('\n 4. identity persistence across full re-render:');
        const refFor = async (name) => bridge.page.evaluate((n) => {
            const els = window.__cbr.perceive().elements;
            const hit = els.find((e) => (e.computedLabel || e.text || '') === n);
            return hit ? hit.ref : null;
        }, name);
        const beforeRef = await refFor('Save property 3');
        await bridge.page.evaluate(() => window.__fixture.rerender());
        await bridge.page.waitForFunction(() => window.__cbr.size() > 0, null, { timeout: 3000 });
        const afterRef = await refFor('Save property 3');
        check('"Save property 3" keeps its cbrRef across re-render', !!beforeRef && beforeRef === afterRef, `${beforeRef} -> ${afterRef}`);

        console.log('\n 5. delta push to Node:');
        check('Node received ≥1 perception-delta push', pushBatches.length >= 1, `batches=${pushBatches.length}`);
        const storeRec = bridge._perceptionStore.getRecord(bridge.page);
        check('perception store tracked a version', (storeRec?.version || 0) > 0, JSON.stringify(storeRec?.totals));

        // ── B. PURITY: isolated control load vs injected load ────────────────
        console.log('\n 6. PURITY — agent does not contaminate the SUT:');
        const purity = await measurePurity();
        check('innerHTML byte-identical', purity.htmlEqual, `Δlen=${purity.htmlDelta}`);
        check('element count identical', purity.countEqual, `${purity.controlCount} vs ${purity.injectedCount}`);
        check('visible text identical', purity.textEqual, `Δlen=${purity.textDelta}`);
        check('only sanctioned globals added', purity.globalsOk, `extra=${purity.extraGlobals.join(',')}`);

        console.log(`\n════════════════════════════════════════════════════════════`);
        console.log(` RESIDENT AGENT TEST: ${pass} passed, ${fail} failed`);
        console.log(`════════════════════════════════════════════════════════════\n`);
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
    process.exit(fail === 0 ? 0 : 1);
}

/**
 * Load the SAME fully-static page twice in two fresh contexts — one clean (control), one
 * with the resident agent injected — and compare the resulting DOM. A static page (no app
 * randomness) makes this a true byte-for-byte check: any divergence means the agent mutated
 * the system under test, which is disqualifying for a QA tool.
 */
const PURITY_HTML = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Purity</title></head><body>',
    '<header><nav aria-label="Primary"><a href="#a" role="link">Search</a><a href="#b" role="link">Saved</a></nav></header>',
    '<main><form aria-label="Search">',
    '<label>City<input id="city" name="city" type="text" placeholder="City"></label>',
    '<button id="apply" data-testid="apply">Apply filters</button></form>',
    '<div class="grid">',
    '<div class="card" data-testid="c1"><h3>101 Oak St</h3><button data-testid="save-1">Save property 1</button></div>',
    '<div class="card" data-testid="c2"><h3>202 Maple Ave</h3><button data-testid="save-2">Save property 2</button></div>',
    '</div></main></body></html>',
].join('');

async function measurePurity() {
    const browser = await chromium.launch({ headless: process.env.MCP_HEADLESS !== 'false' });
    try {
        const readDom = async (inject) => {
            const ctx = await browser.newContext();
            if (inject) await ctx.addInitScript(getResidentAgentSource());
            const page = await ctx.newPage();
            // data: URL navigation creates the document already populated, so the
            // resident agent's initial walk sees the real DOM (unlike setContent,
            // which initializes the agent on an empty about:blank body first).
            await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(PURITY_HTML), { waitUntil: 'networkidle' });
            if (inject) await page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 5000 });
            const result = await page.evaluate(() => ({
                html: document.body.innerHTML,
                count: document.getElementsByTagName('*').length,
                text: (document.body.innerText || '').trim(),
                globals: Object.keys(window).filter((k) => k.startsWith('__')),
            }));
            await ctx.close();
            return result;
        };

        const control = await readDom(false);
        const injected = await readDom(true);

        // Sanctioned globals the agent is allowed to add.
        const allowed = new Set(['__cbr', '__cbrPush', '__mcpDomSeq', '__mcpDomSeqInstalled', '__cbrKey', '__playwright__binding__']);
        const extraGlobals = injected.globals.filter((g) => !control.globals.includes(g) && !allowed.has(g));

        return {
            htmlEqual: control.html === injected.html,
            htmlDelta: injected.html.length - control.html.length,
            countEqual: control.count === injected.count,
            controlCount: control.count,
            injectedCount: injected.count,
            textEqual: control.text === injected.text,
            textDelta: injected.text.length - control.text.length,
            globalsOk: extraGlobals.length === 0,
            extraGlobals,
        };
    } finally {
        await browser.close();
    }
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
