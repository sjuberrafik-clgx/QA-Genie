/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FULL-STACK GRAPH — UI → API → Kafka → Elastic Knowledge Graph + Navigator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Turns the architecture spreadsheet + extracted contracts into a typed graph that
 * links every layer of the stack:
 *
 *   feature ──exercises──▶ service ──exposes──▶ endpoint
 *                            │  └──produces──▶ topic ──flows-to──▶ index
 *                            └──consumes──▶ topic        ▲
 *                            └──writes────────────────────┘
 *
 * The navigator answers the question that makes full-stack assertions possible:
 *   "Given UI feature X, which services / topics / indices does a test touch?"
 *   → the BLAST RADIUS.
 *
 * This is also the context router: instead of loading all 100 repos, the navigator
 * returns the 1–4 services relevant to a task, which the provider then renders at
 * L2/L1 — two-layer bloat control (relevance + compression).
 *
 * @module repo-mesh/full-stack-graph
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const NODE = {
    FEATURE: 'feature', PAGE: 'page', SERVICE: 'service', ENDPOINT: 'endpoint',
    TOPIC: 'topic', INDEX: 'index', MODEL: 'model', DOMAIN: 'domain', UI_APP: 'ui-app',
};
const EDGE = {
    EXERCISES: 'exercises', CALLS: 'calls', EXPOSES: 'exposes', PRODUCES: 'produces',
    CONSUMES: 'consumes', WRITES: 'writes', FLOWS_TO: 'flows-to', BELONGS_TO: 'belongs-to',
    HAS_PAGE: 'has-page', DEFINES: 'defines', UI_CALLS: 'ui-calls',
};

const id = {
    feature: (n) => `feature:${n}`,
    page: (p) => `page:${p}`,
    service: (n) => `service:${n}`,
    endpoint: (s, e) => `endpoint:${s}:${e}`,
    topic: (n) => `topic:${n}`,
    index: (n) => `index:${n}`,
    model: (s, n) => `model:${s}:${n}`,
    domain: (n) => `domain:${n}`,
    uiApp: (n) => `ui-app:${n}`,
};

class FullStackGraph {
    constructor(options = {}) {
        const dataDir = path.resolve(__dirname, '..', 'repo-mesh-data');
        this.persistPath = options.persistPath
            ? path.resolve(options.persistPath)
            : path.join(dataDir, 'full-stack-graph.json');
        this.verbose = options.verbose || false;
        /** @type {Map<string, {id,type,label,meta}>} */
        this.nodes = new Map();
        /** @type {Array<{from,to,type,meta?}>} */
        this.edges = [];
        this._adj = new Map(); // id → Set(edgeIndex)
    }

    // ─── Mutation ───────────────────────────────────────────────────

    addNode(nodeId, type, label, meta = {}) {
        if (!this.nodes.has(nodeId)) {
            this.nodes.set(nodeId, { id: nodeId, type, label: label || nodeId, meta });
        } else if (Object.keys(meta).length) {
            Object.assign(this.nodes.get(nodeId).meta, meta);
        }
        return nodeId;
    }

    addEdge(from, to, type, meta = {}) {
        if (!from || !to) return;
        const exists = this.edges.some((e) => e.from === from && e.to === to && e.type === type);
        if (exists) return;
        const idx = this.edges.push({ from, to, type, meta }) - 1;
        this._index(from, idx);
        this._index(to, idx);
    }

    _index(nodeId, edgeIdx) {
        if (!this._adj.has(nodeId)) this._adj.set(nodeId, new Set());
        this._adj.get(nodeId).add(edgeIdx);
    }

    _reindex() {
        this._adj = new Map();
        this.edges.forEach((e, i) => {
            this._index(e.from, i);
            this._index(e.to, i);
        });
    }

    // ─── Build ──────────────────────────────────────────────────────

