'use client';

/**
 * ApprovalBatch — replaces a run of ≥2 consecutive approval prompts in the
 * chat timeline with a single collapsible "Approval Tray" card.
 *
 * Features:
 *   • Progress header (N of M approved) with sticky bulk actions.
 *   • Smart grouping: when all requests share the same provider + action +
 *     resource type, surfaces "Approve all N similar" as a one-click action.
 *   • Compact rows with expand-on-click to reveal the full ApprovalPromptCard
 *     (no logic duplication — the same card is rendered inline).
 *   • Focus Mode: carousel-style one-at-a-time review with prev/next nav.
 *   • Keyboard nav: J/K navigate, A approve focused, R reject focused,
 *     E expand, F focus mode, Shift+A approve all similar, ? help.
 *   • Accessible: aria-live progress announcements, aria-expanded rows,
 *     visible focus ring, respects reduced motion via CSS defaults.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ExclamationIcon, XIcon } from '@/components/Icons';
import {
    ApprovalPromptCard,
    getApprovalDecision,
    getStructuredMutationPreview,
    isApprovalPrompt,
    normalizeApprovalText,
} from '@/components/UserInputPrompt';
import {
    fingerprintRequest,
    getRequestStatus,
    getRequestSubject,
    getRequestTitle,
    getRequestProviderLabel,
    getRequestActionLabel,
    getApprovalValues,
} from '@/lib/approval-batch-helpers';

// ───────────────────────── Row (compact) ─────────────────────────

function BatchRow({
    req,
    index,
    focused,
    expanded,
    onFocus,
    onToggleExpand,
    onSubmit,
    disabled,
}) {
    const status = getRequestStatus(req);
    const subject = getRequestSubject(req);
    const title = getRequestTitle(req);
    const providerLabel = getRequestProviderLabel(req);
    const actionLabel = getRequestActionLabel(req);
    const { approveValue, rejectValue } = getApprovalValues(req);

    const statusStyles = {
        pending: 'bg-amber-100 text-amber-700 ring-amber-200/80',
        approved: 'bg-emerald-100 text-emerald-700 ring-emerald-200/80',
        rejected: 'bg-rose-100 text-rose-700 ring-rose-200/80',
        timed_out: 'bg-slate-200 text-slate-700 ring-slate-300/80',
        answered: 'bg-slate-200 text-slate-700 ring-slate-300/80',
    };

    const statusLabel = {
        pending: 'Pending',
        approved: 'Approved',
        rejected: 'Rejected',
        timed_out: 'Timed out',
        answered: 'Answered',
    }[status];

    const statusIcon = status === 'approved'
        ? <CheckIcon className="w-3 h-3" />
        : status === 'rejected'
            ? <XIcon className="w-3 h-3" />
            : status === 'pending'
                ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
                : <ExclamationIcon className="w-3 h-3" />;

    return (
        <div
            className={`group border-t border-surface-200/60 transition-colors ${focused ? 'bg-brand-50/50' : 'bg-white/70 hover:bg-surface-50/80'}`}
            data-approval-row={req.requestId}
        >
            {/* Compact row */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => { onFocus(index); onToggleExpand(index); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(index); onToggleExpand(index); } }}
                onFocus={() => onFocus(index)}
                aria-expanded={expanded}
                aria-controls={`approval-detail-${req.requestId}`}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset ${focused ? 'ring-1 ring-brand-300/60 ring-inset' : ''}`}
            >
                <span className="w-6 text-[11px] font-mono font-semibold text-surface-400 shrink-0">{String(index + 1).padStart(2, '0')}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1 ${statusStyles[status]} shrink-0`}>
                    {statusIcon}
                    {statusLabel}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-100 text-[10px] font-semibold uppercase tracking-wide text-surface-600 shrink-0">
                    {providerLabel}
                </span>
                <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    {subject && (
                        <span className="text-[12px] font-mono font-semibold text-surface-700 shrink-0">{subject}</span>
                    )}
                    <span className="text-[13px] text-surface-700 truncate">{title}</span>
                </div>
                <span className="text-[11px] text-surface-400 normal-case truncate max-w-[180px] hidden md:inline">{actionLabel}</span>
                {status === 'pending' && !expanded && (
                    <span className="hidden lg:inline-flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => !disabled && onSubmit(req.requestId, approveValue)}
                            disabled={disabled}
                            title="Approve (A)"
                            className="px-2 py-1 rounded-md border border-emerald-200 bg-white text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            onClick={() => !disabled && onSubmit(req.requestId, rejectValue)}
                            disabled={disabled}
                            title="Reject (R)"
                            className="px-2 py-1 rounded-md border border-surface-200 bg-white text-[11px] font-semibold text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                        >
                            Reject
                        </button>
                    </span>
                )}
                <ChevronDownIcon className={`w-4 h-4 text-surface-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
            </div>

            {/* Expanded detail — renders the full ApprovalPromptCard inline */}
            {expanded && (
                <div id={`approval-detail-${req.requestId}`} className="px-4 pb-4 pt-1">
                    <ApprovalPromptCard
                        requestId={req.requestId}
                        preview={getStructuredMutationPreview(req.meta)}
                        safeQuestion={req.question || ''}
                        options={Array.isArray(req.options) ? req.options : []}
                        resolved={!!req.resolved}
                        resolvedAnswer={req.resolvedAnswer}
                        auto={!!req.auto}
                        onSubmit={onSubmit}
                        disabled={disabled}
                        submitting={false}
                    />
                </div>
            )}
        </div>
    );
}

// ───────────────────────── Focus mode (carousel) ─────────────────────────

function FocusMode({ requests, focusedIndex, onFocus, onSubmit, onExit, disabled }) {
    const req = requests[focusedIndex];
    if (!req) return null;

    return (
        <div className="px-4 py-4 space-y-3 border-t border-surface-200/60 bg-surface-50/50">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onFocus(Math.max(0, focusedIndex - 1))}
                        disabled={focusedIndex === 0}
                        className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-[12px] font-semibold text-surface-700 hover:bg-surface-50 disabled:opacity-40"
                        title="Previous (K / ←)"
                    >
                        ← Prev
                    </button>
                    <span className="text-[12px] font-semibold text-surface-600 tabular-nums">
                        {focusedIndex + 1} of {requests.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => onFocus(Math.min(requests.length - 1, focusedIndex + 1))}
                        disabled={focusedIndex === requests.length - 1}
                        className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-[12px] font-semibold text-surface-700 hover:bg-surface-50 disabled:opacity-40"
                        title="Next (J / →)"
                    >
                        Next →
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onExit}
                    className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-[12px] font-semibold text-surface-600 hover:bg-surface-50"
                    title="Exit focus mode (Esc)"
                >
                    Exit focus mode
                </button>
            </div>

            <ApprovalPromptCard
                key={req.requestId}
                requestId={req.requestId}
                preview={getStructuredMutationPreview(req.meta)}
                safeQuestion={req.question || ''}
                options={Array.isArray(req.options) ? req.options : []}
                resolved={!!req.resolved}
                resolvedAnswer={req.resolvedAnswer}
                auto={!!req.auto}
                onSubmit={onSubmit}
                disabled={disabled}
                submitting={false}
            />
        </div>
    );
}

// ───────────────────────── Main component ─────────────────────────

function ApprovalBatch({ requests, onSubmit, disabled = false }) {
    const [collapsed, setCollapsed] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [focusMode, setFocusMode] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const containerRef = useRef(null);

    // Pending set for safe bulk actions (only submit those still open)
    const pending = useMemo(() => requests.filter(r => !r.resolved), [requests]);
    const approvedCount = useMemo(() => requests.filter(r => getRequestStatus(r) === 'approved').length, [requests]);
    const rejectedCount = useMemo(() => requests.filter(r => getRequestStatus(r) === 'rejected').length, [requests]);
    const totalResolved = requests.length - pending.length;
    const progressPct = requests.length === 0 ? 0 : Math.round((totalResolved / requests.length) * 100);

    // Smart grouping — fingerprint all pending requests
    const similarityGroups = useMemo(() => {
        const map = new Map();
        for (const r of pending) {
            const fp = fingerprintRequest(r);
            if (!map.has(fp)) map.set(fp, []);
            map.get(fp).push(r);
        }
        return map;
    }, [pending]);

    const largestSimilarGroup = useMemo(() => {
        let best = null;
        for (const [, items] of similarityGroups) {
            if (!best || items.length > best.length) best = items;
        }
        return best && best.length >= 2 ? best : null;
    }, [similarityGroups]);

    const allPendingAreSimilar = largestSimilarGroup && pending.length > 0 && largestSimilarGroup.length === pending.length;

    // Keyboard navigation — scoped to when the tray container has focus within
    const handleSubmit = useCallback((requestId, answer) => {
        if (disabled) return;
        onSubmit(requestId, answer);
    }, [disabled, onSubmit]);

    const approveOne = useCallback((req) => {
        if (!req || req.resolved) return;
        const { approveValue } = getApprovalValues(req);
        handleSubmit(req.requestId, approveValue);
    }, [handleSubmit]);

    const rejectOne = useCallback((req) => {
        if (!req || req.resolved) return;
        const { rejectValue } = getApprovalValues(req);
        handleSubmit(req.requestId, rejectValue);
    }, [handleSubmit]);

    const approveAllSimilar = useCallback(() => {
        if (!largestSimilarGroup) return;
        for (const req of largestSimilarGroup) approveOne(req);
    }, [largestSimilarGroup, approveOne]);

    const approveAllPending = useCallback(() => {
        for (const req of pending) approveOne(req);
    }, [pending, approveOne]);

    const rejectAllPending = useCallback(() => {
        for (const req of pending) rejectOne(req);
    }, [pending, rejectOne]);

    const toggleExpand = useCallback((index) => {
        const req = requests[index];
        if (!req) return;
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(req.requestId)) next.delete(req.requestId);
            else next.add(req.requestId);
            return next;
        });
    }, [requests]);

    // Move focus to first pending on mount / when new pending arrive
    useEffect(() => {
        if (pending.length > 0) {
            const firstPendingIndex = requests.findIndex(r => !r.resolved);
            if (firstPendingIndex >= 0) setFocusedIndex(firstPendingIndex);
        }
    }, [pending.length, requests]);

    // Global keyboard shortcuts — only when focus is within the tray
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handler = (e) => {
            // Ignore typing in inputs/textareas
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            if (!el.contains(document.activeElement)) return;

            const key = e.key;
            if (key === '?') { e.preventDefault(); setShowHelp(v => !v); return; }
            if (key === 'Escape' && focusMode) { e.preventDefault(); setFocusMode(false); return; }
            if (key === 'f' || key === 'F') { e.preventDefault(); setFocusMode(v => !v); return; }
            if (key === 'j' || key === 'ArrowDown' || key === 'ArrowRight') {
                e.preventDefault();
                setFocusedIndex(i => Math.min(requests.length - 1, i + 1));
                return;
            }
            if (key === 'k' || key === 'ArrowUp' || key === 'ArrowLeft') {
                e.preventDefault();
                setFocusedIndex(i => Math.max(0, i - 1));
                return;
            }
            if (key === 'e' || key === 'E') { e.preventDefault(); toggleExpand(focusedIndex); return; }
            if (key === 'a' && !e.shiftKey) { e.preventDefault(); approveOne(requests[focusedIndex]); return; }
            if ((key === 'A' && e.shiftKey) || (key === 'a' && e.shiftKey)) { e.preventDefault(); approveAllSimilar(); return; }
            if (key === 'r' || key === 'R') { e.preventDefault(); rejectOne(requests[focusedIndex]); return; }
        };
        el.addEventListener('keydown', handler);
        return () => el.removeEventListener('keydown', handler);
    }, [requests, focusedIndex, focusMode, toggleExpand, approveOne, rejectOne, approveAllSimilar]);

    const providerSummary = useMemo(() => {
        const counts = { jira: 0, confluence: 0, other: 0 };
        for (const r of requests) {
            const label = getRequestProviderLabel(r);
            if (label === 'Jira') counts.jira += 1;
            else if (label === 'Confluence') counts.confluence += 1;
            else counts.other += 1;
        }
        const parts = [];
        if (counts.jira) parts.push(`${counts.jira} Jira`);
        if (counts.confluence) parts.push(`${counts.confluence} Confluence`);
        if (counts.other) parts.push(`${counts.other} other`);
        return parts.join(' · ');
    }, [requests]);

    const allResolved = pending.length === 0;

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className="relative rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/60 via-white to-white shadow-[0_12px_28px_rgba(251,191,36,0.12)] overflow-hidden outline-none focus:outline-none"
            role="region"
            aria-label={`Approval tray — ${pending.length} of ${requests.length} pending`}
        >
            {/* Sticky header — stays visible while scrolling long trays */}
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-amber-200/60">
                <div className="px-4 py-3 space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                            <ExclamationIcon className="w-3.5 h-3.5" />
                            Approval Tray
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                            {pending.length} pending
                        </span>
                        {providerSummary && (
                            <span className="text-[11px] text-surface-500">· {providerSummary}</span>
                        )}
                        <div className="flex-1" />
                        <button
                            type="button"
                            onClick={() => setShowHelp(v => !v)}
                            title="Keyboard shortcuts (?)"
                            className="px-2 py-1 rounded-md text-[11px] font-mono font-semibold text-surface-500 hover:bg-surface-100"
                        >
                            ?
                        </button>
                        <button
                            type="button"
                            onClick={() => setCollapsed(v => !v)}
                            className="px-2.5 py-1 rounded-md border border-surface-200 bg-white text-[11px] font-semibold text-surface-600 hover:bg-surface-50"
                        >
                            {collapsed ? 'Expand tray' : 'Collapse tray'}
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 transition-[width] duration-300"
                                style={{ width: `${progressPct}%` }}
                                aria-hidden="true"
                            />
                        </div>
                        <span className="text-[11px] font-semibold text-surface-600 tabular-nums" aria-live="polite">
                            {totalResolved} / {requests.length}
                            {approvedCount > 0 && <span className="text-emerald-600 ml-1.5">✓ {approvedCount}</span>}
                            {rejectedCount > 0 && <span className="text-rose-600 ml-1.5">✗ {rejectedCount}</span>}
                        </span>
                    </div>

                    {/* Smart grouping banner + bulk actions */}
                    {!allResolved && (
                        <div className="flex flex-wrap items-center gap-2">
                            {largestSimilarGroup && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200/70 text-[11px] font-semibold text-brand-700">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                        <path d="M5 2a1 1 0 00-1 1v2a1 1 0 001 1h2a1 1 0 001-1V3a1 1 0 00-1-1H5zM5 8a1 1 0 00-1 1v2a1 1 0 001 1h2a1 1 0 001-1V9a1 1 0 00-1-1H5zM5 14a1 1 0 00-1 1v2a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 00-1-1H5zM11 2a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1V3a1 1 0 00-1-1h-6zM11 8a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1V9a1 1 0 00-1-1h-6zM11 14a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1v-2a1 1 0 00-1-1h-6z" />
                                    </svg>
                                    {allPendingAreSimilar
                                        ? `All ${largestSimilarGroup.length} are identical in shape`
                                        : `${largestSimilarGroup.length} similar approvals detected`}
                                </span>
                            )}
                            <div className="flex-1" />
                            {largestSimilarGroup && (
                                <button
                                    type="button"
                                    onClick={approveAllSimilar}
                                    disabled={disabled}
                                    className="px-3 py-1.5 rounded-lg gradient-brand text-white text-[12px] font-semibold shadow-[0_6px_16px_rgba(37,99,235,0.24)] hover:-translate-y-px hover:shadow-[0_10px_22px_rgba(37,99,235,0.3)] transition-all disabled:opacity-50"
                                    title="Approve all similar (Shift+A)"
                                >
                                    ✓ Approve all {largestSimilarGroup.length} similar
                                </button>
                            )}
                            {!largestSimilarGroup && pending.length > 1 && (
                                <button
                                    type="button"
                                    onClick={approveAllPending}
                                    disabled={disabled}
                                    className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-white text-emerald-700 text-[12px] font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
                                >
                                    Approve all {pending.length}
                                </button>
                            )}
                            {pending.length > 1 && (
                                <button
                                    type="button"
                                    onClick={rejectAllPending}
                                    disabled={disabled}
                                    className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-surface-600 text-[12px] font-semibold hover:bg-surface-50 transition-colors disabled:opacity-50"
                                >
                                    Reject all
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setFocusMode(v => !v)}
                                className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ${focusMode ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-50'}`}
                                title="Toggle focus mode (F)"
                            >
                                🎯 {focusMode ? 'Exit focus' : 'Focus mode'}
                            </button>
                        </div>
                    )}

                    {showHelp && (
                        <div className="rounded-lg bg-surface-900/95 text-surface-100 px-3 py-2.5 text-[11px] leading-6 font-mono">
                            <div className="font-sans font-semibold mb-1 text-amber-300">Keyboard shortcuts</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                                <span><kbd className="px-1 rounded bg-surface-700">J</kbd> / <kbd className="px-1 rounded bg-surface-700">K</kbd> — navigate next / prev</span>
                                <span><kbd className="px-1 rounded bg-surface-700">A</kbd> — approve focused</span>
                                <span><kbd className="px-1 rounded bg-surface-700">Shift+A</kbd> — approve all similar</span>
                                <span><kbd className="px-1 rounded bg-surface-700">R</kbd> — reject focused</span>
                                <span><kbd className="px-1 rounded bg-surface-700">E</kbd> — expand / collapse row</span>
                                <span><kbd className="px-1 rounded bg-surface-700">F</kbd> — focus mode</span>
                                <span><kbd className="px-1 rounded bg-surface-700">?</kbd> — toggle this help</span>
                                <span><kbd className="px-1 rounded bg-surface-700">Esc</kbd> — exit focus mode</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Body */}
            {!collapsed && (
                focusMode ? (
                    <FocusMode
                        requests={requests}
                        focusedIndex={focusedIndex}
                        onFocus={setFocusedIndex}
                        onSubmit={handleSubmit}
                        onExit={() => setFocusMode(false)}
                        disabled={disabled}
                    />
                ) : (
                    <div className="max-h-[60vh] overflow-y-auto">
                        {requests.map((req, index) => (
                            <BatchRow
                                key={req.requestId}
                                req={req}
                                index={index}
                                focused={index === focusedIndex}
                                expanded={expandedIds.has(req.requestId)}
                                onFocus={setFocusedIndex}
                                onToggleExpand={toggleExpand}
                                onSubmit={handleSubmit}
                                disabled={disabled}
                            />
                        ))}
                    </div>
                )
            )}

            {/* Footer hint when all resolved */}
            {allResolved && !collapsed && (
                <div className="px-4 py-2.5 border-t border-surface-200/60 bg-emerald-50/40 text-[11px] text-emerald-700 font-semibold">
                    All approvals in this batch have been reviewed.
                </div>
            )}
        </div>
    );
}

// Helper — decide whether a user_input request should participate in a batch.
// Exported so the chat page can group consecutive approval items in its timeline.
export function isApprovalBatchCandidate(req) {
    if (!req || typeof req !== 'object') return false;
    const preview = getStructuredMutationPreview(req.meta);
    return isApprovalPrompt(req.type, preview, req.question, req.options, req.meta || {});
}

export default memo(ApprovalBatch);
