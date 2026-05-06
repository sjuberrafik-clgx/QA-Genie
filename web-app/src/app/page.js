import Link from 'next/link';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import { AGENT_MODES } from '@/lib/agent-options';
import {
    BugIcon,
    ChatBubbleIcon,
    ClockIcon,
    CodeIcon,
    DashboardIcon,
    DocumentIcon,
    FileIcon,
    ShieldCheckIcon,
    SparkleIcon,
    TaskIcon,
    TPMIcon,
} from '@/components/Icons';

/* ─── Data ─────────────────────────────────────────────────────── */

const heroMetrics = [
    { value: '7', title: 'Specialist agents', detail: 'TPM + focused modes for tests, scripts, bugs, tasks, files, and documents.', Icon: SparkleIcon },
    { value: '5', title: 'Workflow stages', detail: 'Jira intake → generation → execution → reporting, linked end-to-end.', Icon: ShieldCheckIcon },
    { value: '1', title: 'Connected workspace', detail: 'Home, dashboard, chat, history, and reports behave as one product.', Icon: DashboardIcon },
    { value: 'Live', title: 'Grounded generation', detail: 'MCP exploration + project context keep outputs aligned with real UI.', Icon: CodeIcon },
];

const pipelineStages = [
    { step: '01', name: 'Jira fetch', detail: 'Capture ticket intent, acceptance criteria, and constraints.' },
    { step: '02', name: 'Excel create', detail: 'Produce optimized manual coverage in a review-ready structure.' },
    { step: '03', name: 'MCP explore', detail: 'Inspect the live application and extract grounded selectors.' },
    { step: '04', name: 'Script generate', detail: 'Build framework-aligned Playwright automation with real patterns.' },
    { step: '05', name: 'Script execute', detail: 'Run, observe, and feed results into reporting or defects.' },
];

const platformPillars = [
    { title: 'Agent orchestration', detail: 'Purpose-built agents collaborate instead of one overloaded interface.', Icon: TPMIcon },
    { title: 'Grounded automation', detail: 'Live exploration, context grounding, framework-aware generation — less drift.', Icon: CodeIcon },
    { title: 'Operational continuity', detail: 'History, reports, bugs, and tasks stay linked to the work in motion.', Icon: DocumentIcon },
];

const routeCards = [
    { title: 'Dashboard', detail: 'Track runs, stage progress, and execution health in one operational view.', href: '/dashboard', cta: 'Open dashboard', Icon: DashboardIcon, preview: 'stages' },
    { title: 'AI Chat', detail: 'Work with specialist agents for generation, orchestration, debugging, and review.', href: '/chat', cta: 'Launch chat', Icon: ChatBubbleIcon, preview: 'prompt' },
    { title: 'History', detail: 'Return to earlier sessions, outputs, and conversation context without losing state.', href: '/history', cta: 'View history', Icon: ClockIcon, preview: 'runs' },
];

const agentIconMap = {
    tpm: TPMIcon,
    document: DocumentIcon,
    docgenie: DocumentIcon,
    code: CodeIcon,
    bug: BugIcon,
    task: TaskIcon,
    file: FileIcon,
};

const agentGradientMap = {
    tpm: 'from-violet-500 via-indigo-500 to-blue-600',
    document: 'from-sky-500 via-blue-500 to-indigo-500',
    code: 'from-emerald-500 via-teal-500 to-cyan-500',
    bug: 'from-rose-500 via-red-500 to-orange-500',
    task: 'from-amber-400 via-orange-500 to-rose-500',
    file: 'from-cyan-500 via-sky-500 to-blue-500',
    docgenie: 'from-fuchsia-500 via-violet-500 to-indigo-500',
};

const agentGlowMap = {
    tpm: 'rgba(99, 102, 241, 0.28)',
    document: 'rgba(37, 99, 235, 0.24)',
    code: 'rgba(16, 185, 129, 0.26)',
    bug: 'rgba(244, 63, 94, 0.24)',
    task: 'rgba(245, 158, 11, 0.26)',
    file: 'rgba(14, 165, 233, 0.26)',
    docgenie: 'rgba(168, 85, 247, 0.26)',
};

