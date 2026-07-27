'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PaperclipIcon, MicrophoneIcon } from '@/components/Icons';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import ImagePreview from '@/components/ImagePreview';
import FilePreview from '@/components/FilePreview';
import { LIMITS, ALLOWED_IMAGE_TYPES, ALLOWED_DOC_TYPES, DOC_EXT_TO_MIME, ALLOWED_VIDEO_TYPES, ALLOWED_VIDEO_EXTENSIONS, VIDEO_EXT_TO_MIME, FILE_ACCEPT_STRING } from '@/lib/constants';
import { API_CONFIG } from '@/lib/api-config';

const MAX_IMAGES = LIMITS.MAX_IMAGES_PER_MESSAGE;
const MAX_IMAGE_SIZE = LIMITS.MAX_IMAGE_SIZE_BYTES;
const MAX_DOCS = LIMITS.MAX_DOCS_PER_MESSAGE;
const MAX_DOC_SIZE = LIMITS.MAX_DOC_SIZE_BYTES;
const MAX_VIDEOS = LIMITS.MAX_VIDEOS_PER_MESSAGE;
const MAX_VIDEO_SIZE = LIMITS.MAX_VIDEO_SIZE_BYTES;

// Splice `next` onto `prev` with a single separating space when needed. Used to
// append dictated speech to whatever is already in the textarea.
function appendText(prev, next) {
    if (!next) return prev;
    if (!prev) return next;
    return /\s$/.test(prev) ? prev + next : prev + ' ' + next;
}

