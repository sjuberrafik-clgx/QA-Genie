'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePipeline } from '@/hooks/usePipeline';
import useModelCatalog from '@/hooks/useModelCatalog';
import StageProgress from '@/components/StageProgress';
import PipelineCard from '@/components/PipelineCard';
import ModelSelect from '@/components/ModelSelect';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import CognitiveInsights from '@/components/CognitiveInsights';
import MissionEvidenceSummary from '@/components/MissionEvidenceSummary';
// Perf: TerminalWorkbench pulls in @xterm/xterm (~200kB) plus the addon-fit
// bundle and a 750-line component. Lazy-load on the client only — it's not
// needed for first paint of the dashboard, and SSR can't render xterm anyway.
const TerminalWorkbench = dynamic(() => import('@/components/TerminalWorkbench'), {
    ssr: false,
    loading: () => (
        <div className="rounded-2xl border border-surface-200 bg-surface-50/60 px-4 py-6 text-xs text-surface-500">
            Loading terminal workbench…
        </div>
    ),
});
import apiClient from '@/lib/api-client';
import { getDefaultModel, hasModelValue } from '@/lib/model-options';
import { ClockIcon, RetryIcon, DashboardIcon } from '@/components/Icons';
import RefreshButton from '@/components/RefreshButton';
import RobotMascotLogo from '@/components/RobotMascotLogo';

