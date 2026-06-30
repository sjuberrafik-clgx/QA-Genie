/**
 * General utility functions.
 * Extracted from custom-tools.js
 */

const { injectMentionSyntax } = require('../adf-converter');
const { JIRA_TICKET_KEY_PATTERN } = require('./constants');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parse a mentions parameter (JSON string or array) and apply mention injection
 * to markdown text before ADF conversion. Returns the text with @[Name](accountId:xxx) syntax.
 * @param {string} text - Markdown text
 * @param {string|Array} mentionsParam - JSON string or array of {accountId, displayName}
 * @returns {string} Text with injected mention syntax
 */
function applyMentions(text, mentionsParam) {
    if (!text || !mentionsParam) return text || '';
    let mentions;
    if (typeof mentionsParam === 'string') {
        try { mentions = JSON.parse(mentionsParam); } catch { return text; }
    } else if (Array.isArray(mentionsParam)) {
        mentions = mentionsParam;
    } else {
        return text;
    }
    if (!Array.isArray(mentions) || mentions.length === 0) return text;
    return injectMentionSyntax(text, mentions);
}

function resolveActiveSessionId(explicitSessionId, deps) {
    if (isNonEmptyString(explicitSessionId)) return explicitSessionId.trim();
    if (isNonEmptyString(deps?.sessionContext?.sessionId)) return deps.sessionContext.sessionId.trim();
    return null;
}

function getActiveSessionEntry(explicitSessionId, deps) {
    const chatManager = deps?.chatManager;
    if (!chatManager) {
        return {
            error: 'Chat manager context not available. Call this tool from an active chat session.',
        };
    }

    const sessionId = resolveActiveSessionId(explicitSessionId, deps);
    if (!sessionId) {
        return {
            error: 'No active chat session could be resolved. Call this tool from the same chat session where the attachments were uploaded.',
        };
    }

    const entry = chatManager._sessions?.get(sessionId);
    if (!entry) {
        return {
            error: `Chat session not found: ${sessionId}`,
        };
    }

    return { sessionId, entry };
}

function isValidTicketKey(ticketKey) {
    return JIRA_TICKET_KEY_PATTERN.test(String(ticketKey || '').trim());
}

function getLatestUserMessageText(deps) {
    const sessionResult = getActiveSessionEntry(undefined, deps);
    if (sessionResult.error || !Array.isArray(sessionResult.entry?.messages)) {
        return '';
    }

    for (let i = sessionResult.entry.messages.length - 1; i >= 0; i--) {
        const message = sessionResult.entry.messages[i];
        if (message?.role === 'user' && isNonEmptyString(message.content)) {
            return message.content.trim();
        }
    }

    return '';
}

function getConfluenceProvider(groundingStore) {
    const connector = groundingStore?._kbConnector;
    if (!connector) return null;
    if (typeof connector.getProviderByType === 'function') {
        return connector.getProviderByType('confluence') || null;
    }
    return null;
}

function formatConfluencePage(page, options = {}) {
    if (!page || typeof page !== 'object') return page;
    const result = {
        id: page.id || undefined,
        title: page.title || undefined,
        url: page.url || undefined,
        space: page.space || undefined,
        excerpt: page.excerpt || undefined,
        lastModified: page.lastModified || undefined,
    };
    if (options.depth !== undefined) result.depth = options.depth;
    if (page.metadata) {
        result.metadata = {
            labels: page.metadata.labels || [],
            author: page.metadata.author || undefined,
            status: page.metadata.status || undefined,
            version: page.metadata.version || undefined,
            parentId: page.metadata.parentId || null,
        };
    }
    if (options.includeContent !== false && page.content) {
        const maxChars = options.contentMaxChars || 8000;
        result.content = typeof page.content === 'string' && page.content.length > maxChars
            ? page.content.slice(0, maxChars) + '...'
            : page.content;
    }
    return result;
}

function formatConfluenceSpace(space) {
    if (!space || typeof space !== 'object') return space;
    return {
        key: space.key || undefined,
        name: space.name || undefined,
        url: space.url || undefined,
        description: space.description || undefined,
    };
}

