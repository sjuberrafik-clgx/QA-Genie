/**
 * Tool Broker — Cross-Agent Tool Delegation Layer
 *
 * Provides a lightweight orchestration layer that enables any agent to invoke
 * tools owned by other agents, without creating new LLM sessions.
 *
 * Architecture:
 *  1. buildRegistry() — scans all agents with a no-op defineTool to capture metadata
 *  2. listDelegatable() — returns tools available via delegation (not in caller's own set)
 *  3. delegate() — creates a handler on-demand with the CURRENT session's deps, executes it
 *
 * Zero LLM overhead. The approval flow works because handlers receive the real
 * chatManager and sessionContext from the calling session.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ─── Tool Categories ────────────────────────────────────────────────────────
const TOOL_CATEGORIES = {
    // Jira CRUD, transitions, links, comments, worklogs
    jira: [
        'fetch_jira_ticket', 'get_jira_current_user', 'search_jira_issues',
        'search_jira_epics', 'get_jira_epic', 'get_jira_epic_issues',
        'list_jira_issues_without_epic', 'search_jira_users', 'assign_jira_ticket',
        'get_jira_ticket_capabilities', 'create_jira_ticket', 'update_jira_ticket',
        'delete_jira_ticket', 'delete_jira_comment', 'edit_jira_comment',
        'transition_jira_ticket', 'link_jira_issues', 'remove_jira_issue_link',
        'get_jira_project_versions', 'log_jira_work', 'update_jira_estimates',
        'attach_file_to_jira', 'delete_jira_attachment',
        'add_comment_with_media',
        'add_comment_with_images',
    ],
    // Test evidence & video
    evidence: [
        'attach_session_evidence_to_jira', 'attach_session_images_to_jira',
        'analyze_video_recording', 'attach_video_frames_to_jira',
    ],
    // Document generation
    document: [
        'generate_pptx', 'generate_docx', 'generate_pdf', 'generate_excel_report',
        'generate_diagram', 'generate_chart_image', 'generate_infographic',
        'generate_html_report', 'generate_custom_html', 'generate_infographic_poster', 'generate_video',
        'get_design_score', 'generate_markdown',
    ],
    // Test framework
    framework: [
        'get_framework_inventory', 'validate_generated_script', 'find_test_files',
        'execute_test', 'get_historical_failures', 'get_exploration_data',
        'save_exploration_data', 'analyze_test_failure', 'get_test_results',
        'get_assertion_config', 'suggest_popup_handler', 'get_snapshot_quality',
        'run_command',
    ],
    // Grounding & knowledge base
    grounding: [
        'search_project_context', 'get_feature_map', 'get_selector_recommendations',
        'check_existing_coverage', 'refresh_grounding_context',
        'search_knowledge_base', 'get_knowledge_base_page',
        'search_confluence_content', 'get_confluence_page_details',
        'list_confluence_spaces', 'list_confluence_pages_in_space',
        'get_confluence_page_tree',
    ],
    // Pipeline & shared context
    pipeline: [
        'write_shared_context', 'read_shared_context', 'register_artifact',
        'answer_question', 'run_quality_gate', 'commit_and_push_repo_changes',
        'write_agent_note', 'get_agent_notes', 'get_context_budget',
        'publish_image_to_chat',
    ],
    // Document parsing (docgenie-specific)
    docparse: [
        'list_session_documents', 'parse_session_document',
    ],
    // Excel generation (testgenie-specific)
    testcase: [
        'generate_test_case_excel',
    ],
};

// Reverse lookup: toolName → category
const _toolCategoryMap = new Map();
for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
    for (const name of toolNames) {
        _toolCategoryMap.set(name, category);
    }
}

function getToolCategory(toolName) {
    return _toolCategoryMap.get(toolName) || 'unknown';
}

// ─── Default Delegation Permissions ─────────────────────────────────────────
// Which tool categories each agent is allowed to delegate to.
// Configurable via workflow-config.json → toolBroker.permissions
const DEFAULT_DELEGATION_PERMISSIONS = {
    buggenie: ['jira', 'evidence', 'document', 'framework'],
    testgenie: ['jira', 'document', 'testcase'],
    taskgenie: ['jira'],
    scriptgenerator: ['framework', 'grounding'],
    docgenie: ['jira', 'document'],
    codereviewer: ['framework', 'grounding'],
    filegenie: [],
    // Workspace/custom agents created via Studio. Broad capability envelope so
    // these agents can fulfil dynamic user prompts (e.g. Summarizer asked to
    // summarise a pasted Jira URL → delegate to fetch_jira_ticket).
    // The runtime should pass the alias `workspace` as the caller name when
    // invoking the broker for a custom agent's session.
    workspace: ['jira', 'evidence', 'document', 'framework', 'grounding', 'pipeline', 'docparse'],
    custom: ['jira', 'evidence', 'document', 'framework', 'grounding', 'pipeline', 'docparse'],
};

// ─── Tool Broker ────────────────────────────────────────────────────────────

class ToolBroker {
    /**
     * @param {Object} [options]
     * @param {Object} [options.config] - workflow-config.json (reads toolBroker section)
     * @param {boolean} [options.verbose] - Enable debug logging
     */
    constructor(options = {}) {
        this._config = options.config?.toolBroker || {};
        this._verbose = options.verbose || false;

        // Registry: toolName → { name, description, parameters, ownerAgents[], category }
        this._registry = new Map();

        // Delegation log: recent delegation events for observability
        this._delegationLog = [];
        this._maxLogEntries = 100;

        // Session delegation counters: sessionId → count
        this._sessionDelegationCounts = new Map();
        this._maxDelegationsPerSession = this._config.maxDelegationsPerSession || 10;
        this._delegationTimeoutMs = this._config.delegationTimeoutMs || 30000;

        // Merge default permissions with config overrides
        this._permissions = {
            ...DEFAULT_DELEGATION_PERMISSIONS,
            ...(this._config.permissions || {}),
        };
    }

    /**
     * Check if the broker is enabled.
     */
    get enabled() {
        return this._config.enabled !== false;
    }

    /**
     * Build the tool registry by scanning all agent roles.
     * Uses a capturing no-op defineTool to extract metadata without creating handlers.
     *
     * @param {string[]} validAgents - Array of agent role names to scan
     */
    buildRegistry(validAgents) {
        if (!this.enabled) {
            this._log('Tool broker disabled — skipping registry build');
            return;
        }

        const { createCustomTools } = require('./custom-tools');
        this._registry.clear();

        for (const agentName of validAgents) {
            const captured = [];

            // No-op defineTool that captures metadata
            const capturingDefineTool = (name, config) => {
                captured.push({
                    name,
                    description: config.description || '',
                    parameters: config.parameters || {},
                });
                // Return a minimal tool-like object (needed for array push)
                return { name, definition: { name } };
            };

            try {
                // Call with minimal deps — handlers won't be stored, only metadata
                createCustomTools(capturingDefineTool, agentName, {});
            } catch (err) {
                this._log(`⚠️ Failed to scan tools for ${agentName}: ${err.message}`);
                continue;
            }

            for (const tool of captured) {
                const existing = this._registry.get(tool.name);
                if (existing) {
                    // Tool already registered by another agent — add this agent as co-owner
                    if (!existing.ownerAgents.includes(agentName)) {
                        existing.ownerAgents.push(agentName);
                    }
                } else {
                    this._registry.set(tool.name, {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                        ownerAgents: [agentName],
                        category: getToolCategory(tool.name),
                    });
                }
            }
        }

        this._log(`Registry built: ${this._registry.size} tools across ${validAgents.length} agents`);
    }

    /**
     * List tools that the current agent could delegate to.
     * Returns tools in the registry that are NOT in the caller's native tool set,
     * filtered by delegation permissions.
     *
     * @param {string} currentAgentName - The calling agent's role
     * @param {string[]} currentToolNames - Tool names the caller already has
     * @returns {Object} Categorized list of delegatable tools
     */
    listDelegatable(currentAgentName, currentToolNames = []) {
        if (!this.enabled) {
            return { available: false, reason: 'Tool broker is disabled' };
        }

        const currentSet = new Set(currentToolNames);
        const allowedCategories = new Set(this._permissions[currentAgentName] || []);
        const delegatable = {};
        let totalCount = 0;

        for (const [toolName, meta] of this._registry) {
            // Skip tools the agent already has
            if (currentSet.has(toolName)) continue;

            // Skip tools in categories the agent isn't allowed to delegate to
            if (!allowedCategories.has(meta.category) && meta.category !== 'unknown') continue;

            const category = meta.category || 'other';
            if (!delegatable[category]) {
                delegatable[category] = [];
            }
            delegatable[category].push({
                name: meta.name,
                description: meta.description.substring(0, 120),
                ownedBy: meta.ownerAgents,
            });
            totalCount++;
        }

        return {
            available: true,
            callerAgent: currentAgentName,
            totalDelegatableTools: totalCount,
            byCategory: delegatable,
            hint: totalCount > 0
                ? 'Use cross_agent_delegate with { toolName, parameters } to invoke any of these tools.'
                : 'No additional tools available via delegation for your current permissions.',
        };
    }

    /**
     * Delegate a tool call to another agent's tool handler.
     *
     * Creates the handler on-demand with the CURRENT session's deps so that
     * approval flow, progress broadcasts, and session resolution all work correctly.
     *
     * @param {string} toolName - The tool to invoke
     * @param {Object} params - Parameters to pass to the tool handler
     * @param {Object} delegationContext
     * @param {string} delegationContext.callerAgent - Who is delegating
     * @param {Object} delegationContext.deps - Current session deps (chatManager, sessionContext, etc.)
     * @param {string} [delegationContext.sessionId] - Session ID for rate limiting
     * @returns {Promise<string>} Tool result (JSON string)
     */
    async delegate(toolName, params, delegationContext) {
        const { callerAgent, deps, sessionId } = delegationContext;
        const startTime = Date.now();

        // ── Validation ──
        if (!this.enabled) {
            return JSON.stringify({ success: false, error: 'Tool broker is disabled.' });
        }

        const meta = this._registry.get(toolName);
        if (!meta) {
            return JSON.stringify({
                success: false,
                error: `Tool '${toolName}' not found in the registry. Use list_delegatable_tools to see available tools.`,
            });
        }

        // ── Permission check ──
        const allowedCategories = new Set(this._permissions[callerAgent] || []);
        if (!allowedCategories.has(meta.category) && meta.category !== 'unknown') {
            return JSON.stringify({
                success: false,
                error: `Agent '${callerAgent}' is not permitted to delegate to '${meta.category}' category tools. Allowed categories: ${[...allowedCategories].join(', ') || 'none'}.`,
            });
        }

        // ── Rate limit ──
        if (sessionId) {
            const count = this._sessionDelegationCounts.get(sessionId) || 0;
            if (count >= this._maxDelegationsPerSession) {
                return JSON.stringify({
                    success: false,
                    error: `Delegation limit reached (${this._maxDelegationsPerSession} per session). Complete remaining work with your native tools.`,
                });
            }
            this._sessionDelegationCounts.set(sessionId, count + 1);
        }

        // ── Resolve owner agent ──
        // Prefer the first ownerAgent that isn't the caller (to get the tool from a different agent)
        // Fall back to the first ownerAgent if the caller itself owns the tool
        const ownerAgent = meta.ownerAgents.find(a => a !== callerAgent) || meta.ownerAgents[0];
        if (!ownerAgent) {
            return JSON.stringify({
                success: false,
                error: `No owner agent found for tool '${toolName}'.`,
            });
        }

        // ── Broadcast progress ──
        if (deps?.chatManager?.broadcastToolProgress) {
            deps.chatManager.broadcastToolProgress('cross_agent_delegate', {
                phase: 'delegation',
                message: `Delegating to ${ownerAgent}'s ${toolName}...`,
                step: 1,
                delegatedTool: toolName,
                ownerAgent,
            });
        }

        // ── Create handler on-demand with current deps ──
        let targetHandler = null;
        try {
            const { createCustomTools } = require('./custom-tools');
            const capturedTools = [];

            const capturingDefineTool = (name, config) => {
                capturedTools.push({ name, handler: config.handler });
                return { name, definition: { name } };
            };

            createCustomTools(capturingDefineTool, ownerAgent, deps);

            const match = capturedTools.find(t => t.name === toolName);
            if (!match || !match.handler) {
                return JSON.stringify({
                    success: false,
                    error: `Tool '${toolName}' not found in ${ownerAgent}'s tool set. The tool may require dependencies not available in this session.`,
                });
            }

            targetHandler = match.handler;
        } catch (err) {
            this._logDelegation(callerAgent, toolName, ownerAgent, startTime, false, err.message);
            return JSON.stringify({
                success: false,
                error: `Failed to create handler for '${toolName}': ${err.message}`,
            });
        }

        // ── Execute with timeout ──
        try {
            const result = await Promise.race([
                targetHandler(params),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Delegation timed out after ${this._delegationTimeoutMs}ms`)), this._delegationTimeoutMs)
                ),
            ]);

            this._logDelegation(callerAgent, toolName, ownerAgent, startTime, true);

            // ── Broadcast completion ──
            if (deps?.chatManager?.broadcastToolProgress) {
                deps.chatManager.broadcastToolProgress('cross_agent_delegate', {
                    phase: 'delegation',
                    message: `Delegation complete: ${toolName} (via ${ownerAgent})`,
                    step: 2,
                    delegatedTool: toolName,
                    ownerAgent,
                    durationMs: Date.now() - startTime,
                });
            }

            return result;
        } catch (err) {
            this._logDelegation(callerAgent, toolName, ownerAgent, startTime, false, err.message);
            return JSON.stringify({
                success: false,
                error: `Delegated tool '${toolName}' failed: ${err.message}`,
                delegatedTo: ownerAgent,
            });
        }
    }

    /**
     * Reset delegation counter for a session (call when session ends).
     */
    resetSessionCounter(sessionId) {
        this._sessionDelegationCounts.delete(sessionId);
    }

    /**
     * Get the delegation log for observability.
     */
    getDelegationLog() {
        return [...this._delegationLog];
    }

    /**
     * Get registry statistics.
     */
    getRegistryStats() {
        const byAgent = {};
        const byCategory = {};

        for (const [, meta] of this._registry) {
            for (const agent of meta.ownerAgents) {
                byAgent[agent] = (byAgent[agent] || 0) + 1;
            }
            byCategory[meta.category] = (byCategory[meta.category] || 0) + 1;
        }

        return {
            totalTools: this._registry.size,
            byAgent,
            byCategory,
        };
    }

    /**
     * Export the registry as a serializable object (for tool-registry.json generation).
     */
    exportRegistry() {
        const entries = [];
        for (const [, meta] of this._registry) {
            entries.push({
                name: meta.name,
                category: meta.category,
                ownerAgents: meta.ownerAgents,
                description: meta.description.substring(0, 200),
            });
        }
        return entries.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    _logDelegation(callerAgent, toolName, ownerAgent, startTime, success, error = null) {
        const entry = {
            event: 'tool_delegation',
            callerAgent,
            toolName,
            ownerAgent,
            durationMs: Date.now() - startTime,
            success,
            error: error || undefined,
            timestamp: new Date().toISOString(),
        };

        this._delegationLog.push(entry);
        if (this._delegationLog.length > this._maxLogEntries) {
            this._delegationLog.shift();
        }

        if (this._config.logDelegations !== false) {
            const icon = success ? '✅' : '❌';
            console.log(`[ToolBroker] ${icon} ${callerAgent} → ${ownerAgent}.${toolName} (${entry.durationMs}ms)${error ? ` — ${error}` : ''}`);
        }
    }

    _log(msg) {
        if (this._verbose || this._config.logDelegations !== false) {
            console.log(`[ToolBroker] ${msg}`);
        }
    }
}

// ─── Meta-Tool Factory ──────────────────────────────────────────────────────
// Creates the two meta-tools that get injected into each agent's tool set.

/**
 * Create the broker meta-tools for a specific agent session.
 *
 * @param {Function} defineTool - SDK defineTool function
 * @param {ToolBroker} broker - The broker instance
 * @param {string} agentName - Current agent role
 * @param {string[]} nativeToolNames - Tool names the agent already has
 * @param {Object} deps - Current session deps
 * @returns {Array} Array of meta-tool definitions
 */
function createBrokerMetaTools(defineTool, broker, agentName, nativeToolNames, deps) {
    if (!broker || !broker.enabled) return [];

    const metaTools = [];

    // ── list_delegatable_tools ──────────────────────────────────────────────
    metaTools.push(defineTool('list_delegatable_tools', {
        description:
            'List tools available via cross-agent delegation that are not in your native tool set. ' +
            'Use this when you realize you cannot perform an action with your current tools — ' +
            'it shows what additional tools you can invoke through the tool broker.',
        parameters: {
            type: 'object',
            properties: {},
        },
        handler: async () => {
            try {
                const result = broker.listDelegatable(agentName, nativeToolNames);
                return JSON.stringify(result, null, 2);
            } catch (err) {
                return JSON.stringify({ success: false, error: err.message });
            }
        },
    }));

    // ── cross_agent_delegate ────────────────────────────────────────────────
    metaTools.push(defineTool('cross_agent_delegate', {
        description:
            'Invoke a tool from another agent via the tool broker. ' +
            'Use this when you need a capability that exists in another agent\'s tool set but not in yours. ' +
            'Call list_delegatable_tools first to see what is available. ' +
            'The tool executes with full approval flow — destructive operations still require user confirmation.',
        parameters: {
            type: 'object',
            properties: {
                toolName: {
                    type: 'string',
                    description: 'The exact name of the tool to invoke (from list_delegatable_tools output).',
                },
                parameters: {
                    type: 'object',
                    description: 'The parameters to pass to the delegated tool, matching its parameter schema.',
                },
            },
            required: ['toolName'],
        },
        handler: async ({ toolName, parameters }) => {
            try {
                const sessionId = deps?.getSessionId?.() || deps?.sessionContext?.sessionId || null;
                return await broker.delegate(toolName, parameters || {}, {
                    callerAgent: agentName,
                    deps,
                    sessionId,
                });
            } catch (err) {
                return JSON.stringify({ success: false, error: err.message });
            }
        },
    }));

    return metaTools;
}

module.exports = { ToolBroker, createBrokerMetaTools, getToolCategory, TOOL_CATEGORIES };
