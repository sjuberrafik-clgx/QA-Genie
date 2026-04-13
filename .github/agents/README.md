# Multi-Agent QA Workflow

This directory contains the custom GitHub Copilot agents used by the QA automation platform.

Use this README when you want to understand how the agents are organized, how to invoke them in VS Code, and how the QA workflow is split between core pipeline agents and utility agents.

For the broader repository overview, setup, SDK pipeline, dashboard, and platform architecture, see [README.md](../../README.md).

---

## What Lives Here

This folder provides:

- Agent definitions under [.github/agents](.)
- Shared orchestration utilities under [.github/agents/lib](lib)
- Agent usage notes under [.github/agents/docs](docs)
- Project skills under [../skills](../skills) for reusable task-specific guidance such as PPT setup and professional deck generation

The agent system is designed for VS Code custom-agent workflows, not as a standalone runtime by itself.

Project skills complement the agent system. Use agents for deterministic workflows and use skills for reusable, task-scoped guidance that should load only when relevant.

---

## Agent Inventory

The workspace currently includes eight agent definitions.

### Core QA Agents

| Agent | Invoke | Role | Typical Output |
|---|---|---|---|
| Orchestrator | `@orchestrator` | Coordinates the QA workflow and delegates to the right agent | End-to-end pipeline progress and artifacts |
| TestGenie | `@testgenie` | Generates manual test cases from Jira tickets | Chat markdown tables and Excel test cases |
| ScriptGenerator | `@scriptgenerator` | Generates Playwright automation using MCP-first exploration | `.spec.js` automation scripts |
| BugGenie | `@buggenie` | Turns failed execution context into structured Jira bug reports | Review copy and Jira defect tickets |
| TaskGenie | `@taskgenie` | Creates linked Jira Testing tasks and can embed test cases | Jira Testing tasks |
| CodeReviewer | `@codereviewer` | Reviews generated scripts for quality, standards, and reuse | Review findings and suggested fixes |

### Utility Agents

| Agent | Invoke | Role | Typical Output |
|---|---|---|---|
| FileGenie | `@filegenie` | Filesystem and document-focused operations | File summaries, file operations, document assistance |
| DocGenie | `@docgenie` | Document and presentation generation workflows | Reports, presentations, export artifacts |

Terminology used in this workspace:

- Test cases means manual QA steps produced by TestGenie.
- Automation scripts means Playwright `.spec.js` files produced by ScriptGenerator.
- Core QA agents participate directly in the testing workflow.
- Utility agents are available in the workspace but are not the default path for the QA pipeline.

---

## Project Structure

```text
.github/agents/
├── README.md
├── orchestrator.agent.md
├── testgenie.agent.md
├── scriptgenerator.agent.md
├── buggenie.agent.md
├── taskgenie.agent.md
├── codereviewer.agent.md
├── filegenie.agent.md
├── docgenie.instructions.md
├── lib/
│   ├── index.js
│   ├── workflow-coordinator.js
│   ├── workflow-enforcer.js
│   ├── workflow-preflight.js
│   ├── workflow-recovery.js
│   ├── quality-gates.js
│   ├── error-analyzer.js
│   └── test-iteration-engine.js
└── docs/
    ├── AGENT_PROTOCOL.md
    ├── QUICKREF.md
    ├── TROUBLESHOOTING.md
    └── WORKFLOWS.md
```

---

## How to Invoke Agents

Invoke agents explicitly in Copilot Chat with lowercase names:

```text
@orchestrator Process Jira ticket AOTF-16339 in UAT
```

```text
@testgenie Generate test cases for AOTF-16339
```

```text
@scriptgenerator Create automation for AOTF-16339 using the existing framework
```

```text
@buggenie Create a bug ticket for the latest failure in AOTF-16339
```

```text
@taskgenie Create a linked testing task for AOTF-16339
```

```text
@codereviewer Review tests/specs/aotf-16339/AOTF-16339.spec.js
```

```text
@filegenie Summarize the latest report files in test-results
```

```text
@docgenie Create a summary presentation from the latest QA artifacts
```

## Related Skills

The repository also includes project skills for presentation work:

- `use ppt-deck-setup` to calibrate shared deck style, audience preferences, and presentation rules
- `use professional-ppt-generator` to generate a polished PowerPoint from a brief, workbook, report, or meeting summary

Natural prompts such as "create an executive deck", "build a polished PowerPoint", or "turn this workbook into a slide deck" should also help Copilot discover the PPT skill in supported surfaces.

