/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DELEGATION TOOLS — `delegate_to_specialist` chat tool
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Injected into the master agent (TPM) session so it can hand a focused sub-task to
 * a specialist agent — CORE (testgenie, scriptgenerator, buggenie, taskgenie,
 * docgenie, filegenie) OR a published CUSTOM Studio agent (e.g. CommentGenie).
 *
 * The heavy lifting (target resolution, direct-parity session build, original-
 * message handoff, approval routing, depth cap, result shaping) lives in
 * chatManager.runDelegation() so this module stays thin and the same logic backs
 * both the tool and the (future) orchestrate path.
 *
 * Depth cap is structural: the delegated sub-session is created WITHOUT this tool,
 * so a specialist cannot delegate again (depth = 1 by construction).
 *
 * @module sdk-orchestrator/delegation-tools
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/**
 * @param {Function} defineTool
 * @param {Object} deps
 * @param {Object} deps.chatManager - ChatSessionManager (provides runDelegation, getSessionId).
 * @param {Function} [deps.getSessionId] - () => current chat session id.
 * @param {Array<{id,label,description}>} [deps.customTargets] - Published custom agents (for the description).
 * @returns {Array} tools
 */
function createDelegationTools(defineTool, deps = {}) {
    const { chatManager } = deps;
    const getSessionId = deps.getSessionId || (() => null);

    const customLine = Array.isArray(deps.customTargets) && deps.customTargets.length
        ? ` Published custom specialists currently available: ${deps.customTargets.map(t => `"${t.label}"`).join(', ')}.`
        : '';

    const tool = defineTool('delegate_to_specialist', {
        description:
            'Hand off a focused sub-task to a specialist agent that is better suited than you are. ' +
            'Use this when the user request matches a specialist\'s purpose — PREFER delegating over doing it yourself. ' +
            'Works for core specialists (TestGenie, ScriptGenerator, BugGenie, TaskGenie, DocGenie, FileGenie) AND ' +
            'published custom Studio agents.' + customLine + ' ' +
            'Delegate the GOAL/intent (and raw context), not a pre-written final deliverable — the specialist applies its own craft. ' +
            'Delegate ONCE; approvals are handled automatically by the platform (do not add your own approval step or re-delegate after approval). ' +
            'The specialist runs in its own focused session; its result is returned to you to summarize for the user. ' +
            'IMPORTANT: after delegating, do not perform the same Jira/document/file write yourself. If the specialist returns a draft or asks for approval/info, wait for that specialist flow or ask the user what they want next.',
        parameters: {
            type: 'object',
            properties: {
                agentName: {
                    type: 'string',
                    description:
                        'The specialist to delegate to. A label (e.g. "CommentGenie", "BugGenie") or catalog id ' +
                        '(e.g. "core:buggenie", "workspace:<wsId>:<assetId>"). Must be one of the agents listed in your routing guidance.',
                },
                task: {
                    type: 'string',
                    description:
                        'A clear description of the GOAL/intent for the specialist plus the raw context it needs ' +
                        '(ticket URL/key, the user\'s ask, relevant details). Do NOT pre-write the final deliverable.',
                },
            },
            required: ['agentName', 'task'],
        },
        handler: async ({ agentName, task }) => {
            if (!chatManager || typeof chatManager.runDelegation !== 'function') {
                return JSON.stringify({ success: false, error: 'Delegation is not available in this session.' });
            }
            try {
                const result = await chatManager.runDelegation({
                    agentName,
                    task,
                    sessionId: getSessionId(),
                });
                return typeof result === 'string' ? result : JSON.stringify(result);
            } catch (err) {
                return JSON.stringify({ success: false, error: `Delegation failed: ${err.message}` });
            }
        },
    });

    return [tool];
}

module.exports = { createDelegationTools };
