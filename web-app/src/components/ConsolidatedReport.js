'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api-client';
import DonutChart from './DonutChart';
import AllureLogo from './AllureLogo';
import { sortSpecs, sortSuites, SORT_OPTIONS } from './SortDropdown';
import { countAllSpecs, filterSuiteTree } from '@/lib/report-utils';
import { ChevronRightIcon, SearchIcon, RetryIcon, LightningIcon, ShieldCheckIcon, PaperclipIcon, EmptyDocumentIcon } from './Icons';

/**
 * ConsolidatedReport — Pixel-perfect Allure Report 3.1.0 replica.
 * Layout: Header+Donut → Tabs → Stats → Search → Retry/Flaky/Transition → Pills+Sort → Suites → Footer
 */

/* ──────────────────── Proportional Bar ──────────────────── */
function CountBar({ count, maxCount, passed = 0, failed = 0, broken = 0, skipped = 0 }) {
    const total = passed + failed + broken + skipped;
    const pct = maxCount > 0 ? Math.max((count / maxCount) * 100, 8) : 8;

    // Compute segment widths within the bar
    const passedPct = total > 0 ? (passed / total) * 100 : 100;
    const failedPct = total > 0 ? (failed / total) * 100 : 0;
    const brokenPct = total > 0 ? (broken / total) * 100 : 0;
    const skippedPct = total > 0 ? (skipped / total) * 100 : 0;

    return (
        <div className="flex items-center gap-2 flex-shrink-0" style={{ minWidth: 80 }}>
            <div className="allure-count-bar" style={{ width: `${pct}%`, minWidth: 40 }}>
                <div className="allure-count-bar-inner">
                    {passedPct > 0 && <div className="allure-bar-passed" style={{ width: `${passedPct}%` }} />}
                    {failedPct > 0 && <div className="allure-bar-failed" style={{ width: `${failedPct}%` }} />}
                    {brokenPct > 0 && <div className="allure-bar-broken" style={{ width: `${brokenPct}%` }} />}
                    {skippedPct > 0 && <div className="allure-bar-skipped" style={{ width: `${skippedPct}%` }} />}
                </div>
                <span className="allure-count-label">{count}</span>
            </div>
        </div>
    );
}

/* ──────────────── Compute suite status breakdown ──────────────── */
function suiteStatusBreakdown(suite) {
    let passed = 0, failed = 0, broken = 0, skipped = 0;
    for (const spec of (suite.specs || [])) {
        if (spec.status === 'passed' || spec.status === 'expected') passed++;
        else if (spec.status === 'failed' || spec.status === 'unexpected') failed++;
        else if (spec.status === 'broken' || spec.isBroken) broken++;
        else if (spec.status === 'skipped') skipped++;
        else passed++; // default
    }
    for (const sub of (suite.suites || [])) {
        const s = suiteStatusBreakdown(sub);
        passed += s.passed;
        failed += s.failed;
        broken += s.broken;
        skipped += s.skipped;
    }
    return { passed, failed, broken, skipped };
}

