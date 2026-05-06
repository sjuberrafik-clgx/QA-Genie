'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RefreshButton from '@/components/RefreshButton';
import useTerminalSession from '@/hooks/useTerminalSession';
import TerminalXtermPane, { TERMINAL_THEME_KEYS } from '@/components/TerminalXtermPane';
import { ClockIcon } from '@/components/Icons';

const SHELL_OPTIONS = [
    { value: 'pwsh', label: 'PowerShell 7' },
    { value: 'powershell', label: 'Windows PowerShell' },
    { value: 'cmd', label: 'Command Prompt' },
    { value: 'bash', label: 'Bash' },
    { value: 'zsh', label: 'Zsh' },
];

const TERMINAL_LAYOUT_STORAGE_KEY = 'qa-dashboard-terminal-layout-v1';

const TERMINAL_THEME_LABELS = {
    midnight: 'Midnight Blue',
    graphite: 'Graphite Slate',
    solarizedDark: 'Solarized Dark',
    highContrast: 'High Contrast',
};

const TERMINAL_THEME_OPTIONS = TERMINAL_THEME_KEYS.map((value) => ({
    value,
    label: TERMINAL_THEME_LABELS[value] || value,
}));
const TERMINAL_THEME_SET = new Set(TERMINAL_THEME_OPTIONS.map((option) => option.value));