const agentHighlights = {
    TPM: 'Run end-to-end QA orchestration from one command surface.',
    TestGenie: 'Turn Jira context into optimized review-ready test coverage.',
    ScriptGenie: 'Generate grounded Playwright automation from live exploration.',
    BugGenie: 'Convert failures into structured Jira defect tickets with context.',
    TaskGenie: 'Create linked tasks, subtasks, and assignment-ready work items.',
    FileGenie: 'Search, organize, and summarize local project artifacts.',
    DocGenie: 'Transform workbooks and briefs into decks, reports, and visuals.',
};

/* ─── Building blocks ──────────────────────────────────────────── */

function SurfaceBadge({ Icon, gradient, size = 'default' }) {
    const sizing = size === 'compact' ? 'h-11 w-11 rounded-2xl' : 'h-[3.25rem] w-[3.25rem] rounded-[20px]';
    return (
        <div className={`flex ${sizing} items-center justify-center bg-gradient-to-br ${gradient} text-white shadow-[0_10px_24px_rgba(15,23,42,0.2),0_2px_6px_rgba(15,23,42,0.08)] ring-1 ring-white/25`}>
            <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
    );
}

function Kicker({ children, tone = 'neutral' }) {
    const tint = tone === 'light' ? 'text-white/70' : 'text-surface-600';
    return <span className={`kicker-accent ${tint}`}>{children}</span>;
}

function MetricTile({ value, title, detail, Icon }) {
    return (
        <article className="glass-subpanel hover-sheen motion-lift motion-fast-colors relative overflow-hidden p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="mono-accent text-[2.1rem] font-bold leading-none tracking-[-0.05em] text-surface-900 sm:text-[2.3rem]">
                        {value}
                    </p>
                    <p className="mt-2 text-[0.95rem] font-semibold tracking-[-0.015em] text-surface-800">{title}</p>
                </div>
                <div className="icon-glass flex h-10 w-10 items-center justify-center rounded-2xl text-brand-700">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
            </div>
            <p className="mt-3 text-[13px] leading-[1.55] text-surface-500">{detail}</p>
            <svg className="mt-4 h-7 w-full opacity-70" viewBox="0 0 120 28" fill="none" aria-hidden="true">
                <defs>
                    <linearGradient id="spark-metric" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(37,99,235,0.4)" />
                        <stop offset="100%" stopColor="rgba(37,99,235,0)" />
                    </linearGradient>
                </defs>
                <path d="M0 22 L15 18 L30 20 L45 14 L60 16 L75 10 L90 12 L105 6 L120 4" stroke="rgb(37,99,235)" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M0 22 L15 18 L30 20 L45 14 L60 16 L75 10 L90 12 L105 6 L120 4 L120 28 L0 28 Z" fill="url(#spark-metric)" />
            </svg>
        </article>
    );
}

function RoutePreview({ kind }) {
    if (kind === 'stages') {
        return (
            <div className="flex items-center gap-1.5">
                {['01', '02', '03', '04', '05'].map((step, i) => (
                    <span key={step} className={`mono-accent rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${i < 3 ? 'bg-brand-50 text-brand-700' : 'bg-surface-100 text-surface-400'}`}>
                        {step}
                    </span>
                ))}
                <span className="live-dot ml-1 scale-75" />
            </div>
        );
    }
    if (kind === 'prompt') {
        return (
            <div className="rounded-xl bg-surface-50/80 px-3 py-2 font-mono text-[11px] leading-5 text-surface-600 ring-1 ring-surface-200/70">
                <span className="text-brand-600">@testgenie</span> generate test cases for <span className="text-emerald-600">AOTF-16339</span>...
            </div>
        );
    }
    if (kind === 'runs') {
        return (
            <div className="flex items-center gap-1.5">
                {['bg-emerald-400', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400', 'bg-surface-300'].map((c, i) => (
                    <span key={i} className={`h-1.5 w-5 rounded-full ${c}`} />
                ))}
                <span className="mono-accent ml-1 text-[10px] text-surface-500">last 5</span>
            </div>
        );
    }
    return null;
}

function RouteCard({ title, detail, href, cta, Icon, preview }) {
    return (
        <Link href={href} className="glass-panel hover-sheen motion-lift motion-fast-colors group relative flex flex-col gap-4 overflow-hidden p-5 sm:p-6">
            <div className="absolute inset-y-0 left-0 w-[3px] bg-[linear-gradient(180deg,#0f766e_0%,#2563eb_50%,#6366f1_100%)] opacity-80" />
            <div className="flex items-start justify-between gap-3">
                <div className="icon-glass flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-brand-700">
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <span className="mono-accent inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700 ring-1 ring-white/70">
                    {cta}
                </span>
            </div>
            <div>
                <h3 className="text-[1.15rem] font-bold tracking-[-0.03em] text-surface-900">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-surface-600">{detail}</p>
            </div>
            <div className="mt-auto pt-3">
                <RoutePreview kind={preview} />
            </div>
            <span className="absolute bottom-5 right-5 text-brand-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8h10M10 4l4 4-4 4" />
                </svg>
            </span>
        </Link>
    );
}

