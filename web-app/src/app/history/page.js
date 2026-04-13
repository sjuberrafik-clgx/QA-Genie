'use client';

import { useState, useEffect, useRef } from 'react';
import apiClient from '@/lib/api-client';
import ChatMessage from '@/components/ChatMessage';
import ErrorBanner from '@/components/ErrorBanner';
import BouncingLoader from '@/components/BouncingLoader';
import PageHeader from '@/components/PageHeader';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import { formatDate } from '@/lib/report-utils';
import { ClockIcon, SearchIcon, ConversationIcon, TrashIcon, XIcon, LockIcon } from '@/components/Icons';
import useResetScrollOnRouteChange from '@/hooks/useResetScrollOnRouteChange';

function getSessionDisplayLabel(session) {
    if (session?.title?.trim()) return session.title.trim();
    return session?.sessionId ? `Chat ${session.sessionId.substring(0, 8)}` : 'Chat session';
}

export default function HistoryPage() {
    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(null);
    const messagesEndRef = useRef(null);
    const sessionListRef = useRef(null);
    const messagePaneRef = useRef(null);

    useResetScrollOnRouteChange([sessionListRef, messagePaneRef]);

    // Load all sessions on mount
    useEffect(() => {
        loadSessions();
    }, []);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const loadSessions = async () => {
        setLoading(true);
        try {
            const data = await apiClient.listChatSessions();
            setSessions(Array.isArray(data) ? data : []);
        } catch {
            setSessions([]);
            setError('Failed to load chat sessions');
        } finally {
            setLoading(false);
        }
    };

    const viewSession = async (sessionId) => {
        setSelectedSessionId(sessionId);
        setMessages([]);
        setLoadingHistory(true);
        try {
            const history = await apiClient.getChatHistory(sessionId);
            if (Array.isArray(history)) {
                setMessages(
                    history
                        .filter(m => {
                            const hasContent = (m.content || '').trim().length > 0;
                            const hasAttachments = Array.isArray(m.attachments) && m.attachments.length > 0;
                            return hasContent || hasAttachments;
                        })
                        .map(m => ({
                            role: m.role || 'assistant',
                            content: m.content || '',
                            timestamp: m.timestamp,
                            ...(Array.isArray(m.attachments) && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
                        }))
                );
            }
        } catch (err) {
            setError(`Failed to load history: ${err.message}`);
        } finally {
            setLoadingHistory(false);
        }
    };

    const deleteSession = async (sessionId) => {
        try {
            await apiClient.deleteChatSession(sessionId);
            setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
            if (selectedSessionId === sessionId) {
                setSelectedSessionId(null);
                setMessages([]);
            }
            setConfirmDelete(null);
        } catch (err) {
            setError(`Failed to delete: ${err.message}`);
        }
    };

    // Filter sessions by search
    const filteredSessions = sessions.filter(s => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const label = getSessionDisplayLabel(s).toLowerCase();
        return (
            label.includes(q) ||
            s.sessionId.toLowerCase().includes(q) ||
            (s.model || '').toLowerCase().includes(q)
        );
    });

    const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId) || null;
    const archivedCount = sessions.filter((session) => session.archived).length;
    const activeCount = sessions.length - archivedCount;

    return (
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
            <PageHeader
                title="Chat History"
                subtitle="Review archived and active sessions from one archive workspace."
                Icon={ClockIcon}
                actions={(
                    <div className="flex flex-wrap items-center gap-1.5">
                        <div className="page-header-panel rounded-xl px-2.5 py-1.5 text-left">
                            <p className="page-header-panel-subtle text-[0.5rem] font-semibold uppercase tracking-[0.16em]">Sessions</p>
                            <p className="text-[0.82rem] font-bold tracking-[-0.02em] text-white mt-0.5">{sessions.length}</p>
                        </div>
                        <div className="page-header-panel rounded-xl px-2.5 py-1.5 text-left">
                            <p className="page-header-panel-subtle text-[0.5rem] font-semibold uppercase tracking-[0.16em]">Active</p>
                            <p className="text-[0.82rem] font-bold tracking-[-0.02em] text-white mt-0.5">{activeCount}</p>
                        </div>
                        <div className="page-header-panel rounded-xl px-2.5 py-1.5 text-left">
                            <p className="page-header-panel-subtle text-[0.5rem] font-semibold uppercase tracking-[0.16em]">Archived</p>
                            <p className="text-[0.82rem] font-bold tracking-[-0.02em] text-white mt-0.5">{archivedCount}</p>
                        </div>
                    </div>
                )}
            />

            <div className="grid min-h-[calc(100vh-13rem)] gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/90 shadow-[0_20px_56px_rgba(15,23,42,0.08)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_16%,rgba(15,118,110,0.09),transparent_26%),radial-gradient(circle_at_84%_14%,rgba(37,99,235,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]" />
                    <div className="relative flex h-full min-h-[620px] flex-col">
                        <div className="border-b border-surface-200/80 px-5 py-5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl gradient-brand shadow-sm">
                                    <ConversationIcon className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="type-card-title text-[1.05rem]">Session archive</h2>
                                    <p className="mt-1 text-[13px] font-medium leading-5 tracking-[-0.01em] text-surface-500">Search, review, and reopen context from prior assistant sessions.</p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <div className="rounded-2xl border border-surface-200/80 bg-white/80 px-3 py-3 shadow-sm">
                                    <p className="type-meta-label">Visible now</p>
                                    <p className="type-metric-value mt-1">{filteredSessions.length}</p>
                                </div>
                                <div className="rounded-2xl border border-surface-200/80 bg-white/80 px-3 py-3 shadow-sm">
                                    <p className="type-meta-label">Selected</p>
                                    <p className="type-metric-value mt-1">{selectedSessionId ? '1 session' : 'None'}</p>
                                </div>
                            </div>

                            <div className="relative mt-4">
                                <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by title, session, or model"
                                    aria-label="Search chat sessions"
                                    className="w-full rounded-xl border border-surface-200 bg-surface-50/80 py-2.5 pl-9 pr-3 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-colors"
                                />
                            </div>
                        </div>

                        <div ref={sessionListRef} className="session-list-scroll flex-1 overflow-y-auto px-3 py-3">
                            {loading ? (
                                <div className="space-y-2 px-1 py-2">
                                    {[1, 2, 3, 4].map((item) => (
                                        <div key={item} className="h-24 animate-pulse rounded-2xl bg-surface-100" />
                                    ))}
                                </div>
                            ) : filteredSessions.length === 0 ? (
                                <div className="px-4 py-14 text-center">
                                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] border border-surface-100 bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.12),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(31,158,171,0.14),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] shadow-sm">
                                        <RobotMascotLogo size={40} mood="minimal" />
                                    </div>
                                    <p className="font-display text-[15px] font-bold tracking-[-0.03em] text-surface-700">
                                        {searchQuery ? 'No matching sessions' : 'No conversation history yet'}
                                    </p>
                                    <p className="mt-1 text-xs leading-6 text-surface-500">
                                        {searchQuery ? 'Try a different keyword or model name.' : 'Start in AI Chat and completed conversations will appear here.'}
                                    </p>
                                </div>
                            ) : (
                                filteredSessions.map((session) => {
                                    const isSelected = session.sessionId === selectedSessionId;
                                    const sessionLabel = getSessionDisplayLabel(session);

                                    return (
                                        <div
                                            key={session.sessionId}
                                            className={`group mb-2 cursor-pointer rounded-2xl border p-3.5 transition-all duration-150 ${isSelected
                                                ? 'border-brand-200 bg-brand-50/80 shadow-sm'
                                                : 'border-surface-200/70 bg-white/80 hover:border-brand-200 hover:bg-white hover:shadow-sm'
                                                }`}
                                            onClick={() => viewSession(session.sessionId)}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(session.sessionId); }}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="mb-1.5 flex items-center gap-2">
                                                        <span className={`h-2 w-2 rounded-full ${session.archived ? 'bg-surface-300' : 'bg-accent-400'}`} />
                                                        <span className={`truncate text-[13px] font-semibold ${isSelected ? 'text-brand-700' : 'text-surface-800'}`}>
                                                            {sessionLabel}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${session.archived
                                                            ? 'bg-surface-100 text-surface-500'
                                                            : 'bg-accent-50 text-accent-700 ring-1 ring-accent-200'
                                                            }`}>
                                                            {session.archived ? 'Archived' : 'Active'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-surface-500">
                                                        <span>{session.messageCount || 0} messages</span>
                                                        <span>{session.model || 'gpt-4o'}</span>
                                                        <span>{formatDate(session.createdAt)}</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setConfirmDelete(session.sessionId);
                                                    }}
                                                    className="rounded-lg p-1.5 text-red-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                                                    title="Delete session"
                                                >
                                                    <TrashIcon className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </aside>

                <section className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/92 shadow-[0_20px_56px_rgba(15,23,42,0.08)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(15,118,110,0.08),transparent_24%),radial-gradient(circle_at_82%_14%,rgba(37,99,235,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))]" />
                    <div className="relative flex h-full min-h-[620px] flex-col">
                        <div className="flex items-center justify-between gap-3 border-b border-surface-200/80 px-6 py-5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-100 shadow-sm">
                                    <ClockIcon className="h-5 w-5 text-surface-500" />
                                </div>
                                <div>
                                    <h2 className="type-card-title text-[1.05rem]">
                                        {selectedSession ? 'Conversation Viewer' : 'Conversation Preview'}
                                    </h2>
                                    <p className="mt-1 text-[13px] font-medium leading-5 tracking-[-0.01em] text-surface-500">
                                        {selectedSession
                                            ? `${getSessionDisplayLabel(selectedSession)} • ${selectedSession.model || 'gpt-4o'}`
                                            : 'Choose a session from the archive to inspect messages and attachments.'}
                                    </p>
                                </div>
                            </div>
                            {selectedSession && (
                                <button
                                    onClick={() => { setSelectedSessionId(null); setMessages([]); }}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-surface-200 bg-white/80 px-3 py-2 text-xs font-medium text-surface-600 transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-800"
                                >
                                    <XIcon className="h-3.5 w-3.5" />
                                    Close
                                </button>
                            )}
                        </div>

                        {error && (
                            <div className="px-6 pt-4">
                                <ErrorBanner error={error} onDismiss={() => setError(null)} />
                            </div>
                        )}

                        <div ref={messagePaneRef} className="flex-1 overflow-y-auto px-6 py-5">
                            {!selectedSessionId && (
                                <div className="flex h-full items-center justify-center">
                                    <div className="max-w-xl text-center">
                                        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-surface-100 bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.14),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(31,158,171,0.16),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] shadow-sm">
                                            <RobotMascotLogo size={48} mood="minimal" />
                                        </div>
                                        <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-brand-50/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600">
                                            <ConversationIcon className="h-3.5 w-3.5" />
                                            Archive workspace
                                        </div>
                                        <h3 className="type-section-title mt-4 text-[1.7rem]">Review prior conversations without losing the current workspace style.</h3>
                                        <p className="mt-3 text-[15px] font-medium leading-8 tracking-[-0.012em] text-surface-500">
                                            Select any archived or active session from the left panel to inspect the conversation, attachments, and context that was generated during that run.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {loadingHistory && (
                                <div className="flex h-full items-center justify-center py-12">
                                    <BouncingLoader
                                        label="Loading conversation"
                                        caption="Retrieving messages, attachments, and session metadata."
                                        size="lg"
                                    />
                                </div>
                            )}

                            {selectedSessionId && !loadingHistory && messages.length === 0 && (
                                <div className="flex items-center justify-center py-12">
                                    <div className="text-center">
                                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[20px] border border-surface-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] shadow-sm">
                                            <RobotMascotLogo size={34} mood="minimal" />
                                        </div>
                                        <p className="text-sm text-surface-500">No messages were stored in this session.</p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-4">
                                {messages.map((msg, i) => (
                                    <ChatMessage key={i} message={msg} />
                                ))}
                            </div>

                            <div ref={messagesEndRef} />
                        </div>

                        {selectedSessionId && (
                            <div className="border-t border-surface-200/80 bg-surface-50/80 px-6 py-3">
                                <div className="flex items-center gap-2 text-xs text-surface-500">
                                    <LockIcon className="h-3.5 w-3.5" />
                                    <span>Read-only view. Go to <a href="/chat" className="font-medium text-brand-600 hover:underline">AI Chat</a> to start or continue a live conversation.</span>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* Delete Confirmation Modal */}
            {confirmDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl border border-surface-200 p-6 max-w-sm mx-4" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                                <TrashIcon className="w-5 h-5 text-red-500" />
                            </div>
                            <div>
                                <h3 id="delete-modal-title" className="text-sm font-bold text-surface-900">Delete Session</h3>
                                <p className="text-[11px] text-surface-500">This action cannot be undone</p>
                            </div>
                        </div>
                        <p className="text-sm text-surface-600 mb-5">
                            Are you sure you want to delete this chat session? The conversation will be permanently removed from the server.
                        </p>
                        <div className="flex items-center gap-2 justify-end">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-4 py-2 text-xs font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteSession(confirmDelete)}
                                className="px-4 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
