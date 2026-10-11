/**
 * Knowledge tools: explicit recompile and feature-catalog coverage.
 *
 * @module context-engine-mcp/tools/knowledge
 */

export function knowledgeTools({ config, freshness, pipeline }) {
    return [
        {
            name: 'ce_rebuild_knowledge',
            title: 'Context Engine · rebuild knowledge',
            description: 'Recompile application knowledge (service contracts, feature graph, business rules) from the local clones, then re-scan feature coverage. Local only: no git and no network. ce_refresh_repos already does this automatically when code changes; call this after editing the feature catalog or if a previous rebuild failed. The application-kb server picks up the result on its next call.',
            inputSchema: { type: 'object', additionalProperties: false, properties: {} },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            handler: async () => {
                const knowledge = await pipeline.rebuildNow(['manual']);
                const coverage = knowledge.ok ? pipeline.scanCoverage() : undefined;
                return {
                    knowledge,
                    ...(coverage ? { newFeatureCandidates: coverage.newFeatureCandidates ?? [], coverageError: coverage.error } : {}),
                };
            },
        },
        {
            name: 'ce_feature_coverage',
            title: 'Context Engine · feature coverage',
            description: 'Compare feature folders in the OneHome and Agent Portal code with the curated feature catalog (agentic-workflow/config/feature-catalog.json). newFeatureCandidates are folders that appeared after the baseline scan and are not catalogued yet; add a catalog entry with pathPrefixes so impact analysis can name them.',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    onlyNew: { type: 'boolean', description: 'Return only new feature candidates.' },
                    maxItems: { type: 'integer', minimum: 1, maximum: 100 },
                },
            },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            handler: async ({ onlyNew = false, maxItems = 40 }) => {
                const c = pipeline.scanCoverage();
                if (c.error) return { ok: false, code: 'CE_COVERAGE_FAILED', error: c.error };
                const slim = (f) => ({ app: f.app, folder: f.folder, path: f.path, files: f.files, firstSeenAt: f.firstSeenAt });
                return {
                    catalogFeatures: c.catalogFeatures,
                    folders: c.folders,
                    covered: c.covered,
                    partial: c.partial,
                    baselineAt: c.baselineAt,
                    newFeatureCandidates: c.newFeatureCandidates.slice(0, maxItems).map(slim),
                    ...(onlyNew ? {} : { uncovered: c.uncovered.slice(0, maxItems).map(slim), uncoveredTotal: c.uncovered.length }),
                    knowledge: freshness.knowledgeState(),
                };
            },
        },
    ];
}
