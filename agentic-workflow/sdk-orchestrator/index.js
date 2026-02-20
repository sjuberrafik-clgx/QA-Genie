/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ORCHESTRATOR — Programmatic Copilot Pipeline Controller
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replaces prompt-engineered agent dispatching with code-driven orchestration
 * using the GitHub Copilot SDK. Provides:
 *
 *   1. Programmatic agent sessions with typed tools & enforcement hooks
 *   2. Closed-loop self-healing (ErrorAnalyzer → SDK session → MCP re-explore → fix)
 *   3. Cross-run learning store (cumulative intelligence across pipeline runs)
 *   4. Structural rule enforcement via onPreToolUse / onPostToolUse hooks
 *   5. Multi-ticket parallel pipelines via independent SDK sessions
 *   6. BYOK provider flexibility (Azure OpenAI, Anthropic, Ollama, etc.)
 *
 * @module sdk-orchestrator
 * @version 1.0.0
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { AgentSessionFactory } = require('./agent-sessions');
const { PipelineRunner } = require('./pipeline-runner');
const { LearningStore } = require('./learning-store');
const { SelfHealingEngine } = require('./self-healing');

// ─── Configuration Loader ───────────────────────────────────────────────────

function loadConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
    try {
        let content = fs.readFileSync(configPath, 'utf-8');
        // Strip BOM if present (common with Windows editors)
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        return JSON.parse(content);
    } catch (error) {
        console.error(`Failed to load workflow-config.json: ${error.message}`);
        return {};
    }
}

function loadEnv() {
    try {
        // Use override: true to ensure .env values always win, even if
        // environment variables were set by a parent process (e.g., web-app
        // spawning the backend). This fixes the "injecting env (0)" issue
        // where dotenv v17 skips already-set vars.
        require('dotenv').config({
            path: path.join(__dirname, '..', '.env'),
            override: true,
        });
    } catch {
        // dotenv not installed — continue with process.env
    }
}

// ─── SDK Orchestrator ───────────────────────────────────────────────────────

