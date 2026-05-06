/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MCP CONNECTION MANAGER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages MCP server connections — pre-built connectors, custom URL/command
 * connections, health checking, and tool discovery.
 *
 * Registry tiers:
 *   1. **Built-in MCP servers** — Our unified-automation server (141 tools),
 *      plus well-known community servers (Jira, GitHub, Slack, etc.)
 *   2. **Workspace MCP servers** — Custom servers created in Studio workspaces
 *
 * Consumed by:
 *   - GET  /api/studio/mcp-registry           — list available MCP servers
 *   - POST /api/studio/mcp-registry/test      — test a connection
 *   - GET  /api/studio/mcp-registry/:id/tools — list tools for a server
 *
 * @module sdk-orchestrator/mcp-connection-manager
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ─── Built-in MCP Server Registry ──────────────────────────────────────────

const BUILTIN_MCP_SERVERS = [
    {
        id: 'unified-automation',
        name: 'Unified Automation',
        description: '141-tool MCP server for Playwright browser automation with intelligent routing (Playwright + Chrome DevTools).',
        category: 'browser',
        toolCount: 141,
        icon: 'browser',
        color: 'blue',
        source: 'builtin',
        connection: {
            type: 'local',
            command: 'node',
            args: ['agentic-workflow/mcp-server/server.js'],
        },
        capabilities: ['navigation', 'snapshot', 'interaction', 'state', 'wait', 'assert', 'screenshot', 'evaluate'],
        isInstalled: true,
    },
    {
        id: 'atlassian-jira',
        name: 'Atlassian Jira',
        description: 'Jira Cloud REST API integration — create, read, update, transition, and search issues.',
        category: 'project-management',
        toolCount: 22,
        icon: 'task',
        color: 'blue',
        source: 'builtin',
        connection: {
            type: 'url',
            url: '',
            envVars: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
        },
        capabilities: ['issues', 'search', 'transitions', 'comments', 'attachments', 'worklogs'],
        isInstalled: false,
        setupHint: 'Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in agentic-workflow/.env',
    },
    {
        id: 'atlassian-confluence',
        name: 'Atlassian Confluence',
        description: 'Confluence Cloud REST API — search, read, create, and update pages and spaces.',
        category: 'documentation',
        toolCount: 14,
        icon: 'document',
        color: 'blue',
        source: 'builtin',
        connection: {
            type: 'url',
            url: '',
            envVars: ['CONFLUENCE_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
        },
        capabilities: ['pages', 'spaces', 'search', 'comments'],
        isInstalled: false,
        setupHint: 'Set CONFLUENCE_BASE_URL in agentic-workflow/.env (reuses Jira credentials)',
    },
    {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub REST/GraphQL API — repositories, issues, PRs, actions, code search.',
        category: 'development',
        toolCount: 30,
        icon: 'code',
        color: 'slate',
        source: 'community',
        connection: {
            type: 'url',
            url: 'https://api.github.com',
            envVars: ['GITHUB_TOKEN'],
        },
        capabilities: ['repos', 'issues', 'pull-requests', 'actions', 'search'],
        isInstalled: false,
        setupHint: 'Set GITHUB_TOKEN in environment',
    },
    {
        id: 'slack',
        name: 'Slack',
        description: 'Slack Web API — send messages, manage channels, read conversation history.',
        category: 'communication',
        toolCount: 12,
        icon: 'chat',
        color: 'purple',
        source: 'community',
        connection: {
            type: 'url',
            url: '',
            envVars: ['SLACK_BOT_TOKEN'],
        },
        capabilities: ['messages', 'channels', 'users', 'files'],
        isInstalled: false,
        setupHint: 'Set SLACK_BOT_TOKEN in environment',
    },
    {
        id: 'notion',
        name: 'Notion',
        description: 'Notion API — databases, pages, blocks, and search.',
        category: 'documentation',
        toolCount: 10,
        icon: 'document',
        color: 'slate',
        source: 'community',
        connection: {
            type: 'url',
            url: 'https://mcp.notion.com/mcp',
            envVars: ['NOTION_API_KEY'],
        },
        capabilities: ['pages', 'databases', 'blocks', 'search'],
        isInstalled: false,
        setupHint: 'Set NOTION_API_KEY in environment',
    },
];

const MCP_CATEGORIES = [
    { id: 'browser', label: 'Browser Automation', icon: 'browser' },
    { id: 'project-management', label: 'Project Management', icon: 'task' },
    { id: 'documentation', label: 'Documentation', icon: 'document' },
    { id: 'development', label: 'Development', icon: 'code' },
    { id: 'communication', label: 'Communication', icon: 'chat' },
    { id: 'custom', label: 'Custom', icon: 'wrench' },
];

const BUILTIN_BY_ID = new Map(BUILTIN_MCP_SERVERS.map(s => [s.id, s]));

// ─── Tool Profiles (presets) ────────────────────────────────────────────────

const TOOL_PROFILES = [
    {
        id: 'qa-full',
        name: 'QA Full',
        description: 'All browser + Jira + filesystem tools for full QA automation',
        tools: { browser: true, jira: true, filesystem: 'read' },
    },
    {
        id: 'read-only',
        name: 'Read Only',
        description: 'No write/create/delete operations — safe for auditing',
        tools: { browser: true, jira: false, filesystem: 'read' },
    },
    {
        id: 'jira-only',
        name: 'Jira Only',
        description: 'Only Jira tools — for ticket management agents',
        tools: { browser: false, jira: true, filesystem: 'none' },
    },
    {
        id: 'browser-only',
        name: 'Browser Only',
        description: 'Only browser/MCP tools — for exploration and testing agents',
        tools: { browser: true, jira: false, filesystem: 'none' },
    },
];

// ─── Connection Tester ──────────────────────────────────────────────────────

async function testConnection(connection, timeoutMs = 5000) {
    const result = {
        status: 'unknown',
        latencyMs: null,
        error: null,
        testedAt: new Date().toISOString(),
    };

    const start = Date.now();

    try {
        if (connection.type === 'local') {
            // Check if the server file exists
            const serverPath = path.resolve(PROJECT_ROOT, ...(connection.args || ['server.js']));
            if (!fs.existsSync(serverPath)) {
                result.status = 'error';
                result.error = `Server file not found: ${serverPath}`;
                return result;
            }
            result.status = 'ok';
            result.latencyMs = Date.now() - start;
            return result;
        }

        if (connection.type === 'url' && connection.url) {
            // Validate URL format
            let parsedUrl;
            try {
                parsedUrl = new URL(connection.url);
            } catch {
                result.status = 'error';
                result.error = `Invalid URL: ${connection.url}`;
                return result;
            }

            // Allowlist check — only http/https
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                result.status = 'error';
                result.error = `Unsupported protocol: ${parsedUrl.protocol}. Only http/https are allowed.`;
                return result;
            }

            // Block private/internal IPs to prevent SSRF
            const hostname = parsedUrl.hostname;
            if (isPrivateHost(hostname)) {
                result.status = 'error';
                result.error = 'Connection to private/internal addresses is not allowed';
                return result;
            }

            // HTTP HEAD request
            await new Promise((resolve, reject) => {
                const client = parsedUrl.protocol === 'https:' ? https : http;
                const req = client.request(parsedUrl.href, { method: 'HEAD', timeout: timeoutMs }, (res) => {
                    result.status = res.statusCode < 500 ? 'ok' : 'error';
                    result.latencyMs = Date.now() - start;
                    if (res.statusCode >= 500) {
                        result.error = `Server returned ${res.statusCode}`;
                    }
                    res.resume();
                    resolve();
                });
                req.on('error', (err) => {
                    result.status = 'error';
                    result.error = err.message;
                    result.latencyMs = Date.now() - start;
                    resolve();
                });
                req.on('timeout', () => {
                    req.destroy();
                    result.status = 'timeout';
                    result.error = `Connection timed out after ${timeoutMs}ms`;
                    result.latencyMs = Date.now() - start;
                    resolve();
                });
                req.end();
            });

            return result;
        }

        // Command-type or unknown — just validate config presence
        if (connection.command) {
            result.status = 'ok';
            result.latencyMs = Date.now() - start;
        } else {
            result.status = 'error';
            result.error = 'No connection URL or command configured';
        }
    } catch (err) {
        result.status = 'error';
        result.error = err.message;
        result.latencyMs = Date.now() - start;
    }

    return result;
}

