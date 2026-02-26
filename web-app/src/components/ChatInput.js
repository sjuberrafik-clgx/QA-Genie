'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PaperclipIcon } from '@/components/Icons';
import ImagePreview from '@/components/ImagePreview';

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export default function ChatInput({ onSend, onAbort, isProcessing, disabled, placeholder: customPlaceholder, prefillText, supportsImages = true }) {
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]); // [{ id, name, type, size, dataUrl, base64 }]
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
            if (!ALLOWED_TYPES.includes(file.type)) {
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
                        type: file.type,
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

    // ── Paste handler: intercept Ctrl+V with images ──
    const handlePaste = useCallback((e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles = [];
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            e.preventDefault(); // prevent pasting [object Object] as text
            processImageFiles(imageFiles);
        }
    }, [processImageFiles]);

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
            const images = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (images.length > 0) processImageFiles(images);
        }
    }, [processImageFiles]);

    // ── File picker ──
    const handleFileSelect = useCallback((e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            processImageFiles(files);
        }
        // Reset so the same file can be re-selected
        e.target.value = '';
    }, [processImageFiles]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const hasContent = input.trim() || attachments.length > 0;
        if (!hasContent || disabled || isProcessing) return;
        onSend(input.trim(), attachments);
        setInput('');
        setAttachments([]);
        setImageError(null);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const canSend = (input.trim() || attachments.length > 0) && !disabled && !isProcessing;

    return (
        <div className="border-t border-surface-200/60 bg-white/80 backdrop-blur-sm px-5 py-3">
            <div className="max-w-3xl mx-auto">
                <div
                    className={`relative flex flex-col rounded-2xl border bg-white shadow-sm transition-all ${isDragging
                        ? 'border-brand-400 ring-2 ring-brand-200 bg-brand-50/30'
                        : isProcessing
                            ? 'border-brand-300 ring-2 ring-brand-100'
                            : 'border-surface-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100'
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
                                Drop images here
                            </div>
                        </div>
                    )}

                    {/* Image previews (above the textarea) */}
                    {attachments.length > 0 && (
                        <ImagePreview attachments={attachments} onRemove={removeAttachment} />
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
                        <div className="flex items-center gap-1 flex-shrink-0 p-1.5">
                            {/* Attachment button */}
                            {!isProcessing && supportsImages && (
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={disabled || attachments.length >= MAX_IMAGES}
                                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${attachments.length >= MAX_IMAGES
                                        ? 'text-surface-300 cursor-not-allowed'
                                        : 'text-surface-400 hover:text-surface-600 hover:bg-surface-100'
                                        }`}
                                    title={attachments.length >= MAX_IMAGES ? `Max ${MAX_IMAGES} images` : 'Attach image'}
                                >
                                    <PaperclipIcon className="w-4 h-4" strokeWidth={2} />
                                    {attachments.length > 0 && (
                                        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-brand-500 text-white text-[8px] font-bold flex items-center justify-center">
                                            {attachments.length}
                                        </span>
                                    )}
                                </button>
                            )}
                            {/* Hidden file input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
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
                </div>
                <p className="text-[10px] text-surface-400 mt-1.5 text-center">
                    {attachments.length > 0
                        ? `${attachments.length} image${attachments.length > 1 ? 's' : ''} attached · Press Enter to send`
                        : 'Press Enter to send · Shift+Enter for new line · Paste or drop images'
                    }
                </p>
            </div>
        </div>
    );
}
