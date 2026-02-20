/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MCP TOOL NAMES - SINGLE SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * CANONICAL reference for all MCP tool names used across the workflow pipeline.
 * ALL scripts MUST import from this module instead of defining tool names inline.
 * 
 * Usage:
 *   const { MCP_TOOLS, TOOL_ALIASES, getTool } = require('./shared/mcp-tool-names');
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Playwright MCP Tool Names
 * Primary for: navigation, element interactions, accessibility snapshots, form filling
 */
const PLAYWRIGHT = {
    // Navigation & Page Control
    navigate: 'unified_navigate',
    navigateBack: 'unified_navigate_back',
    navigateForward: 'unified_navigate_forward',
    tabs: 'unified_tabs',
    close: 'unified_browser_close',
    install: 'unified_browser_install',

    // Snapshots & Screenshots
    snapshot: 'unified_snapshot',
    screenshot: 'unified_screenshot',

    // Interactions
    click: 'unified_click',
    type: 'unified_type',
    selectOption: 'unified_select_option',
    hover: 'unified_hover',
    drag: 'unified_drag',
    check: 'unified_check',
    uncheck: 'unified_uncheck',

    // Forms
    fillForm: 'unified_fill_form',
    fileUpload: 'unified_file_upload',
    clearInput: 'unified_clear_input',

    // Wait & Sync
    waitFor: 'unified_wait_for',

    // Advanced
    evaluate: 'unified_evaluate',
    runCode: 'unified_run_playwright_code',
    pressSequentially: 'unified_press_sequentially',
    blur: 'unified_blur',

    // Debugging / Monitoring
    consoleMessages: 'unified_console_messages',
    networkRequests: 'unified_network_requests',

    // Element Info
    getAttribute: 'unified_get_attribute',
    getByRole: 'unified_get_by_role',
    generateLocator: 'unified_generate_locator',
    getPageTitle: 'unified_get_page_title',
    isPageClosed: 'unified_is_page_closed',

    // Resize & Emulate
    resize: 'unified_resize',
    emulate: 'unified_emulate'
};

/**
 * Chrome DevTools MCP Tool Names
 * Specialized for: JS evaluation, performance tracing, network monitoring, file uploads
 */
const CHROME_DEVTOOLS = {
    // Script Execution
    evaluateScript: 'unified_evaluate_cdp',
    takeSnapshot: 'unified_take_snapshot_cdp',

    // Element Interaction (via CDP)
    hover: 'unified_hover',
    fillForm: 'unified_fill_form',

    // Waiting
    waitFor: 'unified_wait_for',

    // Dialog Handling
    handleDialog: 'unified_handle_dialog',

    // File Upload
    uploadFile: 'unified_file_upload',

    // Console & Network
    listConsoleMessages: 'unified_console_messages_cdp',
    getNetworkRequest: 'unified_get_network_request',
    listNetworkRequests: 'unified_network_requests_cdp',

    // Performance
    performanceStartTrace: 'unified_performance_start_trace',
    performanceStopTrace: 'unified_performance_stop_trace',
    performanceAnalyze: 'unified_performance_analyze',

    // Cookies
    addCookies: 'unified_add_cookies',
    savePdf: 'unified_save_download'
};

/**
 * Combined MCP_TOOLS object — backwards-compatible with existing usages
 */
const MCP_TOOLS = {
    PLAYWRIGHT,
    CHROME: CHROME_DEVTOOLS,
    // Aliases with metadata for workflow tools
    playwright: {
        prefix: 'unified_',
        tools: PLAYWRIGHT,
        purpose: 'Page navigation, interactions, accessibility snapshots, form filling'
    },
    chromeDevTools: {
        prefix: 'unified_',
        tools: CHROME_DEVTOOLS,
        purpose: 'JS evaluation, performance tracing, network monitoring, file uploads'
    }
};

/**
 * Tool aliases for convenience (short name → full tool name)
 */
const TOOL_ALIASES = {
    navigate: PLAYWRIGHT.navigate,
    goto: PLAYWRIGHT.navigate,
    back: PLAYWRIGHT.navigateBack,
    forward: PLAYWRIGHT.navigateForward,
    snapshot: PLAYWRIGHT.snapshot,
    click: PLAYWRIGHT.click,
    type: PLAYWRIGHT.type,
    fill: PLAYWRIGHT.type,
    hover: PLAYWRIGHT.hover,
    drag: PLAYWRIGHT.drag,
    select: PLAYWRIGHT.selectOption,
    wait: PLAYWRIGHT.waitFor,
    tabs: PLAYWRIGHT.tabs,
    evaluate: CHROME_DEVTOOLS.evaluateScript,
    eval: CHROME_DEVTOOLS.evaluateScript,
    dialog: CHROME_DEVTOOLS.handleDialog,
    upload: PLAYWRIGHT.fileUpload,
    performance: CHROME_DEVTOOLS.performanceStartTrace,
    network: PLAYWRIGHT.networkRequests,
    console: PLAYWRIGHT.consoleMessages
};

/**
 * Quick access shortcuts for most common tools
 */
const Tools = {
    navigate: PLAYWRIGHT.navigate,
    snapshot: PLAYWRIGHT.snapshot,
    click: PLAYWRIGHT.click,
    type: PLAYWRIGHT.type,
    hover: PLAYWRIGHT.hover,
    waitFor: PLAYWRIGHT.waitFor,
    evaluate: CHROME_DEVTOOLS.evaluateScript,
    back: PLAYWRIGHT.navigateBack,
    tabs: PLAYWRIGHT.tabs,
    fillForm: PLAYWRIGHT.fillForm,
    selectOption: PLAYWRIGHT.selectOption,
    uploadFile: PLAYWRIGHT.fileUpload,
    handleDialog: CHROME_DEVTOOLS.handleDialog,
    networkRequests: PLAYWRIGHT.networkRequests,
    consoleMessages: PLAYWRIGHT.consoleMessages
};

/**
 * Helper to get full tool name from category + key
 * @param {string} category - 'playwright' or 'chromeDevTools'
 * @param {string} toolKey - Key within the category
 * @returns {string|null} Full tool name or null
 */
function getTool(category, toolKey) {
    const map = { playwright: PLAYWRIGHT, chromeDevTools: CHROME_DEVTOOLS, chrome: CHROME_DEVTOOLS };
    const cat = map[category] || map[category.toLowerCase()];
    if (!cat || !cat[toolKey]) {
        console.warn(`⚠️ Unknown MCP tool: ${category}.${toolKey}`);
        return null;
    }
    return cat[toolKey];
}

/**
 * Resolve a tool alias to the canonical tool name
 * @param {string} alias - Tool alias or full name
 * @returns {string} Canonical tool name
 */
function resolveAlias(alias) {
    return TOOL_ALIASES[alias] || alias;
}

module.exports = {
    MCP_TOOLS,
    PLAYWRIGHT,
    CHROME_DEVTOOLS,
    TOOL_ALIASES,
    Tools,
    getTool,
    resolveAlias
};
