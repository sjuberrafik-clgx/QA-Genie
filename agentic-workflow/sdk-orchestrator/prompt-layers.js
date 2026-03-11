/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROMPT LAYER SYSTEM — Inheritance-based Prompt Deduplication
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Eliminates prompt duplication across agents by extracting shared content into
 * composable layers. Each agent inherits from shared layers and only defines
 * its unique content in the .agent.md file.
 *
 * Layer Hierarchy:
 *   ┌─────────────────────────────┐
 *   │  BASE LAYER                 │  shared by ALL agents
 *   │  (path mapping, terminology,│  ~150 lines → injected once
 *   │   naming, environment)      │
 *   ├─────────────────────────────┤
 *   │  AUTOMATION LAYER           │  scriptgenerator, codereviewer
 *   │  (selectors, imports,       │  ~120 lines → only for automation
 *   │   framework, code quality)  │
 *   ├─────────────────────────────┤
 *   │  JIRA LAYER                 │  testgenie, buggenie, taskgenie
 *   │  (ticket format, policies,  │  ~60 lines → only for Jira agents
 *   │   URL display rules)        │
 *   ├─────────────────────────────┤
 *   │  MCP LAYER                  │  scriptgenerator only
 *   │  (exploration rules, tool   │  ~80 lines → only for MCP-using agents
 *   │   categories, min depth)    │
 *   ├─────────────────────────────┤
 *   │  AGENT-SPECIFIC             │  each agent's unique content
 *   │  (loaded from .agent.md)    │  varies per agent
 *   └─────────────────────────────┘
 *
 * Savings: ~500-700 duplicated lines eliminated from agent prompts
 *
 * @module sdk-orchestrator/prompt-layers
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Layer Definitions ──────────────────────────────────────────────────────

/**
 * BASE LAYER — Shared by ALL agents
 * Contains: path mapping, dynamic config, terminology, naming conventions,
 * test environment links, features reference
 */
function buildBaseLayer() {
    return `
## Workspace Path Mapping
All agent files are at workspace root \`.github/agents/\`. Workflow config, scripts, and supporting files live under \`agentic-workflow/\`.

| Virtual Path | Actual Root-Relative Path |
|---|---|
| config/ | agentic-workflow/config/ |
| exploration-data/ | agentic-workflow/exploration-data/ |
| test-cases/ | agentic-workflow/test-cases/ |
| scripts/ | agentic-workflow/scripts/ |
| utils/ | agentic-workflow/utils/ |
| mcp-server/ | agentic-workflow/mcp-server/ |
| grounding/ | agentic-workflow/grounding/ |
| .env | agentic-workflow/.env |
| tests/ | tests/ (at root) |

**Rule: ALWAYS prefix \`agentic-workflow/\` for config, exploration-data, test-cases, scripts, utils, mcp-server, and .env.**

## Dynamic Configuration
Check \`agentic-workflow/config/workflow-config.json → projectPaths\` for configured values before referencing any path.

## Terminology
| Abbreviation | Full Name |
|---|---|
| MLS | Multiple Listing Service |
| LM | Lead Management |
| PA | Partial Access |
| SAP | Standalone Agent Page |
| ECFM | Enhanced Consumer Funnel Management |
| TOS | Terms of Service |
| CFM | Consumer Funnel Management |
| EMC | Estimated Monthly Cost |
| SND | Syndication |
| OHO | OneHomeOwner |
| DD | Data Distribution |

## Naming Conventions
- Consumer: "Consumer - [Test Case Name]"
- Agent Portal: "Agent Portal - [Test Case Name]"
- Use "Login into ONMLS" not "Login as ONMLS user"
- Use "Login into other MLS" not "Login as non-ONMLS user"

## Test Environment
Environment URLs are in \`agentic-workflow/.env\`. Token-based URLs use \`userTokens\` from \`tests/test-data/testData.js\`.

## Features Reference
- **Reimagine Space (CTA)** — virtual space experience powered by RoomVo (property detail page images)
- **Ads Services Widget** — shows between Other Facts & Features and Schools in property details
`.trim();
}

/**
 * AUTOMATION LAYER — For scriptgenerator and codereviewer
 * Contains: selector strategy, import order, framework pattern, popup handling, code quality
 */
