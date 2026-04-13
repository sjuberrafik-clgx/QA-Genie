'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { getToolDisplay, getCategoryColorClasses } from '@/lib/tool-display-names';
import { WrenchIcon, CheckIcon, ExclamationIcon, XIcon } from '@/components/Icons';
import { FileAttachmentCard } from '@/components/FilePreview';

// ─── Category Badge ──────────────────────────────────────────────────────────

function CategoryBadge({ category, color }) {
    const classes = getCategoryColorClasses(color);
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${classes.bg} ${classes.text} ${classes.border}`}>
            {category}
        </span>
    );
}

function getEffectBadgeClasses(effect) {
    if (effect === 'delete') {
        return 'bg-red-50 text-red-600 border-red-200';
    }
    if (effect === 'write') {
        return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    return 'bg-slate-100 text-slate-600 border-slate-200';
}

function getImpactHint(display) {
    if (display.effect === 'delete') {
        return display.requiresConfirmation
            ? 'destructive change, explicit confirmation required'
            : 'destructive change';
    }
    if (display.effect === 'write' && display.impactLevel === 'high') {
        return display.requiresConfirmation
            ? 'high-impact write, approval required'
            : 'high-impact write';
    }
    if (display.effect === 'write' && display.impactLevel === 'medium') {
        return 'write operation';
    }
    return null;
}

function parseToolResultPayload(result) {
    if (!result) return null;
    if (typeof result === 'object') return result;
    if (typeof result !== 'string') return null;

    try {
        return JSON.parse(result);
    } catch {
        return null;
    }
}

function getStructuredMutationPayload(resultPayload) {
    if (!resultPayload || typeof resultPayload !== 'object') return null;
    if (resultPayload.receipt && typeof resultPayload.receipt === 'object') return resultPayload.receipt;
    if (resultPayload.preview && typeof resultPayload.preview === 'object') return resultPayload.preview;
    return null;
}

function MutationPayloadBlock({ payload, isFailed }) {
    if (!payload) return null;

    const subjectLabel = payload.subject?.label || payload.subject?.id || payload.subject?.title || 'Target resource';
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const notes = Array.isArray(payload.notes) ? payload.notes : [];
    const accentClasses = isFailed
        ? 'border-red-100/80 bg-red-50/50'
        : 'border-surface-200/70 bg-white/70';

    return (
        <div className={`mt-2 ml-[26px] rounded-lg border px-3 py-2.5 space-y-2 ${accentClasses}`}>
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-surface-500 font-semibold">
                <span>{payload.title || (payload.kind === 'mutation-receipt' ? 'Mutation receipt' : 'Mutation preview')}</span>
                <span className="normal-case text-surface-600">{subjectLabel}</span>
            </div>

            {changes.length > 0 && (
                <div className="space-y-1.5">
                    {changes.map((change, index) => (
                        <div key={`${change.field || 'field'}_${index}`} className="rounded-md border border-surface-200/70 bg-surface-50/80 px-2.5 py-2">
                            <div className="text-[11px] font-semibold text-surface-700">{change.label || change.field || 'Field'}</div>
                            <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-surface-600 sm:grid-cols-2 sm:gap-2">
                                <div>
                                    <span className="font-medium text-surface-500">Before: </span>
                                    <span>{change.beforeDisplay || '(empty)'}</span>
                                </div>
                                <div>
                                    <span className="font-medium text-surface-500">After: </span>
                                    <span>{change.afterDisplay || '(empty)'}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {notes.length > 0 && (
                <div className="space-y-1">
                    {notes.map((note, index) => (
                        <div key={`note_${index}`} className="text-[11px] text-surface-600 leading-relaxed">
                            {note}
                        </div>
                    ))}
                </div>
            )}

            {payload.outcome && (
                <div className="text-[11px] text-surface-600 leading-relaxed">
                    <span className="font-medium text-surface-700">Outcome: </span>
                    {payload.outcome}
                </div>
            )}
        </div>
    );
}

// ─── Elapsed Timer ───────────────────────────────────────────────────────────

function ElapsedTimer({ startTime, isRunning }) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!isRunning || !startTime) return;
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isRunning, startTime]);

    if (!isRunning || elapsed < 2) return null; // Don't show for quick tools

    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    return (
        <span className="text-[9px] text-surface-400 tabular-nums font-mono ml-1.5">
            {display}
        </span>
    );
}

// ─── Single Tool Call Card ───────────────────────────────────────────────────

function ToolCallItem({ tool }) {
    const startTimeRef = useRef(tool.status === 'running' ? Date.now() : null);
    const display = useMemo(() => getToolDisplay(tool.name), [tool.name]);
    const isRunning = tool.status === 'running';
    const isApprovalPending = isRunning && tool.progressPhase === 'approval';
    const isFailed = tool.status === 'complete' && tool.success === false;
    const isComplete = tool.status === 'complete' && tool.success !== false;
    const effectClasses = getEffectBadgeClasses(display.effect);
    const impactHint = getImpactHint(display);
    const resultPayload = useMemo(() => parseToolResultPayload(tool.result), [tool.result]);
    const mutationPayload = useMemo(() => getStructuredMutationPayload(resultPayload), [resultPayload]);
    const artifactAttachments = Array.isArray(tool.attachments) ? tool.attachments : [];

    // Card border/bg styling
    const cardStyle = isApprovalPending
        ? 'border-amber-300/80 bg-amber-50/60 py-3 shadow-sm shadow-amber-100/60'
        : isRunning
            ? tool.progressPhase
                ? 'border-brand-200/80 bg-brand-50/40 py-2'
                : 'border-brand-200/80 bg-brand-50/40 py-2.5'
            : isFailed
                ? 'border-red-200/80 bg-red-50/30 py-2.5'
                : 'border-accent-200/80 bg-accent-50/30 py-2.5';

    return (
        <div className={`rounded-xl px-4 text-xs border transition-all ${cardStyle}`}>
            {/* Main row: icon + name + category + status */}
            <div className="flex items-center gap-2">
                {/* Status icon */}
                {isApprovalPending ? (
                    <ExclamationIcon className="w-4 h-4 flex-shrink-0 text-amber-500" />
                ) : isRunning ? (
                    <div className="w-4 h-4 flex-shrink-0">
                        <div className="w-4 h-4 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
                    </div>
                ) : isFailed ? (
                    <XIcon className="w-4 h-4 flex-shrink-0 text-red-400" />
                ) : (
                    <CheckIcon className="w-4 h-4 flex-shrink-0 text-accent-500" />
                )}

                {/* Tool name (friendly) + raw name tooltip */}
                <span
                    className="font-medium text-surface-700 truncate"
                    title={tool.name}
                >
                    {display.label}
                </span>

                {/* Category badge */}
                <CategoryBadge category={display.categoryLabel} color={display.color} />

                {display.effect !== 'read' && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${effectClasses}`}>
                        {display.effect}
                    </span>
                )}

                {/* Elapsed timer for running tools */}
                {isRunning && (
                    <ElapsedTimer startTime={startTimeRef.current} isRunning={isRunning} />
                )}

                {/* Status indicator — right-aligned */}
                <span className="ml-auto flex-shrink-0">
                    {isRunning && !tool.progressPhase && (
                        <span className="text-brand-500 text-[10px] font-semibold flex items-center gap-1">
                            running
                            <span className="inline-flex gap-[2px]">
                                <span className="typing-dot" />
                                <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
                                <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
                            </span>
                        </span>
                    )}
                    {isRunning && tool.progressPhase && (
                        <span className={`${isApprovalPending ? 'text-amber-600' : 'text-brand-500'} text-[10px] font-semibold truncate max-w-[200px]`}>
                            {isApprovalPending ? 'AWAITING APPROVAL' : tool.progressPhase.replace(/_/g, ' ').toUpperCase()}
                        </span>
                    )}
                    {isComplete && (
                        <span className="text-accent-600 text-[10px] font-semibold">done</span>
                    )}
                    {isFailed && (
                        <span className="text-red-500 text-[10px] font-semibold">failed</span>
                    )}
                </span>
            </div>

            {/* Live progress detail for running tools */}
            {isApprovalPending && (
                <div className="mt-2 ml-[26px] rounded-lg border border-amber-200/80 bg-white/80 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 shadow-[0_1px_2px_rgba(120,53,15,0.06)]">
                    <div className="font-semibold text-amber-700">Approval gate is holding this action.</div>
                    <div className="mt-1 text-surface-600">
                        {tool.progressMessage || 'The tool is waiting for an explicit user decision.'}
                    </div>
                    <div className="mt-1 text-surface-500">
                        Review the approval card in the timeline to approve or cancel the mutation.
                    </div>
                </div>
            )}

            {isRunning && tool.progressMessage && !isApprovalPending && (
                <div className="mt-1.5 ml-[26px] space-y-1">
                    {/* Step progress bar */}
                    {tool.stepNum && tool.totalSteps && (
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-brand-400 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((tool.stepNum / tool.totalSteps) * 100)}%` }}
                                />
                            </div>
                            <span className="flex-shrink-0 text-[9px] text-brand-500 tabular-nums font-mono">
                                {tool.stepNum}/{tool.totalSteps}
                            </span>
                            {tool.stepStatus && (
                                <span className={`flex-shrink-0 text-[9px] font-semibold ${tool.stepStatus === 'pass' ? 'text-accent-500' : tool.stepStatus === 'fail' ? 'text-red-400' : 'text-surface-400'}`}>
                                    {tool.stepStatus === 'pass' ? '✓' : tool.stepStatus === 'fail' ? '✗' : '—'}
                                </span>
                            )}
                        </div>
                    )}
                    {/* Step description */}
                    <div className="flex items-center gap-2 text-[10px] text-brand-600/80 leading-tight">
                        <span className="truncate">{tool.stepDescription || tool.progressMessage}</span>
                    </div>
                </div>
            )}

            {impactHint && (
                <div className="mt-1.5 ml-[26px] text-[10px] leading-tight text-surface-500">
                    {impactHint}
                </div>
            )}

            {!isRunning && mutationPayload && (
                <MutationPayloadBlock payload={mutationPayload} isFailed={isFailed} />
            )}

            {!isRunning && artifactAttachments.length > 0 && (
                <div className="mt-2 ml-[26px] flex flex-wrap gap-2">
                    {artifactAttachments.map((attachment, index) => (
                        <FileAttachmentCard
                            key={attachment.id || `${tool.id || tool.name}_artifact_${index}`}
                            attachment={attachment}
                        />
                    ))}
                </div>
            )}

        </div>
    );
}

// ─── Tool Call Group ─────────────────────────────────────────────────────────

const COLLAPSE_THRESHOLD = 6; // Auto-collapse when more than this many completed tools

export default function ToolCallCard({ group }) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    const tools = group.tools || [];
    const runningTools = tools.filter(t => t.status === 'running');
    const completedTools = tools.filter(t => t.status === 'complete');
    const failedTools = completedTools.filter(t => t.success === false);
    const successTools = completedTools.filter(t => t.success !== false);
    const totalCount = tools.length;
    const runningCount = runningTools.length;

    // Auto-collapse when many completed tools and none running
    const shouldAutoCollapse = completedTools.length > COLLAPSE_THRESHOLD && runningCount === 0;

    // Determine which tools to show based on collapse state
    const effectiveCollapsed = isCollapsed || shouldAutoCollapse;
    const visibleTools = effectiveCollapsed
        ? [...runningTools, ...failedTools, ...successTools.slice(-2)] // Show running + failed + last 2 successes
        : tools;
    const hiddenCount = totalCount - visibleTools.length;

    // Category summary for collapsed view
    const categorySummary = useMemo(() => {
        if (!effectiveCollapsed || hiddenCount <= 0) return null;
        const counts = {};
        for (const tool of tools) {
            const display = getToolDisplay(tool.name);
            counts[display.categoryLabel] = (counts[display.categoryLabel] || 0) + 1;
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([cat, count]) => `${count} ${cat}`)
            .join(', ');
    }, [effectiveCollapsed, hiddenCount, tools]);

    return (
        <div className="space-y-1.5">
            {/* Header row */}
            <div className="flex items-center gap-2 text-[11px] font-semibold text-surface-500 uppercase tracking-wider px-1">
                <WrenchIcon />
                Tool Calls
                {totalCount > 0 && (
                    <span className="normal-case text-surface-400 text-[10px] font-medium">
                        ({totalCount})
                    </span>
                )}
                {runningCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-600 text-[10px] font-bold normal-case">
                        {runningCount} active
                    </span>
                )}
                {failedTools.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold normal-case">
                        {failedTools.length} failed
                    </span>
                )}
                {/* Collapse/expand toggle */}
                {totalCount > COLLAPSE_THRESHOLD && (
                    <button
                        onClick={() => setIsCollapsed(prev => !prev)}
                        className="ml-auto text-[10px] text-surface-400 hover:text-surface-600 font-medium normal-case transition-colors"
                    >
                        {effectiveCollapsed ? 'Show all' : 'Collapse'}
                    </button>
                )}
            </div>

            {/* Collapsed summary banner */}
            {effectiveCollapsed && hiddenCount > 0 && (
                <button
                    onClick={() => setIsCollapsed(false)}
                    className="w-full rounded-lg px-3 py-1.5 text-[10px] text-surface-500 bg-surface-50 border border-surface-200/60 hover:bg-surface-100 transition-colors text-left"
                >
                    <span className="font-medium">{hiddenCount} more tool calls</span>
                    {categorySummary && (
                        <span className="text-surface-400 ml-1.5">({categorySummary})</span>
                    )}
                </button>
            )}

            {/* Tool cards */}
            {visibleTools.map((tool) => (
                <ToolCallItem key={tool.id} tool={tool} />
            ))}
        </div>
    );
}
