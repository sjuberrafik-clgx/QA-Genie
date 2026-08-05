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
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
// NOTE: SDKOrchestrator is lazy-required inside startServer() to avoid
// circular dependency with index.js which re-exports startServer.
const { RunStore, RUN_STATUS } = require('./run-store');
const { EventBridge, EVENT_TYPES, getEventBridge } = require('./event-bridge');
const { LearningStore } = require('./learning-store');
const { ChatSessionManager, CHAT_EVENTS } = require('./chat-session-manager');
const { getFollowupProvider } = require('./followup-provider');
const { ObservationRecorder } = require('./observation-recorder');
const { setSessionRoot, getSessionRoot, BLOCKED_PATHS } = require('./filesystem-tools');
const { isGeneratedArtifactPath } = require('./generated-artifact-policy');
const { StudioWorkspaceRegistry, ensureSkillFrontmatter } = require('./studio-workspace-registry');
const { detectProjectSkillsForMessage, buildProjectSkillRoutingHint } = require('./project-skills-catalog');
const { StudioAssetGenerator } = require('./studio-asset-generator');
const { AgentSessionFactory } = require('./agent-sessions');
const { AgentCatalogService } = require('./agent-catalog');
const { AgentTemplateRegistry } = require('./agent-template-registry');
const { listCapabilityProfiles } = require('./capability-profiles');
const { exportAgent, importAgent, SUPPORTED_EXPORT_FORMATS } = require('./agent-config-exporter');
const { McpConnectionManager } = require('./mcp-connection-manager');
const { validateAgent } = require('./agent-validator');
const { AgentAnalyticsStore } = require('./agent-analytics-store');
const { JiraWebhookLifecycleService } = require('./jira-webhook-lifecycle');
const { TerminalSessionManager } = require('./terminal-session-manager');
const {
    JiraWebhookReliabilityStore,
    normalizeJiraWebhookIngestionConfig,
    normalizeJiraWebhookStartupSyncConfig,
    runJiraWebhookStartupSync,
    createQueueError,
} = require('./jira-webhook-reliability');
const { SchedulerStore } = require('./scheduler-store');
const { createSchedulerActions } = require('./scheduler-actions');
const { SchedulerEngine } = require('./scheduler-engine');
const { SchedulerAttachmentStore } = require('./scheduler-attachment-store');
const { AiTicketDrafter } = require('./ai-ticket-drafter');
const {
    loadEnv, isValidTicketId, isValidMode, generateBatchId, truncate, loadWorkflowConfig,
} = require('./utils');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CUSTOM_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;
const FRAMEWORK_MODES = new Set(['existing', 'manual']);

// ─── Lightweight HTTP Router ────────────────────────────────────────────────

/**
 * Minimal router using Node.js built-in http module.
 * No Express dependency required — keeps the install lightweight.
 */
class Router {
    constructor() {
        this._routes = [];
        // CWE-942 fix: default to localhost origins instead of wildcard '*'
        this._corsOrigins = ['http://localhost:3001', 'http://localhost:3100', 'http://127.0.0.1:3001', 'http://127.0.0.1:3100'];

        // CWE-306 fix: optional bearer-token gate. Activated only when
        // `SDK_API_TOKEN` is set in the environment, so existing local-only
        // deployments remain backwards compatible.
        // Routes in `_authBypassExact` are always public:
        //   - `/health`                    monitoring probe
        //   - `/api/webhooks/jira`         signed by Jira HMAC (verified separately)
        this._apiToken = (process.env.SDK_API_TOKEN || '').trim();
        this._authBypassExact = new Set([
            '/health',
            '/api/webhooks/jira',
        ]);

        // CWE-770 fix: in-process rate limiter for sensitive routes.
        // Sliding-window counter keyed by `<remoteIp>|<routeBucket>`.
        // Defaults are generous to avoid disrupting local dev; operators can
        // tighten via SDK_RATE_LIMIT_* envs.
        this._rateLimitWindowMs = parseInt(process.env.SDK_RATE_LIMIT_WINDOW_MS, 10) || 60_000;
        this._rateLimitBuckets = [
            { prefix: '/api/pipeline/run', max: parseInt(process.env.SDK_RATE_LIMIT_PIPELINE, 10) || 30 },
            { prefix: '/api/pipeline/batch', max: parseInt(process.env.SDK_RATE_LIMIT_PIPELINE, 10) || 30 },
            { prefix: '/api/chat/sessions', max: parseInt(process.env.SDK_RATE_LIMIT_CHAT, 10) || 120 },
            { prefix: '/api/webhooks/jira', max: parseInt(process.env.SDK_RATE_LIMIT_WEBHOOK, 10) || 300 },
            { prefix: '/api/scheduler', max: parseInt(process.env.SDK_RATE_LIMIT_SCHEDULER, 10) || 60 },
        ];
        this._rateLimitHits = new Map(); // key -> { count, resetAt }
    }

    _checkRateLimit(req) {
        const pathname = (req.url || '').split('?')[0];
        const bucket = this._rateLimitBuckets.find(b => pathname.startsWith(b.prefix));
        if (!bucket) return { allowed: true };

        const ip = (req.socket && (req.socket.remoteAddress || '')) || 'unknown';
        const key = `${ip}|${bucket.prefix}`;
        const now = Date.now();
        let entry = this._rateLimitHits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + this._rateLimitWindowMs };
            this._rateLimitHits.set(key, entry);
        }
        entry.count += 1;

        // Opportunistic GC: prune at most a few stale entries per request.
        if (this._rateLimitHits.size > 1000) {
            let pruned = 0;
            for (const [k, v] of this._rateLimitHits) {
                if (v.resetAt <= now) {
                    this._rateLimitHits.delete(k);
                    if (++pruned >= 50) break;
                }
            }
        }

        if (entry.count > bucket.max) {
            return {
                allowed: false,
                retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
                limit: bucket.max,
            };
        }
        return { allowed: true };
    }

    setCorsOrigins(origins) {
        this._corsOrigins = origins;
    }

    get(pattern, handler) { this._routes.push({ method: 'GET', pattern, handler }); }
    post(pattern, handler) { this._routes.push({ method: 'POST', pattern, handler }); }
    /** Register a POST route that receives the raw request stream (no JSON parsing). */
    postRaw(pattern, handler) { this._routes.push({ method: 'POST', pattern, handler, rawBody: true }); }
    put(pattern, handler) { this._routes.push({ method: 'PUT', pattern, handler }); }
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

            if (match) return { handler: route.handler, params, rawBody: !!route.rawBody };
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
            // CWE-20 fix: validate Content-Type is JSON for non-empty bodies
            const ct = (req.headers['content-type'] || '').toLowerCase();
            if (ct && !ct.includes('application/json') && !ct.includes('text/plain')) {
                return reject(new Error('Unsupported Content-Type; expected application/json'));
            }

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
                if (!raw) {
                    return resolve({ parsedBody: {}, rawBody: '' });
                }
                try {
                    resolve({
                        parsedBody: JSON.parse(raw),
                        rawBody: raw,
                    });
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename');

        // CWE-16 fix: Security response headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        // Preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // CWE-770 fix: rate-limit sensitive routes.
        const rl = this._checkRateLimit(req);
        if (!rl.allowed) {
            res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': String(rl.retryAfterSec),
            });
            res.end(JSON.stringify({
                error: 'Too many requests',
                limit: rl.limit,
                retryAfterSec: rl.retryAfterSec,
            }));
            return;
        }

        // CWE-306 fix: bearer auth gate (only enforced when SDK_API_TOKEN is set).
        if (this._apiToken) {
            const pathname = (req.url || '').split('?')[0];
            if (!this._authBypassExact.has(pathname)) {
                const header = req.headers['authorization'] || '';
                const match = /^Bearer\s+(.+)$/i.exec(header);
                const presented = match ? match[1].trim() : '';
                const expected = this._apiToken;
                let authorized = false;
                if (presented && presented.length === expected.length) {
                    try {
                        authorized = crypto.timingSafeEqual(
                            Buffer.from(presented, 'utf8'),
                            Buffer.from(expected, 'utf8')
                        );
                    } catch {
                        authorized = false;
                    }
                }
                if (!authorized) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }
            }
        }

        const route = this._match(req.method, req.url);
        if (!route) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        try {
            const query = this._parseQuery(req.url);
            req.params = route.params;
            req.query = query;

            // Raw-body routes receive the request stream directly (e.g. streaming file uploads)
            if (route.rawBody) {
                req.body = {};
                req.rawBody = '';
                await route.handler(req, res);
                return;
            }

            // Use higher body limit for chat message endpoint (supports base64 image + document attachments)
            // CWE-400 fix: reduced from 400 MB to 50 MB — still supports ~10 images × 5 MB base64
            const isMessageRoute = req.url.includes('/messages');
            const maxBodyBytes = isMessageRoute ? 50 * 1024 * 1024 : 1024 * 1024;
            const parsed = ['POST', 'PUT', 'PATCH'].includes(req.method)
                ? await this._readBody(req, maxBodyBytes)
                : { parsedBody: {}, rawBody: '' };

            req.body = parsed.parsedBody;
            req.rawBody = parsed.rawBody;

            await route.handler(req, res);
        } catch (error) {
            if (!res.headersSent) {
                // CWE-200 fix: sanitize error messages — never expose stack traces or internal paths
                const safeMessage = process.env.NODE_ENV === 'production'
                    ? 'Internal server error'
                    : (error.message || 'Internal server error').replace(/\b[A-Z]:\\[^\s"']+/gi, '[path]');
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: safeMessage }));
            }
        }
    }
}

