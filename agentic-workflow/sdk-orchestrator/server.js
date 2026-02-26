/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK PIPELINE SERVER — HTTP + SSE API for QA Automation Platform
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Exposes the SDK Orchestrator as a headless HTTP service. Enables:
 *
 *   - Pipeline triggering via REST API
 *   - Real-time progress streaming via SSE
 *   - Run history and analytics
 *   - Jira webhook auto-trigger
 *   - Batch/sprint processing
 *   - Health and readiness checks
 *
 * Architecture:
 *   Raw Node.js HTTP server wrapping SDKOrchestrator as a singleton.
 *   Each POST /run creates a pipeline invocation tracked in RunStore.
 *   EventBridge pipes progress to SSE clients in real-time.
 *
 * Start:
 *   node sdk-orchestrator/cli.js --server [--port 3100]
 *   npm run sdk:server
 *
 * @module sdk-orchestrator/server
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const fs = require('fs');
const fsP = fs.promises;
const path = require('path');
// NOTE: SDKOrchestrator is lazy-required inside startServer() to avoid
// circular dependency with index.js which re-exports startServer.
const { RunStore, RUN_STATUS } = require('./run-store');
const { EventBridge, EVENT_TYPES, getEventBridge } = require('./event-bridge');
const { LearningStore } = require('./learning-store');
const { ChatSessionManager, CHAT_EVENTS } = require('./chat-session-manager');
const { getFollowupProvider } = require('./followup-provider');
const {
    loadEnv, isValidTicketId, isValidMode, generateBatchId, truncate,
} = require('./utils');

// ─── Lightweight HTTP Router ────────────────────────────────────────────────

/**
 * Minimal router using Node.js built-in http module.
 * No Express dependency required — keeps the install lightweight.
 */
class Router {
    constructor() {
        this._routes = [];
        this._corsOrigins = ['*'];
    }

    setCorsOrigins(origins) {
        this._corsOrigins = origins;
    }

    get(pattern, handler) { this._routes.push({ method: 'GET', pattern, handler }); }
    post(pattern, handler) { this._routes.push({ method: 'POST', pattern, handler }); }
    delete(pattern, handler) { this._routes.push({ method: 'DELETE', pattern, handler }); }

    /**
     * Match a request to a route. Supports :param path segments.
     */
    _match(method, url) {
        const pathname = url.split('?')[0];
        for (const route of this._routes) {
            if (route.method !== method) continue;

            const routeParts = route.pattern.split('/');
            const urlParts = pathname.split('/');

            if (routeParts.length !== urlParts.length) continue;

            const params = {};
            let match = true;
            for (let i = 0; i < routeParts.length; i++) {
                if (routeParts[i].startsWith(':')) {
                    params[routeParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
                } else if (routeParts[i] !== urlParts[i]) {
                    match = false;
                    break;
                }
            }

            if (match) return { handler: route.handler, params };
        }
        return null;
    }

    /**
     * Parse query string from URL.
     */
    _parseQuery(url) {
        const idx = url.indexOf('?');
        if (idx === -1) return {};
        const qs = url.slice(idx + 1);
        const params = {};
        for (const pair of qs.split('&')) {
            const [key, val] = pair.split('=');
            if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
        }
        return params;
    }

    /**
     * Read JSON body from request.
     * Default 1 MB limit; callers can override (e.g. 10 MB for image attachments).
     */
    _readBody(req, maxBytes = 1024 * 1024) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on('data', chunk => {
                size += chunk.length;
                if (size > maxBytes) {
                    req.destroy();
                    return reject(new Error('Request body too large'));
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                if (!raw) return resolve({});
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error('Invalid JSON body'));
                }
            });
            req.on('error', reject);
        });
    }

    /**
     * Handle an incoming HTTP request.
     */
    async handle(req, res) {
        // CORS headers
        const origin = req.headers.origin || '*';
        const allowedOrigin = this._corsOrigins.includes('*') || this._corsOrigins.includes(origin)
            ? origin : this._corsOrigins[0];
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const route = this._match(req.method, req.url);
        if (!route) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        try {
            const query = this._parseQuery(req.url);
            // Use higher body limit for chat message endpoint (supports base64 image attachments)
            const isImageRoute = req.url.includes('/messages');
            const maxBodyBytes = isImageRoute ? 10 * 1024 * 1024 : 1024 * 1024;
            const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
                ? await this._readBody(req, maxBodyBytes)
                : {};

            req.params = route.params;
            req.query = query;
            req.body = body;

            await route.handler(req, res);
        } catch (error) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        }
    }
}

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

