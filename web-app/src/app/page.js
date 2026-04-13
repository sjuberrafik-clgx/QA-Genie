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

const heroMetrics = [
    {
        value: '7',
        title: 'Specialist agents',
        detail: 'TPM plus focused modes for tests, scripts, bugs, tasks, files, and documents.',
        Icon: SparkleIcon,
    },
    {
        value: '5',
        title: 'Workflow stages',
        detail: 'A clear path from Jira intake to execution and reporting.',
        Icon: ShieldCheckIcon,
    },
    {
        value: '1',
        title: 'Connected workspace',
        detail: 'Home, dashboard, chat, history, and reports work as one system instead of isolated pages.',
        Icon: DashboardIcon,
    },
    {
        value: 'Live',
        title: 'Grounded generation',
        detail: 'MCP exploration and project context keep outputs closer to the real application state.',
        Icon: CodeIcon,
    },
];

const workflowSignals = [
    {
        title: 'Grounded before generation',
        detail: 'MCP exploration and project context reduce guessed selectors, brittle automation, and downstream cleanup.',
    },
    {
        title: 'Designed for traceability',
        detail: 'Conversations, execution evidence, reports, and Jira actions stay linked across the workspace.',
    },
];

const pipelineStages = [
    {
        step: '01',
        name: 'Jira fetch',
        detail: 'Capture ticket intent, acceptance criteria, and constraints before generation begins.',
    },
    {
        step: '02',
        name: 'Excel create',
        detail: 'Produce optimized manual coverage in a review-ready structure.',
    },
    {
        step: '03',
        name: 'MCP explore',
        detail: 'Inspect the live application and extract grounded selectors from real UI state.',
    },
    {
        step: '04',
        name: 'Script generate',
        detail: 'Build framework-aligned Playwright automation using your existing patterns and helpers.',
    },
    {
        step: '05',
        name: 'Script execute',
        detail: 'Run the workflow, observe results, and feed failures into reporting or defect creation.',
    },
];

const platformPillars = [
    {
        title: 'Agent orchestration',
        detail: 'Purpose-built agents collaborate instead of one overloaded interface trying to do everything.',
        Icon: TPMIcon,
    },
    {
        title: 'Grounded automation',
        detail: 'Live exploration, context grounding, and framework-aware generation reduce drift and guesswork.',
        Icon: CodeIcon,
    },
    {
        title: 'Operational continuity',
        detail: 'History, reports, bugs, and task workflows remain connected to ongoing work.',
        Icon: DocumentIcon,
    },
];

