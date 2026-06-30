/**
 * Jira REST API helpers: config, URL builders, error formatting, search.
 * Extracted from custom-tools.js
 */
const path = require('path');
const { JIRA_TICKET_KEY_PATTERN } = require('./constants');
const { isNonEmptyString } = require('./general-helpers');

function loadEnvVars() {
    try {
        require('dotenv').config({
            path: path.join(__dirname, '..', '..', '.env'),
        });
    } catch {
        // dotenv may be unavailable in some runtime contexts.
    }
}

function getJiraAttachmentConfig(options = {}) {
    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '').trim();
    const baseUrl = (options.baseUrl || process.env.JIRA_BASE_URL || '').trim();
    const email = (process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '').trim();
    const apiToken = (process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '').trim();

    if (!cloudId && !baseUrl) {
        return { error: 'JIRA_BASE_URL or JIRA_CLOUD_ID is required for Jira attachments.' };
    }
    if (!email || !apiToken) {
        return { error: 'JIRA_EMAIL and JIRA_API_TOKEN are required for Jira attachments.' };
    }

    return { cloudId, baseUrl, email, apiToken };
}

function getJiraApiConfig(options = {}) {
    loadEnvVars();

    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '').trim();
    const baseUrl = (process.env.JIRA_BASE_URL || '').trim();
    const email = (process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '').trim();
    const apiToken = (process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '').trim();

    if (!cloudId && !baseUrl) {
        return {
            error: 'JIRA_BASE_URL or JIRA_CLOUD_ID must be set in agentic-workflow/.env',
        };
    }

    if (!email || !apiToken) {
        return {
            error: 'JIRA_EMAIL and JIRA_API_TOKEN are required for Jira operations',
        };
    }

    const apiBase = cloudId
        ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
        : `${baseUrl.replace(/\/+$/, '')}/rest/api/3`;

    return {
        cloudId,
        baseUrl,
        browseBaseUrl: (options.jiraBaseUrl || baseUrl || '').replace(/\/+$/, ''),
        email,
        apiToken,
        apiBase,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
        },
    };
}

function buildJiraIssueApiUrl(jiraConfig, ticketId, suffix = '') {
    // CWE-93 fix: encode ticketId and suffix to prevent URL injection
    return `${jiraConfig.apiBase}/issue/${encodeURIComponent(ticketId)}${suffix ? encodeURI(suffix) : ''}`;
}

function buildJiraAgileApiUrl(jiraConfig, suffix = '') {
    const agileBase = jiraConfig.cloudId
        ? `https://api.atlassian.com/ex/jira/${jiraConfig.cloudId}/rest/agile/1.0`
        : `${jiraConfig.baseUrl.replace(/\/+$/, '')}/rest/agile/1.0`;

    return `${agileBase}${suffix}`;
}

function buildJiraBrowseUrl(jiraConfig, ticketId) {
    return jiraConfig.browseBaseUrl
        ? `${jiraConfig.browseBaseUrl}/browse/${ticketId}`
        : `https://${process.env.JIRA_SITE_NAME || 'jira'}.atlassian.net/browse/${ticketId}`;
}

function splitCommaSeparated(value) {
    if (!isNonEmptyString(value)) return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeMaxResults(value, defaultValue = 10) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 1) return defaultValue;
    return Math.min(Math.max(Math.round(num), 1), 50);
}

function parseJsonObjectInput(rawValue, fieldName) {
    if (!isNonEmptyString(rawValue)) {
        return { value: undefined };
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: `${fieldName} must be a JSON object string.` };
        }
        return { value: parsed };
    } catch (error) {
        return { error: `Invalid ${fieldName}: ${error.message}` };
    }
}

function parseJiraErrorBody(rawBody) {
    const bodyText = isNonEmptyString(rawBody) ? rawBody.trim() : '';

    if (!bodyText) {
        return {
            details: '',
            errorMessages: [],
            fieldErrors: {},
        };
    }

    try {
        const parsed = JSON.parse(bodyText);
        return {
            details: bodyText,
            errorMessages: Array.isArray(parsed.errorMessages) ? parsed.errorMessages.filter(Boolean) : [],
            fieldErrors: parsed.errors && typeof parsed.errors === 'object' ? parsed.errors : {},
        };
    } catch {
        return {
            details: bodyText,
            errorMessages: [],
            fieldErrors: {},
        };
    }
}

