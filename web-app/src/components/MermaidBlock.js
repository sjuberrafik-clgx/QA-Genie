'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

/**
 * MermaidBlock — renders mermaid DSL strings as interactive SVG diagrams.
 *
 * Includes a sanitizer that preprocesses LLM-generated mermaid code to fix
 * common issues (HTML <br/> tags, HTML entities, stray tags) before passing
 * to mermaid.render().
 */
export default memo(MermaidBlock);

let idCounter = 0;

/* ── Sanitizer ─────────────────────────────────────────────────── */
function sanitizeMermaidCode(raw) {
    let code = raw;

    // ── Step 1: Decode HTML entities ──
    code = code.replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

    // ── Step 2: Replace <br/> with SPACE (not newline) ──
    // Converting to \n breaks mermaid: labels like D{Check<br/>Config} become
    // D{Check\nConfig} which splits the node across two lines. Mermaid's parser
    // then sees an incomplete node on each line and emits parse errors.
    // Spaces are safe — labels stay on one line and render correctly.
    code = code.replace(/<br\s*\/?>/gi, ' ');

    // ── Step 3: Remove remaining HTML tags (preserve --> arrows) ──
    code = code.replace(/<(?!\s*-)[^>]+>/g, '');

    // ── Step 4: Replace literal \n escape sequences with space ──
    // LLMs sometimes emit backslash-n in labels as a text escape
    code = code.replace(/\\n/g, ' ');

    // ── Step 5: Clean up whitespace ──
    code = code.split('\n')
        .map(l => l.replace(/ {2,}/g, ' ').trimEnd())
        .join('\n')
        .trim();

    // ── Step 6: Auto-quote problematic node labels ──
    // Characters like / ( ) : ; ' inside unquoted labels break mermaid's parser.
    // Wrapping in "..." fixes this. Only handles [...] and {...} shapes.
    const needsQuote = /[\/():;']/;
    code = code.split('\n').map(line => {
        // [...] labels — quote if contains problematic chars
        line = line.replace(/(\b\w+)\[([^\]"]+)\]/g, (m, id, c) =>
            needsQuote.test(c) ? `${id}["${c.replace(/"/g, "'")}"]` : m);
        // {...} labels (diamonds)
        line = line.replace(/(\b\w+)\{([^\}"]+)\}/g, (m, id, c) =>
            needsQuote.test(c) ? `${id}{"${c.replace(/"/g, "'")}"}` : m);
        // Edge labels: -- text --> with special chars → -->|text|
        line = line.replace(/ -- ([^|\n]+?) -->/g, (m, label) =>
            needsQuote.test(label.trim()) ? ` -->|${label.trim()}|` : m);
        return line;
    }).join('\n');

    return code;
}

/* ── Diagram type detector ─────────────────────────────────────── */
function detectDiagramType(code) {
    const first = code.split('\n')[0].trim().toLowerCase();
    if (first.startsWith('graph') || first.startsWith('flowchart')) return 'Flowchart';
    if (first.startsWith('sequencediagram')) return 'Sequence Diagram';
    if (first.startsWith('classd')) return 'Class Diagram';
    if (first.startsWith('state')) return 'State Diagram';
    if (first.startsWith('erdiagram')) return 'ER Diagram';
    if (first.startsWith('gantt')) return 'Gantt Chart';
    if (first.startsWith('pie')) return 'Pie Chart';
    if (first.startsWith('journey')) return 'Journey';
    if (first.startsWith('gitgraph')) return 'Git Graph';
    if (first.startsWith('mindmap')) return 'Mind Map';
    if (first.startsWith('timeline')) return 'Timeline';
    return 'Diagram';
}

/* ── Fullscreen zoom modal ────────────────────────────────────── */
function DiagramModal({ svgHtml, diagramType, onClose }) {
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const posStart = useRef({ x: 0, y: 0 });

    const MIN_SCALE = 0.2;
    const MAX_SCALE = 5;

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * delta)));
    }, []);

    const handlePointerDown = useCallback((e) => {
        if (e.target.closest('button')) return;
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY };
        posStart.current = { ...position };
        e.currentTarget.setPointerCapture(e.pointerId);
    }, [position]);

    const handlePointerMove = useCallback((e) => {
        if (!dragging) return;
        setPosition({
            x: posStart.current.x + (e.clientX - dragStart.current.x),
            y: posStart.current.y + (e.clientY - dragStart.current.y),
        });
    }, [dragging]);

    const handlePointerUp = useCallback(() => setDragging(false), []);

    const resetView = useCallback(() => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
    }, []);

    const fitToScreen = useCallback(() => {
        setScale(0.6);
        setPosition({ x: 0, y: 0 });
    }, []);

    // ESC to close
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    // Prevent body scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    return createPortal(
        <div className="mermaid-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            {/* Toolbar */}
            <div className="mermaid-modal-toolbar">
                <span className="text-xs font-semibold text-brand-600 uppercase tracking-wider flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                    </svg>
                    {diagramType}
                </span>
                <div className="flex items-center gap-1">
                    <button onClick={() => setScale(s => Math.min(MAX_SCALE, s * 1.3))} className="mermaid-modal-btn" title="Zoom in">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" /></svg>
                    </button>
                    <span className="text-[11px] text-surface-500 min-w-[40px] text-center font-mono">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.max(MIN_SCALE, s * 0.7))} className="mermaid-modal-btn" title="Zoom out">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" /></svg>
                    </button>
                    <div className="w-px h-4 bg-surface-300 mx-1" />
                    <button onClick={resetView} className="mermaid-modal-btn" title="Reset (100%)">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                    </button>
                    <button onClick={fitToScreen} className="mermaid-modal-btn" title="Fit to screen">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
                    </button>
                    <div className="w-px h-4 bg-surface-300 mx-1" />
                    <button onClick={onClose} className="mermaid-modal-btn mermaid-modal-btn-close" title="Close (Esc)">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div
                className="mermaid-modal-canvas"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            >
                <div
                    className="mermaid-modal-diagram"
                    style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                    }}
                    dangerouslySetInnerHTML={{ __html: svgHtml }}
                />
            </div>

            {/* Hint */}
            <div className="mermaid-modal-hint">
                Scroll to zoom · Drag to pan · Esc to close
            </div>
        </div>,
        document.body
    );
}

