/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PIPELINE RUNNER — SDK-Orchestrated Pipeline Execution
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Chains agent SDK sessions into a complete pipeline:
 *
 *   PREFLIGHT → TESTGENIE → QG_EXCEL → SCRIPTGEN → QG_SCRIPT → EXECUTE
 *     → SELF_HEAL → BUGGENIE (if failures persist) → REPORT
 *
 * Key capabilities:
 *   - Structured data passing between stages (no filesystem guessing)
 *   - Streaming progress via session.on('assistant.message_delta')
 *   - Quality gate enforcement at each transition
 *   - Resumable from last successful stage
 *   - Multi-mode: full | generate | heal | execute
 *
 * @module pipeline-runner
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { extractJSON, getStageTimeout } = require('./utils');
const { getContextStoreManager } = require('./shared-context-store');
const { AgentCoordinator, ROUTE } = require('./agent-coordinator');
const { SupervisorSession } = require('./supervisor-session');

// ─── Pipeline Stage Definitions ─────────────────────────────────────────────

const STAGES = {
    PREFLIGHT: 'preflight',
    TESTGENIE: 'testgenie',
    QG_EXCEL: 'qg_excel',
    SCRIPTGEN: 'scriptgenerator',
    QG_SCRIPT: 'qg_script',
    EXECUTE: 'execute',
    SELF_HEAL: 'healing',
    BUGGENIE: 'buggenie',
    REPORT: 'report',
};

const STAGE_ORDER = [
    STAGES.PREFLIGHT,
    STAGES.TESTGENIE,
    STAGES.QG_EXCEL,
    STAGES.SCRIPTGEN,
    STAGES.QG_SCRIPT,
    STAGES.EXECUTE,
    STAGES.SELF_HEAL,
    STAGES.BUGGENIE,
    STAGES.REPORT,
];

// Mode → which stages to run
const MODE_STAGES = {
    full: STAGE_ORDER,
    testcase: [STAGES.PREFLIGHT, STAGES.TESTGENIE, STAGES.QG_EXCEL, STAGES.REPORT],
    generate: [STAGES.PREFLIGHT, STAGES.SCRIPTGEN, STAGES.QG_SCRIPT, STAGES.EXECUTE, STAGES.SELF_HEAL, STAGES.REPORT],
    heal: [STAGES.EXECUTE, STAGES.SELF_HEAL, STAGES.REPORT],
    execute: [STAGES.EXECUTE, STAGES.REPORT],
};

// ─── Pipeline Runner ────────────────────────────────────────────────────────

class PipelineRunner {
    /**
     * @param {Object} options
     * @param {Object} options.sessionFactory  - AgentSessionFactory
     * @param {Object} options.selfHealing     - SelfHealingEngine
     * @param {Object} [options.learningStore] - LearningStore
     * @param {Object} options.config          - workflow-config.json contents
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        this.sessionFactory = options.sessionFactory;
        this.selfHealing = options.selfHealing;
        this.learningStore = options.learningStore || null;
        this.config = options.config || {};
        this.verbose = options.verbose || false;
        this.projectRoot = path.join(__dirname, '..', '..');
        this._contextStoreManager = getContextStoreManager();
    }

    /**
     * Run the pipeline for a ticket.
     *
     * @param {string} ticketId
     * @param {Object} options
     * @param {string} [options.mode='full']
     * @param {Function} [options.onProgress]
     * @returns {Object} Pipeline result
     */
    async run(ticketId, options = {}) {
        const mode = options.mode || 'full';
        const onProgress = options.onProgress || (() => { });
        const stages = MODE_STAGES[mode] || MODE_STAGES.full;

        const startTime = Date.now();
        const runId = options.runId || `run_${ticketId}_${Date.now()}`;

        // Initialize shared context store for this run
        const contextStore = this._contextStoreManager.getStore(runId);
        contextStore.addNote('coordinator', `Pipeline started: ${ticketId} [mode: ${mode}]`);

        // Initialize agent coordinator for smart routing
        const coordinator = new AgentCoordinator({
            sessionFactory: this.sessionFactory,
            contextStore,
            config: this.config,
            verbose: this.verbose,
        });

        // Initialize supervisor session (persistent overseer across all stages)
        const supervisorEnabled = (this.config.sdk?.coordinator?.enableSupervisor !== false);
        let supervisor = null;
        if (supervisorEnabled) {
            supervisor = new SupervisorSession({
                sessionFactory: this.sessionFactory,
                contextStore,
                config: this.config,
                verbose: this.verbose,
            });
        }

        const context = {
            ticketId,
            mode,
            startTime,
            runId,
            // Shared context store — agents read/write decisions here
            contextStore,
            // Agent coordinator — handles routing and collaboration
            coordinator,
            // Supervisor session — persistent pipeline overseer
            supervisor,
            // Artifacts produced by each stage
            testCasesPath: null,
            explorationPath: null,
            specPath: null,
            testResults: null,
            healingResult: null,
            // Stage results
            stageResults: {},
        };

        this._log(`\n${'═'.repeat(60)}`);
        this._log(`  PIPELINE: ${ticketId} [mode: ${mode}]`);
        this._log(`  Stages: ${stages.join(' → ')}`);
        this._log(`${'═'.repeat(60)}`);

        // Resolve paths based on mode
        this._resolveExistingArtifacts(context);

        // Start supervisor session (persists across all stages)
        if (supervisor) {
            try {
                onProgress('supervisor', 'Initializing supervisor...');
                await supervisor.initialize(ticketId);
                this._log('✅ Supervisor session active');
            } catch (err) {
                this._log(`⚠️ Supervisor init failed (non-blocking): ${err.message}`);
                supervisor = null;
                context.supervisor = null;
            }
        }

        let lastCompletedStage = null;
        let pipelineError = null;
        const skipStages = new Set();
        let restartFrom = null;

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];

