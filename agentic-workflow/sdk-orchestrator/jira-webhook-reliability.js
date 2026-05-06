/**
 * Jira Webhook Reliability Layer
 *
 * Adds durable lifecycle sync state + queue/DLQ persistence for webhook-first
 * ingestion so webhook handling remains resilient across server restarts.
 */

const path = require('path');
const {
    ensureDir,
    readJSONSync,
    writeJSONSync,
} = require('./utils');
const { normalizeWebhookIds } = require('./jira-webhook-lifecycle');

const DEFAULT_STORE_FILE = path.join(__dirname, '..', 'test-artifacts', 'jira-webhook-reliability.json');

function toTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
    }
    return defaultValue;
}

function parseInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function resolveStorePath(value) {
    const configuredPath = toTrimmedString(value);
    if (!configuredPath) return DEFAULT_STORE_FILE;
    if (path.isAbsolute(configuredPath)) return configuredPath;
    return path.resolve(path.join(__dirname, '..'), configuredPath);
}

function normalizeJiraWebhookIngestionConfig(orchestratorConfig = {}) {
    const configured = orchestratorConfig?.sdk?.webhooks?.jira?.ingestion || {};

    return {
        enabled: parseBoolean(configured.enabled, true),
        maxQueueSize: parseInteger(configured.maxQueueSize, 250, 10, 5000),
        maxAttempts: parseInteger(configured.maxAttempts, 5, 1, 20),
        retryDelayMs: parseInteger(configured.retryDelayMs, 5000, 1000, 600000),
        maxDeadLetterEntries: parseInteger(configured.maxDeadLetterEntries, 200, 10, 5000),
        maxRecentEntries: parseInteger(configured.maxRecentEntries, 200, 10, 5000),
        processingLoopLimit: parseInteger(configured.processingLoopLimit, 50, 1, 500),
        idlePollMs: parseInteger(configured.idlePollMs, 1000, 250, 30000),
        storeFile: resolveStorePath(configured.storeFile),
    };
}

function normalizeJiraWebhookStartupSyncConfig(orchestratorConfig = {}) {
    const configured = orchestratorConfig?.sdk?.webhooks?.jira?.lifecycle?.startupSync || {};

    return {
        enabled: parseBoolean(configured.enabled, true),
        refreshPersistedIds: parseBoolean(configured.refreshPersistedIds, true),
        registerIfMissing: parseBoolean(configured.registerIfMissing, true),
    };
}

function createQueueError(message, options = {}) {
    const error = new Error(message);
    error.status = Number.isInteger(options.status) ? options.status : 500;
    error.retryable = options.retryable !== false;
    error.code = toTrimmedString(options.code) || null;
    if (options.details !== undefined) {
        error.details = options.details;
    }
    return error;
}

function toPublicDelivery(item, options = {}) {
    if (!item || typeof item !== 'object') return null;

    const includePayload = options.includePayload === true;
    const summary = {
        deliveryId: item.deliveryId,
        sequence: item.sequence,
        issueKey: item.issueKey,
        mode: item.mode,
        webhookReplayKey: item.webhookReplayKey,
        status: item.status,
        attempts: item.attempts || 0,
        receivedAt: item.receivedAt || null,
        queuedAt: item.queuedAt || null,
        nextAttemptAt: item.nextAttemptAt || null,
        lastAttemptAt: item.lastAttemptAt || null,
        processingStartedAt: item.processingStartedAt || null,
        completedAt: item.completedAt || null,
        deadLetteredAt: item.deadLetteredAt || null,
        replayCount: item.replayCount || 0,
        replayedAt: item.replayedAt || null,
        headers: deepClone(item.headers || {}),
        result: deepClone(item.result || null),
        lastError: deepClone(item.lastError || null),
    };

    if (includePayload) {
        summary.payload = deepClone(item.payload || {});
    }

    return summary;
}

function sanitizeError(error) {
    const message = toTrimmedString(error?.message) || 'Unknown queue processing error';
    return {
        message,
        retryable: error?.retryable !== false,
        code: toTrimmedString(error?.code) || null,
        status: Number.isInteger(error?.status) ? error.status : null,
        timestamp: new Date().toISOString(),
    };
}

