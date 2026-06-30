'use strict';
/**
 * GLASS · VERB `net` — observe and control network with deterministic receipts.
 *
 *   net({ action:'record', max? })                          start capturing (context-wide)
 *   net({ action:'list', urlPattern?, method?, status?, resourceType?, limit? })
 *   net({ action:'stop' })                                  stop + return the summary
 *   net({ action:'clear' })                                 empty the buffer
 *   net({ action:'waitForResponse', urlPattern, timeout? }) → { status, url, bodyPreview? }
 *   net({ action:'waitForRequest', urlPattern, timeout? })
 *   net({ action:'mock', urlPattern, status?, json?|body?, contentType? })   route+fulfill
 *   net({ action:'unmock', urlPattern? })                   remove route(s)
 *   net({ action:'offline', value:true|false })             toggle offline
 *
 * Recording is context-wide (survives navigation and spans tabs); the buffer is a
 * bounded ring (oldest dropped). Mocks are page-scoped on the active tab.
 *
 * @module glass-mcp/verbs/net
 */

const { urlPredicate } = require('../match');

const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s) || '';
const urlStr = (u) => (typeof u === 'string' ? u : (u && u.href) || String(u));

function ensureNet(session) {
    if (!session._net) session._net = { recording: false, attached: false, events: [], routes: [], max: 500 };
    return session._net;
}

function push(net, e) {
    net.events.push(e);
    if (net.events.length > net.max) net.events.splice(0, net.events.length - net.max);
}

function attach(session, net) {
    if (net.attached) return;
    const ctx = session.context;
    ctx.on('response', (resp) => {
        if (!net.recording) return;
        const req = resp.request();
        push(net, { type: 'response', method: req.method(), url: resp.url(), status: resp.status(), resourceType: req.resourceType(), ts: Date.now() });
    });
    ctx.on('requestfailed', (req) => {
        if (!net.recording) return;
        const f = req.failure();
        push(net, { type: 'failed', method: req.method(), url: req.url(), resourceType: req.resourceType(), failure: (f && f.errorText) || 'failed', ts: Date.now() });
    });
    net.attached = true;
}

async function netVerb(session, args = {}) {
    await session.ensure();
    const page = session.page;
    const net = ensureNet(session);
    const action = args.action || 'record';

    try {
        switch (action) {
            case 'record': {
                net.max = args.max || net.max || 500;
                net.recording = true;
                attach(session, net);
                return { ok: true, action, recording: true };
            }
            case 'stop': {
                net.recording = false;
                return { ok: true, action, recording: false, count: net.events.length };
            }
            case 'clear': {
                net.events = [];
                return { ok: true, action, count: 0 };
            }
            case 'list': {
                let ev = net.events.slice();
                if (args.urlPattern) { const p = urlPredicate(args.urlPattern); ev = ev.filter((e) => p(e.url)); }
                if (args.method) ev = ev.filter((e) => (e.method || '').toUpperCase() === String(args.method).toUpperCase());
                if (args.status) ev = ev.filter((e) => e.status === Number(args.status));
                if (args.resourceType) ev = ev.filter((e) => e.resourceType === args.resourceType);
                return { ok: true, action, count: ev.length, events: ev.slice(-(args.limit || 50)) };
            }
            case 'waitForResponse': {
                const pred = urlPredicate(args.urlPattern);
                const resp = await page.waitForResponse((r) => pred(r.url()), { timeout: args.timeout || 15000 });
                const out = { ok: true, action, status: resp.status(), okStatus: resp.ok(), url: resp.url(), method: resp.request().method() };
                const ct = (resp.headers()['content-type'] || '');
                if (/json|text|javascript|xml|html/.test(ct)) {
                    try { out.bodyPreview = cap(await resp.text(), 4000); } catch { /* opaque */ }
                }
                return out;
            }
            case 'waitForRequest': {
                const pred = urlPredicate(args.urlPattern);
                const req = await page.waitForRequest((r) => pred(r.url()), { timeout: args.timeout || 15000 });
                return { ok: true, action, url: req.url(), method: req.method(), resourceType: req.resourceType() };
            }
            case 'mock': {
                if (!args.urlPattern) return { ok: false, error: 'mock requires { urlPattern }' };
                const pred = urlPredicate(args.urlPattern);
                const routeMatcher = (u) => pred(urlStr(u));
                const hasJson = args.json !== undefined;
                const body = hasJson ? JSON.stringify(args.json) : (args.body != null ? String(args.body) : '');
                const contentType = args.contentType || (hasJson ? 'application/json' : 'text/plain');
                const handler = (route) => route.fulfill({ status: args.status || 200, contentType, body });
                await page.route(routeMatcher, handler);
                net.routes.push({ key: String(args.urlPattern), routeMatcher, handler });
                return { ok: true, action, urlPattern: String(args.urlPattern), status: args.status || 200 };
            }
            case 'unmock': {
                let removed = 0;
                const keep = [];
                for (const r of net.routes) {
                    const match = !args.urlPattern || r.key === String(args.urlPattern);
                    if (match) { try { await page.unroute(r.routeMatcher, r.handler); removed++; } catch { /* gone */ } }
                    else keep.push(r);
                }
                net.routes = keep;
                return { ok: true, action, removed };
            }
            case 'offline': {
                await session.context.setOffline(!!args.value);
                return { ok: true, action, offline: !!args.value };
            }
            default:
                return { ok: false, error: `unknown net action: ${action}` };
        }
    } catch (e) {
        return { ok: false, action, error: e.message };
    }
}

module.exports = { netVerb };