function MermaidBlock({ children }) {
    const containerRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [svgHtml, setSvgHtml] = useState('');
    const [showSource, setShowSource] = useState(false);
    const [copyState, setCopyState] = useState('idle');
    const [modalOpen, setModalOpen] = useState(false);

    const rawCode = typeof children === 'string' ? children.trim() : String(children).trim();
    const code = sanitizeMermaidCode(rawCode);
    const diagramType = detectDiagramType(code);

    const handleCopy = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyState('copied');
            setTimeout(() => setCopyState('idle'), 2000);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        if (!code) {
            setStatus('error');
            setErrorMsg('Empty diagram');
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const mermaid = (await import('mermaid')).default;

                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'base',
                    themeVariables: {
                        primaryColor: '#E8F4F6',
                        primaryTextColor: '#1a1a2e',
                        primaryBorderColor: '#1c8090',
                        lineColor: '#6B7280',
                        secondaryColor: '#F0FDFA',
                        tertiaryColor: '#FFF7ED',
                        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                        fontSize: '13px',
                        nodeBorder: '#1c8090',
                        mainBkg: '#E8F4F6',
                        edgeLabelBackground: '#ffffff',
                    },
                    flowchart: {
                        htmlLabels: true,
                        curve: 'basis',
                        padding: 16,
                        nodeSpacing: 50,
                        rankSpacing: 60,
                        useMaxWidth: false,
                        wrappingWidth: 200,
                    },
                    sequence: { useMaxWidth: false, showSequenceNumbers: true },
                    securityLevel: 'loose',
                });

                const uniqueId = `mermaid-${Date.now()}-${++idCounter}`;
                const { svg } = await mermaid.render(uniqueId, code);

                if (!cancelled) {
                    setSvgHtml(svg);
                    setStatus('rendered');
                }
            } catch (err) {
                if (!cancelled) {
                    console.warn('[MermaidBlock] Parse failed:', err.message);
                    setErrorMsg(err.message || 'Failed to parse diagram');
                    setStatus('error');
                }
            }
        })();

        return () => { cancelled = true; };
    }, [code]);

    // ── Loading skeleton ──
    if (status === 'loading') {
        return (
            <div className="mermaid-container mermaid-loading">
                <div className="flex flex-col items-center gap-3 py-8">
                    <div className="flex gap-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-20 h-10 rounded-lg border-2 border-dashed border-surface-300 animate-pulse" />
                        ))}
                    </div>
                    <span className="text-xs text-surface-400">Rendering {diagramType.toLowerCase()}…</span>
                </div>
            </div>
        );
    }

    // ── Error fallback ──
    if (status === 'error') {
        return (
            <div className="mermaid-container mermaid-fallback">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-600 font-medium uppercase tracking-wider">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Diagram preview unavailable
                    </div>
                    <button
                        onClick={() => handleCopy(rawCode)}
                        className="text-[10px] text-surface-400 hover:text-brand-500 transition-colors px-2 py-0.5 rounded"
                        title="Copy source"
                    >
                        {copyState === 'copied' ? '✓ Copied' : 'Copy'}
                    </button>
                </div>
                <pre className="text-xs text-surface-600 whitespace-pre-wrap font-mono leading-relaxed bg-surface-50 rounded-lg p-3 border border-surface-200 max-h-60 overflow-y-auto">
                    {rawCode}
                </pre>
            </div>
        );
    }

    // ── Rendered SVG ──
    return (
        <>
            <div className="mermaid-container mermaid-rendered">
                {/* Header bar */}
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold text-brand-600 uppercase tracking-wider flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                        </svg>
                        {diagramType}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setModalOpen(true)}
                            className="text-[10px] text-surface-400 hover:text-brand-500 transition-colors px-2 py-0.5 rounded hover:bg-brand-50 flex items-center gap-0.5"
                            title="Expand diagram (zoom & pan)"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                            Expand
                        </button>
                        <button
                            onClick={() => setShowSource(!showSource)}
                            className="text-[10px] text-surface-400 hover:text-brand-500 transition-colors px-2 py-0.5 rounded hover:bg-brand-50"
                            title={showSource ? 'Hide source' : 'View source'}
                        >
                            {showSource ? 'Hide source' : 'Source'}
                        </button>
                        <button
                            onClick={() => handleCopy(rawCode)}
                            className="text-[10px] text-surface-400 hover:text-brand-500 transition-colors px-2 py-0.5 rounded hover:bg-brand-50"
                            title="Copy diagram code"
                        >
                            {copyState === 'copied' ? '✓ Copied' : 'Copy'}
                        </button>
                    </div>
                </div>

                {/* SVG render — click anywhere on diagram to expand */}
                <div
                    ref={containerRef}
                    className="mermaid-svg-wrapper"
                    onClick={() => setModalOpen(true)}
                    title="Click to expand"
                    dangerouslySetInnerHTML={{ __html: svgHtml }}
                />

                {/* Source panel (collapsible) */}
                {showSource && (
                    <pre className="mt-3 text-xs text-surface-500 whitespace-pre-wrap font-mono leading-relaxed bg-surface-50 rounded-lg p-3 border border-surface-200 max-h-48 overflow-y-auto">
                        {rawCode}
                    </pre>
                )}
            </div>

            {/* Fullscreen zoom modal */}
            {modalOpen && (
                <DiagramModal
                    svgHtml={svgHtml}
                    diagramType={diagramType}
                    onClose={() => setModalOpen(false)}
                />
            )}
        </>
    );
}
