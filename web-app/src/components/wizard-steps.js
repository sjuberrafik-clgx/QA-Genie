'use client';

function ArrowLeftIcon({ className }) {
    return (<svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" /></svg>);
}
function CheckCircleIcon({ className }) {
    return (<svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>);
}

const STEPS = [
    { id: 'template', label: 'Template' },
    { id: 'identity', label: 'Identity' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'tools', label: 'Tools & MCP' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'review', label: 'Review' },
];

function StepIndicator({ currentStep }) {
    const currentIdx = STEPS.findIndex(s => s.id === currentStep);
    return (
        <nav className="flex items-center gap-1">
            {STEPS.map((step, idx) => {
                const isComplete = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                return (
                    <div key={step.id} className="flex items-center gap-1">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${isComplete ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-surface-100 text-surface-400'}`}>
                            {isComplete ? <CheckCircleIcon className="h-4 w-4" /> : idx + 1}
                        </div>
                        <span className={`hidden text-[11px] font-semibold sm:inline ${isCurrent ? 'text-surface-900' : 'text-surface-400'}`}>{step.label}</span>
                        {idx < STEPS.length - 1 && <div className="mx-1 h-px w-4 bg-surface-200 sm:w-8" />}
                    </div>
                );
            })}
        </nav>
    );
}

// ───────────────────────────────────────────────────────────────
// Category/Template colors
// ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
    'qa-automation': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    devops: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    support: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    research: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    content: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    custom: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
};

// ───────────────────────────────────────────────────────────────
// Tool Profiles
// ───────────────────────────────────────────────────────────────

const TOOL_PROFILES = [
    { value: 'full', label: 'Full (All tools)', description: 'Browser, Jira, filesystem — everything' },
    { value: 'testgenie', label: 'TestGenie', description: 'Jira-focused, test case generation' },
    { value: 'scriptgenerator', label: 'ScriptGenerator', description: 'Browser/MCP-focused, script generation' },
    { value: 'buggenie', label: 'BugGenie', description: 'Jira-focused, bug ticket creation' },
    { value: 'taskgenie', label: 'TaskGenie', description: 'Jira-focused, task management' },
    { value: 'filegenie', label: 'FileGenie', description: 'Filesystem-focused, document interaction' },
    { value: 'docgenie', label: 'DocGenie', description: 'Document generation, presentations' },
    { value: 'codereviewer', label: 'CodeReviewer', description: 'Code review and quality analysis' },
];

const FALLBACK_CAPABILITY_PROFILES = [
    {
        id: 'text-knowledge',
        label: 'Text & Knowledge',
        description: 'Summaries, Q&A, documentation, and local context. No browser or Jira by default.',
        capabilities: { browser: false, jira: false, filesystem: 'read' },
        categories: ['document', 'docparse', 'grounding'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    {
        id: 'jira-aware',
        label: 'Jira-Aware Assistant',
        description: 'Reads and updates Jira through approval-safe tools. No browser MCP attached.',
        capabilities: { browser: false, jira: true, filesystem: 'read' },
        categories: ['jira', 'evidence', 'grounding', 'document'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    {
        id: 'browser-sanity',
        label: 'Browser Sanity / Smoke Tester',
        description: 'Lightweight browser exploration and sanity checks with a scoped MCP profile.',
        capabilities: { browser: true, jira: false, filesystem: 'read' },
        categories: ['framework', 'grounding', 'evidence'],
        mcpProfile: 'explorer-nav',
        brokerEnabled: true,
    },
    {
        id: 'automation-script',
        label: 'Automation Script Author',
        description: 'Generates and executes Playwright specs with framework and Jira context.',
        capabilities: { browser: true, jira: true, filesystem: 'write' },
        categories: ['framework', 'grounding', 'evidence', 'jira'],
        mcpProfile: 'core',
        brokerEnabled: true,
    },
    {
        id: 'document-gen',
        label: 'Document Generator',
        description: 'Produces PPT, PDF, DOCX, and Excel deliverables. No browser or Jira by default.',
        capabilities: { browser: false, jira: false, filesystem: 'write' },
        categories: ['document', 'docparse', 'grounding'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    {
        id: 'repo-code',
        label: 'Repository Code Assistant',
        description: 'Reads and updates project code with framework and grounding support.',
        capabilities: { browser: false, jira: true, filesystem: 'write' },
        categories: ['framework', 'grounding', 'docparse'],
        mcpProfile: null,
        brokerEnabled: true,
    },
    {
        id: 'full-orchestrator',
        label: 'Full Orchestrator',
        description: 'Broad browser, Jira, filesystem, and pipeline access. Highest tool budget.',
        capabilities: { browser: true, jira: true, filesystem: 'write' },
        categories: ['jira', 'evidence', 'document', 'framework', 'grounding', 'pipeline', 'docparse'],
        mcpProfile: 'core',
        brokerEnabled: true,
    },
];

const CAPABILITY_CATEGORY_OPTIONS = [
    { value: 'jira', label: 'Jira' },
    { value: 'evidence', label: 'Evidence' },
    { value: 'document', label: 'Document' },
    { value: 'docparse', label: 'Doc Parse' },
    { value: 'framework', label: 'Framework' },
    { value: 'grounding', label: 'Grounding' },
    { value: 'pipeline', label: 'Pipeline' },
    { value: 'testcase', label: 'Test Cases' },
];

const MCP_TOOL_PROFILE_OPTIONS = [
    { value: '', label: 'Auto', description: 'Use the selected capability profile default.' },
    { value: 'intelligent', label: 'Intelligent', description: 'Primitives-first: act / observe / extract + autonomous crawl. Leanest surface, recommended.' },
    { value: 'dryrun', label: 'Dry Run', description: 'Smallest browser tool surface for planning.' },
    { value: 'explorer-nav', label: 'Explorer Nav', description: 'Navigation and page discovery.' },
    { value: 'explorer-interact', label: 'Explorer Interact', description: 'Focused interaction and validation tools.' },
    { value: 'core', label: 'Core', description: 'Standard Playwright automation toolkit.' },
    { value: 'advanced', label: 'Advanced', description: 'Larger browser toolkit for complex flows.' },
    { value: 'full', label: 'Full', description: 'All browser MCP tools; use only when needed.' },
];

const BROWSER_GATEWAY_PROFILE_OPTIONS = [
    { value: 'dryrun', label: 'Dry Run' },
    { value: 'deferred', label: 'Deferred' },
    { value: 'explorer-nav', label: 'Explorer Nav' },
];

function getCapabilityProfiles(profiles) {
    return Array.isArray(profiles) && profiles.length > 0 ? profiles : FALLBACK_CAPABILITY_PROFILES;
}

function findCapabilityProfile(profileId, profiles) {
    const available = getCapabilityProfiles(profiles);
    return available.find((profile) => profile.id === profileId) || available[0];
}

function deriveCapabilityProfileFromConfig(config = {}) {
    if (typeof config.capabilityProfile === 'string' && config.capabilityProfile.trim()) return config.capabilityProfile.trim();
    const capabilities = config.capabilities && typeof config.capabilities === 'object' ? config.capabilities : {};
    const toolProfile = String(config.toolProfile || '').trim().toLowerCase();
    if (capabilities.browser === true) return toolProfile === 'scriptgenerator' ? 'automation-script' : 'browser-sanity';
    if (capabilities.jira === true) return 'jira-aware';
    if (toolProfile === 'filegenie' || toolProfile === 'docgenie') return 'document-gen';
    if (toolProfile === 'codereviewer') return 'repo-code';
    return 'text-knowledge';
}

function normalizeCapabilityRuntimeConfig(config = {}, profiles = FALLBACK_CAPABILITY_PROFILES) {
    const capabilityProfile = deriveCapabilityProfileFromConfig(config);
    const profile = findCapabilityProfile(capabilityProfile, profiles);
    const sourceCapabilities = config.capabilities && typeof config.capabilities === 'object' ? config.capabilities : null;
    const capabilities = sourceCapabilities ? { ...sourceCapabilities } : { ...profile.capabilities };
    const toolCategories = Array.isArray(config.toolCategories) && config.toolCategories.length > 0
        ? [...config.toolCategories]
        : [...(profile.categories || [])];
    const browserEnabled = capabilities.browser === true;

    return {
        capabilityProfile: profile.id,
        capabilities,
        toolCategories,
        mcpToolProfile: browserEnabled ? (config.mcpToolProfile || profile.mcpProfile || 'explorer-nav') : '',
        browserGateway: !browserEnabled && config.browserGateway === true,
        browserGatewayProfile: config.browserGatewayProfile || 'dryrun',
        brokerEnabled: typeof config.brokerEnabled === 'boolean' ? config.brokerEnabled : profile.brokerEnabled !== false,
    };
}

const PERMISSION_MODES = [
    { value: 'default', label: 'Default', description: 'Ask before destructive actions' },
    { value: 'accept_edits', label: 'Accept Edits', description: 'Auto-approve file edits, confirm shell commands' },
    { value: 'bypass', label: 'Bypass All', description: 'No confirmations (use with caution)' },
];

// ───────────────────────────────────────────────────────────────
// Main Wizard Component
// ───────────────────────────────────────────────────────────────


// ───────────────────────────────────────────────────────────────
// Step 1: Template Selection
// ───────────────────────────────────────────────────────────────

function TemplateStep({ templates, categories, selectedCategory, searchQuery, loading, onSelectCategory, onSearchChange, onSelectTemplate, onStartBlank }) {
    return (
        <div className="mx-auto max-w-4xl">
            <div className="mb-6 text-center">
                <h3 className="text-xl font-bold text-surface-900">Choose a starting point</h3>
                <p className="mt-1 text-[13px] text-surface-500">Start from a template or create a blank agent</p>
            </div>

            {/* Start Blank */}
            <button
                onClick={onStartBlank}
                className="mb-6 w-full rounded-2xl border-2 border-dashed border-surface-200 bg-surface-50/50 px-6 py-5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50"
            >
                <div className="text-sm font-bold text-surface-800">Start from scratch</div>
                <div className="mt-0.5 text-[12px] text-surface-500">Create a blank agent and configure everything manually</div>
            </button>

            {/* Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                    onClick={() => onSelectCategory(null)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${!selectedCategory ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
                >
                    All
                </button>
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => onSelectCategory(cat.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${selectedCategory === cat.id ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
                    >
                        {cat.label}
                    </button>
                ))}
                <input
                    type="text"
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    className="ml-auto w-56 rounded-xl border border-surface-200 bg-white px-3 py-1.5 text-[12px] text-surface-700 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
            </div>

            {/* Template Grid */}
            {loading ? (
                <div className="py-12 text-center text-[13px] text-surface-400">Loading templates...</div>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map(template => {
                        const colors = CATEGORY_COLORS[template.category] || CATEGORY_COLORS.custom;
                        return (
                            <button
                                key={template.id}
                                onClick={() => onSelectTemplate(template)}
                                className="group rounded-2xl border border-surface-200 bg-white p-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
                            >
                                <div className="flex items-start justify-between">
                                    <div className={`rounded-lg ${colors.bg} px-2 py-1 text-[10px] font-bold ${colors.text}`}>
                                        {template.category}
                                    </div>
                                    {template.source === 'builtin' && (
                                        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">Built-in</span>
                                    )}
                                </div>
                                <h4 className="mt-3 text-[14px] font-bold text-surface-900 group-hover:text-blue-700">{template.name}</h4>
                                <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-surface-500">{template.description}</p>
                                {template.tags?.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-1">
                                        {template.tags.slice(0, 4).map(tag => (
                                            <span key={tag} className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">{tag}</span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Step 2: Identity
// ───────────────────────────────────────────────────────────────

function IdentityStep({ config, onChange }) {
    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <h3 className="text-lg font-bold text-surface-900">Agent Identity</h3>
                <p className="mt-0.5 text-[13px] text-surface-500">Name and describe your agent</p>
            </div>
            <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Name *</label>
                <input
                    type="text"
                    value={config.name}
                    onChange={e => onChange({ name: e.target.value })}
                    placeholder="e.g. Release Planner"
                    className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
            </div>
            <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Description</label>
                <textarea
                    value={config.description}
                    onChange={e => onChange({ description: e.target.value })}
                    placeholder="What does this agent do?"
                    rows={3}
                    className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Category</label>
                    <select
                        value={config.category}
                        onChange={e => onChange({ category: e.target.value })}
                        className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                    >
                        {Object.entries(CATEGORY_COLORS).map(([id]) => (
                            <option key={id} value={id}>{id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Tags</label>
                    <input
                        type="text"
                        value={config.tags}
                        onChange={e => onChange({ tags: e.target.value })}
                        placeholder="e.g. qa, automation, jira"
                        className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                    />
                </div>
            </div>
            {config.templateName && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
                    <span className="text-[12px] font-semibold text-violet-700">Forked from: {config.templateName}</span>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Step 3: Prompt Editor
// ───────────────────────────────────────────────────────────────

function PromptStep({ config, onChange }) {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <div>
                <h3 className="text-lg font-bold text-surface-900">System Prompt</h3>
                <p className="mt-0.5 text-[13px] text-surface-500">Define your agent&apos;s behavior, responsibilities, and output format</p>
            </div>
            <textarea
                value={config.promptBody}
                onChange={e => onChange({ promptBody: e.target.value })}
                rows={20}
                className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 font-mono text-[12px] leading-5 text-surface-800 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                placeholder="# Agent Name\n\n## Purpose\n...\n\n## Responsibilities\n- ..."
            />
            <div className="flex items-center gap-3 text-[11px] text-surface-400">
                <span>{config.promptBody.split(/\s+/).filter(Boolean).length} words</span>
                <span>|</span>
                <span>{config.promptBody.split('\n').length} lines</span>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Step 4: Tools & MCP
// ───────────────────────────────────────────────────────────────

function ToolsStep({ config, onChange, mcpServers, capabilityProfiles = [] }) {
    const profiles = getCapabilityProfiles(capabilityProfiles);
    const selectedProfile = findCapabilityProfile(config.capabilityProfile || deriveCapabilityProfileFromConfig(config), profiles);
    const capabilities = config.capabilities || { browser: false, jira: false, filesystem: 'read' };
    const toolCategories = Array.isArray(config.toolCategories) ? config.toolCategories : [];

    const applyProfile = (profile) => {
        const runtime = normalizeCapabilityRuntimeConfig({
            capabilityProfile: profile.id,
            capabilities: profile.capabilities,
            toolCategories: profile.categories,
            mcpToolProfile: profile.mcpProfile || '',
            browserGateway: false,
            browserGatewayProfile: 'dryrun',
            brokerEnabled: profile.brokerEnabled !== false,
        }, profiles);
        onChange(runtime);
    };

    const updateCapability = (key, value) => {
        const nextCapabilities = { ...capabilities, [key]: value };
        const updates = { capabilities: nextCapabilities };

        if (key === 'browser') {
            updates.browserGateway = value ? false : config.browserGateway === true;
            updates.mcpToolProfile = value ? (config.mcpToolProfile || selectedProfile.mcpProfile || 'explorer-nav') : '';
            if (value) {
                updates.toolCategories = Array.from(new Set([...toolCategories, 'framework', 'grounding']));
            }
        }

        if (key === 'jira') {
            updates.toolCategories = value
                ? Array.from(new Set([...toolCategories, 'jira']))
                : toolCategories.filter((category) => category !== 'jira');
        }

        onChange(updates);
    };

    const updateFilesystem = (value) => {
        onChange({ capabilities: { ...capabilities, filesystem: value } });
    };

    const toggleCategory = (category) => {
        const exists = toolCategories.includes(category);
        const nextCategories = exists
            ? toolCategories.filter((item) => item !== category)
            : [...toolCategories, category];
        onChange({ toolCategories: nextCategories });
    };

    const toggleMcpServer = (server) => {
        const current = config.mcpServers || [];
        const exists = current.some(s => s.name === server.id);
        if (exists) {
            onChange({ mcpServers: current.filter(s => s.name !== server.id) });
        } else {
            onChange({ mcpServers: [...current, { name: server.id, type: server.connection?.type || 'builtin' }] });
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <div>
                <h3 className="text-lg font-bold text-surface-900">Tools & MCP Servers</h3>
                <p className="mt-0.5 text-[13px] text-surface-500">Configure which tools and MCP servers your agent can use</p>
            </div>

            {/* Capability Profile */}
            <div>
                <label className="mb-2 block text-[12px] font-semibold text-surface-700">Capability Profile</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {profiles.map(profile => (
                        <button
                            key={profile.id}
                            type="button"
                            onClick={() => applyProfile(profile)}
                            className={`rounded-xl border p-3 text-left transition-colors ${selectedProfile?.id === profile.id ? 'border-teal-300 bg-teal-50 ring-1 ring-teal-200' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                        >
                            <div className="text-[13px] font-semibold text-surface-800">{profile.label}</div>
                            <div className="mt-0.5 text-[11px] leading-4 text-surface-500">{profile.description}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Capability Manager */}
            <div className="rounded-2xl border border-surface-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-[13px] font-bold text-surface-900">Capabilities</div>
                        <div className="text-[11px] text-surface-500">Add, update, or remove runtime access for this agent</div>
                    </div>
                    <div className="rounded-full bg-surface-100 px-2 py-1 text-[10px] font-bold text-surface-500">
                        {selectedProfile?.id || 'custom'}
                    </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex items-start gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
                        <input
                            type="checkbox"
                            checked={capabilities.browser === true}
                            onChange={event => updateCapability('browser', event.target.checked)}
                            className="mt-0.5"
                        />
                        <span>
                            <span className="block text-[12px] font-semibold text-surface-800">Browser</span>
                            <span className="block text-[10px] leading-4 text-surface-500">Attach scoped browser MCP tools</span>
                        </span>
                    </label>
                    <label className="flex items-start gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
                        <input
                            type="checkbox"
                            checked={capabilities.jira === true}
                            onChange={event => updateCapability('jira', event.target.checked)}
                            className="mt-0.5"
                        />
                        <span>
                            <span className="block text-[12px] font-semibold text-surface-800">Jira</span>
                            <span className="block text-[10px] leading-4 text-surface-500">Enable Jira and Atlassian context</span>
                        </span>
                    </label>
                    <div className="rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
                        <label className="block text-[12px] font-semibold text-surface-800">Filesystem</label>
                        <select
                            value={capabilities.filesystem || 'none'}
                            onChange={event => updateFilesystem(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-[12px] text-surface-700 focus:border-blue-300 focus:outline-none"
                        >
                            <option value="none">None</option>
                            <option value="read">Read</option>
                            <option value="write">Write</option>
                        </select>
                    </div>
                </div>

                <div className="mt-4">
                    <label className="mb-2 block text-[12px] font-semibold text-surface-700">Tool Categories</label>
                    <div className="flex flex-wrap gap-2">
                        {CAPABILITY_CATEGORY_OPTIONS.map(category => {
                            const selected = toolCategories.includes(category.value);
                            return (
                                <button
                                    key={category.value}
                                    type="button"
                                    onClick={() => toggleCategory(category.value)}
                                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${selected ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-surface-200 bg-white text-surface-500 hover:border-surface-300'}`}
                                >
                                    {category.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Browser MCP Profile</label>
                        <select
                            value={config.mcpToolProfile || ''}
                            onChange={event => onChange({ mcpToolProfile: event.target.value })}
                            disabled={capabilities.browser !== true}
                            className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] text-surface-800 disabled:bg-surface-50 disabled:text-surface-400 focus:border-blue-300 focus:outline-none"
                        >
                            {MCP_TOOL_PROFILE_OPTIONS.map(option => (
                                <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-[10px] leading-4 text-surface-400">Use smaller profiles unless the agent needs deep browser automation.</p>
                    </div>
                    <div className="space-y-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
                        <label className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                checked={config.browserGateway === true && capabilities.browser !== true}
                                disabled={capabilities.browser === true}
                                onChange={event => onChange({ browserGateway: event.target.checked, browserGatewayProfile: config.browserGatewayProfile || 'dryrun' })}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="block text-[12px] font-semibold text-surface-800">Browser Gateway</span>
                                <span className="block text-[10px] leading-4 text-surface-500">Small delegated browser access without full MCP attachment</span>
                            </span>
                        </label>
                        <select
                            value={config.browserGatewayProfile || 'dryrun'}
                            onChange={event => onChange({ browserGatewayProfile: event.target.value })}
                            disabled={config.browserGateway !== true || capabilities.browser === true}
                            className="w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-[12px] text-surface-700 disabled:bg-surface-100 disabled:text-surface-400 focus:border-blue-300 focus:outline-none"
                        >
                            {BROWSER_GATEWAY_PROFILE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <label className="mt-4 flex items-start gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2">
                    <input
                        type="checkbox"
                        checked={config.brokerEnabled !== false}
                        onChange={event => onChange({ brokerEnabled: event.target.checked })}
                        className="mt-0.5"
                    />
                    <span>
                        <span className="block text-[12px] font-semibold text-surface-800">Tool Broker</span>
                        <span className="block text-[10px] leading-4 text-surface-500">Allow delegated tools outside the native set when the runtime permits it</span>
                    </span>
                </label>
            </div>

            {/* Tool Profile */}
            <div>
                <label className="mb-2 block text-[12px] font-semibold text-surface-700">Tool Profile</label>
                <div className="grid grid-cols-2 gap-2">
                    {TOOL_PROFILES.map(profile => (
                        <button
                            key={profile.value}
                            onClick={() => onChange({ toolProfile: profile.value })}
                            className={`rounded-xl border p-3 text-left transition-colors ${config.toolProfile === profile.value ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                        >
                            <div className="text-[13px] font-semibold text-surface-800">{profile.label}</div>
                            <div className="mt-0.5 text-[11px] text-surface-500">{profile.description}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Model Selection */}
            <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Model</label>
                <select
                    value={config.model}
                    onChange={e => onChange({ model: e.target.value })}
                    className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 focus:border-blue-300 focus:outline-none"
                >
                    <optgroup label="Anthropic">
                        <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                        <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>
                        <option value="claude-opus-4.6">Claude Opus 4.6</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                        <option value="gpt-4.1">GPT-4.1</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-5">GPT-5</option>
                    </optgroup>
                    <optgroup label="Google">
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    </optgroup>
                </select>
            </div>

            {/* MCP Servers */}
            <div>
                <label className="mb-2 block text-[12px] font-semibold text-surface-700">MCP Servers</label>
                <div className="space-y-2">
                    {mcpServers.map(server => {
                        const isSelected = (config.mcpServers || []).some(s => s.name === server.id);
                        return (
                            <button
                                key={server.id}
                                onClick={() => toggleMcpServer(server)}
                                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${isSelected ? 'border-blue-300 bg-blue-50' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                            >
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-surface-100 text-surface-500'}`}>
                                    {isSelected ? '✓' : server.name.charAt(0)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-semibold text-surface-800">{server.name}</div>
                                    <div className="truncate text-[11px] text-surface-500">{server.description}</div>
                                </div>
                                <div className="text-[10px] font-semibold text-surface-400">
                                    {server.toolCount || '?'} tools
                                </div>
                            </button>
                        );
                    })}
                    {mcpServers.length === 0 && (
                        <div className="rounded-xl border border-dashed border-surface-200 px-4 py-6 text-center text-[12px] text-surface-400">
                            No MCP servers available. The MCP registry could not be loaded.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Step 5: Guardrails
// ───────────────────────────────────────────────────────────────

function GuardrailsStep({ config, onChange }) {
    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <h3 className="text-lg font-bold text-surface-900">Guardrails</h3>
                <p className="mt-0.5 text-[13px] text-surface-500">Set safety limits and permission controls</p>
            </div>

            {/* Permission Mode */}
            <div>
                <label className="mb-2 block text-[12px] font-semibold text-surface-700">Permission Mode</label>
                <div className="space-y-2">
                    {PERMISSION_MODES.map(mode => (
                        <button
                            key={mode.value}
                            onClick={() => onChange({ permissionMode: mode.value })}
                            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${config.permissionMode === mode.value ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                        >
                            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 ${config.permissionMode === mode.value ? 'border-blue-600 bg-blue-600' : 'border-surface-300'}`}>
                                {config.permissionMode === mode.value && (
                                    <div className="m-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                            </div>
                            <div>
                                <div className="text-[13px] font-semibold text-surface-800">{mode.label}</div>
                                <div className="text-[11px] text-surface-500">{mode.description}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Turn & Budget Limits */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Max Turns</label>
                    <input
                        type="number"
                        value={config.maxTurns}
                        onChange={e => onChange({ maxTurns: parseInt(e.target.value, 10) || 50 })}
                        min={1}
                        max={200}
                        className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 focus:border-blue-300 focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-surface-400">Maximum conversation turns before auto-stop</p>
                </div>
                <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-surface-700">Max Budget (USD)</label>
                    <input
                        type="number"
                        value={config.maxBudgetUsd}
                        onChange={e => onChange({ maxBudgetUsd: e.target.value })}
                        min={0}
                        step={0.1}
                        placeholder="No limit"
                        className="w-full rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-[13px] text-surface-800 placeholder:text-surface-400 focus:border-blue-300 focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-surface-400">Maximum token cost per session (leave empty for no limit)</p>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Step 6: Review
// ───────────────────────────────────────────────────────────────

function ReviewStep({ config }) {
    const tags = config.tags.split(',').map(t => t.trim()).filter(Boolean);
    const capabilities = config.capabilities || {};
    const capabilitySummary = [
        capabilities.browser ? 'Browser' : null,
        capabilities.jira ? 'Jira' : null,
        capabilities.filesystem && capabilities.filesystem !== 'none' ? `Filesystem: ${capabilities.filesystem}` : null,
    ].filter(Boolean).join(', ') || 'None';

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <div>
                <h3 className="text-lg font-bold text-surface-900">Review</h3>
                <p className="mt-0.5 text-[13px] text-surface-500">Review your agent configuration before creating</p>
            </div>

            <div className="divide-y divide-surface-100 rounded-2xl border border-surface-200 bg-white">
                <ReviewRow label="Name" value={config.name} />
                <ReviewRow label="Description" value={config.description || 'Not set'} />
                <ReviewRow label="Category" value={config.category} />
                <ReviewRow label="Tags" value={tags.length > 0 ? tags.join(', ') : 'None'} />
                <ReviewRow label="Tool Profile" value={config.toolProfile} />
                <ReviewRow label="Capability Profile" value={config.capabilityProfile || 'text-knowledge'} />
                <ReviewRow label="Capabilities" value={capabilitySummary} />
                <ReviewRow label="Tool Categories" value={(config.toolCategories || []).length > 0 ? config.toolCategories.join(', ') : 'None'} />
                <ReviewRow label="Browser MCP" value={config.capabilities?.browser ? (config.mcpToolProfile || 'Auto') : 'Not attached'} />
                <ReviewRow label="Browser Gateway" value={config.browserGateway ? (config.browserGatewayProfile || 'dryrun') : 'Off'} />
                <ReviewRow label="Tool Broker" value={config.brokerEnabled === false ? 'Off' : 'On'} />
                <ReviewRow label="Model" value={config.model} />
                <ReviewRow label="Permission Mode" value={config.permissionMode} />
                <ReviewRow label="Max Turns" value={String(config.maxTurns)} />
                <ReviewRow label="Max Budget" value={config.maxBudgetUsd ? `$${config.maxBudgetUsd}` : 'No limit'} />
                <ReviewRow label="MCP Servers" value={config.mcpServers.length > 0 ? config.mcpServers.map(s => s.name).join(', ') : 'None'} />
                <ReviewRow label="Prompt Length" value={`${config.promptBody.split(/\s+/).filter(Boolean).length} words`} />
                {config.templateName && <ReviewRow label="Forked From" value={config.templateName} />}
            </div>
        </div>
    );
}

function ReviewRow({ label, value }) {
    return (
        <div className="flex items-baseline justify-between px-4 py-3">
            <span className="text-[12px] font-semibold text-surface-500">{label}</span>
            <span className="text-right text-[13px] font-medium text-surface-800">{value}</span>
        </div>
    );
}


export {
    STEPS,
    CATEGORY_COLORS,
    TOOL_PROFILES,
    FALLBACK_CAPABILITY_PROFILES,
    deriveCapabilityProfileFromConfig,
    normalizeCapabilityRuntimeConfig,
    PERMISSION_MODES,
    StepIndicator,
    TemplateStep,
    IdentityStep,
    PromptStep,
    ToolsStep,
    GuardrailsStep,
    ReviewStep,
};