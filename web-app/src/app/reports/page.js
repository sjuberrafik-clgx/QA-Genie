'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/lib/api-client';
import { useSSE } from '@/hooks/useSSE';
import ConsolidatedReport from '@/components/ConsolidatedReport';
import ThemeToggle from '@/components/ThemeToggle';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import RefreshButton from '@/components/RefreshButton';
import { BarChartIcon } from '@/components/Icons';

/* ─── Time-window filter presets ─── */
const TIME_FILTERS = [
    { value: 'latest', label: 'Latest Run' },
    { value: '1h', label: 'Last 1 Hour' },
    { value: '24h', label: 'Last 24 Hours' },
    { value: 'all', label: 'All Time' },
];

function getSinceTimestamp(filterValue) {
    if (filterValue === 'all') return null;
    if (filterValue === 'latest') return '__latest__';  // sentinel handled by ConsolidatedReport
    const now = Date.now();
    if (filterValue === '1h') return new Date(now - 60 * 60 * 1000).toISOString();
    if (filterValue === '24h') return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    return null;
}

export default function ReportsPage() {
    const [reportCount, setReportCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [timeFilter, setTimeFilter] = useState('latest');
    const pollTimerRef = useRef(null);

    const fetchCount = useCallback(async () => {
        try {
            const data = await apiClient.listReports();
            setReportCount(Array.isArray(data) ? data.length : 0);
            setError(null);
        } catch {
            setError('Failed to load report count');
        }
    }, []);

    useEffect(() => { fetchCount(); }, [fetchCount]);

    const handleRefresh = useCallback(() => {
        setLoading(true);
        setRefreshKey(k => k + 1);
        fetchCount().finally(() => setLoading(false));
    }, [fetchCount]);

    // ─── SSE: Real-time report updates ──────────────────────────
    // Subscribe to the global event stream. When a 'report_saved' event
    // arrives (emitted by execute_test or pipeline-runner after saving a
    // report), auto-refresh the report list and consolidated view.
    const { status: sseStatus } = useSSE(apiClient.getGlobalStreamUrl(), {
        onEvent: useCallback((eventType, _data) => {
            if (eventType === 'report_saved') {
                handleRefresh();
            }
        }, [handleRefresh]),
    });

    // ─── Polling fallback: refresh every 30s if SSE is disconnected ──
    useEffect(() => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }

        if (sseStatus !== 'connected') {
            pollTimerRef.current = setInterval(() => {
                fetchCount();
                setRefreshKey(k => k + 1);
            }, 30000);
        }

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [sseStatus, fetchCount]);

    return (
        <div id="report-container" className="rpt-page-bg min-h-screen">
            <div className="p-6 max-w-[960px] mx-auto space-y-5">
                {/* ─── Header ─── */}
                <PageHeader
                    title="Test Reports"
                    subtitle={`${reportCount} execution ${reportCount === 1 ? 'report' : 'reports'}`}
                    Icon={BarChartIcon}
                    actions={
                        <>
                            <ThemeToggle containerId="report-container" />
                            <select
                                value={timeFilter}
                                onChange={(e) => { setTimeFilter(e.target.value); setRefreshKey(k => k + 1); }}
                                className="px-3 py-2 text-xs font-semibold bg-white/20 text-white rounded-xl border-none outline-none cursor-pointer appearance-none hover:bg-white/30 transition-colors"
                                style={{ backgroundImage: 'none' }}
                                aria-label="Filter reports by time range"
                            >
                                {TIME_FILTERS.map(f => (
                                    <option key={f.value} value={f.value} className="text-surface-900 bg-white">{f.label}</option>
                                ))}
                            </select>
                            <RefreshButton onClick={handleRefresh} loading={loading} />
                        </>
                    }
                />

                <ErrorBanner error={error} onDismiss={() => setError(null)} />
                {/* ─── Allure-style Consolidated Report ─── */}
                <ConsolidatedReport key={refreshKey} since={getSinceTimestamp(timeFilter)} />
            </div>
        </div>
    );
}
