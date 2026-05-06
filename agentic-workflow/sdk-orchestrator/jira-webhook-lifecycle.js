/**
 * Jira Dynamic Webhook Lifecycle Manager
 *
 * Wraps Jira REST v3 webhook lifecycle APIs so the orchestrator server can
 * manage registration, refresh, deletion, and failed deliveries.
 */

const { loadEnv } = require('./utils');

function toTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => toTrimmedString(item))
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }

    return [];
}

function normalizeWebhookIds(value) {
    const values = Array.isArray(value) ? value : [value];
    return values
        .map(item => {
            if (typeof item === 'number' && Number.isFinite(item)) return String(item);
            if (typeof item === 'string' && item.trim()) return item.trim();
            return '';
        })
        .filter(Boolean);
}

function parseBoolean(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value.trim().toLowerCase() === 'true') return true;
        if (value.trim().toLowerCase() === 'false') return false;
    }
    return defaultValue;
}

function parseInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function joinUrl(baseUrl, routePath) {
    const base = toTrimmedString(baseUrl).replace(/\/+$/, '');
    const normalizedPath = `/${toTrimmedString(routePath).replace(/^\/+/, '')}`;
    if (!base) return '';
    return `${base}${normalizedPath}`;
}

function buildJiraLifecycleError(message, status = 400, details = null) {
    const error = new Error(message);
    error.status = status;
    error.details = details;
    return error;
}

function extractJiraErrorMessage(responseBody, responseText) {
    if (responseBody && typeof responseBody === 'object') {
        const messages = [];
        if (Array.isArray(responseBody.errorMessages)) {
            messages.push(...responseBody.errorMessages.filter(Boolean));
        }
        if (responseBody.errors && typeof responseBody.errors === 'object') {
            messages.push(...Object.values(responseBody.errors).filter(Boolean));
        }
        if (typeof responseBody.message === 'string' && responseBody.message.trim()) {
            messages.push(responseBody.message.trim());
        }
        if (messages.length > 0) {
            return messages.join('; ');
        }
    }

    const text = toTrimmedString(responseText);
    return text || 'Jira API request failed';
}

function normalizeJiraWebhookLifecycleConfig(orchestratorConfig = {}) {
    const configured = orchestratorConfig?.sdk?.webhooks?.jira?.lifecycle || {};
    const authMode = toTrimmedString(configured.authMode).toLowerCase();
    const resolvedAuthMode = ['auto', 'app', 'basic'].includes(authMode) ? authMode : 'auto';
    const defaultEvents = normalizeStringArray(configured.events);

    return {
        enabled: configured.enabled === true,
        authMode: resolvedAuthMode,
        cloudIdEnv: toTrimmedString(configured.cloudIdEnv) || 'JIRA_CLOUD_ID',
        baseUrlEnv: toTrimmedString(configured.baseUrlEnv) || 'JIRA_BASE_URL',
        emailEnv: toTrimmedString(configured.emailEnv) || 'JIRA_EMAIL',
        apiTokenEnv: toTrimmedString(configured.apiTokenEnv) || 'JIRA_API_TOKEN',
        appTokenEnv: toTrimmedString(configured.appTokenEnv) || 'JIRA_WEBHOOK_APP_TOKEN',
        callbackBaseUrlEnv: toTrimmedString(configured.callbackBaseUrlEnv) || 'WEBHOOK_PUBLIC_BASE_URL',
        callbackPath: toTrimmedString(configured.callbackPath) || '/api/webhooks/jira',
        defaultWebhookUrl: toTrimmedString(configured.url),
        defaultJqlFilter: toTrimmedString(configured.jqlFilter),
        defaultEvents: defaultEvents.length > 0 ? defaultEvents : ['jira:issue_updated'],
        defaultExcludeBody: parseBoolean(configured.excludeBody, false),
        maxResults: parseInteger(configured.maxResults, 50, 1, 1000),
    };
}

