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
    const [cognitiveInsights, setCognitiveInsights] = useState(null);
    const [liveOutput, setLiveOutput] = useState({
        runId: null,
        chunks: [],
        lastSeq: null,
        droppedChars: 0,
        updatedAt: null,
    });

    const stagesRef = useRef({});
    const pollIntervalRef = useRef(null);
    const liveOutputRef = useRef(liveOutput);

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
                {
                    const finalStatus = data.cancelled
                        ? 'cancelled'
                        : (data.success ? 'completed' : 'failed');
                    setRuns(prev =>
                        prev.map(r => r.runId === runId
                            ? { ...r, status: finalStatus, duration: data.duration }
                            : r
                        )
                    );
                    setActiveRunId(null);
                    stopPoll();
                }
                break;

            case 'command_progress':
                if (data.stage) {
                    const stageStatus = data.eventType === 'cancelled' ? 'failed' : 'running';
                    const stageMessage = data.text
                        || data.error
                        || data.command
                        || (data.eventType === 'exit' ? 'Command completed' : 'Running command...');

                    stagesRef.current = {
                        ...stagesRef.current,
                        [data.stage]: {
                            status: stageStatus,
                            message: stageMessage,
                        },
                    };
                    setStages({ ...stagesRef.current });
                }
                break;

            case 'command_output_chunk':
                {
                    const text = typeof data?.text === 'string' ? data.text : '';
                    if (!text) break;
                    const droppedChars = Number.isFinite(data?.droppedChars)
                        ? Math.max(0, data.droppedChars)
                        : 0;
                    const current = liveOutputRef.current;
                    const chunks = current.runId === runId
                        ? [...current.chunks, { text, stream: data.stream || 'stdout', stage: data.stage || null, timestamp: event.timestamp || new Date().toISOString() }]
                        : [{ text, stream: data.stream || 'stdout', stage: data.stage || null, timestamp: event.timestamp || new Date().toISOString() }];
                    // Cap in-memory ring so long runs don't balloon memory.
                    const MAX_CHUNKS = 800;
                    const trimmed = chunks.length > MAX_CHUNKS
                        ? chunks.slice(chunks.length - MAX_CHUNKS)
                        : chunks;
                    const next = {
                        runId,
                        chunks: trimmed,
                        lastSeq: current.runId === runId ? current.lastSeq : null,
                        droppedChars: (current.runId === runId ? current.droppedChars : 0) + droppedChars,
                        updatedAt: event.timestamp || new Date().toISOString(),
                    };
                    liveOutputRef.current = next;
                    setLiveOutput(next);
                }
                break;

            case 'error':
                setError(data.error || 'Unknown pipeline error');
                break;

            case 'cognitive_scaling':
                setCognitiveInsights({
                    tier: data.tier,
                    scaling: data.scaling,
                    source: data.source,
                    timestamp: Date.now(),
                });
                break;

            case 'ooda_health_check':
                setCognitiveInsights(prev => ({
                    ...prev,
                    ooda: {
                        decision: data.decision,
                        score: data.score,
                        duration: data.duration,
                    },
                }));
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
    const startPipeline = useCallback(async (identifier, mode = 'full', environment = 'UAT', model = 'gpt-4o', options = {}) => {
        setLoading(true);
        setError(null);
        setNetworkWarning(null);
        stagesRef.current = {};
        setStages({});
        const clearedLiveOutput = { runId: null, chunks: [], lastSeq: null, droppedChars: 0, updatedAt: null };
        liveOutputRef.current = clearedLiveOutput;
        setLiveOutput(clearedLiveOutput);

        try {
            const result = await apiClient.startPipeline(identifier, mode, environment, model, options);
            const runIdentifier = result.ticketId || options.ticketId || options.runId || identifier;
            setActiveRunId(result.runId);
            setRuns(prev => [
                { runId: result.runId, ticketId: runIdentifier, mode, status: 'running', startedAt: new Date().toISOString() },
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
        cognitiveInsights,
        liveOutput,
        sseStatus,
        retryCount,
        startPipeline,
        cancelPipeline,
        refreshRuns,
        setError,
    };
}

export default usePipeline;
