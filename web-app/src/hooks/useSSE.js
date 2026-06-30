'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SSE_EVENT_TYPE_LIST, MAX_RECONNECT_DELAY_MS, LIMITS } from '@/lib/constants';

// Cheap bounded estimate of an event's in-memory footprint. The first versions
// only counted top-level fields and attachment bytes; approval prompts later
// carried large nested `meta.mutationPreview` / `meta.preview` objects through
// USER_INPUT_REQUEST events, so the queue byte budget undercounted them by orders
// of magnitude. Recursing here is defense-in-depth: the server now sanitizes
// oversized approval meta before SSE, but future nested payloads should still be
// counted and dropped if they accumulate faster than the UI can flush.
function estimateEventBytes(value, state = { depth: 0, seen: new WeakSet(), visited: 0 }) {
    if (value === null || value === undefined) return 16;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number' || typeof value === 'boolean') return 16;
    if (typeof value !== 'object') return 64;
    if (state.seen.has(value)) return 32;
    if (state.depth > 8 || state.visited > 2000) return 1024;

    state.seen.add(value);
    state.visited += 1;
    let n = 64;
    if (Array.isArray(value)) {
        const max = Math.min(value.length, 200);
        for (let i = 0; i < max; i++) {
            n += estimateEventBytes(value[i], { depth: state.depth + 1, seen: state.seen, visited: state.visited });
        }
        if (value.length > max) n += (value.length - max) * 128;
        return n;
    }

    for (const [key, item] of Object.entries(value)) {
        n += key.length * 2 + estimateEventBytes(item, { depth: state.depth + 1, seen: state.seen, visited: state.visited });
    }
    return n;
}

/**
 * React hook for Server-Sent Events with auto-reconnect.
 *
 * @param {string|null} url - SSE endpoint URL (null to disconnect)
 * @param {Object} options
 * @param {Function} options.onEvent   - Called for each event: (eventType, data)
 * @param {Function} options.onError   - Called on errors
 * @param {number} options.maxRetries  - Max reconnect attempts (default: 10)
 * @returns {{ status, lastEvent, retryCount, disconnect }}
 */
