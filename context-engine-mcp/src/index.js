/**
 * Programmatic entry point — lets scripts and tests build the same tool set the
 * MCP server exposes, without going through stdio.
 *
 * @module context-engine-mcp
 */

import { resolveConfig } from './config.js';
import { createPipeline } from './compile/pipeline.js';
import { ContextFreshness } from './sync/freshness.js';
import { createTools } from './tools/index.js';

export { resolveConfig, ContextFreshness, createPipeline, createTools };

export function createContextEngine(env = process.env, overrides = {}) {
    const config = { ...resolveConfig(env), ...overrides.config };
    const freshness = overrides.freshness || new ContextFreshness({
        registry: config.registry,
        workspaceRoot: config.workspaceRoot,
        dataDir: config.dataDir,
    });
    const pipeline = overrides.pipeline || createPipeline({ config, freshness });
    const tools = createTools({ config, freshness, pipeline });
    return { config, freshness, pipeline, tools };
}
