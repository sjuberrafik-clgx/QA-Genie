'use client';

import { useState } from 'react';

import { CheckIcon, ClipboardIcon, DocumentIcon, FolderOpenIcon, XIcon } from '@/components/Icons';
import apiClient from '@/lib/api-client';

/** File-type icon colors and labels */
const FILE_ICON_MAP = {
    '.pdf':  { color: 'bg-red-500',    label: 'PDF' },
    '.docx': { color: 'bg-blue-600',   label: 'DOCX' },
    '.doc':  { color: 'bg-blue-600',   label: 'DOC' },
    '.pptx': { color: 'bg-orange-500', label: 'PPTX' },
    '.ppt':  { color: 'bg-orange-500', label: 'PPT' },
    '.xlsx': { color: 'bg-green-600',  label: 'XLSX' },
    '.xls':  { color: 'bg-green-600',  label: 'XLS' },
    '.csv':  { color: 'bg-green-500',  label: 'CSV' },
    '.html': { color: 'bg-amber-600',  label: 'HTML' },
    '.htm':  { color: 'bg-amber-600',  label: 'HTML' },
    '.txt':  { color: 'bg-gray-500',   label: 'TXT' },
    '.md':   { color: 'bg-gray-600',   label: 'MD' },
    '.json': { color: 'bg-yellow-600', label: 'JSON' },
    '.webm': { color: 'bg-violet-600', label: 'WEBM' },
    '.mp4':  { color: 'bg-violet-600', label: 'MP4' },
    '.png':  { color: 'bg-fuchsia-600', label: 'PNG' },
    '.jpg':  { color: 'bg-fuchsia-600', label: 'JPG' },
    '.jpeg': { color: 'bg-fuchsia-600', label: 'JPEG' },
    '.svg':  { color: 'bg-fuchsia-700', label: 'SVG' },
};

function getFileIcon(extension) {
    return FILE_ICON_MAP[extension] || { color: 'bg-gray-400', label: extension?.replace('.', '').toUpperCase() || 'FILE' };
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * FilePreview — Renders compact document attachment cards with type icon,
 * filename, size, and remove button. Used in ChatInput for document attachments.
 */
export default function FilePreview({ attachments, onRemove }) {
    if (!attachments || attachments.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 px-3 py-2">
            {attachments.map((att, idx) => {
                const icon = getFileIcon(att.extension);
                return (
                    <div
                        key={att.id}
                        className="relative group flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-lg border border-surface-200 bg-surface-50 shadow-sm max-w-[220px]"
                    >
                        {/* Type badge */}
                        <div className={`flex-shrink-0 w-8 h-8 rounded-md ${icon.color} flex items-center justify-center`}>
                            <span className="text-[9px] font-bold text-white leading-none">{icon.label}</span>
                        </div>
                        {/* File info */}
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-surface-700 truncate">{att.name}</p>
                            <p className="text-[9px] text-surface-400">{formatSize(att.size)}</p>
                        </div>
                        {/* Remove button */}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                            className="absolute top-1 right-1 w-4 h-4 rounded-full bg-surface-200 hover:bg-red-500 hover:text-white text-surface-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove file"
                        >
                            <XIcon className="w-2.5 h-2.5" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * FileAttachmentCard — Compact card for displaying document attachments
 * inside chat message bubbles (user messages). No remove button.
 */
export function FileAttachmentCard({ attachment, isUser = false }) {
    const [copied, setCopied] = useState(false);
    const icon = getFileIcon(attachment.extension);
    const isActionable = !isUser && attachment?.actionable && Boolean(attachment?.path);

    const handleOpenNative = async (event) => {
        event?.stopPropagation?.();
        if (!isActionable) return;
        try {
            await apiClient.openFileInNativeApp(attachment.path);
        } catch {
            /* ignore native open failures */
        }
    };

    const handleReveal = async (event) => {
        event?.stopPropagation?.();
        if (!isActionable) return;
        try {
            await apiClient.openFolderInNativeApp(attachment.path);
        } catch {
            /* ignore folder open failures */
        }
    };

    const handleCopyPath = async (event) => {
        event?.stopPropagation?.();
        if (!attachment?.path) return;
        try {
            await navigator.clipboard.writeText(attachment.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* ignore clipboard failures */
        }
    };

    const handleOpenBrowser = (event) => {
        event?.stopPropagation?.();
        if (!isActionable) return;
        const url = apiClient.getPipelineArtifactUrl(attachment.path, { download: false });
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div
            className={`inline-flex flex-col gap-2 px-2.5 py-1.5 rounded-lg border ${isUser
                ? 'border-white/20 bg-white/10'
                : 'border-surface-200 bg-surface-50'
                } max-w-[260px] ${isActionable ? 'shadow-sm' : ''}`}
        >
            <div className="flex items-center gap-2 min-w-0">
                {isActionable ? (
                    <button
                        type="button"
                        onClick={handleOpenNative}
                        className={`flex-shrink-0 w-7 h-7 rounded-md ${icon.color} flex items-center justify-center cursor-pointer transition-transform hover:scale-[1.04]`}
                        title={`Open ${attachment.name} in the native app`}
                    >
                        <span className="text-[8px] font-bold text-white leading-none">{icon.label}</span>
                    </button>
                ) : (
                    <div className={`flex-shrink-0 w-7 h-7 rounded-md ${icon.color} flex items-center justify-center`}>
                        <span className="text-[8px] font-bold text-white leading-none">{icon.label}</span>
                    </div>
                )}
            <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-medium truncate ${isUser ? 'text-white' : 'text-surface-700'}`}>
                    {attachment.name}
                </p>
                <p className={`text-[8px] ${isUser ? 'text-white/60' : 'text-surface-400'}`}>
                    {formatSize(attachment.size)}
                </p>
            </div>
            </div>

            {isActionable && (
                <div className="flex flex-wrap gap-1.5">
                    <button
                        type="button"
                        onClick={handleOpenNative}
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Open in native application"
                    >
                        <DocumentIcon className="w-3 h-3" />
                        <span>Open</span>
                    </button>
                    <a
                        href={apiClient.getPipelineArtifactUrl(attachment.path, { download: true })}
                        download
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Download file"
                    >
                        <DocumentIcon className="w-3 h-3" />
                        <span>Download</span>
                    </a>
                    <button
                        type="button"
                        onClick={handleOpenBrowser}
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Open through secure artifact endpoint"
                    >
                        <DocumentIcon className="w-3 h-3" />
                        <span>View</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleReveal}
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Reveal file in explorer"
                    >
                        <FolderOpenIcon className="w-3 h-3" />
                        <span>Reveal</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleCopyPath}
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Copy file path"
                    >
                        {copied ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
                        <span>{copied ? 'Copied' : 'Path'}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
