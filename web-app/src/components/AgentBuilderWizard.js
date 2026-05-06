'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';

// ───────────────────────────────────────────────────────────────
// Icons (inline SVG for self-containment)
// ───────────────────────────────────────────────────────────────

function ArrowLeftIcon({ className }) {
    return (<svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" /></svg>);
}
function CheckCircleIcon({ className }) {
    return (<svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>);
}

// ───────────────────────────────────────────────────────────────
// Step Indicator
// ───────────────────────────────────────────────────────────────

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

const PERMISSION_MODES = [
    { value: 'default', label: 'Default', description: 'Ask before destructive actions' },
    { value: 'accept_edits', label: 'Accept Edits', description: 'Auto-approve file edits, confirm shell commands' },
    { value: 'bypass', label: 'Bypass All', description: 'No confirmations (use with caution)' },
];

// ───────────────────────────────────────────────────────────────
// Main Wizard Component
// ───────────────────────────────────────────────────────────────

export default function AgentBuilderWizard({ workspaceId, onComplete, onCancel }) {
    const [step, setStep] = useState('template');
    const [templates, setTemplates] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Agent config state
    const [config, setConfig] = useState({
        name: '',
        description: '',
        templateId: null,
        templateName: null,
        toolProfile: 'full',
        model: 'claude-sonnet-4-6',
        category: 'custom',
        tags: '',
        promptBody: '',
        mcpServers: [],
        skills: [],
        permissionMode: 'default',
        maxTurns: 50,
        maxBudgetUsd: '',
    });

    // MCP registry for tools step
    const [mcpServers, setMcpServers] = useState([]);

    // Load templates
    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const res = await apiClient.listStudioTemplates({ category: selectedCategory, search: searchQuery });
                setTemplates(res.items || []);
                if (res.categories) setCategories(res.categories);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [selectedCategory, searchQuery]);

    // Load MCP registry when entering tools step
    useEffect(() => {
        if (step !== 'tools') return;
        async function load() {
            try {
                const res = await apiClient.listMcpRegistry();
                setMcpServers(res.items || []);
            } catch { /* ignore */ }
        }
        load();
    }, [step]);

    const updateConfig = useCallback((updates) => {
        setConfig(prev => ({ ...prev, ...updates }));
    }, []);

    const selectTemplate = useCallback(async (template) => {
        try {
            const forked = await apiClient.forkStudioTemplate(template.id, { name: template.name });
            updateConfig({
                name: forked.name,
                description: forked.description,
                templateId: template.id,
                templateName: template.name,
                toolProfile: forked.config?.toolProfile || 'full',
                model: forked.config?.model?.id || 'claude-sonnet-4-6',
                category: template.category || 'custom',
                tags: (template.tags || []).join(', '),
                promptBody: forked.promptBody || '',
                mcpServers: forked.config?.mcpServers || [],
                permissionMode: forked.config?.permissionMode || 'default',
                maxTurns: forked.config?.maxTurns || 50,
                maxBudgetUsd: forked.config?.maxBudgetUsd || '',
            });
            setStep('identity');
        } catch (err) {
            setError(err.message);
        }
    }, [updateConfig]);

    const startBlank = useCallback(() => {
        updateConfig({
            templateId: null,
            templateName: null,
            promptBody: '# Agent Name\n\n## Purpose\nDescribe the problem this agent solves.\n\n## Responsibilities\n- Define the primary tasks this agent owns.\n- Call out the tools, skills, or MCP servers it can rely on.\n- Define the output format and guardrails for responses.\n',
        });
        setStep('identity');
    }, [updateConfig]);

    const handleSave = useCallback(async () => {
        try {
            setSaving(true);
            setError(null);

            // Create the agent in the workspace
            const result = await apiClient.createStudioAsset(workspaceId, {
                type: 'agent',
                name: config.name,
                description: config.description,
                longContext: config.promptBody,
            });

            // Update the manifest with builder config
            const agentId = result.asset?.id;
            if (agentId) {
                const manifestPath = `agents/${agentId}/agent.json`;
                const manifestResult = await apiClient.getStudioWorkspaceFile(workspaceId, manifestPath);
                const manifest = JSON.parse(manifestResult.content);

                const updatedManifest = {
                    ...manifest,
                    toolProfile: config.toolProfile,
                    followupMode: config.toolProfile === 'full' ? 'default' : config.toolProfile,
                    model: { id: config.model, speed: 'standard' },
                    category: config.category,
                    tags: config.tags.split(',').map(t => t.trim()).filter(Boolean),
                    mcpServers: config.mcpServers,
                    skills: config.skills,
                    permissionMode: config.permissionMode,
                    maxTurns: config.maxTurns,
                    maxBudgetUsd: config.maxBudgetUsd ? parseFloat(config.maxBudgetUsd) : null,
                };

                await apiClient.saveStudioWorkspaceFile(workspaceId, {
                    path: manifestPath,
                    content: JSON.stringify(updatedManifest, null, 2),
                });
            }

            onComplete?.(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }, [workspaceId, config, onComplete]);

    const canProceed = () => {
        switch (step) {
            case 'identity': return config.name.trim().length > 0;
            case 'prompt': return config.promptBody.trim().length > 20;
            default: return true;
        }
    };

    const nextStep = () => {
        const idx = STEPS.findIndex(s => s.id === step);
        if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
    };

    const prevStep = () => {
        const idx = STEPS.findIndex(s => s.id === step);
        if (idx > 0) setStep(STEPS[idx - 1].id);
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-surface-200 bg-white px-6 py-4">
                <div className="flex items-center gap-3">
                    <button onClick={onCancel} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600">
                        <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                    <h2 className="text-lg font-bold text-surface-900">Agent Builder</h2>
                </div>
                <StepIndicator currentStep={step} />
            </div>

            {/* Error */}
            {error && (
                <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                    {error}
                    <button onClick={() => setError(null)} className="ml-2 font-bold underline">Dismiss</button>
                </div>
            )}

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
                {step === 'template' && (
                    <TemplateStep
                        templates={templates}
                        categories={categories}
                        selectedCategory={selectedCategory}
                        searchQuery={searchQuery}
                        loading={loading}
                        onSelectCategory={setSelectedCategory}
                        onSearchChange={setSearchQuery}
                        onSelectTemplate={selectTemplate}
                        onStartBlank={startBlank}
                    />
                )}
                {step === 'identity' && (
                    <IdentityStep config={config} onChange={updateConfig} />
                )}
                {step === 'prompt' && (
                    <PromptStep config={config} onChange={updateConfig} />
                )}
                {step === 'tools' && (
                    <ToolsStep config={config} onChange={updateConfig} mcpServers={mcpServers} />
                )}
                {step === 'guardrails' && (
                    <GuardrailsStep config={config} onChange={updateConfig} />
                )}
                {step === 'review' && (
                    <ReviewStep config={config} />
                )}
            </div>

            {/* Footer Navigation */}
            {step !== 'template' && (
                <div className="flex items-center justify-between border-t border-surface-200 bg-white px-6 py-4">
                    <button onClick={prevStep} className="rounded-xl border border-surface-200 px-4 py-2 text-[13px] font-semibold text-surface-600 hover:bg-surface-50">
                        Back
                    </button>
                    <div className="flex gap-2">
                        <button onClick={onCancel} className="rounded-xl border border-surface-200 px-4 py-2 text-[13px] font-semibold text-surface-500 hover:bg-surface-50">
                            Cancel
                        </button>
                        {step === 'review' ? (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="rounded-xl bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                                {saving ? 'Creating...' : 'Create Agent'}
                            </button>
                        ) : (
                            <button
                                onClick={nextStep}
                                disabled={!canProceed()}
                                className="rounded-xl bg-surface-900 px-5 py-2 text-[13px] font-semibold text-white hover:bg-surface-800 disabled:opacity-60"
                            >
                                Continue
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

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

function ToolsStep({ config, onChange, mcpServers }) {
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