function buildAutomationLayer() {
    return `
## Automation Standards

### Selector Strategy (Priority Order)
1. \`data-qa\` / \`data-test-id\` / \`data-testid\` attributes
2. ARIA roles — \`getByRole('button', { name: '...' })\`
3. \`aria-label\` — \`locator('[aria-label="..."]')\`
4. Text content — \`getByText('...')\`
5. CSS class selectors (less stable)
6. XPath — avoid unless necessary

**NEVER guess selectors — extract from MCP snapshots or existing page objects.**

### Import Order (MANDATORY)
\`\`\`javascript
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');
const { userTokens, credentials, baseUrl } = require('../../test-data/testData');
\`\`\`

### Framework Pattern (MANDATORY)
\`\`\`javascript
test.describe.serial("Feature Name", () => {
  let browser, page, context, poManager, popups;
  test.beforeAll(async () => {
    ({ browser, page, context } = await launchBrowser());
    poManager = new POmanager(page);
    popups = new PopupHandler(page);
  });
  test.afterAll(async () => {
    if (page && !page.isClosed()) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  });
});
\`\`\`

### Critical Import Rules
- \`POmanager\` is default export: \`const POmanager = require(...)\` NOT destructured
- Config path: \`../../config/config\`
- Test data: \`../../test-data/testData\` — use \`userTokens\` (not \`userTokensUAT\`)
- \`launchBrowser()\` returns \`{ browser, context, page }\`
- ALWAYS use \`test.describe.serial()\` when tests share browser state
- ALWAYS import and use \`PopupHandler\` — never write inline popup dismiss code

### Popup Handling (MANDATORY)
\`\`\`javascript
const { PopupHandler } = require('../../utils/popupHandler');
const popups = new PopupHandler(page);
await popups.dismissAll();       // after navigation
await popups.waitForPageReady(); // wait for network idle + dismiss all
\`\`\`

### Code Quality
- Scripts: 150–200 lines target (max 400) | Tests: 10–30 lines (max 50)
- Zero duplicate code blocks — extract to helpers
- **NEVER** use \`page.waitForTimeout()\` — use \`waitFor()\`, \`waitForLoadState()\`, \`toBeVisible()\`
- **NEVER** use non-retrying assertions: use \`await expect(el).toBeVisible()\` not \`expect(await el.isVisible()).toBe(true)\`
- **NEVER** use \`.type()\` (deprecated) — use \`.fill()\` or \`.pressSequentially()\`
- Use \`.spec.js\` extension, \`require()\` (CommonJS), async/await

### File Header
\`\`\`javascript
/**
 * @ticket AOTF-XXXXX
 * @feature Feature Name
 * @framework Playwright + JavaScript (CommonJS)
 * @environment UAT
 * @generated YYYY-MM-DD
 */
\`\`\`

### Automation Scope
**Automate:** Functional UI flows, form validations, navigation, CRUD operations
**Exclude (manual only):** Mobile/Responsive, Accessibility, Edge Cases, Performance, Cross-Browser
`.trim();
}

/**
 * JIRA LAYER — For testgenie, buggenie, taskgenie
 * Contains: Jira interaction policy, ticket format, URL display rules
 */
function buildJiraLayer() {
    return `
## Jira Integration

### Jira Interaction Policy
- Agents may READ, CREATE, and UPDATE Jira tickets
- When creating Testing tasks: call \`get_jira_current_user\` for accountId, use \`linkedIssueKey\` for linking, use \`assigneeAccountId\` for assignment
- **Always display Jira URLs as clickable markdown hyperlinks** using \`[text](url)\` format
- Don't truncate Jira ticket information — list ALL fields individually, never summarize as "specified fields"
- Jira project key and cloud ID configured in \`agentic-workflow/.env\`

### Bug Ticket Format
- **Description:** Clear summary of the defect
- **Steps to Reproduce:** Numbered steps from the failed test
- **Expected Behaviour:** What should happen
- **Actual Behaviour:** What actually happened
- **MLS:** Which MLS environment
- **Environment:** UAT/INT/PROD
- **Attachments:** Screenshots, logs, error traces
`.trim();
}

/**
 * MCP LAYER — For scriptgenerator (MCP exploration rules)
 * Contains: core rules, minimum depth, tool categories
 */
