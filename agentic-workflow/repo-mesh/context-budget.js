/**
 * Shared response shaping for repository knowledge tools.
 * Keeps index size independent from the amount of context returned to an agent.
 */

const DEFAULT_LIMITS = Object.freeze({
    maxResults: 5,
    maxExcerptChars: 300,
    searchMaxChars: 4000,
    behaviorMaxChars: 4000,
    evidenceMaxChars: 6000,
    absoluteMaxChars: 8000,
});

function truncateText(value, maxChars) {
    const text = String(value ?? '');
    if (text.length <= maxChars) return text;
    if (maxChars <= 1) return text.slice(0, maxChars);
    return `${text.slice(0, maxChars - 1)}…`;
}

function compactValue(value, options = {}, depth = 0) {
    const maxDepth = options.maxDepth ?? 6;
    const maxArrayItems = options.maxArrayItems ?? 20;
    const maxStringChars = options.maxStringChars ?? 2000;

    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return truncateText(value, maxStringChars);
    if (depth >= maxDepth) return '[omitted: depth limit]';
    if (Array.isArray(value)) {
        return value.slice(0, maxArrayItems).map((item) => compactValue(item, options, depth + 1));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            compactValue(item, options, depth + 1),
        ]));
    }
    return String(value);
}

function serializedLength(value) {
    return JSON.stringify(value).length;
}

function buildEnvelope(payload, metadata) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return { ...payload, context: metadata };
    }
    return { data: payload, context: metadata };
}

function fallbackEnvelope(payload, metadata, maxChars) {
    const success = !(payload && typeof payload === 'object' && payload.success === false);
    const base = {
        success,
        context: { ...metadata, truncated: true },
        preview: '',
    };
    const overhead = serializedLength(base);
    const previewBudget = Math.max(0, maxChars - overhead - 2);
    base.preview = truncateText(JSON.stringify(payload), previewBudget);

    while (serializedLength(base) > maxChars && base.preview.length > 0) {
        base.preview = base.preview.slice(0, -1);
    }
    return base;
}

/**
 * Return a JSON-safe object that cannot exceed the configured response ceiling.
 */
function boundResponse(payload, options = {}) {
    const absoluteMax = options.absoluteMaxChars ?? DEFAULT_LIMITS.absoluteMaxChars;
    const requestedMax = options.maxChars ?? absoluteMax;
    const maxChars = Math.max(256, Math.min(requestedMax, absoluteMax));
    const metadata = {
        resolution: options.resolution || 'L2',
        truncated: false,
        continuation: options.continuation || null,
        maxChars,
    };

    const strategies = [
        { maxDepth: 6, maxArrayItems: 20, maxStringChars: 2000 },
        { maxDepth: 5, maxArrayItems: 10, maxStringChars: 800 },
        { maxDepth: 4, maxArrayItems: 5, maxStringChars: 300 },
    ];

    for (let index = 0; index < strategies.length; index++) {
        const compacted = compactValue(payload, strategies[index]);
        const envelope = buildEnvelope(compacted, {
            ...metadata,
            truncated: index > 0,
        });
        if (serializedLength(envelope) <= maxChars) return envelope;
    }

    return fallbackEnvelope(payload, metadata, maxChars);
}

module.exports = {
    DEFAULT_LIMITS,
    boundResponse,
    compactValue,
    serializedLength,
    truncateText,
};