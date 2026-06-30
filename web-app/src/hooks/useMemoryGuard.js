'use client';

import { useEffect, useRef } from 'react';
import { MEMORY_GUARD } from '@/lib/constants';

/**
 * useMemoryGuard — runtime renderer-memory safety net for the chat view.
 *
 * The Chrome "Aw, Snap!" STATUS_BREAKPOINT crash on long, image-heavy chat
 * sessions is driven by DOM-node count + decoded image bitmaps — the
 * "Other (HTML)" heap category — NOT the JS heap. `performance.memory` only
 * measures the JS heap, so it cannot observe (let alone prevent) this class of
 * crash. This hook samples two browser-memory proxies that DO track the
 * dangerous category and sheds load before the renderer is aborted:
 *
 *   1. document.getElementsByTagName('*').length  — total live DOM nodes
 *   2. Σ (naturalWidth × naturalHeight) over mounted <img> — decoded-bitmap budget
 *
 * When either exceeds its configured ceiling, `onPressure(stats)` is invoked so
 * the page can shed load (shrink the render window, evict old inline images). A
 * cooldown prevents thrashing.
 *
 * Diagnostics: in development, or when localStorage 'memDebug' === '1', a sample
 * is logged every tick — useful for confirming the DOM/image budget stays
 * bounded across a long agent run.
 *
 * @param {(stats: {domNodes:number, imagePixels:number, imageCount:number, overDom:boolean, overImg:boolean}) => void} onPressure
 * @param {object}  [opts]
 * @param {boolean} [opts.enabled] - master toggle (default: MEMORY_GUARD.ENABLED)
 */
export function useMemoryGuard(onPressure, opts = {}) {
    const { enabled = MEMORY_GUARD.ENABLED } = opts;
    const onPressureRef = useRef(onPressure);
    onPressureRef.current = onPressure;
    const lastShedRef = useRef(0);

    useEffect(() => {
        if (!enabled || typeof document === 'undefined') return undefined;

        const debug = (() => {
            try {
                if (process.env.NODE_ENV !== 'production') return true;
                return typeof window !== 'undefined'
                    && window.localStorage?.getItem('memDebug') === '1';
            } catch {
                return false;
            }
        })();

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

            const overDom = domNodes > MEMORY_GUARD.MAX_DOM_NODES;
            const overImg = imagePixels > MEMORY_GUARD.MAX_IMAGE_PIXELS;

            if (debug) {
                let jsHeap = 'n/a';
                try {
                    if (typeof performance !== 'undefined' && performance.memory) {
                        jsHeap = `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`;
                    }
                } catch { /* ignore */ }
                // eslint-disable-next-line no-console
                console.debug(
                    `[memGuard] domNodes=${domNodes} images=${imageCount} `
                    + `imagePixels=${(imagePixels / 1e6).toFixed(1)}M jsHeap=${jsHeap}`
                    + (overDom || overImg ? '  ⚠ PRESSURE — shedding load' : ''),
                );
            }

            if (overDom || overImg) {
                const now = Date.now();
                if (now - lastShedRef.current >= MEMORY_GUARD.COOLDOWN_MS) {
                    lastShedRef.current = now;
                    try {
                        onPressureRef.current?.({ domNodes, imagePixels, imageCount, overDom, overImg });
                    } catch { /* ignore */ }
                }
            }
        };

        const interval = setInterval(sample, MEMORY_GUARD.SAMPLE_MS);
        // First sample shortly after mount, once the initial paint has settled.
        const initial = setTimeout(sample, MEMORY_GUARD.INITIAL_DELAY_MS);

        return () => {
            cancelled = true;
            clearInterval(interval);
            clearTimeout(initial);
        };
    }, [enabled]);
}

export default useMemoryGuard;
