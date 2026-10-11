/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FRONTEND ANALYZER — UI → API call-site extraction (Angular + Apollo/GraphQL)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Scans the frontend mono-repo (agent-portal + onehome) for the calls the UI
 * makes to the backend, so the graph can add the missing top layer:
 *
 *     UI feature ──▶ API ──▶ Kafka ──▶ Elastic
 *
 * The OneHome frontend is Angular + Apollo. It talks to the backend two ways:
 *   • GraphQL operations (.graphql / inline gql`…`) — the dominant data layer.
 *     e.g. mutation UpdatePropertyMetaData($sentiment: ListingSentimentInput!),
 *          query GetListingNotes, mutation registerUser.
 *   • REST via HttpClient — http.get/post(...) with env-based paths
 *     e.g. `${ENVIRONMENT.PATH_API_AOTF_REST}/marketplace/offerRequests/update`.
 *
 * Each operation/call is tagged with the app it belongs to (from the file path)
 * and an inferred backend DOMAIN (reusing the same keyword inference the contract
 * mesh uses for services), so the graph can connect UI → domain → service →
 * topic → index.
 *
 * Deterministic, zero-LLM, regex-based.
 *
 * @module repo-mesh/frontend-analyzer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { inferDomain } = require('./contract-dna');

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const GQL_EXT = new Set(['.graphql', '.gql']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'locales', '.angular']);