function buildJiraErrorHint(parsedError, options = {}) {
    const messages = [
        ...parsedError.errorMessages,
        ...Object.values(parsedError.fieldErrors || {}),
        parsedError.details,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const environmentMessage = String(parsedError.fieldErrors?.environment || '').toLowerCase();
    const hasEnvironmentSignal = Boolean(parsedError.fieldErrors?.environment)
        || messages.includes('environment');
    const environmentContext = `${environmentMessage} ${messages}`;

    if (hasEnvironmentSignal) {
        const expectsAdf = /(atlassian document format|\badf\b|operation value must be atlassian document format)/.test(environmentContext);
        const cannotSetField = /(cannot be set|not on the appropriate screen|unknown|does not exist|not valid for this operation|field .* cannot be set|is not supported)/.test(environmentContext);

        if (expectsAdf) {
            return 'Jira expects the environment field as Atlassian Document Format for this project. Retry with rich text, or preserve environment details in the description if the field is not settable.';
        }

        if (cannotSetField) {
            return 'Jira does not allow the environment field on this create or edit screen. Remove environment from the payload and keep the environment details in the description.';
        }

        return 'Jira reported an environment-field validation mismatch. Retry with the project-compatible environment format, or omit the field and preserve environment details in the description.';
    }

    if (options.includesDescription || parsedError.fieldErrors?.description || messages.includes('description') || messages.includes('adf') || messages.includes('atlassian document format')) {
        return 'Jira rejected the rich text payload. Keep section labels bold-only, keep identifiers and event names code-only, and do not combine bold and inline code on the same text.';
    }

    return 'Verify the Jira field types and values match what the project create or edit screen expects.';
}

function formatJiraErrorResponse(prefix, status, rawBody, options = {}) {
    const parsedError = parseJiraErrorBody(rawBody);
    return {
        message: `${prefix}: HTTP ${status}`,
        details: parsedError.details,
        errorMessages: parsedError.errorMessages.length > 0 ? parsedError.errorMessages : undefined,
        fieldErrors: Object.keys(parsedError.fieldErrors).length > 0 ? parsedError.fieldErrors : undefined,
        hint: buildJiraErrorHint(parsedError, options),
    };
}

function normalizeJiraUser(user) {
    if (!user || typeof user !== 'object') return null;

    return {
        accountId: user.accountId || '',
        displayName: user.displayName || '',
        emailAddress: user.emailAddress || null,
        active: user.active !== false,
        accountType: user.accountType || '',
        self: user.self || '',
    };
}

function escapeJqlString(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function buildJiraTextSearchJql(query, projectKey) {
    if (!isNonEmptyString(query)) return '';

    const clauses = [];
    if (isNonEmptyString(projectKey)) {
        clauses.push(`project = "${projectKey.trim()}"`);
    }
    clauses.push(`text ~ "\\"${escapeJqlString(query.trim())}\\""`);

    return clauses.join(' AND ');
}

function buildJiraEpicSearchJql(query, projectKey) {
    const clauses = [];

    if (isNonEmptyString(projectKey)) {
        clauses.push(`project = "${projectKey.trim()}"`);
    }

    clauses.push('issuetype = Epic');

    if (isNonEmptyString(query)) {
        clauses.push(`text ~ "\\"${escapeJqlString(query.trim())}\\""`);
    }

    return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

async function executeJiraIssueSearch(jiraConfig, { jql, maxResults, fields }) {
    const payload = {
        jql,
        maxResults,
        fields,
        fieldsByKeys: false,
    };

    let endpoint = 'enhanced-jql';
    let response = await fetch(`${jiraConfig.apiBase}/search/jql`, {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify(payload),
    });

    if (!response.ok && [404, 405, 501].includes(response.status)) {
        endpoint = 'legacy-search-fallback';
        response = await fetch(`${jiraConfig.apiBase}/search`, {
            method: 'POST',
            headers: jiraConfig.headers,
            body: JSON.stringify(payload),
        });
    }

    if (!response.ok) {
        const rawBody = await response.text();
        return {
            success: false,
            endpoint,
            status: response.status,
            payload,
            formattedError: formatJiraErrorResponse('Issue search failed', response.status, rawBody),
        };
    }

    return {
        success: true,
        endpoint,
        payload,
        data: await response.json(),
    };
}

function formatJiraSearchIssue(issue) {
    const reference = formatJiraIssueReference(issue);
    if (!reference?.key) return null;

    const fields = issue.fields || {};
    return {
        ...reference,
        assignee: normalizeJiraUser(fields.assignee),
        reporter: normalizeJiraUser(fields.reporter),
        labels: Array.isArray(fields.labels) ? fields.labels.filter(Boolean) : [],
        created: fields.created || '',
        updated: fields.updated || '',
    };
}

function formatJiraIssueReference(issue) {
    if (!issue || typeof issue !== 'object') return null;

    const fields = issue.fields || {};
    return {
        id: issue.id || '',
        key: issue.key || '',
        self: issue.self || '',
        summary: fields.summary || '',
        status: fields.status?.name || '',
        issueType: fields.issuetype?.name || '',
        priority: fields.priority?.name || '',
    };
}

function formatJiraSubtasks(fields) {
    const subtasks = fields.subtasks || fields['sub-tasks'] || [];
    if (!Array.isArray(subtasks)) return [];
    return subtasks.map(formatJiraIssueReference).filter(subtask => subtask?.key);
}

function formatJiraIssueLinks(fields) {
    if (!Array.isArray(fields.issuelinks)) return [];

    return fields.issuelinks
        .map(link => {
            const inwardIssue = formatJiraIssueReference(link.inwardIssue);
            const outwardIssue = formatJiraIssueReference(link.outwardIssue);
            const relatedIssue = inwardIssue || outwardIssue;

            if (!relatedIssue?.key) return null;

            return {
                id: link.id || '',
                type: {
                    id: link.type?.id || '',
                    name: link.type?.name || '',
                    inward: link.type?.inward || '',
                    outward: link.type?.outward || '',
                },
                direction: inwardIssue ? 'inward' : 'outward',
                relatedIssueKey: relatedIssue.key,
                relatedIssue,
            };
        })
        .filter(Boolean);
}

function formatJiraEpicRelationship(fields) {
    const parentReference = formatJiraIssueReference(fields.parent);
    if (parentReference?.issueType === 'Epic') {
        return parentReference;
    }

    return null;
}

function formatJiraEpicSearchResult(issue, jiraConfig) {
    const epic = formatJiraSearchIssue(issue);
    if (!epic?.key) return null;

    return {
        id: epic.id,
        key: epic.key,
        name: epic.summary,
        summary: epic.summary,
        status: epic.status,
        issueType: epic.issueType,
        priority: epic.priority,
        assignee: epic.assignee,
        reporter: epic.reporter,
        labels: epic.labels,
        created: epic.created,
        updated: epic.updated,
        ticketUrl: buildJiraBrowseUrl(jiraConfig, epic.key),
    };
}

function formatJiraEpicDetails(issueData, jiraConfig, agileEpic = null, explicitTicketId = '') {
    const epicKey = agileEpic?.key || issueData?.key || explicitTicketId || '';
    const fields = issueData?.fields || {};
    const labels = Array.isArray(fields.labels) ? fields.labels.filter(Boolean) : [];
    const components = Array.isArray(fields.components)
        ? fields.components.map(component => component?.name || '').filter(Boolean)
        : [];
    const description = typeof issueData?.renderedFields?.description === 'string'
        ? issueData.renderedFields.description
        : (typeof fields.description === 'string' ? fields.description : '');

    return {
        success: true,
        epicId: agileEpic?.id || issueData?.id || '',
        epicKey,
        name: agileEpic?.name || fields.summary || '',
        summary: agileEpic?.summary || fields.summary || '',
        issueType: fields.issuetype?.name || '',
        status: fields.status?.name || '',
        priority: fields.priority?.name || '',
        done: typeof agileEpic?.done === 'boolean' ? agileEpic.done : undefined,
        color: agileEpic?.color?.key || agileEpic?.color?.name || agileEpic?.colorName || '',
        labels,
        components,
        assignee: normalizeJiraUser(fields.assignee),
        reporter: normalizeJiraUser(fields.reporter),
        description,
        acceptanceCriteria: '',
        created: fields.created || '',
        updated: fields.updated || '',
        ticketUrl: epicKey ? buildJiraBrowseUrl(jiraConfig, epicKey) : undefined,
        sourceEndpoint: agileEpic ? 'agile-epic' : 'issue-fallback',
    };
}

function selectJiraSubtaskIssueType(issueTypes, preferredIssueType) {
    const availableSubtasks = Array.isArray(issueTypes)
        ? issueTypes.filter(issueType => issueType?.subtask)
        : [];

    if (availableSubtasks.length === 0) {
        return { selected: null, availableSubtasks: [] };
    }

    const normalizedPreference = isNonEmptyString(preferredIssueType)
        ? preferredIssueType.trim().toLowerCase()
        : '';

    if (normalizedPreference) {
        const exactMatch = availableSubtasks.find(issueType => {
            const name = String(issueType.name || '').trim().toLowerCase();
            const id = String(issueType.id || '').trim().toLowerCase();
            return name === normalizedPreference || id === normalizedPreference;
        }) || null;

        return { selected: exactMatch, availableSubtasks };
    }

    const defaultMatch = availableSubtasks.find(issueType => String(issueType.name || '').trim().toLowerCase() === 'sub-task')
        || availableSubtasks[0]
        || null;

    return { selected: defaultMatch, availableSubtasks };
}

async function fetchJiraCreateIssueTypes(jiraConfig, projectKey) {
    const url = `${jiraConfig.apiBase}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`;
    const response = await fetch(url, {
        method: 'GET',
        headers: jiraConfig.headers,
    });

    if (!response.ok) {
        return {
            issueTypes: [],
            error: `Failed to fetch issue types for project ${projectKey}: HTTP ${response.status}`,
            details: await response.text(),
        };
    }

    const data = await response.json();
    return {
        issueTypes: data.issueTypes || data.values || [],
        error: null,
        details: null,
    };
}

function formatJiraDateTime(value) {
    if (isNonEmptyString(value)) return value.trim();

    const date = new Date();
    const pad = number => String(number).padStart(2, '0');

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
        + `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.000+0000`;
}

function buildJiraAttachmentUrl(ticketKey, jiraConfig) {
    if (jiraConfig.cloudId) {
        return `https://api.atlassian.com/ex/jira/${jiraConfig.cloudId}/rest/api/3/issue/${ticketKey}/attachments`;
    }
    return `${jiraConfig.baseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${ticketKey}/attachments`;
}

function sanitizeFileName(fileName) {
    return String(fileName || 'attachment')
        .replace(/[\r\n"]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildMultipartPayload(fileName, mimeType, buffer, boundaryPrefix) {
    const crypto = require('crypto');
    const boundary = `----${boundaryPrefix}${crypto.randomBytes(16).toString('hex')}`;
    const safeFileName = sanitizeFileName(fileName);
    const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

    return {
        boundary,
        body: Buffer.concat([header, buffer, footer]),
    };
}

function buildJiraAttachmentHeaders(jiraConfig, boundary) {
    return {
        'Authorization': 'Basic ' + Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64'),
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
}

module.exports = {
    getJiraAttachmentConfig,
    getJiraApiConfig,
    buildJiraIssueApiUrl,
    buildJiraAgileApiUrl,
    buildJiraBrowseUrl,
    splitCommaSeparated,
    normalizeMaxResults,
    parseJsonObjectInput,
    parseJiraErrorBody,
    buildJiraErrorHint,
    formatJiraErrorResponse,
    normalizeJiraUser,
    escapeJqlString,
    buildJiraTextSearchJql,
    buildJiraEpicSearchJql,
    executeJiraIssueSearch,
    formatJiraSearchIssue,
    formatJiraIssueReference,
    formatJiraSubtasks,
    formatJiraIssueLinks,
    formatJiraEpicRelationship,
    formatJiraEpicSearchResult,
    formatJiraEpicDetails,
    selectJiraSubtaskIssueType,
    fetchJiraCreateIssueTypes,
    formatJiraDateTime,
    buildJiraAttachmentUrl,
    sanitizeFileName,
    buildMultipartPayload,
    buildJiraAttachmentHeaders,
};
