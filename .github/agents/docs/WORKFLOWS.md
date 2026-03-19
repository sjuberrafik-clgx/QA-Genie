# Multi-Agent Orchestration Workflows

## 🎯 Overview

This document provides visual workflow diagrams for the multi-agent orchestration setup.

Agent categories used in this workspace:

- Core QA agents: Orchestrator, TestGenie, ScriptGenerator, BugGenie, TaskGenie, CodeReviewer
- Utility agents: FileGenie, DocGenie

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  VS Code 1.107 Agent HQ                     │
│                   (Chat Interface)                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
           ┌───────────────────────┐
           │   QA Orchestrator     │
           │  (Master Controller)  │
           └─────┬─────┬─────┬─────┘
                     │     │     │
         ┌───────┘     │     └───────────────┐
         ▼             ▼                     ▼
┌──────────┐  ┌──────────┐          ┌──────────┐
│TestGenie │  │ Script   │          │ BugGenie │
│Jira→Test │  │Generator │          │Fail→Bug  │
│Cases     │  │MCP→Spec  │          │Workflow  │
└────┬─────┘  └────┬─────┘          └────┬─────┘
       │             │                     │
       ▼             ▼                     ▼
┌──────────┐  ┌──────────┐          ┌──────────┐
│TaskGenie │  │CodeReview│          │ Dashboard│
│Testing   │  │Script QA │          │Artifacts │
│Tasks     │  │Feedback  │          │and Status│
└────┬─────┘  └────┬─────┘          └────┬─────┘
       │             │                     │
       ├─────────────┼─────────────────────┤
       │ Atlassian MCP / Unified MCP / VS  │
       │ Code Tools / SDK Orchestration    │
       └───────────────────────────────────┘
```

---

## 🔄 Workflow 1: Complete Automation Pipeline

**From Jira Ticket to Running Test**

```
┌─────────────┐
│ User Input  │ → "Automate testing for AOTF-1234"
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  Orchestrator    │ → Coordinates workflow
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   1. TestGenie   │ → Fetch Jira AOTF-1234
└──────┬───────────┘   Generate manual test cases
       │               Cover acceptance criteria
       │               Include MLS context
       ▼
┌──────────────────┐
│   Test Cases     │ → | Test ID | Activity | Expected | Actual |
│   Generated      │   | 1.1     | Login    | Success  | Pass   |
└──────┬───────────┘   | 1.2     | Search   | Results  | Pass   |
       │
       ▼
┌──────────────────┐
│2. ScriptGenerator│ → Explore framework
└──────┬───────────┘   Reuse page objects
       │               Validate selectors
       │               Generate Playwright spec
       ▼
┌──────────────────┐
│  Playwright Test │ → tests/specs/feature/aotf-1234.spec.js
│  Created         │   const { test } = require('@playwright/test');
└──────┬───────────┘   test('Property search', async () => {...});
       │
       ▼
┌──────────────────┐
│  3. Execute Test │ → npx playwright test aotf-1234.spec.js
└──────┬───────────┘
       │
       ├─────────┬─────────┐
       │         │         │
       ▼         ▼         ▼
   ┌────┐   ┌────┐   ┌────────┐
   │PASS│   │FAIL│   │FLAKY   │
   └─┬──┘   └─┬──┘   └───┬────┘
     │        │          │
     ▼        ▼          ▼
  ┌────┐  ┌──────────────────┐
  │Done│  │  4. BugGenie      │ → Generate bug review
  └────┘  └──────┬───────────┘   User confirms
              │               Create Jira defect
              ▼
          ┌──────────────────┐
          │ Jira Bug Ticket  │ → AOTF-5678 created
          │    Created       │   Linked to AOTF-1234
          └──────────────────┘
```

Optional follow-on stages:

- TaskGenie creates linked Testing tasks for tracking and assignment.
- CodeReviewer validates generated automation when a review pass is requested.

---

## 🔀 Workflow 2: Parallel Batch Processing

**Multiple Tickets in Parallel**

```
┌─────────────┐
│ User Input  │ → "Automate tickets AOTF-1234, 1235, 1236 in parallel"
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  Orchestrator    │ → Create 3 background agents
└──────┬───────────┘   Each with Git worktree
       │
       ├──────────────────┬──────────────────┐
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Background   │   │ Background   │   │ Background   │
│ Agent 1      │   │ Agent 2      │   │ Agent 3      │
│ (Worktree A) │   │ (Worktree B) │   │ (Worktree C) │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │ TestGenie        │ TestGenie        │ TestGenie
       │     ↓            │     ↓            │     ↓
       │ AOTF-1234        │ AOTF-1235        │ AOTF-1236
       │     ↓            │     ↓            │     ↓
       │ ScriptGen        │ ScriptGen        │ ScriptGen
       │     ↓            │     ↓            │     ↓
       ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Test 1     │   │   Test 2     │   │   Test 3     │
