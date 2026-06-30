---
applyTo: '**'
---
# Global Copilot Instructions — QA Automation Workflow

## ⚠️ WORKSPACE ROOT PATH MAPPING

**All agent files are at the workspace root `.github/agents/`. However, workflow config, scripts, and supporting files live under `agentic-workflow/`.** Always resolve paths as follows:

| Virtual Path | Actual Root-Relative Path |
|---|---|
| `config/workflow-config.json` | `agentic-workflow/config/workflow-config.json` |
| `config/assertion-config.json` | `agentic-workflow/config/assertion-config.json` |
| `exploration-data/` | `agentic-workflow/exploration-data/` |
| `test-cases/` | `agentic-workflow/test-cases/` |
| `scripts/` | `agentic-workflow/scripts/` |
| `docs/` | `agentic-workflow/docs/` |
| `utils/assertionConfigHelper.js` | `agentic-workflow/utils/assertionConfigHelper.js` |
| `mcp-server/` | `agentic-workflow/mcp-server/` |
| `grounding/` | `agentic-workflow/grounding/` |
| `grounding-data/` | `agentic-workflow/grounding-data/` |
| `config/grounding-config.json` | `agentic-workflow/config/grounding-config.json` |
| `.env` | `agentic-workflow/.env` |
| `.github/agents/lib/` | `.github/agents/lib/` (already at root) |
| `tests/` | `tests/` (already at root) |

**Rule: ALWAYS prefix `agentic-workflow/` for config (workflow-config, assertion-config), exploration-data, test-cases, scripts, docs, utils, mcp-server, and .env.**

## Dynamic Configuration

This workflow uses dynamic path resolution. All paths below are **defaults** — actual paths come from:
1. `agentic-workflow/.env` file (environment-specific values)
2. `agentic-workflow/config/workflow-config.json` → `projectPaths` section
3. Auto-detection (scans for framework files)

**Before referencing any path**, check `agentic-workflow/config/workflow-config.json.projectPaths` for the configured values.
If `frameworkMode` is `"basic"`, the POmanager/launchBrowser/testData patterns are NOT required.

## Agent Ecosystem

This workspace uses a 6-agent orchestrated workflow for end-to-end QA automation:

| Agent | Role |
|---|---|
| `@orchestrator` | Master pipeline coordinator — chains TestGenie → ScriptGenerator → Execute → BugGenie |
| `@testgenie` | Generates test cases from Jira tickets → Excel + chat markdown |
| `@scriptgenerator` | Generates Playwright `.spec.js` scripts using MCP exploration |
| `@buggenie` | Creates Jira defect tickets from test failures |
| `@taskgenie` | Creates linked Testing tasks in Jira with auto-assignment and optional embedded test cases |
| `@codereviewer` | Reviews generated scripts for quality, patterns, and best practices |

**Pipeline stages (sequential, each validated before proceeding):**
`JIRA_FETCH → EXCEL_CREATE → MCP_EXPLORE → SCRIPT_GENERATE → SCRIPT_EXECUTE`

**Key config files:**
* `agentic-workflow/config/workflow-config.json` — Pipeline configuration (browser, MCP strategy, quality gates, **project paths**)
* `agentic-workflow/config/assertion-config.json` — Assertion patterns and rules for generated scripts
* `agentic-workflow/config/grounding-config.json` — Local context grounding (feature map, domain terminology, index settings, **knowledge base**)
* `agentic-workflow/.env` — Environment-specific values (Jira credentials, URLs, MCP settings, **KB credentials**)

## Grounding System (Local Context for LLM Accuracy)

The grounding system provides local project context to LLM agents, reducing hallucinations by giving agents accurate knowledge about the codebase, selectors, domain terminology, and existing test coverage.

