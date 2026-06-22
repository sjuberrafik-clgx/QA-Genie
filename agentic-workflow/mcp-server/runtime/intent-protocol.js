/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * INTENT PROTOCOL — semantic verbs over the Cognitive Browser Runtime  (Phase 7 of the CBR)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Collapses the whole runtime into FOUR intent-level verbs that an LLM agent reasons in,
 * instead of dozens of low-level tools:
 *
 *   • perceive(opts)            — what's on the page now (token-budgeted view of the Digital
 *                                 Twin + vision-fused names). Reads the live model; no re-walk.
 *   • act({action,target,...})  — do one thing to a described target. Resolves transparently,
 *                                 self-heals on miss (P4), and records a full resolution audit.
 *   • await(condition)          — wait for a page condition (blocker / quiescence / url) via the
 *                                 push-based reactive core (P2) — no polling.
 *   • observe({goal|target})    — REASON: answer "how do I <goal>?" from the application graph
 *                                 (P6, offline) OR list candidate elements for a target.
 *
 * QA-INTEGRITY (non-negotiable): every act() records a structured resolution audit — the chosen
 * element, the OTHER candidates it considered, the confidence, and the SOURCE (dom / vision /
 * heal). Resolution is never silent: a caller can always see why a target resolved the way it
 * did, and whether a self-heal (possible product change) occurred. getAudit() exposes the trail.
 *
 * The legacy MCP tools recompile onto these verbs via compile(toolName, args) — tool names and
 * contracts are preserved; they simply dispatch to a verb. Gated by the bridge's intent flag.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export const INTENT_VERBS = ['perceive', 'act', 'await', 'observe'];

export class IntentProtocol {
    /**
     * @param {object} bridge - PlaywrightDirectBridge (provides snapshot/act/observe/reactiveCore/appGraph).
     * @param {object} [options]
     * @param {number} [options.maxAudit=500] - Ring-buffer size for the resolution audit trail.
     */
    constructor(bridge, options = {}) {
        this._bridge = bridge;
        this._maxAudit = options.maxAudit ?? 500;
        this._audit = [];
        this._stats = { perceive: 0, act: 0, await: 0, observe: 0, heals: 0, visionResolved: 0 };
    }

    get stats() { return { ...this._stats }; }
    getAudit({ limit = 50 } = {}) { return this._audit.slice(-limit); }
    lastResolution() { return this._audit.filter((a) => a.verb === 'act').at(-1) || null; }

    _record(entry) {
        const e = { ...entry, at: Date.now() };
        this._audit.push(e);
        if (this._audit.length > this._maxAudit) this._audit.shift();
        return e;
    }

    // ── perceive ─────────────────────────────────────────────────────────────
    /**
     * Token-budgeted view of the current page. Pulls from the Digital Twin when active and
     * optionally fuses vision for DOM-blind elements.
     */
    async perceive(opts = {}) {
        const { vision = false, filter, maxElements } = opts;
        const snap = await this._bridge.snapshot({ useCache: true, vision, filter, autoFilter: maxElements == null });
        this._stats.perceive += 1;
        const audit = this._record({
            verb: 'perceive',
            url: snap.url,
            elementCount: snap.elementCount,
            vision: snap._vision || null,
            blocker: snap.blockerState?.present || false,
        });
        const elements = maxElements ? (snap.elements || []).slice(0, maxElements) : snap.elements;
        return { url: snap.url, title: snap.title, elementCount: elements?.length ?? snap.elementCount, elements, vision: snap._vision || null, auditId: audit.at };
    }

