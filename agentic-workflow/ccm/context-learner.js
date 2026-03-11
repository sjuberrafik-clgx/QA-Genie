/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTEXT LEARNER — Cross-Run Intelligence for Context Optimization
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Learns from every pipeline run to optimize future context allocation.
 * Works WITH the existing LearningStore (failures, selectorMappings, pagePatterns)
 * and adds CCM-specific learning:
 *
 *   ✦ Navigation patterns — Which regions each agent actually used
 *   ✦ Resolution sufficiency — Did L2 work or did the agent need L1?
 *   ✦ Hallucination hotspots — Which file types/regions cause ungrounded assertions
 *   ✦ Compression effectiveness — What gets lost vs preserved in compression
 *   ✦ Cross-phase dependency — What Explorer discovers that Coder needs
 *
 * Storage: agentic-workflow/ccm-data/context-learning.json
 * Zero LLM cost — 100% deterministic JavaScript.
 *
 * @module ccm/context-learner
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────────────────────

const LEARNING_FILE = path.join(__dirname, '..', 'ccm-data', 'context-learning.json');

const EMPTY_LEARNING = {
    version: '1.0.0',
    lastUpdated: null,
    // Which regions each agent phase accessed (aggregated across runs)
    navigationPatterns: {},  // agentName → { regionId → { accessCount, avgLevel, wasUseful } }
    // Did the allocated resolution level suffice?
    resolutionOutcomes: [],  // { regionId, agentName, allocatedLevel, neededLevel, taskType, timestamp }
    // Regions where assertions were ungrounded
    hallucinationHotspots: {},  // regionId → { count, lastTypes: [], lastTimestamp }
    // Cross-phase dependencies: what one phase produced that another consumed
    phaseDependencies: [],  // { producerPhase, consumerPhase, regionId, dataType, importance }
    // Per-run metrics for trend analysis
    runMetrics: [],  // { runId, timestamp, coveragePercent, verifiedPercent, ungroundedPercent, budgetUtilization }
};

const MAX_RESOLUTION_OUTCOMES = 500;
const MAX_PHASE_DEPENDENCIES = 200;
const MAX_RUN_METRICS = 100;

// ─── Context Learner ────────────────────────────────────────────────────────

class ContextLearner {
    constructor() {
        this._data = this._load();
    }

    // ─── Recording Methods ──────────────────────────────────────────

    /**
     * Record which regions an agent accessed during a run.
     *
     * @param {string} agentName - e.g., 'cognitive-coder'
     * @param {Object[]} accessedRegions - { regionId, level, filePath }
     */
    recordNavigationPattern(agentName, accessedRegions) {
        if (!this._data.navigationPatterns[agentName]) {
            this._data.navigationPatterns[agentName] = {};
        }
        const agentPatterns = this._data.navigationPatterns[agentName];

        for (const region of accessedRegions) {
            if (!agentPatterns[region.regionId]) {
                agentPatterns[region.regionId] = {
                    accessCount: 0,
                    levels: {},
                    filePath: region.filePath,
                };
            }
            const entry = agentPatterns[region.regionId];
            entry.accessCount++;
            entry.levels[region.level] = (entry.levels[region.level] || 0) + 1;
            entry.lastAccessed = new Date().toISOString();
        }

        this._save();
    }

    /**
     * Record whether an allocated resolution level was sufficient.
     *
     * @param {string} regionId
     * @param {string} agentName
     * @param {string} allocatedLevel - What we gave: 'L0', 'L1', 'L2', 'L3'
     * @param {string} neededLevel - What was actually needed (null if sufficient)
     * @param {string} taskType - e.g., 'selector-extraction', 'method-call', 'navigation'
     */
    recordResolutionOutcome(regionId, agentName, allocatedLevel, neededLevel, taskType) {
        this._data.resolutionOutcomes.push({
            regionId,
            agentName,
            allocatedLevel,
            neededLevel: neededLevel || allocatedLevel,
            sufficient: !neededLevel || neededLevel === allocatedLevel,
            taskType,
            timestamp: new Date().toISOString(),
        });

        // Trim to max
        if (this._data.resolutionOutcomes.length > MAX_RESOLUTION_OUTCOMES) {
            this._data.resolutionOutcomes = this._data.resolutionOutcomes.slice(-MAX_RESOLUTION_OUTCOMES);
        }

        this._save();
    }

