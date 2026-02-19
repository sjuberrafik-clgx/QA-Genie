'use client';

import { WarningTriangleIcon } from '@/components/Icons';

export default function GlobalError({ error, reset }) {
    return (
        <div className="flex items-center justify-center min-h-screen bg-surface-50">
            <div className="text-center max-w-md px-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
                    <WarningTriangleIcon className="w-8 h-8 text-red-400" />
                </div>
                <h2 className="text-lg font-bold text-surface-900 mb-2">Something went wrong</h2>
                <p className="text-sm text-surface-500 mb-6">
                    {error?.message || 'An unexpected error occurred. Please try again.'}
                </p>
                <button
                    onClick={() => reset()}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}
