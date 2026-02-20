'use client';

import { useState } from 'react';
import { sortSpecs } from './SortDropdown';
import { countAllSpecs } from '@/lib/report-utils';
import { ChevronRightIcon, FolderIcon } from '@/components/Icons';

/**
 * TestResultTree — Allure-style collapsible suite → spec tree with status icons,
 * durations, expandable error panels, step details, and count badges.
 */

function StatusIcon({ status, isBroken }) {
    if (isBroken || status === 'broken') {
        return (
            <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.094-5.094A5.492 5.492 0 004.77 5.793 5.487 5.487 0 003 8.25c0 1.429.543 2.731 1.432 3.713l6.068 6.068a.75.75 0 001.06 0l.81-.81M15.75 4h-3l1.5 1.5-3 3h3l-1.5 1.5 3 3" />
            </svg>
        );
    }
    if (status === 'passed' || status === 'expected') {
        return (
            <svg className="w-4 h-4 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        );
    }
    if (status === 'failed' || status === 'unexpected') {
        return (
            <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        );
    }
    if (status === 'skipped') {
        return (
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        );
    }
    return (
        <svg className="w-4 h-4 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
        </svg>
    );
}

function SpecItem({ spec, index }) {
    const [showError, setShowError] = useState(false);
    const [showSteps, setShowSteps] = useState(false);

    const isFailed = spec.status === 'failed' || spec.status === 'unexpected';
    const isBroken = spec.isBroken || spec.status === 'broken';
    const isFlaky = spec.isFlaky;
    const durationMs = spec.duration || 0;
    const durationStr = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;

    return (
        <div className="rpt-spec-item">
            {/* Spec header */}
            <div className="flex items-center gap-2 group">
                <StatusIcon status={spec.status} isBroken={isBroken} />
                <span className="text-[11px] rpt-text-muted font-mono w-5 flex-shrink-0">{index}</span>
                <span className={`text-xs font-medium flex-1 ${isFailed ? 'text-red-600' : isBroken ? 'text-orange-600' : 'rpt-text-primary'}`}>
                    {spec.title}
                </span>
                <span className="text-[10px] rpt-text-muted font-mono">{durationStr}</span>
                {isFlaky && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-purple-100 text-purple-700">
                        Flaky
                    </span>
                )}
                {spec.retries > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-700">
                        {spec.retries} {spec.retries === 1 ? 'retry' : 'retries'}
                    </span>
                )}
            </div>

            {/* Error panel (expandable) */}
            {(isFailed || isBroken) && spec.error && (
                <div className="mt-1.5 ml-6">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowError(!showError); }}
                        className={`text-[10px] font-semibold ${isBroken ? 'text-orange-600 hover:text-orange-800' : 'text-red-600 hover:text-red-800'} flex items-center gap-1 transition-colors`}
                    >
                        <ChevronRightIcon className={`w-3 h-3 transition-transform ${showError ? 'rotate-90' : ''}`} />
                        View Error
                    </button>
                    {showError && (
                        <div className={`mt-1.5 rounded-lg border p-3 space-y-2 ${isBroken ? 'border-orange-200 bg-orange-50/80' : 'border-red-200 bg-red-50/80'}`}>
                            {spec.error.message && (
                                <div>
                                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isBroken ? 'text-orange-800' : 'text-red-800'}`}>Error Message</p>
                                    <pre className={`text-[11px] whitespace-pre-wrap break-words font-mono leading-relaxed ${isBroken ? 'text-orange-700' : 'text-red-700'}`}>
                                        {spec.error.message}
                                    </pre>
                                </div>
                            )}
                            {spec.error.snippet && (
                                <div>
                                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isBroken ? 'text-orange-800' : 'text-red-800'}`}>Code Snippet</p>
                                    <pre className={`text-[11px] whitespace-pre-wrap break-words font-mono rounded p-2 leading-relaxed ${isBroken ? 'text-orange-600 bg-orange-100/50' : 'text-red-600 bg-red-100/50'}`}>
                                        {spec.error.snippet}
                                    </pre>
                                </div>
                            )}
                            {spec.error.stack && (
                                <details className="group/stack">
                                    <summary className={`text-[10px] font-bold uppercase tracking-wider cursor-pointer ${isBroken ? 'text-orange-800 hover:text-orange-900' : 'text-red-800 hover:text-red-900'}`}>
                                        Stack Trace
                                    </summary>
                                    <pre className={`mt-1 text-[10px] whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-auto ${isBroken ? 'text-orange-500' : 'text-red-500'}`}>
                                        {spec.error.stack}
                                    </pre>
                                </details>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Steps (expandable) */}
            {spec.steps && spec.steps.length > 0 && (
                <div className="mt-1 ml-6">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowSteps(!showSteps); }}
                        className="text-[10px] font-semibold text-brand-600 hover:text-brand-800 flex items-center gap-1 transition-colors"
                    >
                        <ChevronRightIcon className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-90' : ''}`} />
                        {spec.steps.length} Steps
                    </button>
                    {showSteps && (
                        <div className="mt-1 space-y-0.5">
                            {spec.steps.map((step, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-[11px] pl-2">
                                    <span className={`w-1.5 h-1.5 rounded-full ${step.error ? 'bg-red-500' : 'bg-accent-400'}`} />
                                    <span className={step.error ? 'text-red-600' : 'rpt-text-secondary'}>{step.title}</span>
                                    {step.duration > 0 && (
                                        <span className="text-[10px] rpt-text-muted font-mono">
                                            {step.duration >= 1000 ? `${(step.duration / 1000).toFixed(1)}s` : `${step.duration}ms`}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SuiteNode({ suite, depth = 0, sortMode = 'order-earliest' }) {
    const [open, setOpen] = useState(depth === 0);

    const specCount = suite.specs?.length || 0;
    const nestedCount = suite.suites?.length || 0;
    const totalCount = countAllSpecs(suite);
    const hasContent = specCount > 0 || nestedCount > 0;

    if (!hasContent) return null;

    const sortedSpecs = sortSpecs(suite.specs || [], sortMode);

    return (
        <div className={depth > 0 ? 'ml-3 rpt-suite-nested pl-2' : ''}>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 w-full text-left py-2 group rpt-suite-btn rounded-lg px-2 -ml-2 transition-colors"
            >
                <ChevronRightIcon
                    className={`w-3.5 h-3.5 rpt-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
                    strokeWidth={2}
                />
                <FolderIcon className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-semibold rpt-text-primary flex-1">
                    {suite.title || 'Root Suite'}
                </span>
                {/* Allure-style count badge */}
                <span className="rpt-count-badge">
                    {totalCount}
                </span>
            </button>

            {open && (
                <div className="mt-0.5">
                    {sortedSpecs.map((spec, i) => (
                        <SpecItem key={`${spec.title}-${i}`} spec={spec} index={i + 1} />
                    ))}
                    {suite.suites?.map((sub, i) => (
                        <SuiteNode key={`${sub.title}-${i}`} suite={sub} depth={depth + 1} sortMode={sortMode} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function TestResultTree({ report, sortMode = 'order-earliest' }) {
    if (!report || !report.suites || report.suites.length === 0) {
        return (
            <div className="text-center py-8 text-sm rpt-text-muted">
                No test suite data available for this report.
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {/* Global errors */}
            {report.errors && report.errors.length > 0 && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50/80 p-3">
                    <p className="text-[10px] font-bold text-red-800 uppercase tracking-wider mb-1">Global Errors</p>
                    {report.errors.map((err, i) => (
                        <pre key={i} className="text-[11px] text-red-700 whitespace-pre-wrap break-words font-mono">
                            {err.message || JSON.stringify(err)}
                        </pre>
                    ))}
                </div>
            )}

            {/* Suite tree */}
            {report.suites.map((suite, i) => (
                <SuiteNode key={`${suite.title}-${i}`} suite={suite} sortMode={sortMode} />
            ))}
        </div>
    );
}
