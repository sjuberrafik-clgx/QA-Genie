/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CHAT SESSION MANAGER — Web App Chat Interface via Copilot SDK
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages interactive chat sessions for the web app frontend.
 * Each session wraps a CopilotSession with QA-domain context, custom tools,
 * and MCP server integration. Streams events to SSE clients in real-time.
 *
 * Architecture:
 *   - One CopilotClient (from SDKOrchestrator) serves all chat sessions
 *   - Each user/tab can create independent sessions
 *   - Sessions persist conversation history via the SDK
 *   - Custom tools give the AI access to framework inventory, failure data, etc.
 *   - MCP server enables live browser exploration from chat
 *
 * @module sdk-orchestrator/chat-session-manager
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getFollowupProvider } = require('./followup-provider');
const { extractAtlassianUrlContext } = require('./atlassian-url-utils');
const { getGeneratedArtifactRoots, isGeneratedArtifactPath } = require('./generated-artifact-policy');
const { AgentCatalogService, buildCoreAgentId, toPublicAgentDescriptor } = require('./agent-catalog');
const { ToolBroker, createBrokerMetaTools } = require('./tool-broker');
const { applyCapabilityProfile, getCapabilityProfile } = require('./capability-profiles');
const { AgentIntentRouter } = require('./agent-intent-router');
const { runAgentStep } = require('./delegation-runner');
const { createDelegationTools } = require('./delegation-tools');
const { buildProjectSkillRoutingHint, buildProjectSkillActivationGuide } = require('./project-skills-catalog');
const { approveAllPermissions } = require('./permission-response');

const MAX_APPROVAL_DISPLAY_CHARS = 2000;
const MAX_APPROVAL_LONG_TEXT_CHARS = 4000;
const MAX_APPROVAL_CHANGES = 24;
const MAX_APPROVAL_NOTES = 16;
const MAX_APPROVAL_PREVIEW_BYTES = 48 * 1024;
const MAX_SSE_EVENT_BYTES = 256 * 1024;
const DELEGATED_USER_INPUT_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Chat Utilities (extracted) ─────────────────────────────────────────────
const {
    // Constants
    CHAT_EVENTS,
    MAX_ASSISTANT_IMAGE_BYTES,
    MAX_SSE_REPLAY_MESSAGES,
    MAX_REPLAY_CONTENT_CHARS,
    MAX_REPLAY_REASONING_CHARS,
    SSE_DELTA_COALESCE_MS,
    PROJECT_ROOT,
    USER_INPUT_TIMEOUT_MS,
    RECOVERY_HISTORY_LIMIT,
    MAX_RECOVERY_TRANSCRIPT_CHARS,
    SESSION_TITLE_MAX_LENGTH,
    SESSION_TITLE_TRUNCATED_LENGTH,
    MAX_PERSISTED_SESSION_ATTACHMENTS,
    MAX_PERSISTED_SESSION_ATTACHMENT_BYTES,
    MAX_SESSION_ATTACHMENT_STORE_BYTES,
    MAX_HISTORY_MESSAGES,
    MAX_PERSISTED_VIDEO_CONTEXT_ITEMS,
    MAX_PERSISTED_VIDEO_FRAMES_PER_ITEM,
    GENERIC_SESSION_TITLES,
    SESSION_RUNTIME_STATES,
    SESSION_EXECUTION_STATES,
    USER_INPUT_UUID_RE,
    USER_INPUT_REQUEST_ID_RE,
    CHAT_SHELL_TOOL_PATTERNS,
    // Shared helpers
    isNonEmptyString,
    toPositiveInt,
    // Prompt utilities
    extractCriticalInstructions,
    stripVSCodeToolPrefix,
    buildAtlassianRoutingHint,
    isShellLikeToolName,
    // Session title utilities
    normalizeSessionTitleText,
    stripSessionTitleLeadIn,
    truncateSessionTitle,
    capitalizeSessionTitle,
    isUuidLikeTitle,
    isFallbackSessionTitle,
    buildSessionTitleCandidate,
    // User input utilities
    isOpaqueUserInputValue,
    getDefaultUserInputQuestion,
    normalizeUserInputRequestPayload,
    normalizeUserInputHistoryMessage,
    // Session persistence utilities
    isExistingFilePath,
    sanitizeSessionContextForHistory,
    sanitizeSessionAttachmentForHistory,
    sanitizeSessionAttachmentsForHistory,
    sanitizeVideoMetadataForHistory,
    sanitizeVideoFrameForHistory,
    sanitizeVideoContextItemForHistory,
    sanitizeVideoContextForHistory,
    collectVideoTempFilesFromEvidence,
    collectDocumentTempFilesFromEvidence,
} = require('./chat-utils');

// ─── Atlassian MCP Read-Only Allowlist ──────────────────────────────────────
// Canonical list of Atlassian remote MCP tools that are safe to expose to chat
// sessions. ALL write operations (create/edit/delete issues, comments,
// transitions, Confluence writes) are deliberately omitted because they would
// bypass the global Jira approval guardrail (requireJiraMutationApproval).
// Writes must go through the gated SDK custom tools defined in
// custom-tools.js + tools/mutation-helpers.js.
const ATLASSIAN_MCP_READONLY_TOOLS = Object.freeze([
    'getJiraIssue',
    'searchJiraIssuesUsingJql',
    'getTransitionsForJiraIssue',
    'lookupJiraAccountId',
    'getVisibleJiraProjects',
    'atlassianUserInfo',
    'atl_search',
    'atl_fetch',
    'getConfluencePage',
    'searchConfluenceUsingCql',
    'getConfluenceSpaces',
]);

// ─── Grounding System (lazy-loaded) ─────────────────────────────────────────
let _groundingModule;
function _getGroundingModule() {
    if (_groundingModule === undefined) {
        try { _groundingModule = require('../grounding/grounding-store'); } catch { _groundingModule = null; }
    }
    return _groundingModule;
}

// Load .env for Jira credentials (Atlassian MCP auth)
// Uses override:true so updated tokens are picked up without server restart
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
    }
} catch { /* dotenv not critical — Atlassian MCP simply won't be configured */ }

// ─── Chat Session Manager ───────────────────────────────────────────────────

class ChatSessionManager extends EventEmitter {
    /**
     * @param {Object} options
     * @param {Object} options.client      - CopilotClient instance (from SDKOrchestrator)
     * @param {Function} options.defineTool - defineTool from SDK
     * @param {string} options.model       - Default model
     * @param {Object} options.config      - workflow-config.json
     * @param {Object} [options.learningStore] - Learning store for historical context
     */
    constructor(options) {
        super();
        this.setMaxListeners(50);

        this.client = options.client;
        this.defineTool = options.defineTool;
        this.model = options.model;
        this.config = options.config;
        this.learningStore = options.learningStore || null;
        this._agentCatalog = options.agentCatalog || new AgentCatalogService();
        this._generatedArtifactRoots = getGeneratedArtifactRoots(this.config, PROJECT_ROOT);

        // Initialize grounding store for local context enrichment
        this._groundingStore = null;
        const groundingEnabled = this.config?.sdk?.grounding?.enabled !== false;
        if (groundingEnabled) {
            const gMod = _getGroundingModule();
            if (gMod) {
                try {
                    this._groundingStore = gMod.getGroundingStore({
                        projectRoot: path.join(__dirname, '..', '..'),
                        verbose: false,
                    });
                    console.log('[ChatManager] 📚 GroundingStore initialized for dashboard sessions');
                } catch (err) {
                    console.warn(`[ChatManager] ⚠️ GroundingStore init failed: ${err.message}`);
                }
            }
        }

        // Track active sessions: sessionId → { session, sseClients[], createdAt }
        this._sessions = new Map();
        this._runtimeCreateConcurrency = toPositiveInt(
            options.runtimeCreateConcurrency || process.env.CHAT_RUNTIME_CREATE_CONCURRENCY,
            2
        );
        this._runtimeCreateActiveCount = 0;
        this._runtimeCreateQueue = [];

        // Followup provider for context-aware suggestions
        this._followupProvider = getFollowupProvider();

        // ── Tool Broker (cross-agent delegation) ──
        this._toolBroker = new ToolBroker({ config: this.config, verbose: false });
        try {
            this._toolBroker.buildRegistry(ChatSessionManager.VALID_AGENTS);
            console.log(`[ChatManager] 🔀 ToolBroker initialized: ${this._toolBroker.getRegistryStats().totalTools} tools registered`);
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ ToolBroker registry build failed: ${err.message}`);
        }

        // ── Agent Orchestration: semantic intent router (recall + guard) ──
        const routingCfg = this.config?.orchestration?.routing || {};
        this._intentRouter = new AgentIntentRouter({
            shortlistK: routingCfg.shortlistK,
            confidenceThreshold: routingCfg.confidenceThreshold,
            marginRatio: routingCfg.marginRatio,
            cacheTtlMs: routingCfg.decisionCacheTtlMs,
        });
        this._delegationTargetsCache = null;
        this._delegationTargetsCacheAt = 0;
        this._delegationFactory = null;
        this._delegationFactoryModel = null;
        this._latestUserMessage = new Map();
        this._delegatedWriteLocks = new Map();

        // ── Chat history persistence ──
        this._historyPath = options.historyPath || path.join(
            __dirname, '..', 'test-artifacts', 'chat-history.json'
        );
        // On-disk store for inline transcript attachments (assistant images).
        // Bytes live here, served on demand via the attachment endpoint, so the
        // browser never has to hold the full base64 set in the renderer heap.
        this._attachmentStoreDir = options.attachmentStoreDir || path.join(
            path.dirname(this._historyPath), 'chat-attachments'
        );
        this._loadHistory();

        // Cache default system prompt (used when agentMode is null)
        this._defaultSystemPrompt = this._buildSystemPrompt(null);
    }

    static _jsonByteLength(value) {
        try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return 0; }
    }

    static _capText(value, max = MAX_APPROVAL_DISPLAY_CHARS) {
        if (value === undefined || value === null) return undefined;
        const text = String(value);
        if (!max || text.length <= max) return text;
        return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars for renderer safety]`;
    }

    static _compactGuardrail(guardrail) {
        if (!guardrail || typeof guardrail !== 'object' || Array.isArray(guardrail)) return undefined;
        return {
            provider: ChatSessionManager._capText(guardrail.provider, 80),
            resourceType: ChatSessionManager._capText(guardrail.resourceType, 80),
            effect: ChatSessionManager._capText(guardrail.effect, 80),
            impactLevel: ChatSessionManager._capText(guardrail.impactLevel, 80),
            requiresApproval: guardrail.requiresApproval === true,
            actionLabel: ChatSessionManager._capText(guardrail.actionLabel, 240),
        };
    }

    static _compactMutationPreview(preview) {
        if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;

        const compactChanges = Array.isArray(preview.changes)
            ? preview.changes.slice(0, MAX_APPROVAL_CHANGES).map((change) => {
                if (!change || typeof change !== 'object') return null;
                const rawWasStripped = change.beforeRaw !== undefined || change.afterRaw !== undefined
                    || change.raw !== undefined || change.data !== undefined || change.base64 !== undefined || change.dataUrl !== undefined;
                return {
                    field: ChatSessionManager._capText(change.field || 'value', 120),
                    label: ChatSessionManager._capText(change.label || change.field || 'Value', 160),
                    changeType: ChatSessionManager._capText(change.changeType || 'replace', 40),
                    beforeDisplay: ChatSessionManager._capText(change.beforeDisplay ?? change.before ?? '(empty)', MAX_APPROVAL_DISPLAY_CHARS),
                    afterDisplay: ChatSessionManager._capText(change.afterDisplay ?? change.after ?? '(empty)', MAX_APPROVAL_DISPLAY_CHARS),
                    beforeKind: ChatSessionManager._capText(change.beforeKind || 'text', 40),
                    afterKind: ChatSessionManager._capText(change.afterKind || 'text', 40),
                    beforeLineCount: Number.isFinite(change.beforeLineCount) ? change.beforeLineCount : undefined,
                    afterLineCount: Number.isFinite(change.afterLineCount) ? change.afterLineCount : undefined,
                    isLongText: Boolean(change.isLongText || rawWasStripped),
                    rawStripped: rawWasStripped || undefined,
                    importance: ChatSessionManager._capText(change.importance, 40),
                    group: ChatSessionManager._capText(change.group, 40),
                };
            }).filter(Boolean)
            : [];

        const compact = {
            displayVersion: preview.displayVersion || 2,
            kind: ChatSessionManager._capText(preview.kind || 'mutation-preview', 80),
            provider: ChatSessionManager._capText(preview.provider || 'jira', 80),
            resourceType: ChatSessionManager._capText(preview.resourceType || 'ticket', 80),
            effect: ChatSessionManager._capText(preview.effect || 'write', 80),
            operationKind: ChatSessionManager._capText(preview.operationKind || 'update', 80),
            impactLevel: ChatSessionManager._capText(preview.impactLevel || 'high', 80),
            actionLabel: ChatSessionManager._capText(preview.actionLabel || 'apply a mutation', 240),
            title: ChatSessionManager._capText(preview.title || 'Approval required', 240),
            subject: preview.subject && typeof preview.subject === 'object'
                ? {
                    id: ChatSessionManager._capText(preview.subject.id, 160),
                    url: ChatSessionManager._capText(preview.subject.url, 600),
                    title: ChatSessionManager._capText(preview.subject.title, 300),
                    label: ChatSessionManager._capText(preview.subject.label, 300),
                }
                : undefined,
            changes: compactChanges,
            notes: Array.isArray(preview.notes)
                ? preview.notes.slice(0, MAX_APPROVAL_NOTES).map(note => ChatSessionManager._capText(note, MAX_APPROVAL_LONG_TEXT_CHARS)).filter(Boolean)
                : [],
            consequence: ChatSessionManager._capText(preview.consequence, MAX_APPROVAL_LONG_TEXT_CHARS),
        };

        if (Array.isArray(preview.changes) && preview.changes.length > MAX_APPROVAL_CHANGES) {
            compact.truncatedChanges = preview.changes.length - MAX_APPROVAL_CHANGES;
        }
        if (Array.isArray(preview.notes) && preview.notes.length > MAX_APPROVAL_NOTES) {
            compact.truncatedNotes = preview.notes.length - MAX_APPROVAL_NOTES;
        }
        if (ChatSessionManager._jsonByteLength(compact) <= MAX_APPROVAL_PREVIEW_BYTES) return compact;

        // Second-pass shrink for pathological previews: keep the review useful,
        // but guarantee a small SSE/history payload.
        compact.changes = compact.changes.slice(0, 12).map(change => ({
            ...change,
            beforeDisplay: ChatSessionManager._capText(change.beforeDisplay, 800),
            afterDisplay: ChatSessionManager._capText(change.afterDisplay, 800),
            rawStripped: true,
        }));
        compact.notes = compact.notes.slice(0, 6).map(note => ChatSessionManager._capText(note, 1000));
        compact.consequence = ChatSessionManager._capText(compact.consequence, 1000);
        compact.payloadCompacted = true;
        return compact;
    }

    _sanitizeUserInputRequestMeta(meta) {
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
        const sourcePreview = meta.mutationPreview && typeof meta.mutationPreview === 'object'
            ? meta.mutationPreview
            : (meta.preview && typeof meta.preview === 'object' ? meta.preview : null);
        const safe = {};
        if (meta.type !== undefined) safe.type = ChatSessionManager._capText(meta.type, 80);
        if (meta.sessionId !== undefined) safe.sessionId = ChatSessionManager._capText(meta.sessionId, 160);
        if (meta.expectedApproval !== undefined) safe.expectedApproval = ChatSessionManager._capText(meta.expectedApproval, 240);
        const guardrail = ChatSessionManager._compactGuardrail(meta.guardrail);
        if (guardrail) safe.guardrail = guardrail;
        const preview = ChatSessionManager._compactMutationPreview(sourcePreview);
        if (preview) {
            safe.mutationPreview = preview;
            if (meta.preview || meta.mutationPreview) safe.previewStripped = true;
        }

        // Preserve small primitive metadata from custom prompts, but never nested
        // payloads. Approval previews are already represented by mutationPreview.
        for (const [key, value] of Object.entries(meta)) {
            if (['type', 'sessionId', 'expectedApproval', 'guardrail', 'mutationPreview', 'preview'].includes(key)) continue;
            if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
                safe[key] = typeof value === 'string' ? ChatSessionManager._capText(value, 1000) : value;
            }
        }
        return safe;
    }

    _sanitizeUserInputRequestData(data) {
        if (!data || typeof data !== 'object') return data;
        return {
            ...data,
            question: ChatSessionManager._capText(data.question, MAX_REPLAY_CONTENT_CHARS),
            meta: this._sanitizeUserInputRequestMeta(data.meta),
        };
    }

