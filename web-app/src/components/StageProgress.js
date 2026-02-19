'use client';

const STAGE_ORDER = ['preflight', 'testgenie', 'scriptgenerator', 'execute', 'healing', 'buggenie', 'report'];

const STAGE_LABELS = {
    preflight: 'Preflight',
    testgenie: 'Test Cases',
    scriptgenerator: 'Script Gen',
    execute: 'Execution',
    healing: 'Self-Heal',
    buggenie: 'Bug Report',
    report: 'Report',
};

/* Heroicon-style SVG icons for each stage */
function StageIcon({ stage, status }) {
    const color = status === 'running' ? 'text-brand-600' :
        status === 'passed' ? 'text-accent-600' :
            status === 'failed' ? 'text-red-500' : 'text-surface-400';

    const icons = {
        preflight: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
        ),
        testgenie: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
        ),
        scriptgenerator: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
        ),
        execute: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
        ),
        healing: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.194-.14 1.743Z" />
            </svg>
        ),
        buggenie: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0 1 12 12.75Zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 0 1-1.152-6.135c-.117-1.329-.846-2.51-1.907-3.174A3.001 3.001 0 0 0 12 2.25a3.001 3.001 0 0 0-5.148 2.626c-1.06.665-1.79 1.845-1.907 3.174A23.91 23.91 0 0 1 3.793 14.19 24.232 24.232 0 0 1 12 12.75Z" />
            </svg>
        ),
        report: (
            <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
        ),
    };
    return icons[stage] || null;
}

function StatusIndicator({ status }) {
    if (status === 'running') {
        return (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand-100 ring-2 ring-brand-400 ring-offset-1">
                <span className="w-2 h-2 bg-brand-500 rounded-full" />
            </span>
        );
    }
    if (status === 'passed') {
        return (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent-100 ring-2 ring-accent-400 ring-offset-1">
                <svg className="w-3 h-3 text-accent-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 ring-2 ring-red-400 ring-offset-1">
                <svg className="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
            </span>
        );
    }
    return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-surface-100 ring-2 ring-surface-300 ring-offset-1">
            <span className="w-1.5 h-1.5 bg-surface-300 rounded-full" />
        </span>
    );
}

export default function StageProgress({ stages }) {
    // Determine which stages have started for connector coloring
    const getConnectorStatus = (prevStage) => {
        const prevInfo = stages[prevStage];
        const prevStatus = prevInfo?.status || 'pending';
        if (prevStatus === 'passed') return 'passed';
        if (prevStatus === 'running') return 'active';
        if (prevStatus === 'failed') return 'failed';
        return 'pending';
    };

    return (
        <div className="w-full">
            {/* Desktop: horizontal pipeline */}
            <div className="hidden sm:flex items-start gap-0">
                {STAGE_ORDER.map((stage, index) => {
                    const info = stages[stage];
                    const status = info?.status || 'pending';
                    const message = info?.message || '';

                    return (
                        <div key={stage} className="flex items-start flex-1 min-w-0">
                            {/* Stage node */}
                            <div className="flex flex-col items-center min-w-[80px]">
                                <StatusIndicator status={status} />
                                <div className="mt-2 flex flex-col items-center">
                                    <StageIcon stage={stage} status={status} />
                                    <span className={`text-[10px] font-semibold mt-1 text-center leading-tight ${status === 'running' ? 'text-brand-700' :
                                            status === 'passed' ? 'text-accent-700' :
                                                status === 'failed' ? 'text-red-600' :
                                                    'text-surface-500'
                                        }`}>
                                        {STAGE_LABELS[stage]}
                                    </span>
                                    {message && (
                                        <span className="text-[9px] text-surface-500 mt-0.5 max-w-[90px] truncate text-center" title={message}>
                                            {message}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Connector line */}
                            {index < STAGE_ORDER.length - 1 && (
                                <div className="flex-1 flex items-center pt-2.5 min-w-[16px]">
                                    <div className={`h-0.5 w-full rounded-full ${getConnectorStatus(stage) === 'passed' ? 'bg-accent-400' :
                                            getConnectorStatus(stage) === 'active' ? 'bg-gradient-to-r from-brand-400 to-surface-200' :
                                                getConnectorStatus(stage) === 'failed' ? 'bg-red-300' :
                                                    'bg-surface-200'
                                        }`} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Mobile: vertical pipeline */}
            <div className="sm:hidden space-y-0">
                {STAGE_ORDER.map((stage, index) => {
                    const info = stages[stage];
                    const status = info?.status || 'pending';
                    const message = info?.message || '';

                    return (
                        <div key={stage}>
                            <div className="flex items-center gap-3 py-1.5">
                                <StatusIndicator status={status} />
                                <StageIcon stage={stage} status={status} />
                                <div className="flex-1 min-w-0">
                                    <span className={`text-xs font-semibold ${status === 'running' ? 'text-brand-700' :
                                            status === 'passed' ? 'text-accent-700' :
                                                status === 'failed' ? 'text-red-600' :
                                                    'text-surface-500'
                                        }`}>
                                        {STAGE_LABELS[stage]}
                                    </span>
                                    {message && (
                                        <p className="text-[10px] text-surface-500 truncate" title={message}>{message}</p>
                                    )}
                                </div>
                            </div>
                            {index < STAGE_ORDER.length - 1 && (
                                <div className={`ml-2.5 w-0.5 h-3 rounded-full ${getConnectorStatus(stage) === 'passed' ? 'bg-accent-400' :
                                        getConnectorStatus(stage) === 'active' ? 'bg-brand-400' :
                                            'bg-surface-200'
                                    }`} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