// Recognition locales offered in the voice-input language picker. Matching the
// speaker's accent is the single biggest driver of Web Speech API accuracy.
const VOICE_LANGUAGES = [
    { code: 'en-IN', label: 'English (India)' },
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-AU', label: 'English (Australia)' },
    { code: 'en-CA', label: 'English (Canada)' },
    { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
];

export default function ChatInput({ onSend, onAbort, isProcessing, disabled, placeholder: customPlaceholder, prefillText, history = [], supportsImages = true }) {
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]); // images: [{ id, name, type, size, dataUrl, base64, kind:'image' }]
    const [docAttachments, setDocAttachments] = useState([]); // [{ id, name, mimeType, size, base64, extension, kind:'document' }]
    const [videoAttachments, setVideoAttachments] = useState([]); // [{ id, name, mimeType, size, tempPath, kind:'video' }]
    const [imageError, setImageError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);
    const dragCounterRef = useRef(0);
    // Command-history navigation (Up/Down arrows recall previously sent messages).
    // historyIndex === null means "not browsing history"; draftRef holds the
    // in-progress text so Down can return the user to what they were typing.
    const [historyIndex, setHistoryIndex] = useState(null);
    const draftRef = useRef('');

    // ── Voice-to-text (Web Speech API) ──
    // `dictationBaseRef` snapshots the textarea content when dictation starts;
    // `dictationFinalsRef` accumulates finalized speech. Interim (still-being-
    // spoken) words are folded in live for preview but only persisted once the
    // recognizer marks them final.
    const [voiceError, setVoiceError] = useState(null);
    const [voiceLang, setVoiceLang] = useState('en-IN'); // BCP-47 recognition locale
    const dictationBaseRef = useRef('');
    const dictationFinalsRef = useRef('');
    // The recognizer streams partial results many times per second. Committing
    // every partial straight to React state re-renders the input (and runs the
    // auto-resize reflow) on each word — that is what makes dictated text stutter
    // onto the field. Instead we stash the latest composed value in a ref and
    // flush it to state at most once per animation frame.
    const dictationRafRef = useRef(0);
    const dictationPendingRef = useRef(null);

    // rAF callback: push the most recent composed transcript into state.
    const flushDictation = useCallback(() => {
        dictationRafRef.current = 0;
        const next = dictationPendingRef.current;
        if (next == null) return;
        dictationPendingRef.current = null;
        setInput(next);
        setHistoryIndex(null);
    }, []);

    // Apply any queued transcript immediately and return it (used when dictation
    // stops or the message is sent, so the last spoken words are never lost to a
    // still-pending frame callback).
    const flushDictationNow = useCallback(() => {
        if (dictationRafRef.current) {
            cancelAnimationFrame(dictationRafRef.current);
            dictationRafRef.current = 0;
        }
        const next = dictationPendingRef.current;
        if (next == null) return null;
        dictationPendingRef.current = null;
        setInput(next);
        setHistoryIndex(null);
        return next;
    }, []);

    // Drop any queued transcript without applying it (used when the user starts
    // typing, so a late frame can't clobber what they just wrote).
    const cancelDictationFlush = useCallback(() => {
        if (dictationRafRef.current) {
            cancelAnimationFrame(dictationRafRef.current);
            dictationRafRef.current = 0;
        }
        dictationPendingRef.current = null;
    }, []);

    const handleTranscript = useCallback(({ final, interim }) => {
        if (final) {
            dictationFinalsRef.current = appendText(dictationFinalsRef.current, final);
        }
        const composed = [dictationBaseRef.current, dictationFinalsRef.current, interim]
            .reduce((acc, part) => (part ? appendText(acc, part) : acc), '');
        dictationPendingRef.current = composed;
        // Coalesce bursts of partial results into a single state update per frame.
        if (!dictationRafRef.current) {
            dictationRafRef.current = requestAnimationFrame(flushDictation);
        }
    }, [flushDictation]);

    // Cancel any in-flight frame if the component unmounts mid-dictation.
    useEffect(() => () => {
        if (dictationRafRef.current) cancelAnimationFrame(dictationRafRef.current);
    }, []);

    const {
        isSupported: voiceSupported,
        isListening,
        error: recognitionError,
        start: startRecognition,
        stop: stopRecognition,
    } = useSpeechToText({ onTranscript: handleTranscript, lang: voiceLang });

    // Mirror recognition errors into the inline toast (auto-clears after 5s).
    useEffect(() => {
        if (recognitionError) setVoiceError(recognitionError.message);
    }, [recognitionError]);
    useEffect(() => {
        if (!voiceError) return;
        const t = setTimeout(() => setVoiceError(null), 5000);
        return () => clearTimeout(t);
    }, [voiceError]);

    // Restore the saved recognition language (client-only to stay SSR-safe).
    useEffect(() => {
        try {
            const saved = localStorage.getItem('voiceLang');
            if (saved) setVoiceLang(saved);
        } catch { /* localStorage unavailable */ }
    }, []);

    const handleVoiceLangChange = (e) => {
        const next = e.target.value;
        setVoiceLang(next);
        try { localStorage.setItem('voiceLang', next); } catch { /* ignore */ }
        // Apply the new language on the next start.
        if (isListening) {
            stopRecognition();
            flushDictationNow();
        }
    };

    const toggleDictation = useCallback(() => {
        if (isListening) {
            stopRecognition();
            flushDictationNow(); // keep the last spoken words when stopping
            return;
        }
        // Capture current text so recognized speech appends to it, then listen.
        dictationBaseRef.current = input;
        dictationFinalsRef.current = '';
        dictationPendingRef.current = null;
        setVoiceError(null);
        startRecognition();
    }, [isListening, input, startRecognition, stopRecognition, flushDictationNow]);

    // Accept external prefill text — populate input and focus the textarea
    useEffect(() => {
        if (prefillText && prefillText !== input) {
            setInput(prefillText);
            setHistoryIndex(null);
            // Focus + place cursor at end after a tick (so the value is set first)
            setTimeout(() => {
                const ta = textareaRef.current;
                if (ta) {
                    ta.focus();
                    ta.selectionStart = ta.selectionEnd = prefillText.length;
                }
            }, 0);
        }
    }, [prefillText]);

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        // Defer the height recalculation to just before paint and cancel any
        // superseded frame. Doing the `height:auto` -> read `scrollHeight` dance
        // synchronously on every keystroke/partial dictation result forces a
        // layout on each change; batching it per frame keeps typing and voice
        // input smooth.
        const id = requestAnimationFrame(() => {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
        });
        return () => cancelAnimationFrame(id);
    }, [input]);

    // Clear image error after 4s
    useEffect(() => {
        if (!imageError) return;
        const t = setTimeout(() => setImageError(null), 4000);
        return () => clearTimeout(t);
    }, [imageError]);

    /**
     * Process a list of File/Blob objects into attachment state entries.
     */
    const processImageFiles = useCallback((files) => {
        if (!supportsImages) {
            setImageError('Selected model does not support images. Switch to GPT-4o, Claude Sonnet 4+, or Gemini.');
            return;
        }

        const remaining = MAX_IMAGES - attachments.length;
        if (remaining <= 0) {
            setImageError(`Maximum ${MAX_IMAGES} images allowed per message.`);
            return;
        }

        const toProcess = Array.from(files).slice(0, remaining);
        let rejected = 0;

        toProcess.forEach((file) => {
            const mime = resolveMime(file);
            if (!ALLOWED_IMAGE_TYPES.includes(mime)) {
                rejected++;
                return;
            }
            if (file.size > MAX_IMAGE_SIZE) {
                setImageError(`Image "${file.name}" exceeds 5 MB limit.`);
                rejected++;
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                // Extract base64 data (strip data:image/...;base64, prefix)
                const base64 = dataUrl.split(',')[1];
                setAttachments(prev => {
                    if (prev.length >= MAX_IMAGES) return prev;
                    return [...prev, {
                        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: file.name || 'pasted-image.png',
                        type: mime,
                        size: file.size,
                        dataUrl,
                        base64,
                    }];
                });
            };
            reader.readAsDataURL(file);
        });

        if (rejected > 0 && !imageError) {
            setImageError('Some files were skipped (unsupported type or too large).');
        }
    }, [attachments.length, supportsImages, imageError]);

    const removeAttachment = useCallback((index) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    }, []);

    const removeDocAttachment = useCallback((index) => {
        setDocAttachments(prev => prev.filter((_, i) => i !== index));
    }, []);

    const removeVideoAttachment = useCallback((index) => {
        setVideoAttachments(prev => prev.filter((_, i) => i !== index));
    }, []);

    /**
     * Resolve MIME type — browsers sometimes report empty or generic MIME for Office files.
     * Falls back to extension-based lookup.
     */
    const resolveMime = (file) => {
        if (file.type && file.type !== 'application/octet-stream') return file.type;
        const ext = '.' + (file.name || '').split('.').pop().toLowerCase();
        return DOC_EXT_TO_MIME[ext] || VIDEO_EXT_TO_MIME[ext] || file.type || 'application/octet-stream';
    };

    /**
     * Process document files (non-image) into document attachment state entries.
     */
    const processDocumentFiles = useCallback((files) => {
        const remaining = MAX_DOCS - docAttachments.length;
        if (remaining <= 0) {
            setImageError(`Maximum ${MAX_DOCS} documents allowed per message.`);
            return;
        }

        const toProcess = Array.from(files).slice(0, remaining);
        let rejected = 0;

        toProcess.forEach((file) => {
            const mime = resolveMime(file);
            if (!ALLOWED_DOC_TYPES[mime]) {
                rejected++;
                return;
            }
            if (file.size > MAX_DOC_SIZE) {
                setImageError(`File "${file.name}" exceeds 50 MB limit.`);
                rejected++;
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                const ext = ALLOWED_DOC_TYPES[mime]?.ext || '.' + file.name.split('.').pop().toLowerCase();
                setDocAttachments(prev => {
                    if (prev.length >= MAX_DOCS) return prev;
                    return [...prev, {
                        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: file.name || `document${ext}`,
                        mimeType: mime,
                        size: file.size,
                        base64,
                        extension: ext,
                        kind: 'document',
                    }];
                });
            };
            reader.readAsDataURL(file);
        });

        if (rejected > 0 && !imageError) {
            setImageError('Some files were skipped (unsupported type or too large).');
        }
    }, [docAttachments.length, imageError]);

    /**
     * Upload a video file via streaming endpoint (never base64 — prevents OOM for large files).
     */
    const processVideoFiles = useCallback(async (files) => {
        if (!supportsImages) {
            setImageError('Selected model does not support video analysis. Switch to a vision-enabled model.');
            return;
        }
        const remaining = MAX_VIDEOS - videoAttachments.length;
        if (remaining <= 0) {
            setImageError(`Maximum ${MAX_VIDEOS} videos allowed per message.`);
            return;
        }

        const toProcess = Array.from(files).slice(0, remaining);

        for (const file of toProcess) {
            const mime = resolveMime(file);
            if (!ALLOWED_VIDEO_TYPES.includes(mime)) continue;
            if (file.size > MAX_VIDEO_SIZE) {
                setImageError(`Video "${file.name}" exceeds ${MAX_VIDEO_SIZE / (1024 * 1024)} MB limit.`);
                continue;
            }

            try {
                const resp = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.chatUploadVideo}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': mime,
                        'X-Filename': encodeURIComponent(file.name),
                        'Content-Length': String(file.size),
                    },
                    body: file,
                });

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
                    setImageError(err.error || `Video upload failed (${resp.status})`);
                    continue;
                }

                const { tempPath, filename, mediaType, size } = await resp.json();
                setVideoAttachments(prev => {
                    if (prev.length >= MAX_VIDEOS) return prev;
                    return [...prev, {
                        id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: filename,
                        mimeType: mediaType,
                        size,
                        tempPath,
                        extension: ALLOWED_VIDEO_EXTENSIONS[mediaType]?.ext || '.mp4',
                        kind: 'video',
                    }];
                });
            } catch {
                setImageError(`Failed to upload video "${file.name}".`);
            }
        }
    }, [videoAttachments.length, supportsImages]);

    /**
     * Route a list of files into image, document, or video processors based on MIME type.
     */
    const routeFiles = useCallback((files) => {
        const images = [];
        const docs = [];
        const videos = [];
        for (const file of Array.from(files)) {
            const mime = resolveMime(file);
            if (ALLOWED_IMAGE_TYPES.includes(mime)) {
                images.push(file);
            } else if (ALLOWED_DOC_TYPES[mime]) {
                docs.push(file);
            } else if (ALLOWED_VIDEO_TYPES.includes(mime)) {
                videos.push(file);
            }
        }
        if (images.length > 0) processImageFiles(images);
        if (docs.length > 0) processDocumentFiles(docs);
        if (videos.length > 0) processVideoFiles(videos);
        return images.length + docs.length + videos.length;
    }, [processImageFiles, processDocumentFiles, processVideoFiles]);

    // ── Paste handler: intercept Ctrl+V with files ──
    const handlePaste = useCallback((e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles = [];
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            routeFiles(pastedFiles);
        }
    }, [routeFiles]);

    // ── Drag-and-drop handlers ──
    const handleDragEnter = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer?.types?.includes('Files')) {
            setIsDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const handled = routeFiles(files);
            if (handled === 0) {
                setImageError('Unsupported file type. Supported: images, PDF, Word, Excel, PowerPoint, CSV, TXT, Markdown, JSON, MP4, WebM, MOV, AVI, MKV.');
            }
        }
    }, [routeFiles]);

    // ── File picker ──
    const handleFileSelect = useCallback((e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            routeFiles(files);
        }
        // Reset so the same file can be re-selected
        e.target.value = '';
    }, [routeFiles]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isListening) stopRecognition();
        // Prefer any transcript that hasn't been flushed to state yet so the last
        // dictated words are included even if the frame callback hasn't run.
        const dictated = flushDictationNow();
        const text = dictated != null ? dictated : input;
        const hasContent = text.trim() || attachments.length > 0 || docAttachments.length > 0 || videoAttachments.length > 0;
        if (!hasContent || disabled || isProcessing) return;
        onSend(text.trim(), attachments, docAttachments, videoAttachments);
        setInput('');
        setAttachments([]);
        setDocAttachments([]);
        setVideoAttachments([]);
        setImageError(null);
        setHistoryIndex(null);
        draftRef.current = '';
        dictationBaseRef.current = '';
        dictationFinalsRef.current = '';
    };

    // Place the caret at the end of the textarea after a programmatic value
    // change (mirrors the prefill effect — waits a tick so the value is set).
    const focusCaretToEnd = () => {
        setTimeout(() => {
            const ta = textareaRef.current;
            if (ta) {
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            }
        }, 0);
    };

    // Typing exits history-browsing so the next Up arrow starts a fresh walk.
    const handleChange = (e) => {
        // Manual typing takes over from dictation so the recognizer's next result
        // doesn't overwrite the user's edits.
        if (isListening) stopRecognition();
        cancelDictationFlush(); // drop any queued transcript so it can't clobber typing
        setInput(e.target.value);
        if (historyIndex !== null) setHistoryIndex(null);
    };

    // Recall an older message (Up) — only when the caret sits in the first
    // visual line, so multi-line editing keeps working normally.
    const recallPrevious = () => {
        if (history.length === 0) return false;
        const ta = textareaRef.current;
        const caret = ta ? ta.selectionStart : 0;
        const caretInFirstLine = input.slice(0, caret).indexOf('\n') === -1;
        if (!caretInFirstLine) return false;
        let nextIndex;
        if (historyIndex === null) {
            draftRef.current = input;
            nextIndex = history.length - 1;
        } else {
            nextIndex = Math.max(0, historyIndex - 1);
        }
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
        focusCaretToEnd();
        return true;
    };

    // Move toward newer messages (Down); past the newest, restore the draft —
    // only when the caret sits in the last visual line.
    const recallNext = () => {
        if (historyIndex === null) return false;
        const ta = textareaRef.current;
        const caret = ta ? ta.selectionEnd : input.length;
        const caretInLastLine = input.slice(caret).indexOf('\n') === -1;
        if (!caretInLastLine) return false;
        if (historyIndex < history.length - 1) {
            const nextIndex = historyIndex + 1;
            setHistoryIndex(nextIndex);
            setInput(history[nextIndex]);
        } else {
            setHistoryIndex(null);
            setInput(draftRef.current);
        }
        focusCaretToEnd();
        return true;
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
            return;
        }
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'ArrowUp') {
            if (recallPrevious()) e.preventDefault();
            return;
        }
        if (e.key === 'ArrowDown') {
            if (recallNext()) e.preventDefault();
        }
    };

    const canSend = (input.trim() || attachments.length > 0 || docAttachments.length > 0 || videoAttachments.length > 0) && !disabled && !isProcessing;
    const totalAttachments = attachments.length + docAttachments.length + videoAttachments.length;

    return (
        <div className="border-t border-surface-200/60 bg-white/80 backdrop-blur-sm px-5 py-3">
            <div className="max-w-3xl mx-auto">
                {/* Glowing input wrapper — creates stacking context */}
                <div className="glow-input-wrap">
                    {/* 4 animated conic-gradient glow layers (z-index: 0) */}
                    <div className="gi-layer gi-glow" />
                    <div className="gi-layer gi-dark" />
                    <div className="gi-layer gi-border" />
                    <div className="gi-layer gi-white" />

                    {/* Inner card — sits above glow layers (z-index: 1) */}
                    <div
                        className={`glow-input-inner flex flex-col shadow-sm transition-all ${isDragging
                            ? 'ring-2 ring-brand-200 bg-brand-50/30'
                            : ''
                            }`}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                    >
                        {/* Drag overlay */}
                        {isDragging && (
                            <div className="absolute inset-0 z-10 rounded-2xl bg-brand-50/80 border-2 border-dashed border-brand-400 flex items-center justify-center pointer-events-none">
                                <div className="text-sm font-medium text-brand-600 flex items-center gap-2">
                                    <PaperclipIcon className="w-5 h-5" strokeWidth={1.5} />
                                    Drop files here
                                </div>
                            </div>
                        )}

                        {/* Image previews (above the textarea) */}
                        {attachments.length > 0 && (
                            <ImagePreview attachments={attachments} onRemove={removeAttachment} />
                        )}

                        {/* Document previews (above the textarea) */}
                        {docAttachments.length > 0 && (
                            <FilePreview attachments={docAttachments} onRemove={removeDocAttachment} />
                        )}

                        {/* Video previews (above the textarea) */}
                        {videoAttachments.length > 0 && (
                            <FilePreview attachments={videoAttachments} onRemove={removeVideoAttachment} />
                        )}

                        {/* Image error toast */}
                        {imageError && (
                            <div className="px-3 py-1.5">
                                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                                    {imageError}
                                </div>
                            </div>
                        )}

                        {/* Voice input error toast */}
                        {voiceError && (
                            <div className="px-3 py-1.5">
                                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                                    {voiceError}
                                </div>
                            </div>
                        )}

                        <div className="flex items-end">
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                                placeholder={isProcessing ? 'AI is thinking...' : (customPlaceholder || 'Message AI Assistant...')}
                                disabled={disabled || isProcessing}
                                rows={1}
                                className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none disabled:opacity-50"
                            />
                            <div className="flex items-center gap-1.5 flex-shrink-0 p-1.5">
                                {/* Voice input (dictation) button */}
                                {!isProcessing && voiceSupported && (
                                    <button
                                        type="button"
                                        onClick={toggleDictation}
                                        disabled={disabled}
                                        aria-pressed={isListening}
                                        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                                        className={`relative w-9 h-9 flex items-center justify-center rounded-xl border shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-1 ${disabled
                                            ? 'border-surface-200 bg-surface-50 text-surface-300 cursor-not-allowed shadow-none'
                                            : isListening
                                                ? 'border-red-500 bg-red-500 text-white shadow-red-500/30 mic-listening'
                                                : 'border-cyan-200 bg-cyan-50 text-cyan-700 shadow-cyan-700/10 hover:-translate-y-0.5 hover:border-cyan-400 hover:bg-cyan-100 hover:text-cyan-800 hover:shadow-md hover:shadow-cyan-700/15 active:translate-y-0'
                                            }`}
                                        title={isListening ? 'Stop voice input' : 'Speak your message'}
                                    >
                                        <MicrophoneIcon className="w-[18px] h-[18px]" strokeWidth={2.25} />
                                    </button>
                                )}
                                {/* Voice language picker */}
                                {!isProcessing && voiceSupported && (
                                    <select
                                        value={voiceLang}
                                        onChange={handleVoiceLangChange}
                                        disabled={disabled}
                                        title="Voice recognition language — match your accent for best accuracy"
                                        aria-label="Voice recognition language"
                                        className="h-8 max-w-[96px] rounded-lg border border-surface-200 bg-white px-1.5 text-[11px] text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50 cursor-pointer"
                                    >
                                        {VOICE_LANGUAGES.map((l) => (
                                            <option key={l.code} value={l.code}>{l.label}</option>
                                        ))}
                                    </select>
                                )}
                                {/* Attachment button */}
                                {!isProcessing && (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={disabled}
                                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${disabled
                                            ? 'text-surface-300 cursor-not-allowed'
                                            : 'text-surface-400 hover:text-surface-600 hover:bg-surface-100'
                                            }`}
                                        title="Attach file"
                                    >
                                        <PaperclipIcon className="w-4 h-4" strokeWidth={2} />
                                        {totalAttachments > 0 && (
                                            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-brand-500 text-white text-[8px] font-bold flex items-center justify-center">
                                                {totalAttachments}
                                            </span>
                                        )}
                                    </button>
                                )}
                                {/* Hidden file input — accepts images + documents */}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={FILE_ACCEPT_STRING}
                                    multiple
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />

                                {/* Send / Abort button */}
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
                                        className="send-btn"
                                        title="Send message"
                                    >
                                        <div className="send-btn-svg-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                width="18"
                                                height="18"
                                            >
                                                <path fill="none" d="M0 0h24v24H0z" />
                                                <path
                                                    fill="currentColor"
                                                    d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z"
                                                />
                                            </svg>
                                        </div>
                                        <span>Send</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-[10px] text-surface-400 mt-1.5 text-center" aria-live="polite">
                    {isListening
                        ? 'Listening… speak now · click the mic again to stop'
                        : totalAttachments > 0
                            ? `${totalAttachments} file${totalAttachments > 1 ? 's' : ''} attached · Press Enter to send`
                            : 'Press Enter to send · Shift+Enter for new line · Paste or drop files'
                    }
                </p>
            </div>
        </div>
    );
}
