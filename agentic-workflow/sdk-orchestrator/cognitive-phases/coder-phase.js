/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CODER PHASE — Cognitive QA Loop Phase 3
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Incremental code generation — NO MCP tools, only file writes.
 * Uses ONLY verified selectors from the Explorer phase.
 *
 * Mimics how a senior engineer writes automation code:
 *   1. Set up imports and boilerplate
 *   2. Write one test at a time
 *   3. Validate each test block against exploration data
 *   4. Cross-reference with framework inventory for reuse
 *
 * Inputs:
 *   - Verified exploration data (per-test-step selector map from Explorer)
 *   - Framework inventory (page objects, business functions, utils)
 *   - Assertion config patterns
 *   - Test cases (from TestGenie)
 *
 * Outputs:
 *   - Complete .spec.js file written to tests/specs/{ticketId}/
 *   - Generation report (selectors used, functions reused, warnings)
 *
 * Context window: ~10K tokens. No MCP tools. Pure code generation focus.
 *
 * @module cognitive-phases/coder-phase
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PHASE_NAME = 'coder';

// ─── Coder Phase Prompt Template ────────────────────────────────────────────

/**
 * Build the system prompt for the Coder phase.
 * Focused only on code generation — no exploration instructions.
 */
function buildCoderSystemPrompt() {
    return `You are the CODER — Phase 3 of the Cognitive QA Loop.

## Your Role
You are a senior Playwright automation engineer. You have received:
1. VERIFIED exploration data with real selectors from the Explorer phase
2. A framework inventory showing existing reusable code

Your job is to write a production-quality .spec.js file using ONLY the verified selectors
and REUSING existing framework functions wherever possible.

## How to Think (Incremental Generation — MANDATORY)
Do NOT write the entire script at once. Follow this incremental process:

### Step 1: Imports & Setup
Write the file header, imports, and describe block structure FIRST.
Validate: Are all imports correct? Is the path correct? Is PopupHandler imported?

### Step 2: beforeAll / afterAll
Write the setup and teardown blocks.
Validate: Does beforeAll use launchBrowser()? Does afterAll close page+context+browser with guards?

### Step 3: For EACH test case (one at a time):
a. Look up the test step in the exploration data → get the selector map
b. For each selector: VERIFY it exists in the exploration data (never make one up)
c. Check: does an existing business function handle this action? → REUSE it
d. Write the test block with proper assertions
e. Validate: no anti-patterns? no waitForTimeout? no page.type()? auto-retrying assertions?

### Step 4: Final Validation
Review the complete script for:
- All selectors trace back to exploration data
- No duplicate code (extract to helpers if needed)
- Proper wait strategies
- File header with @ticket, @feature, @generated

## MANDATORY Code Structure

\`\`\`javascript
/**
 * @ticket {TICKET_ID}
 * @feature {Feature Name}
 * @framework Playwright + JavaScript (CommonJS)
 * @environment UAT
 * @generated {DATE}
 * @cognitive-phase coder
 */
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');
const { userTokens, credentials, baseUrl } = require('../../test-data/testData');

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

    test("test name from test case", async () => {
        // Implementation using ONLY verified selectors
    });
});
\`\`\`

## Rules (ENFORCED — violations will be caught by Reviewer)
1. EVERY selector MUST come from the exploration data selectorMap — NEVER guess
2. Use auto-retrying assertions ONLY: await expect(el).toBeVisible() NOT expect(await el.isVisible())
3. NO page.waitForTimeout() — use waitForLoadState, toBeVisible, waitForSelector
4. NO page.type() — use page.fill() or page.pressSequentially()
5. Import POmanager as default export: const POmanager = require(...)
6. Import PopupHandler and use it — never write inline popup dismissal
7. Use userTokens from testData — never hardcode URLs or tokens
8. Use test.describe.serial() for shared browser state
9. Keep scripts under 300 lines — extract helpers for repetitive logic
10. Add comments referencing test step IDs: // Step 1.1: Apply search filters

## Cross-Reference Pattern
For each selector you use, add a comment showing its source:
\`\`\`javascript
// Explorer verified: role=button, name="Apply Filters" (step 1.1, verified=true)
await page.getByRole('button', { name: 'Apply Filters' }).click();
\`\`\`

## Output
Generate the complete .spec.js file content. Also output a generation report:

{
  "generationReport": {
    "totalTests": 4,
    "selectorsUsed": 12,
    "selectorsFromExploration": 12,
    "functionsReused": ["loginConsumer", "dismissPopups"],
    "warnings": ["Step 1.3 selector was marked partial — may be flaky"],
    "confidence": 85
  }
}`;
}

