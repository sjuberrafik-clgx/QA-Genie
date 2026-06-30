'use client';

import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { SparkleIcon } from '@/components/Icons';

/**
 * ReasoningPanel — collapsible per-message thinking/reasoning display.
 *
 * v2 — when the captured reasoning contains structured numbered or labeled
 * steps, render it as a vertical timeline. Falls back to the plain monospace
 * stream for free-form chain-of-thought.
 *
 * Props:
 * - `reasoning`: string — the full thinking text
 * - `isStreaming`: boolean — if true, shows live streaming animation
 * - `defaultExpanded`: boolean — start expanded (default: false)
 * - `compact`: boolean — minimal style for inline use (default: false)
 */
export default memo(ReasoningPanel);

// ─── Structured-step detection ───────────────────────────────────────────────
// Conservative heuristic: only treat reasoning as a "timeline" when we find at
// least two distinct step markers. Otherwise we keep the original free-form
// render to avoid butchering paragraph thoughts.
const STEP_PATTERNS = [
    /^\s*(?:\*\*)?(?:step|thought|action|observation|plan|decision)\s*(\d+)\s*[:.\-)]\s*/i,
    /^\s*(\d{1,2})\s*[).]\s+/,           // "1) ..."  or  "1. ..."
    /^\s*\*\*(\d{1,2})\.\s*([^*]+)\*\*/, // "**1. Title**"
];

function detectSteps(reasoning) {
    if (!reasoning || typeof reasoning !== 'string') return null;
    const text = reasoning.replace(/\r\n/g, '\n');
    const lines = text.split('\n');

    const markers = []; // { lineIdx, label, kind }
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;

        for (const re of STEP_PATTERNS) {
            const m = trimmed.match(re);
            if (m) {
                const labelMatch = trimmed.match(/^\s*(?:\*\*)?(step|thought|action|observation|plan|decision)\b/i);
                markers.push({
                    lineIdx: i,
                    label: labelMatch ? labelMatch[1].toLowerCase() : 'step',
                });
                break;
            }
        }
    }

    if (markers.length < 2) return null;

    // Build step blocks: text from marker N to marker N+1
    const steps = [];
    for (let i = 0; i < markers.length; i += 1) {
        const start = markers[i].lineIdx;
        const end = i + 1 < markers.length ? markers[i + 1].lineIdx : lines.length;
        const block = lines.slice(start, end).join('\n').trim();
        if (block) {
            steps.push({
                label: markers[i].label,
                index: i + 1,
                text: block,
            });
        }
    }
    return steps.length >= 2 ? steps : null;
}

const STEP_KIND_STYLES = {
    step: { dot: 'bg-violet-400', tag: 'bg-violet-100 text-violet-700' },
    thought: { dot: 'bg-violet-400', tag: 'bg-violet-100 text-violet-700' },
    plan: { dot: 'bg-sky-400', tag: 'bg-sky-100 text-sky-700' },
    action: { dot: 'bg-emerald-400', tag: 'bg-emerald-100 text-emerald-700' },
    observation: { dot: 'bg-amber-400', tag: 'bg-amber-100 text-amber-700' },
    decision: { dot: 'bg-fuchsia-400', tag: 'bg-fuchsia-100 text-fuchsia-700' },
};

