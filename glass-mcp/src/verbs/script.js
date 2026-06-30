'use strict';
/**
 * GLASS · VERB `script` — evaluate JS in the page (audited, opt-in power).
 *
 *   script({ expression:'location.href' })             evaluate an expression
 *   script({ fn:'(x)=>x*2', args:[21] })               call a function with args
 *   script({ target, fn:'(el)=>el.textContent' })      evaluate with the element as 1st arg
 *
 * The deterministic surface (see/do/read) covers most needs; `script` is the
 * escape hatch for bespoke in-page logic. Results must be JSON-serializable
 * (non-serializable values come back as undefined, per the DevTools protocol).
 * Powerful by design — every call is echoed in the receipt for auditing.
 *
 * @module glass-mcp/verbs/script
 */

const { resolveTarget } = require('../resolve');

const safe = (v) => (typeof v === 'string' && v.length > 100000 ? v.slice(0, 100000) : v);

async function scriptVerb(session, args = {}) {
    await session.ensure();
    const page = session.page;
    try {
        if (args.target) {
            const fn = args.fn || args.expression;
            if (!fn) return { ok: false, error: 'script with a target requires { fn }' };
            const res = await resolveTarget(page, args.target);
            if (!res.ok || !res.locator) return { ok: false, error: 'target not found', audit: res.audit };
            const result = await res.locator.evaluate(
                // eslint-disable-next-line no-eval
                (el, { src, a }) => { const f = eval('(' + src + ')'); return f(el, ...(a || [])); },
                { src: String(fn), a: args.args || [] }
            );
            return { ok: true, result: safe(result), audit: res.audit };
        }
        if (args.fn) {
            const result = await page.evaluate(
                // eslint-disable-next-line no-eval
                ({ src, a }) => { const f = eval('(' + src + ')'); return f(...(a || [])); },
                { src: String(args.fn), a: args.args || [] }
            );
            return { ok: true, result: safe(result) };
        }
        if (args.expression) {
            // eslint-disable-next-line no-eval
            const result = await page.evaluate((src) => eval(src), String(args.expression));
            return { ok: true, result: safe(result) };
        }
        return { ok: false, error: 'script requires { expression } or { fn }' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = { scriptVerb };
