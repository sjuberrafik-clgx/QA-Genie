/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CBR BENCHMARK METRICS LIBRARY
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Shared, phase-agnostic measurement primitives for the Cognitive Browser Runtime (CBR)
 * benchmark suite. Every phase (P0 baseline → P9) captures the SAME metrics with the SAME
 * methodology so results are directly comparable via compare-metrics.js.
 *
 * Pure measurement only — no assertions, no side effects beyond reading/writing the
 * benchmark/metrics/ directory. Couples intentionally to the PlaywrightDirectBridge API
 * (snapshot/click/getBlockingState/snapshotRefs/page) since that is the system under test.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const METRICS_DIR = path.join(__dirname, '..', 'metrics');

// ─── Size / token estimation ────────────────────────────────────────────────

export const bytes = (obj) =>
    Buffer.byteLength(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');

/** Rough token estimate: ~4 bytes/token, the convention used across this repo's benchmarks. */
export const tokens = (obj) => Math.ceil(bytes(obj) / 4);

// ─── Timing ─────────────────────────────────────────────────────────────────

/** Time a single async call. Returns { result, ms }. */
export async function time(fn) {
    const t0 = performance.now();
    const result = await fn();
    return { result, ms: performance.now() - t0 };
}

/** Time an async call `runs` times (after `warmup` discarded runs); returns latency stats. */
export async function timeRepeated(fn, { runs = 5, warmup = 1 } = {}) {
    for (let i = 0; i < warmup; i++) await fn();
    const samples = [];
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
    }
    return { samples: samples.map((n) => round(n, 2)), ...latencyStats(samples) };
}

export function percentile(arr, p) {
    if (!arr || !arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
    return s[idx];
}

export function latencyStats(samples) {
    if (!samples || !samples.length) return { min: null, p50: null, p95: null, max: null, mean: null };
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
        min: round(Math.min(...samples), 2),
        p50: round(percentile(samples, 50), 2),
        p95: round(percentile(samples, 95), 2),
        max: round(Math.max(...samples), 2),
        mean: round(sum / samples.length, 2),
    };
}

export function round(n, d = 1) {
    return n == null || Number.isNaN(n) ? null : Number(Number(n).toFixed(d));
}

export function pctDelta(from, to) {
    if (from == null || to == null || from === 0) return null;
    return round(((from - to) / from) * 100, 1);
}

// ─── Persistence ────────────────────────────────────────────────────────────

