/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KB CONNECTOR — Knowledge Base Connector Orchestrator (Facade)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Central orchestrator that ties together:
 *   - Provider(s)     → Confluence, Notion, SharePoint, Custom REST
 *   - Cache           → Local BM25-indexed cache
 *   - Intent Detector → Automatic query analysis
 *
 * This is the single entry point for the rest of the system. The GroundingStore,
 * custom tools, and agent sessions all interact with this connector rather than
 * with individual providers or the cache directly.
 *
 * Architecture:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                   KnowledgeBaseConnector                   │
 *   │                                                            │
 *   │  .query(query)          → hybrid fetch + cache + rank      │
 *   │  .queryForAgent(agent)  → agent-boosted search             │
 *   │  .buildKBContext(agent) → context string for system prompt │
 *   │  .syncPages(spaces)     → full/incremental sync            │
 *   │  .getStats()            → health + metrics                 │
 *   │                                                            │
 *   │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐         │
 *   │  │ Provider  │  │  Cache   │  │  IntentDetector  │         │
 *   │  │ (Confl.)  │  │ (BM25)  │  │  (term matching) │         │
 *   │  └──────────┘  └──────────┘  └──────────────────┘         │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Hybrid fetch model:
 *   1. IntentDetector decides if KB content is relevant
 *   2. Cache is checked first (BM25 search over cached pages)
 *   3. If cache miss or stale → live API call to provider
 *   4. Results are cached, indexed, and returned
 *
 * Singleton pattern via getKnowledgeBaseConnector().
 *
 * @module kb-connector
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const { KBCache } = require('./kb-cache');
const { IntentDetector } = require('./intent-detector');

// ─── Provider Factory ───────────────────────────────────────────────────────

/**
 * Create a provider instance based on config type.
 *
 * @param {Object} providerConfig - Provider configuration
 * @returns {import('./kb-provider').KBProvider}
 */
function createProvider(providerConfig) {
    switch (providerConfig.type) {
        case 'confluence': {
            const { ConfluenceProvider } = require('./confluence-provider');
            return new ConfluenceProvider(providerConfig);
        }
        case 'notion': {
            const { NotionProvider } = require('./notion-provider');
            return new NotionProvider(providerConfig);
        }
        case 'sharepoint': {
            const { SharePointProvider } = require('./sharepoint-provider');
            return new SharePointProvider(providerConfig);
        }
        case 'custom': {
            const { CustomProvider } = require('./custom-provider');
            return new CustomProvider(providerConfig);
        }
        default:
            throw new Error(`Unknown KB provider type: "${providerConfig.type}". Supported: confluence, notion, sharepoint, custom`);
    }
}

// ─── KnowledgeBaseConnector ─────────────────────────────────────────────────

class KnowledgeBaseConnector {
    /**
     * @param {Object} config - Knowledge base configuration (from grounding-config.json → knowledgeBase)
     * @param {Object}   config.providers     - Array of provider configurations
     * @param {Object}   [config.cache]        - Cache configuration
     * @param {Object}   [config.intentDetection] - Intent detection configuration
     * @param {Object}   [config.retrieval]    - Retrieval settings
     * @param {Object}   [config.groundingConfig] - Full grounding config (for terminology, features)
     * @param {boolean}  [config.verbose]
     */
    constructor(config = {}) {
        this.config = config;
        this.verbose = config.verbose || false;
        this._initialized = false;

        // Providers
        this._providers = [];

        // Cache
        this._cache = null;

        // Intent detector
        this._intentDetector = null;

        // Retrieval settings
        this._maxResults = config.retrieval?.maxResults || 5;
        this._maxContextChars = config.retrieval?.maxContextChars || 4000;
        this._minRelevanceScore = config.retrieval?.minRelevanceScore || 0.2;
        this._agentBoosts = config.retrieval?.agentBoosts || {};
    }

    // ─── Initialization ─────────────────────────────────────────────

