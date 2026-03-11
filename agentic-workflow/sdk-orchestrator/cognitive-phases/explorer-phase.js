/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPLORER PHASE — Cognitive QA Loop Phase 2
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Plan-guided MCP exploration — follows the Analyst's Exploration Plan
 * step-by-step instead of making ad-hoc decisions.
 *
 * Mimics how a human QA systematically walks through each page of the
 * application, checking every element mentioned in the test cases,
 * before writing a single line of code.
 *
 * Inputs:
 *   - Exploration Plan (from Analyst phase)
 *   - Grounding selector recommendations
 *   - MCP tools (navigation + snapshot + selector + state — ~35 tools)
 *
 * Outputs:
 *   - Enriched exploration data with per-test-step selector map
 *   - Verified/unverified element status for each planned element
 *   - Page transition graph (actual, not planned)
 *   - State-dependent observations (spinners, popups, dynamic content)
 *   - Interaction results (what happened when clicking/typing)
 *
 * Context window: ~8K tokens (focused prompt + plan). Only ~35 MCP tools.
 *
 * @module cognitive-phases/explorer-phase
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PHASE_NAME = 'explorer';

// ─── Explorer Phase Prompt Template ─────────────────────────────────────────

/**
 * Build the system prompt for the Explorer phase.
 * Focused on MCP exploration — no code generation burden.
 */
function buildExplorerSystemPrompt() {
    return `You are the EXPLORER — Phase 2 of the Cognitive QA Loop.

## Your Role
You are a meticulous QA engineer who has received an Exploration Plan.
Your job is to SYSTEMATICALLY walk through the application using MCP browser tools,
following the plan step-by-step, verifying every element, and recording what you find.

You do NOT write any code. You only explore and report.

## How to Think (ReAct Pattern — MANDATORY)
For EVERY MCP tool call, follow this pattern:
1. THOUGHT: "I need to [purpose]. According to the plan, step [X] requires [tool]."
2. ACTION: Call the MCP tool
3. OBSERVATION: Examine the result
4. REFLECTION: "Did I find what I expected? If not, what should I try next?"

## Exploration Rules
1. ALWAYS start by navigating to the application URL
2. After EVERY navigation or interaction that changes the page:
   a. Call unified_snapshot WITH a filter to reduce noise and speed up exploration:
      - Use \`{ "filter": { "interactiveOnly": true } }\` for form/action pages
      - Use \`{ "filter": { "roles": ["button", "link", "textbox", "combobox"] } }\` when looking for specific element types
      - Use \`{ "filter": { "namePattern": "search|filter|apply" } }\` when looking for elements by name
      - Use an UNFILTERED snapshot (no filter param) for the FIRST snapshot on a new page to get full context
   b. Check if the page is fully loaded (no loading spinners in snapshot)
   c. If spinners/loaders detected, call unified_wait_for_element for the actual content
3. For EACH element in the plan's expectedElements:
   a. Try to find it with unified_get_by_role or unified_get_by_test_id FIRST (most stable)
   b. If not found, try unified_get_by_label or unified_get_by_text
   c. If still not found, record it as MISSING with the attempted selectors
4. For EACH assertion target in the plan:
   a. Extract the actual value using unified_get_text_content or unified_get_attribute
   b. Record the extracted value for the Coder phase
5. For interactions (clicks, types, form fills):
   a. VERIFY the element is visible and enabled BEFORE interacting
   b. Interact with the element
   c. WAIT for the page to settle (use unified_wait_for_element or unified_wait_for)
   d. RE-SNAPSHOT the page to capture the new state
6. Track every popup, modal, or overlay encountered
7. Track every page URL change

## Tree-of-Thought Selector Resolution (MANDATORY — Top-3 Candidates)
For EVERY critical element (buttons, inputs, links, assertions), you MUST capture **multiple selector candidates** ranked by stability. This prevents expensive self-healing later.

### Process for Each Element:
1. **Primary selector** — Try the most stable selector type first:
   - unified_get_by_test_id → stability: 10 (best)
   - unified_get_by_role with name → stability: 9
2. **Secondary selector** — Try the next-best type:
   - unified_get_by_label → stability: 6
   - unified_get_by_text → stability: 4
3. **Tertiary selector** — Try a fallback:
   - unified_get_by_placeholder → stability: 6
   - CSS locator with aria-label → stability: 7

### Record ALL found selectors in the selectorCandidates array:
For each element, report:
\`\`\`json
{
  "description": "Apply Filters button",
  "found": true,
  "selector": "getByRole('button', { name: 'Apply Filters' })",
  "selectorType": "role",
  "stabilityScore": 9,
  "selectorCandidates": [
    { "selector": "getByRole('button', { name: 'Apply Filters' })", "type": "role", "stability": 9, "verified": true },
    { "selector": "getByText('Apply Filters')", "type": "text", "stability": 4, "verified": true },
    { "selector": "locator('[data-qa=apply-filters]')", "type": "data-testid", "stability": 10, "verified": true }
  ]
}
\`\`\`

### Selection Logic:
- The **primary selector** (highest stability score) goes into the "selector" field
- ALL candidates go into "selectorCandidates" for the Coder to use as fallbacks
- If an element has only 1 candidate, that's acceptable but flag it as "singleSelector: true"
- This gives the Coder fallback options and reduces self-healing invocations by 30-50%

## What You Do NOT Do
- Do NOT write any .spec.js files
- Do NOT generate code
- Do NOT make up selectors — only report what MCP tools actually return
- Do NOT skip plan steps unless the page state makes them impossible

## Output Format
After completing ALL exploration steps, report your findings as JSON:

{
  "explorationComplete": true,
  "pagesVisited": [
    {
      "url": "actual URL",
      "title": "page title",
      "snapshotElementCount": 42,
      "exploredAt": "timestamp"
    }
  ],
  "selectorMap": [
    {
      "testStepId": "1.1",
      "elements": [
        {
          "description": "what this element is",
          "found": true,
          "selector": "the Playwright selector that works (highest stability)",
          "selectorType": "role|testid|label|text|css",
          "stabilityScore": 9,
          "role": "button",
          "name": "accessible name from snapshot",
          "verified": true,
          "state": { "visible": true, "enabled": true },
          "textContent": "extracted text if relevant",
          "attributes": { "key": "value" },
          "selectorCandidates": [
            { "selector": "primary selector", "type": "role", "stability": 9, "verified": true },
            { "selector": "secondary selector", "type": "text", "stability": 4, "verified": true },
            { "selector": "tertiary selector", "type": "css", "stability": 3, "verified": false }
          ],
          "singleSelector": false
        }
      ],
      "assertionValues": [
        {
          "target": "what is being asserted",
          "actualValue": "value extracted from page",
          "extractionMethod": "get_text_content|get_attribute|get_page_url"
        }
      ],
      "planCompleteness": "complete|partial|blocked",
      "blockedReason": null
    }
  ],
  "pageTransitions": [
    {
      "from": "source URL pattern",
      "to": "destination URL pattern",
      "trigger": "what caused the transition (click button X)",
      "verified": true
    }
  ],
  "popupsEncountered": [
    {
      "type": "welcome|branding|tour|compare|off-limits|other",
      "selector": "how to dismiss it",
      "handling": "dismissed|blocked|ignored",
      "affectsSteps": ["1.1"]
    }
  ],
  "riskObservations": [
    {
      "observation": "what was observed",
      "severity": "high|medium|low",
      "recommendation": "how the Coder should handle this"
    }
  ],
  "statistics": {
    "totalElementsPlanned": 15,
    "totalElementsFound": 13,
    "totalElementsMissing": 2,
    "totalInteractions": 8,
    "totalSnapshots": 4,
    "coveragePercent": 86.7
  }
}`;
}

