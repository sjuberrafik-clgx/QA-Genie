/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * INTELLIGENT PRIMITIVES — act / observe / extract  (Pillar 2)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * High-level, self-healing browser primitives that collapse the repeated
 * navigate→snapshot→find→interact LLM loop into a single deterministic round-trip.
 *
 *   • act     — perform an action against a described target (click/type/fill/hover/
 *               check/select/press). Resolves the target, dismisses blockers, acts,
 *               self-heals on miss, and returns a TINY diff (not a full snapshot).
 *   • observe — return ranked candidate elements for a described target WITHOUT acting.
 *               A planning primitive the agent uses to choose before acting.
 *   • extract — read structured content (text / value / attribute / list / table) for
 *               assertions, returning only what was asked for.
 *
 * Targeting is HYBRID and contains NO LLM call (zero hallucination risk):
 *   1. ref            — a ref from a prior snapshot
 *   2. selector/css   — an explicit CSS selector that resolves to ≥1 node
 *   3. role + name    — matched against the live snapshot, then Playwright getByRole
 *   4. name/text      — deterministic fuzzy match (exact > prefix > substring > token
 *                       overlap) against the snapshot, then getByText as a last resort
 *
 * All resolution reuses the proven SelectorEngine + snapshotRefs + guard/blocker logic
 * from the bridge, so primitives inherit popup auto-dismissal and selector ranking.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { SelectorEngine } from '../utils/selector-engine.js';

const DEFAULT_MATCH_THRESHOLD = 0.45;

/** Deterministic name similarity in [0,1]. No LLM, fully reproducible. */
function scoreName(query, candidate) {
    if (!query || !candidate) return 0;
    const q = String(query).toLowerCase().trim();
    const c = String(candidate).toLowerCase().trim();
    if (!q || !c) return 0;
    if (q === c) return 1;
    if (c.startsWith(q) || q.startsWith(c)) return 0.85;
    // Substring match — but ignore trivially short overlaps (e.g. "on" inside
    // "nonexistent") which would produce false positives.
    if ((c.includes(q) || q.includes(c)) && Math.min(q.length, c.length) >= 3) return 0.7;
    const qs = new Set(q.split(/\s+/).filter(Boolean));
    const cs = new Set(c.split(/\s+/).filter(Boolean));
    if (!qs.size || !cs.size) return 0;
    let inter = 0;
    for (const t of qs) if (cs.has(t)) inter++;
    const union = new Set([...qs, ...cs]).size;
    return union ? (inter / union) * 0.6 : 0;
}

/** Normalize a target argument (string | object) into a spec object. */
function normalizeSpec(target, extra = {}) {
    const base = target == null
        ? {}
        : (typeof target === 'string' ? { name: target } : { ...target });
    if (extra.exact !== undefined && base.exact === undefined) base.exact = extra.exact;
    if (extra.nth !== undefined && base.nth === undefined) base.nth = extra.nth;
    return base;
}

/** Human-readable description of a target spec for result messages. */
function describeSpec(spec) {
    if (!spec) return 'unknown';
    if (spec.ref) return `ref=${spec.ref}`;
    if (spec.selector || spec.css) return spec.selector || spec.css;
    const parts = [];
    if (spec.role) parts.push(spec.role);
    if (spec.name || spec.text) parts.push(`"${spec.name || spec.text}"`);
    return parts.join(' ') || 'unknown';
}

