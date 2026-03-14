'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import apiClient from '@/lib/api-client';
import { NAV_ITEMS, isNavActive } from '@/lib/navigation';
import RobotMascotLogo from '@/components/RobotMascotLogo';

function ConnectionIndicator() {
    const [status, setStatus] = useState('checking'); // 'online' | 'offline' | 'checking'

    useEffect(() => {
        let mounted = true;
        const check = async () => {
            try {
                const data = await apiClient.ready();
                if (mounted) setStatus(data?.ready ? 'online' : 'offline');
            } catch {
                if (mounted) setStatus('offline');
            }
        };
        check();
        const id = setInterval(check, 30_000);
        return () => { mounted = false; clearInterval(id); };
    }, []);

    const label = status === 'online' ? 'System Online' : status === 'offline' ? 'System Offline' : 'Checking...';
    const dotClass = status === 'online' ? 'status-dot-online' : status === 'offline' ? 'status-dot-offline' : 'status-dot-connecting';

    return (
        <div className="flex items-center gap-2.5">
            <span className={`status-dot ${dotClass}`} />
            <span className="text-[11px] text-surface-500 font-medium">{label}</span>
        </div>
    );
}

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="fixed left-0 top-0 h-full w-[260px] glass-sidebar flex flex-col z-40">
            {/* Logo */}
            <div className="px-5 py-5 border-b border-surface-200">
                <Link href="/" className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40">
                    <div className="rounded-[22px] border border-surface-200/80 bg-white/80 px-3.5 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(124,58,237,0.12)]">
                        <div className="flex items-center gap-3.5">
                            <div className="relative shrink-0 rounded-[20px] bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.24),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(31,158,171,0.18),transparent_46%),linear-gradient(180deg,rgba(15,23,42,0.05),rgba(15,23,42,0.02))] p-1.5">
                                <RobotMascotLogo size={68} emphasis="hero" mood="minimal" />
                            </div>
                            <div className="min-w-0">
                                <p className="type-kicker text-brand-500/80">Cognitive QA</p>
                                <h1 className="mt-1 font-display text-[16px] font-bold leading-tight tracking-[-0.04em] text-surface-800">QA Automation</h1>
                                <p className="mt-1 text-[10.5px] font-medium leading-relaxed tracking-[-0.01em] text-surface-400">Home for agent workflows, reports, and the unified control surface.</p>
                            </div>
                        </div>
                    </div>
                </Link>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-0.5">
                <p className="type-nav-section px-3 mb-2">Navigation</p>
                {NAV_ITEMS.map(({ to, label, Icon }) => {
                    const active = isNavActive(to, pathname);
                    return (
                        <Link
                            key={to}
                            href={to}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group ${active
                                ? 'bg-brand-50 text-brand-700 shadow-sm shadow-brand-100/50 ring-1 ring-brand-200/50'
                                : 'text-surface-500 hover:bg-surface-100 hover:text-surface-800'
                                }`}
                        >
                            <span className={`transition-colors duration-150 ${active ? 'text-brand-500' : 'text-surface-400 group-hover:text-brand-500'
                                }`}>
                                <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                            </span>
                            <span className="type-nav-item">{label}</span>
                            {active && (
                                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-500" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="px-4 py-4 border-t border-surface-200">
                <ConnectionIndicator />
                <div className="mt-2.5 flex items-center justify-between">
                    <span className="type-meta-label text-surface-300">v2.0</span>
                </div>
            </div>
        </aside>
    );
}
