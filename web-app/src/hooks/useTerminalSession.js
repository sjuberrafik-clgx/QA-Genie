'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api-client';

const MAX_BUFFERED_EVENTS = 1600;
const MAX_RECONNECT_DELAY_MS = 5000;
const DEFAULT_OUTPUT_LIMIT = 450;
const WS_SYNC_OUTPUT_LIMIT = 1200;
const WS_PING_INTERVAL_MS = 15000;
const WS_PONG_TIMEOUT_MS = 45000;

function clampTerminalDimension(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function readEventSeq(entry, fallback = -1) {
    return Number.isFinite(entry?.seq) ? entry.seq : fallback;
}

function mergeEventsBySeq(current = [], incoming = []) {
    const currentList = Array.isArray(current) ? current : [];
    const incomingList = Array.isArray(incoming) ? incoming : [];

    if (incomingList.length === 0) {
        if (currentList.length <= MAX_BUFFERED_EVENTS) return currentList;
        return currentList.slice(currentList.length - MAX_BUFFERED_EVENTS);
    }

    const seen = new Set();
    const merged = [];

    const pushEntry = (entry) => {
        if (!entry || typeof entry !== 'object') return;
        const seq = readEventSeq(entry, -1);
        if (seq >= 0) {
            if (seen.has(seq)) return;
            seen.add(seq);
        }
        merged.push(entry);
    };

    for (const entry of currentList) pushEntry(entry);
    for (const entry of incomingList) pushEntry(entry);

    merged.sort((left, right) => {
        const leftSeq = readEventSeq(left, -1);
        const rightSeq = readEventSeq(right, -1);
        if (leftSeq < 0 || rightSeq < 0) return 0;
        return leftSeq - rightSeq;
    });

    if (merged.length <= MAX_BUFFERED_EVENTS) return merged;
    return merged.slice(merged.length - MAX_BUFFERED_EVENTS);
}

function uniqueSessionIds(ids = []) {
    return Array.from(new Set((ids || []).filter((id) => typeof id === 'string' && id.trim())));
}

function normalizeSessionSnapshot(source = {}) {
    return {
        sessionId: source.sessionId || null,
        shell: source.shell || null,
        shellCommand: source.shellCommand || null,
        backend: source.backend || null,
        cwd: source.cwd || null,
        cols: source.cols || null,
        rows: source.rows || null,
        status: source.status || 'unknown',
        createdAt: source.createdAt || null,
        startedAt: source.startedAt || null,
        updatedAt: source.updatedAt || null,
        closedAt: source.closedAt || null,
        exitCode: Number.isInteger(source.exitCode) ? source.exitCode : null,
        signal: source.signal || null,
        totalEntries: Number.isFinite(source.totalEntries) ? source.totalEntries : 0,
        droppedEntries: Number.isFinite(source.droppedEntries) ? source.droppedEntries : 0,
        liveClients: Number.isFinite(source.liveClients) ? source.liveClients : 0,
    };
}

export function useTerminalSession() {
    const [sessions, setSessions] = useState([]);
    const [sessionSnapshots, setSessionSnapshots] = useState({});
    const [eventsBySession, setEventsBySession] = useState({});
    const [loadingBySession, setLoadingBySession] = useState({});
    const [creating, setCreating] = useState(false);
    const [sendingBySession, setSendingBySession] = useState({});
    const [wsStatusBySession, setWsStatusBySession] = useState({});
    const [retriesBySession, setRetriesBySession] = useState({});
    const [error, setError] = useState(null);

    const socketsRef = useRef(new Map());
    const reconnectTimersRef = useRef(new Map());
    const retriesRef = useRef(new Map());
    const mountedRef = useRef(true);
    const sessionSnapshotsRef = useRef(sessionSnapshots);
    const sessionTokensRef = useRef(new Map());

    // Hydrate per-session tokens from sessionStorage so that after a
    // page reload we can reattach to a still-running PTY without being
    // rejected by the server's token check. sessionStorage is
    // tab-scoped, which matches the lifetime of a terminal session UX.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        try {
            const raw = window.sessionStorage.getItem('terminal.session.tokens');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                for (const [sessionId, token] of Object.entries(parsed)) {
                    if (typeof sessionId === 'string' && typeof token === 'string' && token) {
                        sessionTokensRef.current.set(sessionId, token);
                    }
                }
            }
        } catch {
            // Corrupt storage — ignore; tokens will fall back to create-time map only.
        }
    }, []);

    const persistSessionToken = useCallback((sessionId, token) => {
        if (!sessionId) return;
        if (typeof token === 'string' && token) {
            sessionTokensRef.current.set(sessionId, token);
        } else {
            sessionTokensRef.current.delete(sessionId);
        }
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        try {
            const serialized = Object.fromEntries(sessionTokensRef.current.entries());
            window.sessionStorage.setItem('terminal.session.tokens', JSON.stringify(serialized));
        } catch {
            // Quota or private mode — silently ignore.
        }
    }, []);

    useEffect(() => {
        sessionSnapshotsRef.current = sessionSnapshots;
    }, [sessionSnapshots]);

    const setSessionLoading = useCallback((sessionId, loading) => {
        if (!sessionId) return;
        setLoadingBySession((prev) => ({
            ...prev,
            [sessionId]: loading,
        }));
    }, []);

    const setSessionSending = useCallback((sessionId, sending) => {
        if (!sessionId) return;
        setSendingBySession((prev) => ({
            ...prev,
            [sessionId]: sending,
        }));
    }, []);

    const setSessionWsStatus = useCallback((sessionId, status) => {
        if (!sessionId) return;
        setWsStatusBySession((prev) => ({
            ...prev,
            [sessionId]: status,
        }));
    }, []);

    const setSessionRetries = useCallback((sessionId, retries) => {
        if (!sessionId) return;
        setRetriesBySession((prev) => ({
            ...prev,
            [sessionId]: retries,
        }));
    }, []);

    const clearReconnectTimer = useCallback((sessionId) => {
        const timer = reconnectTimersRef.current.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            reconnectTimersRef.current.delete(sessionId);
        }
    }, []);

    const closeSocket = useCallback((sessionId, reason = 'Client detach') => {
        if (!sessionId) return;

        clearReconnectTimer(sessionId);
        const socket = socketsRef.current.get(sessionId);
        socketsRef.current.delete(sessionId);

        if (!socket) {
            setSessionWsStatus(sessionId, 'disconnected');
            return;
        }

        try {
            socket.onopen = null;
            socket.onclose = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.close(1000, reason);
        } catch {
            // Ignore close errors
        }

        setSessionWsStatus(sessionId, 'disconnected');
    }, [clearReconnectTimer, setSessionWsStatus]);

    const closeAllSockets = useCallback(() => {
        const sessionIds = Array.from(socketsRef.current.keys());
        for (const sessionId of sessionIds) {
            closeSocket(sessionId, 'Client cleanup');
        }

        for (const timer of reconnectTimersRef.current.values()) {
            clearTimeout(timer);
        }
        reconnectTimersRef.current.clear();
    }, [closeSocket]);

    const sendSocketMessage = useCallback((sessionId, payload) => {
        if (!sessionId) return false;
        const socket = socketsRef.current.get(sessionId);
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            socket.send(JSON.stringify(payload));
            return true;
        } catch {
            return false;
        }
    }, []);

    const shouldReconnect = useCallback((sessionId) => {
        if (!mountedRef.current) return false;
        const status = sessionSnapshotsRef.current?.[sessionId]?.status;
        return status === 'running' || status === 'terminating';
    }, []);

    const refreshSessions = useCallback(async () => {
        const payload = await apiClient.listTerminalSessions();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setSessions(items);

        setSessionSnapshots((prev) => {
            const next = { ...prev };
            for (const item of items) {
                const normalized = normalizeSessionSnapshot(item || {});
                if (!normalized.sessionId) continue;
                next[normalized.sessionId] = normalizeSessionSnapshot({
                    ...(next[normalized.sessionId] || {}),
                    ...normalized,
                });
            }
            return next;
        });

        return items;
    }, []);

    const syncSessionFromServer = useCallback(async (sessionId, limit = WS_SYNC_OUTPUT_LIMIT) => {
        if (!sessionId || !mountedRef.current) return;

        try {
            const payload = await apiClient.getTerminalSessionOutput(sessionId, limit);
            const snapshot = normalizeSessionSnapshot(payload || {});
            const entries = Array.isArray(payload?.entries) ? payload.entries : [];

            setSessionSnapshots((prev) => ({
                ...prev,
                [sessionId]: normalizeSessionSnapshot({
                    ...(prev[sessionId] || {}),
                    ...snapshot,
                }),
            }));

            setEventsBySession((prev) => {
                const current = Array.isArray(prev[sessionId]) ? prev[sessionId] : [];
                return {
                    ...prev,
                    [sessionId]: mergeEventsBySeq(current, entries),
                };
            });
        } catch {
            // Best effort: live stream can still continue without snapshot sync.
        }
    }, []);

    const connectWebSocket = useCallback((sessionId, options = {}) => {
        if (!sessionId) return;

        const forceReconnect = options.forceReconnect === true;

        clearReconnectTimer(sessionId);

        const existing = socketsRef.current.get(sessionId);
        if (existing && !forceReconnect) {
            if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) {
                return;
            }
        }

        if (existing) {
            closeSocket(sessionId, forceReconnect ? 'Forced reconnect' : 'Reconnect');
        }

        const wsUrl = apiClient.getTerminalWebSocketUrl(sessionId, {
            token: sessionTokensRef.current.get(sessionId) || undefined,
        });
        const socket = new WebSocket(wsUrl);
        socketsRef.current.set(sessionId, socket);
        let allowReconnect = true;
        let pingTimer = null;
        let lastPongAt = Date.now();

        const stopPing = () => {
            if (!pingTimer) return;
            clearInterval(pingTimer);
            pingTimer = null;
        };

        setSessionWsStatus(sessionId, 'connecting');

        socket.onopen = () => {
            retriesRef.current.set(sessionId, 0);
            setSessionRetries(sessionId, 0);
            setSessionWsStatus(sessionId, 'connected');

            stopPing();
            lastPongAt = Date.now();
            pingTimer = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN) {
                    stopPing();
                    return;
                }

                if (Date.now() - lastPongAt > WS_PONG_TIMEOUT_MS) {
                    stopPing();
                    try {
                        socket.close(4000, 'Terminal heartbeat timeout');
                    } catch {
                        // ignore
                    }
                    return;
                }

                try {
                    socket.send(JSON.stringify({ type: 'ping' }));
                } catch {
                    // Best effort; onclose will reconnect.
                }
            }, WS_PING_INTERVAL_MS);

            syncSessionFromServer(sessionId).catch(() => { });

            // Replay the client's last-known viewport dimensions so that
            // after a reconnect the server's PTY and the browser terminal
            // stay in sync. Server short-circuits no-op resizes.
            try {
                const snapshot = sessionSnapshotsRef.current?.[sessionId];
                const cols = Number.isFinite(snapshot?.cols) ? snapshot.cols : null;
                const rows = Number.isFinite(snapshot?.rows) ? snapshot.rows : null;
                if (cols && rows) {
                    socket.send(JSON.stringify({ type: 'resize', cols, rows }));
                }
            } catch {
                // Best effort; the terminal pane will emit its own resize shortly.
            }
        };

        socket.onmessage = (event) => {
            let payload;
            try {
                payload = JSON.parse(event.data);
            } catch {
                return;
            }

            if (payload?.event === 'terminal_snapshot') {
                const snapshot = normalizeSessionSnapshot(payload?.data?.session || {});
                const entries = Array.isArray(payload?.data?.entries) ? payload.data.entries : [];

                setSessionSnapshots((prev) => ({
                    ...prev,
                    [sessionId]: normalizeSessionSnapshot({
                        ...(prev[sessionId] || {}),
                        ...snapshot,
                    }),
                }));
                setEventsBySession((prev) => {
                    const current = Array.isArray(prev[sessionId]) ? prev[sessionId] : [];
                    return {
                        ...prev,
                        [sessionId]: mergeEventsBySeq(current, entries),
                    };
                });
                return;
            }

            if (payload?.event === 'terminal_pong') {
                lastPongAt = Date.now();
                return;
            }

            if (payload?.event === 'terminal_event') {
                const nextEvent = payload?.data;
                if (!nextEvent) return;

                setEventsBySession((prev) => {
                    const current = Array.isArray(prev[sessionId]) ? prev[sessionId] : [];
                    return {
                        ...prev,
                        [sessionId]: mergeEventsBySeq(current, [nextEvent]),
                    };
                });

                setSessionSnapshots((prev) => {
                    const current = normalizeSessionSnapshot({
                        ...(prev[sessionId] || {}),
                        sessionId,
                    });

                    if (nextEvent.type === 'exit') {
                        return {
                            ...prev,
                            [sessionId]: normalizeSessionSnapshot({
                                ...current,
                                status: 'closed',
                                exitCode: Number.isInteger(nextEvent.exitCode) ? nextEvent.exitCode : null,
                                signal: nextEvent.signal || null,
                                updatedAt: nextEvent.timestamp,
                                closedAt: nextEvent.timestamp,
                            }),
                        };
                    }

                    return {
                        ...prev,
                        [sessionId]: normalizeSessionSnapshot({
                            ...current,
                            updatedAt: nextEvent.timestamp || current.updatedAt,
                        }),
                    };
                });

                if (nextEvent.type === 'exit') {
                    allowReconnect = false;
                    setSessionWsStatus(sessionId, 'disconnected');
                    retriesRef.current.set(sessionId, 0);
                    setSessionRetries(sessionId, 0);
                    stopPing();
                }
                return;
            }

            if (payload?.event === 'terminal_error') {
                setError(payload?.data?.message || 'Terminal WebSocket error');
                return;
            }

            if (payload?.event === 'terminal_backpressure') {
                setError(`Terminal output throttled — slow consumer (${Math.round((payload?.data?.bufferedAmount || 0) / 1024)} KB buffered). Some output may be dropped.`);
            }
        };

        socket.onerror = () => {
            setSessionWsStatus(sessionId, 'error');
        };

        socket.onclose = () => {
            stopPing();

            const registered = socketsRef.current.get(sessionId);
            if (registered === socket) {
                socketsRef.current.delete(sessionId);
            }

            if (!mountedRef.current) {
                setSessionWsStatus(sessionId, 'disconnected');
                return;
            }

            setSessionWsStatus(sessionId, 'disconnected');

            if (!allowReconnect || !shouldReconnect(sessionId)) {
                return;
            }

            const attempt = (retriesRef.current.get(sessionId) || 0) + 1;
            retriesRef.current.set(sessionId, attempt);
            setSessionRetries(sessionId, attempt);
            const delay = Math.min(400 * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);

            const timer = setTimeout(() => {
                reconnectTimersRef.current.delete(sessionId);
                if (mountedRef.current && shouldReconnect(sessionId)) {
                    connectWebSocket(sessionId);
                }
            }, delay);

            reconnectTimersRef.current.set(sessionId, timer);
        };
    }, [clearReconnectTimer, closeSocket, setSessionRetries, setSessionWsStatus, shouldReconnect, syncSessionFromServer]);

    const loadSession = useCallback(async (sessionId, options = {}) => {
        if (!sessionId) {
            return null;
        }

        const connectIfRunning = options.connectIfRunning !== false;
        const refreshList = options.refreshList !== false;
        const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_OUTPUT_LIMIT;

        setSessionLoading(sessionId, true);
        setError(null);

        try {
            const payload = await apiClient.getTerminalSessionOutput(sessionId, limit);
            const snapshot = normalizeSessionSnapshot(payload || {});
            const entries = Array.isArray(payload?.entries) ? payload.entries : [];

            setSessionSnapshots((prev) => ({
                ...prev,
                [sessionId]: snapshot,
            }));
            setEventsBySession((prev) => {
                const current = Array.isArray(prev[sessionId]) ? prev[sessionId] : [];
                return {
                    ...prev,
                    [sessionId]: mergeEventsBySeq(current, entries),
                };
            });

            if (refreshList) {
                await refreshSessions();
            }

            if (connectIfRunning && (snapshot.status === 'running' || snapshot.status === 'terminating')) {
                connectWebSocket(sessionId, { forceReconnect: options.forceReconnect === true });
            } else {
                closeSocket(sessionId, 'Session not running');
            }

            return snapshot;
        } catch (err) {
            setError(err.message || 'Failed to load terminal session');
            closeSocket(sessionId, 'Load failed');
            throw err;
        } finally {
            setSessionLoading(sessionId, false);
        }
    }, [closeSocket, connectWebSocket, refreshSessions, setSessionLoading]);

    const resumeSessions = useCallback(async (sessionIds = [], options = {}) => {
        const requestedIds = uniqueSessionIds(sessionIds);
        if (requestedIds.length === 0) return [];

        const listed = await refreshSessions();
        const known = new Set((listed || []).map((item) => item.sessionId));
        const restorable = requestedIds.filter((sessionId) => known.has(sessionId));

        await Promise.all(restorable.map((sessionId) => (
            loadSession(sessionId, {
                limit: Number.isFinite(options.limit) ? options.limit : DEFAULT_OUTPUT_LIMIT,
                connectIfRunning: true,
                refreshList: false,
            }).catch(() => null)
        )));

        return restorable;
    }, [loadSession, refreshSessions]);

    const createSession = useCallback(async (options = {}) => {
        setCreating(true);
        setError(null);

        try {
            const payload = await apiClient.createTerminalSession(options);
            const sessionId = payload?.sessionId;
            if (sessionId && typeof payload?.sessionToken === 'string' && payload.sessionToken) {
                persistSessionToken(sessionId, payload.sessionToken);
            }
            await refreshSessions();

            if (sessionId) {
                await loadSession(sessionId, {
                    connectIfRunning: true,
                    refreshList: false,
                });
            }

            return payload;
        } catch (err) {
            setError(err.message || 'Failed to create terminal session');
            throw err;
        } finally {
            setCreating(false);
        }
    }, [loadSession, refreshSessions, persistSessionToken]);

    const sendInput = useCallback(async (sessionId, input, options = {}) => {
        if (!sessionId) throw new Error('sessionId is required');

        setSessionSending(sessionId, true);
        setError(null);

        try {
            const token = sessionTokensRef.current.get(sessionId);
            await apiClient.sendTerminalInput(sessionId, input, {
                ...options,
                token: options.token || token,
            });
        } catch (err) {
            setError(err.message || 'Failed to send terminal input');
            throw err;
        } finally {
            setSessionSending(sessionId, false);
        }
    }, [setSessionSending]);

    const sendCommand = useCallback(async (sessionId, command) => {
        if (!sessionId) throw new Error('sessionId is required');

        setSessionSending(sessionId, true);
        setError(null);

        try {
            const commandText = typeof command === 'string' ? command : String(command ?? '');
            const deliveredOverSocket = sendSocketMessage(sessionId, {
                type: 'command',
                command: commandText,
            });

            if (deliveredOverSocket) {
                return;
            }

            const token = sessionTokensRef.current.get(sessionId);
            await apiClient.sendTerminalCommand(sessionId, command, { token });
        } catch (err) {
            setError(err.message || 'Failed to send terminal command');
            throw err;
        } finally {
            setSessionSending(sessionId, false);
        }
    }, [sendSocketMessage, setSessionSending]);

    const resizeSession = useCallback(async (sessionId, cols, rows) => {
        if (!sessionId) throw new Error('sessionId is required');

        try {
            const token = sessionTokensRef.current.get(sessionId);
            const snapshot = await apiClient.resizeTerminalSession(sessionId, cols, rows, { token });
            const normalized = normalizeSessionSnapshot(snapshot || {});
            setSessionSnapshots((prev) => ({
                ...prev,
                [sessionId]: normalized,
            }));
            return normalized;
        } catch (err) {
            setError(err.message || 'Failed to resize terminal session');
            throw err;
        }
    }, []);

    const sendInputRealtime = useCallback(async (sessionId, input, options = {}) => {
        if (!sessionId) throw new Error('sessionId is required');

        const fallbackToHttp = options.fallbackToHttp !== false;

        const text = typeof input === 'string' ? input : String(input ?? '');
        if (!text) return;

        const deliveredOverSocket = sendSocketMessage(sessionId, {
            type: 'input',
            input: text,
        });

        if (!deliveredOverSocket) {
            const status = sessionSnapshotsRef.current?.[sessionId]?.status;
            if (status === 'running' || status === 'terminating') {
                connectWebSocket(sessionId);
            }
        }

        if (deliveredOverSocket || !fallbackToHttp) {
            return;
        }

        await sendInput(sessionId, text, { appendNewline: false });
    }, [connectWebSocket, sendInput, sendSocketMessage]);

    const sendResizeRealtime = useCallback(async (sessionId, cols, rows, options = {}) => {
        if (!sessionId) throw new Error('sessionId is required');

        const fallbackToHttp = options.fallbackToHttp !== false;

        const nextCols = clampTerminalDimension(cols, 120, 40, 320);
        const nextRows = clampTerminalDimension(rows, 36, 10, 120);

        const deliveredOverSocket = sendSocketMessage(sessionId, {
            type: 'resize',
            cols: nextCols,
            rows: nextRows,
        });

        if (!deliveredOverSocket) {
            const status = sessionSnapshotsRef.current?.[sessionId]?.status;
            if (status === 'running' || status === 'terminating') {
                connectWebSocket(sessionId);
            }
        }

        if (deliveredOverSocket) {
            setSessionSnapshots((prev) => ({
                ...prev,
                [sessionId]: normalizeSessionSnapshot({
                    ...(prev[sessionId] || {}),
                    sessionId,
                    cols: nextCols,
                    rows: nextRows,
                    updatedAt: new Date().toISOString(),
                }),
            }));
            return;
        }

        if (!fallbackToHttp) {
            return;
        }

        await resizeSession(sessionId, nextCols, nextRows);
    }, [connectWebSocket, resizeSession, sendSocketMessage]);

    const terminateSession = useCallback(async (sessionId, options = {}) => {
        if (!sessionId) return;

        setError(null);
        try {
            const token = sessionTokensRef.current.get(sessionId);
            const snapshot = await apiClient.terminateTerminalSession(sessionId, {
                ...options,
                token: options.token || token,
            });
            const normalized = normalizeSessionSnapshot(snapshot || {});

            setSessionSnapshots((prev) => ({
                ...prev,
                [sessionId]: normalized,
            }));

            if (normalized.status === 'closed') {
                closeSocket(sessionId, 'Terminated');
                persistSessionToken(sessionId, null);
            }

            await refreshSessions();
            return normalized;
        } catch (err) {
            setError(err.message || 'Failed to terminate terminal session');
            throw err;
        }
    }, [closeSocket, refreshSessions, persistSessionToken]);

    useEffect(() => {
        mountedRef.current = true;

        refreshSessions()
            .catch((err) => {
                if (!mountedRef.current) return;
                setError(err.message || 'Failed to load terminal sessions');
            });

        return () => {
            mountedRef.current = false;
            closeAllSockets();
        };
    }, [closeAllSockets, refreshSessions]);

    return {
        sessions,
        sessionSnapshots,
        eventsBySession,
        loadingBySession,
        creating,
        sendingBySession,
        wsStatusBySession,
        retriesBySession,
        error,
        setError,
        refreshSessions,
        loadSession,
        resumeSessions,
        createSession,
        sendInput,
        sendInputRealtime,
        sendCommand,
        resizeSession,
        sendResizeRealtime,
        terminateSession,
        closeSocket,
    };
}

export default useTerminalSession;
