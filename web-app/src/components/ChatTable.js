'use client';

import { useRef, useState } from 'react';
import { ClipboardIcon, CheckIcon } from '@/components/Icons';

// Extract CSV from the rendered <table> DOM, quoting cells that contain commas/quotes/newlines
function tableToCsv(tableEl) {
    if (!tableEl) return '';
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    return rows
        .map((row) =>
            Array.from(row.querySelectorAll('th,td'))
                .map((cell) => {
                    const text = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
                    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                })
                .join(',')
        )
        .join('\n');
}

export default function ChatTable({ children, ...props }) {
    const wrapperRef = useRef(null);
    const tableRef = useRef(null);
    const [copied, setCopied] = useState(false);

    // Derive row/col counts from the DOM after render (safe because react-markdown emits real elements)
    const handleCopy = async () => {
        try {
            const csv = tableToCsv(tableRef.current);
            await navigator.clipboard.writeText(csv);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* ignore */ }
    };

    // Read live counts from the DOM on every render (cheap, no listeners needed)
    let rowCount = 0;
    let colCount = 0;
    if (tableRef.current) {
        const tbodyRows = tableRef.current.querySelectorAll('tbody tr').length;
        const headerRow = tableRef.current.querySelector('thead tr');
        rowCount = tbodyRows;
        colCount = headerRow ? headerRow.querySelectorAll('th,td').length : (tableRef.current.querySelector('tr')?.querySelectorAll('th,td').length || 0);
    }

    return (
        <div className="chat-table-shell group/table" ref={wrapperRef}>
            <div className="chat-table-toolbar" aria-hidden="true">
                <span className="chat-table-toolbar__meta">
                    <span className="chat-table-toolbar__dot" />
                    Table
                </span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="chat-table-toolbar__copy"
                    title="Copy as CSV"
                >
                    {copied ? (
                        <>
                            <CheckIcon className="w-3 h-3" />
                            <span>Copied</span>
                        </>
                    ) : (
                        <>
                            <ClipboardIcon />
                            <span>CSV</span>
                        </>
                    )}
                </button>
            </div>
            <div className="chat-table-wrapper">
                <table ref={tableRef} {...props}>{children}</table>
            </div>
        </div>
    );
}