    /**
     * Initialize providers, cache, and intent detector.
     * Must be called before any query operations.
     *
     * @returns {{ providers: number, cachePages: number, status: string }}
     */
    initialize() {
        if (this._initialized) return { providers: this._providers.length, cachePages: this._cache?.getStats().totalPages || 0, status: 'already-initialized' };

        // 1. Initialize providers
        const providerConfigs = this.config.providers || [];
        for (const pc of providerConfigs) {
            try {
                const provider = createProvider({ ...pc, verbose: this.verbose });
                this._providers.push(provider);
                this._log(`Provider initialized: ${provider.getProviderName()} (${provider.getProviderType()})`);
            } catch (error) {
                this._log(`⚠ Failed to initialize provider ${pc.type}: ${error.message}`);
            }
        }

        // 2. Initialize cache
        const cacheConfig = this.config.cache || {};
        this._cache = new KBCache({
            cacheDir: cacheConfig.storagePath || undefined,
            ttlMinutes: cacheConfig.ttlMinutes || undefined,
            maxEntries: cacheConfig.maxEntries || undefined,
            verbose: this.verbose,
        });

        // 3. Initialize intent detector
        const groundingConfig = this.config.groundingConfig || {};
        const intentConfig = this.config.intentDetection || {};
        this._intentDetector = new IntentDetector({
            domainTerminology: groundingConfig.domainTerminology || {},
            featureMap: groundingConfig.featureMap || [],
            triggerTerms: intentConfig.triggerTerms || [],
            triggerPatterns: intentConfig.triggerPatterns || [],
            confidenceThreshold: intentConfig.confidenceThreshold || undefined,
            verbose: this.verbose,
        });

        this._initialized = true;
        const stats = this._cache.getStats();
        this._log(`✅ KB Connector initialized: ${this._providers.length} providers, ${stats.totalPages} cached pages`);

        return {
            providers: this._providers.length,
            cachePages: stats.totalPages,
            status: 'initialized',
        };
    }

    // ─── Query API ──────────────────────────────────────────────────

    /**
     * Query the knowledge base with hybrid fetch (cache → live fallback).
     * Includes automatic intent detection.
     *
     * @param {string} query - Search query
     * @param {Object} [options]
     * @param {string}   [options.spaceKey] - Filter to specific space
     * @param {number}   [options.maxResults] - Max results
     * @param {boolean}  [options.skipIntentCheck] - Skip intent detection (force fetch)
     * @returns {Promise<KBQueryResult>}
     */
    async query(query, options = {}) {
        this._ensureInitialized();

        // 1. Intent detection (unless skipped)
        if (!options.skipIntentCheck) {
            const intent = this._intentDetector.detect(query);
            if (!intent.shouldFetch) {
                this._log(`Intent: no KB fetch needed (confidence=${intent.confidence})`);
                return {
                    results: [],
                    fromCache: false,
                    intent,
                    totalResults: 0,
                    blocked: true,
                    reason: `Intent confidence too low (${intent.confidence.toFixed(2)} < threshold). ` +
                        `Try adding domain terms (e.g. "confluence", "documentation", "requirements") ` +
                        `or use skipIntentCheck=true to force a live search.`,
                };
            }
        }

        const maxResults = options.maxResults || this._maxResults;

        // 2. Try cache first
        const cacheResult = this._cache.search(query, {
            maxResults,
            spaceKey: options.spaceKey,
            minScore: this._minRelevanceScore,
        });

        if (cacheResult.results.length > 0 && cacheResult.fromCache) {
            this._log(`Cache hit: ${cacheResult.results.length} results`);
            return {
                results: cacheResult.results,
                fromCache: true,
                intent: this._intentDetector.detect(query),
                totalResults: cacheResult.results.length,
            };
        }

        // 3. If cache has fresh content that matched, use it
        if (cacheResult.results.length > 0) {
            this._log(`Cache search: ${cacheResult.results.length} results`);
            return {
                results: cacheResult.results,
                fromCache: false,
                intent: this._intentDetector.detect(query),
                totalResults: cacheResult.results.length,
            };
        }

        // 4. Live fetch from providers
        const liveResults = await this._fetchFromProviders(query, {
            maxResults,
            spaceKey: options.spaceKey,
        });

        if (liveResults.length > 0) {
            // Cache the fetched pages
            this._cache.addPages(liveResults);

            // Return formatted results
            const formatted = liveResults.slice(0, maxResults).map(page => ({
                id: page.id,
                title: page.title,
                excerpt: page.excerpt,
                url: page.url,
                space: page.space,
                lastModified: page.lastModified,
                relevance: 1.0, // Live results are already ranked by the provider
                provider: page.metadata?.provider || 'unknown',
            }));

            this._log(`Live fetch: ${formatted.length} results`);
            return {
                results: formatted,
                fromCache: false,
                intent: this._intentDetector.detect(query),
                totalResults: formatted.length,
            };
        }

        this._log(`No results found for: "${query}"`);
        return {
            results: [],
            fromCache: false,
            intent: this._intentDetector.detect(query),
            totalResults: 0,
        };
    }

    /**
     * Query with agent-specific boost terms.
     *
     * @param {string} agentName - Agent role (testgenie, scriptgenerator, etc.)
     * @param {string} query - Search query
     * @param {Object} [options]
     * @returns {Promise<KBQueryResult>}
     */
    async queryForAgent(agentName, query, options = {}) {
        // Determine agent-specific boost terms
        const boostTerms = this._agentBoosts[agentName] || [];

        // Enrich query with boost terms
        let enrichedQuery = query;
        if (boostTerms.length > 0) {
            // Append boost terms that aren't already in the query
            const queryLower = query.toLowerCase();
            const newTerms = boostTerms.filter(t => !queryLower.includes(t.toLowerCase()));
            if (newTerms.length > 0) {
                enrichedQuery = `${query} ${newTerms.slice(0, 3).join(' ')}`;
            }
        }

        return this.query(enrichedQuery, options);
    }

