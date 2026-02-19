'use client';

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SparkleIcon, UserIcon, ClipboardIcon, CheckIcon } from '@/components/Icons';

export default memo(ChatMessage);

function ChatMessage({ message, isStreaming = false }) {
    const { role, content, timestamp } = message;
    const isUser = role === 'user';
    const [copied, setCopied] = useState(false);

    if (!isUser && !isStreaming && (!content || !content.trim())) {
        return null;
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content || '');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    const formatTime = (ts) => {
        if (!ts) return '';
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            {/* Avatar — square with rounded corners */}
            <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 shadow-sm ${isUser ? 'bg-surface-200' : 'gradient-brand'
                }`}>
                {isUser ? (
                    <UserIcon className="w-4 h-4 text-surface-600" />
                ) : (
                    <SparkleIcon className="w-4 h-4 text-white" />
                )}
            </div>

            {/* Message bubble */}
            <div className="relative max-w-[85%] min-w-0 flex-1">
                {/* Name label */}
                <div className={`text-[11px] font-semibold mb-1 ${isUser ? 'text-right text-surface-500' : 'text-brand-600'}`}>
                    {isUser ? 'You' : 'AI Assistant'}
                    {isStreaming && !isUser && (
                        <span className="ml-2 inline-flex items-center gap-[3px]">
                            <span className="typing-dot" />
                            <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
                            <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
                        </span>
                    )}
                </div>

                <div className={`rounded-2xl px-4 py-3 overflow-hidden ${isUser
                    ? 'bg-brand-600 text-white rounded-tr-sm'
                    : 'bg-white border border-surface-200 shadow-sm rounded-tl-sm'
                    }`}>
                    {isUser ? (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed break-words [overflow-wrap:anywhere]">{content}</p>
                    ) : (
                        <div className="chat-markdown text-sm text-surface-800">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
                        </div>
                    )}
                </div>

                {/* Footer: timestamp + copy */}
                <div className={`flex items-center gap-2 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {timestamp && (
                        <span className="text-[10px] text-surface-400">{formatTime(timestamp)}</span>
                    )}
                    {!isUser && content && !isStreaming && (
                        <button
                            onClick={handleCopy}
                            className="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-brand-500 transition-all p-0.5"
                            title="Copy message"
                        >
                            {copied ? (
                                <CheckIcon className="w-3.5 h-3.5 text-accent-500" />
                            ) : (
                                <ClipboardIcon />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
