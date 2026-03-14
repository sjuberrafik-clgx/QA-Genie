'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function useResetScrollOnRouteChange(refs = []) {
    const pathname = usePathname();

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

            refs.forEach((ref) => {
                const node = ref?.current;
                if (node && typeof node.scrollTo === 'function') {
                    node.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                }
            });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [pathname]);
}