'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api-client';
import PipelineCard from '@/components/PipelineCard';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import Spinner from '@/components/Spinner';
import RefreshButton from '@/components/RefreshButton';

const MODES = ['all', 'full', 'test-only', 'script-only'];
const STATUSES = ['all', 'completed', 'failed', 'running', 'cancelled'];

export default function ResultsPage() {
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filterMode, setFilterMode] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [expandedRunId, setExpandedRunId] = useState(null);

    const fetchRuns = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.listRuns();
            setRuns(Array.isArray(data) ? data : data?.runs || []);
            setError(null);
        } catch (err) {
            setError('Failed to load pipeline runs');
            setRuns([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchRuns(); }, [fetchRuns]);

    const filtered = useMemo(() => runs.filter((r) => {
        if (filterMode !== 'all' && r.mode !== filterMode) return false;
        if (filterStatus !== 'all' && r.status !== filterStatus) return false;
        return true;
    }), [runs, filterMode, filterStatus]);

    const stats = useMemo(() => ({
        total: runs.length,
        completed: runs.filter(r => r.status === 'completed').length,
        failed: runs.filter(r => r.status === 'failed').length,
        running: runs.filter(r => r.status === 'running').length,
    }), [runs]);

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <PageHeader
                title="Pipeline Results"
                subtitle={`${runs.length} total runs`}
                iconPath="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
                actions={
                    <RefreshButton onClick={fetchRuns} loading={loading} />
                }
            />

            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Total Runs', value: stats.total, icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z', border: 'border-brand-200', text: 'text-brand-600', bg: 'bg-brand-50', iconColor: 'text-brand-400' },
                    { label: 'Completed', value: stats.completed, icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', border: 'border-accent-200', text: 'text-accent-600', bg: 'bg-accent-50', iconColor: 'text-accent-400' },
                    { label: 'Failed', value: stats.failed, icon: 'M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z', border: 'border-red-200', text: 'text-red-600', bg: 'bg-red-50', iconColor: 'text-red-400' },
                    { label: 'Running', value: stats.running, icon: 'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z', border: 'border-blue-200', text: 'text-blue-600', bg: 'bg-blue-50', iconColor: 'text-blue-400' },
                ].map(({ label, value, icon, border, text, bg, iconColor }) => (
                    <div key={label} className={`glass-card rounded-xl p-4 border ${border} ${bg}`}>
                        <div className="flex items-center gap-3">
                            <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                            </svg>
                            <div>
                                <div className={`text-2xl font-bold ${text}`}>{value}</div>
                                <div className="text-[11px] text-surface-500 font-medium">{label}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="glass-card rounded-xl p-4 border border-surface-200/60 flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-surface-500 uppercase tracking-wider">Mode:</span>
                    <div className="flex gap-1">
                        {MODES.map(m => (
                            <button key={m} onClick={() => setFilterMode(m)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${filterMode === m ? 'gradient-brand text-white shadow-sm' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>
                                {m === 'all' ? 'All' : m}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="w-px h-6 bg-surface-200 hidden sm:block" />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-surface-500 uppercase tracking-wider">Status:</span>
                    <div className="flex gap-1">
                        {STATUSES.map(s => (
                            <button key={s} onClick={() => setFilterStatus(s)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${filterStatus === s ? 'gradient-brand text-white shadow-sm' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>
                                {s === 'all' ? 'All' : s}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Run list */}
            {loading ? (
                <Spinner label="Loading runs..." />
            ) : filtered.length === 0 ? (
                <div className="text-center py-16">
                    <svg className="w-10 h-10 mx-auto text-surface-300 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                    </svg>
                    <p className="text-sm text-surface-500">
                        {runs.length === 0 ? 'No pipeline runs yet. Start one from the Dashboard.' : 'No runs match the current filters.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map((run) => (
                        <div key={run.runId}>
                            <div className="cursor-pointer" role="button" tabIndex={0}
                                onClick={() => setExpandedRunId(expandedRunId === run.runId ? null : run.runId)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedRunId(expandedRunId === run.runId ? null : run.runId); }}>
                                <PipelineCard run={run} />
                            </div>
                            {expandedRunId === run.runId && run.stages && (
                                <div className="ml-4 mt-2 border-l-2 border-brand-200 pl-4 pb-2 space-y-2">
                                    {Object.entries(run.stages).map(([name, stage]) => (
                                        <div key={name} className="flex items-center gap-2.5 text-xs">
                                            <span className={`w-2.5 h-2.5 rounded-full ring-2 ring-offset-1 ${stage.status === 'passed' ? 'bg-accent-500 ring-accent-200' : stage.status === 'failed' ? 'bg-red-500 ring-red-200' : stage.status === 'running' ? 'bg-brand-500 ring-brand-200' : 'bg-surface-300 ring-surface-200'}`} />
                                            <span className="font-semibold text-surface-700 capitalize">{name}</span>
                                            {stage.duration && <span className="text-surface-400 text-[11px]">{(stage.duration / 1000).toFixed(1)}s</span>}
                                            {stage.error && <span className="text-red-500 truncate max-w-xs text-[11px]">{stage.error}</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
