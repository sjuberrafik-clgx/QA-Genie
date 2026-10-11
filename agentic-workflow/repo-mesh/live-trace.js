/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LIVE TRACE — runtime "what else breaks?" over the local repository clones
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   changed files ──▶ exported symbols ──▶ usage sites ──▶ product features
 *
 * Deliberately index-free. Traversal runs against the already-synced clones under
 * repo-mesh-data/, where a full scan of the frontend monorepo is a few thousand
 * files — cheap enough to do live, which keeps results fresh by construction and
 * removes the rebuild/webhook machinery a persisted graph would need.
 *
 * Deterministic and zero-token: no model calls anywhere in this module.
 *
 * Honest by design — the caller is told when evidence is weak rather than being
 * handed a confident-looking ranking:
 *   • `notSynced`      clones are missing, so an empty result is NOT "no impact"
 *   • `breadth:'wide'` symbol fans out across too many features to rank meaningfully
 *   • `truncated`      fan-out caps were hit, so the list is partial
 *
 * @module repo-mesh/live-trace
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCAN_EXTENSIONS = new Set(['.ts', '.html', '.graphql']);
const BACKEND_EXTENSIONS = new Set(['.java']);
const SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', '.angular', 'coverage', 'target', 'build', '.nx',
    // Test scaffolding references production symbols without being production risk.
    '_@testing', 'test', 'tests', 'testing', 'api-mocks', 'e2e', '__mocks__',
]);
const SKIP_FILE = /\.(spec|mock|stub|fixture)\.[tj]s$|\.d\.ts$|^(create-stub|mock-)/i;

const DEFAULTS = Object.freeze({
    depth: 2,
    maxFeatures: 8,
    maxSymbolsPerFile: 6,
    maxChangedFiles: 40,
    maxHitsPerSymbol: 120,
    maxDepth2Symbols: 12,
    wideSymbolFeatureLimit: 6,
});

/** Structural symbols reshape routing or data contracts, so their usages carry more risk. */
const KIND_WEIGHT = Object.freeze({
    route: 3, guard: 3, graphql: 3, resolver: 3,
    service: 2.5, store: 2.5, interceptor: 2.5,
    component: 2, directive: 2, container: 2,
    pipe: 1.5, unknown: 1.5,
    model: 1, enum: 1, const: 1, util: 1,
});

const DEPTH_FACTOR = Object.freeze({ 1: 1, 2: 0.4 });
const RISK_BANDS = Object.freeze({ high: 6, medium: 2.5 });

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPosix(value) {
    return String(value || '').replace(/\\/g, '/');
}

/** Classify a file by Angular naming convention; drives how heavily its symbols are weighted. */
function kindForPath(relPath) {
    const name = toPosix(relPath).toLowerCase();
    if (name.endsWith('.graphql')) return 'graphql';
    if (name.includes('.routes.') || name.includes('.routing.')) return 'route';
    if (name.includes('.guard.')) return 'guard';
    if (name.includes('.resolver.')) return 'resolver';
    if (name.includes('.interceptor.')) return 'interceptor';
    if (name.includes('.service.')) return 'service';
    if (name.includes('.store.') || name.includes('.state.')) return 'store';
    if (name.includes('.container.')) return 'container';
    if (name.includes('.component.') || name.endsWith('.html')) return 'component';
    if (name.includes('.directive.')) return 'directive';
    if (name.includes('.pipe.')) return 'pipe';
    if (name.includes('.model.') || name.includes('.interface.') || name.includes('.dto.')) return 'model';
    if (name.includes('.enum.')) return 'enum';
    if (name.includes('.const.') || name.includes('.config.')) return 'const';
    if (name.includes('.util') || name.includes('.helper')) return 'util';
    return 'unknown';
}

/**
 * Match a repo-relative path against a catalog prefix that may contain `*`
 * for a single segment (e.g. `aotf-frontend_apps/projects/&#42;/src/app/favorites`).
 */
function prefixMatches(relPath, prefix) {
    const target = toPosix(relPath).toLowerCase();
    const pattern = toPosix(prefix).toLowerCase();
    if (!pattern.includes('*')) return target.startsWith(pattern);
    const source = '^' + pattern.split('*').map(escapeRegExp).join('[^/]*');
    return new RegExp(source).test(target);
}

