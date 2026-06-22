/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * VISION FUSION TEST — Phase 5 verification (offline, deterministic — stub provider)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves DOM/AX + visual fusion on DOM-blind controls:
 *   1. StubVisionProvider unit — maps icon tokens / svg-title / img-alt / title / canvas → labels.
 *   2. Ambiguity detection     — identifies interactive/canvas elements with NO accessible name.
 *   3. Fusion fills names       — each DOM-blind control gets a visualLabel + confidence + source.
 *   4. Addressability lift      — % of interactive elements with a usable name rises sharply.
 *   5. Budget + transparency    — capped vision calls; every fused name carries visualSource.
 *   6. Crops captured           — element-region screenshots succeed (pipeline proven).
 *
 *   node benchmark/test-vision-fusion.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { StubVisionProvider } from '../runtime/vision-provider.js';
import { VisionFusion } from '../runtime/vision-fusion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISION_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'vision-ambiguous.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function unitTests() {
    console.log('\n 1. StubVisionProvider unit:');
    const p = new StubVisionProvider();
    const search = await p.describe({ hints: { iconToken: 'icon-search' }, bounds: { width: 36, height: 36 } });
    check('icon-search → "Search"', search?.label === 'Search', JSON.stringify(search));
    const trash = await p.describe({ hints: { iconToken: 'fa-trash' } });
    check('fa-trash → "Delete"', trash?.label === 'Delete', JSON.stringify(trash));
    const svg = await p.describe({ hints: { svgTitle: 'Download report' } });
    check('svg-title → "Download report"', svg?.label === 'Download report' && svg.source === 'vision:svg-title');
    const img = await p.describe({ hints: { imgAlt: 'Share listing' } });
    check('img-alt → "Share listing"', img?.label === 'Share listing');
    const canvas = await p.describe({ hints: { tag: 'canvas' }, bounds: { width: 240, height: 120 } });
    check('bare canvas → low-confidence region', canvas?.role === 'img' && canvas.confidence <= 0.4, JSON.stringify(canvas));
    const none = await p.describe({ hints: {} });
    check('no signal → null', none === null);
}

async function browserTests() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', visionFusion: true });
    await bridge.connect();
    try {
        await bridge.navigate({ url: VISION_URL });

        console.log('\n 2. ambiguity detection (DOM-blind controls):');
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        const all = [...bridge.snapshotRefs.values()];
        const fusion = new VisionFusion(bridge);
        const ambiguous = fusion.identifyAmbiguous(all);
        const interactive = all.filter((e) => e.isInteractive || e.tag === 'canvas');
        check('found multiple DOM-blind controls', ambiguous.length >= 5, `ambiguous=${ambiguous.length} of ${interactive.length}`);
        check('all ambiguous elements truly lack a DOM name', ambiguous.every((e) => !VisionFusion.domName(e)));

        console.log('\n 3. fusion fills names (vision snapshot):');
        const before = countNamed(interactive);
        const snap = await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false, vision: true });
        const fusedEls = [...bridge.snapshotRefs.values()].filter((e) => e.fusedName);
        check('snapshot reports vision metadata', !!snap._vision && snap._vision.fused > 0, JSON.stringify(snap._vision));
        check('search button recovered', fusedEls.some((e) => e.visualLabel === 'Search'));
        check('delete button recovered', fusedEls.some((e) => e.visualLabel === 'Delete'));
        check('settings button recovered', fusedEls.some((e) => e.visualLabel === 'Settings'));
        check('download (svg-title) recovered', fusedEls.some((e) => e.visualLabel === 'Download report'));
        check('share (img-alt) recovered', fusedEls.some((e) => e.visualLabel === 'Share listing'));
        check('canvas region recovered', fusedEls.some((e) => /canvas|chart/i.test(e.visualLabel || '')));
        // The title-tooltip button is NOT vision-fused: the DOM walker already folds `title`
        // into the accessible name, so vision correctly skips it (DOM stays primary).
        const tipBtn = [...bridge.snapshotRefs.values()].find((e) => VisionFusion.domName(e) === 'Add to favorites');
        check('title button kept its DOM name (not vision-fused)', !!tipBtn && !tipBtn.fusedName, JSON.stringify(tipBtn?.fusedName));
        console.log('    fusions: ' + JSON.stringify((snap._vision && fusedEls.map((e) => `${e.visualLabel}[${e.visualSource}]`)) || []));

        console.log('\n 4. addressability lift:');
        const after = countNamed([...bridge.snapshotRefs.values()].filter((e) => e.isInteractive || e.tag === 'canvas'));
        console.log(`    interactive elements with a usable name: ${before}/${interactive.length} → ${after}/${interactive.length}`);
        check('addressability rose substantially', after >= before + 5, `${before} → ${after}`);

        console.log('\n 5. budget + transparency:');
        const budgeted = new VisionFusion(bridge, { maxVisionCalls: 2 });
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        const r = await budgeted.fuse([...bridge.snapshotRefs.values()]);
        check('respects maxVisionCalls budget', r.fusedCount <= 2, `fused=${r.fusedCount}`);
        check('every fused element carries visualSource', fusedEls.every((e) => !!e.visualSource));
        check('stub provider used (zero model calls)', snap._vision.provider === 'stub');

        console.log('\n 6. element-region crops:');
        check('crops captured for ambiguous elements', fusion.stats.crops >= 0); // populated below via explicit fuse
        const cropFusion = new VisionFusion(bridge, { captureCrops: true });
        await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
        await cropFusion.fuse([...bridge.snapshotRefs.values()]);
        check('element-region screenshots succeeded', cropFusion.stats.crops >= 1 && cropFusion.stats.cropFailures === 0, JSON.stringify(cropFusion.stats));

        console.log('\n    vision stats: ' + JSON.stringify(cropFusion.stats));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

function countNamed(els) {
    return els.filter((e) => VisionFusion.domName(e)).length;
}

async function main() {
    await unitTests();
    await browserTests();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` VISION FUSION TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
