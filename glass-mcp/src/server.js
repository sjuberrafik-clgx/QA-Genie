#!/usr/bin/env node
'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · MCP SERVER — standalone, stdio transport
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A runnable MCP server exposing the verb algebra (currently open/see/do). Point
 * any MCP client at it:  node glass-mcp/src/server.js
 *
 * The @modelcontextprotocol/sdk is required lazily inside start() so the rest of
 * the package (and its tests) load without it. Zero workspace coupling — config
 * comes from args/env only.
 *
 * @module glass-mcp/server
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { BrowserSession } = require('./session');
const { buildTools } = require('./tools');

async function start(opts = {}) {
    let Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema;
    try {
        ({ Server } = require('@modelcontextprotocol/sdk/server/index.js'));
        ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
        ({ ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js'));
    } catch {
        throw new Error('@modelcontextprotocol/sdk is not installed. Run `npm i @modelcontextprotocol/sdk` in glass-mcp/.');
    }

    const session = new BrowserSession({
        headless: process.env.GLASS_HEADLESS !== 'false',
        ...opts,
    });
    const tools = buildTools(session);

    const server = new Server(
        { name: 'glass-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const tool = tools.find((t) => t.name === req.params.name);
        if (!tool) {
            return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `unknown tool: ${req.params.name}` }) }], isError: true };
        }
        try {
            const result = await tool.handler(req.params.arguments || {});
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }], isError: true };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const shutdown = async () => { try { await session.close(); } catch { /* ignore */ } process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return { server, session, tools };
}

if (require.main === module) {
    start().catch((e) => { console.error('[glass-mcp]', e.message); process.exit(1); });
}

module.exports = { start };
