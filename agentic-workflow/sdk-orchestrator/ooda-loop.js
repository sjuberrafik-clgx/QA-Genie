/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OODA LOOP — Observe · Orient · Decide · Act
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the OODA (Observe–Orient–Decide–Act) decision loop for two
 * critical pipeline bottlenecks:
 *
 *   1. EnvironmentHealthCheck — Pre-pipeline environment readiness assessment.
 *      Prevents wasted 12+ minute runs by validating UAT, MCP, Jira, and
 *      auth health BEFORE committing to agent sessions.
 *
 *   2. ExplorationQualityAnalyzer — Post-snapshot quality assessment.
 *      Catches empty/sparse/loading-spinner MCP snapshots before they
 *      cascade into bad selectors and broken scripts.
 *
 * Design principles:
 *   - 100% deterministic JavaScript — ZERO LLM calls, ZERO token cost
 *   - Non-breaking — returns recommendations, not enforced blocks
 *     (EnvironmentHealthCheck CAN abort; ExplorationQualityAnalyzer advises)
 *   - Observable — all decisions emit structured data for EventBridge
 *   - Configurable — thresholds tunable via workflow-config.json → ooda section
 *
 * @module sdk-orchestrator/ooda-loop
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── OODA Decision Constants ────────────────────────────────────────────────

const DECISION = {
    PROCEED: 'PROCEED',
    WARN: 'WARN',
    ABORT: 'ABORT',
    ACCEPT: 'ACCEPT',
    RETRY_RECOMMENDED: 'RETRY_RECOMMENDED',
};

