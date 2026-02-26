/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KB CACHE — Local Cache with BM25 Search for Knowledge Base Content
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Caches knowledge base pages locally as JSON and builds a BM25 index over
 * their content. This enables fast, offline-capable search over previously
 * fetched KB content without hitting the provider API every time.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────┐
 *   │             KBCache                      │
 *   │  .addPages(pages)    → persist + index   │
 *   │  .search(query)      → BM25 ranked       │
 *   │  .getPage(id)        → cached content     │
 *   │  .isStale(id)        → TTL check          │
 *   │  .evictExpired()     → cleanup            │
 *   │  .clear()            → full reset         │
 *   └─────────────────────┬───────────────────┘
 *                         │
 *         ┌───────────────▼───────────────┐
 *         │       BM25Index               │
 *         │  (from text-indexer.js)       │
 *         │  Reuses existing tokenizer,   │
 *         │  stemmer, and scoring logic   │
 *         └───────────────────────────────┘
 *
 * Persistence follows the LearningStore pattern:
 *   - JSON file at configurable path
 *   - Bounded entries with LRU eviction
 *   - Auto-save after mutations
 *
 * @module kb-cache
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'knowledge-base-data');
const DEFAULT_CACHE_FILE = 'kb-cache.json';
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_MAX_ENTRIES = 200;

const EMPTY_CACHE = {
    version: '1.0.0',
    lastUpdated: null,
    lastSyncAt: null,
    stats: {
        totalSearches: 0,
        cacheHits: 0,
        cacheMisses: 0,
    },
    pages: [],
    searchCache: [],
};

// ─── KBCache ────────────────────────────────────────────────────────────────

class KBCache {
    /**
     * @param {Object} [options]
     * @param {string}  [options.cacheDir]      - Directory for cache files
     * @param {string}  [options.cacheFile]      - Cache filename
     * @param {number}  [options.ttlMinutes]     - Default TTL for cached pages
     * @param {number}  [options.maxEntries]     - Maximum cached pages (LRU eviction)
     * @param {boolean} [options.verbose]        - Enable debug logging
     */
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
        this.cacheFile = options.cacheFile || DEFAULT_CACHE_FILE;
        this.ttlMinutes = options.ttlMinutes || parseInt(process.env.CONFLUENCE_CACHE_TTL_MINUTES || String(DEFAULT_TTL_MINUTES), 10);
        this.maxEntries = options.maxEntries || parseInt(process.env.CONFLUENCE_MAX_PAGES || String(DEFAULT_MAX_ENTRIES), 10);
        this.verbose = options.verbose || false;

        // BM25 index (lazy-loaded from text-indexer.js)
        this._bm25Index = null;
        this._indexDirty = true;

