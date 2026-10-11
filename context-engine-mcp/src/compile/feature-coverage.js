/**
 * Feature coverage: compares feature folders in the frontend clone with the curated
 * feature catalog, and remembers which folders existed at the last scan so newly
 * shipped features are surfaced for cataloguing.
 *
 * @module context-engine-mcp/compile/feature-coverage
 */

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../store/json-store.js';

const FRONTEND_REPO = 'aotf-frontend_apps';
const APPS = ['onehome', 'agent-portal'];

export function prefixToRegExp(prefix) {
    const body = prefix.split('/').map((seg) => (seg === '*' ? '[^/]+' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('/');
    return new RegExp(`^${body}(?:/|$)`);
}

function countFiles(dir, limit = 5000) {
    let count = 0;
    const stack = [dir];
    while (stack.length && count < limit) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (e.isDirectory()) stack.push(path.join(current, e.name));
            else count++;
        }
    }
    return count;
}

/** Top-level feature folders under projects/<app>/src/app, skipping shared infrastructure (_@core, _@shared, ...). */
export function listFeatureFolders(frontendRoot) {
    const folders = [];
    for (const app of APPS) {
        const appDir = path.join(frontendRoot, 'projects', app, 'src', 'app');
        let entries = [];
        try {
            entries = fs.readdirSync(appDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
            folders.push({
                app,
                folder: e.name,
                path: `${FRONTEND_REPO}/projects/${app}/src/app/${e.name}`,
                files: countFiles(path.join(appDir, e.name)),
            });
        }
    }
    return folders;
}

export function classifyCoverage(folders, catalog) {
    const prefixes = (catalog?.features || []).flatMap((f) => (f.pathPrefixes || []).map((p) => ({ feature: f.name, prefix: p, re: prefixToRegExp(p) })));
    return folders.map((f) => {
        const exact = prefixes.find((p) => p.re.test(f.path));
        if (exact) return { ...f, coverage: 'covered', feature: exact.feature };
        // A catalog prefix deeper inside the folder (e.g. property/notes) covers only part of it.
        const depth = f.path.split('/').length;
        const inner = prefixes.find((p) => {
            const segs = p.prefix.split('/');
            return segs.length > depth && prefixToRegExp(segs.slice(0, depth).join('/')).test(f.path);
        });
        return inner ? { ...f, coverage: 'partial', feature: inner.feature } : { ...f, coverage: 'uncovered', feature: null };
    });
}

/**
 * Scan, classify, and remember when each folder was first seen. Folders that appear after
 * the first (baseline) scan and are not yet catalogued are reported as new feature candidates
 * until a catalog pathPrefix covers them.
 */
export function featureCoverage({ workspaceRoot, dataDir, now = () => Date.now(), persist = true }) {
    const frontendRoot = path.join(workspaceRoot, 'agentic-workflow', 'repo-mesh-data', 'frontend', FRONTEND_REPO);
    const catalog = readJson(path.join(workspaceRoot, 'agentic-workflow', 'config', 'feature-catalog.json'), { features: [] });
    const classified = classifyCoverage(listFeatureFolders(frontendRoot), catalog);

    const snapshotPath = path.join(dataDir, 'feature-folders.json');
    const previous = readJson(snapshotPath, null);
    const at = new Date(now()).toISOString();
    const baselineAt = previous?.baselineAt || at;
    const seen = previous?.folders || {};
    const firstSeen = Object.fromEntries(classified.map((f) => [f.path, seen[f.path] || at]));
    if (persist) writeJsonAtomic(snapshotPath, { baselineAt, scannedAt: at, folders: firstSeen });

    const uncovered = classified.filter((f) => f.coverage === 'uncovered').map((f) => ({ ...f, firstSeenAt: firstSeen[f.path] }));
    return {
        catalogFeatures: (catalog.features || []).length,
        folders: classified.length,
        covered: classified.filter((f) => f.coverage === 'covered').length,
        partial: classified.filter((f) => f.coverage === 'partial').length,
        baselineAt,
        uncovered,
        newFeatureCandidates: uncovered.filter((f) => f.firstSeenAt > baselineAt),
    };
}
