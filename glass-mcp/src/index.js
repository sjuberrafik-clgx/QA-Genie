'use strict';
/**
 * Glass MCP — public API (perception module, first increment).
 * The standalone, universal browser MCP server. Affordance-first see(),
 * durable handles, deterministic + auditable.
 */
const handle = require('./handle');
const salience = require('./perception/salience');
const pack = require('./perception/pack');
const { glassExtract } = require('./perception/extract');
const { Perceiver } = require('./perception/see');
const { resolveHandle, resolveTarget, scopeFor } = require('./resolve');
const { BrowserSession, loadChromium } = require('./session');
const { openVerb } = require('./verbs/open');
const { doVerb } = require('./verbs/do');
const { readVerb } = require('./verbs/read');
const { waitVerb } = require('./verbs/wait');
const { netVerb } = require('./verbs/net');
const { devtoolVerb } = require('./verbs/devtool');
const { scriptVerb } = require('./verbs/script');
const { buildTools } = require('./tools');
const { start } = require('./server');

module.exports = {
    // server + session
    start,
    BrowserSession,
    loadChromium,
    buildTools,
    // verbs
    openVerb,
    doVerb,
    readVerb,
    waitVerb,
    netVerb,
    devtoolVerb,
    scriptVerb,
    // perception
    Perceiver,
    glassExtract,
    // resolution
    resolveHandle,
    resolveTarget,
    scopeFor,
    // handle codec
    encodeHandle: handle.encodeHandle,
    decodeHandle: handle.decodeHandle,
    isHandle: handle.isHandle,
    fnv1a: handle.fnv1a,
    // scoring/packing (exposed for tooling/tests)
    salience,
    pack,
};
