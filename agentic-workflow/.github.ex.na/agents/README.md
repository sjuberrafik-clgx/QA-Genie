# Multi-Agent Orchestration Setup

This workspace is configured for **VS Code 1.107+ Multi-Agent Orchestration**, enabling your TestGenie, ScriptGenerator, and BugGenie agents to work together in automated workflows with minimal manual intervention.

## 🎯 What's New

With VS Code 1.107, you can now:
- ✅ Run custom agents as **subagents** (automatic delegation)
- ✅ Use **background agents** for long-running tasks
- ✅ Execute agents in **isolated Git worktrees** (no conflicts)
- ✅ **Hand off context** seamlessly between agents
- ✅ **Monitor all agents** from unified Agent HQ interface
- ✅ Run **multiple agents in parallel** without blocking your work

## 📁 Project Structure

```
.github/agents/                      # VS Code 1.107 multi-agent system
│
├── README.md                        # This file - system overview
│
├── agents/                          # Agent definition files
│   ├── orchestrator.agent.md        # Master coordinator agent
│   ├── testgenie.agent.md           # Test case generation from Jira
│   ├── scriptgenerator.agent.md     # Playwright automation creation
│   └── buggenie.agent.md            # Bug ticket creation (2-step workflow)
│
├── lib/                             # Core JavaScript modules
│   ├── index.js                     # Clean exports entry point
│   ├── workflow-coordinator.js      # Main orchestration engine (v2.4.0)
│   ├── error-analyzer.js            # AI-powered error analysis
│   ├── custom-templates.js          # Custom workflow templates
│   └── system-analysis.js           # Architecture documentation
│
├── docs/                            # Documentation & guides
│   ├── WORKFLOWS.md                 # Workflow definitions & usage
│   ├── WORKFLOW_TEMPLATES.md        # Custom template guide
│   ├── WORKFLOW_SYSTEM_QUICKSTART.md # Quick start guide
│   ├── QUICKREF.md                  # Quick reference card
│   ├── AGENT_PROTOCOL.md            # Agent communication protocol
│   ├── AGENT_SKILLS_GUIDE.md        # Skills system guide
│   ├── AGENT_SKILLS_QUICKREF.md     # Skills quick reference
│   ├── TROUBLESHOOTING.md           # Common issues & solutions
│   ├── LINEAR_WORKFLOW_GUIDE.md     # Linear workflow patterns
│   ├── SETUP_COMPLETE.md            # Setup verification
│   ├── IMPLEMENTATION_SUMMARY.md    # Implementation details
│   └── SCRIPTGENERATOR_V2_ENHANCEMENTS.md # ScriptGenerator updates
│
└── state/                           # Runtime state (gitignored)
    ├── workflow-state.json          # Active workflow states
    ├── workflow-metrics.json        # Performance metrics
    └── custom-templates.json        # User-defined templates
```

## ⚙️ Configuration

The `.vscode/settings.json` file has been configured with:

```json
{
  "chat.customAgentInSubagent.enabled": true,
  "github.copilot.chat.cli.customAgents.enabled": true,
  "chat.viewSessions.enabled": true,
  "chat.viewSessions.orientation": "auto"
}
```

These enable:
- Custom agents as subagents (automatic routing)
- Background agent support
- Integrated session management in Chat view

## 🚀 Quick Start

### 1. Verify Setup

1. Open VS Code 1.107 or later
2. Open the Chat panel (Ctrl+Shift+I or Cmd+Shift+I)
3. Ask: **"What subagents can you use?"**
4. You should see: TestGenie, ScriptGenerator, BugGenie, Orchestrator

### 2. Test Individual Agents

**TestGenie:**

@testgenie Generate test cases for Jira ticket AOTF-1234

*✅ Test cases will appear as formatted tables directly in the chat window*

**ScriptGenerator:**

@scriptgenerator Convert these steps to Playwright automation:
1. Login to OneHome
2. Search for properties in San Francisco
3. Verify results are displayed

**BugGenie:**

@buggenie Create bug ticket for image loading issue in UAT Canopy MLS

### 3. Use Orchestrated Workflows

**Complete Automation Pipeline:**

@orchestrator Automate testing for AOTF-1234 - generate test cases and create Playwright test

**Parallel Execution:**

@orchestrator Generate test cases for AOTF-1234, AOTF-1235, and AOTF-1236 in parallel