/**
 * Build the user prompt for the Explorer phase.
 *
 * @param {Object} options
 * @param {string} options.ticketId
 * @param {Object} options.explorationPlan - From Analyst phase
 * @param {string} [options.appUrl] - Application base URL
 * @param {Object} [options.selectorRecommendations] - From grounding
 * @param {string[]} [options.knownPopups] - Known popup types for this app
 * @returns {string}
 */
function buildExplorerUserPrompt(options) {
    const {
        ticketId,
        explorationPlan,
        appUrl,
        selectorRecommendations,
        knownPopups,
    } = options;

    const sections = [
        `## Exploration Mission: ${ticketId}`,
        '',
        '## Exploration Plan (from Analyst Phase — follow this EXACTLY)',
        typeof explorationPlan === 'string'
            ? explorationPlan
            : JSON.stringify(explorationPlan, null, 2),
    ];

    if (appUrl) {
        sections.push('', `## Starting URL`, appUrl);
    }

    if (selectorRecommendations) {
        sections.push(
            '',
            '## Known Selectors (from previous explorations / page objects)',
            'Use these as HINTS — always verify with MCP tools before trusting:',
            typeof selectorRecommendations === 'string'
                ? selectorRecommendations
                : JSON.stringify(selectorRecommendations, null, 2)
        );
    }

    if (knownPopups && knownPopups.length > 0) {
        sections.push(
            '',
            '## Known Popups to Watch For',
            'These popups have been seen on this application. Dismiss them if they appear:',
            knownPopups.map(p => `- ${p}`).join('\n')
        );
    }

    sections.push(
        '',
        '## Batch Exploration (Efficiency Optimization)',
        'When you need to perform multiple tool calls in sequence (e.g., navigate + snapshot + extract),',
        'use `unified_execute_exploration` to batch them in a SINGLE round-trip:',
        '',
        '### Using Templates (Preferred)',
        '```json',
        '{ "templateName": "explore_page", "templateArgs": { "url": "https://...", "filter": { "interactiveOnly": true } } }',
        '```',
        'Available templates:',
        '- `explore_page` — Navigate + snapshot + URL/title (args: url, filter?, waitForSelector?)',
        '- `verify_elements` — Check visibility/enabled/text for multiple selectors (args: selectors[])',
        '- `login_and_navigate` — Auth URL + wait + snapshot (args: url, waitForSelector?, filter?)',
        '- `extract_content` — Extract text/attributes from multiple elements (args: targets[])',
        '- `interact_and_verify` — Click/type/select then verify page state (args: action, verifySelectors?, verifyUrl?)',
        '',
        '### Using Raw Scripts (Advanced)',
        '```json',
        '{ "script": "const snap = await tools.snapshot({ filter: { interactiveOnly: true } });\\nconst url = await tools.get_page_url();\\nreturn { snap, url };" }',
        '```',
        'Use templates for standard patterns. Use raw scripts only for custom exploration logic.',
        '',
        '### When to Batch vs Individual Calls',
        '- **Batch**: Initial page exploration, multi-element verification, content extraction',
        '- **Individual**: Complex interactions needing per-step reasoning, error recovery, dynamic decisions',
    );

    sections.push(
        '',
        '## Instructions',
        '1. Navigate to the starting URL (use `explore_page` template for initial exploration)',
        '2. Follow the Exploration Plan step by step',
        '3. For each test step: find elements → verify states → extract content → interact if needed → re-snapshot',
        '4. Use `verify_elements` template when checking multiple selectors at once',
        '5. After completing ALL steps, output the JSON exploration report',
        '',
        'THINK before each action. VERIFY after each action. RECORD everything.'
    );

    return sections.join('\n');
}