class LiveTrace {
    /**
     * @param {Object} [config]
     * @param {string} [config.frontendDir] Root holding frontend clones
     * @param {string} [config.reposDir]    Root holding backend clones
     * @param {Object[]} [config.features]  feature-catalog entries (name, pathPrefixes, sources)
     * @param {Object} [config.limits]      Overrides for DEFAULTS
     * @param {boolean} [config.verbose]
     */
    constructor(config = {}) {
        this.frontendDir = config.frontendDir || '';
        this.reposDir = config.reposDir || '';
        this.features = config.features || [];
        this.limits = { ...DEFAULTS, ...(config.limits || {}) };
        this.scope = config.scope === 'all' ? 'all' : 'frontend';
        this.verbose = config.verbose || false;
        this._fileCache = new Map();
        this._contentCache = new Map();
        this._headCache = new Map();
    }

    _log(message) {
        if (this.verbose) console.error(`[LiveTrace] ${message}`);
    }

    // ─── Clone health ───────────────────────────────────────────────────────

    /**
     * Report whether the clones needed for tracing exist and carry source.
     * A missing clone must never be reported as "no impact found".
     */
    cloneHealth() {
        const roots = [
            { role: 'frontend', dir: this.frontendDir },
            { role: 'backend', dir: this.reposDir },
        ];
        const present = [];
        const missing = [];
        for (const { role, dir } of roots) {
            let entries = [];
            try {
                entries = dir ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
            } catch {
                entries = [];
            }
            if (entries.length > 0) present.push({ role, dir, repositories: entries.length });
            else missing.push(role);
        }
        return {
            synced: present.some((p) => p.role === 'frontend'),
            present,
            missing,
            hint: 'Run: node agentic-workflow/scripts/repo-mesh-setup.js sync',
        };
    }

    /** Commit SHA and date of a clone, so every response can declare its own staleness. */
    repoHead(repoDir) {
        if (this._headCache.has(repoDir)) return this._headCache.get(repoDir);
        let head = { sha: null, committedAt: null };
        try {
            const raw = execFileSync('git', ['log', '-1', '--format=%H%n%cI'], {
                cwd: repoDir, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
            }).trim().split('\n');
            head = { sha: raw[0] || null, committedAt: raw[1] || null };
        } catch {
            // Clone may be shallow, bare, or git may be unavailable; staleness is then unknown.
        }
        this._headCache.set(repoDir, head);
        return head;
    }