/**
 * Build the user prompt for the Coder phase.
 *
 * @param {Object} options
 * @param {string} options.ticketId
 * @param {string} options.featureName
 * @param {Object} options.explorationData - From Explorer phase (selectorMap + transitions)
 * @param {string} options.testCases - Test cases text
 * @param {Object} options.frameworkInventory - Available page objects, business functions, utils
 * @param {Object} [options.assertionConfig] - Assertion patterns
 * @param {Object} [options.reviewFixes] - Fixes from Reviewer (if retry)
 * @param {Object} [options.brokenSelectors] - Broken selectors from DryRun (if retry)
 * @returns {string}
 */
function buildCoderUserPrompt(options) {
    const {
        ticketId,
        featureName,
        explorationData,
        testCases,
        frameworkInventory,
        assertionConfig,
        reviewFixes,
        brokenSelectors,
    } = options;

    const sections = [
        `## Generate Script: ${ticketId} — ${featureName || 'Feature'}`,
    ];

    // If this is a retry with fixes
    if (reviewFixes) {
        sections.push(
            '',
            '## ⚠️ REVIEWER FEEDBACK — Fix These Issues',
            'The Reviewer found issues with your previous script. Fix them:',
            typeof reviewFixes === 'string'
                ? reviewFixes
                : JSON.stringify(reviewFixes, null, 2)
        );
    }

    if (brokenSelectors) {
        sections.push(
            '',
            '## ⚠️ DRY-RUN VALIDATION FAILED — Fix Broken Selectors',
            'These selectors failed verification on the live page:',
            typeof brokenSelectors === 'string'
                ? brokenSelectors
                : JSON.stringify(brokenSelectors, null, 2)
        );
    }

    sections.push(
        '',
        '## Test Cases',
        testCases || '(Generate tests based on exploration data)',
        '',
        '## Verified Exploration Data (ONLY use selectors from here)',
        typeof explorationData === 'string'
            ? explorationData
            : JSON.stringify(explorationData, null, 2),
    );

    if (frameworkInventory) {
        sections.push(
            '',
            '## Framework Inventory (REUSE these — never duplicate)',
            typeof frameworkInventory === 'string'
                ? frameworkInventory
                : JSON.stringify(frameworkInventory, null, 2)
        );
    }

    if (assertionConfig) {
        sections.push(
            '',
            '## Assertion Patterns',
            'Use these Playwright assertion patterns:',
            typeof assertionConfig === 'string'
                ? assertionConfig
                : JSON.stringify(assertionConfig, null, 2)
        );
    }

    sections.push(
        '',
        `## Output Target`,
        `Write the .spec.js file to: tests/specs/${ticketId.toLowerCase()}/${ticketId}.spec.js`,
        '',
        '## Instructions',
        '1. Write imports and setup first',
        '2. Write each test one at a time, validating selectors against exploration data',
        '3. Cross-reference framework inventory for reusable functions',
        '4. Output the complete file content + generation report JSON'
    );

    return sections.join('\n');
}

/**
 * Parse the Coder phase output to extract the generation report.
 *
 * @param {string} rawResponse - Raw LLM response
 * @returns {{ report: Object|null, scriptPath: string|null }}
 */
