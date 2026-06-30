/**
 * Session Title Utilities — Normalization, validation, and derivation of session titles.
 * @module sdk-orchestrator/chat-utils/session-title-utils
 */

const {
    isNonEmptyString,
    SESSION_TITLE_MAX_LENGTH,
    SESSION_TITLE_TRUNCATED_LENGTH,
    GENERIC_SESSION_TITLES,
    USER_INPUT_UUID_RE,
} = require('./chat-constants');

function normalizeSessionTitleText(value) {
    if (!isNonEmptyString(value)) return '';

    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_~>#-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripSessionTitleLeadIn(value) {
    if (!isNonEmptyString(value)) return '';

    const leadInPatterns = [
        /^please\s+/i,
        /^can you\s+/i,
        /^could you\s+/i,
        /^would you\s+/i,
        /^i need (?:you )?to\s+/i,
        /^help me\s+/i,
        /^let'?s\s+/i,
    ];

    let result = value.trim();
    for (const pattern of leadInPatterns) {
        result = result.replace(pattern, '');
    }
    return result.trim();
}

function truncateSessionTitle(value, max = SESSION_TITLE_MAX_LENGTH) {
    if (!isNonEmptyString(value) || value.length <= max) return value || '';

    const candidate = value.substring(0, SESSION_TITLE_TRUNCATED_LENGTH);
    const lastSpace = candidate.lastIndexOf(' ');
    const trimmed = lastSpace >= 32 ? candidate.substring(0, lastSpace) : candidate;
    return `${trimmed.trim()}...`;
}

function capitalizeSessionTitle(value) {
    if (!isNonEmptyString(value)) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUuidLikeTitle(value) {
    if (!isNonEmptyString(value)) return false;
    return USER_INPUT_UUID_RE.test(value.trim());
}

function isFallbackSessionTitle(value) {
    if (!isNonEmptyString(value)) return true;

    const normalized = value.trim().toLowerCase();
    if (GENERIC_SESSION_TITLES.has(normalized)) return true;
    if (isUuidLikeTitle(normalized)) return true;
    if (/^(chat|session)\s+[0-9a-f]{6,}$/i.test(normalized)) return true;
    return normalized.length < 4;
}

function buildSessionTitleCandidate(content) {
    const normalized = normalizeSessionTitleText(content);
    if (!normalized) return '';

    const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
    const stripped = stripSessionTitleLeadIn(firstSentence) || stripSessionTitleLeadIn(normalized) || normalized;
    const title = capitalizeSessionTitle(truncateSessionTitle(stripped));
    return title;
}

module.exports = {
    normalizeSessionTitleText,
    stripSessionTitleLeadIn,
    truncateSessionTitle,
    capitalizeSessionTitle,
    isUuidLikeTitle,
    isFallbackSessionTitle,
    buildSessionTitleCandidate,
};
