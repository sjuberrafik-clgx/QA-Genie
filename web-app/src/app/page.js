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

const heroHighlights = [
    {
        title: '6 specialist agents',
        detail: 'A focused lineup for test cases, automation, defects, tasks, file work, and unified TPM control.',
        Icon: SparkleIcon,
    },
    {
        title: '5 workflow stages',
        detail: 'From Jira intake to execution, the system keeps the automation journey structured and visible.',
        Icon: ShieldCheckIcon,
    },
];

const pipelineStages = [
    {
        step: '01',
        name: 'Jira fetch',
        detail: 'Bring in ticket context, acceptance criteria, and workflow intent before generation starts.',
    },
    {
        step: '02',
        name: 'Excel create',
        detail: 'Generate optimized manual coverage with export-ready structure for review and collaboration.',
    },
    {
        step: '03',
        name: 'MCP explore',
        detail: 'Inspect the real application, capture snapshots, and ground selectors against live UI state.',
    },
    {
        step: '04',
        name: 'Script generate',
        detail: 'Produce Playwright automation aligned with your framework patterns, page objects, and guardrails.',
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
        detail: 'Purpose-built agents collaborate instead of forcing a single overloaded interface to do everything.',
        Icon: TPMIcon,
    },
    {
        title: 'Grounded automation',
        detail: 'Live MCP exploration, project context, and framework-aware generation reduce guesswork and drift.',
        Icon: CodeIcon,
    },
    {
        title: 'Traceable operations',
        detail: 'Dashboards, chat history, reports, and execution output stay connected in one workspace.',
        Icon: DocumentIcon,
    },
];

const routeCards = [
    {
        title: 'Dashboard',
        detail: 'Track runs, stage progress, and operational status.',
        href: '/dashboard',
        cta: 'Open dashboard',
        Icon: DashboardIcon,
    },
    {
        title: 'AI Chat',
        detail: 'Work with agents for generation, orchestration, and debugging.',
        href: '/chat',
        cta: 'Launch chat',
        Icon: ChatBubbleIcon,
    },
    {
        title: 'History',
        detail: 'Review prior conversations and session activity.',
        href: '/history',
        cta: 'View history',
        Icon: ClockIcon,
    },
];

const agentIconMap = {
    tpm: TPMIcon,
    document: DocumentIcon,
    code: CodeIcon,
    bug: BugIcon,
    task: TaskIcon,
    file: FileIcon,
};

const agentStyleMap = {
    tpm: {
        accent: 'from-sky-500/16 via-blue-500/10 to-white',
        badge: 'from-sky-600 to-blue-600',
        text: 'text-sky-800',
    },
    document: {
        accent: 'from-blue-500/14 via-cyan-400/10 to-white',
        badge: 'from-blue-500 to-cyan-500',
        text: 'text-blue-700',
    },
    code: {
        accent: 'from-emerald-500/14 via-teal-400/10 to-white',
        badge: 'from-emerald-500 to-teal-500',
        text: 'text-emerald-700',
    },
    bug: {
        accent: 'from-rose-500/14 via-red-400/10 to-white',
        badge: 'from-rose-500 to-red-500',
        text: 'text-rose-700',
    },
    task: {
        accent: 'from-amber-400/16 via-orange-300/10 to-white',
        badge: 'from-amber-500 to-orange-500',
        text: 'text-amber-700',
    },
    file: {
        accent: 'from-cyan-500/14 via-sky-400/10 to-white',
        badge: 'from-cyan-500 to-sky-500',
        text: 'text-cyan-700',
    },
};

const agentHighlights = {
    TPM: 'Unified command surface for end-to-end QA delivery.',
    TestGenie: 'Turns Jira context into review-ready test coverage.',
    ScriptGenie: 'Builds Playwright scripts from grounded exploration.',
    BugGenie: 'Converts failures into structured Jira defect tickets.',
    TaskGenie: 'Creates linked testing tasks with assignment workflows.',
    FileGenie: 'Helps organize, search, and summarize local project artifacts.',
};

