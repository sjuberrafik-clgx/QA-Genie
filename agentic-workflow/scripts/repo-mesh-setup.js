#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPO-MESH-SETUP — Federated Contract Mesh CLI
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manage the backend-repo knowledge base — discover, sync, query, trace, validate.
 *
 * Usage:
 *   node agentic-workflow/scripts/repo-mesh-setup.js discover            # List org repos matching the query
 *   node agentic-workflow/scripts/repo-mesh-setup.js init               # Validate config + GitHub access
 *   node agentic-workflow/scripts/repo-mesh-setup.js sync [--force]     # Sync all repos + recompile deltas
 *   node agentic-workflow/scripts/repo-mesh-setup.js sync --repo NAME   # Sync a single repo
 *   node agentic-workflow/scripts/repo-mesh-setup.js rebuild            # Recompile from on-disk repos (no network)
 *   node agentic-workflow/scripts/repo-mesh-setup.js stats              # Show mesh statistics
 *   node agentic-workflow/scripts/repo-mesh-setup.js query "consumer profile update"
 *   node agentic-workflow/scripts/repo-mesh-setup.js trace "Favorites"  # Full-stack blast radius for a feature
 *   node agentic-workflow/scripts/repo-mesh-setup.js validate          # Validate config + env + seed
 *
 * @module scripts/repo-mesh-setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');

// Load .env (same lightweight loader as kb-setup.js)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) {
            const k = t.slice(0, eq).trim();
            const v = t.slice(eq + 1).trim();
            if (!process.env[k]) process.env[k] = v;
        }
    }
}

