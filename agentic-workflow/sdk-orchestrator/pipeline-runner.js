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
const { getEventBridge } = require('./event-bridge');
const { EvidenceStore } = require('./evidence-store');
const { EnvironmentHealthCheck, DECISION: OODA_DECISION } = require('./ooda-loop');

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
        this._eventBridge = options.eventBridge || getEventBridge();
        this.evidenceStore = options.evidenceStore || new EvidenceStore({ projectRoot: this.projectRoot });

        // Grounding store — pull from options or from session factory's internal store
        this.groundingStore = options.groundingStore || options.sessionFactory?._groundingStore || null;
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
        const scenario = options.scenario || null;
        const scenarioId = scenario?.id || options.scenarioId || null;
        const authState = options.authState || scenario?.authState || 'unspecified';

        const startTime = Date.now();
        const runId = options.runId || `run_${ticketId}_${Date.now()}`;
        const contextRunId = options.contextRunId || (scenarioId ? `${runId}__${scenarioId}` : runId);

        // Initialize shared context store for this run
        const contextStore = this._contextStoreManager.getStore(contextRunId);
        contextStore.addNote('coordinator', `Pipeline started: ${ticketId} [mode: ${mode}]${scenarioId ? ` [scenario: ${scenarioId}]` : ''}`);

        // Initialize agent coordinator for smart routing
        const coordinator = new AgentCoordinator({
            sessionFactory: this.sessionFactory,
            contextStore,
            config: this.config,
            verbose: this.verbose,
        });

        // Initialize supervisor session (persistent overseer across all stages)
        // Modes: "always" (legacy), "never" (disabled), "adaptive" (only for complex tickets)
        const supervisorSetting = this.config.sdk?.coordinator?.enableSupervisor;
        const supervisorMode = (supervisorSetting === 'adaptive') ? 'adaptive'
            : (supervisorSetting === false || supervisorSetting === 'never') ? 'never'
                : 'always';

        let supervisor = null;
        if (supervisorMode === 'always') {
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
            contextRunId,
            scenario,
            scenarioId,
            scenarioName: scenario?.name || null,
            authState,
            scenarioSlug: this._getScenarioSlug(scenarioId, authState),
            // Shared context store — agents read/write decisions here
            contextStore,
            // Agent coordinator — handles routing and collaboration
            coordinator,
            // Supervisor session — persistent pipeline overseer
            supervisor,

            // Cognitive scaling — propagated from ScriptGen to all downstream stages
            cognitiveTier: null,         // 'simple' | 'moderate' | 'complex'
            cognitiveScaling: null,      // Full scaling params for current tier
            // Artifacts produced by each stage
            testCasesPath: null,
            explorationPath: null,
            specPath: null,
            testResults: null,
            healingResult: null,
            evidenceManifestPath: null,
            reportPath: null,
            // Stage results
            stageResults: {},
        };

        this._log(`\n${'═'.repeat(60)}`);
        this._log(`  PIPELINE: ${ticketId} [mode: ${mode}]${scenarioId ? ` [scenario: ${scenarioId}/${authState}]` : ''}`);
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

        // ── OODA: Pre-Pipeline Environment Health Check ──────────────
        // Prevents wasted 12+ minute runs by validating UAT, MCP, Jira,
        // and auth health BEFORE committing to agent sessions.
        try {
            const healthCheck = new EnvironmentHealthCheck({
                config: this.config,
                projectRoot: this.projectRoot,
                verbose: this.verbose,
            });
            const healthResult = await healthCheck.execute();

            // Record health state in shared context
            contextStore.addNote('ooda', `Environment health: ${healthResult.decision} (score: ${healthResult.score}/100, ${healthResult.duration}ms)`);
            for (const diag of healthResult.diagnostics) {
                contextStore.addNote('ooda', diag);
            }

            // Emit event for dashboard/SSE consumers
            this._eventBridge.push(
                healthResult.decision === OODA_DECISION.ABORT ? 'ooda_health_abort' : 'ooda_health_check',
                runId,
                { decision: healthResult.decision, score: healthResult.score, checks: healthResult.checks, duration: healthResult.duration }
            );

            if (healthResult.decision === OODA_DECISION.ABORT) {
                pipelineError = `OODA Health Check ABORT: Environment score ${healthResult.score}/100.\n` +
                    healthResult.diagnostics.join('\n');
                this._log(`\n🚫 ${pipelineError}`);
                onProgress('ooda_health', `ABORTED: ${healthResult.diagnostics[0]}`);
            } else if (healthResult.decision === OODA_DECISION.WARN) {
                contextStore.recordConstraint('ooda',
                    `Environment health warning (score: ${healthResult.score}/100)`,
                    healthResult.diagnostics.filter(d => d.startsWith('⚠️')).join('; ')
                );
                onProgress('ooda_health', `Warning: score ${healthResult.score}/100`);
            } else {
                onProgress('ooda_health', `Healthy (score: ${healthResult.score}/100)`);
            }
        } catch (healthErr) {
            this._log(`⚠️ OODA Health Check error (non-blocking): ${healthErr.message}`);
            contextStore.addNote('ooda', `Health check error: ${healthErr.message}`);
        }

        if (pipelineError) {
            const duration = Math.round((Date.now() - startTime) / 1000);
            return {
                ticketId, mode, runId,
                success: false,
                duration: `${duration}s`,
                lastCompletedStage: null,
                stageResults: context.stageResults,
                artifacts: {},
                orchestration: {},
                error: pipelineError,
            };
        }

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

                // Context compaction: shrink completed stage data to free budget
                // for downstream agents (context engineering pattern)
                try {
                    const { getContextEngine } = require('./context-engine');
                    const contextEngine = getContextEngine();
                    if (contextEngine && contextEngine.config?.compaction?.enabled !== false) {
                        const compactionResult = contextEngine.compactStageContext(contextStore, stage);
                        if (compactionResult.compacted) {
                            this._log(`📦 Context compacted after ${stage}: ${compactionResult.originalEntries} entries → ${compactionResult.summaryChars} char summary`);
                        }
                    }
                } catch (compactErr) {
                    this._log(`⚠️ Context compaction failed after ${stage}: ${compactErr.message}`);
                }

                // ── Adaptive Supervisor Activation ──────────────────
                // In "adaptive" mode, activate supervisor only when the cognitive
                // loop determines the ticket is complex enough to warrant it
                if (supervisorMode === 'adaptive' && !supervisor && stage === STAGES.SCRIPTGEN) {
                    const cogMetrics = result?.cognitiveMetrics || result?.metrics;
                    const shouldEnable = cogMetrics?.adaptiveScaling?.enableSupervisor
                        || cogMetrics?.adaptiveScaling?.tier === 'complex';

                    if (shouldEnable) {
                        this._log('🔄 Adaptive supervisor: ACTIVATING (complex ticket detected)');
                        try {
                            supervisor = new SupervisorSession({
                                sessionFactory: this.sessionFactory,
                                contextStore,
                                config: this.config,
                                verbose: this.verbose,
                            });
                            context.supervisor = supervisor;
                            await supervisor.initialize(context.ticketId);
                            this._log('✅ Adaptive supervisor session active');
                        } catch (supErr) {
                            this._log(`⚠️ Adaptive supervisor init failed (non-blocking): ${supErr.message}`);
                            supervisor = null;
                            context.supervisor = null;
                        }
                    } else {
                        this._log(`  Adaptive supervisor: SKIPPED (tier=${cogMetrics?.adaptiveScaling?.tier || 'unknown'})`);
                    }
                }

                // ── Cognitive Tier Propagation ───────────────────────
                // After SCRIPTGEN, extract the complexity tier from cognitive
                // metrics and propagate it to context so ALL downstream stages
                // (Execute, Self-Heal, BugGenie) can adapt their behavior.
                // This is the inference-time scaling mechanism at pipeline level.
                if (stage === STAGES.SCRIPTGEN) {
                    const cogMetrics = result?.cognitiveMetrics || result?.metrics;
                    const tier = cogMetrics?.adaptiveScaling?.tier || 'moderate';
                    context.cognitiveTier = tier;
                    context.cognitiveScaling = this._getCognitiveScalingParams(tier);

                    this._log(`🧠 Cognitive tier propagated: ${tier} → ${JSON.stringify(context.cognitiveScaling)}`);
                    contextStore.addNote('cognitive',
                        `Pipeline scaling: tier=${tier}, ` +
                        `healingMaxIter=${context.cognitiveScaling.healingMaxIterations}, ` +
                        `executionTimeout=${context.cognitiveScaling.executionTimeoutMs}ms, ` +
                        `bugGenieDepth=${context.cognitiveScaling.bugGenieAnalysisDepth}`
                    );

                    // Emit cognitive scaling event for dashboard
                    this._eventBridge.push('cognitive_scaling', context.runId, {
                        tier,
                        scaling: context.cognitiveScaling,
                        source: 'scriptgen_metrics',
                    });
                }

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
            this._contextStoreManager.cleanup(contextRunId);
        }
        const coordinatorStats = coordinator.getStats();

        const result = {
            ticketId,
            mode,
            runId,
            scenario: scenarioId ? {
                id: scenarioId,
                name: context.scenarioName,
                authState: context.authState,
            } : null,
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
                evidenceManifest: context.evidenceManifestPath,
                report: context.reportPath,
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
                return this._runScriptGeneratorDispatch(context, onProgress);

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

        // ── File-system checks (original) ───────────────────────────
        const requiredFiles = [
            { name: 'test-data', rel: 'tests/test-data/testData.js' },
            { name: 'page-objects', rel: 'tests/pageobjects/POmanager.js' },
            { name: 'browser-config', rel: 'tests/config/config.js' },
            { name: 'popup-handler', rel: 'tests/utils/popupHandler.js' },
        ];

        for (const file of requiredFiles) {
            checks.push({
                name: file.name,
                passed: fs.existsSync(path.join(this.projectRoot, file.rel)),
            });
        }

        // ── OODA: Include health check summary from context store ───
        // The OODA health check ran before this stage. Pull its notes
        // so preflight result includes environment readiness info.
        if (context.contextStore) {
            const oodaNotes = context.contextStore.query({ agent: 'ooda' });
            if (oodaNotes.length > 0) {
                const healthNote = oodaNotes.find(n =>
                    n.content && n.content.includes('Environment health:')
                );
                if (healthNote) {
                    checks.push({
                        name: 'ooda-health',
                        passed: !healthNote.content.includes('ABORT'),
                        note: healthNote.content,
                    });
                }
            }
        }

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
                ticketId: context.ticketId,
                runId: context.runId,
                scenarioId: context.scenarioId,
                authState: context.authState,
                ticketContext: `Generate test cases for Jira ticket ${context.ticketId}. ` +
                    `${this._buildScenarioPrompt(context)} ` +
                    'Use the fetch_jira_ticket tool to get ticket details, then assess whether the Jira summary, description, and acceptance criteria are sufficient. ' +
                    'If the ticket is sparse or ambiguous, search the knowledge base for requirements, user story context, and business rules before finalizing coverage, then ' +
                    'use the generate_test_case_excel tool to create the Excel file.',
                taskDescription: `Generate test cases and gather requirements context for Jira ticket ${context.ticketId}${context.scenarioId ? ` (${context.scenarioName || context.scenarioId})` : ''}`,
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
                (context.scenarioId
                    ? `MISSION SCENARIO:\n- Scenario ID: ${context.scenarioId}\n- Scenario Name: ${context.scenarioName || context.scenarioId}\n- Auth State: ${context.authState}\n- Generate test cases ONLY for this scenario branch.\n- If auth state is authenticated, include login-required coverage.\n- If auth state is unauthenticated, avoid login and validate guest or access-control behavior.\n\n`
                    : '') +
                'Steps:\n' +
                `1. Use the fetch_jira_ticket tool with ticketId "${context.ticketId}" to get full ticket details.\n` +
                '   (This is a custom tool available to you — call it directly by name.)\n' +
                '2. Analyze the ticket summary, description, acceptance criteria, labels, components, and any linked business context in the ticket.\n' +
                '3. If the Jira details are sparse, ambiguous, or insufficient for strong test coverage, call search_knowledge_base with the feature name plus terms like "acceptance criteria", "requirements", or "user story".\n' +
                '   - Use the ticket summary, labels, components, and acceptance criteria terms to form the KB query.\n' +
                '   - If KB search returns relevant pages, use get_knowledge_base_page for the top result when you need more detail.\n' +
                '   - Use KB findings to expand coverage, but do not invent behavior that conflicts with Jira.\n' +
                '4. Generate optimized test cases following the required format:\n' +
                '   - Pre-Conditions row\n' +
                '   - Test Step ID | Specific Activity or Action | Expected Results | Actual Results\n' +
                '   - First step must be launching the application\n' +
                '   - Combine repetitive steps, keep it concise\n' +
                '5. Use the generate_test_case_excel tool to save test cases as Excel\n' +
                '   - Pass testSteps as a JSON array string with objects: { stepId, action, expected, actual }\n' +
                '6. Display the test cases in a markdown table\n\n' +
                'IMPORTANT: Use the fetch_jira_ticket custom tool to get ticket data. ' +
                'Do NOT use shell scripts or try to call external APIs directly. ' +
                'When Jira details are weak, you are expected to enrich coverage using the knowledge base tools before finalizing the test cases.';

            onProgress(STAGES.TESTGENIE, 'Generating test cases...');
            const responseText = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'testgenie', 300000),
                onDelta: (delta) => {
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.runId, {
                            agent: 'testgenie',
                            stage: STAGES.TESTGENIE,
                            delta,
                        });
                    }
                },
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
                context.testCasesPath = this._copyArtifactForScenario(context.testCasesPath, context);
                // Register artifact in shared context
                if (context.contextStore) {
                    context.contextStore.registerArtifact('testgenie', 'testCases', context.testCasesPath, {
                        summary: `${excelFiles.length} Excel file(s) generated for ${context.ticketId}`,
                    });
                }
            } else if (responseText && responseText.length > 50) {
                // Fallback: save the agent's response as markdown test cases
                const fallbackPath = path.join(testCasesDir, `${this._getScenarioFileStem(context, 'testcases')}.md`);
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

    async _runScriptGeneratorDispatch(context, onProgress) {
        const cognitiveConfig = this.config.cognitiveLoop || {};
        const useCognitive = cognitiveConfig.enabled !== false;

        if (useCognitive) {
            this._log('🧠 Cognitive QA Loop ENABLED — using multi-phase generation');
            try {
                const result = await this._runCognitiveScriptGen(context, onProgress);

                // If cognitive loop succeeded, return its result
                if (result.success) return result;

                // If fallback is enabled and cognitive loop failed, try legacy
                if (cognitiveConfig.fallbackToLegacy !== false) {
                    this._log('⚠️ Cognitive loop failed — falling back to legacy single-shot ScriptGenerator');
                    onProgress(STAGES.SCRIPTGEN, 'Cognitive loop failed, falling back to legacy generation...');
                    return this._runScriptGenerator(context, onProgress);
                }

                return result;
            } catch (error) {
                this._log(`❌ Cognitive loop error: ${error.message}`);
                if (cognitiveConfig.fallbackToLegacy !== false) {
                    this._log('⚠️ Falling back to legacy ScriptGenerator');
                    return this._runScriptGenerator(context, onProgress);
                }
                throw error;
            }
        }

        // Legacy mode
        return this._runScriptGenerator(context, onProgress);
    }

    async _runCognitiveScriptGen(context, onProgress) {
        this._log('🧠 Running Cognitive Script Generation (5-phase loop)...');

        try {
            const { CognitiveScriptGenerator } = require('./cognitive-script-generator');

            const cognitive = new CognitiveScriptGenerator({
                sessionFactory: this.sessionFactory,
                config: this.config,
                learningStore: this.learningStore,
                groundingStore: this.groundingStore,
                eventBridge: this._eventBridge,
                verbose: this.verbose,
            });

            const result = await cognitive.generate({
                ticketId: context.ticketId,
                runId: context.runId,
                scenarioId: context.scenarioId,
                scenarioName: context.scenarioName,
                authState: context.authState,
                testCases: context.testCasesPath
                    ? `Test cases at: ${context.testCasesPath}`
                    : '',
                testCasesPath: context.testCasesPath,
                appUrl: context.appUrl,
                contextStore: context.contextStore,
            }, (phase, message) => {
                onProgress(STAGES.SCRIPTGEN, `[${phase.toUpperCase()}] ${message}`);
            });

            // Map cognitive result to pipeline stage result
            if (result.success && result.specPath) {
                context.specPath = this._copyArtifactForScenario(result.specPath, context);
                context.explorationPath = this._copyArtifactForScenario(result.explorationPath, context);

                // Register artifacts
                if (context.contextStore) {
                    context.contextStore.registerArtifact('cognitive-scriptgen', 'specFile', result.specPath, {
                        summary: `Cognitive-generated Playwright spec for ${context.ticketId}`,
                        confidence: result.confidence,
                        phases: result.phaseResults,
                    });
                    if (result.explorationPath) {
                        context.contextStore.registerArtifact('cognitive-scriptgen', 'exploration', result.explorationPath, {
                            summary: `Cognitive exploration data for ${context.ticketId}`,
                        });
                    }
                }
            }

            return {
                success: result.success,
                blocking: !result.success,
                message: result.success
                    ? `Cognitive script generated (confidence: ${result.confidence}%): ${path.basename(result.specPath)}`
                    : `Cognitive loop ${result.status}: ${result.metrics?.error || 'phase failed'}`,
                artifact: result.specPath,
                exploration: result.explorationPath,
                error: result.success ? null : `Cognitive loop status: ${result.status}`,
                cognitiveMetrics: result.metrics,
                phaseResults: result.phaseResults,
            };
        } catch (error) {
            this._log(`❌ Cognitive script generation error: ${error.message}`);
            return {
                success: false,
                blocking: true,
                message: `Cognitive generation failed: ${error.message}`,
                error: error.message,
            };
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
            const scenarioPrompt = this._buildScenarioPrompt(context);

            // Create session
            const sessionInfo = await this.sessionFactory.createAgentSession('scriptgenerator', {
                ticketId: context.ticketId,
                runId: context.runId,
                scenarioId: context.scenarioId,
                authState: context.authState,
                frameworkInventory,
                historicalContext,
                ticketContext: [testCaseContext, scenarioPrompt].filter(Boolean).join('\n'),
                taskDescription: `Generate Playwright automation script for ticket ${context.ticketId}${context.scenarioId ? ` (${context.scenarioName || context.scenarioId})` : ''}`,
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
                (context.scenarioId
                    ? `MISSION SCENARIO:\n- Scenario ID: ${context.scenarioId}\n- Scenario Name: ${context.scenarioName || context.scenarioId}\n- Auth State: ${context.authState}\n- Generate and validate ONLY this scenario branch.\n- Authenticated branch: use existing framework login/business functions and validate post-login behavior.\n- Unauthenticated branch: do not perform login unless the application redirects to an auth wall that must be asserted.\n\n`
                    : '') +
                'MANDATORY STEPS (in this exact order):\n' +
                '0. FIRST: Call get_framework_inventory to discover reusable code (page objects, business functions, PopupHandler, test data)\n' +
                '1. Navigate to the application using the unified_navigate MCP tool\n' +
                '2. Take accessibility snapshots using unified_snapshot\n' +
                '3. Validate key elements with SEMANTIC selectors (unified_get_by_role, unified_get_by_test_id, unified_get_by_label, unified_get_by_text)\n' +
                '4. Extract REAL content for assertions (unified_get_text_content, unified_get_attribute, unified_get_input_value)\n' +
                '5. Verify navigation state (unified_get_page_url or unified_expect_url)\n' +
                '6. Navigate through ALL pages in the test flow, snapshot each one, repeat steps 3-5\n' +
                '7. Save exploration data using save_exploration_data custom tool\n' +
                '8. Generate the .spec.js file using CAPTURED selectors + EXISTING framework methods\n' +
                '9. Validate the script using validate_generated_script\n\n' +
                'AVAILABLE MCP TOOLS — Navigation & Page:\n' +
                '- unified_navigate: Navigate to a URL\n' +
                '- unified_navigate_back / unified_navigate_forward: History navigation\n' +
                '- unified_reload: Reload current page\n' +
                '- unified_get_page_url: Get current URL (for assertions)\n' +
                '- unified_get_page_title: Get page title (for assertions)\n\n' +
                'AVAILABLE MCP TOOLS — Snapshot & Discovery:\n' +
                '- unified_snapshot: Capture full accessibility tree with element refs\n' +
                '- unified_get_by_role: Find element by ARIA role + name (BEST for buttons, links, headings)\n' +
                '- unified_get_by_test_id: Find element by data-testid (MOST STABLE)\n' +
                '- unified_get_by_label: Find element by label text (BEST for form fields)\n' +
                '- unified_get_by_text: Find element by visible text\n' +
                '- unified_get_by_placeholder: Find element by placeholder text\n' +
                '- unified_generate_locator: Auto-generate best locator for an element\n\n' +
                'AVAILABLE MCP TOOLS — Content Extraction (for assertions):\n' +
                '- unified_get_text_content: Extract text content from element\n' +
                '- unified_get_inner_text: Extract rendered text only\n' +
                '- unified_get_attribute: Extract element attribute (href, class, data-*)\n' +
                '- unified_get_input_value: Extract current input field value\n\n' +
                'AVAILABLE MCP TOOLS — Element State:\n' +
                '- unified_is_visible / unified_is_hidden: Check element visibility\n' +
                '- unified_is_enabled / unified_is_disabled: Check element interactability\n' +
                '- unified_is_checked: Check checkbox/radio state\n' +
                '- unified_is_editable: Check field editability\n\n' +
                'AVAILABLE MCP TOOLS — Interaction:\n' +
                '- unified_click: Click element\n' +
                '- unified_type: Type text (triggers autocomplete)\n' +
                '- unified_fill_form: Fill form fields\n' +
                '- unified_clear_input: Clear input field\n' +
                '- unified_select_option: Select dropdown option\n' +
                '- unified_check / unified_uncheck: Toggle checkboxes\n' +
                '- unified_press_key: Press keyboard key (Enter, Escape, Tab)\n' +
                '- unified_scroll_into_view: Scroll element into view before interacting\n\n' +
                'AVAILABLE MCP TOOLS — Waits & Assertions:\n' +
                '- unified_wait_for_element: Wait for element state (visible/hidden/attached)\n' +
                '- unified_wait_for: Wait for text/element/time\n' +
                '- unified_expect_url: Assert URL pattern\n' +
                '- unified_expect_title: Assert page title\n' +
                '- unified_expect_element_text: Assert element text content\n' +
                '- unified_expect_element_attribute: Assert element attribute\n' +
                '- unified_verify_text_visible: Verify text is visible on page\n\n' +
                'AVAILABLE MCP TOOLS — Advanced:\n' +
                '- unified_screenshot: Capture screenshot for debugging\n' +
                '- unified_evaluate: Execute JavaScript on page\n' +
                '- unified_console_messages: Get browser console messages\n' +
                '- unified_page_errors: Get page JS errors\n\n' +
                'AVAILABLE CUSTOM TOOLS:\n' +
                '- get_framework_inventory: Scan test framework codebase (MANDATORY — call FIRST)\n' +
                '- save_exploration_data: Save exploration JSON\n' +
                '- validate_generated_script: Validate the .spec.js file\n' +
                '- get_assertion_config: Get assertion patterns and rules\n' +
                '- suggest_popup_handler: Get popup handling recommendations\n' +
                '- get_historical_failures: Check for known failures on target pages\n\n' +
                `${testCaseContext ? `Test cases reference: ${testCaseContext}\n\n` : ''}` +
                'FRAMEWORK REQUIREMENTS (enforced — script will be REJECTED if violated):\n' +
                '- Import launchBrowser from ../../config/config — NOT manual browser setup\n' +
                '- Import POmanager from ../../pageobjects/POmanager — use existing page objects\n' +
                '- Import { PopupHandler } from ../../utils/popupHandler — for popup dismissal\n' +
                '- Import { userTokens, baseUrl } from ../../test-data/testData — NO hardcoded URLs/tokens\n' +
                '- Use test.describe.serial() — NOT test.describe() — for shared browser state\n' +
                '- Use auto-retrying assertions ONLY — NO expect(await el.textContent())\n' +
                '- NO page.waitForTimeout() — use waitForLoadState, toBeVisible, waitForSelector\n' +
                '- Close page, context, AND browser in afterAll with null/closed guards\n' +
                '- REUSE existing business functions and page object methods from the framework inventory\n\n' +
                'PROHIBITED ACTIONS (strictly enforced):\n' +
                '- Do NOT use runInTerminal, powershell, or any shell/terminal tool\n' +
                '- Do NOT run npx playwright test — test execution is a SEPARATE pipeline stage\n' +
                '- Do NOT launch standalone Playwright browsers via require("playwright")\n' +
                '- Do NOT guess selectors — every selector MUST come from MCP snapshot/get_by_* output\n' +
                '- Do NOT hardcode URLs containing token= — use userTokens from testData.js';

            onProgress(STAGES.SCRIPTGEN, 'Exploring application via MCP...');
            const scriptResponse = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'scriptgenerator', 600000),
                onDelta: (delta) => {
                    // Forward AI streaming tokens to EventBridge for real-time dashboard display
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.runId, {
                            agent: 'scriptgenerator',
                            stage: STAGES.SCRIPTGEN,
                            delta,
                        });
                    }
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

            context.specPath = this._copyArtifactForScenario(context.specPath, context);

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
                context.explorationPath = this._copyArtifactForScenario(explorationFile, context);
                if (context.contextStore) {
                    context.contextStore.registerArtifact('scriptgenerator', 'exploration', context.explorationPath, {
                        summary: `MCP exploration data for ${context.ticketId}`,
                    });
                }
            }

            // If no spec file found, save the agent response for debugging
            if (!context.specPath && scriptResponse && scriptResponse.length > 50) {
                this._log(`⚠️ ScriptGenerator responded (${scriptResponse.length} chars) but no .spec.js file was created on disk`);
                const debugDir = path.join(__dirname, '..', 'test-artifacts');
                if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                const debugPath = path.join(debugDir, `${this._getScenarioFileStem(context, 'scriptgen-response')}.md`);
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

        // ── Cognitive Inference-Time Scaling ─────────────────────────
        // Use cognitive tier to adapt execution timeout. Complex tests
        // with multi-page flows need more time than simple ones.
        const baseTimeout = getStageTimeout(this.config, 'execution', 180000);
        const scaledTimeout = context.cognitiveScaling?.executionTimeoutMs || baseTimeout;
        const executionTimeout = Math.max(baseTimeout, scaledTimeout);
        if (context.cognitiveTier) {
            this._log(`🧠 Execution timeout scaled for tier=${context.cognitiveTier}: ${executionTimeout}ms`);
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
                    timeout: executionTimeout,
                    env: {
                        ...process.env,
                        SDK_RUN_ID: context.runId,
                        SDK_TICKET_ID: context.ticketId,
                        SDK_SCENARIO_ID: context.scenarioId || '',
                        SDK_AUTH_STATE: context.authState || 'unspecified',
                        QA_EVIDENCE_ENABLED: process.env.QA_EVIDENCE_ENABLED || 'true',
                    },
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

            this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

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

                this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

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

            this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

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

        // ── Cognitive Inference-Time Scaling ─────────────────────────
        // Adapt healing intensity based on the cognitive complexity tier.
        // Complex tickets get more healing iterations and longer timeouts.
        const scaling = context.cognitiveScaling;
        if (scaling) {
            this._log(`🧠 Healing scaled for tier=${context.cognitiveTier}: maxIter=${scaling.healingMaxIterations}, timeout=${scaling.healingTimeoutMs}ms`);
        }

        const healResult = await this.selfHealing.heal(context.ticketId, context.specPath, {
            maxIterations: scaling?.healingMaxIterations,
            timeoutMs: scaling?.healingTimeoutMs,
            cognitiveTier: context.cognitiveTier,
        });
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
                        this._refreshEvidenceManifest(context, { phase: STAGES.SELF_HEAL });
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

        // ── Cognitive Inference-Time Scaling ─────────────────────────
        // Adapt BugGenie analysis depth based on complexity tier.
        // Complex tickets get deeper root cause analysis in prompts.
        const scaling = context.cognitiveScaling;
        const analysisDepth = scaling?.bugGenieAnalysisDepth || 'standard';
        const bugGenieTimeout = scaling?.bugGenieTimeoutMs || getStageTimeout(this.config, 'buggenie', 180000);
        if (context.cognitiveTier) {
            this._log(`🧠 BugGenie scaled for tier=${context.cognitiveTier}: depth=${analysisDepth}, timeout=${bugGenieTimeout}ms`);
        }

        let session = null;
        let sessionId = null;

        try {
            const sessionInfo = await this.sessionFactory.createAgentSession('buggenie', {
                ticketId: context.ticketId,
                runId: context.runId,
                scenarioId: context.scenarioId,
                authState: context.authState,
                ticketContext: [
                    `Ticket: ${context.ticketId}`,
                    context.scenarioId ? `Scenario: ${context.scenarioName || context.scenarioId} (${context.authState})` : '',
                    `Spec: ${context.specPath || 'unknown'}`,
                    `Failed tests: ${context.testResults?.failedTests?.join(', ') || 'unknown'}`,
                    `Error: ${(context.testResults?.error || '').substring(0, 1000)}`,
                    `Healing attempted: ${context.healingResult?.iterations || 0} iterations`,
                    `Healing result: ${context.healingResult?.message || 'not attempted'}`,
                    context.cognitiveTier ? `Cognitive complexity tier: ${context.cognitiveTier}` : '',
                ].filter(Boolean).join('\n'),
                taskDescription: `Create bug ticket for test failures in ${context.ticketId}: ${context.testResults?.failedTests?.join(', ') || 'unknown failures'}`,
                contextStore: context.contextStore,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Build depth-aware prompt based on cognitive scaling
            const depthInstructions = {
                shallow: 'Provide a concise bug report with the failure summary and basic steps to reproduce.',
                standard: 'Provide a detailed bug report with root cause analysis, steps to reproduce, and environment context.',
                deep: [
                    'Provide a comprehensive bug report with DEEP root cause analysis.',
                    'Use Chain-of-Thought reasoning to trace the failure:',
                    '1. What is the immediate error? (surface symptom)',
                    '2. What selector/element/action triggered it? (proximate cause)',
                    '3. Why did the healing engine fail to fix it? (healing gap analysis)',
                    '4. What is the likely APPLICATION root cause vs TEST root cause?',
                    '5. Are there related failures suggesting a systemic issue?',
                    'Include all findings in the bug description with clear evidence chain.',
                ].join('\n'),
            };

            const prompt =
                `Create a bug ticket for test failures in ${context.ticketId}.\n\n` +
                `Failed tests: ${context.testResults?.failedTests?.join(', ') || 'unknown'}\n` +
                `Error details: ${(context.testResults?.error || '').substring(0, 2000)}\n\n` +
                `Analysis depth: ${analysisDepth.toUpperCase()}\n` +
                `${depthInstructions[analysisDepth] || depthInstructions.standard}\n\n` +
                'Follow the bug ticket format from the project standards.';

            onProgress(STAGES.BUGGENIE, `Creating bug ticket (${analysisDepth} analysis)...`);
            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: bugGenieTimeout,
                onDelta: (delta) => {
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.runId, {
                            agent: 'buggenie',
                            stage: STAGES.BUGGENIE,
                            delta,
                        });
                    }
                },
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
            scenario: context.scenarioId ? {
                id: context.scenarioId,
                name: context.scenarioName,
                authState: context.authState,
            } : null,
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
        const reportFile = path.join(reportsDir, `${this._getScenarioFileStem(context, 'pipeline-report')}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
        context.reportPath = reportFile;
        this._refreshEvidenceManifest(context, { phase: STAGES.REPORT, reportPath: reportFile });

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
            const fileName = `${this._getScenarioFileStem(context, `${context.runId}-test-results`)}.json`;
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

    _refreshEvidenceManifest(context, options = {}) {
        try {
            if (!this.evidenceStore) return null;

            const { manifestPath, manifest } = this.evidenceStore.saveManifest(context, options);
            context.evidenceManifestPath = manifestPath;

            if (context.contextStore) {
                context.contextStore.registerArtifact('pipeline-runner', 'evidenceManifest', manifestPath, {
                    summary: `Evidence manifest with ${manifest.summary.totalArtifacts} artifacts`,
                    screenshots: manifest.summary.screenshots,
                    videos: manifest.summary.videos,
                    traces: manifest.summary.traces,
                    phase: options.phase || null,
                });
            }

            return manifestPath;
        } catch (error) {
            this._log(`⚠️ Failed to refresh evidence manifest: ${error.message}`);
            return null;
        }
    }

    _resolveExistingArtifacts(context) {
        const ticketId = context.ticketId;
        const scenarioSlug = context.scenarioSlug;

        // Check for existing spec file
        const specsDir = path.join(this.projectRoot, 'tests', 'specs');
        const variations = [
            ...(scenarioSlug ? [
                path.join(specsDir, ticketId.toLowerCase(), `${ticketId}-${scenarioSlug}.spec.js`),
                path.join(specsDir, ticketId.toLowerCase(), `${ticketId.toUpperCase()}-${scenarioSlug}.spec.js`),
            ] : []),
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
            __dirname, '..', 'exploration-data', `${this._getScenarioFileStem(context, 'exploration')}.json`
        );
        if (fs.existsSync(explorationFile)) {
            context.explorationPath = explorationFile;
        } else {
            const fallbackExplorationFile = path.join(
                __dirname, '..', 'exploration-data', `${ticketId}-exploration.json`
            );
            if (fs.existsSync(fallbackExplorationFile)) {
                context.explorationPath = this._copyArtifactForScenario(fallbackExplorationFile, context);
            }
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

    _getScenarioSlug(scenarioId, authState) {
        const raw = scenarioId || authState || '';
        return String(raw)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || '';
    }

    _getScenarioFileStem(context, suffix) {
        const parts = [context.ticketId];
        if (context.scenarioSlug) parts.push(context.scenarioSlug);
        if (suffix) parts.push(suffix);
        return parts.join('-');
    }

    _buildScenarioPrompt(context) {
        if (!context.scenarioId) return '';

        return [
            `Mission scenario: ${context.scenarioName || context.scenarioId}`,
            `Auth state: ${context.authState}`,
            context.scenario?.persona ? `Persona: ${context.scenario.persona}` : '',
            context.scenario?.credentialsRef ? `Credentials ref: ${context.scenario.credentialsRef}` : '',
        ].filter(Boolean).join('\n');
    }

    _copyArtifactForScenario(sourcePath, context) {
        if (!sourcePath || !context.scenarioSlug || !fs.existsSync(sourcePath)) {
            return sourcePath;
        }

        const parsed = path.parse(sourcePath);
        if (parsed.name.toLowerCase().includes(context.scenarioSlug)) {
            return sourcePath;
        }

        const targetPath = path.join(parsed.dir, `${parsed.name}-${context.scenarioSlug}${parsed.ext}`);
        try {
            fs.copyFileSync(sourcePath, targetPath);
            return targetPath;
        } catch (error) {
            this._log(`⚠️ Failed to isolate scenario artifact ${path.basename(sourcePath)}: ${error.message}`);
            return sourcePath;
        }
    }

    // ─── Cognitive Inference-Time Scaling ──────────────────────────
    // Maps the cognitive complexity tier (from ScriptGen's Analyst phase)
    // into concrete parameters for all downstream pipeline stages.
    // This is how "thinking time" is allocated proportionally across the
    // entire pipeline — not just the script generation phase.

    _getCognitiveScalingParams(tier) {
        const scalingConfig = this.config.cognitiveLoop?.adaptiveScaling || {};
        const riskMultiplier = scalingConfig.riskMultiplier || 1.5;

        const tiers = {
            simple: {
                // Fast track — minimal resources, low risk
                executionTimeoutMs: 120000,          // 2 min
                healingMaxIterations: 2,
                healingTimeoutMs: 180000,             // 3 min
                bugGenieAnalysisDepth: 'shallow',     // Just failure summary
                bugGenieTimeoutMs: 120000,            // 2 min
                retryFullStageAllowed: false,
                supervisorReviewDepth: 'brief',
            },
            moderate: {
                // Standard track — balanced resources
                executionTimeoutMs: 180000,          // 3 min
                healingMaxIterations: 3,
                healingTimeoutMs: 300000,             // 5 min
                bugGenieAnalysisDepth: 'standard',    // Root cause + steps
                bugGenieTimeoutMs: 180000,            // 3 min
                retryFullStageAllowed: true,
                supervisorReviewDepth: 'standard',
            },
            complex: {
                // Deep track — maximum resources, high risk
                executionTimeoutMs: Math.round(240000 * riskMultiplier), // 4 min × risk
                healingMaxIterations: Math.round(4 * riskMultiplier),
                healingTimeoutMs: Math.round(420000 * riskMultiplier),   // 7 min × risk
                bugGenieAnalysisDepth: 'deep',        // Full ToT root cause analysis
                bugGenieTimeoutMs: Math.round(300000 * riskMultiplier),  // 5 min × risk
                retryFullStageAllowed: true,
                supervisorReviewDepth: 'comprehensive',
            },
        };

        return tiers[tier] || tiers.moderate;
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
