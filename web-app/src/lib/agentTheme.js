/**
 * Per-agent visual theme — single source of truth for chat-bubble accents,
 * avatar tint, agent ribbon color, and any per-agent UI decoration.
 *
 * Keep this in sync with the `value` field in `agent-options.js`. Values are
 * raw hex (not Tailwind utilities) because they get used inline as CSS
 * variables — Tailwind utilities would require a known-at-build-time class
 * which doesn't compose well with dynamic agent ids.
 */

const THEMES = {
    tpm: {
        id: 'tpm',
        label: 'TPM',
        accent: '#7c3aed',      // violet-600
        accentSoft: '#ede9fe',  // violet-100
        accentText: '#5b21b6',  // violet-800
        gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    },
    testgenie: {
        id: 'testgenie',
        label: 'TestGenie',
        accent: '#2563eb',
        accentSoft: '#dbeafe',
        accentText: '#1d4ed8',
        gradient: 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
    },
    scriptgenerator: {
        id: 'scriptgenerator',
        label: 'ScriptGenie',
        accent: '#059669',
        accentSoft: '#d1fae5',
        accentText: '#047857',
        gradient: 'linear-gradient(135deg, #10b981, #059669)',
    },
    buggenie: {
        id: 'buggenie',
        label: 'BugGenie',
        accent: '#dc2626',
        accentSoft: '#fee2e2',
        accentText: '#991b1b',
        gradient: 'linear-gradient(135deg, #ef4444, #db2777)',
    },
    taskgenie: {
        id: 'taskgenie',
        label: 'TaskGenie',
        accent: '#d97706',
        accentSoft: '#fef3c7',
        accentText: '#92400e',
        gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    },
    filegenie: {
        id: 'filegenie',
        label: 'FileGenie',
        accent: '#0891b2',
        accentSoft: '#cffafe',
        accentText: '#155e75',
        gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    },
    docgenie: {
        id: 'docgenie',
        label: 'DocGenie',
        accent: '#4f46e5',
        accentSoft: '#e0e7ff',
        accentText: '#3730a3',
        gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    },
};

const DEFAULT_THEME = {
    id: 'default',
    label: 'AI Assistant',
    accent: '#1c8090',
    accentSoft: '#e0f2f4',
    accentText: '#155864',
    gradient: 'linear-gradient(135deg, #1c8090, #0ea5b7)',
};

/**
 * Normalize an arbitrary agent identifier (e.g. `core:testgenie:default`,
 * `testgenie`, `BugGenie`) down to the base agent value used in `THEMES`.
 */
export function normalizeAgentKey(agentId) {
    if (!agentId) return null;
    const raw = String(agentId).toLowerCase();
    // Strip well-known prefixes used by buildCoreAgentId
    const stripped = raw.replace(/^(core|custom|user|workspace):/i, '').split(':')[0];
    // Match against known keys
    if (THEMES[stripped]) return stripped;
    // Fallback heuristics on label
    if (/test\s*genie|^tg$/.test(stripped)) return 'testgenie';
    if (/script\s*genie|^sg$/.test(stripped)) return 'scriptgenerator';
    if (/bug\s*genie|^bg$/.test(stripped)) return 'buggenie';
    if (/task\s*genie|^tk$/.test(stripped)) return 'taskgenie';
    if (/file\s*genie|^fg$/.test(stripped)) return 'filegenie';
    if (/doc\s*genie|^dg$/.test(stripped)) return 'docgenie';
    if (/tpm/.test(stripped)) return 'tpm';
    return null;
}

/**
 * Get the visual theme for an agent. Always returns a valid theme — falls
 * back to the brand-teal default when the agent is unknown.
 */
export function getAgentTheme(agentIdOrConfig) {
    if (!agentIdOrConfig) return DEFAULT_THEME;
    // Accept either a raw id string or an agent config object
    if (typeof agentIdOrConfig === 'object') {
        const cfg = agentIdOrConfig;
        const fromId = normalizeAgentKey(cfg.id || cfg.agentMode || cfg.value);
        if (fromId && THEMES[fromId]) {
            return { ...THEMES[fromId], label: cfg.label || THEMES[fromId].label };
        }
        // Custom agents — use brand default but keep their label
        if (cfg.label) return { ...DEFAULT_THEME, id: cfg.id || 'custom', label: cfg.label };
        return DEFAULT_THEME;
    }
    const key = normalizeAgentKey(agentIdOrConfig);
    return (key && THEMES[key]) || DEFAULT_THEME;
}

/**
 * Compute CSS variables for inline `style={...}` — keeps Tailwind safe-list small.
 */
export function getAgentThemeCssVars(agentIdOrConfig) {
    const t = getAgentTheme(agentIdOrConfig);
    return {
        '--agent-accent': t.accent,
        '--agent-accent-soft': t.accentSoft,
        '--agent-accent-text': t.accentText,
        '--agent-gradient': t.gradient,
    };
}