    // ── act ──────────────────────────────────────────────────────────────────
    /**
     * Perform one action against a described target, with a transparent resolution audit.
     * @param {object} intent - { action, target|targetSpec, text, value, values, label, key, exact, nth }
     */
    async act(intent = {}) {
        const { action = 'click', target, targetSpec, vision = false } = intent;
        const spec = targetSpec ?? target;

        // Vision-assisted resolution: lets act() target DOM-blind elements (icon-only buttons,
        // canvas) by their vision-fused name. Scoped flag — restored in finally.
        const prevVisionResolve = this._bridge._visionResolve;
        if (vision && this._bridge._visionFusion) this._bridge._visionResolve = true;

        let candidates = [];
        let result;
        try {
            // 1. OBSERVE candidates first — this is the transparency record (what the resolver saw).
            try {
                const obs = await this._bridge.observeIntelligent({ target: spec, max: 5, threshold: 0.2 });
                candidates = obs?.candidates || [];
            } catch { /* observation is best-effort */ }

            // 2. ACT (resolves, self-heals on miss, dispatches).
            result = await this._bridge.actIntelligent({ ...intent });
        } finally {
            this._bridge._visionResolve = prevVisionResolve;
        }

        // 3. Classify the resolution source for the audit (dom / vision / heal).
        const chosen = this._describeChosen(result);
        const source = this._classifySource(result, chosen);
        if (source.includes('vision')) this._stats.visionResolved += 1;
        if (result.healed) this._stats.heals += 1;
        this._stats.act += 1;

        const audit = this._record({
            verb: 'act',
            action,
            target: this._describeTarget(spec),
            resolved: chosen,
            confidence: typeof result.matchScore === 'number' ? result.matchScore : (chosen?.confidence ?? null),
            source,                         // dom-ref | dom-fuzzy | dom-locator | vision | heal:identity-reanchor
            strategy: result.strategy || null,
            healed: result.healed === true, // QA-integrity: a heal = possible product change (WARN)
            candidatesConsidered: candidates.slice(0, 5),
            outcome: {
                ok: result.ok === true,
                urlChanged: result.urlChanged === true,
                url: result.url || null,
                verified: result.verified === true,
                effect: result.effect || null,
                warning: result.warning || null,
            },
        });

        return { ...result, audit };
    }

    // ── await ────────────────────────────────────────────────────────────────
    /**
     * Wait for a page condition via the push-based reactive core (no polling).
     * @param {object} cond - { type: 'blocker'|'quiet'|'idle', timeoutMs, quietMs }
     */
    async await_(cond = {}) {
        const { type = 'idle', timeoutMs = 1000, quietMs = 150 } = cond;
        const rc = this._bridge._reactiveCore;
        let result;
        if (rc && type === 'blocker') {
            const b = await rc.waitForBlocker({ timeoutMs });
            result = { type, satisfied: !!b, blocker: b || null };
        } else if (rc && (type === 'quiet' || type === 'idle')) {
            const q = await rc.waitForQuiescence({ quietMs, timeoutMs });
            result = { type, satisfied: q.quiet === true, waitedMs: q.waitedMs };
        } else {
            // Fallback when the reactive core is unavailable: load-state wait.
            await this._bridge.page.waitForLoadState('load').catch(() => {});
            result = { type, satisfied: true, fallback: true };
        }
        this._stats.await += 1;
        this._record({ verb: 'await', ...result });
        return result;
    }

    // ── observe ──────────────────────────────────────────────────────────────
    /**
     * REASON about the application. With { goal }, answers "how do I <goal>?" from the app graph
     * (offline, no browser action). With { target }, lists candidate elements for that target.
     */
    async observe(query = {}) {
        this._stats.observe += 1;
        if (query.goal != null) {
            const graph = this._bridge._appGraph;
            const answer = graph ? graph.howDoI(query.goal) : { found: false, path: [], reason: 'app-graph-disabled' };
            this._record({ verb: 'observe', mode: 'reason', goal: query.goal, found: answer.found, steps: answer.path?.length || 0, confidence: answer.confidence ?? null });
            return { mode: 'reason', goal: query.goal, ...answer };
        }
        const obs = await this._bridge.observeIntelligent({ target: query.target, max: query.max ?? 5, threshold: query.threshold ?? 0.25 });
        this._record({ verb: 'observe', mode: 'candidates', target: this._describeTarget(query.target), found: obs?.found || 0 });
        return { mode: 'candidates', ...obs };
    }

