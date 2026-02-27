/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHARED CONTEXT STORE — Blackboard Memory for Agent Collaboration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides a structured, typed shared memory that all agents can read/write via
 * custom tools. Replaces the fragile "pass file paths in prompts" pattern with
 * a queryable knowledge store that persists across session boundaries.
 *
 * Architecture:
 *   - One SharedContextStore per pipeline run (scoped by runId)
 *   - Agents write decisions, artifacts, constraints, and notes
 *   - Later agents query the store to understand WHY previous agents made choices
 *   - The store captures reasoning, not just outputs
 *
 * Entry Types:
 *   decision   — Agent made a choice (e.g., "used serial mode because...")
 *   artifact   — Agent produced a file/output (path + metadata)
 *   constraint — Agent discovered a limitation (e.g., "popup blocks interaction")
 *   question   — Agent is unsure about something and flags it
 *   answer     — Response to a question from another agent or the coordinator
 *   note       — General observation or context
 *
 * @module sdk-orchestrator/shared-context-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Entry Types ────────────────────────────────────────────────────────────

const ENTRY_TYPES = {
    DECISION: 'decision',
    ARTIFACT: 'artifact',
    CONSTRAINT: 'constraint',
    QUESTION: 'question',
    ANSWER: 'answer',
    NOTE: 'note',

    // ── Cognitive Loop Phase Handoff Types ───────────────────────────
    EXPLORATION_PLAN: 'exploration_plan',       // Analyst → Explorer
    VERIFIED_SELECTORS: 'verified_selectors',   // Explorer → Coder
    PAGE_TRANSITION_GRAPH: 'page_transition_graph', // Explorer → Coder/DryRun
    GENERATION_PROGRESS: 'generation_progress', // Coder incremental progress
    REVIEW_FEEDBACK: 'review_feedback',         // Reviewer → Coder (retry)
    DRYRUN_RESULTS: 'dryrun_results',           // DryRun → Coder (fix)
};

// ─── Shared Context Store ───────────────────────────────────────────────────

class SharedContextStore {
    /**
     * @param {string} runId - Pipeline run identifier
     * @param {Object} [options]
     * @param {boolean} [options.persist=true] - Save to disk
     * @param {string} [options.persistDir] - Directory for persistence files
     * @param {number} [options.maxEntries=500] - Max entries before eviction
     */
    constructor(runId, options = {}) {
        this.runId = runId;
        this.persist = options.persist !== false;
        this.persistDir = options.persistDir || path.join(__dirname, '..', 'test-artifacts', 'context-stores');
        this.maxEntries = options.maxEntries || 500;

        this._entries = [];
        this._artifacts = new Map();  // key → { path, metadata, agent }
        this._questions = new Map();  // questionId → { question, askedBy, answer, answeredBy }
        this._agentNotes = new Map(); // agent → [notes]
        this.createdAt = new Date().toISOString();

        // Load from disk if exists
        if (this.persist) this._loadFromDisk();
    }

    // ─── Write Operations ───────────────────────────────────────────

    /**
     * Record a decision made by an agent.
     *
     * @param {string} agent - Agent name (e.g., 'testgenie')
     * @param {string} decision - What was decided
     * @param {string} reasoning - Why this decision was made
     * @param {Object} [metadata] - Additional context
     * @returns {Object} The stored entry
     */
    recordDecision(agent, decision, reasoning, metadata = {}) {
        return this._addEntry({
            type: ENTRY_TYPES.DECISION,
            agent,
            content: decision,
            reasoning,
            metadata,
        });
    }

