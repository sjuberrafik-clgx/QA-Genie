/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MUTATION GUARD — Universal Write/Update/Delete Approval Choke Point
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A single, always-on `onPreToolUse` enforcement layer that classifies EVERY tool
 * call and forces an explicit Approve/Cancel prompt before any data/state mutation
 * runs — for ALL agents, including user-created custom Studio agents and any future
 * custom MCP tools.
 *
 * WHY THIS EXISTS
 * Approval used to be opt-in and fragmented: each mutating tool had to remember to
 * call its own gate (`requireJiraMutationApproval` for Jira, `requestConfirmation`
 * for filesystem) and the shell block only applied to two profiles. Custom agents,
 * custom MCP tools, and several built-ins (`run_command`, `commit_and_push_repo_changes`)
 * could mutate state with NO approval prompt at all. This module is the catch-all that
 * guarantees every write/update/delete is gated regardless of which agent issues it.
 *
 * DESIGN (defense-in-depth)
 *   - Tools that already self-gate (Jira/Confluence, filesystem writes) are marked
 *     `selfGated` and SKIPPED here, so the user is never prompted twice.
 *   - Browser/MCP UI exploration (click/type/navigate/snapshot) is EXEMPT — gating
 *     hundreds of interactions would be unusable; those are not data mutations.
 *   - Read-only tools are allowed without prompting.
 *   - Genuine mutations that are NOT self-gated (unknown custom tools, `run_command`,
 *     `commit_and_push_repo_changes`) are gated here.
 *
 * FAIL-CLOSED
 *   In chat mode the prompt uses `requestUserInput({ type: 'confirmation' })`, which
 *   auto-resolves to "Cancel" on timeout / when no human is connected — so a missing
 *   approver denies the mutation. In pipeline (headless) mode there is no human, so
 *   known-safe mutations are auto-approved and unknown/unsafe mutations are blocked.
 *
 * @module mutation-guard
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const {
    JIRA_MUTATION_GUARDRAILS,
    buildMutationPreview,
    createMutationFieldChange,
    isApprovalAnswer,
} = require('./tools/mutation-helpers');
const { CHAT_SHELL_TOOL_PATTERNS } = require('./chat-utils/chat-constants');

// ─── Effect vocabulary ───────────────────────────────────────────────────────
const EFFECT = Object.freeze({ READ: 'read', WRITE: 'write', DELETE: 'delete', EXECUTE: 'execute', UNKNOWN: 'unknown' });
const DECISION = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });

// ─── Filesystem tools (self-gated via requestConfirmation in filesystem-tools.js) ──
const FILESYSTEM_WRITE_TOOLS = {
    write_file_content: { effect: EFFECT.WRITE, impactLevel: 'high', actionLabel: 'create or overwrite a file' },
    create_directory: { effect: EFFECT.WRITE, impactLevel: 'low', actionLabel: 'create a directory' },
    move_items: { effect: EFFECT.WRITE, impactLevel: 'high', actionLabel: 'move files or folders' },
    copy_items: { effect: EFFECT.WRITE, impactLevel: 'medium', actionLabel: 'copy files or folders' },
    rename_item: { effect: EFFECT.WRITE, impactLevel: 'high', actionLabel: 'rename a file or folder' },
    delete_items: { effect: EFFECT.DELETE, impactLevel: 'destructive', actionLabel: 'delete files or folders' },
};

const FILESYSTEM_READ_TOOLS = [
    'set_workspace_root', 'list_directory', 'read_file_content', 'get_file_info',
    'get_directory_stats', 'search_files', 'parse_document', 'get_document_summary',
    'open_file_native', 'open_containing_folder',
];

