/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYST PHASE — Cognitive QA Loop Phase 1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pure reasoning phase — NO MCP tools, NO file writes.
 * 
 * Mimics how a human QA reads the test cases, understands the feature,
 * and creates a systematic exploration plan BEFORE touching the browser.
 *
 * Inputs:
 *   - Test cases (from TestGenie Excel/markdown)
 *   - Feature map (from grounding config)
 *   - Historical failure data
 *   - Domain terminology
 *
 * Outputs:
 *   - Structured Exploration Plan (JSON) mapping each test step → MCP actions
 *   - Page transition graph (expected navigation flow)
 *   - Risk areas (popups, dynamic content, auth requirements)
 *
 * Context window: ~5K tokens (small prompt + test cases). Razor-focused.
 *
 * @module cognitive-phases/analyst-phase
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PHASE_NAME = 'analyst';

// ─── Analyst Phase Prompt Template ──────────────────────────────────────────

/**
 * Build the system prompt for the Analyst phase.
 * Intentionally minimal — no MCP tool docs, no code examples.
 */
function buildAnalystSystemPrompt() {
    return `You are the ANALYST — Phase 1 of the Cognitive QA Loop.

## Your Role
You are a senior QA engineer who has just received test cases for a feature.
Your job is to READ, THINK, and PLAN — not to test or write code.

## What You Must Produce
A structured JSON **Exploration Plan** that maps every test step to specific browser exploration actions.

## How to Think (Chain of Thought — MANDATORY)
Before producing the plan, reason through these questions IN ORDER:
1. What is the user flow being tested? (Read ALL test cases end-to-end)
2. What distinct pages/screens will the user visit?
3. For each page: what UI elements must exist? (buttons, inputs, dropdowns, text)
4. What state changes happen between pages? (URL changes, new elements appearing)
5. What could go wrong? (popups, loading spinners, authentication walls, dynamic content)
6. What assertions will the tests need? (text values, URLs, element states)

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):

{
  "reasoning": "Your chain-of-thought reasoning (2-5 sentences summarizing the flow)",
  "testCaseMapping": [
    {
      "testStepId": "1.1",
      "action": "Description of the user action from the test case",
      "requiredPages": ["page-name"],
      "explorationSteps": [
        {
          "tool": "navigate|snapshot|get_by_role|get_by_test_id|get_by_label|get_by_text|get_text_content|get_attribute|is_visible|click|type|fill_form|select_option|wait_for_element|get_page_url|expect_url|expect_element_text|press_key|scroll_into_view",
          "args": { "key": "value" },
          "purpose": "Why this step is needed"
        }
      ],
      "expectedElements": ["element-description-1", "element-description-2"],
      "assertionTargets": ["what to assert after this step"]
    }
  ],
  "pageTransitionGraph": {
    "page-name-1": {
      "navigatesTo": ["page-name-2"],
      "via": "description of what user clicks/does to navigate",
      "expectedUrlPattern": "/partial-url-pattern"
    }
  },
  "prerequisites": ["login required", "specific data needed", "etc"],
  "riskAreas": [
    {
      "risk": "Description of potential issue",
      "mitigation": "How the Explorer should handle it",
      "affectsSteps": ["1.1", "1.2"]
    }
  ],
  "estimatedExplorationDepth": {
    "totalPages": 2,
    "totalElements": 15,
    "totalInteractions": 8,
    "totalAssertions": 5
  }
}

## Rules
- Every test step MUST have at least one exploration step
- Every exploration step MUST have a "purpose" explaining WHY
- Navigate + snapshot is ALWAYS the first action on any new page
- After any click/type/interaction that changes the page, add a snapshot step
- Include wait_for_element steps before interacting with elements that may load async
- Include get_text_content / get_attribute steps for every assertion target
- The plan should be EXHAUSTIVE — better to over-plan than under-plan`;
}

/**
 * Build the user prompt for the Analyst phase.
 *
 * @param {Object} options
 * @param {string} options.ticketId - Jira ticket ID
 * @param {string} options.testCases - Test cases text (markdown table or summary)
 * @param {Object} [options.featureMap] - Feature map from grounding config
 * @param {string} [options.historicalContext] - Past failures for this feature
 * @param {string} [options.domainTerms] - Domain terminology reference
 * @param {string} [options.appUrl] - Base application URL
 * @returns {string}
 */
function buildAnalystUserPrompt(options) {
    const {
        ticketId,
        testCases,
        featureMap,
        historicalContext,
        domainTerms,
        appUrl,
    } = options;

    const sections = [
        `## Ticket: ${ticketId}`,
        '',
        '## Test Cases to Analyze',
        testCases || '(No test cases provided — create exploration plan based on ticket context)',
    ];

    if (appUrl) {
        sections.push('', `## Application URL`, appUrl);
    }

    if (featureMap) {
        sections.push(
            '',
            '## Feature Map (known pages and components for this feature)',
            typeof featureMap === 'string' ? featureMap : JSON.stringify(featureMap, null, 2)
        );
    }

    if (historicalContext) {
        sections.push(
            '',
            '## Historical Failures (learn from past runs)',
            historicalContext
        );
    }

    if (domainTerms) {
        sections.push(
            '',
            '## Domain Terminology',
            domainTerms
        );
    }

    sections.push(
        '',
        '## Instructions',
        'Analyze the test cases above and produce a structured Exploration Plan.',
        'Think step-by-step about the user flow, required pages, elements, and risks.',
        'Output ONLY the JSON exploration plan — no other text.'
    );

    return sections.join('\n');
}