/** Basic SSRF prevention — block private IP ranges. */
function isPrivateHost(hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname.startsWith('10.')) return true;
    if (hostname.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
    return false;
}

// ─── Manager Class ──────────────────────────────────────────────────────────

class McpConnectionManager {
    constructor(options = {}) {
        this._customServers = new Map();
        this._envPath = options.envPath || path.join(PROJECT_ROOT, 'agentic-workflow', '.env');
    }

    /** List all available MCP servers (builtin + detected + custom). */
    listServers(options = {}) {
        const { category } = options;
        const servers = [...BUILTIN_MCP_SERVERS];

        // Add workspace custom servers
        for (const server of this._customServers.values()) {
            servers.push(server);
        }

        // Check which servers have their env vars configured
        const enriched = servers.map(server => ({
            ...server,
            isConfigured: this._checkEnvVars(server.connection?.envVars || []),
        }));

        let filtered = enriched;
        if (category) {
            filtered = filtered.filter(s => s.category === category);
        }

        return {
            items: filtered,
            categories: MCP_CATEGORIES,
            toolProfiles: TOOL_PROFILES,
        };
    }

    /** Get a specific MCP server by ID. */
    getServer(serverId) {
        const builtin = BUILTIN_BY_ID.get(serverId);
        if (builtin) return { ...builtin, isConfigured: this._checkEnvVars(builtin.connection?.envVars || []) };

        const custom = this._customServers.get(serverId);
        if (custom) return { ...custom };

        const error = new Error(`MCP server not found: ${serverId}`);
        error.status = 404;
        throw error;
    }

    /** Test connectivity for an MCP server. */
    async testServer(serverIdOrConnection) {
        let connection;
        if (typeof serverIdOrConnection === 'string') {
            const server = this.getServer(serverIdOrConnection);
            connection = server.connection;
        } else {
            connection = serverIdOrConnection;
        }

        return testConnection(connection);
    }

    /** Register a custom server from workspace MCP creation. */
    registerCustomServer(server) {
        this._customServers.set(server.id, {
            ...server,
            source: 'workspace',
            category: server.category || 'custom',
        });
    }

    /** Check if required environment variables are present. */
    _checkEnvVars(varNames) {
        if (!varNames || varNames.length === 0) return true;

        // Check process.env first
        const allInEnv = varNames.every(v => process.env[v]);
        if (allInEnv) return true;

        // Fallback: check .env file
        try {
            if (fs.existsSync(this._envPath)) {
                const envContent = fs.readFileSync(this._envPath, 'utf8');
                return varNames.every(v => {
                    const regex = new RegExp(`^${v}=.+`, 'm');
                    return regex.test(envContent);
                });
            }
        } catch {
            // ignore read errors
        }

        return false;
    }
}

module.exports = {
    McpConnectionManager,
    BUILTIN_MCP_SERVERS,
    MCP_CATEGORIES,
    TOOL_PROFILES,
    testConnection,
};