// ─── Built-in tools that LOOK mutating by name but are safe (internal/UI/artifact) ──
// These produce local deliverables or touch only internal in-memory stores. Gating
// them would break the core agent loops (DocGenie artifacts, ScriptGenie exploration
// caching, inter-agent context) without any real safety benefit.
const SAFE_BUILTIN_TOOLS = new Set([
    // Document / artifact generation (the agent's requested deliverable)
    'generate_test_case_excel', 'generate_pptx', 'generate_docx', 'generate_pdf',
    'generate_excel_report', 'generate_diagram', 'generate_chart_image',
    'generate_infographic', 'generate_html_report', 'generate_custom_html', 'generate_infographic_poster',
    'generate_video', 'generate_markdown',
    // Internal state / cache / UI (not external mutations)
    'write_shared_context', 'write_agent_note', 'register_artifact',
    'save_exploration_data', 'publish_image_to_chat', 'refresh_grounding_context',
    // Read-only analysis with action-like names
    'run_quality_gate', 'validate_generated_script', 'analyze_test_failure',
    'analyze_video_recording', 'suggest_popup_handler', 'answer_question',
    // QA execution loop (runs tests / explores — not a data mutation)
    'execute_test', 'find_test_files',
    // Tool discovery / delegation (delegated tool runs its OWN approval gate)
    'tool_search', 'unified_tool_search', 'list_delegatable_tools', 'cross_agent_delegate',
    // Grounding / knowledge reads
    'search_project_context', 'get_feature_map', 'get_selector_recommendations',
    'check_existing_coverage', 'search_knowledge_base', 'get_knowledge_base_page',
    'get_framework_inventory', 'get_snapshot_quality',
]);

// ─── High-impact built-ins that are NOT self-gated → must be gated here ──────────
const HIGH_IMPACT_BUILTINS = {
    run_command: {
        category: 'shell', effect: EFFECT.EXECUTE, impactLevel: 'high', pipelineSafe: false,
        actionLabel: 'run an arbitrary shell command',
        consequence: 'The command runs on the host with full shell access and can read, write, or delete anything the process can reach.',
    },
    commit_and_push_repo_changes: {
        category: 'repo', effect: EFFECT.WRITE, impactLevel: 'high', pipelineSafe: false,
        actionLabel: 'commit and push repository changes',
        consequence: 'Staged changes will be committed and pushed to the remote git repository, affecting shared history.',
    },
};

// ─── Browser / MCP exploration prefixes (EXEMPT by default) ──────────────────────
const BROWSER_TOOL_SUBSTRINGS = ['unified_', 'browser_', 'playwright_', 'mcp_'];

// ─── Name-based verb heuristics for UNKNOWN tools (e.g. custom Studio MCP tools) ──
const DESTRUCTIVE_VERBS = new Set([
    'delete', 'remove', 'destroy', 'drop', 'purge', 'erase', 'wipe', 'truncate',
    'uninstall', 'revoke', 'teardown', 'unlink', 'rmdir', 'rm', 'kill', 'terminate',
    'prune', 'discard', 'revert', 'rollback', 'reset',
]);
const MUTATING_VERBS = new Set([
    'create', 'update', 'write', 'edit', 'set', 'add', 'insert', 'put', 'patch',
    'post', 'modify', 'change', 'rename', 'move', 'copy', 'upload', 'attach',
    'publish', 'deploy', 'push', 'commit', 'merge', 'transition', 'assign', 'link',
    'save', 'send', 'submit', 'register', 'provision', 'mkdir', 'append', 'replace',
    'apply', 'grant', 'enable', 'disable', 'configure', 'install', 'sync', 'import',
    'trigger', 'schedule', 'approve', 'reject', 'execute', 'run', 'exec',
]);
const READ_VERBS = new Set([
    'get', 'list', 'read', 'search', 'fetch', 'find', 'query', 'view', 'show',
    'describe', 'inspect', 'scan', 'check', 'detect', 'extract', 'snapshot',
    'observe', 'crawl', 'lookup', 'resolve', 'count', 'exists', 'stat', 'summarize',
    'summarise', 'analyze', 'analyse', 'preview', 'expect', 'is', 'has', 'wait',
    'poll', 'load', 'download', 'validate', 'verify', 'compare', 'diff', 'calculate',
    'compute', 'render', 'format', 'parse', 'classify', 'match', 'filter', 'report',
    'status', 'ping', 'test', 'explore', 'navigate', 'click', 'type', 'fill',
    'select', 'hover', 'press', 'scroll', 'screenshot', 'suggest', 'answer',
]);

