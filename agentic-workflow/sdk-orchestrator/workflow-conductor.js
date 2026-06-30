/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WORKFLOW CONDUCTOR — Declarative Multi-Agent Blueprint Runtime
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Executes a validated workflow blueprint as a DAG. This is the SINGLE engine
 * behind both entry points:
 *   - Studio visual builder (saved blueprints)
 *   - Chat master-agent (ad-hoc blueprints compiled from intent)
 * so the two can never drift apart.
 *
 * Execution model:
 *   - Implicit parallelism: every node whose incoming edges are resolved and has
 *     ≥1 active incoming edge runs; independent ready nodes run concurrently up to
 *     maxParallel.
 *   - Conditional branching: edges carry an optional `when` expression (evaluated
 *     by the SAFE condition-eval — no code execution). false → edge PRUNED.
 *   - Skip propagation: a node whose incoming edges are all pruned is SKIPPED, and
 *     its outgoing edges are pruned in turn.
 *   - Node types: start, end, agent, condition, approval, tool.
 *   - Data flow: each node result is stored at ctx.steps[nodeId]; agent inputs and
 *     approval prompts interpolate {{ run.input }} / {{ steps.<id>.output }}.
 *   - Guards: maxNodes / maxDurationMs budget + AbortSignal. (Token accounting is a
 *     best-effort hook — disabled by default.)
 *
 * Fully dependency-injected (deps.runAgentStep, deps.toolExecutor, deps.emit,
 * deps.contextStore, deps.requestApproval) so it is unit-testable without an LLM.
 *
 * @module sdk-orchestrator/workflow-conductor
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { validateBlueprint, NODE_TYPES, getOutgoing, getIncoming } = require('./workflow-blueprint');
const { evaluate: evalCondition } = require('./condition-eval');
const { runAgentStep: defaultRunAgentStep } = require('./delegation-runner');

const EDGE = { PENDING: 'pending', ACTIVE: 'active', PRUNED: 'pruned' };
const NODE = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', REJECTED: 'rejected' };

const RUN_STATUS = {
    COMPLETED: 'completed',
    COMPLETED_WITH_ERRORS: 'completed_with_errors',
    ERROR: 'error',
    ABORTED: 'aborted',
    INVALID: 'invalid',
};

// ─── Interpolation ──────────────────────────────────────────────────────────

function resolvePath(pathStr, ctx) {
    const parts = String(pathStr).trim().split('.').filter(Boolean);
    let cur = ctx;
    for (let p of parts) {
        // bracket index support: foo[0]
        const bracket = p.match(/^([A-Za-z0-9_]+)\[(\d+)\]$/);
        if (bracket) {
            if (cur == null) return undefined;
            cur = cur[bracket[1]];
            if (cur == null) return undefined;
            cur = cur[Number(bracket[2])];
            continue;
        }
        if (p === '__proto__' || p === 'prototype' || p === 'constructor') return undefined;
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function interpolate(template, ctx) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
        const val = resolvePath(expr, ctx);
        if (val === undefined || val === null) return '';
        return typeof val === 'string' ? val : JSON.stringify(val);
    });
}

// ─── Conductor ──────────────────────────────────────────────────────────────

class WorkflowConductor {
    /**
     * @param {Object} [deps]
     * @param {Function} [deps.runAgentStep] - Override the agent step executor (tests).
     * @param {Object}   [deps.sessionFactory] - Passed to runAgentStep for core agents.
     * @param {Function} [deps.createSession]  - Passed to runAgentStep for custom agents.
     * @param {Function} [deps.toolExecutor]   - async (toolName, params, ctx) => any (for tool nodes).
     * @param {Function} [deps.emit]           - (eventType, data) => void (SSE/event bridge).
     * @param {Function} [deps.requestApproval]- async (prompt, node) => string|boolean (interactive HITL).
     * @param {Object}   [deps.contextStore]   - SharedContextStore (optional).
     * @param {Object}   [options]
     * @param {boolean}  [options.verbose]
     */
    constructor(deps = {}, options = {}) {
        this.deps = deps;
        this.runAgentStep = deps.runAgentStep || defaultRunAgentStep;
        this.verbose = !!options.verbose;
    }

    _log(msg) { if (this.verbose) console.log(`[Conductor] ${msg}`); }

    _emit(type, data) {
        if (typeof this.deps.emit === 'function') {
            try { this.deps.emit(type, data); } catch { /* non-fatal */ }
        }
    }

