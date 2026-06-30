/**
 * Jira comment formatting, visibility, and field capability helpers.
 * Extracted from custom-tools.js
 */

const { normalizeJiraText } = require('./evidence-helpers');

function normalizeJiraCommentVisibility(visibility) {
    if (!visibility || typeof visibility !== 'object') return null;

    const normalized = {
        type: visibility.type || '',
        value: visibility.value || '',
        identifier: visibility.identifier || '',
    };

    if (!normalized.type && !normalized.value && !normalized.identifier) {
        return null;
    }

    return normalized;
}

function getJiraCommentCollection(value) {
    if (Array.isArray(value)) {
        return {
            items: value,
            total: value.length,
            startAt: 0,
            maxResults: value.length,
        };
    }

    if (value && typeof value === 'object') {
        const items = Array.isArray(value.comments)
            ? value.comments
            : Array.isArray(value.values)
                ? value.values
                : [];

        return {
            items,
            total: typeof value.total === 'number' ? value.total : items.length,
            startAt: typeof value.startAt === 'number' ? value.startAt : 0,
            maxResults: typeof value.maxResults === 'number' ? value.maxResults : items.length,
        };
    }

    return {
        items: [],
        total: 0,
        startAt: 0,
        maxResults: 0,
    };
}

function buildRenderedCommentLookup(value) {
    const collection = getJiraCommentCollection(value);
    const byId = new Map();

    collection.items.forEach((item, index) => {
        const key = item?.id != null ? String(item.id) : `index:${index}`;
        byId.set(key, item);
    });

    return {
        items: collection.items,
        byId,
    };
}

function formatSingleJiraComment(comment = {}, renderedComment = null, index = 0) {
    const author = comment.author || {};
    const bodySource = renderedComment?.renderedBody || comment.renderedBody || renderedComment?.body || comment.body;
    const body = normalizeJiraText(bodySource);

    return {
        id: comment.id != null ? String(comment.id) : `comment-${index + 1}`,
        author: author.displayName || comment.displayName || '',
        body,
        created: comment.created || '',
        updated: comment.updated || '',
        visibility: normalizeJiraCommentVisibility(comment.visibility),
    };
}

function formatJiraComments(fields = {}, rendered = {}) {
    const rawCollection = getJiraCommentCollection(fields.comment);
    const renderedLookup = buildRenderedCommentLookup(rendered.comment);

    const comments = rawCollection.items.map((comment, index) => {
        const key = comment?.id != null ? String(comment.id) : `index:${index}`;
        const renderedComment = renderedLookup.byId.get(key) || renderedLookup.items[index] || null;
        return formatSingleJiraComment(comment, renderedComment, index);
    }).filter(comment => comment.body || comment.author || comment.created || comment.updated);

    const commentCount = typeof rawCollection.total === 'number' ? rawCollection.total : comments.length;
    const commentsTruncated = commentCount > comments.length;

    return {
        comments,
        commentCount,
        commentsTruncated,
    };
}

function buildJiraIssueCommentsUrl({ baseUrl, cloudId }, ticketId, params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    });

    const query = searchParams.toString();
    if (cloudId) {
        return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${ticketId}/comment${query ? `?${query}` : ''}`;
    }

    return `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${ticketId}/comment${query ? `?${query}` : ''}`;
}

async function fetchCompleteJiraComments(ticketId, { baseUrl, cloudId, headers }) {
    if (!baseUrl && !cloudId) return null;

    const allComments = [];
    let startAt = 0;
    let total = null;

    while (true) {
        const url = buildJiraIssueCommentsUrl({ baseUrl, cloudId }, ticketId, {
            startAt,
            maxResults: 100,
        });
        const response = await fetch(url, { headers });
        if (!response.ok) {
            return null;
        }

        const payload = await response.json();
        const collection = getJiraCommentCollection(payload);
        allComments.push(...collection.items);

        total = typeof collection.total === 'number' ? collection.total : allComments.length;
        if (collection.items.length === 0 || allComments.length >= total) {
            break;
        }

        startAt += collection.items.length;
    }

    return formatJiraComments({
        comment: {
            comments: allComments,
            total: total != null ? total : allComments.length,
            startAt: 0,
            maxResults: allComments.length,
        },
    });
}

function formatJiraTimetracking(fields = {}) {
    const timetracking = fields.timetracking;
    if (!timetracking || typeof timetracking !== 'object') return null;

    const formatted = {
        originalEstimate: timetracking.originalEstimate || '',
        originalEstimateSeconds: typeof timetracking.originalEstimateSeconds === 'number' ? timetracking.originalEstimateSeconds : null,
        remainingEstimate: timetracking.remainingEstimate || '',
        remainingEstimateSeconds: typeof timetracking.remainingEstimateSeconds === 'number' ? timetracking.remainingEstimateSeconds : null,
        timeSpent: timetracking.timeSpent || '',
        timeSpentSeconds: typeof timetracking.timeSpentSeconds === 'number' ? timetracking.timeSpentSeconds : null,
    };

    if (!formatted.originalEstimate && !formatted.remainingEstimate && !formatted.timeSpent
        && formatted.originalEstimateSeconds === null && formatted.remainingEstimateSeconds === null && formatted.timeSpentSeconds === null) {
        return null;
    }

    return formatted;
}

function formatJiraFieldCapability(fieldId, fieldMeta = {}) {
    const schema = fieldMeta.schema || {};

    return {
        fieldId,
        key: fieldMeta.key || fieldId,
        name: fieldMeta.name || fieldId,
        required: Boolean(fieldMeta.required),
        operations: Array.isArray(fieldMeta.operations) ? fieldMeta.operations : [],
        hasDefaultValue: Boolean(fieldMeta.hasDefaultValue),
        schemaType: schema.type || null,
        items: schema.items || null,
        custom: schema.custom || null,
        customId: typeof schema.customId === 'number' ? schema.customId : null,
        allowedValuesCount: Array.isArray(fieldMeta.allowedValues) ? fieldMeta.allowedValues.length : 0,
    };
}

function countStructuredClauses(value) {
    const text = normalizeJiraText(value);
    if (!text) return 0;

    return text
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => /^[-*•]|^\d+[.)]|^ac\b|^scenario\b|^given\b|^when\b|^then\b/i.test(line))
        .length;

}

module.exports = {
    normalizeJiraCommentVisibility,
    getJiraCommentCollection,
    buildRenderedCommentLookup,
    formatSingleJiraComment,
    formatJiraComments,
    buildJiraIssueCommentsUrl,
    fetchCompleteJiraComments,
    formatJiraTimetracking,
    formatJiraFieldCapability,
    countStructuredClauses,
};
