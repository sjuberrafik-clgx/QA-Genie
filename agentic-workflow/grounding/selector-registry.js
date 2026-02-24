/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SELECTOR REGISTRY — Centralized Selector Knowledge Base
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Builds and queries a centralized registry of all known selectors across:
 *   - Page object files (this.x = page.locator/getByRole/etc.)
 *   - MCP exploration snapshots (live accessibility tree data)
 *   - LearningStore stable selector mappings (cross-run intelligence)
 *
 * Each selector is enriched with:
 *   - Stability score (based on selector type and historical data)
 *   - Source provenance (page object, MCP snapshot, or learning store)
 *   - Page/URL association
 *   - Last verified timestamp
 *
 * @module selector-registry
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Default Reliability Scores ─────────────────────────────────────────────

const DEFAULT_RELIABILITY = {
    'data-qa': 0.95,
    'data-test-id': 0.95,
    'data-testid': 0.95,
    'getByRole': 0.85,
    'aria-label': 0.80,
    'getByText': 0.70,
    'getByLabel': 0.75,
    'getByPlaceholder': 0.70,
    'getByTestId': 0.90,
    'getByAltText': 0.65,
    'css-class': 0.50,
    'css-id': 0.60,
    'locator': 0.55,
    'xpath': 0.30,
};

// ─── Selector Registry ─────────────────────────────────────────────────────

class SelectorRegistry {
    /**
     * @param {Object} [config] - Grounding config's selectorRegistry section
     */
    constructor(config = {}) {
        this.entries = [];
        this.reliabilityScores = { ...DEFAULT_RELIABILITY, ...(config.reliabilityScores || {}) };
        this.priorityOrder = config.priorityOrder || Object.keys(DEFAULT_RELIABILITY);
        this._byPage = new Map();   // pageUrl → SelectorEntry[]
        this._byElement = new Map(); // elementName → SelectorEntry[]
    }

