# Quick Reference: Multi-Agent Orchestration

## 🚀 One-Line Commands

### Test Case Generation
```
@testgenie Generate test cases for AOTF-1234
```
*Note: Test cases appear directly in chat window as formatted tables*

### Automation Creation
```
@scriptgenerator Automate test cases from tests/manual/feature.md
```

### Bug Reporting
```
@buggenie Create bug: Property images not loading in UAT Canopy
```

### Complete Workflow
```
@orchestrator Automate AOTF-1234 - generate tests and create Playwright automation
```

---

## 🔄 Common Workflows

### 1. Jira Ticket → Full Automation
```
@orchestrator Create complete test automation for Jira ticket AOTF-5678 
including manual test cases and Playwright specs
```

### 2. Manual Steps → Automation
```
@scriptgenerator Convert these manual steps to Playwright:
1. Login to OneHome UAT
2. Search properties in San Francisco with 3+ beds
3. Verify filter results
```

### 3. Test Failure → Bug Ticket
```
@buggenie Failed test in UAT:
Test: Property Detail Page
Expected: Images load
Actual: 404 errors, images missing
MLS: Canopy
```

### 4. Batch Processing (Background)
```
@orchestrator Generate automation for tickets AOTF-1234, AOTF-1235, AOTF-1236 
in parallel using background agents
```

---

## 📋 Agent Selection Guide

| Task | Agent | Command Prefix |
|------|-------|----------------|
| Generate test cases from Jira | TestGenie | `@testgenie` |
| Create Playwright automation | ScriptGenerator | `@scriptgenerator` |
| Create bug/defect ticket | BugGenie | `@buggenie` |
| Multi-step workflow | Orchestrator | `@orchestrator` |
| Ask about capabilities | Any | `What subagents can you use?` |

---

## 🎯 Agent Handoffs

```
Jira Ticket
    ↓
[TestGenie] → Manual Test Cases
    ↓
[ScriptGenerator] → Playwright Automation
    ↓
[Execute Test]
    ↓
  ┌─────┴─────┐
  │           │
Pass         Fail
  │           ↓
Done    [BugGenie] → Jira Defect Ticket
              ↓
        [Optional: Testing Task]
              ↓
        [TestGenie] → Test Cases for Testing Task
```

---

## ⚙️ Background Agents

### Start Background Agent
```
@orchestrator Generate automation for AOTF-1234, run in background
```

### Create with Git Worktree (Recommended for Parallel)
```
@orchestrator Automate sprint 23 tickets in background with Git worktrees
```

### Check Status
- Open Chat panel
- View Sessions list
- Click session to see details

### Continue Local → Background
1. Start work in local chat
2. Click "Continue in" button
3. Select "Background Agent"
4. Work moves to background

---

## 🔧 Settings Quick Toggle

### Enable All Features
Add to `.vscode/settings.json`:
```json
{
  "chat.customAgentInSubagent.enabled": true,
  "github.copilot.chat.cli.customAgents.enabled": true,
  "chat.viewSessions.enabled": true
}
```

### Disable Auto-Approval (Security)
```json
{
  "chat.tools.eligibleForAutoApproval": ["readFile", "fileSearch"]
}
```

---

## 🐛 Quick Troubleshooting

| Issue | Quick Fix |
|-------|-----------|
| Agent not found | Check `.github/agents/` folder, restart VS Code |
| Wrong agent responds | Use `@agentname` explicitly |
| Context lost | Use `@orchestrator` for multi-step workflows |
| Agents conflict | Use Git worktrees with background agents |
| Session not visible | Enable `chat.viewSessions.enabled` |
| Test fails after 3 attempts | See "Test Retry Decision Guide" below |

---

## 🔄 Test Retry Decision Guide (After 3 Failed Attempts)

### Quick Decision Tree

```
Test failed 3 times → Check pass rate:
│
├─ 0% passing → Check environment
│   ├─ App/feature working? → No → @buggenie create bug
│   └─ Blocker (auth/data)? → Yes → Fix blocker, retry
│
├─ 70-90% passing → Partial success
│   ├─ Edge cases failing? → Accept passing tests, mark rest manual
│   └─ Close to working? → @scriptgenerator 2 more attempts
│
└─ 100% but intermittent → Stability issue
    └─ @scriptgenerator add stability improvements
```

