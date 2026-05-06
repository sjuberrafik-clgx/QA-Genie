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
            assert(toolNames.includes('unified_tool_search'), 'unified_tool_search missing from tools/list');
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

    console.log('\nTest 4: explorer-nav profile exposes complex-surface exploration tools');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'false', MCP_TOOL_PROFILE: 'explorer-nav' }, async (server) => {
            const response = await server.listToolsResponse();
            const toolNames = response.tools.map((tool) => tool.name);

            assert(toolNames.includes('unified_click'), 'unified_click missing from explorer-nav profile');
            assert(toolNames.includes('unified_wait_for_response'), 'unified_wait_for_response missing from explorer-nav profile');
            assert(toolNames.includes('unified_list_frames'), 'unified_list_frames missing from explorer-nav profile');
            assert(toolNames.includes('unified_shadow_dom_query'), 'unified_shadow_dom_query missing from explorer-nav profile');
            assert(toolNames.includes('unified_get_local_storage'), 'unified_get_local_storage missing from explorer-nav profile');
            assert(toolNames.includes('unified_collect_virtualized_list'), 'unified_collect_virtualized_list missing from explorer-nav profile');
            assert(toolNames.includes('unified_snapshot_diff'), 'unified_snapshot_diff missing from explorer-nav profile');
        });

        console.log('  ✓ explorer-nav exposes interaction + complex-surface tools for no-stop exploration');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        failed++;
    }

    console.log('\nTest 5: wait_for_load_state and wait_for_navigation work through server call path');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'false', MCP_TOOL_PROFILE: 'full' }, async (server) => {
            const waitLoadResult = parseToolResult(await server.callToolResponse('unified_wait_for_load_state', {
                state: 'domcontentloaded',
                timeout: 10000,
            }));
            assert(waitLoadResult.success === true, 'wait_for_load_state did not succeed');

            const navigateResult = parseToolResult(await server.callToolResponse('unified_navigate', {
                url: 'data:text/html,<title>wait-nav-test</title><h1>ready</h1>',
                waitUntil: 'load',
            }));
            assert(navigateResult.success === true, 'navigate before wait_for_navigation did not succeed');

            const waitNavResult = parseToolResult(await server.callToolResponse('unified_wait_for_navigation', {
                urlPattern: '**',
                waitUntil: 'commit',
                timeout: 10000,
            }));
            assert(waitNavResult.success === true, 'wait_for_navigation did not succeed');
        });

        console.log('  ✓ New wait primitives round-trip through tools/call');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        failed++;
    }

    console.log('\nTest 6: virtualized list and snapshot diff helpers work through server call path');
    try {
        await withServer({ MCP_DEFERRED_LOADING: 'false', MCP_TOOL_PROFILE: 'full' }, async (server) => {
            const listHtml = `
                <title>virtualized-list-test</title>
                <div id="list" style="height:180px; overflow:auto; border:1px solid #ccc;">
                    ${Array.from({ length: 30 }, (_, i) => `<div class="item" data-id="item-${i + 1}" style="height:40px;">Item ${i + 1}</div>`).join('')}
                </div>
            `;

            const navigateListResult = parseToolResult(await server.callToolResponse('unified_navigate', {
                url: `data:text/html,${encodeURIComponent(listHtml)}`,
                waitUntil: 'load',
            }));
            assert(navigateListResult.success === true, 'navigate to virtualized list test page failed');

            const collectResult = parseToolResult(await server.callToolResponse('unified_collect_virtualized_list', {
                containerSelector: '#list',
                itemSelector: '.item',
                maxScrolls: 8,
                waitBetweenMs: 50,
                stopWhenNoNewItems: 2,
            }));

            assert(collectResult.success === true, 'collect_virtualized_list did not succeed');
            assert((collectResult.totalUniqueItems || 0) >= 20, `expected >=20 items, got ${collectResult.totalUniqueItems}`);

            const diffHtml = `
                <title>snapshot-diff-test</title>
                <button id="btn-a">A</button>
                <script>
                    window.addEventListener('load', () => {
                        setTimeout(() => {
                            const b = document.createElement('button');
                            b.id = 'btn-b';
                            b.textContent = 'B';
                            document.body.appendChild(b);
                        }, 1200);
                    });
                </script>
            `;
            const navigateDiffResult = parseToolResult(await server.callToolResponse('unified_navigate', {
                url: `data:text/html,${encodeURIComponent(diffHtml)}`,
                waitUntil: 'load',
            }));
            assert(navigateDiffResult.success === true, 'navigate to snapshot diff test page failed');

            const baselineResult = parseToolResult(await server.callToolResponse('unified_snapshot_diff', {
                mode: 'set-baseline',
                filter: { roles: ['button'] },
            }));
            assert(baselineResult.success === true, 'snapshot_diff set-baseline did not succeed');

            const waitResult = parseToolResult(await server.callToolResponse('unified_wait_for', {
                text: 'B',
                timeout: 8000,
            }));
            assert(waitResult.success === true, 'wait_for did not detect delayed button creation');

            const diffResult = parseToolResult(await server.callToolResponse('unified_snapshot_diff', {
                mode: 'diff',
                filter: { roles: ['button'] },
            }));

            assert(diffResult.success === true, 'snapshot_diff diff did not succeed');
            assert((diffResult.addedCount || 0) >= 1, `expected at least one added element, got ${diffResult.addedCount}`);
        });

        console.log('  ✓ virtualized list collection and snapshot diffs round-trip through tools/call');
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