/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DRY-RUN VALIDATOR PHASE — Cognitive QA Loop Phase 5
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pre-execution selector verification — minimal MCP tools (~15).
 * Re-verifies that all selectors in the generated .spec.js still resolve
 * to real elements on the live page, catching selector staleness.
 *
 * Mimics how a QA engineer does a quick smoke check before running
 * the full test suite: "Can I still find all the buttons/inputs/links?"
 *
 * Inputs:
 *   - Generated .spec.js file content
 *   - MCP tools (selectors + state + navigation only — ~15 tools)
 *
 * Outputs:
 *   - Selector verification score (X/Y verified)
 *   - List of broken selectors with suggested alternatives
 *   - PROCEED (score >= 80%) or FIX_REQUIRED (score < 80%)
 *
 * Context window: ~4K tokens. Only ~15 MCP tools. Very focused.
 *
 * @module cognitive-phases/dryrun-phase
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PHASE_NAME = 'dryrun';

// ─── Selector Extraction ────────────────────────────────────────────────────

/**
 * Extract all Playwright selectors used in a script.
 *
 * @param {string} scriptContent - The .spec.js file content
 * @returns {Object[]} Array of { selector, type, line, context }
 */
function extractSelectors(scriptContent) {
    if (!scriptContent) return [];

    const selectors = [];
    const lines = scriptContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // getByRole('button', { name: 'Submit' })
        const roleMatch = line.match(/getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]/);
        if (roleMatch) {
            selectors.push({
                selector: `getByRole('${roleMatch[1]}', { name: '${roleMatch[2]}' })`,
                type: 'role',
                role: roleMatch[1],
                name: roleMatch[2],
                line: lineNum,
                context: line.trim(),
            });
        }

        // getByTestId('some-id')
        const testIdMatch = line.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
        if (testIdMatch) {
            selectors.push({
                selector: `getByTestId('${testIdMatch[1]}')`,
                type: 'testid',
                testId: testIdMatch[1],
                line: lineNum,
                context: line.trim(),
            });
        }

        // getByLabel('some label')
        const labelMatch = line.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
        if (labelMatch) {
            selectors.push({
                selector: `getByLabel('${labelMatch[1]}')`,
                type: 'label',
                label: labelMatch[1],
                line: lineNum,
                context: line.trim(),
            });
        }

        // getByText('some text')
        const textMatch = line.match(/getByText\(\s*['"]([^'"]+)['"]/);
        if (textMatch) {
            selectors.push({
                selector: `getByText('${textMatch[1]}')`,
                type: 'text',
                text: textMatch[1],
                line: lineNum,
                context: line.trim(),
            });
        }

        // getByPlaceholder('some placeholder')
        const placeholderMatch = line.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
        if (placeholderMatch) {
            selectors.push({
                selector: `getByPlaceholder('${placeholderMatch[1]}')`,
                type: 'placeholder',
                placeholder: placeholderMatch[1],
                line: lineNum,
                context: line.trim(),
            });
        }

        // locator('[aria-label="..."]') or locator('[data-testid="..."]')
        const locatorMatch = line.match(/locator\(\s*['"]([^'"]+)['"]/);
        if (locatorMatch && !roleMatch && !testIdMatch) {
            selectors.push({
                selector: `locator('${locatorMatch[1]}')`,
                type: 'css',
                css: locatorMatch[1],
                line: lineNum,
                context: line.trim(),
            });
        }
    }

    // Deduplicate by selector string
    const seen = new Set();
    return selectors.filter(s => {
        if (seen.has(s.selector)) return false;
        seen.add(s.selector);
        return true;
    });
}

/**
 * Extract all page URLs referenced in a script.
 *
 * @param {string} scriptContent
 * @returns {string[]} URLs found in the script
 */
function extractUrls(scriptContent) {
    if (!scriptContent) return [];

    const urls = [];

    // page.goto('url')
    const gotoMatches = scriptContent.matchAll(/page\.goto\(\s*[`'"](.*?)[`'"]/g);
    for (const m of gotoMatches) urls.push(m[1]);

    // navigate to URL in comments
    const navMatches = scriptContent.matchAll(/(?:url|baseUrl|navigate).*?[`'"](https?:\/\/[^`'"]+)[`'"]/gi);
    for (const m of navMatches) urls.push(m[1]);

    // Template literal URLs with userTokens
    const templateMatches = scriptContent.matchAll(/`(\$\{.*?(?:baseUrl|userTokens).*?\}[^`]*)`/g);
    for (const m of templateMatches) urls.push(m[1]);

    return [...new Set(urls)];
}

// ─── Dry-Run Phase Prompt Template ──────────────────────────────────────────

/**
 * Build the system prompt for the DryRun Validator phase.
 */
function buildDryRunSystemPrompt() {
    return `You are the DRY-RUN VALIDATOR — Phase 5 of the Cognitive QA Loop.

## Your Role
You are a QA engineer doing a quick smoke check before running the full test suite.
Your job is to verify that ALL selectors in the generated script still resolve to
real elements on the live page.

## Process
1. Navigate to each page referenced in the script
2. For EACH unique selector in the script:
   a. Try to find the element using the corresponding MCP tool
   b. If found: record as VERIFIED
   c. If NOT found: try alternative selectors and record as BROKEN with suggestion
3. Report the verification score

## MCP Tools to Use
- unified_navigate: Go to each page
- unified_get_by_role: Verify role+name selectors
- unified_get_by_test_id: Verify data-testid selectors
- unified_get_by_label: Verify label selectors
- unified_get_by_text: Verify text selectors
- unified_is_visible: Confirm element is visible
- unified_is_enabled: Confirm element is interactable
- unified_snapshot: Re-discover elements if selector fails

## Output Format
After verifying ALL selectors, output:

{
  "dryRunComplete": true,
  "score": 87.5,
  "totalSelectors": 16,
  "verified": 14,
  "broken": 2,
  "verdict": "PROCEED" | "FIX_REQUIRED",
  "selectors": [
    {
      "selector": "getByRole('button', { name: 'Apply Filters' })",
      "line": 42,
      "status": "verified" | "broken",
      "visible": true,
      "enabled": true
    },
    {
      "selector": "getByTestId('price-range')",
      "line": 58,
      "status": "broken",
      "reason": "element not found on page",
      "suggestion": "getByRole('slider', { name: 'Price Range' })"
    }
  ]
}

## Decision Rules
- PROCEED if score >= 80% (most selectors work, minor issues can be caught at runtime)
- FIX_REQUIRED if score < 80% (too many broken selectors, script will likely fail)`;
}

/**
 * Build the user prompt for the DryRun phase.
 *
 * @param {Object} options
 * @param {string} options.scriptContent - The .spec.js file  content
 * @param {Object[]} options.selectors - Extracted selectors (from extractSelectors)
 * @param {string[]} options.urls - Extracted URLs (from extractUrls)
 * @param {string} [options.appUrl] - Fallback application URL
 * @returns {string}
 */
function buildDryRunUserPrompt(options) {
    const {
        scriptContent,
        selectors,
        urls,
        appUrl,
    } = options;

    const sections = [
        '## Dry-Run Selector Verification',
        '',
        `## Selectors to Verify (${selectors.length} unique selectors)`,
    ];

    for (const sel of selectors) {
        sections.push(`- Line ${sel.line}: \`${sel.selector}\` (${sel.type})`);
    }

    sections.push(
        '',
        '## Pages to Visit',
    );

    const allUrls = urls.length > 0 ? urls : (appUrl ? [appUrl] : []);
    for (const url of allUrls) {
        sections.push(`- ${url}`);
    }

    if (allUrls.length === 0) {
        sections.push('- (extract URLs from the script or use the default application URL)');
    }

    sections.push(
        '',
        '## Script Content (for reference)',
        '```javascript',
        scriptContent,
        '```',
        '',
        '## Instructions',
        '1. Navigate to each page listed above',
        '2. For each selector, use the appropriate MCP tool to verify it exists',
        '3. Check visibility and enabled state',
        '4. If a selector is broken, try to find an alternative',
        '5. Output the verification report as JSON'
    );

    return sections.join('\n');
}

/**
 * Parse the DryRun phase output.
 *
 * @param {string} rawResponse
 * @returns {{ verdict: string, score: number, broken: Object[], raw: Object|null }}
 */
function parseDryRunOutput(rawResponse) {
    let report = null;

    let jsonStr = rawResponse.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
    }

    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    try {
        report = JSON.parse(jsonStr);
    } catch {
        return {
            verdict: 'UNKNOWN',
            score: 0,
            broken: [],
            raw: null,
        };
    }

    const broken = (report.selectors || []).filter(s => s.status === 'broken');

    return {
        verdict: report.verdict || (report.score >= 80 ? 'PROCEED' : 'FIX_REQUIRED'),
        score: report.score || 0,
        verified: report.verified || 0,
        totalSelectors: report.totalSelectors || 0,
        broken,
        raw: report,
    };
}

/**
 * Build broken selector fix instructions for the Coder.
 *
 * @param {Object[]} brokenSelectors
 * @returns {string}
 */
function buildBrokenSelectorFixes(brokenSelectors) {
    if (!brokenSelectors || brokenSelectors.length === 0) return '';

    const lines = [
        '## Broken Selectors — Fix Required',
        `${brokenSelectors.length} selector(s) failed dry-run verification:`,
        '',
    ];

    for (const sel of brokenSelectors) {
        lines.push(`### Line ${sel.line || '?'}: \`${sel.selector}\``);
        lines.push(`- Status: BROKEN`);
        lines.push(`- Reason: ${sel.reason || 'Element not found on page'}`);
        if (sel.suggestion) {
            lines.push(`- Suggested replacement: \`${sel.suggestion}\``);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    PHASE_NAME,
    extractSelectors,
    extractUrls,
    buildDryRunSystemPrompt,
    buildDryRunUserPrompt,
    parseDryRunOutput,
    buildBrokenSelectorFixes,
};
