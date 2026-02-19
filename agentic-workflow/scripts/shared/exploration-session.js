/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * EXPLORATION SESSION - SINGLE SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Unified ExplorationSession class used across all workflow scripts.
 * Single source of truth for exploration session recording.
 * 
 * Features:
 * - Recording of MCP tool calls (navigations, clicks, snapshots, etc.)
 * - Snapshot parsing and element ref tracking
 * - Session export for script generation
 * - Page/element/action tracking with timestamps
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Parse Playwright MCP snapshot YAML into structured elements
 * @param {string} snapshotYaml - Raw snapshot YAML text
 * @returns {Array} Parsed element objects
 */
function parseSnapshotYaml(snapshotYaml) {
    const elements = [];
    if (!snapshotYaml || typeof snapshotYaml !== 'string') return elements;

    const lines = snapshotYaml.split('\n');
    for (const line of lines) {
        const refMatch = line.match(/\[ref=([^\]]+)\]/);
        if (!refMatch) continue;

        const ref = refMatch[1];
        const roleMatch = line.match(/^-?\s*(\w+)/);
        const role = roleMatch ? roleMatch[1] : 'unknown';

        const nameMatch = line.match(/:\s*(.+)$/);
        let name = nameMatch ? nameMatch[1].trim() : '';
        if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);

        elements.push({ ref, role, name, rawLine: line.trim() });
    }
    return elements;
}

/**
 * ExplorationSession - Records all MCP interactions for script generation.
 * 
 * Supports two usage patterns:
 * 1. Simple tracking (from mcp-orchestrator): pages, elements, actions
 * 2. Full recording (from mcp-exploration-runner): tool calls, snapshots, element refs
 */
class ExplorationSession {
    /**
     * @param {string} ticketId - Jira ticket ID (e.g., 'AOTF-16461')
     * @param {Object} options - Configuration options
     * @param {string} [options.environment='UAT'] - Target environment
     * @param {string} [options.baseUrl=''] - Base URL for the application
     * @param {string} [options.token=''] - Auth token
     * @param {number} [options.timeout=30000] - Default timeout in ms
     */
    constructor(ticketId, options = {}) {
        this.ticketId = ticketId;
        this.sessionId = `explore-${ticketId}-${Date.now()}`;
        this.environment = options.environment || 'UAT';
        this.options = {
            environment: this.environment,
            baseUrl: options.baseUrl || '',
            token: options.token || '',
            timeout: options.timeout || 30000
        };

        this.startTime = Date.now();
        this.currentUrl = null;

        // Simple tracking (orchestrator pattern)
        this.pages = [];
        this.elements = [];
        this.actions = [];
        this.popupsHandled = [];
        this.errors = [];

        // Full recording (exploration-runner pattern)
        this.recordings = [];
        this.snapshots = [];
        this.capturedElements = new Map();
        this.pagesVisited = [];
    }

    // =========================================================
    // Simple tracking API
    // =========================================================

    /**
     * Add a visited page
     */
    addPage(url, title, snapshot) {
        const page = {
            url,
            title,
            snapshot,
            timestamp: new Date(),
            elements: []
        };
        this.pages.push(page);
        if (url && !this.pagesVisited.includes(url)) {
            this.pagesVisited.push(url);
        }
        this.currentUrl = url;
        return page;
    }

    /**
     * Add a discovered element
     */
    addElement(selector, type, attributes, pageIndex = -1) {
        const element = {
            selector,
            type,
            attributes,
            pageIndex: pageIndex >= 0 ? pageIndex : this.pages.length - 1
        };
        this.elements.push(element);

        if (this.pages.length > 0) {
            const idx = pageIndex >= 0 ? pageIndex : this.pages.length - 1;
            if (this.pages[idx]) {
                this.pages[idx].elements.push(element);
            }
        }
        return element;
    }

    /**
     * Add a performed action
     */
    addAction(action, target, result) {
        this.actions.push({
            action,
            target,
            result,
            timestamp: new Date()
        });
    }

