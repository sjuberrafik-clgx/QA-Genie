/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * APP GRAPH TEST — Phase 6 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the application knowledge graph:
 *   1. Engine unit          — record states/transitions; confidence rises with observation;
 *                             howDoI() returns the correct journey; persistence round-trips.
 *   2. Perception → graph    — drive a REAL linked journey (home → search → detail → saved),
 *                             recording labeled transitions from live perception.
 *   3. Answer WITHOUT browser — close the browser, then howDoI("save a property") returns the
 *                             full path [Search properties, View 101 Oak St, Save property].
 *   4. Bridge auto-wire      — navigate() records states/edges when MCP_APP_GRAPH is on.
 *
 *   node benchmark/test-app-graph.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { AppGraph, CONFIDENCE_LEVELS } from '../runtime/app-graph.js';
import { GraphRecorder } from '../runtime/graph-recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const journeyUrl = (f) => pathToFileURL(path.join(__dirname, 'fixtures', 'journey', f)).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function unitTests() {
    console.log('\n 1. AppGraph engine unit:');
    const g = new AppGraph({ persist: false });
    g.recordState({ url: 'https://app/home', title: 'Home', elementNames: ['Search properties'] });
    g.recordState({ url: 'https://app/search', title: 'Search', elementNames: ['View 101 Oak St'] });
    g.recordState({ url: 'https://app/detail', title: '101 Oak St', elementNames: ['Save property', 'Request a tour'] });
    g.recordState({ url: 'https://app/saved', title: 'Saved homes' });
    g.recordTransition({ fromUrl: 'https://app/home', toUrl: 'https://app/search', action: 'Search properties' });
    g.recordTransition({ fromUrl: 'https://app/search', toUrl: 'https://app/detail', action: 'View 101 Oak St' });
    g.recordTransition({ fromUrl: 'https://app/detail', toUrl: 'https://app/saved', action: 'Save property' });

    check('records states + edges', g.stats().states === 4 && g.stats().edges === 3, JSON.stringify(g.stats()));

    const answer = g.howDoI('save a property');
    check('howDoI finds a journey', answer.found === true);
    check('journey is the full 3-step path', answer.path.length === 3, JSON.stringify(answer.path.map((p) => p.action)));
    check('steps in correct order', answer.path.map((p) => p.action).join(' → ') === 'Search properties → View 101 Oak St → Save property', answer.path.map((p) => p.action).join(' → '));

    // Confidence rises with repeated observation.
    const before = g.getState('https://app/detail').status;
    for (let i = 0; i < 4; i++) g.recordTransition({ fromUrl: 'https://app/detail', toUrl: 'https://app/saved', action: 'Save property' });
    g.recordState({ url: 'https://app/detail', title: '101 Oak St' });
    const saveEdge = g.edges().find((e) => e.action === 'Save property');
    check('confidence rises with observation', saveEdge.confidence > 0.5 && [CONFIDENCE_LEVELS.STRONG, CONFIDENCE_LEVELS.VERIFIED].includes(saveEdge.status), `${saveEdge.status} @ ${saveEdge.confidence}`);
    check('unknown goal returns not-found', g.howDoI('teleport to mars').found === false);

    // Persistence round-trip.
    const tmp = path.join(os.tmpdir(), `cbr-appgraph-${Date.now()}.json`);
    const g2 = new AppGraph({ dataFile: tmp, persist: true });
    g2.recordState({ url: 'https://app/x', title: 'X' });
    g2.recordTransition({ fromUrl: 'https://app/x', toUrl: 'https://app/y', action: 'Go Y' });
    g2.flush();
    const g3 = new AppGraph({ dataFile: tmp, persist: true });
    check('persists + reloads from disk', g3.stats().states >= 2 && g3.edges().some((e) => e.action === 'Go Y'), JSON.stringify(g3.stats()));
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
}

async function clickThrough(bridge, recorder, label) {
    recorder.noteAction(label);
    await bridge.actIntelligent({ action: 'click', target: label });
    await bridge.page.waitForLoadState('load').catch(() => {});
    await recorder.recordCurrent({ snapshot: true });
}

async function journeyTest() {
    console.log('\n 2. perception → graph (real linked journey):');
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false' });
    await bridge.connect();
    const graph = new AppGraph({ persist: false });
    const recorder = new GraphRecorder(bridge, graph);
    let offlineAnswer = null;
    try {
        await bridge.navigate({ url: journeyUrl('home.html') });
        await recorder.recordCurrent({ snapshot: true });   // initial state
        await clickThrough(bridge, recorder, 'Search properties');
        await clickThrough(bridge, recorder, 'View 101 Oak St');
        await clickThrough(bridge, recorder, 'Save property');

        check('recorded all journey states', graph.stats().states >= 4, JSON.stringify(graph.stats()));
        check('recorded labeled transitions', graph.edges().some((e) => e.action === 'Save property'), graph.edges().map((e) => e.action).join(', '));

        // Compute the answer while still connected (sanity), then again after close.
        offlineAnswer = graph.howDoI('save a property');
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }

    console.log('\n 3. answer WITHOUT browser (browser now closed):');
    check('browser is closed', !bridge.browser);
    const answer = graph.howDoI('save a property');   // queried after close — no browser involved
    check('howDoI answers offline', answer.found === true, JSON.stringify(answer));
    check('offline journey ends with "Save property"', answer.path.at(-1)?.action === 'Save property', answer.path.map((p) => p.action).join(' → '));
    check('offline journey starts at home', /home\.html$/.test(answer.path[0]?.fromUrl || ''), answer.path[0]?.fromUrl);
    console.log('    answer: ' + answer.path.map((p) => p.action).join('  →  '));
}

async function autoWireTest() {
    console.log('\n 4. bridge auto-wire (MCP_APP_GRAPH):');
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', appGraph: true, appGraphPersist: false });
    await bridge.connect();
    try {
        await bridge.navigate({ url: journeyUrl('home.html') });
        await bridge.navigate({ url: journeyUrl('search.html') });
        check('app graph recorded states via navigate()', bridge._appGraph.stats().states >= 2, JSON.stringify(bridge._appGraph.stats()));
        check('app graph recorded a transition', bridge._appGraph.edges().length >= 1, JSON.stringify(bridge._appGraph.edges().map((e) => e.action)));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

async function main() {
    unitTests();
    await journeyTest();
    await autoWireTest();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` APP GRAPH TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