function resolveJiraLifecycleApiBase({ cloudId, baseUrl }) {
    const normalizedCloudId = toTrimmedString(cloudId);
    if (normalizedCloudId) {
        return `https://api.atlassian.com/ex/jira/${normalizedCloudId}/rest/api/3`;
    }

    const normalizedBaseUrl = toTrimmedString(baseUrl).replace(/\/+$/, '');
    if (normalizedBaseUrl) {
        return `${normalizedBaseUrl}/rest/api/3`;
    }

    return '';
}

function resolveJiraLifecycleCallbackUrl(config, env, overrides = {}) {
    const directUrl = toTrimmedString(overrides.url || config.defaultWebhookUrl);
    if (directUrl) {
        return directUrl;
    }

    const callbackBaseUrl = toTrimmedString(
        overrides.callbackBaseUrl
        || env[config.callbackBaseUrlEnv]
        || env.SERVER_PUBLIC_BASE_URL
        || env.PUBLIC_BASE_URL
    );

    if (!callbackBaseUrl) {
        return '';
    }

    return joinUrl(callbackBaseUrl, overrides.callbackPath || config.callbackPath);
}

function resolveJiraLifecycleAuthHeaders(config, env, overrides = {}) {
    const mode = config.authMode;
    const appToken = toTrimmedString(overrides.appToken || env[config.appTokenEnv] || env.ATLASSIAN_APP_TOKEN);
    const email = toTrimmedString(overrides.email || env[config.emailEnv] || env.ATLASSIAN_EMAIL);
    const apiToken = toTrimmedString(overrides.apiToken || env[config.apiTokenEnv] || env.ATLASSIAN_API_TOKEN);

    if ((mode === 'auto' || mode === 'app') && appToken) {
        return {
            ok: true,
            mode: 'app',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${appToken}`,
            },
        };
    }

    if (mode === 'app') {
        return {
            ok: false,
            status: 400,
            error: `Missing app auth token. Set ${config.appTokenEnv} in environment or switch authMode to \"basic\".`,
        };
    }

    if (email && apiToken) {
        return {
            ok: true,
            mode: 'basic',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
            },
        };
    }

    return {
        ok: false,
        status: 400,
        error: `Missing Jira credentials. Set ${config.emailEnv} and ${config.apiTokenEnv} (or ${config.appTokenEnv} for app auth).`,
    };
}

class JiraWebhookLifecycleService {
    constructor(options = {}) {
        loadEnv();
        this._env = options.env || process.env;
        this._fetch = options.fetchImpl || globalThis.fetch;
        this._runtimeConfig = normalizeJiraWebhookLifecycleConfig(options.orchestratorConfig || {});
    }

    updateOrchestratorConfig(orchestratorConfig = {}) {
        this._runtimeConfig = normalizeJiraWebhookLifecycleConfig(orchestratorConfig);
    }

    getRuntimeConfig() {
        const config = this._runtimeConfig;
        return {
            ...config,
            status: {
                hasCloudId: Boolean(toTrimmedString(this._env[config.cloudIdEnv])),
                hasBaseUrl: Boolean(toTrimmedString(this._env[config.baseUrlEnv])),
                hasAppToken: Boolean(toTrimmedString(this._env[config.appTokenEnv] || this._env.ATLASSIAN_APP_TOKEN)),
                hasBasicCredentials: Boolean(
                    toTrimmedString(this._env[config.emailEnv] || this._env.ATLASSIAN_EMAIL)
                    && toTrimmedString(this._env[config.apiTokenEnv] || this._env.ATLASSIAN_API_TOKEN)
                ),
                hasCallbackBaseUrl: Boolean(
                    toTrimmedString(this._env[config.callbackBaseUrlEnv])
                    || toTrimmedString(this._env.SERVER_PUBLIC_BASE_URL)
                    || toTrimmedString(this._env.PUBLIC_BASE_URL)
                    || config.defaultWebhookUrl
                ),
            },
        };
    }

    _ensureEnabled(options = {}) {
        if (this._runtimeConfig.enabled) return;
        if (options.ignoreEnabledGate === true) return;

        throw buildJiraLifecycleError(
            'Jira webhook lifecycle manager is disabled. Enable sdk.webhooks.jira.lifecycle.enabled in workflow-config.json.',
            409
        );
    }

