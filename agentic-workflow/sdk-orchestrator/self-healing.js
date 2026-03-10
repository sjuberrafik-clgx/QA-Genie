/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SELF-HEALING ENGINE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replaces the placeholder fixTestsWithMCP() in test-iteration-engine.js with
 * a real closed-loop self-healing cycle:
 *
 *   1. Run Playwright tests → collect failures
 *   2. ErrorAnalyzer categorizes errors + generates auto-fix suggestions
 *   3. For auto-fixable errors → apply regex transforms directly (no AI needed)
 *   4. For selector errors → create SDK healing session → MCP re-exploration
 *   5. Re-run tests → iterate (max N iterations)
 *   6. Record all attempts in learning store
 *
 * @module self-healing
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { extractJSON, getStageTimeout } = require('./utils');

class SelfHealingEngine {
    /**
     * @param {Object} options
     * @param {Object} options.sessionFactory  - AgentSessionFactory instance
     * @param {Object} [options.learningStore] - LearningStore instance
     * @param {number} [options.maxIterations] - Max healing iterations (default: 3)
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        this.sessionFactory = options.sessionFactory;
        this.learningStore = options.learningStore || null;
        this.maxIterations = options.maxIterations || 3;
        this.verbose = options.verbose || false;
        this.config = options.config || {};
        this.projectRoot = path.join(__dirname, '..', '..');
    }

    /**
     * Run the self-healing loop for a failing spec file.
     *
     * @param {string} ticketId  - Jira ticket ID
     * @param {string} specPath  - Path to the .spec.js file
     * @param {Object} [runtimeOptions] - Runtime overrides from pipeline cognitive scaling
     * @param {number} [runtimeOptions.maxIterations] - Override max iterations from cognitive tier
     * @param {number} [runtimeOptions.timeoutMs] - Override timeout from cognitive tier
     * @param {string} [runtimeOptions.cognitiveTier] - Complexity tier (simple/moderate/complex)
     * @returns {Object} Healing result
     */
    async heal(ticketId, specPath, runtimeOptions = {}) {
        // Apply cognitive scaling overrides if provided
        const effectiveMaxIterations = runtimeOptions.maxIterations || this.maxIterations;
        const cognitiveTier = runtimeOptions.cognitiveTier || null;

        this._log('═══════════════════════════════════════════════');
        this._log('  SELF-HEALING ENGINE');
        this._log(`  Ticket: ${ticketId}`);
        this._log(`  Spec: ${specPath}`);
        if (cognitiveTier) {
            this._log(`  Cognitive Tier: ${cognitiveTier} (maxIter: ${effectiveMaxIterations})`);
        }
        this._log('═══════════════════════════════════════════════');

        const resolvedSpec = path.isAbsolute(specPath)
            ? specPath
            : path.join(this.projectRoot, specPath);

        if (!fs.existsSync(resolvedSpec)) {
            return { success: false, error: `Spec file not found: ${resolvedSpec}`, iterations: 0 };
        }

        // Initialize _lastSpecContent with the current file to properly detect first-iteration changes
        this._lastSpecContent = fs.readFileSync(resolvedSpec, 'utf-8');

        let iteration = 0;
        let lastTestResult = null;
        let totalFixesApplied = 0;
        const healingLog = [];

        while (iteration < effectiveMaxIterations) {
            iteration++;
            this._log(`\n── Iteration ${iteration}/${effectiveMaxIterations} ──`);

            // Step 1: Run tests
            const testResult = await this._runTests(resolvedSpec);
            lastTestResult = testResult;

            if (testResult.passed) {
                this._log(`✅ All tests passed on iteration ${iteration}!`);
                healingLog.push({ iteration, action: 'tests_passed', tests: testResult });
                break;
            }

            this._log(`❌ ${testResult.failedCount}/${testResult.totalCount} tests failed`);
            healingLog.push({ iteration, action: 'tests_failed', tests: testResult });

            // Step 2: Analyze failures — now with cognitive multi-hypothesis (ToT) reasoning
            const analysis = this._analyzeFailures(testResult);
            const hypotheses = analysis.hypotheses || [];
            const causalChain = analysis.causalChain || null;

            this._log(`Analysis: category=${analysis.category}, autoFixable=${analysis.autoFixable}`);
            if (hypotheses.length > 1) {
                this._log(`  🧠 ToT Hypotheses (${hypotheses.length}):`);
                for (const h of hypotheses) {
                    this._log(`    [${h.rank}] ${h.category} — confidence=${h.confidence}% | ${h.pattern}`);
                }
            }
            if (causalChain) {
                this._log(`  🔗 Causal chain detected: ${causalChain.chain?.map(c => c.category).join(' → ') || 'unknown'}`);
                this._log(`  🎯 Root cause: ${causalChain.rootCause?.category || analysis.category}`);
            }

            healingLog.push({
                iteration,
                action: 'cognitive_analysis',
                hypotheses: hypotheses.map(h => ({ rank: h.rank, category: h.category, confidence: h.confidence, pattern: h.pattern })),
                causalChain: causalChain ? { rootCause: causalChain.rootCause?.category, chainLength: causalChain.chain?.length } : null,
            });

            // ──────────────────────────────────────────────────────────────
            // Step 3: COGNITIVE HEALING — Tree-of-Thoughts Strategy Selection
            // Instead of single-path (auto-fix or SDK), evaluate hypotheses
            // ranked by confidence and try cheapest fix first.
            // ──────────────────────────────────────────────────────────────

            let healed = false;

            // Strategy A: Try auto-fix from primary hypothesis first
            if (analysis.autoFixable && analysis.autoFix) {
                this._log('Strategy A: Attempting auto-fix from primary hypothesis...');
                const autoFixResult = this._applyAutoFix(resolvedSpec, analysis.autoFix);

                if (autoFixResult.success) {
                    totalFixesApplied += autoFixResult.changes.length;
                    this._log(`✅ Auto-fix applied: ${autoFixResult.changes.join(', ')}`);
                    healingLog.push({ iteration, action: 'auto_fix', strategy: 'primary', changes: autoFixResult.changes });
                    this._recordLearning(ticketId, analysis, autoFixResult, 'auto-fix');
                    healed = true;
                } else {
                    this._log('Primary auto-fix did not produce changes');
                }
            }

            // Strategy B: If primary fix failed, try secondary/tertiary hypotheses
            // (ToT branching — evaluate alternative fix paths before expensive SDK)
            if (!healed && hypotheses.length > 1) {
                for (let i = 1; i < hypotheses.length && !healed; i++) {
                    const altHypothesis = hypotheses[i];
                    this._log(`Strategy B: Trying alternative hypothesis [${altHypothesis.rank}] ${altHypothesis.category} (confidence=${altHypothesis.confidence}%)...`);

                    // Check if this alternative hypothesis has an auto-fix
                    const altAutoFix = this._generateAutoFixForHypothesis(altHypothesis, testResult);
                    if (altAutoFix) {
                        const altFixResult = this._applyAutoFix(resolvedSpec, altAutoFix);
                        if (altFixResult.success) {
                            totalFixesApplied += altFixResult.changes.length;
                            this._log(`✅ Alternative fix [${altHypothesis.rank}] applied: ${altFixResult.changes.join(', ')}`);
                            healingLog.push({
                                iteration,
                                action: 'auto_fix',
                                strategy: `hypothesis-${altHypothesis.rank}`,
                                category: altHypothesis.category,
                                changes: altFixResult.changes,
                            });
                            this._recordLearning(ticketId, { ...analysis, category: altHypothesis.category }, altFixResult, 'auto-fix-alt');
                            healed = true;
                        }
                    }
                }
                if (!healed) {
                    this._log('No alternative hypotheses produced viable auto-fixes');
                }
            }

            // Strategy C: If causal chain detected, target root cause with SDK
            // (more efficient than fixing the symptom — e.g., fix AUTH root cause
            // instead of repeatedly repairing SELECTOR symptoms)
            if (!healed && causalChain && causalChain.rootCause) {
                const rootCategory = causalChain.rootCause.category;
                if (rootCategory !== analysis.category) {
                    this._log(`Strategy C: Causal chain — targeting root cause (${rootCategory}) instead of symptom (${analysis.category})...`);
                    healingLog.push({
                        iteration,
                        action: 'causal_chain_redirect',
                        symptom: analysis.category,
                        rootCause: rootCategory,
                    });
                    // Adjust the analysis category to root cause for SDK healing
                    analysis.category = rootCategory;
                    analysis._causalChainApplied = true;
                }
            }

            // Strategy D: SDK session with MCP re-exploration (expensive — last resort)
            if (!healed && (analysis.category === 'SELECTOR' || analysis.category === 'TIMING' || analysis._causalChainApplied) && iteration < effectiveMaxIterations) {
                this._log(`Strategy D: Launching SDK healing session for ${analysis.category} repair...`);

                // Enrich SDK prompt with cognitive insights from all hypotheses
                const enrichedAnalysis = {
                    ...analysis,
                    cognitiveInsights: {
                        hypotheses: hypotheses.map(h => `[${h.rank}] ${h.category}: ${h.matchedText || h.pattern} (${h.confidence}%)`),
                        causalChain: causalChain ? `Root: ${causalChain.rootCause?.category} → ${causalChain.chain?.map(c => c.category).join(' → ')}` : null,
                        suggestedFocus: hypotheses[0]?.suggestions?.slice(0, 3) || [],
                    },
                };

                const healResult = await this._healWithSDK(
                    ticketId, resolvedSpec, testResult, enrichedAnalysis
                );

                if (healResult.success) {
                    totalFixesApplied += healResult.changesCount;
                    this._log(`✅ SDK healing applied ${healResult.changesCount} fix(es)`);
                    healingLog.push({ iteration, action: 'sdk_heal', strategy: 'cognitive-enriched', result: healResult });
                    this._recordLearning(ticketId, analysis, healResult, 'sdk-heal');
                    healed = true;
                } else {
                    this._log(`SDK healing failed: ${healResult.error}`);
                    healingLog.push({ iteration, action: 'sdk_heal_failed', error: healResult.error });
                }
            }

            if (healed) continue; // Re-run tests with the fix

            // Step 4: Cannot heal — log reasoning from all hypotheses
            const cannotHealReason = hypotheses.length > 0
                ? `Primary: ${hypotheses[0].category} (${hypotheses[0].confidence}%). ` +
                `Tried ${hypotheses.length} hypothes${hypotheses.length > 1 ? 'es' : 'is'}. ` +
                `All strategies exhausted for this iteration.`
                : `${analysis.category} errors require manual intervention`;

            this._log(`Cannot heal: ${cannotHealReason}`);
            healingLog.push({
                iteration,
                action: 'cannot_heal',
                reason: cannotHealReason,
                hypothesesExhausted: hypotheses.length,
            });
            break;
        }

        const success = lastTestResult?.passed || false;

        // Save final test results for the Reports dashboard
        if (lastTestResult?.rawOutput) {
            try {
                const parsedResult = extractJSON(lastTestResult.rawOutput);
                this._saveHealingReport(ticketId, iteration, parsedResult);
            } catch { /* extractJSON failed — try saving raw envelope */
                this._saveHealingReport(ticketId, iteration, {
                    rawError: (lastTestResult.rawOutput || '').substring(0, 50000),
                });
            }
        }

        // Final learning store update
        if (this.learningStore) {
            this.learningStore.save();
        }

        const result = {
            success,
            iterations: iteration,
            totalFixesApplied,
            passRate: lastTestResult
                ? Math.round(((lastTestResult.totalCount - lastTestResult.failedCount) / lastTestResult.totalCount) * 100)
                : 0,
            healingLog,
            message: success
                ? `Tests healed after ${iteration} iteration(s) with ${totalFixesApplied} fix(es)`
                : `Self-healing exhausted ${iteration} iterations — ${lastTestResult?.failedCount || 0} tests still failing`,
        };

        this._log('\n═══════════════════════════════════════════════');
        this._log(`  RESULT: ${result.message}`);
        this._log('═══════════════════════════════════════════════');

        return result;
    }

