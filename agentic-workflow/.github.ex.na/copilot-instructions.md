---
applyTo: '**'
---
# Global Copilot Instructions — QA Automation Workflow

## Dynamic Configuration

This workflow uses dynamic path resolution. All paths below are **defaults** — actual paths come from:
1. `.env` file (environment-specific values)
2. `workflow-config.json` → `projectPaths` section
3. Auto-detection (scans for framework files)

**Before referencing any path**, check `workflow-config.json.projectPaths` for the configured values.
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
* `workflow-config.json` — Pipeline configuration (browser, MCP strategy, quality gates, **project paths**)
* `assertion-config.json` — Assertion patterns and rules for generated scripts
* `.env` — Environment-specific values (Jira credentials, URLs, MCP settings)

**Jira project:** Configured in `.env` as `JIRA_PROJECT_KEY` | **Cloud ID:** Configured in `.env` as `JIRA_CLOUD_ID`

## Test Case Generation Format

* You must generate test cases strictly following the below format and structure.
* Do not change the column names, do not add extra fields, and keep the layout exactly the same.
* While generating test cases firstly, add 1 row in Test Steps format, write there like 1.1 and then Launch OneHome application then User should be able to launch OneHome application then User is able to launch OneHome application.
* Write test cases by covering all possible steps and scenarios.
* While generating specific activity & action, make sure skip small small & repetitive steps, directly come to the point.
* Remember, if test steps in specific activity & action column crossed 1.5 steps then going forward combine next two steps into one step.
* Both chat markdown tables AND Excel export are required (use `scripts/excel-template-generator.js`).

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

### Import Order (MANDATORY)
All `.spec.js` files must follow this import order:
```javascript
// 1. Playwright
const { test, expect } = require('@playwright/test');
// 2. Config
const { launchBrowser } = require('../../config/config');
// 3. Page Object Manager
const POmanager = require('../../pageobjects/POmanager');
// 4. Individual page objects (only if needed outside POmanager)
const agentBranding = require('../../pageobjects/agentBranding');
// 5. Test data
const { userTokens, credentials, baseUrl } = require('../../test-data/testData');
```

### Framework Pattern (MANDATORY)
```javascript
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { userTokens } = require('../../test-data/testData');

test.describe("Feature Name", () => {
  let browser, page, context, poManager;

  test.beforeAll(async () => {
    ({ browser, page, context } = await launchBrowser());
    poManager = new POmanager(page);
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
* Use `page.waitForTimeout()` sparingly — prefer `waitForSelector`, `waitForLoadState`, or `expect().toBeVisible()`

### Popup Handling
Use existing framework page objects for common popups — never write custom popup handling:
* Agent branding popup → `poManager.agentBranding()`
* Compare all popup → `poManager.skipAllComparePopUp()`
* Welcome popup → `poManager.welcomePopUp()`
* Off-limits popup → `poManager.offLimitsAgentPopUp()`

### MCP Exploration (MANDATORY for script generation — MCP-First Architecture)

**MCP Server:** `unified-automation-mcp` (custom server at `mcp-server/server.js`)
**VS Code tool prefix:** `mcp_unified-autom_unified_*` (VS Code auto-prepends `mcp_unified-autom_` to all tool names)

#### First-Action Rule
The scriptgenerator agent's FIRST tool call MUST be `mcp_unified-autom_unified_navigate`. No file reads, no code searches, no web fetches before MCP exploration. This is structurally enforced — Phase 1 outputs (snapshot data) become Phase 2 inputs (selectors for the script).

#### Exploration Steps
Before creating ANY `.spec.js` file, you MUST:
1. Call `mcp_unified-autom_unified_navigate` to open the target application URL
2. Call `mcp_unified-autom_unified_snapshot` to capture the live DOM accessibility tree
3. Navigate to ALL pages being tested and snapshot each one
4. Extract REAL element selectors from the snapshot output (use `ref`, `id`, `ariaLabel`, `dataTestId`, `text`)
5. Save exploration data to `exploration-data/{ticketId}-exploration.json` (see schema below)
6. ONLY AFTER steps 1-5: Create the `.spec.js` using captured selectors
7. Add header comment in generated script: `// Selectors validated via MCP live exploration on {date}`

#### Exploration Data Schema (REQUIRED)
The `exploration-data/{ticketId}-exploration.json` file MUST conform to this structure:
```json
{
  "source": "mcp-live-snapshot",
  "ticketId": "AOTF-XXXXX",
  "timestamp": "ISO-8601 timestamp",
  "snapshots": [
    {
      "url": "page URL visited",
      "pageTitle": "page title",
      "elements": [
        { "ref": "e1", "role": "link", "name": "Terms of Use", "ariaLabel": "..." }
      ]
    }
  ],
  "selectorCount": 15,
  "pagesVisited": ["url1", "url2"]
}
```

**Critical rules:**
* `"source"` MUST be `"mcp-live-snapshot"` — NOT `"web-fetch-exploration"`
* `"snapshots"` MUST be a non-empty array with data from `mcp_unified-autom_unified_snapshot` calls
* Quality gates will REJECT exploration data that uses `web-fetch-exploration` source
* The orchestrator will RE-INVOKE scriptgenerator if MCP verification fails after return

#### Failure Policy
If MCP server is unavailable or navigation fails: **STOP and report** — do NOT fall back to `fetch_webpage` or guessed selectors. A script with guessed selectors will fail 100% of the time.

#### Key MCP tools for exploration

| VS Code callable name | Purpose |
|---|---|
| `mcp_unified-autom_unified_navigate` | Navigate to URL |
| `mcp_unified-autom_unified_snapshot` | Get accessibility tree with element refs |
| `mcp_unified-autom_unified_click` | Click element by ref |
| `mcp_unified-autom_unified_type` | Type text into element |
| `mcp_unified-autom_unified_wait_for` | Wait for text/element/time |
| `mcp_unified-autom_unified_get_by_role` | Find element by ARIA role |
| `mcp_unified-autom_unified_get_attribute` | Get element attribute |
| `mcp_unified-autom_unified_evaluate` | Execute JavaScript on page |
| `mcp_unified-autom_unified_browser_close` | Close browser |

**NEVER guess selectors based on page object files, web-fetch, or assumptions.**

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

Environment URLs are configured in `.env`. Read values from there or `workflow-config.json → environments`:
* **UAT Consumer Portal:** `${UAT_URL}` (from `.env`)
* **UAT Agent Portal:** Configure in `.env` if needed
* **PROD Consumer Portal:** `${PROD_URL}` (from `.env`)

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
