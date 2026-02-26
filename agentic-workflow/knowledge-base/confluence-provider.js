/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONFLUENCE PROVIDER — Atlassian Confluence Knowledge Base Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the KBProvider interface for Atlassian Confluence Cloud.
 * Uses Confluence REST API v2 (and v1 where needed) to search pages,
 * fetch page content, and traverse page trees.
 *
 * Authentication: Basic Auth using JIRA_EMAIL + JIRA_API_TOKEN
 * (same credentials used for Jira — they share the same Atlassian Cloud instance).
 *
 * Features:
 *   - CQL-based search across configured spaces
 *   - Page tree traversal (parent → children → grandchildren)
 *   - HTML-to-plain-text conversion for page body
 *   - Rate limiting (configurable max concurrency + inter-request delay)
 *   - Retry with exponential backoff (3 attempts)
 *
 * @module confluence-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const { KBProvider, htmlToPlainText, createExcerpt } = require('./kb-provider');

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;    // 1s, 2s, 4s
const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_INTER_REQUEST_MS = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// ─── Rate Limiter ───────────────────────────────────────────────────────────

class RateLimiter {
    /**
     * @param {number} maxConcurrent - Maximum concurrent requests
     * @param {number} interRequestMs - Minimum time between request starts
     */
    constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT, interRequestMs = DEFAULT_INTER_REQUEST_MS) {
        this.maxConcurrent = maxConcurrent;
        this.interRequestMs = interRequestMs;
        this._active = 0;
        this._lastRequestTime = 0;
        this._queue = [];
    }

    async acquire() {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                const now = Date.now();
                const timeSinceLastRequest = now - this._lastRequestTime;

                if (this._active < this.maxConcurrent && timeSinceLastRequest >= this.interRequestMs) {
                    this._active++;
                    this._lastRequestTime = Date.now();
                    resolve();
                } else {
                    const waitTime = Math.max(
                        this.interRequestMs - timeSinceLastRequest,
                        this._active >= this.maxConcurrent ? 100 : 0
                    );
                    setTimeout(tryAcquire, Math.max(waitTime, 50));
                }
            };
            tryAcquire();
        });
    }

    release() {
        this._active = Math.max(0, this._active - 1);
    }
}

// ─── Confluence Provider ────────────────────────────────────────────────────

class ConfluenceProvider extends KBProvider {
    /**
     * @param {Object} config
     * @param {string}   config.baseUrl     - Confluence base URL (e.g., 'https://corelogic.atlassian.net/wiki')
     * @param {string[]} [config.spaceKeys] - Space keys to search (e.g., ['AOTF', 'QA'])
     * @param {string}   [config.email]     - Atlassian email (falls back to process.env.JIRA_EMAIL)
     * @param {string}   [config.apiToken]  - Atlassian API token (falls back to process.env.JIRA_API_TOKEN)
     * @param {string}   [config.cqlFilter] - Additional CQL filter (e.g., 'label = "qa-knowledge"')
     * @param {number}   [config.maxDepth]  - Default tree traversal depth
     * @param {number}   [config.maxConcurrent] - Rate limiter max concurrent requests
     * @param {number}   [config.interRequestMs] - Rate limiter inter-request delay
     * @param {boolean}  [config.verbose]   - Enable debug logging
     */
    constructor(config = {}) {
        super({ ...config, type: 'confluence' });

        // Resolve base URL — strip trailing /wiki if user provides full Jira URL
        let baseUrl = config.baseUrl || process.env.JIRA_BASE_URL || '';
        baseUrl = baseUrl.replace(/\/+$/, '');
        if (!baseUrl.endsWith('/wiki')) {
            baseUrl += '/wiki';
        }
        this.baseUrl = baseUrl;

        // Auth
        this.email = config.email || process.env.JIRA_EMAIL || '';
        this.apiToken = config.apiToken || process.env.JIRA_API_TOKEN || '';

        // Space filter
        this.spaceKeys = config.spaceKeys || (process.env.CONFLUENCE_SPACE_KEYS || '').split(',').filter(Boolean);

        // Optional CQL filter
        this.cqlFilter = config.cqlFilter || '';

        // Tree depth
        this.maxDepth = config.maxDepth || parseInt(process.env.CONFLUENCE_PAGE_TREE_DEPTH || '3', 10);

        // Rate limiting
        this._rateLimiter = new RateLimiter(
            config.maxConcurrent || DEFAULT_MAX_CONCURRENT,
            config.interRequestMs || DEFAULT_INTER_REQUEST_MS
        );

        this.verbose = config.verbose || false;

        // Create axios instance with defaults
        this._client = axios.create({
            baseURL: this.baseUrl,
            timeout: config.requestTimeout || DEFAULT_REQUEST_TIMEOUT_MS,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            auth: this.email && this.apiToken ? {
                username: this.email,
                password: this.apiToken,
            } : undefined,
        });
    }

