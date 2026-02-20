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

#### First-Action Rule
The scriptgenerator agent's FIRST tool call MUST be `mcp_unified-autom_unified_navigate`. No file reads, no code searches, no web fetches before MCP exploration. This is structurally enforced — Phase 1 outputs (snapshot data) become Phase 2 inputs (selectors for the script).

#### Exploration Steps
Before creating ANY `.spec.js` file, you MUST:
1. Call `mcp_unified-autom_unified_navigate` to open the target application URL
2. Call `mcp_unified-autom_unified_snapshot` to capture the live DOM accessibility tree
3. Navigate to ALL pages being tested and snapshot each one
4. Extract REAL element selectors from the snapshot output (use `ref`, `id`, `ariaLabel`, `dataTestId`, `text`)
5. Save exploration data to `agentic-workflow/exploration-data/{ticketId}-exploration.json` (see schema below)
6. ONLY AFTER steps 1-5: Create the `.spec.js` using captured selectors
7. Add header comment in generated script: `// Selectors validated via MCP live exploration on {date}`

#### Exploration Data Schema (REQUIRED)
The `agentic-workflow/exploration-data/{ticketId}-exploration.json` file MUST conform to this structure:
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
  "pagesVisited": ["url1", "url2"],
  "popupsDetected": [
    {
      "type": "welcome-modal",
      "selector": "ngb-modal-window.welcome-modal-container",
      "dismissButton": "button:has-text('Continue')",
      "handledBy": "PopupHandler.dismissWelcome()"
    }
  ]
}
```

**`popupsDetected` rules:**
* During MCP exploration, if a modal/popup/overlay appears in the snapshot, record it in `popupsDetected`
* Set `"handledBy"` to the matching PopupHandler method if one exists (e.g., `"PopupHandler.dismissWelcome()"`)
* Set `"handledBy": null` if no existing handler covers this popup — the generated script should add a comment: `// TODO: New popup type detected — consider adding to PopupHandler`
* This enables the system to dynamically discover new popup types and evolve the PopupHandler over time

**Critical rules:**
* `"source"` MUST be `"mcp-live-snapshot"` — NOT `"web-fetch-exploration"`
* `"snapshots"` MUST be a non-empty array with data from `mcp_unified-autom_unified_snapshot` calls
* Quality gates will REJECT exploration data that uses `web-fetch-exploration` source
* The orchestrator will RE-INVOKE scriptgenerator if MCP verification fails after return

#### Failure Policy
If MCP server is unavailable or navigation fails: **STOP and report** — do NOT fall back to `fetch_webpage` or guessed selectors. A script with guessed selectors will fail 100% of the time.

#### Key MCP tools for exploration

