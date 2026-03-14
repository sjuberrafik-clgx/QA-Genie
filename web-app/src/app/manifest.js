export default function manifest() {
    return {
        name: 'QA Automation Dashboard',
        short_name: 'Cognitive QA',
        description: 'AI-powered QA automation workspace with a consistent professional interface.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#7c3aed',
        icons: [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable',
            },
            {
                src: '/apple-icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any',
            },
        ],
    };
}