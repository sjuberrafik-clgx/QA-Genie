/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COVERAGE MAP — Provable Context Knowledge Tracking
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tracks EXACTLY what context the LLM has seen, at what resolution, with
 * confidence scores. Eliminates the guessing game of "does the LLM have
 * enough context to answer this correctly?"
 *
 * Key capabilities:
 *   ✦ Region-level tracking: Which files/modules are in context at what level
 *   ✦ Per-assertion confidence: Green (L0-verified) / Yellow (inferred) / Red (ungrounded)
 *   ✦ Gap detection: "Your question involves X, which is not in current context"
 *   ✦ Coverage queries: "94% of auth module at L1, 0% of payment module"
 *   ✦ Heatmap generation: JSON structure for visualization
 *
 * Zero LLM cost — 100% deterministic JavaScript.
 *
 * @module ccm/coverage-map
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_LEVELS = {
    VERIFIED: 'verified',     // L0 source in context — high confidence
    STRONG: 'strong',         // L1 skeleton in context — good confidence
    INFERRED: 'inferred',     // L2 card in context — moderate confidence
    OVERVIEW: 'overview',     // L3 only — low detail confidence
    UNGROUNDED: 'ungrounded', // Not in context at all — potential hallucination
};

const RESOLUTION_SCORES = {
    'L0': 1.0,
    'L1': 0.75,
    'L2': 0.45,
    'L3': 0.2,
};

// ─── Coverage Map ───────────────────────────────────────────────────────────

class CoverageMap {
    constructor() {
        // regionId → { level, confidence, charCount, lastAccessed, accessCount, filePath, purpose }
        this._regions = new Map();
        // Track injection events for audit trail
        this._injectionLog = [];
        // Track gaps detected
        this._gaps = [];
        this._createdAt = new Date().toISOString();
    }

    // ─── Recording ──────────────────────────────────────────────────

    /**
     * Record that a context region was injected into the LLM's context.
     *
     * @param {string} regionId - DNA region identifier
     * @param {string} level - Resolution level: 'L0', 'L1', 'L2', 'L3'
     * @param {Object} [metadata]
     * @param {number} [metadata.charCount] - Characters injected
     * @param {string} [metadata.filePath] - Source file path
     * @param {string} [metadata.purpose] - Module purpose (from L2 card)
     * @param {string} [metadata.agent] - Agent that received this context
     */
    recordInjection(regionId, level, metadata = {}) {
        const existing = this._regions.get(regionId);
        const now = new Date().toISOString();

        if (existing) {
            // Upgrade resolution if higher level injected
            const existingScore = RESOLUTION_SCORES[existing.level] || 0;
            const newScore = RESOLUTION_SCORES[level] || 0;
            if (newScore > existingScore) {
                existing.level = level;
                existing.confidence = newScore;
            }
            existing.lastAccessed = now;
            existing.accessCount = (existing.accessCount || 0) + 1;
            if (metadata.agent) existing.agents = [...new Set([...(existing.agents || []), metadata.agent])];
        } else {
            this._regions.set(regionId, {
                level,
                confidence: RESOLUTION_SCORES[level] || 0,
                charCount: metadata.charCount || 0,
                filePath: metadata.filePath || null,
                purpose: metadata.purpose || null,
                agents: metadata.agent ? [metadata.agent] : [],
                lastAccessed: now,
                accessCount: 1,
                injectedAt: now,
            });
        }

        this._injectionLog.push({
            regionId,
            level,
            timestamp: now,
            agent: metadata.agent || null,
            charCount: metadata.charCount || 0,
        });
    }

    /**
     * Record that a region was evicted/compressed from context.
     *
     * @param {string} regionId
     * @param {string} reason - Why it was evicted (e.g., 'budget_exceeded', 'focus_decay')
     */
    recordEviction(regionId, reason = 'unknown') {
        const region = this._regions.get(regionId);
        if (region) {
            region.evictedAt = new Date().toISOString();
            region.evictionReason = reason;
            // Downgrade confidence but don't remove — the LLM "saw" it once
            region.confidence = Math.max(0.1, region.confidence * 0.3);
        }
    }

