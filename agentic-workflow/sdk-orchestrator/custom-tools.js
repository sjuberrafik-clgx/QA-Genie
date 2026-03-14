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
const crypto = require('crypto');
const { markdownToAdf } = require('./adf-converter');

// ─── Environment loader ─────────────────────────────────────────────────────
function loadEnvVars() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
    } catch { /* dotenv not installed */ }
}

const VALID_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VALID_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']);
const JIRA_TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function resolveActiveSessionId(explicitSessionId, deps) {
    if (isNonEmptyString(explicitSessionId)) return explicitSessionId.trim();
    if (isNonEmptyString(deps?.sessionContext?.sessionId)) return deps.sessionContext.sessionId.trim();
    return null;
}

function getActiveSessionEntry(explicitSessionId, deps) {
    const chatManager = deps?.chatManager;
    if (!chatManager) {
        return {
            error: 'Chat manager context not available. Call this tool from an active chat session.',
        };
    }

    const sessionId = resolveActiveSessionId(explicitSessionId, deps);
    if (!sessionId) {
        return {
            error: 'No active chat session could be resolved. Call this tool from the same chat session where the attachments were uploaded.',
        };
    }

    const entry = chatManager._sessions?.get(sessionId);
    if (!entry) {
        return {
            error: `Chat session not found: ${sessionId}`,
        };
    }

    return { sessionId, entry };
}

function isValidTicketKey(ticketKey) {
    return JIRA_TICKET_KEY_PATTERN.test(String(ticketKey || '').trim());
}

function getJiraAttachmentConfig() {
    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '').trim();
    const baseUrl = (process.env.JIRA_BASE_URL || '').trim();
    const email = (process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '').trim();
    const apiToken = (process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '').trim();

    if (!cloudId && !baseUrl) {
        return { error: 'JIRA_BASE_URL or JIRA_CLOUD_ID is required for Jira attachments.' };
    }
    if (!email || !apiToken) {
        return { error: 'JIRA_EMAIL and JIRA_API_TOKEN are required for Jira attachments.' };
    }

    return { cloudId, baseUrl, email, apiToken };
}

function buildJiraAttachmentUrl(ticketKey, jiraConfig) {
    if (jiraConfig.cloudId) {
        return `https://api.atlassian.com/ex/jira/${jiraConfig.cloudId}/rest/api/3/issue/${ticketKey}/attachments`;
    }
    return `${jiraConfig.baseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${ticketKey}/attachments`;
}

