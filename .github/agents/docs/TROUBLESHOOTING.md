# Troubleshooting Guide: Multi-Agent Orchestration

## 🔍 Common Issues and Solutions

---

## Issue 1: Agents Not Appearing in Chat

### Symptoms
- Custom agents don't appear when using `@` in Chat
- "What subagents can you use?" returns empty or incorrect list
- Agent commands not recognized

### Solutions

#### Solution 1A: Verify File Location
```bash
# Agents MUST be in .github/agents/ folder
ls .github/agents/

# Should show:
# testgenie.agent.md
# scriptgenerator.agent.md
# buggenie.agent.md
# orchestrator.agent.md
```

#### Solution 1B: Check File Format
Ensure each agent file has proper YAML frontmatter:
```markdown
---
description: 'Your agent description here'
tools: ['tool1', 'tool2']
infer: true
---

# Agent content here
```

#### Solution 1C: Verify Settings
Check [.vscode/settings.json](.vscode/settings.json):
```json
{
  "chat.customAgentInSubagent.enabled": true,
  "github.copilot.chat.cli.customAgents.enabled": true
}
```

#### Solution 1D: Restart VS Code
```bash
# Close VS Code completely
# Reopen workspace
# Wait 10-15 seconds for agents to load
```

#### Solution 1E: Check VS Code Version
```bash
# Open Command Palette (Ctrl+Shift+P)
# Type: "About"
# Verify version is 1.107.0 or later
```

---

## Issue 2: Wrong Agent Responds to Request

### Symptoms
- Asked for TestGenie but ScriptGenerator responded
- Orchestrator not delegating to correct subagent
- Multiple agents respond simultaneously

### Solutions

#### Solution 2A: Use Explicit Agent Names
```bash
# Instead of:
"Generate test cases for AOTF-1234"

# Use:
"@testgenie Generate test cases for AOTF-1234"
```

#### Solution 2B: Improve Agent Descriptions
Edit agent file frontmatter to be more specific:
```yaml
---
description: 'Test Case Generation - Creates manual test cases from Jira tickets with acceptance criteria coverage'
# More specific = better routing
---
```

#### Solution 2C: Check `infer` Setting
```yaml
---
# Set to false if you DON'T want automatic inference
infer: false

# Set to true for automatic subagent usage
infer: true
---
```

---

## Issue 3: Agent Doesn't Have Required Tools

### Symptoms
- Error: "Tool not available"
- Agent can't fetch Jira tickets
- Agent can't use Playwright MCP
- File operations fail

### Solutions

#### Solution 3A: Verify Tool Configuration
Check agent's `tools` array:
```yaml
---
tools: ['atlassian/atlassian-mcp-server/*']  # For Jira access
---
```

For TestGenie and BugGenie:
```yaml
tools: ['atlassian/atlassian-mcp-server/*']
```

For ScriptGenerator:
```yaml
tools: [
  'search/fileSearch',
  'search/textSearch',
  'search/codebase',
  'edit',
  'microsoft/playwright-mcp/*'
]
```

#### Solution 3B: Install Missing MCP Servers
```bash
# Check if Atlassian MCP is installed
# Open VS Code Settings
# Search for: "MCP"
# Verify Atlassian MCP server is configured

# Check if Playwright MCP is installed
# Look for Playwright MCP in extensions
```

#### Solution 3C: Enable MCP Server
```json
// In VS Code settings
{
  "mcp.servers": {
    "atlassian": {
      "enabled": true
    },
    "playwright": {
      "enabled": true
    }
  }
}
```

---

## Issue 4: Context Lost Between Agent Handoffs

### Symptoms
- ScriptGenerator doesn't receive test cases from TestGenie
- BugGenie doesn't have error details from test failure
- Agents ask for information already provided

### Solutions

#### Solution 4A: Use Orchestrator
```bash
# Instead of calling agents separately:
@testgenie Generate tests for AOTF-1234
# [wait]
@scriptgenerator Create automation from above tests

# Use orchestrator to maintain context:
@orchestrator Automate AOTF-1234 - generate test cases and Playwright automation
```