| VS Code callable name | Purpose | When to Use |
|---|---|---|
| **Navigation & Page** | | |
| `mcp_unified-autom_unified_navigate` | Navigate to URL | First action — open target page |
| `mcp_unified-autom_unified_navigate_back` | Go back | Multi-page flow testing |
| `mcp_unified-autom_unified_navigate_forward` | Go forward | Back/forward navigation tests |
| `mcp_unified-autom_unified_reload` | Reload page | State persistence after refresh |
| `mcp_unified-autom_unified_get_page_url` | Get current URL | Validate navigation state |
| `mcp_unified-autom_unified_get_page_title` | Get page title | Validate page loaded correctly |
| `mcp_unified-autom_unified_get_viewport_size` | Get viewport dimensions | Verify responsive layout |
| `mcp_unified-autom_unified_tabs` | List/manage browser tabs | Clean tabs before exploration |
| `mcp_unified-autom_unified_resize` | Resize browser viewport | Responsive testing at breakpoints |
| `mcp_unified-autom_unified_emulate` | Emulate device/settings | Mobile device simulation |
| `mcp_unified-autom_unified_bring_to_front` | Bring page to front | Focus specific tab/page |
| `mcp_unified-autom_unified_is_page_closed` | Check if page is closed | Guard against stale page refs |
| **Snapshot & Discovery** | | |
| `mcp_unified-autom_unified_snapshot` | Accessibility tree with element refs | Primary selector discovery tool |
| `mcp_unified-autom_unified_get_by_role` | Find by ARIA role + name | Best semantic selector method |
| `mcp_unified-autom_unified_get_by_text` | Find by visible text | Text-based element discovery |
| `mcp_unified-autom_unified_get_by_label` | Find by label text | Form element discovery |
| `mcp_unified-autom_unified_get_by_test_id` | Find by data-testid | Most stable selector |
| `mcp_unified-autom_unified_get_by_placeholder` | Find by placeholder | Input field discovery |
| `mcp_unified-autom_unified_get_by_alt_text` | Find by alt text | Image element discovery |
| `mcp_unified-autom_unified_get_by_title` | Find by title attribute | Tooltip element discovery |
| `mcp_unified-autom_unified_generate_locator` | Auto-generate best locator | Let Playwright pick optimal selector |
| **Interaction** | | |
| `mcp_unified-autom_unified_click` | Click element | Button/link interaction |
| `mcp_unified-autom_unified_type` | Type text into element | Form input (use for autocomplete triggering) |
| `mcp_unified-autom_unified_fill_form` | Fill form fields | Multi-field form entry |
| `mcp_unified-autom_unified_select_option` | Select dropdown option | Dropdown/select interaction |
| `mcp_unified-autom_unified_check` | Check checkbox/radio | Toggle form controls on |
| `mcp_unified-autom_unified_uncheck` | Uncheck checkbox | Toggle form controls off |
| `mcp_unified-autom_unified_hover` | Hover over element | Tooltip/dropdown trigger |
| `mcp_unified-autom_unified_focus` | Focus element | Form field pre-interaction |
| `mcp_unified-autom_unified_blur` | Remove focus from element | Trigger blur validation |
| `mcp_unified-autom_unified_press_key` | Press keyboard key | Enter, Escape, Tab actions |
| `mcp_unified-autom_unified_press_sequentially` | Type characters one by one | Autocomplete/typeahead triggering |
| `mcp_unified-autom_unified_keyboard_type` | Type text via keyboard | Low-level keyboard input |
| `mcp_unified-autom_unified_keyboard_down` | Hold key down | Modifier key combinations |
| `mcp_unified-autom_unified_keyboard_up` | Release key | End modifier key hold |
| `mcp_unified-autom_unified_clear_input` | Clear input field | Reset form fields |
| `mcp_unified-autom_unified_select_text` | Select text in element | Text selection for copy/delete |
| `mcp_unified-autom_unified_scroll_into_view` | Scroll element visible | Before interacting with off-screen elements |
| `mcp_unified-autom_unified_drag` | Drag element to target | Drag-and-drop interactions |
| `mcp_unified-autom_unified_file_upload` | Upload file to input | File upload testing |
| **Mouse (Low-Level)** | | |
| `mcp_unified-autom_unified_mouse_click_xy` | Click at coordinates | Pixel-precise click |
| `mcp_unified-autom_unified_mouse_dblclick_xy` | Double-click at coordinates | Double-click interaction |
| `mcp_unified-autom_unified_mouse_move_xy` | Move mouse to coordinates | Hover at specific position |
| `mcp_unified-autom_unified_mouse_drag_xy` | Drag from one point to another | Canvas/map drag operations |
| `mcp_unified-autom_unified_mouse_down` | Press mouse button down | Start drag or hold |
| `mcp_unified-autom_unified_mouse_up` | Release mouse button | End drag or hold |
| `mcp_unified-autom_unified_mouse_wheel` | Scroll with mouse wheel | Scroll-based interactions |
| **Element State** | | |
| `mcp_unified-autom_unified_is_visible` | Check visibility | Pre-condition before click |
| `mcp_unified-autom_unified_is_enabled` | Check enabled state | Validate button clickability |
| `mcp_unified-autom_unified_is_disabled` | Check disabled state | Validate disabled controls |
| `mcp_unified-autom_unified_is_checked` | Check checked state | Toggle/checkbox verification |
| `mcp_unified-autom_unified_is_hidden` | Check hidden state | Post-action verification |
| `mcp_unified-autom_unified_is_editable` | Check editable state | Readonly field verification |
| `mcp_unified-autom_unified_get_attribute` | Get element attribute | Extract href, class, data-* values |
| `mcp_unified-autom_unified_get_text_content` | Get text content | Extract text for validation |
| `mcp_unified-autom_unified_get_inner_text` | Get inner text (rendered) | Extract visible text only |
| `mcp_unified-autom_unified_get_inner_html` | Get inner HTML | Extract HTML structure |
| `mcp_unified-autom_unified_get_outer_html` | Get outer HTML | Extract full element HTML |
| `mcp_unified-autom_unified_get_input_value` | Get input field value | Extract current input value |
| `mcp_unified-autom_unified_get_bounding_box` | Get element position/size | Verify element dimensions |
| **Wait & Sync** | | |
| `mcp_unified-autom_unified_wait_for` | Wait for text/element/time | Sync before next action |
| `mcp_unified-autom_unified_wait_for_element` | Wait for element state | Wait for visible/hidden/attached |
| `mcp_unified-autom_unified_wait_for_response` | Wait for network response | API call completion |
| `mcp_unified-autom_unified_wait_for_request` | Wait for network request | Outbound API call detection |
| `mcp_unified-autom_unified_wait_for_new_page` | Wait for new tab/popup | Handle popup/new tab flows |
| `mcp_unified-autom_unified_wait_for_download` | Wait for file download | Download trigger verification |
| **Assertions (built-in)** | | |
| `mcp_unified-autom_unified_expect_url` | Assert URL | Navigation validation |
| `mcp_unified-autom_unified_expect_title` | Assert page title | Page load validation |
| `mcp_unified-autom_unified_expect_element_text` | Assert element text | Content validation |
| `mcp_unified-autom_unified_expect_element_value` | Assert input value | Form value validation |
| `mcp_unified-autom_unified_expect_element_attribute` | Assert element attribute | Attribute validation |
| `mcp_unified-autom_unified_expect_element_class` | Assert CSS class | Class presence validation |
| `mcp_unified-autom_unified_expect_element_css` | Assert CSS property value | CSS style validation |
| `mcp_unified-autom_unified_expect_checked` | Assert checked state | Toggle validation |
| `mcp_unified-autom_unified_expect_enabled` | Assert enabled state | Enabled state validation |
| `mcp_unified-autom_unified_expect_disabled` | Assert disabled state | Disabled state validation |
| `mcp_unified-autom_unified_expect_focused` | Assert focused state | Focus validation |
| `mcp_unified-autom_unified_expect_attached` | Assert element attached to DOM | DOM presence validation |
| `mcp_unified-autom_unified_verify_element_visible` | Verify element visible | Visibility validation |
| `mcp_unified-autom_unified_verify_text_visible` | Verify text visible | Text presence validation |
| `mcp_unified-autom_unified_verify_value` | Verify element value | Value verification |
| **Advanced** | | |
| `mcp_unified-autom_unified_evaluate` | Execute JS on page | Custom DOM queries |
| `mcp_unified-autom_unified_evaluate_cdp` | Execute JS via CDP | Self-healing selector discovery |
| `mcp_unified-autom_unified_screenshot` | Take screenshot | Visual debugging |
| `mcp_unified-autom_unified_screenshot_baseline` | Save screenshot as baseline | Visual regression baseline |
| `mcp_unified-autom_unified_screenshot_compare` | Compare screenshot to baseline | Visual regression detection |
| `mcp_unified-autom_unified_handle_dialog` | Handle alert/confirm | Native browser dialogs |
| `mcp_unified-autom_unified_browser_close` | Close browser | Cleanup after exploration |
| `mcp_unified-autom_unified_browser_install` | Install browser binary | Ensure browser is available |
| `mcp_unified-autom_unified_list_all_pages` | List open pages/tabs | Multi-tab management |
| `mcp_unified-autom_unified_page_errors` | Get page JS errors | Error detection during exploration |
| `mcp_unified-autom_unified_pdf_save` | Save page as PDF | PDF export testing |
| `mcp_unified-autom_unified_run_playwright_code` | Run arbitrary Playwright code | Custom automation scripts |
| `mcp_unified-autom_unified_take_snapshot_cdp` | Capture DOM snapshot via CDP | CDP-level DOM capture |
| `mcp_unified-autom_unified_accessibility_audit` | Run accessibility audit | WCAG compliance checks |
| **Storage & Cookies** | | |
| `mcp_unified-autom_unified_get_cookies` | Get browser cookies | Session state inspection |
| `mcp_unified-autom_unified_add_cookies` | Add cookies | Pre-set authentication state |
| `mcp_unified-autom_unified_clear_cookies` | Clear cookies | Reset session state |
| `mcp_unified-autom_unified_get_local_storage` | Get localStorage | Client state inspection |
| `mcp_unified-autom_unified_set_local_storage` | Set localStorage value | Pre-set client state |
| `mcp_unified-autom_unified_remove_local_storage` | Remove localStorage key | Clear specific client state |
| `mcp_unified-autom_unified_get_session_storage` | Get sessionStorage | Session data inspection |
| `mcp_unified-autom_unified_set_session_storage` | Set sessionStorage value | Pre-set session data |
| `mcp_unified-autom_unified_remove_session_storage` | Remove sessionStorage key | Clear specific session data |
| `mcp_unified-autom_unified_query_indexeddb` | Query IndexedDB data | Inspect client-side database |
| **Frames & Shadow DOM** | | |
| `mcp_unified-autom_unified_list_frames` | List page frames | Discover iframe content |
| `mcp_unified-autom_unified_frame_action` | Perform action in frame | Targeted frame interaction |
| `mcp_unified-autom_unified_switch_to_frame` | Switch to iframe | Interact with iframe content |
| `mcp_unified-autom_unified_switch_to_main_frame` | Return to main frame | After iframe interaction |
| `mcp_unified-autom_unified_shadow_dom_query` | Query shadow DOM | Find elements in shadow roots |
| `mcp_unified-autom_unified_shadow_pierce` | Pierce shadow boundary | Interact through shadow DOM |
| **Network & Performance** | | |
| `mcp_unified-autom_unified_network_requests` | List network requests | Debug API calls |
| `mcp_unified-autom_unified_network_requests_cdp` | List network requests via CDP | Low-level network capture |
| `mcp_unified-autom_unified_get_network_request` | Get specific request details | Inspect API request/response |
| `mcp_unified-autom_unified_console_messages` | Get console messages | Debug page errors |
| `mcp_unified-autom_unified_console_messages_cdp` | Get console messages via CDP | Low-level console capture |
| `mcp_unified-autom_unified_performance_start_trace` | Start performance trace | Begin performance measurement |
| `mcp_unified-autom_unified_performance_stop_trace` | Stop performance trace | End measurement + save trace |
| `mcp_unified-autom_unified_performance_analyze` | Analyze performance metrics | Page load/rendering analysis |
| **Routing & Interception** | | |
| `mcp_unified-autom_unified_route_intercept` | Intercept network route | Mock API responses |
| `mcp_unified-autom_unified_route_remove` | Remove route interception | Restore original routing |
| `mcp_unified-autom_unified_route_list` | List active route intercepts | Inspect mock configuration |
| **Browser Context** | | |
| `mcp_unified-autom_unified_create_context` | Create new browser context | Isolated session testing |
| `mcp_unified-autom_unified_switch_context` | Switch browser context | Multi-context workflows |
| `mcp_unified-autom_unified_list_contexts` | List browser contexts | Context inventory |
| `mcp_unified-autom_unified_close_context` | Close browser context | Context cleanup |
| **Auth & State** | | |
| `mcp_unified-autom_unified_save_auth_state` | Save authentication state | Persist login for reuse |
| `mcp_unified-autom_unified_load_auth_state` | Load authentication state | Skip login in tests |
| **Video & Recording** | | |
| `mcp_unified-autom_unified_start_video` | Start video recording | Record test execution |
| `mcp_unified-autom_unified_stop_video` | Stop video recording | Finalize recording |
| **Downloads** | | |
| `mcp_unified-autom_unified_list_downloads` | List completed downloads | Verify downloaded files |
| `mcp_unified-autom_unified_save_download` | Save downloaded file | Persist download to disk |
| `mcp_unified-autom_unified_trigger_download` | Trigger file download | Initiate download action |
| **Geolocation & Locale** | | |
| `mcp_unified-autom_unified_set_geolocation` | Set geolocation coordinates | Location-based testing |
| `mcp_unified-autom_unified_grant_permissions` | Grant browser permissions | Allow geo/notifications/etc |
| `mcp_unified-autom_unified_clear_permissions` | Clear browser permissions | Reset permission state |
| `mcp_unified-autom_unified_set_timezone` | Set browser timezone | Timezone-dependent testing |
| `mcp_unified-autom_unified_set_locale` | Set browser locale | Locale/i18n testing |
| **Mutation Observer** | | |
| `mcp_unified-autom_unified_observe_mutations` | Start observing DOM mutations | Track dynamic DOM changes |
| `mcp_unified-autom_unified_get_mutations` | Get observed mutations | Retrieve DOM change log |
| `mcp_unified-autom_unified_stop_mutation_observer` | Stop mutation observer | End DOM change tracking |

