/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * RESIDENT PERCEPTION AGENT  ("the Digital Twin")  — Phase 1 of the Cognitive Browser Runtime
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A resident, in-page agent injected via addInitScript that maintains a LIVE element model
 * of the page and pushes deltas to Node — instead of the server re-walking the whole DOM on
 * every snapshot. This is the architectural inversion at the heart of CBR:
 *
 *      BEFORE:  Node asks  →  page walks entire DOM  →  serialize everything  (per snapshot)
 *      AFTER:   page maintains model continuously  →  Node reads / receives deltas  (near-free)
 *
 * Capabilities
 *   • Incremental model — a MutationObserver patches only the changed nodes, so a snapshot
 *     after a small change costs ~nothing instead of a full re-walk.
 *   • Stable identity (cbrRef) — every logical element keeps the same ref across re-renders
 *     via a WeakMap + semantic identity re-anchoring, even when frameworks replace the DOM
 *     node and its dynamic id. This is the foundation the self-healing resolver (P4) builds on.
 *   • Delta push — when the __cbrPush binding is exposed, the agent pushes {added,removed,
 *     updated} batches, enabling the event-driven reactive core (P2).
 *
 * Parity & purity
 *   • Reuses the SAME fingerprint primitives as the legacy walker (SelectorEngine
 *     .getFingerprintPrimitivesSource()), so element fingerprints are byte-identical.
 *   • STRICTLY PASSIVE: observers only. It never writes attributes, inserts nodes, or mutates
 *     styles. Its only global footprint is window.__cbr (+ it keeps window.__mcpDomSeq current
 *     for snapshot-cache compatibility) — the same footprint class as the counter it replaces.
 *     The purity test (benchmark/test-resident-agent.js) asserts zero SUT contamination.
 *
 * Scope (v1): top document only. Cross-boundary (shadow DOM / same-origin iframes) perception
 * remains handled by the legacy cross-boundary walker and is a planned resident-agent follow-up.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { SelectorEngine } from '../utils/selector-engine.js';

export const RESIDENT_AGENT_VERSION = '1.0.0';

/**
 * The resident agent's in-page body. Written WITHOUT template literals or ${} so it can be
 * safely embedded inside a module template string. Relies on __cbrClassify / __cbrFingerprint
 * being defined in the surrounding scope (the primitives are concatenated ahead of it).
 */
