/**
 * TTL cache for tool results and delete confirmation helpers.
 * Extracted from custom-tools.js
 */

// ─── TTL Cache for Tool Results ─────────────────────────────────────────────

/**
 * Lightweight TTL cache for idempotent tool results.
 * Prevents redundant I/O when the same tool is called multiple times
 * across sessions within a pipeline run (e.g., get_framework_inventory
 * called by scriptgenerator then codereviewer within minutes).
 *
 * Default TTL: 5 minutes. Cache is per-process (singleton).
 */
class ToolResultCache {
    constructor(defaultTTL = 5 * 60 * 1000) {
        this._cache = new Map();
        this._defaultTTL = defaultTTL;
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Read a cached value if it is still fresh.
     *
     * @param {string} key
     * @returns {*|null}
     */
    get(key) {
        const entry = this._cache.get(key);
        const now = Date.now();

        if (entry && (now - entry.timestamp) < entry.ttl) {
            this._hits++;
            return entry.value;
        }

        if (entry) {
            this._cache.delete(key);
        }

        this._misses++;
        return null;
    }

    /**
     * Write a value into the cache with an optional TTL override.
     *
     * @param {string} key
     * @param {*} value
     * @param {number} [ttl]
     */
    set(key, value, ttl) {
        this._cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl: ttl || this._defaultTTL,
        });

        if (this._cache.size > 50) {
            this._evictStale();
        }
    }

    /**
     * Get a cached result, or compute and cache it.
     *
     * @param {string} key         - Cache key (typically tool name + serialized args)
     * @param {Function} compute   - async function to compute the result if not cached
     * @param {number} [ttl]       - Custom TTL in ms (default: 5 min)
     * @returns {Promise<*>}       - The cached or freshly computed result
     */
    async getOrCompute(key, compute, ttl) {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        const value = await compute();
        this.set(key, value, ttl);

        return value;
    }

    /** Remove entries older than their TTL */
    _evictStale() {
        const now = Date.now();
        for (const [key, entry] of this._cache) {
            const ttl = entry.ttl || this._defaultTTL;
            if ((now - entry.timestamp) > ttl) {
                this._cache.delete(key);
            }
        }
    }

    /** Clear the entire cache (useful after config changes) */
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }

    /** Get cache statistics for diagnostics */
    getStats() {
        return {
            size: this._cache.size,
            hits: this._hits,
            misses: this._misses,
            hitRate: this._hits + this._misses > 0
                ? ((this._hits / (this._hits + this._misses)) * 100).toFixed(1) + '%'
                : 'N/A',
        };
    }
}

// Singleton cache instance
const _toolCache = new ToolResultCache();
function getToolCache() { return _toolCache; }

function normalizeDeleteConfirmationText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function buildExpectedJiraDeleteConfirmation(ticketId, deleteSubtasks = false) {
    const normalizedTicketId = String(ticketId || '').trim().toUpperCase();
    return deleteSubtasks
        ? `DELETE ${normalizedTicketId} WITH SUBTASKS`
        : `DELETE ${normalizedTicketId}`;
}

function buildJiraDeleteFallbackSuggestions(ticketId, deleteSubtasks = false) {
    return [
        {
            action: 'transition_jira_ticket',
            reason: `Preserve the issue history by moving ${ticketId} to a cancelled or done state instead of deleting it permanently.`,
        },
        {
            action: 'archive_issue',
            availability: 'Atlassian issue archival requires Jira admin or site admin permissions and Premium or Enterprise licensing.',
            reason: deleteSubtasks
                ? 'Archive is safer than hard-deleting a parent issue and all of its subtasks.'
                : 'Archive is safer when the tenant prefers reversible retention instead of permanent deletion.',
        },
    ];
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

module.exports = {
    ToolResultCache,
    getToolCache,
    normalizeDeleteConfirmationText,
    buildExpectedJiraDeleteConfirmation,
    buildJiraDeleteFallbackSuggestions,
};
