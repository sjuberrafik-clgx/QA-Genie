/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPO SYNC MANAGER — Multi-Repo Fetch + Semantic Delta Detection
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Part of the Federated Contract Mesh (FCM). Responsible for getting backend
 * microservice source onto disk and telling the rest of the mesh WHICH files
 * actually changed since the last sync — so contract extraction only ever
 * processes deltas, never the whole world.
 *
 * Two fetch strategies (config.fetchMethod):
 *   • partial-clone (default) — git shallow clone (--depth 1 --filter=blob:none).
 *     Full fidelity on disk, cheapest local reads. Falls back to API if git is
 *     unavailable.
 *   • api — GitHub Git Trees + Contents API. No git binary required; materializes
 *     only the matching files to disk.
 *
 * Change detection is done via the GitHub Compare API (base...head), which returns
 * the changed-file list WITHOUT needing local history — so a --depth 1 clone is
 * enough. Per-repo HEAD SHA is persisted in sync-state.json; an unchanged HEAD
 * means zero work for that repo.
 *
 * No secrets are ever logged. The PAT is injected into the clone URL at runtime
 * and redacted from all output.
 *
 * @module repo-mesh/repo-sync-manager
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let axios;
try {
    axios = require('axios');
} catch {
    axios = null;
}

const GITHUB_API = 'https://api.github.com';

// ─── Small glob → RegExp (supports **, *, ?) ────────────────────────────────

function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i++;
                if (glob[i + 1] === '/') i++; // consume trailing slash of **/
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else if ('.+^${}()|[]\\'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp('^' + re + '$', 'i');
}

function matchesAny(relPath, patterns) {
    const normalized = relPath.replace(/\\/g, '/');
    return patterns.some((p) => globToRegExp(p).test(normalized));
}

// ─── RepoSyncManager ────────────────────────────────────────────────────────

class RepoSyncManager {
    /**
     * @param {Object} config
     * @param {string} config.org              GitHub org (e.g. 'corelogic-private')
     * @param {string} [config.token]          GitHub PAT (defaults to env GITHUB_TOKEN)
     * @param {string} [config.query]          Repo name filter (e.g. 'aotf')
     * @param {string} [config.branch]         Default branch (e.g. 'main')
     * @param {string} [config.cloneDir]       Where to materialize repos
     * @param {string} [config.statePath]      Where to persist sync state
     * @param {string} [config.fetchMethod]    'partial-clone' | 'api'
     * @param {string[]} [config.include]      Glob include patterns
     * @param {string[]} [config.exclude]      Glob exclude patterns
     * @param {Object[]} [config.repos]        Explicit repo list (skips discovery)
     * @param {number} [config.concurrency]    Max parallel repo syncs
     * @param {boolean} [config.verbose]
     */
    constructor(config = {}) {
        this.org = config.org || process.env.GITHUB_ORG || '';
        this.token = config.token || process.env.GITHUB_TOKEN || '';
        this.query = config.query || process.env.REPO_MESH_QUERY || '';
        this.branch = config.branch || process.env.REPO_MESH_BRANCH || 'main';
        this.fetchMethod = config.fetchMethod || 'partial-clone';
        this.include = config.include && config.include.length
            ? config.include
            : ['**/*.java', '**/application*.yml', '**/application*.yaml', '**/application*.properties'];
        this.exclude = config.exclude || ['**/test/**', '**/target/**', '**/*Test.java', '**/*IT.java'];
        this.explicitRepos = config.repos || [];
        this.concurrency = config.concurrency || 4;
        this.verbose = config.verbose || false;

        const dataDir = path.resolve(__dirname, '..', 'repo-mesh-data');
        this.cloneDir = config.cloneDir
            ? path.resolve(config.cloneDir)
            : path.join(dataDir, 'repos');
        this.statePath = config.statePath
            ? path.resolve(config.statePath)
            : path.join(dataDir, 'sync-state.json');

        this._state = this._loadState();
        this._gitChecked = false;
        this._gitAvailable = null;
    }