    static _stripOversizePayloads(value, state = { depth: 0, seen: new WeakSet() }) {
        if (value === null || value === undefined) return value;
        if (typeof value === 'string') return ChatSessionManager._capText(value, 8000);
        if (typeof value !== 'object') return value;
        if (state.seen.has(value)) return '[circular]';
        if (state.depth > 6) return '[nested payload stripped]';
        state.seen.add(value);
        if (Array.isArray(value)) {
            const out = value.slice(0, 50).map(item => ChatSessionManager._stripOversizePayloads(item, { depth: state.depth + 1, seen: state.seen }));
            if (value.length > 50) out.push(`[${value.length - 50} items stripped]`);
            return out;
        }
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (/^(dataUrl|base64|beforeRaw|afterRaw|raw)$/i.test(key)) {
                out[`${key}Stripped`] = true;
                continue;
            }
            if (/^data$/i.test(key) && (typeof item === 'string' || (item && typeof item === 'object'))) {
                out.dataStripped = true;
                continue;
            }
            out[key] = ChatSessionManager._stripOversizePayloads(item, { depth: state.depth + 1, seen: state.seen });
        }
        return out;
    }

    // ─── Valid agent modes ──────────────────────────────────────────────────
    static VALID_AGENTS = ['testgenie', 'scriptgenerator', 'buggenie', 'taskgenie', 'filegenie', 'docgenie'];

    // ─── Temp file management for image attachments ─────────────────────────
    // The Copilot SDK only accepts { type: 'file', path: '/path/to/file' }
    // attachments — NOT inline base64 data. We decode images to temp files,
    // pass the paths to the SDK, then clean up after a delay.

    /** MIME type → file extension mapping for image attachments. */
    static _IMAGE_EXTENSIONS = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
    };

    static _IMAGE_MIME_BY_EXT = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
    };

    /** MIME type → file extension mapping for document attachments. */
    static _DOC_EXTENSIONS = {
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-excel': '.xls',
        'text/csv': '.csv',
        'text/plain': '.txt',
        'text/markdown': '.md',
        'application/json': '.json',
    };

    static _DOC_MIME_BY_EXT = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.doc': 'application/msword',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
    };

    /** MIME type → file extension mapping for video attachments. */
    static _VIDEO_EXTENSIONS = {
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/quicktime': '.mov',
        'video/x-msvideo': '.avi',
        'video/x-matroska': '.mkv',
    };

    /**
     * Convert base64 image/document attachments to temp files for the Copilot SDK.
     * Video attachments arrive as file paths (already on disk from streaming upload).
     * Returns SDK-compatible attachment objects with file paths.
     *
     * @param {Object[]} attachments - Frontend attachments: [{ type: 'image'|'document'|'video'|'video_link', media_type, data?, tempPath?, filename? }]
     * @returns {{ sdkAttachments: Object[], tempFiles: string[], docTempFiles: { path: string, filename: string }[], videoTempFiles: { path: string, filename: string, media_type: string }[] }}
     */
    _convertAttachmentsToTempFiles(attachments) {
        const sdkAttachments = [];
        const tempFiles = []; // Initialize tempFiles array
        const docTempFiles = []; // { path, filename } for document text extraction
        const videoTempFiles = []; // { path, filename, media_type } for video frame extraction
        const tempDir = os.tmpdir();

        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            if (!att.data && att.type !== 'video' && att.type !== 'video_link') continue;

            if (att.type === 'image') {
                const ext = ChatSessionManager._IMAGE_EXTENSIONS[att.media_type] || '.png';
                const fileName = `copilot-img-${Date.now()}-${i}${ext}`;
                const filePath = path.join(tempDir, fileName);

                try {
                    const buffer = Buffer.from(att.data, 'base64');
                    fs.writeFileSync(filePath, buffer);
                    tempFiles.push(filePath);

                    sdkAttachments.push({
                        type: 'file',
                        path: filePath,
                        displayName: `attachment-${i + 1}${ext}`,
                    });

                    console.log(`[ChatManager] \u{1F5BC}\uFE0F  Wrote temp image: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
                } catch (err) {
                    console.error(`[ChatManager] \u274C Failed to write temp image ${i}:`, err.message);
                }
            } else if (att.type === 'document') {
                const ext = ChatSessionManager._DOC_EXTENSIONS[att.media_type] || '.bin';
                // Sanitize filename — keep only safe chars
                const safeName = (att.filename || `document-${i}`).replace(/[^a-zA-Z0-9._\- ]/g, '_');
                // Ensure temp filename ends with the correct extension so parseDocument can detect the type
                const hasExt = /\.\w{1,5}$/.test(safeName);
                const fileName = `copilot-doc-${Date.now()}-${i}-${safeName}${hasExt ? '' : ext}`;
                const filePath = path.join(tempDir, fileName);

                try {
                    const buffer = Buffer.from(att.data, 'base64');
                    fs.writeFileSync(filePath, buffer);
                    docTempFiles.push({ path: filePath, filename: att.filename || `document${ext}` });

                    console.log(`[ChatManager] \u{1F4C4} Wrote temp document: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
                } catch (err) {
                    console.error(`[ChatManager] \u274C Failed to write temp document ${i}:`, err.message);
                }
            } else if (att.type === 'video' && att.tempPath) {
                // Video files arrive as paths from the streaming upload endpoint — no base64 decoding needed
                const ext = ChatSessionManager._VIDEO_EXTENSIONS[att.media_type] || '.mp4';
                const safeName = (att.filename || `video-${i}`).replace(/[^a-zA-Z0-9._\- ]/g, '_');
                try {
                    if (fs.existsSync(att.tempPath)) {
                        videoTempFiles.push({ path: att.tempPath, filename: safeName, media_type: att.media_type });
                        console.log(`[ChatManager] \u{1F3AC} Video attachment: ${safeName} (path-based, ${ext})`);
                    } else {
                        console.error(`[ChatManager] \u274C Video temp file not found: ${att.tempPath}`);
                    }
                } catch (err) {
                    console.error(`[ChatManager] \u274C Failed to process video ${i}:`, err.message);
                }
            } else if (att.type === 'video_link' && att.url) {
                // External video links are processed later by VideoAnalyzer.fetchExternalVideo()
                videoTempFiles.push({ url: att.url, provider: att.provider || 'direct', filename: `video-link-${i}`, media_type: 'video/mp4' });
                console.log(`[ChatManager] \u{1F517} Video link attachment: ${att.url} (${att.provider || 'direct'})`);
            }
        }

        return { sdkAttachments, tempFiles, docTempFiles, videoTempFiles };
    }

    /**
     * Extract text from document temp files using the existing parseDocument engine.
     * Returns a combined string to prepend to the user's prompt.
     *
     * @param {{ path: string, filename: string }[]} docTempFiles
     * @returns {Promise<string>} Extracted text block to inject into the prompt
     */
    async _extractDocumentText(docTempFiles) {
        if (!docTempFiles || docTempFiles.length === 0) return '';

        // Lazy-load parseDocument from filesystem-tools
        let parseDocument;
        try {
            parseDocument = require('./filesystem-tools').parseDocument;
        } catch (err) {
            console.error('[ChatManager] \u274C Could not load parseDocument:', err.message);
            return '\n[Document processing unavailable — filesystem-tools module not found]\n';
        }

        const MAX_TOTAL_CHARS = 100_000;
        const perDocBudget = Math.floor(MAX_TOTAL_CHARS / docTempFiles.length);
        const sections = [];

        for (const doc of docTempFiles) {
            try {
                const result = await parseDocument(doc.path, { maxChars: perDocBudget, maxRows: 25 });
                const text = this._formatParsedDocumentForPrompt(doc, result, perDocBudget);
                const meta = [];
                if (result.pageCount) meta.push(`${result.pageCount} pages`);
                if (result.slideCount) meta.push(`${result.slideCount} slides`);
                if (result.sheetCount) meta.push(`${result.sheetCount} sheets`);
                if (result.charCount) meta.push(`${result.charCount.toLocaleString()} characters`);

                sections.push(
                    `[Uploaded Document: ${doc.filename}${meta.length ? ` (${meta.join(', ')})` : ''}]\n` +
                    `---\n${text}\n---`
                );
                console.log(`[ChatManager] \u{1F4D6} Extracted text from ${doc.filename}: ${text.length} chars`);
            } catch (err) {
                sections.push(
                    `[Uploaded Document: ${doc.filename} — extraction failed: ${err.message}]`
                );
                console.error(`[ChatManager] \u274C Failed to extract text from ${doc.filename}:`, err.message);
            }
        }

        return sections.join('\n\n');
    }

    _formatParsedDocumentForPrompt(doc, result, maxChars) {
        if (result?.type === 'xlsx' && Array.isArray(result.sheets)) {
            let workbookSummary = `Workbook summary for ${doc.filename}:`;

            for (const sheet of result.sheets) {
                workbookSummary += `\n\nSheet: ${sheet.name}`;
                workbookSummary += `\n- Size: ${sheet.rowCount} rows x ${sheet.columnCount} columns`;

                const sampleRows = Array.isArray(sheet.data) ? sheet.data.slice(0, 12) : [];
                if (sampleRows.length === 0) {
                    workbookSummary += '\n- Sample rows: none';
                    continue;
                }

                workbookSummary += '\n- Sample rows:';
                for (const row of sampleRows) {
                    const values = Array.isArray(row.values)
                        ? row.values.filter(value => value !== '')
                        : [];
                    if (values.length === 0) continue;
                    workbookSummary += `\n  - Row ${row.row}: ${values.join(' | ')}`;
                }
            }

            if (maxChars && workbookSummary.length > maxChars) {
                workbookSummary = `${workbookSummary.substring(0, maxChars)}\n\n[...truncated at ${maxChars} characters]`;
            }

            return workbookSummary;
        }

        return result?.text || '';
    }

    /**
     * Clean up temp files after a delay (gives SDK time to read them).
     *
     * @param {number} [delayMs=60000] - Delay before cleanup (default: 60s)
     */
    _scheduleCleanup(tempFiles, delayMs = 60000) {
        if (!tempFiles.length) return;
        setTimeout(() => {
            for (const fp of tempFiles) {
                try {
                    if (fs.existsSync(fp)) {
                        fs.unlinkSync(fp);
                        console.log(`[ChatManager] \u{1F5D1}\uFE0F  Cleaned up temp image: ${path.basename(fp)}`);
                    }
                } catch { /* non-critical */ }
            }
        }, delayMs);
    }

    /**
     * Build system prompt for chat sessions.
     * When agentMode is set, loads the matching .agent.md file for a focused prompt.
     * When null (default), returns the general all-capabilities prompt.
     *
     * @param {string|null} agentMode
     */
    _buildSystemPrompt(agentMode) {
        // ── Agent-specific prompt from .agent.md ──
        if (agentMode && ChatSessionManager.VALID_AGENTS.includes(agentMode)) {
            try {
                const agentPromptPathCandidates = [
                    path.join(__dirname, '..', '..', '.github', 'agents', `${agentMode}.agent.md`),
                    path.join(__dirname, '..', '..', '.github', 'agents', `${agentMode}.instructions.md`),
                ];
                const agentPromptPath = agentPromptPathCandidates.find(candidate => fs.existsSync(candidate));
                if (agentPromptPath) {
                    let agentPrompt = fs.readFileSync(agentPromptPath, 'utf-8');

                    // Strip chatagent frontmatter (```chatagent\n---\n...\n---\n)
                    const fmMatch = agentPrompt.match(/^[`]{3,}chatagent\s*\n---[\s\S]*?---\s*\n/);
                    if (fmMatch) {
                        agentPrompt = agentPrompt.slice(fmMatch[0].length);
                    }
                    // Trim trailing ``` if present
                    agentPrompt = agentPrompt.replace(/\n[`]{3,}\s*$/, '').trim();

                    // Prepend a role identifier + append project standards
                    const parts = [
                        `You are the ${agentMode} agent — a specialized QA Automation assistant.`,
                        'You are running inside a web app chat session (not VS Code).',
                        'Use the custom tools available to you to complete tasks.',
                        '',
                        'CRITICAL — Jira Ticket Access:',
                        '- To READ existing Jira tickets, use the `fetch_jira_ticket` custom tool or Atlassian MCP tools (atl_getJiraIssue, atl_searchJiraIssuesUsingJql).',
                        '- To SEARCH Jira issues by JQL or free text, use the `search_jira_issues` custom tool.',
                        '- To READ a Jira Epic or inspect its child issues, use `get_jira_epic` and `get_jira_epic_issues`. To search only Epic issues, use `search_jira_epics`.',
                        '- To find Jira issues that are still not assigned to any Epic, use `list_jira_issues_without_epic` with a projectKey or scoped JQL.',
                        '- To CREATE new Jira tickets, use the `create_jira_ticket` custom tool or Atlassian MCP tools (atl_createJiraIssue).',
                        '- Only pass `labels` to `create_jira_ticket` when the user explicitly asks to add labels. Otherwise omit the labels parameter entirely.',
                        '- To UPDATE/EDIT existing Jira tickets (change summary, description, labels, priority, or add comments), use the `update_jira_ticket` custom tool.',
                        '- To INSPECT editable Jira fields and available workflow transitions, use the `get_jira_ticket_capabilities` custom tool.',
                        '- To REASSIGN an existing Jira ticket, use the `assign_jira_ticket` custom tool with an accountId or a resolvable assignee query.',
                        '- To CHANGE Jira status, use the `transition_jira_ticket` custom tool. Atlassian MCP transition tools can be used as fallback when configured.',
                        '- To DELETE a comment on a Jira ticket, use the `delete_jira_comment` custom tool. The shared Jira approval component prompts the user before deletion; do not require an inline confirmation phrase. Look up commentId via `get_jira_ticket_comments` first if unknown.',
                        '- To EDIT/UPDATE an existing Jira comment body, use the `edit_jira_comment` custom tool. The approval component will preview the old and new text before the write. Look up commentId via `get_jira_ticket_comments` first if unknown.',
                        '- To LOG time spent on a Jira ticket, or when the user says "Time Tracking" / "add hours", use the `log_jira_work` custom tool.',
                        '- To UPDATE originalEstimate or remainingEstimate fields, use the `update_jira_estimates` custom tool only when the user explicitly asks for estimate changes.',
                        '- If a request mixes worklog language and estimate language, ask which one the user wants before mutating Jira time tracking fields.',
                        '- NEVER use web/fetch, fetch_webpage, or HTTP scraping to access Jira URLs — Jira is a client-rendered SPA and HTML scraping returns no useful content.',
                        '- When creating Testing tasks for Bug-type tickets, FIRST use `fetch_jira_ticket` to read the parent ticket details (summary, issue type, description, acceptance criteria), THEN create the Testing task with proper context.',
                        '',
                        'CRITICAL — Jira URL Handling:',
                        '- When the user provides a Jira ticket URL (e.g., https://corelogic.atlassian.net/browse/AOTF-16514), extract the base URL (everything before "/browse/") and pass it as the `jiraBaseUrl` parameter when calling `create_jira_ticket`.',
                        '- This ensures the returned ticket URL matches the user\'s Jira instance domain.',
                        '- Example: if user gives "https://corelogic.atlassian.net/browse/AOTF-16514", set jiraBaseUrl="https://corelogic.atlassian.net".',
                        '- When the user provides a Jira browse URL and asks to read or summarize the ticket, use `fetch_jira_ticket` with the ticket key or the full URL. Do not ask the user to paste the ticket text manually.',
                        '',
                        'CRITICAL — Confluence URL Handling:',
                        '- To READ and NAVIGATE Confluence directly, prefer `search_confluence_content`, `get_confluence_page_details`, `list_confluence_spaces`, `list_confluence_pages_in_space`, and `get_confluence_page_tree`.',
                        '- Keep `search_knowledge_base` and `get_knowledge_base_page` for grounding-oriented KB retrieval across providers, or use Atlassian MCP Confluence tools as fallback.',
                        '- When the user provides a Confluence page URL (e.g., https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/...), extract the page ID (189467646) and fetch it directly with `get_confluence_page_details`. The tool also accepts the full URL.',
                        '- If the user asks to summarize a specific section from a Confluence URL, fetch the page first and summarize only that requested section.',
                        '- NEVER claim a Confluence page cannot be accessed because of browser login when the KB connector or Atlassian MCP tools are available in the session.',
                        '',
                        'CRITICAL — Testing Task Description Formatting:',
                        '- When creating Testing tasks for Bug-type parent tickets, format test cases as MARKDOWN TABLES in the description.',
                        '- Use this exact table format:',
                        '  | Test Step ID | Specific Activity or Action | Expected Results | Actual Results |',
                        '  |---|---|---|---|',
                        '  | 1.1 | Step description | Expected result | Actual result |',
                        '- Include section headings with ## for structure (e.g., ## Test Cases, ## Pre-Conditions).',
                        '- Use **bold** for section labels like **Description :-**, **Steps to Reproduce :-**.',
                        '- Use `code` for identifiers, field names, and event names, but do not combine bold and inline code on the same text span.',
                        '- The description field supports a Jira-safe subset of rich formatting — markdown bold, headings, tables, lists, and inline code will be converted to Jira\'s native format (ADF) for proper rendering.',
                        '- When calling out an observation, issue, blocker, or risk in Jira-bound content, start a new line or heading with `Observation:`, `Issue:`, `Blocker:`, or `Risk:` so the formatter can auto-emphasize it.',
                        '',
                        'RESPONSE FORMATTING — Rich Markdown:',
                        '- Use ## and ### headings to structure long responses into clear sections.',
                        '- When the user explicitly asks to see a screenshot or visual proof in chat, save the screenshot to a file and call `publish_image_to_chat` so the image appears inline in the conversation.',
                        '- For flowcharts, process diagrams, decision trees, or architecture overviews, use mermaid fenced code blocks (```mermaid). The chat UI renders these as interactive SVG diagrams.',
                        '- IMPORTANT: In mermaid diagrams, always wrap node labels and edge labels in double quotes if they contain parentheses, slashes, commas, colons, or special characters. Example: A["Check config (v2)"] -->|"Already seen"| B["Skip"].',
                        '- Use markdown tables for structured comparisons, feature matrices, or data.',
                        '- When citing Knowledge Base sources, use blockquote format: > **Source:** [Page Title](url)',
                        '- For long supplementary content, use collapsible sections: <details><summary>Title</summary>Content</details>',
                        '- When explaining multi-step processes, prefer a mermaid flowchart over numbered text lists.',
                        '',
                        agentPrompt,
                    ];
                    // Append copilot-instructions for project context
                    try {
                        const instructionsPath = path.join(__dirname, '..', '..', '.github', 'copilot-instructions.md');
                        if (fs.existsSync(instructionsPath)) {
                            const instructions = fs.readFileSync(instructionsPath, 'utf-8');
                            const critical = extractCriticalInstructions(instructions);
                            parts.push('', '<project_standards>', critical, '</project_standards>');
                        }
                    } catch { /* ignore */ }

                    // Inject grounding context (domain terms, project rules, relevant code)
                    if (this._groundingStore) {
                        try {
                            const groundingCtx = this._groundingStore.buildGroundingContext(agentMode, {
                                taskDescription: '',
                                ticketId: null,
                            });
                            if (groundingCtx && groundingCtx.length > 0) {
                                parts.push('', '<grounding_context>', groundingCtx, '</grounding_context>');
                                console.log(`[ChatManager] 📚 Injected grounding context for ${agentMode} (${groundingCtx.length} chars)`);
                            }
                        } catch (err) {
                            console.warn(`[ChatManager] ⚠️ Grounding context failed for ${agentMode}: ${err.message}`);
                        }
                    }

                    // SDK context: strip VS Code MCP tool prefix so LLM uses raw names
                    console.log(`[ChatManager] Loaded agent prompt: ${path.basename(agentPromptPath)}`);
                    return stripVSCodeToolPrefix(parts.join('\n'));
                }
            } catch (err) {
                console.warn(`[ChatManager] Failed to load prompt for ${agentMode}: ${err.message}`);
            }
        }

        // ── TPM: unified all-capabilities prompt with agent-specific expertise ──
        const parts = [
            'You are TPM (Test Project Manager) — a unified QA Automation powerhouse powered by the Copilot SDK.',
            'You combine the full capabilities of TestGenie, ScriptGenie, BugGenie, TaskGenie, and DocGenie into a single session.',
            'You are running inside a web app chat session (not VS Code).',
            'Use the custom tools available to you to complete tasks.',
            '',
            '## Your Unified Capabilities',
            '| Capability | When to Activate | Key Tools |',
            '|---|---|---|',
            '| **TestGenie** — Test case generation | User asks to generate test cases, create test scenarios, or references a Jira ticket for testing | `fetch_jira_ticket`, `generate_test_case_excel`, Atlassian MCP |',
            '| **ScriptGenie** — Playwright script generation | User asks to automate, create scripts, explore pages via browser, or generate .spec.js | MCP browser tools (`navigate`, `snapshot`, `click`, etc.), `get_framework_inventory`, `validate_generated_script` |',
            '| **BugGenie** — Bug ticket creation | User asks to create bug/defect tickets, report issues, or review test failures | `create_jira_ticket`, `get_test_results`, `analyze_test_failure`, Atlassian MCP |',
            '| **TaskGenie** — Jira task creation | User asks to create Testing tasks, create true subtasks, link or unlink tasks, search issues or epics, inspect Epic membership, assign or reassign work, change status, log work, or explicitly update original/remaining estimates | `search_jira_issues`, `search_jira_epics`, `get_jira_epic`, `get_jira_epic_issues`, `list_jira_issues_without_epic`, `assign_jira_ticket`, `create_jira_ticket`, `fetch_jira_ticket`, `get_jira_current_user`, `search_jira_users`, `get_jira_ticket_capabilities`, `remove_jira_issue_link`, `transition_jira_ticket`, `log_jira_work`, `update_jira_estimates`, Atlassian MCP |',
            '| **FileGenie** — File & document interaction | User asks to open/view files, browse folders, parse documents, organize files, or reveal files in Explorer/Finder | `open_file_native`, `open_containing_folder`, `search_files`, `parse_document`, `list_directory` |',
            '| **DocGenie** — Document and presentation generation | User asks for presentations, reports, infographics, workbook-to-PPT conversion, or polished document outputs | `list_session_documents`, `parse_session_document`, `generate_pptx`, `generate_docx`, `generate_pdf`, `generate_excel_report`, `generate_infographic`, `generate_video` |',
            '',
            '## Intent Detection & Agent Activation',
            'Detect the user\'s intent from their message and activate the appropriate expertise:',
            '- **Test case keywords**: "generate test cases", "test scenarios", "test steps", "excel", "test case" → Activate TestGenie expertise',
            '- **Script generation keywords**: "automate", "script", "spec.js", "explore page", "MCP", "playwright", "browser" → Activate ScriptGenie expertise',
            '- **Bug report keywords**: "bug", "defect", "issue", "failure", "broken", "not working", "create bug", "screen recording", "video recording", "recording of bug", "attached video", "video shows" → Activate BugGenie expertise',
            '- **Task creation keywords**: "task", "testing task", "assign", "link task", "create task" → Activate TaskGenie expertise',
            '- **File open/view keywords**: "open file", "open the", "launch", "view in app", "show in explorer", "reveal in finder", "open excel", "open word", "open report", "open video", "open folder", "open ppt", "open pdf" → Activate FileGenie file-opening tools',
            '- **Document/video generation keywords**: "generate video", "animation", "animated", "video walkthrough", "multimedia", "create document", "generate presentation", "create slides", "generate report", "infographic", "poster", "html report", "generate markdown", "create pdf", "generate pptx", "generate docx", "storyboard" → Activate DocGenie document generation expertise',
            '- **General QA queries**: Framework questions, test execution, code review → Use general QA knowledge',
            '- If intent is ambiguous, ask the user which capability they need.',
            '',
            'CRITICAL — Jira Ticket Access:',
            '- To READ existing Jira tickets, use the `fetch_jira_ticket` custom tool or Atlassian MCP tools (atl_getJiraIssue, atl_searchJiraIssuesUsingJql).',
            '- To SEARCH Jira issues by JQL or free text, use the `search_jira_issues` custom tool.',
            '- To READ a Jira Epic or inspect its child issues, use `get_jira_epic` and `get_jira_epic_issues`. To search only Epic issues, use `search_jira_epics`.',
            '- To find Jira issues that are still not assigned to any Epic, use `list_jira_issues_without_epic` with a projectKey or scoped JQL.',
            '- To CREATE new Jira tickets, use the `create_jira_ticket` custom tool or Atlassian MCP tools (atl_createJiraIssue).',
            '- Only pass `labels` to `create_jira_ticket` when the user explicitly asks to add labels. Otherwise omit the labels parameter entirely.',
            '- For true Jira subtasks, call `create_jira_ticket` with `parentIssueKey`. For loose related tasks, call `create_jira_ticket` with `linkedIssueKey`. Do not send both in the same request.',
            '- To UPDATE/EDIT existing Jira tickets (change summary, description, labels, priority, or add comments), use the `update_jira_ticket` custom tool.',
            '- To INSPECT editable Jira fields and available workflow transitions, use the `get_jira_ticket_capabilities` custom tool.',
            '- To ASSIGN Jira work to a named user, use `search_jira_users` to resolve the accountId first, then pass that accountId to `create_jira_ticket` as `assigneeAccountId`.',
            '- To REASSIGN an existing Jira ticket, use the `assign_jira_ticket` custom tool with an accountId or a resolvable assignee query.',
            '- To DELETE a Jira ticket created by mistake, use the `delete_jira_ticket` custom tool only after the user explicitly confirms with DELETE <ticketId> or DELETE <ticketId> WITH SUBTASKS in their latest message.',
            '- To DELETE a comment on a Jira ticket, use the `delete_jira_comment` custom tool. The shared Jira approval component prompts the user before deletion; do not require an inline confirmation phrase. Look up commentId via `get_jira_ticket_comments` first if unknown.',
            '- To EDIT/UPDATE an existing Jira comment body, use the `edit_jira_comment` custom tool. The approval component will preview the old and new text before the write. Look up commentId via `get_jira_ticket_comments` first if unknown.',
            '- To REMOVE an existing Jira issue link, use the `remove_jira_issue_link` custom tool only when the user explicitly asks to unlink tickets or remove an associated link.',
            '- To CHANGE Jira status, use the `transition_jira_ticket` custom tool. Atlassian MCP transition tools can be used as fallback when configured.',
            '- To LOG time spent on a Jira ticket, or when the user says "Time Tracking" / "add hours", use the `log_jira_work` custom tool.',
            '- To UPDATE originalEstimate or remainingEstimate fields, use the `update_jira_estimates` custom tool only when the user explicitly asks for estimate changes.',
            '- If a request mixes worklog language and estimate language, ask which one the user wants before mutating Jira time tracking fields.',
            '- NEVER use web/fetch, fetch_webpage, or HTTP scraping to access Jira URLs — Jira is a client-rendered SPA and HTML scraping returns no useful content.',
            '- When creating Testing tasks for Bug-type tickets, FIRST use `fetch_jira_ticket` to read the parent ticket details, THEN create the Testing task with proper context.',
            '',
            'CRITICAL — Jira URL Handling:',
            '- When the user provides a Jira ticket URL (e.g., https://corelogic.atlassian.net/browse/AOTF-16514), extract the base URL (everything before "/browse/") and pass it as the `jiraBaseUrl` parameter when calling `create_jira_ticket`.',
            '- When the user provides a Jira browse URL and asks to read or summarize the ticket, use `fetch_jira_ticket` with the ticket key or the full URL. Do not ask the user to paste the ticket text manually.',
            '',
            'CRITICAL — Confluence URL Handling:',
            '- To READ and NAVIGATE Confluence directly, prefer `search_confluence_content`, `get_confluence_page_details`, `list_confluence_spaces`, `list_confluence_pages_in_space`, and `get_confluence_page_tree`.',
            '- Keep `search_knowledge_base` and `get_knowledge_base_page` for grounding-oriented KB retrieval across providers, or use Atlassian MCP Confluence tools as fallback.',
            '- When the user provides a Confluence page URL (e.g., https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/...), fetch it directly with `get_confluence_page_details`. The tool accepts the full URL and numeric page ID.',
            '- If the user asks to summarize a specific section from a Confluence URL, fetch the page first and summarize only that requested section.',
            '- NEVER claim a Confluence page cannot be accessed because of browser login when the KB connector or Atlassian MCP tools are available in the session.',
            '',
            'CRITICAL — Testing Task Description Formatting:',
            '- When creating Testing tasks for Bug-type parent tickets, format test cases as MARKDOWN TABLES in the description.',
            '- Use this exact table format:',
            '  | Test Step ID | Specific Activity or Action | Expected Results | Actual Results |',
            '  |---|---|---|---|',
            '  | 1.1 | Step description | Expected result | Actual result |',
            '',
            'CRITICAL — Test execution:',
            '- When asked to RUN or EXECUTE a test script or folder, use `execute_test` for structured test results.',
            '- `execute_test` auto-detects the test framework (Playwright, WebDriverIO, Cypress, Jest, Mocha, Vitest) from config files and package.json.',
            '- It works with BOTH workspace paths and external project paths (absolute paths to other repos).',
            '- It accepts individual test files (.spec.js, .test.js, .e2e.js, .cy.js), folders, and keywords like "planner" or "notes".',
            '- Use the optional `framework` parameter to override auto-detection: execute_test({ specPath: "...", framework: "webdriverio" }).',
            '- For arbitrary shell commands, scripts, or non-test execution, use the `run_command` tool.',
            '- `run_command` can run ANY command: npm, npx, bash scripts, Python, WebDriverIO CLI, Selenium, custom CLIs — in any directory.',
            '- Prefer `execute_test` over `run_command` for test files (structured pass/fail results and report saving).',
            '- NEVER use the MCP tool `run_playwright_code` to execute .spec.js test files.',
            '- Examples: execute_test({ specPath: "planner" }), execute_test({ specPath: "C:\\\\path\\\\to\\\\external\\\\tests" }), run_command({ command: "npx wdio run wdio.conf.js", cwd: "C:\\\\path\\\\to\\\\project" })',
            '',
            'CRITICAL — Test file discovery:',
            '- When a user asks to run a test by NAME without providing a full path,',
            '  you MUST FIRST call `find_test_files` with the name/keyword to locate matching spec files or folders.',
            '- THEN use `execute_test` with the resolved path from the search results.',
            '- NEVER guess or hardcode spec file paths — always verify they exist first.',
            '',
            'Framework context (this workspace):',
            '- Primary framework: Playwright (JavaScript, CommonJS, .spec.js)',
            '- External projects: auto-detected (WebDriverIO, Cypress, Jest, Mocha, Vitest, etc.)',
            '- Page Objects pattern with POmanager',
            '- PopupHandler utility for modal dismissal',
            '- Test data via userTokens from testData.js',
            '',
            'RESPONSE FORMATTING — Rich Markdown:',
            '- Use ## and ### headings to structure long responses into clear sections.',
            '- When the user explicitly asks to see a screenshot or visual proof in chat, save the screenshot to a file and call `publish_image_to_chat` so the image appears inline in the conversation.',
            '- For flowcharts, process diagrams, decision trees, or architecture overviews, use mermaid fenced code blocks (```mermaid). The chat UI renders these as interactive SVG diagrams.',
            '- IMPORTANT: In mermaid diagrams, always wrap node labels and edge labels in double quotes if they contain parentheses, slashes, commas, colons, or special characters.',
            '- Use markdown tables for structured comparisons, feature matrices, or data.',
            '- When citing Knowledge Base sources, use blockquote format: > **Source:** [Page Title](url)',
            '- Use **bold** for key terms and `inline code` for technical identifiers.',
            '- For long supplementary content, use collapsible sections: <details><summary>Section Title</summary>Content here</details>',
            '- Keep the main answer concise; put detailed breakdowns in collapsible sections.',
            '- When explaining multi-step processes, prefer a mermaid flowchart over numbered text lists.',
        ];

        // ── Inject agent-specific expertise from .agent.md files ──
        const agentExpertise = [
            { name: 'testgenie', tag: 'testgenie_capabilities', label: 'TestGenie (Test Case Generation)' },
            { name: 'scriptgenerator', tag: 'scriptgenie_capabilities', label: 'ScriptGenie (Playwright Script Generation)' },
            { name: 'buggenie', tag: 'buggenie_capabilities', label: 'BugGenie (Bug Ticket Creation)' },
            { name: 'taskgenie', tag: 'taskgenie_capabilities', label: 'TaskGenie (Jira Task Creation)' },
        ];

        for (const agent of agentExpertise) {
            try {
                const agentMdPath = path.join(__dirname, '..', '..', '.github', 'agents', `${agent.name}.agent.md`);
                if (fs.existsSync(agentMdPath)) {
                    let agentPrompt = fs.readFileSync(agentMdPath, 'utf-8');

                    // Strip chatagent frontmatter
                    const fmMatch = agentPrompt.match(/^[`]{3,}chatagent\s*\n---[\s\S]*?---\s*\n/);
                    if (fmMatch) agentPrompt = agentPrompt.slice(fmMatch[0].length);
                    agentPrompt = agentPrompt.replace(/\n[`]{3,}\s*$/, '').trim();

                    // Cap each agent section to prevent excessive prompt bloat
                    const MAX_AGENT_CHARS = 8000;
                    if (agentPrompt.length > MAX_AGENT_CHARS) {
                        agentPrompt = agentPrompt.substring(0, MAX_AGENT_CHARS) + '\n… (expertise truncated for context budget)';
                    }

                    parts.push(
                        '',
                        `<${agent.tag}>`,
                        `## ${agent.label} Expertise`,
                        'Activate this expertise when user intent matches this agent\'s domain.',
                        '',
                        agentPrompt,
                        `</${agent.tag}>`,
                    );
                    console.log(`[ChatManager] 🧩 Injected ${agent.name} expertise (${agentPrompt.length} chars) into TPM prompt`);
                }
            } catch (err) {
                console.warn(`[ChatManager] ⚠️ Failed to load ${agent.name}.agent.md for TPM: ${err.message}`);
            }
        }

        // Add copilot-instructions if available (extract critical sections, not blind truncation)
        try {
            const instructionsPath = path.join(__dirname, '..', '..', '.github', 'copilot-instructions.md');
            if (fs.existsSync(instructionsPath)) {
                const instructions = fs.readFileSync(instructionsPath, 'utf-8');
                const critical = extractCriticalInstructions(instructions);
                parts.push('', '<project_standards>', critical, '</project_standards>');
            }
        } catch { /* ignore */ }

        // Inject grounding context for TPM (uses null/general mode)
        if (this._groundingStore) {
            try {
                const groundingCtx = this._groundingStore.buildGroundingContext('default', {
                    taskDescription: '',
                    ticketId: null,
                });
                if (groundingCtx && groundingCtx.length > 0) {
                    parts.push('', '<grounding_context>', groundingCtx, '</grounding_context>');
                    console.log(`[ChatManager] 📚 Injected grounding context for TPM (${groundingCtx.length} chars)`);
                }
            } catch (err) {
                console.warn(`[ChatManager] ⚠️ Grounding context failed for TPM: ${err.message}`);
            }
        }

        // Strip VS Code MCP tool prefix so LLM uses raw names
        return stripVSCodeToolPrefix(parts.join('\n'));
    }

    _getAgentToolProfile(agentSelection = null) {
        return agentSelection?.toolProfile || (agentSelection?.agentMode || 'full');
    }

    _getAgentCapabilities(agentSelection = null) {
        return agentSelection?.capabilities || { browser: true, jira: true, filesystem: 'read' };
    }

    _getFilesystemAccess(agentSelection = null) {
        const capabilities = this._getAgentCapabilities(agentSelection);
        const filesystem = String(capabilities.filesystem || 'none').trim().toLowerCase();
        return ['none', 'read', 'write'].includes(filesystem) ? filesystem : 'none';
    }

    _buildWorkspaceAgentPrompt(agentSelection) {
        const toolProfile = this._getAgentToolProfile(agentSelection);
        const basePrompt = toolProfile === 'full'
            ? this._defaultSystemPrompt
            : this._buildSystemPrompt(agentSelection?.agentMode || toolProfile);

        let customPrompt = '';
        const promptPath = agentSelection?.promptPath
            ? path.join(PROJECT_ROOT, agentSelection.promptPath)
            : null;

        if (promptPath && fs.existsSync(promptPath)) {
            try {
                customPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
            } catch (error) {
                console.warn(`[ChatManager] Failed to read workspace prompt ${promptPath}: ${error.message}`);
            }
        }

        const parts = [
            `You are ${agentSelection?.label || 'Workspace Agent'} — a published workspace agent running inside the QA Automation web app chat.`,
            agentSelection?.workspaceName ? `Workspace: ${agentSelection.workspaceName}` : '',
            agentSelection?.description ? `Description: ${agentSelection.description}` : '',
            `Execution profile: ${toolProfile}.`,
            'Follow the workspace-specific instructions first. When they are silent, fall back to the base execution profile below.',
        ].filter(Boolean);

        if (customPrompt) {
            parts.push('<workspace_agent_instructions>', customPrompt, '</workspace_agent_instructions>');
        }

        // Inject project skills activation guide so workspace agents know skills exist
        // (core agents get this via AGENT_LAYERS in prompt-layers.js; workspace agents need it here)
        const skillsGuide = buildProjectSkillActivationGuide();
        if (skillsGuide) {
            parts.push('<skills>', skillsGuide, '</skills>');
        }

        // Teach workspace agents about the Tool Broker dynamic-delegation escape hatch.
        // Workspace agents are loaded with a narrow, intent-inferred native tool set
        // (see _buildCustomAgentTools) — when the user prompt drifts into a domain
        // outside that set, the agent should discover and invoke the missing tool
        // via the broker rather than refusing or hallucinating.
        parts.push(
            '<dynamic_tool_delegation>',
            'Your native tools are intentionally focused on your declared purpose. When a user request needs a capability you do not see in your tool list (for example: a pasted Jira/Confluence URL, a request to fetch a ticket, generate a PPT/PDF/Excel, run a Playwright test, attach evidence to a ticket), do this:',
            '  1. Call `list_delegatable_tools` (optionally with `{ "category": "jira"|"document"|"framework"|"evidence"|"grounding"|"pipeline" }`) to discover tools you can borrow.',
            '  2. Call `cross_agent_delegate` with `{ "toolName": "<discovered tool>", "parameters": { ... } }` to execute it.',
            '  3. The approval flow, permissions, and progress broadcasts are preserved transparently. Do NOT ask the user for permission yourself — the broker handles it.',
            '  4. If `cross_agent_delegate` returns a permission-denied error, relay it to the user verbatim and stop — do not retry.',
            'Never invent tool names or pretend a missing capability exists. Discovery via `list_delegatable_tools` is mandatory before delegation.',
            '</dynamic_tool_delegation>'
        );

        parts.push('<base_execution_profile>', basePrompt, '</base_execution_profile>');
        return stripVSCodeToolPrefix(parts.join('\n\n'));
    }

    _buildSystemPromptForSelection(agentSelection = null) {
        if (agentSelection?.source === 'workspace') {
            return this._buildWorkspaceAgentPrompt(agentSelection);
        }
        if (agentSelection?.agentMode) {
            return this._buildSystemPrompt(agentSelection.agentMode);
        }
        // Default merged profile (TPM) — the master/orchestrator. Append the routing
        // policy so it prefers delegating to a matching specialist over self-serving.
        return `${this._defaultSystemPrompt}\n\n${this._buildMasterRoutingPolicy()}`;
    }

    // ════════════════════════════════════════════════════════════════════════
    // AGENT ORCHESTRATION — master routing + agent-to-agent delegation
    // ════════════════════════════════════════════════════════════════════════

    /** True when this selection is the default merged "master" (TPM) profile. */
    _isMasterSelection(agentSelection = null) {
        return !agentSelection?.agentMode && agentSelection?.source !== 'workspace';
    }

    /** Static routing policy injected into the master (TPM) system prompt. */
    _buildMasterRoutingPolicy() {
        return [
            '<master_routing_policy>',
            'You are the master agent (TPM) and the ORCHESTRATOR for a team of specialist agents.',
            'Before doing a task yourself, decide whether a published specialist agent matches the user\'s intent:',
            '- If a specialist clearly matches, you MUST delegate to it via the `delegate_to_specialist` tool instead of doing the work yourself. Delegate the GOAL and raw context — not a pre-written final deliverable — so the specialist applies its own craft.',
            '- When you delegate, briefly tell the user which specialist you are handing the task to (e.g. "Handing this to CommentGenie…"). Do NOT imply you are doing the work yourself or "through the ticket workflow".',
            '- Delegate ONCE. Approvals (e.g. Jira writes) are shown automatically by the platform — do NOT add your own approval step (ask_user) and do NOT re-delegate "to post after approval".',
            '- After delegation, NEVER post/update Jira yourself for that same delegated task. If the specialist returns a draft or asks for info/approval, summarize that state and wait for the user/specialist flow. Do not call `update_jira_ticket` or any Jira write tool as a fallback unless the delegate tool explicitly reports failure and the user asks YOU to take over.',
            '- If NO specialist matches, do it yourself. For irreversible actions the platform shows a single approval automatically.',
            'Each turn you may receive an <intent_routing> hint with the live specialist roster and the best match. Follow it.',
            '</master_routing_policy>',
        ].join('\n');
    }

    /**
     * Lazily construct an AgentSessionFactory for delegated sub-sessions, using the
     * CURRENT session's model (not the manager default) so the specialist runs on
     * the same — available — model the user selected. Cached per model.
     */
    _getDelegationFactory(model) {
        const useModel = model || this.model;
        if (typeof this.defineTool !== 'function') {
            throw new Error('Cannot create delegated agent session: defineTool is not available on ChatSessionManager');
        }
        if (this._delegationFactory && this._delegationFactoryModel === useModel) {
            return this._delegationFactory;
        }
        const { AgentSessionFactory } = require('./agent-sessions');
        this._delegationFactory = new AgentSessionFactory({
            client: this.client,
            defineTool: this.defineTool,
            model: useModel,
            config: this.config,
            learningStore: this.learningStore,
            verbose: false,
        });
        this._delegationFactoryModel = useModel;
        return this._delegationFactory;
    }

    /** Published delegation targets (core specialists + custom agents) minus the master. Cached 30s. */
    async _getDelegationTargets() {
        const now = Date.now();
        if (this._delegationTargetsCache && now - this._delegationTargetsCacheAt < 30000) {
            return this._delegationTargetsCache;
        }
        let agents = [];
        try {
            agents = await this._agentCatalog.listChatAgents({ includeDraft: false, includeInactive: false });
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ Delegation target listing failed: ${err.message}`);
            agents = [];
        }
        const masterId = buildCoreAgentId(null);
        this._delegationTargetsCache = (agents || []).filter(a => a && a.id !== masterId);
        this._delegationTargetsCacheAt = now;
        return this._delegationTargetsCache;
    }

    /** Resolve a delegation target by id, label, or core mode. */
    async resolveDelegationTarget(nameOrId) {
        const wanted = String(nameOrId || '').trim();
        if (!wanted) return { ok: false };
        const targets = await this._getDelegationTargets();
        const lower = wanted.toLowerCase();
        const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
        // 1) Identify WHICH agent from the lightweight roster (by id / label / mode).
        const match =
            targets.find(a => a.id === wanted) ||
            targets.find(a => (a.label || '').toLowerCase() === lower) ||
            targets.find(a => (a.agentMode || '').toLowerCase() === lower) ||
            targets.find(a => squash(a.label) === squash(wanted));
        const resolvedId = match?.id
            || ((wanted.startsWith('workspace:') || wanted.startsWith('core:')) ? wanted : null);

        // 2) Resolve the CANONICAL FULL descriptor — the SAME object a DIRECT chat
        // session uses. CRITICAL: listChatAgents() returns a PUBLIC descriptor that
        // STRIPS `promptPath`; building a workspace session from it drops the agent's
        // custom instructions, so the delegated specialist behaves generically (posts
        // verbatim instead of applying its skills). resolveAgentSelection() returns
        // the full descriptor WITH promptPath → true direct-session parity.
        let sel = null;
        if (resolvedId) {
            try {
                const full = await this._agentCatalog.resolveAgentSelection({ agentId: resolvedId });
                if (full && full.id !== buildCoreAgentId(null)) sel = full;
            } catch { /* fall through to roster match */ }
        }
        // Core agents load their prompt from .agent.md by role (no promptPath needed),
        // so the roster match is a safe fallback when full resolution is unavailable.
        if (!sel) sel = match || null;
        if (!sel) return { ok: false };

        if (sel.capabilityProfile) { try { sel = applyCapabilityProfile(sel); } catch { /* ignore */ } }
        const kind = sel.source === 'workspace' ? 'workspace' : 'core';
        return {
            ok: true,
            selection: sel,
            label: sel.label || sel.id,
            target: { id: sel.id, kind, role: kind === 'core' ? (sel.agentMode || null) : null, label: sel.label || sel.id },
        };
    }

    /** Tool deps for a delegated sub-session (routes approvals to this chat). */
    _buildDelegationToolOpts(sessionId) {
        return {
            learningStore: this.learningStore,
            config: this.config,
            groundingStore: this._groundingStore || null,
            chatManager: this,
            sessionContext: { sessionId, delegatedAgent: true },
            getSessionId: () => sessionId,
        };
    }

    shouldBlockMasterWriteAfterDelegation(sessionContext, toolName, params = {}) {
        const sessionId = sessionContext?.sessionId || null;
        if (!sessionId || sessionContext?.delegatedAgent === true) return { blocked: false };
        const lock = this._delegatedWriteLocks.get(sessionId);
        if (!lock) return { blocked: false };
        if (Date.now() > lock.expiresAt) {
            this._delegatedWriteLocks.delete(sessionId);
            return { blocked: false };
        }
        const isCommentWrite = toolName === 'update_jira_ticket' && typeof params.comment === 'string' && params.comment.trim();
        if (!isCommentWrite) return { blocked: false };
        return {
            blocked: true,
            message:
                `This Jira comment task was delegated to ${lock.agentLabel}. ` +
                'Do not post a fallback comment from TPM; let the specialist complete its approval/write flow or ask the user what to do next.',
        };
    }

    /**
     * Build a `createSession` adapter (for runAgentStep) that constructs the
     * specialist session with DIRECT-SESSION PARITY:
     *   - core   → factory.createAgentSession(role)  (role .agent.md prompt + role tools)
     *   - custom → the SAME prompt + tool bundle a direct chat session would build
     * Approvals route to this chat via chatManager + sessionContext.
     */
    buildDelegationCreateSession(selection, sessionId) {
        const sessionModel = this._sessions.get(sessionId)?.model || this.model;
        const factory = this._getDelegationFactory(sessionModel);
        const isWorkspace = selection.source === 'workspace';
        return async (target, sessionOpts = {}) => {
            let ctx;
            if (isWorkspace) {
                const toolOpts = this._buildDelegationToolOpts(sessionId);
                const systemPrompt = this._buildWorkspaceAgentPrompt(selection);
                const hasCustomInstructions = systemPrompt.includes('<workspace_agent_instructions>');
                console.log(`[ChatManager] 🤝 Workspace delegation '${selection.label}' — promptPath: ${selection.promptPath ? 'present' : 'MISSING'}, customInstructions: ${hasCustomInstructions ? 'LOADED' : 'NONE (will be generic!)'}, prompt ${systemPrompt.length} chars`);
                const categories = this._inferToolCategoriesForAgent(selection);
                const tools = this._buildCustomAgentTools(categories, toolOpts);
                ctx = {
                    systemPromptOverride: systemPrompt,
                    rawSystemPrompt: true,
                    toolsOverride: tools,
                    disableBroker: true,
                    ticketContext: sessionOpts.ticketContext || '',
                    runId: sessionId,
                    chatManager: this,
                    sessionContext: { sessionId },
                };
            } else {
                ctx = {
                    ticketContext: sessionOpts.ticketContext || '',
                    runId: sessionId,
                    chatManager: this,
                    sessionContext: { sessionId },
                };
            }
            const agentName = isWorkspace ? selection.id : (selection.agentMode || null);
            const { session, sessionId: sid } = await factory.createAgentSession(agentName, ctx);
            return {
                sessionId: sid,
                sendAndWait: (prompt, opts) => factory.sendAndWait(session, prompt, opts),
                destroy: () => factory.destroySession(sid).catch(() => {}),
            };
        };
    }

    /** Semantic routing recommendation over the live specialist roster. */
    async recommendDelegationForMessage(message) {
        const targets = await this._getDelegationTargets();
        const roster = targets.map(a => ({ id: a.id, label: a.label, description: a.description, keywords: a.keywords || [] }));
        const routingCfg = this.config?.orchestration?.routing || {};
        const rec = this._intentRouter.recommend(message, roster, {
            shortlistK: routingCfg.shortlistK,
            confidenceThreshold: routingCfg.confidenceThreshold,
            marginRatio: routingCfg.marginRatio,
        });
        return { rec, targets };
    }

    /** Latest user message text for a session (direct-parity handoff). */
    getLatestUserMessageText(sessionId) {
        const msg = this._latestUserMessage.get(sessionId);
        return isNonEmptyString(msg) ? msg : null;
    }

    /**
     * Execute a delegation: resolve target → build parity session → run the
     * specialist on the user's ORIGINAL message → return its result to the master.
     * Called by the delegate_to_specialist tool.
     */
    async runDelegation({ agentName, task, sessionId }) {
        const resolved = await this.resolveDelegationTarget(agentName);
        if (!resolved.ok) {
            const targets = await this._getDelegationTargets();
            const names = targets.map(t => t.label).join(', ');
            return JSON.stringify({ success: false, error: `No specialist matches "${agentName}". Available: ${names || '(none)'}. If none fit, handle it yourself.` });
        }
        const cfg = this.config?.orchestration?.delegation || {};
        const delegationId = `deleg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const streamEnabled = cfg.streamDeltas !== false;
        const originalMsg = this.getLatestUserMessageText(sessionId);
        const input = originalMsg || task || '';
        const delegationContext = [
            'You are running as a delegated specialist inside the current chat.',
            'The user message you receive is authoritative. Apply your own custom instructions, skills, formatting rules, and workflow exactly as you would in a direct chat session.',
            'The master-agent task, if present, is only a routing note. Do not treat it as final wording or exact content unless the user explicitly asked for verbatim posting in their own message.',
            'If your custom instructions require user approval before posting, use the actual interactive user-input mechanism (`ask_user` / `ask_questions`) so the user can approve in chat. Do NOT merely write "Approval request:" as plain assistant text and stop.',
            'If the user approves, YOU must call your gated Jira write tool (for example `update_jira_ticket` with `comment`) yourself. The master agent must not post on your behalf.',
        ].join('\n');

        // Announce the sub-thread so the UI renders a nested specialist view.
        this._broadcastToSSE(sessionId, CHAT_EVENTS.DELEGATION_START, {
            delegationId,
            agentLabel: resolved.label,
            agentId: resolved.target.id,
            task: originalMsg || task || '',
        });

        // Throttle the specialist's per-token deltas (the backend already coalesces
        // main-chat deltas; do the same here to avoid flooding the SSE channel).
        let deltaBuf = '';
        let streamedChars = 0;
        let flushTimer = null;
        const maxStreamed = cfg.maxStreamedChars ?? 24000;
        const flushDelta = () => {
            if (!deltaBuf) return;
            const chunk = deltaBuf;
            deltaBuf = '';
            this._broadcastToSSE(sessionId, CHAT_EVENTS.DELEGATION_DELTA, { delegationId, deltaContent: chunk });
        };

        const createSession = this.buildDelegationCreateSession(resolved.selection, sessionId);
        const delegatedTools = [];
        const delegatedWriteTools = new Set([
            'update_jira_ticket',
            'add_comment_with_images',
            'add_comment_with_media',
            'edit_jira_comment',
            'delete_jira_comment',
            'attach_file_to_jira',
        ]);

        const res = await runAgentStep({
            target: resolved.target,
            input,
            deps: { createSession },
            context: {
                runId: sessionId,
                depth: 0,
                maxDepth: cfg.maxDepth ?? 1,
                timeoutMs: cfg.subAgentTimeoutMs ?? 300000,
                chatManager: this,
                sessionId,
                ticketContext: delegationContext,
                onDelta: streamEnabled
                    ? (text) => {
                        if (!text || streamedChars >= maxStreamed) return;
                        streamedChars += text.length;
                        deltaBuf += text;
                        if (!flushTimer) {
                            flushTimer = setTimeout(() => { flushTimer = null; flushDelta(); }, cfg.deltaFlushMs ?? 120);
                        }
                    }
                    : undefined,
                onToolStart: (toolName) => {
                    delegatedTools.push(toolName);
                    this._broadcastToSSE(sessionId, CHAT_EVENTS.DELEGATION_TOOL_START, { delegationId, toolName });
                },
                onToolEnd: (toolName, success) => this._broadcastToSSE(sessionId, CHAT_EVENTS.DELEGATION_TOOL_COMPLETE, { delegationId, toolName, success }),
            },
        });

        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushDelta();

        this._broadcastToSSE(sessionId, CHAT_EVENTS.DELEGATION_COMPLETE, {
            delegationId,
            success: res.ok,
            agentLabel: resolved.label,
            output: res.ok ? res.output : '',
            error: res.ok ? null : (res.error || 'delegation failed'),
        });

        if (!res.ok) {
            return JSON.stringify({ success: false, agent: resolved.label, error: res.error || 'delegation failed' });
        }
        const writePerformed = delegatedTools.some(toolName => delegatedWriteTools.has(toolName));
        if (writePerformed) {
            this._delegatedWriteLocks.delete(sessionId);
        } else {
            this._delegatedWriteLocks.set(sessionId, {
                agentLabel: resolved.label,
                agentId: resolved.target.id,
                expiresAt: Date.now() + 5 * 60 * 1000,
            });
        }
        console.log(`[ChatManager] 🤝 Delegated to ${resolved.label} (${resolved.target.id}) → ${res.output ? res.output.length : 0} chars`);
        return JSON.stringify({
            success: true,
            agent: resolved.label,
            agentId: resolved.target.id,
            writePerformed,
            output: res.output,
            masterInstruction: writePerformed
                ? 'The specialist already performed the gated Jira write. Summarize the result only; do not perform another Jira write.'
                : 'The specialist did not perform a Jira write. Do NOT post or update Jira yourself as a fallback. If the specialist drafted or asked for approval/info, wait for that specialist/user flow or ask the user what they want next.',
        });
    }

    /** Per-turn intent-routing hint for the master (TPM). Async — lists the live roster. */
    async _buildMasterIntentHint(message) {
        try {
            const { rec, targets } = await this.recommendDelegationForMessage(message);
            if (!targets.length) return null;
            const roster = targets.slice(0, 12)
                .map(t => `- ${t.label} (${t.id})${t.description ? ` — ${t.description}` : ''}`)
                .join('\n');
            const lines = ['<intent_routing>', 'Specialists you can delegate to via delegate_to_specialist:', roster, ''];
            if (rec.decision === 'route' && rec.top) {
                const best = targets.find(t => t.id === rec.top.agent.id);
                lines.push(`Best match for THIS request: ${best ? best.label : rec.top.agent.id} (${rec.top.agent.id}). Strongly prefer delegating to it via delegate_to_specialist unless it clearly does not fit.`);
            } else if (rec.decision === 'ambiguous' && rec.shortlist?.length) {
                const names = rec.shortlist.slice(0, 3).map(s => s.label).join(', ');
                lines.push(`Possible matches: ${names}. If one clearly fits the user's intent, delegate to it; otherwise handle it yourself with human-in-the-loop confirmation for irreversible actions.`);
            } else {
                lines.push('No specialist clearly matches. Handle it yourself; for irreversible actions the platform shows a single approval automatically.');
            }
            lines.push('</intent_routing>');
            return lines.join('\n');
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ Master intent hint failed (non-blocking): ${err.message}`);
            return null;
        }
    }

    _resolveEntryAgent(entry) {
        if (entry?.agentSelection) {
            return toPublicAgentDescriptor(entry.agentSelection);
        }
        if (entry?.agent) {
            return entry.agent;
        }
        return toPublicAgentDescriptor(this._agentCatalog.getCoreAgentByMode(entry?.agentMode || null));
    }

    async _refreshEntryAgentSelection(entry) {
        if (!entry) return null;

        const candidateAgentId = entry.agentSelection?.id || entry.agentId || entry.agent?.id || null;
        if (!isNonEmptyString(candidateAgentId) || !candidateAgentId.startsWith('workspace:')) {
            return entry.agentSelection || null;
        }

        try {
            let currentSelection = await this._agentCatalog.resolveAgentSelection({
                agentId: candidateAgentId,
                agentMode: entry.agentMode || null,
            });

            if (currentSelection?.capabilityProfile) {
                currentSelection = applyCapabilityProfile(currentSelection);
            }

            entry.agentSelection = currentSelection;
            entry.agentId = currentSelection.id;
            entry.agentMode = currentSelection.agentMode || null;
            entry.agent = toPublicAgentDescriptor(currentSelection);
            return currentSelection;
        } catch (error) {
            console.warn(`[ChatManager] ⚠️ Could not refresh workspace agent ${candidateAgentId}; using persisted descriptor. ${error.message}`);
            return entry.agentSelection || null;
        }
    }

    /**
     * Build custom tools for chat sessions.
     * When agentMode is set, only loads tools for that specific role.
     * When null (default), loads all agent tools.
     *
     * @param {Object|string|null} agentSelection
     */
    _buildChatTools(agentSelection, sessionContext = null) {
        try {
            const { createCustomTools } = require('./custom-tools');
            const toolOpts = {
                learningStore: this.learningStore,
                config: this.config,
                groundingStore: this._groundingStore || null,
                chatManager: this,
                sessionContext,
                getSessionId: () => sessionContext?.sessionId || null,
            };

            const toolProfile = this._getAgentToolProfile(agentSelection);
            const filesystemAccess = this._getFilesystemAccess(agentSelection);
            const roleName = toolProfile === 'full' ? null : toolProfile;
            const isWorkspaceAgent = agentSelection?.source === 'workspace';

            let tools;
            if (roleName && (ChatSessionManager.VALID_AGENTS.includes(roleName) || roleName === 'codereviewer')) {
                tools = roleName === 'filegenie'
                    ? []
                    : [...createCustomTools(this.defineTool, roleName, toolOpts)];

                if (roleName === 'scriptgenerator') {
                    tools.push(...createCustomTools(this.defineTool, 'codereviewer', toolOpts));
                }
                console.log(`[ChatManager] Loaded tools for profile: ${roleName}`);
            } else if (isWorkspaceAgent) {
                // Workspace/custom agents: infer tool categories from prompt+description+label,
                // then load ONLY tools that match the inferred categories + always-on essentials.
                // The Tool Broker meta-tools (injected below) cover the long tail when the
                // agent needs something outside its inferred set.
                const inferredCategories = this._inferToolCategoriesForAgent(agentSelection);
                tools = this._buildCustomAgentTools(inferredCategories, toolOpts);
                console.log(`[ChatManager] 🧭 Workspace agent ${agentSelection?.label || agentSelection?.id || 'custom'} → inferred categories: [${inferredCategories.join(', ')}] (${tools.length} native tools)`);
            } else {
                // Default (core TPM, no agent selected): all agent tools merged
                tools = [
                    ...createCustomTools(this.defineTool, 'scriptgenerator', toolOpts),
                    ...createCustomTools(this.defineTool, 'codereviewer', toolOpts),
                    ...createCustomTools(this.defineTool, 'testgenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'buggenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'taskgenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'docgenie', toolOpts),
                ];
            }

            if (filesystemAccess !== 'none') {
                try {
                    const { createFilesystemTools } = require('./filesystem-tools');
                    tools.push(...createFilesystemTools(this.defineTool, toolOpts, { readOnly: filesystemAccess !== 'write' }));
                } catch (fsErr) {
                    console.warn(`[ChatManager] Filesystem tools not available for profile ${toolProfile}: ${fsErr.message}`);
                }
            }

            // ── Browser Tool Gateway (L2B) ────────────────────────────────
            // For workspace/custom agents that need occasional browser tasks
            // but don't want the 35–141-tool tax of attaching unified-automation
            // MCP directly. Opt-in via agentSelection.browserGateway === true
            // (set by Studio when the user picks a non-browser profile that
            // still benefits from one-shot navigation, e.g. Summarizer that
            // sometimes needs to look at a live page). Costs only 3 tool slots.
            if (isWorkspaceAgent && agentSelection?.browserGateway === true && !agentSelection?.capabilities?.browser) {
                try {
                    const { createBrowserGatewayTools } = require('./browser-gateway');
                    const gatewayTools = createBrowserGatewayTools(this.defineTool, {
                        profile: agentSelection.browserGatewayProfile || 'dryrun',
                    });
                    tools.push(...gatewayTools);
                    console.log(`[ChatManager] 🌐 Injected ${gatewayTools.length} browser-gateway tools (profile=${agentSelection.browserGatewayProfile || 'dryrun'})`);
                } catch (gwErr) {
                    console.warn(`[ChatManager] Browser gateway unavailable: ${gwErr.message}`);
                }
            }

            // Inject tool broker meta-tools for:
            //  • single-agent modes (e.g. buggenie, testgenie) — broker covers cross-domain needs
            //  • workspace/custom agents — broker is the dynamic escape hatch (e.g. Summarizer
            //    asked to summarise a pasted Jira URL → delegate to fetch_jira_ticket)
            // TPM (no agent selected, toolProfile='full', not workspace) already merges everything
            // and intentionally skips broker meta-tools.
            const brokerCaller = roleName || (isWorkspaceAgent ? 'workspace' : null);
            const brokerExplicitlyDisabled = agentSelection?.brokerEnabled === false;
            if (brokerCaller && this._toolBroker?.enabled && !brokerExplicitlyDisabled) {
                const nativeToolNames = tools.map(t => t.name || t.definition?.name || '').filter(Boolean);
                const metaTools = createBrokerMetaTools(this.defineTool, this._toolBroker, brokerCaller, nativeToolNames, toolOpts);
                tools.push(...metaTools);
                if (metaTools.length > 0) {
                    console.log(`[ChatManager] 🔀 Injected ${metaTools.length} broker meta-tools for ${brokerCaller}`);
                }
            }

            // ── Master orchestration: inject delegate_to_specialist for the TPM ──
            // Lets the master hand a focused sub-task to a core or custom specialist.
            // UNSHIFT so it survives CAPI tool-count truncation (which slices the tail).
            const isMasterProfile = !roleName && !isWorkspaceAgent;
            if (isMasterProfile && this.config?.orchestration?.delegation?.enabled !== false) {
                try {
                    // Warm the targets cache for subsequent turns (fire-and-forget).
                    this._getDelegationTargets().catch(() => {});
                    const customTargets = (this._delegationTargetsCache || [])
                        .filter(a => a && a.source === 'workspace')
                        .map(a => ({ id: a.id, label: a.label, description: a.description }));
                    const delegationTools = createDelegationTools(this.defineTool, {
                        chatManager: this,
                        getSessionId: () => sessionContext?.sessionId || null,
                        customTargets,
                    });
                    tools.unshift(...delegationTools);
                    console.log(`[ChatManager] 🤝 Injected delegate_to_specialist for master (TPM); ${customTargets.length} custom target(s) advertised`);
                } catch (delErr) {
                    console.warn(`[ChatManager] ⚠️ delegate tool injection failed: ${delErr.message}`);
                }
            }

            // Deduplicate by tool name
            const seen = new Set();
            const deduped = tools.filter(t => {
                const name = t.name || t.definition?.name || '';
                if (!name || seen.has(name)) return false;
                seen.add(name);
                return true;
            });

            // ── CAPI TOOL-COUNT GUARDRAIL ──────────────────────────────────────
            // CAPI rejects requests with > 128 tools ("Invalid 'tools': array too
            // long"). The MCP servers attached later add ~65 (core) – 141 (full)
            // additional tools the SDK auto-injects, so we must reserve headroom.
            // We cap the *custom* tools array here. Reserve 80 slots for MCP +
            // Atlassian (worst case ~76 MCP core + ~11 Atlassian read-only).
            // Effective custom-tool budget: 128 - 80 = 48. We leave a slightly
            // larger budget (60) for single-agent profiles where MCP is leaner
            // and bump to 90 for filegenie/no-browser agents.
            const CAPI_TOOL_LIMIT = 128;
            const reservedForMcp = (this._estimateAttachedMcpToolCount?.(agentSelection) ?? null);
            const reserved = (typeof reservedForMcp === 'number' && reservedForMcp >= 0)
                ? reservedForMcp
                : 80;
            const safeBudget = Math.max(20, CAPI_TOOL_LIMIT - reserved - 4 /* safety margin */);
            // Early-warning observability: log when we get close to the CAPI cap
            // even if still under the safe budget. Helps catch growth before the
            // next 128-tool incident.
            const EARLY_WARN_AT = 110;
            const projectedTotal = deduped.length + reserved;
            if (projectedTotal > EARLY_WARN_AT) {
                console.warn(`[ChatManager] \u26A0\uFE0F Projected tool total ${projectedTotal} (custom=${deduped.length} + mcp=${reserved}) approaching CAPI cap ${CAPI_TOOL_LIMIT}. profile=${toolProfile} workspace=${isWorkspaceAgent}`);
            } else {
                console.log(`[ChatManager] \uD83D\uDD0D Tool inventory: custom=${deduped.length}, mcpEst=${reserved}, projectedTotal=${projectedTotal} (cap=${CAPI_TOOL_LIMIT})`);
            }
            if (deduped.length > safeBudget) {
                console.warn(`[ChatManager] ⚠️ Tool count ${deduped.length} exceeds safe budget ${safeBudget} (CAPI cap=${CAPI_TOOL_LIMIT}, reservedMCP=${reserved}). Truncating custom tools for profile=${toolProfile}.`);
                return deduped.slice(0, safeBudget);
            }
            return deduped;
        } catch (error) {
            console.warn(`[ChatManager] Failed to load custom tools: ${error.message}`);
            return [];
        }
    }

    /**
     * Build a transient per-turn hint guiding a workspace/custom agent to use
     * the Tool Broker for cross-domain capabilities detected in the user message.
     * Returns null when no actionable signals are present.
     *
     * Pure regex; no LLM cost. Hint is prepended to the user message only, not
     * persisted to history or the system prompt.
     */
    _buildWorkspaceDelegationHint(userMessage) {
        if (!userMessage || typeof userMessage !== 'string') return null;
        const text = userMessage;
        const lower = text.toLowerCase();
        const triggered = new Set();

        // Detection patterns → broker category
        const SIGNALS = [
            { cat: 'jira', pat: /\b(?:jira|ticket|bug|defect|story|epic|fix\s*version|transition|assign\b|create\s*bug|raise\s*defect|log\s*work)\b/i },
            { cat: 'jira', pat: /https?:\/\/[^\s]*\.atlassian\.net\/browse\//i },
            { cat: 'grounding', pat: /https?:\/\/[^\s]*\.atlassian\.net\/wiki\//i },
            { cat: 'grounding', pat: /\b(?:knowledge\s*base|confluence|kb\s*page|search\s*the\s*kb)\b/i },
            { cat: 'framework', pat: /\b(?:run\s*test|execute\s*spec|playwright|sanity|smoke|run\s*sanity|spec\.js|test\s*case)\b/i },
            { cat: 'document', pat: /\b(?:generate|create|build|export)\s+(?:a\s+|an\s+|the\s+)?(?:ppt|pptx|deck|pdf|docx|word|excel|xlsx|report|chart|infographic)\b/i },
            { cat: 'evidence', pat: /\b(?:attach|upload|add)\s+(?:screenshot|evidence|recording|video|frame)/i },
        ];
        for (const { cat, pat } of SIGNALS) {
            if (pat.test(text) || pat.test(lower)) triggered.add(cat);
        }
        if (triggered.size === 0) return null;

        const cats = [...triggered];
        const examples = {
            jira: '`fetch_jira_ticket`, `create_jira_ticket`, `update_jira_ticket`',
            grounding: '`search_knowledge_base`, `get_confluence_page_details`',
            framework: '`find_test_files`, `execute_test`, `get_test_results`',
            document: '`generate_pptx`, `generate_pdf`, `generate_docx`, `generate_excel_report`',
            evidence: '`attach_session_evidence_to_jira`, `add_comment_with_images`',
        };
        const lines = cats.map(c => `- Category \`${c}\`: e.g. ${examples[c] || 'see list_delegatable_tools'}`);
        return [
            '<delegation_hint>',
            'This user request touches capabilities outside your declared native tool set. If you do not have the right tool natively, call `list_delegatable_tools` (filter by category below) then `cross_agent_delegate`:',
            ...lines,
            '</delegation_hint>',
        ].join('\n');
    }

    /**
     * Infer the most likely tool categories for a workspace/custom agent based on
     * its label, description, and bound prompt text (if loadable). Returns an
     * array of category names from tool-broker.js TOOL_CATEGORIES. Falls back to
     * `['pipeline', 'grounding']` (always-on essentials) when nothing matches.
     *
     * Cheap, deterministic, zero LLM calls.
     */
    _inferToolCategoriesForAgent(agentSelection) {
        const ALWAYS_ON = ['pipeline', 'grounding'];
        if (!agentSelection) return ALWAYS_ON;

        // Highest priority: explicit categories (e.g. from a Capability Profile or
        // Studio config). Skip inference entirely when present so the profile's
        // envelope is honoured exactly.
        if (Array.isArray(agentSelection.toolCategories) && agentSelection.toolCategories.length > 0) {
            const explicit = new Set(agentSelection.toolCategories);
            for (const c of ALWAYS_ON) explicit.add(c);
            return [...explicit];
        }

        // Gather text signal sources
        const signals = [];
        signals.push(agentSelection.label || '');
        signals.push(agentSelection.id || '');
        signals.push(agentSelection.description || '');
        if (agentSelection.promptPath) {
            try {
                const promptFile = path.join(PROJECT_ROOT, agentSelection.promptPath);
                if (fs.existsSync(promptFile)) {
                    // Read first 8KB only — enough to capture purpose statement
                    const buf = fs.readFileSync(promptFile, 'utf-8');
                    signals.push(buf.length > 8192 ? buf.slice(0, 8192) : buf);
                }
            } catch { /* non-critical */ }
        }
        const blob = signals.join(' ').toLowerCase();

        // Keyword → category mapping. Multiple categories may match.
        const KEYWORD_TO_CATEGORY = [
            { cats: ['jira'], pat: /\b(jira|ticket|bug|defect|epic|sprint|backlog|story|task|story\s*points|fix\s*version|assignee|transition|comment)\b/ },
            { cats: ['evidence'], pat: /\b(screenshot|evidence|attach|recording|video|frame|media|image)\b/ },
            { cats: ['document'], pat: /\b(ppt|pptx|powerpoint|deck|pdf|docx|word|excel|xlsx|report|chart|diagram|infographic|markdown|html\s*report)\b/ },
            { cats: ['framework'], pat: /\b(test|spec|playwright|sanity|smoke|automation|run\s*test|execute|failure|assertion|popup|exploration)\b/ },
            { cats: ['grounding'], pat: /\b(grounding|knowledge|kb|confluence|page\s*objects|selector|feature\s*map|context|search.*project|search.*kb)\b/ },
            { cats: ['testcase'], pat: /\b(test\s*case|test\s*scenario|excel\s*template|test\s*plan)\b/ },
            { cats: ['docparse'], pat: /\b(parse\s*document|document\s*parse|extract\s*from\s*pdf|read\s*excel|excel\s*ingest)\b/ },
        ];

        const matched = new Set();
        for (const { cats, pat } of KEYWORD_TO_CATEGORY) {
            if (pat.test(blob)) cats.forEach(c => matched.add(c));
        }
        for (const c of ALWAYS_ON) matched.add(c);
        return [...matched];
    }

    /**
     * Build the native tool array for a workspace/custom agent restricted to the
     * given category set. Pulls from each core agent's tool set, then filters by
     * the broker's TOOL_CATEGORIES → category map. Keeps always-on essentials.
     */
    _buildCustomAgentTools(categories, toolOpts) {
        try {
            const { createCustomTools } = require('./custom-tools');
            const { TOOL_CATEGORIES } = require('./tool-broker');
            const allowedNames = new Set();
            for (const cat of categories) {
                const names = TOOL_CATEGORIES[cat];
                if (Array.isArray(names)) names.forEach(n => allowedNames.add(n));
            }
            // Always-on essentials regardless of category match (small chat utilities)
            const ESSENTIALS = [
                'write_shared_context', 'read_shared_context', 'answer_question',
                'write_agent_note', 'get_agent_notes', 'publish_image_to_chat',
                'search_project_context', 'check_existing_coverage',
            ];
            ESSENTIALS.forEach(n => allowedNames.add(n));

            // Pull tools from every core agent, then filter
            const allAgentTools = [
                ...createCustomTools(this.defineTool, 'scriptgenerator', toolOpts),
                ...createCustomTools(this.defineTool, 'codereviewer', toolOpts),
                ...createCustomTools(this.defineTool, 'testgenie', toolOpts),
                ...createCustomTools(this.defineTool, 'buggenie', toolOpts),
                ...createCustomTools(this.defineTool, 'taskgenie', toolOpts),
                ...createCustomTools(this.defineTool, 'docgenie', toolOpts),
            ];
            const filtered = allAgentTools.filter(t => {
                const name = t.name || t.definition?.name || '';
                return name && allowedNames.has(name);
            });
            if (filtered.length === 0) {
                // Defensive fallback: at least give the agent essentials so it isn't crippled
                console.warn('[ChatManager] _buildCustomAgentTools produced 0 tools — returning unfiltered scriptgenerator set as fallback');
                return [...createCustomTools(this.defineTool, 'scriptgenerator', toolOpts)];
            }
            return filtered;
        } catch (err) {
            console.warn(`[ChatManager] _buildCustomAgentTools failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Estimate how many tools the SDK will auto-attach from MCP servers for the
     * given agent selection. Used by _buildChatTools to compute a safe local
     * custom-tool budget that keeps the *combined* tools array under CAPI's
     * hard 128-tool limit.
     *
     * Returns null when uncertain (caller falls back to a conservative reserve).
     */
    _estimateAttachedMcpToolCount(agentSelection) {
        try {
            const capabilities = this._getAgentCapabilities(agentSelection);
            const toolProfile = this._getAgentToolProfile(agentSelection);
            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';

            let total = 0;
            if (explorationEnabled && capabilities.browser === true) {
                if (process.env.GLASS_MCP_ENABLED !== 'false') {
                    total += 8; // Glass = 8-verb surface (open/see/do/read/wait/net/devtool/script)
                } else {
                    const AGENT_PROFILES = { scriptgenerator: 'intelligent', testgenie: 'intelligent', buggenie: 'intelligent', codereviewer: 'intelligent', taskgenie: 'intelligent' };
                    // Capability-profile / agentSelection override wins so the
                    // estimator matches what the MCP attach block will actually use.
                    const mcpToolProfile = agentSelection?.mcpToolProfile
                        || AGENT_PROFILES[toolProfile]
                        || 'intelligent'; // custom/full agents → lean primitives surface
                    // Approximate per-profile counts from mcp-server/config/tool-profiles.js.
                    const PROFILE_COUNTS = { intelligent: 13, core: 76, advanced: 110, full: 141, 'explorer-nav': 35, 'explorer-interact': 25, dryrun: 15, deferred: 25 };
                    total += PROFILE_COUNTS[mcpToolProfile] ?? 76;
                }
            }
            if (capabilities.jira === true && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
                total += 11; // ATLASSIAN_MCP_READONLY_TOOLS length
            }
            return total;
        } catch {
            return null;
        }
    }

    _buildRuntimeSafetyHooks(toolProfile) {
        const normalizedProfile = String(toolProfile || '').toLowerCase();
        const allowShellTools = String(process.env.CHAT_ALLOW_SHELL_TOOLS || '').toLowerCase() === 'true';

        if (allowShellTools) {
            return null;
        }

        // Enforce structural no-shell execution for ScriptGenie and default full chat.
        if (!['scriptgenerator', 'full'].includes(normalizedProfile)) {
            return null;
        }

        return {
            onPreToolUse: async (input) => {
                const toolName = String(input?.toolName || '');
                if (!isShellLikeToolName(toolName)) {
                    return { permissionDecision: 'allow' };
                }

                console.warn(`[ChatManager] ⛔ Blocked shell tool for profile ${normalizedProfile}: ${toolName}`);
                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        `⛔ PERMANENT DENIAL (do NOT retry "${toolName}" or any other shell/terminal tool).\n\n` +
                        `Shell tools (powershell, bash, cmd, terminal, run_in_terminal, execute_command) are ` +
                        `structurally blocked for the "${normalizedProfile}" profile. Retrying the same tool ` +
                        `will always fail with the same denial.\n\n` +
                        'REQUIRED NEXT STEP:\n' +
                        '  1. If you already have an absolute path to a .spec.js file or a folder of specs, ' +
                        'call `execute_test({ specPath: "<path>" })` — it supports external absolute paths and ' +
                        'will auto-detect the Playwright project root.\n' +
                        '  2. If you only have a keyword (e.g., "consumer", "planner"), call ' +
                        '`find_test_files({ query: "<keyword>" })` FIRST, then `execute_test` with the resolved path.\n\n' +
                        'Do not explain to the user that the terminal failed — instead, immediately call `execute_test`.',
                };
            },
        };
    }

    _createSessionError(code, message, status = 409, details = {}) {
        const error = new Error(message);
        error.code = code;
        error.status = status;
        Object.assign(error, details);
        return error;
    }

    _touchSession(entry) {
        entry.lastActivityAt = new Date().toISOString();
        entry.lastEventAt = entry.lastActivityAt;
    }

    _setExecutionState(entry, nextState, extra = {}) {
        if (!entry) return;
        entry.executionState = nextState;
        if (typeof extra.activeToolCount === 'number') {
            entry.activeToolCount = Math.max(0, extra.activeToolCount);
        }
        if (Object.prototype.hasOwnProperty.call(extra, 'lastError')) {
            entry.lastError = extra.lastError || null;
        }
        entry.lastEventAt = new Date().toISOString();
    }

    _updateRuntimeQueuePositions() {
        this._runtimeCreateQueue.forEach((task, index) => {
            const entry = this._sessions.get(task.sessionId);
            if (!entry || entry._destroyRequested) return;
            entry.runtimeState = SESSION_RUNTIME_STATES.QUEUED;
            entry.queuePosition = index + 1;
        });
    }

    _drainRuntimeCreateQueue() {
        while (this._runtimeCreateActiveCount < this._runtimeCreateConcurrency && this._runtimeCreateQueue.length > 0) {
            const task = this._runtimeCreateQueue.shift();
            this._updateRuntimeQueuePositions();
            if (!task) continue;
            if (!this._sessions.has(task.sessionId) || task.entry?._destroyRequested) {
                task.resolve(null);
                continue;
            }
            this._runRuntimeBootstrapTask(task);
        }
    }

    _runRuntimeBootstrapTask(task) {
        const { sessionId, entry, resolve } = task;
        if (!this._sessions.has(sessionId) || entry?._destroyRequested) {
            resolve(null);
            return;
        }

        this._runtimeCreateActiveCount++;
        entry.runtimeState = SESSION_RUNTIME_STATES.INITIALIZING;
        entry.queuePosition = 0;
        entry.lastError = null;
        entry.lastEventAt = new Date().toISOString();
        this._persistHistory();

        Promise.resolve()
            .then(async () => {
                const agentSelection = await this._refreshEntryAgentSelection(entry);
                const { session, sessionContext } = await this._createRuntimeSession({
                    appSessionId: sessionId,
                    model: entry.model,
                    agentMode: entry.agentMode,
                    agentSelection,
                    existingContext: entry.sessionContext,
                });

                if (!this._sessions.has(sessionId) || entry._destroyRequested) {
                    if (session && typeof session.destroy === 'function') {
                        try { await session.destroy(); } catch { /* ignore */ }
                    }
                    resolve(null);
                    return;
                }

                entry.session = session;
                entry.sessionContext = sessionContext;
                entry.runtimeSessionId = session.sessionId;
                entry.runtimeState = SESSION_RUNTIME_STATES.ACTIVE;
                entry.queuePosition = 0;
                entry.lastError = null;
                this._setExecutionState(entry, SESSION_EXECUTION_STATES.IDLE, { activeToolCount: 0, lastError: null });
                this._touchSession(entry);
                this._wireSessionEvents(sessionId, session);
                this._persistHistory();
                resolve(this._buildSessionSnapshot(sessionId, entry));
            })
            .catch((error) => {
                if (!this._sessions.has(sessionId) || entry?._destroyRequested) {
                    resolve(null);
                    return;
                }

                entry.session = null;
                entry.runtimeSessionId = null;
                entry.runtimeState = SESSION_RUNTIME_STATES.FAILED;
                entry.queuePosition = 0;
                this._setExecutionState(entry, SESSION_EXECUTION_STATES.ERROR, {
                    activeToolCount: 0,
                    lastError: error?.message || 'Failed to create runtime session',
                });
                this._persistHistory();
                resolve(this._buildSessionSnapshot(sessionId, entry));
            })
            .finally(() => {
                if (entry) {
                    entry.runtimeInitPromise = null;
                }
                this._runtimeCreateActiveCount = Math.max(0, this._runtimeCreateActiveCount - 1);
                this._drainRuntimeCreateQueue();
            });
    }

    _enqueueRuntimeBootstrap(sessionId, entry) {
        if (!entry) return Promise.resolve(null);
        if (entry.runtimeInitPromise) return entry.runtimeInitPromise;

        entry.lastError = null;
        entry.lastEventAt = new Date().toISOString();

        entry.runtimeInitPromise = new Promise((resolve) => {
            const task = { sessionId, entry, resolve };
            if (this._runtimeCreateActiveCount < this._runtimeCreateConcurrency) {
                this._runRuntimeBootstrapTask(task);
                return;
            }

            entry.runtimeState = SESSION_RUNTIME_STATES.QUEUED;
            this._runtimeCreateQueue.push(task);
            this._updateRuntimeQueuePositions();
            this._persistHistory();
        });

        return entry.runtimeInitPromise;
    }

    _cancelQueuedRuntimeBootstrap(sessionId) {
        if (this._runtimeCreateQueue.length === 0) return;
        const remaining = [];
        for (const task of this._runtimeCreateQueue) {
            if (task.sessionId === sessionId) {
                task.resolve(null);
                continue;
            }
            remaining.push(task);
        }
        this._runtimeCreateQueue = remaining;
        this._updateRuntimeQueuePositions();
    }

    async _awaitRuntimeBootstrap(sessionId, entry) {
        if (!entry) return null;

        if ((entry.runtimeState === SESSION_RUNTIME_STATES.INITIALIZING || entry.runtimeState === SESSION_RUNTIME_STATES.QUEUED) && entry.runtimeInitPromise) {
            await entry.runtimeInitPromise;
        } else if (entry.runtimeState === SESSION_RUNTIME_STATES.FAILED && !entry.archived) {
            await this._enqueueRuntimeBootstrap(sessionId, entry);
        }

        if (entry.session && this._getRuntimeState(entry) === SESSION_RUNTIME_STATES.ACTIVE) {
            return this._buildSessionSnapshot(sessionId, entry);
        }

        return null;
    }

    _deriveSessionTitleFromMessages(messages = []) {
        if (!Array.isArray(messages)) return null;

        for (const message of messages) {
            if (!message || message.role !== 'user') continue;
            const candidate = buildSessionTitleCandidate(message.content || '');
            if (!candidate) continue;
            if (isFallbackSessionTitle(candidate)) continue;
            return candidate;
        }

        for (const message of messages) {
            if (!message || message.role !== 'user') continue;
            const candidate = buildSessionTitleCandidate(message.content || '');
            if (candidate) return candidate;
        }

        return null;
    }

    _resolveSessionTitle(entry) {
        if (!entry) return null;

        const currentTitle = isNonEmptyString(entry.title) ? entry.title.trim() : '';
        if (currentTitle && !isFallbackSessionTitle(currentTitle)) {
            return truncateSessionTitle(normalizeSessionTitleText(currentTitle));
        }

        return this._deriveSessionTitleFromMessages(entry.messages) || (currentTitle || null);
    }

    _refreshSessionTitle(entry) {
        if (!entry) return false;

        const nextTitle = this._resolveSessionTitle(entry);
        const normalizedCurrent = isNonEmptyString(entry.title) ? entry.title.trim() : null;

        if ((normalizedCurrent || null) === (nextTitle || null)) {
            return false;
        }

        entry.title = nextTitle || null;
        return true;
    }

    _getRuntimeState(entry) {
        if (!entry) return SESSION_RUNTIME_STATES.ARCHIVED;
        if (entry.archived) return SESSION_RUNTIME_STATES.ARCHIVED;
        if (entry.runtimeState) return entry.runtimeState;
        return entry.session ? SESSION_RUNTIME_STATES.ACTIVE : SESSION_RUNTIME_STATES.RESUME_REQUIRED;
    }

    _buildSessionSnapshot(sessionId, entry) {
        const title = this._resolveSessionTitle(entry);
        const agent = this._resolveEntryAgent(entry);
        return {
            sessionId,
            title,
            model: entry.model,
            agentId: entry.agentId || agent?.id || buildCoreAgentId(entry.agentMode || null),
            agent,
            agentMode: entry.agentMode || null,
            createdAt: entry.createdAt,
            messageCount: entry.messages.length,
            sseClients: entry.sseClients?.length || 0,
            archived: entry.archived || false,
            archivedReason: entry.archivedReason || null,
            runtimeState: this._getRuntimeState(entry),
            executionState: entry.executionState || SESSION_EXECUTION_STATES.IDLE,
            activeToolCount: entry.activeToolCount || 0,
            queuePosition: entry.queuePosition || 0,
            lastError: entry.lastError || null,
            canResume: !entry.archived,
            lastActivityAt: entry.lastActivityAt || entry.createdAt,
            lastEventAt: entry.lastEventAt || entry.lastActivityAt || entry.createdAt,
            recoveredFromRuntimeFailure: !!entry.recoveredFromRuntimeFailure,
            recoveryCount: entry.recoveryCount || 0,
            hasLiveRuntime: !!entry.session,
        };
    }

    _buildRecoveryTranscript(entry, limit = RECOVERY_HISTORY_LIMIT) {
        // Filter to user/assistant messages only (tool calls are SSE-only, not persisted)
        const conversationMsgs = entry.messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant');

        if (conversationMsgs.length === 0) return '';

        // Exclude the very last message (it's the current user message being sent)
        const prior = conversationMsgs.slice(0, -1);
        if (prior.length === 0) return '';

        // Smart compression: keep first message (topic anchor) + last N messages (recent context)
        // Middle messages get a compact summary line to preserve char budget
        const RECENT_KEEP = Math.min(8, limit);
        let selected;
        if (prior.length <= limit) {
            selected = prior;
        } else {
            const first = prior[0];
            const recent = prior.slice(-RECENT_KEEP);
            const skipped = prior.length - 1 - RECENT_KEEP;
            selected = [
                first,
                { role: 'system', content: `[... ${skipped} earlier message${skipped !== 1 ? 's' : ''} omitted ...]` },
                ...recent,
            ];
        }

        const transcript = selected
            .map(msg => {
                if (msg.role === 'system') return msg.content;
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                const content = String(msg.content || '').trim();
                if (!content) return null;
                // Truncate individual long assistant messages to keep budget balanced
                const maxPerMsg = Math.floor(MAX_RECOVERY_TRANSCRIPT_CHARS / Math.max(selected.length, 1));
                const trimmed = content.length > maxPerMsg
                    ? content.slice(0, maxPerMsg) + ' [...]'
                    : content;
                return `${role}: ${trimmed}`;
            })
            .filter(Boolean)
            .join('\n');

        if (!transcript) return '';
        return transcript.length > MAX_RECOVERY_TRANSCRIPT_CHARS
            ? transcript.slice(-MAX_RECOVERY_TRANSCRIPT_CHARS)
            : transcript;
    }

    _buildRecoveredPrompt(entry, promptContent) {
        const transcript = this._buildRecoveryTranscript(entry);
        if (!transcript) return promptContent;

        return [
            '[Session recovery notice]',
            'The previous live runtime session became unavailable. Continue using the reconstructed recent conversation context below.',
            '<recent_conversation>',
            transcript,
            '</recent_conversation>',
            '<latest_user_message>',
            promptContent,
            '</latest_user_message>',
        ].join('\n\n');
    }

    _markRecoveryContextDelivered(entry) {
        if (!entry) return;
        entry.needsRecoveryContextInjection = false;
        entry.recoveryContextRuntimeId = null;
    }

    _getAutoUserInputResolution(inputType = 'default', reason = 'auto') {
        const normalizedType = String(inputType || 'default').toLowerCase();
        if (normalizedType === 'credentials' || normalizedType === 'password') {
            return { answer: 'skip', wasFreeform: true, auto: true, reason };
        }
        if (normalizedType === 'confirmation') {
            return { answer: 'Cancel', wasFreeform: false, auto: true, reason };
        }
        return {
            answer: 'Continue with the best approach based on available context.',
            wasFreeform: true,
            auto: true,
            reason,
        };
    }

    _isRecoverableRuntimeError(error) {
        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('session not found')
            || message.includes('request session.send failed')
            || message.includes('session.send failed')
            || message.includes('session send failed')
            || message.includes('runtime session')
            || message.includes('no live runtime session')
        );
    }

    _isModelBadRequestError(error) {
        const message = String(error?.message || '').toLowerCase();
        if (!message) return false;

        const hasBadRequestSignal = message.includes('bad request') || /\b400\b/.test(message);
        const hasModelSignal = message.includes('capierror')
            || message.includes('model')
            || message.includes('invalid_request_error');

        return hasBadRequestSignal && hasModelSignal;
    }

    async _createRuntimeSession({ appSessionId, model, agentMode, agentSelection = null, existingContext = null }) {
        const sessionContext = {
            latestUserMessageId: null,
            latestUserMessageTimestamp: null,
            activeEvidenceMessageId: null,
            activeEvidenceTimestamp: null,
            ...(existingContext && typeof existingContext === 'object' ? existingContext : {}),
            sessionId: appSessionId,
        };
        let resolvedSelection = agentSelection || this._agentCatalog.getCoreAgentByMode(agentMode || null);
        // Apply capability profile (Studio-time template) BEFORE tool/MCP/prompt building.
        // Non-destructive: agentSelection's explicit fields always win over profile defaults.
        if (resolvedSelection?.capabilityProfile) {
            const before = { hasCaps: !!resolvedSelection.capabilities, hasCats: Array.isArray(resolvedSelection.toolCategories) };
            resolvedSelection = applyCapabilityProfile(resolvedSelection);
            console.log(`[ChatManager] \uD83C\uDFAF Capability profile '${resolvedSelection._capabilityProfileResolved}' applied (overrides: caps=${!before.hasCaps}, cats=${!before.hasCats})`);
        }
        const tools = this._buildChatTools(resolvedSelection, sessionContext);
        const systemPrompt = this._buildSystemPromptForSelection(resolvedSelection);
        const toolProfile = this._getAgentToolProfile(resolvedSelection);
        const capabilities = this._getAgentCapabilities(resolvedSelection);
        const runtimeHooks = this._buildRuntimeSafetyHooks(toolProfile);

        console.log(`[ChatManager] Creating runtime session — appSessionId: ${appSessionId}, model: ${model}, agent: ${resolvedSelection?.id || agentMode || 'core:tpm'}, tools: ${tools.length}`);

        let session;
        const sessionConfig = {
            model,
            tools,
            systemMessage: { content: systemPrompt },
            streaming: true,
            onPermissionRequest: async () => approveAllPermissions(),
            onUserInputRequest: async (request) => {
                const normalizedRequest = normalizeUserInputRequestPayload(request);
                const { question, options, type: inputType, meta: requestMeta, usedFallbackQuestion, nestedPayloadDetected } = normalizedRequest;
                const safeMeta = this._sanitizeUserInputRequestMeta(requestMeta);
                if (usedFallbackQuestion || nestedPayloadDetected) {
                    console.warn('[ChatManager] onUserInputRequest received a malformed payload; normalized before broadcasting');
                }

                const sessionEntry = this._findEntryBySession(session);
                if (!sessionEntry) {
                    console.warn('[ChatManager] onUserInputRequest: could not locate session — resolving fail-closed');
                    return this._getAutoUserInputResolution(inputType, 'missing_session');
                }
                const { sid, entry } = sessionEntry;

                const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                console.log(`[ChatManager] 💬 User input requested (${requestId}): ${question.slice(0, 120)}`);

                return new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        if (entry.pendingInputRequests.has(requestId)) {
                            console.log(`[ChatManager] ⏱️ User input timed out (${requestId}) — auto-resolving`);
                            entry.pendingInputRequests.delete(requestId);
                            const timeoutResolution = this._getAutoUserInputResolution(inputType, 'timeout');
                            this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                                requestId,
                                answer: timeoutResolution.answer,
                                auto: true,
                                reason: timeoutResolution.reason,
                            });
                            resolve(timeoutResolution);
                        }
                    }, USER_INPUT_TIMEOUT_MS);

                    entry.pendingInputRequests.set(requestId, { resolve, question, options, timer, meta: safeMeta, type: inputType });

                    entry.messages.push({
                        role: 'user_input_request',
                        content: question,
                        requestId,
                        options,
                        type: inputType,
                        meta: safeMeta,
                        timestamp: new Date().toISOString(),
                    });

                    this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                        requestId,
                        question,
                        options,
                        type: inputType,
                        meta: safeMeta,
                    });

                    this._persistHistory();
                });
            },
        };

        if (runtimeHooks) {
            sessionConfig.hooks = runtimeHooks;
            console.log(`[ChatManager] Runtime safety hooks enabled for profile: ${toolProfile}`);
        }

        try {
            try {
                const envPath = path.join(__dirname, '..', '.env');
                if (fs.existsSync(envPath)) {
                    require('dotenv').config({ path: envPath, override: true });
                }
            } catch { /* non-critical */ }

            const mcpServers = {};
            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
            const needsBrowser = explorationEnabled && capabilities.browser === true;
            const needsJira = capabilities.jira === true;

            if (toolProfile === 'filegenie') {
                console.log('[ChatManager] FileGenie mode — skipping MCP servers (filesystem tools only)');
            }

            if (needsBrowser) {
                // Glass is the DEFAULT browser MCP (8-verb surface). Set GLASS_MCP_ENABLED=false
                // to fall back to the legacy unified-automation server.
                const glassEnabled = process.env.GLASS_MCP_ENABLED !== 'false';
                const glassServerPath = path.join(__dirname, '..', '..', 'glass-mcp', 'src', 'server.js');
                if (glassEnabled && fs.existsSync(glassServerPath)) {
                    // Glass — lean standalone 8-verb browser MCP (migration target):
                    // open/see/do/read/wait/net/devtool/script. Skips unified-automation
                    // for this session to avoid double-loading the browser surface.
                    mcpServers['glass'] = {
                        type: 'local',
                        command: 'node',
                        args: [glassServerPath],
                        tools: ['*'],
                        env: { GLASS_HEADLESS: process.env.MCP_HEADLESS || 'true' },
                    };
                    console.log('[ChatManager] 🪟 Glass MCP enabled (8-verb surface) — unified-automation skipped for this session');
                }
                const mcpServerPath = path.join(__dirname, '..', 'mcp-server', 'server.js');
                if (!mcpServers['glass'] && fs.existsSync(mcpServerPath)) {
                    const AGENT_PROFILES = { scriptgenerator: 'intelligent', testgenie: 'intelligent', buggenie: 'intelligent', codereviewer: 'intelligent', taskgenie: 'intelligent' };
                    // Default to the lean primitives-first 'intelligent' surface
                    // (~13 listed tools: act / observe / extract / crawl +
                    // navigate / snapshot / screenshot / wait / get_page_url /
                    // browser_close + tool_search + execute_exploration). Every
                    // other low-level tool stays callable and is discoverable via
                    // unified_tool_search, so this gives maximum CAPI 128-tool
                    // headroom for merged custom tools while keeping full power.
                    // Capability-profile override (e.g. browser-sanity → explorer-nav)
                    // takes top priority when set on agentSelection.
                    const mcpToolProfile = agentSelection?.mcpToolProfile
                        || AGENT_PROFILES[toolProfile]
                        || 'intelligent';
                    mcpServers['unified-automation'] = {
                        type: 'local',
                        command: 'node',
                        args: [mcpServerPath],
                        tools: ['*'],
                        env: {
                            MCP_HEADLESS: process.env.MCP_HEADLESS || 'true',
                            MCP_TIMEOUT: process.env.MCP_TIMEOUT || '60000',
                            MCP_BROWSER: process.env.MCP_BROWSER || 'chromium',
                            MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT || '120000',
                            MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'info',
                            MCP_TOOL_PROFILE: mcpToolProfile,
                        },
                    };
                }
            }

            if (needsJira) {
                const jiraEmail = process.env.JIRA_EMAIL || '';
                const jiraApiToken = process.env.JIRA_API_TOKEN || '';
                if (jiraEmail && jiraApiToken) {
                    const basicAuth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
                    mcpServers['atlassian/atlassian-mcp-server'] = {
                        type: 'http',
                        url: 'https://mcp.atlassian.com/v1/sse',
                        headers: { authorization: `Basic ${basicAuth}` },
                        // ⚠️ APPROVAL GUARDRAIL: Read-only Atlassian MCP tools only.
                        // All Jira/Confluence writes (create/edit/delete issues, comments,
                        // transitions, page writes) MUST route through gated SDK custom
                        // tools that call requireJiraMutationApproval(). Exposing the
                        // Atlassian MCP write tools (e.g. addCommentToJiraIssue,
                        // editJiraIssue, transitionJiraIssue) would bypass the global
                        // approval prompt and is intentionally blocked here.
                        tools: ATLASSIAN_MCP_READONLY_TOOLS,
                    };
                    console.log(`[ChatManager] 🔗 Atlassian MCP enabled for ${resolvedSelection?.id || agentMode || 'default'} (read-only allowlist; writes route through gated SDK tools)`);
                } else {
                    console.warn(`[ChatManager] ⚠️ Atlassian MCP NOT configured for ${resolvedSelection?.id || agentMode || 'default'} — JIRA_EMAIL or JIRA_API_TOKEN missing. Agent will rely on fetch_jira_ticket / create_jira_ticket custom tools (REST API fallback).`);
                }
            }

            if (Object.keys(mcpServers).length > 0) {
                sessionConfig.mcpServers = mcpServers;
                console.log(`[ChatManager] MCP servers: ${Object.keys(mcpServers).join(', ')}`);
            }
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ MCP server configuration failed: ${err.message}. Session will proceed without MCP — custom tools (fetch_jira_ticket, create_jira_ticket) remain available.`);
        }

        try {
            session = await this.client.createSession(sessionConfig);
        } catch (err) {
            const msg = err?.message || '';
            if (msg.includes('abort') || msg.includes('signal')) {
                console.warn(`[ChatManager] Session creation aborted, retrying in 2s... (${msg})`);
                await new Promise(r => setTimeout(r, 2000));
                session = await this.client.createSession(sessionConfig);
            } else {
                throw err;
            }
        }

        sessionContext.runtimeSessionId = session.sessionId;
        return { session, sessionContext };
    }

    async _recoverRuntimeSession(sessionId, entry, options = {}) {
        if (entry.archived) {
            throw this._createSessionError(
                'CHAT_SESSION_ARCHIVED',
                `Session ${sessionId} is archived (read-only). Create a new session to chat.`,
                409,
                { runtimeState: SESSION_RUNTIME_STATES.ARCHIVED, recoverable: false }
            );
        }

        if (entry.recoveryPromise) {
            return entry.recoveryPromise;
        }

        entry.recoveryPromise = (async () => {
            entry.runtimeState = SESSION_RUNTIME_STATES.RECOVERING;
            entry.runtimeLostReason = options.reason || entry.runtimeLostReason || 'runtime_unavailable';
            if (entry.activeToolCallIds) {
                entry.activeToolCallIds.clear();
            }
            this._setExecutionState(entry, SESSION_EXECUTION_STATES.IDLE, {
                activeToolCount: 0,
                lastError: options.lastError || entry.lastError || null,
            });
            this._persistHistory();

            for (const unsub of entry.unsubscribers || []) {
                try { unsub(); } catch { /* ignore */ }
            }
            entry.unsubscribers = [];

            if (entry.session && typeof entry.session.destroy === 'function') {
                try {
                    await entry.session.destroy();
                } catch { /* ignore */ }
            }

            entry.session = null;
            entry.runtimeSessionId = null;

            const agentSelection = await this._refreshEntryAgentSelection(entry);
            const { session, sessionContext } = await this._createRuntimeSession({
                appSessionId: sessionId,
                model: entry.model,
                agentMode: entry.agentMode,
                agentSelection,
                existingContext: entry.sessionContext,
            });

            entry.session = session;
            entry.sessionContext = sessionContext;
            entry.runtimeSessionId = session.sessionId;
            entry.runtimeState = SESSION_RUNTIME_STATES.ACTIVE;
            entry.recoveredFromRuntimeFailure = true;
            entry.recoveryCount = (entry.recoveryCount || 0) + 1;
            entry.needsRecoveryContextInjection = true;
            entry.recoveryContextRuntimeId = session.sessionId;
            entry.lastRecoveredAt = new Date().toISOString();
            this._setExecutionState(entry, SESSION_EXECUTION_STATES.IDLE, {
                activeToolCount: 0,
                lastError: null,
            });
            this._touchSession(entry);
            this._wireSessionEvents(sessionId, session);
            this._persistHistory();

            return this._buildSessionSnapshot(sessionId, entry);
        })();

        try {
            return await entry.recoveryPromise;
        } finally {
            entry.recoveryPromise = null;
        }
    }

    async _sendRuntimeMessage(sessionId, entry, messageOptions, allowRecovery = true) {
        const sendCurrentRuntime = async (finalOptions) => {
            if (!entry.session) {
                throw this._createSessionError(
                    'CHAT_SESSION_RUNTIME_MISSING',
                    `Live runtime session unavailable for ${sessionId}.`,
                    409,
                    { runtimeState: this._getRuntimeState(entry), recoverable: !entry.archived }
                );
            }

            const sendFn = typeof entry.session.send === 'function'
                ? entry.session.send.bind(entry.session)
                : (typeof entry.session.sendMessage === 'function'
                    ? entry.session.sendMessage.bind(entry.session)
                    : null);

            if (!sendFn) {
                throw this._createSessionError(
                    'CHAT_SESSION_RUNTIME_INVALID',
                    `Live runtime session unavailable for ${sessionId}.`,
                    409,
                    { runtimeState: this._getRuntimeState(entry), recoverable: !entry.archived }
                );
            }

            return sendFn(finalOptions);
        };

        try {
            return await sendCurrentRuntime(messageOptions);
        } catch (error) {
            if (allowRecovery && !entry.archived && this._isRecoverableRuntimeError(error)) {
                await this._recoverRuntimeSession(sessionId, entry, {
                    reason: 'runtime_send_failed',
                    lastError: error.message,
                });
                // Skip double-injection if sendMessage() already prepended recovery context
                const recoveredOptions = messageOptions._hasRecoveryContext
                    ? messageOptions
                    : { ...messageOptions, prompt: this._buildRecoveredPrompt(entry, messageOptions.prompt), _hasRecoveryContext: true };
                const result = await sendCurrentRuntime(recoveredOptions);
                if (recoveredOptions._hasRecoveryContext) this._markRecoveryContextDelivered(entry);
                return result;
            }

            if (allowRecovery && !entry.archived && this._isModelBadRequestError(error)) {
                const fallbackModel = (this.model && String(this.model).trim()) ? String(this.model).trim() : 'gpt-4o';
                if (fallbackModel && fallbackModel !== entry.model) {
                    const previousModel = entry.model;
                    entry.model = fallbackModel;

                    try {
                        await this._recoverRuntimeSession(sessionId, entry, {
                            reason: 'model_fallback_after_bad_request',
                            lastError: error.message,
                        });
                        // Skip double-injection if sendMessage() already prepended recovery context
                        const recoveredOptions = messageOptions._hasRecoveryContext
                            ? messageOptions
                            : { ...messageOptions, prompt: this._buildRecoveredPrompt(entry, messageOptions.prompt), _hasRecoveryContext: true };
                        const result = await sendCurrentRuntime(recoveredOptions);
                        if (recoveredOptions._hasRecoveryContext) this._markRecoveryContextDelivered(entry);
                        return result;
                    } catch (fallbackError) {
                        entry.model = previousModel;
                        throw fallbackError;
                    }
                }
            }

            if (error.code) throw error;

            throw this._createSessionError(
                'CHAT_SESSION_SEND_FAILED',
                error?.message || `Failed to send message for session ${sessionId}`,
                this._isRecoverableRuntimeError(error) ? 409 : 500,
                {
                    runtimeState: this._getRuntimeState(entry),
                    recoverable: this._isRecoverableRuntimeError(error) && !entry.archived,
                }
            );
        }
    }

    getSessionStatus(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            throw this._createSessionError('CHAT_SESSION_NOT_FOUND', `Session ${sessionId} not found`, 404, { recoverable: false });
        }
        return this._buildSessionSnapshot(sessionId, entry);
    }

    async resumeSession(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            throw this._createSessionError('CHAT_SESSION_NOT_FOUND', `Session ${sessionId} not found`, 404, { recoverable: false });
        }
        if (entry.archived) {
            throw this._createSessionError(
                'CHAT_SESSION_ARCHIVED',
                `Session ${sessionId} is archived (read-only). Create a new session to chat.`,
                409,
                { runtimeState: SESSION_RUNTIME_STATES.ARCHIVED, recoverable: false }
            );
        }
        if (entry.session && this._getRuntimeState(entry) === SESSION_RUNTIME_STATES.ACTIVE) {
            return this._buildSessionSnapshot(sessionId, entry);
        }

        const bootstrapped = await this._awaitRuntimeBootstrap(sessionId, entry);
        if (bootstrapped) {
            return bootstrapped;
        }

        return this._recoverRuntimeSession(sessionId, entry, { reason: 'manual_resume' });
    }

    /**
     * Create a new chat session.
     *
     * @param {Object} [options]
     * @param {string} [options.model]     - Model override
     * @param {string|null} [options.agentId]   - Catalog-driven agent id (core or workspace)
     * @param {string|null} [options.agentMode] - Legacy core agent mode for backwards compatibility
     * @returns {Promise<{ sessionId, model, createdAt, agentMode, agentId, agent }>}
     */
    async createSession(options = {}) {
        const model = options.model || this.model;
        const requestedAgentMode = options.agentMode || null;
        const requestedAgentId = options.agentId || null;

        if (requestedAgentMode && !ChatSessionManager.VALID_AGENTS.includes(requestedAgentMode)) {
            throw new Error(`Invalid agentMode: ${requestedAgentMode}. Valid: ${ChatSessionManager.VALID_AGENTS.join(', ')}`);
        }

        const agentSelection = await this._agentCatalog.resolveAgentSelection({
            agentId: requestedAgentId,
            agentMode: requestedAgentMode,
        });
        const agentMode = agentSelection.agentMode || null;
        const sessionId = randomUUID();
        const createdAt = new Date().toISOString();
        const initialRuntimeState = this._runtimeCreateActiveCount < this._runtimeCreateConcurrency
            ? SESSION_RUNTIME_STATES.INITIALIZING
            : SESSION_RUNTIME_STATES.QUEUED;
        const sessionContext = {
            sessionId,
            runtimeSessionId: null,
            latestUserMessageId: null,
            latestUserMessageTimestamp: null,
            activeEvidenceMessageId: null,
            activeEvidenceTimestamp: null,
        };

        // Store session metadata
        const entry = {
            session: null,
            runtimeSessionId: null,
            model,
            agentId: agentSelection.id,
            agent: toPublicAgentDescriptor(agentSelection),
            agentSelection,
            agentMode,
            createdAt,
            lastActivityAt: createdAt,
            lastEventAt: createdAt,
            sseClients: [],
            messages: [],
            unsubscribers: [],
            archived: false,
            sessionContext,
            runtimeState: initialRuntimeState,
            executionState: SESSION_EXECUTION_STATES.IDLE,
            activeToolCount: 0,
            queuePosition: initialRuntimeState === SESSION_RUNTIME_STATES.QUEUED
                ? this._runtimeCreateQueue.length + 1
                : 0,
            lastError: null,
            recoveryCount: 0,
            recoveredFromRuntimeFailure: false,
            needsRecoveryContextInjection: false,
            recoveryContextRuntimeId: null,
            pendingInputRequests: new Map(),  // requestId → { resolve, question, options, timer }
            sessionAttachments: [],
            videoContext: [],
            pendingAssistantAttachments: [],
            runtimeInitPromise: null,
            _destroyRequested: false,
            _documentTempFiles: [],
            _videoTempFiles: [],
            activeToolCallIds: new Set(),
        };

        this._sessions.set(sessionId, entry);

        // Persist to disk
        this._persistHistory();

        // Start runtime creation in the background so the UI gets a session immediately.
        void this._enqueueRuntimeBootstrap(sessionId, entry);

        // Generate welcome followups for the new session
        const welcomeFollowups = this._followupProvider.getWelcomeFollowups(agentSelection.followupMode || agentMode || 'default');

        return { ...this._buildSessionSnapshot(sessionId, entry), followups: welcomeFollowups };
    }

    /**
     * Subscribe to session events and broadcast to SSE clients.
     */
    _wireSessionEvents(sessionId, session) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return;

        const unsubscribers = [];

        // Reasoning accumulator — collects thinking deltas and attaches to the next assistant message
        let reasoningBuffer = '';
        let currentReasoningId = '';

        // Assistant message deltas (streaming text)
        if (typeof session.on === 'function') {
            const u1 = session.on('assistant.message_delta', (event) => {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.DELTA, {
                    deltaContent: event?.data?.deltaContent || '',
                    messageId: event?.data?.messageId || '',
                });
            });
            if (u1) unsubscribers.push(u1);

            // Complete assistant message
            const u2 = session.on('assistant.message', (event) => {
                const rawContent = event?.data?.content || '';
                const pendingAttachments = this._consumePendingAssistantAttachments(entry);
                const eventAttachments = Array.isArray(event?.data?.attachments) ? event.data.attachments : [];
                const contentAttachments = (eventAttachments.length === 0 && pendingAttachments.length === 0)
                    ? this._extractAssistantContentArtifactAttachments(rawContent)
                    : [];
                const mergedAttachments = [...eventAttachments, ...pendingAttachments, ...contentAttachments];
                const content = this._sanitizeAssistantArtifactContent(rawContent, mergedAttachments);
                const msg = { role: 'assistant', content, timestamp: new Date().toISOString() };
                if (mergedAttachments.length > 0) {
                    msg.attachments = mergedAttachments;
                }

                // Attach accumulated reasoning to the message (if any)
                if (reasoningBuffer.trim()) {
                    msg.reasoning = reasoningBuffer.trim();
                    msg.reasoningId = currentReasoningId;
                }
                // Reset buffer for next message
                reasoningBuffer = '';
                currentReasoningId = '';

                entry.messages.push(msg);
                this._touchSession(entry);
                this._broadcastToSSE(sessionId, CHAT_EVENTS.MESSAGE, {
                    content,
                    messageId: event?.data?.messageId || '',
                    reasoning: msg.reasoning || null,
                    attachments: msg.attachments || [],
                });
                // Persist after assistant message
                this._persistHistory();

                // Generate and broadcast followup suggestions based on message content
                try {
                    const followups = this._followupProvider.getChatFollowups({
                        sessionId,
                        agentMode: entry.agentSelection?.followupMode || entry.agentMode,
                        lastMessage: content,
                        messages: entry.messages,
                        maxFollowups: 3,
                    });
                    if (followups.length > 0) {
                        this._broadcastToSSE(sessionId, CHAT_EVENTS.FOLLOWUP, { followups });
                    }
                } catch { /* followups are non-critical */ }
            });
            if (u2) unsubscribers.push(u2);

            // Tool execution start — with automatic progress hints for MCP tools
            const u3 = session.on('tool.execution_start', (event) => {
                const toolName = event?.data?.toolName || 'unknown';
                const toolCallId = event?.data?.toolCallId || '';

                if (entry.activeToolCallIds) {
                    entry.activeToolCallIds.add(toolCallId || `${toolName}_${Date.now()}`);
                }
                this._setExecutionState(entry, SESSION_EXECUTION_STATES.RUNNING, {
                    activeToolCount: entry.activeToolCallIds?.size || 1,
                    lastError: null,
                });

                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_START, {
                    toolName,
                    toolCallId,
                });

                // Auto-emit a progress hint for MCP/known tools so the UI shows
                // contextual info immediately (e.g., "Navigating to page...")
                const hint = ChatSessionManager._getToolProgressHint(toolName);
                if (hint) {
                    this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_PROGRESS, {
                        toolName,
                        phase: hint.phase,
                        message: hint.message,
                    });
                }
            });
            if (u3) unsubscribers.push(u3);

            // Tool execution complete
            const u4 = session.on('tool.execution_complete', (event) => {
                this._handleToolExecutionFinished(sessionId, entry, event, 'tool.execution_complete');
            });
            if (u4) unsubscribers.push(u4);

            const u4b = session.on('tool.execution_end', (event) => {
                this._handleToolExecutionFinished(sessionId, entry, event, 'tool.execution_end');
            });
            if (u4b) unsubscribers.push(u4b);

            // Reasoning (thinking) — accumulate into buffer for persistence
            const u5 = session.on('assistant.reasoning_delta', (event) => {
                const delta = event?.data?.deltaContent || '';
                const rid = event?.data?.reasoningId || '';
                if (delta) {
                    reasoningBuffer += delta;
                    currentReasoningId = rid || currentReasoningId;
                }
                this._broadcastToSSE(sessionId, CHAT_EVENTS.REASONING, {
                    deltaContent: delta,
                    reasoningId: rid,
                });
            });
            if (u5) unsubscribers.push(u5);

            // Session idle (processing complete)
            const u6 = session.on('session.idle', () => {
                if (entry.activeToolCallIds) {
                    entry.activeToolCallIds.clear();
                }
                this._setExecutionState(entry, SESSION_EXECUTION_STATES.IDLE, {
                    activeToolCount: 0,
                    lastError: null,
                });
                const pendingAttachments = this._consumePendingAssistantAttachments(entry);
                if (pendingAttachments.length > 0) {
                    const artifactMessage = {
                        role: 'assistant',
                        content: '',
                        timestamp: new Date().toISOString(),
                        attachments: pendingAttachments,
                    };
                    entry.messages.push(artifactMessage);
                    this._broadcastToSSE(sessionId, CHAT_EVENTS.MESSAGE, {
                        content: artifactMessage.content,
                        messageId: pendingAttachments[0]?.id || '',
                        reasoning: null,
                        attachments: pendingAttachments,
                    });
                    this._persistHistory();
                }

                this._broadcastToSSE(sessionId, CHAT_EVENTS.IDLE, {});

                // Broadcast final followup suggestions on idle (ensures they arrive after message)
                try {
                    const lastMsg = entry.messages.filter(m => m.role === 'assistant').pop();
                    const followups = this._followupProvider.getChatFollowups({
                        sessionId,
                        agentMode: entry.agentSelection?.followupMode || entry.agentMode,
                        lastMessage: lastMsg?.content || '',
                        messages: entry.messages,
                        maxFollowups: 3,
                    });
                    if (followups.length > 0) {
                        this._broadcastToSSE(sessionId, CHAT_EVENTS.FOLLOWUP, { followups });
                    }
                } catch { /* followups are non-critical */ }
            });
            if (u6) unsubscribers.push(u6);

            // Errors
            const u7 = session.on('session.error', (event) => {
                const errorMessage = event?.data?.message || 'Unknown error';
                if (entry.activeToolCallIds) {
                    entry.activeToolCallIds.clear();
                }
                if (this._isRecoverableRuntimeError({ message: errorMessage })) {
                    entry.session = null;
                    entry.runtimeSessionId = null;
                    entry.runtimeState = SESSION_RUNTIME_STATES.RESUME_REQUIRED;
                    entry.runtimeLostReason = errorMessage;
                }
                this._setExecutionState(entry, SESSION_EXECUTION_STATES.ERROR, {
                    activeToolCount: 0,
                    lastError: errorMessage,
                });
                this._persistHistory();
                this._broadcastToSSE(sessionId, CHAT_EVENTS.ERROR, {
                    error: errorMessage,
                });
            });
            if (u7) unsubscribers.push(u7);
        }

        entry.unsubscribers = unsubscribers;
    }

    /**
     * Broadcast an event to all SSE clients subscribed to a session.
     */
    _broadcastToSSE(sessionId, type, data) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return;

        // Coalesce high-frequency per-token DELTA/REASONING events into ~50ms
        // batches (see SSE_DELTA_COALESCE_MS). Forwarding each token as its own SSE
        // frame floods the browser EventSource parser and starves the renderer
        // (Chrome STATUS_BREAKPOINT). Accumulation is transparent to the client,
        // which simply concatenates deltaContent.
        if (type === CHAT_EVENTS.DELTA || type === CHAT_EVENTS.REASONING) {
            this._enqueueCoalescedDelta(entry, sessionId, type, data);
            return;
        }

        // Any non-delta event must flush pending deltas first so ordering is
        // preserved (e.g. the final MESSAGE arrives after all its DELTAs).
        this._flushCoalescedDeltas(sessionId);
        this._rawBroadcastToSSE(sessionId, type, data);
    }

    /**
     * Accumulate a per-token DELTA/REASONING event for coalesced delivery.
     * @private
     */
    _enqueueCoalescedDelta(entry, sessionId, type, data) {
        if (!entry._sseCoalesce) {
            entry._sseCoalesce = {
                timer: null,
                delta: { content: '', messageId: '' },
                reasoning: { content: '', reasoningId: '' },
            };
        }
        const buf = entry._sseCoalesce;
        const deltaContent = data?.deltaContent || '';
        if (type === CHAT_EVENTS.DELTA) {
            buf.delta.content += deltaContent;
            if (data?.messageId) buf.delta.messageId = data.messageId;
        } else {
            buf.reasoning.content += deltaContent;
            if (data?.reasoningId) buf.reasoning.reasoningId = data.reasoningId;
        }
        if (!buf.timer) {
            buf.timer = setTimeout(() => this._flushCoalescedDeltas(sessionId), SSE_DELTA_COALESCE_MS);
        }
    }

    /**
     * Flush any accumulated DELTA/REASONING content as single coalesced frames.
     * Safe to call repeatedly and when nothing is buffered. Reasoning and content
     * target separate client buffers, so their relative order is irrelevant; order
     * WITHIN each type is preserved by concatenation.
     * @private
     */
    _flushCoalescedDeltas(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry || !entry._sseCoalesce) return;
        const buf = entry._sseCoalesce;
        if (buf.timer) {
            clearTimeout(buf.timer);
            buf.timer = null;
        }
        if (buf.reasoning.content) {
            const { content, reasoningId } = buf.reasoning;
            buf.reasoning = { content: '', reasoningId: '' };
            this._rawBroadcastToSSE(sessionId, CHAT_EVENTS.REASONING, { deltaContent: content, reasoningId });
        }
        if (buf.delta.content) {
            const { content, messageId } = buf.delta;
            buf.delta = { content: '', messageId: '' };
            this._rawBroadcastToSSE(sessionId, CHAT_EVENTS.DELTA, { deltaContent: content, messageId });
        }
    }

    /**
     * Write an event to all SSE clients of a session (no coalescing). Strips
     * inline base64 from attachments on the live path.
     * @private
     */
    _rawBroadcastToSSE(sessionId, type, data) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return;

        // Never put inline base64 on the LIVE SSE path. Any attachment carrying
        // inline bytes is migrated to the on-disk store and replaced with a URL
        // reference so multi-MB frames can't flood (and crash) the renderer.
        let outData = data;
        if (type === CHAT_EVENTS.USER_INPUT_REQUEST) {
            outData = this._sanitizeUserInputRequestData(data);
        }
        if ((type === CHAT_EVENTS.MESSAGE || type === CHAT_EVENTS.TOOL_COMPLETE)
            && data && Array.isArray(data.attachments) && data.attachments.length > 0) {
            outData = {
                ...data,
                attachments: data.attachments.map(att => this._toClientAttachment(sessionId, att)),
            };
        }

        const event = {
            type,
            sessionId,
            timestamp: new Date().toISOString(),
            data: outData,
        };

        let eventJson = JSON.stringify(event);
        if (Buffer.byteLength(eventJson, 'utf8') > MAX_SSE_EVENT_BYTES) {
            console.warn(`[ChatManager] Oversized SSE event stripped before send: type=${type}, bytes=${Buffer.byteLength(eventJson, 'utf8')}`);
            event.data = ChatSessionManager._stripOversizePayloads(outData);
            event.data.payloadStrippedForSse = true;
            eventJson = JSON.stringify(event);
        }

        // Emit to EventEmitter listeners
        this.emit('event', event);
        this.emit(`event:${sessionId}`, event);

        // Write to SSE response objects
        const ssePayload = `event: ${type}\ndata: ${eventJson}\n\n`;
        for (const client of entry.sseClients) {
            try {
                client.write(ssePayload);
            } catch {
                // Client disconnected — will be cleaned up
            }
        }
    }

    /**
     * Broadcast a tool progress update to all active SSE-connected sessions.
     * Called by long-running tool handlers to stream
     * intermediate progress into the chat UI in real time.
     *
     * @param {string} toolName  - Name of the running tool
     * @param {Object} data      - Progress payload { phase, message, elapsed, ... }
     */
    broadcastToolProgress(toolName, data) {
        for (const [sessionId, entry] of this._sessions) {
            if (entry.sseClients.length > 0 && !entry.archived) {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_PROGRESS, {
                    toolName,
                    ...data,
                });
            }
        }
    }

    /**
     * Broadcast a synthetic tool start event to all active SSE-connected sessions.
     * Used by orchestrating tools to emit per-phase
     * sub-tool cards in the chat UI without actual LLM tool calls.
     *
     * @param {string} toolName   - Sub-tool name
     * @param {string} toolCallId - Unique ID for this sub-tool instance
     */
    broadcastToolStart(toolName, toolCallId) {
        for (const [sessionId, entry] of this._sessions) {
            if (entry.sseClients.length > 0 && !entry.archived) {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_START, {
                    toolName,
                    toolCallId,
                });
            }
        }
    }

    /**
     * Broadcast a synthetic tool complete event to all active SSE-connected sessions.
     *
     * @param {string} toolName   - Sub-tool name
     * @param {string} toolCallId - Unique ID matching the start event
     * @param {boolean} success   - Whether the sub-tool succeeded
     * @param {string} [result]   - Optional result summary (truncated to 500 chars)
     */
    broadcastToolComplete(toolName, toolCallId, success, result) {
        for (const [sessionId, entry] of this._sessions) {
            if (entry.sseClients.length > 0 && !entry.archived) {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_COMPLETE, {
                    toolName,
                    toolCallId,
                    success,
                    result: typeof result === 'string' ? result.substring(0, 2000) : '',
                });
            }
        }
    }

    // ─── Inline Attachment Store (on-disk, served on demand) ─────────────────
    // Assistant images are persisted to disk and referenced by URL in the
    // transcript instead of being inlined as base64 in history/SSE/persisted
    // JSON. The browser fetches each image via <img src=url>, so bytes are
    // decoded off the JS heap and garbage-collected when unmounted. This is the
    // root-cause fix for the Chrome STATUS_BREAKPOINT renderer crash that
    // recurred whenever many screenshots accumulated in one long-lived session.

    /** Strict ID/path-segment validation to prevent traversal on the public endpoint. */
    static _ATTACHMENT_ID_RE = /^[a-zA-Z0-9_-]+$/;

    /** Lazy-loaded optional `sharp` image engine: undefined = untried, null = unavailable. */
    static _sharpModule = undefined;

    /** Absolute directory holding a session's stored attachment files. */
    _sessionAttachmentDir(sessionId) {
        return path.join(this._attachmentStoreDir, String(sessionId));
    }

    /** Public URL the browser uses to fetch a stored attachment on demand. */
    _attachmentUrl(sessionId, attachmentId) {
        return `/api/chat/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`;
    }

    /**
     * Persist raw image bytes to the per-session store and return a lightweight
     * reference (no inline base64). Enforces the per-session byte budget.
     * @returns {Object} attachment reference { id, name, type, size, kind, url, alt? }
     */
    _storeAttachmentBytes(sessionId, buffer, options = {}) {
        const mimeType = options.mimeType || 'image/png';
        const ext = ChatSessionManager._IMAGE_EXTENSIONS[mimeType]
            || ChatSessionManager._DOC_EXTENSIONS[mimeType]
            || '.bin';
        const attId = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const dir = this._sessionAttachmentDir(sessionId);
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${attId}${ext}`);
        fs.writeFileSync(filePath, buffer);
        this._enforceSessionAttachmentBudget(sessionId);

        const ref = {
            id: attId,
            name: options.name || `${attId}${ext}`,
            type: mimeType,
            size: buffer.length,
            kind: options.kind || 'image',
            url: this._attachmentUrl(sessionId, attId),
        };
        const alt = String(options.alt || '').trim();
        if (alt) ref.alt = alt;
        return ref;
    }

    /** Persist an existing on-disk file into the store and return a reference. */
    _storeAttachmentFromFile(sessionId, filePath, options = {}) {
        const buffer = fs.readFileSync(filePath);
        return this._storeAttachmentBytes(sessionId, buffer, {
            mimeType: options.mimeType,
            name: options.name || path.basename(filePath),
            kind: options.kind || 'image',
            alt: options.alt,
        });
    }

    /**
     * Evict oldest stored files (by mtime) once a session's store exceeds the
     * byte budget. Bytes are recreatable only while the source exists; an evicted
     * URL simply 404s and the UI shows a lightweight placeholder.
     */
    _enforceSessionAttachmentBudget(sessionId) {
        const dir = this._sessionAttachmentDir(sessionId);
        let entries;
        try {
            entries = fs.readdirSync(dir).map((name) => {
                const full = path.join(dir, name);
                const stat = fs.statSync(full);
                return { full, size: stat.size, mtime: stat.mtimeMs, isFile: stat.isFile() };
            }).filter((e) => e.isFile); // skip the thumbs/ subdir — only originals count toward the budget
        } catch {
            return;
        }
        let total = entries.reduce((sum, e) => sum + e.size, 0);
        if (total <= MAX_SESSION_ATTACHMENT_STORE_BYTES) return;
        entries.sort((a, b) => a.mtime - b.mtime); // oldest first
        for (const e of entries) {
            if (total <= MAX_SESSION_ATTACHMENT_STORE_BYTES) break;
            try {
                fs.unlinkSync(e.full);
                total -= e.size;
            } catch { /* best-effort */ }
        }
    }

    /**
     * Resolve a stored attachment for the public endpoint. Filesystem-only (works
     * even when the session isn't loaded in memory). Path-traversal safe.
     * @returns {{ path: string, mimeType: string, size: number } | null}
     */
    getStoredAttachment(sessionId, attachmentId) {
        if (!ChatSessionManager._ATTACHMENT_ID_RE.test(String(sessionId || ''))) return null;
        if (!ChatSessionManager._ATTACHMENT_ID_RE.test(String(attachmentId || ''))) return null;
        const dir = this._sessionAttachmentDir(sessionId);
        let files;
        try {
            files = fs.readdirSync(dir);
        } catch {
            return null;
        }
        const match = files.find(f => f === attachmentId || f.startsWith(`${attachmentId}.`));
        if (!match) return null;

        let real;
        let rootReal;
        try {
            real = fs.realpathSync(path.join(dir, match));
            rootReal = fs.realpathSync(this._attachmentStoreDir);
        } catch {
            return null;
        }
        if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;

        const ext = path.extname(real).toLowerCase();
        const mimeType = ChatSessionManager._IMAGE_MIME_BY_EXT[ext]
            || ChatSessionManager._DOC_MIME_BY_EXT[ext]
            || 'application/octet-stream';
        let size = 0;
        try { size = fs.statSync(real).size; } catch { /* ignore */ }
        return { path: real, mimeType, size };
    }

    /**
     * Lazily load the optional `sharp` image engine. Cached across calls. Returns
     * the module, or null when it is not installed — the server stays fully
     * functional without it (thumbnails simply fall back to full-resolution).
     */
    static _loadSharp() {
        if (ChatSessionManager._sharpModule !== undefined) return ChatSessionManager._sharpModule;
        try {
            // eslint-disable-next-line global-require
            ChatSessionManager._sharpModule = require('sharp');
        } catch {
            ChatSessionManager._sharpModule = null;
            console.warn('[ChatManager] Optional dependency "sharp" not installed — serving full-resolution images (no thumbnails). Renderer memory is still bounded by the client-side render-window cap + memory guard.');
        }
        return ChatSessionManager._sharpModule;
    }

    /**
     * Resolve a downscaled thumbnail of a stored image, generating + disk-caching
     * it on first request. Chat tiles render at ~240px but the browser decodes the
     * FULL-resolution bitmap (width*height*4 bytes); across many screenshots in one
     * session that decoded-bitmap pool dominates renderer memory and triggers the
     * Chrome STATUS_BREAKPOINT crash. A small thumbnail keeps the decoded pool tiny.
     * Gracefully falls back to the original bytes for animated GIFs, unsupported
     * formats, oversized inputs, or when `sharp` is unavailable.
     * @returns {Promise<{ path: string, mimeType: string, size: number } | null>}
     */
    async getStoredAttachmentThumbnail(sessionId, attachmentId, width) {
        const original = this.getStoredAttachment(sessionId, attachmentId);
        if (!original) return null;

        // Only raster still-images benefit. Animated GIFs and non-images pass through.
        if (!/^image\//.test(original.mimeType) || original.mimeType === 'image/gif') {
            return original;
        }
        const w = Math.max(64, Math.min(1024, Math.floor(Number(width) || 0)));
        if (!w) return original;

        const sharp = ChatSessionManager._loadSharp();
        if (!sharp) return original; // graceful degradation — no resize engine present

        const thumbsDir = path.join(this._sessionAttachmentDir(sessionId), 'thumbs');
        const ext = path.extname(original.path).toLowerCase() || '.png';
        const thumbPath = path.join(thumbsDir, `${attachmentId}.${w}${ext}`);

        // Serve a cached thumbnail when it exists and is at least as new as the source.
        try {
            const ts = fs.statSync(thumbPath);
            const os = fs.statSync(original.path);
            if (ts.size > 0 && ts.mtimeMs >= os.mtimeMs) {
                return { path: thumbPath, mimeType: original.mimeType, size: ts.size };
            }
        } catch { /* not generated yet */ }

        try {
            fs.mkdirSync(thumbsDir, { recursive: true });
            const input = fs.readFileSync(original.path);
            let pipeline = sharp(input, { failOn: 'none', limitInputPixels: 268402689 })
                .rotate()
                .resize({ width: w, withoutEnlargement: true });
            if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 8 });
            else if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 72 });
            else if (ext === '.webp') pipeline = pipeline.webp({ quality: 72 });
            const out = await pipeline.toBuffer();
            // Only adopt the thumbnail when it is actually smaller than the source.
            if (out.length > 0 && out.length < original.size) {
                fs.writeFileSync(thumbPath, out);
                return { path: thumbPath, mimeType: original.mimeType, size: out.length };
            }
        } catch {
            // fall through to the original on any decode/encode failure
        }
        return original;
    }

    /** Recursively remove a session's attachment store directory. */
    _cleanupSessionAttachmentStore(sessionId) {
        const dir = this._sessionAttachmentDir(sessionId);
        try {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        } catch { /* non-critical */ }
    }

    /**
     * Convert an attachment to an outbound (SSE/history) form with NO inline
     * base64. References (url) and non-inline descriptors (artifact path / doc /
     * video) pass through unchanged (minus any stray inline bytes). Inline base64
     * is migrated into the on-disk store and replaced with a URL reference. On any
     * failure the inline bytes are dropped and an `evicted` placeholder returned —
     * never propagate base64 to the browser.
     */
    _toClientAttachment(sessionId, att) {
        if (!att || typeof att !== 'object') return att;

        // Already lightweight (url reference) or a non-inline descriptor
        // (artifact has path/relativePath; doc/video carry their own fields).
        if (att.url || att.relativePath || att.path) {
            if (att.dataUrl || att.data || att.base64) {
                const { dataUrl, data, base64, ...rest } = att;
                return rest;
            }
            return att;
        }

        const hasInline = !!(att.dataUrl || att.data || att.base64);
        if (!hasInline) return att;

        try {
            let mimeType = att.type || att.media_type;
            let b64 = att.base64 || att.data;
            if (!b64 && typeof att.dataUrl === 'string') {
                const m = att.dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
                if (m) {
                    mimeType = mimeType || m[1];
                    b64 = m[2];
                }
            }
            if (!b64) {
                const { dataUrl, data, base64, ...rest } = att;
                return { ...rest, kind: rest.kind || 'image', evicted: true };
            }
            const buffer = Buffer.from(b64, 'base64');
            return this._storeAttachmentBytes(sessionId, buffer, {
                mimeType: mimeType || 'image/png',
                name: att.name,
                kind: att.kind || 'image',
                alt: att.alt,
            });
        } catch {
            const { dataUrl, data, base64, ...rest } = att;
            return { ...rest, kind: rest.kind || 'image', evicted: true };
        }
    }

    /**
     * Strip inline base64 from an attachment before it is persisted to disk, but
     * ONLY when a durable reference already exists (url/path/relativePath). Legacy
     * inline-only attachments are left intact so they are not lost; they migrate to
     * the store lazily the next time the session is opened (getHistory).
     */
    _stripPersistedAttachment(att) {
        if (!att || typeof att !== 'object') return att;
        const hasInline = !!(att.dataUrl || att.data || att.base64);
        if (!hasInline) return att;
        if (att.url || att.relativePath || att.path) {
            const { dataUrl, data, base64, ...rest } = att;
            return rest;
        }
        return att;
    }

    /**
     * Publish a local image file into the chat transcript as an assistant message.
     * The image bytes are persisted to the on-disk attachment store and referenced
     * by URL (NOT inlined as base64) so the renderer fetches them on demand and
     * never accumulates the full set in heap.
     *
     * @param {string} sessionId
     * @param {Object} options
     * @param {string} options.filePath
     * @param {string} [options.caption]
     * @param {string} [options.altText]
     * @returns {{ messageId: string, attachment: Object }}
     */
    publishAssistantImage(sessionId, options = {}) {
        const entry = this._sessions.get(sessionId);
        if (!entry) throw new Error(`Session ${sessionId} not found`);

        const filePath = String(options.filePath || '').trim();
        if (!filePath) throw new Error('filePath is required');
        if (!fs.existsSync(filePath)) throw new Error(`Image file not found: ${filePath}`);

        const ext = path.extname(filePath).toLowerCase();
        const mimeType = ChatSessionManager._IMAGE_MIME_BY_EXT[ext];
        if (!mimeType) {
            throw new Error(`Unsupported image type: ${ext || 'unknown'}. Supported: png, jpg, jpeg, gif, webp.`);
        }

        const stat = fs.statSync(filePath);
        if (stat.size > MAX_ASSISTANT_IMAGE_BYTES) {
            throw new Error(`Image exceeds ${Math.round(MAX_ASSISTANT_IMAGE_BYTES / (1024 * 1024))} MB limit for inline chat display.`);
        }

        // Persist bytes to the on-disk store and reference by URL — no base64 in
        // the transcript, SSE frame, or persisted history (renderer-heap safe).
        const attachment = this._storeAttachmentFromFile(sessionId, filePath, {
            mimeType,
            name: path.basename(filePath),
            kind: 'image',
            alt: String(options.altText || '').trim() || path.basename(filePath),
        });

        const message = {
            role: 'assistant',
            content: String(options.caption || '').trim(),
            timestamp: new Date().toISOString(),
            attachments: [attachment],
        };

        entry.messages.push(message);
        this._persistHistory();

        this._broadcastToSSE(sessionId, CHAT_EVENTS.MESSAGE, {
            content: message.content,
            attachments: message.attachments,
            reasoning: null,
            messageId: attachment.id,
        });

        return {
            messageId: attachment.id,
            attachment,
        };
    }

    _consumePendingAssistantAttachments(entry) {
        if (!entry || !Array.isArray(entry.pendingAssistantAttachments) || entry.pendingAssistantAttachments.length === 0) {
            return [];
        }

        const attachments = [];
        const seen = new Set();
        for (const attachment of entry.pendingAssistantAttachments) {
            const key = attachment?.path || attachment?.relativePath || attachment?.name || attachment?.id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            attachments.push(attachment);
        }
        entry.pendingAssistantAttachments = [];
        return attachments;
    }

    _queuePendingAssistantAttachments(entry, attachments, options = {}) {
        if (!entry || !Array.isArray(attachments) || attachments.length === 0) return 0;

        if (!Array.isArray(entry.pendingAssistantAttachments)) {
            entry.pendingAssistantAttachments = [];
        }

        const existingKeys = new Set(
            entry.pendingAssistantAttachments
                .map((attachment) => attachment?.path || attachment?.relativePath || attachment?.name || attachment?.id)
                .filter(Boolean)
        );

        let added = 0;
        for (const attachment of attachments) {
            const key = attachment?.path || attachment?.relativePath || attachment?.name || attachment?.id;
            if (!key || existingKeys.has(key)) continue;
            existingKeys.add(key);
            entry.pendingAssistantAttachments.push(attachment);
            added++;
        }

        if (options.logLabel && added === 0) {
            console.log(`[ChatManager] ℹ️ No new pending attachments queued for ${options.logLabel}`);
        }

        return added;
    }

    _normalizeGeneratedArtifactToolName(toolName) {
        return String(toolName || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();
    }

    _getGeneratedArtifactToolDescriptor(toolName) {
        if (!toolName) return null;

        const direct = ChatSessionManager._GENERATED_ARTIFACT_TOOL_MAP[toolName];
        if (direct) return direct;

        const normalizedName = this._normalizeGeneratedArtifactToolName(toolName);
        return ChatSessionManager._GENERATED_ARTIFACT_TOOL_MAP[normalizedName] || null;
    }

    _coerceToolResultPayload(rawResult) {
        if (rawResult == null) return rawResult;

        if (typeof rawResult === 'string') {
            const trimmed = rawResult.trim();
            if (!trimmed) return trimmed;

            try {
                return this._coerceToolResultPayload(JSON.parse(trimmed));
            } catch {
                return trimmed;
            }
        }

        if (Array.isArray(rawResult)) {
            return rawResult.map((item) => this._coerceToolResultPayload(item));
        }

        if (typeof rawResult !== 'object') {
            return rawResult;
        }

        if (typeof rawResult.text === 'string' && rawResult.text.trim()) {
            const parsedText = this._coerceToolResultPayload(rawResult.text);
            if (typeof parsedText === 'object' && parsedText !== null) {
                return parsedText;
            }
        }

        if (typeof rawResult.result === 'string' && rawResult.result.trim()) {
            const parsedResult = this._coerceToolResultPayload(rawResult.result);
            if (typeof parsedResult === 'object' && parsedResult !== null) {
                return parsedResult;
            }
        }

        if (Array.isArray(rawResult.content) && rawResult.content.length > 0) {
            const contentItems = rawResult.content
                .map((item) => this._coerceToolResultPayload(item))
                .filter(Boolean);
            const structuredItem = contentItems.find((item) => typeof item === 'object' && item !== null && !Array.isArray(item));
            if (structuredItem) return structuredItem;
            const textItem = contentItems.find((item) => typeof item === 'string' && item.trim());
            if (textItem) return textItem;
        }

        if (rawResult.structuredContent && typeof rawResult.structuredContent === 'object') {
            return this._coerceToolResultPayload(rawResult.structuredContent);
        }

        return rawResult;
    }

    _extractArtifactPathsFromText(text) {
        if (typeof text !== 'string' || !text.trim()) return [];

        const extensionPattern = '(?:pdf|docx|doc|pptx|ppt|xlsx|xls|csv|html|htm|txt|md|json|webm|mp4|png|jpe?g|svg|spec\\.js|js|ts)';
        const patterns = [
            // Captures absolute/relative paths including spaces (e.g., C:\\Repo Name\\artifact.pptx).
            new RegExp('(?:[A-Za-z]:[\\\\/]|\\.\\.?[\\\\/]|/|[A-Za-z0-9_.-]+[\\\\/])[^\\r\\n<>|]+?\\.' + extensionPattern, 'gi'),
            // Conservative fallback without spaces for compact inline paths.
            new RegExp('(?:[A-Za-z]:[\\\\/]|\\.\\.?[\\\\/]|/)?[^\\s\\r\\n"\'<>|]+(?:[\\\\/][^\\s\\r\\n"\'<>|]+)*\\.' + extensionPattern, 'gi'),
        ];

        const candidates = new Set();
        for (const pattern of patterns) {
            const matches = text.match(pattern) || [];
            for (const match of matches) {
                const normalized = String(match || '').trim();
                if (normalized) candidates.add(normalized);
            }
        }

        return Array.from(candidates);
    }

    _resolveArtifactPath(candidatePath) {
        const trimmedPath = String(candidatePath || '')
            .trim()
            .replace(/^[`"']+|[`"']+$/g, '')
            .replace(/[),.;:!?]+$/g, '')
            .trim();
        if (!trimmedPath) return '';

        const candidatePaths = [];
        if (path.isAbsolute(trimmedPath)) {
            candidatePaths.push(path.normalize(trimmedPath));
        } else {
            candidatePaths.push(path.resolve(PROJECT_ROOT, trimmedPath));
            candidatePaths.push(path.resolve(trimmedPath));
        }

        for (const candidate of candidatePaths) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return candidatePaths[0] || '';
    }

    _isGeneratedArtifactPath(resolvedPath) {
        return isGeneratedArtifactPath(resolvedPath, {
            projectRoot: PROJECT_ROOT,
            roots: this._generatedArtifactRoots,
        });
    }

    _extractAssistantContentArtifactAttachments(content) {
        const candidates = this._extractArtifactPathsFromText(content);
        if (candidates.length === 0) return [];

        const attachments = [];
        const seen = new Set();
        for (const candidate of candidates) {
            const resolvedPath = this._resolveArtifactPath(candidate);
            if (!resolvedPath || seen.has(resolvedPath) || !this._isGeneratedArtifactPath(resolvedPath)) continue;
            seen.add(resolvedPath);

            const attachment = this._createAssistantArtifactAttachment(resolvedPath, {
                label: 'Generated artifact',
            });
            if (attachment) attachments.push(attachment);
        }

        return attachments;
    }

    _handleToolExecutionFinished(sessionId, entry, event, completionEventName) {
        const toolName = event?.data?.toolName || event?.data?.name || 'unknown';
        const toolCallId = event?.data?.toolCallId || event?.data?.id || '';
        const rawResult = event?.data?.result;
        const success = event?.data?.success ?? true;
        const artifactAttachments = success
            ? this._extractToolGeneratedAttachments(toolName, rawResult, { success })
            : [];

        if (artifactAttachments.length > 0) {
            this._queuePendingAssistantAttachments(entry, artifactAttachments, {
                logLabel: `${toolName} via ${completionEventName}`,
            });
        } else {
            const descriptor = this._getGeneratedArtifactToolDescriptor(toolName);
            if (descriptor) {
                console.warn(`[ChatManager] ⚠️ No artifact attachments extracted for ${toolName} via ${completionEventName}`);
            }
        }

        if (entry?.activeToolCallIds) {
            entry.activeToolCallIds.delete(toolCallId);
        }
        this._setExecutionState(
            entry,
            (entry?.activeToolCallIds?.size || 0) > 0 ? SESSION_EXECUTION_STATES.RUNNING : SESSION_EXECUTION_STATES.IDLE,
            {
                activeToolCount: entry?.activeToolCallIds?.size || 0,
                lastError: success ? null : (event?.data?.error || `${toolName} failed`),
            }
        );

        this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_COMPLETE, {
            toolName,
            toolCallId,
            success,
            attachments: artifactAttachments,
            result: this._buildToolCompletionSummary(toolName, rawResult, artifactAttachments),
        });
    }

    _extractToolGeneratedAttachments(toolName, rawResult, options = {}) {
        const descriptor = this._getGeneratedArtifactToolDescriptor(toolName);
        const parsed = this._coerceToolResultPayload(rawResult);
        if (!parsed) return [];
        if (options.success === false || parsed?.success === false) return [];

        const candidates = this._collectGeneratedArtifactCandidates(parsed, descriptor?.pathFields || []);
        if (candidates.length === 0) return [];

        const attachments = [];
        const seenPaths = new Set();
        const baseLabel = String(parsed?.message || parsed?.label || descriptor?.label || 'Generated artifact').trim();

        for (const candidate of candidates) {
            const normalizedPath = this._resolveArtifactPath(candidate.path);
            if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
            seenPaths.add(normalizedPath);

            const attachment = this._createAssistantArtifactAttachment(normalizedPath, {
                label: candidates.length > 1
                    ? `${baseLabel} (${candidate.displayName || path.basename(normalizedPath)})`
                    : baseLabel,
                sourceTool: toolName,
            });
            if (attachment) attachments.push(attachment);
        }

        return attachments;
    }

    _buildToolCompletionSummary(toolName, rawResult, attachments = []) {
        if (attachments.length > 0) {
            if (attachments.length === 1) {
                return `${attachments[0].label || 'Generated artifact ready'}: ${attachments[0].name}`;
            }
            return `${attachments.length} generated artifacts ready`;
        }

        return typeof rawResult === 'string'
            ? rawResult.substring(0, 500)
            : '';
    }

    _collectGeneratedArtifactCandidates(result, pathFields = []) {
        const fieldsToCheck = Array.from(new Set([
            ...pathFields,
            'outputPath',
            'artifactPath',
            'excelPath',
            'reportPath',
            'downloadPath',
            'savedPath',
            'specPath',
            'explorationPath',
            'manifestPath',
            'rawResultsPath',
            'htmlPath',
            'markdownPath',
            'pdfPath',
            'pptxPath',
            'xlsxPath',
            'videoPath',
            'imagePath',
        ]));

        if (!result) return [];

        const candidates = [];
        const seen = new Set();
        const addCandidate = (candidatePath, displayName) => {
            if (typeof candidatePath !== 'string' || !candidatePath.trim()) return;
            const key = `${candidatePath}::${displayName || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ path: candidatePath, displayName });
        };

        if (typeof result === 'string') {
            for (const match of this._extractArtifactPathsFromText(result)) {
                addCandidate(match, 'text');
            }
            return candidates;
        }

        if (Array.isArray(result)) {
            for (const item of result) {
                for (const candidate of this._collectGeneratedArtifactCandidates(item, fieldsToCheck)) {
                    addCandidate(candidate.path, candidate.displayName);
                }
            }
            return candidates;
        }

        if (typeof result !== 'object') return candidates;

        for (const field of fieldsToCheck) {
            const value = result[field];
            if (typeof value === 'string') {
                addCandidate(value, field);
                continue;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    if (typeof item === 'string') {
                        addCandidate(item, field);
                        continue;
                    }

                    if (!item || typeof item !== 'object') continue;
                    addCandidate(item.filePath || item.path || item.outputPath, item.fileName || item.name || field);
                }
            }
        }

        for (const value of Object.values(result)) {
            if (typeof value === 'string') {
                for (const match of this._extractArtifactPathsFromText(value)) {
                    addCandidate(match, 'text');
                }
                continue;
            }

            if (Array.isArray(value) || (value && typeof value === 'object')) {
                for (const candidate of this._collectGeneratedArtifactCandidates(value, fieldsToCheck)) {
                    addCandidate(candidate.path, candidate.displayName);
                }
            }
        }

        return candidates;
    }

    _sanitizeAssistantArtifactContent(content, attachments = []) {
        if (typeof content !== 'string' || !content.trim()) return content;

        const artifactAttachments = Array.isArray(attachments)
            ? attachments.filter((attachment) => attachment?.kind === 'artifact' && (attachment?.path || attachment?.relativePath))
            : [];
        if (artifactAttachments.length === 0) return content;

        const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let sanitized = content;

        for (const attachment of artifactAttachments) {
            const replacementName = attachment.name || 'generated artifact';
            const pathReferences = Array.from(new Set([
                attachment.path,
                attachment.relativePath,
                typeof attachment.relativePath === 'string' ? attachment.relativePath.replace(/\//g, '\\\\') : '',
            ].filter((value) => typeof value === 'string' && value.trim()))).sort((a, b) => b.length - a.length);

            for (const reference of pathReferences) {
                const escapedReference = escapeRegex(reference);
                sanitized = sanitized.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escapedReference}\\)`, 'g'), '$1');
                sanitized = sanitized.replace(new RegExp(escapedReference, 'g'), replacementName);
            }
        }

        return sanitized
            .replace(/\s{2,}/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .trim();
    }

    _createAssistantArtifactAttachment(filePath, options = {}) {
        const resolvedPath = path.resolve(String(filePath || '').trim());
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return null;
        if (!this._isGeneratedArtifactPath(resolvedPath)) return null;

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) return null;

        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = ChatSessionManager._IMAGE_MIME_BY_EXT[ext]
            || ChatSessionManager._DOC_MIME_BY_EXT[ext]
            || 'application/octet-stream';
        const relativePath = path.relative(PROJECT_ROOT, resolvedPath).replace(/\\/g, '/');

        return {
            id: `assistant_artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: path.basename(resolvedPath),
            type: mimeType,
            mimeType,
            extension: ext,
            size: stat.size,
            kind: 'artifact',
            path: resolvedPath,
            relativePath,
            actionable: true,
            label: String(options.label || '').trim() || 'Generated artifact',
            sourceTool: String(options.sourceTool || '').trim(),
            createdAt: new Date().toISOString(),
        };
    }

    // ─── Auto-Progress Hints for MCP / Known Tools ──────────────────────────

    /**
     * Data-driven progress hint map. Each entry maps a tool name pattern to a
     * { phase, message } pair that is automatically broadcast when the tool starts.
     * This gives the chat UI immediate contextual feedback for MCP tools.
     * @private
     */
    static _TOOL_PROGRESS_HINTS = {
        // ── MCP Browser Navigation ──
        'mcp_unified-autom_unified_navigate': { phase: 'browser', message: 'Navigating to page...' },
        'mcp_unified-autom_unified_navigate_back': { phase: 'browser', message: 'Navigating back...' },
        'mcp_unified-autom_unified_navigate_forward': { phase: 'browser', message: 'Navigating forward...' },
        'mcp_unified-autom_unified_reload': { phase: 'browser', message: 'Reloading page...' },
        'mcp_unified-autom_unified_get_page_url': { phase: 'browser', message: 'Reading current URL...' },
        'mcp_unified-autom_unified_get_page_title': { phase: 'browser', message: 'Reading page title...' },
        'mcp_unified-autom_unified_browser_close': { phase: 'browser', message: 'Closing browser...' },
        'mcp_unified-autom_unified_list_all_pages': { phase: 'browser', message: 'Listing open pages...' },
        'mcp_unified-autom_unified_tabs': { phase: 'browser', message: 'Listing browser tabs...' },

        // ── MCP Snapshots / Selectors ──
        'mcp_unified-autom_unified_snapshot': { phase: 'snapshot', message: 'Capturing accessibility snapshot...' },
        'mcp_unified-autom_unified_get_by_role': { phase: 'selector', message: 'Finding element by ARIA role...' },
        'mcp_unified-autom_unified_get_by_text': { phase: 'selector', message: 'Finding element by text...' },
        'mcp_unified-autom_unified_get_by_label': { phase: 'selector', message: 'Finding element by label...' },
        'mcp_unified-autom_unified_get_by_test_id': { phase: 'selector', message: 'Finding element by test ID...' },
        'mcp_unified-autom_unified_get_by_placeholder': { phase: 'selector', message: 'Finding element by placeholder...' },
        'mcp_unified-autom_unified_get_by_alt_text': { phase: 'selector', message: 'Finding element by alt text...' },
        'mcp_unified-autom_unified_generate_locator': { phase: 'selector', message: 'Generating locator...' },

        // ── MCP Interactions ──
        'mcp_unified-autom_unified_click': { phase: 'interaction', message: 'Clicking element...' },
        'mcp_unified-autom_unified_type': { phase: 'interaction', message: 'Typing text...' },
        'mcp_unified-autom_unified_fill_form': { phase: 'interaction', message: 'Filling form fields...' },
        'mcp_unified-autom_unified_select_option': { phase: 'interaction', message: 'Selecting option...' },
        'mcp_unified-autom_unified_check': { phase: 'interaction', message: 'Checking checkbox...' },
        'mcp_unified-autom_unified_uncheck': { phase: 'interaction', message: 'Unchecking checkbox...' },
        'mcp_unified-autom_unified_hover': { phase: 'interaction', message: 'Hovering element...' },
        'mcp_unified-autom_unified_press_key': { phase: 'interaction', message: 'Pressing key...' },
        'mcp_unified-autom_unified_press_sequentially': { phase: 'interaction', message: 'Typing sequentially...' },
        'mcp_unified-autom_unified_drag': { phase: 'interaction', message: 'Dragging element...' },
        'mcp_unified-autom_unified_scroll_into_view': { phase: 'interaction', message: 'Scrolling into view...' },
        'mcp_unified-autom_unified_file_upload': { phase: 'interaction', message: 'Uploading file...' },
        'mcp_unified-autom_unified_handle_dialog': { phase: 'interaction', message: 'Handling dialog...' },
        'mcp_unified-autom_unified_clear_input': { phase: 'interaction', message: 'Clearing input...' },
        'mcp_unified-autom_unified_focus': { phase: 'interaction', message: 'Focusing element...' },
        'mcp_unified-autom_unified_blur': { phase: 'interaction', message: 'Blurring element...' },
        'mcp_unified-autom_unified_keyboard_type': { phase: 'interaction', message: 'Keyboard input...' },
        'mcp_unified-autom_unified_mouse_click_xy': { phase: 'interaction', message: 'Mouse clicking...' },
        'mcp_unified-autom_unified_mouse_move_xy': { phase: 'interaction', message: 'Mouse moving...' },

        // ── MCP State Reading ──
        'mcp_unified-autom_unified_is_visible': { phase: 'state', message: 'Checking element visibility...' },
        'mcp_unified-autom_unified_is_enabled': { phase: 'state', message: 'Checking element state...' },
        'mcp_unified-autom_unified_get_text_content': { phase: 'state', message: 'Reading text content...' },
        'mcp_unified-autom_unified_get_inner_text': { phase: 'state', message: 'Reading inner text...' },
        'mcp_unified-autom_unified_get_attribute': { phase: 'state', message: 'Reading attribute...' },
        'mcp_unified-autom_unified_get_input_value': { phase: 'state', message: 'Reading input value...' },

        // ── MCP Assertions ──
        'mcp_unified-autom_unified_expect_url': { phase: 'assertion', message: 'Asserting URL...' },
        'mcp_unified-autom_unified_expect_title': { phase: 'assertion', message: 'Asserting page title...' },
        'mcp_unified-autom_unified_expect_element_text': { phase: 'assertion', message: 'Asserting element text...' },
        'mcp_unified-autom_unified_expect_element_attribute': { phase: 'assertion', message: 'Asserting attribute...' },
        'mcp_unified-autom_unified_verify_element_visible': { phase: 'assertion', message: 'Verifying element visible...' },
        'mcp_unified-autom_unified_verify_text_visible': { phase: 'assertion', message: 'Verifying text visible...' },

        // ── MCP Wait ──
        'mcp_unified-autom_unified_wait_for': { phase: 'wait', message: 'Waiting for condition...' },
        'mcp_unified-autom_unified_wait_for_element': { phase: 'wait', message: 'Waiting for element...' },
        'mcp_unified-autom_unified_wait_for_response': { phase: 'wait', message: 'Waiting for network response...' },
        'mcp_unified-autom_unified_wait_for_new_page': { phase: 'wait', message: 'Waiting for new page...' },

        // ── MCP Screenshots / Visual ──
        'mcp_unified-autom_unified_screenshot': { phase: 'screenshot', message: 'Taking screenshot...' },
        'mcp_unified-autom_unified_screenshot_baseline': { phase: 'screenshot', message: 'Saving screenshot baseline...' },
        'mcp_unified-autom_unified_screenshot_compare': { phase: 'screenshot', message: 'Comparing screenshots...' },

        // ── MCP Advanced / CDP ──
        'mcp_unified-autom_unified_evaluate': { phase: 'advanced', message: 'Evaluating JavaScript...' },
        'mcp_unified-autom_unified_evaluate_cdp': { phase: 'advanced', message: 'Evaluating script (CDP)...' },
        'mcp_unified-autom_unified_run_playwright_code': { phase: 'advanced', message: 'Running Playwright code...' },
        'mcp_unified-autom_unified_console_messages': { phase: 'advanced', message: 'Reading console messages...' },
        'mcp_unified-autom_unified_console_messages_cdp': { phase: 'advanced', message: 'Reading console (CDP)...' },
        'mcp_unified-autom_unified_network_requests': { phase: 'advanced', message: 'Reading network requests...' },
        'mcp_unified-autom_unified_page_errors': { phase: 'advanced', message: 'Reading page errors...' },
        'mcp_unified-autom_unified_accessibility_audit': { phase: 'advanced', message: 'Running accessibility audit...' },
        'mcp_unified-autom_unified_performance_analyze': { phase: 'advanced', message: 'Analyzing performance...' },

        // ── Custom SDK Tools ──
        'execute_test': { phase: 'execution', message: 'Preparing test execution...' },
        'fetch_jira_ticket': { phase: 'jira', message: 'Fetching Jira ticket...' },
        'get_jira_epic': { phase: 'jira', message: 'Fetching Jira epic...' },
        'search_jira_epics': { phase: 'jira', message: 'Searching Jira epics...' },
        'get_jira_epic_issues': { phase: 'jira', message: 'Fetching Jira epic issues...' },
        'list_jira_issues_without_epic': { phase: 'jira', message: 'Listing Jira issues without epic...' },
        'get_jira_ticket_capabilities': { phase: 'jira', message: 'Inspecting Jira ticket capabilities...' },
        'create_jira_ticket': { phase: 'jira', message: 'Creating Jira ticket...' },
        'transition_jira_ticket': { phase: 'jira', message: 'Transitioning Jira ticket...' },
        'log_jira_work': { phase: 'jira', message: 'Logging Jira work...' },
        'update_jira_estimates': { phase: 'jira', message: 'Updating Jira estimates...' },
        'update_jira_ticket': { phase: 'jira', message: 'Updating Jira ticket...' },
        'generate_test_case_excel': { phase: 'excel', message: 'Generating Excel file...' },
        'generate_excel_report': { phase: 'excel', message: 'Generating Excel report...' },
        'list_session_documents': { phase: 'document', message: 'Inspecting uploaded session documents...' },
        'parse_session_document': { phase: 'document', message: 'Parsing uploaded document...' },
        'generate_docx': { phase: 'document', message: 'Generating Word document...' },
        'generate_pptx': { phase: 'document', message: 'Generating PowerPoint deck...' },
        'generate_pdf': { phase: 'document', message: 'Generating PDF document...' },
        'generate_html_report': { phase: 'document', message: 'Generating HTML report...' },
        'generate_markdown': { phase: 'document', message: 'Generating Markdown document...' },
        'generate_video': { phase: 'video', message: 'Generating video artifact...' },
        'validate_generated_script': { phase: 'validation', message: 'Validating script...' },
        'run_quality_gate': { phase: 'validation', message: 'Running quality gate...' },
        'get_framework_inventory': { phase: 'framework', message: 'Scanning framework inventory...' },
        'search_project_context': { phase: 'grounding', message: 'Searching project context...' },
        'get_feature_map': { phase: 'grounding', message: 'Loading feature map...' },
        'search_knowledge_base': { phase: 'kb', message: 'Searching knowledge base...' },
        'get_knowledge_base_page': { phase: 'kb', message: 'Fetching KB page...' },
        'search_confluence_content': { phase: 'kb', message: 'Searching Confluence...' },
        'get_confluence_page_details': { phase: 'kb', message: 'Fetching Confluence page...' },
        'list_confluence_spaces': { phase: 'kb', message: 'Listing Confluence spaces...' },
        'list_confluence_pages_in_space': { phase: 'kb', message: 'Listing Confluence pages...' },
        'get_confluence_page_tree': { phase: 'kb', message: 'Loading Confluence page tree...' },
        'get_test_results': { phase: 'execution', message: 'Loading test results...' },
        'find_test_files': { phase: 'framework', message: 'Searching for test files...' },
        'get_selector_recommendations': { phase: 'grounding', message: 'Getting selector recommendations...' },
        'check_existing_coverage': { phase: 'grounding', message: 'Checking existing coverage...' },
        'get_snapshot_quality': { phase: 'validation', message: 'Analyzing snapshot quality...' },
        'analyze_test_failure': { phase: 'validation', message: 'Analyzing test failure...' },
        'publish_image_to_chat': { phase: 'screenshot', message: 'Publishing image to chat...' },
    };

    /**
     * Look up a progress hint for a tool name. Returns { phase, message } or null.
     * @param {string} toolName
     * @returns {{ phase: string, message: string } | null}
     */
    static _getToolProgressHint(toolName) {
        return ChatSessionManager._TOOL_PROGRESS_HINTS[toolName] || null;
    }

    static _GENERATED_ARTIFACT_TOOL_MAP = {
        'generate_test_case_excel': {
            label: 'Generated test cases workbook',
            pathFields: ['path', 'filePath'],
        },
        'generatetestcaseexcel': {
            label: 'Generated test cases workbook',
            pathFields: ['path', 'filePath'],
        },
        'generate test case excel': {
            label: 'Generated test cases workbook',
            pathFields: ['path', 'filePath'],
        },
        'generate-test-case-excel': {
            label: 'Generated test cases workbook',
            pathFields: ['path', 'filePath'],
        },
        'generateTestCaseExcel': {
            label: 'Generated test cases workbook',
            pathFields: ['path', 'filePath'],
        },
        'generate_excel_report': {
            label: 'Generated Excel report',
            pathFields: ['filePath', 'path'],
        },
        'generate_docx': {
            label: 'Generated Word document',
            pathFields: ['filePath', 'path'],
        },
        'generate_pptx': {
            label: 'Generated PowerPoint deck',
            pathFields: ['filePath', 'path'],
        },
        'generate_pdf': {
            label: 'Generated PDF document',
            pathFields: ['filePath', 'path'],
        },
        'generate_html_report': {
            label: 'Generated HTML report',
            pathFields: ['filePath', 'path'],
        },
        'generate_markdown': {
            label: 'Generated Markdown document',
            pathFields: ['filePath', 'path'],
        },
        'generate_video': {
            label: 'Generated video',
            pathFields: ['filePath', 'path'],
        },
    };

    /**
     * Reverse-lookup: find a session entry by its SDK session reference.
     * Used inside onUserInputRequest where the sessionId isn't in closure scope.
     * @private
     */
    _findEntryBySession(session) {
        for (const [sid, entry] of this._sessions) {
            if (entry.session === session) return { sid, entry };
        }
        return null;
    }

    /**
     * Programmatic user-input request for non-SDK callers.
     *
     * Finds the most recently active session with connected SSE clients, creates a pending
     * input request, broadcasts it to the dashboard, and blocks until the user responds
     * (or a timeout auto-resolves it).
     *
     * @param {string} question  - The question to display
     * @param {string[]} options - Clickable option buttons (may be empty)
     * @param {Object} [meta]   - Additional metadata: { type: 'credentials'|'password'|'confirmation'|'default', sessionId?: string }
     * @returns {Promise<{ answer: string|Object, wasFreeform: boolean }>}
     */
    requestUserInput(question, options = [], meta = {}) {
        let preferredSessionId = isNonEmptyString(meta?.sessionId) ? meta.sessionId : null;
        let normalizedRequest;

        if (
            isNonEmptyString(question)
            && options
            && typeof options === 'object'
            && !Array.isArray(options)
            && (isNonEmptyString(options.question) || isNonEmptyString(options.message) || Array.isArray(options.options) || isNonEmptyString(options.type))
        ) {
            preferredSessionId = question;
            normalizedRequest = normalizeUserInputRequestPayload(options, meta?.type || 'default');
            meta = {
                ...(options.meta && typeof options.meta === 'object' ? options.meta : {}),
                ...(meta && typeof meta === 'object' ? meta : {}),
                sessionId: preferredSessionId,
                type: normalizedRequest.type,
            };
        } else {
            normalizedRequest = normalizeUserInputRequestPayload({ question, options, meta }, meta?.type || 'default');
            meta = {
                ...(meta && typeof meta === 'object' ? meta : {}),
                type: normalizedRequest.type,
            };
        }

        const promptQuestion = normalizedRequest.question;
        const promptOptions = normalizedRequest.options;
        const inputType = normalizedRequest.type;
        const safeMeta = this._sanitizeUserInputRequestMeta(meta);

        // Find the best target session. Prefer the explicit session, even when
        // its SSE client is reconnecting, so approval prompts can replay later.
        let targetSid = null;
        let targetEntry = null;
        if (preferredSessionId) {
            const preferredEntry = this._sessions.get(preferredSessionId);
            if (preferredEntry && !preferredEntry.archived) {
                targetSid = preferredSessionId;
                targetEntry = preferredEntry;
            }
        }
        if (!targetSid || !targetEntry) {
            for (const [sid, entry] of this._sessions) {
                if (!entry.archived && entry.sseClients.length > 0) {
                    targetSid = sid;
                    targetEntry = entry;
                    // Don't break — keep iterating to find the most recently created one
                }
            }
        }
        if (!targetSid || !targetEntry) {
            for (const [sid, entry] of this._sessions) {
                if (!entry.archived) {
                    targetSid = sid;
                    targetEntry = entry;
                }
            }
        }
        if (!targetSid || !targetEntry) {
            console.warn('[ChatManager] requestUserInput: no active session available — resolving fail-closed');
            return Promise.resolve(this._getAutoUserInputResolution(inputType, 'missing_session'));
        }

        const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const sseClientCount = targetEntry.sseClients?.length || 0;
        console.log(`[ChatManager] 💬 Programmatic user input requested (${requestId}, type=${inputType}, session=${targetSid}, sseClients=${sseClientCount}): ${promptQuestion.slice(0, 120)}`);
        if (sseClientCount === 0) {
            console.warn(`[ChatManager] requestUserInput: session ${targetSid} has no SSE clients; prompt will replay on reconnect`);
        }

        return new Promise((resolve) => {
            const timeoutMs = (inputType === 'delegated_agent_input' || safeMeta.source)
                ? Math.max(USER_INPUT_TIMEOUT_MS, DELEGATED_USER_INPUT_TIMEOUT_MS)
                : USER_INPUT_TIMEOUT_MS;
            // Auto-resolve timer — prevents hanging forever
            const timer = setTimeout(() => {
                if (targetEntry.pendingInputRequests.has(requestId)) {
                    console.log(`[ChatManager] ⏱️ Programmatic user input timed out (${requestId}) — auto-resolving`);
                    targetEntry.pendingInputRequests.delete(requestId);
                    const timeoutResolution = this._getAutoUserInputResolution(inputType, 'timeout');
                    this._broadcastToSSE(targetSid, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                        requestId,
                        answer: timeoutResolution.answer,
                        auto: true,
                        reason: timeoutResolution.reason,
                    });
                    resolve(timeoutResolution);
                }
            }, timeoutMs);

            // Store the pending request (include meta for credential awareness in resolveUserInput)
            targetEntry.pendingInputRequests.set(requestId, {
                resolve,
                question: promptQuestion,
                options: promptOptions,
                timer,
                meta: safeMeta,
                type: inputType,
            });

            // Record in message history so it replays on reconnect
            targetEntry.messages.push({
                role: 'user_input_request',
                content: promptQuestion,
                requestId,
                options: promptOptions,
                type: inputType,
                meta: safeMeta,
                timestamp: new Date().toISOString(),
            });

            // Broadcast SSE event to the dashboard — include type for credential UI
            this._broadcastToSSE(targetSid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                requestId,
                question: promptQuestion,
                options: promptOptions,
                type: inputType,
                meta: safeMeta,
            });

            this._persistHistory();
        });
    }

    /**
     * Resolve a pending user-input request (called when the user submits their answer
     * from the dashboard UI).
     *
     * @param {string} sessionId
     * @param {string} requestId  - Unique ID of the pending request
     * @param {string|Object} answer - The user's answer: plain string, or structured object (e.g., { username, password } for credentials)
     * @returns {{ resolved: true }}
     */
    resolveUserInput(sessionId, requestId, answer) {
        const entry = this._sessions.get(sessionId);
        if (!entry) throw new Error(`Session ${sessionId} not found`);

        const pending = entry.pendingInputRequests.get(requestId);
        if (!pending) throw new Error(`No pending user-input request "${requestId}" (already resolved or expired)`);

        // Clear the auto-resolve timeout
        if (pending.timer) clearTimeout(pending.timer);

        // Remove from pending map
        entry.pendingInputRequests.delete(requestId);

        // Determine if this is a credential response — mask in history for security
        const pendingType = pending.meta?.type || pending.type || 'default';
        const isCredential = pendingType === 'credentials' || pendingType === 'password';
        const historyContent = isCredential
            ? '🔐 Credentials provided (hidden for security)'
            : (typeof answer === 'string' ? answer : JSON.stringify(answer));

        // Record the user's answer in message history (masked for credentials)
        entry.messages.push({
            role: 'user_input_response',
            content: historyContent,
            requestId,
            timestamp: new Date().toISOString(),
        });

        // Notify dashboard clients — mask credential answers in SSE broadcast
        this._broadcastToSSE(sessionId, CHAT_EVENTS.USER_INPUT_COMPLETE, {
            requestId,
            answer: isCredential ? '🔐 Credentials provided' : answer,
            auto: false,
        });

        this._persistHistory();

        // Unblock the caller — resolve the Promise with the ACTUAL answer (unmasked)
        pending.resolve({ answer, wasFreeform: typeof answer === 'string' });

        const logAnswer = isCredential ? '🔐 [credentials masked]' : (typeof answer === 'string' ? answer.slice(0, 100) : '[structured object]');
        console.log(`[ChatManager] ✅ User input resolved (${requestId}): ${logAnswer}`);
        return { resolved: true };
    }

    /**
     * Auto-resolve all pending user-input requests for a session.
     * Used during abort / destroy to prevent the agent from hanging.
     * @private
     */
    _autoResolveAllPendingInputs(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry || !entry.pendingInputRequests) return;

        for (const [requestId, pending] of entry.pendingInputRequests) {
            if (pending.timer) clearTimeout(pending.timer);
            const resolution = this._getAutoUserInputResolution(pending.type || pending.meta?.type || 'default', 'abort_or_destroy');
            this._broadcastToSSE(sessionId, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                requestId,
                answer: resolution.answer,
                auto: true,
                reason: resolution.reason,
            });
            pending.resolve(resolution);
            console.log(`[ChatManager] ⏩ Auto-resolved pending input (${requestId}) due to abort/destroy`);
        }
        entry.pendingInputRequests.clear();
    }

    _tryResolvePendingInputFromChatText(sessionId, entry, content, attachments) {
        if (!entry?.pendingInputRequests || entry.pendingInputRequests.size === 0) return { resolved: false };
        if (!isNonEmptyString(content)) return { resolved: false };
        if (Array.isArray(attachments) && attachments.length > 0) return { resolved: false };

        const pendingEntries = Array.from(entry.pendingInputRequests.entries());
        // Prefer the newest non-credential request. Credentials/password prompts
        // must use the dedicated secure UI, never freeform chat text.
        for (let idx = pendingEntries.length - 1; idx >= 0; idx--) {
            const [requestId, pending] = pendingEntries[idx];
            const pendingType = pending.meta?.type || pending.type || 'default';
            if (pendingType === 'credentials' || pendingType === 'password') continue;
            try {
                this.resolveUserInput(sessionId, requestId, content.trim());
                console.log(`[ChatManager] ↩️ Routed typed chat message to pending user input (${requestId}) instead of TPM send`);
                return { resolved: true, requestId };
            } catch (err) {
                console.warn(`[ChatManager] ⚠️ Could not route typed answer to pending input ${requestId}: ${err.message}`);
                return { resolved: false };
            }
        }

        return { resolved: false };
    }

    /**
     * Send a user message to a chat session.
     *
     * @param {string} sessionId
     * @param {string} content
     * @param {Object[]} [attachments]
     * @param {string|null} [modelOverride]
     * @returns {Promise<{ messageId }>}
     */
    async sendMessage(sessionId, content, attachments, modelOverride = null) {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            throw this._createSessionError('CHAT_SESSION_NOT_FOUND', `Session ${sessionId} not found`, 404, { recoverable: false });
        }
        if (entry.archived) {
            throw this._createSessionError(
                'CHAT_SESSION_ARCHIVED',
                `Session ${sessionId} is archived (read-only). Create a new session to chat.`,
                409,
                { runtimeState: SESSION_RUNTIME_STATES.ARCHIVED, recoverable: false }
            );
        }

        // If an approval/question tray is pending, a typed message like "approved",
        // "cancel", "put NA", or a URL is usually the user's answer to THAT tray,
        // not a new TPM prompt. Route it directly to the pending request so the
        // delegated specialist keeps ownership instead of timing out and letting
        // TPM start a fresh generic flow.
        const pendingInputResolution = this._tryResolvePendingInputFromChatText(sessionId, entry, content, attachments);
        if (pendingInputResolution?.resolved) {
            return { messageId: `user_input_response_${pendingInputResolution.requestId}`, resolvedInput: true };
        }

        const normalizedModelOverride = isNonEmptyString(modelOverride) ? modelOverride.trim() : '';
        if (normalizedModelOverride && normalizedModelOverride !== entry.model) {
            entry.model = normalizedModelOverride;
            entry.lastError = null;
            this._persistHistory();

            // Model changes require a fresh runtime session so the current send
            // executes against the selected model.
            await this._recoverRuntimeSession(sessionId, entry, { reason: 'model_switch' });
        }

        const bootstrapped = await this._awaitRuntimeBootstrap(sessionId, entry);
        if (!bootstrapped && (!entry.session || this._getRuntimeState(entry) !== SESSION_RUNTIME_STATES.ACTIVE)) {
            throw this._createSessionError(
                'CHAT_SESSION_INITIALIZING',
                entry.lastError || 'Session runtime is still starting. Try again in a moment.',
                entry.runtimeState === SESSION_RUNTIME_STATES.FAILED ? 503 : 409,
                {
                    runtimeState: this._getRuntimeState(entry),
                    recoverable: !entry.archived,
                }
            );
        }

        this._touchSession(entry);
        // Capture the latest user message so delegated specialists can run on the
        // user's ORIGINAL message (direct-session parity), not a reconstructed task.
        try { this._latestUserMessage.set(sessionId, content); } catch { /* ignore */ }
        const atlassianUrlContext = extractAtlassianUrlContext(content);
        const userMessageTimestamp = new Date().toISOString();
        const userMessageId = `user_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const hasAttachableEvidence = Array.isArray(attachments) && attachments.some(att => {
            if (att?.type === 'image') return isNonEmptyString(att?.data);
            if (att?.type === 'video') return isNonEmptyString(att?.tempPath);
            if (att?.type === 'video_link') return isNonEmptyString(att?.url);
            return false;
        });

        // Convert attachments to temp files early — docTempFiles is needed by the session
        // attachment persistence block below, before the SDK send block runs.
        let docTempFiles = [];
        let videoTempFiles = [];
        let tempFiles = [];
        let sdkAttachments = [];
        if (attachments && attachments.length > 0) {
            ({ sdkAttachments, tempFiles, docTempFiles, videoTempFiles } =
                this._convertAttachmentsToTempFiles(attachments));
        }

        // Track user message (store attachment metadata only — no base64 in history)
        const historyMessage = { role: 'user', content, timestamp: userMessageTimestamp, messageId: userMessageId };
        if (attachments && attachments.length > 0) {
            historyMessage.attachmentMeta = attachments.map(att => ({
                type: att.type,
                media_type: att.media_type,
                filename: att.filename || undefined,
                size: Number.isFinite(att.size) ? att.size : (att.data ? Math.ceil(att.data.length * 0.75) : 0), // estimated decoded size
            }));

            // Persist uploaded images to the on-disk attachment store and attach
            // lightweight URL references to the history message. This lets the
            // browser render user images on reload (served on demand) WITHOUT ever
            // inlining base64 into history/SSE — the renderer-heap-safe path used
            // for assistant images too.
            const userAttachmentRefs = [];
            for (const att of attachments) {
                if (att.type === 'image' && isNonEmptyString(att.data)) {
                    try {
                        const buffer = Buffer.from(att.data, 'base64');
                        userAttachmentRefs.push(this._storeAttachmentBytes(sessionId, buffer, {
                            mimeType: att.media_type,
                            name: att.filename,
                            kind: 'image',
                        }));
                    } catch (err) {
                        console.warn(`[ChatManager] Failed to store user image attachment: ${err.message}`);
                    }
                }
            }
            if (userAttachmentRefs.length > 0) {
                historyMessage.attachments = userAttachmentRefs;
            }

            // Persist attachment data in session for Jira ticket attachment forwarding
            // BugGenie may need these later when the user approves bug ticket creation
            if (!entry.sessionAttachments) entry.sessionAttachments = [];
            for (const att of attachments) {
                if (att.type === 'image' && att.data) {
                    entry.sessionAttachments.push({
                        type: att.type,
                        media_type: att.media_type,
                        data: att.data, // base64 — retained for Jira upload
                        messageId: userMessageId,
                        timestamp: userMessageTimestamp,
                    });
                } else if (att.type === 'document' && att.filename && Array.isArray(docTempFiles)) {
                    const match = docTempFiles.find(doc => doc.filename === att.filename);
                    if (match) {
                        entry.sessionAttachments.push({
                            type: att.type,
                            media_type: att.media_type,
                            filename: att.filename,
                            path: match.path,
                            size: Number.isFinite(att.size) ? att.size : (att.data ? Math.ceil(att.data.length * 0.75) : 0),
                            messageId: userMessageId,
                            timestamp: userMessageTimestamp,
                        });
                        if (!Array.isArray(entry._documentTempFiles)) entry._documentTempFiles = [];
                        if (!entry._documentTempFiles.includes(match.path)) {
                            entry._documentTempFiles.push(match.path);
                        }
                    }
                } else if (att.type === 'video' && att.tempPath) {
                    entry.sessionAttachments.push({
                        type: att.type,
                        media_type: att.media_type,
                        tempPath: att.tempPath,
                        filename: att.filename || path.basename(att.tempPath),
                        size: Number.isFinite(att.size) ? att.size : undefined,
                        messageId: userMessageId,
                        timestamp: userMessageTimestamp,
                    });
                } else if (att.type === 'video_link' && att.url) {
                    entry.sessionAttachments.push({
                        type: att.type,
                        media_type: att.media_type,
                        url: att.url,
                        provider: att.provider || 'direct',
                        filename: att.filename || undefined,
                        messageId: userMessageId,
                        timestamp: userMessageTimestamp,
                    });
                }
            }
            // Cap retained attachments per session to prevent memory bloat while keeping recent uploads reusable.
            if (entry.sessionAttachments.length > MAX_PERSISTED_SESSION_ATTACHMENTS) {
                entry.sessionAttachments = entry.sessionAttachments.slice(-MAX_PERSISTED_SESSION_ATTACHMENTS);
            }
            // Byte-budget eviction (defense-in-depth): the count cap alone can still
            // retain hundreds of MB of inline screenshot base64 across a long session,
            // which bloats server heap and SSE frames (Chrome STATUS_BREAKPOINT). Walk
            // newest → oldest and drop the inline `data` of the oldest images once the
            // running total exceeds the budget; the descriptor is kept so metadata
            // remains available, only the heavy base64 is released.
            let retainedBytes = 0;
            for (let i = entry.sessionAttachments.length - 1; i >= 0; i--) {
                const sa = entry.sessionAttachments[i];
                if (!sa || sa.type !== 'image' || typeof sa.data !== 'string') continue;
                if (retainedBytes + sa.data.length > MAX_PERSISTED_SESSION_ATTACHMENT_BYTES) {
                    sa.data = undefined;
                    sa.evicted = true;
                } else {
                    retainedBytes += sa.data.length;
                }
            }
        }
        entry.messages.push(historyMessage);

        this._refreshSessionTitle(entry);

        // Persist after user message
        this._persistHistory();

        // Send to SDK session (non-blocking — response streams via events)
        // IMPORTANT: SDK MessageOptions requires { prompt }, not { content }
        let promptContent = content;
        if (entry.sessionContext) {
            entry.sessionContext.latestUserMessageId = userMessageId;
            entry.sessionContext.latestUserMessageTimestamp = userMessageTimestamp;
            if (hasAttachableEvidence) {
                entry.sessionContext.activeEvidenceMessageId = userMessageId;
                entry.sessionContext.activeEvidenceTimestamp = userMessageTimestamp;
            }
            entry.sessionContext.latestAtlassianUrlContext = atlassianUrlContext;
        }

        // tempFiles, docTempFiles, videoTempFiles, sdkAttachments were already computed above
        // (before the session attachment persistence block) — reuse those variables here.
        let imageSDKAttachments = [];
        if (attachments && attachments.length > 0) {
            // Collect image-only SDK attachments (documents are not passed as SDK file attachments)
            imageSDKAttachments = sdkAttachments.filter(a => a.displayName && /\.(png|jpg|gif|webp)$/.test(a.displayName));

            // For document attachments, extract text and inject into the prompt
            if (docTempFiles && docTempFiles.length > 0) {
                try {
                    const extractedText = await this._extractDocumentText(docTempFiles);
                    if (extractedText) {
                        promptContent = extractedText + '\n\n' + (content || 'Please analyze the uploaded document(s).');
                        console.log(`[ChatManager] \u{1F4DD} Injected ${extractedText.length} chars of document text into prompt`);
                    }
                } catch (err) {
                    console.error('[ChatManager] \u274C Document text extraction failed:', err.message);
                    promptContent = `[Document upload failed: ${err.message}]\n\n${content}`;
                }
            }

            // For video attachments, extract frames and build video context for vision analysis
            if (videoTempFiles && videoTempFiles.length > 0) {
                try {
                    const { createVideoAnalyzer } = require('./video-analyzer');
                    const analyzer = createVideoAnalyzer();

                    for (const video of videoTempFiles) {
                        let videoPath = video.path;

                        // If it's an external link, download it first
                        if (video.url && !videoPath) {
                            videoPath = await analyzer.fetchExternalVideo(video.url, video.provider);
                            if (!entry._videoTempFiles) entry._videoTempFiles = [];
                            entry._videoTempFiles.push(videoPath);
                        }

                        if (!videoPath) continue;

                        if (!entry._videoTempFiles) entry._videoTempFiles = [];
                        if (!entry._videoTempFiles.includes(videoPath)) {
                            entry._videoTempFiles.push(videoPath);
                        }

                        const result = await analyzer.buildVideoContext(videoPath);
                        if (result && result.frames && result.frames.length > 0) {
                            // Track video frames in session-lifetime array (NOT the 60s tempFiles timer).
                            // BugGenie needs these files for attach_video_frames_to_jira which runs
                            // minutes after extraction. They get cleaned in destroySession() instead.
                            if (!entry._videoTempFiles) entry._videoTempFiles = [];
                            for (const frame of result.frames) {
                                entry._videoTempFiles.push(frame.path);
                            }
                            // Also track SDK low-res copies for cleanup
                            if (result.sdkFrames) {
                                for (const sf of result.sdkFrames) {
                                    entry._videoTempFiles.push(sf.path);
                                }
                            }

                            // Use low-res SDK copies for Copilot API attachments (avoids 413 payload errors).
                            // High-res frames are stored in entry.videoContext for Jira uploads.
                            const MAX_SDK_VIDEO_FRAMES = 10;
                            const availableSdkFrames = (result.sdkFrames && result.sdkFrames.length > 0)
                                ? result.sdkFrames : result.frames;
                            let sdkFrames;
                            if (availableSdkFrames.length <= MAX_SDK_VIDEO_FRAMES) {
                                sdkFrames = availableSdkFrames;
                            } else {
                                // Hybrid select: first + last + evenly-spaced
                                sdkFrames = [availableSdkFrames[0]];
                                const innerCount = MAX_SDK_VIDEO_FRAMES - 2;
                                const step = (availableSdkFrames.length - 2) / (innerCount + 1);
                                for (let k = 1; k <= innerCount; k++) {
                                    const idx = Math.min(Math.round(step * k), availableSdkFrames.length - 2);
                                    if (idx > 0) sdkFrames.push(availableSdkFrames[idx]);
                                }
                                sdkFrames.push(availableSdkFrames[availableSdkFrames.length - 1]);
                            }

                            for (const frame of sdkFrames) {
                                imageSDKAttachments.push({
                                    type: 'file',
                                    path: frame.path,
                                    displayName: `video-frame-${frame.timestamp}s.jpg`,
                                });
                            }

                            // Prepend video context to the prompt
                            promptContent = result.contextPrompt + '\n\n' + (promptContent || 'Analyze this video recording and identify the bug.');
                            console.log(`[ChatManager] \u{1F3AC} Extracted ${result.frames.length} frames from video (${result.metadata.duration}s), sending ${sdkFrames.length} to SDK`);

                            // Store ALL video frames in session for BugGenie tools (analyze_video_recording)
                            if (!entry.videoContext) entry.videoContext = [];
                            entry.videoContext.push({
                                messageId: userMessageId,
                                timestamp: userMessageTimestamp,
                                videoPath,
                                filename: video.filename,
                                duration: result.metadata.duration,
                                frameCount: result.frames.length,
                                frames: result.frames.map(f => ({ path: f.path, timestamp: f.timestamp })),
                                metadata: result.metadata,
                            });
                        }
                    }
                } catch (err) {
                    console.error('[ChatManager] \u274C Video processing failed:', err.message);
                    promptContent = `[Video processing failed: ${err.message}]\n\n${promptContent}`;
                }
            }
        }

        if (atlassianUrlContext.atlassianUrls.length > 0) {
            promptContent = `${buildAtlassianRoutingHint(atlassianUrlContext)}\n\n${promptContent}`;
        }

        // ── Workspace-agent dynamic delegation hint ──
        // For workspace/custom agents (which run with an intent-narrowed native tool
        // set), scan the user message for cross-domain signals and nudge the agent
        // toward Tool Broker discovery + delegation. The agent already knows about
        // the broker from its system prompt; this is a per-turn breadcrumb so it
        // doesn't have to "remember" to use it.
        try {
            if (entry.agentSelection?.source === 'workspace' && this._toolBroker?.enabled) {
                const hint = this._buildWorkspaceDelegationHint(content);
                if (hint) {
                    promptContent = `${hint}\n\n${promptContent}`;
                }
            }
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ Workspace delegation hint failed (non-blocking): ${err.message}`);
        }

        // ── Master-agent semantic intent routing hint (TPM) ──
        // For the default merged (master) profile, inject a per-turn hint with the
        // live specialist roster + best match so the master delegates appropriately.
        try {
            if (this._isMasterSelection(entry.agentSelection) && this.config?.orchestration?.delegation?.enabled !== false) {
                const masterHint = await this._buildMasterIntentHint(content);
                if (masterHint) {
                    promptContent = `${masterHint}\n\n${promptContent}`;
                }
            }
        } catch (err) {
            console.warn(`[ChatManager] ⚠️ Master intent hint failed (non-blocking): ${err.message}`);
        }

        // ── Per-message skill routing ──
        // Detect which project skills are relevant for this user message
        // and inject routing hints so the agent auto-activates matching skills.
        let skillRoutingResult = null;
        try {
            const activeAgent = entry.agentSelection?.followupMode || entry.agentMode || null;
            skillRoutingResult = buildProjectSkillRoutingHint(content || '', { activeAgent });
            if (skillRoutingResult.hint) {
                promptContent = `${skillRoutingResult.hint}\n\n${promptContent}`;
                console.log(`[ChatManager] \u{1F9E0} Skill routing: ${skillRoutingResult.matches.length} match(es)` +
                    (skillRoutingResult.activatedSkills.length > 0
                        ? ` | Auto-activated: ${skillRoutingResult.activatedSkills.join(', ')}`
                        : ''));
            }
        } catch (err) {
            console.warn(`[ChatManager] \u26A0\uFE0F Skill routing failed (non-blocking): ${err.message}`);
        }

        // ── Session recovery context injection ──
        // When the runtime was recreated (server restart, manual resume, model switch),
        // the LLM has no memory of prior turns. Inject the recovery transcript so the
        // agent can understand what the user is referring to and maintain continuity.
        let injectedRecoveryContext = false;
        if (entry.needsRecoveryContextInjection === true) {
            const transcript = this._buildRecoveryTranscript(entry);
            if (transcript) {
                promptContent = [
                    '[Session context \u2014 previous conversation in this chat]',
                    'This session was resumed after a runtime restart. The conversation history below is from earlier turns in this same chat session. Use it to understand what the user is referring to, maintain continuity, and avoid asking the user to repeat information they already provided.',
                    '<conversation_history>',
                    transcript,
                    '</conversation_history>',
                    '<current_message>',
                    promptContent,
                    '</current_message>',
                ].join('\n\n');
                injectedRecoveryContext = true;
                console.log(`[ChatManager] \u{1F504} Injected recovery context (${transcript.length} chars, recovery #${entry.recoveryCount || 1}) into resumed session ${sessionId}`);
            }
        }

        const messageOptions = { prompt: promptContent, _hasRecoveryContext: injectedRecoveryContext };
        if (imageSDKAttachments.length > 0) {
            messageOptions.attachments = imageSDKAttachments;
            console.log(`[ChatManager] \u{1F4CE} Sending ${imageSDKAttachments.length} image(s) as file attachments to SDK`);
        }

        const messageId = await this._sendRuntimeMessage(sessionId, entry, messageOptions, true);
        if (injectedRecoveryContext) this._markRecoveryContextDelivered(entry);

        // Broadcast skill activation event to SSE clients (non-blocking)
        if (skillRoutingResult && skillRoutingResult.activatedSkills.length > 0) {
            this._broadcastToSSE(sessionId, 'skill_activated', {
                activatedSkills: skillRoutingResult.activatedSkills,
                matches: skillRoutingResult.matches.map(m => ({
                    name: m.name,
                    score: m.score,
                    confidence: m.confidence,
                    skillFile: m.relativeSkillFilePath,
                })),
            });
        }

        // Schedule temp file cleanup (60s delay to ensure SDK has read them)
        this._scheduleCleanup(tempFiles);

        return { messageId };
    }

    /**
     * Get conversation history for a session.
     * Returns the locally curated messages array (user + assistant text only),
     * NOT the raw SDK events which include 60+ internal event types.
     */
    async getHistory(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) throw new Error(`Session ${sessionId} not found`);

        // Backstop: only return the most recent messages. Attachments are
        // lightweight references, so this bounds the JSON the browser parses on
        // session open without affecting realistic session sizes.
        const start = Math.max(0, entry.messages.length - MAX_HISTORY_MESSAGES);
        const slice = entry.messages.slice(start);

        // Migrate any legacy inline base64 attachments to the on-disk store and
        // mutate the stored message in place so the heavy bytes are dropped from
        // server memory and never re-persisted. The browser receives URL refs.
        let migrated = false;
        const out = slice.map((message) => {
            const normalized = normalizeUserInputHistoryMessage(message);
            if (normalized.role === 'user_input_request') {
                const safeMeta = this._sanitizeUserInputRequestMeta(normalized.meta);
                if (safeMeta !== normalized.meta && ChatSessionManager._jsonByteLength(safeMeta) !== ChatSessionManager._jsonByteLength(normalized.meta || {})) {
                    message.meta = safeMeta;
                    migrated = true;
                }
                return { ...normalized, meta: safeMeta };
            }
            if (Array.isArray(message.attachments) && message.attachments.length > 0) {
                const converted = message.attachments.map(att => this._toClientAttachment(sessionId, att));
                let changed = converted.length !== message.attachments.length;
                for (let i = 0; i < converted.length && !changed; i++) {
                    if (converted[i] !== message.attachments[i]) changed = true;
                }
                if (changed) {
                    message.attachments = converted; // permanent migration in memory
                    migrated = true;
                }
                return { ...normalized, attachments: converted };
            }
            return normalized;
        });

        if (migrated) this._persistHistory();
        return out;
    }

    /**
     * Get contextual follow-up suggestions for the current conversation state.
     *
     * @param {string} sessionId
     * @returns {Followup[]}
     */
    getFollowups(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) throw new Error(`Session ${sessionId} not found`);

        const lastMsg = entry.messages.filter(m => m.role === 'assistant').pop();
        return this._followupProvider.getChatFollowups({
            sessionId,
            agentMode: entry.agentSelection?.followupMode || entry.agentMode,
            lastMessage: lastMsg?.content || '',
            messages: entry.messages,
            maxFollowups: 3,
        });
    }

    /**
     * Abort current processing in a session.
     */
    async abort(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) {
            throw this._createSessionError('CHAT_SESSION_NOT_FOUND', `Session ${sessionId} not found`, 404, { recoverable: false });
        }
        if (entry.archived || !entry.session) return; // Nothing to abort for archived sessions

        // Auto-resolve any pending user-input requests so the agent doesn't hang
        this._autoResolveAllPendingInputs(sessionId);

        await entry.session.abort();

        // Settle the SSE stream with a terminal idle event so the client stops
        // processing immediately and does NOT enter an error-driven reconnect
        // loop (each reconnect would otherwise replay recent messages). Keeping
        // the stream open + idle avoids the new-chat/stop crash churn.
        try {
            if (entry.activeToolCallIds) entry.activeToolCallIds.clear();
            this._setExecutionState(entry, SESSION_EXECUTION_STATES.IDLE, {
                activeToolCount: 0,
                lastError: null,
            });
            this._broadcastToSSE(sessionId, CHAT_EVENTS.IDLE, {});
        } catch { /* idle settle is best-effort */ }
    }

    /**
     * Build a lightweight replay version of message attachments. Strips heavy
     * inline payloads (base64 dataUrl / raw data) so reconnect replay never
     * floods the browser with multi-MB SSE frames. The client already has the
     * full attachment bytes from the live stream or can fetch them via the
     * /history endpoint; replay only needs the descriptor for rendering.
     */
    static _buildReplayAttachments(attachments) {
        if (!Array.isArray(attachments) || attachments.length === 0) return [];
        return attachments.map((att) => {
            if (!att || typeof att !== 'object') return att;
            const { dataUrl, data, base64, ...rest } = att;
            const hadInline = !!(dataUrl || data || base64);
            return hadInline ? { ...rest, replayStripped: true } : { ...rest };
        });
    }

    /**
     * Register an SSE client (HTTP response) for a session.
     */
    addSSEClient(sessionId, res) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return false;

        entry.sseClients.push(res);

        // Send recent messages as replay
        for (const msg of entry.messages.slice(-MAX_SSE_REPLAY_MESSAGES)) {
            // Map special roles to their dedicated event types
            let type;
            if (msg.role === 'user') {
                type = 'user_message';
            } else if (msg.role === 'user_input_request') {
                const normalizedMsg = normalizeUserInputHistoryMessage(msg);
                // Replay the prompt — mark as resolved if no longer pending
                const stillPending = entry.pendingInputRequests?.has(normalizedMsg.requestId);
                const replayData = this._sanitizeUserInputRequestData({
                    requestId: normalizedMsg.requestId,
                    question: normalizedMsg.content,
                    options: normalizedMsg.options || [],
                    type: normalizedMsg.type || 'default',
                    meta: normalizedMsg.meta || {},
                    resolved: !stillPending,
                });
                const event = {
                    type: CHAT_EVENTS.USER_INPUT_REQUEST,
                    sessionId,
                    timestamp: normalizedMsg.timestamp,
                    data: replayData,
                };
                let eventJson = JSON.stringify(event);
                if (Buffer.byteLength(eventJson, 'utf8') > MAX_SSE_EVENT_BYTES) {
                    event.data = ChatSessionManager._stripOversizePayloads(replayData);
                    event.data.payloadStrippedForSse = true;
                    eventJson = JSON.stringify(event);
                }
                try { res.write(`event: ${CHAT_EVENTS.USER_INPUT_REQUEST}\ndata: ${eventJson}\n\n`); } catch { /* ignore */ }
                continue;
            } else if (msg.role === 'user_input_response') {
                const event = {
                    type: CHAT_EVENTS.USER_INPUT_COMPLETE,
                    sessionId,
                    timestamp: msg.timestamp,
                    data: {
                        requestId: msg.requestId,
                        answer: msg.content,
                        auto: false,
                    },
                };
                try { res.write(`event: ${CHAT_EVENTS.USER_INPUT_COMPLETE}\ndata: ${JSON.stringify(event)}\n\n`); } catch { /* ignore */ }
                continue;
            } else {
                type = CHAT_EVENTS.MESSAGE;
            }
            // Cap replayed text and strip heavy inline attachment payloads so a
            // reconnect never ships multi-MB frames the renderer must parse at once.
            const replayContent = typeof msg.content === 'string' && msg.content.length > MAX_REPLAY_CONTENT_CHARS
                ? msg.content.slice(0, MAX_REPLAY_CONTENT_CHARS)
                : msg.content;
            const data = { content: replayContent, role: msg.role };
            if (msg.reasoning) {
                data.reasoning = msg.reasoning.length > MAX_REPLAY_REASONING_CHARS
                    ? msg.reasoning.slice(0, MAX_REPLAY_REASONING_CHARS)
                    : msg.reasoning;
            }
            if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
                data.attachments = ChatSessionManager._buildReplayAttachments(msg.attachments);
            }
            const event = { type, sessionId, timestamp: msg.timestamp, data };
            try {
                res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
            } catch { /* ignore */ }
        }

        return true;
    }

    /**
     * Remove an SSE client from a session.
     */
    removeSSEClient(sessionId, res) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return;
        entry.sseClients = entry.sseClients.filter(c => c !== res);
    }

    /**
     * Destroy a chat session and clean up resources.
     */
    async destroySession(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return;

        entry._destroyRequested = true;
        this._cancelQueuedRuntimeBootstrap(sessionId);

        // Auto-resolve any pending user-input requests before tearing down
        this._autoResolveAllPendingInputs(sessionId);

        // Unsubscribe events
        for (const unsub of entry.unsubscribers) {
            try { unsub(); } catch { /* ignore */ }
        }

        // Close SSE clients
        for (const client of entry.sseClients) {
            try { client.end(); } catch { /* ignore */ }
        }

        // Destroy SDK session (skip for archived sessions)
        if (entry.session) {
            try {
                await entry.session.destroy();
            } catch { /* ignore */ }
        }

        this._sessions.delete(sessionId);

        // Clean up video temp files (frames + downloaded videos) persisted for BugGenie
        if (entry._videoTempFiles && entry._videoTempFiles.length > 0) {
            for (const fp of entry._videoTempFiles) {
                try {
                    if (fs.existsSync(fp)) {
                        fs.unlinkSync(fp);
                        console.log(`[ChatManager] \u{1F5D1}\uFE0F  Cleaned video temp file: ${path.basename(fp)}`);
                    }
                } catch { /* non-critical */ }
            }
            console.log(`[ChatManager] Cleaned ${entry._videoTempFiles.length} video temp files on session destroy`);
        }

        if (entry._documentTempFiles && entry._documentTempFiles.length > 0) {
            for (const fp of entry._documentTempFiles) {
                try {
                    if (fs.existsSync(fp)) {
                        fs.unlinkSync(fp);
                        console.log(`[ChatManager] \u{1F5D1}\uFE0F  Cleaned document temp file: ${path.basename(fp)}`);
                    }
                } catch { /* non-critical */ }
            }
            console.log(`[ChatManager] Cleaned ${entry._documentTempFiles.length} document temp files on session destroy`);
        }

        // Clean up stale temp image files (older than 5 minutes)
        try {
            const tempDir = os.tmpdir();
            const staleFiles = fs.readdirSync(tempDir).filter(f => f.startsWith('copilot-img-'));
            for (const f of staleFiles) {
                const fp = path.join(tempDir, f);
                try {
                    const stat = fs.statSync(fp);
                    if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
                        fs.unlinkSync(fp);
                        console.log(`[ChatManager] \u{1F5D1}\uFE0F  Cleaned stale temp image: ${f}`);
                    }
                } catch { /* ignore individual file errors */ }
            }
        } catch { /* non-critical */ }

        // Remove the session's on-disk inline attachment store
        this._cleanupSessionAttachmentStore(sessionId);

        // Cancel any pending coalesced-delta flush timer for this session
        if (entry._sseCoalesce?.timer) {
            clearTimeout(entry._sseCoalesce.timer);
            entry._sseCoalesce.timer = null;
        }

        // Clean up followup tracking for this session
        this._followupProvider.clearSession(sessionId);

        // Persist removal to disk
        this._persistHistory();
    }

    /**
     * List all active sessions.
     */
    listSessions() {
        const sessions = [];
        let historyUpdated = false;
        for (const [sessionId, entry] of this._sessions) {
            historyUpdated = this._refreshSessionTitle(entry) || historyUpdated;
            sessions.push(this._buildSessionSnapshot(sessionId, entry));
        }
        if (historyUpdated) {
            this._persistHistory();
        }
        // Sort: active sessions first, then by creation date descending
        sessions.sort((a, b) => {
            if (a.archived !== b.archived) return a.archived ? 1 : -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        return sessions;
    }

    /**
     * Clean up all sessions.
     */
    async destroyAll() {
        for (const sessionId of this._sessions.keys()) {
            await this.destroySession(sessionId);
        }
    }

    async prepareForShutdown() {
        for (const [sessionId, entry] of this._sessions) {
            this._autoResolveAllPendingInputs(sessionId);

            for (const unsub of entry.unsubscribers || []) {
                try { unsub(); } catch { /* ignore */ }
            }
            entry.unsubscribers = [];

            for (const client of entry.sseClients || []) {
                try { client.end(); } catch { /* ignore */ }
            }
            entry.sseClients = [];

            if (entry.session && typeof entry.session.destroy === 'function') {
                try { await entry.session.destroy(); } catch { /* ignore */ }
            }

            entry.session = null;
            entry.runtimeSessionId = null;
            entry.runtimeState = entry.archived ? SESSION_RUNTIME_STATES.ARCHIVED : SESSION_RUNTIME_STATES.RESUME_REQUIRED;
        }
        this._persistHistory();
    }

    // ─── Chat History Persistence ───────────────────────────────────

    /**
     * Load persisted chat sessions from disk.
     * Sessions are restored without a live SDK runtime and can be resumed on demand.
     */
    _loadHistory() {
        try {
            if (!fs.existsSync(this._historyPath)) return;
            let content = fs.readFileSync(this._historyPath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
            const data = JSON.parse(content);

            let historyUpdated = false;
            if (Array.isArray(data.sessions)) {
                for (const saved of data.sessions) {
                    // Don't overwrite live sessions
                    if (this._sessions.has(saved.sessionId)) continue;

                    const restoredSessionContext = sanitizeSessionContextForHistory(saved.sessionId, saved.sessionContext || {});
                    const restoredSessionAttachments = sanitizeSessionAttachmentsForHistory(saved.sessionAttachments || []);
                    const restoredVideoContext = sanitizeVideoContextForHistory(saved.videoContext || []);
                    const restoredVideoTempFiles = collectVideoTempFilesFromEvidence(restoredSessionAttachments, restoredVideoContext);
                    const restoredDocumentTempFiles = collectDocumentTempFilesFromEvidence(restoredSessionAttachments);

                    const entry = {
                        session: null,
                        title: saved.title || null,
                        model: saved.model || 'gpt-4o',
                        agentId: saved.agentId || saved.agent?.id || buildCoreAgentId(saved.agentMode || null),
                        agent: saved.agent || toPublicAgentDescriptor(this._agentCatalog.getCoreAgentByMode(saved.agentMode || null)),
                        agentSelection: saved.agentSelection || null,
                        agentMode: saved.agentMode || null,
                        createdAt: saved.createdAt,
                        lastActivityAt: saved.lastActivityAt || saved.createdAt,
                        sseClients: [],
                        messages: Array.isArray(saved.messages)
                            ? saved.messages.map(message => normalizeUserInputHistoryMessage(message))
                            : [],
                        unsubscribers: [],
                        archived: !!saved.archived,
                        archivedReason: saved.archivedReason || null,
                        runtimeSessionId: null,
                        runtimeState: saved.archived
                            ? SESSION_RUNTIME_STATES.ARCHIVED
                            : (saved.runtimeState === SESSION_RUNTIME_STATES.FAILED
                                ? SESSION_RUNTIME_STATES.FAILED
                                : SESSION_RUNTIME_STATES.RESUME_REQUIRED),
                        executionState: saved.executionState || SESSION_EXECUTION_STATES.IDLE,
                        activeToolCount: 0,
                        queuePosition: 0,
                        lastError: saved.lastError || null,
                        lastEventAt: saved.lastEventAt || saved.lastActivityAt || saved.createdAt,
                        recoveryCount: saved.recoveryCount || 0,
                        recoveredFromRuntimeFailure: !!saved.recoveredFromRuntimeFailure,
                        needsRecoveryContextInjection: false,
                        recoveryContextRuntimeId: null,
                        sessionContext: {
                            ...restoredSessionContext,
                            runtimeSessionId: null,
                        },
                        pendingInputRequests: new Map(),
                        sessionAttachments: restoredSessionAttachments,
                        videoContext: restoredVideoContext,
                        pendingAssistantAttachments: [],
                        runtimeInitPromise: null,
                        _destroyRequested: false,
                        _documentTempFiles: restoredDocumentTempFiles,
                        _videoTempFiles: restoredVideoTempFiles,
                        activeToolCallIds: new Set(),
                    };

                    if (this._refreshSessionTitle(entry)) {
                        historyUpdated = true;
                    }

                    this._sessions.set(saved.sessionId, entry);
                }
                console.log(`[ChatManager] Loaded ${data.sessions.length} persisted chat session(s) from disk`);

                if (historyUpdated) {
                    this._persistHistory();
                }
            }
        } catch (error) {
            console.warn(`[ChatManager] Failed to load chat history: ${error.message}`);
        }
    }

    /**
     * Persist all sessions (active + archived) to disk.
     */
    _persistHistory() {
        try {
            const sessions = [];
            for (const [sessionId, entry] of this._sessions) {
                const persistedSessionContext = sanitizeSessionContextForHistory(sessionId, entry.sessionContext || {});
                const persistedSessionAttachments = sanitizeSessionAttachmentsForHistory(entry.sessionAttachments || []);
                const persistedVideoContext = sanitizeVideoContextForHistory(entry.videoContext || []);

                sessions.push({
                    sessionId,
                    title: entry.title || null,
                    model: entry.model,
                    agentId: entry.agentId || this._resolveEntryAgent(entry)?.id || buildCoreAgentId(entry.agentMode || null),
                    agent: this._resolveEntryAgent(entry),
                    agentSelection: entry.agentSelection || null,
                    agentMode: entry.agentMode || null,
                    createdAt: entry.createdAt,
                    lastActivityAt: entry.lastActivityAt || entry.createdAt,
                    archived: !!entry.archived,
                    archivedReason: entry.archivedReason || null,
                    runtimeState: entry.archived
                        ? SESSION_RUNTIME_STATES.ARCHIVED
                        : (entry.runtimeState === SESSION_RUNTIME_STATES.FAILED
                            ? SESSION_RUNTIME_STATES.FAILED
                            : SESSION_RUNTIME_STATES.RESUME_REQUIRED),
                    executionState: entry.executionState || SESSION_EXECUTION_STATES.IDLE,
                    lastError: entry.lastError || null,
                    lastEventAt: entry.lastEventAt || entry.lastActivityAt || entry.createdAt,
                    recoveryCount: entry.recoveryCount || 0,
                    recoveredFromRuntimeFailure: !!entry.recoveredFromRuntimeFailure,
                    sessionContext: persistedSessionContext,
                    sessionAttachments: persistedSessionAttachments,
                    videoContext: persistedVideoContext,
                    messages: entry.messages.map((message) => {
                        const normalized = normalizeUserInputHistoryMessage(message);
                        if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
                            return normalized;
                        }
                        // Drop inline base64 from attachments that already have a
                        // durable reference (url/path) so it never reaches disk.
                        return {
                            ...normalized,
                            attachments: message.attachments.map(att => this._stripPersistedAttachment(att)),
                        };
                    }),
                });
            }

            const data = {
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                sessions,
            };

            const dir = path.dirname(this._historyPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tmpPath = this._historyPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this._historyPath);
        } catch (error) {
            console.warn(`[ChatManager] Failed to persist chat history: ${error.message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    ChatSessionManager,
    CHAT_EVENTS,
    normalizeUserInputRequestPayload,
    normalizeUserInputHistoryMessage,
};