    /**
     * Record all regions from a packContext() result.
     *
     * @param {Object} packResult - Result from ContextEngine.packContext()
     * @param {Object[]} regionResolutions - From ContextDNACompiler.buildOptimalContext()
     * @param {string} agentName
     */
    recordPackResult(packResult, regionResolutions = [], agentName = 'unknown') {
        // Record included regions
        for (const res of regionResolutions) {
            this.recordInjection(res.regionId, res.resolvedLevel || 'L2', {
                charCount: 0,
                filePath: res.filePath,
                purpose: res.purpose,
                agent: agentName,
            });
        }

        // Record dropped components as gaps
        for (const dropped of (packResult.dropped || [])) {
            this._gaps.push({
                component: dropped.key,
                chars: dropped.chars,
                priority: dropped.priority,
                timestamp: new Date().toISOString(),
                agent: agentName,
                reason: 'budget_exceeded',
            });
        }
    }

    // ─── Querying ───────────────────────────────────────────────────

    /**
     * Get coverage info for a specific region.
     *
     * @param {string} regionId
     * @returns {{ level: string, confidence: number, lastAccessed: string, status: string }|null}
     */
    getRegionCoverage(regionId) {
        const region = this._regions.get(regionId);
        if (!region) return { level: null, confidence: 0, status: CONFIDENCE_LEVELS.UNGROUNDED };
        return {
            level: region.level,
            confidence: region.confidence,
            lastAccessed: region.lastAccessed,
            status: this._confidenceToStatus(region.confidence),
            filePath: region.filePath,
            agents: region.agents,
        };
    }

    /**
     * Get global coverage statistics.
     *
     * @param {Object} [dnaCompiler] - If provided, calculates coverage against all known regions
     * @returns {Object} Coverage statistics
     */
    getGlobalCoverage(dnaCompiler = null) {
        const covered = this._regions.size;
        const total = dnaCompiler ? dnaCompiler.getAllL2Cards().length : covered;
        const uncovered = total - covered;

        // Coverage by level
        const byLevel = { L0: 0, L1: 0, L2: 0, L3: 0 };
        for (const region of this._regions.values()) {
            byLevel[region.level] = (byLevel[region.level] || 0) + 1;
        }

        // Average confidence
        const confidences = [...this._regions.values()].map(r => r.confidence);
        const avgConfidence = confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0;

        return {
            totalRegions: total,
            coveredRegions: covered,
            uncoveredRegions: uncovered,
            coveragePercent: total > 0 ? ((covered / total) * 100).toFixed(1) + '%' : '0%',
            byLevel,
            averageConfidence: parseFloat(avgConfidence.toFixed(3)),
            gapsDetected: this._gaps.length,
            injectionCount: this._injectionLog.length,
        };
    }

    /**
     * Detect context gaps for a query — regions that are relevant but not in context.
     *
     * @param {string} query - User's query or task description
     * @param {Object} dnaCompiler - ContextDNACompiler instance
     * @returns {{ gaps: Object[], suggestions: string[] }}
     */
    detectGaps(query, dnaCompiler) {
        const relevantRegions = dnaCompiler.findRelevantRegions(query, { maxResults: 15 });
        const gaps = [];
        const suggestions = [];

        for (const region of relevantRegions) {
            const coverage = this.getRegionCoverage(region.regionId);
            if (coverage.status === CONFIDENCE_LEVELS.UNGROUNDED) {
                gaps.push({
                    regionId: region.regionId,
                    filePath: region.filePath,
                    purpose: region.purpose,
                    relevanceScore: region.score,
                    currentLevel: null,
                    recommendedLevel: region.score >= 2 ? 'L1' : 'L2',
                });
                suggestions.push(`Missing context: ${region.filePath} (${region.purpose}) — recommend loading at ${region.score >= 2 ? 'L1' : 'L2'}`);
            } else if (coverage.status === CONFIDENCE_LEVELS.OVERVIEW && region.score >= 2) {
                gaps.push({
                    regionId: region.regionId,
                    filePath: region.filePath,
                    purpose: region.purpose,
                    relevanceScore: region.score,
                    currentLevel: coverage.level,
                    recommendedLevel: 'L1',
                });
                suggestions.push(`Low-resolution coverage: ${region.filePath} is at ${coverage.level}, recommend upgrading to L1`);
            }
        }

        return { gaps, suggestions, totalRelevant: relevantRegions.length, coveredCount: relevantRegions.length - gaps.length };
    }

