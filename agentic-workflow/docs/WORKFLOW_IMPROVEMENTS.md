# Workflow Improvements - Terminal & MCP Consistency (v2.1 - IMPLEMENTED)

## ✅ IMPLEMENTATION STATUS: COMPLETE

**Date Implemented:** January 28, 2026  
**Version:** 2.1 Enhanced Reliability

---

## 🎉 What's Been Implemented

### 1. ✅ Pre-flight Validation (`workflow-preflight.js`)
**Location:** `.github/agents/lib/workflow-preflight.js`

Validates prerequisites BEFORE workflow starts:
- ✅ Required directories exist
- ✅ Test data file is valid
- ✅ UAT environment is reachable
- ✅ Existing artifacts detected

### 2. ✅ Workflow Configuration (`workflow-config.json`)
**Location:** `workflow-config.json`

Centralized configuration for:
- Pre-flight checks
- MCP exploration checkpoints
- Selector reliability strategy
- Test execution settings
- BugGenie auto-trigger rules
- Environment-specific settings

### 3. ✅ MCP Checkpoint Enforcement
**Location:** `scriptgenerator.agent.md`

Mandatory checkpoints before script generation:
- ✅ Browser launched
- ✅ Page navigated
- ✅ Snapshot captured
- ✅ Selectors extracted

### 4. ✅ Selector Reliability Strategy
**Location:** `workflow-config.json` + `workflow-preflight.js`

Priority-based selector selection:
1. data-test-id (⭐⭐⭐⭐⭐)
2. aria-label (⭐⭐⭐⭐)
3. role (⭐⭐⭐⭐)
4. text-content (⭐⭐⭐)
5. css-class (⭐⭐ - avoid if possible)

---

## Previous Problem Statement

The current workflow has several issues causing inconsistent behavior:

1. **Terminal Blocking**: `run_in_terminal` with `isBackground: false` blocks until command completes
2. **Inconsistent MCP Exploration**: Script generation sometimes doesn't use actual page data
3. **No Real-time Feedback**: User sees "loading" for 2+ minutes with no progress indication
4. **Selector Assumptions**: Scripts assume page structure instead of discovering it

## Root Cause Analysis

### Terminal Issues
```
┌─────────────────────────────────────────────────────────────────────┐
│  CURRENT FLOW (Blocking)                                            │
├─────────────────────────────────────────────────────────────────────┤
│  run_in_terminal(command, isBackground=false)                       │
│        ↓                                                            │
│  [BLOCKED] Waits 2-5 minutes for test completion                    │
│        ↓                                                            │
│  Returns full output (may timeout)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### MCP Exploration Issues
```
┌─────────────────────────────────────────────────────────────────────┐
│  INCONSISTENT: Sometimes explores, sometimes assumes                │
├─────────────────────────────────────────────────────────────────────┤
│  ScriptGenerator Agent                                              │
│        ↓                                                            │
│  [MAYBE] Opens browser and explores OR [MAYBE] Makes assumptions    │
│        ↓                                                            │
│  Generates script with potentially wrong selectors                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Solutions

### Solution 1: Use Background Execution + Polling

```javascript
// BETTER: Run test as background process
run_in_terminal({
    command: "npx playwright test tests/specs/aotf-16461/aotf-16461.spec.js --reporter=line",
    isBackground: true,  // Don't block
    explanation: "Running tests in background"
})

// Then poll for output
get_terminal_output({ id: "terminal-id" })
```

### Solution 2: Shorter Test Timeouts

```javascript
// In playwright.config.js - reduce timeouts for faster feedback
module.exports = {
    timeout: 30000,  // 30 seconds per test
    expect: { timeout: 5000 },
    use: { 
        actionTimeout: 10000,
        navigationTimeout: 15000 
    }
};
```

### Solution 3: Mandatory MCP Exploration Before Script Generation