    /**
     * Register an artifact produced by an agent.
     *
     * @param {string} agent - Agent name
     * @param {string} key - Artifact identifier (e.g., 'testCases', 'specFile', 'exploration')
     * @param {string} artifactPath - File path
     * @param {Object} [metadata] - Type, size, summary, etc.
     * @returns {Object} The stored entry
     */
    registerArtifact(agent, key, artifactPath, metadata = {}) {
        this._artifacts.set(key, {
            path: artifactPath,
            agent,
            metadata,
            registeredAt: new Date().toISOString(),
        });

        return this._addEntry({
            type: ENTRY_TYPES.ARTIFACT,
            agent,
            content: `Artifact "${key}" created at ${artifactPath}`,
            metadata: { key, path: artifactPath, ...metadata },
        });
    }

    /**
     * Record a constraint discovered by an agent.
     *
     * @param {string} agent - Agent name
     * @param {string} constraint - What the constraint is
     * @param {string} [impact] - How it affects downstream agents
     * @returns {Object} The stored entry
     */
    recordConstraint(agent, constraint, impact = '') {
        return this._addEntry({
            type: ENTRY_TYPES.CONSTRAINT,
            agent,
            content: constraint,
            metadata: { impact },
        });
    }

    /**
     * Post a question for another agent or the coordinator.
     *
     * @param {string} askingAgent - Who's asking
     * @param {string} targetAgent - Who should answer ('coordinator' for the pipeline)
     * @param {string} question - The question text
     * @returns {string} Question ID for referencing the answer
     */
    postQuestion(askingAgent, targetAgent, question) {
        const qId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this._questions.set(qId, {
            question,
            askedBy: askingAgent,
            targetAgent,
            askedAt: new Date().toISOString(),
            answer: null,
            answeredBy: null,
            answeredAt: null,
        });

        this._addEntry({
            type: ENTRY_TYPES.QUESTION,
            agent: askingAgent,
            content: question,
            metadata: { questionId: qId, targetAgent },
        });

        return qId;
    }

    /**
     * Answer a pending question.
     *
     * @param {string} respondingAgent - Who's answering
     * @param {string} questionId - The question ID
     * @param {string} answer - The answer text
     */
    answerQuestion(respondingAgent, questionId, answer) {
        const q = this._questions.get(questionId);
        if (q) {
            q.answer = answer;
            q.answeredBy = respondingAgent;
            q.answeredAt = new Date().toISOString();
        }

        this._addEntry({
            type: ENTRY_TYPES.ANSWER,
            agent: respondingAgent,
            content: answer,
            metadata: { questionId, originalQuestion: q?.question || '' },
        });
    }

    /**
     * Add a general note/observation.
     *
     * @param {string} agent - Agent name
     * @param {string} note - The observation
     * @param {Object} [metadata]
     * @returns {Object} The stored entry
     */
    addNote(agent, note, metadata = {}) {
        // Track per-agent notes
        if (!this._agentNotes.has(agent)) {
            this._agentNotes.set(agent, []);
        }
        this._agentNotes.get(agent).push(note);

        return this._addEntry({
            type: ENTRY_TYPES.NOTE,
            agent,
            content: note,
            metadata,
        });
    }

    // ─── Cognitive Loop Phase Handoff Methods ───────────────────────

    /**
     * Store the exploration plan from the Analyst phase.
     * @param {Object} plan - Structured exploration plan
     * @param {number} [score] - Plan quality score (0–100)
     */
    storeExplorationPlan(plan, score = 0) {
        this._phaseData = this._phaseData || {};
        this._phaseData.explorationPlan = plan;

        return this._addEntry({
            type: ENTRY_TYPES.EXPLORATION_PLAN,
            agent: 'cognitive-analyst',
            content: `Exploration plan with ${plan?.testCaseMapping?.length || 0} mapped test steps`,
            metadata: { plan, score },
        });
    }

    /**
     * Retrieve the exploration plan for the Explorer phase.
     * @returns {Object|null}
     */
    getExplorationPlan() {
        if (this._phaseData?.explorationPlan) return this._phaseData.explorationPlan;
        const entries = this.query({ type: ENTRY_TYPES.EXPLORATION_PLAN });
        return entries.length > 0 ? entries[entries.length - 1].metadata?.plan || null : null;
    }

