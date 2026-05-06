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
        description: 'Create linked testing tasks, true subtasks, and assignment-ready Jira work items',
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
    {
        value: 'docgenie',
        label: 'DocGenie',
        shortLabel: 'DG',
        description: 'Generate presentations, reports, infographics, and workbook-driven documents',
        placeholder: 'Ask me to turn a workbook, report, or brief into a polished presentation...',
        color: 'indigo',
        bgClass: 'bg-indigo-50',
        textClass: 'text-indigo-600',
        activeClass: 'bg-indigo-600 text-white',
        badgeBg: 'bg-indigo-100',
        badgeText: 'text-indigo-700',
        icon: 'docgenie',
    },
];

function deriveCapabilities(agentMode) {
    switch (agentMode) {
        case 'scriptgenerator':
            return { browser: true, jira: false, filesystem: 'none' };
        case 'testgenie':
        case 'buggenie':
        case 'taskgenie':
            return { browser: false, jira: true, filesystem: 'none' };
        case 'filegenie':
            return { browser: false, jira: false, filesystem: 'write' };
        case 'docgenie':
            return { browser: false, jira: false, filesystem: 'none' };
        default:
            return { browser: true, jira: true, filesystem: 'read' };
    }
}

function deriveShortLabel(label) {
    const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'AG';
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return parts.slice(0, 3).map(part => part[0]).join('').toUpperCase();
}

export function buildCoreAgentId(agentMode = null) {
    return `core:${agentMode || 'tpm'}`;
}

export function getFallbackAgentCatalog() {
    return AGENT_MODES.map((agent) => ({
        ...agent,
        id: buildCoreAgentId(agent.value),
        source: 'core',
        workspaceId: null,
        workspaceName: null,
        assetId: agent.value || 'tpm',
        agentMode: agent.value,
        toolProfile: agent.value || 'full',
        followupMode: agent.value || 'default',
        capabilities: deriveCapabilities(agent.value),
        status: 'published',
        isActive: true,
        isPublished: true,
        surfaces: ['chat'],
        isCustom: false,
    }));
}

export function normalizeAgentCatalogItem(agent) {
    if (!agent) return getFallbackAgentCatalog()[0];

    const fallbackCatalog = getFallbackAgentCatalog();
    const fallback = fallbackCatalog.find((item) => (
        item.id === agent.id
        || item.agentMode === agent.agentMode
        || (agent.id === buildCoreAgentId(null) && item.agentMode === null)
    )) || fallbackCatalog[0];

    return {
        ...fallback,
        ...agent,
        shortLabel: agent.shortLabel || fallback.shortLabel || deriveShortLabel(agent.label || fallback.label),
        agentMode: Object.prototype.hasOwnProperty.call(agent, 'agentMode') ? agent.agentMode : fallback.agentMode,
        toolProfile: agent.toolProfile || fallback.toolProfile,
        followupMode: agent.followupMode || fallback.followupMode,
        capabilities: agent.capabilities || fallback.capabilities,
        surfaces: Array.isArray(agent.surfaces) && agent.surfaces.length > 0 ? agent.surfaces : fallback.surfaces,
        isCustom: agent.isCustom === true,
    };
}

/**
 * Get agent config by value (null for default).
 */
export function getAgentConfig(agentRef, agents = getFallbackAgentCatalog()) {
    if (agentRef && typeof agentRef === 'object' && !Array.isArray(agentRef)) {
        return normalizeAgentCatalogItem(agentRef);
    }

    const catalog = Array.isArray(agents) && agents.length > 0
        ? agents.map(normalizeAgentCatalogItem)
        : getFallbackAgentCatalog();

    return catalog.find((agent) => (
        agent.id === agentRef
        || agent.agentMode === agentRef
        || (agentRef == null && agent.id === buildCoreAgentId(null))
    )) || catalog[0];
}

/**
 * Get display label for an agent mode.
 */
export function getAgentLabel(agentRef, agents = getFallbackAgentCatalog()) {
    return getAgentConfig(agentRef, agents).label;
}
