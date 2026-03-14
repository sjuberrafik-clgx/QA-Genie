'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PaperclipIcon } from '@/components/Icons';
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

export default function ChatInput({ onSend, onAbort, isProcessing, disabled, placeholder: customPlaceholder, prefillText, supportsImages = true }) {
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]); // images: [{ id, name, type, size, dataUrl, base64, kind:'image' }]
    const [docAttachments, setDocAttachments] = useState([]); // [{ id, name, mimeType, size, base64, extension, kind:'document' }]
    const [videoAttachments, setVideoAttachments] = useState([]); // [{ id, name, mimeType, size, tempPath, kind:'video' }]
    const [imageError, setImageError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);
    const dragCounterRef = useRef(0);

    // Accept external prefill text — populate input and focus the textarea
    useEffect(() => {
        if (prefillText && prefillText !== input) {
            setInput(prefillText);
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
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
        }
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
        const hasContent = input.trim() || attachments.length > 0 || docAttachments.length > 0 || videoAttachments.length > 0;
        if (!hasContent || disabled || isProcessing) return;
        onSend(input.trim(), attachments, docAttachments, videoAttachments);
        setInput('');
        setAttachments([]);
        setDocAttachments([]);
        setVideoAttachments([]);
        setImageError(null);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
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

                        <div className="flex items-end">
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                                placeholder={isProcessing ? 'AI is thinking...' : (customPlaceholder || 'Message AI Assistant...')}
                                disabled={disabled || isProcessing}
                                rows={1}
                                className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none disabled:opacity-50"
                            />
                            <div className="flex items-center gap-1.5 flex-shrink-0 p-1.5">
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
                <p className="text-[10px] text-surface-400 mt-1.5 text-center">
                    {totalAttachments > 0
                        ? `${totalAttachments} file${totalAttachments > 1 ? 's' : ''} attached · Press Enter to send`
                        : 'Press Enter to send · Shift+Enter for new line · Paste or drop files'
                    }
                </p>
            </div>
        </div>
    );
}
