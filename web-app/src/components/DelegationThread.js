'use client';

/**
 * DelegationThread — renders a delegated specialist's work as a NESTED mini
 * agent-chat (header + live tool calls + streaming markdown), so the user can
 * watch the sub-agent the same way they watch a direct agent chat — without
 * collapsing everything into a single opaque card.
 */

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WrenchIcon, CheckIcon, XIcon } from '@/components/Icons';

function initialsOf(label) {
    const parts = String(label || 'AG').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'AG';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function humanizeTool(name) {
    return String(name || '')
        .replace(/^mcp_[a-z0-9-]+_/i, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || 'Tool';
}

function ToolRow({ tool }) {
    const running = tool.status !== 'complete';
    const failed = tool.status === 'complete' && tool.success === false;
    return (
        <div className="flex items-center gap-2 text-[12px] text-surface-600">
            <WrenchIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
            <span className="truncate font-mono">{humanizeTool(tool.name)}</span>
            <span className="ml-auto shrink-0">
                {running && <span className="text-violet-500">running…</span>}
                {!running && failed && (
                    <span className="inline-flex items-center gap-0.5 text-rose-500">
                        <XIcon className="h-3.5 w-3.5" /> failed
                    </span>
                )}
                {!running && !failed && <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />}
            </span>
        </div>
    );
}

function DelegationThread({ delegation }) {
    const {
        agentLabel = 'Specialist',
        task = '',
        text = '',
        tools = [],
        status = 'running',
        error = null,
    } = delegation || {};

    return (
        <div className="relative my-1 overflow-hidden rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/60 to-white shadow-[0_4px_14px_rgba(124,58,237,0.06)]">
            {/* Left accent rail signals "this is a nested sub-agent" */}
            <span className="absolute inset-y-0 left-0 w-1 bg-violet-400/70" aria-hidden />

            {/* Identity header — mirrors the individual agent chat header */}
            <div className="flex items-center gap-2 border-b border-violet-100/80 px-4 py-2.5 pl-5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">
                    {initialsOf(agentLabel)}
                </div>
                <span className="text-sm font-semibold text-surface-800">{agentLabel}</span>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                    Delegated
                </span>
                <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                    {status === 'running' && (
                        <span className="inline-flex items-center gap-1.5 text-violet-600">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
                            Working…
                        </span>
                    )}
                    {status === 'complete' && <span className="text-emerald-600">✓ Done</span>}
                    {status === 'failed' && <span className="text-rose-600">✕ Failed</span>}
                </div>
            </div>

            {task && (
                <div className="px-4 pl-5 pt-2 text-[11px] text-surface-500">
                    <span className="font-medium text-surface-600">Task:</span> {task}
                </div>
            )}

            {/* Live tool calls */}
            {tools.length > 0 && (
                <div className="space-y-1 px-4 pl-5 pt-2">
                    {tools.map((t, i) => (
                        <ToolRow key={t.key || `${t.name}_${i}`} tool={t} />
                    ))}
                </div>
            )}

            {/* Streaming markdown output — same .chat-markdown styling as the main chat */}
            <div className="px-4 pb-3 pl-5 pt-3">
                {text ? (
                    <div className="chat-markdown text-sm text-surface-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                    </div>
                ) : status === 'running' ? (
                    <div className="text-sm text-surface-400">{agentLabel} is working…</div>
                ) : null}
                {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
            </div>
        </div>
    );
}

export default memo(DelegationThread);
