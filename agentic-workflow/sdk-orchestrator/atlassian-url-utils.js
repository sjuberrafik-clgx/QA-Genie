const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const JIRA_TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function cleanCandidateUrl(url) {
    return String(url || '').trim().replace(/[)>.,;!?]+$/g, '');
}

function extractUrls(text) {
    if (!isNonEmptyString(text)) return [];
    return [...new Set((text.match(URL_PATTERN) || []).map(cleanCandidateUrl).filter(Boolean))];
}

function parseAtlassianUrl(rawUrl) {
    if (!isNonEmptyString(rawUrl)) return null;

    let parsed;
    try {
        parsed = new URL(cleanCandidateUrl(rawUrl));
    } catch {
        return null;
    }

    const pathname = parsed.pathname || '';
    const normalizedUrl = parsed.toString();

    const jiraMatch = pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)(?:\/)?$/i);
    if (jiraMatch) {
        return {
            product: 'jira',
            type: 'issue',
            url: normalizedUrl,
            issueKey: jiraMatch[1].toUpperCase(),
            baseUrl: `${parsed.protocol}//${parsed.host}`,
        };
    }

    const confluencePathMatch = pathname.match(/\/wiki\/spaces\/([^/]+)\/pages\/([0-9]+)(?:\/([^?#]+))?/i);
    if (confluencePathMatch) {
        return {
            product: 'confluence',
            type: 'page',
            url: normalizedUrl,
            pageId: confluencePathMatch[2],
            spaceKey: confluencePathMatch[1],
            titleSlug: confluencePathMatch[3] ? decodeURIComponent(confluencePathMatch[3]).replace(/\+/g, ' ') : '',
            baseUrl: `${parsed.protocol}//${parsed.host}/wiki`,
        };
    }

    if (/\/wiki\//i.test(pathname)) {
        const pageId = parsed.searchParams.get('pageId');
        if (/^\d+$/.test(pageId || '')) {
            return {
                product: 'confluence',
                type: 'page',
                url: normalizedUrl,
                pageId,
                spaceKey: parsed.searchParams.get('spaceKey') || '',
                titleSlug: '',
                baseUrl: `${parsed.protocol}//${parsed.host}/wiki`,
            };
        }
    }

    return null;
}

function extractAtlassianUrlContext(text) {
    const atlassianUrls = extractUrls(text)
        .map(parseAtlassianUrl)
        .filter(Boolean);

    return {
        atlassianUrls,
        jiraIssues: atlassianUrls.filter(item => item.product === 'jira' && item.type === 'issue'),
        confluencePages: atlassianUrls.filter(item => item.product === 'confluence' && item.type === 'page'),
        primary: atlassianUrls[0] || null,
    };
}

function findJiraTicketKey(text) {
    if (!isNonEmptyString(text)) return null;
    const match = text.trim().match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
    return match ? match[1].toUpperCase() : null;
}

function normalizeJiraTicketInput(input, fallbackText = '') {
    const directValue = String(input || '').trim();
    if (JIRA_TICKET_KEY_PATTERN.test(directValue.toUpperCase())) {
        return {
            ticketId: directValue.toUpperCase(),
            jiraBaseUrl: null,
            source: 'ticket-key',
        };
    }

    for (const candidate of [directValue, fallbackText]) {
        const parsedContext = extractAtlassianUrlContext(candidate);
        const jiraUrl = parsedContext.jiraIssues[0];
        if (jiraUrl) {
            return {
                ticketId: jiraUrl.issueKey,
                jiraBaseUrl: jiraUrl.baseUrl,
                source: 'jira-url',
                sourceUrl: jiraUrl.url,
            };
        }

        const inlineKey = findJiraTicketKey(candidate);
        if (inlineKey) {
            return {
                ticketId: inlineKey,
                jiraBaseUrl: null,
                source: 'inline-ticket-key',
            };
        }
    }

    return {
        ticketId: null,
        jiraBaseUrl: null,
        source: 'unknown',
    };
}

function normalizeConfluencePageInput(input, fallbackText = '') {
    const directValue = String(input || '').trim();
    if (/^\d+$/.test(directValue)) {
        return {
            pageId: directValue,
            source: 'page-id',
            sourceUrl: null,
            spaceKey: '',
            baseUrl: null,
        };
    }

    for (const candidate of [directValue, fallbackText]) {
        const parsedContext = extractAtlassianUrlContext(candidate);
        const confluenceUrl = parsedContext.confluencePages[0];
        if (confluenceUrl) {
            return {
                pageId: confluenceUrl.pageId,
                source: 'confluence-url',
                sourceUrl: confluenceUrl.url,
                spaceKey: confluenceUrl.spaceKey || '',
                baseUrl: confluenceUrl.baseUrl || null,
            };
        }
    }

    return {
        pageId: null,
        source: 'unknown',
        sourceUrl: null,
        spaceKey: '',
        baseUrl: null,
    };
}

module.exports = {
    extractUrls,
    parseAtlassianUrl,
    extractAtlassianUrlContext,
    normalizeJiraTicketInput,
    normalizeConfluencePageInput,
};