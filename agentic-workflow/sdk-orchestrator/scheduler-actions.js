/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCHEDULER ACTIONS — Pluggable Action Registry for Scheduled Jobs
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Maps a job's `action.type` to a concrete handler. This is a FIXED allowlist —
 * there is no dynamic code execution — so a scheduled job can only perform one of
 * the built-in, audited operations.
 *
 * Jira-write actions (jira.transition, jira.comment) fire with NO user present,
 * so they are gated on `scheduler.autoApproveJiraMutations`. When that flag is
 * false the job fails loudly rather than silently skipping — there is no
 * interactive approver at fire time.
 *
 * @module sdk-orchestrator/scheduler-actions
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { transitionJiraTicketCore, postJiraCommentCore, createJiraTicketCore, createScheduledAiTicketCore } = require('./tools/jira-transition-core');
const { ACTION_TYPES } = require('./scheduler-store');
const { isValidTicketId } = require('./utils');

const JIRA_WRITE_ACTIONS = new Set([ACTION_TYPES.JIRA_TRANSITION, ACTION_TYPES.JIRA_COMMENT, ACTION_TYPES.JIRA_CREATE, ACTION_TYPES.JIRA_AI_CREATE]);

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate an action shape at scheduling time (before it is persisted). Returns
 * an error string, or null when valid.
 * @param {Object} action - { type, params }
 * @param {string[]} allowedTypes
 * @returns {string|null}
 */
function validateAction(action, allowedTypes) {
    if (!action || typeof action !== 'object') return 'action is required.';
    const { type, params } = action;
    if (!isNonEmptyString(type)) return 'action.type is required.';
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0 && !allowedTypes.includes(type)) {
        return `action.type "${type}" is not allowed. Allowed: ${allowedTypes.join(', ')}`;
    }
    const p = params || {};

    switch (type) {
        case ACTION_TYPES.JIRA_TRANSITION:
            if (!isValidTicketId(p.ticketId)) return 'jira.transition requires a valid ticketId (e.g. AOTF-123).';
            if (!isNonEmptyString(p.targetStatus) && !isNonEmptyString(p.transitionId)) {
                return 'jira.transition requires targetStatus or transitionId.';
            }
            return null;
        case ACTION_TYPES.JIRA_COMMENT:
            if (!isValidTicketId(p.ticketId)) return 'jira.comment requires a valid ticketId (e.g. AOTF-123).';
            if (!isNonEmptyString(p.comment)) return 'jira.comment requires a non-empty comment.';
            return null;
        case ACTION_TYPES.JIRA_CREATE:
            if (!isNonEmptyString(p.summary)) return 'jira.create requires a summary.';
            if (!isNonEmptyString(p.issueType)) return 'jira.create requires an issueType (Bug, Story, or Task).';
            return null;
        case ACTION_TYPES.JIRA_AI_CREATE:
            // AI-drafted tickets are composed + human-approved at scheduling time; the
            // stored params are the approved fields. Validate the same minimum shape.
            if (!isNonEmptyString(p.summary)) return 'jira.ai-create requires a summary.';
            if (!isNonEmptyString(p.issueType)) return 'jira.ai-create requires an issueType (Bug, Story, or Task).';
            return null;
        case ACTION_TYPES.PIPELINE_RUN:
            if (!isValidTicketId(p.ticketId)) return 'pipeline.run requires a valid ticketId (e.g. AOTF-123).';
            return null;
        case ACTION_TYPES.AGENT_INVOKE:
            if (!isNonEmptyString(p.agentId)) return 'agent.invoke requires an agentId (e.g. core:testgenie).';
            if (!isNonEmptyString(p.prompt)) return 'agent.invoke requires a prompt describing the task.';
            return null;
        default:
            return `Unknown action.type "${type}".`;
    }
}

/**
 * Build the action executor.
 *
 * @param {Object} deps
 * @param {Object} deps.config           - Loaded workflow-config (reads .scheduler)
 * @param {Function} [deps.pipelineTrigger] - async ({ ticketId, mode, environment, model }) => { runId }
 * @param {Function} [deps.agentInvoker] - async ({ agentId, prompt, timeoutMs }) => { success, output, agentLabel, ... }
 * @param {Function} [deps.logger]       - (message, level) => void
 * @returns {Object} { execute, validate, listTypes }
 */