class JiraWebhookReliabilityStore {
    constructor(options = {}) {
        this.storePath = resolveStorePath(options.storePath || options.storeFile);
        this.maxQueueSize = parseInteger(options.maxQueueSize, 250, 10, 5000);
        this.maxDeadLetterEntries = parseInteger(options.maxDeadLetterEntries, 200, 10, 5000);
        this.maxRecentEntries = parseInteger(options.maxRecentEntries, 200, 10, 5000);
        this._state = this._load();
    }

    _defaultState() {
        return {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            lifecycle: {
                webhookIds: [],
                updatedAt: null,
                source: null,
                lastSyncAt: null,
                lastSyncStatus: 'never',
                lastSyncTrigger: null,
                lastSyncMessage: null,
                lastSyncDetails: null,
            },
            queue: {
                nextSequence: 1,
                pending: [],
                processing: [],
                deadLetter: [],
                recent: [],
                stats: {
                    enqueued: 0,
                    processed: 0,
                    failed: 0,
                    deadLettered: 0,
                    replayed: 0,
                },
            },
        };
    }

    _load() {
        const fallback = this._defaultState();
        const parsed = readJSONSync(this.storePath, null);
        if (!parsed || typeof parsed !== 'object') {
            return fallback;
        }

        const state = {
            ...fallback,
            ...parsed,
            lifecycle: {
                ...fallback.lifecycle,
                ...(parsed.lifecycle || {}),
            },
            queue: {
                ...fallback.queue,
                ...(parsed.queue || {}),
                stats: {
                    ...fallback.queue.stats,
                    ...(parsed.queue?.stats || {}),
                },
            },
        };

        state.lifecycle.webhookIds = normalizeWebhookIds(state.lifecycle.webhookIds);
        state.queue.nextSequence = Number.isFinite(Number(state.queue.nextSequence))
            ? Math.max(1, Number(state.queue.nextSequence))
            : 1;
        state.queue.pending = Array.isArray(state.queue.pending) ? state.queue.pending : [];
        state.queue.processing = Array.isArray(state.queue.processing) ? state.queue.processing : [];
        state.queue.deadLetter = Array.isArray(state.queue.deadLetter) ? state.queue.deadLetter : [];
        state.queue.recent = Array.isArray(state.queue.recent) ? state.queue.recent : [];

        if (state.queue.processing.length > 0) {
            const now = new Date().toISOString();
            const recovered = state.queue.processing.map(item => ({
                ...item,
                status: 'pending',
                nextAttemptAt: now,
                processingStartedAt: null,
                lastError: item.lastError || {
                    message: 'Recovered from previous server restart while processing webhook delivery.',
                    retryable: true,
                    code: 'recovered-after-restart',
                    status: null,
                    timestamp: now,
                },
            }));

            state.queue.pending = [...recovered, ...state.queue.pending];
            state.queue.processing = [];
        }

        this._trimQueueCollections(state.queue);
        return state;
    }

    _persist() {
        ensureDir(path.dirname(this.storePath));
        this._state.lastUpdated = new Date().toISOString();
        writeJSONSync(this.storePath, this._state);
    }

    _trimQueueCollections(queueState = this._state.queue) {
        if (queueState.deadLetter.length > this.maxDeadLetterEntries) {
            queueState.deadLetter = queueState.deadLetter.slice(0, this.maxDeadLetterEntries);
        }

        if (queueState.recent.length > this.maxRecentEntries) {
            queueState.recent = queueState.recent.slice(0, this.maxRecentEntries);
        }

        if (queueState.pending.length > this.maxQueueSize) {
            queueState.pending = queueState.pending.slice(0, this.maxQueueSize);
        }
    }

    _findDeliveryByReplayKey(replayKey) {
        const normalized = toTrimmedString(replayKey);
        if (!normalized) return null;

        const sources = [
            ...this._state.queue.pending,
            ...this._state.queue.processing,
            ...this._state.queue.deadLetter,
            ...this._state.queue.recent,
        ];

        return sources.find(item => item.webhookReplayKey === normalized) || null;
    }

    getLifecycleState() {
        return deepClone(this._state.lifecycle);
    }