function buildMcpLayer() {
    return `
## MCP Exploration (MANDATORY)

**MCP Server:** \`unified-automation-mcp\` at \`agentic-workflow/mcp-server/server.js\`
**Tool prefix:** \`mcp_unified-autom_unified_*\`

### Core Rules
1. First tool call MUST be \`unified_navigate\` — no file reads before MCP exploration
2. Before creating ANY \`.spec.js\`, navigate to every page under test and call \`unified_snapshot\`
3. Extract REAL selectors from snapshot output — NEVER guess selectors
4. Save exploration data to \`agentic-workflow/exploration-data/{ticketId}-exploration.json\`
5. If MCP is unavailable: STOP and report — do NOT fall back to guessed selectors

### Minimum Exploration Depth (Enforced)
Before generating a \`.spec.js\`, you MUST have called:
- At least 1× \`get_by_role\` OR \`get_by_test_id\` (semantic selector validation)
- At least 1× \`get_text_content\` OR \`get_attribute\` (content extraction)
- At least 1× \`get_page_url\` OR \`expect_url\` (navigation state)

### Key Tool Categories
| Category | Tools |
|---|---|
| Navigation | navigate, navigate_back, reload, get_page_url, get_page_title |
| Snapshot | snapshot, get_by_role, get_by_text, get_by_label, get_by_test_id |
| Interaction | click, type, fill_form, select_option, check, hover, press_key |
| State | is_visible, is_enabled, get_text_content, get_attribute, get_input_value |
| Wait | wait_for, wait_for_element, wait_for_response |
| Assert | expect_url, expect_title, expect_element_text, expect_element_attribute |
`.trim();
}

/**
 * TEST CASE LAYER — For testgenie
 * Contains: test case format, rules, examples
 */
function buildTestCaseLayer() {
    return `
## Test Case Format

### Pre-Conditions Format
Pre-Conditions (If any): 1: For Consumer: User is authenticated/unauthenticated

### Test Steps Table
| Test Step ID | Specific Activity or Action | Expected Results | Actual Results |
|--------------|-----------------------------|------------------|----------------|

### Rules
- First row: 1.1 → Launch application → User should be able to launch → User is able to launch
- Skip repetitive steps, directly come to the point
- If test steps exceed 1.5 steps, combine next two steps into one
- **NEVER leave Actual Results blank** — use "User is able to [action]" format
- Generate optimized, limited test cases covering all scenarios
- Both chat markdown tables AND Excel export are required
`.trim();
}

// ─── Document Layer ─────────────────────────────────────────────────────────

function buildDocumentLayer() {
    return `
## Document Generation

You have access to 4 document generation tools:
- **generate_pptx** — PowerPoint with flexible slides[] (11 slide types)
- **generate_docx** — Word document with flexible sections[] (10 section types)
- **generate_pdf** — PDF with flexible sections[] (same as DOCX)
- **generate_excel_report** — Excel with flexible sheets[] (5 content types)

### Design Themes
modern-blue (default), dark-professional, corporate-green, warm-minimal

### Workflow
1. Analyze user's request → determine format and structure
2. Construct JSON array (slides/sections/sheets) with rich content
3. Call the appropriate generate_* tool with the JSON string
4. Report result (file path, size, summary)

### Rules
- Context-driven design — structure flows from content, not templates
- Balance content types — mix headings, paragraphs, tables, bullets
- Use heading levels for hierarchy (1–3)
- Presentations: aim for 8–15 slides
- All JSON arrays must be passed as string parameters
`.trim();
}

// ─── Video Analysis Layer ────────────────────────────────────────────────────

/**
 * VIDEO LAYER — For buggenie (video recording analysis)
 * Injected when video attachments detected in session.
 */