function createSchedulerActions({ config, pipelineTrigger, agentInvoker, logger } = {}) {
    const log = typeof logger === 'function' ? logger : () => {};

    function schedulerConfig() {
        return (config && config.scheduler) || {};
    }

    function allowedTypes() {
        const list = schedulerConfig().allowedActionTypes;
        return Array.isArray(list) && list.length > 0 ? list : Object.values(ACTION_TYPES);
    }

    function ensureJiraAutoApprove(type) {
        if (!JIRA_WRITE_ACTIONS.has(type)) return;
        if (schedulerConfig().autoApproveJiraMutations !== true) {
            throw new Error(
                'Scheduled Jira mutations are disabled. Set scheduler.autoApproveJiraMutations=true in ' +
                'workflow-config.json to allow scheduled jobs to write to Jira without an interactive approver.'
            );
        }
    }

    function ensureAgentAutoApprove() {
        if (schedulerConfig().autoApproveAgentActions !== true) {
            throw new Error(
                'Scheduled agent runs are disabled. Set scheduler.autoApproveAgentActions=true in ' +
                'workflow-config.json to allow scheduled jobs to run agents unattended (agents auto-approve ' +
                'their own Jira/file writes since there is no interactive approver at fire time).'
            );
        }
    }

    const registry = {
        [ACTION_TYPES.JIRA_TRANSITION]: async (params) => {
            ensureJiraAutoApprove(ACTION_TYPES.JIRA_TRANSITION);
            const result = await transitionJiraTicketCore(params);
            if (!result.success) throw new Error(result.error || 'Jira transition failed.');
            log(`[Scheduler] Auto-approved transition ${result.ticketId} → ${result.transition?.toStatus}`, 'info');
            return { ...result, authorization: { autoApprove: true, mode: 'scheduler-auto-approve' } };
        },

        [ACTION_TYPES.JIRA_COMMENT]: async (params) => {
            ensureJiraAutoApprove(ACTION_TYPES.JIRA_COMMENT);
            const result = await postJiraCommentCore(params);
            if (!result.success) throw new Error(result.error || 'Jira comment failed.');
            log(`[Scheduler] Auto-approved comment on ${result.ticketId}`, 'info');
            return { ...result, authorization: { autoApprove: true, mode: 'scheduler-auto-approve' } };
        },

        [ACTION_TYPES.JIRA_CREATE]: async (params) => {
            ensureJiraAutoApprove(ACTION_TYPES.JIRA_CREATE);
            const result = await createJiraTicketCore(params);
            if (!result.success) throw new Error(result.error || 'Jira ticket creation failed.');
            log(`[Scheduler] Auto-approved ${result.issueType} creation ${result.ticketId || ''}`.trim(), 'info');
            return { ...result, authorization: { autoApprove: true, mode: 'scheduler-auto-approve' } };
        },

        [ACTION_TYPES.JIRA_AI_CREATE]: async (params) => {
            ensureJiraAutoApprove(ACTION_TYPES.JIRA_AI_CREATE);
            const result = await createScheduledAiTicketCore(params);
            if (!result.success) throw new Error(result.error || 'AI ticket creation failed.');
            log(`[Scheduler] Auto-approved AI ${result.issueType} creation ${result.ticketId || ''}`.trim(), 'info');
            return { ...result, authorization: { autoApprove: true, mode: 'scheduler-auto-approve' } };
        },

        [ACTION_TYPES.PIPELINE_RUN]: async (params) => {
            if (typeof pipelineTrigger !== 'function') {
                throw new Error('pipeline.run is not available — no pipeline trigger is wired into the scheduler.');
            }
            const result = await pipelineTrigger({
                ticketId: params.ticketId,
                mode: params.mode || 'full',
                environment: params.environment || 'UAT',
                model: params.model || null,
            });
            return { success: true, ...result, outcome: `Pipeline started for ${params.ticketId}.` };
        },

        [ACTION_TYPES.AGENT_INVOKE]: async (params, ctx = {}) => {
            ensureAgentAutoApprove();
            if (typeof agentInvoker !== 'function') {
                throw new Error('agent.invoke is not available — no agent invoker is wired into the scheduler.');
            }
            const cfg = schedulerConfig();
            const timeoutMs = Number.isFinite(cfg.agentTimeoutMs) ? cfg.agentTimeoutMs : undefined;
            const result = await agentInvoker({
                agentId: params.agentId,
                prompt: params.prompt,
                timeoutMs,
                model: params.model || cfg.agentModel || null,
                attachments: Array.isArray(params.attachments) ? params.attachments : [],
                jobId: ctx.jobId || null,
            });
            if (!result || !result.success) {
                throw new Error((result && result.error) || 'Agent run failed.');
            }
            log(`[Scheduler] Auto-approved agent run ${result.agentLabel || params.agentId} (${result.durationSec || 0}s)`, 'info');
            return {
                ...result,
                outcome: result.outcome || `Agent ${result.agentLabel || params.agentId} completed.`,
                authorization: { autoApprove: true, mode: 'scheduler-auto-approve' },
            };
        },
    };

    /**
     * Execute an action. Throws on failure (the engine handles retry/failure).
     * @param {Object} action - { type, params }
     * @returns {Promise<Object>} action result
     */
    async function execute(action, ctx = {}) {
        const validationError = validateAction(action, allowedTypes());
        if (validationError) throw new Error(validationError);
        return registry[action.type](action.params || {}, ctx);
    }

    return {
        execute,
        validate: (action) => validateAction(action, allowedTypes()),
        listTypes: () => allowedTypes(),
    };
}

module.exports = {
    createSchedulerActions,
    validateAction,
    JIRA_WRITE_ACTIONS,
};