    /**
     * Build/refresh the graph from a ContractDNA store, a curated seed, and the
     * grounding feature map. Idempotent — safe to call repeatedly (deltas merge in).
     *
     * @param {Object} opts
     * @param {import('./contract-dna').ContractDNA} [opts.contractDNA]
     * @param {Object} [opts.seed]            data-flow-seed.json content
     * @param {Object[]} [opts.featureMap]    grounding-config featureMap
     * @param {Object} [opts.uiAnalysis]      frontend-analyzer output (UI→API)
     */
    build({ contractDNA, seed, featureMap, uiAnalysis, featureCatalog } = {}) {
        // 1) Seed services (authoritative architecture data — available pre-clone).
        if (seed?.services) {
            for (const [svc, info] of Object.entries(seed.services)) {
                this._addServiceSkeleton(svc, info.domain, { kafka: info.kafka, fromSeed: true });
                for (const ix of info.indices || []) {
                    this.addNode(id.index(ix), NODE.INDEX, ix);
                    this.addEdge(id.service(svc), id.index(ix), EDGE.WRITES, { source: 'seed' });
                }
            }
        }

        // 2) Live contract DNA (overrides/augments seed with real endpoints + topics).
        if (contractDNA) {
            for (const svc of contractDNA.listServices()) {
                const l1 = contractDNA.getServiceL1(svc);
                if (l1) this._addServiceFromContract(l1);
            }
        }

        // 3) Feature → domain → service edges + pages.
        this._linkFeatures(seed, featureMap);

        // 4) UI → API: tag services exercised by the frontend apps (GraphQL + REST).
        this._linkUi(uiAnalysis);

        // 5) Product vocabulary: merge curated aliases and cross-cutting evidence.
        this._linkCatalog(featureCatalog);

        this._reindex();
        return this.stats();
    }

    _linkUi(uiAnalysis) {
        if (!uiAnalysis?.apps) return;
        const byDomain = this._servicesByDomain();
        for (const [app, data] of Object.entries(uiAnalysis.apps)) {
            const appId = id.uiApp(app);
            this.addNode(appId, NODE.UI_APP, app, {
                operations: (data.operations || []).length,
                restCalls: (data.restCalls || []).length,
            });
            for (const [domain, labels] of Object.entries(data.domainList || {})) {
                const dId = id.domain(domain);
                if (this.nodes.has(dId)) this.addEdge(appId, dId, EDGE.UI_CALLS, { operations: labels.slice(0, 15) });
                for (const svc of byDomain.get(domain) || []) {
                    const node = this.nodes.get(id.service(svc));
                    if (node) {
                        node.meta.uiApps = [...new Set([...(node.meta.uiApps || []), app])];
                        node.meta.uiOperations = [...new Set([...(node.meta.uiOperations || []), ...labels])].slice(0, 30);
                    }
                    this.addEdge(appId, id.service(svc), EDGE.UI_CALLS);
                }
            }
        }

        for (const [slug, data] of Object.entries(uiAnalysis.features || {})) {
            const featureName = data.name || slug;
            const featureId = id.feature(featureName);
            const operations = (data.operations || []).map((operation) => operation.name).filter(Boolean);
            const restCalls = (data.restCalls || []).map((call) => `${call.method} ${call.pathHint}`);
            const uiOperations = [...new Set([...operations, ...restCalls])].slice(0, 30);
            const sources = [...new Set(data.sources || [])].slice(0, 40);
            this.addNode(featureId, NODE.FEATURE, featureName, {
                aliases: [slug],
                evidenceSource: 'frontend-analysis',
                repositories: (data.repositories || []).slice(0, 8),
                uiApps: (data.apps || []).slice(0, 8),
                uiOperations,
                sources,
            });

            for (const app of data.apps || []) {
                const appId = id.uiApp(app);
                this.addNode(appId, NODE.UI_APP, app);
            }

            for (const [domain, labels] of Object.entries(data.domainList || {})) {
                for (const service of byDomain.get(domain) || []) {
                    this.addEdge(featureId, id.service(service), EDGE.EXERCISES, {
                        viaDomain: domain,
                        source: 'frontend-analysis',
                        confidence: 'derived',
                        operations: labels.slice(0, 15),
                    });
                }
            }
        }
    }

    _linkCatalog(featureCatalog) {
        const entries = Array.isArray(featureCatalog) ? featureCatalog : featureCatalog?.features;
        if (!Array.isArray(entries)) return;
        const servicesByDomain = this._servicesByDomain();

        for (const entry of entries) {
            if (!entry?.name) continue;
            const featureId = id.feature(entry.name);
            this.addNode(featureId, NODE.FEATURE, entry.name);
            const node = this.nodes.get(featureId);
            node.meta.aliases = [...new Set([...(node.meta.aliases || []), ...(entry.aliases || [])])];
            node.meta.repositories = [...new Set([...(node.meta.repositories || []), ...(entry.repositories || [])])].slice(0, 8);
            node.meta.uiApps = [...new Set([...(node.meta.uiApps || []), ...(entry.applications || [])])].slice(0, 8);
            node.meta.uiOperations = [...new Set([...(node.meta.uiOperations || []), ...(entry.operations || [])])].slice(0, 30);
            node.meta.sources = [...new Set([...(entry.sources || []), ...(node.meta.sources || [])])].slice(0, 40);
            node.meta.domains = [...new Set([...(node.meta.domains || []), ...(entry.domains || [])])];
            node.meta.catalogStatus = entry.status || node.meta.catalogStatus || 'cataloged';
            if (entry.description) node.meta.description = entry.description;

            for (const domain of entry.domains || []) {
                for (const service of servicesByDomain.get(domain) || []) {
                    this.addEdge(featureId, id.service(service), EDGE.EXERCISES, {
                        viaDomain: domain,
                        source: 'feature-catalog',
                        confidence: entry.status === 'partial' ? 'partial' : 'curated',
                    });
                }
            }
        }
    }

