/**
 * navigation.js — Centralized navigation items & page metadata.
 * Used by Sidebar, AppShell, and mobile menu to stay in sync.
 */

import {
    HomeIcon,
    DashboardIcon,
    ChatBubbleIcon,
    ClockIcon,
    DocumentIcon,
    ExplorerIcon,
    SparkleIcon,
} from '@/components/Icons';

/** Primary navigation items shown in sidebar and mobile menu */
export const NAV_ITEMS = [
    { label: 'Home', to: '/', Icon: HomeIcon },
    { label: 'Dashboard', to: '/dashboard', Icon: DashboardIcon },
    { label: 'AI Chat', to: '/chat', Icon: ChatBubbleIcon },
    { label: 'My Agents', to: '/my-agents', Icon: SparkleIcon },
    { label: 'Studio', to: '/studio', Icon: ExplorerIcon },
    { label: 'History', to: '/history', Icon: ClockIcon },
    { label: 'Reports', to: '/reports', Icon: DocumentIcon },
];

/** Footer navigation links */
export const FOOTER_NAV = [];

/** Page title + subtitle map for the contextual header */
export const PAGE_TITLES = {
    '/': { title: 'Home', subtitle: 'Platform overview' },
    '/dashboard': { title: 'Dashboard', subtitle: 'Operations and workflow status' },
    '/chat': { title: 'AI Chat', subtitle: 'Conversation workspace' },
    '/my-agents': { title: 'My Agents', subtitle: 'Custom agents from your workspaces' },
    '/studio': { title: 'Agent Studio', subtitle: 'Isolated custom workspaces' },
    '/history': { title: 'Chat History', subtitle: 'Session archive' },
    '/reports': { title: 'Test Reports', subtitle: 'Reporting and quality insights' },
    '/results': { title: 'Test Results', subtitle: 'Detailed run output' },
};

/**
 * Check if a nav item is active given the current pathname.
 * @param {string} itemTo   – the nav item's `to` path
 * @param {string} pathname – current route pathname
 */
export function isNavActive(itemTo, pathname) {
    if (!pathname) return false;
    if (itemTo === '/') return pathname === '/';
    return pathname === itemTo || pathname.startsWith(itemTo + '/');
}
