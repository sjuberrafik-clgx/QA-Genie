/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * UNIFIED AUTOMATION MCP SERVER
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Custom MCP Server that combines the power of:
 * - Playwright MCP: For robust browser automation, accessibility snapshots, interactions
 * - ChromeDevTools MCP: For performance tracing, network monitoring, advanced debugging
 * 
 * This server intelligently routes tool calls to the appropriate underlying MCP server
 * based on the task requirements, providing a unified interface for automation scripts.
 * 
 * Protocol Version: 2025-11-25
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'node:http';

import { PlaywrightBridge } from './bridges/playwright-bridge-direct.js';
import { ChromeDevToolsBridge } from './bridges/chromedevtools-bridge-direct.js';
import { IntelligentRouter } from './router/intelligent-router.js';
import { ALL_TOOLS, UNIFIED_TOOLS, getToolStats } from './tools/tool-definitions.js';
import { ServerConfig } from './config/server-config.js';
import { EventManager } from './utils/event-manager.js';

/**
 * Unified Automation MCP Server
 * Combines Playwright and ChromeDevTools capabilities into a single MCP interface
 */
class UnifiedAutomationServer {
    constructor(config = {}) {
        this.config = new ServerConfig(config);
        this.server = null;
        this.playwrightBridge = null;
        this.chromeDevToolsBridge = null;
        this.router = null;
        this.eventManager = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the MCP server and all bridges
     */
    async initialize() {
        console.error('[UnifiedMCP] Initializing server...');

        // Create the MCP server instance
        this.server = new Server(
            {
                name: 'unified-automation-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {
                        listChanged: true,
                    },
                    logging: {},
                },
            }
        );

        // Initialize bridges to underlying MCP servers
        this.playwrightBridge = new PlaywrightBridge(this.config.playwright);
        this.chromeDevToolsBridge = new ChromeDevToolsBridge(this.config.chromeDevTools);

        // Initialize the intelligent router
        this.router = new IntelligentRouter(
            this.playwrightBridge,
            this.chromeDevToolsBridge
        );

        // Initialize the event manager for real-time event streaming
        this.eventManager = new EventManager();
        this.eventManager.connectBridge(this.playwrightBridge);

        // Register handlers
        this.registerToolListHandler();
        this.registerToolCallHandler();

        // Setup error handling
        this.server.onerror = (error) => {
            console.error('[UnifiedMCP] Server error:', error);
        };

