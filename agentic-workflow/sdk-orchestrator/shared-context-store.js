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
