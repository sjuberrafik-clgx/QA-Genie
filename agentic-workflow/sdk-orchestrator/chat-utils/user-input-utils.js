/**
 * User Input Utilities — Normalization and validation of user-input request payloads.
 * @module sdk-orchestrator/chat-utils/user-input-utils
 */

const {
    isNonEmptyString,
    USER_INPUT_UUID_RE,
    USER_INPUT_REQUEST_ID_RE,
} = require('./chat-constants');

function isOpaqueUserInputValue(value) {
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

function normalizeUserInputRequestPayload(rawRequest, fallbackType = 'default') {
    const requestObject = rawRequest && typeof rawRequest === 'object' && !Array.isArray(rawRequest)
        ? rawRequest
        : {};
    const nestedPayload = requestObject.options && typeof requestObject.options === 'object' && !Array.isArray(requestObject.options)
        ? requestObject.options
        : null;

    const explicitType = [
        requestObject.type,
        requestObject.meta?.type,
        requestObject.meta?.inputType,
    ].find(isNonEmptyString) || null;
    const nestedType = [
        nestedPayload?.type,
        nestedPayload?.meta?.type,
    ].find(isNonEmptyString) || null;
    const inputType = explicitType && explicitType !== 'default'
        ? explicitType
        : (nestedType || explicitType || fallbackType || 'default');

    const rawOptions = Array.isArray(requestObject.options)
        ? requestObject.options
        : Array.isArray(nestedPayload?.options)
            ? nestedPayload.options
            : [];

    const rawMeta = {
        ...(nestedPayload?.meta && typeof nestedPayload.meta === 'object' ? nestedPayload.meta : {}),
        ...(requestObject.meta && typeof requestObject.meta === 'object' ? requestObject.meta : {}),
        type: inputType,
    };

    const candidates = [
        typeof rawRequest === 'string' ? rawRequest : null,
        requestObject.question,
        requestObject.message,
        requestObject.content,
        requestObject.prompt,
        nestedPayload?.question,
        nestedPayload?.message,
        nestedPayload?.content,
        nestedPayload?.prompt,
    ].filter(isNonEmptyString).map(value => value.trim());

    let fallbackCandidate = '';
    let question = '';
    for (const candidate of candidates) {
        if (!fallbackCandidate) fallbackCandidate = candidate;
        if (!isOpaqueUserInputValue(candidate)) {
            question = candidate;
            break;
        }
    }

    if (!question) {
        question = isOpaqueUserInputValue(fallbackCandidate)
            ? getDefaultUserInputQuestion(inputType)
            : (fallbackCandidate || getDefaultUserInputQuestion(inputType));
    }

    return {
        question,
        options: rawOptions,
        type: inputType,
        meta: rawMeta,
        usedFallbackQuestion: question === getDefaultUserInputQuestion(inputType),
        nestedPayloadDetected: !!nestedPayload,
    };
}

function normalizeUserInputHistoryMessage(message) {
    if (!message || message.role !== 'user_input_request') return message;

    const normalized = normalizeUserInputRequestPayload({
        content: message.content,
        options: message.options,
        type: message.type,
        meta: message.meta,
    }, message.type || 'default');

    return {
        ...message,
        content: normalized.question,
        options: normalized.options,
        type: normalized.type,
        meta: normalized.meta,
    };
}

module.exports = {
    isOpaqueUserInputValue,
    getDefaultUserInputQuestion,
    normalizeUserInputRequestPayload,
    normalizeUserInputHistoryMessage,
};
