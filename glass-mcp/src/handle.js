'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · HANDLE CODEC — durable, content-addressed element identity
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A Handle is a compact, opaque, self-describing token that CARRIES an element's
 * identity — so the agent can act on it later without a server-side ref table or
 * a stateful heal-store, and re-resolution survives DOM re-render / navigation.
 *
 *   handle = "H" + base64url( JSON({ v, r:role, n:name, p:structuralHash, f:fp, d:doc, x:framePath }) )
 *
 * Identity fields:
 *   r  role               — ARIA role / element kind
 *   n  name               — accessible name (capped, normalized)
 *   p  structuralHash     — FNV-1a of the STABLE ancestor chain (dynamic ids/indices stripped)
 *   f  fingerprint        — only stable discriminators: { testid?, id?, href?, type? }
 *   d  docId              — shadow/iframe document scope
 *   x  framePath          — frame locator chain for same-origin iframes
 *
 * Determinism: encode/decode are pure; the SAME identity always yields the SAME
 * handle. fnv1a is shared with the in-page extractor (parity-tested) so structural
 * hashes computed in the browser match what Node expects.
 *
 * @module glass-mcp/handle
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const NAME_CAP = 48;

/** FNV-1a 32-bit. Identical implementation runs in-page (extract) and in Node. */
function fnv1a(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Normalize an accessible name: collapse whitespace, trim, cap length. */
function normalizeName(name) {
    return String(name == null ? '' : name)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_CAP);
}

/**
 * Encode an identity object into a compact handle string.
 * @param {Object} identity { role, name, sph, fp?, doc?, frame? }
 * @returns {string} handle
 */
function encodeHandle(identity = {}) {
    const id = { v: 1, r: identity.role || '', n: normalizeName(identity.name) };
    if (identity.sph) id.p = identity.sph;
    if (identity.fp && Object.keys(identity.fp).length) id.f = pruneFp(identity.fp);
    if (identity.doc) id.d = identity.doc;
    if (Array.isArray(identity.frame) && identity.frame.length) id.x = identity.frame;
    const json = JSON.stringify(id);
    return 'H' + Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a handle back into a normalized identity object.
 * @param {string} handle
 * @returns {{role,name,sph,fp,doc,frame}}
 */
function decodeHandle(handle) {
    if (typeof handle !== 'string' || handle[0] !== 'H' || handle.length < 2) {
        throw new Error('invalid handle');
    }
    let id;
    try {
        id = JSON.parse(Buffer.from(handle.slice(1), 'base64url').toString('utf8'));
    } catch {
        throw new Error('invalid handle encoding');
    }
    if (!id || typeof id !== 'object' || id.v !== 1) throw new Error('unsupported handle version');
    return {
        role: id.r || '',
        name: id.n || '',
        sph: id.p || null,
        fp: id.f || null,
        doc: id.d || null,
        frame: Array.isArray(id.x) ? id.x : null,
    };
}

/** Keep only stable discriminators in a fingerprint. */
function pruneFp(fp) {
    const out = {};
    for (const k of ['testid', 'id', 'href', 'type']) {
        if (fp[k]) out[k] = String(fp[k]).slice(0, 64);
    }
    return out;
}

/** Is this a syntactically valid Glass handle? */
function isHandle(value) {
    if (typeof value !== 'string' || value[0] !== 'H') return false;
    try {
        decodeHandle(value);
        return true;
    } catch {
        return false;
    }
}

module.exports = { encodeHandle, decodeHandle, isHandle, fnv1a, normalizeName, NAME_CAP };