    _resolveConnection(options = {}) {
        if (typeof this._fetch !== 'function') {
            throw buildJiraLifecycleError('Global fetch is unavailable in this runtime.', 500);
        }

        const config = this._runtimeConfig;
        const cloudId = toTrimmedString(options.cloudId || this._env[config.cloudIdEnv]);
        const baseUrl = toTrimmedString(options.baseUrl || this._env[config.baseUrlEnv]);
        const apiBase = resolveJiraLifecycleApiBase({ cloudId, baseUrl });

        if (!apiBase) {
            throw buildJiraLifecycleError(
                `Missing Jira API base. Set ${config.cloudIdEnv} or ${config.baseUrlEnv} in environment.`,
                400
            );
        }

        const auth = resolveJiraLifecycleAuthHeaders(config, this._env, options);
        if (!auth.ok) {
            throw buildJiraLifecycleError(auth.error, auth.status || 400);
        }

        return {
            apiBase,
            headers: auth.headers,
            authMode: auth.mode,
            cloudId,
            baseUrl,
        };
    }

    async _request(relativePath, options = {}, connection) {
        const requestUrl = new URL(`${connection.apiBase}${relativePath}`);
        const query = options.query || {};

        for (const [key, rawValue] of Object.entries(query)) {
            if (rawValue === undefined || rawValue === null || rawValue === '') continue;
            if (Array.isArray(rawValue)) {
                for (const item of rawValue) {
                    if (item === undefined || item === null || item === '') continue;
                    requestUrl.searchParams.append(key, String(item));
                }
            } else {
                requestUrl.searchParams.append(key, String(rawValue));
            }
        }

        const init = {
            method: options.method || 'GET',
            headers: {
                ...connection.headers,
                ...(options.headers || {}),
            },
        };

        if (options.body !== undefined) {
            init.body = JSON.stringify(options.body);
        }

        const response = await this._fetch(requestUrl.toString(), init);
        const responseText = await response.text();

        let responseBody = null;
        if (responseText) {
            try {
                responseBody = JSON.parse(responseText);
            } catch {
                responseBody = null;
            }
        }

        if (!response.ok) {
            const message = extractJiraErrorMessage(responseBody, responseText);
            throw buildJiraLifecycleError(
                `Jira webhook lifecycle request failed (${response.status} ${response.statusText}): ${message}`,
                response.status,
                responseBody || responseText
            );
        }

        return responseBody || (responseText ? { raw: responseText } : {});
    }

    async listWebhooks(options = {}) {
        this._ensureEnabled(options);
        const connection = this._resolveConnection(options);
        const maxResults = parseInteger(options.maxResults, this._runtimeConfig.maxResults, 1, 1000);
        const startAt = parseInteger(options.startAt, 0, 0, Number.MAX_SAFE_INTEGER);

        const response = await this._request('/webhook', {
            method: 'GET',
            query: {
                startAt,
                maxResults,
            },
        }, connection);

        const webhooks = Array.isArray(response?.values)
            ? response.values
            : Array.isArray(response?.webhooks)
                ? response.webhooks
                : Array.isArray(response)
                    ? response
                    : [];

        return {
            startAt,
            maxResults,
            total: typeof response?.total === 'number' ? response.total : webhooks.length,
            webhooks,
            authMode: connection.authMode,
            response,
        };
    }

