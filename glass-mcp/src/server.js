#!/usr/bin/env node
'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · MCP SERVER — standalone, stdio transport
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A runnable MCP server exposing the eight-verb algebra. Point
 * any MCP client at it:  node glass-mcp/src/server.js
 *
 * The @modelcontextprotocol/server package is required lazily so the rest of
 * the package (and its tests) load without it. Zero workspace coupling — config
 * comes from args/env only.
 *
 * @module glass-mcp/server
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { CdpDriver } = require('./driver');
const { buildToolsForDriver } = require('./driver/driver-tools');

const SERVER_INFO = { name: 'glass-mcp', version: '0.2.0' };

function loadSdk() {
    try {
        const { McpServer, fromJsonSchema } = require('@modelcontextprotocol/server');
        const { serveStdio } = require('@modelcontextprotocol/server/stdio');
        return { McpServer, fromJsonSchema, serveStdio };
    } catch {
        throw new Error('@modelcontextprotocol/server is not installed. Run `npm install` in glass-mcp/.');
    }
}

function createGlassServer(opts = {}) {
    const { McpServer, fromJsonSchema } = loadSdk();
    const headless = process.env.GLASS_HEADLESS !== 'false';
    const driver = new CdpDriver({ headless, ...opts });
    const tools = buildToolsForDriver(driver);
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } } });

    for (const tool of tools) {
        server.registerTool(tool.name, {
            title: tool.title || tool.name,
            description: tool.description,
            inputSchema: fromJsonSchema(tool.inputSchema),
            outputSchema: fromJsonSchema(tool.outputSchema),
            annotations: tool.annotations,
        }, async (args, ctx) => {
            try {
                if (tool.progress) await sendProgress(ctx, 0, 1, `${tool.name} started`);
                const rawResult = await tool.handler(args || {}, ctx);
                const result = normalizeToolResult(rawResult, ctx);
                if (tool.progress) await sendProgress(ctx, 1, 1, `${tool.name} completed`);
                return formatToolResponse(result);
            } catch (error) {
                const result = normalizeToolResult({
                    ok: false,
                    code: error.code === 'GLASS_CANCELLED' ? error.code : 'GLASS_INTERNAL_ERROR',
                    error: error.message,
                }, ctx);
                return formatToolResponse(result);
            }
        });
    }

    return { server, driver, tools };
}

async function sendProgress(ctx, progress, total, message) {
    const meta = ctx && ctx.mcpReq && ctx.mcpReq._meta;
    if (!meta || meta.progressToken === undefined || !ctx.mcpReq.notify) return;
    try {
        await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken: meta.progressToken, progress, total, message },
        });
    } catch { /* progress is advisory */ }
}

function formatToolResponse(result) {
    if (result && result.action === 'screenshot' && result.encoding === 'base64' && typeof result.data === 'string') {
        const { data, ...metadata } = result;
        metadata.mimeType = 'image/png';
        return {
            content: [
                { type: 'text', text: JSON.stringify(metadata) },
                { type: 'image', data, mimeType: 'image/png' },
            ],
            structuredContent: metadata,
            isError: metadata.ok === false,
        };
    }

    return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result && result.ok === false,
    };
}

function normalizeToolResult(result, ctx) {
    const normalized = result && typeof result === 'object'
        ? { ...result }
        : { ok: true, value: result };
    if (normalized.ok === undefined) {
        normalized.ok = true;
    }
    if (normalized.ok === false && !normalized.code) {
        normalized.code = 'GLASS_TOOL_ERROR';
    }

    const meta = ctx && ctx.mcpReq && ctx.mcpReq._meta;
    const trace = meta && ['traceparent', 'tracestate', 'baggage'].reduce((out, key) => {
        if (typeof meta[key] === 'string' && meta[key]) out[key] = meta[key];
        return out;
    }, {});
    if (trace && Object.keys(trace).length > 0) {
        normalized.audit = { ...(normalized.audit || {}), trace };
    }
    return normalized;
}

async function start(opts = {}) {
    const { serveStdio } = loadSdk();
    const instance = createGlassServer(opts);
    const handle = serveStdio(() => instance.server, {
        legacy: 'serve',
        onerror: (error) => console.error('[glass-mcp]', error.message),
    });

    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        try {
            await instance.driver.close();
        } finally {
            await handle.close();
        }
    };
    const shutdown = async () => { try { await close(); } catch { /* ignore */ } process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return { ...instance, handle, close };
}

if (require.main === module) {
    start().catch((e) => { console.error('[glass-mcp]', e.message); process.exit(1); });
}

module.exports = { SERVER_INFO, createGlassServer, formatToolResponse, normalizeToolResult, sendProgress, start };