    // ─── Internal Methods ───────────────────────────────────────────────

    /**
     * Run Playwright tests and collect structured results.
     */
    async _runTests(specPath) {
        try {
            const relativePath = path.relative(this.projectRoot, specPath).replace(/\\/g, '/');
            const escapedPath = relativePath.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');
            this._log(`Running: npx playwright test "${escapedPath}"`);

            const output = execSync(
                `npx playwright test "${escapedPath}" --reporter=json`,
                {
                    encoding: 'utf-8',
                    stdio: 'pipe',
                    cwd: this.projectRoot,
                    timeout: getStageTimeout(this.config, 'execution', 120000),
                }
            );

            const result = extractJSON(output);
            const specs = result.suites?.[0]?.specs || [];
            const failed = specs.filter(s => s.tests?.[0]?.status === 'failed');

            return {
                passed: failed.length === 0,
                totalCount: specs.length,
                failedCount: failed.length,
                failedTests: failed.map(s => s.title),
                passedTests: specs.filter(s => s.tests?.[0]?.status === 'passed').map(s => s.title),
                error: null,
                rawOutput: output,
            };
        } catch (error) {
            const errorOutput = error.stdout || error.stderr || error.message;

            // Try to parse JSON from error output (Playwright exits non-zero on failures)
            try {
                const result = extractJSON(errorOutput);
                const specs = result.suites?.[0]?.specs || [];
                const failed = specs.filter(s => s.tests?.[0]?.status === 'failed');
                return {
                    passed: false,
                    totalCount: specs.length,
                    failedCount: failed.length,
                    failedTests: failed.map(s => s.title),
                    passedTests: specs.filter(s => s.tests?.[0]?.status === 'passed').map(s => s.title),
                    error: null,
                    rawOutput: errorOutput,
                };
            } catch { /* JSON parse failed */ }

            const failedTests = this._parseFailedTests(errorOutput);

            return {
                passed: false,
                totalCount: failedTests.length || 1,
                failedCount: failedTests.length || 1,
                failedTests,
                passedTests: [],
                error: errorOutput,
                rawOutput: errorOutput,
            };
        }
    }