**Key components:**
* `agentic-workflow/config/grounding-config.json` — Per-project config (feature map, domain terms, rules, index settings). **This is the primary file users customize for their application.**
* `agentic-workflow/grounding/text-indexer.js` — TF-IDF/BM25 full-text search engine with class-aware chunking
* `agentic-workflow/grounding/selector-registry.js` — Centralized selector knowledge base (page objects + MCP snapshots)
* `agentic-workflow/grounding/grounding-store.js` — Main orchestrator tying index + selectors + config + **knowledge base** together
* `agentic-workflow/grounding-data/` — Persisted index files (auto-generated, gitignored)

**SDK tools for agents (available when grounding is enabled):**
* `search_project_context` — BM25 search across page objects, business functions, utilities
* `get_feature_map` — Feature-specific context (pages, page objects, business functions, keywords)
* `get_selector_recommendations` — Ranked selectors by reliability for a page/element
* `check_existing_coverage` — Find existing spec files to avoid duplicate automation
* `search_knowledge_base` — Search external KB (Confluence, Notion, SharePoint) for documentation
* `get_knowledge_base_page` — Fetch full content of a specific KB page by ID

**CLI management:**
```bash
node agentic-workflow/scripts/grounding-setup.js init      # Create config + build index
node agentic-workflow/scripts/grounding-setup.js rebuild   # Force re-index
node agentic-workflow/scripts/grounding-setup.js stats     # Show index statistics
node agentic-workflow/scripts/grounding-setup.js validate  # Validate config
node agentic-workflow/scripts/grounding-setup.js query "search filter locators"  # Test query
```

## Knowledge Base Connector (External Documentation)

The KB Connector integrates external documentation sources into the grounding pipeline, giving agents real-time access to Confluence, Notion, SharePoint, or custom REST APIs.

**Key components:**
* `agentic-workflow/knowledge-base/kb-connector.js` — Main orchestrator (hybrid fetch: cache → live → cache result)
* `agentic-workflow/knowledge-base/confluence-provider.js` — Confluence REST API v1 implementation
* `agentic-workflow/knowledge-base/kb-cache.js` — Local BM25-indexed cache with TTL/LRU eviction
* `agentic-workflow/knowledge-base/intent-detector.js` — Deterministic query intent analysis (zero LLM calls)
* `agentic-workflow/knowledge-base/kb-provider.js` — Abstract base class for all providers
* `agentic-workflow/config/grounding-config.json` → `knowledgeBase` section — Provider, cache, and intent config

**How it works:**
1. **Intent Detection** — Analyzes queries for domain terms and trigger words (configurable threshold)
2. **Cache Check** — BM25 search over locally cached pages (sub-millisecond)
3. **Live Fallback** — If cache misses or is stale, queries the live API
4. **Context Injection** — KB content injected as Section 7 in `buildGroundingContext()` (4K char budget)

**Environment variables (in `agentic-workflow/.env`):**
* `KB_ENABLED=true` — Master toggle
* `CONFLUENCE_BASE_URL=https://your-org.atlassian.net/wiki` — Confluence instance URL
* `CONFLUENCE_SPACE_KEYS=PROJ,DOCS` — Optional: restrict to specific spaces
* Reuses `JIRA_EMAIL` + `JIRA_API_TOKEN` for Confluence authentication

**CLI management:**
```bash
node agentic-workflow/scripts/kb-setup.js init       # Initialize + test connections
node agentic-workflow/scripts/kb-setup.js sync       # Pre-sync pages into cache
node agentic-workflow/scripts/kb-setup.js query "search filters"  # Test a query
node agentic-workflow/scripts/kb-setup.js stats      # Show cache/provider statistics
node agentic-workflow/scripts/kb-setup.js validate   # Validate config + credentials
node agentic-workflow/scripts/kb-setup.js spaces     # List spaces from all providers
node agentic-workflow/scripts/kb-setup.js clear      # Clear local cache
```

**For full details, see:** `agentic-workflow/docs/KNOWLEDGE_BASE_SYSTEM.md`

