/**
 * AI Model Options — Shared constants for model selection dropdowns.
 * Single source of truth used by Dashboard and Chat pages.
 */

export const MODEL_GROUPS = [
    {
        group: 'OpenAI',
        models: [
            { value: 'gpt-4.1', label: 'GPT-4.1' },
            { value: 'gpt-4o', label: 'GPT-4o' },
            { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
            { value: 'gpt-5', label: 'GPT-5' },
            { value: 'gpt-5-codex', label: 'GPT-5-Codex (Preview)' },
            { value: 'gpt-5.1', label: 'GPT-5.1' },
            { value: 'gpt-5.1-codex', label: 'GPT-5.1-Codex' },
            { value: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max' },
            { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini (Preview)' },
            { value: 'gpt-5.2', label: 'GPT-5.2' },
            { value: 'o3-mini', label: 'o3-mini' },
        ],
    },
    {
        group: 'Anthropic',
        models: [
            { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
            { value: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
            { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
            { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
            { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
        ],
    },
    {
        group: 'Google',
        models: [
            { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { value: 'gemini-3-flash', label: 'Gemini 3 Flash (Preview)' },
            { value: 'gemini-3-pro', label: 'Gemini 3 Pro (Preview)' },
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
