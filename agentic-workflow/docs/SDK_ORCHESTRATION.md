# SDK Orchestration Layer

> Programmatic pipeline control using the GitHub Copilot SDK — replacing prompt-engineered agent dispatching with code-driven sessions, structural enforcement, self-healing, and cross-run learning.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI (cli.js)                           │
│  node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode   │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │    SDKOrchestrator      │
              │      (index.js)         │
              │                         │
              │  • CopilotClient init   │
              │  • Pipeline dispatch    │
              │  • Parallel batching    │
              └────────────┬────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
  ┌───────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
  │ PipelineRunner│  │SelfHealing │  │LearningStore│
  │              │  │  Engine    │  │             │
  │ Stage chain: │  │  Closed-  │  │ Persistent  │
  │ PREFLIGHT    │  │  loop fix │  │ JSON store  │
  │ TESTGENIE    │  │  + SDK    │  │ Failures,   │
  │ QG_EXCEL     │  │  sessions │  │ selectors,  │
  │ SCRIPTGEN    │  │           │  │ patterns    │
  │ QG_SCRIPT    │  └───────────┘  └─────────────┘
  │ EXECUTE      │
  │ SELF_HEAL    │        ┌─────────────────────┐
  │ BUGGENIE     │        │ AgentSessionFactory │
  │ REPORT       │        │                     │
  └──────────────┘        │ • loadAgentPrompt() │
                          │ • createSession()   │
                          │ • sendAndWait()     │
                          └──────┬──────────────┘
                                 │
                    ┌────────────┼──────────────┐
                    │            │              │
            ┌───────▼──┐  ┌─────▼────┐  ┌──────▼──────┐
            │ Custom   │  │Enforce-  │  │  Agent .md  │
            │ Tools    │  │ment     │  │  Prompts    │
            │ (10)     │  │ Hooks   │  │             │
            └──────────┘  └──────────┘  └─────────────┘
```

## Module Reference

| Module | File | Purpose |
|--------|------|---------|
| **SDKOrchestrator** | `index.js` | Main entry point — CopilotClient lifecycle, pipeline dispatch |
| **AgentSessionFactory** | `agent-sessions.js` | Creates pre-configured SDK sessions per agent role |
| **Custom Tools** | `custom-tools.js` | 10 `defineTool()` wrappers exposing system capabilities |
| **Enforcement Hooks** | `enforcement-hooks.js` | Structural rule enforcement via session hooks |
| **SelfHealingEngine** | `self-healing.js` | Closed-loop test fixing: run → analyze → fix → re-run |
| **LearningStore** | `learning-store.js` | Persistent cross-run intelligence store |
| **PipelineRunner** | `pipeline-runner.js` | Stage sequencing, quality gates, artifact passing |
| **CLI** | `cli.js` | Command-line interface |

## Quick Start

### Full Pipeline
```bash
# From agentic-workflow/ directory
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode full

# Or via npm script
npm run sdk:pipeline -- --ticket AOTF-16339
```

### Self-Healing Only
```bash
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode heal
npm run sdk:heal -- --ticket AOTF-16339
```

### Execute Existing Script
```bash
node sdk-orchestrator/cli.js --ticket AOTF-16339 --mode execute
npm run sdk:execute -- --ticket AOTF-16339
```

### Parallel Execution
```bash
node sdk-orchestrator/cli.js --tickets AOTF-001,AOTF-002,AOTF-003 --parallel
```

## Pipeline Modes

| Mode | Stages | Use Case |
|------|--------|----------|
| `full` | PREFLIGHT → TESTGENIE → QG_EXCEL → SCRIPTGEN → QG_SCRIPT → EXECUTE → HEAL → BUGGENIE → REPORT | End-to-end from Jira ticket |
| `generate` | PREFLIGHT → SCRIPTGEN → QG_SCRIPT → EXECUTE → HEAL → REPORT | Script generation without test cases |
| `heal` | EXECUTE → HEAL → REPORT | Fix failing existing scripts |
| `execute` | EXECUTE → REPORT | Just run tests and report |

## Custom Tools (10)

These SDK `defineTool()` functions expose system capabilities to agent sessions:

| # | Tool | Agents | Description |
|---|------|--------|-------------|
| 1 | `get_framework_inventory` | scriptgenerator, codereviewer | Returns available page objects, helpers, configs |
| 2 | `validate_generated_script` | scriptgenerator, codereviewer | Runs 15 validation rules + anti-pattern check |
| 3 | `get_historical_failures` | scriptgenerator | Past failures + stable selectors from learning store |
| 4 | `get_exploration_data` | scriptgenerator, codereviewer | Reads cached MCP exploration JSON |
| 5 | `analyze_test_failure` | scriptgenerator, buggenie | ErrorAnalyzer analysis + auto-fix suggestions |
| 6 | `get_assertion_config` | scriptgenerator | Assertion patterns from config/assertion-config.json |
| 7 | `suggest_popup_handler` | scriptgenerator | PopupHandler method suggestions for selectors |
| 8 | `run_quality_gate` | all | Excel/exploration/script/execution quality gates |
| 9 | `save_exploration_data` | scriptgenerator | Validates + saves exploration JSON |
| 10 | `get_test_results` | buggenie | Scans test-results directories for JSON reports |

## Enforcement Hooks

Session hooks that **physically prevent** rule violations (vs. prompt instructions that can be ignored):

### onPreToolUse
- **MCP-First Rule**: Blocks `.spec.js` file creation before `unified_navigate` and `unified_snapshot` have been called. Returns `permissionDecision: 'deny'` to prevent the tool call entirely.
- **No waitForTimeout**: Detects `waitForTimeout` in file writes, allows but injects warning context.
- **No non-retrying assertions**: Detects `expect(await el.textContent())` patterns, injects fix guidance.

### onPostToolUse
- After `unified_snapshot`: Caches snapshot data for later reference.
- After `.spec.js` creation: Auto-runs `validateGeneratedScript()` and injects errors/warnings as additional context.

### onErrorOccurred
- MCP/connection errors → retry
- Timeout → retry  
- Auth/401 → abort
- Default → skip

## Self-Healing Loop

```
Run Tests
    │
    ▼
