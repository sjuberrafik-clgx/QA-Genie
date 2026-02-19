'use client';

/**
 * Spinner — Full-width centered loading spinner with optional label.
 *
 * @param {string} [label='Loading...'] – Text displayed below the spinner
 * @param {'sm'|'md'} [size='md']      – Spinner diameter: sm = 16px, md = 24px
 */
export default function Spinner({ label = 'Loading...', size = 'md' }) {
    const sizeClass = size === 'sm' ? 'w-4 h-4 border' : 'w-6 h-6 border-2';

    return (
        <div className="text-center py-16">
            <div className={`${sizeClass} mx-auto border-brand-200 border-t-brand-500 rounded-full animate-spin mb-3`} />
            {label && <p className="text-sm text-surface-500">{label}</p>}
        </div>
    );
}
