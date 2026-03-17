'use client';

import { useState, useRef, useEffect } from 'react';
import AllureLogo from './AllureLogo';

/**
 * AllureNavBar — Top navigation bar replicating the Allure Report 3.1.0 UI.
 * Dark bar with: Logo + "Report" dropdown (left) | Eng selector + action icons (right).
 * Also hosts the time filter, theme toggle, and refresh controls from the old PageHeader.
 */
export default function AllureNavBar({
    timeFilter,
    onTimeFilterChange,
    onRefresh,
    refreshLoading,
    themeToggle,
    timeFilters = [],
}) {
    const [reportMenuOpen, setReportMenuOpen] = useState(false);
    const menuRef = useRef(null);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setReportMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <nav className="allure-nav">
            {/* ─── Left: Logo + Report dropdown ─── */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 relative" ref={menuRef}>
                    <AllureLogo size={24} />
                    <button
                        onClick={() => setReportMenuOpen(!reportMenuOpen)}
                        className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90 hover:text-white transition-colors"
                    >
                        Report
                        <svg className={`w-3 h-3 text-white/50 transition-transform ${reportMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                    </button>

                    {/* Dropdown panel — time filter controls */}
                    {reportMenuOpen && (
                        <div className="absolute top-full left-0 mt-2 z-50 min-w-[180px] rounded-lg border border-white/10 bg-[#2a2b42] shadow-xl py-1">
                            {timeFilters.map(f => (
                                <button
                                    key={f.value}
                                    onClick={() => {
                                        onTimeFilterChange(f.value);
                                        setReportMenuOpen(false);
                                    }}
                                    className={`w-full text-left px-4 py-2 text-[12px] font-medium transition-colors
                                        ${timeFilter === f.value
                                            ? 'text-[#66bb6a] bg-white/[0.04]'
                                            : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
                                        }`}
                                >
                                    {f.label}
                                    {timeFilter === f.value && (
                                        <span className="float-right text-[#66bb6a]">✓</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Right: Eng + Icons ─── */}
            <div className="flex items-center gap-1">
                {/* Language selector */}
                <button className="allure-nav-btn flex items-center gap-1">
                    <span className="text-[12px] font-medium">Eng</span>
                    <svg className="w-3 h-3 text-white/40" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-white/10 mx-1" />

                {/* Theme toggle */}
                {themeToggle}

                {/* Divider */}
                <div className="w-px h-5 bg-white/10 mx-1" />

                {/* Refresh / reload */}
                <button
                    onClick={onRefresh}
                    disabled={refreshLoading}
                    className="allure-nav-btn"
                    title="Refresh report"
                >
                    <svg className={`w-4 h-4 ${refreshLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
                    </svg>
                </button>

                {/* Copy link icon (Allure has this) */}
                <button className="allure-nav-btn" title="Copy link">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                </button>

                {/* Share icon */}
                <button className="allure-nav-btn" title="Share">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                    </svg>
                </button>
            </div>
        </nav>
    );
}
