/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OODA LOOP — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests for EnvironmentHealthCheck and ExplorationQualityAnalyzer.
 * Follows the project's test pattern from mcp-server/test-server.js.
 *
 * Run: node agentic-workflow/sdk-orchestrator/test-ooda-loop.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const { EnvironmentHealthCheck, ExplorationQualityAnalyzer, DECISION, CHECK_STATUS } = require('./ooda-loop');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, testName) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        errors.push(testName);
        console.log(`  ❌ ${testName}`);
    }
}

function assertEq(actual, expected, testName) {
    if (actual === expected) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        errors.push(`${testName} (got: ${actual}, expected: ${expected})`);
        console.log(`  ❌ ${testName} — got: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

async function runTests() {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  OODA Loop Unit Tests');
    console.log('═══════════════════════════════════════════════════\n');

    // ─── EnvironmentHealthCheck Tests ───────────────────────────────

    console.log('── EnvironmentHealthCheck ──\n');

    // Test 1: Disabled check returns PROCEED with score 100
    {
        const hc = new EnvironmentHealthCheck({
            config: { ooda: { environmentHealth: { enabled: false } } },
        });
        const result = await hc.execute();
        assertEq(result.decision, DECISION.PROCEED, 'Disabled health check returns PROCEED');
        assertEq(result.score, 100, 'Disabled health check has score 100');
    }

    // Test 2: Constructor reads thresholds from config
    {
        const hc = new EnvironmentHealthCheck({
            config: {
                ooda: {
                    environmentHealth: {
                        enabled: true,
                        abortThreshold: 50,
                        warnThreshold: 80,
                        timeoutMs: 5000,
                    },
                },
            },
        });
        assertEq(hc.abortThreshold, 50, 'abortThreshold from config');
        assertEq(hc.warnThreshold, 80, 'warnThreshold from config');
        assertEq(hc.timeoutMs, 5000, 'timeoutMs from config');
    }

    // Test 3: Default thresholds
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        assertEq(hc.abortThreshold, 40, 'Default abortThreshold is 40');
        assertEq(hc.warnThreshold, 70, 'Default warnThreshold is 70');
        assertEq(hc.timeoutMs, 10000, 'Default timeoutMs is 10000');
    }

    // Test 4: _orient calculates weighted score correctly
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        const checks = [
            { id: 'a', name: 'A', status: CHECK_STATUS.PASS, score: 100, weight: 50 },
            { id: 'b', name: 'B', status: CHECK_STATUS.FAIL, score: 0, weight: 50 },
        ];
        const { score, diagnostics } = hc._orient(checks);
        assertEq(score, 50, 'Weighted score: (100*50 + 0*50) / 100 = 50');
        assert(diagnostics.some(d => d.includes('❌ B')), 'Diagnostics includes failed check');
    }

    // Test 5: _decide returns ABORT for low score
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        assertEq(hc._decide(30, []), DECISION.ABORT, 'Score 30 triggers ABORT');
        assertEq(hc._decide(50, []), DECISION.WARN, 'Score 50 triggers WARN');
        assertEq(hc._decide(80, []), DECISION.PROCEED, 'Score 80 triggers PROCEED');
    }

    // Test 6: Critical failure triggers ABORT regardless of score
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        const checks = [
            { id: 'critical', name: 'Critical', status: CHECK_STATUS.FAIL, score: 0, weight: 30 },
        ];
        assertEq(hc._decide(80, checks), DECISION.ABORT, 'Critical failure (weight>=25) forces ABORT even at score 80');
    }

    // Test 7: _checkFrameworkFiles detects present/missing files
    {
        const hc = new EnvironmentHealthCheck({
            config: {},
            projectRoot: path.join(__dirname, '..', '..'),
        });
        const result = hc._checkFrameworkFiles();
        // In this project, all framework files should exist
        assertEq(result.status, CHECK_STATUS.PASS, 'Framework files check passes in this project');
        assert(result.score >= 80, 'Framework files score >= 80');
    }

    // Test 8: _checkMCPConfig detects server.js
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        const result = hc._checkMCPConfig();
        assertEq(result.status, CHECK_STATUS.PASS, 'MCP server.js found');
    }

    // Test 9: _resolveEnvVar replaces ${VAR} patterns
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        process.env._TEST_OODA_VAR = 'hello';
        const resolved = hc._resolveEnvVar('https://${_TEST_OODA_VAR}/path');
        assertEq(resolved, 'https://hello/path', '_resolveEnvVar replaces ${VAR}');
        delete process.env._TEST_OODA_VAR;
    }

    // Test 10: _resolveEnvVar handles null/undefined
    {
        const hc = new EnvironmentHealthCheck({ config: {} });
        assertEq(hc._resolveEnvVar(null), null, '_resolveEnvVar(null) returns null');
        assertEq(hc._resolveEnvVar(undefined), null, '_resolveEnvVar(undefined) returns null');
    }

    // ─── ExplorationQualityAnalyzer Tests ───────────────────────────

    console.log('\n── ExplorationQualityAnalyzer ──\n');

    // Test 11: Disabled analyzer returns ACCEPT
    {
        const qa = new ExplorationQualityAnalyzer({
            config: { ooda: { explorationQuality: { enabled: false } } },
        });
        const result = qa.assess('some snapshot text');
        assertEq(result.decision, DECISION.ACCEPT, 'Disabled analyzer returns ACCEPT');
        assertEq(result.score, 100, 'Disabled analyzer has score 100');
    }

    // Test 12: Empty snapshot triggers RETRY_RECOMMENDED
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const result = qa.assess('');
        assertEq(result.decision, DECISION.RETRY_RECOMMENDED, 'Empty snapshot → RETRY_RECOMMENDED');
        assert(result.score <= 30, 'Empty snapshot score <= 30');
        assert(result.warnings.length > 0, 'Empty snapshot has warnings');
    }

    // Test 13: Rich snapshot with many roles triggers ACCEPT
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const richSnapshot = `
            - navigation "Main Nav"
            - heading "Welcome to OneHome"
            - button "Search"
            - textbox "City, State, ZIP"
            - combobox "Price Range"
            - link "View Details"
            - checkbox "Remember Me"
            - button "Apply Filters"
            - list "Results"
            - listitem "Property 1"
            - img "Property Photo"
            - button "Save"
            - link "Back to Results"
            - region "Map Area"
            - tab "Grid View"
            - tab "Map View"
        `;
        const result = qa.assess(richSnapshot);
        assertEq(result.decision, DECISION.ACCEPT, 'Rich snapshot → ACCEPT');
        assert(result.score >= 60, `Rich snapshot score >= 60 (got ${result.score})`);
        assert(result.elementCount >= 10, `Rich snapshot has >= 10 elements (got ${result.elementCount})`);
        assert(result.roleDiversity >= 5, `Rich snapshot has >= 5 unique roles (got ${result.roleDiversity})`);
    }

    // Test 14: Loading spinner detected
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const loadingSnapshot = `
            - heading "OneHome"
            - navigation "Main"
            - button "Menu"
            - region "Content"
              - loading indicator
              - text "Please wait..."
              - spinner
        `;
        const result = qa.assess(loadingSnapshot);
        assert(result.warnings.some(w => w.toLowerCase().includes('loading')), 'Loading indicator warning raised');
        assert(result.score <= 70, `Loading snapshot score <= 70 (got ${result.score})`);
    }

    // Test 15: Popup-dominated snapshot
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const popupSnapshot = `
            - dialog "Welcome Modal"
            - button "Dismiss"
            - button "Close"
            - overlay backdrop
            - popup content
            - modal "Tour Guide"
            - button "Got it"
        `;
        const result = qa.assess(popupSnapshot);
        assert(result.warnings.some(w => w.toLowerCase().includes('popup') || w.toLowerCase().includes('overlay')),
            'Popup dominance warning raised');
    }

    // Test 16: Dynamic ID detection
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const dynamicSnapshot = `
            - heading "Search Page"
            - button "Search"
            - textbox #input-text-hp0r4mgrm3v "City"
            - combobox #select-yw91x0xqelm "Price"
            - link "Details"
            - navigation "Main"
            - list "Results"
            - listitem "Item 1"
            - region "Content"
        `;
        const result = qa.assess(dynamicSnapshot);
        assert(result.metrics.dynamicIdCount >= 1, `Detected ${result.metrics.dynamicIdCount} dynamic IDs (expected >= 1)`);
        assert(result.warnings.some(w => w.includes('dynamic ID')), 'Dynamic ID warning raised');
    }

    // Test 17: Custom thresholds
    {
        const qa = new ExplorationQualityAnalyzer({
            config: {
                ooda: {
                    explorationQuality: {
                        minElements: 20,
                        minRoleDiversity: 8,
                        retryThreshold: 50,
                        warnThreshold: 80,
                    },
                },
            },
        });
        assertEq(qa.minElements, 20, 'Custom minElements');
        assertEq(qa.minRoleDiversity, 8, 'Custom minRoleDiversity');
        assertEq(qa.retryThreshold, 50, 'Custom retryThreshold');
        assertEq(qa.warnThreshold, 80, 'Custom warnThreshold');
    }

    // Test 18: Sparse snapshot (short text, few elements)
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const sparseSnapshot = 'button "OK"';
        const result = qa.assess(sparseSnapshot);
        assert(result.metrics.isSparse, 'Sparse detection flag set');
        assert(result.score < 50, `Sparse snapshot score < 50 (got ${result.score})`);
    }

    // Test 19: Feature map comparison (low element count for known page)
    {
        const mockGroundingStore = {
            config: {
                featureMap: [
                    {
                        name: 'Property Search',
                        pages: ['/en-US/properties/map'],
                        pageObjects: ['searchPanel.js', 'map.js', 'propertiresGrid.js'],
                        keywords: ['search', 'filter', 'price'],
                    },
                ],
            },
        };
        const qa = new ExplorationQualityAnalyzer({ config: {}, groundingStore: mockGroundingStore });
        const sparseForPage = `
            - heading "Search"
            - button "Go"
            - link "Home"
        `;
        const result = qa.assess(sparseForPage, { pageUrl: '/en-US/properties/map' });
        assert(
            result.warnings.some(w => w.includes('Property Search') && w.includes('expected')),
            'Feature map comparison warning raised for sparse page'
        );
    }

    // Test 20: Zero interactive elements warning
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const noInteractive = `
            - heading "Static Page"
            - navigation "Nav"
            - list "Items"
            - listitem "Item A"
            - listitem "Item B"
            - region "Footer"
            - img "Logo"
            - main "Content"
            - banner "Header"
        `;
        const result = qa.assess(noInteractive);
        assert(result.metrics.interactiveElements === 0, 'Zero interactive elements detected');
        assert(result.warnings.some(w => w.includes('interactive')), 'Zero interactive elements warning');
    }

    // Test 21: _observe extracts correct metrics
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const metrics = qa._observe('button "A" link "B" textbox "C" heading "D" region "E"');
        assertEq(metrics.elementCount, 5, '_observe counts 5 elements');
        assertEq(metrics.roleDiversity, 5, '_observe finds 5 unique roles');
        assert(metrics.uniqueRoles.includes('button'), 'uniqueRoles includes button');
        assert(metrics.uniqueRoles.includes('link'), 'uniqueRoles includes link');
        assert(!metrics.hasLoadingIndicator, 'No loading indicator');
        assert(!metrics.isEmpty, 'Not empty (>50 chars)');
    }

    // Test 22: _decide boundary tests
    {
        const qa = new ExplorationQualityAnalyzer({
            config: {
                ooda: { explorationQuality: { retryThreshold: 30, warnThreshold: 60 } },
            },
        });
        assertEq(qa._decide(29), DECISION.RETRY_RECOMMENDED, 'Score 29 → RETRY_RECOMMENDED');
        assertEq(qa._decide(30), DECISION.WARN, 'Score 30 → WARN (at threshold)');
        assertEq(qa._decide(59), DECISION.WARN, 'Score 59 → WARN');
        assertEq(qa._decide(60), DECISION.ACCEPT, 'Score 60 → ACCEPT (at threshold)');
        assertEq(qa._decide(100), DECISION.ACCEPT, 'Score 100 → ACCEPT');
    }

    // Test 23: Recommendation includes actionable steps
    {
        const qa = new ExplorationQualityAnalyzer({ config: {} });
        const result = qa.assess('loading spinner please wait');
        assert(result.recommendation !== null, 'Low quality generates recommendation');
        assert(result.recommendation.includes('Suggested actions'), 'Recommendation has action steps');
    }

    // Test 24: DECISION and CHECK_STATUS constants export
    {
        assertEq(DECISION.PROCEED, 'PROCEED', 'DECISION.PROCEED constant');
        assertEq(DECISION.WARN, 'WARN', 'DECISION.WARN constant');
        assertEq(DECISION.ABORT, 'ABORT', 'DECISION.ABORT constant');
        assertEq(DECISION.ACCEPT, 'ACCEPT', 'DECISION.ACCEPT constant');
        assertEq(DECISION.RETRY_RECOMMENDED, 'RETRY_RECOMMENDED', 'DECISION.RETRY_RECOMMENDED constant');
        assertEq(CHECK_STATUS.PASS, 'pass', 'CHECK_STATUS.PASS constant');
        assertEq(CHECK_STATUS.FAIL, 'fail', 'CHECK_STATUS.FAIL constant');
    }

    // ═══════════════════════════════════════════════════════════════════
    // ENFORCEMENT INTEGRATION TESTS
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── Enforcement Integration Tests ──');

    // Test 25: getSnapshotQualityData export exists
    {
        const { getSnapshotQualityData } = require('./enforcement-hooks');
        assert(typeof getSnapshotQualityData === 'function', 'getSnapshotQualityData is exported');
    }

    // Test 26: getSnapshotQualityData returns null when no sessions
    {
        const { getSnapshotQualityData } = require('./enforcement-hooks');
        const result = getSnapshotQualityData('nonexistent-agent');
        assertEq(result, null, 'Returns null for nonexistent agent');
    }

    // Test 27: createEnforcementHooks creates hooks with OODA quality analyzer for scriptgenerator
    {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { config: {}, verbose: false });
        assert(hooks.onPreToolUse !== undefined, 'scriptgenerator hooks have onPreToolUse');
        assert(hooks.onPostToolUse !== undefined, 'scriptgenerator hooks have onPostToolUse');
    }

    // Test 28: OODA resets mcpSnapshotCalled on RETRY_RECOMMENDED snapshot
    {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', {
            config: { ooda: { explorationQuality: { minElements: 5, minRoleDiversity: 3, retryThreshold: 30, warnThreshold: 60 } } },
            verbose: false,
        });

        const sessionId = `test-ooda-retry-${Date.now()}`;
        const inv = { sessionId };

        // Step 1: Navigate
        await hooks.onPreToolUse({ toolName: 'unified_navigate', toolArgs: { url: 'http://test.com' } }, inv);

        // Step 2: Snapshot (will be low quality — nearly empty)
        await hooks.onPreToolUse({ toolName: 'unified_snapshot', toolArgs: {} }, inv);
        const postResult = await hooks.onPostToolUse({
            toolName: 'unified_snapshot',
            result: 'loading... please wait',
            toolArgs: {},
        }, inv);

        // Verify OODA warning was generated
        assert(postResult && postResult.additionalContext && postResult.additionalContext.includes('RETRY_RECOMMENDED'),
            'OODA RETRY_RECOMMENDED warning returned for bad snapshot');

        // Step 3: Try to create .spec.js — should be DENIED because mcpSnapshotCalled was reset
        const preResult = await hooks.onPreToolUse({
            toolName: 'create_file',
            toolArgs: { filePath: '/tests/specs/test.spec.js', content: 'test' },
        }, inv);

        assertEq(preResult.permissionDecision, 'deny', 'Spec creation denied after RETRY_RECOMMENDED');
        assert(preResult.additionalContext.includes('LOW QUALITY'),
            'Denial message mentions low quality');
    }

    // Test 29: OODA allows spec creation after good snapshot replaces bad one
    {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', {
            config: { ooda: { explorationQuality: { minElements: 5, minRoleDiversity: 3, retryThreshold: 30, warnThreshold: 60 } } },
            verbose: false,
        });

        const sessionId = `test-ooda-recovery-${Date.now()}`;
        const inv = { sessionId };

        // Navigate
        await hooks.onPreToolUse({ toolName: 'unified_navigate', toolArgs: {} }, inv);

        // Bad snapshot
        await hooks.onPreToolUse({ toolName: 'unified_snapshot', toolArgs: {} }, inv);
        await hooks.onPostToolUse({
            toolName: 'unified_snapshot',
            result: 'loading...',
            toolArgs: {},
        }, inv);

        // Good snapshot - rich content with many roles
        await hooks.onPreToolUse({ toolName: 'unified_snapshot', toolArgs: {} }, inv);
        const richSnapshot = `
            - role: navigation name: "Main Nav"
            - role: heading name: "Property Search"
            - role: textbox name: "Search City"
            - role: button name: "Search"
            - role: link name: "View Details"
            - role: combobox name: "Price Range"
            - role: checkbox name: "Pool"
            - role: img name: "Property Photo"
            - role: list name: "Results"
            - role: listitem name: "123 Main St"
            - role: listitem name: "456 Oak Ave"
            - role: listitem name: "789 Pine Dr"
        `;
        const postResult = await hooks.onPostToolUse({
            toolName: 'unified_snapshot',
            result: richSnapshot,
            toolArgs: {},
        }, inv);

        // Good snapshot should return empty (ACCEPT)
        assert(!postResult || !postResult.additionalContext || !postResult.additionalContext.includes('RETRY'),
            'Good snapshot does not trigger RETRY warning');

        // Validate semantic selector (required gate)
        await hooks.onPreToolUse({ toolName: 'unified_get_by_role', toolArgs: {} }, inv);
        // Extract content (required gate)
        await hooks.onPreToolUse({ toolName: 'unified_get_text_content', toolArgs: {} }, inv);
        // URL verification (required gate)
        await hooks.onPreToolUse({ toolName: 'unified_get_page_url', toolArgs: {} }, inv);
        // Framework inventory (required gate)
        await hooks.onPreToolUse({ toolName: 'get_framework_inventory', toolArgs: {} }, inv);
        // State check (required gate)
        await hooks.onPreToolUse({ toolName: 'unified_is_visible', toolArgs: {} }, inv);

        // Spec creation should now be allowed
        const preResult = await hooks.onPreToolUse({
            toolName: 'create_file',
            toolArgs: { filePath: '/tests/specs/test.spec.js', content: 'const test = 1;' },
        }, inv);

        assertEq(preResult.permissionDecision, 'allow', 'Spec creation allowed after quality snapshot');
    }

    // Test 30: getSnapshotQualityData returns data after snapshots
    {
        const { createEnforcementHooks, getSnapshotQualityData } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', {
            config: { ooda: { explorationQuality: { minElements: 5 } } },
            verbose: false,
        });

        const sessionId = `scriptgenerator-quality-test-${Date.now()}`;
        const inv = { sessionId };

        // Navigate + snapshot
        await hooks.onPreToolUse({ toolName: 'unified_navigate', toolArgs: {} }, inv);
        await hooks.onPreToolUse({ toolName: 'unified_snapshot', toolArgs: {} }, inv);
        await hooks.onPostToolUse({
            toolName: 'unified_snapshot',
            result: `
                - role: navigation name: "Nav"
                - role: heading name: "Title"
                - role: button name: "Click"
                - role: textbox name: "Input"
                - role: link name: "Link"
                - role: combobox name: "Select"
            `,
            toolArgs: {},
        }, inv);

        const data = getSnapshotQualityData('scriptgenerator');
        assert(data !== null, 'getSnapshotQualityData returns data');
        assert(data.totalSnapshots >= 1, 'Has at least 1 snapshot');
        assert(data.qualityAssessed >= 1, 'At least 1 quality assessment');
        assert(data.summary !== undefined, 'Has summary object');
        assert(typeof data.canCreateSpec === 'boolean', 'canCreateSpec is boolean');
    }

    // ─── Summary ────────────────────────────────────────────────────

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (errors.length > 0) {
        console.log(`  Failures:`);
        for (const e of errors) console.log(`    • ${e}`);
    }
    console.log(`${'═'.repeat(50)}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