    // ─── Interface Implementation ───────────────────────────────────

    /**
     * Search Confluence pages using CQL (Confluence Query Language).
     *
     * @param {string} query - Search text
     * @param {import('./kb-provider').KBSearchOptions} [options]
     * @returns {Promise<import('./kb-provider').KBResult[]>}
     */
    async search(query, options = {}) {
        const maxResults = options.maxResults || 10;
        const spaceKeys = options.spaceKey ? [options.spaceKey] : this.spaceKeys;
        const includeBody = options.includeBody !== false;

        // Build CQL query
        const cqlParts = [];

        // Text search
        cqlParts.push(`text ~ "${this._escapeCQL(query)}"`);

        // Type filter — pages only (exclude blog posts, comments by default)
        cqlParts.push('type = page');

        // Space filter
        if (spaceKeys.length > 0) {
            const spaceFilter = spaceKeys.map(k => `"${k}"`).join(',');
            cqlParts.push(`space IN (${spaceFilter})`);
        }

        // Label filter
        if (options.labels?.length > 0) {
            for (const label of options.labels) {
                cqlParts.push(`label = "${this._escapeCQL(label)}"`);
            }
        }

        // Additional CQL filter from config
        if (this.cqlFilter) {
            cqlParts.push(`(${this.cqlFilter})`);
        }

        // Additional CQL filter from options
        if (options.cqlFilter) {
            cqlParts.push(`(${options.cqlFilter})`);
        }

        const cql = cqlParts.join(' AND ');
        this._log(`CQL query: ${cql}`);

        try {
            const response = await this._requestWithRetry('GET', '/rest/api/content/search', {
                params: {
                    cql,
                    limit: maxResults,
                    expand: includeBody
                        ? 'body.storage,version,space,metadata.labels,ancestors'
                        : 'version,space,metadata.labels,ancestors',
                },
            });

            const results = (response.data.results || []).map(page =>
                this._convertToKBResult(page, includeBody)
            );

            this._log(`Search returned ${results.length} results for "${query}"`);
            return results;
        } catch (error) {
            this._log(`Search failed: ${error.message}`);
            throw new Error(`Confluence search failed: ${error.message}`);
        }
    }

    /**
     * Retrieve a single Confluence page by ID.
     *
     * @param {string} pageId - Confluence page ID
     * @returns {Promise<import('./kb-provider').KBResult|null>}
     */
    async getPage(pageId) {
        try {
            const response = await this._requestWithRetry('GET', `/rest/api/content/${pageId}`, {
                params: {
                    expand: 'body.storage,version,space,metadata.labels,ancestors,children.page',
                },
            });

            return this._convertToKBResult(response.data, true);
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw new Error(`Confluence getPage failed for ${pageId}: ${error.message}`);
        }
    }

    /**
     * Retrieve a page and all its descendants up to a given depth.
     *
     * @param {string} rootPageId - Root page ID
     * @param {import('./kb-provider').KBPageTreeOptions} [options]
     * @returns {Promise<import('./kb-provider').KBResult[]>}
     */
    async getPageTree(rootPageId, options = {}) {
        const maxDepth = options.depth || this.maxDepth;
        const includeBody = options.includeBody !== false;
        const allPages = [];

        const fetchLevel = async (pageIds, currentDepth) => {
            if (currentDepth > maxDepth || pageIds.length === 0) return;

            for (const pid of pageIds) {
                try {
                    // Fetch the page itself
                    const page = await this.getPage(pid);
                    if (page) {
                        allPages.push(page);
                    }

                    // Fetch children
                    const children = await this._getChildPages(pid);
                    if (children.length > 0) {
                        await fetchLevel(children.map(c => c.id), currentDepth + 1);
                    }
                } catch (error) {
                    this._log(`Error fetching page ${pid} at depth ${currentDepth}: ${error.message}`);
                }
            }
        };

        await fetchLevel([rootPageId], 1);
        this._log(`Page tree: ${allPages.length} pages from root ${rootPageId} (depth: ${maxDepth})`);

        return allPages;
    }

