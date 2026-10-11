/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRACT DNA — Multi-Resolution Compression + Semantic Hashing for Backend Repos
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Aggregates per-file partial contracts (from contract-extractor.js) into ONE
 * contract per service, then compresses to the same L1/L2/L3 resolutions the CCM
 * uses — but stored in a SEPARATE federated index so backend repos never bloat
 * the test-framework DNA.
 *
 *   L1 (Service Contract)  full endpoints + topics + indices + models + fields
 *   L2 (Service Card)      compact: counts + names ("GET /search", topics[], indices[])
 *   L3 (System Index)      one line per service — the whole backend in a few KB
 *
 * SEMANTIC HASH is the key innovation: each service's hash is computed over its
 * CONTRACT SURFACE (sorted, normalized) — not file bytes. A commit that only
 * touches comments/formatting yields an identical hash → the delta pipeline does
 * zero downstream work. Only a real contract change (new endpoint, renamed topic,
 * changed index) flips the hash and triggers a graph/index update.
 *
 * @module repo-mesh/contract-dna
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { extractFileContracts } = require('./contract-extractor');

const DNA_VERSION = '1.0.0';

// Known domain keywords → canonical domain (seeded from the OneHome architecture).
const DOMAIN_KEYWORDS = [
    ['consumer', 'consumer'], ['listing', 'listing'], ['favorite', 'favorites'],
    ['saved', 'saved-search'], ['saved-search', 'saved-search'], ['agent', 'agent'],
    ['group', 'group'], ['mls', 'mls'], ['planner', 'planner'], ['property-notes', 'property-notes'],
    ['notes', 'property-notes'], ['alerts', 'alerts'], ['marketplace', 'marketplace'],
    ['conversion', 'conversion'], ['message-router', 'messaging'], ['router', 'messaging'],
    ['analytics', 'analytics'], ['authentication', 'auth'], ['auth', 'auth'],
    ['pipeline', 'data-pipeline'], ['scdf', 'data-pipeline'], ['polygon', 'geo'],
];

function inferDomain(serviceName) {
    const n = (serviceName || '').toLowerCase();
    for (const [kw, domain] of DOMAIN_KEYWORDS) {
        if (n.includes(kw)) return domain;
    }
    return 'unknown';
}

function regionIdFor(serviceName) {
    return crypto.createHash('sha256').update(`service:${serviceName}`).digest('hex').slice(0, 12);
}

// ─── ContractDNA store ──────────────────────────────────────────────────────

class ContractDNA {
    /**
     * @param {Object} [options]
     * @param {string} [options.persistPath]  Where the DNA store lives
     * @param {number} [options.l2MaxChars]
     * @param {number} [options.l1MaxChars]
     * @param {boolean} [options.verbose]
     */
    constructor(options = {}) {
        const dataDir = path.resolve(__dirname, '..', 'repo-mesh-data');
        this.persistPath = options.persistPath
            ? path.resolve(options.persistPath)
            : path.join(dataDir, 'contract-dna.json');
        this.l2MaxChars = options.l2MaxChars || 600;
        this.l1MaxChars = options.l1MaxChars || 4000;
        this.verbose = options.verbose || false;

        /** @type {Map<string, Object>} serviceName → { regionId, hash, domain, l1, l2, updatedAt } */
        this._services = new Map();
        this._compiledAt = null;
    }

    // ─── Persistence ────────────────────────────────────────────────

    load() {
        try {
            if (fs.existsSync(this.persistPath)) {
                const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
                this._services = new Map(Object.entries(data.services || {}));
                this._compiledAt = data.compiledAt || null;
                return true;
            }
        } catch (err) {
            this._log(`⚠ Failed to load contract-dna.json: ${err.message}`);
        }
        return false;
    }