function SurfaceBadge({ Icon, badgeClassName }) {
    return (
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${badgeClassName} text-white shadow-[0_14px_24px_rgba(15,23,42,0.12)]`}>
            <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
    );
}

export default function HomePage() {
    return (
        <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[32px] border border-surface-200/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.1),transparent_36%),radial-gradient(circle_at_78%_18%,rgba(37,99,235,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))]" />
                <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center">
                    <div className="space-y-5">
                        <span className="type-kicker inline-flex items-center rounded-full border border-brand-200/70 bg-white/88 px-3 py-1.5 text-brand-700 shadow-sm">
                            Platform overview
                        </span>
                        <div className="space-y-3">
                            <h1 className="type-hero-title max-w-3xl">
                                Meet the agents, system flow, and workspace structure behind your QA platform.
                            </h1>
                            <p className="max-w-2xl text-[15px] font-medium leading-8 tracking-[-0.012em] text-surface-600">
                                This home route now explains how the platform works instead of only acting as a pass-through. It introduces the specialist agents, the automation pipeline, and the shared visual system that keeps dashboard, chat, history, and reports feeling like one professional product.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center rounded-2xl bg-[linear-gradient(135deg,#0f766e_0%,#2563eb_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.18)] transition-transform duration-200 hover:-translate-y-0.5"
                            >
                                Open dashboard
                            </Link>
                            <Link
                                href="/chat"
                                className="inline-flex items-center rounded-2xl border border-surface-200 bg-white px-5 py-3 text-sm font-semibold text-surface-700 shadow-sm transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50/60"
                            >
                                Launch AI chat
                            </Link>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            {heroHighlights.map(({ title, detail, Icon }) => (
                                <div key={title} className="rounded-2xl border border-surface-200/80 bg-white/80 p-4 shadow-sm">
                                    <div className="mb-3 flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(15,118,110,0.16),rgba(37,99,235,0.14))] text-brand-700">
                                            <Icon className="h-5 w-5" strokeWidth={1.75} />
                                        </div>
                                        <span className="type-kicker text-surface-500">{title}</span>
                                    </div>
                                    <p className="type-card-body text-surface-800">{detail}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mascot-motion-surface relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.92))] p-6 shadow-[0_24px_50px_rgba(15,23,42,0.08)] sm:p-7">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(15,118,110,0.14),transparent_30%),radial-gradient(circle_at_75%_22%,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_55%_78%,rgba(125,211,252,0.12),transparent_30%)]" />
                        <div className="relative flex flex-col items-center text-center">
                            <span className="type-kicker inline-flex items-center rounded-full border border-white/75 bg-white/82 px-3 py-1.5 text-surface-500 shadow-sm">
                                Quick access
                            </span>
                            <div className="mt-5 rounded-[30px] border border-white/75 bg-white/65 px-7 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                                <RobotMascotLogo size={124} emphasis="hero" mood="minimal" interactive className="mx-auto" />
                            </div>
                            <div className="mt-5 space-y-2.5">
                                <h2 className="type-section-title mx-auto max-w-md text-center text-[1.42rem] sm:text-[1.55rem]">Start where the work begins.</h2>
                                <p className="mx-auto max-w-sm text-[14px] font-medium leading-7 tracking-[-0.01em] text-surface-600">
                                    Use these routes to move directly into execution, conversation, or review without extra navigation steps.
                                </p>
                            </div>
                            <div className="mt-6 grid w-full gap-3 sm:grid-cols-3">
                                {routeCards.map(({ title, detail, href, cta, Icon }) => (
                                    <Link key={title} href={href} className="group flex h-full flex-col rounded-2xl border border-white/75 bg-white/82 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200/70 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
                                        <div className="flex items-center gap-2 text-brand-700">
                                            <Icon className="h-4 w-4" strokeWidth={1.8} />
                                            <span className="type-kicker text-brand-700">{title}</span>
                                        </div>
                                        <p className="mt-3 text-[13.5px] font-medium leading-6 tracking-[-0.01em] text-surface-700">{detail}</p>
                                        <span className="mt-auto inline-flex pt-4 text-xs font-semibold text-brand-600 transition-transform duration-200 group-hover:translate-x-0.5">{cta}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="space-y-6">
                <div className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.07)] sm:p-7">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(15,118,110,0.1),transparent_28%),radial-gradient(circle_at_88%_20%,rgba(37,99,235,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]" />
                    <div className="relative space-y-5">
                        <div>
                            <div>
                                <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                    Agent ecosystem
                                </span>
                                <h2 className="type-section-title mt-3">Specialist agents presented with one visual language.</h2>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {AGENT_MODES.map((agent) => {
                                const agentKey = agent.value ?? 'tpm';
                                const Icon = agentIconMap[agent.icon ?? agentKey] ?? SparkleIcon;
                                const style = agentStyleMap[agent.icon ?? agentKey] ?? agentStyleMap.tpm;

                                return (
                                    <article key={agent.label} className={`mascot-motion-surface flex h-full flex-col rounded-[24px] border border-surface-200/80 bg-gradient-to-br ${style.accent} p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <SurfaceBadge Icon={Icon} badgeClassName={style.badge} />
                                            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500 shadow-sm">
                                                <RobotMascotLogo size={20} mood="minimal" interactive />
                                                Agent mode
                                            </div>
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            <h3 className="type-card-title text-[1.02rem]">{agent.label}</h3>
                                            <p className="type-card-body">{agent.description}</p>
                                        </div>
                                        <div className="mt-auto pt-4">
                                            <div className="rounded-2xl border border-white/80 bg-white/84 px-3 py-3 shadow-sm">
                                                <p className={`type-kicker ${style.text}`}>Best used for</p>
                                                <p className="mt-2 text-[13.5px] font-medium leading-6 tracking-[-0.01em] text-surface-700">{agentHighlights[agent.label] ?? 'Focused assistance within the QA workflow.'}</p>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-2">
                    <section className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(15,118,110,0.1),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(37,99,235,0.1),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.94))]" />
                        <div className="relative h-full">
                            <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                System blueprint
                            </span>
                            <h2 className="type-section-title mt-3 text-[1.34rem]">Automation stages users can understand at a glance.</h2>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                {pipelineStages.map(({ step, name, detail }) => (
                                    <div key={step} className="rounded-2xl border border-surface-200/80 bg-white/85 p-4 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(15,118,110,0.18),rgba(37,99,235,0.16))] text-sm font-bold text-surface-800">
                                                {step}
                                            </div>
                                            <div>
                                                <h3 className="type-kicker text-surface-500">{name}</h3>
                                                <p className="mt-1 text-[13.5px] font-medium leading-6 tracking-[-0.01em] text-surface-700">{detail}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="relative overflow-hidden rounded-[30px] border border-surface-200/80 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(15,118,110,0.1),transparent_26%),radial-gradient(circle_at_82%_16%,rgba(37,99,235,0.1),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.94))]" />
                        <div className="relative space-y-4 h-full">
                            <div>
                                <span className="type-kicker inline-flex items-center rounded-full border border-surface-200 bg-surface-50/90 px-3 py-1 text-surface-500">
                                    Platform pillars
                                </span>
                                <h2 className="type-section-title mt-3 text-[1.34rem]">Core system ideas carried into the interface.</h2>
                            </div>
                            <div className="space-y-3">
                                {platformPillars.map(({ title, detail, Icon }) => (
                                    <div key={title} className="rounded-2xl border border-surface-200/80 bg-white/85 p-4 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(15,118,110,0.18),rgba(37,99,235,0.14))] text-brand-700">
                                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                                            </div>
                                            <div>
                                                <h3 className="type-kicker text-surface-500">{title}</h3>
                                                <p className="mt-1 text-[13.5px] font-medium leading-6 tracking-[-0.01em] text-surface-700">{detail}</p>
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
