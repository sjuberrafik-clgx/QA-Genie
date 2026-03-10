/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TOOL SEARCH — Anthropic Advanced Tool Calling (Technique 3: Tool Search Tool)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Instead of loading all 141 tool definitions upfront (~30-40K tokens), only ~20 core
 * tools are always loaded. The unified_tool_search meta-tool lets the LLM discover
 * additional tools on-demand by searching tool names, descriptions, and categories.
 *
 * Uses a lightweight BM25-inspired scoring over tool metadata. Index is pre-built at
 * server startup (one-time ~10ms cost) — searches are instant.
 *
 * Expected savings: ~85% reduction in tool definition tokens.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { ALL_TOOLS } from './tool-definitions.js';

// ─── Stopwords (common words to ignore in scoring) ──────────────────────────

const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
    'that', 'this', 'it', 'its', 'use', 'using', 'used',
]);

// ─── Tokenizer ──────────────────────────────────────────────────────────────

function tokenize(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// ─── Tool Search Index ──────────────────────────────────────────────────────

class ToolSearchIndex {
    constructor() {
        this._docs = [];        // { toolName, tokens, tool }
        this._idf = new Map();  // token → IDF score
        this._avgDocLen = 0;
        this._built = false;
    }

    /**
     * Build the search index from ALL_TOOLS.
     * Call once at server startup.
     */
    build() {
        this._docs = [];
        const df = new Map(); // document frequency

        for (const tool of ALL_TOOLS) {
            // Create searchable text from tool metadata
            const searchableText = [
                tool.name,
                tool.name.replace(/unified_/g, '').replace(/_/g, ' '),
                tool.description || '',
                tool._meta?.category || '',
                // Include parameter names and descriptions
                ...Object.entries(tool.inputSchema?.properties || {}).flatMap(([key, val]) => [
                    key,
                    val.description || '',
                ]),
            ].join(' ');

            const tokens = tokenize(searchableText);

            // Track document frequency
            const uniqueTokens = new Set(tokens);
            for (const token of uniqueTokens) {
                df.set(token, (df.get(token) || 0) + 1);
            }

            this._docs.push({ toolName: tool.name, tokens, tool });
        }

        // Compute IDF: log(N / df) where N = total docs
        const N = this._docs.length;
        for (const [token, freq] of df) {
            this._idf.set(token, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
        }

        // Average document length for BM25 normalization
        const totalLen = this._docs.reduce((sum, d) => sum + d.tokens.length, 0);
        this._avgDocLen = totalLen / Math.max(N, 1);

        this._built = true;
        console.error(`[ToolSearch] Index built: ${N} tools, ${df.size} unique terms`);
    }

    /**
     * Search for tools matching a query.
     *
     * @param {string} query - Natural language or keyword query
     * @param {Object} [options]
     * @param {number} [options.limit=10] - Maximum results to return
     * @param {string} [options.category] - Filter by category
     * @returns {Array<{ tool: object, score: number }>}
     */
    search(query, options = {}) {
        if (!this._built) this.build();

        const { limit = 10, category = null } = options;
        const queryTokens = tokenize(query);

        if (queryTokens.length === 0) {
            return [];
        }

        // BM25 parameters
        const k1 = 1.5;
        const b = 0.75;

        const results = [];

        for (const doc of this._docs) {
            // Category filter
            if (category && doc.tool._meta?.category !== category) {
                continue;
            }

            // BM25 scoring
            let score = 0;
            const docLen = doc.tokens.length;
            const termFreqs = new Map();

            for (const token of doc.tokens) {
                termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
            }

            for (const qToken of queryTokens) {
                const tf = termFreqs.get(qToken) || 0;
                if (tf === 0) continue;

                const idf = this._idf.get(qToken) || 0;
                const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / this._avgDocLen));
                score += idf * tfNorm;
            }

            // Bonus: exact tool name match
            const lowerQuery = query.toLowerCase();
            if (doc.toolName.toLowerCase().includes(lowerQuery.replace(/\s+/g, '_'))) {
                score += 5.0;
            }

            // Bonus: category name match
            if (doc.tool._meta?.category && lowerQuery.includes(doc.tool._meta.category)) {
                score += 2.0;
            }

            if (score > 0) {
                results.push({ tool: doc.tool, score });
            }
        }

        // Sort by score descending, take top N
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    /**
     * List all available tool categories.
     * @returns {string[]}
     */
    listCategories() {
        const categories = new Set();
        for (const tool of ALL_TOOLS) {
            if (tool._meta?.category) {
                categories.add(tool._meta.category);
            }
        }
        return [...categories].sort();
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get the singleton ToolSearchIndex, building it on first access.
 * @returns {ToolSearchIndex}
 */
export function getToolSearchIndex() {
    if (!_instance) {
        _instance = new ToolSearchIndex();
        _instance.build();
    }
    return _instance;
}

// ─── Tool Definition for unified_tool_search ────────────────────────────────

export const TOOL_SEARCH_DEFINITION = {
    name: 'unified_tool_search',
    description: 'Search for available MCP tools by name, description, or category. Use this when you need a capability not in your currently loaded tools. Returns matching tool definitions with their full schemas so you can call them.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query — tool name, category, or natural language description of what you need. Examples: "network interception", "cookies", "iframe", "shadow dom", "video recording", "geolocation"',
            },
            category: {
                type: 'string',
                description: 'Optional: filter results to a specific category. Available categories: iframe, shadow-dom, network-interception, storage, cookies, keyboard, mouse, scroll, multi-page, download, performance, debugging, emulation, network, pdf, video, auth, mutation, geolocation, locale, timezone, permissions, accessibility, context',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5, max: 20)',
            },
        },
        required: ['query'],
    },
    _meta: {
        source: 'internal',
        category: 'meta',
        readOnly: true,
        deferrable: false,  // Tool search itself is NEVER deferred
    },
};

/**
 * Handle a unified_tool_search call.
 * Returns matching tools with their full definitions so the agent can call them.
 *
 * @param {Object} args - { query, category?, limit? }
 * @returns {Object} Search results with tool definitions
 */
export function handleToolSearch(args) {
    const { query, category = null, limit = 5 } = args;
    const index = getToolSearchIndex();

    const clampedLimit = Math.min(Math.max(limit || 5, 1), 20);
    const results = index.search(query, { limit: clampedLimit, category });

    // Return tool definitions (without _meta) so the agent can call them
    const toolResults = results.map(r => {
        const { _meta, ...cleanTool } = r.tool;
        return {
            name: cleanTool.name,
            description: cleanTool.description,
            inputSchema: cleanTool.inputSchema,
            category: _meta?.category || 'unknown',
            score: Math.round(r.score * 100) / 100,
        };
    });

    return {
        query,
        category: category || 'all',
        resultCount: toolResults.length,
        totalToolsAvailable: ALL_TOOLS.length,
        tools: toolResults,
        hint: toolResults.length === 0
            ? `No tools found for "${query}". Try broader terms or check available categories.`
            : `Found ${toolResults.length} matching tools. Call them by name — they are available even if not in your initial tool list.`,
    };
}