    /**
     * Execute a blueprint.
     *
     * @param {Object} blueprint
     * @param {Object} [runOptions]
     * @param {string} [runOptions.input]      - Run-level input (ctx.run.input).
     * @param {string} [runOptions.runId]
     * @param {string} [runOptions.mode]       - 'interactive' | 'headless'.
     * @param {number} [runOptions.maxParallel]
     * @param {Object} [runOptions.budget]     - { maxNodes, maxDurationMs, maxTokens }.
     * @param {AbortSignal} [runOptions.signal]
     * @param {Object} [runOptions.chatManager]- For interactive approvals + delegated write approvals.
     * @param {string} [runOptions.sessionId]  - Chat session id (approval routing).
     * @param {string} [runOptions.approvalPolicy] - headless: 'auto' | 'fail-closed'.
     * @returns {Promise<Object>} run result
     */
    async run(blueprint, runOptions = {}) {
        const startedAt = Date.now();

        const validation = validateBlueprint(blueprint);
        if (!validation.valid) {
            return {
                ok: false,
                status: RUN_STATUS.INVALID,
                error: `Invalid blueprint: ${validation.errors.join('; ')}`,
                steps: {},
                output: '',
                metrics: { durationMs: Date.now() - startedAt, nodesExecuted: 0 },
            };
        }

        const cfg = blueprint.config || {};
        const mode = runOptions.mode || cfg.mode || 'interactive';
        const maxParallel = Math.max(1, runOptions.maxParallel || cfg.maxParallel || 4);
        const budget = {
            maxNodes: 50, maxDurationMs: 1800000, maxTokens: 0,
            ...(cfg.budget || {}), ...(runOptions.budget || {}),
        };
        const onErrorDefault = cfg.onErrorDefault || 'abort';
        const signal = runOptions.signal || null;
        const runId = runOptions.runId || `${blueprint.id}_${Date.now()}`;

        const ctx = { run: { id: runId, input: runOptions.input ?? '' }, steps: {} };

        // Index nodes + edges
        const nodes = blueprint.nodes;
        const nodeById = new Map(nodes.map(n => [n.id, n]));
        const nodeState = new Map(nodes.map(n => [n.id, NODE.PENDING]));
        const edges = (blueprint.edges || []).map((e, i) => ({ ...e, _key: `${e.from}->${e.to}#${i}` }));
        const edgeState = new Map(edges.map(e => [e._key, EDGE.PENDING]));
        const incoming = new Map(nodes.map(n => [n.id, edges.filter(e => e.to === n.id)]));
        const outgoing = new Map(nodes.map(n => [n.id, edges.filter(e => e.from === n.id)]));

        let nodesExecuted = 0;
        let aborted = false;
        let abortReason = null;

        this._emit('run_start', { runId, blueprintId: blueprint.id, name: blueprint.name, mode, totalNodes: nodes.length });

        // ── Edge resolution after a node settles ──
        const activateOutgoing = (nodeId, prune) => {
            for (const e of outgoing.get(nodeId)) {
                if (edgeState.get(e._key) !== EDGE.PENDING) continue;
                if (prune) { edgeState.set(e._key, EDGE.PRUNED); continue; }
                let active = true;
                if (e.when !== undefined) {
                    active = evalCondition(e.when, ctx);
                }
                edgeState.set(e._key, active ? EDGE.ACTIVE : EDGE.PRUNED);
            }
        };

        // ── Skip propagation to a fixpoint ──
        const propagateSkips = () => {
            let changed = false;
            for (const n of nodes) {
                if (nodeState.get(n.id) !== NODE.PENDING) continue;
                const inc = incoming.get(n.id);
                if (inc.length === 0) continue; // start-like; never skipped here
                const states = inc.map(e => edgeState.get(e._key));
                if (states.some(s => s === EDGE.PENDING)) continue; // not resolved yet
                if (states.every(s => s === EDGE.PRUNED)) {
                    nodeState.set(n.id, NODE.SKIPPED);
                    ctx.steps[n.id] = { status: 'skipped' };
                    activateOutgoing(n.id, true);
                    this._emit('node_skipped', { runId, nodeId: n.id });
                    changed = true;
                }
            }
            return changed;
        };

        // ── Find ready nodes ──
        const findReady = () => {
            const ready = [];
            for (const n of nodes) {
                if (nodeState.get(n.id) !== NODE.PENDING) continue;
                const inc = incoming.get(n.id);
                if (inc.length === 0) { ready.push(n.id); continue; } // start
                const states = inc.map(e => edgeState.get(e._key));
                if (states.some(s => s === EDGE.PENDING)) continue;
                if (states.some(s => s === EDGE.ACTIVE)) ready.push(n.id);
            }
            return ready;
        };

        // ── Execute one node (never rejects; resolves to nodeId) ──
        const runNode = async (nodeId) => {
            const node = nodeById.get(nodeId);
            nodeState.set(nodeId, NODE.RUNNING);
            this._emit('node_start', { runId, nodeId, type: node.type, label: node.label || nodeId });
            try {
                const outcome = await this._executeNode(node, {
                    ctx, mode, runId, signal, runOptions, budget,
                });
                ctx.steps[nodeId] = outcome.step;

                if (outcome.terminalFail) {
                    nodeState.set(nodeId, NODE.FAILED);
                    activateOutgoing(nodeId, true);
                    this._emit('node_error', { runId, nodeId, error: outcome.step.error });
                    // honor onError
                    const policy = node.config?.onError || onErrorDefault;
                    if (policy === 'abort') { aborted = true; abortReason = `node ${nodeId} failed: ${outcome.step.error}`; }
                } else if (outcome.rejected) {
                    nodeState.set(nodeId, NODE.REJECTED);
                    activateOutgoing(nodeId, true);
                    this._emit('node_rejected', { runId, nodeId });
                } else {
                    nodeState.set(nodeId, NODE.DONE);
                    activateOutgoing(nodeId, false);
                    this._emit('node_complete', { runId, nodeId, status: outcome.step.status });
                }
                if (outcome.counts) nodesExecuted++;
            } catch (err) {
                // Defensive: _executeNode should not throw, but guard anyway.
                ctx.steps[nodeId] = { status: 'error', error: err?.message || String(err) };
                nodeState.set(nodeId, NODE.FAILED);
                activateOutgoing(nodeId, true);
                this._emit('node_error', { runId, nodeId, error: err?.message || String(err) });
                if ((node.config?.onError || onErrorDefault) === 'abort') {
                    aborted = true; abortReason = `node ${nodeId} threw: ${err?.message || err}`;
                }
            }
            return nodeId;
        };

        // ── Main scheduler loop ──
        const inflight = new Map(); // nodeId -> Promise<nodeId>
        for (;;) {
            // budget / abort checks
            if (signal?.aborted) { aborted = true; abortReason = abortReason || 'aborted by signal'; }
            if (Date.now() - startedAt > budget.maxDurationMs) { aborted = true; abortReason = abortReason || 'maxDurationMs exceeded'; }
            if (nodesExecuted > budget.maxNodes) { aborted = true; abortReason = abortReason || 'maxNodes exceeded'; }

            if (aborted) break;

            // propagate skips to a fixpoint
            while (propagateSkips()) { /* loop */ }

            // schedule ready nodes
            const ready = findReady().filter(id => !inflight.has(id));
            for (const id of ready) {
                if (inflight.size >= maxParallel) break;
                inflight.set(id, runNode(id));
            }

            if (inflight.size === 0) break; // nothing running and nothing ready → done

            // wait for the next node to settle
            const finishedId = await Promise.race(inflight.values());
            inflight.delete(finishedId);
        }

        // drain any in-flight work if we aborted mid-run
        if (inflight.size > 0) {
            await Promise.allSettled(inflight.values());
        }

        // ── Compute final status + output ──
        const failedNodes = [...nodeState.entries()].filter(([, s]) => s === NODE.FAILED).map(([id]) => id);
        let status;
        if (aborted) status = RUN_STATUS.ABORTED;
        else if (failedNodes.length > 0) status = RUN_STATUS.COMPLETED_WITH_ERRORS;
        else status = RUN_STATUS.COMPLETED;

        // Final output = concatenated outputs of done nodes feeding an end node.
        const endNodes = nodes.filter(n => n.type === NODE_TYPES.END).map(n => n.id);
        const feeders = edges.filter(e => endNodes.includes(e.to) && edgeState.get(e._key) === EDGE.ACTIVE).map(e => e.from);
        const outputParts = feeders
            .map(id => ctx.steps[id])
            .filter(s => s && typeof s.output === 'string' && s.output)
            .map(s => s.output);
        const output = outputParts.join('\n\n');

        const result = {
            ok: status === RUN_STATUS.COMPLETED,
            status,
            error: aborted ? abortReason : (failedNodes.length ? `nodes failed: ${failedNodes.join(', ')}` : null),
            output,
            steps: ctx.steps,
            metrics: {
                durationMs: Date.now() - startedAt,
                nodesExecuted,
                failedNodes,
                totalNodes: nodes.length,
            },
        };

        this._emit('run_complete', { runId, status, metrics: result.metrics });

        if (this.deps.contextStore?.recordDecision) {
            try {
                this.deps.contextStore.recordDecision('conductor', `workflow ${blueprint.id} → ${status}`, result.error || 'ok', { runId });
            } catch { /* non-fatal */ }
        }

        return result;
    }

