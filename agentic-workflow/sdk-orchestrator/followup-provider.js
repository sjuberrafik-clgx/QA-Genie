/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FOLLOWUP PROVIDER — Context-Aware Suggested Actions
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates contextual follow-up suggestions after AI responses complete,
 * pipeline stages finish, or chat sessions idle. Provides a guided UX that
 * helps users discover next actions without memorizing commands.
 *
 * Two modes:
 *   1. Chat followups — based on conversation content and agent mode
 *   2. Pipeline followups — based on stage completion and results
 *
 * @module sdk-orchestrator/followup-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Followup Categories ────────────────────────────────────────────────────

/**
 * @typedef {Object} Followup
 * @property {string} label    - Short display text (shown as button)
 * @property {string} prompt   - Full prompt to send when clicked
 * @property {string} category - Category for grouping: 'action' | 'explore' | 'review' | 'debug'
 * @property {string} [icon]   - Optional icon identifier for the UI
 */

// ─── Pipeline Stage Followups ───────────────────────────────────────────────

/**
 * Stage-based followup rules: after a pipeline stage completes (or fails),
 * suggest the most relevant next actions.
 */
const PIPELINE_FOLLOWUPS = {
    testgenie: {
        success: [
            { label: 'Generate automation script', prompt: 'Generate the Playwright automation script from these test cases', category: 'action', icon: 'code' },
            { label: 'Review test cases', prompt: 'Review the generated test cases for completeness and coverage', category: 'review', icon: 'checklist' },
            { label: 'Export to Excel', prompt: 'Export the test cases to an Excel file', category: 'action', icon: 'file' },
        ],
        failure: [
            { label: 'Retry with more context', prompt: 'Retry test case generation — fetch the full Jira ticket details including comments and attachments', category: 'action', icon: 'refresh' },
            { label: 'Show error details', prompt: 'What went wrong during test case generation? Show me the error details', category: 'debug', icon: 'bug' },
        ],
    },

    scriptgenerator: {
        success: [
            { label: 'Execute tests', prompt: 'Run the generated test script', category: 'action', icon: 'play' },
            { label: 'Review script quality', prompt: 'Review the generated script for code quality, framework compliance, and best practices', category: 'review', icon: 'shield' },
            { label: 'View exploration data', prompt: 'Show the MCP exploration data used for selector generation', category: 'explore', icon: 'search' },
        ],
        failure: [
            { label: 'Show exploration data', prompt: 'Show the MCP exploration snapshots — what selectors were found?', category: 'debug', icon: 'search' },
            { label: 'Retry script generation', prompt: 'Retry script generation with fresh MCP exploration', category: 'action', icon: 'refresh' },
            { label: 'Show error details', prompt: 'What caused the script generation to fail? Show detailed error', category: 'debug', icon: 'bug' },
        ],
    },

    execute: {
        success: [
            { label: 'View test report', prompt: 'Show the detailed test execution report', category: 'review', icon: 'chart' },
            { label: 'Run again', prompt: 'Re-run the test suite', category: 'action', icon: 'play' },
        ],
        failure: [
            { label: 'Self-heal failures', prompt: 'Run self-healing on the failed tests', category: 'action', icon: 'wrench' },
            { label: 'Create bug ticket', prompt: 'Create a Jira bug ticket for the test failures', category: 'action', icon: 'bug' },
            { label: 'Analyze failures', prompt: 'Analyze the test failures — categorize errors and suggest fixes', category: 'debug', icon: 'microscope' },
        ],
    },

    healing: {
        success: [
            { label: 'View healing report', prompt: 'Show the self-healing results — what was fixed?', category: 'review', icon: 'chart' },
            { label: 'Run tests again', prompt: 'Re-run the healed test suite to confirm fixes', category: 'action', icon: 'play' },
        ],
        failure: [
            { label: 'Create bug ticket', prompt: 'Create a Jira defect ticket for the persistent failures', category: 'action', icon: 'bug' },
            { label: 'Show healing log', prompt: 'Show what the self-healing engine attempted and why it failed', category: 'debug', icon: 'log' },
        ],
    },

    buggenie: {
        success: [
            { label: 'View bug ticket', prompt: 'Show the created bug ticket details', category: 'review', icon: 'ticket' },
            { label: 'Run full pipeline again', prompt: 'Run the full pipeline again for a different ticket', category: 'action', icon: 'play' },
        ],
        failure: [
            { label: 'Retry bug creation', prompt: 'Retry creating the Jira bug ticket', category: 'action', icon: 'refresh' },
            { label: 'Show bug review copy', prompt: 'Show the bug review copy so I can create it manually', category: 'review', icon: 'document' },
        ],
    },

    report: {
        success: [
            { label: 'Start new pipeline', prompt: 'Start a new pipeline for another Jira ticket', category: 'action', icon: 'play' },
            { label: 'View full report', prompt: 'Show the complete pipeline execution report', category: 'review', icon: 'chart' },
        ],
        failure: [],
    },
};

