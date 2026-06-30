'use strict';
/**
 * GLASS · VERB `wait` — block until a condition holds (bounded, audited).
 *
 *   wait({ for:'visible'|'hidden'|'attached'|'detached'|'enabled', target, timeout? })
 *   wait({ for:'text', value, target?, timeout? })      text appears (in target, else page)
 *   wait({ for:'url'|'title', value, timeout? })         matches (substring | /regex/ | glob)
 *   wait({ for:'load'|'domcontentloaded'|'networkidle', timeout? })
 *   wait({ for:'timeout', value }) | wait({ ms })        explicit delay (escape hatch)
 *
 * Prefer condition-based waits over fixed delays: they're faster and less flaky.
 * `timeout` is fixed (not an explicit sleep) — a deterministic upper bound.
 *
 * @module glass-mcp/verbs/wait
 */

const { resolveTarget } = require('../resolve');
const { urlPredicate } = require('../match');

async function pollUntil(timeout, fn) {
    const end = Date.now() + timeout;
    for (;;) {
        if (await fn()) return;
        if (Date.now() > end) throw new Error('condition not met within timeout');
        await new Promise((r) => setTimeout(r, 100));
    }
}

async function targetLocator(page, target) {
    const res = await resolveTarget(page, target);
    if (!res.ok || !res.locator) return { err: { ok: false, error: 'target not found', audit: res.audit } };
    return { loc: res.locator };
}

async function waitVerb(session, args = {}) {
    await session.ensure();
    const page = session.page;
    const timeout = args.timeout || 15000;
    const forCond = args.for || (args.ms != null ? 'timeout' : 'load');
    const t0 = Date.now();

    try {
        switch (forCond) {
            case 'visible':
            case 'hidden':
            case 'attached':
            case 'detached': {
                const { loc, err } = await targetLocator(page, args.target);
                if (err) return err;
                await loc.waitFor({ state: forCond, timeout });
                break;
            }
            case 'enabled': {
                const { loc, err } = await targetLocator(page, args.target);
                if (err) return err;
                await loc.waitFor({ state: 'visible', timeout });
                await pollUntil(timeout, () => loc.isEnabled());
                break;
            }
            case 'text': {
                const needle = String(args.value == null ? '' : args.value);
                if (args.target) {
                    const { loc, err } = await targetLocator(page, args.target);
                    if (err) return err;
                    await loc.filter({ hasText: needle }).first().waitFor({ state: 'visible', timeout });
                } else {
                    await page.getByText(needle, { exact: false }).first().waitFor({ state: 'visible', timeout });
                }
                break;
            }
            case 'url': {
                const pred = urlPredicate(args.value);
                await pollUntil(timeout, () => pred(page.url()));
                break;
            }
            case 'title': {
                const needle = String(args.value == null ? '' : args.value);
                await pollUntil(timeout, async () => (await page.title()).includes(needle));
                break;
            }
            case 'load':
            case 'domcontentloaded':
            case 'networkidle': {
                await page.waitForLoadState(forCond, { timeout });
                break;
            }
            case 'timeout': {
                const ms = Math.min(Number(args.value == null ? args.ms || 0 : args.value), 60000);
                await page.waitForTimeout(ms);
                break;
            }
            default:
                return { ok: false, error: `unknown wait 'for': ${forCond}` };
        }
    } catch (e) {
        return { ok: false, for: forCond, error: e.message, waitedMs: Date.now() - t0 };
    }
    return { ok: true, for: forCond, waitedMs: Date.now() - t0 };
}

module.exports = { waitVerb };
