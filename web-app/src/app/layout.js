import './globals.css';
import { Suspense } from 'react';
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';
import Sidebar from '@/components/Sidebar';
import AppShell from '@/components/AppShell';
import ErrorBoundary from '@/components/ErrorBoundary';
import RouteLoadingBar from '@/components/RouteLoadingBar';

const bodyFont = Plus_Jakarta_Sans({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-plus-jakarta',
    weight: ['400', '500', '600', '700', '800'],
});

const displayFont = Space_Grotesk({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-space-grotesk',
    weight: ['500', '600', '700'],
});

export const metadata = {
    title: 'QA Automation Dashboard',
    description: 'AI-powered QA automation platform — Powered by Doremon Team',
    manifest: '/manifest.webmanifest',
    icons: {
        icon: '/icon.svg',
        shortcut: '/icon.svg',
        apple: '/icon.svg',
        other: [
            {
                rel: 'mask-icon',
                url: '/icon.svg',
                color: '#7c3aed',
            },
        ],
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
            <body className="min-h-screen bg-surface-50">
                <div className="flex min-h-screen">
                    <Sidebar />
                    <div className="min-h-screen flex-1 overflow-x-hidden transition-[margin] duration-300 ml-[84px] sm:ml-[92px] 2xl:ml-[260px]">
                        <Suspense fallback={null}>
                            <RouteLoadingBar />
                        </Suspense>
                        <ErrorBoundary>
                            <AppShell>
                                {children}
                            </AppShell>
                        </ErrorBoundary>
                    </div>
                </div>
            </body>
        </html>
    );
}
