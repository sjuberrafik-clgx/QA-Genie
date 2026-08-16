'use strict';

function isTimeoutError(error) {
    const name = String(error && error.name || '');
    const message = String(error && error.message || '');
    return name === 'TimeoutError' || /timed?\s*out|timeout|condition not met/i.test(message);
}

function compactError(error, fallback = 'operation failed') {
    const message = String(error && error.message || fallback)
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split('\n')[0]
        .trim();
    return (message || fallback).slice(0, 500);
}

function sanitizeUrl(rawUrl) {
    const value = String(rawUrl || '');
    if (!value) return '';
    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'file:') return `file://${parsed.pathname}`;
        if (!/^https?:$/.test(parsed.protocol)) return parsed.protocol;
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return value.split(/[?#]/)[0].slice(0, 300);
    }
}

async function pageState(page) {
    let rawUrl = '';
    let title = '';
    try { rawUrl = await Promise.resolve(page && page.url()); } catch { /* unavailable */ }
    try { title = await Promise.resolve(page && page.title()); } catch { /* unavailable */ }
    return { url: sanitizeUrl(rawUrl), title: String(title || '').slice(0, 160) };
}

function authDiagnostic(state) {
    const route = String(state && state.url || '');
    const title = String(state && state.title || '');
    const authRequired = /(?:^|\/)(?:login|sign-?in|signin|auth)(?:\/|$)/i.test(route)
        || /\b(?:agent\s+)?(?:login|sign\s*in)\b/i.test(title);
    if (!authRequired) return null;
    return {
        authRequired: true,
        hint: 'The browser is still on an authentication page. Verify authenticated destination URL or an authenticated-only element before continuing.',
    };
}

async function waitFailure(page, condition, timeout, startedAt, error) {
    const state = await pageState(page);
    const timedOut = isTimeoutError(error);
    let diagnostic = authDiagnostic(state);
    if (!diagnostic && condition === 'networkidle') {
        diagnostic = {
            persistentNetworkPossible: true,
            hint: 'This page may keep background requests open. Prefer domcontentloaded plus a visible, page-specific target for readiness.',
        };
    }
    return {
        ok: false,
        code: timedOut ? 'GLASS_WAIT_TIMEOUT' : 'GLASS_WAIT_ERROR',
        for: condition,
        condition,
        error: timedOut
            ? `timed out after ${timeout}ms waiting for ${condition}`
            : String(error && error.message || 'wait failed').split('\n')[0].slice(0, 500),
        waitedMs: Date.now() - startedAt,
        page: state,
        ...(diagnostic ? { diagnostic } : {}),
    };
}

function immediateMatchDetails(condition, observed) {
    return {
        matchedImmediately: true,
        observed: sanitizeUrl(observed),
        warning: `${condition} already matched when wait started; this does not prove navigation or a state transition occurred.`,
    };
}

module.exports = { authDiagnostic, compactError, immediateMatchDetails, isTimeoutError, pageState, sanitizeUrl, waitFailure };