function Timeline({ steps }) {
    return (
        <ol className="reasoning-timeline">
            {steps.map((s) => {
                const style = STEP_KIND_STYLES[s.label] || STEP_KIND_STYLES.step;
                // Strip the marker prefix from the rendered text so the dot/tag carry it.
                const cleaned = s.text
                    .replace(/^\s*(?:\*\*)?\s*(?:step|thought|action|observation|plan|decision)\s*\d+\s*[:.\-)]\s*(?:\*\*)?\s*/i, '')
                    .replace(/^\s*\d{1,2}\s*[).]\s+/, '')
                    .replace(/^\s*\*\*\d{1,2}\.\s*([^*]+)\*\*\s*/, '$1\n')
                    .trim();
                return (
                    <li key={s.index} className="reasoning-timeline__item">
                        <span className={`reasoning-timeline__dot ${style.dot}`} aria-hidden />
                        <div className="reasoning-timeline__content">
                            <div className="reasoning-timeline__head">
                                <span className={`reasoning-timeline__tag ${style.tag}`}>
                                    {s.label.charAt(0).toUpperCase() + s.label.slice(1)} {s.index}
                                </span>
                            </div>
                            <pre className="reasoning-timeline__body">{cleaned || s.text}</pre>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

function ReasoningPanel({ reasoning, isStreaming = false, defaultExpanded = false, compact = false }) {
    const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);
    const contentRef = useRef(null);

    // Auto-expand when streaming starts, auto-collapse when it ends (if user hasn't interacted)
    const [userToggled, setUserToggled] = useState(false);
    useEffect(() => {
        if (!userToggled) {
            setExpanded(isStreaming || defaultExpanded);
        }
    }, [isStreaming, defaultExpanded, userToggled]);

    // Auto-scroll to bottom of reasoning content during streaming
    useEffect(() => {
        if (isStreaming && expanded && contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [reasoning, isStreaming, expanded]);

    // Defer timeline parsing until streaming pauses (parsing mid-stream is wasteful).
    const steps = useMemo(
        () => (isStreaming ? null : detectSteps(reasoning)),
        [reasoning, isStreaming]
    );

    if (!reasoning && !isStreaming) return null;

    const handleToggle = () => {
        setUserToggled(true);
        setExpanded(prev => !prev);
    };

    // Truncate preview for collapsed state
    const previewLength = compact ? 80 : 120;
    const preview = reasoning
        ? reasoning.length > previewLength
            ? reasoning.substring(0, previewLength).trim() + '...'
            : reasoning
        : '';

    // Word count for expanded header
    const wordCount = reasoning ? reasoning.split(/\s+/).filter(Boolean).length : 0;

    if (compact) {
        return (
            <div className="mt-1.5 mb-1">
                <button
                    onClick={handleToggle}
                    className="flex items-center gap-1.5 text-[11px] text-violet-500 hover:text-violet-700 transition-colors group"
                >
                    <SparkleIcon className={`w-3 h-3 ${isStreaming ? 'animate-spin-slow' : ''}`} />
                    <span className="font-medium">
                        {isStreaming
                            ? 'Thinking...'
                            : steps
                                ? `Reasoning timeline (${steps.length} steps)`
                                : `Reasoning (${wordCount} words)`}
                    </span>
                    <svg
                        className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                {expanded && (
                    <div
                        ref={contentRef}
                        className="mt-1 pl-4 border-l-2 border-violet-200 text-[11px] text-violet-600/80 max-h-60 overflow-y-auto leading-relaxed"
                    >
                        {steps
                            ? <Timeline steps={steps} />
                            : <pre className="whitespace-pre-wrap font-sans">{reasoning || (isStreaming ? '...' : '')}</pre>}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`border rounded-xl transition-all duration-200 ${isStreaming
            ? 'border-violet-300/80 bg-violet-50/70 shadow-sm shadow-violet-100/50'
            : 'border-violet-200/60 bg-violet-50/40'
            }`}>
            {/* Header — always visible */}
            <button
                onClick={handleToggle}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left group"
            >
                <div className="flex items-center gap-2">
                    <SparkleIcon className={`w-4 h-4 text-violet-500 ${isStreaming ? 'animate-spin-slow' : ''}`} />
                    <span className="text-xs font-semibold text-violet-600">
                        {isStreaming
                            ? 'Thinking...'
                            : steps
                                ? `💭 Reasoning timeline`
                                : '💭 Reasoning'}
                    </span>
                    {!isStreaming && steps && (
                        <span className="text-[10px] text-violet-400 font-normal">
                            ({steps.length} steps)
                        </span>
                    )}
                    {!isStreaming && !steps && wordCount > 0 && (
                        <span className="text-[10px] text-violet-400 font-normal">
                            ({wordCount} words)
                        </span>
                    )}
                </div>
                <svg
                    className={`w-4 h-4 text-violet-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Collapsed preview */}
            {!expanded && preview && (
                <div className="px-4 pb-2.5 -mt-1">
                    <p className="text-[11px] text-violet-500/70 leading-relaxed line-clamp-2 italic">
                        {preview}
                    </p>
                </div>
            )}

            {/* Expanded content */}
            {expanded && (
                <div
                    ref={contentRef}
                    className="px-4 pb-3 -mt-0.5 max-h-[28rem] overflow-y-auto"
                >
                    {steps ? (
                        <Timeline steps={steps} />
                    ) : (
                        <div className="text-xs text-violet-600/80 leading-relaxed whitespace-pre-wrap font-mono">
                            {reasoning || (isStreaming ? '...' : '')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
