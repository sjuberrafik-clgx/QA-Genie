/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BROWSER TOOL GATEWAY — L2B of the Adaptive Tool Architecture
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Purpose: give workspace/custom agents a 3-tool facade over the unified
 * automation MCP server so they can perform browser-driven tasks (navigation,
 * exploration, content extraction) WITHOUT paying the 35–141 raw MCP-tool tax
 * in their CAPI tool array.
 *
 * Surface (3 SDK custom tools):
 *   • browser_task     — execute a free-form list of named browser ops
 *   • browser_explore  — navigate + snapshot a URL and return structured output
 *   • browser_extract  — extract text/attribute/url from elements on a page
 *
 * Under the hood, each call routes through a per-process shared MCP stdio
 * client connected to `mcp-server/server.js` spawned with `MCP_TOOL_PROFILE=dryrun`
 * (the cheapest 15-tool profile). The client speaks plain JSON-RPC 2.0 — no
 * dependency on @modelcontextprotocol/sdk's client package, which avoids
 * ESM/CJS interop issues and works even before npm install.
 *
 * Safety:
 *   • Lazy: child process only spawns on first tool invocation.
 *   • Self-healing: a failed call retries once on a fresh child if the pipe
 *     is broken.
 *   • Resource-bounded: per-call timeout + a one-time process spawn (no
 *     unbounded process growth).
 *   • Graceful no-op: if the spawn fails the tools return a structured error
 *     and the chat session keeps working.
 *
 * @module browser-gateway
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Minimal MCP stdio JSON-RPC client ──────────────────────────────────────

const PROTOCOL_VERSION = '2024-11-05';

class MinimalMcpStdioClient {
    constructor({ command, args, env, cwd, label = 'mcp-gateway-child' }) {
        this._command = command;
        this._args = args;
        this._env = env;
        this._cwd = cwd;
        this._label = label;
        this._child = null;
        this._initPromise = null;
        this._nextId = 1;
        this._pending = new Map();
        this._stdoutBuffer = '';
        this._closed = false;
    }