## 🔄 Automated Workflows

### Workflow 1: Jira → Test Cases → Automation

You: "Automate testing for AOTF-1234"

Orchestrator:
├─ Step 1: TestGenie generates manual test cases from Jira
├─ Step 2: ScriptGenerator converts to Playwright automation
├─ Step 3: Executes test and reports results
└─ If failures: BugGenie creates defect tickets

**Example Prompt:**

@orchestrator Create full automation for Jira ticket AOTF-5678 in UAT Canopy environment

### Workflow 2: Manual Steps → Automation

You: "Convert manual steps to Playwright"

Orchestrator:
└─ ScriptGenerator creates production-ready test

**Example Prompt:**

@scriptgenerator Automate the test cases in tests/manual/feature-x.md

### Workflow 3: Bug Discovery → Jira Ticket

You: "Create bug ticket for [issue description]"

Orchestrator:
├─ Step 1: BugGenie generates review copy
├─ [You review and confirm]
└─ Step 2: BugGenie creates Jira ticket

**Example Prompt:**

@buggenie Bug found in PROD - Property images not loading on RLS MLS

### Workflow 4: Background Batch Processing

```
You: "Generate automation for all tickets in sprint 23"

Orchestrator:
├─ Fetches all tickets from sprint
├─ Creates background agent for each ticket
│   └─ Each runs: TestGenie → ScriptGenerator
├─ Agents run in isolated Git worktrees (no conflicts)
└─ Aggregates results when complete
```

**Example Prompt:**
```
@orchestrator Generate test automation for all tickets in sprint 23, run in background
```

## 🎛️ Agent Capabilities

### TestGenie
- ✅ Fetches Jira ticket details via Atlassian MCP
- ✅ Generates optimized manual test cases
- ✅ **Displays test cases as formatted tables directly in chat (no files created)**
- ✅ Covers all acceptance criteria
- ✅ Includes MLS/OneHome contexts
- ✅ Optional: Generates Playwright automation when requested
- 🔗 **Handoff to:** ScriptGenerator (for automation)

### ScriptGenerator
- ✅ Explores existing test framework structure
- ✅ Reuses page objects, helpers, and config
- ✅ Executes steps in real-time with Playwright MCP
- ✅ Captures and validates stable selectors
- ✅ Enriches page objects with new selectors
- ✅ Generates production-ready, passing tests
- 🔗 **Handoff to:** BugGenie (on test failures)

### BugGenie
- ✅ Two-step workflow: Review → Create (prevents mistakes)
- ✅ Supports UAT and PROD environment selection
- ✅ Integrates MLS context
- ✅ Creates linked Testing tasks
- ✅ Preserves formatting in Jira (ADF/Markdown)
- 🔗 **Handoff to:** TestGenie (for Testing task test cases)

### Orchestrator
- ✅ Coordinates multi-agent workflows
- ✅ Automatically routes requests to correct agents
- ✅ Maintains context across handoffs
- ✅ Supports parallel and sequential execution
- ✅ Manages background agents and worktrees
- 🔗 **Controls:** All agents

## 📊 Monitoring Agents

### View Active Sessions

1. Open Chat panel
2. Sessions list shows all active/archived agents
3. View status, progress, and file changes
4. Click session to see conversation history

### Background Agents

Background agents appear in the sessions list with:
- ⚙️ Status indicator (running/completed)
- 📊 Progress percentage
- 📝 File change statistics
- ⏱️ Runtime duration

### Continue Tasks to Background

If a local chat task is taking too long:
1. Click **"Continue in"** button
2. Select **Background Agent**
3. Task moves to background, you can continue other work

## 🛠️ Advanced Features

### Git Worktree Isolation

When creating background agents:
1. VS Code creates separate Git worktree
2. Agent makes changes in isolated folder
3. No conflicts with your active work
4. Review changes and merge back when ready

**Create background agent with worktree:**
```
@orchestrator Generate automation for AOTF-1234, run in background with Git worktree
```

### Context Attachment

Attach rich context to agent requests:
- 📎 File selections
- 🐛 Problems/errors
- 🔍 Search results
- 🔀 Git commits
- 📋 Symbols

**Example:**
1. Select code in editor
2. Right-click → "Add to Chat"
3. Agent receives full context

