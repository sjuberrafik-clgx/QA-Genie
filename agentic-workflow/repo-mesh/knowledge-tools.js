/**
 * Read-only application knowledge tools backed by Repo Mesh.
 * Handlers are transport-neutral so they can be tested without starting MCP.
 */

const fs = require('fs');
const path = require('path');
const { getRepoMesh } = require('./index');
const { DEFAULT_LIMITS, boundResponse, truncateText } = require('./context-budget');
const { LiveTrace } = require('./live-trace');
const { ChangeResolver } = require('./change-resolver');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function contractEvidenceId(serviceName, resolution = 'L1') {
    return `contract:${encodeURIComponent(serviceName)}:${resolution}`;
}

function parseContractEvidenceId(evidenceId) {
    const match = String(evidenceId || '').match(/^contract:([^:]+):(L1|L2)$/);
    if (!match) return null;
    return { serviceName: decodeURIComponent(match[1]), resolution: match[2] };
}

function compactServiceCard(card) {
    return {
        service: card.service,
        domain: card.domain || 'unknown',
        application: card.app || null,
        endpoints: (card.endpoints || []).slice(0, 8),
        topicsProduced: (card.topicsProduced || []).slice(0, 6),
        topicsConsumed: (card.topicsConsumed || []).slice(0, 6),
        indices: (card.indices || []).slice(0, 6),
        models: (card.models || []).slice(0, 8),
        evidenceId: contractEvidenceId(card.service, 'L1'),
    };
}

function compactRuleCard(rule) {
    return {
        id: rule.id,
        statement: rule.statement,
        type: rule.type,
        truthLane: rule.truthLane,
        confidence: rule.confidence,
        context: rule.context || null,
        evidenceKinds: [...new Set((rule.evidence || []).map((item) => item.kind))],
    };
}

function compactTrace(trace, maxServices) {
    return {
        matched: trace?.feature || trace?.matchedNode || null,
        matchedType: trace?.matchedType || (trace?.feature ? 'feature' : null),
        services: (trace?.services || []).slice(0, maxServices),
        uiApps: (trace?.uiApps || []).slice(0, 4),
        uiOperations: (trace?.uiOperations || []).slice(0, 12),
        endpoints: (trace?.endpoints || []).slice(0, 16),
        topicsProduced: (trace?.topicsProduced || []).slice(0, 8),
        topicsConsumed: (trace?.topicsConsumed || []).slice(0, 8),
        indices: (trace?.indices || []).slice(0, 8),
        models: (trace?.models || []).slice(0, 12),
        featureSources: (trace?.featureSources || []).slice(0, 12),
        featureRepositories: (trace?.featureRepositories || []).slice(0, 4),
        featureDomains: (trace?.featureDomains || []).slice(0, 6),
        catalogStatus: trace?.featureCatalogStatus || null,
    };
}

function coverageFor(trace, hasFrontendEvidence, hasContractEvidence) {
    if (trace?.featureCatalogStatus === 'partial') return 'partial';
    if (hasFrontendEvidence && hasContractEvidence) return 'frontend-and-contract-grounded';
    if (hasFrontendEvidence) return 'frontend-grounded';
    if (hasContractEvidence) return 'contract-grounded';
    return 'unknown';
}

function latestSyncSummary(syncState = {}) {
    const repositories = Object.entries(syncState.repos || {});
    const timestamps = repositories
        .map(([, state]) => state.lastSyncedAt)
        .filter(Boolean)
        .sort();
    return {
        repositoryCount: repositories.length,
        latestSyncAt: timestamps.at(-1) || null,
        repositoriesWithoutSha: repositories.filter(([, state]) => !state.lastSyncedSha).length,
    };
}

