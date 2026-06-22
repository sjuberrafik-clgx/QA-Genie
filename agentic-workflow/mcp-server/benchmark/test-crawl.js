/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CRAWL ENGINE TEST — validates the autonomous DevTools crawler end-to-end (offline)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   node benchmark/test-crawl.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { crawlSite } from '../crawler/crawl-engine.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_URL = pathToFileURL(path.join(__dirname, 'crawl-fixture', 'index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

async function main() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false' });
    await bridge.connect();
    try {
        const t0 = performance.now();
        const result = await crawlSite(bridge, { startUrl: START_URL, maxPages: 5, maxDepth: 2 });
        const ms = performance.now() - t0;

        console.log('\n CRAWL RESULT (compact, returned to agent):');
        console.log(JSON.stringify(result, null, 2).split('\n').slice(0, 40).join('\n'));

        check('crawl ok', result.ok === true);
        check('visited home + A + B (>=3 pages)', result.pagesVisited >= 3, `visited=${result.pagesVisited}`);
        check('stayed in scope (no example.com)', !result.pages.some((p) => /example\.com/.test(p.url)));
        check('captured console errors (home)', result.totals.consoleErrors >= 1, `consoleErrors=${result.totals.consoleErrors}`);
        check('captured network failures', result.totals.networkFailed >= 1, `networkFailed=${result.totals.networkFailed}`);
        check('returned result is compact (<8KB)', bytes(result) < 8192, `${bytes(result)} bytes`);
        check('saved a site model path', typeof result.savedTo === 'string' && result.savedTo.endsWith('.json'));

        // Validate the persisted full model has the deep details.
        const modelPath = path.join(REPO_ROOT, result.savedTo);
        check('site model file exists on disk', fs.existsSync(modelPath), modelPath);
        if (fs.existsSync(modelPath)) {
            const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
            check('model.source = mcp-live-crawl', model.source === 'mcp-live-crawl');
            const home = model.pages.find((p) => /index\.html/.test(p.url));
            check('home page has keySelectors', Array.isArray(home?.keySelectors) && home.keySelectors.length > 0);
            check('home keySelectors include a data-testid', home?.keySelectors.some((s) => /getByTestId|data-testid/.test(s.selector || '')));
            check('home captured perf (Web Vitals)', !!home?.performance);
            check('home captured a network summary', !!home?.network && typeof home.network.total === 'number');
            check('home detected the form controls', (home?.formControls || 0) >= 1);
            // Clean up the generated model file to keep the workspace tidy.
            try { fs.unlinkSync(modelPath); } catch { /* ignore */ }
        }

        console.log(`\n Crawl wall-clock: ${ms.toFixed(0)} ms for ${result.pagesVisited} pages`);
        console.log(`\n════════════════════════════════════════════════════════════`);
        console.log(` CRAWL TEST: ${pass} passed, ${fail} failed`);
        console.log(`════════════════════════════════════════════════════════════\n`);
    } finally {
        await bridge.browser?.close?.();
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Crawl test crashed:', e); process.exit(1); });
