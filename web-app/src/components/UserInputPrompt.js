'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { ChatBubbleIcon, CheckIcon } from '@/components/Icons';

/**
 * UserInputPrompt — inline timeline card shown when the agent calls ask_user / ask_questions.
 *
 * Renders in two states:
 * - **Pending**: question + input area (textarea or option buttons) + submit button
 * - **Resolved**: question + submitted answer (read-only, greyed out)
 *
 * Designed to match the existing chat timeline visual language (tool calls, reasoning blocks).
 */
export default memo(UserInputPrompt);

function UserInputPrompt({ requestId, question, options = [], resolved, resolvedAnswer, auto, onSubmit, disabled }) {
    const [selectedOption, setSelectedOption] = useState('');
    const [freeText, setFreeText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);

    const hasOptions = options.length > 0;

    // Auto-focus the input when the prompt appears
    useEffect(() => {
        if (!resolved && inputRef.current) {
            // Small delay to ensure the component is rendered and scrolled into view
            const timer = setTimeout(() => inputRef.current?.focus(), 150);
            return () => clearTimeout(timer);
        }
    }, [resolved]);

    const handleSubmit = async () => {
        const answer = hasOptions
            ? (selectedOption || freeText || '').trim()
            : freeText.trim();

        if (!answer || submitting) return;

        setSubmitting(true);
        try {
            await onSubmit(requestId, answer);
        } catch {
            // Error handled by parent
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const canSubmit = hasOptions
        ? !!(selectedOption || freeText.trim())
        : !!freeText.trim();

    // ─── Resolved state ─────────────────────────────────────────
    if (resolved) {
        return (
            <div className="space-y-1.5">
                {/* Header */}
                <div className="flex items-center gap-2 text-[11px] font-semibold text-surface-500 uppercase tracking-wider px-1">
                    <ChatBubbleIcon className="w-3.5 h-3.5" />
                    Agent Question
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-600 text-[10px] font-bold normal-case">
                        {auto ? 'auto-answered' : 'answered'}
                    </span>
                </div>

                <div className="rounded-xl border border-surface-200/80 bg-surface-50/60 overflow-hidden">
                    {/* Question */}
                    <div className="px-4 py-3 border-b border-surface-200/60">
                        <p className="text-sm text-surface-700 whitespace-pre-wrap leading-relaxed">{question}</p>
                    </div>
                    {/* Answer */}
                    <div className="px-4 py-2.5 bg-surface-50 flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 flex-shrink-0 text-accent-500 mt-0.5" />
                        <p className="text-sm text-surface-600 whitespace-pre-wrap leading-relaxed">
                            {resolvedAnswer}
                            {auto && <span className="ml-2 text-[10px] text-surface-400 font-medium">(timeout)</span>}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Pending state (awaiting user response) ─────────────────
    return (
        <div className="space-y-1.5">
            {/* Header */}
            <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-600 uppercase tracking-wider px-1">
                <ChatBubbleIcon className="w-3.5 h-3.5" />
                Agent Needs Your Input
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold normal-case animate-pulse">
                    waiting
                </span>
            </div>

            <div className="rounded-xl border-2 border-amber-300/70 bg-amber-50/40 overflow-hidden shadow-sm shadow-amber-200/30">
                {/* Question */}
                <div className="px-4 py-3 border-b border-amber-200/60">
                    <p className="text-sm text-surface-800 whitespace-pre-wrap leading-relaxed font-medium">{question}</p>
                </div>

                {/* Input area */}
                <div className="px-4 py-3 space-y-3">
                    {/* Option buttons (if the agent provided choices) */}
                    {hasOptions && (
                        <div className="flex flex-wrap gap-2">
                            {options.map((opt, i) => {
                                const label = typeof opt === 'string' ? opt : (opt.label || opt.text || String(opt));
                                const isSelected = selectedOption === label;
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                            setSelectedOption(isSelected ? '' : label);
                                            setFreeText(''); // Clear free text when selecting an option
                                        }}
                                        disabled={disabled || submitting}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                            isSelected
                                                ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                                                : 'border-surface-200 bg-white text-surface-700 hover:border-brand-200 hover:bg-brand-50/30'
                                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Free-text input */}
                    <div className="flex gap-2">
                        <textarea
                            ref={inputRef}
                            value={freeText}
                            onChange={(e) => {
                                setFreeText(e.target.value);
                                if (hasOptions) setSelectedOption(''); // Clear option selection when typing
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder={hasOptions ? 'Or type your own answer...' : 'Type your response...'}
                            disabled={disabled || submitting}
                            rows={1}
                            className="flex-1 resize-none rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            style={{ maxHeight: '100px' }}
                        />
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={!canSubmit || disabled || submitting}
                            className="flex-shrink-0 px-4 py-2 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md hover:shadow-brand-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                        >
                            {submitting ? (
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded-full border-2 border-white/60 border-t-white animate-spin" />
                                    Sending
                                </span>
                            ) : (
                                'Submit'
                            )}
                        </button>
                    </div>

                    <p className="text-[10px] text-surface-400 leading-relaxed">
                        The AI agent is waiting for your response to continue. Press Enter or click Submit.
                    </p>
                </div>
            </div>
        </div>
    );
}