    /**
     * Build a formatted knowledge base context string for injection
     * into an agent's system prompt.
     *
     * @param {string} agentName - Agent role
     * @param {string} taskDescription - Current task description
     * @param {Object} [options]
     * @param {number} [options.maxChars] - Max context chars (default: 4000)
     * @returns {Promise<string>} Formatted context string, or empty string if no results
     */
    async buildKBContext(agentName, taskDescription, options = {}) {
        if (!taskDescription || !this._initialized) return '';

        const maxChars = options.maxChars || this._maxContextChars;

        try {
            const result = await this.queryForAgent(agentName, taskDescription, {
                maxResults: 5,
            });

            if (result.results.length === 0) return '';

            // Build formatted context
            const sections = [];
            sections.push('KNOWLEDGE BASE:');
            sections.push(`Source: ${this._providers.map(p => p.getProviderName()).join(', ')}`);
            sections.push('');

            let currentLength = sections.join('\n').length;

            for (const r of result.results) {
                const entry = `[${r.title}] (${r.url})\n${r.excerpt}\n`;

                if (currentLength + entry.length > maxChars) {
                    // Try truncating the excerpt
                    const remaining = maxChars - currentLength - `[${r.title}] (${r.url})\n\n`.length;
                    if (remaining > 50) {
                        const truncatedExcerpt = r.excerpt.slice(0, remaining) + '...';
                        sections.push(`[${r.title}] (${r.url})\n${truncatedExcerpt}`);
                    }
                    break;
                }

                sections.push(entry);
                currentLength += entry.length;
            }

            return sections.join('\n');
        } catch (error) {
            this._log(`buildKBContext failed: ${error.message}`);
            return '';
        }
    }

    // ─── Sync API ───────────────────────────────────────────────────

    /**
     * Sync pages from all configured providers to the local cache.
     *
     * @param {Object} [options]
     * @param {string[]} [options.spaceKeys] - Specific spaces to sync
     * @param {string[]} [options.rootPageIds] - Specific page trees to sync
     * @param {boolean}  [options.force] - Force re-fetch even if cache is fresh
     * @returns {Promise<{ totalPages: number, providers: Object[] }>}
     */
    async syncPages(options = {}) {
        this._ensureInitialized();
        const results = [];

        for (const provider of this._providers) {
            try {
                const providerResult = await this._syncProvider(provider, options);
                results.push(providerResult);
            } catch (error) {
                results.push({
                    provider: provider.getProviderName(),
                    success: false,
                    error: error.message,
                    pages: 0,
                });
            }
        }

        this._cache.markSynced();

        const totalPages = results.reduce((sum, r) => sum + (r.pages || 0), 0);
        this._log(`Sync complete: ${totalPages} total pages from ${results.length} providers`);

        return { totalPages, providers: results };
    }

    /**
     * Get a specific page (from cache or live).
     *
     * @param {string} pageId - Page ID
     * @param {Object} [options]
     * @param {boolean} [options.forceFresh] - Skip cache, fetch live
     * @returns {Promise<Object|null>}
     */
    async getPage(pageId, options = {}) {
        this._ensureInitialized();

        // Check cache first
        if (!options.forceFresh) {
            const cached = this._cache.getPage(pageId);
            if (cached.page && cached.fresh) {
                return cached.page;
            }
        }

        // Fetch from first available provider
        for (const provider of this._providers) {
            try {
                const page = await provider.getPage(pageId);
                if (page) {
                    // Cache it
                    this._cache.addPages([page]);
                    return page;
                }
            } catch (error) {
                this._log(`Provider ${provider.getProviderName()} failed for page ${pageId}: ${error.message}`);
            }
        }

        return null;
    }

    // ─── Health & Stats ─────────────────────────────────────────────

    /**
     * Get comprehensive stats about the KB connector.
     *
     * @returns {Promise<Object>}
     */
    async getStats() {
        const cacheStats = this._cache ? this._cache.getStats() : {};
        const providerStatuses = [];

        for (const provider of this._providers) {
            try {
                const status = await provider.testConnection();
                providerStatuses.push(status);
            } catch (error) {
                providerStatuses.push({
                    provider: provider.getProviderName(),
                    connected: false,
                    message: error.message,
                });
            }
        }

        return {
            initialized: this._initialized,
            providers: providerStatuses,
            cache: cacheStats,
            config: {
                maxResults: this._maxResults,
                maxContextChars: this._maxContextChars,
                minRelevanceScore: this._minRelevanceScore,
                intentThreshold: this._intentDetector?.confidenceThreshold || 0,
            },
        };
    }

