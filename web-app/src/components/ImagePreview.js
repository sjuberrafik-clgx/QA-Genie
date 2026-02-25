'use client';

import { XIcon } from '@/components/Icons';

/**
 * ImagePreview — Renders a horizontal strip of image attachment thumbnails
 * with remove (✕) buttons. Displayed between the textarea and hint text
 * in ChatInput when images are attached.
 *
 * @param {{ attachments: Array<{ id: string, name: string, type: string, size: number, dataUrl: string }>, onRemove: (index: number) => void }} props
 */
export default function ImagePreview({ attachments, onRemove }) {
    if (!attachments || attachments.length === 0) return null;

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-thin">
            {attachments.map((att, idx) => (
                <div
                    key={att.id}
                    className="relative group flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-surface-200 bg-surface-50 shadow-sm"
                >
                    {/* Thumbnail */}
                    <img
                        src={att.dataUrl}
                        alt={att.name || `Attachment ${idx + 1}`}
                        className="w-full h-full object-cover"
                    />
                    {/* Size label */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                        <span className="text-[9px] text-white font-medium truncate block">
                            {formatSize(att.size)}
                        </span>
                    </div>
                    {/* Remove button */}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove image"
                    >
                        <XIcon className="w-3 h-3" />
                    </button>
                </div>
            ))}
        </div>
    );
}
