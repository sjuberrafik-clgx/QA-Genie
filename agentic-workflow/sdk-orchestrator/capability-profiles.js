/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CAPABILITY PROFILES — Studio-time templates for workspace/custom agents
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A Capability Profile is a named bundle of:
 *   • base capabilities (browser, jira, filesystem)
 *   • allowed tool categories (jira/document/framework/grounding/...)
 *   • MCP attachment profile (when browser is enabled): explorer-nav, core, full
 *   • whether the broker delegation escape hatch is enabled
 *
 * Profiles are the source of truth at Studio create-time. Runtime intent
 * inference (see chat-session-manager._inferToolCategoriesForAgent and
 * _buildWorkspaceDelegationHint) operates strictly INSIDE the envelope a
 * profile defines — it can broaden category selection within allowed
 * categories, but it cannot grant a category the profile excludes.
 *
 * Design constraints:
 *   • Workspace agents stay well under CAPI's 128-tool hard cap.
 *   • A custom agent without a profile falls back to the conservative
 *     intent-inferred set (unchanged from Phase 1/2 behaviour).
 *   • Adding a new profile requires only editing this file.
 *
 * @module capability-profiles
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ─── Profile Definitions ────────────────────────────────────────────────────

/**
 * @typedef {Object} CapabilityProfile
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {{browser: boolean, jira: boolean, filesystem: 'none'|'read'|'write'}} capabilities
 * @property {string[]} categories       Tool-broker categories enabled natively + via broker
 * @property {string|null} mcpProfile    MCP server profile when browser=true (null if browser=false)
 * @property {boolean} brokerEnabled     Whether to inject broker meta-tools (almost always true)
 */

/** @type {Object<string, CapabilityProfile>} */
const CAPABILITY_PROFILES = {
    'text-knowledge': {
        id: 'text-knowledge',
        label: 'Text & Knowledge',
        description: 'Summarisers, Q&A bots, knowledge-base assistants. No browser, no Jira writes.',
        capabilities: { browser: false, jira: false, filesystem: 'read' },
        categories: ['document', 'docparse', 'grounding'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    'jira-aware': {
        id: 'jira-aware',
        label: 'Jira-Aware Assistant',
        description: 'Reads/updates Jira tickets, adds comments, attaches evidence. No browser.',
        capabilities: { browser: false, jira: true, filesystem: 'read' },
        categories: ['jira', 'evidence', 'grounding', 'document'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    'browser-sanity': {
        id: 'browser-sanity',
        label: 'Browser Sanity / Smoke Tester',
        description: 'UI sanity, smoke tests, page exploration. Attaches a scoped Playwright MCP profile.',
        capabilities: { browser: true, jira: false, filesystem: 'read' },
        categories: ['framework', 'grounding', 'evidence'],
        // explorer-nav exposes ~35 MCP tools — well below the 128 CAPI cap.
        mcpProfile: 'explorer-nav',
        brokerEnabled: true,
    },
    'automation-script': {
        id: 'automation-script',
        label: 'Automation Script Author',
        description: 'Generates and executes Playwright specs. Full framework + grounding access.',
        capabilities: { browser: true, jira: true, filesystem: 'write' },
        categories: ['framework', 'grounding', 'evidence', 'jira'],
        mcpProfile: 'core',
        brokerEnabled: true,
    },
    'document-gen': {
        id: 'document-gen',
        label: 'Document Generator',
        description: 'Produces PPT, PDF, DOCX, Excel deliverables. No browser, no Jira writes.',
        capabilities: { browser: false, jira: false, filesystem: 'write' },
        categories: ['document', 'docparse', 'grounding'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    'repo-code': {
        id: 'repo-code',
        label: 'Repository Code Assistant',
        description: 'Read/write code, search workspace, no browser. Useful for code-focused custom agents.',
        capabilities: { browser: false, jira: true, filesystem: 'write' },
        categories: ['framework', 'grounding', 'docparse'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    'full-orchestrator': {
        id: 'full-orchestrator',
        label: 'Full Orchestrator',
        description: 'All categories enabled. Use sparingly — closer to CAPI 128-tool cap.',
        capabilities: { browser: true, jira: true, filesystem: 'write' },
        categories: ['jira', 'evidence', 'document', 'framework', 'grounding', 'pipeline', 'docparse'],
        mcpProfile: 'core',
        brokerEnabled: true,
    },
};

const ALL_PROFILE_IDS = Object.keys(CAPABILITY_PROFILES);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a capability profile by id. Returns null if not found.
 * @param {string|null|undefined} profileId
 * @returns {CapabilityProfile|null}
 */
function getCapabilityProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') return null;
    return CAPABILITY_PROFILES[profileId] || null;
}

/**
 * Return the list of available profiles (id + label + description).
 * Used by Studio UI to render a capability-profile selector.
 * @returns {Array<{id: string, label: string, description: string}>}
 */
function listCapabilityProfiles() {
    return ALL_PROFILE_IDS.map(id => {
        const p = CAPABILITY_PROFILES[id];
        return {
            id: p.id,
            label: p.label,
            description: p.description,
            capabilities: { ...p.capabilities },
            categories: [...p.categories],
            mcpProfile: p.mcpProfile,
            brokerEnabled: p.brokerEnabled,
        };
    });
}

/**
 * Apply a capability profile's defaults onto an agentSelection, only filling
 * in fields the agent hasn't explicitly set. This makes the profile a
 * NON-DESTRUCTIVE template — the agent author's explicit values win.
 *
 * Returns a new object (does not mutate input).
 *
 * @param {Object} agentSelection
 * @returns {Object} The (possibly enriched) agentSelection
 */
function applyCapabilityProfile(agentSelection) {
    if (!agentSelection || typeof agentSelection !== 'object') return agentSelection;
    const profile = getCapabilityProfile(agentSelection.capabilityProfile);
    if (!profile) return agentSelection;

    const merged = { ...agentSelection };

    // Capabilities — only fill in fields the agent did not specify
    const existingCaps = (agentSelection.capabilities && typeof agentSelection.capabilities === 'object')
        ? agentSelection.capabilities
        : {};
    merged.capabilities = {
        browser: existingCaps.browser !== undefined ? existingCaps.browser : profile.capabilities.browser,
        jira: existingCaps.jira !== undefined ? existingCaps.jira : profile.capabilities.jira,
        filesystem: existingCaps.filesystem !== undefined ? existingCaps.filesystem : profile.capabilities.filesystem,
    };

    // Tool categories — explicit categories on agentSelection win
    if (!Array.isArray(agentSelection.toolCategories) || agentSelection.toolCategories.length === 0) {
        merged.toolCategories = [...profile.categories];
    }

    // MCP profile override — only when browser is enabled and the agent didn't set one
    if (merged.capabilities.browser && !agentSelection.mcpToolProfile && profile.mcpProfile) {
        merged.mcpToolProfile = profile.mcpProfile;
    }

    // Broker enabled flag (default true)
    if (typeof agentSelection.brokerEnabled !== 'boolean') {
        merged.brokerEnabled = profile.brokerEnabled;
    }

    // Mark the source so logs and downstream consumers can trace decisions
    merged._capabilityProfileResolved = profile.id;
    return merged;
}

module.exports = {
    CAPABILITY_PROFILES,
    ALL_PROFILE_IDS,
    getCapabilityProfile,
    listCapabilityProfiles,
    applyCapabilityProfile,
};
