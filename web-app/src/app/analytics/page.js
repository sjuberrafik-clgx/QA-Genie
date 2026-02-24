'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Analytics page removed - redirects to Dashboard.
 */
export default function AnalyticsPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/dashboard'); }, [router]);
    return null;
}
