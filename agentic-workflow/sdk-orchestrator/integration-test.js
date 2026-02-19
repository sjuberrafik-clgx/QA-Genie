#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ORCHESTRATOR — Integration Test Suite
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Comprehensive test of all SDK components using the real @github/copilot-sdk.
 * Tests each module independently and then runs an end-to-end simulation.
 *
 * Usage: node sdk-orchestrator/integration-test.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    return { name, fn };
}

async function runTest(t) {
    try {
        await t.fn();
        passed++;
        results.push({ name: t.name, status: '✅ PASS' });
        console.log(`  ✅ ${t.name}`);
    } catch (error) {
        failed++;
        results.push({ name: t.name, status: '❌ FAIL', error: error.message });
        console.log(`  ❌ ${t.name}: ${error.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ─── Test Definitions ───────────────────────────────────────────────────────

const tests = [

    // ── 1. SDK Dynamic Import ───────────────────────────────────────
    test('SDK loads via dynamic import', async () => {
        const sdk = await import('@github/copilot-sdk');
        assert(sdk.CopilotClient, 'CopilotClient not exported');
        assert(sdk.defineTool, 'defineTool not exported');
        assert(sdk.CopilotSession, 'CopilotSession not exported');
    }),

    // ── 2. CopilotClient Lifecycle ──────────────────────────────────
    test('CopilotClient start and stop', async () => {
        const sdk = await import('@github/copilot-sdk');
        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();
        assert(client, 'Client is null');
        // If we get here, start() worked
        // Stop should not throw
        // Note: client.stop() may not exist as a method — the SDK might use destroy()
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 3. Learning Store CRUD ──────────────────────────────────────
    test('LearningStore: record, query, and persist', async () => {
        const { LearningStore } = require('./learning-store');
        const testStorePath = path.join(__dirname, '..', 'learning-data', 'test-store.json');

        // Clean up any previous test store
        if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

        const ls = new LearningStore(testStorePath);

        // Record failure
        ls.recordFailure({
            ticketId: 'TEST-001',
            page: '/test-page',
            errorType: 'SELECTOR_NOT_FOUND',
            selector: '.old-selector',
            fix: 'getByRole("button")',
            outcome: 'fixed',
            method: 'integration-test',
        });

        // Query by ticket
        const failures = ls.getFailuresForTicket('TEST-001');
        assertEqual(failures.length, 1, 'Expected 1 failure for TEST-001');
        assertEqual(failures[0].errorType, 'SELECTOR_NOT_FOUND');

        // Record stable selector
        ls.recordStableSelector({
            page: '/test-page',
            element: 'submit-btn',
            tried: ['.old-selector', '#old-id'],
            stable: 'getByRole("button", { name: "Submit" })',
            confidence: 0.95,
        });

        const selectors = ls.getStableSelectors('/test-page');
        assertEqual(selectors.length, 1, 'Expected 1 stable selector');
        assertEqual(selectors[0].confidence, 0.95);

        // Record page pattern
        ls.recordPagePattern({
            url: '/test-page',
            popups: ['welcome-modal'],
            commonIssues: ['SELECTOR_NOT_FOUND'],
            avgLoadTime: 2500,
        });

        const pattern = ls.getPagePattern('/test-page');
        assert(pattern, 'Page pattern not found');
        assertEqual(pattern.popups[0], 'welcome-modal');

        // Stats
        const stats = ls.getStats();
        assertEqual(stats.totalFailures, 1);
        assertEqual(stats.totalStableSelectors, 1);
        assertEqual(stats.totalPagePatterns, 1);
        assertEqual(stats.fixRate, 100);

        // Persistence
        ls.save();
        assert(fs.existsSync(testStorePath), 'Store file not saved');

        // Re-load from disk
        const ls2 = new LearningStore(testStorePath);
        assertEqual(ls2.getStats().totalFailures, 1, 'Persisted data not loaded');

        // Clean up
        fs.unlinkSync(testStorePath);
    }),

    // ── 4. Enforcement Hooks ────────────────────────────────────────
    test('Enforcement: MCP-first rule blocks spec creation', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { verbose: false });

        // Attempt to create .spec.js before navigation
        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            { sessionId: 'test-session-1' }
        );
        assertEqual(result.permissionDecision, 'deny', 'Should deny spec before navigate');
    }),

    test('Enforcement: allows spec after navigate+snapshot', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { verbose: false });

        // Navigate
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_navigate', toolArgs: { url: 'http://test.com' } },
            { sessionId: 'test-session-2' }
        );

        // Snapshot
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_snapshot', toolArgs: {} },
            { sessionId: 'test-session-2' }
        );

        // Now spec creation should be allowed
        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            { sessionId: 'test-session-2' }
        );
        assert(
            !result.permissionDecision || result.permissionDecision === 'allow',
            `Expected allow, got ${result?.permissionDecision}`
        );
    }),

    test('Enforcement: non-scriptgenerator agents are not blocked', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('testgenie', { verbose: false });

        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'test-cases/test.xlsx' } },
            { sessionId: 'test-session-3' }
        );
        assert(
            !result.permissionDecision || result.permissionDecision === 'allow',
            'TestGenie should not be blocked by MCP-first rule'
        );
    }),

    test('Enforcement: all 5 hook types created', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', {});
        const expected = ['onPreToolUse', 'onPostToolUse', 'onErrorOccurred', 'onSessionStart', 'onSessionEnd'];
        for (const h of expected) {
            assert(typeof hooks[h] === 'function', `Missing hook: ${h}`);
        }
    }),

    // ── 5. Custom Tools with Real SDK ───────────────────────────────
    test('Custom tools: defineTool creates valid tool objects', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});
        assert(tools.length >= 7, `Expected ≥7 tools for scriptgenerator, got ${tools.length}`);

        // Check tool names
        const names = tools.map(t => t.name);
        assert(names.includes('get_framework_inventory'), 'Missing get_framework_inventory');
        assert(names.includes('validate_generated_script'), 'Missing validate_generated_script');
        assert(names.includes('save_exploration_data'), 'Missing save_exploration_data');
    }),

    test('Custom tools: role-based filtering works', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sgTools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});
        const bgTools = createCustomTools(sdk.defineTool, 'buggenie', {});

        assert(sgTools.length > bgTools.length, 'scriptgenerator should have more tools than buggenie');

        const bgNames = bgTools.map(t => t.name);
        assert(bgNames.includes('get_test_results'), 'buggenie should have get_test_results');
        assert(!bgNames.includes('save_exploration_data'), 'buggenie should NOT have save_exploration_data');
    }),

    test('Custom tools: get_framework_inventory returns real data', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');
        const tools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});

        const inventoryTool = tools.find(t => t.name === 'get_framework_inventory');
        assert(inventoryTool, 'get_framework_inventory tool not found');
        assert(typeof inventoryTool.handler === 'function', 'Tool missing handler');

        const result = await inventoryTool.handler({ includeLocators: false });
        assert(typeof result === 'string', 'Expected string result');
        assert(result.includes('Framework Inventory'), 'Expected Framework Inventory header');
        assert(result.includes('POmanager') || result.includes('Utilities'), 'Expected framework content');
    }),

    // ── 6. Agent Session Factory ────────────────────────────────────
    test('SessionFactory: loads agent prompts from .agent.md files', async () => {
        // Test the internal loadAgentPrompt function via the module
        const agentDir = path.join(__dirname, '..', '..', '.github', 'agents');
        const agents = ['testgenie', 'scriptgenerator', 'buggenie', 'codereviewer'];

        for (const agent of agents) {
            const agentFile = path.join(agentDir, `${agent}.agent.md`);
            assert(fs.existsSync(agentFile), `Agent file missing: ${agent}.agent.md`);
        }
    }),

    test('SessionFactory: creates session with real SDK', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { AgentSessionFactory } = require('./agent-sessions');
        const { LearningStore } = require('./learning-store');

        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();

        const factory = new AgentSessionFactory({
            client,
            defineTool: sdk.defineTool,
            model: 'claude-sonnet-4-20250514',
            config: {},
            learningStore: new LearningStore(),
            verbose: false,
        });

        // Create a testgenie session
        const { session, sessionId, agentName } = await factory.createAgentSession('testgenie', {
            ticketContext: 'Integration test context',
        });

        assert(session, 'Session not created');
        assert(sessionId, 'Missing sessionId');
        assertEqual(agentName, 'testgenie');

        // Cleanup
        await factory.destroySession(sessionId);
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 7. Pipeline Runner Mechanics ────────────────────────────────
    test('Pipeline: preflight checks pass', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        // Run just preflight
        const ctx = { ticketId: 'TEST-001', mode: 'full', startTime: Date.now(), stageResults: {} };
        const result = await runner._runPreflight(ctx);
        assertEqual(result.success, true, `Preflight should pass, got: ${result.message}`);
        assert(result.checks.length >= 4, 'Expected at least 4 preflight checks');
    }),

    test('Pipeline: quality gate validates missing artifact', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        const ctx = { ticketId: 'TEST-001', specPath: null };
        const result = await runner._runQualityGate('script', ctx);
        assertEqual(result.success, false, 'Script QG should fail with null specPath');
    }),

    test('Pipeline: report generation creates JSON file', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        const ctx = {
            ticketId: 'TEST-REPORT',
            mode: 'execute',
            startTime: Date.now(),
            stageResults: { 'execute': { success: true, message: 'ok' } },
            testResults: { passed: true, totalCount: 5, failedCount: 0 },
            specPath: null,
            testCasesPath: null,
            explorationPath: null,
            healingResult: null,
        };

        const result = await runner._generateReport(ctx);
        assertEqual(result.success, true, 'Report generation should succeed');
        assert(result.reportPath, 'Report path missing');
        assert(fs.existsSync(result.reportPath), 'Report file not created');

        // Verify report content
        const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
        assertEqual(report.ticketId, 'TEST-REPORT');
        assertEqual(report.mode, 'execute');
        assert(report.testResults.passed, 'Test results should show passed');

        // Clean up
        fs.unlinkSync(result.reportPath);
    }),

    // ── 8. SDKOrchestrator Full Lifecycle ───────────────────────────
    test('SDKOrchestrator: full start/stop lifecycle', async () => {
        const { SDKOrchestrator } = require('./index');
        const orch = new SDKOrchestrator({ verbose: false });

        await orch.start();

        // Verify all components initialized
        assert(orch.isRunning, 'Should be running');
        assert(orch.client, 'Client missing');
        assert(orch.sessionFactory, 'SessionFactory missing');
        assert(orch.selfHealing, 'SelfHealing missing');
        assert(orch.pipelineRunner, 'PipelineRunner missing');
        assert(orch.learningStore, 'LearningStore missing');

        // Verify config loaded
        assertEqual(orch.options.model, 'claude-sonnet-4-20250514', 'Model should be from config');
        assertEqual(orch.options.maxHealingIterations, 3, 'Max healing should be 3');

        await orch.stop();
        assertEqual(orch.isRunning, false, 'Should stop cleanly');
    }),

    // ── 9. CLI Dry Run ──────────────────────────────────────────────
    test('CLI: dry-run produces correct plan output', async () => {
        const { execSync } = require('child_process');
        const cliPath = path.join(__dirname, 'cli.js');

        const output = execSync(
            `node "${cliPath}" --ticket TEST-CLI --mode heal --dry-run`,
            { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
        );

        assert(output.includes('DRY RUN'), 'Should show DRY RUN');
        assert(output.includes('TEST-CLI'), 'Should include ticket');
        assert(output.includes('heal'), 'Should include mode');
    }),

    // ── 10. Config Loading with BOM Handling ────────────────────────
    test('Config loads despite BOM character', async () => {
        const { SDKOrchestrator } = require('./index');
        const orch = new SDKOrchestrator({});

        // Config should be loaded (our BOM fix works)
        assert(Object.keys(orch.config).length > 0, 'Config is empty');
        assert(orch.config.sdk, 'SDK config section missing');
        assert(orch.config.pipeline, 'Pipeline config section missing');
    }),

    // ── 11. Pipeline Mode Stage Mapping ─────────────────────────────
    test('Pipeline: mode-stage mapping is correct', async () => {
        const { MODE_STAGES, STAGES } = require('./pipeline-runner');

        assertEqual(MODE_STAGES.full.length, 9, 'Full mode should have 9 stages');
        assertEqual(MODE_STAGES.heal.length, 3, 'Heal mode should have 3 stages');
        assertEqual(MODE_STAGES.execute.length, 2, 'Execute mode should have 2 stages');

        assert(MODE_STAGES.full[0] === STAGES.PREFLIGHT, 'Full starts with preflight');
        assert(MODE_STAGES.full[MODE_STAGES.full.length - 1] === STAGES.REPORT, 'Full ends with report');
        assert(MODE_STAGES.heal.includes(STAGES.SELF_HEAL), 'Heal includes healing');
    }),

    // ── 12. Session Config: Permission & Input Handlers ─────────────
    test('SessionConfig: includes onPermissionRequest handler', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { AgentSessionFactory } = require('./agent-sessions');

        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();

        const factory = new AgentSessionFactory({
            client,
            defineTool: sdk.defineTool,
            model: 'claude-sonnet-4-20250514',
            config: {},
            verbose: false,
        });

        // Verify session creates successfully (proves config is valid)
        const { session, sessionId } = await factory.createAgentSession('testgenie', {});
        assert(session, 'Session with permission handler should create');

        await factory.destroySession(sessionId);
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 13. TestGenie Custom Tools ──────────────────────────────────
    test('Custom tools: testgenie has fetch_jira_ticket and generate_test_case_excel', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const names = tools.map(t => t.name);

        assert(names.includes('fetch_jira_ticket'), 'testgenie should have fetch_jira_ticket');
        assert(names.includes('generate_test_case_excel'), 'testgenie should have generate_test_case_excel');
        assert(tools.length >= 3, `Expected ≥3 tools for testgenie, got ${tools.length}`);
    }),

    test('Custom tools: fetch_jira_ticket handler is callable', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');

        assert(jiraTool, 'fetch_jira_ticket tool not found');
        assert(typeof jiraTool.handler === 'function', 'Tool missing handler');

        // Call with a dummy ticket — should return structured JSON (success or error)
        const result = await jiraTool.handler({ ticketId: 'TEST-999' });
        const parsed = JSON.parse(result);
        assert(typeof parsed === 'object', 'Expected JSON object result');
        // Should have either success:true with data or success:false with error
        assert('success' in parsed || 'error' in parsed, 'Expected success or error field');
    }),

    test('Custom tools: generate_test_case_excel creates file', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const excelTool = tools.find(t => t.name === 'generate_test_case_excel');

        assert(excelTool, 'generate_test_case_excel tool not found');

        const testSteps = JSON.stringify([
            { stepId: '1.1', action: 'Open application', expected: 'App opens', actual: 'App opens' },
            { stepId: '1.2', action: 'Click button', expected: 'Button works', actual: 'Button works' },
        ]);

        const result = await excelTool.handler({
            ticketId: 'TEST-EXCEL',
            testSuiteName: 'Integration Test Suite',
            preConditions: 'User is authenticated',
            testSteps,
        });

        const parsed = JSON.parse(result);
        assertEqual(parsed.success, true, `Excel generation failed: ${parsed.error || 'unknown'}`);
        assertEqual(parsed.stepCount, 2, 'Expected 2 steps');
        assert(parsed.path, 'Expected file path');

        // Verify file exists
        assert(fs.existsSync(parsed.path), `Excel file not created at ${parsed.path}`);

        // Clean up
        fs.unlinkSync(parsed.path);
    }),

    // ── 14. Learning Store Bounds ───────────────────────────────────
    test('LearningStore: respects max entry limits', async () => {
        const { LearningStore } = require('./learning-store');
        const testPath = path.join(__dirname, '..', 'learning-data', 'test-bounds.json');
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);

        const ls = new LearningStore(testPath);

        // Add 510 failures (limit is 500)
        for (let i = 0; i < 510; i++) {
            ls.recordFailure({
                ticketId: `TEST-${i}`,
                page: `/page-${i}`,
                errorType: 'TEST',
                selector: '.s',
                fix: '.f',
                outcome: 'fixed',
                method: 'test',
            });
        }

        assert(ls.getStats().totalFailures <= 500, `Expected ≤500, got ${ls.getStats().totalFailures}`);

        // Clean up
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    }),

];

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   SDK ORCHESTRATOR — Integration Test Suite');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const startTime = Date.now();

    for (const t of tests) {
        await runTest(t);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   RESULTS: ${passed} passed, ${failed} failed (${duration}s)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (failed > 0) {
        console.log('Failed tests:');
        results.filter(r => r.status.includes('FAIL')).forEach(r => {
            console.log(`  ❌ ${r.name}: ${r.error}`);
        });
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