    _addServiceSkeleton(svc, domain, meta = {}) {
        this.addNode(id.service(svc), NODE.SERVICE, svc, { domain, ...meta });
        if (domain) {
            this.addNode(id.domain(domain), NODE.DOMAIN, domain);
            this.addEdge(id.service(svc), id.domain(domain), EDGE.BELONGS_TO);
        }
    }

    _addServiceFromContract(l1) {
        const svc = l1.service;
        this._addServiceSkeleton(svc, l1.domain, { app: l1.applicationName, fromContract: true });
        const sId = id.service(svc);

        for (const e of l1.endpoints || []) {
            const sig = `${e.httpMethod} ${e.path}`;
            const eId = id.endpoint(svc, sig);
            this.addNode(eId, NODE.ENDPOINT, sig, { httpMethod: e.httpMethod, path: e.path, handler: e.method });
            this.addEdge(sId, eId, EDGE.EXPOSES);
        }
        for (const t of l1.topics?.produces || []) {
            this.addNode(id.topic(t), NODE.TOPIC, t);
            this.addEdge(sId, id.topic(t), EDGE.PRODUCES);
        }
        for (const t of l1.topics?.consumes || []) {
            this.addNode(id.topic(t), NODE.TOPIC, t);
            this.addEdge(sId, id.topic(t), EDGE.CONSUMES);
        }
        for (const ix of l1.indices || []) {
            this.addNode(id.index(ix), NODE.INDEX, ix);
            this.addEdge(sId, id.index(ix), EDGE.WRITES, { source: 'contract' });
        }
        for (const m of l1.models || []) {
            if (!m.name) continue;
            this.addNode(id.model(svc, m.name), NODE.MODEL, m.name, { kind: m.kind, fields: (m.fields || []).map((f) => f.name) });
            this.addEdge(sId, id.model(svc, m.name), EDGE.DEFINES);
        }
        // Heuristic data-flow: topics consumed by a service that also writes indices
        // most likely flow into those indices (the ingest/sink pattern).
        for (const t of l1.topics?.consumes || []) {
            for (const ix of l1.indices || []) {
                this.addEdge(id.topic(t), id.index(ix), EDGE.FLOWS_TO, { via: svc, confidence: 'heuristic' });
            }
        }
    }

    _linkFeatures(seed, featureMap) {
        const featureToDomain = seed?.featureToDomain || {};
        const servicesByDomain = this._servicesByDomain();

        for (const [feature, domains] of Object.entries(featureToDomain)) {
            const fId = id.feature(feature);
            this.addNode(fId, NODE.FEATURE, feature);
            for (const d of domains) {
                for (const svc of servicesByDomain.get(d) || []) {
                    this.addEdge(fId, id.service(svc), EDGE.EXERCISES, { viaDomain: d });
                }
            }
        }

        // Pages from grounding feature map.
        for (const f of featureMap || []) {
            const fId = id.feature(f.name);
            this.addNode(fId, NODE.FEATURE, f.name);
            for (const p of f.pages || []) {
                this.addNode(id.page(p), NODE.PAGE, p);
                this.addEdge(fId, id.page(p), EDGE.HAS_PAGE);
            }
        }
    }

    _servicesByDomain() {
        const map = new Map();
        for (const node of this.nodes.values()) {
            if (node.type !== NODE.SERVICE) continue;
            const d = node.meta?.domain;
            if (!d) continue;
            if (!map.has(d)) map.set(d, []);
            map.get(d).push(node.label);
        }
        return map;
    }

    // ─── Navigation ─────────────────────────────────────────────────

