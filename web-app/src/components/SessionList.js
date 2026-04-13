'use client';

import { AgentBadge } from '@/components/AgentSelect';
import { ConversationIcon, ChevronDoubleLeftIcon, PlusIcon, EmptyChatIcon, ChatBubbleIcon, TrashIcon } from '@/components/Icons';
import RobotMascotLogo from '@/components/RobotMascotLogo';

function getSessionStatusBadge(session) {
    if (session.runtimeState === 'queued') {
        return {
            label: session.queuePosition > 0 ? `Queued ${session.queuePosition}` : 'Queued',
            className: 'border-surface-200 bg-surface-100 text-surface-600',
        };
    }

    if (session.runtimeState === 'initializing') {
        return {
            label: 'Starting',
            className: 'border-sky-200 bg-sky-50 text-sky-700',
        };
    }

    if (session.runtimeState === 'recovering') {
        return {
            label: 'Recovering',
            className: 'border-amber-200 bg-amber-50 text-amber-700',
        };
    }

    if (session.runtimeState === 'resume_required') {
        return {
            label: 'Resume',
            className: 'border-amber-200 bg-amber-50 text-amber-700',
        };
    }

    if (session.runtimeState === 'failed') {
        return {
            label: 'Failed',
            className: 'border-red-200 bg-red-50 text-red-700',
        };
    }

    if (session.executionState === 'running') {
        return {
            label: session.activeToolCount > 0 ? `Running ${session.activeToolCount}` : 'Running',
            className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        };
    }

    return null;
}

function getActiveSkillBadge(session) {
    const topSkill = Array.isArray(session?.activeProjectSkills) ? session.activeProjectSkills[0] : null;
    if (!topSkill) return null;

    return {
        label: topSkill.name || topSkill.id || 'Skill',
        title: `Auto-invoked skill: ${topSkill.name || topSkill.id}${topSkill.score ? ` (score ${topSkill.score})` : ''}`,
    };
}

export default function SessionList({ sessions, activeSessionId, onSelect, onCreate, onDelete, isCreating = false, isOpen, onToggle }) {
    return (
        <div className={`relative z-10 h-full flex-shrink-0 overflow-hidden border-r bg-white transition-[width,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'w-[248px] border-surface-200/80 shadow-[0_18px_40px_rgba(15,23,42,0.04)] sm:w-[256px] 2xl:w-[280px]' : 'w-0 border-transparent shadow-none'}`}>
            <div className="flex h-full min-w-[248px] flex-col sm:min-w-[256px] 2xl:min-w-[280px]">
                {/* Top accent bar */}
                <div className="h-[2px] bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400 flex-shrink-0" />

                {/* Header */}
                <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl gradient-brand flex items-center justify-center shadow-sm ring-1 ring-brand-500/10">
                                <ConversationIcon className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h2 className="text-[13px] font-bold text-surface-800 leading-tight tracking-tight">Conversations</h2>
                                <p className="text-[10px] text-surface-400 font-medium">{sessions.length} {sessions.length === 1 ? 'chat' : 'chats'}</p>
                            </div>
                        </div>
                        <button
                            onClick={onToggle}
                            className="w-7 h-7 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors text-surface-400 hover:text-surface-600"
                            title="Close panel"
                        >
                            <ChevronDoubleLeftIcon />
                        </button>
                    </div>
                    <button
                        onClick={() => onCreate()}
                        disabled={isCreating}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl gradient-brand text-white text-sm font-semibold shadow-sm shadow-brand-500/15 hover:shadow-md hover:shadow-brand-500/25 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        <PlusIcon className="w-4 h-4" />
                        {isCreating ? 'Starting...' : 'New Chat'}
                    </button>
                </div>

                {/* Divider */}
                <div className="mx-4 border-t border-surface-100" />

                {/* Session list */}
                <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-0.5 session-list-scroll">
                    {sessions.length === 0 ? (
                        <div className="text-center px-4 py-16">
                            <div className="w-14 h-14 mx-auto mb-3 rounded-[20px] bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.12),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(31,158,171,0.14),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] flex items-center justify-center border border-surface-100 shadow-sm">
                                <RobotMascotLogo size={34} mood="minimal" />
                            </div>
                            <p className="text-[12px] text-surface-500 font-medium">No conversations yet</p>
                            <p className="text-[10px] text-surface-400 mt-1">Create a new chat to get started</p>
                            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50/70 px-2.5 py-1 text-[10px] font-medium text-brand-700">
                                <EmptyChatIcon className="w-3.5 h-3.5" />
                                Start with the AI chat workspace
                            </div>
                        </div>
                    ) : (
                        sessions.map((session) => {
                            const isActive = session.sessionId === activeSessionId;
                            const statusBadge = getSessionStatusBadge(session);
                            const skillBadge = getActiveSkillBadge(session);
                            return (
                                <div
                                    key={session.sessionId}
                                    className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 ${isActive
                                        ? 'bg-brand-50/80 shadow-sm shadow-brand-100/50 border border-brand-200/50'
                                        : 'border border-transparent hover:bg-surface-50 hover:border-surface-100'
                                        }`}
                                    onClick={() => onSelect(session.sessionId)}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-brand-100' : 'bg-surface-100'
                                        }`}>
                                        <ChatBubbleIcon className={`w-3.5 h-3.5 ${isActive ? 'text-brand-600' : 'text-surface-400'}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <div className={`text-[12px] font-medium truncate leading-tight ${isActive ? 'text-brand-700' : 'text-surface-700'}`}>
                                                {session.title || `Chat ${session.sessionId.substring(0, 8)}`}
                                            </div>
                                            <AgentBadge agentMode={session.agentMode} size="xs" />
                                            {statusBadge && (
                                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${statusBadge.className}`}>
                                                    {statusBadge.label}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                            <div className="text-[10px] text-surface-400">
                                                {session.messageCount || 0} messages
                                            </div>
                                            {skillBadge && (
                                                <span
                                                    title={skillBadge.title}
                                                    className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-violet-700"
                                                >
                                                    {skillBadge.label}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(session.sessionId);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 text-surface-300 hover:text-red-400 p-1 rounded-lg hover:bg-red-50 transition-all"
                                        title="Delete"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-surface-100">
                    <div className="flex items-center gap-1.5 text-[10px]">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                        <span className="text-surface-400">Powered by </span>
                        <span className="text-amber-500 font-semibold">Doremon Team</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
