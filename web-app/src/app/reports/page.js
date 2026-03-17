'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/lib/api-client';
import { useSSE } from '@/hooks/useSSE';
import ConsolidatedReport from '@/components/ConsolidatedReport';
import ThemeToggle from '@/components/ThemeToggle';
import AllureNavBar from '@/components/AllureNavBar';
import ErrorBanner from '@/components/ErrorBanner';

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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [timeFilter, setTimeFilter] = useState('latest');
    const pollTimerRef = useRef(null);

    const handleRefresh = useCallback(() => {
        setLoading(true);
        setRefreshKey(k => k + 1);
        setTimeout(() => setLoading(false), 600);
    }, []);

    // ─── SSE: Real-time report updates ──────────────────────────
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
                setRefreshKey(k => k + 1);
            }, 30000);
        }

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [sseStatus]);

    return (
        <div id="report-container" data-theme="dark" className="allure-page-bg min-h-screen">
            {/* ─── Allure Top Nav Bar ─── */}
            <AllureNavBar
                timeFilter={timeFilter}
                onTimeFilterChange={(v) => { setTimeFilter(v); setRefreshKey(k => k + 1); }}
                onRefresh={handleRefresh}
                refreshLoading={loading}
                themeToggle={<ThemeToggle containerId="report-container" />}
                timeFilters={TIME_FILTERS}
            />

            <div className="mx-auto max-w-5xl space-y-0 px-6 py-6">
                <ErrorBanner error={error} onDismiss={() => setError(null)} />
                <ConsolidatedReport key={refreshKey} since={getSinceTimestamp(timeFilter)} />
            </div>
        </div>
    );
}