    /**
     * Store verified selectors from the Explorer phase.
     * @param {Object[]} selectors - Array of { page, element, selector, method, verified }
     */
    storeVerifiedSelectors(selectors) {
        this._phaseData = this._phaseData || {};
        this._phaseData.verifiedSelectors = selectors;

        return this._addEntry({
            type: ENTRY_TYPES.VERIFIED_SELECTORS,
            agent: 'cognitive-explorer',
            content: `${selectors.length} selectors verified via MCP`,
            metadata: { selectors, count: selectors.length },
        });
    }

    /**
     * Retrieve verified selectors for the Coder phase.
     * @returns {Object[]|null}
     */
    getVerifiedSelectors() {
        if (this._phaseData?.verifiedSelectors) return this._phaseData.verifiedSelectors;
        const entries = this.query({ type: ENTRY_TYPES.VERIFIED_SELECTORS });
        return entries.length > 0 ? entries[entries.length - 1].metadata?.selectors || null : null;
    }

    /**
     * Store page transition graph from the Explorer phase.
     * @param {Object} graph - { nodes: [{url, title}], edges: [{from, to, action}] }
     */
    storePageTransitionGraph(graph) {
        this._phaseData = this._phaseData || {};
        this._phaseData.pageTransitionGraph = graph;

        return this._addEntry({
            type: ENTRY_TYPES.PAGE_TRANSITION_GRAPH,
            agent: 'cognitive-explorer',
            content: `Page graph: ${graph?.nodes?.length || 0} pages, ${graph?.edges?.length || 0} transitions`,
            metadata: { graph },
        });
    }

    /**
     * Retrieve the page transition graph.
     * @returns {Object|null}
     */
    getPageTransitionGraph() {
        if (this._phaseData?.pageTransitionGraph) return this._phaseData.pageTransitionGraph;
        const entries = this.query({ type: ENTRY_TYPES.PAGE_TRANSITION_GRAPH });
        return entries.length > 0 ? entries[entries.length - 1].metadata?.graph || null : null;
    }

    /**
     * Track incremental code generation progress.
     * @param {string} stage - Current generation stage (e.g., 'imports', 'beforeAll', 'test_1')
     * @param {Object} [details] - Stage-specific details
     */
    trackGenerationProgress(stage, details = {}) {
        return this._addEntry({
            type: ENTRY_TYPES.GENERATION_PROGRESS,
            agent: 'cognitive-coder',
            content: `Code generation stage: ${stage}`,
            metadata: { stage, ...details },
        });
    }

    /**
     * Store review feedback for Coder retry.
     * @param {string} verdict - 'PASS' or 'FAIL'
     * @param {Object[]} issues - Array of { category, severity, description, fix }
     * @param {number} confidence - Review confidence (0–100)
     */
    storeReviewFeedback(verdict, issues, confidence) {
        this._phaseData = this._phaseData || {};
        this._phaseData.lastReview = { verdict, issues, confidence };

        return this._addEntry({
            type: ENTRY_TYPES.REVIEW_FEEDBACK,
            agent: 'cognitive-reviewer',
            content: `Review verdict: ${verdict} (confidence: ${confidence}%, issues: ${issues.length})`,
            metadata: { verdict, issues, confidence },
        });
    }

    /**
     * Retrieve last review feedback.
     * @returns {Object|null}
     */
    getLastReview() {
        if (this._phaseData?.lastReview) return this._phaseData.lastReview;
        const entries = this.query({ type: ENTRY_TYPES.REVIEW_FEEDBACK });
        return entries.length > 0 ? entries[entries.length - 1].metadata || null : null;
    }

