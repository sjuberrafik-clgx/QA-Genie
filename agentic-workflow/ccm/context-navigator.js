/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTEXT NAVIGATOR — Dynamic Resolution Allocation Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replaces static budget percentages with intelligent, demand-driven allocation.
 * Instead of "frameworkInventory always gets 15%", the Navigator says:
 *   "The Coder agent writing auth tests needs POmanager at L1,
 *    popupHandler at L0, testData at L2, config at L3 — here's the
 *    optimal resolution mix that fits in 120K chars."
 *
 * Key capabilities:
 *   ✦ Predict needed regions from task description + agent role
 *   ✦ Allocate resolution levels per-region to fit token budget
 *   ✦ Apply focus decay — recently used regions stay at high resolution
 *   ✦ Budget-optimal knapsack solver — maximize information per char
 *   ✦ Backward compatible — wraps ContextEngine.packContext()
 *
 * Zero LLM cost — 100% deterministic JavaScript.
 *
 * @module ccm/context-navigator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { RESOLUTION_SCORES } = require('./coverage-map');

// ─── Agent → Topic Relevance Profiles ───────────────────────────────────────

const AGENT_PROFILES = {
    // What each agent typically needs high resolution on
    'cognitive-analyst': {
        highPriority: ['ticket', 'grounding', 'feature-map', 'domain-terms'],
        mediumPriority: ['test-data', 'config'],
        lowPriority: ['page-objects', 'business-functions', 'utils'],
    },
    'cognitive-explorer-nav': {
        highPriority: ['page-objects', 'popup-handler', 'config', 'test-data'],
        mediumPriority: ['business-functions', 'utils'],
        lowPriority: ['grounding', 'assertion-config'],
    },
    'cognitive-explorer-interact': {
        highPriority: ['page-objects', 'popup-handler', 'business-functions'],
        mediumPriority: ['test-data', 'config'],
        lowPriority: ['grounding', 'utils'],
    },
    'cognitive-coder': {
        highPriority: ['page-objects', 'business-functions', 'popup-handler', 'test-data', 'config'],
        mediumPriority: ['assertion-config', 'utils', 'grounding'],
        lowPriority: ['domain-terms'],
    },
    'cognitive-reviewer': {
        highPriority: ['assertion-config', 'page-objects', 'business-functions'],
        mediumPriority: ['config', 'popup-handler', 'utils'],
        lowPriority: ['test-data', 'grounding'],
    },
    'cognitive-dryrun': {
        highPriority: ['page-objects', 'popup-handler', 'config', 'test-data'],
        mediumPriority: ['business-functions'],
        lowPriority: ['utils', 'grounding'],
    },
    // Non-cognitive agents
    scriptgenerator: {
        highPriority: ['page-objects', 'business-functions', 'popup-handler', 'test-data', 'config'],
        mediumPriority: ['assertion-config', 'utils', 'grounding'],
        lowPriority: ['domain-terms'],
    },
    testgenie: {
        highPriority: ['grounding', 'domain-terms', 'feature-map'],
        mediumPriority: ['test-data', 'config'],
        lowPriority: ['page-objects', 'business-functions'],
    },
    buggenie: {
        highPriority: ['grounding', 'shared-context'],
        mediumPriority: ['test-data'],
        lowPriority: ['page-objects'],
    },
};

// ─── Focus Tracker ──────────────────────────────────────────────────────────

class FocusTracker {
    /**
     * Tracks which regions are currently "in focus" with exponential decay.
     * Regions the agent recently accessed stay at higher resolution;
     * regions not accessed decay toward L3/eviction.
     *
     * @param {Object} [options]
     * @param {number} [options.halfLifeMs=120000] - Half-life of focus in ms (2 min default)
     * @param {number} [options.boostOnAccess=1.0] - Focus boost per access
     * @param {number} [options.maxFocus=3.0] - Maximum focus score
     */
    constructor(options = {}) {
        this.halfLifeMs = options.halfLifeMs || 120_000;
        this.boostOnAccess = options.boostOnAccess || 1.0;
        this.maxFocus = options.maxFocus || 3.0;
        // regionId → { focus: number, lastAccessedMs: number }
        this._focuses = new Map();
    }

    /**
     * Record that a region was accessed/used.
     * @param {string} regionId
     */
    recordAccess(regionId) {
        const now = Date.now();
        const existing = this._focuses.get(regionId);
        if (existing) {
            const decayed = this._decay(existing.focus, now - existing.lastAccessedMs);
            existing.focus = Math.min(this.maxFocus, decayed + this.boostOnAccess);
            existing.lastAccessedMs = now;
        } else {
            this._focuses.set(regionId, {
                focus: this.boostOnAccess,
                lastAccessedMs: now,
            });
        }
    }

