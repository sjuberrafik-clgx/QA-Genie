/**
 * Agent mode definitions for the AI Chat Agent Selector.
 * Each agent has a focused role, tools, and MCP servers.
 * `null` agentMode = default (all tools, all MCP servers).
 */

export const AGENT_MODES = [
    {
        value: null,
        label: 'Default',
        shortLabel: 'AI',
        description: 'General QA assistant with all capabilities',
        placeholder: 'Message AI Assistant...',
        color: 'surface',       // neutral gray
        bgClass: 'bg-surface-100',
        textClass: 'text-surface-600',
        activeClass: 'bg-surface-800 text-white',
        badgeBg: 'bg-surface-100',
        badgeText: 'text-surface-600',
        icon: 'sparkle',
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
