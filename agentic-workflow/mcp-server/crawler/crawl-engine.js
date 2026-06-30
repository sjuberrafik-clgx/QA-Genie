/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * AUTONOMOUS CRAWL ENGINE  (Pillar 3)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A deterministic, server-side site crawler/mapper that explores an application with
 * full DevTools instrumentation — WITHOUT an LLM in the loop and WITHOUT bloating the
 * agent context. It performs a breadth-first, in-scope crawl and, per page, captures:
 *
 *   • a compact perception map (interactive elements + ranked selectors + headings + forms)
 *   • console errors/warnings and uncaught page errors (from the bridge ring buffers)
 *   • a network summary (totals, failures, slowest requests, resource-type breakdown)
 *   • Core Web Vitals / navigation timing (TTFB, FCP, LCP, DCL, load) via Performance API
 *   • an accessibility audit summary (violation count + sample rules)
 *
 * The full SITE MODEL is persisted to exploration-data/ (a disk handle); the tool returns
 * only a compact summary + the path, so traversal of dozens of pages costs ~0 agent tokens.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPLORATION_DIR = path.resolve(__dirname, '..', '..', 'exploration-data');

const DEFAULTS = {
    maxPages: 12,
    maxDepth: 2,
    sameOrigin: true,
    dismissPopups: true,
    budgetMs: 120000,
    settleMs: 5000,
    devtools: { network: true, console: true, performance: true, accessibility: true },
};

const SKIP_LINK_RE = /^(mailto:|tel:|javascript:|blob:|data:)/i;
const ASSET_EXT_RE = /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|css|js|ico|woff2?|ttf|eot|csv|xlsx?|docx?)(\?|#|$)/i;

function normalizeUrl(href) {
    try {
        const u = new URL(href);
        u.hash = '';
        return u.toString();
    } catch {
        return href;
    }
}

function inScope(href, startOrigin, opts) {
    if (!href || SKIP_LINK_RE.test(href)) return false;
    let u;
    try { u = new URL(href); } catch { return false; }
    if (!/^(https?|file):$/.test(u.protocol)) return false;
    if (ASSET_EXT_RE.test(u.pathname)) return false;
    // file:// origin is "null" for every file URL, so bound local crawls to the
    // start directory to avoid wandering the filesystem.
    if (u.protocol === 'file:') {
        if (opts._startDir && !normalizeUrl(href).startsWith(opts._startDir)) return false;
    } else if (opts.sameOrigin && u.origin !== startOrigin) {
        return false;
    }
    if (opts.scopePath && !u.pathname.startsWith(opts.scopePath)) return false;
    if (opts.includePattern && !opts._includeRe.test(href)) return false;
    if (opts.excludePattern && opts._excludeRe.test(href)) return false;
    return true;
}

function compileRe(pattern) {
    if (!pattern) return null;
    try { return new RegExp(pattern, 'i'); } catch { return null; }
}

async function collectPerf(page) {
    return page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paints = performance.getEntriesByType('paint');
        const fcp = paints.find((p) => p.name === 'first-contentful-paint');
        const lcpList = performance.getEntriesByType('largest-contentful-paint');
        const lcp = lcpList.length ? lcpList[lcpList.length - 1] : null;
        const round = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n) : null);
        return {
            ttfbMs: nav ? round(nav.responseStart) : null,
            domContentLoadedMs: nav ? round(nav.domContentLoadedEventEnd) : null,
            loadMs: nav ? round(nav.loadEventEnd) : null,
            firstContentfulPaintMs: fcp ? round(fcp.startTime) : null,
            largestContentfulPaintMs: lcp ? round(lcp.startTime) : null,
        };
    }).catch(() => null);
}

function summarizeNetwork(net) {
    const byType = {};
    const statusCounts = {};
    const failed = [];
    for (const r of net) {
        byType[r.resourceType || 'other'] = (byType[r.resourceType || 'other'] || 0) + 1;
        if (r.status != null) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
        if ((r.status && r.status >= 400) || r.failure) failed.push(r);
    }
    const slowest = net
        .filter((r) => typeof r.duration === 'number')
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((r) => ({ url: String(r.url).slice(0, 120), ms: Math.round(r.duration), status: r.status }));
    return {
        total: net.length,
        failed: failed.length,
        failedSamples: failed.slice(0, 5).map((r) => ({ url: String(r.url).slice(0, 120), status: r.status || null, error: r.failure || null })),
        byType,
        statusCounts,
        slowest,
    };
}

function summarizeA11y(audit) {
    if (!audit) return null;
    const v = audit.violations || audit.issues || (audit.results && audit.results.violations);
    if (Array.isArray(v)) {
        return { violations: v.length, samples: v.slice(0, 5).map((x) => x.id || x.rule || x.description).filter(Boolean) };
    }
    if (typeof audit.violationCount === 'number') return { violations: audit.violationCount };
    return null;
}

