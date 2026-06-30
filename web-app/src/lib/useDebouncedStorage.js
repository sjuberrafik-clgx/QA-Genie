'use client';

import { useEffect, useRef } from 'react';

/**
 * Debounced localStorage writer.
 *
 * Persists `value` (serialized with JSON.stringify) under `key` only after
 * `delay` ms have passed without a change, so rapid state updates do not
 * trigger one synchronous storage write per render. The latest value is
 * also flushed on unmount and when the document becomes hidden so we
 * never lose user state on tab close / navigation.
 *
 * @param {string} key       — localStorage key
 * @param {*}      value     — JSON-serializable value to persist
 * @param {object} [opts]
 * @param {number} [opts.delay=600]   — debounce window in ms
 * @param {boolean} [opts.enabled=true] — set to false to suspend writes
 *        (useful while a parent is still hydrating)
 */
export function useDebouncedStorage(key, value, opts = {}) {
    const { delay = 600, enabled = true } = opts;
    const latestRef = useRef(value);
    const timerRef = useRef(null);

    latestRef.current = value;

    useEffect(() => {
        if (!enabled) return undefined;
        if (typeof window === 'undefined') return undefined;

        const flush = () => {
            try {
                window.localStorage.setItem(key, JSON.stringify(latestRef.current));
            } catch {
                // Ignore quota / serialization errors — non-fatal for UX state
            }
        };

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, delay);

        const onHide = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        document.addEventListener('visibilitychange', onHide);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            document.removeEventListener('visibilitychange', onHide);
            // Flush pending write on unmount so navigation doesn't lose state.
            flush();
        };
    }, [key, value, delay, enabled]);
}

export default useDebouncedStorage;
