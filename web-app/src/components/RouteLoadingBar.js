'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import BouncingLoader from '@/components/BouncingLoader';

/**
 * RouteLoadingBar — Shows a bouncing loader overlay during Next.js route transitions.
 * Mount once in the root layout. It watches pathname changes and displays
 * a brief overlay while the new page loads.
 */
export default function RouteLoadingBar() {
    const pathname = usePathname();
    const [isLoading, setIsLoading] = useState(false);
    const prevPathRef = useRef(pathname);
    const timerRef = useRef(null);

    useEffect(() => {
        if (pathname !== prevPathRef.current) {
            prevPathRef.current = pathname;
            setIsLoading(true);

            // Clear any existing timer
            if (timerRef.current) clearTimeout(timerRef.current);

            // Dismiss after a brief delay
            timerRef.current = setTimeout(() => setIsLoading(false), 600);
        }

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [pathname]);

    if (!isLoading) return null;

    return (
        <div
            className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none"
            style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(2px)',
                animation: 'fadeIn 0.15s ease-out',
            }}
        >
            <BouncingLoader size="md" label="Loading..." />
            <style jsx>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
