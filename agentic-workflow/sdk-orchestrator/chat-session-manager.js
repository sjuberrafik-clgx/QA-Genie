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
const {
    buildProjectSkillActivationGuide,
    buildProjectSkillRoutingHint,
    detectProjectSkillsForMessage,
    loadProjectSkillsCatalog,
} = require('./project-skills-catalog');

// ─── Grounding System (lazy-loaded) ─────────────────────────────────────────
let _groundingModule;
function _getGroundingModule() {
    if (_groundingModule === undefined) {
        try { _groundingModule = require('../grounding/grounding-store'); } catch { _groundingModule = null; }
    }
    return _groundingModule;
}

// ─── Instruction Extraction Helper ──────────────────────────────────────────

/**
 * Extract critical sections from copilot-instructions.md instead of blind
 * truncation.  Returns a combined string containing only the sections the
 * agent actually needs (framework patterns, import order, popup handling,
 * selector strategy, code quality targets, terminology).
 *
 * If the file changes its heading structure, the function gracefully falls
 * back to the first 12 000 characters so nothing is silently lost.
 */
function extractCriticalInstructions(fullText) {
    // Extract ONLY the compact, rule-focused sections the agent needs.
    // Deliberately EXCLUDES the giant MCP tool reference table (the pipeline
    // prompt already lists the tools it needs).  The parent heading
    // "## Automation Script Generation" is skipped because its child ###
    // sections are captured individually below — avoids pulling in the full
    // MCP table which alone is ~20 KB.
    const SECTION_HEADINGS = [
        '### Import Order',
        '### Framework Pattern',
        '### File Header Template',
        '### Selector Strategy',
        '### Popup Handling',
        '### Automation Scope',
        '### Code Quality Targets',
        '## Naming Conventions',
        '## Terminology',
    ];

    const MAX_SECTION_CHARS = 1500; // cap any single section to prevent bloat
    const sections = [];
    for (const heading of SECTION_HEADINGS) {
        const idx = fullText.indexOf(heading);
        if (idx === -1) continue;
        const level = heading.startsWith('###') ? '###' : '##';
        const rest = fullText.substring(idx + heading.length);
        const escapedLevel = level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nextHeading = rest.search(new RegExp(`^${escapedLevel} `, 'm'));
        let sectionText = nextHeading === -1
            ? fullText.substring(idx)
            : fullText.substring(idx, idx + heading.length + nextHeading);
        sectionText = sectionText.trim();
        if (sectionText.length > MAX_SECTION_CHARS) {
            sectionText = sectionText.substring(0, MAX_SECTION_CHARS) + '\n… (truncated)';
        }
        sections.push(sectionText);
    }

    if (sections.length === 0) {
        return fullText.substring(0, 6000);
    }
    return sections.join('\n\n');
}

/**
 * When running inside the SDK (web app / pipeline), MCP tool names use the
 * RAW format: unified_navigate.  The .agent.md files use the VS Code format:
 * mcp_unified-autom_unified_navigate.  Strip the prefix so the LLM calls the
 * correct tool name.
 */
function stripVSCodeToolPrefix(text) {
    return text.replace(/mcp_unified-autom_unified_/g, 'unified_');
}

function buildAtlassianRoutingHint(urlContext) {
    if (!urlContext || urlContext.atlassianUrls.length === 0) return '';

    const lines = [
        '[INTERNAL ROUTING HINT]',
        'The user message contains Atlassian URLs. Resolve them with Jira/KB tools before answering.',
    ];

    for (const jiraIssue of urlContext.jiraIssues) {
        lines.push(`- Jira issue URL detected: use fetch_jira_ticket with "${jiraIssue.issueKey}" or the full URL.`);
    }

    for (const confluencePage of urlContext.confluencePages) {
        lines.push(`- Confluence page URL detected: use get_knowledge_base_page with "${confluencePage.pageId}" or the full URL.`);
        lines.push('- Do not claim the page requires browser login when KB connector or Atlassian MCP tools are available.');
    }

    lines.push('Fetch the referenced Jira or Confluence content first, then summarize only the requested portion.');
    return lines.join('\n');
}

// Load .env for Jira credentials (Atlassian MCP auth)
// Uses override:true so updated tokens are picked up without server restart
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
    }
} catch { /* dotenv not critical — Atlassian MCP simply won't be configured */ }

// ─── Chat Event Types ───────────────────────────────────────────────────────

