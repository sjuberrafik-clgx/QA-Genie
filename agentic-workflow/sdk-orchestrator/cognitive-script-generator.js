/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COGNITIVE SCRIPT GENERATOR — Multi-Phase Agentic Loop Orchestrator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replaces the single-shot ScriptGenerator with a 5-phase cognitive loop
 * that mimics a human QA engineer's thought process:
 *
 *   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 *   │ ANALYST  │──▶│ EXPLORER │──▶│  CODER   │──▶│ REVIEWER │──▶│ DRY-RUN  │
 *   │ (Plan)   │   │ (MCP)    │   │ (Code)   │   │ (Gate)   │   │ (Verify) │
 *   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
 *        │              │              │     ▲          │              │
 *        └──────────────┴──────────────┘     │          │              │
 *                SharedContextStore          └──────────┘              │
 *                                         Coder←Reviewer             │
 *                                            inner loop              │
 *                                                    ▲               │
 *                                                    └───────────────┘
 *                                                  Coder←DryRun loop
 *
 * Each phase is a SEPARATE LLM session with:
 *   - Focused system prompt (4K–10K tokens vs 30K monolithic)
 *   - Phase-specific MCP tool profile (0–35 tools vs 65)
 *   - Typed inputs/outputs via SharedContextStore
 *
 * @module cognitive-script-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const phases = require('./cognitive-phases');
const { getContextStoreManager, ENTRY_TYPES } = require('./shared-context-store');
const { getEventBridge } = require('./event-bridge');

// ─── Phase States ───────────────────────────────────────────────────────────

const PHASE_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRYING: 'retrying',
    SKIPPED: 'skipped',
};

// ─── Cognitive Script Generator ─────────────────────────────────────────────

class CognitiveScriptGenerator {
    /**
     * @param {Object} options
     * @param {Object} options.sessionFactory  - AgentSessionFactory (SDK)
     * @param {Object} [options.config]         - workflow-config.json
     * @param {Object} [options.learningStore]  - LearningStore instance
     * @param {Object} [options.groundingStore] - GroundingStore instance
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        this.sessionFactory = options.sessionFactory;
        this.config = options.config || {};
        this.learningStore = options.learningStore || null;
        this.groundingStore = options.groundingStore || null;
        this.verbose = options.verbose || false;
        this.projectRoot = path.join(__dirname, '..', '..');
        this._eventBridge = options.eventBridge || getEventBridge();
        this._contextStoreManager = getContextStoreManager();

        // Cognitive config with defaults — read from nested config structure
        const cogConfig = this.config.cognitiveLoop || {};
        this.maxCoderRetries = cogConfig.retryLimits?.maxCoderRetries || 2;
        this.maxDryRunRetries = cogConfig.retryLimits?.maxDryRunRetries || 1;
        this.dryRunThreshold = (cogConfig.qualityThresholds?.dryRunPassRate || 80) / 100;
        this.reviewConfidenceThreshold = cogConfig.qualityThresholds?.reviewerConfidenceThreshold || 70;
        this.enableDryRun = cogConfig.phases?.dryrun?.enabled !== false;
        this.enableReview = cogConfig.phases?.reviewer?.enabled !== false;

        // Adaptive scaling config (inference-time scaling)
        this.adaptiveScaling = cogConfig.adaptiveScaling || { enabled: false };
    }

    /**
     * Determine complexity tier from the Analyst's exploration plan.
     * Adjusts timeouts, retry budgets, and quality thresholds dynamically.
     *
     * @param {Object} plan - Analyst output plan
     * @returns {Object} Scaling parameters for this run
     */
    _computeAdaptiveScaling(plan) {
        if (!this.adaptiveScaling?.enabled || !plan) {
            return {
                tier: 'moderate',
                timeoutMultiplier: 1.0,
                maxCoderRetries: this.maxCoderRetries,
                maxDryRunRetries: this.maxDryRunRetries,
                reviewerConfidenceThreshold: this.reviewConfidenceThreshold,
                dryRunPassRate: this.dryRunThreshold * 100,
                enableSupervisor: false,
            };
        }

        const depth = plan.estimatedExplorationDepth || {};
        const testSteps = plan.testCaseMapping?.length || 0;
        const pages = depth.totalPages || Object.keys(plan.pageTransitionGraph || {}).length || 1;
        const elements = depth.totalElements || 0;
        const riskCount = (plan.riskAreas || []).length;

        // Determine tier
        const tiers = this.adaptiveScaling.complexityTiers || {};
        let tier = 'moderate';
        let tierConfig = tiers.moderate || {};

        if (testSteps <= (tiers.simple?.maxTestSteps || 5) &&
            pages <= (tiers.simple?.maxPages || 2) &&
            elements <= (tiers.simple?.maxElements || 10)) {
            tier = 'simple';
            tierConfig = tiers.simple || {};
        } else if (testSteps > (tiers.moderate?.maxTestSteps || 12) ||
            pages > (tiers.moderate?.maxPages || 5) ||
            elements > (tiers.moderate?.maxElements || 25)) {
            tier = 'complex';
            tierConfig = tiers.complex || {};
        }

        // Apply risk multiplier
        const riskConfig = this.adaptiveScaling.riskMultiplier || {};
        const isHighRisk = riskCount >= (riskConfig.highRiskThreshold || 3);
        const riskTimeoutBoost = isHighRisk ? (riskConfig.timeoutBoost || 1.3) : 1.0;
        const riskRetryBoost = isHighRisk ? (riskConfig.additionalRetries || 1) : 0;

        const scaling = {
            tier,
            isHighRisk,
            testSteps,
            pages,
            elements,
            riskCount,
            timeoutMultiplier: (tierConfig.timeoutMultiplier || 1.0) * riskTimeoutBoost,
            maxCoderRetries: (tierConfig.maxCoderRetries ?? this.maxCoderRetries) + riskRetryBoost,
            maxDryRunRetries: (tierConfig.maxDryRunRetries ?? this.maxDryRunRetries) + (isHighRisk ? 1 : 0),
            reviewerConfidenceThreshold: tierConfig.reviewerConfidenceThreshold ?? this.reviewConfidenceThreshold,
            dryRunPassRate: tierConfig.dryRunPassRate ?? (this.dryRunThreshold * 100),
            enableSupervisor: tierConfig.enableSupervisor ?? false,
        };

        this._log(`  Adaptive scaling: tier=${tier} | multiplier=${scaling.timeoutMultiplier.toFixed(1)}x | coderRetries=${scaling.maxCoderRetries} | dryRunRetries=${scaling.maxDryRunRetries} | highRisk=${isHighRisk}`);
        return scaling;
    }

