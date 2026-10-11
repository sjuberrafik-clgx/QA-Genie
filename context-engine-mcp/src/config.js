/**
 * Configuration for the Context Engine MCP server. No secrets: git authenticates
 * through the local credential manager.
 *
 * @module context-engine-mcp/config
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..');

function int(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function bool(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function resolveFrom(base, value) {
    return path.isAbsolute(value) ? value : path.join(base, value);
}

export function resolveConfig(env = process.env) {
    const registryPath = resolveFrom(PACKAGE_ROOT, env.CE_REGISTRY || 'config/repo-registry.json');
    if (!fs.existsSync(registryPath)) throw new Error(`repo registry not found at ${registryPath}`);
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (registry.access !== 'read-only') throw new Error('repo registry must declare "access": "read-only"');

    return {
        registryPath,
        registry,
        workspaceRoot: resolveFrom(PACKAGE_ROOT, env.CE_WORKSPACE_ROOT || WORKSPACE_ROOT),
        dataDir: resolveFrom(PACKAGE_ROOT, env.CE_DATA_DIR || 'data'),
        allowClone: bool(env.CE_ALLOW_CLONE, false),
        autoRebuild: bool(env.CE_AUTO_REBUILD, true),
        rebuildTimeoutMs: int(env.CE_REBUILD_TIMEOUT_MS, 300_000, 30_000, 1_800_000),
        maxReposPerRefresh: int(env.CE_MAX_REPOS_PER_REFRESH, 6, 1, 40),
        maxOutputChars: int(env.CE_MAX_OUTPUT_CHARS, 12_000, 2_000, 60_000),
    };
}
