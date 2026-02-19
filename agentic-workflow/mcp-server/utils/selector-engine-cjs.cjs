/**
 * CommonJS wrapper for the SelectorEngine (ESM module).
 *
 * Since mcp-server/ uses "type": "module", the canonical selector-engine.js is ESM.
 * CommonJS consumers (scripts/, utils/) use this wrapper via dynamic import().
 *
 * Usage:
 *   const { getSelectorEngine } = require('../mcp-server/utils/selector-engine-cjs.cjs');
 *   const SelectorEngine = await getSelectorEngine();
 *
 * Or for synchronous access (after initial load):
 *   const { SelectorEngineLite } = require('../mcp-server/utils/selector-engine-cjs.cjs');
 *   // SelectorEngineLite has the core functions duplicated for CJS contexts
 */

// --- Inline copies of the core detection functions for synchronous CJS use ---

function isDynamicId(id) {
    if (!id || typeof id !== 'string') return true;
    if (/[0-9a-f]{8}-[0-9a-f]{4}/.test(id)) return true;
    if (/^:r[0-9a-z]+:/.test(id) || /^__next/.test(id)) return true;
    if (/^(mui|css|jss|sc)-[a-z0-9]{4,}/i.test(id)) return true;
    if (/^radix-/.test(id)) return true;
    const digits = (id.match(/\d/g) || []).length;
    const alphas = (id.match(/[a-zA-Z]/g) || []).length;
    if (digits > 4 && digits > alphas) return true;
    if (/[a-f0-9]{6,}$/i.test(id) && id.length > 10) return true;
    return false;
}

function isDynamicText(text) {
    if (!text || typeof text !== 'string') return true;
    if (text.length > 200) return true;
    if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(text)) return true;
    if (/\d{1,2}:\d{2}(:\d{2})?/.test(text)) return true;
    if (/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.test(text)) return true;
    if (/just now|a moment ago/i.test(text)) return true;
    if (/\$[\d,]+(\.\d{2})?/.test(text)) return true;
    if (/\d+\s+(results?|items?|listings?|properties|matches|records)/i.test(text)) return true;
    if (/showing\s+\d+/i.test(text)) return true;
    if (/page\s+\d+\s+of\s+\d+/i.test(text)) return true;
    return false;
}

function mapAriaRole(explicitRole, tag) {
    if (explicitRole && explicitRole !== 'presentation' && explicitRole !== 'none') {
        return explicitRole;
    }
    const implicitRoles = {
        a: 'link', button: 'button', input: 'textbox', select: 'combobox',
        textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main',
        header: 'banner', footer: 'contentinfo', aside: 'complementary',
        form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem',
        h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
        h5: 'heading', h6: 'heading', dialog: 'dialog', summary: 'button',
    };
    return implicitRoles[tag] || null;
}

/**
 * Lightweight synchronous CJS version with core helper functions.
 * For full SelectorEngine (generateUniqueSelector, processSnapshotElements, etc.),
 * use getSelectorEngine() which loads the ESM module asynchronously.
 */
const SelectorEngineLite = {
    isDynamicId,
    isDynamicText,
    mapAriaRole,
};

/**
 * Async loader for the full ESM SelectorEngine.
 * @returns {Promise<Object>} The SelectorEngine object
 */
async function getSelectorEngine() {
    const mod = await import('./selector-engine.js');
    return mod.SelectorEngine || mod.default;
}

module.exports = { getSelectorEngine, SelectorEngineLite };
