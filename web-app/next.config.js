const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Keep `next dev` artifacts separate from `next build` artifacts.
    // Running a production build while the dev server is open can otherwise
    // make Chrome load production client chunks against a development RSC
    // server, which crashes /chat with STATUS_BREAKPOINT.
    distDir: process.env.NEXT_DIST_DIR || '.next',

    // Disable React strict mode to avoid double-mounting SSE connections in dev.
    // Production builds are unaffected by this setting at runtime.
    reactStrictMode: false,
    outputFileTracingRoot: path.join(__dirname, '..'),

    // Perf: gzip/brotli response compression + don't ship sourcemaps to clients.
    compress: true,
    productionBrowserSourceMaps: false,

    // Perf: tree-shake named imports from these heavy packages so unused
    // submodules/themes/plugins are dropped from the client bundle.
    experimental: {
        scrollRestoration: true,
        optimizePackageImports: [
            'react-syntax-highlighter',
            'react-markdown',
            'remark-gfm',
            'remark-math',
            'rehype-katex',
            'dompurify',
        ],
    },

    // CWE-16 fix: Security response headers
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-XSS-Protection', value: '1; mode=block' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ];
    },
};

module.exports = nextConfig;
