'use strict';
/**
 * GLASS · VERB `open` — navigation + tab lifecycle.
 *   open({url})                         goto
 *   open({action:'back'|'forward'|'reload'})
 *   open({action:'newTab', url?})
 *   open({action:'switchTab', tab})
 *   open({action:'closeTab', tab?})
 *   open({action:'tabs'})               list
 * Returns an effect receipt: { ok, url, title, tab, ... }.
 * @module glass-mcp/verbs/open
 */

async function openVerb(session, args = {}) {
    await session.ensure();
    const action = args.action || 'goto';
    const page = session.page;

    try {
        switch (action) {
            case 'goto': {
                if (!args.url) return { ok: false, error: 'open requires a url' };
                const resp = await page.goto(args.url, {
                    waitUntil: args.waitUntil || 'domcontentloaded',
                    timeout: args.timeout || 30000,
                });
                return await receipt(session, { status: resp ? resp.status() : null });
            }
            case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); return await receipt(session);
            case 'forward': await page.goForward({ waitUntil: 'domcontentloaded' }); return await receipt(session);
            case 'reload': await page.reload({ waitUntil: 'domcontentloaded' }); return await receipt(session);
            case 'newTab': { await session.newTab(args.url); return await receipt(session, { opened: true }); }
            case 'switchTab': {
                const okSwitch = session.switchTab(args.tab);
                return okSwitch ? await receipt(session) : { ok: false, error: `tab not found: ${args.tab}` };
            }
            case 'closeTab': { await session.closeTab(args.tab); return await receipt(session, { closed: true }); }
            case 'tabs': return { ok: true, tabs: session.listTabs(), activeTab: session.activeTabId() };
            default: return { ok: false, error: `unknown open action: ${action}` };
        }
    } catch (e) {
        return { ok: false, error: e.message, action };
    }
}

async function receipt(session, extra = {}) {
    const page = session.page;
    let title = '';
    try { title = await page.title(); } catch { /* ignore */ }
    return { ok: true, url: page ? page.url() : null, title, tab: session.activeTabId(), ...extra };
}

module.exports = { openVerb };
