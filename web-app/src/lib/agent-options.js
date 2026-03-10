/**
 * Agent mode definitions for the AI Chat Agent Selector.
 * Each agent has a focused role, tools, and MCP servers.
 * `null` agentMode = default (all tools, all MCP servers).
 */

export const AGENT_MODES = [
    {
        value: null,
        label: 'TPM',
        shortLabel: 'TPM',
        description: 'Test Project Manager — unified agent with all capabilities',
        placeholder: 'Message TPM — I can generate test cases, automation scripts, bug tickets, and tasks...',
        color: 'violet',        // command-center purple
        bgClass: 'bg-violet-50',
        textClass: 'text-violet-600',
        activeClass: 'bg-violet-600 text-white',
        badgeBg: 'bg-violet-100',
        badgeText: 'text-violet-700',
        icon: 'tpm',
    },
    {
        value: 'testgenie',
        label: 'TestGenie',
        shortLabel: 'TG',
        description: 'Generate test cases from Jira tickets with Excel export',
        placeholder: 'Describe the Jira ticket for test cases...',
        color: 'blue',
        bgClass: 'bg-blue-50',
        textClass: 'text-blue-600',
        activeClass: 'bg-blue-600 text-white',
        badgeBg: 'bg-blue-100',
        badgeText: 'text-blue-700',
        icon: 'document',
    },
    {
        value: 'scriptgenerator',
        label: 'ScriptGenie',
        shortLabel: 'SG',
        description: 'Create Playwright automation scripts via MCP exploration',
        placeholder: 'Describe the test to automate...',
        color: 'emerald',
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-600',
        activeClass: 'bg-emerald-600 text-white',
        badgeBg: 'bg-emerald-100',
        badgeText: 'text-emerald-700',
        icon: 'code',
    },
    {
        value: 'buggenie',
        label: 'BugGenie',
        shortLabel: 'BG',
        description: 'Create bug tickets from test failures via Jira',
        placeholder: 'Describe the bug or paste failure details...',
        color: 'red',
        bgClass: 'bg-red-50',
        textClass: 'text-red-600',
        activeClass: 'bg-red-600 text-white',
        badgeBg: 'bg-red-100',
        badgeText: 'text-red-700',
        icon: 'bug',
    },
    {
        value: 'taskgenie',
        label: 'TaskGenie',
        shortLabel: 'TK',
        description: 'Create linked Testing tasks in Jira with auto-assignment',
        placeholder: 'Paste Jira ticket URL or describe the testing task...',
        color: 'amber',
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-600',
        activeClass: 'bg-amber-600 text-white',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-700',
        icon: 'task',
    },
    {
        value: 'filegenie',
        label: 'FileGenie',
        shortLabel: 'FG',
        description: 'Interact with local files — organize, search, summarize documents',
        placeholder: 'Ask me to organize files, summarize a PDF, search documents...',
        color: 'cyan',
        bgClass: 'bg-cyan-50',
        textClass: 'text-cyan-600',
        activeClass: 'bg-cyan-600 text-white',
        badgeBg: 'bg-cyan-100',
        badgeText: 'text-cyan-700',
        icon: 'file',
    },
];

/**
 * Get agent config by value (null for default).
 */
export function getAgentConfig(agentMode) {
    return AGENT_MODES.find(a => a.value === agentMode) || AGENT_MODES[0];
}

/**
 * Get display label for an agent mode.
 */
export function getAgentLabel(agentMode) {
    return getAgentConfig(agentMode).label;
}
