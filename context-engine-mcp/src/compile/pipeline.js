/**
 * After-refresh pipeline: recompile knowledge when a repo that feeds it changed, then
 * re-scan feature coverage so newly shipped features are flagged.
 *
 * @module context-engine-mcp/compile/pipeline
 */

import path from 'node:path';
import { acquireLock } from '../store/json-store.js';
import { featureCoverage } from './feature-coverage.js';
import { rebuildKnowledge } from './knowledge-rebuild.js';

const CHANGED = new Set(['updated', 'cloned']);

export function createPipeline({ config, freshness, rebuild = rebuildKnowledge, coverage = featureCoverage }) {
    const compiles = new Set(freshness.repos().filter((r) => r.compiles).map((r) => r.name));

    function scanCoverage() {
        try {
            return coverage({ workspaceRoot: config.workspaceRoot, dataDir: config.dataDir });
        } catch (err) {
            return { error: err.message };
        }
    }

    async function rebuildNow(trigger) {
        let release;
        try {
            release = acquireLock(path.join(config.dataDir, '.rebuild.lock'), { staleMs: config.rebuildTimeoutMs * 2 });
        } catch (err) {
            return { ran: false, reason: err.message };
        }
        try {
            const result = await rebuild({ workspaceRoot: config.workspaceRoot, timeoutMs: config.rebuildTimeoutMs });
            freshness.recordKnowledge({
                ok: result.ok, durationMs: result.durationMs, trigger,
                contracts: result.contracts || null, rules: result.rules || null, error: result.error || null,
            });
            return { ran: true, ...result };
        } finally {
            release();
        }
    }

    /** Rebuild only when a compiled repo actually moved; always report coverage after a rebuild. */
    async function afterRefresh(results) {
        const changed = results.filter((r) => CHANGED.has(r.action) && compiles.has(r.name)).map((r) => r.name);
        if (!changed.length) return { knowledge: { ran: false, reason: 'no repo that feeds the knowledge base changed' } };
        if (!config.autoRebuild) return { knowledge: { ran: false, reason: 'CE_AUTO_REBUILD=false', staleRepos: changed } };
        const knowledge = await rebuildNow(changed);
        return { knowledge, coverage: knowledge.ok ? scanCoverage() : undefined };
    }

    return { afterRefresh, rebuildNow, scanCoverage };
}
