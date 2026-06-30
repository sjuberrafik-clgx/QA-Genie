'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';
import {
    STEPS,
    StepIndicator,
    normalizeCapabilityRuntimeConfig,
    TemplateStep,
    IdentityStep,
    PromptStep,
    ToolsStep,
    GuardrailsStep,
    ReviewStep,
} from '@/components/wizard-steps';

const DEFAULT_RUNTIME = normalizeCapabilityRuntimeConfig({ capabilityProfile: 'text-knowledge' });

// ───────────────────────────────────────────────────────────────
// Icons (inline SVG for self-containment)
// ───────────────────────────────────────────────────────────────

function ArrowLeftIcon({ className }) {
    return (<svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" /></svg>);
}

// ───────────────────────────────────────────────────────────────
// Step Indicator
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
        capabilityProfile: DEFAULT_RUNTIME.capabilityProfile,
        capabilities: DEFAULT_RUNTIME.capabilities,
        toolCategories: DEFAULT_RUNTIME.toolCategories,
        mcpToolProfile: DEFAULT_RUNTIME.mcpToolProfile,
        browserGateway: DEFAULT_RUNTIME.browserGateway,
        browserGatewayProfile: DEFAULT_RUNTIME.browserGatewayProfile,
        brokerEnabled: DEFAULT_RUNTIME.brokerEnabled,
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
    const [capabilityProfiles, setCapabilityProfiles] = useState([]);

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

    // Load runtime capability metadata when entering tools step
    useEffect(() => {
        if (step !== 'tools') return;
        async function load() {
            try {
                const [mcpRes, profileRes] = await Promise.all([
                    apiClient.listMcpRegistry(),
                    apiClient.listStudioCapabilityProfiles(),
                ]);
                setMcpServers(mcpRes.items || []);
                setCapabilityProfiles(profileRes.items || []);
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
            const runtime = normalizeCapabilityRuntimeConfig(forked.config || {}, capabilityProfiles);
            updateConfig({
                name: forked.name,
                description: forked.description,
                templateId: template.id,
                templateName: template.name,
                toolProfile: forked.config?.toolProfile || 'full',
                ...runtime,
                model: forked.config?.model?.id || 'claude-sonnet-4-6',
                category: template.category || 'custom',
                tags: (template.tags || []).join(', '),
                promptBody: forked.promptBody || '',
                mcpServers: forked.config?.mcpServers || [],
                skills: forked.config?.skills || [],
                permissionMode: forked.config?.permissionMode || 'default',
                maxTurns: forked.config?.maxTurns || 50,
                maxBudgetUsd: forked.config?.maxBudgetUsd || '',
            });
            setStep('identity');
        } catch (err) {
            setError(err.message);
        }
    }, [capabilityProfiles, updateConfig]);

    const startBlank = useCallback(() => {
        updateConfig({
            templateId: null,
            templateName: null,
            toolProfile: 'full',
            ...normalizeCapabilityRuntimeConfig({ capabilityProfile: 'text-knowledge' }, capabilityProfiles),
            promptBody: '# Agent Name\n\n## Purpose\nDescribe the problem this agent solves.\n\n## Responsibilities\n- Define the primary tasks this agent owns.\n- Call out the tools, skills, or MCP servers it can rely on.\n- Define the output format and guardrails for responses.\n',
        });
        setStep('identity');
    }, [capabilityProfiles, updateConfig]);

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
                    capabilityProfile: config.capabilityProfile || null,
                    capabilities: config.capabilities,
                    toolCategories: Array.isArray(config.toolCategories) ? config.toolCategories : [],
                    mcpToolProfile: config.capabilities?.browser ? (config.mcpToolProfile || null) : null,
                    browserGateway: config.capabilities?.browser ? false : config.browserGateway === true,
                    browserGatewayProfile: config.capabilities?.browser ? null : (config.browserGateway ? (config.browserGatewayProfile || 'dryrun') : null),
                    brokerEnabled: config.brokerEnabled !== false,
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
                    <ToolsStep config={config} onChange={updateConfig} mcpServers={mcpServers} capabilityProfiles={capabilityProfiles} />
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