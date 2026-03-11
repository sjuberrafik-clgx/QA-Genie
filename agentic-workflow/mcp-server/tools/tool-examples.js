/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TOOL USE EXAMPLES — Anthropic Advanced Tool Calling (Technique 4)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Complex tools with many optional fields and conditional dependencies often cause LLM
 * parameter errors. Tool use examples show the LLM exactly how to call these tools,
 * improving accuracy from ~72% to ~90% on complex parameter handling (Anthropic benchmarks).
 *
 * Each entry maps a tool name to an array of example invocations showing correct usage.
 * Examples are injected into tool definitions at serve-time by server.js.
 *
 * Only the ~20 most error-prone tools get examples — keeps token cost to ~4-6K total.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export const TOOL_EXAMPLES = {

    // ─── Navigation ─────────────────────────────────────────────────────────────

    unified_navigate: [
        {
            description: 'Navigate to a URL and wait for full page load',
            input: { url: 'https://www.example.com/properties/map', waitUntil: 'networkidle' },
        },
        {
            description: 'Navigate with default load event',
            input: { url: 'https://www.example.com/login' },
        },
    ],

    // ─── Snapshot ───────────────────────────────────────────────────────────────

    unified_snapshot: [
        {
            description: 'Capture full accessibility snapshot of the page',
            input: {},
        },
        {
            description: 'Capture snapshot and filter to only interactive elements',
            input: { filter: { interactiveOnly: true } },
        },
        {
            description: 'Capture snapshot filtered by specific ARIA roles',
            input: { filter: { roles: ['button', 'link', 'textbox', 'combobox', 'heading'] } },
        },
    ],

    // ─── Form Filling (Most Error-Prone) ────────────────────────────────────────

    unified_fill_form: [
        {
            description: 'Fill a login form with email and password',
            input: {
                fields: [
                    { ref: 'email-input-ref', value: 'user@example.com' },
                    { ref: 'password-input-ref', value: 'securePass123' },
                ],
            },
        },
        {
            description: 'Fill a search form with city and price filters',
            input: {
                fields: [
                    { ref: 'city-search-ref', value: 'Charlotte, NC' },
                    { ref: 'min-price-ref', value: '200000' },
                    { ref: 'max-price-ref', value: '500000' },
                ],
            },
        },
    ],

    // ─── Select Option (Dropdown) ───────────────────────────────────────────────

    unified_select_option: [
        {
            description: 'Select a single value from a dropdown by value',
            input: { ref: 'beds-dropdown-ref', values: ['3'] },
        },
        {
            description: 'Select multiple options from a multi-select',
            input: { ref: 'amenities-ref', values: ['pool', 'garage', 'gym'] },
        },
    ],

    // ─── Click ──────────────────────────────────────────────────────────────────

    unified_click: [
        {
            description: 'Click a button using ref from snapshot',
            input: { ref: 'submit-button-ref', element: 'Submit button' },
        },
        {
            description: 'Right-click for context menu',
            input: { ref: 'image-ref', button: 'right' },
        },
        {
            description: 'Ctrl+click to open in new tab',
            input: { ref: 'property-link-ref', modifiers: ['Control'] },
        },
    ],

    // ─── Type ───────────────────────────────────────────────────────────────────

    unified_type: [
        {
            description: 'Type text into input and submit with Enter',
            input: { ref: 'search-input-ref', text: 'Charlotte', submit: true },
        },
        {
            description: 'Type slowly for inputs with key event handlers',
            input: { ref: 'autocomplete-ref', text: 'New York', slowly: true },
        },
    ],

    // ─── JavaScript Evaluation ──────────────────────────────────────────────────

    unified_evaluate: [
        {
            description: 'Get the scroll position of the page',
            input: { function: '() => ({ scrollX: window.scrollX, scrollY: window.scrollY })' },
        },
        {
            description: 'Count specific elements on the page',
            input: { function: '() => document.querySelectorAll("[data-qa]").length' },
        },
        {
            description: 'Extract computed style of an element by ref',
            input: {
                ref: 'header-ref',
                function: '(el) => window.getComputedStyle(el).backgroundColor',
            },
        },
    ],

    // ─── Handle Dialog ──────────────────────────────────────────────────────────

    unified_handle_dialog: [
        {
            description: 'Accept a confirmation dialog',
            input: { accept: true },
        },
        {
            description: 'Dismiss an alert dialog',
            input: { accept: false },
        },
        {
            description: 'Enter text in a prompt dialog and accept',
            input: { accept: true, promptText: 'My custom value' },
        },
    ],

    // ─── Wait For ───────────────────────────────────────────────────────────────

    unified_wait_for: [
        {
            description: 'Wait for specific text to appear on the page',
            input: { text: 'Results loaded' },
        },
        {
            description: 'Wait for loading text to disappear',
            input: { textGone: 'Loading...' },
        },
    ],

    unified_wait_for_element: [
        {
            description: 'Wait for a button to become visible',
            input: { selector: '[data-qa="submit-btn"]', state: 'visible', timeout: 10000 },
        },
        {
            description: 'Wait for a spinner to be detached from the DOM',
            input: { selector: '.loading-spinner', state: 'detached', timeout: 15000 },
        },
    ],

    unified_wait_for_response: [
        {
            description: 'Wait for an API response matching a URL pattern',
            input: { urlPattern: '**/api/v1/properties**', timeout: 15000 },
        },
    ],

    // ─── Selector Tools (Semantic) ──────────────────────────────────────────────

    unified_get_by_role: [
        {
            description: 'Find a button by its accessible name',
            input: { role: 'button', name: 'Apply Filters' },
        },
        {
            description: 'Find a heading element',
            input: { role: 'heading', name: 'Property Details', level: 2 },
        },
        {
            description: 'Find a link by name',
            input: { role: 'link', name: 'View All Properties' },
        },
    ],

    unified_get_by_test_id: [
        {
            description: 'Find an element by test ID attribute',
            input: { testId: 'search-city-input' },
        },
    ],

    unified_get_by_label: [
        {
            description: 'Find a form input by its label',
            input: { label: 'Email Address', exact: true },
        },
    ],

    // ─── Element State ──────────────────────────────────────────────────────────

    unified_is_visible: [
        {
            description: 'Check if an element is visible on the page',
            input: { selector: '[data-qa="search-results"]' },
        },
    ],

    unified_get_text_content: [
        {
            description: 'Extract text content from an element',
            input: { selector: '.property-price' },
        },
    ],

    unified_get_attribute: [
        {
            description: 'Get the href attribute of a link',
            input: { selector: 'a.property-link', attribute: 'href' },
        },
        {
            description: 'Get the value attribute of an input',
            input: { selector: '#city-input', attribute: 'value' },
        },
    ],

    // ─── Assertions ─────────────────────────────────────────────────────────────

    unified_expect_url: [
        {
            description: 'Assert the current URL contains a path',
            input: { url: '**/properties/map**', timeout: 5000 },
        },
    ],

    unified_expect_element_text: [
        {
            description: 'Assert an element contains specific text',
            input: { selector: '.results-count', text: 'properties found', substring: true },
        },
    ],

    unified_expect_element_attribute: [
        {
            description: 'Assert an element has a specific attribute value',
            input: { selector: 'input#email', attribute: 'type', value: 'email' },
        },
    ],

    // ─── Network Interception ───────────────────────────────────────────────────

    unified_route_intercept: [
        {
            description: 'Mock an API response for testing',
            input: {
                urlPattern: '**/api/v1/properties',
                action: 'mock',
                mockResponse: {
                    status: 200,
                    body: '{"properties": [], "total": 0}',
                    contentType: 'application/json',
                },
            },
        },
        {
            description: 'Block image requests for faster page load',
            input: { urlPattern: '**/*.{png,jpg,jpeg,gif,svg}', action: 'abort' },
        },
    ],

    // ─── Press Key ──────────────────────────────────────────────────────────────

    unified_press_key: [
        {
            description: 'Press Enter key',
            input: { key: 'Enter' },
        },
        {
            description: 'Press Escape to close a modal',
            input: { key: 'Escape' },
        },
    ],

    // ─── Keyboard Operations ────────────────────────────────────────────────────

    unified_press_sequentially: [
        {
            description: 'Type text character by character (simulates real typing)',
            input: { selector: '#search-input', text: 'Charlotte NC', delay: 100 },
        },
    ],

    // ─── Check/Uncheck ──────────────────────────────────────────────────────────

    unified_check: [
        {
            description: 'Check a checkbox by ref',
            input: { ref: 'terms-checkbox-ref' },
        },
    ],

    unified_uncheck: [
        {
            description: 'Uncheck a checkbox by ref',
            input: { ref: 'newsletter-checkbox-ref' },
        },
    ],

    // ─── Scroll ─────────────────────────────────────────────────────────────────

    unified_scroll_into_view: [
        {
            description: 'Scroll an element into the visible viewport',
            input: { selector: '#schools-section' },
        },
    ],

    // ─── Storage ────────────────────────────────────────────────────────────────

    unified_get_local_storage: [
        {
            description: 'Get a specific key from localStorage',
            input: { key: 'user_preferences' },
        },
    ],

    unified_set_local_storage: [
        {
            description: 'Set a value in localStorage',
            input: { key: 'test_mode', value: 'true' },
        },
    ],

    // ─── Programmatic Execution (Phase 3) ───────────────────────────────────────

    unified_execute_exploration: [
        {
            description: 'Execute a batch exploration script — navigate, snapshot, and extract',
            input: {
                script: `async (tools) => {
  const nav = await tools.navigate({ url: 'https://app.example.com' });
  const snap = await tools.snapshot({ filter: { interactiveOnly: true } });
  const url = await tools.get_page_url();
  const title = await tools.get_page_title();
  return { nav, snap, url, title };
}`,
            },
        },
        {
            description: 'Batch verify multiple selectors in one call',
            input: {
                script: `async (tools) => {
  const results = {};
  for (const sel of ['[data-qa="search"]', '[data-qa="filters"]', '.property-card']) {
    results[sel] = await tools.is_visible({ selector: sel });
  }
  return results;
}`,
            },
        },
    ],
};

/**
 * Get examples for a specific tool.
 * @param {string} toolName - The unified tool name
 * @returns {Array|null} Array of examples or null if none exist
 */
export function getToolExamples(toolName) {
    return TOOL_EXAMPLES[toolName] || null;
}

/**
 * Get names of all tools that have examples.
 * @returns {string[]} Array of tool names with examples
 */
export function getToolsWithExamples() {
    return Object.keys(TOOL_EXAMPLES);
}

/**
 * Get total token estimate for all examples.
 * Rough estimate: ~200-500 tokens per example.
 * @returns {{ toolCount: number, exampleCount: number, estimatedTokens: number }}
 */
export function getExamplesStats() {
    const toolCount = Object.keys(TOOL_EXAMPLES).length;
    let exampleCount = 0;
    for (const examples of Object.values(TOOL_EXAMPLES)) {
        exampleCount += examples.length;
    }
    return {
        toolCount,
        exampleCount,
        estimatedTokens: exampleCount * 350, // avg ~350 tokens per example
    };
}
