/**
 * Server Utilities — Response helpers, webhook logic, report classification,
 * evidence summaries, and shared helpers for the SDK pipeline server.
 * Extracted from server.js for reuse and maintainability.
 * @module sdk-orchestrator/server-utils
 */

const path = require('path');
const crypto = require('crypto');
const { BLOCKED_PATHS } = require('./filesystem-tools');
const { isGeneratedArtifactPath } = require('./generated-artifact-policy');
const { isValidMode } = require('./utils');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CUSTOM_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;
const FRAMEWORK_MODES = new Set(['existing', 'manual']);

// ─── JSON Response Helpers ──────────────────────────────────────────────────

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
}

function accepted(res, data) { json(res, 202, data); }
function ok(res, data) { json(res, 200, data); }
function badRequest(res, msg) { json(res, 400, { error: msg }); }
function notFound(res, msg) { json(res, 404, { error: msg || 'Not found' }); }
function conflict(res, msg) { json(res, 409, { error: msg }); }

function respondChatError(res, error, fallbackStatus = 500) {
    const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
    const payload = { error: error?.message || 'Unknown chat error' };
    if (error?.code) payload.code = error.code;
    if (error?.runtimeState) payload.runtimeState = error.runtimeState;
    if (typeof error?.recoverable === 'boolean') payload.recoverable = error.recoverable;
    json(res, status, payload);
}

function respondLifecycleError(res, error, fallbackStatus = 500) {
    const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
    const payload = { error: error?.message || 'Jira webhook lifecycle request failed' };
    if (error?.details !== undefined) payload.details = error.details;
    json(res, status, payload);
}

function respondWebhookQueueError(res, error, fallbackStatus = 500) {
    const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
    const payload = { error: error?.message || 'Jira webhook queue request failed' };
    if (error?.code) payload.code = error.code;
    if (typeof error?.retryable === 'boolean') payload.retryable = error.retryable;
    if (error?.details !== undefined) payload.details = error.details;
    json(res, status, payload);
}

// ─── Config / Input Normalization ───────────────────────────────────────────

