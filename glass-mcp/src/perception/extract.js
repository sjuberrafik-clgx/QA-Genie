'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · EXTRACT — single-pass in-page affordance walker
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Runs ONCE in the page (page.evaluate) and returns raw affordance candidates with
 * cheap, layout-light features. Descends open shadow roots + same-origin iframes.
 * Emits ACTIONS (interactive elements, roles of interest, headings, maps) — not a
 * full DOM serialization. Node then scores/clusters/packs (salience.js, pack.js).
 *
 * The in-page fnv1a is byte-identical to handle.js fnv1a, so structural hashes
 * computed here match what Node expects (parity-tested).
 *
 * @module glass-mcp/perception/extract
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Self-contained function serialized into the page by Playwright. NO outer refs.
 * @param {{maxElements?:number, maxFrameDepth?:number}} opts
 */
function glassExtract(opts) {
    const MAX = (opts && opts.maxElements) || 1500;
    const MAX_FRAME_DEPTH = (opts && opts.maxFrameDepth) || 4;

    // ── FNV-1a 32-bit (parity with Node handle.js) ──────────────────
    function fnv1a(str) {
        let h = 0x811c9dc5;
        const s = String(str);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
    const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
        'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox',
        'slider', 'spinbutton', 'treeitem']);
    const LANDMARKS = [['header', 'header'], ['nav', 'nav'], ['main', 'main'], ['aside', 'aside'],
    ['footer', 'footer'], ['[role=dialog]', 'dialog'], ['[role=alertdialog]', 'dialog'], ['form', 'form']];

    function implicitRole(el, tag, type) {
        if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
        if (tag === 'button' || tag === 'summary') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'input') {
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
            if (type === 'range') return 'slider';
            if (type === 'search') return 'searchbox';
            if (type === 'hidden') return 'none';
            return 'textbox';
        }
        if (/^h[1-6]$/.test(tag)) return 'heading';
        return null;
    }

    function roleOf(el, tag, type) {
        const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
        return explicit || implicitRole(el, tag, type) || 'generic';
    }

    function accessibleName(el) {
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const labelledby = el.getAttribute('aria-labelledby');
        if (labelledby) {
            const txt = labelledby.split(/\s+/).map((id) => {
                const n = (el.getRootNode() || document).getElementById(id);
                return n ? n.textContent : '';
            }).join(' ').trim();
            if (txt) return txt;
        }
        if (el.id) {
            const root = el.getRootNode() || document;
            const lbl = root.querySelector && root.querySelector('label[for="' + CSS.escape(el.id) + '"]');
            if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
        }
        const closestLabel = el.closest && el.closest('label');
        if (closestLabel && closestLabel.textContent.trim()) return closestLabel.textContent.trim();
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            if (el.placeholder) return el.placeholder.trim();
            if (el.value && el.type !== 'password') return '';
        }
        if (tag === 'img' && el.alt) return el.alt.trim();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
        const title = el.getAttribute('title');
        if (title && title.trim()) return title.trim();
        // Icon-only affordance: derive a name from the glyph (svg <title>/<use>, icon-font class, data-icon).
        const icon = iconName(el);
        if (icon) return icon;
        return '';
    }

    function classify(el, tag, role, interactive, iconHint) {
        const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
        if (tag === 'canvas' || /\b(mapboxgl|leaflet|maplibregl|gm-style|ol-viewport)\b/.test(String(cls))) {
            return { kind: 'map', act: 'click' };
        }
        if (tag === 'img' || tag === 'video' || tag === 'audio' || role === 'img') return { kind: 'media', act: 'read' };
        if (/^h[1-6]$/.test(tag) || role === 'heading') return { kind: 'text', act: 'read' };
        if (role === 'link' || tag === 'a') return { kind: 'link', act: 'navigate' };
        if (role === 'textbox' || role === 'searchbox' || tag === 'textarea' ||
            (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type))) {
            return { kind: 'field', act: 'type' };
        }
        if (role === 'checkbox' || role === 'switch' || role === 'radio' ||
            role === 'menuitemcheckbox' || role === 'menuitemradio') return { kind: 'toggle', act: 'toggle' };
        if (role === 'combobox' || tag === 'select') return { kind: 'select', act: 'select' };
        if (role === 'option') return { kind: 'option', act: 'click' };
        if (role === 'tab') return { kind: 'tab', act: 'click' };
        if (role === 'menuitem' || role === 'menu') return { kind: 'menu', act: 'click' };
        if (role === 'button' || tag === 'button' || tag === 'summary') return { kind: 'button', act: 'click' };
        // interactive container with no standard role: an icon glyph reads as a button,
        // a larger clickable region reads as the "card" pattern.
        if (interactive) return { kind: iconHint ? 'button' : 'card', act: 'click' };
        return { kind: 'text', act: 'read' };
    }

    function isInteractive(el, tag, role) {
        if (INTERACTIVE_TAGS.has(tag)) return !(tag === 'a' && !el.hasAttribute('href'));
        if (INTERACTIVE_ROLES.has(role)) return true;
        if (el.hasAttribute('onclick')) return true;
        // Common JS-framework click affordance markers (no listener introspection needed).
        if (el.hasAttribute('data-action') || el.hasAttribute('data-toggle') || el.hasAttribute('data-click')) return true;
        const hp = el.getAttribute('aria-haspopup');
        if (hp && hp !== 'false') return true;
        const ti = el.getAttribute('tabindex');
        if (ti != null && parseInt(ti, 10) >= 0) return true;
        if (el.isContentEditable) return true;
        return false;
    }

    // ── Deterministic clickable-icon heuristics (no vision, no CDP) ──
    function classString(el) {
        const raw = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
        return String(raw);
    }
    // Icon-font / layout tokens that are NOT the icon's meaning (skip when deriving a name).
    const SKIP_ICON_TOKEN = /^(fa|fas|far|fal|fab|fad|solid|regular|light|thin|duotone|brands|fw|lg|sm|md|xs|xl|1x|2x|3x|4x|5x|spin|pulse|border|inverse|stack|pull-left|pull-right|btn|button|wrapper|container|inline|block|left|right|center|small|large|default|primary|secondary|active|disabled|selected|open|closed|show|hide|hidden|visible|circle|square|round|rounded|link|text)$/i;
    function selfIsIcon(el) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'svg' || tag === 'i') return true;
        return /(^|\s)(icon|material-icons|glyphicon)(\s|$)|icon[-_]|[-_]icon(\s|$)|(^|\s)fa-/i.test(classString(el));
    }
    function containsIcon(el) {
        const kids = el.children || [];
        for (let i = 0; i < kids.length && i < 8; i++) if (selfIsIcon(kids[i])) return true;
        return false;
    }
    function isIconic(el) { return selfIsIcon(el) || containsIcon(el); }
    const SUGGESTIVE = /(^|[-_\s])(btn|button|clickable|close|dismiss|menu|toggle|expand|collapse|chevron|caret|arrow|hamburger|kebab|action|trigger)([-_\s]|$)/i;
    function suggestiveClickable(el) {
        if (el.hasAttribute('data-action') || el.hasAttribute('data-toggle') || el.hasAttribute('data-click')) return true;
        return SUGGESTIVE.test(classString(el));
    }
    // Gate: bound getComputedStyle to leaf / icon-ish / suggestive elements only (perf).
    function maybeClickable(el) {
        const n = el.children ? el.children.length : 0;
        return n <= 3 || isIconic(el) || suggestiveClickable(el);
    }
    // cursor:pointer that ORIGINATES at el (parent not pointer) = the clickable boundary.
    function cursorClickable(el) {
        let cs;
        try { cs = getComputedStyle(el); } catch (e) { return false; }
        if (!cs || cs.cursor !== 'pointer' || cs.pointerEvents === 'none') return false;
        const p = el.parentElement;
        if (p) {
            try { const ps = getComputedStyle(p); if (ps && ps.cursor === 'pointer') return false; } catch (e) { /* ignore */ }
        }
        return true;
    }
    // Phase 3: computed-style visibility (display:none is already 0x0-filtered).
    function cssHidden(el) {
        let cs;
        try { cs = getComputedStyle(el); } catch (e) { return false; }
        if (!cs) return false;
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
        if (cs.display === 'none') return true;
        if (parseFloat(cs.opacity) === 0) return true;
        return false;
    }
    // Phase 4: deterministic occlusion via hit-test (top document + in-viewport only).
    function occludedAt(el, rect) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cy < 0 || cx >= (window.innerWidth || 0) || cy >= (window.innerHeight || 0)) return false;
        let top;
        try { top = document.elementFromPoint(cx, cy); } catch (e) { return false; }
        if (!top || top === el) return false;
        if (el.contains(top) || top.contains(el)) return false;
        return true;
    }
    function humanize(s) {
        return String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    // Derive a human name for an icon-only affordance (svg <title>/<use>, data-icon, icon-font class).
    function iconName(el) {
        const svg = (el.tagName && el.tagName.toLowerCase() === 'svg') ? el : (el.querySelector && el.querySelector('svg'));
        if (svg && svg.querySelector) {
            const t = svg.querySelector('title');
            if (t && t.textContent && t.textContent.trim()) return t.textContent.trim().slice(0, 40);
            const use = svg.querySelector('use');
            if (use) {
                const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
                const m = href.match(/#(?:icon[-_])?([a-z0-9][a-z0-9-]*)/i);
                if (m) return humanize(m[1]);
            }
        }
        const di = el.getAttribute('data-icon');
        if (di) return humanize(di);
        let cls = classString(el);
        if (el.querySelector) {
            const ic = el.querySelector('i[class], span[class], svg[class], use');
            if (ic) cls += ' ' + classString(ic);
        }
        const re = /(?:^|\s)(?:fa-|icon-|glyphicon-)([a-z0-9-]+)/ig;
        let m;
        while ((m = re.exec(cls))) { if (!SKIP_ICON_TOKEN.test(m[1])) return humanize(m[1]); }
        const m2 = cls.match(/(?:^|\s)icon[-_]([a-z0-9]+(?:[-_][a-z0-9]+)*)/i);
        if (m2 && !SKIP_ICON_TOKEN.test(m2[1])) return humanize(m2[1]);
        return '';
    }

    function isDynamicToken(t) {
        return /^css-[a-z0-9]{4,}/i.test(t) || /[a-f0-9]{6,}/i.test(t) ||
            /__[a-z0-9]{4,}/i.test(t) || /[-_][a-z0-9]{6,}$/i.test(t);
    }
    function stableClasses(el) {
        const raw = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
        return String(raw).trim().split(/\s+/).filter((c) => c && c.length <= 24 && !isDynamicToken(c)).slice(0, 2);
    }
    function stableToken(el) {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').trim();
        return tag + (role ? '#' + role : '') + stableClasses(el).map((c) => '.' + c).join('');
    }
    function structuralHash(el) {
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 6) {
            parts.push(stableToken(cur));
            cur = cur.parentElement || (cur.getRootNode() && cur.getRootNode().host) || null;
            depth++;
        }
        return fnv1a(parts.join('>'));
    }

    function regionOf(el) {
        for (const [sel, name] of LANDMARKS) {
            if (el.closest && el.closest(sel)) return name;
        }
        return 'main';
    }

    function inViewport(rect) {
        return rect.width > 0 && rect.height > 0 &&
            rect.bottom > 0 && rect.right > 0 &&
            rect.top < (window.innerHeight || 0) && rect.left < (window.innerWidth || 0);
    }

    function nameQuality(name, kind) {
        if (!name) return kind === 'map' || kind === 'media' ? 0.3 : 0;
        if (name.length < 2) return 0.3;
        if (/^[\W\d]+$/.test(name)) return 0.4; // only symbols/digits
        return 1;
    }

    function fingerprint(el) {
        const fp = {};
        const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-qa');
        if (testid) fp.testid = testid;
        if (el.id && !isDynamicToken(el.id)) fp.id = el.id;
        if ((el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') && el.placeholder) {
            fp.placeholder = el.placeholder;
        }
        const href = el.getAttribute('href');
        if (href && href.length < 64) fp.href = href;
        if (el.tagName.toLowerCase() === 'input' && el.type) fp.type = el.type;
        return fp;
    }

    function frameSelector(el) {
        const testAttrs = ['data-testid', 'data-test-id', 'data-qa'];
        for (const attr of testAttrs) {
            const value = el.getAttribute(attr);
            if (value) return `iframe[${attr}="${CSS.escape(value)}"]`;
        }
        if (el.id && !isDynamicToken(el.id)) return 'iframe#' + CSS.escape(el.id);
        if (el.name) return 'iframe[name="' + CSS.escape(el.name) + '"]';
        const parent = el.parentElement;
        if (!parent) return 'iframe';
        const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName && candidate.tagName.toLowerCase() === 'iframe');
        const index = siblings.indexOf(el);
        return index >= 0 ? `iframe:nth-of-type(${index + 1})` : 'iframe';
    }

    function documentTokenFor(root, framePath) {
        const doc = root && root.nodeType === 9 ? root : (root && root.ownerDocument);
        if (!doc) return null;
        const view = doc.defaultView;
        let url = doc.URL || '';
        let timeOrigin = 0;
        try { if (view && view.location) url = view.location.href; } catch (e) { /* cross-origin guard */ }
        try { if (view && view.performance) timeOrigin = view.performance.timeOrigin || 0; } catch (e) { /* unavailable */ }
        return fnv1a(`${framePath.join('>')}|${url}|${timeOrigin}`);
    }

    function stateOf(el, kind) {
        const st = {};
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') st.disabled = true;
        if (kind === 'toggle') {
            const checked = el.checked != null ? el.checked : el.getAttribute('aria-checked') === 'true';
            st.checked = !!checked;
        }
        const exp = el.getAttribute('aria-expanded');
        if (exp != null) st.expanded = exp === 'true';
        const sel = el.getAttribute('aria-selected');
        if (sel != null) st.selected = sel === 'true';
        if (kind === 'field' && el.value) st.value = String(el.value).slice(0, 40);
        return st;
    }

    // ── Walk: top doc + open shadow roots + same-origin iframes ──────
    const out = [];
    let docCounter = 0;

    function walk(root, framePath, depth, isTop) {
        if (out.length >= MAX || depth > MAX_FRAME_DEPTH) return;
        const docId = 'd' + (docCounter++);
        const documentToken = documentTokenFor(root, framePath);
        const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (let i = 0; i < els.length && out.length < MAX; i++) {
            const el = els[i];
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;

            // descend shadow root
            if (el.shadowRoot) walk(el.shadowRoot, framePath, depth, false);
            // descend same-origin iframe
            if (tag === 'iframe') {
                let childDoc = null;
                try { childDoc = el.contentDocument; } catch (e) { childDoc = null; }
                if (childDoc && childDoc.documentElement) {
                    const sel = frameSelector(el);
                    walk(childDoc, framePath.concat(sel), depth + 1, false);
                }
                continue;
            }

            const type = (el.getAttribute && el.getAttribute('type')) || el.type || '';
            const role = roleOf(el, tag, type);
            if (role === 'none' || role === 'presentation') continue;
            let interactive = isInteractive(el, tag, role);
            const isHeading = /^h[1-6]$/.test(tag) || role === 'heading';
            const isMapMedia = tag === 'canvas' || tag === 'img' || tag === 'video';
            // Deterministic clickable-icon heuristic: catch JS-bound glyphs/divs that carry no
            // DOM interactivity marker but present a pointer cursor at their own boundary.
            let iconHint = false;
            if (!interactive && !isHeading && !isMapMedia && !INTERACTIVE_ROLES.has(role)
                && maybeClickable(el) && cursorClickable(el)) {
                interactive = true;
                iconHint = isIconic(el);
            }
            // EMIT only actions + key text (not every div/span)
            if (!interactive && !isHeading && !(INTERACTIVE_ROLES.has(role)) && !isMapMedia) continue;

            const { kind, act } = classify(el, tag, role, interactive, iconHint);
            if (kind === 'media' && !interactive) {
                // only emit media if it carries a name (alt) — skip decorative
                if (!(el.alt && el.alt.trim())) continue;
            }
            let rect;
            try { rect = el.getBoundingClientRect(); } catch (e) { rect = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
            if (rect.width === 0 && rect.height === 0 && !isHeading) continue; // not rendered
            if (!isHeading && cssHidden(el)) continue; // Phase 3: drop visibility:hidden / opacity:0 / pointer-events:none

            const name = accessibleName(el).replace(/\s+/g, ' ').trim().slice(0, 80);
            const vp = inViewport(rect);
            out.push({
                role, name, tag, kind, act,
                sph: structuralHash(el),
                fp: fingerprint(el),
                state: stateOf(el, kind),
                vp: vp,
                occluded: (isTop && vp) ? occludedAt(el, rect) : false,
                region: regionOf(el),
                interactable: interactive,
                nameQuality: nameQuality(name, kind),
                framePath: framePath,
                docId: docId,
                documentToken: documentToken,
            });
        }
    }

    walk(document, [], 0, true);

    return {
        candidates: out,
        stats: { considered: out.length, truncated: out.length >= MAX, url: location.href, title: document.title },
    };
}

module.exports = { glassExtract };
