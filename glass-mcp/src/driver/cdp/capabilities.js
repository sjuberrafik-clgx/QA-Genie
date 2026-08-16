'use strict';

const BROWSER_SCOPED_DOMAINS = new Set(['Browser', 'SystemInfo', 'Target', 'Tethering']);

async function loadProtocolCatalog(browserWsUrl, options = {}) {
    const endpoint = protocolHttpUrl(browserWsUrl, '/json/protocol');
    const controller = new AbortController();
    const timeout = options.timeout || 5000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(`protocol discovery failed: HTTP ${response.status}`);
        return buildProtocolCatalog(await response.json());
    } finally {
        clearTimeout(timer);
    }
}

function buildProtocolCatalog(schema = {}) {
    const domains = [];
    const methods = new Map();
    let eventCount = 0;
    let typeCount = 0;
    let experimentalMethods = 0;
    let deprecatedMethods = 0;

    for (const domain of schema.domains || []) {
        if (!domain || !domain.domain) continue;
        domains.push(domain.domain);
        eventCount += Array.isArray(domain.events) ? domain.events.length : 0;
        typeCount += Array.isArray(domain.types) ? domain.types.length : 0;
        for (const command of domain.commands || []) {
            if (!command || !command.name) continue;
            const method = `${domain.domain}.${command.name}`;
            const info = {
                domain: domain.domain,
                experimental: command.experimental === true || domain.experimental === true,
                deprecated: command.deprecated === true || domain.deprecated === true,
            };
            methods.set(method, info);
            if (info.experimental) experimentalMethods++;
            if (info.deprecated) deprecatedMethods++;
        }
    }

    domains.sort();
    return Object.freeze({
        domainCount: domains.length,
        commandCount: methods.size,
        eventCount,
        typeCount,
        experimentalMethods,
        deprecatedMethods,
        domains: Object.freeze(domains),
        hasMethod(method) { return methods.has(method); },
        methodInfo(method) { return methods.get(method) || null; },
        scopeFor(method) {
            const domain = String(method || '').split('.')[0];
            return BROWSER_SCOPED_DOMAINS.has(domain) ? 'browser' : 'page';
        },
    });
}

function protocolHttpUrl(browserWsUrl, pathname) {
    const endpoint = new URL(browserWsUrl);
    endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
    endpoint.pathname = pathname;
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint.toString();
}

module.exports = { BROWSER_SCOPED_DOMAINS, buildProtocolCatalog, loadProtocolCatalog, protocolHttpUrl };