export function writeMetrics(label, data) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    const file = path.join(METRICS_DIR, `${sanitizeLabel(label)}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
}

export function readMetrics(label) {
    const file = path.join(METRICS_DIR, `${sanitizeLabel(label)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sanitizeLabel(label) {
    return String(label).replace(/[^a-zA-Z0-9._-]/g, '-');
}

// ─── Snapshot payload metrics ───────────────────────────────────────────────

/**
 * Measure snapshot latency + payload across the modes that matter for the
 * perception story: cold (full walk), warm (cache hit), post-mutation (cache
 * miss after a single DOM change), and verbose (legacy full + ARIA tree).
 */
export async function measureSnapshot(bridge) {
    const cold = await time(() => bridge.snapshot({ useCache: false }));
    const warm = await time(() => bridge.snapshot({ useCache: true }));

    // Force a single, minimal DOM mutation, then snapshot again. With a passive
    // counter this is a full re-walk (cache miss); a delta-pushing resident agent
    // should make this near-free. This is THE number P1 targets.
    await bridge.page.evaluate(() => {
        const probe = document.createElement('span');
        probe.setAttribute('data-cbr-probe', '1');
        probe.style.display = 'none';
        document.body.appendChild(probe);
    });
    const postMutation = await time(() => bridge.snapshot({ useCache: true }));

    const verbose = await time(() => bridge.snapshot({ verbose: true, autoFilter: false, useCache: false }));

    return {
        cold: payloadRow(cold),
        warm: { ...payloadRow(warm), cacheHit: warm.result?._cache?.hit === true },
        postMutation: { ...payloadRow(postMutation), cacheHit: postMutation.result?._cache?.hit === true },
        verbose: payloadRow(verbose),
        wins: {
            compactVsVerboseTokensPct: pctDelta(tokens(verbose.result), tokens(cold.result)),
            warmVsColdMsPct: pctDelta(cold.ms, warm.ms),
        },
    };
}

function payloadRow(timed) {
    return {
        ms: round(timed.ms, 2),
        elements: timed.result?.elementCount ?? (timed.result?.elements?.length ?? null),
        bytes: bytes(timed.result),
        tokens: tokens(timed.result),
    };
}

// ─── Interaction latency ────────────────────────────────────────────────────

/** Resolve refs from a compact snapshot and time clicks on a few interactive elements. */
export async function measureInteraction(bridge, { max = 4 } = {}) {
    const snap = await bridge.snapshot({ useCache: false });
    const targets = (snap.elements || [])
        .filter((e) => e.interactive && e.ref)
        .slice(0, max);
    const samples = [];
    const detail = [];
    for (const el of targets) {
        const t0 = performance.now();
        const r = await bridge.click({ ref: el.ref }).catch((e) => ({ error: e.message }));
        const ms = performance.now() - t0;
        samples.push(ms);
        detail.push({ ref: el.ref, name: el.name || null, ms: round(ms, 2), ok: !r?.error });
    }
    return { count: samples.length, detail, ...latencyStats(samples) };
}

// ─── Selector survival (the core "beyond human" reliability metric) ─────────

/**
 * Capture the winning selector of every interactive element, keyed by stable
 * semantic identity (role|name). Returns the tracked set used by
 * checkSelectorSurvival() after a re-render.
 *
 * When the resident agent is active, also captures each element's stable cbr identity
 * (window.__cbr.identityOf) so checkSelectorSurvivalWithHealing() can re-anchor breaks.
 */
export async function captureTrackedSelectors(bridge) {
    await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
    const resident = bridge._residentAgentEnabled === true;
    const tracked = [];
    for (const [ref, el] of bridge.snapshotRefs) {
        const css = el.selector?.cssSelector;
        if (!el.isInteractive || !css) continue;
        const name = el.computedLabel || el.ariaLabel || el.associatedLabel || el.text || el.name || el.placeholder || null;
        let residentIdentity = null;
        if (resident) {
            try { residentIdentity = await bridge.page.evaluate((r) => (window.__cbr ? window.__cbr.identityOf(r) : null), ref); } catch { /* ignore */ }
        }
        tracked.push({
            ref,
            identity: identityKey(el.role || el.tag, name),   // Node format — for the survival ceiling
            residentIdentity,                                 // resident format — for healing re-anchor
            name: name ? String(name).slice(0, 80) : null,
            role: el.role || el.tag,
            cssSelector: css,
            strategy: el.selector?.strategy || null,
            stabilityScore: el.selector?.stabilityScore ?? null,
            wasUnique: el.selector?.isUnique === true,
        });
    }
    return tracked;
}

/**
 * After a DOM change (e.g. re-render), measure how many tracked elements:
 *   - survivedBySelector: their captured CSS selector STILL resolves to exactly 1 node
 *   - survivedByIdentity: their (role|name) identity still exists in a fresh snapshot
 *     (i.e. a self-healing resolver *could* re-anchor it even though the selector broke)
 * The gap between the two is precisely what the resident agent + healing close.
 */
export async function checkSelectorSurvival(bridge, tracked) {
    const cssList = tracked.map((t) => t.cssSelector);
    const counts = await bridge.page.evaluate((sels) => sels.map((s) => {
        try { return document.querySelectorAll(s).length; } catch { return -1; }
    }), cssList);

    const identitySet = await snapshotIdentitySet(bridge);

    const broken = [];
    let survivedBySelector = 0;
    let survivedByIdentity = 0;
    tracked.forEach((t, i) => {
        const stillUnique = counts[i] === 1;
        const identityAlive = identitySet.has(t.identity);
        if (stillUnique) survivedBySelector += 1;
        if (identityAlive) survivedByIdentity += 1;
        if (!stillUnique) {
            broken.push({
                name: t.name, role: t.role, strategy: t.strategy,
                stabilityScore: t.stabilityScore, matchAfter: counts[i],
                identityRecoverable: identityAlive,
            });
        }
    });

    const total = tracked.length || 1;
    return {
        tracked: tracked.length,
        survivedBySelector,
        survivedByIdentity,
        survivalPct: round((survivedBySelector / total) * 100, 1),
        identityPct: round((survivedByIdentity / total) * 100, 1),
        // The "healing headroom" — % of elements a self-healing layer could rescue.
        healableGapPct: round(((survivedByIdentity - survivedBySelector) / total) * 100, 1),
        broken: broken.slice(0, 15),
    };
}

/** Build the set of (role|name) identities present in a fresh snapshot. */
export async function snapshotIdentitySet(bridge) {
    await bridge.snapshot({ useCache: false, verbose: true, autoFilter: false });
    const set = new Set();
    for (const [, el] of bridge.snapshotRefs) {
        const name = el.computedLabel || el.ariaLabel || el.associatedLabel || el.text || el.name || el.placeholder || null;
        set.add(identityKey(el.role || el.tag, name));
    }
    return set;
}

function identityKey(role, name) {
    return `${String(role || '').toLowerCase()}|${String(name || '').trim().toLowerCase().slice(0, 80)}`;
}

/**
 * The Phase 4 headline: after a re-render, take the selectors that BROKE and attempt to heal
 * each one via the bridge's healing resolver (identity re-anchor). Reports the effective
 * survival = (survived by selector + successfully healed) / tracked — which should approach
 * the identity ceiling. Requires the resident agent + healing resolver (returns null otherwise).
 */
export async function checkSelectorSurvivalWithHealing(bridge, tracked) {
    if (!bridge._healingResolver) return null;
    const cssList = tracked.map((t) => t.cssSelector);
    const counts = await bridge.page.evaluate((sels) => sels.map((s) => {
        try { return document.querySelectorAll(s).length; } catch { return -1; }
    }), cssList);

    let survivedBySelector = 0;
    let healed = 0;
    let healFailed = 0;
    const healDetail = [];
    for (let i = 0; i < tracked.length; i++) {
        const t = tracked[i];
        if (counts[i] === 1) { survivedBySelector += 1; continue; }
        const result = await bridge._healingResolver.heal({
            brokenSelector: t.cssSelector,
            identity: t.residentIdentity,
            reason: 'benchmark-rerender',
        }).catch(() => ({ healed: false }));
        if (result.healed) {
            healed += 1;
            healDetail.push({ name: t.name, from: t.cssSelector, to: result.healedTo, strategy: result.strategy });
        } else {
            healFailed += 1;
            healDetail.push({ name: t.name, from: t.cssSelector, healed: false, reason: result.reason });
        }
    }

    const total = tracked.length || 1;
    return {
        tracked: tracked.length,
        survivedBySelector,
        healed,
        healFailed,
        rawSurvivalPct: round((survivedBySelector / total) * 100, 1),
        effectiveSurvivalPct: round(((survivedBySelector + healed) / total) * 100, 1),
        healSuccessPct: round((healed / Math.max(1, healed + healFailed)) * 100, 1),
        healDetail: healDetail.slice(0, 15),
    };
}

// ─── Blocker (modal/dialog) detection latency ───────────────────────────────

/**
 * Measure how long, after a modal appears, until the blocker is detected.
 *
 * Two regimes, auto-selected:
 *   • PUSH (P2+): when the bridge has a reactive core, await its pushed blocker
 *     signal — the resident agent detects the modal in-page and pushes instantly.
 *   • POLL (P0/P1): otherwise, tight-loop getBlockingState() (a full DOM evaluate),
 *     approximating the minimum latency the pull-based architecture can achieve.
 *
 * @param {object} cfg.open  async () => void   — opens the modal (delay 0)
 * @param {object} cfg.close async () => void   — closes the modal / resets
 */
export async function measureBlockerLatency(bridge, { open, close, samples = 5, timeoutMs = 3000 } = {}) {
    const reactive = bridge._reactiveCore && bridge._residentAgentEnabled ? bridge._reactiveCore : null;
    const times = [];
    for (let i = 0; i < samples; i++) {
        await close();
        await bridge.getBlockingState().catch(() => {});
        // Let any pending clear-signal settle so the next open is a clean transition.
        if (reactive) await new Promise((r) => setTimeout(r, 30));

        const t0 = performance.now();
        if (reactive) {
            const waitP = reactive.waitForBlocker({ timeoutMs });
            await open();
            const hit = await waitP;
            times.push(hit ? performance.now() - t0 : timeoutMs);
        } else {
            await open();
            let detected = false;
            while (performance.now() - t0 < timeoutMs) {
                const st = await bridge.getBlockingState().catch(() => ({ present: false }));
                if (st && st.present) { detected = true; break; }
            }
            times.push(detected ? performance.now() - t0 : timeoutMs);
        }
    }
    await close();
    return { method: reactive ? 'push' : 'poll', samples: times.map((n) => round(n, 2)), detected: true, ...latencyStats(times) };
}

/**
 * Measure the cost of post-action blocker OBSERVATION on the common no-blocker path —
 * the real Phase 2 headline. Counts DOM round-trips (getBlockingState calls) and wall time
 * for _capturePostActionBlocker when nothing pops up.
 *
 *   • POLL (P0/P1): loops getBlockingState every pollIntervalMs until DOM-stable → many calls.
 *   • PUSH (P2+):   one immediate check + push/quiescence await → ~1 call, no loop.
 *
 * Uses a real action target (as production always does) so the Node-side detector stays
 * precise — a null target makes it scan the whole page and can false-positive on chrome.
 */
export async function measurePostActionObservation(bridge, { runs = 5, actionTarget = '#save-prop' } = {}) {
    const real = bridge.getBlockingState.bind(bridge);
    const samples = [];
    const callCounts = [];
    for (let i = 0; i < runs; i++) {
        let calls = 0;
        bridge.getBlockingState = async (...a) => { calls += 1; return real(...a); };
        const t0 = performance.now();
        try {
            await bridge._capturePostActionBlocker('click', actionTarget);
        } catch { /* measurement only */ }
        samples.push(performance.now() - t0);
        callCounts.push(calls);
        bridge.getBlockingState = real;
    }
    bridge.getBlockingState = real;
    return {
        method: (bridge._reactiveCore && bridge._residentAgentEnabled) ? 'push' : 'poll',
        domRoundTrips: { mean: round(callCounts.reduce((a, b) => a + b, 0) / callCounts.length, 1), max: Math.max(...callCounts), samples: callCounts },
        ...latencyStats(samples),
    };
}

// ─── Environment capture (for reproducibility) ──────────────────────────────

export function captureEnv(bridge) {
    const cfg = bridge?.config || {};
    return {
        node: process.version,
        platform: process.platform,
        headless: cfg.headless !== false,
        residentAgent: cfg.residentAgent === true,
        // Record the pull-based blocker-poll tax P2 aims to make irrelevant.
        postActionBlockerPollMs: cfg.blockerRecovery?.postActionObservationMs ?? null,
        snapshotAutoFilterThreshold: cfg.snapshotAutoFilterThreshold ?? null,
        capturedAt: new Date().toISOString(),
    };
}
