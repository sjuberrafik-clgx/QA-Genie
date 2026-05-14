'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import apiClient from '@/lib/api-client';
import {
    ExplorerIcon,
    FolderIcon,
    CodeIcon,
    DocumentIcon,
    WrenchIcon,
    FileIcon,
    PlusIcon,
    TrashIcon,
    SearchIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CheckIcon,
    SparkleIcon,
} from '@/components/Icons';
import AgentBuilderWizard from '@/components/AgentBuilderWizard';
import TemplateGallery from '@/components/TemplateGallery';
import McpDesigner from '@/components/McpDesigner';
import AgentAnalyticsDashboard from '@/components/AgentAnalyticsDashboard';
import AgentExportDialog from '@/components/AgentExportDialog';

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const ASSET_TYPES = [
    { value: 'agent', label: 'Agent', hint: 'Prompt + manifest scaffold for a custom chat agent.', Icon: CodeIcon },
    { value: 'skill', label: 'Skill', hint: 'Folder-based SKILL.md package for local guidance.', Icon: DocumentIcon },
    { value: 'mcp-server', label: 'MCP Server', hint: 'Scaffold a local MCP server with manifest + server.js.', Icon: WrenchIcon },
    { value: 'file', label: 'File', hint: 'Create a supporting note or config under files/.', Icon: FileIcon },
];

const NAME_PLACEHOLDERS = {
    agent: 'Agent name (e.g. release-planner)',
    skill: 'Skill name (e.g. release-checklist)',
    'mcp-server': 'MCP server name (e.g. release-mcp)',
    file: 'File name (e.g. release-checklist.md)',
};

const INTENT_PLACEHOLDERS = {
    agent: 'What should this agent do? (e.g. plan release readiness across squads)',
    skill: 'What guidance should this skill provide? (e.g. checklist for pre-release verification)',
    'mcp-server': 'What tools should this MCP server expose? (e.g. release automation + Jira sync)',
    file: 'What should this file contain? (e.g. release readiness checklist for PMs)',
};

const EXEMPLAR_LABELS = {
    agent: 'testgenie.agent.md, scriptgenerator.agent.md',
    skill: 'repo-commit-push, ppt',
    'mcp-server': 'unified-automation-mcp',
    file: '.github/agents/README.md',
};

const TABS = [
    { value: 'overview', label: 'Overview', Icon: SparkleIcon },
    { value: 'agents', label: 'Agents', Icon: CodeIcon },
    { value: 'templates', label: 'Templates', Icon: SparkleIcon },
    { value: 'skills', label: 'Skills', Icon: DocumentIcon },
    { value: 'mcp', label: 'MCP Servers', Icon: WrenchIcon },
    { value: 'mcp-designer', label: 'MCP Designer', Icon: WrenchIcon },
    { value: 'analytics', label: 'Analytics', Icon: ExplorerIcon },
    { value: 'files', label: 'Files', Icon: FileIcon },
    { value: 'editor', label: 'Editor', Icon: ExplorerIcon },
];

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function formatTimestamp(value) {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function statusChipClass(status, isActive = false) {
    if (isActive) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'published') return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
}

function Chip({ children, className = '' }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}>
            {children}
        </span>
    );
}

// ───────────────────────────────────────────────────────────────
// Workspace tree node (editor tab)
// ───────────────────────────────────────────────────────────────