    /**
     * Test Confluence connection by calling the current user endpoint.
     *
     * @returns {Promise<import('./kb-provider').KBConnectionStatus>}
     */
    async testConnection() {
        const startTime = Date.now();
        try {
            // Use the space list endpoint to verify both auth and Confluence access
            const response = await this._requestWithRetry('GET', '/rest/api/space', {
                params: { limit: 1 },
            });

            const latencyMs = Date.now() - startTime;
            return {
                connected: true,
                provider: this.getProviderName(),
                message: `Connected to Confluence at ${this.baseUrl} (${response.data?.size || 0} spaces accessible)`,
                latencyMs,
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

    /**
     * List available Confluence spaces.
     *
     * @returns {Promise<Array<{key: string, name: string, url: string}>>}
     */
    async listSpaces() {
        try {
            const response = await this._requestWithRetry('GET', '/rest/api/space', {
                params: {
                    limit: 100,
                    type: 'global',
                    expand: 'description.plain',
                },
            });

            return (response.data.results || []).map(space => ({
                key: space.key,
                name: space.name,
                url: `${this.baseUrl}/spaces/${space.key}`,
                description: space.description?.plain?.value || '',
            }));
        } catch (error) {
            throw new Error(`Failed to list Confluence spaces: ${error.message}`);
        }
    }

    // ─── Internal Helpers ───────────────────────────────────────────

    /**
     * Make an HTTP request with rate limiting and exponential backoff retry.
     *
     * @param {string} method - HTTP method
     * @param {string} endpoint - API endpoint path
     * @param {Object} [axiosConfig] - Additional axios config (params, data, etc.)
     * @returns {Promise<import('axios').AxiosResponse>}
     */
    async _requestWithRetry(method, endpoint, axiosConfig = {}) {
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await this._rateLimiter.acquire();
                try {
                    const response = await this._client.request({
                        method,
                        url: endpoint,
                        ...axiosConfig,
                    });
                    return response;
                } finally {
                    this._rateLimiter.release();
                }
            } catch (error) {
                lastError = error;

                // Don't retry on 4xx errors (except 429 rate limit)
                if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
                    throw error;
                }

                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    this._log(`Request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Get child page IDs for a parent page.
     *
     * @param {string} parentPageId
     * @returns {Promise<Array<{id: string, title: string}>>}
     */
    async _getChildPages(parentPageId) {
        try {
            const response = await this._requestWithRetry('GET', `/rest/api/content/${parentPageId}/child/page`, {
                params: {
                    limit: 100,
                    expand: 'version',
                },
            });

            return (response.data.results || []).map(child => ({
                id: child.id,
                title: child.title,
            }));
        } catch (error) {
            this._log(`Failed to get children of ${parentPageId}: ${error.message}`);
            return [];
        }
    }

    /**
     * Convert a Confluence API page response to a standardized KBResult.
     *
     * @param {Object} page - Confluence page object from API
     * @param {boolean} includeBody - Whether to include body content
     * @returns {import('./kb-provider').KBResult}
     */
    _convertToKBResult(page, includeBody = true) {
        const bodyHtml = page.body?.storage?.value || page.body?.view?.value || '';
        const plainContent = includeBody ? htmlToPlainText(bodyHtml) : '';

        const spaceKey = page.space?.key || '';
        const pageUrl = page._links?.webui
            ? `${this.baseUrl}${page._links.webui}`
            : `${this.baseUrl}/spaces/${spaceKey}/pages/${page.id}`;

        return {
            id: String(page.id),
            title: page.title || '',
            content: plainContent,
            excerpt: createExcerpt(plainContent),
            url: pageUrl,
            space: spaceKey,
            lastModified: page.version?.when || new Date().toISOString(),
            metadata: {
                provider: 'confluence',
                status: page.status || 'current',
                labels: (page.metadata?.labels?.results || []).map(l => l.name),
                author: page.version?.by?.displayName || '',
                parentId: page.ancestors?.length > 0
                    ? String(page.ancestors[page.ancestors.length - 1].id)
                    : null,
                version: page.version?.number || 1,
            },
        };
    }

    /**
     * Escape special characters in CQL queries.
     * @param {string} text
     * @returns {string}
     */
    _escapeCQL(text) {
        // Escape double quotes and backslashes in CQL
        return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * @param {string} message
     */
    _log(message) {
        if (this.verbose) {
            console.log(`[ConfluenceProvider] ${message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { ConfluenceProvider };
