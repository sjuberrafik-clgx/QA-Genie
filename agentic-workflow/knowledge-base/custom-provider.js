/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOM REST PROVIDER — Generic REST API Knowledge Base (Skeleton)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generic provider for any REST API that can serve knowledge base content.
 * Fully config-driven — endpoint URLs, auth, and response mapping are
 * defined in grounding-config.json.
 *
 * To activate, add provider config in grounding-config.json:
 *   {
 *       "type": "custom",
 *       "name": "My Internal Wiki",
 *       "baseUrl": "https://wiki.internal.com/api",
 *       "auth": { "type": "bearer", "tokenEnvVar": "WIKI_API_TOKEN" },
 *       "endpoints": {
 *           "search": { "path": "/search", "queryParam": "q", "method": "GET" },
 *           "getPage": { "path": "/pages/{id}", "method": "GET" },
 *           "listSpaces": { "path": "/spaces", "method": "GET" }
 *       },
 *       "responseMapping": {
 *           "search": {
 *               "resultsPath": "data.results",
 *               "id": "id", "title": "title", "content": "body",
 *               "url": "url", "lastModified": "updated_at"
 *           },
 *           "getPage": {
 *               "id": "id", "title": "title", "content": "body",
 *               "url": "url", "lastModified": "updated_at"
 *           }
 *       }
 *   }
 *
 * @module custom-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { KBProvider, createExcerpt } = require('./kb-provider');

class CustomProvider extends KBProvider {
    constructor(config = {}) {
        super({ ...config, type: 'custom' });

        this.baseUrl = config.baseUrl || '';
        this.authConfig = config.auth || {};
        this.endpoints = config.endpoints || {};
        this.responseMapping = config.responseMapping || {};
        this.headers = config.headers || {};
        this.verbose = config.verbose || false;

        if (!this.baseUrl) {
            throw new Error('CustomProvider requires a baseUrl');
        }

        this._client = null;
    }

    async _ensureClient() {
        if (this._client) return;

        const axios = require('axios');
        const authHeaders = this._buildAuthHeaders();

        this._client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                ...this.headers,
                ...authHeaders,
            },
            timeout: 30000,
        });
    }

    _buildAuthHeaders() {
        const { type, tokenEnvVar, token, username, password } = this.authConfig;

        switch (type) {
            case 'bearer': {
                const bearerToken = token || process.env[tokenEnvVar] || '';
                return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
            }
            case 'basic': {
                const user = username || process.env[this.authConfig.usernameEnvVar] || '';
                const pass = password || process.env[this.authConfig.passwordEnvVar] || '';
                if (user && pass) {
                    const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
                    return { Authorization: `Basic ${encoded}` };
                }
                return {};
            }
            case 'api-key': {
                const key = token || process.env[tokenEnvVar] || '';
                const headerName = this.authConfig.headerName || 'X-API-Key';
                return key ? { [headerName]: key } : {};
            }
            default:
                return {};
        }
    }

    async search(query, options = {}) {
        await this._ensureClient();
        const endpoint = this.endpoints.search;
        if (!endpoint) throw new Error('No search endpoint configured');

        const maxResults = options.maxResults || 10;
        const method = (endpoint.method || 'GET').toUpperCase();
        const path = endpoint.path || '/search';
        const queryParam = endpoint.queryParam || 'q';

        try {
            let response;
            if (method === 'GET') {
                response = await this._client.get(path, {
                    params: { [queryParam]: query, limit: maxResults, ...endpoint.extraParams },
                });
            } else {
                response = await this._client.post(path, {
                    query,
                    limit: maxResults,
                    ...endpoint.extraParams,
                });
            }

            const mapping = this.responseMapping.search || {};
            const results = this._resolvePath(response.data, mapping.resultsPath || 'results') || [];

            return results.slice(0, maxResults).map(item => this._mapToKBResult(item, mapping));
        } catch (error) {
            throw new Error(`Custom search failed: ${error.message}`);
        }
    }

    async getPage(pageId) {
        await this._ensureClient();
        const endpoint = this.endpoints.getPage;
        if (!endpoint) throw new Error('No getPage endpoint configured');

        const path = (endpoint.path || '/pages/{id}').replace('{id}', pageId);

        try {
            const response = await this._client.get(path);
            const mapping = this.responseMapping.getPage || this.responseMapping.search || {};
            return this._mapToKBResult(response.data, mapping);
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw new Error(`Custom getPage failed: ${error.message}`);
        }
    }

    async getPageTree(rootPageId, options = {}) {
        // Generic implementation: fetch root page and search for related content
        const allPages = [];

        try {
            const rootPage = await this.getPage(rootPageId);
            if (rootPage) {
                allPages.push(rootPage);
                // If there's a children endpoint, use it
                const childrenEndpoint = this.endpoints.getChildren;
                if (childrenEndpoint) {
                    await this._ensureClient();
                    const path = (childrenEndpoint.path || '/pages/{id}/children').replace('{id}', rootPageId);
                    const response = await this._client.get(path);
                    const mapping = this.responseMapping.getPage || {};
                    const resultsPath = childrenEndpoint.resultsPath || 'results';
                    const children = this._resolvePath(response.data, resultsPath) || [];
                    allPages.push(...children.map(c => this._mapToKBResult(c, mapping)));
                }
            }
        } catch (error) {
            this._log(`Page tree fetch failed: ${error.message}`);
        }

        return allPages;
    }

    async testConnection() {
        const startTime = Date.now();
        try {
            await this._ensureClient();
            // Try health endpoint, then list endpoint, then a simple search
            const healthPath = this.endpoints.health?.path || this.endpoints.listSpaces?.path;
            if (healthPath) {
                await this._client.get(healthPath);
            } else {
                await this.search('test', { maxResults: 1 });
            }
            return {
                connected: true,
                provider: this.getProviderName(),
                message: `Connected to ${this.baseUrl}`,
                latencyMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                connected: false,
                provider: this.getProviderName(),
                message: `Connection failed: ${error.message}`,
                latencyMs: Date.now() - startTime,
            };
        }
    }

    async listSpaces() {
        await this._ensureClient();
        const endpoint = this.endpoints.listSpaces;
        if (!endpoint) return [{ key: 'default', name: this.name || 'Custom KB', url: this.baseUrl }];

        try {
            const response = await this._client.get(endpoint.path || '/spaces');
            const mapping = endpoint.responseMapping || {};
            const resultsPath = mapping.resultsPath || 'results';
            const items = this._resolvePath(response.data, resultsPath) || [];

            return items.map(item => ({
                key: item[mapping.key || 'id'] || '',
                name: item[mapping.name || 'name'] || 'Unknown',
                url: item[mapping.url || 'url'] || '',
            }));
        } catch (error) {
            throw new Error(`Failed to list spaces: ${error.message}`);
        }
    }

    /**
     * Maps a raw API response item to a standardized KBResult
     */
    _mapToKBResult(item, mapping = {}) {
        if (!item) return null;
        const content = String(this._resolvePath(item, mapping.content || 'content') || '');

        return {
            id: String(this._resolvePath(item, mapping.id || 'id') || ''),
            title: String(this._resolvePath(item, mapping.title || 'title') || 'Untitled'),
            content,
            excerpt: createExcerpt(content),
            url: String(this._resolvePath(item, mapping.url || 'url') || ''),
            space: String(this._resolvePath(item, mapping.space || 'space') || 'default'),
            lastModified: String(this._resolvePath(item, mapping.lastModified || 'lastModified') || new Date().toISOString()),
            metadata: {
                provider: 'custom',
                status: String(this._resolvePath(item, mapping.status || 'status') || 'current'),
                labels: this._resolvePath(item, mapping.labels || 'labels') || [],
                author: String(this._resolvePath(item, mapping.author || 'author') || ''),
                parentId: String(this._resolvePath(item, mapping.parentId || 'parentId') || ''),
            },
        };
    }

    /**
     * Resolve a dot-separated path on an object.
     * E.g., _resolvePath({ a: { b: [1,2] } }, 'a.b') → [1,2]
     */
    _resolvePath(obj, path) {
        if (!obj || !path) return obj;
        return path.split('.').reduce((acc, part) => acc?.[part], obj);
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[CustomProvider] ${message}`);
        }
    }
}

module.exports = { CustomProvider };
