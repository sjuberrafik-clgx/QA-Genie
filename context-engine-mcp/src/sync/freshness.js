/**
 * Freshness: keeps local clones on the UAT ref of each registered repo and records
 * which files changed. GitHub is only read, through the read-only git guard.
 *
 * @module context-engine-mcp/sync/freshness
 */

import fs from 'node:fs';
import path from 'node:path';
import { disablePush, runGit } from './read-only-git.js';
import { acquireLock, appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../store/json-store.js';

const RELEASE_RE = /^release\/(\d+)\.(\d+)(?:\.(\d+))?$/;
const MAX_DELTA_PATHS = 1000;

export function parseLsRemote(stdout) {
    const out = { defaultBranch: null, headSha: null, heads: {} };
    for (const line of String(stdout).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const sym = t.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
        if (sym) { out.defaultBranch = sym[1]; continue; }
        const [sha, ref] = t.split(/\s+/);
        if (ref === 'HEAD') out.headSha = sha;
        else if (ref && ref.startsWith('refs/heads/')) out.heads[ref.slice(11)] = sha;
    }
    return out;
}

function compareRelease(a, b) {
    const pa = a.match(RELEASE_RE).slice(1).map((n) => Number(n || 0));
    const pb = b.match(RELEASE_RE).slice(1).map((n) => Number(n || 0));
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
    return 0;
}

export function pickUatRef(remote, pinned) {
    if (pinned) {
        if (!remote.heads[pinned]) throw new Error(`pinned uatRef "${pinned}" not found on remote`);
        return { ref: pinned, sha: remote.heads[pinned], refSource: 'pinned' };
    }
    const releases = Object.keys(remote.heads).filter((b) => RELEASE_RE.test(b)).sort(compareRelease);
    if (releases.length) return { ref: releases[0], sha: remote.heads[releases[0]], refSource: 'latest-release' };
    if (!remote.defaultBranch || !remote.headSha) throw new Error('remote default branch could not be resolved');
    return { ref: remote.defaultBranch, sha: remote.headSha, refSource: 'default-branch' };
}

export function parseNameStatus(stdout) {
    const counts = { added: 0, modified: 0, deleted: 0 };
    const files = [];
    for (const line of String(stdout).split('\n')) {
        const [status, file] = line.split('\t');
        if (!file) continue;
        const key = status[0] === 'A' ? 'added' : status[0] === 'D' ? 'deleted' : 'modified';
        counts[key]++;
        if (files.length < MAX_DELTA_PATHS) files.push({ s: status[0], p: file });
    }
    return { counts, files, truncated: counts.added + counts.modified + counts.deleted > files.length };
}

async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

export class ContextFreshness {
    /**
     * @param {Object} opts
     * @param {Object} opts.registry       parsed repo-registry.json
     * @param {string} opts.workspaceRoot  base for registry group dirs
     * @param {string} opts.dataDir        manifest, change logs, lock
     * @param {Function} [opts.git]        git runner (must enforce the read-only guard)
     * @param {Function} [opts.now]
     */
    constructor({ registry, workspaceRoot, dataDir, git = runGit, now = () => Date.now() }) {
        this.registry = registry;
        this.workspaceRoot = workspaceRoot;
        this.dataDir = dataDir;
        this.git = git;
        this.now = now;
        this.manifestPath = path.join(dataDir, 'manifest.json');
        this.lockPath = path.join(dataDir, '.writer.lock');
        this.ttlMs = (registry.checkTtlMinutes || 30) * 60 * 1000;
    }

    repos(names) {
        const all = this.registry.repos.map((r) => this.describe(r));
        if (!names || !names.length) return all;
        const wanted = new Set(names.map((n) => String(n).replace(this.registry.prefix, '')));
        const picked = all.filter((r) => wanted.has(r.name));
        const unknown = [...wanted].filter((n) => !picked.some((r) => r.name === n));
        if (unknown.length) throw new Error(`unknown repo(s): ${unknown.join(', ')}`);
        return picked;
    }

    describe(entry) {
        const group = this.registry.groups[entry.group];
        if (!group) throw new Error(`repo ${entry.name}: unknown group "${entry.group}"`);
        const fullName = `${this.registry.org}/${this.registry.prefix}${entry.name}`;
        return {
            name: entry.name,
            fullName,
            url: `https://github.com/${fullName}.git`,
            localPath: path.join(this.workspaceRoot, group.dir, entry.name),
            group: entry.group,
            compiles: Boolean(group.compiles),
            system: entry.system,
            uatRef: entry.uatRef || null,
        };
    }

    manifest() {
        return readJson(this.manifestPath, { version: '1.0.0', environment: this.registry.environment, repos: {} });
    }

    isPresent(repo) {
        return fs.existsSync(path.join(repo.localPath, '.git'));
    }

    async localSha(repo) {
        if (!this.isPresent(repo)) return null;
        try {
            return (await this.git(['rev-parse', 'HEAD'], { cwd: repo.localPath })).trim();
        } catch {
            return null;
        }
    }

    async resolveRemote(repo) {
        const patterns = ['HEAD', 'refs/heads/release/*'];
        if (repo.uatRef && !repo.uatRef.startsWith('release/')) patterns.push(`refs/heads/${repo.uatRef}`);
        const stdout = await this.git(['ls-remote', '--symref', repo.url, ...patterns], { timeout: 60_000 });
        return pickUatRef(parseLsRemote(stdout), repo.uatRef);
    }

    /** Compare each repo's local checkout with its remote UAT ref. Writes only local manifest state. */
    async check(opts = {}) {
        let release = null;
        try {
            release = acquireLock(this.lockPath);
        } catch {
            // Another writer is active: still report, just don't persist.
        }
        try {
            const manifest = this.manifest();
            const results = await this._check(manifest, opts);
            if (release) this._save(manifest);
            return results;
        } finally {
            if (release) release();
        }
    }

    async _check(manifest, { names, force = false, concurrency = 6 } = {}) {
        const now = this.now();
        return pool(this.repos(names), concurrency, async (repo) => {
            const prev = manifest.repos[repo.name] || {};
            const cached = !force && prev.remoteSha && prev.lastCheckedAt
                && now - Date.parse(prev.lastCheckedAt) < this.ttlMs && (prev.pinned || null) === repo.uatRef;
            let remote;
            try {
                remote = cached
                    ? { ref: prev.ref, sha: prev.remoteSha, refSource: prev.refSource }
                    : await this.resolveRemote(repo);
            } catch (err) {
                return { name: repo.name, state: 'error', error: err.message, present: this.isPresent(repo) };
            }
            const localSha = await this.localSha(repo);
            const state = !localSha ? 'missing' : localSha === remote.sha ? 'fresh' : 'stale';
            if (!cached) {
                manifest.repos[repo.name] = {
                    ...prev, fullName: repo.fullName, system: repo.system, ref: remote.ref, refSource: remote.refSource,
                    pinned: repo.uatRef, remoteSha: remote.sha, lastCheckedAt: new Date(now).toISOString(),
                };
            }
            return {
                name: repo.name, system: repo.system, state, cached: Boolean(cached), ref: remote.ref,
                refSource: remote.refSource, remoteSha: remote.sha, localSha, committedAt: prev.committedAt || null,
            };
        });
    }

    /** Bring stale (and optionally missing) clones to their remote UAT ref and record the file delta. */
    async refresh({ names, cloneMissing = false, force = false, concurrency = 3 } = {}) {
        const release = acquireLock(this.lockPath);
        try {
            const manifest = this.manifest();
            const checked = await this._check(manifest, { names, force });
            const byName = new Map(this.repos(names).map((r) => [r.name, r]));
            const results = await pool(checked, concurrency, async (c) => {
                if (c.state === 'error') return c;
                const repo = byName.get(c.name);
                if (c.state === 'fresh' && !force) {
                    // Clones made outside this engine (e.g. Repo Mesh) still need the push lock.
                    await disablePush(repo.localPath, this.git).catch(() => {});
                    return { ...c, action: 'none' };
                }
                if (c.state === 'missing' && !cloneMissing) return { ...c, action: 'skipped-missing' };
                try {
                    const delta = await this._syncRepo(repo, c);
                    const at = new Date(this.now()).toISOString();
                    const committedAt = await this._committedAt(repo);
                    manifest.repos[c.name] = {
                        ...manifest.repos[c.name], syncedSha: delta.to, lastSyncedAt: at, committedAt,
                        lastDelta: { from: delta.from, to: delta.to, fullIndex: delta.fullIndex, ...delta.counts },
                    };
                    if (delta.from !== delta.to) {
                        appendJsonl(this._changesPath(c.name), {
                            at, ref: c.ref, from: delta.from, to: delta.to, fullIndex: delta.fullIndex,
                            counts: delta.counts, truncated: delta.truncated, files: delta.files,
                        });
                    }
                    return { ...c, state: 'fresh', action: delta.action, localSha: delta.to, committedAt, counts: delta.counts, fullIndex: delta.fullIndex };
                } catch (err) {
                    return { ...c, state: 'error', error: err.message };
                }
            });
            this._save(manifest);
            return results;
        } finally {
            release();
        }
    }

    /** Recorded file deltas for one repo, newest first, optionally filtered by path prefix. */
    changes(name, { pathPrefix = '', limit = 3, maxFiles = 50 } = {}) {
        const [repo] = this.repos([name]);
        const prefix = String(pathPrefix).replace(/\\/g, '/').replace(/^\/+/, '');
        return readJsonl(this._changesPath(repo.name)).reverse().slice(0, limit).map((rec) => {
            const files = prefix ? rec.files.filter((f) => f.p.startsWith(prefix)) : rec.files;
            return {
                at: rec.at, ref: rec.ref, from: rec.from, to: rec.to, fullIndex: rec.fullIndex, counts: rec.counts,
                matched: files.length, files: files.slice(0, maxFiles),
                truncated: rec.truncated || files.length > maxFiles,
            };
        });
    }

    /** Whether compiled knowledge is older than the newest sync of a repo that feeds it. */
    knowledgeState() {
        const manifest = this.manifest();
        const lastSync = this.repos().filter((r) => r.compiles)
            .map((r) => manifest.repos[r.name]?.lastSyncedAt).filter(Boolean).sort().at(-1) || null;
        const last = manifest.knowledge || null;
        return {
            stale: Boolean(lastSync && (!last?.ok || !last.at || last.at < lastSync)),
            lastCompiledRepoSyncAt: lastSync,
            lastRebuild: last,
        };
    }

    recordKnowledge(info) {
        const release = acquireLock(this.lockPath);
        try {
            const manifest = this.manifest();
            manifest.knowledge = { at: new Date(this.now()).toISOString(), ...info };
            this._save(manifest);
        } finally {
            release();
        }
    }

    async _syncRepo(repo, c) {
        const empty = { counts: { added: 0, modified: 0, deleted: 0 }, files: [], truncated: false };
        if (!this.isPresent(repo)) {
            fs.mkdirSync(path.dirname(repo.localPath), { recursive: true });
            await this.git(['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', c.ref, repo.url, repo.localPath]);
            await disablePush(repo.localPath, this.git);
            const to = (await this.git(['rev-parse', 'HEAD'], { cwd: repo.localPath })).trim();
            return { action: 'cloned', from: null, to, fullIndex: true, ...empty };
        }
        await disablePush(repo.localPath, this.git);
        const from = c.localSha;
        await this.git(['fetch', '--depth', '1', '--no-tags', 'origin', `refs/heads/${c.ref}`], { cwd: repo.localPath });
        const to = (await this.git(['rev-parse', 'FETCH_HEAD'], { cwd: repo.localPath })).trim();
        if (to === from) return { action: 'none', from, to, fullIndex: false, ...empty };
        await this.git(['checkout', '--detach', '--force', 'FETCH_HEAD'], { cwd: repo.localPath });
        try {
            const diff = await this.git(['diff', '--name-status', '--no-renames', from, to], { cwd: repo.localPath });
            return { action: 'updated', from, to, fullIndex: false, ...parseNameStatus(diff) };
        } catch {
            return { action: 'updated', from, to, fullIndex: true, ...empty };
        }
    }

    async _committedAt(repo) {
        try {
            return (await this.git(['log', '-1', '--format=%cI', 'HEAD'], { cwd: repo.localPath })).trim() || null;
        } catch {
            return null;
        }
    }

    _changesPath(name) {
        return path.join(this.dataDir, 'changes', `${name}.jsonl`);
    }

    _save(manifest) {
        manifest.environment = this.registry.environment;
        manifest.updatedAt = new Date(this.now()).toISOString();
        writeJsonAtomic(this.manifestPath, manifest);
    }
}
