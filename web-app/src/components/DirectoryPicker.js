'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/lib/api-client';
import { FolderOpenIcon, HomeIcon, ClockIcon, HardDriveIcon, XIcon, CheckIcon, ChevronDownIcon } from '@/components/Icons';

const RECENT_KEY = 'filegenie-recent-dirs';
const MAX_RECENTS = 5;

function loadRecents() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveRecent(dirPath) {
    const recents = loadRecents().filter(r => r !== dirPath);
    recents.unshift(dirPath);
    if (recents.length > MAX_RECENTS) recents.length = MAX_RECENTS;
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
    return recents;
}

function removeRecent(dirPath) {
    const recents = loadRecents().filter(r => r !== dirPath);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
    return recents;
}

/** Truncate a path for display: show drive + last 2 segments */
function shortenPath(p, maxLen = 45) {
    if (p.length <= maxLen) return p;
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(sep);
    if (parts.length <= 3) return p;
    return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep);
}

/**
 * DirectoryPicker — Collapsible accordion with native OS folder dialog,
 * quick access, recents, and manual path input.
 *
 * Renders a slim header bar (always visible) with animated expand/collapse body.
 * Auto-expands when no workspace root is set; auto-collapses after selection.
 */
export default function DirectoryPicker({ sessionId, currentRoot, onRootChange }) {
    const [expanded, setExpanded] = useState(!currentRoot);
    const [quickAccess, setQuickAccess] = useState([]);
    const [recents, setRecents] = useState([]);
    const [settingRoot, setSettingRoot] = useState(false);
    const [pickingFolder, setPickingFolder] = useState(false);
    const [manualPath, setManualPath] = useState('');
    const [error, setError] = useState(null);
    const inputRef = useRef(null);

    // Load quick-access dirs on mount
    useEffect(() => {
        setRecents(loadRecents());
        apiClient.getQuickAccess().then(data => {
            setQuickAccess(data.directories?.filter(d => d.exists) || []);
        }).catch(() => { /* ignore */ });
    }, []);

    // Expand when root is cleared externally
    useEffect(() => {
        if (!currentRoot) setExpanded(true);
    }, [currentRoot]);

    /** Set a directory as workspace root via the backend */
    const selectRoot = useCallback(async (dirPath) => {
        if (!sessionId || !dirPath) return;
        setSettingRoot(true);
        setError(null);
        try {
            const data = await apiClient.setWorkspaceRoot(sessionId, dirPath);
            onRootChange(data.root);
            setRecents(saveRecent(data.root));
            setExpanded(false);
            setManualPath('');
        } catch (err) {
            setError(err.message || 'Failed to set workspace root');
        } finally {
            setSettingRoot(false);
        }
    }, [sessionId, onRootChange]);

    /** Open native OS folder dialog via the backend */
    const openNativePicker = useCallback(async () => {
        setPickingFolder(true);
        setError(null);
        try {
            const data = await apiClient.pickDirectory();
            if (data.cancelled) {
                // User cancelled the dialog — do nothing
                return;
            }
            if (data.path) {
                await selectRoot(data.path);
            }
        } catch (err) {
            setError(err.message || 'Failed to open folder picker');
        } finally {
            setPickingFolder(false);
        }
    }, [selectRoot]);

    /** Submit manually typed path */
    const handleManualSubmit = useCallback((e) => {
        e.preventDefault();
        const trimmed = manualPath.trim();
        if (trimmed) selectRoot(trimmed);
    }, [manualPath, selectRoot]);

    const clearRoot = useCallback((e) => {
        e.stopPropagation();
        onRootChange(null);
        setExpanded(true);
    }, [onRootChange]);

    const handleRemoveRecent = useCallback((e, dirPath) => {
        e.stopPropagation();
        setRecents(removeRecent(dirPath));
    }, []);

    const toggleExpanded = useCallback(() => {
        setExpanded(prev => !prev);
    }, []);

    const isBusy = settingRoot || pickingFolder;

    // ─── Unified Accordion ──────────────────────────────────────────────
    return (
        <div className="mx-auto max-w-3xl px-6 mb-2">
            <div className="rounded-xl border border-cyan-200/60 bg-white shadow-sm overflow-hidden">

                {/* ── Header Bar (always visible, clickable to toggle) ── */}
                <div
                    onClick={toggleExpanded}
                    className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none transition-colors ${expanded
                            ? 'bg-cyan-50/50 border-b border-cyan-100/60'
                            : 'bg-cyan-50/80 hover:bg-cyan-100/60'
                        }`}
                >
                    <FolderOpenIcon className="w-4 h-4 text-cyan-600 shrink-0" />

                    {currentRoot ? (
                        <span className="text-[12px] text-cyan-800 font-medium truncate flex-1" title={currentRoot}>
                            {shortenPath(currentRoot)}
                        </span>
                    ) : (
                        <span className="text-[13px] font-semibold text-cyan-800 flex-1">
                            Select a workspace folder
                        </span>
                    )}

                    {/* Action buttons (only when root is set) */}
                    {currentRoot && !expanded && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                            className="px-2 py-0.5 rounded-md text-[12px] text-cyan-600 hover:bg-cyan-100 font-medium transition-colors"
                        >
                            Change
                        </button>
                    )}
                    {currentRoot && (
                        <button
                            onClick={clearRoot}
                            className="p-0.5 rounded-md text-cyan-400 hover:text-cyan-600 hover:bg-cyan-100 transition-colors"
                            title="Clear workspace root"
                        >
                            <XIcon className="w-3.5 h-3.5" />
                        </button>
                    )}

                    {/* Chevron — rotates on expand */}
                    <ChevronDownIcon
                        className={`w-4 h-4 text-cyan-500 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''
                            }`}
                    />
                </div>

                {/* ── Collapsible Body (CSS grid-rows animation) ── */}
                <div
                    className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                    style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
                >
                    <div className="overflow-hidden min-h-0">
                        <div className="px-4 py-3 space-y-3 max-h-[280px] overflow-y-auto">

                            {/* ── Primary: Native OS Folder Picker ── */}
                            <button
                                onClick={openNativePicker}
                                disabled={isBusy}
                                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 text-white text-[13px] font-semibold hover:from-cyan-700 hover:to-cyan-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
                            >
                                {pickingFolder ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        Waiting for folder selection...
                                    </>
                                ) : (
                                    <>
                                        <FolderOpenIcon className="w-4 h-4" />
                                        Open Folder Picker
                                    </>
                                )}
                            </button>

                            {/* ── Manual path input ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <div className="flex-1 h-px bg-surface-200/60" />
                                    <span className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">or paste a path</span>
                                    <div className="flex-1 h-px bg-surface-200/60" />
                                </div>
                                <form onSubmit={handleManualSubmit} className="flex gap-1.5">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={manualPath}
                                        onChange={(e) => setManualPath(e.target.value)}
                                        placeholder="C:\Users\you\project"
                                        disabled={isBusy}
                                        className="flex-1 px-3 py-2 rounded-lg bg-surface-50 border border-surface-200/60 text-[12px] text-surface-700 placeholder:text-surface-300 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isBusy || !manualPath.trim()}
                                        className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-[11px] font-semibold hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                                    >
                                        <CheckIcon className="w-3 h-3" />
                                        Set
                                    </button>
                                </form>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-600">
                                    {error}
                                </div>
                            )}

                            {/* Quick Access */}
                            {quickAccess.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <HardDriveIcon className="w-3 h-3 text-surface-400" />
                                        <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Quick Access</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {quickAccess.map(dir => (
                                            <button
                                                key={dir.path}
                                                onClick={() => selectRoot(dir.path)}
                                                disabled={isBusy}
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-50 border border-surface-200/60 text-[11px] font-medium text-surface-700 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all disabled:opacity-50"
                                            >
                                                {dir.name === 'Home' ? <HomeIcon className="w-3 h-3" /> : <FolderOpenIcon className="w-3 h-3" />}
                                                {dir.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Recent Directories */}
                            {recents.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <ClockIcon className="w-3 h-3 text-surface-400" />
                                        <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Recent</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {recents.map(dirPath => (
                                            <button
                                                key={dirPath}
                                                onClick={() => selectRoot(dirPath)}
                                                disabled={isBusy}
                                                className="group flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-50 border border-surface-200/60 text-[11px] font-medium text-surface-600 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all disabled:opacity-50"
                                            >
                                                <span className="truncate max-w-[180px]" title={dirPath}>
                                                    {shortenPath(dirPath, 30)}
                                                </span>
                                                <span
                                                    onClick={(e) => handleRemoveRecent(e, dirPath)}
                                                    className="ml-0.5 p-0.5 rounded text-surface-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                                    title="Remove from recent"
                                                >
                                                    <XIcon className="w-2.5 h-2.5" />
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
