# 🔗 Agent Communication Protocol

**Version:** 1.0.0  
**Last Updated:** January 18, 2026

This document defines the standardized communication protocol between agents in the multi-agent test automation workflow.

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [Message Format](#message-format)
3. [Error Codes](#error-codes)
4. [Handoff Protocol](#handoff-protocol)
5. [Context Passing](#context-passing)
6. [Recovery Procedures](#recovery-procedures)

---

## Overview

### Agent Hierarchy

```
┌────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                             │
│                    (Workflow Coordinator & Router)                 │
└───────────────┬────────────────────┬────────────────────┬──────────┘
        │                    │                    │
    ┌───────▼───────┐    ┌──────▼─────────┐   ┌──────▼───────┐
    │   TESTGENIE   │    │ SCRIPTGENERATOR │   │   BUGGENIE   │
    │ Manual Cases  │    │ Automation Gen  │   │  Bug Report  │
    └───────┬───────┘    └──────┬─────────┘   └──────┬───────┘
        │                   │                    │
    ┌───────▼───────┐    ┌──────▼─────────┐   ┌──────▼───────┐
    │   TASKGENIE   │    │ CODEREVIEWER   │   │ Utility Agents│
    │ Testing Tasks │    │ Script Review  │   │ File/Doc Ops  │
    └───────────────┘    └────────────────┘   └───────────────┘
```

Protocol note:

- The message contract below documents the core QA workflow.
- FileGenie and DocGenie are utility agents and are not part of the default stage chain.

### Communication Flow

```
User Request → Orchestrator → Parse & Route → Invoke Agent(s)
                    ↓
             [Workflow State]
                    ↓
           Stage Transitions → Validation → Next Agent
                    ↓
           Completion/Error → Report to User
```

---

## Message Format

### Standard Request Format

```javascript
{
    "messageType": "AGENT_REQUEST",
    "workflowId": "AOTF-1234-1737200000000",
    "ticketId": "AOTF-1234",
    "sourceAgent": "orchestrator",
    "targetAgent": "testgenie",
    "stage": "JIRA_FETCHED",
    "timestamp": "2026-01-18T10:30:00.000Z",
    "context": {
        "templateName": "jira-to-automation",
        "environment": "UAT",
        "mlsContext": "Canopy",
        "previousStage": "PENDING",
        "artifacts": {}
    },
    "payload": {
        "ticketUrl": "https://pbltest.atlassian.net/browse/AOTF-1234",
        "requirements": []
    }
}
```

### Standard Response Format

```javascript
{
    "messageType": "AGENT_RESPONSE",
    "workflowId": "AOTF-1234-1737200000000",
    "sourceAgent": "testgenie",
    "targetAgent": "orchestrator",
    "stage": "EXCEL_CREATED",
    "status": "SUCCESS",  // SUCCESS | FAILED | RETRY_NEEDED
    "timestamp": "2026-01-18T10:32:00.000Z",
    "result": {
        "testCasesCount": 8,
        "totalSteps": 24
    },
    "artifacts": {
        "excelPath": "c:/Github/PW_regression-suite/test-cases/AOTF-1234.xlsx",
        "fileSize": 15200
    },
    "validation": {
        "passed": true,
        "checks": {
            "fileExists": true,
            "validExtension": true,
            "minSize": true
        }
    },
    "nextAction": {
        "agent": "scriptgenerator",
        "stage": "SCRIPT_EXPLORATION"
    }
}
```

### Error Response Format

```javascript
{
    "messageType": "AGENT_ERROR",
    "workflowId": "AOTF-1234-1737200000000",
    "sourceAgent": "scriptgenerator",
    "errorCode": "E2004",
    "errorType": "SCRIPT_EXPLORATION_FAILED",
    "message": "Failed to navigate to application URL",
    "recoverable": true,
    "retryable": true,
    "timestamp": "2026-01-18T10:35:00.000Z",
    "details": {
        "stage": "SCRIPT_EXPLORATION",
        "failedStep": "Navigate to UAT URL",
        "error": "ERR_NAME_NOT_RESOLVED",
        "suggestion": "Check network connectivity and UAT environment status"
    },
    "recoveryAction": {
        "type": "RETRY",
        "maxAttempts": 3,
        "delayMs": 5000
    }
}
```

---

## Error Codes

### Error Code Categories

| Range | Category | Description |
|-------|----------|-------------|
| E1xxx | Validation | Pre-execution validation failures |
| E2xxx | Stage | Stage-specific execution failures |
| E3xxx | Artifact | Artifact validation failures |
| E4xxx | System | System/infrastructure failures |
| E5xxx | Timeout | Timeout-related failures |

### Complete Error Code Reference

```javascript
const ErrorCode = {
    // Validation Errors (1xxx)
    E1001: { type: 'INVALID_TICKET_FORMAT', recoverable: true,
             fix: 'Use format PROJECT-NUMBER (e.g., AOTF-1234)' },
    E1002: { type: 'INVALID_TEMPLATE', recoverable: true,
             fix: 'Use: jira-to-automation or jira-to-testcases' },
    E1003: { type: 'ACTIVE_WORKFLOW_EXISTS', recoverable: true,
             fix: 'Complete or cancel existing workflow first' },
    E1004: { type: 'MISSING_DIRECTORY', recoverable: true,
             fix: 'Create required directory structure' },
    E1005: { type: 'MCP_NOT_CONFIGURED', recoverable: true,
             fix: 'Configure MCP in VS Code settings' },
    
    // Stage Errors (2xxx)
    E2001: { type: 'JIRA_FETCH_FAILED', recoverable: true,
             fix: 'Verify ticket exists and Atlassian MCP is connected' },
    E2002: { type: 'TESTCASE_GENERATION_FAILED', recoverable: true,
             fix: 'Check Jira ticket has acceptance criteria' },
    E2003: { type: 'EXCEL_CREATION_FAILED', recoverable: true,
             fix: 'Verify test-cases/ directory is writable' },
    E2004: { type: 'SCRIPT_EXPLORATION_FAILED', recoverable: true,
             fix: 'Check UAT environment and unified MCP connectivity' },
    E2005: { type: 'SCRIPT_GENERATION_FAILED', recoverable: true,
             fix: 'Verify test structure and framework patterns' },
    E2006: { type: 'SCRIPT_EXECUTION_FAILED', recoverable: true,
             fix: 'Review test output and fix failing assertions' },
    
    // Validation Errors (3xxx)
    E3001: { type: 'EXCEL_VALIDATION_FAILED', recoverable: true,
             fix: 'Regenerate Excel with required format' },
    E3002: { type: 'SCRIPT_VALIDATION_FAILED', recoverable: true,
             fix: 'Ensure script follows .spec.js framework patterns' },
    E3003: { type: 'PREREQUISITE_NOT_MET', recoverable: false,
             fix: 'Complete required previous stage first' },
    
    // System Errors (4xxx)
    E4001: { type: 'STATE_SAVE_FAILED', recoverable: true,
             fix: 'Check file permissions for workflow-state.json' },
    E4002: { type: 'STATE_LOAD_FAILED', recoverable: true,
             fix: 'Delete corrupted state file to reset' },
    E4003: { type: 'WORKFLOW_NOT_FOUND', recoverable: false,
             fix: 'Start a new workflow with valid ID' },
    E4004: { type: 'WORKFLOW_INACTIVE', recoverable: false,
             fix: 'Cannot modify completed/failed workflow' },
    
    // Timeout Errors (5xxx)
    E5001: { type: 'STAGE_TIMEOUT', recoverable: true,
             fix: 'Increase timeout or retry stage' },
    E5002: { type: 'WORKFLOW_TIMEOUT', recoverable: false,
             fix: 'Workflow exceeded 24-hour limit, start new' }
};
```

---

## Handoff Protocol

### TestGenie → ScriptGenerator Handoff

**Required Context:**
```javascript
{
    workflowId: "AOTF-1234-1737200000000",
    ticketId: "AOTF-1234",
    ticketTitle: "Implement Roomvo clause verification",
    
    // Artifacts from TestGenie
    artifacts: {
        excelPath: "c:/Github/.../test-cases/AOTF-1234.xlsx",
        excelValidated: true,
        testCasesCount: 8
    },
    
    // Test case summary for quick reference
    testCases: [
        { id: "TC1", title: "Verify Roomvo in Terms", steps: 5 },
        { id: "TC2", title: "Verify Roomvo in Privacy", steps: 4 }
    ],
    
    // Environment context
    environment: "UAT",
    baseUrl: "<UAT_URL from .env>",
    mlsContext: "Canopy",
    
    // Authentication
    authMethod: "token",
    tokenType: "userTokens.registered"
}
```

### ScriptGenerator → BugGenie Handoff (On Failure)

**Required Context:**
```javascript
{
    workflowId: "AOTF-1234-1737200000000",
    ticketId: "AOTF-1234",
    
    // Failure details
    failureType: "TEST_EXECUTION_FAILED",
    failedAttempts: 3,
    
    // Iteration details
    iterations: [
        { attempt: 1, error: "Element not found", fix: "Updated selector" },
        { attempt: 2, error: "Timeout", fix: "Re-explored with MCP" },
        { attempt: 3, error: "Assertion failed", fix: "Rebuilt test" }
    ],
    
    // Bug report context
    environment: "UAT",
    mlsContext: "Canopy",
    expectedBehavior: "Roomvo clause visible in Terms of Use",
    actualBehavior: "Roomvo clause not found on page",
    
    // Reproduction steps
    reproSteps: [
        "1. Navigate to the UAT environment URL",
        "2. Click on Terms of Use link",
        "3. Search for 'Roomvo' text"
    ],
    
    // Artifacts
    scriptPath: "tests/specs/aotf-1234/roomvo-verification.spec.js",
    screenshotPath: "test-results/failure-screenshot.png",
    tracePath: "test-results/trace.zip"
}
```

---

## Context Passing

### Workflow Context Object

All agents receive and pass this context:

```javascript
const WorkflowContext = {
    // Identity
    workflowId: String,      // Unique workflow ID
    ticketId: String,        // Jira ticket ID
    templateName: String,    // jira-to-automation | jira-to-testcases
    
    // State
    currentStage: String,    // Current workflow stage
    previousStage: String,   // Previous stage for recovery
    stageHistory: Array,     // Complete stage history
    
    // Artifacts
    artifacts: {
        excelPath: String,
        scriptPath: String,
        testResultPath: String
    },
    
    // Environment
    environment: String,     // UAT | PROD
    baseUrl: String,
    mlsContext: String,
    
    // Authentication
    authMethod: String,      // token | sso
    tokenType: String,       // userTokens.registered | userTokens.agent
    
    // Agent state
    agentResponses: Map,     // Responses from each agent
    errors: Array,           // Error history
    retryCount: Number       // Current retry count
};
```

### Context Preservation Rules

1. **Always include workflowId** in every agent call
2. **Pass complete artifacts** - don't reference, include full paths
3. **Include previous stage** for recovery context
4. **Preserve error history** for debugging
5. **Use absolute paths** for all file references

---

## Recovery Procedures

### Stage Recovery Matrix

| Error Code | Stage | Recovery Action | Max Retries |
|------------|-------|-----------------|-------------|
| E2001 | JIRA_FETCHED | Retry with delay | 3 |
| E2002 | TESTCASES_GENERATED | Retry with different prompt | 2 |
| E2003 | EXCEL_CREATED | Recreate file | 2 |
| E2004 | SCRIPT_EXPLORATION | Re-explore with MCP | 3 |
| E2005 | SCRIPT_GENERATED | Regenerate script | 2 |
| E2006 | SCRIPT_EXECUTED | Auto-fix and retry | 3 |

### Automatic Recovery Flow

```
Error Detected
    │
    ▼
Check Error Code
    │
    ├─► Recoverable? ─► NO ──► Fail Workflow
    │                          │
    ▼                          ▼
    YES                   Record Error
    │                     Invoke BugGenie
    ▼
Check Retry Count
    │
    ├─► Under Max? ─► NO ──► Fail Stage
    │                        │
    ▼                        ▼
    YES                  Try Recovery Path
    │
    ▼
Calculate Backoff Delay
    │
    ▼
Wait (exponential)
    │
    ▼
Retry Operation
    │
    ├─► Success? ─► YES ──► Continue Workflow
    │
    ▼
    NO ──► Increment Retry ──► Loop Back
```

### Recovery Actions by Type

```javascript
const RecoveryActions = {
    RETRY: {
        description: 'Retry same operation with delay',
        strategy: 'exponential_backoff',
        delays: [1000, 2000, 4000]  // ms
    },
    
    REFRESH_MCP: {
        description: 'Reconnect MCP and retry',
        strategy: 'reconnect_then_retry',
        timeout: 30000  // ms
    },
    
    RE_EXPLORE: {
        description: 'Re-explore with unified MCP browser tooling',
        strategy: 'fresh_exploration',
        timeout: 180000  // ms
    },
    
    REGENERATE: {
        description: 'Regenerate artifact from scratch',
        strategy: 'full_regeneration',
        preserveContext: true
    },
    
    ESCALATE: {
        description: 'Escalate to BugGenie for defect',
        strategy: 'create_bug_ticket',
        preserveArtifacts: true
    },
    
    ROLLBACK: {
        description: 'Rollback and fail workflow',
        strategy: 'preserve_testgenie_artifacts',
        cleanup: ['partial_scripts', 'temp_files']
    }
};
```

---

## Best Practices

### ✅ Do

- Always validate artifacts before handoff
- Include complete context in every message
- Use error codes for consistent error handling
- Log all stage transitions
- Preserve TestGenie artifacts on failure

### ❌ Don't

- Pass relative file paths (use absolute)
- Skip validation checkpoints
- Retry non-recoverable errors
- Lose context between agents
- Write to Jira without user confirmation

---

## Example: Complete Workflow Trace

```
[10:30:00] USER: @orchestrator workflow=jira-to-automation ticket=AOTF-1234

[10:30:01] ORCHESTRATOR → WORKFLOW_COORDINATOR
           Action: initializeWorkflow
           Result: workflowId=AOTF-1234-1737200001000
           Stage: PENDING → JIRA_FETCHED

[10:30:02] ORCHESTRATOR → TESTGENIE
           Message: { workflowId, ticketId, stage: JIRA_FETCHED }

[10:30:15] TESTGENIE → ORCHESTRATOR
           Stage: JIRA_FETCHED → TESTCASES_GENERATED
           Result: { testCasesCount: 8 }

[10:30:45] TESTGENIE → ORCHESTRATOR
           Stage: TESTCASES_GENERATED → EXCEL_CREATED
           Artifacts: { excelPath: "test-cases/AOTF-1234.xlsx" }
           Validation: PASSED

[10:30:46] ORCHESTRATOR → SCRIPTGENERATOR
           Message: { workflowId, ticketId, excelPath, stage: SCRIPT_EXPLORATION }

[10:32:00] SCRIPTGENERATOR → ORCHESTRATOR
           Stage: SCRIPT_EXPLORATION → SCRIPT_GENERATED
           Artifacts: { scriptPath: "tests/specs/aotf-1234/test.spec.js" }

[10:33:00] SCRIPTGENERATOR → ORCHESTRATOR
           Stage: SCRIPT_GENERATED → SCRIPT_EXECUTED
           Result: { passed: true, duration: "5.2s" }

[10:33:01] ORCHESTRATOR → WORKFLOW_COORDINATOR
           Action: completeWorkflow
           Stage: SCRIPT_EXECUTED → COMPLETED
           Summary: { duration: "3m 1s", artifacts: 2, errors: 0 }

[10:33:02] ORCHESTRATOR → USER
           ✅ Workflow completed successfully
           📁 Artifacts: Excel + Playwright script
           ⏱️ Duration: 3m 1s
```

---

**Document Version:** 1.0.0  
**Maintained By:** QA Automation Team  
**Review Cycle:** Monthly