const RESIDENT_BODY = `
    // ── State ───────────────────────────────────────────────────────────────
    var __cbrRefSeq = 0;
    var nodeToRef = new WeakMap();           // node  -> cbrRef (survives non-destructive mutations)
    var entries = new Map();                 // cbrRef -> { node, fp, parentRef }
    var identityToRef = new Map();           // identityKey -> cbrRef (maintained continuously)
    var prevIdentityToRef = new Map();       // identity map from the last full rebuild (cross-rebuild re-anchor)
    var recentlyRemoved = new Map();         // identityKey -> cbrRef (within-batch re-render re-anchor)
    var version = 0;
    var ready = false;
    var delta = { added: [], removed: [], updated: [] };
    var pushScheduled = false;
    var stats = { rebuilds: 0, incremental: 0, fingerprints: 0, pushes: 0, reanchors: 0, blockerPushes: 0 };

    // ── Blocker (modal/overlay) state — pushed the instant it changes ────────
    var blockerNode = null;
    var blockerPresent = false;

    function rawPush(payload) {
        if (typeof window.__cbrPush === 'function') {
            try { window.__cbrPush(payload); return true; } catch (e) { /* binding not ready */ }
        }
        return false;
    }

    // ── Identity ────────────────────────────────────────────────────────────
    // A stable, framework-agnostic key for a logical element. Prefers durable
    // anchors in priority order and AVOIDS raw id (often dynamic, e.g. "save-rgjitjxb"
    // on a React re-render). Accessible name (text/aria-label/placeholder) is the
    // human-meaningful, re-render-stable identity for interactive elements; id is a
    // last resort only when nothing else identifies the element.
    function identityKey(node, classify) {
        var role = classify.role || classify.tagLower;
        var label =
            node.getAttribute('data-testid') || node.getAttribute('data-test-id') || node.getAttribute('data-qa') ||
            node.getAttribute('aria-label') ||
            ((node.innerText || '') + '').trim().substring(0, 60) ||
            node.getAttribute('placeholder') ||
            node.getAttribute('name') ||
            node.id || '';
        return role + '|' + String(label).toLowerCase().substring(0, 60);
    }

    // Assign (or recover) a stable cbrRef for a node.
    //  1) same node already known           → reuse
    //  2) within-batch re-render             → reuse the ref of a just-removed twin (same identity)
    //  3) cross-rebuild                      → re-anchor to the previous build's ref for that identity
    //  4) otherwise                          → mint a fresh ref
    function assignRef(node, classify) {
        var existing = nodeToRef.get(node);
        if (existing) return existing;
        var key = identityKey(node, classify);
        var ref = null;
        if (recentlyRemoved.has(key)) {
            ref = recentlyRemoved.get(key);
            recentlyRemoved.delete(key);
            stats.reanchors++;
        } else {
            var prev = prevIdentityToRef.get(key);
            if (prev && !identityToRef.has(key)) { ref = prev; stats.reanchors++; }
        }
        if (!ref) ref = 'cbr-' + (++__cbrRefSeq);
        nodeToRef.set(node, ref);
        identityToRef.set(key, ref);
        return ref;
    }

    function nearestCapturedAncestorRef(node) {
        var p = node.parentElement;
        while (p) {
            var r = nodeToRef.get(p);
            if (r && entries.has(r)) return r;
            p = p.parentElement;
        }
        return undefined;
    }

    // ── In-page blocker detection (the heart of the event-driven core) ──────
    // Detects modal/overlay appearance the instant the DOM mutates and pushes a
    // signal, so Node never has to poll getBlockingState(). Mirrors the bridge's
    // _detectDomModalBlocker signals but is read-only and runs only on the small
    // set of nodes added in a mutation batch (cheap).
    var MODAL_SELECTOR = 'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
    var OVERLAY_HINT = '[class*="modal" i],[class*="overlay" i],[class*="popup" i],[class*="dialog" i],[class*="lightbox" i]';
    var EXCLUDED_CHROME = '.gm-style,.gmnoprint,canvas,[class*="mapboxgl"],.leaflet-container,.leaflet-pane';

    function isExcludedChrome(el) {
        try { return el && el.matches && (el.matches(EXCLUDED_CHROME) || (el.closest && el.closest('.gm-style,[class*="mapboxgl"],.leaflet-container'))); }
        catch (e) { return false; }
    }

    function isBlockerEl(el) {
        if (!el || el.nodeType !== 1 || isExcludedChrome(el)) return false;
        try {
            if (el.matches && el.matches(MODAL_SELECTOR)) return isVisibleBox(el);
            // Positioned, high-z, large-area overlay with a modal-ish class.
            if (el.matches && el.matches(OVERLAY_HINT)) {
                var style = window.getComputedStyle(el);
                if (style.pointerEvents === 'none' || style.display === 'none' || style.visibility === 'hidden') return false;
                var positioned = style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky';
                var z = parseInt(style.zIndex || '0', 10) || 0;
                var rect = el.getBoundingClientRect();
                var area = rect.width * rect.height;
                if ((positioned || z >= 5) && area > 10000) return true;
            }
        } catch (e) { /* detached / invalid */ }
        return false;
    }

    function isVisibleBox(el) {
        try {
            var s = window.getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        } catch (e) { return false; }
    }

    // Find a blocker within a freshly-added/changed subtree (the node itself or a
    // descendant). The self-check (isBlockerEl) is cheap and runs for every node;
    // the deeper querySelector only runs for nodes that plausibly WRAP a modal
    // (overlay/backdrop/drawer hint), so a 90-row list render doesn't pay a subtree
    // scan per row. Modals added under a bare wrapper are still caught on the
    // following mutation or via the attribute-toggle path.
    var WRAPPER_HINT = '[class*="modal" i],[class*="overlay" i],[class*="popup" i],[class*="dialog" i],[class*="lightbox" i],[class*="backdrop" i],[class*="scrim" i],[class*="drawer" i]';
    function findBlockerIn(node) {
        if (!node || node.nodeType !== 1) return null;
        if (isBlockerEl(node)) return node;
        try {
            var couldWrap = node.matches && (node.matches(WRAPPER_HINT) || node.getAttribute('role') === 'dialog' || node.hasAttribute('aria-modal'));
            if (couldWrap && node.querySelector) {
                var direct = node.querySelector(MODAL_SELECTOR);
                if (direct && isVisibleBox(direct) && !isExcludedChrome(direct)) return direct;
            }
        } catch (e) { /* invalid */ }
        return null;
    }

    function blockerSelectorHint(el) {
        try {
            if (el.id) return '#' + el.id;
            var tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-qa');
            if (tid) return '[data-testid="' + tid + '"]';
            var al = el.getAttribute('aria-label');
            if (al) return '[aria-label="' + al + '"]';
            var role = el.getAttribute('role');
            if (role) return '[role="' + role + '"]';
            return el.tagName ? el.tagName.toLowerCase() : null;
        } catch (e) { return null; }
    }

    function pushBlocker(present, el) {
        blockerPresent = present;
        blockerNode = present ? el : null;
        stats.blockerPushes++;
        rawPush({
            type: 'blocker',
            present: present,
            version: version,
            kind: present ? (el.matches && el.matches(MODAL_SELECTOR) ? 'dom-modal' : 'dom-overlay') : null,
            selectorHint: present ? blockerSelectorHint(el) : null,
            role: present ? (el.getAttribute && el.getAttribute('role')) || null : null,
            ariaLabel: present ? (el.getAttribute && el.getAttribute('aria-label')) || null : null,
        });
    }

    // Evaluate blocker transitions for this mutation batch and push immediately.
    // appearanceRoots = freshly-added subtrees AND attribute-touched nodes (a hidden
    // modal toggled visible via class/style is an attribute mutation, not a childList add).
    function detectBlockerTransition(appearanceRoots, removedAny) {
        // Clearance: the tracked blocker left the DOM (or became invisible).
        if (blockerPresent && blockerNode) {
            if (!blockerNode.isConnected || !isVisibleBox(blockerNode)) {
                pushBlocker(false, null);
            }
        }
        // Appearance: scan candidate subtrees for a newly-visible blocker.
        if (!blockerPresent && appearanceRoots && appearanceRoots.length) {
            for (var i = 0; i < appearanceRoots.length; i++) {
                var hit = findBlockerIn(appearanceRoots[i]);
                if (hit) { pushBlocker(true, hit); break; }
            }
        }
    }

    function fingerprintInto(node, classify) {
        var ref = assignRef(node, classify);
        var parentRef = nearestCapturedAncestorRef(node);
        var fp = __cbrFingerprint(node, ref, parentRef, classify);
        entries.set(ref, { node: node, fp: fp, parentRef: parentRef });
        stats.fingerprints++;
        return ref;
    }

    function captureSubtree(root) {
        var stack = [root];
        while (stack.length) {
            var n = stack.pop();
            if (!n || n.nodeType !== 1) continue;
            var c = __cbrClassify(n);
            if (c.capture) { var ref = fingerprintInto(n, c); delta.added.push(ref); }
            var ch = n.children;
            for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
            if (entries.size > __CBR_MAX) break;
        }
    }

    function removeSubtree(root) {
        var stack = [root];
        while (stack.length) {
            var n = stack.pop();
            if (!n || n.nodeType !== 1) continue;
            var ref = nodeToRef.get(n);
            if (ref && entries.has(ref)) {
                var c = __cbrClassify(n);
                var key = identityKey(n, c);
                entries.delete(ref);
                delta.removed.push(ref);
                recentlyRemoved.set(key, ref);   // allow a same-batch re-render twin to reclaim it
                if (identityToRef.get(key) === ref) identityToRef.delete(key);
            }
            var ch = n.children;
            for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
        }
    }

    // ── Full rebuild (initial + explicit) ───────────────────────────────────
    function rebuild() {
        prevIdentityToRef = identityToRef;
        identityToRef = new Map();
        entries = new Map();
        delta = { added: [], removed: [], updated: [] };
        if (!document.body) { version++; window.__mcpDomSeq = version; return; }
        // Document order guarantees ancestors are captured before descendants,
        // so nearestCapturedAncestorRef resolves parentRef correctly.
        var list = [document.body];
        var all = document.body.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) list.push(all[i]);
        for (var j = 0; j < list.length; j++) {
            var n = list[j];
            if (!n || n.nodeType !== 1) continue;
            var c = __cbrClassify(n);
            if (c.capture) fingerprintInto(n, c);
            if (entries.size > __CBR_MAX) break;
        }
        version++;
        window.__mcpDomSeq = version;
        stats.rebuilds++;
    }

    // ── Incremental updates ─────────────────────────────────────────────────
    function onMutations(muts) {
        if (!ready) return;
        var removedAny = false;
        var attrNodes = [];
        // Pass 1: attributes + removals (populate recentlyRemoved before any add).
        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            if (m.type === 'attributes') {
                var t = m.target;
                if (!t || t.nodeType !== 1) continue;
                attrNodes.push(t);  // candidate for attribute-driven blocker appearance
                var c = __cbrClassify(t);
                var ref = nodeToRef.get(t);
                if (ref && entries.has(ref)) {
                    if (c.capture) {
                        var parentRef = entries.get(ref).parentRef;
                        entries.set(ref, { node: t, fp: __cbrFingerprint(t, ref, parentRef, c), parentRef: parentRef });
                        delta.updated.push(ref);
                        stats.incremental++;
                    } else {
                        entries.delete(ref);
                        delta.removed.push(ref);
                    }
                } else if (c.capture) {
                    delta.added.push(fingerprintInto(t, c));
                }
            } else if (m.type === 'childList') {
                for (var r = 0; r < m.removedNodes.length; r++) {
                    var rn = m.removedNodes[r];
                    if (rn && rn.nodeType === 1) { removeSubtree(rn); removedAny = true; }
                }
            }
        }
        // Pass 2: additions (may reclaim refs from recentlyRemoved). Collect the
        // added subtree roots so the blocker detector can scan only what's new.
        var addedRoots = [];
        for (var k = 0; k < muts.length; k++) {
            var mm = muts[k];
            if (mm.type !== 'childList') continue;
            for (var a = 0; a < mm.addedNodes.length; a++) {
                var an = mm.addedNodes[a];
                if (an && an.nodeType === 1) { captureSubtree(an); addedRoots.push(an); }
            }
        }
        // Event-driven blocker signal — pushed immediately on transition. Scan both
        // freshly-added subtrees AND attribute-touched nodes (a modal toggled visible
        // via class/style change surfaces as an attribute mutation, not a DOM insert).
        detectBlockerTransition(addedRoots.concat(attrNodes), removedAny);
        version++;
        window.__mcpDomSeq = version;
        schedulePush();
    }

    // ── Push (delta streaming to Node) ──────────────────────────────────────
    function schedulePush() {
        if (pushScheduled) return;
        pushScheduled = true;
        var flush = function () {
            pushScheduled = false;
            recentlyRemoved.clear();
            var payload = {
                type: 'perception-delta',
                version: version,
                added: delta.added.slice(),
                removed: delta.removed.slice(),
                updated: delta.updated.slice(),
                total: entries.size,
            };
            delta = { added: [], removed: [], updated: [] };
            if (typeof window.__cbrPush === 'function') {
                try { window.__cbrPush(payload); stats.pushes++; } catch (e) { /* binding not ready */ }
            }
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(flush); else setTimeout(flush, 0);
    }

    // ── Read API ────────────────────────────────────────────────────────────
    // perceive() returns the maintained model WITHOUT a full re-walk. With
    // refreshLayout it re-reads bounds/visibility in a single batched reflow
    // (still far cheaper than the walk, which also re-reads text/labels/attrs).
    function perceive(opts) {
        opts = opts || {};
        if (opts.refreshLayout) {
            entries.forEach(function (e) {
                try {
                    var rc = e.node.getBoundingClientRect();
                    e.fp.visible = rc.width > 0 && rc.height > 0;
                    e.fp.bounds = { x: Math.round(rc.x), y: Math.round(rc.y), width: Math.round(rc.width), height: Math.round(rc.height) };
                } catch (err) { /* detached */ }
            });
        }
        var els = [];
        entries.forEach(function (e) { els.push(e.fp); });
        return { version: version, elementCount: els.length, elements: els, stats: snapshotStats(), ready: ready };
    }

    function snapshotStats() {
        return { version: version, size: entries.size, rebuilds: stats.rebuilds, incremental: stats.incremental, fingerprints: stats.fingerprints, pushes: stats.pushes, reanchors: stats.reanchors, blockerPushes: stats.blockerPushes, blockerPresent: blockerPresent };
    }

    // ── Install ─────────────────────────────────────────────────────────────
    var observer = new MutationObserver(onMutations);

    function init() {
        rebuild();
        ready = true;
        try {
            observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true });
        } catch (e) { /* no-op */ }
        // Announce readiness so Node can flush an initial perception if it wants.
        if (typeof window.__cbrPush === 'function') {
            try { window.__cbrPush({ type: 'ready', version: version, total: entries.size }); } catch (e) { /* no-op */ }
        }
    }

    window.__cbr = {
        __version: '${RESIDENT_AGENT_VERSION}',
        __installedAt: Date.now(),
        perceive: perceive,
        version: function () { return version; },
        size: function () { return entries.size; },
        stats: snapshotStats,
        rebuild: function () { rebuild(); return snapshotStats(); },
        drainDeltas: function () { var d = delta; delta = { added: [], removed: [], updated: [] }; return d; },
        // Event-driven blocker readout (the reactive core also receives pushes).
        hasBlocker: function () { return blockerPresent; },
        blockerHint: function () { return blockerPresent && blockerNode ? blockerSelectorHint(blockerNode) : null; },
        // Self-healing support (P4): the semantic identity is stable across re-renders,
        // so a broken selector can be re-anchored to the element that still carries it.
        identityOf: function (ref) {
            var e = entries.get(ref);
            if (!e || !e.node) return null;
            try { return identityKey(e.node, __cbrClassify(e.node)); } catch (x) { return null; }
        },
        resolveIdentity: function (key) {
            if (!key) return null;
            var ref = identityToRef.get(key);
            if (ref && entries.has(ref)) return entries.get(ref).fp;
            // Fallback: linear scan (identity map may lag a pending rebuild).
            var found = null;
            entries.forEach(function (e) {
                if (found || !e.node) return;
                try { if (identityKey(e.node, __cbrClassify(e.node)) === key) found = e.fp; } catch (x) { /* detached */ }
            });
            return found;
        },
        // Test/inspection helper: resolve a ref to its current fingerprint.
        get: function (ref) { var e = entries.get(ref); return e ? e.fp : null; },
    };

    // Keep the legacy snapshot-cache counter coherent and prevent the standalone
    // DOM-seq counter from double-installing its own observer.
    window.__mcpDomSeqInstalled = true;
    window.__mcpDomSeq = version;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
`;

/**
 * Build the full self-installing resident-agent source string for addInitScript.
 *
 * @param {object} [options]
 * @param {number} [options.maxElements=4000] - Safety cap on the live model size.
 * @returns {string} IIFE source that installs window.__cbr (idempotent).
 */
export function getResidentAgentSource(options = {}) {
    const maxElements = Number.isFinite(options.maxElements) ? options.maxElements : 4000;
    const primitives = SelectorEngine.getFingerprintPrimitivesSource();
    return (
        '(function(){' +
        'if (window.__cbr && window.__cbr.__version) return;' +
        'try {' +
        primitives +
        'var __CBR_MAX = ' + maxElements + ';' +
        RESIDENT_BODY +
        '} catch (e) { try { console.error("[CBR] resident agent install failed:", e && e.message); } catch (_) {} }' +
        '})();'
    );
}

export default { getResidentAgentSource, RESIDENT_AGENT_VERSION };
