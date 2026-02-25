import './globals.css';
import Sidebar from '@/components/Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';

export const metadata = {
    title: 'QA Automation Dashboard',
    description: 'AI-powered QA automation platform — Powered by Doremon Team',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
            </head>
            <body className="min-h-screen bg-surface-50">
                <div className="flex min-h-screen">
                    <Sidebar />
                    <main className="flex-1 ml-[260px] min-h-screen overflow-x-hidden">
                        <ErrorBoundary>
                            {children}
                        </ErrorBoundary>
                    </main>
                </div>
            </body>
        </html>
    );
}
