# Workflow Usage Guide - Jira to Automation Pipeline (v4.0)

## First-Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Run interactive setup (creates .env, detects framework mode, scaffolds stubs if needed)
npm run setup

# 3. Edit .env with your Jira credentials, environment URLs, etc.

# 4. Configure MCP servers in .vscode/mcp.json (see mcp-server/README.md)
```

## Overview

This workflow automates the **complete pipeline** from Jira ticket to executed tests:

1. **TestGenie** â†’ Generate test cases from Jira
2. **ScriptGenerator** â†’ MCP exploration + Playwright script
3. **Execute** â†’ Run tests with 2 retry attempts + self-healing
4. **BugGenie** â†’ Auto-triggered on final failure with full context

**Key Features in v4.0**:
- 2 retry attempts (configurable) with self-healing between attempts
- Auto-triggered BugGenie with comprehensive failure context
- Unified MCP server (`unified-automation-mcp`) for all exploration needs

## Complete Pipeline Flow

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚    TestGenie    â”‚â”€â”€â”€â”€â–¶â”‚ ScriptGenerator â”‚â”€â”€â”€â”€â–¶â”‚    Execute      â”‚
â”‚  (Jira â†’ Excel) â”‚     â”‚ (MCP â†’ Script)  â”‚     â”‚  (2 attempts)   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                         â”‚
                               â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
                               â”‚                          â”‚
                               â–¼                          â–¼
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚  Self-Heal  â”‚           â”‚   SUCCESS   â”‚
                        â”‚ (MCP fix)   â”‚           â”‚   Report    â”‚
                        â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚
                               â–¼
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚  Attempt 2  â”‚â”€â”€â”€â”€â–¶â”‚  BugGenie   â”‚
                        â”‚   (retry)   â”‚fail â”‚ (auto-bug)  â”‚
                        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## Quick Start

### Option 1: Full Orchestrator
```bash
node workflow-orchestrator.js https://<your-org>.atlassian.net/browse/{TICKET-ID} UAT "canopy UAT"
```

### Option 2: Individual Agents
```
# Stage 1: Generate test cases
@testgenie https://<your-org>.atlassian.net/browse/{TICKET-ID}

# Stage 2: Generate script with MCP
@scriptgenerator generate automation for {TICKET-ID} using MCP exploration

