'use strict';
/**
 * GLASS · VERB `do` — act on a target, return a verifiable effect receipt.
 *   do({ target, action, value?, allow? })
 *     target : handle | "natural name" | { role,name | text | css | at:[x,y] | handle, frame? }
 *     action : click | type | fill | hover | press | select | check | uncheck | scrollIntoView
 *     allow  : reserved for opt-in cognition (e.g. ['dismiss','vision']) — audited, off by default
 *
 * Action-as-transaction (Claim 6): captures before/after state and returns
 * { effect:{ navigated, urlChanged, domChanged } } so the agent can confirm success.
 * A click that produces no observable change is flagged (warning) but not failed
 * (no-op buttons legitimately do nothing).
 *
 * @module glass-mcp/verbs/do
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTarget } = require('../resolve');

async function captureState(page) {
    try {
        return await page.evaluate(() => ({
            url: location.href,
            sig: document.body
                ? document.body.childElementCount + ':' + (document.body.innerText || '').length
                : '',
        }));
    } catch {
        return { url: '', sig: '' };
    }
}

async function doVerb(session, args = {}) {
    await session.ensure();
    const page = session.page;
    const action = args.action || 'click';
    const value = args.value;

    // ── screenshot: CDP-backed (devtool). Target optional: element clip vs full page. ──
    if (action === 'screenshot') {
        return screenshotAction(session, page, args);
    }

    const res = await resolveTarget(page, args.target);
    if (!res.ok && !res.at) {
        return { ok: false, error: 'target not found', action, audit: res.audit };
    }

    const before = await captureState(page);
    const isMutating = action !== 'type' && action !== 'fill' && action !== 'hover';
    let uploadedFiles = null;
    try {
        if (res.at) {
            await page.mouse.click(res.at[0], res.at[1]);
        } else {
            const loc = res.locator;
            switch (action) {
                case 'click': await loc.click({ timeout: args.timeout || 15000 }); break;
                case 'type':
                case 'fill': await loc.fill(value == null ? '' : String(value), { timeout: args.timeout || 15000 }); break;
                case 'hover': await loc.hover({ timeout: args.timeout || 15000 }); break;
                case 'press': await loc.press(value || 'Enter'); break;
                case 'select': await loc.selectOption(value); break;
                case 'check': await loc.check({ timeout: args.timeout || 15000 }); break;
                case 'uncheck': await loc.uncheck({ timeout: args.timeout || 15000 }); break;
                case 'scrollIntoView': await loc.scrollIntoViewIfNeeded(); break;
                case 'upload': {
                    const files = Array.isArray(args.files)
                        ? args.files
                        : (args.files != null ? [args.files] : (value != null ? [String(value)] : []));
                    if (!files.length) return { ok: false, error: 'upload requires { files: string | string[] }', action, audit: res.audit };
                    await loc.setInputFiles(files, { timeout: args.timeout || 15000 });
                    uploadedFiles = files;
                    break;
                }
                default: return { ok: false, error: `unknown action: ${action}`, audit: res.audit };
            }
        }
    } catch (e) {
        return { ok: false, error: e.message, action, audit: res.audit };
    }

    const after = await captureState(page);
    const effect = {
        navigated: before.url !== after.url,
        urlChanged: before.url !== after.url,
        domChanged: before.sig !== after.sig,
    };
    const out = { ok: true, action, effect, audit: res.audit };
    if (value !== undefined && (action === 'type' || action === 'fill')) out.value = String(value);
    if (uploadedFiles) out.files = uploadedFiles;
    if (isMutating && action === 'click' && !effect.urlChanged && !effect.domChanged) {
        out.warning = 'click produced no observable effect (URL/DOM unchanged)';
    }
    return out;
}

/**
 * CDP-backed screenshot (Page.captureScreenshot). Element clip when a target is
 * given, else full page. Saves to a file by default (lean — no base64 in the
 * receipt) unless { returnData:true } is requested.
 */
async function screenshotAction(session, page, args) {
    try {
        let clip;
        let audit;
        if (args.target) {
            const res = await resolveTarget(page, args.target);
            if (!res.ok || !res.locator) return { ok: false, action: 'screenshot', error: 'target not found', audit: res.audit };
            audit = res.audit;
            await res.locator.scrollIntoViewIfNeeded().catch(() => { /* best effort */ });
            const box = await res.locator.boundingBox();
            if (box) clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
        }
        const cdp = await session.cdpFor(page);
        const params = { format: 'png', captureBeyondViewport: !clip && args.fullPage !== false };
        if (clip) params.clip = clip;
        const { data } = await cdp.send('Page.captureScreenshot', params);
        const buf = Buffer.from(data, 'base64');
        const out = { ok: true, action: 'screenshot', bytes: buf.length, audit };
        if (args.returnData) {
            out.encoding = 'base64';
            out.data = data;
        } else {
            const dest = args.path || path.join(os.tmpdir(), `glass-shot-${Date.now()}.png`);
            fs.writeFileSync(dest, buf);
            out.path = dest;
        }
        return out;
    } catch (e) {
        return { ok: false, action: 'screenshot', error: e.message };
    }
}

module.exports = { doVerb, captureState };