    /**
     * Test connections to all providers.
     *
     * @returns {Promise<import('./kb-provider').KBConnectionStatus[]>}
     */
    async testConnections() {
        const results = [];
        for (const provider of this._providers) {
            try {
                results.push(await provider.testConnection());
            } catch (error) {
                results.push({
                    connected: false,
                    provider: provider.getProviderName(),
                    message: error.message,
                });
            }
        }
        return results;
    }

    /**
     * Clear the cache and reset the BM25 index.
     */
    clearCache() {
        if (this._cache) {
            this._cache.clear();
            this._log('Cache cleared');
        }
    }

    /**
     * Get the intent detector instance (for external use by tools).
     *
     * @returns {IntentDetector|null}
     */
    getIntentDetector() {
        return this._intentDetector;
    }

    // ─── Internal ───────────────────────────────────────────────────

    /**
     * Fetch results from all providers for a query.
     *
     * @param {string} query
     * @param {Object} options
     * @returns {Promise<import('./kb-provider').KBResult[]>}
     */
    async _fetchFromProviders(query, options = {}) {
        const allResults = [];

        for (const provider of this._providers) {
            try {
                const results = await provider.search(query, {
                    maxResults: options.maxResults || this._maxResults,
                    spaceKey: options.spaceKey,
                });
                allResults.push(...results);
            } catch (error) {
                this._log(`Provider ${provider.getProviderName()} search failed: ${error.message}`);
            }
        }

        // Deduplicate by page ID
        const seen = new Set();
        return allResults.filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
    }

    /**
     * Sync a single provider's content to cache.
     *
     * @param {import('./kb-provider').KBProvider} provider
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async _syncProvider(provider, options = {}) {
        const providerConfig = this.config.providers?.find(
            p => p.type === provider.getProviderType() && (p.name || p.type) === provider.getProviderName()
        ) || {};

        const spaceKeys = options.spaceKeys || providerConfig.spaceKeys || [];
        const rootPageIds = options.rootPageIds || providerConfig.rootPageIds || [];
        let totalPages = 0;

        // Sync by root page trees
        if (rootPageIds.length > 0) {
            for (const rootId of rootPageIds) {
                try {
                    const pages = await provider.getPageTree(rootId, {
                        depth: providerConfig.maxDepth || 3,
                        includeBody: true,
                    });
                    if (pages.length > 0) {
                        this._cache.addPages(pages);
                        totalPages += pages.length;
                    }
                } catch (error) {
                    this._log(`Failed to sync page tree ${rootId}: ${error.message}`);
                }
            }
        }

        // Sync by space search (if no root pages, do a broad search)
        if (rootPageIds.length === 0 && spaceKeys.length > 0) {
            for (const spaceKey of spaceKeys) {
                try {
                    // Fetch recent/important pages from the space
                    const pages = await provider.search('', {
                        spaceKey,
                        maxResults: this._cache.maxEntries,
                        cqlFilter: 'type = page ORDER BY lastModified DESC',
                    });
                    if (pages.length > 0) {
                        this._cache.addPages(pages);
                        totalPages += pages.length;
                    }
                } catch (error) {
                    this._log(`Failed to sync space ${spaceKey}: ${error.message}`);
                }
            }
        }

        return {
            provider: provider.getProviderName(),
            success: true,
            pages: totalPages,
        };
    }

    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error('KnowledgeBaseConnector is not initialized. Call initialize() first.');
        }
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[KBConnector] ${message}`);
        }
    }
}

// ─── Singleton Manager ──────────────────────────────────────────────────────

let _kbInstance = null;

/**
 * Get or create the singleton KnowledgeBaseConnector.
 *
 * @param {Object} [config] - Config passed on first call
 * @returns {KnowledgeBaseConnector}
 */
function getKnowledgeBaseConnector(config) {
    if (!_kbInstance) {
        _kbInstance = new KnowledgeBaseConnector(config);
    }
    return _kbInstance;
}

/**
 * Reset the singleton (for testing or config changes).
 */
function resetKnowledgeBaseConnector() {
    _kbInstance = null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} KBQueryResult
 * @property {Array}   results      - Ranked results
 * @property {boolean} fromCache    - Whether results came from cache
 * @property {Object}  intent       - Intent detection result
 * @property {number}  totalResults - Total result count
 */

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    KnowledgeBaseConnector,
    getKnowledgeBaseConnector,
    resetKnowledgeBaseConnector,
    createProvider,
};
