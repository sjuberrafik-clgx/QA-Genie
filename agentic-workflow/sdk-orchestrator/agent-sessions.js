/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT SESSION FACTORY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates pre-configured Copilot SDK sessions for each agent role.
 * Each session gets role-specific system messages, custom tools, MCP servers,
 * and enforcement hooks — replacing the .agent.md prompt-engineering approach
 * with structurally enforced, code-driven orchestration.
 *
 * @module agent-sessions
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { createCustomTools } = require('./custom-tools');
const { createEnforcementHooks, createCognitiveEnforcementHooks, COGNITIVE_PHASE_RULES } = require('./enforcement-hooks');
const { getContextEngine } = require('./context-engine');
const { buildSharedLayers } = require('./prompt-layers');

// Grounding system — provides local context to reduce LLM hallucinations
let _groundingStoreModule;
function getGroundingModule() {
    if (!_groundingStoreModule) {
        try { _groundingStoreModule = require('../grounding/grounding-store'); } catch { _groundingStoreModule = null; }
    }
    return _groundingStoreModule;
}

// ─── Cognitive Role Mapper ──────────────────────────────────────────────────

/**
 * Map cognitive phase agent names to their base role for prompt loading,
 * MCP gating, custom tool registration, and dynamic context injection.
 * Cognitive agents inherit all capabilities of their base role but receive
 * phase-specific system prompts and enforcement hooks.
 */
const COGNITIVE_ROLE_MAP = {
    'cognitive-analyst': 'scriptgenerator',
    'cognitive-explorer-nav': 'scriptgenerator',
    'cognitive-explorer-interact': 'scriptgenerator',
    'cognitive-coder': 'scriptgenerator',
    'cognitive-reviewer': 'codereviewer',
    'cognitive-dryrun': 'scriptgenerator',
};

function getCognitiveBaseRole(agentName) {
    return COGNITIVE_ROLE_MAP[agentName] || null;
}

function isCognitiveAgent(agentName) {
    return agentName?.startsWith('cognitive-') && !!COGNITIVE_ROLE_MAP[agentName];
}

// ─── Agent Prompt Loader ────────────────────────────────────────────────────

/**
 * Load the body content from an agent .md file, stripping the chatagent frontmatter.
 * Falls back to a minimal prompt if the file is missing.
 */
