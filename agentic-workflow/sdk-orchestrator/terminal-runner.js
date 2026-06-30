/**
 * Non-blocking terminal command runner with timeout and cancellation support.
 */

const { spawn } = require('child_process');
const path = require('path');

function quoteArg(value) {
    const input = String(value ?? '');
    if (input.length === 0) return '""';
    return /[\s"]/u.test(input)
        ? `"${input.replace(/"/g, '\\"')}"`
        : input;
}

// CWE-78 mitigation: when we spawn with `shell: true`, the command string is
// re-parsed by cmd.exe, so any metacharacter (& | ; && || > < ^) becomes a
// chaining/redirection operator. We restrict shell:true to a known-safe set of
// Node.js launchers and reject any command path that smells like injection.
const WINDOWS_SHELL_LAUNCHER_ALLOWLIST = new Set([
    'npx.cmd',
    'npm.cmd',
    'node.cmd',
    'yarn.cmd',
    'pnpm.cmd',
    'pnpx.cmd',
    'npx.bat',
    'npm.bat',
    'node.bat',
    'yarn.bat',
    'pnpm.bat',
]);

const WINDOWS_SHELL_METACHAR_RE = /[&|;<>^()!"`]|&&|\|\|/;

// Windows + Node.js >= 20 requires `shell: true` (or explicit .exe path) to spawn
// batch-style launchers (.cmd / .bat). Without it, spawn rejects with EINVAL
// because of the CVE-2024-27980 mitigation. This helper detects the case so
// callers don't have to think about it.
function needsShellOnWindows(command) {
    if (process.platform !== 'win32') return false;
    if (typeof command !== 'string' || !command) return false;
    if (!/\.(cmd|bat)$/i.test(command)) return false;
    const basename = path.basename(command).toLowerCase();
    return WINDOWS_SHELL_LAUNCHER_ALLOWLIST.has(basename);
}

// Used to reject a .cmd/.bat command that is not on the allowlist OR contains
// shell metacharacters in its path before we ever call spawn().
function isUnsafeWindowsShellCommand(command) {
    if (process.platform !== 'win32') return false;
    if (typeof command !== 'string' || !command) return false;
    if (!/\.(cmd|bat)$/i.test(command)) return false;
    if (WINDOWS_SHELL_METACHAR_RE.test(command)) return true;
    const basename = path.basename(command).toLowerCase();
    return !WINDOWS_SHELL_LAUNCHER_ALLOWLIST.has(basename);
}

// When running under shell:true on Windows, arguments are re-joined into a
// command string, so we must pre-quote anything containing spaces or quotes.
function quoteForWindowsShell(value) {
    const input = String(value ?? '');
    if (input.length === 0) return '""';
    if (!/[\s"&|<>^()!]/u.test(input)) return input;
    return `"${input.replace(/"/g, '\\"')}"`;
}

function buildCommandLabel(command, args = []) {
    return [command, ...(args || []).map(quoteArg)].join(' ').trim();
}

function createCommandError(message, metadata = {}) {
    const error = new Error(message);
    error.code = metadata.code || 'COMMAND_ERROR';
    error.command = metadata.command || null;
    error.args = Array.isArray(metadata.args) ? metadata.args : [];
    error.label = metadata.label || buildCommandLabel(error.command || '', error.args);
    error.stdout = metadata.stdout || '';
    error.stderr = metadata.stderr || '';
    error.exitCode = Number.isInteger(metadata.exitCode) ? metadata.exitCode : null;
    error.status = error.exitCode;
    error.signal = metadata.signal || null;
    error.timedOut = metadata.timedOut === true;
    error.aborted = metadata.aborted === true;
    error.startedAt = metadata.startedAt || null;
    error.endedAt = metadata.endedAt || null;
    error.durationMs = Number.isFinite(metadata.durationMs)
        ? Math.max(0, Math.round(metadata.durationMs))
        : null;
    error.cancelRequestedAt = metadata.cancelRequestedAt || null;
    error.cancelToKillLatencyMs = Number.isFinite(metadata.cancelToKillLatencyMs)
        ? Math.max(0, Math.round(metadata.cancelToKillLatencyMs))
        : null;
    return error;
}

function normalizeChunk(chunk) {
    if (chunk == null) return '';
    return Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
}

function appendOutput(current, chunk, maxBufferChars) {
    const text = normalizeChunk(chunk);
    if (!text) return current;
    const next = current + text;
    if (next.length <= maxBufferChars) return next;
    return next.slice(next.length - maxBufferChars);
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

function terminateProcessTree(child) {
    if (!child || !child.pid) return;

    if (process.platform === 'win32') {
        terminateWindowsProcessTree(child.pid).catch(() => { });
        return;
    }

    try {
        child.kill('SIGTERM');
    } catch {
        return;
    }

    const forceKillTimer = setTimeout(() => {
        if (child.exitCode != null) return;
        try {
            child.kill('SIGKILL');
        } catch {
            // Best-effort kill.
        }
    }, 5000);

    if (typeof forceKillTimer.unref === 'function') {
        forceKillTimer.unref();
    }
}

function runCommand(options = {}) {
    const {
        command,
        args = [],
        cwd = process.cwd(),
        env = process.env,
        timeoutMs = 0,
        abortSignal = null,
        onStart = null,
        onStdout = null,
        onStderr = null,
        onExit = null,
        maxBufferChars = 20 * 1024 * 1024,
    } = options;

    if (!command) {
        return Promise.reject(createCommandError('Command is required', {
            code: 'INVALID_COMMAND',
            command,
            args,
        }));
    }

    // CWE-78 fix: refuse to spawn a Windows .cmd/.bat launcher that isn't on
    // the shell-launcher allowlist (or whose path contains shell metacharacters).
    // Without this guard, `shell: true` would let metacharacters chain commands.
    if (isUnsafeWindowsShellCommand(command)) {
        return Promise.reject(createCommandError(
            `Refusing to spawn untrusted Windows shell launcher: ${command}`,
            {
                code: 'UNSAFE_SHELL_COMMAND',
                command,
                args,
            }
        ));
    }

    return new Promise((resolve, reject) => {
        const label = buildCommandLabel(command, args);
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let aborted = false;
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        let cancelRequestedAtMs = null;
        let timeoutHandle = null;
        let abortHandler = null;
        let settled = false;

        const buildTimingMetadata = () => {
            const endedAtMs = Date.now();
            return {
                startedAt,
                endedAt: new Date(endedAtMs).toISOString(),
                durationMs: endedAtMs - startedAtMs,
                cancelRequestedAt: cancelRequestedAtMs ? new Date(cancelRequestedAtMs).toISOString() : null,
                cancelToKillLatencyMs: cancelRequestedAtMs ? (endedAtMs - cancelRequestedAtMs) : null,
            };
        };

        const requestTermination = (reason = 'cancel') => {
            if (!cancelRequestedAtMs) {
                cancelRequestedAtMs = Date.now();
            }

            if (reason === 'abort') {
                aborted = true;
            }
            if (reason === 'timeout') {
                timedOut = true;
            }

            terminateProcessTree(child);
        };

        const settle = (handler) => {
            if (settled) return;
            settled = true;

            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            if (abortSignal && abortHandler) {
                abortSignal.removeEventListener('abort', abortHandler);
                abortHandler = null;
            }

            handler();
        };

        const safeCallback = (cb, payload) => {
            if (typeof cb !== 'function') return;
            try {
                cb(payload);
            } catch {
                // Event callbacks are best-effort telemetry only.
            }
        };

        const useWindowsShell = needsShellOnWindows(command);
        const spawnArgs = useWindowsShell && Array.isArray(args)
            ? args.map(quoteForWindowsShell)
            : args;

        const child = spawn(command, spawnArgs, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            // Windows .cmd/.bat launchers (npx.cmd, npm.cmd, etc.) require
            // shell:true on Node >=20, otherwise spawn fails with EINVAL.
            ...(useWindowsShell
                ? { shell: true }
                : {}),
        });

        safeCallback(onStart, {
            pid: child.pid,
            command,
            args,
            label,
            startedAt,
        });

        if (child.stdout) {
            child.stdout.on('data', (chunk) => {
                const text = normalizeChunk(chunk);
                stdout = appendOutput(stdout, text, maxBufferChars);
                safeCallback(onStdout, text);
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                const text = normalizeChunk(chunk);
                stderr = appendOutput(stderr, text, maxBufferChars);
                safeCallback(onStderr, text);
            });
        }

        child.on('error', (error) => {
            settle(() => {
                const timing = buildTimingMetadata();
                reject(createCommandError(`Failed to start command: ${error.message}`, {
                    code: error.code || 'SPAWN_ERROR',
                    command,
                    args,
                    label,
                    stdout,
                    stderr,
                    ...timing,
                }));
            });
        });

        child.on('close', (exitCode, signal) => {
            const timing = buildTimingMetadata();

            safeCallback(onExit, {
                command,
                args,
                label,
                exitCode,
                signal,
                timedOut,
                aborted,
                ...timing,
            });

            settle(() => {
                if (aborted) {
                    reject(createCommandError('Command cancelled by user', {
                        code: 'ABORT_ERR',
                        command,
                        args,
                        label,
                        stdout,
                        stderr,
                        exitCode,
                        signal,
                        aborted: true,
                        ...timing,
                    }));
                    return;
                }

                if (timedOut) {
                    reject(createCommandError(`Command timed out after ${timeoutMs}ms`, {
                        code: 'ETIMEDOUT',
                        command,
                        args,
                        label,
                        stdout,
                        stderr,
                        exitCode,
                        signal,
                        timedOut: true,
                        ...timing,
                    }));
                    return;
                }

                if (exitCode !== 0) {
                    reject(createCommandError(`Command failed with exit code ${exitCode}`, {
                        code: 'COMMAND_FAILED',
                        command,
                        args,
                        label,
                        stdout,
                        stderr,
                        exitCode,
                        signal,
                        ...timing,
                    }));
                    return;
                }

                resolve({
                    command,
                    args,
                    label,
                    stdout,
                    stderr,
                    exitCode,
                    signal,
                    ...timing,
                });
            });
        });

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                requestTermination('timeout');
            }, timeoutMs);

            if (typeof timeoutHandle.unref === 'function') {
                timeoutHandle.unref();
            }
        }

        if (abortSignal) {
            abortHandler = () => {
                requestTermination('abort');
            };

            if (abortSignal.aborted) {
                abortHandler();
            } else {
                abortSignal.addEventListener('abort', abortHandler, { once: true });
            }
        }
    });
}

module.exports = {
    runCommand,
    buildCommandLabel,
    createCommandError,
};