const CHECK_STATUS = {
    PASS: 'pass',
    WARN: 'warn',
    FAIL: 'fail',
    SKIP: 'skip',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pre-pipeline OODA cycle that validates environment readiness.
 *
 * OBSERVE  → HTTP ping UAT, check file presence, verify MCP config, test Jira
 * ORIENT   → Score each check 0–100, compute weighted aggregate
 * DECIDE   → ABORT (< abortThreshold) | WARN (< warnThreshold) | PROCEED
 * ACT      → Return structured result for pipeline-runner to handle
 */
class EnvironmentHealthCheck {
    /**
     * @param {Object} options
     * @param {Object} options.config          - workflow-config.json contents
     * @param {string} [options.projectRoot]   - Project root directory
     * @param {boolean} [options.verbose]
     */
    constructor(options = {}) {
        this.config = options.config || {};
        this.projectRoot = options.projectRoot || path.join(__dirname, '..', '..');
        this.verbose = options.verbose || false;

        // OODA thresholds from config (with sensible defaults)
        const oodaConfig = this.config.ooda?.environmentHealth || {};
        this.enabled = oodaConfig.enabled !== false;
        this.abortThreshold = oodaConfig.abortThreshold || 40;
        this.warnThreshold = oodaConfig.warnThreshold || 70;
        this.timeoutMs = oodaConfig.timeoutMs || 10000;
    }

    /**
     * Execute the full OODA cycle.
     *
     * @returns {Promise<{decision: string, score: number, checks: Object[], diagnostics: string[], duration: number}>}
     */
    async execute() {
        if (!this.enabled) {
            return {
                decision: DECISION.PROCEED,
                score: 100,
                checks: [],
                diagnostics: ['OODA health check disabled'],
                duration: 0,
            };
        }

        const startTime = Date.now();
        this._log('🔍 OODA: Observing environment health...');

        // ── OBSERVE ─────────────────────────────────────────────────
        const checks = await this._observe();

        // ── ORIENT ──────────────────────────────────────────────────
        const { score, diagnostics } = this._orient(checks);

        // ── DECIDE ──────────────────────────────────────────────────
        const decision = this._decide(score, checks);

        // ── ACT ─────────────────────────────────────────────────────
        const duration = Date.now() - startTime;
        const result = { decision, score, checks, diagnostics, duration };
        this._act(result);

        return result;
    }

    // ─── OBSERVE: Gather environment signals ────────────────────────

    async _observe() {
        const checks = [];

        // Read preflight config for URL / check definitions
        const preflightConfig = this.config.preflightChecks || {};
        const configChecks = preflightConfig.checks || [];

        // 1. UAT Reachability
        const uatCheck = configChecks.find(c => c.id === 'uat-reachable');
        const uatUrl = this._resolveEnvVar(uatCheck?.url) || process.env.UAT_URL;
        if (uatUrl) {
            checks.push(await this._checkUrl('uat-reachable', 'UAT Environment', uatUrl));
        } else {
            checks.push({
                id: 'uat-reachable',
                name: 'UAT Environment',
                status: CHECK_STATUS.WARN,
                score: 50,
                message: 'UAT_URL not configured in .env',
                weight: 30,
            });
        }

        // 2. MCP Server Config
        checks.push(this._checkMCPConfig());

        // 3. Jira Connectivity
        const jiraBaseUrl = process.env.JIRA_BASE_URL;
        const jiraToken = process.env.JIRA_API_TOKEN;
        const jiraEmail = process.env.JIRA_EMAIL;
        if (jiraBaseUrl && jiraToken && jiraEmail) {
            checks.push(await this._checkJira(jiraBaseUrl, jiraEmail, jiraToken));
        } else {
            checks.push({
                id: 'jira-accessible',
                name: 'Jira API',
                status: CHECK_STATUS.WARN,
                score: 40,
                message: `Missing Jira credentials: ${[!jiraBaseUrl && 'JIRA_BASE_URL', !jiraToken && 'JIRA_API_TOKEN', !jiraEmail && 'JIRA_EMAIL'].filter(Boolean).join(', ')}`,
                weight: 20,
            });
        }

        // 4. Test Framework Files
        checks.push(this._checkFrameworkFiles());

        // 5. Auth Tokens
        checks.push(this._checkAuthTokens());

        return checks;
    }

    // ─── ORIENT: Score and contextualize observations ───────────────

    _orient(checks) {
        const diagnostics = [];

        // Calculate weighted score
        let totalWeight = 0;
        let weightedScoreSum = 0;

        for (const check of checks) {
            const weight = check.weight || 10;
            totalWeight += weight;
            weightedScoreSum += (check.score * weight);

            if (check.status === CHECK_STATUS.FAIL) {
                diagnostics.push(`❌ ${check.name}: ${check.message}`);
            } else if (check.status === CHECK_STATUS.WARN) {
                diagnostics.push(`⚠️ ${check.name}: ${check.message}`);
            }
        }

        const score = totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : 0;

        // Add orientation commentary
        if (score < this.abortThreshold) {
            diagnostics.push(`🚫 Environment score ${score}/100 — below abort threshold (${this.abortThreshold})`);
        } else if (score < this.warnThreshold) {
            diagnostics.push(`⚠️ Environment score ${score}/100 — below warn threshold (${this.warnThreshold})`);
        } else {
            diagnostics.push(`✅ Environment score ${score}/100 — healthy`);
        }

        return { score, diagnostics };
    }

    // ─── DECIDE: Choose action based on score ───────────────────────

    _decide(score, checks) {
        // Any critical check failed? Abort regardless of score.
        const criticalFailure = checks.find(c =>
            c.status === CHECK_STATUS.FAIL && c.weight >= 25
        );
        if (criticalFailure) {
            this._log(`🚫 OODA ABORT: Critical check failed — ${criticalFailure.name}`);
            return DECISION.ABORT;
        }

        if (score < this.abortThreshold) {
            this._log(`🚫 OODA ABORT: Score ${score} < ${this.abortThreshold}`);
            return DECISION.ABORT;
        }

        if (score < this.warnThreshold) {
            this._log(`⚠️ OODA WARN: Score ${score} < ${this.warnThreshold}`);
            return DECISION.WARN;
        }

        this._log(`✅ OODA PROCEED: Score ${score}`);
        return DECISION.PROCEED;
    }

    // ─── ACT: Log and report ────────────────────────────────────────

    _act(result) {
        const { decision, score, checks, duration } = result;
        const icon = decision === DECISION.PROCEED ? '✅' :
            decision === DECISION.WARN ? '⚠️' : '🚫';

        this._log(`${icon} OODA Health Check: ${decision} (score: ${score}/100, ${duration}ms)`);
        for (const check of checks) {
            const cIcon = check.status === CHECK_STATUS.PASS ? '✅' :
                check.status === CHECK_STATUS.WARN ? '⚠️' : '❌';
            this._log(`  ${cIcon} ${check.name}: ${check.message} [${check.score}/100]`);
        }
    }

    // ─── Individual Check Implementations ───────────────────────────

    /**
     * HTTP HEAD or GET request to check if a URL is reachable.
     */
    async _checkUrl(id, name, url) {
        try {
            const statusCode = await this._httpHead(url, this.timeoutMs);
            if (statusCode >= 200 && statusCode < 400) {
                return { id, name, status: CHECK_STATUS.PASS, score: 100, message: `Reachable (HTTP ${statusCode})`, weight: 30 };
            }
            if (statusCode === 401 || statusCode === 403) {
                // Auth-gated but server is alive — acceptable
                return { id, name, status: CHECK_STATUS.PASS, score: 80, message: `Reachable but auth-gated (HTTP ${statusCode})`, weight: 30 };
            }
            return { id, name, status: CHECK_STATUS.FAIL, score: 20, message: `HTTP ${statusCode}`, weight: 30 };
        } catch (err) {
            return { id, name, status: CHECK_STATUS.FAIL, score: 0, message: `Unreachable: ${err.message}`, weight: 30 };
        }
    }

    /**
     * Check MCP server configuration is present and valid.
     */
    _checkMCPConfig() {
        const mcpConfig = this.config.sdk?.mcpServer || {};
        const serverPath = path.join(__dirname, '..', 'mcp-server', 'server.js');

        if (!fs.existsSync(serverPath)) {
            return { id: 'mcp-available', name: 'MCP Server', status: CHECK_STATUS.FAIL, score: 0, message: 'MCP server.js not found', weight: 25 };
        }

        // Check if MCP environment vars indicate configuration
        const mcpBrowser = process.env.MCP_BROWSER || 'chromium';
        const mcpHeadless = process.env.MCP_HEADLESS;

        return {
            id: 'mcp-available',
            name: 'MCP Server',
            status: CHECK_STATUS.PASS,
            score: 100,
            message: `Configured (browser: ${mcpBrowser}, headless: ${mcpHeadless || 'default'})`,
            weight: 25,
        };
    }

    /**
     * Check Jira API connectivity via REST endpoint.
     */
    async _checkJira(baseUrl, email, token) {
        try {
            const cloudId = process.env.JIRA_CLOUD_ID;
            if (!cloudId) {
                return { id: 'jira-accessible', name: 'Jira API', status: CHECK_STATUS.WARN, score: 50, message: 'JIRA_CLOUD_ID not set', weight: 20 };
            }

            const url = `${baseUrl.replace(/\/$/, '')}/ex/jira/${cloudId}/rest/api/3/myself`;
            const statusCode = await this._httpGet(url, this.timeoutMs, {
                'Authorization': `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
                'Accept': 'application/json',
            });

            if (statusCode >= 200 && statusCode < 300) {
                return { id: 'jira-accessible', name: 'Jira API', status: CHECK_STATUS.PASS, score: 100, message: 'Authenticated', weight: 20 };
            }
            if (statusCode === 401 || statusCode === 403) {
                return { id: 'jira-accessible', name: 'Jira API', status: CHECK_STATUS.FAIL, score: 10, message: `Auth failed (HTTP ${statusCode})`, weight: 20 };
            }
            return { id: 'jira-accessible', name: 'Jira API', status: CHECK_STATUS.WARN, score: 40, message: `HTTP ${statusCode}`, weight: 20 };
        } catch (err) {
            return { id: 'jira-accessible', name: 'Jira API', status: CHECK_STATUS.FAIL, score: 0, message: `Unreachable: ${err.message}`, weight: 20 };
        }
    }

    /**
     * Check that essential framework files exist.
     */
    _checkFrameworkFiles() {
        const requiredFiles = [
            { name: 'testData.js', rel: 'tests/test-data/testData.js' },
            { name: 'POmanager.js', rel: 'tests/pageobjects/POmanager.js' },
            { name: 'config.js', rel: 'tests/config/config.js' },
            { name: 'popupHandler.js', rel: 'tests/utils/popupHandler.js' },
        ];

        const missing = [];
        for (const file of requiredFiles) {
            if (!fs.existsSync(path.join(this.projectRoot, file.rel))) {
                missing.push(file.name);
            }
        }

        if (missing.length === 0) {
            return { id: 'framework-files', name: 'Framework Files', status: CHECK_STATUS.PASS, score: 100, message: `All ${requiredFiles.length} files present`, weight: 15 };
        }

        if (missing.length <= 1) {
            return { id: 'framework-files', name: 'Framework Files', status: CHECK_STATUS.WARN, score: 60, message: `Missing: ${missing.join(', ')}`, weight: 15 };
        }

        return { id: 'framework-files', name: 'Framework Files', status: CHECK_STATUS.FAIL, score: 0, message: `Missing: ${missing.join(', ')}`, weight: 15 };
    }

    /**
     * Check that auth token file exists and exports expected tokens.
     */
    _checkAuthTokens() {
        const testDataPath = path.join(this.projectRoot, 'tests', 'test-data', 'testData.js');
        if (!fs.existsSync(testDataPath)) {
            return { id: 'auth-tokens', name: 'Auth Tokens', status: CHECK_STATUS.FAIL, score: 0, message: 'testData.js not found', weight: 10 };
        }

        try {
            const content = fs.readFileSync(testDataPath, 'utf-8');
            const hasTokens = content.includes('userTokens') || content.includes('tokens');
            const hasBaseUrl = content.includes('baseUrl') || content.includes('BASE_URL');

            if (hasTokens && hasBaseUrl) {
                return { id: 'auth-tokens', name: 'Auth Tokens', status: CHECK_STATUS.PASS, score: 100, message: 'Token exports found', weight: 10 };
            }

            return { id: 'auth-tokens', name: 'Auth Tokens', status: CHECK_STATUS.WARN, score: 50, message: `Missing: ${[!hasTokens && 'userTokens', !hasBaseUrl && 'baseUrl'].filter(Boolean).join(', ')}`, weight: 10 };
        } catch {
            return { id: 'auth-tokens', name: 'Auth Tokens', status: CHECK_STATUS.WARN, score: 30, message: 'Could not read testData.js', weight: 10 };
        }
    }

    // ─── HTTP Helpers ───────────────────────────────────────────────

    _httpHead(url, timeout) {
        return this._httpRequest(url, 'HEAD', timeout);
    }

    _httpGet(url, timeout, headers = {}) {
        return this._httpRequest(url, 'GET', timeout, headers);
    }

    _httpRequest(url, method, timeout, headers = {}) {
        return new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? https : http;
            const req = lib.request(url, { method, timeout, headers, rejectUnauthorized: false }, (res) => {
                // Consume response data to free up memory
                res.resume();
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Timeout after ${timeout}ms`));
            });
            req.end();
        });
    }

    /**
     * Resolve ${VAR} placeholders in config strings.
     */
    _resolveEnvVar(value) {
        if (!value || typeof value !== 'string') return null;
        return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || '');
    }

    _log(msg) {
        if (this.verbose) console.log(`[OODA:HealthCheck] ${msg}`);
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORATION QUALITY ANALYZER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Post-snapshot OODA cycle that evaluates MCP exploration quality.
 *
 * OBSERVE  → Parse snapshot text for element count, role diversity, content
 * ORIENT   → Compare against expected complexity from groundingConfig featureMap
 * DECIDE   → ACCEPT | WARN | RETRY_RECOMMENDED
 * ACT      → Return structured assessment for enforcement hooks
 */
class ExplorationQualityAnalyzer {
    /**
     * @param {Object} [options]
     * @param {Object} [options.config]         - workflow-config.json contents
     * @param {Object} [options.groundingStore]  - GroundingStore instance (for feature map)
     * @param {boolean} [options.verbose]
     */
    constructor(options = {}) {
        this.config = options.config || {};
        this.groundingStore = options.groundingStore || null;
        this.verbose = options.verbose || false;

        const oodaConfig = this.config.ooda?.explorationQuality || {};
        this.enabled = oodaConfig.enabled !== false;
        this.minElements = oodaConfig.minElements || 5;
        this.minRoleDiversity = oodaConfig.minRoleDiversity || 3;
        this.retryThreshold = oodaConfig.retryThreshold || 30;
        this.warnThreshold = oodaConfig.warnThreshold || 60;
    }

    /**
     * Assess the quality of a snapshot result.
     *
     * @param {string} snapshotResult  - Raw snapshot text from MCP
     * @param {Object} [context]
     * @param {string} [context.pageUrl]  - Current page URL (for feature map lookup)
     * @returns {{ decision: string, score: number, elementCount: number, roleDiversity: number, warnings: string[], recommendation: string|null, metrics: Object }}
     */
    assess(snapshotResult, context = {}) {
        if (!this.enabled) {
            return {
                decision: DECISION.ACCEPT,
                score: 100,
                elementCount: -1,
                roleDiversity: -1,
                warnings: [],
                recommendation: null,
                metrics: {},
            };
        }

        // ── OBSERVE ─────────────────────────────────────────────────
        const metrics = this._observe(snapshotResult);

        // ── ORIENT ──────────────────────────────────────────────────
        const { score, warnings } = this._orient(metrics, context);

        // ── DECIDE ──────────────────────────────────────────────────
        const decision = this._decide(score);

        // ── ACT ─────────────────────────────────────────────────────
        const recommendation = this._act(decision, warnings, metrics);

        return {
            decision,
            score,
            elementCount: metrics.elementCount,
            roleDiversity: metrics.roleDiversity,
            warnings,
            recommendation,
            metrics,
        };
    }

    // ─── OBSERVE: Parse snapshot content ────────────────────────────

    _observe(snapshotResult) {
        const text = typeof snapshotResult === 'string'
            ? snapshotResult
            : JSON.stringify(snapshotResult || '');

        const length = text.length;

        // Count elements — accessibility tree uses formats like:
        // - "role 'name'" patterns
        // - "- button 'Submit'" list items
        // - "[ref=XX]" reference markers
        const rolePattern = /\b(button|link|heading|textbox|checkbox|radio|combobox|listbox|list|listitem|menu|menuitem|tab|tabpanel|navigation|banner|main|img|image|dialog|alert|search|form|region|group|separator|slider|spinbutton|switch|tree|treeitem|grid|gridcell|row|rowheader|columnheader|cell)\b/gi;
        const roleMatches = text.match(rolePattern) || [];
        const elementCount = roleMatches.length;

        // Count unique roles for diversity
        const uniqueRoles = new Set(roleMatches.map(r => r.toLowerCase()));
        const roleDiversity = uniqueRoles.size;

        // Detect loading/spinner patterns that indicate incomplete page load
        const loadingPatterns = /\b(loading|spinner|skeleton|please wait|fetching|initializing)\b/gi;
        const loadingMatches = text.match(loadingPatterns) || [];
        const hasLoadingIndicator = loadingMatches.length > 0;

        // Detect empty or near-empty snapshots
        const isEmpty = length < 50;
        const isSparse = length < 200 && elementCount < 3;

        // Detect popup/overlay dominance — if most elements are popup-related
        const popupPatterns = /\b(modal|dialog|overlay|popup|backdrop|dismiss|close|got it|welcome|tour)\b/gi;
        const popupMatches = text.match(popupPatterns) || [];
        const popupDominance = elementCount > 0
            ? popupMatches.length / elementCount
            : 0;

        // Detect dynamic IDs that signal unstable selectors
        const dynamicIdPattern = /#[a-z]+-[a-z0-9]{6,}/gi;
        const dynamicIdMatches = text.match(dynamicIdPattern) || [];

        // Count interactive elements specifically
        const interactivePattern = /\b(button|link|textbox|checkbox|radio|combobox|select|switch|slider)\b/gi;
        const interactiveMatches = text.match(interactivePattern) || [];

        return {
            length,
            elementCount,
            roleDiversity,
            uniqueRoles: [...uniqueRoles],
            hasLoadingIndicator,
            loadingTerms: loadingMatches.length,
            isEmpty,
            isSparse,
            popupDominance: Math.round(popupDominance * 100),
            popupTerms: popupMatches.length,
            dynamicIdCount: dynamicIdMatches.length,
            interactiveElements: interactiveMatches.length,
        };
    }

    // ─── ORIENT: Score and contextualize metrics ────────────────────

    _orient(metrics, context) {
        const warnings = [];
        let score = 100;

        // 1. Empty snapshot penalty
        if (metrics.isEmpty) {
            score -= 80;
            warnings.push('Snapshot is empty or near-empty (<50 chars)');
        } else if (metrics.isSparse) {
            score -= 50;
            warnings.push(`Snapshot is very sparse (<200 chars, ${metrics.elementCount} elements)`);
        }

        // 2. Element count penalty
        if (metrics.elementCount < this.minElements) {
            const penalty = Math.min(40, (this.minElements - metrics.elementCount) * 10);
            score -= penalty;
            warnings.push(`Low element count: ${metrics.elementCount} (minimum: ${this.minElements})`);
        }

        // 3. Role diversity penalty
        if (metrics.roleDiversity < this.minRoleDiversity) {
            const penalty = Math.min(20, (this.minRoleDiversity - metrics.roleDiversity) * 7);
            score -= penalty;
            warnings.push(`Low role diversity: ${metrics.roleDiversity} unique roles (minimum: ${this.minRoleDiversity})`);
        }

        // 4. Loading indicator penalty
        if (metrics.hasLoadingIndicator) {
            score -= 30;
            warnings.push(`Loading indicators detected (${metrics.loadingTerms} matches) — page may not be fully loaded`);
        }

        // 5. Popup dominance penalty
        if (metrics.popupDominance > 50) {
            score -= 25;
            warnings.push(`Popup/overlay dominates snapshot (${metrics.popupDominance}% of elements) — dismiss popups first`);
        }

        // 6. Dynamic ID concern (informational, moderate penalty)
        if (metrics.dynamicIdCount > 0) {
            score -= Math.min(15, metrics.dynamicIdCount * 3);
            warnings.push(`${metrics.dynamicIdCount} dynamic ID(s) detected — selectors may be unstable`);
        }

        // 7. Feature map comparison (ORIENT: compare against expected complexity)
        if (context.pageUrl && this.groundingStore) {
            const expectedComplexity = this._getExpectedComplexity(context.pageUrl);
            if (expectedComplexity) {
                const ratio = metrics.elementCount / expectedComplexity.expectedElements;
                if (ratio < 0.2) {
                    score -= 20;
                    warnings.push(
                        `Page "${expectedComplexity.featureName}" expected ~${expectedComplexity.expectedElements} elements, ` +
                        `but snapshot has only ${metrics.elementCount} — possible loading issue or popup blocking`
                    );
                }
            }
        }

        // 8. Zero interactive elements concern
        if (metrics.interactiveElements === 0 && metrics.elementCount > 0) {
            score -= 10;
            warnings.push('No interactive elements found (buttons, links, inputs) — snapshot may be incomplete');
        }

        // Floor at 0
        score = Math.max(0, score);

        return { score, warnings };
    }

    // ─── DECIDE: Choose assessment level ────────────────────────────

    _decide(score) {
        if (score < this.retryThreshold) {
            return DECISION.RETRY_RECOMMENDED;
        }
        if (score < this.warnThreshold) {
            return DECISION.WARN;
        }
        return DECISION.ACCEPT;
    }

    // ─── ACT: Generate recommendation ───────────────────────────────

    _act(decision, warnings, metrics) {
        if (decision === DECISION.ACCEPT) {
            return null;
        }

        const steps = [];

        if (metrics.hasLoadingIndicator) {
            steps.push('Wait for page to fully load using waitForLoadState("networkidle") or wait_for_element');
        }

        if (metrics.popupDominance > 50) {
            steps.push('Dismiss popups using PopupHandler.dismissAll() before re-snapshotting');
        }

        if (metrics.isEmpty || metrics.isSparse) {
            steps.push('Verify navigation succeeded — check URL with get_page_url');
            steps.push('Try waiting for a key element with wait_for_element before snapshotting');
        }

        if (metrics.dynamicIdCount > 0) {
            steps.push('Use role-based selectors (getByRole, getByLabel) instead of dynamic IDs');
        }

        if (steps.length === 0) {
            steps.push('Re-snapshot after allowing more time for page rendering');
        }

        return `⚠️ Snapshot quality ${decision === DECISION.RETRY_RECOMMENDED ? 'LOW' : 'MODERATE'} ` +
            `(score: ${metrics.elementCount} elements, ${metrics.roleDiversity} roles). ` +
            `Suggested actions:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
    }

    // ─── Feature Map Integration ────────────────────────────────────

    /**
     * Look up expected page complexity from the grounding featureMap.
     * Uses heuristics: each page object implies ~15 elements,
     * each keyword implies ~5 elements.
     */
    _getExpectedComplexity(pageUrl) {
        if (!this.groundingStore) return null;

        try {
            const features = this.groundingStore.config?.featureMap || [];

            for (const feature of features) {
                const pages = feature.pages || [];
                const matchesPage = pages.some(p =>
                    pageUrl.includes(p) || p.includes(pageUrl)
                );

                if (matchesPage) {
                    // Heuristic: estimate expected elements from feature definition
                    const pageObjectCount = (feature.pageObjects || []).length;
                    const keywordCount = (feature.keywords || []).length;
                    const expectedElements = Math.max(
                        this.minElements * 2,
                        (pageObjectCount * 15) + (keywordCount * 3)
                    );

                    return {
                        featureName: feature.name,
                        expectedElements,
                        pageObjects: feature.pageObjects || [],
                    };
                }
            }
        } catch {
            // Non-critical — fail silently
        }

        return null;
    }

    _log(msg) {
        if (this.verbose) console.log(`[OODA:ExplorationQuality] ${msg}`);
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    EnvironmentHealthCheck,
    ExplorationQualityAnalyzer,
    DECISION,
    CHECK_STATUS,
};
