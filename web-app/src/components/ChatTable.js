'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardIcon, CheckIcon, XIcon } from '@/components/Icons';

// SSR-safe layout effect — falls back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Extract CSV from the rendered <table> DOM, quoting cells that contain commas/quotes/newlines.
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

// Heuristic: a first column is "narrow" if every cell is short/numeric.
function detectNarrowFirstColumn(tableEl) {
    if (!tableEl) return false;
    const firstCells = tableEl.querySelectorAll('tbody tr > *:first-child');
    if (firstCells.length === 0) return false;
    let narrow = 0;
    firstCells.forEach((cell) => {
        const txt = (cell.textContent || '').trim();
        if (txt.length <= 10 || /^[\d.\-:/]+$/.test(txt)) narrow += 1;
    });
    return narrow / firstCells.length >= 0.8;
}

function getColumnCount(tableEl) {
    if (!tableEl) return 0;
    const headerRow = tableEl.querySelector('thead tr') || tableEl.querySelector('tr');
    return headerRow ? headerRow.querySelectorAll('th,td').length : 0;
}

export default function ChatTable({ children, ...props }) {
    const shellRef = useRef(null);
    const wrapperRef = useRef(null);
    const tableRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const [cols, setCols] = useState(0);
    const [narrowFirst, setNarrowFirst] = useState(false);
    const [overflow, setOverflow] = useState({ left: false, right: false });
    const [expanded, setExpanded] = useState(false);

    // ── Measurement: column count + first-column shape ──
    const remeasure = useCallback(() => {
        const t = tableRef.current;
        if (!t) return;
        const c = getColumnCount(t);
        setCols(c);
        setNarrowFirst(detectNarrowFirstColumn(t));
    }, []);

    useIsoLayoutEffect(() => {
        remeasure();
    }, [remeasure, children]);

    // ── Scroll-edge detection: drive fade indicators only when actually overflowing ──
    useEffect(() => {
        const wrap = wrapperRef.current;
        if (!wrap) return;

        let rafId = 0;

        // Compute next overflow state and bail out via functional updater when
        // values are unchanged. Returning the previous reference makes React skip
        // the re-render (Object.is bail-out), which is critical because the
        // ResizeObserver below observes elements that re-layout on every commit.
        const measure = () => {
            rafId = 0;
            const max = wrap.scrollWidth - wrap.clientWidth;
            const nextLeft = max > 1 && wrap.scrollLeft > 2;
            const nextRight = max > 1 && wrap.scrollLeft < max - 2;
            setOverflow((prev) =>
                prev.left === nextLeft && prev.right === nextRight
                    ? prev
                    : { left: nextLeft, right: nextRight }
            );
        };

        // Coalesce bursts of ResizeObserver/scroll callbacks within a single
        // animation frame — breaks the synchronous RO → setState → re-layout → RO
        // feedback loop that triggers "Maximum update depth exceeded".
        const update = () => {
            if (rafId !== 0) return;
            rafId = requestAnimationFrame(measure);
        };

        update();
        wrap.addEventListener('scroll', update, { passive: true });

        let ro;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(update);
            ro.observe(wrap);
            if (tableRef.current) ro.observe(tableRef.current);
        } else {
            window.addEventListener('resize', update);
        }

        return () => {
            if (rafId !== 0) cancelAnimationFrame(rafId);
            wrap.removeEventListener('scroll', update);
            if (ro) ro.disconnect();
            else window.removeEventListener('resize', update);
        };
    }, [cols]);

    // ── Lock body scroll while expand modal is open ──
    useEffect(() => {
        if (!expanded) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [expanded]);

    const handleCopy = async () => {
        try {
            const csv = tableToCsv(tableRef.current);
            await navigator.clipboard.writeText(csv);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* ignore */ }
    };

    // Auto-freeze first column when the table is wide AND first column is narrow.
    const frozenFirst = cols >= 5 && narrowFirst;
    // Show the "Expand" affordance for large tables only.
    const offerExpand = cols >= 6;

    const renderToolbar = (variant) => (
        <div className={`chat-table-toolbar chat-table-toolbar--${variant}`}>
            <span className="chat-table-toolbar__meta">
                <span className="chat-table-toolbar__dot" />
                {cols > 0 ? `${cols} cols` : 'Table'}
            </span>
            {offerExpand && variant === 'inline' && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="chat-table-toolbar__action"
                    title="Expand table"
                >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                    </svg>
                    <span>Expand</span>
                </button>
            )}
            <button
                type="button"
                onClick={handleCopy}
                className="chat-table-toolbar__action"
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
    );

    return (
        <>
            <div
                ref={shellRef}
                className="chat-table-shell group/table"
                data-cols={cols || undefined}
                data-narrow-first={narrowFirst ? 'true' : undefined}
                data-frozen-first={frozenFirst ? 'true' : undefined}
                data-overflow-left={overflow.left ? 'true' : undefined}
                data-overflow-right={overflow.right ? 'true' : undefined}
            >
                {renderToolbar('inline')}
                <div className="chat-table-wrapper" ref={wrapperRef}>
                    <table ref={tableRef} {...props}>{children}</table>
                </div>
            </div>

            {expanded && (
                <div
                    className="chat-table-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded table view"
                    onClick={() => setExpanded(false)}
                >
                    <div className="chat-table-modal__panel" onClick={(e) => e.stopPropagation()}>
                        <div className="chat-table-modal__header">
                            <span className="chat-table-toolbar__meta">
                                <span className="chat-table-toolbar__dot" />
                                {cols > 0 ? `${cols} cols` : 'Table'}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="chat-table-toolbar__action"
                                    title="Copy as CSV"
                                >
                                    {copied ? <><CheckIcon className="w-3 h-3" /><span>Copied</span></> : <><ClipboardIcon /><span>CSV</span></>}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExpanded(false)}
                                    className="chat-table-modal__close"
                                    title="Close (Esc)"
                                >
                                    <XIcon className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div
                            className="chat-table-shell chat-table-shell--modal"
                            data-cols={cols || undefined}
                            data-narrow-first={narrowFirst ? 'true' : undefined}
                            data-frozen-first={frozenFirst ? 'true' : undefined}
                        >
                            <div className="chat-table-wrapper chat-table-wrapper--modal">
                                <table {...props}>{children}</table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
