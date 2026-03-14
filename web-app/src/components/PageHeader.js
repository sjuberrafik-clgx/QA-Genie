'use client';

/**
 * PageHeader — Gradient hero banner used as the page header across all pages.
 *
 * @param {string}        title       – Primary heading text
 * @param {string|React}  subtitle    – Secondary text or ReactNode below the title
 * @param {string}        [iconPath]  – SVG `d` path for the icon (24×24 viewBox) — fallback if Icon not provided
 * @param {React.ComponentType} [Icon] – Icon component from Icons.js (preferred over iconPath)
 * @param {React.ReactNode} [actions] – Right-side slot (buttons, badges, etc.)
 * @param {boolean}       [showGridBg] – Show decorative SVG grid overlay (dashboard only)
 */
export default function PageHeader({ title, subtitle, iconPath, Icon, actions, showGridBg = false }) {
    return (
        <div className="gradient-hero relative overflow-hidden rounded-[28px] border border-[#d7e3f5]/20 px-6 py-5 sm:px-7 sm:py-5 shadow-[0_24px_52px_rgba(15,23,42,0.16)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(255,255,255,0.18),transparent_26%),radial-gradient(circle_at_82%_14%,rgba(148,197,255,0.2),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />
            {showGridBg && (
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNncmlkKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-45" />
            )}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-slate-950/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-sm">
                        {Icon ? (
                            <Icon className="h-[18px] w-[18px] text-white" />
                        ) : (
                            <svg className="h-[18px] w-[18px] text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                            </svg>
                        )}
                    </div>
                    <div className="max-w-2xl pt-0.5">
                        <p className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.22em] text-sky-100/78">Operations Workspace</p>
                        <h1 className="font-display text-[1.5rem] font-bold leading-[1] tracking-[-0.05em] text-white sm:text-[1.88rem]">{title}</h1>
                        {subtitle && (
                            <p className="mt-1.5 max-w-xl text-[0.93rem] font-medium leading-6 tracking-[-0.01em] text-slate-100/88">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
            </div>
        </div>
    );
}
