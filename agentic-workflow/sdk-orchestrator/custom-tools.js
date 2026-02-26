/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOM TOOLS — SDK Tool Definitions
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Exposes existing system capabilities (framework inventory, error analysis,
 * script validation, learning store, assertion config, popup handler) as
 * Copilot SDK tools that the AI can call during sessions.
 *
 * Each tool uses defineTool() with structured parameters and typed return values,
 * replacing the current approach of embedding instructions in system prompts.
 *
 * @module custom-tools
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { markdownToAdf } = require('./adf-converter');

// ─── Environment loader ─────────────────────────────────────────────────────
function loadEnvVars() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
    } catch { /* dotenv not installed */ }
}

// ─── TTL Cache for Tool Results ─────────────────────────────────────────────

/**
 * Lightweight TTL cache for idempotent tool results.
 * Prevents redundant I/O when the same tool is called multiple times
 * across sessions within a pipeline run (e.g., get_framework_inventory
 * called by scriptgenerator then codereviewer within minutes).
 *
 * Default TTL: 5 minutes. Cache is per-process (singleton).
 */
class ToolResultCache {
    constructor(defaultTTL = 5 * 60 * 1000) {
        this._cache = new Map();
        this._defaultTTL = defaultTTL;
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Get a cached result, or compute and cache it.
     *
     * @param {string} key         - Cache key (typically tool name + serialized args)
     * @param {Function} compute   - async function to compute the result if not cached
     * @param {number} [ttl]       - Custom TTL in ms (default: 5 min)
     * @returns {Promise<*>}       - The cached or freshly computed result
     */
    async getOrCompute(key, compute, ttl) {
        const entry = this._cache.get(key);
        const now = Date.now();

        if (entry && (now - entry.timestamp) < (ttl || this._defaultTTL)) {
            this._hits++;
            return entry.value;
        }

        this._misses++;
        const value = await compute();
        this._cache.set(key, { value, timestamp: now });

        // Evict stale entries periodically (keep cache size bounded)
        if (this._cache.size > 50) {
            this._evictStale();
        }

        return value;
    }

    /** Remove entries older than their TTL */
    _evictStale() {
        const now = Date.now();
        for (const [key, entry] of this._cache) {
            if ((now - entry.timestamp) > this._defaultTTL) {
                this._cache.delete(key);
            }
        }
    }

    /** Clear the entire cache (useful after config changes) */
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }

    /** Get cache statistics for diagnostics */
    getStats() {
        return {
            size: this._cache.size,
            hits: this._hits,
            misses: this._misses,
            hitRate: this._hits + this._misses > 0
                ? ((this._hits / (this._hits + this._misses)) * 100).toFixed(1) + '%'
                : 'N/A',
        };
    }
}

// Singleton cache instance
const _toolCache = new ToolResultCache();
function getToolCache() { return _toolCache; }

// ─── Tool Definitions ───────────────────────────────────────────────────────

/**
 * Create all custom tools for a specific agent role.
 *
 * @param {Function} defineTool     - SDK defineTool function
 * @param {string}   agentName      - Agent role
 * @param {Object}   deps           - Dependencies (learningStore, config)
 * @returns {Array}  Array of tool definitions
 */
