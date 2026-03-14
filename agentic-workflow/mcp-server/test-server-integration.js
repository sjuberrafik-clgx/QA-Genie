/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MCP SERVER INTEGRATION TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Exercises server-level tools/list and tools/call behavior without starting a
 * transport, using the real UnifiedAutomationServer request-path logic.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { UnifiedAutomationServer } from './server.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function parseToolResult(response) {
    assert(response?.content?.[0]?.text, 'Missing MCP text response payload');
    return JSON.parse(response.content[0].text);
}

async function withServer(env, run) {
    const previousEnv = {
        MCP_DEFERRED_LOADING: process.env.MCP_DEFERRED_LOADING,
        MCP_TOOL_PROFILE: process.env.MCP_TOOL_PROFILE,
    };

    Object.assign(process.env, env);

    const server = new UnifiedAutomationServer({
        playwright: {
            headless: true,
            timeout: 10000,
            toolCallTimeout: 15000,
        },
    });

    try {
        await server.initialize();
        await run(server);
    } finally {
        await server.shutdown();

        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

async function runTests() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(' UNIFIED AUTOMATION MCP SERVER - INTEGRATION TEST SUITE');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let passed = 0;
    let failed = 0;

    console.log('Test 1: unified_create_tab is exposed in normal tools/list');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'false' }, async (server) => {
            const response = await server.listToolsResponse();
            const toolNames = response.tools.map((tool) => tool.name);

            assert(toolNames.includes('unified_create_tab'), 'unified_create_tab missing from tools/list');
            assert(toolNames.includes('unified_tabs'), 'unified_tabs missing from tools/list');
        });

        console.log('  ✓ unified_create_tab is exposed when deferred loading is off');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        failed++;
    }

    console.log('\nTest 2: unified_create_tab works through server call path');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'false' }, async (server) => {
            const createResult = parseToolResult(await server.callToolResponse('unified_create_tab', {
                url: 'data:text/html,<title>tab-test</title><h1>hello</h1>',
                activate: true,
            }));

            assert(createResult.success === true, 'create tab did not succeed');
            assert(typeof createResult.tabId === 'string' && createResult.tabId.length > 0, 'create tab did not return tabId');

            const listResult = parseToolResult(await server.callToolResponse('unified_tabs', {
                action: 'list',
            }));

            const createdTab = listResult.tabs.find((tab) => tab.tabId === createResult.tabId);
            assert(createdTab, 'created tabId not found in tab list');
            assert(createdTab.url.includes('data:text/html'), 'created tab url was not preserved');

            const selectResult = parseToolResult(await server.callToolResponse('unified_tabs', {
                action: 'select',
                tabId: createResult.tabId,
            }));
            assert(selectResult.activeTabId === createResult.tabId, 'select by tabId did not activate created tab');

            const closeResult = parseToolResult(await server.callToolResponse('unified_tabs', {
                action: 'close',
                tabId: createResult.tabId,
            }));
            assert(closeResult.closedTabId === createResult.tabId, 'close by tabId did not return closedTabId');
        });

        console.log('  ✓ unified_create_tab round-trips through tools/call with stable tabId behavior');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        failed++;
    }

    console.log('\nTest 3: unified_create_tab remains visible under deferred loading');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'true' }, async (server) => {
            const response = await server.listToolsResponse();
            const toolNames = response.tools.map((tool) => tool.name);

            assert(toolNames.includes('unified_create_tab'), 'unified_create_tab missing from deferred tools/list');
            assert(toolNames.includes('unified_tabs'), 'unified_tabs missing from deferred tools/list');
            assert(toolNames.includes('unified_tool_search'), 'unified_tool_search missing from deferred tools/list');
        });

        console.log('  ✓ unified_create_tab remains discoverable when deferred loading is on');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        failed++;
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(` INTEGRATION TEST RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((error) => {
    console.error(error);
    process.exit(1);
});