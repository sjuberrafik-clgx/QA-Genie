/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT COORDINATOR — Inter-Agent Communication & Smart Routing
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides three capabilities that the sequential pipeline-runner lacks:
 *
 *   1. Agent Message Bus — Agents can ask questions to other agents and get
 *      answers via mini-sessions, without the coordinator manually mediating.
 *
 *   2. Smart Routing — Instead of "run all stages in order", the coordinator
 *      makes routing decisions based on stage outputs:
 *        - Skip BugGenie if tests pass
 *        - Run CodeReviewer in parallel with execution
 *        - Retry only the failing part of ScriptGenerator
 *        - Escalate healing to full re-generation after N failures
 *
 *   3. Parallel Dispatch — Run non-dependent stages concurrently
 *      (e.g., CodeReviewer + Execute, or BugGenie while healing continues).
 *
 * The coordinator wraps the existing AgentSessionFactory and EventBridge,
 * adding a routing layer on top.
 *
 * @module sdk-orchestrator/agent-coordinator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { EventEmitter } = require('events');
const { getEventBridge, EVENT_TYPES } = require('./event-bridge');

// ─── Routing Decisions ──────────────────────────────────────────────────────

const ROUTE = {
    CONTINUE: 'continue',          // Proceed to next stage
    SKIP: 'skip',                  // Skip this stage entirely
    RETRY_PARTIAL: 'retry_partial', // Retry just the failed part
    RETRY_FULL: 'retry_full',      // Retry the entire stage
    PARALLEL: 'parallel',          // Run stages in parallel
    ESCALATE: 'escalate',          // Escalate to a more powerful strategy
    ABORT: 'abort',                // Stop the pipeline
    DELEGATE: 'delegate',          // Ask another agent for help
};

// ─── Agent Coordinator ──────────────────────────────────────────────────────

class AgentCoordinator extends EventEmitter {
    /**
     * @param {Object} options
     * @param {Object} options.sessionFactory  - AgentSessionFactory instance
     * @param {Object} options.contextStore    - SharedContextStore for this run
     * @param {Object} [options.config]        - workflow-config.json
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        super();
        this.sessionFactory = options.sessionFactory;
        this.contextStore = options.contextStore;
        this.config = options.config || {};
        this.verbose = options.verbose || false;
        this.eventBridge = getEventBridge();

        // Track routing state
        this._routingHistory = [];
        this._miniSessionCount = 0;
        this._maxMiniSessions = 5; // Cap mini-sessions per run to control cost
    }

    // ─── Smart Routing ──────────────────────────────────────────────

    /**
     * Decide what to do after a stage completes.
     * This replaces the mechanical "if success, next; if fail, stop" logic.
     *
     * @param {string} completedStage - Stage that just finished
     * @param {Object} stageResult - Result from the completed stage
     * @param {Object} context - Pipeline context
     * @returns {Object} Routing decision { action, targets, reason, params }
     */
    route(completedStage, stageResult, context) {
        const decision = this._evaluateRoute(completedStage, stageResult, context);

        this._routingHistory.push({
            stage: completedStage,
            result: stageResult.success ? 'success' : 'failure',
            decision: decision.action,
            reason: decision.reason,
            timestamp: new Date().toISOString(),
        });

        this._log(`🧭 Route after ${completedStage}: ${decision.action} — ${decision.reason}`);

        this.emit('route', {
            stage: completedStage,
            decision,
        });

        return decision;
    }