### Fast Commands

```bash
# Continue with 2 more attempts (max 5 total)
@scriptgenerator Continue debugging with 2 additional attempts for [test-name]

# Accept partial automation (70%+ passing)
@orchestrator Accept automation with [X]/[Y] tests passing, document rest as manual

# Create bug report for app defect
@buggenie Test automation revealed defect: [describe issue]

# Pause for manual intervention
@orchestrator Pause automation - need to resolve: [blocker type]
```

### When to Continue vs Stop

**✅ Continue (Attempts 4-5):**
- Each attempt shows progress
- 70%+ already passing, refining edge cases
- Technical issues (selectors, timing), not app bugs
- New information suggests solution

**❌ Stop after 3:**
- Same error repeating, no progress
- App clearly not working as designed
- Environment/systematic blocker
- Already spent 30+ minutes

### Typical Scenarios

| Scenario | Pass Rate | Action | Command |
|----------|-----------|--------|---------|
| App defect | 0% | Bug report | `@buggenie [details]` |
| Missing data | 0% | Fix & retry | Fix blocker → `@scriptgenerator retry` |
| Mostly working | 80%+ | Accept partial | `@orchestrator accept [X]/[Y] passing` |
| Close to success | 70% | 2 more tries | `@scriptgenerator 2 more attempts` |
| Timing issues | Intermittent | Add stability | `@scriptgenerator enhance stability` |

---

## 💡 Pro Tips

1. **Explicit is Better:** Use `@agentname` to be specific
2. **Background for Batches:** Use background agents for multiple tickets
3. **Worktrees for Parallel:** Always use Git worktrees for parallel execution
4. **Review First:** BugGenie uses 2-step workflow - review before creating tickets
5. **Context Attachment:** Right-click code → "Add to Chat" for better context
6. **Monitor Progress:** Keep Chat panel open to monitor background agents
7. **Archive Sessions:** Keep sessions list clean by archiving completed work
8. **Jira Policy:** Agents READ from Jira, but NEVER add comments - all updates shown in chat

---

## 🔒 Jira Interaction Policy

**What Agents CAN Do:**
- ✅ Fetch and read Jira ticket details
- ✅ Create NEW bug tickets (BugGenie only)
- ✅ Display information in chat

**What Agents CANNOT Do:**
- ❌ Add comments to existing Jira tickets
- ❌ Update existing ticket fields
- ❌ Post automation results directly to Jira

**Why:** 
- Keeps Jira clean and controlled
- Users review before posting
- Prevents automated spam/noise
- Maintains ticket quality

**How to Update Jira:**
1. Agent shows results in chat
2. User reviews the output
3. User manually adds to Jira if needed

---

## 🎬 Example Session

```
You: @orchestrator Automate AOTF-1234

Orchestrator: Starting workflow...
├─ [TestGenie] Fetching Jira ticket AOTF-1234...
├─ [TestGenie] Generating test cases covering 5 acceptance criteria...
├─ [TestGenie] ✓ Test cases complete (8 steps)
├─ [ScriptGenerator] Exploring framework structure...
├─ [ScriptGenerator] Reusing existing page objects...
├─ [ScriptGenerator] Validating selectors...
├─ [ScriptGenerator] ✓ Generated: tests/specs/property-search/aotf-1234.spec.js
├─ [Execute] Running test...
└─ [Execute] ✓ Test passed! 8/8 steps successful

Workflow complete! 
- Manual test cases: [shown above]
- Automation: tests/specs/property-search/aotf-1234.spec.js
```

---

## 📞 Need Help?

- Check [README.md](.github/agents/README.md) for detailed documentation
- Review individual agent files in `.github/agents/`
- Check VS Code Output panel (Copilot Chat)
- Ask: `@orchestrator What workflows do you support?`

---

**Last Updated:** December 12, 2025  
**VS Code Version:** 1.107+  
**Feature:** Multi-Agent Orchestration
