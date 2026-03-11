'use client';

/**
 * LottieLogo — Animated logo using the dotlottie-wc web component.
 *
 * Performance strategy:
 *   - Loads the lightweight `dotlottie-wc` script from CDN at runtime,
 *     completely bypassing Webpack bundling (avoids the WASM `.call()`
 *     runtime error with Next.js 15).
 *   - Script is loaded once globally and cached by the browser.
 *   - The .lottie asset (~few KB) is fetched once, also browser-cached.
 *   - Respects `prefers-reduced-motion` — pauses animation for a11y.
 *   - No npm dependency required — zero impact on bundle size.
 *   - Uses ref-based DOM insertion so the custom element gets proper
 *     width/height attributes (React JSX cannot set attributes on
 *     unknown web components reliably).
 *
 * Usage:
 *   <LottieLogo size={56} />            // sidebar
 *   <LottieLogo size={120} speed={1} /> // splash/landing
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const LOTTIE_SRC = 'https://lottie.host/62b95262-b767-4fe5-b573-7308d7e79677/DwYQn7YGaK.lottie';
const WC_SCRIPT = 'https://unpkg.com/@lottiefiles/dotlottie-wc@0.9.3/dist/dotlottie-wc.js';

// Global: load the web component script once across all instances
let scriptLoaded = false;
function ensureScript() {
    if (scriptLoaded || typeof document === 'undefined') return;
    scriptLoaded = true;
    const s = document.createElement('script');
    s.src = WC_SCRIPT;
    s.type = 'module';
    s.async = true;
    document.head.appendChild(s);
}

export default function LottieLogo({
    size = 56,
    className = '',
    speed = 1,
    loop = true,
}) {
    const containerRef = useRef(null);
    const wcRef = useRef(null);
    const [reducedMotion, setReducedMotion] = useState(false);

    // Load the web component script on first mount
    useEffect(() => {
        ensureScript();
    }, []);

    // Respect prefers-reduced-motion
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mq.matches);
        const handler = (e) => setReducedMotion(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Create the web component imperatively so attributes are set correctly
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Remove previous instance if any
        if (wcRef.current) {
            wcRef.current.remove();
        }

        const el = document.createElement('dotlottie-wc');
        el.setAttribute('src', LOTTIE_SRC);
        el.setAttribute('style', `width:${size}px;height:${size}px;display:block;`);
        if (!reducedMotion) el.setAttribute('autoplay', '');
        if (loop) el.setAttribute('loop', '');
        if (speed !== 1) el.setAttribute('speed', String(speed));

        wcRef.current = el;
        container.appendChild(el);

        return () => {
            if (el.parentNode) el.remove();
        };
    }, [size, loop, speed, reducedMotion]);

    return (
        <div
            ref={containerRef}
            className={`inline-flex items-center justify-center shrink-0 overflow-hidden ${className}`}
            style={{ width: size, height: size }}
            aria-hidden="true"
        />
    );
}
