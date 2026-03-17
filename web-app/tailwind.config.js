/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/**/*.{js,jsx}',
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: '#effcfc',
                    100: '#d5f5f6',
                    200: '#afe9ec',
                    300: '#78d6dd',
                    400: '#3abac6',
                    500: '#1f9eab',
                    600: '#1c8090',
                    700: '#1d6876',
                    800: '#205562',
                    900: '#1f4853',
                    950: '#0d2e37',
                },
                accent: {
                    50: '#ecfdf5',
                    100: '#d1fae5',
                    200: '#a7f3d0',
                    300: '#6ee7b7',
                    400: '#34d399',
                    500: '#10b981',
                    600: '#059669',
                    700: '#047857',
                },
                surface: {
                    0: '#ffffff',
                    50: '#f8fafc',
                    100: '#f1f5f9',
                    200: '#e2e8f0',
                    300: '#cbd5e1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#475569',
                    700: '#334155',
                    800: '#1e293b',
                    900: '#0f172a',
                    950: '#020617',
                },
            },
            animation: {
                'spin-slow': 'spin 3s linear infinite',
                'shimmer': 'shimmer 2.4s ease-in-out infinite',
                'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
                'float-subtle': 'float-subtle 6s ease-in-out infinite',
                'border-flow': 'border-flow 4s linear infinite',
            },
            keyframes: {
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'glow-pulse': {
                    '0%, 100%': { opacity: '0.4', transform: 'scale(0.96)' },
                    '50%': { opacity: '0.7', transform: 'scale(1.02)' },
                },
                'float-subtle': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-4px)' },
                },
                'border-flow': {
                    '0%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                    '100%': { backgroundPosition: '0% 50%' },
                },
            },
            backgroundSize: {
                '300%': '300% 300%',
            },
            backdropBlur: {
                xs: '2px',
            },
            boxShadow: {
                'glass': '0 1px 3px rgba(0, 0, 0, 0.06)',
                'glass-lg': '0 2px 8px rgba(0, 0, 0, 0.08)',
                'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
                'card-hover': '0 4px 12px rgba(0, 0, 0, 0.06)',
                'card-premium': '0 4px 16px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
                'card-premium-hover': '0 20px 40px rgba(15, 23, 42, 0.08), 0 8px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                'glow-brand': '0 0 20px rgba(15, 118, 110, 0.15), 0 0 60px rgba(37, 99, 235, 0.08)',
                'glow-accent': '0 0 20px rgba(16, 185, 129, 0.15), 0 0 60px rgba(5, 150, 105, 0.08)',
                'icon-glass': '0 4px 12px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
            },
        },
    },
    plugins: [],
};
