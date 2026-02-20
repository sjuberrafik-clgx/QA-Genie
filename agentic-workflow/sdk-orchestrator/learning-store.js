/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LEARNING STORE — Cross-Run Cumulative Intelligence
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Persistent JSON store that records what worked and what didn't across runs.
 * The AI doesn't start from zero each time — it learns from past mistakes via
 * the get_historical_failures tool and system message injection.
 *
 * Data categories:
 *   - failures:         Error events with fix attempts and outcomes
 *   - selectorMappings: Known-good selectors per page/element (stability scores)
 *   - pagePatterns:     Per-page knowledge (popups, load patterns, common issues)
 *
 * @module learning-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_PATH = path.join(__dirname, '..', 'learning-data', 'learning-store.json');

const EMPTY_STORE = {
    version: '1.0.0',
    lastUpdated: null,
    failures: [],
    selectorMappings: [],
    pagePatterns: [],
};

class LearningStore {
    /**
     * @param {string} [storePath] - Path to the store JSON file
     */
    constructor(storePath) {
        this.storePath = storePath || DEFAULT_STORE_PATH;
        this.data = this._load();
    }

    // ─── Failure Recording ──────────────────────────────────────────

    /**
     * Record a test failure and its resolution (if any).
     *
     * @param {Object} entry
     * @param {string} entry.ticketId
     * @param {string} [entry.page]       - URL or page identifier
     * @param {string} entry.errorType    - SELECTOR | TIMEOUT | NETWORK | ASSERTION | etc.
     * @param {string} entry.selector     - The selector that failed
     * @param {string} [entry.fix]        - What was applied to fix it
     * @param {string} entry.outcome      - 'fixed' | 'persisted' | 'pending'
     * @param {string} [entry.method]     - 'auto-fix' | 'sdk-heal' | 'manual'
     * @param {string} [entry.timestamp]
     */
    recordFailure(entry) {
        this.data.failures.push({
            ticketId: entry.ticketId || 'unknown',
            page: entry.page || null,
            errorType: entry.errorType || 'UNKNOWN',
            selector: entry.selector || '',
            fix: entry.fix || null,
            outcome: entry.outcome || 'pending',
            method: entry.method || 'unknown',
            timestamp: entry.timestamp || new Date().toISOString(),
        });

        // Keep store bounded — trim old entries
        if (this.data.failures.length > 500) {
            this.data.failures = this.data.failures.slice(-500);
        }

        this.data.lastUpdated = new Date().toISOString();
    }

    /**
     * Update the outcome of a previous failure entry.
     */
    updateFailureOutcome(ticketId, selector, outcome) {
        const entry = this.data.failures
            .slice()
            .reverse()
            .find(f => f.ticketId === ticketId && f.selector === selector);

        if (entry) {
            entry.outcome = outcome;
            this.data.lastUpdated = new Date().toISOString();
        }
    }

    // ─── Stable Selector Mappings ───────────────────────────────────

    /**
     * Record a stable selector mapping — a known-good selector for an element.
     *
     * @param {Object} mapping
     * @param {string} mapping.page        - Page URL or identifier
     * @param {string} mapping.element     - Logical element name (e.g., "search-button")
     * @param {string[]} mapping.tried     - Selectors attempted (in order)
     * @param {string} mapping.stable      - The selector that worked
     * @param {number} [mapping.confidence] - 0.0 to 1.0 (how many times it worked)
     */
    recordStableSelector(mapping) {
        // Upsert — update if same page+element exists
        const existing = this.data.selectorMappings.find(
            m => m.page === mapping.page && m.element === mapping.element
        );

        if (existing) {
            // Merge tried selectors
            const allTried = [...new Set([...(existing.tried || []), ...(mapping.tried || [])])];
            existing.tried = allTried;
            existing.stable = mapping.stable;
            existing.confidence = mapping.confidence ?? existing.confidence;
            existing.lastUpdated = new Date().toISOString();
        } else {
            this.data.selectorMappings.push({
                page: mapping.page,
                element: mapping.element,
                tried: mapping.tried || [],
                stable: mapping.stable,
                confidence: mapping.confidence ?? 0.8,
                lastUpdated: new Date().toISOString(),
            });
        }

        // Trim to 200 mappings max
        if (this.data.selectorMappings.length > 200) {
            this.data.selectorMappings = this.data.selectorMappings.slice(-200);
        }

        this.data.lastUpdated = new Date().toISOString();
    }