            // Skip stages that the coordinator decided to skip
            if (skipStages.has(stage)) {
                this._log(`⏭️ Skipping ${stage} (coordinator decision)`);
                context.stageResults[stage] = { success: true, skipped: true, message: 'Skipped by coordinator' };
                onProgress(stage, 'Skipped');
                continue;
            }

            onProgress(stage, `Starting ${stage}...`);

            try {
                // Supervisor pre-stage briefing (non-blocking on failure)
                if (supervisor && supervisor.isActive) {
                    try {
                        const guidance = await supervisor.briefStage(stage, context);
                        if (guidance) {
                            contextStore.addNote('supervisor', `Pre-${stage}: ${guidance.substring(0, 300)}`);
                        }
                    } catch (briefErr) {
                        this._log(`⚠️ Supervisor briefing failed for ${stage}: ${briefErr.message}`);
                    }
                }

                const result = await this._executeStage(stage, context, onProgress);
                context.stageResults[stage] = result;
                lastCompletedStage = stage;

                // Supervisor post-stage review (non-blocking on failure)
                if (supervisor && supervisor.isActive) {
                    try {
                        const review = await supervisor.reviewStage(stage, result);
                        if (!review.approved && review.action === 'retry') {
                            this._log(`⚠️ Supervisor flagged ${stage} — retry recommended`);
                            contextStore.recordConstraint('supervisor',
                                `Stage ${stage} flagged: ${review.feedback}`,
                                'Supervisor recommends retry'
                            );
                        }
                    } catch (reviewErr) {
                        this._log(`⚠️ Supervisor review failed for ${stage}: ${reviewErr.message}`);
                    }
                }

                // Ask the coordinator for a routing decision
                const route = coordinator.route(stage, result, context);

                switch (route.action) {
                    case ROUTE.SKIP:
                        // Mark downstream stages to skip
                        if (route.targets) {
                            for (const t of route.targets) skipStages.add(t);
                        }
                        onProgress(stage, result.message || 'Completed');
                        break;

                    case ROUTE.RETRY_PARTIAL:
                        // Ask the agent to fix just the broken part
                        if (route.params?.fixPrompt && route.targets?.[0]) {
                            this._log(`🔧 Partial retry: ${route.reason}`);
                            onProgress(stage, `Partial fix: ${route.reason}`);
                            await coordinator.requestPartialFix(
                                route.targets[0],
                                route.params.fixPrompt,
                                { ticketContext: `Fix issues in ${route.params.specPath || context.specPath}` }
                            );
                        }
                        onProgress(stage, result.message || 'Completed (with partial fix)');
                        break;

                    case ROUTE.RETRY_FULL:
                        // Retry the entire stage (max once)
                        if (!result._retried) {
                            this._log(`🔄 Full retry: ${route.reason}`);
                            onProgress(stage, `Retrying: ${route.reason}`);
                            const retryResult = await this._executeStage(stage, context, onProgress);
                            retryResult._retried = true;
                            context.stageResults[stage] = retryResult;
                            if (retryResult.success) {
                                onProgress(stage, retryResult.message || 'Completed (retry)');
                            }
                        }
                        break;

                    case ROUTE.ESCALATE:
                        // Escalation — e.g., restart from an earlier stage
                        if (route.params?.strategy) {
                            const escalation = coordinator.escalate(route.params.strategy, context);
                            if (escalation.action === 'restart_from' && escalation.stage) {
                                restartFrom = escalation.stage;
                                contextStore.recordDecision('coordinator',
                                    `Escalated: restart from ${escalation.stage}`,
                                    escalation.reason
                                );
                            }
                        }
                        onProgress(stage, result.message || 'Completed');
                        break;

                    case ROUTE.ABORT:
                        pipelineError = `Coordinator aborted: ${route.reason}`;
                        this._log(`🚫 ${pipelineError}`);
                        onProgress(stage, `ABORTED: ${route.reason}`);
                        break;

                    case ROUTE.DELEGATE:
                        // Agent-to-agent question answering
                        if (route.params?.questions && route.targets?.[0]) {
                            for (const q of route.params.questions) {
                                await coordinator.askAgent(
                                    stage, route.targets[0],
                                    q.question || q,
                                    {}
                                );
                            }
                        }
                        onProgress(stage, result.message || 'Completed');
                        break;

                    default:
                        // CONTINUE — normal flow
                        if (!result.success && result.blocking) {
                            pipelineError = `Stage ${stage} failed: ${result.error || 'unknown'}`;
                            this._log(`🚫 Pipeline blocked at ${stage}: ${pipelineError}`);
                            onProgress(stage, `BLOCKED: ${result.error || 'Stage failed'}`);
                        } else {
                            onProgress(stage, result.message || 'Completed');
                        }
                }

                if (pipelineError) break;

            } catch (error) {
                pipelineError = `Stage ${stage} threw: ${error.message}`;
                context.stageResults[stage] = { success: false, error: error.message, blocking: true };
                this._log(`💥 Stage ${stage} threw: ${error.message}`);
                onProgress(stage, `ERROR: ${error.message}`);
                break;
            }
        }

        // Handle restart-from escalation (one restart allowed)
        if (restartFrom && !context._restarted) {
            context._restarted = true;
            this._log(`🔄 Restarting pipeline from ${restartFrom}`);
            const restartIdx = stages.indexOf(restartFrom);
            if (restartIdx >= 0) {
                const remainingStages = stages.slice(restartIdx);
                pipelineError = null;
                for (const stage of remainingStages) {
                    onProgress(stage, `Starting ${stage} (restart)...`);
                    try {
                        const result = await this._executeStage(stage, context, onProgress);
                        context.stageResults[stage] = result;
                        lastCompletedStage = stage;
                        if (!result.success && result.blocking) {
                            pipelineError = `Stage ${stage} failed on restart: ${result.error || 'unknown'}`;
                            break;
                        }
                        onProgress(stage, result.message || 'Completed');
                    } catch (error) {
                        pipelineError = `Stage ${stage} threw on restart: ${error.message}`;
                        break;
                    }
                }
            }
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        // Supervisor final summary (non-blocking)
        let supervisorSummary = null;
        if (supervisor && supervisor.isActive) {
            try {
                supervisorSummary = await supervisor.summarize({
                    success: !pipelineError,
                    stagesCompleted: lastCompletedStage,
                    durationMs: Date.now() - startTime,
                });
            } catch (sumErr) {
                this._log(`⚠️ Supervisor summary failed: ${sumErr.message}`);
            } finally {
                await supervisor.destroy().catch(() => { });
            }
        }

        // Save context store, clean up run data, and get coordinator stats
        contextStore.save();
        if (this._contextStoreManager && typeof this._contextStoreManager.cleanup === 'function') {
            this._contextStoreManager.cleanup(runId);
        }
        const coordinatorStats = coordinator.getStats();

        const result = {
            ticketId,
            mode,
            runId,
            success: !pipelineError,
            duration: `${duration}s`,
            lastCompletedStage,
            stageResults: context.stageResults,
            artifacts: {
                testCases: context.testCasesPath,
                exploration: context.explorationPath,
                spec: context.specPath,
                testResults: context.testResults,
                healingResult: context.healingResult,
            },
            orchestration: {
                routingDecisions: coordinatorStats.routingDecisions,
                miniSessionsUsed: coordinatorStats.miniSessionsUsed,
                decisionBreakdown: coordinatorStats.decisionBreakdown,
                contextEntries: contextStore.getStats().totalEntries,
                routingHistory: coordinator.getRoutingHistory(),
                supervisorReviews: supervisor ? supervisor.getReviewHistory() : {},
                supervisorConversationTurns: supervisor ? supervisor.getConversationLength() : 0,
                supervisorSummary,
            },
            error: pipelineError,
        };

        this._log(`\n${'═'.repeat(60)}`);
        this._log(`  PIPELINE ${result.success ? 'COMPLETED' : 'FAILED'}`);
        this._log(`  Duration: ${duration}s | Last stage: ${lastCompletedStage}`);
        this._log(`${'═'.repeat(60)}`);

        return result;
    }

    // ─── Stage Execution ────────────────────────────────────────────

    async _executeStage(stage, context, onProgress) {
        switch (stage) {
            case STAGES.PREFLIGHT:
                return this._runPreflight(context);

            case STAGES.TESTGENIE:
                return this._runTestGenie(context, onProgress);

            case STAGES.QG_EXCEL:
                return this._runQualityGate('excel', context);

            case STAGES.SCRIPTGEN:
                return this._runScriptGenerator(context, onProgress);

            case STAGES.QG_SCRIPT:
                return this._runQualityGate('script', context);

            case STAGES.EXECUTE:
                return this._runExecution(context);

            case STAGES.SELF_HEAL:
                return this._runSelfHealing(context);

            case STAGES.BUGGENIE:
                return this._runBugGenie(context, onProgress);

            case STAGES.REPORT:
                return this._generateReport(context);

            default:
                return { success: false, error: `Unknown stage: ${stage}`, blocking: true };
        }
    }

    // ─── Individual Stage Implementations ───────────────────────────

    async _runPreflight(context) {
        this._log('🔍 Running preflight checks...');

        const checks = [];

        // Check test data file exists
        const testDataPath = path.join(this.projectRoot, 'tests', 'test-data', 'testData.js');
        checks.push({
            name: 'test-data',
            passed: fs.existsSync(testDataPath),
        });

        // Check page objects exist
        const poPath = path.join(this.projectRoot, 'tests', 'pageobjects', 'POmanager.js');
        checks.push({
            name: 'page-objects',
            passed: fs.existsSync(poPath),
        });

        // Check config exists
        const configPath = path.join(this.projectRoot, 'tests', 'config', 'config.js');
        checks.push({
            name: 'browser-config',
            passed: fs.existsSync(configPath),
        });

        // Check popup handler exists
        const popupPath = path.join(this.projectRoot, 'tests', 'utils', 'popupHandler.js');
        checks.push({
            name: 'popup-handler',
            passed: fs.existsSync(popupPath),
        });

        const allPassed = checks.every(c => c.passed);
        const failed = checks.filter(c => !c.passed).map(c => c.name);

        return {
            success: allPassed,
            blocking: !allPassed,
            checks,
            message: allPassed
                ? `All ${checks.length} preflight checks passed`
                : `Failed: ${failed.join(', ')}`,
            error: allPassed ? null : `Preflight failed: ${failed.join(', ')}`,
        };
    }

    async _runTestGenie(context, onProgress) {
        this._log('📝 Running TestGenie session...');
        let session = null;
        let sessionId = null;

        try {
            // Create TestGenie session
            const sessionInfo = await this.sessionFactory.createAgentSession('testgenie', {
                ticketContext: `Generate test cases for Jira ticket ${context.ticketId}. ` +
                    'Use the fetch_jira_ticket tool to get ticket details, then ' +
                    'use the generate_test_case_excel tool to create the Excel file.',
                contextStore: context.contextStore,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Send prompt — references only custom tools available to testgenie
            // NOTE: In SDK context, MCP tools use their RAW names (no VS Code prefix).
            // Atlassian MCP tools: atl_getJiraIssue, atl_search, etc.
            // Custom tools: fetch_jira_ticket, generate_test_case_excel
            const prompt =
                `Generate test cases for Jira ticket ${context.ticketId}.\n\n` +
                'Steps:\n' +
                `1. Use the fetch_jira_ticket tool with ticketId "${context.ticketId}" to get full ticket details.\n` +
                '   (This is a custom tool available to you — call it directly by name.)\n' +
                '2. Analyze the ticket summary, description, and acceptance criteria\n' +
                '3. Generate optimized test cases following the required format:\n' +
                '   - Pre-Conditions row\n' +
                '   - Test Step ID | Specific Activity or Action | Expected Results | Actual Results\n' +
                '   - First step must be launching the application\n' +
                '   - Combine repetitive steps, keep it concise\n' +
                '4. Use the generate_test_case_excel tool to save test cases as Excel\n' +
                '   - Pass testSteps as a JSON array string with objects: { stepId, action, expected, actual }\n' +
                '5. Display the test cases in a markdown table\n\n' +
                'IMPORTANT: Use the fetch_jira_ticket custom tool to get ticket data. ' +
                'Do NOT use shell scripts or try to call external APIs directly.';

            onProgress(STAGES.TESTGENIE, 'Generating test cases...');
            const responseText = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'testgenie', 300000),
            });

            // Check for Excel output
            const testCasesDir = path.join(__dirname, '..', 'test-cases');
            if (!fs.existsSync(testCasesDir)) {
                fs.mkdirSync(testCasesDir, { recursive: true });
            }
            const excelFiles = fs.readdirSync(testCasesDir).filter(f =>
                f.includes(context.ticketId) && f.endsWith('.xlsx')
            );

            if (excelFiles.length > 0) {
                context.testCasesPath = path.join(testCasesDir, excelFiles[excelFiles.length - 1]);
                // Register artifact in shared context
                if (context.contextStore) {
                    context.contextStore.registerArtifact('testgenie', 'testCases', context.testCasesPath, {
                        summary: `${excelFiles.length} Excel file(s) generated for ${context.ticketId}`,
                    });
                }
            } else if (responseText && responseText.length > 50) {
                // Fallback: save the agent's response as markdown test cases
                const fallbackPath = path.join(testCasesDir, `${context.ticketId}-testcases.md`);
                try {
                    fs.writeFileSync(fallbackPath, responseText, 'utf-8');
                    context.testCasesPath = fallbackPath;
                    this._log(`📝 Saved TestGenie response as fallback: ${fallbackPath}`);
                    if (context.contextStore) {
                        context.contextStore.registerArtifact('testgenie', 'testCases', fallbackPath, {
                            summary: `Fallback test cases markdown for ${context.ticketId}`,
                        });
                    }
                } catch (writeErr) {
                    this._log(`⚠️ Failed to save fallback test cases: ${writeErr.message}`);
                }
            }

            return {
                success: excelFiles.length > 0 || !!context.testCasesPath,
                blocking: false, // Can continue without Excel
                message: excelFiles.length > 0
                    ? `Test cases generated: ${excelFiles[excelFiles.length - 1]}`
                    : context.testCasesPath
                        ? `Test cases saved as markdown: ${path.basename(context.testCasesPath)}`
                        : 'TestGenie completed but no test cases captured',
                artifact: context.testCasesPath,
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    async _runScriptGenerator(context, onProgress) {
        this._log('⚙️ Running ScriptGenerator session...');
        let session = null;
        let sessionId = null;

        try {
            // Load framework inventory for context
            let frameworkInventory = null;
            try {
                const { getFrameworkInventoryCache, getInventorySummary } =
                    require('../utils/project-path-resolver');
                frameworkInventory = getInventorySummary(getFrameworkInventoryCache());
            } catch { /* non-critical */ }

            // Load historical context
            let historicalContext = null;
            if (this.learningStore) {
                const recent = this.learningStore.getRecentFailures(10);
                if (recent.length > 0) {
                    historicalContext = recent.map(f =>
                        `- [${f.errorType}] ${f.selector} → ${f.outcome} (${f.method})`
                    ).join('\n');
                }
            }

            // Build test case context from TestGenie output
            let testCaseContext = '';
            if (context.testCasesPath && fs.existsSync(context.testCasesPath)) {
                testCaseContext = `Test cases Excel file is at: ${context.testCasesPath}`;
            }

            // Create session
            const sessionInfo = await this.sessionFactory.createAgentSession('scriptgenerator', {
                ticketId: context.ticketId,
                frameworkInventory,
                historicalContext,
                ticketContext: testCaseContext,
                contextStore: context.contextStore,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Send prompt
            // NOTE: In SDK context, MCP tools use RAW names without VS Code prefix.
            // unified_navigate (NOT mcp_unified-autom_unified_navigate)
            // unified_snapshot (NOT mcp_unified-autom_unified_snapshot)
            const prompt =
                `Generate a Playwright automation script for ticket ${context.ticketId}.\n\n` +
                'MANDATORY STEPS:\n' +
                '1. FIRST: Navigate to the application using the unified_navigate MCP tool\n' +
                '2. Take accessibility snapshots using the unified_snapshot tool\n' +
                '3. Extract real selectors from the snapshots\n' +
                '4. Save exploration data using the save_exploration_data custom tool\n' +
                '5. Generate the .spec.js file with captured selectors\n' +
                '6. Validate the script using the validate_generated_script tool\n\n' +
                'AVAILABLE MCP TOOLS (use these exact names):\n' +
                '- unified_navigate: Navigate to a URL\n' +
                '- unified_snapshot: Capture accessibility tree with element refs\n' +
                '- unified_click: Click an element\n' +
                '- unified_type: Type text into an element\n' +
                '- unified_fill_form: Fill form fields\n' +
                '- unified_wait_for_element: Wait for element state\n' +
                '- unified_get_page_url: Get current URL\n' +
                '- unified_get_page_title: Get page title\n\n' +
                'AVAILABLE CUSTOM TOOLS:\n' +
                '- get_framework_inventory: Scan test framework codebase\n' +
                '- save_exploration_data: Save exploration JSON\n' +
                '- validate_generated_script: Validate the .spec.js file\n' +
                '- get_assertion_config: Get assertion patterns\n' +
                '- suggest_popup_handler: Get popup handling recommendations\n\n' +
                `${testCaseContext ? `Test cases reference: ${testCaseContext}\n\n` : ''}` +
                'PROHIBITED ACTIONS (strictly enforced):\n' +
                '- Do NOT use runInTerminal, powershell, or any shell/terminal tool\n' +
                '- Do NOT run npx playwright test — test execution is a SEPARATE pipeline stage\n' +
                '- Do NOT launch standalone Playwright browsers via require("playwright")\n' +
                '- Use ONLY the MCP tools listed above for browser exploration\n' +
                '- Use ONLY the custom tools listed above for framework inventory and validation\n\n' +
                'Remember: Use PopupHandler for popup dismissal, test.describe.serial() for shared state, ' +
                'auto-retrying assertions only, and NO waitForTimeout().';

            onProgress(STAGES.SCRIPTGEN, 'Exploring application via MCP...');
            const scriptResponse = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'scriptgenerator', 600000),
                onDelta: (delta) => {
                    // Could stream to progress callback if needed
                },
            });

            // Find generated spec file
            const specsDir = path.join(this.projectRoot, 'tests', 'specs');
            const ticketDir = path.join(specsDir, context.ticketId.toLowerCase());
            const specFile = path.join(ticketDir, `${context.ticketId}.spec.js`);

            if (fs.existsSync(specFile)) {
                context.specPath = specFile;
            } else {
                // Search for any recently created spec
                const altPaths = [
                    path.join(ticketDir, `${context.ticketId.toUpperCase()}.spec.js`),
                    ...this._findRecentSpecs(specsDir, context.ticketId),
                ];
                for (const alt of altPaths) {
                    if (fs.existsSync(alt)) {
                        context.specPath = alt;
                        break;
                    }
                }
            }

            // Register artifacts in shared context
            if (context.contextStore && context.specPath) {
                context.contextStore.registerArtifact('scriptgenerator', 'specFile', context.specPath, {
                    summary: `Playwright spec for ${context.ticketId}`,
                });
            }

            // Check exploration data
            const explorationFile = path.join(
                __dirname, '..', 'exploration-data', `${context.ticketId}-exploration.json`
            );
            if (fs.existsSync(explorationFile)) {
                context.explorationPath = explorationFile;
                if (context.contextStore) {
                    context.contextStore.registerArtifact('scriptgenerator', 'exploration', explorationFile, {
                        summary: `MCP exploration data for ${context.ticketId}`,
                    });
                }
            }

            // If no spec file found, save the agent response for debugging
            if (!context.specPath && scriptResponse && scriptResponse.length > 50) {
                this._log(`⚠️ ScriptGenerator responded (${scriptResponse.length} chars) but no .spec.js file was created on disk`);
                const debugDir = path.join(__dirname, '..', 'test-artifacts');
                if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                const debugPath = path.join(debugDir, `${context.ticketId}-scriptgen-response.md`);
                try {
                    fs.writeFileSync(debugPath, scriptResponse, 'utf-8');
                    this._log(`📝 Saved ScriptGenerator response to ${debugPath}`);
                } catch { /* ignore */ }
            }

            return {
                success: !!context.specPath,
                blocking: !context.specPath,
                message: context.specPath
                    ? `Script generated: ${path.basename(context.specPath)}`
                    : 'ScriptGenerator completed but spec file not found',
                artifact: context.specPath,
                exploration: context.explorationPath,
                error: context.specPath ? null : 'Spec file not created',
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    async _runQualityGate(gate, context) {
        this._log(`🔒 Running quality gate: ${gate}`);

        let artifactPath;
        switch (gate) {
            case 'excel':
                artifactPath = context.testCasesPath;
                break;
            case 'script':
                artifactPath = context.specPath;
                break;
            case 'exploration':
                artifactPath = context.explorationPath;
                break;
            default:
                return { success: true, blocking: false, message: `Unknown gate: ${gate}` };
        }

        if (!artifactPath || !fs.existsSync(artifactPath)) {
            return {
                success: false,
                blocking: gate === 'script', // Only script gate is blocking
                message: `${gate} artifact not found`,
                error: `No artifact at ${artifactPath || 'null'}`,
            };
        }

        // For script gate, run validate-script.js
        if (gate === 'script') {
            try {
                const { validateGeneratedScript } = require('../scripts/validate-script');
                const content = fs.readFileSync(artifactPath, 'utf-8');

                // Suppress console
                const origLog = console.log;
                console.log = () => { };
                const result = validateGeneratedScript(artifactPath, content);
                console.log = origLog;

                return {
                    success: result.valid,
                    blocking: !result.valid,
                    errors: result.errors,
                    warnings: result.warnings,
                    message: result.valid
                        ? 'Script validation passed'
                        : `Script validation failed: ${result.errors.length} error(s)`,
                };
            } catch (error) {
                return { success: false, blocking: false, message: `Validation error: ${error.message}` };
            }
        }

        // For excel gate, just check file exists and is non-empty
        const stat = fs.statSync(artifactPath);
        return {
            success: stat.size > 0,
            blocking: false,
            message: stat.size > 0
                ? `${gate} quality gate passed (${stat.size} bytes)`
                : `${gate} artifact is empty`,
        };
    }

    async _runExecution(context) {
        this._log('🧪 Running test execution...');

        if (!context.specPath || !fs.existsSync(context.specPath)) {
            return {
                success: false,
                blocking: false,
                message: 'No spec file to execute',
                error: 'specPath is missing',
            };
        }

        try {
            // Make path relative to project root to avoid regex issues with special chars
            const relativePath = path.relative(this.projectRoot, context.specPath).replace(/\\/g, '/');
            // Escape regex metacharacters in path for Playwright's filter
            const escapedPath = relativePath.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');
            const output = execSync(
                `npx playwright test "${escapedPath}" --reporter=json`,
                {
                    encoding: 'utf-8',
                    stdio: 'pipe',
                    cwd: this.projectRoot,
                    timeout: getStageTimeout(this.config, 'execution', 180000),
                }
            );

            const result = extractJSON(output);
            const specs = result.suites?.[0]?.specs || [];
            const failed = specs.filter(s => s.tests?.[0]?.status === 'failed');
            const passed = specs.filter(s => s.tests?.[0]?.status === 'passed');

            // Save raw Playwright JSON for the Reports dashboard
            const rawResultsPath = this._saveRawTestResults(context, result);

            context.testResults = {
                totalCount: specs.length,
                passedCount: passed.length,
                failedCount: failed.length,
                passed: failed.length === 0,
                failedTests: failed.map(s => s.title),
                rawResultsFile: rawResultsPath,
            };

            return {
                success: failed.length === 0,
                blocking: false,
                message: `${passed.length}/${specs.length} tests passed`,
                testResults: context.testResults,
            };
        } catch (error) {
            const errorOutput = error.stdout || error.stderr || error.message;

            // Try to parse JSON from error output (Playwright exits non-zero on test failures)
            try {
                const result = extractJSON(errorOutput);
                const specs = result.suites?.[0]?.specs || [];
                const failed = specs.filter(s => s.tests?.[0]?.status === 'failed');
                const passed = specs.filter(s => s.tests?.[0]?.status === 'passed');

                // Save raw Playwright JSON for the Reports dashboard
                const rawResultsPath = this._saveRawTestResults(context, result);

                context.testResults = {
                    totalCount: specs.length,
                    passedCount: passed.length,
                    failedCount: failed.length,
                    passed: failed.length === 0 && specs.length > 0,
                    failedTests: failed.map(s => s.title),
                    errors: result.errors || [],
                    rawResultsFile: rawResultsPath,
                };

                return {
                    success: context.testResults.passed,
                    blocking: false,
                    message: specs.length > 0
                        ? `${passed.length}/${specs.length} tests passed`
                        : `Test execution error: ${(result.errors?.[0]?.message || '').substring(0, 200)}`,
                    testResults: context.testResults,
                };
            } catch { /* JSON parse failed — fall through */ }

            // Save raw error output as a report so it appears in Reports dashboard
            const rawErrorPath = this._saveRawTestResults(context, {
                rawError: errorOutput.substring(0, 50000),
            });

            context.testResults = {
                passed: false,
                error: errorOutput.substring(0, 2000),
                totalCount: 0,
                failedCount: 0,
                rawResultsFile: rawErrorPath,
            };

            return {
                success: false,
                blocking: false,
                message: 'Test execution failed',
                error: errorOutput.substring(0, 500),
            };
        }
    }

    async _runSelfHealing(context) {
        this._log('🔧 Running self-healing...');

        // Skip if tests passed
        if (context.testResults?.passed) {
            return {
                success: true,
                blocking: false,
                message: 'Tests already passing — no healing needed',
            };
        }

        if (!context.specPath) {
            return {
                success: false,
                blocking: false,
                message: 'No spec file for healing',
            };
        }

        const healResult = await this.selfHealing.heal(context.ticketId, context.specPath);
        context.healingResult = healResult;

        // If healing succeeded, save the final passing results as a report
        if (healResult.success && healResult.healingLog?.length > 0) {
            const lastLog = healResult.healingLog[healResult.healingLog.length - 1];
            const finalTests = lastLog?.tests;
            if (finalTests?.rawOutput) {
                try {
                    const { extractJSON: parseJSON } = require('./utils');
                    const parsedResult = parseJSON(finalTests.rawOutput);
                    const healedPath = this._saveRawTestResults(context, parsedResult);
                    if (healedPath) {
                        context.testResults = {
                            ...context.testResults,
                            passed: true,
                            passedCount: finalTests.totalCount - finalTests.failedCount,
                            failedCount: finalTests.failedCount,
                            totalCount: finalTests.totalCount,
                            rawResultsFile: healedPath,
                            healedAfterIterations: healResult.iterations,
                        };
                    }
                } catch { /* extractJSON failed — skip */ }
            }
        }

        return {
            success: healResult.success,
            blocking: false,
            message: healResult.message,
            iterations: healResult.iterations,
            fixesApplied: healResult.totalFixesApplied,
        };
    }

    async _runBugGenie(context, onProgress) {
        this._log('🐛 Running BugGenie...');

        // Only run if tests are still failing after healing
        const testsPassing = context.testResults?.passed || context.healingResult?.success;
        if (testsPassing) {
            return {
                success: true,
                blocking: false,
                message: 'Tests passing — no bug ticket needed',
            };
        }

        let session = null;
        let sessionId = null;

        try {
            const sessionInfo = await this.sessionFactory.createAgentSession('buggenie', {
                ticketContext: [
                    `Ticket: ${context.ticketId}`,
                    `Spec: ${context.specPath || 'unknown'}`,
                    `Failed tests: ${context.testResults?.failedTests?.join(', ') || 'unknown'}`,
                    `Error: ${(context.testResults?.error || '').substring(0, 1000)}`,
                    `Healing attempted: ${context.healingResult?.iterations || 0} iterations`,
                    `Healing result: ${context.healingResult?.message || 'not attempted'}`,
                ].join('\n'),
                contextStore: context.contextStore,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const prompt =
                `Create a bug ticket for test failures in ${context.ticketId}.\n\n` +
                `Failed tests: ${context.testResults?.failedTests?.join(', ') || 'unknown'}\n` +
                `Error details: ${(context.testResults?.error || '').substring(0, 2000)}\n\n` +
                'Follow the bug ticket format from the project standards.';

            onProgress(STAGES.BUGGENIE, 'Creating bug ticket...');
            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'buggenie', 180000),
            });

            return {
                success: true,
                blocking: false,
                message: 'Bug ticket created',
                response: response?.substring(0, 500),
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    async _generateReport(context) {
        this._log('📊 Generating report...');

        const duration = Math.round((Date.now() - context.startTime) / 1000);
        const stages = Object.entries(context.stageResults).map(([name, result]) => ({
            stage: name,
            success: result.success,
            message: result.message,
        }));

        const report = {
            ticketId: context.ticketId,
            mode: context.mode,
            duration: `${duration}s`,
            stages,
            artifacts: {
                testCases: context.testCasesPath || null,
                exploration: context.explorationPath || null,
                spec: context.specPath || null,
                rawTestResults: context.testResults?.rawResultsFile || null,
            },
            testResults: context.testResults || null,
            healingResult: context.healingResult || null,
            overallSuccess: !context.stageResults.execute?.success
                ? (context.healingResult?.success || false)
                : true,
        };

        // Save report
        const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const reportFile = path.join(reportsDir, `${context.ticketId}-pipeline-report.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

        return {
            success: true,
            blocking: false,
            message: `Report saved: ${path.basename(reportFile)}`,
            reportPath: reportFile,
            report,
        };
    }

    // ─── Helpers ────────────────────────────────────────────────────

    /**
     * Save raw Playwright JSON reporter output for the Reports dashboard.
     * File: test-artifacts/reports/{ticketId}-{runId}-test-results.json
     * @returns {string|null} Path to the saved file, or null on error
     */
    _saveRawTestResults(context, playwrightResult) {
        try {
            const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }
            const fileName = `${context.ticketId}-${context.runId}-test-results.json`;
            const filePath = path.join(reportsDir, fileName);
            const payload = {
                ticketId: context.ticketId,
                runId: context.runId,
                mode: context.mode,
                specPath: context.specPath || null,
                timestamp: new Date().toISOString(),
                playwrightResult,
            };
            fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
            this._log(`📄 Raw test results saved: ${fileName}`);

            // ── Emit REPORT_SAVED event for real-time dashboard updates ──
            try {
                const { getEventBridge, EVENT_TYPES } = require('./event-bridge');
                const eventBridge = getEventBridge();
                eventBridge.push(EVENT_TYPES.REPORT_SAVED, context.runId, {
                    ticketId: context.ticketId,
                    fileName,
                    filePath,
                    timestamp: payload.timestamp,
                });
            } catch { /* EventBridge not available — non-critical */ }

            return filePath;
        } catch (err) {
            this._log(`⚠️ Failed to save raw test results: ${err.message}`);
            return null;
        }
    }

    _resolveExistingArtifacts(context) {
        const ticketId = context.ticketId;

        // Check for existing spec file
        const specsDir = path.join(this.projectRoot, 'tests', 'specs');
        const variations = [
            path.join(specsDir, ticketId.toLowerCase(), `${ticketId}.spec.js`),
            path.join(specsDir, ticketId.toLowerCase(), `${ticketId.toUpperCase()}.spec.js`),
            path.join(specsDir, `${ticketId.toLowerCase()}`, `${ticketId.toUpperCase()}.spec.js`),
        ];

        for (const v of variations) {
            if (fs.existsSync(v)) {
                context.specPath = v;
                break;
            }
        }

        // Check for existing exploration data
        const explorationFile = path.join(
            __dirname, '..', 'exploration-data', `${ticketId}-exploration.json`
        );
        if (fs.existsSync(explorationFile)) {
            context.explorationPath = explorationFile;
        }
    }

    _findRecentSpecs(specsDir, ticketId) {
        const results = [];
        if (!fs.existsSync(specsDir)) return results;

        try {
            const dirs = fs.readdirSync(specsDir, { withFileTypes: true })
                .filter(d => d.isDirectory() && d.name.toLowerCase().includes(ticketId.toLowerCase()));

            for (const dir of dirs) {
                const dirPath = path.join(specsDir, dir.name);
                const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.spec.js'));
                results.push(...files.map(f => path.join(dirPath, f)));
            }
        } catch { /* ignore */ }

        return results;
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[PipelineRunner] ${message}`);
        } else if (
            message.includes('═') || message.includes('PIPELINE') ||
            message.includes('💥') || message.includes('🚫') ||
            message.includes('⚠️') || message.includes('❌')
        ) {
            console.log(`[PipelineRunner] ${message}`);
        }
    }
}

module.exports = { PipelineRunner, STAGES, STAGE_ORDER, MODE_STAGES };
