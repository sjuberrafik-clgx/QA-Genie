# QA Automation Platform

AI-powered 5-agent QA automation with Playwright, MCP, and GitHub Copilot SDK.

Automates the full QA lifecycle — from Jira ticket to test case generation, Playwright script creation via live browser exploration, test execution with self-healing, and defect reporting — all orchestrated through VS Code Copilot agents or a programmatic CLI/API pipeline.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Using the AI Agent Pipeline](#using-the-ai-agent-pipeline)
- [SDK Orchestrator (CLI & API)](#sdk-orchestrator-cli--api)
- [QA Dashboard](#qa-dashboard)
- [MCP Server](#mcp-server)
- [Key Configuration Files](#key-configuration-files)
- [Troubleshooting](#troubleshooting)
- [Documentation Index](#documentation-index)
- [Tech Stack](#tech-stack)

---

## Architecture Overview

The project has three main modules:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        QA Automation Platform                       │
├────────────────────┬───────────────────────┬────────────────────────┤
│   tests/           │  agentic-workflow/    │  web-app/              │
│                    │                       │                        │
│  Playwright Test   │  AI Pipeline          │  QA Dashboard          │
│  Framework         │                       │                        │
│                    │  ┌─────────────────┐  │  Next.js 15 + React 19 │
│  • Page Objects    │  │  5 Copilot      │  │  + Tailwind CSS        │
│  • Business Funcs  │  │  Agents         │  │                        │
│  • Test Specs      │  ├─────────────────┤  │  • Real-time pipeline  │
│  • Test Data       │  │  MCP Server     │  │    monitoring (SSE)    │
│  • Utils           │  │  (141 tools)    │  │  • Agent chat          │
│                    │  ├─────────────────┤  │  • Reports & analytics │
│                    │  │  SDK            │  │  • Test results        │
│                    │  │  Orchestrator   │  │                        │
│                    │  └─────────────────┘  │                        │
├────────────────────┴───────────────────────┴────────────────────────┤
│  Pipeline: Jira → TestGenie → ScriptGenerator (MCP) → Execute      │
│            → Self-Heal → BugGenie (if failures)                     │
└─────────────────────────────────────────────────────────────────────┘
```

**How they connect:**

- The **AI Pipeline** generates and executes test scripts in the `tests/` framework
- The **QA Dashboard** connects to the SDK Orchestrator backend (port 3100) for real-time pipeline control
- The **MCP Server** provides 141 browser automation tools that agents use during live exploration
- **VS Code** ties everything together — agents run in Copilot chat, MCP server auto-starts via `.vscode/mcp.json`

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Requirement | Version / Details | How to Verify |
|---|---|---|
| **Node.js** | >= 18.0.0 | `node --version` |
| **npm** | Comes with Node.js | `npm --version` |
| **VS Code** | >= 1.107 (required for agent mode, subagents, Agent HQ) | `code --version` |
| **GitHub Copilot Extension** | Latest — install from VS Code Extensions | Extensions panel → search "GitHub Copilot" |
| **GitHub Copilot Chat Extension** | Latest — enables agent mode (`@agent` commands) | Extensions panel → search "GitHub Copilot Chat" |
| **Git** | Any recent version | `git --version` |
| **PowerShell 7** | Required on Windows (agents execute terminal commands via PowerShell) | `pwsh --version` |
| **GitHub Copilot SDK** | ^0.1.22 | AI agent orchestration and Copilot chat integration |
npm install @github/copilot-sdk
| **Copilot CLI — install globally for orchestration via terminal**
npm install -g @github/copilot




### Optional (for full pipeline)

| Requirement | Details |
|---|---|
| **Jira / Atlassian access** | Needed for TestGenie (fetches tickets) and BugGenie (creates defects). Requires API token. |
| **Atlassian MCP Server** | Configured automatically in `.vscode/mcp.json` for Jira integration |

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd "Adv + SDK - V1 - With Unified MCP - Dashboard"
```

### 2. Install Dependencies

Three separate `npm install` commands — one for each module:

```bash
# Root — Playwright test framework
npm install

# Agentic workflow — AI pipeline, MCP server, SDK orchestrator
cd agentic-workflow
npm install

# Web app — QA Dashboard
cd ../web-app
npm install

# Return to root
cd ..
```

> **Note:** `agentic-workflow/npm install` automatically runs `cd mcp-server && npm install` via postinstall script.

### 3. Install Playwright Browsers

```bash
npx playwright install
```

This downloads Chromium, Firefox, and WebKit browsers. At minimum, Chromium is required.

### 4. Configure Environment Variables

```bash
cd agentic-workflow
cp .env.example .env
```

Open `agentic-workflow/.env` and fill in your values. At minimum, you need:

| Variable | Required For | Example |
|---|---|---|
| `JIRA_EMAIL` | Jira integration | `you@company.com` |
| `JIRA_API_TOKEN` | Jira integration | Generate at https://id.atlassian.net/manage-profile/security/api-tokens |
| `JIRA_CLOUD_ID` | Jira integration | Found in your Atlassian admin |
| `JIRA_BASE_URL` | Jira integration | `https://your-org.atlassian.net/` |
| `JIRA_PROJECT_KEY` | Jira integration | e.g., `AOTF` |
| `UAT_URL` | Test execution | Your UAT environment URL |

All other variables have sensible defaults. See [Environment Configuration](#environment-configuration) for the full list.

### 5. Open in VS Code

```bash
code .
```

When VS Code opens:

1. **MCP Server auto-starts** — The Unified Automation MCP server starts automatically via `.vscode/mcp.json` (stdio transport). No manual action needed.
2. **Agents become available** — In Copilot chat, you can now use `@orchestrator`, `@testgenie`, `@scriptgenerator`, `@buggenie`, and `@codereviewer`.

### 6. Start the Dashboard (Optional)

```bash
cd web-app
npm run dev:full
```

This starts both:
- **Frontend** — QA Dashboard at http://localhost:3001
- **Backend** — SDK Orchestrator API at http://localhost:3100

---

## Environment Configuration

All environment variables live in `agentic-workflow/.env`. Copy from `agentic-workflow/.env.example` and fill in your values.

**Priority chain:** `.env` → `workflow-config.json` → auto-detect → built-in defaults

### 1. Credentials

| Variable | Description |
|---|---|
| `JIRA_EMAIL` | Your Jira/Atlassian email address |
| `JIRA_API_TOKEN` | Jira API token ([generate here](https://id.atlassian.net/manage-profile/security/api-tokens)) |
| `GITHUB_TOKEN` | GitHub personal access token (for Copilot SDK) |

### 2. Jira Project

| Variable | Description |
|---|---|
| `JIRA_CLOUD_ID` | Atlassian Cloud ID for your organization |
| `JIRA_BASE_URL` | Atlassian base URL (e.g., `https://your-org.atlassian.net/`) |
| `JIRA_PROJECT_KEY` | Project key in Jira (e.g., `AOTF`) |
| `JIRA_PROJECT_NAME` | Project display name |
| `JIRA_PROJECT_ID` | Numeric project ID |

### 3. Environment URLs

| Variable | Description |
|---|---|
| `UAT_URL` | UAT environment URL (primary test target) |
| `DEV_URL` | Development environment URL |
| `INT_URL` | Integration environment URL |
| `PROD_URL` | Production environment URL |

### 4. Backend Server

| Variable | Default | Description |
|---|---|---|
| `SERVER_PORT` | `3100` | SDK Orchestrator API port |
| `CORS_ORIGINS` | `http://localhost:3001` | Allowed CORS origins (dashboard URL) |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3100` | Backend URL used by the dashboard |

### 5. Test Browser (Playwright Tests)

| Variable | Default | Description |
|---|---|---|
| `BROWSER_TYPE` | `chromium` | Browser for tests (`chromium`, `firefox`, `webkit`) |
| `HEADLESS` | `true` | Run tests without visible browser window |
| `NAVIGATION_TIMEOUT` | `30000` | Page navigation timeout (ms) |
| `TEST_TIMEOUT` | `120000` | Individual test timeout (ms) |

### 6. MCP Browser (Live Exploration)

| Variable | Default | Description |
|---|---|---|
| `MCP_HEADLESS` | `true` | Run MCP browser headless (set to `false` to watch exploration) |
| `MCP_BROWSER` | `chromium` | Browser for MCP exploration |
| `MCP_TIMEOUT` | `60000` | MCP operation timeout (ms) |
| `MCP_TOOL_TIMEOUT` | `30000` | Individual tool call timeout (ms) |
| `MCP_LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

### 7. SDK Orchestrator

| Variable | Default | Description |
|---|---|---|
| `COPILOT_MODEL` | `claude-sonnet-4-20250514` | AI model for Copilot SDK |
| `COPILOT_CLI_URL` | — | Copilot CLI endpoint URL |
| `SDK_MAX_HEALING_ITERATIONS` | `3` | Max self-healing retry attempts |
| `SDK_PARALLEL_TICKETS` | `1` | Number of parallel ticket pipelines |
| `SDK_ENABLE_LEARNING` | `true` | Enable learning from past runs |

### 8. Reporting

| Variable | Description |
|---|---|
| `MODULE_NAME` | Module name for reports |
| `TEST_CYCLE` | Test cycle identifier |

### 9. CI / CD

| Variable | Default | Description |
|---|---|---|
| `CI` | `false` | Set to `true` in CI pipelines (enables exit codes, disables interactive features) |

### 10. Framework Overrides (Optional)

These are auto-detected by default. Only set them if your project structure differs from the standard layout.

| Variable | Default | Description |
|---|---|---|
| `FRAMEWORK_MODE` | `auto` | Framework detection mode |
| `SPECS_DIR` | Auto-detected | Path to test spec files |
| `PAGE_OBJECTS_DIR` | Auto-detected | Path to page objects |
| `CONFIG_DIR` | Auto-detected | Path to config files |
| `TEST_DATA_FILE` | Auto-detected | Path to test data file |
| `BUSINESS_FUNCTIONS_DIR` | Auto-detected | Path to business functions |
| `UTILS_DIR` | Auto-detected | Path to utility files |
| `ENUMS_DIR` | Auto-detected | Path to enum/constant files |

---

## Project Structure

```
project-root/
│
├── .github/agents/              # 5 Copilot agent definitions
│   ├── orchestrator.agent.md    #   Master pipeline coordinator
│   ├── testgenie.agent.md       #   Test case generator (Jira → Excel)
│   ├── scriptgenerator.agent.md #   Playwright script generator (MCP-first)
│   ├── buggenie.agent.md        #   Defect ticket creator
│   ├── codereviewer.agent.md    #   Script quality reviewer
│   ├── lib/                     #   Shared JS modules for agents
│   └── docs/                    #   Agent protocol & troubleshooting docs
│
├── tests/                       # Playwright test framework
│   ├── specs/                   #   Test spec files (.spec.js)
│   ├── pageobjects/             #   Page Object Model classes
│   │   └── POmanager.js         #     Central page object manager
│   ├── business-functions/      #   Reusable business logic (login, search, etc.)
│   ├── config/                  #   Browser config & launcher
│   ├── test-data/               #   Test tokens, URLs, credentials
│   ├── utils/                   #   Utility helpers
│   └── enums/                   #   Constants & enumerations
│
├── agentic-workflow/            # AI pipeline & tooling
│   ├── .env.example             #   Environment variable template
│   ├── config/                  #   Pipeline & assertion configuration
│   ├── mcp-server/              #   Unified MCP Server (141 tools)
│   │   ├── server.js            #     Main server entry point
│   │   ├── bridges/             #     Playwright & ChromeDevTools bridges
│   │   ├── router/              #     Intelligent tool routing
│   │   └── tools/               #     Tool definitions (core + enhanced + advanced)
│   ├── sdk-orchestrator/        #   Copilot SDK pipeline controller
│   │   ├── cli.js               #     CLI entry point
│   │   ├── server.js            #     HTTP/SSE API server
│   │   └── enforcement-hooks.js #     MCP exploration enforcement
│   ├── orchestrator/            #   Workflow orchestrator
│   ├── scripts/                 #   Excel generator, validators, setup
│   ├── docs/                    #   Detailed documentation (11 files)
│   ├── exploration-data/        #   MCP exploration snapshots (per ticket)
│   ├── test-cases/              #   Generated Excel test cases
│   └── test-artifacts/          #   Run history, reports, context stores
│
├── web-app/                     # QA Dashboard (Next.js 15)
│   ├── src/
│   │   ├── app/                 #   Pages: dashboard, chat, history, reports, results, analytics
│   │   ├── components/          #   19 React components
│   │   ├── hooks/               #   usePipeline, useSSE
│   │   └── lib/                 #   API client, constants, utilities
│   └── package.json
│
├── .vscode/mcp.json             # MCP server auto-start config for VS Code
├── playwright.config.js         # Root Playwright configuration
├── package.json                 # Root dependencies
└── README.md                    # ← You are here
```

---

## Running Tests

All Playwright tests live in `tests/specs/`. Run them from the **project root**:

```bash
# Run all tests
npx playwright test

# Run tests with visible browser
npx playwright test --headed

# Run a specific spec folder
npx playwright test tests/specs/profile/

# Run a specific spec file
npx playwright test tests/specs/aotf-16461/AOTF-16461.spec.js

# Debug mode (step through tests)
npx playwright test --debug

# Interactive UI mode
npx playwright test --ui

# View the HTML report after a run
npx playwright show-report
```

**Default configuration** (from `playwright.config.js`):

| Setting | Value |
|---|---|
| Timeout | 120 seconds per test |
| Workers | 1 (sequential) |
| Retries | 0 |
| Trace | Retained on failure |
| Browser | Chromium (default, configurable via `BROWSER_TYPE` env var) |

**Selecting environment:** Tests default to UAT. Set environment variables in `agentic-workflow/.env` to switch:

```bash
# In .env or as env vars before running:
USE_DEV=true    # Use DEV environment
USE_INT=true    # Use INT environment
USE_PROD=true   # Use PROD environment
# (default: UAT when none are set)
```

---

## Using the AI Agent Pipeline

The project includes 5 AI agents that run inside **VS Code Copilot chat** (agent mode). Open the Copilot chat panel and mention an agent by name:

### Agents

| Agent | Command | What It Does |
|---|---|---|
| **Orchestrator** | `@orchestrator` | Master coordinator — runs the full pipeline from Jira ticket to executed tests. Delegates to other agents. |
| **TestGenie** | `@testgenie` | Generates test cases from a Jira ticket. Output: Excel file + markdown table in chat. |
| **ScriptGenerator** | `@scriptgenerator` | Generates Playwright `.spec.js` scripts using live MCP browser exploration. Never guesses selectors. |
| **BugGenie** | `@buggenie` | Creates Jira defect tickets from test failures. Two-step process: review → create. |
| **CodeReviewer** | `@codereviewer` | Reviews generated scripts for quality, patterns, and standards compliance. |

### Example: Full Pipeline

```
@orchestrator Process Jira ticket AOTF-16339 — generate test cases, create automation script, and execute
```

This triggers the full pipeline:

```
1. Fetches ticket from Jira (via Atlassian MCP)
2. TestGenie generates test cases → Excel + chat markdown
3. ScriptGenerator explores the app via MCP (141 browser tools)
4. ScriptGenerator creates .spec.js with real selectors from exploration
5. Test executes via Playwright
6. If failures → self-healing retry (up to 3 attempts)
7. If still failing → BugGenie creates a Jira defect ticket
```

### Example: Individual Agents

```
@testgenie Generate test cases for AOTF-16339

@scriptgenerator Create automation script for AOTF-16339

@buggenie Create a bug ticket for the failures in AOTF-16339

@codereviewer Review the script at tests/specs/aotf-16339/AOTF-16339.spec.js
```

### Requirements for Agents to Work

1. **VS Code 1.107+** — Older versions don't support agent mode / subagents
2. **GitHub Copilot + Copilot Chat extensions** — Must be installed and signed in
3. **MCP Server running** — Auto-starts via `.vscode/mcp.json` when VS Code opens the workspace
4. **`.env` configured** — Jira credentials needed for TestGenie and BugGenie

---

## SDK Orchestrator (CLI & API)

The SDK Orchestrator provides a **programmatic interface** to the agent pipeline — use it for CI/CD, batch processing, or the QA Dashboard backend.

### CLI Usage

```bash
cd agentic-workflow

# Full pipeline for a single ticket
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode full

# Generate + heal only (skip test case generation)
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode heal

# Execute only (run existing scripts)
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode execute

# Multiple tickets in parallel
node sdk-orchestrator/cli.js --tickets AOTF-001,AOTF-002 --parallel

# CI mode (returns exit code 0 for pass, 1 for failures)
node sdk-orchestrator/cli.js --ticket AOTF-16339 --ci
```

### HTTP / SSE API Server

```bash
cd agentic-workflow

# Start the API server (default port 3100)
npm run sdk:server

# Start with verbose logging
npm run sdk:server:dev
```

The server exposes REST endpoints and SSE streams for real-time pipeline progress. The QA Dashboard connects to this server.

> See [agentic-workflow/docs/SDK_ORCHESTRATION.md](agentic-workflow/docs/SDK_ORCHESTRATION.md) for the full API reference.

---

## QA Dashboard

A Next.js 15 web application for monitoring and interacting with the automation pipeline.

### Starting

```bash
cd web-app

# Frontend only (port 3001)
npm run dev

# Frontend + Backend together (recommended)
npm run dev:full
```

Then open http://localhost:3001 in your browser.

### Pages

| Page | Path | Description |
|---|---|---|
| Dashboard | `/dashboard` | Overview of pipeline runs, stats, and status |
| Chat | `/chat` | Interactive chat interface to trigger agents |
| History | `/history` | Past pipeline run history |
| Reports | `/reports` | Consolidated test reports |
| Results | `/results` | Detailed test result viewer with tree navigation |
| Analytics | `/analytics` | Testing analytics and metrics |

### Backend Connection

The dashboard communicates with the SDK Orchestrator API via:
- **REST API** — Pipeline triggers, status queries
- **SSE (Server-Sent Events)** — Real-time pipeline stage progress

Default backend URL: `http://localhost:3100` (configurable via `NEXT_PUBLIC_BACKEND_URL` in `.env`).

---

## MCP Server

The **Unified Automation MCP Server** provides 141 browser automation tools that AI agents use for live application exploration.

### How It Works

1. **Auto-starts in VS Code** — Configured in `.vscode/mcp.json` as a stdio transport server
2. **Agents call tools** — During script generation, `@scriptgenerator` navigates your app, takes accessibility snapshots, extracts real selectors, and validates elements — all via MCP tool calls
3. **Two bridges** — Playwright for primary automation, ChromeDevTools for performance/network analysis and failure recovery

### Tool Categories (141 total)

| Category | Examples | Count |
|---|---|---|
| Navigation & Page | navigate, back, forward, reload, tabs, resize | ~12 |
| Snapshot & Discovery | snapshot, get_by_role, get_by_text, get_by_test_id, generate_locator | ~9 |
| Interaction | click, type, fill_form, select_option, check, hover, drag, press_key | ~18 |
| Element State | is_visible, is_enabled, get_attribute, get_text_content, get_input_value | ~14 |
| Assertions | expect_url, expect_title, expect_element_text, verify_element_visible | ~14 |
| Wait & Sync | wait_for, wait_for_element, wait_for_response, wait_for_new_page | ~6 |
| Network & Performance | network_requests, performance_trace, console_messages | ~8 |
| Storage & Cookies | get/set/clear cookies, localStorage, sessionStorage, indexedDB | ~12 |
| Frames & Shadow DOM | list_frames, switch_to_frame, shadow_dom_query, shadow_pierce | ~6 |
| Browser Context | create/switch/list/close context, auth state save/load | ~6 |
| Visual & Recording | screenshot, screenshot_compare, start/stop_video | ~6 |
| Advanced | evaluate JS, run_playwright_code, accessibility_audit, geolocation, locale | ~30+ |

### Manual Start (if needed)

The MCP server normally auto-starts in VS Code. If you need to start it manually:

```bash
cd agentic-workflow

# stdio mode (default, for VS Code)
npm run mcp:unified

# HTTP mode (for external tools)
node mcp-server/server.js --transport=http --port=3000

# Dev mode with auto-reload
cd mcp-server && npm run dev
```

> See [agentic-workflow/mcp-server/README.md](agentic-workflow/mcp-server/README.md) for the full tool reference.

---

## Key Configuration Files

| File | Purpose |
|---|---|
| `agentic-workflow/.env` | Secrets, credentials, environment URLs, server ports, browser settings |
| `agentic-workflow/config/workflow-config.json` | Pipeline stages, MCP exploration rules, quality gates, selector strategy, self-healing config |
| `agentic-workflow/config/assertion-config.json` | Assertion patterns and rules for Playwright (1600+ lines of assertion guidance) |
| `.vscode/mcp.json` | MCP server auto-start configuration for VS Code |
| `playwright.config.js` | Root Playwright test configuration (timeout, workers, retries, trace) |
| `tests/test-data/testData.js` | Test tokens, user credentials, and base URLs per environment |
| `tests/pageobjects/POmanager.js` | Central Page Object Manager — all page objects accessed through this |

---

## Troubleshooting

### MCP server not starting

**Symptom:** Agents can't explore the application, `@scriptgenerator` fails immediately.

**Fix:**
1. Check Node.js version: `node --version` (must be >= 18.0.0)
2. Ensure MCP server dependencies are installed:
   ```bash
   cd agentic-workflow/mcp-server
   npm install
   ```
3. Test the server manually:
   ```bash
   node server.js
   ```
   You should see `[UnifiedMCP] Server initialized successfully`
4. Verify `.vscode/mcp.json` exists and has the `unified-automation-mcp` entry

### Playwright browsers not installed

**Symptom:** `browserType.launch: Executable doesn't exist` error.

**Fix:**
```bash
npx playwright install
```

### `.env` file missing or incomplete

**Symptom:** `Error: JIRA_EMAIL is not configured` or similar missing credential errors.

**Fix:**
```bash
cd agentic-workflow
cp .env.example .env
# Edit .env with your values
```

### Tests timing out

**Symptom:** Tests fail with `Test timeout of 120000ms exceeded`.

**Fix:** Increase timeouts in `agentic-workflow/.env`:
```dotenv
NAVIGATION_TIMEOUT=60000
TEST_TIMEOUT=180000
```

### Agents not appearing in Copilot chat

**Symptom:** Typing `@orchestrator` doesn't auto-complete or shows "no agent found".

**Fix:**
1. Update VS Code to **1.107 or later**
2. Install/update **GitHub Copilot** and **GitHub Copilot Chat** extensions
3. Ensure you're signed in to GitHub Copilot
4. Reload VS Code window: `Ctrl+Shift+P` → "Developer: Reload Window"
5. Verify `.github/agents/` directory exists with all 5 `.agent.md` files

### Dashboard not connecting to backend

**Symptom:** Dashboard loads but shows no data, "connection refused" in browser console.

**Fix:**
1. Start the backend: `cd web-app && npm run dev:full` (starts both frontend and backend)
2. Or start backend separately: `cd agentic-workflow && npm run sdk:server`
3. Ensure `NEXT_PUBLIC_BACKEND_URL` in `.env` matches the server port (default: `http://localhost:3100`)
4. Check `CORS_ORIGINS` in `.env` includes `http://localhost:3001`

### Jira integration failing

**Symptom:** TestGenie can't fetch tickets, BugGenie can't create defects.

**Fix:**
1. Verify all Jira variables in `agentic-workflow/.env`:
   - `JIRA_EMAIL` — your Atlassian email
   - `JIRA_API_TOKEN` — generate at https://id.atlassian.net/manage-profile/security/api-tokens
   - `JIRA_CLOUD_ID` — from your Atlassian admin settings
   - `JIRA_BASE_URL` — e.g., `https://your-org.atlassian.net/`
   - `JIRA_PROJECT_KEY` — e.g., `AOTF`
2. Verify the Atlassian MCP server is configured in `.vscode/mcp.json`

### Script generation produces inaccurate selectors

**Symptom:** Generated `.spec.js` files fail because selectors don't match the live application.

**Fix:** This usually means the MCP exploration was incomplete. The system enforces:
- At least 1 semantic selector validation (`get_by_role` or `get_by_test_id`)
- At least 1 content extraction (`get_text_content` or `get_attribute`)
- At least 1 navigation verification (`get_page_url` or `expect_url`)

If scripts still fail, try running `@scriptgenerator` again — the self-healing system will retry with fresh exploration.

> **For more troubleshooting:** See [.github/agents/docs/TROUBLESHOOTING.md](.github/agents/docs/TROUBLESHOOTING.md)

---

## Documentation Index

Detailed documentation is available across two locations:

### Pipeline & Workflow Docs (`agentic-workflow/docs/`)

| Document | Description |
|---|---|
| [WORKFLOW_OVERVIEW.md](agentic-workflow/docs/WORKFLOW_OVERVIEW.md) | Complete architecture overview with diagrams |
| [WORKFLOW_USAGE.md](agentic-workflow/docs/WORKFLOW_USAGE.md) | Usage guide — setup, quick start, agent commands |
| [SDK_ORCHESTRATION.md](agentic-workflow/docs/SDK_ORCHESTRATION.md) | SDK orchestrator architecture and API reference |
| [AUTOMATION_STANDARDS.md](agentic-workflow/docs/AUTOMATION_STANDARDS.md) | Script coding standards and best practices |
| [MCP_TOOL_REFERENCE.md](agentic-workflow/docs/MCP_TOOL_REFERENCE.md) | MCP tool reference and usage patterns |
| [ENHANCED_MCP_TOOLS.md](agentic-workflow/docs/ENHANCED_MCP_TOOLS.md) | Enhanced MCP tools documentation |
| [ASSERTION_CONFIG_SYSTEM.md](agentic-workflow/docs/ASSERTION_CONFIG_SYSTEM.md) | Assertion configuration system |
| [CROSS_BROWSER_STRATEGY.md](agentic-workflow/docs/CROSS_BROWSER_STRATEGY.md) | Cross-browser testing strategy |
| [EXCEL_TEMPLATE_SYSTEM.md](agentic-workflow/docs/EXCEL_TEMPLATE_SYSTEM.md) | Excel template generation system |
| [TESTGENIE_DATA_FLOW.md](agentic-workflow/docs/TESTGENIE_DATA_FLOW.md) | TestGenie data flow and processing |
| [WORKFLOW_IMPROVEMENTS.md](agentic-workflow/docs/WORKFLOW_IMPROVEMENTS.md) | Planned improvements and roadmap |

### Agent Protocol Docs (`.github/agents/docs/`)

| Document | Description |
|---|---|
| [AGENT_PROTOCOL.md](.github/agents/docs/AGENT_PROTOCOL.md) | Agent communication protocol and message formats |
| [QUICKREF.md](.github/agents/docs/QUICKREF.md) | Quick reference card for all agents |
| [TROUBLESHOOTING.md](.github/agents/docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [WORKFLOWS.md](.github/agents/docs/WORKFLOWS.md) | Workflow definitions and patterns |

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Playwright** | ^1.58.2 | Browser automation and testing framework |
| **Next.js** | ^15.1.0 | QA Dashboard frontend framework |
| **React** | ^19.0.0 | UI component library |
| **Tailwind CSS** | ^3.4.16 | Utility-first CSS framework |
| **Node.js** | >= 18.0.0 | JavaScript runtime |
| **@github/copilot-sdk** | ^0.1.22 | GitHub Copilot SDK for agent orchestration |
| **@modelcontextprotocol/sdk** | ^1.25.3 | MCP protocol implementation |
| **@playwright/mcp** | ^0.0.56 | Playwright MCP integration |
| **ExcelJS** | ^4.4.0 | Excel file generation for test cases |
| **Axios** | ^1.9.0 | HTTP client for API calls |
| **dotenv** | ^17.3.1 | Environment variable management |
| **Zod** | ^3.25.76 | Schema validation |
| **Allure** | ^2.34.0 | Test reporting (optional) |

---

**Powered by the Doremon Team**