#### MCP Exploration Decision Tree
```
1. NAVIGATE → mcp_unified-autom_unified_navigate
2. SNAPSHOT → mcp_unified-autom_unified_snapshot (capture full accessibility tree)
3. VALIDATE SELECTORS — for each key element in the test flow:
   a. SEMANTIC LOOKUP → get_by_role / get_by_test_id / get_by_label / get_by_text
      (confirms the element exists and captures its exact accessible name)
   b. CHECK STATE → is_visible / is_enabled / is_checked (verify element is interactable)
   c. EXTRACT CONTENT → get_text_content / get_attribute / get_input_value (capture REAL values for assertions)
   d. PRE-VALIDATE ASSERTIONS → expect_element_text / expect_url / expect_title
      (test assertions DURING exploration — catches mismatches before script generation)
4. INTERACT with elements that change page state:
   a. SCROLL if needed → scroll_into_view (off-screen elements)
   b. INTERACT → click / type / fill_form / check / select_option
   c. WAIT → wait_for_element / wait_for (after action, before next step)
   d. SNAPSHOT AGAIN → snapshot (after page state changes, new modals, navigation)
   e. VERIFY NAVIGATION → get_page_url / expect_url (confirm page changed)
   f. VERIFY PAGE → get_page_title / expect_title (confirm correct page loaded)
5. For popups/modals:
   a. After navigate → snapshot → check for modal elements in tree
   b. If modal found → click dismiss button → snapshot again to verify dismissed
   c. Record popup selectors in exploration-data for PopupHandler
6. For form elements:
   a. get_input_value → capture pre-filled/default values
   b. is_editable → confirm field accepts input
   c. fill_form / type / clear_input → test form interaction
7. For multi-tab/popup flows:
   a. wait_for_new_page → detect new tab opened
   b. list_all_pages → inventory open tabs
8. REPEAT steps 3-7 for EVERY page in the test flow
9. CLOSE → browser_close (always clean up)
```

**Minimum exploration depth:** Before generating a `.spec.js`, you MUST have called:
- At least 1× `get_by_role` OR `get_by_test_id` (semantic selector validation) — **ENFORCED: script creation blocked without this**
- At least 1× `get_text_content` OR `get_attribute` (content extraction for assertions) — **ENFORCED: script creation blocked without this**
- At least 1× `get_page_url` OR `expect_url` (navigation state verification)

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