    /**
     * Store dry-run validation results for Coder retry.
     * @param {string} verdict - 'PROCEED', 'FIX_REQUIRED', 'MANUAL_REVIEW'
     * @param {Object[]} brokenSelectors - Array of { selector, error, suggestion }
     * @param {number} score - Pass rate (0–100)
     */
    storeDryRunResults(verdict, brokenSelectors, score) {
        this._phaseData = this._phaseData || {};
        this._phaseData.lastDryRun = { verdict, brokenSelectors, score };

        return this._addEntry({
            type: ENTRY_TYPES.DRYRUN_RESULTS,
            agent: 'cognitive-dryrun',
            content: `DryRun: ${verdict} (score: ${score}%, broken: ${brokenSelectors.length})`,
            metadata: { verdict, brokenSelectors, score },
        });
    }

    /**
     * Retrieve last dry-run results.
     * @returns {Object|null}
     */
    getLastDryRun() {
        if (this._phaseData?.lastDryRun) return this._phaseData.lastDryRun;
        const entries = this.query({ type: ENTRY_TYPES.DRYRUN_RESULTS });
        return entries.length > 0 ? entries[entries.length - 1].metadata || null : null;
    }

    /**
     * Build a cognitive-phase-aware context summary.
     * Extends the standard summary with phase handoff data.
     *
     * @param {string} targetPhase - Phase name ('analyst', 'explorer', 'coder', 'reviewer', 'dryrun')
     * @returns {string} Formatted context block
     */
    buildPhaseContext(targetPhase) {
        const sections = [];

        switch (targetPhase) {
            case 'explorer': {
                const plan = this.getExplorationPlan();
                if (plan) {
                    sections.push('## Exploration Plan (from Analyst)');
                    sections.push(JSON.stringify(plan, null, 2));
                }
                break;
            }
            case 'coder': {
                const selectors = this.getVerifiedSelectors();
                if (selectors) {
                    sections.push(`## Verified Selectors (${selectors.length} total)`);
                    selectors.forEach(s => {
                        sections.push(`- [${s.page}] ${s.element}: ${s.selector} (${s.method})`);
                    });
                }
                const graph = this.getPageTransitionGraph();
                if (graph) {
                    sections.push('## Page Transitions');
                    (graph.edges || []).forEach(e => {
                        sections.push(`- ${e.from} → ${e.to} (${e.action})`);
                    });
                }
                const review = this.getLastReview();
                if (review && review.verdict === 'FAIL') {
                    sections.push('## Review Fixes Required');
                    (review.issues || []).forEach(i => {
                        sections.push(`- [${i.severity}] ${i.category}: ${i.description}`);
                        if (i.fix) sections.push(`  Fix: ${i.fix}`);
                    });
                }
                break;
            }
            case 'reviewer': {
                const selectors = this.getVerifiedSelectors();
                if (selectors) {
                    sections.push(`## Verified Selectors for Cross-Reference (${selectors.length})`);
                }
                break;
            }
            case 'dryrun': {
                const selectors = this.getVerifiedSelectors();
                if (selectors) {
                    sections.push(`## Expected Selectors (${selectors.length})`);
                }
                break;
            }
        }

        return sections.length > 0
            ? '\n<phase_context>\n' + sections.join('\n') + '\n</phase_context>'
            : '';
    }

    // ─── Read Operations ────────────────────────────────────────────

    /**
     * Get all entries, optionally filtered.
     *
     * @param {Object} [filter]
     * @param {string} [filter.agent] - Filter by agent
     * @param {string} [filter.type] - Filter by entry type
     * @param {number} [filter.limit] - Max results
     * @returns {Object[]}
     */
    query(filter = {}) {
        let results = [...this._entries];

        if (filter.agent) {
            results = results.filter(e => e.agent === filter.agent);
        }
        if (filter.type) {
            results = results.filter(e => e.type === filter.type);
        }
        if (filter.since) {
            results = results.filter(e => e.timestamp >= filter.since);
        }
        if (filter.limit) {
            results = results.slice(-filter.limit);
        }

        return results;
    }

