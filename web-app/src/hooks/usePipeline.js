'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSSE } from './useSSE';
import apiClient from '@/lib/api-client';

/**
 * React hook for managing pipeline execution with real-time updates.
 * Includes SSE error handling and status-poll fallback.
 */
export function usePipeline() {
    const [runs, setRuns] = useState([]);
    const [activeRunId, setActiveRunId] = useState(null);
    const [stages, setStages] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [networkWarning, setNetworkWarning] = useState(null);

    const stagesRef = useRef({});
    const pollIntervalRef = useRef(null);

    // Clear stale errors automatically after 12s for network-type warnings
    useEffect(() => {
        if (!networkWarning) return;
        const timer = setTimeout(() => setNetworkWarning(null), 12000);
        return () => clearTimeout(timer);
    }, [networkWarning]);

    const handleEvent = useCallback((type, event) => {
        const { runId, data } = event;
        if (!runId) return;

        // If we get events, SSE is working — clear any network warnings
        setNetworkWarning(null);

        switch (type) {
            case 'stage_start':
                stagesRef.current = {
                    ...stagesRef.current,
                    [data.stage]: { status: 'running', message: data.message },
                };
                setStages({ ...stagesRef.current });
                break;

            case 'stage_progress':
                stagesRef.current = {
                    ...stagesRef.current,
                    [data.stage]: { status: 'running', message: data.message },
                };
                setStages({ ...stagesRef.current });
                break;

            case 'stage_complete':
                stagesRef.current = {
                    ...stagesRef.current,
                    [data.stage]: {
                        status: data.success ? 'passed' : 'failed',
                        message: data.message,
                    },
                };
                setStages({ ...stagesRef.current });
                break;

            case 'run_complete':
                setRuns(prev =>
                    prev.map(r => r.runId === runId
                        ? { ...r, status: data.success ? 'completed' : 'failed', duration: data.duration }
                        : r
                    )
                );
                setActiveRunId(null);
                stopPoll();
                break;

            case 'error':
                setError(data.error || 'Unknown pipeline error');
                break;
        }
    }, []);

    // SSE error handler — start polling as fallback
    const handleSSEError = useCallback((errorMsg) => {
        setNetworkWarning('Stream disconnected — falling back to polling...');
    }, []);

    // Stream URL
    const streamUrl = activeRunId ? apiClient.getPipelineStreamUrl(activeRunId) : null;
    const { status: sseStatus, retryCount } = useSSE(streamUrl, {
        onEvent: handleEvent,
        onError: handleSSEError,
    });

    // Status poll fallback when SSE is disconnected during an active run
    const stopPoll = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (activeRunId && (sseStatus === 'disconnected' || sseStatus === 'reconnecting')) {
            if (!pollIntervalRef.current) {
                pollIntervalRef.current = setInterval(async () => {
                    try {
                        const status = await apiClient.getRunStatus(activeRunId);
                        if (status?.stages) {
                            stagesRef.current = {};
                            for (const [name, info] of Object.entries(status.stages)) {
                                stagesRef.current[name] = {
                                    status: info.status || 'pending',
                                    message: info.message || info.error || '',
                                };
                            }
                            setStages({ ...stagesRef.current });
                        }
                        if (['completed', 'failed', 'cancelled'].includes(status?.status)) {
                            setRuns(prev =>
                                prev.map(r => r.runId === activeRunId
                                    ? { ...r, status: status.status, duration: status.duration }
                                    : r
                                )
                            );
                            setActiveRunId(null);
                            stopPoll();
                        }
                    } catch { /* poll failure — will retry next interval */ }
                }, 10000);
            }
        } else {
            stopPoll();
        }
        return stopPoll;
    }, [activeRunId, sseStatus, stopPoll]);

    // Actions
    const startPipeline = useCallback(async (ticketId, mode = 'full', environment = 'UAT', model = 'gpt-4o') => {
        setLoading(true);
        setError(null);
        setNetworkWarning(null);
        stagesRef.current = {};
        setStages({});

        try {
            const result = await apiClient.startPipeline(ticketId, mode, environment, model);
            setActiveRunId(result.runId);
            setRuns(prev => [
                { runId: result.runId, ticketId, mode, status: 'running', startedAt: new Date().toISOString() },
                ...prev,
            ]);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const cancelPipeline = useCallback(async (runId) => {
        try {
            await apiClient.cancelPipeline(runId);
            setRuns(prev => prev.map(r => r.runId === runId ? { ...r, status: 'cancelled' } : r));
            if (activeRunId === runId) {
                setActiveRunId(null);
                stopPoll();
            }
        } catch (err) {
            setError(err.message);
        }
    }, [activeRunId, stopPoll]);

    const refreshRuns = useCallback(async (filters = {}) => {
        try {
            const data = await apiClient.listRuns(filters);
            setRuns(data.runs || []);
        } catch (err) {
            // Don't show "Failed to fetch" on initial page load — just silently fail
            if (!err.message?.includes('unreachable')) {
                setError(err.message);
            }
        }
    }, []);

    return {
        runs,
        activeRunId,
        stages,
        loading,
        error,
        networkWarning,
        sseStatus,
        retryCount,
        startPipeline,
        cancelPipeline,
        refreshRuns,
        setError,
    };
}

export default usePipeline;
