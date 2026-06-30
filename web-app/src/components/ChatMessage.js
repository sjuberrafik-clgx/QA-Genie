'use client';

import { memo, useState, lazy, Suspense } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
// Perf: CodeBlock pulls in react-syntax-highlighter (~300kB of Prism themes).
// Only loaded when a message actually contains a fenced code block.
const CodeBlock = dynamic(() => import('@/components/CodeBlock'), {
    loading: () => (
        <pre className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[11px] text-surface-400">
            Loading code…
        </pre>
    ),
});
import ChatTable from '@/components/ChatTable';
import { tryRenderAlert } from '@/components/ChatAlert';
import { FileAttachmentCard } from '@/components/FilePreview';
import { SparkleIcon, UserIcon, XIcon, PhotoIcon } from '@/components/Icons';
import { normalizeSemanticCallouts } from '@/lib/semantic-highlighting';
import { tryRenderStatusPill } from '@/components/StatusPill';
import { getAgentTheme, getAgentThemeCssVars } from '@/lib/agentTheme';
import MessageToolbar from '@/components/MessageToolbar';
import { resolveBackendUrl } from '@/lib/api-config';

// Lazy-load MermaidBlock (only imported when a mermaid code fence is encountered)
const MermaidBlock = lazy(() => import('@/components/MermaidBlock'));

// Live-streaming markdown pipeline (lightweight). While a reply streams we still
// want structured output — especially test-case TABLES, headings and lists — to
// be legible as it arrives, instead of raw "| a | b |" pipes. We render the
// growing buffer through ReactMarkdown with ONLY remark-gfm: no KaTeX (partial
// "$…$" mid-stream renders as red errors), no Prism syntax highlighting and no
// Mermaid (re-tokenizing / diagram-parsing an incomplete block on every ~90ms
// flush is wasted CPU, and Mermaid throws on half-written diagrams). Tables,
// headings, lists and inline formatting are styled by the `.chat-markdown` CSS.
// The full rich render (highlighting, diagrams, math, status pills, semantic
// callouts, scrollable ChatTable) happens once the message finalizes.
const STREAMING_REMARK_PLUGINS = [remarkGfm];
// Above this buffer size the streaming bubble falls back to plain text. Re-parsing
// a very large growing string on every flush is the O(n^2) CPU pattern the perf
// work warned about; virtualization keeps memory bounded, but this caps CPU.
// Finalize still renders the complete message as full rich markdown.
const STREAMING_MARKDOWN_MAX_CHARS = 60000;

// Renders a single image attachment tile. Image bytes are served on demand from
// the backend (att.url) instead of being inlined as base64, so the browser
// decodes them off the JS heap. Falls back to a lightweight placeholder when the
// attachment was evicted server-side or the fetch fails (404 after budget
// eviction) — never a broken-image icon.
// Tiles render small (~240px) but the browser decodes the FULL-resolution image
// into a bitmap (width×height×4 bytes) regardless of CSS size. Across many
// screenshots in one session those decoded bitmaps — not base64 — dominate
// renderer memory and trigger the Chrome STATUS_BREAKPOINT crash. Request a
// downscaled thumbnail from the backend for the tile; the lightbox still opens
// the full-resolution image.
const TILE_THUMBNAIL_WIDTH = 480; // 2× the ~240px tile for crisp rendering on HiDPI displays

