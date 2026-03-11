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
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getFollowupProvider } = require('./followup-provider');

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

// Default timeout for user-input requests (5 minutes).
// If the user doesn't respond within this window, the agent receives
// an auto-generated fallback answer so it doesn't hang forever.
const USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;

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

        // Followup provider for context-aware suggestions
        this._followupProvider = getFollowupProvider();

        // ── Chat history persistence ──
        this._historyPath = path.join(
            __dirname, '..', 'test-artifacts', 'chat-history.json'
        );
        this._loadHistory();

        // Cache default system prompt (used when agentMode is null)
        this._defaultSystemPrompt = this._buildSystemPrompt(null);
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
        const tempFiles = [];
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
                    tempFiles.push(filePath);
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
                const result = await parseDocument(doc.path, { maxChars: perDocBudget });
                const text = result.text || '';
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

    /**
     * Clean up temp files after a delay (gives SDK time to read them).
     *
     * @param {string[]} tempFiles - Paths to delete
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
                const agentMdPath = path.join(__dirname, '..', '..', '.github', 'agents', `${agentMode}.agent.md`);
                if (fs.existsSync(agentMdPath)) {
                    let agentPrompt = fs.readFileSync(agentMdPath, 'utf-8');

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
                        // Dashboard-context: explicit Jira tool guidance (prevents web-scraping fallback)
                        'CRITICAL — Jira Ticket Access:',
                        '- To READ existing Jira tickets, use the `fetch_jira_ticket` custom tool or Atlassian MCP tools (atl_getJiraIssue, atl_searchJiraIssuesUsingJql).',
                        '- To CREATE new Jira tickets, use the `create_jira_ticket` custom tool or Atlassian MCP tools (atl_createJiraIssue).',
                        '- To UPDATE/EDIT existing Jira tickets (change summary, description, labels, priority, or add comments), use the `update_jira_ticket` custom tool.',
                        '- NEVER use web/fetch, fetch_webpage, or HTTP scraping to access Jira URLs — Jira is a client-rendered SPA and HTML scraping returns no useful content.',
                        '- When creating Testing tasks for Bug-type tickets, FIRST use `fetch_jira_ticket` to read the parent ticket details (summary, issue type, description, acceptance criteria), THEN create the Testing task with proper context.',
                        '',
                        'CRITICAL — Jira URL Handling:',
                        '- When the user provides a Jira ticket URL (e.g., https://corelogic.atlassian.net/browse/AOTF-16514), extract the base URL (everything before "/browse/") and pass it as the `jiraBaseUrl` parameter when calling `create_jira_ticket`.',
                        '- This ensures the returned ticket URL matches the user\'s Jira instance domain.',
                        '- Example: if user gives "https://corelogic.atlassian.net/browse/AOTF-16514", set jiraBaseUrl="https://corelogic.atlassian.net".',
                        '',
                        'CRITICAL — Testing Task Description Formatting:',
                        '- When creating Testing tasks for Bug-type parent tickets, format test cases as MARKDOWN TABLES in the description.',
                        '- Use this exact table format:',
                        '  | Test Step ID | Specific Activity or Action | Expected Results | Actual Results |',
                        '  |---|---|---|---|',
                        '  | 1.1 | Step description | Expected result | Actual result |',
                        '- Include section headings with ## for structure (e.g., ## Test Cases, ## Pre-Conditions).',
                        '- Use **bold** for section labels like **Description :-**, **Steps to Reproduce :-**.',
                        '- The description field supports rich formatting — markdown bold, headings, tables, and lists will be automatically converted to Jira\'s native format (ADF) for proper rendering.',
                        '',
                        'RESPONSE FORMATTING — Rich Markdown:',
                        '- Use ## and ### headings to structure long responses into clear sections.',
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
                    console.log(`[ChatManager] Loaded agent prompt: ${agentMode}.agent.md`);
                    return stripVSCodeToolPrefix(parts.join('\n'));
                }
            } catch (err) {
                console.warn(`[ChatManager] Failed to load ${agentMode}.agent.md: ${err.message}`);
            }
        }

        // ── TPM: unified all-capabilities prompt with agent-specific expertise ──
        const parts = [
            'You are TPM (Test Project Manager) — a unified QA Automation powerhouse powered by the Copilot SDK.',
            'You combine the full capabilities of TestGenie, ScriptGenie, BugGenie, and TaskGenie into a single session.',
            'You are running inside a web app chat session (not VS Code).',
            'Use the custom tools available to you to complete tasks.',
            '',
            '## Your Unified Capabilities',
            '| Capability | When to Activate | Key Tools |',
            '|---|---|---|',
            '| **TestGenie** — Test case generation | User asks to generate test cases, create test scenarios, or references a Jira ticket for testing | `fetch_jira_ticket`, `generate_test_case_excel`, Atlassian MCP |',
            '| **ScriptGenie** — Playwright script generation | User asks to automate, create scripts, explore pages via browser, or generate .spec.js | MCP browser tools (`navigate`, `snapshot`, `click`, etc.), `get_framework_inventory`, `validate_generated_script` |',
            '| **BugGenie** — Bug ticket creation | User asks to create bug/defect tickets, report issues, or review test failures | `create_jira_ticket`, `get_test_results`, `analyze_test_failure`, Atlassian MCP |',
            '| **TaskGenie** — Jira task creation | User asks to create Testing tasks, link tasks to tickets, or assign work | `create_jira_ticket`, `fetch_jira_ticket`, `get_jira_current_user`, Atlassian MCP |',
            '| **FileGenie** — File & document interaction | User asks to open/view files, browse folders, parse documents, organize files, or reveal files in Explorer/Finder | `open_file_native`, `open_containing_folder`, `search_files`, `parse_document`, `list_directory` |',
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
            '- To CREATE new Jira tickets, use the `create_jira_ticket` custom tool or Atlassian MCP tools (atl_createJiraIssue).',
            '- To UPDATE/EDIT existing Jira tickets (change summary, description, labels, priority, or add comments), use the `update_jira_ticket` custom tool.',
            '- NEVER use web/fetch, fetch_webpage, or HTTP scraping to access Jira URLs — Jira is a client-rendered SPA and HTML scraping returns no useful content.',
            '- When creating Testing tasks for Bug-type tickets, FIRST use `fetch_jira_ticket` to read the parent ticket details, THEN create the Testing task with proper context.',
            '',
            'CRITICAL — Jira URL Handling:',
            '- When the user provides a Jira ticket URL (e.g., https://corelogic.atlassian.net/browse/AOTF-16514), extract the base URL (everything before "/browse/") and pass it as the `jiraBaseUrl` parameter when calling `create_jira_ticket`.',
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

    /**
     * Build custom tools for chat sessions.
     * When agentMode is set, only loads tools for that specific role.
     * When null (default), loads all agent tools.
     *
     * @param {string|null} agentMode
     */
    _buildChatTools(agentMode) {
        try {
            const { createCustomTools } = require('./custom-tools');
            const toolOpts = {
                learningStore: this.learningStore,
                config: this.config,
                groundingStore: this._groundingStore || null,
                chatManager: this,
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

        const tools = this._buildChatTools(agentMode);
        const systemPrompt = agentMode ? this._buildSystemPrompt(agentMode) : this._defaultSystemPrompt;

        console.log(`[ChatManager] Creating session — model: ${model}, agentMode: ${agentMode || 'TPM'}, tools: ${tools.length}`);

        const sessionConfig = {
            model,
            tools,
            systemMessage: { content: systemPrompt },
            streaming: true,

            // Auto-approve all tool calls in chat (read-only tools are safe)
            onPermissionRequest: async () => ({ kind: 'approved' }),

            // ── User-input relay ─────────────────────────────────────────
            // When the agent calls ask_user / ask_questions the SDK invokes
            // this callback.  Instead of auto-answering we:
            //   1. Emit an SSE event so the dashboard shows an inline prompt
            //   2. Return a Promise that blocks the agent until the user responds
            //   3. Set a timeout to auto-resolve if the user doesn't respond
            onUserInputRequest: async (request) => {
                // Extract question & options from the SDK request object
                const question = request?.question || request?.message || (typeof request === 'string' ? request : JSON.stringify(request));
                const options = Array.isArray(request?.options) ? request.options : [];

                // We need the sessionId which is captured after createSession resolves.
                // This callback can only fire after session creation, so _sessions is populated.
                const sessionEntry = this._findEntryBySession(session);
                if (!sessionEntry) {
                    // Fallback if we can't locate the session (should never happen)
                    console.warn('[ChatManager] onUserInputRequest: could not locate session — auto-answering');
                    return { answer: 'Continue with the best approach based on available context.' };
                }
                const { sid, entry } = sessionEntry;

                const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                console.log(`[ChatManager] 💬 User input requested (${requestId}): ${question.slice(0, 120)}`);

                return new Promise((resolve) => {
                    // Auto-resolve timer — prevents the agent from hanging forever
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

                    // Store the pending request
                    entry.pendingInputRequests.set(requestId, { resolve, question, options, timer });

                    // Determine input type from SDK request metadata (if present)
                    const inputType = request?.type || request?.meta?.type || 'default';

                    // Record in message history so it replays on reconnect
                    entry.messages.push({
                        role: 'user_input_request',
                        content: question,
                        requestId,
                        options,
                        type: inputType,
                        timestamp: new Date().toISOString(),
                    });

                    // Broadcast SSE event to the dashboard — include type for credential UI
                    this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                        requestId,
                        question,
                        options,
                        type: inputType,
                    });

                    this._persistHistory();
                });
            },
        };

        // Add MCP servers based on agent mode
        // - Default (null): both MCP servers
        // - testgenie / buggenie: Atlassian MCP only (Jira)
        // - scriptgenerator: Unified Automation MCP only (browser)
        try {
            // Re-read .env to pick up credential changes (e.g. rotated API tokens)
            // without requiring a server restart
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

            // FileGenie doesn't need browser or Jira MCP — only filesystem tools
            if (agentMode === 'filegenie') {
                console.log(`[ChatManager] FileGenie mode — skipping MCP servers (filesystem tools only)`);
            }

            // 1. Unified Automation MCP — live browser exploration
            if (needsBrowser) {
                const mcpServerPath = path.join(__dirname, '..', 'mcp-server', 'server.js');
                if (fs.existsSync(mcpServerPath)) {
                    // Dynamic Tool Scoping: pass the agent's tool profile to the MCP server.
                    // ScriptGenerator gets 'core' (~65 tools instead of 141), saving ~25K tokens.
                    // The tools/call handler still routes ANY valid tool name regardless of
                    // listing — filtering optimizes context, not capabilities.
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

            // 2. Atlassian MCP — Jira ticket read/write
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

        // Retry once on abort/signal errors (MCP server cold-start can cause SDK timeout)
        let session;
        try {
            session = await this.client.createSession(sessionConfig);
        } catch (err) {
            const msg = err?.message || '';
            if (msg.includes('abort') || msg.includes('signal')) {
                console.warn(`[ChatManager] Session creation aborted, retrying in 2s... (${msg})`);
                await new Promise(r => setTimeout(r, 2000));
                session = await this.client.createSession(sessionConfig); // let it throw on 2nd failure
            } else {
                throw err;
            }
        }
        const sessionId = session.sessionId;
        const createdAt = new Date().toISOString();

        // Store session metadata
        this._sessions.set(sessionId, {
            session,
            model,
            agentMode,
            createdAt,
            sseClients: [],
            messages: [],
            unsubscribers: [],
            archived: false,
            pendingInputRequests: new Map(),  // requestId → { resolve, question, options, timer }
        });

        // Wire session events → SSE broadcast
        this._wireSessionEvents(sessionId, session);

        // Persist to disk
        this._persistHistory();

        // Generate welcome followups for the new session
        const welcomeFollowups = this._followupProvider.getWelcomeFollowups(agentMode || 'default');

        return { sessionId, model, createdAt, agentMode, followups: welcomeFollowups };
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
                const content = event?.data?.content || '';
                const msg = { role: 'assistant', content, timestamp: new Date().toISOString() };

                // Attach accumulated reasoning to the message (if any)
                if (reasoningBuffer.trim()) {
                    msg.reasoning = reasoningBuffer.trim();
                    msg.reasoningId = currentReasoningId;
                }
                // Reset buffer for next message
                reasoningBuffer = '';
                currentReasoningId = '';

                entry.messages.push(msg);
                this._broadcastToSSE(sessionId, CHAT_EVENTS.MESSAGE, {
                    content,
                    messageId: event?.data?.messageId || '',
                    reasoning: msg.reasoning || null,
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
                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_COMPLETE, {
                    toolName: event?.data?.toolName || 'unknown',
                    toolCallId: event?.data?.toolCallId || '',
                    success: event?.data?.success ?? true,
                    result: typeof event?.data?.result === 'string'
                        ? event.data.result.substring(0, 500)
                        : '',
                });
            });
            if (u4) unsubscribers.push(u4);

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
                this._broadcastToSSE(sessionId, CHAT_EVENTS.ERROR, {
                    error: event?.data?.message || 'Unknown error',
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
        'create_jira_ticket': { phase: 'jira', message: 'Creating Jira ticket...' },
        'update_jira_ticket': { phase: 'jira', message: 'Updating Jira ticket...' },
        'generate_test_case_excel': { phase: 'excel', message: 'Generating Excel file...' },
        'validate_generated_script': { phase: 'validation', message: 'Validating script...' },
        'run_quality_gate': { phase: 'validation', message: 'Running quality gate...' },
        'get_framework_inventory': { phase: 'framework', message: 'Scanning framework inventory...' },
        'search_project_context': { phase: 'grounding', message: 'Searching project context...' },
        'get_feature_map': { phase: 'grounding', message: 'Loading feature map...' },
        'search_knowledge_base': { phase: 'kb', message: 'Searching knowledge base...' },
        'get_knowledge_base_page': { phase: 'kb', message: 'Fetching KB page...' },
        'get_test_results': { phase: 'execution', message: 'Loading test results...' },
        'find_test_files': { phase: 'framework', message: 'Searching for test files...' },
        'get_selector_recommendations': { phase: 'grounding', message: 'Getting selector recommendations...' },
        'check_existing_coverage': { phase: 'grounding', message: 'Checking existing coverage...' },
        'get_snapshot_quality': { phase: 'validation', message: 'Analyzing snapshot quality...' },
        'analyze_test_failure': { phase: 'validation', message: 'Analyzing test failure...' },
    };

    /**
     * Look up a progress hint for a tool name. Returns { phase, message } or null.
     * @param {string} toolName
     * @returns {{ phase: string, message: string } | null}
     */
    static _getToolProgressHint(toolName) {
        return ChatSessionManager._TOOL_PROGRESS_HINTS[toolName] || null;
    }

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
     * @param {Object} [meta]   - Additional metadata: { type: 'credentials'|'password'|'default' }
     * @returns {Promise<{ answer: string|Object, wasFreeform: boolean }>}
     */
    requestUserInput(question, options = [], meta = {}) {
        // Find the best target session: prefer the most recent non-archived session with SSE clients
        let targetSid = null;
        let targetEntry = null;
        for (const [sid, entry] of this._sessions) {
            if (!entry.archived && entry.sseClients.length > 0) {
                targetSid = sid;
                targetEntry = entry;
                // Don't break — keep iterating to find the most recently created one
            }
        }
        if (!targetSid || !targetEntry) {
            console.warn('[ChatManager] requestUserInput: no active session with SSE clients — auto-answering');
            return Promise.resolve({ answer: 'skip', wasFreeform: true });
        }

        const requestId = `uir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const inputType = meta?.type || 'default';
        console.log(`[ChatManager] 💬 Programmatic user input requested (${requestId}, type=${inputType}): ${question.slice(0, 120)}`);

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
            targetEntry.pendingInputRequests.set(requestId, { resolve, question, options, timer, meta });

            // Record in message history so it replays on reconnect
            targetEntry.messages.push({
                role: 'user_input_request',
                content: question,
                requestId,
                options,
                type: inputType,
                timestamp: new Date().toISOString(),
            });

            // Broadcast SSE event to the dashboard — include type for credential UI
            this._broadcastToSSE(targetSid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                requestId,
                question,
                options,
                type: inputType,
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
        const isCredential = pending.meta?.type === 'credentials' || pending.meta?.type === 'password';
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
        if (!entry) throw new Error(`Session ${sessionId} not found`);
        if (entry.archived) throw new Error(`Session ${sessionId} is archived (read-only). Create a new session to chat.`);

        // Track user message (store attachment metadata only — no base64 in history)
        const historyMessage = { role: 'user', content, timestamp: new Date().toISOString() };
        if (attachments && attachments.length > 0) {
            historyMessage.attachmentMeta = attachments.map(att => ({
                type: att.type,
                media_type: att.media_type,
                filename: att.filename || undefined,
                size: att.data ? Math.ceil(att.data.length * 0.75) : 0, // estimated decoded size
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
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            // Cap at 20 attachments per session to prevent memory bloat
            // (supports up to 10 images per message with headroom for follow-up messages)
            if (entry.sessionAttachments.length > 20) {
                entry.sessionAttachments = entry.sessionAttachments.slice(-20);
            }
        }
        entry.messages.push(historyMessage);

        // Auto-set session title from first user message
        if (!entry.title) {
            entry.title = content.length > 60 ? content.substring(0, 57) + '...' : content;
        }

        // Persist after user message
        this._persistHistory();

        // Send to SDK session (non-blocking — response streams via events)
        // IMPORTANT: SDK MessageOptions requires { prompt }, not { content }
        let promptContent = content;

        // Convert base64 image/document attachments → temp files for SDK
        // The Copilot SDK only accepts { type: 'file', path } attachments,
        // NOT inline base64 data. We decode to temp files and clean up after.
        let tempFiles = [];
        let imageSDKAttachments = [];
        if (attachments && attachments.length > 0) {
            const { sdkAttachments, tempFiles: files, docTempFiles, videoTempFiles } = this._convertAttachmentsToTempFiles(attachments);
            tempFiles = files;

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

        const messageOptions = { prompt: promptContent };
        if (imageSDKAttachments.length > 0) {
            messageOptions.attachments = imageSDKAttachments;
            console.log(`[ChatManager] \u{1F4CE} Sending ${imageSDKAttachments.length} image(s) as file attachments to SDK`);
        }

        const messageId = await entry.session.send(messageOptions);

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
        return entry.messages;
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
        if (!entry) throw new Error(`Session ${sessionId} not found`);
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
                // Replay the prompt — mark as resolved if no longer pending
                const stillPending = entry.pendingInputRequests?.has(msg.requestId);
                const event = {
                    type: CHAT_EVENTS.USER_INPUT_REQUEST,
                    sessionId,
                    timestamp: msg.timestamp,
                    data: {
                        requestId: msg.requestId,
                        question: msg.content,
                        options: msg.options || [],
                        type: msg.type || 'default',
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
        for (const [sessionId, entry] of this._sessions) {
            sessions.push({
                sessionId,
                title: entry.title || null,
                model: entry.model,
                agentMode: entry.agentMode || null,
                createdAt: entry.createdAt,
                messageCount: entry.messages.length,
                sseClients: entry.sseClients?.length || 0,
                archived: entry.archived || false,
            });
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

    // ─── Chat History Persistence ───────────────────────────────────

    /**
     * Load archived chat sessions from disk.
     * Archived sessions have { archived: true } — they can be read but not messaged.
     */
    _loadHistory() {
        try {
            if (!fs.existsSync(this._historyPath)) return;
            let content = fs.readFileSync(this._historyPath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
            const data = JSON.parse(content);

            if (Array.isArray(data.sessions)) {
                for (const saved of data.sessions) {
                    // Don't overwrite live sessions
                    if (this._sessions.has(saved.sessionId)) continue;

                    this._sessions.set(saved.sessionId, {
                        session: null, // No live SDK session — read-only
                        title: saved.title || null,
                        model: saved.model || 'gpt-4o',
                        agentMode: saved.agentMode || null,
                        createdAt: saved.createdAt,
                        sseClients: [],
                        messages: saved.messages || [],
                        unsubscribers: [],
                        archived: true,
                    });
                }
                console.log(`[ChatManager] Loaded ${data.sessions.length} archived chat session(s) from disk`);
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
                    messages: entry.messages,
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

module.exports = { ChatSessionManager, CHAT_EVENTS };