    /**
     * Track a handled popup
     */
    addPopupHandled(type, method) {
        this.popupsHandled.push({
            type,
            method,
            timestamp: new Date()
        });
    }

    // =========================================================
    // Full recording API (mcp-exploration-runner pattern)
    // =========================================================

    /**
     * Record a tool call with params and result
     */
    record(tool, params, result = null, error = null) {
        const recording = {
            id: this.recordings.length + 1,
            timestamp: new Date().toISOString(),
            elapsed: Date.now() - this.startTime,
            tool,
            params,
            result,
            error,
            url: this.currentUrl
        };
        this.recordings.push(recording);
        if (error) {
            this.errors.push({ tool, error, timestamp: new Date() });
        }
        return recording;
    }

    /**
     * Store and parse a snapshot, extracting element refs
     */
    storeSnapshot(snapshotYaml, url = null) {
        const elements = parseSnapshotYaml(snapshotYaml);
        const snapshot = {
            id: this.snapshots.length + 1,
            timestamp: new Date().toISOString(),
            url: url || this.currentUrl,
            elementCount: elements.length,
            elements
        };
        this.snapshots.push(snapshot);
        elements.forEach(el => {
            if (el.ref) this.capturedElements.set(el.ref, el);
        });
        return { snapshot, elements };
    }

    /**
     * Get a captured element by ref
     */
    getElement(ref) {
        return this.capturedElements.get(ref);
    }

    /**
     * Find elements by role and name pattern
     */
    findElements(role, nameContains) {
        const matches = [];
        this.capturedElements.forEach((el, ref) => {
            if (el.role === role && el.name && el.name.toLowerCase().includes(nameContains.toLowerCase())) {
                matches.push({ ref, ...el });
            }
        });
        return matches;
    }

    // =========================================================
    // Export / Summary
    // =========================================================

    /**
     * Get a summary of the session
     */
    getSummary() {
        return {
            sessionId: this.sessionId,
            ticketId: this.ticketId,
            environment: this.environment,
            duration: Date.now() - this.startTime,
            pagesExplored: this.pages.length,
            elementsFound: this.elements.length,
            actionsPerformed: this.actions.length,
            popupsHandled: this.popupsHandled.length,
            totalRecordings: this.recordings.length,
            totalSnapshots: this.snapshots.length,
            uniqueElements: this.capturedElements.size,
            pagesVisited: this.pagesVisited,
            startedAt: new Date(this.startTime).toISOString(),
            endedAt: new Date().toISOString()
        };
    }

    /**
     * Export full session data (for script generation).
     * Enriched elements include pre-validated selector data from SelectorEngine.
     */
    export() {
        // Enrich captured elements with selector metadata when available
        const enrichedCapturedElements = Array.from(this.capturedElements.entries()).map(([ref, el]) => {
            const enriched = { ref, ...el };
            // If element has selector data from SelectorEngine, include it
            if (el.selector && el.selector.primary) {
                enriched.selectorStrategy = el.selector.strategy;
                enriched.selectorScore = el.selector.stabilityScore;
                enriched.selectorUnique = el.selector.isUnique;
            }
            return enriched;
        });

        return {
            meta: this.getSummary(),
            pages: this.pages,
            elements: this.elements,
            actions: this.actions,
            popupsHandled: this.popupsHandled,
            recordings: this.recordings,
            snapshots: this.snapshots,
            capturedElements: enrichedCapturedElements,
            errors: this.errors
        };
    }

    /**
     * Serialize session to JSON
     */
    toJSON() {
        return {
            ticketId: this.ticketId,
            environment: this.environment,
            startTime: new Date(this.startTime),
            endTime: new Date(),
            duration: Date.now() - this.startTime,
            summary: {
                pagesExplored: this.pages.length,
                elementsFound: this.elements.length,
                actionsPerformed: this.actions.length,
                popupsHandled: this.popupsHandled.length
            },
            pages: this.pages,
            elements: this.elements,
            actions: this.actions,
            popupsHandled: this.popupsHandled,
            errors: this.errors
        };
    }
}

module.exports = {
    ExplorationSession,
    parseSnapshotYaml
};