**Jira project:** Configured in `agentic-workflow/.env` as `JIRA_PROJECT_KEY` | **Cloud ID:** Configured in `agentic-workflow/.env` as `JIRA_CLOUD_ID`

## OODA Loop (Observe–Orient–Decide–Act)

The OODA module provides deterministic feedback loops at two critical pipeline bottlenecks — **zero LLM calls, zero token cost**.

**Key components:**
* `agentic-workflow/sdk-orchestrator/ooda-loop.js` — Core module with `EnvironmentHealthCheck` and `ExplorationQualityAnalyzer`
* `agentic-workflow/config/workflow-config.json` → `ooda` section — Tunable thresholds

### EnvironmentHealthCheck (Pre-Pipeline)
Runs before the stage loop in `pipeline-runner.js`. Validates:
- **UAT reachability** — HTTP HEAD to `UAT_URL` (weight: 30)
- **MCP server config** — server.js exists, env vars set (weight: 25)
- **Jira API** — REST call to `/rest/api/3/myself` (weight: 20)
- **Framework files** — testData.js, POmanager.js, config.js, popupHandler.js (weight: 15)
- **Auth tokens** — token exports present in testData.js (weight: 10)

Decisions: `ABORT` (score < 40) | `WARN` (score < 70) | `PROCEED` (score >= 70). ABORT prevents wasted 12+ minute pipeline runs.

### ExplorationQualityAnalyzer (Post-Snapshot)
Runs inside `enforcement-hooks.js` after each MCP `unified_snapshot`. Assesses:
- Element count and ARIA role diversity
- Loading/spinner indicator detection
- Popup/modal dominance detection
- Dynamic ID presence
- Feature map comparison (expected vs actual complexity from grounding config)

Decisions: `ACCEPT` (score >= 60) | `WARN` (score 30–59) | `RETRY_RECOMMENDED` (score < 30). Agents receive actionable remediation steps in their context.

### Configuration (`workflow-config.json → ooda`)
```json
{
    "ooda": {
        "environmentHealth": { "enabled": true, "abortThreshold": 40, "warnThreshold": 70, "timeoutMs": 10000 },
        "explorationQuality": { "enabled": true, "minElements": 5, "minRoleDiversity": 3, "retryThreshold": 30, "warnThreshold": 60 }
    }
}
```

### Testing
```bash
node agentic-workflow/sdk-orchestrator/test-ooda-loop.js   # Run 63 unit tests
```

## Test Case Generation Format

* You must generate test cases strictly following the below format and structure.
* Do not change the column names, do not add extra fields, and keep the layout exactly the same.
* While generating test cases firstly, add 1 row in Test Steps format, write there like 1.1 and then Launch OneHome application then User should be able to launch OneHome application then User is able to launch OneHome application.
* Write test cases by covering all possible steps and scenarios.
* While generating specific activity & action, make sure skip small small & repetitive steps, directly come to the point.
* Remember, if test steps in specific activity & action column crossed 1.5 steps then going forward combine next two steps into one step.
* Both chat markdown tables AND Excel export are required (use `agentic-workflow/scripts/excel-template-generator.js`).

### Pre-Conditions Format
Pre-Conditions (If any): 1: For Consumer: User is authenticated/unauthenticated

### Test Steps Format

| Test Step ID | Specific Activity or Action | Expected Results | Actual Results |
|--------------|-----------------------------|------------------|----------------|

Example Rows:
| 1.1 | Apply search filters for City, Price, Beds, and Baths. | User should be able to apply search filters for city, price, beds, and baths. | User is able to apply search filters for city, price, beds, and baths. |
| 1.2 | Open a property detail page. | User should be able to open a property detail page. | User is able to open a property detail page. |
| 1.3 | Go back to the property listings page. | User should be able to go back to the property listings page. | User is able to go back to the property listings page. |
| 1.4 | Verify No errors should occur when returning from the property detail page to the listings page. | User should be able to verify no errors should occur when returning from the property detail page to the listings page. | User is able to verify no errors should occur when returning from the property detail page to the listings page. |