function ChatImageTile({ att, idx, onExpand, buttonClassName, imgClassName, placeholderClassName }) {
    const [errored, setErrored] = useState(false);
    const fullSrc = resolveBackendUrl(att.url || att.dataUrl);
    if (att.evicted || errored || !fullSrc) {
        return (
            <div title="Image unloaded to free memory" className={placeholderClassName}>
                <PhotoIcon className="w-5 h-5 mb-1 opacity-70" />
                <span className="leading-tight">Image unloaded<br />to save memory</span>
            </div>
        );
    }
    // Only backend-served references (path-relative URLs) can be resized server
    // side; data:/blob:/remote URLs are used as-is.
    const isBackendRef = typeof att.url === 'string' && att.url.startsWith('/');
    const thumbSrc = isBackendRef
        ? `${fullSrc}${fullSrc.includes('?') ? '&' : '?'}w=${TILE_THUMBNAIL_WIDTH}`
        : fullSrc;
    return (
        <button type="button" onClick={() => onExpand(fullSrc)} className={buttonClassName}>
            {/* Tile uses a small backend thumbnail; the lightbox opens full-res. Native lazy/async decoding keeps it off the JS heap. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={thumbSrc}
                alt={att.alt || att.name || `Image ${idx + 1}`}
                className={imgClassName}
                loading="lazy"
                decoding="async"
                onError={() => setErrored(true)}
            />
        </button>
    );
}

export default memo(ChatMessage);

function ChatMessage({ message, isStreaming = false, agent = null, onAction = null, onFeedback = null }) {
    const { role, content, timestamp, attachments } = message;
    const isUser = role === 'user';
    // While streaming, skip semantic-callout normalization. It re-scans the whole
    // growing buffer on every ~90ms flush (O(n²) over a long reply) and the
    // streaming branch renders plain text anyway. The full normalization runs once
    // when the message finalizes and renders through ReactMarkdown.
    const renderedContent = (isUser || isStreaming) ? (content || '') : normalizeSemanticCallouts(content || '');
    const [expandedImage, setExpandedImage] = useState(null);

    // Resolve agent theme — accepts either a prop or a message-attached agentId.
    const agentTheme = getAgentTheme(agent || message.agentId || message.agentMode || null);
    const themeVars = getAgentThemeCssVars(agent || message.agentId || message.agentMode || null);
    const agentLabel = (agent && (agent.label || agent.name)) || agentTheme.label;

    const imageAttachments = Array.isArray(attachments)
        ? attachments.filter(att => att.kind === 'image' || (att.dataUrl && att.kind !== 'document' && att.kind !== 'artifact' && att.kind !== 'video'))
        : [];
    const documentAttachments = Array.isArray(attachments)
        ? attachments.filter(att => att.kind === 'document' || att.kind === 'artifact')
        : [];

    if (!isUser && !isStreaming && (!content || !content.trim()) && (!attachments || attachments.length === 0)) {
        return null;
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content || '');
        } catch { /* ignore */ }
    };

    const formatTime = (ts) => {
        if (!ts) return '';
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div
            className={`group flex gap-3 message-entrance ${isUser ? 'flex-row-reverse' : ''}`}
            style={isUser ? undefined : themeVars}
        >
            {/* Avatar — square with rounded corners; agent-tinted gradient for assistant */}
            <div
                className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 shadow-sm ${isUser ? 'bg-surface-200' : ''}`}
                style={isUser ? undefined : { background: 'var(--agent-gradient)' }}
            >
                {isUser ? (
                    <UserIcon className="w-4 h-4 text-surface-600" />
                ) : (
                    <SparkleIcon className="w-4 h-4 text-white" />
                )}
            </div>

            {/* Message bubble */}
            <div className="relative max-w-[85%] min-w-0 flex-1">
                {/* Name label + streaming indicator */}
                <div className={`text-[11px] font-semibold mb-1 ${isUser ? 'text-right text-surface-500' : ''}`}
                    style={isUser ? undefined : { color: 'var(--agent-accent-text)' }}
                >
                    {isUser ? 'You' : agentLabel}
                    {isStreaming && !isUser && (
                        <span className="ml-2 inline-flex items-center gap-[3px]">
                            <span className="typing-dot" />
                            <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
                            <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
                        </span>
                    )}
                </div>

                <div className={`chat-bubble relative rounded-2xl px-4 py-3 ${isUser
                    ? 'bg-brand-600 text-white rounded-tr-sm'
                    : 'chat-bubble--assistant bg-white/95 backdrop-blur-sm border border-surface-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-tl-sm'
                    }`}>
                    {/* Agent accent ribbon (assistant only) */}
                    {!isUser && <span className="chat-bubble__ribbon" aria-hidden />}
                    {/* User image attachments */}
                    {isUser && imageAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {imageAttachments.map((att, idx) => (
                                <ChatImageTile
                                    key={att.id || idx}
                                    att={att}
                                    idx={idx}
                                    onExpand={setExpandedImage}
                                    buttonClassName="block rounded-lg overflow-hidden border border-white/20 hover:ring-2 hover:ring-white/50 transition-all cursor-pointer"
                                    imgClassName="max-w-[180px] max-h-[140px] object-cover"
                                    placeholderClassName="flex flex-col items-center justify-center w-[120px] h-[90px] rounded-lg border border-dashed border-white/30 bg-white/10 text-white/70 text-[10px] text-center px-2"
                                />
                            ))}
                        </div>
                    )}
                    {/* User document attachments */}
                    {isUser && documentAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {documentAttachments.map((att, idx) => (
                                <FileAttachmentCard key={att.id || `doc-${idx}`} attachment={att} isUser />
                            ))}
                        </div>
                    )}
                    {isUser ? (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed break-words [overflow-wrap:anywhere]">{content}</p>
                    ) : isStreaming ? (
                        // While streaming, render structural markdown (tables, headings,
                        // lists) via a lightweight remark-gfm-only pipeline so test-case
                        // tables are legible AS THEY STREAM instead of raw "| a | b |" pipes.
                        // KaTeX/Prism/Mermaid and the scrollable ChatTable are deferred to
                        // finalize (see STREAMING_REMARK_PLUGINS). Very large buffers fall
                        // back to plain text to bound the per-flush re-parse cost.
                        <div className="chat-markdown text-sm text-surface-800 streaming-cursor">
                            {renderedContent.length <= STREAMING_MARKDOWN_MAX_CHARS ? (
                                <ReactMarkdown remarkPlugins={STREAMING_REMARK_PLUGINS}>
                                    {renderedContent}
                                </ReactMarkdown>
                            ) : (
                                <p className="whitespace-pre-wrap leading-relaxed break-words [overflow-wrap:anywhere]">{renderedContent}</p>
                            )}
                        </div>
                    ) : (
                        <div className="chat-markdown text-sm text-surface-800">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{
                                    // Strip react-markdown's <pre> wrapper — CodeBlock provides its own
                                    pre({ children }) {
                                        return <>{children}</>;
                                    },
                                    code({ node, inline, className, children, ...props }) {
                                        const content = String(children).replace(/\n$/, '');
                                        // Detect ```mermaid fenced blocks and render as diagrams
                                        const isMermaid = /language-mermaid/.test(className || '');
                                        if (!inline && isMermaid) {
                                            return (
                                                <Suspense fallback={
                                                    <div className="mermaid-container mermaid-loading">
                                                        <span className="text-xs text-surface-400">Loading diagram…</span>
                                                    </div>
                                                }>
                                                    <MermaidBlock>{content}</MermaidBlock>
                                                </Suspense>
                                            );
                                        }
                                        // Block code: route ALL fenced blocks through CodeBlock
                                        // (language-less blocks previously fell through with invisible text)
                                        const isBlock = !inline && (className || content.includes('\n'));
                                        if (isBlock) {
                                            return <CodeBlock className={className}>{children}</CodeBlock>;
                                        }
                                        // Inline code — try to upgrade well-known tokens into status pills
                                        // (Jira keys, Jira statuses, environments, priorities). Falls back
                                        // to a regular <code> when no rule matches.
                                        const pill = tryRenderStatusPill(content);
                                        if (pill) return pill;
                                        return <code className={className} {...props}>{children}</code>;
                                    },
                                    // Wrap tables in a horizontally-scrollable container with toolbar + CSV copy
                                    table({ children, ...props }) {
                                        return <ChatTable {...props}>{children}</ChatTable>;
                                    },
                                    // GitHub-style alerts via `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS]`
                                    blockquote({ children, ...props }) {
                                        const alert = tryRenderAlert(children);
                                        if (alert) return alert;
                                        return <blockquote {...props}>{children}</blockquote>;
                                    },
                                    // Render AI-generated markdown images
                                    img({ src, alt, ...props }) {
                                        // Markdown images can be http(s) or data URIs. We keep <img>
                                        // here because most LLM-emitted images are remote with unknown
                                        // dimensions (next/image needs width/height or `fill`).
                                        return (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={src}
                                                alt={alt || 'AI generated image'}
                                                className="rounded-lg max-w-full my-2 shadow-sm border border-surface-200"
                                                loading="lazy"
                                                decoding="async"
                                                {...props}
                                            />
                                        );
                                    },
                                }}
                            >{renderedContent}</ReactMarkdown>
                        </div>
                    )}

                    {!isUser && imageAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            {imageAttachments.map((att, idx) => (
                                <ChatImageTile
                                    key={att.id || idx}
                                    att={att}
                                    idx={idx}
                                    onExpand={setExpandedImage}
                                    buttonClassName="block rounded-lg overflow-hidden border border-surface-200 hover:ring-2 hover:ring-brand-400/50 transition-all cursor-pointer"
                                    imgClassName="max-w-[240px] max-h-[180px] object-cover"
                                    placeholderClassName="flex flex-col items-center justify-center w-[140px] h-[100px] rounded-lg border border-dashed border-surface-300 bg-surface-100 text-surface-500 text-[10px] text-center px-2"
                                />
                            ))}
                        </div>
                    )}

                    {!isUser && documentAttachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {documentAttachments.map((att, idx) => (
                                <FileAttachmentCard key={att.id || `assistant-doc-${idx}`} attachment={att} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer: timestamp + (assistant) toolbar / (user) copy */}
                <div className={`flex items-center gap-2 mt-1 ${isUser ? 'justify-end' : 'justify-between'}`}>
                    {timestamp && (
                        <span className="text-[10px] text-surface-400 flex-shrink-0">{formatTime(timestamp)}</span>
                    )}
                    {!isUser && renderedContent && !isStreaming && (
                        <MessageToolbar
                            content={content}
                            onAction={onAction}
                            onFeedback={onFeedback}
                            onCopy={handleCopy}
                        />
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
                    {/* Lightbox preview — already loaded into memory, decoding async still helps. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={expandedImage}
                        alt="Expanded attachment"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        decoding="async"
                    />
                </div>
            )}
        </div>
    );
}
