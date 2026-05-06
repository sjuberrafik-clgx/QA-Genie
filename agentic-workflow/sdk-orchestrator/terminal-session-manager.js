/**
 * Interactive terminal session manager.
 * Provides long-lived shell sessions with live output streaming and buffering.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pty = require('node-pty');

const SESSION_STATUS = {
    RUNNING: 'running',
    TERMINATING: 'terminating',
    CLOSED: 'closed',
};

function nowIso() {
    return new Date().toISOString();
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizeChunk(chunk) {
    if (chunk == null) return '';
    return Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
}

function normalizeShellValue(value) {
    if (!value || typeof value !== 'string') return null;
    return value.trim().toLowerCase();
}

function isWithinRoot(candidatePath, rootPath) {
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(rootPath);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function terminateWindowsProcessTree(pid) {
    return new Promise((resolve) => {
        if (!pid) return resolve();

        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        });

        killer.on('error', () => resolve());
        killer.on('close', () => resolve());
    });
}

class TerminalSessionManager {
    constructor(options = {}) {
        this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
        this.allowExternalCwd = options.allowExternalCwd === true;
        this.defaultShell = normalizeShellValue(options.defaultShell) || this._getDefaultShell();
        this.bufferLimit = clampInteger(options.bufferLimit, 1200, 100, 10000);
        this.maxSessions = clampInteger(options.maxSessions, 20, 2, 200);
        this.closedSessionRetentionMs = clampInteger(
            options.closedSessionRetentionMs,
            30 * 60 * 1000,
            30 * 1000,
            24 * 60 * 60 * 1000
        );

        this.sessions = new Map();

        this._cleanupTimer = setInterval(() => {
            this._pruneClosedSessions();
        }, 30 * 1000);

        if (typeof this._cleanupTimer.unref === 'function') {
            this._cleanupTimer.unref();
        }
    }

    _getDefaultShell() {
        if (process.platform === 'win32') {
            return 'pwsh';
        }

        if (process.env.SHELL && process.env.SHELL.trim()) {
            return process.env.SHELL.trim();
        }

        return 'bash';
    }

    _resolveShellProfile(shellValue) {
        const requested = normalizeShellValue(shellValue) || this.defaultShell;

        if (process.platform === 'win32') {
            const profiles = {
                pwsh: { id: 'pwsh', command: 'pwsh', args: ['-NoLogo'], label: 'PowerShell 7' },
                powershell: { id: 'powershell', command: 'powershell.exe', args: ['-NoLogo'], label: 'Windows PowerShell' },
                cmd: { id: 'cmd', command: 'cmd.exe', args: [], label: 'Command Prompt' },
            };
            return profiles[requested] || profiles.pwsh;
        }

        const unixProfiles = {
            bash: { id: 'bash', command: 'bash', args: ['-i'], label: 'Bash' },
            zsh: { id: 'zsh', command: 'zsh', args: ['-i'], label: 'Zsh' },
            sh: { id: 'sh', command: 'sh', args: ['-i'], label: 'POSIX sh' },
        };

        if (unixProfiles[requested]) {
            return unixProfiles[requested];
        }

        if (requested.startsWith('/')) {
            return { id: 'custom', command: requested, args: ['-i'], label: requested };
        }

        return unixProfiles.bash;
    }

    _getShellProfilesForAttempt(shellValue) {
        const requestedProfile = this._resolveShellProfile(shellValue);

        const fallbackOrder = process.platform === 'win32'
            ? ['pwsh', 'powershell', 'cmd']
            : ['bash', 'zsh', 'sh'];

        const profiles = [
            requestedProfile,
            ...fallbackOrder.map((shell) => this._resolveShellProfile(shell)),
        ];

        const seen = new Set();
        return profiles.filter((profile) => {
            const key = `${profile.command}::${(profile.args || []).join(' ')}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    _resolveCwd(cwdInput) {
        const raw = typeof cwdInput === 'string' ? cwdInput.trim() : '';
        const candidate = raw
            ? (path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(this.workspaceRoot, raw))
            : this.workspaceRoot;

        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
            throw new Error(`Working directory does not exist: ${candidate}`);
        }

        if (!this.allowExternalCwd && !isWithinRoot(candidate, this.workspaceRoot)) {
            throw new Error(`Working directory is outside workspace root: ${candidate}`);
        }

        return candidate;
    }

    _buildEnvironment(envOverrides = {}) {
        const normalized = {};
        if (envOverrides && typeof envOverrides === 'object') {
            for (const [key, value] of Object.entries(envOverrides)) {
                if (!key || typeof key !== 'string') continue;
                if (value === undefined || value === null) continue;
                normalized[key] = String(value);
            }
        }

        return {
            ...process.env,
            TERM: process.env.TERM || 'xterm-256color',
            FORCE_COLOR: process.env.FORCE_COLOR || '1',
            ...normalized,
        };
    }

    _createSessionSnapshot(session) {
        return {
            sessionId: session.sessionId,
            shell: session.shell,
            shellCommand: session.shellCommand,
            backend: 'pty',
            cwd: session.cwd,
            cols: session.cols,
            rows: session.rows,
            status: session.status,
            createdAt: session.createdAt,
            startedAt: session.startedAt,
            updatedAt: session.updatedAt,
            closedAt: session.closedAt,
            exitCode: session.exitCode,
            signal: session.signal,
            totalEntries: session.totalEntries,
            droppedEntries: session.droppedEntries,
            liveClients: session.liveClients.size,
        };
    }

    _appendEvent(session, payload = {}) {
        const event = {
            seq: ++session.seq,
            sessionId: session.sessionId,
            type: payload.type || 'output',
            stream: payload.stream || null,
            text: payload.text || '',
            timestamp: nowIso(),
            ...payload,
        };

        session.updatedAt = event.timestamp;
        session.totalEntries += 1;
        session.events.push(event);

        if (session.events.length > this.bufferLimit) {
            const removeCount = session.events.length - this.bufferLimit;
            session.events.splice(0, removeCount);
            session.droppedEntries += removeCount;
        }

        this._broadcast(session, event);
        return event;
    }

    _broadcast(session, event) {
        if (!session.liveClients || session.liveClients.size === 0) return;

        const serialized = JSON.stringify({
            event: 'terminal_event',
            data: event,
        });

        // Soft cap per-client buffered outbound bytes so that a slow
        // consumer (e.g. tab backgrounded, proxy stalls) doesn't pull
        // the server's memory down with it. When tripped, we drop the
        // frame for that client and notify them via a backpressure
        // signal on the next tick.
        const BACKPRESSURE_LIMIT_BYTES = 4 * 1024 * 1024;

        for (const client of session.liveClients) {
            try {
                if (client.readyState !== 1) continue;

                const bufferedAmount = Number.isFinite(client.bufferedAmount)
                    ? client.bufferedAmount
                    : 0;

                if (bufferedAmount > BACKPRESSURE_LIMIT_BYTES) {
                    if (!client.__terminalBackpressured) {
                        client.__terminalBackpressured = true;
                        try {
                            client.send(JSON.stringify({
                                event: 'terminal_backpressure',
                                data: {
                                    sessionId: session.sessionId,
                                    bufferedAmount,
                                    limit: BACKPRESSURE_LIMIT_BYTES,
                                    timestamp: nowIso(),
                                },
                            }));
                        } catch {
                            // ignore — stale client will be cleaned on close
                        }
                    }
                    continue;
                }

                client.send(serialized);
                if (client.__terminalBackpressured) {
                    client.__terminalBackpressured = false;
                }
            } catch {
                // Best-effort send; stale clients are removed by socket close handler.
            }
        }
    }

    _wirePty(session) {
        const ptyProcess = session.pty;

        ptyProcess.onData((chunk) => {
            const text = normalizeChunk(chunk);
            if (!text) return;
            this._appendEvent(session, {
                type: 'output',
                stream: 'stdout',
                text,
            });
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            session.status = SESSION_STATUS.CLOSED;
            session.exitCode = Number.isInteger(exitCode) ? exitCode : null;
            session.signal = signal || null;
            session.closedAt = nowIso();
            session.updatedAt = session.closedAt;

            this._appendEvent(session, {
                type: 'exit',
                stream: 'meta',
                text: `Session closed (exit=${session.exitCode ?? 'n/a'}, signal=${session.signal || 'none'})`,
                exitCode: session.exitCode,
                signal: session.signal,
            });
        });
    }

    _enforceSessionLimit() {
        if (this.sessions.size < this.maxSessions) return;

        const sessionsSorted = Array.from(this.sessions.values())
            .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

        for (const session of sessionsSorted) {
            if (this.sessions.size < this.maxSessions) break;
            if (session.status === SESSION_STATUS.RUNNING || session.status === SESSION_STATUS.TERMINATING) continue;
            this.sessions.delete(session.sessionId);
        }

        if (this.sessions.size >= this.maxSessions) {
            throw new Error(`Maximum terminal sessions reached (${this.maxSessions})`);
        }
    }

    _pruneClosedSessions() {
        const cutoff = Date.now() - this.closedSessionRetentionMs;
        for (const session of this.sessions.values()) {
            if (session.status !== SESSION_STATUS.CLOSED) continue;
            const lastTs = new Date(session.updatedAt).getTime();
            if (Number.isFinite(lastTs) && lastTs < cutoff) {
                this.sessions.delete(session.sessionId);
            }
        }

        if (this.sessions.size <= this.maxSessions) return;

        const closedSorted = Array.from(this.sessions.values())
            .filter((session) => session.status === SESSION_STATUS.CLOSED)
            .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

        while (this.sessions.size > this.maxSessions && closedSorted.length > 0) {
            const oldest = closedSorted.shift();
            if (oldest) {
                this.sessions.delete(oldest.sessionId);
            }
        }
    }

    createSession(options = {}) {
        this._enforceSessionLimit();

        const shellProfiles = this._getShellProfilesForAttempt(options.shell);
        const cwd = this._resolveCwd(options.cwd);
        const env = this._buildEnvironment(options.env);
        const cols = clampInteger(options.cols, 120, 40, 320);
        const rows = clampInteger(options.rows, 36, 10, 120);

        let ptyProcess;
        let selectedProfile = shellProfiles[0];
        let lastError = null;

        for (const profile of shellProfiles) {
            try {
                ptyProcess = pty.spawn(profile.command, profile.args || [], {
                    name: env.TERM || 'xterm-256color',
                    cols,
                    rows,
                    cwd,
                    env,
                    useConpty: process.platform === 'win32',
                });
                selectedProfile = profile;
                break;
            } catch (error) {
                lastError = error;
            }
        }

        if (!ptyProcess) {
            const attempted = shellProfiles.map((profile) => profile.command).join(', ');
            throw new Error(`Failed to start PTY session. Attempted: ${attempted}. Last error: ${lastError?.message || 'unknown error'}`);
        }

        const timestamp = nowIso();
        const sessionToken = crypto.randomBytes(24).toString('hex');
        const session = {
            sessionId: crypto.randomUUID(),
            sessionToken,
            shell: selectedProfile.id,
            shellCommand: selectedProfile.command,
            cwd,
            cols,
            rows,
            createdAt: timestamp,
            startedAt: timestamp,
            updatedAt: timestamp,
            closedAt: null,
            status: SESSION_STATUS.RUNNING,
            exitCode: null,
            signal: null,
            pty: ptyProcess,
            pid: Number.isInteger(ptyProcess?.pid) ? ptyProcess.pid : null,
            seq: 0,
            totalEntries: 0,
            droppedEntries: 0,
            events: [],
            liveClients: new Set(),
        };

        this.sessions.set(session.sessionId, session);

        this._wirePty(session);
        this._appendEvent(session, {
            type: 'session_start',
            stream: 'meta',
            text: `Started ${selectedProfile.label} in ${cwd}`,
        });

        // Return the session token ONCE on creation so the client can
        // authenticate subsequent WS/HTTP calls. listSessions() and other
        // read APIs never expose it again.
        return {
            ...this._createSessionSnapshot(session),
            sessionToken,
        };
    }

    /**
     * Constant-time compare of a supplied token against the session's
     * stored token. Returns false if the session does not exist.
     */
    verifySessionToken(sessionId, token) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.sessionToken) return false;
        if (typeof token !== 'string' || token.length === 0) return false;
        const expected = Buffer.from(session.sessionToken, 'utf-8');
        const actual = Buffer.from(String(token), 'utf-8');
        if (expected.length !== actual.length) return false;
        try {
            return crypto.timingSafeEqual(expected, actual);
        } catch {
            return false;
        }
    }

    listSessions() {
        return Array.from(this.sessions.values())
            .map((session) => this._createSessionSnapshot(session))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        return this._createSessionSnapshot(session);
    }

    getSessionOutput(sessionId, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        const limit = clampInteger(options.limit, 300, 1, this.bufferLimit);
        const entries = session.events.slice(-limit);

        return {
            ...this._createSessionSnapshot(session),
            limit,
            entries,
        };
    }

    writeInput(sessionId, input, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Terminal session not found: ${sessionId}`);
        }
        if (session.status !== SESSION_STATUS.RUNNING) {
            throw new Error(`Terminal session is not running: ${sessionId}`);
        }

        const text = typeof input === 'string' ? input : String(input ?? '');
        if (!text) {
            return this._createSessionSnapshot(session);
        }

        session.pty.write(text);

        if (options.recordInput === true) {
            this._appendEvent(session, {
                type: 'input',
                stream: 'stdin',
                text,
            });
        }

        return this._createSessionSnapshot(session);
    }

    sendCommand(sessionId, command) {
        const text = typeof command === 'string' ? command : String(command ?? '');
        const normalized = text.endsWith('\n') ? text : `${text}\n`;
        return this.writeInput(sessionId, normalized, { recordInput: true });
    }

    resizeSession(sessionId, cols, rows) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Terminal session not found: ${sessionId}`);
        }

        session.cols = clampInteger(cols, session.cols, 40, 320);
        session.rows = clampInteger(rows, session.rows, 10, 120);
        session.updatedAt = nowIso();

        try {
            session.pty.resize(session.cols, session.rows);
        } catch (error) {
            this._appendEvent(session, {
                type: 'error',
                stream: 'meta',
                text: `Resize failed: ${error.message}`,
            });
            throw new Error(`Failed to resize terminal session: ${error.message}`);
        }

        this._appendEvent(session, {
            type: 'resize',
            stream: 'meta',
            text: `Resized PTY to ${session.cols}x${session.rows}`,
            cols: session.cols,
            rows: session.rows,
        });

        return this._createSessionSnapshot(session);
    }

    async terminateSession(sessionId, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Terminal session not found: ${sessionId}`);
        }

        if (session.status === SESSION_STATUS.CLOSED) {
            return this._createSessionSnapshot(session);
        }

        session.status = SESSION_STATUS.TERMINATING;
        session.updatedAt = nowIso();

        this._appendEvent(session, {
            type: 'terminate_request',
            stream: 'meta',
            text: options.reason || 'Termination requested',
        });

        const pid = session.pid;

        if (process.platform === 'win32') {
            try {
                session.pty.kill();
            } catch {
                // ignore
            }

            if (options.force !== false && pid) {
                setTimeout(() => {
                    if (session.status !== SESSION_STATUS.CLOSED) {
                        terminateWindowsProcessTree(pid).catch(() => { });
                    }
                }, 600);
            }
        } else {
            try {
                session.pty.kill('SIGTERM');
            } catch {
                // ignore
            }

            if (options.force !== false) {
                setTimeout(() => {
                    if (session.status !== SESSION_STATUS.CLOSED) {
                        try {
                            session.pty.kill('SIGKILL');
                        } catch {
                            // Best effort
                        }
                    }
                }, 1500);
            }
        }

        return this._createSessionSnapshot(session);
    }

    attachWebSocket(sessionId, socket) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Terminal session not found: ${sessionId}`);
        }

        session.liveClients.add(socket);

        const snapshotPayload = {
            event: 'terminal_snapshot',
            data: {
                session: this._createSessionSnapshot(session),
                entries: session.events.slice(-200),
                droppedEntries: session.droppedEntries,
            },
        };

        socket.send(JSON.stringify(snapshotPayload));

        // Server-driven WebSocket ping keeps proxies (nginx, CF, ALB)
        // from closing idle connections and gives us a deterministic
        // signal that the browser is still there. Browsers auto-answer
        // with a pong; we drop the socket if no pong arrives within
        // the heartbeat window.
        let lastPongAt = Date.now();
        socket.__isAlive = true;
        const onPong = () => {
            socket.__isAlive = true;
            lastPongAt = Date.now();
        };
        socket.on('pong', onPong);

        const pingInterval = setInterval(() => {
            if (socket.readyState !== 1) {
                clearInterval(pingInterval);
                return;
            }
            if (!socket.__isAlive && Date.now() - lastPongAt > 60000) {
                clearInterval(pingInterval);
                try { socket.terminate(); } catch { /* ignore */ }
                return;
            }
            socket.__isAlive = false;
            try { socket.ping(); } catch { /* ignore — close handler cleans up */ }
        }, 20000);
        if (typeof pingInterval.unref === 'function') pingInterval.unref();

        socket.on('message', (raw) => {
            this._handleSocketMessage(session, raw, socket);
        });

        const removeClient = () => {
            clearInterval(pingInterval);
            socket.removeListener?.('pong', onPong);
            session.liveClients.delete(socket);
        };

        socket.on('close', removeClient);
        socket.on('error', removeClient);
    }

    _handleSocketMessage(session, rawMessage, socket) {
        let message;
        try {
            message = JSON.parse(typeof rawMessage === 'string' ? rawMessage : rawMessage.toString('utf-8'));
        } catch {
            socket.send(JSON.stringify({
                event: 'terminal_error',
                data: { message: 'Invalid WebSocket payload' },
            }));
            return;
        }

        try {
            if (message.type === 'input') {
                this.writeInput(session.sessionId, message.input || '', { recordInput: true });
                return;
            }

            if (message.type === 'command') {
                this.sendCommand(session.sessionId, message.command || '');
                return;
            }

            if (message.type === 'resize') {
                // Idempotent resize: skip the PTY + broadcast round-trip
                // when dimensions are unchanged (common after WS reconnect
                // when the client replays its last-known size).
                const nextCols = clampInteger(message.cols, session.cols, 40, 320);
                const nextRows = clampInteger(message.rows, session.rows, 10, 120);
                if (nextCols === session.cols && nextRows === session.rows) {
                    return;
                }
                this.resizeSession(session.sessionId, message.cols, message.rows);
                return;
            }

            if (message.type === 'ping') {
                socket.send(JSON.stringify({
                    event: 'terminal_pong',
                    data: {
                        sessionId: session.sessionId,
                        timestamp: nowIso(),
                    },
                }));
            }
        } catch (error) {
            socket.send(JSON.stringify({
                event: 'terminal_error',
                data: { message: error.message },
            }));
        }
    }

    async dispose() {
        clearInterval(this._cleanupTimer);

        const runningSessions = Array.from(this.sessions.values())
            .filter((session) => session.status !== SESSION_STATUS.CLOSED);

        await Promise.all(runningSessions.map((session) => this.terminateSession(session.sessionId, {
            force: true,
            reason: 'Server shutting down',
        }).catch(() => { })));
    }
}

module.exports = {
    TerminalSessionManager,
    SESSION_STATUS,
};
