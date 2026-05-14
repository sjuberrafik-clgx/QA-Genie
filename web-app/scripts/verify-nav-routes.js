#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const navigationFile = path.join(appRoot, 'src', 'lib', 'navigation.js');
const pageExtensions = ['js', 'jsx', 'ts', 'tsx'];

function fail(message) {
    console.error(`\n[verify-nav-routes] ${message}\n`);
    process.exit(1);
}

function extractNavRoutes(source) {
    const navItemsMatch = source.match(/export const NAV_ITEMS = \[(?<items>[\s\S]*?)\];/);
    if (!navItemsMatch?.groups?.items) {
        fail(`Could not parse NAV_ITEMS from ${navigationFile}.`);
    }

    const routes = [...navItemsMatch.groups.items.matchAll(/to:\s*['"]([^'"]+)['"]/g)]
        .map((match) => match[1])
        .filter((route) => route.startsWith('/'));

    return [...new Set(routes)];
}

function routeToPageCandidates(route) {
    if (route === '/') {
        return pageExtensions.map((extension) => path.join(appRoot, 'src', 'app', `page.${extension}`));
    }

    const segments = route.replace(/^\/+/, '').split('/').filter(Boolean);
    return pageExtensions.map((extension) => path.join(appRoot, 'src', 'app', ...segments, `page.${extension}`));
}

const navigationSource = fs.readFileSync(navigationFile, 'utf8');
const routes = extractNavRoutes(navigationSource);

const missingRoutes = routes
    .map((route) => ({ route, candidates: routeToPageCandidates(route) }))
    .filter(({ candidates }) => !candidates.some((candidate) => fs.existsSync(candidate)));

if (missingRoutes.length > 0) {
    const details = missingRoutes
        .map(({ route, candidates }) => {
            const relativeCandidates = candidates.map((candidate) => path.relative(appRoot, candidate)).join(', ');
            return `- ${route} -> expected one of: ${relativeCandidates}`;
        })
        .join('\n');

    fail(`Found navigation routes without matching Next.js pages:\n${details}`);
}

console.log(`[verify-nav-routes] Verified ${routes.length} navigation routes.`);
