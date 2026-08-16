'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER-TOOLS — MCP tool descriptors over the DRIVER interface
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Binds the verb algebra to ANY driver (CdpDriver today, a future BidiDriver)
 * implementing the verb surface. Same tool names, schema shape, and receipt
 * contract regardless of the underlying transport, so the MCP server serves the
 * driver selected by GLASS_DRIVER from a single entry.
 *
 * @module glass-mcp/driver/driver-tools
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const TARGET_SCHEMA = { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] };
const TAB = { type: 'string', description: 'tab id from open({action:"tabs"}); defaults to the active tab' };
const { enrichSeeReceipt, enrichDoReceipt } = require('../verbs/sense');

/** Did the caller opt into a specific cognition capability via `allow`? */
function wantsAllow(args, flag) {
    return !!(args && Array.isArray(args.allow) && args.allow.includes(flag));
}
const BATCH_ITEMS = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: true }, description: 'Operations to execute with bounded concurrency; results preserve input order' };
const RECEIPT_SCHEMA = {
    $schema: JSON_SCHEMA_2020_12,
    oneOf: [
        { type: 'object', required: ['ok'], properties: { ok: { const: true } }, additionalProperties: true },
        { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error: { type: 'string' }, code: { type: 'string' } }, additionalProperties: true },
    ],
};
const A = (readOnly, destructive, idempotent) => ({ readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: true });

/**
 * Build MCP tool descriptors bound to a driver.
 * @param {{open:Function,see:Function,do:Function,read:Function,wait:Function,net:Function,devtool:Function,script:Function}} driver
 * @returns {Array<{name,title,description,inputSchema,outputSchema,annotations,progress?,handler}>}
 */
