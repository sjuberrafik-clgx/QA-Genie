/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCHEDULER ENGINE — One-Time Job Runtime Loop
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Polls the SchedulerStore for due jobs and dispatches their action through the
 * action registry. Deterministic, single-process, zero external dependencies —
 * modelled on the existing stale-run watchdog and webhook queue processor.
 *
 *  • reconcile() runs once at boot: overdue jobs are fired (catch-up) or marked
 *    `missed`, and crash-orphaned `running` jobs (already reset to `scheduled`
 *    by the store) are re-evaluated.
 *  • tick() runs every `pollIntervalMs`: fires jobs whose runAt (and any retry
 *    backoff) has elapsed.
 *  • fire() executes one job with a concurrency guard, recording success,
 *    retry-with-backoff, or terminal failure.
 *
 * @module sdk-orchestrator/scheduler-engine
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { JOB_STATUS } = require('./scheduler-store');

const DEFAULTS = {
    enabled: true,
    pollIntervalMs: 30000,
    maxAttempts: 3,
    retryDelayMs: 60000,
    missedFirePolicy: 'catch-up', // 'catch-up' | 'skip'
    maxCatchUpAgeMs: 3600000,     // 1 hour
};

class SchedulerEngine {
    /**
     * @param {Object} deps
     * @param {Object} deps.store    - SchedulerStore instance
     * @param {Object} deps.actions  - createSchedulerActions() result ({ execute })
     * @param {Object} [deps.config] - workflow-config (reads .scheduler)
     * @param {Function} [deps.logger] - (message, level) => void
     */
    constructor({ store, actions, config, logger, onJobTerminal } = {}) {
        this.store = store;
        this.actions = actions;
        this.config = config || {};
        this.log = typeof logger === 'function' ? logger : () => {};
        this._onJobTerminal = typeof onJobTerminal === 'function' ? onJobTerminal : null;

        this._timer = null;
        this._running = new Set(); // jobIds currently executing (concurrency guard)
        this._started = false;
    }

    /** Notify a terminal transition (completed/failed/missed) — used for attachment cleanup. */
    _notifyTerminal(jobId, status) {
        if (!this._onJobTerminal) return;
        try { this._onJobTerminal(jobId, status); } catch { /* best-effort */ }
    }

    _cfg() {
        const c = this.config.scheduler || {};
        return {
            enabled: c.enabled !== false,
            pollIntervalMs: Number.isFinite(c.pollIntervalMs) ? c.pollIntervalMs : DEFAULTS.pollIntervalMs,
            maxAttempts: Number.isFinite(c.maxAttempts) ? c.maxAttempts : DEFAULTS.maxAttempts,
            retryDelayMs: Number.isFinite(c.retryDelayMs) ? c.retryDelayMs : DEFAULTS.retryDelayMs,
            missedFirePolicy: c.missedFirePolicy === 'skip' ? 'skip' : DEFAULTS.missedFirePolicy,
            maxCatchUpAgeMs: Number.isFinite(c.maxCatchUpAgeMs) ? c.maxCatchUpAgeMs : DEFAULTS.maxCatchUpAgeMs,
        };
    }

    /** Start the poll loop (no-op if disabled or already started). */
    start() {
        const cfg = this._cfg();
        if (!cfg.enabled) {
            this.log('[Scheduler] Disabled via config — engine not started', 'info');
            return;
        }
        if (this._started) return;
        this._started = true;

        this.reconcile();

        this._timer = setInterval(() => {
            this.tick().catch(err => this.log(`[Scheduler] tick error: ${err.message}`, 'error'));
        }, cfg.pollIntervalMs);
        if (typeof this._timer.unref === 'function') this._timer.unref();

        // Fire an immediate tick so due jobs don't wait a full interval.
        this.tick().catch(err => this.log(`[Scheduler] initial tick error: ${err.message}`, 'error'));

        this.log(`[Scheduler] Engine started (poll ${cfg.pollIntervalMs}ms, policy ${cfg.missedFirePolicy})`, 'info');
    }

