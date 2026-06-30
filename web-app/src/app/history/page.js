'use client';

import { useState, useEffect, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import apiClient from '@/lib/api-client';
import ChatMessage from '@/components/ChatMessage';
import ErrorBanner from '@/components/ErrorBanner';
import BouncingLoader from '@/components/BouncingLoader';
import PageHeader from '@/components/PageHeader';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import { formatDate } from '@/lib/report-utils';
import { ClockIcon, SearchIcon, ConversationIcon, TrashIcon, XIcon, LockIcon, ChevronDownIcon } from '@/components/Icons';
import useResetScrollOnRouteChange from '@/hooks/useResetScrollOnRouteChange';

// Stable spacers for the virtualized conversation viewer (replaces the pane's
// px-6 py-5 padding; per-row px-6 is applied in itemContent).
const HISTORY_VIRTUOSO_COMPONENTS = {
    Header: () => <div className="h-5" aria-hidden />,
    Footer: () => <div className="h-5" aria-hidden />,
};

function getSessionDisplayLabel(session) {
    if (session?.title?.trim()) return session.title.trim();
    return session?.sessionId ? `Chat ${session.sessionId.substring(0, 8)}` : 'Chat session';
}

function getDateBucket(dateString) {
    if (!dateString) return 'Earlier';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return 'Earlier';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const ts = d.getTime();
    const dayMs = 86_400_000;
    if (ts >= startOfToday) return 'Today';
    if (ts >= startOfToday - dayMs) return 'Yesterday';
    if (ts >= startOfToday - 7 * dayMs) return 'This week';
    if (ts >= startOfToday - 30 * dayMs) return 'This month';
    return 'Earlier';
}

const BUCKET_ORDER = ['Today', 'Yesterday', 'This week', 'This month', 'Earlier'];

function groupSessionsByBucket(sessions) {
    const buckets = new Map();
    for (const session of sessions) {
        const bucket = getDateBucket(session.createdAt);
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(session);
    }
    return BUCKET_ORDER
        .filter((key) => buckets.has(key))
        .map((key) => [key, buckets.get(key)]);
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
    const [collapsedBuckets, setCollapsedBuckets] = useState(() => new Set(['This month', 'Earlier']));
    const toggleBucket = (bucket) => {
        setCollapsedBuckets((prev) => {
            const next = new Set(prev);
            if (next.has(bucket)) next.delete(bucket); else next.add(bucket);
            return next;
        });
    };
    const historyVirtuosoRef = useRef(null);
    const sessionListRef = useRef(null);
    const messagePaneRef = useRef(null);

    useResetScrollOnRouteChange([sessionListRef, messagePaneRef]);

    // Load all sessions on mount
    useEffect(() => {
        loadSessions();
    }, []);

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
        <div className="motion-page-calm app-page space-y-6">
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

            <div className="grid h-[calc(100vh-13rem)] min-h-[560px] gap-4 lg:gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="surface-panel motion-enter relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_16%,rgba(15,118,110,0.09),transparent_26%),radial-gradient(circle_at_84%_14%,rgba(37,99,235,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]" />
                    <div className="relative flex h-full min-h-0 flex-col">
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
                                <div className="surface-stat-card px-3 py-3">
                                    <p className="type-meta-label">Visible now</p>
                                    <p className="type-metric-value mt-1">{filteredSessions.length}</p>
                                </div>
                                <div className="surface-stat-card px-3 py-3">
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
                                    suppressHydrationWarning
                                    className="field-input py-2.5 pl-9 pr-3 text-xs"
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
                                groupSessionsByBucket(filteredSessions).map(([bucket, items]) => {
                                    const isCollapsed = collapsedBuckets.has(bucket) && !searchQuery.trim();
                                    return (
                                        <div key={bucket} className="mb-2">
                                            <button
                                                type="button"
                                                onClick={() => toggleBucket(bucket)}
                                                className="sticky top-0 z-[1] mb-1 flex w-full items-center gap-2 rounded-lg bg-gradient-to-b from-white/95 via-white/92 to-white/75 px-1.5 py-1.5 text-left backdrop-blur-sm transition-colors hover:bg-white/95"
                                                aria-expanded={!isCollapsed}
                                            >
                                                <ChevronDownIcon
                                                    className={`h-3 w-3 text-surface-500 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                                                    strokeWidth={2.5}
                                                />
                                                <span className="h-[2px] w-2 rounded-full bg-gradient-to-r from-brand-500 to-accent-400" />
                                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-surface-500">{bucket}</span>
                                                <span className="ml-auto rounded-full bg-surface-100 px-1.5 py-0.5 text-[9px] font-semibold text-surface-500">{items.length}</span>
                                            </button>
                                            {!isCollapsed && items.map((session) => {
                                                const isSelected = session.sessionId === selectedSessionId;
                                                const sessionLabel = getSessionDisplayLabel(session);

                                                return (
                                                    <div
                                                        key={session.sessionId}
                                                        className={`motion-fast-colors group relative mb-1.5 cursor-pointer overflow-hidden rounded-xl border pl-2.5 pr-2 py-2 transition-all duration-200 ${isSelected
                                                            ? 'border-brand-200 bg-gradient-to-br from-brand-50/90 via-white to-accent-50/60 shadow-[0_6px_18px_rgba(37,99,235,0.1)]'
                                                            : 'border-surface-200/70 bg-white/85 hover:border-brand-200 hover:bg-white hover:shadow-[0_6px_16px_rgba(15,23,42,0.05)]'
                                                            }`}
                                                        onClick={() => viewSession(session.sessionId)}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(session.sessionId); }}
                                                    >
                                                        <span
                                                            aria-hidden="true"
                                                            className={`absolute inset-y-1.5 left-0 w-[2.5px] rounded-full transition-all duration-200 ${isSelected
                                                                ? 'bg-gradient-to-b from-brand-500 via-brand-400 to-accent-400 opacity-100'
                                                                : 'bg-surface-200 opacity-0 group-hover:opacity-80'
                                                                }`}
                                                        />
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                                                                        <span className={`absolute h-1.5 w-1.5 rounded-full ${session.archived ? 'bg-surface-300' : 'bg-accent-400'}`} />
                                                                        {!session.archived && (
                                                                            <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-accent-400 opacity-60" />
                                                                        )}
                                                                    </span>
                                                                    <span className={`truncate text-[12px] font-semibold leading-tight ${isSelected ? 'text-brand-700' : 'text-surface-800'}`}>
                                                                        {sessionLabel}
                                                                    </span>
                                                                </div>
                                                                <div className="mt-1 flex flex-wrap items-center gap-1 text-[9.5px] text-surface-500">
                                                                    <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-100/80 px-1.5 py-[1px] font-semibold text-surface-600">
                                                                        <ConversationIcon className="h-2 w-2" />
                                                                        {session.messageCount || 0}
                                                                    </span>
                                                                    <span className="inline-flex items-center rounded-full bg-brand-50/80 px-1.5 py-[1px] font-semibold text-brand-700">
                                                                        {session.model || 'gpt-4o'}
                                                                    </span>
                                                                    <span className="truncate text-surface-400">{formatDate(session.createdAt)}</span>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setConfirmDelete(session.sessionId);
                                                                }}
                                                                className="motion-fast-colors shrink-0 rounded-md p-1 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                                                                title="Delete session"
                                                            >
                                                                <TrashIcon className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </aside>

                <section className="surface-panel motion-enter motion-enter-delay-1 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(15,118,110,0.08),transparent_24%),radial-gradient(circle_at_82%_14%,rgba(37,99,235,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))]" />
                    <div className="relative flex h-full min-h-0 flex-col">
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
                                    className="motion-fast-colors inline-flex items-center gap-1.5 rounded-xl border border-surface-200 bg-white/80 px-3 py-2 text-xs font-medium text-surface-600 hover:border-surface-300 hover:bg-surface-50 hover:text-surface-800"
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

                        {selectedSessionId && !loadingHistory && messages.length > 0 ? (
                            <Virtuoso
                                key={selectedSessionId}
                                ref={historyVirtuosoRef}
                                className="flex-1 min-h-0"
                                data={messages}
                                computeItemKey={(index) => index}
                                itemContent={(_, msg) => (
                                    <div className="px-6">
                                        <div className="py-2">
                                            <ChatMessage message={msg} />
                                        </div>
                                    </div>
                                )}
                                components={HISTORY_VIRTUOSO_COMPONENTS}
                                initialTopMostItemIndex={Math.max(0, messages.length - 1)}
                                increaseViewportBy={{ top: 600, bottom: 600 }}
                            />
                        ) : (
                            <div ref={messagePaneRef} className="flex-1 overflow-y-auto px-6 py-5">
                                {!selectedSessionId && (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="max-w-xl text-center">
                                            <div className="history-empty-orbit mx-auto mb-5">
                                                <span className="history-empty-orbit__ring" aria-hidden="true" />
                                                <span className="history-empty-orbit__ring history-empty-orbit__ring--inner" aria-hidden="true" />
                                                <div className="history-empty-orbit__core">
                                                    <RobotMascotLogo size={52} mood="minimal" />
                                                </div>
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

                            </div>
                        )}

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
                    <div className="surface-panel max-w-sm mx-4 p-6" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
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
                                className="motion-fast-colors inline-flex items-center rounded-lg border border-surface-200 bg-surface-100 px-4 py-2 text-xs font-medium text-surface-600 hover:bg-surface-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteSession(confirmDelete)}
                                className="motion-fast-colors inline-flex items-center rounded-lg border border-red-600 bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600"
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