// ─── Chat Content Followups ─────────────────────────────────────────────────

/**
 * Content-based patterns: match against the assistant's last message
 * to suggest contextually relevant followups.
 */
const CONTENT_PATTERNS = [
    {
        // AI mentioned test failures
        patterns: [/test.*fail/i, /failed.*test/i, /\d+\s*failed/i, /assertion.*error/i],
        followups: [
            { label: 'Self-heal failures', prompt: 'Run self-healing on the failed tests to auto-fix selector and assertion errors', category: 'action', icon: 'wrench' },
            { label: 'Create bug ticket', prompt: 'Create a Jira defect ticket for these test failures', category: 'action', icon: 'bug' },
            { label: 'Show error details', prompt: 'Show me the detailed error stack traces for each failure', category: 'debug', icon: 'microscope' },
        ],
    },
    {
        // AI mentioned test cases
        patterns: [/test case/i, /test step/i, /pre-condition/i, /expected result/i],
        followups: [
            { label: 'Generate script', prompt: 'Generate the Playwright automation script from these test cases', category: 'action', icon: 'code' },
            { label: 'Export to Excel', prompt: 'Export these test cases to an Excel file', category: 'action', icon: 'file' },
        ],
    },
    {
        // AI mentioned a spec file
        patterns: [/\.spec\.js/i, /automation script/i, /playwright.*script/i, /generated.*script/i],
        followups: [
            { label: 'Run the test', prompt: 'Execute the generated test script', category: 'action', icon: 'play' },
            { label: 'Review code quality', prompt: 'Review the script for code quality and framework compliance', category: 'review', icon: 'shield' },
        ],
    },
    {
        // AI mentioned selectors or elements
        patterns: [/selector/i, /locator/i, /getByRole/i, /data-testid/i, /snapshot/i],
        followups: [
            { label: 'Explore page deeper', prompt: 'Take a fresh accessibility snapshot of the current page to find more selectors', category: 'explore', icon: 'search' },
        ],
    },
    {
        // AI mentioned Jira ticket
        patterns: [/AOTF-\d+/i, /jira.*ticket/i, /acceptance criteria/i],
        followups: [
            { label: 'Generate test cases', prompt: 'Generate test cases from this Jira ticket', category: 'action', icon: 'checklist' },
            { label: 'Start full pipeline', prompt: 'Run the full automation pipeline for this ticket', category: 'action', icon: 'play' },
        ],
    },
    {
        // All tests passed
        patterns: [/all.*pass/i, /tests?\s*pass/i, /100%.*pass/i, /✅.*pass/i],
        followups: [
            { label: 'View report', prompt: 'Show the full test execution report', category: 'review', icon: 'chart' },
            { label: 'Run another ticket', prompt: 'Run the pipeline for another Jira ticket', category: 'action', icon: 'play' },
        ],
    },
    {
        // AI mentioned an error or exception
        patterns: [/error:/i, /exception/i, /stack trace/i, /timeout/i, /timed out/i],
        followups: [
            { label: 'Analyze error', prompt: 'Analyze this error in detail — what caused it and how to fix it?', category: 'debug', icon: 'microscope' },
            { label: 'Check historical failures', prompt: 'Check if this error has occurred before using the learning store', category: 'explore', icon: 'history' },
        ],
    },
];

// ─── Agent Mode Followups ───────────────────────────────────────────────────

/**
 * Default followups when a chat session first starts, based on agent mode.
 */
const AGENT_MODE_DEFAULTS = {
    testgenie: [
        { label: 'Fetch Jira ticket', prompt: 'Fetch the Jira ticket details for AOTF-', category: 'action', icon: 'ticket', prefill: true },
        { label: 'Generate test cases', prompt: 'Generate test cases for Jira ticket AOTF-', category: 'action', icon: 'checklist', prefill: true },
    ],
    scriptgenerator: [
        { label: 'Explore a page', prompt: 'Navigate to the UAT application and take an accessibility snapshot', category: 'explore', icon: 'search' },
        { label: 'Generate script', prompt: 'Generate a Playwright test script for AOTF-', category: 'action', icon: 'code', prefill: true },
    ],
    buggenie: [
        { label: 'Review test results', prompt: 'Show the latest test execution results and failures', category: 'review', icon: 'chart' },
        { label: 'Create bug ticket', prompt: 'Create a Jira defect ticket for the latest test failures', category: 'action', icon: 'bug' },
    ],
    default: [
        { label: 'Start pipeline', prompt: 'Run the full automation pipeline for Jira ticket AOTF-', category: 'action', icon: 'play', prefill: true },
        { label: 'Run tests', prompt: 'Execute the test suite', category: 'action', icon: 'play' },
        { label: 'Explore framework', prompt: 'Show me the available page objects, business functions, and utilities in the test framework', category: 'explore', icon: 'search' },
    ],
};