function AgentOrbit() {
    const ringAgents = AGENT_MODES.filter((a) => a.value !== null).slice(0, 6);
    const angleStep = 360 / ringAgents.length;
    return (
        <div className="agent-orbit" aria-hidden="true">
            <div className="agent-orbit__ring" />
            <div className="agent-orbit__ring agent-orbit__ring--inner" />
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="agent-orbit__core rounded-[32px] bg-white/80 p-5 shadow-[0_20px_60px_rgba(37,99,235,0.2)] ring-1 ring-white/70 backdrop-blur-xl">
                    <RobotMascotLogo size={120} emphasis="hero" mood="glossy" interactive />
                </div>
            </div>
            <div className="agent-orbit__badges">
                {ringAgents.map((agent, i) => {
                    const angle = angleStep * i;
                    const iconKey = agent.icon ?? 'document';
                    const Icon = agentIconMap[iconKey] ?? SparkleIcon;
                    const gradient = agentGradientMap[iconKey] ?? agentGradientMap.document;
                    return (
                        <div
                            key={agent.label}
                            className="agent-orbit__badge"
                            style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translate(calc(50% + 120px))` }}
                            title={`${agent.label} — ${agent.description ?? ''}`}
                        >
                            <div
                                className="agent-orbit__badge-inner"
                                style={{ transform: `rotate(${-angle}deg)` }}
                            >
                                <div className={`flex h-full w-full items-center justify-center rounded-[18px] bg-gradient-to-br ${gradient}`}>
                                    <Icon className="h-5 w-5 text-white" strokeWidth={1.75} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AgentBentoTile({ agent, featured = false }) {
    const iconKey = agent.icon ?? 'document';
    const Icon = agentIconMap[iconKey] ?? SparkleIcon;
    const gradient = agentGradientMap[iconKey] ?? agentGradientMap.document;
    const glow = agentGlowMap[iconKey] ?? 'rgba(37,99,235,0.2)';
    return (
        <article
            className={`glass-panel hover-sheen motion-lift motion-fast-colors card-glow group relative overflow-hidden ${featured ? 'p-6 sm:p-7 lg:col-span-2' : 'p-5'}`}
            style={{ '--glow-color': glow }}
        >
            {featured && (
                <div className="absolute inset-0 opacity-80" style={{ background: 'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.14), transparent 42%), radial-gradient(circle at 80% 80%, rgba(37,99,235,0.12), transparent 42%)' }} />
            )}
            <div className="relative flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <SurfaceBadge Icon={Icon} gradient={gradient} size={featured ? 'default' : 'compact'} />
                    <span className="mono-accent inline-flex items-center gap-1.5 rounded-full bg-white/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-700 ring-1 ring-white/70">
                        <span className="live-dot live-dot-idle scale-75" />
                        {agent.shortLabel}
                    </span>
                </div>
                <div>
                    <h3 className={`font-bold tracking-[-0.03em] text-surface-900 ${featured ? 'text-[1.55rem]' : 'text-[1.1rem]'}`}>
                        {agent.label}
                    </h3>
                    <p className={`mt-2 leading-6 text-surface-600 ${featured ? 'text-[14.5px]' : 'text-[13px]'}`}>
                        {agent.description}
                    </p>
                </div>
                <div className="glass-subpanel mt-auto p-3.5">
                    <p className="kicker-accent text-surface-500">Best used for</p>
                    <p className="mt-1.5 text-[13px] leading-[1.55] text-surface-700">
                        {agentHighlights[agent.label] ?? 'Focused assistance inside the QA workflow.'}
                    </p>
                </div>
            </div>
        </article>
    );
}

/* ─── Page ─────────────────────────────────────────────────────── */

export default function HomePage() {
    const featuredAgent = AGENT_MODES.find((a) => a.value === null);
    const otherAgents = AGENT_MODES.filter((a) => a.value !== null);

    return (
        <div className="motion-page-rich space-y-10 sm:space-y-14 lg:space-y-16">
            {/* ═══ Section 1 — Hero dome ═══ */}
            <section className="glass-panel motion-enter relative overflow-hidden p-6 sm:p-9 xl:p-12">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_8%_10%,rgba(15,118,110,0.14),transparent_38%),radial-gradient(ellipse_at_92%_8%,rgba(37,99,235,0.16),transparent_36%),radial-gradient(ellipse_at_60%_100%,rgba(99,102,241,0.10),transparent_40%)]" />
                <div className="relative grid gap-10 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
                    <div className="space-y-7">
                        <Kicker>QA operations home</Kicker>
                        <h1 className="type-mega-title max-w-4xl">
                            <span className="thin">A cleaner</span>{' '}
                            <span className="accent">control surface</span>{' '}
                            <span className="thin">for</span> planning, generation, execution, and review.
                        </h1>
                        <p className="max-w-2xl text-[15.5px] leading-[1.75] text-surface-600 sm:text-[16px]">
                            The home route behaves like a product landing surface, not a filler page. It explains how the platform operates, gives stronger entry points into the right workflow, and keeps the visual system disciplined across dashboard, chat, history, and reporting.
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                            <Link href="/chat" className="action-primary cta-magnetic">
                                Launch AI chat
                                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 8h10M10 4l4 4-4 4" />
                                </svg>
                            </Link>
                            <Link href="/dashboard" className="action-secondary motion-lift">
                                Open dashboard
                            </Link>
                            <span className="mono-accent inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-200/70 backdrop-blur">
                                <span className="live-dot scale-75" />
                                System ready
                            </span>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {heroMetrics.map((metric) => (
                                <MetricTile key={metric.title} {...metric} />
                            ))}
                        </div>
                    </div>

                    <div className="relative flex flex-col items-center justify-center gap-6">
                        <AgentOrbit />
                        <div className="glass-subpanel max-w-xs px-5 py-3 text-center">
                            <p className="kicker-accent text-surface-500">Agent constellation</p>
                            <p className="mt-1.5 text-[13px] leading-[1.55] text-surface-600">
                                Click any badge to jump directly into chat with that specialist preselected.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══ Section 2 — Start here command rail ═══ */}
            <section className="motion-enter motion-enter-delay-1 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Kicker>Start here</Kicker>
                        <h2 className="mt-3 text-[1.9rem] font-bold tracking-[-0.04em] text-surface-900 sm:text-[2.2rem]">
                            Three entry points, one product.
                        </h2>
                    </div>
                    <p className="max-w-md text-[14px] leading-[1.65] text-surface-500">
                        Pick the surface that matches the job. Conversation, execution, and history stay linked across every run.
                    </p>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                    {routeCards.map((card) => (
                        <RouteCard key={card.title} {...card} />
                    ))}
                </div>
            </section>

            {/* ═══ Section 3 — Agent constellation (bento) ═══ */}
            <section className="motion-enter motion-enter-delay-2 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Kicker>Agent system</Kicker>
                        <h2 className="mt-3 max-w-2xl text-[1.9rem] font-bold tracking-[-0.04em] text-surface-900 sm:text-[2.2rem]">
                            Specialist modes, presented as one product.
                        </h2>
                    </div>
                    <div className="glass-subpanel max-w-sm px-4 py-3 text-[13px] leading-6 text-surface-600">
                        TPM stays broad. Every other mode stays deliberate and focused.
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {featuredAgent && <AgentBentoTile agent={featuredAgent} featured />}
                    {otherAgents.map((agent) => (
                        <AgentBentoTile key={agent.label} agent={agent} />
                    ))}
                </div>
            </section>

            {/* ═══ Section 4 — Workflow spine timeline ═══ */}
            <section className="glass-panel motion-enter motion-enter-delay-3 relative overflow-hidden p-6 sm:p-9">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_14%_20%,rgba(15,118,110,0.10),transparent_36%),radial-gradient(ellipse_at_86%_20%,rgba(37,99,235,0.10),transparent_36%)]" />
                <div className="relative space-y-7">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <Kicker>Workflow spine</Kicker>
                            <h2 className="mt-3 text-[1.8rem] font-bold tracking-[-0.04em] text-surface-900 sm:text-[2rem]">
                                The execution model in one glanceable sequence.
                            </h2>
                        </div>
                        <span className="mono-accent self-start rounded-full bg-white/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-600 ring-1 ring-white/70 sm:self-auto">
                            5 stages · linked end-to-end
                        </span>
                    </div>
                    <div className="hidden lg:block">
                        <div className="relative">
                            <div className="absolute left-6 right-6 top-9 h-[2px] bg-[linear-gradient(90deg,rgba(15,118,110,0.4),rgba(37,99,235,0.4),rgba(99,102,241,0.4))]" />
                            <div className="grid grid-cols-5 gap-4">
                                {pipelineStages.map(({ step, name, detail }) => (
                                    <div key={step} className="relative">
                                        <div className="relative z-10 mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-white shadow-[0_12px_28px_rgba(37,99,235,0.2)] ring-1 ring-white">
                                            <div className="mono-accent flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 via-blue-500 to-indigo-500 text-base font-bold text-white">
                                                {step}
                                            </div>
                                        </div>
                                        <div className="glass-subpanel motion-lift mt-4 p-4 text-center">
                                            <h3 className="text-[0.95rem] font-bold tracking-[-0.02em] text-surface-900">{name}</h3>
                                            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-surface-600">{detail}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3 lg:hidden">
                        {pipelineStages.map(({ step, name, detail }, index) => (
                            <div key={step} className="glass-subpanel relative p-4">
                                {index < pipelineStages.length - 1 && (
                                    <div className="absolute left-[1.75rem] top-[4rem] h-[calc(100%-2.5rem)] w-px bg-[linear-gradient(180deg,rgba(15,118,110,0.35),rgba(37,99,235,0.3),transparent)]" />
                                )}
                                <div className="flex items-start gap-4">
                                    <div className="mono-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 via-blue-500 to-indigo-500 text-[13px] font-bold text-white shadow-md">
                                        {step}
                                    </div>
                                    <div>
                                        <h3 className="text-[0.98rem] font-bold tracking-[-0.02em] text-surface-900">{name}</h3>
                                        <p className="mt-1.5 text-[13px] leading-[1.55] text-surface-600">{detail}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══ Section 5 — Platform principles ═══ */}
            <section className="motion-enter motion-enter-delay-3 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Kicker>Platform principles</Kicker>
                        <h2 className="mt-3 max-w-2xl text-[1.9rem] font-bold tracking-[-0.04em] text-surface-900 sm:text-[2.2rem]">
                            A clearer product story, carried into the interface.
                        </h2>
                    </div>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                    {platformPillars.map(({ title, detail, Icon }) => (
                        <div key={title} className="glass-panel hover-sheen motion-lift p-6">
                            <div className="icon-glass flex h-12 w-12 items-center justify-center rounded-2xl text-brand-700">
                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                            </div>
                            <h3 className="mt-4 text-[1.1rem] font-bold tracking-[-0.025em] text-surface-900">{title}</h3>
                            <p className="mt-2 text-[13.5px] leading-[1.65] text-surface-600">{detail}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ═══ Section 6 — Footer CTA band ═══ */}
            <section className="motion-enter motion-enter-delay-3 relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(118deg,#0f3d52_0%,#155e75_36%,#1d4f91_100%)] p-8 sm:p-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_12%_20%,rgba(15,118,110,0.35),transparent_40%),radial-gradient(ellipse_at_88%_24%,rgba(99,102,241,0.28),transparent_42%),radial-gradient(ellipse_at_50%_100%,rgba(14,165,233,0.22),transparent_48%)]" />
                <div className="relative flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
                    <div className="max-w-2xl space-y-3">
                        <Kicker tone="light">Ready when you are</Kicker>
                        <h2 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.04em] text-white sm:text-[2.4rem]">
                            One workspace for the whole QA motion.
                        </h2>
                        <p className="text-[15px] leading-[1.7] text-white/75">
                            Start a conversation, launch a pipeline, or open the dashboard — everything stays linked across the workspace.
                        </p>
                    </div>
                    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                        <div className="relative rounded-[28px] border border-white/15 bg-white/[0.06] p-3 backdrop-blur-md">
                            <RobotMascotLogo size={88} emphasis="hero" mood="glossy" interactive />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Link href="/chat" className="cta-magnetic inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-surface-900 shadow-lg">
                                Launch AI chat
                            </Link>
                            <Link href="/dashboard" className="inline-flex items-center justify-center rounded-2xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur hover:bg-white/15">
                                Open dashboard
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