    /**
     * Core routing logic — evaluates stage output and decides next action.
     */
    _evaluateRoute(stage, result, context) {
        const sdkConfig = this.config.sdk || {};
        const coordConfig = sdkConfig.coordinator || {};

        switch (stage) {
            // ── After TestGenie ────────────────────────────────────
            case 'testgenie': {
                if (result.success) {
                    return { action: ROUTE.CONTINUE, reason: 'Test cases generated successfully' };
                }
                // TestGenie failure is non-blocking — can still generate scripts from ticket info
                return {
                    action: ROUTE.CONTINUE,
                    reason: 'TestGenie failed but proceeding — ScriptGenerator can work from ticket data',
                    params: { skipExcelQG: true },
                };
            }

            // ── After Excel Quality Gate ──────────────────────────
            case 'qg_excel': {
                if (result.success) {
                    return { action: ROUTE.CONTINUE, reason: 'Excel QG passed' };
                }
                // Non-blocking — file might still be usable
                return { action: ROUTE.CONTINUE, reason: 'Excel QG failed but non-blocking' };
            }

            // ── After ScriptGenerator ─────────────────────────────
            case 'scriptgenerator': {
                if (result.success) {
                    // Check if we should run CodeReviewer in parallel with execution
                    if (coordConfig.parallelCodeReview !== false) {
                        return {
                            action: ROUTE.PARALLEL,
                            targets: ['qg_script', 'codereviewer'],
                            reason: 'Script generated — review in parallel with QG',
                        };
                    }
                    return { action: ROUTE.CONTINUE, reason: 'Script generated successfully' };
                }

                // Script generation failed — check pending questions
                const questions = this.contextStore.getPendingQuestions('coordinator');
                if (questions.length > 0) {
                    return {
                        action: ROUTE.DELEGATE,
                        targets: ['testgenie'],
                        reason: `ScriptGenerator has ${questions.length} unresolved question(s)`,
                        params: { questions },
                    };
                }

                return {
                    action: ROUTE.RETRY_FULL,
                    reason: 'Script generation failed — retrying',
                    params: { maxRetries: 1 },
                };
            }

            // ── After Script Quality Gate ─────────────────────────
            case 'qg_script': {
                if (result.success) {
                    return { action: ROUTE.CONTINUE, reason: 'Script QG passed' };
                }

                // QG failed — check severity
                const errors = result.errors || [];
                const criticalErrors = errors.filter(e =>
                    e.includes('AP001') || e.includes('AP002') || e.includes('phantom')
                );

                if (criticalErrors.length > 0) {
                    // Critical issues — ask ScriptGenerator to fix just those
                    return {
                        action: ROUTE.RETRY_PARTIAL,
                        targets: ['scriptgenerator'],
                        reason: `Script has ${criticalErrors.length} critical issue(s) — partial fix`,
                        params: {
                            fixPrompt: `Fix these script issues (do NOT rewrite the entire file):\n${criticalErrors.join('\n')}`,
                            specPath: context.specPath,
                        },
                    };
                }

                // Non-critical warnings — proceed anyway
                return {
                    action: ROUTE.CONTINUE,
                    reason: `Script QG had ${errors.length} non-critical issue(s) — proceeding`,
                };
            }

            // ── After Execution ───────────────────────────────────
            case 'execute': {
                if (result.success || result.testResults?.passed) {
                    return {
                        action: ROUTE.SKIP,
                        targets: ['healing', 'buggenie'],
                        reason: 'All tests passed — skip healing and bug filing',
                    };
                }

                const failures = result.testResults?.failedCount || 0;
                const total = result.testResults?.totalCount || 0;

                // If ALL tests failed, it's likely a structural issue
                if (total > 0 && failures === total) {
                    return {
                        action: ROUTE.ESCALATE,
                        reason: 'All tests failed — likely structural issue, not just selectors',
                        params: { strategy: 'regenerate' },
                    };
                }

                return { action: ROUTE.CONTINUE, reason: `${failures}/${total} tests failed — proceeding to heal` };
            }

            // ── After Self-Healing ────────────────────────────────
            case 'healing': {
                if (result.success) {
                    return {
                        action: ROUTE.SKIP,
                        targets: ['buggenie'],
                        reason: 'Healing succeeded — no bugs to file',
                    };
                }

                const iterations = result.iterations || 0;
                const maxIterations = sdkConfig.maxHealingIterations || 3;

                // If healing exhausted iterations, escalate
                if (iterations >= maxIterations) {
                    return {
                        action: ROUTE.CONTINUE,
                        reason: `Healing exhausted ${maxIterations} iterations — filing bug`,
                    };
                }

                return { action: ROUTE.CONTINUE, reason: 'Healing incomplete — filing bug' };
            }

            // ── After BugGenie ────────────────────────────────────
            case 'buggenie': {
                return { action: ROUTE.CONTINUE, reason: 'Bug ticket handled' };
            }

            // ── After TaskGenie ────────────────────────────────────
            case 'taskgenie': {
                return { action: ROUTE.CONTINUE, reason: 'Testing task handled' };
            }

            // ── After DocGenie ────────────────────────────────────
            case 'docgenie': {
                return { action: ROUTE.CONTINUE, reason: 'Document generation handled' };
            }

            default:
                return { action: ROUTE.CONTINUE, reason: 'Default: continue to next stage' };
        }
    }

    // ─── Agent-to-Agent Communication ───────────────────────────────

