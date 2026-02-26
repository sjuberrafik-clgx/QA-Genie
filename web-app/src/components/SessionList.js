'use client';

import { AgentBadge } from '@/components/AgentSelect';
import { ConversationIcon, ChevronDoubleLeftIcon, PlusIcon, EmptyChatIcon, ChatBubbleIcon, TrashIcon } from '@/components/Icons';

export default function SessionList({ sessions, activeSessionId, onSelect, onCreate, onDelete, isOpen, onToggle }) {
    return (
        <div className={`flex-shrink-0 h-full bg-white border-r transition-[width,border-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden ${isOpen ? 'w-[280px] border-surface-200/80' : 'w-0 border-transparent'}`}>
            <div className="min-w-[280px] flex flex-col h-full">
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
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl gradient-brand text-white text-sm font-semibold shadow-sm shadow-brand-500/15 hover:shadow-md hover:shadow-brand-500/25 transition-all active:scale-[0.98]"
                    >
                        <PlusIcon className="w-4 h-4" />
                        New Chat
                    </button>
                </div>

                {/* Divider */}
                <div className="mx-4 border-t border-surface-100" />

                {/* Session list */}
                <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-0.5 session-list-scroll">
                    {sessions.length === 0 ? (
                        <div className="text-center px-4 py-16">
                            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-surface-50 flex items-center justify-center border border-surface-100">
                                <EmptyChatIcon className="w-6 h-6 text-surface-300" />
                            </div>
                            <p className="text-[12px] text-surface-500 font-medium">No conversations yet</p>
                            <p className="text-[10px] text-surface-400 mt-1">Create a new chat to get started</p>
                        </div>
                    ) : (
                        sessions.map((session) => {
                            const isActive = session.sessionId === activeSessionId;
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
                                        </div>
                                        <div className="text-[10px] text-surface-400 mt-0.5">
                                            {session.messageCount || 0} messages
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