# Stage 3: Execute tests
npx playwright test tests/specs/{ticket-id}/*.spec.js --workers=1

# Stage 4 (if failed): Create bug
@buggenie Create bug for {TICKET-ID} test failures
```

## Agent Details

### 1. TestGenie
**Purpose**: Generate test cases from Jira ticket
**Output**: `test-cases/{TICKET-ID}.xlsx`
```
@testgenie <jira-url> with <environment> test data
```

### 2. ScriptGenerator  
**Purpose**: MCP exploration + Playwright script generation
**Output**: `tests/specs/{ticket-id}/*.spec.js`
```
@scriptgenerator generate automation for {TICKET-ID} using MCP exploration
```

**MANDATORY**: Uses MCP tools to explore live application:
- `unified_navigate` â†’ Open application
- `unified_snapshot` â†’ Get DOM structure
- Extract real selectors from live page

### 3. Execute (Orchestrator)
**Purpose**: Run tests with intelligent retry
**Config**: 2 attempts max, self-healing between attempts
```bash
npx playwright test tests/specs/{ticket-id}/ --workers=1
```

### 4. BugGenie (Auto-Triggered)
**Purpose**: Create bug ticket with full failure context
**Trigger**: Automatically after 2 failed attempts
**Includes**:
- All error messages from each attempt
- Self-healing attempt details
- Artifact paths (Excel, Script)
- Suggested root cause analysis

## MCP Tools Reference

**Server:** `unified-automation-mcp` (VS Code callable prefix: `mcp_unified-autom_unified_*`)

| Tool | Purpose |
|------|---------|
| `unified_navigate` | Navigate to URL |
| `unified_snapshot` | Get accessibility tree with refs |
| `unified_click` | Click element by ref |
| `unified_type` | Type text into element |
| `unified_wait_for` | Wait for text/time |
| `unified_tabs` | List/close/create browser tabs |
| `unified_evaluate` | Execute JavaScript on page |
| `unified_evaluate_cdp` | Execute JavaScript (Chrome DevTools) |
| `unified_take_snapshot_cdp` | DOM snapshot (Chrome DevTools) |
| `unified_get_by_role` | Find element by ARIA role |
| `unified_get_attribute` | Get element attribute value |
| `unified_browser_close` | Close browser |

## Fresh Browser Requirement (NEW in v4.1)

**CRITICAL: Before any exploration, ALL old tabs must be closed!**

```javascript
// Close all existing tabs before exploration
const tabs = await unified_tabs({ action: 'list' });
for (let i = tabs.length - 1; i >= 0; i--) {
    await unified_tabs({ action: 'close', index: i });
}
// Now ready for fresh exploration
```

**Why?** Old tabs from previous sessions can:
- Show cached/stale content
- Cause selector ambiguity
- Interfere with test execution

## Hybrid MCP Self-Healing Process (NEW in v4.1)

**When tests fail, the workflow SWITCHES from Playwright MCP to Chrome DevTools MCP:**

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   Initial Explore   â”‚â”€â”€â”€â”€â–¶â”‚   First Execution   â”‚
â”‚  (Playwright MCP)   â”‚     â”‚  (Playwright Test)  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                       â”‚
                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                            â”‚      Test FAILS     â”‚
                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                       â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚     SWITCH TO CHROME DEVTOOLS MCP                â”‚
              â”‚     (Self-Healing with evaluate_script)          â”‚
              â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
              â”‚  1. unified_navigate(failingUrl)      â”‚
              â”‚  2. unified_take_snapshot_cdp()                â”‚
              â”‚  3. unified_evaluate_cdp()         â”‚
              â”‚     â†’ Find alternative selectors via JS         â”‚
              â”‚  4. Update script with healed selectors         â”‚
              â”‚  5. Re-execute tests                            â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Why Chrome DevTools MCP for Self-Healing?

| Capability | Playwright MCP | Chrome DevTools MCP |
|------------|----------------|---------------------|
| `evaluate_script` | âŒ No | âœ… Yes (CRITICAL for self-healing) |
| DOM introspection | Limited | Full JavaScript access |
| Dynamic selectors | No | Yes - run any JS |
| Network debugging | No | Yes |
| Console messages | No | Yes |

## BugGenie Auto-Trigger

After 2 failed attempts (with Chrome DevTools self-healing), BugGenie receives:

```json
{
  "ticketId": "{TICKET-ID}",
  "iterationsAttempted": 2,
  "allErrors": [...],
  "selfHealingAttempts": [...],
  "mcpProvider": "chromeDevTools",
  "artifacts": {
    "testCasesPath": "test-cases/{TICKET-ID}.xlsx",
    "scriptPath": "tests/specs/{ticket-id}/*.spec.js"
  }
}
```

## Configuration

### workflow-orchestrator.js
```javascript
maxIterations: 2  // Retry attempts before BugGenie
```

### workflow-config.json (NEW in v4.1)
```json
{
  "browserConfig": {
    "ensureFreshState": true,
    "closeExistingTabsBeforeExploration": true
  },
  "mcpStrategy": {
    "freshBrowserRequired": true,
    "failureRecovery": {
      "provider": "chromeDevTools",
      "mandatory": true
    }
  }
}
```

## File Structure

| File | Purpose |
|------|---------|
| `workflow-orchestrator.js` | Main pipeline coordinator |
| `workflow-config.json` | Pipeline configuration (browserConfig, mcpStrategy) |
| `scripts/excel-template-generator.js` | Excel test case generation |
| `scripts/validate-test-case-excel.js` | Excel validation utility |
| `scripts/mcp-exploration-runner.js` | MCP exploration engine |
| `scripts/shared/mcp-tool-names.js` | Canonical MCP tool name registry |
| `scripts/shared/exploration-session.js` | Exploration session recorder |
| `.github/agents/testgenie.agent.md` | TestGenie agent config |
| `.github/agents/scriptgenerator.agent.md` | ScriptGenerator config |
| `.github/agents/buggenie.agent.md` | BugGenie agent config |
| `.github/agents/orchestrator.agent.md` | Orchestrator agent config |

## Example: Complete Workflow

```bash
# Start the complete pipeline
node workflow-orchestrator.js \
  https://<your-org>.atlassian.net/browse/{TICKET-ID} \
  UAT \
  "canopy UAT"

# Pipeline will:
# 1. Ensure fresh browser state (close all old tabs)
# 2. Check for existing test cases (or prompt for TestGenie)
# 3. Check for existing script (or prompt for ScriptGenerator)
# 4. Execute tests with 2 retry attempts
# 5. On failure: Use Chrome DevTools MCP for self-healing
# 6. If still fails: Auto-trigger BugGenie with full context
# 7. Generate reports in playwright-report/
```

## Troubleshooting

### Browser shows old tabs from previous session
- The workflow now automatically closes all tabs before exploration
- If still seeing old tabs, restart VS Code

### Tests keep failing after self-heal
- Check if Chrome DevTools MCP is being used (not Playwright)
- Verify `evaluate_script` is finding alternative selectors
- Check UAT environment accessibility
- Review DOM changes in application

### BugGenie not creating ticket
- Ensure Jira credentials are configured
- Check the BugGenie prompt in workflow state

### MCP tools not working
- Ensure `unified-automation-mcp` server is configured in `.vscode/mcp.json`
- Run `cd mcp-server && npm install` to install dependencies
- Restart VS Code window if tools don't appear
- Check MCP server logs in VS Code Output panel

## Version History

- **v4.1**: Fresh browser enforcement, Chrome DevTools MCP for self-healing, browserConfig
- **v4.0**: Added auto-BugGenie trigger, reduced to 2 retries, self-healing context
- **v3.1**: Unified MCP server (`unified-automation-mcp`) as sole exploration server
- **v3.0**: Initial unified MCP server integration
- **v2.0**: Added quality gates and recovery strategies
- **v1.0**: Initial orchestrator pipeline
