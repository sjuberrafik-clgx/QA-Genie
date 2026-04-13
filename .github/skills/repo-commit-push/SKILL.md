---
name: repo-commit-push
description: 'Safely commit and push repository changes from the web app. Use when users explicitly ask to commit and push current changes, git push web app changes, or stage only necessary project files while excluding tests, artifacts, logs, results, reports, exploration data, and test cases.'
---

# Repo Commit Push

Use this skill when the user explicitly wants the repository changes committed and pushed from the web app chat.

## When To Use This Skill

Use this skill when:
- A user says commit and push the current changes
- A user says git push the web app changes or push these repo changes
- A user wants only necessary project files staged and pushed
- A user wants test artifacts, test files, reports, logs, results, exploration data, or test cases excluded from the commit

Keywords: commit and push, git push, push changes, commit changes, push repo changes, commit repo changes, stage and push, commit current changes, push current branch, commit web app changes, push web app changes, commit project files, safe git commit

## Required Behavior

- Only act when the user explicitly asks to commit, push, or both.
- Use `commit_and_push_repo_changes` for execution.
- Default to the tool's safe staging filter so only source/config/project files are included.
- Exclude test artifacts, test files, unit tests, integration tests, logs, test results, reports, exploration data, test cases, and generated output files.
- If the user asks for a preview, or asks what would be committed, run the tool with `dryRun: true` first.
- If the user already gave a commit message, pass it through.
- If the user did not give a commit message, let the tool generate a concise default message.
- If the user explicitly names an extra file or folder outside the default scope, pass it through `includePaths` while still relying on the same exclusions for tests, artifacts, logs, reports, results, and generated outputs.

## Workflow

1. Confirm the user explicitly asked for commit/push behavior.
2. If the user asked to preview or inspect first, call `commit_and_push_repo_changes` with `dryRun: true`.
3. If the user asked to commit and push, call `commit_and_push_repo_changes` with `dryRun: false`.
4. Report back the branch, commit message, commit SHA, staged files, and any excluded files that were filtered out.
5. If push fails, surface the push error clearly instead of hiding it.

## Notes

- This skill is intended for safe repo operations from the web app chat.
- The tool already enforces the safe file filter; do not try to stage broad test/output directories manually.