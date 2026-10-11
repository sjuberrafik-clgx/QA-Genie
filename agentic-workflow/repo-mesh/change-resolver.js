/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CHANGE RESOLVER — Jira ticket ⇒ pull request ⇒ changed file paths
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The ONLY networked step of the live impact trace. Everything downstream
 * (live-trace.js) reads the local clones, so this module is deliberately thin.
 *
 * Product PRs carry the ticket key as `[AOTF-12345]` or `AOTF-12345:` in the title
 * or head branch, so a single GitHub search issue query resolves the change set.
 *
 * Returned paths are prefixed with the repository short name
 * (`aotf-frontend_apps/projects/...`) to match the feature-catalog `sources`
 * convention and the on-disk clone layout.
 *
 * @module repo-mesh/change-resolver
 * ═══════════════════════════════════════════════════════════════════════════════
 */

let axios;
try {
    axios = require('axios');
} catch {
    axios = null;
}

const GITHUB_API = 'https://api.github.com';
const TICKET_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Reasons a trace runs without a resolved pull request. Surfaced to the agent verbatim. */
const DEGRADED = {
    NO_TOKEN: 'GITHUB_TOKEN is not set, so the ticket could not be resolved to a pull request.',
    NO_AXIOS: 'axios is not installed, so GitHub cannot be queried.',
    NO_REPOS: 'No product repositories are configured for pull-request lookup.',
    NOT_FOUND: 'No pull request references this ticket in the configured repositories.',
    NO_FILES: 'Pull requests were found but none reported changed files.',
};

function shortName(fullName) {
    return String(fullName || '').split('/').pop();
}

class ChangeResolver {
    /**
     * @param {Object} [config]
     * @param {string} [config.token]     GitHub PAT (defaults to env GITHUB_TOKEN)
     * @param {string[]} [config.repos]   'owner/name' entries to search
     * @param {string} [config.repoPrefix] Name prefix the local clones drop (e.g. 'real_estate_us-')
     * @param {number} [config.ttlMs]     Result cache lifetime
     * @param {boolean} [config.verbose]
     */
    constructor(config = {}) {
        this.token = config.token || process.env.GITHUB_TOKEN || '';
        this.repos = (config.repos || []).filter(Boolean);
        this.repoPrefix = config.repoPrefix || '';
        this.ttlMs = Number.isFinite(config.ttlMs) ? config.ttlMs : DEFAULT_TTL_MS;
        this.verbose = config.verbose || false;
        this._cache = new Map();
    }

    _log(message) {
        if (this.verbose) console.error(`[ChangeResolver] ${message}`);
    }

    _degraded(ticketId, reason) {
        return { ticketId, prs: [], changedPaths: [], degraded: true, reason };
    }

    /**
     * Resolve a ticket to its merged pull requests and changed file paths.
     *
     * Never throws: any failure returns `degraded:true` with a human-readable reason
     * so callers report reduced confidence instead of an empty (falsely clean) impact.
     *
     * @param {string} ticketId          e.g. 'AOTF-18492'
     * @param {Object} [options]
     * @param {number} [options.maxPrs=5]
     * @param {number} [options.maxFilesPerPr=300]
     * @returns {Promise<{ticketId:string, prs:Object[], changedPaths:string[], degraded:boolean, reason:string|null}>}
     */
    async resolveTicketChange(ticketId, options = {}) {
        const ticket = String(ticketId || '').trim().toUpperCase();
        if (!TICKET_PATTERN.test(ticket)) {
            return this._degraded(ticket, `"${ticketId}" is not a valid ticket key (expected e.g. AOTF-12345).`);
        }

        const cached = this._cache.get(ticket);
        if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;

        if (!axios) return this._degraded(ticket, DEGRADED.NO_AXIOS);
        if (!this.token) return this._degraded(ticket, DEGRADED.NO_TOKEN);
        if (this.repos.length === 0) return this._degraded(ticket, DEGRADED.NO_REPOS);

        const maxPrs = Math.max(1, Math.min(options.maxPrs || 5, 10));
        const maxFilesPerPr = Math.max(1, Math.min(options.maxFilesPerPr || 300, 3000));

        let result;
        try {
            const prs = await this._searchPullRequests(ticket, maxPrs);
            if (prs.length === 0) {
                result = this._degraded(ticket, DEGRADED.NOT_FOUND);
            } else {
                const changedPaths = [];
                for (const pr of prs) {
                    const files = await this._pullRequestFiles(pr.repo, pr.number, maxFilesPerPr);
                    const name = shortName(pr.repo);
                    const prefix = this.repoPrefix && name.startsWith(this.repoPrefix) ? name.slice(this.repoPrefix.length) : name;
                    for (const file of files) changedPaths.push(`${prefix}/${file}`);
                }
                result = changedPaths.length > 0
                    ? { ticketId: ticket, prs, changedPaths: [...new Set(changedPaths)], degraded: false, reason: null }
                    : { ...this._degraded(ticket, DEGRADED.NO_FILES), prs };
            }
        } catch (error) {
            result = this._degraded(ticket, `GitHub lookup failed: ${error.message}`);
        }

        this._cache.set(ticket, { at: Date.now(), value: result });
        return result;
    }

    async _searchPullRequests(ticket, maxPrs) {
        // Multiple repo: qualifiers are OR'd, so one query covers every product repo.
        const scope = this.repos.map((repo) => `repo:${repo}`).join(' ');
        const { data } = await this._api('/search/issues', {
            params: { q: `${ticket} type:pr ${scope}`, per_page: maxPrs, sort: 'updated', order: 'desc' },
        });

        return (data.items || []).slice(0, maxPrs).map((item) => ({
            repo: this._repoFromIssueUrl(item.repository_url) || '',
            number: item.number,
            title: item.title,
            state: item.state,
            merged: Boolean(item.pull_request?.merged_at),
            mergedAt: item.pull_request?.merged_at || null,
            url: item.html_url,
        })).filter((pr) => pr.repo);
    }

    _repoFromIssueUrl(repositoryUrl) {
        const match = String(repositoryUrl || '').match(/repos\/([^/]+\/[^/]+)$/);
        return match ? match[1] : null;
    }

    async _pullRequestFiles(repo, number, maxFiles) {
        const files = [];
        for (let page = 1; files.length < maxFiles && page <= 10; page++) {
            const { data } = await this._api(`/repos/${repo}/pulls/${number}/files`, {
                params: { per_page: 100, page },
            });
            if (!Array.isArray(data) || data.length === 0) break;
            for (const file of data) {
                if (file.status !== 'removed') files.push(file.filename);
            }
            if (data.length < 100) break;
        }
        return files.slice(0, maxFiles);
    }

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
}

module.exports = { ChangeResolver, DEGRADED };
