# Jira-to-Automation Workflow Overview

## 🎯 Quick Summary

**Purpose:** Automatically generate and execute Playwright automation tests from Jira tickets with self-healing capabilities.

**Version:** 2.0.0 (Hybrid MCP Strategy v2.3)

---

## 📁 File Structure Tree

```
PW_regression-suite/
│
├── � config/                        # Configuration files
│   ├── 📄 workflow-config.json      # Central configuration hub
│   └── 📄 workflow-config.schema.json # JSON Schema validation
├── 📂 orchestrator/                  # Pipeline execution
│   └── 📄 workflow-orchestrator.js  # Pipeline execution engine
├── 📄 playwright.config.js          # Playwright test runner config
│
├── 📂 .github/agents/               # AI Agent definitions
│   ├── 📄 orchestrator.agent.md     # Main workflow coordinator
│   ├── 📄 testgenie.agent.md        # Test case generator (Stage 1)
│   ├── 📄 scriptgenerator.agent.md  # Script generator (Stage 2) [v2.3]
│   └── 📄 buggenie.agent.md         # Bug ticket generator (on failure)
│
├── 📂 test-cases/                   # Generated test case Excel files
│   └── 📄 {TICKET-ID}.xlsx          # e.g., AOTF-16461.xlsx
│
├── 📂 tests/
│   ├── 📂 specs/{ticket-id}/        # Generated Playwright specs
│   │   └── 📄 *.spec.js             # Automated test scripts
│   ├── 📂 test-data/
│   │   └── 📄 testData.js           # UAT tokens & test data
│   └── 📂 pageobjects/              # Reusable page object classes
│       └── 📄 POmanager.js          # Page Object Manager
│
├── 📂 scripts/                      # Utility scripts
│   ├── 📄 excel-template-generator.js
│   └── 📄 validate-test-case-excel.js
│
├── 📂 exploration-data/             # MCP exploration snapshots
├── 📂 test-results/                 # Test execution outputs
├── 📂 playwright-report/            # HTML reports
└── 📂 allure-results/               # Allure reporting data
```

---

## 🔄 Pipeline Flow (4 Stages)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    JIRA-TO-AUTOMATION PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────┐    ┌──────────────────┐    ┌─────────┐    ┌─────────┐    │
│   │   STAGE 1   │    │     STAGE 2      │    │ STAGE 3 │    │ STAGE 4 │    │
│   │  TestGenie  │───▶│ ScriptGenerator  │───▶│ Execute │───▶│ Report  │    │
│   └─────────────┘    └──────────────────┘    └─────────┘    └─────────┘    │
│         │                    │                    │              │          │
│         ▼                    ▼                    ▼              ▼          │
│   ┌─────────────┐    ┌──────────────────┐    ┌─────────┐    ┌─────────┐    │
│   │ Excel file  │    │  Playwright MCP  │    │  Test   │    │  HTML   │    │
│   │ test cases  │    │  + Chrome MCP    │    │ Results │    │ Report  │    │
│   └─────────────┘    └──────────────────┘    └─────────┘    └─────────┘    │
│                                                    │                        │
│                                                    ▼                        │
│                                           ┌───────────────┐                 │
│                                           │  If Failures  │                 │
│                                           │   BugGenie    │                 │
│                                           └───────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stage Details

| Stage | Agent | Input | Output | Purpose |
|-------|-------|-------|--------|---------|
| **1. TestGenie** | testgenie.agent.md | Jira Ticket ID | Excel file + Markdown | Generate manual test cases from Jira ACs |
| **2. ScriptGenerator** | scriptgenerator.agent.md | Excel + MCP Snapshot | .spec.js file | Generate Playwright automation scripts |
| **3. Execute** | Playwright Runner | .spec.js file | Test Results | Run automated tests |
| **4. Report** | - | Test Results | HTML Report | Generate execution report |
| **[On Fail]** | buggenie.agent.md | Error Details | Jira Bug Ticket | Create defect ticket |

---

## 🧠 Hybrid MCP Strategy (v2.3)

