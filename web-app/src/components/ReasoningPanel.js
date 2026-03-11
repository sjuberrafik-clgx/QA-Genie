'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { SparkleIcon } from '@/components/Icons';

/**
 * ReasoningPanel — collapsible per-message thinking/reasoning display.
 *
 * Shows the LLM's chain-of-thought reasoning that was captured during response generation.
 * Renders as a subtle, collapsible block above or within an assistant message.
 *
 * Props:
 * - `reasoning`: string — the full thinking text
 * - `isStreaming`: boolean — if true, shows live streaming animation
 * - `defaultExpanded`: boolean — start expanded (default: false)
 * - `compact`: boolean — minimal style for inline use (default: false)
 */
export default memo(ReasoningPanel);

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
                        {isStreaming ? 'Thinking...' : `Reasoning (${wordCount} words)`}
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
                        className="mt-1 pl-4 border-l-2 border-violet-200 text-[11px] text-violet-600/80 max-h-40 overflow-y-auto leading-relaxed whitespace-pre-wrap"
                    >
                        {reasoning || (isStreaming ? '...' : '')}
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
                        {isStreaming ? 'Thinking...' : '💭 Reasoning'}
                    </span>
                    {!isStreaming && wordCount > 0 && (
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
                    className="px-4 pb-3 -mt-0.5 max-h-96 overflow-y-auto"
                >
                    <div className="text-xs text-violet-600/80 leading-relaxed whitespace-pre-wrap font-mono">
                        {reasoning || (isStreaming ? '...' : '')}
                    </div>
                </div>
            )}
        </div>
    );
}
