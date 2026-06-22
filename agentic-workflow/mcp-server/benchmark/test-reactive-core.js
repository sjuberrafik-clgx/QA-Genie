/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * REACTIVE CORE TEST — Phase 2 verification (offline, deterministic)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Proves the event-driven core:
 *   1. ReactiveCore unit  — waitForBlocker / waitForQuiescence / observePostAction resolve
 *                           correctly off plain emitted events (no browser).
 *   2. In-page detection  — the resident agent pushes a 'blocker' the instant a modal is
 *                           added to the DOM, and pushes present:false when it's removed.
 *   3. Push latency       — modal appear → bridge 'blocker' event fires fast (event-driven).
 *   4. No-poll guarantee  — during post-action observation with NO blocker, the bridge does
 *                           not poll getBlockingState in a loop (round-trips ≈ minimal).
 *
 *   node benchmark/test-reactive-core.js
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightDirectBridge } from '../bridges/playwright-bridge-direct.js';
import { ReactiveCore } from '../runtime/reactive-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODAL_URL = pathToFileURL(path.join(__dirname, 'fixtures', 'modal-storm.html')).href;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unitTests() {
    console.log('\n 1. ReactiveCore unit (plain events, no browser):');

    // waitForBlocker resolves on a pushed blocker.
    const e1 = new EventEmitter();
    const rc1 = new ReactiveCore(e1);
    const p1 = rc1.waitForBlocker({ timeoutMs: 500 });
    setTimeout(() => e1.emit('blocker', { present: true, kind: 'dom-modal', selectorHint: '#m' }), 20);
    const got = await p1;
    check('waitForBlocker resolves on push', got && got.present === true, JSON.stringify(got));
    check('hasBlocker reflects state', rc1.hasBlocker() === true);

    // waitForBlocker resolves null on timeout (no blocker).
    const e2 = new EventEmitter();
    const rc2 = new ReactiveCore(e2);
    const t0 = Date.now();
    const none = await rc2.waitForBlocker({ timeoutMs: 120 });
    check('waitForBlocker resolves null on timeout', none === null, String(none));
    check('timeout respected (~120ms)', Date.now() - t0 >= 100);

    // observePostAction settles via quiescence when no blocker.
    const e3 = new EventEmitter();
    const rc3 = new ReactiveCore(e3);
    const obs = await rc3.observePostAction({ maxMs: 500, quietMs: 80 });
    check('observePostAction settles (no blocker)', obs.blocker === null && obs.settled === true, JSON.stringify(obs));
    check('observePostAction settled fast (< maxMs)', obs.waitedMs < 400, `${obs.waitedMs}ms`);

    // observePostAction returns immediately when a blocker is already present.
    const e4 = new EventEmitter();
    const rc4 = new ReactiveCore(e4);
    e4.emit('blocker', { present: true, kind: 'dom-modal' });
    const obs2 = await rc4.observePostAction({ maxMs: 500, quietMs: 80 });
    check('observePostAction short-circuits on existing blocker', obs2.blocker && obs2.waitedMs === 0, JSON.stringify(obs2));

    // navigation clears a DOM blocker.
    const e5 = new EventEmitter();
    const rc5 = new ReactiveCore(e5);
    e5.emit('blocker', { present: true, kind: 'dom-modal' });
    check('blocker present before nav', rc5.hasBlocker() === true);
    e5.emit('navigation', { url: 'about:blank' });
    check('navigation clears DOM blocker', rc5.hasBlocker() === false);
}

async function browserTests() {
    const bridge = new PlaywrightDirectBridge({ headless: process.env.MCP_HEADLESS !== 'false', residentAgent: true });
    await bridge.connect();

    const blockerEvents = [];
    bridge.on('blocker', (b) => blockerEvents.push({ ...b, at: Date.now() }));

    try {
        await bridge.navigate({ url: MODAL_URL });
        await bridge.page.waitForFunction(() => window.__cbr && window.__cbr.size() > 0, null, { timeout: 5000 });

        console.log('\n 2. in-page blocker detection (push on appear / clear):');
        check('no blocker initially', bridge._reactiveCore.hasBlocker() === false);

        // Open the modal → expect a pushed 'blocker' present:true.
        const appearWait = bridge._reactiveCore.waitForBlocker({ timeoutMs: 2000 });
        const tOpen = Date.now();
        await bridge.page.evaluate(() => window.__fixture.openModal(0));
        const appeared = await appearWait;
        check('blocker pushed on modal appear', !!appeared && appeared.present === true, JSON.stringify(appeared));
        check('blocker carries a selector hint', !!appeared?.selectorHint, appeared?.selectorHint);
        check('reactive core now reports a blocker', bridge._reactiveCore.hasBlocker() === true);

        console.log('\n 3. push latency (appear → bridge event):');
        const appearEvt = blockerEvents.find((e) => e.present === true);
        const latency = appearEvt ? appearEvt.at - tOpen : Infinity;
        check('appear pushed quickly (< 250ms)', latency < 250, `${latency}ms`);

        // Close the modal → expect present:false.
        await bridge.page.evaluate(() => window.__fixture.closeModal());
        await sleep(80);
        check('blocker cleared on modal close', bridge._reactiveCore.hasBlocker() === false, JSON.stringify(bridge._reactiveCore.blocker));
        check('a present:false was pushed', blockerEvents.some((e) => e.present === false));

        console.log('\n 4. no-poll guarantee (post-action observation, no blocker):');
        // Spy on getBlockingState to count DOM round-trips during observation.
        const realGBS = bridge.getBlockingState.bind(bridge);
        let gbsCalls = 0;
        bridge.getBlockingState = async (...a) => { gbsCalls += 1; return realGBS(...a); };
        try {
            const res = await bridge._capturePostActionBlocker('click', '#save-prop');
            check('post-action returns null when no blocker', res === null);
            // Event-driven path makes at most ~1 confirming call (vs ~15 in the poll loop).
            check('did not poll getBlockingState in a loop (≤2 calls)', gbsCalls <= 2, `gbsCalls=${gbsCalls}`);
        } finally {
            bridge.getBlockingState = realGBS;
        }

        console.log('\n    reactive core stats: ' + JSON.stringify(bridge._reactiveCore.stats().blocker));
    } finally {
        await bridge.cleanup?.();
        await bridge.browser?.close?.();
    }
}

async function main() {
    await unitTests();
    await browserTests();
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(` REACTIVE CORE TEST: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
