/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REVIEWER PHASE — Cognitive QA Loop Phase 4
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pre-execution quality gate — NO MCP tools, NO file writes.
 * Reviews the generated script BEFORE execution, not after.
 *
 * Mimics how a senior engineer reviews a pull request:
 *   1. Check selector fidelity against exploration data
 *   2. Verify test coverage matches test cases
 *   3. Check assertion quality (meaningful, not trivial)
 *   4. Verify wait strategies (no hardcoded waits)
 *   5. Check framework compliance (imports, patterns)
 *   6. Check for code duplication (should use business functions)
 *
 * Inputs:
 *   - Generated .spec.js content
 *   - Exploration data (to verify selector accuracy)
 *   - Test cases (to verify coverage completeness)
 *   - Framework inventory (to verify reuse)
 *
 * Outputs:
 *   - PASS (proceed to dry-run) or FAIL with specific fixes
 *
 * Context window: ~8K tokens. No MCP tools. Pure review focus.
 *
 * @module cognitive-phases/reviewer-phase
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PHASE_NAME = 'reviewer';

// ─── Reviewer Phase Prompt Template ─────────────────────────────────────────

/**
 * Build the system prompt for the Reviewer phase.
 */
function buildReviewerSystemPrompt() {
    return `You are the REVIEWER — Phase 4 of the Cognitive QA Loop.

## Your Role
You are a senior test automation architect reviewing a generated Playwright script
BEFORE it is executed. You have the exploration data (real selectors from the browser)
and the test cases. Your review determines whether the script is ready for execution.

## Review Checklist (check EVERY item)

### 1. Selector Fidelity (CRITICAL)
- Does EVERY selector in the script have a corresponding entry in the exploration data?
- Are selectors using the correct type (role, testid, label, text)?
- Are there any hardcoded/guessed selectors not from exploration?
- Flag: "SELECTOR_MISMATCH: line X uses selector Y but exploration has Z"

### 2. Coverage Completeness (HIGH)
- Does every test step from the test cases have a corresponding test block?
- Are any test cases missing or skipped without explanation?
- Flag: "COVERAGE_GAP: test step 1.3 has no corresponding test"

### 3. Assertion Quality (HIGH)
- Does every test have at least one MEANINGFUL assertion?
- No trivial assertions like expect(true).toBe(true) or expect(x || true).toBeTruthy()
- Uses auto-retrying assertions: expect(el).toBeVisible() NOT expect(await el.isVisible())
- Flag: "WEAK_ASSERTION: test 'X' assertion on line Y is trivial/non-retrying"

### 4. Wait Strategy (MEDIUM)
- No page.waitForTimeout() calls
- Proper waits before interactions: waitForLoadState, toBeVisible, waitForSelector
- Flag: "BAD_WAIT: line X uses waitForTimeout — replace with [specific alternative]"

### 5. Framework Compliance (CRITICAL)
- Correct imports: launchBrowser, POmanager (default), PopupHandler, userTokens
- Correct paths: ../../config/config, ../../pageobjects/POmanager, etc.
- Uses test.describe.serial() for shared browser state
- afterAll closes page + context + browser with null/closed guards
- Uses PopupHandler — no inline popup dismiss code
- Flag: "FRAMEWORK_VIOLATION: [specific issue]"

### 6. Code Quality (MEDIUM)
- No duplicate code blocks (should extract to helpers)
- Script length under 300 lines (warn) / 400 lines (critical)
- Meaningful test names (not "test 1", "test 2")
- Comments reference test step IDs
- No deprecated page.type() — use page.fill()
- Flag: "QUALITY: [specific issue]"

### 7. Flow Coherence (MEDIUM)
- Tests follow a logical user flow, not random page jumps
- Navigation between tests makes sense
- Shared state (login, page objects) handled correctly
- Flag: "FLOW: [specific issue]"

## Output Format
Respond with a JSON verdict:

{
  "verdict": "PASS" | "FAIL",
  "confidence": 85,
  "summary": "One sentence overall assessment",
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "selector|coverage|assertion|wait|framework|quality|flow",
      "line": 42,
      "issue": "Description of the problem",
      "fix": "Specific fix instruction for the Coder"
    }
  ],
  "passedChecks": [
    "Selector fidelity: 12/12 selectors verified",
    "Framework compliance: all imports correct",
    "No waitForTimeout usage"
  ],
  "metrics": {
    "totalSelectorsUsed": 12,
    "selectorsVerifiedInExploration": 12,
    "testCaseCoverage": "4/4",
    "assertionsCount": 8,
    "meaningfulAssertions": 7,
    "scriptLines": 185,
    "helperFunctions": 1
  }
}

## Decision Rules
- PASS if: zero critical issues AND zero high issues AND confidence >= 70
- FAIL if: ANY critical issue OR 2+ high issues OR confidence < 70
- When FAIL: provide specific, actionable fixes for the Coder to apply`;
}

