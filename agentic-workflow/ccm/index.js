/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COGNITIVE CONTEXT MESH (CCM) — Main Integration Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Unified entry point that wires all CCM modules together and provides
 * a simple API for the SDK orchestrator to use.
 *
 * Usage:
 *   const { CognitiveContextMesh } = require('../ccm');
 *   const ccm = new CognitiveContextMesh(config);
 *   await ccm.initialize(sourcePaths);
 *
 *   // Before an agent runs:
 *   const plan = ccm.planContext('cognitive-coder', 'Generate login test');
 *   const context = ccm.renderContext(plan);
 *
 *   // After agent generates code:
 *   const report = ccm.verifyOutput(generatedCode);
 *
 *   // After run:
 *   ccm.recordRunMetrics(metrics);
 *
 * @module ccm/index
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const { ContextDNACompiler } = require('./context-dna-compiler');
const { CoverageMap, ConfidenceScorer, CONFIDENCE_LEVELS } = require('./coverage-map');
const { ContextNavigator, FocusTracker } = require('./context-navigator');
const { AssertionExtractor, ProvenanceTagger, ProvenanceVerifier, ConfidenceRenderer } = require('./provenance');
const { ContextLearner } = require('./context-learner');

// ─── Default CCM Configuration ──────────────────────────────────────────────

const DEFAULT_CCM_CONFIG = {
    enabled: true,
    verbose: false,
    maxContextChars: 120_000,
    reservedChars: 42_000, // basePrompt + ticket context

    // DNA Compiler
    dna: {
        dataDir: path.join(__dirname, '..', 'ccm-data'),
        autoRecompile: true,
        staleThresholdMs: 300_000, // 5 min
    },

    // Navigator
    navigator: {
        focusHalfLifeMs: 120_000, // 2 min
        learningEnabled: true,     // Use historical patterns to optimize
    },

    // Provenance
    provenance: {
        enableInlineAnnotations: false, // Add confidence comments to generated code
        riskThreshold: 0.3,             // Flag if ungrounded > 30%
    },
};


// ─── Cognitive Context Mesh ─────────────────────────────────────────────────

class CognitiveContextMesh {
    /**
     * @param {Object} [config] - Merged with DEFAULT_CCM_CONFIG
     */
    constructor(config = {}) {
        this.config = { ...DEFAULT_CCM_CONFIG, ...config };
        if (config.dna) this.config.dna = { ...DEFAULT_CCM_CONFIG.dna, ...config.dna };
        if (config.navigator) this.config.navigator = { ...DEFAULT_CCM_CONFIG.navigator, ...config.navigator };
        if (config.provenance) this.config.provenance = { ...DEFAULT_CCM_CONFIG.provenance, ...config.provenance };

        this.dnaCompiler = new ContextDNACompiler({
            dataDir: this.config.dna.dataDir,
            verbose: this.config.verbose,
        });
        this.coverageMap = new CoverageMap();
        this.navigator = new ContextNavigator(this.dnaCompiler, {
            maxContextChars: this.config.maxContextChars,
            reservedChars: this.config.reservedChars,
            focusTrackerOptions: { halfLifeMs: this.config.navigator.focusHalfLifeMs },
        });
        this.learner = new ContextLearner();
        this.confidenceRenderer = new ConfidenceRenderer();
        this.assertionExtractor = new AssertionExtractor();
        this._initialized = false;
    }