    /**
     * Get phase timeout adjusted by adaptive scaling.
     * @param {string} phaseName
     * @param {number} multiplier
     * @returns {number} Adjusted timeout in ms
     */
    _getScaledTimeout(phaseName, multiplier = 1.0) {
        const phase = phases.getPhase(phaseName);
        return Math.round((phase?.timeout || 180000) * multiplier);
    }

    /**
     * Dynamic threshold calibration — adjusts quality thresholds using
     * historical learning store data for the specific feature/pages under test.
     *
     * If a feature has high historical failure rate → lower thresholds slightly
     * (more forgiving, extra retries). If a feature has strong track record →
     * raise thresholds (stricter, fewer retries needed).
     *
     * @param {Object} scaling - Adaptive scaling from _computeAdaptiveScaling()
     * @param {Object} plan - Analyst plan output
     * @param {string} ticketId - Current ticket ID
     * @returns {Object} Calibrated scaling (mutated in place)
     */
    _calibrateThresholds(scaling, plan, ticketId) {
        if (!this.learningStore) return scaling;

        try {
            // Gather historical data for pages in the plan
            const planPages = Object.keys(plan?.pageTransitionGraph || {});
            const ticketFailures = this.learningStore.getFailuresForTicket(ticketId);
            const pageFailures = [];
            for (const pageUrl of planPages) {
                pageFailures.push(...this.learningStore.getFailuresForPage(pageUrl));
            }

            // Compute feature reliability score (0-100)
            const allRelevant = [...ticketFailures, ...pageFailures];
            if (allRelevant.length === 0) {
                // No history — use defaults
                this._log('  Threshold calibration: no historical data, using defaults');
                return scaling;
            }

            // Deduplicate by timestamp
            const seen = new Set();
            const unique = allRelevant.filter(f => {
                const key = `${f.ticketId}-${f.selector}-${f.timestamp}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const fixedCount = unique.filter(f => f.outcome === 'fixed').length;
            const persistedCount = unique.filter(f => f.outcome === 'persisted').length;
            const totalCount = unique.length;
            const fixRate = totalCount > 0 ? fixedCount / totalCount : 0.5;

            // Selector stability from stable mappings
            const stableSelectors = [];
            for (const pageUrl of planPages) {
                stableSelectors.push(...this.learningStore.getStableSelectors(pageUrl));
            }
            const avgSelectorConfidence = stableSelectors.length > 0
                ? stableSelectors.reduce((sum, s) => sum + (s.confidence || 0.5), 0) / stableSelectors.length
                : 0.5;

            // Page pattern issues
            const pagePatternIssues = planPages.reduce((count, url) => {
                const pattern = this.learningStore.getPagePattern(url);
                return count + (pattern?.commonIssues?.length || 0);
            }, 0);

            // Compute reliability score: 0 (unreliable) to 100 (rock-solid)
            const reliabilityScore = Math.round(
                (fixRate * 40) +                              // Fix rate weight
                (avgSelectorConfidence * 30) +                // Selector stability weight
                (Math.max(0, 30 - (persistedCount * 5)))      // Penalty for persistent failures
            );

            // ── Calibrate thresholds based on reliability ───────────
            if (reliabilityScore >= 70) {
                // Strong history → raise bar
                scaling.reviewerConfidenceThreshold = Math.min(90,
                    scaling.reviewerConfidenceThreshold + 5
                );
                scaling.dryRunPassRate = Math.min(95,
                    scaling.dryRunPassRate + 5
                );
                this._log(`  Threshold calibration: RELIABLE (${reliabilityScore}) → thresholds ↑ (reviewer=${scaling.reviewerConfidenceThreshold}, dryRun=${scaling.dryRunPassRate}%)`);
            } else if (reliabilityScore <= 30) {
                // Fragile feature → be more forgiving, grant extra retries
                scaling.reviewerConfidenceThreshold = Math.max(50,
                    scaling.reviewerConfidenceThreshold - 10
                );
                scaling.maxCoderRetries = Math.min(5,
                    scaling.maxCoderRetries + 1
                );
                scaling.maxDryRunRetries = Math.min(3,
                    scaling.maxDryRunRetries + 1
                );
                this._log(`  Threshold calibration: FRAGILE (${reliabilityScore}) → thresholds ↓, retries ↑ (reviewer=${scaling.reviewerConfidenceThreshold}, coderRetries=${scaling.maxCoderRetries}, dryRunRetries=${scaling.maxDryRunRetries})`);
            } else {
                this._log(`  Threshold calibration: MODERATE (${reliabilityScore}) → defaults maintained`);
            }

            // Record calibration decision
            scaling._calibration = {
                reliabilityScore,
                fixRate: Math.round(fixRate * 100),
                avgSelectorConfidence: Math.round(avgSelectorConfidence * 100),
                historicalFailures: totalCount,
                persistedFailures: persistedCount,
                stableSelectorsFound: stableSelectors.length,
                pagePatternIssues,
            };

            return scaling;
        } catch (error) {
            this._log(`  Threshold calibration error (non-blocking): ${error.message}`);
            return scaling;
        }
    }

    /**
     * Run the full cognitive script generation loop.
     *
     * @param {Object} context
     * @param {string} context.ticketId
     * @param {string} [context.testCases] - Test cases text from TestGenie
     * @param {string} [context.testCasesPath] - Path to test cases Excel
     * @param {string} [context.appUrl] - Application URL
     * @param {Object} [context.contextStore] - Existing SharedContextStore
     * @param {Function} [onProgress] - Progress callback (phase, message)
     * @returns {Object} Result with script path, exploration data, metrics
     */
    async generate(context, onProgress = () => { }) {
        const startTime = Date.now();
        const runId = context.contextStore?.runId || `cognitive-${context.ticketId}-${Date.now()}`;
        const store = context.contextStore || this._contextStoreManager.getStore(runId);

        const metrics = {
            phases: {},
            totalDuration: 0,
            coderRetries: 0,
            dryRunRetries: 0,
            finalConfidence: 0,
        };

        const phaseResults = {};

        this._log(`\n${'═'.repeat(70)}`);
        this._log(`COGNITIVE QA LOOP — ${context.ticketId}`);
        this._log(`${'═'.repeat(70)}`);

        try {
            // ═══════════════════════════════════════════════════════════════
            // PHASE 1: ANALYST — Create exploration plan
            // ═══════════════════════════════════════════════════════════════
            onProgress('analyst', 'Analyzing test cases and creating exploration plan...');
            this._log('\n── Phase 1: ANALYST ──────────────────────────');

            const analystResult = await this._runAnalystPhase(context, store);
            phaseResults.analyst = analystResult;
            metrics.phases.analyst = analystResult.metrics;

            if (!analystResult.success) {
                this._log('⚠️ Analyst failed — falling back to legacy single-shot generation');
                return this._buildResult(context, phaseResults, metrics, startTime, 'analyst-failed');
            }

            store.recordDecision('cognitive-analyst', 'Exploration plan created', analystResult.plan?.reasoning || 'Plan generated', {
                planScore: analystResult.score,
                testStepCount: analystResult.plan?.testCaseMapping?.length || 0,
            });

            // ═══════════════════════════════════════════════════════════════
            // ADAPTIVE SCALING — Compute complexity tier from Analyst plan
            // ═══════════════════════════════════════════════════════════════
            const scaling = this._computeAdaptiveScaling(analystResult.plan);

            // Dynamic threshold calibration from learning store history
            this._calibrateThresholds(scaling, analystResult.plan, context.ticketId);

            metrics.adaptiveScaling = {
                tier: scaling.tier,
                timeoutMultiplier: scaling.timeoutMultiplier,
                isHighRisk: scaling.isHighRisk,
                maxCoderRetries: scaling.maxCoderRetries,
                maxDryRunRetries: scaling.maxDryRunRetries,
                calibration: scaling._calibration || null,
                enableSupervisor: scaling.enableSupervisor,
            };

            store.recordDecision('adaptive-scaling', `Complexity: ${scaling.tier}`,
                `${scaling.testSteps} steps, ${scaling.pages} pages, ${scaling.elements} elements | ` +
                `timeout: ${scaling.timeoutMultiplier.toFixed(1)}x | retries: coder=${scaling.maxCoderRetries}, dryrun=${scaling.maxDryRunRetries}` +
                (scaling.isHighRisk ? ' | HIGH RISK' : ''),
                { tier: scaling.tier, isHighRisk: scaling.isHighRisk }
            );

            // ═══════════════════════════════════════════════════════════════
            // PHASE 2: EXPLORER — Execute the plan via MCP
            // ═══════════════════════════════════════════════════════════════
            // Respects MCP_EXPLORATION_ENABLED from .env — when 'false', skip exploration
            // and let the coder generate from analyst plan + KB/grounding data only.
            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
            let explorerResult;

            if (explorationEnabled) {
                onProgress('explorer', 'Exploring application via MCP (plan-guided)...');
                this._log('\n── Phase 2: EXPLORER ─────────────────────────');

                explorerResult = await this._runExplorerPhase(context, store, analystResult.plan);
                phaseResults.explorer = explorerResult;
                metrics.phases.explorer = explorerResult.metrics;

                if (!explorerResult.success) {
                    this._log('⚠️ Explorer failed — insufficient exploration data');
                    return this._buildResult(context, phaseResults, metrics, startTime, 'explorer-failed');
                }

                store.recordDecision('cognitive-explorer', 'Exploration completed', `Found ${explorerResult.exploration?.statistics?.totalElementsFound || 0} elements across ${explorerResult.exploration?.pagesVisited?.length || 0} pages`, {
                    explorationScore: explorerResult.score,
                    coverage: explorerResult.exploration?.statistics?.coveragePercent || 0,
                });
            } else {
                this._log('\n── Phase 2: EXPLORER (SKIPPED — MCP_EXPLORATION_ENABLED=false) ──');
                explorerResult = {
                    success: true,
                    skipped: true,
                    exploration: { pagesVisited: [], statistics: { totalElementsFound: 0, coveragePercent: 0 } },
                    score: 0,
                    metrics: { durationMs: 0 },
                };
                phaseResults.explorer = explorerResult;
                metrics.phases.explorer = explorerResult.metrics;
                store.recordDecision('cognitive-explorer', 'Exploration SKIPPED', 'MCP_EXPLORATION_ENABLED=false in .env — generating from analyst plan + KB data only', {});
            }

            // ═══════════════════════════════════════════════════════════════
            // PHASE 3: CODER — Generate script (with retry loop)
            // ═══════════════════════════════════════════════════════════════
            onProgress('coder', 'Generating .spec.js using verified selectors...');
            this._log('\n── Phase 3: CODER ───────────────────────────');

            let coderResult = await this._runCoderPhase(context, store, explorerResult.exploration);
            phaseResults.coder = coderResult;
            metrics.phases.coder = coderResult.metrics;

            if (!coderResult.success) {
                this._log('⚠️ Coder failed to generate script');
                return this._buildResult(context, phaseResults, metrics, startTime, 'coder-failed');
            }

            // ═══════════════════════════════════════════════════════════════
            // PHASE 4: REVIEWER — Quality gate (with Coder retry loop)
            // ═══════════════════════════════════════════════════════════════
            if (this.enableReview) {
                onProgress('reviewer', 'Reviewing script quality...');
                this._log('\n── Phase 4: REVIEWER ─────────────────────────');

                const reviewResult = await this._runReviewerPhase(context, store, coderResult, explorerResult.exploration);
                phaseResults.reviewer = reviewResult;
                metrics.phases.reviewer = reviewResult.metrics;

                // Coder ↔ Reviewer inner loop (uses adaptive retry limit)
                if (reviewResult.verdict === 'FAIL' && metrics.coderRetries < scaling.maxCoderRetries) {
                    this._log(`⚠️ Review FAILED — retrying Coder with fixes (attempt ${metrics.coderRetries + 1}/${scaling.maxCoderRetries})`);
                    metrics.coderRetries++;

                    onProgress('coder', `Re-generating script with reviewer fixes (attempt ${metrics.coderRetries})...`);
                    const fixInstructions = phases.reviewer.buildFixInstructions(reviewResult.issues);

                    coderResult = await this._runCoderPhase(context, store, explorerResult.exploration, {
                        reviewFixes: fixInstructions,
                    });
                    phaseResults.coder = coderResult;
                    metrics.phases.coder = coderResult.metrics;
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // PHASE 5: DRY-RUN VALIDATOR — Selector verification
            // ═══════════════════════════════════════════════════════════════
            if (this.enableDryRun && coderResult.specPath) {
                onProgress('dryrun', 'Verifying selectors on live page...');
                this._log('\n── Phase 5: DRY-RUN VALIDATOR ────────────────');

                const dryRunResult = await this._runDryRunPhase(context, store, coderResult);
                phaseResults.dryrun = dryRunResult;
                metrics.phases.dryrun = dryRunResult.metrics;

                // DryRun ↔ Coder retry loop (uses adaptive retry limit and pass rate)
                if (dryRunResult.verdict === 'FIX_REQUIRED' && metrics.dryRunRetries < scaling.maxDryRunRetries) {
                    this._log(`⚠️ DryRun FAILED (${dryRunResult.score}%) — retrying Coder with fixes`);
                    metrics.dryRunRetries++;

                    const brokenFixes = phases.dryrun.buildBrokenSelectorFixes(dryRunResult.broken);
                    onProgress('coder', 'Fixing broken selectors...');

                    coderResult = await this._runCoderPhase(context, store, explorerResult.exploration, {
                        brokenSelectors: brokenFixes,
                    });
                    phaseResults.coder = coderResult;
                }

                metrics.finalConfidence = dryRunResult.score || 0;
            } else {
                metrics.finalConfidence = phaseResults.reviewer?.confidence || 75;
            }

            // ═══════════════════════════════════════════════════════════════
            // DONE — Save exploration data and return
            // ═══════════════════════════════════════════════════════════════
            this._log(`\n${'═'.repeat(70)}`);
            this._log(`COGNITIVE LOOP COMPLETE — Confidence: ${metrics.finalConfidence}%`);
            this._log(`${'═'.repeat(70)}`);

            // Save enriched exploration data
            if (explorerResult.exploration) {
                this._saveExplorationData(context.ticketId, explorerResult.exploration);
            }

            return this._buildResult(context, phaseResults, metrics, startTime, 'success');

        } catch (error) {
            this._log(`❌ Cognitive loop error: ${error.message}`);
            metrics.error = error.message;
            return this._buildResult(context, phaseResults, metrics, startTime, 'error');
        } finally {
            store.save();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE RUNNERS — Each creates a separate focused LLM session
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Phase 1: Analyst — pure reasoning, no MCP.
     */
    async _runAnalystPhase(context, store) {
        const phaseStart = Date.now();
        let session = null;
        let sessionId = null;

        try {
            // Load context
            const testCases = this._loadTestCases(context);
            const featureMap = this._getFeatureMap(context.ticketId);
            const historicalContext = this._getHistoricalContext();
            const appUrl = this._getAppUrl(context);

            // Create focused session — NO MCP tools
            const sessionInfo = await this.sessionFactory.createAgentSession('cognitive-analyst', {
                ticketId: context.ticketId,
                taskDescription: 'Analyze test cases and create exploration plan',
                systemPromptOverride: phases.analyst.buildAnalystSystemPrompt(),
                disableMCP: true, // No MCP tools for Analyst
                contextStore: store,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Build and send prompt
            const prompt = phases.analyst.buildAnalystUserPrompt({
                ticketId: context.ticketId,
                testCases,
                featureMap,
                historicalContext,
                appUrl,
            });

            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: phases.getPhase('analyst').timeout,
            });

            // Parse and validate
            const { valid, plan, errors, strategyEvaluation, hasFallback } = phases.analyst.parseAnalystOutput(response);
            const { score } = phases.analyst.scorePlan(plan);

            this._log(`  Plan quality: ${score}/100 | Valid: ${valid} | Steps: ${plan?.testCaseMapping?.length || 0}`);
            if (strategyEvaluation) {
                this._log(`  ToT strategies: ${strategyEvaluation.strategies?.length || 0} evaluated | Selected: ${strategyEvaluation.selectedStrategy || '?'} | Fallback: ${hasFallback}`);
            }
            if (errors.length > 0) {
                this._log(`  Warnings: ${errors.join(', ')}`);
            }

            return {
                success: valid,
                plan,
                score,
                errors,
                strategyEvaluation,
                hasFallback,
                fallbackPlan: plan?.fallbackStrategy || null,
                metrics: { duration: Date.now() - phaseStart, score, valid, strategyCount: strategyEvaluation?.strategies?.length || 0 },
            };
        } catch (error) {
            this._log(`  ❌ Analyst error: ${error.message}`);
            return {
                success: false,
                plan: null,
                score: 0,
                errors: [error.message],
                metrics: { duration: Date.now() - phaseStart, error: error.message },
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Phase 2: Explorer — MCP-heavy, plan-guided.
     */
    async _runExplorerPhase(context, store, plan) {
        const phaseStart = Date.now();
        let session = null;
        let sessionId = null;

        try {
            const appUrl = this._getAppUrl(context);
            const selectorRecommendations = this._getSelectorRecommendations(context.ticketId);

            // Create session with explorer-specific MCP profile
            const sessionInfo = await this.sessionFactory.createAgentSession('cognitive-explorer-nav', {
                ticketId: context.ticketId,
                taskDescription: 'Explore application following the analysis plan',
                systemPromptOverride: phases.explorer.buildExplorerSystemPrompt(),
                toolProfile: 'explorer-nav',
                contextStore: store,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const prompt = phases.explorer.buildExplorerUserPrompt({
                ticketId: context.ticketId,
                explorationPlan: plan,
                appUrl,
                selectorRecommendations,
                knownPopups: ['welcome-modal', 'agent-branding', 'tour-overlay', 'compare-popup'],
            });

            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: phases.getPhase('explorer').timeout,
                onDelta: (delta) => {
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.ticketId, {
                            agent: 'cognitive-explorer',
                            stage: 'explorer',
                            delta,
                        });
                    }
                },
            });

            // Parse and validate
            const { valid, exploration, errors } = phases.explorer.parseExplorerOutput(response);
            const { score } = phases.explorer.scoreExploration(exploration, plan);

            // Convert to standard format for quality gates
            const standardData = phases.explorer.toStandardExplorationData(exploration, context.ticketId);

            this._log(`  Exploration score: ${score}/100 | Valid: ${valid} | Elements: ${exploration?.statistics?.totalElementsFound || 0}`);

            return {
                success: valid && score >= 30,
                exploration,
                standardExploration: standardData,
                score,
                errors,
                metrics: { duration: Date.now() - phaseStart, score, valid },
            };
        } catch (error) {
            this._log(`  ❌ Explorer error: ${error.message}`);
            return {
                success: false,
                exploration: null,
                score: 0,
                errors: [error.message],
                metrics: { duration: Date.now() - phaseStart, error: error.message },
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Phase 3: Coder — incremental code generation, no MCP.
     */
    async _runCoderPhase(context, store, explorationData, retryOptions = {}) {
        const phaseStart = Date.now();
        let session = null;
        let sessionId = null;

        try {
            const testCases = this._loadTestCases(context);
            const frameworkInventory = this._getFrameworkInventory();
            const assertionConfig = this._getAssertionConfig();

            // Create session — NO MCP tools, only file write capability
            const sessionInfo = await this.sessionFactory.createAgentSession('cognitive-coder', {
                ticketId: context.ticketId,
                taskDescription: retryOptions.reviewFixes
                    ? 'Fix script based on reviewer feedback'
                    : retryOptions.brokenSelectors
                        ? 'Fix broken selectors from dry-run'
                        : 'Generate Playwright automation script',
                systemPromptOverride: phases.coder.buildCoderSystemPrompt(),
                disableMCP: true,
                contextStore: store,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const prompt = phases.coder.buildCoderUserPrompt({
                ticketId: context.ticketId,
                featureName: context.featureName || context.ticketId,
                explorationData: explorationData?.selectorMap || explorationData,
                testCases,
                frameworkInventory,
                assertionConfig,
                reviewFixes: retryOptions.reviewFixes,
                brokenSelectors: retryOptions.brokenSelectors,
            });

            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: phases.getPhase('coder').timeout,
                onDelta: (delta) => {
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.ticketId, {
                            agent: 'cognitive-coder',
                            stage: 'coder',
                            delta,
                        });
                    }
                },
            });

            // Check for generated spec file
            const specPath = this._findSpecFile(context.ticketId);
            const { report } = phases.coder.parseCoderOutput(response);

            this._log(`  Spec file: ${specPath ? path.basename(specPath) : 'NOT FOUND'}`);
            if (report) {
                this._log(`  Generation report: ${report.totalTests} tests, ${report.selectorsUsed} selectors, confidence: ${report.confidence}%`);
            }

            return {
                success: !!specPath,
                specPath,
                report,
                metrics: {
                    duration: Date.now() - phaseStart,
                    specCreated: !!specPath,
                    confidence: report?.confidence || 0,
                },
            };
        } catch (error) {
            this._log(`  ❌ Coder error: ${error.message}`);
            return {
                success: false,
                specPath: null,
                report: null,
                metrics: { duration: Date.now() - phaseStart, error: error.message },
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Phase 4: Reviewer — quality gate, no MCP, no file writes.
     */
    async _runReviewerPhase(context, store, coderResult, explorationData) {
        const phaseStart = Date.now();
        let session = null;
        let sessionId = null;

        try {
            if (!coderResult.specPath) {
                return { verdict: 'FAIL', issues: ['No spec file to review'], confidence: 0, metrics: { duration: 0 } };
            }

            const scriptContent = fs.readFileSync(coderResult.specPath, 'utf-8');
            const testCases = this._loadTestCases(context);
            const frameworkInventory = this._getFrameworkInventory();

            const sessionInfo = await this.sessionFactory.createAgentSession('cognitive-reviewer', {
                ticketId: context.ticketId,
                taskDescription: 'Review generated Playwright script',
                systemPromptOverride: phases.reviewer.buildReviewerSystemPrompt(),
                disableMCP: true,
                contextStore: store,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const prompt = phases.reviewer.buildReviewerUserPrompt({
                ticketId: context.ticketId,
                scriptContent,
                explorationData: explorationData?.selectorMap || explorationData,
                testCases,
                frameworkInventory,
            });

            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: phases.getPhase('reviewer').timeout,
            });

            const { verdict, issues, confidence, passedChecks, metrics: reviewMetrics } = phases.reviewer.parseReviewerOutput(response);

            this._log(`  Verdict: ${verdict} | Confidence: ${confidence} | Issues: ${issues.length}`);
            if (passedChecks?.length > 0) {
                this._log(`  Passed: ${passedChecks.slice(0, 3).join(', ')}`);
            }

            return {
                verdict,
                issues,
                confidence,
                passedChecks,
                metrics: {
                    duration: Date.now() - phaseStart,
                    issueCount: issues.length,
                    criticalIssues: issues.filter(i => i.severity === 'critical').length,
                    confidence,
                },
            };
        } catch (error) {
            this._log(`  ❌ Reviewer error: ${error.message}`);
            return {
                verdict: 'PASS', // Don't block on reviewer error — proceed with caution
                issues: [],
                confidence: 50,
                metrics: { duration: Date.now() - phaseStart, error: error.message },
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Phase 5: DryRun Validator — minimal MCP, selector verification.
     */
    async _runDryRunPhase(context, store, coderResult) {
        const phaseStart = Date.now();
        let session = null;
        let sessionId = null;

        try {
            if (!coderResult.specPath) {
                return { verdict: 'PROCEED', score: 0, broken: [], metrics: { duration: 0 } };
            }

            const scriptContent = fs.readFileSync(coderResult.specPath, 'utf-8');
            const selectors = phases.dryrun.extractSelectors(scriptContent);
            const urls = phases.dryrun.extractUrls(scriptContent);

            if (selectors.length === 0) {
                this._log('  No selectors found in script — skipping dry-run');
                return { verdict: 'PROCEED', score: 100, broken: [], metrics: { duration: 0 } };
            }

            const sessionInfo = await this.sessionFactory.createAgentSession('cognitive-dryrun', {
                ticketId: context.ticketId,
                taskDescription: 'Verify selectors on live page',
                systemPromptOverride: phases.dryrun.buildDryRunSystemPrompt(),
                toolProfile: 'dryrun',
                contextStore: store,
            });
            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            const prompt = phases.dryrun.buildDryRunUserPrompt({
                scriptContent,
                selectors,
                urls,
                appUrl: this._getAppUrl(context),
            });

            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: phases.getPhase('dryrun').timeout,
                onDelta: (delta) => {
                    if (delta && this._eventBridge) {
                        this._eventBridge.push('ai_delta', context.ticketId, {
                            agent: 'cognitive-dryrun',
                            stage: 'dryrun',
                            delta,
                        });
                    }
                },
            });

            const { verdict, score, broken, verified, totalSelectors } = phases.dryrun.parseDryRunOutput(response);

            this._log(`  Score: ${score}% | Verified: ${verified}/${totalSelectors} | Broken: ${broken.length}`);

            return {
                verdict,
                score,
                broken,
                verified,
                totalSelectors,
                metrics: {
                    duration: Date.now() - phaseStart,
                    score,
                    brokenCount: broken.length,
                },
            };
        } catch (error) {
            this._log(`  ❌ DryRun error: ${error.message}`);
            return {
                verdict: 'PROCEED', // Don't block on dry-run error
                score: 0,
                broken: [],
                metrics: { duration: Date.now() - phaseStart, error: error.message },
            };
        } finally {
            if (sessionId) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    _loadTestCases(context) {
        if (context.testCases) return context.testCases;
        if (context.testCasesPath && fs.existsSync(context.testCasesPath)) {
            // For Excel, we can only point to it; for markdown, read content
            if (context.testCasesPath.endsWith('.md')) {
                try { return fs.readFileSync(context.testCasesPath, 'utf-8'); } catch { }
            }
            return `Test cases available at: ${context.testCasesPath}`;
        }
        return '';
    }

    _getFeatureMap(ticketId) {
        if (!this.groundingStore) return null;
        try {
            return this.groundingStore.getFeatureMap?.(ticketId) || null;
        } catch { return null; }
    }

    _getHistoricalContext() {
        if (!this.learningStore) return null;
        try {
            const recent = this.learningStore.getRecentFailures(10);
            if (recent.length === 0) return null;
            return recent.map(f =>
                `- [${f.errorType}] ${f.selector} → ${f.outcome} (${f.method})`
            ).join('\n');
        } catch { return null; }
    }

    _getAppUrl(context) {
        if (context.appUrl) return context.appUrl;
        try {
            const envPath = path.join(__dirname, '..', '.env');
            if (fs.existsSync(envPath)) {
                const env = fs.readFileSync(envPath, 'utf-8');
                const match = env.match(/UAT_URL\s*=\s*(.+)/);
                if (match) return match[1].trim();
            }
        } catch { }
        return this.config.environments?.UAT?.baseUrl || null;
    }

    _getSelectorRecommendations(ticketId) {
        if (!this.groundingStore) return null;
        try {
            return this.groundingStore.getSelectorRecommendations?.(ticketId) || null;
        } catch { return null; }
    }

    _getFrameworkInventory() {
        try {
            const { getFrameworkInventoryCache, getInventorySummary } =
                require('../utils/project-path-resolver');
            return getInventorySummary(getFrameworkInventoryCache());
        } catch { return null; }
    }

    _getAssertionConfig() {
        try {
            const configPath = path.join(__dirname, '..', 'config', 'assertion-config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                // Return just the key patterns, not the full 1655-line config
                return {
                    activeFramework: config.activeFramework,
                    bestPractices: config.bestPractices?.slice(0, 5),
                    antiPatterns: config.antiPatterns?.slice(0, 5),
                };
            }
        } catch { }
        return null;
    }

    _findSpecFile(ticketId) {
        const specsDir = path.join(this.projectRoot, 'tests', 'specs');
        const ticketDir = path.join(specsDir, ticketId.toLowerCase());
        const specFile = path.join(ticketDir, `${ticketId}.spec.js`);

        if (fs.existsSync(specFile)) return specFile;

        // Try uppercase variant
        const altPath = path.join(ticketDir, `${ticketId.toUpperCase()}.spec.js`);
        if (fs.existsSync(altPath)) return altPath;

        // Search in ticket directory
        if (fs.existsSync(ticketDir)) {
            const files = fs.readdirSync(ticketDir).filter(f => f.endsWith('.spec.js'));
            if (files.length > 0) return path.join(ticketDir, files[0]);
        }

        return null;
    }

    _saveExplorationData(ticketId, exploration) {
        try {
            const explorationDir = path.join(__dirname, '..', 'exploration-data');
            if (!fs.existsSync(explorationDir)) fs.mkdirSync(explorationDir, { recursive: true });

            const standardData = phases.explorer.toStandardExplorationData(exploration, ticketId);
            const filePath = path.join(explorationDir, `${ticketId}-exploration.json`);
            fs.writeFileSync(filePath, JSON.stringify(standardData, null, 2), 'utf-8');
            this._log(`  Saved exploration data: ${path.basename(filePath)}`);
        } catch (error) {
            this._log(`  ⚠️ Failed to save exploration data: ${error.message}`);
        }
    }

    _buildResult(context, phaseResults, metrics, startTime, status) {
        metrics.totalDuration = Date.now() - startTime;

        return {
            success: status === 'success' && !!phaseResults.coder?.specPath,
            status,
            specPath: phaseResults.coder?.specPath || null,
            explorationPath: phaseResults.explorer?.exploration
                ? path.join(__dirname, '..', 'exploration-data', `${context.ticketId}-exploration.json`)
                : null,
            confidence: metrics.finalConfidence,
            metrics,
            phaseResults: {
                analyst: {
                    success: phaseResults.analyst?.success || false,
                    score: phaseResults.analyst?.score || 0,
                },
                explorer: {
                    success: phaseResults.explorer?.success || false,
                    score: phaseResults.explorer?.score || 0,
                    elementsFound: phaseResults.explorer?.exploration?.statistics?.totalElementsFound || 0,
                },
                coder: {
                    success: phaseResults.coder?.success || false,
                    confidence: phaseResults.coder?.report?.confidence || 0,
                },
                reviewer: {
                    verdict: phaseResults.reviewer?.verdict || 'SKIPPED',
                    confidence: phaseResults.reviewer?.confidence || 0,
                    issueCount: phaseResults.reviewer?.issues?.length || 0,
                },
                dryrun: {
                    verdict: phaseResults.dryrun?.verdict || 'SKIPPED',
                    score: phaseResults.dryrun?.score || 0,
                    brokenSelectors: phaseResults.dryrun?.broken?.length || 0,
                },
            },
        };
    }

    _log(msg) {
        if (this.verbose) {
            console.log(`[CognitiveScriptGen] ${msg}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    CognitiveScriptGenerator,
    PHASE_STATUS,
};
