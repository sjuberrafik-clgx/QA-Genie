'use strict';

const EXCLUSIVE_MODES = new Set(['mutation', 'snapshot', 'context']);

class OperationScheduler {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.maxConcurrent = positiveInt(options.maxConcurrent, 2);
        this._queue = [];
        this._active = 0;
        this._activeResources = new Set();
        this._browserActive = false;
        this._sequence = 0;
        this._maxActive = 0;
    }

    schedule(task, options = {}) {
        const operation = {
            id: `op${++this._sequence}`,
            task,
            mode: options.mode || 'read',
            resource: options.resource || null,
            signal: options.signal || null,
            label: options.label || null,
            queuedAt: Date.now(),
            state: 'queued',
            resolve: null,
            reject: null,
            onAbort: null,
        };

        if (operation.signal && operation.signal.aborted) {
            return Promise.reject(cancellationError(operation.signal));
        }
        if (!this.enabled) return this._runUnbounded(operation);

        const promise = new Promise((resolve, reject) => {
            operation.resolve = resolve;
            operation.reject = reject;
        });
        if (operation.signal) {
            operation.onAbort = () => {
                if (operation.state !== 'queued') return;
                const index = this._queue.indexOf(operation);
                if (index >= 0) this._queue.splice(index, 1);
                operation.state = 'cancelled';
                operation.reject(cancellationError(operation.signal));
                this._drain();
            };
            operation.signal.addEventListener('abort', operation.onAbort, { once: true });
        }
        this._queue.push(operation);
        this._drain();
        return promise;
    }

    _runUnbounded(operation) {
        const startedAt = Date.now();
        return Promise.resolve()
            .then(() => {
                if (operation.signal && operation.signal.aborted) throw cancellationError(operation.signal);
                return operation.task(operation.signal);
            })
            .then((value) => ({ value, audit: this._audit(operation, startedAt, Date.now()) }));
    }

    _drain() {
        for (let index = 0; index < this._queue.length && this._active < this.maxConcurrent;) {
            const operation = this._queue[index];
            if (operation.signal && operation.signal.aborted) {
                this._queue.splice(index, 1);
                operation.state = 'cancelled';
                this._removeAbortListener(operation);
                operation.reject(cancellationError(operation.signal));
                continue;
            }
            if (!this._canStart(operation, index)) {
                if (operation.mode === 'browser') break;
                index++;
                continue;
            }
            this._queue.splice(index, 1);
            this._start(operation);
        }
    }

    _canStart(operation, index) {
        if (this._browserActive) return false;
        if (this._queue.slice(0, index).some((queued) => queued.mode === 'browser')) return false;
        if (operation.mode === 'browser') return this._active === 0;
        return !(EXCLUSIVE_MODES.has(operation.mode) && this._activeResources.has(operation.resource));
    }

    _start(operation) {
        operation.state = 'active';
        const startedAt = Date.now();
        this._active++;
        this._maxActive = Math.max(this._maxActive, this._active);
        if (operation.mode === 'browser') this._browserActive = true;
        if (EXCLUSIVE_MODES.has(operation.mode)) this._activeResources.add(operation.resource);

        Promise.resolve()
            .then(() => operation.task(operation.signal))
            .then(
                (value) => operation.resolve({ value, audit: this._audit(operation, startedAt, Date.now()) }),
                (error) => operation.reject(error)
            )
            .finally(() => {
                operation.state = 'done';
                this._active--;
                if (operation.mode === 'browser') this._browserActive = false;
                if (EXCLUSIVE_MODES.has(operation.mode)) this._activeResources.delete(operation.resource);
                this._removeAbortListener(operation);
                this._drain();
            });
    }

    _audit(operation, startedAt, completedAt) {
        return {
            operationId: operation.id,
            operation: operation.mode,
            label: operation.label,
            queueMs: startedAt - operation.queuedAt,
            executeMs: completedAt - startedAt,
        };
    }

    _removeAbortListener(operation) {
        if (operation.signal && operation.onAbort) {
            operation.signal.removeEventListener('abort', operation.onAbort);
        }
    }

    cancelQueued(reason = 'scheduler closed') {
        const error = new Error(reason);
        error.code = 'GLASS_CANCELLED';
        for (const operation of this._queue.splice(0)) {
            operation.state = 'cancelled';
            this._removeAbortListener(operation);
            operation.reject(error);
        }
    }

    get stats() {
        return {
            active: this._active,
            queued: this._queue.length,
            maxActive: this._maxActive,
            maxConcurrent: this.maxConcurrent,
        };
    }
}

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cancellationError(signal) {
    const error = new Error(signal && signal.reason ? String(signal.reason) : 'tool call cancelled');
    error.name = 'AbortError';
    error.code = 'GLASS_CANCELLED';
    return error;
}

module.exports = { OperationScheduler };