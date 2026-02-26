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
    static VALID_AGENTS = ['testgenie', 'scriptgenerator', 'buggenie', 'taskgenie'];

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

    /**
     * Convert base64 image attachments to temp files for the Copilot SDK.
     * Returns SDK-compatible attachment objects with file paths.
     *
     * @param {Object[]} attachments - Frontend attachments: [{ type: 'image', media_type, data }]
     * @returns {{ sdkAttachments: Object[], tempFiles: string[] }}
     */
    _convertAttachmentsToTempFiles(attachments) {
        const sdkAttachments = [];
        const tempFiles = [];
        const tempDir = os.tmpdir();

        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            if (att.type !== 'image' || !att.data) continue;

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
        }

        return { sdkAttachments, tempFiles };
    }

    /**
     * Clean up temp image files after a delay (gives SDK time to read them).
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

        // ── Default: general all-capabilities prompt ──
        const parts = [
            'You are a QA Automation Assistant powered by the Copilot SDK.',
            'You help the team with test automation using Playwright and JavaScript.',
            '',
            'You have access to custom tools that let you:',
            '- Query the test framework inventory (page objects, business functions, utilities)',
            '- Retrieve historical test failures and their resolutions',
            '- Query assertion patterns and quality gate rules',
            '- Get popup handler information',
            '- Validate generated test scripts',
            '- Analyze test execution results',
            '',
            'When answering questions:',
            '- Be concise and actionable',
            '- Reference specific file paths and function names from the framework',
            '- Use the custom tools to provide accurate, data-driven answers',
            '- If asked to explore a page, use the MCP browser tools',
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
            '- When a user asks to run a test by NAME (e.g., "run planner tests", "run AOTF-16337", "execute notes module") WITHOUT providing a full path,',
            '  you MUST FIRST call `find_test_files` with the name/keyword to locate matching spec files or folders.',
            '- THEN use `execute_test` with the resolved path from the search results.',
            '- If `find_test_files` returns multiple matches, present them to the user and ask which one to run.',
            '- The `execute_test` tool also has auto-discovery: if a path is not found, it will search automatically before failing.',
            '- NEVER guess or hardcode spec file paths — always verify they exist first.',
            '',
            'CRITICAL — Test Case Generation (TestGenie):',
            '- When asked to generate test cases, you have the `fetch_jira_ticket` tool to read Jira ticket details.',
            '- You also have the `generate_test_case_excel` tool that creates a styled .xlsx file in the test-cases directory.',
            '- ALWAYS call `fetch_jira_ticket` first to get the full ticket info, THEN generate test cases using the format from copilot-instructions.',
            '- ALWAYS call `generate_test_case_excel` to save the test cases as an Excel file — do NOT just output markdown.',
            '- The Excel file is saved to: agentic-workflow/test-cases/{ticketId}-test-cases.xlsx',
            '- You have access to the Atlassian MCP server for deeper Jira integration (search, comments, issue types).',
            '',
            'CRITICAL — Bug Ticket Creation (BugGenie):',
            '- When asked to create a bug ticket or defect, you have the `create_jira_ticket` tool.',
            '- When asked for a "bug review copy" or to review test failures, use `get_test_results` to retrieve failure data.',
            '- Use the Atlassian MCP tools (atl_createJiraIssue, atl_searchJiraIssuesUsingJql, etc.) for advanced Jira operations.',
            '- Format bug tickets with: Description, Steps to Reproduce, Expected Behaviour, Actual Behaviour, Environment.',
            '- ALWAYS present the bug review copy to the user BEFORE creating the ticket in Jira.',
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
            '- Use markdown tables (|col1|col2|) for structured comparisons, feature matrices, or data.',
            '- When citing Knowledge Base sources, use blockquote format: > **Source:** [Page Title](url)',
            '- Use **bold** for key terms and `inline code` for technical identifiers.',
            '- For long supplementary content, use collapsible sections: <details><summary>Section Title</summary>Content here</details>',
            '- Keep the main answer concise; put detailed breakdowns in collapsible sections.',
            '- When explaining multi-step processes, prefer a mermaid flowchart over numbered text lists.',
        ];

        // Add copilot-instructions if available (extract critical sections, not blind truncation)
        try {
            const instructionsPath = path.join(__dirname, '..', '..', '.github', 'copilot-instructions.md');
            if (fs.existsSync(instructionsPath)) {
                const instructions = fs.readFileSync(instructionsPath, 'utf-8');
                const critical = extractCriticalInstructions(instructions);
                parts.push('', '<project_standards>', critical, '</project_standards>');
            }
        } catch { /* ignore */ }

        return parts.join('\n');
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
                // Focused: only the selected agent's tools
                tools = [...createCustomTools(this.defineTool, agentMode, toolOpts)];
                // ScriptGenerator also gets codereviewer tools (they share)
                if (agentMode === 'scriptgenerator') {
                    tools.push(...createCustomTools(this.defineTool, 'codereviewer', toolOpts));
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

        console.log(`[ChatManager] Creating session — model: ${model}, agentMode: ${agentMode || 'default'}, tools: ${tools.length}`);

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

                    // Record in message history so it replays on reconnect
                    entry.messages.push({
                        role: 'user_input_request',
                        content: question,
                        requestId,
                        options,
                        timestamp: new Date().toISOString(),
                    });

                    // Broadcast SSE event to the dashboard
                    this._broadcastToSSE(sid, CHAT_EVENTS.USER_INPUT_REQUEST, {
                        requestId,
                        question,
                        options,
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
            const needsBrowser = !agentMode || agentMode === 'scriptgenerator';
            const needsJira = !agentMode || agentMode === 'testgenie' || agentMode === 'buggenie' || agentMode === 'taskgenie';

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
                entry.messages.push({ role: 'assistant', content, timestamp: new Date().toISOString() });
                this._broadcastToSSE(sessionId, CHAT_EVENTS.MESSAGE, {
                    content,
                    messageId: event?.data?.messageId || '',
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

            // Tool execution start
            const u3 = session.on('tool.execution_start', (event) => {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.TOOL_START, {
                    toolName: event?.data?.toolName || 'unknown',
                    toolCallId: event?.data?.toolCallId || '',
                });
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

            // Reasoning (thinking)
            const u5 = session.on('assistant.reasoning_delta', (event) => {
                this._broadcastToSSE(sessionId, CHAT_EVENTS.REASONING, {
                    deltaContent: event?.data?.deltaContent || '',
                    reasoningId: event?.data?.reasoningId || '',
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
     * Resolve a pending user-input request (called when the user submits their answer
     * from the dashboard UI).
     *
     * @param {string} sessionId
     * @param {string} requestId  - Unique ID of the pending request
     * @param {string} answer     - The user's answer text
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

        // Record the user's answer in message history
        entry.messages.push({
            role: 'user_input_response',
            content: answer,
            requestId,
            timestamp: new Date().toISOString(),
        });

        // Notify dashboard clients
        this._broadcastToSSE(sessionId, CHAT_EVENTS.USER_INPUT_COMPLETE, {
            requestId,
            answer,
            auto: false,
        });

        this._persistHistory();

        // Unblock the SDK agent — resolve the Promise returned in onUserInputRequest
        pending.resolve({ answer, wasFreeform: true });

        console.log(`[ChatManager] ✅ User input resolved (${requestId}): ${answer.slice(0, 100)}`);
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
        const messageOptions = { prompt: content };

        // Convert base64 image attachments → temp files for SDK
        // The Copilot SDK only accepts { type: 'file', path } attachments,
        // NOT inline base64 data. We decode to temp files and clean up after.
        let tempFiles = [];
        if (attachments && attachments.length > 0) {
            const { sdkAttachments, tempFiles: files } = this._convertAttachmentsToTempFiles(attachments);
            tempFiles = files;
            if (sdkAttachments.length > 0) {
                messageOptions.attachments = sdkAttachments;
                console.log(`[ChatManager] \u{1F4CE} Sending ${sdkAttachments.length} image(s) as file attachments to SDK`);
            }
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
            const event = { type, sessionId, timestamp: msg.timestamp, data: { content: msg.content, role: msg.role } };
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
