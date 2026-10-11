#!/usr/bin/env node
/**
 * Context Engine CLI (GitHub access is read-only).
 *
 *   node scripts/cli.js registry
 *   node scripts/cli.js status  [--repo X ...] [--force]
 *   node scripts/cli.js refresh [--repo X ...] [--clone-missing] [--force] [--no-rebuild]
 *   node scripts/cli.js rebuild
 *   node scripts/cli.js coverage
 */

import path from 'node:path';
import { createContextEngine } from '../src/index.js';

function argValues(args, flag) {
    return args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
}

const short = (sha) => (sha ? sha.slice(0, 10) : '-');
const day = (iso) => (iso ? iso.slice(0, 10) : '');

function summary(rows) {
    const counts = rows.reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] || 0) + 1 }), {});
    console.log(`Summary: ${JSON.stringify(counts)}`);
}

function printKnowledge(k) {
    if (!k) return;
    if (!k.ran) return console.log(`Knowledge: not rebuilt (${k.reason})`);
    console.log(k.ok
        ? `Knowledge: rebuilt in ${(k.durationMs / 1000).toFixed(1)}s · ${k.contracts?.services} services · ${k.rules?.rules} rules / ${k.rules?.features} features`
        : `Knowledge: rebuild FAILED · ${k.error}`);
}

function printCoverage(c) {
    if (!c) return;
    if (c.error) return console.log(`Coverage: ${c.error}`);
    console.log(`Coverage: ${c.covered} covered · ${c.partial} partial · ${c.uncovered.length} uncovered of ${c.folders} feature folders (${c.catalogFeatures} catalog features)`);
    if (c.newFeatureCandidates.length) {
        console.log('New feature folders not in the catalog:');
        console.table(c.newFeatureCandidates.map((f) => ({ app: f.app, folder: f.folder, files: f.files, firstSeen: day(f.firstSeenAt) })));
    }
}

async function main() {
    const [cmd = 'status', ...args] = process.argv.slice(2);
    const { config, freshness, pipeline } = createContextEngine(process.env);
    const names = argValues(args, '--repo');

    if (cmd === 'registry') {
        console.table(freshness.repos().map((r) => ({
            repo: r.name, system: r.system, group: r.group, present: freshness.isPresent(r),
            localPath: path.relative(config.workspaceRoot, r.localPath),
        })));
        return;
    }
    if (cmd === 'status') {
        const rows = await freshness.check({ names, force: args.includes('--force') });
        console.table(rows.map((r) => ({
            repo: r.name, state: r.state, ref: r.ref || '-', source: r.refSource || '-', remote: short(r.remoteSha),
            local: short(r.localSha), committed: day(r.committedAt), cached: r.cached || false, error: r.error || '',
        })));
        summary(rows);
        const k = freshness.knowledgeState();
        return console.log(`Knowledge: ${k.stale ? 'STALE — run rebuild' : 'current'} (last rebuild ${k.lastRebuild?.at || 'never'})`);
    }
    if (cmd === 'refresh') {
        const rows = await freshness.refresh({ names, cloneMissing: args.includes('--clone-missing'), force: args.includes('--force') });
        console.table(rows.map((r) => ({
            repo: r.name, action: r.action || '-', state: r.state, ref: r.ref || '-', to: short(r.localSha),
            committed: day(r.committedAt), added: r.counts?.added ?? '', modified: r.counts?.modified ?? '',
            deleted: r.counts?.deleted ?? '', error: r.error || '',
        })));
        summary(rows);
        if (args.includes('--no-rebuild')) return;
        const after = await pipeline.afterRefresh(rows);
        printKnowledge(after.knowledge);
        return printCoverage(after.coverage);
    }
    if (cmd === 'rebuild') {
        const knowledge = await pipeline.rebuildNow(['cli']);
        printKnowledge(knowledge);
        return printCoverage(knowledge.ok ? pipeline.scanCoverage() : undefined);
    }
    if (cmd === 'coverage') {
        const c = pipeline.scanCoverage();
        printCoverage(c);
        if (!c.error && c.uncovered.length) {
            console.log('Uncovered feature folders:');
            console.table(c.uncovered.map((f) => ({ app: f.app, folder: f.folder, files: f.files })));
        }
        return;
    }
    console.error(`Unknown command "${cmd}". Use: registry | status | refresh | rebuild | coverage`);
    process.exitCode = 1;
}

main().catch((err) => {
    console.error(`context-engine: ${err.message}`);
    process.exitCode = 1;
});