    // ─── Page Pattern Knowledge ─────────────────────────────────────

    /**
     * Record a pattern discovered about a page (popups, load behavior, etc.).
     *
     * @param {Object} pattern
     * @param {string} pattern.url          - Page URL
     * @param {Array} [pattern.popups]       - Popup types detected
     * @param {Array} [pattern.commonIssues] - Recurring issues
     * @param {number} [pattern.avgLoadTime] - Average page load time in ms
     */
    recordPagePattern(pattern) {
        const existing = this.data.pagePatterns.find(p => p.url === pattern.url);

        if (existing) {
            if (pattern.popups) {
                existing.popups = [...new Set([...(existing.popups || []), ...pattern.popups])];
            }
            if (pattern.commonIssues) {
                existing.commonIssues = [...new Set([...(existing.commonIssues || []), ...pattern.commonIssues])];
            }
            if (pattern.avgLoadTime) {
                existing.avgLoadTime = pattern.avgLoadTime;
            }
            existing.lastSeen = new Date().toISOString();
        } else {
            this.data.pagePatterns.push({
                url: pattern.url,
                popups: pattern.popups || [],
                commonIssues: pattern.commonIssues || [],
                avgLoadTime: pattern.avgLoadTime || null,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            });
        }

        this.data.lastUpdated = new Date().toISOString();
    }

    // ─── Queries ────────────────────────────────────────────────────

    /**
     * Get failures for a specific ticket.
     */
    getFailuresForTicket(ticketId) {
        return this.data.failures.filter(f => f.ticketId === ticketId);
    }

    /**
     * Get failures for a specific page URL.
     */
    getFailuresForPage(page) {
        return this.data.failures.filter(f =>
            f.page && f.page.includes(page)
        );
    }

    /**
     * Get the most recent failures.
     */
    getRecentFailures(limit = 20) {
        return this.data.failures.slice(-limit);
    }

    /**
     * Get stable selector mappings for a page.
     */
    getStableSelectors(page) {
        if (!page) return this.data.selectorMappings;
        return this.data.selectorMappings.filter(m =>
            m.page && m.page.includes(page)
        );
    }

    /**
     * Get page pattern knowledge.
     */
    getPagePattern(url) {
        return this.data.pagePatterns.find(p => url && url.includes(p.url));
    }

    /**
     * Get aggregate statistics.
     */
    getStats() {
        const failures = this.data.failures;
        const byCategory = {};
        let fixedCount = 0;

        for (const f of failures) {
            byCategory[f.errorType] = (byCategory[f.errorType] || 0) + 1;
            if (f.outcome === 'fixed') fixedCount++;
        }

        return {
            totalFailures: failures.length,
            totalStableSelectors: this.data.selectorMappings.length,
            totalPagePatterns: this.data.pagePatterns.length,
            byCategory,
            fixRate: failures.length > 0
                ? Math.round((fixedCount / failures.length) * 100)
                : 0,
            lastUpdated: this.data.lastUpdated,
        };
    }

    // ─── Persistence ────────────────────────────────────────────────

    /**
     * Save the store to disk.
     */
    save() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`[LearningStore] Failed to save: ${error.message}`);
        }
    }

    /**
     * Load the store from disk, or initialize empty.
     */
    _load() {
        try {
            if (fs.existsSync(this.storePath)) {
                const raw = fs.readFileSync(this.storePath, 'utf-8');
                const parsed = JSON.parse(raw);
                // Validate structure
                return {
                    ...EMPTY_STORE,
                    ...parsed,
                    failures: parsed.failures || [],
                    selectorMappings: parsed.selectorMappings || [],
                    pagePatterns: parsed.pagePatterns || [],
                };
            }
        } catch (error) {
            console.warn(`[LearningStore] Could not load store, starting fresh: ${error.message}`);
        }
        return { ...EMPTY_STORE };
    }

    /**
     * Reset the store (for testing).
     */
    reset() {
        this.data = { ...EMPTY_STORE };
        this.save();
    }
}

module.exports = { LearningStore };
