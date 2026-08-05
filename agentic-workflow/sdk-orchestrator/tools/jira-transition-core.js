/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * JIRA TRANSITION CORE — Pure Jira Write Operations (no approval layer)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Encapsulates the raw "resolve a transition and POST it" and "post a comment"
 * Jira REST operations so they can be reused OUTSIDE an interactive chat session
 * (specifically by the scheduler engine, which fires with no user present).
 *
 * These functions deliberately contain NO approval/guardrail logic — the caller
 * is responsible for authorization. Interactive tools continue to gate through
 * requireJiraMutationApproval(); the scheduler gates through the
 * `scheduler.autoApproveJiraMutations` config flag before invoking these.
 *
 * @module sdk-orchestrator/tools/jira-transition-core
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { getJiraApiConfig, buildJiraIssueApiUrl, buildJiraBrowseUrl } = require('./jira-api-helpers');
const { fetchJiraTicketState } = require('./jira-ticket-formatter');
const { normalizeJiraTicketInput } = require('../atlassian-url-utils');
const { markdownToAdf } = require('../adf-converter');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function summarizeTransitions(transitions) {
    return transitions.map(t => ({
        id: t.id,
        name: t.name || '',
        toStatus: t.to?.name || '',
    }));
}

/**
 * Resolve a target status / transition ID against the ticket's available
 * transitions and POST the transition. Pure operation — no approval.
 *
 * @param {Object} params
 * @param {string} params.ticketId
 * @param {string} [params.targetStatus]  - Status or transition name to resolve
 * @param {string} [params.transitionId]  - Explicit Jira transition ID
 * @param {string} [params.resolution]    - Optional resolution name
 * @param {string} [params.comment]       - Optional transition comment (markdown)
 * @param {string} [params.jiraBaseUrl]   - Optional base URL for the browse link
 * @returns {Promise<Object>} Structured result: { success, ticketId, ticketUrl, transition, fromStatus, ... }
 */
async function transitionJiraTicketCore({ ticketId, targetStatus, transitionId, resolution, comment, jiraBaseUrl }) {
    if (!isNonEmptyString(targetStatus) && !isNonEmptyString(transitionId)) {
        return { success: false, error: 'Provide either targetStatus or transitionId to transition a Jira ticket.' };
    }

    const normalized = normalizeJiraTicketInput(ticketId);
    if (!normalized.ticketId) {
        return { success: false, error: `Could not resolve "${ticketId}" into a Jira ticket key.` };
    }

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalized.jiraBaseUrl });
    if (jiraConfig.error) {
        return { success: false, error: jiraConfig.error };
    }

    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalized.ticketId);

    const ticketState = await fetchJiraTicketState(jiraConfig, normalized.ticketId, ['summary', 'status']);
    if (!ticketState.success) {
        return { success: false, ticketId: normalized.ticketId, ticketUrl, error: ticketState.error };
    }
    const fromStatus = ticketState.ticket?.status || '';
    const summary = ticketState.ticket?.summary || '';

    // Load available transitions for this ticket's current workflow state.
    const transitionsUrl = `${buildJiraIssueApiUrl(jiraConfig, normalized.ticketId, '/transitions')}?expand=transitions.fields`;
    const transitionsResp = await fetch(transitionsUrl, { method: 'GET', headers: jiraConfig.headers });
    if (!transitionsResp.ok) {
        return {
            success: false,
            ticketId: normalized.ticketId,
            ticketUrl,
            error: `Failed to load transitions: HTTP ${transitionsResp.status}`,
            details: await transitionsResp.text(),
        };
    }

    const transitions = (await transitionsResp.json()).transitions || [];
    const target = String(targetStatus || '').trim().toLowerCase();

    let resolved = null;
    if (isNonEmptyString(transitionId)) {
        resolved = transitions.find(t => String(t.id) === String(transitionId).trim()) || null;
    } else {
        const toStatusMatches = transitions.filter(t => String(t.to?.name || '').trim().toLowerCase() === target);
        const nameMatches = transitions.filter(t => String(t.name || '').trim().toLowerCase() === target);
        if (toStatusMatches.length === 1) {
            resolved = toStatusMatches[0];
        } else if (nameMatches.length === 1) {
            resolved = nameMatches[0];
        } else if (toStatusMatches.length + nameMatches.length === 1) {
            resolved = [...toStatusMatches, ...nameMatches][0];
        } else if (toStatusMatches.length + nameMatches.length > 1) {
            return {
                success: false,
                ticketId: normalized.ticketId,
                ticketUrl,
                error: `Multiple transitions matched "${targetStatus}". Use an explicit transitionId.`,
                matches: summarizeTransitions([...toStatusMatches, ...nameMatches]),
            };
        }
    }

    if (!resolved) {
        return {
            success: false,
            ticketId: normalized.ticketId,
            ticketUrl,
            error: `No Jira transition matched ${transitionId ? `ID ${transitionId}` : `status "${targetStatus}"`}.`,
            availableTransitions: summarizeTransitions(transitions),
        };
    }

    const payload = { transition: { id: resolved.id } };
    if (isNonEmptyString(resolution)) {
        payload.fields = { resolution: { name: resolution } };
    }
    if (isNonEmptyString(comment)) {
        payload.update = { comment: [{ add: { body: markdownToAdf(comment) } }] };
    }

    const transitionResp = await fetch(buildJiraIssueApiUrl(jiraConfig, normalized.ticketId, '/transitions'), {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify(payload),
    });

    if (!transitionResp.ok) {
        return {
            success: false,
            ticketId: normalized.ticketId,
            ticketUrl,
            error: `Transition failed: HTTP ${transitionResp.status}`,
            details: await transitionResp.text(),
        };
    }

    const toStatus = resolved.to?.name || resolved.name || '';
    return {
        success: true,
        ticketId: normalized.ticketId,
        ticketUrl,
        summary,
        fromStatus,
        transition: { id: resolved.id, name: resolved.name || '', toStatus },
        outcome: `${normalized.ticketId} moved from ${fromStatus || 'its current state'} to ${toStatus}.`,
    };
}

