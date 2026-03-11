'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import apiClient from '@/lib/api-client';
import { NAV_ITEMS, isNavActive } from '@/lib/navigation';
import LottieLogo from '@/components/LottieLogo';

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
                <div className="flex items-center gap-3">
                    <LottieLogo size={56} className="rounded-xl" />
                    <div>
                        <h1 className="text-[15px] font-bold tracking-tight leading-tight text-surface-800">QA Automation</h1>
                        <p className="text-[10px] font-medium mt-0.5 text-surface-400">AI-Powered Testing Platform</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-0.5">
                <p className="px-3 mb-2 text-[9px] font-bold text-surface-400 uppercase tracking-[0.15em]">Navigation</p>
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
                            <span className="font-medium">{label}</span>
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
                    <span className="text-[10px] text-surface-300 font-medium">v2.0</span>
                </div>
            </div>
        </aside>
    );
}
