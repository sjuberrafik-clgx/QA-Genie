'use strict';
/**
 * Glass MCP — public API. A standalone, universal, lightweight browser MCP server
 * driven directly over the Chrome DevTools Protocol (raw CDP; zero Playwright at
 * runtime). Affordance-first see(), durable content-addressed handles, a bounded
 * verb algebra. Deterministic by default; cognition is opt-in and audited.
 */
const handle = require('./handle');
const salience = require('./perception/salience');
const pack = require('./perception/pack');
const { glassExtract } = require('./perception/extract');
const { senseVerb, enrichSeeReceipt, enrichDoReceipt } = require('./verbs/sense');
const cognition = require('./cognition');
const { buildToolsForDriver } = require('./driver/driver-tools');
const { createGlassServer, start } = require('./server');
const { OperationScheduler } = require('./scheduler');
const { createDriver, resolveDriverKind, CdpDriver, CdpBrowser } = require('./driver');

module.exports = {
    // server
    start,
    createGlassServer,
    OperationScheduler,
    // driver (raw CDP) + MCP tool descriptors
    createDriver,
    resolveDriverKind,
    CdpDriver,
    CdpBrowser,
    buildToolsForDriver,
    // cognition kernel (pure, driver-neutral, shareable)
    senseVerb,
    enrichSeeReceipt,
    enrichDoReceipt,
    cognition,
    Cognition: cognition.Cognition,
    // perception
    glassExtract,
    // handle codec
    encodeHandle: handle.encodeHandle,
    decodeHandle: handle.decodeHandle,
    isHandle: handle.isHandle,
    fnv1a: handle.fnv1a,
    // scoring/packing (exposed for tooling/tests)
    salience,
    pack,
};
