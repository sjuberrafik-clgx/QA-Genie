# Project Skills

This directory follows the native folder-based skill layout used by awesome-copilot style skills.

## Structure

- Each skill lives in its own folder under `.github/skills/<skill-name>/`.
- Each skill is defined by `SKILL.md` inside that folder.
- Supporting references, examples, and templates should stay inside the same skill folder.

## Current Skill

- `ppt` contains the repository's PowerPoint skill at `.github/skills/ppt/SKILL.md`.
- `repo-commit-push` contains the repository's safe git commit/push skill at `.github/skills/repo-commit-push/SKILL.md`.

## Design Rule

- Do not add a separate registry for skills.
- The folder and its `SKILL.md` file are the source of truth.
- If a new skill is created, place it under its own folder, for example `.github/skills/ppt/SKILL.md`.
- For automatic web-app invocation, give each skill a clear frontmatter `description`, a `## When To Use This Skill` section, and a `Keywords:` line with realistic user phrasing.