const { StudioWorkspaceRegistry } = require('./studio-workspace-registry');

function buildCoreAgentId(agentMode) {
    return `core:${agentMode || 'tpm'}`;
}

function buildWorkspaceAgentId(workspaceId, assetId) {
    return `workspace:${workspaceId}:${assetId}`;
}

function deriveShortLabel(label) {
    const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'AG';
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return parts.slice(0, 3).map(part => part[0]).join('').toUpperCase();
}

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
        case null:
        default:
            return { browser: true, jira: true, filesystem: 'read' };
    }
}

const CORE_AGENT_DEFINITIONS = [
    {
        agentMode: null,
        label: 'TPM',
        shortLabel: 'TPM',
        description: 'Test Project Manager — unified agent with all capabilities',
        placeholder: 'Message TPM — I can generate test cases, automation scripts, bug tickets, and tasks...',
        color: 'violet',
        bgClass: 'bg-violet-50',
        textClass: 'text-violet-600',
        activeClass: 'bg-violet-600 text-white',
        badgeBg: 'bg-violet-100',
        badgeText: 'text-violet-700',
        icon: 'tpm',
    },
    {
        agentMode: 'testgenie',
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
        agentMode: 'scriptgenerator',
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
        agentMode: 'buggenie',
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
        agentMode: 'taskgenie',
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
        agentMode: 'filegenie',
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
        agentMode: 'docgenie',
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

const CORE_AGENTS = CORE_AGENT_DEFINITIONS.map((definition) => {
    const toolProfile = definition.agentMode || 'full';
    return {
        ...definition,
        id: buildCoreAgentId(definition.agentMode),
        source: 'core',
        workspaceId: null,
        workspaceName: null,
        assetId: definition.agentMode || 'tpm',
        toolProfile,
        followupMode: definition.agentMode || 'default',
        capabilities: deriveCapabilities(definition.agentMode),
        status: 'published',
        isActive: true,
        isPublished: true,
        surfaces: ['chat'],
        isCustom: false,
    };
});

const CORE_AGENT_BY_ID = new Map(CORE_AGENTS.map(agent => [agent.id, agent]));
const CORE_AGENT_BY_MODE = new Map(CORE_AGENTS.map(agent => [agent.agentMode || 'default', agent]));

function toPublicAgentDescriptor(agent) {
    if (!agent) return null;
    const {
        id,
        source,
        workspaceId,
        workspaceName,
        assetId,
        label,
        shortLabel,
        description,
        placeholder,
        color,
        bgClass,
        textClass,
        activeClass,
        badgeBg,
        badgeText,
        icon,
        agentMode,
        toolProfile,
        followupMode,
        capabilities,
        capabilityProfile,
        toolCategories,
        mcpToolProfile,
        browserGateway,
        browserGatewayProfile,
        brokerEnabled,
        status,
        isActive,
        isPublished,
        surfaces,
        isCustom,
        publishedAt,
        activatedAt,
    } = agent;

    return {
        id,
        source,
        workspaceId,
        workspaceName,
        assetId,
        label,
        shortLabel,
        description,
        placeholder,
        color,
        bgClass,
        textClass,
        activeClass,
        badgeBg,
        badgeText,
        icon,
        agentMode,
        toolProfile,
        followupMode,
        capabilities,
        capabilityProfile: capabilityProfile || null,
        toolCategories: Array.isArray(toolCategories) ? toolCategories : [],
        mcpToolProfile: mcpToolProfile || null,
        browserGateway: browserGateway === true,
        browserGatewayProfile: browserGatewayProfile || null,
        brokerEnabled: typeof brokerEnabled === 'boolean' ? brokerEnabled : null,
        status,
        isActive,
        isPublished,
        surfaces,
        isCustom,
        publishedAt: publishedAt || null,
        activatedAt: activatedAt || null,
    };
}

class AgentCatalogService {
    constructor(options = {}) {
        this.workspaceRegistry = options.workspaceRegistry || new StudioWorkspaceRegistry(options);
        this.logger = typeof options.logger === 'function' ? options.logger : null;
    }

    listCoreAgents() {
        return CORE_AGENTS.map(agent => ({ ...agent }));
    }

    getCoreAgentByMode(agentMode = null) {
        return { ...(CORE_AGENT_BY_MODE.get(agentMode || 'default') || CORE_AGENT_BY_ID.get(buildCoreAgentId(null))) };
    }

    getCoreAgentById(agentId) {
        const core = CORE_AGENT_BY_ID.get(agentId);
        return core ? { ...core } : null;
    }

    async listChatAgents(options = {}) {
        const includeInactive = options.includeInactive === true;
        const includeDraft = options.includeDraft === true;
        const items = this.listCoreAgents().map(toPublicAgentDescriptor);

        // Workspace agents are best-effort: a bad/missing workspace catalog must never
        // wipe out the always-available core specialists (the whole dropdown would go empty).
        let workspaces = [];
        try {
            workspaces = await this.workspaceRegistry.listWorkspaces();
        } catch (error) {
            this._logWarn(`Failed to enumerate studio workspaces; returning core agents only: ${error.message}`);
            return items;
        }

        for (const workspace of workspaces) {
            try {
                const catalog = await this.workspaceRegistry.getWorkspaceCatalog(workspace.id);
                for (const agent of catalog.assets.agents || []) {
                    const isPublished = agent.status === 'published';
                    if (!isPublished && !includeDraft) continue;
                    if (isPublished && !agent.isActive && !includeInactive) continue;
                    if (!Array.isArray(agent.surfaces) || !agent.surfaces.includes('chat')) continue;
                    items.push(toPublicAgentDescriptor(this._buildWorkspaceAgentDescriptor(catalog.workspace, agent)));
                }
            } catch (error) {
                this._logWarn(`Skipping workspace ${workspace?.id || '(unknown)'} in chat agent list: ${error.message}`);
            }
        }

        return items;
    }

    _logWarn(message) {
        try {
            if (typeof this.logger === 'function') this.logger(message, 'warn');
            else console.warn(`[AgentCatalog] ${message}`);
        } catch { /* logging must never throw */ }
    }

    async resolveAgentSelection(options = {}) {
        const legacyMode = options.agentMode || null;
        const requestedAgentId = String(options.agentId || '').trim();
        const allowDraft = options.allowDraft === true;
        const allowInactive = options.allowInactive === true;

        if (!requestedAgentId) {
            return this.getCoreAgentByMode(legacyMode);
        }

        if (CORE_AGENT_BY_ID.has(requestedAgentId)) {
            return this.getCoreAgentById(requestedAgentId);
        }

        if (!requestedAgentId.startsWith('workspace:')) {
            return this.getCoreAgentByMode(legacyMode);
        }

        const parts = requestedAgentId.split(':');
        if (parts.length < 3) {
            throw this._createCatalogError(`Invalid workspace agent id: ${requestedAgentId}`, 400, 'invalid_agent_id');
        }

        const workspaceId = parts[1];
        const assetId = parts.slice(2).join(':');
        const catalog = await this.workspaceRegistry.getWorkspaceCatalog(workspaceId);
        const agent = (catalog.assets.agents || []).find(item => item.id === assetId);
        if (!agent) {
            throw this._createCatalogError(`Workspace agent not found: ${requestedAgentId}`, 404, 'agent_not_found');
        }

        if (!allowDraft && agent.status !== 'published') {
            throw this._createCatalogError(`Agent ${agent.name} is still in draft state`, 409, 'agent_not_published');
        }

        if (!allowInactive && !agent.isActive) {
            throw this._createCatalogError(`Agent ${agent.name} is published but not active`, 409, 'agent_not_active');
        }

        return this._buildWorkspaceAgentDescriptor(catalog.workspace, agent);
    }

    _buildWorkspaceAgentDescriptor(workspace, agent) {
        const baseCore = this.getCoreAgentByMode(agent.toolProfile === 'full' ? null : agent.toolProfile);
        return {
            ...baseCore,
            id: buildWorkspaceAgentId(workspace.id, agent.id),
            source: 'workspace',
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            assetId: agent.id,
            label: agent.name,
            shortLabel: agent.shortLabel || deriveShortLabel(agent.name),
            description: agent.description || `Published workspace agent from ${workspace.name}`,
            placeholder: `Message ${agent.name}...`,
            agentMode: agent.toolProfile === 'full' ? null : agent.toolProfile,
            toolProfile: agent.toolProfile || 'full',
            followupMode: agent.followupMode || (agent.toolProfile === 'full' ? 'default' : agent.toolProfile),
            capabilities: agent.capabilities || baseCore.capabilities,
            capabilityProfile: agent.capabilityProfile || null,
            toolCategories: Array.isArray(agent.toolCategories) ? agent.toolCategories : [],
            mcpToolProfile: agent.mcpToolProfile || null,
            browserGateway: agent.browserGateway === true,
            browserGatewayProfile: agent.browserGatewayProfile || null,
            brokerEnabled: typeof agent.brokerEnabled === 'boolean' ? agent.brokerEnabled : null,
            status: agent.status,
            isActive: !!agent.isActive,
            isPublished: agent.status === 'published',
            isCustom: true,
            publishedAt: agent.publishedAt || null,
            activatedAt: agent.activatedAt || null,
            surfaces: Array.isArray(agent.surfaces) && agent.surfaces.length > 0 ? agent.surfaces : ['chat'],
            promptPath: agent.promptPath,
            manifestPath: agent.manifestPath,
            files: Array.isArray(agent.files) ? agent.files : [],
        };
    }

    _createCatalogError(message, status, code) {
        const error = new Error(message);
        error.status = status;
        error.code = code;
        return error;
    }
}

module.exports = {
    AgentCatalogService,
    CORE_AGENTS,
    CORE_AGENT_DEFINITIONS,
    buildCoreAgentId,
    buildWorkspaceAgentId,
    toPublicAgentDescriptor,
};