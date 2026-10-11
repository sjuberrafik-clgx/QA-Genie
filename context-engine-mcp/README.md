# context-engine-mcp

OneHome Context Engine. It keeps application context aligned with the code deployed to **UAT**. MCP agents (Glass, ScriptGenerator and others) can then work from task-specific context rather than guessing the business flow.

**GitHub access is read-only.** Only `git ls-remote`, `fetch` and `clone` reach GitHub. Every git command passes an allowlist guard first ([src/sync/read-only-git.js](src/sync/read-only-git.js)). Every clone also gets `remote.origin.pushurl = no-push://context-engine-read-only`, so a push from that folder fails.

## Requirements

- Node.js 20.10+ and git on `PATH`.
- Appgate VPN connected. The org has an IP allow list, so GitHub returns 403 without it.
- Git signs in through your local credential manager. No token is stored in this package.

## Layout

| Path | Purpose |
|---|---|
| `config/repo-registry.json` | The 31 source repos (OneHome, Matrix, Trestle, RCSL-RESS). Group dirs are relative to the workspace root. To fix a branch for a repo, add `uatRef`. |
| `src/sync/` | Read-only git guard. Freshness: which branch counts as UAT, status checks, refresh, and change records. |
| `src/store/` | JSON store: atomic writes, a single-writer lock, and append-only change logs. |
| `src/tools/` | MCP tools. |
| `scripts/` | CLI and diagnostics. |
| `data/` | Generated, gitignored: `manifest.json`, `changes/<repo>.jsonl`, and clones of the non-backend repos. |

OneHome frontend and backend clones are shared with Repo Mesh (`agentic-workflow/repo-mesh-data/`), so they are not stored twice.

## UAT ref

The UAT branch for each repo is resolved in this order:

1. `uatRef` set for that repo in the registry.
2. The highest semver `release/X.Y.Z` branch.
3. The repo's default branch.

Some repos' newest release branch is old (`prd_service`, `notifications_service` and others). These are kept on purpose, as context.

## MCP tools

| Tool | Purpose |
|---|---|
| `ce_repo_status` | Compares each local clone with its remote UAT ref (`ls-remote`), with a 30-minute cache. Also reports whether the compiled knowledge is stale. |
| `ce_refresh_repos` | Fetches stale repos and records which files changed (at most `CE_MAX_REPOS_PER_REFRESH`; clones missing repos only if `CE_ALLOW_CLONE=true`). If a repo that feeds the knowledge base changed, it then recompiles the knowledge and reports `newFeatureCandidates`. |
| `ce_get_changes` | Lists recorded file changes, newest first. Filter them with a `pathPrefix`. |
| `ce_rebuild_knowledge` | Recompiles contracts, the feature graph and Rule DNA from the local clones (local only). Use it after editing the feature catalog. |
| `ce_feature_coverage` | Compares feature folders in the code with `agentic-workflow/config/feature-catalog.json`. Folders that appeared after the baseline scan and aren't in the catalog are listed as `newFeatureCandidates`. |

The `application-kb` server reloads the compiled knowledge on its next call, so no restart is needed. Set `CE_AUTO_REBUILD=false` to turn off the automatic rebuild after a refresh.

## Commands

```bash
npm install
npm run diagnose                                  # git, registry, data dir, GitHub read access
npm run status   -- [--repo aotf-frontend_apps] [--force]
npm run refresh  -- [--repo X] [--clone-missing] [--force] [--no-rebuild]
npm run rebuild                                   # recompile knowledge + coverage
npm run coverage                                  # feature folders vs catalog
npm test                                          # offline suite
```
