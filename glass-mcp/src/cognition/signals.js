'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · SIGNALS — normalise raw Glass receipts into cognition inputs
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The cognitive kernel must stay driver-neutral and pure. This module is the ONLY
 * place that knows the exact shapes emitted by see()/read()/net(); it flattens
 * them into a stable `signals` object that intent/happy-path/verdict all consume.
 * No browser, no I/O, no clock — a pure (raw → signals) transform.
 *
 * @module glass-mcp/cognition/signals
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const SPINNER_MARKERS = ['loading', 'please wait', 'just a moment', 'one moment', 'processing',
    'redirecting', 'preparing', 'fetching', 'spinner'];

const lc = (s) => String(s == null ? '' : s).toLowerCase();

/** Split a URL into lower-cased host + path + query for hint matching. */
function urlParts(url) {
    const raw = String(url || '');
    try {
        const u = new URL(raw);
        return { host: lc(u.hostname), path: lc(u.pathname), query: lc(u.search), hash: lc(u.hash), href: raw };
    } catch {
        // Non-absolute or malformed — treat the whole thing as a path.
        return { host: '', path: lc(raw), query: '', hash: '', href: raw };
    }
}

/** Count how many terms occur in a haystack; returns { count, hits[] } (deterministic order). */
function countTerms(haystack, terms) {
    const hay = lc(haystack);
    const hits = [];
    for (const t of terms) {
        if (t && hay.indexOf(lc(t)) !== -1) hits.push(t);
    }
    return { count: hits.length, hits };
}

/**
 * Normalise a perception receipt (from see()) + optional page text + runtime state
 * into the canonical signals object.
 *
 * @param {Object} input
 * @param {Object} input.perception  see() receipt: { url, title, affordances[], audit? }
 * @param {string} [input.pageText]  bounded visible text (from read({what:'text'}))
 * @param {Object} [input.runtime]   { netEvents?:[], consoleEvents?:[] }
 * @returns {Object} signals
 */
function extractSignals(input = {}) {
    const perception = input.perception || {};
    const affordances = Array.isArray(perception.affordances) ? perception.affordances : [];
    const url = perception.url || '';
    const title = perception.title || '';
    const parts = urlParts(url);

    // Affordance-derived views (stable, sorted for determinism where it matters).
    const names = affordances.map((a) => lc(a.name)).filter(Boolean);
    const kinds = {};
    for (const a of affordances) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
    // Headings/labels surfaced by perception as read-only text carry confirmation copy.
    const headings = affordances
        .filter((a) => a.kind === 'text' || a.role === 'heading' || a.role === 'status' || a.role === 'alert')
        .map((a) => lc(a.name))
        .filter(Boolean);
    const hasAlertRole = affordances.some((a) => a.role === 'alert');
    const hasStatusRole = affordances.some((a) => a.role === 'status');

    const pageText = lc(input.pageText || '');
    // A compact, deterministic "content corpus" for lexical matching: title + headings
    // + affordance names + bounded page text.
    const corpus = [title, headings.join(' '), names.join(' '), pageText].join(' \u241f ');

    // Runtime: network + console.
    const runtime = input.runtime || {};
    const netEvents = Array.isArray(runtime.netEvents) ? runtime.netEvents : [];
    const net = summariseNet(netEvents);
    const consoleEvents = Array.isArray(runtime.consoleEvents) ? runtime.consoleEvents : [];
    const consoleErrors = consoleEvents.filter((e) => e && (e.type === 'error' || e.level === 'error' || e.type === 'pageerror')).length;
    const consoleWarnings = consoleEvents.filter((e) => e && (e.type === 'warning' || e.level === 'warning' || e.type === 'warn')).length;

    // Spinner / infinite-loader heuristic: loading language present AND the page is
    // sparse (few real affordances) — a settled page rich with actions is not "loading".
    const spinnerHit = SPINNER_MARKERS.some((m) => corpus.indexOf(m) !== -1);
    const actionable = affordances.filter((a) => a.act && a.act !== 'read').length;
    const spinner = spinnerHit && actionable <= 2;

    // Form fingerprint (for form-reset / dead-end reasoning).
    const fieldCount = (kinds.field || 0) + (kinds.select || 0) + (kinds.toggle || 0);

    return {
        url,
        title,
        host: parts.host,
        path: parts.path,
        query: parts.query,
        hash: parts.hash,
        affordances,
        names,
        kinds,
        headings,
        hasAlertRole,
        hasStatusRole,
        actionable,
        fieldCount,
        pageText,
        corpus,
        spinner,
        novelty: (perception.audit && perception.audit.novelVsBaseline) || perception.novelVsBaseline || 0,
        net,
        console: { errors: consoleErrors, warnings: consoleWarnings, total: consoleEvents.length },
    };
}

/** Reduce raw net events (from net({action:'list'})) into a verdict-ready summary. */
function summariseNet(netEvents) {
    let has2xx = false, has4xx = false, has5xx = false, hasFailed = false;
    let last = null;
    const documentStatuses = [];
    for (const e of netEvents) {
        if (!e) continue;
        if (e.type === 'failed') { hasFailed = true; continue; }
        const s = Number(e.status) || 0;
        if (s >= 200 && s < 300) has2xx = true;
        else if (s >= 400 && s < 500) has4xx = true;
        else if (s >= 500) has5xx = true;
        if (e.resourceType === 'document' || e.resourceType === 'xhr' || e.resourceType === 'fetch') {
            documentStatuses.push(s);
        }
        last = { status: s, method: e.method || '', url: e.url || '', resourceType: e.resourceType || '' };
    }
    return { has2xx, has4xx, has5xx, hasFailed, last, documentStatuses, count: netEvents.length };
}

module.exports = { extractSignals, summariseNet, urlParts, countTerms, lc, SPINNER_MARKERS };