    /**
     * Get a registered artifact by key.
     *
     * @param {string} key - Artifact key
     * @returns {Object|null}
     */
    getArtifact(key) {
        return this._artifacts.get(key) || null;
    }

    /**
     * Get all registered artifacts.
     *
     * @returns {Object} key → artifact mapping
     */
    getAllArtifacts() {
        const result = {};
        for (const [key, value] of this._artifacts) {
            result[key] = value;
        }
        return result;
    }

    /**
     * Get all unanswered questions.
     *
     * @param {string} [targetAgent] - Filter by intended respondent
     * @returns {Object[]}
     */
    getPendingQuestions(targetAgent) {
        const pending = [];
        for (const [qId, q] of this._questions) {
            if (!q.answer) {
                if (!targetAgent || q.targetAgent === targetAgent) {
                    pending.push({ questionId: qId, ...q });
                }
            }
        }
        return pending;
    }

    /**
     * Get all decisions made by a specific agent.
     *
     * @param {string} agent
     * @returns {Object[]}
     */
    getDecisions(agent) {
        return this.query({ agent, type: ENTRY_TYPES.DECISION });
    }

    /**
     * Get all constraints discovered by any agent.
     *
     * @returns {Object[]}
     */
    getConstraints() {
        return this.query({ type: ENTRY_TYPES.CONSTRAINT });
    }

    /**
     * Build a context summary for injection into an agent's prompt.
     * Distills the entire store into a compact text block.
     *
     * @param {string} targetAgent - The agent receiving this summary
     * @param {Object} [options]
     * @param {boolean} [options.includeDecisions=true]
     * @param {boolean} [options.includeConstraints=true]
     * @param {boolean} [options.includeArtifacts=true]
     * @param {boolean} [options.includeQuestions=true]
     * @returns {string} Formatted context block
     */
    buildContextSummary(targetAgent, options = {}) {
        const sections = [];
        const {
            includeDecisions = true,
            includeConstraints = true,
            includeArtifacts = true,
            includeQuestions = true,
        } = options;

        // Previous decisions (from other agents)
        if (includeDecisions) {
            const decisions = this._entries.filter(
                e => e.type === ENTRY_TYPES.DECISION && e.agent !== targetAgent
            );
            if (decisions.length > 0) {
                sections.push('## Previous Agent Decisions');
                for (const d of decisions) {
                    sections.push(`- **${d.agent}**: ${d.content}`);
                    if (d.reasoning) sections.push(`  _Reason: ${d.reasoning}_`);
                }
            }
        }

        // Constraints
        if (includeConstraints) {
            const constraints = this.getConstraints();
            if (constraints.length > 0) {
                sections.push('## Known Constraints');
                for (const c of constraints) {
                    sections.push(`- [${c.agent}] ${c.content}`);
                    if (c.metadata?.impact) sections.push(`  Impact: ${c.metadata.impact}`);
                }
            }
        }

        // Available artifacts
        if (includeArtifacts) {
            const artifacts = this.getAllArtifacts();
            const keys = Object.keys(artifacts);
            if (keys.length > 0) {
                sections.push('## Available Artifacts');
                for (const key of keys) {
                    const a = artifacts[key];
                    sections.push(`- **${key}**: ${a.path} (by ${a.agent})`);
                    if (a.metadata?.summary) sections.push(`  ${a.metadata.summary}`);
                }
            }
        }

        // Pending questions directed at this agent
        if (includeQuestions) {
            const pending = this.getPendingQuestions(targetAgent);
            if (pending.length > 0) {
                sections.push('## Questions for You');
                for (const q of pending) {
                    sections.push(`- [from **${q.askedBy}**] ${q.question} (ID: ${q.questionId})`);
                }
            }
        }

        return sections.length > 0
            ? '\n<shared_context>\n' + sections.join('\n') + '\n</shared_context>'
            : '';
    }

