/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MCP SERVER TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Tests for the Unified Automation MCP Server
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { UNIFIED_TOOLS, getToolSource, getSourceToolName, getToolCategory } from './tools/tool-definitions.js';
import { IntelligentRouter, ToolRecommendationEngine } from './router/intelligent-router.js';
import { ServerConfig, CONFIG_PRESETS } from './config/server-config.js';
import { ScriptGenerator, LocatorGenerator } from './utils/script-generator.js';

/**
 * Test runner
 */
async function runTests() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(' UNIFIED AUTOMATION MCP SERVER - TEST SUITE');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let passed = 0;
    let failed = 0;

    // Test 1: Tool definitions
    console.log('Test 1: Tool Definitions');
    try {
        if (UNIFIED_TOOLS.length > 0) {
            console.log(`  ✓ Loaded ${UNIFIED_TOOLS.length} tools`);
            passed++;
        } else {
            throw new Error('No tools defined');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 2: Tool source mapping
    console.log('\nTest 2: Tool Source Mapping');
    try {
        const navigateSource = getToolSource('unified_navigate');
        const perfSource = getToolSource('unified_performance_start_trace');

        if (navigateSource === 'playwright' && perfSource === 'chromedevtools') {
            console.log('  ✓ Tool sources correctly mapped');
            passed++;
        } else {
            throw new Error('Tool sources not correctly mapped');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 3: Source tool name mapping
    console.log('\nTest 3: Source Tool Name Mapping');
    try {
        const sourceName = getSourceToolName('unified_click');
        if (sourceName === 'browser_click') {
            console.log('  ✓ Source tool names correctly mapped');
            passed++;
        } else {
            throw new Error(`Expected 'browser_click', got '${sourceName}'`);
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 4: Tool categories
    console.log('\nTest 4: Tool Categories');
    try {
        const categories = new Set(UNIFIED_TOOLS.map(t => t._meta?.category));
        const expectedCategories = ['navigation', 'interaction', 'snapshot', 'network', 'performance'];
        const hasExpected = expectedCategories.every(c => categories.has(c));

        if (hasExpected) {
            console.log(`  ✓ All expected categories present: ${[...categories].join(', ')}`);
            passed++;
        } else {
            throw new Error('Missing expected categories');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 5: Server configuration
    console.log('\nTest 5: Server Configuration');
    try {
        const config = new ServerConfig({
            playwright: { headless: false }
        });

        if (config.playwright.headless === false && config.playwright.browser === 'chromium') {
            console.log('  ✓ Configuration merging works correctly');
            passed++;
        } else {
            throw new Error('Configuration not merged correctly');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 6: Configuration presets
    console.log('\nTest 6: Configuration Presets');
    try {
        const presets = Object.keys(CONFIG_PRESETS);
        const expectedPresets = ['default', 'testing', 'performance', 'debug', 'ci'];

        if (expectedPresets.every(p => presets.includes(p))) {
            console.log(`  ✓ All presets available: ${presets.join(', ')}`);
            passed++;
        } else {
            throw new Error('Missing expected presets');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 7: Tool recommendations
    console.log('\nTest 7: Tool Recommendations');
    try {
        const recs = ToolRecommendationEngine.getRecommendations('click on the login button');

        if (recs.some(r => r.tool === 'unified_snapshot') && recs.some(r => r.tool === 'unified_click')) {
            console.log('  ✓ Recommendations include snapshot and click for click task');
            passed++;
        } else {
            throw new Error('Missing expected recommendations');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 8: Best tool for action
    console.log('\nTest 8: Best Tool Selection');
    try {
        const clickTool = ToolRecommendationEngine.getBestToolForAction('click');
        const perfTool = ToolRecommendationEngine.getBestToolForAction('performance');

        if (clickTool === 'unified_click' && perfTool === 'unified_performance_start_trace') {
            console.log('  ✓ Best tools correctly selected');
            passed++;
        } else {
            throw new Error('Best tools not correctly selected');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 9: Script generator
    console.log('\nTest 9: Script Generator');
    try {
        const generator = new ScriptGenerator();
        generator.recordAction({
            tool: 'unified_navigate',
            args: { url: 'https://example.com' },
        });
        generator.recordAction({
            tool: 'unified_click',
            args: { ref: 'btn-1', element: 'Login button' },
        });

        const script = generator.generateScript('Login Test');

        if (script.includes("await page.goto('https://example.com')") &&
            script.includes('test(') &&
            script.includes('click()')) {
            console.log('  ✓ Script generated correctly');
            passed++;
        } else {
            throw new Error('Script generation failed');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 10: Locator generator
    console.log('\nTest 10: Locator Generator');
    try {
        const locator = LocatorGenerator.generateLocator({
            role: 'button',
            accessibleName: 'Submit',
        });

        if (locator.type === 'role' && locator.code.includes("getByRole('button'")) {
            console.log('  ✓ Locator generated with correct strategy');
            passed++;
        } else {
            throw new Error('Locator not generated correctly');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 11: Input schema validation
    console.log('\nTest 11: Input Schema Structure');
    try {
        const toolsWithSchema = UNIFIED_TOOLS.filter(t => t.inputSchema?.type === 'object');

        if (toolsWithSchema.length === UNIFIED_TOOLS.length) {
            console.log('  ✓ All tools have valid input schemas');
            passed++;
        } else {
            throw new Error('Some tools missing input schemas');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 12: Required parameters
    console.log('\nTest 12: Required Parameters');
    try {
        const clickTool = UNIFIED_TOOLS.find(t => t.name === 'unified_click');
        const typeTool = UNIFIED_TOOLS.find(t => t.name === 'unified_type');
        const navigateTool = UNIFIED_TOOLS.find(t => t.name === 'unified_navigate');

        const clickProps = clickTool?.inputSchema?.properties || {};
        const clickSupportsRefOrElement = Boolean(clickProps.ref && clickProps.element);

        if (clickSupportsRefOrElement &&
            typeTool.inputSchema.required?.includes('text') &&
            navigateTool.inputSchema.required?.includes('url')) {
            console.log('  ✓ Required parameters correctly defined');
            passed++;
        } else {
            throw new Error('Required parameters not correctly defined');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 13: Backward-compatible alias routing
    console.log('\nTest 13: Backward-Compatible Alias Routing');
    try {
        const runCodeSource = getToolSource('unified_run_code');
        const evalScriptSource = getToolSource('unified_evaluate_script');
        const runCodeName = getSourceToolName('unified_run_code');
        const uploadName = getSourceToolName('unified_upload_file');

        if (runCodeSource === 'playwright' &&
            evalScriptSource === 'chromedevtools' &&
            runCodeName === 'browser_run_code' &&
            uploadName === 'browser_file_upload') {
            console.log('  ✓ Legacy aliases resolve to canonical source + tool mappings');
            passed++;
        } else {
            throw new Error('Alias source/tool mapping mismatch detected');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 14: Contract schema compatibility
    console.log('\nTest 14: Contract Schema Compatibility');
    try {
        const dragTool = UNIFIED_TOOLS.find(t => t.name === 'unified_drag');
        const selectTool = UNIFIED_TOOLS.find(t => t.name === 'unified_select_option');
        const waitTool = UNIFIED_TOOLS.find(t => t.name === 'unified_wait_for');

        const dragProps = dragTool?.inputSchema?.properties || {};
        const selectProps = selectTool?.inputSchema?.properties || {};
        const waitProps = waitTool?.inputSchema?.properties || {};

        const dragCompatible = dragProps.sourceRef && dragProps.targetRef && dragProps.startRef && dragProps.endRef;
        const selectCompatible = selectProps.value && selectProps.label && selectProps.values;
        const waitCompatible = waitProps.text && waitProps.textGone && waitProps.selector && waitProps.state;

        if (dragCompatible && selectCompatible && waitCompatible) {
            console.log('  ✓ Drag/select/wait schemas support current and legacy contracts');
            passed++;
        } else {
            throw new Error('Contract schema compatibility incomplete');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 15: Wait tool mapping and category
    console.log('\nTest 15: Wait Tool Mapping & Category');
    try {
        const waitLoadSource = getToolSource('unified_wait_for_load_state');
        const waitNavSource = getToolSource('unified_wait_for_navigation');
        const waitLoadSourceName = getSourceToolName('unified_wait_for_load_state');
        const waitNavSourceName = getSourceToolName('unified_wait_for_navigation');
        const waitLoadCategory = getToolCategory('unified_wait_for_load_state');
        const waitNavCategory = getToolCategory('unified_wait_for_navigation');

        if (waitLoadSource === 'playwright' &&
            waitNavSource === 'playwright' &&
            waitLoadSourceName === 'browser_wait_for_load_state' &&
            waitNavSourceName === 'browser_wait_for_navigation' &&
            waitLoadCategory === 'wait' &&
            waitNavCategory === 'wait') {
            console.log('  ✓ wait_for_load_state and wait_for_navigation map to Playwright wait tools');
            passed++;
        } else {
            throw new Error('New wait tool mapping/category mismatch detected');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 16: Exploration helper mapping and category
    console.log('\nTest 16: Exploration Helper Mapping & Category');
    try {
        const listSource = getToolSource('unified_collect_virtualized_list');
        const diffSource = getToolSource('unified_snapshot_diff');
        const listSourceName = getSourceToolName('unified_collect_virtualized_list');
        const diffSourceName = getSourceToolName('unified_snapshot_diff');
        const listCategory = getToolCategory('unified_collect_virtualized_list');
        const diffCategory = getToolCategory('unified_snapshot_diff');

        if (listSource === 'playwright' &&
            diffSource === 'playwright' &&
            listSourceName === 'browser_collect_virtualized_list' &&
            diffSourceName === 'browser_snapshot_diff' &&
            listCategory === 'scroll' &&
            diffCategory === 'snapshot') {
            console.log('  ✓ Exploration helper tools map to Playwright with expected categories');
            passed++;
        } else {
            throw new Error('Exploration helper mapping/category mismatch detected');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(` TEST RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    }
}

// Run tests
runTests().catch(console.error);