    getPersistedWebhookIds() {
        return [...this._state.lifecycle.webhookIds];
    }

    setPersistedWebhookIds(webhookIds, metadata = {}) {
        const normalized = normalizeWebhookIds(webhookIds);
        this._state.lifecycle.webhookIds = normalized;
        this._state.lifecycle.updatedAt = new Date().toISOString();
        this._state.lifecycle.source = toTrimmedString(metadata.source) || this._state.lifecycle.source;
        this._persist();
        return normalized;
    }

    addPersistedWebhookIds(webhookIds, metadata = {}) {
        const merged = normalizeWebhookIds([
            ...this._state.lifecycle.webhookIds,
            ...normalizeWebhookIds(webhookIds),
        ]);

        this._state.lifecycle.webhookIds = merged;
        this._state.lifecycle.updatedAt = new Date().toISOString();
        this._state.lifecycle.source = toTrimmedString(metadata.source) || this._state.lifecycle.source;
        this._persist();
        return merged;
    }

    removePersistedWebhookIds(webhookIds, metadata = {}) {
        const removeSet = new Set(normalizeWebhookIds(webhookIds));
        this._state.lifecycle.webhookIds = this._state.lifecycle.webhookIds
            .filter(id => !removeSet.has(id));
        this._state.lifecycle.updatedAt = new Date().toISOString();
        this._state.lifecycle.source = toTrimmedString(metadata.source) || this._state.lifecycle.source;
        this._persist();
        return [...this._state.lifecycle.webhookIds];
    }

    recordLifecycleSync(result = {}) {
        const now = new Date().toISOString();

        if (result.persistedWebhookIds !== undefined) {
            this._state.lifecycle.webhookIds = normalizeWebhookIds(result.persistedWebhookIds);
            this._state.lifecycle.updatedAt = now;
        }

        this._state.lifecycle.lastSyncAt = now;
        this._state.lifecycle.lastSyncStatus = toTrimmedString(result.status) || 'ok';
        this._state.lifecycle.lastSyncTrigger = toTrimmedString(result.trigger) || 'manual';
        this._state.lifecycle.lastSyncMessage = toTrimmedString(result.message) || null;
        this._state.lifecycle.lastSyncDetails = deepClone(result.details || null);

        this._persist();
        return this.getLifecycleState();
    }

