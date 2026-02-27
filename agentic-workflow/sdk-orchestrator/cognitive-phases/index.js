/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COGNITIVE PHASES — Module Index
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The Cognitive QA Loop decomposes single-shot script generation into
 * 5 focused micro-phases, each with minimal context window pressure:
 *
 *   Phase 1: ANALYST  — Pure reasoning → Exploration Plan
 *   Phase 2: EXPLORER — MCP exploration → Verified Selector Map
 *   Phase 3: CODER    — Incremental code gen → .spec.js
 *   Phase 4: REVIEWER — Quality gate → PASS/FAIL
 *   Phase 5: DRYRUN   — Selector verification → PROCEED/FIX_REQUIRED
 *
 * @module cognitive-phases
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const analyst = require('./analyst-phase');
const explorer = require('./explorer-phase');
const coder = require('./coder-phase');
const reviewer = require('./reviewer-phase');
const dryrun = require('./dryrun-phase');

/**
 * Phase execution order and metadata.
 */
const PHASES = [
    {
        name: 'analyst',
        displayName: 'Analyst',
        description: 'Analyze test cases and create exploration plan',
        requiresMCP: false,
        requiresFileWrite: false,
        maxTokens: 5000,
        timeout: 120000, // 2 min (pure reasoning)
    },
    {
        name: 'explorer',
        displayName: 'Explorer',
        description: 'Systematically explore application via MCP',
        requiresMCP: true,
        requiresFileWrite: false,
        maxTokens: 8000,
        timeout: 300000, // 5 min (MCP exploration)
        toolProfile: 'explorer-nav', // Primary; switches to explorer-interact for interactions
    },
    {
        name: 'coder',
        displayName: 'Coder',
        description: 'Generate .spec.js using verified selectors',
        requiresMCP: false,
        requiresFileWrite: true,
        maxTokens: 10000,
        timeout: 180000, // 3 min (code generation)
    },
    {
        name: 'reviewer',
        displayName: 'Reviewer',
        description: 'Review script quality before execution',
        requiresMCP: false,
        requiresFileWrite: false,
        maxTokens: 8000,
        timeout: 120000, // 2 min (pure reasoning)
    },
    {
        name: 'dryrun',
        displayName: 'DryRun Validator',
        description: 'Verify selectors still resolve on live page',
        requiresMCP: true,
        requiresFileWrite: false,
        maxTokens: 4000,
        timeout: 180000, // 3 min (MCP verification)
        toolProfile: 'dryrun',
    },
];

/**
 * Get phase metadata by name.
 */
function getPhase(name) {
    return PHASES.find(p => p.name === name) || null;
}

/**
 * Get the total estimated time for all phases.
 */
function getTotalEstimatedTime() {
    return PHASES.reduce((sum, p) => sum + p.timeout, 0);
}

module.exports = {
    PHASES,
    getPhase,
    getTotalEstimatedTime,
    analyst,
    explorer,
    coder,
    reviewer,
    dryrun,
};