// ─── Canonical registry (built once) ─────────────────────────────────────────────
const TOOL_EFFECT_REGISTRY = (() => {
    const reg = {};
    for (const [name, g] of Object.entries(JIRA_MUTATION_GUARDRAILS)) {
        reg[name] = {
            category: g.provider === 'confluence' ? 'confluence' : 'jira',
            effect: g.effect, mutating: true, selfGated: true, pipelineSafe: false,
            impactLevel: g.impactLevel, actionLabel: g.actionLabel,
            resourceType: g.resourceType, provider: g.provider, source: 'registry',
        };
    }
    for (const [name, meta] of Object.entries(FILESYSTEM_WRITE_TOOLS)) {
        reg[name] = {
            category: 'filesystem', effect: meta.effect, mutating: true, selfGated: true,
            pipelineSafe: false, impactLevel: meta.impactLevel, actionLabel: meta.actionLabel,
            resourceType: 'file', source: 'registry',
        };
    }
    for (const name of FILESYSTEM_READ_TOOLS) {
        reg[name] = { category: 'filesystem', effect: EFFECT.READ, mutating: false, selfGated: false, source: 'registry' };
    }
    for (const [name, meta] of Object.entries(HIGH_IMPACT_BUILTINS)) {
        reg[name] = {
            category: meta.category, effect: meta.effect, mutating: true, selfGated: false,
            pipelineSafe: meta.pipelineSafe, impactLevel: meta.impactLevel,
            actionLabel: meta.actionLabel, consequence: meta.consequence, source: 'registry',
        };
    }
    for (const name of SAFE_BUILTIN_TOOLS) {
        if (!reg[name]) reg[name] = { category: 'safe-builtin', effect: EFFECT.READ, mutating: false, selfGated: false, source: 'allowlist' };
    }
    return reg;
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function normalizeName(toolName) { return String(toolName || '').trim(); }

function isBrowserTool(lowerName) {
    return BROWSER_TOOL_SUBSTRINGS.some(sub => lowerName.includes(sub));
}

function isShellTool(lowerName) {
    return CHAT_SHELL_TOOL_PATTERNS.some(p => lowerName.includes(p));
}

/** Split a tool name into lowercase verb tokens (handles snake_case and camelCase). */
function tokenize(toolName) {
    return String(toolName || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .map(t => t.toLowerCase())
        .filter(Boolean);
}

function resolveGuardConfig(config) {
    const g = (config && typeof config === 'object' && config.guardrails && typeof config.guardrails === 'object')
        ? config.guardrails
        : (config && typeof config === 'object' ? config : {});
    const pipeline = (g.pipeline && typeof g.pipeline === 'object') ? g.pipeline : {};
    return {
        enabled: g.enabled !== false,
        failMode: g.failMode === 'open' ? 'open' : 'closed',
        browserInteractionsRequireApproval: g.browserInteractionsRequireApproval === true,
        gateUnclassifiedTools: g.gateUnclassifiedTools === true,
        exemptCategories: Array.isArray(g.exemptCategories) ? g.exemptCategories.map(String) : ['browser'],
        allowlist: new Set((Array.isArray(g.allowlist) ? g.allowlist : []).map(String)),
        denylist: new Set((Array.isArray(g.denylist) ? g.denylist : []).map(String)),
        overrides: (g.classificationOverrides && typeof g.classificationOverrides === 'object') ? g.classificationOverrides : {},
        extraMutatingVerbs: Array.isArray(g.extraMutatingVerbs) ? g.extraMutatingVerbs.map(s => String(s).toLowerCase()) : [],
        extraReadVerbs: Array.isArray(g.extraReadVerbs) ? g.extraReadVerbs.map(s => String(s).toLowerCase()) : [],
        pipeline: {
            blockUnknownMutations: pipeline.blockUnknownMutations !== false,
        },
    };
}

/**
 * Classify a tool call into an effect + approval decision.
 * Pure, synchronous, deterministic — safe to call on every tool invocation.
 *
 * @returns {{ toolName, category, effect, mutating, selfGated, exempt,
 *   requiresApproval, pipelineSafe, impactLevel, actionLabel, consequence, source }}
 */
function classifyToolEffect(toolName, toolArgs = {}, config = {}) {
    const name = normalizeName(toolName);
    const lower = name.toLowerCase();
    const cfg = resolveGuardConfig(config);

    const base = {
        toolName: name, category: 'unknown', effect: EFFECT.UNKNOWN, mutating: false,
        selfGated: false, exempt: false, requiresApproval: false, pipelineSafe: true,
        impactLevel: 'medium', actionLabel: `run ${name || 'a tool'}`, consequence: undefined,
        source: 'heuristic',
    };

    if (!name) return base;

    // 1) Explicit config override wins outright.
    const override = cfg.overrides[name];
    if (override && typeof override === 'object') {
        const merged = { ...base, ...override, toolName: name, source: 'config-override' };
        merged.mutating = override.mutating ?? (merged.effect === EFFECT.WRITE || merged.effect === EFFECT.DELETE || merged.effect === EFFECT.EXECUTE);
        merged.requiresApproval = override.requiresApproval ?? (merged.mutating && !merged.selfGated && !merged.exempt);
        return merged;
    }

    // 2) Config allow/deny lists.
    if (cfg.allowlist.has(name)) {
        return { ...base, category: 'allowlisted', effect: EFFECT.READ, exempt: true, requiresApproval: false, source: 'config-allowlist' };
    }
    if (cfg.denylist.has(name)) {
        return { ...base, category: 'denylisted', effect: EFFECT.WRITE, mutating: true, requiresApproval: true, pipelineSafe: false, impactLevel: 'high', source: 'config-denylist' };
    }

    // 3) Known registry entry (Jira/Confluence/filesystem/high-impact builtins/safe builtins).
    const reg = TOOL_EFFECT_REGISTRY[name];
    if (reg) {
        const exempt = reg.mutating ? false : true;
        return {
            ...base, ...reg, toolName: name, exempt: reg.mutating ? false : exempt,
            requiresApproval: reg.mutating === true && reg.selfGated !== true,
            pipelineSafe: reg.pipelineSafe !== undefined ? reg.pipelineSafe : !reg.mutating,
        };
    }

    // 4) Browser / MCP exploration — exempt unless explicitly configured to gate.
    if (isBrowserTool(lower)) {
        const requiresApproval = cfg.browserInteractionsRequireApproval === true;
        return {
            ...base, category: 'browser', effect: EFFECT.EXECUTE, mutating: requiresApproval,
            exempt: !requiresApproval, requiresApproval, pipelineSafe: true,
            actionLabel: `perform a browser action (${name})`, source: 'browser',
        };
    }

    // 5) Shell-like tools (not already in registry) — gate as execution mutations.
    if (isShellTool(lower)) {
        return {
            ...base, category: 'shell', effect: EFFECT.EXECUTE, mutating: true, selfGated: false,
            exempt: false, requiresApproval: true, pipelineSafe: false, impactLevel: 'high',
            actionLabel: `run a shell/terminal command (${name})`,
            consequence: 'Shell commands can read, write, or delete arbitrary host resources.',
            source: 'shell',
        };
    }

    // 6) Name-verb heuristics for unknown tools (custom Studio MCP tools, new tools).
    const tokens = tokenize(name);
    const extraMutating = new Set(cfg.extraMutatingVerbs);
    const extraRead = new Set(cfg.extraReadVerbs);
    const firstToken = tokens[0] || '';

    const hasDestructive = tokens.some(t => DESTRUCTIVE_VERBS.has(t));
    const hasMutating = tokens.some(t => MUTATING_VERBS.has(t) || extraMutating.has(t));
    const leadingRead = READ_VERBS.has(firstToken) || extraRead.has(firstToken);

    if (hasDestructive) {
        return {
            ...base, category: 'custom', effect: EFFECT.DELETE, mutating: true, exempt: false,
            requiresApproval: true, pipelineSafe: false, impactLevel: 'destructive',
            actionLabel: `perform a destructive operation (${name})`,
            consequence: 'This tool name indicates an irreversible delete/remove operation.',
            source: 'heuristic',
        };
    }
    // A leading read verb dominates (e.g. get_user_list) unless a destructive verb is present.
    if (leadingRead && !hasMutating) {
        return { ...base, category: 'custom', effect: EFFECT.READ, mutating: false, exempt: true, requiresApproval: false, source: 'heuristic' };
    }
    if (hasMutating) {
        return {
            ...base, category: 'custom', effect: EFFECT.WRITE, mutating: true, exempt: false,
            requiresApproval: true, pipelineSafe: false, impactLevel: 'high',
            actionLabel: `perform a write/update operation (${name})`,
            consequence: 'This tool name indicates a create/update/write operation on external or shared state.',
            source: 'heuristic',
        };
    }

    // 7) Truly unclassified (no recognizable verb). Default: allow unless strict mode.
    if (cfg.gateUnclassifiedTools) {
        return {
            ...base, category: 'custom', effect: EFFECT.UNKNOWN, mutating: true, exempt: false,
            requiresApproval: true, pipelineSafe: false,
            actionLabel: `run an unclassified tool (${name})`,
            consequence: 'Strict mode: tools with no recognizable read/write intent require approval.',
            source: 'heuristic-strict',
        };
    }
    return { ...base, category: 'custom', effect: EFFECT.UNKNOWN, mutating: false, exempt: true, requiresApproval: false, source: 'heuristic' };
}

// ─── Approval preview / prompt builders ──────────────────────────────────────────
const SECRET_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|auth|credential|bearer|cookie|session[_-]?id|private[_-]?key)/i;

function summarizeArgValue(value) {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        const json = JSON.stringify(value);
        return json.length > 160 ? `${json.slice(0, 157)}…` : json;
    } catch {
        return '[unserializable]';
    }
}

function buildArgChanges(toolArgs) {
    if (!toolArgs || typeof toolArgs !== 'object') return [];
    return Object.keys(toolArgs).slice(0, 8).map(key => {
        const redacted = SECRET_KEY_PATTERN.test(key);
        return createMutationFieldChange({
            field: key,
            label: key,
            before: undefined,
            after: redacted ? '••••• (hidden)' : summarizeArgValue(toolArgs[key]),
            changeType: 'add',
        });
    }).filter(Boolean);
}

function classificationToGuardrail(classification) {
    return {
        provider: classification.provider || classification.category || 'tool',
        resourceType: classification.resourceType || classification.category || 'resource',
        effect: classification.effect === EFFECT.DELETE ? 'delete' : 'write',
        impactLevel: classification.impactLevel || 'high',
        requiresApproval: true,
        actionLabel: classification.actionLabel || `run ${classification.toolName}`,
    };
}

function buildGuardrailPreview(classification, toolArgs) {
    const guardrail = classificationToGuardrail(classification);
    const notes = [];
    if (isNonEmptyString(classification.consequence)) notes.push(classification.consequence);
    notes.push(`Tool: ${classification.toolName} (category: ${classification.category}, effect: ${classification.effect}).`);
    return buildMutationPreview({
        guardrail,
        title: `Approval required: ${classification.toolName}`,
        subject: { id: classification.toolName, label: classification.actionLabel },
        changes: buildArgChanges(toolArgs),
        notes,
        consequence: classification.consequence,
    });
}

function buildGuardApprovalPrompt(classification, preview) {
    const lines = (preview.changes || []).slice(0, 5).map(c => `- ${c.label}: ${c.afterDisplay}`);
    return [
        '**Approval required before a mutating action**',
        '',
        `The agent is about to ${classification.actionLabel}.`,
        'Review the details below, then choose Approve change or Cancel.',
        '',
        ...(lines.length ? ['Parameters:', ...lines, ''] : []),
        `Impact: ${String(classification.impactLevel || 'high').toUpperCase()}`,
        isNonEmptyString(classification.consequence) ? `Consequence: ${classification.consequence}` : '',
        '',
        'Select Approve change to continue, or Cancel to block it.',
    ].filter(Boolean).join('\n');
}

function buildDenialContext(classification, { rejected }) {
    return [
        `⛔ BLOCKED: "${classification.toolName}" was not approved.`,
        '',
        rejected
            ? 'The user explicitly cancelled this action. Do NOT retry it. Choose a different, non-mutating approach or ask the user how to proceed.'
            : 'This action requires explicit user approval, which was not granted (no approver was available). Do NOT retry automatically.',
        '',
        `This is a ${classification.effect} operation (impact: ${String(classification.impactLevel || 'high').toUpperCase()}). `
        + 'Mutating operations must be approved by the user before they run.',
    ].join('\n');
}

/**
 * Run the interactive approval flow for a single mutating tool call.
 * @returns {Promise<{ approved: boolean, mode: string }>}
 */
async function enforceMutationApproval({ chatManager, toolName, toolArgs, sessionId, classification }) {
    const preview = buildGuardrailPreview(classification, toolArgs);

    if (chatManager && typeof chatManager.broadcastToolProgress === 'function') {
        try {
            chatManager.broadcastToolProgress(toolName, { phase: 'approval', message: 'Awaiting explicit user approval...' });
        } catch { /* non-critical */ }
    }

    if (!chatManager || typeof chatManager.requestUserInput !== 'function') {
        // No way to ask a human → fail closed.
        return { approved: false, mode: 'no-approver' };
    }

    const response = await chatManager.requestUserInput(
        buildGuardApprovalPrompt(classification, preview),
        ['Approve change', 'Cancel'],
        {
            type: 'confirmation',
            sessionId: sessionId || 'default',
            mutationPreview: preview,
            guardrail: classificationToGuardrail(classification),
        }
    );

    return isApprovalAnswer(response)
        ? { approved: true, mode: 'interactive' }
        : { approved: false, mode: 'rejected' };
}

/**
 * Build an `onPreToolUse` hook that enforces universal mutation approval.
 *
 * @param {Object}  opts
 * @param {Object}  opts.chatManager     ChatSessionManager (for requestUserInput). Optional in pipeline mode.
 * @param {Object} [opts.sessionContext] Session context (provides sessionId).
 * @param {Object} [opts.config]         workflow-config (reads `guardrails` section).
 * @param {'interactive'|'pipeline'} [opts.mode='interactive']
 * @param {string} [opts.profile]        Agent tool profile (for logging only).
 * @param {Function} [opts.log]          Optional logger.
 * @returns {(input: Object) => Promise<{ permissionDecision: 'allow'|'deny', additionalContext?: string }>}
 */
function createMutationGuardHook({ chatManager, sessionContext, config, mode = 'interactive', profile, log } = {}) {
    const cfg = resolveGuardConfig(config);
    const logger = typeof log === 'function' ? log : () => {};

    return async function mutationGuardPreToolUse(input) {
        if (!cfg.enabled) return { permissionDecision: DECISION.ALLOW };

        const toolName = normalizeName(input?.toolName);
        const toolArgs = (input && typeof input.toolArgs === 'object' && input.toolArgs) || {};
        if (!toolName) return { permissionDecision: DECISION.ALLOW };

        const classification = classifyToolEffect(toolName, toolArgs, config);

        // Allowed without prompting: reads, exempt (browser), and self-gated tools
        // (those run their own approval prompt — never double-prompt here).
        if (!classification.requiresApproval || classification.exempt || classification.selfGated) {
            return { permissionDecision: DECISION.ALLOW };
        }

        // Pipeline / headless: no human to approve.
        if (mode === 'pipeline') {
            if (classification.pipelineSafe === true) {
                return { permissionDecision: DECISION.ALLOW };
            }
            if (cfg.pipeline.blockUnknownMutations === false) {
                return { permissionDecision: DECISION.ALLOW };
            }
            logger(`🚫 Pipeline mutation blocked (no approver): ${toolName} [${classification.category}/${classification.effect}]`);
            return { permissionDecision: DECISION.DENY, additionalContext: buildDenialContext(classification, { rejected: false }) };
        }

        // Interactive chat: ask the user.
        const sessionId = sessionContext?.sessionId || undefined;
        logger(`🔐 Mutation approval required: ${toolName} [${classification.category}/${classification.effect}] (profile=${profile || 'n/a'})`);
        const result = await enforceMutationApproval({ chatManager, toolName, toolArgs, sessionId, classification });

        if (result.approved) {
            return { permissionDecision: DECISION.ALLOW };
        }
        return {
            permissionDecision: DECISION.DENY,
            additionalContext: buildDenialContext(classification, { rejected: result.mode === 'rejected' }),
        };
    };
}

module.exports = {
    EFFECT,
    DECISION,
    TOOL_EFFECT_REGISTRY,
    classifyToolEffect,
    enforceMutationApproval,
    createMutationGuardHook,
    buildGuardrailPreview,
    resolveGuardConfig,
    // exported for tests
    tokenize,
    isBrowserTool,
    isShellTool,
};