    /**
     * Ask another agent a question by spinning up a lightweight mini-session.
     * This lets ScriptGenerator ask TestGenie for clarification, for example.
     *
     * @param {string} askingAgent - Who's asking
     * @param {string} targetAgent - Who should answer
     * @param {string} question - The question
     * @param {Object} [sessionContext] - Additional context for the mini-session
     * @returns {Promise<string>} The answer
     */
    async askAgent(askingAgent, targetAgent, question, sessionContext = {}) {
        if (this._miniSessionCount >= this._maxMiniSessions) {
            const fallback = `Mini-session limit reached (${this._maxMiniSessions}). Cannot ask ${targetAgent}. Using best judgment.`;
            this._log(`⚠️ ${fallback}`);
            return fallback;
        }

        this._miniSessionCount++;
        this._log(`💬 ${askingAgent} → ${targetAgent}: "${question.substring(0, 100)}..."`);

        // Record the question in shared context
        const qId = this.contextStore.postQuestion(askingAgent, targetAgent, question);

        let session = null;
        let sessionId = null;

        try {
            // Create a lightweight mini-session for the target agent
            const sessionInfo = await this.sessionFactory.createAgentSession(targetAgent, {
                ticketContext: [
                    `You are being asked a question by the ${askingAgent} agent.`,
                    `Answer concisely and specifically based on your expertise.`,
                    '',
                    `Question from ${askingAgent}: ${question}`,
                    '',
                    // Inject relevant context
                    sessionContext.relevantContext || '',
                ].join('\n'),
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const answer = await this.sessionFactory.sendAndWait(session, question, {
                timeout: 60000, // 1 minute max for a mini-session
            });

            // Record the answer
            this.contextStore.answerQuestion(targetAgent, qId, answer);

            this._log(`✅ ${targetAgent} answered: "${answer.substring(0, 100)}..."`);

            return answer;
        } catch (error) {
            const errorMsg = `Failed to get answer from ${targetAgent}: ${error.message}`;
            this.contextStore.answerQuestion('coordinator', qId, errorMsg);
            this._log(`❌ ${errorMsg}`);
            return errorMsg;
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Request a partial fix from an agent — send it the specific issues
     * to fix without re-running the entire stage.
     *
     * @param {string} agentName - Agent to dispatch to
     * @param {string} fixPrompt - Specific instructions for the fix
     * @param {Object} [context] - Additional context
     * @returns {Promise<string>} Agent's response
     */
    async requestPartialFix(agentName, fixPrompt, context = {}) {
        this._log(`🔧 Requesting partial fix from ${agentName}...`);

        let session = null;
        let sessionId = null;

        try {
            const sessionInfo = await this.sessionFactory.createAgentSession(agentName, {
                ticketContext: context.ticketContext || '',
                frameworkInventory: context.frameworkInventory || null,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const response = await this.sessionFactory.sendAndWait(session, fixPrompt, {
                timeout: 120000, // 2 minutes for a fix
            });

            this.contextStore.recordDecision(
                agentName,
                `Applied partial fix: ${fixPrompt.substring(0, 100)}`,
                response.substring(0, 200)
            );

            return response;
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    // ─── Parallel Dispatch ──────────────────────────────────────────

    /**
     * Run multiple stages in parallel and collect results.
     *
     * @param {Array<{stage: string, fn: Function}>} tasks - Stages to run concurrently
     * @returns {Promise<Map<string, Object>>} stage → result map
     */
    async runParallel(tasks) {
        this._log(`⚡ Running ${tasks.length} stages in parallel: ${tasks.map(t => t.stage).join(', ')}`);

        const results = new Map();
        const promises = tasks.map(async (task) => {
            try {
                const result = await task.fn();
                results.set(task.stage, result);
            } catch (error) {
                results.set(task.stage, {
                    success: false,
                    error: error.message,
                    blocking: false,
                });
            }
        });

        await Promise.allSettled(promises);

        for (const [stage, result] of results) {
            this._log(`  ${result.success ? '✅' : '❌'} ${stage}: ${result.message || result.error || ''}`);
        }

        return results;
    }

    // ─── Escalation Strategy ────────────────────────────────────────

    /**
     * Handle escalation when normal flow fails.
     * Currently supports: regenerate (re-run ScriptGenerator from scratch)
     *
     * @param {string} strategy - Escalation strategy
     * @param {Object} context - Pipeline context
     * @returns {Object} Escalation decision
     */
    escalate(strategy, context) {
        this._log(`🚨 Escalating with strategy: ${strategy}`);

        this.contextStore.recordDecision(
            'coordinator',
            `Escalated: ${strategy}`,
            `All tests failed for ${context.ticketId} — normal healing insufficient`
        );

        switch (strategy) {
            case 'regenerate':
                return {
                    action: 'restart_from',
                    stage: 'scriptgenerator',
                    reason: 'All tests failed — regenerating script from scratch',
                    params: {
                        additionalContext: 'Previous script had structural issues. All tests failed. ' +
                            'Take a completely different approach to the selectors and test structure.',
                    },
                };

            case 'manual':
                return {
                    action: 'abort',
                    reason: 'Escalation requires manual intervention',
                };

            default:
                return {
                    action: 'continue',
                    reason: `Unknown escalation strategy: ${strategy}`,
                };
        }
    }

    // ─── State & Reporting ──────────────────────────────────────────

    /**
     * Get the routing history for this run.
     *
     * @returns {Object[]}
     */
    getRoutingHistory() {
        return [...this._routingHistory];
    }

    /**
     * Get coordinator statistics.
     *
     * @returns {Object}
     */
    getStats() {
        const decisions = {};
        for (const r of this._routingHistory) {
            decisions[r.decision] = (decisions[r.decision] || 0) + 1;
        }

        return {
            routingDecisions: this._routingHistory.length,
            miniSessionsUsed: this._miniSessionCount,
            miniSessionsRemaining: this._maxMiniSessions - this._miniSessionCount,
            decisionBreakdown: decisions,
        };
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[Coordinator] ${message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { AgentCoordinator, ROUTE };
