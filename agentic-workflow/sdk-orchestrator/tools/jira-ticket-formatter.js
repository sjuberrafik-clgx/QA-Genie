/**
 * Jira ticket formatting and label normalization.
 * Extracted from custom-tools.js
 */
const { isNonEmptyString } = require('./general-helpers');
const { normalizeJiraText } = require('./evidence-helpers');
const { formatJiraComments, formatJiraTimetracking } = require('./jira-comment-helpers');
const {
    formatJiraEpicRelationship,
    formatJiraIssueReference,
    formatJiraSubtasks,
    formatJiraIssueLinks,
    splitCommaSeparated,
    buildJiraIssueApiUrl,
    formatJiraErrorResponse,
} = require('./jira-api-helpers');
const { buildMutationSubject } = require('./mutation-helpers');

function formatJiraTicket(data, ticketId) {
    const fields = data.fields || {};
    const rendered = data.renderedFields || {};

    const description = normalizeJiraText(
        rendered.description || fields.description
    );
    const acceptanceCriteria = normalizeJiraText(
        fields.customfield_10037 || fields.customfield_10038 ||
        rendered.customfield_10037 || rendered.customfield_10038
    );
    const { comments, commentCount, commentsTruncated } = formatJiraComments(fields, rendered);

    return {
        success: true,
        ticketId,
        key: data.key || ticketId,
        summary: fields.summary || '',
        status: fields.status?.name || '',
        issueType: fields.issuetype?.name || '',
        priority: fields.priority?.name || '',
        labels: fields.labels || [],
        components: (fields.components || []).map(c => c.name),
        assignee: fields.assignee?.displayName || '',
        reporter: fields.reporter?.displayName || '',
        epic: formatJiraEpicRelationship(fields),
        parent: formatJiraIssueReference(fields.parent),
        subtasks: formatJiraSubtasks(fields),
        issueLinks: formatJiraIssueLinks(fields),
        description,
        acceptanceCriteria,
        comments,
        commentCount,
        commentsTruncated,
        storyPoints: fields.story_points || fields.customfield_10016 || null,
        fixVersions: (fields.fixVersions || []).map(v => ({ id: v.id, name: v.name, released: v.released || false })),
        sprint: fields.sprint?.name || '',
        created: fields.created || '',
        updated: fields.updated || '',
        timetracking: formatJiraTimetracking(fields),
    };
}

function normalizeJiraLabelList(value) {
    const labels = Array.isArray(value)
        ? value
        : isNonEmptyString(value)
            ? splitCommaSeparated(value)
            : [];

    return Array.from(new Set(labels
        .filter(isNonEmptyString)
        .map(label => label.trim())
        .filter(Boolean)));
}

async function fetchJiraTicketState(jiraConfig, ticketId, fields = []) {
    const requestedFields = Array.isArray(fields) && fields.length > 0
        ? Array.from(new Set(fields.filter(isNonEmptyString).map(field => field.trim()).filter(Boolean)))
        : ['summary', 'description', 'status', 'priority', 'labels', 'assignee', 'comment'];

    const params = new URLSearchParams();
    params.set('fields', requestedFields.join(','));
    params.set('expand', 'renderedFields');

    const response = await fetch(`${buildJiraIssueApiUrl(jiraConfig, ticketId)}?${params.toString()}`, {
        method: 'GET',
        headers: jiraConfig.headers,
    });

    if (!response.ok) {
        const formattedError = formatJiraErrorResponse('Failed to load current Jira issue state', response.status, await response.text());
        return {
            success: false,
            error: formattedError.message,
            details: formattedError.details,
            errorMessages: formattedError.errorMessages,
            fieldErrors: formattedError.fieldErrors,
            hint: formattedError.hint,
        };
    }

    const data = await response.json();
    return {
        success: true,
        raw: data,
        ticket: formatJiraTicket(data, ticketId),
    };
}

function buildJiraMutationSubject({ ticketId, ticketUrl, summary, label }) {
    return buildMutationSubject({
        id: ticketId,
        url: ticketUrl,
        title: summary,
        label: isNonEmptyString(label)
            ? label.trim()
            : [ticketId, summary].filter(Boolean).join(' - '),
    });
}


module.exports = {
    formatJiraTicket,
    normalizeJiraLabelList,
    fetchJiraTicketState,
    buildJiraMutationSubject,
};