    // ═══════════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Initialize CCM — compile DNA from source files.
     *
     * @param {string[]} sourcePaths - Directories or files to compile
     * @param {Object} [options]
     * @param {boolean} [options.force=false] - Force full recompilation
     * @returns {Object} Compilation stats
     */
    async initialize(sourcePaths, options = {}) {
        if (!this.config.enabled) return { skipped: true, reason: 'CCM disabled' };

        this._log('Initializing Cognitive Context Mesh...');

        // Gather source files
        const sources = [];
        for (const p of sourcePaths) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                this._walkDir(p, sources);
            } else if (fs.existsSync(p)) {
                sources.push(p);
            }
        }

        this._log(`Found ${sources.length} source files to compile`);

        // Compile DNA
        const result = this.dnaCompiler.compile(sources, {
            force: options.force || false,
        });

        this._initialized = true;

        const l3 = this.dnaCompiler.getL3();
        this._log(`DNA compiled: ${l3 ? l3.components.length : 0} components, ${l3 ? l3.stats.totalFiles : 0} files`);

        return {
            initialized: true,
            components: l3 ? l3.components.length : 0,
            files: l3 ? l3.stats.totalFiles : 0,
            l2Cards: this.dnaCompiler.getAllL2Cards().length,
        };
    }

    /**
     * Check if DNA needs recompilation (files changed on disk).
     * @returns {boolean}
     */
    needsRecompile() {
        return this.dnaCompiler.recompileIfStale
            ? this.dnaCompiler.recompileIfStale()
            : false;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONTEXT PLANNING (Pre-Agent)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Plan optimal context for an agent's task.
     *
     * @param {string} agentName - Agent role identifier
     * @param {string} taskDescription - What the agent needs to do
     * @param {Object} [options]
     * @param {string[]} [options.explicitRegions] - Force-include region IDs
     * @returns {Object} NavigationPlan
     */
    planContext(agentName, taskDescription, options = {}) {
        this._ensureInitialized();

        // Get learning-based hints
        let hints = { upgrades: [], downgrades: [], warnings: [] };
        if (this.config.navigator.learningEnabled) {
            hints = this.learner.getContextHints(agentName, taskDescription);
        }

        // Plan navigation
        const plan = this.navigator.planNavigation(agentName, taskDescription, {
            ...options,
            // Include learning-recommended upgrades as explicit regions
            explicitRegions: [
                ...(options.explicitRegions || []),
                ...hints.upgrades.map(u => u.regionId),
            ],
        });

        // Add learning hints to plan
        plan.learningHints = hints;

        return plan;
    }

    /**
     * Render context from a navigation plan into a string for LLM injection.
     *
     * @param {Object} plan - NavigationPlan from planContext()
     * @param {string} [agentName] - For coverage tracking
     * @returns {{ contextString: string, stats: Object }}
     */
    renderContext(plan, agentName = null) {
        this._ensureInitialized();

        const rendered = this.navigator.executePlan(plan);

        // Record in coverage map
        for (const region of rendered.renderedRegions) {
            this.coverageMap.recordInjection(region.regionId, region.level, {
                charCount: region.chars,
                filePath: region.filePath,
                agent: agentName || plan.agentName,
            });
        }

        // Record navigation patterns for learning
        this.learner.recordNavigationPattern(
            agentName || plan.agentName,
            rendered.renderedRegions
        );

        return {
            contextString: rendered.contextString,
            stats: {
                totalChars: rendered.totalChars,
                regionsRendered: rendered.renderedRegions.length,
                coverageSummary: this.coverageMap.renderCoverageSummary(this.dnaCompiler),
            },
        };
    }

    /**
     * Get a coverage-aware context string with gap warnings.
     * Use this instead of renderContext() when you want automatic gap detection.
     *
     * @param {string} agentName
     * @param {string} taskDescription
     * @param {Object} [options]
     * @returns {{ contextString: string, gaps: Object[], sufficient: boolean, stats: Object }}
     */
    getOptimalContext(agentName, taskDescription, options = {}) {
        const plan = this.planContext(agentName, taskDescription, options);
        const rendered = this.renderContext(plan, agentName);

        // Check for gaps
        const gapAnalysis = this.coverageMap.detectGaps(taskDescription, this.dnaCompiler);
        const scorer = new ConfidenceScorer(this.coverageMap, this.dnaCompiler);
        const sufficiency = scorer.checkSufficiency(taskDescription);

        return {
            contextString: rendered.contextString,
            gaps: gapAnalysis.gaps,
            gapSuggestions: gapAnalysis.suggestions,
            sufficient: sufficiency.sufficient,
            sufficiencyReport: sufficiency.recommendation,
            stats: rendered.stats,
            plan,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // OUTPUT VERIFICATION (Post-Agent)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Verify generated code against context provenance.
     *
     * @param {string} generatedCode - The .spec.js code generated by an agent
     * @param {Object} [verificationContext] - Optional live data
     * @param {Object[]} [verificationContext.snapshotElements] - MCP snapshot elements
     * @returns {Object} Verification report
     */
    verifyOutput(generatedCode, verificationContext = {}) {
        this._ensureInitialized();

        // 1. Extract assertions from the generated code
        const assertions = this.assertionExtractor.extract(generatedCode);

        // 2. Tag with provenance
        const tagger = new ProvenanceTagger(this.coverageMap, this.dnaCompiler);
        const tagged = tagger.tag(assertions);

        // 3. Verify against DNA + snapshots
        const verifier = new ProvenanceVerifier(this.dnaCompiler);
        const verificationResult = verifier.verify(tagged, verificationContext);

        // 4. Record hallucinations for learning
        for (const result of verificationResult.results) {
            if (result.verification.finalStatus === CONFIDENCE_LEVELS.UNGROUNDED) {
                this.learner.recordHallucination(
                    result.provenance?.regionId || 'unknown',
                    result.type,
                    result.value
                );
            }
        }

        // 5. Generate report
        const report = this.confidenceRenderer.renderReport(verificationResult);

        // 6. Optional inline annotations
        let annotatedCode = generatedCode;
        if (this.config.provenance.enableInlineAnnotations) {
            annotatedCode = this.confidenceRenderer.renderInlineAnnotations(
                generatedCode, verificationResult.results
            );
        }

        return {
            ...verificationResult,
            report,
            annotatedCode,
            riskAlert: verificationResult.summary.riskLevel === 'HIGH'
                ? `HIGH RISK: ${verificationResult.summary.ungrounded} of ${verificationResult.summary.total} assertions are ungrounded. Review selectors and method calls before execution.`
                : null,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // DIAGNOSTICS & METRICS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Get current coverage heatmap.
     * @returns {Object[]}
     */
    getHeatmap() {
        this._ensureInitialized();
        return this.coverageMap.toHeatmap(this.dnaCompiler);
    }

    /**
     * Get global coverage stats.
     * @returns {Object}
     */
    getCoverageStats() {
        return this.coverageMap.getGlobalCoverage(this.dnaCompiler);
    }

    /**
     * Get learning insights.
     * @returns {Object}
     */
    getLearningInsights() {
        return {
            trends: this.learner.getTrends(),
            hotspots: this.learner.getHallucinationHotspots(),
        };
    }

    /**
     * Record post-run metrics for trend tracking.
     * @param {Object} metrics
     */
    recordRunMetrics(metrics) {
        const coverageStats = this.getCoverageStats();
        this.learner.recordRunMetrics({
            ...metrics,
            coveragePercent: coverageStats.coveragePercent,
        });
    }

    /**
     * Get a comprehensive status dump for debugging.
     * @returns {Object}
     */
    getStatus() {
        const l3 = this._initialized ? this.dnaCompiler.getL3() : null;
        return {
            initialized: this._initialized,
            enabled: this.config.enabled,
            dna: l3 ? {
                components: l3.components.length,
                totalFiles: l3.stats.totalFiles,
                l2Cards: this.dnaCompiler.getAllL2Cards().length,
            } : null,
            coverage: this.getCoverageStats(),
            learning: {
                trends: this.learner.getTrends(),
                hotspots: this.learner.getHallucinationHotspots(3),
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // BACKWARD COMPATIBILITY — Integration with existing ContextEngine
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Generate a frameworkInventory string replacement for ContextEngine.
     * Instead of raw file scan output, returns DNA-optimized context.
     *
     * @param {string} agentName
     * @param {string} taskDescription
     * @returns {string} Framework inventory context string
     */
    generateFrameworkInventory(agentName, taskDescription) {
        if (!this._initialized) return null;

        const plan = this.planContext(agentName, taskDescription);
        const rendered = this.renderContext(plan, agentName);

        // Wrap in format compatible with ContextEngine expectations
        const header = `# Framework Inventory (CCM-optimized, ${plan.regionCount} modules)\n`;
        const coverageNote = this.coverageMap.renderCoverageSummary(this.dnaCompiler);
        return header + coverageNote + '\n\n' + rendered.contextString;
    }

    /**
     * Generate a groundingContext string replacement for ContextEngine.
     * DNA-aware grounding that uses L2 cards instead of BM25 chunks.
     *
     * @param {string} taskDescription
     * @returns {string|null}
     */
    generateGroundingContext(taskDescription) {
        if (!this._initialized) return null;

        const l3 = this.dnaCompiler.getL3();
        if (!l3) return null;

        const relevantRegions = this.dnaCompiler.findRelevantRegions(taskDescription, { maxResults: 10 });

        const sections = [];
        sections.push('## Project Architecture');
        sections.push(`Components: ${l3.components.map(c => c.name).join(', ')}`);

        if (l3.dataFlows && l3.dataFlows.length > 0) {
            sections.push('\n## Key Data Flows');
            for (const flow of l3.dataFlows.slice(0, 5)) {
                sections.push(`- ${flow.from} → ${flow.to}: ${flow.mechanism}`);
            }
        }

        sections.push('\n## Relevant Modules');
        for (const region of relevantRegions.slice(0, 8)) {
            const l2 = this.dnaCompiler.getL2(region.regionId);
            if (l2) {
                sections.push(`\n### ${l2.filePath}`);
                sections.push(`Purpose: ${l2.purpose}`);
                if (l2.api && l2.api.length > 0) {
                    sections.push(`API: ${l2.api.map(a => a.name || a).join(', ')}`);
                }
                if (l2.dependencies && l2.dependencies.length > 0) {
                    sections.push(`Depends on: ${l2.dependencies.join(', ')}`);
                }
            }
        }

        return sections.join('\n');
    }

    // ─── Internal ───────────────────────────────────────────────────

    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error('CognitiveContextMesh not initialized. Call initialize() first.');
        }
    }

    _walkDir(dir, files) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            // Skip node_modules, hidden dirs, and non-source files
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            if (entry.isDirectory()) {
                this._walkDir(fullPath, files);
            } else if (/\.(js|json|md)$/.test(entry.name) && !entry.name.includes('.spec.')) {
                files.push(fullPath);
            }
        }
    }

    _log(msg) {
        if (this.config.verbose) console.log(`[CCM] ${msg}`);
    }
}


// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    CognitiveContextMesh,
    // Re-export individual modules for direct use
    ContextDNACompiler,
    CoverageMap,
    ConfidenceScorer,
    ContextNavigator,
    FocusTracker,
    AssertionExtractor,
    ProvenanceTagger,
    ProvenanceVerifier,
    ConfidenceRenderer,
    ContextLearner,
    CONFIDENCE_LEVELS,
};