function normalizeWebhookStatusFilters(value) {
    if (Array.isArray(value)) {
        return value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function resolveJiraWebhookRuntimeConfig(orchestratorConfig = {}) {
    const configured = orchestratorConfig?.sdk?.webhooks?.jira || {};
    const triggerStatuses = normalizeWebhookStatusFilters(configured.triggerOnStatus);

    return {
        enabled: configured.enabled === true,
        defaultMode: isValidMode(configured.defaultMode) ? configured.defaultMode : 'full',
        triggerStatuses: triggerStatuses.length > 0
            ? triggerStatuses
            : ['Ready for QA', 'Ready for Testing', 'QA'],
        secretEnv: typeof configured.secretEnv === 'string' && configured.secretEnv.trim()
            ? configured.secretEnv.trim()
            : 'JIRA_WEBHOOK_SECRET',
    };
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOptionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function isValidCustomRunId(runId) {
    return typeof runId === 'string' && CUSTOM_RUN_ID_PATTERN.test(runId);
}

function normalizeHybridRunInput(body = {}) {
    const frameworkModeInput = normalizeOptionalString(body.frameworkMode);
    const frameworkMode = (frameworkModeInput || 'existing').toLowerCase();

    if (!FRAMEWORK_MODES.has(frameworkMode)) {
        return {
            error: `Invalid frameworkMode: "${body.frameworkMode}". Use: existing, manual`,
            hybridContext: null,
        };
    }

    let testDataOverride = body.testDataOverride;
    if (typeof testDataOverride === 'string') {
        const trimmed = testDataOverride.trim();
        if (!trimmed) {
            testDataOverride = null;
        } else {
            try { testDataOverride = JSON.parse(trimmed); } catch { testDataOverride = trimmed; }
        }
    } else if (testDataOverride === undefined) {
        testDataOverride = null;
    }

    const hybridContext = {
        frameworkMode,
        appUrl: normalizeOptionalString(body.appUrl),
        testCaseSource: normalizeOptionalString(body.testCaseSource),
        testDataOverride,
        executionTarget: normalizeOptionalString(body.executionTarget),
        requestedTicketId: normalizeOptionalString(body.ticketId),
        requestedRunId: normalizeOptionalString(body.runId),
    };

    if (frameworkMode === 'manual' && !hybridContext.appUrl) {
        return { error: 'appUrl is required when frameworkMode is "manual"', hybridContext: null };
    }

    if (frameworkMode === 'manual' && !hybridContext.testCaseSource) {
        return { error: 'testCaseSource is required when frameworkMode is "manual"', hybridContext: null };
    }

    return { error: null, hybridContext };
}

function resolveChatVideoRetentionConfig(orchestratorConfig = {}) {
    const configured = orchestratorConfig?.chatEvidence?.video || {};
    const unclaimedTtlMs = parsePositiveInteger(
        process.env.CHAT_VIDEO_UNCLAIMED_TTL_MS || configured.unclaimedTtlMs,
        10 * 60 * 1000
    );
    const claimedMaxAgeMs = parsePositiveInteger(
        process.env.CHAT_VIDEO_CLAIMED_MAX_AGE_MS || configured.claimedMaxAgeMs,
        24 * 60 * 60 * 1000
    );
    const cleanupIntervalMs = parsePositiveInteger(
        process.env.CHAT_VIDEO_CLEANUP_INTERVAL_MS || configured.cleanupIntervalMs,
        60 * 1000
    );

    return {
        unclaimedTtlMs,
        claimedMaxAgeMs: Math.max(claimedMaxAgeMs, unclaimedTtlMs),
        cleanupIntervalMs,
    };
}

// ─── Jira Webhook Security ─────────────────────────────────────────────────

function parseJiraWebhookSignature(signatureHeader) {
    if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) return null;

    const value = signatureHeader.trim();
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;

    const method = value.slice(0, separatorIndex).trim().toLowerCase();
    const digest = value.slice(separatorIndex + 1).trim().toLowerCase();

    if (!method || !digest) return null;
    if (!/^[a-z0-9-]+$/i.test(method)) return null;
    if (!/^[a-f0-9]+$/i.test(digest) || digest.length % 2 !== 0) return null;

    return { method, digest };
}

function verifyJiraWebhookSignature(rawBody, signatureHeader, secret) {
    if (typeof secret !== 'string' || !secret.trim()) {
        return { ok: false, reason: 'missing-secret' };
    }

    const parsed = parseJiraWebhookSignature(signatureHeader);
    if (!parsed) {
        return { ok: false, reason: 'missing-signature' };
    }

    let expectedDigest;
    try {
        expectedDigest = crypto
            .createHmac(parsed.method, secret)
            .update(typeof rawBody === 'string' ? rawBody : '', 'utf8')
            .digest('hex');
    } catch {
        return { ok: false, reason: 'unsupported-method' };
    }

    const expected = Buffer.from(expectedDigest, 'hex');
    const actual = Buffer.from(parsed.digest, 'hex');

    if (expected.length === 0 || actual.length === 0 || expected.length !== actual.length) {
        return { ok: false, reason: 'mismatch' };
    }

    const signatureMatches = crypto.timingSafeEqual(expected, actual);
    return {
        ok: signatureMatches,
        reason: signatureMatches ? null : 'mismatch',
        method: parsed.method,
    };
}

function buildJiraWebhookReplayKey(payload, headers = {}) {
    const identifierHeader = headers['x-atlassian-webhook-identifier'];
    if (typeof identifierHeader === 'string' && identifierHeader.trim()) {
        return `id:${identifierHeader.trim()}`;
    }

    const issueKey = payload?.issue?.key || 'unknown';
    const webhookEvent = payload?.webhookEvent || 'unknown';
    const timestamp = payload?.timestamp || 'unknown';
    const changelogId = payload?.changelog?.id || 'none';

    return `fallback:${issueKey}:${webhookEvent}:${timestamp}:${changelogId}`;
}

function pruneJiraWebhookReplayCache(cache, now, ttlMs) {
    for (const [key, seenAt] of cache.entries()) {
        if ((now - seenAt) > ttlMs) {
            cache.delete(key);
        }
    }
}

// ─── Summary Builders ───────────────────────────────────────────────────────

function buildObservationSummary(run, observations, observationLogPath, options = {}) {
    const limit = options.limit || 50;
    const severityCounts = {};
    const typeCounts = {};
    const stageCounts = {};

    for (const observation of observations) {
        const severity = observation.severity || 'info';
        const type = observation.type || 'observation';
        const stage = observation.stage || 'unknown';

        severityCounts[severity] = (severityCounts[severity] || 0) + 1;
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }

    const recent = observations.slice(-limit).reverse();
    const screenshots = observations
        .filter(observation => observation.screenshotPath)
        .slice(-limit)
        .reverse();
    const latest = recent[0] || null;

    return {
        runId: run.runId,
        ticketId: run.ticketId,
        status: run.status,
        mode: run.mode,
        startedAt: run.startedAt || null,
        completedAt: run.completedAt || null,
        observationLogPath,
        summary: {
            total: observations.length,
            withScreenshots: observations.filter(observation => observation.screenshotPath).length,
            bySeverity: severityCounts,
            byType: typeCounts,
            byStage: stageCounts,
            latestTimestamp: latest?.timestamp || null,
        },
        latest,
        recent,
        screenshots,
        mission: {
            checkpoint: run.mission?.currentCheckpoint || null,
            evidence: run.mission?.evidence || {},
        },
    };
}

// ─── Collection Helpers ─────────────────────────────────────────────────────

function _toArray(value) {
    return Array.isArray(value) ? value : [];
}

function _dedupeBy(items, keySelector) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = keySelector(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

function _sortByTimestampDesc(items, selector) {
    return [...items].sort((a, b) => {
        const aTime = new Date(selector(a) || 0).getTime();
        const bTime = new Date(selector(b) || 0).getTime();
        return bTime - aTime;
    });
}

// ─── Path / MIME Helpers ────────────────────────────────────────────────────

function _normalizePathForComparison(value) {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}

function _isPathInside(parentPath, candidatePath) {
    const relativePath = path.relative(parentPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function _isAllowedArtifactPath(filePath, config = {}) {
    if (!filePath || typeof filePath !== 'string') return false;

    const resolved = path.resolve(filePath);
    const normalized = _normalizePathForComparison(resolved);

    for (const blocked of BLOCKED_PATHS) {
        if (normalized.startsWith(blocked) || normalized === blocked) {
            return false;
        }
    }

    return isGeneratedArtifactPath(resolved, { projectRoot: PROJECT_ROOT, config });
}

function _getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.json': 'application/json; charset=utf-8',
        '.log': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8',
        '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
        '.csv': 'text/csv; charset=utf-8',
        '.zip': 'application/zip', '.gz': 'application/gzip',
        '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8',
    };
    return map[ext] || 'application/octet-stream';
}

// ─── Evidence Summary ───────────────────────────────────────────────────────

function buildEvidenceSummary(run, manifest, scenarioManifests, options = {}) {
    const limit = options.limit || 20;
    const scenarioStatusMap = new Map(
        _toArray(run.mission?.scenarios).map(scenario => [scenario.id, scenario])
    );
    const scenarioResultMap = new Map(
        _toArray(run.mission?.result?.scenarioResults).map(result => [result.scenarioId, result])
    );

    const scenarioCards = scenarioManifests.map(entry => {
        const scenarioState = scenarioStatusMap.get(entry.scenarioId) || {};
        const scenarioResult = scenarioResultMap.get(entry.scenarioId) || {};
        const scenarioManifest = entry.manifest || {};
        const scenarioArtifacts = _toArray(scenarioManifest.artifacts);
        const scenarioObservations = _sortByTimestampDesc(
            _toArray(scenarioManifest.observations),
            observation => observation.timestamp
        );

        return {
            scenarioId: entry.scenarioId,
            name: scenarioManifest.scenario?.name || scenarioState.name || entry.scenarioId,
            authState: entry.authState || scenarioManifest.scenario?.authState || scenarioState.authState || null,
            status: scenarioResult.success === true ? 'completed'
                : scenarioResult.success === false ? 'failed'
                    : scenarioState.status || 'unknown',
            success: scenarioResult.success ?? null,
            startedAt: scenarioState.startedAt || null,
            completedAt: scenarioState.completedAt || null,
            manifestPath: entry.manifestPath,
            reportPath: entry.reportPath || scenarioManifest.pipeline?.reportPath || null,
            rawResultsPath: entry.rawResultsPath || scenarioManifest.pipeline?.rawResultsPath || null,
            specPath: scenarioManifest.pipeline?.specPath || null,
            explorationPath: scenarioManifest.pipeline?.explorationPath || null,
            evidenceRoot: scenarioManifest.pipeline?.evidenceRoot || null,
            summary: {
                totalArtifacts: scenarioManifest.summary?.totalArtifacts || 0,
                screenshots: scenarioManifest.summary?.screenshots || 0,
                videos: scenarioManifest.summary?.videos || 0,
                traces: scenarioManifest.summary?.traces || 0,
                observations: scenarioManifest.summary?.observations || 0,
                failedTests: scenarioManifest.summary?.failedTests || 0,
                passedTests: scenarioManifest.summary?.passedTests || 0,
            },
            observations: scenarioObservations.slice(0, limit),
            screenshots: scenarioArtifacts.filter(artifact => artifact.kind === 'screenshot').slice(0, limit),
            downloads: _dedupeBy([
                ...scenarioArtifacts,
                { kind: 'manifest', label: `${entry.scenarioId} manifest`, path: entry.manifestPath },
                entry.reportPath ? { kind: 'report', label: `${entry.scenarioId} report`, path: entry.reportPath } : null,
                entry.rawResultsPath ? { kind: 'report', label: `${entry.scenarioId} raw results`, path: entry.rawResultsPath } : null,
            ].filter(Boolean), artifact => artifact.path),
        };
    });

    const parentArtifacts = _toArray(manifest?.artifacts);
    const allArtifacts = _dedupeBy([
        ...parentArtifacts,
        ...scenarioCards.flatMap(card => card.downloads),
    ], artifact => artifact.path);
    const allObservations = _sortByTimestampDesc(
        _dedupeBy([
            ..._toArray(manifest?.observations),
            ...scenarioCards.flatMap(card => card.observations),
        ], observation => observation.id || `${observation.timestamp}:${observation.message}`),
        observation => observation.timestamp
    );
    const latestScreenshots = _sortByTimestampDesc(
        allArtifacts.filter(artifact => artifact.kind === 'screenshot'),
        artifact => artifact.modifiedAt
    ).slice(0, limit);

    const counts = {
        totalArtifacts: allArtifacts.length,
        screenshots: allArtifacts.filter(artifact => artifact.kind === 'screenshot').length,
        videos: allArtifacts.filter(artifact => artifact.kind === 'video').length,
        traces: allArtifacts.filter(artifact => artifact.kind === 'trace').length,
        logs: allArtifacts.filter(artifact => artifact.kind === 'log').length,
        reports: allArtifacts.filter(artifact => artifact.kind === 'report' || artifact.kind === 'manifest').length,
        observations: allObservations.length,
        failedTests: scenarioCards.reduce((sum, card) => sum + (card.summary.failedTests || 0), 0),
        passedTests: scenarioCards.reduce((sum, card) => sum + (card.summary.passedTests || 0), 0),
    };

    return {
        runId: run.runId,
        ticketId: run.ticketId,
        mode: run.mode,
        status: run.status,
        startedAt: run.startedAt || null,
        completedAt: run.completedAt || null,
        mission: {
            missionId: run.mission?.missionId || null,
            objective: run.mission?.objective || run.ticketId,
            scenarioCount: scenarioCards.length,
            passedScenarios: scenarioCards.filter(card => card.success === true).length,
            failedScenarios: scenarioCards.filter(card => card.success === false).length,
            latestCheckpoint: run.mission?.checkpoint || null,
        },
        summary: counts,
        scenarios: scenarioCards,
        latestObservations: allObservations.slice(0, limit),
        latestScreenshots,
        downloads: allArtifacts.slice(0, Math.max(limit * 3, 20)),
        parentManifest: manifest ? {
            manifestPath: run.artifacts?.evidenceManifest || run.mission?.evidence?.manifestPath || null,
            summary: manifest.summary || null,
            reportPath: manifest.pipeline?.reportPath || null,
            rawResultsPath: manifest.pipeline?.rawResultsPath || null,
        } : null,
    };
}

// ─── App Name Mapping ───────────────────────────────────────────────────────

function getAppNameForExtension(ext) {
    const map = {
        '.xlsx': 'Microsoft Excel', '.xls': 'Microsoft Excel', '.csv': 'Microsoft Excel',
        '.docx': 'Microsoft Word', '.doc': 'Microsoft Word',
        '.pptx': 'Microsoft PowerPoint', '.ppt': 'Microsoft PowerPoint',
        '.pdf': 'PDF Viewer',
        '.html': 'Default Browser', '.htm': 'Default Browser',
        '.png': 'Image Viewer', '.jpg': 'Image Viewer', '.jpeg': 'Image Viewer',
        '.gif': 'Image Viewer', '.webp': 'Image Viewer', '.svg': 'Image Viewer',
        '.mp4': 'Video Player', '.mkv': 'Video Player', '.avi': 'Video Player',
        '.mov': 'Video Player', '.wmv': 'Video Player', '.webm': 'Video Player',
        '.mp3': 'Audio Player', '.wav': 'Audio Player', '.flac': 'Audio Player',
        '.txt': 'Text Editor', '.md': 'Text Editor', '.log': 'Text Editor',
        '.json': 'Text Editor', '.xml': 'Text Editor',
        '.js': 'Code Editor', '.ts': 'Code Editor', '.py': 'Code Editor',
        '.zip': 'Archive Manager', '.rar': 'Archive Manager', '.7z': 'Archive Manager',
    };
    return map[ext] || 'Default Application';
}

// ─── Report Classification ──────────────────────────────────────────────────

const BROKEN_PATTERNS = [
    /beforeAll/i, /beforeEach/i, /afterAll/i, /afterEach/i,
    /timeout/i, /ECONNREFUSED/i, /Navigation failed/i,
    /Protocol error/i, /Target closed/i, /net::ERR_/i,
    /browser\.close/i, /context\.close/i, /page\.close/i,
    /Session closed/i, /Execution context was destroyed/i,
];

function isBrokenError(errorMsg) {
    if (!errorMsg) return false;
    return BROKEN_PATTERNS.some(p => p.test(errorMsg));
}

function classifySpec(spec) {
    const test = spec.tests?.[0] || {};
    const results = test.results || [];
    const lastResult = results[results.length - 1] || {};
    const retries = Math.max((results.length || 1) - 1, 0);
    const isFailed = test.status === 'failed' || test.status === 'unexpected';
    const isPassed = test.status === 'passed' || test.status === 'expected';
    const isSkipped = test.status === 'skipped';
    const errorMsg = lastResult.error?.message || '';
    const isFlaky = isPassed && retries > 0 && results.slice(0, -1).some(r => r.error);
    const isBroken = isFailed && isBrokenError(errorMsg);

    let status;
    if (isPassed) status = 'passed';
    else if (isSkipped) status = 'skipped';
    else if (isBroken) status = 'broken';
    else if (isFailed) status = 'failed';
    else status = 'unknown';

    return { status, retries, isFlaky, isBroken, lastResult, test };
}

function transformSuites(suiteList, opts = {}) {
    const stats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0, flaky: 0, retried: 0, totalDuration: 0 };

    function walk(list) {
        return list.map(suite => {
            const specs = (suite.specs || []).map(spec => {
                const cls = classifySpec(spec);
                stats.total++;
                if (cls.status === 'passed') stats.passed++;
                else if (cls.status === 'broken') stats.broken++;
                else if (cls.status === 'failed') stats.failed++;
                else if (cls.status === 'skipped') stats.skipped++;
                if (cls.isFlaky) stats.flaky++;
                if (cls.retries > 0) stats.retried++;
                for (const r of (cls.test?.results || [])) {
                    stats.totalDuration += r.duration || 0;
                }

                const specNode = {
                    title: spec.title,
                    status: cls.status,
                    isBroken: cls.isBroken,
                    isFlaky: cls.isFlaky,
                    duration: cls.lastResult.duration || 0,
                    retries: cls.retries,
                    error: cls.lastResult.error ? {
                        message: cls.lastResult.error.message || '',
                        stack: cls.lastResult.error.stack || '',
                        snippet: cls.lastResult.error.snippet || '',
                    } : null,
                    steps: (cls.lastResult.steps || []).map(s => ({
                        title: s.title,
                        duration: s.duration || 0,
                        error: s.error?.message || null,
                    })),
                };

                if (opts.includeAttachments) {
                    specNode.attachments = (cls.lastResult.attachments || []).map(a => ({
                        name: a.name,
                        contentType: a.contentType,
                        path: a.path || null,
                    }));
                }

                return specNode;
            });

            const children = suite.suites ? walk(suite.suites) : [];
            const node = { title: suite.title, file: suite.file || null, specs, suites: children };
            if (opts.ticketId) node.ticketId = opts.ticketId;
            return node;
        });
    }

    const suites = walk(suiteList);
    return { suites, stats };
}

function normalizePlaywrightErrors(errorList, context = {}) {
    if (!Array.isArray(errorList)) return [];
    return errorList
        .map((error, index) => {
            const message = (error && typeof error === 'object')
                ? (error.message || '')
                : String(error || '');
            if (!message) return null;
            return {
                message,
                stack: (error && typeof error === 'object' && error.stack) ? error.stack : '',
                snippet: (error && typeof error === 'object' && error.snippet) ? error.snippet : '',
                ticketId: context.ticketId || null,
                runId: context.runId || null,
                specPath: context.specPath || null,
                timestamp: context.timestamp || null,
                index,
            };
        })
        .filter(Boolean);
}

function buildRunnerErrorSuite(ticketId, specPath, runnerErrors) {
    if (!Array.isArray(runnerErrors) || runnerErrors.length === 0) return null;
    const safeTicketId = ticketId || 'UNKNOWN';
    return {
        title: `${safeTicketId} - Runner Errors`,
        file: specPath || null,
        ticketId: safeTicketId,
        specs: runnerErrors.map((error, index) => ({
            title: `Runner Error ${index + 1}`,
            status: 'broken',
            isBroken: true,
            isFlaky: false,
            duration: 0,
            retries: 0,
            error: {
                message: error.message,
                stack: error.stack || '',
                snippet: error.snippet || '',
            },
            steps: [],
        })),
        suites: [],
    };
}

module.exports = {
    PROJECT_ROOT,
    CUSTOM_RUN_ID_PATTERN,
    FRAMEWORK_MODES,
    // Response helpers
    json,
    accepted,
    ok,
    badRequest,
    notFound,
    conflict,
    respondChatError,
    respondLifecycleError,
    respondWebhookQueueError,
    // Config / input normalization
    normalizeWebhookStatusFilters,
    resolveJiraWebhookRuntimeConfig,
    parsePositiveInteger,
    normalizeOptionalString,
    isValidCustomRunId,
    normalizeHybridRunInput,
    resolveChatVideoRetentionConfig,
    // Webhook security
    parseJiraWebhookSignature,
    verifyJiraWebhookSignature,
    buildJiraWebhookReplayKey,
    pruneJiraWebhookReplayCache,
    // Summary builders
    buildObservationSummary,
    buildEvidenceSummary,
    // Collection helpers
    _toArray,
    _dedupeBy,
    _sortByTimestampDesc,
    // Path / MIME helpers
    _normalizePathForComparison,
    _isPathInside,
    _isAllowedArtifactPath,
    _getMimeType,
    // App name
    getAppNameForExtension,
    // Report classification
    BROKEN_PATTERNS,
    isBrokenError,
    classifySpec,
    transformSuites,
    normalizePlaywrightErrors,
    buildRunnerErrorSuite,
};
