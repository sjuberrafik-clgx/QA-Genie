'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Results page removed - redirects to Dashboard.
 */
export default function ResultsPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/dashboard'); }, [router]);
    return null;
}