    // ─── State persistence ──────────────────────────────────────────

    _loadState() {
        try {
            if (fs.existsSync(this.statePath)) {
                return JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
            }
        } catch (err) {
            this._log(`⚠ Could not read sync-state.json: ${err.message}`);
        }
        return { version: '1.0.0', repos: {} };
    }

    _saveState() {
        const dir = path.dirname(this.statePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.statePath, JSON.stringify(this._state, null, 2));
    }

    getState() {
        return this._state;
    }

    // ─── Discovery ──────────────────────────────────────────────────

    /**
     * List repos in the org matching the configured query.
     * Uses explicit config.repos if provided.
     * @returns {Promise<Array<{name,fullName,cloneUrl,defaultBranch}>>}
     */
    async discoverRepos() {
        if (this.explicitRepos.length > 0) {
            return this.explicitRepos.map((r) => this._normalizeRepo(r));
        }
        if (!this.org) throw new Error('repoMesh.source.org (or GITHUB_ORG) is required for discovery');
        this._requireAxios();

        const repos = [];
        let page = 1;
        // List all org repos, then filter by query locally (search API is rate-limited).
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { data } = await this._api(`/orgs/${this.org}/repos`, {
                params: { per_page: 100, page, type: 'all', sort: 'full_name' },
            });
            if (!Array.isArray(data) || data.length === 0) break;
            for (const r of data) {
                if (this.query && !r.name.toLowerCase().includes(this.query.toLowerCase())) continue;
                if (r.archived) continue;
                repos.push(this._normalizeRepo(r));
            }
            if (data.length < 100) break;
            page++;
            if (page > 30) break; // hard safety cap (3000 repos)
        }
        this._log(`Discovered ${repos.length} repo(s) in ${this.org} matching "${this.query || '*'}"`);
        return repos;
    }

    _normalizeRepo(r) {
        const name = r.name || r;
        return {
            name,
            fullName: r.full_name || `${this.org}/${name}`,
            cloneUrl: r.clone_url || `https://github.com/${this.org}/${name}.git`,
            defaultBranch: r.default_branch || this.branch,
        };
    }

    // ─── Sync ───────────────────────────────────────────────────────

    /**
     * Sync all discovered repos. Returns per-repo results with the list of
     * changed files (relative to the repo root) that match the include filters.
     *
     * @param {Object} [options]
     * @param {boolean} [options.force]    Re-extract all matching files
     * @param {Function} [options.onProgress] (repo, result) => void
     * @returns {Promise<{ synced, unchanged, failed, repos: Object[] }>}
     */
    async syncAll(options = {}) {
        const repos = await this.discoverRepos();
        const results = [];
        let synced = 0;
        let unchanged = 0;
        let failed = 0;

        // Simple bounded-concurrency runner
        const queue = [...repos];
        const workers = Array.from({ length: Math.min(this.concurrency, queue.length || 1) }, async () => {
            while (queue.length) {
                const repo = queue.shift();
                try {
                    const res = await this.syncRepo(repo, options);
                    results.push(res);
                    if (res.status === 'unchanged') unchanged++;
                    else synced++;
                    if (options.onProgress) options.onProgress(repo, res);
                } catch (err) {
                    failed++;
                    const res = { repo: repo.name, status: 'failed', error: err.message, changedFiles: [] };
                    results.push(res);
                    if (options.onProgress) options.onProgress(repo, res);
                    this._log(`✗ ${repo.name}: ${err.message}`);
                }
            }
        });
        await Promise.all(workers);
        this._saveState();

        return { synced, unchanged, failed, repos: results };
    }

    /**
     * Sync a single repo: detect remote HEAD, short-circuit if unchanged,
     * otherwise materialize content and compute the changed-file delta.
     *
     * @param {Object} repo  Normalized repo descriptor
     * @param {Object} [options]
     * @returns {Promise<{repo,status,fromSha,toSha,changedFiles,fileCount}>}
     */
    async syncRepo(repo, options = {}) {
        const branch = repo.defaultBranch || this.branch;
        const prev = this._state.repos[repo.name] || {};
        const headSha = await this._getRemoteHeadSha(repo, branch);

        // Short-circuit: HEAD unchanged and not forced.
        if (!options.force && prev.lastSyncedSha && prev.lastSyncedSha === headSha) {
            return {
                repo: repo.name,
                status: 'unchanged',
                fromSha: prev.lastSyncedSha,
                toSha: headSha,
                changedFiles: [],
                fileCount: prev.fileCount || 0,
            };
        }

        const firstSync = !prev.lastSyncedSha || options.force;

        // Materialize / update content on disk.
        await this._materialize(repo, branch);

        // Compute changed files.
        let changedFiles;
        if (firstSync) {
            changedFiles = this.listMatchingFiles(repo.name);
        } else {
            changedFiles = await this._changedMatchingFiles(repo, prev.lastSyncedSha, headSha);
        }

        // Persist state.
        this._state.repos[repo.name] = {
            fullName: repo.fullName,
            branch,
            lastSyncedSha: headSha,
            lastSyncedAt: new Date().toISOString(),
            fileCount: this.listMatchingFiles(repo.name).length,
        };

        return {
            repo: repo.name,
            status: firstSync ? 'full-sync' : 'delta-sync',
            fromSha: prev.lastSyncedSha || null,
            toSha: headSha,
            changedFiles,
            fileCount: changedFiles.length,
        };
    }

    // ─── Change detection ───────────────────────────────────────────

    /**
     * Public: changed matching files since the last recorded sync for a repo.
     * @param {string} repoName
     * @returns {Promise<{fromSha,toSha,changedFiles}>}
     */
    async detectChanges(repoName) {
        const prev = this._state.repos[repoName];
        const repo = this._normalizeRepo({ name: repoName });
        const branch = prev?.branch || this.branch;
        const headSha = await this._getRemoteHeadSha(repo, branch);
        if (!prev?.lastSyncedSha) {
            return { fromSha: null, toSha: headSha, changedFiles: this.listMatchingFiles(repoName) };
        }
        const changedFiles = await this._changedMatchingFiles(repo, prev.lastSyncedSha, headSha);
        return { fromSha: prev.lastSyncedSha, toSha: headSha, changedFiles };
    }

    async _changedMatchingFiles(repo, baseSha, headSha) {
        if (baseSha === headSha) return [];
        try {
            this._requireAxios();
            const { data } = await this._api(`/repos/${repo.fullName}/compare/${baseSha}...${headSha}`);
            const files = (data.files || [])
                .filter((f) => f.status !== 'removed')
                .map((f) => f.filename)
                .filter((p) => this._isMatch(p));
            return files;
        } catch (err) {
            // Compare API can fail for force-pushes / shallow gaps — fall back to full list.
            this._log(`⚠ compare ${repo.name} ${baseSha?.slice(0, 7)}..${headSha?.slice(0, 7)} failed (${err.message}); treating as full re-extract`);
            return this.listMatchingFiles(repo.name);
        }
    }

    // ─── File listing (from disk) ───────────────────────────────────

    /**
     * List matching files for a repo as repo-relative POSIX paths.
     * @param {string} repoName
     * @returns {string[]}
     */
    listMatchingFiles(repoName) {
        const root = path.join(this.cloneDir, repoName);
        if (!fs.existsSync(root)) return [];
        const out = [];
        this._walk(root, root, out);
        return out;
    }

    /** Absolute path on disk for a repo-relative file. */
    absPathFor(repoName, relPath) {
        return path.join(this.cloneDir, repoName, relPath);
    }

    _walk(dir, root, out) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            const rel = path.relative(root, full).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                this._walk(full, root, out);
            } else if (this._isMatch(rel)) {
                out.push(rel);
            }
        }
    }

    _isMatch(relPath) {
        if (this.exclude.length && matchesAny(relPath, this.exclude)) return false;
        return matchesAny(relPath, this.include);
    }

    // ─── Content materialization ────────────────────────────────────

    async _materialize(repo, branch) {
        if (this.fetchMethod === 'api' || !this._hasGit()) {
            return this._materializeViaApi(repo, branch);
        }
        return this._materializeViaClone(repo, branch);
    }

    async _materializeViaClone(repo, branch) {
        const dest = path.join(this.cloneDir, repo.name);
        const authUrl = this._authCloneUrl(repo);
        if (!fs.existsSync(path.join(dest, '.git'))) {
            if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(this.cloneDir, { recursive: true });
            await this._git([
                'clone', '--depth', '1', '--filter=blob:none',
                '--single-branch', '--branch', branch, authUrl, dest,
            ]);
        } else {
            await this._git(['fetch', '--depth', '1', 'origin', branch], dest);
            await this._git(['reset', '--hard', `origin/${branch}`], dest);
            await this._git(['clean', '-fd'], dest);
        }
    }

    async _materializeViaApi(repo, branch) {
        this._requireAxios();
        const dest = path.join(this.cloneDir, repo.name);
        // Recursive tree of the branch HEAD.
        const { data: ref } = await this._api(`/repos/${repo.fullName}/git/refs/heads/${branch}`);
        const treeSha = ref.object.sha;
        const { data: tree } = await this._api(`/repos/${repo.fullName}/git/trees/${treeSha}`, {
            params: { recursive: 1 },
        });
        const blobs = (tree.tree || []).filter((t) => t.type === 'blob' && this._isMatch(t.path));
        for (const blob of blobs) {
            const { data: file } = await this._api(`/repos/${repo.fullName}/git/blobs/${blob.sha}`);
            const content = Buffer.from(file.content || '', file.encoding || 'base64').toString('utf-8');
            const target = path.join(dest, blob.path);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        }
    }

    _authCloneUrl(repo) {
        if (!this.token) return repo.cloneUrl;
        return repo.cloneUrl.replace('https://', `https://x-access-token:${this.token}@`);
    }

    // ─── Remote HEAD ────────────────────────────────────────────────

    async _getRemoteHeadSha(repo, branch) {
        this._requireAxios();
        const { data } = await this._api(`/repos/${repo.fullName}/branches/${branch}`);
        return data.commit.sha;
    }

    // ─── GitHub API ─────────────────────────────────────────────────

    async _api(urlPath, opts = {}) {
        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        return axios.get(`${GITHUB_API}${urlPath}`, {
            headers,
            params: opts.params,
            timeout: opts.timeout || 30000,
        });
    }

    _requireAxios() {
        if (!axios) throw new Error("axios is required but not installed. Run 'npm install' in agentic-workflow/.");
    }

    // ─── git CLI ────────────────────────────────────────────────────

    _hasGit() {
        if (this._gitChecked) return this._gitAvailable;
        this._gitChecked = true;
        try {
            require('child_process').execFileSync('git', ['--version'], { stdio: 'ignore' });
            this._gitAvailable = true;
        } catch {
            this._gitAvailable = false;
            this._log('⚠ git not found on PATH — falling back to GitHub API fetch');
        }
        return this._gitAvailable;
    }

    _git(args, cwd) {
        return new Promise((resolve, reject) => {
            execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    // Redact token from any error surface.
                    const msg = String(stderr || err.message).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
                    return reject(new Error(msg.trim().split('\n').slice(-3).join(' ')));
                }
                resolve(stdout);
            });
        });
    }

    _log(msg) {
        if (this.verbose) console.log(`[repo-sync] ${msg}`);
    }
}

module.exports = { RepoSyncManager, globToRegExp, matchesAny };
