'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import {
    SparkleIcon,
    SearchIcon,
    TrashIcon,
    PlusIcon,
    ChatBubbleIcon,
    ExplorerIcon,
    CheckIcon,
} from '@/components/Icons';
import apiClient from '@/lib/api-client';
import useAgentCatalog from '@/hooks/useAgentCatalog';
import MyAgentsLauncher from '@/components/MyAgentsLauncher';

const STATUS_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'published', label: 'Published' },
    { value: 'draft', label: 'Draft' },
];

const SORT_OPTIONS = [
    { value: 'updated', label: 'Recently updated' },
    { value: 'name', label: 'Name (A–Z)' },
];

function formatRelative(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.round(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.round(diffHrs / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function statusChipClass(agent) {
    if (agent.isActive) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (agent.isPublished) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
}

function statusLabel(agent) {
    if (agent.isActive) return 'Active';
    if (agent.isPublished) return 'Published';
    return 'Draft';
}

function MyAgentCard({ agent, busy, launching, onUseInChat, onToggleActivation, onDelete }) {
    const updated = formatRelative(agent.activatedAt || agent.publishedAt);

    return (
        <article className="group relative flex h-full flex-col rounded-2xl border border-surface-200/80 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${agent.bgClass || 'bg-violet-50'} ${agent.textClass || 'text-violet-600'}`}>
                        <SparkleIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-surface-900">{agent.label}</h3>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChipClass(agent)}`}>
                                {statusLabel(agent)}
                            </span>
                        </div>
                        {agent.workspaceName && (
                            <p className="mt-0.5 text-[11px] font-medium text-surface-500">
                                <span className="text-surface-400">Workspace ·</span> {agent.workspaceName}
                            </p>
                        )}
                    </div>
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.badgeBg || 'bg-violet-100'} ${agent.badgeText || 'text-violet-700'}`}>
                    {agent.shortLabel}
                </span>
            </div>

            <p className="mt-3 line-clamp-3 text-[13px] leading-5 text-surface-500">
                {agent.description || 'No description yet.'}
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-surface-400">
                <div>
                    <dt className="opacity-70">Tool profile</dt>
                    <dd className="mt-0.5 text-surface-600 normal-case tracking-normal">{agent.toolProfile || 'full'}</dd>
                </div>
                <div>
                    <dt className="opacity-70">Updated</dt>
                    <dd className="mt-0.5 text-surface-600 normal-case tracking-normal">{updated || '—'}</dd>
                </div>
            </dl>

            <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <button
                    type="button"
                    onClick={() => onUseInChat(agent)}
                    disabled={!agent.isActive || launching}
                    title={agent.isActive ? 'Start a chat using this agent' : 'Activate the agent to use it in chat'}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {launching ? (
                        <>
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                            Opening chat...
                        </>
                    ) : (
                        <>
                            <ChatBubbleIcon className="h-3.5 w-3.5" />
                            Use in Chat
                        </>
                    )}
                </button>
                {agent.workspaceId && agent.assetId && (
                    <Link
                        href={`/studio?workspace=${encodeURIComponent(agent.workspaceId)}&tab=agents&agent=${encodeURIComponent(agent.assetId)}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-surface-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-surface-700 transition-colors hover:bg-surface-50"
                    >
                        <ExplorerIcon className="h-3.5 w-3.5" />
                        Open in Studio
                    </Link>
                )}
                {agent.isPublished && (
                    <button
                        type="button"
                        onClick={() => onToggleActivation(agent)}
                        disabled={busy}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${agent.isActive
                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}
                    >
                        <CheckIcon className="h-3.5 w-3.5" />
                        {agent.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onDelete(agent)}
                    disabled={busy}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete
                </button>
            </div>
        </article>
    );
}

function EmptyState() {
    return (
        <div className="surface-panel flex flex-col items-center justify-center gap-3 rounded-3xl px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
                <SparkleIcon className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-surface-800">No custom agents yet</h3>
            <p className="max-w-sm text-[13px] leading-5 text-surface-500">
                Create your first agent in Studio. Publish and activate it to see it here and use it from chat.
            </p>
            <Link
                href="/studio"
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-surface-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-surface-800"
            >
                <PlusIcon className="h-3.5 w-3.5" /> Open Agent Studio
            </Link>
        </div>
    );
}

export default function MyAgentsPage() {
    const { agents, loading, error: catalogError, refresh } = useAgentCatalog({ includeInactive: true });
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [workspaceFilter, setWorkspaceFilter] = useState('all');
    const [sort, setSort] = useState('updated');
    const [actionError, setActionError] = useState('');
    const [busyId, setBusyId] = useState('');
    const [launchingId, setLaunchingId] = useState('');
    const [launcherAgentId, setLauncherAgentId] = useState(null);

    const customAgents = useMemo(() => agents.filter((agent) => agent.isCustom === true), [agents]);

    const workspaceOptions = useMemo(() => {
        const map = new Map();
        customAgents.forEach((agent) => {
            if (agent.workspaceId && !map.has(agent.workspaceId)) {
                map.set(agent.workspaceId, agent.workspaceName || agent.workspaceId);
            }
        });
        return Array.from(map, ([value, label]) => ({ value, label }));
    }, [customAgents]);

    const filteredAgents = useMemo(() => {
        const query = search.trim().toLowerCase();
        let list = customAgents.filter((agent) => {
            if (statusFilter === 'active' && !agent.isActive) return false;
            if (statusFilter === 'published' && !(agent.isPublished && !agent.isActive)) return false;
            if (statusFilter === 'draft' && agent.isPublished) return false;
            if (workspaceFilter !== 'all' && agent.workspaceId !== workspaceFilter) return false;
            if (!query) return true;
            const haystack = `${agent.label || ''} ${agent.description || ''} ${agent.workspaceName || ''}`.toLowerCase();
            return haystack.includes(query);
        });
        if (sort === 'name') {
            list = list.slice().sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
        } else {
            list = list.slice().sort((a, b) => String(b.activatedAt || b.publishedAt || '').localeCompare(String(a.activatedAt || a.publishedAt || '')));
        }
        return list;
    }, [customAgents, search, statusFilter, workspaceFilter, sort]);

    const counts = useMemo(() => ({
        total: customAgents.length,
        active: customAgents.filter((a) => a.isActive).length,
        published: customAgents.filter((a) => a.isPublished && !a.isActive).length,
        draft: customAgents.filter((a) => !a.isPublished).length,
    }), [customAgents]);

    const handleUseInChat = useCallback((agent) => {
        if (!agent?.id) return;
        // Open the launcher modal so the user can choose a model before creating the chat session.
        setLauncherAgentId(agent.id);
    }, []);

    const handleToggleActivation = useCallback(async (agent) => {
        if (!agent?.workspaceId || !agent?.assetId) return;
        setActionError('');
        setBusyId(agent.id);
        try {
            await apiClient.setStudioAgentActivation(agent.workspaceId, agent.assetId, !agent.isActive);
            await refresh();
        } catch (err) {
            setActionError(err.message || 'Failed to update activation');
        } finally {
            setBusyId('');
        }
    }, [refresh]);

    const handleDelete = useCallback(async (agent) => {
        if (!agent?.workspaceId || !agent?.assetId) return;
        const confirmed = window.confirm(
            `Delete agent "${agent.label}"? This removes its folder from the workspace and cannot be undone.`
        );
        if (!confirmed) return;

        setActionError('');
        setBusyId(agent.id);
        try {
            await apiClient.deleteStudioAgent(agent.workspaceId, agent.assetId);
            await refresh();
        } catch (err) {
            setActionError(err.message || 'Failed to delete agent');
        } finally {
            setBusyId('');
        }
    }, [refresh]);

    return (
        <div className="space-y-4">
            <PageHeader
                title="My Agents"
                subtitle="Custom agents published from your Studio workspaces"
                Icon={SparkleIcon}
                actions={(
                    <Link
                        href="/studio"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20"
                    >
                        <PlusIcon className="h-3.5 w-3.5" /> New agent in Studio
                    </Link>
                )}
            />

            {(actionError || catalogError) && (
                <ErrorBanner error={actionError || catalogError} onDismiss={() => setActionError('')} />
            )}

            <div className="surface-panel rounded-3xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <div className="relative min-w-[200px] flex-1">
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search my agents..."
                            autoComplete="off"
                            suppressHydrationWarning
                            className="w-full rounded-xl border border-surface-200 bg-white py-2 pl-9 pr-3 text-[13px] text-surface-800 placeholder-surface-400 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                        />
                    </div>

                    <div className="inline-flex rounded-xl border border-surface-200 bg-surface-50 p-0.5">
                        {STATUS_FILTERS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setStatusFilter(opt.value)}
                                className={`px-3 py-1.5 text-[11px] font-semibold transition-colors rounded-lg ${statusFilter === opt.value
                                    ? 'bg-white text-surface-900 shadow-sm'
                                    : 'text-surface-500 hover:text-surface-800'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {workspaceOptions.length > 1 && (
                        <select
                            value={workspaceFilter}
                            onChange={(event) => setWorkspaceFilter(event.target.value)}
                            suppressHydrationWarning
                            className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] font-semibold text-surface-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                        >
                            <option value="all">All workspaces</option>
                            {workspaceOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    )}

                    <select
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                        suppressHydrationWarning
                        className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] font-semibold text-surface-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                    >
                        {SORT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-surface-400">
                    <span>Total {counts.total}</span>
                    <span className="text-emerald-600">Active {counts.active}</span>
                    <span className="text-blue-600">Published {counts.published}</span>
                    <span className="text-amber-600">Draft {counts.draft}</span>
                </div>
            </div>

            {loading && customAgents.length === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map((idx) => (
                        <div key={idx} className="h-48 animate-pulse rounded-2xl border border-surface-200/80 bg-white/60" />
                    ))}
                </div>
            ) : filteredAgents.length === 0 ? (
                customAgents.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="surface-panel rounded-3xl px-6 py-10 text-center text-sm font-medium text-surface-500">
                        No agents match your filters.
                    </div>
                )
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredAgents.map((agent) => (
                        <MyAgentCard
                            key={agent.id}
                            agent={agent}
                            busy={busyId === agent.id}
                            launching={launchingId === agent.id}
                            onUseInChat={handleUseInChat}
                            onToggleActivation={handleToggleActivation}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            <MyAgentsLauncher
                variant="controlled"
                open={!!launcherAgentId}
                onClose={() => setLauncherAgentId(null)}
                agents={agents}
                initialAgentId={launcherAgentId}
            />
        </div>
    );
}