### Important Rules
* Do not skip any field, even if it's blank.
* Do not modify headings.
* Pre-Conditions must be added separately, not inside test steps.
* Maintain the order as shown.
* Generate test cases in tabular format.
* Test Cases should cover all possible scenarios & make sure generate optimised test cases — generate limited test cases only.
* While generating specific activity & action, make sure skip small small & repetitive steps, directly come to the point.
* Remember, if test steps in specific activity & action column crossed 1.5 steps then going forward combine next two steps into one step.
* If you feel test steps are more, then add them in the same row with a comma.
* Generate optimized test cases that are efficient and effective.
* **🚨 NEVER leave the Actual Results column blank. EVERY test step MUST have Actual Results populated.** Use the format "User is able to [action]" always.
* When user uses Atlassian MCP tools to fetch Jira ticket information then walkthrough complete Jira ticket information from URL given by user.
* Don't truncate information received from Jira ticket — mention it in test case completely. For example, if acceptance criteria lists specific fields, list ALL fields individually in test steps rather than summarizing as "specified fields".
* **🔗 Always display Jira ticket URLs as clickable markdown hyperlinks** using `[display text](url)` format so users can see them as links and click/copy.

## Automation Script Generation

* Generate automation scripts in **JavaScript** using **Playwright** test framework.
* Use `.spec.js` extension — NEVER `.spec.ts`.
* Use `require()` — NEVER ES6 `import`.
* Use async/await for asynchronous operations.
* Maintain code quality and readability.
* Use proper naming conventions for variables and functions.
* If required, use comments to explain complex logic.
* If required, create reusable functions for repetitive tasks.
* While generating automation script, walkthrough complete codebase and import packages and classes from other files and folders if required — e.g., if automation script needs login functionality then use already implemented login functions from business-functions/.
* Generated scripts go to `tests/specs/{feature-folder}/{ticketId}.spec.js`.
* ⛔ **NEVER** write scripts under `web-app/` — that is a separate Next.js project, not the QA automation framework.

### Import Order (MANDATORY)
All `.spec.js` files must follow this import order:
```javascript
// 1. Playwright
const { test, expect } = require('@playwright/test');
// 2. Config
const { launchBrowser } = require('../../config/config');
// 3. Page Object Manager
const POmanager = require('../../pageobjects/POmanager');
// 4. Popup Handler (centralized popup dismiss logic)
const { PopupHandler } = require('../../utils/popupHandler');
// 5. Test data
const { userTokens, credentials, baseUrl } = require('../../test-data/testData');
```

### Framework Pattern (MANDATORY)
```javascript
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');
const { userTokens } = require('../../test-data/testData');

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

  test("test name", async () => {
    // test implementation
  });
});
```

**CRITICAL import rules:**
* `POmanager` is a **default export** — use `const POmanager = require(...)` NOT `const { POmanager } = require(...)`
* Config path is `../../config/config` — NOT `../../../config`
* Test data export is `userTokens` (environment-aware) — NOT `userTokensUAT`
* Test data path is `../../test-data/testData` — NOT `../testData`
* `launchBrowser()` returns `{ browser, context, page }` — always destructure all three
* `afterAll` must close page, context, AND browser with null/closed guards
* **ALWAYS** use `test.describe.serial()` when tests share browser state (single `beforeAll`)
* **ALWAYS** import and use `PopupHandler` from `../../utils/popupHandler` — never write inline popup dismiss code

### File Header Template
Every generated `.spec.js` should start with a comment header:
```javascript
/**
 * @ticket AOTF-XXXXX
 * @feature Feature Name
 * @framework Playwright + JavaScript (CommonJS)
 * @environment UAT
 * @generated YYYY-MM-DD
 */
```

