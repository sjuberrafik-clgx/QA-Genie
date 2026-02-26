/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHAREPOINT PROVIDER — Microsoft SharePoint Knowledge Base (Skeleton)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Skeleton implementation for teams using SharePoint as their knowledge base.
 * Uses Microsoft Graph API for search and content retrieval.
 *
 * To activate:
 *   1. npm install @microsoft/microsoft-graph-client
 *   2. Set SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET in .env
 *   3. Set SHAREPOINT_SITE_ID or SHAREPOINT_SITE_URL in .env
 *   4. Add provider config in grounding-config.json:
 *      {
 *          "type": "sharepoint",
 *          "name": "My SharePoint",
 *          "siteId": "your-site-id",
 *          "driveId": "optional-drive-id",
 *          "libraryNames": ["Documents", "Wiki"]
 *      }
 *
 * @module sharepoint-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { KBProvider, htmlToPlainText, createExcerpt } = require('./kb-provider');

class SharePointProvider extends KBProvider {
    constructor(config = {}) {
        super({ ...config, type: 'sharepoint' });

        this.tenantId = config.tenantId || process.env.SHAREPOINT_TENANT_ID || '';
        this.clientId = config.clientId || process.env.SHAREPOINT_CLIENT_ID || '';
        this.clientSecret = config.clientSecret || process.env.SHAREPOINT_CLIENT_SECRET || '';
        this.siteId = config.siteId || process.env.SHAREPOINT_SITE_ID || '';
        this.siteUrl = config.siteUrl || process.env.SHAREPOINT_SITE_URL || '';
        this.driveId = config.driveId || '';
        this.libraryNames = config.libraryNames || ['Documents'];
        this.verbose = config.verbose || false;

        this._client = null;
        this._accessToken = null;
    }

    async _ensureClient() {
        if (this._client) return;

        try {
            const axios = require('axios');

            // Get OAuth2 token
            const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
            const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                scope: 'https://graph.microsoft.com/.default',
                grant_type: 'client_credentials',
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            this._accessToken = tokenResponse.data.access_token;
            this._client = axios.create({
                baseURL: 'https://graph.microsoft.com/v1.0',
                headers: {
                    Authorization: `Bearer ${this._accessToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });
        } catch (error) {
            throw new Error(
                `SharePoint authentication failed: ${error.message}. ` +
                'Ensure SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, and SHAREPOINT_CLIENT_SECRET are set.'
            );
        }
    }

    async search(query, options = {}) {
        await this._ensureClient();
        const maxResults = options.maxResults || 10;

        try {
            // Use Microsoft Search API
            const response = await this._client.post('/search/query', {
                requests: [{
                    entityTypes: ['driveItem', 'listItem'],
                    query: { queryString: query },
                    from: 0,
                    size: maxResults,
                    fields: ['title', 'description', 'lastModifiedDateTime', 'webUrl', 'createdBy'],
                }],
            });

            const hits = response.data?.value?.[0]?.hitsContainers?.[0]?.hits || [];
            return hits.map(hit => this._convertToKBResult(hit));
        } catch (error) {
            throw new Error(`SharePoint search failed: ${error.message}`);
        }
    }

    async getPage(pageId) {
        await this._ensureClient();

        try {
            const response = await this._client.get(
                `/sites/${this.siteId}/pages/${pageId}`
            );

            // Fetch page content
            const contentResponse = await this._client.get(
                `/sites/${this.siteId}/pages/${pageId}/microsoft.graph.sitePage/canvasLayout`
            );

            return this._convertPageToKBResult(response.data, contentResponse.data);
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw new Error(`SharePoint getPage failed: ${error.message}`);
        }
    }

    async getPageTree(rootPageId, options = {}) {
        // SharePoint doesn't have a native page tree.
        // Fetch the root page and search for related pages in the same library.
        await this._ensureClient();
        const allPages = [];

        try {
            const rootPage = await this.getPage(rootPageId);
            if (rootPage) allPages.push(rootPage);

            // Search for pages in the same site
            const relatedPages = await this.search(rootPage?.title || '', {
                maxResults: options.depth ? options.depth * 10 : 20,
            });
            allPages.push(...relatedPages.filter(p => p.id !== rootPageId));
        } catch (error) {
            this._log(`Page tree fetch failed: ${error.message}`);
        }

        return allPages;
    }

    async testConnection() {
        const startTime = Date.now();
        try {
            await this._ensureClient();
            await this._client.get(`/sites/${this.siteId}`);
            return {
                connected: true,
                provider: this.getProviderName(),
                message: `Connected to SharePoint site ${this.siteId}`,
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

        try {
            const response = await this._client.get('/sites?search=*', {
                params: { $top: 50 },
            });

            return (response.data?.value || []).map(site => ({
                key: site.id,
                name: site.displayName || site.name,
                url: site.webUrl || '',
            }));
        } catch (error) {
            throw new Error(`Failed to list SharePoint sites: ${error.message}`);
        }
    }

    _convertToKBResult(hit) {
        const resource = hit.resource || {};
        return {
            id: resource.id || hit.hitId || '',
            title: resource.name || resource.title || 'Untitled',
            content: resource.description || hit.summary || '',
            excerpt: createExcerpt(hit.summary || resource.description || ''),
            url: resource.webUrl || '',
            space: this.siteId,
            lastModified: resource.lastModifiedDateTime || new Date().toISOString(),
            metadata: {
                provider: 'sharepoint',
                status: 'current',
                labels: [],
                author: resource.createdBy?.user?.displayName || '',
                parentId: null,
            },
        };
    }

    _convertPageToKBResult(page, canvasLayout) {
        // Extract text from canvas layout
        let content = page.description || '';
        if (canvasLayout?.horizontalSections) {
            for (const section of canvasLayout.horizontalSections) {
                for (const column of section.columns || []) {
                    for (const webPart of column.webparts || []) {
                        if (webPart.innerHtml) {
                            content += '\n' + htmlToPlainText(webPart.innerHtml);
                        }
                    }
                }
            }
        }

        return {
            id: page.id,
            title: page.title || page.name || 'Untitled',
            content,
            excerpt: createExcerpt(content),
            url: page.webUrl || '',
            space: this.siteId,
            lastModified: page.lastModifiedDateTime || new Date().toISOString(),
            metadata: {
                provider: 'sharepoint',
                status: page.publishingState?.level || 'current',
                labels: [],
                author: page.createdBy?.user?.displayName || '',
                parentId: null,
            },
        };
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[SharePointProvider] ${message}`);
        }
    }
}

module.exports = { SharePointProvider };
