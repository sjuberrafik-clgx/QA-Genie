'use client';

import { useState, useEffect, useRef } from 'react';
import apiClient from '@/lib/api-client';
import ChatMessage from '@/components/ChatMessage';
import ErrorBanner from '@/components/ErrorBanner';
import { formatDate } from '@/lib/report-utils';
import { ClockIcon, SearchIcon, ConversationIcon, TrashIcon, XIcon, LockIcon } from '@/components/Icons';

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
                        .filter(m => (m.content || '').trim().length > 0)
                        .map(m => ({
                            role: m.role || 'assistant',
                            content: m.content || '',
                            timestamp: m.timestamp,
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
        return (
            s.sessionId.toLowerCase().includes(q) ||
            (s.model || '').toLowerCase().includes(q)
        );
    });

    return (
        <div className="flex h-screen bg-surface-50">
            {/* Session List Sidebar */}
            <div className="w-[320px] bg-white border-r border-surface-200 flex flex-col h-full">
                {/* Header */}
                <div className="px-5 py-4 border-b border-surface-200">
                    <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-sm">
                            <ClockIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-sm font-bold text-surface-900">Chat History</h1>
                            <p className="text-[11px] text-surface-500">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search sessions..."
                            aria-label="Search chat sessions"
                            className="w-full pl-9 pr-3 py-2 text-xs bg-surface-50 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                        />
                    </div>
                </div>

                {/* Session cards */}
                <div className="flex-1 overflow-y-auto py-2 px-2">
                    {loading ? (
                        <div className="space-y-2 p-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="animate-pulse bg-surface-100 rounded-xl h-20" />
                            ))}
                        </div>
                    ) : filteredSessions.length === 0 ? (
                        <div className="text-center py-12 px-4">
                            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-100 flex items-center justify-center">
                                <ConversationIcon className="w-7 h-7 text-surface-300" />
                            </div>
                            <p className="text-sm font-medium text-surface-500">
                                {searchQuery ? 'No matching sessions' : 'No chat history yet'}
                            </p>
                            <p className="text-xs text-surface-400 mt-1">
                                {searchQuery ? 'Try a different search' : 'Start a chat from the AI Chat page'}
                            </p>
                        </div>
                    ) : (
                        filteredSessions.map((session) => {
                            const isSelected = session.sessionId === selectedSessionId;
                            return (
                                <div
                                    key={session.sessionId}
                                    className={`group rounded-xl p-3 cursor-pointer transition-all duration-150 mb-1.5 ${isSelected
                                        ? 'bg-brand-50 border border-brand-200 shadow-sm'
                                        : 'hover:bg-surface-50 border border-transparent hover:border-surface-200'
                                        }`}
                                    onClick={() => viewSession(session.sessionId)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(session.sessionId); }}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${session.archived ? 'bg-surface-300' : 'bg-accent-400'
                                                    }`} />
                                                <span className={`text-xs font-semibold truncate ${isSelected ? 'text-brand-700' : 'text-surface-800'
                                                    }`}>
                                                    {session.sessionId.substring(0, 16)}...
                                                </span>
                                                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${session.archived
                                                    ? 'bg-surface-100 text-surface-500'
                                                    : 'bg-accent-50 text-accent-700 ring-1 ring-accent-200'
                                                    }`}>
                                                    {session.archived ? 'Archived' : 'Active'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] text-surface-500">
                                                <span>{session.messageCount || 0} messages</span>
                                                <span className="text-surface-300">|</span>
                                                <span>{session.model || 'gpt-4o'}</span>
                                            </div>
                                            <div className="text-[10px] text-surface-400 mt-1">
                                                {formatDate(session.createdAt)}
                                            </div>
                                        </div>

                                        {/* Delete button */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setConfirmDelete(session.sessionId);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-all flex-shrink-0"
                                            title="Delete session"
                                        >
                                            <TrashIcon className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Chat Viewer */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="px-6 py-3.5 border-b border-surface-200 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-surface-100 flex items-center justify-center">
                            <ClockIcon className="w-5 h-5 text-surface-500" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-surface-900">
                                {selectedSessionId ? 'Conversation' : 'Chat History'}
                            </h2>
                            <p className="text-[11px] text-surface-500">
                                {selectedSessionId
                                    ? `Session: ${selectedSessionId.substring(0, 16)}...`
                                    : 'Select a session to view conversation'
                                }
                            </p>
                        </div>
                    </div>
                    {selectedSessionId && (
                        <button
                            onClick={() => { setSelectedSessionId(null); setMessages([]); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-600 hover:text-surface-800 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
                        >
                            <XIcon className="w-3.5 h-3.5" />
                            Close
                        </button>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-5 mt-3">
                        <ErrorBanner error={error} onDismiss={() => setError(null)} />
                    </div>
                )}

                {/* Messages area */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {!selectedSessionId && (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
                                    <ClockIcon className="w-8 h-8 text-surface-300" />
                                </div>
                                <h2 className="text-lg font-bold text-surface-900 mb-1">Chat History</h2>
                                <p className="text-sm text-surface-500 max-w-md leading-relaxed">
                                    Browse past conversations with the AI Assistant.
                                    Select a session from the left to view the conversation.
                                </p>
                            </div>
                        </div>
                    )}

                    {loadingHistory && (
                        <div className="flex items-center justify-center py-12">
                            <div className="flex items-center gap-3">
                                <svg className="w-5 h-5 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-sm text-surface-500">Loading conversation...</span>
                            </div>
                        </div>
                    )}

                    {selectedSessionId && !loadingHistory && messages.length === 0 && (
                        <div className="flex items-center justify-center py-12">
                            <p className="text-sm text-surface-400">No messages in this session</p>
                        </div>
                    )}

                    {messages.map((msg, i) => (
                        <ChatMessage key={i} message={msg} />
                    ))}

                    <div ref={messagesEndRef} />
                </div>

                {/* Read-only notice */}
                {selectedSessionId && (
                    <div className="px-5 py-3 border-t border-surface-200 bg-surface-50">
                        <div className="flex items-center gap-2 text-xs text-surface-500">
                            <LockIcon className="w-3.5 h-3.5" />
                            <span>Read-only view — go to <a href="/chat" className="text-brand-600 font-medium hover:underline">AI Chat</a> to start a new conversation</span>
                        </div>
                    </div>
                )}
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