### Selector Strategy (Priority Order)
When selecting elements, prefer selectors in this order:
1. `data-qa` / `data-test-id` / `data-testid` attributes (most stable)
2. ARIA roles — `getByRole('button', { name: '...' })`
3. `aria-label` — `locator('[aria-label="..."]')`
4. Text content — `getByText('...')`
5. CSS class selectors — `.class-name` (less stable)
6. XPath — **avoid unless absolutely necessary**

**NEVER guess selectors. Always extract from MCP accessibility snapshots or existing page objects.**

### Automation Scope
**Automate:** Functional UI flows, form validations, navigation, CRUD operations
**Exclude from automation (manual only):** Mobile/Responsive, Accessibility, Edge Cases, Performance, Cross-Browser

### Code Quality Targets
* Target script length: **150–200 lines** (max 400)
* Target test case length: **10–30 lines** (max 50)
* Target helper function length: **max 30 lines**
* **Zero duplicate code blocks** — extract to helpers
* **NEVER** use `page.waitForTimeout()` — use `waitFor()`, `waitForLoadState()`, `toBeVisible()`, or `waitForSelector()` instead
* **NEVER** use non-retrying assertions on DOM elements — use Playwright auto-retrying assertions:
  - ❌ `expect(await el.textContent()).toContain()` → ✅ `await expect(el).toContainText()`
  - ❌ `expect(await el.isVisible()).toBe(true)` → ✅ `await expect(el).toBeVisible()`
  - ❌ `expect(await el.isEnabled()).toBe(true)` → ✅ `await expect(el).toBeEnabled()`
  - ❌ `expect(x || true).toBeTruthy()` → ✅ Write a real assertion that can actually fail
* **NEVER** use `.type()` (deprecated) — use `.fill()` or `.pressSequentially()`

### Popup Handling
**ALWAYS** import and use `PopupHandler` from `tests/utils/popupHandler.js`. Never write inline popup dismissal code.
```javascript
const { PopupHandler } = require('../../utils/popupHandler');
const popups = new PopupHandler(page);

// Dismiss all known popups after navigation
await popups.dismissAll();

// Or dismiss specific popups
await popups.dismissWelcome();
await popups.dismissAgentBranding();
await popups.dismissComparePopup();
await popups.dismissTourOverlay();
await popups.dismissOffLimitsPopup();

// Convenience: wait for network idle + dismiss all popups
await popups.waitForPageReady();
```
Also available through POmanager:
* `poManager.dismissAllPopups()` — dismiss all known popups
* `poManager.welcomePopUp()` — dismiss welcome modal only
* `poManager.agentBranding()` — dismiss agent branding popup
* `poManager.skipAllComparePopUp()` — dismiss compare/tour popups
* `poManager.offLimitsAgentPopUp()` — dismiss off-limits popup

### MCP Exploration (MANDATORY for script generation — MCP-First Architecture)

**MCP Server:** `unified-automation-mcp` (custom server at `agentic-workflow/mcp-server/server.js`)
**VS Code tool prefix:** `mcp_unified-autom_unified_*` (VS Code auto-prepends `mcp_unified-autom_` to all tool names)

**Glass MCP (opt-in migration target):** A lean standalone **8-verb** browser server lives at `glass-mcp/` (registered as `glass` in `.vscode/mcp.json`; the web-app enables it per session via `GLASS_MCP_ENABLED=true`, which skips the unified server for that session). When `mcp_glass_*` tools are present, prefer them and follow **GLASS MODE** in the `@scriptgenerator` prompt. Verb map: `open` (navigate/tabs) · `see` (ranked affordance menu + durable handles — replaces snapshot + `get_by_*`) · `do` (act → effect receipt) · `read` (content for assertions) · `wait` (bounded conditions) · `net` (record/mock/waitForResponse) · `devtool` (universal CDP passthrough) · `script` (audited in-page JS). Same discipline applies: explore live FIRST, never guess selectors, save exploration data with `"source": "glass-see"`, and STOP if the browser MCP is unavailable.