function WorkspaceTreeNode({ node, depth = 0, selectedPath, onOpenFile }) {
    const [open, setOpen] = useState(depth < 2);
    if (!node) return null;
    const isDirectory = node.type === 'directory';
    const isSelected = !isDirectory && selectedPath === node.path;

    if (!isDirectory) {
        return (
            <button
                type="button"
                onClick={() => onOpenFile(node.path)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${isSelected ? 'bg-blue-50 text-blue-900' : 'text-surface-600 hover:bg-surface-100'
                    }`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.7} />
                <span className="truncate">{node.name}</span>
            </button>
        );
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-surface-700 hover:bg-surface-100"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
                {open ? <ChevronDownIcon className="h-3 w-3 text-surface-400" /> : <ChevronRightIcon className="h-3 w-3 text-surface-400" />}
                <FolderIcon className="h-3.5 w-3.5 text-teal-600" strokeWidth={1.7} />
                <span className="truncate">{node.name}</span>
            </button>
            {open && Array.isArray(node.children) && node.children.map((child) => (
                <WorkspaceTreeNode
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    onOpenFile={onOpenFile}
                />
            ))}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Cards
// ───────────────────────────────────────────────────────────────

function AgentRow({ agent, busy, highlight, onPublish, onToggleActivation, onOpenFile, onDelete, onExport, onValidate, validating }) {
    const promptFile = agent.files?.find((f) => f.label === 'Prompt');
    const manifestFile = agent.files?.find((f) => f.label === 'Manifest');

    return (
        <article className={`rounded-2xl border bg-white p-4 shadow-sm transition-all ${highlight ? 'border-violet-300 ring-2 ring-violet-100' : 'border-surface-200/80 hover:border-surface-300'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-surface-900">{agent.name}</h3>
                        <Chip className={statusChipClass(agent.status, agent.isActive)}>
                            {agent.isActive ? 'Active' : agent.status}
                        </Chip>
                        <Chip className="border-surface-200 bg-surface-50 text-surface-600">
                            {agent.toolProfile || 'full'}
                        </Chip>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-surface-400">{agent.path}</p>
                </div>
            </div>
            <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-surface-500">{agent.description || 'No description yet.'}</p>

            <div className="mt-3 flex flex-wrap gap-2">
                {promptFile && (
                    <button
                        type="button"
                        onClick={() => onOpenFile(promptFile.path)}
                        className="inline-flex items-center rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                    >
                        Open prompt
                    </button>
                )}
                {manifestFile && (
                    <button
                        type="button"
                        onClick={() => onOpenFile(manifestFile.path)}
                        className="inline-flex items-center rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                    >
                        Open manifest
                    </button>
                )}
                {agent.status !== 'published' ? (
                    <button
                        type="button"
                        onClick={() => onPublish(agent.id)}
                        disabled={busy}
                        className="inline-flex items-center rounded-lg bg-surface-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {busy ? 'Publishing...' : 'Publish'}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onToggleActivation(agent.id, !agent.isActive)}
                        disabled={busy}
                        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${agent.isActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {busy ? 'Updating...' : agent.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                )}
                {onValidate && (
                    <button
                        type="button"
                        onClick={() => onValidate(agent.id)}
                        disabled={validating}
                        className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                    >
                        {validating ? 'Checking...' : 'Validate'}
                    </button>
                )}
                {onExport && (
                    <button
                        type="button"
                        onClick={() => onExport(agent)}
                        className="inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                    >
                        Export
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onDelete(agent)}
                    disabled={busy}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <TrashIcon className="h-3 w-3" />
                    Delete
                </button>
            </div>
        </article>
    );
}

function GenericAssetRow({ item, onOpenFile, onDelete }) {
    const manifestFile = item.files?.find((f) => f.label === 'Manifest');
    const primaryFile = item.files?.find((f) => f.label && f.label !== 'Manifest') || manifestFile;

    return (
        <article className="rounded-2xl border border-surface-200/80 bg-white p-4 shadow-sm hover:border-surface-300">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-surface-800">{item.name}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-surface-400">{item.path}</p>
                </div>
                {item.status && (
                    <Chip className={statusChipClass(item.status)}>{item.status}</Chip>
                )}
            </div>
            {item.description && (
                <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-surface-500">{item.description}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                {primaryFile && (
                    <button
                        type="button"
                        onClick={() => onOpenFile(primaryFile.path)}
                        className="inline-flex items-center rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                    >
                        Open {(primaryFile.label || 'file').toLowerCase()}
                    </button>
                )}
                {manifestFile && primaryFile?.path !== manifestFile.path && (
                    <button
                        type="button"
                        onClick={() => onOpenFile(manifestFile.path)}
                        className="inline-flex items-center rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                    >
                        Open manifest
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                >
                    <TrashIcon className="h-3 w-3" />
                    Delete
                </button>
            </div>
        </article>
    );
}

function FileRow({ item, onOpenFile, onDelete }) {
    const isProtected = !String(item.relativePath || '').startsWith('files/');
    return (
        <article className="flex items-center justify-between gap-3 rounded-2xl border border-surface-200/80 bg-white px-4 py-3 shadow-sm hover:border-surface-300">
            <button
                type="button"
                onClick={() => onOpenFile(item.path)}
                className="min-w-0 flex-1 text-left"
            >
                <p className="flex items-center gap-2 text-[13px] font-semibold text-surface-800">
                    <FileIcon className="h-3.5 w-3.5 text-slate-400" /> {item.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-surface-400">{item.relativePath}</p>
            </button>
            {!isProtected ? (
                <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                >
                    <TrashIcon className="h-3 w-3" /> Delete
                </button>
            ) : (
                <span className="rounded-lg border border-surface-200 bg-surface-50 px-2.5 py-1 text-[11px] font-semibold text-surface-400">Protected</span>
            )}
        </article>
    );
}

function EmptyTab({ icon: Icon, title, hint, children }) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-surface-200 bg-surface-50/70 px-6 py-12 text-center">
            {Icon && (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-surface-400">
                    <Icon className="h-4 w-4" />
                </div>
            )}
            <p className="text-sm font-semibold text-surface-700">{title}</p>
            {hint && <p className="max-w-sm text-[12px] leading-5 text-surface-500">{hint}</p>}
            {children}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────
// Main page
// ───────────────────────────────────────────────────────────────

export default function StudioPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [workspaces, setWorkspaces] = useState([]);
    const [catalog, setCatalog] = useState(null);
    const [tree, setTree] = useState(null);
    const [meta, setMeta] = useState({ sourceRoot: 'studio-workspaces', runtimeRoot: 'agentic-workflow/studio-runtime' });
    const [loading, setLoading] = useState(true);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [busyAgentId, setBusyAgentId] = useState('');
    const [savingFile, setSavingFile] = useState(false);
    const [error, setError] = useState('');
    const [workspaceForm, setWorkspaceForm] = useState({ name: '', description: '' });
    const [assetForm, setAssetForm] = useState({ type: 'agent', name: '', description: '', intent: '', longContext: '' });
    const [generatingDescription, setGeneratingDescription] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [editorContent, setEditorContent] = useState('');
    const [editorDirty, setEditorDirty] = useState(false);
    const [workspaceSearch, setWorkspaceSearch] = useState('');

    // Skill editor state
    const [editingSkill, setEditingSkill] = useState(null); // full skill object from getSkill API
    const [skillEditorDirty, setSkillEditorDirty] = useState(false);
    const [skillSaving, setSkillSaving] = useState(false);
    const [skillValidation, setSkillValidation] = useState(null);
    const [skillAutoFixing, setSkillAutoFixing] = useState(false);
    const [skillTestMessage, setSkillTestMessage] = useState('');
    const [skillTestResult, setSkillTestResult] = useState(null);
    const [skillTestLoading, setSkillTestLoading] = useState(false);

    // Builder wizard / export / validation overlays
    const [showBuilderWizard, setShowBuilderWizard] = useState(false);
    const [exportTarget, setExportTarget] = useState(null); // { agentId, agentName }
    const [validationResult, setValidationResult] = useState(null);
    const [validatingAgentId, setValidatingAgentId] = useState('');

    // URL-driven state
    const selectedWorkspaceId = searchParams.get('workspace') || '';
    const activeTab = TABS.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
    const highlightedAgentId = searchParams.get('agent') || '';

    const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) || null;

    const updateUrl = useCallback((updates) => {
        const params = new URLSearchParams(searchParams.toString());
        Object.entries(updates).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });
        const qs = params.toString();
        router.replace(`/studio${qs ? `?${qs}` : ''}`, { scroll: false });
    }, [router, searchParams]);

    // ─── Data loading ───
    const loadWorkspaces = useCallback(async () => {
        const data = await apiClient.listStudioWorkspaces();
        const items = Array.isArray(data?.items) ? data.items : [];
        setWorkspaces(items);
        setMeta({
            sourceRoot: data?.sourceRoot || 'studio-workspaces',
            runtimeRoot: data?.runtimeRoot || 'agentic-workflow/studio-runtime',
        });
        return items;
    }, []);

    const loadWorkspaceDetails = useCallback(async (workspaceId) => {
        if (!workspaceId) { setCatalog(null); setTree(null); return; }
        setDetailsLoading(true);
        try {
            const [catalogData, treeData] = await Promise.all([
                apiClient.getStudioWorkspaceCatalog(workspaceId),
                apiClient.getStudioWorkspaceTree(workspaceId, 4),
            ]);
            setCatalog(catalogData);
            setTree(treeData?.tree || null);
        } finally {
            setDetailsLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const items = await loadWorkspaces();
                if (!cancelled && !selectedWorkspaceId && items[0]?.id) {
                    updateUrl({ workspace: items[0].id });
                }
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load workspaces');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedWorkspaceId) {
            setCatalog(null); setTree(null); setSelectedFile(null); setEditorContent(''); setEditorDirty(false);
            setEditingSkill(null); setSkillEditorDirty(false); setSkillValidation(null);
            return;
        }
        setEditingSkill(null); setSkillEditorDirty(false); setSkillValidation(null);
        loadWorkspaceDetails(selectedWorkspaceId).catch((err) => setError(err.message || 'Failed to load workspace details'));
    }, [selectedWorkspaceId, loadWorkspaceDetails]);

    // ─── File editor ───
    const openWorkspaceFile = useCallback(async (filePath) => {
        if (!selectedWorkspaceId) return;
        setError('');
        try {
            const file = await apiClient.getStudioWorkspaceFile(selectedWorkspaceId, filePath);
            setSelectedFile(file);
            setEditorContent(file.content || '');
            setEditorDirty(false);
            updateUrl({ tab: 'editor', file: file.path });
        } catch (err) {
            setError(err.message || 'Failed to open workspace file');
        }
    }, [selectedWorkspaceId, updateUrl]);

    const saveFile = useCallback(async () => {
        if (!selectedWorkspaceId || !selectedFile) return;
        setSavingFile(true);
        setError('');
        try {
            const saved = await apiClient.saveStudioWorkspaceFile(selectedWorkspaceId, {
                path: selectedFile.path,
                content: editorContent,
            });
            setSelectedFile(saved);
            setEditorContent(saved.content || '');
            setEditorDirty(false);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to save workspace file');
        } finally {
            setSavingFile(false);
        }
    }, [selectedWorkspaceId, selectedFile, editorContent, loadWorkspaces, loadWorkspaceDetails]);

    // Ctrl+S to save when editor tab active
    useEffect(() => {
        function onKey(event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 's' && activeTab === 'editor' && selectedFile) {
                event.preventDefault();
                if (editorDirty && !savingFile) saveFile();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [activeTab, selectedFile, editorDirty, savingFile, saveFile]);

    // ─── Create actions ───
    async function handleCreateWorkspace(event) {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const created = await apiClient.createStudioWorkspace(workspaceForm);
            setWorkspaceForm({ name: '', description: '' });
            await loadWorkspaces();
            if (created?.id) {
                updateUrl({ workspace: created.id, tab: 'overview', file: null, agent: null });
            }
        } catch (err) {
            setError(err.message || 'Failed to create workspace');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleCreateAsset(event) {
        event.preventDefault();
        if (!selectedWorkspaceId) return;
        setSubmitting(true);
        setError('');
        try {
            const payload = {
                type: assetForm.type,
                name: assetForm.name,
                description: assetForm.description,
                longContext: assetForm.longContext,
            };
            const result = await apiClient.createStudioAsset(selectedWorkspaceId, payload);
            setAssetForm((prev) => ({ ...prev, name: '', description: '', intent: '', longContext: '' }));
            setCatalog(result?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
            const nextTab = assetForm.type === 'agent'
                ? 'agents'
                : assetForm.type === 'skill'
                    ? 'skills'
                    : assetForm.type === 'mcp-server'
                        ? 'mcp'
                        : 'files';
            updateUrl({ tab: nextTab });
        } catch (err) {
            setError(err.message || 'Failed to create asset');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleGenerateDescription() {
        if (generatingDescription) return;
        const intent = assetForm.intent.trim();
        const name = assetForm.name.trim();
        if (!intent && !name) {
            setError('Provide a name or an intent before generating a description.');
            return;
        }
        setGeneratingDescription(true);
        setError('');
        try {
            const result = await apiClient.generateStudioDescription({
                type: assetForm.type,
                name,
                intent,
            });
            setAssetForm((prev) => ({
                ...prev,
                description: result?.description || prev.description,
                longContext: result?.longContext || prev.longContext,
            }));
        } catch (err) {
            setError(err.message || 'Failed to generate description');
        } finally {
            setGeneratingDescription(false);
        }
    }

    // ─── Agent lifecycle ───
    async function handlePublishAgent(agentId) {
        if (!selectedWorkspaceId) return;
        setBusyAgentId(agentId);
        setError('');
        try {
            const result = await apiClient.publishStudioAgent(selectedWorkspaceId, agentId, { activate: true });
            setCatalog(result?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to publish agent');
        } finally {
            setBusyAgentId('');
        }
    }

    async function handleToggleActivation(agentId, nextActive) {
        if (!selectedWorkspaceId) return;
        setBusyAgentId(agentId);
        setError('');
        try {
            const result = await apiClient.setStudioAgentActivation(selectedWorkspaceId, agentId, nextActive);
            setCatalog(result?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to update activation');
        } finally {
            setBusyAgentId('');
        }
    }

    async function handleValidateAgent(agentId) {
        if (!selectedWorkspaceId) return;
        setValidatingAgentId(agentId);
        setError('');
        try {
            const result = await apiClient.validateStudioAgent(selectedWorkspaceId, agentId);
            setValidationResult({ agentId, ...result });
        } catch (err) {
            setError(err.message || 'Failed to validate agent');
        } finally {
            setValidatingAgentId('');
        }
    }

    // ─── Delete actions ───
    async function handleDeleteAgent(agent) {
        if (!selectedWorkspaceId) return;
        if (!window.confirm(`Delete agent "${agent.name}"? This removes its folder from the workspace and cannot be undone.`)) return;
        setBusyAgentId(agent.id);
        setError('');
        try {
            const res = await apiClient.deleteStudioAgent(selectedWorkspaceId, agent.id);
            setCatalog(res?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to delete agent');
        } finally {
            setBusyAgentId('');
        }
    }

    async function handleDeleteSkill(item) {
        if (!selectedWorkspaceId) return;
        if (!window.confirm(`Delete skill "${item.name}"?`)) return;
        setError('');
        try {
            const res = await apiClient.deleteStudioSkill(selectedWorkspaceId, item.id);
            setCatalog(res?.catalog || null);
            if (editingSkill?.id === item.id) setEditingSkill(null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to delete skill');
        }
    }

    async function handleOpenSkillEditor(item) {
        if (!selectedWorkspaceId) return;
        setError('');
        try {
            const skill = await apiClient.getStudioSkill(selectedWorkspaceId, item.id);
            setEditingSkill(skill);
            setSkillValidation(skill.validation || null);
            setSkillEditorDirty(false);
        } catch (err) {
            setError(err.message || 'Failed to load skill');
        }
    }

    function handleSkillFieldChange(field, value) {
        setEditingSkill(prev => prev ? { ...prev, [field]: value } : prev);
        setSkillEditorDirty(true);
    }

    async function handleSaveSkill() {
        if (!selectedWorkspaceId || !editingSkill) return;
        setSkillSaving(true);
        setError('');
        try {
            const payload = {
                name: editingSkill.name,
                description: editingSkill.description,
                keywords: editingSkill.keywords || [],
                allowedTools: editingSkill.allowedTools || [],
                agentBindings: editingSkill.agentBindings || [],
                alwaysActiveForBoundAgents: !!editingSkill.alwaysActiveForBoundAgents,
                skillContent: editingSkill.skillContent,
            };
            const updated = await apiClient.updateStudioSkill(selectedWorkspaceId, editingSkill.id, payload);
            setEditingSkill(updated);
            setSkillValidation(updated.validation || null);
            setSkillEditorDirty(false);
            setCatalog(null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to save skill');
        } finally {
            setSkillSaving(false);
        }
    }

    async function handleValidateSkill() {
        if (!selectedWorkspaceId || !editingSkill) return;
        setError('');
        try {
            const result = await apiClient.validateStudioSkill(selectedWorkspaceId, editingSkill.id);
            setSkillValidation(result.validation);
        } catch (err) {
            setError(err.message || 'Failed to validate skill');
        }
    }

    async function handleAutoFixFormat() {
        if (!selectedWorkspaceId || !editingSkill) return;
        setSkillAutoFixing(true);
        setError('');
        try {
            const result = await apiClient.autoFixSkillFormat(selectedWorkspaceId, editingSkill.id);
            if (result.modified) {
                // Reload the skill to get fresh data
                const skill = await apiClient.getStudioSkill(selectedWorkspaceId, editingSkill.id);
                setEditingSkill(skill);
                setSkillValidation(skill.validation || null);
                setSkillEditorDirty(false);
                setCatalog(null);
                await loadWorkspaceDetails(selectedWorkspaceId);
            }
        } catch (err) {
            setError(err.message || 'Failed to auto-fix skill format');
        } finally {
            setSkillAutoFixing(false);
        }
    }

    async function handleTestSkillMatch() {
        if (!skillTestMessage.trim()) return;
        setSkillTestLoading(true);
        setSkillTestResult(null);
        try {
            const result = await apiClient.testSkillMatch(skillTestMessage);
            setSkillTestResult(result);
        } catch (err) {
            setSkillTestResult({ error: err.message || 'Test failed' });
        } finally {
            setSkillTestLoading(false);
        }
    }

    async function handleDeleteMcp(item) {
        if (!selectedWorkspaceId) return;
        if (!window.confirm(`Delete MCP server "${item.name}"?`)) return;
        setError('');
        try {
            const res = await apiClient.deleteStudioMcpServer(selectedWorkspaceId, item.id);
            setCatalog(res?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
        } catch (err) {
            setError(err.message || 'Failed to delete MCP server');
        }
    }

    async function handleDeleteFile(item) {
        if (!selectedWorkspaceId) return;
        if (!window.confirm(`Delete file "${item.name}"?`)) return;
        setError('');
        try {
            const res = await apiClient.deleteStudioWorkspaceFile(selectedWorkspaceId, item.relativePath || item.path);
            setCatalog(res?.catalog || null);
            await Promise.all([loadWorkspaces(), loadWorkspaceDetails(selectedWorkspaceId)]);
            if (selectedFile && selectedFile.path === item.path) {
                setSelectedFile(null);
                setEditorContent('');
                setEditorDirty(false);
                updateUrl({ file: null });
            }
        } catch (err) {
            setError(err.message || 'Failed to delete file');
        }
    }

    async function handleDeleteWorkspace(workspace) {
        if (!workspace?.id) return;
        const activeAgents = workspace.id === selectedWorkspaceId
            ? (catalog?.assets?.agents || []).filter((a) => a.status === 'published' && a.isActive)
            : [];
        const hasActive = activeAgents.length > 0;

        const first = window.confirm(
            hasActive
                ? `Workspace "${workspace.name}" contains ${activeAgents.length} active published agent(s): ${activeAgents.map((a) => a.name).join(', ')}.\n\nDelete anyway? This will immediately remove them from chat.`
                : `Delete workspace "${workspace.name}"? This removes the entire workspace folder and cannot be undone.`
        );
        if (!first) return;

        setError('');
        try {
            await apiClient.deleteStudioWorkspace(workspace.id, { force: hasActive });
            await loadWorkspaces();
            if (workspace.id === selectedWorkspaceId) {
                updateUrl({ workspace: null, tab: null, file: null, agent: null });
            }
        } catch (err) {
            if (err.message && /active/i.test(err.message)) {
                const retry = window.confirm(`${err.message}\n\nForce delete anyway?`);
                if (retry) {
                    try {
                        await apiClient.deleteStudioWorkspace(workspace.id, { force: true });
                        await loadWorkspaces();
                        if (workspace.id === selectedWorkspaceId) {
                            updateUrl({ workspace: null, tab: null, file: null, agent: null });
                        }
                        return;
                    } catch (forceErr) {
                        setError(forceErr.message || 'Failed to force-delete workspace');
                        return;
                    }
                }
            }
            setError(err.message || 'Failed to delete workspace');
        }
    }

    // ─── Derived data ───
    const filteredWorkspaces = useMemo(() => {
        const query = workspaceSearch.trim().toLowerCase();
        if (!query) return workspaces;
        return workspaces.filter((w) => `${w.name} ${w.description || ''}`.toLowerCase().includes(query));
    }, [workspaces, workspaceSearch]);

    const totalAgents = useMemo(
        () => workspaces.reduce((sum, w) => sum + (w.counts?.agents || 0), 0),
        [workspaces]
    );

    // Auto-scroll highlighted agent card on deep-link
    const highlightRef = useRef(null);
    useEffect(() => {
        if (activeTab === 'agents' && highlightedAgentId && highlightRef.current) {
            highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeTab, highlightedAgentId, catalog]);

    // ─── Render ───
    return (
        <div className="motion-page-rich app-page-wide space-y-4">
            <PageHeader
                title="Agent Studio"
                subtitle="Create isolated workspaces, publish custom agents into chat, and edit manifests without leaving the web app."
                Icon={ExplorerIcon}
                actions={(
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                            {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
                        </span>
                        <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-white/80">
                            {totalAgents} total agents
                        </span>
                    </div>
                )}
            />

            <ErrorBanner error={error} onDismiss={() => setError('')} />

            <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
                {/* ─── Left rail ─── */}
                <aside>
                    <div className="sticky top-4 space-y-3">
                        <div className="surface-panel rounded-2xl p-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Workspaces</p>
                                <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-semibold text-surface-600">{workspaces.length}</span>
                            </div>
                            <div className="relative mt-2">
                                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
                                <input
                                    value={workspaceSearch}
                                    onChange={(e) => setWorkspaceSearch(e.target.value)}
                                    placeholder="Search..."
                                    className="w-full rounded-lg border border-surface-200 bg-white py-1.5 pl-8 pr-2 text-[12px] text-surface-800 placeholder-surface-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                                />
                            </div>

                            <div className="mt-3 space-y-1.5">
                                {loading && (
                                    <div className="py-6 text-center text-[11px] font-medium text-surface-400">Loading workspaces...</div>
                                )}
                                {!loading && filteredWorkspaces.length === 0 && (
                                    <div className="rounded-lg border border-dashed border-surface-200 bg-surface-50/70 px-3 py-4 text-center text-[11px] font-medium text-surface-400">
                                        {workspaceSearch ? 'No matches.' : 'Create your first workspace below.'}
                                    </div>
                                )}
                                {filteredWorkspaces.map((workspace) => {
                                    const active = workspace.id === selectedWorkspaceId;
                                    return (
                                        <div
                                            key={workspace.id}
                                            className={`group rounded-xl border transition-colors ${active ? 'border-teal-300 bg-teal-50/80' : 'border-surface-200 bg-white hover:bg-surface-50'}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => updateUrl({ workspace: workspace.id, file: null, agent: null })}
                                                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
                                            >
                                                <FolderIcon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-teal-700' : 'text-surface-400'}`} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-[12px] font-semibold text-surface-800">{workspace.name}</p>
                                                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-medium text-surface-400">
                                                        <span>A {workspace.counts?.agents || 0}</span>
                                                        <span>·</span>
                                                        <span>S {workspace.counts?.skills || 0}</span>
                                                        <span>·</span>
                                                        <span>M {workspace.counts?.mcpServers || 0}</span>
                                                        <span>·</span>
                                                        <span>F {workspace.counts?.files || 0}</span>
                                                    </div>
                                                </div>
                                            </button>
                                            <div className={`flex items-center justify-between gap-2 border-t border-surface-200/60 px-3 py-1.5 ${active ? 'bg-teal-50/40' : 'bg-surface-50/40'}`}>
                                                <span className="text-[10px] font-medium text-surface-400">{formatTimestamp(workspace.updatedAt).split(',')[0]}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteWorkspace(workspace)}
                                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-red-600 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100"
                                                    title="Delete workspace"
                                                >
                                                    <TrashIcon className="h-3 w-3" /> Delete
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <details className="surface-panel rounded-2xl p-3" open={workspaces.length === 0}>
                            <summary className="flex cursor-pointer items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">
                                <span className="inline-flex items-center gap-1.5">
                                    <PlusIcon className="h-3 w-3" />
                                    New workspace
                                </span>
                                <ChevronDownIcon className="h-3.5 w-3.5" />
                            </summary>
                            <form className="mt-3 space-y-2" onSubmit={handleCreateWorkspace}>
                                <input
                                    value={workspaceForm.name}
                                    onChange={(e) => setWorkspaceForm((p) => ({ ...p, name: e.target.value }))}
                                    placeholder="Workspace name"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-[12px] focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                                />
                                <textarea
                                    rows={2}
                                    value={workspaceForm.description}
                                    onChange={(e) => setWorkspaceForm((p) => ({ ...p, description: e.target.value }))}
                                    placeholder="Description (optional)"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-[12px] focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                                />
                                <button
                                    type="submit"
                                    disabled={submitting || !workspaceForm.name.trim()}
                                    className="w-full rounded-lg bg-surface-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {submitting ? 'Creating...' : 'Create workspace'}
                                </button>
                            </form>
                        </details>

                        <div className="surface-panel rounded-2xl p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500">Paths</p>
                            <div className="mt-1.5 space-y-1 text-[11px] font-mono text-surface-600">
                                <p><span className="text-surface-400">src</span> {meta.sourceRoot}</p>
                                <p><span className="text-surface-400">rt</span> {meta.runtimeRoot}</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* ─── Main canvas ─── */}
                <main className="min-w-0">
                    {!selectedWorkspace ? (
                        <div className="surface-panel flex flex-col items-center justify-center gap-3 rounded-3xl px-6 py-20 text-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                                <FolderIcon className="h-5 w-5" />
                            </div>
                            <h3 className="text-base font-semibold text-surface-800">Select or create a workspace</h3>
                            <p className="max-w-sm text-[13px] leading-5 text-surface-500">
                                Workspaces isolate your custom agents, skills, MCP servers, and support files so they never interfere with core product code.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Workspace header */}
                            <header className="surface-panel rounded-2xl p-5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600">Workspace</p>
                                        <h2 className="mt-1 font-display text-[1.35rem] font-bold tracking-[-0.03em] text-surface-900">{selectedWorkspace.name}</h2>
                                        {selectedWorkspace.description && (
                                            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-surface-500">{selectedWorkspace.description}</p>
                                        )}
                                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-surface-400">
                                            <span>Source · <span className="font-mono normal-case tracking-normal text-surface-600">{selectedWorkspace.sourceRoot}</span></span>
                                            <span>Runtime · <span className="font-mono normal-case tracking-normal text-surface-600">{selectedWorkspace.runtimeRoot}</span></span>
                                            <span>Updated · <span className="normal-case tracking-normal text-surface-600">{formatTimestamp(selectedWorkspace.updatedAt)}</span></span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteWorkspace(selectedWorkspace)}
                                        className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-100"
                                    >
                                        <TrashIcon className="h-3.5 w-3.5" /> Delete workspace
                                    </button>
                                </div>

                                {/* Tabs */}
                                <nav className="mt-4 flex flex-wrap gap-1 border-b border-surface-200">
                                    {TABS.map((tab) => {
                                        const count = !catalog ? null
                                            : tab.value === 'agents' ? catalog.counts?.agents
                                                : tab.value === 'skills' ? catalog.counts?.skills
                                                    : tab.value === 'mcp' ? catalog.counts?.mcpServers
                                                        : tab.value === 'files' ? catalog.counts?.files
                                                            : null;
                                        const active = tab.value === activeTab;
                                        return (
                                            <button
                                                key={tab.value}
                                                type="button"
                                                onClick={() => updateUrl({ tab: tab.value })}
                                                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-surface-500 hover:text-surface-800'}`}
                                            >
                                                <tab.Icon className="h-3.5 w-3.5" />
                                                {tab.label}
                                                {count !== null && (
                                                    <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-teal-100 text-teal-700' : 'bg-surface-100 text-surface-500'}`}>
                                                        {count}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </nav>
                            </header>

                            {/* Tab body */}
                            {detailsLoading && !catalog && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {[0, 1, 2, 3].map((i) => (
                                        <div key={i} className="h-32 animate-pulse rounded-2xl border border-surface-200/80 bg-white/60" />
                                    ))}
                                </div>
                            )}

                            {catalog && activeTab === 'overview' && (
                                <div className="space-y-3">
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {[
                                            { label: 'Agents', value: catalog.counts?.agents || 0, tab: 'agents', accent: 'text-blue-600', bg: 'bg-blue-50' },
                                            { label: 'Skills', value: catalog.counts?.skills || 0, tab: 'skills', accent: 'text-emerald-600', bg: 'bg-emerald-50' },
                                            { label: 'MCP Servers', value: catalog.counts?.mcpServers || 0, tab: 'mcp', accent: 'text-violet-600', bg: 'bg-violet-50' },
                                            { label: 'Files', value: catalog.counts?.files || 0, tab: 'files', accent: 'text-amber-600', bg: 'bg-amber-50' },
                                        ].map((card) => (
                                            <button
                                                key={card.label}
                                                type="button"
                                                onClick={() => updateUrl({ tab: card.tab })}
                                                className={`rounded-2xl border border-surface-200/80 ${card.bg} px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md`}
                                            >
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500">{card.label}</p>
                                                <p className={`mt-1 font-display text-[1.6rem] font-bold ${card.accent}`}>{card.value}</p>
                                            </button>
                                        ))}
                                    </div>

                                    <section className="surface-panel rounded-2xl p-5">
                                        <div className="flex items-center gap-3">
                                            <span className="rounded-xl bg-blue-50 p-2 text-blue-700">
                                                <PlusIcon className="h-4 w-4" />
                                            </span>
                                            <div>
                                                <h3 className="font-display text-[1rem] font-bold tracking-[-0.02em] text-surface-800">Scaffold asset</h3>
                                                <p className="text-[12px] leading-5 text-surface-500">Create a draft agent, skill, MCP server, or support file in this workspace.</p>
                                            </div>
                                        </div>
                                        <form className="mt-4 space-y-3" onSubmit={handleCreateAsset}>
                                            <div className="grid gap-2 sm:grid-cols-4">
                                                {ASSET_TYPES.map((opt) => (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        onClick={() => setAssetForm((p) => ({ ...p, type: opt.value }))}
                                                        className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${assetForm.type === opt.value ? 'border-blue-300 bg-blue-50/70' : 'border-surface-200 bg-white hover:bg-surface-50'}`}
                                                    >
                                                        <opt.Icon className="mt-0.5 h-4 w-4 text-surface-500" />
                                                        <div className="min-w-0">
                                                            <p className="text-[12px] font-semibold text-surface-800">{opt.label}</p>
                                                            <p className="text-[10px] leading-4 text-surface-500">{opt.hint}</p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <input
                                                    value={assetForm.name}
                                                    onChange={(e) => setAssetForm((p) => ({ ...p, name: e.target.value }))}
                                                    placeholder={NAME_PLACEHOLDERS[assetForm.type] || 'Asset name'}
                                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                                <input
                                                    value={assetForm.intent}
                                                    onChange={(e) => setAssetForm((p) => ({ ...p, intent: e.target.value }))}
                                                    placeholder={INTENT_PLACEHOLDERS[assetForm.type] || 'What should this do?'}
                                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between gap-2">
                                                    <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                                                        Context / description
                                                    </label>
                                                    <button
                                                        type="button"
                                                        onClick={handleGenerateDescription}
                                                        disabled={generatingDescription || (!assetForm.name.trim() && !assetForm.intent.trim())}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                        title="Generate a rich description from your intent + exemplar agents/skills"
                                                    >
                                                        <SparkleIcon className="h-3 w-3" />
                                                        {generatingDescription ? 'Generating...' : 'Generate with AI'}
                                                    </button>
                                                </div>
                                                <textarea
                                                    rows={6}
                                                    value={assetForm.longContext || assetForm.description}
                                                    onChange={(e) => setAssetForm((p) => ({ ...p, longContext: e.target.value, description: p.description || e.target.value.split('\n')[0].slice(0, 140) }))}
                                                    placeholder={`Write or generate the full context for this ${assetForm.type}. The content will be written into the scaffolded ${assetForm.type === 'agent' ? 'prompt.md' : assetForm.type === 'skill' ? 'SKILL.md' : assetForm.type === 'mcp-server' ? 'README.md' : 'file body'}.`}
                                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-[12px] leading-5 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                                <p className="text-[10px] leading-4 text-surface-400">
                                                    AI generator uses exemplars from <span className="font-mono">{EXEMPLAR_LABELS[assetForm.type]}</span> for tone and structure.
                                                </p>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={submitting || !assetForm.name.trim()}
                                                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <PlusIcon className="h-3 w-3" /> {submitting ? 'Creating...' : 'Create scaffold'}
                                            </button>
                                        </form>
                                    </section>
                                </div>
                            )}

                            {catalog && activeTab === 'agents' && (
                                <div className="space-y-3">
                                    {/* Builder actions bar */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowBuilderWizard(true)}
                                            className="inline-flex items-center gap-1.5 rounded-xl bg-surface-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-surface-800"
                                        >
                                            <PlusIcon className="h-3.5 w-3.5" /> Create with Builder
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => updateUrl({ tab: 'templates' })}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-surface-200 bg-white px-4 py-2 text-[12px] font-semibold text-surface-700 hover:bg-surface-50"
                                        >
                                            <SparkleIcon className="h-3.5 w-3.5" /> Browse Templates
                                        </button>
                                    </div>

                                    {/* Validation result banner */}
                                    {validationResult && (
                                        <div className={`rounded-xl border p-4 text-[12px] ${validationResult.publishable ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-surface-800">
                                                    Validation: {validationResult.grade || '?'} ({validationResult.score}%)
                                                    {validationResult.publishable ? ' — Ready to publish' : ' — Needs improvement'}
                                                </span>
                                                <button onClick={() => setValidationResult(null)} className="text-[11px] text-surface-400 hover:text-surface-600">Dismiss</button>
                                            </div>
                                            {validationResult.errors?.length > 0 && (
                                                <ul className="mt-2 list-disc pl-4 text-red-700">
                                                    {validationResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                                                </ul>
                                            )}
                                            {validationResult.warnings?.length > 0 && (
                                                <ul className="mt-1 list-disc pl-4 text-amber-700">
                                                    {validationResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                                </ul>
                                            )}
                                        </div>
                                    )}

                                    {(catalog.assets?.agents || []).length === 0 ? (
                                        <EmptyTab
                                            icon={CodeIcon}
                                            title="No agents yet"
                                            hint="Scaffold a custom agent from the Overview tab to get started."
                                        />
                                    ) : (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {catalog.assets.agents.map((agent) => (
                                                <div key={agent.id} ref={highlightedAgentId === agent.id ? highlightRef : null}>
                                                    <AgentRow
                                                        agent={agent}
                                                        busy={busyAgentId === agent.id}
                                                        highlight={highlightedAgentId === agent.id}
                                                        onPublish={handlePublishAgent}
                                                        onToggleActivation={handleToggleActivation}
                                                        onOpenFile={openWorkspaceFile}
                                                        onDelete={handleDeleteAgent}
                                                        onExport={(a) => setExportTarget({ agentId: a.id, agentName: a.name })}
                                                        onValidate={handleValidateAgent}
                                                        validating={validatingAgentId === agent.id}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {catalog && activeTab === 'skills' && (
                                <>
                                    {(catalog.assets?.skills || []).length === 0 && !editingSkill ? (
                                        <EmptyTab icon={DocumentIcon} title="No skills yet" hint="Skills are folder-based SKILL.md packages that give agents local guidance. Uses Anthropic Agent Skills format with YAML frontmatter." />
                                    ) : !editingSkill ? (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {catalog.assets.skills.map((item) => (
                                                <article key={item.id} className="rounded-2xl border border-surface-200/80 bg-white p-4 shadow-sm hover:border-surface-300">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-semibold text-surface-800">{item.name}</p>
                                                            <p className="mt-0.5 truncate text-[11px] font-medium text-surface-400">{item.path}</p>
                                                        </div>
                                                        {item.status && (
                                                            <Chip className={statusChipClass(item.status)}>{item.status}</Chip>
                                                        )}
                                                    </div>
                                                    {item.description && (
                                                        <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-surface-500">{item.description}</p>
                                                    )}
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenSkillEditor(item)}
                                                            className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                                        >
                                                            Edit skill
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openWorkspaceFile(item.files?.find(f => f.label !== 'Manifest')?.path || item.path)}
                                                            className="inline-flex items-center rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-700 hover:bg-surface-50"
                                                        >
                                                            Open SKILL.md
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteSkill(item)}
                                                            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                                                        >
                                                            <TrashIcon className="h-3 w-3" />
                                                            Delete
                                                        </button>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    ) : (
                                        /* ─── Skill Editor Panel ─── */
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditingSkill(null); setSkillEditorDirty(false); setSkillValidation(null); }}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50"
                                                >
                                                    ← Back to skills list
                                                </button>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleAutoFixFormat}
                                                        disabled={skillAutoFixing}
                                                        className="inline-flex items-center rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-[12px] font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-40"
                                                        title="Auto-fix YAML frontmatter and format compliance"
                                                    >
                                                        {skillAutoFixing ? 'Fixing…' : '⚡ Auto-Fix Format'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleValidateSkill}
                                                        className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-100"
                                                    >
                                                        Validate
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveSkill}
                                                        disabled={!skillEditorDirty || skillSaving}
                                                        className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                                                    >
                                                        {skillSaving ? 'Saving…' : 'Save skill'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Validation feedback */}
                                            {skillValidation && (
                                                <div className={`rounded-xl border p-3 text-[12px] leading-5 ${skillValidation.valid ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                                                    {skillValidation.valid ? (
                                                        <p className="font-semibold">✓ Skill passes validation</p>
                                                    ) : (
                                                        <div>
                                                            <p className="font-semibold">Validation errors:</p>
                                                            <ul className="mt-1 list-disc pl-4">{skillValidation.errors?.map((e, i) => <li key={i}>{e}</li>)}</ul>
                                                        </div>
                                                    )}
                                                    {(skillValidation.warnings || []).length > 0 && (
                                                        <div className="mt-2 border-t border-amber-200 pt-2 text-amber-700">
                                                            <p className="font-semibold">Warnings:</p>
                                                            <ul className="mt-1 list-disc pl-4">{skillValidation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                                                        </div>
                                                    )}
                                                    {(skillValidation.suggestions || []).length > 0 && (
                                                        <div className="mt-2 border-t border-blue-200 pt-2 text-blue-700">
                                                            <p className="font-semibold">Suggestions:</p>
                                                            <ul className="mt-1 list-disc pl-4">{skillValidation.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Frontmatter fields */}
                                            <div className="rounded-2xl border border-surface-200 bg-white p-4 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-[13px] font-semibold text-surface-700">Skill Metadata</h4>
                                                    {editingSkill.skillContent && (
                                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${/^---\s*\n[\s\S]*?\n---/.test(editingSkill.skillContent)
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-red-100 text-red-700'
                                                            }`}>
                                                            {/^---\s*\n[\s\S]*?\n---/.test(editingSkill.skillContent) ? '✓ Frontmatter' : '✗ No Frontmatter'}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div>
                                                        <label className="block text-[11px] font-semibold text-surface-500 mb-1">Name <span className="text-surface-400">(max 64 chars, lowercase + hyphens)</span></label>
                                                        <input
                                                            type="text"
                                                            value={editingSkill.name || ''}
                                                            onChange={(e) => handleSkillFieldChange('name', e.target.value)}
                                                            maxLength={64}
                                                            className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] font-semibold text-surface-500 mb-1">Status</label>
                                                        <Chip className={statusChipClass(editingSkill.status || 'draft')}>{editingSkill.status || 'draft'}</Chip>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-semibold text-surface-500 mb-1">Description <span className="text-surface-400">(max 1024 chars)</span></label>
                                                    <textarea
                                                        value={editingSkill.description || ''}
                                                        onChange={(e) => handleSkillFieldChange('description', e.target.value)}
                                                        maxLength={1024}
                                                        rows={2}
                                                        className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none resize-none"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-semibold text-surface-500 mb-1">Keywords <span className="text-surface-400">(comma-separated)</span></label>
                                                    <input
                                                        type="text"
                                                        value={(editingSkill.keywords || []).join(', ')}
                                                        onChange={(e) => handleSkillFieldChange('keywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                                                        placeholder="e.g. release, checklist, pre-deploy"
                                                        className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-semibold text-surface-500 mb-1">Allowed Tools <span className="text-surface-400">(restrict which tools this skill may use)</span></label>
                                                    <input
                                                        type="text"
                                                        value={(editingSkill.allowedTools || []).join(', ')}
                                                        onChange={(e) => handleSkillFieldChange('allowedTools', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                                                        placeholder="e.g. Read, Write, WebSearch (leave empty for all)"
                                                        className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-semibold text-surface-500 mb-1">Agent Bindings <span className="text-surface-400">(bind to specific agents for +10 score boost)</span></label>
                                                    <input
                                                        type="text"
                                                        value={(editingSkill.agentBindings || []).join(', ')}
                                                        onChange={(e) => handleSkillFieldChange('agentBindings', e.target.value.split(',').map(a => a.trim()).filter(Boolean))}
                                                        placeholder="e.g. testgenie, scriptgenerator (leave empty for all agents)"
                                                        className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                                    />
                                                    {(editingSkill.agentBindings || []).length > 0 && (
                                                        <p className="mt-1 text-[10px] text-indigo-500">
                                                            Bound agents get +10 score boost, making this skill auto-activate more easily when those agents are active.
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!editingSkill.alwaysActiveForBoundAgents}
                                                            onChange={(e) => handleSkillFieldChange('alwaysActiveForBoundAgents', e.target.checked)}
                                                            className="sr-only peer"
                                                        />
                                                        <div className="w-9 h-5 bg-surface-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-surface-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                                                    </label>
                                                    <div>
                                                        <span className="text-[11px] font-semibold text-surface-600">Always Active for Bound Agents</span>
                                                        <p className="text-[10px] text-surface-400">When enabled, this skill auto-activates on every message when a bound agent is active — no keyword match needed.</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* SKILL.md body editor */}
                                            <div className="rounded-2xl border border-surface-200 bg-white p-4 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[13px] font-semibold text-surface-700">SKILL.md Content</h4>
                                                    <span className="text-[11px] text-surface-400">
                                                        {(editingSkill.skillContent || '').split('\n').length} lines
                                                        {(editingSkill.skillContent || '').split('\n').length > 500 && ' ⚠️ exceeds 500-line recommendation'}
                                                    </span>
                                                </div>
                                                <textarea
                                                    value={editingSkill.skillContent || ''}
                                                    onChange={(e) => handleSkillFieldChange('skillContent', e.target.value)}
                                                    rows={20}
                                                    spellCheck={false}
                                                    className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 font-mono leading-6 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none resize-y"
                                                    placeholder={'---\nname: my-skill\ndescription: \'What this skill does\'\n---\n\n# My Skill\n\n## When To Use This Skill\n\n- When...\n\nKeywords: keyword1, keyword2\n\n## Instructions\n\n- Rule 1\n- Rule 2'}
                                                />
                                            </div>

                                            {/* Supporting files */}
                                            {(editingSkill.supportingFiles || []).length > 0 && (
                                                <div className="rounded-2xl border border-surface-200 bg-white p-4 space-y-2">
                                                    <h4 className="text-[13px] font-semibold text-surface-700">Supporting Files</h4>
                                                    <div className="space-y-1">
                                                        {editingSkill.supportingFiles.map((file) => (
                                                            <button
                                                                key={file.name}
                                                                type="button"
                                                                onClick={() => openWorkspaceFile(file.path)}
                                                                className="flex items-center gap-2 w-full text-left rounded-lg px-3 py-1.5 text-[12px] text-surface-600 hover:bg-surface-50"
                                                            >
                                                                {file.isDirectory ? <FolderIcon className="h-3 w-3 text-amber-500" /> : <FileIcon className="h-3 w-3 text-surface-400" />}
                                                                {file.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Skill Test Sandbox */}
                                            <div className="rounded-2xl border border-surface-200 bg-white p-4 space-y-3">
                                                <h4 className="text-[13px] font-semibold text-surface-700">Test Skill Matching</h4>
                                                <p className="text-[11px] text-surface-500">Type a sample user message to see if this skill would be auto-activated.</p>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={skillTestMessage}
                                                        onChange={(e) => setSkillTestMessage(e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleTestSkillMatch()}
                                                        placeholder="e.g. create a PowerPoint deck for the sprint review"
                                                        className="flex-1 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-800 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={handleTestSkillMatch}
                                                        disabled={skillTestLoading || !skillTestMessage.trim()}
                                                        className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                                                    >
                                                        {skillTestLoading ? 'Testing…' : 'Test'}
                                                    </button>
                                                </div>
                                                {skillTestResult && (
                                                    <div className="rounded-xl border border-surface-200 bg-surface-50 p-3 text-[12px]">
                                                        {skillTestResult.error ? (
                                                            <p className="text-red-600">{skillTestResult.error}</p>
                                                        ) : skillTestResult.matches?.length > 0 ? (
                                                            <div className="space-y-2">
                                                                {skillTestResult.matches.map((m, i) => (
                                                                    <div key={i} className="flex items-start gap-2">
                                                                        <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${m.confidence === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                            {m.confidence}
                                                                        </span>
                                                                        <div>
                                                                            <p className="font-semibold text-surface-700">{m.name} <span className="font-normal text-surface-400">(score: {m.score})</span></p>
                                                                            {m.matchedKeywords?.length > 0 && <p className="text-surface-500">Keywords: {m.matchedKeywords.join(', ')}</p>}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {skillTestResult.activatedSkills?.length > 0 && (
                                                                    <p className="mt-1 text-green-700 font-semibold">Auto-activated: {skillTestResult.activatedSkills.join(', ')}</p>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <p className="text-surface-500">No skills matched this message. Try adding more keywords.</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {catalog && activeTab === 'mcp' && (
                                (catalog.assets?.mcpServers || []).length === 0 ? (
                                    <EmptyTab icon={WrenchIcon} title="No MCP servers yet" hint="Scaffold an MCP server to expose custom tools to your agents." />
                                ) : (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {catalog.assets.mcpServers.map((item) => (
                                            <GenericAssetRow key={item.id} item={item} onOpenFile={openWorkspaceFile} onDelete={handleDeleteMcp} />
                                        ))}
                                    </div>
                                )
                            )}

                            {catalog && activeTab === 'files' && (
                                (catalog.assets?.files || []).length === 0 ? (
                                    <EmptyTab icon={FileIcon} title="No supporting files yet" hint="Add notes, config drafts, or reference files under files/." />
                                ) : (
                                    <div className="space-y-2">
                                        {catalog.assets.files.map((item) => (
                                            <FileRow key={item.id} item={item} onOpenFile={openWorkspaceFile} onDelete={handleDeleteFile} />
                                        ))}
                                    </div>
                                )
                            )}

                            {activeTab === 'templates' && (
                                <div className="surface-panel rounded-2xl overflow-hidden" style={{ minHeight: '480px' }}>
                                    <TemplateGallery
                                        onFork={() => { updateUrl({ tab: 'agents' }); loadWorkspaceDetails(selectedWorkspaceId); }}
                                        onClose={() => updateUrl({ tab: 'agents' })}
                                    />
                                </div>
                            )}

                            {activeTab === 'mcp-designer' && (
                                <div className="surface-panel rounded-2xl overflow-hidden" style={{ minHeight: '480px' }}>
                                    <McpDesigner
                                        onClose={() => updateUrl({ tab: 'mcp' })}
                                    />
                                </div>
                            )}

                            {activeTab === 'analytics' && (
                                <div className="surface-panel rounded-2xl overflow-hidden" style={{ minHeight: '480px' }}>
                                    <AgentAnalyticsDashboard />
                                </div>
                            )}

                            {activeTab === 'editor' && (
                                <div className="grid gap-3 lg:grid-cols-[300px,1fr]">
                                    <section className="surface-panel rounded-2xl p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Tree</p>
                                            {detailsLoading && <span className="text-[10px] font-medium text-surface-400">Refreshing...</span>}
                                        </div>
                                        <div className="max-h-[28rem] overflow-y-auto pr-1">
                                            {tree ? (
                                                <WorkspaceTreeNode node={tree} selectedPath={selectedFile?.path || ''} onOpenFile={openWorkspaceFile} />
                                            ) : (
                                                <div className="rounded-lg border border-dashed border-surface-200 bg-surface-50/70 px-3 py-4 text-center text-[11px] font-medium text-surface-400">
                                                    Workspace tree unavailable.
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="surface-panel rounded-2xl p-4">
                                        {selectedFile ? (
                                            <>
                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500">Editing</p>
                                                        <p className="mt-0.5 truncate font-mono text-[12px] font-semibold text-surface-700">{selectedFile.path}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-medium text-surface-500">
                                                            {editorDirty ? 'Unsaved changes' : 'Saved'}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => { setSelectedFile(null); setEditorContent(''); setEditorDirty(false); updateUrl({ file: null }); }}
                                                            className="rounded-lg border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-surface-600 hover:bg-surface-50"
                                                        >
                                                            Close
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={saveFile}
                                                            disabled={!editorDirty || savingFile}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-surface-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            <CheckIcon className="h-3 w-3" /> {savingFile ? 'Saving...' : 'Save (Ctrl+S)'}
                                                        </button>
                                                    </div>
                                                </div>
                                                <textarea
                                                    value={editorContent}
                                                    onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                                                    className="h-[28rem] w-full rounded-xl border border-surface-200 bg-slate-950 p-4 font-mono text-[12.5px] leading-6 text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                                    spellCheck={false}
                                                />
                                            </>
                                        ) : (
                                            <EmptyTab
                                                icon={ExplorerIcon}
                                                title="Open any file to edit"
                                                hint="Select a file from the tree, or use 'Open prompt/manifest' from the Agents tab."
                                            />
                                        )}
                                    </section>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            {/* ─── Overlay: Agent Builder Wizard ─── */}
            {showBuilderWizard && selectedWorkspaceId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-xl">
                        <AgentBuilderWizard
                            workspaceId={selectedWorkspaceId}
                            onComplete={() => {
                                setShowBuilderWizard(false);
                                loadWorkspaceDetails(selectedWorkspaceId);
                                updateUrl({ tab: 'agents' });
                            }}
                            onCancel={() => setShowBuilderWizard(false)}
                        />
                    </div>
                </div>
            )}

            {/* ─── Overlay: Agent Export Dialog ─── */}
            {exportTarget && selectedWorkspaceId && (
                <AgentExportDialog
                    workspaceId={selectedWorkspaceId}
                    agentId={exportTarget.agentId}
                    agentName={exportTarget.agentName}
                    onClose={() => setExportTarget(null)}
                />
            )}
        </div>
    );
}