function createCustomTools(defineTool, agentName, deps = {}) {
    const { learningStore, config, contextStore, groundingStore } = deps;
    const tools = [];

    // ───────────────────────────────────────────────────────────────────
    // TOOL 1: get_framework_inventory
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('get_framework_inventory', {
            description:
                'Scans the test framework codebase and returns all available page object classes, ' +
                'methods, locators, business functions, utility functions, popup handlers, and ' +
                'test data exports. Use this BEFORE writing any imports to know what already exists.',
            parameters: {
                type: 'object',
                properties: {
                    includeLocators: {
                        type: 'boolean',
                        description: 'Include locator strings from page objects (default: false)',
                    },
                },
            },
            handler: async ({ includeLocators }) => {
                try {
                    const { getFrameworkInventoryCache, getInventorySummary } =
                        require('../utils/project-path-resolver');
                    const inventory = getFrameworkInventoryCache();

                    if (includeLocators) {
                        return JSON.stringify(inventory, null, 2);
                    }
                    return getInventorySummary(inventory);
                } catch (error) {
                    return `Error loading framework inventory: ${error.message}`;
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 2: validate_generated_script
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('validate_generated_script', {
            description:
                'Validates a generated Playwright .spec.js file against framework conventions. ' +
                'Checks for anti-patterns (AP001-AP006), phantom imports, deprecated methods, ' +
                'selector quality, serial execution, popup handler usage, and more. ' +
                'Returns a structured report with errors and warnings.',
            parameters: {
                type: 'object',
                properties: {
                    scriptPath: {
                        type: 'string',
                        description: 'Absolute or workspace-relative path to the .spec.js file',
                    },
                },
                required: ['scriptPath'],
            },
            handler: async ({ scriptPath }) => {
                try {
                    const { validateGeneratedScript } = require('../scripts/validate-script');
                    const resolvedPath = path.isAbsolute(scriptPath)
                        ? scriptPath
                        : path.join(__dirname, '..', '..', scriptPath);

                    if (!fs.existsSync(resolvedPath)) {
                        return JSON.stringify({ valid: false, errors: [`File not found: ${resolvedPath}`] });
                    }

                    const content = fs.readFileSync(resolvedPath, 'utf-8');
                    // Capture console output
                    const originalLog = console.log;
                    const logs = [];
                    console.log = (...args) => logs.push(args.join(' '));

                    const result = validateGeneratedScript(resolvedPath, content);

                    console.log = originalLog;

                    return JSON.stringify({
                        valid: result.valid,
                        errors: result.errors,
                        warnings: result.warnings,
                        consoleOutput: logs.join('\n'),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ valid: false, errors: [`Validation error: ${error.message}`] });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 3: get_historical_failures
    // Available to: scriptgenerator (for learning from past mistakes)
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName) && learningStore) {
        tools.push(defineTool('get_historical_failures', {
            description:
                'Returns historical failure data from previous test runs. Shows which selectors ' +
                'broke, what fixes worked, and common issues per page/feature. Use this to avoid ' +
                'repeating known mistakes and to prefer stable selectors.',
            parameters: {
                type: 'object',
                properties: {
                    page: {
                        type: 'string',
                        description: 'Page URL or feature name to filter failures for',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to filter failures for',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of failures to return (default: 20)',
                    },
                },
            },
            handler: async ({ page, ticketId, limit }) => {
                const cache = getToolCache();
                const cacheKey = `historical_failures:${ticketId || ''}:${page || ''}:${limit || 20}`;

                return cache.getOrCompute(cacheKey, async () => {
                    try {
                        let failures;
                        if (ticketId) {
                            failures = learningStore.getFailuresForTicket(ticketId);
                        } else if (page) {
                            failures = learningStore.getFailuresForPage(page);
                        } else {
                            failures = learningStore.getRecentFailures(limit || 20);
                        }

                        const stableMappings = learningStore.getStableSelectors(page);

                        return JSON.stringify({
                            failures,
                            stableSelectors: stableMappings,
                            summary: `${failures.length} historical failures found, ${stableMappings.length} stable selector mappings`,
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({ failures: [], error: error.message });
                    }
                }, 2 * 60 * 1000); // 2 min TTL — failures update more frequently
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 4: get_exploration_data
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('get_exploration_data', {
            description:
                'Returns previously captured MCP exploration data for a ticket. Contains ' +
                'accessibility snapshots, extracted selectors, page URLs visited, and detected popups.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId }) => {
                try {
                    const explorationDir = path.join(__dirname, '..', 'exploration-data');
                    const explorationFile = path.join(explorationDir, `${ticketId}-exploration.json`);

                    if (!fs.existsSync(explorationFile)) {
                        return JSON.stringify({
                            found: false,
                            message: `No exploration data found for ${ticketId}. MCP exploration must be performed first.`,
                        });
                    }

                    const data = JSON.parse(fs.readFileSync(explorationFile, 'utf-8'));
                    return JSON.stringify({
                        found: true,
                        source: data.source,
                        timestamp: data.timestamp,
                        pagesVisited: data.pagesVisited || [],
                        selectorCount: data.selectorCount || 0,
                        popupsDetected: data.popupsDetected || [],
                        snapshotCount: (data.snapshots || []).length,
                        data,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ found: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 5: analyze_test_failure
    // Available to: scriptgenerator (self-healing), buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('analyze_test_failure', {
            description:
                'Analyzes Playwright test failure output using AI-powered pattern matching. ' +
                'Categorizes errors (SELECTOR, NETWORK, TIMEOUT, ASSERTION, BROWSER, AUTH), ' +
                'provides fix suggestions, and generates auto-fix objects when possible.',
            parameters: {
                type: 'object',
                properties: {
                    errorOutput: {
                        type: 'string',
                        description: 'The raw error output from Playwright test execution',
                    },
                    scriptPath: {
                        type: 'string',
                        description: 'Path to the failing script (for auto-fix context)',
                    },
                },
                required: ['errorOutput'],
            },
            handler: async ({ errorOutput, scriptPath }) => {
                try {
                    const { ErrorAnalyzer } = require('../../.github/agents/lib/error-analyzer');
                    const analyzer = new ErrorAnalyzer();
                    const analysis = analyzer.analyze(errorOutput, { scriptPath });
                    const report = analyzer.generateReport(analysis);

                    return JSON.stringify({
                        category: analysis.category,
                        severity: analysis.severity,
                        autoFixable: analysis.autoFixable,
                        suggestions: analysis.suggestions,
                        aiInsights: analysis.aiInsights,
                        report,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: `Analysis failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 6: get_assertion_config
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('get_assertion_config', {
            description:
                'Returns assertion patterns and rules for the current framework. Provides ' +
                'recommended assertion strategies per element type (text, visibility, count, URL, etc.) ' +
                'along with anti-pattern rules to avoid.',
            parameters: {
                type: 'object',
                properties: {
                    pageType: {
                        type: 'string',
                        description: 'Type of page being tested (e.g., "property-details", "search-results", "login")',
                    },
                },
            },
            handler: async ({ pageType }) => {
                const cache = getToolCache();
                const cacheKey = `assertion_config:${pageType || 'default'}`;

                return cache.getOrCompute(cacheKey, async () => {
                    try {
                        const AssertionConfigHelper = require('../utils/assertionConfigHelper');
                        const helper = new AssertionConfigHelper();
                        const framework = helper.getActiveFramework();
                        const assertions = helper.getAssertionsByCategory(pageType || 'default');
                        const antiPatterns = helper.getAntiPatterns ? helper.getAntiPatterns() : [];

                        return JSON.stringify({
                            framework,
                            assertions,
                            antiPatterns,
                            tips: [
                                'Always use auto-retrying assertions (toBeVisible, toContainText, toBeEnabled)',
                                'Never use expect(await el.textContent()).toContain() — use await expect(el).toContainText()',
                                'Never use expect(await el.isVisible()).toBe(true) — use await expect(el).toBeVisible()',
                            ],
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({ error: `Config load failed: ${error.message}` });
                    }
                });
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 7: suggest_popup_handler
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('suggest_popup_handler', {
            description:
                'Analyzes exploration data to determine which PopupHandler methods to use. ' +
                'Classifies detected popups as handled (existing method available) or unhandled ' +
                '(needs new method). Returns popup handling code recommendations.',
            parameters: {
                type: 'object',
                properties: {
                    explorationJson: {
                        type: 'string',
                        description: 'JSON string of exploration data containing popupsDetected array',
                    },
                },
                required: ['explorationJson'],
            },
            handler: async ({ explorationJson }) => {
                try {
                    const { PopupHandler } = require('../../tests/utils/popupHandler');
                    const explorationData = JSON.parse(explorationJson);
                    const suggestions = PopupHandler.suggestPopupHandler(explorationData);
                    return JSON.stringify(suggestions, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        error: error.message,
                        fallback: 'Use popups.dismissAll() as a safe default',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 8: run_quality_gate
    // Available to: all agents (for self-validation)
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('run_quality_gate', {
        description:
            'Runs a specific quality gate check. Gates: "excel" (validates test case Excel), ' +
            '"exploration" (validates MCP exploration data), "script" (validates generated script), ' +
            '"execution" (validates test results).',
        parameters: {
            type: 'object',
            properties: {
                gate: {
                    type: 'string',
                    description: 'Quality gate to run: "excel" | "exploration" | "script" | "execution"',
                },
                artifactPath: {
                    type: 'string',
                    description: 'Path to the artifact to validate',
                },
                ticketId: {
                    type: 'string',
                    description: 'Ticket ID for context',
                },
            },
            required: ['gate', 'artifactPath'],
        },
        handler: async ({ gate, artifactPath, ticketId }) => {
            try {
                const { QualityGates } = require('../../.github/agents/lib/quality-gates');
                const qg = new QualityGates();

                let result;
                switch (gate) {
                    case 'excel':
                        result = qg.validateExcelCreated(artifactPath, ticketId);
                        break;
                    case 'exploration':
                        result = qg.validateMCPExploration(artifactPath, ticketId);
                        break;
                    case 'script':
                        result = qg.validateScriptGenerated(artifactPath, ticketId);
                        break;
                    case 'execution':
                        result = qg.validateExecution(artifactPath, ticketId);
                        break;
                    default:
                        result = { passed: false, error: `Unknown gate: ${gate}` };
                }

                return JSON.stringify(result, null, 2);
            } catch (error) {
                return JSON.stringify({ passed: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL 9: save_exploration_data
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('save_exploration_data', {
            description:
                'Saves MCP exploration data to the exploration-data directory. ' +
                'Data must conform to the exploration schema with source, snapshots, ' +
                'selectorCount, pagesVisited, and popupsDetected fields.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID',
                    },
                    explorationData: {
                        type: 'string',
                        description: 'JSON string of exploration data to save',
                    },
                },
                required: ['ticketId', 'explorationData'],
            },
            handler: async ({ ticketId, explorationData }) => {
                try {
                    const data = JSON.parse(explorationData);

                    // Enforce required fields
                    if (data.source !== 'mcp-live-snapshot') {
                        return JSON.stringify({
                            saved: false,
                            error: 'source must be "mcp-live-snapshot"',
                        });
                    }
                    if (!data.snapshots || data.snapshots.length === 0) {
                        return JSON.stringify({
                            saved: false,
                            error: 'snapshots array must be non-empty',
                        });
                    }

                    const explorationDir = path.join(__dirname, '..', 'exploration-data');
                    if (!fs.existsSync(explorationDir)) {
                        fs.mkdirSync(explorationDir, { recursive: true });
                    }

                    const filePath = path.join(explorationDir, `${ticketId}-exploration.json`);
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

                    return JSON.stringify({
                        saved: true,
                        path: filePath,
                        selectorCount: data.selectorCount || 0,
                        pagesVisited: data.pagesVisited || [],
                    });
                } catch (error) {
                    return JSON.stringify({ saved: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 10: get_test_results
    // Available to: buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie'].includes(agentName)) {
        tools.push(defineTool('get_test_results', {
            description:
                'Retrieves the latest test execution results for a ticket. Returns pass/fail counts, ' +
                'failure details, error messages, and screenshots if available.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID',
                    },
                    specPath: {
                        type: 'string',
                        description: 'Path to the spec file (if known)',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, specPath }) => {
                try {
                    // Look for test results in standard locations
                    const resultsDir = path.join(__dirname, '..', 'test-results');
                    const testResultsDir = path.join(__dirname, '..', '..', 'test-results');

                    // Scan for JSON result files
                    const searchDirs = [resultsDir, testResultsDir].filter(d => fs.existsSync(d));
                    const results = [];

                    for (const dir of searchDirs) {
                        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
                        for (const file of files) {
                            try {
                                const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
                                results.push({ file, data });
                            } catch { /* skip invalid JSON */ }
                        }
                    }

                    return JSON.stringify({
                        ticketId,
                        resultsFound: results.length,
                        results: results.slice(-5), // Last 5 results
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11: fetch_jira_ticket
    // Available to: testgenie, buggenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['testgenie', 'buggenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('fetch_jira_ticket', {
            description:
                'Fetches Jira ticket details (summary, description, acceptance criteria, labels, ' +
                'status, priority, issue type, components) via the Atlassian REST API. ' +
                'Returns the full ticket payload for test case generation.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId }) => {
                try {
                    loadEnvVars();
                    const baseUrl = process.env.JIRA_BASE_URL;
                    if (!baseUrl && !process.env.JIRA_CLOUD_ID) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_BASE_URL or JIRA_CLOUD_ID must be set in agentic-workflow/.env',
                            hint: 'Copy .env.example to .env and configure Jira settings',
                        });
                    }
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    // Try Atlassian REST v3 via cloud (preferred)
                    let url;
                    if (cloudId) {
                        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${ticketId}?expand=renderedFields`;
                    } else {
                        url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${ticketId}?expand=renderedFields`;
                    }

                    const headers = { 'Accept': 'application/json' };
                    if (email && apiToken) {
                        headers['Authorization'] = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
                    }

                    const response = await fetch(url, { headers });

                    if (!response.ok) {
                        // Fall back to basic fields without auth
                        const fallbackUrl = `${baseUrl.replace(/\/$/, '')}/rest/api/2/issue/${ticketId}`;
                        const fallbackResp = await fetch(fallbackUrl, {
                            headers: { 'Accept': 'application/json', ...headers },
                        });
                        if (!fallbackResp.ok) {
                            return JSON.stringify({
                                success: false,
                                error: `Failed to fetch ${ticketId}: HTTP ${response.status} (cloud) / ${fallbackResp.status} (direct)`,
                                hint: 'Ensure JIRA_EMAIL and JIRA_API_TOKEN are set in agentic-workflow/.env',
                            });
                        }
                        const data = await fallbackResp.json();
                        return JSON.stringify(formatJiraTicket(data, ticketId), null, 2);
                    }

                    const data = await response.json();
                    return JSON.stringify(formatJiraTicket(data, ticketId), null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira fetch error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a2: get_jira_current_user
    // Available to: buggenie, testgenie, taskgenie
    // Returns the authenticated Jira user's accountId and displayName.
    // Use this before create_jira_ticket to auto-assign tickets to the
    // requesting user.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_current_user', {
            description:
                'Returns the currently authenticated Jira user\'s account ID and display name. ' +
                'Call this BEFORE create_jira_ticket when you need to assign the new ticket ' +
                'to the user who is requesting the task. The returned accountId can be passed ' +
                'as assigneeAccountId to create_jira_ticket.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => {
                try {
                    loadEnvVars();
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const baseUrl = process.env.JIRA_BASE_URL;
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    if (!email || !apiToken) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_EMAIL and JIRA_API_TOKEN are required',
                        });
                    }

                    const headers = {
                        'Accept': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
                    };

                    const url = cloudId
                        ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`
                        : `${(baseUrl || '').replace(/\/$/, '')}/rest/api/3/myself`;

                    const response = await fetch(url, { method: 'GET', headers });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        return JSON.stringify({
                            success: false,
                            error: `Failed to fetch current user: HTTP ${response.status}`,
                            details: errorBody,
                        });
                    }

                    const userData = await response.json();
                    return JSON.stringify({
                        success: true,
                        accountId: userData.accountId,
                        displayName: userData.displayName,
                        emailAddress: userData.emailAddress || email,
                        active: userData.active,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Error fetching current user: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b: create_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('create_jira_ticket', {
            description:
                'Creates a new Jira ticket via the Atlassian REST API. ' +
                'Used by BugGenie to file defect tickets, TestGenie to create Testing tasks, and TaskGenie to create linked Testing tasks. ' +
                'Supports linking to a parent ticket and assigning to a specific user. ' +
                'Returns the created ticket key and URL.',
            parameters: {
                type: 'object',
                properties: {
                    projectKey: {
                        type: 'string',
                        description: 'Jira project key (e.g., "AOTF"). Defaults to JIRA_PROJECT_KEY env var.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Defect ticket summary/title',
                    },
                    description: {
                        type: 'string',
                        description: 'Full defect description including Steps to Reproduce, Expected/Actual Behaviour, Environment',
                    },
                    issueType: {
                        type: 'string',
                        description: 'Issue type (default: "Bug")',
                    },
                    priority: {
                        type: 'string',
                        description: 'Priority level: Highest, High, Medium, Low, Lowest (default: "Medium")',
                    },
                    labels: {
                        type: 'string',
                        description: 'Comma-separated labels (e.g., "automation,regression,uat")',
                    },
                    environment: {
                        type: 'string',
                        description: 'Environment where defect was found (e.g., "UAT", "INT", "PROD")',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Jira base URL extracted from user-provided ticket URLs (e.g., "https://corelogic.atlassian.net"). Overrides JIRA_BASE_URL env var for the returned ticket URL. Extract this from any Jira URL the user pastes — take everything before "/browse/".',
                    },
                    linkedIssueKey: {
                        type: 'string',
                        description: 'Key of an existing Jira issue to link this ticket to (e.g., "AOTF-17250"). Creates a "relates to" link by default. Use this when creating Testing tasks to link them to the parent ticket.',
                    },
                    linkType: {
                        type: 'string',
                        description: 'Jira issue link type name (default: "Relates"). Common values: "Relates", "Blocks", "is tested by". Only used when linkedIssueKey is provided.',
                    },
                    assigneeAccountId: {
                        type: 'string',
                        description: 'Atlassian account ID of the user to assign the ticket to. Get this from the get_jira_current_user tool to assign to yourself.',
                    },
                },
                required: ['summary', 'description'],
            },
            handler: async ({ projectKey, summary, description, issueType, priority, labels, environment, jiraBaseUrl, linkedIssueKey, linkType, assigneeAccountId }) => {
                try {
                    loadEnvVars();
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const baseUrl = process.env.JIRA_BASE_URL;
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    if (!cloudId && !baseUrl) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_BASE_URL or JIRA_CLOUD_ID must be set in agentic-workflow/.env',
                        });
                    }
                    if (!email || !apiToken) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_EMAIL and JIRA_API_TOKEN are required for ticket creation',
                        });
                    }

                    const resolvedProject = projectKey || process.env.JIRA_PROJECT_KEY || 'AOTF';
                    const resolvedType = issueType || 'Bug';
                    const resolvedPriority = priority || 'Medium';

                    // Build issue payload — convert markdown description to ADF for rich Jira rendering
                    const issuePayload = {
                        fields: {
                            project: { key: resolvedProject },
                            summary,
                            description: markdownToAdf(description),
                            issuetype: { name: resolvedType },
                            priority: { name: resolvedPriority },
                        },
                    };

                    // Add optional fields
                    if (labels) {
                        issuePayload.fields.labels = labels.split(',').map(l => l.trim());
                    }
                    if (environment) {
                        issuePayload.fields.environment = markdownToAdf(environment);
                    }
                    if (assigneeAccountId) {
                        issuePayload.fields.assignee = { accountId: assigneeAccountId };
                    }

                    // Build URL
                    let url;
                    if (cloudId) {
                        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`;
                    } else {
                        url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`;
                    }

                    const headers = {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
                    };

                    const response = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(issuePayload),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        return JSON.stringify({
                            success: false,
                            error: `Failed to create ticket: HTTP ${response.status}`,
                            details: errorBody,
                            hint: 'Verify JIRA_EMAIL and JIRA_API_TOKEN have write permissions',
                        });
                    }

                    const data = await response.json();
                    const ticketKey = data.key;

                    // URL priority: jiraBaseUrl (user input) → JIRA_BASE_URL (env) → JIRA_SITE_NAME construct
                    // URL priority: jiraBaseUrl (user input) → JIRA_BASE_URL (env) → JIRA_SITE_NAME construct
                    const resolvedBaseUrl = (jiraBaseUrl || baseUrl || '').replace(/\/+$/, '');
                    const ticketUrl = resolvedBaseUrl
                        ? `${resolvedBaseUrl}/browse/${ticketKey}`
                        : `https://${process.env.JIRA_SITE_NAME || 'jira'}.atlassian.net/browse/${ticketKey}`;

                    // ── Issue Linking: Link new ticket to a parent/related ticket ──
                    let linkResult = null;
                    if (linkedIssueKey) {
                        try {
                            const linkApiUrl = cloudId
                                ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLink`
                                : `${baseUrl.replace(/\/$/, '')}/rest/api/3/issueLink`;

                            const resolvedLinkType = linkType || 'Relates';
                            const linkPayload = {
                                type: { name: resolvedLinkType },
                                inwardIssue: { key: ticketKey },
                                outwardIssue: { key: linkedIssueKey },
                            };

                            const linkResp = await fetch(linkApiUrl, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify(linkPayload),
                            });

                            if (linkResp.ok || linkResp.status === 201) {
                                linkResult = { success: true, linkedTo: linkedIssueKey, linkType: resolvedLinkType };
                            } else {
                                const linkErr = await linkResp.text();
                                linkResult = { success: false, error: `Link failed: HTTP ${linkResp.status}`, details: linkErr };
                            }
                        } catch (linkError) {
                            linkResult = { success: false, error: `Link error: ${linkError.message}` };
                        }
                    }

                    return JSON.stringify({
                        success: true,
                        ticketKey,
                        ticketId: data.id,
                        ticketUrl,
                        summary,
                        issueType: resolvedType,
                        priority: resolvedPriority,
                        project: resolvedProject,
                        assignee: assigneeAccountId ? { accountId: assigneeAccountId } : undefined,
                        link: linkResult || undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira creation error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b: attach_session_images_to_jira
    // Available to: buggenie
    // Attaches images from the current chat session to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('attach_session_images_to_jira', {
            description:
                'Attaches images from the current chat session to an existing Jira ticket. ' +
                'When the user provided screenshots/images earlier in the conversation and then approved bug ticket creation, ' +
                'call this tool AFTER creating the ticket to attach those images. ' +
                'The tool reads stored session attachments and uploads them to Jira via the REST API. ' +
                'ALWAYS call this after create_jira_ticket if the user provided images in the chat.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach images to (e.g., "AOTF-17300")',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve stored attachments from. Use the current session ID.',
                    },
                },
                required: ['ticketKey'],
            },
            handler: async ({ ticketKey, sessionId }) => {
                try {
                    loadEnvVars();
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const baseUrl = process.env.JIRA_BASE_URL;
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    if (!email || !apiToken) {
                        return JSON.stringify({ success: false, error: 'JIRA_EMAIL and JIRA_API_TOKEN required' });
                    }

                    // Access session attachments via the deps closure
                    const chatManager = deps.chatManager;
                    let attachments = [];
                    if (chatManager && sessionId) {
                        const entry = chatManager._sessions?.get(sessionId);
                        if (entry?.sessionAttachments?.length > 0) {
                            attachments = entry.sessionAttachments;
                        }
                    }

                    if (attachments.length === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'No images found in the current session. The user may not have attached any screenshots.',
                        });
                    }

                    // Build Jira attachment upload URL
                    let attachUrl;
                    if (cloudId) {
                        attachUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${ticketKey}/attachments`;
                    } else {
                        attachUrl = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${ticketKey}/attachments`;
                    }

                    const results = [];
                    for (let i = 0; i < attachments.length; i++) {
                        const att = attachments[i];
                        const ext = att.media_type === 'image/png' ? '.png' :
                            att.media_type === 'image/jpeg' ? '.jpg' :
                                att.media_type === 'image/gif' ? '.gif' :
                                    att.media_type === 'image/webp' ? '.webp' : '.png';
                        const fileName = `bug-screenshot-${i + 1}${ext}`;

                        try {
                            const buffer = Buffer.from(att.data, 'base64');
                            const boundary = `----JiraAttachment${Date.now()}${i}`;
                            const header = Buffer.from(
                                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${att.media_type || 'image/png'}\r\n\r\n`
                            );
                            const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
                            const body = Buffer.concat([header, buffer, footer]);

                            const resp = await fetch(attachUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
                                    'X-Atlassian-Token': 'no-check',
                                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                                },
                                body,
                            });

                            if (resp.ok) {
                                results.push({ fileName, success: true });
                            } else {
                                const errText = await resp.text();
                                results.push({ fileName, success: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
                            }
                        } catch (uploadErr) {
                            results.push({ fileName, success: false, error: uploadErr.message });
                        }
                    }

                    const successCount = results.filter(r => r.success).length;
                    return JSON.stringify({
                        success: successCount > 0,
                        ticketKey,
                        totalAttachments: attachments.length,
                        uploaded: successCount,
                        failed: attachments.length - successCount,
                        results,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Attachment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11c: update_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('update_jira_ticket', {
            description:
                'Updates an existing Jira ticket via the Atlassian REST API. ' +
                'Can update summary, description, labels, priority, or add comments. ' +
                'Use this when the user asks to edit, update, or modify an existing Jira ticket.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to update (e.g., "AOTF-17250")',
                    },
                    summary: {
                        type: 'string',
                        description: 'New summary/title for the ticket (optional \u2014 only if changing title)',
                    },
                    description: {
                        type: 'string',
                        description: 'New description for the ticket in markdown format (optional). Supports bold, tables, headings, lists \u2014 automatically converted to Jira ADF.',
                    },
                    comment: {
                        type: 'string',
                        description: 'Add a comment to the ticket (optional). Supports markdown formatting.',
                    },
                    priority: {
                        type: 'string',
                        description: 'New priority: Highest, High, Medium, Low, Lowest (optional)',
                    },
                    labels: {
                        type: 'string',
                        description: 'Comma-separated labels to SET on the ticket (replaces existing labels). Optional.',
                    },
                    addLabels: {
                        type: 'string',
                        description: 'Comma-separated labels to ADD to existing labels (without removing current ones). Optional.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Jira base URL extracted from user-provided ticket URLs. Overrides JIRA_BASE_URL env var for the returned ticket URL.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, summary, description, comment, priority, labels, addLabels, jiraBaseUrl }) => {
                try {
                    loadEnvVars();
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const baseUrl = process.env.JIRA_BASE_URL;
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    if (!cloudId && !baseUrl) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_BASE_URL or JIRA_CLOUD_ID must be set in agentic-workflow/.env',
                        });
                    }
                    if (!email || !apiToken) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_EMAIL and JIRA_API_TOKEN are required for ticket updates',
                        });
                    }

                    const headers = {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
                    };

                    const apiBase = cloudId
                        ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
                        : `${baseUrl.replace(/\/$/, '')}/rest/api/3`;

                    const results = { updated: [], errors: [] };

                    // \u2500\u2500 Update issue fields (summary, description, priority, labels) \u2500\u2500
                    const fieldsUpdate = {};
                    if (summary) fieldsUpdate.summary = summary;
                    if (description) fieldsUpdate.description = markdownToAdf(description);
                    if (priority) fieldsUpdate.priority = { name: priority };
                    if (labels) fieldsUpdate.labels = labels.split(',').map(l => l.trim());

                    if (Object.keys(fieldsUpdate).length > 0) {
                        const updateUrl = `${apiBase}/issue/${ticketId}`;
                        const updateResp = await fetch(updateUrl, {
                            method: 'PUT',
                            headers,
                            body: JSON.stringify({ fields: fieldsUpdate }),
                        });
                        if (!updateResp.ok) {
                            const errBody = await updateResp.text();
                            results.errors.push(`Field update failed: HTTP ${updateResp.status} \u2014 ${errBody}`);
                        } else {
                            results.updated.push('fields');
                        }
                    }

                    // \u2500\u2500 Add labels without removing existing ones \u2500\u2500
                    if (addLabels) {
                        const addUrl = `${apiBase}/issue/${ticketId}`;
                        const addResp = await fetch(addUrl, {
                            method: 'PUT',
                            headers,
                            body: JSON.stringify({
                                update: {
                                    labels: addLabels.split(',').map(l => ({ add: l.trim() })),
                                },
                            }),
                        });
                        if (!addResp.ok) {
                            const errBody = await addResp.text();
                            results.errors.push(`Add labels failed: HTTP ${addResp.status} \u2014 ${errBody}`);
                        } else {
                            results.updated.push('labels-added');
                        }
                    }

                    // \u2500\u2500 Add comment \u2500\u2500
                    if (comment) {
                        const commentUrl = `${apiBase}/issue/${ticketId}/comment`;
                        const commentResp = await fetch(commentUrl, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ body: markdownToAdf(comment) }),
                        });
                        if (!commentResp.ok) {
                            const errBody = await commentResp.text();
                            results.errors.push(`Comment failed: HTTP ${commentResp.status} \u2014 ${errBody}`);
                        } else {
                            results.updated.push('comment');
                        }
                    }

                    // Build ticket URL
                    const resolvedBaseUrl = (jiraBaseUrl || baseUrl || '').replace(/\/+$/, '');
                    const ticketUrl = resolvedBaseUrl
                        ? `${resolvedBaseUrl}/browse/${ticketId}`
                        : `https://${process.env.JIRA_SITE_NAME || 'jira'}.atlassian.net/browse/${ticketId}`;

                    if (results.errors.length > 0 && results.updated.length === 0) {
                        return JSON.stringify({
                            success: false,
                            ticketId,
                            ticketUrl,
                            errors: results.errors,
                            hint: 'Verify JIRA_EMAIL and JIRA_API_TOKEN have write permissions for this ticket',
                        }, null, 2);
                    }

                    return JSON.stringify({
                        success: true,
                        ticketId,
                        ticketUrl,
                        updated: results.updated,
                        errors: results.errors.length > 0 ? results.errors : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira update error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12: generate_test_case_excel
    // Available to: testgenie
    // ───────────────────────────────────────────────────────────────────
    if (['testgenie'].includes(agentName)) {
        tools.push(defineTool('generate_test_case_excel', {
            description:
                'Generates a test case Excel file from structured test case data. ' +
                'Takes ticket ID, test suite name, pre-conditions, and an array of test steps, ' +
                'then creates an .xlsx file in agentic-workflow/test-cases/.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                    testSuiteName: {
                        type: 'string',
                        description: 'Name of the test suite (e.g., "Consumer - Travel Time Edit Dropdown")',
                    },
                    preConditions: {
                        type: 'string',
                        description: 'Pre-conditions text (e.g., "1: For Consumer: User is authenticated")',
                    },
                    testSteps: {
                        type: 'string',
                        description: 'JSON array string of test step objects with fields: stepId, action, expected, actual',
                    },
                },
                required: ['ticketId', 'testSuiteName', 'testSteps'],
            },
            handler: async ({ ticketId, testSuiteName, preConditions, testSteps }) => {
                try {
                    let steps;
                    try {
                        steps = JSON.parse(testSteps);
                    } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid testSteps JSON: ${e.message}` });
                    }

                    // Try using the excel-template-generator script
                    const generatorPath = path.join(__dirname, '..', 'scripts', 'excel-template-generator.js');
                    if (fs.existsSync(generatorPath)) {
                        try {
                            const generator = require(generatorPath);
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) {
                                fs.mkdirSync(outputDir, { recursive: true });
                            }

                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);

                            // The generator exports generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath)
                            // where jiraInfo = { number, title, url } and testCases = [{ id, title, steps: [...] }]
                            if (typeof generator.generateTestCaseExcel === 'function') {
                                // Build the jiraInfo shape the generator expects
                                const jiraInfo = {
                                    number: ticketId,
                                    title: testSuiteName,
                                    url: `${(process.env.JIRA_BASE_URL || 'https://jira.atlassian.net/').replace(/\/+$/, '')}/browse/${ticketId}`,
                                };

                                // Convert flat steps array into the testCases shape the generator expects
                                // Input steps: [{ stepId, action, expected, actual }]
                                // Generator expects: [{ id, title, steps: [{ id, action, expected, actual }] }]
                                const testCases = [{
                                    id: 'TC-01',
                                    title: testSuiteName,
                                    steps: steps.map(s => ({
                                        id: s.stepId || s.id || '',
                                        action: s.action || s.activity || '',
                                        expected: s.expected || s.expectedResult || '',
                                        actual: s.actual || s.actualResults || s.actualResult || '',
                                    })),
                                }];

                                await generator.generateTestCaseExcel(
                                    jiraInfo,
                                    preConditions || '',
                                    testCases,
                                    outputPath,
                                );
                            } else if (typeof generator.generateExcel === 'function') {
                                // Legacy fallback if export name changes back
                                await generator.generateExcel({
                                    ticketId,
                                    testSuiteName,
                                    preConditions: preConditions || '',
                                    testSteps: steps,
                                    outputPath,
                                });
                            } else {
                                // Generator module has unexpected export — create simple Excel via fallback
                                await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            }

                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel file created: ${path.basename(outputPath)}`,
                            });
                        } catch (genError) {
                            // Fall back to simple Excel creation
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                            await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel created (fallback): ${path.basename(outputPath)}`,
                                warning: `Generator error: ${genError.message}`,
                            });
                        }
                    }

                    // No generator script — create simple CSV-style output
                    const outputDir = path.join(__dirname, '..', 'test-cases');
                    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                    const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                    await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);

                    return JSON.stringify({
                        success: true,
                        path: outputPath,
                        stepCount: steps.length,
                        message: `Excel created: ${path.basename(outputPath)}`,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Excel generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12c: find_test_files
    // Available to: scriptgenerator, codereviewer
    // Recursively searches the workspace for test files/folders by name,
    // ticket ID, or keyword. Use BEFORE execute_test when the user gives
    // a partial name instead of a full path.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('find_test_files', {
            description:
                'Search the workspace for test spec files and folders by name, ticket ID, or keyword. ' +
                'Recursively scans tests/specs/, tests-scratch/specs/, and any configured spec directories. ' +
                'Use this BEFORE execute_test when the user provides a partial name (e.g., "planner", ' +
                '"AOTF-16337", "notes", "profile") instead of a full path. Returns matching file/folder paths.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search term — file name, folder name, ticket ID, or keyword (case-insensitive)',
                    },
                    type: {
                        type: 'string',
                        enum: ['file', 'folder', 'both'],
                        description: 'Filter results by type (default: "both")',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, type: filterType }) => {
                const projectRoot = path.join(__dirname, '..', '..');
                const searchType = filterType || 'both';
                const results = [];

                // Directories to search
                const searchDirs = [
                    path.join(projectRoot, 'tests', 'specs'),
                    path.join(projectRoot, 'tests-scratch', 'specs'),
                ];

                // Also check workflow config for additional spec directories
                try {
                    const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
                    if (fs.existsSync(configPath)) {
                        const wfConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                        const specDir = wfConfig?.projectPaths?.specsDir;
                        if (specDir) {
                            const resolved = path.isAbsolute(specDir) ? specDir : path.join(projectRoot, specDir);
                            if (!searchDirs.includes(resolved)) searchDirs.push(resolved);
                        }
                    }
                } catch { /* ignore config read errors */ }

                const queryLower = query.toLowerCase();

                function scanDir(dir, depth = 0) {
                    if (depth > 5 || !fs.existsSync(dir)) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const entryPath = path.join(dir, entry.name);
                            const nameLower = entry.name.toLowerCase();
                            const matches = nameLower.includes(queryLower);

                            if (entry.isDirectory()) {
                                if (matches && (searchType === 'folder' || searchType === 'both')) {
                                    // Count .spec.js files inside matching folder
                                    const specFiles = _countSpecFiles(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'folder',
                                        specFileCount: specFiles,
                                    });
                                }
                                // Always recurse into subdirectories
                                scanDir(entryPath, depth + 1);
                            } else if (entry.isFile()) {
                                if (matches && (searchType === 'file' || searchType === 'both')) {
                                    const stats = fs.statSync(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'file',
                                        size: stats.size,
                                        modified: stats.mtime.toISOString(),
                                        isSpec: entry.name.endsWith('.spec.js'),
                                    });
                                }
                            }
                        }
                    } catch { /* permission errors */ }
                }

                for (const dir of searchDirs) {
                    scanDir(dir);
                }

                return JSON.stringify({
                    success: true,
                    query,
                    matchCount: results.length,
                    results: results.slice(0, 50), // Cap at 50 results
                    searchedDirectories: searchDirs.map(d => path.relative(projectRoot, d).replace(/\\/g, '/')),
                }, null, 2);
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12b: execute_test
    // Available to: scriptgenerator, codereviewer
    // Runs a Playwright .spec.js file and saves raw JSON results for the
    // Reports dashboard. This is the ONLY way for AI Chat to execute tests.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('execute_test', {
            description:
                'Execute a Playwright .spec.js test file and return structured results. ' +
                'Runs `npx playwright test` with JSON reporter, saves raw results to ' +
                'test-artifacts/reports/ for the Reports dashboard, and returns a summary ' +
                'with pass/fail counts, failed test names, and error details. ' +
                'Use this after generating or modifying a test script to validate it works.',
            parameters: {
                type: 'object',
                properties: {
                    specPath: {
                        type: 'string',
                        description: 'Path to a .spec.js file OR a folder containing spec files (absolute or relative to workspace root). Can also be a keyword like "planner" or "notes" — auto-discovery will find it.',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., AOTF-16461) for labeling the report. If omitted, derived from the folder name.',
                    },
                },
                required: ['specPath'],
            },
            handler: async ({ specPath, ticketId }) => {
                const { execSync } = require('child_process');
                const projectRoot = path.join(__dirname, '..', '..');

                // Resolve spec path
                let resolvedSpec = path.isAbsolute(specPath)
                    ? specPath
                    : path.join(projectRoot, specPath);

                let isDirectory = false;

                // ── Auto-discovery: if not found, search by name ──
                if (!fs.existsSync(resolvedSpec)) {
                    const searchName = path.basename(specPath).toLowerCase();
                    const searchDirs = [
                        path.join(projectRoot, 'tests', 'specs'),
                        path.join(projectRoot, 'tests-scratch', 'specs'),
                    ];
                    const folderMatches = [];
                    const fileMatches = [];

                    function searchRecursive(dir, depth = 0) {
                        if (depth > 5 || !fs.existsSync(dir)) return;
                        try {
                            const entries = fs.readdirSync(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                const entryPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    if (entry.name.toLowerCase().includes(searchName)) {
                                        // Record the FOLDER itself — do NOT expand to individual files
                                        const specCount = _countSpecFiles(entryPath);
                                        if (specCount > 0) {
                                            folderMatches.push({ path: entryPath, specCount });
                                        }
                                    }
                                    searchRecursive(entryPath, depth + 1);
                                } else if (entry.isFile() && entry.name.toLowerCase().includes(searchName) && entry.name.endsWith('.spec.js')) {
                                    fileMatches.push(entryPath);
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    for (const dir of searchDirs) {
                        searchRecursive(dir);
                    }

                    // Prefer folder matches over individual file matches
                    if (folderMatches.length === 1) {
                        resolvedSpec = folderMatches[0].path;
                        isDirectory = true;
                    } else if (folderMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple folder matches found for "${specPath}". Please specify which one.`,
                            matches: folderMatches.map(m => ({
                                path: path.relative(projectRoot, m.path).replace(/\\/g, '/'),
                                specCount: m.specCount,
                            })),
                        });
                    } else if (fileMatches.length === 1) {
                        resolvedSpec = fileMatches[0];
                    } else if (fileMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple file matches found for "${specPath}". Please specify the exact file.`,
                            matches: fileMatches.map(m => path.relative(projectRoot, m).replace(/\\/g, '/')),
                        });
                    } else {
                        return JSON.stringify({
                            success: false,
                            error: `Spec file/folder not found: "${specPath}". No matches in tests/specs/ or tests-scratch/specs/.`,
                        });
                    }
                } else {
                    // Path exists — check if it's a directory
                    isDirectory = fs.statSync(resolvedSpec).isDirectory();
                }

                // If it's a directory, verify it has spec files
                if (isDirectory) {
                    const specCount = _countSpecFiles(resolvedSpec);
                    if (specCount === 0) {
                        return JSON.stringify({
                            success: false,
                            error: `Folder "${specPath}" exists but contains no .spec.js files.`,
                        });
                    }
                }

                // Derive ticketId from path if not provided
                let derivedTicketId;
                if (ticketId) {
                    derivedTicketId = ticketId;
                } else if (isDirectory) {
                    // For folders: use the folder name itself (e.g., "planner" → "PLANNER")
                    derivedTicketId = path.basename(resolvedSpec).toUpperCase();
                } else {
                    // For files: use the parent folder name (e.g., "aotf-16461/file.spec.js" → "AOTF-16461")
                    derivedTicketId = path.basename(path.dirname(resolvedSpec)).toUpperCase();
                }
                derivedTicketId = derivedTicketId || 'UNKNOWN';

                const runId = `chat_${derivedTicketId}_${Date.now()}`;

                try {
                    const relativePath = path.relative(projectRoot, resolvedSpec).replace(/\\/g, '/');

                    // For directories, pass directly to Playwright (no regex escaping needed)
                    // For files, escape special chars for Playwright's grep
                    const playwrightTarget = isDirectory
                        ? relativePath
                        : relativePath.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');

                    let output;
                    try {
                        output = execSync(
                            `npx playwright test "${playwrightTarget}" --reporter=json`,
                            {
                                encoding: 'utf-8',
                                stdio: 'pipe',
                                cwd: projectRoot,
                                timeout: 300000,
                            }
                        );
                    } catch (execError) {
                        // Playwright exits non-zero on test failures — capture stdout
                        output = execError.stdout || execError.stderr || execError.message;
                    }

                    // Strip dotenv banner and other non-JSON preamble from stdout
                    const cleanedOutput = output.replace(/^\[dotenv[^\]]*\][^\n]*\n?/gm, '').trim();

                    // Parse JSON from output
                    const { extractJSON: parseJSON } = require('./utils');
                    let playwrightResult;
                    try {
                        playwrightResult = parseJSON(cleanedOutput);
                    } catch {
                        // Could not parse JSON — save raw output as error envelope
                        _saveTestReport(derivedTicketId, runId, resolvedSpec, {
                            rawError: output.substring(0, 50000),
                        });
                        return JSON.stringify({
                            success: false,
                            error: `Playwright output could not be parsed as JSON`,
                            rawOutput: output.substring(0, 2000),
                            reportSaved: true,
                            runId,
                        });
                    }

                    // Extract results
                    const suites = playwrightResult.suites || [];
                    let totalSpecs = 0, passed = 0, failed = 0;
                    const failedTests = [];

                    const walkSuites = (list) => {
                        for (const suite of list) {
                            for (const spec of (suite.specs || [])) {
                                totalSpecs++;
                                const test = spec.tests?.[0];
                                if (test?.status === 'passed' || test?.status === 'expected') {
                                    passed++;
                                } else if (test?.status === 'failed' || test?.status === 'unexpected') {
                                    failed++;
                                    failedTests.push(spec.title);
                                }
                            }
                            if (suite.suites) walkSuites(suite.suites);
                        }
                    };
                    walkSuites(suites);

                    // Save raw report for dashboard
                    _saveTestReport(derivedTicketId, runId, resolvedSpec, playwrightResult);

                    return JSON.stringify({
                        success: failed === 0 && totalSpecs > 0,
                        totalCount: totalSpecs,
                        passedCount: passed,
                        failedCount: failed,
                        failedTests,
                        reportSaved: true,
                        runId,
                        isFolder: isDirectory,
                        message: totalSpecs > 0
                            ? `${passed}/${totalSpecs} tests passed`
                            : 'No tests found in output',
                    });
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: error.message?.substring(0, 1000),
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOLS 13-16: Shared Context Store (Agent Collaboration)
    // Available to: ALL agents (when contextStore is provided)
    // ───────────────────────────────────────────────────────────────────
    if (contextStore) {
        // TOOL 13: write_shared_context
        tools.push(defineTool('write_shared_context', {
            description:
                'Write to the shared context store that persists across agent sessions. ' +
                'Use this to record decisions (with reasoning), constraints discovered, ' +
                'questions for other agents, or general observations. Later agents will ' +
                'see what you wrote and understand WHY you made your choices.',
            parameters: {
                type: 'object',
                properties: {
                    entryType: {
                        type: 'string',
                        description: 'Type: "decision" | "constraint" | "question" | "note"',
                    },
                    content: {
                        type: 'string',
                        description: 'The decision, constraint, question, or note text',
                    },
                    reasoning: {
                        type: 'string',
                        description: 'Why this decision was made (required for decisions)',
                    },
                    targetAgent: {
                        type: 'string',
                        description: 'For questions: which agent should answer (e.g., "testgenie", "scriptgenerator")',
                    },
                    impact: {
                        type: 'string',
                        description: 'For constraints: how this affects downstream agents',
                    },
                },
                required: ['entryType', 'content'],
            },
            handler: async ({ entryType, content, reasoning, targetAgent, impact }) => {
                try {
                    let result;
                    switch (entryType) {
                        case 'decision':
                            result = contextStore.recordDecision(agentName, content, reasoning || '');
                            break;
                        case 'constraint':
                            result = contextStore.recordConstraint(agentName, content, impact || '');
                            break;
                        case 'question':
                            const qId = contextStore.postQuestion(agentName, targetAgent || 'coordinator', content);
                            result = { questionId: qId, status: 'posted' };
                            break;
                        case 'note':
                            result = contextStore.addNote(agentName, content);
                            break;
                        default:
                            return JSON.stringify({ error: `Unknown entry type: ${entryType}` });
                    }
                    return JSON.stringify({ success: true, entryType, result });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 14: read_shared_context
        tools.push(defineTool('read_shared_context', {
            description:
                'Read from the shared context store to understand what previous agents decided, ' +
                'what constraints exist, what artifacts are available, and any pending questions. ' +
                'Use this BEFORE making decisions to understand the full picture.',
            parameters: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'string',
                        description: 'Filter by: "all" | "decisions" | "constraints" | "artifacts" | "questions" | "agent:{name}"',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max entries to return (default: 50)',
                    },
                },
            },
            handler: async ({ filter, limit }) => {
                try {
                    const maxItems = limit || 50;

                    if (filter === 'artifacts') {
                        return JSON.stringify(contextStore.getAllArtifacts(), null, 2);
                    }
                    if (filter === 'questions') {
                        return JSON.stringify(contextStore.getPendingQuestions(), null, 2);
                    }

                    let queryFilter = { limit: maxItems };
                    if (filter === 'decisions') queryFilter.type = 'decision';
                    else if (filter === 'constraints') queryFilter.type = 'constraint';
                    else if (filter?.startsWith('agent:')) queryFilter.agent = filter.split(':')[1];

                    const entries = contextStore.query(queryFilter);
                    return JSON.stringify({
                        count: entries.length,
                        entries,
                        stats: contextStore.getStats(),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 15: register_artifact
        tools.push(defineTool('register_artifact', {
            description:
                'Register an artifact (file output) in the shared context so other agents can find it. ' +
                'Every file you create should be registered here with a descriptive key.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Artifact key: "testCases" | "exploration" | "specFile" | "bugTicket" | custom',
                    },
                    filePath: {
                        type: 'string',
                        description: 'Absolute or workspace-relative path to the artifact file',
                    },
                    summary: {
                        type: 'string',
                        description: 'Brief description of what the artifact contains',
                    },
                },
                required: ['key', 'filePath'],
            },
            handler: async ({ key, filePath, summary }) => {
                try {
                    contextStore.registerArtifact(agentName, key, filePath, { summary: summary || '' });
                    return JSON.stringify({ success: true, key, path: filePath });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 16: answer_question
        tools.push(defineTool('answer_question', {
            description:
                'Answer a pending question from another agent. Check read_shared_context with ' +
                'filter "questions" to see pending questions directed at you.',
            parameters: {
                type: 'object',
                properties: {
                    questionId: {
                        type: 'string',
                        description: 'The question ID to answer (from read_shared_context)',
                    },
                    answer: {
                        type: 'string',
                        description: 'Your answer to the question',
                    },
                },
                required: ['questionId', 'answer'],
            },
            handler: async ({ questionId, answer }) => {
                try {
                    contextStore.answerQuestion(agentName, questionId, answer);
                    return JSON.stringify({ success: true, questionId });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    // GROUNDING TOOLS (17-20) — Local context search for ALL agents
    // ═══════════════════════════════════════════════════════════════════

    if (groundingStore) {

        // TOOL 17: search_project_context
        tools.push(defineTool('search_project_context', {
            description:
                'Search the local project codebase for relevant code snippets, page objects, ' +
                'business functions, selectors, and utilities using BM25 full-text search. ' +
                'Use this when you need to find existing code, understand how a feature is implemented, ' +
                'or locate selectors/locators for a specific page or component.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query — e.g., "login authentication token", "search filter price beds", "property detail page locators"',
                    },
                    scope: {
                        type: 'string',
                        description: 'Optional scope filter: "pageObject", "businessFunction", "utility", "config", "testData", "exploration", or leave empty for all',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum results to return (default: 8)',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, scope, maxResults }) => {
                try {
                    // Use queryForAgent to apply agent-specific boosts from grounding-config
                    const results = groundingStore.queryForAgent
                        ? groundingStore.queryForAgent(agentName, query, {
                            maxChunks: maxResults || 8,
                            scope: scope || undefined,
                        })
                        : groundingStore.query(query, {
                            maxChunks: maxResults || 8,
                            scope: scope || undefined,
                        });
                    return JSON.stringify({
                        success: true,
                        resultCount: results.length,
                        results: results.map(r => ({
                            filePath: r.filePath,
                            startLine: r.startLine,
                            endLine: r.endLine,
                            type: r.type,
                            score: r.score,
                            matchedTerms: r.matchedTerms,
                            classes: r.metadata?.classes || [],
                            methods: (r.metadata?.methods || []).map(m => m.name),
                            locators: (r.metadata?.locators || []).length,
                            preview: r.content.split('\n').slice(0, 8).join('\n'),
                        })),
                    });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 18: get_feature_map
        tools.push(defineTool('get_feature_map', {
            description:
                'Get detailed information about a specific feature, including its pages, page objects, ' +
                'business functions, test data, and related code snippets. Use this to understand ' +
                'what already exists for a feature before generating new tests or scripts.',
            parameters: {
                type: 'object',
                properties: {
                    featureName: {
                        type: 'string',
                        description: 'The feature name — e.g., "Search", "Login", "Property Details", "Favorites"',
                    },
                },
                required: ['featureName'],
            },
            handler: async ({ featureName }) => {
                try {
                    const context = groundingStore.getFeatureContext(featureName);
                    if (!context) {
                        // List available features
                        const domain = groundingStore.getDomainContext();
                        return JSON.stringify({
                            success: false,
                            message: `Feature "${featureName}" not found in feature map`,
                            availableFeatures: (domain.features || []).map(f => f.name),
                        });
                    }
                    return JSON.stringify({ success: true, feature: context });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 19: get_selector_recommendations
        // Available to: scriptgenerator, codereviewer
        if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
            tools.push(defineTool('get_selector_recommendations', {
                description:
                    'Get recommended selectors for a specific page or element. Returns selectors ' +
                    'ranked by reliability (data-qa > getByRole > aria-label > getByText > css-class > xpath). ' +
                    'Use this to find the most stable selector for an element instead of guessing.',
                parameters: {
                    type: 'object',
                    properties: {
                        pageUrl: {
                            type: 'string',
                            description: 'URL or page identifier — e.g., "/search", "/property/123", "SearchPage"',
                        },
                        elementHint: {
                            type: 'string',
                            description: 'Description of the element — e.g., "search button", "price filter", "login form"',
                        },
                    },
                    required: ['pageUrl'],
                },
                handler: async ({ pageUrl, elementHint }) => {
                    try {
                        const recommendations = groundingStore.getSelectorRecommendations(pageUrl, elementHint);
                        return JSON.stringify({
                            success: true,
                            pageUrl,
                            selectorCount: recommendations.length,
                            selectors: recommendations.slice(0, 15),
                        });
                    } catch (error) {
                        return JSON.stringify({ error: error.message });
                    }
                },
            }));
        }

        // TOOL 20: check_existing_coverage
        // Available to: scriptgenerator, testgenie
        if (['scriptgenerator', 'testgenie'].includes(agentName)) {
            tools.push(defineTool('check_existing_coverage', {
                description:
                    'Check if automation scripts already exist for a specific feature, page, or ticket. ' +
                    'Returns existing spec files and their test names. Use this BEFORE generating new tests ' +
                    'to avoid creating duplicate automation coverage.',
                parameters: {
                    type: 'object',
                    properties: {
                        featureName: {
                            type: 'string',
                            description: 'Feature name to check — e.g., "Search", "Login"',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'Jira ticket ID — e.g., "AOTF-16337"',
                        },
                        pagePath: {
                            type: 'string',
                            description: 'Page URL path — e.g., "/search", "/property"',
                        },
                    },
                },
                handler: async ({ featureName, ticketId, pagePath }) => {
                    try {
                        const coverage = groundingStore.checkExistingCoverage({
                            featureName,
                            ticketId,
                            pagePath,
                        });
                        return JSON.stringify({ success: true, ...coverage });
                    } catch (error) {
                        return JSON.stringify({ error: error.message });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 21: get_snapshot_quality
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'scriptgenerator') {
        tools.push(defineTool('get_snapshot_quality', {
            description:
                'Returns OODA quality assessment data for all MCP snapshots taken in the current session. ' +
                'Shows per-snapshot scores, element counts, role diversity, warnings, and whether ' +
                'script creation is currently allowed. Use this to check if your exploration data ' +
                'is sufficient before creating the .spec.js file.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => {
                try {
                    const { getSnapshotQualityData } = require('./enforcement-hooks');
                    const data = getSnapshotQualityData('scriptgenerator');

                    if (!data) {
                        return JSON.stringify({
                            success: false,
                            message: 'No snapshot data available. Call unified_snapshot first.',
                        });
                    }

                    return JSON.stringify({
                        success: true,
                        totalSnapshots: data.totalSnapshots,
                        qualityAssessed: data.qualityAssessed,
                        summary: data.summary,
                        canCreateSpec: data.canCreateSpec,
                        latestSnapshot: data.latestSnapshot,
                        allSnapshots: data.allSnapshots,
                        guidance: data.canCreateSpec
                            ? 'Script creation is ALLOWED — your latest snapshot passed quality checks.'
                            : 'Script creation is BLOCKED — your latest snapshot scored below the retry threshold. ' +
                            'Wait for the page to fully load, dismiss popups, and call unified_snapshot again.',
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 22: search_knowledge_base
    // Available to: ALL agents
    // Search external KB (Confluence, Notion, SharePoint) for documentation
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore) {
            tools.push(defineTool('search_knowledge_base', {
                description:
                    'Search the external Knowledge Base (Confluence, Notion, SharePoint, etc.) for documentation, ' +
                    'requirements, specifications, business rules, or domain knowledge. Returns ranked results ' +
                    'from configured KB providers. Use when you need context about application features, ' +
                    'acceptance criteria, architecture decisions, or business processes that aren\'t in the codebase.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query — e.g., "property search filters", "login authentication flow", "MLS onboarding"',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum results to return (default: 5)',
                        },
                        spaceKey: {
                            type: 'string',
                            description: 'Optional: restrict search to a specific space/project key',
                        },
                        skipIntentCheck: {
                            type: 'boolean',
                            description: 'Skip intent detection and force a live KB search (default: false). Use when a query returns 0 results but you know KB content exists.',
                        },
                    },
                    required: ['query'],
                },
                handler: async ({ query, maxResults, spaceKey, skipIntentCheck }) => {
                    const toolCache = getToolCache();

                    // Check TTL cache
                    const cacheKey = `kb_search_${query}_${maxResults || 5}_${spaceKey || ''}_${skipIntentCheck || false}`;
                    const cached = toolCache.get(cacheKey);
                    if (cached) return cached;

                    try {
                        let result = await gStore.queryKnowledgeBase(query, {
                            agentName,
                            maxResults: maxResults || 5,
                            spaceKey: spaceKey || undefined,
                            skipIntentCheck: skipIntentCheck || false,
                        });

                        // Auto-retry: if intent detection blocked or returned 0 results,
                        // silently retry once with skipIntentCheck to ensure Confluence is always queried
                        if (!skipIntentCheck && (result.blocked || (result.results.length === 0 && !result.error))) {
                            const retryReason = result.blocked
                                ? `intent blocked (confidence=${result.intent?.confidence?.toFixed(2) || '?'})`
                                : 'zero results with intent pass';
                            console.log(`[KB Tool] Auto-retrying with skipIntentCheck=true: ${retryReason}`);
                            result = await gStore.queryKnowledgeBase(query, {
                                agentName,
                                maxResults: maxResults || 5,
                                spaceKey: spaceKey || undefined,
                                skipIntentCheck: true,
                            });
                            result._autoRetried = true;
                        }

                        if (result.error && result.results.length === 0) {
                            return JSON.stringify({
                                success: false,
                                error: result.error,
                                message: 'Knowledge Base is not configured or unavailable. Check .env for CONFLUENCE_BASE_URL and KB_ENABLED.',
                            });
                        }

                        const response = JSON.stringify({
                            success: true,
                            query,
                            resultCount: result.results.length,
                            fromCache: result.fromCache || false,
                            intent: result.intent ? {
                                confidence: result.intent.confidence,
                                matchedTerms: result.intent.matchedTerms,
                                matchedFeatures: result.intent.matchedFeatures,
                            } : null,
                            results: (result.results || []).map(r => ({
                                title: r.title,
                                excerpt: r.excerpt || r.content?.substring(0, 300) || '',
                                url: r.url,
                                space: r.space,
                                lastModified: r.lastModified,
                                id: r.id,
                                labels: r.metadata?.labels || [],
                            })),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 300000); // 5-min cache
                        return response;
                    } catch (error) {
                        return JSON.stringify({ success: false, error: error.message });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 23: get_knowledge_base_page
    // Available to: ALL agents
    // Fetch full content of a specific KB page by ID
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('get_knowledge_base_page', {
                description:
                    'Fetch the full content of a specific Knowledge Base page by its ID. ' +
                    'Use this after search_knowledge_base to get detailed content of a relevant page. ' +
                    'Also supports fetching a page tree (page with all child pages).',
                parameters: {
                    type: 'object',
                    properties: {
                        pageId: {
                            type: 'string',
                            description: 'Page ID to fetch — obtained from search_knowledge_base results',
                        },
                        includeChildren: {
                            type: 'boolean',
                            description: 'Also fetch child pages (default: false)',
                        },
                        maxDepth: {
                            type: 'number',
                            description: 'Max depth for child page traversal (default: 2)',
                        },
                    },
                    required: ['pageId'],
                },
                handler: async ({ pageId, includeChildren, maxDepth }) => {
                    const toolCache = getToolCache();

                    const cacheKey = `kb_page_${pageId}_${includeChildren || false}`;
                    const cached = toolCache.get(cacheKey);
                    if (cached) return cached;

                    try {
                        const connector = gStore._kbConnector;
                        let pages;

                        if (includeChildren) {
                            pages = await connector.getPageTree(pageId, {
                                depth: maxDepth || 2,
                            });
                        } else {
                            const page = await connector.getPage(pageId);
                            pages = page ? [page] : [];
                        }

                        if (pages.length === 0) {
                            return JSON.stringify({
                                success: false,
                                error: `Page ${pageId} not found`,
                            });
                        }

                        const response = JSON.stringify({
                            success: true,
                            pageCount: pages.length,
                            pages: pages.map(p => ({
                                id: p.id,
                                title: p.title,
                                content: p.content?.substring(0, 8000) || '',
                                url: p.url,
                                space: p.space,
                                lastModified: p.lastModified,
                                labels: p.metadata?.labels || [],
                                author: p.metadata?.author || '',
                            })),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 600000); // 10-min cache
                        return response;
                    } catch (error) {
                        return JSON.stringify({ success: false, error: error.message });
                    }
                },
            }));
        }
    }

    return tools;
}

function formatJiraTicket(data, ticketId) {
    const fields = data.fields || {};
    const rendered = data.renderedFields || {};

    return {
        success: true,
        ticketId,
        key: data.key || ticketId,
        summary: fields.summary || '',
        status: fields.status?.name || '',
        issueType: fields.issuetype?.name || '',
        priority: fields.priority?.name || '',
        labels: fields.labels || [],
        components: (fields.components || []).map(c => c.name),
        assignee: fields.assignee?.displayName || '',
        reporter: fields.reporter?.displayName || '',
        description: rendered.description || fields.description?.content?.map(
            block => block.content?.map(c => c.text).join('')
        ).join('\n') || fields.description || '',
        acceptanceCriteria: fields.customfield_10037 || fields.customfield_10038 ||
            rendered.customfield_10037 || rendered.customfield_10038 || '',
        storyPoints: fields.story_points || fields.customfield_10016 || null,
        sprint: fields.sprint?.name || '',
        created: fields.created || '',
        updated: fields.updated || '',
    };
}

// ─── Helper: Create simple Excel file ───────────────────────────────────────
async function createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps) {
    try {
        // Try ExcelJS first (common dependency)
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Test Cases');

        // Header info
        sheet.addRow(['Ticket ID', ticketId]);
        sheet.addRow(['Test Suite', testSuiteName]);
        sheet.addRow(['Pre-Conditions', preConditions || '']);
        sheet.addRow([]);

        // Table header
        const headerRow = sheet.addRow(['Test Step ID', 'Specific Activity or Action', 'Expected Results', 'Actual Results']);
        headerRow.font = { bold: true };

        // Data rows
        for (const step of steps) {
            sheet.addRow([
                step.stepId || step.id || '',
                step.action || step.specificActivity || '',
                step.expected || step.expectedResults || '',
                step.actual || step.actualResults || '',
            ]);
        }

        // Auto-width columns
        sheet.columns.forEach(col => {
            let maxLen = 10;
            col.eachCell(cell => {
                const len = cell.value ? String(cell.value).length : 0;
                if (len > maxLen) maxLen = Math.min(len, 80);
            });
            col.width = maxLen + 2;
        });

        await workbook.xlsx.writeFile(outputPath);
    } catch {
        // ExcelJS not available — write as tab-separated text with .xlsx extension
        const lines = [
            `Ticket ID\t${ticketId}`,
            `Test Suite\t${testSuiteName}`,
            `Pre-Conditions\t${preConditions || ''}`,
            '',
            'Test Step ID\tSpecific Activity or Action\tExpected Results\tActual Results',
            ...steps.map(s =>
                `${s.stepId || s.id || ''}\t${s.action || s.specificActivity || ''}\t${s.expected || s.expectedResults || ''}\t${s.actual || s.actualResults || ''}`
            ),
        ];
        fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    }
}

// ─── Helper: Save raw test report for Reports dashboard ─────────────────────
function _saveTestReport(ticketId, runId, specPath, playwrightResult) {
    try {
        const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const fileName = `${ticketId}-${runId}-test-results.json`;
        const filePath = path.join(reportsDir, fileName);
        const payload = {
            ticketId,
            runId,
            mode: 'chat',
            specPath: specPath || null,
            timestamp: new Date().toISOString(),
            playwrightResult,
        };
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');

        // ── Emit REPORT_SAVED event for real-time dashboard updates ──
        try {
            const { getEventBridge, EVENT_TYPES } = require('./event-bridge');
            const eventBridge = getEventBridge();
            eventBridge.push(EVENT_TYPES.REPORT_SAVED, runId, {
                ticketId,
                fileName,
                filePath,
                timestamp: payload.timestamp,
            });
        } catch { /* EventBridge not available — non-critical */ }

        return filePath;
    } catch {
        return null;
    }
}

// ─── Helper: Count .spec.js files inside a directory ─────────────────────────
function _countSpecFiles(dir) {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.spec.js')) count++;
            else if (entry.isDirectory()) count += _countSpecFiles(path.join(dir, entry.name));
        }
    } catch { /* ignore */ }
    return count;
}

module.exports = { createCustomTools, getToolCache };