const CHAT_EVENTS = {
    DELTA: 'chat_delta',
    MESSAGE: 'chat_message',
    TOOL_START: 'chat_tool_start',
    TOOL_COMPLETE: 'chat_tool_complete',
    TOOL_PROGRESS: 'chat_tool_progress',
    REASONING: 'chat_reasoning',
    IDLE: 'chat_idle',
    ERROR: 'chat_error',
    FOLLOWUP: 'chat_followup',
    USER_INPUT_REQUEST: 'chat_user_input_request',
    USER_INPUT_COMPLETE: 'chat_user_input_complete',
};

const MAX_ASSISTANT_IMAGE_BYTES = 6 * 1024 * 1024;
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Default timeout for user-input requests (5 minutes).
// If the user doesn't respond within this window, the agent receives
// an auto-generated fallback answer so it doesn't hang forever.
const USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const RECOVERY_HISTORY_LIMIT = 10;
const MAX_RECOVERY_TRANSCRIPT_CHARS = 4000;
const SESSION_TITLE_MAX_LENGTH = 72;
const SESSION_TITLE_TRUNCATED_LENGTH = 69;
const GENERIC_SESSION_TITLES = new Set([
    'hi',
    'hello',
    'hey',
    'help',
    'start',
    'new chat',
    'chat',
    'session',
]);

const SESSION_RUNTIME_STATES = {
    QUEUED: 'queued',
    INITIALIZING: 'initializing',
    ACTIVE: 'active',
    RESUME_REQUIRED: 'resume_required',
    RECOVERING: 'recovering',
    FAILED: 'failed',
    ARCHIVED: 'archived',
};

const SESSION_EXECUTION_STATES = {
    IDLE: 'idle',
    RUNNING: 'running',
    WAITING_FOR_INPUT: 'waiting_for_input',
    ERROR: 'error',
};

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const USER_INPUT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_INPUT_REQUEST_ID_RE = /^uir_[a-z0-9_\-]+$/i;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isOpaqueUserInputValue(value) {
    if (!isNonEmptyString(value)) return false;
    const trimmed = value.trim();
    return USER_INPUT_UUID_RE.test(trimmed) || USER_INPUT_REQUEST_ID_RE.test(trimmed);
}

function getDefaultUserInputQuestion(inputType = 'default') {
    if (inputType === 'credentials') return 'The agent needs your username and password to continue.';
    if (inputType === 'password') return 'The agent needs your password to continue.';
    if (inputType === 'confirmation') return 'The agent needs your confirmation to continue.';
    return 'The agent needs your input to continue.';
}

function normalizeUserInputRequestPayload(rawRequest, fallbackType = 'default') {
    const requestObject = rawRequest && typeof rawRequest === 'object' && !Array.isArray(rawRequest)
        ? rawRequest
        : {};
    const nestedPayload = requestObject.options && typeof requestObject.options === 'object' && !Array.isArray(requestObject.options)
        ? requestObject.options
        : null;

    const explicitType = [
        requestObject.type,
        requestObject.meta?.type,
        requestObject.meta?.inputType,
    ].find(isNonEmptyString) || null;
    const nestedType = [
        nestedPayload?.type,
        nestedPayload?.meta?.type,
    ].find(isNonEmptyString) || null;
    const inputType = explicitType && explicitType !== 'default'
        ? explicitType
        : (nestedType || explicitType || fallbackType || 'default');

    const rawOptions = Array.isArray(requestObject.options)
        ? requestObject.options
        : Array.isArray(nestedPayload?.options)
            ? nestedPayload.options
            : [];

    const rawMeta = {
        ...(nestedPayload?.meta && typeof nestedPayload.meta === 'object' ? nestedPayload.meta : {}),
        ...(requestObject.meta && typeof requestObject.meta === 'object' ? requestObject.meta : {}),
        type: inputType,
    };

    const candidates = [
        typeof rawRequest === 'string' ? rawRequest : null,
        requestObject.question,
        requestObject.message,
        requestObject.content,
        requestObject.prompt,
        nestedPayload?.question,
        nestedPayload?.message,
        nestedPayload?.content,
        nestedPayload?.prompt,
    ].filter(isNonEmptyString).map(value => value.trim());

    let fallbackCandidate = '';
    let question = '';
    for (const candidate of candidates) {
        if (!fallbackCandidate) fallbackCandidate = candidate;
        if (!isOpaqueUserInputValue(candidate)) {
            question = candidate;
            break;
        }
    }

    if (!question) {
        question = isOpaqueUserInputValue(fallbackCandidate)
            ? getDefaultUserInputQuestion(inputType)
            : (fallbackCandidate || getDefaultUserInputQuestion(inputType));
    }

    return {
        question,
        options: rawOptions,
        type: inputType,
        meta: rawMeta,
        usedFallbackQuestion: question === getDefaultUserInputQuestion(inputType),
        nestedPayloadDetected: !!nestedPayload,
    };
}