    /**
     * Get store statistics.
     *
     * @returns {Object}
     */
    getStats() {
        const byType = {};
        const byAgent = {};
        for (const e of this._entries) {
            byType[e.type] = (byType[e.type] || 0) + 1;
            byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
        }

        return {
            runId: this.runId,
            totalEntries: this._entries.length,
            artifacts: this._artifacts.size,
            pendingQuestions: this.getPendingQuestions().length,
            byType,
            byAgent,
            createdAt: this.createdAt,
        };
    }

    // ─── Persistence ────────────────────────────────────────────────

    /**
     * Save the store to disk.
     */
    save() {
        if (!this.persist) return;

        try {
            if (!fs.existsSync(this.persistDir)) {
                fs.mkdirSync(this.persistDir, { recursive: true });
            }

            const filePath = path.join(this.persistDir, `${this.runId}-context.json`);
            const data = {
                runId: this.runId,
                createdAt: this.createdAt,
                savedAt: new Date().toISOString(),
                entries: this._entries,
                artifacts: Object.fromEntries(this._artifacts),
                questions: Object.fromEntries(this._questions),
            };

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`[SharedContextStore] Save failed: ${error.message}`);
        }
    }

    /**
     * Load from disk if a previous store exists for this runId.
     */
    _loadFromDisk() {
        try {
            const filePath = path.join(this.persistDir, `${this.runId}-context.json`);
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                this._entries = data.entries || [];
                this.createdAt = data.createdAt || this.createdAt;

                if (data.artifacts) {
                    for (const [key, value] of Object.entries(data.artifacts)) {
                        this._artifacts.set(key, value);
                    }
                }
                if (data.questions) {
                    for (const [key, value] of Object.entries(data.questions)) {
                        this._questions.set(key, value);
                    }
                }
            }
        } catch { /* fresh store */ }
    }

    // ─── Internal ───────────────────────────────────────────────────

    _addEntry(entry) {
        const stored = {
            ...entry,
            id: this._entries.length + 1,
            timestamp: new Date().toISOString(),
        };

        this._entries.push(stored);

        // Evict oldest non-artifact entries when over limit
        if (this._entries.length > this.maxEntries) {
            const artifactIds = new Set(
                this._entries
                    .filter(e => e.type === ENTRY_TYPES.ARTIFACT)
                    .map(e => e.id)
            );
            // Remove oldest non-artifact entries
            this._entries = this._entries.filter(
                (e, i) => artifactIds.has(e.id) || i >= this._entries.length - this.maxEntries
            );
        }

        // Auto-save after each write
        if (this.persist) this.save();

        return stored;
    }
}

// ─── Store Manager — Manages Per-Run Stores ─────────────────────────────────

class ContextStoreManager {
    constructor() {
        this._stores = new Map();
    }

    /**
     * Get or create a context store for a pipeline run.
     *
     * @param {string} runId
     * @param {Object} [options] - Options for new store creation
     * @returns {SharedContextStore}
     */
    getStore(runId, options = {}) {
        if (!this._stores.has(runId)) {
            this._stores.set(runId, new SharedContextStore(runId, options));
        }
        return this._stores.get(runId);
    }

    /**
     * Clean up a completed run's store.
     *
     * @param {string} runId
     * @param {boolean} [saveFirst=true]
     */
    cleanup(runId, saveFirst = true) {
        const store = this._stores.get(runId);
        if (store) {
            if (saveFirst) store.save();
            this._stores.delete(runId);
        }
    }

    /**
     * Get the number of active stores.
     */
    get size() {
        return this._stores.size;
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _managerInstance = null;

function getContextStoreManager() {
    if (!_managerInstance) {
        _managerInstance = new ContextStoreManager();
    }
    return _managerInstance;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    SharedContextStore,
    ContextStoreManager,
    getContextStoreManager,
    ENTRY_TYPES,
};
