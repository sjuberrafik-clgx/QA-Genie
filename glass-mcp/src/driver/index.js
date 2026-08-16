'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER — swappable browser-control layer (the "own the driver" seam)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The verbs (open/see/do/read/wait/net/devtool/script/sense) call a DRIVER, not a
 * wire directly, so the transport can evolve without touching the perception IP.
 *
 *   • cdp   — direct Chrome DevTools Protocol (this module tree). Chromium; the only
 *             supported driver. Zero Playwright at runtime.
 *   • bidi  — WebDriver BiDi (future; Firefox/WebKit). Same surface, new wire.
 *
 * The intelligence (affordance extraction, durable-handle resolution, actionability)
 * lives in a portable in-page agent, NOT in the wire — so swapping drivers keeps the
 * perception IP intact.
 *
 * @module glass-mcp/driver
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { CdpBrowser, CdpPage } = require('./cdp/browser');
const { CdpConnection, CdpSession } = require('./cdp/connection');
const { launchChromium, findChromium } = require('./cdp/launch');
const { CdpDriver } = require('./cdp/driver');

const DRIVER_KINDS = Object.freeze(['cdp', 'bidi']);

/** Resolve the configured driver kind from the environment (defaults to cdp). */
function resolveDriverKind() {
    const k = String(process.env.GLASS_DRIVER || 'cdp').toLowerCase();
    return DRIVER_KINDS.includes(k) ? k : 'cdp';
}

/**
 * Construct a driver implementing the verb surface.
 * @param {string} [kind] 'cdp' (defaults to GLASS_DRIVER env)
 * @param {object} [opts] driver options (headless, viewport, tokenBudget, …)
 */
function createDriver(kind, opts = {}) {
    const k = kind || resolveDriverKind();
    if (k === 'bidi') throw new Error('the bidi driver is not implemented yet (Chromium-first). Use cdp.');
    return new CdpDriver(opts);
}

module.exports = {
    // contract
    DRIVER_KINDS,
    resolveDriverKind,
    createDriver,
    // driver implementation
    CdpDriver,
    // CDP foundation (transport + minimal browser handles)
    CdpBrowser,
    CdpPage,
    CdpConnection,
    CdpSession,
    launchChromium,
    findChromium,
};