### Custom Agent Keyboard Shortcuts

You can bind keyboard shortcuts to individual agents:

1. Open Command Palette (Ctrl+Shift+P)
2. Search for "Chat: Open Chat (TestGenie Agent)"
3. Right-click → "Configure Keyboard Shortcut"
4. Assign your preferred shortcut

## 🔧 Troubleshooting

### Agents Not Appearing

**Problem:** Custom agents not visible in Chat

**Solutions:**
1. Verify agents are in `.github/agents/` folder
2. Check agent files have proper YAML frontmatter
3. Ensure `infer: true` in agent metadata
4. Restart VS Code
5. Check settings are enabled in `.vscode/settings.json`

### Agent Not Being Invoked

**Problem:** Agent doesn't respond or wrong agent responds

**Solutions:**
1. Use `@agentname` to explicitly invoke agent
2. Check agent `description` field is clear and specific
3. Verify agent `tools` array includes necessary tools
4. Review agent's capability keywords

### Context Not Preserved

**Problem:** Agent loses context when handing off

**Solutions:**
1. Use Orchestrator for multi-step workflows
2. Explicitly mention critical details (Jira URLs, environment)
3. Attach files/selections as context before starting
4. Use "Continue in" feature to preserve context

### Background Agent Conflicts

**Problem:** Multiple agents modifying same files

**Solutions:**
1. Use Git worktrees (checkbox when creating background agent)
2. Ensure agents output to different file paths
3. Review changes before merging worktrees

## 📚 Examples & Use Cases

### Example 1: Sprint Automation

**Goal:** Automate all testing for sprint 23

```
@orchestrator I need to automate testing for all tickets in sprint 23. 
Please generate test cases and Playwright automation for each ticket. 
Run in background with Git worktrees.
```

**What happens:**
1. Orchestrator fetches all tickets in sprint 23
2. Creates separate background agent for each ticket
3. Each agent runs: TestGenie → ScriptGenerator pipeline
4. Agents run in isolated worktrees (no conflicts)
5. You receive summary when all complete

### Example 2: Bug Triage Workflow

**Goal:** Test failed, need to log defect

```
Test execution results:
- Test: Property Search Filters
- Status: FAILED
- Error: Expected 10 results, got 0
- Environment: UAT Canopy

@buggenie Create bug ticket for this failure
```

**What happens:**
1. BugGenie generates formatted review copy
2. You review and confirm
3. BugGenie creates Jira ticket with proper formatting
4. Option to create linked Testing task

### Example 3: Rapid Test Conversion

**Goal:** Convert manual test document to automation

```
@scriptgenerator Convert all test cases in tests/manual/property-search.md 
to Playwright automation. Use existing page objects and framework.
```

**What happens:**
1. ScriptGenerator reads manual test document
2. Explores existing framework components
3. Generates Playwright specs for each test case
4. Enriches page objects with new selectors
5. Saves tests to appropriate location
6. Runs tests to validate

## 🎓 Best Practices

1. **Start with Individual Agents:** Get familiar with each agent's capabilities
2. **Use Orchestrator for Workflows:** Let orchestrator handle multi-step processes
3. **Review Before Proceeding:** Always review generated content before next step
4. **Use Background for Long Tasks:** Don't block your work on long-running operations
5. **Leverage Git Worktrees:** Essential for parallel agent execution
6. **Monitor Sessions:** Keep eye on agent progress in Chat view
7. **Archive Completed Sessions:** Keep sessions list manageable
8. **Explicit Agent Invocation:** Use `@agentname` when you want specific agent

## 🔗 Additional Resources

- [VS Code 1.107 Release Notes](https://code.visualstudio.com/updates/v1_107)
- [Using Agents in VS Code](https://code.visualstudio.com/docs/copilot/agents/overview)
- [Background Agents Guide](https://code.visualstudio.com/docs/copilot/agents/background-agents)
- [Custom Agents Documentation](https://code.visualstudio.com/docs/copilot/customization/custom-agents)

## 📞 Support

For issues or questions:
1. Check this README
2. Review agent-specific `.agent.md` files in `.github/agents/`
3. Check VS Code Output panel (Copilot Chat logs)
4. Review existing `.github/chatmodes/README.md` for workflow diagrams

---

**Ready to automate your QA workflows?** Try the Quick Start examples above! 🚀