function createKnowledgeToolService(options = {}) {
    const mesh = options.mesh || getRepoMesh();

    function ready() {
        mesh.initialize();
        return mesh;
    }

    function searchApplicationKnowledge(args = {}) {
        const query = String(args.query || '').trim();
        if (!query) {
            return boundResponse({ success: false, error: 'query is required' }, {
                maxChars: DEFAULT_LIMITS.searchMaxChars,
                resolution: 'L2',
            });
        }

        const maxResults = clamp(args.maxResults, 1, DEFAULT_LIMITS.maxResults, DEFAULT_LIMITS.maxResults);
        const activeMesh = ready();
        const result = activeMesh.searchContracts(query, { maxServices: maxResults });
        const trace = activeMesh.traceFullStack(query, { maxServices: maxResults });
        const services = (result.services || []).slice(0, maxResults).map(compactServiceCard);
        const featureEvidence = trace?.featureSources?.length ? {
            feature: trace.feature || trace.matchedNode || query,
            status: trace.featureCatalogStatus || null,
            repositories: (trace.featureRepositories || []).slice(0, 4),
            applications: (trace.uiApps || []).slice(0, 4),
            operations: (trace.uiOperations || []).slice(0, 12),
            sources: trace.featureSources.slice(0, 12),
        } : null;
        return boundResponse({
            success: true,
            query,
            matched: result.matched,
            results: services,
            relations: {
                topicsProduced: (result.topics?.produced || []).slice(0, 8),
                topicsConsumed: (result.topics?.consumed || []).slice(0, 8),
                indices: (result.indices || []).slice(0, 8),
            },
            featureEvidence,
            coverage: coverageFor(trace, !!featureEvidence, services.length > 0),
            guidance: services.length > 0
                ? 'Use an evidenceId only when exact contract details are needed.'
                : 'No matching contract evidence was found in the current local mesh.',
        }, { maxChars: DEFAULT_LIMITS.searchMaxChars, resolution: 'L2' });
    }

    function getFeatureBehavior(args = {}) {
        const feature = String(args.feature || '').trim();
        if (!feature) {
            return boundResponse({ success: false, error: 'feature is required' }, {
                maxChars: DEFAULT_LIMITS.behaviorMaxChars,
                resolution: 'L2',
            });
        }

        const maxServices = clamp(args.maxServices, 1, 4, 4);
        const includeRules = args.includeRules === true;
        const maxRules = clamp(args.maxRules, 1, 5, 5);
        const activeMesh = ready();
        const trace = activeMesh.traceFullStack(feature, { maxServices });
        if (!trace) {
            return boundResponse({
                success: true,
                feature,
                coverage: 'unknown',
                behavior: null,
                evidenceGaps: ['No feature, service, domain, event, or index match exists in the current local mesh.'],
            }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
        }

        const hasFrontendEvidence = (trace.featureSources || []).length > 0;
        const hasContractEvidence = (trace.services || []).length > 0;
        const serviceCards = trace.services
            .slice(0, maxServices)
            .map((serviceName) => activeMesh.getServiceContract(serviceName, 'L2'))
            .filter(Boolean)
            .map(compactServiceCard);
        const ruleOptions = {
            maxRules,
            query: args.ruleQuery || '',
            truthLanes: Array.isArray(args.truthLanes) ? args.truthLanes : [],
            types: Array.isArray(args.ruleTypes) ? args.ruleTypes : [],
        };
        const businessRules = includeRules
            ? activeMesh.getFeatureRules(feature, ruleOptions).map(compactRuleCard)
            : undefined;
        const ruleSummary = includeRules ? activeMesh.getFeatureRuleStats(feature) : undefined;
        const behavior = {
            ...compactTrace(trace, maxServices),
            serviceContracts: serviceCards,
        };
        if (includeRules) {
            behavior.uiOperations = behavior.uiOperations.slice(0, 6);
            behavior.featureSources = behavior.featureSources.slice(0, 4);
            behavior.topicsProduced = behavior.topicsProduced.slice(0, 3);
            behavior.topicsConsumed = behavior.topicsConsumed.slice(0, 3);
            behavior.indices = behavior.indices.slice(0, 4);
            behavior.models = behavior.models.slice(0, 4);
            behavior.serviceContracts = behavior.serviceContracts.slice(0, 2);
        }
        const observationComparison = includeRules && Array.isArray(args.observations) && args.observations.length > 0
            ? activeMesh.compareFeatureObservations(feature, args.observations)
            : undefined;
        return boundResponse({
            success: true,
            feature,
            coverage: trace.featureCatalogStatus === 'partial'
                ? 'partial'
                : hasFrontendEvidence && hasContractEvidence
                    ? 'partial'
                    : coverageFor(trace, hasFrontendEvidence, hasContractEvidence),
            evidenceBasis: hasFrontendEvidence && hasContractEvidence
                ? 'frontend-analysis+contract-graph'
                : hasFrontendEvidence ? 'frontend-analysis' : 'contract-graph',
            behavior,
            businessRules,
            ruleSummary,
            observationComparison,
            evidenceGaps: [
                includeRules && businessRules?.length > 0
                    ? 'Exact source/test line windows are available through each rule:* evidence handle.'
                    : hasFrontendEvidence && hasContractEvidence
                        ? 'Frontend implementation paths and operations are grounded; request includeRules=true for business-rule cards.'
                    : hasFrontendEvidence
                        ? 'Frontend implementation is grounded, but no backend domain contract is linked to this feature.'
                        : 'This initial slice proves architecture and contracts, not complete user-visible source behavior.',
                includeRules && !(ruleSummary?.byLane?.intended > 0)
                    ? 'No intended requirement rules are compiled for this feature; current rules describe implemented behavior.'
                    : null,
                'Complete executable behavior still requires live browser evidence and focused tests.',
            ].filter(Boolean),
        }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
    }

    function traceFeatureImpact(args = {}) {
        const feature = String(args.feature || '').trim();
        if (!feature) {
            return boundResponse({ success: false, error: 'feature is required' }, {
                maxChars: DEFAULT_LIMITS.behaviorMaxChars,
                resolution: 'L2',
            });
        }

        const maxServices = clamp(args.maxServices, 1, 6, 4);
        const trace = ready().traceFullStack(feature, { maxServices });
        const hasFrontendEvidence = (trace?.featureSources || []).length > 0;
        const hasContractEvidence = (trace?.services || []).length > 0;
        return boundResponse(trace ? {
            success: true,
            feature,
            coverage: coverageFor(trace, hasFrontendEvidence, hasContractEvidence),
            impact: compactTrace(trace, maxServices),
            serviceEvidence: (trace.services || []).slice(0, maxServices).map((serviceName) => ({
                service: serviceName,
                evidenceId: contractEvidenceId(serviceName, 'L1'),
            })),
        } : {
            success: true,
            feature,
            coverage: 'unknown',
            impact: null,
            evidenceGaps: ['No impact trace was found in the current local mesh.'],
        }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
    }

    function getSourceEvidence(args = {}) {
        if (String(args.evidenceId || '').startsWith('rule:')) {
            const evidence = ready().getRuleEvidence(args.evidenceId, {
                contextLines: clamp(args.contextLines, 0, 10, 3),
            });
            if (!evidence) {
                return boundResponse({ success: false, error: `No business rule found for ${args.evidenceId}.` }, {
                    maxChars: DEFAULT_LIMITS.evidenceMaxChars,
                    resolution: 'L1',
                });
            }
            return boundResponse({
                success: true,
                evidenceId: args.evidenceId,
                kind: 'business-rule',
                rule: compactRuleCard(evidence.rule),
                windows: evidence.windows,
            }, { maxChars: DEFAULT_LIMITS.evidenceMaxChars, resolution: 'L1' });
        }

        const parsed = parseContractEvidenceId(args.evidenceId);
        if (!parsed) {
            return boundResponse({
                success: false,
                error: 'Unsupported evidenceId. Use a contract evidenceId returned by another application-kb tool.',
            }, { maxChars: DEFAULT_LIMITS.evidenceMaxChars, resolution: 'L1' });
        }

        const resolution = args.resolution === 'L2' ? 'L2' : parsed.resolution;
        const contract = ready().getServiceContract(parsed.serviceName, resolution);
        if (!contract) {
            return boundResponse({ success: false, error: `No contract found for ${parsed.serviceName}.` }, {
                maxChars: DEFAULT_LIMITS.evidenceMaxChars,
                resolution,
            });
        }

        return boundResponse({
            success: true,
            evidenceId: contractEvidenceId(parsed.serviceName, resolution),
            kind: 'service-contract',
            repository: contract.repo || parsed.serviceName,
            commitSha: contract.sha || null,
            sources: (contract.sources || []).slice(0, 20),
            contract,
            evidenceGaps: contract.sha
                ? ['Line-level source excerpts require the source-index phase.']
                : ['The persisted contract has no commit SHA; rebuild after repository sync.', 'Line-level source excerpts require the source-index phase.'],
        }, { maxChars: DEFAULT_LIMITS.evidenceMaxChars, resolution });
    }

    function getKnowledgeStatus(args = {}) {
        const stats = ready().stats();
        return boundResponse({
            success: true,
            enabled: stats.enabled,
            contracts: stats.dna,
            graph: {
                nodes: stats.graph.nodes,
                edges: stats.graph.edges,
                byType: stats.graph.byType,
            },
            features: stats.featureCoverage,
            businessRules: stats.businessRules,
            sync: latestSyncSummary(stats.sync),
            capabilities: {
                contractGraph: true,
                businessRuleDNA: (stats.businessRules?.rules || 0) > 0,
                sourceIndex: false,
                lineLevelEvidence: (stats.businessRules?.rules || 0) > 0,
            },
            nextStep: 'When repository knowledge is stale, call context-engine ce_refresh_repos (it recompiles automatically); this server reloads the result on its next call.',
        }, { maxChars: DEFAULT_LIMITS.searchMaxChars, resolution: args.resolution === 'L3' ? 'L3' : 'L2' });
    }

    // ─── Live impact trace (index-free, reads the local clones) ──────────────

    let traceInstance;
    let traceLoadVersion;
    function liveTrace() {
        const activeMesh = ready();
        if (!options.liveTrace && traceLoadVersion !== activeMesh.loadVersion) traceInstance = undefined;
        if (!traceInstance) {
            traceLoadVersion = activeMesh.loadVersion;
            traceInstance = options.liveTrace || new LiveTrace({
                frontendDir: activeMesh._frontendDir,
                reposDir: activeMesh.cloneDir,
                features: activeMesh._featureCatalog()?.features || [],
                scope: options.traceScope,
            });
        }
        return traceInstance;
    }

    let resolverInstance;
    function changeResolver() {
        if (!resolverInstance) {
            const activeMesh = ready();
            const repos = (activeMesh.config.source?.productRepos || [])
                .concat(options.productRepos || [])
                .filter(Boolean);
            resolverInstance = options.changeResolver || new ChangeResolver({
                repos,
                repoPrefix: activeMesh.config.source?.repoPrefix,
            });
        }
        return resolverInstance;
    }

    /** Existing Playwright specs that already exercise a feature, so callers see rerun-vs-gap. */
    function existingCoverage(featureName) {
        const specsDir = path.join(PROJECT_ROOT, 'tests', 'specs');
        const terms = String(featureName || '').toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        const matches = [];
        const walk = (dir) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.spec.js')) {
                    const rel = path.relative(specsDir, full).replace(/\\/g, '/');
                    const haystack = rel.toLowerCase();
                    if (terms.some((term) => haystack.includes(term))) matches.push(rel);
                }
            }
        };
        walk(specsDir);
        return {
            verdict: matches.length > 0 ? 'RERUN' : 'GAP',
            specs: matches.slice(0, 5),
        };
    }

    async function resolveChangedPaths(args) {
        if (Array.isArray(args.changedPaths) && args.changedPaths.length > 0) {
            return { changedPaths: args.changedPaths, prs: [], degraded: false, reason: null };
        }
        if (!args.ticketId) {
            return { changedPaths: [], prs: [], degraded: true, reason: 'Provide either ticketId or changedPaths.' };
        }
        const resolved = await changeResolver().resolveTicketChange(args.ticketId, {});
        return {
            changedPaths: resolved.changedPaths,
            prs: resolved.prs,
            degraded: resolved.degraded,
            reason: resolved.reason,
        };
    }

    async function getRegressionImpact(args = {}) {
        const change = await resolveChangedPaths(args);
        if (change.changedPaths.length === 0) {
            return boundResponse({
                success: false,
                error: change.reason || 'No changed files could be resolved for this request.',
                degraded: true,
                remediation: 'Pass changedPaths explicitly, or verify the ticket has a pull request and GITHUB_TOKEN is set.',
            }, { maxChars: DEFAULT_LIMITS.searchMaxChars, resolution: 'L2' });
        }

        const result = liveTrace().trace({
            changedPaths: change.changedPaths,
            depth: clamp(args.depth, 1, 2, 2),
            maxFeatures: clamp(args.maxFeatures, 1, 12, 8),
        });

        return boundResponse({
            ...result,
            ticketId: args.ticketId || null,
            pullRequests: change.prs.slice(0, 5),
            degraded: change.degraded,
            degradedReason: change.reason,
        }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
    }

    async function getRegressionScenarios(args = {}) {
        const impact = await getRegressionImpact({ ...args, maxFeatures: clamp(args.maxScenarios, 1, 8, 5) });
        if (impact.success === false) return impact;

        const activeMesh = ready();
        const maxRules = clamp(args.maxRulesPerFeature, 1, 5, 3);
        const scenarios = (impact.impactedFeatures || []).map((entry) => {
            let rules = [];
            try {
                rules = activeMesh.getRules(entry.feature, { maxRules }).map(compactRuleCard);
            } catch {
                rules = [];
            }
            return {
                feature: entry.feature,
                riskBand: entry.riskBand,
                directness: entry.directness,
                whyImpacted: entry.whyImpacted,
                evidenceFiles: entry.evidenceFiles,
                rulesAtRisk: rules,
                existingCoverage: existingCoverage(entry.feature),
            };
        });

        return boundResponse({
            success: true,
            ticketId: args.ticketId || null,
            primaryFeatures: impact.primaryFeatures,
            regressionScenarios: scenarios,
            breadth: impact.breadth,
            wideSymbolNote: impact.wideSymbolNote,
            unmappedUsages: impact.unmappedUsages,
            staleness: impact.staleness,
            degraded: impact.degraded,
            degradedReason: impact.degradedReason,
            guidance: 'Cover each primary feature, then add one regression case per listed feature and cite whyImpacted as the reason. Features with verdict GAP have no existing spec.',
            limitations: impact.limitations,
        }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
    }

    function getFeatureDomainPack(args = {}) {
        const pack = liveTrace().domainPack(args.feature);
        return boundResponse({
            success: pack.found !== false,
            ...pack,
            usage: 'Feed lexicon, routes, and selectors to the browser agent so page understanding is scored against this application rather than a generic archetype.',
        }, { maxChars: DEFAULT_LIMITS.behaviorMaxChars, resolution: 'L2' });
    }

    const tools = [
        {
            name: 'search_application_knowledge',
            description: 'Search local application service contracts and architecture relationships. Returns at most five compact results with evidence handles.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Feature, behavior, service, endpoint, Kafka topic, or Elastic index to find.' },
                    maxResults: { type: 'number', minimum: 1, maximum: DEFAULT_LIMITS.maxResults },
                },
                required: ['query'],
                additionalProperties: false,
            },
            handler: searchApplicationKnowledge,
        },
        {
            name: 'get_feature_behavior',
            description: 'Return bounded feature evidence. Set includeRules=true to retrieve at most five business-rule cards; pass ruleQuery to focus them or observations to compare Glass results by rule ID.',
            inputSchema: {
                type: 'object',
                properties: {
                    feature: { type: 'string' },
                    maxServices: { type: 'number', minimum: 1, maximum: 4 },
                    includeRules: { type: 'boolean' },
                    maxRules: { type: 'number', minimum: 1, maximum: 5 },
                    ruleQuery: { type: 'string', description: 'Optional focus such as "selection limit", "permission", or "persistence".' },
                    ruleTypes: {
                        type: 'array',
                        maxItems: 5,
                        items: { type: 'string', enum: ['behavior', 'guard', 'initial-state', 'limit', 'permission', 'persistence', 'responsive', 'side-effect', 'transition'] },
                    },
                    truthLanes: {
                        type: 'array',
                        maxItems: 3,
                        items: { type: 'string', enum: ['intended', 'implemented', 'observed'] },
                    },
                    observations: {
                        type: 'array',
                        maxItems: 10,
                        items: {
                            type: 'object',
                            properties: {
                                ruleId: { type: 'string' },
                                outcome: { type: 'string', enum: ['pass', 'fail', 'not-observed'] },
                                actual: { type: 'string', maxLength: 500 },
                            },
                            required: ['ruleId', 'outcome'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['feature'],
                additionalProperties: false,
            },
            handler: getFeatureBehavior,
        },
        {
            name: 'trace_feature_impact',
            description: 'Trace a feature through UI applications, services, endpoints, Kafka topics, Elastic indices, and models.',
            inputSchema: {
                type: 'object',
                properties: {
                    feature: { type: 'string' },
                    maxServices: { type: 'number', minimum: 1, maximum: 6 },
                },
                required: ['feature'],
                additionalProperties: false,
            },
            handler: traceFeatureImpact,
        },
        {
            name: 'get_source_evidence',
            description: 'Resolve a contract:* handle to a bounded service contract or a rule:* handle to exact bounded source/test line windows.',
            inputSchema: {
                type: 'object',
                properties: {
                    evidenceId: { type: 'string' },
                    resolution: { type: 'string', enum: ['L1', 'L2'] },
                    contextLines: { type: 'number', minimum: 0, maximum: 10 },
                },
                required: ['evidenceId'],
                additionalProperties: false,
            },
            handler: getSourceEvidence,
        },
        {
            name: 'get_knowledge_status',
            description: 'Return compact local index freshness, contract, graph, and capability status without dumping repository state.',
            inputSchema: {
                type: 'object',
                properties: { resolution: { type: 'string', enum: ['L2', 'L3'] } },
                additionalProperties: false,
            },
            handler: getKnowledgeStatus,
        },
        {
            name: 'get_regression_impact',
            description: 'Trace a ticket or a set of changed files to the already-shipped features they can break. Reads the local repository clones live, so results reflect the current clone rather than a prebuilt index. Reports staleness, wide (non-discriminating) symbols, and unmapped consumers instead of hiding them.',
            inputSchema: {
                type: 'object',
                properties: {
                    ticketId: { type: 'string', description: 'Jira key such as AOTF-18492. Resolved to its pull request to obtain changed files.' },
                    changedPaths: {
                        type: 'array',
                        maxItems: 40,
                        items: { type: 'string' },
                        description: 'Repository-prefixed paths (repo/dir/file.ts). Use when no pull request exists.',
                    },
                    depth: { type: 'number', minimum: 1, maximum: 2, description: '1 = direct consumers only, 2 = also follow re-exports and generated wrappers.' },
                    maxFeatures: { type: 'number', minimum: 1, maximum: 12 },
                },
                additionalProperties: false,
            },
            handler: getRegressionImpact,
        },
        {
            name: 'get_regression_scenarios',
            description: 'Return regression test scenarios for a change: the impacted features, why each is at risk, the business rules that could break, and whether a Playwright spec already covers it (RERUN) or not (GAP). Call this before writing test cases for a ticket.',
            inputSchema: {
                type: 'object',
                properties: {
                    ticketId: { type: 'string' },
                    changedPaths: { type: 'array', maxItems: 40, items: { type: 'string' } },
                    depth: { type: 'number', minimum: 1, maximum: 2 },
                    maxScenarios: { type: 'number', minimum: 1, maximum: 8 },
                    maxRulesPerFeature: { type: 'number', minimum: 1, maximum: 5 },
                },
                additionalProperties: false,
            },
            handler: getRegressionScenarios,
        },
        {
            name: 'get_feature_domain_pack',
            description: 'Return application-specific vocabulary for a feature: declared routes, component selectors, test ids, and terminology. Use it to ground a browser agent in this product instead of a generic page archetype.',
            inputSchema: {
                type: 'object',
                properties: {
                    feature: { type: 'string', description: 'Catalog feature name or alias, e.g. "Favorites" or "BCC".' },
                },
                required: ['feature'],
                additionalProperties: false,
            },
            handler: getFeatureDomainPack,
        },
    ];

    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    return {
        tools,
        call(name, args = {}) {
            const tool = toolMap.get(name);
            if (!tool) {
                return boundResponse({ success: false, error: `Unknown tool: ${truncateText(name, 100)}` }, {
                    maxChars: DEFAULT_LIMITS.searchMaxChars,
                    resolution: 'L3',
                });
            }
            const fail = (error) => boundResponse({ success: false, error: `${name} failed: ${error.message}` }, {
                maxChars: DEFAULT_LIMITS.searchMaxChars,
                resolution: 'L3',
            });
            try {
                const result = tool.handler(args);
                // Impact tools resolve pull requests over the network, so handlers may be async.
                return result instanceof Promise ? result.catch(fail) : result;
            } catch (error) {
                return fail(error);
            }
        },
    };
}

module.exports = {
    compactServiceCard,
    compactRuleCard,
    contractEvidenceId,
    createKnowledgeToolService,
    parseContractEvidenceId,
};