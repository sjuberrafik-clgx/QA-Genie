/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GROUNDING STORE — Project-Scoped Local Context for LLM Agents
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Central grounding system that provides agents with relevant, ranked local
 * context from the project's codebase, reducing hallucinations by ensuring
 * the LLM works with real selectors, real method signatures, real page objects,
 * and real domain knowledge instead of guessing.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────┐
 *   │           GroundingStore                 │
 *   │  .query(text)         → ranked chunks   │
 *   │  .queryForAgent(agent, task)             │
 *   │  .getFeatureContext(featureName)         │
 *   │  .getSelectorRecommendations(page)       │
 *   │  .getDomainContext()                     │
 *   │  .getExplorationFreshness(ticketId)      │
 *   └─────────┬───────────────┬───────────────┘
 *             │               │
 *   ┌─────────▼──────┐  ┌────▼──────────────┐
 *   │  BM25Index      │  │ SelectorRegistry   │
 *   │  (text-indexer)  │  │ (selector-registry)│
 *   └────────────────┘  └───────────────────┘
 *
 * Customizable per project via grounding-config.json.
 * Different users with different applications define their own:
 *   - Feature maps (feature → page → component → URL)
 *   - Domain terminology
 *   - Custom grounding rules
 *   - Index sources and retrieval settings
 *
 * @module grounding-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { BM25Index, chunk, tokenize } = require('./text-indexer');
const { SelectorRegistry } = require('./selector-registry');

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'grounding-config.json');
const DEFAULT_INDEX_DIR = path.join(__dirname, '..', 'grounding-data');
const INDEX_FILE = 'grounding-index.json';
const SELECTOR_FILE = 'selector-registry.json';
const MTIME_FILE = 'file-mtimes.json';

// ─── GroundingStore ─────────────────────────────────────────────────────────

class GroundingStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.configPath] - Path to grounding-config.json
     * @param {string} [options.indexDir]   - Directory for persisted index files
     * @param {string} [options.projectRoot] - Project root (for resolving relative paths)
     * @param {Object} [options.learningStore] - LearningStore instance for cross-run data
     * @param {boolean} [options.verbose] - Enable debug logging
     */
    constructor(options = {}) {
        this.configPath = options.configPath || DEFAULT_CONFIG_PATH;
        this.indexDir = options.indexDir || DEFAULT_INDEX_DIR;
        this.projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
        this.learningStore = options.learningStore || null;
        this.verbose = options.verbose || false;

        // Load configuration
        this.config = this._loadConfig();

        // Core components (initialized lazily or via buildIndex)
        this.index = null;              // BM25Index
        this.selectorRegistry = null;   // SelectorRegistry
        this._fileMtimes = new Map();   // filePath → mtime (for staleness)
        this._lastBuildTime = null;
        this._initialized = false;
    }

    // ─── Index Building ─────────────────────────────────────────────

    /**
     * Build or rebuild the full grounding index.
     * Scans all configured indexSources, chunks files, builds BM25 index
     * and selector registry.
     *
     * @param {Object} [options]
     * @param {boolean} [options.force=false] - Force full rebuild even if index exists
     * @returns {{ chunks: number, selectors: number, files: number, elapsed: number }}
     */
    buildIndex(options = {}) {
        const startTime = Date.now();
        this._log('Building grounding index...');

        const settings = this.config.indexSettings || {};
        const sources = this.config.indexSources || [];

        // Create fresh index
        this.index = new BM25Index();
        this.selectorRegistry = new SelectorRegistry(this.config.selectorRegistry || {});

        let totalFiles = 0;
        let totalChunks = 0;
        const newMtimes = new Map();

        // 1. Index all configured sources
        for (const source of sources) {
            const absPath = path.resolve(this.projectRoot, source.path);
            if (!fs.existsSync(absPath)) {
                this._log(`  ⚠ Source not found: ${source.path}`);
                continue;
            }

            const files = this._collectFiles(absPath, settings);
            this._log(`  📁 ${source.path} (${source.type}): ${files.length} files`);

            for (const filePath of files) {
                try {
                    const stat = fs.statSync(filePath);
                    const relPath = path.relative(this.projectRoot, filePath);
                    newMtimes.set(relPath, stat.mtimeMs);

                    const content = fs.readFileSync(filePath, 'utf-8');
                    const chunks = chunk(content, relPath, {
                        chunkSize: settings.chunkSize || 80,
                        chunkOverlap: settings.chunkOverlap || 20,
                        type: source.type,
                        classAware: settings.classAwareChunking !== false,
                    });

                    this.index.addChunks(chunks);
                    totalChunks += chunks.length;
                    totalFiles++;
                } catch (err) {
                    this._log(`  ⚠ Error reading ${filePath}: ${err.message}`);
                }
            }
        }

        // 2. Build BM25 index
        this.index.build();

        // 3. Build selector registry
        let totalSelectors = 0;
        const pageObjectsDir = path.resolve(this.projectRoot, this.config.indexSources?.find(s => s.type === 'pageObject')?.path || 'tests/pageobjects');
        totalSelectors += this.selectorRegistry.buildFromPageObjects(pageObjectsDir);

        const explorationDir = path.resolve(this.projectRoot, this.config.indexSources?.find(s => s.type === 'exploration')?.path || 'agentic-workflow/exploration-data');
        totalSelectors += this.selectorRegistry.buildFromExploration(explorationDir);

        if (this.learningStore) {
            totalSelectors += this.selectorRegistry.mergeWithLearningStore(this.learningStore);
        }

        // 4. Save state
        this._fileMtimes = newMtimes;
        this._lastBuildTime = new Date();
        this._initialized = true;

        // 5. Persist to disk
        this._saveIndex();

        const elapsed = Date.now() - startTime;
        this._log(`✅ Index built: ${totalChunks} chunks from ${totalFiles} files, ${totalSelectors} selectors (${elapsed}ms)`);

        return { chunks: totalChunks, selectors: totalSelectors, files: totalFiles, elapsed };
    }

    /**
     * Rebuild index incrementally — only re-index files that have changed
     * since the last build. Returns early if nothing changed.
     *
     * @returns {Object|null} Build stats if rebuilt, null if up-to-date
     */
    rebuildIfStale() {
        if (!this._initialized) {
            // Try loading from disk first
            if (this._loadIndex()) {
                // Check staleness
                const stale = this._findStaleFiles();
                if (stale.length === 0) {
                    this._log('Index loaded from disk — up-to-date');
                    return null;
                }
                this._log(`${stale.length} files changed — rebuilding...`);
                return this.buildIndex();
            }
            // No persisted index — fresh build
            return this.buildIndex();
        }

        const stale = this._findStaleFiles();
        if (stale.length === 0) {
            this._log('Index is up-to-date');
            return null;
        }

        this._log(`${stale.length} stale files detected — full rebuild`);
        return this.buildIndex();
    }

    /**
     * Ensure the index is initialized (load from disk or build).
     */
    ensureInitialized() {
        if (this._initialized) return;
        if (!this._loadIndex()) {
            this.buildIndex();
        }
    }

    // ─── Query Methods ──────────────────────────────────────────────

    /**
     * Search the grounding index with natural language or code query.
     *
     * @param {string} queryText - Search query (e.g., "search panel filter locators")
     * @param {Object} [options]
     * @param {number} [options.maxChunks] - Override max results
     * @param {string} [options.scope] - Filter by type: 'pageObject'|'businessFunction'|'utility'|'testData'|'exploration'|'all'
     * @param {number} [options.minScore] - Override min relevance score
     * @returns {Object[]} Array of { content, filePath, startLine, endLine, type, score, matchedTerms, metadata }
     */
    query(queryText, options = {}) {
        this.ensureInitialized();

        const retrievalSettings = this.config.retrievalSettings || {};
        const maxChunks = options.maxChunks || retrievalSettings.maxChunksPerQuery || 10;
        const minScore = options.minScore || retrievalSettings.minRelevanceScore || 0.12;
        const boostFactors = retrievalSettings.boostFactors || {};

        const searchOptions = {
            topK: maxChunks,
            minScore,
            boostFactors,
        };

        if (options.scope && options.scope !== 'all') {
            searchOptions.typeFilter = options.scope;
        }

        // Apply feature keyword boost if query matches a feature
        const featureBoost = this._getFeatureBoostTerms(queryText);
        if (featureBoost.length > 0) {
            searchOptions.boostTerms = featureBoost;
        }

        const results = this.index.search(queryText, searchOptions);

        return results.map(r => ({
            content: r.chunk.content,
            filePath: r.chunk.filePath,
            startLine: r.chunk.startLine,
            endLine: r.chunk.endLine,
            type: r.chunk.type,
            score: Math.round(r.score * 1000) / 1000,
            matchedTerms: r.matchedTerms,
            metadata: r.chunk.metadata,
        }));
    }

    /**
     * Agent-aware grounding query. Combines task description with
     * agent-specific boost terms for better retrieval.
     *
     * @param {string} agentName - 'scriptgenerator'|'testgenie'|'buggenie'|'codereviewer'
     * @param {string} taskDescription - What the agent is working on
     * @param {Object} [options] - Additional query options
     * @returns {Object[]} Ranked results
     */
    queryForAgent(agentName, taskDescription, options = {}) {
        this.ensureInitialized();

        const retrievalSettings = this.config.retrievalSettings || {};
        const agentBoosts = retrievalSettings.agentBoosts || {};
        const boostTerms = agentBoosts[agentName] || [];

        return this.query(taskDescription, {
            ...options,
            boostTerms,
        });
    }

    /**
     * Get feature-specific context from the feature map.
     * Returns structured knowledge about a feature: page objects, URLs,
     * business functions, and relevant grounding data.
     *
     * @param {string} featureName - Feature name or partial match
     * @returns {Object|null} Feature context or null if not found
     */
    getFeatureContext(featureName) {
        const features = this.config.featureMap || [];
        if (!featureName) {
            return { features: features.map(f => ({ name: f.name, description: f.description })) };
        }

        const nameLower = featureName.toLowerCase();
        const feature = features.find(f =>
            f.name.toLowerCase().includes(nameLower) ||
            (f.keywords || []).some(k => k.toLowerCase().includes(nameLower)) ||
            nameLower.split(/\s+/).some(w => f.name.toLowerCase().includes(w))
        );

        if (!feature) return null;

        // Enrich with grounding data
        const result = {
            name: feature.name,
            description: feature.description,
            pages: feature.pages || [],
            pageObjects: feature.pageObjects || [],
            businessFunctions: feature.businessFunctions || [],
            keywords: feature.keywords || [],
        };

        // Add relevant code chunks if index is built
        if (this._initialized && this.index) {
            result.relevantCode = this.query(
                `${feature.name} ${(feature.keywords || []).join(' ')}`,
                { maxChunks: 5 }
            );
        }

        // Add selectors for this feature's pages
        if (this.selectorRegistry && feature.pages?.length > 0) {
            result.selectors = {};
            for (const pageUrl of feature.pages) {
                result.selectors[pageUrl] = this.selectorRegistry.recommend(pageUrl).slice(0, 10);
            }
        }

        return result;
    }

    /**
     * Get selector recommendations for a specific page URL.
     *
     * @param {string} pageUrl - Full or partial page URL
     * @param {string} [elementHint] - Optional element description
     * @returns {Object[]} Ranked selector recommendations
     */
    getSelectorRecommendations(pageUrl, elementHint) {
        this.ensureInitialized();
        if (!this.selectorRegistry) return [];
        return this.selectorRegistry.recommend(pageUrl, elementHint);
    }

    /**
     * Get domain context — terminology, custom rules, project info.
     * This is always included in agent context (not query-dependent).
     *
     * @returns {Object} Domain context object
     */
    getDomainContext() {
        return {
            project: this.config.project || {},
            terminology: this.config.domainTerminology || {},
            rules: this.config.customGroundingRules || [],
        };
    }

    /**
     * Check exploration data freshness for a specific ticket.
     *
     * @param {string} ticketId - Jira ticket ID (e.g., 'AOTF-16337')
     * @returns {{ exists: boolean, fresh: boolean, ageDays: number|null, path: string|null, warning: string|null }}
     */
    getExplorationFreshness(ticketId) {
        const freshness = this.config.explorationFreshness || {};
        const maxAge = freshness.maxAgeDays || 14;
        const warnAge = freshness.warnAgeDays || 7;

        const explorationSource = (this.config.indexSources || []).find(s => s.type === 'exploration');
        const explorationDir = explorationSource
            ? path.resolve(this.projectRoot, explorationSource.path)
            : path.resolve(this.projectRoot, 'agentic-workflow', 'exploration-data');

        const fileName = `${ticketId}-exploration.json`;
        const filePath = path.join(explorationDir, fileName);

        if (!fs.existsSync(filePath)) {
            return { exists: false, fresh: false, ageDays: null, path: null, warning: 'No exploration data found. MCP exploration required.' };
        }

        try {
            const stat = fs.statSync(filePath);
            const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
            const isDangerous = ageDays > maxAge;
            const isWarning = ageDays > warnAge;

            return {
                exists: true,
                fresh: !isDangerous,
                ageDays: Math.round(ageDays * 10) / 10,
                path: path.relative(this.projectRoot, filePath),
                warning: isDangerous
                    ? `Exploration data is ${Math.round(ageDays)} days old (max: ${maxAge}). Re-exploration recommended.`
                    : isWarning
                        ? `Exploration data is ${Math.round(ageDays)} days old. Consider refreshing.`
                        : null,
            };
        } catch {
            return { exists: false, fresh: false, ageDays: null, path: null, warning: 'Error reading exploration data.' };
        }
    }

    /**
     * Build a formatted grounding context string for agent system messages.
     * Used by agent-sessions.js buildDynamicContext().
     *
     * @param {string} agentName - Target agent
     * @param {Object} [options]
     * @param {string} [options.taskDescription] - Task for query-based grounding
     * @param {string} [options.ticketId] - Ticket for exploration freshness
     * @param {boolean} [options.summary=false] - Compact mode (fewer chunks, domain only)
     * @returns {string} Formatted context string for prompt injection
     */
    buildGroundingContext(agentName, options = {}) {
        this.ensureInitialized();

        const sections = [];

        // 1. Domain context (always included)
        const domain = this.getDomainContext();
        if (domain.project?.applicationName) {
            sections.push(`Application: ${domain.project.applicationName}`);
            if (domain.project.applicationDescription) {
                sections.push(`Description: ${domain.project.applicationDescription}`);
            }
            if (domain.project.authNotes) {
                sections.push(`Auth: ${domain.project.authNotes}`);
            }
        }

        // 2. Custom grounding rules (always included, high priority)
        if (domain.rules?.length > 0) {
            sections.push('');
            sections.push('CRITICAL RULES:');
            for (const rule of domain.rules) {
                sections.push(`• ${rule}`);
            }
        }

        // 3. Domain terminology (always included)
        if (Object.keys(domain.terminology).length > 0) {
            sections.push('');
            sections.push('TERMINOLOGY:');
            for (const [term, def] of Object.entries(domain.terminology)) {
                sections.push(`  ${term}: ${def}`);
            }
        }

        // 4. Task-relevant code chunks (query-dependent)
        if (options.taskDescription && !options.summary) {
            const results = this.queryForAgent(agentName, options.taskDescription, {
                maxChunks: options.summary ? 3 : 8,
            });

            if (results.length > 0) {
                sections.push('');
                sections.push('RELEVANT CODE CONTEXT:');
                for (const r of results) {
                    sections.push(`--- ${r.filePath} (L${r.startLine}-${r.endLine}) [${r.type}] score:${r.score} ---`);
                    // Truncate large chunks for context window management
                    const content = r.content.length > 800 ? r.content.slice(0, 800) + '\n...(truncated)' : r.content;
                    sections.push(content);
                }
            }
        }

        // 5. Exploration freshness (if ticketId provided)
        if (options.ticketId) {
            const freshness = this.getExplorationFreshness(options.ticketId);
            if (freshness.warning) {
                sections.push('');
                sections.push(`⚠ EXPLORATION: ${freshness.warning}`);
            }
        }

        // 6. Feature context (if task mentions a known feature)
        if (options.taskDescription) {
            const features = this.config.featureMap || [];
            const taskLower = options.taskDescription.toLowerCase();
            const matchedFeatures = features.filter(f =>
                (f.keywords || []).some(k => taskLower.includes(k.toLowerCase())) ||
                taskLower.includes(f.name.toLowerCase())
            );

            if (matchedFeatures.length > 0 && !options.summary) {
                sections.push('');
                sections.push('MATCHED FEATURES:');
                for (const f of matchedFeatures.slice(0, 3)) {
                    sections.push(`  ${f.name}: ${f.description || ''}`);
                    if (f.pageObjects?.length > 0) sections.push(`    Page Objects: ${f.pageObjects.join(', ')}`);
                    if (f.businessFunctions?.length > 0) sections.push(`    Business Functions: ${f.businessFunctions.join(', ')}`);
                    if (f.pages?.length > 0) sections.push(`    URLs: ${f.pages.join(', ')}`);
                }
            }
        }

        return sections.join('\n');
    }

    /**
     * Check existing test coverage for a feature or page.
     *
     * @param {Object} [options]
     * @param {string} [options.featureName] - Feature to check
     * @param {string} [options.pageUrl] - Page URL to check
     * @returns {Object} Coverage info: { existingSpecs, totalSpecs, coverage }
     */
    checkExistingCoverage(options = {}) {
        const specsDir = path.resolve(this.projectRoot, 'tests', 'specs');
        if (!fs.existsSync(specsDir)) {
            return { existingSpecs: [], totalSpecs: 0, message: 'No specs directory found.' };
        }

        const allSpecs = this._collectFiles(specsDir, { fileExtensions: ['.spec.js'] });
        const specInfos = allSpecs.map(s => {
            const relPath = path.relative(specsDir, s);
            const content = this._readFileSafe(s);
            return {
                path: relPath,
                fullPath: s,
                folder: path.dirname(relPath),
                fileName: path.basename(s),
                describeName: (content.match(/test\.describe(?:\.serial)?\s*\(\s*['"`]([^'"`]+)['"`]/)?.[1]) || null,
            };
        });

        let filtered = specInfos;

        // Filter by feature keywords
        if (options.featureName) {
            const feature = (this.config.featureMap || []).find(f =>
                f.name.toLowerCase().includes(options.featureName.toLowerCase())
            );
            if (feature) {
                const keywords = [...(feature.keywords || []), feature.name].map(k => k.toLowerCase());
                filtered = specInfos.filter(s => {
                    const searchable = `${s.path} ${s.describeName || ''}`.toLowerCase();
                    return keywords.some(k => searchable.includes(k));
                });
            }
        }

        // Filter by page URL
        if (options.pageUrl) {
            const urlLower = options.pageUrl.toLowerCase();
            filtered = filtered.filter(s => {
                const content = this._readFileSafe(s.fullPath).toLowerCase();
                return content.includes(urlLower);
            });
        }

        return {
            existingSpecs: filtered.map(s => ({ path: s.path, describe: s.describeName })),
            totalSpecs: allSpecs.length,
            message: filtered.length === 0
                ? 'No existing spec files found for this feature/page.'
                : `Found ${filtered.length} existing spec file(s).`,
        };
    }

    /**
     * Get full grounding statistics.
     */
    getStats() {
        return {
            initialized: this._initialized,
            lastBuildTime: this._lastBuildTime?.toISOString() || null,
            projectId: this.config.project?.id || 'unknown',
            projectName: this.config.project?.applicationName || 'unknown',
            index: this.index?.getStats() || null,
            selectors: this.selectorRegistry?.getStats() || null,
            features: (this.config.featureMap || []).length,
            terminologyEntries: Object.keys(this.config.domainTerminology || {}).length,
            customRules: (this.config.customGroundingRules || []).length,
            trackedFiles: this._fileMtimes.size,
        };
    }

    // ─── Private Helpers ────────────────────────────────────────────

    _loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (err) {
            this._log(`⚠ Error loading grounding config: ${err.message}`);
        }

        // Return minimal default config
        return {
            version: '1.0.0',
            project: { id: 'default', applicationName: 'Unknown' },
            featureMap: [],
            domainTerminology: {},
            customGroundingRules: [],
            indexSources: [],
            indexSettings: {},
            retrievalSettings: {},
            selectorRegistry: {},
            explorationFreshness: {},
        };
    }

    _saveIndex() {
        try {
            if (!fs.existsSync(this.indexDir)) {
                fs.mkdirSync(this.indexDir, { recursive: true });
            }

            // Save BM25 index
            if (this.index) {
                const indexPath = path.join(this.indexDir, INDEX_FILE);
                fs.writeFileSync(indexPath, JSON.stringify(this.index.toJSON(), null, 2), 'utf-8');
            }

            // Save selector registry
            if (this.selectorRegistry) {
                const regPath = path.join(this.indexDir, SELECTOR_FILE);
                fs.writeFileSync(regPath, JSON.stringify(this.selectorRegistry.toJSON(), null, 2), 'utf-8');
            }

            // Save file mtimes
            const mtimePath = path.join(this.indexDir, MTIME_FILE);
            const mtimeObj = {};
            for (const [k, v] of this._fileMtimes) {
                mtimeObj[k] = v;
            }
            fs.writeFileSync(mtimePath, JSON.stringify(mtimeObj, null, 2), 'utf-8');

            this._log(`Index persisted to ${this.indexDir}`);
        } catch (err) {
            this._log(`⚠ Error saving index: ${err.message}`);
        }
    }

    _loadIndex() {
        try {
            const indexPath = path.join(this.indexDir, INDEX_FILE);
            const regPath = path.join(this.indexDir, SELECTOR_FILE);
            const mtimePath = path.join(this.indexDir, MTIME_FILE);

            if (!fs.existsSync(indexPath)) return false;

            // Load BM25 index
            const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            this.index = BM25Index.fromJSON(indexJson);

            // Load selector registry
            if (fs.existsSync(regPath)) {
                const regJson = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
                this.selectorRegistry = SelectorRegistry.fromJSON(regJson, this.config.selectorRegistry || {});
            } else {
                this.selectorRegistry = new SelectorRegistry(this.config.selectorRegistry || {});
            }

            // Load file mtimes
            if (fs.existsSync(mtimePath)) {
                const mtimeObj = JSON.parse(fs.readFileSync(mtimePath, 'utf-8'));
                this._fileMtimes = new Map(Object.entries(mtimeObj));
            }

            this._initialized = true;
            this._lastBuildTime = new Date(indexJson.buildTimestamp || Date.now());

            this._log(`Index loaded from disk: ${this.index.getStats().totalChunks} chunks`);
            return true;
        } catch (err) {
            this._log(`⚠ Error loading index: ${err.message}`);
            return false;
        }
    }

    _findStaleFiles() {
        const stale = [];
        const sources = this.config.indexSources || [];
        const settings = this.config.indexSettings || {};

        for (const source of sources) {
            const absPath = path.resolve(this.projectRoot, source.path);
            if (!fs.existsSync(absPath)) continue;

            const files = this._collectFiles(absPath, settings);
            for (const filePath of files) {
                try {
                    const relPath = path.relative(this.projectRoot, filePath);
                    const stat = fs.statSync(filePath);
                    const cachedMtime = this._fileMtimes.get(relPath);

                    if (!cachedMtime || stat.mtimeMs > cachedMtime) {
                        stale.push(relPath);
                    }
                } catch {
                    // File may have been deleted
                    stale.push(path.relative(this.projectRoot, filePath));
                }
            }
        }

        return stale;
    }

    _collectFiles(dir, settings = {}) {
        const extensions = settings.fileExtensions || ['.js', '.json'];
        const excludes = settings.excludePatterns || ['node_modules', 'package-lock'];
        const results = [];

        const walk = (d) => {
            try {
                const entries = fs.readdirSync(d, { withFileTypes: true });
                for (const entry of entries) {
                    const name = entry.name;
                    if (excludes.some(ex => name.includes(ex))) continue;

                    const fullPath = path.join(d, name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    } else if (entry.isFile() && extensions.some(ext => name.endsWith(ext))) {
                        results.push(fullPath);
                    }
                }
            } catch {
                // Skip inaccessible directories
            }
        };

        walk(dir);
        return results;
    }

    _getFeatureBoostTerms(queryText) {
        const features = this.config.featureMap || [];
        const queryLower = queryText.toLowerCase();
        const boostTerms = [];

        for (const feature of features) {
            const matched = (feature.keywords || []).some(k => queryLower.includes(k.toLowerCase()));
            if (matched || queryLower.includes(feature.name.toLowerCase())) {
                // Add page object names and business function names as boost terms
                boostTerms.push(...(feature.pageObjects || []).map(p => p.replace('.js', '')));
                boostTerms.push(...(feature.businessFunctions || []).map(b => b.replace('.js', '')));
            }
        }

        return boostTerms;
    }

    _readFileSafe(filePath) {
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return '';
        }
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[GroundingStore] ${message}`);
        }
    }
}

// ─── Singleton Manager ──────────────────────────────────────────────────────

let _instance = null;

/**
 * Get or create the singleton GroundingStore instance.
 *
 * @param {Object} [options] - Options passed to constructor on first call
 * @returns {GroundingStore}
 */
function getGroundingStore(options) {
    if (!_instance) {
        _instance = new GroundingStore(options);
    }
    return _instance;
}

/**
 * Reset the singleton (for testing or config changes).
 */
function resetGroundingStore() {
    _instance = null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    GroundingStore,
    getGroundingStore,
    resetGroundingStore,
};