function loadAgentPrompt(agentName) {
    const agentDir = path.join(__dirname, '..', '..', '.github', 'agents');
    const agentFile = path.join(agentDir, `${agentName}.agent.md`);

    if (!fs.existsSync(agentFile)) {
        return `You are the ${agentName} agent. Follow the project's automation standards.`;
    }

    const raw = fs.readFileSync(agentFile, 'utf-8');

    // Strip chatagent frontmatter (```chatagent\n---\n...\n---\n)
    // The file may start with ```chatagent or ````chatagent
    let body = raw;
    const fmMatch = raw.match(/^[`]{3,}chatagent\s*\n---[\s\S]*?---\s*\n/);
    if (fmMatch) {
        body = raw.slice(fmMatch[0].length);
    }

    // Trim trailing ``` if present
    body = body.replace(/\n[`]{3,}\s*$/, '').trim();

    return body;
}

/**
 * Build a dynamic context block injected into the system message.
 * Includes framework inventory, learning history, ticket context.
 */
function buildDynamicContext(agentName, options = {}) {
    const sections = [];

    // Framework inventory (for scriptgenerator and codereviewer)
    if (['scriptgenerator', 'codereviewer'].includes(agentName) && options.frameworkInventory) {
        sections.push(
            '<framework_inventory>',
            options.frameworkInventory,
            '</framework_inventory>'
        );
    }

    // Historical failure context (for scriptgenerator and self-healing sessions)
    if (options.historicalContext) {
        sections.push(
            '<historical_failures>',
            'The following failures have been recorded from previous runs. Avoid repeating these mistakes:',
            options.historicalContext,
            '</historical_failures>'
        );
    }

    // Ticket-specific context (test cases from TestGenie, exploration data, etc.)
    if (options.ticketContext) {
        sections.push(
            '<ticket_context>',
            options.ticketContext,
            '</ticket_context>'
        );
    }

    // Assertion config (for scriptgenerator)
    if (options.assertionConfig) {
        sections.push(
            '<assertion_patterns>',
            options.assertionConfig,
            '</assertion_patterns>'
        );
    }

    // Grounding context — domain terminology, project rules, relevant code chunks
    if (options.groundingContext) {
        sections.push(
            '<grounding_context>',
            options.groundingContext,
            '</grounding_context>'
        );
    }

    // Knowledge base context — external documentation (Confluence, Notion, etc.)
    // This section is for standalone KB context injection (outside of grounding)
    if (options.kbContext && !options.groundingContext?.includes('KNOWLEDGE BASE:')) {
        sections.push(
            '<knowledge_base_context>',
            options.kbContext,
            '</knowledge_base_context>'
        );
    }

    return sections.length > 0 ? '\n\n' + sections.join('\n') : '';
}

// ─── Agent Session Factory ──────────────────────────────────────────────────

class AgentSessionFactory {
    /**
     * @param {Object} options
     * @param {Object} options.client       - CopilotClient instance
     * @param {Function} options.defineTool  - defineTool function from SDK
     * @param {string} options.model         - Default model
     * @param {Object} [options.provider]    - BYOK provider config
     * @param {Object} options.config        - Full workflow-config.json
     * @param {Object} [options.learningStore] - Learning store instance
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        this.client = options.client;
        this.defineTool = options.defineTool;
        this.model = options.model;
        this.provider = options.provider || null;
        this.config = options.config;
        this.learningStore = options.learningStore || null;
        this.verbose = options.verbose || false;

        // Initialize grounding store if enabled
        this._groundingStore = null;
        this._kbInitPromise = null;
        const groundingEnabled = options.config?.sdk?.grounding?.enabled !== false;
        if (groundingEnabled) {
            const gMod = getGroundingModule();
            if (gMod) {
                try {
                    this._groundingStore = gMod.getGroundingStore({
                        projectRoot: path.join(__dirname, '..', '..'),
                        verbose: this.verbose,
                    });
                    this._log('📚 GroundingStore initialized');

                    // Initialize Knowledge Base connector (async, non-blocking)
                    const kbEnabled = options.config?.sdk?.grounding?.knowledgeBase?.enabled !== false;
                    if (kbEnabled && this._groundingStore) {
                        this._kbInitPromise = this._groundingStore.initKnowledgeBase().catch(err => {
                            this._log(`⚠️ KB connector init failed: ${err.message}`);
                        });
                    }
                } catch (err) {
                    this._log(`⚠️ GroundingStore init failed: ${err.message}`);
                }
            }
        }

        // Track active sessions for cleanup
        this._activeSessions = new Map();
    }

    /**
     * Create a session for a specific agent role.
     *
     * @param {string} agentName - 'testgenie' | 'scriptgenerator' | 'codereviewer' | 'buggenie'
     * @param {Object} [context]  - Dynamic context for this session
     * @param {string} [context.ticketId]
     * @param {string} [context.ticketContext]
     * @param {string} [context.frameworkInventory]
     * @param {string} [context.historicalContext]
     * @param {string} [context.assertionConfig]
     * @param {Object} [context.contextStore] - SharedContextStore for agent collaboration
     * @param {Object} [context.groundingStore] - GroundingStore for local context
     * @param {string} [context.taskDescription] - Task description for grounding query
     * @returns {Promise<Object>} { session, sessionId, agentName }
     */
    async createAgentSession(agentName, context = {}) {
        this._log(`Creating ${agentName} session...`);

        // Resolve cognitive agent names to their base role
        const baseRole = getCognitiveBaseRole(agentName);
        const effectiveRole = baseRole || agentName;
        const isCognitive = !!baseRole;

        if (isCognitive) {
            this._log(`🧠 Cognitive agent '${agentName}' → base role '${effectiveRole}'`);
        }

        // 1. Load the system prompt — prefer phase-specific override, else load from .agent.md
        const basePrompt = context.systemPromptOverride || loadAgentPrompt(effectiveRole);

        // 2. Build grounding context if available
        let groundingContext = null;
        const gStore = context.groundingStore || this._groundingStore;
        if (gStore) {
            try {
                // 2a. Fetch KB context asynchronously (if available)
                let kbContext = null;
                const kbEnabled = this.config?.sdk?.grounding?.knowledgeBase?.enabled !== false;
                if (kbEnabled) {
                    // Wait for KB init to complete if it's still initializing
                    if (this._kbInitPromise) {
                        await this._kbInitPromise;
                        this._kbInitPromise = null;
                    }
                    const taskDesc = context.taskDescription || context.ticketContext || '';
                    if (taskDesc) {
                        try {
                            kbContext = await gStore.buildKBContext(taskDesc, {
                                agentName,
                                maxChars: this.config?.sdk?.grounding?.knowledgeBase?.maxContextChars || 4000,
                            });
                            if (kbContext) {
                                this._log(`📖 KB context: ${kbContext.length} chars for ${agentName}`);
                            }
                        } catch (kbErr) {
                            this._log(`⚠️ KB context fetch failed: ${kbErr.message}`);
                        }
                    }
                }

                groundingContext = gStore.buildGroundingContext(effectiveRole, {
                    taskDescription: context.taskDescription || context.ticketContext || '',
                    ticketId: context.ticketId || null,
                    kbContext,
                });
                this._log(`📚 Grounding context: ${groundingContext.length} chars for ${agentName}`);
            } catch (err) {
                this._log(`⚠️ Grounding context failed: ${err.message}`);
            }
        }

        // 2b. Build dynamic context injection (includes grounding)
        const dynamicCtx = buildDynamicContext(effectiveRole, {
            ...context,
            groundingContext,
        });

        // 2c. Inject shared context summary if available
        let sharedCtx = '';
        if (context.contextStore) {
            sharedCtx = context.contextStore.buildContextSummary(agentName);
        }

        // 3. Get role-specific custom tools (with context store and grounding store)
        const tools = createCustomTools(this.defineTool, effectiveRole, {
            learningStore: this.learningStore,
            config: this.config,
            contextStore: context.contextStore || null,
            groundingStore: gStore || null,
        });

        // 4. Get role-specific enforcement hooks
        const hooks = isCognitive
            ? createCognitiveEnforcementHooks(agentName, { verbose: this.verbose })
            : createEnforcementHooks(agentName, {
                config: this.config,
                learningStore: this.learningStore,
                groundingStore: gStore || null,
                verbose: this.verbose,
            });

        // 5. Build MCP server config
        const mcpServers = {};

        // MCP server: attach for scriptgenerator AND cognitive phases that need MCP
        // Respects MCP_EXPLORATION_ENABLED from .env — when 'false', no MCP server is attached.
        const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
        const needsMCP = explorationEnabled && context.disableMCP !== true && (
            (!isCognitive && ['scriptgenerator'].includes(agentName)) ||
            (isCognitive && COGNITIVE_PHASE_RULES[agentName]?.allowMCP)
        );
        if (needsMCP) {
            // CRITICAL: Pass environment variables to the MCP child process.
            // Without explicit env passthrough, the spawned process does NOT inherit
            // MCP_HEADLESS, MCP_TIMEOUT, etc. from .env — the browser always launches
            // with hardcoded defaults (headed mode), which hangs in headless/CI contexts.
            // Default to 'true' (headless) as safe server-side fallback; .env overrides this.
            const mcpHeadless = process.env.MCP_HEADLESS || 'true';
            // Dynamic Tool Scoping: pass the agent's tool profile to the MCP server.
            // ScriptGenerator gets 'core' (~65 tools instead of 141), saving ~25K tokens.
            const AGENT_PROFILES = { scriptgenerator: 'core', testgenie: 'core', buggenie: 'core', codereviewer: 'core', docgenie: 'core' };
            const toolProfile = context.toolProfile || AGENT_PROFILES[effectiveRole] || 'full';
            this._log(`🖥️  Unified MCP: headless=${mcpHeadless}, browser=${process.env.MCP_BROWSER || 'chromium'}, toolProfile=${toolProfile}`);
            mcpServers['unified-automation'] = {
                type: 'local',
                command: 'node',
                args: [path.join(__dirname, '..', 'mcp-server', 'server.js')],
                tools: ['*'],
                env: {
                    MCP_HEADLESS: mcpHeadless,
                    MCP_TIMEOUT: process.env.MCP_TIMEOUT || '60000',
                    MCP_BROWSER: process.env.MCP_BROWSER || 'chromium',
                    MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT || '120000',
                    MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'info',
                    MCP_TOOL_PROFILE: toolProfile,
                },
            };
        }

        // TestGenie/BugGenie: Atlassian MCP for Jira integration.
        // Uses JIRA_EMAIL + JIRA_API_TOKEN (Basic auth). When not set, agents fall
        // back to the fetch_jira_ticket / create_jira_ticket custom tools (REST API).
        const jiraEmail = process.env.JIRA_EMAIL || '';
        const jiraApiToken = process.env.JIRA_API_TOKEN || '';
        if (['testgenie', 'buggenie'].includes(agentName) && jiraEmail && jiraApiToken) {
            const basicAuth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
            mcpServers['atlassian/atlassian-mcp-server'] = {
                type: 'http',
                url: 'https://mcp.atlassian.com/v1/sse',
                headers: { authorization: `Basic ${basicAuth}` },
                tools: ['*'],
            };
            this._log(`🔗 Atlassian MCP enabled for ${agentName} (JIRA_EMAIL + JIRA_API_TOKEN)`);
        }

        // 6. Build session config
        // ── CONTEXT ENGINE: PRIORITY-AWARE PACKING ─────────────────────
        // Uses the ContextEngine to pack components by priority into the budget.
        // High-priority components (grounding, ticket context) are preserved;
        // low-priority components are compressed or dropped intelligently.
        const contextEngine = getContextEngine(
            this.config?.contextEngineering || this.config?.sdk?.contextEngineering || {}
        );
        const contextEngineEnabled = contextEngine.config.enabled;

        let assembledPrompt;

        if (contextEngineEnabled) {
            // Inject shared prompt layers (deduplication)
            const sharedLayers = buildSharedLayers(effectiveRole);
            const enrichedBasePrompt = basePrompt + '\n\n---\n\n' + sharedLayers;

            // Priority-aware packing replaces the blunt truncation guard
            const packResult = contextEngine.packContext(effectiveRole, {
                basePrompt: enrichedBasePrompt,
                ticketContext: context.ticketContext || '',
                groundingContext: groundingContext || '',
                frameworkInventory: context.frameworkInventory || '',
                assertionConfig: context.assertionConfig || '',
                historicalFailures: context.historicalContext || '',
                kbContext: context.kbContext || '',
                sharedContext: sharedCtx || '',
            });

            assembledPrompt = packResult.assembledPrompt;
            this._log(`📦 Context packed: ${packResult.metrics.utilization} used | ` +
                `${packResult.included.length} included, ${packResult.compressed.length} compressed, ` +
                `${packResult.dropped.length} dropped | saved ~${packResult.metrics.charsSaved} chars`);

            if (packResult.dropped.length > 0) {
                this._log(`⚠️ Dropped: ${packResult.dropped.map(d => d.key).join(', ')}`);
            }
        } else {
            // Legacy mode: simple concatenation with blunt truncation
            const MAX_SYSTEM_PROMPT_CHARS = 120_000;
            assembledPrompt = basePrompt + dynamicCtx + sharedCtx;

            if (assembledPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
                this._log(`⚠️ System prompt too large (${assembledPrompt.length} chars). Using legacy truncation...`);
                const truncatedSections = [];
                if (context.frameworkInventory) {
                    const lines = context.frameworkInventory.split('\n');
                    const pathsOnly = lines.filter(l => l.includes('/') || l.includes('\\')).slice(0, 50);
                    truncatedSections.push('<framework_inventory>', pathsOnly.join('\n'), '</framework_inventory>');
                }
                if (context.historicalContext) {
                    const failures = context.historicalContext.split('\n---\n').slice(-5);
                    truncatedSections.push('<historical_failures>', failures.join('\n---\n'), '</historical_failures>');
                }
                if (context.ticketContext) {
                    truncatedSections.push('<ticket_context>', context.ticketContext, '</ticket_context>');
                }
                dynamicCtx = truncatedSections.length > 0 ? '\n\n' + truncatedSections.join('\n') : '';
                if (context.contextStore && (basePrompt + dynamicCtx + sharedCtx).length > MAX_SYSTEM_PROMPT_CHARS) {
                    sharedCtx = context.contextStore.buildContextSummary(agentName, { maxEntries: 10 });
                }
                assembledPrompt = basePrompt + dynamicCtx + sharedCtx;
                this._log(`📏 Truncated prompt size: ${assembledPrompt.length} chars`);
            }
        }

        const sessionConfig = {
            model: this.model,
            tools,
            systemMessage: {
                content: assembledPrompt,
            },
            hooks,

            // ── CRITICAL: Permission handler ──
            // Without this, the CLI server sets requestPermission=false and
            // silently denies ALL privileged tool calls (file I/O, shell, MCP).
            // The agent loops forever waiting for results → session.idle never fires → timeout.
            onPermissionRequest: async (request, invocation) => {
                this._log(`🔑 Permission requested: ${request?.tool || request?.type || 'unknown'}`);
                return { kind: 'approved' };
            },

            // ── CRITICAL: User-input handler ──
            // When the agent calls ask_user / ask_questions, the CLI server sends
            // a user-input request. Without a handler the agent stalls indefinitely.
            onUserInputRequest: async (request, invocation) => {
                this._log(`💬 User input requested: ${JSON.stringify(request?.question || request).slice(0, 120)}`);
                return {
                    answer: 'Continue autonomously. Make the best decision based on available context.',
                    wasFreeform: true,
                };
            },

            // ── Working directory for file operations ──
            workingDirectory: path.join(__dirname, '..', '..'),

            // ── Enable streaming for delta events ──
            streaming: true,
        };

        // Add MCP servers if any
        if (Object.keys(mcpServers).length > 0) {
            sessionConfig.mcpServers = mcpServers;
        }

        // Add BYOK provider if configured
        if (this.provider) {
            sessionConfig.provider = this.provider;
        }

        // 7a. Inject model-level thinking parameters if configured for this agent/phase
        const modelParams = this._resolveModelParameters(agentName);
        if (modelParams.thinking) {
            Object.assign(sessionConfig, modelParams.thinking);
            this._log(`🧠 Thinking mode enabled for ${agentName}: ${JSON.stringify(modelParams.thinking)}`);
        }

        // 7. Create the session
        const session = await this.client.createSession(sessionConfig);
        const sessionId = session.sessionId;

        // Attach global event listener for diagnostics
        try {
            session.on((event) => {
                const type = event?.type || 'unknown';
                const data = JSON.stringify(event?.data || {}).substring(0, 250);
                this._log(`📡 [${agentName}:${type}] ${data}`);
            });
        } catch { /* ignore if on() doesn't support global handler */ }

        this._activeSessions.set(sessionId, { agentName, session, createdAt: new Date() });
        this._log(`✅ ${agentName} session created [${sessionId}]`);

        return { session, sessionId, agentName };
    }

    /**
     * Create a lightweight LLM session for simple prompt→response calls.
     * No tools, no MCP, no streaming — just system prompt + user prompt → response.
     *
     * @param {string} agentName       - Descriptive agent name (e.g., 'cognitive-analysis')
     * @param {string} systemPrompt    - System prompt for the session
     * @param {Object} [options]        - Optional overrides
     * @param {string} [options.model]  - Override default model
     * @returns {{ sendAndWait: (userPrompt: string, timeout?: number) => Promise<string>, destroy: () => Promise<void> }}
     */
    async createLightweightSession(agentName, systemPrompt, options = {}) {
        this._log(`Creating lightweight session: ${agentName}`);

        // Read model parameter config for thinking-capable sessions
        const modelParams = this._resolveModelParameters(agentName);

        const sessionConfig = {
            model: options.model || this.model,
            tools: [],
            systemMessage: { content: systemPrompt },
            streaming: false,
            onPermissionRequest: async () => ({ kind: 'approved' }),
            onUserInputRequest: async () => ({ answer: 'Continue autonomously.', wasFreeform: true }),
            workingDirectory: path.join(__dirname, '..', '..'),
        };

        // Inject model-level thinking parameters if configured
        if (modelParams.thinking) {
            Object.assign(sessionConfig, modelParams.thinking);
        }

        if (this.provider) {
            sessionConfig.provider = this.provider;
        }

        const session = await this.client.createSession(sessionConfig);
        const sessionId = session.sessionId;
        this._activeSessions.set(sessionId, { agentName, session, createdAt: new Date() });

        this._log(`✅ Lightweight ${agentName} session created [${sessionId}]`);

        return {
            sendAndWait: async (userPrompt, timeout = 120000) => {
                return this.sendAndWait(session, userPrompt, { timeout });
            },
            destroy: async () => {
                await this.destroySession(sessionId).catch(() => { });
            },
        };
    }

    /**
     * Resolve model parameters (thinking, temperature, etc.) for a given agent/phase.
     * Reads from workflow-config.json → sdk.modelParameters.
     *
     * @param {string} agentName - Agent or phase name
     * @returns {{ thinking: Object|null }}
     */
    _resolveModelParameters(agentName) {
        const mpConfig = this.config?.sdk?.modelParameters;
        if (!mpConfig || !mpConfig.enabled) return { thinking: null };

        // Map agent name to its parameter profile
        const phaseMap = mpConfig.phases || {};
        const profileName = phaseMap[agentName] || phaseMap[getCognitiveBaseRole(agentName)] || 'default';
        const profile = mpConfig.profiles?.[profileName];

        if (!profile || !profile.thinkingEnabled) return { thinking: null };

        // Auto-detect model family for correct parameter format
        const modelStr = (this.model || '').toLowerCase();
        const thinkingParams = {};

        if (modelStr.includes('claude') || modelStr.includes('anthropic')) {
            // Anthropic: thinking parameter with budget
            thinkingParams.thinking = {
                type: 'enabled',
                budget_tokens: profile.thinkingBudgetTokens || 8000,
            };
        } else if (modelStr.startsWith('o3') || modelStr.startsWith('o4') || modelStr.startsWith('o1')) {
            // OpenAI reasoning models
            thinkingParams.reasoning_effort = profile.reasoningEffort || 'high';
        } else if (modelStr.includes('gpt-5') || modelStr.includes('gpt-4')) {
            // GPT-5.x may support reasoning; GPT-4.x typically doesn't
            if (profile.reasoningEffort) {
                thinkingParams.reasoning = { effort: profile.reasoningEffort };
            }
        }
        // Gemini and other providers: pass thinking budget as generic parameter
        if (Object.keys(thinkingParams).length === 0 && profile.thinkingBudgetTokens) {
            thinkingParams.thinking_budget = profile.thinkingBudgetTokens;
        }

        return { thinking: Object.keys(thinkingParams).length > 0 ? thinkingParams : null };
    }

    /**
     * Create a self-healing session — a specialized scriptgenerator session
     * with failure context and healing-specific tools.
     *
     * @param {Object} failureContext - Error analysis output
     * @param {string} specPath       - Path to the failing spec file
     * @param {string} explorationData - Previous exploration JSON
     * @returns {Promise<Object>} { session, sessionId }
     */
    async createHealingSession(failureContext, specPath, explorationData) {
        const healingPrompt = [
            '## SELF-HEALING MODE',
            '',
            'You are fixing a failing Playwright test. Follow these steps:',
            '',
            '1. Review the failure analysis below',
            '2. Use MCP to navigate to the failing page',
            '3. Take a fresh accessibility snapshot',
            '4. Compare live selectors with the ones in the spec file',
            '5. Update ONLY the broken selectors — do not rewrite the entire test',
            '6. Verify your fix compiles correctly',
            '',
            '### Failure Analysis',
            '```json',
            JSON.stringify(failureContext, null, 2),
            '```',
            '',
            '### Spec File Path',
            specPath,
            '',
            '### Previous Exploration Data',
            '```json',
            explorationData || '(none available)',
            '```',
        ].join('\n');

        return this.createAgentSession('scriptgenerator', {
            ticketContext: healingPrompt,
            frameworkInventory: this._getFrameworkInventory(),
            historicalContext: this._getHistoricalContext(failureContext.ticketId),
        });
    }

    /**
     * Send a message to a session and wait for the complete response.
     *
     * @param {Object} session - CopilotSession instance
     * @param {string} prompt  - The message to send
     * @param {Object} [options]
     * @param {number} [options.timeout=300000] - Timeout in ms (default 5 min)
     * @param {Function} [options.onDelta] - Streaming callback for partial responses
     * @returns {Promise<string>} The assistant's complete response
     */
    async sendAndWait(session, prompt, options = {}) {
        const timeout = options.timeout || 300000;
        const unsubs = [];

        // NOTE: The global event listener attached in createAgentSession() already
        // logs all events. No need for a duplicate all-event listener here.

        // ── Subscribe to tool execution events for observability ──
        try {
            unsubs.push(session.on('tool.execution_start', (event) => {
                const toolName = event?.data?.toolName || event?.data?.name || 'unknown';
                this._log(`🔧 Tool start: ${toolName}`);
                if (options.onToolStart) options.onToolStart(toolName, event?.data);
            }));
        } catch { /* event may not exist in all SDK versions */ }

        try {
            unsubs.push(session.on('tool.execution_end', (event) => {
                const toolName = event?.data?.toolName || event?.data?.name || 'unknown';
                const success = event?.data?.success !== false;
                this._log(`🔧 Tool end: ${toolName} (${success ? 'ok' : 'failed'})`);
                if (options.onToolEnd) options.onToolEnd(toolName, success, event?.data);
            }));
        } catch { /* event may not exist in all SDK versions */ }

        try {
            unsubs.push(session.on('session.error', (event) => {
                this._log(`⚠️ Session error: ${event?.data?.message || JSON.stringify(event?.data)}`);
            }));
        } catch { /* event may not exist in all SDK versions */ }

        if (options.onDelta) {
            try {
                unsubs.push(session.on('assistant.message_delta', (event) => {
                    options.onDelta(event.data.deltaContent);
                }));
            } catch { /* delta events require streaming: true */ }
        }

        try {
            const result = await session.sendAndWait({ prompt }, timeout);

            // The SDK response shape varies across versions. Handle all known forms:
            //   v1: result.data.content  (wrapped payload)
            //   v2: result.content       (direct message)
            //   v3: result.message.content
            //   v4: result is a plain string
            const content =
                result?.data?.content ||
                result?.content ||
                result?.message?.content ||
                (typeof result === 'string' ? result : '') ||
                '';

            if (!content) {
                this._log('⚠️ sendAndWait returned empty content. Raw result keys: ' +
                    (result ? Object.keys(result).join(', ') : 'null/undefined'));
            }

            return content;
        } finally {
            // Clean up all event subscriptions
            for (const unsub of unsubs) {
                if (typeof unsub === 'function') unsub();
            }
        }
    }

    /**
     * Destroy a session and remove from tracking.
     */
    async destroySession(sessionId) {
        const entry = this._activeSessions.get(sessionId);
        if (entry) {
            await entry.session.destroy();
            this._activeSessions.delete(sessionId);
            this._log(`Session ${sessionId} destroyed`);
        }
    }

    /**
     * Destroy all active sessions.
     */
    async destroyAll() {
        for (const [sessionId] of this._activeSessions) {
            await this.destroySession(sessionId).catch(() => { });
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    _getFrameworkInventory() {
        try {
            const { getFrameworkInventoryCache, getInventorySummary } = require('../utils/project-path-resolver');
            return getInventorySummary(getFrameworkInventoryCache());
        } catch {
            return null;
        }
    }

    _getHistoricalContext(ticketId) {
        if (!this.learningStore) return null;

        const failures = this.learningStore.getFailuresForPage(ticketId);
        if (failures.length === 0) return null;

        return failures.map(f =>
            `- [${f.errorType}] Selector "${f.selector}" failed → Fixed with "${f.fix}" (${f.outcome})`
        ).join('\n');
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[AgentSessionFactory] ${message}`);
        }
    }
}

module.exports = { AgentSessionFactory, loadAgentPrompt, buildDynamicContext, getCognitiveBaseRole, isCognitiveAgent };