#### Solution 4B: Attach Context Explicitly
```bash
# Right-click on test cases in editor
# Select "Add to Chat"
# Then invoke next agent
@scriptgenerator Create automation from attached test cases
```

#### Solution 4C: Pass Key Information
```bash
# Include critical details in each request
@scriptgenerator Create Playwright test for AOTF-1234 property search 
using test cases: [paste test cases]
Environment: UAT Canopy
```

---

## Issue 5: Background Agents Not Working

### Symptoms
- "Continue in Background" button doesn't appear
- Background agent fails to start
- Can't see background agent status

### Solutions

#### Solution 5A: Enable Background Agent Settings
```json
{
  "github.copilot.chat.cli.customAgents.enabled": true,
  "chat.viewSessions.enabled": true
}
```

#### Solution 5B: Check GitHub Copilot Subscription
```bash
# Background agents require active GitHub Copilot subscription
# Verify in: VS Code Settings → GitHub Copilot
```

#### Solution 5C: View Sessions Panel
```bash
# Open Chat panel
# Look for "Sessions" section at top
# Click to expand and see all agents
```

#### Solution 5D: Start Background Agent Explicitly
```bash
@orchestrator Generate automation for AOTF-1234, run in background
```

---

## Issue 6: Git Worktree Conflicts

### Symptoms
- Background agents report file conflicts
- Changes from one agent overwrite another's changes
- Merge conflicts when applying worktree changes

### Solutions

#### Solution 6A: Use Worktrees for Parallel Execution
```bash
# When creating background agent, check "Use Git Worktree" option
# Or specify in command:
@orchestrator Generate automation for tickets in sprint 23, 
use Git worktrees for isolation
```

#### Solution 6B: Different Output Paths
Ensure agents output to different locations:
```javascript
// Agent 1: tests/specs/feature-a/
// Agent 2: tests/specs/feature-b/
// Agent 3: tests/specs/feature-c/
```

#### Solution 6C: Review Before Merging
```bash
# After background agent completes:
1. Review changes in worktree
2. Check for conflicts
3. Manually resolve if needed
4. Then apply changes to main workspace
```

---

## Issue 7: Jira Integration Failures

### Symptoms
- "Can't fetch Jira ticket"
- "Authentication failed"
- "Project not found"

### Solutions

#### Solution 7A: Verify Jira Credentials
Check Atlassian MCP configuration (values from `.env` or `workflow-config.json`):
```json
{
  "projectKey": "<JIRA_PROJECT_KEY from .env>",
  "cloudId": "<JIRA_CLOUD_ID from .env>"
}
```

#### Solution 7B: Authenticate with Atlassian
```bash
# Check if you're logged in to Atlassian
# VS Code may prompt for authentication
# Follow the authentication flow
```

#### Solution 7C: Verify Project Access
```bash
# Ensure you have access to AOTF project
# Check permissions in Jira web interface
# User needs at least read access
```

#### Solution 7D: Test MCP Connection
```bash
# In Chat, ask:
"@testgenie Can you access Jira project AOTF?"
# If fails, troubleshoot MCP server setup
```

---

## Issue 8: Playwright Test Generation Fails

### Symptoms
- ScriptGenerator creates test but it doesn't run
- Import errors in generated test
- Selectors not found

### Solutions

#### Solution 8A: Verify Framework Structure
```bash
# Check that required files exist:
ls tests/config/config.js
ls tests/pageobjects/POManager.js
ls tests/test-data/testData.js
```

#### Solution 8B: Install Dependencies
```bash
npm install
npx playwright install
```

#### Solution 8C: Run Test Manually
```bash
# Test the generated file:
npx playwright test tests/specs/feature/test-name.spec.js

# Check errors and provide feedback to ScriptGenerator
```

#### Solution 8D: Provide More Context
```bash
@scriptgenerator Create test using:
- Config: tests/config/config.js
- POManager: tests/pageobjects/POManager.js
- Pattern: Follow tests/specs/example.spec.js
```

