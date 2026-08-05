/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCHEDULER STORE — One-Time Scheduled Action Persistence Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Stores one-time scheduled jobs (e.g. "transition AOTF-123 to Done at 5 PM").
 * File-backed JSON store with an in-memory index, mirroring RunStore /
 * JiraWebhookReliabilityStore conventions (atomic writes, orphan recovery,
 * bounded retention). No external dependencies, no database.
 *
 * A job stores an ABSOLUTE `runAt` (UTC ISO) — even "in N minutes" is resolved
 * to an absolute timestamp at creation time. The engine polls this store for
 * due jobs and dispatches their action.
 *
 * @module sdk-orchestrator/scheduler-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir } = require('./utils');

// ─── Constants ──────────────────────────────────────────────────────────────

const JOB_STATUS = {
    SCHEDULED: 'scheduled',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    MISSED: 'missed',
};

const TERMINAL_STATUSES = new Set([
    JOB_STATUS.COMPLETED,
    JOB_STATUS.FAILED,
    JOB_STATUS.CANCELLED,
    JOB_STATUS.MISSED,
]);

const ACTION_TYPES = {
    JIRA_TRANSITION: 'jira.transition',
    JIRA_COMMENT: 'jira.comment',
    JIRA_CREATE: 'jira.create',
    JIRA_AI_CREATE: 'jira.ai-create',
    PIPELINE_RUN: 'pipeline.run',
    AGENT_INVOKE: 'agent.invoke',
};

const MAX_HISTORY_ENTRIES = 20;

// ─── ID Generation ──────────────────────────────────────────────────────────

function generateJobId() {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    return `job_${ts}_${rand}`;
}

// ─── Scheduler Store ────────────────────────────────────────────────────────

class SchedulerStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.storePath] - Path to JSON persistence file
     * @param {number} [options.maxJobs]   - Max jobs to retain (default: 500)
     */
    constructor(options = {}) {
        this.storePath = options.storePath || path.join(
            __dirname, '..', 'test-artifacts', 'scheduler-store.json'
        );
        this.maxJobs = options.maxJobs || 500;

        // In-memory index: jobId → job object
        this._jobs = new Map();

        this._load();
    }

    // ─── Lifecycle ──────────────────────────────────────────────────

    /**
     * Create a new scheduled job.
     *
     * @param {Object} params
     * @param {string} params.runAt              - Absolute ISO timestamp (UTC) when the job fires
     * @param {Object} params.action             - { type, params }
     * @param {Object} [params.schedule]         - Original schedule spec for display { kind, delayMs, timezone }
     * @param {Object} [params.createdBy]        - { source, sessionId }
     * @param {number} [params.maxAttempts=3]
     * @returns {Object} The created job record
     */
    createJob(params) {
        const jobId = generateJobId();
        const now = new Date().toISOString();

        const job = {
            jobId,
            createdAt: now,
            updatedAt: now,
            createdBy: {
                source: params.createdBy?.source || 'api',
                sessionId: params.createdBy?.sessionId || null,
            },
            schedule: {
                kind: params.schedule?.kind || 'datetime',
                delayMs: Number.isFinite(params.schedule?.delayMs) ? params.schedule.delayMs : null,
                runAt: params.runAt,
                timezone: params.schedule?.timezone || 'UTC',
            },
            action: {
                type: params.action?.type,
                params: params.action?.params || {},
            },
            status: JOB_STATUS.SCHEDULED,
            attempts: 0,
            maxAttempts: Number.isFinite(params.maxAttempts) ? params.maxAttempts : 3,
            nextRetryAt: null,
            lastError: null,
            result: null,
            firedAt: null,
            completedAt: null,
            history: [
                { at: now, event: 'created', detail: `Scheduled for ${params.runAt}` },
            ],
        };

        this._jobs.set(jobId, job);
        this._persist();
        return job;
    }

    /** @returns {Object|null} */
    getJob(jobId) {
        return this._jobs.get(jobId) || null;
    }

    /**
     * List jobs with optional filters.
     * @param {Object} [filters]
     * @param {string} [filters.status]
     * @param {string} [filters.actionType]
     * @param {number} [filters.limit=100]
     * @param {number} [filters.offset=0]
     * @returns {Object} { jobs: [...], total }
     */
    listJobs(filters = {}) {
        let jobs = Array.from(this._jobs.values());

        if (filters.status) {
            jobs = jobs.filter(j => j.status === filters.status);
        }
        if (filters.actionType) {
            jobs = jobs.filter(j => j.action?.type === filters.actionType);
        }

        // Pending (scheduled/running) first — by soonest runAt; then terminal by
        // most recent update.
        jobs.sort((a, b) => {
            const aPending = !TERMINAL_STATUSES.has(a.status);
            const bPending = !TERMINAL_STATUSES.has(b.status);
            if (aPending !== bPending) return aPending ? -1 : 1;
            if (aPending) return new Date(a.schedule.runAt) - new Date(b.schedule.runAt);
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        const total = jobs.length;
        const offset = filters.offset || 0;
        const limit = filters.limit || 100;
        return { jobs: jobs.slice(offset, offset + limit), total };
    }

    /**
     * Patch a job and persist.
     * @param {string} jobId
     * @param {Object} patch
     * @returns {Object|null} The updated job
     */
    updateJob(jobId, patch = {}) {
        const job = this._jobs.get(jobId);
        if (!job) return null;
        Object.assign(job, patch);
        job.updatedAt = new Date().toISOString();
        this._persist();
        return job;
    }

    /**
     * Append a bounded history entry to a job (does not persist on its own —
     * caller typically follows with updateJob).
     */
    appendHistory(jobId, event, detail = '') {
        const job = this._jobs.get(jobId);
        if (!job) return null;
        if (!Array.isArray(job.history)) job.history = [];
        job.history.push({ at: new Date().toISOString(), event, detail });
        if (job.history.length > MAX_HISTORY_ENTRIES) {
            job.history = job.history.slice(-MAX_HISTORY_ENTRIES);
        }
        return job;
    }

    /**
     * Cancel a scheduled job. Only pending (non-terminal, non-running) jobs can
     * be cancelled.
     * @returns {Object|null} The cancelled job, or null if not cancellable
     */
    cancelJob(jobId) {
        const job = this._jobs.get(jobId);
        if (!job) return null;
        if (TERMINAL_STATUSES.has(job.status) || job.status === JOB_STATUS.RUNNING) {
            return null;
        }
        this.appendHistory(jobId, 'cancelled', 'Cancelled by user');
        return this.updateJob(jobId, { status: JOB_STATUS.CANCELLED });
    }

    /**
     * Jobs that are due to fire at `now`. A job is due when it is scheduled,
     * its runAt has passed, and any pending retry backoff has elapsed.
     * @param {number} [nowMs]
     * @returns {Object[]}
     */
    dueJobs(nowMs = Date.now()) {
        const due = [];
        for (const job of this._jobs.values()) {
            if (job.status !== JOB_STATUS.SCHEDULED) continue;
            if (new Date(job.schedule.runAt).getTime() > nowMs) continue;
            if (job.nextRetryAt && new Date(job.nextRetryAt).getTime() > nowMs) continue;
            due.push(job);
        }
        return due;
    }

    /** Scheduled jobs that have not yet reached their runAt. */
    pendingJobs() {
        return Array.from(this._jobs.values()).filter(j => j.status === JOB_STATUS.SCHEDULED);
    }

    getStats() {
        const jobs = Array.from(this._jobs.values());
        const count = status => jobs.filter(j => j.status === status).length;
        return {
            total: jobs.length,
            scheduled: count(JOB_STATUS.SCHEDULED),
            running: count(JOB_STATUS.RUNNING),
            completed: count(JOB_STATUS.COMPLETED),
            failed: count(JOB_STATUS.FAILED),
            cancelled: count(JOB_STATUS.CANCELLED),
            missed: count(JOB_STATUS.MISSED),
        };
    }

    // ─── Persistence ────────────────────────────────────────────────

    _load() {
        try {
            if (!fs.existsSync(this.storePath)) return;
            let content = fs.readFileSync(this.storePath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
            const data = JSON.parse(content);
            if (!Array.isArray(data.jobs)) return;

            let orphanCount = 0;
            const now = new Date().toISOString();

            for (const job of data.jobs) {
                // A job left in `running` from a previous session was interrupted
                // by a crash/restart. Reset it to `scheduled` so reconcile() can
                // re-evaluate it (fire via catch-up or mark missed).
                if (job.status === JOB_STATUS.RUNNING) {
                    job.status = JOB_STATUS.SCHEDULED;
                    job.updatedAt = now;
                    if (!Array.isArray(job.history)) job.history = [];
                    job.history.push({
                        at: now,
                        event: 'recovered',
                        detail: 'Reset to scheduled after server restart',
                    });
                    orphanCount++;
                }
                this._jobs.set(job.jobId, job);
            }

            if (orphanCount > 0) {
                console.log(`[SchedulerStore] Recovered ${orphanCount} interrupted job(s) from previous session`);
                this._persist();
            }
        } catch (error) {
            console.warn(`[SchedulerStore] Failed to load: ${error.message}`);
        }
    }

    _persist() {
        try {
            // Enforce max jobs — evict oldest terminal jobs, never pending ones.
            if (this._jobs.size > this.maxJobs) {
                const evictable = Array.from(this._jobs.values())
                    .filter(j => TERMINAL_STATUSES.has(j.status))
                    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
                while (this._jobs.size > this.maxJobs && evictable.length > 0) {
                    this._jobs.delete(evictable.shift().jobId);
                }
            }

            const data = {
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                jobs: Array.from(this._jobs.values()),
            };

            ensureDir(path.dirname(this.storePath));
            const tmpPath = this.storePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.storePath);
        } catch (error) {
            console.warn(`[SchedulerStore] Failed to persist: ${error.message}`);
        }
    }
}

module.exports = {
    SchedulerStore,
    JOB_STATUS,
    TERMINAL_STATUSES,
    ACTION_TYPES,
    generateJobId,
};