    /**
     * Record a hallucination incident — an ungrounded assertion linked to a region.
     *
     * @param {string} regionId - Region where the hallucination occurred (or 'unknown')
     * @param {string} assertionType - From ASSERTION_TYPES
     * @param {string} assertionValue - The hallucinated value
     */
    recordHallucination(regionId, assertionType, assertionValue) {
        const key = regionId || 'unknown';
        if (!this._data.hallucinationHotspots[key]) {
            this._data.hallucinationHotspots[key] = { count: 0, types: {}, samples: [] };
        }
        const hotspot = this._data.hallucinationHotspots[key];
        hotspot.count++;
        hotspot.types[assertionType] = (hotspot.types[assertionType] || 0) + 1;
        hotspot.lastTimestamp = new Date().toISOString();

        // Keep last 5 samples per hotspot
        hotspot.samples.push(assertionValue);
        if (hotspot.samples.length > 5) hotspot.samples.shift();

        this._save();
    }

    /**
     * Record a cross-phase dependency — information flow between cognitive phases.
     *
     * @param {string} producerPhase - e.g., 'cognitive-explorer-nav'
     * @param {string} consumerPhase - e.g., 'cognitive-coder'
     * @param {string} regionId - The region holding the data
     * @param {string} dataType - e.g., 'verified_selectors', 'page_transition_graph'
     * @param {number} importance - 0-1 how critical this dependency is
     */
    recordPhaseDependency(producerPhase, consumerPhase, regionId, dataType, importance = 0.5) {
        // Check for duplicate
        const existing = this._data.phaseDependencies.find(d =>
            d.producerPhase === producerPhase &&
            d.consumerPhase === consumerPhase &&
            d.regionId === regionId &&
            d.dataType === dataType
        );

        if (existing) {
            existing.importance = Math.max(existing.importance, importance);
            existing.occurrences = (existing.occurrences || 1) + 1;
            existing.lastSeen = new Date().toISOString();
        } else {
            this._data.phaseDependencies.push({
                producerPhase,
                consumerPhase,
                regionId,
                dataType,
                importance,
                occurrences: 1,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            });
        }

        if (this._data.phaseDependencies.length > MAX_PHASE_DEPENDENCIES) {
            // Keep highest importance
            this._data.phaseDependencies.sort((a, b) => b.importance - a.importance);
            this._data.phaseDependencies = this._data.phaseDependencies.slice(0, MAX_PHASE_DEPENDENCIES);
        }

        this._save();
    }

    /**
     * Record overall run metrics for trend analysis.
     *
     * @param {Object} metrics
     */
    recordRunMetrics(metrics) {
        this._data.runMetrics.push({
            runId: metrics.runId || `run-${Date.now()}`,
            timestamp: new Date().toISOString(),
            coveragePercent: metrics.coveragePercent,
            verifiedPercent: metrics.verifiedPercent,
            ungroundedPercent: metrics.ungroundedPercent,
            budgetUtilization: metrics.budgetUtilization,
            regionCount: metrics.regionCount,
            agentName: metrics.agentName,
        });

        if (this._data.runMetrics.length > MAX_RUN_METRICS) {
            this._data.runMetrics = this._data.runMetrics.slice(-MAX_RUN_METRICS);
        }

        this._save();
    }

    // ─── Query Methods ──────────────────────────────────────────────

    /**
     * Recommend resolution levels for an agent based on historical patterns.
     *
     * @param {string} agentName
     * @returns {Object} regionId → recommendedLevel
     */
    getNavigationRecommendations(agentName) {
        const patterns = this._data.navigationPatterns[agentName];
        if (!patterns) return {};

        const recommendations = {};
        for (const [regionId, data] of Object.entries(patterns)) {
            // Find most commonly needed level
            const levelCounts = data.levels || {};
            let bestLevel = 'L2';
            let maxCount = 0;
            for (const [level, count] of Object.entries(levelCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    bestLevel = level;
                }
            }

            // Check resolution outcomes — was this level sufficient?
            const outcomes = this._data.resolutionOutcomes.filter(
                o => o.regionId === regionId && o.agentName === agentName
            );
            const insufficientCount = outcomes.filter(o => !o.sufficient).length;
            if (insufficientCount > outcomes.length * 0.3 && outcomes.length >= 2) {
                // Upgrade recommendation if frequently insufficient
                bestLevel = this._upgradeLevel(bestLevel);
            }

            recommendations[regionId] = {
                level: bestLevel,
                confidence: Math.min(1, data.accessCount / 5), // More data = higher confidence
                accessCount: data.accessCount,
                filePath: data.filePath,
            };
        }

        return recommendations;
    }

