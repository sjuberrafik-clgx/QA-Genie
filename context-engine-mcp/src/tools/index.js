/**
 * Tool registry: argument validation and unique names.
 *
 * @module context-engine-mcp/tools
 */

import { ContextEngineError, validateArgs } from '../util/result.js';
import { freshnessTools } from './freshness.js';
import { knowledgeTools } from './knowledge.js';

export function createTools(ctx) {
    const tools = [...freshnessTools(ctx), ...knowledgeTools(ctx)];
    const seen = new Set();
    for (const tool of tools) {
        if (seen.has(tool.name)) throw new Error(`Duplicate context-engine tool name: ${tool.name}`);
        seen.add(tool.name);
        const handler = tool.handler;
        tool.handler = async (input = {}) => {
            const errors = validateArgs(tool.inputSchema, input);
            if (errors.length) throw new ContextEngineError('CE_BAD_REQUEST', `Invalid arguments for ${tool.name}: ${errors.join('; ')}`);
            return handler(input);
        };
    }
    return tools;
}
