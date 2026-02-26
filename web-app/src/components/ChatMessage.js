'use client';

import { memo, useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SparkleIcon, UserIcon, ClipboardIcon, CheckIcon, XIcon } from '@/components/Icons';

// Lazy-load MermaidBlock (only imported when a mermaid code fence is encountered)
const MermaidBlock = lazy(() => import('@/components/MermaidBlock'));

export default memo(ChatMessage);

function ChatMessage({ message, isStreaming = false }) {
    const { role, content, timestamp, attachments } = message;
    const isUser = role === 'user';
    const [copied, setCopied] = useState(false);
    const [expandedImage, setExpandedImage] = useState(null);

    if (!isUser && !isStreaming && (!content || !content.trim()) && (!attachments || attachments.length === 0)) {
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
                    : 'bg-white/95 backdrop-blur-sm border border-surface-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-tl-sm'
                    }`}>
                    {/* User image attachments */}
                    {isUser && attachments && attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map((att, idx) => (
                                <button
                                    key={att.id || idx}
                                    type="button"
                                    onClick={() => setExpandedImage(att.dataUrl)}
                                    className="block rounded-lg overflow-hidden border border-white/20 hover:ring-2 hover:ring-white/50 transition-all cursor-pointer"
                                >
                                    <img
                                        src={att.dataUrl}
                                        alt={att.name || `Image ${idx + 1}`}
                                        className="max-w-[180px] max-h-[140px] object-cover"
                                    />
                                </button>
                            ))}
                        </div>
                    )}
                    {isUser ? (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed break-words [overflow-wrap:anywhere]">{content}</p>
                    ) : (
                        <div className="chat-markdown text-sm text-surface-800">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({ node, inline, className, children, ...props }) {
                                        // Detect ```mermaid fenced blocks and render as diagrams
                                        const isMermaid = /language-mermaid/.test(className || '');
                                        if (!inline && isMermaid) {
                                            return (
                                                <Suspense fallback={
                                                    <div className="mermaid-container mermaid-loading">
                                                        <span className="text-xs text-surface-400">Loading diagram…</span>
                                                    </div>
                                                }>
                                                    <MermaidBlock>{String(children).replace(/\n$/, '')}</MermaidBlock>
                                                </Suspense>
                                            );
                                        }
                                        // Default code rendering (inline or other languages)
                                        return <code className={className} {...props}>{children}</code>;
                                    },
                                }}
                            >{content || ''}</ReactMarkdown>
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

            {/* Image lightbox overlay */}
            {expandedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
                    onClick={() => setExpandedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors"
                        onClick={() => setExpandedImage(null)}
                        title="Close"
                    >
                        <XIcon className="w-5 h-5 text-white" />
                    </button>
                    <img
                        src={expandedImage}
                        alt="Expanded attachment"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
