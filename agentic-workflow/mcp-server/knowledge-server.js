/**
 * Read-only Application Knowledge MCP server for VS Code Copilot Chat.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { config as dotenvConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

dotenvConfig({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { createKnowledgeToolService } = require('../repo-mesh/knowledge-tools');

function toolResult(data, isError = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        ...(isError ? { isError: true } : {}),
    };
}

export function createKnowledgeServer(options = {}) {
    const service = options.service || createKnowledgeToolService(options);
    const server = new Server(
        { name: 'application-kb', version: '0.1.0' },
        { capabilities: { tools: { listChanged: false } } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: service.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const result = await service.call(request.params.name, request.params.arguments || {});
        return toolResult(result, result.success === false);
    });

    server.onerror = (error) => console.error('[ApplicationKB] Server error:', error);
    return { server, service };
}

export async function main() {
    const { server } = createKnowledgeServer();
    await server.connect(new StdioServerTransport());
    console.error('[ApplicationKB] Read-only knowledge server running on stdio');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
    main().catch((error) => {
        console.error('[ApplicationKB] Fatal:', error);
        process.exit(1);
    });
}