#### Core Rules
1. ScriptGenerator's **FIRST** tool call MUST be a live browser navigation — **`mcp_glass_open`** (Glass, primary) or `mcp_unified-autom_unified_navigate` (legacy fallback). No file reads or code searches before exploration.
2. Before creating ANY `.spec.js`, perceive every page under test — **`mcp_glass_see`** (Glass) or `mcp_unified-autom_unified_snapshot` (legacy) — on each.
3. Extract REAL selectors from the perception output (Glass durable handles, or `ref`/`id`/`ariaLabel`/`dataTestId`/`text`). **NEVER guess selectors.**
4. Save exploration data to `agentic-workflow/exploration-data/{ticketId}-exploration.json` with `"source": "glass-see"` (Glass) or `"mcp-live-snapshot"` (legacy).
5. If the browser MCP is unavailable: **STOP and report** — do NOT fall back to `fetch_webpage` or guessed selectors.

#### Minimum Exploration Depth (ENFORCED)
Before generating a `.spec.js`, you MUST have called:
- At least 1× `get_by_role` OR `get_by_test_id` (semantic selector validation)
- At least 1× `get_text_content` OR `get_attribute` (content extraction for assertions)
- At least 1× `get_page_url` OR `expect_url` (navigation state verification)

#### Key MCP Tool Categories
| Category | Key Tools |
|---|---|
| Navigation | `navigate`, `navigate_back`, `reload`, `get_page_url`, `get_page_title` |
| Snapshot | `snapshot`, `get_by_role`, `get_by_text`, `get_by_label`, `get_by_test_id` |
| Interaction | `click`, `type`, `fill_form`, `select_option`, `check`, `hover`, `press_key` |
| State | `is_visible`, `is_enabled`, `get_text_content`, `get_attribute`, `get_input_value` |
| Wait | `wait_for`, `wait_for_element`, `wait_for_response` |
| Assert | `expect_url`, `expect_title`, `expect_element_text`, `expect_element_attribute` |
| Advanced | `screenshot`, `evaluate`, `browser_close`, `handle_dialog` |

> For the complete 141-tool reference with usage guidance, see the `@scriptgenerator` agent prompt.

## Naming Conventions
* For Consumer: "Consumer - [Test Case Name]"
* For Agent Portal: "Agent Portal - [Test Case Name]"
* Instead of "Login as ONMLS user", use "Login into ONMLS". Same for "Login as non-ONMLS user" — use "Login into other MLS".



## Test Environment Links

Environment URLs are configured in `agentic-workflow/.env`. Read values from there or `agentic-workflow/config/workflow-config.json → environments`:
* **UAT Consumer Portal:** `${UAT_URL}` (from `agentic-workflow/.env`)
* **UAT Agent Portal:** Configure in `agentic-workflow/.env` if needed
* **PROD Consumer Portal:** `${PROD_URL}` (from `agentic-workflow/.env`)

Token-based URLs are constructed using `userTokens` from `tests/test-data/testData.js` — always use the exported tokens instead of hardcoding.

-

## Jira Interaction Policy

### 🚨 Mandatory: Use Gated SDK Tools for ALL Jira Writes
Every Jira write (create/update/delete ticket, add/edit/delete comment, transition, attach file, log work, link issues, Confluence create/update) MUST use the gated SDK custom tools listed below. They route through the global approval guardrail (`requireJiraMutationApproval`) which prompts the user before any write hits Jira.

