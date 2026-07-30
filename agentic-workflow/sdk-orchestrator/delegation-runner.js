/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DELEGATION RUNNER — Atomic "Run One Agent" Step Executor
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The smallest reusable unit of orchestration: run ONE agent (core or custom
 * Studio agent) against ONE input message and return a structured result. Both
 * consumers build on this:
 *   - WorkflowConductor  → executes each `agent` node of a blueprint
 *   - delegate_to_specialist (chat) → hands a focused sub-task to a specialist
 *
 * Design:
 *   - SOURCE-AGNOSTIC: a target is identified by catalog id (core:<mode> or
 *     workspace:<wsId>:<assetId>). Core and custom agents are interchangeable.
 *   - DEPENDENCY-INJECTED: callers provide HOW a session is created
 *     (deps.createSession) OR a real AgentSessionFactory (deps.sessionFactory).
 *     This keeps the executor pure orchestration logic and trivially testable.
 *   - STRUCTURAL DEPTH CAP: a delegated sub-session must not delegate again.
 *     Enforced here numerically AND (in chat) by not injecting the delegate tool
 *     into sub-sessions.
 *   - APPROVAL-SAFE: approval context (chatManager + sessionId) is forwarded to
 *     session creation so gated Jira/file writes prompt the chat user in
 *     interactive mode, or resolve by policy in headless mode.
 *   - ALWAYS CLEANS UP: the session is destroyed in a finally block.
 *
 * @module sdk-orchestrator/delegation-runner
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const DELEGATION = Object.freeze({
    DEFAULT_MAX_DEPTH: 1,
    DEFAULT_TIMEOUT_MS: 300000,
});

const CATALOG_ID_RE = /^(core:([A-Za-z0-9_-]+)|workspace:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+))$/;

/**
 * Parse a catalog id into a normalized target descriptor.
 *
 * @param {string} catalogId - 'core:<mode>' or 'workspace:<wsId>:<assetId>'
 * @param {Object} [extra]   - Optional fields merged into the target (label,
 *                             systemPromptOverride, capabilityProfile, role, ...)
 * @returns {{ ok: boolean, target?: Object, error?: string }}
 */
function normalizeTarget(catalogId, extra = {}) {
    if (typeof catalogId !== 'string' || !CATALOG_ID_RE.test(catalogId)) {
        return { ok: false, error: `invalid agent catalog id: ${JSON.stringify(catalogId)}` };
    }
    const m = catalogId.match(CATALOG_ID_RE);
    const isCore = !!m[2];
    const target = {
        id: catalogId,
        kind: isCore ? 'core' : 'workspace',
        // For core agents the role IS the mode (e.g., 'testgenie'); 'tpm' maps to
        // the unified profile via role=null in the factory.
        role: isCore ? (m[2] === 'tpm' ? null : m[2]) : null,
        workspaceId: isCore ? null : m[3],
        assetId: isCore ? null : m[4],
        label: extra.label || catalogId,
        ...extra,
    };
    return { ok: true, target };
}

/**
 * Build a `createSession` adapter backed by a real AgentSessionFactory.
 * Used by the conductor (core agents) and as a fallback. Custom-agent callers
 * (chat) typically inject their OWN createSession that builds the workspace
 * prompt/tool bundle with full direct-session parity.
 *
 * @param {Object} sessionFactory - AgentSessionFactory instance
 * @returns {Function} async (target, sessionOpts) => { sendAndWait, destroy, sessionId }
 */
function createFactoryAdapter(sessionFactory) {
    if (!sessionFactory || typeof sessionFactory.createAgentSession !== 'function') {
        throw new Error('createFactoryAdapter requires a valid AgentSessionFactory');
    }
    return async function createSession(target, sessionOpts = {}) {
        // Core agents create by role; workspace agents create by id WITH a
        // systemPromptOverride (the factory cannot load a prompt for a workspace id).
        const agentName = target.kind === 'core' ? (target.role || null) : target.id;
        const ctx = {
            runId: sessionOpts.runId || null,
            ticketContext: sessionOpts.ticketContext || '',
        };
        if (target.systemPromptOverride) ctx.systemPromptOverride = target.systemPromptOverride;
        // Approval routing passthrough (consumed by createAgentSession's mutation
        // guard wiring; harmless if the factory ignores unknown keys).
        if (sessionOpts.chatManager) ctx.chatManager = sessionOpts.chatManager;
        if (sessionOpts.sessionId) ctx.sessionContext = { sessionId: sessionOpts.sessionId };
        if (target.toolProfile) ctx.toolProfile = target.toolProfile;

        const { session, sessionId } = await sessionFactory.createAgentSession(agentName, ctx);
        return {
            sessionId,
            sendAndWait: (prompt, opts) => sessionFactory.sendAndWait(session, prompt, opts),
            destroy: () => sessionFactory.destroySession(sessionId).catch(() => {}),
        };
    };
}