---

## How the QA Workflow Fits Together

The main QA flow is sequential even though the workspace contains multiple agents.

### Primary Workflow

1. Orchestrator accepts the request and decides whether the full pipeline is needed.
2. TestGenie generates manual test cases from Jira details.
3. ScriptGenerator performs live MCP exploration before generating automation.
4. The generated script is executed in the Playwright framework.
5. If execution fails, the SDK workflow can attempt self-healing.
6. BugGenie creates a defect when failures remain.
7. TaskGenie can create linked Testing tasks when needed.

### Review Workflow

CodeReviewer is typically used after script generation when you want standards validation or maintainability feedback.

### Utility Workflow

FileGenie and DocGenie are optional support tools and are not the core path for ticket-to-automation execution.

---

## What Each Core Agent Is Responsible For

### Orchestrator

- Routes work across agents
- Coordinates multi-step workflows
- Keeps the workflow aligned with the intended stage order
- Best entry point when the user wants the full QA process handled in one request

### TestGenie

- Reads Jira ticket context
- Generates manual test cases
- Produces markdown tables in chat and Excel outputs through the workflow scripts
- Best entry point when coverage design is needed before automation

### ScriptGenerator

- Explores the live application before writing code
- Uses MCP data rather than guessed selectors
- Generates Playwright `.spec.js` files that follow the framework pattern
- Best entry point when automation needs to be generated from validated exploration

### BugGenie

- Analyzes failed run context
- Produces review-ready defect content before Jira creation
- Creates or updates bug tickets based on execution outcomes
- Best entry point when failures should become structured issues

### TaskGenie

- Creates linked Jira Testing tasks
- Supports assignment to the current user
- Can include embedded test case content when appropriate
- Best entry point when delivery needs trackable testing work items

### CodeReviewer

- Reviews generated scripts against framework expectations
- Checks for reuse opportunities, selector quality, and pattern compliance
- Best entry point when a script should be validated before merge or reuse

---

## VS Code Expectations

To use these agents successfully:

1. Open the repository root in VS Code.
2. Use VS Code 1.107 or later.
3. Install GitHub Copilot and GitHub Copilot Chat.
4. Make sure the workspace-level configuration is loaded.
5. Configure [agentic-workflow/.env](../../agentic-workflow/.env) for Jira and environment access if you want the full QA workflow.

---

## Relationship to the SDK Pipeline

These agents are the conversational layer.

The SDK pipeline in [agentic-workflow/sdk-orchestrator](../../agentic-workflow/sdk-orchestrator) is the programmatic layer used for:

- Batch execution
- CI-style runs
- Retry and healing logic
- API and SSE integration for the dashboard

If you want reproducible command-driven execution, use the CLI documented in [agentic-workflow/docs/SDK_ORCHESTRATION.md](../../agentic-workflow/docs/SDK_ORCHESTRATION.md).

---

## Supporting Files

Useful companion docs in this folder:

- [docs/WORKFLOWS.md](docs/WORKFLOWS.md)
- [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md)
- [docs/QUICKREF.md](docs/QUICKREF.md)
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

Useful broader references:

- [../../README.md](../../README.md)
- [../../.github/copilot-instructions.md](../../.github/copilot-instructions.md)
- [../../agentic-workflow/docs/WORKFLOW_OVERVIEW.md](../../agentic-workflow/docs/WORKFLOW_OVERVIEW.md)
- [../../agentic-workflow/docs/SDK_ORCHESTRATION.md](../../agentic-workflow/docs/SDK_ORCHESTRATION.md)
- [../../agentic-workflow/docs/AUTOMATION_STANDARDS.md](../../agentic-workflow/docs/AUTOMATION_STANDARDS.md)

---

## Troubleshooting

### Agent Does Not Appear in Chat

Check:

1. The file exists in [.github/agents](.).
2. VS Code is new enough to support custom agent workflows.
3. Copilot Chat is enabled and signed in.

### Wrong Agent Is Being Used

Use explicit invocation with `@agentname` rather than relying on inference.

### Multi-Step Work Loses Context

Start with Orchestrator when the task spans more than one stage.

### Script Generation Quality Is Poor

Check that:

1. MCP exploration can reach the target environment.
2. Grounding is configured in [../../agentic-workflow/config/grounding-config.json](../../agentic-workflow/config/grounding-config.json).
3. The Playwright framework and test data are current.

For broader platform troubleshooting, see [../../README.md](../../README.md) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).