**❌ NEVER use the external Atlassian remote MCP write tools.** They bypass the approval prompt and are programmatically blocked from chat sessions, but agents must also avoid them by name to prevent regressions if the allowlist is widened in future:
- `mcp_atlassian_atl_addCommentToJiraIssue` — use `update_jira_ticket` (with `comment` param), `add_comment_with_media`, or `add_comment_with_images` instead.
- `mcp_atlassian_atl_editJiraIssue` — use `update_jira_ticket` instead.
- `mcp_atlassian_atl_createJiraIssue` — use `create_jira_ticket` instead.
- `mcp_atlassian_atl_transitionJiraIssue` — use `transition_jira_ticket` instead.
- `mcp_atlassian_atl_createConfluencePage` / `mcp_atlassian_atl_updateConfluencePage` — use `create_confluence_page` / `update_confluence_page` instead.
- Any other `mcp_atlassian_atl_*` tool whose name implies a write (`add*`, `create*`, `edit*`, `update*`, `delete*`, `transition*`).

The Atlassian MCP server is restricted to read-only tools (get/search/fetch). Read-only operations like `mcp_atlassian_atl_getJiraIssue`, `mcp_atlassian_atl_searchJiraIssuesUsingJql`, and `mcp_atlassian_atl_getConfluencePage` remain allowed for context retrieval.