    // ── tool recompile ───────────────────────────────────────────────────────
    /**
     * Map a legacy MCP tool call onto an intent verb (names/contract preserved). Returns the verb
     * + normalized args; the caller dispatches. Unknown tools return { verb: null } (use native path).
     */
    static compile(toolName, args = {}) {
        const name = String(toolName || '').replace(/^(unified_|browser_)/, '');
        if (name === 'snapshot') return { verb: 'perceive', args: { vision: !!args.vision, filter: args.filter } };
        if (['click', 'type', 'fill', 'hover', 'check', 'uncheck', 'select_option', 'press_key', 'act'].includes(name)) {
            const action = name === 'select_option' ? 'select' : (name === 'press_key' ? 'press' : (name === 'act' ? (args.action || 'click') : name));
            return { verb: 'act', args: { action, target: args.target ?? args.ref ?? args.element, targetSpec: args.targetSpec, text: args.text, value: args.value, values: args.values, label: args.label, key: args.key } };
        }
        if (name.startsWith('wait')) return { verb: 'await', args: { type: args.state === 'hidden' ? 'quiet' : 'idle', timeoutMs: args.timeout } };
        if (['observe', 'get_by_role', 'get_by_text', 'get_by_label', 'get_by_test_id'].includes(name)) {
            return { verb: 'observe', args: { target: args.target ?? args.name ?? args.text } };
        }
        return { verb: null, args };
    }

    /** Dispatch a compiled verb. */
    async dispatch(toolName, args = {}) {
        const { verb, args: vargs } = IntentProtocol.compile(toolName, args);
        switch (verb) {
            case 'perceive': return this.perceive(vargs);
            case 'act': return this.act(vargs);
            case 'await': return this.await_(vargs);
            case 'observe': return this.observe(vargs);
            default: return { verb: null, passthrough: true };
        }
    }

    // ── internals ────────────────────────────────────────────────────────────
    _describeTarget(spec) {
        if (spec == null) return null;
        if (typeof spec === 'string') return spec;
        if (spec.ref) return `ref=${spec.ref}`;
        const parts = [];
        if (spec.role) parts.push(spec.role);
        if (spec.name || spec.text) parts.push(`"${spec.name || spec.text}"`);
        if (spec.selector || spec.css) parts.push(spec.selector || spec.css);
        return parts.join(' ') || JSON.stringify(spec);
    }

    _describeChosen(result) {
        // The matched element from snapshotRefs (if resolvable) carries vision/heal provenance.
        const ref = result?.audit?.resolved?.ref || result?.ref || null;
        let el = null;
        if (ref && this._bridge.snapshotRefs?.has(ref)) el = this._bridge.snapshotRefs.get(ref);
        return {
            ref: ref,
            name: result?.target || el?.computedLabel || el?.visualLabel || null,
            role: el?.role || el?.tag || null,
            confidence: typeof result?.matchScore === 'number' ? result.matchScore : null,
            visual: !!el?.fusedName,
            visualSource: el?.visualSource || null,
        };
    }

    _classifySource(result, chosen) {
        if (result?.healed) return `heal:${result.strategy || 'identity-reanchor'}`;
        // Vision provenance is captured at resolve time (result.visual) — preferred over the
        // post-action element lookup, whose transient fusedName flag may already be cleared.
        if (result?.visual) return `vision:${result.visualSource || chosen?.visualSource || 'fused'}`;
        if (chosen?.visual) return `vision:${chosen.visualSource || 'fused'}`;
        const s = String(result?.strategy || '');
        if (s === 'ref') return 'dom-ref';
        if (s === 'selector') return 'dom-selector';
        if (s === 'fuzzy-match') return 'dom-fuzzy';
        if (s === 'role+name' || s === 'text') return 'dom-locator';
        return s ? `dom-${s}` : 'dom';
    }
}

export default IntentProtocol;