function annotateConfluenceTreeDepth(pages, rootId) {
    if (!Array.isArray(pages)) return [];
    const idToParent = new Map();
    for (const page of pages) {
        const pid = page?.metadata?.parentId || null;
        idToParent.set(String(page?.id || ''), pid ? String(pid) : null);
    }
    function getDepth(id) {
        let depth = 0;
        let current = String(id || '');
        const visited = new Set();
        while (current && current !== String(rootId) && !visited.has(current)) {
            visited.add(current);
            const parent = idToParent.get(current);
            if (!parent) break;
            depth++;
            current = parent;
        }
        return depth;
    }
    return pages.map(page => ({
        page,
        depth: getDepth(page?.id),
    }));
}

function classifyJiraTimeTrackingIntent(messageText) {
    if (!isNonEmptyString(messageText)) {
        return { intent: 'unknown', signals: [] };
    }

    const normalized = messageText.toLowerCase().replace(/\s+/g, ' ').trim();
    const signalMatchers = [
        {
            intent: 'worklog',
            label: 'time tracking phrase',
            pattern: /\btime tracking\b/,
        },
        {
            intent: 'worklog',
            label: 'worklog keyword',
            pattern: /\bworklog\b/,
        },
        {
            intent: 'worklog',
            label: 'log time keyword',
            pattern: /\blog(?:ging)?\s+(?:time|hours?|work)\b/,
        },
        {
            intent: 'worklog',
            label: 'add hours phrase',
            pattern: /\b(?:add|enter|record|book|put|track)\b[^\n.?!]{0,50}\b(?:hours?|time)\b/,
        },
        {
            intent: 'worklog',
            label: 'time spent phrase',
            pattern: /\btime spent\b/,
        },
        {
            intent: 'worklog',
            label: 'spent duration phrase',
            pattern: /\b(?:spent|spend)\b[^\n.?!]{0,20}\b\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days)\b/,
        },
        {
            intent: 'estimate',
            label: 'original estimate phrase',
            pattern: /\boriginal estimate\b/,
        },
        {
            intent: 'estimate',
            label: 'remaining estimate phrase',
            pattern: /\bremaining estimate\b/,
        },
        {
            intent: 'estimate',
            label: 'estimate update phrase',
            pattern: /\b(?:update|set|change|adjust)\b[^\n.?!]{0,20}\bestimates?\b/,
        },
        {
            intent: 'estimate',
            label: 'estimated hours phrase',
            pattern: /\bestimated hours?\b/,
        },
        {
            intent: 'estimate',
            label: 'estimate field phrase',
            pattern: /\bestimate field\b/,
        },
        {
            intent: 'estimate',
            label: 'camel-case estimate field',
            pattern: /\b(?:originalestimate|remainingestimate)\b/,
        },
    ];

    const matchedSignals = signalMatchers
        .filter(signal => signal.pattern.test(normalized))
        .map(signal => ({ intent: signal.intent, label: signal.label }));

    const hasWorklogSignal = matchedSignals.some(signal => signal.intent === 'worklog');
    const hasEstimateSignal = matchedSignals.some(signal => signal.intent === 'estimate');

    if (hasWorklogSignal && hasEstimateSignal) {
        return { intent: 'mixed', signals: matchedSignals };
    }
    if (hasWorklogSignal) {
        return { intent: 'worklog', signals: matchedSignals };
    }
    if (hasEstimateSignal) {
        return { intent: 'estimate', signals: matchedSignals };
    }

    return { intent: 'unknown', signals: [] };
}


module.exports = {
    isNonEmptyString,
    applyMentions,
    resolveActiveSessionId,
    getActiveSessionEntry,
    isValidTicketKey,
    getLatestUserMessageText,
    getConfluenceProvider,
    formatConfluencePage,
    formatConfluenceSpace,
    annotateConfluenceTreeDepth,
    classifyJiraTimeTrackingIntent,
};