async function capturePage(bridge, url, depth, opts) {
    const navStart = Date.now();
    const nav = await bridge.navigate({ url });
    if (opts.dismissPopups) await bridge.dismissKnownPopups().catch(() => { });
    await bridge.page.waitForLoadState('networkidle', { timeout: opts.settleMs }).catch(() => { });

    const snap = await bridge.snapshot({ useCache: false });
    const elements = snap.elements || [];
    const links = await bridge.page
        .evaluate(() => Array.from(document.querySelectorAll('a[href]'), (a) => a.href))
        .catch(() => []);

    const interactive = elements.filter((e) => e.interactive);
    const formControls = elements.filter((e) => /textbox|combobox|checkbox|radio|searchbox|listbox|spinbutton|slider/.test(e.role || ''));
    const headings = elements
        .filter((e) => /^h[1-6]$/.test(e.tag || '') || e.role === 'heading')
        .map((e) => e.name)
        .filter(Boolean)
        .slice(0, 10);

    // DevTools signals — read per-page deltas from the bridge ring buffers.
    const consoleErrors = opts.devtools.console
        ? bridge._consoleMessages.filter((m) => m.timestamp >= navStart && (m.type === 'error' || m.type === 'warning'))
        : [];
    const pageErrors = bridge._pageErrors.filter((e) => e.timestamp >= navStart);
    const net = opts.devtools.network
        ? [...bridge._networkRequests.values()].filter((r) => r.timestamp >= navStart)
        : [];

    const perf = opts.devtools.performance ? await collectPerf(bridge.page) : null;
    let a11y = null;
    if (opts.devtools.accessibility && typeof bridge.accessibilityAudit === 'function') {
        a11y = summarizeA11y(await bridge.accessibilityAudit().catch(() => null));
    }

    return {
        url: nav.url || url,
        depth,
        title: nav.title || snap.title || null,
        elementCount: snap.elementCount,
        interactiveCount: interactive.length,
        formControls: formControls.length,
        headings,
        // Ranked, validated selectors for the most useful interactive elements —
        // this is what feeds test generation. Capped to keep the model lean.
        keySelectors: interactive
            .filter((e) => e.selector)
            .slice(0, 25)
            .map((e) => ({ name: e.name || null, role: e.role, selector: e.selector, ambiguous: e.ambiguous || false })),
        links: links.length,
        console: { errors: consoleErrors.length, samples: consoleErrors.slice(0, 3).map((m) => String(m.text || '').slice(0, 160)) },
        pageErrors: { count: pageErrors.length, samples: pageErrors.slice(0, 2).map((e) => String(e.message || '').slice(0, 160)) },
        network: opts.devtools.network ? summarizeNetwork(net) : undefined,
        performance: perf || undefined,
        accessibility: a11y || undefined,
        blocker: snap.blockerState && snap.blockerState.present ? (snap.blockerState.blocker?.kind || 'present') : undefined,
        _links: links,
    };
}

