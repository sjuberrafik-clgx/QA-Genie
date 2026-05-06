'use client';

/**
 * AppShell — Client wrapper that composes Container + AppFooter.
 * Navigation lives in the Sidebar; no top-level header.
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import AppFooter from '@/components/AppFooter';
import AuroraBackground from '@/components/AuroraBackground';
import Container from '@/components/Container';
import { FOOTER_NAV } from '@/lib/navigation';

/* ─── Footer Navigation Links ──────────────────────────────────── */
function FooterNav() {
    return (
        <nav className="flex items-center gap-4" aria-label="Footer">
            {FOOTER_NAV.map(({ label, to }) => (
                <Link
                    key={to}
                    href={to}
                    className="text-sm text-surface-500 hover:text-surface-700 transition-colors"
                >
                    {label}
                </Link>
            ))}
        </nav>
    );
}

/* ─── Main Shell ───────────────────────────────────────────────── */
export default function AppShell({ children }) {
    const pathname = usePathname();

    // Full-bleed routes bypass Container + Footer (e.g. /chat uses its own h-screen layout)
    if (pathname === '/chat') {
        return <>{children}</>;
    }

    // Aurora intensity: richer on the landing/home surface, quieter on data-dense routes.
    const auroraIntensity = pathname === '/' ? 'high' : 'medium';

    return (
        <div className="relative flex flex-col min-h-screen">
            <AuroraBackground intensity={auroraIntensity} />
            {/* ── Main Content ── */}
            <main className="flex-1">
                <Container className="py-5 sm:py-6 lg:py-7">
                    {children}
                </Container>
            </main>

            {/* ── Separator ── */}
            <div className="mx-auto w-full max-w-[var(--ui-container)] px-4 sm:px-6 lg:px-8">
                <div className="border-t border-surface-200" />
            </div>

            {/* ── Footer ── */}
            <AppFooter
                left={
                    <p className="text-surface-400 text-sm">
                        © {new Date().getFullYear()} QA Automation
                    </p>
                }
                right={
                    <span className="text-[11px] text-surface-400 font-medium">
                        AI-Powered Testing Platform
                    </span>
                }
            >
                <FooterNav />
            </AppFooter>
        </div>
    );
}
