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
        <div className="gradient-hero rounded-2xl px-6 py-5 relative overflow-hidden">
            {showGridBg && (
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2dyaWQpIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-60" />
            )}
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                        {Icon ? (
                            <Icon className="w-5 h-5 text-white" />
                        ) : (
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                            </svg>
                        )}
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-white tracking-tight">{title}</h1>
                        {subtitle && (
                            <p className="text-xs text-white/70 mt-0.5">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex items-center gap-3">{actions}</div>}
            </div>
        </div>
    );
}