/**
 * Post a comment to a Jira ticket. Pure operation — no approval.
 *
 * @param {Object} params
 * @param {string} params.ticketId
 * @param {string} params.comment      - Comment body (markdown → ADF)
 * @param {string} [params.jiraBaseUrl]
 * @returns {Promise<Object>} { success, ticketId, ticketUrl, commentId, ... }
 */
async function postJiraCommentCore({ ticketId, comment, jiraBaseUrl }) {
    if (!isNonEmptyString(comment)) {
        return { success: false, error: 'A non-empty comment is required.' };
    }

    const normalized = normalizeJiraTicketInput(ticketId);
    if (!normalized.ticketId) {
        return { success: false, error: `Could not resolve "${ticketId}" into a Jira ticket key.` };
    }

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalized.jiraBaseUrl });
    if (jiraConfig.error) {
        return { success: false, error: jiraConfig.error };
    }

    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalized.ticketId);
    const resp = await fetch(buildJiraIssueApiUrl(jiraConfig, normalized.ticketId, '/comment'), {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify({ body: markdownToAdf(comment) }),
    });

    if (!resp.ok) {
        return {
            success: false,
            ticketId: normalized.ticketId,
            ticketUrl,
            error: `Failed to add comment: HTTP ${resp.status}`,
            details: await resp.text(),
        };
    }

    const created = await resp.json().catch(() => ({}));
    return {
        success: true,
        ticketId: normalized.ticketId,
        ticketUrl,
        commentId: created.id || null,
        outcome: `Comment added to ${normalized.ticketId}.`,
    };
}

/**
 * Create a new Jira ticket (Bug / Story / Task / etc.). Pure operation — no approval.
 *
 * @param {Object} params
 * @param {string} [params.projectKey]  - Defaults to JIRA_PROJECT_KEY env
 * @param {string} [params.issueType]   - Bug | Story | Task | ... (default Task)
 * @param {string} params.summary
 * @param {string} [params.description]  - Markdown → ADF
 * @param {string} [params.priority]     - Default Medium
 * @param {string[]} [params.labels]
 * @param {string} [params.jiraBaseUrl]
 * @returns {Promise<Object>} { success, ticketId, ticketUrl, issueType, project, ... }
 */
async function createJiraTicketCore({ projectKey, issueType, summary, description, priority, labels, jiraBaseUrl }) {
    if (!isNonEmptyString(summary)) {
        return { success: false, error: 'A ticket summary is required.' };
    }

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
    if (jiraConfig.error) {
        return { success: false, error: jiraConfig.error };
    }

    const resolvedProject = isNonEmptyString(projectKey) ? projectKey.trim() : (process.env.JIRA_PROJECT_KEY || 'AOTF');
    const resolvedType = isNonEmptyString(issueType) ? issueType.trim() : 'Task';
    const resolvedPriority = isNonEmptyString(priority) ? priority.trim() : 'Medium';

    const fields = {
        project: { key: resolvedProject },
        summary: summary.trim(),
        description: markdownToAdf(description || ''),
        issuetype: { name: resolvedType },
        priority: { name: resolvedPriority },
    };

    const labelList = Array.isArray(labels)
        ? labels.filter(l => isNonEmptyString(l)).map(l => l.trim())
        : [];
    if (labelList.length > 0) fields.labels = labelList;

    const resp = await fetch(`${jiraConfig.apiBase}/issue`, {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify({ fields }),
    });

    if (!resp.ok) {
        return {
            success: false,
            error: `Failed to create ticket: HTTP ${resp.status}`,
            details: await resp.text(),
        };
    }

    const created = await resp.json().catch(() => ({}));
    const ticketId = created.key || null;
    const ticketUrl = ticketId ? buildJiraBrowseUrl(jiraConfig, ticketId) : null;
    return {
        success: true,
        ticketId,
        ticketUrl,
        project: resolvedProject,
        issueType: resolvedType,
        summary: summary.trim(),
        outcome: `Created ${resolvedType} ${ticketId || ''} in ${resolvedProject}.`.replace('  ', ' '),
    };
}

