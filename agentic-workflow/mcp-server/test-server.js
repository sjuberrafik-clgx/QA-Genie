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
import { PlaywrightBridge } from './bridges/playwright-bridge-direct.js';
import fs from 'fs';
import path from 'path';

function createMockPage(url = 'about:blank', title = '') {
    return {
        _url: url,
        _title: title,
        _isClosed: false,
        _handlers: new Map(),
        on(event, handler) {
            this._handlers.set(event, handler);
        },
        url() {
            return this._url;
        },
        async goto(nextUrl) {
            this._url = nextUrl;
            return { url: this._url };
        },
        async title() {
            return this._title;
        },
        async bringToFront() {
            this._broughtToFront = true;
        },
        async close() {
            this._isClosed = true;
        },
        isClosed() {
            return this._isClosed;
        },
    };
}

function createMockContext(initialPages = []) {
    const pages = [...initialPages];
    return {
        pages() {
            return pages.filter(page => !page._isClosed);
        },
        async newPage() {
            const page = createMockPage();
            pages.push(page);
            return page;
        },
    };
}

function createInteractionMockPage(options = {}) {
    const state = {
        checked: options.checked ?? false,
        visible: options.visible ?? true,
        clickedSelectors: [],
        hoveredSelectors: [],
        selectedOptions: [],
        typedValues: [],
        waitForSelectors: [],
        waitForTimeouts: [],
        filledValues: [],
        keyPresses: [],
        acceptedPrompt: null,
        dismissed: false,
    };

    return {
        state,
        _isClosed: false,
        isClosed() {
            return this._isClosed;
        },
        async click(selector) {
            state.clickedSelectors.push(selector);
            if (typeof options.onClick === 'function') {
                await options.onClick(selector, state);
            }
        },
        async hover(selector) {
            state.hoveredSelectors.push(selector);
        },
        async type(selector, text) {
            state.typedValues.push({ selector, text });
        },
        async fill(selector, value) {
            state.filledValues.push({ selector, value });
            return undefined;
        },
        async selectOption(selector, option) {
            state.selectedOptions.push({ selector, option });
            return undefined;
        },
        async waitForSelector(selector) {
            state.waitForSelectors.push(selector);
            if (options.waitForSelectorError) {
                throw new Error(options.waitForSelectorError);
            }
            return undefined;
        },
        async waitForTimeout(ms) {
            state.waitForTimeouts.push(ms);
            return undefined;
        },
        keyboard: {
            press: async (key) => {
                state.keyPresses.push(key);
                if (typeof options.onKeyPress === 'function') {
                    await options.onKeyPress(key, state);
                }
            },
        },
        async evaluate() {
            return options.evaluateResult ?? null;
        },
        locator(selector) {
            return {
                async check() {
                    if (options.checkChangesState !== false) {
                        state.checked = true;
                    }
                },
                async isChecked() {
                    return state.checked;
                },
                async isVisible() {
                    return state.visible;
                },
                async evaluate(callback) {
                    const element = { outerHTML: `<input selector="${selector}">` };
                    return callback(element);
                },
            };
        },
    };
}

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

    // Test 13: Tab tool discoverability
    console.log('\nTest 13: Tab Tool Discoverability');
    try {
        const hasTabsTool = UNIFIED_TOOLS.some(t => t.name === 'unified_tabs');
        const hasCreateTabTool = UNIFIED_TOOLS.some(t => t.name === 'unified_create_tab');
        if (hasTabsTool && hasCreateTabTool) {
            console.log('  ✓ unified_tabs and unified_create_tab are defined in the tool registry');
            passed++;
        } else {
            throw new Error('tab tools missing from tool registry');
        }
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 14: Tab creation contract
    console.log('\nTest 14: Tab Creation Contract');
    try {
        const firstPage = createMockPage('https://example.com', 'Example');
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        bridge.context = createMockContext([firstPage]);
        bridge.page = firstPage;
        bridge.connected = true;

        const createResult = await bridge.createTab({ url: 'https://example.org', activate: true });
        const listResult = await bridge.manageTabs({ action: 'list' });

        if (createResult.success !== true) {
            throw new Error('create action did not succeed');
        }

        if (!createResult.tabId) {
            throw new Error('create action did not return a stable tabId');
        }

        if (listResult.tabs.length !== 2) {
            throw new Error(`expected 2 tabs after create, got ${listResult.tabs.length}`);
        }

        if (!listResult.tabs[1].tabId || listResult.tabs[1].url !== 'https://example.org') {
            throw new Error('tab listing did not include stable tab metadata');
        }

        if (bridge.page !== bridge.context.pages()[1]) {
            throw new Error('newly created tab was not set as active page');
        }

        console.log('  ✓ create action opens a new tab in the same context and activates it');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 15: Legacy new alias compatibility
    console.log('\nTest 15: Legacy New Alias');
    try {
        const firstPage = createMockPage('https://example.com', 'Example');
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        bridge.context = createMockContext([firstPage]);
        bridge.page = firstPage;
        bridge.connected = true;

        const createResult = await bridge.manageTabs({ action: 'new' });
        const selectedResult = await bridge.manageTabs({ action: 'select', tabId: createResult.tabId });
        const closeResult = await bridge.manageTabs({ action: 'close', tabId: createResult.tabId });

        if (createResult.success !== true || createResult.action !== 'create') {
            throw new Error('legacy new alias did not normalize to create');
        }

        if (selectedResult.tabId !== createResult.tabId) {
            throw new Error('select by tabId did not target the created tab');
        }

        if (closeResult.closedTabId !== createResult.tabId) {
            throw new Error('close by tabId did not report the closed tabId');
        }

        console.log('  ✓ legacy new alias remains backward compatible and stable tabId targeting works');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 16: Native dialog blocker prevents misleading click actions
    console.log('\nTest 16: Native Dialog Blocker Classification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        bridge.page = createInteractionMockPage();
        bridge.connected = true;
        bridge._activeDialog = {
            id: 'dialog-1',
            kind: 'native-dialog',
            type: 'alert',
            message: 'You must check at least 1 item.',
            blocking: true,
            handled: false,
            timestamp: Date.now(),
        };

        const result = await bridge.click({ element: '#share-link' });

        if (result.success !== false || result.errorCode !== 'RUNTIME_BLOCKER') {
            throw new Error('click did not classify the native dialog blocker');
        }

        if (bridge.page.state.clickedSelectors.length !== 0) {
            throw new Error('click executed despite an active native dialog blocker');
        }

        console.log('  ✓ active native dialogs are surfaced as blockers before click execution');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 17: Check action verifies resulting checkbox state
    console.log('\nTest 17: Check Post-Action Verification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        bridge.page = createInteractionMockPage({ checkChangesState: false });
        bridge.connected = true;

        const result = await bridge.check({ selector: '#result-row-checkbox' });

        if (result.success !== false || result.errorCode !== 'ACTION_VERIFICATION_FAILED') {
            throw new Error('check did not fail when the checkbox state stayed unchanged');
        }

        console.log('  ✓ check() reports failure when the checkbox never becomes checked');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 18: Handle dialog resolves active dialog immediately
    console.log('\nTest 18: Immediate Dialog Resolution');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        const page = createInteractionMockPage();
        bridge.page = page;
        bridge.connected = true;

        const dialogHandle = {
            async accept(promptText) {
                page.state.acceptedPrompt = promptText;
            },
            async dismiss() {
                page.state.dismissed = true;
            },
        };

        bridge._activeDialog = {
            id: 'dialog-2',
            kind: 'native-dialog',
            type: 'prompt',
            message: 'Enter value',
            blocking: true,
            handled: false,
            timestamp: Date.now(),
            dialogHandle,
        };

        const result = await bridge.handleDialog({ accept: true, promptText: 'approved' });

        if (result.success !== true || result.action !== 'accepted') {
            throw new Error('active dialog was not resolved immediately');
        }

        if (page.state.acceptedPrompt !== 'approved') {
            throw new Error('dialog accept did not forward the prompt text');
        }

        if (bridge._activeDialog !== null) {
            throw new Error('active dialog should be cleared after resolution');
        }

        console.log('  ✓ handleDialog() resolves currently active dialogs instead of only arming future ones');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 19: Hover respects blocker-aware pre-checks
    console.log('\nTest 19: Hover Blocker Classification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false, autoDismissKnownPopups: false });
        bridge.page = createInteractionMockPage();
        bridge.connected = true;
        bridge._activeDialog = {
            id: 'dialog-3',
            kind: 'native-dialog',
            type: 'alert',
            message: 'Hover blocked',
            blocking: true,
            handled: false,
            timestamp: Date.now(),
        };

        const result = await bridge.hover({ element: '#menu-trigger' });

        if (result.success !== false || result.errorCode !== 'RUNTIME_BLOCKER') {
            throw new Error('hover did not classify the blocker');
        }

        if (bridge.page.state.hoveredSelectors.length !== 0) {
            throw new Error('hover executed despite the blocker');
        }

        console.log('  ✓ hover() respects blocker-aware pre-checks');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 20: Select option respects blocker-aware pre-checks
    console.log('\nTest 20: Select Option Blocker Classification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false, autoDismissKnownPopups: false });
        bridge.page = createInteractionMockPage();
        bridge.connected = true;
        bridge._activeDialog = {
            id: 'dialog-4',
            kind: 'native-dialog',
            type: 'alert',
            message: 'Select blocked',
            blocking: true,
            handled: false,
            timestamp: Date.now(),
        };

        const result = await bridge.selectOption({ element: '#sort-order', value: 'price-desc' });

        if (result.success !== false || result.errorCode !== 'RUNTIME_BLOCKER') {
            throw new Error('selectOption did not classify the blocker');
        }

        if (bridge.page.state.selectedOptions.length !== 0) {
            throw new Error('selectOption executed despite the blocker');
        }

        console.log('  ✓ selectOption() respects blocker-aware pre-checks');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 21: Wait returns blocker result when selector wait is obstructed
    console.log('\nTest 21: Wait Blocker Classification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false, autoDismissKnownPopups: false });
        bridge.page = createInteractionMockPage({ waitForSelectorError: 'Timed out waiting for selector' });
        bridge.connected = true;
        bridge._activeDialog = {
            id: 'dialog-5',
            kind: 'native-dialog',
            type: 'alert',
            message: 'Wait blocked',
            blocking: true,
            handled: false,
            timestamp: Date.now(),
        };

        const result = await bridge.waitFor({ selector: '#results-grid', state: 'visible' });

        if (result.success !== false || result.errorCode !== 'RUNTIME_BLOCKER') {
            throw new Error('waitFor did not return a blocker result');
        }

        console.log('  ✓ waitFor() returns blocker results instead of generic failure when blocked');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 22: Known popup auto-dismiss retries the interaction path safely
    console.log('\nTest 22: Known Popup Auto-Dismiss');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false, autoDismissKnownPopups: true });
        const page = createInteractionMockPage();
        bridge.page = page;
        bridge.connected = true;
        let blockerPresent = true;

        bridge._detectDomModalBlocker = async () => blockerPresent ? {
            id: 'dom-modal-1',
            kind: 'dom-modal',
            text: 'Known popup',
            blocking: true,
            timestamp: Date.now(),
        } : null;

        bridge._popupHandlerClass = class MockPopupHandler {
            constructor(mockPage) {
                this.page = mockPage;
            }

            async dismissAll() {
                blockerPresent = false;
            }
        };

        const result = await bridge.hover({ element: '#recoverable-target' });

        if (result.success !== true) {
            throw new Error('hover should proceed after known popup dismissal');
        }

        if (page.state.hoveredSelectors.length !== 1) {
            throw new Error('hover did not resume after popup dismissal');
        }

        console.log('  ✓ known DOM popups are auto-dismissed before retrying the interaction');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 23: Unknown informational modals recover via discovered dismiss controls
    console.log('\nTest 23: Discovered Informational Modal Recovery');
    try {
        const bridge = new PlaywrightBridge({
            captureConsole: false,
            captureNetwork: false,
            autoDismissKnownPopups: true,
            autoDismissDiscoveredBlockers: true,
        });
        let blockerPresent = true;
        const dismissSelector = 'button:has-text("I\'ve Read This")';
        const page = createInteractionMockPage({
            onClick: async (selector) => {
                if (selector === dismissSelector) {
                    blockerPresent = false;
                }
            },
        });
        bridge.page = page;
        bridge.connected = true;
        bridge._popupHandlerClass = class MockPopupHandler {
            async dismissAll() {
                return undefined;
            }
        };
        bridge._detectDomModalBlocker = async () => blockerPresent ? {
            id: 'dom-modal-2',
            kind: 'dom-modal',
            text: 'Things that will get you fined part 2',
            blocking: true,
            timestamp: Date.now(),
            dismissControls: [
                { text: 'Print', selectorHint: 'button:has-text("Print")' },
                { text: 'Read Later', selectorHint: 'button:has-text("Read Later")' },
                { text: 'I\'ve Read This', selectorHint: dismissSelector },
            ],
        } : null;

        const result = await bridge.click({ element: '#matrix-card' });

        if (result.success !== true) {
            throw new Error('click should proceed after discovered dismiss control resolves the blocker');
        }

        if (!page.state.clickedSelectors.includes(dismissSelector)) {
            throw new Error('discovered dismiss control was not clicked');
        }

        if (!page.state.clickedSelectors.includes('#matrix-card')) {
            throw new Error('target interaction did not resume after blocker recovery');
        }

        console.log('  ✓ unknown informational modals recover via safe discovered dismiss controls');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 24: Auth blockers are classified and not auto-dismissed generically
    console.log('\nTest 24: Auth Blockers Stay Protected');
    try {
        const bridge = new PlaywrightBridge({
            captureConsole: false,
            captureNetwork: false,
            autoDismissKnownPopups: true,
            autoDismissDiscoveredBlockers: true,
        });
        const page = createInteractionMockPage();
        bridge.page = page;
        bridge.connected = true;
        bridge._popupHandlerClass = class MockPopupHandler {
            async dismissAll() {
                return undefined;
            }
        };
        bridge._detectDomModalBlocker = async () => ({
            id: 'dom-modal-3',
            kind: 'dom-modal',
            text: 'Session expired. Please sign in again to continue.',
            blocking: true,
            timestamp: Date.now(),
            dismissControls: [
                { text: 'Continue', selectorHint: 'button:has-text("Continue")' },
            ],
        });

        const result = await bridge.click({ element: '#secure-target' });

        if (result.success !== false || result.errorCode !== 'RUNTIME_BLOCKER') {
            throw new Error('auth blocker should remain blocked for manual or auth-aware recovery');
        }

        if (result.blocker?.classification?.category !== 'auth-required') {
            throw new Error(`expected auth-required classification, got ${result.blocker?.classification?.category}`);
        }

        if (page.state.clickedSelectors.length !== 0) {
            throw new Error('auth blocker should not auto-click dismiss controls or the target');
        }

        console.log('  ✓ auth-required blockers are classified and protected from blind auto-dismissal');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 25: Router auto-recovers snapshot blockers and retries once
    console.log('\nTest 25: Router Snapshot Blocker Recovery');
    try {
        let callCount = 0;
        let recoveryCount = 0;
        const playwrightBridge = {
            isConnected() {
                return true;
            },
            async callTool(toolName) {
                callCount++;
                if (toolName !== 'browser_snapshot') {
                    throw new Error(`unexpected tool ${toolName}`);
                }

                if (callCount === 1) {
                    return {
                        blockerState: {
                            present: true,
                            blocker: {
                                kind: 'dom-overlay',
                                classification: {
                                    category: 'informational-modal',
                                    autoRecoverable: true,
                                },
                            },
                        },
                        elements: [],
                    };
                }

                return {
                    blockerState: { present: false, blocker: null },
                    elements: [{ ref: '1', role: 'button', name: 'Open' }],
                };
            },
            async recoverCurrentBlocker() {
                recoveryCount++;
                return { recovered: true };
            },
        };
        const chromeDevToolsBridge = {
            setPlaywrightBridge() { },
            isConnected() {
                return true;
            },
            async callTool() {
                return {};
            },
        };

        const router = new IntelligentRouter(playwrightBridge, chromeDevToolsBridge);
        const result = await router.route('unified_snapshot', {});

        if (callCount !== 2) {
            throw new Error(`expected snapshot to be retried once, got ${callCount} calls`);
        }

        if (recoveryCount !== 1) {
            throw new Error(`expected 1 blocker recovery, got ${recoveryCount}`);
        }

        if (result.blockerState?.present !== false || result.routeRecovery?.recovered !== true) {
            throw new Error('router did not return the recovered retry result');
        }

        console.log('  ✓ router retries snapshot after recoverable blocker recovery');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 26: Blocker registry reuses a previously learned dismiss control
    console.log('\nTest 26: Blocker Registry Reuse');
    try {
        const registryPath = path.join(process.cwd(), `.tmp-blocker-registry-${Date.now()}.json`);
        const dismissSelector = 'button:has-text("I\'ve Read This")';
        let blockerPresent = true;

        const bridge = new PlaywrightBridge({
            captureConsole: false,
            captureNetwork: false,
            blockerRegistryPath: registryPath,
        });
        bridge.page = createInteractionMockPage({
            onClick: async (selector) => {
                if (selector === dismissSelector) {
                    blockerPresent = false;
                }
            },
        });
        bridge.connected = true;
        bridge._popupHandlerClass = class MockPopupHandler {
            async dismissAll() {
                return undefined;
            }
        };
        bridge._detectDomModalBlocker = async () => blockerPresent ? {
            id: 'dom-modal-registry',
            kind: 'dom-modal',
            text: 'Things that will get you fined part 2',
            blocking: true,
            selectorHint: '#news-modal',
            timestamp: Date.now(),
            dismissControls: [
                { text: 'I\'ve Read This', selectorHint: dismissSelector },
            ],
        } : null;

        const firstResult = await bridge.click({ element: '#news-card' });
        if (firstResult.success !== true) {
            throw new Error('initial discovery run failed to resolve blocker');
        }

        blockerPresent = true;
        const secondBridge = new PlaywrightBridge({
            captureConsole: false,
            captureNetwork: false,
            blockerRegistryPath: registryPath,
        });
        secondBridge.page = createInteractionMockPage({
            onClick: async (selector) => {
                if (selector === dismissSelector) {
                    blockerPresent = false;
                }
            },
        });
        secondBridge.connected = true;
        secondBridge._popupHandlerClass = class MockPopupHandler {
            async dismissAll() {
                return undefined;
            }
        };
        secondBridge._detectDomModalBlocker = async () => blockerPresent ? {
            id: 'dom-modal-registry',
            kind: 'dom-modal',
            text: 'Things that will get you fined part 2',
            blocking: true,
            selectorHint: '#news-modal',
            timestamp: Date.now(),
            dismissControls: [],
        } : null;

        const secondResult = await secondBridge.click({ element: '#news-card' });
        if (secondResult.success !== true) {
            throw new Error('registry-backed recovery failed on subsequent run');
        }

        if (!secondBridge.page.state.clickedSelectors.includes(dismissSelector)) {
            throw new Error('registry did not replay the learned dismiss control');
        }

        fs.unlinkSync(registryPath);
        console.log('  ✓ blocker registry reuses learned dismiss controls across runs');
        passed++;
    } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        failed++;
    }

    // Test 27: Occlusion blocker metadata is classified through getBlockingState
    console.log('\nTest 27: Target Occlusion Classification');
    try {
        const bridge = new PlaywrightBridge({ captureConsole: false, captureNetwork: false });
        bridge.page = {
            isClosed() {
                return false;
            },
            async evaluate(_fn, args) {
                return {
                    id: 'dom-occlusion-1',
                    kind: 'dom-occlusion',
                    text: 'Screen overlay',
                    blocking: true,
                    occlusion: { targetSelector: args.targetSelector, pointsBlocked: 2 },
                    focusTrap: true,
                    dismissControls: [{ text: 'Close', selectorHint: 'button:has-text("Close")' }],
                    timestamp: Date.now(),
                };
            },
        };
        bridge.connected = true;

        const state = await bridge.getBlockingState({ targetSelector: '#primary-cta' });

        if (state.present !== true) {
            throw new Error('expected a blocker to be present');
        }

        if (state.blocker.kind !== 'dom-occlusion' || state.blocker.classification?.category !== 'occluding-overlay') {
            throw new Error('occlusion blocker was not classified correctly');
        }

        if (state.blocker.occlusion?.targetSelector !== '#primary-cta' || state.blocker.focusTrap !== true) {
            throw new Error('occlusion metadata was not preserved');
        }

        console.log('  ✓ target occlusion blockers include classification and interaction metadata');
        passed++;
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