    /**
     * Blast radius: everything reachable (forward) from a start node, collapsed
     * into the QA-relevant slice — services, topics, indices, endpoints, models.
     *
     * @param {string} startId
     * @param {Object} [opts]
     * @param {number} [opts.maxServices=6]
     * @param {number} [opts.maxDepth=4]
     * @returns {{services,topicsProduced,topicsConsumed,indices,endpoints,models,features}}
     */
    blastRadius(startId, opts = {}) {
        const maxDepth = opts.maxDepth || 4;
        const visited = new Set();
        const queue = [[startId, 0]];
        const out = {
            services: new Set(), topicsProduced: new Set(), topicsConsumed: new Set(),
            indices: new Set(), endpoints: [], models: new Set(), features: new Set(),
            uiApps: new Set(), uiOperations: new Set(), featureSources: new Set(),
            featureRepositories: new Set(), featureDomains: new Set(), featureCatalogStatuses: new Set(),
        };

        while (queue.length) {
            const [nodeId, depth] = queue.shift();
            if (visited.has(nodeId) || depth > maxDepth) continue;
            visited.add(nodeId);
            const node = this.nodes.get(nodeId);
            if (!node) continue;

            if (node.type === NODE.SERVICE) {
                out.services.add(node.label);
                (node.meta?.uiApps || []).forEach((a) => out.uiApps.add(a));
                (node.meta?.uiOperations || []).forEach((o) => out.uiOperations.add(o));
            }
            if (node.type === NODE.INDEX) out.indices.add(node.label);
            if (node.type === NODE.MODEL) out.models.add(node.label);
            if (node.type === NODE.FEATURE) {
                out.features.add(node.label);
                (node.meta?.uiApps || []).forEach((app) => out.uiApps.add(app));
                (node.meta?.uiOperations || []).forEach((operation) => out.uiOperations.add(operation));
                (node.meta?.sources || []).forEach((source) => out.featureSources.add(source));
                (node.meta?.repositories || []).forEach((repository) => out.featureRepositories.add(repository));
                (node.meta?.domains || []).forEach((domain) => out.featureDomains.add(domain));
                if (node.meta?.catalogStatus) out.featureCatalogStatuses.add(node.meta.catalogStatus);
            }
            if (node.type === NODE.ENDPOINT) out.endpoints.push({ service: node.id.split(':')[1], sig: node.label });

            for (const ei of this._adj.get(nodeId) || []) {
                const e = this.edges[ei];
                if (e.from !== nodeId) continue; // forward traversal only
                if (e.type === EDGE.PRODUCES) out.topicsProduced.add(this.nodes.get(e.to)?.label);
                if (e.type === EDGE.CONSUMES) out.topicsConsumed.add(this.nodes.get(e.to)?.label);
                queue.push([e.to, depth + 1]);
            }
        }

        const maxServices = opts.maxServices || 6;
        const allServices = [...out.services];
        const services = [];
        const selectedDomains = new Set();
        for (const service of allServices) {
            const domain = this.nodes.get(id.service(service))?.meta?.domain || 'unknown';
            if (!selectedDomains.has(domain)) {
                services.push(service);
                selectedDomains.add(domain);
            }
            if (services.length >= maxServices) break;
        }
        for (const service of allServices) {
            if (services.length >= maxServices) break;
            if (!services.includes(service)) services.push(service);
        }
        return {
            services,
            topicsProduced: [...out.topicsProduced].filter(Boolean).sort(),
            topicsConsumed: [...out.topicsConsumed].filter(Boolean).sort(),
            indices: [...out.indices].filter(Boolean).sort(),
            endpoints: out.endpoints.filter((e) => services.includes(e.service)),
            models: [...out.models].filter(Boolean).sort(),
            features: [...out.features].filter(Boolean),
            uiApps: [...out.uiApps].filter(Boolean).sort(),
            uiOperations: [...out.uiOperations].filter(Boolean).slice(0, 20),
            featureSources: [...out.featureSources].filter(Boolean).slice(0, 20),
            featureRepositories: [...out.featureRepositories].filter(Boolean).slice(0, 8),
            featureDomains: [...out.featureDomains].filter(Boolean).sort(),
            featureCatalogStatus: out.featureCatalogStatuses.has('partial')
                ? 'partial'
                : [...out.featureCatalogStatuses][0] || null,
        };
    }

    traceFeature(featureName, opts) {
        const node = this._resolveFeature(featureName);
        if (!node) return null;
        return { feature: this.nodes.get(node).label, ...this.blastRadius(node, opts) };
    }