All Pass? ──yes──► Done ✅
    │
    no
    ▼
ErrorAnalyzer.analyze()
    │
    ▼
Auto-fixable? ──yes──► Apply regex fix ──► Re-run
    │
    no (selector/complex error)
    ▼
Create SDK Healing Session
    │
    ▼
Send structured prompt with:
  • Failed test details
  • Error analysis
  • Exploration data
  • Learning store history
    │
    ▼
Agent fixes spec file
    │
    ▼
Re-run tests
    │
    ▼
Pass? ──no──► Iterate (max N)
    │
    yes
    ▼
Record learning ──► Done ✅
```

Max iterations configurable via `config/workflow-config.json → sdk.maxHealingIterations` (default: 3).

## Learning Store

Persistent JSON store at `agentic-workflow/learning-data/learning-store.json`:

```json
{
  "version": "1.0.0",
  "failures": [
    { "ticketId": "AOTF-16339", "page": "/search", "errorType": "SELECTOR_NOT_FOUND",
      "selector": "[data-qa='search-btn']", "fix": "Changed to getByRole('button', {name: 'Search'})",
      "outcome": "fixed", "method": "sdk-healing" }
  ],
  "selectorMappings": [
    { "page": "/search", "element": "search-button",
      "tried": ["[data-qa='search-btn']", ".search-button"],
      "stable": "getByRole('button', {name: 'Search'})", "confidence": 0.95 }
  ],
  "pagePatterns": [
    { "url": "/search", "popups": ["welcome-modal"],
      "commonIssues": ["SELECTOR_NOT_FOUND"], "avgLoadTime": 3200 }
  ]
}
```

Bounded: 500 max failures, 200 max selector mappings.

## Configuration

SDK config lives in `config/workflow-config.json → sdk`:

```json
{
  "sdk": {
    "enabled": true,
    "model": "claude-sonnet-4-20250514",
    "maxHealingIterations": 3,
    "parallelTickets": 1,
    "enableLearning": true,
    "hooks": {
      "enforceMCPFirst": true,
      "autoValidateScripts": true,
      "blockWaitForTimeout": true,
      "blockNonRetryingAssertions": true
    },
    "mcpServer": {
      "type": "local",
      "command": "node",
      "args": ["agentic-workflow/mcp-server/server.js"]
    }
  }
}
```

## Prerequisites

- Node.js >= 18
- `@github/copilot-sdk` installed (`npm install`)
- GitHub Copilot subscription (for CopilotClient authentication)
- MCP server functional (`npm run mcp:unified`)

## File Structure

```
agentic-workflow/sdk-orchestrator/
├── index.js              # SDKOrchestrator — main entry point
├── agent-sessions.js     # AgentSessionFactory — session creation
├── custom-tools.js       # 10 defineTool() wrappers
├── enforcement-hooks.js  # Structural rule enforcement hooks
├── self-healing.js       # SelfHealingEngine — closed-loop fixing
├── learning-store.js     # LearningStore — persistent intelligence
├── pipeline-runner.js    # PipelineRunner — stage sequencing
└── cli.js                # CLI entry point
```
