/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * INTELLIGENT PRIMITIVES TEST — validates act / observe / extract end-to-end
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Offline, deterministic. Exercises the self-healing target resolver, the callTool
 * routing path (browser_act/observe/extract), and structured extraction.
 *   node benchmark/test-primitives.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = pathToFileURL(path.join(__dirname, 'fixture.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false' });
    await bridge.connect();
    try {
        await bridge.navigate({ url: FIXTURE_URL });

        console.log('\n observe:');
        const obs = await bridge.observeIntelligent({ target: 'Apply filters' });
        check('observe finds "Apply filters"', obs.found > 0, JSON.stringify(obs.candidates?.[0]));
        check('top candidate has a selector', !!obs.candidates?.[0]?.selector, obs.candidates?.[0]?.selector);

        console.log('\n act (string target, fuzzy name):');
        const a1 = await bridge.actIntelligent({ action: 'click', target: 'Save property 1' });
        check('act click "Save property 1" ok', a1.ok === true, JSON.stringify(a1));
        check('act did not navigate (button)', a1.urlChanged === false);

        console.log('\n act (type into a field by name):');
        const a2 = await bridge.actIntelligent({ action: 'fill', target: 'City', text: 'Austin' });
        check('act fill City ok', a2.ok === true, JSON.stringify(a2));
        const cityVal = await bridge.extractIntelligent({ target: { selector: '#city' }, what: 'value' });
        check('City value is "Austin"', cityVal.value === 'Austin', JSON.stringify(cityVal));

        console.log('\n act (structured role+name target):');
        const a3 = await bridge.actIntelligent({ action: 'click', targetSpec: { role: 'button', name: 'Apply filters' } });
        check('act click role=button name="Apply filters" ok', a3.ok === true, JSON.stringify(a3));
        check('act reports a resolution strategy', !!a3.strategy, a3.strategy);

        console.log('\n act (self-heal on unknown target):');
        const a4 = await bridge.actIntelligent({ action: 'click', target: 'Totally Nonexistent Button XYZ' });
        check('act returns ok:false for missing target', a4.ok === false, JSON.stringify(a4));
        check('act provides suggestions on miss', Array.isArray(a4.suggestions));

        console.log('\n extract (text / attribute / table):');
        const ex1 = await bridge.extractIntelligent({ target: 'Download the OneHome App', what: 'text' });
        check('extract footer heading text', /OneHome App/i.test(ex1.value || ''), JSON.stringify(ex1));

        const ex2 = await bridge.extractIntelligent({ target: { selector: "a[aria-label='Download on the App Store']" }, what: 'attribute', attribute: 'href' });
        check('extract App Store href', /apps\.apple\.com/.test(ex2.value || ''), JSON.stringify(ex2));

        const ex3 = await bridge.extractIntelligent({ what: 'table' });
        check('extract table has rows', (ex3.rowCount || 0) > 1, `rows=${ex3.rowCount}`);
        check('table header row parsed', Array.isArray(ex3.rows?.[0]) && ex3.rows[0].includes('Address'), JSON.stringify(ex3.rows?.[0]));

        console.log('\n callTool routing (browser_act / browser_observe / browser_extract):');
        const r1 = await bridge.callTool('browser_observe', { target: 'Reset' });
        check('callTool browser_observe routes', r1.found >= 1, JSON.stringify(r1.candidates?.[0]));
        const r2 = await bridge.callTool('browser_act', { action: 'click', target: 'Save property 2' });
        check('callTool browser_act routes', r2.ok === true, JSON.stringify(r2));
        const r3 = await bridge.callTool('browser_extract', { target: 'Find your next home', what: 'text' });
        check('callTool browser_extract routes', /next home/i.test(r3.value || ''), JSON.stringify(r3));

        console.log(`\n════════════════════════════════════════════════════════════`);
        console.log(` PRIMITIVES TEST: ${pass} passed, ${fail} failed`);
        console.log(`════════════════════════════════════════════════════════════\n`);
    } finally {
        await bridge.browser?.close?.();
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