    save() {
        const dir = path.dirname(this.persistPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const data = {
            version: DNA_VERSION,
            compiledAt: new Date().toISOString(),
            stats: this.stats(),
            services: Object.fromEntries(this._services),
            l3: this.getL3(),
        };
        fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
        this._compiledAt = data.compiledAt;
    }

    // ─── Compilation ────────────────────────────────────────────────

    /**
     * Compile a service from its matching files and upsert into the store.
     *
     * @param {string} serviceName
     * @param {Array<{relPath:string, content:string}>} files
     * @param {Object} [meta]  Extra metadata to attach (repo, branch, sha)
     * @returns {{ changed:boolean, regionId:string, hash:string, l2:Object }}
     */
    compileService(serviceName, files, meta = {}) {
        const partials = [];
        for (const f of files) {
            try {
                const c = extractFileContracts(f.relPath, f.content);
                if (c) partials.push(c);
            } catch (err) {
                this._log(`⚠ extract failed for ${serviceName}/${f.relPath}: ${err.message}`);
            }
        }

        const l1 = this._aggregate(serviceName, partials, meta);
        const hash = semanticHash(l1);
        const prev = this._services.get(serviceName);
        const changed = !prev || prev.hash !== hash;

        if (changed) {
            const l2 = buildServiceCard(l1);
            this._services.set(serviceName, {
                regionId: l1.regionId,
                hash,
                domain: l1.domain,
                applicationName: l1.applicationName,
                updatedAt: new Date().toISOString(),
                l1,
                l2,
            });
        }

        return { changed, regionId: l1.regionId, hash, l2: this._services.get(serviceName).l2 };
    }

    removeService(serviceName) {
        return this._services.delete(serviceName);
    }

    _aggregate(serviceName, partials, meta) {
        const endpoints = [];
        const produces = new Set();
        const consumes = new Set();
        const indices = new Set();
        const models = [];
        const configFlags = [];
        const bindings = [];
        let applicationName = null;
        let serverPort = null;
        const sources = [];

        // Build a property map from all config partials so ${...} placeholders in
        // Java @KafkaListener/@Document resolve to real topic/index names.
        const propMap = {};
        for (const p of partials) {
            if (p.props) Object.assign(propMap, p.props);
        }
        const addName = (set, raw) => {
            const v = resolvePlaceholder(raw, propMap);
            if (isUsableName(v)) set.add(v);
        };

        for (const p of partials) {
            sources.push(p.source);
            if (p.applicationName) applicationName = p.applicationName;
            if (p.serverPort) serverPort = p.serverPort;

            for (const e of p.rest || []) {
                endpoints.push({ httpMethod: e.httpMethod, path: e.path, method: e.method || null });
            }
            for (const l of p.kafka?.listeners || []) {
                (l.topics || []).forEach((t) => addName(consumes, t));
            }
            for (const pr of p.kafka?.producers || []) {
                if (pr.topic && !pr.dynamic) addName(produces, pr.topic);
            }
            for (const b of p.kafka?.bindings || []) bindings.push(b);
            for (const d of p.elastic?.documents || []) {
                if (d.indexName) addName(indices, d.indexName);
                if (d.fields?.length) {
                    models.push({ name: d.className || d.indexName, kind: 'es-document', fields: d.fields });
                }
            }
            for (const ix of p.elastic?.indices || []) addName(indices, ix.indexName);
            for (const m of p.models || []) models.push(m);
            for (const c of p.configKeys || []) configFlags.push(c);
        }

        // Dedupe endpoints by method+path.
        const seen = new Set();
        const dedupedEndpoints = endpoints.filter((e) => {
            const k = `${e.httpMethod} ${e.path}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });

        return {
            regionId: regionIdFor(serviceName),
            level: 'L1',
            service: serviceName,
            domain: inferDomain(serviceName),
            applicationName,
            serverPort,
            repo: meta.repo || serviceName,
            sha: meta.sha || null,
            endpoints: dedupedEndpoints,
            topics: { produces: [...produces].sort(), consumes: [...consumes].sort() },
            indices: [...indices].sort(),
            bindings,
            models: dedupeModels(models),
            configFlags,
            sources,
        };
    }

    // ─── Retrieval ──────────────────────────────────────────────────

    getServiceL1(serviceName) {
        return this._services.get(serviceName)?.l1 || null;
    }

    getServiceL2(serviceName) {
        return this._services.get(serviceName)?.l2 || null;
    }

    getServiceHash(serviceName) {
        return this._services.get(serviceName)?.hash || null;
    }

    listServices() {
        return [...this._services.keys()];
    }

    /** Build the L3 system index across all services. */
    getL3() {
        const components = [];
        for (const [name, svc] of this._services) {
            const l2 = svc.l2 || {};
            components.push({
                service: name,
                domain: svc.domain,
                app: svc.applicationName || null,
                endpoints: (l2.endpoints || []).length,
                produces: l2.topicsProduced || [],
                consumes: l2.topicsConsumed || [],
                indices: l2.indices || [],
            });
        }
        return {
            level: 'L3',
            version: DNA_VERSION,
            serviceCount: components.length,
            totalEndpoints: components.reduce((s, c) => s + c.endpoints, 0),
            topics: [...new Set(components.flatMap((c) => [...c.produces, ...c.consumes]))].sort(),
            indices: [...new Set(components.flatMap((c) => c.indices))].sort(),
            components,
        };
    }

    /**
     * Render a service at a given resolution as a compact string for prompts.
     * @param {string} serviceName
     * @param {'L1'|'L2'|'L3'} [level]
     */
    render(serviceName, level = 'L2') {
        const svc = this._services.get(serviceName);
        if (!svc) return '';
        if (level === 'L1') return JSON.stringify(svc.l1).slice(0, this.l1MaxChars);
        return renderCard(svc.l2).slice(0, this.l2MaxChars);
    }

    stats() {
        const services = [...this._services.values()];
        return {
            services: services.length,
            endpoints: services.reduce((s, v) => s + (v.l2?.endpoints?.length || 0), 0),
            topics: new Set(services.flatMap((v) => [...(v.l2?.topicsProduced || []), ...(v.l2?.topicsConsumed || [])])).size,
            indices: new Set(services.flatMap((v) => v.l2?.indices || [])).size,
            models: services.reduce((s, v) => s + (v.l2?.modelCount || 0), 0),
        };
    }

    _log(msg) {
        if (this.verbose) console.log(`[contract-dna] ${msg}`);
    }
}

// ─── L2 card builder ────────────────────────────────────────────────────────

function buildServiceCard(l1) {
    return {
        regionId: l1.regionId,
        level: 'L2',
        service: l1.service,
        domain: l1.domain,
        app: l1.applicationName,
        endpoints: (l1.endpoints || []).map((e) => `${e.httpMethod} ${e.path}`),
        topicsProduced: l1.topics?.produces || [],
        topicsConsumed: l1.topics?.consumes || [],
        indices: l1.indices || [],
        models: (l1.models || []).map((m) => m.name).filter(Boolean),
        modelCount: (l1.models || []).length,
        configFlags: (l1.configFlags || []).map((c) => c.key),
    };
}

function renderCard(card) {
    if (!card) return '';
    const lines = [`SERVICE ${card.service} (${card.domain})`];
    if (card.app) lines.push(`  app: ${card.app}`);
    if (card.endpoints?.length) lines.push(`  endpoints: ${card.endpoints.join(', ')}`);
    if (card.topicsProduced?.length) lines.push(`  produces → ${card.topicsProduced.join(', ')}`);
    if (card.topicsConsumed?.length) lines.push(`  consumes ← ${card.topicsConsumed.join(', ')}`);
    if (card.indices?.length) lines.push(`  elastic indices: ${card.indices.join(', ')}`);
    if (card.models?.length) lines.push(`  models: ${card.models.slice(0, 12).join(', ')}`);
    return lines.join('\n');
}

// ─── Semantic hashing ───────────────────────────────────────────────────────

/**
 * Hash the CONTRACT SURFACE (not file bytes). Comments/formatting/source order
 * never affect this — only real contract changes do.
 * @param {Object} l1
 * @returns {string} sha256 hex (16 chars)
 */
function semanticHash(l1) {
    const canonical = {
        service: l1.service,
        endpoints: (l1.endpoints || [])
            .map((e) => `${e.httpMethod} ${e.path}`)
            .sort(),
        produces: [...(l1.topics?.produces || [])].sort(),
        consumes: [...(l1.topics?.consumes || [])].sort(),
        indices: [...(l1.indices || [])].sort(),
        models: (l1.models || [])
            .map((m) => `${m.name}:${(m.fields || []).map((f) => f.name).sort().join(',')}`)
            .sort(),
        configFlags: (l1.configFlags || []).map((c) => c.key).sort(),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

/** Resolve a Spring ${prop.name} / ${prop.name:default} placeholder against a config map. */
function resolvePlaceholder(value, propMap, depth = 0) {
    if (typeof value !== 'string' || depth > 6) return value;
    const m = value.match(/^\$\{\s*([^:}]+?)\s*(?::([^}]*))?\}$/);
    if (!m) return value;
    const key = m[1].trim();
    if (propMap[key] !== undefined) return resolvePlaceholder(propMap[key], propMap, depth + 1);
    if (m[2] !== undefined) return resolvePlaceholder(m[2], propMap, depth + 1);
    return value;
}

/** A topic/index name is usable only if it's concrete (no unresolved placeholder/SpEL). */
function isUsableName(v) {
    return typeof v === 'string' && v.length > 0
        && !v.includes('${') && !v.includes('#{') && !v.includes('}') && !v.includes('@');
}

function dedupeModels(models) {
    const byName = new Map();
    for (const m of models) {
        if (!m.name) continue;
        const existing = byName.get(m.name);
        if (!existing || (m.fields?.length || 0) > (existing.fields?.length || 0)) {
            byName.set(m.name, m);
        }
    }
    return [...byName.values()];
}

module.exports = {
    ContractDNA,
    semanticHash,
    buildServiceCard,
    renderCard,
    inferDomain,
    regionIdFor,
};