/**
 * Parse and validate the Explorer phase output.
 *
 * @param {string} rawResponse - Raw LLM response
 * @returns {{ valid: boolean, exploration: Object|null, errors: string[] }}
 */
function parseExplorerOutput(rawResponse) {
    const errors = [];

    // Try to extract JSON from the response
    let jsonStr = rawResponse.trim();

    // Check for JSON in markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
    }

    // Find JSON object boundaries
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let exploration;
    try {
        exploration = JSON.parse(jsonStr);
    } catch (e) {
        // Explorer may have done all exploration via MCP tools but not produced final JSON
        // In this case, we need to reconstruct from the conversation
        return {
            valid: false,
            exploration: null,
            errors: [`Failed to parse exploration JSON: ${e.message}. Explorer may need to output summary.`]
        };
    }

    // Validate required fields
    if (!exploration.selectorMap || !Array.isArray(exploration.selectorMap)) {
        errors.push('Missing or invalid "selectorMap" array');
    } else {
        for (let i = 0; i < exploration.selectorMap.length; i++) {
            const entry = exploration.selectorMap[i];
            if (!entry.testStepId) errors.push(`selectorMap[${i}]: missing testStepId`);
            if (!entry.elements || entry.elements.length === 0) {
                errors.push(`selectorMap[${i}] (${entry.testStepId}): no elements found`);
            }
        }
    }

    if (!exploration.pagesVisited || exploration.pagesVisited.length === 0) {
        errors.push('No pages were visited during exploration');
    }

    if (!exploration.statistics) {
        errors.push('[WARN] No statistics provided — coverage tracking unavailable');
    }

    return {
        valid: errors.filter(e => !e.startsWith('[WARN]')).length === 0,
        exploration,
        errors,
    };
}

/**
 * Score the exploration quality.
 *
 * @param {Object} exploration - Parsed explorer output
 * @param {Object} plan - Original analyst plan
 * @returns {{ score: number, breakdown: Object }}
 */