    /**
     * Execute a single node by type. Returns an outcome object — never throws.
     * @returns {Promise<{ step: Object, counts?: boolean, terminalFail?: boolean, rejected?: boolean }>}
     */
    async _executeNode(node, env) {
        const { ctx, mode, runId, signal, runOptions } = env;

        switch (node.type) {
            case NODE_TYPES.START:
                return { step: { status: 'started' }, counts: false };

            case NODE_TYPES.END:
                return { step: { status: 'ended' }, counts: false };

            case NODE_TYPES.CONDITION: {
                const result = evalCondition(node.expression, ctx);
                return { step: { status: 'evaluated', output: result, result }, counts: true };
            }

            case NODE_TYPES.APPROVAL: {
                const prompt = interpolate(node.prompt, ctx);
                const approved = await this._resolveApproval(prompt, node, env);
                if (approved) return { step: { status: 'approved', output: 'approved' }, counts: true };
                return { step: { status: 'rejected', output: 'rejected' }, counts: true, rejected: true };
            }

            case NODE_TYPES.TOOL: {
                if (typeof this.deps.toolExecutor !== 'function') {
                    return { step: { status: 'error', error: 'tool nodes require deps.toolExecutor' }, counts: true, terminalFail: true };
                }
                try {
                    const out = await this.deps.toolExecutor(node.tool, node.params || {}, ctx);
                    return { step: { status: 'pass', output: typeof out === 'string' ? out : JSON.stringify(out), raw: out }, counts: true };
                } catch (err) {
                    return { step: { status: 'error', error: err?.message || String(err) }, counts: true, terminalFail: true };
                }
            }

            case NODE_TYPES.AGENT: {
                const input = interpolate(node.input || '{{ run.input }}', ctx);
                const maxAttempts = Math.max(1, node.config?.retry?.maxAttempts || 1);
                const backoffMs = node.config?.retry?.backoffMs || 0;
                let last = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    if (signal?.aborted) return { step: { status: 'aborted', error: 'aborted' }, counts: true, terminalFail: true };
                    last = await this.runAgentStep({
                        target: node.agent,
                        input,
                        deps: {
                            createSession: this.deps.createSession,
                            sessionFactory: this.deps.sessionFactory,
                        },
                        context: {
                            runId,
                            depth: (runOptions.depth || 0),
                            maxDepth: runOptions.maxDepth,
                            timeoutMs: node.config?.timeoutMs || runOptions.nodeTimeoutMs,
                            signal,
                            chatManager: runOptions.chatManager,
                            sessionId: runOptions.sessionId,
                            ticketContext: runOptions.ticketContext,
                            onDelta: runOptions.onDelta ? (d) => runOptions.onDelta(node.id, d) : undefined,
                        },
                    });
                    if (last.ok) {
                        return { step: { status: 'pass', output: last.output, agent: node.agent, attempt }, counts: true };
                    }
                    if (attempt < maxAttempts && backoffMs > 0) {
                        await new Promise(r => setTimeout(r, backoffMs));
                    }
                }
                return {
                    step: { status: 'fail', error: last?.error || 'agent step failed', agent: node.agent },
                    counts: true,
                    terminalFail: true,
                };
            }

            default:
                return { step: { status: 'error', error: `unknown node type: ${node.type}` }, counts: false, terminalFail: true };
        }
    }

    /**
     * Resolve an approval gate. Interactive → ask the human; headless → policy.
     * @returns {Promise<boolean>}
     */
    async _resolveApproval(prompt, node, env) {
        const { mode, runId, runOptions } = env;
        this._emit('approval_requested', { runId, nodeId: node.id, prompt });

        if (mode === 'headless') {
            const policy = runOptions.approvalPolicy || 'auto';
            return policy !== 'fail-closed';
        }

        // interactive
        let answer;
        try {
            if (typeof this.deps.requestApproval === 'function') {
                answer = await this.deps.requestApproval(prompt, node);
            } else if (runOptions.chatManager?.requestUserInput) {
                answer = await runOptions.chatManager.requestUserInput(
                    prompt,
                    ['Approve', 'Reject'],
                    { kind: 'workflow_approval', nodeId: node.id, runId }
                );
            } else {
                // No approver wired in interactive mode → fail-closed for safety.
                return false;
            }
        } catch {
            return false;
        }
        if (typeof answer === 'boolean') return answer;
        return /^(approve|approved|yes|y|ok|proceed|confirm)/i.test(String(answer || '').trim());
    }
}

module.exports = {
    WorkflowConductor,
    RUN_STATUS,
    // exported for tests
    _internals: { interpolate, resolvePath },
};