class SDKOrchestrator {
    /**
     * @param {Object} options
     * @param {string} [options.model]         - LLM model override (default from config)
     * @param {Object} [options.provider]       - BYOK provider config { type, baseUrl, apiKey }
     * @param {string} [options.githubToken]    - GitHub PAT for Copilot auth
     * @param {string} [options.cliUrl]         - URL of existing Copilot CLI server
     * @param {boolean} [options.enableLearning] - Toggle learning store (default: true)
     * @param {boolean} [options.verbose]       - Verbose logging
     */
    constructor(options = {}) {
        loadEnv();

        this.config = loadConfig();
        this.sdkConfig = this.config.sdk || {};
        this.options = {
            model: options.model || this.sdkConfig.model || process.env.COPILOT_MODEL || 'claude-sonnet-4',
            provider: options.provider || this.sdkConfig.provider || null,
            githubToken: options.githubToken || process.env.GITHUB_TOKEN || null,
            cliUrl: options.cliUrl || process.env.COPILOT_CLI_URL || null,
            enableLearning: options.enableLearning ?? (process.env.SDK_ENABLE_LEARNING === 'false' ? false : (this.sdkConfig.enableLearning ?? true)),
            maxHealingIterations: parseInt(process.env.SDK_MAX_HEALING_ITERATIONS, 10) || this.sdkConfig.maxHealingIterations || 3,
            parallelTickets: parseInt(process.env.SDK_PARALLEL_TICKETS, 10) || this.sdkConfig.parallelTickets || 1,
            verbose: options.verbose || false,
        };

        this.client = null;
        this.sessionFactory = null;
        this.learningStore = null;
        this.selfHealing = null;
        this.pipelineRunner = null;
        this.isRunning = false;

        // Event listeners
        this._listeners = {};
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Initialize the SDK client and all subsystems.
     * Must be called before any pipeline execution.
     */
    async start() {
        if (this.isRunning) {
            this._log('warn', 'SDK Orchestrator is already running');
            return;
        }

        this._log('info', '═══════════════════════════════════════════════');
        this._log('info', '  SDK ORCHESTRATOR — Starting');
        this._log('info', '═══════════════════════════════════════════════');

        // Step 1: Import Copilot SDK (ESM module in CommonJS context)
        let CopilotClient, defineTool;
        try {
            const sdk = await import('@github/copilot-sdk');
            CopilotClient = sdk.CopilotClient;
            defineTool = sdk.defineTool;
            this._log('info', '✅ Copilot SDK loaded');
        } catch (error) {
            throw new Error(
                `Failed to load @github/copilot-sdk: ${error.message}\n` +
                'Install it with: npm install @github/copilot-sdk'
            );
        }

        // Step 2: Create CopilotClient
        // NOTE: Do NOT pass githubToken (PAT) to CopilotClient — it silently
        // breaks session processing (messages queue but the LLM never responds).
        // The SDK uses the GitHub CLI's built-in Copilot auth when no token is
        // provided, which works correctly for inference calls.
        //
        // CRITICAL: CopilotClient's autoStart reads process.env.GITHUB_TOKEN
        // internally when starting the CLI server. If a PAT is present, it
        // hijacks the auth flow and causes the same silent breakage.
        // We must temporarily remove it from the environment.
        const _savedGithubToken = process.env.GITHUB_TOKEN;
        delete process.env.GITHUB_TOKEN;
        this._log('info', '🔒 Cleared GITHUB_TOKEN from process.env (prevents silent auth breakage)');

        const clientOpts = {
            autoStart: true,
            autoRestart: true,
            logLevel: this.options.verbose ? 'debug' : 'info',
        };

        if (this.options.cliUrl) {
            clientOpts.cliUrl = this.options.cliUrl;
        }

        this.client = new CopilotClient(clientOpts);
        await this.client.start();
        this._log('info', '✅ CopilotClient started');

        // Restore GITHUB_TOKEN for other uses (Jira API, etc.) now that
        // CopilotClient has started with the correct auth flow.
        if (_savedGithubToken) {
            process.env.GITHUB_TOKEN = _savedGithubToken;
        }

        // Step 2b: Validate model availability (non-blocking)
        try {
            if (typeof this.client.listModels === 'function') {
                const models = await this.client.listModels();
                const modelIds = (models || []).map(m => m.id || m.name || m);
                this._log('info', `   Available models: ${modelIds.join(', ')}`);

                if (modelIds.length > 0 && !modelIds.includes(this.options.model)) {
                    this._log('warn', `   ⚠️ Model "${this.options.model}" not in available models list`);
                    this._log('warn', `   Available: ${modelIds.join(', ')}`);
                }
            }
        } catch {
            // listModels not available in this SDK version — non-critical
        }

        // Step 3: Initialize learning store
        if (this.options.enableLearning) {
            this.learningStore = new LearningStore();
            this._log('info', `✅ Learning store loaded (${this.learningStore.getStats().totalFailures} historical entries)`);
        }

        // Step 4: Initialize session factory (needs client + config + learning store)
        this.sessionFactory = new AgentSessionFactory({
            client: this.client,
            defineTool,
            model: this.options.model,
            provider: this.options.provider,
            config: this.config,
            learningStore: this.learningStore,
            verbose: this.options.verbose,
        });
        this._log('info', '✅ Agent session factory ready');

        // Step 5: Initialize self-healing engine
        this.selfHealing = new SelfHealingEngine({
            sessionFactory: this.sessionFactory,
            learningStore: this.learningStore,
            maxIterations: this.options.maxHealingIterations,
            config: this.config,
            verbose: this.options.verbose,
        });
        this._log('info', '✅ Self-healing engine ready');

        // Step 6: Initialize pipeline runner
        this.pipelineRunner = new PipelineRunner({
            sessionFactory: this.sessionFactory,
            selfHealing: this.selfHealing,
            learningStore: this.learningStore,
            config: this.config,
            verbose: this.options.verbose,
        });
        this._log('info', '✅ Pipeline runner ready');

        this.isRunning = true;
        this._log('info', '═══════════════════════════════════════════════');
        this._log('info', '  SDK ORCHESTRATOR — Ready');
        this._log('info', `  Model: ${this.options.model}`);
        this._log('info', `  Learning: ${this.options.enableLearning ? 'ON' : 'OFF'}`);
        this._log('info', `  Max healing iterations: ${this.options.maxHealingIterations}`);
        this._log('info', '═══════════════════════════════════════════════');
    }

    /**
     * Gracefully stop the SDK client and persist learning data.
     */
    async stop() {
        if (!this.isRunning) return;

        this._log('info', 'Stopping SDK Orchestrator...');

        // Persist learning store
        if (this.learningStore) {
            this.learningStore.save();
            this._log('info', '✅ Learning store persisted');
        }

        // Stop client
        if (this.client) {
            const errors = await this.client.stop();
            if (errors.length > 0) {
                this._log('warn', `Client stop encountered ${errors.length} error(s)`);
            }
        }

        this.isRunning = false;
        this._log('info', 'SDK Orchestrator stopped');
    }

    // ─── Pipeline Execution ─────────────────────────────────────────────

    /**
     * Run the full pipeline for a single ticket.
     * Stages: PREFLIGHT → TESTGENIE → SCRIPT_GENERATE → EXECUTE → SELF_HEAL → BUGGENIE
     *
     * @param {string} ticketId - Jira ticket ID (e.g., "AOTF-16339")
     * @param {Object} [options] - Run options
     * @param {string} [options.mode='full'] - 'full' | 'generate' | 'heal' | 'execute'
     * @param {string} [options.model] - LLM model override for this run (e.g., 'claude-opus-4.6')
     * @param {Function} [options.onProgress] - Progress callback (stage, message)
     * @returns {Object} Pipeline result
     */
    async runPipeline(ticketId, options = {}) {
        this._ensureRunning();

        const mode = options.mode || 'full';
        const model = options.model || null;
        this._log('info', `\nRunning pipeline for ${ticketId} [mode: ${mode}]${model ? ` [model: ${model}]` : ''}`);

        // Override session factory model for this run if specified
        if (model && this.sessionFactory) {
            this.sessionFactory.model = model;
        }

        return this.pipelineRunner.run(ticketId, {
            mode,
            onProgress: options.onProgress || this._defaultProgressHandler.bind(this),
        });
    }

    /**
     * Run pipelines for multiple tickets in parallel.
     *
     * @param {string[]} ticketIds - Array of Jira ticket IDs
     * @param {Object} [options] - Same as runPipeline options
     * @returns {Object[]} Array of pipeline results
     */
    async runParallel(ticketIds, options = {}) {
        this._ensureRunning();

        const maxParallel = this.options.parallelTickets;
        const results = [];

        // Process in batches of maxParallel
        for (let i = 0; i < ticketIds.length; i += maxParallel) {
            const batch = ticketIds.slice(i, i + maxParallel);
            this._log('info', `\nProcessing batch ${Math.floor(i / maxParallel) + 1}: ${batch.join(', ')}`);

            const batchResults = await Promise.all(
                batch.map(id => this.runPipeline(id, options).catch(err => ({
                    ticketId: id,
                    success: false,
                    error: err.message,
                })))
            );

            results.push(...batchResults);
        }

        return results;
    }

    // ─── Individual Stage Execution ─────────────────────────────────────

    /**
     * Run only the self-healing loop for a specific spec file.
     * @param {string} ticketId
     * @param {string} specPath
     * @returns {Object} Healing result
     */
    async heal(ticketId, specPath) {
        this._ensureRunning();
        return this.selfHealing.heal(ticketId, specPath);
    }

    /**
     * Run only test execution for a specific spec file.
     * @param {string} specPath
     * @returns {Object} Test result
     */
    async execute(specPath) {
        this._ensureRunning();
        const { execSync } = require('child_process');
        try {
            const output = execSync(
                `npx playwright test "${specPath.replace(/\\/g, '/')}" --reporter=json`,
                { encoding: 'utf-8', stdio: 'pipe', cwd: path.join(__dirname, '..') }
            );
            const result = JSON.parse(output);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.stdout || error.message };
        }
    }

