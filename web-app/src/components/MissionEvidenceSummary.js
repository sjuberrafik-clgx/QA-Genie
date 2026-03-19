'use client';

import { useState } from 'react';

import {
    BarChartIcon,
    CheckIcon,
    ClipboardIcon,
    ClockIcon,
    DocumentIcon,
    ExclamationIcon,
    FolderOpenIcon,
    GlobeIcon,
    SparkleIcon,
    UserIcon,
} from '@/components/Icons';
import { apiClient } from '@/lib/api-client';

function formatCount(value) {
    return typeof value === 'number' ? value.toLocaleString() : '0';
}

function formatDate(value) {
    if (!value) return 'Not available';
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
}

function formatLabel(value) {
    if (!value) return 'Unavailable';
    return String(value)
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortPath(value) {
    if (!value) return 'Unavailable';
    const normalized = String(value).replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts.slice(-2).join('/');
}

function getScenario(summary, authState) {
    return (summary?.scenarios || []).find((scenario) => scenario.authState === authState) || null;
}

function getArtifactKey(artifact) {
    return artifact?.path || artifact?.label || artifact?.kind || 'artifact';
}

function StatCard({ label, value, detail, Icon, accent }) {
    return (
        <div className="rounded-2xl border border-surface-200/80 bg-white/90 px-4 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="type-meta-label">{label}</p>
                    <p className="mt-1.5 text-[1.5rem] font-semibold tracking-[-0.03em] text-surface-900">{value}</p>
                    {detail ? <p className="mt-1 text-xs text-surface-500">{detail}</p> : null}
                </div>
                <div className={`rounded-2xl p-2.5 ${accent}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    );
}

function ActionButton({ children, onClick, disabled = false, title }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${disabled
                ? 'cursor-not-allowed border-surface-200 bg-surface-100 text-surface-400'
                : 'border-surface-200 bg-white text-surface-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700'
                }`}
        >
            {children}
        </button>
    );
}

function ArtifactCard({ artifact, copiedArtifactKey, onCopyPath, onOpenArtifact, onRevealArtifact }) {
    const available = artifact?.exists !== false && Boolean(artifact?.path);
    const artifactKey = getArtifactKey(artifact);

    return (
        <div className="rounded-xl border border-surface-200/70 bg-surface-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-surface-500">{formatLabel(artifact.kind)}</span>
                <span className="text-[10px] text-surface-400">{available ? 'available' : 'missing'}</span>
            </div>
            <p className="mt-1.5 break-all text-sm font-medium text-surface-700">{shortPath(artifact.path)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton
                    onClick={() => onCopyPath?.(artifact.path, artifactKey)}
                    disabled={!artifact?.path}
                    title="Copy absolute path"
                >
                    {copiedArtifactKey === artifactKey ? <CheckIcon /> : <ClipboardIcon />}
                    <span>{copiedArtifactKey === artifactKey ? 'Copied' : 'Copy Path'}</span>
                </ActionButton>
                <ActionButton
                    onClick={() => onOpenArtifact?.(artifact.path)}
                    disabled={!available}
                    title="Open artifact in a new browser tab"
                >
                    <DocumentIcon className="h-3.5 w-3.5" />
                    <span>Open</span>
                </ActionButton>
                <ActionButton
                    onClick={() => onRevealArtifact?.(artifact.path)}
                    disabled={!available}
                    title="Open artifact with the default native application"
                >
                    <FolderOpenIcon className="h-3.5 w-3.5" />
                    <span>Reveal</span>
                </ActionButton>
                {available ? (
                    <a
                        href={apiClient.getPipelineArtifactUrl(artifact.path, { download: true })}
                        download
                        className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-surface-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        title="Download artifact"
                    >
                        <DocumentIcon className="h-3.5 w-3.5" />
                        <span>Download</span>
                    </a>
                ) : null}
            </div>
        </div>
    );
}

function ScenarioPanel({ title, Icon, scenario }) {
    const [copiedArtifactKey, setCopiedArtifactKey] = useState(null);

    if (!scenario) {
        return (
            <div className="rounded-[26px] border border-dashed border-surface-300 bg-white/70 p-5">
                <div className="flex items-center gap-2 text-surface-700">
                    <Icon className="h-4 w-4" />
                    <h3 className="text-sm font-semibold tracking-[-0.015em]">{title}</h3>
                </div>
                <p className="mt-4 text-sm text-surface-500">No evidence branch was produced for this auth state.</p>
            </div>
        );
    }

    const statusTone = scenario.success === true
        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
        : scenario.success === false
            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
            : 'bg-surface-100 text-surface-600 ring-1 ring-surface-200';

    const handleCopyPath = async (artifactPath, artifactKey) => {
        if (!artifactPath) return;
        try {
            await navigator.clipboard.writeText(artifactPath);
            setCopiedArtifactKey(artifactKey);
            setTimeout(() => setCopiedArtifactKey((current) => (current === artifactKey ? null : current)), 2000);
        } catch {
            /* ignore clipboard failures */
        }
    };

    const handleOpenArtifact = (artifactPath) => {
        const url = apiClient.getPipelineArtifactUrl(artifactPath, { download: false });
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleRevealArtifact = async (artifactPath) => {
        if (!artifactPath) return;
        try {
            await apiClient.openFileInNativeApp(artifactPath);
        } catch {
            /* ignore native open failures */
        }
    };

    return (
        <div className="rounded-[26px] border border-surface-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-surface-800">
                        <Icon className="h-4 w-4" />
                        <h3 className="text-sm font-semibold tracking-[-0.015em]">{title}</h3>
                    </div>
                    <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-surface-900">{scenario.name || formatLabel(scenario.authState)}</p>
                    <p className="mt-1 text-xs text-surface-500">{formatLabel(scenario.authState)} branch</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone}`}>
                    {scenario.status || 'unknown'}
                </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-surface-200/70 bg-white px-3 py-3">
                    <p className="type-meta-label">Artifacts</p>
                    <p className="mt-1 text-lg font-semibold text-surface-900">{formatCount(scenario.summary?.totalArtifacts)}</p>
                </div>
                <div className="rounded-2xl border border-surface-200/70 bg-white px-3 py-3">
                    <p className="type-meta-label">Screenshots</p>
                    <p className="mt-1 text-lg font-semibold text-surface-900">{formatCount(scenario.summary?.screenshots)}</p>
                </div>
                <div className="rounded-2xl border border-surface-200/70 bg-white px-3 py-3">
                    <p className="type-meta-label">Failed Tests</p>
                    <p className="mt-1 text-lg font-semibold text-surface-900">{formatCount(scenario.summary?.failedTests)}</p>
                </div>
                <div className="rounded-2xl border border-surface-200/70 bg-white px-3 py-3">
                    <p className="type-meta-label">Observations</p>
                    <p className="mt-1 text-lg font-semibold text-surface-900">{formatCount(scenario.summary?.observations)}</p>
                </div>
            </div>

            <div className="mt-5 space-y-3 text-xs text-surface-500">
                <div>
                    <p className="type-meta-label">Started</p>
                    <p className="mt-1 font-medium text-surface-700">{formatDate(scenario.startedAt)}</p>
                </div>
                <div>
                    <p className="type-meta-label">Completed</p>
                    <p className="mt-1 font-medium text-surface-700">{formatDate(scenario.completedAt)}</p>
                </div>
                <div>
                    <p className="type-meta-label">Spec</p>
                    <p className="mt-1 break-all font-medium text-surface-700">{shortPath(scenario.specPath)}</p>
                </div>
                <div>
                    <p className="type-meta-label">Report</p>
                    <p className="mt-1 break-all font-medium text-surface-700">{shortPath(scenario.reportPath)}</p>
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-surface-200/70 bg-white px-4 py-4">
                <p className="type-meta-label">Latest Observations</p>
                {(scenario.observations || []).length === 0 ? (
                    <p className="mt-2 text-sm text-surface-500">No observations recorded for this branch.</p>
                ) : (
                    <div className="mt-3 space-y-2">
                        {scenario.observations.slice(0, 3).map((observation) => (
                            <div key={observation.id || `${observation.timestamp}-${observation.message}`} className="rounded-xl border border-surface-200/70 bg-surface-50 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-surface-500">{formatLabel(observation.type)}</span>
                                    <span className="text-[10px] text-surface-400">{formatDate(observation.timestamp)}</span>
                                </div>
                                <p className="mt-1.5 text-sm font-medium text-surface-700">{observation.message || 'Observation recorded'}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-5 rounded-2xl border border-surface-200/70 bg-white px-4 py-4">
                <p className="type-meta-label">Key Evidence Files</p>
                {(scenario.downloads || []).length === 0 ? (
                    <p className="mt-2 text-sm text-surface-500">No downloadable artifacts recorded for this branch.</p>
                ) : (
                    <div className="mt-3 space-y-2">
                        {scenario.downloads.slice(0, 5).map((artifact) => (
                            <ArtifactCard
                                key={artifact.path}
                                artifact={artifact}
                                copiedArtifactKey={copiedArtifactKey}
                                onCopyPath={handleCopyPath}
                                onOpenArtifact={handleOpenArtifact}
                                onRevealArtifact={handleRevealArtifact}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MissionEvidenceSummary({
    runs = [],
    selectedRunId,
    onSelectRun,
    summary,
    loading,
    error,
}) {
    const authenticatedScenario = getScenario(summary, 'authenticated');
    const unauthenticatedScenario = getScenario(summary, 'unauthenticated');
    const [copiedArtifactKey, setCopiedArtifactKey] = useState(null);

    const handleCopyPath = async (artifactPath, artifactKey) => {
        if (!artifactPath) return;
        try {
            await navigator.clipboard.writeText(artifactPath);
            setCopiedArtifactKey(artifactKey);
            setTimeout(() => setCopiedArtifactKey((current) => (current === artifactKey ? null : current)), 2000);
        } catch {
            /* ignore clipboard failures */
        }
    };

    const handleOpenArtifact = (artifactPath) => {
        const url = apiClient.getPipelineArtifactUrl(artifactPath, { download: false });
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleRevealArtifact = async (artifactPath) => {
        if (!artifactPath) return;
        try {
            await apiClient.openFileInNativeApp(artifactPath);
        } catch {
            /* ignore native open failures */
        }
    };

    return (
        <div className="glass-card rounded-2xl p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100">
                            <BarChartIcon className="h-4 w-4 text-surface-600" />
                        </div>
                        <h2 className="type-card-title text-[1.02rem]">Mission Evidence</h2>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-surface-500">
                        This section flattens the parent mission evidence payload so the dashboard can compare authenticated and unauthenticated execution side by side without merging manifests in the browser.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {runs.slice(0, 6).map((run) => {
                        const active = run.runId === selectedRunId;
                        return (
                            <button
                                key={run.runId}
                                type="button"
                                onClick={() => onSelectRun?.(run.runId)}
                                className={`rounded-xl px-3 py-2 text-left transition-all duration-150 ${active
                                    ? 'bg-brand-600 text-white shadow-sm'
                                    : 'border border-surface-200 bg-white text-surface-700 hover:border-brand-200 hover:bg-brand-50'
                                    }`}
                            >
                                <p className="text-[11px] font-bold uppercase tracking-[0.14em]">{run.ticketId}</p>
                                <p className={`mt-1 text-[10px] ${active ? 'text-white/80' : 'text-surface-500'}`}>{run.runId.slice(0, 8)}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {!selectedRunId ? (
                <div className="mt-6 rounded-2xl border border-dashed border-surface-300 bg-white/70 p-5 text-sm text-surface-500">
                    No run is selected yet. Launch a pipeline or choose a recent run to inspect mission evidence.
                </div>
            ) : loading ? (
                <div className="mt-6 rounded-2xl border border-surface-200 bg-white/80 p-5 text-sm text-surface-500">
                    Loading mission evidence summary for {selectedRunId}...
                </div>
            ) : error ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/80 p-5 text-sm text-red-700">
                    {error}
                </div>
            ) : !summary ? (
                <div className="mt-6 rounded-2xl border border-dashed border-surface-300 bg-white/70 p-5 text-sm text-surface-500">
                    Evidence summary is not available for this run yet.
                </div>
            ) : (
                <div className="mt-6 space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard
                            label="Mission State"
                            value={formatLabel(summary.status)}
                            detail={`${summary.mission?.scenarioCount || 0} scenario branches`}
                            Icon={SparkleIcon}
                            accent="bg-brand-50 text-brand-600"
                        />
                        <StatCard
                            label="Artifacts"
                            value={formatCount(summary.summary?.totalArtifacts)}
                            detail={`${formatCount(summary.summary?.screenshots)} screenshots, ${formatCount(summary.summary?.videos)} videos`}
                            Icon={DocumentIcon}
                            accent="bg-sky-50 text-sky-600"
                        />
                        <StatCard
                            label="Observations"
                            value={formatCount(summary.summary?.observations)}
                            detail={`${formatCount(summary.mission?.failedScenarios)} failing branches detected`}
                            Icon={ExclamationIcon}
                            accent="bg-amber-50 text-amber-600"
                        />
                        <StatCard
                            label="Test Results"
                            value={formatCount(summary.summary?.passedTests)}
                            detail={`${formatCount(summary.summary?.failedTests)} failed tests`}
                            Icon={ClockIcon}
                            accent="bg-emerald-50 text-emerald-600"
                        />
                    </div>

                    <div className="rounded-[26px] border border-surface-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] p-5 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                            <div>
                                <p className="type-meta-label">Mission Overview</p>
                                <h3 className="mt-1 text-[1.4rem] font-semibold tracking-[-0.03em] text-surface-900">{summary.ticketId}</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <div>
                                    <p className="type-meta-label">Run ID</p>
                                    <p className="mt-1 text-sm font-medium text-surface-700">{summary.runId.slice(0, 12)}</p>
                                </div>
                                <div>
                                    <p className="type-meta-label">Started</p>
                                    <p className="mt-1 text-sm font-medium text-surface-700">{formatDate(summary.startedAt)}</p>
                                </div>
                                <div>
                                    <p className="type-meta-label">Completed</p>
                                    <p className="mt-1 text-sm font-medium text-surface-700">{formatDate(summary.completedAt)}</p>
                                </div>
                                <div>
                                    <p className="type-meta-label">Branch Outcome</p>
                                    <p className="mt-1 text-sm font-medium text-surface-700">{formatCount(summary.mission?.passedScenarios)} passed / {formatCount(summary.mission?.failedScenarios)} failed</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                        <ScenarioPanel title="Authenticated Evidence" Icon={UserIcon} scenario={authenticatedScenario} />
                        <ScenarioPanel title="Unauthenticated Evidence" Icon={GlobeIcon} scenario={unauthenticatedScenario} />
                    </div>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-[26px] border border-surface-200/80 bg-white/92 p-5 shadow-sm">
                            <p className="type-meta-label">Latest Mission Observations</p>
                            {(summary.latestObservations || []).length === 0 ? (
                                <p className="mt-3 text-sm text-surface-500">No mission-level observations were recorded.</p>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {summary.latestObservations.slice(0, 6).map((observation) => (
                                        <div key={observation.id || `${observation.timestamp}-${observation.message}`} className="rounded-2xl border border-surface-200/70 bg-surface-50 px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-surface-500">
                                                <span>{formatLabel(observation.severity)}</span>
                                                <span>{formatLabel(observation.type)}</span>
                                                {observation.scenarioId ? <span>{formatLabel(observation.scenarioId)}</span> : null}
                                            </div>
                                            <p className="mt-2 text-sm font-medium text-surface-700">{observation.message || 'Observation recorded'}</p>
                                            <p className="mt-1 text-xs text-surface-400">{formatDate(observation.timestamp)}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="rounded-[26px] border border-surface-200/80 bg-white/92 p-5 shadow-sm">
                            <p className="type-meta-label">Evidence Files</p>
                            {(summary.downloads || []).length === 0 ? (
                                <p className="mt-3 text-sm text-surface-500">No mission evidence files are available yet.</p>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {summary.downloads.slice(0, 8).map((artifact) => (
                                        <ArtifactCard
                                            key={artifact.path}
                                            artifact={artifact}
                                            copiedArtifactKey={copiedArtifactKey}
                                            onCopyPath={handleCopyPath}
                                            onOpenArtifact={handleOpenArtifact}
                                            onRevealArtifact={handleRevealArtifact}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}