    /**
     * Get current focus score for a region (applies decay).
     * @param {string} regionId
     * @returns {number} Focus score (0 = fully decayed, maxFocus = fully focused)
     */
    getFocus(regionId) {
        const entry = this._focuses.get(regionId);
        if (!entry) return 0;
        return this._decay(entry.focus, Date.now() - entry.lastAccessedMs);
    }

    /**
     * Get all active focus entries (above threshold).
     * @param {number} [minFocus=0.1]
     * @returns {Object[]} Array of { regionId, focus }
     */
    getActiveFocuses(minFocus = 0.1) {
        const now = Date.now();
        const active = [];
        for (const [regionId, entry] of this._focuses) {
            const currentFocus = this._decay(entry.focus, now - entry.lastAccessedMs);
            if (currentFocus >= minFocus) {
                active.push({ regionId, focus: parseFloat(currentFocus.toFixed(3)) });
            }
        }
        return active.sort((a, b) => b.focus - a.focus);
    }

    /**
     * Get recommended resolution level based on focus score.
     * @param {string} regionId
     * @returns {string} 'L0' | 'L1' | 'L2' | 'L3'
     */
    getRecommendedLevel(regionId) {
        const focus = this.getFocus(regionId);
        if (focus >= 2.0) return 'L0';
        if (focus >= 1.0) return 'L1';
        if (focus >= 0.3) return 'L2';
        return 'L3';
    }

    /** Clean up fully decayed entries */
    prune() {
        const now = Date.now();
        for (const [regionId, entry] of this._focuses) {
            if (this._decay(entry.focus, now - entry.lastAccessedMs) < 0.01) {
                this._focuses.delete(regionId);
            }
        }
    }

    // Exponential decay: f(t) = f0 * 0.5^(dt/halfLife)
    _decay(focus, elapsedMs) {
        return focus * Math.pow(0.5, elapsedMs / this.halfLifeMs);
    }
}


// ─── Context Navigator ──────────────────────────────────────────────────────

class ContextNavigator {
    /**
     * @param {Object} dnaCompiler - ContextDNACompiler instance
     * @param {Object} [options]
     * @param {number} [options.maxContextChars=120000] - Total context budget
     * @param {number} [options.reservedChars=42000] - Reserved for basePrompt + ticket (35%)
     * @param {Object} [options.focusTrackerOptions] - FocusTracker constructor options
     */
    constructor(dnaCompiler, options = {}) {
        this.dnaCompiler = dnaCompiler;
        this.maxContextChars = options.maxContextChars || 120_000;
        this.reservedChars = options.reservedChars || 42_000;
        this.focusTracker = new FocusTracker(options.focusTrackerOptions || {});
    }

    /**
     * Predict which regions an agent needs and at what resolution,
     * then solve the knapsack to maximize information within budget.
     *
     * @param {string} agentName - Agent role identifier
     * @param {string} taskDescription - What the agent needs to do
     * @param {Object} [options]
     * @param {string[]} [options.explicitRegions] - Force-include these region IDs
     * @param {Object} [options.sharedContextHints] - From SharedContextStore
     * @returns {NavigationPlan}
     */
    planNavigation(agentName, taskDescription, options = {}) {
        const availableBudget = this.maxContextChars - this.reservedChars;
        const profile = AGENT_PROFILES[agentName] || AGENT_PROFILES.scriptgenerator;

        // Step 1: Gather candidate regions
        const candidates = this._gatherCandidates(agentName, taskDescription, profile, options);

        // Step 2: Score each candidate
        const scored = this._scoreCandidates(candidates, profile, taskDescription);

        // Step 3: Solve knapsack — maximize information per char within budget
        const allocation = this._solveKnapsack(scored, availableBudget);

        // Step 4: Update focus tracker
        for (const item of allocation) {
            this.focusTracker.recordAccess(item.regionId);
        }

        return {
            agentName,
            taskDescription,
            availableBudget,
            allocation,
            totalChars: allocation.reduce((s, a) => s + a.estimatedChars, 0),
            budgetUtilization: ((allocation.reduce((s, a) => s + a.estimatedChars, 0) / availableBudget) * 100).toFixed(1) + '%',
            regionCount: allocation.length,
            levelDistribution: this._countLevels(allocation),
        };
    }

