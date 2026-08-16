'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · AGENT · HIT-POINT — in-page actionability + occlusion-checked click point
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Serialized into the page (like glassExtract): given a lightweight target
 * descriptor, it scrolls the element into view, computes the real hit-point
 * (center, verified with elementFromPoint so we never click through an overlay),
 * and reports actionability (visible / enabled / in-viewport). The DRIVER then
 * dispatches a TRUSTED event via CDP `Input` at that point — real handlers fire and
 * naive `navigator.webdriver`/synthetic-event bot checks are sidestepped.
 *
 * This is the core of the latency + accuracy win: resolution, scroll, occlusion
 * check, and actionability collapse into ONE round-trip instead of the 4–6 a naive
 * CDP (or a re-querying locator) would spend.
 *
 * Self-contained: NO references outside this function (must survive .toString()).
 *
 * @module glass-mcp/agent/hit-point
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * @param {{selector?:string, testid?:string, id?:string, text?:string, role?:string, name?:string, scroll?:boolean}} desc
 * @returns {{found:boolean, x?:number, y?:number, occluded?:boolean, visible?:boolean,
 *            enabled?:boolean, inViewport?:boolean, rect?:object, reason?:string}}
 */
function glassHitPoint(desc) {
    const d = desc || {};

    function cssEscape(s) {
        return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
    }

    function firstVisible(list) {
        for (const el of list) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return list[0] || null;
    }

    function find() {
        if (d.selector) return document.querySelector(d.selector);
        if (d.testid) {
            const t = cssEscape(d.testid);
            return document.querySelector(`[data-testid="${t}"],[data-test-id="${t}"],[data-qa="${t}"]`);
        }
        if (d.id) return document.getElementById(d.id);
        if (d.text) {
            const needle = String(d.text).trim().toLowerCase();
            const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],[role="link"],input,summary,[onclick],[tabindex]'));
            const exact = nodes.filter((el) => (el.textContent || '').trim().toLowerCase() === needle
                || (el.getAttribute('aria-label') || '').trim().toLowerCase() === needle
                || (el.value || '').trim().toLowerCase() === needle);
            if (exact.length) return firstVisible(exact);
            const partial = nodes.filter((el) => (el.textContent || '').trim().toLowerCase().indexOf(needle) === 0);
            return firstVisible(partial);
        }
        return null;
    }

    const el = find();
    if (!el) return { found: false, reason: 'no element matched descriptor' };

    if (d.scroll !== false && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ignore */ }
    }

    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0
        && style.visibility !== 'hidden' && style.display !== 'none'
        && parseFloat(style.opacity || '1') > 0;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    // Occlusion: what's actually on top at the hit-point?
    let occluded = false;
    try {
        const top = document.elementFromPoint(cx, cy);
        occluded = !(top === el || el.contains(top) || (top && top.contains(el)));
    } catch { /* elementFromPoint can throw if off-viewport */ }

    const enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const inViewport = cx >= 0 && cy >= 0 && cx <= vw && cy <= vh;

    return {
        found: true,
        x: cx,
        y: cy,
        occluded,
        visible,
        enabled,
        inViewport,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        tag: el.tagName.toLowerCase(),
    };
}

module.exports = { glassHitPoint };