const routeCards = [
    {
        title: 'Dashboard',
        detail: 'Track runs, stage progress, and execution health in one operational view.',
        href: '/dashboard',
        cta: 'Open dashboard',
        Icon: DashboardIcon,
    },
    {
        title: 'AI Chat',
        detail: 'Work with specialist agents for generation, orchestration, debugging, and review.',
        href: '/chat',
        cta: 'Launch chat',
        Icon: ChatBubbleIcon,
    },
    {
        title: 'History',
        detail: 'Return to earlier sessions, outputs, and conversation context without losing continuity.',
        href: '/history',
        cta: 'View history',
        Icon: ClockIcon,
    },
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

const agentStyleMap = {
    tpm: {
        badge: 'from-sky-600 to-blue-600',
        tint: 'bg-sky-50 text-sky-700 border-sky-100',
        glow: 'rgba(14, 116, 144, 0.14)',
    },
    document: {
        badge: 'from-blue-500 to-cyan-500',
        tint: 'bg-blue-50 text-blue-700 border-blue-100',
        glow: 'rgba(37, 99, 235, 0.14)',
    },
    code: {
        badge: 'from-emerald-500 to-teal-500',
        tint: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        glow: 'rgba(16, 185, 129, 0.14)',
    },
    bug: {
        badge: 'from-rose-500 to-red-500',
        tint: 'bg-rose-50 text-rose-700 border-rose-100',
        glow: 'rgba(225, 29, 72, 0.13)',
    },
    task: {
        badge: 'from-amber-500 to-orange-500',
        tint: 'bg-amber-50 text-amber-700 border-amber-100',
        glow: 'rgba(245, 158, 11, 0.14)',
    },
    file: {
        badge: 'from-cyan-500 to-sky-500',
        tint: 'bg-cyan-50 text-cyan-700 border-cyan-100',
        glow: 'rgba(6, 182, 212, 0.14)',
    },
    docgenie: {
        badge: 'from-indigo-500 to-violet-500',
        tint: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        glow: 'rgba(99, 102, 241, 0.14)',
    },
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

function SurfaceBadge({ Icon, badgeClassName, size = 'default' }) {
    const sizing = size === 'compact'
        ? 'h-11 w-11 rounded-2xl'
        : 'h-[3.25rem] w-[3.25rem] rounded-2xl';

    return (
        <div className={`flex ${sizing} items-center justify-center bg-gradient-to-br ${badgeClassName} text-white shadow-[0_10px_24px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.08)] ring-1 ring-white/20`}>
            <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
    );
}

function MetricCard({ value, title, detail, Icon }) {
    return (
        <div className="glass-premium rounded-[24px] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[1.85rem] font-bold leading-none tracking-[-0.06em] text-surface-900 sm:text-[2rem]" style={{ fontFamily: 'var(--font-display)' }}>
                        {value}
                    </p>
                    <p className="mt-2 text-sm font-semibold tracking-[-0.02em] text-surface-800">{title}</p>
                </div>
                <div className="icon-glass flex h-10 w-10 items-center justify-center rounded-2xl text-brand-700">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
            </div>
            <p className="mt-3 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-600">{detail}</p>
        </div>
    );
}

function QuickLinkCard({ title, detail, href, cta, Icon }) {
    return (
        <Link
            href={href}
            className="group relative flex items-start gap-4 overflow-hidden rounded-[24px] border border-surface-200/70 bg-white/80 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_20px_40px_rgba(15,23,42,0.08)]"
        >
            <div className="absolute inset-y-0 left-0 w-[3px] bg-[linear-gradient(180deg,#0f766e_0%,#2563eb_100%)] opacity-80" />
            <div className="icon-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-brand-700">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[1rem] font-semibold tracking-[-0.03em] text-surface-900" style={{ fontFamily: 'var(--font-display)' }}>
                        {title}
                    </h3>
                    <span className="hidden text-[11px] font-semibold text-brand-600 sm:inline-flex">{cta}</span>
                </div>
                <p className="mt-1.5 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-600">{detail}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-brand-600">
                    {cta}
                    <svg className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2">
                        <path d="M2.5 6h7M6.5 3l3 3-3 3" />
                    </svg>
                </span>
            </div>
        </Link>
    );
}

export default function HomePage() {
    return (
        <div className="space-y-8 lg:space-y-10">
            <section className="relative overflow-hidden rounded-[34px] border border-surface-200/80 bg-white/92 p-5 shadow-[0_26px_80px_rgba(15,23,42,0.08)] sm:p-7 xl:p-9">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_14%,rgba(15,118,110,0.11),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(37,99,235,0.12),transparent_26%),radial-gradient(circle_at_58%_84%,rgba(14,165,233,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]" />
                <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(330px,0.84fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                    <div className="space-y-6 xl:pr-4">
                        <div className="space-y-4">
                            <span className="type-kicker inline-flex items-center rounded-full border border-brand-200/70 bg-white/88 px-3 py-1.5 text-brand-700 shadow-sm">
                                QA operations home
                            </span>
                            <div className="space-y-4">
                                <h1 className="type-hero-title max-w-4xl text-[2.3rem] sm:text-[2.9rem] xl:text-[3.25rem]">
                                    A cleaner control surface for planning, generation, execution, and review.
                                </h1>
                                <p className="max-w-3xl text-[15px] font-medium leading-8 tracking-[-0.012em] text-surface-600 sm:text-[15.5px]">
                                    The home route now behaves like a product landing surface rather than a filler page. It explains how the platform operates, gives users stronger entry points into the right workflow, and keeps the visual system disciplined across dashboard, chat, history, and reporting.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/chat"
                                className="inline-flex items-center rounded-2xl bg-[linear-gradient(135deg,#0f766e_0%,#2563eb_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.18)] transition-transform duration-200 hover:-translate-y-0.5"
                            >
                                Launch AI chat
                            </Link>
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center rounded-2xl border border-surface-200 bg-white/92 px-5 py-3 text-sm font-semibold text-surface-700 shadow-sm transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50/60"
                            >
                                Open dashboard
                            </Link>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {heroMetrics.map((metric) => (
                                <MetricCard key={metric.title} {...metric} />
                            ))}
                        </div>
                    </div>

                    <div className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.9))] p-5 shadow-[0_24px_52px_rgba(15,23,42,0.07)] sm:p-6">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(15,118,110,0.14),transparent_28%),radial-gradient(circle_at_84%_18%,rgba(37,99,235,0.14),transparent_26%),radial-gradient(circle_at_52%_82%,rgba(125,211,252,0.12),transparent_26%)]" />
                        <div className="relative flex flex-col gap-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <span className="type-kicker inline-flex items-center rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-surface-500 shadow-sm">
                                        Fast entry points
                                    </span>
                                    <h2 className="mt-3 text-[1.35rem] font-bold tracking-[-0.045em] text-surface-900 sm:text-[1.55rem]" style={{ fontFamily: 'var(--font-display)' }}>
                                        Start in the surface that matches the job.
                                    </h2>
                                </div>
                                <div className="self-start rounded-[28px] border border-white/75 bg-white/62 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:self-auto">
                                    <RobotMascotLogo size={84} emphasis="hero" mood="minimal" interactive className="mx-auto" />
                                </div>
                            </div>

                            <div className="space-y-3">
                                {routeCards.map((card) => (
                                    <QuickLinkCard key={card.title} {...card} />
                                ))}
                            </div>

                            <div className="rounded-[24px] border border-white/75 bg-white/72 p-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
                                <p className="type-kicker text-surface-500">Why it feels better</p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                    {workflowSignals.map((signal) => (
                                        <div key={signal.title} className="rounded-2xl border border-surface-200/70 bg-surface-50/70 p-3.5">
                                            <h3 className="text-sm font-semibold tracking-[-0.02em] text-surface-900">{signal.title}</h3>
                                            <p className="mt-1.5 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-600">{signal.detail}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.28fr)_minmax(320px,0.72fr)]">
                <div className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/92 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.07)] sm:p-6 xl:p-7">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_14%,rgba(15,118,110,0.09),transparent_24%),radial-gradient(circle_at_90%_18%,rgba(37,99,235,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.95))]" />
                    <div className="relative space-y-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                    Agent system
                                </span>
                                <h2 className="type-section-title mt-3 max-w-2xl">Specialist modes, presented as one product instead of seven disconnected tools.</h2>
                            </div>
                            <div className="rounded-2xl border border-surface-200/70 bg-surface-50/80 px-4 py-3 text-sm font-medium text-surface-600">
                                TPM stays broad. Every other mode stays deliberate and focused.
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {AGENT_MODES.map((agent) => {
                                const agentKey = agent.value ?? 'tpm';
                                const iconKey = agent.icon ?? agentKey;
                                const Icon = agentIconMap[iconKey] ?? SparkleIcon;
                                const style = agentStyleMap[iconKey] ?? agentStyleMap.tpm;

                                return (
                                    <article
                                        key={agent.label}
                                        className="card-glow group relative overflow-hidden rounded-[24px] border border-surface-200/80 bg-white/86 p-4 shadow-[0_14px_32px_rgba(15,23,42,0.05)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)]"
                                        style={{ '--glow-color': style.glow }}
                                    >
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.46),transparent_35%)] opacity-70" />
                                        <div className="relative flex h-full flex-col gap-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <SurfaceBadge Icon={Icon} badgeClassName={style.badge} size="compact" />
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${style.tint}`}>
                                                    {agent.shortLabel}
                                                </span>
                                            </div>

                                            <div>
                                                <h3 className="text-[1.02rem] font-semibold tracking-[-0.03em] text-surface-900" style={{ fontFamily: 'var(--font-display)' }}>
                                                    {agent.label}
                                                </h3>
                                                <p className="mt-2 text-[13.5px] font-medium leading-6 tracking-[-0.01em] text-surface-600">
                                                    {agent.description}
                                                </p>
                                            </div>

                                            <div className="mt-auto rounded-2xl border border-surface-200/70 bg-surface-50/72 p-3.5">
                                                <p className="type-kicker text-surface-500">Best used for</p>
                                                <p className="mt-1.5 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-700">
                                                    {agentHighlights[agent.label] ?? 'Focused assistance inside the QA workflow.'}
                                                </p>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="grid gap-6">
                    <section className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/92 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.07)] sm:p-6">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(15,118,110,0.09),transparent_24%),radial-gradient(circle_at_84%_16%,rgba(37,99,235,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))]" />
                        <div className="relative">
                            <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                Workflow spine
                            </span>
                            <h2 className="type-section-title mt-3 text-[1.34rem]">The execution model in one glanceable sequence.</h2>

                            <div className="mt-5 space-y-3">
                                {pipelineStages.map(({ step, name, detail }, index) => (
                                    <div key={step} className="relative rounded-[22px] border border-surface-200/80 bg-white/80 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                                        {index < pipelineStages.length - 1 && (
                                            <div className="absolute left-[1.55rem] top-[3.85rem] h-[calc(100%-2.6rem)] w-px bg-[linear-gradient(180deg,rgba(15,118,110,0.22),rgba(37,99,235,0.18),transparent)]" />
                                        )}
                                        <div className="flex items-start gap-3.5">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(15,118,110,0.14),rgba(37,99,235,0.14))] text-[13px] font-bold text-brand-700 shadow-sm">
                                                {step}
                                            </div>
                                            <div>
                                                <h3 className="text-[0.96rem] font-semibold tracking-[-0.02em] text-surface-900">{name}</h3>
                                                <p className="mt-1.5 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-600">{detail}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/92 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.07)] sm:p-6">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(15,118,110,0.09),transparent_24%),radial-gradient(circle_at_82%_16%,rgba(37,99,235,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))]" />
                        <div className="relative space-y-4">
                            <div>
                                <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                    Platform principles
                                </span>
                                <h2 className="type-section-title mt-3 text-[1.34rem]">A clearer product story carried into the interface.</h2>
                            </div>
                            <div className="space-y-3">
                                {platformPillars.map(({ title, detail, Icon }) => (
                                    <div key={title} className="rounded-[22px] border border-surface-200/80 bg-white/80 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                                        <div className="flex items-start gap-4">
                                            <div className="icon-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-brand-700">
                                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                                            </div>
                                            <div>
                                                <h3 className="text-[0.98rem] font-semibold tracking-[-0.02em] text-surface-900">{title}</h3>
                                                <p className="mt-1.5 text-[13px] font-medium leading-6 tracking-[-0.01em] text-surface-600">{detail}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            </section>
        </div>
    );
}
