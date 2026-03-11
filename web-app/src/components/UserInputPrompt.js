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
 * Supports types:
 * - **default**: text input with optional option buttons
 * - **credentials**: dual masked inputs for username + password
 * - **password**: single masked input
 *
 * Designed to match the existing chat timeline visual language (tool calls, reasoning blocks).
 */
export default memo(UserInputPrompt);

function UserInputPrompt({ requestId, question, options = [], resolved, resolvedAnswer, auto, onSubmit, disabled, type = 'default' }) {
    const [selectedOption, setSelectedOption] = useState('');
    const [freeText, setFreeText] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);
    const usernameRef = useRef(null);

    const hasOptions = options.length > 0;
    const isCredentials = type === 'credentials';
    const isPasswordOnly = type === 'password';

    // Auto-focus the input when the prompt appears
    useEffect(() => {
        if (!resolved) {
            const ref = isCredentials ? usernameRef : inputRef;
            if (ref.current) {
                const timer = setTimeout(() => ref.current?.focus(), 150);
                return () => clearTimeout(timer);
            }
        }
    }, [resolved, isCredentials]);

    const handleSubmit = async () => {
        let answer;

        if (isCredentials) {
            if (!username.trim() || !password.trim()) return;
            answer = { username: username.trim(), password: password.trim() };
        } else if (isPasswordOnly) {
            if (!freeText.trim()) return;
            answer = freeText.trim();
        } else {
            answer = hasOptions
                ? (selectedOption || freeText || '').trim()
                : freeText.trim();
        }

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

    const canSubmit = isCredentials
        ? !!(username.trim() && password.trim())
        : isPasswordOnly
            ? !!freeText.trim()
            : hasOptions
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
                            {isCredentials
                                ? '🔐 Credentials provided (hidden for security)'
                                : isPasswordOnly
                                    ? '••••••••'
                                    : resolvedAnswer}
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
                    {/* Credential inputs (username + password) */}
                    {isCredentials && (
                        <div className="space-y-2.5">
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">
                                    Username / Email
                                </label>
                                <input
                                    ref={usernameRef}
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            // Focus password field
                                            const pwField = e.target.closest('.space-y-2\\.5')?.querySelector('input[type="password"], input[type="text"]:last-of-type');
                                            pwField?.focus();
                                        }
                                    }}
                                    placeholder="Enter your username or email"
                                    disabled={disabled || submitting}
                                    autoComplete="username"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSubmit();
                                            }
                                        }}
                                        placeholder="Enter your password"
                                        disabled={disabled || submitting}
                                        autoComplete="current-password"
                                        className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 pr-10 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600 transition-colors"
                                        tabIndex={-1}
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            {showPassword ? (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                            ) : (
                                                <>
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </>
                                            )}
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                {hasOptions && options.map((opt, i) => {
                                    const label = typeof opt === 'string' ? opt : (opt.label || opt.text || String(opt));
                                    return (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => onSubmit(requestId, typeof opt === 'object' && opt.value ? opt.value : label)}
                                            disabled={disabled || submitting}
                                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-200 bg-white text-surface-600 hover:border-surface-300 hover:bg-surface-50 transition-all disabled:opacity-50"
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                                <div className="flex-1" />
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={!canSubmit || disabled || submitting}
                                    className="px-5 py-1.5 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md hover:shadow-brand-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                                >
                                    {submitting ? (
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded-full border-2 border-white/60 border-t-white animate-spin" />
                                            Logging in...
                                        </span>
                                    ) : (
                                        '🔐 Login'
                                    )}
                                </button>
                            </div>
                            <p className="text-[10px] text-surface-400 leading-relaxed">
                                🔒 Credentials are used only for this session and are never stored. Press Enter or click Login.
                            </p>
                        </div>
                    )}

                    {/* Password-only input */}
                    {isPasswordOnly && (
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    ref={inputRef}
                                    type={showPassword ? 'text' : 'password'}
                                    value={freeText}
                                    onChange={(e) => setFreeText(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Enter password..."
                                    disabled={disabled || submitting}
                                    autoComplete="current-password"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 pr-10 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600 transition-colors"
                                    tabIndex={-1}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!canSubmit || disabled || submitting}
                                className="flex-shrink-0 px-4 py-2 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Submit
                            </button>
                        </div>
                    )}

                    {/* Standard input (option buttons + free text) — only for default type */}
                    {!isCredentials && !isPasswordOnly && (
                        <>
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
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