        this.isInitialized = true;
        console.error('[UnifiedMCP] Server initialized successfully');
    }

    /**
     * Register the tools/list handler
     */
    registerToolListHandler() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const stats = getToolStats();
            console.error(`[UnifiedMCP] Handling tools/list request - Exposing ${stats.total} tools (${stats.core} core + ${stats.enhanced} enhanced + ${stats.advanced} advanced)`);
            return {
                tools: ALL_TOOLS,
            };
        });
    }

    /**
     * Register the tools/call handler
     */
    registerToolCallHandler() {
        // Per-tool-call timeout to prevent indefinite hangs when Playwright operations freeze.
        // Without this, a stuck page.evaluate() or unresponsive navigation blocks the MCP
        // server forever, and the SDK session hangs for its full 10-minute timeout.
        const toolCallTimeout = this.config.playwright?.toolCallTimeout
            ?? (parseInt(process.env.MCP_TOOL_TIMEOUT) || 120000); // Default: 2 minutes

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            console.error(`[UnifiedMCP] Handling tool call: ${name}`);

            try {
                // Route the tool call with a timeout guard
                const result = await Promise.race([
                    this.router.route(name, args || {}),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(
                            `Tool call '${name}' timed out after ${toolCallTimeout}ms. ` +
                            'The page may be unresponsive or a selector was not found.'
                        )), toolCallTimeout)
                    ),
                ]);
                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                console.error(`[UnifiedMCP] Tool call error: ${error.message}`);
                throw new McpError(
                    ErrorCode.InternalError,
                    `Tool execution failed: ${error.message}`
                );
            }
        });
    }

    /**
     * Start the server with the specified transport
     * @param {'stdio' | 'sse' | 'http'} transport - Transport type
     * @param {object} options - Transport-specific options (port, host, path)
     */
    async start(transport = 'stdio', options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        console.error(`[UnifiedMCP] Starting server with ${transport} transport...`);

        switch (transport) {
            case 'stdio': {
                const stdioTransport = new StdioServerTransport();
                await this.server.connect(stdioTransport);
                console.error('[UnifiedMCP] Server running on stdio transport');
                break;
            }

            case 'sse': {
                const port = options.port ?? parseInt(process.env.MCP_PORT) ?? 3100;
                const host = options.host ?? process.env.MCP_HOST ?? '127.0.0.1';
                const endpoint = options.endpoint ?? '/sse';

                this._sseTransports = new Map();
                this._httpServer = http.createServer(async (req, res) => {
                    const url = new URL(req.url, `http://${req.headers.host}`);

                    // CORS headers
                    res.setHeader('Access-Control-Allow-Origin', options.cors ?? '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                    if (req.method === 'OPTIONS') {
                        res.writeHead(204);
                        res.end();
                        return;
                    }

                    if (url.pathname === endpoint) {
                        // SSE connection endpoint
                        console.error(`[UnifiedMCP] New SSE connection from ${req.socket.remoteAddress}`);
                        const sseTransport = new SSEServerTransport(`${endpoint}/messages`, res);
                        this._sseTransports.set(sseTransport.sessionId, sseTransport);

                        // Clean up on disconnect
                        res.on('close', () => {
                            this._sseTransports.delete(sseTransport.sessionId);
                            console.error(`[UnifiedMCP] SSE client disconnected (${sseTransport.sessionId})`);
                        });

                        await this.server.connect(sseTransport);
                    } else if (url.pathname === `${endpoint}/messages`) {
                        // Message endpoint for SSE
                        const sessionId = url.searchParams.get('sessionId');
                        const sseTransport = this._sseTransports.get(sessionId);

                        if (sseTransport) {
                            await sseTransport.handlePostMessage(req, res);
                        } else {
                            res.writeHead(404);
                            res.end(JSON.stringify({ error: 'Session not found' }));
                        }
                    } else if (url.pathname === '/health') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: 'ok',
                            transport: 'sse',
                            sessions: this._sseTransports.size,
                            uptime: process.uptime(),
                        }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Not found' }));
                    }
                });

                this._httpServer.listen(port, host, () => {
                    console.error(`[UnifiedMCP] SSE server listening on http://${host}:${port}${endpoint}`);
                });
                break;
            }

            case 'http': {
                const port = options.port ?? parseInt(process.env.MCP_PORT) ?? 3100;
                const host = options.host ?? process.env.MCP_HOST ?? '127.0.0.1';

                this._httpServer = http.createServer(async (req, res) => {
                    const url = new URL(req.url, `http://${req.headers.host}`);

                    // CORS
                    res.setHeader('Access-Control-Allow-Origin', options.cors ?? '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
                    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

                    if (req.method === 'OPTIONS') {
                        res.writeHead(204);
                        res.end();
                        return;
                    }

                    if (url.pathname === '/mcp') {
                        const httpTransport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: undefined,
                        });
                        await this.server.connect(httpTransport);
                        await httpTransport.handleRequest(req, res);
                    } else if (url.pathname === '/health') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: 'ok',
                            transport: 'http',
                            uptime: process.uptime(),
                        }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Not found' }));
                    }
                });

                this._httpServer.listen(port, host, () => {
                    console.error(`[UnifiedMCP] HTTP server listening on http://${host}:${port}/mcp`);
                });
                break;
            }

            default:
                throw new Error(`Unsupported transport: ${transport}. Supported: stdio, sse, http`);
        }
    }

    /**
     * Shutdown the server and cleanup resources.
     * Uses Promise.allSettled with a timeout to prevent deadlock if the browser
     * is frozen — previously, sequential await calls meant a stuck browser.close()
     * would block chromeDevToolsBridge.cleanup() and server.close() indefinitely.
     */
    async shutdown() {
        console.error('[UnifiedMCP] Shutting down server...');
        const SHUTDOWN_TIMEOUT_MS = 15000; // 15 seconds max for cleanup

        // 1. Stop accepting new connections
        if (this._httpServer) {
            try {
                await new Promise((resolve) => this._httpServer.close(resolve));
            } catch (e) {
                console.error('[UnifiedMCP] HTTP server close error:', e.message);
            }
            this._httpServer = null;
        }

        if (this.eventManager) {
            this.eventManager.removeAllListeners();
            this.eventManager = null;
        }

        // 2. Cleanup bridges and server in parallel with a timeout guard.
        //    If browser.close() hangs (frozen page), we don't block forever.
        const cleanupTasks = [];

        if (this.playwrightBridge) {
            cleanupTasks.push(
                this.playwrightBridge.cleanup()
                    .catch(e => console.error('[UnifiedMCP] Playwright cleanup error:', e.message))
            );
        }
        if (this.chromeDevToolsBridge) {
            cleanupTasks.push(
                this.chromeDevToolsBridge.cleanup()
                    .catch(e => console.error('[UnifiedMCP] ChromeDevTools cleanup error:', e.message))
            );
        }
        if (this.server) {
            cleanupTasks.push(
                this.server.close()
                    .catch(e => console.error('[UnifiedMCP] MCP server close error:', e.message))
            );
        }

        if (cleanupTasks.length > 0) {
            await Promise.race([
                Promise.allSettled(cleanupTasks),
                new Promise(resolve => setTimeout(() => {
                    console.error(`[UnifiedMCP] Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) — forcing exit`);
                    resolve();
                }, SHUTDOWN_TIMEOUT_MS)),
            ]);
        }

        console.error('[UnifiedMCP] Server shutdown complete');
    }
}

