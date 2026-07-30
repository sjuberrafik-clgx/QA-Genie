/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROPOSE JIRA TICKET TOOL — Draft-Only Ticket Composition (no Jira write)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A drop-in replacement for `create_jira_ticket` used ONLY in draft mode (e.g.
 * the scheduler's "AI-generated ticket" flow). Instead of writing to Jira, the
 * agent composes the full ticket and calls this tool; the resolved fields are
 * captured via the `onPropose` callback and surfaced to the user for review.
 *
 * The actual Jira creation is deferred — it happens later, at the scheduled
 * fire time, AFTER a human has approved the draft. This tool therefore performs
 * NO network calls and NO approval-gate interaction.
 *
 * @module sdk-orchestrator/tools/propose-jira-ticket-tool
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Jira/Confluence write tools that must NOT be exposed to a draft-mode agent.
 * Removing them (together with a null chatManager) guarantees a draft run cannot
 * mutate Jira — the agent can only compose a proposal via propose_jira_ticket.
 */
const DRAFT_EXCLUDED_TOOL_NAMES = new Set([
    'create_jira_ticket',
    'update_jira_ticket',
    'transition_jira_ticket',
    'delete_jira_ticket',
    'assign_jira_ticket',
    'add_comment_with_media',
    'add_comment_with_images',
    'attach_file_to_jira',
    'delete_jira_attachment',
    'delete_jira_comment',
    'edit_jira_comment',
    'link_jira_issues',
    'remove_jira_issue_link',
    'log_jira_work',
    'update_jira_estimates',
    'create_confluence_page',
    'update_confluence_page',
]);

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function parseLabels(labels) {
    if (Array.isArray(labels)) {
        return labels.filter(isNonEmptyString).map(l => l.trim());
    }
    if (isNonEmptyString(labels)) {
        return labels.split(',').map(l => l.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Normalize the raw tool arguments into a clean draft payload.
 * @param {Object} args
 * @returns {Object} draft
 */
function normalizeDraft(args = {}) {
    return {
        projectKey: isNonEmptyString(args.projectKey) ? args.projectKey.trim() : null,
        issueType: isNonEmptyString(args.issueType) ? args.issueType.trim() : null,
        summary: isNonEmptyString(args.summary) ? args.summary.trim() : '',
        description: typeof args.description === 'string' ? args.description : '',
        priority: isNonEmptyString(args.priority) ? args.priority.trim() : null,
        labels: parseLabels(args.labels),
        environment: isNonEmptyString(args.environment) ? args.environment.trim() : null,
        linkedIssueKey: isNonEmptyString(args.linkedIssueKey) ? args.linkedIssueKey.trim() : null,
        parentIssueKey: isNonEmptyString(args.parentIssueKey) ? args.parentIssueKey.trim() : null,
        linkType: isNonEmptyString(args.linkType) ? args.linkType.trim() : null,
        assigneeAccountId: isNonEmptyString(args.assigneeAccountId) ? args.assigneeAccountId.trim() : null,
    };
}

/**
 * Build the draft-mode `propose_jira_ticket` tool.
 *
 * @param {Function} defineTool - The SDK defineTool factory (from AgentSessionFactory).
 * @param {Function} onPropose  - Callback invoked with the normalized draft payload.
 * @returns {Object} An SDK tool definition.
 */
function createProposeJiraTicketTool(defineTool, onPropose) {
    return defineTool('propose_jira_ticket', {
        description:
            'Compose a Jira ticket DRAFT for scheduled creation. This is the ONLY way to record a ticket in draft mode — ' +
            'the create_jira_ticket tool is intentionally unavailable. Calling this tool DOES NOT create the ticket in Jira; ' +
            'it captures the fully composed ticket so a human can review it and schedule its creation for a future time. ' +
            'Compose the complete ticket (summary + full description) first, then call this tool exactly once. Do not call it repeatedly.',
        parameters: {
            type: 'object',
            properties: {
                projectKey: { type: 'string', description: 'Jira project key (e.g., "AOTF"). Optional — defaults to the configured project.' },
                summary: { type: 'string', description: 'Ticket summary/title.' },
                description: { type: 'string', description: 'Full ticket description in markdown (Steps to Reproduce, Expected/Actual Behaviour, Environment for bugs; or test-case context for tasks).' },
                issueType: { type: 'string', description: 'Issue type (e.g., "Bug", "Task", "Story").' },
                priority: { type: 'string', description: 'Priority: Highest, High, Medium, Low, Lowest.' },
                labels: { type: 'string', description: 'Comma-separated labels. Omit unless clearly warranted.' },
                environment: { type: 'string', description: 'Environment where the issue was found (e.g., "UAT", "INT", "PROD").' },
                linkedIssueKey: { type: 'string', description: 'Key of an existing issue to link this ticket to (e.g., "AOTF-17250"). Use for linked Testing tasks.' },
                parentIssueKey: { type: 'string', description: 'Key of a parent issue to create this ticket under as a true subtask. Cannot be combined with linkedIssueKey.' },
                linkType: { type: 'string', description: 'Jira link type name (default "Relates"). Only used with linkedIssueKey.' },
                assigneeAccountId: { type: 'string', description: 'Atlassian account ID to assign the ticket to (resolve via get_jira_current_user or search_jira_users).' },
            },
            required: ['summary', 'description'],
        },
        handler: async (args) => {
            const draft = normalizeDraft(args);
            if (!isNonEmptyString(draft.summary) || !isNonEmptyString(draft.description)) {
                return JSON.stringify({
                    success: false,
                    error: 'A draft requires both a non-empty summary and description. Compose the full ticket, then call propose_jira_ticket again.',
                });
            }
            if (typeof onPropose === 'function') {
                try { onPropose(draft); } catch { /* capture is best-effort; never fail the tool */ }
            }
            return JSON.stringify({
                success: true,
                drafted: true,
                message:
                    'Draft captured for scheduled creation. The ticket was NOT created in Jira. ' +
                    'A human will review this draft and choose when it is created. You are done — do not attempt to create the ticket.',
                draft,
            });
        },
    });
}

module.exports = {
    createProposeJiraTicketTool,
    normalizeDraft,
    DRAFT_EXCLUDED_TOOL_NAMES,
};
