const FALLBACK_MODEL_GROUPS = [
    {
        group: 'OpenAI',
        models: [
            { value: 'gpt-4.1', label: 'GPT-4.1', vision: true },
            { value: 'gpt-4o', label: 'GPT-4o', vision: true },
            { value: 'gpt-5-mini', label: 'GPT-5 Mini', vision: true },
            { value: 'gpt-5', label: 'GPT-5', vision: true },
            { value: 'gpt-5-codex', label: 'GPT-5-Codex (Preview)', vision: false },
            { value: 'gpt-5.1', label: 'GPT-5.1', vision: true },
            { value: 'gpt-5.1-codex', label: 'GPT-5.1-Codex', vision: false },
            { value: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max', vision: false },
            { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini (Preview)', vision: false },
            { value: 'gpt-5.2', label: 'GPT-5.2', vision: true },
            { value: 'gpt-5.3', label: 'GPT-5.3', vision: true },
            { value: 'gpt-5.4', label: 'GPT-5.4', vision: true },
            { value: 'o3-mini', label: 'o3-mini', vision: false },
        ],
    },
    {
        group: 'Anthropic',
        models: [
            { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', vision: false },
            { value: 'claude-opus-4.5', label: 'Claude Opus 4.5', vision: true },
            { value: 'claude-opus-4.6', label: 'Claude Opus 4.6', vision: true },
            { value: 'claude-sonnet-4', label: 'Claude Sonnet 4', vision: true },
            { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', vision: true },
        ],
    },
    {
        group: 'Google',
        models: [
            { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', vision: true },
            { value: 'gemini-3-flash', label: 'Gemini 3 Flash (Preview)', vision: true },
            { value: 'gemini-3-pro', label: 'Gemini 3 Pro (Preview)', vision: true },
        ],
    },
];

const GROUP_PRIORITY = ['OpenAI', 'Anthropic', 'Google'];
const UNAVAILABLE_REASON = 'Not advertised by the current Copilot runtime.';

function cloneModelGroups(groups = FALLBACK_MODEL_GROUPS, overrides = {}) {
    return groups.map(group => ({
        group: group.group,
        models: (group.models || []).map(model => ({
            ...model,
            ...overrides,
        })),
    }));
}

function flattenModelGroups(groups = FALLBACK_MODEL_GROUPS) {
    return groups.flatMap(group => group.models || []);
}

function hasModelValue(value, groups = FALLBACK_MODEL_GROUPS) {
    return flattenModelGroups(groups).some(model => model.value === value);
}

function getAvailableModels(groups = FALLBACK_MODEL_GROUPS) {
    return flattenModelGroups(groups).filter(model => model.available !== false);
}

function getDefaultModel(groups = FALLBACK_MODEL_GROUPS, preferredModel = 'gpt-4o') {
    if (preferredModel && getAvailableModels(groups).some(model => model.value === preferredModel)) {
        return preferredModel;
    }

    return getAvailableModels(groups)[0]?.value
        || flattenModelGroups(groups)[0]?.value
        || preferredModel
        || 'gpt-4o';
}

function inferGroup(modelId = '', raw = {}) {
    const explicit = raw.group || raw.vendor || raw.provider || raw.family;
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

    const value = String(modelId).toLowerCase();
    if (value.startsWith('gpt') || value.startsWith('o1') || value.startsWith('o3')) return 'OpenAI';
    if (value.startsWith('claude')) return 'Anthropic';
    if (value.startsWith('gemini')) return 'Google';
    return 'Other';
}

function humanizeToken(token) {
    if (/^gpt$/i.test(token)) return 'GPT';
    if (/^o\d+/i.test(token)) return token.toLowerCase();
    if (/^claude$/i.test(token)) return 'Claude';
    if (/^gemini$/i.test(token)) return 'Gemini';
    if (/^codex$/i.test(token)) return 'Codex';
    if (/^mini$/i.test(token)) return 'Mini';
    if (/^max$/i.test(token)) return 'Max';
    if (/^flash$/i.test(token)) return 'Flash';
    if (/^pro$/i.test(token)) return 'Pro';
    if (/^preview$/i.test(token)) return '(Preview)';
    return token.length <= 3 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1);
}

function formatLabel(modelId) {
    const parts = String(modelId)
        .split(/[-_]/)
        .filter(Boolean)
        .map(humanizeToken);

    return parts
        .join(' ')
        .replace(/\s+\(Preview\)$/i, ' (Preview)')
        .replace(/\s+/g, ' ')
        .trim() || String(modelId);
}

function inferVisionSupport(modelId = '', raw = {}) {
    const direct = [
        raw.vision,
        raw.isVision,
        raw.supportsVision,
        raw.supportsImages,
        raw.multimodal,
        raw.image,
        raw.imageInput,
        raw.capabilities?.vision,
        raw.capabilities?.image,
        raw.capabilities?.images,
        raw.capabilities?.multimodal,
    ].find(value => typeof value === 'boolean');

    if (typeof direct === 'boolean') return direct;

    const value = String(modelId).toLowerCase();
    if (value.includes('codex')) return false;
    if (value.includes('o3-mini') || value.includes('haiku')) return false;
    if (value.startsWith('gpt-4') || value.startsWith('gpt-5') || value.startsWith('claude-sonnet') || value.startsWith('claude-opus') || value.startsWith('gemini')) {
        return true;
    }

    return true;
}

function normalizeModelEntry(raw) {
    if (typeof raw === 'string') {
        return {
            value: raw,
            label: formatLabel(raw),
            group: inferGroup(raw),
            vision: inferVisionSupport(raw),
            available: true,
        };
    }

    const value = raw?.id || raw?.name || raw?.model || raw?.slug || raw?.value;
    if (!value) return null;

    return {
        value,
        label: raw.displayName || raw.label || raw.title || formatLabel(value),
        group: inferGroup(value, raw),
        vision: inferVisionSupport(value, raw),
        available: true,
    };
}

function mergeKnownAndDiscoveredModels(discoveredModels) {
    const discoveredByValue = new Map(
        discoveredModels.map(model => [model.value, model])
    );

    const merged = FALLBACK_MODEL_GROUPS.flatMap(group =>
        (group.models || []).map(model => {
            const discovered = discoveredByValue.get(model.value);
            if (discovered) {
                discoveredByValue.delete(model.value);
                return {
                    ...model,
                    ...discovered,
                    group: discovered.group || group.group,
                    available: true,
                };
            }

            return {
                ...model,
                group: group.group,
                available: false,
                availabilityReason: UNAVAILABLE_REASON,
            };
        })
    );

    for (const model of discoveredByValue.values()) {
        merged.push({
            ...model,
            available: true,
        });
    }

    return merged;
}

function groupModels(models) {
    const grouped = new Map();

    for (const model of models) {
        if (!grouped.has(model.group)) grouped.set(model.group, []);
        grouped.get(model.group).push({
            value: model.value,
            label: model.label,
            vision: model.vision,
            available: model.available !== false,
            ...(model.availabilityReason ? { availabilityReason: model.availabilityReason } : {}),
        });
    }

    return Array.from(grouped.entries())
        .sort(([left], [right]) => {
            const leftIndex = GROUP_PRIORITY.indexOf(left);
            const rightIndex = GROUP_PRIORITY.indexOf(right);
            if (leftIndex !== -1 || rightIndex !== -1) {
                return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
                    - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
            }
            return left.localeCompare(right);
        })
        .map(([group, entries]) => ({
            group,
            models: entries.sort((left, right) => left.label.localeCompare(right.label)),
        }));
}

function buildModelCatalog(rawModels, options = {}) {
    const warnings = [...(options.warnings || [])];
    const normalized = (rawModels || [])
        .map(normalizeModelEntry)
        .filter(Boolean);

    const groups = normalized.length > 0
        ? groupModels(mergeKnownAndDiscoveredModels(normalized))
        : cloneModelGroups(FALLBACK_MODEL_GROUPS, { available: true });

    if (normalized.length === 0 && !warnings.includes('Model discovery unavailable; using fallback catalog.')) {
        warnings.push('Model discovery unavailable; using fallback catalog.');
    }

    const flatModels = flattenModelGroups(groups);
    const availableModels = getAvailableModels(groups);
    const configuredDefaultModel = options.configuredDefaultModel || 'gpt-4o';

    return {
        groups,
        models: flatModels,
        availableModels,
        source: normalized.length > 0 ? 'sdk-discovered' : 'fallback',
        warnings,
        configuredDefaultModel,
        defaultModel: getDefaultModel(groups, configuredDefaultModel),
        defaultModelSource: options.defaultModelSource || 'unknown',
        lastUpdated: options.lastUpdated || new Date().toISOString(),
        ready: normalized.length > 0,
    };
}

module.exports = {
    FALLBACK_MODEL_GROUPS,
    flattenModelGroups,
    getAvailableModels,
    hasModelValue,
    getDefaultModel,
    buildModelCatalog,
};