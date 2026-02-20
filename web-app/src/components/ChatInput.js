'use client';

import { useState, useRef, useEffect } from 'react';

export default function ChatInput({ onSend, onAbort, isProcessing, disabled, placeholder: customPlaceholder }) {
    const [input, setInput] = useState('');
    const textareaRef = useRef(null);

    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
        }
    }, [input]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!input.trim() || disabled || isProcessing) return;
        onSend(input.trim());
        setInput('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const canSend = input.trim() && !disabled && !isProcessing;

    return (
        <div className="border-t border-surface-200/60 bg-white/80 backdrop-blur-sm px-5 py-3">
            <div className="max-w-3xl mx-auto">
                <div className={`relative flex items-end rounded-2xl border bg-white shadow-sm transition-all ${isProcessing
                    ? 'border-brand-300 ring-2 ring-brand-100'
                    : 'border-surface-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100'
                    }`}>
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isProcessing ? 'AI is thinking...' : (customPlaceholder || 'Message AI Assistant...')}
                        disabled={disabled || isProcessing}
                        rows={1}
                        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none disabled:opacity-50"
                    />
                    <div className="flex-shrink-0 p-1.5">
                        {isProcessing ? (
                            <button
                                type="button"
                                onClick={onAbort}
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500 hover:bg-red-600 transition-colors relative shadow-sm shadow-red-500/30"
                                title="Stop generating"
                            >
                                <div className="absolute inset-[-2px] rounded-[10px] border-2 border-red-300 border-t-transparent animate-spin" />
                                <div className="w-3 h-3 rounded-sm bg-white" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!canSend}
                                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${canSend
                                    ? 'gradient-brand text-white shadow-sm hover:shadow-md'
                                    : 'bg-surface-100 text-surface-400 cursor-not-allowed'
                                    }`}
                                title="Send message"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-[10px] text-surface-400 mt-1.5 text-center">
                    Press Enter to send &middot; Shift+Enter for new line
                </p>
            </div>
        </div>
    );
}