    /**
     * Get hallucination hotspots sorted by frequency.
     *
     * @param {number} [limit=10]
     * @returns {Object[]} Sorted hotspots
     */
    getHallucinationHotspots(limit = 10) {
        return Object.entries(this._data.hallucinationHotspots)
            .map(([regionId, data]) => ({ regionId, ...data }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * Get critical cross-phase dependencies for a consumer phase.
     *
     * @param {string} consumerPhase
     * @returns {Object[]} Dependencies sorted by importance
     */
    getCriticalDependencies(consumerPhase) {
        return this._data.phaseDependencies
            .filter(d => d.consumerPhase === consumerPhase)
            .sort((a, b) => b.importance - a.importance);
    }

    /**
     * Get trend metrics across recent runs.
     *
     * @param {number} [lastN=10]
     * @returns {Object}
     */
    getTrends(lastN = 10) {
        const recent = this._data.runMetrics.slice(-lastN);
        if (recent.length < 2) return { trend: 'insufficient-data', runs: recent.length };

        const first = recent[0];
        const last = recent[recent.length - 1];

        return {
            trend: parseFloat(last.verifiedPercent || '0') > parseFloat(first.verifiedPercent || '0') ? 'improving' : 'declining',
            runs: recent.length,
            latestCoverage: last.coveragePercent,
            latestVerified: last.verifiedPercent,
            latestUngrounded: last.ungroundedPercent,
            metrics: recent,
        };
    }

    /**
     * Generate learning-aware context hints for the navigator.
     * Returns adjustments to the default navigation plan.
     *
     * @param {string} agentName
     * @param {string} taskDescription
     * @returns {Object} { upgrades: [], downgrades: [], warnings: [] }
     */
    getContextHints(agentName, taskDescription) {
        const hints = { upgrades: [], downgrades: [], warnings: [] };

        // 1. Upgrade hallucination-prone regions
        const hotspots = this.getHallucinationHotspots(5);
        for (const hotspot of hotspots) {
            if (hotspot.count >= 2) {
                hints.upgrades.push({
                    regionId: hotspot.regionId,
                    reason: `Hallucination hotspot (${hotspot.count} incidents)`,
                    targetLevel: 'L1',
                });
            }
        }

        // 2. Ensure critical phase dependencies are included
        const deps = this.getCriticalDependencies(agentName);
        for (const dep of deps.filter(d => d.importance >= 0.7)) {
            hints.upgrades.push({
                regionId: dep.regionId,
                reason: `Critical dependency from ${dep.producerPhase} (${dep.dataType})`,
                targetLevel: 'L1',
            });
        }

        // 3. Use navigation history to identify unused regions
        const navPatterns = this._data.navigationPatterns[agentName] || {};
        for (const [regionId, data] of Object.entries(navPatterns)) {
            if (data.accessCount <= 1) {
                hints.downgrades.push({
                    regionId,
                    reason: `Rarely accessed (${data.accessCount} times)`,
                    targetLevel: 'L3',
                });
            }
        }

        return hints;
    }

    // ─── Internal ───────────────────────────────────────────────────

    _upgradeLevel(level) {
        const order = ['L3', 'L2', 'L1', 'L0'];
        const idx = order.indexOf(level);
        return idx > 0 ? order[idx - 1] : level;
    }

    _load() {
        try {
            if (fs.existsSync(LEARNING_FILE)) {
                const raw = fs.readFileSync(LEARNING_FILE, 'utf-8');
                return JSON.parse(raw);
            }
        } catch {
            // Corrupted file — start fresh
        }
        return JSON.parse(JSON.stringify(EMPTY_LEARNING));
    }

    _save() {
        try {
            this._data.lastUpdated = new Date().toISOString();
            const dir = path.dirname(LEARNING_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(LEARNING_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
        } catch (err) {
            // Non-fatal — learning data loss is acceptable
        }
    }
}


// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { ContextLearner };