    /**
     * Generate a heatmap JSON suitable for visualization.
     *
     * @param {Object} dnaCompiler - For complete region list
     * @returns {Object[]} Array of { regionId, filePath, purpose, level, confidence, status }
     */
    toHeatmap(dnaCompiler = null) {
        const allRegions = dnaCompiler ? dnaCompiler.getAllL2Cards() : [];
        const heatmap = [];

        if (allRegions.length > 0) {
            for (const card of allRegions) {
                const coverage = this.getRegionCoverage(card.regionId);
                heatmap.push({
                    regionId: card.regionId,
                    filePath: card.filePath,
                    purpose: card.purpose || 'Unknown',
                    type: card.type,
                    level: coverage.level,
                    confidence: coverage.confidence,
                    status: coverage.status || CONFIDENCE_LEVELS.UNGROUNDED,
                });
            }
        } else {
            for (const [regionId, region] of this._regions) {
                heatmap.push({
                    regionId,
                    filePath: region.filePath,
                    purpose: region.purpose || 'Unknown',
                    level: region.level,
                    confidence: region.confidence,
                    status: this._confidenceToStatus(region.confidence),
                });
            }
        }

        return heatmap.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get coverage summary as a human-readable string for LLM injection.
     *
     * @param {Object} [dnaCompiler]
     * @returns {string}
     */
    renderCoverageSummary(dnaCompiler = null) {
        const stats = this.getGlobalCoverage(dnaCompiler);
        const lines = [
            `CONTEXT COVERAGE: ${stats.coveragePercent} (${stats.coveredRegions}/${stats.totalRegions} modules)`,
            `  L0 (full source): ${stats.byLevel.L0 || 0} modules`,
            `  L1 (skeleton):    ${stats.byLevel.L1 || 0} modules`,
            `  L2 (card):        ${stats.byLevel.L2 || 0} modules`,
            `  L3 (overview):    ${stats.byLevel.L3 || 0} modules`,
            `  Avg confidence:   ${stats.averageConfidence}`,
        ];

        if (stats.gapsDetected > 0) {
            lines.push(`  ⚠ ${stats.gapsDetected} context gaps detected`);
        }

        return lines.join('\n');
    }

    // ─── Audit Trail ────────────────────────────────────────────────

    /**
     * Get the injection log for audit/debugging.
     * @returns {Object[]}
     */
    getInjectionLog() {
        return [...this._injectionLog];
    }

    /**
     * Get all detected gaps.
     * @returns {Object[]}
     */
    getGaps() {
        return [...this._gaps];
    }

    // ─── Serialization ──────────────────────────────────────────────

    toJSON() {
        return {
            regions: Object.fromEntries(this._regions),
            gaps: this._gaps,
            injectionLog: this._injectionLog,
            createdAt: this._createdAt,
        };
    }

    static fromJSON(data) {
        const map = new CoverageMap();
        if (data.regions) {
            map._regions = new Map(Object.entries(data.regions));
        }
        map._gaps = data.gaps || [];
        map._injectionLog = data.injectionLog || [];
        map._createdAt = data.createdAt || new Date().toISOString();
        return map;
    }

    // ─── Internals ──────────────────────────────────────────────────

    _confidenceToStatus(confidence) {
        if (confidence >= 0.9) return CONFIDENCE_LEVELS.VERIFIED;
        if (confidence >= 0.65) return CONFIDENCE_LEVELS.STRONG;
        if (confidence >= 0.35) return CONFIDENCE_LEVELS.INFERRED;
        if (confidence >= 0.15) return CONFIDENCE_LEVELS.OVERVIEW;
        return CONFIDENCE_LEVELS.UNGROUNDED;
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORER — Per-Assertion Provenance Verification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scores the confidence of assertions in LLM output by tracing them back
 * to source context regions.
 *
 * Confidence tiers:
 *   VERIFIED  (≥0.8) — Assertion directly backed by L0/L1 source in context
 *   INFERRED  (0.4–0.8) — Assertion derived from L2 module card
 *   UNGROUNDED (<0.4) — No backing source found — potential hallucination
 */
class ConfidenceScorer {
    /**
     * @param {CoverageMap} coverageMap
     * @param {Object} dnaCompiler - ContextDNACompiler instance
     */
    constructor(coverageMap, dnaCompiler) {
        this.coverageMap = coverageMap;
        this.dnaCompiler = dnaCompiler;
    }

    /**
     * Score a single assertion against available context.
     *
     * @param {string} assertion - The factual claim to verify
     * @param {Object} [options]
     * @returns {{ confidence: number, status: string, sources: Object[], gaps: string[] }}
     */
    scoreAssertion(assertion, options = {}) {
        const terms = assertion.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        if (terms.length === 0) return { confidence: 0, status: CONFIDENCE_LEVELS.UNGROUNDED, sources: [], gaps: [] };

        const matchedRegions = this.dnaCompiler.findRelevantRegions(assertion, { maxResults: 5 });
        const sources = [];
        const gaps = [];
        let bestConfidence = 0;

        for (const region of matchedRegions) {
            const coverage = this.coverageMap.getRegionCoverage(region.regionId);

            if (coverage.status === CONFIDENCE_LEVELS.UNGROUNDED) {
                gaps.push(`${region.filePath} (${region.purpose}) — not in context`);
            } else {
                const regionConfidence = coverage.confidence * (region.score / Math.max(...matchedRegions.map(r => r.score)));
                sources.push({
                    regionId: region.regionId,
                    filePath: region.filePath,
                    purpose: region.purpose,
                    level: coverage.level,
                    confidence: parseFloat(regionConfidence.toFixed(3)),
                });
                bestConfidence = Math.max(bestConfidence, regionConfidence);
            }
        }

        return {
            confidence: parseFloat(bestConfidence.toFixed(3)),
            status: bestConfidence >= 0.8 ? CONFIDENCE_LEVELS.VERIFIED
                : bestConfidence >= 0.4 ? CONFIDENCE_LEVELS.INFERRED
                    : CONFIDENCE_LEVELS.UNGROUNDED,
            sources,
            gaps,
        };
    }

    /**
     * Score multiple assertions from LLM output.
     *
     * @param {string[]} assertions - Array of factual claims
     * @returns {{ results: Object[], summary: Object }}
     */
    scoreAssertions(assertions) {
        const results = assertions.map(a => ({
            assertion: a,
            ...this.scoreAssertion(a),
        }));

        const verified = results.filter(r => r.status === CONFIDENCE_LEVELS.VERIFIED).length;
        const inferred = results.filter(r => r.status === CONFIDENCE_LEVELS.INFERRED).length;
        const ungrounded = results.filter(r => r.status === CONFIDENCE_LEVELS.UNGROUNDED).length;
        const total = results.length;

        return {
            results,
            summary: {
                total,
                verified,
                inferred,
                ungrounded,
                verifiedPercent: total > 0 ? ((verified / total) * 100).toFixed(1) + '%' : '0%',
                ungroundedPercent: total > 0 ? ((ungrounded / total) * 100).toFixed(1) + '%' : '0%',
                overallConfidence: total > 0
                    ? parseFloat((results.reduce((s, r) => s + r.confidence, 0) / total).toFixed(3))
                    : 0,
                riskLevel: ungrounded / total > 0.4 ? 'HIGH'
                    : ungrounded / total > 0.2 ? 'MEDIUM' : 'LOW',
            },
        };
    }

    /**
     * Quick check: Is there sufficient context coverage for a task?
     *
     * @param {string} taskDescription
     * @returns {{ sufficient: boolean, coverage: string, recommendation: string }}
     */
    checkSufficiency(taskDescription) {
        const gapAnalysis = this.coverageMap.detectGaps(taskDescription, this.dnaCompiler);
        const coverageStats = this.coverageMap.getGlobalCoverage(this.dnaCompiler);

        const gapRatio = gapAnalysis.gaps.length / Math.max(gapAnalysis.totalRelevant, 1);
        const sufficient = gapRatio < 0.3 && parseFloat(coverageStats.averageConfidence) >= 0.4;

        return {
            sufficient,
            coverage: coverageStats.coveragePercent,
            relevantRegions: gapAnalysis.totalRelevant,
            coveredRegions: gapAnalysis.coveredCount,
            gaps: gapAnalysis.gaps.length,
            recommendation: sufficient
                ? 'Context coverage is sufficient for this task.'
                : gapAnalysis.gaps.length > 0
                    ? `Insufficient coverage: ${gapAnalysis.gaps.length} relevant modules missing. ${gapAnalysis.suggestions.slice(0, 3).join('; ')}`
                    : 'Low confidence — consider loading higher-resolution context for key modules.',
        };
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    CoverageMap,
    ConfidenceScorer,
    CONFIDENCE_LEVELS,
    RESOLUTION_SCORES,
};
