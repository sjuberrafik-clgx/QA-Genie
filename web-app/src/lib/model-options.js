/**
 * AI Model Options — Shared constants for model selection dropdowns.
 * Single source of truth used by Dashboard and Chat pages.
 */

export const MODEL_GROUPS = [
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

/**
 * Flat list of all models for quick lookup.
 */
export const ALL_MODELS = MODEL_GROUPS.flatMap(g => g.models);

/**
 * Get display label for a model value.
 */
export function getModelLabel(value) {
    const model = ALL_MODELS.find(m => m.value === value);
    return model?.label || value;
}

export const DEFAULT_MODEL = 'gpt-4o';

/**
 * Check if a model supports vision/image input.
 */
export function isVisionModel(value) {
    const model = ALL_MODELS.find(m => m.value === value);
    return model?.vision ?? true; // default true for unknown models (safe assumption)
}
