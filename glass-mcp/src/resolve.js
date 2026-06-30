'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · RESOLVE — durable handle → live element (deterministic, ordered, audited)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-resolves a content-addressed handle against the current page, trying strategies
 * in a FIXED order and stopping at the first that yields a usable match. Replaces a
 * stateful heal-store: identity travels in the handle, so resolution is recomputed
 * fresh every time and survives re-render / navigation. Every resolution emits an
 * audit (which strategy won, candidate count, confidence) — never a silent guess.
 *
 *   1. fingerprint (data-testid / stable id)        confidence 0.95
 *   2. role + accessible name                        0.90 (single) / 0.70 (visible pick)
 *   3. structural-hash match (in-page)               0.55
 *   4. exact text                                    0.60
 *   (5. visual fallback — opt-in, not in v1)
 *
 * @module glass-mcp/resolve
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { decodeHandle, isHandle } = require('./handle');
const { glassExtract } = require('./perception/extract');

const ARIA_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch',
    'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox', 'slider',
    'spinbutton', 'treeitem', 'heading', 'img', 'list', 'listitem', 'dialog']);

function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
}

/** Build the Page or FrameLocator scope for a handle's frame path. */
function scopeFor(page, frame) {
    if (!Array.isArray(frame) || frame.length === 0) return page;
    let scope = page;
    for (const sel of frame) scope = scope.frameLocator(sel);
    return scope;
}

/** Pick the best of N matches: prefer visible + in-viewport, else first. */
async function pickBest(locator) {
    const n = await locator.count();
    if (n === 0) return { locator: null, count: 0 };
    if (n === 1) return { locator: locator.first(), count: 1 };
    // prefer the first visible one
    for (let i = 0; i < Math.min(n, 12); i++) {
        const cand = locator.nth(i);
        try {
            if (await cand.isVisible()) return { locator: cand, count: n };
        } catch { /* detached */ }
    }
    return { locator: locator.first(), count: n };
}

/**
 * Resolve a handle to a Playwright Locator.
 * @param {import('playwright').Page} page
 * @param {string} handle
 * @returns {Promise<{ok:boolean, locator?:object, audit:object}>}
 */
async function resolveHandle(page, handle) {
    const id = decodeHandle(handle);
    const scope = scopeFor(page, id.frame);
    const tried = [];

    // 1. Fingerprint: testid / stable id (strongest).
    if (id.fp && id.fp.testid) {
        const t = cssEsc(id.fp.testid);
        const loc = scope.locator(`[data-testid="${t}"], [data-test-id="${t}"], [data-qa="${t}"]`);
        const { locator, count } = await pickBest(loc);
        tried.push({ step: 'testid', count });
        if (locator) return done(locator, 'testid', count, 0.95, tried, id);
    }
    if (id.fp && id.fp.id) {
        const loc = scope.locator(`#${cssEsc(id.fp.id)}`);
        const { locator, count } = await pickBest(loc);
        tried.push({ step: 'id', count });
        if (locator) return done(locator, 'id', count, 0.9, tried, id);
    }

    // 2. Role + accessible name.
    if (id.name && ARIA_ROLES.has(id.role)) {
        try {
            const loc = scope.getByRole(id.role, { name: id.name, exact: false });
            const { locator, count } = await pickBest(loc);
            tried.push({ step: 'role+name', count });
            if (locator) return done(locator, 'role+name', count, count === 1 ? 0.9 : 0.7, tried, id);
        } catch { tried.push({ step: 'role+name', error: true }); }
    }

    // 3. Structural-hash match (re-extract in page, find element whose sph matches).
    if (id.sph) {
        const match = await page.evaluate(({ extractSrc, targetSph, role, name }) => {
            // eslint-disable-next-line no-eval
            const fn = eval('(' + extractSrc + ')');
            const { candidates } = fn({ maxElements: 2000 });
            const hits = candidates.filter((c) => c.sph === targetSph);
            const exact = hits.filter((c) => c.role === role && c.name && c.name.indexOf(name) === 0);
            return { total: hits.length, exact: exact.length };
        }, { extractSrc: glassExtract.toString(), targetSph: id.sph, role: id.role, name: id.name }).catch(() => ({ total: 0, exact: 0 }));
        tried.push({ step: 'structural-hash', count: match.total });
        // Only trust structural hash when combined with role+name as a getByText/role narrow.
        if (match.exact >= 1 && id.name) {
            try {
                const loc = ARIA_ROLES.has(id.role)
                    ? scope.getByRole(id.role, { name: id.name, exact: false })
                    : scope.getByText(id.name, { exact: true });
                const { locator, count } = await pickBest(loc);
                if (locator) return done(locator, 'structural-hash', count, 0.55, tried, id);
            } catch { /* fall through */ }
        }
    }

    // 4. Exact text.
    if (id.name) {
        const loc = scope.getByText(id.name, { exact: true });
        const { locator, count } = await pickBest(loc);
        tried.push({ step: 'text', count });
        if (locator) return done(locator, 'text', count, 0.6, tried, id);
    }

    return { ok: false, audit: { resolved: false, identity: id, tried } };
}

function done(locator, step, count, confidence, tried, id) {
    return {
        ok: true,
        locator,
        audit: { resolved: true, step, count, confidence, identity: { role: id.role, name: id.name }, tried },
    };
}

/**
 * Resolve a polymorphic target into a locator (or coordinate) for the `do`/`read` verbs.
 * Accepts: a handle, a natural-language name string, or a descriptor object
 * ({ handle | role+name | text | css | at:[x,y] }, optional frame).
 * @returns {Promise<{ok:boolean, locator?:object, at?:number[], audit:object}>}
 */
async function resolveTarget(page, target) {
    if (target == null) return { ok: false, audit: { step: 'none', error: 'no target' } };

    if (typeof target === 'string') {
        if (isHandle(target)) return resolveHandle(page, target);
        const loc = page.getByText(target, { exact: false }).first();
        return { ok: (await loc.count()) > 0, locator: loc, audit: { step: 'text', query: target } };
    }

    if (typeof target === 'object') {
        if (target.handle) return resolveHandle(page, target.handle);
        if (Array.isArray(target.at) && target.at.length === 2) {
            return { ok: true, at: target.at, audit: { step: 'coordinates', at: target.at } };
        }
        const scope = scopeFor(page, target.frame);
        if (target.css) {
            const loc = scope.locator(target.css).first();
            return { ok: (await loc.count()) > 0, locator: loc, audit: { step: 'css', query: target.css } };
        }
        if (target.role && target.name != null) {
            try {
                const loc = scope.getByRole(target.role, { name: target.name, exact: false }).first();
                return { ok: (await loc.count()) > 0, locator: loc, audit: { step: 'role+name' } };
            } catch { /* invalid role → fall through */ }
        }
        if (target.text) {
            const loc = scope.getByText(target.text, { exact: false }).first();
            return { ok: (await loc.count()) > 0, locator: loc, audit: { step: 'text', query: target.text } };
        }
        if (target.name) {
            const loc = scope.getByText(target.name, { exact: false }).first();
            return { ok: (await loc.count()) > 0, locator: loc, audit: { step: 'name-as-text', query: target.name } };
        }
    }

    return { ok: false, audit: { step: 'none', error: 'unresolvable target' } };
}

module.exports = { resolveHandle, resolveTarget, scopeFor };