---

## Issue 9: BugGenie Creates Ticket Too Early

### Symptoms
- Jira ticket created before review
- Ticket has wrong information
- Can't edit after creation

### Solutions

#### Solution 9A: Understand 2-Step Process
```bash
# BugGenie ALWAYS uses 2 steps:
# Step 1: Generate review copy (automatic)
# Step 2: Create Jira (only after you confirm)

# Never says "create bug ticket" in first message
# Always wait for review copy first
```

#### Solution 9B: If Ticket Created Incorrectly
```bash
# In Jira web interface:
1. Edit the ticket manually
2. Or close and create new one

# For future:
@buggenie First show me review copy for bug: [description]
# Review carefully before confirming
```

---

## Issue 10: Slow Performance

### Symptoms
- Agents take very long to respond
- Background agents seem stuck
- VS Code becomes unresponsive

### Solutions

#### Solution 10A: Check Network Connection
```bash
# Agents need internet to access:
# - GitHub Copilot API
# - Jira (Atlassian MCP)
# - Playwright MCP

# Verify stable internet connection
```

#### Solution 10B: Reduce Parallel Agents
```bash
# Don't create too many background agents at once
# Limit to 3-5 simultaneous agents

# Instead of:
@orchestrator Automate 50 tickets in parallel

# Do:
@orchestrator Automate 5 tickets in parallel
# [wait for completion]
# Then start next batch
```

#### Solution 10C: Use Worktrees
```bash
# Worktrees improve performance for parallel execution
# Ensure enabled when creating background agents
```

#### Solution 10D: Check VS Code Output
```bash
# Open Output panel: Ctrl+Shift+U
# Select: "GitHub Copilot Chat"
# Look for errors or warnings
```

---

## Diagnostic Commands

### Check Agent Status
```bash
@orchestrator What subagents can you use?
```

### Check Tool Availability
```bash
@testgenie What tools do you have access to?
```

### Check Current Configuration
```bash
# Open Command Palette (Ctrl+Shift+P)
# Type: "Open Settings (JSON)"
# Review all chat.* settings
```

### View Active Sessions
```bash
# In Chat panel
# Look for "Sessions" section
# Shows all active and archived agents
```

### Check Logs
```bash
# VS Code Output panel (Ctrl+Shift+U)
# Select: "GitHub Copilot Chat"
# Review recent activity and errors
```

---

## Getting Help

### 1. Check Documentation
- [README.md](.github/agents/README.md) - Full setup guide
- [QUICKREF.md](.github/agents/QUICKREF.md) - Quick commands
- [WORKFLOWS.md](.github/agents/WORKFLOWS.md) - Visual workflows

### 2. Ask Orchestrator
```bash
@orchestrator I'm having trouble with [describe issue]
```

### 3. Check Individual Agents
```bash
@testgenie What can you do?
@scriptgenerator What are your capabilities?
@buggenie How do you work?
```