/**
 * Parse and validate the Analyst phase output.
 *
 * @param {string} rawResponse - Raw LLM response text
 * @returns {{ valid: boolean, plan: Object|null, errors: string[] }}
 */
function parseAnalystOutput(rawResponse) {
    const errors = [];

    // Extract JSON from the response (may be wrapped in markdown code blocks)
    let jsonStr = rawResponse.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object boundaries
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let plan;
    try {
        plan = JSON.parse(jsonStr);
    } catch (e) {
        return { valid: false, plan: null, errors: [`Failed to parse JSON: ${e.message}`] };
    }

    // Validate required fields
    if (!plan.testCaseMapping || !Array.isArray(plan.testCaseMapping)) {
        errors.push('Missing or invalid "testCaseMapping" array');
    } else {
        for (let i = 0; i < plan.testCaseMapping.length; i++) {
            const entry = plan.testCaseMapping[i];
            if (!entry.testStepId) errors.push(`testCaseMapping[${i}]: missing testStepId`);
            if (!entry.action) errors.push(`testCaseMapping[${i}]: missing action description`);
            if (!entry.explorationSteps || entry.explorationSteps.length === 0) {
                errors.push(`testCaseMapping[${i}] (${entry.testStepId}): no exploration steps defined`);
            } else {
                for (const step of entry.explorationSteps) {
                    if (!step.tool) errors.push(`testCaseMapping[${i}] step: missing tool name`);
                    if (!step.purpose) errors.push(`testCaseMapping[${i}] step: missing purpose`);
                }
            }
        }
    }

    if (!plan.pageTransitionGraph || typeof plan.pageTransitionGraph !== 'object') {
        errors.push('Missing or invalid "pageTransitionGraph"');
    }

    // Warnings (non-blocking)
    if (!plan.riskAreas || plan.riskAreas.length === 0) {
        errors.push('[WARN] No risk areas identified — consider popups, loading, auth');
    }

    if (!plan.reasoning) {
        errors.push('[WARN] No reasoning provided — chain-of-thought is recommended');
    }

    return {
        valid: errors.filter(e => !e.startsWith('[WARN]')).length === 0,
        plan,
        errors,
    };
}

/**
 * Compute quality score for the exploration plan.
 *
 * @param {Object} plan - Parsed analyst plan
 * @returns {{ score: number, breakdown: Object }}
 */
function scorePlan(plan) {
    if (!plan) return { score: 0, breakdown: {} };

    const breakdown = {};

    // Coverage: how many test steps have exploration steps?
    const totalSteps = plan.testCaseMapping?.length || 0;
    const coveredSteps = (plan.testCaseMapping || []).filter(
        m => m.explorationSteps && m.explorationSteps.length > 0
    ).length;
    breakdown.coverage = totalSteps > 0 ? (coveredSteps / totalSteps) * 100 : 0;

    // Depth: average exploration steps per test step
    const allStepCounts = (plan.testCaseMapping || []).map(
        m => (m.explorationSteps || []).length
    );
    breakdown.avgDepth = allStepCounts.length > 0
        ? allStepCounts.reduce((a, b) => a + b, 0) / allStepCounts.length
        : 0;

    // Has navigate+snapshot as first two steps on first test case
    const firstMapping = (plan.testCaseMapping || [])[0];
    const firstSteps = (firstMapping?.explorationSteps || []).map(s => s.tool);
    breakdown.startsWithNavigation = firstSteps[0] === 'navigate' ? 20 : 0;
    breakdown.hasSnapshot = firstSteps.includes('snapshot') ? 20 : 0;

    // Risk awareness
    breakdown.riskAwareness = (plan.riskAreas?.length || 0) > 0 ? 15 : 0;

    // Transitions
    const transitionCount = Object.keys(plan.pageTransitionGraph || {}).length;
    breakdown.transitions = Math.min(transitionCount * 5, 15);

    // Reasoning present
    breakdown.reasoning = plan.reasoning ? 10 : 0;

    // Calculate total (max 100)
    const score = Math.min(100, Math.round(
        (breakdown.coverage * 0.2) +  // 20% weight
        Math.min(breakdown.avgDepth * 5, 20) +  // up to 20 points
        breakdown.startsWithNavigation +
        breakdown.hasSnapshot +
        breakdown.riskAwareness +
        breakdown.transitions +
        breakdown.reasoning
    ));

    return { score, breakdown };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    PHASE_NAME,
    buildAnalystSystemPrompt,
    buildAnalystUserPrompt,
    parseAnalystOutput,
    scorePlan,
};