// ── Main entry point ──
// Support transport selection via CLI args or env vars:
//   node server.js                    → stdio (default)
//   node server.js --transport=sse    → SSE on port 3100
//   node server.js --transport=http   → StreamableHTTP on port 3100
//   node server.js --transport=sse --port=8080 --host=0.0.0.0
//   MCP_TRANSPORT=sse MCP_PORT=3100 node server.js

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (const arg of args) {
        const match = arg.match(/^--(\w+)=(.+)$/);
        if (match) {
            parsed[match[1]] = match[2];
        }
    }
    return parsed;
}

const cliArgs = parseArgs();
const transport = cliArgs.transport ?? process.env.MCP_TRANSPORT ?? 'stdio';
const serverOptions = {
    port: cliArgs.port ? parseInt(cliArgs.port) : undefined,
    host: cliArgs.host ?? undefined,
};

// ── Use ServerConfig.fromEnvironment() to read env vars (MCP_HEADLESS, MCP_TIMEOUT, etc.) ──
const envConfig = ServerConfig.fromEnvironment();
const server = new UnifiedAutomationServer(envConfig.config);

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
});

// ── Handle fatal errors to prevent orphaned browser processes ──
process.on('uncaughtException', async (error) => {
    console.error('[UnifiedMCP] FATAL uncaughtException:', error.message);
    console.error(error.stack);
    try { await server.shutdown(); } catch { /* best-effort cleanup */ }
    process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
    console.error('[UnifiedMCP] FATAL unhandledRejection:', reason);
    try { await server.shutdown(); } catch { /* best-effort cleanup */ }
    process.exit(1);
});

// Ignore SIGPIPE — fired when SDK session kills the stdio pipe on timeout.
// Without this handler, the MCP process crashes without cleanup, orphaning the browser.
process.on('SIGPIPE', () => {
    console.error('[UnifiedMCP] SIGPIPE received — stdio pipe closed by parent. Ignoring.');
});

// Start the server
server.start(transport, serverOptions).catch((error) => {
    console.error('[UnifiedMCP] Failed to start server:', error);
    process.exit(1);
});

export { UnifiedAutomationServer };