    enqueueDelivery(delivery = {}) {
        const issueKey = toTrimmedString(delivery.issueKey);
        if (!issueKey) {
            throw createQueueError('Missing issue key for webhook queue delivery.', {
                status: 400,
                retryable: false,
                code: 'missing-issue-key',
            });
        }

        if ((this._state.queue.pending.length + this._state.queue.processing.length) >= this.maxQueueSize) {
            throw createQueueError('Jira webhook queue is full. Increase sdk.webhooks.jira.ingestion.maxQueueSize.', {
                status: 503,
                retryable: true,
                code: 'queue-full',
            });
        }

        const webhookReplayKey = toTrimmedString(delivery.webhookReplayKey);
        if (webhookReplayKey) {
            const existing = this._findDeliveryByReplayKey(webhookReplayKey);
            if (existing) {
                return {
                    duplicate: true,
                    queueDepth: this._state.queue.pending.length,
                    delivery: toPublicDelivery(existing),
                };
            }
        }

        const now = new Date().toISOString();
        const queued = {
            deliveryId: toTrimmedString(delivery.deliveryId) || `whd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            sequence: this._state.queue.nextSequence++,
            issueKey,
            mode: toTrimmedString(delivery.mode) || 'full',
            webhookReplayKey: webhookReplayKey || null,
            receivedAt: toTrimmedString(delivery.receivedAt) || now,
            queuedAt: now,
            nextAttemptAt: now,
            attempts: 0,
            status: 'pending',
            headers: deepClone(delivery.headers || {}),
            payload: deepClone(delivery.payload || {}),
            result: null,
            lastError: null,
            replayCount: 0,
            replayedAt: null,
            processingStartedAt: null,
            completedAt: null,
            deadLetteredAt: null,
            lastAttemptAt: null,
        };

        this._state.queue.pending.push(queued);
        this._state.queue.stats.enqueued += 1;
        this._trimQueueCollections();
        this._persist();

        return {
            duplicate: false,
            queueDepth: this._state.queue.pending.length,
            delivery: toPublicDelivery(queued),
        };
    }

    claimNextDelivery() {
        if (this._state.queue.pending.length === 0) return null;

        const nowMs = Date.now();
        let candidateIndex = -1;
        let candidateSequence = Number.MAX_SAFE_INTEGER;

        for (let index = 0; index < this._state.queue.pending.length; index++) {
            const item = this._state.queue.pending[index];
            const nextAttemptMs = item.nextAttemptAt ? new Date(item.nextAttemptAt).getTime() : 0;
            if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) {
                continue;
            }

            const sequence = Number.isFinite(Number(item.sequence))
                ? Number(item.sequence)
                : Number.MAX_SAFE_INTEGER;
            if (sequence < candidateSequence) {
                candidateIndex = index;
                candidateSequence = sequence;
            }
        }

        if (candidateIndex === -1) return null;

        const now = new Date().toISOString();
        const [item] = this._state.queue.pending.splice(candidateIndex, 1);
        item.status = 'processing';
        item.processingStartedAt = now;
        item.lastAttemptAt = now;
        item.attempts = Number.isFinite(Number(item.attempts))
            ? Number(item.attempts) + 1
            : 1;

        this._state.queue.processing.push(item);
        this._persist();
        return deepClone(item);
    }

    completeDelivery(deliveryId, result = {}) {
        const targetId = toTrimmedString(deliveryId);
        const idx = this._state.queue.processing.findIndex(item => item.deliveryId === targetId);
        if (idx === -1) return null;

        const now = new Date().toISOString();
        const [item] = this._state.queue.processing.splice(idx, 1);
        item.status = 'completed';
        item.completedAt = now;
        item.processingStartedAt = null;
        item.lastError = null;
        item.result = deepClone(result || {});

        this._state.queue.recent.unshift(item);
        this._state.queue.stats.processed += 1;
        this._trimQueueCollections();
        this._persist();

        return toPublicDelivery(item);
    }

    failDelivery(deliveryId, error, options = {}) {
        const targetId = toTrimmedString(deliveryId);
        const idx = this._state.queue.processing.findIndex(item => item.deliveryId === targetId);
        if (idx === -1) {
            return { found: false };
        }

        const [item] = this._state.queue.processing.splice(idx, 1);
        const failure = sanitizeError(error);
        const maxAttempts = parseInteger(options.maxAttempts, 5, 1, 20);
        const retryDelayMs = parseInteger(options.retryDelayMs, 5000, 1000, 600000);

        item.lastError = failure;
        this._state.queue.stats.failed += 1;

        const shouldRetry = failure.retryable && item.attempts < maxAttempts;
        if (shouldRetry) {
            item.status = 'pending';
            item.processingStartedAt = null;
            item.nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
            this._state.queue.pending.push(item);
            this._trimQueueCollections();
            this._persist();
            return {
                found: true,
                requeued: true,
                delivery: toPublicDelivery(item),
                retryDelayMs,
            };
        }

        item.status = 'dead-letter';
        item.processingStartedAt = null;
        item.deadLetteredAt = new Date().toISOString();
        this._state.queue.deadLetter.unshift(item);
        this._state.queue.stats.deadLettered += 1;
        this._trimQueueCollections();
        this._persist();

        return {
            found: true,
            deadLettered: true,
            delivery: toPublicDelivery(item),
        };
    }

    getQueueSnapshot(options = {}) {
        const includePayload = options.includePayload === true;
        const limit = parseInteger(options.limit, 25, 1, 500);

        return {
            counts: {
                pending: this._state.queue.pending.length,
                processing: this._state.queue.processing.length,
                deadLetter: this._state.queue.deadLetter.length,
                recent: this._state.queue.recent.length,
            },
            stats: deepClone(this._state.queue.stats),
            nextPendingAt: this._state.queue.pending.length > 0
                ? this._state.queue.pending
                    .map(item => item.nextAttemptAt || item.queuedAt)
                    .filter(Boolean)
                    .sort()[0] || null
                : null,
            pending: this._state.queue.pending.slice(0, limit).map(item => toPublicDelivery(item, { includePayload })),
            processing: this._state.queue.processing.slice(0, limit).map(item => toPublicDelivery(item, { includePayload })),
            deadLetterPreview: this._state.queue.deadLetter.slice(0, Math.min(limit, 10)).map(item => toPublicDelivery(item, { includePayload })),
            recent: this._state.queue.recent.slice(0, Math.min(limit, 10)).map(item => toPublicDelivery(item, { includePayload })),
        };
    }

    listDeadLetters(options = {}) {
        const includePayload = options.includePayload === true;
        const limit = parseInteger(options.limit, 50, 1, 500);
        const offset = parseInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);

        const entries = this._state.queue.deadLetter.slice(offset, offset + limit)
            .map(item => toPublicDelivery(item, { includePayload }));

        return {
            total: this._state.queue.deadLetter.length,
            offset,
            limit,
            entries,
        };
    }

    replayDeadLetters(options = {}) {
        const replayAll = options.replayAll === true;
        const limit = parseInteger(options.limit, 50, 1, 500);
        const deliveryIds = Array.isArray(options.deliveryIds)
            ? options.deliveryIds.map(item => toTrimmedString(item)).filter(Boolean)
            : [];

        if (!replayAll && deliveryIds.length === 0) {
            throw createQueueError('Missing deliveryIds. Provide deliveryIds[] or set replayAll=true.', {
                status: 400,
                retryable: false,
                code: 'missing-replay-target',
            });
        }

        const selection = [];
        if (replayAll) {
            selection.push(...this._state.queue.deadLetter.slice(0, limit));
        } else {
            const idSet = new Set(deliveryIds);
            for (const item of this._state.queue.deadLetter) {
                if (idSet.has(item.deliveryId)) {
                    selection.push(item);
                }
            }
        }

        if (selection.length === 0) {
            return {
                replayedCount: 0,
                replayedIds: [],
                queueDepth: this._state.queue.pending.length,
            };
        }

        const selectionIds = new Set(selection.map(item => item.deliveryId));
        this._state.queue.deadLetter = this._state.queue.deadLetter
            .filter(item => !selectionIds.has(item.deliveryId));

        const now = new Date().toISOString();
        const replayedIds = [];

        for (const item of selection) {
            item.status = 'pending';
            item.queuedAt = now;
            item.nextAttemptAt = now;
            item.processingStartedAt = null;
            item.completedAt = null;
            item.deadLetteredAt = null;
            item.lastError = null;
            item.result = null;
            item.attempts = 0;
            item.replayCount = Number.isFinite(Number(item.replayCount))
                ? Number(item.replayCount) + 1
                : 1;
            item.replayedAt = now;
            this._state.queue.pending.push(item);
            replayedIds.push(item.deliveryId);
        }

        this._state.queue.stats.replayed += replayedIds.length;
        this._trimQueueCollections();
        this._persist();

        return {
            replayedCount: replayedIds.length,
            replayedIds,
            queueDepth: this._state.queue.pending.length,
        };
    }

    getNextPendingDelayMs() {
        if (this._state.queue.pending.length === 0) {
            return null;
        }

        const nowMs = Date.now();
        let minDelay = Number.POSITIVE_INFINITY;

        for (const item of this._state.queue.pending) {
            const nextAttemptMs = item.nextAttemptAt
                ? new Date(item.nextAttemptAt).getTime()
                : nowMs;
            const delay = Number.isFinite(nextAttemptMs)
                ? Math.max(0, nextAttemptMs - nowMs)
                : 0;
            if (delay < minDelay) minDelay = delay;
        }

        if (!Number.isFinite(minDelay)) {
            return 0;
        }

        return minDelay;
    }
}

async function runJiraWebhookStartupSync(options = {}) {
    const lifecycleService = options.lifecycleService;
    const store = options.store;
    const orchestratorConfig = options.orchestratorConfig || {};
    const trigger = toTrimmedString(options.trigger) || 'startup';

    if (!lifecycleService || typeof lifecycleService.updateOrchestratorConfig !== 'function') {
        throw new Error('Missing lifecycleService for startup webhook sync.');
    }
    if (!store || typeof store.getPersistedWebhookIds !== 'function') {
        throw new Error('Missing reliability store for startup webhook sync.');
    }

    lifecycleService.updateOrchestratorConfig(orchestratorConfig);
    const runtimeConfig = typeof lifecycleService.getRuntimeConfig === 'function'
        ? lifecycleService.getRuntimeConfig()
        : { enabled: false };
    const startupConfig = {
        ...normalizeJiraWebhookStartupSyncConfig(orchestratorConfig),
        ...(options.startupConfig || {}),
    };

    if (startupConfig.enabled !== true) {
        const summary = {
            status: 'skipped',
            trigger,
            action: 'skipped',
            message: 'Lifecycle startup sync disabled by configuration.',
            persistedWebhookIds: store.getPersistedWebhookIds(),
            details: {
                startupSyncEnabled: false,
            },
        };
        store.recordLifecycleSync(summary);
        return summary;
    }

    if (runtimeConfig.enabled !== true) {
        const summary = {
            status: 'skipped',
            trigger,
            action: 'skipped',
            message: 'Lifecycle manager is disabled. Enable sdk.webhooks.jira.lifecycle.enabled to auto-sync webhooks.',
            persistedWebhookIds: store.getPersistedWebhookIds(),
            details: {
                lifecycleEnabled: false,
            },
        };
        store.recordLifecycleSync(summary);
        return summary;
    }

    try {
        let persistedWebhookIds = store.getPersistedWebhookIds();
        let refreshedWebhookIds = [];
        let createdWebhookIds = [];
        const notes = [];
        let action = 'noop';

        if (startupConfig.refreshPersistedIds && persistedWebhookIds.length > 0) {
            try {
                const refreshResult = await lifecycleService.refreshWebhooks({ webhookIds: persistedWebhookIds });
                refreshedWebhookIds = normalizeWebhookIds(refreshResult?.refreshedWebhookIds || persistedWebhookIds);
                if (refreshedWebhookIds.length > 0) {
                    persistedWebhookIds = refreshedWebhookIds;
                    action = 'refreshed';
                }
            } catch (error) {
                notes.push(`refresh failed: ${error.message}`);
                if (!startupConfig.registerIfMissing) {
                    throw error;
                }
                persistedWebhookIds = [];
            }
        }

        if (startupConfig.registerIfMissing && persistedWebhookIds.length === 0) {
            const registerResult = await lifecycleService.registerWebhook({});
            createdWebhookIds = normalizeWebhookIds(registerResult?.createdWebhookIds);
            if (createdWebhookIds.length > 0) {
                persistedWebhookIds = createdWebhookIds;
                action = action === 'refreshed' ? 'refreshed+registered' : 'registered';
            }
        }

        if (action === 'noop' && persistedWebhookIds.length > 0) {
            action = 'retained';
        }

        const messageParts = [];
        if (refreshedWebhookIds.length > 0) {
            messageParts.push(`refreshed ${refreshedWebhookIds.length} webhook ID(s)`);
        }
        if (createdWebhookIds.length > 0) {
            messageParts.push(`registered ${createdWebhookIds.length} webhook ID(s)`);
        }
        if (messageParts.length === 0) {
            messageParts.push('no webhook lifecycle changes were required');
        }
        if (notes.length > 0) {
            messageParts.push(...notes);
        }

        const summary = {
            status: 'ok',
            trigger,
            action,
            message: messageParts.join('; '),
            persistedWebhookIds,
            details: {
                refreshedWebhookIds,
                createdWebhookIds,
                startupConfig,
            },
        };

        store.recordLifecycleSync(summary);
        return summary;
    } catch (error) {
        store.recordLifecycleSync({
            status: 'failed',
            trigger,
            action: 'failed',
            message: error?.message || 'Lifecycle startup sync failed',
            persistedWebhookIds: store.getPersistedWebhookIds(),
            details: {
                startupConfig,
                error: error?.message || String(error),
            },
        });
        throw error;
    }
}

module.exports = {
    JiraWebhookReliabilityStore,
    normalizeJiraWebhookIngestionConfig,
    normalizeJiraWebhookStartupSyncConfig,
    runJiraWebhookStartupSync,
    createQueueError,
};