    /** Stop the poll loop. */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._started = false;
    }

    /**
     * Boot-time reconciliation. Overdue scheduled jobs are either kept for
     * immediate catch-up firing or marked `missed` when they are too stale or
     * the policy is `skip`.
     */
    reconcile() {
        const cfg = this._cfg();
        const now = Date.now();
        let missed = 0;
        let caughtUp = 0;

        for (const job of this.store.pendingJobs()) {
            const runAtMs = new Date(job.schedule.runAt).getTime();
            if (runAtMs > now) continue; // not overdue

            const age = now - runAtMs;
            if (cfg.missedFirePolicy === 'skip' || age > cfg.maxCatchUpAgeMs) {
                this.store.appendHistory(job.jobId, 'missed',
                    cfg.missedFirePolicy === 'skip'
                        ? 'Overdue at startup; missedFirePolicy=skip'
                        : `Overdue by ${Math.round(age / 1000)}s (> maxCatchUpAgeMs)`);
                this.store.updateJob(job.jobId, { status: JOB_STATUS.MISSED, completedAt: new Date().toISOString() });
                this._notifyTerminal(job.jobId, JOB_STATUS.MISSED);
                missed++;
            } else {
                // Within catch-up window — leave scheduled; the immediate tick fires it.
                this.store.appendHistory(job.jobId, 'catch-up', `Overdue by ${Math.round(age / 1000)}s; will fire now`);
                this.store.updateJob(job.jobId, {});
                caughtUp++;
            }
        }

        if (missed || caughtUp) {
            this.log(`[Scheduler] Reconcile: ${caughtUp} caught up, ${missed} marked missed`, 'info');
        }
    }

    /** One poll cycle — fire all currently due jobs. */
    async tick() {
        const due = this.store.dueJobs(Date.now());
        for (const job of due) {
            if (this._running.has(job.jobId)) continue;
            await this.fire(job).catch(err => this.log(`[Scheduler] fire error ${job.jobId}: ${err.message}`, 'error'));
        }
    }

    /**
     * Execute one job. Handles success, retry-with-backoff, and terminal failure.
     * @param {Object} job
     */
    async fire(job) {
        if (this._running.has(job.jobId)) return;
        this._running.add(job.jobId);

        const cfg = this._cfg();
        const nowIso = new Date().toISOString();
        this.store.appendHistory(job.jobId, 'firing', `Attempt ${job.attempts + 1}`);
        this.store.updateJob(job.jobId, {
            status: JOB_STATUS.RUNNING,
            firedAt: job.firedAt || nowIso,
            nextRetryAt: null,
        });

        try {
            const result = await this.actions.execute(job.action, { jobId: job.jobId });
            this.store.appendHistory(job.jobId, 'completed', result.outcome || 'Action completed');
            this.store.updateJob(job.jobId, {
                status: JOB_STATUS.COMPLETED,
                attempts: job.attempts + 1,
                result,
                lastError: null,
                completedAt: new Date().toISOString(),
            });
            this.log(`[Scheduler] Job ${job.jobId} completed: ${result.outcome || job.action.type}`, 'info');
            this._notifyTerminal(job.jobId, JOB_STATUS.COMPLETED);
        } catch (error) {
            const attempts = job.attempts + 1;
            const maxAttempts = Number.isFinite(job.maxAttempts) ? job.maxAttempts : cfg.maxAttempts;

            if (attempts < maxAttempts) {
                const backoff = cfg.retryDelayMs * attempts; // linear backoff
                const nextRetryAt = new Date(Date.now() + backoff).toISOString();
                this.store.appendHistory(job.jobId, 'retry', `Attempt ${attempts} failed: ${error.message}. Retry at ${nextRetryAt}`);
                this.store.updateJob(job.jobId, {
                    status: JOB_STATUS.SCHEDULED,
                    attempts,
                    nextRetryAt,
                    lastError: error.message,
                });
                this.log(`[Scheduler] Job ${job.jobId} failed (attempt ${attempts}/${maxAttempts}) — retry in ${Math.round(backoff / 1000)}s`, 'warn');
            } else {
                this.store.appendHistory(job.jobId, 'failed', `Final attempt failed: ${error.message}`);
                this.store.updateJob(job.jobId, {
                    status: JOB_STATUS.FAILED,
                    attempts,
                    lastError: error.message,
                    completedAt: new Date().toISOString(),
                });
                this.log(`[Scheduler] Job ${job.jobId} failed permanently: ${error.message}`, 'error');
                this._notifyTerminal(job.jobId, JOB_STATUS.FAILED);
            }
        } finally {
            this._running.delete(job.jobId);
        }
    }

    /**
     * Force a scheduled job to fire immediately (used by the run-now endpoint).
     * @param {string} jobId
     * @returns {Promise<Object>} { ok, error? }
     */
    async runNow(jobId) {
        const job = this.store.getJob(jobId);
        if (!job) return { ok: false, error: 'Job not found.' };
        if (job.status !== JOB_STATUS.SCHEDULED) {
            return { ok: false, error: `Job is ${job.status}; only scheduled jobs can be run now.` };
        }
        await this.fire(job);
        return { ok: true };
    }
}

module.exports = { SchedulerEngine, DEFAULTS };