    traceService(serviceName, opts) {
        const nodeId = id.service(serviceName);
        if (!this.nodes.has(nodeId)) return null;
        return { service: serviceName, ...this.blastRadius(nodeId, opts) };
    }

    /**
     * Free-text trace: match query terms to the best starting node(s)
     * (feature, service, domain, topic, index) and return their blast radius.
     */
    search(query, opts = {}) {
        const terms = String(query || '').toLowerCase().split(/[^a-z0-9_-]+/).filter((t) => t.length > 2);
        if (!terms.length) return null;
        let best = null;
        let bestScore = 0;
        for (const node of this.nodes.values()) {
            if (![NODE.FEATURE, NODE.SERVICE, NODE.DOMAIN, NODE.TOPIC, NODE.INDEX].includes(node.type)) continue;
            const hay = `${node.label} ${(node.meta?.aliases || []).join(' ')} ${node.meta?.domain || ''}`.toLowerCase();
            let matchedTerms = 0;
            for (const t of terms) {
                if (hay.includes(t)) matchedTerms++;
            }
            if (matchedTerms === 0) continue;
            const typeBonus = node.type === NODE.FEATURE ? 3 : node.type === NODE.DOMAIN ? 2 : 1;
            const exactBonus = node.label.toLowerCase() === String(query).trim().toLowerCase() ? 5 : 0;
            const score = (matchedTerms * 10) + typeBonus + exactBonus;
            if (score > bestScore) {
                bestScore = score;
                best = node.id;
            }
        }
        if (!best) return null;
        const startNode = this.nodes.get(best);
        return { matchedNode: startNode.label, matchedType: startNode.type, ...this.blastRadius(best, opts) };
    }

    _resolveFeature(featureName) {
        const exact = id.feature(featureName);
        if (this.nodes.has(exact)) return exact;
        const lower = featureName.toLowerCase();
        for (const node of this.nodes.values()) {
            if (node.type === NODE.FEATURE && node.label.toLowerCase() === lower) return node.id;
        }
        for (const node of this.nodes.values()) {
            if (node.type === NODE.FEATURE && (node.meta?.aliases || []).some((alias) => alias.toLowerCase() === lower)) return node.id;
        }
        for (const node of this.nodes.values()) {
            if (node.type === NODE.FEATURE && node.label.toLowerCase().includes(lower)) return node.id;
        }
        return null;
    }

    // ─── Persistence + stats ────────────────────────────────────────

    stats() {
        const byType = {};
        for (const n of this.nodes.values()) byType[n.type] = (byType[n.type] || 0) + 1;
        const edgeTypes = {};
        for (const e of this.edges) edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
        return { nodes: this.nodes.size, edges: this.edges.length, byType, edgeTypes };
    }

    featureCoverageStats() {
        const summary = {
            total: 0,
            cataloged: 0,
            catalogAliases: 0,
            groundedCatalog: 0,
            partialCatalog: 0,
            frontendAndBackend: 0,
            frontendOnly: 0,
            backendOnly: 0,
            metadataOnly: 0,
        };
        for (const node of this.nodes.values()) {
            if (node.type !== NODE.FEATURE) continue;
            summary.total++;
            const aliases = node.meta?.aliases || [];
            const hasFrontend = (node.meta?.sources || []).length > 0;
            const hasBackend = [...(this._adj.get(node.id) || [])]
                .map((edgeIndex) => this.edges[edgeIndex])
                .some((edge) => edge.from === node.id && edge.type === EDGE.EXERCISES);
            if (node.meta?.catalogStatus) {
                summary.cataloged++;
                summary.catalogAliases += aliases.length;
                if (node.meta.catalogStatus === 'partial') summary.partialCatalog++;
                else summary.groundedCatalog++;
            }
            if (hasFrontend && hasBackend) summary.frontendAndBackend++;
            else if (hasFrontend) summary.frontendOnly++;
            else if (hasBackend) summary.backendOnly++;
            else summary.metadataOnly++;
        }
        return summary;
    }

    save() {
        const dir = path.dirname(this.persistPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.persistPath, JSON.stringify({
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            stats: this.stats(),
            nodes: [...this.nodes.values()],
            edges: this.edges,
        }, null, 2));
    }

    load() {
        if (!fs.existsSync(this.persistPath)) return false;
        try {
            const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
            this.nodes = new Map((data.nodes || []).map((n) => [n.id, n]));
            this.edges = data.edges || [];
            this._reindex();
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = { FullStackGraph, NODE, EDGE, nodeId: id };