function normalizeUserInputHistoryMessage(message) {
    if (!message || message.role !== 'user_input_request') return message;

    const normalized = normalizeUserInputRequestPayload({
        content: message.content,
        options: message.options,
        type: message.type,
        meta: message.meta,
    }, message.type || 'default');

    return {
        ...message,
        content: normalized.question,
        options: normalized.options,
        type: normalized.type,
        meta: normalized.meta,
    };
}

function normalizeSessionTitleText(value) {
    if (!isNonEmptyString(value)) return '';

    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_~>#-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripSessionTitleLeadIn(value) {
    if (!isNonEmptyString(value)) return '';

    const leadInPatterns = [
        /^please\s+/i,
        /^can you\s+/i,
        /^could you\s+/i,
        /^would you\s+/i,
        /^i need (?:you )?to\s+/i,
        /^help me\s+/i,
        /^let'?s\s+/i,
    ];

    let result = value.trim();
    for (const pattern of leadInPatterns) {
        result = result.replace(pattern, '');
    }
    return result.trim();
}

function truncateSessionTitle(value, max = SESSION_TITLE_MAX_LENGTH) {
    if (!isNonEmptyString(value) || value.length <= max) return value || '';

    const candidate = value.substring(0, SESSION_TITLE_TRUNCATED_LENGTH);
    const lastSpace = candidate.lastIndexOf(' ');
    const trimmed = lastSpace >= 32 ? candidate.substring(0, lastSpace) : candidate;
    return `${trimmed.trim()}...`;
}

