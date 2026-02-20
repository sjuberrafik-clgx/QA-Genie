/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RUN STORE — Pipeline Run Persistence Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Stores pipeline run metadata, stage progress, and results. Provides both
 * in-memory fast access and JSON file persistence for development.
 *
 * Designed for upgrade path: swap the file backend for SQLite/Postgres when
 * concurrent volume demands it.
 *
 * @module sdk-orchestrator/run-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { generateRunId, generateBatchId, ensureDir, formatDuration } = require('./utils');

// ─── Run State Constants ────────────────────────────────────────────────────

const RUN_STATUS = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
};

const STAGE_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    PASSED: 'passed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
};

// ─── Run Store ──────────────────────────────────────────────────────────────

class RunStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.storePath] - Path to JSON persistence file
     * @param {number} [options.maxRuns]   - Max runs to retain in store (default: 200)
     */
    constructor(options = {}) {
        this.storePath = options.storePath || path.join(
            __dirname, '..', 'test-artifacts', 'run-store.json'
        );
        this.maxRuns = options.maxRuns || 200;

        // In-memory index: runId → run object
        this._runs = new Map();
        // Batch index: batchId → [runIds]
        this._batches = new Map();

        this._load();
    }

    // ─── Run Lifecycle ──────────────────────────────────────────────

    /**
     * Create a new pipeline run.
     *
     * @param {Object} params
     * @param {string} params.ticketId
     * @param {string} [params.mode='full']
     * @param {string} [params.environment='UAT']
     * @param {string} [params.batchId]      - If part of a batch
     * @param {string} [params.triggeredBy]   - 'cli' | 'api' | 'webhook' | 'schedule'
     * @returns {Object} The created run record
     */
    createRun(params) {
        const runId = generateRunId();
        const now = new Date().toISOString();

        const run = {
            runId,
            ticketId: params.ticketId,
            mode: params.mode || 'full',
            environment: params.environment || 'UAT',
            status: RUN_STATUS.QUEUED,
            batchId: params.batchId || null,
            triggeredBy: params.triggeredBy || 'api',
            createdAt: now,
            startedAt: null,
            completedAt: null,
            duration: null,
            stages: [],
            artifacts: {},
            error: null,
            result: null,
        };

        this._runs.set(runId, run);

        // Track in batch
        if (params.batchId) {
            if (!this._batches.has(params.batchId)) {
                this._batches.set(params.batchId, []);
            }
            this._batches.get(params.batchId).push(runId);
        }

        this._persist();
        return run;
    }

    /**
     * Create a batch of runs for parallel execution.
     *
     * @param {string[]} ticketIds
     * @param {Object} params - Shared params (mode, environment, triggeredBy)
     * @returns {Object} { batchId, runs: [...] }
     */
    createBatch(ticketIds, params = {}) {
        const batchId = generateBatchId();
        const runs = ticketIds.map(ticketId =>
            this.createRun({ ...params, ticketId, batchId })
        );
        return { batchId, runs };
    }

    /**
     * Mark a run as started.
     * @param {string} runId
     */
    startRun(runId) {
        const run = this._runs.get(runId);
        if (!run) return;
        run.status = RUN_STATUS.RUNNING;
        run.startedAt = new Date().toISOString();
        this._persist();
    }

    /**
     * Record stage progress for a run.
     *
     * @param {string} runId
     * @param {string} stageName
     * @param {string} status - 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
     * @param {Object} [details] - Additional stage data (message, artifacts, etc.)
     */
    updateStage(runId, stageName, status, details = {}) {
        const run = this._runs.get(runId);
        if (!run) return;

        const existing = run.stages.find(s => s.name === stageName);
        const now = new Date().toISOString();

        if (existing) {
            existing.status = status;
            existing.updatedAt = now;
            if (status === 'running') existing.startedAt = now;
            if (['passed', 'failed', 'skipped'].includes(status)) {
                existing.completedAt = now;
                if (existing.startedAt) {
                    existing.duration = formatDuration(
                        new Date(now) - new Date(existing.startedAt)
                    );
                }
            }
            Object.assign(existing, details);
        } else {
            run.stages.push({
                name: stageName,
                status,
                startedAt: status === 'running' ? now : null,
                completedAt: ['passed', 'failed', 'skipped'].includes(status) ? now : null,
                duration: null,
                ...details,
            });
        }

        this._persist();
    }

    /**
     * Mark a run as completed (success or failure).
     *
     * @param {string} runId
     * @param {Object} result - Pipeline result object
     */
    completeRun(runId, result) {
        const run = this._runs.get(runId);
        if (!run) return;

        const now = new Date().toISOString();
        run.status = result.success ? RUN_STATUS.COMPLETED : RUN_STATUS.FAILED;
        run.completedAt = now;
        run.result = result;
        run.error = result.error || null;
        run.artifacts = result.artifacts || {};

        if (run.startedAt) {
            run.duration = formatDuration(
                new Date(now) - new Date(run.startedAt)
            );
        }

        this._persist();
    }

    /**
     * Cancel a run.
     * @param {string} runId
     * @returns {boolean} Whether the run was cancellable
     */
    cancelRun(runId) {
        const run = this._runs.get(runId);
        if (!run) return false;
        if ([RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.CANCELLED].includes(run.status)) {
            return false; // Already terminal
        }
        run.status = RUN_STATUS.CANCELLED;
        run.completedAt = new Date().toISOString();
        run.error = 'Cancelled by user';
        this._persist();
        return true;
    }

    /**
     * Force-cancel any run regardless of current state.
     * Used for stuck/orphaned runs that can't be cancelled normally.
     * @param {string} runId
     * @param {string} [reason]
     * @returns {boolean}
     */
    forceCancelRun(runId, reason) {
        const run = this._runs.get(runId);
        if (!run) return false;

        const now = new Date().toISOString();
        run.status = RUN_STATUS.FAILED;
        run.completedAt = now;
        run.error = reason || 'Force cancelled by user';

        if (run.startedAt && !run.duration) {
            run.duration = formatDuration(new Date(now) - new Date(run.startedAt));
        }

        // Fail any in-progress stages
        if (Array.isArray(run.stages)) {
            for (const stage of run.stages) {
                if (stage.status === STAGE_STATUS.RUNNING) {
                    stage.status = STAGE_STATUS.FAILED;
                    stage.completedAt = now;
                    stage.message = (stage.message || '') + ' [force cancelled]';
                }
            }
        }

        this._persist();
        return true;
    }

    /**
     * Get runs that have been in running/queued state longer than a threshold.
     * @param {number} maxAgeMs - Max age in milliseconds (default: 60 min)
     * @returns {Object[]}
     */
    getStaleRuns(maxAgeMs = 60 * 60 * 1000) {
        const now = Date.now();
        const stale = [];

        for (const run of this._runs.values()) {
            if (![RUN_STATUS.RUNNING, RUN_STATUS.QUEUED].includes(run.status)) continue;
            const startTime = run.startedAt || run.createdAt;
            if (startTime && (now - new Date(startTime).getTime()) > maxAgeMs) {
                stale.push(run);
            }
        }

        return stale;
    }

    // ─── Queries ────────────────────────────────────────────────────

    /**
     * Get a single run by ID.
     * @param {string} runId
     * @returns {Object|null}
     */
    getRun(runId) {
        return this._runs.get(runId) || null;
    }

    /**
     * List recent runs with optional filters.
     *
     * @param {Object} [filters]
     * @param {string} [filters.ticketId]
     * @param {string} [filters.status]
     * @param {string} [filters.mode]
     * @param {string} [filters.batchId]
     * @param {number} [filters.limit=50]
     * @param {number} [filters.offset=0]
     * @returns {Object} { runs: [...], total: number }
     */
    listRuns(filters = {}) {
        let runs = Array.from(this._runs.values());

        // Apply filters
        if (filters.ticketId) {
            runs = runs.filter(r => r.ticketId === filters.ticketId);
        }
        if (filters.status) {
            runs = runs.filter(r => r.status === filters.status);
        }
        if (filters.mode) {
            runs = runs.filter(r => r.mode === filters.mode);
        }
        if (filters.batchId) {
            runs = runs.filter(r => r.batchId === filters.batchId);
        }

        // Sort by creation time descending (most recent first)
        runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const total = runs.length;
        const offset = filters.offset || 0;
        const limit = filters.limit || 50;
        runs = runs.slice(offset, offset + limit);

        return { runs, total };
    }

    /**
     * Get batch details.
     * @param {string} batchId
     * @returns {Object|null}
     */
    getBatch(batchId) {
        const runIds = this._batches.get(batchId);
        if (!runIds) return null;

        const runs = runIds.map(id => this._runs.get(id)).filter(Boolean);
        const completed = runs.filter(r =>
            [RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.CANCELLED].includes(r.status)
        );

        return {
            batchId,
            total: runs.length,
            completed: completed.length,
            passed: runs.filter(r => r.status === RUN_STATUS.COMPLETED).length,
            failed: runs.filter(r => r.status === RUN_STATUS.FAILED).length,
            status: completed.length === runs.length
                ? (runs.every(r => r.status === RUN_STATUS.COMPLETED) ? 'completed' : 'failed')
                : 'running',
            runs,
        };
    }

    /**
     * Check if a pipeline is already running for a ticket (dedup).
     * @param {string} ticketId
     * @returns {Object|null} The active run, or null
     */
    getActiveRun(ticketId) {
        for (const run of this._runs.values()) {
            if (run.ticketId === ticketId &&
                [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING].includes(run.status)) {
                return run;
            }
        }
        return null;
    }

    // ─── Analytics ──────────────────────────────────────────────────

    /**
     * Get summary statistics.
     * @returns {Object}
     */
    getStats() {
        const runs = Array.from(this._runs.values());
        const completed = runs.filter(r => r.status === RUN_STATUS.COMPLETED);
        const failed = runs.filter(r => r.status === RUN_STATUS.FAILED);

        // Calculate average duration for completed runs
        const durations = completed
            .filter(r => r.startedAt && r.completedAt)
            .map(r => new Date(r.completedAt) - new Date(r.startedAt));
        const avgDuration = durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0;

        return {
            totalRuns: runs.length,
            completed: completed.length,
            failed: failed.length,
            cancelled: runs.filter(r => r.status === RUN_STATUS.CANCELLED).length,
            running: runs.filter(r => r.status === RUN_STATUS.RUNNING).length,
            queued: runs.filter(r => r.status === RUN_STATUS.QUEUED).length,
            successRate: runs.length > 0
                ? Math.round((completed.length / (completed.length + failed.length || 1)) * 100)
                : 0,
            avgDuration: formatDuration(avgDuration),
            avgDurationMs: avgDuration,
        };
    }

    // ─── Persistence ────────────────────────────────────────────────

    _load() {
        try {
            if (fs.existsSync(this.storePath)) {
                let content = fs.readFileSync(this.storePath, 'utf-8');
                if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
                const data = JSON.parse(content);

                if (Array.isArray(data.runs)) {
                    let orphanCount = 0;
                    const now = new Date().toISOString();

                    for (const run of data.runs) {
                        // ── Stale run cleanup on startup ──
                        // Any run still in running/queued from a previous server session
                        // is orphaned — the in-memory pipeline handle is gone.
                        if ([RUN_STATUS.RUNNING, RUN_STATUS.QUEUED].includes(run.status)) {
                            run.status = RUN_STATUS.FAILED;
                            run.completedAt = now;
                            run.error = 'Server restarted — pipeline execution was interrupted';
                            if (run.startedAt && !run.duration) {
                                run.duration = formatDuration(
                                    new Date(now) - new Date(run.startedAt)
                                );
                            }
                            // Mark any in-progress stages as failed too
                            if (Array.isArray(run.stages)) {
                                for (const stage of run.stages) {
                                    if (stage.status === STAGE_STATUS.RUNNING) {
                                        stage.status = STAGE_STATUS.FAILED;
                                        stage.completedAt = now;
                                        stage.message = (stage.message || '') + ' [interrupted by server restart]';
                                    }
                                }
                            }
                            orphanCount++;
                        }

                        this._runs.set(run.runId, run);
                        if (run.batchId) {
                            if (!this._batches.has(run.batchId)) {
                                this._batches.set(run.batchId, []);
                            }
                            this._batches.get(run.batchId).push(run.runId);
                        }
                    }

                    if (orphanCount > 0) {
                        console.log(`[RunStore] Cleaned up ${orphanCount} orphaned running/queued run(s) from previous session`);
                        this._persist();
                    }
                }
            }
        } catch (error) {
            console.warn(`[RunStore] Failed to load: ${error.message}`);
        }
    }

    _persist() {
        try {
            // Enforce max runs — evict oldest completed/failed/cancelled
            if (this._runs.size > this.maxRuns) {
                const sorted = Array.from(this._runs.values())
                    .filter(r => [RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.CANCELLED].includes(r.status))
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                while (this._runs.size > this.maxRuns && sorted.length > 0) {
                    const oldest = sorted.shift();
                    this._runs.delete(oldest.runId);
                }
            }

            const data = {
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                runs: Array.from(this._runs.values()),
            };

            ensureDir(path.dirname(this.storePath));
            const tmpPath = this.storePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.storePath);
        } catch (error) {
            console.warn(`[RunStore] Failed to persist: ${error.message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { RunStore, RUN_STATUS, STAGE_STATUS };
