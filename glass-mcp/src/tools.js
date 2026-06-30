'use strict';
/**
 * GLASS · TOOLS — the verb→MCP-tool bridge.
 * Pure (no MCP SDK dependency) so it's unit-testable. server.js maps these to
 * MCP registrations. Schemas are deliberately tiny — the whole point of the
 * verb algebra (8 verbs, not 141 tools).
 * @module glass-mcp/tools
 */

const { openVerb } = require('./verbs/open');
const { doVerb } = require('./verbs/do');
const { readVerb } = require('./verbs/read');
const { waitVerb } = require('./verbs/wait');
const { netVerb } = require('./verbs/net');
const { devtoolVerb } = require('./verbs/devtool');
const { scriptVerb } = require('./verbs/script');

/**
 * @param {import('./session').BrowserSession} session
 * @returns {Array<{name,description,inputSchema,handler}>}
 */
function buildTools(session) {
    return [
        {
            name: 'open',
            description:
                'Navigate and manage tabs. open({url}) to go to a page; ' +
                'open({action:"back"|"forward"|"reload"|"newTab"|"switchTab"|"closeTab"|"tabs", url?, tab?}).',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to open (goto/newTab)' },
                    action: { type: 'string', description: 'goto|back|forward|reload|newTab|switchTab|closeTab|tabs (default goto)' },
                    tab: { type: 'string', description: 'tab id for switchTab/closeTab' },
                },
            },
            handler: (args) => openVerb(session, args),
        },
        {
            name: 'see',
            description:
                'Perceive the current page as a ranked, token-budgeted menu of AFFORDANCES (what you can do). ' +
                'Each entry has a durable handle to pass to do/read. Deterministic; vision is never used.',
            inputSchema: {
                type: 'object',
                properties: {
                    tokenBudget: { type: 'number', description: 'Max token budget for the menu (default 1500)' },
                    maxElements: { type: 'number', description: 'Max elements to consider (default 1500)' },
                },
            },
            handler: (args) => session.see(args || {}),
        },
        {
            name: 'do',
            description:
                'Act on a target and get a verifiable effect receipt. do({target, action, value?}). ' +
                'target = a handle from see(), a natural name, or {role,name|text|css|at:[x,y]}. ' +
                'action = click|type|fill|hover|press|select|check|uncheck|scrollIntoView|upload|screenshot. ' +
                'upload needs {files}; screenshot is CDP-backed and target-optional (saves a PNG, returns its path).',
            inputSchema: {
                type: 'object',
                properties: {
                    target: { description: 'handle string, natural-language name, or descriptor object (omit for full-page screenshot)' },
                    action: { type: 'string', description: 'click|type|fill|hover|press|select|check|uncheck|scrollIntoView|upload|screenshot (default click)' },
                    value: { type: 'string', description: 'value for type/fill/select/press' },
                    files: { description: 'file path or array of paths for upload (setInputFiles)' },
                    path: { type: 'string', description: 'screenshot save path (default: a temp .png; returns its path)' },
                    fullPage: { type: 'boolean', description: 'screenshot beyond the viewport when no target (default true)' },
                    allow: { type: 'array', items: { type: 'string' }, description: 'opt-in cognition: dismiss|vision (audited; default none)' },
                },
            },
            handler: (args) => doVerb(session, args),
        },
        {
            name: 'read',
            description:
                'Read CONTENT (not affordances) for assertions. read({what, target?, name?}). ' +
                'what = text|value|attribute|html|table (with target) or url|title|text|html (page-level). ' +
                'target = a handle, a natural name, or {role,name|text|css}.',
            inputSchema: {
                type: 'object',
                properties: {
                    what: { type: 'string', description: 'text|value|attribute|html|table|url|title (default text)' },
                    target: { description: 'handle, natural name, or descriptor (omit for page-level reads)' },
                    name: { type: 'string', description: 'attribute name when what=attribute' },
                    max: { type: 'number', description: 'max characters before truncation (default 20000)' },
                },
            },
            handler: (args) => readVerb(session, args),
        },
        {
            name: 'wait',
            description:
                'Block until a condition holds (bounded, less flaky than fixed sleeps). ' +
                "wait({for, target?, value?, timeout?}). for = visible|hidden|attached|detached|enabled|text|url|title|" +
                'load|domcontentloaded|networkidle|timeout.',
            inputSchema: {
                type: 'object',
                properties: {
                    for: { type: 'string', description: 'condition (see description); default load' },
                    target: { description: 'handle/name/descriptor for element conditions' },
                    value: { description: 'text/url/title to match, or ms for timeout' },
                    timeout: { type: 'number', description: 'upper bound in ms (default 15000)' },
                },
            },
            handler: (args) => waitVerb(session, args),
        },
        {
            name: 'net',
            description:
                'Observe and control network. net({action, ...}). action = record|stop|clear|list|' +
                'waitForResponse|waitForRequest|mock|unmock|offline. urlPattern accepts substring, /regex/, or glob.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'record|stop|clear|list|waitForResponse|waitForRequest|mock|unmock|offline' },
                    urlPattern: { type: 'string', description: 'substring, /regex/flags, or glob with *' },
                    method: { type: 'string', description: 'filter by HTTP method (list)' },
                    status: { type: 'number', description: 'filter by status (list)' },
                    json: { description: 'JSON body to fulfill (mock)' },
                    body: { type: 'string', description: 'raw body to fulfill (mock)' },
                    value: { type: 'boolean', description: 'offline on/off' },
                    timeout: { type: 'number', description: 'ms for waitFor* (default 15000)' },
                },
            },
            handler: (args) => netVerb(session, args),
        },
        {
            name: 'devtool',
            description:
                'Universal Chrome DevTools Protocol passthrough — the escape hatch for any low-level capability ' +
                "(performance, emulation, coverage, a11y tree, tracing...). devtool({method:'Domain.command', params?}). " +
                'devtool({list:true}) lists common domains. Chromium only.',
            inputSchema: {
                type: 'object',
                properties: {
                    method: { type: 'string', description: "CDP method, e.g. 'Performance.getMetrics'" },
                    params: { type: 'object', description: 'CDP params object' },
                    list: { type: 'boolean', description: 'list common CDP domain families' },
                },
            },
            handler: (args) => devtoolVerb(session, args),
        },
        {
            name: 'script',
            description:
                'Evaluate JS in the page (audited escape hatch). script({expression}) | script({fn, args}) | ' +
                'script({target, fn}) with the element as the first arg. Results must be JSON-serializable.',
            inputSchema: {
                type: 'object',
                properties: {
                    expression: { type: 'string', description: 'a JS expression to evaluate' },
                    fn: { type: 'string', description: 'a function source, e.g. (x)=>x+1' },
                    args: { type: 'array', description: 'arguments passed to fn' },
                    target: { description: 'optional handle/name/descriptor; element becomes fn arg 1' },
                },
            },
            handler: (args) => scriptVerb(session, args),
        },
    ];
}

module.exports = { buildTools };