export function applyIntelligentPrimitives(bridge) {
    // ── Scoring a snapshot element against a target spec ──────────────────────
    bridge._scoreTargetMatch = function (spec, el) {
        // Exact test-id is an unambiguous, top-priority match.
        if (spec.testId && (el.dataTestId === spec.testId || el.dataTestIdAlt === spec.testId || el.dataQa === spec.testId)) {
            return 1;
        }

        let score = 0;

        // Role constraint — a mismatch disqualifies the element for role-scoped queries.
        if (spec.role) {
            const elRole = (el.role || SelectorEngine.mapAriaRole(el.role, el.tag) || el.tag || '').toLowerCase();
            if (elRole !== String(spec.role).toLowerCase()) return 0;
            score += 0.2;
        }

        const query = spec.name || spec.text || '';
        if (query) {
            const names = [el.computedLabel, el.ariaLabel, el.associatedLabel, el.text, el.name, el.placeholder].filter(Boolean);
            let best = 0;
            for (const n of names) best = Math.max(best, scoreName(query, n));
            if (best === 0 && !spec.role) return 0;
            score += best * 0.8;
        } else if (spec.role) {
            // role-only query: nudge toward interactive elements
            score += el.isInteractive ? 0.1 : 0;
        } else {
            return 0; // nothing to match on
        }

        if (el.isInteractive) score += 0.03;
        if (el.visible !== false) score += 0.02;
        return Math.min(score, 1);
    };

    // ── Resolve a target spec to a ref / css selector / locator ───────────────
    bridge._resolveTarget = async function (target, opts = {}) {
        const spec = normalizeSpec(target);
        const threshold = opts.threshold ?? DEFAULT_MATCH_THRESHOLD;

        // 1. Explicit ref from a prior snapshot.
        if (spec.ref && this.snapshotRefs.has(spec.ref)) {
            return { ref: spec.ref, strategy: 'ref', matched: spec.ref };
        }

        // 2. Explicit CSS selector that actually resolves.
        const css = spec.selector || spec.css;
        if (css) {
            const count = await this.page.locator(css).count().catch(() => 0);
            if (count > 0) return { selector: css, strategy: 'selector', matched: css, count };
            // Self-heal (P4): a known CSS selector that no longer resolves is re-anchored to its
            // element via stable identity when the resident agent + healing resolver are active.
            if (this._healingResolver && spec.identity) {
                const healed = await this._healingResolver.heal({ brokenSelector: css, identity: spec.identity }).catch(() => null);
                if (healed && healed.healed) {
                    // A CSS heal can be used directly; a locator heal resolves via its fresh ref.
                    if (healed.selectorKind === 'css') {
                        return { selector: healed.cssSelector, strategy: healed.strategy, matched: spec.identity, healed: true, heal: healed };
                    }
                    return { ref: healed.ref, strategy: healed.strategy, matched: spec.identity, healed: true, heal: healed };
                }
            }
        }

        // 3 & 4. Match against the live snapshot (cheap — served from cache when fresh).
        // Vision-assisted (P5): when _visionResolve is set, the snapshot fuses visual labels for
        // DOM-blind elements (icon-only buttons, canvas) so they become matchable targets.
        await this.snapshot({ useCache: true, vision: this._visionResolve === true });
        const els = [...this.snapshotRefs.values()];
        const scored = els
            .map((el) => ({ el, score: this._scoreTargetMatch(spec, el) }))
            .filter((s) => s.score >= threshold)
            .sort((a, b) => b.score - a.score);

        if (scored.length) {
            const nth = Number.isInteger(spec.nth) ? spec.nth : 0;
            const pick = scored[Math.min(nth, scored.length - 1)].el;
            // Learn (P4): capture the element's stable identity so a future break of this
            // selector can be healed. Fire-and-forget — never blocks resolution.
            if (this._healingResolver) {
                this._healingResolver.captureIdentity(pick.ref, { selector: pick.selector?.cssSelector, strategy: 'fuzzy-match' }).catch(() => {});
            }
            return {
                ref: pick.ref,
                strategy: 'fuzzy-match',
                matched: pick.computedLabel || pick.text || pick.ref,
                score: Number(scored[0].score.toFixed(2)),
                // Vision provenance captured at resolve time (the fusedName flag is transient —
                // a later non-vision snapshot clears it, so the audit must record it now).
                visual: pick.fusedName === true,
                visualSource: pick.visualSource || null,
                candidates: scored.slice(0, 5).map((s) => ({
                    ref: s.el.ref,
                    role: s.el.role || s.el.tag,
                    name: s.el.computedLabel || s.el.text,
                    score: Number(s.score.toFixed(2)),
                })),
            };
        }

        // 4b. Playwright getByRole fallback (handles names the DOM walk didn't capture).
        if (spec.role && (spec.name || spec.text)) {
            try {
                const loc = this.page.getByRole(spec.role, { name: spec.name || spec.text, exact: !!spec.exact });
                if ((await loc.count()) > 0) {
                    return { locator: loc.first(), strategy: 'role+name', matched: `${spec.role}:${spec.name || spec.text}` };
                }
            } catch { /* ignore */ }
        }

        // 5. getByText last resort.
        if (spec.name || spec.text) {
            try {
                const loc = this.page.getByText(spec.name || spec.text, { exact: !!spec.exact });
                if ((await loc.count()) > 0) {
                    return { locator: loc.first(), strategy: 'text', matched: spec.name || spec.text };
                }
            } catch { /* ignore */ }
        }

        return null;
    };

    // ── Dispatch an action against a resolved ref/css using proven bridge methods ─
    bridge._dispatchAction = async function (action, handle, payload) {
        // handle is { ref } or { element, selector } so both base + enhanced methods work.
        const a = String(action || 'click').toLowerCase();
        switch (a) {
            case 'click': return this.click({ ...handle });
            case 'dblclick':
            case 'doubleclick': return this.click({ ...handle, doubleClick: true });
            case 'type': return this.type({ ...handle, text: payload.text });
            case 'fill': return this.type({ ...handle, text: payload.text, clear: true });
            case 'hover': return this.hover({ ...handle });
            case 'check': return this.check({ ...handle });
            case 'uncheck': return this.uncheck({ ...handle });
            case 'select': return this.selectOption({ ...handle, value: payload.value, values: payload.values, label: payload.label });
            case 'press': return this.pressKey({ key: payload.key });
            default: throw new Error(`Unsupported act action: ${action}`);
        }
    };

    // ── Dispatch an action against a raw Playwright locator (rare fallback path) ─
    bridge._dispatchActionLocator = async function (action, locator, payload) {
        const a = String(action || 'click').toLowerCase();
        await this.dismissKnownPopups().catch(() => { });
        switch (a) {
            case 'click': await locator.click(); break;
            case 'dblclick':
            case 'doubleclick': await locator.dblclick(); break;
            case 'type': await locator.fill(''); await locator.pressSequentially(payload.text); break;
            case 'fill': await locator.fill(payload.text ?? ''); break;
            case 'hover': await locator.hover(); break;
            case 'check': await locator.check(); break;
            case 'uncheck': await locator.uncheck(); break;
            case 'select': await locator.selectOption(payload.values || payload.value || { label: payload.label }); break;
            case 'press': await this.page.keyboard.press(payload.key); break;
            default: throw new Error(`Unsupported act action: ${action}`);
        }
        const postActionBlocker = await this._capturePostActionBlocker(a, null);
        return { success: true, blockerDetected: postActionBlocker?.blocker || null, requiresRecovery: !!postActionBlocker };
    };

    /**
     * act — perform one action against a described target, self-healing on miss.
     * Returns a compact diff. Pass snapshotAfter:true to also receive a fresh
     * compact snapshot (off by default to keep results tiny).
     */
    bridge.actIntelligent = async function (args = {}) {
        const { action = 'click', text, value, values, label, key, exact, nth, snapshotAfter = false, force = false } = args;
        const spec = normalizeSpec(args.targetSpec ?? args.target, { exact, nth });
        const payload = { text, value, values, label, key };
        const before = this.page.url();
        const beforeSeq = await this._readDomSeqQuick();

        const attempt = async (forceFresh) => {
            if (forceFresh) await this.snapshot({ useCache: false });
            const resolved = await this._resolveTarget(spec);
            if (!resolved) return { notFound: true };
            if (resolved.ref || resolved.selector) {
                const handle = resolved.ref
                    ? { ref: resolved.ref }
                    : { element: resolved.selector, selector: resolved.selector };
                if (force) handle.force = true;
                const raw = await this._dispatchAction(action, handle, payload);
                return { resolved, raw };
            }
            const raw = await this._dispatchActionLocator(action, resolved.locator, payload);
            return { resolved, raw };
        };

        let res;
        let healed = false;
        try {
            res = await attempt(false);
            if (res.notFound) {
                // Auto-vision on miss (Fix #4): a target the DOM/AX tree can't name (icon-only
                // button, canvas) becomes resolvable when the retry snapshot fuses visual labels.
                const prevVisionResolve = this._visionResolve;
                if (this._visionFusion) this._visionResolve = true;
                try {
                    res = await attempt(true); // self-heal: fresh (vision-assisted) snapshot, retry
                } finally {
                    this._visionResolve = prevVisionResolve;
                }
                healed = true;
            }
        } catch (err) {
            try {
                res = await attempt(true); // self-heal on action error
                healed = true;
            } catch (err2) {
                return { ok: false, action, target: describeSpec(spec), error: err2.message };
            }
        }

        if (!res || res.notFound) {
            const obs = await this.observeIntelligent({ target: spec, max: 5, threshold: 0.25 }).catch(() => null);
            return { ok: false, action, target: describeSpec(spec), error: 'target not found', suggestions: obs?.candidates || [] };
        }

        const after = this.page.url();
        const afterSeq = await this._readDomSeqQuick();
        const out = {
            ok: res.raw?.success !== false,
            action,
            target: res.resolved.matched,
            strategy: res.resolved.strategy,
            urlChanged: before !== after,
        };
        if (before !== after) out.url = after;
        if (typeof res.resolved.score === 'number') out.matchScore = res.resolved.score;
        if (healed) out.healed = true;
        // Propagate a heal performed inside _resolveTarget (broken CSS re-anchored by identity)
        // so callers and the resolution audit see it (QA-integrity — a heal = possible product change).
        if (res.resolved?.healed) { out.healed = true; if (res.resolved.heal) out.heal = res.resolved.heal; }
        // Propagate vision provenance so the audit can label a vision-resolved target.
        if (res.resolved?.visual) { out.visual = true; out.visualSource = res.resolved.visualSource; }
        if (res.raw?.blockerDetected) out.blocker = res.raw.blockerDetected;
        if (res.raw?.requiresRecovery) out.requiresRecovery = true;
        if (res.raw && res.raw.success === false) out.error = res.raw.error || 'action verification failed';
        // ── Post-action effect verification (Fix #2 — QA-integrity) ──────────────
        // Report what actually CHANGED so a "silent success" (dispatch ok, but the control was a
        // no-op or its blade never opened) is visible instead of a bare, misleading ok:true.
        const domChanged = beforeSeq >= 0 && afterSeq >= 0 && afterSeq !== beforeSeq;
        const blockerAppeared = !!(out.blocker || out.requiresRecovery);
        const observedEffect = (before !== after) || domChanged || blockerAppeared;
        out.effect = { urlChanged: before !== after, domChanged, blockerAppeared };
        out.verified = observedEffect;
        // Only flag CLICKS that produced nothing observable — fill/type change an input's value
        // (a property the mutation counter doesn't see), so they are excluded from this heuristic.
        const clickAction = ['click', 'dblclick', 'doubleclick'].includes(String(action).toLowerCase());
        if (clickAction && out.ok !== false && !observedEffect) {
            out.warning = 'Action dispatched but produced no observable effect (no navigation, DOM mutation, or blocker). The control may be a no-op or its effect may be unobservable — verify before relying on it.';
        }
        if (snapshotAfter) {
            const snap = await this.snapshot({ useCache: false });
            out.snapshot = { url: snap.url, elementCount: snap.elementCount, elements: snap.elements };
        }
        return out;
    };

    /**
     * observe — rank candidate elements for a described target without acting.
     * Pure planning primitive; cheap (served from snapshot cache when fresh).
     */
    bridge.observeIntelligent = async function (args = {}) {
        const { max = 5, threshold = 0.3 } = args;
        const spec = normalizeSpec(args.targetSpec ?? args.target);
        await this.snapshot({ useCache: true });
        const els = [...this.snapshotRefs.values()];
        const scored = els
            .map((el) => ({ el, score: this._scoreTargetMatch(spec, el) }))
            .filter((s) => s.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, max);

        return {
            found: scored.length,
            target: describeSpec(spec),
            candidates: scored.map((s) => ({
                ref: s.el.ref,
                role: s.el.role || s.el.tag,
                name: s.el.computedLabel || s.el.text || s.el.ariaLabel,
                selector: s.el.selector?.primary,
                css: s.el.selector?.cssSelector,
                unique: s.el.selector?.isUnique !== false,
                score: Number(s.score.toFixed(2)),
            })),
        };
    };

    /**
     * extract — read structured content for assertions.
     * what: 'text' | 'value' | 'attribute' | 'list' | 'table'
     */
    bridge.extractIntelligent = async function (args = {}) {
        const { what = 'text', attribute, all = false, max = 50 } = args;
        const target = args.targetSpec ?? args.target;

        // Resolve a locator for the target (or the whole document).
        let loc = null;
        let cssForTable = null;
        if (target) {
            const resolved = await this._resolveTarget(typeof target === 'string' ? { name: target } : target);
            if (!resolved) return { ok: false, what, error: 'target not found', target: describeSpec(normalizeSpec(target)) };
            if (resolved.ref) {
                const refData = this.snapshotRefs.get(resolved.ref);
                cssForTable = SelectorEngine.resolveCssSelector(refData);
                loc = this.page.locator(cssForTable);
            } else if (resolved.selector) {
                cssForTable = resolved.selector;
                loc = this.page.locator(resolved.selector);
            } else if (resolved.locator) {
                loc = resolved.locator;
            }
        }

        switch (String(what).toLowerCase()) {
            case 'value': {
                const l = loc || this.page.locator('input');
                return { ok: true, what, value: await l.first().inputValue().catch(() => null) };
            }
            case 'attribute': {
                if (!attribute) return { ok: false, what, error: 'attribute name required' };
                const l = loc || this.page.locator('body');
                if (all) {
                    const handles = await l.elementHandles();
                    const vals = [];
                    for (const h of handles.slice(0, max)) vals.push(await h.getAttribute(attribute).catch(() => null));
                    return { ok: true, what, attribute, values: vals };
                }
                return { ok: true, what, attribute, value: await l.first().getAttribute(attribute).catch(() => null) };
            }
            case 'list': {
                const l = loc || this.page.locator('li');
                const items = await l.allInnerTexts().catch(() => []);
                return { ok: true, what, count: items.length, items: items.slice(0, max).map((t) => t.trim()).filter(Boolean) };
            }
            case 'table': {
                const rows = await this.page.evaluate((sel) => {
                    const table = sel ? document.querySelector(sel) : document.querySelector('table');
                    if (!table) return null;
                    return [...table.querySelectorAll('tr')].map((tr) =>
                        [...tr.querySelectorAll('th,td')].map((c) => (c.innerText || '').trim())
                    );
                }, cssForTable);
                if (!rows) return { ok: false, what, error: 'no table found' };
                return { ok: true, what, rowCount: rows.length, rows: rows.slice(0, max) };
            }
            case 'text':
            default: {
                const l = loc || this.page.locator('body');
                if (all) {
                    const texts = await l.allInnerTexts().catch(() => []);
                    return { ok: true, what: 'text', count: texts.length, values: texts.slice(0, max).map((t) => t.trim()) };
                }
                let text = await l.first().innerText().catch(() => null);
                if (text == null || text === '') {
                    text = await l.first().textContent().catch(() => null);
                }
                return { ok: true, what: 'text', value: text == null ? null : String(text).trim() };
            }
        }
    };

    // ── Route the new tools through callTool (mirrors applyEnhancedMethods) ────
    const originalCallTool = bridge.callTool.bind(bridge);
    const PRIMITIVE_MAP = {
        browser_act: 'actIntelligent',
        browser_observe: 'observeIntelligent',
        browser_extract: 'extractIntelligent',
    };
    bridge.callTool = async function (toolName, args = {}) {
        const methodName = PRIMITIVE_MAP[toolName];
        if (methodName && typeof this[methodName] === 'function') {
            await this.ensureConnected();
            // Route browser_act through the IntentProtocol (Fix #1) so every action returns a
            // transparent resolution audit — chosen element, candidates considered, confidence,
            // source (dom / vision / heal), and the post-action effect/verified signal. This is
            // what makes a "silent success" visible to the agent instead of a bare ok:true.
            if (toolName === 'browser_act' && this._intent) {
                console.error('[PlaywrightDirect] Calling intelligent primitive: browser_act -> intent.act (audited)');
                return await this._intent.act(args);
            }
            console.error(`[PlaywrightDirect] Calling intelligent primitive: ${toolName} -> ${methodName}`);
            return await this[methodName](args);
        }
        return originalCallTool(toolName, args);
    };

    return bridge;
}
