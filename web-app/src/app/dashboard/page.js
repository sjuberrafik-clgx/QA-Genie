'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePipeline } from '@/hooks/usePipeline';
import useModelCatalog from '@/hooks/useModelCatalog';
import StageProgress from '@/components/StageProgress';
import PipelineCard from '@/components/PipelineCard';
import ModelSelect from '@/components/ModelSelect';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import CognitiveInsights from '@/components/CognitiveInsights';
import apiClient from '@/lib/api-client';
import { getDefaultModel, hasModelValue } from '@/lib/model-options';
import { ClockIcon, RetryIcon, DashboardIcon } from '@/components/Icons';
import RefreshButton from '@/components/RefreshButton';
import RobotMascotLogo from '@/components/RobotMascotLogo';

export default function DashboardPage() {
    const {
        runs, activeRunId, stages, loading, error, networkWarning,
        cognitiveInsights, sseStatus, retryCount, startPipeline, cancelPipeline, refreshRuns, setError,
    } = usePipeline();

    const {
        groups: modelGroups,
        defaultModel,
        source: modelCatalogSource,
        warnings: modelCatalogWarnings,
        error: modelCatalogError,
        loading: modelCatalogLoading,
    } = useModelCatalog();

    const [ticketId, setTicketId] = useState('');
    const [mode, setMode] = useState('full');
    const [environment, setEnvironment] = useState('UAT');
    const [model, setModelState] = useState('');
    const [modelTouched, setModelTouched] = useState(false);
    const [backendStatus, setBackendStatus] = useState(null);

    const setModel = useCallback((nextModel) => {
        setModelTouched(true);
        setModelState(nextModel);
    }, []);

    useEffect(() => {
        apiClient.ready()
            .then(data => setBackendStatus(data))
            .catch(() => setBackendStatus({ ready: false, error: 'Cannot reach backend' }));
        refreshRuns();
    }, [refreshRuns]);

    useEffect(() => {
        if (!modelTouched && defaultModel && model !== defaultModel) {
            setModelState(defaultModel);
        }
    }, [defaultModel, model, modelTouched]);

    useEffect(() => {
        if (model && !hasModelValue(model, modelGroups)) {
            setModelState(getDefaultModel(modelGroups, defaultModel));
        }
    }, [defaultModel, model, modelGroups]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!ticketId.trim()) return;
        try {
            await startPipeline(ticketId.trim(), mode, environment, model);
            setTicketId('');
        } catch { /* error handled by hook */ }
    };

    const handleForceCancel = useCallback(async (runId, ticket) => {
        try {
            await apiClient.forceCancelPipeline(runId, `Force cancelled by user (${ticket})`);
            await refreshRuns();
        } catch (err) {
            setError(`Force cancel failed: ${err.message}`);
        }
    }, [refreshRuns, setError]);

    return (
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
            {/* Hero Header */}
            <PageHeader
                title="Pipeline Dashboard"
                subtitle="Trigger and monitor QA automation pipelines"
                Icon={DashboardIcon}
                showGridBg
                actions={<StatusBadge status={backendStatus} sseStatus={sseStatus} retryCount={retryCount} activeRunId={activeRunId} />}
            />

            <div className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-[radial-gradient(circle_at_12%_18%,rgba(15,118,110,0.1),transparent_28%),radial-gradient(circle_at_84%_18%,rgba(37,99,235,0.12),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] px-6 py-7 shadow-[0_22px_60px_rgba(15,23,42,0.08)] sm:px-7">
                <div className="absolute right-8 top-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.14),rgba(15,118,110,0.08),transparent_72%)] blur-3xl" />
                <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-[38rem]">
                        <div className="type-kicker inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/85 px-3 py-1.5 text-brand-700 shadow-sm">
                            <span className="inline-block h-2 w-2 rounded-full bg-gradient-to-r from-teal-500 to-blue-500" />
                            Operations workspace
                        </div>
                        <h2 className="type-section-title mt-4 max-w-2xl text-[2rem] sm:text-[2.2rem]">Run, monitor, and recover QA workflows from one focused control surface.</h2>
                        <p className="mt-3 max-w-xl text-[15px] font-medium leading-8 tracking-[-0.012em] text-surface-500">
                            The dashboard keeps the same visual system as the rest of the product while staying operationally focused for launches, monitoring, and recovery.
                        </p>
                        <div className="mt-6 flex flex-wrap gap-3">
                            <div className="min-w-[220px] rounded-2xl border border-surface-200/80 bg-white/88 px-4 py-3.5 shadow-sm">
                                <p className="type-meta-label">Pipeline state</p>
                                <p className="type-metric-value mt-1.5">{activeRunId ? 'Active execution in progress' : 'Ready for a new run'}</p>
                            </div>
                            <div className="min-w-[220px] rounded-2xl border border-surface-200/80 bg-white/88 px-4 py-3.5 shadow-sm">
                                <p className="type-meta-label">Backend reachability</p>
                                <p className="type-metric-value mt-1.5">{backendStatus?.ready ? 'Connected and responsive' : 'Waiting on backend readiness'}</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center lg:justify-end">
                        <div className="relative rounded-[34px] border border-surface-200/70 bg-[radial-gradient(circle_at_24%_18%,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_74%_74%,rgba(15,118,110,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] px-7 py-6 shadow-[0_24px_60px_rgba(15,23,42,0.1)]">
                            <div className="absolute inset-x-8 bottom-3 h-6 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.16),rgba(15,118,110,0.08),transparent_72%)] blur-2xl" />
                            <RobotMascotLogo size={156} emphasis="hero" mood="glossy" className="relative z-[1]" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-5">
                {/* Error Banner */}
                <ErrorBanner error={error} onDismiss={() => setError(null)} />

                {/* Network Warning (auto-dismiss) */}
                {networkWarning && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-700 px-5 py-3 rounded-xl flex items-center gap-3 text-sm">
                        <RetryIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span>{networkWarning}</span>
                    </div>
                )}

                {/* Launch Pipeline Card */}
                <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center gap-2.5 mb-4">
                        <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                            </svg>
                        </div>
                        <h2 className="type-card-title text-[1.02rem]">Launch Pipeline</h2>
                    </div>
                    <form onSubmit={handleSubmit} autoComplete="off" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                        <div className="sm:col-span-2 lg:col-span-1">
                            <label htmlFor="ticketId" className="type-meta-label block mb-1.5 text-surface-500">Ticket ID</label>
                            <input
                                id="ticketId"
                                type="text"
                                value={ticketId}
                                onChange={(e) => setTicketId(e.target.value)}
                                placeholder="e.g., AOTF-16339"
                                autoComplete="off"
                                suppressHydrationWarning
                                className="w-full px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-all duration-200 placeholder:text-surface-400"
                            />
                        </div>
                        <div>
                            <label className="type-meta-label block mb-1.5 text-surface-500">Mode</label>
                            <select value={mode} onChange={(e) => setMode(e.target.value)}
                                suppressHydrationWarning
                                aria-label="Pipeline mode"
                                className="custom-select w-full">
                                <option value="full">Full Pipeline</option>
                                <option value="testcase">Generate Test Case Only</option>
                                <option value="generate">Generate Script + Execute</option>
                                <option value="execute">Execute Existing Script</option>
                                <option value="heal">Repair Script</option>
                            </select>
                        </div>
                        <div>
                            <label className="type-meta-label block mb-1.5 text-surface-500">Environment</label>
                            <select value={environment} onChange={(e) => setEnvironment(e.target.value)}
                                suppressHydrationWarning
                                aria-label="Pipeline environment"
                                className="custom-select w-full">
                                <option value="UAT">UAT</option>
                                <option value="INT">INT</option>
                                <option value="PROD">PROD</option>
                            </select>
                        </div>
                        <div>
                            <label className="type-meta-label block mb-1.5 text-surface-500">AI Model</label>
                            <ModelSelect value={model} onChange={setModel} groups={modelGroups} loading={modelCatalogLoading} />
                            <p className={`mt-1 text-[11px] ${modelCatalogError ? 'text-red-500' : modelCatalogSource === 'sdk-discovered' ? 'text-surface-400' : 'text-amber-600'}`}>
                                {modelCatalogError
                                    ? `Model catalog fallback: ${modelCatalogError}`
                                    : modelCatalogSource === 'sdk-discovered'
                                        ? 'Using runtime SDK model catalog'
                                        : (modelCatalogWarnings[0] || 'Using fallback model catalog')}
                            </p>
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !ticketId.trim() || !backendStatus?.ready || !model}
                            className="px-6 py-2.5 gradient-brand text-white rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors sm:col-span-2 lg:col-span-1"
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                    Starting...
                                </span>
                            ) : 'Run Pipeline'}
                        </button>
                    </form>
                </div>

                {/* Active Run Progress */}
                {activeRunId && (
                    <div className="glass-card rounded-2xl p-6 border-brand-200/40">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-brand-500" />
                                <h2 className="type-card-title text-[1.02rem]">Active Run</h2>
                                <span className="px-2.5 py-0.5 bg-brand-50 text-brand-700 rounded-lg text-xs font-mono">
                                    {activeRunId}
                                </span>
                            </div>
                            <button onClick={() => cancelPipeline(activeRunId)}
                                className="px-4 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-xl hover:bg-red-100 hover:shadow-sm transition-all duration-200">
                                Cancel
                            </button>
                        </div>
                        <StageProgress stages={stages} />
                    </div>
                )}

                {/* Cognitive Insights (shown during/after pipeline runs with cognitive data) */}
                {cognitiveInsights && cognitiveInsights.tier && (
                    <CognitiveInsights insights={cognitiveInsights} />
                )}

                {/* Recent Runs */}
                <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center">
                                <ClockIcon className="w-4 h-4 text-surface-500" />
                            </div>
                            <h2 className="type-card-title text-[1.02rem]">Recent Runs</h2>
                        </div>
                        <RefreshButton onClick={() => refreshRuns()} variant="card" />
                    </div>
                    {runs.length === 0 ? (
                        <div className="py-12 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-[24px] bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.14),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(31,158,171,0.16),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] flex items-center justify-center border border-surface-100 shadow-sm">
                                <RobotMascotLogo size={40} mood="minimal" />
                            </div>
                            <p className="text-sm font-semibold tracking-[-0.015em] text-surface-500">No pipeline runs yet</p>
                            <p className="text-xs text-surface-400 mt-1">Launch one above to get started</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {runs.slice(0, 10).map((run) => (
                                <div key={run.runId}>
                                    <PipelineCard run={run} onForceCancel={handleForceCancel} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status, sseStatus, retryCount, activeRunId }) {
    const ready = status?.ready;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <div className={`page-header-panel flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.68rem] font-semibold ${ready
                ? 'text-white'
                : 'text-red-300'
                }`}>
                <span className={`status-dot ${ready ? 'status-dot-online' : 'status-dot-offline'}`} />
                {ready ? 'System Ready' : 'Offline'}
            </div>
            {sseStatus === 'reconnecting' && (
                <div className="page-header-panel flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.68rem] font-semibold text-amber-300">
                    <span className="status-dot status-dot-connecting" />
                    Reconnecting ({retryCount}/10)
                </div>
            )}
            {sseStatus === 'connected' && activeRunId && (
                <div className="page-header-panel flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.68rem] font-semibold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                    Live Feed
                </div>
            )}
        </div>
    );
}