function scoreExploration(exploration, plan) {
    if (!exploration) return { score: 0, breakdown: {} };

    const breakdown = {};

    // Element coverage: found / planned
    const stats = exploration.statistics || {};
    const planned = stats.totalElementsPlanned || (plan?.testCaseMapping?.length || 0);
    const found = stats.totalElementsFound || 0;
    breakdown.elementCoverage = planned > 0 ? Math.round((found / planned) * 100) : 0;

    // Pages visited vs planned
    const plannedPages = Object.keys(plan?.pageTransitionGraph || {}).length || 1;
    const visitedPages = (exploration.pagesVisited || []).length;
    breakdown.pageCoverage = Math.round(Math.min(1, visitedPages / Math.max(1, plannedPages)) * 100);

    // Selector quality: how many have verified=true
    const allElements = (exploration.selectorMap || []).flatMap(m => m.elements || []);
    const verified = allElements.filter(e => e.verified).length;
    breakdown.selectorVerification = allElements.length > 0
        ? Math.round((verified / allElements.length) * 100)
        : 0;

    // Plan completeness: how many test steps are "complete" vs "partial" or "blocked"
    const completeSteps = (exploration.selectorMap || []).filter(
        m => m.planCompleteness === 'complete'
    ).length;
    const totalMappings = (exploration.selectorMap || []).length;
    breakdown.planAdherence = totalMappings > 0
        ? Math.round((completeSteps / totalMappings) * 100)
        : 0;

    // Snapshot count (more snapshots = more thorough)
    const snapshotCount = stats.totalSnapshots || 0;
    breakdown.snapshotDepth = Math.min(100, snapshotCount * 15);

    // ToT: Selector candidate diversity — reward elements with multiple candidates
    const elementsWithCandidates = allElements.filter(
        e => e.selectorCandidates && e.selectorCandidates.length >= 2
    ).length;
    breakdown.selectorDiversity = allElements.length > 0
        ? Math.round((elementsWithCandidates / allElements.length) * 100)
        : 0;

    // ToT: Average stability score across primary selectors
    const stabilityScores = allElements
        .filter(e => e.stabilityScore != null)
        .map(e => e.stabilityScore);
    breakdown.avgStabilityScore = stabilityScores.length > 0
        ? Math.round((stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length) * 10)
        : 0;

    // Weighted total (updated to include ToT metrics)
    const score = Math.round(
        breakdown.elementCoverage * 0.25 +
        breakdown.pageCoverage * 0.15 +
        breakdown.selectorVerification * 0.20 +
        breakdown.planAdherence * 0.10 +
        breakdown.snapshotDepth * 0.10 +
        breakdown.selectorDiversity * 0.10 +   // ToT bonus
        breakdown.avgStabilityScore * 0.10      // ToT bonus
    );

    return { score: Math.min(100, score), breakdown };
}

/**
 * Convert exploration output into the standard exploration-data format
 * expected by the existing quality gates and enforcement hooks.
 *
 * @param {Object} exploration - Parsed explorer output
 * @param {string} ticketId
 * @returns {Object} Standard exploration data JSON
 */
function toStandardExplorationData(exploration, ticketId) {
    if (!exploration) return null;

    const allElements = (exploration.selectorMap || []).flatMap(m =>
        (m.elements || []).filter(e => e.found).map(e => ({
            ref: e.selector || e.name,
            role: e.role || 'unknown',
            name: e.name || e.description || '',
            dataQa: e.attributes?.['data-qa'] || e.attributes?.['data-testid'] || undefined,
            selectorType: e.selectorType,
            stabilityScore: e.stabilityScore || null,
            verified: e.verified,
            // ToT: carry selector candidates for fallback options
            selectorCandidates: e.selectorCandidates || [],
            singleSelector: e.singleSelector || (e.selectorCandidates?.length || 0) <= 1,
        }))
    );

    const snapshots = (exploration.pagesVisited || []).map(page => ({
        url: page.url,
        pageTitle: page.title,
        elements: allElements.filter(e =>
            // Rough association — elements from the first visit
            true // All elements for now; refined in future
        ),
    }));

    return {
        source: 'mcp-live-snapshot',
        ticketId,
        timestamp: new Date().toISOString(),
        generatedBy: 'cognitive-explorer-phase',
        snapshots,
        selectorCount: allElements.length,
        pagesVisited: (exploration.pagesVisited || []).map(p => p.url),
        popupsDetected: (exploration.popupsEncountered || []).map(p => ({
            type: p.type,
            selector: p.selector,
            handledBy: p.handling === 'dismissed' ? 'PopupHandler' : 'manual',
        })),
        deepExploration: {
            semanticSelectors: allElements.filter(e => ['role', 'testid', 'label'].includes(e.selectorType)),
            extractedContent: (exploration.selectorMap || []).flatMap(m =>
                (m.assertionValues || []).map(a => ({
                    target: a.target,
                    value: a.actualValue,
                    method: a.extractionMethod,
                }))
            ),
            verifiedUrls: (exploration.pagesVisited || []).map(p => p.url),
        },
        cognitivePhase: {
            selectorMap: exploration.selectorMap,
            pageTransitions: exploration.pageTransitions,
            riskObservations: exploration.riskObservations,
            statistics: exploration.statistics,
        },
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    PHASE_NAME,
    buildExplorerSystemPrompt,
    buildExplorerUserPrompt,
    parseExplorerOutput,
    scoreExploration,
    toStandardExplorationData,
};