**Key Innovation:** Use **Playwright MCP** for fast exploration, **Chrome DevTools MCP** for failure recovery with self-healing.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      HYBRID MCP EXECUTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: INITIAL EXPLORATION                   [Playwright MCP]            │
│  ═══════════════════════════════════════════════════════════════            │
│  • Navigate to target URL                                                    │
│  • Capture accessibility snapshot                                            │
│  • Extract role-based selectors                                              │
│  • Generate initial test script                                              │
│                         ↓                                                    │
│  PHASE 2: FIRST EXECUTION                       [Playwright Test Runner]    │
│  ═══════════════════════════════════════════════════════════════            │
│  • Run: npx playwright test <spec-file>                                      │
│  • Capture test results                                                      │
│         │                                                                    │
│         ├── ALL PASS ──▶ ✅ COMPLETE (Skip to Phase 4)                       │
│         │                                                                    │
│         └── ANY FAIL ──▶ ⚠️ Trigger Phase 3                                  │
│                         ↓                                                    │
│  PHASE 3: FAILURE RECOVERY                      [Chrome DevTools MCP] 🆕    │
│  ═══════════════════════════════════════════════════════════════            │
│  • Analyze failure reason (selector not found, timeout, etc.)                │
│  • Use evaluate_script() for deep DOM introspection                          │
│  • Discover alternative selectors dynamically                                │
│  • Apply self-healing strategies (up to 3 attempts)                          │
│  • Update script with healed selectors                                       │
│  • Re-execute tests                                                          │
│                         ↓                                                    │
│  PHASE 4: VALIDATION                            [Either MCP]                │
│  ═══════════════════════════════════════════════════════════════            │
│  • Verify all tests pass                                                     │
│  • Generate execution report                                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MCP Provider Comparison

| Capability | Playwright MCP | Chrome DevTools MCP |
|------------|----------------|---------------------|
| **Speed** | ⚡ Fast | 🐢 Slower |
| **Accessibility Snapshots** | ✅ Yes | ✅ Yes |
| **evaluate_script()** | ❌ No | ✅ Yes |
| **Dynamic Selector Discovery** | ❌ Limited | ✅ Full JS execution |
| **Network Inspection** | ❌ No | ✅ Yes |
| **Performance Analysis** | ❌ No | ✅ Yes |
| **Best For** | Initial exploration | Failure recovery |

### Self-Healing Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **attribute-fallback** | Find element by alternative attributes | When data-test-id missing |
| **parent-child-traverse** | Navigate DOM tree from known parent | When element moved in DOM |
| **xpath-fallback** | Use XPath by text content | When no unique attributes |

---

## 📋 Configuration Files

### 1. config/workflow-config.json (Central Hub)

```json
{
  "version": "2.0.0",
  "pipeline": {
    "stages": ["testgenie", "scriptgenerator", "execute", "report"]
  },
  "mcpStrategy": {
    "initialExploration": { "provider": "playwright" },
    "failureRecovery": { 
      "provider": "chromeDevTools",
      "selfHealing": { "enabled": true, "maxHealingAttempts": 3 }
    }
  },
  "testExecution": {
    "maxIterations": 2,
    "selfHealingEnabled": true
  }
}
```

**Key Sections:**
| Section | Purpose |
|---------|---------|
| `pipeline` | Defines 4-stage workflow sequence |
| `preflightChecks` | Validates prerequisites before execution |
| `mcpStrategy` | Hybrid MCP configuration (Playwright + DevTools) |
| `selectorStrategy` | Selector reliability ranking (1-7 priority) |
| `testExecution` | Timeouts, retries, reporters |
| `bugGenie` | Auto-trigger bug creation settings |
| `environments` | UAT/PROD environment configs |
| `testData` | MLS-specific test data (canopy, yesmls) |
| `qualityGates` | Stage-specific validation rules |
| `cleanup` | Temp file cleanup patterns |

### 2. config/workflow-config.schema.json

JSON Schema (819 lines) for validating config/workflow-config.json:
- Ensures type safety for all configuration options
- Validates enum values (e.g., providers: "playwright" | "chromeDevTools")
- Sets min/max bounds for numeric values
- Defines required fields per section

---

## 🤖 Agent Files

### orchestrator.agent.md
- **Role:** Main coordinator
- **Responsibilities:**
  - Run pre-flight checks
  - Invoke agents in sequence
  - Manage workflow state
  - Handle failures

### testgenie.agent.md
- **Role:** Test case generator
- **Input:** Jira ticket ID
- **Output:** Excel file + Markdown display
- **Key Features:**
  - Fetches Jira acceptance criteria
  - Optimizes test step consolidation
  - Uses standardized Excel template

### scriptgenerator.agent.md (v2.3)
- **Role:** Automation script generator
- **Input:** Excel test cases + MCP exploration data
- **Output:** Playwright .spec.js file
- **Key Features:**
  - **Hybrid MCP Strategy** (Playwright + Chrome DevTools)
  - Self-healing selector discovery
  - Framework-compliant code generation
  - POmanager pattern integration

