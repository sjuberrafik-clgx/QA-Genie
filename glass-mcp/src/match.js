'use strict';
/**
 * GLASS · MATCH — build a deterministic URL predicate from a pattern.
 * Shared by the `wait` and `net` verbs. A pattern may be:
 *   • a RegExp                          → tested directly
 *   • a "/regex/flags" string          → compiled to RegExp
 *   • a glob with "*"                  → anchored wildcard match
 *   • any other string                 → substring match
 * @module glass-mcp/match
 */

function esc(x) {
    return x.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string|RegExp|null|undefined} pattern
 * @returns {(url:string)=>boolean}
 */
function urlPredicate(pattern) {
    if (pattern == null || pattern === '') return () => true;
    if (pattern instanceof RegExp) return (u) => pattern.test(u);
    const s = String(pattern);
    const re = s.match(/^\/(.*)\/([a-z]*)$/);
    if (re) {
        const compiled = new RegExp(re[1], re[2]);
        return (u) => compiled.test(u);
    }
    if (s.includes('*')) {
        const compiled = new RegExp('^' + s.split('*').map(esc).join('.*') + '$');
        return (u) => compiled.test(u);
    }
    return (u) => String(u).includes(s);
}

module.exports = { urlPredicate };
