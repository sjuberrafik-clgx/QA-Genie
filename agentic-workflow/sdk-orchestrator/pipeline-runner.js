/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PIPELINE RUNNER — SDK-Orchestrated Pipeline Execution
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Chains agent SDK sessions into a complete pipeline:
 *
 *   PREFLIGHT → TESTGENIE → QG_EXCEL → SCRIPTGEN → QG_EXPLORATION → QG_SCRIPT → EXECUTE
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
const { extractJSON, getStageTimeout } = require('./utils');
const { runCommand } = require('./terminal-runner');
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
    QG_EXPLORATION: 'qg_exploration',
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
    STAGES.QG_EXPLORATION,
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
    generate: [STAGES.PREFLIGHT, STAGES.SCRIPTGEN, STAGES.QG_EXPLORATION, STAGES.QG_SCRIPT, STAGES.EXECUTE, STAGES.SELF_HEAL, STAGES.REPORT],
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
        const hybridContext = this._normalizeHybridContext(options);

        const startTime = Date.now();
        const runId = options.runId || `run_${ticketId}_${Date.now()}`;
        const contextRunId = options.contextRunId || (scenarioId ? `${runId}__${scenarioId}` : runId);

        // Initialize shared context store for this run
        const contextStore = this._contextStoreManager.getStore(contextRunId);
        contextStore.addNote('coordinator', `Pipeline started: ${ticketId} [mode: ${mode}]${scenarioId ? ` [scenario: ${scenarioId}]` : ''}`);
        contextStore.addNote('coordinator', `Input strategy: ${hybridContext.frameworkMode === 'manual' ? 'manual-url+testcases' : 'framework-autofetch'}`);
        if (hybridContext.executionTarget) {
            contextStore.addNote('coordinator', `Execution target override: ${hybridContext.executionTarget}`);
        }

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
            onProgress,
            onCommandEvent: typeof options.onCommandEvent === 'function' ? options.onCommandEvent : null,
            abortSignal: options.abortSignal || null,
            shouldCancel: typeof options.shouldCancel === 'function' ? options.shouldCancel : null,
            cancelled: false,
            scenario,
            scenarioId,
            scenarioName: scenario?.name || null,
            authState,
            scenarioSlug: this._getScenarioSlug(scenarioId, authState),
            frameworkMode: hybridContext.frameworkMode,
            appUrl: hybridContext.appUrl,
            testCaseSource: hybridContext.testCaseSource,
            testDataOverride: hybridContext.testDataOverride,
            executionTarget: hybridContext.executionTarget,
            hybridContext,
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
            commandMetrics: [],
            // Stage results
            stageResults: {},
        };

        if (!context.appUrl && context.frameworkMode !== 'manual') {
            context.appUrl = this._resolveFrameworkBaseUrl();
            context.hybridContext.appUrl = context.appUrl;
        }

        this._log(`\n${'═'.repeat(60)}`);
        this._log(`  PIPELINE: ${ticketId} [mode: ${mode}]${scenarioId ? ` [scenario: ${scenarioId}/${authState}]` : ''}`);
        if (context.appUrl) {
            this._log(`  URL: ${context.appUrl}`);
        }
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
                artifacts: {
                    executionMetrics: this._buildExecutionMetricsArtifact(context),
                },
                orchestration: {},
                error: pipelineError,
            };
        }

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];

            if (this._isCancellationRequested(context)) {
                context.cancelled = true;
                pipelineError = 'Cancelled by user';
                this._log('🛑 Pipeline cancellation requested');
                break;
            }

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

                if (result?.cancelled) {
                    context.cancelled = true;
                    pipelineError = 'Cancelled by user';
                    this._log(`🛑 Stage ${stage} cancelled by user`);
                    break;
                }

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
                if (this._isAbortError(error) || this._isCancellationRequested(context)) {
                    context.cancelled = true;
                    pipelineError = 'Cancelled by user';
                    context.stageResults[stage] = {
                        success: false,
                        cancelled: true,
                        error: 'Cancelled by user',
                        blocking: false,
                    };
                    this._log(`🛑 Stage ${stage} cancelled`);
                } else {
                    pipelineError = `Stage ${stage} threw: ${error.message}`;
                    context.stageResults[stage] = { success: false, error: error.message, blocking: true };
                    this._log(`💥 Stage ${stage} threw: ${error.message}`);
                    onProgress(stage, `ERROR: ${error.message}`);
                }
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
                    if (this._isCancellationRequested(context)) {
                        context.cancelled = true;
                        pipelineError = 'Cancelled by user';
                        break;
                    }

                    onProgress(stage, `Starting ${stage} (restart)...`);
                    try {
                        const result = await this._executeStage(stage, context, onProgress);
                        context.stageResults[stage] = result;
                        lastCompletedStage = stage;
                        if (result?.cancelled) {
                            context.cancelled = true;
                            pipelineError = 'Cancelled by user';
                            break;
                        }
                        if (!result.success && result.blocking) {
                            pipelineError = `Stage ${stage} failed on restart: ${result.error || 'unknown'}`;
                            break;
                        }
                        onProgress(stage, result.message || 'Completed');
                    } catch (error) {
                        pipelineError = this._isAbortError(error) || this._isCancellationRequested(context)
                            ? 'Cancelled by user'
                            : `Stage ${stage} threw on restart: ${error.message}`;
                        if (pipelineError === 'Cancelled by user') {
                            context.cancelled = true;
                        }
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

        const finalSuccess = !context.cancelled && !pipelineError && this._computeOverallSuccess(context);
        const finalError = context.cancelled
            ? 'Cancelled by user'
            : this._derivePipelineFailureReason(context, pipelineError);

        const result = {
            ticketId,
            mode,
            runId,
            scenario: scenarioId ? {
                id: scenarioId,
                name: context.scenarioName,
                authState: context.authState,
            } : null,
            success: finalSuccess,
            cancelled: context.cancelled === true,
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
                executionMetrics: this._buildExecutionMetricsArtifact(context),
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
            error: finalError,
        };

        this._log(`\n${'═'.repeat(60)}`);
        this._log(`  PIPELINE ${finalSuccess ? 'COMPLETED' : 'FAILED'}`);
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

            case STAGES.QG_EXPLORATION:
                return this._runQualityGate('exploration', context);

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

        if (context.frameworkMode === 'manual') {
            checks.push({
                name: 'framework-files',
                passed: true,
                note: 'Skipped in manual mode (URL + testCaseSource provided)',
            });
        } else {
            for (const file of requiredFiles) {
                checks.push({
                    name: file.name,
                    passed: fs.existsSync(path.join(this.projectRoot, file.rel)),
                });
            }
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

        const providedTestCasesPath = this._materializeProvidedTestCases(context);
        if (providedTestCasesPath) {
            context.testCasesPath = this._copyArtifactForScenario(providedTestCasesPath, context);
            if (context.contextStore) {
                context.contextStore.registerArtifact('testgenie', 'testCases', context.testCasesPath, {
                    summary: 'Using provided test cases input',
                    source: 'manual-input',
                });
            }

            return {
                success: true,
                blocking: false,
                message: `Using provided test cases: ${path.basename(context.testCasesPath)}`,
                artifact: context.testCasesPath,
            };
        }

        if (context.frameworkMode === 'manual') {
            return {
                success: false,
                blocking: true,
                message: 'Manual mode requires testCaseSource input',
                error: 'Missing testCaseSource for manual run mode',
            };
        }

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
                frameworkMode: context.frameworkMode,
                testDataOverride: context.testDataOverride,
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
                testCaseContext = `Test cases source is at: ${context.testCasesPath}`;
            }
            const scenarioPrompt = this._buildScenarioPrompt(context);
            const appUrlContext = context.appUrl
                ? `Target app URL: ${context.appUrl}`
                : 'Target app URL must be auto-resolved from framework test data (baseUrl/userTokens).';
            const runInputContext = `Framework mode: ${context.frameworkMode}`;
            const testDataOverrideContext = context.testDataOverride !== null && context.testDataOverride !== undefined
                ? 'Runtime test data override is provided for this run; use it when generating data-dependent steps.'
                : '';
            const useFrameworkConventions = context.frameworkMode !== 'manual';
            const frameworkDiscoveryStep = useFrameworkConventions
                ? '6. Call get_framework_inventory to discover reusable code (page objects, business functions, PopupHandler, test data) before creating the spec file\n'
                : '6. Framework inventory is optional in manual mode; proceed with standalone Playwright if no framework artifacts exist\n';
            const scriptBuildStep = useFrameworkConventions
                ? '8. Generate the .spec.js file using CAPTURED selectors + EXISTING framework methods\n'
                : '8. Generate the .spec.js file using CAPTURED selectors + standalone Playwright patterns (CommonJS)\n';
            const frameworkRequirementsBlock = useFrameworkConventions
                ? 'FRAMEWORK REQUIREMENTS (enforced — script will be REJECTED if violated):\n' +
                '- Import launchBrowser from ../../config/config — NOT manual browser setup\n' +
                '- Import POmanager from ../../pageobjects/POmanager — use existing page objects\n' +
                '- Import { PopupHandler } from ../../utils/popupHandler — for popup dismissal\n' +
                '- Import { userTokens, baseUrl } from ../../test-data/testData — NO hardcoded URLs/tokens\n' +
                '- Use test.describe.serial() — NOT test.describe() — for shared browser state\n' +
                '- Use auto-retrying assertions ONLY — NO expect(await el.textContent())\n' +
                '- NO page.waitForTimeout() — use waitForLoadState, toBeVisible, waitForSelector\n' +
                '- Close page, context, AND browser in afterAll with null/closed guards\n' +
                '- REUSE existing business functions and page object methods from the framework inventory\n\n'
                : 'MANUAL MODE REQUIREMENTS (framework not required):\n' +
                '- Use CommonJS with require(\'@playwright/test\')\n' +
                '- Keep selectors MCP-derived and stable; avoid brittle nth-child chains\n' +
                '- Use auto-retrying assertions and avoid page.waitForTimeout()\n' +
                '- Include cleanup hooks if browser/context are created explicitly\n\n';
            const frameworkProhibitedRule = useFrameworkConventions
                ? '- Do NOT launch standalone Playwright browsers via require("playwright")\n'
                : '';
            const frameworkInventoryToolHint = useFrameworkConventions
                ? '- get_framework_inventory: Scan test framework codebase (MANDATORY before writing spec)\n'
                : '- get_framework_inventory: Optional in manual mode; use only if reusable framework code exists\n';

            // Create session
            const sessionInfo = await this.sessionFactory.createAgentSession('scriptgenerator', {
                ticketId: context.ticketId,
                runId: context.runId,
                scenarioId: context.scenarioId,
                authState: context.authState,
                frameworkMode: context.frameworkMode,
                appUrl: context.appUrl,
                testDataOverride: context.testDataOverride,
                frameworkInventory,
                historicalContext,
                ticketContext: [runInputContext, appUrlContext, testCaseContext, testDataOverrideContext, scenarioPrompt].filter(Boolean).join('\n'),
                taskDescription: `Generate Playwright automation script for ticket ${context.ticketId}${context.scenarioId ? ` (${context.scenarioName || context.scenarioId})` : ''}`,
                contextStore: context.contextStore,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Send prompt
            // NOTE: In SDK context, MCP tools use RAW names without VS Code prefix.
            // unified_navigate (NOT mcp_unified-autom_unified_navigate)
            // unified_snapshot (NOT mcp_unified-autom_unified_snapshot)
            const glassMode = process.env.GLASS_MCP_ENABLED !== 'false';
            const prompt =
                `Generate a Playwright automation script for ticket ${context.ticketId}.\n\n` +
                'RUN INPUT STRATEGY:\n' +
                `- Framework mode: ${context.frameworkMode}\n` +
                (context.appUrl
                    ? `- Use this URL for first navigation: ${context.appUrl}\n`
                    : '- Resolve application URL from existing framework test data exports (baseUrl/userTokens) before navigation.\n') +
                (testDataOverrideContext ? `- ${testDataOverrideContext}\n` : '') +
                '\n' +
                (context.scenarioId
                    ? `MISSION SCENARIO:\n- Scenario ID: ${context.scenarioId}\n- Scenario Name: ${context.scenarioName || context.scenarioId}\n- Auth State: ${context.authState}\n- Generate and validate ONLY this scenario branch.\n- Authenticated branch: use existing framework login/business functions and validate post-login behavior.\n- Unauthenticated branch: do not perform login unless the application redirects to an auth wall that must be asserted.\n\n`
                    : '') +
                'MANDATORY STEPS (in this exact order):\n' +
                                (glassMode
                                        ? `0. FIRST: Navigate with open({url:"${context.appUrl || 'the resolved framework baseUrl'}"}).\n` +
                                            '1. Call see() on every page under test and use only its durable handles for targets.\n' +
                                            '2. Use read() to capture real assertion values and page URL/title.\n' +
                                            '3. Use do() for interactions and wait() for bounded application conditions.\n' +
                                            '4. Navigate through every page in this scenario and repeat see/read/navigation verification.\n' +
                                            frameworkDiscoveryStep +
                                            '7. Save exploration data using save_exploration_data with source "glass-see".\n' +
                                            scriptBuildStep +
                                            '9. Validate the script using validate_generated_script.\n\n' +
                                            'AVAILABLE GLASS TOOLS:\n' +
                                            '- open: navigate and manage tabs\n' +
                                            '- see: perceive ranked affordances and durable handles\n' +
                                            '- do: click, fill, select, check, press, upload, or screenshot\n' +
                                            '- read: extract text, value, attribute, HTML, table, URL, or title\n' +
                                            '- wait: wait for bounded element, text, URL, title, load, or network conditions\n' +
                                            '- net: observe or control network traffic\n' +
                                            '- devtool: use validated CDP commands\n' +
                                            '- script: run audited in-page JavaScript\n\n'
                                        : `0. FIRST: Navigate to the application using unified_navigate to ${context.appUrl || 'the resolved framework baseUrl'} (or unified_execute_exploration with an explicit navigate step)\n` +
                                            '1. Take accessibility snapshots using unified_snapshot\n' +
                                            '2. Validate key elements with semantic unified_get_by_* selectors\n' +
                                            '3. Extract real content using unified_get_text_content, unified_get_attribute, or unified_get_input_value\n' +
                                            '4. Verify navigation state using unified_get_page_url or unified_expect_url\n' +
                                            '5. Navigate through all pages in the flow and repeat steps 2-4\n' +
                                            frameworkDiscoveryStep +
                                            '7. Save exploration data using save_exploration_data\n' +
                                            scriptBuildStep +
                                            '9. Validate the script using validate_generated_script\n\n') +
                'AVAILABLE CUSTOM TOOLS:\n' +
                frameworkInventoryToolHint +
                '- save_exploration_data: Save exploration JSON\n' +
                '- validate_generated_script: Validate the .spec.js file\n' +
                '- get_assertion_config: Get assertion patterns and rules\n' +
                '- suggest_popup_handler: Get popup handling recommendations\n' +
                '- get_historical_failures: Check for known failures on target pages\n\n' +
                `${testCaseContext ? `Test cases reference: ${testCaseContext}\n\n` : ''}` +
                frameworkRequirementsBlock +
                'PROHIBITED ACTIONS (strictly enforced):\n' +
                '- Do NOT use runInTerminal, powershell, or any shell/terminal tool\n' +
                '- Do NOT run npx playwright test — test execution is a SEPARATE pipeline stage\n' +
                frameworkProhibitedRule +
                `- Do NOT guess selectors — every selector MUST come from ${glassMode ? 'Glass see() handles' : 'MCP snapshot/get_by_* output'}\n` +
                '- Do NOT hardcode URLs containing token= — use userTokens from testData.js';

            onProgress(
                STAGES.SCRIPTGEN,
                context.appUrl
                    ? `Exploring application via MCP (${context.appUrl})...`
                    : 'Exploring application via MCP...'
            );
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
            const explorationDir = path.join(__dirname, '..', 'exploration-data');
            const explorationCandidates = [
                path.join(explorationDir, `${this._getScenarioFileStem(context, 'exploration')}.json`),
                path.join(explorationDir, `${context.ticketId}-exploration.json`),
            ];
            const explorationFile = explorationCandidates.find(candidate => fs.existsSync(candidate));
            if (explorationFile) {
                context.explorationPath = explorationFile;
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

        if (gate === 'exploration' && (!artifactPath || !fs.existsSync(artifactPath))) {
            const fallbackExploration = path.join(
                __dirname,
                '..',
                'exploration-data',
                `${context.ticketId}-exploration.json`
            );
            if (fs.existsSync(fallbackExploration)) {
                artifactPath = fallbackExploration;
                context.explorationPath = fallbackExploration;
            }
        }

        if (!artifactPath || !fs.existsSync(artifactPath)) {
            return {
                success: false,
                blocking: gate === 'script' || gate === 'exploration',
                message: `${gate} artifact not found`,
                error: `No artifact at ${artifactPath || 'null'}`,
            };
        }

        if (gate === 'exploration') {
            try {
                const { QualityGates } = require('../../.github/agents/lib/quality-gates');
                const gateResult = QualityGates.validateMCPExploration({
                    ticketId: context.ticketId,
                    artifacts: { explorationPath: artifactPath },
                }, context.ticketId);

                return {
                    success: !!gateResult.passed,
                    blocking: !gateResult.passed,
                    message: gateResult.passed
                        ? 'Exploration quality gate passed'
                        : `Exploration quality gate failed: ${gateResult.error || 'validation failed'}`,
                    details: gateResult,
                    error: gateResult.passed ? null : (gateResult.error || 'Exploration validation failed'),
                };
            } catch (error) {
                return {
                    success: false,
                    blocking: true,
                    message: `Exploration gate validation error: ${error.message}`,
                    error: error.message,
                };
            }
        }

        // For script gate, run validate-script.js
        if (gate === 'script') {
            try {
                const content = fs.readFileSync(artifactPath, 'utf-8');

                if (context.frameworkMode === 'manual') {
                    const errors = [];
                    const warnings = [];

                    if (!artifactPath.endsWith('.spec.js')) {
                        errors.push('Manual mode script must use .spec.js extension');
                    }
                    if (!content.includes("require('@playwright/test')")) {
                        errors.push('Manual mode script must import @playwright/test via require()');
                    }
                    if (!/\btest\s*\(|test\.describe\s*\(/.test(content)) {
                        errors.push('Manual mode script must define at least one Playwright test');
                    }
                    if (content.includes('page.waitForTimeout(')) {
                        warnings.push('Avoid page.waitForTimeout(); use condition-based waits');
                    }

                    return {
                        success: errors.length === 0,
                        blocking: errors.length > 0,
                        errors,
                        warnings,
                        message: errors.length === 0
                            ? 'Manual mode script validation passed'
                            : `Manual mode validation failed: ${errors.length} error(s)`,
                    };
                }

                const { validateGeneratedScript } = require('../scripts/validate-script');

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

        const explicitExecutionTarget = this._resolveExecutionTarget(context.executionTarget);
        if (explicitExecutionTarget?.exists && explicitExecutionTarget.type === 'file') {
            context.specPath = explicitExecutionTarget.absolutePath;
        }

        const useExplicitTarget = context.mode === 'execute' && !!explicitExecutionTarget;
        const resolvedSpecPath = context.specPath && fs.existsSync(context.specPath)
            ? context.specPath
            : null;

        const targetArg = useExplicitTarget
            ? explicitExecutionTarget.targetArg
            : (resolvedSpecPath ? this._toRelativeTargetPath(resolvedSpecPath) : null);

        const targetLabel = useExplicitTarget
            ? explicitExecutionTarget.displayLabel
            : (resolvedSpecPath ? this._toRelativeTargetPath(resolvedSpecPath) : 'default');

        if (!targetArg) {
            const missingReason = useExplicitTarget
                ? `Execution target not found: ${context.executionTarget}`
                : 'No spec file to execute';

            return {
                success: false,
                blocking: true,
                message: missingReason,
                error: missingReason,
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

        const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const commandArgs = ['playwright', 'test', targetArg, '--reporter=json'];
        const commandLabel = `${npxCommand} ${commandArgs.join(' ')}`;
        const baseCommandMetric = {
            stage: STAGES.EXECUTE,
            scenarioId: context.scenarioId || null,
            scenarioName: context.scenarioName || null,
            authState: context.authState || 'unspecified',
            target: targetLabel,
            command: commandLabel,
        };

        if (this._isCancellationRequested(context)) {
            return {
                success: false,
                cancelled: true,
                blocking: false,
                message: `Execution cancelled (${targetLabel})`,
                error: 'Cancelled by user',
            };
        }

        this._emitCommandEvent(context, 'start', {
            stage: STAGES.EXECUTE,
            target: targetLabel,
            timeoutMs: executionTimeout,
            command: commandLabel,
        });

        let lastOutputHeartbeat = 0;
        const onOutput = (chunk, stream) => {
            const raw = chunk == null ? '' : String(chunk);
            if (!raw) return;

            // Emit a raw output chunk (preserves newlines) for the Live
            // Command Output tail. This is the lossless feed — consumers
            // that only care about a status heartbeat can ignore this.
            this._emitCommandChunk(context, {
                stage: STAGES.EXECUTE,
                target: targetLabel,
                stream,
                text: raw,
            });

            // Keep the pre-existing throttled, normalized status event so
            // stage panels stay stable and SSE clients with older handlers
            // continue to work.
            const normalized = this._normalizeCommandOutput(raw);
            if (!normalized) return;

            const now = Date.now();
            if (now - lastOutputHeartbeat < 2500) return;
            lastOutputHeartbeat = now;

            const snippet = normalized.substring(0, 220);
            this._emitCommandEvent(context, 'output', {
                stage: STAGES.EXECUTE,
                target: targetLabel,
                stream,
                text: snippet,
            });
        };

        try {
            const { stdout, stderr, exitCode, signal, startedAt, endedAt, durationMs, cancelToKillLatencyMs } = await runCommand({
                command: npxCommand,
                args: commandArgs,
                cwd: this.projectRoot,
                timeoutMs: executionTimeout,
                abortSignal: context.abortSignal || null,
                env: {
                    ...process.env,
                    SDK_RUN_ID: context.runId,
                    SDK_TICKET_ID: context.ticketId,
                    SDK_SCENARIO_ID: context.scenarioId || '',
                    SDK_AUTH_STATE: context.authState || 'unspecified',
                    QA_EVIDENCE_ENABLED: process.env.QA_EVIDENCE_ENABLED || 'true',
                },
                onStdout: (chunk) => onOutput(chunk, 'stdout'),
                onStderr: (chunk) => onOutput(chunk, 'stderr'),
            });

            this._emitCommandEvent(context, 'exit', {
                stage: STAGES.EXECUTE,
                target: targetLabel,
                exitCode: exitCode ?? 0,
                signal: signal || null,
                durationMs: Number.isFinite(durationMs) ? durationMs : null,
                cancelToKillLatencyMs: Number.isFinite(cancelToKillLatencyMs) ? cancelToKillLatencyMs : null,
            });

            this._recordCommandMetric(context, {
                ...baseCommandMetric,
                startedAt: startedAt || null,
                endedAt: endedAt || null,
                durationMs: Number.isFinite(durationMs) ? durationMs : null,
                cancelToKillLatencyMs: Number.isFinite(cancelToKillLatencyMs) ? cancelToKillLatencyMs : null,
                exitCode: Number.isInteger(exitCode) ? exitCode : 0,
                timedOut: false,
                cancelled: false,
            });

            const output = [stdout, stderr].filter(Boolean).join('\n');

            const result = extractJSON(output);
            const specs = this._collectPlaywrightSpecs(result);
            const failed = specs.filter(s => s.tests?.[0]?.status === 'failed');
            const passed = specs.filter(s => s.tests?.[0]?.status === 'passed');
            const passedAll = failed.length === 0 && specs.length > 0;

            // Save raw Playwright JSON for the Reports dashboard
            const rawResultsPath = this._saveRawTestResults(context, result);

            context.testResults = {
                totalCount: specs.length,
                passedCount: passed.length,
                failedCount: failed.length,
                passed: passedAll,
                failedTests: failed.map(s => s.title),
                rawResultsFile: rawResultsPath,
                executionTarget: targetLabel,
            };

            this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

            return {
                success: passedAll,
                blocking: !passedAll && this._shouldExecutionFailureBlock(context, 'test-failure'),
                message: `${passed.length}/${specs.length} tests passed (${targetLabel})`,
                testResults: context.testResults,
            };
        } catch (error) {
            const errorOutput = [error.stdout, error.stderr, error.message]
                .filter(Boolean)
                .join('\n');
            const blockingOnFailure = this._shouldExecutionFailureBlock(context, 'execution-error');

            if (this._isAbortError(error) || this._isCancellationRequested(context)) {
                this._emitCommandEvent(context, 'cancelled', {
                    stage: STAGES.EXECUTE,
                    target: targetLabel,
                    error: 'Cancelled by user',
                    durationMs: Number.isFinite(error.durationMs) ? error.durationMs : null,
                    cancelToKillLatencyMs: Number.isFinite(error.cancelToKillLatencyMs) ? error.cancelToKillLatencyMs : null,
                });

                this._recordCommandMetric(context, {
                    ...baseCommandMetric,
                    startedAt: error.startedAt || null,
                    endedAt: error.endedAt || null,
                    durationMs: Number.isFinite(error.durationMs) ? error.durationMs : null,
                    cancelToKillLatencyMs: Number.isFinite(error.cancelToKillLatencyMs) ? error.cancelToKillLatencyMs : null,
                    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
                    signal: error.signal || null,
                    timedOut: error.timedOut === true,
                    cancelled: true,
                    error: error.message,
                });

                return {
                    success: false,
                    cancelled: true,
                    blocking: false,
                    message: `Execution cancelled (${targetLabel})`,
                    error: 'Cancelled by user',
                };
            }

            this._emitCommandEvent(context, 'exit', {
                stage: STAGES.EXECUTE,
                target: targetLabel,
                exitCode: error.exitCode ?? null,
                signal: error.signal || null,
                error: error.message,
                durationMs: Number.isFinite(error.durationMs) ? error.durationMs : null,
                cancelToKillLatencyMs: Number.isFinite(error.cancelToKillLatencyMs) ? error.cancelToKillLatencyMs : null,
            });

            this._recordCommandMetric(context, {
                ...baseCommandMetric,
                startedAt: error.startedAt || null,
                endedAt: error.endedAt || null,
                durationMs: Number.isFinite(error.durationMs) ? error.durationMs : null,
                cancelToKillLatencyMs: Number.isFinite(error.cancelToKillLatencyMs) ? error.cancelToKillLatencyMs : null,
                exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
                signal: error.signal || null,
                timedOut: error.timedOut === true,
                cancelled: false,
                error: error.message,
            });

            // Try to parse JSON from error output (Playwright exits non-zero on test failures)
            try {
                const result = extractJSON(errorOutput);
                const specs = this._collectPlaywrightSpecs(result);
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
                    executionTarget: targetLabel,
                };

                this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

                return {
                    success: context.testResults.passed,
                    blocking: !context.testResults.passed && blockingOnFailure,
                    message: specs.length > 0
                        ? `${passed.length}/${specs.length} tests passed (${targetLabel})`
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
                executionTarget: targetLabel,
            };

            this._refreshEvidenceManifest(context, { phase: STAGES.EXECUTE });

            return {
                success: false,
                blocking: blockingOnFailure,
                message: `Test execution failed (${targetLabel})`,
                error: errorOutput.substring(0, 500),
            };
        }
    }

    async _runSelfHealing(context) {
        this._log('🔧 Running self-healing...');

        if (this._isCancellationRequested(context)) {
            return {
                success: false,
                cancelled: true,
                blocking: false,
                message: 'Self-healing cancelled by user',
                error: 'Cancelled by user',
            };
        }

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
            abortSignal: context.abortSignal || null,
            onCommandEvent: (event = {}) => {
                const type = event.type || 'progress';
                // Route raw output chunks to the lossless tail, keep other
                // events on the throttled status channel.
                if (type === 'output_chunk') {
                    this._emitCommandChunk(context, {
                        stage: STAGES.SELF_HEAL,
                        target: event.specPath || null,
                        stream: event.stream || 'stdout',
                        text: event.text || '',
                    });
                    return;
                }
                this._emitCommandEvent(context, `healing_${type}`, {
                    stage: STAGES.SELF_HEAL,
                    ...event,
                });
            },
        });
        context.healingResult = healResult;

        if (Array.isArray(healResult.commandMetrics)) {
            for (const metric of healResult.commandMetrics) {
                this._recordCommandMetric(context, {
                    scenarioId: context.scenarioId || null,
                    scenarioName: context.scenarioName || null,
                    authState: context.authState || 'unspecified',
                    ...metric,
                });
            }
        }

        if (healResult.cancelled) {
            return {
                success: false,
                cancelled: true,
                blocking: false,
                message: 'Self-healing cancelled by user',
                error: 'Cancelled by user',
                iterations: healResult.iterations,
                fixesApplied: healResult.totalFixesApplied,
            };
        }

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
            overallSuccess: this._computeOverallSuccess(context),
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

    _isCancellationRequested(context) {
        if (!context || typeof context !== 'object') return false;
        if (context.abortSignal?.aborted) return true;

        if (typeof context.shouldCancel === 'function') {
            try {
                return context.shouldCancel() === true;
            } catch {
                return false;
            }
        }

        return false;
    }

    _isAbortError(error) {
        return error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
    }

    _emitCommandEvent(context, eventType, payload = {}) {
        if (!context?.runId) return;

        const commandEvent = {
            eventType,
            scenarioId: context.scenarioId || null,
            scenarioName: context.scenarioName || null,
            authState: context.authState || 'unspecified',
            ...payload,
        };

        if (this._eventBridge) {
            this._eventBridge.push('command_progress', context.runId, commandEvent);
        }

        if (typeof context.onCommandEvent === 'function') {
            try {
                context.onCommandEvent(commandEvent);
            } catch {
                // Command event callback is best-effort telemetry.
            }
        }
    }

    /**
     * Emit a raw (multi-line, newline-preserving) output chunk for the Live
     * Command Output tail. Chunks are capped server-side by RunStore when
     * persisted, and the SSE frame size is bounded by `maxChunkChars`.
     */
    _emitCommandChunk(context, payload = {}) {
        if (!context?.runId) return;

        const raw = payload.text == null ? '' : String(payload.text);
        if (!raw) return;

        const maxChunkChars = 8 * 1024; // 8 KB per SSE frame
        const text = raw.length > maxChunkChars
            ? raw.slice(raw.length - maxChunkChars)
            : raw;
        const droppedChars = raw.length > maxChunkChars ? raw.length - text.length : 0;

        const chunkEvent = {
            eventType: 'output_chunk',
            kind: 'chunk',
            scenarioId: context.scenarioId || null,
            scenarioName: context.scenarioName || null,
            authState: context.authState || 'unspecified',
            stage: payload.stage || null,
            target: payload.target || null,
            stream: payload.stream || 'stdout',
            text,
            droppedChars,
        };

        if (this._eventBridge) {
            this._eventBridge.push('command_output_chunk', context.runId, chunkEvent);
        }

        if (typeof context.onCommandEvent === 'function') {
            try {
                context.onCommandEvent(chunkEvent);
            } catch {
                // Command event callback is best-effort telemetry.
            }
        }
    }

    _recordCommandMetric(context, metric = {}) {
        if (!context || !Array.isArray(context.commandMetrics)) return;

        const durationMs = Number.isFinite(metric.durationMs)
            ? Math.max(0, Math.round(metric.durationMs))
            : null;
        const cancelToKillLatencyMs = Number.isFinite(metric.cancelToKillLatencyMs)
            ? Math.max(0, Math.round(metric.cancelToKillLatencyMs))
            : null;

        context.commandMetrics.push({
            stage: metric.stage || null,
            scenarioId: metric.scenarioId ?? context.scenarioId ?? null,
            scenarioName: metric.scenarioName ?? context.scenarioName ?? null,
            authState: metric.authState ?? context.authState ?? 'unspecified',
            target: metric.target || null,
            command: metric.command || null,
            startedAt: metric.startedAt || null,
            endedAt: metric.endedAt || null,
            durationMs,
            cancelToKillLatencyMs,
            exitCode: Number.isInteger(metric.exitCode) ? metric.exitCode : null,
            signal: metric.signal || null,
            timedOut: metric.timedOut === true,
            cancelled: metric.cancelled === true,
            error: metric.error || null,
        });
    }

    _buildExecutionMetricsArtifact(context) {
        const metrics = Array.isArray(context?.commandMetrics)
            ? context.commandMetrics
            : [];

        const durations = metrics
            .map(item => item.durationMs)
            .filter(value => Number.isFinite(value) && value >= 0)
            .sort((a, b) => a - b);
        const cancelLatencies = metrics
            .map(item => item.cancelToKillLatencyMs)
            .filter(value => Number.isFinite(value) && value >= 0)
            .sort((a, b) => a - b);

        const totalCommands = metrics.length;
        const cancelledCommands = metrics.filter(item => item.cancelled).length;
        const timedOutCommands = metrics.filter(item => item.timedOut).length;
        const failedCommands = metrics.filter(item => item.error && !item.cancelled).length;

        const averageDurationMs = durations.length > 0
            ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
            : null;
        const percentile95DurationMs = durations.length > 0
            ? durations[Math.min(durations.length - 1, Math.floor(0.95 * durations.length))]
            : null;
        const maxDurationMs = durations.length > 0 ? durations[durations.length - 1] : null;
        const averageCancelToKillLatencyMs = cancelLatencies.length > 0
            ? Math.round(cancelLatencies.reduce((sum, value) => sum + value, 0) / cancelLatencies.length)
            : null;
        const maxCancelToKillLatencyMs = cancelLatencies.length > 0
            ? cancelLatencies[cancelLatencies.length - 1]
            : null;

        return {
            generatedAt: new Date().toISOString(),
            summary: {
                totalCommands,
                cancelledCommands,
                timedOutCommands,
                failedCommands,
                averageDurationMs,
                percentile95DurationMs,
                maxDurationMs,
                averageCancelToKillLatencyMs,
                maxCancelToKillLatencyMs,
            },
            commands: metrics,
        };
    }

    _normalizeCommandOutput(chunk) {
        if (!chunk) return '';
        return String(chunk)
            .replace(/\r/g, ' ')
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _computeOverallSuccess(context) {
        const stageResults = context.stageResults || {};
        const blockingFailure = Object.values(stageResults).some(result => result?.success === false && result?.blocking);
        if (blockingFailure) return false;

        const executeStage = stageResults[STAGES.EXECUTE];
        const healingStage = stageResults[STAGES.SELF_HEAL];

        if (context.mode === 'execute') {
            return executeStage?.success === true;
        }

        if (['full', 'generate', 'heal'].includes(context.mode)) {
            if (executeStage?.success === true) return true;
            return healingStage?.success === true;
        }

        return true;
    }

    _derivePipelineFailureReason(context, pipelineError) {
        if (pipelineError) return pipelineError;

        const executeStage = context.stageResults?.[STAGES.EXECUTE];
        const healingStage = context.stageResults?.[STAGES.SELF_HEAL];

        if (context.mode === 'execute' && executeStage?.success === false) {
            return executeStage.error || executeStage.message || 'Execution stage failed';
        }

        if (['full', 'generate', 'heal'].includes(context.mode) && executeStage?.success === false && healingStage?.success !== true) {
            return healingStage?.error
                || healingStage?.message
                || executeStage.error
                || executeStage.message
                || 'Execution failed and self-healing did not recover';
        }

        return null;
    }

    _collectPlaywrightSpecs(result) {
        const collected = [];

        const walkSuite = (suite) => {
            if (!suite || typeof suite !== 'object') return;
            if (Array.isArray(suite.specs)) {
                collected.push(...suite.specs);
            }
            if (Array.isArray(suite.suites)) {
                for (const child of suite.suites) {
                    walkSuite(child);
                }
            }
        };

        if (Array.isArray(result?.suites)) {
            for (const suite of result.suites) {
                walkSuite(suite);
            }
        }

        return collected;
    }

    _shouldExecutionFailureBlock(context, failureType = 'test-failure') {
        if (failureType === 'missing-target') return true;
        return context.mode === 'execute';
    }

    _toRelativeTargetPath(absolutePath) {
        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');
        if (!relativePath || relativePath.startsWith('..')) {
            return absolutePath.replace(/\\/g, '/');
        }
        return relativePath;
    }

    _resolveExecutionTarget(rawTarget) {
        const normalizedTarget = this._normalizeOptionalString(rawTarget);
        if (!normalizedTarget) return null;

        const absolutePath = path.isAbsolute(normalizedTarget)
            ? normalizedTarget
            : path.join(this.projectRoot, normalizedTarget);

        if (fs.existsSync(absolutePath)) {
            const stats = fs.statSync(absolutePath);
            return {
                rawTarget: normalizedTarget,
                exists: true,
                type: stats.isDirectory() ? 'directory' : 'file',
                absolutePath,
                targetArg: this._toRelativeTargetPath(absolutePath),
                displayLabel: this._toRelativeTargetPath(absolutePath),
            };
        }

        const patternTarget = normalizedTarget.replace(/\\/g, '/');
        return {
            rawTarget: normalizedTarget,
            exists: false,
            type: 'pattern',
            absolutePath: null,
            targetArg: patternTarget,
            displayLabel: patternTarget,
        };
    }

    _normalizeHybridContext(options = {}) {
        const raw = (options.hybridContext && typeof options.hybridContext === 'object' && !Array.isArray(options.hybridContext))
            ? options.hybridContext
            : {};

        const frameworkModeInput = this._normalizeOptionalString(raw.frameworkMode || options.frameworkMode);
        const frameworkMode = frameworkModeInput && frameworkModeInput.toLowerCase() === 'manual'
            ? 'manual'
            : 'existing';

        const testDataOverride = raw.testDataOverride !== undefined
            ? raw.testDataOverride
            : (options.testDataOverride !== undefined ? options.testDataOverride : null);

        return {
            frameworkMode,
            appUrl: this._normalizeOptionalString(raw.appUrl || options.appUrl),
            testCaseSource: this._normalizeOptionalString(raw.testCaseSource || options.testCaseSource),
            testDataOverride,
            executionTarget: this._normalizeOptionalString(raw.executionTarget || options.executionTarget),
            requestedTicketId: this._normalizeOptionalString(raw.requestedTicketId),
            requestedRunId: this._normalizeOptionalString(raw.requestedRunId),
        };
    }

    _normalizeOptionalString(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed || null;
    }

    _resolveFrameworkBaseUrl() {
        const testDataPath = path.join(this.projectRoot, 'tests', 'test-data', 'testData.js');
        if (!fs.existsSync(testDataPath)) return null;

        try {
            delete require.cache[require.resolve(testDataPath)];
            const testData = require(testDataPath);
            return this._normalizeOptionalString(testData?.baseUrl);
        } catch (error) {
            this._log(`⚠️ Failed to resolve framework baseUrl: ${error.message}`);
            return null;
        }
    }

    _materializeProvidedTestCases(context) {
        const source = this._normalizeOptionalString(context.testCaseSource);
        if (!source) return null;

        if (!source.includes('\n') && this._isLikelyPathInput(source)) {
            const candidatePath = path.isAbsolute(source)
                ? source
                : path.join(this.projectRoot, source);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }

        const testCasesDir = path.join(__dirname, '..', 'test-cases');
        if (!fs.existsSync(testCasesDir)) {
            fs.mkdirSync(testCasesDir, { recursive: true });
        }

        const targetPath = path.join(testCasesDir, `${this._getScenarioFileStem(context, 'provided-testcases')}.md`);
        fs.writeFileSync(targetPath, source, 'utf-8');
        return targetPath;
    }

    _isLikelyPathInput(value) {
        return /[\\/]/.test(value) || /\.(xlsx|xls|csv|md|txt|json)$/i.test(value);
    }

    _resolveExistingArtifacts(context) {
        const ticketId = context.ticketId;
        const scenarioSlug = context.scenarioSlug;

        const explicitExecutionTarget = this._resolveExecutionTarget(context.executionTarget);
        const hasExplicitSpecTarget = explicitExecutionTarget?.exists && explicitExecutionTarget.type === 'file';
        if (explicitExecutionTarget?.exists && explicitExecutionTarget.type === 'file') {
            context.specPath = explicitExecutionTarget.absolutePath;
        }

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

        if (!hasExplicitSpecTarget) {
            for (const v of variations) {
                if (fs.existsSync(v)) {
                    context.specPath = v;
                    break;
                }
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