│  Generated   │   │  Generated   │   │  Generated   │
└──────────────┘   └──────────────┘   └──────────────┘
       │                  │                  │
       └──────────────────┴──────────────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │  Orchestrator    │ → Aggregate results
                 │  Completion      │   Merge worktrees
                 └──────┬───────────┘   Report summary
                        │
                        ▼
                 ┌──────────────────┐
                 │ All Tests Ready  │ → 3 test files created
                 │ for Review       │   No conflicts
                 └──────────────────┘   Ready to merge
```

---

## 🐛 Workflow 3: Bug Discovery to Resolution

**From Test Failure to Jira Ticket**

```
┌─────────────────┐
│  Test Execution │ → npx playwright test
└────────┬────────┘
         │
         ▼ FAIL
┌─────────────────┐
│  Test Failed    │ → Expected: 10 results
│  Error Details  │   Actual: 0 results
└────────┬────────┘   Screenshot: attached
         │
         ▼
┌─────────────────┐
│   User Reports  │ → "@buggenie Create bug for search failure in UAT"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   BugGenie      │ → STEP 1: Generate Review Copy
│  Step 1: Review │   ┌──────────────────────────┐
└────────┬────────┘   │ **Description :-**       │
         │            │ Search returns no results│
         ▼            │ **Environment :-** UAT   │
┌─────────────────┐   │ **MLS :-** Canopy        │
│ User Reviews    │←──│ **Attachments :-**       │
│ Content         │   │ screenshot.png           │
└────────┬────────┘   └──────────────────────────┘
         │
         ▼ User: "create bug jira ticket"
┌─────────────────┐
│   BugGenie      │ → STEP 2: Create Jira Issue
│ Step 2: Create  │   Using Atlassian MCP
└────────┬────────┘   Preserve formatting (ADF)
         │
         ▼
┌─────────────────┐
│ Jira Ticket     │ → AOTF-5678: Search Returns No Results
│   Created       │   Environment: UAT
└────────┬────────┘   Priority: High
         │            Assignee: QA Team
         │
         ▼
┌─────────────────┐
│  Optional:      │ → "Create testing task?"
│   TaskGenie     │
└────────┬────────┘   If yes:
         │            Create AOTF-5679
         ▼            "Testing - Search Returns No Results"
┌─────────────────┐   Linked to AOTF-5678
│  TestGenie      │ → Generate test cases
│  (Optional)     │   For testing task
└─────────────────┘
```

---

## 🔄 Workflow 4: Local to Background Handoff

**Continue Long-Running Task in Background**

```
┌─────────────────┐
│  User Starts    │ → "@orchestrator Automate sprint 23 (50 tickets)"
│  in Local Chat  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Orchestrator   │ → Starts processing...
│  (Local Agent)  │   Realizes it's a long task
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ "Continue In"   │ → User clicks "Continue in Background"
│  Button Appears │   Or Orchestrator suggests it
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Context        │ → All conversation history
│  Transferred    │   Jira ticket list
└────────┬────────┘   User preferences
         │            Tool results
         ▼
┌─────────────────┐
│  Background     │ → Runs autonomously
│  Agent Created  │   In Git worktree
└────────┬────────┘   Doesn't block UI
         │
         ├───────────────────────────────────┐
         ▼                                   ▼
┌─────────────────┐               ┌─────────────────┐
│  User Continues │               │  Background     │
│  Other Work     │               │  Agent Works    │
│  in VS Code     │               │  on 50 Tickets  │
└─────────────────┘               └────────┬────────┘
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │  Completion     │ → Notification
                                  │  Notification   │   All 50 tests
                                  └────────┬────────┘   generated
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │  Review &       │ → Merge worktree
                                  │  Merge Changes  │   Apply tests
                                  └─────────────────┘
```

---

## 📊 Agent Interaction Matrix

```
                   │ TestGenie │ ScriptGen │ BugGenie │ Orchestrator │
