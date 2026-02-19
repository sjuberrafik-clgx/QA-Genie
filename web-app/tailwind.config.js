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
            },
            keyframes: {},
            backgroundSize: {},
            backdropBlur: {
                xs: '2px',
            },
            boxShadow: {
                'glass': '0 1px 3px rgba(0, 0, 0, 0.06)',
                'glass-lg': '0 2px 8px rgba(0, 0, 0, 0.08)',
                'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
                'card-hover': '0 4px 12px rgba(0, 0, 0, 0.06)',
            },
        },
    },
    plugins: [],
};
