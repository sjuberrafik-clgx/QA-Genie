---
name: scri-runner
description: 'Run Playwright automation scripts in this repository and summarize results. Use when users want to execute a spec, rerun a failed test, validate generated scripts, collect artifacts, or get a concise pass/fail triage with report paths.'
---

# Scri Runner

Use this skill when the user wants automation scripts executed, re-executed, or triaged in the QA framework.

## When To Use This Skill

Use this skill when:
- A user asks to run a Playwright spec, test folder, or filtered test selection
- A user wants to validate a newly generated `.spec.js` before handing it off
- A user wants a rerun of failing automation with artifacts and report paths
- A user wants a concise failure summary instead of raw terminal noise

Keywords: run script, run spec, execute playwright, rerun failed test, validate automation, test execution, playwright report, test-results, test-artifacts, run generated script, spec triage, automation debugging

## Instructions

1. Confirm the execution target from the user request when it is explicit. Prefer the narrowest safe scope: a single spec file first, then a folder, then the wider suite only if requested.
2. Use existing repository commands and configuration only. Do not introduce new runners, wrappers, or custom harnesses unless they already exist in the project.
3. For generated automation, verify the script is under `tests/` and not under `web-app/`. If the request appears to point to the app project instead of the QA framework, correct course before running.
4. Execute with repository defaults so Playwright output, `playwright-report`, `test-results`, and any existing artifacts remain consistent with the workspace conventions.
5. On success, report the exact scope executed, high-level result counts, and where the user can find reports or artifacts.
6. On failure, summarize only the useful details: failing test names, first meaningful error, likely failure point, and artifact locations such as screenshots, traces, videos, or HTML report output.
7. If a failure looks environmental rather than script-related, say so directly and distinguish it from an assertion or selector problem.
8. When rerunning, prefer targeted reruns over broad retries. Do not hide flaky behavior behind repeated silent reruns.

## Required Behavior

- Keep output concise and execution-focused.
- Prefer deterministic commands over exploratory trial-and-error.
- Surface command failures clearly; do not imply success when the run is incomplete.
- Preserve repository conventions for Playwright, reports, and artifact directories.
- If the user asks for debugging help after execution, use the failure evidence to propose the next specific action.

## Notes

This skill is for script execution and result triage, not for generating new test cases or writing new specs. If the user needs a new automation script, hand off to the appropriate generation workflow first, then return here to validate it.