    /**
     * Execute a navigation plan — render context from DNA at planned resolution levels.
     *
     * @param {Object} plan - NavigationPlan from planNavigation()
     * @returns {{ contextString: string, renderedRegions: Object[] }}
     */
    executePlan(plan) {
        const sections = [];
        const renderedRegions = [];

        for (const item of plan.allocation) {
            const rendered = this.dnaCompiler.decompress(item.regionId, item.level);
            if (rendered) {
                sections.push(`\n--- ${item.filePath} [${item.level}] ---\n${rendered}`);
                renderedRegions.push({
                    regionId: item.regionId,
                    level: item.level,
                    chars: rendered.length,
                    filePath: item.filePath,
                });
            }
        }

        return {
            contextString: sections.join('\n'),
            renderedRegions,
            totalChars: sections.reduce((s, sec) => s + sec.length, 0),
        };
    }

    /**
     * Smart re-navigate: Given what the agent has already seen + new task,
     * determine what to upgrade, downgrade, or keep.
     *
     * @param {Object} currentPlan - Previous NavigationPlan
     * @param {string} newTaskDescription
     * @param {Object} coverageMap - CoverageMap instance
     * @returns {{ upgrades: Object[], downgrades: Object[], keeps: Object[], newRegions: Object[] }}
     */
    reNavigate(currentPlan, newTaskDescription, coverageMap) {
        const newPlan = this.planNavigation(currentPlan.agentName, newTaskDescription);

        const currentMap = new Map(currentPlan.allocation.map(a => [a.regionId, a]));
        const newMap = new Map(newPlan.allocation.map(a => [a.regionId, a]));

        const upgrades = [];
        const downgrades = [];
        const keeps = [];
        const newRegions = [];

        for (const [regionId, newAlloc] of newMap) {
            const current = currentMap.get(regionId);
            if (!current) {
                newRegions.push(newAlloc);
            } else {
                const currentScore = RESOLUTION_SCORES[current.level] || 0;
                const newScore = RESOLUTION_SCORES[newAlloc.level] || 0;
                if (newScore > currentScore) {
                    upgrades.push({ ...newAlloc, previousLevel: current.level });
                } else if (newScore < currentScore) {
                    downgrades.push({ ...newAlloc, previousLevel: current.level });
                } else {
                    keeps.push(newAlloc);
                }
            }
        }

        return { upgrades, downgrades, keeps, newRegions, plan: newPlan };
    }

    // ─── Internal: Candidate Gathering ──────────────────────────────

    _gatherCandidates(agentName, taskDescription, profile, options) {
        const candidates = new Map();

        // 1. From DNA compiler — task-relevant regions
        const taskRelevant = this.dnaCompiler.findRelevantRegions(taskDescription, { maxResults: 20 });
        for (const region of taskRelevant) {
            candidates.set(region.regionId, {
                regionId: region.regionId,
                filePath: region.filePath,
                purpose: region.purpose,
                type: region.type,
                relevanceScore: region.score,
                source: 'task-query',
            });
        }

        // 2. From agent profile — role-based typically-needed regions
        const allL2 = this.dnaCompiler.getAllL2Cards ? this.dnaCompiler.getAllL2Cards() : [];
        for (const card of allL2) {
            if (candidates.has(card.regionId)) continue;

            const profilePriority = this._matchProfile(card, profile);
            if (profilePriority > 0) {
                candidates.set(card.regionId, {
                    regionId: card.regionId,
                    filePath: card.filePath,
                    purpose: card.purpose,
                    type: card.type,
                    relevanceScore: profilePriority,
                    source: 'agent-profile',
                });
            }
        }

        // 3. From explicit regions (force-include)
        for (const regionId of (options.explicitRegions || [])) {
            if (!candidates.has(regionId)) {
                const l2 = this.dnaCompiler.getL2 ? this.dnaCompiler.getL2(regionId) : null;
                if (l2) {
                    candidates.set(regionId, {
                        regionId,
                        filePath: l2.filePath || regionId,
                        purpose: l2.purpose || 'Explicitly requested',
                        type: l2.type || 'unknown',
                        relevanceScore: 3.0, // High priority for explicit requests
                        source: 'explicit',
                    });
                }
            }
        }

        // 4. From focus tracker — recently-accessed regions
        const focused = this.focusTracker.getActiveFocuses(0.3);
        for (const { regionId, focus } of focused) {
            const existing = candidates.get(regionId);
            if (existing) {
                existing.focusBoost = focus;
            } else {
                const l2 = this.dnaCompiler.getL2 ? this.dnaCompiler.getL2(regionId) : null;
                if (l2) {
                    candidates.set(regionId, {
                        regionId,
                        filePath: l2.filePath || regionId,
                        purpose: l2.purpose || 'Previously accessed',
                        type: l2.type || 'unknown',
                        relevanceScore: focus * 0.5,
                        focusBoost: focus,
                        source: 'focus-decay',
                    });
                }
            }
        }

        return [...candidates.values()];
    }

