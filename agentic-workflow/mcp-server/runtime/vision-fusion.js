/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * VISION FUSION — DOM/AX + visual perception fusion  (Phase 5 of the Cognitive Browser Runtime)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Closes the DOM's blind spots. The accessibility tree is fast and cheap but goes dark on
 * icon-only buttons, <canvas>, and semantics-less web components — exactly the elements that
 * leave generated tests unable to name or assert a control. This layer:
 *
 *   1. identifyAmbiguous()  — flags interactive elements (and canvases) with NO usable
 *                             accessible name from the DOM walk.
 *   2. gatherHints()        — one in-page pass collecting the secondary cues a vision model
 *                             perceives (icon class, child <svg><title>/<img alt>, tooltip
 *                             title, adjacent text, data-* labels).
 *   3. fuse()               — for each ambiguous element (BUDGET-CAPPED), captures an
 *                             element-region crop and asks the VisionProvider to describe it,
 *                             then attaches { visualLabel, visualConfidence, visualSource } and
 *                             fills the element's missing `name` so it becomes addressable.
 *
 * Principles:
 *   • DOM/AX is PRIMARY. Vision runs only on ambiguous elements → bounded latency/cost.
 *   • Budgeted: maxVisionCalls caps model/screenshot work per snapshot.
 *   • Transparent: every fused name carries visualSource + confidence (QA-integrity — the
 *     caller can see the name came from vision, not the DOM).
 *
 * Depends on: bridge.page (Playwright, for element-region screenshots) + a VisionProvider.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { createVisionProvider } from './vision-provider.js';

export class VisionFusion {
    /**
     * @param {object} bridge - PlaywrightDirectBridge (for page screenshots).
     * @param {object} [options]
     * @param {import('./vision-provider.js').VisionProvider} [options.provider] - Defaults to the stub.
     * @param {number} [options.maxVisionCalls=8] - Budget per fuse() call.
     * @param {boolean} [options.captureCrops=true] - Capture element-region PNGs (best-effort).
     */
    constructor(bridge, options = {}) {
        this._bridge = bridge;
        this._provider = options.provider || createVisionProvider(options);
        this._maxVisionCalls = options.maxVisionCalls ?? 8;
        this._captureCrops = options.captureCrops !== false;
        this._stats = { fused: 0, ambiguous: 0, crops: 0, cropFailures: 0, calls: 0 };
    }

    get providerName() { return this._provider.name; }
    get stats() { return { ...this._stats }; }

    /** The usable accessible name from the DOM walk, or null when the element is DOM-blind. */
    static domName(el) {
        return el.computedLabel || el.ariaLabel || el.associatedLabel || el.text || el.placeholder || el.name || null;
    }

    /**
     * Flag elements the DOM/AX tree cannot identify: interactive (or canvas) with no name.
     * @param {Array} elements - Enriched elements (from snapshotRefs values or snapshot output).
     */
    identifyAmbiguous(elements) {
        const out = [];
        for (const el of elements) {
            const isCanvas = (el.tag === 'canvas');
            const ambiguous = (el.isInteractive || isCanvas) && !VisionFusion.domName(el) && (el.selector?.cssSelector || el.ref);
            if (ambiguous) out.push(el);
        }
        return out;
    }

