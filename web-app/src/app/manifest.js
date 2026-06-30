export default function manifest() {
    return {
        name: 'QA Automation Dashboard',
        short_name: 'Cognitive QA',
        description: 'AI-powered QA automation workspace with a consistent professional interface.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f8fc',
        theme_color: '#1c8090',
        icons: [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable',
            },
        ],
    };
}