'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SSE_EVENT_TYPE_LIST, MAX_RECONNECT_DELAY_MS } from '@/lib/constants';

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

    onEventRef.current = onEvent;
    onErrorRef.current = onError;

    const disconnect = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        setStatus('disconnected');
        retriesRef.current = 0;
        setRetryCount(0);
    }, []);

    useEffect(() => {
        if (!url) {
            disconnect();
            return;
        }

        let mounted = true;

        function connect() {
            if (!mounted) return;

            setStatus('connecting');
            const es = new EventSource(url);
            eventSourceRef.current = es;

            es.onopen = () => {
                if (!mounted) return;
                setStatus('connected');
                retriesRef.current = 0;
                setRetryCount(0);
            };

            es.onmessage = (event) => {
                if (!mounted) return;
                try {
                    const data = JSON.parse(event.data);
                    setLastEvent(data);
                    onEventRef.current?.(data.type, data);
                } catch { /* ignore parse errors */ }
            };

            for (const type of SSE_EVENT_TYPE_LIST) {
                es.addEventListener(type, (event) => {
                    if (!mounted) return;
                    try {
                        const data = JSON.parse(event.data);
                        setLastEvent(data);
                        onEventRef.current?.(type, data);
                    } catch { /* ignore */ }
                });
            }

            es.onerror = () => {
                if (!mounted) return;
                es.close();
                eventSourceRef.current = null;

                if (retriesRef.current < maxRetries) {
                    retriesRef.current++;
                    setRetryCount(retriesRef.current);
                    const delay = Math.min(1000 * Math.pow(2, retriesRef.current), MAX_RECONNECT_DELAY_MS);
                    setStatus('reconnecting');
                    setTimeout(connect, delay);
                } else {
                    setStatus('disconnected');
                    onErrorRef.current?.('Stream disconnected — max reconnection attempts reached');
                }
            };
        }

        connect();

        return () => {
            mounted = false;
            disconnect();
        };
    }, [url, maxRetries, disconnect]);

    return { status, lastEvent, retryCount, disconnect };
}