    /**
     * Age of the clones actually being searched. Only in-scope repositories are
     * inspected — probing every backend clone would cost more than the trace itself.
     */
    staleness() {
        const roots = this.scope === 'all' ? [this.frontendDir, this.reposDir] : [this.frontendDir];
        const repos = [];
        for (const dir of roots) {
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
            } catch {
                continue;
            }
            for (const entry of entries.slice(0, 5)) {
                const head = this.repoHead(path.join(dir, entry.name));
                if (head.committedAt) repos.push({ repository: entry.name, committedAt: head.committedAt, sha: head.sha });
            }
        }
        const newest = repos.map((r) => r.committedAt).sort().at(-1) || null;
        const ageHours = newest ? Math.round((Date.now() - Date.parse(newest)) / 36e5) : null;
        return {
            lastCommitAt: newest,
            ageHours,
            repositories: repos,
            warning: ageHours === null
                ? 'Clone age is unknown, so results may not reflect current code.'
                : ageHours > 168
                    ? `Clones are ${Math.round(ageHours / 24)} days old. Code shipped since then is invisible to this trace — run a repo-mesh sync before trusting a clean result.`
                    : null,
        };
    }

    // ─── Source inventory ───────────────────────────────────────────────────

    /** Walk a clone root once per process, returning repo-prefixed relative paths. */
    _sourceFiles(rootDir, extensions) {
        if (this._fileCache.has(rootDir)) return this._fileCache.get(rootDir);
        const files = [];
        const walk = (dir) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
                } else if (extensions.has(path.extname(entry.name)) && !SKIP_FILE.test(entry.name)) {
                    files.push(path.join(dir, entry.name));
                }
            }
        };
        walk(rootDir);
        const mapped = files.map((abs) => ({ abs, rel: toPosix(path.relative(rootDir, abs)) }));
        this._fileCache.set(rootDir, mapped);
        this._log(`indexed ${mapped.length} files under ${rootDir}`);
        return mapped;
    }

    _allSourceFiles() {
        const frontend = this._sourceFiles(this.frontendDir, SCAN_EXTENSIONS);
        if (this.scope !== 'all') return frontend;
        return [...frontend, ...this._sourceFiles(this.reposDir, new Set([...SCAN_EXTENSIONS, ...BACKEND_EXTENSIONS]))];
    }

    /** Cached read so depth-2 re-scans cost nothing beyond the first pass. */
    _read(absPath) {
        if (this._contentCache.has(absPath)) return this._contentCache.get(absPath);
        let content = '';
        try {
            content = fs.readFileSync(absPath, 'utf-8');
        } catch {
            content = '';
        }
        this._contentCache.set(absPath, content);
        return content;
    }

    _resolveAbsolute(relPath) {
        for (const root of [this.frontendDir, this.reposDir]) {
            const candidate = path.join(root, relPath);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        }
        return null;
    }

    // ─── Symbol extraction ──────────────────────────────────────────────────

    /**
     * Exported identifiers plus the Angular `selector` string.
     *
     * The selector matters: templates reference a component as `<app-foo>`, never by
     * class name, so omitting it silently loses every template consumer.
     */
    extractSymbols(relPath, content) {
        const symbols = [];
        const seen = new Set();
        const kind = kindForPath(relPath);
        const push = (name, symbolKind) => {
            const trimmed = String(name || '').trim();
            if (!trimmed || trimmed.length < 3 || seen.has(trimmed)) return;
            seen.add(trimmed);
            symbols.push({ name: trimmed, kind: symbolKind, source: relPath });
        };

        if (relPath.endsWith('.graphql')) {
            for (const match of content.matchAll(/\b(?:query|mutation|subscription|fragment)\s+(\w+)/g)) {
                push(match[1], 'graphql');
            }
            return symbols.slice(0, this.limits.maxSymbolsPerFile);
        }

        for (const match of content.matchAll(/export\s+(?:abstract\s+)?(?:class|interface|enum|type|const|function)\s+(\w+)/g)) {
            push(match[1], kind);
        }
        for (const match of content.matchAll(/selector\s*:\s*['"`]([^'"`]+)['"`]/g)) {
            const selector = match[1].replace(/^[\[(]|[\])]$/g, '').trim();
            if (/^[a-z][\w-]*$/i.test(selector)) push(selector, 'selector');
        }
        return symbols.slice(0, this.limits.maxSymbolsPerFile);
    }

    _symbolsForFiles(relPaths) {
        const symbols = [];
        for (const relPath of relPaths) {
            const abs = this._resolveAbsolute(relPath);
            if (!abs) continue;
            const content = this._read(abs);
            if (!content) continue;
            symbols.push(...this.extractSymbols(relPath, content));
        }
        return symbols;
    }

    // ─── Usage search ───────────────────────────────────────────────────────

    /**
     * Apollo codegen derives `<Op>GQL`, `<Op>Document`, and `<Op>Query` from an
     * operation name, so a GraphQL symbol must match its generated descendants or
     * every real consumer is missed behind the generated layer.
     */
    _patternFor(symbol) {
        if (symbol.kind === 'selector') return `<${escapeRegExp(symbol.name)}[\\s/>]`;
        if (symbol.kind === 'graphql') return `\\b${escapeRegExp(symbol.name)}\\w*\\b`;
        return `\\b${escapeRegExp(symbol.name)}\\b`;
    }

    /**
     * One pass over the source inventory with a combined regex, then per-symbol
     * attribution only for files that matched. Keeps cost at a single read per file
     * regardless of how many symbols are being traced.
     */
    findUsages(symbols, options = {}) {
        if (symbols.length === 0) return [];
        const exclude = new Set((options.excludePaths || []).map(toPosix));
        const combined = new RegExp(symbols.map((s) => this._patternFor(s)).join('|'));
        const perSymbol = symbols.map((s) => ({ symbol: s, regex: new RegExp(this._patternFor(s)) }));
        const counts = new Map();
        const usages = [];

        for (const file of this._allSourceFiles()) {
            if (exclude.has(file.rel)) continue;
            const content = this._read(file.abs);
            if (!content || !combined.test(content)) continue;
            for (const { symbol, regex } of perSymbol) {
                if (!regex.test(content)) continue;
                const used = counts.get(symbol.name) || 0;
                if (used >= this.limits.maxHitsPerSymbol) continue;
                counts.set(symbol.name, used + 1);
                usages.push({ symbol: symbol.name, kind: symbol.kind, path: file.rel, definedIn: symbol.source });
            }
        }
        return usages;
    }

    // ─── Feature mapping ────────────────────────────────────────────────────

    /** Features owning a path, matched against catalog pathPrefixes then sources. */
    featuresForPath(relPath) {
        const matched = [];
        for (const feature of this.features) {
            const prefixes = feature.pathPrefixes || [];
            if (prefixes.some((prefix) => prefixMatches(relPath, prefix))) {
                matched.push(feature.name);
                continue;
            }
            if ((feature.sources || []).some((source) => toPosix(source).toLowerCase() === toPosix(relPath).toLowerCase())) {
                matched.push(feature.name);
            }
        }
        return matched;
    }

    resolveFeature(name) {
        const wanted = String(name || '').trim().toLowerCase();
        if (!wanted) return null;
        return this.features.find((feature) => feature.name.toLowerCase() === wanted
            || (feature.aliases || []).some((alias) => alias.toLowerCase() === wanted)) || null;
    }

    // ─── Domain pack ────────────────────────────────────────────────────────

    /**
     * URL segments a parent router mounts a feature under.
     *
     * Angular lazy-loads by module import path (`import('./favorites/favorites.module')`),
     * not by the routes constant, so the feature DIRECTORY is the reliable link.
     */
    _mountPathsFor(segments) {
        if (segments.length === 0) return [];
        const linkage = new RegExp(`import\\(\\s*['"\`][^'"\`]*\\/(?:${segments.map(escapeRegExp).join('|')})\\/`, 'i');
        const mounts = [];
        for (const file of this._sourceFiles(this.frontendDir, SCAN_EXTENSIONS)) {
            if (!/\.routes\.ts$/i.test(file.rel)) continue;
            const content = this._read(file.abs);
            if (!content || !linkage.test(content)) continue;
            // Bound each window at the NEXT path declaration; a fixed-size lookahead
            // spills into neighbouring route objects and mis-attributes their segments.
            const declarations = [...content.matchAll(/path\s*:\s*['"`]([^'"`]+)['"`]/g)];
            for (let index = 0; index < declarations.length; index++) {
                const start = declarations[index].index;
                const end = declarations[index + 1]?.index ?? content.length;
                if (linkage.test(content.slice(start, end))) mounts.push(declarations[index][1]);
            }
        }
        return mounts.filter((route) => route !== '**');
    }

    /**
     * Application-specific vocabulary for a feature: the routes it declares, the
     * component selectors and test ids it renders, and its catalog terminology.
     *
     * Exists so a browser agent scores pages against THIS product instead of a
     * generic archetype; it is read straight from source, so no index is involved.
     */
    domainPack(featureName) {
        const feature = this.resolveFeature(featureName);
        if (!feature) {
            return {
                found: false,
                feature: null,
                knownFeatures: this.features.map((f) => f.name).slice(0, 30),
                error: `"${featureName}" is not in the feature catalog.`,
            };
        }

        const routes = new Set();
        const selectors = new Set();
        const testIds = new Set();
        let filesScanned = 0;

        for (const file of this._sourceFiles(this.frontendDir, SCAN_EXTENSIONS)) {
            if (!this.featuresForPath(file.rel).includes(feature.name)) continue;
            const content = this._read(file.abs);
            if (!content) continue;
            filesScanned++;

            if (/\.routes\.ts$/i.test(file.rel)) {
                for (const match of content.matchAll(/path\s*:\s*['"`]([^'"`]*)['"`]/g)) {
                    // '' is a feature-relative mount and '**' is the catch-all; neither is navigable.
                    if (match[1] && match[1] !== '**') routes.add(match[1]);
                }
            }
            for (const match of content.matchAll(/selector\s*:\s*['"`]([a-z][\w-]*)['"`]/gi)) {
                selectors.add(match[1]);
            }
            for (const match of content.matchAll(/data-(?:qa|testid|test-id)\s*=\s*['"`]([^'"`]+)['"`]/gi)) {
                testIds.add(match[1]);
            }
        }

        // A feature declares its own routes as `path: ''`; the segment a user actually
        // visits is defined by the parent router that lazy-loads the feature directory.
        const segments = [...new Set((feature.pathPrefixes || [])
            .map((prefix) => toPosix(prefix).split('/').filter(Boolean).pop())
            .filter(Boolean))];
        for (const mount of this._mountPathsFor(segments)) routes.add(mount);

        const lexicon = [
            feature.name,
            ...(feature.aliases || []),
            ...(feature.domains || []),
            ...[...selectors].map((s) => s.replace(/^(app|oh|aotf)-/, '').replace(/-/g, ' ')),
        ].map((term) => String(term).toLowerCase());

        return {
            found: true,
            feature: feature.name,
            aliases: feature.aliases || [],
            description: feature.description || null,
            applications: feature.applications || [],
            domains: feature.domains || [],
            catalogStatus: feature.status || 'unknown',
            routes: [...routes].slice(0, 25),
            selectors: [...selectors].slice(0, 30),
            testIds: [...testIds].slice(0, 30),
            lexicon: [...new Set(lexicon)].filter(Boolean).slice(0, 40),
            filesScanned,
            staleness: this.staleness(),
        };
    }

    // ─── Orchestration ──────────────────────────────────────────────────────

    /**
     * Trace changed files to the product features they can break.
     *
     * @param {Object} options
     * @param {string[]} options.changedPaths Repo-prefixed paths (`repo/dir/file.ts`)
     * @param {number} [options.depth=2]      1 = direct consumers, 2 = one extra hop via shared code
     * @param {number} [options.maxFeatures=8]
     * @returns {Object} impact result with evidence, caps, and honesty flags
     */
    trace(options = {}) {
        const health = this.cloneHealth();
        if (!health.synced) {
            return {
                success: false,
                notSynced: true,
                error: 'Repository clones are missing, so impact cannot be traced. This is NOT evidence of zero impact.',
                cloneHealth: health,
            };
        }

        const depth = Math.max(1, Math.min(Number(options.depth) || this.limits.depth, 2));
        const maxFeatures = Math.max(1, Math.min(Number(options.maxFeatures) || this.limits.maxFeatures, 20));
        const requested = (options.changedPaths || []).map(toPosix).filter(Boolean);
        const changedPaths = requested.slice(0, this.limits.maxChangedFiles);
        const truncatedInput = requested.length > changedPaths.length;

        if (changedPaths.length === 0) {
            return { success: false, error: 'changedPaths is required and must contain at least one file path.' };
        }

        const primaryFeatures = [...new Set(changedPaths.flatMap((p) => this.featuresForPath(p)))];
        const rootSymbols = this._symbolsForFiles(changedPaths);
        if (rootSymbols.length === 0) {
            return {
                success: true,
                primaryFeatures,
                impactedFeatures: [],
                symbolsTraced: [],
                note: 'No exported symbols or selectors were found in the changed files, so consumers could not be traced.',
                staleness: this.staleness(),
                cloneHealth: health,
            };
        }

        const depth1 = this.findUsages(rootSymbols, { excludePaths: changedPaths });
        const usages = depth1.map((u) => ({ ...u, depth: 1 }));

        if (depth === 2) {
            // A file that merely USES the changed symbol is a consumer, not a conduit.
            // Only propagation counts on the second hop: barrels that re-export it and
            // generated wrappers named after it (GetAgentGQL, GetAgentDocument).
            // Hopping through every consumer's unrelated exports drags in global tokens
            // and manufactures impact that does not exist.
            const rootNames = rootSymbols.map((s) => s.name.toLowerCase());
            const conduitPaths = [...new Set(depth1
                .filter((u) => /\/libs\/|\/shared|\/_@core\/|\/_@shared\/|index\.ts$|\.generated\.ts$/i.test(u.path))
                .map((u) => u.path))].slice(0, this.limits.maxDepth2Symbols);

            const hopSymbols = this._symbolsForFiles(conduitPaths)
                .filter((symbol) => {
                    const name = symbol.name.toLowerCase();
                    return rootNames.some((root) => name.includes(root) && name !== root);
                })
                .slice(0, this.limits.maxDepth2Symbols);

            const seen = new Set(usages.map((u) => `${u.symbol}::${u.path}`));
            for (const usage of this.findUsages(hopSymbols, { excludePaths: [...changedPaths, ...conduitPaths] })) {
                const key = `${usage.symbol}::${usage.path}`;
                if (seen.has(key)) continue;
                seen.add(key);
                usages.push({ ...usage, depth: 2 });
            }
        }

        return this._rank({ usages, rootSymbols, primaryFeatures, changedPaths, depth, maxFeatures, truncatedInput, health });
    }

    _rank({ usages, rootSymbols, primaryFeatures, changedPaths, depth, maxFeatures, truncatedInput, health }) {
        // Pass 1 — how far does each symbol fan out?
        const symbolFeatures = new Map();
        for (const usage of usages) {
            for (const feature of this.featuresForPath(usage.path)) {
                if (!symbolFeatures.has(usage.symbol)) symbolFeatures.set(usage.symbol, new Set());
                symbolFeatures.get(usage.symbol).add(feature);
            }
        }

        const wideSymbols = [...symbolFeatures.entries()]
            .filter(([, features]) => features.size > this.limits.wideSymbolFeatureLimit)
            .map(([symbol, features]) => ({ symbol, featureCount: features.size }));
        const wideNames = new Set(wideSymbols.map((w) => w.symbol));

        // Pass 2 — score only on symbols that discriminate. A token used by every
        // feature (an injection token, a base service) carries no signal about which
        // feature is at risk, so letting it score would manufacture a ranking.
        const buckets = new Map();
        for (const usage of usages) {
            if (wideNames.has(usage.symbol)) continue;
            for (const feature of this.featuresForPath(usage.path)) {
                if (!buckets.has(feature)) {
                    buckets.set(feature, { feature, score: 0, symbols: new Set(), files: new Set(), minDepth: usage.depth });
                }
                const bucket = buckets.get(feature);
                bucket.score += (KIND_WEIGHT[usage.kind] ?? KIND_WEIGHT.unknown) * (DEPTH_FACTOR[usage.depth] ?? 0.4);
                bucket.symbols.add(usage.symbol);
                bucket.files.add(usage.path);
                bucket.minDepth = Math.min(bucket.minDepth, usage.depth);
            }
        }

        const primary = new Set(primaryFeatures);
        const ranked = [...buckets.values()]
            .filter((bucket) => !primary.has(bucket.feature))
            .sort((a, b) => b.score - a.score || a.feature.localeCompare(b.feature))
            .slice(0, maxFeatures)
            .map((bucket) => {
                const symbols = [...bucket.symbols].slice(0, 5);
                const files = [...bucket.files].slice(0, 5);
                const score = Math.round(bucket.score * 10) / 10;
                return {
                    feature: bucket.feature,
                    riskScore: score,
                    riskBand: score >= RISK_BANDS.high ? 'high' : score >= RISK_BANDS.medium ? 'medium' : 'low',
                    directness: bucket.minDepth === 1 ? 'direct' : 'indirect',
                    sharedSymbols: symbols,
                    evidenceFiles: files,
                    whyImpacted: `Uses ${symbols.join(', ')} from the changed code in ${bucket.files.size} file(s); nearest link is ${bucket.minDepth === 1 ? 'a direct reference' : 'via shared code'}.`,
                };
            });

        const unmapped = usages.filter((u) => this.featuresForPath(u.path).length === 0);
        const unmappedPaths = [...new Set(unmapped.map((u) => u.path))];

        return {
            success: true,
            primaryFeatures,
            impactedFeatures: ranked,
            symbolsTraced: rootSymbols.map((s) => ({ name: s.name, kind: s.kind })).slice(0, 20),
            changedFilesAnalyzed: changedPaths.length,
            depth,
            breadth: wideSymbols.length > 0 ? 'wide' : 'focused',
            wideSymbols,
            wideSymbolNote: wideSymbols.length > 0
                ? `${wideSymbols.length} symbol(s) are shared across more than ${this.limits.wideSymbolFeatureLimit} features. They are excluded from scoring because they cannot discriminate risk, so any feature reached ONLY through them needs manual triage.`
                : null,
            // Consumers outside the catalog path map are still real risk; hiding them would
            // turn an incomplete map into a false "no impact" signal.
            unmappedUsages: {
                count: unmappedPaths.length,
                paths: unmappedPaths.slice(0, 10),
                note: unmappedPaths.length > 0
                    ? 'These files reference the change but are not mapped to any catalogued feature. Review them manually or add a pathPrefixes entry in config/feature-catalog.json.'
                    : null,
            },
            truncated: truncatedInput || ranked.length >= maxFeatures,
            staleness: this.staleness(),
            cloneHealth: { synced: health.synced, repositories: health.present },
            limitations: [
                'Usage search is lexical, not a semantic reference graph; comments and strings can match.',
                `Traversal stopped at depth ${depth}; longer dependency chains are not represented.`,
                'Files outside the feature catalog path map are reported under unmappedUsages, not attributed to a feature.',
            ],
        };
    }
}

module.exports = { LiveTrace, DEFAULTS, KIND_WEIGHT, kindForPath, prefixMatches };