// ─── Server Utilities (extracted) ────────────────────────────────────────────
const {
    json,
    accepted,
    ok,
    badRequest,
    notFound,
    conflict,
    respondChatError,
    respondLifecycleError,
    respondWebhookQueueError,
    normalizeWebhookStatusFilters,
    resolveJiraWebhookRuntimeConfig,
    parsePositiveInteger,
    normalizeOptionalString,
    isValidCustomRunId,
    normalizeHybridRunInput,
    resolveChatVideoRetentionConfig,
    parseJiraWebhookSignature,
    verifyJiraWebhookSignature,
    buildJiraWebhookReplayKey,
    pruneJiraWebhookReplayCache,
    buildObservationSummary,
    buildEvidenceSummary,
    _toArray,
    _dedupeBy,
    _sortByTimestampDesc,
    _normalizePathForComparison,
    _isPathInside,
    _isAllowedArtifactPath,
    _getMimeType,
    getAppNameForExtension,
    BROKEN_PATTERNS,
    isBrokenError,
    classifySpec,
    transformSuites,
    normalizePlaywrightErrors,
    buildRunnerErrorSuite,
} = require('./server-utils');

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

    const envPort = parseInt(process.env.SERVER_PORT, 10);
    const port = options.port ?? (Number.isFinite(envPort) ? envPort : 3100);
    // CWE-668 fix: bind to loopback by default. Operators who need LAN/WAN
    // access must opt in by setting SDK_BIND_HOST (e.g. "0.0.0.0").
    const host = options.host ?? (process.env.SDK_BIND_HOST || '127.0.0.1');
    const verbose = options.verbose || false;
    const disableSignalHandlers = options.disableSignalHandlers === true;

    // ─── Initialize Core Services ───────────────────────────────────
    const runStore = new RunStore();
    const eventBridge = getEventBridge();
    const learningStore = new LearningStore();
    const terminalSessionManager = new TerminalSessionManager({
        workspaceRoot: PROJECT_ROOT,
        allowExternalCwd: String(process.env.TERMINAL_ALLOW_EXTERNAL_CWD || '').toLowerCase() === 'true',
        defaultShell: process.env.TERMINAL_DEFAULT_SHELL || undefined,
        maxSessions: parseInt(process.env.TERMINAL_MAX_SESSIONS, 10) || 20,
        bufferLimit: parseInt(process.env.TERMINAL_BUFFER_LIMIT, 10) || 1200,
    });
    const studioWorkspaceRegistry = new StudioWorkspaceRegistry();
    const agentCatalog = new AgentCatalogService({ workspaceRegistry: studioWorkspaceRegistry });
    const agentTemplateRegistry = new AgentTemplateRegistry();
    const mcpConnectionManager = new McpConnectionManager();
    const agentAnalyticsStore = new AgentAnalyticsStore();

    // Lazy AgentSessionFactory used by the Studio description generator.
    // Built on first call so it picks up the initialized orchestrator.client / defineTool.
    let _studioGeneratorFactory = null;
    async function getStudioSessionFactory() {
        if (_studioGeneratorFactory) return _studioGeneratorFactory;
        if (!orchestratorReady || !orchestrator?.client) {
            const err = new Error('SDK orchestrator is still initializing. Try again in a moment.');
            err.status = 503;
            throw err;
        }
        const sdk = await import('@github/copilot-sdk');
        _studioGeneratorFactory = new AgentSessionFactory({
            client: orchestrator.client,
            defineTool: sdk.defineTool,
            model: orchestrator.options.model,
            provider: orchestrator.options.provider || null,
            config: orchestrator.config || {},
            learningStore,
            verbose: false,
        });
        return _studioGeneratorFactory;
    }
    const studioAssetGenerator = new StudioAssetGenerator({
        getFactory: getStudioSessionFactory,
        defaultModel: process.env.STUDIO_GENERATOR_MODEL || 'gpt-5.4',
        verbose,
    });

    await studioWorkspaceRegistry.ensureBaseStructure();

    let SDKOrchestrator = null;
    if (!options.orchestrator) {
        // Lazy-require to break circular dependency (index.js re-exports startServer)
        ({ SDKOrchestrator } = require('./index'));
    }

    // Initialize SDK Orchestrator (singleton)
    const orchestrator = options.orchestrator || new SDKOrchestrator({ verbose });
    const jiraWebhookLifecycle = new JiraWebhookLifecycleService({
        orchestratorConfig: orchestrator?.config || {},
    });
    const initialWebhookIngestionConfig = normalizeJiraWebhookIngestionConfig(orchestrator?.config || {});
    const jiraWebhookReliabilityStore = new JiraWebhookReliabilityStore({
        storeFile: initialWebhookIngestionConfig.storeFile,
        maxQueueSize: initialWebhookIngestionConfig.maxQueueSize,
        maxDeadLetterEntries: initialWebhookIngestionConfig.maxDeadLetterEntries,
        maxRecentEntries: initialWebhookIngestionConfig.maxRecentEntries,
    });
    let orchestratorReady = false;

    // Chat session manager — initialized after orchestrator starts
    let chatManager = options.chatManager || null;

    if (options.orchestrator && options.chatManager) {
        orchestratorReady = true;
        log('SDK Orchestrator ready (injected)');
        log('Chat Session Manager ready (injected)');
    } else {
        // Start orchestrator in background — don't block server startup
        Promise.resolve(typeof orchestrator.start === 'function' ? orchestrator.start() : undefined)
            .then(async () => {
                orchestratorReady = true;
                log('SDK Orchestrator ready');

                if (chatManager) {
                    log('Chat Session Manager ready (injected)');
                    return;
                }

                // Initialize chat manager with the live SDK client
                try {
                    const sdk = await import('@github/copilot-sdk');
                    chatManager = new ChatSessionManager({
                        client: orchestrator.client,
                        defineTool: sdk.defineTool,
                        model: orchestrator.options.model,
                        config: orchestrator.config,
                        learningStore,
                        agentCatalog,
                    });
                    log('Chat Session Manager ready');
                } catch (err) {
                    log(`Chat Manager init failed: ${err.message}`, 'warn');
                }
            })
            .catch(err => {
                log(`SDK Orchestrator failed to start: ${err.message}`, 'error');
            });
    }

    const router = new Router();

    function getWebhookIngestionConfig() {
        return normalizeJiraWebhookIngestionConfig(orchestrator?.config || {});
    }

    function getWebhookStartupSyncConfig() {
        return normalizeJiraWebhookStartupSyncConfig(orchestrator?.config || {});
    }

    async function resolveModelSelection(requestedModel) {
        const catalog = await orchestrator.getModelCatalog();
        const effectiveModel = requestedModel || catalog.defaultModel;
        const supported = (catalog.availableModels || catalog.models || []).some(model => model.value === effectiveModel);

        if (!supported) {
            return {
                ok: false,
                catalog,
                error: `Unsupported model: ${effectiveModel}`,
            };
        }

        return {
            ok: true,
            catalog,
            effectiveModel,
        };
    }

    // Parse CORS origins — CWE-942: never default to wildcard '*'
    const corsOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
        : ['http://localhost:3001', 'http://localhost:3100', 'http://127.0.0.1:3001', 'http://127.0.0.1:3100'];
    router.setCorsOrigins(corsOrigins);

    // ─── Terminal session auth helpers ──────────────────────────────
    // Per-session tokens are issued by TerminalSessionManager.createSession.
    // They protect write paths (input/command/resize/terminate) and the
    // WS upgrade against CSRF and cross-tab hijack. Can be disabled for
    // local dev via `TERMINAL_REQUIRE_TOKEN=false`.
    const terminalRequireToken = String(process.env.TERMINAL_REQUIRE_TOKEN || 'true')
        .toLowerCase() !== 'false';

    const isTerminalOriginAllowed = (origin) => {
        if (!origin) return true; // same-origin / non-browser clients
        if (corsOrigins.includes('*')) return true;
        return corsOrigins.some((allowed) => allowed === origin);
    };

    const requireTerminalToken = (req, res, sessionId) => {
        if (!terminalRequireToken) return true;
        const headerToken = req.headers?.['x-terminal-token']
            || req.headers?.['X-Terminal-Token'];
        const queryToken = req.query?.token;
        const token = typeof headerToken === 'string' && headerToken
            ? headerToken
            : (typeof queryToken === 'string' ? queryToken : '');

        if (!token || !terminalSessionManager.verifySessionToken(sessionId, token)) {
            json(res, 401, { error: 'Invalid or missing terminal session token' });
            return false;
        }
        return true;
    };

    // ─── Active Pipeline Tracking ───────────────────────────────────
    // Map of runId → { cancel: Function }
    const activePipelines = new Map();
    const jiraWebhookReplayCache = new Map();
    const JIRA_WEBHOOK_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
    let videoUploadCleanupInterval = null;
    let jiraWebhookQueueTimer = null;
    let jiraWebhookQueueProcessing = false;

    // ─── Scheduler Engine ───────────────────────────────────────────
    // One-time scheduled-action engine: transition/close a Jira ticket, add a
    // comment, or run a pipeline at a future time. File-backed + deterministic.
    const schedulerConfigRoot = loadWorkflowConfig();
    const schedulerStore = new SchedulerStore({ maxJobs: schedulerConfigRoot?.scheduler?.maxJobs });
    const schedulerAttachmentStore = new SchedulerAttachmentStore({
        videoUploadDir: path.join(os.tmpdir(), 'qa-video-uploads'),
    });
    const schedulerActions = createSchedulerActions({
        config: schedulerConfigRoot,
        logger: (message, level) => log(message, level),
        pipelineTrigger: async ({ ticketId, mode, environment, model }) => {
            if (!orchestratorReady) throw new Error('SDK Orchestrator not ready yet.');
            if (!isValidTicketId(ticketId)) throw new Error(`Invalid ticketId: "${ticketId}"`);
            const existing = runStore.getActiveRun(ticketId);
            if (existing) return { runId: existing.runId, ticketId, note: 'Pipeline already running' };
            const run = runStore.createRun({
                ticketId,
                mode: isValidMode(mode) ? mode : 'full',
                environment: environment || 'UAT',
                triggeredBy: 'scheduler',
                model: model || null,
            });
            runStore.updateMission(run.runId, {
                evidence: { eventLogPath: eventBridge.getRunEventLogPath(run.runId) },
            });
            _executePipeline(run.runId, ticketId, run.mode, orchestrator, runStore, eventBridge, activePipelines, model || undefined);
            return { runId: run.runId, ticketId, mode: run.mode };
        },
        agentInvoker: async ({ agentId, prompt, timeoutMs, model, attachments, jobId }) => {
            if (!orchestratorReady) throw new Error('SDK Orchestrator not ready yet.');
            if (!chatManager || typeof chatManager.runScheduledAgent !== 'function') {
                throw new Error('Chat manager is not ready yet — cannot run scheduled agent.');
            }
            // Reload durable attachments (screenshots/recordings persisted at schedule time).
            const wireAttachments = (Array.isArray(attachments) && attachments.length > 0 && jobId)
                ? schedulerAttachmentStore.loadForJob(jobId, attachments)
                : [];
            return chatManager.runScheduledAgent({ agentId, prompt, timeoutMs, model, attachments: wireAttachments });
        },
    });
    const schedulerEngine = new SchedulerEngine({
        store: schedulerStore,
        actions: schedulerActions,
        config: schedulerConfigRoot,
        logger: (message, level) => log(message, level),
        onJobTerminal: (jobId) => schedulerAttachmentStore.cleanupJob(jobId),
    });
    schedulerEngine.start();

    // AI ticket drafter — runs BugGenie/TaskGenie in draft-only mode to compose a
    // ticket for human review; the approved draft is later scheduled as a
    // `jira.ai-create` job. Reuses the generic lazy AgentSessionFactory.
    const aiTicketDrafter = new AiTicketDrafter({
        getFactory: getStudioSessionFactory,
        logger: (message, level) => log(message, level),
    });

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

    async function runJiraWebhookLifecycleSync(trigger = 'startup', startupConfigOverride = {}) {
        return runJiraWebhookStartupSync({
            lifecycleService: jiraWebhookLifecycle,
            store: jiraWebhookReliabilityStore,
            orchestratorConfig: orchestrator?.config || {},
            startupConfig: {
                ...getWebhookStartupSyncConfig(),
                ...(startupConfigOverride || {}),
            },
            trigger,
        });
    }

    function scheduleJiraWebhookQueueProcessing(delayMs = 0) {
        if (jiraWebhookQueueTimer) return;

        const safeDelay = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
        jiraWebhookQueueTimer = setTimeout(() => {
            jiraWebhookQueueTimer = null;
            processJiraWebhookQueue().catch(error => {
                log(`Jira webhook queue processor error: ${error.message}`, 'error');
            });
        }, safeDelay);
    }

    function triggerPipelineFromWebhookDelivery(delivery) {
        if (!orchestratorReady) {
            throw createQueueError('SDK Orchestrator not ready yet.', {
                status: 503,
                retryable: true,
                code: 'orchestrator-not-ready',
            });
        }

        if (!delivery?.issueKey || !isValidTicketId(delivery.issueKey)) {
            throw createQueueError(`Invalid or missing ticketId in webhook delivery: "${delivery?.issueKey || ''}"`, {
                status: 400,
                retryable: false,
                code: 'invalid-ticket-id',
            });
        }

        const webhookConfig = resolveJiraWebhookRuntimeConfig(orchestrator?.config || {});
        if (!webhookConfig.enabled) {
            return {
                action: 'ignored',
                reason: 'Jira webhook trigger is disabled in workflow-config.',
            };
        }

        const activeRun = runStore.getActiveRun(delivery.issueKey);
        if (activeRun) {
            return {
                action: 'ignored',
                reason: `Pipeline already running for ${delivery.issueKey}`,
                activeRunId: activeRun.runId,
            };
        }

        const mode = isValidMode(delivery.mode) ? delivery.mode : webhookConfig.defaultMode;

        const run = runStore.createRun({
            ticketId: delivery.issueKey,
            mode,
            environment: 'UAT',
            triggeredBy: 'webhook',
        });

        runStore.updateMission(run.runId, {
            evidence: {
                eventLogPath: eventBridge.getRunEventLogPath(run.runId),
            },
        });

        _executePipeline(run.runId, delivery.issueKey, mode, orchestrator, runStore, eventBridge, activePipelines);

        return {
            action: 'triggered',
            runId: run.runId,
            ticketId: delivery.issueKey,
            mode,
            triggeredBy: 'jira-webhook-queue',
            webhookId: delivery?.headers?.identifier || null,
            retryCount: delivery?.headers?.retryCount || null,
        };
    }

    async function processJiraWebhookQueue() {
        if (jiraWebhookQueueProcessing) return;

        const ingestionConfig = getWebhookIngestionConfig();
        if (!ingestionConfig.enabled) {
            return;
        }

        if (!orchestratorReady) {
            scheduleJiraWebhookQueueProcessing(ingestionConfig.retryDelayMs);
            return;
        }

        jiraWebhookQueueProcessing = true;
        try {
            let loopCount = 0;

            while (loopCount < ingestionConfig.processingLoopLimit) {
                const delivery = jiraWebhookReliabilityStore.claimNextDelivery();
                if (!delivery) break;

                try {
                    const result = triggerPipelineFromWebhookDelivery(delivery);
                    jiraWebhookReliabilityStore.completeDelivery(delivery.deliveryId, result);
                } catch (error) {
                    const failure = jiraWebhookReliabilityStore.failDelivery(delivery.deliveryId, error, {
                        maxAttempts: ingestionConfig.maxAttempts,
                        retryDelayMs: ingestionConfig.retryDelayMs,
                    });

                    if (failure.deadLettered) {
                        log(`Webhook delivery ${delivery.deliveryId} moved to DLQ: ${failure.delivery?.lastError?.message || error.message}`, 'warn');
                    }
                }

                loopCount += 1;
            }
        } finally {
            jiraWebhookQueueProcessing = false;
        }

        const nextDelay = jiraWebhookReliabilityStore.getNextPendingDelayMs();
        if (nextDelay !== null) {
            scheduleJiraWebhookQueueProcessing(nextDelay);
        }
    }

    runJiraWebhookLifecycleSync('startup')
        .then(summary => {
            log(`Jira webhook lifecycle startup sync [${summary.status}] ${summary.message}`);
        })
        .catch(error => {
            log(`Jira webhook lifecycle startup sync failed: ${error.message}`, 'warn');
        });

    if (jiraWebhookReliabilityStore.getNextPendingDelayMs() !== null) {
        scheduleJiraWebhookQueueProcessing(0);
    }

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
        const terminalSessions = terminalSessionManager.listSessions();
        ok(res, {
            ready: orchestratorReady,
            orchestrator: orchestratorReady ? 'started' : 'starting',
            runStore: 'ok',
            eventBridge: 'ok',
            terminal: {
                sessions: terminalSessions.length,
                activeSessions: terminalSessions.filter(session => session.status === 'running').length,
            },
            timestamp: new Date().toISOString(),
        });
    });

    router.get('/api/models', async (req, res) => {
        try {
            const catalog = await orchestrator.getModelCatalog({ refresh: req.query.refresh === 'true' });
            ok(res, {
                ...catalog,
                ready: orchestratorReady,
            });
        } catch (error) {
            json(res, 500, { error: `Failed to load model catalog: ${error.message}` });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // TERMINAL SESSIONS
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/terminal/sessions', (req, res) => {
        ok(res, {
            items: terminalSessionManager.listSessions(),
            wsEndpoint: '/api/terminal/ws?sessionId={sessionId}',
        });
    });

    router.post('/api/terminal/sessions', (req, res) => {
        try {
            // CWE-78 fix: whitelist allowed env vars — never merge raw user input into process.env
            const ALLOWED_ENV_VARS = new Set([
                'TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'EDITOR',
                'HEADLESS', 'PWDEBUG', 'CI', 'NODE_ENV',
                'PLAYWRIGHT_BROWSERS_PATH', 'FORCE_COLOR', 'NO_COLOR',
            ]);
            let sanitizedEnv;
            if (req.body?.env && typeof req.body.env === 'object') {
                sanitizedEnv = {};
                for (const [key, value] of Object.entries(req.body.env)) {
                    if (ALLOWED_ENV_VARS.has(key) && typeof value === 'string') {
                        sanitizedEnv[key] = value;
                    }
                }
            }

            const session = terminalSessionManager.createSession({
                shell: req.body?.shell,
                cwd: req.body?.cwd,
                cols: req.body?.cols,
                rows: req.body?.rows,
                env: sanitizedEnv,
            });

            const tokenQuery = session.sessionToken
                ? `&token=${encodeURIComponent(session.sessionToken)}`
                : '';

            json(res, 201, {
                ...session,
                wsPath: `/api/terminal/ws?sessionId=${encodeURIComponent(session.sessionId)}${tokenQuery}`,
            });
        } catch (error) {
            badRequest(res, error.message);
        }
    });

    router.get('/api/terminal/sessions/:sessionId', (req, res) => {
        const session = terminalSessionManager.getSession(req.params.sessionId);
        if (!session) return notFound(res, 'Terminal session not found');
        ok(res, session);
    });

    router.get('/api/terminal/sessions/:sessionId/output', (req, res) => {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 300, 1200));
        const payload = terminalSessionManager.getSessionOutput(req.params.sessionId, { limit });
        if (!payload) return notFound(res, 'Terminal session not found');
        ok(res, payload);
    });

    router.post('/api/terminal/sessions/:sessionId/input', (req, res) => {
        try {
            if (!requireTerminalToken(req, res, req.params.sessionId)) return;
            const appendNewline = req.body?.appendNewline === true;
            const incoming = req.body?.input;
            const text = typeof incoming === 'string' ? incoming : String(incoming || '');
            if (!text) return badRequest(res, 'input is required');

            const payload = appendNewline ? `${text}\n` : text;
            const snapshot = terminalSessionManager.writeInput(req.params.sessionId, payload, { recordInput: true });
            ok(res, snapshot);
        } catch (error) {
            if (error.message.includes('not found')) {
                return notFound(res, error.message);
            }
            badRequest(res, error.message);
        }
    });

    router.post('/api/terminal/sessions/:sessionId/command', (req, res) => {
        try {
            if (!requireTerminalToken(req, res, req.params.sessionId)) return;
            const command = typeof req.body?.command === 'string' ? req.body.command : String(req.body?.command || '');
            if (!command.trim()) return badRequest(res, 'command is required');
            const snapshot = terminalSessionManager.sendCommand(req.params.sessionId, command);
            ok(res, snapshot);
        } catch (error) {
            if (error.message.includes('not found')) {
                return notFound(res, error.message);
            }
            badRequest(res, error.message);
        }
    });

    router.post('/api/terminal/sessions/:sessionId/resize', (req, res) => {
        try {
            if (!requireTerminalToken(req, res, req.params.sessionId)) return;
            const snapshot = terminalSessionManager.resizeSession(req.params.sessionId, req.body?.cols, req.body?.rows);
            ok(res, snapshot);
        } catch (error) {
            if (error.message.includes('not found')) {
                return notFound(res, error.message);
            }
            badRequest(res, error.message);
        }
    });

    router.post('/api/terminal/sessions/:sessionId/terminate', async (req, res) => {
        try {
            if (!requireTerminalToken(req, res, req.params.sessionId)) return;
            const snapshot = await terminalSessionManager.terminateSession(req.params.sessionId, {
                force: req.body?.force !== false,
                reason: req.body?.reason || 'Terminate requested via API',
            });
            ok(res, snapshot);
        } catch (error) {
            if (error.message.includes('not found')) {
                return notFound(res, error.message);
            }
            badRequest(res, error.message);
        }
    });

    router.get('/api/chat/agents', async (req, res) => {
        try {
            const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
            const includeDraft = String(req.query.includeDraft || '').toLowerCase() === 'true';
            ok(res, { items: await agentCatalog.listChatAgents({ includeInactive, includeDraft }) });
        } catch (error) {
            json(res, error?.status || 500, { error: `Failed to load chat agents: ${error.message}` });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // AGENT STUDIO WORKSPACES
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/studio/workspaces', async (req, res) => {
        try {
            ok(res, {
                items: await studioWorkspaceRegistry.listWorkspaces(),
                sourceRoot: studioWorkspaceRegistry.sourceRootRelative,
                runtimeRoot: studioWorkspaceRegistry.runtimeRootRelative,
            });
        } catch (error) {
            json(res, error?.status || 500, { error: `Failed to list studio workspaces: ${error.message}` });
        }
    });

    router.post('/api/studio/workspaces', async (req, res) => {
        try {
            const workspace = await studioWorkspaceRegistry.createWorkspace(req.body || {});
            json(res, 201, workspace);
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/workspaces/:workspaceId/catalog', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.getWorkspaceCatalog(req.params.workspaceId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/workspaces/:workspaceId/tree', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.getWorkspaceTree(req.params.workspaceId, { depth: req.query.depth }));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/workspaces/:workspaceId/assets', async (req, res) => {
        try {
            json(res, 201, await studioWorkspaceRegistry.createAsset(req.params.workspaceId, req.body || {}));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/generate-description', async (req, res) => {
        try {
            const body = req.body || {};
            const result = await studioAssetGenerator.generateAssetDescription({
                type: body.type,
                name: body.name,
                intent: body.intent,
                model: body.model,
            });
            ok(res, {
                description: result.summary,
                longContext: result.longContext,
                sections: result.sections,
                type: result.type,
                name: result.name,
                intent: result.intent,
            });
        } catch (error) {
            json(res, error?.status || 500, {
                error: error.message,
                code: error.code,
                details: error.details,
            });
        }
    });

    router.get('/api/studio/capability-profiles', async (req, res) => {
        try {
            ok(res, { items: listCapabilityProfiles() });
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/workspaces/:workspaceId/agents/:agentId/publish', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.publishAgent(req.params.workspaceId, req.params.agentId, req.body || {}));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/workspaces/:workspaceId/agents/:agentId/activation', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.setAgentActivation(req.params.workspaceId, req.params.agentId, req.body?.active));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/workspaces/:workspaceId/file', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.readWorkspaceFile(req.params.workspaceId, req.query.path));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/workspaces/:workspaceId/file', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.writeWorkspaceFile(req.params.workspaceId, req.body?.path, req.body?.content));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.delete('/api/studio/workspaces/:workspaceId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.deleteWorkspace(req.params.workspaceId, { force: req.query.force }));
        } catch (error) {
            json(res, error?.status || 500, {
                error: error.message,
                code: error.code || null,
                details: error.details || null,
            });
        }
    });

    router.delete('/api/studio/workspaces/:workspaceId/agents/:agentId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.deleteAsset(req.params.workspaceId, 'agent', req.params.agentId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    router.delete('/api/studio/workspaces/:workspaceId/skills/:skillId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.deleteAsset(req.params.workspaceId, 'skill', req.params.skillId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    router.delete('/api/studio/workspaces/:workspaceId/mcp-servers/:mcpId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.deleteAsset(req.params.workspaceId, 'mcp-server', req.params.mcpId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    router.delete('/api/studio/workspaces/:workspaceId/file', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.deleteFile(req.params.workspaceId, req.query.path));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    // ─── Skill CRUD Endpoints ──────────────────────────────────────────

    router.get('/api/studio/workspaces/:workspaceId/skills/:skillId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.getSkill(req.params.workspaceId, req.params.skillId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    router.put('/api/studio/workspaces/:workspaceId/skills/:skillId', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.updateSkill(req.params.workspaceId, req.params.skillId, req.body || {}));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    router.post('/api/studio/workspaces/:workspaceId/skills/:skillId/validate', async (req, res) => {
        try {
            ok(res, await studioWorkspaceRegistry.validateSkill(req.params.workspaceId, req.params.skillId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    // Auto-fix SKILL.md format compliance (adds/fixes YAML frontmatter)
    router.post('/api/studio/workspaces/:workspaceId/skills/:skillId/auto-fix-format', async (req, res) => {
        try {
            const skill = await studioWorkspaceRegistry.getSkill(req.params.workspaceId, req.params.skillId);
            const { content, modified } = ensureSkillFrontmatter(skill.richBody || '', {
                name: skill.name || req.params.skillId,
                description: skill.description || '',
            });
            if (modified) {
                await studioWorkspaceRegistry.updateSkill(req.params.workspaceId, req.params.skillId, {
                    richBody: content,
                });
            }
            ok(res, { modified, content });
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    // Test skill matching for a given message (skill test sandbox)
    router.post('/api/studio/skills/test-match', async (req, res) => {
        try {
            const { message, activeAgent } = req.body || {};
            if (!message || typeof message !== 'string') {
                return json(res, 400, { error: 'message (string) is required' });
            }
            const result = buildProjectSkillRoutingHint(message, { activeAgent: activeAgent || null });
            ok(res, {
                hint: result.hint,
                activatedSkills: result.activatedSkills,
                matches: (result.matches || []).map(m => ({
                    name: m.name,
                    folderName: m.folderName,
                    score: m.score,
                    confidence: m.confidence,
                    source: m.source,
                    matchedKeywords: m.matchedKeywords,
                    matchedPhrases: m.matchedPhrases,
                    matchedTokens: m.matchedTokens?.slice(0, 10),
                })),
            });
        } catch (error) {
            json(res, error?.status || 500, { error: error.message, code: error.code || null });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // AGENT TEMPLATE REGISTRY
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/studio/templates', async (req, res) => {
        try {
            ok(res, await agentTemplateRegistry.listTemplates({
                category: req.query.category || null,
                search: req.query.search || null,
                source: req.query.source || null,
            }));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/templates/:templateId', async (req, res) => {
        try {
            ok(res, await agentTemplateRegistry.getTemplate(req.params.templateId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/templates', async (req, res) => {
        try {
            json(res, 201, await agentTemplateRegistry.createTemplate(req.body || {}));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/templates/:templateId/fork', async (req, res) => {
        try {
            const forked = await agentTemplateRegistry.forkTemplate(req.params.templateId, req.body || {});
            ok(res, forked);
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.delete('/api/studio/templates/:templateId', async (req, res) => {
        try {
            ok(res, await agentTemplateRegistry.deleteTemplate(req.params.templateId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // AGENT EXPORT / IMPORT
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/studio/workspaces/:workspaceId/agents/:agentId/export', async (req, res) => {
        try {
            const format = req.query.format || 'json';
            const agent = await studioWorkspaceRegistry.getWorkspaceAgent(req.params.workspaceId, req.params.agentId);

            // Read the agent prompt content
            let promptContent = '';
            if (agent.promptPath) {
                try {
                    const fileResult = await studioWorkspaceRegistry.readWorkspaceFile(
                        req.params.workspaceId,
                        agent.promptPath.replace(/^studio-workspaces\/[^/]+\//, '')
                    );
                    promptContent = fileResult.content || '';
                } catch { /* prompt may not exist */ }
            }

            const exported = exportAgent(agent, promptContent, format);
            ok(res, exported);
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/import-agent', async (req, res) => {
        try {
            const { content, format, workspaceId } = req.body || {};
            if (!content) {
                return json(res, 400, { error: 'Missing content to import' });
            }

            const imported = importAgent(content, format);

            // If workspaceId is provided, create the agent in that workspace
            if (workspaceId) {
                const asset = await studioWorkspaceRegistry.createAsset(workspaceId, {
                    type: 'agent',
                    name: imported.name,
                    description: imported.description,
                    longContext: imported.systemPrompt,
                });
                ok(res, { imported, asset });
            } else {
                ok(res, { imported });
            }
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/export-formats', (req, res) => {
        ok(res, { formats: SUPPORTED_EXPORT_FORMATS });
    });

    // ═════════════════════════════════════════════════════════════════
    // MCP CONNECTION MANAGER
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/studio/mcp-registry', (req, res) => {
        try {
            ok(res, mcpConnectionManager.listServers({ category: req.query.category || null }));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/mcp-registry/:serverId', (req, res) => {
        try {
            ok(res, mcpConnectionManager.getServer(req.params.serverId));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/mcp-registry/test', async (req, res) => {
        try {
            const { serverId, connection } = req.body || {};
            const result = await mcpConnectionManager.testServer(serverId || connection);
            ok(res, result);
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // AGENT VALIDATION
    // ═════════════════════════════════════════════════════════════════

    router.post('/api/studio/workspaces/:workspaceId/agents/:agentId/validate', async (req, res) => {
        try {
            const agent = await studioWorkspaceRegistry.getWorkspaceAgent(req.params.workspaceId, req.params.agentId);

            // Read prompt content
            let promptContent = '';
            if (agent.promptPath) {
                try {
                    const fileResult = await studioWorkspaceRegistry.readWorkspaceFile(
                        req.params.workspaceId,
                        agent.promptPath.replace(/^studio-workspaces\/[^/]+\//, '')
                    );
                    promptContent = fileResult.content || '';
                } catch { /* prompt may not exist */ }
            }

            // Read manifest
            const manifestFile = await studioWorkspaceRegistry.readWorkspaceFile(
                req.params.workspaceId,
                `agents/${req.params.agentId}/agent.json`
            );
            const manifest = JSON.parse(manifestFile.content);

            ok(res, validateAgent(manifest, promptContent));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // AGENT ANALYTICS
    // ═════════════════════════════════════════════════════════════════

    router.get('/api/studio/analytics', async (req, res) => {
        try {
            ok(res, await agentAnalyticsStore.getSummary());
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.get('/api/studio/analytics/:agentId', async (req, res) => {
        try {
            const detail = await agentAnalyticsStore.getAgentDetail(req.params.agentId);
            if (!detail) return json(res, 404, { error: `No analytics for agent: ${req.params.agentId}` });
            ok(res, detail);
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    router.post('/api/studio/analytics/record', async (req, res) => {
        try {
            ok(res, await agentAnalyticsStore.recordEvent(req.body || {}));
        } catch (error) {
            json(res, error?.status || 500, { error: error.message });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // PIPELINE EXECUTION
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/pipeline/run
        * Body: { ticketId?, runId?, mode?, environment?, model?, triggeredBy?, frameworkMode?, appUrl?, testCaseSource?, testDataOverride?, executionTarget? }
     * Returns: { runId, status }
     */
    router.post('/api/pipeline/run', (req, res) => {
        const {
            ticketId: rawTicketId,
            runId: rawRunId,
            mode,
            environment,
            model,
            triggeredBy,
            mission,
        } = req.body || {};

        const ticketId = normalizeOptionalString(rawTicketId);
        const customRunId = normalizeOptionalString(rawRunId);

        if (!ticketId && !customRunId) {
            return badRequest(res, 'Either ticketId or runId is required');
        }

        if (ticketId && !isValidTicketId(ticketId)) {
            return badRequest(res, `Invalid ticketId: "${ticketId}"`);
        }

        if (!ticketId && customRunId && !isValidCustomRunId(customRunId)) {
            return badRequest(res, `Invalid runId: "${customRunId}". Allowed: letters, numbers, dot, underscore, dash (2-80 chars, must start alphanumeric)`);
        }

        if (mode && !isValidMode(mode)) {
            return badRequest(res, `Invalid mode: "${mode}". Use: full, testcase, generate, heal, execute`);
        }

        const { error: hybridError, hybridContext } = normalizeHybridRunInput({
            ...(req.body || {}),
            ticketId,
            runId: customRunId,
        });
        if (hybridError) {
            return badRequest(res, hybridError);
        }

        if (!orchestratorReady) {
            return json(res, 503, { error: 'SDK Orchestrator not ready yet. Try again shortly.' });
        }

        const pipelineIdentifier = ticketId || customRunId;
        const identifierType = ticketId ? 'ticket' : 'custom';
        const effectiveMode = mode || (identifierType === 'custom' ? 'generate' : 'full');

        // Dedup — prevent duplicate runs
        const activeRun = runStore.getActiveRun(pipelineIdentifier);
        if (activeRun) {
            return conflict(res, `Pipeline already running for ${pipelineIdentifier} (runId: ${activeRun.runId})`);
        }

        resolveModelSelection(model)
            .then(({ ok: valid, effectiveModel, error }) => {
                if (!valid) {
                    return badRequest(res, error);
                }

                const run = runStore.createRun({
                    ticketId: pipelineIdentifier,
                    inputIdentifier: pipelineIdentifier,
                    identifierType,
                    mode: effectiveMode,
                    environment: environment || 'UAT',
                    triggeredBy: triggeredBy || 'api',
                    model: effectiveModel,
                    hybridContext,
                    mission,
                });
                runStore.updateMission(run.runId, {
                    evidence: {
                        eventLogPath: eventBridge.getRunEventLogPath(run.runId),
                    },
                });

                _executePipeline(
                    run.runId,
                    pipelineIdentifier,
                    effectiveMode,
                    orchestrator,
                    runStore,
                    eventBridge,
                    activePipelines,
                    effectiveModel,
                    {
                        frameworkMode: hybridContext.frameworkMode,
                        appUrl: hybridContext.appUrl,
                        testCaseSource: hybridContext.testCaseSource,
                        testDataOverride: hybridContext.testDataOverride,
                        executionTarget: hybridContext.executionTarget,
                        hybridContext,
                        identifierType,
                        inputIdentifier: pipelineIdentifier,
                    }
                );

                accepted(res, {
                    runId: run.runId,
                    status: run.status,
                    ticketId: pipelineIdentifier,
                    identifierType,
                    mode: effectiveMode,
                    model: effectiveModel,
                    mission: run.mission,
                });
            })
            .catch(error => {
                json(res, 500, { error: `Failed to validate model: ${error.message}` });
            });
    });

    /**
     * POST /api/pipeline/batch
     * Body: { ticketIds: [...], mode?, environment?, triggeredBy? }
     * Returns: { batchId, runs: [...] }
     */
    router.post('/api/pipeline/batch', (req, res) => {
        const { ticketIds, sprintId, mode, environment, triggeredBy, mission } = req.body;

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
            mission,
        });

        for (const run of runs) {
            runStore.updateMission(run.runId, {
                evidence: {
                    eventLogPath: eventBridge.getRunEventLogPath(run.runId),
                },
            });
        }

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
            mode: run.mode,
            environment: run.environment,
            triggeredBy: run.triggeredBy,
            model: run.model,
            stages: run.stages,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            duration: run.duration,
            error: run.error,
            artifacts: run.artifacts,
            mission: run.mission,
        });
    });

    /**
     * GET /api/pipeline/command-output/:runId
     * Query:
     *   ?limit=300          — Max entries when `since` is not provided.
     *   ?since=<seq>        — Return only entries with seq > <seq> (incremental tail).
     *   ?kinds=chunk,progress — Comma list of kinds to include. Defaults to all.
     */
    router.get('/api/pipeline/command-output/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);

        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 300, 1000));
        const sinceRaw = req.query.since;
        const sinceSeq = sinceRaw !== undefined && sinceRaw !== null && sinceRaw !== ''
            ? Number.parseInt(sinceRaw, 10)
            : null;
        const kindsRaw = typeof req.query.kinds === 'string' ? req.query.kinds : '';
        const kinds = kindsRaw
            ? kindsRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : null;

        const payload = runStore.getCommandOutput(req.params.runId, {
            limit,
            sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : null,
            kinds: kinds && kinds.length > 0 ? kinds : undefined,
        });
        if (!payload) return notFound(res);

        ok(res, payload);
    });

    /**
     * GET /api/pipeline/checkpoint/:runId
     * Returns mission-aware checkpoint state for unattended run polling.
     */
    router.get('/api/pipeline/checkpoint/:runId', (req, res) => {
        const checkpoint = runStore.getMissionCheckpoint(req.params.runId);
        if (!checkpoint) return notFound(res);
        ok(res, checkpoint);
    });

    /**
     * GET /api/pipeline/events/:runId
     * Query: ?limit=200&source=persisted|buffer|all
     */
    router.get('/api/pipeline/events/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);

        const limit = parseInt(req.query.limit, 10) || 200;
        const source = req.query.source || 'all';
        const buffered = source === 'persisted' ? [] : eventBridge.getRunEvents(req.params.runId).slice(-limit);
        const persisted = source === 'buffer' ? [] : eventBridge.getPersistedRunEvents(req.params.runId, { limit });

        ok(res, {
            runId: req.params.runId,
            source,
            limit,
            eventLogPath: eventBridge.getRunEventLogPath(req.params.runId),
            bufferedCount: buffered.length,
            persistedCount: persisted.length,
            buffered,
            persisted,
        });
    });

    /**
     * GET /api/pipeline/evidence/:runId
     * Returns the persisted evidence manifest when available.
     */
    router.get('/api/pipeline/evidence/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);

        const manifestPath = run.artifacts?.evidenceManifest || run.mission?.evidence?.manifestPath;
        const scenarioManifestEntries = Object.entries(run.mission?.evidence?.scenarios || {})
            .filter(([, value]) => value?.manifestPath && fs.existsSync(value.manifestPath));

        if ((!manifestPath || !fs.existsSync(manifestPath)) && scenarioManifestEntries.length === 0) {
            return notFound(res, 'Evidence manifest not found');
        }

        try {
            const manifest = manifestPath && fs.existsSync(manifestPath)
                ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
                : null;
            const scenarioManifests = scenarioManifestEntries.map(([scenarioId, value]) => ({
                scenarioId,
                authState: value.authState || null,
                manifestPath: value.manifestPath,
                reportPath: value.reportPath || null,
                rawResultsPath: value.rawResultsPath || null,
                manifest: JSON.parse(fs.readFileSync(value.manifestPath, 'utf-8')),
            }));
            ok(res, {
                runId: req.params.runId,
                manifestPath,
                manifest,
                scenarioManifests,
            });
        } catch (error) {
            json(res, 500, { error: `Failed to read evidence manifest: ${error.message}` });
        }
    });

    /**
     * GET /api/pipeline/evidence-summary/:runId
     * Query: ?limit=20
     * Returns a parent-level, UI-ready evidence payload flattened across
     * authenticated and unauthenticated scenario manifests.
     */
    router.get('/api/pipeline/evidence-summary/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);

        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
        const manifestPath = run.artifacts?.evidenceManifest || run.mission?.evidence?.manifestPath;
        const scenarioManifestEntries = Object.entries(run.mission?.evidence?.scenarios || {})
            .filter(([, value]) => value?.manifestPath && fs.existsSync(value.manifestPath));

        if ((!manifestPath || !fs.existsSync(manifestPath)) && scenarioManifestEntries.length === 0) {
            return notFound(res, 'Evidence summary not found');
        }

        try {
            const manifest = manifestPath && fs.existsSync(manifestPath)
                ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
                : null;
            const scenarioManifests = scenarioManifestEntries.map(([scenarioId, value]) => ({
                scenarioId,
                authState: value.authState || null,
                manifestPath: value.manifestPath,
                reportPath: value.reportPath || null,
                rawResultsPath: value.rawResultsPath || null,
                manifest: JSON.parse(fs.readFileSync(value.manifestPath, 'utf-8')),
            }));

            ok(res, buildEvidenceSummary(run, manifest, scenarioManifests, { limit }));
        } catch (error) {
            json(res, 500, { error: `Failed to build evidence summary: ${error.message}` });
        }
    });

    /**
     * GET /api/pipeline/artifact
     * Query: ?path=<absolutePath>&disposition=inline|attachment
     * Streams a mission artifact from a restricted set of evidence roots.
     */
    router.get('/api/pipeline/artifact', async (req, res) => {
        const requestedPath = req.query.path;
        const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';

        if (!requestedPath || typeof requestedPath !== 'string') {
            return badRequest(res, 'Missing artifact path');
        }

        const filePath = path.resolve(requestedPath);

        // CWE-22 fix: resolve symlinks before checking allowed paths to prevent traversal
        let realPath;
        try {
            realPath = fs.realpathSync(filePath);
        } catch {
            return notFound(res, 'Artifact not found');
        }

        if (!_isAllowedArtifactPath(realPath, orchestrator.config)) {
            return json(res, 403, { error: 'Artifact path is outside allowed evidence directories' });
        }

        let stat;
        try {
            stat = await fsP.stat(realPath);
        } catch {
            return notFound(res, 'Artifact not found');
        }

        if (!stat.isFile()) {
            return badRequest(res, 'Artifact path must be a file');
        }

        const fileName = path.basename(realPath).replace(/[\r\n"]/g, '_');
        const stream = fs.createReadStream(realPath);

        res.writeHead(200, {
            'Content-Type': _getMimeType(realPath),
            'Content-Length': stat.size,
            'Content-Disposition': `${disposition}; filename="${fileName}"`,
            'Cache-Control': 'no-store',
        });

        stream.on('error', (error) => {
            if (!res.headersSent) {
                json(res, 500, { error: `Failed to read artifact: ${error.message}` });
                return;
            }
            res.destroy(error);
        });

        stream.pipe(res);
    });

    /**
     * GET /api/pipeline/observations/:runId
     * Query: ?limit=50
     * Returns a dashboard-focused observation summary without requiring clients
     * to parse the full evidence manifest.
     */
    router.get('/api/pipeline/observations/:runId', (req, res) => {
        const run = runStore.getRun(req.params.runId);
        if (!run) return notFound(res);

        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 200));
        const observationRecorder = new ObservationRecorder({ projectRoot: path.join(__dirname, '..', '..') });
        const observationLogPath = observationRecorder.getObservationLogPath(req.params.runId);
        const observations = observationRecorder.readObservations(req.params.runId, 1000);

        ok(res, buildObservationSummary(run, observations, observationLogPath, { limit }));
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
                    const runnerErrors = normalizePlaywrightErrors(pw.errors, {
                        ticketId: raw.ticketId,
                        runId: raw.runId,
                        specPath: raw.specPath,
                        timestamp: raw.timestamp,
                    });
                    const promoteRunnerErrors = stats.total === 0 && runnerErrors.length > 0;

                    return {
                        fileName: file,
                        ticketId: raw.ticketId,
                        runId: raw.runId,
                        mode: raw.mode,
                        specPath: raw.specPath,
                        timestamp: raw.timestamp,
                        runnerErrors: runnerErrors.length,
                        summary: {
                            totalSpecs: stats.total + (promoteRunnerErrors ? runnerErrors.length : 0),
                            passed: stats.passed,
                            failed: stats.failed,
                            broken: stats.broken + (promoteRunnerErrors ? runnerErrors.length : 0),
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
            if (!fs.existsSync(reportsDir)) return ok(res, { total: 0, suites: [], errors: [], filter: null });

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
            const globalErrors = [];

            for (const [ticketId, raw] of latestByTicket) {
                const pw = raw.playwrightResult || {};
                const runnerErrors = normalizePlaywrightErrors(pw.errors, {
                    ticketId,
                    runId: raw.runId,
                    specPath: raw.specPath,
                    timestamp: raw.timestamp,
                });
                globalErrors.push(...runnerErrors);

                const { suites, stats } = transformSuites(pw.suites || [], { ticketId });

                if (stats.total === 0 && runnerErrors.length > 0) {
                    const runnerSuite = buildRunnerErrorSuite(ticketId, raw.specPath, runnerErrors);
                    if (runnerSuite) {
                        allSuites.push(runnerSuite);
                        aggregateStats.total += runnerErrors.length;
                        aggregateStats.broken += runnerErrors.length;
                    }
                } else {
                    allSuites.push(...suites);
                    for (const k of Object.keys(aggregateStats)) {
                        aggregateStats[k] += stats[k];
                    }
                }
            }

            ok(res, {
                ...aggregateStats,
                suites: allSuites,
                errors: globalErrors,
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
            const runnerErrors = normalizePlaywrightErrors(pw.errors, {
                ticketId: raw.ticketId,
                runId: raw.runId,
                specPath: raw.specPath,
                timestamp: raw.timestamp,
            });
            let { suites } = transformSuites(pw.suites || [], { includeAttachments: true });
            if (suites.length === 0 && runnerErrors.length > 0) {
                const runnerSuite = buildRunnerErrorSuite(raw.ticketId || fileName, raw.specPath, runnerErrors);
                if (runnerSuite) suites = [runnerSuite];
            }

            ok(res, {
                ticketId: raw.ticketId,
                runId: raw.runId,
                mode: raw.mode,
                specPath: raw.specPath,
                timestamp: raw.timestamp,
                errors: runnerErrors,
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
    // SCHEDULER (one-time scheduled actions)
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/scheduler/jobs
     * Body: { schedule: { kind?, delayMs?, runAt?, timezone? }, action: { type, params }, source?, sessionId? }
     * Returns: { job }
     */
    router.post('/api/scheduler/jobs', (req, res) => {
        const body = req.body || {};
        const action = body.action;
        const schedule = body.schedule || {};

        const actionError = schedulerActions.validate(action);
        if (actionError) return badRequest(res, actionError);

        // Extract + validate agent.invoke attachments (screenshots/recordings). Raw
        // media is NOT stored in the job — it is persisted durably once the job id
        // is known, and the job keeps only lightweight refs.
        let rawAttachments = null;
        if (action?.type === 'agent.invoke' && Array.isArray(action?.params?.attachments) && action.params.attachments.length > 0) {
            const attCheck = schedulerAttachmentStore.validate(action.params.attachments);
            if (!attCheck.ok) return badRequest(res, attCheck.error);
            rawAttachments = action.params.attachments;
        }

        // Resolve an absolute runAt (UTC) from either a relative delay or an
        // absolute timestamp. Delay wins when both are present.
        let runAtMs;
        const hasDelay = Number.isFinite(Number(schedule.delayMs));
        const runAtStr = typeof schedule.runAt === 'string' ? schedule.runAt.trim() : '';
        if (schedule.kind === 'delay' || hasDelay) {
            const delayMs = Number(schedule.delayMs);
            if (!Number.isFinite(delayMs) || delayMs < 0) {
                return badRequest(res, 'schedule.delayMs must be a non-negative number for a delay schedule.');
            }
            runAtMs = Date.now() + delayMs;
        } else if (runAtStr) {
            const parsed = new Date(runAtStr).getTime();
            if (!Number.isFinite(parsed)) {
                return badRequest(res, 'schedule.runAt must be a valid ISO date/time.');
            }
            runAtMs = parsed;
        } else {
            return badRequest(res, 'Provide schedule.delayMs (relative) or schedule.runAt (absolute time).');
        }

        // Reject scheduling meaningfully in the past (allow a 60s grace window).
        if (runAtMs < Date.now() - 60000) {
            return badRequest(res, 'Scheduled time is in the past.');
        }

        // Strip inline media before persistence; durable refs are attached below.
        const persistedAction = rawAttachments
            ? { ...action, params: { ...action.params, attachments: [] } }
            : action;

        const job = schedulerStore.createJob({
            runAt: new Date(runAtMs).toISOString(),
            action: persistedAction,
            schedule: {
                kind: schedule.kind || (hasDelay ? 'delay' : 'datetime'),
                delayMs: hasDelay ? Number(schedule.delayMs) : null,
                timezone: typeof schedule.timezone === 'string' && schedule.timezone.trim() ? schedule.timezone.trim() : 'UTC',
            },
            createdBy: { source: body.source || 'web-app', sessionId: body.sessionId || null },
            maxAttempts: schedulerConfigRoot?.scheduler?.maxAttempts,
        });

        // Persist durable attachments (decode images, copy recordings out of the
        // volatile upload dir) and record lightweight refs on the job.
        if (rawAttachments) {
            try {
                const refs = schedulerAttachmentStore.persistForJob(job.jobId, rawAttachments);
                schedulerStore.updateJob(job.jobId, {
                    action: { ...persistedAction, params: { ...persistedAction.params, attachments: refs } },
                });
            } catch (err) {
                log(`[Scheduler] Attachment persist failed for ${job.jobId}: ${err.message}`, 'warn');
            }
        }

        accepted(res, { job: schedulerStore.getJob(job.jobId) || job });
    });

    /**
     * GET /api/scheduler/jobs
     * Query: ?status=&actionType=&limit=&offset=
     */
    router.get('/api/scheduler/jobs', (req, res) => {
        const filters = {
            status: req.query.status || undefined,
            actionType: req.query.actionType || undefined,
            limit: parseInt(req.query.limit, 10) || 100,
            offset: parseInt(req.query.offset, 10) || 0,
        };
        ok(res, {
            ...schedulerStore.listJobs(filters),
            stats: schedulerStore.getStats(),
            actionTypes: schedulerActions.listTypes(),
        });
    });

    /**
     * GET /api/scheduler/jobs/:jobId
     */
    router.get('/api/scheduler/jobs/:jobId', (req, res) => {
        const job = schedulerStore.getJob(req.params.jobId);
        if (!job) return notFound(res, `Job ${req.params.jobId} not found`);
        ok(res, { job });
    });

    /**
     * DELETE /api/scheduler/jobs/:jobId — cancel a pending job
     */
    router.delete('/api/scheduler/jobs/:jobId', (req, res) => {
        const cancelled = schedulerStore.cancelJob(req.params.jobId);
        if (!cancelled) return conflict(res, 'Job not found or not cancellable (already running or terminal).');
        schedulerAttachmentStore.cleanupJob(req.params.jobId);
        ok(res, { job: cancelled });
    });

    /**
     * POST /api/scheduler/jobs/:jobId/run-now — fire immediately
     */
    router.post('/api/scheduler/jobs/:jobId/run-now', async (req, res) => {
        const result = await schedulerEngine.runNow(req.params.jobId);
        if (!result.ok) return badRequest(res, result.error);
        ok(res, { job: schedulerStore.getJob(req.params.jobId) });
    });

    /**
     * GET /api/scheduler/jobs/:jobId/attachments/:attId
     * Streams a stored agent.invoke attachment (screenshot / recording) for preview.
     */
    router.get('/api/scheduler/jobs/:jobId/attachments/:attId', (req, res) => {
        const file = schedulerAttachmentStore.getAttachmentFile(req.params.jobId, req.params.attId);
        if (!file) return notFound(res, 'Attachment not found');
        try {
            const data = fs.readFileSync(file.path);
            res.writeHead(200, {
                'Content-Type': file.mediaType || 'application/octet-stream',
                'Content-Length': file.size,
                'Cache-Control': 'private, max-age=3600',
            });
            res.end(data);
        } catch (err) {
            json(res, 500, { error: `Failed to read attachment: ${err.message}` });
        }
    });

    /**
     * POST /api/scheduler/ai-draft
     * Runs BugGenie/TaskGenie in draft-only mode to compose a ticket for review.
     * NOTHING is written to Jira. The approved draft is later scheduled as a
     * `jira.ai-create` job.
     * Body: { agent?, issueType?, projectKey?, prompt, priority?, linkedIssueKey?, parentIssueKey?, attachments?: [{type:'image',media_type,data}|{type:'video',media_type,tempPath,filename?}] }
     * Returns: { draftId, agent, draft }
     */
    router.post('/api/scheduler/ai-draft', async (req, res) => {
        const body = req.body || {};
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) return badRequest(res, 'A prompt describing the issue or task is required.');

        const agent = typeof body.agent === 'string' ? body.agent.trim().toLowerCase() : '';
        if (agent && !['buggenie', 'taskgenie'].includes(agent)) {
            return badRequest(res, 'agent must be "buggenie" or "taskgenie".');
        }

        // Validate + normalize attachments. Images arrive as inline base64; videos
        // arrive as a tempPath from POST /api/chat/upload-video and MUST resolve
        // inside the managed upload directory (prevents arbitrary local file reads).
        const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
        const attachments = [];
        let imageCount = 0;
        let videoCount = 0;
        for (const att of rawAttachments) {
            if (!att || typeof att !== 'object') continue;
            if (att.type === 'image') {
                if (++imageCount > 10) return badRequest(res, 'Too many images (max 10).');
                if (!VALID_IMAGE_MEDIA.includes(att.media_type)) return badRequest(res, `Unsupported image type: ${att.media_type}`);
                if (typeof att.data !== 'string' || !att.data) return badRequest(res, 'Image attachment requires base64 data.');
                if (att.data.length > 14 * 1024 * 1024) return badRequest(res, 'Image attachment too large (max ~10 MB).');
                attachments.push({ type: 'image', media_type: att.media_type, data: att.data });
            } else if (att.type === 'video') {
                if (++videoCount > 2) return badRequest(res, 'Too many videos (max 2).');
                if (!VALID_VIDEO_MEDIA.includes(att.media_type)) return badRequest(res, `Unsupported video type: ${att.media_type}`);
                if (typeof att.tempPath !== 'string' || !att.tempPath) return badRequest(res, 'Video attachment requires tempPath from the upload endpoint.');
                const resolved = path.resolve(att.tempPath);
                if (!_isPathInside(path.resolve(VIDEO_UPLOAD_DIR), resolved) || !fs.existsSync(resolved)) {
                    return badRequest(res, 'Invalid or missing video tempPath. Please re-upload the recording.');
                }
                attachments.push({
                    type: 'video',
                    media_type: att.media_type,
                    tempPath: resolved,
                    filename: typeof att.filename === 'string' ? att.filename.replace(/[\\/]/g, '').replace(/\.\./g, '') : 'recording',
                });
            }
            // documents / video_link are not used for ticket drafting in v1
        }

        try {
            const result = await aiTicketDrafter.generateDraft({
                agent,
                issueType: typeof body.issueType === 'string' ? body.issueType : undefined,
                projectKey: typeof body.projectKey === 'string' ? body.projectKey : undefined,
                prompt,
                priority: typeof body.priority === 'string' ? body.priority : undefined,
                linkedIssueKey: typeof body.linkedIssueKey === 'string' ? body.linkedIssueKey : undefined,
                parentIssueKey: typeof body.parentIssueKey === 'string' ? body.parentIssueKey : undefined,
                attachments,
            });
            if (!result.ok) {
                return json(res, 422, { error: result.error, agentResponse: result.agentResponse || null });
            }
            ok(res, { draftId: result.draftId, agent: result.agent, draft: result.draft });
        } catch (err) {
            log(`AI draft error: ${err.message}`, 'error');
            return json(res, 500, { error: `Draft generation failed: ${err.message}` });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // JIRA WEBHOOK (Phase 4 — pre-wired)
    // ═════════════════════════════════════════════════════════════════

    /**
     * GET /api/webhooks/jira/lifecycle/config
     * Returns lifecycle runtime configuration without exposing secrets.
     */
    router.get('/api/webhooks/jira/lifecycle/config', (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            ok(res, {
                ...jiraWebhookLifecycle.getRuntimeConfig(),
                startupSync: getWebhookStartupSyncConfig(),
                persistedState: jiraWebhookReliabilityStore.getLifecycleState(),
            });
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira/lifecycle/sync
     * Runs a manual lifecycle startup sync (refresh persisted IDs + register if needed).
     */
    router.post('/api/webhooks/jira/lifecycle/sync', async (req, res) => {
        try {
            const startupDefaults = getWebhookStartupSyncConfig();
            const summary = await runJiraWebhookLifecycleSync('manual', {
                refreshPersistedIds: typeof req.body?.refreshPersistedIds === 'boolean'
                    ? req.body.refreshPersistedIds
                    : startupDefaults.refreshPersistedIds,
                registerIfMissing: typeof req.body?.registerIfMissing === 'boolean'
                    ? req.body.registerIfMissing
                    : startupDefaults.registerIfMissing,
            });
            ok(res, summary);
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * GET /api/webhooks/jira/lifecycle
     * Lists currently registered Jira dynamic webhooks.
     */
    router.get('/api/webhooks/jira/lifecycle', async (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            ok(res, await jiraWebhookLifecycle.listWebhooks({
                startAt: req.query.startAt,
                maxResults: req.query.maxResults,
            }));
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira/lifecycle/register
     * Body: { jqlFilter, events, url?, callbackBaseUrl?, callbackPath?, excludeBody?, fieldIdsFilter?, issuePropertyKeysFilter? }
     */
    router.post('/api/webhooks/jira/lifecycle/register', async (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            const result = await jiraWebhookLifecycle.registerWebhook(req.body || {});
            if (Array.isArray(result.createdWebhookIds) && result.createdWebhookIds.length > 0) {
                jiraWebhookReliabilityStore.addPersistedWebhookIds(result.createdWebhookIds, {
                    source: 'manual-register',
                });
            }
            json(res, 201, result);
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira/lifecycle/refresh
     * Body: { webhookIds?: string[], refreshAll?: boolean }
     */
    router.post('/api/webhooks/jira/lifecycle/refresh', async (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            const refreshAll = req.body?.refreshAll === true || req.query.refreshAll === 'true';
            const result = await jiraWebhookLifecycle.refreshWebhooks({
                webhookIds: req.body?.webhookIds,
                refreshAll,
            });

            if (Array.isArray(result.refreshedWebhookIds) && result.refreshedWebhookIds.length > 0) {
                jiraWebhookReliabilityStore.setPersistedWebhookIds(result.refreshedWebhookIds, {
                    source: 'manual-refresh',
                });
            }

            ok(res, result);
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * GET /api/webhooks/jira/lifecycle/failed
     * Returns Jira failed webhook deliveries.
     */
    router.get('/api/webhooks/jira/lifecycle/failed', async (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            ok(res, await jiraWebhookLifecycle.getFailedWebhooks({
                maxResults: req.query.maxResults,
            }));
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira/lifecycle/delete
     * Body: { webhookIds: string[] }
     */
    router.post('/api/webhooks/jira/lifecycle/delete', async (req, res) => {
        try {
            jiraWebhookLifecycle.updateOrchestratorConfig(orchestrator?.config || {});
            const result = await jiraWebhookLifecycle.deleteWebhooks({
                webhookIds: req.body?.webhookIds,
            });

            if (Array.isArray(result.deletedWebhookIds) && result.deletedWebhookIds.length > 0) {
                jiraWebhookReliabilityStore.removePersistedWebhookIds(result.deletedWebhookIds, {
                    source: 'manual-delete',
                });
            }

            ok(res, result);
        } catch (error) {
            respondLifecycleError(res, error);
        }
    });

    /**
     * GET /api/webhooks/jira/queue
     * Returns queue/processing/DLQ state for Jira webhook ingestion.
     */
    router.get('/api/webhooks/jira/queue', (req, res) => {
        try {
            const ingestionConfig = getWebhookIngestionConfig();
            const { storeFile, ...publicIngestionConfig } = ingestionConfig;

            ok(res, {
                ingestion: publicIngestionConfig,
                lifecycle: jiraWebhookReliabilityStore.getLifecycleState(),
                queue: jiraWebhookReliabilityStore.getQueueSnapshot({
                    includePayload: req.query.includePayload === 'true',
                    limit: req.query.limit,
                }),
            });
        } catch (error) {
            respondWebhookQueueError(res, error);
        }
    });

    /**
     * GET /api/webhooks/jira/dlq
     * Lists dead-lettered Jira webhook deliveries.
     */
    router.get('/api/webhooks/jira/dlq', (req, res) => {
        try {
            ok(res, jiraWebhookReliabilityStore.listDeadLetters({
                limit: req.query.limit,
                offset: req.query.offset,
                includePayload: req.query.includePayload === 'true',
            }));
        } catch (error) {
            respondWebhookQueueError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira/dlq/replay
     * Body: { deliveryIds?: string[], replayAll?: boolean, limit?: number }
     */
    router.post('/api/webhooks/jira/dlq/replay', (req, res) => {
        try {
            const replayAll = req.body?.replayAll === true || req.query.replayAll === 'true';
            const replayResult = jiraWebhookReliabilityStore.replayDeadLetters({
                deliveryIds: req.body?.deliveryIds,
                replayAll,
                limit: req.body?.limit || req.query.limit,
            });

            if (replayResult.replayedCount > 0) {
                scheduleJiraWebhookQueueProcessing(0);
            }

            ok(res, replayResult);
        } catch (error) {
            respondWebhookQueueError(res, error);
        }
    });

    /**
     * POST /api/webhooks/jira
     * Receives Jira webhook events for auto-triggering pipelines.
     */
    router.post('/api/webhooks/jira', async (req, res) => {
        const webhookConfig = resolveJiraWebhookRuntimeConfig(orchestrator?.config || {});
        if (!webhookConfig.enabled) {
            return ok(res, {
                acknowledged: true,
                action: 'ignored',
                reason: 'Jira webhook trigger is disabled in workflow-config.',
            });
        }

        const webhookSecret = process.env[webhookConfig.secretEnv];
        const signatureHeader = req.headers['x-hub-signature'] || req.headers['x-hub-signature-256'];
        const signatureResult = verifyJiraWebhookSignature(
            typeof req.rawBody === 'string' ? req.rawBody : '',
            signatureHeader,
            webhookSecret
        );

        if (!signatureResult.ok) {
            const status = signatureResult.reason === 'missing-secret' ? 503 : 401;
            const message = signatureResult.reason === 'missing-secret'
                ? `Jira webhook secret is not configured. Set ${webhookConfig.secretEnv} in environment.`
                : 'Invalid Jira webhook signature.';
            return json(res, status, {
                error: message,
                reason: signatureResult.reason,
            });
        }

        const payload = req.body;

        // Validate basic structure
        if (!payload || !payload.issue) {
            return badRequest(res, 'Invalid Jira webhook payload');
        }

        const issueKey = payload.issue?.key;
        if (!issueKey) {
            return badRequest(res, 'Missing issue key in webhook payload');
        }
        if (!isValidTicketId(issueKey)) {
            return badRequest(res, `Invalid issue key in webhook payload: "${issueKey}"`);
        }

        const now = Date.now();
        pruneJiraWebhookReplayCache(jiraWebhookReplayCache, now, JIRA_WEBHOOK_REPLAY_TTL_MS);

        const webhookReplayKey = buildJiraWebhookReplayKey(payload, req.headers || {});
        if (jiraWebhookReplayCache.has(webhookReplayKey)) {
            return ok(res, {
                acknowledged: true,
                action: 'ignored',
                reason: 'Duplicate webhook delivery ignored.',
                webhookId: req.headers['x-atlassian-webhook-identifier'] || null,
                retryCount: req.headers['x-atlassian-webhook-retry'] || null,
            });
        }

        // Check for status transition to configured trigger status
        const changelog = payload.changelog;
        const statusChange = changelog?.items?.find(item => item.field === 'status');

        if (!statusChange) {
            // Not a status change — acknowledge but don't trigger
            jiraWebhookReplayCache.set(webhookReplayKey, now);
            return ok(res, { acknowledged: true, action: 'ignored', reason: 'No status change' });
        }

        const newStatus = statusChange.toString || '';
        const triggerStatuses = webhookConfig.triggerStatuses;

        if (!triggerStatuses.some(s => newStatus.toLowerCase().includes(s.toLowerCase()))) {
            jiraWebhookReplayCache.set(webhookReplayKey, now);
            return ok(res, {
                acknowledged: true,
                action: 'ignored',
                reason: `Status "${newStatus}" is not a trigger status`,
            });
        }

        const mode = webhookConfig.defaultMode;

        const ingestionConfig = getWebhookIngestionConfig();
        const deliveryHeaders = {
            identifier: req.headers['x-atlassian-webhook-identifier'] || null,
            retryCount: req.headers['x-atlassian-webhook-retry'] || null,
            event: payload.webhookEvent || null,
        };

        if (!ingestionConfig.enabled) {
            try {
                const directResult = triggerPipelineFromWebhookDelivery({
                    issueKey,
                    mode,
                    headers: deliveryHeaders,
                });
                jiraWebhookReplayCache.set(webhookReplayKey, now);

                if (directResult.action === 'ignored') {
                    return ok(res, {
                        acknowledged: true,
                        ...directResult,
                        ticketId: issueKey,
                        mode,
                        webhookId: deliveryHeaders.identifier,
                        retryCount: deliveryHeaders.retryCount,
                    });
                }

                return accepted(res, {
                    acknowledged: true,
                    ...directResult,
                });
            } catch (error) {
                return respondWebhookQueueError(res, error);
            }
        }

        let enqueueResult;
        try {
            enqueueResult = jiraWebhookReliabilityStore.enqueueDelivery({
                issueKey,
                mode,
                webhookReplayKey,
                payload,
                headers: deliveryHeaders,
            });
        } catch (error) {
            return respondWebhookQueueError(res, error);
        }

        jiraWebhookReplayCache.set(webhookReplayKey, now);

        if (enqueueResult.duplicate) {
            return ok(res, {
                acknowledged: true,
                action: 'ignored',
                reason: 'Duplicate webhook delivery already exists in queue state.',
                deliveryId: enqueueResult.delivery?.deliveryId || null,
                queueDepth: enqueueResult.queueDepth,
                webhookId: deliveryHeaders.identifier,
                retryCount: deliveryHeaders.retryCount,
            });
        }

        scheduleJiraWebhookQueueProcessing(0);

        return accepted(res, {
            acknowledged: true,
            action: 'queued',
            deliveryId: enqueueResult.delivery?.deliveryId || null,
            queueDepth: enqueueResult.queueDepth,
            ticketId: issueKey,
            mode,
            triggeredBy: 'jira-webhook',
            webhookId: deliveryHeaders.identifier,
            retryCount: deliveryHeaders.retryCount,
        });
    });

    // ═════════════════════════════════════════════════════════════════
    // FILESYSTEM BROWSE (FileGenie directory picker)
    // ═════════════════════════════════════════════════════════════════

    /**
     * GET /api/filesystem/quick-access
     * Returns platform-specific common directories for quick selection.
     */
    router.get('/api/filesystem/quick-access', (req, res) => {
        const os = require('os');
        const home = os.homedir();
        const dirs = [
            { name: 'Home', path: home },
            { name: 'Desktop', path: path.join(home, 'Desktop') },
            { name: 'Documents', path: path.join(home, 'Documents') },
            { name: 'Downloads', path: path.join(home, 'Downloads') },
        ];

        // Add project root
        const projectRoot = path.resolve(__dirname, '..', '..');
        dirs.push({ name: 'Project Root', path: projectRoot });

        // Check existence
        const results = dirs.map(d => ({
            name: d.name,
            path: d.path,
            exists: fs.existsSync(d.path) && fs.statSync(d.path).isDirectory(),
        }));

        ok(res, { home, directories: results });
    });

    /**
     * POST /api/filesystem/pick-directory
     * Opens the native OS folder picker dialog and returns the selected path.
     * Works because the server always runs on the same machine as the browser.
     */
    router.post('/api/filesystem/pick-directory', async (req, res) => {
        const { execFile } = require('child_process');

        const pick = () => new Promise((resolve, reject) => {
            let cmd, args;

            if (process.platform === 'win32') {
                // PowerShell: use .NET FolderBrowserDialog (built-in, no extra deps)
                const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Select a workspace folder'
$dlg.ShowNewFolderButton = $true
$result = $dlg.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dlg.SelectedPath
} else {
    Write-Output '::CANCELLED::'
}`;
                cmd = 'powershell';
                args = ['-NoProfile', '-NonInteractive', '-Command', psScript];
            } else if (process.platform === 'darwin') {
                // macOS: AppleScript folder dialog
                cmd = 'osascript';
                args = ['-e', 'try\nset f to POSIX path of (choose folder with prompt "Select a workspace folder")\nreturn f\non error\nreturn "::CANCELLED::"\nend try'];
            } else {
                // Linux: zenity (GNOME) or kdialog (KDE)
                cmd = 'zenity';
                args = ['--file-selection', '--directory', '--title=Select a workspace folder'];
            }

            const child = execFile(cmd, args, { timeout: 60000, windowsHide: false }, (err, stdout) => {
                if (err) {
                    // zenity returns exit code 1 on cancel
                    if (err.killed) return reject(new Error('Dialog timed out'));
                    return resolve(null); // cancelled or failed
                }
                const selected = (stdout || '').trim();
                if (!selected || selected === '::CANCELLED::') return resolve(null);
                resolve(selected);
            });

            // Ensure cleanup
            child.on('error', () => resolve(null));
        });

        try {
            const selected = await pick();
            if (!selected) return ok(res, { cancelled: true });

            const resolved = path.resolve(selected);

            // Validate against blocked paths
            const normalizedForCheck = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
            for (const blocked of BLOCKED_PATHS) {
                if (normalizedForCheck.startsWith(blocked) || normalizedForCheck === blocked) {
                    return json(res, 403, { error: `Access denied: "${resolved}" is a protected system directory.` });
                }
            }

            // Verify it's an existing directory
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
                return badRequest(res, `Selected path is not a valid directory: ${resolved}`);
            }

            ok(res, { path: resolved });
        } catch (error) {
            json(res, 500, { error: `Failed to open folder picker: ${error.message}` });
        }
    });

    /**
     * GET /api/filesystem/browse?path=<encodedPath>&dirsOnly=true
     * List contents of a directory. Returns names, types, sizes.
     * Blocks system directories for safety.
     */
    router.get('/api/filesystem/browse', async (req, res) => {
        const dirPath = req.query?.path;
        if (!dirPath) return badRequest(res, 'Missing "path" query parameter');

        const resolved = path.resolve(dirPath);
        const normalizedForCheck = process.platform === 'win32' ? resolved.toLowerCase() : resolved;

        // Block system directories
        for (const blocked of BLOCKED_PATHS) {
            if (normalizedForCheck.startsWith(blocked) || normalizedForCheck === blocked) {
                return json(res, 403, { error: `Access denied: "${resolved}" is a protected system directory.` });
            }
        }

        try {
            if (!fs.existsSync(resolved)) return notFound(res, `Directory not found: ${resolved}`);
            const st = fs.statSync(resolved);
            if (!st.isDirectory()) return badRequest(res, `Path is not a directory: ${resolved}`);

            const items = fs.readdirSync(resolved);
            const dirsOnly = req.query?.dirsOnly === 'true';
            const MAX_ENTRIES = 500;

            const entries = [];
            for (const name of items) {
                if (entries.length >= MAX_ENTRIES) break;
                try {
                    const fullPath = path.join(resolved, name);
                    const s = fs.statSync(fullPath);
                    const isDir = s.isDirectory();
                    if (dirsOnly && !isDir) continue;
                    entries.push({
                        name,
                        type: isDir ? 'directory' : 'file',
                        size: isDir ? null : s.size,
                        modified: s.mtime.toISOString(),
                    });
                } catch { /* skip inaccessible entries */ }
            }

            // Sort: directories first, then files, alphabetical within each
            entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

            ok(res, {
                path: resolved,
                parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
                entries,
                truncated: items.length > MAX_ENTRIES,
            });
        } catch (error) {
            json(res, 500, { error: `Failed to browse directory: ${error.message}` });
        }
    });

    /**
     * POST /api/filesystem/open-file
     * Opens a file with its default native application.
     * Body: { path: string (absolute path to file) }
     * Works because the server always runs on the same machine as the browser.
     */
    router.post('/api/filesystem/open-file', async (req, res) => {
        const { execFile } = require('child_process');
        const filePath = req.body?.path;

        if (!filePath || typeof filePath !== 'string') {
            return badRequest(res, 'Missing or invalid "path" in request body');
        }

        const resolved = path.resolve(filePath);

        // Block system directories
        const normalizedForCheck = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        for (const blocked of BLOCKED_PATHS) {
            if (normalizedForCheck.startsWith(blocked) || normalizedForCheck === blocked) {
                return json(res, 403, { error: `Access denied: "${resolved}" is in a protected system directory.` });
            }
        }

        // Verify the file exists
        if (!fs.existsSync(resolved)) {
            return notFound(res, `File not found: ${resolved}`);
        }
        const fileStat = fs.statSync(resolved);
        if (fileStat.isDirectory()) {
            return badRequest(res, `Path is a directory — use /api/filesystem/open-folder instead.`);
        }

        try {
            let cmd, args;
            if (process.platform === 'win32') {
                cmd = 'cmd';
                args = ['/c', 'start', '', resolved];
            } else if (process.platform === 'darwin') {
                cmd = 'open';
                args = [resolved];
            } else {
                cmd = 'xdg-open';
                args = [resolved];
            }

            await new Promise((resolve, reject) => {
                execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            const ext = path.extname(resolved).toLowerCase();
            ok(res, {
                opened: true,
                file: path.basename(resolved),
                extension: ext,
                application: getAppNameForExtension(ext),
            });
        } catch (error) {
            json(res, 500, { error: `Failed to open file: ${error.message}` });
        }
    });

    /**
     * POST /api/filesystem/open-folder
     * Opens a folder (or the containing folder of a file) in the native file explorer.
     * Body: { path: string (absolute path to file or folder) }
     */
    router.post('/api/filesystem/open-folder', async (req, res) => {
        const { execFile } = require('child_process');
        const targetPath = req.body?.path;

        if (!targetPath || typeof targetPath !== 'string') {
            return badRequest(res, 'Missing or invalid "path" in request body');
        }

        const resolved = path.resolve(targetPath);

        // Block system directories
        const normalizedForCheck = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        for (const blocked of BLOCKED_PATHS) {
            if (normalizedForCheck.startsWith(blocked) || normalizedForCheck === blocked) {
                return json(res, 403, { error: `Access denied: "${resolved}" is in a protected system directory.` });
            }
        }

        // Verify path exists
        if (!fs.existsSync(resolved)) {
            return notFound(res, `Path not found: ${resolved}`);
        }

        // Determine what to open — if it's a file, open its parent and select it
        const fileStat = fs.statSync(resolved);
        const isFile = !fileStat.isDirectory();

        try {
            let cmd, args;
            if (process.platform === 'win32') {
                if (isFile) {
                    // Explorer /select highlights the file in its folder
                    cmd = 'explorer';
                    args = ['/select,', resolved];
                } else {
                    cmd = 'explorer';
                    args = [resolved];
                }
            } else if (process.platform === 'darwin') {
                if (isFile) {
                    cmd = 'open';
                    args = ['-R', resolved]; // -R reveals in Finder
                } else {
                    cmd = 'open';
                    args = [resolved];
                }
            } else {
                const folderPath = isFile ? path.dirname(resolved) : resolved;
                cmd = 'xdg-open';
                args = [folderPath];
            }

            await new Promise((resolvePromise, reject) => {
                const child = execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err) => {
                    // explorer.exe on Windows returns exit code 1 even on success
                    if (err && process.platform !== 'win32') return reject(err);
                    resolvePromise();
                });
                child.on('error', () => resolvePromise()); // Don't fail on non-critical errors
            });

            ok(res, {
                opened: true,
                target: path.basename(resolved),
                isFile,
                folder: isFile ? path.dirname(resolved) : resolved,
            });
        } catch (error) {
            json(res, 500, { error: `Failed to open folder: ${error.message}` });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // VIDEO UPLOAD (Streaming — prevents OOM for large recordings)
    // ═════════════════════════════════════════════════════════════════

    const VALID_VIDEO_MEDIA = [
        'video/mp4', 'video/webm', 'video/quicktime',
        'video/x-msvideo', 'video/x-matroska',
    ];
    const videoRetentionConfig = resolveChatVideoRetentionConfig(orchestrator?.config || {});
    const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
    const VIDEO_UPLOAD_DIR = path.join(os.tmpdir(), 'qa-video-uploads');
    const VIDEO_UNCLAIMED_TTL_MS = videoRetentionConfig.unclaimedTtlMs;
    const VIDEO_CLAIMED_MAX_AGE_MS = videoRetentionConfig.claimedMaxAgeMs;
    const VIDEO_CLEANUP_INTERVAL_MS = videoRetentionConfig.cleanupIntervalMs;
    const videoUploadClaims = new Map();
    let videoClaimHydrated = false;

    function getVideoClaimKey(filePath) {
        const resolved = path.resolve(filePath);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    function isNonEmptySessionId(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function getFileCreatedAtMs(filePath) {
        try {
            const stat = fs.statSync(filePath);
            if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) {
                return stat.birthtimeMs;
            }
            if (Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0) {
                return stat.mtimeMs;
            }
        } catch {
            // Ignore stat failures and fall back to now
        }
        return Date.now();
    }

    function ensureVideoClaimRecord(filePath) {
        const resolvedPath = path.resolve(filePath);
        const key = getVideoClaimKey(resolvedPath);
        const now = Date.now();

        let record = videoUploadClaims.get(key);
        if (!record) {
            record = {
                path: resolvedPath,
                createdAtMs: getFileCreatedAtMs(resolvedPath),
                lastSeenAtMs: now,
                claimedBySessionId: null,
                claimedAtMs: null,
            };
            videoUploadClaims.set(key, record);
            return record;
        }

        record.lastSeenAtMs = now;
        return record;
    }

    function isSessionActiveForVideoRetention(sessionId) {
        if (!chatManager || !chatManager._sessions || !(chatManager._sessions instanceof Map)) {
            return false;
        }

        const entry = chatManager._sessions.get(sessionId);
        return !!entry && entry.archived !== true;
    }

    function claimVideoUploadForSession(sessionId, filePath) {
        if (!isNonEmptySessionId(sessionId)) {
            return { ok: false, error: 'Invalid session for video evidence claim.' };
        }

        const resolvedPath = path.resolve(filePath);
        const uploadRoot = path.resolve(VIDEO_UPLOAD_DIR);

        if (!_isPathInside(uploadRoot, resolvedPath)) {
            return { ok: false, error: 'Video attachment path is outside the managed upload directory.' };
        }

        if (!fs.existsSync(resolvedPath)) {
            return { ok: false, error: 'Video attachment source file is no longer available. Please re-upload the recording.' };
        }

        const record = ensureVideoClaimRecord(resolvedPath);
        record.claimedBySessionId = sessionId;
        record.claimedAtMs = Date.now();
        record.lastSeenAtMs = Date.now();

        return { ok: true, path: resolvedPath };
    }

    function hydrateVideoClaimsFromSessions() {
        if (!chatManager || !chatManager._sessions || !(chatManager._sessions instanceof Map)) {
            return;
        }

        let claimedCount = 0;

        for (const [sessionId, entry] of chatManager._sessions.entries()) {
            if (!entry || entry.archived) continue;

            const candidatePaths = [];

            if (Array.isArray(entry.sessionAttachments)) {
                for (const attachment of entry.sessionAttachments) {
                    if (attachment?.type === 'video' && typeof attachment?.tempPath === 'string') {
                        candidatePaths.push(attachment.tempPath);
                    }
                }
            }

            if (Array.isArray(entry.videoContext)) {
                for (const ctx of entry.videoContext) {
                    if (typeof ctx?.videoPath === 'string' && ctx.videoPath.trim().length > 0) {
                        candidatePaths.push(ctx.videoPath);
                    }
                }
            }

            for (const candidatePath of candidatePaths) {
                const claimResult = claimVideoUploadForSession(sessionId, candidatePath);
                if (claimResult.ok) {
                    claimedCount++;
                }
            }
        }

        videoClaimHydrated = true;
        if (claimedCount > 0) {
            log(`Video retention: claimed ${claimedCount} session-bound upload(s) from persisted sessions`);
        }
    }

    function cleanupVideoUploadClaims(reason = 'scheduled') {
        if (!chatManager || !chatManager._sessions || !(chatManager._sessions instanceof Map)) {
            return;
        }

        if (!videoClaimHydrated) {
            hydrateVideoClaimsFromSessions();
        }

        if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
            return;
        }

        let entries;
        try {
            entries = fs.readdirSync(VIDEO_UPLOAD_DIR, { withFileTypes: true });
        } catch {
            return;
        }

        const presentPaths = new Set();
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const fullPath = path.join(VIDEO_UPLOAD_DIR, entry.name);
            presentPaths.add(getVideoClaimKey(fullPath));
            ensureVideoClaimRecord(fullPath);
        }

        for (const [key] of videoUploadClaims.entries()) {
            if (!presentPaths.has(key)) {
                videoUploadClaims.delete(key);
            }
        }

        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, record] of videoUploadClaims.entries()) {
            const fileExists = fs.existsSync(record.path);
            if (!fileExists) {
                videoUploadClaims.delete(key);
                continue;
            }

            const ageMs = Math.max(0, now - record.createdAtMs);
            const claimedActive = isNonEmptySessionId(record.claimedBySessionId)
                && isSessionActiveForVideoRetention(record.claimedBySessionId);

            let shouldDelete = false;
            if (claimedActive) {
                shouldDelete = ageMs > VIDEO_CLAIMED_MAX_AGE_MS;
            } else {
                shouldDelete = ageMs > VIDEO_UNCLAIMED_TTL_MS;
            }

            if (!shouldDelete) continue;

            try {
                fs.unlinkSync(record.path);
                cleanedCount++;
                videoUploadClaims.delete(key);
            } catch {
                // Ignore transient cleanup errors.
            }
        }

        if (cleanedCount > 0) {
            log(`Video retention: cleaned ${cleanedCount} upload file(s) (${reason})`);
        }
    }

    // Sweep upload dir on a fixed cadence. Claimed files are retained for active sessions.
    videoUploadCleanupInterval = setInterval(() => {
        cleanupVideoUploadClaims('interval');
    }, VIDEO_CLEANUP_INTERVAL_MS);
    cleanupVideoUploadClaims('startup');

    // Video magic bytes for validation
    const VIDEO_MAGIC = {
        'video/mp4': [Buffer.from('66747970', 'hex')],  // "ftyp" at offset 4
        'video/quicktime': [Buffer.from('66747970', 'hex')],
        'video/webm': [Buffer.from('1a45dfa3', 'hex')],  // EBML header
        'video/x-matroska': [Buffer.from('1a45dfa3', 'hex')],
        'video/x-msvideo': [Buffer.from('52494646', 'hex')],  // "RIFF"
    };

    /**
     * POST /api/chat/upload-video
     * Accepts raw binary video via streaming — never holds full file in memory.
     * Headers required:
     *   Content-Type: <video MIME type>
     *   X-Filename: <original filename>
     *   Content-Length: <file size in bytes>
     * Returns: { tempPath, filename, mediaType, size }
     */
    router.postRaw('/api/chat/upload-video', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });

        const mediaType = (req.headers['content-type'] || '').split(';')[0].trim();
        const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : undefined;
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);

        // Validate MIME type
        if (!VALID_VIDEO_MEDIA.includes(mediaType)) {
            req.resume(); // drain the stream
            return badRequest(res, `Unsupported video type: ${mediaType}. Allowed: ${VALID_VIDEO_MEDIA.join(', ')}`);
        }

        // Validate filename presence
        if (!filename) {
            req.resume();
            return badRequest(res, 'X-Filename header is required');
        }

        // Validate Content-Length
        if (contentLength > MAX_VIDEO_UPLOAD_BYTES) {
            req.resume();
            return json(res, 413, { error: `Video exceeds ${MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024)} MB limit` });
        }

        // Sanitize filename — strip path traversal characters
        const safeName = path.basename(String(filename).replace(/[\\/]/g, '').replace(/\.\./g, ''));

        try {
            await fsP.mkdir(VIDEO_UPLOAD_DIR, { recursive: true });

            const tempName = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
            const tempPath = path.join(VIDEO_UPLOAD_DIR, tempName);

            // Stream request body directly to disk — never buffer in memory
            await new Promise((resolve, reject) => {
                const ws = fs.createWriteStream(tempPath);
                let written = 0;

                req.on('data', (chunk) => {
                    written += chunk.length;
                    if (written > MAX_VIDEO_UPLOAD_BYTES) {
                        req.destroy();
                        ws.destroy();
                        fsP.unlink(tempPath).catch(() => { });
                        reject(new Error(`Upload exceeds ${MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024)} MB limit`));
                        return;
                    }
                    if (!ws.write(chunk)) {
                        req.pause();
                        ws.once('drain', () => req.resume());
                    }
                });

                req.on('end', () => ws.end(resolve));
                req.on('error', (err) => { ws.destroy(); reject(err); });
                ws.on('error', (err) => { req.destroy(); reject(err); });
            });

            // Validate magic bytes
            const fd = await fsP.open(tempPath, 'r');
            const headerBuf = Buffer.alloc(12);
            await fd.read(headerBuf, 0, 12, 0);
            await fd.close();

            const magicPatterns = VIDEO_MAGIC[mediaType] || [];
            const isValid = magicPatterns.some(magic => {
                // MP4/MOV: "ftyp" at offset 4
                if (mediaType === 'video/mp4' || mediaType === 'video/quicktime') {
                    return headerBuf.subarray(4, 8).equals(magic);
                }
                return headerBuf.subarray(0, magic.length).equals(magic);
            });

            if (!isValid) {
                await fsP.unlink(tempPath).catch(() => { });
                return badRequest(res, 'File content does not match declared video type');
            }

            const stat = await fsP.stat(tempPath);

            // Track upload path in retention map as unclaimed until a chat session references it.
            ensureVideoClaimRecord(tempPath);

            ok(res, {
                tempPath,
                filename: safeName,
                mediaType,
                size: stat.size,
            });
        } catch (error) {
            if (error.message.includes('limit')) {
                return json(res, 413, { error: error.message });
            }
            json(res, 500, { error: `Video upload failed: ${error.message}` });
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // CHAT SESSIONS (AI Assistant)
    // ═════════════════════════════════════════════════════════════════

    /**
     * POST /api/chat/sessions
     * Body: { model?, agentId?, agentMode? }
     * Returns: { sessionId, model, createdAt, agentMode, agentId }
     */
    router.post('/api/chat/sessions', async (req, res) => {
        if (!chatManager) {
            return json(res, 503, { error: 'Chat manager not ready. SDK Orchestrator may still be starting.' });
        }
        try {
            const { model, agentId, agentMode } = req.body;
            const selection = await resolveModelSelection(model);
            if (!selection.ok) {
                return badRequest(res, selection.error);
            }

            const session = await chatManager.createSession({ model: selection.effectiveModel, agentId, agentMode });
            ok(res, session);
        } catch (error) {
            json(res, error?.status || 500, { error: `Failed to create chat session: ${error.message}` });
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

    router.get('/api/chat/sessions/:sessionId/status', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            ok(res, chatManager.getSessionStatus(req.params.sessionId));
        } catch (error) {
            respondChatError(res, error);
        }
    });

    router.post('/api/chat/sessions/:sessionId/resume', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        try {
            ok(res, await chatManager.resumeSession(req.params.sessionId));
        } catch (error) {
            respondChatError(res, error);
        }
    });

    /**
     * POST /api/chat/sessions/:sessionId/messages
     * Body: { content, attachments?, model? }
     * Returns: { messageId }
     *
     * Attachments are optional base64-encoded images or documents:
     *   Images:      [{ type: 'image',      media_type: 'image/png', data: '<base64>' }]
     *   Documents:   [{ type: 'document',   media_type: 'application/pdf', data: '<base64>', filename: 'report.pdf' }]
     *   Videos:      [{ type: 'video',      media_type: 'video/mp4', tempPath: '/tmp/...', filename: 'bug.mp4' }]
     *   Video links: [{ type: 'video_link', url: 'https://...', provider: 'loom' }]
     */
    const MAX_IMAGES_PER_MESSAGE = 10;
    const MAX_DOCS_PER_MESSAGE = 5;
    const MAX_VIDEOS_PER_MESSAGE = 2;
    const VALID_IMAGE_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const VALID_DOC_MEDIA = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv', 'text/plain', 'text/markdown', 'application/json',
    ];
    router.post('/api/chat/sessions/:sessionId/messages', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        const { sessionId } = req.params;
        const { content, attachments, model } = req.body;
        if (!content && (!attachments || attachments.length === 0)) {
            return badRequest(res, 'Message content or attachments required');
        }

        let selectedModel = null;
        if (typeof model === 'string' && model.trim()) {
            const selection = await resolveModelSelection(model.trim());
            if (!selection.ok) {
                return badRequest(res, selection.error);
            }
            selectedModel = selection.effectiveModel;
        }

        // Validate attachments if present
        if (attachments && Array.isArray(attachments)) {
            let imageCount = 0;
            let docCount = 0;
            let videoCount = 0;
            for (const att of attachments) {
                if (!att.type || !['image', 'document', 'video', 'video_link'].includes(att.type)) {
                    return badRequest(res, 'Attachment type must be "image", "document", "video", or "video_link"');
                }

                if (att.type === 'video') {
                    videoCount++;
                    if (!att.tempPath || typeof att.tempPath !== 'string') {
                        return badRequest(res, 'Video attachment requires tempPath from upload endpoint');
                    }
                    if (!VALID_VIDEO_MEDIA.includes(att.media_type)) {
                        return badRequest(res, `Unsupported video type: ${att.media_type}`);
                    }
                    // Validate tempPath is within the expected upload directory
                    const resolved = path.resolve(att.tempPath);
                    if (!resolved.startsWith(path.resolve(VIDEO_UPLOAD_DIR))) {
                        return badRequest(res, 'Invalid video tempPath');
                    }
                    if (!fs.existsSync(resolved)) {
                        return badRequest(res, 'Video attachment source file is no longer available. Please re-upload the recording.');
                    }
                    const claimResult = claimVideoUploadForSession(sessionId, resolved);
                    if (!claimResult.ok) {
                        return badRequest(res, claimResult.error);
                    }
                    att.tempPath = claimResult.path;
                    // Sanitize filename
                    if (att.filename) {
                        att.filename = String(att.filename).replace(/[\\/]/g, '').replace(/\.\./g, '');
                    }
                } else if (att.type === 'video_link') {
                    videoCount++;
                    if (!att.url || typeof att.url !== 'string') {
                        return badRequest(res, 'Video link attachment requires url');
                    }
                } else if (att.type === 'image' || att.type === 'document') {
                    if (!att.data || typeof att.data !== 'string') {
                        return badRequest(res, 'Attachment data must be a base64 string');
                    }
                }

                if (att.type === 'image') {
                    imageCount++;
                    if (!VALID_IMAGE_MEDIA.includes(att.media_type)) {
                        return badRequest(res, `Unsupported image type: ${att.media_type}. Allowed: ${VALID_IMAGE_MEDIA.join(', ')}`);
                    }
                    const estimatedSize = Math.ceil(att.data.length * 0.75);
                    if (estimatedSize > 5 * 1024 * 1024) {
                        return badRequest(res, 'Individual image attachment must be under 5 MB');
                    }
                } else if (att.type === 'document') {
                    docCount++;
                    if (!VALID_DOC_MEDIA.includes(att.media_type)) {
                        return badRequest(res, `Unsupported document type: ${att.media_type}`);
                    }
                    // Sanitize filename — strip path traversal
                    if (att.filename) {
                        att.filename = String(att.filename).replace(/[\\/]/g, '').replace(/\.\./g, '');
                    }
                    const estimatedSize = Math.ceil(att.data.length * 0.75);
                    if (estimatedSize > 50 * 1024 * 1024) {
                        return badRequest(res, `Document "${att.filename || 'unknown'}" exceeds 50 MB limit`);
                    }
                }
            }
            if (imageCount > MAX_IMAGES_PER_MESSAGE) {
                return badRequest(res, `Maximum ${MAX_IMAGES_PER_MESSAGE} image attachments per message`);
            }
            if (docCount > MAX_DOCS_PER_MESSAGE) {
                return badRequest(res, `Maximum ${MAX_DOCS_PER_MESSAGE} document attachments per message`);
            }
            if (videoCount > MAX_VIDEOS_PER_MESSAGE) {
                return badRequest(res, `Maximum ${MAX_VIDEOS_PER_MESSAGE} video attachments per message`);
            }
        }

        try {
            const result = await chatManager.sendMessage(sessionId, content || '', attachments, selectedModel);
            ok(res, result);
        } catch (error) {
            respondChatError(res, error);
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
            respondChatError(res, error);
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
            respondChatError(res, error);
        }
    });

    /**
     * GET /api/chat/sessions/:sessionId/attachments/:attachmentId
     * Streams a stored transcript attachment (e.g. assistant screenshot) on
     * demand. Bytes are kept on disk and referenced by URL in chat history/SSE
     * instead of being inlined as base64, so the browser decodes images off the
     * JS heap and never accumulates the full set (Chrome STATUS_BREAKPOINT fix).
     */
    router.get('/api/chat/sessions/:sessionId/attachments/:attachmentId', async (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });

        // Optional ?w=<px> requests a downscaled thumbnail. Tiles render small but
        // the browser otherwise decodes the full-resolution bitmap into memory —
        // across many screenshots that decoded pool triggers the Chrome
        // STATUS_BREAKPOINT crash. The thumbnail keeps the decoded pool tiny.
        const rawWidth = parseInt(req.query?.w, 10);
        const wantThumb = Number.isFinite(rawWidth) && rawWidth > 0;

        let resolved;
        try {
            resolved = wantThumb
                ? await chatManager.getStoredAttachmentThumbnail(req.params.sessionId, req.params.attachmentId, rawWidth)
                : chatManager.getStoredAttachment(req.params.sessionId, req.params.attachmentId);
        } catch {
            resolved = chatManager.getStoredAttachment(req.params.sessionId, req.params.attachmentId);
        }
        if (!resolved) return notFound(res, 'Attachment not found');

        // attachmentId is content-unique and the bytes are immutable; the requested
        // width is part of the cache identity so a thumbnail and the full image
        // never collide on a shared ETag.
        const etag = wantThumb
            ? `"${req.params.attachmentId}.w${rawWidth}"`
            : `"${req.params.attachmentId}"`;
        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
            return res.end();
        }

        const stream = fs.createReadStream(resolved.path);
        res.writeHead(200, {
            'Content-Type': resolved.mimeType,
            'Content-Length': resolved.size,
            'Cache-Control': 'private, max-age=31536000, immutable',
            'ETag': etag,
            'X-Content-Type-Options': 'nosniff',
        });
        stream.on('error', (error) => {
            if (!res.headersSent) {
                json(res, 500, { error: `Failed to read attachment: ${error.message}` });
                return;
            }
            res.destroy(error);
        });
        stream.pipe(res);
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
            respondChatError(res, error);
        }
    });

    /**
     * POST /api/chat/sessions/:sessionId/user-input
     * Submit a user's response to an agent's ask_user / ask_questions request.
     * Body: { requestId: string, answer: string | { username, password } }
     */
    router.post('/api/chat/sessions/:sessionId/user-input', (req, res) => {
        if (!chatManager) return json(res, 503, { error: 'Chat manager not ready' });
        const { sessionId } = req.params;
        const { requestId, answer } = req.body;

        if (!requestId || typeof requestId !== 'string') {
            return badRequest(res, 'requestId (string) is required');
        }
        // Accept answer as string OR structured object (e.g., { username, password } for credentials)
        if (answer === undefined || answer === null || (typeof answer !== 'string' && typeof answer !== 'object')) {
            return badRequest(res, 'answer (string or object) is required');
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

    /**
     * POST /api/chat/sessions/:sessionId/workspace-root
     * Body: { path }
     * Directly sets the FileGenie workspace root for this session (no AI call).
     */
    router.post('/api/chat/sessions/:sessionId/workspace-root', (req, res) => {
        const { sessionId } = req.params;
        const userPath = req.body?.path;
        if (!userPath) return badRequest(res, 'Missing "path" in request body');

        const resolved = path.resolve(userPath);
        const normalizedForCheck = process.platform === 'win32' ? resolved.toLowerCase() : resolved;

        // Block system directories
        for (const blocked of BLOCKED_PATHS) {
            if (normalizedForCheck.startsWith(blocked) || normalizedForCheck === blocked) {
                return json(res, 403, { error: `Cannot use system directory: ${resolved}` });
            }
        }

        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            return badRequest(res, `Path is not an existing directory: ${resolved}`);
        }

        setSessionRoot(sessionId, resolved);

        // Quick stats
        const items = fs.readdirSync(resolved);
        let files = 0, dirs = 0;
        for (const name of items) {
            try {
                if (fs.statSync(path.join(resolved, name)).isDirectory()) dirs++;
                else files++;
            } catch { /* skip */ }
        }

        ok(res, { root: resolved, files, directories: dirs, itemCount: items.length });
    });

    /**
     * GET /api/chat/sessions/:sessionId/workspace-root
     * Returns the current workspace root for a FileGenie session.
     */
    router.get('/api/chat/sessions/:sessionId/workspace-root', (req, res) => {
        const root = getSessionRoot(req.params.sessionId);
        ok(res, { root });
    });

    // ═════════════════════════════════════════════════════════════════
    // CREATE HTTP SERVER
    // ═════════════════════════════════════════════════════════════════

    const server = http.createServer((req, res) => router.handle(req, res));
    const terminalWss = new WebSocketServer({ noServer: true });

    terminalWss.on('connection', (socket, _req, context = {}) => {
        const sessionId = context.sessionId;
        if (!sessionId) {
            socket.close(1008, 'Missing sessionId');
            return;
        }

        try {
            terminalSessionManager.attachWebSocket(sessionId, socket);
        } catch (error) {
            try {
                socket.send(JSON.stringify({
                    event: 'terminal_error',
                    data: { message: error.message },
                }));
            } catch {
                // ignore
            }
            socket.close(1011, 'Terminal attach failed');
        }
    });

    server.on('upgrade', (req, socket, head) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        } catch {
            socket.destroy();
            return;
        }

        if (parsedUrl.pathname !== '/api/terminal/ws') {
            socket.destroy();
            return;
        }

        // Origin check — reject cross-origin WS handshakes when a
        // specific allow-list is configured (production posture). In
        // `*` mode (default local dev) we remain permissive.
        const origin = req.headers.origin;
        if (!isTerminalOriginAllowed(origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        const sessionId = parsedUrl.searchParams.get('sessionId');
        if (!sessionId || !terminalSessionManager.getSession(sessionId)) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        // Per-session token check — prevents any other browser tab or
        // service on the same origin from attaching to this PTY.
        if (terminalRequireToken) {
            const token = parsedUrl.searchParams.get('token') || '';
            if (!terminalSessionManager.verifySessionToken(sessionId, token)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        terminalWss.handleUpgrade(req, socket, head, (ws) => {
            terminalWss.emit('connection', ws, req, { sessionId });
        });
    });

    server.listen(port, host, () => {
        log('═══════════════════════════════════════════════════');
        log('  SDK PIPELINE SERVER');
        log(`  Host:    ${host}`);
        log(`  Port:    ${port}`);
        log(`  CORS:    ${corsOrigins.join(', ')}`);
        log(`  Auth:    ${process.env.SDK_API_TOKEN ? 'bearer (SDK_API_TOKEN set)' : 'disabled (loopback only)'}`);
        log(`  Runs:    ${runStore.getStats().totalRuns} historical`);
        log('═══════════════════════════════════════════════════');
        log('');
        log('  Endpoints:');
        log(`    POST /api/pipeline/run          — Start pipeline`);
        log(`    POST /api/pipeline/batch         — Batch execution`);
        log(`    POST /api/pipeline/cancel/:runId — Cancel pipeline`);
        log(`    GET  /api/pipeline/runs          — List runs`);
        log(`    GET  /api/pipeline/status/:runId — Run status`);
        log(`    GET  /api/pipeline/evidence-summary/:runId — Flattened mission evidence`);
        log(`    GET  /api/pipeline/artifact       — Secure evidence file streaming`);
        log(`    GET  /api/pipeline/observations/:runId — Observation summary`);
        log(`    GET  /api/pipeline/results/:runId— Full results`);
        log(`    GET  /api/pipeline/stream/:runId — SSE stream`);
        log(`    GET  /api/pipeline/stream        — Global SSE stream`);
        log(`    POST /api/terminal/sessions      — Create interactive terminal session`);
        log(`    GET  /api/terminal/sessions      — List terminal sessions`);
        log(`    GET  /api/terminal/sessions/:id  — Terminal session status`);
        log(`    GET  /api/terminal/sessions/:id/output — Terminal output buffer`);
        log(`    POST /api/terminal/sessions/:id/input — Send raw terminal input`);
        log(`    POST /api/terminal/sessions/:id/command — Send terminal command`);
        log(`    POST /api/terminal/sessions/:id/resize — Resize terminal viewport`);
        log(`    POST /api/terminal/sessions/:id/terminate — Terminate session`);
        log(`    WS   /api/terminal/ws?sessionId= — Live terminal stream`);
        log(`    GET  /api/analytics/overview     — Pipeline analytics`);
        log(`    GET  /api/analytics/failures     — Failure trends`);
        log(`    GET  /api/analytics/selectors    — Selector stability`);
        log(`    GET  /api/analytics/runs         — Run trends`);
        log(`    GET  /api/webhooks/jira/lifecycle/config — Jira webhook lifecycle config`);
        log(`    GET  /api/webhooks/jira/lifecycle — List Jira dynamic webhooks`);
        log(`    POST /api/webhooks/jira/lifecycle/sync — Run lifecycle startup sync`);
        log(`    POST /api/webhooks/jira/lifecycle/register — Register Jira dynamic webhook`);
        log(`    POST /api/webhooks/jira/lifecycle/refresh — Refresh Jira dynamic webhooks`);
        log(`    GET  /api/webhooks/jira/lifecycle/failed — List failed Jira webhook deliveries`);
        log(`    POST /api/webhooks/jira/lifecycle/delete — Delete Jira dynamic webhooks`);
        log(`    GET  /api/webhooks/jira/queue    — Jira webhook queue snapshot`);
        log(`    GET  /api/webhooks/jira/dlq      — Jira webhook dead-letter queue`);
        log(`    POST /api/webhooks/jira/dlq/replay — Replay dead-lettered webhook deliveries`);
        log(`    POST /api/webhooks/jira          — Jira webhook`);
        log(`    GET  /api/models                  — Runtime model catalog`);
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
        schedulerEngine.stop();
        if (videoUploadCleanupInterval) {
            clearInterval(videoUploadCleanupInterval);
        }
        if (jiraWebhookQueueTimer) {
            clearTimeout(jiraWebhookQueueTimer);
            jiraWebhookQueueTimer = null;
        }
        terminalWss.clients.forEach((client) => {
            try {
                client.close(1001, 'Server shutting down');
            } catch {
                // ignore
            }
        });
        terminalWss.close();
        await terminalSessionManager.dispose().catch(() => { });
        server.close();
        if (chatManager) await chatManager.prepareForShutdown().catch(() => { });
        await orchestrator.stop().catch(() => { });
        process.exit(0);
    };

    if (!disableSignalHandlers) {
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }

    return server;
}

// ─── Pipeline Execution (Background) ───────────────────────────────────────

function aggregateExecutionMetrics(metricArtifacts = []) {
    const commands = [];
    for (const artifact of metricArtifacts) {
        if (!artifact || !Array.isArray(artifact.commands)) continue;
        commands.push(...artifact.commands);
    }

    const durations = commands
        .map(item => item?.durationMs)
        .filter(value => Number.isFinite(value) && value >= 0);
    const cancelLatencies = commands
        .map(item => item?.cancelToKillLatencyMs)
        .filter(value => Number.isFinite(value) && value >= 0);

    const sum = (arr) => arr.reduce((total, value) => total + value, 0);

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            totalCommands: commands.length,
            cancelledCommands: commands.filter(item => item?.cancelled === true).length,
            timedOutCommands: commands.filter(item => item?.timedOut === true).length,
            failedCommands: commands.filter(item => item?.error && item?.cancelled !== true).length,
            averageDurationMs: durations.length > 0 ? Math.round(sum(durations) / durations.length) : null,
            maxDurationMs: durations.length > 0 ? Math.max(...durations) : null,
            averageCancelToKillLatencyMs: cancelLatencies.length > 0 ? Math.round(sum(cancelLatencies) / cancelLatencies.length) : null,
            maxCancelToKillLatencyMs: cancelLatencies.length > 0 ? Math.max(...cancelLatencies) : null,
        },
        commands,
    };
}

/**
 * Execute a pipeline run in the background.
 * Updates RunStore and EventBridge as stages progress.
 */
function _executePipeline(runId, ticketId, mode, orchestrator, runStore, eventBridge, activePipelines, model, extraOptions = {}) {
    let cancelled = false;
    const abortController = new AbortController();

    const requestCancellation = (reason = 'Cancelled by user') => {
        if (cancelled) return;
        cancelled = true;
        if (!abortController.signal.aborted) {
            try {
                abortController.abort(new Error(reason));
            } catch {
                // Abort is best-effort.
            }
        }
    };

    activePipelines.set(runId, {
        cancel: requestCancellation,
        isCancelled: () => cancelled,
    });

    // Fire and forget — async execution
    (async () => {
        try {
            const emitProgress = (stage, rawMessage, scenario = null) => {
                if (cancelled) return;

                const message = scenario
                    ? `[${scenario.name || scenario.id}] ${rawMessage}`
                    : rawMessage;
                const stageDetails = {
                    message,
                    scenarioId: scenario?.id || null,
                    scenarioName: scenario?.name || null,
                    authState: scenario?.authState || null,
                };

                if (rawMessage.startsWith('Starting ')) {
                    runStore.updateStage(runId, stage, 'running', stageDetails);
                    eventBridge.push(EVENT_TYPES.STAGE_START, runId, { stage, message, ...stageDetails });
                } else if (rawMessage === 'Completed' || rawMessage.includes('passed') || rawMessage.includes('generated')) {
                    runStore.updateStage(runId, stage, 'passed', stageDetails);
                    eventBridge.push(EVENT_TYPES.STAGE_COMPLETE, runId, {
                        stage,
                        message,
                        success: true,
                        ...stageDetails,
                    });
                } else if (rawMessage.startsWith('BLOCKED') || rawMessage.startsWith('ERROR')) {
                    runStore.updateStage(runId, stage, 'failed', stageDetails);
                    runStore.recordMissionObservation(runId, {
                        type: 'stage-issue',
                        severity: rawMessage.startsWith('BLOCKED') ? 'warning' : 'error',
                        stage,
                        scenarioId: scenario?.id || null,
                        message,
                        metadata: { ticketId, stage, authState: scenario?.authState || null },
                    });
                    eventBridge.push(EVENT_TYPES.STAGE_COMPLETE, runId, {
                        stage,
                        message,
                        success: false,
                        ...stageDetails,
                    });
                } else {
                    runStore.updateStage(runId, stage, 'running', stageDetails);
                    eventBridge.push(EVENT_TYPES.STAGE_PROGRESS, runId, { stage, message, ...stageDetails });
                }

                const followupProvider = getFollowupProvider();
                if (rawMessage === 'Completed' || rawMessage.includes('passed') || rawMessage.includes('generated')) {
                    const followups = followupProvider.getPipelineFollowups({ stage, success: true, ticketId });
                    if (followups.length > 0) {
                        eventBridge.push(EVENT_TYPES.FOLLOWUP, runId, {
                            stage,
                            followups,
                            scenarioId: scenario?.id || null,
                            authState: scenario?.authState || null,
                        });
                    }
                } else if (rawMessage.startsWith('BLOCKED') || rawMessage.startsWith('ERROR')) {
                    const followups = followupProvider.getPipelineFollowups({ stage, success: false, ticketId });
                    if (followups.length > 0) {
                        eventBridge.push(EVENT_TYPES.FOLLOWUP, runId, {
                            stage,
                            followups,
                            scenarioId: scenario?.id || null,
                            authState: scenario?.authState || null,
                        });
                    }
                }
            };

            // Mark started
            runStore.startRun(runId);
            const run = runStore.getRun(runId);
            const scenarios = Array.isArray(run?.mission?.scenarios) && run.mission.scenarios.length > 0
                ? run.mission.scenarios
                : [{ id: 'default', name: 'Default Scenario', authState: 'unspecified' }];
            runStore.appendMissionCheckpoint(runId, {
                stage: 'run',
                status: 'running',
                message: `Pipeline started for ${ticketId}`,
                details: { ticketId, mode, model: model || null, scenarioCount: scenarios.length },
            });
            eventBridge.push(EVENT_TYPES.RUN_START, runId, { ticketId, mode, scenarioCount: scenarios.length });

            const scenarioResults = [];
            const scenarioEvidence = {};
            const {
                onCommandEvent: externalCommandEventSink,
                ...pipelineExtraOptions
            } = extraOptions || {};

            for (const scenario of scenarios) {
                if (cancelled) break;

                runStore.updateScenario(runId, scenario.id, {
                    status: RUN_STATUS.RUNNING,
                    startedAt: new Date().toISOString(),
                    authState: scenario.authState || 'unspecified',
                });
                runStore.appendMissionCheckpoint(runId, {
                    stage: 'scenario',
                    status: 'running',
                    scenarioId: scenario.id,
                    message: `Starting scenario ${scenario.name || scenario.id}`,
                    details: {
                        authState: scenario.authState || 'unspecified',
                        persona: scenario.persona || null,
                        credentialsRef: scenario.credentialsRef || null,
                    },
                });
                eventBridge.push(EVENT_TYPES.STAGE_PROGRESS, runId, {
                    stage: 'scenario',
                    message: `Starting scenario ${scenario.name || scenario.id}`,
                    scenarioId: scenario.id,
                    scenarioName: scenario.name || scenario.id,
                    authState: scenario.authState || 'unspecified',
                });

                const result = await orchestrator.runPipeline(ticketId, {
                    ...pipelineExtraOptions,
                    mode,
                    model,
                    runId,
                    contextRunId: `${runId}__${scenario.id}`,
                    scenario,
                    scenarioId: scenario.id,
                    authState: scenario.authState || 'unspecified',
                    abortSignal: abortController.signal,
                    shouldCancel: () => cancelled,
                    onProgress: (stage, message) => emitProgress(stage, message, scenario),
                    onCommandEvent: (commandEvent = {}) => {
                        const enrichedEvent = {
                            timestamp: new Date().toISOString(),
                            scenarioId: commandEvent.scenarioId || scenario.id,
                            scenarioName: commandEvent.scenarioName || scenario.name || scenario.id,
                            authState: commandEvent.authState || scenario.authState || 'unspecified',
                            ...commandEvent,
                        };

                        runStore.appendCommandOutput(runId, enrichedEvent);

                        if (typeof externalCommandEventSink === 'function') {
                            try {
                                externalCommandEventSink(enrichedEvent);
                            } catch {
                                // External command sink is best-effort.
                            }
                        }
                    },
                });

                if (result?.cancelled) {
                    requestCancellation('Cancelled by user');
                }

                scenarioResults.push({
                    scenarioId: scenario.id,
                    name: scenario.name || scenario.id,
                    authState: scenario.authState || 'unspecified',
                    success: !!result.success,
                    cancelled: !!result.cancelled,
                    duration: result.duration || null,
                    lastCompletedStage: result.lastCompletedStage || null,
                    error: result.error || null,
                    artifacts: result.artifacts || {},
                });

                scenarioEvidence[scenario.id] = {
                    authState: scenario.authState || 'unspecified',
                    manifestPath: result.artifacts?.evidenceManifest || null,
                    reportPath: result.artifacts?.report || null,
                    rawResultsPath: result.artifacts?.testResults?.rawResultsFile || null,
                    specPath: result.artifacts?.spec || null,
                    explorationPath: result.artifacts?.exploration || null,
                };

                runStore.updateScenario(runId, scenario.id, {
                    status: result.cancelled
                        ? RUN_STATUS.CANCELLED
                        : (result.success ? RUN_STATUS.COMPLETED : RUN_STATUS.FAILED),
                    completedAt: new Date().toISOString(),
                    result: {
                        success: !!result.success,
                        cancelled: !!result.cancelled,
                        duration: result.duration || null,
                        error: result.error || null,
                    },
                    artifactPaths: scenarioEvidence[scenario.id],
                    evidenceCount: Object.values(scenarioEvidence[scenario.id]).filter(Boolean).length,
                });
                runStore.appendMissionCheckpoint(runId, {
                    stage: 'scenario',
                    status: result.cancelled ? 'cancelled' : (result.success ? 'passed' : 'failed'),
                    scenarioId: scenario.id,
                    message: result.cancelled
                        ? `Scenario ${scenario.name || scenario.id} cancelled`
                        : result.success
                            ? `Scenario ${scenario.name || scenario.id} completed`
                            : `Scenario ${scenario.name || scenario.id} failed`,
                    details: {
                        authState: scenario.authState || 'unspecified',
                        success: !!result.success,
                        cancelled: !!result.cancelled,
                        error: result.error || null,
                    },
                });

                if (result.cancelled) {
                    break;
                }

                if (!result.success) {
                    runStore.recordMissionObservation(runId, {
                        type: 'scenario-failure',
                        severity: 'error',
                        stage: result.lastCompletedStage || 'scenario',
                        scenarioId: scenario.id,
                        message: result.error || `Scenario ${scenario.name || scenario.id} failed`,
                        metadata: { authState: scenario.authState || 'unspecified' },
                    });
                }
            }

            const failures = scenarioResults.filter(item => !item.success);
            const executionMetricsByScenario = Object.fromEntries(
                scenarioResults.map(item => [item.scenarioId, item.artifacts?.executionMetrics || null])
            );
            const executionMetrics = aggregateExecutionMetrics(
                Object.values(executionMetricsByScenario).filter(Boolean)
            );

            const result = {
                ticketId,
                mode,
                runId,
                success: !cancelled && failures.length === 0,
                cancelled,
                duration: runStore.getRun(runId)?.duration || null,
                lastCompletedStage: scenarioResults[scenarioResults.length - 1]?.lastCompletedStage || null,
                stageResults: {},
                scenarioResults,
                artifacts: {
                    scenarioResults: Object.fromEntries(scenarioResults.map(item => [item.scenarioId, item.artifacts || {}])),
                    evidenceScenarios: scenarioEvidence,
                    executionMetricsByScenario,
                    executionMetrics,
                },
                error: cancelled
                    ? 'Cancelled by user'
                    : failures.map(item => `${item.scenarioId}: ${item.error || 'failed'}`).join('; ') || null,
            };

            // Mark completed
            if (cancelled) {
                runStore.cancelRun(runId);
            }
            runStore.completeRun(runId, result);
            runStore.updateMission(runId, {
                result: {
                    success: !!result.success,
                    cancelled: !!result.cancelled,
                    scenarioResults,
                    error: result.error || null,
                },
                evidence: {
                    manifestPath: result.artifacts?.evidenceManifest || null,
                    reportPath: result.artifacts?.report || null,
                    rawResultsPath: result.artifacts?.testResults?.rawResultsFile || null,
                    eventLogPath: eventBridge.getRunEventLogPath(runId),
                    scenarios: scenarioEvidence,
                },
            });
            runStore.appendMissionCheckpoint(runId, {
                stage: 'run',
                status: result.cancelled ? 'cancelled' : (result.success ? 'passed' : 'failed'),
                message: result.cancelled
                    ? 'Pipeline cancelled by user'
                    : (result.success ? 'Pipeline completed successfully' : (result.error || 'Pipeline completed with failures')),
                details: {
                    success: !!result.success,
                    cancelled: !!result.cancelled,
                    duration: result.duration || null,
                },
            });
            eventBridge.push(EVENT_TYPES.RUN_COMPLETE, runId, {
                ticketId,
                success: result.success,
                cancelled: !!result.cancelled,
                duration: result.duration,
                error: result.error,
                scenarioResults,
            });

        } catch (error) {
            if (cancelled || error?.code === 'ABORT_ERR' || abortController.signal.aborted) {
                runStore.cancelRun(runId);
                runStore.completeRun(runId, {
                    success: false,
                    cancelled: true,
                    error: 'Cancelled by user',
                    ticketId,
                    mode,
                });
                eventBridge.push(EVENT_TYPES.RUN_COMPLETE, runId, {
                    ticketId,
                    success: false,
                    cancelled: true,
                    error: 'Cancelled by user',
                });
                return;
            }

            log(`Pipeline ${runId} failed: ${error.message}`, 'error');
            runStore.completeRun(runId, {
                success: false,
                error: error.message,
                ticketId,
                mode,
            });
            runStore.recordMissionObservation(runId, {
                type: 'pipeline-error',
                severity: 'error',
                stage: 'run',
                message: error.message,
                metadata: { ticketId, mode },
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

module.exports = {
    startServer,
    __internal: {
        resolveJiraWebhookRuntimeConfig,
        parseJiraWebhookSignature,
        verifyJiraWebhookSignature,
        buildJiraWebhookReplayKey,
        pruneJiraWebhookReplayCache,
    },
};