───────────────────┼───────────┼───────────┼──────────┼──────────────┤
Input: Jira URL    │     ✓     │           │          │      ✓       │
Input: Manual Steps│           │     ✓     │          │      ✓       │
Input: Test Failure│           │           │    ✓     │      ✓       │
───────────────────┼───────────┼───────────┼──────────┼──────────────┤
Output: Test Cases │     ✓     │           │          │              │
Output: Playwright │     (opt) │     ✓     │          │              │
Output: Jira Ticket│           │           │    ✓     │              │
───────────────────┼───────────┼───────────┼──────────┼──────────────┤
Triggers TestGenie │           │           │    (opt) │      ✓       │
Triggers ScriptGen │     (opt) │           │          │      ✓       │
Triggers BugGenie  │           │     (opt) │          │      ✓       │
───────────────────┼───────────┼───────────┼──────────┼──────────────┤
Background Support │     ✓     │     ✓     │    ✓     │      ✓       │
Worktree Isolation │     ✓     │     ✓     │    ✓     │      ✓       │
Parallel Execution │     ✓     │     ✓     │    ✓     │      ✓       │
```

---

## 🎯 Decision Tree: Which Agent to Use?

```
                    ┌─────────────────┐
                    │  What do you    │
                    │  want to do?    │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │ Generate  │    │ Automate  │    │  Report   │
    │   Test    │    │   Tests   │    │   Bug     │
    │  Cases    │    │           │    │           │
    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
          │                │                │
          ▼                ▼                ▼
    Have Jira URL?   Have Manual Steps? Have Failure?
          │                │                │
      Yes │ No         Yes │ No         Yes │ No
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │TestGenie │     │ScriptGen │     │BugGenie  │
    └──────────┘     └──────────┘     └──────────┘
          │                │                │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
    │ Want to   │    │ Need test │    │ Need test │
    │ automate? │    │   cases?  │    │   cases?  │
    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
          │                │                │
      Yes │ No         Yes │ No         Yes │ No
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │ScriptGen │     │TestGenie │     │TestGenie │
    └──────────┘     └──────────┘     └──────────┘

    MULTI-STEP? → Use Orchestrator for any of above!
```

---

## 📈 Performance Comparison

### Before Orchestration (Manual Steps)
```
┌──────────────┐
│ Step 1:      │ → Developer reads Jira              [5 min]
│ Manual       │   Writes test cases manually        [30 min]
├──────────────┤
│ Step 2:      │ → Developer reviews framework       [10 min]
│ Manual       │   Writes Playwright test            [45 min]
├──────────────┤
│ Step 3:      │ → Test fails, debug                 [20 min]
│ Manual       │   Fix selectors, retry              [15 min]
├──────────────┤
│ Step 4:      │ → Developer formats bug ticket      [10 min]
│ Manual       │   Creates Jira issue manually       [5 min]
└──────────────┘
                  TOTAL: ~140 minutes (2h 20min)
```

### After Orchestration (Automated)
```
┌──────────────┐
│ Step 1:      │ → "@orchestrator automate AOTF-1234"
│ Automated    │   TestGenie generates test cases     [2 min]
├──────────────┤
│ Step 2:      │ → ScriptGenerator creates Playwright
│ Automated    │   Validates selectors automatically  [3 min]
├──────────────┤
│ Step 3:      │ → Test runs, if fails automatically
│ Automated    │   BugGenie creates formatted ticket  [1 min]
└──────────────┘
                  TOTAL: ~6 minutes
                  
                  🎉 95% time savings!
                  🎉 23x faster!
```

---

## 💎 Value Proposition

### Benefits Summary

```
┌─────────────────────────────────────────────────────────┐
│                    BEFORE                               │
├─────────────────────────────────────────────────────────┤
│ ❌ Manual test case creation (30+ min per ticket)       │
│ ❌ Manual Playwright scripting (45+ min per test)       │
│ ❌ Context switching between tools                      │
│ ❌ Inconsistent formatting and quality                  │
│ ❌ One task at a time (sequential)                      │
│ ❌ Developer blocked during test generation             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                     AFTER                               │
├─────────────────────────────────────────────────────────┤
│ ✅ Automated test generation (2-5 min per ticket)       │
│ ✅ Framework-aware automation (reuses page objects)     │
│ ✅ Unified interface (VS Code Chat)                     │
│ ✅ Consistent, high-quality output                      │
│ ✅ Parallel execution (10+ tickets simultaneously)      │
│ ✅ Background agents (work continues uninterrupted)     │
│ ✅ Git worktree isolation (no conflicts)                │
│ ✅ Automatic handoffs (no manual intervention)          │
└─────────────────────────────────────────────────────────┘

                      ROI: 95% Time Savings
                  Capacity: 23x Throughput Increase
```

---

## 🎬 Demo Script

### Quick Demo (5 minutes)

```
1. Open VS Code → Chat Panel

2. Say: "@orchestrator What workflows do you support?"
   → Shows available workflows

3. Say: "@orchestrator Automate testing for AOTF-1234"
   → Watch agents work:
     - TestGenie fetches Jira
     - Generates test cases
     - ScriptGenerator creates Playwright
     - Test executes automatically

4. Say: "Now generate automation for AOTF-1235, 1236, 1237 in parallel"
   → Show background agents in Sessions view
   → All run simultaneously in worktrees

5. Say: "@buggenie Create bug: Images not loading in UAT Canopy"
   → Show 2-step workflow
   → Review copy → Confirm → Jira created
```

---

**This workflow documentation is optimized for:**
- Executive presentations
- Team training
- Process documentation
- Value demonstration
- Technical walkthroughs

Feel free to copy these diagrams into presentations, wikis, or documentation!