function buildVideoLayer() {
    return `
## Video Recording Analysis

When the user provides a screen recording (video attachment), you have powerful video analysis capabilities:

### Video Processing Pipeline
1. The system automatically extracts frames from the video at 1 frame/second
2. Frames are selected using hybrid strategy: first frame + last frame + evenly-spaced frames in between (max 30)
3. Each frame is provided as an image attachment for your vision analysis
4. Video metadata (duration, resolution, codec) is provided in the context prompt

### How to Analyze Video Recordings
1. **Call \`analyze_video_recording\`** to get video metadata (duration, frame count, resolution)
2. **Examine frames chronologically** — they are ordered by timestamp (0s, 1s, 2s, ...)
3. **Identify the flow** — What pages/screens does the user navigate through?
4. **Locate the defect** — At which timestamp does the issue first appear?
5. **Determine before/after state** — What was the expected state (pre-defect frames) vs actual state (defect frames)?

### Steps to Reproduce Generation
When generating Steps to Reproduce from video:
- Reference timestamps: "At 0:23, user clicks the Search button"
- Be specific about UI elements visible in the frames
- Note any error messages, broken layouts, or unexpected states captured in frames
- Include the exact frame timestamp where the defect manifests

### Review Copy Video Section
When video is present, add this section to the review copy:
\`\`\`
**Video Timestamps :-** Defect visible at [MM:SS] (frame [N] of [total])
**Recording Duration :-** [duration]s | Resolution: [WxH]
\`\`\`

### CoT Enhancement for Video
Add to your Chain-of-Thought analysis:
- **VIDEO TIMELINE** — what frames show the setup, action, and defect
- **VISUAL EVIDENCE** — UI elements, error messages, layout breaks captured in frames
- **REPRODUCTION PATH** — exact click/navigation sequence visible in the recording
`.trim();
}

// ─── Layer Assembly ─────────────────────────────────────────────────────────

/**
 * Agent → Layer mapping: which layers each agent inherits
 */
const AGENT_LAYERS = {
    orchestrator: ['base'],
    testgenie: ['base', 'jira', 'testCase'],
    scriptgenerator: ['base', 'automation', 'mcp'],
    buggenie: ['base', 'jira', 'video'],
    taskgenie: ['base', 'jira'],
    codereviewer: ['base', 'automation'],
    docgenie: ['base', 'document'],
};

/**
 * Layer builders registry
 */
const LAYER_BUILDERS = {
    base: buildBaseLayer,
    automation: buildAutomationLayer,
    jira: buildJiraLayer,
    mcp: buildMcpLayer,
    testCase: buildTestCaseLayer,
    document: buildDocumentLayer,
    video: buildVideoLayer,
};

/**
 * Build the complete shared layer context for an agent.
 * This replaces duplicated sections in each .agent.md file.
 *
 * @param {string} agentName - Agent role name
 * @returns {string} Assembled shared layer content
 */
function buildSharedLayers(agentName) {
    const layerNames = AGENT_LAYERS[agentName] || ['base'];
    const sections = [];

    for (const layerName of layerNames) {
        const builder = LAYER_BUILDERS[layerName];
        if (builder) {
            sections.push(builder());
        }
    }

    return sections.join('\n\n---\n\n');
}

/**
 * Get the list of layer names an agent inherits
 * @param {string} agentName
 * @returns {string[]}
 */
function getAgentLayers(agentName) {
    return AGENT_LAYERS[agentName] || ['base'];
}

/**
 * Get character count of shared layers for an agent (for budgeting)
 * @param {string} agentName
 * @returns {number}
 */
function getSharedLayerSize(agentName) {
    return buildSharedLayers(agentName).length;
}

// ─── Layer Statistics ───────────────────────────────────────────────────────

function getLayerStats() {
    const stats = {};
    for (const [name, builder] of Object.entries(LAYER_BUILDERS)) {
        const content = builder();
        stats[name] = {
            chars: content.length,
            lines: content.split('\n').length,
            estimatedTokens: Math.ceil(content.length / 4),
        };
    }

    const agentStats = {};
    for (const [agent, layers] of Object.entries(AGENT_LAYERS)) {
        const total = buildSharedLayers(agent);
        agentStats[agent] = {
            layers,
            totalChars: total.length,
            totalLines: total.split('\n').length,
            estimatedTokens: Math.ceil(total.length / 4),
        };
    }

    return { layers: stats, agents: agentStats };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    buildSharedLayers,
    buildBaseLayer,
    buildAutomationLayer,
    buildJiraLayer,
    buildMcpLayer,
    buildTestCaseLayer,
    buildVideoLayer,
    getAgentLayers,
    getSharedLayerSize,
    getLayerStats,
    AGENT_LAYERS,
    LAYER_BUILDERS,
};