    // ─── Event System ───────────────────────────────────────────────────

    /**
     * Subscribe to orchestrator events.
     * Events: 'pipeline.start', 'pipeline.stage', 'pipeline.complete',
     *         'healing.start', 'healing.fix', 'healing.complete',
     *         'learning.update'
     */
    on(event, handler) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
        return () => {
            this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        };
    }

    _emit(event, data) {
        (this._listeners[event] || []).forEach(h => {
            try { h(data); } catch (err) {
                this._log('error', `Event handler error [${event}]: ${err.message}`);
            }
        });
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    _ensureRunning() {
        if (!this.isRunning) {
            throw new Error('SDK Orchestrator is not running. Call start() first.');
        }
    }

    _defaultProgressHandler(stage, message) {
        const icons = {
            preflight: '🔍', testgenie: '📝', scriptgenerator: '⚙️',
            execute: '🧪', healing: '🔧', buggenie: '🐛', report: '📊',
        };
        console.log(`  ${icons[stage] || '▸'} [${stage.toUpperCase()}] ${message}`);
    }

    _log(level, message) {
        const prefix = '[SDK-Orchestrator]';
        if (level === 'error') console.error(`${prefix} ❌ ${message}`);
        else if (level === 'warn') console.warn(`${prefix} ⚠️ ${message}`);
        else if (this.options.verbose || level === 'info') console.log(`${prefix} ${message}`);
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    SDKOrchestrator,
    AgentSessionFactory,
    PipelineRunner,
    LearningStore,
    SelfHealingEngine,
    // Phase 1: Headless Pipeline Service
    RunStore: require('./run-store').RunStore,
    EventBridge: require('./event-bridge').EventBridge,
    Notifier: require('./notifier').Notifier,
    startServer: require('./server').startServer,
    // Phase 3: AI Orchestration Layer
    SharedContextStore: require('./shared-context-store').SharedContextStore,
    ContextStoreManager: require('./shared-context-store').ContextStoreManager,
    getContextStoreManager: require('./shared-context-store').getContextStoreManager,
    AgentCoordinator: require('./agent-coordinator').AgentCoordinator,
    ROUTE: require('./agent-coordinator').ROUTE,
    SupervisorSession: require('./supervisor-session').SupervisorSession,
};
