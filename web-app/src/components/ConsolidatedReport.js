'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api-client';
import DonutChart from './DonutChart';
import { sortSpecs, sortSuites, SORT_OPTIONS } from './SortDropdown';
import { countAllSpecs, filterSuiteTree } from '@/lib/report-utils';
import { ChevronRightIcon, SearchIcon, RetryIcon, LightningIcon, BarChartIcon, ShieldCheckIcon, PaperclipIcon, EmptyDocumentIcon } from './Icons';

/**
 * ConsolidatedReport — Allure-style consolidated view.
 * Layout: Header+Donut → Tabs → Stats → Search → Retry/Flaky → Pills+Sort → Suites
 */

/* ──────────────────────── Suite Row ──────────────────────── */
function SuiteRow({ suite, depth = 0, sortMode }) {
    const [open, setOpen] = useState(false);
    const totalCount = countAllSpecs(suite);
    const hasContent = (suite.specs?.length || 0) > 0 || (suite.suites || []).length > 0;
    if (!hasContent) return null;

    const sortedSpecs = sortSpecs(suite.specs || [], sortMode);
    const sortedSubs = sortSuites(suite.suites || [], sortMode);

    return (
        <div className={depth === 0 ? 'rpt-suite-row' : 'ml-5 mt-0.5'}>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2.5 w-full text-left py-3 px-4 rpt-suite-btn rounded-lg transition-colors"
            >
                <ChevronRightIcon className={`w-3 h-3 rpt-text-muted transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
                <span className="text-[13px] font-medium rpt-text-primary flex-1 truncate">
                    {suite.title || 'Root Suite'}
                </span>
                <span className="rpt-count-badge">{totalCount}</span>
            </button>

            {open && (
                <div className="ml-3 mt-0.5">
                    {sortedSpecs.map((spec, i) => (
                        <SpecItem key={`${spec.title}-${i}`} spec={spec} index={i + 1} />
                    ))}
                    {sortedSubs.map((sub, i) => (
                        <SuiteRow key={`${sub.title}-${i}`} suite={sub} depth={depth + 1} sortMode={sortMode} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* ──────────────────────── Spec Item ──────────────────────── */
function SpecItem({ spec, index }) {
    const [showError, setShowError] = useState(false);
    const isFailed = spec.status === 'failed' || spec.status === 'unexpected';
    const isBroken = spec.isBroken || spec.status === 'broken';
    const isPassed = spec.status === 'passed' || spec.status === 'expected';
    const isSkipped = spec.status === 'skipped';
    const durationMs = spec.duration || 0;
    const durationStr = durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : durationMs >= 1000
            ? `${(durationMs / 1000).toFixed(0)}s ${durationMs % 1000}ms`
            : `${durationMs}ms`;

    const dotColor = isBroken ? 'bg-orange-500' : isFailed ? 'bg-red-500' : isPassed ? 'bg-accent-500' : isSkipped ? 'bg-amber-400' : 'bg-surface-400';

    return (
        <div className="rpt-spec-item">
            <div className="flex items-center gap-2.5 py-2 px-4">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <span className="text-[11px] rpt-text-muted font-mono w-5 text-right flex-shrink-0">{index}</span>
                <span className={`text-[13px] font-normal flex-1 ${isFailed ? 'text-red-500' : isBroken ? 'text-orange-500' : 'rpt-text-primary'}`}>
                    {spec.title}
                </span>
                {spec.isFlaky && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-purple-100 text-purple-700 flex-shrink-0">Flaky</span>
                )}
                {spec.retries > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-700 flex-shrink-0">{spec.retries}x</span>
                )}
                <span className="text-[11px] rpt-text-muted font-mono flex-shrink-0 min-w-[70px] text-right">{durationStr}</span>
            </div>
            {(isFailed || isBroken) && spec.error && (
                <div className="ml-[52px] mb-1">
                    <button
                        onClick={() => setShowError(!showError)}
                        className={`text-[10px] font-semibold ${isBroken ? 'text-orange-500' : 'text-red-500'} flex items-center gap-1`}
                    >
                        <ChevronRightIcon className={`w-3 h-3 transition-transform ${showError ? 'rotate-90' : ''}`} />
                        Error Details
                    </button>
                    {showError && (
                        <pre className={`mt-1 text-[11px] font-mono whitespace-pre-wrap break-words p-3 rounded-lg border max-h-48 overflow-auto
                            ${isBroken ? 'rpt-error-broken' : 'rpt-error-panel'}`}>
                            {spec.error.message}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

/* ──────────────────────── Filter Pill Config ──────────────────────── */
const PILL_CONFIG = [
    { key: 'all', label: 'Total', border: 'border-surface-400', text: 'text-surface-700', activeBg: 'bg-surface-700', activeText: 'text-white' },
    { key: 'failed', label: 'Failed', border: 'border-red-400', text: 'text-red-600', activeBg: 'bg-red-500', activeText: 'text-white' },
    { key: 'broken', label: 'Broken', border: 'border-orange-400', text: 'text-orange-600', activeBg: 'bg-orange-500', activeText: 'text-white' },
    { key: 'passed', label: 'Passed', border: 'border-accent-400', text: 'text-accent-600', activeBg: 'bg-accent-500', activeText: 'text-white' },
    { key: 'skipped', label: 'Skipped', border: 'border-amber-400', text: 'text-amber-600', activeBg: 'bg-amber-500', activeText: 'text-white' },
];

/* ══════════════════════════════════════════════════════════════ */
/*                    MAIN COMPONENT                             */
/* ══════════════════════════════════════════════════════════════ */
export default function ConsolidatedReport({ since = null }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortMode, setSortMode] = useState('order-earliest');
    const [retryActive, setRetryActive] = useState(false);
    const [flakyActive, setFlakyActive] = useState(false);
    const [activeTab, setActiveTab] = useState('results');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            if (since === '__latest__') {
                // "Latest Run" mode: fetch all reports to find the most recent timestamp,
                // then refetch with a 5-minute window around it so we only show that batch.
                const allReports = await apiClient.listReports();
                if (Array.isArray(allReports) && allReports.length > 0) {
                    // Find the most recent report timestamp
                    let maxTs = 0;
                    for (const r of allReports) {
                        const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
                        if (ts > maxTs) maxTs = ts;
                    }
                    if (maxTs > 0) {
                        // Use a 5-minute window before the latest report
                        const windowStart = new Date(maxTs - 5 * 60 * 1000).toISOString();
                        const result = await apiClient.getConsolidatedReport({ since: windowStart });
                        setData(result);
                    } else {
                        // No timestamps found — show all
                        const result = await apiClient.getConsolidatedReport();
                        setData(result);
                    }
                } else {
                    setData({ total: 0, suites: [] });
                }
            } else {
                const params = since ? { since } : {};
                const result = await apiClient.getConsolidatedReport(params);
                setData(result);
            }
        } catch {
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [since]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Filter suites
    const filteredSuites = useMemo(() => {
        if (!data?.suites) return [];
        const filterFn = (spec) => {
            if (activeFilter === 'failed' && spec.status !== 'failed' && spec.status !== 'unexpected') return false;
            if (activeFilter === 'broken' && spec.status !== 'broken' && !spec.isBroken) return false;
            if (activeFilter === 'passed' && spec.status !== 'passed' && spec.status !== 'expected') return false;
            if (activeFilter === 'skipped' && spec.status !== 'skipped') return false;
            if (retryActive && !(spec.retries > 0)) return false;
            if (flakyActive && !spec.isFlaky) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (!spec.title?.toLowerCase().includes(q)) return false;
            }
            return true;
        };
        return data.suites.map(s => filterSuiteTree(s, filterFn)).filter(Boolean);
    }, [data, activeFilter, searchQuery, retryActive, flakyActive]);

    const sortedSuites = useMemo(() => sortSuites(filteredSuites, sortMode), [filteredSuites, sortMode]);

    const globalErrors = data?.errors || [];

    if (loading) {
        return (
            <div className="text-center py-16">
                <div className="w-8 h-8 mx-auto border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin mb-3" />
                <p className="text-sm rpt-text-secondary">Loading report...</p>
            </div>
        );
    }

    if (!data || data.total === 0) {
        return (
            <div className="text-center py-16">
                <EmptyDocumentIcon className="w-12 h-12 mx-auto rpt-text-muted mb-3" />
                <p className="text-sm rpt-text-secondary">No test results found. Run tests to generate a report.</p>
            </div>
        );
    }

    const formattedDate = data.timestamp
        ? new Date(data.timestamp).toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
        : '';
    const passRate = data.total > 0 ? ((data.passed / data.total) * 100).toFixed(2) : '0';
    const getCount = (key) => key === 'all' ? data.total : (data[key] || 0);

    const TABS = [
        { key: 'results', label: 'Results', count: data.total },
        { key: 'quality-gates', label: 'Quality Gates', count: 0 },
        { key: 'global-attachments', label: 'Global Attachments', count: 0 },
        { key: 'global-errors', label: 'Global Errors', count: globalErrors.length },
    ];

    return (
        <div className="space-y-0">
            {/* ═══ 1. Header: Title + Donut ═══ */}
            <div className="rpt-report-header rounded-2xl p-6 mb-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl rpt-header-icon flex items-center justify-center">
                            <BarChartIcon className="w-6 h-6" strokeWidth={1.5} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold rpt-text-primary">Test Report</h2>
                            <p className="text-xs rpt-text-secondary mt-0.5">{formattedDate}</p>
                        </div>
                    </div>
                    <DonutChart
                        passed={data.passed}
                        failed={data.failed}
                        broken={data.broken}
                        skipped={data.skipped}
                        size={120}
                        strokeWidth={14}
                    />
                </div>
            </div>

            {/* ═══ 2. Tab Bar (underline style) ═══ */}
            <div className="flex items-center gap-0 border-b rpt-border mb-5">
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-3 text-[13px] font-semibold transition-all border-b-2 -mb-px ${activeTab === tab.key
                            ? 'rpt-tab-underline-active'
                            : 'border-transparent rpt-text-muted hover:rpt-text-secondary'
                            }`}
                    >
                        {tab.label}
                        <span className={`ml-1.5 text-[11px] font-bold ${activeTab === tab.key ? '' : 'rpt-text-muted'}`}>
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {activeTab === 'results' && (
                <div className="space-y-4">
                    {/* ═══ 3. Stats Strip ═══ */}
                    <div className="rpt-stats-strip rounded-xl px-5 py-4">
                        <div className="flex items-center gap-6 text-xs">
                            <div className="flex flex-col">
                                <span className="rpt-text-secondary font-medium">Total</span>
                                <span className="text-lg font-bold rpt-text-primary">{data.total}</span>
                            </div>
                            {data.retried > 0 && (
                                <>
                                    <div className="w-px h-8 rpt-divider" />
                                    <div className="flex items-center gap-2">
                                        <RetryIcon className="w-4 h-4 rpt-text-muted" />
                                        <div className="flex flex-col">
                                            <span className="rpt-text-secondary font-medium">Retried tests</span>
                                            <span className="text-sm font-bold rpt-text-primary">{data.retried}</span>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="flex-1" />
                            <div className="flex items-center gap-5">
                                {[
                                    { label: 'Failed', value: data.failed, barColor: 'bg-red-500', textColor: 'text-red-500' },
                                    { label: 'Broken', value: data.broken, barColor: 'bg-orange-500', textColor: 'text-orange-500' },
                                    { label: 'Passed', value: data.passed, barColor: 'bg-accent-500', textColor: 'text-accent-500' },
                                    { label: 'Skipped', value: data.skipped, barColor: 'bg-amber-400', textColor: 'text-amber-500' },
                                ].map(({ label, value, barColor, textColor }) => (
                                    <div key={label} className="flex items-center gap-1.5">
                                        <span className={`w-[3px] h-5 rounded-full ${barColor}`} />
                                        <span className="font-medium rpt-text-secondary">{label}</span>
                                        <span className={`font-bold ${textColor}`}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ═══ 4. Search Input (standalone) ═══ */}
                    <div className="rpt-search-box rounded-xl px-4 py-3 flex items-center gap-2.5">
                        <SearchIcon className="w-4 h-4 rpt-text-muted flex-shrink-0" />
                        <input
                            type="text"
                            placeholder="Name or ID"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="flex-1 bg-transparent text-[13px] rpt-text-primary placeholder:rpt-text-muted outline-none"
                            autoComplete="off"
                        />
                    </div>

                    {/* ═══ 5. Retry / Flaky toggles ═══ */}
                    {(data.retried > 0 || data.flaky > 0) && (
                        <div className="flex items-center gap-3">
                            {data.retried > 0 && (
                                <button
                                    onClick={() => setRetryActive(!retryActive)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                                        ${retryActive ? 'bg-blue-500 text-white border-blue-500' : 'rpt-toggle-inactive'}`}
                                >
                                    <RetryIcon className="w-3 h-3" />
                                    Retry
                                </button>
                            )}
                            {data.flaky > 0 && (
                                <button
                                    onClick={() => setFlakyActive(!flakyActive)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                                        ${flakyActive ? 'bg-purple-500 text-white border-purple-500' : 'rpt-toggle-inactive'}`}
                                >
                                    <LightningIcon className="w-3 h-3" />
                                    Flaky
                                </button>
                            )}
                        </div>
                    )}

                    {/* ═══ 6. Filter Pills + Sort ═══ */}
                    <div className="flex items-center flex-wrap gap-2">
                        {PILL_CONFIG.map(({ key, label, border, text, activeBg, activeText }) => {
                            const count = getCount(key);
                            const isActive = activeFilter === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setActiveFilter(key)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all
                                        ${isActive
                                            ? `${activeBg} ${activeText} border-transparent shadow-sm`
                                            : `${border} ${text} bg-transparent hover:bg-surface-50 rpt-pill`
                                        }`}
                                >
                                    {label}
                                    <span className={`text-[10px] font-bold ${isActive ? 'opacity-80' : ''}`}>{count}</span>
                                </button>
                            );
                        })}

                        <div className="ml-auto flex items-center gap-2">
                            <span className="text-[11px] font-medium rpt-text-muted whitespace-nowrap">Sort by:</span>
                            <select
                                value={sortMode}
                                onChange={(e) => setSortMode(e.target.value)}
                                className="rpt-sort-select text-xs py-1.5 px-2 pr-7 rounded-lg outline-none cursor-pointer"
                            >
                                {SORT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* ═══ 7. Suite List ═══ */}
                    {sortedSuites.length === 0 ? (
                        <div className="text-center py-12 text-sm rpt-text-muted">
                            No tests match the current filters.
                        </div>
                    ) : (
                        <div className="rpt-suite-list rounded-xl overflow-hidden">
                            {sortedSuites.map((suite, i) => (
                                <SuiteRow key={`${suite.title}-${i}`} suite={suite} sortMode={sortMode} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'quality-gates' && (
                <div className="text-center py-12 text-sm rpt-text-muted">
                    <ShieldCheckIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    No quality gates configured.
                </div>
            )}

            {activeTab === 'global-attachments' && (
                <div className="text-center py-12 text-sm rpt-text-muted">
                    <PaperclipIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    No global attachments.
                </div>
            )}

            {activeTab === 'global-errors' && (
                <div className="space-y-2 mt-4">
                    {globalErrors.length === 0 ? (
                        <div className="text-center py-12 text-sm rpt-text-muted">
                            No global errors detected.
                        </div>
                    ) : (
                        globalErrors.map((err, i) => (
                            <div key={i} className="rpt-error-panel rounded-lg p-3">
                                <pre className="text-[11px] whitespace-pre-wrap break-words font-mono">
                                    {err.message || JSON.stringify(err)}
                                </pre>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* ═══ Footer ═══ */}
            <div className="text-center py-4 mt-4 rpt-text-muted text-[10px]">
                Powered by <span className="font-semibold text-brand-500">QA Automation</span> &middot; {data.reportCount} report{data.reportCount !== 1 ? 's' : ''} aggregated &middot; {passRate}% pass rate
            </div>
        </div>
    );
}