    async registerWebhook(options = {}) {
        this._ensureEnabled(options);
        const connection = this._resolveConnection(options);

        const jqlFilter = toTrimmedString(options.jqlFilter) || this._runtimeConfig.defaultJqlFilter;
        if (!jqlFilter) {
            throw buildJiraLifecycleError('Missing jqlFilter. Provide a JQL string in request body or lifecycle config.', 400);
        }

        const events = normalizeStringArray(options.events);
        const resolvedEvents = events.length > 0 ? events : this._runtimeConfig.defaultEvents;
        if (resolvedEvents.length === 0) {
            throw buildJiraLifecycleError('Missing events for dynamic webhook registration.', 400);
        }

        const callbackUrl = resolveJiraLifecycleCallbackUrl(this._runtimeConfig, this._env, options);
        if (!callbackUrl) {
            throw buildJiraLifecycleError(
                `Missing callback URL. Provide url in request body or set ${this._runtimeConfig.callbackBaseUrlEnv} in environment.`,
                400
            );
        }

        const webhookDefinition = {
            jqlFilter,
            events: resolvedEvents,
            excludeBody: typeof options.excludeBody === 'boolean'
                ? options.excludeBody
                : this._runtimeConfig.defaultExcludeBody,
        };

        const issuePropertyKeysFilter = normalizeStringArray(options.issuePropertyKeysFilter);
        if (issuePropertyKeysFilter.length > 0) {
            webhookDefinition.issuePropertyKeysFilter = issuePropertyKeysFilter;
        }

        const fieldIdsFilter = normalizeStringArray(options.fieldIdsFilter);
        if (fieldIdsFilter.length > 0) {
            webhookDefinition.fieldIdsFilter = fieldIdsFilter;
        }

        const response = await this._request('/webhook', {
            method: 'POST',
            body: {
                url: callbackUrl,
                webhooks: [webhookDefinition],
            },
        }, connection);

        return {
            callbackUrl,
            webhook: webhookDefinition,
            createdWebhookIds: normalizeWebhookIds(response?.createdWebhookId || response?.createdWebhookIds),
            authMode: connection.authMode,
            response,
        };
    }

    async refreshWebhooks(options = {}) {
        this._ensureEnabled(options);
        const connection = this._resolveConnection(options);

        let webhookIds = normalizeWebhookIds(options.webhookIds);
        if (webhookIds.length === 0 && options.refreshAll === true) {
            const listed = await this.listWebhooks({ ...options, ignoreEnabledGate: true });
            webhookIds = normalizeWebhookIds(listed.webhooks.map(item => item.id || item.webhookId));
        }

        if (webhookIds.length === 0) {
            throw buildJiraLifecycleError('Missing webhookIds. Provide webhookIds[] or set refreshAll=true.', 400);
        }

        const response = await this._request('/webhook/refresh', {
            method: 'PUT',
            body: {
                webhookIds,
            },
        }, connection);

        return {
            refreshedWebhookIds: webhookIds,
            authMode: connection.authMode,
            response,
        };
    }

    async getFailedWebhooks(options = {}) {
        this._ensureEnabled(options);
        const connection = this._resolveConnection(options);
        const maxResults = parseInteger(options.maxResults, this._runtimeConfig.maxResults, 1, 1000);

        const response = await this._request('/webhook/failed', {
            method: 'GET',
            query: {
                maxResults,
            },
        }, connection);

        return {
            failed: Array.isArray(response?.values)
                ? response.values
                : Array.isArray(response?.failed)
                    ? response.failed
                    : Array.isArray(response)
                        ? response
                        : [],
            authMode: connection.authMode,
            response,
        };
    }

    async deleteWebhooks(options = {}) {
        this._ensureEnabled(options);
        const connection = this._resolveConnection(options);
        const webhookIds = normalizeWebhookIds(options.webhookIds);

        if (webhookIds.length === 0) {
            throw buildJiraLifecycleError('Missing webhookIds. Provide one or more webhook IDs to delete.', 400);
        }

        const response = await this._request('/webhook', {
            method: 'DELETE',
            query: {
                webhookIds,
            },
        }, connection);

        return {
            deletedWebhookIds: webhookIds,
            authMode: connection.authMode,
            response,
        };
    }
}

module.exports = {
    JiraWebhookLifecycleService,
    normalizeJiraWebhookLifecycleConfig,
    resolveJiraLifecycleApiBase,
    resolveJiraLifecycleCallbackUrl,
    resolveJiraLifecycleAuthHeaders,
    normalizeWebhookIds,
};
