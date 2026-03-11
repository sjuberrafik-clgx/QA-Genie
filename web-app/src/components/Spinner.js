'use client';

import BouncingLoader from '@/components/BouncingLoader';

/**
 * Spinner — Full-width centered loading spinner with optional label.
 * Now uses the elegant BouncingLoader animation.
 *
 * @param {string}  [label='Loading...'] – Text displayed below the loader
 * @param {'sm'|'md'|'lg'} [size='md']  – Loader scale: sm, md, lg
 */
export default function Spinner({ label = 'Loading...', size = 'md' }) {
    return (
        <div className="text-center py-16">
            <BouncingLoader label={label} size={size} />
        </div>
    );
}
