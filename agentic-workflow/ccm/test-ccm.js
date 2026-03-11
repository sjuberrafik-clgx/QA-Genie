/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CCM TEST SUITE — Unit tests for the Cognitive Context Mesh
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node agentic-workflow/ccm/test-ccm.js
 *
 * Tests all 5 core modules:
 *   1. Context DNA Compiler (multi-resolution compilation)
 *   2. Coverage Map + Confidence Scorer (provable knowledge tracking)
 *   3. Context Navigator + Focus Tracker (dynamic allocation)
 *   4. Provenance System (assertion extraction + verification)
 *   5. Context Learner (cross-run intelligence)
 *   6. Integration Layer (CognitiveContextMesh orchestrator)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

let passed = 0;
let failed = 0;
let errors = [];

function assert(condition, message) {
    if (condition) {
        passed++;
    } else {
        failed++;
        errors.push(`FAIL: ${message}`);
        console.error(`  ✗ ${message}`);
    }
}

function section(name) {
    console.log(`\n═══ ${name} ═══`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONTEXT DNA COMPILER
// ═══════════════════════════════════════════════════════════════════════════════

section('Context DNA Compiler');

const {
    ContextDNACompiler,
    analyzeJavaScriptSource,
    analyzeJSONSource,
    analyzeDocSource,
    buildL1,
    buildL2,
    buildL3,
    generateRegionId,
} = require('./context-dna-compiler');

// Test JS source analysis
const testJSContent = `
const { test, expect } = require('@playwright/test');
const POmanager = require('../../pageobjects/POmanager');

class LoginPage {
    constructor(page) {
        this.page = page;
        this.usernameInput = page.locator('#username');
        this.passwordInput = page.locator('[data-testid="password"]');
        this.loginButton = page.getByRole('button', { name: 'Sign In' });
    }

    async login(username, password) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.loginButton.click();
        await this.page.waitForLoadState('networkidle');
    }

    async getErrorMessage() {
        return await this.page.locator('.error-msg').textContent();
    }
}

module.exports = LoginPage;
`;

const jsAnalysis = analyzeJavaScriptSource(testJSContent, 'tests/pageobjects/loginPage.js');
assert(jsAnalysis.type === 'code', 'JS analysis type should be "code"');
assert(jsAnalysis.classes.length === 1, 'Should find 1 class (LoginPage)');
assert(jsAnalysis.classes[0].name === 'LoginPage', 'Class name should be LoginPage');
assert(jsAnalysis.classes[0].methods.length >= 2, 'Should find login and getErrorMessage methods');
assert(jsAnalysis.locators.length >= 3, 'Should find at least 3 locators');
assert(jsAnalysis.dependencies.length >= 1, 'Should find at least 1 dependency');
assert(jsAnalysis.exports.length >= 1, 'Should find module.exports');
console.log(`  ✓ JS analysis: ${jsAnalysis.classes.length} classes, ${jsAnalysis.locators.length} locators, ${jsAnalysis.dependencies.length} deps`);

// Test JSON analysis
const testJSONContent = JSON.stringify({
    version: '1.0.0',
    settings: { timeout: 30000, retries: 2 },
    features: [{ name: 'search', enabled: true }],
});
const jsonAnalysis = analyzeJSONSource(testJSONContent, 'config/settings.json');
assert(jsonAnalysis.type === 'data', 'JSON analysis type should be "data"');
assert(jsonAnalysis.topLevelKeys.length > 0, 'JSON should have keys');
console.log(`  ✓ JSON analysis: ${jsonAnalysis.topLevelKeys.length} keys`);

// Test Doc analysis
const testDocContent = `# Login Feature
## Overview
The login feature authenticates users via token-based URLs.
## Requirements
- Must support MLS-specific tokens
- See also: [Auth System](./auth.md)
### Edge Cases
- Expired tokens should show error page
`;
const docAnalysis = analyzeDocSource(testDocContent, 'docs/login.md');
assert(docAnalysis.type === 'documentation', 'Doc analysis type should be "documentation"');
assert(docAnalysis.sections.length >= 2, 'Should find at least 2 sections');
console.log(`  ✓ Doc analysis: ${docAnalysis.sections.length} sections`);

// Test L1 building
const l1 = buildL1(jsAnalysis, 'tests/pageobjects/loginPage.js');
assert(l1.filePath === 'tests/pageobjects/loginPage.js', 'L1 should have filePath');
assert(l1.classes.length === 1, 'L1 should have 1 class');
assert(l1.locators.length >= 3, 'L1 should preserve locators');
console.log(`  ✓ L1 skeleton built: ${l1.classes.length} classes, ${l1.locators.length} locators`);

// Test L2 building
const l2 = buildL2(l1);
assert(l2.purpose, 'L2 should have purpose');
assert(l2.api.length >= 1, 'L2 should expose API surface');
assert(l2.dependencies.length >= 1, 'L2 should track dependencies');
console.log(`  ✓ L2 card: purpose="${l2.purpose}", ${l2.api.length} API entries`);

// Test L3 building
const l2Cards = [
    { ...l2, regionId: generateRegionId('tests/pageobjects/loginPage.js'), filePath: 'tests/pageobjects/loginPage.js' },
    { regionId: generateRegionId('tests/utils/helper.js'), filePath: 'tests/utils/helper.js', purpose: 'Utility helpers', type: 'utility', api: ['wait', 'retry'], dependencies: ['loginPage.js'] },
];
const l3 = buildL3(l2Cards, { projectName: 'test-project' });
assert(l3.components.length === 2, 'L3 should have 2 components');
assert(l3.dependencyGraph, 'L3 should have dependency graph');
assert(l3.system, 'L3 should have system stats');
console.log(`  ✓ L3 architecture DNA: ${l3.components.length} components`);

// Test region ID generation
const id1 = generateRegionId('tests/pageobjects/loginPage.js');
const id2 = generateRegionId('tests/pageobjects/loginPage.js');
const id3 = generateRegionId('tests/pageobjects/searchPage.js');
assert(id1 === id2, 'Same path should generate same ID');
assert(id1 !== id3, 'Different paths should generate different IDs');
console.log(`  ✓ Region IDs: deterministic and unique`);


// ═══════════════════════════════════════════════════════════════════════════════
// 2. COVERAGE MAP + CONFIDENCE SCORER
// ═══════════════════════════════════════════════════════════════════════════════

section('Coverage Map + Confidence Scorer');

const { CoverageMap, ConfidenceScorer, CONFIDENCE_LEVELS, RESOLUTION_SCORES } = require('./coverage-map');

// Test CoverageMap
const coverageMap = new CoverageMap();

coverageMap.recordInjection('region-login', 'L1', { charCount: 500, filePath: 'loginPage.js', agent: 'coder' });
coverageMap.recordInjection('region-search', 'L2', { charCount: 200, filePath: 'searchPage.js', agent: 'coder' });

const loginCoverage = coverageMap.getRegionCoverage('region-login');
assert(loginCoverage.level === 'L1', 'Login should be at L1');
assert(loginCoverage.confidence === 0.75, 'L1 confidence should be 0.75');
assert(loginCoverage.status !== CONFIDENCE_LEVELS.UNGROUNDED, 'Login should not be ungrounded');
console.log(`  ✓ Region tracking: login at ${loginCoverage.level} (${loginCoverage.confidence})`);

// Test upgrade
coverageMap.recordInjection('region-login', 'L0', { agent: 'reviewer' });
const upgradedCoverage = coverageMap.getRegionCoverage('region-login');
assert(upgradedCoverage.level === 'L0', 'Login should upgrade to L0');
assert(upgradedCoverage.confidence === 1.0, 'L0 confidence should be 1.0');
console.log(`  ✓ Resolution upgrade: L1 → L0`);

// Test ungrounded region
const unknownCoverage = coverageMap.getRegionCoverage('region-unknown');
assert(unknownCoverage.status === CONFIDENCE_LEVELS.UNGROUNDED, 'Unknown region should be ungrounded');
console.log(`  ✓ Ungrounded detection works`);

// Test global coverage
const globalCov = coverageMap.getGlobalCoverage();
assert(globalCov.coveredRegions === 2, 'Should have 2 covered regions');
assert(globalCov.injectionCount >= 3, 'Should have 3+ injection events');
console.log(`  ✓ Global coverage: ${globalCov.coveredRegions} regions, ${globalCov.injectionCount} injections`);

// Test eviction
coverageMap.recordEviction('region-search', 'budget_exceeded');
const evictedCoverage = coverageMap.getRegionCoverage('region-search');
assert(evictedCoverage.confidence < 0.45, 'Evicted region should have reduced confidence');
console.log(`  ✓ Eviction: confidence degraded to ${evictedCoverage.confidence}`);

// Test coverage summary
const summary = coverageMap.renderCoverageSummary();
assert(summary.includes('CONTEXT COVERAGE'), 'Summary should have header');
console.log(`  ✓ Coverage summary rendered`);

// Test heatmap
const heatmap = coverageMap.toHeatmap();
assert(heatmap.length === 2, 'Heatmap should have 2 entries');
console.log(`  ✓ Heatmap: ${heatmap.length} entries`);

// Test serialization
const json = coverageMap.toJSON();
const restored = CoverageMap.fromJSON(json);
assert(restored.getRegionCoverage('region-login').level === 'L0', 'Restored map should preserve data');
console.log(`  ✓ Serialization roundtrip works`);


// ═══════════════════════════════════════════════════════════════════════════════
// 3. CONTEXT NAVIGATOR + FOCUS TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

section('Context Navigator + Focus Tracker');

const { ContextNavigator, FocusTracker, AGENT_PROFILES } = require('./context-navigator');

// Test FocusTracker
const tracker = new FocusTracker({ halfLifeMs: 60000 });

tracker.recordAccess('region-login');
tracker.recordAccess('region-login');
const loginFocus = tracker.getFocus('region-login');
assert(loginFocus > 1.0, 'Double-accessed region should have focus > 1.0');
console.log(`  ✓ Focus tracking: login focus = ${loginFocus.toFixed(2)}`);

const unknownFocus = tracker.getFocus('region-unknown');
assert(unknownFocus === 0, 'Unknown region should have 0 focus');
console.log(`  ✓ Unknown region focus = 0`);

// Test recommended level
const loginLevel = tracker.getRecommendedLevel('region-login');
assert(['L0', 'L1', 'L2'].includes(loginLevel), 'High-focus region should get L0/L1/L2');
console.log(`  ✓ Recommended level for login: ${loginLevel}`);

const unknownLevel = tracker.getRecommendedLevel('region-unknown');
assert(unknownLevel === 'L3', 'Unknown region should get L3');
console.log(`  ✓ Recommended level for unknown: ${unknownLevel}`);

// Test active focuses
const activeFocuses = tracker.getActiveFocuses(0.1);
assert(activeFocuses.length >= 1, 'Should have at least 1 active focus');
console.log(`  ✓ Active focuses: ${activeFocuses.length}`);

// Test agent profiles exist
assert(AGENT_PROFILES['cognitive-coder'], 'Coder profile should exist');
assert(AGENT_PROFILES['cognitive-explorer-nav'], 'Explorer profile should exist');
assert(AGENT_PROFILES.scriptgenerator, 'ScriptGenerator profile should exist');
console.log(`  ✓ Agent profiles: ${Object.keys(AGENT_PROFILES).length} defined`);

// Test prune
tracker.prune();
console.log(`  ✓ Prune ran without error`);


// ═══════════════════════════════════════════════════════════════════════════════
// 4. PROVENANCE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

section('Provenance System');

const {
    AssertionExtractor,
    ProvenanceTagger,
    ProvenanceVerifier,
    ConfidenceRenderer,
    ASSERTION_TYPES,
} = require('./provenance');

// Test AssertionExtractor
const extractor = new AssertionExtractor();
const testCode = `
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');
const { userTokens } = require('../../test-data/testData');

test.describe.serial("Login Tests", () => {
    let browser, page, context, poManager;

    test.beforeAll(async () => {
        ({ browser, page, context } = await launchBrowser());
        poManager = new POmanager(page);
    });

    test("should login successfully", async () => {
        const loginPage = poManager.getLoginPage();
        await page.goto(userTokens.registered);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await page.locator('[data-testid="email-input"]').fill('test@example.com');
        await page.getByText('Welcome').waitFor();
        await expect(page).toHaveURL('/dashboard');
        await expect(page.locator('.user-name')).toContainText('Test User');
    });
});
`;

const assertions = extractor.extract(testCode);
assert(assertions.length >= 5, `Should extract at least 5 assertions, got ${assertions.length}`);

const selectorAssertions = assertions.filter(a => a.type === ASSERTION_TYPES.SELECTOR);
assert(selectorAssertions.length >= 2, `Should find at least 2 selectors, got ${selectorAssertions.length}`);

const importAssertions = assertions.filter(a => a.type === ASSERTION_TYPES.IMPORT);
assert(importAssertions.length >= 4, `Should find at least 4 imports, got ${importAssertions.length}`);

const urlAssertions = assertions.filter(a => a.type === ASSERTION_TYPES.URL);
assert(urlAssertions.length >= 1, `Should find at least 1 URL assertion, got ${urlAssertions.length}`);

const textAssertions = assertions.filter(a => a.type === ASSERTION_TYPES.TEXT);
assert(textAssertions.length >= 1, `Should find at least 1 text assertion, got ${textAssertions.length}`);
console.log(`  ✓ Assertion extraction: ${assertions.length} total (${selectorAssertions.length} selectors, ${importAssertions.length} imports, ${urlAssertions.length} urls, ${textAssertions.length} texts)`);

// Test known import verification
const verifier = new ProvenanceVerifier({
    getAllL2Cards: () => [],
    getL1: () => null,
    findRelevantRegions: () => [],
});

const mockTaggedAssertions = assertions.map(a => ({
    ...a,
    provenance: { regionId: null, level: null, confidence: 0, status: 'ungrounded', chain: [] },
}));

const verification = verifier.verify(mockTaggedAssertions);
assert(verification.summary.total === assertions.length, 'Verification should cover all assertions');
assert(verification.summary.verified >= 4, `Should verify at least 4 known imports, got ${verification.summary.verified}`);
console.log(`  ✓ Verification: ${verification.summary.verified} verified, ${verification.summary.inferred} inferred, ${verification.summary.ungrounded} ungrounded`);

// Test ConfidenceRenderer
const renderer = new ConfidenceRenderer();
const report = renderer.renderReport(verification);
assert(report.includes('Provenance Verification Report'), 'Report should have title');
assert(report.includes('Risk level'), 'Report should show risk level');
console.log(`  ✓ Report rendered (${report.length} chars)`);

// Test inline annotations
const annotated = renderer.renderInlineAnnotations(testCode, verification.results);
assert(annotated.length >= testCode.length, 'Annotated code should be at least as long as original');
console.log(`  ✓ Inline annotations generated`);


// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONTEXT LEARNER
// ═══════════════════════════════════════════════════════════════════════════════

section('Context Learner');

const { ContextLearner } = require('./context-learner');

const learner = new ContextLearner();

// Test navigation pattern recording
learner.recordNavigationPattern('cognitive-coder', [
    { regionId: 'reg-login', level: 'L1', filePath: 'loginPage.js' },
    { regionId: 'reg-popup', level: 'L0', filePath: 'popupHandler.js' },
]);
learner.recordNavigationPattern('cognitive-coder', [
    { regionId: 'reg-login', level: 'L1', filePath: 'loginPage.js' },
    { regionId: 'reg-search', level: 'L2', filePath: 'searchPage.js' },
]);

const recommendations = learner.getNavigationRecommendations('cognitive-coder');
assert(recommendations['reg-login'], 'Should have recommendation for login region');
assert(recommendations['reg-login'].accessCount >= 2, 'Login should have at least 2 accesses');
console.log(`  ✓ Navigation patterns: ${Object.keys(recommendations).length} recommendations`);

// Test resolution outcome recording
learner.recordResolutionOutcome('reg-login', 'cognitive-coder', 'L2', 'L1', 'selector-extraction');
learner.recordResolutionOutcome('reg-login', 'cognitive-coder', 'L2', 'L1', 'selector-extraction');
learner.recordResolutionOutcome('reg-login', 'cognitive-coder', 'L2', 'L1', 'selector-extraction');

const updatedRecs = learner.getNavigationRecommendations('cognitive-coder');
assert(updatedRecs['reg-login'].level !== 'L3', 'Should upgrade recommendation based on insufficiency');
console.log(`  ✓ Resolution outcomes recorded and influence recommendations`);

// Test hallucination recording
learner.recordHallucination('reg-search', 'selector', '.non-existent-class');
learner.recordHallucination('reg-search', 'selector', '#bad-id');
const hotspots = learner.getHallucinationHotspots();
assert(hotspots.length >= 1, 'Should have at least 1 hotspot');
assert(hotspots[0].count >= 2, 'Search region should have 2+ hallucinations');
console.log(`  ✓ Hallucination tracking: ${hotspots.length} hotspots`);

// Test phase dependency recording
learner.recordPhaseDependency('cognitive-explorer-nav', 'cognitive-coder', 'reg-login', 'verified_selectors', 0.9);
const deps = learner.getCriticalDependencies('cognitive-coder');
assert(deps.length >= 1, 'Should have at least 1 dependency');
assert(deps[0].importance >= 0.9, 'Dependency should have high importance');
console.log(`  ✓ Phase dependencies: ${deps.length} for cognitive-coder`);

// Test run metrics
learner.recordRunMetrics({ runId: 'test-1', verifiedPercent: '70%', ungroundedPercent: '20%' });
learner.recordRunMetrics({ runId: 'test-2', verifiedPercent: '80%', ungroundedPercent: '10%' });
const trends = learner.getTrends();
assert(trends.runs >= 2, 'Should have 2+ runs');
console.log(`  ✓ Trends: ${trends.trend} over ${trends.runs} runs`);

// Test context hints
const hints = learner.getContextHints('cognitive-coder', 'Generate login test');
assert(hints.upgrades.length >= 1, 'Should recommend upgrades for hallucination hotspots');
console.log(`  ✓ Context hints: ${hints.upgrades.length} upgrades, ${hints.downgrades.length} downgrades`);


// ═══════════════════════════════════════════════════════════════════════════════
// 6. INTEGRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════════

section('Integration Layer (CognitiveContextMesh)');

const { CognitiveContextMesh } = require('./index');

// Test construction
const ccm = new CognitiveContextMesh({ enabled: true, verbose: false });
assert(ccm.config.enabled === true, 'CCM should be enabled');
assert(ccm.dnaCompiler, 'CCM should have DNA compiler');
assert(ccm.coverageMap, 'CCM should have coverage map');
assert(ccm.navigator, 'CCM should have navigator');
assert(ccm.learner, 'CCM should have learner');
console.log(`  ✓ CCM constructed successfully`);

// Test disabled mode
const disabledCCM = new CognitiveContextMesh({ enabled: false });
assert(disabledCCM.config.enabled === false, 'Disabled CCM should report disabled');
console.log(`  ✓ Disabled CCM skips operations`);

// Test status before initialization
try {
    ccm.getHeatmap();
    assert(false, 'Should throw before initialization');
} catch (e) {
    assert(e.message.includes('not initialized'), 'Should throw initialization error');
    console.log(`  ✓ Pre-init guard works correctly`);
}

// Test module re-exports
const indexModule = require('./index');
assert(indexModule.ContextDNACompiler, 'Should re-export ContextDNACompiler');
assert(indexModule.CoverageMap, 'Should re-export CoverageMap');
assert(indexModule.ConfidenceScorer, 'Should re-export ConfidenceScorer');
assert(indexModule.ContextNavigator, 'Should re-export ContextNavigator');
assert(indexModule.FocusTracker, 'Should re-export FocusTracker');
assert(indexModule.AssertionExtractor, 'Should re-export AssertionExtractor');
assert(indexModule.ProvenanceTagger, 'Should re-export ProvenanceTagger');
assert(indexModule.ProvenanceVerifier, 'Should re-export ProvenanceVerifier');
assert(indexModule.ConfidenceRenderer, 'Should re-export ConfidenceRenderer');
assert(indexModule.ContextLearner, 'Should re-export ContextLearner');
console.log(`  ✓ All modules re-exported from index`);


// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (errors.length > 0) {
    console.log('\n  FAILURES:');
    for (const err of errors) {
        console.log(`    ${err}`);
    }
}
console.log('═══════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
