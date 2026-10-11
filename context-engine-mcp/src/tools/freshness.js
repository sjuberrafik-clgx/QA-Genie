/**
 * Freshness tools: repo status against the UAT ref, read-only refresh, and recorded deltas.
 *
 * @module context-engine-mcp/tools/freshness
 */

import { ContextEngineError, short } from '../util/result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function summarize(rows) {
    return rows.reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] || 0) + 1 }), {});
}

function row(r) {
    return {
        repo: r.name, system: r.system, state: r.state, ref: r.ref || null, refSource: r.refSource || null,
        remote: short(r.remoteSha), local: short(r.localSha), committedAt: r.committedAt || null,
        ...(r.action ? { action: r.action } : {}),
        ...(r.counts ? { delta: r.counts, fullIndex: r.fullIndex } : {}),
        ...(r.error ? { error: r.error } : {}),
    };
}

export function freshnessTools({ freshness, config, pipeline }) {
    const repoNames = freshness.repos().map((r) => r.name);
    const errorHint = 'state "error" mentioning an IP allow list means the Appgate VPN is not connected.';

    return [
        {
            name: 'ce_repo_status',
            title: 'Context Engine · repo freshness',
            description: `Compare local clones with each repo's UAT ref (newest release/X.Y.Z, else default branch) using read-only git ls-remote. Results are cached for ${config.registry.checkTtlMinutes || 30} minutes unless force=true. Known repos: ${repoNames.join(', ')}. ${errorHint}`,
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    repos: { type: 'array', items: { type: 'string' }, maxItems: 40, description: 'Repo base names (omit for all).' },
                    force: { type: 'boolean', description: 'Bypass the TTL cache.' },
                    onlyNotFresh: { type: 'boolean', description: 'Return only stale, missing or errored repos.' },
                },
            },
            annotations: READ_ONLY,
            handler: async ({ repos, force = false, onlyNotFresh = false }) => {
                const results = await freshness.check({ names: repos, force });
                const rows = results.map(row);
                return {
                    environment: config.registry.environment,
                    summary: summarize(rows),
                    knowledge: freshness.knowledgeState(),
                    repos: onlyNotFresh ? rows.filter((r) => r.state !== 'fresh') : rows,
                };
            },
        },
        {
            name: 'ce_refresh_repos',
            title: 'Context Engine · refresh repos (read-only fetch)',
            description: `Fetch the UAT ref for the named repos and move the local clone to it, recording which files changed. Only stale repos are fetched. When a repo that feeds the knowledge base changes, the knowledge (contracts, feature graph, business rules) is recompiled automatically and new, uncatalogued feature folders are reported. GitHub is never written to: only ls-remote/fetch/clone run, and push is disabled in every clone. At most ${config.maxReposPerRefresh} repos per call. Cloning missing repos ${config.allowClone ? 'is allowed' : 'is disabled (CE_ALLOW_CLONE=false); use the CLI'}.`,
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['repos'],
                properties: {
                    repos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: config.maxReposPerRefresh },
                    cloneMissing: { type: 'boolean' },
                    force: { type: 'boolean', description: 'Re-check the remote even within the TTL.' },
                },
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
            handler: async ({ repos, cloneMissing = false, force = false }) => {
                if (cloneMissing && !config.allowClone) {
                    throw new ContextEngineError('CE_CLONE_DISABLED', 'Cloning missing repos is disabled for MCP calls.', {
                        fix: 'Run "npm run refresh -- --repo <name> --clone-missing" in context-engine-mcp/, or set CE_ALLOW_CLONE=true.',
                    });
                }
                const results = await freshness.refresh({ names: repos, cloneMissing, force });
                const rows = results.map(row);
                const after = await pipeline.afterRefresh(results);
                return {
                    environment: config.registry.environment,
                    summary: summarize(rows),
                    repos: rows,
                    knowledge: after.knowledge,
                    ...(after.coverage ? { newFeatureCandidates: after.coverage.newFeatureCandidates ?? [], coverageError: after.coverage.error } : {}),
                };
            },
        },
        {
            name: 'ce_get_changes',
            title: 'Context Engine · recorded changes',
            description: 'Files that changed in a repo across recent refreshes (newest first), optionally filtered by a path prefix such as "projects/onehome/src/app/favorites". Bounded output; use pathPrefix to focus on the feature under test.',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['repo'],
                properties: {
                    repo: { type: 'string', maxLength: 120 },
                    pathPrefix: { type: 'string', maxLength: 300 },
                    limit: { type: 'integer', minimum: 1, maximum: 10 },
                    maxFiles: { type: 'integer', minimum: 1, maximum: 200 },
                },
            },
            annotations: { ...READ_ONLY, openWorldHint: false },
            handler: async ({ repo, pathPrefix, limit = 3, maxFiles = 50 }) => {
                const records = freshness.changes(repo, { pathPrefix, limit, maxFiles });
                return {
                    repo,
                    pathPrefix: pathPrefix || null,
                    records,
                    note: records.length ? undefined : 'No recorded refreshes yet. Run ce_refresh_repos first.',
                };
            },
        },
    ];
}
