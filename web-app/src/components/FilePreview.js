'use client';

import { XIcon } from '@/components/Icons';

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
    '.txt':  { color: 'bg-gray-500',   label: 'TXT' },
    '.md':   { color: 'bg-gray-600',   label: 'MD' },
    '.json': { color: 'bg-yellow-600', label: 'JSON' },
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
    const icon = getFileIcon(attachment.extension);
    return (
        <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${isUser
            ? 'border-white/20 bg-white/10'
            : 'border-surface-200 bg-surface-50'
        } max-w-[200px]`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-md ${icon.color} flex items-center justify-center`}>
                <span className="text-[8px] font-bold text-white leading-none">{icon.label}</span>
            </div>
            <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-medium truncate ${isUser ? 'text-white' : 'text-surface-700'}`}>
                    {attachment.name}
                </p>
                <p className={`text-[8px] ${isUser ? 'text-white/60' : 'text-surface-400'}`}>
                    {formatSize(attachment.size)}
                </p>
            </div>
        </div>
    );
}