// ─── Report Classification Helpers (hoisted — no closure deps) ──────────────

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

/**
 * transformSuites — Unified recursive suite walker.
 * Returns { suites, stats } where stats contains aggregate counts.
 *
 * @param {Array} suiteList       - Raw Playwright suite array
 * @param {Object} [opts]
 * @param {string} [opts.ticketId]          - Attach ticketId to each suite node
 * @param {boolean} [opts.includeAttachments] - Include attachment metadata on specs
 * @returns {{ suites: Array, stats: { total, passed, failed, broken, skipped, flaky, retried, totalDuration } }}
 */
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

// ─── Server Factory ─────────────────────────────────────────────────────────

/**
 * Start the pipeline HTTP server.
 *
 * @param {Object} [options]
 * @param {number} [options.port=3100]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<http.Server>}
 */
async function startServer(options = {}) {
    loadEnv();

    const port = options.port || parseInt(process.env.SERVER_PORT, 10) || 3100;
    const verbose = options.verbose || false;

    // ─── Initialize Core Services ───────────────────────────────────
    const runStore = new RunStore();
    const eventBridge = getEventBridge();
    const learningStore = new LearningStore();

    // Lazy-require to break circular dependency (index.js re-exports startServer)
    const { SDKOrchestrator } = require('./index');

    // Initialize SDK Orchestrator (singleton)
    const orchestrator = new SDKOrchestrator({ verbose });
    let orchestratorReady = false;

    // Chat session manager — initialized after orchestrator starts
    let chatManager = null;

    // Start orchestrator in background — don't block server startup
    orchestrator.start()
        .then(async () => {
            orchestratorReady = true;
            log('SDK Orchestrator ready');

            // Initialize chat manager with the live SDK client
            try {
                const sdk = await import('@github/copilot-sdk');
                chatManager = new ChatSessionManager({
                    client: orchestrator.client,
                    defineTool: sdk.defineTool,
                    model: orchestrator.options.model,
                    config: orchestrator.config,
                    learningStore,
                });
                log('Chat Session Manager ready');
            } catch (err) {
                log(`Chat Manager init failed: ${err.message}`, 'warn');
            }
        })
        .catch(err => {
            log(`SDK Orchestrator failed to start: ${err.message}`, 'error');
        });

    const router = new Router();

    // Parse CORS origins
    const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
    router.setCorsOrigins(corsOrigins);

    // ─── Active Pipeline Tracking ───────────────────────────────────
    // Map of runId → { cancel: Function }
    const activePipelines = new Map();

    // ─── Stale Run Watchdog ─────────────────────────────────────────
    // Every 5 minutes, check for runs stuck in running/queued that have no
    // active in-memory pipeline handle (i.e., orphaned after crash/restart).
    const STALE_RUN_CHECK_INTERVAL = 5 * 60 * 1000;   // 5 minutes
    const STALE_RUN_TIMEOUT = 60 * 60 * 1000;          // 60 minutes

    const staleRunWatchdog = setInterval(() => {
        const staleRuns = runStore.getStaleRuns(STALE_RUN_TIMEOUT);
        for (const run of staleRuns) {
            // Only auto-fail if there is no active in-memory pipeline for this run
            if (!activePipelines.has(run.runId)) {
                log(`Watchdog: Auto-failing stale run ${run.runId} (${run.ticketId}) — no progress for >60 min`, 'warn');
                runStore.forceCancelRun(run.runId, 'Pipeline timed out — no progress for 60 minutes');
                eventBridge.push(EVENT_TYPES.RUN_COMPLETE, run.runId, {
                    ticketId: run.ticketId,
                    success: false,
                    error: 'Pipeline timed out — no progress for 60 minutes',
                });
            }
        }
    }, STALE_RUN_CHECK_INTERVAL);

    // ═════════════════════════════════════════════════════════════════
    // HEALTH & READINESS
    // ═════════════════════════════════════════════════════════════════

    router.get('/health', (req, res) => {
        ok(res, {
            status: 'ok',
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    });

    router.get('/ready', (req, res) => {
        ok(res, {
            ready: orchestratorReady,
            orchestrator: orchestratorReady ? 'started' : 'starting',
            runStore: 'ok',
            eventBridge: 'ok',
            timestamp: new Date().toISOString(),
        });
    });

    // ═════════════════════════════════════════════════════════════════
    // PIPELINE EXECUTION
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/pipeline/run
     * Body: { ticketId, mode?, environment?, model?, triggeredBy? }
     * Returns: { runId, status }
     */
    router.post('/api/pipeline/run', (req, res) => {
        const { ticketId, mode, environment, model, triggeredBy } = req.body;

        if (!ticketId || !isValidTicketId(ticketId)) {
            return badRequest(res, `Invalid or missing ticketId: "${ticketId}"`);
        }
        if (mode && !isValidMode(mode)) {
            return badRequest(res, `Invalid mode: "${mode}". Use: full, testcase, generate, heal, execute`);
        }
        if (!orchestratorReady) {
            return json(res, 503, { error: 'SDK Orchestrator not ready yet. Try again shortly.' });
        }

        // Dedup — prevent duplicate runs
        const activeRun = runStore.getActiveRun(ticketId);
        if (activeRun) {
            return conflict(res, `Pipeline already running for ${ticketId} (runId: ${activeRun.runId})`);
        }

        // Create run record
        const run = runStore.createRun({
            ticketId,
            mode: mode || 'full',
            environment: environment || 'UAT',
            triggeredBy: triggeredBy || 'api',
        });

        // Start pipeline in background (non-blocking)
        _executePipeline(run.runId, ticketId, mode || 'full', orchestrator, runStore, eventBridge, activePipelines, model);

        accepted(res, { runId: run.runId, status: run.status, ticketId });
    });

    /**
     * POST /api/pipeline/batch
     * Body: { ticketIds: [...], mode?, environment?, triggeredBy? }
     * Returns: { batchId, runs: [...] }
     */
    router.post('/api/pipeline/batch', (req, res) => {
        const { ticketIds, sprintId, mode, environment, triggeredBy } = req.body;

        const ids = Array.isArray(ticketIds) ? ticketIds : [];
        if (ids.length === 0) {
            return badRequest(res, 'ticketIds array is required and must be non-empty');
        }

        const invalid = ids.filter(id => !isValidTicketId(id));
        if (invalid.length > 0) {
            return badRequest(res, `Invalid ticket IDs: ${invalid.join(', ')}`);
        }
        if (!orchestratorReady) {
            return json(res, 503, { error: 'SDK Orchestrator not ready yet' });
        }

        const { batchId, runs } = runStore.createBatch(ids, {
            mode: mode || 'full',
            environment: environment || 'UAT',
            triggeredBy: triggeredBy || 'api',
        });

        // Start all pipelines (respects concurrency limit from config)
        for (const run of runs) {
            _executePipeline(
                run.runId, run.ticketId, run.mode,
                orchestrator, runStore, eventBridge, activePipelines
            );
        }

        accepted(res, {
            batchId,
            total: runs.length,
            runs: runs.map(r => ({ runId: r.runId, ticketId: r.ticketId, status: r.status })),
        });
    });

    /**
     * POST /api/pipeline/cancel/:runId
     */
    router.post('/api/pipeline/cancel/:runId', (req, res) => {
        const { runId } = req.params;

        const cancelled = runStore.cancelRun(runId);
        if (!cancelled) {
            return notFound(res, `Run ${runId} not found or already terminal`);
        }

        // Signal cancellation to active pipeline
        const active = activePipelines.get(runId);
        if (active && active.cancel) {
            active.cancel();
        }

        ok(res, { runId, status: 'cancelled' });
    });

    /**
     * POST /api/pipeline/force-cancel/:runId
     * Force-cancel any run regardless of state. Used for stuck/orphaned runs.
     */
    router.post('/api/pipeline/force-cancel/:runId', (req, res) => {
        const { runId } = req.params;
        const { reason } = req.body || {};

        const run = runStore.getRun(runId);
        if (!run) return notFound(res, `Run ${runId} not found`);

        const success = runStore.forceCancelRun(runId, reason || 'Force cancelled by user');
        if (!success) return json(res, 500, { error: 'Failed to force-cancel run' });

        // Signal cancellation to active pipeline if it exists
        const active = activePipelines.get(runId);
        if (active && active.cancel) {
            active.cancel();
            activePipelines.delete(runId);
        }

        // Push event
        eventBridge.push(EVENT_TYPES.RUN_COMPLETE, runId, {
            ticketId: run.ticketId,
            success: false,
            error: reason || 'Force cancelled by user',
        });

        ok(res, { runId, status: 'failed', message: 'Run force-cancelled' });
    });

    // ═════════════════════════════════════════════════════════════════
    // RUN QUERIES
    // ═════════════════════════════════════════════════════════════════

    /**
     * GET /api/pipeline/runs
     * Query: ?ticketId=&status=&mode=&limit=&offset=
     */
    router.get('/api/pipeline/runs', (req, res) => {
        const filters = {
            ticketId: req.query.ticketId || undefined,
            status: req.query.status || undefined,
            mode: req.query.mode || undefined,
            limit: parseInt(req.query.limit, 10) || 50,
            offset: parseInt(req.query.offset, 10) || 0,
        };
        ok(res, runStore.listRuns(filters));
    });

    /**
     * GET /api/pipeline/status/:runId
     */
    router.get('/api/pipeline/status/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);
        ok(res, {
            runId: run.runId,
            ticketId: run.ticketId,
            status: run.status,
            stages: run.stages,
            duration: run.duration,
            error: run.error,
        });
    });

    /**
     * GET /api/pipeline/batch/:batchId
     */
    router.get('/api/pipeline/batch/:batchId', (req, res) => {
        const batch = runStore.getBatch(req.params.batchId);
        if (!batch) return notFound(res);
        ok(res, batch);
    });

    // ═════════════════════════════════════════════════════════════════
    // TEST REPORTS (per-execution Playwright results)
    // ═════════════════════════════════════════════════════════════════

    // NOTE: BROKEN_PATTERNS, isBrokenError, classifySpec, and transformSuites
    // are hoisted to module scope (above startServer) — no closure dependencies.

    const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');

    /**
     * GET /api/reports
     * List all saved test report files with summary metadata.
     */
    router.get('/api/reports', async (req, res) => {
        try {
            if (!fs.existsSync(reportsDir)) return ok(res, []);

            const allFiles = await fsP.readdir(reportsDir);
            const files = allFiles
                .filter(f => f.endsWith('-test-results.json'))
                .sort()
                .reverse();

            const reports = (await Promise.all(files.map(async (file) => {
                try {
                    const buf = await fsP.readFile(path.join(reportsDir, file), 'utf-8');
                    const raw = JSON.parse(buf);
                    const pw = raw.playwrightResult || {};
                    const { stats } = transformSuites(pw.suites || []);

                    return {
                        fileName: file,
                        ticketId: raw.ticketId,
                        runId: raw.runId,
                        mode: raw.mode,
                        specPath: raw.specPath,
                        timestamp: raw.timestamp,
                        summary: {
                            totalSpecs: stats.total,
                            passed: stats.passed,
                            failed: stats.failed,
                            broken: stats.broken,
                            skipped: stats.skipped,
                            flaky: stats.flaky,
                            retried: stats.retried,
                            totalDuration: stats.totalDuration,
                        },
                    };
                } catch { return null; /* skip corrupt files */ }
            }))).filter(Boolean);

            ok(res, reports);
        } catch (err) {
            json(res, 500, { ok: false, error: err.message });
        }
    });

    /**
     * GET /api/reports/consolidated
     * Aggregates ALL test results into a single Allure-style response.
     * Uses the latest run per ticket for deduplication.
     */
    router.get('/api/reports/consolidated', async (req, res) => {
        try {
            if (!fs.existsSync(reportsDir)) return ok(res, { total: 0, suites: [], filter: null });

            const sinceParam = req.query.since;
            const runIdParam = req.query.runId;
            const sinceDate = sinceParam ? new Date(sinceParam) : null;

            const allFiles = await fsP.readdir(reportsDir);
            const files = allFiles
                .filter(f => f.endsWith('-test-results.json'))
                .sort()
                .reverse();

            // Deduplicate by ticketId (latest per ticket), with optional time/runId filtering
            const parsed = await Promise.all(files.map(async (file) => {
                try {
                    const buf = await fsP.readFile(path.join(reportsDir, file), 'utf-8');
                    return { file, data: JSON.parse(buf) };
                } catch { return null; /* skip corrupt files */ }
            }));

            const latestByTicket = new Map();
            for (const entry of parsed) {
                if (!entry) continue;
                const raw = entry.data;
                if (runIdParam && raw.runId !== runIdParam) continue;
                if (sinceDate && raw.timestamp && new Date(raw.timestamp) < sinceDate) continue;
                const key = raw.ticketId || entry.file;
                if (!latestByTicket.has(key)) {
                    latestByTicket.set(key, raw);
                }
            }

            // Aggregate using the unified transformSuites helper
            const aggregateStats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0, flaky: 0, retried: 0, totalDuration: 0 };
            const allSuites = [];

            for (const [ticketId, raw] of latestByTicket) {
                const pw = raw.playwrightResult || {};
                const { suites, stats } = transformSuites(pw.suites || [], { ticketId });
                allSuites.push(...suites);
                for (const k of Object.keys(aggregateStats)) {
                    aggregateStats[k] += stats[k];
                }
            }

            ok(res, {
                ...aggregateStats,
                suites: allSuites,
                reportCount: latestByTicket.size,
                timestamp: new Date().toISOString(),
                filter: sinceParam || runIdParam ? { since: sinceParam || null, runId: runIdParam || null } : null,
            });
        } catch (err) {
            json(res, 500, { ok: false, error: err.message });
        }
    });

    /**
     * GET /api/reports/:fileName
     * Return full parsed test report for a specific file.
     */
    router.get('/api/reports/:fileName', async (req, res) => {
        try {
            const fileName = req.params.fileName;

            // Security: strict filename validation — alphanumeric, hyphens, dots only
            if (!/^[\w.-]+$/.test(fileName)) return badRequest(res, 'Invalid filename');

            const filePath = path.resolve(reportsDir, fileName);
            if (!filePath.startsWith(path.resolve(reportsDir))) return badRequest(res, 'Invalid path');
            if (!fs.existsSync(filePath)) return notFound(res);

            const buf = await fsP.readFile(filePath, 'utf-8');
            const raw = JSON.parse(buf);
            const pw = raw.playwrightResult || {};
            const { suites } = transformSuites(pw.suites || [], { includeAttachments: true });

            ok(res, {
                ticketId: raw.ticketId,
                runId: raw.runId,
                mode: raw.mode,
                specPath: raw.specPath,
                timestamp: raw.timestamp,
                errors: pw.errors || [],
                suites,
            });
        } catch (err) {
            json(res, 500, { ok: false, error: err.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // REAL-TIME STREAMING (SSE)
    // ═════════════════════════════════════════════════════════════════

    /**
     * GET /api/pipeline/stream/:runId
     * Server-Sent Events stream for a specific run.
     */
    router.get('/api/pipeline/stream/:runId', (req, res) => {
        const { runId } = req.params;

        const run = runStore.getRun(runId);
        if (!run) return notFound(res);

        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        });

        // Send buffered events first (for late-joining clients)
        const buffered = eventBridge.getRunEvents(runId);
        for (const evt of buffered) {
            res.write(EventBridge.formatSSE(evt));
        }

        // If run is already terminal, send complete and close
        if ([RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.CANCELLED].includes(run.status)) {
            res.write(EventBridge.formatSSE({
                type: 'stream_end',
                runId,
                timestamp: new Date().toISOString(),
                data: { status: run.status },
            }));
            res.end();
            return;
        }

        // Subscribe to live events
        const onEvent = (event) => {
            try {
                res.write(EventBridge.formatSSE(event));
            } catch {
                // Client disconnected
            }
        };

        eventBridge.on(`event:${runId}`, onEvent);

        // Heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(() => {
            try {
                res.write(': heartbeat\n\n');
            } catch {
                cleanup();
            }
        }, 15000);

        // Cleanup on disconnect
        const cleanup = () => {
            clearInterval(heartbeat);
            eventBridge.removeListener(`event:${runId}`, onEvent);
        };

        req.on('close', cleanup);
        req.on('error', cleanup);
    });

    /**
     * GET /api/pipeline/stream
     * Global SSE stream — all pipeline events across all runs.
     */
    router.get('/api/pipeline/stream', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        const onEvent = (event) => {
            try {
                res.write(EventBridge.formatSSE(event));
            } catch { /* disconnected */ }
        };

        eventBridge.on('event', onEvent);

        const heartbeat = setInterval(() => {
            try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
        }, 15000);

        const cleanup = () => {
            clearInterval(heartbeat);
            eventBridge.removeListener('event', onEvent);
        };

        req.on('close', cleanup);
        req.on('error', cleanup);
    });

    // ═════════════════════════════════════════════════════════════════
    // JIRA WEBHOOK (Phase 4 — pre-wired)
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/webhooks/jira
     * Receives Jira webhook events for auto-triggering pipelines.
     */
    router.post('/api/webhooks/jira', async (req, res) => {
        const payload = req.body;

        // Validate basic structure
        if (!payload || !payload.issue) {
            return badRequest(res, 'Invalid Jira webhook payload');
        }

        const issueKey = payload.issue?.key;
        if (!issueKey) {
            return badRequest(res, 'Missing issue key in webhook payload');
        }

        // Check for status transition to configured trigger status
        const changelog = payload.changelog;
        const statusChange = changelog?.items?.find(item => item.field === 'status');

        if (!statusChange) {
            // Not a status change — acknowledge but don't trigger
            return ok(res, { acknowledged: true, action: 'ignored', reason: 'No status change' });
        }

        const newStatus = statusChange.toString || '';
        const triggerStatuses = ['Ready for QA', 'Ready for Testing', 'QA'];

        if (!triggerStatuses.some(s => newStatus.toLowerCase().includes(s.toLowerCase()))) {
            return ok(res, {
                acknowledged: true,
                action: 'ignored',
                reason: `Status "${newStatus}" is not a trigger status`,
            });
        }

        if (!orchestratorReady) {
            return json(res, 503, { error: 'SDK Orchestrator not ready' });
        }

        // Dedup
        const activeRun = runStore.getActiveRun(issueKey);
        if (activeRun) {
            return conflict(res, `Pipeline already running for ${issueKey}`);
        }

        // Create and start
        const run = runStore.createRun({
            ticketId: issueKey,
            mode: 'full',
            environment: 'UAT',
            triggeredBy: 'webhook',
        });

        _executePipeline(run.runId, issueKey, 'full', orchestrator, runStore, eventBridge, activePipelines);

        accepted(res, { runId: run.runId, ticketId: issueKey, triggeredBy: 'jira-webhook' });
    });

    // ═════════════════════════════════════════════════════════════════
    // CHAT SESSIONS (AI Assistant)
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/chat/sessions
     * Body: { model?, agentMode? }
     * Returns: { sessionId, model, createdAt, agentMode }
     */
    router.post('/api/chat/sessions', async (req, res) => {
        if (!chatManager) {
            return json(res, 503, { error: 'Chat manager not ready. SDK Orchestrator may still be starting.' });
        }
        try {
            const { model, agentMode } = req.body;
            const session = await chatManager.createSession({ model, agentMode });
            ok(res, session);
        } catch (error) {
            json(res, 500, { error: `Failed to create chat session: ${error.message}` });
        }
    });

    /**
     * GET /api/chat/sessions
     * Returns: [{ sessionId, model, createdAt, messageCount }]
     */
    router.get('/api/chat/sessions', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        ok(res, chatManager.listSessions());
    });

    /**
     * POST /api/chat/sessions/:sessionId/messages
     * Body: { content, attachments? }
     * Returns: { messageId }
     *
     * Attachments are optional base64-encoded images:
     *   [{ type: 'image', media_type: 'image/png', data: '<base64>' }]
     * Body limit raised to 10 MB to accommodate image data.
     */
    router.post('/api/chat/sessions/:sessionId/messages', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        const { sessionId } = req.params;
        const { content, attachments } = req.body;
        if (!content && (!attachments || attachments.length === 0)) {
            return badRequest(res, 'Message content or attachments required');
        }

        // Validate attachments if present
        if (attachments && Array.isArray(attachments)) {
            const VALID_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            if (attachments.length > 4) {
                return badRequest(res, 'Maximum 4 image attachments per message');
            }
            for (const att of attachments) {
                if (!att.type || att.type !== 'image') {
                    return badRequest(res, 'Attachment type must be "image"');
                }
                if (!VALID_MEDIA.includes(att.media_type)) {
                    return badRequest(res, `Unsupported media type: ${att.media_type}. Allowed: ${VALID_MEDIA.join(', ')}`);
                }
                if (!att.data || typeof att.data !== 'string') {
                    return badRequest(res, 'Attachment data must be a base64 string');
                }
                // Check decoded size (~5 MB max per image)
                const estimatedSize = Math.ceil(att.data.length * 0.75);
                if (estimatedSize > 5 * 1024 * 1024) {
                    return badRequest(res, 'Individual image attachment must be under 5 MB');
                }
            }
        }

        try {
            const result = await chatManager.sendMessage(sessionId, content || '', attachments);
            ok(res, result);
        } catch (error) {
            if (error.message.includes('not found')) return notFound(res, error.message);
            json(res, 500, { error: error.message });
        }
    });

    /**
     * GET /api/chat/sessions/:sessionId/followups
     * Returns contextual follow-up suggestions for the current conversation state.
     */
    router.get('/api/chat/sessions/:sessionId/followups', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            const followups = chatManager.getFollowups(req.params.sessionId);
            ok(res, { followups });
        } catch (error) {
            if (error.message.includes('not found')) return notFound(res, error.message);
            json(res, 500, { error: error.message });
        }
    });

    /**
     * GET /api/chat/sessions/:sessionId/stream
     * SSE stream for chat session events (deltas, tool calls, reasoning)
     */
    router.get('/api/chat/sessions/:sessionId/stream', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        const { sessionId } = req.params;

        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        // Register this response as an SSE client
        const registered = chatManager.addSSEClient(sessionId, res);
        if (!registered) {
            res.write(`event: chat_error\ndata: ${JSON.stringify({ error: 'Session not found' })}\n\n`);
            res.end();
            return;
        }

        // Heartbeat
        const heartbeat = setInterval(() => {
            try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
        }, 15000);

        const cleanup = () => {
            clearInterval(heartbeat);
            chatManager.removeSSEClient(sessionId, res);
        };

        req.on('close', cleanup);
        req.on('error', cleanup);
    });

    /**
     * GET /api/chat/sessions/:sessionId/history
     * Returns conversation history
     */
    router.get('/api/chat/sessions/:sessionId/history', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            const history = await chatManager.getHistory(req.params.sessionId);
            ok(res, history);
        } catch (error) {
            if (error.message.includes('not found')) return notFound(res, error.message);
            json(res, 500, { error: error.message });
        }
    });

    /**
     * POST /api/chat/sessions/:sessionId/abort
     * Abort current processing
     */
    router.post('/api/chat/sessions/:sessionId/abort', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            await chatManager.abort(req.params.sessionId);
            ok(res, { aborted: true });
        } catch (error) {
            if (error.message.includes('not found')) return notFound(res, error.message);
            json(res, 500, { error: error.message });
        }
    });

    /**
     * POST /api/chat/sessions/:sessionId/user-input
     * Submit a user's response to an agent's ask_user / ask_questions request.
     * Body: { requestId: string, answer: string }
     */
    router.post('/api/chat/sessions/:sessionId/user-input', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        const { sessionId } = req.params;
        const { requestId, answer } = req.body;

        if (!requestId || typeof requestId !== 'string') {
            return badRequest(res, 'requestId (string) is required');
        }
        if (!answer || typeof answer !== 'string') {
            return badRequest(res, 'answer (string) is required');
        }

        try {
            const result = chatManager.resolveUserInput(sessionId, requestId, answer);
            ok(res, result);
        } catch (error) {
            if (error.message.includes('not found')) return notFound(res, error.message);
            if (error.message.includes('already resolved')) return json(res, 409, { error: error.message });
            json(res, 500, { error: error.message });
        }
    });

    /**
     * DELETE /api/chat/sessions/:sessionId
     * Destroy a chat session
     */
    router.delete('/api/chat/sessions/:sessionId', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            await chatManager.destroySession(req.params.sessionId);
            ok(res, { deleted: true });
        } catch (error) {
            json(res, 500, { error: error.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // CREATE HTTP SERVER
    // ═════════════════════════════════════════════════════════════════

    const server = http.createServer((req, res) => router.handle(req, res));

    server.listen(port, () => {
        log('═══════════════════════════════════════════════════');
        log('  SDK PIPELINE SERVER');
        log(`  Port:    ${port}`);
        log(`  CORS:    ${corsOrigins.join(', ')}`);
        log(`  Runs:    ${runStore.getStats().totalRuns} historical`);
        log('═══════════════════════════════════════════════════');
        log('');
        log('  Endpoints:');
        log(`    POST /api/pipeline/run          — Start pipeline`);
        log(`    POST /api/pipeline/batch         — Batch execution`);
        log(`    POST /api/pipeline/cancel/:runId — Cancel pipeline`);
        log(`    GET  /api/pipeline/runs          — List runs`);
        log(`    GET  /api/pipeline/status/:runId — Run status`);
        log(`    GET  /api/pipeline/results/:runId— Full results`);
        log(`    GET  /api/pipeline/stream/:runId — SSE stream`);
        log(`    GET  /api/pipeline/stream        — Global SSE stream`);
        log(`    GET  /api/analytics/overview     — Pipeline analytics`);
        log(`    GET  /api/analytics/failures     — Failure trends`);
        log(`    GET  /api/analytics/selectors    — Selector stability`);
        log(`    GET  /api/analytics/runs         — Run trends`);
        log(`    POST /api/webhooks/jira          — Jira webhook`);
        log(`    POST /api/chat/sessions           — Create chat session`);
        log(`    GET  /api/chat/sessions           — List chat sessions`);
        log(`    POST /api/chat/sessions/:id/messages — Send message`);
        log(`    GET  /api/chat/sessions/:id/followups — Get followup suggestions`);
        log(`    GET  /api/chat/sessions/:id/stream — Chat SSE stream`);
        log(`    GET  /api/chat/sessions/:id/history — Chat history`);
        log(`    POST /api/chat/sessions/:id/abort  — Abort chat`);
        log(`    DELETE /api/chat/sessions/:id      — Delete session`);
        log(`    GET  /health                     — Health check`);
        log(`    GET  /ready                      — Readiness`);
        log('');
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
        log(`\n${signal} received. Shutting down...`);
        clearInterval(staleRunWatchdog);
        server.close();
        if (chatManager) await chatManager.destroyAll().catch(() => { });
        await orchestrator.stop().catch(() => { });
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return server;
}

// ─── Pipeline Execution (Background) ───────────────────────────────────────

/**
 * Execute a pipeline run in the background.
 * Updates RunStore and EventBridge as stages progress.
 */
function _executePipeline(runId, ticketId, mode, orchestrator, runStore, eventBridge, activePipelines, model) {
    let cancelled = false;

    activePipelines.set(runId, {
        cancel: () => { cancelled = true; },
    });

    // Fire and forget — async execution
    (async () => {
        try {
            // Mark started
            runStore.startRun(runId);
            eventBridge.push(EVENT_TYPES.RUN_START, runId, { ticketId, mode });

            // Create progress callback that updates both RunStore and EventBridge
            const followupProvider = getFollowupProvider();
            const onProgress = (stage, message) => {
                if (cancelled) return;

                // Update run store
                if (message.startsWith('Starting ')) {
                    runStore.updateStage(runId, stage, 'running', { message });
                } else if (message === 'Completed' || message.includes('passed') || message.includes('generated')) {
                    runStore.updateStage(runId, stage, 'passed', { message });
                    // Generate and push followup suggestions on stage success
                    const followups = followupProvider.getPipelineFollowups({
                        stage, success: true, ticketId,
                    });
                    if (followups.length > 0) {
                        eventBridge.push(EVENT_TYPES.FOLLOWUP, runId, { stage, followups });
                    }
                } else if (message.startsWith('BLOCKED') || message.startsWith('ERROR')) {
                    runStore.updateStage(runId, stage, 'failed', { message });
                    // Generate and push followup suggestions on stage failure
                    const followups = followupProvider.getPipelineFollowups({
                        stage, success: false, ticketId,
                    });
                    if (followups.length > 0) {
                        eventBridge.push(EVENT_TYPES.FOLLOWUP, runId, { stage, followups });
                    }
                } else {
                    runStore.updateStage(runId, stage, 'running', { message });
                }

                // Push to event bridge
                const progressCallback = eventBridge.createProgressCallback(runId);
                progressCallback(stage, message);
            };

            // Execute pipeline
            const result = await orchestrator.runPipeline(ticketId, {
                mode,
                model,
                onProgress,
            });

            // Mark completed
            runStore.completeRun(runId, result);
            eventBridge.push(EVENT_TYPES.RUN_COMPLETE, runId, {
                ticketId,
                success: result.success,
                duration: result.duration,
                error: result.error,
            });

        } catch (error) {
            log(`Pipeline ${runId} failed: ${error.message}`, 'error');
            runStore.completeRun(runId, {
                success: false,
                error: error.message,
                ticketId,
                mode,
            });
            eventBridge.push(EVENT_TYPES.ERROR, runId, {
                ticketId,
                error: error.message,
            });
            eventBridge.push(EVENT_TYPES.RUN_COMPLETE, runId, {
                ticketId,
                success: false,
                error: error.message,
            });
        } finally {
            activePipelines.delete(runId);

            // Clean up event buffer after 5 minutes
            setTimeout(() => eventBridge.cleanupRun(runId), 5 * 60 * 1000);
        }
    })();
}

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg, level = 'info') {
    const prefix = '[PipelineServer]';
    if (level === 'error') console.error(`${prefix} ❌ ${msg}`);
    else if (level === 'warn') console.warn(`${prefix} ⚠️ ${msg}`);
    else console.log(`${prefix} ${msg}`);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { startServer };
