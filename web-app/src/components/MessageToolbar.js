'use client';

import { memo, useState } from 'react';
import { ClipboardIcon, CheckIcon } from '@/components/Icons';

/**
 * MessageToolbar — hover-revealed action strip under an assistant message.
 *
 * Actions are intent-only — they send a follow-up message to the chat. The
 * parent chat page wires these to its `sendMessage` callback so each action
 * becomes a new assistant turn (no destructive history rewrites).
 *
 * Feedback is local-only for now (👍 / 👎 toggle) — the backend can be wired
 * later via a `onFeedback({ rating, messageId })` prop.
 */
function MessageToolbar({ content, onAction, onCopy, onFeedback, disabled = false }) {
    const [copied, setCopied] = useState(false);
    const [rating, setRating] = useState(null); // 'up' | 'down' | null

    const handleCopy = async () => {
        try {
            if (onCopy) onCopy(content || '');
            else await navigator.clipboard.writeText(content || '');
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* ignore */ }
    };

    const handleAction = (action, prompt) => {
        if (disabled) return;
        onAction?.({ action, prompt });
    };

    const handleRate = (value) => {
        const next = rating === value ? null : value;
        setRating(next);
        onFeedback?.({ rating: next });
    };

    return (
        <div
            className="chat-msg-toolbar"
            role="toolbar"
            aria-label="Message actions"
        >
            <button
                type="button"
                onClick={handleCopy}
                className="chat-msg-toolbar__btn"
                title="Copy message"
            >
                {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardIcon />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <span className="chat-msg-toolbar__divider" aria-hidden />

            <button
                type="button"
                onClick={() => handleAction('regenerate', 'Please regenerate the previous response with a fresh take. Keep the same intent but try a different structure or wording.')}
                className="chat-msg-toolbar__btn"
                title="Regenerate this response"
                disabled={disabled}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 005.6 5.6M4 15a8 8 0 0014.4 3.4" />
                </svg>
                <span className="hidden sm:inline">Regenerate</span>
            </button>

            <button
                type="button"
                onClick={() => handleAction('continue', 'Please continue from where you left off.')}
                className="chat-msg-toolbar__btn"
                title="Continue this response"
                disabled={disabled}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                <span className="hidden sm:inline">Continue</span>
            </button>

            <button
                type="button"
                onClick={() => handleAction('simplify', 'Please simplify the previous response into 3–5 concise bullet points that anyone can understand.')}
                className="chat-msg-toolbar__btn"
                title="Simplify this response"
                disabled={disabled}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" />
                </svg>
                <span className="hidden sm:inline">Simplify</span>
            </button>

            <button
                type="button"
                onClick={() => handleAction('explain', 'Please explain the previous response in more detail, with concrete examples.')}
                className="chat-msg-toolbar__btn"
                title="Explain in more detail"
                disabled={disabled}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden md:inline">Explain more</span>
            </button>

            <span className="chat-msg-toolbar__divider chat-msg-toolbar__divider--right" aria-hidden />

            <button
                type="button"
                onClick={() => handleRate('up')}
                className={`chat-msg-toolbar__btn chat-msg-toolbar__btn--rate ${rating === 'up' ? 'is-active is-up' : ''}`}
                title="Good response"
                aria-pressed={rating === 'up'}
            >
                <svg className="w-3.5 h-3.5" fill={rating === 'up' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                </svg>
            </button>

            <button
                type="button"
                onClick={() => handleRate('down')}
                className={`chat-msg-toolbar__btn chat-msg-toolbar__btn--rate ${rating === 'down' ? 'is-active is-down' : ''}`}
                title="Bad response"
                aria-pressed={rating === 'down'}
            >
                <svg className="w-3.5 h-3.5" fill={rating === 'down' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.018a2 2 0 01.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                </svg>
            </button>
        </div>
    );
}

export default memo(MessageToolbar);
