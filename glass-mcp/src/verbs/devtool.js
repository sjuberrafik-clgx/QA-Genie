'use strict';
/**
 * GLASS · VERB `devtool` — universal Chrome DevTools Protocol passthrough.
 *
 *   devtool({ method:'Domain.command', params?:{...} })   → raw CDP result
 *   devtool({ list:true })                                 → common CDP domain families
 *
 * The escape hatch for ANY low-level browser capability a verb doesn't cover:
 * performance metrics, device/network emulation, coverage, security, memory,
 * the full accessibility tree, tracing, storage, and more. One thin, auditable
 * door instead of dozens of bespoke tools. Chromium only.
 *
 * The page's CDP session is cached (so `*.enable` calls persist), and large
 * results are truncated with a marker rather than blowing the token budget.
 *
 * @module glass-mcp/verbs/devtool
 */

const FAMILIES = ['Accessibility', 'Animation', 'CSS', 'DOM', 'Emulation', 'Fetch', 'Input', 'Log',
    'Memory', 'Network', 'Overlay', 'Page', 'Performance', 'Profiler', 'Runtime', 'Security',
    'Storage', 'Target', 'Tracing'];

function truncResult(r) {
    try {
        const s = JSON.stringify(r);
        if (s && s.length > 100000) return { _truncated: true, length: s.length, preview: s.slice(0, 100000) };
    } catch { /* circular / non-serializable — return as-is */ }
    return r;
}

async function devtoolVerb(session, args = {}) {
    await session.ensure();
    if (args.list) return { ok: true, families: FAMILIES };
    if (!args.method || typeof args.method !== 'string' || !args.method.includes('.')) {
        return { ok: false, error: "devtool requires { method:'Domain.command' } (e.g. 'Performance.getMetrics')" };
    }
    try {
        const cdp = await session.cdpFor(session.page);
        const result = await cdp.send(args.method, args.params || {});
        return { ok: true, method: args.method, result: truncResult(result) };
    } catch (e) {
        return { ok: false, method: args.method, error: e.message };
    }
}

module.exports = { devtoolVerb };