/**
 * Run a single agent step.
 *
 * @param {Object} params
 * @param {Object} params.target          - Normalized target (from normalizeTarget) OR a catalog id string.
 * @param {string} params.input           - The message/instruction sent to the agent.
 * @param {Object} params.deps            - { createSession? , sessionFactory? }
 * @param {Object} [params.context]       - Run context.
 * @param {string} [params.context.runId]
 * @param {number} [params.context.depth=0]
 * @param {number} [params.context.maxDepth=1]
 * @param {number} [params.context.timeoutMs]
 * @param {Function} [params.context.onDelta]
 * @param {Function} [params.context.onToolStart]
 * @param {Function} [params.context.onToolEnd]
 * @param {AbortSignal} [params.context.signal]
 * @param {string} [params.context.ticketContext]
 * @param {Object} [params.context.chatManager] - For interactive approval routing.
 * @param {string} [params.context.sessionId]   - Chat session id (approval routing).
 * @returns {Promise<Object>} { ok, output, error, code, target, durationMs, sessionId, aborted }
 */
async function runAgentStep({ target, input, deps = {}, context = {} }) {
    const startedAt = Date.now();

    // Normalize target if a raw catalog id string was passed.
    let tgt = target;
    if (typeof target === 'string') {
        const norm = normalizeTarget(target);
        if (!norm.ok) return _fail(norm.error, 'INVALID_TARGET', null, startedAt);
        tgt = norm.target;
    }
    if (!tgt || !tgt.id) return _fail('target is required', 'INVALID_TARGET', tgt, startedAt);
    if (typeof input !== 'string' || input.trim() === '') {
        return _fail('input must be a non-empty string', 'INVALID_INPUT', tgt, startedAt);
    }

    const depth = context.depth || 0;
    const maxDepth = context.maxDepth ?? DELEGATION.DEFAULT_MAX_DEPTH;
    if (depth > maxDepth) {
        return _fail(`delegation depth ${depth} exceeds maxDepth ${maxDepth}`, 'DEPTH_CAP', tgt, startedAt);
    }

    if (context.signal?.aborted) {
        return { ok: false, output: '', error: 'aborted before start', code: 'ABORTED', aborted: true, target: _slim(tgt), durationMs: 0, sessionId: null };
    }

    // Resolve session creator (DI).
    let createSession = deps.createSession;
    if (!createSession) {
        if (!deps.sessionFactory) {
            return _fail('deps.createSession or deps.sessionFactory is required', 'NO_SESSION_FACTORY', tgt, startedAt);
        }
        createSession = createFactoryAdapter(deps.sessionFactory);
    }

    let handle = null;
    try {
        handle = await createSession(tgt, {
            runId: context.runId || null,
            ticketContext: context.ticketContext || '',
            chatManager: context.chatManager || null,
            sessionId: context.sessionId || null,
        });

        const output = await handle.sendAndWait(input, {
            timeout: context.timeoutMs || DELEGATION.DEFAULT_TIMEOUT_MS,
            onDelta: context.onDelta,
            onToolStart: context.onToolStart,
            onToolEnd: context.onToolEnd,
            ...(Array.isArray(context.attachments) && context.attachments.length > 0
                ? { attachments: context.attachments }
                : {}),
        });

        return {
            ok: true,
            output: typeof output === 'string' ? output : String(output ?? ''),
            error: null,
            code: 'OK',
            aborted: false,
            target: _slim(tgt),
            durationMs: Date.now() - startedAt,
            sessionId: handle.sessionId || null,
        };
    } catch (err) {
        const aborted = !!context.signal?.aborted;
        return {
            ok: false,
            output: '',
            error: err?.message || String(err),
            code: aborted ? 'ABORTED' : 'STEP_ERROR',
            aborted,
            target: _slim(tgt),
            durationMs: Date.now() - startedAt,
            sessionId: handle?.sessionId || null,
        };
    } finally {
        if (handle && typeof handle.destroy === 'function') {
            try { await handle.destroy(); } catch { /* best-effort cleanup */ }
        }
    }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function _slim(target) {
    if (!target) return null;
    return { id: target.id, label: target.label || target.id, kind: target.kind || null };
}

function _fail(error, code, target, startedAt) {
    return {
        ok: false,
        output: '',
        error,
        code,
        aborted: false,
        target: _slim(target),
        durationMs: Date.now() - startedAt,
        sessionId: null,
    };
}

module.exports = {
    DELEGATION,
    normalizeTarget,
    createFactoryAdapter,
    runAgentStep,
};