        // Load persisted data
        this.data = this._load();
    }

    // ─── Core API ───────────────────────────────────────────────────

    /**
     * Add or update pages in the cache.
     *
     * @param {import('./kb-provider').KBResult[]} pages - Pages to cache
     * @returns {{ added: number, updated: number }}
     */
    addPages(pages) {
        let added = 0;
        let updated = 0;
        const now = new Date().toISOString();

        for (const page of pages) {
            if (!page.id || !page.content) continue;

            const contentHash = this._hash(page.content);
            const existingIdx = this.data.pages.findIndex(p => p.id === page.id);

            const cachedPage = {
                id: page.id,
                title: page.title || '',
                content: page.content,
                excerpt: page.excerpt || page.content.slice(0, 300),
                url: page.url || '',
                space: page.space || '',
                lastModified: page.lastModified || now,
                cachedAt: now,
                expiresAt: this._getExpiryTime(now),
                contentHash,
                metadata: page.metadata || {},
                accessCount: 0,
                lastAccessedAt: now,
            };

            if (existingIdx !== -1) {
                // Update existing entry
                cachedPage.accessCount = this.data.pages[existingIdx].accessCount || 0;
                this.data.pages[existingIdx] = cachedPage;
                updated++;
            } else {
                this.data.pages.push(cachedPage);
                added++;
            }
        }

        // Enforce max entries with LRU eviction
        this._evictIfNeeded();

        // Mark index as dirty
        this._indexDirty = true;

        // Persist
        this.data.lastUpdated = now;
        this._save();

        this._log(`Cache updated: ${added} added, ${updated} updated (total: ${this.data.pages.length})`);
        return { added, updated };
    }

    /**
     * Search cached pages using BM25 full-text search.
     *
     * @param {string} query - Search query
     * @param {Object}  [options]
     * @param {number}  [options.maxResults=5] - Maximum results
     * @param {string}  [options.spaceKey] - Filter by space
     * @param {number}  [options.minScore=0.1] - Minimum relevance score
     * @returns {{ results: Array, fromCache: boolean }}
     */
    search(query, options = {}) {
        const maxResults = options.maxResults || 5;
        const minScore = options.minScore || 0.1;

        this.data.stats.totalSearches++;

        // Check search cache first
        const cachedSearch = this._getSearchCache(query);
        if (cachedSearch) {
            this.data.stats.cacheHits++;
            return { results: cachedSearch, fromCache: true };
        }

        this.data.stats.cacheMisses++;

        // Build or rebuild BM25 index if dirty
        this._ensureIndex();

        // Run BM25 search
        const index = this._bm25Index;
        if (!index) {
            return { results: [], fromCache: false };
        }

        const rawResults = index.search(query, { topK: maxResults * 2 });

        // Map BM25 results back to cached pages and apply filters
        let results = rawResults
            .map(r => {
                const page = this.data.pages.find(p => p.id === r.chunk?.metadata?.pageId);
                if (!page) return null;

                // Space filter
                if (options.spaceKey && page.space !== options.spaceKey) return null;

                // TTL check - skip stale pages from results
                if (this.isStale(page.id)) return null;

                // Update access tracking
                page.accessCount = (page.accessCount || 0) + 1;
                page.lastAccessedAt = new Date().toISOString();

                return {
                    id: page.id,
                    title: page.title,
                    excerpt: page.excerpt,
                    url: page.url,
                    space: page.space,
                    lastModified: page.lastModified,
                    relevance: Math.round(r.score * 1000) / 1000,
                    matchedTerms: r.matchedTerms || [],
                    provider: page.metadata?.provider || 'unknown',
                };
            })
            .filter(r => r && r.relevance >= minScore)
            .slice(0, maxResults);

        // Cache the search results
        this._setSearchCache(query, results);

        return { results, fromCache: false };
    }

    /**
     * Get a cached page by ID.
     *
     * @param {string} pageId - Page ID
     * @returns {{ page: Object|null, fresh: boolean }}
     */
    getPage(pageId) {
        const page = this.data.pages.find(p => p.id === pageId);
        if (!page) return { page: null, fresh: false };

        // Update access tracking
        page.accessCount = (page.accessCount || 0) + 1;
        page.lastAccessedAt = new Date().toISOString();

        return {
            page: {
                id: page.id,
                title: page.title,
                content: page.content,
                excerpt: page.excerpt,
                url: page.url,
                space: page.space,
                lastModified: page.lastModified,
                metadata: page.metadata,
            },
            fresh: !this.isStale(pageId),
        };
    }

    /**
     * Check if a cached page is stale (past TTL).
     *
     * @param {string} pageId - Page ID
     * @returns {boolean} True if stale or not in cache
     */
    isStale(pageId) {
        const page = this.data.pages.find(p => p.id === pageId);
        if (!page) return true;
        return new Date(page.expiresAt) < new Date();
    }

    /**
     * Remove expired pages from the cache.
     *
     * @returns {number} Number of pages evicted
     */
    evictExpired() {
        const now = new Date();
        const before = this.data.pages.length;
        this.data.pages = this.data.pages.filter(p => new Date(p.expiresAt) >= now);
        const evicted = before - this.data.pages.length;

        if (evicted > 0) {
            this._indexDirty = true;
            this.data.lastUpdated = now.toISOString();
            this._save();
            this._log(`Evicted ${evicted} expired pages`);
        }

        return evicted;
    }

    /**
     * Clear all cached data and reset the index.
     */
    clear() {
        this.data = JSON.parse(JSON.stringify(EMPTY_CACHE));
        this._bm25Index = null;
        this._indexDirty = true;
        this._save();
        this._log('Cache cleared');
    }

    /**
     * Get cache statistics.
     *
     * @returns {Object} Cache stats
     */
    getStats() {
        const now = new Date();
        const freshPages = this.data.pages.filter(p => new Date(p.expiresAt) >= now);
        const stalePages = this.data.pages.filter(p => new Date(p.expiresAt) < now);
        const totalSearches = this.data.stats.totalSearches || 0;
        const hits = this.data.stats.cacheHits || 0;

        return {
            totalPages: this.data.pages.length,
            freshPages: freshPages.length,
            stalePages: stalePages.length,
            maxEntries: this.maxEntries,
            ttlMinutes: this.ttlMinutes,
            totalSearches,
            cacheHits: hits,
            cacheMisses: this.data.stats.cacheMisses || 0,
            hitRate: totalSearches > 0 ? Math.round((hits / totalSearches) * 100) : 0,
            lastSyncAt: this.data.lastSyncAt,
            lastUpdated: this.data.lastUpdated,
            uniqueSpaces: [...new Set(this.data.pages.map(p => p.space).filter(Boolean))],
        };
    }

    /**
     * Record a sync completion time.
     */
    markSynced() {
        this.data.lastSyncAt = new Date().toISOString();
        this._save();
    }

    /**
     * Check if the cache has any content for a query (fast check, no BM25).
     *
     * @param {string} query - Search query
     * @returns {boolean}
     */
    hasContentFor(query) {
        if (this.data.pages.length === 0) return false;

        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

        return this.data.pages.some(page => {
            if (this.isStale(page.id)) return false;
            const searchable = `${page.title} ${page.content}`.toLowerCase();
            return queryWords.some(w => searchable.includes(w));
        });
    }

    // ─── Internal: BM25 Index ───────────────────────────────────────

    /**
     * Build or rebuild the BM25 index from cached pages.
     */
    _ensureIndex() {
        if (!this._indexDirty && this._bm25Index) return;

        try {
            // Import BM25Index from the existing text-indexer
            const { BM25Index } = require('../grounding/text-indexer');
            this._bm25Index = new BM25Index();

            // Add each page as a document chunk
            const chunks = this.data.pages
                .filter(p => !this.isStale(p.id))
                .map(page => ({
                    content: `${page.title}\n\n${page.content}`,
                    filePath: page.url || page.id,
                    startLine: 1,
                    endLine: page.content.split('\n').length,
                    type: 'knowledgeBase',
                    metadata: {
                        pageId: page.id,
                        title: page.title,
                        space: page.space,
                        provider: page.metadata?.provider || 'unknown',
                    },
                }));

            if (chunks.length > 0) {
                this._bm25Index.addChunks(chunks);
                this._bm25Index.build();
            }

            this._indexDirty = false;
            this._log(`BM25 index built: ${chunks.length} documents`);
        } catch (error) {
            this._log(`Failed to build BM25 index: ${error.message}`);
            this._bm25Index = null;
        }
    }

    // ─── Internal: Search Cache ─────────────────────────────────────

    _getSearchCache(query) {
        const key = this._normalizeQuery(query);
        const entry = this.data.searchCache.find(e => e.query === key);
        if (!entry) return null;

        // Check if search cache entry is still fresh (5 min TTL)
        if (new Date(entry.cachedAt).getTime() + 5 * 60 * 1000 < Date.now()) {
            return null;
        }

        return entry.results;
    }

    _setSearchCache(query, results) {
        const key = this._normalizeQuery(query);
        const existingIdx = this.data.searchCache.findIndex(e => e.query === key);

        const entry = {
            query: key,
            results,
            cachedAt: new Date().toISOString(),
        };

        if (existingIdx !== -1) {
            this.data.searchCache[existingIdx] = entry;
        } else {
            this.data.searchCache.push(entry);
            // Keep search cache bounded
            if (this.data.searchCache.length > 100) {
                this.data.searchCache = this.data.searchCache.slice(-50);
            }
        }
    }

    _normalizeQuery(query) {
        return query.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    // ─── Internal: Persistence ──────────────────────────────────────

    _load() {
        const filePath = path.join(this.cacheDir, this.cacheFile);
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw);
                this._log(`Cache loaded: ${data.pages?.length || 0} pages`);
                return data;
            }
        } catch (error) {
            this._log(`Failed to load cache: ${error.message}`);
        }
        return JSON.parse(JSON.stringify(EMPTY_CACHE));
    }

    _save() {
        try {
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
            }
            const filePath = path.join(this.cacheDir, this.cacheFile);
            fs.writeFileSync(filePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (error) {
            this._log(`Failed to save cache: ${error.message}`);
        }
    }

    // ─── Internal: LRU Eviction ─────────────────────────────────────

    _evictIfNeeded() {
        if (this.data.pages.length <= this.maxEntries) return;

        // Sort by lastAccessedAt (ascending) and evict least recently accessed
        this.data.pages.sort((a, b) =>
            new Date(a.lastAccessedAt || a.cachedAt).getTime() -
            new Date(b.lastAccessedAt || b.cachedAt).getTime()
        );

        const excess = this.data.pages.length - this.maxEntries;
        this.data.pages.splice(0, excess);
        this._log(`LRU eviction: removed ${excess} pages`);
    }

    // ─── Internal: Utilities ────────────────────────────────────────

    _hash(content) {
        return crypto.createHash('md5').update(content).digest('hex').slice(0, 16);
    }

    _getExpiryTime(fromISO) {
        const from = new Date(fromISO);
        from.setMinutes(from.getMinutes() + this.ttlMinutes);
        return from.toISOString();
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[KBCache] ${message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { KBCache };
