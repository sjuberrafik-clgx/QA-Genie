/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NOTION PROVIDER — Notion Knowledge Base Integration (Skeleton)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Skeleton implementation for teams using Notion as their knowledge base.
 * Implements the KBProvider interface but requires @notionhq/client dependency.
 *
 * To activate:
 *   1. npm install @notionhq/client
 *   2. Set NOTION_API_KEY in .env
 *   3. Set NOTION_WORKSPACE_ID in .env
 *   4. Add provider config in grounding-config.json:
 *      {
 *          "type": "notion",
 *          "name": "My Notion KB",
 *          "workspaceId": "your-workspace-id",
 *          "databaseIds": ["db-id-1", "db-id-2"]
 *      }
 *
 * @module notion-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { KBProvider, htmlToPlainText, createExcerpt } = require('./kb-provider');

class NotionProvider extends KBProvider {
    constructor(config = {}) {
        super({ ...config, type: 'notion' });

        this.apiKey = config.apiKey || process.env.NOTION_API_KEY || '';
        this.workspaceId = config.workspaceId || process.env.NOTION_WORKSPACE_ID || '';
        this.databaseIds = config.databaseIds || [];
        this.verbose = config.verbose || false;

        // Notion client (lazy-loaded)
        this._client = null;
    }

    _ensureClient() {
        if (this._client) return;
        try {
            const { Client } = require('@notionhq/client');
            this._client = new Client({ auth: this.apiKey });
        } catch {
            throw new Error(
                'Notion provider requires @notionhq/client. Install it with: npm install @notionhq/client'
            );
        }
    }

    async search(query, options = {}) {
        this._ensureClient();
        const maxResults = options.maxResults || 10;

        try {
            const response = await this._client.search({
                query,
                filter: { property: 'object', value: 'page' },
                page_size: maxResults,
            });

            return (response.results || []).map(page => this._convertToKBResult(page));
        } catch (error) {
            throw new Error(`Notion search failed: ${error.message}`);
        }
    }

    async getPage(pageId) {
        this._ensureClient();

        try {
            const page = await this._client.pages.retrieve({ page_id: pageId });
            // Also fetch blocks (page content)
            const blocks = await this._client.blocks.children.list({
                block_id: pageId,
                page_size: 100,
            });

            return this._convertToKBResult(page, blocks.results);
        } catch (error) {
            if (error.status === 404) return null;
            throw new Error(`Notion getPage failed: ${error.message}`);
        }
    }

    async getPageTree(rootPageId, options = {}) {
        this._ensureClient();
        const maxDepth = options.depth || 3;
        const allPages = [];

        const fetchChildren = async (blockId, depth) => {
            if (depth > maxDepth) return;

            try {
                const response = await this._client.blocks.children.list({
                    block_id: blockId,
                    page_size: 100,
                });

                for (const block of response.results || []) {
                    if (block.type === 'child_page') {
                        const page = await this.getPage(block.id);
                        if (page) allPages.push(page);
                        await fetchChildren(block.id, depth + 1);
                    }
                }
            } catch (error) {
                this._log(`Error traversing block ${blockId}: ${error.message}`);
            }
        };

        // Start with the root page itself
        const rootPage = await this.getPage(rootPageId);
        if (rootPage) allPages.push(rootPage);
        await fetchChildren(rootPageId, 1);

        return allPages;
    }

    async testConnection() {
        this._ensureClient();
        const startTime = Date.now();

        try {
            await this._client.users.me({});
            return {
                connected: true,
                provider: this.getProviderName(),
                message: 'Connected to Notion API',
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
        this._ensureClient();

        // Notion doesn't have "spaces" — return databases as equivalents
        try {
            const response = await this._client.search({
                filter: { property: 'object', value: 'database' },
                page_size: 50,
            });

            return (response.results || []).map(db => ({
                key: db.id,
                name: db.title?.[0]?.plain_text || 'Untitled Database',
                url: db.url || '',
            }));
        } catch (error) {
            throw new Error(`Failed to list Notion databases: ${error.message}`);
        }
    }

    _convertToKBResult(page, blocks = []) {
        const title = page.properties?.title?.title?.[0]?.plain_text
            || page.properties?.Name?.title?.[0]?.plain_text
            || 'Untitled';

        // Convert blocks to text
        const contentParts = blocks.map(block => {
            if (block.type === 'paragraph') {
                return block.paragraph?.rich_text?.map(t => t.plain_text).join('') || '';
            }
            if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
                const text = block[block.type]?.rich_text?.map(t => t.plain_text).join('') || '';
                return `\n## ${text}\n`;
            }
            if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
                return `• ${block[block.type]?.rich_text?.map(t => t.plain_text).join('') || ''}`;
            }
            if (block.type === 'code') {
                return `\`\`\`\n${block.code?.rich_text?.map(t => t.plain_text).join('') || ''}\n\`\`\``;
            }
            return '';
        });

        const content = contentParts.filter(Boolean).join('\n');

        return {
            id: page.id,
            title,
            content,
            excerpt: createExcerpt(content),
            url: page.url || '',
            space: page.parent?.database_id || page.parent?.workspace ? 'workspace' : '',
            lastModified: page.last_edited_time || new Date().toISOString(),
            metadata: {
                provider: 'notion',
                status: page.archived ? 'archived' : 'current',
                labels: [],
                author: page.created_by?.name || '',
                parentId: page.parent?.page_id || null,
            },
        };
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[NotionProvider] ${message}`);
        }
    }
}

module.exports = { NotionProvider };