function parseCoderOutput(rawResponse) {
    let report = null;

    // Try to extract JSON generation report
    const reportMatch = rawResponse.match(/"generationReport"\s*:\s*\{[\s\S]*?\}/);
    if (reportMatch) {
        try {
            report = JSON.parse(`{${reportMatch[0]}}`).generationReport;
        } catch { /* ignore */ }
    }

    // Alternative: look for standalone JSON block
    if (!report) {
        const jsonBlocks = rawResponse.match(/```json\s*([\s\S]*?)```/g);
        if (jsonBlocks) {
            for (const block of jsonBlocks) {
                try {
                    const parsed = JSON.parse(block.replace(/```json\s*/, '').replace(/```/, ''));
                    if (parsed.generationReport) {
                        report = parsed.generationReport;
                        break;
                    }
                } catch { /* try next */ }
            }
        }
    }

    return { report };
}

/**
 * Validate that a generated script uses only exploration-verified selectors.
 *
 * @param {string} scriptContent - The .spec.js file content
 * @param {Object} explorationData - The explorer output
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateSelectorFidelity(scriptContent, explorationData) {
    const issues = [];

    if (!scriptContent || !explorationData) {
        return { valid: false, issues: ['Missing script or exploration data'] };
    }

    // Extract all selectors used in the script
    const selectorPatterns = [
        /getByRole\(['"]([^'"]+)['"],\s*\{\s*name:\s*['"]([^'"]+)['"]/g,
        /getByTestId\(['"]([^'"]+)['"]\)/g,
        /getByLabel\(['"]([^'"]+)['"]\)/g,
        /getByText\(['"]([^'"]+)['"]\)/g,
        /getByPlaceholder\(['"]([^'"]+)['"]\)/g,
        /locator\(['"]([^'"]+)['"]\)/g,
    ];

    const usedSelectors = new Set();
    for (const pattern of selectorPatterns) {
        let match;
        while ((match = pattern.exec(scriptContent)) !== null) {
            usedSelectors.add(match[0]);
        }
    }

    // Build set of explored selectors
    const exploredSelectors = new Set();
    const selectorMap = explorationData.selectorMap ||
        explorationData.cognitivePhase?.selectorMap || [];

    for (const mapping of selectorMap) {
        for (const elem of (mapping.elements || [])) {
            if (elem.selector) exploredSelectors.add(elem.selector);
            if (elem.name) exploredSelectors.add(elem.name);
        }
    }

    // Check for known anti-patterns
    if (/waitForTimeout\s*\(/.test(scriptContent)) {
        issues.push('ANTI-PATTERN: Uses waitForTimeout — use proper waits instead');
    }
    if (/page\.type\s*\(/.test(scriptContent)) {
        issues.push('ANTI-PATTERN: Uses deprecated page.type() — use page.fill()');
    }
    if (/expect\(await\s+.*\.(textContent|isVisible|isEnabled|isChecked)\(\)/.test(scriptContent)) {
        issues.push('ANTI-PATTERN: Non-retrying assertion — use auto-retrying expect(el).toBeVisible()');
    }

    // Check structural requirements
    if (!/test\.describe\.serial/.test(scriptContent)) {
        issues.push('STRUCTURE: Missing test.describe.serial() — required for shared browser state');
    }
    if (!/PopupHandler/.test(scriptContent)) {
        issues.push('STRUCTURE: Missing PopupHandler import');
    }
    if (!/launchBrowser/.test(scriptContent)) {
        issues.push('STRUCTURE: Missing launchBrowser import');
    }
    if (!/POmanager/.test(scriptContent)) {
        issues.push('STRUCTURE: Missing POmanager import');
    }

    return {
        valid: issues.filter(i => !i.startsWith('[WARN]')).length === 0,
        issues,
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    PHASE_NAME,
    buildCoderSystemPrompt,
    buildCoderUserPrompt,
    parseCoderOutput,
    validateSelectorFidelity,
};