function slugForUrl(url) {
    try {
        const u = new URL(url);
        return (u.hostname + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
    } catch {
        return 'site';
    }
}

/**
 * Crawl a site starting from startUrl, capturing a DevTools-instrumented site model.
 *
 * @param {object} bridge  PlaywrightDirectBridge instance (live page).
 * @param {object} args    Crawl options (see DEFAULTS + tool schema).
 * @returns {Promise<object>} Compact summary + path to the persisted site model.
 */
export async function crawlSite(bridge, args = {}) {
    const startUrl = args.startUrl || args.url;
    if (!startUrl) throw new Error('crawl requires a startUrl');

    const opts = {
        ...DEFAULTS,
        ...args,
        devtools: { ...DEFAULTS.devtools, ...(args.devtools || {}) },
        _includeRe: compileRe(args.includePattern),
        _excludeRe: compileRe(args.excludePattern),
    };

    let startOrigin;
    try { startOrigin = new URL(startUrl).origin; } catch { throw new Error(`Invalid startUrl: ${startUrl}`); }
    // Directory of the start URL — used to bound file:// crawls.
    try {
        const d = new URL(startUrl);
        d.hash = ''; d.search = '';
        d.pathname = d.pathname.replace(/[^/]*$/, '');
        opts._startDir = d.toString();
    } catch { opts._startDir = null; }

    await bridge.ensureConnected?.();

    const frontier = [{ url: startUrl, depth: 0 }];
    const visited = new Set();
    const pages = [];
    const startedAt = Date.now();
    const deadline = startedAt + opts.budgetMs;

    while (frontier.length && pages.length < opts.maxPages && Date.now() < deadline) {
        const { url, depth } = frontier.shift();
        const norm = normalizeUrl(url);
        if (visited.has(norm)) continue;
        visited.add(norm);

        try {
            const summary = await capturePage(bridge, url, depth, opts);
            const links = summary._links || [];
            delete summary._links;
            pages.push(summary);

            if (depth < opts.maxDepth) {
                for (const link of links) {
                    const ln = normalizeUrl(link);
                    if (!visited.has(ln) && inScope(link, startOrigin, opts)) {
                        frontier.push({ url: link, depth: depth + 1 });
                    }
                }
            }
        } catch (err) {
            pages.push({ url, depth, error: String(err.message || err) });
        }
    }

    const durationMs = Date.now() - startedAt;
    const totals = pages.reduce(
        (acc, p) => {
            acc.consoleErrors += p.console?.errors || 0;
            acc.pageErrors += p.pageErrors?.count || 0;
            acc.networkFailed += p.network?.failed || 0;
            acc.interactive += p.interactiveCount || 0;
            return acc;
        },
        { consoleErrors: 0, pageErrors: 0, networkFailed: 0, interactive: 0 }
    );

    const siteModel = {
        source: 'mcp-live-crawl',
        startUrl,
        generatedAt: new Date().toISOString(),
        config: {
            maxPages: opts.maxPages,
            maxDepth: opts.maxDepth,
            sameOrigin: opts.sameOrigin,
            scopePath: opts.scopePath || null,
            devtools: opts.devtools,
        },
        stats: { pagesVisited: pages.length, frontierRemaining: frontier.length, durationMs, ...totals },
        pages,
    };

    // Persist the full model to disk (a handle), keep the tool result tiny.
    await fs.mkdir(EXPLORATION_DIR, { recursive: true });
    const fileName = `${slugForUrl(startUrl)}-crawl-${Date.now()}.json`;
    const savedPath = path.join(EXPLORATION_DIR, fileName);
    await fs.writeFile(savedPath, JSON.stringify(siteModel, null, 2), 'utf8');

    return {
        ok: true,
        startUrl,
        pagesVisited: pages.length,
        durationMs,
        savedTo: path.relative(path.resolve(__dirname, '..', '..', '..'), savedPath).replace(/\\/g, '/'),
        totals,
        // One compact line per page — enough to reason about coverage & health
        // without loading the full model into context.
        pages: pages.map((p) => ({
            url: p.url,
            depth: p.depth,
            title: p.title,
            interactive: p.interactiveCount,
            forms: p.formControls,
            links: p.links,
            consoleErrors: p.console?.errors,
            networkFailed: p.network?.failed,
            lcpMs: p.performance?.largestContentfulPaintMs,
            a11yViolations: p.accessibility?.violations,
            blocker: p.blocker,
            error: p.error,
        })),
        hint: 'Full site model (per-page selectors, network, console, perf, a11y) saved to savedTo. Read it for deep details.',
    };
}

export const CRAWL_TOOL_DEFINITION = {
    name: 'unified_crawl',
    description: 'Autonomously crawl a site in-scope (breadth-first) with full DevTools instrumentation — NO LLM in the loop. Per page it captures interactive elements + ranked selectors, headings, forms, console errors, a network summary, Core Web Vitals, and an accessibility audit. The full site model is saved to exploration-data/ and the tool returns only a compact per-page summary + the file path (near-zero context cost). Use for site mapping, coverage discovery, health checks, and feeding test generation.',
    inputSchema: {
        type: 'object',
        properties: {
            startUrl: { type: 'string', description: 'URL to start crawling from.' },
            maxPages: { type: 'number', description: 'Maximum pages to visit. Default 12.' },
            maxDepth: { type: 'number', description: 'Maximum link depth from the start page. Default 2.' },
            sameOrigin: { type: 'boolean', description: 'Restrict to the start URL origin. Default true.' },
            scopePath: { type: 'string', description: 'Optional path prefix to stay within (e.g. "/en-US/properties").' },
            includePattern: { type: 'string', description: 'Optional regex; only crawl links matching it.' },
            excludePattern: { type: 'string', description: 'Optional regex; never crawl links matching it.' },
            dismissPopups: { type: 'boolean', description: 'Auto-dismiss known popups on each page. Default true.' },
            budgetMs: { type: 'number', description: 'Overall time budget in ms. Default 120000.' },
            devtools: {
                type: 'object',
                description: 'Toggle DevTools captures: { network, console, performance, accessibility }. All default true.',
            },
        },
        required: ['startUrl'],
    },
    _meta: { source: 'custom', category: 'exploration', readOnly: true },
};
