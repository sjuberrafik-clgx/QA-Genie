'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · AGENT · RESOLVE — durable-handle resolution + actions, IN THE PAGE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One self-contained runtime, serialized into the page (like glassExtract). It owns
 * the whole element lifecycle for the CDP driver so a `do`/`read` is ONE round-trip
 * instead of the 4–6 a re-querying locator spends:
 *
 *   • resolve(identity)  — re-derive an element from a decoded handle, trying the
 *                          SAME strategy order as src/resolve.js (testid → id →
 *                          role+name → structural-hash → text). Deterministic; no
 *                          server-side heal-store.
 *   • resolveDesc(desc)  — resolve a {css|testid|id|role+name|text} descriptor.
 *   • hit(token)         — recompute the occlusion-checked hit-point for a cached
 *                          element (innovation #2: O(1) when it's still live).
 *   • act(token,…)       — DOM-level fill/select/check/scroll/focus (pointer actions
 *                          are dispatched as TRUSTED CDP Input by the driver).
 *   • read(token,…)      — text/value/attribute/html for assertions.
 *
 * A window-scoped registry (survives re-render; reset by navigation) content-
 * addresses live nodes to short tokens, so repeated actions skip the DOM walk.
 *
 * The role / accessible-name / structural-hash helpers are copied VERBATIM from
 * src/perception/extract.js so identities computed here match the handles see()
 * emitted (parity-tested, same discipline as the shared fnv1a).
 *
 * Self-contained: NO references outside this function (must survive .toString()).
 *
 * @module glass-mcp/agent/resolve
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * @param {{cmd:'resolve'|'resolveDesc'|'hit'|'act'|'read'|'capture', identity?:object, desc?:object,
 *          token?:string, action?:string, value?:*, what?:string, name?:string, scroll?:boolean}} op
 */
function glassAgent(op) {
    const G = (window.__GLASS__ = window.__GLASS__ || { reg: new Map(), rev: new WeakMap(), seq: 0 });

    // ── helpers copied from extract.js (parity with encoded handles) ──────────
    function fnv1a(str) {
        let h = 0x811c9dc5;
        const s = String(str);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(16).padStart(8, '0');
    }
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
            const lbl = root.querySelector && root.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
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
        return title ? title.trim() : '';
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

    // ── local utilities ──────────────────────────────────────────────────────
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    const nameOf = (el) => accessibleName(el).replace(/\s+/g, ' ').trim().slice(0, 80);
    const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

    function documentTokenFor(doc, framePath) {
        if (!doc) return null;
        const view = doc.defaultView;
        let url = doc.URL || '';
        let timeOrigin = 0;
        try { if (view && view.location) url = view.location.href; } catch (e) { /* cross-origin guard */ }
        try { if (view && view.performance) timeOrigin = view.performance.timeOrigin || 0; } catch (e) { /* unavailable */ }
        return fnv1a(`${(framePath || []).join('>')}|${url}|${timeOrigin}`);
    }

    function resolveScope(framePath) {
        const route = Array.isArray(framePath) ? framePath : [];
        let currentDocument = document;
        const frames = [];
        for (const selector of route) {
            let frameElement;
            try { frameElement = currentDocument.querySelector(selector); } catch (e) { frameElement = null; }
            if (!frameElement || String(frameElement.tagName || '').toLowerCase() !== 'iframe') {
                return { ok: false, code: 'GLASS_FRAME_NOT_FOUND', error: `frame route segment not found: ${selector}`, framePath: route };
            }
            let childDocument = null;
            try { childDocument = frameElement.contentDocument; } catch (e) { childDocument = null; }
            if (!childDocument || !childDocument.documentElement) {
                return { ok: false, code: 'GLASS_FRAME_UNAVAILABLE', error: `frame is not available in the current target: ${selector}`, framePath: route };
            }
            frames.push({ element: frameElement, parentDocument: currentDocument });
            currentDocument = childDocument;
        }
        return { ok: true, document: currentDocument, frames, framePath: route };
    }

    function scopeForElement(el) {
        let currentDocument = el && el.ownerDocument;
        const frames = [];
        while (currentDocument && currentDocument !== document) {
            let frameElement = null;
            try { frameElement = currentDocument.defaultView && currentDocument.defaultView.frameElement; } catch (e) { frameElement = null; }
            if (!frameElement) break;
            frames.unshift({ element: frameElement, parentDocument: frameElement.ownerDocument });
            currentDocument = frameElement.ownerDocument;
        }
        return { ok: true, document: (el && el.ownerDocument) || document, frames, framePath: [] };
    }

    function tokenFor(el) {
        let tok = G.rev.get(el);
        if (tok && G.reg.get(tok) === el) return tok;
        tok = 'g' + (++G.seq);
        G.reg.set(tok, el);
        G.rev.set(el, tok);
        return tok;
    }
    function nodeFor(tok) {
        const el = G.reg.get(tok);
        return el && el.isConnected ? el : null;
    }
    function pickVisible(nodes) {
        for (const n of nodes) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return n; }
        return nodes[0] || null;
    }

    function hitInfo(el, scroll, scope) {
        const resolvedScope = scope || scopeForElement(el);
        if (scroll !== false) {
            for (const frame of resolvedScope.frames || []) {
                if (frame.element.scrollIntoView) { try { frame.element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ } }
            }
            if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ } }
        }
        const r = el.getBoundingClientRect();
        const localDocument = el.ownerDocument || resolvedScope.document || document;
        const localWindow = localDocument.defaultView || window;
        const st = localWindow.getComputedStyle(el);
        const visible = r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity || '1') > 0;
        let cx = r.left + r.width / 2;
        let cy = r.top + r.height / 2;
        let occluded = false;
        try {
            const top = localDocument.elementFromPoint(cx, cy);
            occluded = !(top === el || el.contains(top) || (top && top.contains(el)));
        } catch (e) { /* off-viewport */ }
        const frames = resolvedScope.frames || [];
        for (let i = frames.length - 1; i >= 0; i--) {
            const frame = frames[i];
            const frameRect = frame.element.getBoundingClientRect();
            if (frameRect.width <= 0 || frameRect.height <= 0) occluded = true;
            cx += frameRect.left;
            cy += frameRect.top;
            try {
                const top = frame.parentDocument.elementFromPoint(cx, cy);
                if (!(top === frame.element || frame.element.contains(top))) occluded = true;
            } catch (e) { occluded = true; }
        }
        const enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        return { x: cx, y: cy, occluded, visible, enabled, inViewport: cx >= 0 && cy >= 0 && cx <= vw && cy <= vh, viewport: { width: vw, height: vh }, rect: { x: cx - r.width / 2, y: cy - r.height / 2, w: r.width, h: r.height }, tag: el.tagName.toLowerCase() };
    }

    // Single DOM pass computing the minimal identity {el, role, name, sph}.
    function walkCompute(root) {
        const res = [];
        function append(scopeRoot) {
            const els = scopeRoot && scopeRoot.querySelectorAll ? scopeRoot.querySelectorAll('*') : [];
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                const tag = el.tagName ? el.tagName.toLowerCase() : '';
                if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;
                const type = (el.getAttribute && el.getAttribute('type')) || el.type || '';
                res.push({ el, role: roleOf(el, tag, type), name: nameOf(el), sph: structuralHash(el) });
                if (el.shadowRoot) append(el.shadowRoot);
            }
        }
        append(root || document);
        return res;
    }

    function found(el, strategy, confidence, count, tried, scope) {
        const tag = el.tagName.toLowerCase();
        const out = Object.assign(
            { found: true, token: tokenFor(el), strategy, confidence, count, tried, role: roleOf(el, tag, el.type || ''), name: nameOf(el) },
            hitInfo(el, op.scroll, scope)
        );
        // Fold the before-state signature into resolve so do() needs no extra round-trip.
        if (op.withPageSig) {
            const state = documentState(scope.document || el.ownerDocument || document);
            out.pageUrl = state.url;
            out.pageSig = state.sig;
        }
        if (op.read) out.read = domRead(el, op.read.what, op.read.name);
        return out;
    }

    function documentState(doc) {
        const currentDocument = doc || document;
        let url = '';
        try { url = currentDocument.defaultView.location.href; } catch (e) { url = currentDocument.URL || ''; }
        const body = currentDocument.body;
        if (!body) return { ok: true, url, sig: '' };
        const nodes = Array.from(currentDocument.querySelectorAll(
            'input,select,textarea,[aria-checked],[aria-selected],[aria-expanded],[aria-pressed]'
        )).slice(0, 300);
        const state = nodes.map((element, index) => [
            index,
            element.tagName,
            element.getAttribute('type') || '',
            element.id || '',
            element.getAttribute('name') || '',
            'value' in element ? String(element.value) : '',
            'checked' in element ? String(element.checked) : '',
            'selectedIndex' in element ? String(element.selectedIndex) : '',
            element.getAttribute('aria-checked') || '',
            element.getAttribute('aria-selected') || '',
            element.getAttribute('aria-expanded') || '',
            element.getAttribute('aria-pressed') || '',
            element.disabled ? 'disabled' : '',
        ].join('\x1f')).join('\x1e');
        return { ok: true, url, sig: `${body.childElementCount}:${(body.innerText || '').length}:${fnv1a(state)}` };
    }

    function resolve(id) {
        const tried = [];
        const scope = resolveScope(id.frame);
        if (!scope.ok) return { found: false, code: scope.code, error: scope.error, identity: id, tried };
        if (id.documentToken) {
            const currentToken = documentTokenFor(scope.document, scope.framePath);
            if (currentToken !== id.documentToken) {
                return {
                    found: false,
                    code: 'GLASS_STALE_DOCUMENT_HANDLE',
                    error: `handle belongs to frame document ${id.documentToken}; current document is ${currentToken}`,
                    identity: id,
                    tried,
                };
            }
        }
        const root = scope.document;
        if (id.fp && id.fp.testid) {
            const t = cssEscape(id.fp.testid);
            const el = root.querySelector(`[data-testid="${t}"],[data-test-id="${t}"],[data-qa="${t}"]`);
            tried.push({ step: 'testid', count: el ? 1 : 0 });
            if (el) return found(el, 'testid', 0.95, 1, tried, scope);
        }
        if (id.fp && id.fp.id) {
            const el = root.getElementById(id.fp.id);
            tried.push({ step: 'id', count: el ? 1 : 0 });
            if (el) return found(el, 'id', 0.9, 1, tried, scope);
        }
        if (id.fp && id.fp.placeholder) {
            const value = cssEscape(id.fp.placeholder);
            const el = root.querySelector(`input[placeholder="${value}"],textarea[placeholder="${value}"]`);
            tried.push({ step: 'placeholder', count: el ? 1 : 0 });
            if (el) return found(el, 'placeholder', 0.88, 1, tried, scope);
        }
        const want = norm(id.name);
        let cands = null;
        if (id.role && want) {
            cands = walkCompute(root);
            const m = cands.filter((c) => c.role === id.role && norm(c.name).indexOf(want) === 0);
            tried.push({ step: 'role+name', count: m.length });
            if (m.length) return found(pickVisible(m.map((x) => x.el)), 'role+name', m.length === 1 ? 0.9 : 0.7, m.length, tried, scope);
        }
        if (id.sph) {
            if (!cands) cands = walkCompute(root);
            const m = cands.filter((c) => c.sph === id.sph && (!id.role || c.role === id.role) && (!want || norm(c.name).indexOf(want) === 0));
            tried.push({ step: 'structural-hash', count: m.length });
            if (m.length) return found(pickVisible(m.map((x) => x.el)), 'structural-hash', 0.55, m.length, tried, scope);
        }
        if (want) {
            if (!cands) cands = walkCompute(root);
            const m = cands.filter((c) => norm(c.name) === want);
            tried.push({ step: 'text', count: m.length });
            if (m.length) return found(pickVisible(m.map((x) => x.el)), 'text', 0.6, m.length, tried, scope);
        }
        return { found: false, tried };
    }

    function resolveDesc(d) {
        const scope = resolveScope(d.frame);
        if (!scope.ok) return { found: false, code: scope.code, error: scope.error, tried: [] };
        const root = scope.document;
        if (d.css) { const el = root.querySelector(d.css); return el ? found(el, 'css', 0.9, 1, [{ step: 'css', count: 1 }], scope) : { found: false, tried: [{ step: 'css', count: 0 }] }; }
        if (d.testid) { const t = cssEscape(d.testid); const el = root.querySelector(`[data-testid="${t}"],[data-test-id="${t}"],[data-qa="${t}"]`); return el ? found(el, 'testid', 0.95, 1, [{ step: 'testid', count: 1 }], scope) : { found: false, tried: [{ step: 'testid', count: 0 }] }; }
        if (d.id) { const el = root.getElementById(d.id); return el ? found(el, 'id', 0.9, 1, [{ step: 'id', count: 1 }], scope) : { found: false, tried: [{ step: 'id', count: 0 }] }; }
        const cands = walkCompute(root);
        if (d.role && d.name != null) {
            const want = norm(d.name);
            const m = cands.filter((c) => c.role === d.role && norm(c.name).indexOf(want) >= 0);
            if (m.length) return found(pickVisible(m.map((x) => x.el)), 'role+name', m.length === 1 ? 0.9 : 0.7, m.length, [{ step: 'role+name', count: m.length }], scope);
            return { found: false, tried: [{ step: 'role+name', count: 0 }] };
        }
        const needle = norm(d.text != null ? d.text : d.name);
        if (needle) {
            let m = cands.filter((c) => norm(c.name) === needle);
            if (!m.length) m = cands.filter((c) => norm(c.name).indexOf(needle) === 0);
            if (!m.length) m = cands.filter((c) => norm(c.name).indexOf(needle) >= 0);
            if (m.length) return found(pickVisible(m.map((x) => x.el)), 'text', 0.6, m.length, [{ step: 'text', count: m.length }], scope);
        }
        return { found: false, tried: [{ step: 'text', count: 0 }] };
    }

    function domAct(el, action, value) {
        try {
            const localWindow = (el.ownerDocument && el.ownerDocument.defaultView) || window;
            switch (action) {
                case 'fill':
                case 'type': {
                    const isTextArea = localWindow.HTMLTextAreaElement && el instanceof localWindow.HTMLTextAreaElement;
                    const proto = isTextArea ? localWindow.HTMLTextAreaElement.prototype : localWindow.HTMLInputElement.prototype;
                    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                    el.focus();
                    const v = value == null ? '' : String(value);
                    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
                    el.dispatchEvent(new localWindow.Event('input', { bubbles: true }));
                    el.dispatchEvent(new localWindow.Event('change', { bubbles: true }));
                    return { ok: true, value: v };
                }
                case 'check':
                case 'uncheck': {
                    const want = action === 'check';
                    if (!!el.checked !== want) { el.focus(); el.click(); }
                    return { ok: true, checked: !!el.checked };
                }
                case 'select': {
                    el.focus();
                    const v = String(value);
                    let matched = false;
                    for (const o of (el.options || [])) { const hit = o.value === v || o.label === v || o.text === v; o.selected = hit; if (hit) matched = true; }
                    el.dispatchEvent(new localWindow.Event('input', { bubbles: true }));
                    el.dispatchEvent(new localWindow.Event('change', { bubbles: true }));
                    return { ok: matched, value: v };
                }
                case 'scrollIntoView': { el.scrollIntoView({ block: 'center', inline: 'center' }); return { ok: true }; }
                case 'focus': { el.focus(); return { ok: true }; }
                default: return { ok: false, error: 'unsupported dom action: ' + action };
            }
        } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }

    function domRead(el, what, name) {
        switch (what) {
            case 'text': return { ok: true, text: el.innerText || el.textContent || '' };
            case 'value': return { ok: true, value: el.value != null ? String(el.value) : '' };
            case 'attribute': return { ok: true, name, value: el.getAttribute(name) };
            case 'html': return { ok: true, value: el.innerHTML };
            case 'table': {
                const t = el.tagName === 'TABLE' ? el : el.querySelector('table');
                if (!t) return { ok: true, rows: [] };
                return { ok: true, rows: Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => (c.innerText || '').trim())) };
            }
            default: return { ok: false, error: 'unsupported read: ' + what };
        }
    }

    // ── dispatch ──────────────────────────────────────────────────────────────
    if (op.cmd === 'resolve') return resolve(op.identity || {});
    if (op.cmd === 'resolveDesc') return resolveDesc(op.desc || {});
    if (op.cmd === 'hit') { const el = nodeFor(op.token); return el ? Object.assign({ found: true, token: op.token }, hitInfo(el, op.scroll, scopeForElement(el))) : { found: false, reason: 'stale token' }; }
    if (op.cmd === 'act') {
        const el = nodeFor(op.token);
        if (!el) return { ok: false, error: 'stale token' };
        const result = domAct(el, op.action, op.value);
        if (result.ok && op.captureAfter) result.after = documentState(el.ownerDocument || document);
        return result;
    }
    if (op.cmd === 'read') { const el = nodeFor(op.token); return el ? domRead(el, op.what, op.name) : { ok: false, error: 'stale token' }; }
    if (op.cmd === 'capture') {
        const scope = resolveScope(op.identity && op.identity.frame);
        return scope.ok ? documentState(scope.document) : { ok: false, code: scope.code, error: scope.error };
    }
    return { error: 'unknown op: ' + op.cmd };
}

module.exports = { glassAgent };