    /**
     * Parse failed test names from raw output.
     */
    _parseFailedTests(output) {
        const failedTests = [];
        const regex = /›\s+(.+?)$/gm;
        let match;
        while ((match = regex.exec(output)) !== null) {
            if (match[1] && !failedTests.includes(match[1].trim())) {
                failedTests.push(match[1].trim());
            }
        }
        return failedTests.length > 0 ? failedTests : ['Unknown test'];
    }

    /**
     * Save test results from a healing iteration to test-artifacts/reports/
     * so they appear on the Reports dashboard.
     */
    _saveHealingReport(ticketId, iteration, playwrightResult) {
        try {
            const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }
            const runId = `heal_${ticketId}_iter${iteration}_${Date.now()}`;
            const fileName = `${ticketId}-${runId}-test-results.json`;
            const filePath = path.join(reportsDir, fileName);
            const payload = {
                ticketId,
                runId,
                mode: 'healing',
                specPath: null,
                timestamp: new Date().toISOString(),
                playwrightResult,
            };
            fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
            this._log(`📄 Healing report saved: ${fileName}`);
            return filePath;
        } catch (err) {
            this._log(`⚠️ Failed to save healing report: ${err.message}`);
            return null;
        }
    }

    /**
     * Analyze test failures using ErrorAnalyzer.
     */
    _analyzeFailures(testResult) {
        try {
            const { ErrorAnalyzer } = require('../../.github/agents/lib/error-analyzer');
            const analyzer = new ErrorAnalyzer();
            return analyzer.analyze(testResult.error || testResult.rawOutput || '', {});
        } catch (error) {
            return {
                category: 'UNKNOWN',
                severity: 'HIGH',
                autoFixable: false,
                suggestions: [],
                aiInsights: {},
                matchedPatterns: [],
            };
        }
    }

    /**
     * Apply auto-fix transforms (regex-based, no AI needed).
     */
    _applyAutoFix(specPath, autoFix) {
        try {
            const { ErrorAnalyzer } = require('../../.github/agents/lib/error-analyzer');
            const analyzer = new ErrorAnalyzer();
            return analyzer.applyAutoFix(specPath, autoFix);
        } catch (error) {
            return { success: false, message: error.message, changes: [] };
        }
    }

    /**
     * Generate auto-fix for an alternative hypothesis (ToT branching).
     * Attempts to create a fix based on the hypothesis category when the
     * primary hypothesis fix failed. This avoids expensive SDK sessions
     * by trying cheaper regex-based fixes from secondary hypotheses.
     *
     * @param {Object} hypothesis - A ranked hypothesis from ErrorAnalyzer
     * @param {Object} testResult - Test execution result
     * @returns {Object|null} Auto-fix object or null if not auto-fixable
     */
    _generateAutoFixForHypothesis(hypothesis, testResult) {
        try {
            const { ErrorAnalyzer } = require('../../.github/agents/lib/error-analyzer');
            const analyzer = new ErrorAnalyzer();

            // Build a synthetic analysis from the hypothesis for auto-fix generation
            const syntheticAnalysis = {
                category: hypothesis.category,
                severity: hypothesis.severity,
                matchedPatterns: [{ name: hypothesis.pattern, match: hypothesis.matchedText || '' }],
                suggestions: hypothesis.suggestions || [],
                rawError: testResult.error || testResult.rawOutput || '',
            };

            // Check if this category is auto-fixable
            if (!analyzer.canAutoFix(syntheticAnalysis)) return null;

            // Generate the auto-fix
            return analyzer.generateAutoFix(syntheticAnalysis, {});
        } catch {
            return null;
        }
    }

    /**
     * Heal with an SDK session — creates a scriptgenerator session that
     * performs live MCP exploration to fix broken selectors.
     */
    async _healWithSDK(ticketId, specPath, testResult, analysis) {
        let session = null;
        let sessionId = null;

        try {
            // Load existing exploration data
            let explorationData = null;
            const explorationFile = path.join(
                __dirname, '..', 'exploration-data', `${ticketId}-exploration.json`
            );
            if (fs.existsSync(explorationFile)) {
                explorationData = fs.readFileSync(explorationFile, 'utf-8');
            }

            // Create healing session
            const sessionInfo = await this.sessionFactory.createHealingSession(
                {
                    ticketId,
                    category: analysis.category,
                    severity: analysis.severity,
                    suggestions: analysis.suggestions,
                    failedTests: testResult.failedTests,
                    errorSnippet: (testResult.error || '').substring(0, 2000),
                },
                specPath,
                explorationData
            );

            session = sessionInfo.session;
            sessionId = sessionInfo.sessionId;

            // Build the healing prompt — enriched with cognitive insights
            const cognitiveContext = analysis.cognitiveInsights
                ? [
                    '',
                    '## Cognitive Analysis (Chain-of-Thought reasoning from ErrorAnalyzer):',
                    '',
                    '### Ranked Hypotheses (Tree-of-Thoughts — try fixes in this priority):',
                    ...(analysis.cognitiveInsights.hypotheses || []).map(h => `  ${h}`),
                    '',
                    analysis.cognitiveInsights.causalChain
                        ? `### Causal Chain: ${analysis.cognitiveInsights.causalChain}`
                        : '',
                    '',
                    '### Suggested Focus Areas:',
                    ...(analysis.cognitiveInsights.suggestedFocus || []).map(s => `  - ${s}`),
                    '',
                    'Use the above analysis to guide your repair — fix the ROOT CAUSE, not just the first symptom.',
                ].filter(Boolean)
                : [];

            const prompt = [
                `Fix the failing tests in ${specPath}`,
                '',
                `Failed tests: ${testResult.failedTests.join(', ')}`,
                '',
                'Error output (first 1000 chars):',
                (testResult.error || '').substring(0, 1000),
                ...cognitiveContext,
                '',
                'Instructions:',
                '1. Navigate to the application page where these tests run',
                '2. Take a fresh snapshot to get current selectors',
                '3. Compare the snapshot selectors with the ones in the spec file',
                '4. Update ONLY the broken selectors — minimize changes',
                '5. If causal chain indicates a root cause different from selector issues, address that first',
                '6. Use the validate_generated_script tool to verify your fix',
            ].join('\n');

            // Send prompt and wait for completion
            const response = await this.sessionFactory.sendAndWait(session, prompt, {
                timeout: getStageTimeout(this.config, 'healing', 300000),
            });

            // Check if the spec file was actually modified
            const currentContent = fs.readFileSync(specPath, 'utf-8');
            const hasChanges = currentContent !== (this._lastSpecContent || '');
            this._lastSpecContent = currentContent;

            return {
                success: hasChanges,
                changesCount: hasChanges ? 1 : 0,
                response: response?.substring(0, 500),
                error: hasChanges ? null : 'SDK session did not modify the spec file',
            };
        } catch (error) {
            return {
                success: false,
                changesCount: 0,
                error: error.message,
            };
        } finally {
            // Cleanup session
            if (sessionId && this.sessionFactory) {
                await this.sessionFactory.destroySession(sessionId).catch(() => { });
            }
        }
    }

    /**
     * Record healing attempt in the learning store.
     */
    _recordLearning(ticketId, analysis, result, method) {
        if (!this.learningStore) return;

        this.learningStore.recordFailure({
            ticketId,
            errorType: analysis.category,
            selector: analysis.matchedPatterns?.[0]?.match || 'unknown',
            fix: result.changes?.[0] || method,
            outcome: result.success ? 'fixed' : 'persisted',
            method,
            timestamp: new Date().toISOString(),
        });
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[SelfHealing] ${message}`);
        } else {
            // Always log key messages
            if (message.includes('═') || message.includes('✅') || message.includes('❌') || message.includes('RESULT')) {
                console.log(`[SelfHealing] ${message}`);
            }
        }
    }
}

module.exports = { SelfHealingEngine };
