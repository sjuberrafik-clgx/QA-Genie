/** @type {import('next').NextConfig} */
const nextConfig = {
    // Disable React strict mode to avoid double-mounting SSE connections in dev
    reactStrictMode: false,
};

module.exports = nextConfig;