### 4. Review VS Code Documentation
- [VS Code 1.107 Release Notes](https://code.visualstudio.com/updates/v1_107)
- [Using Agents](https://code.visualstudio.com/docs/copilot/agents/overview)
- [Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)

### 5. GitHub Issues
If you find bugs in the orchestration system:
- Check VS Code GitHub: https://github.com/microsoft/vscode/issues
- Check Copilot: https://github.com/microsoft/vscode-copilot-release/issues

---

## Configuration Checklist

Use this checklist to verify your setup:

- [ ] VS Code version 1.107.0 or later
- [ ] GitHub Copilot subscription active
- [ ] Agents in `.github/agents/` folder (4 files)
- [ ] Each agent has proper YAML frontmatter
- [ ] Settings in `.vscode/settings.json` configured
- [ ] `chat.customAgentInSubagent.enabled: true`
- [ ] `github.copilot.chat.cli.customAgents.enabled: true`
- [ ] `chat.viewSessions.enabled: true`
- [ ] Atlassian MCP configured (for Jira)
- [ ] Playwright MCP available (for automation)
- [ ] Git initialized in workspace
- [ ] Node.js and npm installed
- [ ] Playwright dependencies installed
- [ ] Framework files exist (config, POManager, testData)

---

## Reset and Start Fresh

If all else fails, reset your setup:

### 1. Backup Current Work
```bash
git commit -am "Backup before reset"
```

### 2. Remove Agent Configuration
```bash
# Remove settings
rm .vscode/settings.json

# Keep agents but start fresh
```

### 3. Reinstall
```bash
# Follow README.md from scratch
# Verify each step
# Test individual agents before orchestration
```

### 4. Test Basic Functionality
```bash
# Test 1: Individual agent
@testgenie What can you do?

# Test 2: Simple workflow
@testgenie Generate test cases for AOTF-1234

# Test 3: Orchestrated workflow
@orchestrator Automate AOTF-1234

# Test 4: Background agent
@orchestrator Generate automation in background for AOTF-1234
```

---

## Performance Tips

1. **Start Simple**: Test one agent at a time before orchestration
2. **Use Worktrees**: Essential for parallel execution
3. **Limit Parallel Agents**: Max 3-5 simultaneous
4. **Monitor Sessions**: Watch progress in Chat view
5. **Archive Old Sessions**: Keep sessions list clean
6. **Explicit is Better**: Use `@agentname` to be specific
7. **Provide Context**: More context = better results
8. **Review Generated Code**: Always verify before running

---

---

## Issue: Test Failures After 3 Retry Attempts

### Symptoms
- Test automation attempted 3 times but still failing
- Some test cases pass but others remain broken
- Error persists despite different fix strategies applied

### Understanding the 3-Iteration Strategy

The framework uses a progressive retry approach:
1. **Attempt 1:** Quick fixes (1-2 min) - selector adjustments, timeout increases
2. **Attempt 2:** Live re-exploration (5-10 min) - inspect actual DOM, capture real selectors
3. **Attempt 3:** Full rebuild (10-15 min) - re-execute entire flow, validate all selectors

### Decision Matrix After 3 Failed Attempts

#### Scenario A: Complete Test Failure (0% passing)
**Likely Causes:**
- Application defect or regression
- Environment/authentication issues
- Test data not available
- Feature not deployed to test environment

**Recommended Actions:**
1. **Check environment status:**
   ```bash
   # Verify application is accessible
   # Check if feature is enabled in UAT/INT
   ```

2. **If app defect suspected:**
   ```
   @buggenie Create bug report for failed test:
   [Test name]
   [Error details]
   [Expected vs actual behavior]
   ```

3. **If environment issue:**
   - Resolve blocker (credentials, data, feature flag)
   - Restart automation from Attempt 1
   ```
   @scriptgenerator Retry automation after resolving [issue]
   ```

#### Scenario B: Partial Success (70%+ passing)
**Likely Causes:**
- Edge cases or specific conditions not handled
- Intermittent timing issues on specific steps
- Complex interactions requiring special handling

**Recommended Actions:**

**Option 1: Accept Partial Automation (Recommended for 80%+ success)**
```
Decision: Accept passing tests as automated, mark failing as manual

Actions:
1. Keep passing test cases automated ✅
2. Document failing test cases as "Manual Testing Required"
3. Add comments in test file explaining limitations
4. Update test case document to show automation status
```

**Option 2: Request Additional Attempts (For 70-80% success)**
```
@scriptgenerator Continue debugging with 2 more attempts:
- Focus on failing test case: [specific test]
- Try alternative approach: [suggestion]
- Error details: [paste error]
```

**Option 3: Split Test Suite**
```
Decision: Create separate test files for passing and problematic tests

Actions:
1. Move passing tests to: tests/specs/feature/stable.spec.js
2. Move failing tests to: tests/specs/feature/unstable.spec.js
3. Mark unstable tests with .skip or tags
4. Continue refinement of unstable tests separately
```

#### Scenario C: Intermittent Failures (Works Sometimes)
**Likely Causes:**
- Race conditions or timing issues
- Dynamic content loading
- Network latency variations
- Modal/popup timing

**Recommended Actions:**

**Option 1: Add Stability Improvements**
```javascript
// Add strategic waits
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Use more robust assertions
await expect(element).toBeVisible({ timeout: 10000 });

// Add retry logic
await expect(async () => {
  await element.click();
  await expect(result).toBeVisible();
}).toPass({ timeout: 15000 });
```

**Option 2: Request Extended Debugging**
```
@scriptgenerator Need extended debugging for intermittent failure:
Test: [name]
Pattern: Fails [X]% of time
Error: [details]
Request: 2 additional attempts with enhanced stability checks
```

#### Scenario D: Systematic Blocker (Can't Proceed)
**Examples:**
- Authentication always failing
- Test environment down
- Required test data doesn't exist
- Feature not available in environment

**Immediate Actions:**
1. **Stop automation attempts**
2. **Document blocker clearly:**
   ```
   Blocker Type: [Auth/Environment/Data/Feature]
   Description: [specific issue]
   Required Resolution: [what needs to happen]
   ```

3. **Create tracking ticket:**
   ```
   @buggenie Create blocker ticket:
   Title: Cannot automate [feature] due to [blocker]
   Type: Task or Bug
   Priority: Based on urgency
   Details: [comprehensive blocker info]
   ```

4. **After resolution, restart:**
   ```
   @orchestrator Resume automation for [ticket] after blocker resolved
   ```

### Extended Attempt Guidelines

**When to Continue Beyond 3 Attempts:**
- ✅ Progress visible in each attempt (getting closer to passing)
- ✅ New information discovered that suggests solution
- ✅ Error is technical (selectors, timing) not application defect
- ✅ 70%+ of test already passing, refining edge cases
- ✅ User explicitly requests continuation

**When to STOP After 3 Attempts:**
- ❌ Same error repeating with no progress
- ❌ Application clearly not behaving as expected
- ❌ Environment or systematic issues blocking progress
- ❌ No viable selectors can be found (elements don't exist)
- ❌ Already spent 30+ minutes on same issue

**Maximum Recommended Attempts:** 5 total
- Attempts 4-5 should try completely different approaches
- After 5 attempts without success, escalate or accept manual testing

### Example Commands for Extended Attempts

```bash
# Request 2 more attempts with specific focus
@scriptgenerator Continue automation with 2 additional attempts:
Focus: Fix selector for "Submit" button in modal
Previous errors: [paste errors from attempts 1-3]
New approach: Try role-based selectors instead of test IDs

# Accept partial success and document
@orchestrator Accept current automation (4/5 tests passing):
- Mark passing tests as automated
- Document failing test as manual-only
- Add notes explaining limitation

# Create comprehensive failure report
@buggenie Generate bug report from failed automation:
Test file: tests/specs/feature/test.spec.js
Attempts: 3 failed
All error logs: [paste]
Expected: [describe]
Actual: [describe]
```

### Best Practices for Handling Persistent Failures

1. **Don't Force Automation**
   - Some scenarios genuinely need manual testing
   - Complex visual validations may not be automatable
   - 80% automation coverage is excellent

2. **Document Everything**
   - Why test failed
   - What was attempted
   - Known limitations
   - Manual testing required

3. **Communicate Clearly**
   - Tell stakeholders about automation vs manual tests
   - Set realistic expectations
   - Track automation coverage metrics

4. **Iterate Over Time**
   - Mark problematic tests as "Future Automation"
   - Revisit quarterly as application stabilizes
   - Technology improves (new selectors, better tools)

5. **Learn from Patterns**
   - If same element type always fails → update page objects
   - If specific feature problematic → request dev changes
   - If timing issues common → enhance framework utilities

---

**Still having issues?**
Ask in Chat: `@orchestrator I'm experiencing [issue], can you help diagnose?`

The orchestrator can often detect configuration problems and suggest fixes!
