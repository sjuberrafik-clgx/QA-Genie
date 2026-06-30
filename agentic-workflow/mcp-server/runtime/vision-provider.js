/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * VISION PROVIDER — pluggable visual element describer  (Phase 5 of the Cognitive Browser Runtime)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Abstraction over "look at this element and tell me what it is". The fusion layer
 * (vision-fusion.js) calls describe() ONLY for elements the DOM/accessibility tree cannot
 * identify (icon-only buttons, <canvas>, semantics-less web components) — vision is a
 * fallback/booster, never the primary path.
 *
 * Two implementations:
 *   • StubVisionProvider   — deterministic, offline, ZERO model calls. Derives a label from
 *                            secondary DOM signals a vision model WOULD perceive but the
 *                            accessible-name computation ignores (child <svg><title>, child
 *                            <img alt>, icon class names, adjacent text). Makes Phase 5 fully
 *                            verifiable in CI today.
 *   • (future) LLMVisionProvider — sends imageBase64 (an element-region crop) to a multimodal
 *                            model. Drop-in: same describe() contract. Not implemented here to
 *                            keep the runtime offline-testable; wire it via createVisionProvider.
 *
 * Contract:
 *   describe({ imageBase64, bounds, hints }) -> { label, role, confidence, source } | null
 *     imageBase64 — PNG crop of the element region (provided by the fusion layer)
 *     bounds      — { x, y, width, height }
 *     hints       — secondary DOM signals gathered in-page (icon classes, child alt/title, etc.)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export class VisionProvider {
    /** @returns {Promise<{label:string, role?:string, confidence:number, source:string}|null>} */
    async describe(_input) { // eslint-disable-line no-unused-vars
        throw new Error('VisionProvider.describe() must be implemented by a subclass');
    }
    get name() { return 'abstract'; }
}

/**
 * Deterministic, offline vision stand-in. It does NOT inspect pixels; instead it interprets
 * the secondary DOM signals the fusion layer collected — the same cues a human/vision model
 * reads off the rendered icon — and returns a label + confidence. This proves the fusion
 * pipeline end-to-end without a model dependency.
 */
export class StubVisionProvider extends VisionProvider {
    get name() { return 'stub'; }

    async describe({ hints = {}, bounds } = {}) {
        // 1. An explicit icon name is the strongest cue (e.g. class="icon-search", "fa-trash").
        const iconLabel = normalizeIconToken(hints.iconToken);
        if (iconLabel) return { label: iconLabel, role: 'button', confidence: 0.9, source: 'vision:icon-class' };

        // 2. A child <svg><title> or <img alt> — the accessible name the walker missed on the host.
        if (hints.svgTitle) return { label: clean(hints.svgTitle), role: 'button', confidence: 0.88, source: 'vision:svg-title' };
        if (hints.imgAlt) return { label: clean(hints.imgAlt), role: 'button', confidence: 0.86, source: 'vision:img-alt' };

        // 3. A title attribute on the host (tooltip text — visible on hover, semantic).
        if (hints.title) return { label: clean(hints.title), role: hints.role || 'button', confidence: 0.8, source: 'vision:title' };

        // 4. An explicit author-provided descriptor (data-label/name/title) — more reliable than
        //    guessing from a neighbor, so it outranks adjacent text. Common on charts/canvases.
        if (hints.dataLabel) return { label: clean(hints.dataLabel), role: hints.role || (hints.tag === 'canvas' ? 'img' : 'button'), confidence: 0.7, source: 'vision:data-attr' };

        // 5. Adjacent/nearby text (a label rendered next to the control).
        if (hints.adjacentText) return { label: clean(hints.adjacentText), role: hints.role || 'button', confidence: 0.6, source: 'vision:adjacent-text' };

        // 6. A pure <canvas> with no signal: at least report it as a visual region so it is
        //    addressable (a real model would describe the drawing; the stub flags the type).
        if (hints.tag === 'canvas' && bounds && bounds.width > 0) {
            return { label: `canvas region ${Math.round(bounds.width)}x${Math.round(bounds.height)}`, role: 'img', confidence: 0.3, source: 'vision:canvas-shape' };
        }
        return null;
    }
}

/**
 * Factory — returns a provider based on config/env. Defaults to the deterministic stub.
 * A real multimodal provider can be registered here (e.g. when MCP_VISION_PROVIDER='llm').
 */
export function createVisionProvider(options = {}) {
    const kind = options.provider || process.env.MCP_VISION_PROVIDER || 'stub';
    switch (String(kind).toLowerCase()) {
        case 'stub':
        default:
            return new StubVisionProvider();
        // case 'llm': return new LLMVisionProvider(options);  // wired when a model is available
    }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// Map common icon tokens (from class names like "icon-search", "fa-trash", "mdi-close") to a label.
const ICON_MAP = {
    search: 'Search', close: 'Close', times: 'Close', x: 'Close', menu: 'Menu', bars: 'Menu',
    trash: 'Delete', delete: 'Delete', bin: 'Delete', edit: 'Edit', pencil: 'Edit',
    save: 'Save', download: 'Download', upload: 'Upload', heart: 'Favorite', star: 'Favorite',
    cart: 'Cart', user: 'Account', settings: 'Settings', cog: 'Settings', gear: 'Settings',
    plus: 'Add', add: 'Add', minus: 'Remove', filter: 'Filter', share: 'Share', print: 'Print',
    home: 'Home', back: 'Back', forward: 'Forward', next: 'Next', prev: 'Previous', play: 'Play',
    pause: 'Pause', info: 'Info', help: 'Help', bell: 'Notifications', calendar: 'Calendar',
};
function normalizeIconToken(token) {
    if (!token) return null;
    const t = String(token).toLowerCase().replace(/^(icon[-_]|fa[-_]|fas[-_]|far[-_]|fal[-_]|fab[-_]|mdi[-_]|glyphicon[-_]|bi[-_]|ph[-_]|feather[-_])/g, '').replace(/[-_].*$/, '');
    return ICON_MAP[t] || null;
}

export default { VisionProvider, StubVisionProvider, createVisionProvider };
