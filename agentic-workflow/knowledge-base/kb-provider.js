/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KB PROVIDER — Abstract Knowledge Base Provider Interface
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Defines the contract that every knowledge base provider must implement.
 * Providers translate external knowledge sources (Confluence, Notion, SharePoint,
 * custom REST APIs) into a standardized KBResult format that the KB Connector
 * can consume, cache, and inject into agent context.
 *
 * To add a new provider:
 *   1. Create a new file (e.g., my-provider.js)
 *   2. Extend KBProvider
 *   3. Implement all abstract methods
 *   4. Register in kb-connector.js → createProvider()
 *
 * @module kb-provider
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Standardized Result Types ──────────────────────────────────────────────

/**
 * @typedef {Object} KBResult
 * @property {string}  id           - Provider-specific unique page/document ID
 * @property {string}  title        - Document title
 * @property {string}  content      - Plain text content (HTML stripped)
 * @property {string}  excerpt      - Short excerpt (first 300 chars of content)
 * @property {string}  url          - Direct URL to the document
 * @property {string}  space        - Space, workspace, or collection identifier
 * @property {string}  lastModified - ISO 8601 timestamp of last modification
 * @property {Object}  metadata     - Provider-specific metadata
 * @property {string}  metadata.provider  - Provider name (e.g., 'confluence')
 * @property {string}  [metadata.status]  - Document status (e.g., 'current', 'draft')
 * @property {string[]} [metadata.labels] - Tags/labels on the document
 * @property {string}  [metadata.author]  - Author display name
 * @property {string}  [metadata.parentId] - Parent page/document ID (for tree traversal)
 */

/**
 * @typedef {Object} KBSearchOptions
 * @property {string}   [spaceKey]    - Filter results to a specific space/collection
 * @property {number}   [maxResults]  - Maximum results to return (default: 10)
 * @property {string}   [cqlFilter]   - Provider-specific query filter (e.g., CQL for Confluence)
 * @property {string[]} [labels]      - Filter by labels/tags
 * @property {boolean}  [includeBody] - Include full body content in results (default: true)
 */

/**
 * @typedef {Object} KBPageTreeOptions
 * @property {number}  [depth]        - Maximum depth for tree traversal (default: 3)
 * @property {boolean} [includeBody]  - Include full body content (default: false for tree)
 */

/**
 * @typedef {Object} KBConnectionStatus
 * @property {boolean} connected  - Whether the provider is reachable
 * @property {string}  provider   - Provider name
 * @property {string}  [message]  - Human-readable status message
 * @property {number}  [latencyMs] - Connection test latency in milliseconds
 */

// ─── Abstract Provider Base Class ───────────────────────────────────────────

class KBProvider {
    /**
     * @param {Object} config - Provider-specific configuration
     * @param {string} config.type   - Provider type identifier
     * @param {string} [config.name] - Human-readable provider name
     */
    constructor(config = {}) {
        if (new.target === KBProvider) {
            throw new Error('KBProvider is abstract — extend it and implement all methods.');
        }
        this.config = config;
        this.type = config.type || 'unknown';
        this.name = config.name || this.type;
    }

    /**
     * Search the knowledge base for documents matching a query.
     *
     * @abstract
     * @param {string} query - Natural language search query
     * @param {KBSearchOptions} [options] - Search filters and limits
     * @returns {Promise<KBResult[]>} Array of matching documents
     */
    async search(query, options = {}) {
        throw new Error(`${this.constructor.name}.search() is not implemented`);
    }

    /**
     * Retrieve a single page/document by its ID.
     *
     * @abstract
     * @param {string} pageId - Provider-specific page/document ID
     * @returns {Promise<KBResult|null>} The page content, or null if not found
     */
    async getPage(pageId) {
        throw new Error(`${this.constructor.name}.getPage() is not implemented`);
    }

    /**
     * Retrieve a page and all its descendants (child pages) as a tree.
     *
     * @abstract
     * @param {string} rootPageId - ID of the root page
     * @param {KBPageTreeOptions} [options] - Tree traversal options
     * @returns {Promise<KBResult[]>} Flat array of pages in the tree
     */
    async getPageTree(rootPageId, options = {}) {
        throw new Error(`${this.constructor.name}.getPageTree() is not implemented`);
    }

    /**
     * Test the provider connection (auth, reachability).
     *
     * @abstract
     * @returns {Promise<KBConnectionStatus>} Connection health status
     */
    async testConnection() {
        throw new Error(`${this.constructor.name}.testConnection() is not implemented`);
    }

    /**
     * Get available spaces/collections/workspaces.
     * Used for configuration discovery and validation.
     *
     * @abstract
     * @returns {Promise<Array<{key: string, name: string, url: string}>>}
     */
    async listSpaces() {
        throw new Error(`${this.constructor.name}.listSpaces() is not implemented`);
    }

    /**
     * Get the provider name for display and logging.
     * @returns {string}
     */
    getProviderName() {
        return this.name;
    }

    /**
     * Get the provider type identifier.
     * @returns {string}
     */
    getProviderType() {
        return this.type;
    }
}

// ─── Utility: HTML to Plain Text ────────────────────────────────────────────

/**
 * Convert HTML content to plain text.
 * Uses regex-based stripping — no heavy DOM dependencies needed.
 * Handles Confluence storage format, Notion HTML exports, etc.
 *
 * @param {string} html - Raw HTML string
 * @returns {string} Plain text content
 */
function htmlToPlainText(html) {
    if (!html || typeof html !== 'string') return '';

    let text = html;

    // 1. Replace block-level elements with newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

    // 2. Handle lists
    text = text.replace(/<li[^>]*>/gi, '• ');

    // 3. Handle tables — convert cells to tab-separated
    text = text.replace(/<td[^>]*>/gi, '\t');
    text = text.replace(/<th[^>]*>/gi, '\t');

    // 4. Handle headings — prefix with markdown-style markers
    text = text.replace(/<h1[^>]*>/gi, '\n# ');
    text = text.replace(/<h2[^>]*>/gi, '\n## ');
    text = text.replace(/<h3[^>]*>/gi, '\n### ');
    text = text.replace(/<h4[^>]*>/gi, '\n#### ');

    // 5. Handle code blocks
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

    // 6. Handle links — preserve text and URL
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)');

    // 7. Handle Confluence-specific macros
    text = text.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');
    text = text.replace(/<ac:rich-text-body[^>]*>([\s\S]*?)<\/ac:rich-text-body>/gi, '$1');
    text = text.replace(/<ac:plain-text-body[^>]*>([\s\S]*?)<\/ac:plain-text-body>/gi, '$1');

    // 8. Handle images — extract alt text
    text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[Image: $1]');
    text = text.replace(/<img[^>]*>/gi, '');

    // 9. Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // 10. Decode HTML entities
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/gi, "'");
    text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

    // 11. Clean up whitespace
    text = text.replace(/[ \t]+/g, ' ');           // collapse horizontal whitespace
    text = text.replace(/\n{3,}/g, '\n\n');         // max 2 consecutive newlines
    text = text.replace(/^\s+|\s+$/gm, '');         // trim each line

    return text.trim();
}

/**
 * Create a short excerpt from content.
 *
 * @param {string} content - Full text content
 * @param {number} [maxLength=300] - Maximum excerpt length
 * @returns {string}
 */
function createExcerpt(content, maxLength = 300) {
    if (!content) return '';
    const clean = content.replace(/\n+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    // Break at word boundary
    const truncated = clean.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    KBProvider,
    htmlToPlainText,
    createExcerpt,
};
