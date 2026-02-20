'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePipeline } from '@/hooks/usePipeline';
import StageProgress from '@/components/StageProgress';
import PipelineCard from '@/components/PipelineCard';
import ModelSelect from '@/components/ModelSelect';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import apiClient from '@/lib/api-client';
import { ClockIcon, RetryIcon, DashboardIcon } from '@/components/Icons';
import RefreshButton from '@/components/RefreshButton';

export default function DashboardPage() {
    const {
        runs, activeRunId, stages, loading, error, networkWarning,
        sseStatus, retryCount, startPipeline, cancelPipeline, refreshRuns, setError,
    } = usePipeline();

    const [ticketId, setTicketId] = useState('');
    const [mode, setMode] = useState('full');
    const [environment, setEnvironment] = useState('UAT');
    const [model, setModel] = useState('gpt-4o');
    const [backendStatus, setBackendStatus] = useState(null);

    useEffect(() => {
        apiClient.ready()
            .then(data => setBackendStatus(data))
            .catch(() => setBackendStatus({ ready: false, error: 'Cannot reach backend' }));
        refreshRuns();
    }, [refreshRuns]);

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
        <div className="p-6 max-w-5xl mx-auto space-y-5">
            {/* Hero Header */}
            <PageHeader
                title="Pipeline Dashboard"
                subtitle="Trigger and monitor QA automation pipelines"
                Icon={DashboardIcon}
                showGridBg
                actions={<StatusBadge status={backendStatus} sseStatus={sseStatus} retryCount={retryCount} activeRunId={activeRunId} />}
            />

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
                        <h2 className="text-base font-semibold text-surface-900">Launch Pipeline</h2>
                    </div>
                    <form onSubmit={handleSubmit} autoComplete="off" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                        <div className="sm:col-span-2 lg:col-span-1">
                            <label htmlFor="ticketId" className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-wider">Ticket ID</label>
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
                            <label className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-wider">Mode</label>
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
                            <label className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-wider">Environment</label>
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
                            <label className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-wider">AI Model</label>
                            <ModelSelect value={model} onChange={setModel} />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !ticketId.trim() || !backendStatus?.ready}
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
                                <h2 className="text-base font-semibold text-surface-900">Active Run</h2>
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

                {/* Recent Runs */}
                <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center">
                                <ClockIcon className="w-4 h-4 text-surface-500" />
                            </div>
                            <h2 className="text-base font-semibold text-surface-900">Recent Runs</h2>
                        </div>
                        <RefreshButton onClick={() => refreshRuns()} variant="card" />
                    </div>
                    {runs.length === 0 ? (
                        <div className="py-12 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
                                <svg className="w-8 h-8 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                                </svg>
                            </div>
                            <p className="text-sm font-medium text-surface-500">No pipeline runs yet</p>
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
        <div className="flex items-center gap-2.5">
            <div className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border ${ready
                ? 'bg-accent-50 text-accent-600 border-accent-200'
                : 'bg-red-50 text-red-600 border-red-200'
                }`}>
                <span className={`status-dot ${ready ? 'status-dot-online' : 'status-dot-offline'}`} />
                {ready ? 'System Ready' : 'Offline'}
            </div>
            {sseStatus === 'reconnecting' && (
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                    <span className="status-dot status-dot-connecting" />
                    Reconnecting ({retryCount}/10)
                </div>
            )}
            {sseStatus === 'connected' && activeRunId && (
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-50 text-brand-600 border border-brand-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                    Live
                </div>
            )}
        </div>
    );
}
