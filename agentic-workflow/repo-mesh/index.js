/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPO MESH — Federated Contract Mesh Orchestrator (public API)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Single entry point that wires the mesh together:
 *
 *   RepoSyncManager ──changed files──▶ ContractDNA ──contracts──▶ FullStackGraph
 *        (repo delta)                  (semantic delta)            (UI→API→Kafka→ES)
 *
 * Two-layer incremental design:
 *   • Repo delta   — unchanged HEAD SHA ⇒ repo skipped entirely (zero work).
 *   • Contract delta — a changed repo is recompiled, but the graph/index only
 *     update when the service's SEMANTIC hash actually flips.
 *
 * Used by: scripts/repo-mesh-setup.js (CLI), repo-mesh-provider.js (grounding),
 * scheduler.js (polling), and the git webhook handler.
 *
 * @module repo-mesh
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const { RepoSyncManager } = require('./repo-sync-manager');
const { ContractDNA } = require('./contract-dna');
const { FullStackGraph } = require('./full-stack-graph');
const { RuleDNA } = require('./rule-dna');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config', 'grounding-config.json');

function resolveFromRoot(p) {
    return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

class RepoMesh {
    /**
     * @param {Object} [options]
     * @param {Object} [options.config]       repoMesh config (else loaded from grounding-config.json)
     * @param {Object[]} [options.featureMap] grounding featureMap (for feature→service edges)
     * @param {boolean} [options.verbose]
     */
    constructor(options = {}) {
        const { repoMesh, featureMap } = this._loadConfig(options.config);
        this.config = repoMesh;
        this.featureMap = options.featureMap || featureMap || [];
        this.verbose = options.verbose || this.config.verbose || false;

        const src = this.config.source || {};
        const dnaCfg = this.config.dna || {};
        const graphCfg = this.config.graph || {};

        this.cloneDir = process.env.REPO_MESH_CLONE_DIR
            ? path.resolve(process.env.REPO_MESH_CLONE_DIR)
            : resolveFromRoot(src.cloneDir || 'repo-mesh-data/repos');

        this.sync = new RepoSyncManager({
            org: this.config.source?.org || process.env.GITHUB_ORG,
            query: this.config.source?.query,
            branch: this.config.source?.defaultBranch,
            fetchMethod: this.config.source?.fetchMethod,
            include: this.config.source?.include,
            exclude: this.config.source?.exclude,
            repos: this.config.repos,
            cloneDir: this.cloneDir,
            statePath: resolveFromRoot(dnaCfg.statePath || 'repo-mesh-data/sync-state.json'),
            concurrency: this.config.sync?.concurrency,
            verbose: this.verbose,
        });

        this.dna = new ContractDNA({
            persistPath: resolveFromRoot(dnaCfg.persistPath || 'repo-mesh-data/contract-dna.json'),
            l2MaxChars: dnaCfg.l2CardMaxChars,
            l1MaxChars: dnaCfg.l1MaxChars,
            verbose: this.verbose,
        });

        this.graph = new FullStackGraph({
            persistPath: resolveFromRoot(graphCfg.persistPath || 'repo-mesh-data/full-stack-graph.json'),
            verbose: this.verbose,
        });

        this._seedPath = resolveFromRoot(graphCfg.seedPath || 'repo-mesh/data-flow-seed.json');
        this._frontendDir = resolveFromRoot('repo-mesh-data/frontend');
        this._featureCatalogPath = graphCfg.featureCatalogPath
            ? resolveFromRoot(graphCfg.featureCatalogPath)
            : null;
        const ruleCfg = this.config.businessRules || {};
        this.ruleDNA = new RuleDNA({
            persistPath: resolveFromRoot(ruleCfg.persistPath || 'repo-mesh-data/rule-dna.json'),
            frontendRoot: this._frontendDir,
            maxFilesPerFeature: ruleCfg.maxFilesPerFeature,
        });
        this._uiCache = undefined;
        this._initialized = false;
    }

    _loadConfig(injected) {
        if (injected) return { repoMesh: injected, featureMap: [] };
        try {
            const cfg = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
            return { repoMesh: cfg.repoMesh || {}, featureMap: cfg.featureMap || [] };
        } catch {
            return { repoMesh: {}, featureMap: [] };
        }
    }

    get enabled() {
        return this.config.enabled === true || process.env.REPO_MESH_ENABLED === 'true';
    }

    _seed() {
        try {
            return JSON.parse(fs.readFileSync(this._seedPath, 'utf-8'));
        } catch {
            return { services: {}, featureToDomain: {} };
        }
    }

    /** Analyze cloned frontend repos for UI→API call sites (cached per process). */
    _uiAnalysis() {
        if (this._uiCache !== undefined) return this._uiCache;
        try {
            const { analyzeFrontend } = require('./frontend-analyzer');
            this._uiCache = analyzeFrontend(this._frontendDir);
        } catch (err) {
            this._log?.(`frontend analysis skipped: ${err.message}`);
            this._uiCache = null;
        }
        return this._uiCache;
    }

    /** Load retrieval-only product vocabulary and retain only sources present locally. */
    _featureCatalog() {
        if (!this._featureCatalogPath) return null;
        try {
            const catalog = JSON.parse(fs.readFileSync(this._featureCatalogPath, 'utf-8'));
            return {
                ...catalog,
                features: (catalog.features || []).map((feature) => ({
                    ...feature,
                    sources: (feature.sources || []).filter((source) =>
                        fs.existsSync(path.join(this._frontendDir, source))),
                })),
            };
        } catch (error) {
            this._log?.(`feature catalog skipped: ${error.message}`);
            return null;
        }
    }

    // ─── Lifecycle ──────────────────────────────────────────────────

    /** Load persisted DNA + graph; build a seed-only graph if none exists yet. Reloads when the files change on disk. */
    initialize() {
        if (this._initialized) {
            const stamp = this._persistStamp();
            // State built in-process (rebuild, tests) is current until the files change afterwards.
            if (this._loadedStamp === undefined) this._loadedStamp = stamp;
            if (stamp === this._loadedStamp) return this;
            this._uiCache = undefined;
            this.ruleDNA._repoHeads?.clear();
            this.loadVersion = (this.loadVersion || 0) + 1;
        }
        this.dna.load();
        this.ruleDNA.load();
        if (!this.graph.load() || this.graph.stats().nodes === 0) {
            this.graph.build({
                seed: this._seed(),
                featureMap: this.featureMap,
                contractDNA: this.dna,
                uiAnalysis: this._uiAnalysis(),
                featureCatalog: this._featureCatalog(),
            });
        }
        this._loadedStamp = this._persistStamp();
        this._initialized = true;
        return this;
    }

    _persistStamp() {
        return [this.dna.persistPath, this.graph.persistPath, this.ruleDNA.persistPath, this._featureCatalogPath]
            .map((file) => {
                try {
                    return file ? fs.statSync(file).mtimeMs : 0;
                } catch {
                    return 0;
                }
            })
            .join(':');
    }

    // ─── Sync + compile (the delta pipeline) ────────────────────────

    /**
     * Full sync: discover → repo-delta → recompile changed services → rebuild graph.
     * @param {Object} [options]
     * @param {boolean} [options.force]
     * @param {Function} [options.onProgress]
     * @returns {Promise<Object>} summary
     */
    async syncAll(options = {}) {
        this.dna.load();
        const result = await this.sync.syncAll({
            force: options.force,
            onProgress: options.onProgress,
        });

        const changedServices = [];
        for (const repoResult of result.repos) {
            if (repoResult.status === 'unchanged' || repoResult.status === 'failed') continue;
            const changed = this._recompileRepo(repoResult.repo);
            if (changed) changedServices.push(repoResult.repo);
        }

        this._rebuildGraph();
        this.dna.save();
        this.graph.save();

        return {
            ...result,
            changedServices,
            contractsChanged: changedServices.length,
            dnaStats: this.dna.stats(),
            graphStats: this.graph.stats(),
        };
    }

    /**
     * Apply a targeted delta for specific changed files (webhook path).
     * @param {string} repoName
     * @param {string[]} [changedFiles] (informational; the whole service is recompiled)
     * @returns {{changed:boolean, hash:string}}
     */
    applyDelta(repoName, changedFiles = []) {
        this.dna.load();
        const changed = this._recompileRepo(repoName, changedFiles);
        if (changed) {
            this._rebuildGraph();
            this.dna.save();
            this.graph.save();
        }
        return { changed, hash: this.dna.getServiceHash(repoName) };
    }

    /**
     * Sync a single repo end-to-end: fetch latest → repo-delta → recompile →
     * graph update. Used by the CLI (--repo) and the git webhook handler.
     * @param {string} repoName
     * @param {Object} [options]
     * @returns {Promise<Object>} per-repo result + contractChanged flag
     */
    async syncOne(repoName, options = {}) {
        this.dna.load();
        const repo = this.sync._normalizeRepo({ name: repoName });
        const res = await this.sync.syncRepo(repo, { force: options.force });
        this.sync._saveState();
        let contractChanged = false;
        if (res.status !== 'unchanged') contractChanged = this._recompileRepo(repoName, res.changedFiles);
        if (contractChanged) {
            this._rebuildGraph();
            this.dna.save();
            this.graph.save();
        }
        return { ...res, contractChanged, hash: this.dna.getServiceHash(repoName) };
    }

    /** Rebuild DNA + graph from whatever repos already exist on disk (no network). */
    rebuildFromDisk() {
        this.dna = new ContractDNA({ persistPath: this.dna.persistPath, verbose: this.verbose });
        this._uiCache = undefined; // re-analyze frontend on a full rebuild
        let count = 0;
        if (fs.existsSync(this.cloneDir)) {
            for (const entry of fs.readdirSync(this.cloneDir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    this._recompileRepo(entry.name);
                    count++;
                }
            }
        }
        this._rebuildGraph({ rebuildRules: true });
        this.dna.save();
        this.graph.save();
        return { repos: count, dnaStats: this.dna.stats(), graphStats: this.graph.stats() };
    }

    /** Recompile one repo's service from its on-disk files. Returns whether the contract changed. */
    _recompileRepo(repoName, changedFiles) {
        const rels = this.sync.listMatchingFiles(repoName);
        if (!rels.length) return false;
        const files = rels.map((relPath) => ({
            relPath,
            content: this._safeRead(this.sync.absPathFor(repoName, relPath)),
        })).filter((f) => f.content != null);
        const state = this.sync.getState().repos[repoName] || {};
        const res = this.dna.compileService(repoName, files, { repo: repoName, sha: state.lastSyncedSha });
        return res.changed;
    }

    _safeRead(p) {
        try {
            return fs.readFileSync(p, 'utf-8');
        } catch {
            return null;
        }
    }

    _rebuildGraph(options = {}) {
        this.graph = new FullStackGraph({ persistPath: this.graph.persistPath, verbose: this.verbose });
        const featureCatalog = this._featureCatalog();
        this.graph.build({
            seed: this._seed(),
            featureMap: this.featureMap,
            contractDNA: this.dna,
            uiAnalysis: this._uiAnalysis(),
            featureCatalog,
        });
        if (this.config.businessRules?.enabled !== false && options.rebuildRules) {
            this.ruleDNA.build({
                graph: this.graph,
                featureCatalog,
                catalogPath: this._featureCatalogPath
                    ? path.relative(path.resolve(__dirname, '..', '..'), this._featureCatalogPath).replace(/\\/g, '/')
                    : 'agentic-workflow/config/feature-catalog.json',
            });
        } else {
            this.ruleDNA.load();
        }
    }

    // ─── Query API (powers SDK tools + provider) ────────────────────

    /** Search service contracts by free text. Returns ranked L2 cards. */
    searchContracts(query, opts = {}) {
        this.initialize();
        const trace = this.graph.search(query, opts);
        const services = trace?.services || [];
        return {
            matched: trace?.matchedNode || null,
            services: services.map((s) => this.dna.getServiceL2(s) || { service: s, domain: this._domainOf(s), pending: true }),
            topics: { produced: trace?.topicsProduced || [], consumed: trace?.topicsConsumed || [] },
            indices: trace?.indices || [],
        };
    }

    _domainOf(serviceName) {
        const node = this.graph.nodes.get(`service:${serviceName}`);
        return node?.meta?.domain || 'unknown';
    }

    getServiceContract(serviceName, level = 'L2') {
        this.initialize();
        if (level === 'L1') return this.dna.getServiceL1(serviceName);
        if (level === 'L3') return this.dna.getL3();
        return this.dna.getServiceL2(serviceName);
    }

    /** Full-stack trace for a UI feature OR free-text query. */
    traceFullStack(featureOrQuery, opts = {}) {
        this.initialize();
        return this.graph.traceFeature(featureOrQuery, opts) || this.graph.search(featureOrQuery, opts);
    }

    getFeatureRules(feature, options = {}) {
        this.initialize();
        const canonical = this.graph.traceFeature(feature)?.feature || feature;
        return this.ruleDNA.getRules(canonical, options);
    }

    getFeatureRuleStats(feature) {
        this.initialize();
        const canonical = this.graph.traceFeature(feature)?.feature || feature;
        return this.ruleDNA.getFeatureStats(canonical);
    }

    getRuleEvidence(ruleId, options = {}) {
        this.initialize();
        return this.ruleDNA.getEvidence(ruleId, options);
    }

    compareFeatureObservations(feature, observations = []) {
        this.initialize();
        const canonical = this.graph.traceFeature(feature)?.feature || feature;
        return this.ruleDNA.compareObservations(canonical, observations);
    }

    /** Which services touch a topic + candidate payload models. */
    getEventSchema(topic) {
        this.initialize();
        const producers = [];
        const consumers = [];
        for (const svc of this.dna.listServices()) {
            const l1 = this.dna.getServiceL1(svc);
            if (l1?.topics?.produces?.includes(topic)) producers.push(svc);
            if (l1?.topics?.consumes?.includes(topic)) consumers.push(svc);
        }
        const payloadModels = [...producers, ...consumers].flatMap((svc) =>
            (this.dna.getServiceL1(svc)?.models || []).map((m) => ({ service: svc, ...m })));
        return { topic, producers, consumers, payloadModels: dedupeBy(payloadModels, (m) => m.name) };
    }

    /** Which services write an index + the document field mapping. */
    getIndexMapping(index) {
        this.initialize();
        const writers = [];
        let fields = [];
        for (const svc of this.dna.listServices()) {
            const l1 = this.dna.getServiceL1(svc);
            if (l1?.indices?.includes(index)) {
                writers.push(svc);
                const esModel = (l1.models || []).find((m) => m.kind === 'es-document');
                if (esModel?.fields?.length) fields = esModel.fields;
            }
        }
        return { index, writers, fields };
    }

    /**
     * Build a compact grounding context block for a task — graph-routed +
     * L2-rendered, capped to maxContentChars to prevent bloat.
     */
    buildContext(query, opts = {}) {
        this.initialize();
        const maxChars = opts.maxChars || this.config.retrieval?.maxContentChars || 4000;
        const maxServices = opts.maxServices || this.config.retrieval?.maxServices || 4;
        const trace = this.traceFullStack(query, { maxServices });
        if (!trace || !trace.services?.length) return '';

        const lines = ['FULL-STACK CONTRACTS (relevant backend services):'];
        if (trace.feature || trace.matchedNode) {
            lines.push(`Matched: ${trace.feature || trace.matchedNode}`);
        }
        for (const svc of trace.services.slice(0, maxServices)) {
            const card = this.dna.render(svc, this.config.retrieval?.defaultResolution || 'L2');
            if (card) lines.push('', card);
        }
        if (trace.topicsProduced?.length || trace.topicsConsumed?.length) {
            lines.push('', `Kafka — produces: [${trace.topicsProduced.join(', ')}] consumes: [${trace.topicsConsumed.join(', ')}]`);
        }
        if (trace.indices?.length) lines.push(`Elastic indices: [${trace.indices.join(', ')}]`);
        lines.push('', 'Use these REAL topic/index/endpoint names for full-stack assertions. Do NOT invent names.');
        return lines.join('\n').slice(0, maxChars);
    }

    stats() {
        this.initialize();
        return {
            enabled: this.enabled,
            sync: this.sync.getState(),
            dna: this.dna.stats(),
            graph: this.graph.stats(),
            featureCoverage: this.graph.featureCoverageStats(),
            businessRules: this.ruleDNA.stats(),
        };
    }
}

function dedupeBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter((x) => {
        const k = keyFn(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// Singleton for shared use across tools/provider.
let _instance = null;
function getRepoMesh(options) {
    if (!_instance) _instance = new RepoMesh(options);
    return _instance;
}
function resetRepoMesh() {
    _instance = null;
}

module.exports = { RepoMesh, getRepoMesh, resetRepoMesh };
