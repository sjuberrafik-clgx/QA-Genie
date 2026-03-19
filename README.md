# QA Automation Platform

AI-powered QA automation platform for turning Jira work into executable Playwright coverage with Copilot agents, MCP-first browser exploration, and an SDK-driven orchestration layer.

At a glance:

- Generate manual test cases from Jira tickets
- Explore the live application before generating selectors
- Create Playwright automation scripts inside the existing framework
- Execute, heal, and report failures through a structured pipeline
- Ground agent behavior with local framework context and external documentation
- Monitor runs through a dashboard and API layer

---

## Table of Contents

- [What This Platform Does](#what-this-platform-does)
- [Architecture Overview](#architecture-overview)
- [Agent Ecosystem](#agent-ecosystem)
- [Choose Your Entry Point](#choose-your-entry-point)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Project Structure](#project-structure)
- [Core Workflow](#core-workflow)
- [Grounding System](#grounding-system)
- [Knowledge Base Connector](#knowledge-base-connector)
- [Exploration Data and MCP Snapshots](#exploration-data-and-mcp-snapshots)
- [Running Tests](#running-tests)
- [Using the AI Agent Pipeline](#using-the-ai-agent-pipeline)
- [SDK Orchestrator CLI and API](#sdk-orchestrator-cli-and-api)
- [QA Dashboard](#qa-dashboard)
- [MCP Server](#mcp-server)
- [Key Configuration Files](#key-configuration-files)
- [Quality Gates and Self-Healing](#quality-gates-and-self-healing)
- [Documentation Index](#documentation-index)
- [Current Scope](#current-scope)
- [Troubleshooting](#troubleshooting)
- [Tech Stack](#tech-stack)

---

## What This Platform Does

This repository combines four working layers that can be used together or independently:

- A Playwright automation framework in [tests](tests)
- A Copilot agent workflow system in [.github/agents](.github/agents)
- An SDK orchestration layer in [agentic-workflow/sdk-orchestrator](agentic-workflow/sdk-orchestrator)
- A Next.js dashboard in [web-app](web-app)

The platform supports three common operating modes:

- Conversational QA workflows in VS Code through Copilot agents
- Programmatic execution through the SDK CLI and API
- Monitoring and review through the dashboard

Key capabilities implemented today:

- Jira ticket to test case generation through `@testgenie`
- MCP-first Playwright script generation through `@scriptgenerator`
- End-to-end orchestration through `@orchestrator`
- Self-healing retries with learning persistence in [agentic-workflow/sdk-orchestrator](agentic-workflow/sdk-orchestrator)
- Defect reporting through `@buggenie`
- Testing task creation through `@taskgenie`
- Script review through `@codereviewer`
- Local grounding from your codebase in [agentic-workflow/grounding](agentic-workflow/grounding)
- External documentation retrieval through [agentic-workflow/knowledge-base](agentic-workflow/knowledge-base)
- Real-time monitoring through [web-app](web-app)

---

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                             QA Automation Platform                          │
├─────────────────────┬───────────────────────────────┬────────────────────────┤
│ tests/              │ agentic-workflow/             │ web-app/               │
│                     │                               │                        │
│ Playwright framework│ Agent pipeline + SDK control  │ Dashboard + chat UI    │
│                     │                               │                        │
│ • specs             │ • 8 Copilot agents            │ • Pipeline monitoring  │
│ • pageobjects       │ • SDK orchestrator            │ • Results viewer       │
│ • business-functions│ • Unified MCP server          │ • Reports and history  │
│ • test-data         │ • Grounding system            │ • Agent interaction    │
│ • utils             │ • Knowledge base connector    │                        │
│                     │ • OODA quality checks         │                        │
├─────────────────────┴───────────────────────────────┴────────────────────────┤
│ Core flow: Jira → TestGenie → MCP exploration → ScriptGenerator → Execute  │
│            → Self-heal → BugGenie / TaskGenie → Dashboard reporting         │
└──────────────────────────────────────────────────────────────────────────────┘
```

How the layers connect in practice:

- The framework in [tests](tests) provides page objects, business functions, config, test data, and reusable utilities.
- The workflow layer in [agentic-workflow](agentic-workflow) coordinates agents, MCP exploration, grounding, quality gates, self-healing, and artifacts.
- The dashboard in [web-app](web-app) talks to the SDK server for pipeline status and run history.
- VS Code Copilot agent mode is the conversational entry point, while the SDK CLI/API is the programmatic entry point.

Execution model:

1. A user starts from Copilot chat, the SDK CLI, or the dashboard.
2. Orchestrator or the SDK pipeline routes work to the correct stage.
3. TestGenie and ScriptGenerator produce the manual and automation artifacts.
4. Execution, self-healing, and defect workflows close the loop.

---

## Agent Ecosystem

The workspace currently contains eight agent definitions. For new users, the useful split is core QA agents versus utility agents.

### Core QA Agents

| Agent | Invoke | Primary Output | When to Use |
|---|---|---|---|
| Orchestrator | `@orchestrator` | Coordinated multi-step pipeline | Use when you want ticket-to-execution flow handled end to end |
| TestGenie | `@testgenie` | Manual test cases in chat plus Excel export | Use when you want optimized manual test coverage from Jira |
| ScriptGenerator | `@scriptgenerator` | Playwright `.spec.js` automation scripts | Use when you want automation generated from live application exploration |
| BugGenie | `@buggenie` | Jira defect ticket draft and creation flow | Use when a failed run should become a structured bug |
| TaskGenie | `@taskgenie` | Linked Jira Testing tasks | Use when you need testing work items linked to parent tickets |
| CodeReviewer | `@codereviewer` | Review findings and script quality guidance | Use when generated automation should be checked against framework standards |

### Utility Agents

| Agent | Invoke | Primary Output | When to Use |
|---|---|---|---|
| FileGenie | `@filegenie` | File and document operations | Use for repository file handling and document-oriented workflows outside the main QA pipeline |
| DocGenie | `@docgenie` | Generated documents and report assets | Use for presentation, summary, or export-oriented deliverables |

Important distinctions:

- Test cases are manual QA steps generated by TestGenie.
- Automation scripts are Playwright `.spec.js` files generated by ScriptGenerator.
- Orchestrator coordinates the QA flow; it does not replace the specialized agents.
- FileGenie and DocGenie exist in the workspace but are not the primary path for the ticket-to-automation workflow.

---

## Choose Your Entry Point

Use the path that matches your workflow:

| You want to... | Best Entry Point |
|---|---|
| Work interactively in VS Code and collaborate with agents in chat | Copilot agents in [.github/agents](.github/agents) |
| Run repeatable pipelines, CI jobs, or batch execution | SDK CLI in [agentic-workflow/sdk-orchestrator/cli.js](agentic-workflow/sdk-orchestrator/cli.js) |
| Monitor runs, inspect results, and use a UI | Dashboard in [web-app](web-app) |

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Requirement | Version / Details | How to Verify |
|---|---|---|
| Node.js | `>= 18` | `node --version` |
| npm | Bundled with Node.js | `npm --version` |
| VS Code | `>= 1.107` for custom agents, subagents, and Agent HQ | `code --version` |
| GitHub Copilot extension | Latest | Install from VS Code Extensions |
| GitHub Copilot Chat extension | Latest | Install from VS Code Extensions |
| Git | Recent version | `git --version` |
| PowerShell 7 | Required on Windows for agent terminal execution | `pwsh --version` |
| Playwright browsers | At minimum Chromium | `npx playwright install chromium` |

Optional but effectively required for the full workflow:

| Requirement | Why It Matters |
|---|---|
| Jira / Atlassian access | Required for ticket reading, bug creation, and testing task creation |
| GitHub token or configured Copilot SDK credentials | Required for SDK orchestration flows |
| UAT environment URL | Required for MCP exploration and test execution |

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd "Adv + SDK - V1 - With Unified MCP - Dashboard V2 - Cognitive"
```

### 2. Install Dependencies

Install dependencies for all three runnable modules:

```bash
npm install

cd agentic-workflow
npm install

cd ../web-app
npm install

cd ..
```

### 3. Install Playwright Browsers

```bash
npx playwright install
```

### 4. Configure Environment Variables

Create and update [agentic-workflow/.env](agentic-workflow/.env).

At minimum, configure:

| Variable | Required For | Example |
|---|---|---|
| `JIRA_EMAIL` | Jira integration | `you@company.com` |
| `JIRA_API_TOKEN` | Jira integration | Atlassian API token |
| `JIRA_CLOUD_ID` | Jira integration | Your Atlassian cloud id |
| `JIRA_BASE_URL` | Jira integration | `https://your-org.atlassian.net/` |
| `JIRA_PROJECT_KEY` | Jira integration | `AOTF` |
| `UAT_URL` | Execution and exploration | Your UAT URL |

The workflow uses dynamic path resolution. For anything under config, scripts, exploration-data, docs, grounding, or the MCP server, the real paths are under [agentic-workflow](agentic-workflow).

### 5. Open in VS Code

```bash
code .
```

Once the workspace opens:

1. VS Code picks up the custom agents in [.github/agents](.github/agents).
2. The MCP server is configured through `.vscode/mcp.json`.
3. You can invoke agents in Copilot chat with commands like `@orchestrator`, `@testgenie`, or `@scriptgenerator`.

### 6. Optional First Commands

Use one of these as your first real validation:

```text
@testgenie Generate test cases for AOTF-16339
```

```text
@orchestrator Process Jira ticket AOTF-16339 in UAT
```

```bash
cd agentic-workflow
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode full
```

### 7. Optional Dashboard Startup

```bash
cd web-app
npm run dev:full
```

This starts:

- Frontend at `http://localhost:3001`
- SDK backend at `http://localhost:3100`

---

## Environment Configuration

All environment variables live in [agentic-workflow/.env](agentic-workflow/.env).

Resolution order:

1. `.env`
2. [agentic-workflow/config/workflow-config.json](agentic-workflow/config/workflow-config.json)
3. Auto-detection
4. Built-in defaults

### Credentials

| Variable | Description |
|---|---|
| `JIRA_EMAIL` | Jira / Atlassian email |
| `JIRA_API_TOKEN` | Jira API token |
| `GITHUB_TOKEN` | GitHub token for SDK / Copilot workflows |

### Jira Project

| Variable | Description |
|---|---|
| `JIRA_CLOUD_ID` | Atlassian Cloud ID |
| `JIRA_BASE_URL` | Jira base URL |
| `JIRA_PROJECT_KEY` | Jira project key |
| `JIRA_PROJECT_NAME` | Jira project display name |
| `JIRA_PROJECT_ID` | Numeric Jira project id |

### Environment URLs

| Variable | Description |
|---|---|
| `UAT_URL` | Primary automation target |
| `DEV_URL` | Development environment |
| `INT_URL` | Integration environment |
| `PROD_URL` | Production environment |

### Playwright and MCP Execution

| Variable | Default | Description |
|---|---|---|
| `BROWSER_TYPE` | `chromium` | Browser used for Playwright tests |
| `HEADLESS` | `true` | Headless execution for Playwright tests |
| `MCP_BROWSER` | `chromium` | Browser used for MCP exploration |
| `MCP_HEADLESS` | `true` | Headless execution for MCP exploration |
| `NAVIGATION_TIMEOUT` | `30000` | Navigation timeout in ms |
| `TEST_TIMEOUT` | `120000` | Test timeout in ms |

### SDK Orchestrator

| Variable | Default | Description |
|---|---|---|
| `SERVER_PORT` | `3100` | SDK API port |
| `COPILOT_MODEL` | Configured in `.env` | Model used by the SDK pipeline |
| `SDK_MAX_HEALING_ITERATIONS` | `3` | Maximum self-healing iterations |
| `SDK_PARALLEL_TICKETS` | `1` | Parallel ticket count |
| `SDK_ENABLE_LEARNING` | `true` | Enables learning persistence |

### Knowledge Base

| Variable | Description |
|---|---|
| `KB_ENABLED` | Master toggle for KB usage |
| `CONFLUENCE_BASE_URL` | Confluence base URL |
| `CONFLUENCE_SPACE_KEYS` | Optional restricted spaces |

### Framework Overrides

These are usually auto-detected. Override them only if your project layout differs from the standard framework structure.

| Variable | Description |
|---|---|
| `SPECS_DIR` | Path to spec files |
| `PAGE_OBJECTS_DIR` | Path to page objects |
| `CONFIG_DIR` | Path to config files |
| `TEST_DATA_FILE` | Path to test data file |
| `BUSINESS_FUNCTIONS_DIR` | Path to business functions |
| `UTILS_DIR` | Path to utilities |
| `ENUMS_DIR` | Path to enums/constants |

---

## Project Structure

```text
project-root/
├── .github/
│   ├── agents/                   # Agent definitions and agent documentation
│   └── copilot-instructions.md   # Central workflow rules and path mapping
├── tests/                        # Playwright framework
│   ├── specs/
│   ├── pageobjects/
│   ├── business-functions/
│   ├── config/
│   ├── test-data/
│   ├── utils/
│   └── enums/
├── agentic-workflow/             # Workflow engine, config, SDK, MCP, docs, artifacts
│   ├── config/
│   ├── docs/
│   ├── exploration-data/
│   ├── grounding/
│   ├── grounding-data/
│   ├── knowledge-base/
│   ├── learning-data/
│   ├── mcp-server/
│   ├── scripts/
│   ├── sdk-orchestrator/
│   ├── test-artifacts/
│   └── test-cases/
├── web-app/                      # Next.js dashboard and chat experience
├── Mobile-App/                   # Mobile-related workspace assets
├── playwright.config.js
├── package.json
└── README.md
```

---

## Core Workflow

The end-to-end QA flow is:

1. Jira ticket is fetched by TestGenie or Orchestrator.
2. TestGenie creates manual test cases and Excel output.
3. ScriptGenerator explores the live application with MCP before generating code.
4. ScriptGenerator creates Playwright automation scripts using verified selectors.
5. Playwright executes the generated automation.
6. The SDK orchestration layer applies quality gates and self-healing retries.
7. BugGenie creates a defect if failures remain.
8. TaskGenie can create linked testing tasks.
9. Results and artifacts are available through the dashboard and generated files.

---

## Grounding System

The grounding system gives agents accurate local context from your own framework instead of relying only on prompt text.

What it does:

- Indexes project files and reusable framework components
- Builds feature-aware context from page objects, business functions, and utilities
- Improves selector recommendations and reduces hallucinated automation patterns
- Supports feature maps, domain terminology, and retrieval settings

Primary files:

- [agentic-workflow/config/grounding-config.json](agentic-workflow/config/grounding-config.json)
- [agentic-workflow/grounding/grounding-store.js](agentic-workflow/grounding/grounding-store.js)
- [agentic-workflow/grounding/text-indexer.js](agentic-workflow/grounding/text-indexer.js)
- [agentic-workflow/grounding/selector-registry.js](agentic-workflow/grounding/selector-registry.js)

Useful commands:

```bash
node agentic-workflow/scripts/grounding-setup.js init
node agentic-workflow/scripts/grounding-setup.js rebuild
node agentic-workflow/scripts/grounding-setup.js validate
node agentic-workflow/scripts/grounding-setup.js query "search filters"
```

If you adopt this repository for a different application, updating [agentic-workflow/config/grounding-config.json](agentic-workflow/config/grounding-config.json) is one of the first things to do.

---

## Knowledge Base Connector

The knowledge-base layer extends grounding with external documentation sources such as Confluence, Notion, SharePoint, or custom REST providers.

What it does:

- Detects when external documentation is relevant
- Uses local cache first, then live provider fallback
- Injects relevant business documentation into agent context
- Lets the SDK layer fetch page content on demand

Primary files:

- [agentic-workflow/docs/KNOWLEDGE_BASE_SYSTEM.md](agentic-workflow/docs/KNOWLEDGE_BASE_SYSTEM.md)
- [agentic-workflow/knowledge-base/kb-connector.js](agentic-workflow/knowledge-base/kb-connector.js)
- [agentic-workflow/config/grounding-config.json](agentic-workflow/config/grounding-config.json)

Useful commands:

```bash
node agentic-workflow/scripts/kb-setup.js validate
node agentic-workflow/scripts/kb-setup.js init
node agentic-workflow/scripts/kb-setup.js query "property search filters"
node agentic-workflow/scripts/kb-setup.js sync
```

---

## Exploration Data and MCP Snapshots

Script generation is MCP-first. That means ScriptGenerator must explore the live application before it writes Playwright code.

Exploration artifacts are stored in [agentic-workflow/exploration-data](agentic-workflow/exploration-data).

These artifacts typically contain:

- Page URLs and navigation checkpoints
- Accessibility snapshot refs
- Extracted selectors and semantic locators
- Text and attribute evidence used for assertions
- Traceable input for later debugging and healing

This matters because the system is designed to avoid guessed selectors. Generated scripts are expected to come from real exploration data, not invented locators.

Reference material:

- [agentic-workflow/docs/MCP_TOOL_REFERENCE.md](agentic-workflow/docs/MCP_TOOL_REFERENCE.md)
- [agentic-workflow/docs/WORKFLOW_OVERVIEW.md](agentic-workflow/docs/WORKFLOW_OVERVIEW.md)

---

## Running Tests

All Playwright tests live in [tests/specs](tests/specs). Run them from the repository root:

```bash
npx playwright test
npx playwright test --headed
npx playwright test --debug
npx playwright test --ui
npx playwright show-report
```

Examples:

```bash
npx playwright test tests/specs/profile/
npx playwright test tests/specs/aotf-16461/AOTF-16461.spec.js
```

Default configuration highlights are defined in [playwright.config.js](playwright.config.js).

---

## Using the AI Agent Pipeline

Open Copilot Chat in VS Code and invoke an agent explicitly.

### Typical Commands

```text
@orchestrator Process Jira ticket AOTF-16339 in UAT
```

```text
@testgenie Generate test cases for AOTF-16339
```

```text
@scriptgenerator Create automation script for AOTF-16339
```

```text
@buggenie Create a bug ticket for the failures in AOTF-16339
```

```text
@taskgenie Create a linked testing task for AOTF-16339
```

```text
@codereviewer Review tests/specs/aotf-16339/AOTF-16339.spec.js
```

Requirements for agent workflows:

1. VS Code 1.107 or later
2. GitHub Copilot and GitHub Copilot Chat extensions installed
3. Workspace opened in VS Code so custom agents are available
4. [agentic-workflow/.env](agentic-workflow/.env) configured for Jira and environment access

More agent-specific guidance is available in [.github/agents/README.md](.github/agents/README.md).

---

## SDK Orchestrator CLI and API

The SDK orchestrator is the programmatic version of the workflow. It is the right path for CI, batch runs, and the dashboard backend.

CLI examples:

```bash
cd agentic-workflow
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode full
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode heal
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode execute
node sdk-orchestrator/cli.js --tickets AOTF-001,AOTF-002 --parallel
node sdk-orchestrator/cli.js --ticket AOTF-16339 --ci
```

Supported modes are documented in [agentic-workflow/docs/SDK_ORCHESTRATION.md](agentic-workflow/docs/SDK_ORCHESTRATION.md).

API server examples:

```bash
cd agentic-workflow
npm run sdk:server
npm run sdk:server:dev
```

The server provides REST and SSE endpoints used by the dashboard.

---

## QA Dashboard

The dashboard is a Next.js application in [web-app](web-app) for pipeline monitoring, run history, reports, and agent-driven interactions.

Start it with:

```bash
cd web-app
npm run dev
```

Or run frontend and backend together:

```bash
cd web-app
npm run dev:full
```

Default local URLs:

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:3100`

---

## MCP Server

The unified MCP server lives in [agentic-workflow/mcp-server](agentic-workflow/mcp-server).

It provides the live browser automation and inspection layer used by ScriptGenerator and related workflows.

Key responsibilities:

- Browser navigation and snapshots
- Semantic element targeting
- Content extraction for assertions
- State inspection and verification
- Advanced exploration through frames, shadow DOM, storage, downloads, and network hooks

The tool catalog evolves, so treat [agentic-workflow/docs/MCP_TOOL_REFERENCE.md](agentic-workflow/docs/MCP_TOOL_REFERENCE.md) as the authoritative reference instead of relying on hardcoded counts in secondary docs.

---

## Key Configuration Files

| File | Purpose | Notes |
|---|---|---|
| [agentic-workflow/.env](agentic-workflow/.env) | Credentials, URLs, runtime toggles | Per environment |
| [agentic-workflow/config/workflow-config.json](agentic-workflow/config/workflow-config.json) | Pipeline stages, SDK behavior, quality gates | Operational control center |
| [agentic-workflow/config/grounding-config.json](agentic-workflow/config/grounding-config.json) | Feature map, domain terms, KB config | Update for each application domain |
| [agentic-workflow/config/assertion-config.json](agentic-workflow/config/assertion-config.json) | Assertion generation patterns | Used during script generation |
| [playwright.config.js](playwright.config.js) | Root Playwright test runner config | Framework-level runtime settings |
| [tests/test-data](tests/test-data) | Tokens, credentials, base URLs | Environment-aware test inputs |

---

## Quality Gates and Self-Healing

Two major protection layers exist beyond plain script generation.

### OODA Quality Checks

The workflow includes deterministic health and exploration checks configured through [agentic-workflow/config/workflow-config.json](agentic-workflow/config/workflow-config.json).

These checks help answer:

- Is the target environment reachable before a long run starts?
- Is the MCP snapshot good enough to trust for generation?
- Should the pipeline proceed, warn, or retry?

### Self-Healing Loop

The SDK orchestration layer can re-run failing automation after analysis and repair attempts.

It uses:

- Error analysis
- Exploration evidence
- Learning persistence in [agentic-workflow/learning-data](agentic-workflow/learning-data)
- Controlled retry counts from configuration

Reference material:

- [agentic-workflow/docs/SDK_ORCHESTRATION.md](agentic-workflow/docs/SDK_ORCHESTRATION.md)
- [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

## Documentation Index

### Start Here

- [README.md](README.md)
- [.github/agents/README.md](.github/agents/README.md)
- [agentic-workflow/docs/WORKFLOW_OVERVIEW.md](agentic-workflow/docs/WORKFLOW_OVERVIEW.md)

### For QA Engineers

- [agentic-workflow/docs/TESTGENIE_DATA_FLOW.md](agentic-workflow/docs/TESTGENIE_DATA_FLOW.md)
- [agentic-workflow/docs/EXCEL_TEMPLATE_SYSTEM.md](agentic-workflow/docs/EXCEL_TEMPLATE_SYSTEM.md)
- [agentic-workflow/docs/WORKFLOW_USAGE.md](agentic-workflow/docs/WORKFLOW_USAGE.md)

### For Automation Script Developers

- [agentic-workflow/docs/AUTOMATION_STANDARDS.md](agentic-workflow/docs/AUTOMATION_STANDARDS.md)
- [agentic-workflow/docs/MCP_TOOL_REFERENCE.md](agentic-workflow/docs/MCP_TOOL_REFERENCE.md)
- [agentic-workflow/docs/ASSERTION_CONFIG_SYSTEM.md](agentic-workflow/docs/ASSERTION_CONFIG_SYSTEM.md)

### For Platform Maintainers

- [agentic-workflow/docs/SDK_ORCHESTRATION.md](agentic-workflow/docs/SDK_ORCHESTRATION.md)
- [agentic-workflow/docs/KNOWLEDGE_BASE_SYSTEM.md](agentic-workflow/docs/KNOWLEDGE_BASE_SYSTEM.md)
- [agentic-workflow/docs/CROSS_BROWSER_STRATEGY.md](agentic-workflow/docs/CROSS_BROWSER_STRATEGY.md)
- [.github/copilot-instructions.md](.github/copilot-instructions.md)

### For Troubleshooting

- [.github/agents/docs/TROUBLESHOOTING.md](.github/agents/docs/TROUBLESHOOTING.md)
- [agentic-workflow/docs/WORKFLOW_IMPROVEMENTS.md](agentic-workflow/docs/WORKFLOW_IMPROVEMENTS.md)

---

## Current Scope

Implemented and ready to use:

- Jira-driven test case generation
- MCP-first automation generation
- Playwright execution in the provided framework
- SDK orchestration and API-backed runs
- Self-healing retries with learning data
- Defect reporting and testing-task creation
- Dashboard monitoring and reporting
- Local grounding and external knowledge-base support

Still depends on your environment and configuration quality:

- Stable access to Jira and target environments
- Correct project-specific grounding configuration
- Accurate test data and token setup
- Stable application behavior during MCP exploration

---

## Troubleshooting

### Agents Not Appearing in VS Code

Check the following:

1. The workspace is opened at the repository root.
2. Agent files exist under [.github/agents](.github/agents).
3. VS Code and Copilot extensions are up to date.
4. You are invoking the agents in Copilot Chat, not a plain terminal.

### Script Generation Lacks Good Selectors

Check the following:

1. The target environment is reachable.
2. MCP exploration completed and artifacts exist in [agentic-workflow/exploration-data](agentic-workflow/exploration-data).
3. Grounding is configured for your application in [agentic-workflow/config/grounding-config.json](agentic-workflow/config/grounding-config.json).

### Jira Actions Fail

Check the following:

1. Jira credentials in [agentic-workflow/.env](agentic-workflow/.env).
2. Atlassian URLs and cloud id values.
3. Project key and permissions for reading or creating issues.

### Dashboard Cannot Reach Backend

Check the following:

1. The SDK server is running from [agentic-workflow](agentic-workflow).
2. `NEXT_PUBLIC_BACKEND_URL` matches your backend URL.
3. `SERVER_PORT` and frontend expectations are aligned.

---

## Tech Stack

| Layer | Main Technologies |
|---|---|
| Test automation | Playwright, JavaScript, CommonJS |
| Agent workflows | GitHub Copilot custom agents, VS Code agent mode |
| Orchestration | GitHub Copilot SDK, Node.js |
| Browser automation bridge | Unified MCP server, Playwright, Chrome DevTools integration |
| Dashboard | Next.js 15, React 19, Tailwind CSS |
| External integrations | Jira / Atlassian APIs, Confluence, custom knowledge providers |

For agent-specific workflow commands and examples, see [.github/agents/README.md](.github/agents/README.md).