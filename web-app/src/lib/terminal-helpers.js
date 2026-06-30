/**
 * Constants, layout helpers, and utility functions for the TerminalWorkbench.
 * Extracted from TerminalWorkbench.js to keep the component focused on rendering.
 */
import { TERMINAL_THEME_KEYS } from '@/components/TerminalXtermPane';

export const SHELL_OPTIONS = [
    { value: 'pwsh', label: 'PowerShell 7' },
    { value: 'powershell', label: 'Windows PowerShell' },
    { value: 'cmd', label: 'Command Prompt' },
    { value: 'bash', label: 'Bash' },
    { value: 'zsh', label: 'Zsh' },
];

export const TERMINAL_LAYOUT_STORAGE_KEY = 'qa-dashboard-terminal-layout-v1';

const TERMINAL_THEME_LABELS = {
    midnight: 'Midnight Blue',
    graphite: 'Graphite Slate',
    solarizedDark: 'Solarized Dark',
    highContrast: 'High Contrast',
};

export const TERMINAL_THEME_OPTIONS = TERMINAL_THEME_KEYS.map((value) => ({
    value,
    label: TERMINAL_THEME_LABELS[value] || value,
}));
export const TERMINAL_THEME_SET = new Set(TERMINAL_THEME_OPTIONS.map((option) => option.value));

export const DEFAULT_LAYOUT = {
    shell: 'pwsh',
    cwd: '',
    cols: 120,
    rows: 36,
    themePreset: 'midnight',
    fontSize: 12,
    autoScroll: true,
    paneMode: 'single',
    openSessionIds: [],
    activeSessionId: null,
    secondarySessionId: null,
    showLegacyCommandInput: false,
};

export function sessionStatusChip(status) {
    if (status === 'running') return 'state-chip state-chip-success';
    if (status === 'terminating') return 'state-chip state-chip-warning';
    if (status === 'closed') return 'state-chip state-chip-neutral';
    return 'state-chip state-chip-danger';
}

export function parseDimension(value, fallback, min, max) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

export function uniqueSessionIds(ids = []) {
    return Array.from(new Set((ids || []).filter((id) => typeof id === 'string' && id.trim())));
}

export function arraysEqual(left = [], right = []) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

export function normalizePersistedLayout(raw = {}) {
    const openSessionIds = uniqueSessionIds(Array.isArray(raw.openSessionIds) ? raw.openSessionIds : []);

    return {
        shell: typeof raw.shell === 'string' && raw.shell.trim() ? raw.shell : DEFAULT_LAYOUT.shell,
        cwd: typeof raw.cwd === 'string' ? raw.cwd : DEFAULT_LAYOUT.cwd,
        cols: parseDimension(raw.cols, DEFAULT_LAYOUT.cols, 40, 320),
        rows: parseDimension(raw.rows, DEFAULT_LAYOUT.rows, 10, 120),
        themePreset: TERMINAL_THEME_SET.has(raw.themePreset) ? raw.themePreset : DEFAULT_LAYOUT.themePreset,
        fontSize: parseDimension(raw.fontSize, DEFAULT_LAYOUT.fontSize, 10, 22),
        autoScroll: raw.autoScroll !== false,
        paneMode: raw.paneMode === 'split' ? 'split' : 'single',
        openSessionIds,
        activeSessionId: typeof raw.activeSessionId === 'string' ? raw.activeSessionId : null,
        secondarySessionId: typeof raw.secondarySessionId === 'string' ? raw.secondarySessionId : null,
        showLegacyCommandInput: raw.showLegacyCommandInput === true,
    };
}

export function buildSessionLabel(sessionId, session = {}) {
    const shortId = sessionId?.slice(0, 8) || 'unknown';
    return `${session.shell || 'shell'} | ${session.status || 'unknown'} | ${shortId}`;
}