### Allowed SDK Operations
* Agents may READ from Jira tickets (fetch ticket details)
* Agents may CREATE new Jira tickets (bugs, testing tasks)
* Agents may pass `labels` when creating Jira tickets only if the user explicitly asks for labels; otherwise new tickets must omit labels by default
* Agents may UPDATE existing Jira tickets (edit description, summary, labels, priority, fix versions, add comments) using the `update_jira_ticket` tool
* Agents may LIST available Fix Versions for a Jira project using the `get_jira_project_versions` tool before setting fixVersions on a ticket
* Agents may INSPECT editable Jira fields and available transitions using the `get_jira_ticket_capabilities` tool
* Agents may CHANGE Jira ticket status using the `transition_jira_ticket` tool
* Agents may SEARCH Jira assignable users using the `search_jira_users` tool when the user wants assignment to a named person
* Agents may DELETE Jira tickets using the `delete_jira_ticket` tool only when the user explicitly confirms deletion of the issue itself with `DELETE <ticketId>` or `DELETE <ticketId> WITH SUBTASKS` in the latest message
* Agents may DELETE individual Jira comments using the `delete_jira_comment` tool. The shared approval component prompts the user for confirmation before the delete executes. Use `get_jira_ticket_comments` first if the commentId is unknown.
* Agents may EDIT/UPDATE the body of an existing Jira comment using the `edit_jira_comment` tool. The shared approval component previews the before/after text before the write is sent. Use `get_jira_ticket_comments` first if the commentId is unknown.
* Agents may REMOVE Jira issue links using the `remove_jira_issue_link` tool when the user explicitly asks to unlink tickets or remove an associated link
* Agents may LINK two existing Jira issues using the `link_jira_issues` tool — creates a link (Relates, Blocks, Duplicate, etc.) between two already-existing tickets. Available to BugGenie, TestGenie, and TaskGenie.
* Agents may LOG WORK on Jira tickets using the `log_jira_work` tool; the shared approval component confirms the worklog entry before it is written. Treat generic "Time Tracking" or "add hours" requests as worklog intent.
* Agents may UPDATE Jira original and remaining estimates using the `update_jira_estimates` tool only when the user explicitly asks to change estimate fields. The shared approval component previews the new estimates before they are applied.
* Agents may ATTACH FILES to Jira tickets using the `attach_file_to_jira` tool — supports any file type (.xlsx, .pdf, .json, .csv, etc.) up to 50 MB. Use to upload generated test case Excel files, reports, or other artifacts.
* Agents may ADD MIXED-MEDIA COMMENTS using the `add_comment_with_media` tool — uploads screenshots, preview frames, and recordings as Jira attachments, renders screenshots and preview frames inline in the comment, and lists recording file names in a Video evidence section. Jira Cloud does NOT support inline playable video in REST-created comments for this workflow, so recordings remain issue attachments rather than inline media. Available to BugGenie, TestGenie, and TaskGenie.
* Agents may ADD COMMENTS WITH INLINE IMAGES using the `add_comment_with_images` tool — uploads image files as ticket attachments and creates a comment with those images rendered inline. Uses a 3-strategy approach: (A) REST API v2 + wiki markup `!filename.png|thumbnail!` for native inline rendering (primary — Jira's server-side wiki→ADF converter resolves attachments reliably), (B) REST API v3 + ADF mediaSingle with mediaApiFileId UUIDs (fallback), (C) REST API v3 + ADF text-link fallback (last resort). Available to BugGenie, TestGenie, and TaskGenie.
* Agents may DELETE ATTACHMENTS from Jira tickets using the `delete_jira_attachment` tool — requires the numeric attachment ID (get it from the ticket's attachment list via `get_jira_ticket`). Requires explicit user confirmation before executing.
* If a Jira request mixes worklog language and estimate language, agents must clarify before changing Jira time tracking data
* BugGenie can create, read, and update tickets
* TestGenie can read, update, and create tickets (Testing tasks with linking and auto-assignment)
* When creating Testing tasks, agents MUST:
  - Call `get_jira_current_user` to get the user's accountId for self-assignment
  - Call `search_jira_users` when assignment must go to a named user like Monica or Khushboo
  - Use `linkedIssueKey` parameter to create a related linked Testing task
  - Use `parentIssueKey` parameter to create a true Jira subtask under the parent ticket
  - Use `assigneeAccountId` parameter to assign the created task or subtask
* **Always display Jira URLs as clickable markdown hyperlinks** using `[text](url)` format

## Tool Broker (Cross-Agent Delegation)

Agents have static, role-specific tool sets. The **Tool Broker** enables any agent to invoke tools from another agent's set without switching agents or creating new LLM sessions.

**Meta-tools (injected into all single-agent sessions):**
* `list_delegatable_tools` — Discover tools available via delegation not in your native set
* `cross_agent_delegate` — Invoke a specific tool from another agent (with full approval flow)

**How it works:**
1. Agent calls `list_delegatable_tools` → gets categorized list of available tools
2. Agent calls `cross_agent_delegate({ toolName: '...', parameters: { ... } })` → broker creates the handler on-demand with current session deps and executes it
3. Approval flow, progress broadcasts, and session context all work as if the tool were native

**Configuration:** `agentic-workflow/config/workflow-config.json` → `toolBroker` section
* `enabled` — Master toggle (default: true)
* `maxDelegationsPerSession` — Rate limit per session (default: 10)
* `permissions` — Category-based access control per agent

**Permission model:** Each agent can only delegate to allowed tool categories:
| Agent | Allowed Categories |
|---|---|
| BugGenie | jira, evidence, document, framework |
| TestGenie | jira, document, testcase |
| TaskGenie | jira |
| ScriptGenerator | framework, grounding |
| DocGenie | jira, document |
| CodeReviewer | framework, grounding |

**Note:** TPM/full profile already merges all agent tools — broker meta-tools are not injected for TPM.

## Bug Ticket Format (BugGenie)
When creating defect tickets, use this structure:
* **Description:** Clear summary of the defect
* **Steps to Reproduce:** Numbered steps from the failed test
* **Expected Behaviour:** What should happen
* **Actual Behaviour:** What actually happened
* **MLS:** Which MLS environment
* **Environment:** UAT/INT/PROD
* **Attachments:** Screenshots, logs, error traces

## Jira-Safe Rich Text Formatting
When creating or updating Jira descriptions, comments, or Testing task content through this workflow:
* Use **bold** only for section labels and headings.
* Use `code` only for identifiers, field names, property IDs, event names, and state values.
* Never combine **bold** and `inline code` on the same text span.
* Stay within the Jira-safe subset of rich formatting supported by this repo: headings, lists, tables, bold labels, and inline code-only identifiers.
