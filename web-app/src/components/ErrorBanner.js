'use client';

import { ExclamationIcon, XIcon } from './Icons';

/**
 * ErrorBanner — Dismissable red error banner used across all pages.
 *
 * @param {string}   error      – Error message to display
 * @param {function} onDismiss  – Callback when the dismiss button is clicked
 * @param {string}   [className] – Optional extra wrapper class names
 */
export default function ErrorBanner({ error, onDismiss, className = '' }) {
    if (!error) return null;

    return (
        <div className={`bg-red-50 border border-red-200/80 text-red-700 px-4 py-2.5 rounded-xl text-sm flex items-center justify-between shadow-sm ${className}`}>
            <div className="flex items-center gap-2">
                <ExclamationIcon className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="font-medium">{error}</span>
            </div>
            {onDismiss && (
                <button
                    onClick={onDismiss}
                    className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-100/50 transition-colors"
                >
                    <XIcon className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
