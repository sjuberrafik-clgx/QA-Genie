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

This workspace uses a 5-agent orchestrated workflow for end-to-end QA automation:

| Agent | Role |
|---|---|
| `@orchestrator` | Master pipeline coordinator — chains TestGenie → ScriptGenerator → Execute → BugGenie |
| `@testgenie` | Generates test cases from Jira tickets → Excel + chat markdown |
| `@scriptgenerator` | Generates Playwright `.spec.js` scripts using MCP exploration |
| `@buggenie` | Creates Jira defect tickets from test failures |
| `@codereviewer` | Reviews generated scripts for quality, patterns, and best practices |

**Pipeline stages (sequential, each validated before proceeding):**
`JIRA_FETCH → EXCEL_CREATE → MCP_EXPLORE → SCRIPT_GENERATE → SCRIPT_EXECUTE`

**Key config files:**
* `agentic-workflow/config/workflow-config.json` — Pipeline configuration (browser, MCP strategy, quality gates, **project paths**)
* `agentic-workflow/config/assertion-config.json` — Assertion patterns and rules for generated scripts
* `agentic-workflow/.env` — Environment-specific values (Jira credentials, URLs, MCP settings)

**Jira project:** Configured in `agentic-workflow/.env` as `JIRA_PROJECT_KEY` | **Cloud ID:** Configured in `agentic-workflow/.env` as `JIRA_CLOUD_ID`

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
* When user uses Atlassian MCP tools to fetch Jira ticket information then walkthrough complete Jira ticket information from URL given by user.
* Don't truncate information received from Jira ticket — mention it in test case completely. For example, if acceptance criteria lists specific fields, list ALL fields individually in test steps rather than summarizing as "specified fields".

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

#### Core Rules
1. ScriptGenerator's **FIRST** tool call MUST be `mcp_unified-autom_unified_navigate` — no file reads, no code searches before MCP exploration.
2. Before creating ANY `.spec.js`, you MUST navigate to every page under test and call `mcp_unified-autom_unified_snapshot` on each.
3. Extract REAL selectors from snapshot output (`ref`, `id`, `ariaLabel`, `dataTestId`, `text`). **NEVER guess selectors.**
4. Save exploration data to `agentic-workflow/exploration-data/{ticketId}-exploration.json` with `"source": "mcp-live-snapshot"`.
5. If MCP is unavailable: **STOP and report** — do NOT fall back to `fetch_webpage` or guessed selectors.

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
| SND - SRCH | Syndication Search |
| SND | Syndication |
| OHO | OneHomeOwner |
| DD | Data Distribution |

## Test Environment Links

Environment URLs are configured in `agentic-workflow/.env`. Read values from there or `agentic-workflow/config/workflow-config.json → environments`:
* **UAT Consumer Portal:** `${UAT_URL}` (from `agentic-workflow/.env`)
* **UAT Agent Portal:** Configure in `agentic-workflow/.env` if needed
* **PROD Consumer Portal:** `${PROD_URL}` (from `agentic-workflow/.env`)

Token-based URLs are constructed using `userTokens` from `tests/test-data/testData.js` — always use the exported tokens instead of hardcoding.

## Features Reference
* **Reimagine Space (CTA)** — gives virtual experience of space, powered by RoomVo. This feature works with property images shown in property details page.
* **Ads Services Widget** — shows in Property details page, between Other Facts & Features and Schools section.

## MLS Names Reference (Partial List - Key MLSes)
* Canopy MLS (Charlotte)
* ONMLS/ITSO MLS (ON, Canada)
* Stellar MLS (DD) (FL)
* Bright (DC, MD, VA, PA, WV, DE)
* California Regional (CA)
* SmartMLS (CT)
* North Star MLS (MN)
* Recolorado (DD) (CO)
* First MLS (Atlanta) (DD) (GA)
* Houston, TX (TX)
* Las Vegas (NV)
* South East Florida (Miami) (FL)
* Toronto Regional Real Estate Board (ON, Canada) osn:TRREB

## Jira Interaction Policy
* Agents may READ from Jira tickets (fetch ticket details)
* Agents NEVER WRITE to existing Jira tickets (no comments)
* Only BugGenie creates NEW tickets (defects)
* All results/updates presented in chat for manual Jira updates

## Bug Ticket Format (BugGenie)
When creating defect tickets, use this structure:
* **Description:** Clear summary of the defect
* **Steps to Reproduce:** Numbered steps from the failed test
* **Expected Behaviour:** What should happen
* **Actual Behaviour:** What actually happened
* **MLS:** Which MLS environment
* **Environment:** UAT/INT/PROD
* **Attachments:** Screenshots, logs, error traces