function buildToolsForDriver(driver) {
    const wrap = (fn, operation = 'read') => async (args, ctx) => {
        const execute = (input) => {
            const signal = ctx && ctx.mcpReq && ctx.mcpReq.signal;
            const operationMode = typeof operation === 'function' ? operation(input) : operation;
            if (typeof driver.runInTab === 'function') {
                const schedulingTab = input.action === 'fork' ? (input.sourceTab || input.tab) : input.tab;
                return driver.runInTab(schedulingTab, () => fn.call(driver, input), {
                    operation: operationMode,
                    signal,
                    label: fn.name || null,
                });
            }
            return Promise.resolve().then(() => fn.call(driver, input));
        };
        const input = args || {};
        if (!Array.isArray(input.items)) return execute(input);

        const { items, ...defaults } = input;
        const settled = await Promise.allSettled(items.map((item) => execute({ ...defaults, ...(item || {}) })));
        const results = settled.map((entry) => entry.status === 'fulfilled'
            ? entry.value
            : {
                ok: false,
                code: entry.reason && entry.reason.code ? entry.reason.code : 'GLASS_BATCH_ITEM_ERROR',
                error: entry.reason && entry.reason.message ? entry.reason.message : String(entry.reason),
            });
        const ok = results.every((result) => !result || result.ok !== false);
        return {
            ok,
            batch: true,
            count: results.length,
            results,
            ...(ok ? {} : { code: 'GLASS_BATCH_PARTIAL_FAILURE', error: 'one or more batch operations failed' }),
        };
    };
    // Compose a base verb handler with an opt-in cognition post-processor. Batch
    // envelopes pass through untouched (per-item cognition is out of scope).
    const enrichWith = (baseHandler, post) => async (args, ctx) => {
        const res = await baseHandler(args, ctx);
        if (res && res.batch) return res;
        try { return await post(args || {}, res); } catch { return res; }
    };
    return [
        {
            name: 'open', title: 'Open and manage tabs', progress: true, annotations: A(false, false, false),
            description: 'Navigate and manage tabs or fork a shared/isolated scenario lane. open({url}) or open({action:"fork", sourceTab?, isolation:"shared"|"context"}).',
            inputSchema: { type: 'object', properties: { url: { type: 'string' }, action: { type: 'string', enum: ['goto', 'back', 'forward', 'reload', 'newTab', 'fork', 'switchTab', 'closeTab', 'tabs'] }, tab: { type: 'string' }, sourceTab: { type: 'string' }, isolation: { type: 'string', enum: ['shared', 'context'] }, scenario: { type: 'string' }, checkpoint: { type: 'boolean' }, waitUntil: { type: 'string', enum: ['commit', 'domcontentloaded', 'load', 'networkidle'] }, timeout: { type: 'number', minimum: 1, maximum: 120000 }, items: BATCH_ITEMS } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.open, (input) => input.action === 'fork' ? 'snapshot' : (input.action === 'tabs' ? 'read' : 'mutation')),
        },
        {
            name: 'see', title: 'Perceive page affordances', progress: true, annotations: A(true, false, true),
            description: 'Perceive the page as a ranked, token-budgeted menu of AFFORDANCES with durable handles for do/read. Pass allow:[\'intuition\'] to append a cognition block (app archetype, happy-path vs edge-case ranking, predicted next state).',
            inputSchema: { type: 'object', properties: { tokenBudget: { type: 'number', minimum: 100, maximum: 20000 }, maxElements: { type: 'integer', minimum: 1, maximum: 5000 }, keepBaseline: { type: 'boolean' }, allow: { type: 'array', items: { type: 'string' } }, tab: TAB, items: BATCH_ITEMS } },
            outputSchema: RECEIPT_SCHEMA,
            handler: enrichWith(wrap(driver.see, 'snapshot'), async (args, res) => {
                if (res && Array.isArray(res.affordances) && wantsAllow(args, 'intuition')) {
                    res.intuition = await enrichSeeReceipt(driver.cogHost(args && args.tab), res);
                }
                return res;
            }),
        },
        {
            name: 'do', title: 'Act on the page', annotations: A(false, true, false),
            description: 'Act on a target and get a verifiable effect receipt. do({target, action, value?}). action=click|type|fill|hover|press|select|check|uncheck|scrollIntoView|upload|screenshot|videoStart|videoStop|videoStatus. Pass allow:[\'verdict\'] to append an autonomous success/error/blocked judgment.',
            inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA }, action: { type: 'string', enum: ['click', 'type', 'fill', 'hover', 'press', 'select', 'check', 'uncheck', 'scrollIntoView', 'upload', 'screenshot', 'videoStart', 'videoStop', 'videoStatus'] }, value: { type: 'string' }, files: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }] }, path: { type: 'string' }, fullPage: { type: 'boolean' }, returnData: { type: 'boolean' }, fps: { type: 'integer', minimum: 1, maximum: 30 }, quality: { type: 'integer', minimum: 1, maximum: 100 }, maxWidth: { type: 'integer', minimum: 16, maximum: 7680 }, maxHeight: { type: 'integer', minimum: 16, maximum: 4320 }, timeout: { type: 'number', minimum: 1, maximum: 120000 }, allow: { type: 'array', items: { type: 'string' } }, expect: { type: 'object', additionalProperties: true }, tab: TAB, items: BATCH_ITEMS } },
            outputSchema: RECEIPT_SCHEMA,
            handler: enrichWith(wrap(driver.do, 'mutation'), async (args, res) => {
                if (res && res.ok && wantsAllow(args, 'verdict')) {
                    res.verdict = await enrichDoReceipt(driver.cogHost(args && args.tab), res, { target: args && args.target, expect: args && args.expect });
                }
                return res;
            }),
        },
        {
            name: 'read', title: 'Read page content', annotations: A(true, false, true),
            description: 'Read CONTENT for assertions. read({what, target?, name?}). what=text|value|attribute|html|table|url|title.',
            inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['text', 'value', 'attribute', 'html', 'table', 'url', 'title'] }, target: { ...TARGET_SCHEMA }, name: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 200000 }, tab: TAB, items: BATCH_ITEMS } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.read),
        },
        {
            name: 'wait', title: 'Wait for page state', progress: true, annotations: A(true, false, true),
            description: 'Block until a bounded condition holds. After login/navigation, verify a destination-specific path or authenticated-only element; an already-matching URL does not prove navigation. For maps/live apps, prefer domcontentloaded + visible target over networkidle.',
            inputSchema: { type: 'object', properties: { for: { type: 'string' }, target: { ...TARGET_SCHEMA }, value: { type: 'string' }, ms: { type: 'number' }, timeout: { type: 'number', minimum: 1, maximum: 120000 }, tab: TAB, items: BATCH_ITEMS } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.wait),
        },
        {
            name: 'net', title: 'Observe or control network', progress: true, annotations: A(false, true, false),
            description: 'Observe/control network. net({action:"record"|"list"|"stop"|"clear"|"waitForResponse"|"waitForRequest"|"mock"|"unmock"|"offline", ...}).',
            inputSchema: { type: 'object', properties: { action: { type: 'string' }, urlPattern: { type: 'string' }, method: { type: 'string' }, status: { type: 'number' }, resourceType: { type: 'string' }, json: {}, body: { type: 'string' }, contentType: { type: 'string' }, value: {}, limit: { type: 'number' }, max: { type: 'number' }, timeout: { type: 'number' }, tab: TAB } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.net, 'mutation'),
        },
        {
            name: 'devtool', title: 'Use Chrome DevTools', annotations: A(false, true, false),
            description: 'Universal CDP passthrough. devtool({method:"Domain.command", params?}) or devtool({list:true}).',
            inputSchema: { type: 'object', properties: { method: { type: 'string' }, params: { type: 'object', additionalProperties: true }, scope: { type: 'string', enum: ['page', 'browser'] }, list: { type: 'boolean' }, tab: TAB } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.devtool, 'browser'),
        },
        {
            name: 'script', title: 'Run audited page JavaScript', annotations: A(false, true, false),
            description: 'Evaluate JS in the page. script({expression}) or script({fn, args?}) or script({target, fn}).',
            inputSchema: { type: 'object', properties: { expression: { type: 'string' }, fn: { type: 'string' }, args: { type: 'array', items: { description: 'Any JSON-serializable argument value' } }, target: { ...TARGET_SCHEMA }, tab: TAB } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap(driver.script, 'mutation'),
        },
        {
            name: 'sense', title: 'Sense business intuition (intent, plan, verdict)', progress: true, annotations: A(true, false, true),
            description: 'Sense the page with autonomous business intuition (no mutation). sense({mode:\'intent\'|\'plan\'|\'verdict\'|\'full\', expect?}). intent = infer the app archetype + flow stage; plan = rank affordances into happy-path vs edge/error-loop and predict the next state; verdict = judge the last action as success|error|blocked|neutral; full = all three. Zero-config, deterministic, no test cases or assertions required.',
            inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['intent', 'plan', 'verdict', 'full'] }, expect: { type: 'object', additionalProperties: true }, tab: TAB } },
            outputSchema: RECEIPT_SCHEMA, handler: wrap((args) => driver.sense(args), 'read'),
        },
    ];
}

module.exports = { buildToolsForDriver };
