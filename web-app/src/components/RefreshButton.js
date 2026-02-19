'use client';

import { RetryIcon } from '@/components/Icons';

/**
 * RefreshButton — Reusable refresh/reload button with loading state.
 * Used in PageHeader action slots and card headers across the app.
 *
 * @param {function}  onClick   – Click handler
 * @param {boolean}   [loading] – Show loading state (spin icon + 'Loading...' text)
 * @param {string}    [label]   – Button label (default: 'Refresh')
 * @param {'header'|'card'} [variant] – Visual style variant
 */
export default function RefreshButton({ onClick, loading = false, label = 'Refresh', variant = 'header' }) {
    const styles = variant === 'card'
        ? 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-all duration-200'
        : 'px-4 py-2 text-xs font-semibold bg-white/20 text-white rounded-xl hover:bg-white/30 transition-colors disabled:opacity-50 flex items-center gap-1.5';

    return (
        <button
            onClick={onClick}
            disabled={loading}
            className={styles}
            aria-label={loading ? 'Loading' : label}
        >
            <RetryIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : label}
        </button>
    );
}