### buggenie.agent.md
- **Role:** Bug ticket generator
- **Trigger:** After 2 consecutive test failures
- **Output:** Jira bug ticket with full context
- **Includes:** Screenshots, DOM snapshots, error logs

---

## 🌐 Environment Configuration

### UAT Environment
```
Base URL: <UAT_URL from .env>
Test Data: tests/test-data/testData.js
Token Path: userTokensUAT
Default MLS: canopy
```

### Supported MLS Systems
| MLS | Features |
|-----|----------|
| **Canopy** | roomvo, onehome-search, saved-searches |
| **YES MLS** | basic-search |

---

## 📊 Quality Gates

| Stage | Required Validations |
|-------|---------------------|
| **TestGenie** | Excel exists, has test cases, min 3 steps |
| **ScriptGenerator** | MCP exploration done, script exists, imports POmanager |
| **Execute** | Tests run within 120s timeout |

---

## 🔧 Selector Priority

Scripts use selectors in this reliability order:

| Rank | Selector Type | Reliability | Example |
|------|---------------|-------------|---------|
| 1 | data-test-id | ⭐⭐⭐⭐⭐ | `[data-test-id='submit-btn']` |
| 2 | data-testid | ⭐⭐⭐⭐⭐ | `[data-testid='login']` |
| 3 | aria-label | ⭐⭐⭐⭐ | `[aria-label='Close']` |
| 4 | role | ⭐⭐⭐⭐ | `getByRole('button')` |
| 5 | text-content | ⭐⭐⭐ | `getByText('Submit')` |
| 6 | id | ⭐⭐⭐ | `#element-id` |
| 7 | css-class | ⭐⭐ | `.btn-primary` |

---

## 🚀 Quick Start

### Run Workflow Command
```
@orchestrator run jira to automation for {TICKET-ID} with {MLS} UAT test data
```

**Example:**
```
@orchestrator run jira to automation for AOTF-16461 with canopy UAT test data
```

### Pipeline Output

```
📋 Stage 1: TestGenie
   ├── Fetched Jira ticket AOTF-16461
   ├── Generated 4 test cases, 17 steps
   └── Created: test-cases/AOTF-16461.xlsx

🔧 Stage 2: ScriptGenerator
   ├── MCP exploration complete (Playwright)
   ├── Generated: tests/specs/aotf-16461/roomvo-terms.spec.js
   └── Self-healing applied: 2 selectors healed

✅ Stage 3: Execute
   ├── 4 tests passed
   └── Duration: 14.6s

📊 Stage 4: Report
   └── HTML report: playwright-report/index.html
```

---

## 📈 Metrics Tracked

| Metric | Description |
|--------|-------------|
| `totalWorkflows` | Total workflows executed |
| `successRate` | % of workflows completing successfully |
| `averageDuration` | Average workflow execution time |
| `firstRunPassRate` | % of tests passing on first run |
| `selfHealingSuccessRate` | % of failures recovered via self-healing |
| `bugGenieInvocations` | Number of bug tickets auto-created |

---

## 🔗 Integration Diagram

```
                    ┌──────────────────────────────────────┐
                    │            JIRA CLOUD                 │
                    │  (<JIRA_BASE_URL from .env>)            │
                    └─────────────────┬────────────────────┘
                                      │ Fetch Ticket
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         WORKFLOW ENGINE                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ config/workflow-config.json + orchestrator/workflow-orchestrator.js    │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│           │              │               │              │                │
│           ▼              ▼               ▼              ▼                │
│    ┌───────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐           │
│    │ TestGenie │  │ScriptGener. │  │ Execute  │  │  Report  │           │
│    └───────────┘  └─────────────┘  └──────────┘  └──────────┘           │
│           │              │               │              │                │
│           ▼              ▼               ▼              ▼                │
│    ┌───────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐           │
│    │   Excel   │  │  .spec.js   │  │  Results │  │   HTML   │           │
│    │   File    │  │    File     │  │   JSON   │  │  Report  │           │
│    └───────────┘  └─────────────┘  └──────────┘  └──────────┘           │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
           ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
           │ Playwright   │  │ Chrome       │  │ UAT          │
           │ MCP Server   │  │ DevTools MCP │  │ Environment  │
           │ (Explore)    │  │ (Recovery)   │  │ (Test)       │
           └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-01-28 | Hybrid MCP Strategy, config/workflow-config.json |
| 2.3 | 2026-01-28 | Chrome DevTools MCP for self-healing |

---

*Last Updated: January 28, 2026*
