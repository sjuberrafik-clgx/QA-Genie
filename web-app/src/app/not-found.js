import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/Icons';

export default function NotFound() {
    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="text-center max-w-md px-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
                    <span className="text-2xl font-bold text-surface-300">404</span>
                </div>
                <h2 className="text-lg font-bold text-surface-900 mb-2">Page Not Found</h2>
                <p className="text-sm text-surface-500 mb-6">
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
                >
                    <ArrowLeftIcon className="w-4 h-4" />
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