// ─── Followup Provider Class ────────────────────────────────────────────────

class FollowupProvider {
    constructor() {
        // Track recently suggested followups to avoid repetition
        this._recentSuggestions = new Map(); // sessionId → Set of labels
        this._maxRecent = 20;
    }

    /**
     * Generate followup suggestions for a chat session after an AI response.
     *
     * @param {Object} options
     * @param {string} options.sessionId      - Chat session ID
     * @param {string} [options.agentMode]    - Agent mode (testgenie, scriptgenerator, etc.)
     * @param {string} [options.lastMessage]  - The assistant's last complete message
     * @param {Object[]} [options.messages]   - Full conversation history
     * @param {number} [options.maxFollowups] - Max suggestions to return (default: 3)
     * @returns {Followup[]} Array of followup suggestions
     */
    getChatFollowups(options = {}) {
        const {
            sessionId,
            agentMode = null,
            lastMessage = '',
            messages = [],
            maxFollowups = 3,
        } = options;

        const candidates = [];

        // 1. Content-based followups (highest priority — most contextual)
        if (lastMessage) {
            for (const rule of CONTENT_PATTERNS) {
                const matched = rule.patterns.some(p => p.test(lastMessage));
                if (matched) {
                    candidates.push(...rule.followups.map(f => ({ ...f, score: 10 })));
                }
            }
        }

        // 2. Agent mode defaults (lower priority — generic for the role)
        const modeKey = agentMode || 'default';
        const modeDefaults = AGENT_MODE_DEFAULTS[modeKey] || AGENT_MODE_DEFAULTS.default;
        candidates.push(...modeDefaults.map(f => ({ ...f, score: 3 })));

        // 3. Deduplicate by label
        const seen = new Set();
        const unique = candidates.filter(f => {
            if (seen.has(f.label)) return false;
            seen.add(f.label);
            return true;
        });

        // 4. Filter out recently suggested items (for variety)
        const recent = this._recentSuggestions.get(sessionId) || new Set();
        const fresh = unique.filter(f => !recent.has(f.label));
        const pool = fresh.length >= maxFollowups ? fresh : unique;

        // 5. Sort by score descending and take top N
        pool.sort((a, b) => (b.score || 0) - (a.score || 0));
        const selected = pool.slice(0, maxFollowups);

        // 6. Track what we suggested
        if (!this._recentSuggestions.has(sessionId)) {
            this._recentSuggestions.set(sessionId, new Set());
        }
        const recentSet = this._recentSuggestions.get(sessionId);
        for (const f of selected) {
            recentSet.add(f.label);
            if (recentSet.size > this._maxRecent) {
                // Evict oldest (reset if too large — Set doesn't have ordered eviction)
                this._recentSuggestions.set(sessionId, new Set());
            }
        }

        // 7. Return clean followups (strip score)
        return selected.map(({ score, ...f }) => f);
    }

    /**
     * Generate followup suggestions after a pipeline stage completes.
     *
     * @param {Object} options
     * @param {string} options.stage   - Pipeline stage name
     * @param {boolean} options.success - Whether the stage succeeded
     * @param {string} [options.ticketId] - Jira ticket ID
     * @param {Object} [options.stageResult] - Stage result data
     * @returns {Followup[]} Array of followup suggestions
     */
    getPipelineFollowups(options = {}) {
        const { stage, success, ticketId } = options;

        const stageConfig = PIPELINE_FOLLOWUPS[stage];
        if (!stageConfig) return [];

        const followups = success ? stageConfig.success : stageConfig.failure;
        if (!followups || followups.length === 0) return [];

        // Inject ticket ID into prompts if available
        if (ticketId) {
            return followups.map(f => ({
                ...f,
                prompt: f.prompt.replace(/AOTF-/g, ticketId),
            }));
        }

        return [...followups];
    }

    /**
     * Get initial followups when a session is first created (welcome suggestions).
     *
     * @param {string} agentMode
     * @returns {Followup[]}
     */
    getWelcomeFollowups(agentMode) {
        return [...(AGENT_MODE_DEFAULTS[agentMode] || AGENT_MODE_DEFAULTS.default)];
    }

    /**
     * Clean up tracked suggestions for a destroyed session.
     *
     * @param {string} sessionId
     */
    clearSession(sessionId) {
        this._recentSuggestions.delete(sessionId);
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

function getFollowupProvider() {
    if (!_instance) {
        _instance = new FollowupProvider();
    }
    return _instance;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    FollowupProvider,
    getFollowupProvider,
    PIPELINE_FOLLOWUPS,
    CONTENT_PATTERNS,
    AGENT_MODE_DEFAULTS,
};