    /**
     * Build registry from page object files.
     *
     * @param {string} pageObjectsDir - Absolute path to page objects directory
     * @returns {number} Number of selectors extracted
     */
    buildFromPageObjects(pageObjectsDir) {
        if (!fs.existsSync(pageObjectsDir)) return 0;

        let count = 0;
        const files = this._walkDir(pageObjectsDir, '.js');

        for (const filePath of files) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const relPath = path.relative(pageObjectsDir, filePath);
                const pageName = path.basename(filePath, '.js');
                const selectors = this._extractSelectorsFromPageObject(content, pageName, relPath);

                for (const sel of selectors) {
                    this._addEntry(sel);
                    count++;
                }
            } catch {
                // Skip unreadable files
            }
        }

        return count;
    }

    /**
     * Build registry from MCP exploration data.
     *
     * @param {string} explorationDir - Absolute path to exploration-data directory
     * @returns {number} Number of selectors extracted
     */
    buildFromExploration(explorationDir) {
        if (!fs.existsSync(explorationDir)) return 0;

        let count = 0;
        const files = fs.readdirSync(explorationDir)
            .filter(f => f.endsWith('-exploration.json'));

        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(explorationDir, file), 'utf-8');
                const data = JSON.parse(raw);

                const ticketId = data.ticketId || file.replace('-exploration.json', '');
                const timestamp = data.timestamp || null;

                const snapshots = data.snapshots || [];
                for (const snap of snapshots) {
                    const pageUrl = snap.url || snap.pageUrl || '';
                    const elements = snap.elements || snap.accessibilityTree || [];

                    for (const el of elements) {
                        if (!el.role && !el.name && !el.ref) continue;

                        const entry = {
                            elementName: el.name || el.ref || el.role || 'unknown',
                            selectorType: this._inferSelectorType(el),
                            selectorValue: this._buildSelectorValue(el),
                            page: pageUrl,
                            pageName: ticketId,
                            source: 'mcp-exploration',
                            reliability: this._inferReliability(el),
                            lastVerified: timestamp,
                            metadata: {
                                role: el.role,
                                ref: el.ref,
                                dataQa: el.dataQa || el['data-qa'] || null,
                                ariaLabel: el.ariaLabel || el['aria-label'] || null,
                            },
                        };

                        this._addEntry(entry);
                        count++;
                    }
                }
            } catch {
                // Skip malformed files
            }
        }

        return count;
    }

    /**
     * Merge with LearningStore's stable selector mappings.
     *
     * @param {Object} learningStore - LearningStore instance
     * @returns {number} Number of entries enriched or added
     */
    mergeWithLearningStore(learningStore) {
        if (!learningStore) return 0;

        let count = 0;
        const mappings = learningStore.getStableSelectors();

        for (const mapping of mappings) {
            // Find existing entry and update confidence
            const existing = this.entries.find(
                e => e.page && mapping.page &&
                    e.page.includes(mapping.page) &&
                    e.elementName === mapping.element
            );

            if (existing) {
                existing.reliability = Math.max(existing.reliability, mapping.confidence || 0.8);
                existing.selectorValue = mapping.stable;
                existing.source = 'learning-store-verified';
                existing.lastVerified = mapping.lastUpdated;
                count++;
            } else {
                // Add as new entry
                this._addEntry({
                    elementName: mapping.element,
                    selectorType: this._classifySelectorString(mapping.stable),
                    selectorValue: mapping.stable,
                    page: mapping.page,
                    pageName: mapping.page,
                    source: 'learning-store',
                    reliability: mapping.confidence || 0.8,
                    lastVerified: mapping.lastUpdated,
                    metadata: {
                        tried: mapping.tried || [],
                    },
                });
                count++;
            }
        }

        return count;
    }

    /**
     * Get selector recommendations for a page.
     *
     * @param {string} pageUrl - Full or partial page URL
     * @param {string} [elementHint] - Optional element name/description to filter
     * @returns {Object[]} Ranked selectors with reliability scores
     */
    recommend(pageUrl, elementHint) {
        let candidates = this.getPageSelectors(pageUrl);

        // Filter by element hint if provided
        if (elementHint) {
            const hint = elementHint.toLowerCase();
            const filtered = candidates.filter(e => {
                const name = (e.elementName || '').toLowerCase();
                const selector = (e.selectorValue || '').toLowerCase();
                return name.includes(hint) || selector.includes(hint) ||
                    hint.split(/\s+/).some(w => name.includes(w) || selector.includes(w));
            });
            if (filtered.length > 0) candidates = filtered;
        }

        // Sort by reliability (descending), then by priority order
        return candidates.sort((a, b) => {
            const reliDiff = b.reliability - a.reliability;
            if (Math.abs(reliDiff) > 0.05) return reliDiff;

            const aIdx = this.priorityOrder.indexOf(a.selectorType);
            const bIdx = this.priorityOrder.indexOf(b.selectorType);
            return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });
    }

    /**
     * Get all known selectors for a page.
     *
     * @param {string} pageUrl - Full or partial page URL
     * @returns {Object[]}
     */
    getPageSelectors(pageUrl) {
        if (!pageUrl) return [...this.entries];

        const urlLower = pageUrl.toLowerCase();
        return this.entries.filter(e => {
            if (!e.page) return false;
            return e.page.toLowerCase().includes(urlLower) ||
                urlLower.includes(e.page.toLowerCase());
        });
    }

    /**
     * Get stability score for a specific selector.
     *
     * @param {string} selector - Selector string
     * @returns {number} Reliability score 0-1
     */
    getStabilityScore(selector) {
        const type = this._classifySelectorString(selector);
        return this.reliabilityScores[type] || 0.50;
    }

    /**
     * Get registry statistics.
     */
    getStats() {
        const bySource = {};
        const byType = {};
        const byPage = {};

        for (const e of this.entries) {
            bySource[e.source] = (bySource[e.source] || 0) + 1;
            byType[e.selectorType] = (byType[e.selectorType] || 0) + 1;
            const page = e.pageName || e.page || 'unknown';
            byPage[page] = (byPage[page] || 0) + 1;
        }

        return {
            totalSelectors: this.entries.length,
            bySource,
            byType,
            byPage,
            avgReliability: this.entries.length > 0
                ? (this.entries.reduce((sum, e) => sum + e.reliability, 0) / this.entries.length).toFixed(2)
                : 0,
        };
    }

    /**
     * Serialize to JSON.
     */
    toJSON() {
        return {
            entries: this.entries,
            buildTimestamp: new Date().toISOString(),
        };
    }

    /**
     * Restore from JSON.
     */
    static fromJSON(json, config = {}) {
        const registry = new SelectorRegistry(config);
        registry.entries = json.entries || [];
        registry._rebuildMaps();
        return registry;
    }

    // ─── Private Helpers ────────────────────────────────────────────

    _addEntry(entry) {
        this.entries.push(entry);

        // Update lookup maps
        if (entry.page) {
            const existing = this._byPage.get(entry.page) || [];
            existing.push(entry);
            this._byPage.set(entry.page, existing);
        }
        if (entry.elementName) {
            const existing = this._byElement.get(entry.elementName) || [];
            existing.push(entry);
            this._byElement.set(entry.elementName, existing);
        }
    }

    _rebuildMaps() {
        this._byPage.clear();
        this._byElement.clear();
        for (const e of this.entries) {
            if (e.page) {
                const list = this._byPage.get(e.page) || [];
                list.push(e);
                this._byPage.set(e.page, list);
            }
            if (e.elementName) {
                const list = this._byElement.get(e.elementName) || [];
                list.push(e);
                this._byElement.set(e.elementName, list);
            }
        }
    }

    _extractSelectorsFromPageObject(content, pageName, relPath) {
        const selectors = [];

        // Pattern: this.elementName = page.locator('selector')
        const locatorPattern = /this\.(\w+)\s*=\s*(?:page|this\.page)\s*\.\s*(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByAltText)\s*\(\s*(['"`])(.*?)\3/g;
        let match;
        while ((match = locatorPattern.exec(content)) !== null) {
            const [, elementName, method, , selector] = match;
            selectors.push({
                elementName,
                selectorType: this._methodToType(method, selector),
                selectorValue: `${method}('${selector}')`,
                page: null,
                pageName,
                source: 'page-object',
                reliability: this.reliabilityScores[this._methodToType(method, selector)] || 0.5,
                lastVerified: null,
                metadata: { file: relPath, method, rawSelector: selector },
            });
        }

        // Pattern: this.elementName = page.locator('[data-qa="..."]')
        const dataQaPattern = /this\.(\w+)\s*=\s*(?:page|this\.page)\s*\.\s*locator\s*\(\s*(['"`])\[data-(?:qa|test-id|testid)=["']([^"']+)["']\]\2/g;
        while ((match = dataQaPattern.exec(content)) !== null) {
            const [, elementName, , value] = match;
            const existing = selectors.find(s => s.elementName === elementName);
            if (existing) {
                existing.selectorType = 'data-qa';
                existing.reliability = this.reliabilityScores['data-qa'] || 0.95;
            }
        }

        return selectors;
    }

    _methodToType(method, selector) {
        if (method === 'getByRole') return 'getByRole';
        if (method === 'getByText') return 'getByText';
        if (method === 'getByLabel') return 'getByLabel';
        if (method === 'getByPlaceholder') return 'getByPlaceholder';
        if (method === 'getByTestId') return 'getByTestId';
        if (method === 'getByAltText') return 'getByAltText';
        if (method === 'locator') {
            if (/\[data-(?:qa|test-id|testid)/.test(selector)) return 'data-qa';
            if (/\[aria-label/.test(selector)) return 'aria-label';
            if (selector.startsWith('#')) return 'css-id';
            if (selector.startsWith('//') || selector.startsWith('xpath=')) return 'xpath';
            return 'css-class';
        }
        return 'locator';
    }

    _classifySelectorString(selector) {
        if (!selector) return 'unknown';
        const s = selector.toLowerCase();
        if (s.includes('getbyrole')) return 'getByRole';
        if (s.includes('getbytext')) return 'getByText';
        if (s.includes('getbylabel')) return 'getByLabel';
        if (s.includes('getbytestid')) return 'getByTestId';
        if (s.includes('data-qa') || s.includes('data-test')) return 'data-qa';
        if (s.includes('aria-label')) return 'aria-label';
        if (s.includes('xpath') || s.startsWith('//')) return 'xpath';
        if (s.startsWith('#')) return 'css-id';
        if (s.startsWith('.')) return 'css-class';
        return 'locator';
    }

    _inferSelectorType(element) {
        if (element.dataQa || element['data-qa']) return 'data-qa';
        if (element.testId || element['data-testid']) return 'getByTestId';
        if (element.role) return 'getByRole';
        if (element.ariaLabel || element['aria-label']) return 'aria-label';
        if (element.name) return 'getByText';
        return 'locator';
    }

    _buildSelectorValue(element) {
        if (element.dataQa || element['data-qa']) {
            return `locator('[data-qa="${element.dataQa || element['data-qa']}"]')`;
        }
        if (element.testId || element['data-testid']) {
            return `getByTestId('${element.testId || element['data-testid']}')`;
        }
        if (element.role && element.name) {
            return `getByRole('${element.role}', { name: '${element.name}' })`;
        }
        if (element.role) {
            return `getByRole('${element.role}')`;
        }
        if (element.ariaLabel || element['aria-label']) {
            return `locator('[aria-label="${element.ariaLabel || element['aria-label']}"]')`;
        }
        if (element.name) {
            return `getByText('${element.name}')`;
        }
        return element.ref ? `ref:${element.ref}` : 'unknown';
    }

    _inferReliability(element) {
        const type = this._inferSelectorType(element);
        return this.reliabilityScores[type] || 0.50;
    }

    _walkDir(dir, ext) {
        const results = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this._walkDir(fullPath, ext));
                } else if (entry.isFile() && entry.name.endsWith(ext)) {
                    results.push(fullPath);
                }
            }
        } catch {
            // Skip inaccessible directories
        }
        return results;
    }
}

module.exports = { SelectorRegistry };
