'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import ModelSelect from '@/components/ModelSelect';
import useModelCatalog from '@/hooks/useModelCatalog';
import { getDefaultModel } from '@/lib/model-options';
import { SparkleIcon, XIcon, ChatBubbleIcon, ChevronDownIcon } from '@/components/Icons';

/**
 * MyAgentsLauncher — dedicated surface for user-created (custom) agents.
 *
 * Two ways to render:
 *   • <MyAgentsLauncher variant="trigger" /> — renders a compact header button
 *     that toggles the launcher popover. Use in the chat header.
 *   • <MyAgentsLauncher variant="controlled" open onClose /> — headless modal
 *     controlled by the parent. Use from My Agents page.
 *
 * Regardless of variant, the launcher:
 *   • Lists the user's active custom agents (isCustom + isActive)
 *   • Lets the user pick a model per launch
 *   • Either calls `onLaunch(agent, model)` if provided (for in-chat switching)
 *     or navigates to `/chat?agentId=…&model=…` for a fresh session.
 */
export default function MyAgentsLauncher({
    variant = 'trigger',
    agents = [],
    open: controlledOpen,
    onClose,
    onLaunch,
    initialAgentId,
    initialModel,
    anchor = 'below',
    className = '',
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = variant === 'controlled';
    const open = isControlled ? !!controlledOpen : internalOpen;
    const setOpen = (next) => {
        if (isControlled) {
            if (!next) onClose?.();
        } else {
            setInternalOpen(next);
        }
    };

    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    const customAgents = useMemo(
        () => (Array.isArray(agents) ? agents : []).filter((a) => a?.isCustom === true),
        [agents]
    );
    const activeCustomAgents = useMemo(
        () => customAgents.filter((a) => a.isActive !== false),
        [customAgents]
    );

    const { groups: modelGroups, defaultModel, loading: modelLoading } = useModelCatalog();

    const [selectedAgentId, setSelectedAgentId] = useState(
        initialAgentId || activeCustomAgents[0]?.id || null
    );
    const [selectedModel, setSelectedModel] = useState(initialModel || '');
    const [isLaunching, setIsLaunching] = useState(false);

    // Keep the selection valid when the list loads/changes.
    useEffect(() => {
        if (!open) return;
        if (!activeCustomAgents.length) {
            setSelectedAgentId(null);
            return;
        }
        const stillValid = activeCustomAgents.some((a) => a.id === selectedAgentId);
        if (!stillValid) {
            setSelectedAgentId(initialAgentId && activeCustomAgents.some((a) => a.id === initialAgentId)
                ? initialAgentId
                : activeCustomAgents[0].id);
        }
    }, [open, activeCustomAgents, selectedAgentId, initialAgentId]);

    // When the parent's "current" model changes (e.g., user picks a different model in the chat
    // header dropdown), mirror it in the launcher so the two controls never drift out of sync.
    useEffect(() => {
        if (initialModel && initialModel !== selectedModel) {
            setSelectedModel(initialModel);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialModel]);

    useEffect(() => {
        if (!selectedModel && defaultModel) setSelectedModel(defaultModel);
    }, [defaultModel, selectedModel]);

    // Close popover on outside click / escape (trigger variant only)
    useEffect(() => {
        if (!open || isControlled) return undefined;
        const onDown = (e) => {
            const t = e.target;
            if (
                triggerRef.current?.contains(t)
                || popoverRef.current?.contains(t)
                || (t.closest && t.closest('[data-model-dropdown]'))
            ) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, isControlled]);

    const selectedAgent = activeCustomAgents.find((a) => a.id === selectedAgentId) || null;

    const handleLaunch = () => {
        if (!selectedAgent || isLaunching) return;
        const modelToUse = selectedModel || defaultModel || getDefaultModel(modelGroups);
        if (typeof onLaunch === 'function') {
            onLaunch(selectedAgent, modelToUse);
            setOpen(false);
            return;
        }
        setIsLaunching(true);
        const qp = new URLSearchParams();
        qp.set('agentId', selectedAgent.id);
        if (modelToUse) qp.set('model', modelToUse);
        // Signal the chat page to immediately create a fresh session on load.
        qp.set('newSession', '1');
        window.location.href = `/chat?${qp.toString()}`;
    };

    const body = (
        <div className="flex min-h-[22rem] w-full flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-surface-200/70 bg-gradient-to-r from-violet-50 via-white to-white px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 ring-1 ring-violet-200/70">
                        <SparkleIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500">My Agents</p>
                        <h3 className="truncate text-sm font-semibold text-surface-900">
                            Launch a custom agent
                        </h3>
                    </div>
                </div>
                {isControlled && (
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-800"
                        aria-label="Close"
                    >
                        <XIcon className="h-4 w-4" />
                    </button>
                )}
            </header>

            <div className="flex flex-1 min-h-0 flex-col gap-3 p-4 sm:flex-row">
                {/* Agent list */}
                <div className="flex max-h-[18rem] flex-col gap-1.5 overflow-y-auto rounded-2xl border border-surface-200/70 bg-surface-50/60 p-1.5 sm:w-[16rem] sm:max-h-none">
                    {activeCustomAgents.length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-white/60 px-3 py-8 text-center">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-500">
                                <SparkleIcon className="h-4 w-4" />
                            </div>
                            <p className="text-[12px] font-semibold text-surface-700">No active custom agents</p>
                            <p className="text-[11px] text-surface-500">
                                Publish and activate an agent in Studio to use it here.
                            </p>
                            <Link
                                href="/my-agents"
                                onClick={() => setOpen(false)}
                                className="mt-1 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
                            >
                                Open My Agents
                            </Link>
                        </div>
                    ) : activeCustomAgents.map((agent) => {
                        const isSel = agent.id === selectedAgentId;
                        return (
                            <button
                                key={agent.id}
                                type="button"
                                onClick={() => setSelectedAgentId(agent.id)}
                                className={`group flex items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${isSel
                                    ? 'border-violet-300 bg-white shadow-sm ring-1 ring-violet-200/70'
                                    : 'border-transparent hover:border-surface-200 hover:bg-white'
                                    }`}
                            >
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${agent.bgClass || 'bg-violet-50'} ${agent.textClass || 'text-violet-600'}`}>
                                    <SparkleIcon className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-[12px] font-semibold text-surface-900">{agent.label}</span>
                                        <span className={`inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold ${agent.badgeBg || 'bg-violet-100'} ${agent.badgeText || 'text-violet-700'}`}>
                                            {agent.shortLabel}
                                        </span>
                                    </div>
                                    {agent.workspaceName && (
                                        <p className="truncate text-[10px] text-surface-500">
                                            <span className="text-surface-400">Workspace · </span>
                                            {agent.workspaceName}
                                        </p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Details + model picker */}
                <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-surface-200/70 bg-white p-3">
                    {selectedAgent ? (
                        <>
                            <div className="flex items-start gap-3">
                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selectedAgent.bgClass || 'bg-violet-50'} ${selectedAgent.textClass || 'text-violet-600'}`}>
                                    <SparkleIcon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="truncate text-sm font-semibold text-surface-900">{selectedAgent.label}</h4>
                                    <p className="mt-0.5 text-[11px] text-surface-500">
                                        {selectedAgent.workspaceName ? `From ${selectedAgent.workspaceName}` : 'Custom agent'} · Tool profile: {selectedAgent.toolProfile || 'full'}
                                    </p>
                                </div>
                            </div>

                            <p className="mt-2.5 line-clamp-4 text-[12px] leading-5 text-surface-600">
                                {selectedAgent.description || 'No description provided for this agent yet.'}
                            </p>

                            <div className="mt-3">
                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-surface-500">
                                    Model for this session
                                </label>
                                <ModelSelect
                                    value={selectedModel}
                                    onChange={setSelectedModel}
                                    groups={modelGroups}
                                    loading={modelLoading}
                                    className="w-full"
                                />
                                <p className="mt-1 text-[10.5px] text-surface-400">
                                    Choose the model that should power this conversation. You can still switch later from the chat header.
                                </p>
                            </div>

                            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                                <Link
                                    href={`/studio?workspace=${encodeURIComponent(selectedAgent.workspaceId || '')}&tab=agents&agent=${encodeURIComponent(selectedAgent.assetId || '')}`}
                                    onClick={() => setOpen(false)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                                >
                                    Open in Studio
                                </Link>
                                <button
                                    type="button"
                                    onClick={handleLaunch}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={!selectedAgent || isLaunching}
                                >
                                    {isLaunching ? (
                                        <>
                                            <span
                                                className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
                                                aria-hidden="true"
                                            />
                                            Opening chat...
                                        </>
                                    ) : (
                                        <>
                                            <ChatBubbleIcon className="h-3.5 w-3.5" />
                                            {onLaunch ? 'Use in current chat' : 'Launch new chat'}
                                        </>
                                    )}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-[12px] text-surface-500">
                            Select an agent on the left to configure and launch.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (isControlled) {
        if (typeof document === 'undefined' || !open) return null;
        return createPortal(
            <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-surface-900/40 backdrop-blur-sm p-4">
                <div
                    className="w-full max-w-2xl overflow-hidden rounded-2xl border border-surface-200/80 bg-white shadow-[0_28px_64px_rgba(15,23,42,0.25)]"
                    role="dialog"
                    aria-modal="true"
                >
                    {body}
                </div>
            </div>,
            document.body
        );
    }

    // Trigger + popover
    const customCount = activeCustomAgents.length;
    return (
        <div className={`relative ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(!open)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${open
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-50'
                    }`}
                title="Launch one of your custom agents"
            >
                <SparkleIcon className="h-3.5 w-3.5 text-violet-500" />
                <span>My Agents</span>
                {customCount > 0 && (
                    <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-violet-100 px-1 text-[9.5px] font-bold text-violet-700">
                        {customCount}
                    </span>
                )}
                <ChevronDownIcon className="h-3 w-3 opacity-70" />
            </button>

            {open && (
                <div
                    ref={popoverRef}
                    className={`absolute right-0 z-[9000] mt-2 w-[min(32rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-surface-200/80 bg-white shadow-[0_22px_54px_rgba(15,23,42,0.22)] ${anchor === 'above' ? 'bottom-full mb-2 mt-0' : ''}`}
                >
                    {body}
                </div>
            )}
        </div>
    );
}