function capitalizeSessionTitle(value) {
    if (!isNonEmptyString(value)) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUuidLikeTitle(value) {
    if (!isNonEmptyString(value)) return false;
    return USER_INPUT_UUID_RE.test(value.trim());
}

function isFallbackSessionTitle(value) {
    if (!isNonEmptyString(value)) return true;

    const normalized = value.trim().toLowerCase();
    if (GENERIC_SESSION_TITLES.has(normalized)) return true;
    if (isUuidLikeTitle(normalized)) return true;
    if (/^(chat|session)\s+[0-9a-f]{6,}$/i.test(normalized)) return true;
    return normalized.length < 4;
}

function buildSessionTitleCandidate(content) {
    const normalized = normalizeSessionTitleText(content);
    if (!normalized) return '';

    const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
    const stripped = stripSessionTitleLeadIn(firstSentence) || stripSessionTitleLeadIn(normalized) || normalized;
    const title = capitalizeSessionTitle(truncateSessionTitle(stripped));
    return title;
}

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

        // ── Chat history persistence ──
        this._historyPath = options.historyPath || path.join(
            __dirname, '..', 'test-artifacts', 'chat-history.json'
        );
        this._loadHistory();

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
            '| **RepoOps** — Safe git commit and push | User explicitly asks to commit/push current project changes from web app chat while excluding tests, artifacts, reports, logs, and generated outputs | `commit_and_push_repo_changes` |',
            '',
            '## Intent Detection & Agent Activation',
            'Detect the user\'s intent from their message and activate the appropriate expertise:',
            '- **Test case keywords**: "generate test cases", "test scenarios", "test steps", "excel", "test case" → Activate TestGenie expertise',
            '- **Script generation keywords**: "automate", "script", "spec.js", "explore page", "MCP", "playwright", "browser" → Activate ScriptGenie expertise',
            '- **Bug report keywords**: "bug", "defect", "issue", "failure", "broken", "not working", "create bug", "screen recording", "video recording", "recording of bug", "attached video", "video shows" → Activate BugGenie expertise',
            '- **Task creation keywords**: "task", "testing task", "assign", "link task", "create task" → Activate TaskGenie expertise',
            '- **File open/view keywords**: "open file", "open the", "launch", "view in app", "show in explorer", "reveal in finder", "open excel", "open word", "open report", "open video", "open folder", "open ppt", "open pdf" → Activate FileGenie file-opening tools',
            '- **Document/video generation keywords**: "generate video", "animation", "animated", "video walkthrough", "multimedia", "create document", "generate presentation", "create slides", "create powerpoint", "slide deck", "executive deck", "leadership deck", "stakeholder deck", "polished deck", "tier-1 deck", "meeting summary deck", "roadmap presentation", "technical review deck", "workbook to powerpoint", "workbook-to-ppt", "generate report", "infographic", "poster", "html report", "generate markdown", "create pdf", "generate pptx", "generate docx", "storyboard" → Activate DocGenie document generation expertise',
            '- **Presentation setup keywords**: "deck style", "presentation style", "ppt style", "brand deck", "configure presentation", "setup presentation", "leadership deck format" → Activate DocGenie presentation-calibration expertise before generating the deck',
            '- **Git commit keywords**: "commit and push", "git push", "push changes", "commit changes", "push repo changes", "push web app changes", "stage and push" → Activate repo commit-and-push expertise and use `commit_and_push_repo_changes`',
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
            '- When asked to RUN or EXECUTE a test script or folder, you MUST use the `execute_test` custom tool.',
            '- The `execute_test` tool accepts BOTH individual .spec.js files AND folders containing spec files.',
            '- It also accepts keywords like "planner" or "notes" — it will auto-discover the matching folder/file.',
            '- NEVER use built-in tools like `powershell`, `bash`, `terminal`, or `run_in_terminal` to execute tests.',
            '- NEVER use the MCP tool `run_playwright_code` to execute .spec.js test files.',
            '- The `execute_test` tool runs Playwright with the JSON reporter and saves structured results to the Test Reports dashboard.',
            '- Examples: execute_test({ specPath: "planner" }), execute_test({ specPath: "tests/specs/planner" }), execute_test({ specPath: "AOTF-16461.spec.js" })',
            '',
            'CRITICAL — Test file discovery:',
            '- When a user asks to run a test by NAME without providing a full path,',
            '  you MUST FIRST call `find_test_files` with the name/keyword to locate matching spec files or folders.',
            '- THEN use `execute_test` with the resolved path from the search results.',
            '- NEVER guess or hardcode spec file paths — always verify they exist first.',
            '',
            'Framework context:',
            '- Language: JavaScript (CommonJS)',
            '- Test runner: Playwright',
            '- File extension: .spec.js',
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

        const projectSkillsGuide = buildProjectSkillActivationGuide(loadProjectSkillsCatalog());
        if (projectSkillsGuide) {
            parts.push('', projectSkillsGuide);
        }

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

    /**
     * Build custom tools for chat sessions.
     * When agentMode is set, only loads tools for that specific role.
     * When null (default), loads all agent tools.
     *
     * @param {string|null} agentMode
     */
    _buildChatTools(agentMode, sessionContext = null) {
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

            let tools;
            if (agentMode && ChatSessionManager.VALID_AGENTS.includes(agentMode)) {
                // FileGenie: load filesystem tools (full access)
                if (agentMode === 'filegenie') {
                    const { createFilesystemTools } = require('./filesystem-tools');
                    tools = [...createFilesystemTools(this.defineTool, toolOpts, { readOnly: false })];
                } else {
                    // Focused: only the selected agent's tools
                    tools = [...createCustomTools(this.defineTool, agentMode, toolOpts)];
                    // ScriptGenerator also gets codereviewer tools (they share)
                    if (agentMode === 'scriptgenerator') {
                        tools.push(...createCustomTools(this.defineTool, 'codereviewer', toolOpts));
                    }
                }
                console.log(`[ChatManager] Loaded tools for agent: ${agentMode}`);
            } else {
                // Default: all agent tools merged
                tools = [
                    ...createCustomTools(this.defineTool, 'scriptgenerator', toolOpts),
                    ...createCustomTools(this.defineTool, 'codereviewer', toolOpts),
                    ...createCustomTools(this.defineTool, 'testgenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'buggenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'taskgenie', toolOpts),
                    ...createCustomTools(this.defineTool, 'docgenie', toolOpts),
                ];
                // Default (TPM) also gets read-only filesystem tools
                try {
                    const { createFilesystemTools } = require('./filesystem-tools');
                    tools.push(...createFilesystemTools(this.defineTool, toolOpts, { readOnly: true }));
                } catch (fsErr) {
                    console.warn(`[ChatManager] Filesystem tools not available for TPM: ${fsErr.message}`);
                }
            }
            // Deduplicate by tool name
            const seen = new Set();
            return tools.filter(t => {
                const name = t.name || t.definition?.name || '';
                if (seen.has(name)) return false;
                seen.add(name);
                return true;
            });
        } catch (error) {
            console.warn(`[ChatManager] Failed to load custom tools: ${error.message}`);
            return [];
        }
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
                const { session, sessionContext } = await this._createRuntimeSession({
                    appSessionId: sessionId,
                    model: entry.model,
                    agentMode: entry.agentMode,
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
        return {
            sessionId,
            title,
            model: entry.model,
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
            activeProjectSkills: Array.isArray(entry.sessionContext?.latestProjectSkillMatches)
                ? entry.sessionContext.latestProjectSkillMatches.slice(0, 3)
                : [],
            latestProjectSkillMatchedAt: entry.sessionContext?.latestProjectSkillMatchedAt || null,
        };
    }

    _buildRecoveryTranscript(entry, limit = RECOVERY_HISTORY_LIMIT) {
        const transcript = entry.messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .slice(-limit - 1, -1)
            .map(msg => {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                const content = String(msg.content || '').trim();
                if (!content) return null;
                return `${role}: ${content}`;
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

    async _createRuntimeSession({ appSessionId, model, agentMode, existingContext = null }) {
        const sessionContext = {
            latestUserMessageId: null,
            latestUserMessageTimestamp: null,
            activeEvidenceMessageId: null,
            activeEvidenceTimestamp: null,
            ...(existingContext && typeof existingContext === 'object' ? existingContext : {}),
            sessionId: appSessionId,
        };
        const tools = this._buildChatTools(agentMode, sessionContext);
        const systemPrompt = this._buildSystemPrompt(agentMode);

        console.log(`[ChatManager] Creating runtime session — appSessionId: ${appSessionId}, model: ${model}, agentMode: ${agentMode || 'TPM'}, tools: ${tools.length}`);

        let session;
        const sessionConfig = {
            model,
            tools,
            systemMessage: { content: systemPrompt },
            streaming: true,
            onPermissionRequest: async () => ({ kind: 'approved' }),
            onUserInputRequest: async (request) => {
                const normalizedRequest = normalizeUserInputRequestPayload(request);
                const { question, options, type: inputType, meta: requestMeta, usedFallbackQuestion, nestedPayloadDetected } = normalizedRequest;
                if (usedFallbackQuestion || nestedPayloadDetected) {
                    console.warn('[ChatManager] onUserInputRequest received a malformed payload; normalized before broadcasting');
                }

                const sessionEntry = this._findEntryBySession(session);
                if (!sessionEntry) {
                    console.warn('[ChatManager] onUserInputRequest: could not locate session — auto-answering');
                    return { answer: 'Continue with the best approach based on available context.' };
                }
                const { sid, entry } = sessionEntry;

                const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                console.log(`[ChatManager] 💬 User input requested (${requestId}): ${question.slice(0, 120)}`);

                return new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        if (entry.pendingInputRequests.has(requestId)) {
                            console.log(`[ChatManager] ⏱️ User input timed out (${requestId}) — auto-resolving`);
                            entry.pendingInputRequests.delete(requestId);
                            this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                                requestId,
                                answer: 'Continue with the best approach based on available context.',
                                auto: true,
                            });
                            resolve({ answer: 'Continue with the best approach based on available context.', wasFreeform: true });
                        }
                    }, USER_INPUT_TIMEOUT_MS);

                    entry.pendingInputRequests.set(requestId, { resolve, question, options, timer, meta: requestMeta, type: inputType });

                    entry.messages.push({
                        role: 'user_input_request',
                        content: question,
                        requestId,
                        options,
                        type: inputType,
                        meta: requestMeta,
                        timestamp: new Date().toISOString(),
                    });

                    this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                        requestId,
                        question,
                        options,
                        type: inputType,
                        meta: requestMeta,
                    });

                    this._persistHistory();
                });
            },
        };

        try {
            try {
                const envPath = path.join(__dirname, '..', '.env');
                if (fs.existsSync(envPath)) {
                    require('dotenv').config({ path: envPath, override: true });
                }
            } catch { /* non-critical */ }

            const mcpServers = {};
            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
            const needsBrowser = explorationEnabled && (!agentMode || agentMode === 'scriptgenerator');
            const needsJira = !agentMode || agentMode === 'testgenie' || agentMode === 'buggenie' || agentMode === 'taskgenie';

            if (agentMode === 'filegenie') {
                console.log('[ChatManager] FileGenie mode — skipping MCP servers (filesystem tools only)');
            }

            if (needsBrowser) {
                const mcpServerPath = path.join(__dirname, '..', 'mcp-server', 'server.js');
                if (fs.existsSync(mcpServerPath)) {
                    const AGENT_PROFILES = { scriptgenerator: 'core', testgenie: 'core', buggenie: 'core', codereviewer: 'core', taskgenie: 'core' };
                    const toolProfile = AGENT_PROFILES[agentMode] || 'full';
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
                            MCP_TOOL_PROFILE: toolProfile,
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
                        tools: ['*'],
                    };
                    console.log(`[ChatManager] 🔗 Atlassian MCP enabled for ${agentMode || 'default'} (JIRA_EMAIL + JIRA_API_TOKEN)`);
                } else {
                    console.warn(`[ChatManager] ⚠️ Atlassian MCP NOT configured for ${agentMode || 'default'} — JIRA_EMAIL or JIRA_API_TOKEN missing. Agent will rely on fetch_jira_ticket / create_jira_ticket custom tools (REST API fallback).`);
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

            const { session, sessionContext } = await this._createRuntimeSession({
                appSessionId: sessionId,
                model: entry.model,
                agentMode: entry.agentMode,
                existingContext: entry.sessionContext,
            });

            entry.session = session;
            entry.sessionContext = sessionContext;
            entry.runtimeSessionId = session.sessionId;
            entry.runtimeState = SESSION_RUNTIME_STATES.ACTIVE;
            entry.recoveredFromRuntimeFailure = true;
            entry.recoveryCount = (entry.recoveryCount || 0) + 1;
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
                const recoveredOptions = {
                    ...messageOptions,
                    prompt: this._buildRecoveredPrompt(entry, messageOptions.prompt),
                };
                return sendCurrentRuntime(recoveredOptions);
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
     * @param {string|null} [options.agentMode] - Agent mode: null (default), 'testgenie', 'scriptgenerator', 'buggenie', 'taskgenie'
     * @returns {Promise<{ sessionId, model, createdAt, agentMode }>}
     */
    async createSession(options = {}) {
        const model = options.model || this.model;
        const agentMode = options.agentMode || null;

        // Validate agentMode
        if (agentMode && !ChatSessionManager.VALID_AGENTS.includes(agentMode)) {
            throw new Error(`Invalid agentMode: ${agentMode}. Valid: ${ChatSessionManager.VALID_AGENTS.join(', ')}`);
        }
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
            latestProjectSkillMatches: [],
            latestProjectSkillMatchedAt: null,
        };

        // Store session metadata
        const entry = {
            session: null,
            runtimeSessionId: null,
            model,
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
            pendingInputRequests: new Map(),  // requestId → { resolve, question, options, timer }
            sessionAttachments: [],
            pendingAssistantAttachments: [],
            runtimeInitPromise: null,
            _destroyRequested: false,
            _documentTempFiles: [],
            activeToolCallIds: new Set(),
        };

        this._sessions.set(sessionId, entry);

        // Persist to disk
        this._persistHistory();

        // Start runtime creation in the background so the UI gets a session immediately.
        void this._enqueueRuntimeBootstrap(sessionId, entry);

        // Generate welcome followups for the new session
        const welcomeFollowups = this._followupProvider.getWelcomeFollowups(agentMode || 'default');

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
                        agentMode: entry.agentMode,
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
                        agentMode: entry.agentMode,
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

        const event = {
            type,
            sessionId,
            timestamp: new Date().toISOString(),
            data,
        };

        // Emit to EventEmitter listeners
        this.emit('event', event);
        this.emit(`event:${sessionId}`, event);

        // Write to SSE response objects
        const ssePayload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
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

    /**
     * Publish a local image file into the chat transcript as an assistant message.
     * The frontend already knows how to render message.attachments when provided
     * with a data URL, so this bridges tool-generated screenshots back to chat.
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

        const buffer = fs.readFileSync(filePath);
        const attachment = {
            id: `assistant_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: path.basename(filePath),
            type: mimeType,
            size: stat.size,
            kind: 'image',
            alt: String(options.altText || '').trim() || path.basename(filePath),
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        };

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

        // Find the best target session: prefer the most recent non-archived session with SSE clients
        let targetSid = null;
        let targetEntry = null;
        if (preferredSessionId) {
            const preferredEntry = this._sessions.get(preferredSessionId);
            if (preferredEntry && !preferredEntry.archived && preferredEntry.sseClients.length > 0) {
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
            console.warn('[ChatManager] requestUserInput: no active session with SSE clients — auto-answering');
            return Promise.resolve({
                answer: inputType === 'credentials' ? 'skip' : 'Continue with the best approach based on available context.',
                wasFreeform: true,
            });
        }

        const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        console.log(`[ChatManager] 💬 Programmatic user input requested (${requestId}, type=${inputType}): ${promptQuestion.slice(0, 120)}`);

        return new Promise((resolve) => {
            // Auto-resolve timer — prevents hanging forever
            const timer = setTimeout(() => {
                if (targetEntry.pendingInputRequests.has(requestId)) {
                    console.log(`[ChatManager] ⏱️ Programmatic user input timed out (${requestId}) — auto-resolving`);
                    targetEntry.pendingInputRequests.delete(requestId);
                    this._broadcastToSSE(targetSid, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                        requestId,
                        answer: inputType === 'credentials' ? 'skip' : 'Continue with the best approach based on available context.',
                        auto: true,
                    });
                    resolve({
                        answer: inputType === 'credentials' ? 'skip' : 'Continue with the best approach based on available context.',
                        wasFreeform: true,
                    });
                }
            }, USER_INPUT_TIMEOUT_MS);

            // Store the pending request (include meta for credential awareness in resolveUserInput)
            targetEntry.pendingInputRequests.set(requestId, {
                resolve,
                question: promptQuestion,
                options: promptOptions,
                timer,
                meta,
                type: inputType,
            });

            // Record in message history so it replays on reconnect
            targetEntry.messages.push({
                role: 'user_input_request',
                content: promptQuestion,
                requestId,
                options: promptOptions,
                type: inputType,
                meta,
                timestamp: new Date().toISOString(),
            });

            // Broadcast SSE event to the dashboard — include type for credential UI
            this._broadcastToSSE(targetSid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                requestId,
                question: promptQuestion,
                options: promptOptions,
                type: inputType,
                meta,
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
            this._broadcastToSSE(sessionId, CHAT_EVENTS.USER_INPUT_COMPLETE, {
                requestId,
                answer: 'Continue with the best approach based on available context.',
                auto: true,
            });
            pending.resolve({ answer: 'Continue with the best approach based on available context.', wasFreeform: true });
            console.log(`[ChatManager] ⏩ Auto-resolved pending input (${requestId}) due to abort/destroy`);
        }
        entry.pendingInputRequests.clear();
    }

    /**
     * Send a user message to a chat session.
     *
     * @param {string} sessionId
     * @param {string} content
     * @param {Object[]} [attachments]
     * @returns {Promise<{ messageId }>}
     */
    async sendMessage(sessionId, content, attachments) {
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
            if (entry.sessionAttachments.length > 30) {
                entry.sessionAttachments = entry.sessionAttachments.slice(-30);
            }
        }
        entry.messages.push(historyMessage);

        this._refreshSessionTitle(entry);

        // Persist after user message
        this._persistHistory();

        // Send to SDK session (non-blocking — response streams via events)
        // IMPORTANT: SDK MessageOptions requires { prompt }, not { content }
        let promptContent = content;
        const attachmentRoutingText = Array.isArray(attachments)
            ? attachments
                .map(attachment => attachment?.filename || attachment?.displayName || attachment?.url || '')
                .filter(Boolean)
                .join(' ')
            : '';
        const skillRoutingMatches = detectProjectSkillsForMessage(
            `${content || ''} ${attachmentRoutingText}`,
            loadProjectSkillsCatalog(),
        );
        if (entry.sessionContext) {
            entry.sessionContext.latestUserMessageId = userMessageId;
            entry.sessionContext.latestUserMessageTimestamp = userMessageTimestamp;
            if (hasAttachableEvidence) {
                entry.sessionContext.activeEvidenceMessageId = userMessageId;
                entry.sessionContext.activeEvidenceTimestamp = userMessageTimestamp;
            }
            entry.sessionContext.latestAtlassianUrlContext = atlassianUrlContext;
            entry.sessionContext.latestProjectSkillMatches = skillRoutingMatches.slice(0, 3).map(match => ({
                id: match.id,
                name: match.name,
                folderName: match.folderName,
                score: match.score,
                matchedKeywords: match.matchedKeywords,
                matchedPhrases: match.matchedPhrases,
                matchedTokens: match.matchedTokens,
            }));
            entry.sessionContext.latestProjectSkillMatchedAt = skillRoutingMatches.length > 0
                ? userMessageTimestamp
                : null;
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

        const routingHints = [];
        if (atlassianUrlContext.atlassianUrls.length > 0) {
            routingHints.push(buildAtlassianRoutingHint(atlassianUrlContext));
        }

        const projectSkillHint = buildProjectSkillRoutingHint(
            `${content || ''} ${attachmentRoutingText}`,
            loadProjectSkillsCatalog(),
        );
        if (projectSkillHint) {
            routingHints.push(projectSkillHint);
        }

        if (routingHints.length > 0) {
            promptContent = `${routingHints.filter(Boolean).join('\n\n')}\n\n${promptContent}`;
        }

        const messageOptions = { prompt: promptContent };
        if (imageSDKAttachments.length > 0) {
            messageOptions.attachments = imageSDKAttachments;
            console.log(`[ChatManager] \u{1F4CE} Sending ${imageSDKAttachments.length} image(s) as file attachments to SDK`);
        }

        const messageId = await this._sendRuntimeMessage(sessionId, entry, messageOptions, true);

        // Schedule temp file cleanup (60s delay to ensure SDK has read them)
        this._scheduleCleanup(tempFiles);

        return {
            messageId,
            session: this._buildSessionSnapshot(sessionId, entry),
        };
    }

    /**
     * Get conversation history for a session.
     * Returns the locally curated messages array (user + assistant text only),
     * NOT the raw SDK events which include 60+ internal event types.
     */
    async getHistory(sessionId) {
        const entry = this._sessions.get(sessionId);
        if (!entry) throw new Error(`Session ${sessionId} not found`);
        return entry.messages.map(message => normalizeUserInputHistoryMessage(message));
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
            agentMode: entry.agentMode,
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
    }

    /**
     * Register an SSE client (HTTP response) for a session.
     */
    addSSEClient(sessionId, res) {
        const entry = this._sessions.get(sessionId);
        if (!entry) return false;

        entry.sseClients.push(res);

        // Send recent messages as replay
        for (const msg of entry.messages.slice(-20)) {
            // Map special roles to their dedicated event types
            let type;
            if (msg.role === 'user') {
                type = 'user_message';
            } else if (msg.role === 'user_input_request') {
                const normalizedMsg = normalizeUserInputHistoryMessage(msg);
                // Replay the prompt — mark as resolved if no longer pending
                const stillPending = entry.pendingInputRequests?.has(normalizedMsg.requestId);
                const event = {
                    type: CHAT_EVENTS.USER_INPUT_REQUEST,
                    sessionId,
                    timestamp: normalizedMsg.timestamp,
                    data: {
                        requestId: normalizedMsg.requestId,
                        question: normalizedMsg.content,
                        options: normalizedMsg.options || [],
                        type: normalizedMsg.type || 'default',
                        meta: normalizedMsg.meta || {},
                        resolved: !stillPending,
                    },
                };
                try { res.write(`event: ${CHAT_EVENTS.USER_INPUT_REQUEST}\ndata: ${JSON.stringify(event)}\n\n`); } catch { /* ignore */ }
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
            const data = { content: msg.content, role: msg.role };
            if (msg.reasoning) data.reasoning = msg.reasoning;
            if (Array.isArray(msg.attachments) && msg.attachments.length > 0) data.attachments = msg.attachments;
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

                    const entry = {
                        session: null,
                        title: saved.title || null,
                        model: saved.model || 'gpt-4o',
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
                        sessionContext: {
                            sessionId: saved.sessionId,
                            runtimeSessionId: null,
                            latestUserMessageId: null,
                            latestUserMessageTimestamp: null,
                            activeEvidenceMessageId: null,
                            activeEvidenceTimestamp: null,
                        },
                        pendingInputRequests: new Map(),
                        sessionAttachments: [],
                        pendingAssistantAttachments: [],
                        runtimeInitPromise: null,
                        _destroyRequested: false,
                        _documentTempFiles: [],
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
                sessions.push({
                    sessionId,
                    title: entry.title || null,
                    model: entry.model,
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
                    messages: entry.messages.map(message => normalizeUserInputHistoryMessage(message)),
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