const { RepoMesh } = require('../repo-mesh');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'grounding-config.json');

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
function log(msg) { console.log(`  ${msg}`); }
function header(title) {
    console.log('');
    console.log(`═══ ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`);
}
function mesh() {
    const cfg = loadConfig();
    return new RepoMesh({ config: cfg.repoMesh, featureMap: cfg.featureMap, verbose: true });
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdDiscover() {
    header('Discover Repos');
    const m = mesh();
    try {
        const repos = await m.sync.discoverRepos();
        log(`Found ${repos.length} repo(s):`);
        for (const r of repos.slice(0, 200)) log(`  • ${r.fullName} [${r.defaultBranch}]`);
    } catch (err) {
        log(`❌ Discovery failed: ${err.message}`);
        log('   Check GITHUB_ORG, GITHUB_TOKEN, and that the token can read the org.');
        process.exitCode = 1;
    }
}

async function cmdInit() {
    header('Initialize Repo Mesh');
    const cfg = loadConfig();
    const rm = cfg.repoMesh || {};
    if (!rm.enabled && process.env.REPO_MESH_ENABLED !== 'true') {
        log('⚠ Repo Mesh is disabled. Set repoMesh.enabled=true or REPO_MESH_ENABLED=true.');
    }
    log(`Org:    ${rm.source?.org || process.env.GITHUB_ORG || '(unset)'}`);
    log(`Query:  ${rm.source?.query || process.env.REPO_MESH_QUERY || '(none)'}`);
    log(`Token:  ${process.env.GITHUB_TOKEN ? 'present' : '❌ missing (GITHUB_TOKEN)'}`);
    log(`Fetch:  ${rm.source?.fetchMethod || 'partial-clone'}`);

    const m = mesh();
    m.initialize();
    try {
        const repos = await m.sync.discoverRepos();
        log(`✅ GitHub reachable — ${repos.length} repo(s) match.`);
    } catch (err) {
        log(`❌ GitHub access failed: ${err.message}`);
        process.exitCode = 1;
    }
    log(`Seed services: ${Object.keys(m._seed().services || {}).length}`);
    log(`Graph (seed):  ${JSON.stringify(m.graph.stats().byType)}`);
}

async function cmdSync(args) {
    header('Sync Repo Mesh');
    const force = args.includes('--force');
    const repoIdx = args.indexOf('--repo');
    const m = mesh();

    if (repoIdx >= 0 && args[repoIdx + 1]) {
        const repoName = args[repoIdx + 1];
        log(`Syncing single repo: ${repoName} ...`);
        const repo = m.sync._normalizeRepo({ name: repoName });
        const res = await m.sync.syncRepo(repo, { force });
        m.sync._saveState();
        const changed = m.applyDelta(repoName, res.changedFiles);
        log(`Status: ${res.status} | changed files: ${res.changedFiles.length} | contract changed: ${changed.changed}`);
        return;
    }

    log('Syncing all repos (delta-aware)...');
    const t0 = Date.now();
    const res = await m.syncAll({
        force,
        onProgress: (repo, r) => {
            const tag = r.status === 'unchanged' ? '·' : r.status === 'failed' ? '✗' : '✓';
            log(`  ${tag} ${repo.name}: ${r.status} (${r.changedFiles.length} files)`);
        },
    });
    log('');
    log(`Synced: ${res.synced} | Unchanged: ${res.unchanged} | Failed: ${res.failed}`);
    log(`Contracts changed: ${res.contractsChanged} → [${res.changedServices.slice(0, 10).join(', ')}]`);
    log(`DNA: ${JSON.stringify(res.dnaStats)}`);
    log(`Graph: ${JSON.stringify(res.graphStats.byType)}`);
    log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function cmdRebuild() {
    header('Rebuild From Disk (no network)');
    const m = mesh();
    const res = m.rebuildFromDisk();
    log(`Repos on disk: ${res.repos}`);
    log(`DNA: ${JSON.stringify(res.dnaStats)}`);
    log(`Graph: ${JSON.stringify(res.graphStats.byType)}`);
    log(`Rules: ${JSON.stringify(m.ruleDNA.stats())}`);
}

function cmdClone(args) {
    header('Clone Repos (Path B — local, no PAT)');
    const { execFileSync } = require('child_process');
    const listPath = path.join(__dirname, '..', 'repo-mesh', 'repo-list.json');
    if (!fs.existsSync(listPath)) {
        log(`❌ repo-list.json not found at ${listPath}`);
        process.exitCode = 1;
        return;
    }
    const list = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
    const cfg = loadConfig();
    const org = process.env.GITHUB_ORG || list.org;
    const cloneDir = process.env.REPO_MESH_CLONE_DIR
        ? path.resolve(process.env.REPO_MESH_CLONE_DIR)
        : path.join(__dirname, '..', cfg.repoMesh?.source?.cloneDir || 'repo-mesh-data/repos');
    fs.mkdirSync(cloneDir, { recursive: true });

    const prefix = list.prefix || '';
    const repoIdx = args.indexOf('--repo');
    const repos = (repoIdx >= 0 && args[repoIdx + 1]) ? [args[repoIdx + 1]] : list.repos;

    log(`Org: ${org} | prefix: ${prefix || '(none)'} | repos: ${repos.length} | dest: ${cloneDir}`);
    log('Auth: plain git via your credential manager (no PAT). First clone may open a browser for SSO.');
    log('');

    let cloned = 0, recovered = 0, present = 0, failed = 0;
    const GITC = ['-c', 'core.longpaths=true']; // Windows deep-path safety for Java repos
    for (const repo of repos) {
        const dir = path.join(cloneDir, repo);
        const url = `https://github.com/${org}/${prefix}${repo}.git`;
        const hasGit = fs.existsSync(path.join(dir, '.git'));
        const hasFiles = hasGit && fs.readdirSync(dir).some((n) => n !== '.git');
        try {
            if (hasGit && hasFiles) {
                present++;
                log(`  · ${repo} (present)`);
            } else if (hasGit) {
                // Clone succeeded earlier but checkout failed (e.g. long paths) — re-clone cleanly.
                fs.rmSync(dir, { recursive: true, force: true });
                execFileSync('git', [...GITC, 'clone', '--depth', '1', '--single-branch', url, dir], { stdio: 'pipe', timeout: 300000 });
                recovered++;
                log(`  ⟳ ${repo} (re-cloned)`);
            } else {
                execFileSync('git', [...GITC, 'clone', '--depth', '1', '--single-branch', url, dir], { stdio: 'pipe', timeout: 300000 });
                cloned++;
                log(`  ✓ ${repo}`);
            }
        } catch (e) {
            failed++;
            const lines = String(e.stderr || e.message).split('\n').map((s) => s.trim()).filter(Boolean);
            const msg = lines.find((l) => /fatal|error|unable|denied|not found/i.test(l)) || lines.pop() || 'unknown error';
            log(`  ✗ ${repo}: ${msg}`);
        }
    }
    log('');
    log(`Cloned: ${cloned} | Recovered: ${recovered} | Present: ${present} | Failed: ${failed}`);
    log(`Location: ${cloneDir}`);

    // Frontend UI repos → separate dir (scanned for UI→API call sites, not contracts).
    const frontendRepos = list.frontendRepos || [];
    if (frontendRepos.length && repoIdx < 0) {
        const frontendDir = path.join(__dirname, '..', 'repo-mesh-data', 'frontend');
        fs.mkdirSync(frontendDir, { recursive: true });
        log('');
        log(`Frontend repos → ${frontendDir}`);
        for (const repo of frontendRepos) {
            const dir = path.join(frontendDir, repo);
            const url = `https://github.com/${org}/${prefix}${repo}.git`;
            const hasGit = fs.existsSync(path.join(dir, '.git'));
            const hasFiles = hasGit && fs.readdirSync(dir).some((n) => n !== '.git');
            try {
                if (hasGit && hasFiles) {
                    log(`  · ${repo} (present)`);
                } else {
                    if (hasGit) fs.rmSync(dir, { recursive: true, force: true });
                    execFileSync('git', [...GITC, 'clone', '--depth', '1', '--single-branch', url, dir], { stdio: 'pipe', timeout: 300000 });
                    log(`  ✓ ${repo}`);
                }
            } catch (e) {
                const lines = String(e.stderr || e.message).split('\n').map((s) => s.trim()).filter(Boolean);
                log(`  ✗ ${repo}: ${lines.find((l) => /fatal|error|unable|denied|not found/i.test(l)) || lines.pop() || 'error'}`);
            }
        }
    }

    log('Next → npm run repo-mesh -- rebuild   (extracts contracts + UI→API edges)');
}

function cmdStats() {
    header('Repo Mesh Statistics');
    const m = mesh();
    const s = m.stats();
    log(`Enabled: ${s.enabled}`);
    log(`Services indexed: ${s.dna.services}`);
    log(`Endpoints: ${s.dna.endpoints} | Topics: ${s.dna.topics} | Indices: ${s.dna.indices} | Models: ${s.dna.models}`);
    log(`Graph nodes: ${s.graph.nodes} | edges: ${s.graph.edges}`);
    log(`Node types: ${JSON.stringify(s.graph.byType)}`);
    log(`Business rules: ${s.businessRules.rules} across ${s.businessRules.features} features`);
    const repos = Object.keys(s.sync.repos || {});
    log(`Synced repos: ${repos.length}`);
}

function cmdQuery(args) {
    const query = args.filter((a) => !a.startsWith('--')).join(' ');
    header(`Query: "${query}"`);
    if (!query) return log('Provide a query string.');
    const m = mesh();
    const res = m.searchContracts(query);
    log(`Matched node: ${res.matched || '(none)'}`);
    log(`Services: ${res.services.map((s) => s.service).join(', ') || '(none)'}`);
    log(`Topics produced: [${res.topics.produced.join(', ')}]`);
    log(`Topics consumed: [${res.topics.consumed.join(', ')}]`);
    log(`Indices: [${res.indices.join(', ')}]`);
    for (const card of res.services) {
        log('');
        log(`── ${card.service} (${card.domain}) ──`);
        if (card.endpoints?.length) log(`   endpoints: ${card.endpoints.join(', ')}`);
        if (card.indices?.length) log(`   indices: ${card.indices.join(', ')}`);
    }
}

function cmdTrace(args) {
    const feature = args.filter((a) => !a.startsWith('--')).join(' ');
    header(`Trace: "${feature}"`);
    const m = mesh();
    const trace = m.traceFullStack(feature);
    if (!trace) return log('No trace found. Try a feature name from grounding-config.json featureMap.');
    log(`Feature/Match: ${trace.feature || trace.matchedNode}`);
    log(`Services: ${trace.services.join(', ')}`);
    if (trace.uiApps?.length) log(`UI apps: ${trace.uiApps.join(', ')}`);
    if (trace.uiOperations?.length) log(`UI operations: ${trace.uiOperations.slice(0, 12).join(', ')}`);
    log(`Endpoints: ${trace.endpoints.map((e) => e.sig).slice(0, 12).join(', ') || '(none extracted yet)'}`);
    log(`Kafka produces → [${trace.topicsProduced.join(', ')}]`);
    log(`Kafka consumes ← [${trace.topicsConsumed.join(', ')}]`);
    log(`Elastic indices: [${trace.indices.join(', ')}]`);
}

function cmdValidate() {
    header('Validate Repo Mesh Config');
    let problems = 0;
    const cfg = loadConfig();
    const rm = cfg.repoMesh;
    if (!rm) { log('❌ repoMesh section missing from grounding-config.json'); process.exitCode = 1; return; }

    const check = (cond, okMsg, failMsg) => {
        if (cond) log(`✅ ${okMsg}`);
        else { log(`❌ ${failMsg}`); problems++; }
    };
    check(typeof rm.enabled === 'boolean', 'enabled flag present', 'enabled flag missing');
    check(rm.source?.org || process.env.GITHUB_ORG, 'org configured', 'org missing (set GITHUB_ORG)');
    check(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN present', 'GITHUB_TOKEN missing');
    check(['partial-clone', 'api'].includes(rm.source?.fetchMethod || 'partial-clone'), 'valid fetchMethod', 'invalid fetchMethod');
    const seedPath = path.join(__dirname, '..', rm.graph?.seedPath || 'repo-mesh/data-flow-seed.json');
    check(fs.existsSync(seedPath), `seed found (${path.basename(seedPath)})`, `seed missing at ${seedPath}`);
    if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        check(Object.keys(seed.services || {}).length > 0, `seed has ${Object.keys(seed.services).length} services`, 'seed has no services');
    }
    log('');
    log(problems === 0 ? '✅ Configuration valid.' : `⚠ ${problems} problem(s) found.`);
    if (problems) process.exitCode = 1;
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function main() {
    const [command, ...args] = process.argv.slice(2);
    switch (command) {
        case 'discover': return cmdDiscover();
        case 'init': return cmdInit();
        case 'clone': return cmdClone(args);
        case 'sync': return cmdSync(args);
        case 'rebuild': return cmdRebuild();
        case 'stats': return cmdStats();
        case 'query': return cmdQuery(args);
        case 'trace': return cmdTrace(args);
        case 'validate': return cmdValidate();
        default:
            console.log('Usage: repo-mesh-setup.js <discover|init|clone|sync|rebuild|stats|query|trace|validate>');
            console.log('  clone [--repo NAME]   # Path B: local git clone (no PAT), then `rebuild`');
            console.log('  sync  [--force] [--repo NAME]');
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err.stack || err.message}`);
    process.exit(1);
});
