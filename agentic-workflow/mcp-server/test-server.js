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
        const navigateTool = UNIFIED_TOOLS.find(t => t.name === 'unified_navigate');

        if (clickTool.inputSchema.required?.includes('ref') &&
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