The scriptgenerator agent MUST:
1. **Always** navigate to the target URL using MCP browser tools
2. **Always** take a snapshot of the page
3. **Always** extract actual selectors from the snapshot
4. **Never** assume page structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  REQUIRED: MCP Exploration Checklist                                │
├─────────────────────────────────────────────────────────────────────┤
│  1. activate_browser_navigation_tools                               │
│  2. unified_navigate (go to URL)                                    │
│  3. unified_wait_for (wait for key element)                         │
│  4. unified_snapshot (capture full DOM)                             │
│  5. Extract uid values and actual selectors                         │
│  6. Generate script using ONLY discovered selectors                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Solution 4: Test Execution Strategy

Instead of running all tests at once:
```bash
# BAD: Run all tests (long wait)
npx playwright test tests/specs/aotf-16461/ --reporter=list

# GOOD: Run single test with immediate feedback
npx playwright test tests/specs/aotf-16461/aotf-16461.spec.js -g "TC1" --reporter=line --timeout=30000
```

## Implementation Checklist

### For Copilot/Agent Usage:

- [x] Use `isBackground: true` for test execution commands
- [x] Poll terminal output every 10-15 seconds
- [x] Set explicit timeouts on all commands
- [x] Always do MCP exploration before generating scripts
- [x] Validate selectors against actual page snapshots
- [x] Run tests incrementally (one test case at a time for debugging)

### For Test Scripts:

- [x] Use shorter explicit timeouts (15-30 seconds)
- [x] Add descriptive console.log for progress tracking  
- [x] Use `--reporter=line` for concise output
- [x] Handle popups/modals gracefully with proper waits

## Example: Improved Workflow Execution (IMPLEMENTED)

```
STEP 0: Pre-flight Validation (NEW)
  └─ Check directories, test data, UAT reachability
  └─ If fails → HALT with actionable error messages

STEP 1: Get Jira ticket info
  └─ Use Jira MCP tools (fast, non-blocking)

STEP 2: Generate test cases
  └─ Invoke testgenie agent (returns quickly)

STEP 3: MCP Browser Exploration (MANDATORY - ENFORCED)
  └─ activate_browser_navigation_tools
  └─ unified_navigate → target URL
  └─ unified_snapshot → get DOM
  └─ Extract actual selectors from snapshot
  └─ Validate all checkpoints passed

STEP 4: Generate script using discovered selectors
  └─ Invoke scriptgenerator with MCP data
  └─ Validate selector reliability scores

STEP 5: Execute tests (background)
  └─ run_in_terminal(command, isBackground=true)
  └─ Poll get_terminal_output every 15 seconds
  └─ Show progress to user

STEP 6: Report results
  └─ Parse test output
  └─ Show pass/fail summary
  └─ Auto-trigger BugGenie if 2 failures
```

## Metrics to Track (NOW CONFIGURED)

| Metric | Before | Target | Config Location |
|--------|--------|--------|-----------------|
| Workflow total time | 5-10 min | 2-3 min | workflow-config.json |
| User feedback delay | 2-5 min | 15 sec | workflow-config.json |
| Test execution visibility | None | Real-time | workflow-config.json |
| Selector accuracy | ~50% | 95%+ | selectorStrategy |
| First-run pass rate | ~20% | 80%+ | metrics.collect |

## Conclusion

The key improvements are:
1. ✅ **Pre-flight validation** ensures prerequisites before starting
2. ✅ **Mandatory MCP exploration** with checkpoint enforcement
3. ✅ **Selector reliability strategy** prioritizes stable selectors
4. ✅ **Centralized configuration** in workflow-config.json
5. ✅ **Enhanced agent prompts** enforce consistent behavior

---

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `config/workflow-config.json` | Created | Centralized workflow configuration |
| `.github/agents/lib/workflow-preflight.js` | Created | Pre-flight validation module |
| `orchestrator/workflow-orchestrator.js` | Modified | Added Stage 0 pre-flight validation |
| `.github/agents/orchestrator.agent.md` | Modified | Added pre-flight section |
| `.github/agents/scriptgenerator.agent.md` | Modified | Added MCP checkpoints + selector strategy |
| `docs/WORKFLOW_IMPROVEMENTS.md` | Modified | Updated with implementation status |
