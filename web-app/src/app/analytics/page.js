'use client';

import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api-client';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import Spinner from '@/components/Spinner';
import { WarningTriangleIcon, BarChartIcon } from '@/components/Icons';
import RefreshButton from '@/components/RefreshButton';

function StatCard({ label, value, sub, color = 'text-surface-900', iconPath, Icon }) {
    return (
        <div className="glass-card rounded-xl border border-surface-200/60 p-4 hover-lift transition-all">
            <div className="flex items-center gap-3">
                {(Icon || iconPath) && (
                    <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                        {Icon ? (
                            <Icon className="w-4.5 h-4.5 text-brand-500" />
                        ) : (
                            <svg className="w-4.5 h-4.5 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                            </svg>
                        )}
                    </div>
                )}
                <div>
                    <div className={`text-2xl font-bold ${color}`}>{value ?? '—'}</div>
                    <div className="text-[11px] text-surface-500 font-medium mt-0.5">{label}</div>
                    {sub && <div className="text-[10px] text-surface-400 mt-0.5">{sub}</div>}
                </div>
            </div>
        </div>
    );
}

function BarChart({ data, labelKey, valueKey, title }) {
    if (!data || data.length === 0) return null;
    const max = Math.max(...data.map(d => d[valueKey]), 1);
    return (
        <div className="glass-card rounded-xl border border-surface-200/60 p-5">
            <h3 className="text-sm font-bold text-surface-800 mb-4">{title}</h3>
            <div className="space-y-2.5">
                {data.slice(0, 10).map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                        <span className="text-xs text-surface-600 w-24 truncate font-medium" title={item[labelKey]}>
                            {item[labelKey]}
                        </span>
                        <div className="flex-1 bg-surface-100 rounded-full h-5 overflow-hidden">
                            <div
                                className="gradient-brand h-full rounded-full"
                                style={{ width: `${(item[valueKey] / max) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs font-bold text-surface-700 w-8 text-right">{item[valueKey]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function AnalyticsPage() {
    const [overview, setOverview] = useState(null);
    const [failures, setFailures] = useState([]);
    const [selectors, setSelectors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [ov, fl, sl] = await Promise.allSettled([
                apiClient.getAnalyticsOverview(),
                apiClient.getFailureTrends(),
                apiClient.getSelectorData(),
            ]);
            if (ov.status === 'fulfilled') setOverview(ov.value);
            if (fl.status === 'fulfilled') setFailures(Array.isArray(fl.value) ? fl.value : fl.value?.trends || []);
            if (sl.status === 'fulfilled') setSelectors(Array.isArray(sl.value) ? sl.value : sl.value?.selectors || []);

            // If all three calls rejected, show error
            const allRejected = [ov, fl, sl].every(r => r.status === 'rejected');
            setError(allRejected ? 'Failed to load analytics data' : null);
        } catch (err) {
            setError(`Failed to load analytics: ${err.message}`);
        }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <Spinner label="Loading analytics..." />
            </div>
        );
    }

    const ov = overview || {};

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <PageHeader
                title="Analytics"
                subtitle="Pipeline performance insights"
                Icon={BarChartIcon}
                actions={
                    <RefreshButton onClick={fetchAll} />
                }
            />

            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total Runs" value={ov.totalRuns ?? 0} iconPath="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                <StatCard label="Pass Rate" value={ov.passRate != null ? `${(ov.passRate * 100).toFixed(0)}%` : '—'} color="text-accent-600" iconPath="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                <StatCard label="Avg Duration" value={ov.avgDuration != null ? `${(ov.avgDuration / 1000).toFixed(1)}s` : '—'} iconPath="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                <StatCard label="Active Today" value={ov.runsToday ?? 0} color="text-brand-600" iconPath="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Failure trends */}
                <BarChart
                    data={failures}
                    labelKey="stage"
                    valueKey="count"
                    title="Failure Trends by Stage"
                />

                {/* Selector stability */}
                <BarChart
                    data={selectors}
                    labelKey="selector"
                    valueKey="stability"
                    title="Selector Stability (%)"
                />
            </div>

            {/* Recent failures table */}
            {ov.recentFailures && ov.recentFailures.length > 0 && (
                <div className="glass-card rounded-xl border border-surface-200/60 p-5">
                    <h3 className="text-sm font-bold text-surface-800 mb-4 flex items-center gap-2">
                        <WarningTriangleIcon className="w-4 h-4 text-red-400" />
                        Recent Failures
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-surface-200/60 text-surface-500">
                                    <th className="text-left py-2.5 pr-3 font-bold uppercase tracking-wider text-[10px]">Run ID</th>
                                    <th className="text-left py-2.5 pr-3 font-bold uppercase tracking-wider text-[10px]">Ticket</th>
                                    <th className="text-left py-2.5 pr-3 font-bold uppercase tracking-wider text-[10px]">Stage</th>
                                    <th className="text-left py-2.5 font-bold uppercase tracking-wider text-[10px]">Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ov.recentFailures.slice(0, 10).map((f, i) => (
                                    <tr key={i} className="border-b border-surface-100/60 hover:bg-surface-50 transition-colors">
                                        <td className="py-2 pr-3 font-mono text-surface-600">{f.runId?.substring(0, 8)}</td>
                                        <td className="py-2 pr-3 font-medium">{f.ticketId}</td>
                                        <td className="py-2 pr-3 capitalize">{f.stage}</td>
                                        <td className="py-2 text-red-500 truncate max-w-xs">{f.error}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!overview && failures.length === 0 && selectors.length === 0 && (
                <div className="text-center py-16">
                    <BarChartIcon className="w-10 h-10 mx-auto text-surface-300 mb-3" strokeWidth={1} />
                    <p className="text-sm text-surface-500">No analytics data available yet. Run some pipelines first.</p>
                </div>
            )}
        </div>
    );
}