/** Infer which app a file belongs to from its path (projects/<app>/...). */
function inferApp(relPath) {
    const p = relPath.replace(/\\/g, '/');
    const m = p.match(/projects\/([^/]+)\//);
    return m ? m[1] : 'shared';
}

function titleCaseFeature(slug) {
    return slug
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/** Infer product feature slugs from application, Apollo, and feature service paths. */
function inferFeatures(relPath) {
    const normalized = relPath.replace(/\\/g, '/').toLowerCase();
    const features = new Set();
    const appMatch = normalized.match(/projects\/[^/]+\/src\/app\/([^/]+)\//);
    if (appMatch && !appMatch[1].startsWith('_')) features.add(appMatch[1]);
    const apolloMatch = normalized.match(/(?:^|\/)apollo\/([^/]+)\//);
    if (apolloMatch) features.add(apolloMatch[1]);
    const fileMatch = normalized.match(/(?:^|\/)([a-z0-9_-]+)\.(?:service|container|module|routes)(?:\.spec)?\.(?:ts|js)$/);
    if (fileMatch) features.add(fileMatch[1]);
    return [...features].map((slug) => ({ slug, name: titleCaseFeature(slug) }));
}

function sourcePriority(source) {
    let score = 0;
    if (/\.(graphql|gql)$/i.test(source)) score += 100;
    if (/\.(service|routes)\.ts$/i.test(source)) score += 80;
    if (/\.container\.ts$/i.test(source)) score += 70;
    if (/\.module\.ts$/i.test(source)) score += 50;
    if (/\.spec\.[jt]s$/i.test(source)) score -= 30;
    return score;
}

/** Round-robin high-value evidence across frontend applications. */
function prioritizeFeatureSources(sources, maxSources = 40) {
    const groups = new Map();
    for (const source of [...new Set(sources)]) {
        const app = source.match(/projects\/([^/]+)\//)?.[1] || 'shared';
        if (!groups.has(app)) groups.set(app, []);
        groups.get(app).push(source);
    }
    for (const entries of groups.values()) {
        entries.sort((left, right) => sourcePriority(right) - sourcePriority(left) || left.localeCompare(right));
    }
    const selected = [];
    const appNames = [...groups.keys()].sort((left, right) => left === 'shared' ? -1 : right === 'shared' ? 1 : left.localeCompare(right));
    while (selected.length < maxSources && appNames.some((app) => groups.get(app).length > 0)) {
        for (const app of appNames) {
            const source = groups.get(app).shift();
            if (source) selected.push(source);
            if (selected.length >= maxSources) break;
        }
    }
    return selected;
}

/** Keep a bounded, application-diverse reservoir while walking large features. */
function retainFeatureSource(sourceSet, source, maxCandidates = 120) {
    sourceSet.add(source);
    if (sourceSet.size <= maxCandidates) return;
    const retained = prioritizeFeatureSources([...sourceSet], maxCandidates);
    sourceSet.clear();
    for (const candidate of retained) sourceSet.add(candidate);
}

/** Extract named GraphQL operations + their input types. */
function extractGraphqlOps(content) {
    const ops = [];
    const re = /\b(query|mutation|subscription)\s+(\w+)\s*(\([^)]*\))?\s*\{/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const args = m[3] || '';
        const inputs = [...args.matchAll(/\$\w+\s*:\s*([\w!\[\]]+)/g)].map((x) => x[1].replace(/[!\[\]]/g, ''));
        ops.push({ kind: m[1], name: m[2], inputs });
    }
    return ops;
}

/** Extract Angular HttpClient REST calls (method + a path/const hint). */
function extractRestCalls(content) {
    const calls = [];
    // .get/.post/.put/.patch/.delete( <url-arg> ...
    const re = /\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'"][^`'"]*[`'"]|[A-Za-z_$][\w.$]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const method = m[1].toUpperCase();
        const urlArg = m[2];
        let pathHint = '';
        if (/^[`'"]/.test(urlArg)) {
            const lit = urlArg.slice(1, -1);
            const frag = lit.match(/\/[\w\-/{}.]+/); // first /path fragment
            pathHint = frag ? frag[0].replace(/\$\{[^}]*\}/g, '{param}') : '';
        } else if (/(api|url|endpoint|path|http|rest|uri|service)/i.test(urlArg)) {
            // constant ref that looks like an API/URL — skip local storage/cache/map gets
            pathHint = urlArg;
        }
        if (pathHint && pathHint.length > 1) calls.push({ method, pathHint });
    }
    return calls;
}

function walk(dir, root, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(path.join(dir, e.name), root, out);
        } else {
            const ext = path.extname(e.name).toLowerCase();
            if (CODE_EXT.has(ext) || GQL_EXT.has(ext)) {
                out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
            }
        }
    }
}

/**
 * Analyze one frontend repo directory.
 * @param {string} repoDir
 * @returns {{ apps: Object, totals: Object }}
 */
function analyzeFrontendRepo(repoDir) {
    const files = [];
    walk(repoDir, repoDir, files);

    /** app → { operations:[], restCalls:[], domains:Map<domain,Set<opName>> } */
    const apps = {};
    /** feature slug → implementation evidence retained for graph routing. */
    const features = {};
    const ensure = (app) => (apps[app] ||= { operations: [], restCalls: [], domains: {} });
    const ensureFeature = ({ slug, name }) => (features[slug] ||= {
        name,
        apps: new Set(),
        operations: [],
        restCalls: [],
        domains: {},
        sources: new Set(),
    });
    const tagDomain = (app, domain, label) => {
        if (!domain || domain === 'unknown') return;
        const a = ensure(app);
        (a.domains[domain] ||= new Set()).add(label);
    };
    const tagFeatureDomain = (feature, domain, label) => {
        if (!domain || domain === 'unknown') return;
        (feature.domains[domain] ||= new Set()).add(label);
    };

    let opCount = 0;
    let restCount = 0;
    for (const rel of files) {
        let content;
        try {
            content = fs.readFileSync(path.join(repoDir, rel), 'utf-8');
        } catch {
            continue;
        }
        const ext = path.extname(rel).toLowerCase();
        const app = inferApp(rel);
        const fileFeatures = inferFeatures(rel).map((feature) => {
            const entry = ensureFeature(feature);
            entry.apps.add(app);
            retainFeatureSource(entry.sources, rel);
            return entry;
        });

        if (GQL_EXT.has(ext) || /\bgql`/.test(content) || /\b(query|mutation)\s+\w+\s*[({]/.test(content)) {
            for (const op of extractGraphqlOps(content)) {
                const domain = inferDomain(`${op.name} ${op.inputs.join(' ')}`);
                ensure(app).operations.push({ ...op, domain, source: rel });
                tagDomain(app, domain, op.name);
                for (const feature of fileFeatures) {
                    feature.operations.push({ ...op, domain, source: rel });
                    tagFeatureDomain(feature, domain, op.name);
                }
                opCount++;
            }
        }
        if (CODE_EXT.has(ext)) {
            for (const call of extractRestCalls(content)) {
                const domain = inferDomain(`${call.pathHint} ${rel}`);
                ensure(app).restCalls.push({ ...call, domain, source: rel });
                tagDomain(app, domain, `${call.method} ${call.pathHint}`);
                for (const feature of fileFeatures) {
                    feature.restCalls.push({ ...call, domain, source: rel });
                    tagFeatureDomain(feature, domain, `${call.method} ${call.pathHint}`);
                }
                restCount++;
            }
        }
    }

    // Convert domain Sets to arrays.
    for (const a of Object.values(apps)) {
        a.domainList = Object.fromEntries(Object.entries(a.domains).map(([d, s]) => [d, [...s].slice(0, 40)]));
        delete a.domains;
    }
    for (const feature of Object.values(features)) {
        feature.apps = [...feature.apps].sort();
        feature.sources = prioritizeFeatureSources([...feature.sources]);
        feature.domainList = Object.fromEntries(Object.entries(feature.domains).map(([domain, labels]) => [
            domain,
            [...labels].slice(0, 40),
        ]));
        delete feature.domains;
    }

    return {
        apps,
        features,
        totals: {
            files: files.length,
            operations: opCount,
            restCalls: restCount,
            apps: Object.keys(apps).length,
            features: Object.keys(features).length,
        },
    };
}

/**
 * Analyze all frontend repos under a directory.
 * @param {string} frontendRoot  e.g. repo-mesh-data/frontend
 * @returns {{ apps: Object, totals: Object } | null}
 */
function analyzeFrontend(frontendRoot) {
    if (!fs.existsSync(frontendRoot)) return null;
    const merged = { apps: {}, features: {}, totals: { files: 0, operations: 0, restCalls: 0, repos: 0 } };
    for (const entry of fs.readdirSync(frontendRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const res = analyzeFrontendRepo(path.join(frontendRoot, entry.name));
        merged.totals.repos++;
        merged.totals.files += res.totals.files;
        merged.totals.operations += res.totals.operations;
        merged.totals.restCalls += res.totals.restCalls;
        for (const [app, data] of Object.entries(res.apps)) {
            const m = (merged.apps[app] ||= { operations: [], restCalls: [], domainList: {} });
            m.operations.push(...data.operations);
            m.restCalls.push(...data.restCalls);
            for (const [d, labels] of Object.entries(data.domainList)) {
                m.domainList[d] = [...new Set([...(m.domainList[d] || []), ...labels])].slice(0, 40);
            }
        }
        for (const [slug, data] of Object.entries(res.features || {})) {
            const feature = (merged.features[slug] ||= {
                name: data.name,
                repositories: [],
                apps: [],
                operations: [],
                restCalls: [],
                domainList: {},
                sources: [],
            });
            feature.repositories = [...new Set([...feature.repositories, entry.name])].sort();
            feature.apps = [...new Set([...feature.apps, ...data.apps])].sort();
            feature.operations.push(...data.operations);
            feature.restCalls.push(...data.restCalls);
            feature.sources = prioritizeFeatureSources([
                ...feature.sources,
                ...data.sources.map((source) => `${entry.name}/${source}`),
            ]);
            for (const [domain, labels] of Object.entries(data.domainList)) {
                feature.domainList[domain] = [...new Set([...(feature.domainList[domain] || []), ...labels])].slice(0, 40);
            }
        }
    }
    merged.totals.apps = Object.keys(merged.apps).length;
    merged.totals.features = Object.keys(merged.features).length;
    return merged;
}

module.exports = {
    analyzeFrontend,
    analyzeFrontendRepo,
    extractGraphqlOps,
    extractRestCalls,
    inferApp,
    inferFeatures,
    prioritizeFeatureSources,
    retainFeatureSource,
};
