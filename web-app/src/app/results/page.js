'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { triggerRouteLoading } from '@/components/RouteLoadingBar';

/**
 * Results page removed - redirects to Dashboard.
 */
export default function ResultsPage() {
    const router = useRouter();
    useEffect(() => {
        triggerRouteLoading('/dashboard');
        router.replace('/dashboard');
    }, [router]);
    return null;
}