function sanitizeFileName(fileName) {
    return String(fileName || 'attachment')
        .replace(/[\r\n"]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildMultipartPayload(fileName, mimeType, buffer, boundaryPrefix) {
    const boundary = `----${boundaryPrefix}${crypto.randomBytes(16).toString('hex')}`;
    const safeFileName = sanitizeFileName(fileName);
    const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

    return {
        boundary,
        body: Buffer.concat([header, buffer, footer]),
    };
}

function getImageMimeTypeForFile(filePath) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return null;
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

    tools.push(defineTool('publish_image_to_chat', {
        description:
            'Publish a local image file into the active chat as an assistant message. ' +
            'Use this after taking a screenshot or generating an image artifact when the user asked to see proof inline in chat. ' +
            'Provide a short caption such as the MLS name or validation result.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or workspace-relative path to an image file (png, jpg, jpeg, gif, webp).',
                },
                caption: {
                    type: 'string',
                    description: 'Optional text shown above the image in the assistant message.',
                },
                altText: {
                    type: 'string',
                    description: 'Optional alt text for the image.',
                },
                sessionId: {
                    type: 'string',
                    description: 'Optional chat session ID. Defaults to the current active session.',
                },
            },
            required: ['filePath'],
        },
        handler: async ({ filePath, caption, altText, sessionId }) => {
            try {
                const sessionResult = getActiveSessionEntry(sessionId, deps);
                if (sessionResult.error) {
                    return JSON.stringify({ success: false, error: sessionResult.error });
                }

                const rawPath = String(filePath || '').trim();
                const resolvedPath = path.isAbsolute(rawPath)
                    ? rawPath
                    : path.join(__dirname, '..', '..', rawPath);

                if (!fs.existsSync(resolvedPath)) {
                    return JSON.stringify({ success: false, error: `Image file not found: ${resolvedPath}` });
                }

                const mimeType = getImageMimeTypeForFile(resolvedPath);
                if (!mimeType || !VALID_IMAGE_MIME_TYPES.has(mimeType)) {
                    return JSON.stringify({
                        success: false,
                        error: 'Unsupported image file. Supported extensions: .png, .jpg, .jpeg, .gif, .webp',
                    });
                }

                const publishResult = deps.chatManager.publishAssistantImage(sessionResult.sessionId, {
                    filePath: resolvedPath,
                    caption,
                    altText,
                });

                return JSON.stringify({
                    success: true,
                    sessionId: sessionResult.sessionId,
                    messageId: publishResult.messageId,
                    filePath: resolvedPath,
                    attachment: {
                        name: publishResult.attachment.name,
                        type: publishResult.attachment.type,
                        size: publishResult.attachment.size,
                    },
                }, null, 2);
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

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
                    // Broadcast progress: starting validation
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('validate_generated_script', {
                            phase: 'validation', message: `Validating ${path.basename(scriptPath || '')}...`, step: 1,
                        });
                    }
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
                // Broadcast progress: running gate
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('run_quality_gate', {
                        phase: 'quality_gate', message: `Running ${gate} quality gate...`, step: 1,
                    });
                }
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
                    // Broadcast progress: starting
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                            phase: 'jira', message: `Fetching ticket ${ticketId} from Jira API...`, step: 1,
                        });
                    }
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
                    // Broadcast progress: parsing complete
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                            phase: 'jira', message: `Ticket ${ticketId} fetched — parsing fields...`, step: 2,
                        });
                    }
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
                    // Broadcast progress: starting
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: 'Preparing Jira ticket payload...', step: 1,
                        });
                    }
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

                    // Broadcast progress: creating
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: `Creating ${issueType || 'Bug'} ticket in Jira...`, step: 2,
                        });
                    }

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

                    // Broadcast progress: ticket created
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: `Ticket ${ticketKey} created${linkedIssueKey ? ' — linking issues...' : ''}`, step: 3,
                        });
                    }

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
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    const attachments = Array.isArray(sessionResult.entry.sessionAttachments)
                        ? sessionResult.entry.sessionAttachments
                        : [];

                    if (attachments.length === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'No images found in the current session. The user may not have attached any screenshots.',
                        });
                    }

                    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);

                    const results = [];
                    for (let i = 0; i < attachments.length; i++) {
                        const att = attachments[i];
                        const mimeType = VALID_IMAGE_MIME_TYPES.has(att?.media_type) ? att.media_type : 'image/png';
                        const ext = mimeType === 'image/png' ? '.png' :
                            mimeType === 'image/jpeg' ? '.jpg' :
                                mimeType === 'image/gif' ? '.gif' : '.webp';
                        const fileName = `bug-screenshot-${i + 1}${ext}`;

                        if (!isNonEmptyString(att?.data)) {
                            results.push({ fileName, success: false, error: 'Attachment data is missing or invalid.' });
                            continue;
                        }

                        try {
                            const buffer = Buffer.from(att.data, 'base64');
                            if (!buffer.length) {
                                results.push({ fileName, success: false, error: 'Attachment data decoded to an empty file.' });
                                continue;
                            }

                            const { boundary, body } = buildMultipartPayload(fileName, mimeType, buffer, 'JiraAttachment');

                            const resp = await fetch(attachUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': 'Basic ' + Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64'),
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
                        sessionId: sessionResult.sessionId,
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
    // TOOL 11b2: analyze_video_recording
    // Available to: buggenie
    // Extracts frames from uploaded video and provides structured context
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('analyze_video_recording', {
            description:
                'Analyzes a screen recording video from the current chat session. ' +
                'Extracts key frames using ffmpeg, returns video metadata and frame information. ' +
                'The extracted frames are automatically attached as images for vision analysis. ' +
                'Call this when the user mentions they have uploaded a video/recording of a bug.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve video context from. Use the current session ID.',
                    },
                },
                required: [],
            },
            handler: async ({ sessionId }) => {
                try {
                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    const videoCtx = sessionResult.entry.videoContext;

                    if (!videoCtx || videoCtx.length === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'No video recordings found in the current session. The user may not have uploaded a video yet.',
                        });
                    }

                    // Return info for all videos in the session
                    const results = videoCtx.map(v => ({
                        filename: v.filename,
                        duration: `${v.duration}s`,
                        frameCount: v.frameCount,
                        resolution: v.metadata ? `${v.metadata.width}x${v.metadata.height}` : 'unknown',
                        codec: v.metadata?.codec || 'unknown',
                        frames: v.frames.map(f => ({
                            timestamp: `${f.timestamp}s`,
                            path: f.path,
                        })),
                    }));

                    return JSON.stringify({
                        success: true,
                        sessionId: sessionResult.sessionId,
                        videoCount: results.length,
                        videos: results,
                        instructions: 'The video frames are attached as images in chronological order. '
                            + 'Analyze them to identify: (1) the user flow/steps, (2) where the defect manifests, '
                            + '(3) expected vs actual behavior, (4) timestamps of key moments.',
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video analysis error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b3: attach_video_frames_to_jira
    // Available to: buggenie
    // Attaches key video frames to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('attach_video_frames_to_jira', {
            description:
                'Attaches key video frames from a screen recording to a Jira ticket. ' +
                'Uploads the most important frames (timestamps where bugs are visible) as JPEG images. ' +
                'Call this after creating a bug ticket when the user provided a video recording.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach frames to (e.g., "AOTF-17300")',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve video frames from.',
                    },
                    frameTimestamps: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Optional: specific frame timestamps (in seconds) to attach. If omitted, attaches up to 8 evenly-spaced frames.',
                    },
                },
                required: ['ticketKey'],
            },
            handler: async ({ ticketKey, sessionId, frameTimestamps }) => {
                try {
                    loadEnvVars();
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    const videoCtx = sessionResult.entry.videoContext;

                    if (!videoCtx || videoCtx.length === 0) {
                        return JSON.stringify({ success: false, error: 'No video recordings found in session' });
                    }

                    // Collect frames to upload
                    const MAX_JIRA_FRAMES = 8;
                    let framesToUpload = [];

                    for (const video of videoCtx) {
                        if (frameTimestamps && frameTimestamps.length > 0) {
                            // Upload specific requested timestamps
                            for (const ts of frameTimestamps) {
                                const match = video.frames.find(f => Math.abs(f.timestamp - ts) <= 1);
                                if (match) framesToUpload.push(match);
                            }
                        } else {
                            // Select up to MAX_JIRA_FRAMES evenly-spaced frames
                            const step = Math.max(1, Math.floor(video.frames.length / MAX_JIRA_FRAMES));
                            for (let i = 0; i < video.frames.length && framesToUpload.length < MAX_JIRA_FRAMES; i += step) {
                                framesToUpload.push(video.frames[i]);
                            }
                        }
                    }

                    framesToUpload = framesToUpload.slice(0, MAX_JIRA_FRAMES);

                    if (framesToUpload.length === 0) {
                        return JSON.stringify({ success: false, error: 'No matching frames found to upload' });
                    }

                    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);

                    const results = [];
                    for (let i = 0; i < framesToUpload.length; i++) {
                        const frame = framesToUpload[i];
                        const fileName = `bug-video-frame-${frame.timestamp}s.jpg`;

                        if (!isNonEmptyString(frame?.path) || !fs.existsSync(frame.path)) {
                            results.push({ fileName, success: false, error: 'Frame file is missing or no longer available.' });
                            continue;
                        }

                        try {
                            const buffer = fs.readFileSync(frame.path);
                            const { boundary, body } = buildMultipartPayload(fileName, 'image/jpeg', buffer, 'JiraVideoFrame');

                            const resp = await fetch(attachUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': 'Basic ' + Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64'),
                                    'X-Atlassian-Token': 'no-check',
                                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                                },
                                body,
                            });

                            if (resp.ok) {
                                results.push({ fileName, timestamp: `${frame.timestamp}s`, success: true });
                            } else {
                                const errText = await resp.text();
                                results.push({ fileName, success: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
                            }
                        } catch (uploadErr) {
                            results.push({ fileName, success: false, error: uploadErr.message });
                        }
                    }

                    const successCount = results.filter(r => r.success).length;

                    // Upload original video recording(s) to Jira if available and under 50 MB
                    const videoRecordings = [];
                    for (const ctx of videoCtx) {
                        if (!isNonEmptyString(ctx?.videoPath)) continue;
                        try {
                            if (!fs.existsSync(ctx.videoPath)) {
                                videoRecordings.push({ fileName: ctx.filename || path.basename(ctx.videoPath), success: false, error: 'Original video file is missing or no longer available.' });
                                continue;
                            }
                            const stat = fs.statSync(ctx.videoPath);
                            if (stat.size > 50 * 1024 * 1024) {
                                videoRecordings.push({ fileName: ctx.filename || path.basename(ctx.videoPath), success: false, error: 'File exceeds 50 MB Jira attachment limit' });
                                continue;
                            }
                            const videoBuf = fs.readFileSync(ctx.videoPath);
                            const videoFileName = ctx.filename || path.basename(ctx.videoPath);
                            const ext = path.extname(videoFileName).toLowerCase();
                            const detectedMimeType = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska' }[ext] || 'application/octet-stream';
                            const mimeType = VALID_VIDEO_MIME_TYPES.has(detectedMimeType) ? detectedMimeType : 'application/octet-stream';
                            const { boundary, body } = buildMultipartPayload(videoFileName, mimeType, videoBuf, 'JiraVideo');

                            const resp = await fetch(attachUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': 'Basic ' + Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64'),
                                    'X-Atlassian-Token': 'no-check',
                                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                                },
                                body,
                            });

                            if (resp.ok) {
                                videoRecordings.push({ fileName: videoFileName, success: true });
                            } else {
                                const errText = await resp.text();
                                videoRecordings.push({ fileName: videoFileName, success: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
                            }
                        } catch (vidErr) {
                            videoRecordings.push({ fileName: ctx.filename || 'unknown', success: false, error: vidErr.message });
                        }
                    }

                    return JSON.stringify({
                        success: successCount > 0 || videoRecordings.some(r => r.success),
                        ticketKey,
                        sessionId: sessionResult.sessionId,
                        totalFrames: framesToUpload.length,
                        uploaded: successCount,
                        failed: framesToUpload.length - successCount,
                        results,
                        videoRecordings: videoRecordings.length > 0 ? videoRecordings : undefined,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video frame attachment error: ${error.message}` });
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
                    // Broadcast progress: starting
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('update_jira_ticket', {
                            phase: 'jira', message: `Updating ticket ${ticketId}...`, step: 1,
                        });
                    }
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
                    // Broadcast progress: parsing
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Parsing test case data for ${ticketId}...`, step: 1,
                        });
                    }
                    let steps;
                    try {
                        steps = JSON.parse(testSteps);
                    } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid testSteps JSON: ${e.message}` });
                    }

                    // Broadcast progress: generating
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Generating Excel workbook (${steps.length} steps)...`, step: 2,
                        });
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

                // Broadcast progress: resolving spec
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('execute_test', {
                        phase: 'test', message: `Resolving test spec: ${specPath}...`, step: 1,
                    });
                }

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

                    // Broadcast progress: running
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test', message: isDirectory
                                ? `Running all specs in ${path.basename(resolvedSpec)}/...`
                                : `Running ${path.basename(resolvedSpec)}...`,
                            step: 2,
                        });
                    }

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

                    // Broadcast progress: results
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: totalSpecs > 0
                                ? `${passed}/${totalSpecs} passed, ${failed} failed`
                                : 'No tests found in output',
                            step: 3,
                        });
                    }

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

                    // Broadcast progress: searching KB
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('search_knowledge_base', {
                            phase: 'kb', message: `Searching knowledge base for "${query.substring(0, 60)}"...`, step: 1,
                        });
                    }

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

    // ─── CONTEXT ENGINEERING TOOLS ──────────────────────────────────────
    // Tools for dynamic context management: mid-session grounding refresh,
    // structured note-taking, and context budget diagnostics.
    // These implement the "just-in-time" retrieval and "structured note-taking"
    // patterns from Anthropic's context engineering research.

    // TOOL CE-1: refresh_grounding_context
    // Enables agents to pull fresh grounding data mid-session when they
    // discover new features/pages not in the initial context injection.
    if (groundingStore && ['scriptgenerator', 'codereviewer'].includes(agentName)) {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('refresh_grounding_context', {
            description:
                'Refresh grounding context mid-session. Call this when you discover the test involves ' +
                'features or pages not present in your initial context. Returns updated code chunks, ' +
                'selectors, and feature map data for the specified feature or query.',
            parameters: {
                type: 'object',
                properties: {
                    feature: {
                        type: 'string',
                        description: 'Feature name to query grounding for (e.g., "Property Search", "Map View", "Favorites")',
                    },
                    query: {
                        type: 'string',
                        description: 'Free-form search query for code context (e.g., "login flow popup handler")',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Ticket ID for exploration freshness check',
                    },
                },
            },
            handler: async ({ feature, query, ticketId }) => {
                try {
                    const refreshed = contextEngine.refreshGroundingContext(
                        groundingStore, agentName, { feature, query, ticketId }
                    );
                    if (refreshed && refreshed.length > 0) {
                        return `Grounding context refreshed (${refreshed.length} chars):\n\n${refreshed}`;
                    }
                    return 'No additional grounding context found for this query.';
                } catch (error) {
                    return `Grounding refresh failed: ${error.message}`;
                }
            },
        }));
    }

    // TOOL CE-2: write_agent_note
    // Structured note-taking: agents persist discoveries outside the context window.
    // Notes are available to the same or other agents in later sessions.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('write_agent_note', {
            description:
                'Persist a discovery or observation outside the context window. ' +
                'Notes survive across sessions and are injected into later agent contexts. ' +
                'Use for: selector patterns, page behavior quirks, popup patterns, load timing issues, ' +
                'or any insight that future agents should know.',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: 'Note category: "discovery", "pattern", "warning", "selector", "fix"',
                        enum: ['discovery', 'pattern', 'warning', 'selector', 'fix'],
                    },
                    content: {
                        type: 'string',
                        description: 'The note content — be specific and actionable',
                    },
                    page: {
                        type: 'string',
                        description: 'Optional: which page this applies to (e.g., "/search", "/property-detail")',
                    },
                },
                required: ['category', 'content'],
            },
            handler: async ({ category, content, page }) => {
                const note = contextEngine.recordAgentNote(agentName, category, content, { page });

                // Also record in SharedContextStore if available
                if (contextStore) {
                    contextStore.addNote(agentName, `[${category}] ${content}`, { page, noteId: note.id });
                }

                return `Note recorded: [${category}] ${content.slice(0, 80)}...`;
            },
        }));
    }

    // TOOL CE-3: get_agent_notes
    // Retrieve notes from current and previous agents.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('get_agent_notes', {
            description:
                'Retrieve notes written by agents during this pipeline run. ' +
                'Useful for checking what previous agents discovered about pages, selectors, or issues.',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: 'Filter by category: "discovery", "pattern", "warning", "selector", "fix"',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max notes to return (default: 10)',
                    },
                },
            },
            handler: async ({ category, limit }) => {
                const notes = contextEngine.getAgentNotes({ category, limit: limit || 10 });
                if (notes.length === 0) {
                    return 'No agent notes found for this query.';
                }
                return notes.map(n =>
                    `[${n.category}] ${n.agent} (${n.timestamp}): ${n.content}` +
                    (n.metadata?.page ? ` | page: ${n.metadata.page}` : '')
                ).join('\n');
            },
        }));
    }

    // TOOL CE-4: get_context_budget
    // Diagnostics tool: shows agents how much context budget they're using.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('get_context_budget', {
            description:
                'Check context budget utilization and metrics. Shows how much of the context window ' +
                'is being used, which components were included/compressed/dropped, and estimated token savings.',
            parameters: { type: 'object', properties: {} },
            handler: async () => {
                const metrics = contextEngine.getMetrics();
                return JSON.stringify({
                    totalPackCalls: metrics.totalPackCalls,
                    totalCompactions: metrics.totalCompactions,
                    estimatedTokensSaved: metrics.totalTokensSaved,
                    averageBudgetUtilization: metrics.averageBudgetUtilization + '%',
                    noteCount: metrics.noteCount,
                    componentStats: metrics.componentStats,
                }, null, 2);
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24: generate_pptx
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_pptx', {
            description:
                'Generates a professional PowerPoint (.pptx) file from a flexible slides array. ' +
                '28 slide types: title, content, bullets, two-column, table, chart, image, quote, ' +
                'section-break, comparison, summary, timeline, process-flow, stats-dashboard, icon-grid, ' +
                'pyramid, matrix-quadrant, agenda, team-profiles, before-after, funnel, roadmap, swot, ' +
                'hero-image, closing, diagram, data-story, infographic. Supports transitions (fade/push/wipe) ' +
                'and brand kits. Returns the file path to the generated .pptx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Presentation title (shown on title slide)' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    slides: { type: 'string', description: 'JSON array string of slide objects. Each slide: { type, title?, content?, bullets?, headers?, rows?, ... }' },
                },
                required: ['title', 'slides'],
            },
            handler: async ({ title, author, theme, slides }) => {
                try {
                    let parsedSlides;
                    try { parsedSlides = JSON.parse(slides); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid slides JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_pptx', {
                            phase: 'document', message: `Generating PPTX (${parsedSlides.length} slides)...`, step: 1,
                        });
                    }
                    const { generatePptx } = require(path.join(__dirname, '..', 'scripts', 'pptx-generator.js'));
                    const result = await generatePptx({ title, author, theme, slides: parsedSlides });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `PPTX generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 25: generate_docx
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_docx', {
            description:
                'Generates a professional Word (.docx) file from a flexible sections array. ' +
                '18 section types: heading, paragraph, bullets, numbered-list, table, code-block, callout, ' +
                'image, page-break, two-column, cover, pull-quote, sidebar, metric-strip, info-card-grid, ' +
                'diagram, chart, infographic. Supports TOC, running headers/footers. Returns the file path ' +
                'to the generated .docx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    includeTableOfContents: { type: 'boolean', description: 'Whether to include a Table of Contents page (default: false)' },
                    headerText: { type: 'string', description: 'Running header text (top-right of each page)' },
                    footerText: { type: 'string', description: 'Running footer text (centered at bottom)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Each section: { type, text?, content?, items?, headers?, rows?, ... }' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, includeTableOfContents, headerText, footerText, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_docx', {
                            phase: 'document', message: `Generating DOCX (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateDocx } = require(path.join(__dirname, '..', 'scripts', 'docx-generator.js'));
                    const result = await generateDocx({ title, author, theme, includeTableOfContents, headerText, footerText, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `DOCX generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 26: generate_pdf
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_pdf', {
            description:
                'Generates a professional PDF file from a flexible sections array. ' +
                '18 section types: heading, paragraph, bullets, numbered-list, table, code-block, callout, ' +
                'page-break, two-column, cover, pull-quote, sidebar, metric-strip, info-card-grid, ' +
                'diagram, chart, infographic. Supports watermark, TOC, and page borders. Returns the file ' +
                'path to the generated .pdf.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    watermark: { type: 'string', description: 'Optional watermark text displayed diagonally on all pages (e.g. DRAFT, CONFIDENTIAL)' },
                    includeTableOfContents: { type: 'boolean', description: 'Whether to include a Table of Contents page (default: false)' },
                    pageBorders: { type: 'boolean', description: 'Whether to add subtle accent borders to content pages (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Each section: { type, text?, content?, items?, headers?, rows?, ... }' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, watermark, includeTableOfContents, pageBorders, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_pdf', {
                            phase: 'document', message: `Generating PDF (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generatePdf } = require(path.join(__dirname, '..', 'scripts', 'pdf-generator.js'));
                    const result = await generatePdf({ title, author, theme, watermark, includeTableOfContents, pageBorders, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `PDF generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 27: generate_excel_report
    // Available to: docgenie (also buggenie for report attachments)
    // NOTE: This is SEPARATE from TestGenie's generate_test_case_excel
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_excel_report', {
            description:
                'Generates a professional Excel (.xlsx) workbook from a flexible sheets array. ' +
                'NOT the same as generate_test_case_excel (which is TestGenie-only). ' +
                'Each sheet can be: data-table, summary-card, key-value, matrix, or chart-data. ' +
                'Returns the file path to the generated .xlsx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Workbook title (used for metadata + filename)' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    sheets: { type: 'string', description: 'JSON array string of sheet objects. Each: { name, contentType, content: { headers?, rows?, metrics?, pairs?, ... } }' },
                },
                required: ['title', 'sheets'],
            },
            handler: async ({ title, author, theme, sheets }) => {
                try {
                    let parsedSheets;
                    try { parsedSheets = JSON.parse(sheets); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sheets JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_excel_report', {
                            phase: 'document', message: `Generating Excel report (${parsedSheets.length} sheets)...`, step: 1,
                        });
                    }
                    const { generateExcelReport } = require(path.join(__dirname, '..', 'scripts', 'excel-report-generator.js'));
                    const result = await generateExcelReport({ title, author, theme, sheets: parsedSheets });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Excel report generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 28: generate_diagram
    // Available to: docgenie, buggenie, scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie', 'scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('generate_diagram', {
            description:
                'Renders a Mermaid diagram as SVG and/or PNG. Supports flowchart, sequence, class, state, ' +
                'ER, pie, gantt, and other Mermaid diagram types. Theme-aware rendering with high-quality output. ' +
                'Returns file paths to the generated SVG and PNG files.',
            parameters: {
                type: 'object',
                properties: {
                    mermaidCode: { type: 'string', description: 'Mermaid DSL code (e.g., "graph TD\\nA-->B")' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                    svg: { type: 'boolean', description: 'Generate SVG output (default: true)' },
                    png: { type: 'boolean', description: 'Generate PNG output (default: true)' },
                },
                required: ['mermaidCode'],
            },
            handler: async ({ mermaidCode, theme, outputName, svg, png }) => {
                try {
                    const { renderDiagram, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'diagram-engine.js'));
                    const result = await renderDiagram({
                        mermaidCode, theme: theme || 'modern-blue', outputName,
                        svg: svg !== false, png: png !== false,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Diagram generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 29: generate_chart_image
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_chart_image', {
            description:
                'Renders a high-quality chart as a PNG image using Chart.js. Supports: bar, line, pie, doughnut, ' +
                'radar, polarArea, scatter, bubble, gauge, waterfall. Theme-aware with professional styling. ' +
                'Returns the file path to the generated PNG.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Chart type: bar, line, pie, doughnut, radar, polarArea, scatter, bubble, gauge, waterfall' },
                    chartTitle: { type: 'string', description: 'Chart title (displayed above chart)' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string: { labels: [...], datasets: [{ label, data: [...] }] }. For gauge: { value, max, label }. For waterfall: { labels: [...], values: [...] }.' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                },
                required: ['type', 'data'],
            },
            handler: async ({ type, chartTitle, theme, data, outputName }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { renderChart, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'chart-renderer.js'));
                    const result = await renderChart({
                        type, chartTitle, theme: theme || 'modern-blue', outputName,
                        ...parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Chart generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 30: generate_infographic
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_infographic', {
            description:
                'Renders a pre-built infographic component as a high-quality PNG image. ' +
                'Component types: stat-poster (big number + trend), comparison (side-by-side A vs B), ' +
                'process-flow (numbered steps), kpi-dashboard (metric cards grid), ' +
                'status-board (test results table with pass/fail/skip). Theme-aware.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Component type: stat-poster, comparison, process-flow, kpi-dashboard, status-board' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string with component-specific data. stat-poster: { value, label, trend, icon }. comparison: { left: {title, metrics}, right: {title, metrics} }. process-flow: { steps: [{title, description}] }. kpi-dashboard: { title, metrics: [{label, value, status}] }. status-board: { title, items: [{name, status, detail}] }.' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                },
                required: ['type', 'data'],
            },
            handler: async ({ type, theme, data, outputName }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { renderInfographic, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'infographic-components.js'));
                    const result = await renderInfographic({
                        type, theme: theme || 'modern-blue', outputName, data: parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Infographic generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 31: generate_html_report
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_html_report', {
            description:
                'Generates a self-contained interactive HTML report. Features: dark mode toggle, ' +
                'sidebar navigation, live search with highlighting, collapsible sections, print CSS, ' +
                'Chart.js charts, and Mermaid diagrams. 18 section types: heading, paragraph, bullets, ' +
                'numbered-list, table, code-block, callout, page-break, two-column, cover, pull-quote, ' +
                'sidebar, metric-strip, info-card-grid, diagram, chart, infographic, image. ' +
                'Returns the file path to the generated .html.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Report title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    darkMode: { type: 'boolean', description: 'Start in dark mode (default: false)' },
                    collapsible: { type: 'boolean', description: 'Make h1 sections collapsible (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as DOCX/PDF sections.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, darkMode, collapsible, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_html_report', {
                            phase: 'document', message: `Generating HTML report (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateHtmlReport } = require(path.join(__dirname, '..', 'scripts', 'html-report-generator.js'));
                    const result = await generateHtmlReport({ title, author, theme, darkMode, collapsible, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `HTML report generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 32: generate_infographic_poster
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_infographic_poster', {
            description:
                'Generates a full-page infographic poster as a high-resolution PNG image (retina 2×). ' +
                'Uses headless Chromium to render beautiful poster templates. ' +
                '5 templates: executive-summary (metrics + highlights + conclusion), ' +
                'data-story (2-column card grid with icons), comparison (side-by-side table), ' +
                'process-flow (numbered steps with connecting lines), timeline (alternating events). ' +
                'Output is 3840px wide (retina). Different from generate_infographic which renders components.',
            parameters: {
                type: 'object',
                properties: {
                    template: { type: 'string', description: 'Template: executive-summary, data-story, comparison, process-flow, timeline' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string with template-specific data. executive-summary: { title, subtitle, metrics: [{label, value}], highlights: [str], conclusion }. data-story: { title, cards: [{icon, title, value, description}] }. comparison: { title, headers: [str], rows: [[str]] }. process-flow: { title, steps: [{title, description}] }. timeline: { title, events: [{date, title, description}] }.' },
                    width: { type: 'number', description: 'Canvas width in pixels (default: 1920, rendered at 2× = 3840px output)' },
                    outputPath: { type: 'string', description: 'Custom output path (auto-generated if omitted)' },
                },
                required: ['template', 'data'],
            },
            handler: async ({ template, theme, data, width, outputPath }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { generateInfographic, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'infographic-generator.js'));
                    const result = await generateInfographic({
                        template, theme: theme || 'modern-blue', width: width || 1920, outputPath, data: parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Infographic poster generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 35: generate_video
    // Available to: docgenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie'].includes(agentName)) {
        tools.push(defineTool('generate_video', {
            description:
                'EXPERIMENTAL: Generates a WebM video from document sections. Each section becomes a ' +
                'full-screen 1920×1080 animated slide with CSS transitions. Uses Playwright video recording. ' +
                'Transitions: fade, slide-left, slide-up, zoom, none. ' +
                'Optionally exports a PNG storyboard of individual slides. ' +
                'Supports same section types as PPTX/DOCX (title, bullets, table, metric-strip, quote, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Video title (used for filename)' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    transition: { type: 'string', description: 'Transition type: fade, slide-left, slide-up, zoom, none (default: fade)' },
                    durationPerSlide: { type: 'number', description: 'Seconds per slide (default: 4)' },
                    storyboard: { type: 'boolean', description: 'Also export individual slide PNGs (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as PPTX/DOCX.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, theme, transition, durationPerSlide, storyboard, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_video', {
                            phase: 'document', message: `Generating video (${parsedSections.length} slides, ${transition || 'fade'} transition)...`, step: 1,
                        });
                    }
                    const { generateVideo, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'video-generator.js'));
                    const result = await generateVideo({ title, theme, transition, durationPerSlide, storyboard, sections: parsedSections });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 34: get_design_score
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('get_design_score', {
            description:
                'Scores a document\'s design quality 0-100 based on 7 criteria: color contrast (WCAG), ' +
                'text density, visual variety, typography hierarchy, brand compliance, layout balance, ' +
                'and section count. Returns a letter grade (A+ to F), detailed breakdown per category, ' +
                'and actionable recommendations. Use BEFORE finalizing a document to catch quality issues.',
            parameters: {
                type: 'object',
                properties: {
                    theme: { type: 'string', description: 'Theme name used for the document' },
                    format: { type: 'string', description: 'Output format: pptx, docx, pdf, html, markdown' },
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    sections: { type: 'string', description: 'JSON array string of sections/slides that will be or have been generated' },
                },
                required: ['sections'],
            },
            handler: async ({ theme, format, title, author, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    const { scoreDesignQuality } = require(path.join(__dirname, '..', 'scripts', 'shared', 'design-quality-scorer.js'));
                    const result = scoreDesignQuality({ sections: parsedSections, theme, format, title, author });
                    return JSON.stringify({ success: true, ...result });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Design scoring failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 33: generate_markdown
    // Available to: docgenie, buggenie, scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie', 'scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('generate_markdown', {
            description:
                'Generates a styled GitHub-flavored Markdown (.md) file. Features: YAML front matter, ' +
                'auto-generated Table of Contents, GFM tables, Mermaid diagram blocks, ' +
                'admonitions ([!NOTE], [!TIP], [!WARNING], [!CAUTION]), shields.io badges, ' +
                'collapsible details sections. 16 section types: heading, paragraph, bullets, ' +
                'numbered-list, table, code-block, callout, page-break, two-column, cover, pull-quote, ' +
                'sidebar, metric-strip, info-card-grid, diagram, badge. Returns the file path to the generated .md.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title (used in front matter and heading)' },
                    author: { type: 'string', description: 'Author name (front matter)' },
                    tags: { type: 'string', description: 'Comma-separated tags for YAML front matter (e.g. "qa,testing,report")' },
                    includeFrontMatter: { type: 'boolean', description: 'Include YAML front matter header (default: true)' },
                    includeTableOfContents: { type: 'boolean', description: 'Auto-generate Table of Contents (default: true)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as DOCX/PDF sections.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, tags, includeFrontMatter, includeTableOfContents, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    const parsedTags = tags ? tags.split(',').map(t => t.trim()) : undefined;
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_markdown', {
                            phase: 'document', message: `Generating Markdown (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateMarkdown } = require(path.join(__dirname, '..', 'scripts', 'markdown-generator.js'));
                    const result = await generateMarkdown({ title, author, tags: parsedTags, includeFrontMatter, includeTableOfContents, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Markdown generation failed: ${error.message}` });
                }
            },
        }));
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