/* ──────────────────────── Suite Row ──────────────────────── */
function SuiteRow({ suite, depth = 0, sortMode, maxCount = 0 }) {
    const [open, setOpen] = useState(depth === 0);
    const totalCount = countAllSpecs(suite);
    const hasContent = (suite.specs?.length || 0) > 0 || (suite.suites || []).length > 0;
    if (!hasContent) return null;

    const breakdown = suiteStatusBreakdown(suite);
    const sortedSpecs = sortSpecs(suite.specs || [], sortMode);
    const sortedSubs = sortSuites(suite.suites || [], sortMode);

    // Compute max count among children for proportional bars
    const childMaxCount = Math.max(
        ...sortedSubs.map(s => countAllSpecs(s)),
        ...sortedSpecs.map(() => 1),
        1
    );

    return (
        <div className={depth === 0 ? 'allure-suite-row' : 'allure-suite-child'}>
            <button
                onClick={() => setOpen(!open)}
                className="allure-suite-btn"
            >
                <ChevronRightIcon className={`w-3 h-3 allure-text-muted transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
                <span className="allure-suite-title flex-1 truncate">
                    {suite.title || 'Root Suite'}
                </span>
                <CountBar
                    count={totalCount}
                    maxCount={maxCount || totalCount}
                    passed={breakdown.passed}
                    failed={breakdown.failed}
                    broken={breakdown.broken}
                    skipped={breakdown.skipped}
                />
            </button>

            {open && (
                <div className="ml-5 mt-0.5">
                    {sortedSubs.map((sub, i) => (
                        <SuiteRow key={`${sub.title}-${i}`} suite={sub} depth={depth + 1} sortMode={sortMode} maxCount={childMaxCount} />
                    ))}
                    {sortedSpecs.map((spec, i) => (
                        <SpecItem key={`${spec.title}-${i}`} spec={spec} index={i + 1} />
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

    const dotColor = isBroken ? 'bg-orange-500' : isFailed ? 'bg-red-500' : isPassed ? 'bg-[#66bb6a]' : isSkipped ? 'bg-amber-400' : 'bg-[#64748b]';

    return (
        <div className="allure-spec-item">
            <div className="flex items-center gap-2.5 py-2.5 px-4">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <span className={`text-[13px] font-medium tracking-[-0.012em] flex-1 ${isFailed ? 'allure-status-failed' : isBroken ? 'allure-status-broken' : 'allure-text-primary'}`}>
                    {spec.title}
                </span>
                {spec.isFlaky && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded allure-badge-flaky flex-shrink-0">Flaky</span>
                )}
                {spec.retries > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded allure-badge-retry flex-shrink-0">{spec.retries}x</span>
                )}
                <span className="text-[11px] allure-text-muted font-mono flex-shrink-0 min-w-[60px] text-right">{durationStr}</span>
            </div>
            {(isFailed || isBroken) && spec.error && (
                <div className="ml-[40px] mb-1.5 mr-4">
                    <button
                        onClick={() => setShowError(!showError)}
                        className={`text-[10px] font-semibold ${isBroken ? 'allure-status-broken' : 'allure-status-failed'} flex items-center gap-1`}
                    >
                        <ChevronRightIcon className={`w-3 h-3 transition-transform ${showError ? 'rotate-90' : ''}`} />
                        Error Details
                    </button>
                    {showError && (
                        <pre className={`mt-1.5 text-[11px] font-mono whitespace-pre-wrap break-words p-3 rounded-lg border max-h-48 overflow-auto
                            ${isBroken ? 'allure-error-broken' : 'allure-error-panel'}`}>
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
    { key: 'all', label: 'Total', activeBg: 'allure-pill-total-active', activeText: 'text-white' },
    { key: 'failed', label: 'Failed', activeBg: 'bg-red-500', activeText: 'text-white' },
    { key: 'broken', label: 'Broken', activeBg: 'bg-orange-500', activeText: 'text-white' },
    { key: 'passed', label: 'Passed', activeBg: 'bg-[#66bb6a]', activeText: 'text-white' },
    { key: 'skipped', label: 'Skipped', activeBg: 'bg-amber-500', activeText: 'text-white' },
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
                const allReports = await apiClient.listReports();
                if (Array.isArray(allReports) && allReports.length > 0) {
                    let maxTs = 0;
                    for (const r of allReports) {
                        const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
                        if (ts > maxTs) maxTs = ts;
                    }
                    if (maxTs > 0) {
                        const windowStart = new Date(maxTs - 5 * 60 * 1000).toISOString();
                        const result = await apiClient.getConsolidatedReport({ since: windowStart });
                        setData(result);
                    } else {
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

    // Max count among top-level suites for proportional bars
    const topMaxCount = useMemo(() => {
        if (!sortedSuites.length) return 1;
        return Math.max(...sortedSuites.map(s => countAllSpecs(s)), 1);
    }, [sortedSuites]);

    const globalErrors = data?.errors || [];

    if (loading) {
        return (
            <div className="text-center py-16">
                <div className="w-8 h-8 mx-auto border-2 border-[#66bb6a]/30 border-t-[#66bb6a] rounded-full animate-spin mb-3" />
                <p className="text-sm allure-text-secondary">Loading report...</p>
            </div>
        );
    }

    if (!data || data.total === 0) {
        return (
            <div className="text-center py-16">
                <AllureLogo size={48} className="mx-auto mb-4 opacity-40" />
                <p className="text-sm allure-text-secondary">No test results found. Run tests to generate a report.</p>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#66bb6a]/20 bg-[#66bb6a]/5 px-3 py-1.5 text-[11px] font-medium text-[#66bb6a]/70">
                    <EmptyDocumentIcon className="w-3.5 h-3.5" />
                    Reports will appear here after the first execution
                </div>
            </div>
        );
    }

    const formattedDate = data.timestamp
        ? new Date(data.timestamp).toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
        : '';
    const shortDate = data.timestamp
        ? new Date(data.timestamp).toLocaleString('en-US', {
            month: 'numeric', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
        : '';
    const passRate = data.total > 0 ? ((data.passed / data.total) * 100).toFixed(0) : '0';
    const getCount = (key) => key === 'all' ? data.total : (data[key] || 0);

    const TABS = [
        { key: 'results', label: 'Results', count: data.total },
        { key: 'quality-gates', label: 'Quality Gates', count: 0 },
        { key: 'global-attachments', label: 'Global Attachments', count: 0 },
        { key: 'global-errors', label: 'Global Errors', count: globalErrors.length },
    ];

    return (
        <div className="space-y-0">
            {/* ═══ 1. Header: Allure Logo + Title + Date + Donut ═══ */}
            <div className="allure-header-card rounded-2xl p-6 mb-5 relative overflow-visible">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <AllureLogo size={48} />
                        <div>
                            <h2 className="text-[1.4rem] font-bold tracking-[-0.03em] allure-text-primary">
                                Allure Report
                            </h2>
                            <p className="mt-0.5 text-[12.5px] font-medium allure-text-secondary">
                                {formattedDate}
                            </p>
                        </div>
                    </div>
                    <div className="relative -top-4 -right-2">
                        <DonutChart
                            passed={data.passed}
                            failed={data.failed}
                            broken={data.broken}
                            skipped={data.skipped}
                            size={140}
                            strokeWidth={16}
                        />
                    </div>
                </div>
            </div>

            {/* ═══ 2. Tab Bar (underline style — Allure green) ═══ */}
            <div className="flex items-center gap-0 border-b allure-border mb-5">
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-3 text-[13px] font-semibold transition-all border-b-[3px] -mb-px ${activeTab === tab.key
                            ? 'allure-tab-active'
                            : 'border-transparent allure-text-muted hover:allure-text-secondary'
                            }`}
                    >
                        {tab.label}
                        <span className={`ml-1.5 text-[11px] font-bold ${activeTab === tab.key ? '' : 'allure-text-muted'}`}>
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {activeTab === 'results' && (
                <div className="space-y-4">
                    {/* ═══ 3. Stats Strip — Total left, Passed|N right ═══ */}
                    <div className="allure-stats-strip flex items-center gap-6 text-xs px-1 py-2">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-semibold uppercase tracking-wider allure-text-muted">Total</span>
                            <span className="text-[1.2rem] font-bold tracking-[-0.03em] allure-text-primary">{data.total}</span>
                        </div>
                        <div className="flex-1" />
                        <div className="flex items-center gap-5">
                            {[
                                { label: 'Failed', value: data.failed, barColor: 'bg-red-500', textColor: 'allure-status-failed' },
                                { label: 'Broken', value: data.broken, barColor: 'bg-orange-500', textColor: 'allure-status-broken' },
                                { label: 'Passed', value: data.passed, barColor: 'bg-[#66bb6a]', textColor: 'allure-status-passed' },
                                { label: 'Skipped', value: data.skipped, barColor: 'bg-amber-400', textColor: 'allure-status-skipped' },
                            ].filter(s => s.value > 0).map(({ label, value, barColor, textColor }) => (
                                <div key={label} className="flex items-center gap-1.5">
                                    <span className={`w-[3px] h-5 rounded-full ${barColor}`} />
                                    <span className="font-medium allure-text-secondary text-[12px]">{label}</span>
                                    <span className={`font-bold text-[12px] ${textColor}`}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ═══ 4. Search Input ═══ */}
                    <div className="allure-search-box rounded-xl px-4 py-3 flex items-center gap-2.5">
                        <SearchIcon className="w-4 h-4 allure-text-muted flex-shrink-0" />
                        <input
                            type="text"
                            placeholder="Name or ID"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="flex-1 bg-transparent text-[13px] allure-text-primary placeholder:text-[#64748b] outline-none"
                            autoComplete="off"
                        />
                    </div>

                    {/* ═══ 5. Retry / Flaky / Transition toggles ═══ */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setRetryActive(!retryActive)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                                ${retryActive ? 'bg-blue-500 text-white border-blue-500' : 'allure-toggle-btn'}`}
                        >
                            <RetryIcon className="w-3 h-3" />
                            Retry
                        </button>
                        <button
                            onClick={() => setFlakyActive(!flakyActive)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                                ${flakyActive ? 'bg-purple-500 text-white border-purple-500' : 'allure-toggle-btn'}`}
                        >
                            <LightningIcon className="w-3 h-3" />
                            Flaky
                        </button>
                        <button className="allure-toggle-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border">
                            Transition
                            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        </button>
                    </div>

                    {/* ═══ 6. Filter Pills + Sort ═══ */}
                    <div className="flex items-center flex-wrap gap-2">
                        {PILL_CONFIG.map(({ key, label, activeBg, activeText }) => {
                            const count = getCount(key);
                            if (count === 0 && key !== 'all') return null;
                            const isActive = activeFilter === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setActiveFilter(key)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all
                                        ${isActive
                                            ? `${activeBg} ${activeText} shadow-sm`
                                            : 'allure-pill-inactive'
                                        }`}
                                >
                                    {label}
                                    <span className={`text-[10px] ${isActive ? 'opacity-80' : ''}`}>{count}</span>
                                </button>
                            );
                        })}

                        <div className="ml-auto flex items-center gap-2">
                            <span className="text-[11px] font-medium allure-text-muted whitespace-nowrap">Sort by:</span>
                            <select
                                value={sortMode}
                                onChange={(e) => setSortMode(e.target.value)}
                                className="allure-sort-select text-xs py-1.5 px-2 pr-7 rounded-lg outline-none cursor-pointer"
                            >
                                {SORT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* ═══ 7. Suite List — Allure tree with proportional bars ═══ */}
                    {sortedSuites.length === 0 ? (
                        <div className="text-center py-12 text-sm allure-text-muted">
                            No tests match the current filters.
                        </div>
                    ) : (
                        <div className="allure-suite-list rounded-xl overflow-hidden">
                            {sortedSuites.map((suite, i) => (
                                <SuiteRow key={`${suite.title}-${i}`} suite={suite} sortMode={sortMode} maxCount={topMaxCount} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'quality-gates' && (
                <div className="text-center py-12 text-sm allure-text-muted">
                    <ShieldCheckIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    No quality gates configured.
                </div>
            )}

            {activeTab === 'global-attachments' && (
                <div className="text-center py-12 text-sm allure-text-muted">
                    <PaperclipIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    No global attachments.
                </div>
            )}

            {activeTab === 'global-errors' && (
                <div className="space-y-2 mt-4">
                    {globalErrors.length === 0 ? (
                        <div className="text-center py-12 text-sm allure-text-muted">
                            No global errors detected.
                        </div>
                    ) : (
                        globalErrors.map((err, i) => (
                            <div key={i} className="allure-error-panel rounded-lg p-3">
                                <pre className="text-[11px] whitespace-pre-wrap break-words font-mono">
                                    {err.message || JSON.stringify(err)}
                                </pre>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* ═══ Footer — Allure branding ═══ */}
            <div className="allure-footer">
                <div className="flex items-center gap-2">
                    <span className="allure-text-muted text-[11px]">Powered by</span>
                    <AllureLogo size={18} />
                    <span className="text-[12px] font-bold allure-text-primary">Allure Report</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="allure-text-muted text-[11px]">{shortDate}</span>
                    <span className="allure-text-muted text-[11px]">Ver: 3.1.0</span>
                </div>
            </div>
        </div>
    );
}
