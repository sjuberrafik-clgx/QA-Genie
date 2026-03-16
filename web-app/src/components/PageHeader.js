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
        <div className="gradient-hero relative overflow-hidden rounded-[22px] border border-white/[0.06] px-5 py-4 sm:px-6 sm:py-[1.1rem] shadow-[0_16px_40px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)]">
            {/* Layered ambient light */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_10%_30%,rgba(255,255,255,0.12),transparent_40%),radial-gradient(ellipse_at_80%_20%,rgba(148,197,255,0.14),transparent_36%)]" />
            {/* Subtle noise texture for depth */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")', backgroundSize: '128px 128px' }} />
            {showGridBg && (
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNncmlkKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-45" />
            )}
            {/* Bottom highlight edge */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md">
                        {Icon ? (
                            <Icon className="h-4 w-4 text-white/90" />
                        ) : (
                            <svg className="h-4 w-4 text-white/90" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                            </svg>
                        )}
                    </div>
                    <div>
                        <p className="font-display text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-sky-200/60">Operations Workspace</p>
                        <h1 className="font-display text-[1.15rem] font-bold leading-[1.1] tracking-[-0.035em] text-white sm:text-[1.3rem]">{title}</h1>
                        {subtitle && (
                            <p className="mt-0.5 max-w-lg text-[0.78rem] font-medium leading-5 tracking-[-0.006em] text-slate-200/70">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">{actions}</div>}
            </div>
        </div>
    );
}
