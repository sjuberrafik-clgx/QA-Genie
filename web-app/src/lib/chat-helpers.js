/**
 * Pure utility functions for the chat page — input normalization,
 * message mapping, session state checks, and session merging.
 * Extracted from app/chat/page.js to keep the component focused on rendering.
 */

const USER_INPUT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_INPUT_REQUEST_ID_RE = /^uir_[a-z0-9_\-]+$/i;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isOpaquePromptValue(value) {
    if (!isNonEmptyString(value)) return false;
    const trimmed = value.trim();
    return USER_INPUT_UUID_RE.test(trimmed) || USER_INPUT_REQUEST_ID_RE.test(trimmed);
}

function getDefaultUserInputQuestion(inputType = 'default') {
    if (inputType === 'credentials') return 'The agent needs your username and password to continue.';
    if (inputType === 'password') return 'The agent needs your password to continue.';
    if (inputType === 'confirmation') return 'The agent needs your confirmation to continue.';
    return 'The agent needs your input to continue.';
}

function normalizeUserInputRequestEvent(data = {}) {
    const nestedPayload = data.options && typeof data.options === 'object' && !Array.isArray(data.options)
        ? data.options
        : null;
    const meta = {
        ...(nestedPayload?.meta && typeof nestedPayload.meta === 'object' && !Array.isArray(nestedPayload.meta) ? nestedPayload.meta : {}),
        ...(data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {}),
    };
    const explicitType = isNonEmptyString(data.type) ? data.type : null;
    const nestedType = isNonEmptyString(nestedPayload?.type) ? nestedPayload.type : null;
    const inputType = explicitType && explicitType !== 'default'
        ? explicitType
        : (nestedType || explicitType || 'default');
    const options = Array.isArray(data.options)
        ? data.options
        : Array.isArray(nestedPayload?.options)
            ? nestedPayload.options
            : [];

    const candidates = [
        data.question,
        data.message,
        nestedPayload?.question,
        nestedPayload?.message,
    ].filter(isNonEmptyString).map(value => value.trim());

    let fallbackCandidate = '';
    let question = '';
    for (const candidate of candidates) {
        if (!fallbackCandidate) fallbackCandidate = candidate;
        if (!isOpaquePromptValue(candidate)) {
            question = candidate;
            break;
        }
    }

    if (!question) {
        question = isOpaquePromptValue(fallbackCandidate)
            ? getDefaultUserInputQuestion(inputType)
            : (fallbackCandidate || getDefaultUserInputQuestion(inputType));
    }

    return {
        requestId: data.requestId,
        question,
        options,
        type: inputType,
        meta,
        resolved: !!data.resolved,
    };
}

function hasRenderableMessageContent(message) {
    const content = message?.content || message?.data?.content || '';
    const attachments = message?.attachments || message?.data?.attachments || [];
    return (typeof content === 'string' && content.trim().length > 0)
        || (Array.isArray(attachments) && attachments.length > 0);
}

function isConversationMessage(message) {
    const role = message?.role || message?.data?.role || 'assistant';
    return role === 'user' || role === 'assistant';
}

function mapChatMessage(message) {
    const mapped = {
        role: message?.role || message?.data?.role || 'assistant',
        content: message?.content || message?.data?.content || '',
        timestamp: message?.timestamp,
    };
    const attachments = message?.attachments || message?.data?.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
        mapped.attachments = attachments;
    }
    if (message?.reasoning || message?.data?.reasoning) {
        mapped.reasoning = message.reasoning || message.data.reasoning;
    }
    return mapped;
}

function mapUserInputRequestHistory(message) {
    if (!message || message.role !== 'user_input_request' || !isNonEmptyString(message.requestId)) {
        return null;
    }

    const normalized = normalizeUserInputRequestEvent({
        requestId: message.requestId,
        question: message.content,
        options: message.options,
        type: message.type,
        meta: message.meta,
        resolved: !!message.resolved,
    });

    return {
        requestId: normalized.requestId,
        question: normalized.question,
        options: normalized.options,
        type: normalized.type,
        meta: normalized.meta,
        timestamp: message.timestamp,
        resolved: normalized.resolved,
        resolvedAnswer: null,
        auto: false,
    };
}

function hydrateChatHistory(history = []) {
    const source = Array.isArray(history) ? history : [];
    const userInputRequestsById = new Map();

    for (const item of source) {
        if (item?.role === 'user_input_request') {
            const request = mapUserInputRequestHistory(item);
            if (request) userInputRequestsById.set(request.requestId, request);
            continue;
        }

        if (item?.role === 'user_input_response' && isNonEmptyString(item.requestId)) {
            const existing = userInputRequestsById.get(item.requestId);
            if (existing) {
                userInputRequestsById.set(item.requestId, {
                    ...existing,
                    resolved: true,
                    resolvedAnswer: item.content,
                    auto: !!item.auto,
                });
            }
        }
    }

    return {
        messages: source
            .filter(isConversationMessage)
            .filter(hasRenderableMessageContent)
            .map(mapChatMessage),
        userInputRequests: Array.from(userInputRequestsById.values()),
    };
}

function needsSessionResume(session) {
    return session?.runtimeState === 'resume_required'
        || session?.runtimeState === 'recovering'
        || session?.runtimeState === 'failed';
}

function isSessionBooting(session) {
    return session?.runtimeState === 'initializing'
        || session?.runtimeState === 'queued';
}

function sortSessionsByRecency(nextSessions = []) {
    return [...nextSessions].sort((a, b) => new Date(b.lastActivityAt || b.createdAt) - new Date(a.lastActivityAt || a.createdAt));
}

function mergeSessionSnapshots(previousSessions = [], incomingSessions = []) {
    const previousById = new Map(previousSessions.map(session => [session.sessionId, session]));
    const merged = incomingSessions.map(session => ({
        ...(previousById.get(session.sessionId) || {}),
        ...session,
    }));
    return sortSessionsByRecency(merged);
}

export {
    isNonEmptyString,
    isOpaquePromptValue,
    getDefaultUserInputQuestion,
    normalizeUserInputRequestEvent,
    hydrateChatHistory,
    hasRenderableMessageContent,
    isConversationMessage,
    mapChatMessage,
    mapUserInputRequestHistory,
    needsSessionResume,
    isSessionBooting,
    sortSessionsByRecency,
    mergeSessionSnapshots,
};