    /**
     * Collect secondary visual cues for the given elements in ONE in-page pass. Resolves each
     * element by its bounds via elementFromPoint (robust + unique per element) and falls back to
     * its CSS selector — important because DOM-blind controls often have weak/colliding selectors.
     * @param {Array<{css:string,bounds:object,tag:string}>} targets
     * @returns {Promise<Array<object>>} hints aligned to targets (null where not found).
     */
    async gatherHints(targets) {
        if (!targets.length) return [];
        try {
            return await this._bridge.page.evaluate((items) => {
                // Require a separator after the icon family so generic classes like "iconbtn"
                // (icon + "btn", no separator) do NOT match — only real icon tokens like
                // "icon-search" / "fa-trash" / "mdi-close".
                const ICON_RE = /\b(?:icon|fa|fas|far|fal|fab|mdi|glyphicon|bi|ph|feather)[-_]([a-z0-9]+)/i;
                const firstIconToken = (node) => {
                    const scan = [node, ...node.querySelectorAll('i,span,svg,use')];
                    for (const n of scan) {
                        const cls = (typeof n.className === 'string' ? n.className : (n.getAttribute && n.getAttribute('class'))) || '';
                        const m = cls.match(ICON_RE);
                        if (m) return m[0];
                        const useHref = n.getAttribute && (n.getAttribute('xlink:href') || n.getAttribute('href'));
                        if (useHref && /#/.test(useHref)) return useHref.split('#').pop();
                    }
                    return null;
                };
                const adjacentText = (node) => {
                    const sib = (node.previousElementSibling || node.nextElementSibling);
                    const sibTxt = sib && (sib.innerText || '').trim();
                    if (sibTxt) return sibTxt.slice(0, 80);
                    const parent = node.parentElement;
                    if (parent) {
                        const pTxt = (parent.innerText || '').trim();
                        if (pTxt) return pTxt.slice(0, 80);
                    }
                    return null;
                };
                // Resolve an element robustly: prefer its bounds center (unique on screen), then
                // anchor to the host of the expected tag / nearest interactive ancestor.
                const resolve = (item) => {
                    let node = null;
                    const b = item.bounds;
                    if (b && b.width > 0 && b.height > 0) {
                        const cx = Math.min(window.innerWidth - 1, Math.max(0, b.x + b.width / 2));
                        const cy = Math.min(window.innerHeight - 1, Math.max(0, b.y + b.height / 2));
                        const hit = document.elementFromPoint(cx, cy);
                        if (hit) {
                            node = (item.tag && hit.closest(item.tag)) ||
                                hit.closest('button,[role="button"],a,input,select,textarea,canvas') || hit;
                        }
                    }
                    if (!node && item.css) { try { node = document.querySelector(item.css); } catch { node = null; } }
                    return node;
                };
                return items.map((item) => {
                    const node = resolve(item);
                    if (!node) return null;
                    const svgTitleEl = node.querySelector ? node.querySelector('svg title, title') : null;
                    const imgEl = node.querySelector ? node.querySelector('img[alt]') : null;
                    return {
                        tag: node.tagName ? node.tagName.toLowerCase() : null,
                        role: node.getAttribute ? node.getAttribute('role') : null,
                        iconToken: firstIconToken(node),
                        svgTitle: svgTitleEl ? (svgTitleEl.textContent || '').trim() : null,
                        imgAlt: imgEl ? imgEl.getAttribute('alt') : null,
                        title: node.getAttribute ? node.getAttribute('title') : null,
                        dataLabel: node.getAttribute ? (node.getAttribute('data-label') || node.getAttribute('data-name') || node.getAttribute('data-title')) : null,
                        adjacentText: adjacentText(node),
                    };
                });
            }, targets);
        } catch {
            return targets.map(() => null);
        }
    }

    /** Capture a PNG crop of an element region (best-effort; returns base64 or null). */
    async _captureCrop(bounds) {
        if (!this._captureCrops || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
        try {
            const clip = {
                x: Math.max(0, Math.floor(bounds.x)),
                y: Math.max(0, Math.floor(bounds.y)),
                width: Math.max(1, Math.floor(bounds.width)),
                height: Math.max(1, Math.floor(bounds.height)),
            };
            const buf = await this._bridge.page.screenshot({ clip });
            this._stats.crops += 1;
            return buf.toString('base64');
        } catch {
            this._stats.cropFailures += 1;
            return null;
        }
    }

    /**
     * Fuse vision into ambiguous elements. Mutates the provided element objects in place,
     * attaching visualLabel/visualConfidence/visualSource and filling `name` when missing.
     *
     * @param {Array} elements - Enriched elements (the full set; only ambiguous ones are touched).
     * @returns {Promise<{fusedCount, ambiguousCount, budget, provider, fusions}>}
     */
    async fuse(elements) {
        const ambiguous = this.identifyAmbiguous(elements).slice(0, this._maxVisionCalls);
        this._stats.ambiguous += ambiguous.length;
        if (!ambiguous.length) {
            return { fusedCount: 0, ambiguousCount: 0, budget: this._maxVisionCalls, provider: this._provider.name, fusions: [] };
        }

        const targets = ambiguous.map((el) => ({ css: el.selector?.cssSelector || null, bounds: el.bounds, tag: el.tag }));
        const hints = await this.gatherHints(targets);
        const fusions = [];

        for (let i = 0; i < ambiguous.length; i++) {
            const el = ambiguous[i];
            const hint = hints[i] || { tag: el.tag, role: el.role };
            const imageBase64 = await this._captureCrop(el.bounds);
            this._stats.calls += 1;
            const desc = await this._provider.describe({ imageBase64, bounds: el.bounds, hints: hint }).catch(() => null);
            if (!desc || !desc.label) continue;

            el.visualLabel = desc.label;
            el.visualConfidence = desc.confidence;
            el.visualSource = desc.source;
            el.fusedName = true;
            // Fill the missing accessible name so the element becomes addressable/assertable.
            // Set ONLY computedLabel (the accessible name used for fuzzy matching) — never el.name
            // (the HTML `name` attribute), which the selector engine uses to build [name="…"]
            // selectors; overwriting it would corrupt selector generation.
            if (!VisionFusion.domName(el)) {
                el.computedLabel = desc.label;
            }
            this._stats.fused += 1;
            fusions.push({ ref: el.ref, role: el.role || el.tag, visualLabel: desc.label, confidence: desc.confidence, source: desc.source, hadCrop: !!imageBase64 });
        }

        return { fusedCount: fusions.length, ambiguousCount: ambiguous.length, budget: this._maxVisionCalls, provider: this._provider.name, fusions };
    }
}

export default VisionFusion;