export function useSSE(url, options = {}) {
    const { onEvent, onError, maxRetries = 10 } = options;
    const [status, setStatus] = useState('disconnected');
    const [lastEvent, setLastEvent] = useState(null);
    const [retryCount, setRetryCount] = useState(0);

    const eventSourceRef = useRef(null);
    const retriesRef = useRef(0);
    const onEventRef = useRef(onEvent);
    const onErrorRef = useRef(onError);
    const eventQueueRef = useRef([]);
    const queuedBytesRef = useRef(0);
    const flushTimerRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    // Detaches the current EventSource's listeners + closes it. Stored so both the
    // reconnect path and disconnect() can fully release the listener closures
    // (which capture the event queue) instead of leaving them attached to a closed
    // stream — a renderer-heap leak that compounds the Chrome STATUS_BREAKPOINT crash.
    const teardownRef = useRef(null);

    onEventRef.current = onEvent;
    onErrorRef.current = onError;

    const disconnect = useCallback(() => {
        if (teardownRef.current) {
            teardownRef.current();   // removeEventListener-all + close
            teardownRef.current = null;
        }
        eventSourceRef.current = null;
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        eventQueueRef.current = [];
        queuedBytesRef.current = 0;
        setStatus('disconnected');
        retriesRef.current = 0;
        setRetryCount(0);
    }, []);

    // Process at most BATCH_MAX events per tick. A reconnect can replay a burst
    // of buffered events; draining the entire backlog synchronously triggered
    // a flood of setState + ReactMarkdown re-parses that crashed the Chrome
    // renderer (STATUS_BREAKPOINT). Batching spreads the work across frames.
    const BATCH_MAX = 40;
    const flushQueuedEvents = useCallback(() => {
        flushTimerRef.current = null;
        if (eventQueueRef.current.length === 0) return;

        const batch = eventQueueRef.current.splice(0, BATCH_MAX);
        if (batch.length === 0) return;

        for (const item of batch) {
            queuedBytesRef.current -= (item.bytes || 0);
        }
        if (queuedBytesRef.current < 0) queuedBytesRef.current = 0;

        setLastEvent(batch[batch.length - 1].data);
        for (const item of batch) {
            onEventRef.current?.(item.type, item.data);
        }

        if (eventQueueRef.current.length > 0 && !flushTimerRef.current) {
            flushTimerRef.current = setTimeout(flushQueuedEvents, 16);
        }
    }, []);

    const enqueueEvent = useCallback((type, data) => {
        const bytes = estimateEventBytes(data);
        eventQueueRef.current.push({ type, data, bytes });
        queuedBytesRef.current += bytes;
        // Bound the backlog: a reconnect can replay a large burst of buffered
        // events faster than the batched flush drains them. Without a ceiling the
        // queue can spike the renderer heap (STATUS_BREAKPOINT). Drop the oldest
        // events on overflow — by COUNT and by BYTES — the freshest events are the
        // ones worth rendering.
        const overflow = eventQueueRef.current.length - LIMITS.MAX_QUEUED_SSE_EVENTS;
        if (overflow > 0) {
            const dropped = eventQueueRef.current.splice(0, overflow);
            for (const item of dropped) queuedBytesRef.current -= (item.bytes || 0);
        }
        while (queuedBytesRef.current > LIMITS.MAX_QUEUED_SSE_BYTES && eventQueueRef.current.length > 1) {
            const [item] = eventQueueRef.current.splice(0, 1);
            queuedBytesRef.current -= (item?.bytes || 0);
        }
        if (queuedBytesRef.current < 0) queuedBytesRef.current = 0;
        if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(flushQueuedEvents, 16);
        }
    }, [flushQueuedEvents]);

    useEffect(() => {
        if (!url) {
            disconnect();
            return;
        }

        let mounted = true;

        function connect() {
            if (!mounted) return;

            // Fully tear down any prior connection (remove every listener + close)
            // before opening a new one. Removing the listeners is essential: each
            // reconnect otherwise leaves ~14 dead listener closures — each capturing
            // enqueueEvent + the event queue — attached to a closed EventSource, a
            // renderer-heap leak that compounds the Chrome STATUS_BREAKPOINT crash.
            if (teardownRef.current) {
                teardownRef.current();
                teardownRef.current = null;
            }

            setStatus('connecting');
            const es = new EventSource(url);
            eventSourceRef.current = es;

            const onOpen = () => {
                if (!mounted) return;
                setStatus('connected');
                retriesRef.current = 0;
                setRetryCount(0);
            };

            const onMessage = (event) => {
                if (!mounted) return;
                try {
                    const data = JSON.parse(event.data);
                    enqueueEvent(data.type, data);
                } catch { /* ignore parse errors */ }
            };

            const onErrorEvent = () => {
                if (!mounted) return;
                // Detach this connection's listeners before reconnecting.
                if (teardownRef.current) {
                    teardownRef.current();
                    teardownRef.current = null;
                }
                eventSourceRef.current = null;

                if (retriesRef.current < maxRetries) {
                    retriesRef.current++;
                    setRetryCount(retriesRef.current);
                    const delay = Math.min(1000 * Math.pow(2, retriesRef.current), MAX_RECONNECT_DELAY_MS);
                    setStatus('reconnecting');
                    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = setTimeout(() => {
                        reconnectTimerRef.current = null;
                        connect();
                    }, delay);
                } else {
                    setStatus('disconnected');
                    onErrorRef.current?.('Stream disconnected — max reconnection attempts reached');
                }
            };

            // Keep references to every typed listener so they can be detached on
            // teardown (anonymous listeners could never be removed → leak).
            const typedHandlers = [];
            for (const type of SSE_EVENT_TYPE_LIST) {
                const handler = (event) => {
                    if (!mounted) return;
                    try {
                        const data = JSON.parse(event.data);
                        enqueueEvent(type, data);
                    } catch { /* ignore */ }
                };
                es.addEventListener(type, handler);
                typedHandlers.push([type, handler]);
            }
            es.onopen = onOpen;
            es.onmessage = onMessage;
            es.onerror = onErrorEvent;

            teardownRef.current = () => {
                for (const [type, handler] of typedHandlers) {
                    try { es.removeEventListener(type, handler); } catch { /* ignore */ }
                }
                es.onopen = null;
                es.onmessage = null;
                es.onerror = null;
                try { es.close(); } catch { /* ignore */ }
            };
        }

        connect();

        return () => {
            mounted = false;
            disconnect();
        };
    }, [url, maxRetries, disconnect, enqueueEvent]);

    return { status, lastEvent, retryCount, disconnect };
}

