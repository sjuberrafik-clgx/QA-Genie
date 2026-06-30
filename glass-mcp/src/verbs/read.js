'use strict';
/**
 * GLASS · VERB `read` — read-only content extraction (no mutation, no cognition).
 *
 *   read({ what:'text'|'value'|'attribute'|'html'|'table', target, name? })
 *   read({ what:'url'|'title'|'html' })          page-level (no target)
 *   read({ what:'text' })  (no target)           the page's main text (capped)
 *
 * Where `do` changes the world, `read` observes it: it returns concrete CONTENT
 * (text, input values, attributes, table rows) for assertions — complementing
 * `see`, which returns AFFORDANCES. Targets are the same polymorphic kind the
 * other verbs accept (handle | natural name | {role,name|text|css}).
 *
 * @module glass-mcp/verbs/read
 */

const { resolveTarget } = require('../resolve');

const MAX = 20000;
const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s) || '';

async function readVerb(session, args = {}) {
    await session.ensure();
    const page = session.page;
    const what = args.what || 'text';
    const max = args.max || MAX;

    // ── Page-level reads (no target) ──────────────────────────────────────────
    if (!args.target) {
        try {
            switch (what) {
                case 'url': return { ok: true, what, value: page.url() };
                case 'title': return { ok: true, what, value: await page.title() };
                case 'html': {
                    const html = await page.content();
                    return { ok: true, what, value: cap(html, max), truncated: html.length > max };
                }
                case 'text':
                default: {
                    const text = await page.evaluate(() => (document.body ? document.body.innerText || '' : ''));
                    return { ok: true, what: 'text', text: cap(text, max), truncated: text.length > max, audit: { step: 'page' } };
                }
            }
        } catch (e) {
            return { ok: false, error: e.message, what };
        }
    }

    // ── Targeted reads ────────────────────────────────────────────────────────
    const res = await resolveTarget(page, args.target);
    if (!res.ok || !res.locator) return { ok: false, error: 'target not found', audit: res.audit };
    const loc = res.locator;
    try {
        switch (what) {
            case 'text': return { ok: true, what, text: cap(await loc.innerText(), max), audit: res.audit };
            case 'value': return { ok: true, what, value: await loc.inputValue(), audit: res.audit };
            case 'attribute': {
                if (!args.name) return { ok: false, error: "read({what:'attribute'}) requires { name }" };
                return { ok: true, what, name: args.name, value: await loc.getAttribute(args.name), audit: res.audit };
            }
            case 'html': return { ok: true, what, value: cap(await loc.innerHTML(), max), audit: res.audit };
            case 'table': return { ok: true, what, rows: await readTable(loc), audit: res.audit };
            default: return { ok: false, error: `unknown read 'what': ${what}` };
        }
    } catch (e) {
        return { ok: false, error: e.message, what, audit: res.audit };
    }
}

function readTable(loc) {
    return loc.evaluate((el) => {
        const t = el.tagName === 'TABLE' ? el : el.querySelector('table');
        if (!t) return [];
        return Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => (c.innerText || '').trim()));
    });
}

module.exports = { readVerb };