export default function DashboardPage() {
    const {
        runs, activeRunId, stages, loading, error, networkWarning,
        cognitiveInsights, sseStatus, retryCount, startPipeline, cancelPipeline, refreshRuns, setError,
        liveOutput,
    } = usePipeline();

    const {
        groups: modelGroups,
        defaultModel,
        source: modelCatalogSource,
        warnings: modelCatalogWarnings,
        error: modelCatalogError,
        loading: modelCatalogLoading,
    } = useModelCatalog();

    const [identifier, setIdentifier] = useState('');
    const [identifierType, setIdentifierType] = useState('ticket');
    const [mode, setMode] = useState('full');
    const [environment, setEnvironment] = useState('UAT');
    const [frameworkMode, setFrameworkMode] = useState('existing');
    const [appUrl, setAppUrl] = useState('');
    const [testCaseSource, setTestCaseSource] = useState('');
    const [testDataOverride, setTestDataOverride] = useState('');
    const [executionTarget, setExecutionTarget] = useState('');
    const [model, setModelState] = useState('');
    const [modelTouched, setModelTouched] = useState(false);
    const [backendStatus, setBackendStatus] = useState(null);
    const [selectedEvidenceRunId, setSelectedEvidenceRunId] = useState(null);
    const [evidenceSummary, setEvidenceSummary] = useState(null);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [evidenceError, setEvidenceError] = useState(null);
    const [commandOutput, setCommandOutput] = useState(null);
    const [commandOutputLoading, setCommandOutputLoading] = useState(false);
    const [commandOutputError, setCommandOutputError] = useState(null);

    const setModel = useCallback((nextModel) => {
        setModelTouched(true);
        setModelState(nextModel);
    }, []);

    useEffect(() => {
        // Perf: parallelize bootstrap fetches so a slow backend ready-check
        // doesn't block the runs list from rendering.
        Promise.allSettled([
            apiClient.ready(),
            Promise.resolve(refreshRuns()),
        ]).then(([readyRes]) => {
            if (readyRes.status === 'fulfilled') {
                setBackendStatus(readyRes.value);
            } else {
                setBackendStatus({ ready: false, error: 'Cannot reach backend' });
            }
        });
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

    useEffect(() => {
        const preferredRunId = activeRunId || runs[0]?.runId || null;
        setSelectedEvidenceRunId((current) => {
            if (activeRunId && current !== activeRunId) {
                return activeRunId;
            }

            if (current && runs.some((run) => run.runId === current)) {
                return current;
            }

            return preferredRunId;
        });
    }, [activeRunId, runs]);

    useEffect(() => {
        if (!selectedEvidenceRunId) {
            setEvidenceSummary(null);
            setEvidenceError(null);
            return undefined;
        }

        const controller = new AbortController();

        setEvidenceLoading(true);
        setEvidenceError(null);

        apiClient.getPipelineEvidenceSummary(selectedEvidenceRunId, 12, { signal: controller.signal })
            .then((data) => {
                setEvidenceSummary(data);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                setEvidenceSummary(null);
                setEvidenceError(err.message || 'Failed to load mission evidence');
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setEvidenceLoading(false);
                }
            });

        return () => controller.abort();
    }, [selectedEvidenceRunId, runs]);

    const loadCommandOutput = useCallback(async (runId, options = {}) => {
        if (!runId) {
            setCommandOutput(null);
            setCommandOutputError(null);
            return;
        }

        const { signal } = options;
        setCommandOutputLoading(true);
        setCommandOutputError(null);

        try {
            const payload = await apiClient.getPipelineCommandOutput(runId, 320, { signal });
            if (signal?.aborted) return;
            setCommandOutput(payload);
        } catch (err) {
            if (signal?.aborted) return;
            setCommandOutput(null);
            setCommandOutputError(err.message || 'Failed to load command output');
        } finally {
            if (!signal?.aborted) {
                setCommandOutputLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!selectedEvidenceRunId) {
            setCommandOutput(null);
            setCommandOutputError(null);
            return undefined;
        }

        const controller = new AbortController();
        loadCommandOutput(selectedEvidenceRunId, { signal: controller.signal });
        return () => controller.abort();
    }, [selectedEvidenceRunId, loadCommandOutput]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalizedIdentifier = identifier.trim();
        if (!normalizedIdentifier) return;

        const launchOptions = {
            identifierType,
            frameworkMode,
        };

        if (identifierType === 'custom') {
            launchOptions.runId = normalizedIdentifier;
        } else {
            launchOptions.ticketId = normalizedIdentifier;
        }

        if (frameworkMode === 'manual') {
            launchOptions.appUrl = appUrl.trim();
            launchOptions.testCaseSource = testCaseSource.trim();

            if (testDataOverride.trim()) {
                try {
                    launchOptions.testDataOverride = JSON.parse(testDataOverride);
                } catch {
                    launchOptions.testDataOverride = testDataOverride.trim();
                }
            }
        }

        if (mode === 'execute' && executionTarget.trim()) {
            launchOptions.executionTarget = executionTarget.trim();
        }

        try {
            await startPipeline(normalizedIdentifier, mode, environment, model, launchOptions);
            setIdentifier('');

            if (frameworkMode === 'manual') {
                setAppUrl('');
                setTestCaseSource('');
                setTestDataOverride('');
            }
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

    const handleRefreshCommandOutput = useCallback(() => {
        if (!selectedEvidenceRunId) return;
        loadCommandOutput(selectedEvidenceRunId);
    }, [selectedEvidenceRunId, loadCommandOutput]);

    const stageCount = Array.isArray(stages) ? stages.length : 0;
    const doneCount = Array.isArray(stages) ? stages.filter((s) => s?.status === 'completed' || s?.status === 'success').length : 0;
    const etaReady = backendStatus?.ready && identifier.trim() && model;
    const readinessChecks = [
        { label: 'Backend reachable', ok: !!backendStatus?.ready },
        { label: 'Model selected', ok: !!model },
        { label: 'Identifier provided', ok: !!identifier.trim() },
        { label: frameworkMode === 'manual' ? 'App URL + test cases' : 'Framework configured', ok: frameworkMode === 'manual' ? (!!appUrl.trim() && !!testCaseSource.trim()) : true },
    ];
    const previewCommand = (() => {
        const id = identifier.trim() || 'AOTF-XXXXX';
        const modeTag = mode === 'full' ? 'full-pipeline' : mode;
        return `pipeline:${modeTag} --${identifierType}=${id} --env=${environment} --model=${model || 'default'}`;
    })();

    return (
        <div className="motion-page-calm mx-auto w-full max-w-[var(--app-page-wide-max)] space-y-8 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
            {/* ═══ Zone A — Mission Header (condensed glass bar) ═══ */}
            <section className="glass-panel motion-enter relative overflow-hidden p-5 sm:p-6">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_8%_10%,rgba(15,118,110,0.10),transparent_40%),radial-gradient(ellipse_at_92%_10%,rgba(37,99,235,0.12),transparent_38%)]" />
                <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 via-blue-500 to-indigo-500 text-white shadow-[0_14px_32px_rgba(37,99,235,0.3)] ring-1 ring-white/30">
                            <DashboardIcon className="h-6 w-6" strokeWidth={1.75} />
                        </div>
                        <div>
                            <p className="kicker-accent text-surface-500">Operations workspace</p>
                            <h1 className="mt-1 font-display text-[1.6rem] font-bold leading-[1.1] tracking-[-0.04em] text-surface-900 sm:text-[1.85rem]">
                                Pipeline Mission Control
                            </h1>
                            <p className="mt-1 max-w-xl text-[13.5px] leading-6 text-surface-600">
                                Launch, monitor, and recover QA workflows from one focused control surface.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`mono-accent inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${backendStatus?.ready ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70' : 'bg-rose-50 text-rose-600 ring-rose-200/70'}`}>
                            <span className={backendStatus?.ready ? 'live-dot scale-75' : 'live-dot live-dot-failed scale-75'} />
                            {backendStatus?.ready ? 'System ready' : 'Backend offline'}
                        </span>
                        {activeRunId && (
                            <span className="mono-accent inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700 ring-1 ring-brand-200/70">
                                <span className="live-dot scale-75" />
                                Live feed · {activeRunId.slice(-8)}
                            </span>
                        )}
                        {sseStatus === 'reconnecting' && (
                            <span className="mono-accent inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 ring-1 ring-amber-200/70">
                                <span className="live-dot live-dot-warning scale-75" />
                                Reconnecting {retryCount}/10
                            </span>
                        )}
                        <a href="/chat" className="action-secondary motion-lift text-[12.5px]">
                            AI chat
                        </a>
                        <a href="/history" className="action-secondary motion-lift text-[12.5px]">
                            History
                        </a>
                    </div>
                </div>
            </section>

            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            <div className="space-y-6">
                {/* Network Warning (auto-dismiss) */}
                {networkWarning && (
                    <div className="glass-subpanel flex items-center gap-3 border-amber-200 px-5 py-3 text-sm text-amber-700">
                        <RetryIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span>{networkWarning}</span>
                    </div>
                )}

                {/* ═══ Zone B — Launchpad Cockpit ═══ */}
                <section className="glass-panel motion-enter motion-enter-delay-1 relative overflow-hidden p-6 sm:p-7">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_10%_10%,rgba(15,118,110,0.08),transparent_36%),radial-gradient(ellipse_at_95%_15%,rgba(37,99,235,0.10),transparent_36%)]" />
                    <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,1fr)]">
                        <div>
                            <div className="mb-5 flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 via-blue-500 to-indigo-500 text-white shadow-[0_10px_24px_rgba(37,99,235,0.3)] ring-1 ring-white/25">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="kicker-accent text-surface-500">Launchpad</p>
                                    <h2 className="mt-0.5 font-display text-[1.25rem] font-bold leading-[1.1] tracking-[-0.035em] text-surface-900 sm:text-[1.4rem]">Configure &amp; launch pipeline</h2>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit} autoComplete="off" className="grid grid-cols-1 gap-3 items-end md:grid-cols-2 xl:grid-cols-4">
                                <div>
                                    <label className="type-meta-label block mb-1.5 text-surface-500">Identifier Type</label>
                                    <select
                                        value={identifierType}
                                        onChange={(e) => setIdentifierType(e.target.value)}
                                        suppressHydrationWarning
                                        aria-label="Identifier type"
                                        className="custom-select w-full"
                                    >
                                        <option value="ticket">Jira Ticket ID</option>
                                        <option value="custom">Custom Run ID</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2 xl:col-span-1">
                                    <label htmlFor="pipelineIdentifier" className="type-meta-label block mb-1.5 text-surface-500">
                                        {identifierType === 'custom' ? 'Run ID' : 'Ticket ID'}
                                    </label>
                                    <input
                                        id="pipelineIdentifier"
                                        type="text"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        placeholder={identifierType === 'custom' ? 'e.g., release_2026_04_17' : 'e.g., AOTF-16339'}
                                        autoComplete="off"
                                        suppressHydrationWarning
                                        className="field-input"
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
                                    <label className="type-meta-label block mb-1.5 text-surface-500">Framework Input</label>
                                    <select
                                        value={frameworkMode}
                                        onChange={(e) => setFrameworkMode(e.target.value)}
                                        suppressHydrationWarning
                                        aria-label="Framework input mode"
                                        className="custom-select w-full"
                                    >
                                        <option value="existing">Use existing automation framework</option>
                                        <option value="manual">No framework: provide URL + test cases</option>
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

                                {mode === 'execute' && (
                                    <div className="md:col-span-2 xl:col-span-4">
                                        <label htmlFor="executionTarget" className="type-meta-label block mb-1.5 text-surface-500">
                                            Script or Suite Target (optional)
                                        </label>
                                        <input
                                            id="executionTarget"
                                            type="text"
                                            value={executionTarget}
                                            onChange={(e) => setExecutionTarget(e.target.value)}
                                            placeholder="examples: tests/specs/aotf-16339/AOTF-16339.spec.js or tests/specs/aotf-16339"
                                            className="field-input"
                                        />
                                        <p className="mt-1 text-[11px] text-surface-400">
                                            Leave blank to use the default resolved spec for this identifier.
                                        </p>
                                    </div>
                                )}

                                {frameworkMode === 'manual' && (
                                    <>
                                        <div className="md:col-span-2 xl:col-span-4">
                                            <label htmlFor="manualAppUrl" className="type-meta-label block mb-1.5 text-surface-500">Application URL</label>
                                            <input
                                                id="manualAppUrl"
                                                type="url"
                                                value={appUrl}
                                                onChange={(e) => setAppUrl(e.target.value)}
                                                placeholder="https://your-app.example.com/path"
                                                className="field-input"
                                            />
                                        </div>
                                        <div className="md:col-span-2 xl:col-span-4">
                                            <label htmlFor="manualTestCases" className="type-meta-label block mb-1.5 text-surface-500">Test Case Source</label>
                                            <textarea
                                                id="manualTestCases"
                                                value={testCaseSource}
                                                onChange={(e) => setTestCaseSource(e.target.value)}
                                                rows={4}
                                                placeholder="Paste test steps markdown/table or a relative/absolute file path"
                                                className="field-input"
                                            />
                                        </div>
                                        <div className="md:col-span-2 xl:col-span-4">
                                            <label htmlFor="manualTestData" className="type-meta-label block mb-1.5 text-surface-500">Test Data Override (optional)</label>
                                            <textarea
                                                id="manualTestData"
                                                value={testDataOverride}
                                                onChange={(e) => setTestDataOverride(e.target.value)}
                                                rows={3}
                                                placeholder="Optional JSON or plain text test data override"
                                                className="field-input"
                                            />
                                        </div>
                                    </>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading
                                        || !identifier.trim()
                                        || !backendStatus?.ready
                                        || !model
                                        || (frameworkMode === 'manual' && (!appUrl.trim() || !testCaseSource.trim()))}
                                    className="action-primary w-full md:col-span-2 xl:col-span-1"
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

                        {/* Command Preview — right column */}
                        <aside className="glass-subpanel relative flex flex-col gap-4 overflow-hidden p-5">
                            <div>
                                <p className="kicker-accent text-surface-500">Launch preview</p>
                                <p className="mt-1 text-[13px] leading-[1.55] text-surface-600">
                                    Exact command + readiness check before launch.
                                </p>
                            </div>
                            <div className="rounded-xl bg-surface-950/95 p-3 shadow-inner">
                                <div className="mono-accent mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-300">$ command</div>
                                <code className="mono-accent block break-words text-[11.5px] leading-5 text-emerald-200">
                                    {previewCommand}
                                </code>
                            </div>
                            <div>
                                <p className="kicker-accent text-surface-500">Readiness</p>
                                <ul className="mt-2 space-y-1.5">
                                    {readinessChecks.map(({ label, ok }) => (
                                        <li key={label} className="flex items-center gap-2 text-[12.5px]">
                                            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-white ${ok ? 'bg-emerald-500' : 'bg-surface-300'}`}>
                                                {ok ? (
                                                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5"><path d="M2 6l3 3 5-6" /></svg>
                                                ) : (
                                                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                                                )}
                                            </span>
                                            <span className={ok ? 'text-surface-700' : 'text-surface-500'}>{label}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="mt-auto flex items-center justify-between rounded-xl bg-white/50 px-3 py-2 ring-1 ring-white/70">
                                <span className="mono-accent text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">ETA</span>
                                <span className="mono-accent text-[12.5px] font-semibold text-surface-800">
                                    {etaReady ? '~8–14 min' : '—'}
                                </span>
                            </div>
                        </aside>
                    </div>
                </section>

                {/* ═══ Zone C — Live Mission Control (active run) ═══ */}
                {activeRunId && (
                    <section className="glass-panel motion-enter motion-enter-delay-2 relative overflow-hidden p-6">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(16,185,129,0.10),transparent_40%)]" />
                        <div className="relative">
                            <div className="mb-5 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.28)] ring-1 ring-white/25">
                                        <span className="live-dot bg-white" />
                                    </div>
                                    <div>
                                        <p className="kicker-accent text-surface-500">Live mission control</p>
                                        <h2 className="mt-0.5 font-display text-[1.1rem] font-bold leading-[1.1] tracking-[-0.035em] text-surface-900">Active run</h2>
                                    </div>
                                    <span className="mono-accent inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.08em] text-brand-700 ring-1 ring-brand-200/70">
                                        {activeRunId}
                                    </span>
                                    {stageCount > 0 && (
                                        <span className="mono-accent text-[11.5px] font-semibold text-surface-500">
                                            {doneCount}/{stageCount} stages
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => cancelPipeline(activeRunId)}
                                    className="motion-fast-colors inline-flex items-center rounded-xl border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                                >
                                    Cancel
                                </button>
                            </div>
                            <StageProgress stages={stages} />
                        </div>
                    </section>
                )}

                {liveOutput?.runId === activeRunId && (liveOutput?.chunks?.length || 0) > 0 && (
                    <LiveCommandOutputPanel liveOutput={liveOutput} />
                )}

                {/* Cognitive Insights (shown during/after pipeline runs with cognitive data) */}
                {cognitiveInsights && cognitiveInsights.tier && (
                    <CognitiveInsights insights={cognitiveInsights} />
                )}

                <MissionEvidenceSummary
                    runs={runs}
                    selectedRunId={selectedEvidenceRunId}
                    onSelectRun={setSelectedEvidenceRunId}
                    summary={evidenceSummary}
                    loading={evidenceLoading}
                    error={evidenceError}
                />

                <section className="glass-panel motion-enter motion-enter-delay-3 relative overflow-hidden p-6">
                    <div className="mb-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800 text-white shadow-[0_10px_24px_rgba(15,23,42,0.25)] ring-1 ring-white/20">
                                <ClockIcon className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="kicker-accent text-surface-500">Command inspector</p>
                                <h2 className="mt-0.5 font-display text-[1.1rem] font-bold leading-[1.1] tracking-[-0.035em] text-surface-900">Post-run command buffer</h2>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="mono-accent inline-flex items-center rounded-full bg-surface-100 px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.08em] text-surface-600 ring-1 ring-surface-200">
                                {selectedEvidenceRunId || 'no-run-selected'}
                            </span>
                            <RefreshButton onClick={handleRefreshCommandOutput} variant="card" disabled={!selectedEvidenceRunId || commandOutputLoading} />
                        </div>
                    </div>

                    {!selectedEvidenceRunId ? (
                        <p className="text-sm text-surface-500">Select a run to inspect command output.</p>
                    ) : commandOutputError ? (
                        <p className="text-sm text-red-600">{commandOutputError}</p>
                    ) : commandOutputLoading && !commandOutput ? (
                        <p className="text-sm text-surface-500">Loading command output...</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <MetricTile
                                    label="Total Commands"
                                    value={commandOutput?.executionMetrics?.summary?.totalCommands}
                                />
                                <MetricTile
                                    label="Average Duration"
                                    value={formatDurationMetric(commandOutput?.executionMetrics?.summary?.averageDurationMs)}
                                />
                                <MetricTile
                                    label="Max Duration"
                                    value={formatDurationMetric(commandOutput?.executionMetrics?.summary?.maxDurationMs)}
                                />
                                <MetricTile
                                    label="Max Cancel-to-Kill"
                                    value={formatDurationMetric(commandOutput?.executionMetrics?.summary?.maxCancelToKillLatencyMs)}
                                />
                            </div>

                            <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-950/95 p-3.5">
                                <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-surface-300">
                                    <span>Buffered Output</span>
                                    <span>
                                        {commandOutput?.entries?.length || 0} shown / {commandOutput?.totalEntries || 0} total
                                        {commandOutput?.droppedEntries ? ` (dropped ${commandOutput.droppedEntries})` : ''}
                                    </span>
                                </div>
                                <div className="max-h-72 overflow-y-auto rounded-xl bg-black/35 px-3 py-2 font-mono text-[11px] leading-5 text-emerald-200">
                                    {(commandOutput?.entries || []).length === 0 ? (
                                        <p className="text-surface-300">No command output captured for this run yet.</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {(commandOutput.entries || []).map((entry, index) => (
                                                <div key={`${entry.timestamp || 't'}-${entry.eventType || 'e'}-${index}`}>
                                                    <span className="text-cyan-300">[{formatLogTime(entry.timestamp)}]</span>{' '}
                                                    <span className="text-amber-300">[{entry.stage || 'stage'}]</span>{' '}
                                                    <span className="text-fuchsia-300">[{entry.eventType || 'event'}]</span>{' '}
                                                    <span>{formatCommandEntry(entry)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </section>

                {/* ═══ Zone F — Terminal Workbench (IDE-grade shell) ═══ */}
                <section className="glass-panel motion-enter motion-enter-delay-3 relative overflow-hidden p-5 sm:p-6">
                    <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.3)] ring-1 ring-white/20">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <div>
                                <p className="kicker-accent text-surface-500">Terminal workbench</p>
                                <h2 className="mt-0.5 font-display text-[1.1rem] font-bold leading-[1.1] tracking-[-0.035em] text-surface-900">PTY shell sessions</h2>
                            </div>
                        </div>
                        <div className="hidden items-center gap-1.5 sm:flex">
                            <span className="terminal-chrome__dot bg-[#ff5f57]" />
                            <span className="terminal-chrome__dot bg-[#febc2e]" />
                            <span className="terminal-chrome__dot bg-[#28c840]" />
                        </div>
                    </div>
                    <TerminalWorkbench />
                </section>

                {/* ═══ Zone G — Recent Runs Timeline ═══ */}
                <section className="glass-panel motion-enter motion-enter-delay-3 relative overflow-hidden p-6">
                    <div className="mb-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 text-white shadow-[0_10px_24px_rgba(99,102,241,0.3)] ring-1 ring-white/25">
                                <ClockIcon className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="kicker-accent text-surface-500">Timeline</p>
                                <h2 className="mt-0.5 font-display text-[1.1rem] font-bold leading-[1.1] tracking-[-0.035em] text-surface-900">Recent runs</h2>
                            </div>
                        </div>
                        <RefreshButton onClick={() => refreshRuns()} variant="card" />
                    </div>
                    {runs.length === 0 ? (
                        <div className="py-14 text-center">
                            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-[28px] bg-[radial-gradient(circle_at_30%_20%,rgba(37,99,235,0.16),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(15,118,110,0.18),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] shadow-[0_12px_32px_rgba(37,99,235,0.14)] ring-1 ring-white/70">
                                <RobotMascotLogo size={48} mood="minimal" />
                            </div>
                            <p className="text-[15px] font-semibold tracking-[-0.015em] text-surface-700">No pipeline runs yet</p>
                            <p className="mt-1 text-[13px] text-surface-500">Configure the launchpad above to start your first mission.</p>
                        </div>
                    ) : (
                        <div className="relative space-y-3">
                            <div className="absolute left-3 top-1 bottom-1 w-px bg-[linear-gradient(180deg,rgba(15,118,110,0.3),rgba(37,99,235,0.25),transparent)]" aria-hidden="true" />
                            {runs.slice(0, 10).map((run) => (
                                <div key={run.runId} className="relative pl-8">
                                    <span className="absolute left-[9px] top-5 inline-flex h-2 w-2 rounded-full bg-brand-500 ring-4 ring-white" />
                                    <PipelineCard run={run} onForceCancel={handleForceCancel} />
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

function formatDurationMetric(value) {
    if (!Number.isFinite(value)) return 'n/a';
    if (value < 1000) return `${value} ms`;
    return `${(value / 1000).toFixed(2)} s`;
}

function formatLogTime(value) {
    if (!value) return '--:--:--';
    try {
        return new Date(value).toLocaleTimeString();
    } catch {
        return String(value);
    }
}

function formatCommandEntry(entry = {}) {
    const segments = [];

    if (entry.scenarioName || entry.scenarioId) {
        const scenarioLabel = entry.scenarioName || entry.scenarioId;
        segments.push(`${scenarioLabel}`);
    }

    if (entry.text) {
        segments.push(entry.text);
    } else if (entry.error) {
        segments.push(entry.error);
    } else if (entry.command) {
        segments.push(entry.command);
    }

    if (Number.isFinite(entry.exitCode)) {
        segments.push(`exit=${entry.exitCode}`);
    }
    if (Number.isFinite(entry.durationMs)) {
        segments.push(`duration=${entry.durationMs}ms`);
    }
    if (Number.isFinite(entry.cancelToKillLatencyMs)) {
        segments.push(`cancel-kill=${entry.cancelToKillLatencyMs}ms`);
    }

    return segments.join(' | ') || 'command event';
}

function MetricTile({ label, value }) {
    return (
        <div className="glass-subpanel px-4 py-3.5">
            <p className="kicker-accent text-surface-500">{label}</p>
            <p className="mono-accent mt-1.5 text-[1.2rem] font-bold tracking-[-0.02em] text-surface-900">{value ?? 'n/a'}</p>
        </div>
    );
}

function LiveCommandOutputPanel({ liveOutput }) {
    const scrollRef = useRef(null);
    const [autoscroll, setAutoscroll] = useState(true);

    const chunks = liveOutput?.chunks || [];

    useEffect(() => {
        if (!autoscroll) return;
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [chunks.length, autoscroll]);

    const onScroll = useCallback((e) => {
        const el = e.currentTarget;
        const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
        // If user scrolls up more than 40px, disable autoscroll; re-enable when they come back near bottom.
        setAutoscroll(distanceFromBottom < 40);
    }, []);

    const droppedChars = liveOutput?.droppedChars || 0;

    return (
        <div className="glass-panel motion-enter motion-enter-delay-1 p-5">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="live-dot scale-75" />
                    <h3 className="font-display text-[0.98rem] font-bold tracking-[-0.02em] text-surface-900">Live Command Output</h3>
                    <span className="state-chip state-chip-neutral font-mono normal-case tracking-[0.04em] text-[10px]">
                        {chunks.length} chunk{chunks.length === 1 ? '' : 's'}
                    </span>
                    {droppedChars > 0 && (
                        <span className="state-chip state-chip-warning font-mono normal-case tracking-[0.04em] text-[10px]">
                            {droppedChars} char{droppedChars === 1 ? '' : 's'} dropped
                        </span>
                    )}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-surface-500">
                    <input
                        type="checkbox"
                        checked={autoscroll}
                        onChange={(e) => setAutoscroll(e.target.checked)}
                        className="h-3 w-3"
                    />
                    Auto-scroll
                </label>
            </div>
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="max-h-80 overflow-y-auto rounded-xl bg-black/70 px-3 py-2 font-mono text-[11px] leading-[1.45] text-emerald-100 whitespace-pre-wrap"
            >
                {chunks.length === 0 ? (
                    <p className="text-surface-400">Waiting for command output...</p>
                ) : (
                    chunks.map((chunk, index) => (
                        <span
                            key={`${chunk.seq ?? index}`}
                            className={chunk.stream === 'stderr' ? 'text-amber-300' : 'text-emerald-100'}
                        >
                            {chunk.text}
                        </span>
                    ))
                )}
            </div>
        </div>
    );
}

function StatusBadge({ status, sseStatus, retryCount, activeRunId }) {
    const ready = status?.ready;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <div className={`page-header-panel flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.68rem] font-semibold ${ready ? 'text-white' : 'text-red-300'}`}>
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