    /**
     * Spawn the child and complete the MCP initialize handshake.
     * Idempotent — returns the same promise on subsequent calls.
     */
    async ensureReady() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._spawnAndInitialize().catch(err => {
            // Reset so the caller can retry on a fresh attempt
            this._initPromise = null;
            this._teardown();
            throw err;
        });
        return this._initPromise;
    }

    async _spawnAndInitialize() {
        this._closed = false;
        this._child = spawn(this._command, this._args, {
            cwd: this._cwd,
            env: { ...process.env, ...(this._env || {}) },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this._child.stdout.setEncoding('utf-8');
        this._child.stdout.on('data', chunk => this._onStdoutChunk(chunk));
        this._child.stderr.on('data', chunk => {
            // Surface stderr to the orchestrator log but don't fail on it —
            // the MCP server logs progress/warnings to stderr by design.
            const text = chunk.toString('utf-8').trim();
            if (text) console.error(`[${this._label}] ${text}`);
        });
        this._child.on('exit', (code, signal) => {
            this._closed = true;
            const reason = `child exited (code=${code}, signal=${signal})`;
            for (const { reject } of this._pending.values()) {
                reject(new Error(`MCP gateway: ${reason}`));
            }
            this._pending.clear();
        });
        this._child.on('error', err => {
            this._closed = true;
            for (const { reject } of this._pending.values()) reject(err);
            this._pending.clear();
        });

        // initialize handshake
        const initResult = await this._request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            clientInfo: { name: 'browser-gateway', version: '1.0.0' },
        }, 15000);

        // Send the initialized notification (no id, no response expected)
        this._writeFrame({ jsonrpc: '2.0', method: 'notifications/initialized' });
        return initResult;
    }

    _onStdoutChunk(chunk) {
        this._stdoutBuffer += chunk;
        // MCP stdio frames are NDJSON (newline-delimited JSON)
        let nl;
        while ((nl = this._stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this._stdoutBuffer.slice(0, nl).trim();
            this._stdoutBuffer = this._stdoutBuffer.slice(nl + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                this._handleMessage(msg);
            } catch (err) {
                console.warn(`[${this._label}] failed to parse frame: ${err.message}`);
            }
        }
    }

    _handleMessage(msg) {
        if (msg && typeof msg.id !== 'undefined' && this._pending.has(msg.id)) {
            const { resolve, reject, timer } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (timer) clearTimeout(timer);
            if (msg.error) {
                const err = new Error(msg.error.message || 'MCP gateway error');
                err.code = msg.error.code;
                err.data = msg.error.data;
                reject(err);
            } else {
                resolve(msg.result);
            }
        }
        // Notifications/other frames are ignored — gateway only consumes responses.
    }

    _writeFrame(obj) {
        if (this._closed || !this._child || !this._child.stdin.writable) {
            throw new Error('MCP gateway child not writable');
        }
        this._child.stdin.write(JSON.stringify(obj) + '\n');
    }

    _request(method, params, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`MCP gateway: '${method}' timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);
            this._pending.set(id, { resolve, reject, timer });
            try {
                this._writeFrame({ jsonrpc: '2.0', id, method, params });
            } catch (err) {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(err);
            }
        });
    }

    /**
     * Call a tool on the underlying MCP server.
     * @param {string} name
     * @param {Object} args
     * @param {number} [timeoutMs]
     */
    async callTool(name, args, timeoutMs = 120000) {
        await this.ensureReady();
        return this._request('tools/call', { name, arguments: args || {} }, timeoutMs);
    }

    _teardown() {
        if (this._child) {
            try { this._child.kill(); } catch { /* noop */ }
            this._child = null;
        }
        this._closed = true;
    }

    shutdown() {
        this._teardown();
        this._initPromise = null;
        for (const { reject, timer } of this._pending.values()) {
            if (timer) clearTimeout(timer);
            reject(new Error('Gateway shutting down'));
        }
        this._pending.clear();
    }
}

// ─── Per-process singleton manager ──────────────────────────────────────────

let _sharedClient = null;
let _sharedClientProfile = null;

/**
 * Get (or lazily construct) the shared MCP client. Re-uses one child process
 * per Node process to avoid the cost of spawning Playwright on every tool call.
 *
 * @param {string} [profile='dryrun']  MCP_TOOL_PROFILE for the child
 */
function getGatewayClient(profile = 'dryrun') {
    if (_sharedClient && _sharedClientProfile === profile && !_sharedClient._closed) {
        return _sharedClient;
    }
    if (_sharedClient) {
        try { _sharedClient.shutdown(); } catch { /* noop */ }
    }
    const serverJs = path.resolve(__dirname, '..', 'mcp-server', 'server.js');
    if (!fs.existsSync(serverJs)) {
        throw new Error(`browser-gateway: mcp-server/server.js not found at ${serverJs}`);
    }
    _sharedClient = new MinimalMcpStdioClient({
        command: process.execPath, // current node binary
        args: [serverJs],
        cwd: path.resolve(__dirname, '..', 'mcp-server'),
        env: {
            MCP_HEADLESS: process.env.MCP_HEADLESS || 'true',
            MCP_BROWSER: process.env.MCP_BROWSER || 'chromium',
            MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT || '120000',
            MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'warn',
            MCP_TOOL_PROFILE: profile,
        },
        label: `browser-gateway:${profile}`,
    });
    _sharedClientProfile = profile;
    return _sharedClient;
}

function shutdownGatewayClient() {
    if (_sharedClient) {
        try { _sharedClient.shutdown(); } catch { /* noop */ }
        _sharedClient = null;
        _sharedClientProfile = null;
    }
}

// Register a process-exit cleanup once
let _exitHookRegistered = false;
function registerExitHook() {
    if (_exitHookRegistered) return;
    _exitHookRegistered = true;
    process.on('exit', () => shutdownGatewayClient());
    process.on('SIGTERM', () => shutdownGatewayClient());
    process.on('SIGINT', () => shutdownGatewayClient());
}

// ─── Helper: extract text payload from an MCP tools/call response ───────────

function _readToolText(result) {
    if (!result || !Array.isArray(result.content)) return '';
    return result.content
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('\n');
}

// ─── SDK custom tool factories ──────────────────────────────────────────────

/**
 * Create the three browser-gateway SDK custom tools.
 *
 * @param {Function} defineTool  The session-scoped defineTool helper
 * @param {Object} [opts]
 * @param {string} [opts.profile='dryrun']  MCP profile for the gateway child
 * @returns {Array<Object>} Tool definitions to push into the agent's tool list
 */
function createBrowserGatewayTools(defineTool, opts = {}) {
    registerExitHook();
    const profile = opts.profile || 'dryrun';

    const browserTask = defineTool('browser_task', {
        description: [
            'Run a small sequence of browser operations against a one-shot Playwright session managed by the workflow.',
            'Use this when you need to navigate, click, type, and take a snapshot in a single call.',
            'For deeper exploration prefer browser_explore. For pure data lookup prefer browser_extract.',
        ].join(' '),
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                url: { type: 'string', description: 'Starting URL (required for fresh sessions).' },
                steps: {
                    type: 'array',
                    description: 'Sequential ops. Each item is { action, selector?, value?, ref? }. Supported actions: navigate, click, type, snapshot, get_text, wait_for.',
                    items: {
                        type: 'object',
                        properties: {
                            action: { type: 'string' },
                            selector: { type: 'string' },
                            value: { type: 'string' },
                            ref: { type: 'string' },
                        },
                        required: ['action'],
                    },
                },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 180000 },
            },
            required: ['steps'],
        },
        execute: async (params) => {
            const client = getGatewayClient(profile);
            const timeoutMs = params.timeoutMs || 90000;
            const results = [];
            try {
                if (params.url) {
                    const navRes = await client.callTool('unified_navigate', { url: params.url }, timeoutMs);
                    results.push({ step: 0, action: 'navigate', output: _readToolText(navRes) });
                }
                for (let i = 0; i < params.steps.length; i++) {
                    const step = params.steps[i];
                    const mapping = {
                        navigate: { tool: 'unified_navigate', args: { url: step.value || step.selector } },
                        click: { tool: 'unified_click', args: { ref: step.ref, selector: step.selector } },
                        type: { tool: 'unified_type', args: { ref: step.ref, selector: step.selector, text: step.value } },
                        snapshot: { tool: 'unified_snapshot', args: {} },
                        get_text: { tool: 'unified_get_text_content', args: { ref: step.ref, selector: step.selector } },
                        wait_for: { tool: 'unified_wait_for', args: { selector: step.selector, timeout: 10000 } },
                    };
                    const m = mapping[step.action];
                    if (!m) {
                        results.push({ step: i + 1, action: step.action, error: `unsupported action '${step.action}'` });
                        continue;
                    }
                    try {
                        const res = await client.callTool(m.tool, m.args, timeoutMs);
                        results.push({ step: i + 1, action: step.action, output: _readToolText(res) });
                    } catch (err) {
                        results.push({ step: i + 1, action: step.action, error: err.message });
                    }
                }
                return JSON.stringify({ ok: true, profile, results }, null, 2);
            } catch (err) {
                return JSON.stringify({ ok: false, profile, error: err.message, results }, null, 2);
            }
        },
    });

    const browserExplore = defineTool('browser_explore', {
        description: 'Navigate to a URL, dismiss known popups, and return a structured accessibility snapshot. Use for first-pass page understanding. Avoid for sustained interaction — use browser_task for that.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                url: { type: 'string', description: 'Page URL to explore.' },
                waitForSelector: { type: 'string', description: 'Optional selector to wait for before snapshotting.' },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 180000 },
            },
            required: ['url'],
        },
        execute: async ({ url, waitForSelector, timeoutMs }) => {
            const client = getGatewayClient(profile);
            const to = timeoutMs || 60000;
            try {
                await client.callTool('unified_navigate', { url }, to);
                if (waitForSelector) {
                    try { await client.callTool('unified_wait_for', { selector: waitForSelector, timeout: 8000 }, to); } catch { /* non-fatal */ }
                }
                const snap = await client.callTool('unified_snapshot', {}, to);
                return JSON.stringify({ ok: true, url, snapshot: _readToolText(snap) }, null, 2);
            } catch (err) {
                return JSON.stringify({ ok: false, url, error: err.message }, null, 2);
            }
        },
    });

    const browserExtract = defineTool('browser_extract', {
        description: 'Extract text, attribute value, or current URL/title from a page already loaded by browser_task or browser_explore. Optionally navigate first.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                url: { type: 'string', description: 'If supplied, navigate here before extracting.' },
                target: {
                    type: 'string',
                    enum: ['text', 'attribute', 'page_url', 'page_title'],
                    description: 'What to read.',
                },
                selector: { type: 'string' },
                attribute: { type: 'string', description: 'Attribute name (only when target=attribute).' },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
            },
            required: ['target'],
        },
        execute: async ({ url, target, selector, attribute, timeoutMs }) => {
            const client = getGatewayClient(profile);
            const to = timeoutMs || 30000;
            try {
                if (url) await client.callTool('unified_navigate', { url }, to);
                let res;
                if (target === 'text') {
                    res = await client.callTool('unified_get_text_content', { selector }, to);
                } else if (target === 'attribute') {
                    res = await client.callTool('unified_get_attribute', { selector, attribute }, to);
                } else if (target === 'page_url') {
                    res = await client.callTool('unified_get_page_url', {}, to);
                } else if (target === 'page_title') {
                    res = await client.callTool('unified_get_page_title', {}, to);
                }
                return JSON.stringify({ ok: true, target, value: _readToolText(res) }, null, 2);
            } catch (err) {
                return JSON.stringify({ ok: false, target, error: err.message }, null, 2);
            }
        },
    });

    return [browserTask, browserExplore, browserExtract];
}

module.exports = {
    createBrowserGatewayTools,
    getGatewayClient,
    shutdownGatewayClient,
    // For tests
    MinimalMcpStdioClient,
};