const DEFAULT_LAYOUT = {
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

function sessionStatusChip(status) {
    if (status === 'running') return 'state-chip state-chip-success';
    if (status === 'terminating') return 'state-chip state-chip-warning';
    if (status === 'closed') return 'state-chip state-chip-neutral';
    return 'state-chip state-chip-danger';
}

function parseDimension(value, fallback, min, max) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function uniqueSessionIds(ids = []) {
    return Array.from(new Set((ids || []).filter((id) => typeof id === 'string' && id.trim())));
}

function arraysEqual(left = [], right = []) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function normalizePersistedLayout(raw = {}) {
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

function buildSessionLabel(sessionId, session = {}) {
    const shortId = sessionId?.slice(0, 8) || 'unknown';
    return `${session.shell || 'shell'} | ${session.status || 'unknown'} | ${shortId}`;
}

export default function TerminalWorkbench() {
    const {
        sessions,
        sessionSnapshots,
        eventsBySession,
        loadingBySession,
        creating,
        sendingBySession,
        wsStatusBySession,
        retriesBySession,
        error,
        setError,
        refreshSessions,
        loadSession,
        resumeSessions,
        createSession,
        sendInput,
        sendInputRealtime,
        sendCommand,
        resizeSession,
        sendResizeRealtime,
        terminateSession,
        closeSocket,
    } = useTerminalSession();

    const [shell, setShell] = useState(DEFAULT_LAYOUT.shell);
    const [cwd, setCwd] = useState(DEFAULT_LAYOUT.cwd);
    const [cols, setCols] = useState(DEFAULT_LAYOUT.cols);
    const [rows, setRows] = useState(DEFAULT_LAYOUT.rows);
    const [themePreset, setThemePreset] = useState(DEFAULT_LAYOUT.themePreset);
    const [fontSize, setFontSize] = useState(DEFAULT_LAYOUT.fontSize);
    const [autoScroll, setAutoScroll] = useState(DEFAULT_LAYOUT.autoScroll);
    const [paneMode, setPaneMode] = useState(DEFAULT_LAYOUT.paneMode);

    const [openSessionIds, setOpenSessionIds] = useState(DEFAULT_LAYOUT.openSessionIds);
    const [activeSessionId, setActiveSessionId] = useState(DEFAULT_LAYOUT.activeSessionId);
    const [secondarySessionId, setSecondarySessionId] = useState(DEFAULT_LAYOUT.secondarySessionId);
    const [selectedSessionToOpen, setSelectedSessionToOpen] = useState('');
    const [commandBySession, setCommandBySession] = useState({});
    const [showLegacyCommandInput, setShowLegacyCommandInput] = useState(DEFAULT_LAYOUT.showLegacyCommandInput);
    const [layoutHydrated, setLayoutHydrated] = useState(false);

    const restoredRef = useRef(false);

    const sessionById = useMemo(() => {
        const map = {};

        for (const session of sessions) {
            if (!session?.sessionId) continue;
            map[session.sessionId] = { ...session };
        }

        for (const [sessionId, snapshot] of Object.entries(sessionSnapshots || {})) {
            map[sessionId] = {
                ...(map[sessionId] || {}),
                ...(snapshot || {}),
            };
        }

        return map;
    }, [sessions, sessionSnapshots]);

    const activeSession = activeSessionId ? sessionById[activeSessionId] || null : null;
    const activeWsStatus = activeSessionId ? (wsStatusBySession[activeSessionId] || 'disconnected') : 'disconnected';
    const activeRetries = activeSessionId ? (retriesBySession[activeSessionId] || 0) : 0;
    const activeLoading = activeSessionId ? loadingBySession[activeSessionId] === true : false;
    const activeSending = activeSessionId ? sendingBySession[activeSessionId] === true : false;
    const activeCommandText = activeSessionId ? (commandBySession[activeSessionId] || '') : '';

    const openSessionSet = useMemo(() => new Set(openSessionIds), [openSessionIds]);
    const availableSessionsToOpen = useMemo(
        () => sessions.filter((session) => !openSessionSet.has(session.sessionId)),
        [openSessionSet, sessions]
    );

    const activeSessionLabel = useMemo(() => {
        if (!activeSessionId) return 'No active session';
        return buildSessionLabel(activeSessionId, activeSession || {});
    }, [activeSession, activeSessionId]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(TERMINAL_LAYOUT_STORAGE_KEY);
            if (!raw) {
                setLayoutHydrated(true);
                return;
            }

            const parsed = JSON.parse(raw);
            const normalized = normalizePersistedLayout(parsed);

            setShell(normalized.shell);
            setCwd(normalized.cwd);
            setCols(normalized.cols);
            setRows(normalized.rows);
            setThemePreset(normalized.themePreset);
            setFontSize(normalized.fontSize);
            setAutoScroll(normalized.autoScroll);
            setPaneMode(normalized.paneMode);
            setOpenSessionIds(normalized.openSessionIds);
            setActiveSessionId(normalized.activeSessionId);
            setSecondarySessionId(normalized.secondarySessionId);
            setShowLegacyCommandInput(normalized.showLegacyCommandInput);
        } catch {
            // Ignore malformed persisted layout
        } finally {
            setLayoutHydrated(true);
        }
    }, []);

    useEffect(() => {
        if (!layoutHydrated) return;

        try {
            localStorage.setItem(TERMINAL_LAYOUT_STORAGE_KEY, JSON.stringify({
                shell,
                cwd,
                cols,
                rows,
                themePreset,
                fontSize,
                autoScroll,
                paneMode,
                openSessionIds,
                activeSessionId,
                secondarySessionId,
                showLegacyCommandInput,
            }));
        } catch {
            // Ignore storage write failures
        }
    }, [activeSessionId, autoScroll, cols, cwd, fontSize, layoutHydrated, openSessionIds, paneMode, rows, secondarySessionId, shell, showLegacyCommandInput, themePreset]);

    useEffect(() => {
        if (!layoutHydrated || restoredRef.current) return;
        restoredRef.current = true;

        const requested = uniqueSessionIds(openSessionIds);
        if (requested.length === 0) {
            refreshSessions()
                .then((listed) => {
                    const runningIds = uniqueSessionIds((listed || [])
                        .filter((session) => session?.status === 'running' || session?.status === 'terminating')
                        .map((session) => session?.sessionId));

                    if (runningIds.length === 0) return;

                    const maxTabs = paneMode === 'split' ? 2 : 1;
                    const initialTabs = runningIds.slice(0, maxTabs);

                    setOpenSessionIds(initialTabs);
                    setActiveSessionId(initialTabs[0] || null);
                    setSecondarySessionId(paneMode === 'split' ? (initialTabs[1] || null) : null);

                    Promise.all(initialTabs.map((sessionId) => (
                        loadSession(sessionId, {
                            connectIfRunning: true,
                            refreshList: false,
                        }).catch(() => null)
                    ))).catch(() => { });
                })
                .catch(() => { });
            return;
        }

        resumeSessions(requested)
            .then((restored) => {
                if (!restored || restored.length === 0) {
                    setOpenSessionIds([]);
                    setActiveSessionId(null);
                    setSecondarySessionId(null);
                    return;
                }

                setOpenSessionIds(restored);
                setActiveSessionId((current) => {
                    if (current && restored.includes(current)) return current;
                    return restored[0];
                });
                setSecondarySessionId((current) => {
                    if (paneMode !== 'split') return null;
                    const fallback = restored.find((id) => id !== (activeSessionId || restored[0])) || null;
                    if (current && restored.includes(current) && current !== activeSessionId) {
                        return current;
                    }
                    return fallback;
                });
            })
            .catch(() => {
                // Keep a usable UI if restore fails.
            });
    }, [activeSessionId, layoutHydrated, loadSession, openSessionIds, paneMode, refreshSessions, resumeSessions]);

    useEffect(() => {
        if (!activeSessionId) return;
        loadSession(activeSessionId, {
            connectIfRunning: true,
            refreshList: false,
        }).catch(() => { });
    }, [activeSessionId, loadSession]);

    useEffect(() => {
        if (!secondarySessionId || paneMode !== 'split') return;
        loadSession(secondarySessionId, {
            connectIfRunning: true,
            refreshList: false,
        }).catch(() => { });
    }, [loadSession, paneMode, secondarySessionId]);

    useEffect(() => {
        if (sessions.length === 0) return;
        const knownIds = new Set(sessions.map((session) => session.sessionId));
        setOpenSessionIds((prev) => {
            const filtered = prev.filter((id) => knownIds.has(id));
            return arraysEqual(prev, filtered) ? prev : filtered;
        });
    }, [sessions]);

    useEffect(() => {
        if (openSessionIds.length === 0) {
            if (activeSessionId !== null) setActiveSessionId(null);
            if (secondarySessionId !== null) setSecondarySessionId(null);
            return;
        }

        if (!activeSessionId || !openSessionIds.includes(activeSessionId)) {
            setActiveSessionId(openSessionIds[0]);
        }

        if (paneMode === 'split') {
            const nextSecondary = secondarySessionId && openSessionIds.includes(secondarySessionId) && secondarySessionId !== activeSessionId
                ? secondarySessionId
                : (openSessionIds.find((id) => id !== activeSessionId) || null);

            if (nextSecondary !== secondarySessionId) {
                setSecondarySessionId(nextSecondary);
            }
        } else if (secondarySessionId !== null) {
            setSecondarySessionId(null);
        }
    }, [activeSessionId, openSessionIds, paneMode, secondarySessionId]);

    useEffect(() => {
        if (!activeSession) return;
        if (Number.isFinite(activeSession.cols)) setCols(activeSession.cols);
        if (Number.isFinite(activeSession.rows)) setRows(activeSession.rows);
    }, [activeSession]);

    const openSessionTab = useCallback(async (sessionId, options = {}) => {
        if (!sessionId) return;

        setOpenSessionIds((prev) => uniqueSessionIds([...prev, sessionId]));
        if (options.activate !== false) {
            setActiveSessionId(sessionId);
        }

        if (options.connect === false) {
            return;
        }

        try {
            await loadSession(sessionId, {
                connectIfRunning: true,
                refreshList: false,
            });
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [loadSession]);

    const closeSessionTab = useCallback((sessionId) => {
        if (!sessionId) return;
        closeSocket(sessionId, 'Tab closed');
        setOpenSessionIds((prev) => prev.filter((id) => id !== sessionId));
        setCommandBySession((prev) => {
            const next = { ...prev };
            delete next[sessionId];
            return next;
        });
    }, [closeSocket]);

    const handleCreateSession = useCallback(async () => {
        try {
            const payload = await createSession({
                shell,
                cwd: cwd.trim() || undefined,
                cols,
                rows,
            });

            if (payload?.sessionId) {
                await openSessionTab(payload.sessionId, {
                    activate: true,
                    connect: false,
                });
                setCommandBySession((prev) => ({
                    ...prev,
                    [payload.sessionId]: '',
                }));
                setSelectedSessionToOpen('');
            }

            setError(null);
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [cols, createSession, cwd, openSessionTab, rows, setError, shell]);

    const handleOpenExistingSession = useCallback(async () => {
        if (!selectedSessionToOpen) return;
        await openSessionTab(selectedSessionToOpen, { activate: true });
        setSelectedSessionToOpen('');
    }, [openSessionTab, selectedSessionToOpen]);

    const handleSendCommand = useCallback(async (event) => {
        event.preventDefault();
        if (!activeSessionId) return;

        const command = (commandBySession[activeSessionId] || '').trim();
        if (!command) return;

        try {
            await sendCommand(activeSessionId, command);
            setCommandBySession((prev) => ({
                ...prev,
                [activeSessionId]: '',
            }));
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [activeSessionId, commandBySession, sendCommand]);

    const handleResize = useCallback(async () => {
        if (!activeSessionId) return;
        try {
            await resizeSession(activeSessionId, cols, rows);
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [activeSessionId, cols, resizeSession, rows]);

    const handleTerminate = useCallback(async () => {
        if (!activeSessionId) return;
        try {
            await terminateSession(activeSessionId, { reason: 'Terminated from dashboard' });
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [activeSessionId, terminateSession]);

    const handleInterrupt = useCallback(async () => {
        if (!activeSessionId) return;
        try {
            await sendInput(activeSessionId, '\u0003', { appendNewline: false });
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [activeSessionId, sendInput]);

    const handleEnter = useCallback(async () => {
        if (!activeSessionId) return;
        try {
            await sendInput(activeSessionId, '\n', { appendNewline: false });
        } catch {
            // Hook already stores user-facing error state.
        }
    }, [activeSessionId, sendInput]);

    const handleNewTerminalTabShortcut = useCallback(() => {
        if (availableSessionsToOpen.length > 0) {
            openSessionTab(availableSessionsToOpen[0].sessionId, { activate: true }).catch(() => { });
            return;
        }

        handleCreateSession().catch(() => { });
    }, [availableSessionsToOpen, handleCreateSession, openSessionTab]);

    const handleRefreshTabs = useCallback(async () => {
        await refreshSessions();
        await Promise.all(openSessionIds.map((sessionId) => (
            loadSession(sessionId, {
                connectIfRunning: true,
                refreshList: false,
            }).catch(() => null)
        )));
    }, [loadSession, openSessionIds, refreshSessions]);

    const handleActiveCommandChange = useCallback((value) => {
        if (!activeSessionId) return;
        setCommandBySession((prev) => ({
            ...prev,
            [activeSessionId]: value,
        }));
    }, [activeSessionId]);

    const renderOutputPane = useCallback((sessionId, paneTitle) => {
        if (!sessionId) {
            return (
                <div className="rounded-2xl border border-surface-200 bg-surface-950/95 p-3.5">
                    <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-surface-300">
                        <span>{paneTitle}</span>
                        <span>No session</span>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 font-mono text-[11px] leading-5 text-surface-300">
                        Open a session tab to stream output in this pane.
                    </div>
                </div>
            );
        }

        const paneSession = sessionById[sessionId] || null;
        const paneEvents = eventsBySession[sessionId] || [];
        const paneWsStatus = wsStatusBySession[sessionId] || 'disconnected';
        const paneRetries = retriesBySession[sessionId] || 0;

        return (
            <div className="rounded-2xl border border-surface-200 bg-surface-950/95 p-3.5" onClick={() => setActiveSessionId(sessionId)}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-surface-300">
                    <div className="flex items-center gap-2">
                        <span>{paneTitle}</span>
                        <span className={sessionStatusChip(paneSession?.status)}>{paneSession?.status || 'unknown'}</span>
                        <span className="state-chip state-chip-neutral normal-case font-mono tracking-[0.04em]">ws:{paneWsStatus}</span>
                        {paneRetries > 0 && (
                            <span className="state-chip state-chip-warning normal-case font-mono tracking-[0.04em]">retry:{paneRetries}</span>
                        )}
                    </div>
                    <span>
                        {paneEvents.length} entries
                        {paneSession?.droppedEntries ? ` (dropped ${paneSession.droppedEntries})` : ''}
                    </span>
                </div>

                <TerminalXtermPane
                    key={sessionId}
                    sessionId={sessionId}
                    entries={paneEvents}
                    autoScroll={autoScroll}
                    isActive={sessionId === activeSessionId}
                    onActivate={() => setActiveSessionId(sessionId)}
                    onInput={sendInputRealtime}
                    onResize={sendResizeRealtime}
                    themePreset={themePreset}
                    fontSize={fontSize}
                    onRequestNewTab={handleNewTerminalTabShortcut}
                />
            </div>
        );
    }, [activeSessionId, autoScroll, eventsBySession, fontSize, handleNewTerminalTabShortcut, retriesBySession, sendInputRealtime, sendResizeRealtime, sessionById, themePreset, wsStatusBySession]);

    return (
        <div className="surface-panel motion-enter motion-enter-delay-3 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center">
                        <ClockIcon className="w-4 h-4 text-surface-500" />
                    </div>
                    <div>
                        <h2 className="type-card-title text-[1.02rem]">Terminal Workbench</h2>
                        <p className="text-[11px] text-surface-500">PTY-backed shell sessions with persistent tabs, split panes, and xterm ANSI rendering</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={sessionStatusChip(activeSession?.status)}>{activeSession?.status || 'idle'}</span>
                    <span className="state-chip state-chip-neutral normal-case font-mono tracking-[0.04em]">ws:{activeWsStatus}</span>
                    {activeRetries > 0 && (
                        <span className="state-chip state-chip-warning normal-case font-mono tracking-[0.04em]">retry:{activeRetries}</span>
                    )}
                    <RefreshButton onClick={handleRefreshTabs} variant="card" />
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="lg:col-span-3">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Shell</label>
                    <select
                        value={shell}
                        onChange={(event) => setShell(event.target.value)}
                        className="custom-select w-full"
                    >
                        {SHELL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-5">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Working Directory (relative to workspace root)</label>
                    <input
                        type="text"
                        value={cwd}
                        onChange={(event) => setCwd(event.target.value)}
                        placeholder="e.g. web-app"
                        className="field-input"
                    />
                </div>

                <div className="lg:col-span-2">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Columns</label>
                    <input
                        type="number"
                        min={40}
                        max={320}
                        value={cols}
                        onChange={(event) => setCols(parseDimension(event.target.value, 120, 40, 320))}
                        className="field-input"
                    />
                </div>

                <div className="lg:col-span-2">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Rows</label>
                    <input
                        type="number"
                        min={10}
                        max={120}
                        value={rows}
                        onChange={(event) => setRows(parseDimension(event.target.value, 36, 10, 120))}
                        className="field-input"
                    />
                </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="lg:col-span-4">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Terminal Theme</label>
                    <select
                        value={themePreset}
                        onChange={(event) => setThemePreset(TERMINAL_THEME_SET.has(event.target.value) ? event.target.value : DEFAULT_LAYOUT.themePreset)}
                        className="custom-select w-full"
                    >
                        {TERMINAL_THEME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-3">
                    <label className="type-meta-label block mb-1.5 text-surface-500">Font Size</label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setFontSize((prev) => Math.max(10, prev - 1))}
                            className="action-secondary px-3 py-2 text-xs"
                            aria-label="Decrease terminal font size"
                        >
                            -
                        </button>
                        <input
                            type="number"
                            min={10}
                            max={22}
                            value={fontSize}
                            onChange={(event) => setFontSize(parseDimension(event.target.value, 12, 10, 22))}
                            className="field-input"
                            aria-label="Terminal font size"
                        />
                        <button
                            type="button"
                            onClick={() => setFontSize((prev) => Math.min(22, prev + 1))}
                            className="action-secondary px-3 py-2 text-xs"
                            aria-label="Increase terminal font size"
                        >
                            +
                        </button>
                    </div>
                </div>

                <div className="lg:col-span-5 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-surface-500">xterm Shortcuts</p>
                    <p className="mt-1 text-[11px] text-surface-600">
                        Copy: Ctrl/Cmd+Shift+C, Paste: Ctrl/Cmd+Shift+V, Clear shell: Ctrl/Cmd+L, Clear viewport: Ctrl/Cmd+Shift+K, New tab/session: Ctrl/Cmd+Shift+N
                    </p>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={handleCreateSession}
                    disabled={creating}
                    className="action-primary px-4 py-2 text-xs"
                >
                    {creating ? 'Creating...' : 'Create Session'}
                </button>
                <button
                    type="button"
                    onClick={handleResize}
                    disabled={!activeSessionId || activeSending || activeLoading}
                    className="action-secondary px-4 py-2 text-xs"
                >
                    Apply Size
                </button>
                <button
                    type="button"
                    onClick={handleTerminate}
                    disabled={!activeSessionId || activeSession?.status === 'closed'}
                    className="motion-fast-colors inline-flex items-center rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-100"
                >
                    Terminate
                </button>
                <button
                    type="button"
                    onClick={handleInterrupt}
                    disabled={!activeSessionId || activeSession?.status !== 'running'}
                    className="action-secondary px-4 py-2 text-xs"
                >
                    Send Ctrl+C
                </button>
                <button
                    type="button"
                    onClick={handleEnter}
                    disabled={!activeSessionId || activeSession?.status !== 'running'}
                    className="action-secondary px-4 py-2 text-xs"
                >
                    Send Enter
                </button>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPaneMode('single')}
                        className={`px-3 py-1.5 text-[11px] rounded-lg border ${paneMode === 'single' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-200 text-surface-500 bg-white'}`}
                    >
                        Single Pane
                    </button>
                    <button
                        type="button"
                        onClick={() => setPaneMode('split')}
                        disabled={openSessionIds.length < 2}
                        className={`px-3 py-1.5 text-[11px] rounded-lg border ${paneMode === 'split' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-200 text-surface-500 bg-white disabled:opacity-50'}`}
                    >
                        Split Pane
                    </button>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-surface-500">
                    <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(event) => setAutoScroll(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500/30"
                    />
                    Auto-scroll terminal
                </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="type-meta-label">Open Tabs</span>
                {openSessionIds.length === 0 ? (
                    <span className="text-[11px] text-surface-500">No tabs open</span>
                ) : (
                    openSessionIds.map((sessionId) => {
                        const tabSession = sessionById[sessionId] || {};
                        const isActive = sessionId === activeSessionId;

                        return (
                            <div
                                key={sessionId}
                                className={`inline-flex items-center gap-1 rounded-xl border px-2 py-1 ${isActive ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-200 bg-white text-surface-600'}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setActiveSessionId(sessionId)}
                                    className="text-[11px] font-medium"
                                >
                                    {buildSessionLabel(sessionId, tabSession)}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => closeSessionTab(sessionId)}
                                    className="ml-1 rounded px-1 text-[10px] text-surface-500 hover:bg-surface-100"
                                    aria-label={`Close ${sessionId}`}
                                >
                                    x
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="type-meta-label">Open Existing Session</span>
                <select
                    value={selectedSessionToOpen}
                    onChange={(event) => setSelectedSessionToOpen(event.target.value || '')}
                    className="custom-select min-w-[220px]"
                >
                    <option value="">Select available session</option>
                    {availableSessionsToOpen.map((session) => (
                        <option key={session.sessionId} value={session.sessionId}>
                            {buildSessionLabel(session.sessionId, session)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={handleOpenExistingSession}
                    disabled={!selectedSessionToOpen}
                    className="action-secondary px-4 py-2 text-xs"
                >
                    Open Tab
                </button>
                <span className="state-chip state-chip-neutral normal-case tracking-[0.04em] font-mono">
                    {activeSessionLabel}
                </span>
                {activeSession?.cwd && (
                    <span className="text-[11px] text-surface-500 truncate max-w-[380px]" title={activeSession.cwd}>
                        cwd: {activeSession.cwd}
                    </span>
                )}
            </div>

            {paneMode === 'split' && (
                <div className="mt-2 flex items-center gap-2">
                    <span className="type-meta-label">Secondary Pane</span>
                    <select
                        value={secondarySessionId || ''}
                        onChange={(event) => setSecondarySessionId(event.target.value || null)}
                        className="custom-select min-w-[220px]"
                    >
                        <option value="">Select secondary tab</option>
                        {openSessionIds
                            .filter((sessionId) => sessionId !== activeSessionId)
                            .map((sessionId) => (
                                <option key={sessionId} value={sessionId}>
                                    {buildSessionLabel(sessionId, sessionById[sessionId] || {})}
                                </option>
                            ))}
                    </select>
                </div>
            )}

            {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
            )}

            <div className={`mt-4 grid grid-cols-1 gap-3 ${paneMode === 'split' ? 'xl:grid-cols-2' : ''}`}>
                {renderOutputPane(activeSessionId, 'Primary Output')}
                {paneMode === 'split' && renderOutputPane(secondarySessionId, 'Secondary Output')}
            </div>

            <div className="mt-4 rounded-xl border border-surface-200 bg-surface-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-surface-600">
                        xterm-first mode is active. Type directly in the terminal pane for realtime input and stream monitoring.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowLegacyCommandInput((prev) => !prev)}
                        className="action-secondary px-3 py-1.5 text-[11px]"
                    >
                        {showLegacyCommandInput ? 'Hide Legacy Command Box' : 'Show Legacy Command Box'}
                    </button>
                </div>

                {showLegacyCommandInput && (
                    <form onSubmit={handleSendCommand} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12 opacity-85">
                        <div className="md:col-span-10">
                            <label htmlFor="terminalCommand" className="type-meta-label block mb-1.5 text-surface-500">Legacy Command Fallback</label>
                            <input
                                id="terminalCommand"
                                type="text"
                                value={activeCommandText}
                                onChange={(event) => handleActiveCommandChange(event.target.value)}
                                placeholder={activeSession?.status === 'running' ? 'Enter command and press Send' : 'Create/select a running session first'}
                                className="field-input"
                                disabled={!activeSessionId || activeSession?.status !== 'running' || activeSending}
                            />
                        </div>
                        <div className="md:col-span-2 flex items-end">
                            <button
                                type="submit"
                                disabled={!activeSessionId || !activeCommandText.trim() || activeSession?.status !== 'running' || activeSending}
                                className="action-primary w-full"
                            >
                                {activeSending ? 'Sending...' : 'Send'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