/**
 * Create a pre-approved AI-drafted Jira ticket. Superset of createJiraTicketCore
 * that also supports assignment, true subtasks (parent), and linking to a related
 * issue. Pure operation — no approval. Used by the scheduler's `jira.ai-create`
 * action, where a human already reviewed and approved the draft at scheduling time.
 *
 * Note: evidence attachments (screenshots/recordings) are NOT attached here — the
 * uploaded media informs the AI draft only. Attaching evidence to the created
 * ticket is a follow-on capability.
 *
 * @param {Object} params
 * @param {string} [params.projectKey]
 * @param {string} [params.issueType]        - Default Task
 * @param {string} params.summary
 * @param {string} [params.description]        - Markdown → ADF
 * @param {string} [params.priority]           - Default Medium
 * @param {string[]|string} [params.labels]
 * @param {string} [params.assigneeAccountId]  - Atlassian account ID
 * @param {string} [params.parentIssueKey]     - Create as a true subtask under this parent
 * @param {string} [params.linkedIssueKey]     - Link the new ticket to this issue after creation
 * @param {string} [params.linkType]           - Link type name (default "Relates")
 * @param {string} [params.jiraBaseUrl]
 * @returns {Promise<Object>} { success, ticketId, ticketUrl, issueType, project, link, ... }
 */
async function createScheduledAiTicketCore({
    projectKey, issueType, summary, description, priority, labels,
    assigneeAccountId, parentIssueKey, linkedIssueKey, linkType, jiraBaseUrl,
}) {
    if (!isNonEmptyString(summary)) {
        return { success: false, error: 'A ticket summary is required.' };
    }

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
    if (jiraConfig.error) {
        return { success: false, error: jiraConfig.error };
    }

    const resolvedProject = isNonEmptyString(projectKey) ? projectKey.trim() : (process.env.JIRA_PROJECT_KEY || 'AOTF');
    const resolvedType = isNonEmptyString(issueType) ? issueType.trim() : 'Task';
    const resolvedPriority = isNonEmptyString(priority) ? priority.trim() : 'Medium';

    const fields = {
        project: { key: resolvedProject },
        summary: summary.trim(),
        description: markdownToAdf(description || ''),
        issuetype: { name: resolvedType },
        priority: { name: resolvedPriority },
    };

    const labelList = Array.isArray(labels)
        ? labels.filter(l => isNonEmptyString(l)).map(l => l.trim())
        : (isNonEmptyString(labels) ? labels.split(',').map(l => l.trim()).filter(Boolean) : []);
    if (labelList.length > 0) fields.labels = labelList;

    if (isNonEmptyString(assigneeAccountId)) {
        fields.assignee = { accountId: assigneeAccountId.trim() };
    }
    if (isNonEmptyString(parentIssueKey)) {
        fields.parent = { key: parentIssueKey.trim() };
    }

    const resp = await fetch(`${jiraConfig.apiBase}/issue`, {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify({ fields }),
    });

    if (!resp.ok) {
        return {
            success: false,
            error: `Failed to create ticket: HTTP ${resp.status}`,
            details: await resp.text(),
        };
    }

    const created = await resp.json().catch(() => ({}));
    const ticketId = created.key || null;
    const ticketUrl = ticketId ? buildJiraBrowseUrl(jiraConfig, ticketId) : null;

    // Link to a related issue (best-effort — a link failure does not fail the creation).
    let link = null;
    if (ticketId && isNonEmptyString(linkedIssueKey)) {
        const resolvedLinkType = isNonEmptyString(linkType) ? linkType.trim() : 'Relates';
        try {
            const linkResp = await fetch(`${jiraConfig.apiBase}/issueLink`, {
                method: 'POST',
                headers: jiraConfig.headers,
                body: JSON.stringify({
                    type: { name: resolvedLinkType },
                    inwardIssue: { key: ticketId },
                    outwardIssue: { key: linkedIssueKey.trim() },
                }),
            });
            link = linkResp.ok
                ? { success: true, linkedTo: linkedIssueKey.trim(), linkType: resolvedLinkType }
                : { success: false, linkedTo: linkedIssueKey.trim(), error: `HTTP ${linkResp.status}` };
        } catch (err) {
            link = { success: false, linkedTo: linkedIssueKey.trim(), error: err.message };
        }
    }

    return {
        success: true,
        ticketId,
        ticketUrl,
        project: resolvedProject,
        issueType: resolvedType,
        summary: summary.trim(),
        assignee: fields.assignee || null,
        parent: fields.parent || null,
        link,
        outcome: `Created ${resolvedType} ${ticketId || ''} in ${resolvedProject}.`.replace('  ', ' '),
    };
}

module.exports = {
    transitionJiraTicketCore,
    postJiraCommentCore,
    createJiraTicketCore,
    createScheduledAiTicketCore,
};
