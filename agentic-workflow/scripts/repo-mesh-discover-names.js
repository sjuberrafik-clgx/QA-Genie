#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPO-MESH-DISCOVER-NAMES — Authoritative repo discovery via git credential
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * For Path B (local clones) when the API PAT lacks org access but your git
 * credential (Git Credential Manager / SSO) does. Reads the github.com token
 * straight from your credential helper (never prints it), lists the org's repos
 * via the GitHub API, filters by the configured queries, and rewrites
 * repo-mesh/repo-list.json with the REAL slugs.
 *
 * Usage:
 *   node agentic-workflow/scripts/repo-mesh-discover-names.js [--org NAME] [--match aotf,idap] [--dry-run]
 *
 * @module scripts/repo-mesh-discover-names
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LIST_PATH = path.join(__dirname, '..', 'repo-mesh', 'repo-list.json');
const COMMON_PREFIX = 'real_estate_us-';

function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** Read the github.com token from the git credential helper without printing it. */
function getGitToken() {
    try {
        const out = execFileSync('git', ['credential', 'fill'], {
            input: 'protocol=https\nhost=github.com\n\n',
            encoding: 'utf-8',
            timeout: 60000,
        });
        const m = out.match(/^password=(.+)$/m);
        return m ? m[1].trim() : null;
    } catch (err) {
        console.error('❌ Could not read git credential:', err.message);
        return null;
    }
}

async function listAllOrgRepos(org, token) {
    const names = [];
    for (let page = 1; page <= 120; page++) {
        const r = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=all`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        });
        if (!r.ok) {
            const body = await r.text();
            throw new Error(`GitHub API ${r.status}: ${body.slice(0, 160)}`);
        }
        const batch = await r.json();
        if (!batch.length) break;
        names.push(...batch.map((x) => x.name));
        if (batch.length < 100) break;
    }
    return names;
}

(async () => {
    const org = arg('--org', process.env.GITHUB_ORG || 'corelogic-private');
    const prefixes = arg('--prefixes', 'real_estate_us-aotf-,real_estate_us-idap-').split(',').map((s) => s.trim()).filter(Boolean);
    const dryRun = process.argv.includes('--dry-run');

    console.log(`\n═══ Discover Repo Names (via git credential) ═══`);
    console.log(`  org: ${org} | prefixes: ${prefixes.join(', ')}`);

    const token = getGitToken();
    if (!token) {
        console.error('  No token from git credential helper. Run a `git ls-remote` against a private repo first to authenticate.');
        process.exit(1);
    }

    let all;
    try {
        all = await listAllOrgRepos(org, token);
    } catch (err) {
        console.error(`  ❌ ${err.message}`);
        console.error('  The git credential may not have API/org scope. Consider a classic PAT (repo + read:org) authorized for SSO.');
        process.exit(1);
    }

    console.log(`  Org repos scanned: ${all.length}`);
    const matched = all.filter((n) => prefixes.some((p) => n.startsWith(p)));
    console.log(`  Matching prefixes: ${matched.length}`);
    if (matched.length === 0) {
        console.error('  ❌ 0 repos found — not overwriting repo-list.json. Check --prefixes or org access.');
        process.exit(1);
    }

    // Strip the common prefix for clean base/folder names; keep prefix separately.
    const usesPrefix = matched.every((n) => n.startsWith(COMMON_PREFIX));
    const prefix = usesPrefix ? COMMON_PREFIX : '';
    const allBase = matched.map((n) => (usesPrefix ? n.slice(COMMON_PREFIX.length) : n)).sort();
    let repos = allBase;

    // Curate to backend service/domain/pipeline repos (skip IaC, tests, docs, frontend, misc).
    // Use --all to keep every matched repo.
    if (!process.argv.includes('--all')) {
        const isBackend = (b) =>
            /(_service|_services|_domain)$/.test(b) ||
            /idap_(pipeline|scdf)/.test(b) ||
            /api_integrations$/.test(b);
        const before = repos.length;
        repos = repos.filter(isBackend);
        console.log(`  Curated to backend service/domain/pipeline repos: ${repos.length} (of ${before}; pass --all to keep every repo)`);
    }

    // Frontend UI repos — analyzed for UI→API call sites (not contract extraction).
    const frontendRepos = allBase.filter((b) => /frontend_apps$|onehome_mobile$/.test(b));
    if (frontendRepos.length) console.log(`  Frontend UI repos: ${frontendRepos.join(', ')}`);

    const listObj = {
        _comment: 'Auto-generated by repo-mesh-discover-names.js from the live GitHub org. Base names; clone prepends `prefix`. Regenerate anytime to pick up new repos. frontendRepos are scanned for UI→API call sites.',
        version: '1.0.0',
        org,
        prefix,
        repos,
        frontendRepos,
    };

    console.log('');
    for (const r of repos) console.log(`    • ${prefix}${r}`);
    console.log('');

    if (dryRun) {
        console.log('  --dry-run: not writing repo-list.json');
        return;
    }
    fs.writeFileSync(LIST_PATH, JSON.stringify(listObj, null, 2) + '\n');
    console.log(`  ✅ Wrote ${repos.length} repos to ${path.relative(path.join(__dirname, '..', '..'), LIST_PATH)} (prefix="${prefix}")`);
    console.log('  Next → npm run repo-mesh:clone   then   npm run repo-mesh -- rebuild');
})();