    _matchProfile(card, profile) {
        const filePath = (card.filePath || '').toLowerCase();
        const purpose = (card.purpose || '').toLowerCase();
        const combined = filePath + ' ' + purpose;

        // Check high priority keywords
        for (const keyword of profile.highPriority) {
            if (combined.includes(keyword.replace('-', ''))) return 2.5;
        }
        for (const keyword of profile.mediumPriority) {
            if (combined.includes(keyword.replace('-', ''))) return 1.5;
        }
        for (const keyword of profile.lowPriority) {
            if (combined.includes(keyword.replace('-', ''))) return 0.5;
        }
        return 0;
    }

    // ─── Internal: Candidate Scoring ────────────────────────────────

    _scoreCandidates(candidates, profile, taskDescription) {
        return candidates.map(candidate => {
            // Base score from relevance
            let score = candidate.relevanceScore || 0;

            // Focus boost (recently accessed → higher resolution)
            if (candidate.focusBoost) {
                score += candidate.focusBoost * 0.5;
            }

            // Agent profile alignment
            const profileMatch = this._matchProfile(candidate, profile);
            score += profileMatch * 0.3;

            // Determine ideal resolution level based on total score
            let idealLevel;
            if (score >= 3.0) idealLevel = 'L0';
            else if (score >= 2.0) idealLevel = 'L1';
            else if (score >= 1.0) idealLevel = 'L2';
            else idealLevel = 'L3';

            // Estimate char cost at ideal level
            const estimatedChars = this._estimateChars(candidate, idealLevel);

            return {
                ...candidate,
                totalScore: parseFloat(score.toFixed(3)),
                level: idealLevel,
                estimatedChars,
                informationDensity: score / Math.max(estimatedChars, 1) * 1000,
            };
        }).sort((a, b) => b.totalScore - a.totalScore);
    }

    _estimateChars(candidate, level) {
        // Without knowing exact L0 size, estimate from L2 card metadata
        const baseEstimate = candidate.type === 'page-object' ? 5000
            : candidate.type === 'business-function' ? 3000
                : candidate.type === 'utility' ? 2000
                    : candidate.type === 'config' ? 1500
                        : 3000;

        switch (level) {
            case 'L0': return baseEstimate;
            case 'L1': return Math.floor(baseEstimate * 0.15);
            case 'L2': return Math.floor(baseEstimate * 0.03);
            case 'L3': return 200; // L3 cards are tiny
            default: return baseEstimate;
        }
    }

    // ─── Internal: Knapsack Solver ──────────────────────────────────

    /**
     * Greedy knapsack with resolution downgrade fallback.
     * Maximizes total information score within character budget.
     */
    _solveKnapsack(scored, budget) {
        const allocated = [];
        let remaining = budget;

        for (const candidate of scored) {
            if (remaining <= 0) break;

            // Try ideal level first
            if (candidate.estimatedChars <= remaining) {
                allocated.push({
                    regionId: candidate.regionId,
                    filePath: candidate.filePath,
                    purpose: candidate.purpose,
                    level: candidate.level,
                    estimatedChars: candidate.estimatedChars,
                    score: candidate.totalScore,
                });
                remaining -= candidate.estimatedChars;
                continue;
            }

            // If ideal level doesn't fit, try downgrading
            const downgradeLevels = this._getDowngradeLevels(candidate.level);
            for (const fallbackLevel of downgradeLevels) {
                const fallbackChars = this._estimateChars(candidate, fallbackLevel);
                if (fallbackChars <= remaining) {
                    allocated.push({
                        regionId: candidate.regionId,
                        filePath: candidate.filePath,
                        purpose: candidate.purpose,
                        level: fallbackLevel,
                        estimatedChars: fallbackChars,
                        score: candidate.totalScore * (RESOLUTION_SCORES[fallbackLevel] / RESOLUTION_SCORES[candidate.level]),
                    });
                    remaining -= fallbackChars;
                    break;
                }
            }
            // If none fit, skip this candidate entirely
        }

        return allocated;
    }

    _getDowngradeLevels(currentLevel) {
        const order = ['L0', 'L1', 'L2', 'L3'];
        const idx = order.indexOf(currentLevel);
        return order.slice(idx + 1);
    }

    _countLevels(allocation) {
        const counts = { L0: 0, L1: 0, L2: 0, L3: 0 };
        for (const item of allocation) {
            counts[item.level] = (counts[item.level] || 0) + 1;
        }
        return counts;
    }
}


// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    ContextNavigator,
    FocusTracker,
    AGENT_PROFILES,
};