/**
 * Build the user prompt for the Reviewer phase.
 *
 * @param {Object} options
 * @param {string} options.ticketId
 * @param {string} options.scriptContent - The generated .spec.js content
 * @param {Object} options.explorationData - From Explorer phase
 * @param {string} options.testCases - Test cases text
 * @param {Object} [options.frameworkInventory] - Available reusable code
 * @returns {string}
 */
function buildReviewerUserPrompt(options) {
    const {
        ticketId,
        scriptContent,
        explorationData,
        testCases,
        frameworkInventory,
    } = options;

    const sections = [
        `## Review Script: ${ticketId}`,
        '',
        '## Generated Script (review this)',
        '```javascript',
        scriptContent,
        '```',
        '',
        '## Exploration Data (selectors MUST come from here)',
        typeof explorationData === 'string'
            ? explorationData
            : JSON.stringify(explorationData, null, 2),
        '',
        '## Test Cases (verify coverage against these)',
        testCases || '(No test cases provided)',
    ];

    if (frameworkInventory) {
        sections.push(
            '',
            '## Framework Inventory (check script reuses these)',
            typeof frameworkInventory === 'string'
                ? frameworkInventory
                : JSON.stringify(frameworkInventory, null, 2)
        );
    }

    sections.push(
        '',
        '## Instructions',
        'Review the script against ALL 7 checklist categories.',
        'Output your verdict as JSON.',
        'Be strict — this script will be executed against a real browser.'
    );

    return sections.join('\n');
}

/**
 * Parse the Reviewer phase output.
 *
 * @param {string} rawResponse
 * @returns {{ verdict: string, issues: Object[], confidence: number, raw: Object|null }}
 */
function parseReviewerOutput(rawResponse) {
    let review = null;

    // Extract JSON from response
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
        review = JSON.parse(jsonStr);
    } catch {
        // Try to determine verdict from text
        const hasPass = /\bPASS\b/i.test(rawResponse);
        const hasFail = /\bFAIL\b/i.test(rawResponse);
        return {
            verdict: hasFail ? 'FAIL' : (hasPass ? 'PASS' : 'UNKNOWN'),
            issues: [],
            confidence: 0,
            raw: null,
        };
    }

    return {
        verdict: review.verdict || 'UNKNOWN',
        issues: review.issues || [],
        confidence: review.confidence || 0,
        passedChecks: review.passedChecks || [],
        metrics: review.metrics || {},
        raw: review,
    };
}

/**
 * Build a concise fix instruction for the Coder from reviewer issues.
 *
 * @param {Object[]} issues - From reviewer output
 * @returns {string} Fix instructions
 */
function buildFixInstructions(issues) {
    if (!issues || issues.length === 0) return '';

    const criticals = issues.filter(i => i.severity === 'critical');
    const highs = issues.filter(i => i.severity === 'high');
    const mediums = issues.filter(i => i.severity === 'medium');

    const lines = ['## Reviewer Fixes Required'];

    if (criticals.length > 0) {
        lines.push('', '### CRITICAL (must fix)');
        for (const issue of criticals) {
            lines.push(`- Line ${issue.line || '?'}: ${issue.issue}`);
            if (issue.fix) lines.push(`  FIX: ${issue.fix}`);
        }
    }

    if (highs.length > 0) {
        lines.push('', '### HIGH (should fix)');
        for (const issue of highs) {
            lines.push(`- Line ${issue.line || '?'}: ${issue.issue}`);
            if (issue.fix) lines.push(`  FIX: ${issue.fix}`);
        }
    }

    if (mediums.length > 0) {
        lines.push('', '### MEDIUM (recommended)');
        for (const issue of mediums) {
            lines.push(`- Line ${issue.line || '?'}: ${issue.issue}`);
            if (issue.fix) lines.push(`  FIX: ${issue.fix}`);
        }
    }

    return lines.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    PHASE_NAME,
    buildReviewerSystemPrompt,
    buildReviewerUserPrompt,
    parseReviewerOutput,
    buildFixInstructions,
};
