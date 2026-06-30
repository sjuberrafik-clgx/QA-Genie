'use client';

import { useEffect, useState } from 'react';
import { MEMORY_GUARD } from '@/lib/constants';

/**
 * MemoryHud — dev-only on-screen renderer-memory monitor for the chat view.
 *
 * The Chrome "Aw, Snap!" STATUS_BREAKPOINT crash on long, image-heavy chat
 * sessions is driven by the renderer's "Other (HTML)" memory — live DOM nodes
 * and decoded image bitmaps — which `performance.memory` (JS heap only) cannot
 * observe. This overlay samples the proxies that DO track that category so the
 * numbers can be watched live while reproducing the crash, confirming that the
 * virtualized timeline keeps them bounded.
 *
 * It renders nothing in production unless explicitly opted in. Enable with:
 *   localStorage.setItem('memDebug', '1')   // then reload
 * It is always on in development (NODE_ENV !== 'production').
 *
 * Reported metrics:
 *  - DOM nodes  — document.getElementsByTagName('*').length (vs MAX_DOM_NODES)
 *  - Img pixels — Σ (naturalWidth × naturalHeight) over mounted <img> (vs MAX_IMAGE_PIXELS)
 *  - JS heap    — performance.memory.usedJSHeapSize (Chromium only; informational)
 */

const SAMPLE_MS = 1000;

function hudEnabled() {
    try {
        if (process.env.NODE_ENV !== 'production') return true;
        return typeof window !== 'undefined' && window.localStorage?.getItem('memDebug') === '1';
    } catch {
        return false;
    }
}

function fmtCount(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function fmtMpx(pixels) {
    return `${(pixels / 1_000_000).toFixed(1)} Mpx`;
}

function fmtMB(bytes) {
    if (bytes == null) return '—';
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// green under 60% of ceiling, amber under 100%, red at/over the ceiling.
function levelColor(value, ceiling) {
    if (!ceiling) return '#94a3b8';
    const ratio = value / ceiling;
    if (ratio >= 1) return '#f87171';
    if (ratio >= 0.6) return '#fbbf24';
    return '#4ade80';
}

export default function MemoryHud() {
    const [enabled, setEnabled] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [stats, setStats] = useState(null);
    const [peak, setPeak] = useState({ domNodes: 0, imagePixels: 0, jsHeap: 0 });

    // Resolve enablement on the client only (avoids SSR/localStorage mismatch).
    useEffect(() => {
        setEnabled(hudEnabled());
    }, []);

    useEffect(() => {
        if (!enabled || typeof document === 'undefined') return undefined;
        let cancelled = false;

        const sample = () => {
            if (cancelled) return;

            let domNodes = 0;
            try { domNodes = document.getElementsByTagName('*').length; } catch { /* ignore */ }

            let imagePixels = 0;
            let imageCount = 0;
            try {
                const imgs = document.images || [];
                imageCount = imgs.length;
                for (let i = 0; i < imgs.length; i++) {
                    const im = imgs[i];
                    imagePixels += (im.naturalWidth || 0) * (im.naturalHeight || 0);
                }
            } catch { /* ignore */ }

            let jsHeap = null;
            let jsHeapLimit = null;
            try {
                const mem = typeof performance !== 'undefined' ? performance.memory : null;
                if (mem) {
                    jsHeap = mem.usedJSHeapSize;
                    jsHeapLimit = mem.jsHeapSizeLimit;
                }
            } catch { /* ignore */ }

            setStats({ domNodes, imagePixels, imageCount, jsHeap, jsHeapLimit });
            setPeak((prev) => ({
                domNodes: Math.max(prev.domNodes, domNodes),
                imagePixels: Math.max(prev.imagePixels, imagePixels),
                jsHeap: Math.max(prev.jsHeap, jsHeap || 0),
            }));
        };

        sample();
        const id = setInterval(sample, SAMPLE_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, [enabled]);

    if (!enabled || !stats) return null;

    const domColor = levelColor(stats.domNodes, MEMORY_GUARD.MAX_DOM_NODES);
    const imgColor = levelColor(stats.imagePixels, MEMORY_GUARD.MAX_IMAGE_PIXELS);

    const baseStyle = {
        position: 'fixed',
        bottom: '12px',
        left: '12px',
        zIndex: 2147483646,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        lineHeight: 1.5,
        color: '#e2e8f0',
        background: 'rgba(15, 23, 42, 0.92)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: '8px',
        boxShadow: '0 6px 22px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(4px)',
        userSelect: 'none',
        pointerEvents: 'auto',
    };

    if (collapsed) {
        return (
            <button
                type="button"
                onClick={() => setCollapsed(false)}
                title="Show renderer-memory monitor"
                style={{ ...baseStyle, padding: '4px 8px', cursor: 'pointer' }}
            >
                <span style={{ color: domColor }}>● </span>
                <span style={{ color: '#94a3b8' }}>mem</span>
            </button>
        );
    }

    const row = (label, value, color, sub) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
            <span style={{ color: '#94a3b8' }}>{label}</span>
            <span style={{ color: color || '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                {value}{sub ? <span style={{ color: '#64748b' }}> {sub}</span> : null}
            </span>
        </div>
    );

    return (
        <div style={{ ...baseStyle, padding: '8px 10px', minWidth: '184px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ color: '#cbd5e1', fontWeight: 600, letterSpacing: '0.02em' }}>renderer memory</span>
                <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    title="Collapse"
                    style={{ color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', lineHeight: 1, padding: 0 }}
                >
                    ×
                </button>
            </div>
            {row('DOM nodes', fmtCount(stats.domNodes), domColor, `/ ${fmtCount(MEMORY_GUARD.MAX_DOM_NODES)}`)}
            {row('img pixels', fmtMpx(stats.imagePixels), imgColor, `/ ${fmtMpx(MEMORY_GUARD.MAX_IMAGE_PIXELS)}`)}
            {row('img count', String(stats.imageCount))}
            {row('JS heap', fmtMB(stats.jsHeap), '#e2e8f0', stats.jsHeapLimit ? `/ ${fmtMB(stats.jsHeapLimit)}` : '')}
            <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid rgba(148,163,184,0.2)', color: '#64748b' }}>
                peak DOM {fmtCount(peak.domNodes)} · heap {fmtMB(peak.jsHeap)}
            </div>
        </div>
    );
}
