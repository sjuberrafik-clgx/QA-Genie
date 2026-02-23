/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ADVANCED TOOL DEFINITIONS — Zero-Limitation MCP Tools
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Tool definitions for all advanced capabilities:
 *   - Iframe & Shadow DOM
 *   - Network Interception & Mocking
 *   - Storage (localStorage, sessionStorage, IndexedDB)
 *   - Multi-Context & Incognito
 *   - Visual Testing
 *   - Video Recording
 *   - Auth/Session Persistence
 *   - Accessibility Audit
 *   - Geolocation & Permissions
 *   - Download Management
 *   - DOM Mutation Observation
 *   - Page Error Capture
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

export const ADVANCED_TOOLS = [

    // ═══════════════════════════════════════════════════
    // IFRAME
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_list_frames',
        description: 'List all iframes on the current page with their names, URLs, and indices',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'iframe' },
    },
    {
        name: 'unified_switch_to_frame',
        description: 'Switch focus to a specific iframe by index, name, or CSS selector',
        inputSchema: {
            type: 'object',
            properties: {
                index: { type: 'number', description: 'Frame index (from list_frames)' },
                name: { type: 'string', description: 'Frame name attribute' },
                selector: { type: 'string', description: 'CSS selector for the iframe element' },
            },
        },
        _meta: { source: 'playwright', category: 'iframe' },
    },
    {
        name: 'unified_switch_to_main_frame',
        description: 'Switch focus back to the main frame (top-level page)',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'iframe' },
    },
    {
        name: 'unified_frame_action',
        description: 'Execute an action within a specific iframe: click, type, getText, or snapshot',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the iframe element' },
                action: { type: 'string', enum: ['click', 'type', 'getText', 'snapshot'], description: 'Action to perform inside the frame' },
                element: { type: 'string', description: 'Selector for the target element inside the frame' },
                text: { type: 'string', description: 'Text to type (for type action)' },
            },
            required: ['selector', 'action'],
        },
        _meta: { source: 'playwright', category: 'iframe' },
    },

    // ═══════════════════════════════════════════════════
    // SHADOW DOM
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_shadow_dom_query',
        description: 'Query and interact with elements inside Shadow DOM. Specify the host element and inner selector.',
        inputSchema: {
            type: 'object',
            properties: {
                hostSelector: { type: 'string', description: 'CSS selector for the shadow DOM host element' },
                innerSelector: { type: 'string', description: 'CSS selector for the element inside shadow root' },
                action: { type: 'string', enum: ['find', 'click', 'type', 'getText', 'getValue', 'setAttribute'], default: 'find' },
                text: { type: 'string', description: 'Text for type action or attribute name for setAttribute' },
                value: { type: 'string', description: 'Attribute value for setAttribute' },
            },
            required: ['hostSelector', 'innerSelector'],
        },
        _meta: { source: 'playwright', category: 'shadow-dom' },
    },
    {
        name: 'unified_shadow_pierce',
        description: 'Interact with elements using Playwright\'s >> shadow-piercing selector syntax',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Shadow-piercing selector (e.g., "my-component >> .inner-element")' },
                action: { type: 'string', enum: ['click', 'type', 'getText', 'isVisible'], default: 'click' },
                text: { type: 'string', description: 'Text to type (for type action)' },
            },
            required: ['selector'],
        },
        _meta: { source: 'playwright', category: 'shadow-dom' },
    },

    // ═══════════════════════════════════════════════════
    // NETWORK INTERCEPTION & MOCKING
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_route_intercept',
        description: 'Intercept network requests matching a URL pattern. Can abort, fulfill with mock data, or modify and continue.',
        inputSchema: {
            type: 'object',
            properties: {
                urlPattern: { type: 'string', description: 'URL pattern to intercept (glob or regex string)' },
                action: { type: 'string', enum: ['abort', 'fulfill', 'continue', 'log'], default: 'abort', description: 'What to do with matched requests' },
                status: { type: 'number', description: 'HTTP status code for fulfill action' },
                body: { description: 'Response body for fulfill action (string or object)' },
                contentType: { type: 'string', description: 'Content-Type header for fulfill' },
                headers: { type: 'object', description: 'Response headers to set' },
                overrideUrl: { type: 'string', description: 'Redirect URL for continue action' },
                postData: { type: 'string', description: 'Override POST body for continue action' },
                errorCode: { type: 'string', description: 'Error code for abort action (e.g., "blockedbyclient", "connectionrefused")' },
            },
            required: ['urlPattern'],
        },
        _meta: { source: 'playwright', category: 'network-interception' },
    },
    {
        name: 'unified_route_remove',
        description: 'Remove a previously set route intercept',
        inputSchema: {
            type: 'object',
            properties: {
                urlPattern: { type: 'string', description: 'URL pattern to stop intercepting' },
            },
            required: ['urlPattern'],
        },
        _meta: { source: 'playwright', category: 'network-interception' },
    },
    {
        name: 'unified_route_list',
        description: 'List all active route intercepts',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'network-interception' },
    },
    {
        name: 'unified_wait_for_request',
        description: 'Wait for a specific network request to be made',
        inputSchema: {
            type: 'object',
            properties: {
                urlPattern: { type: 'string', description: 'URL substring to match' },
                method: { type: 'string', description: 'HTTP method to match (GET, POST, etc.)' },
                timeout: { type: 'number', description: 'Max wait time in ms', default: 30000 },
            },
            required: ['urlPattern'],
        },
        _meta: { source: 'playwright', category: 'network-interception' },
    },
    {
        name: 'unified_wait_for_response',
        description: 'Wait for a specific network response',
        inputSchema: {
            type: 'object',
            properties: {
                urlPattern: { type: 'string', description: 'URL substring to match' },
                status: { type: 'number', description: 'Expected HTTP status code' },
                timeout: { type: 'number', description: 'Max wait time in ms', default: 30000 },
            },
            required: ['urlPattern'],
        },
        _meta: { source: 'playwright', category: 'network-interception' },
    },

    // ═══════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_get_local_storage',
        description: 'Get localStorage items. Optionally filter by key.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Specific key to get (omit for all items)' },
            },
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_set_local_storage',
        description: 'Set a localStorage item',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Storage key' },
                value: { type: 'string', description: 'Storage value' },
            },
            required: ['key', 'value'],
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_remove_local_storage',
        description: 'Remove localStorage item(s) or clear all',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to remove' },
                clearAll: { type: 'boolean', description: 'Clear all items', default: false },
            },
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_get_session_storage',
        description: 'Get sessionStorage items. Optionally filter by key.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Specific key to get (omit for all items)' },
            },
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_set_session_storage',
        description: 'Set a sessionStorage item',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Storage key' },
                value: { type: 'string', description: 'Storage value' },
            },
            required: ['key', 'value'],
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_remove_session_storage',
        description: 'Remove sessionStorage item(s) or clear all',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to remove' },
                clearAll: { type: 'boolean', description: 'Clear all items', default: false },
            },
        },
        _meta: { source: 'playwright', category: 'storage' },
    },
    {
        name: 'unified_query_indexeddb',
        description: 'Query IndexedDB: list databases/stores, get/put/delete records',
        inputSchema: {
            type: 'object',
            properties: {
                dbName: { type: 'string', description: 'Database name' },
                storeName: { type: 'string', description: 'Object store name' },
                action: { type: 'string', enum: ['listDatabases', 'listStores', 'get', 'getAll', 'put', 'delete', 'count'], default: 'list' },
                key: { description: 'Record key for get/put/delete' },
                value: { description: 'Record value for put action' },
                limit: { type: 'number', description: 'Max records for getAll', default: 100 },
            },
        },
        _meta: { source: 'playwright', category: 'storage' },
    },

    // ═══════════════════════════════════════════════════
    // MULTI-CONTEXT & INCOGNITO
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_create_context',
        description: 'Create a new isolated browser context (like incognito). Has separate cookies, storage, and cache.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name for this context (for switching later)' },
                options: {
                    type: 'object',
                    description: 'Context options',
                    properties: {
                        viewport: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } } },
                        userAgent: { type: 'string' },
                        locale: { type: 'string' },
                        timezoneId: { type: 'string' },
                        geolocation: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } },
                        permissions: { type: 'array', items: { type: 'string' } },
                        colorScheme: { type: 'string', enum: ['light', 'dark', 'no-preference'] },
                        storageState: { type: 'string', description: 'Path to storage state JSON file' },
                    },
                },
            },
        },
        _meta: { source: 'playwright', category: 'multi-context' },
    },
    {
        name: 'unified_switch_context',
        description: 'Switch active page to a different browser context by name',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Context name to switch to' },
            },
            required: ['name'],
        },
        _meta: { source: 'playwright', category: 'multi-context' },
    },
    {
        name: 'unified_list_contexts',
        description: 'List all browser contexts with their names and page counts',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'multi-context' },
    },
    {
        name: 'unified_close_context',
        description: 'Close a named browser context and all its pages',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Context name to close' },
            },
            required: ['name'],
        },
        _meta: { source: 'playwright', category: 'multi-context' },
    },

    // ═══════════════════════════════════════════════════
    // VISUAL TESTING
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_screenshot_baseline',
        description: 'Take a baseline screenshot for visual regression testing',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Unique name for this baseline' },
                selector: { type: 'string', description: 'CSS selector to screenshot a specific element' },
                fullPage: { type: 'boolean', description: 'Capture full page', default: false },
                dir: { type: 'string', description: 'Directory to store baselines', default: './visual-baselines' },
            },
            required: ['name'],
        },
        _meta: { source: 'playwright', category: 'visual-testing' },
    },
    {
        name: 'unified_screenshot_compare',
        description: 'Compare current page/element screenshot against a stored baseline',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Baseline name to compare against' },
                selector: { type: 'string', description: 'CSS selector to screenshot a specific element' },
                fullPage: { type: 'boolean', description: 'Capture full page', default: false },
                dir: { type: 'string', description: 'Directory where baselines are stored', default: './visual-baselines' },
                threshold: { type: 'number', description: 'Acceptable difference ratio (0-1)', default: 0.01 },
            },
            required: ['name'],
        },
        _meta: { source: 'playwright', category: 'visual-testing' },
    },

    // ═══════════════════════════════════════════════════
    // VIDEO RECORDING
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_start_video',
        description: 'Start recording video of browser interactions',
        inputSchema: {
            type: 'object',
            properties: {
                dir: { type: 'string', description: 'Directory to save videos', default: './videos' },
                width: { type: 'number', description: 'Video width' },
                height: { type: 'number', description: 'Video height' },
            },
        },
        _meta: { source: 'playwright', category: 'video-recording' },
    },
    {
        name: 'unified_stop_video',
        description: 'Stop video recording and save the file',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'video-recording' },
    },

    // ═══════════════════════════════════════════════════
    // AUTH / SESSION PERSISTENCE
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_save_auth_state',
        description: 'Save current authentication state (cookies + localStorage) to a file for reuse across sessions',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'File path to save state', default: './auth-state.json' },
            },
        },
        _meta: { source: 'playwright', category: 'auth-persistence' },
    },
    {
        name: 'unified_load_auth_state',
        description: 'Load a previously saved authentication state into a new browser context',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'File path to load state from', default: './auth-state.json' },
            },
        },
        _meta: { source: 'playwright', category: 'auth-persistence' },
    },

    // ═══════════════════════════════════════════════════
    // ACCESSIBILITY AUDIT
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_accessibility_audit',
        description: 'Run an accessibility audit on the current page. Checks for missing labels, alt text, heading structure, form labels, and more.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector to audit a specific subtree (omit for full page)' },
            },
        },
        _meta: { source: 'playwright', category: 'accessibility' },
    },

    // ═══════════════════════════════════════════════════
    // GEOLOCATION & PERMISSIONS
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_set_geolocation',
        description: 'Set the browser\'s geolocation (latitude, longitude)',
        inputSchema: {
            type: 'object',
            properties: {
                latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
                longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
                accuracy: { type: 'number', description: 'Accuracy in meters', default: 100 },
            },
            required: ['latitude', 'longitude'],
        },
        _meta: { source: 'playwright', category: 'geolocation-permissions' },
    },
    {
        name: 'unified_grant_permissions',
        description: 'Grant browser permissions (geolocation, notifications, camera, microphone, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                permissions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Permissions to grant: geolocation, notifications, camera, microphone, etc.',
                },
                origin: { type: 'string', description: 'Origin to grant permissions for (optional)' },
            },
            required: ['permissions'],
        },
        _meta: { source: 'playwright', category: 'geolocation-permissions' },
    },
    {
        name: 'unified_clear_permissions',
        description: 'Clear all granted browser permissions',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'geolocation-permissions' },
    },
    {
        name: 'unified_set_timezone',
        description: 'Set the browser timezone (creates a new context)',
        inputSchema: {
            type: 'object',
            properties: {
                timezoneId: { type: 'string', description: 'IANA timezone ID (e.g., "America/New_York", "Europe/London")' },
            },
            required: ['timezoneId'],
        },
        _meta: { source: 'playwright', category: 'geolocation-permissions' },
    },
    {
        name: 'unified_set_locale',
        description: 'Set the browser locale (creates a new context)',
        inputSchema: {
            type: 'object',
            properties: {
                locale: { type: 'string', description: 'Locale string (e.g., "en-US", "fr-FR", "ja-JP")' },
            },
            required: ['locale'],
        },
        _meta: { source: 'playwright', category: 'geolocation-permissions' },
    },

    // ═══════════════════════════════════════════════════
    // DOWNLOAD MANAGEMENT
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_list_downloads',
        description: 'List files downloaded during the current session',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'download-management' },
    },
    {
        name: 'unified_trigger_download',
        description: 'Click an element to trigger a download and save the file',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element to click to trigger download' },
                savePath: { type: 'string', description: 'Path to save the downloaded file' },
                timeout: { type: 'number', description: 'Max wait time in ms', default: 30000 },
            },
            required: ['selector'],
        },
        _meta: { source: 'playwright', category: 'download-management' },
    },

    // ═══════════════════════════════════════════════════
    // DOM MUTATION OBSERVATION
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_observe_mutations',
        description: 'Start observing DOM mutations (attribute changes, child node additions/removals, text changes)',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element to observe', default: 'body' },
                attributes: { type: 'boolean', description: 'Watch attribute changes', default: true },
                childList: { type: 'boolean', description: 'Watch child node changes', default: true },
                subtree: { type: 'boolean', description: 'Watch entire subtree', default: true },
                characterData: { type: 'boolean', description: 'Watch text content changes', default: true },
                limit: { type: 'number', description: 'Max mutations to buffer', default: 100 },
            },
        },
        _meta: { source: 'playwright', category: 'dom-mutations' },
    },
    {
        name: 'unified_get_mutations',
        description: 'Get DOM mutations collected by the observer',
        inputSchema: {
            type: 'object',
            properties: {
                clear: { type: 'boolean', description: 'Clear the mutation buffer after reading', default: false },
            },
        },
        _meta: { source: 'playwright', category: 'dom-mutations' },
    },
    {
        name: 'unified_stop_mutation_observer',
        description: 'Stop the DOM mutation observer',
        inputSchema: { type: 'object', properties: {} },
        _meta: { source: 'playwright', category: 'dom-mutations' },
    },

    // ═══════════════════════════════════════════════════
    // PAGE ERRORS
    // ═══════════════════════════════════════════════════

    {
        name: 'unified_page_errors',
        description: 'Get uncaught page errors (JavaScript exceptions) captured during the session',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max errors to return' },
                clear: { type: 'boolean', description: 'Clear error buffer after reading', default: false },
                since: { type: 'number', description: 'Only return errors after this timestamp' },
            },
        },
        _meta: { source: 'playwright', category: 'page-errors' },
    },
];

/**
 * Mapping from unified tool names to bridge method names
 */
export const ADVANCED_TOOL_MAPPING = {
    // Iframe
    unified_list_frames: 'browser_list_frames',
    unified_switch_to_frame: 'browser_switch_to_frame',
    unified_switch_to_main_frame: 'browser_switch_to_main_frame',
    unified_frame_action: 'browser_frame_action',

    // Shadow DOM
    unified_shadow_dom_query: 'browser_shadow_dom_query',
    unified_shadow_pierce: 'browser_shadow_pierce',

    // Network Interception
    unified_route_intercept: 'browser_route_intercept',
    unified_route_remove: 'browser_route_remove',
    unified_route_list: 'browser_route_list',
    unified_wait_for_request: 'browser_wait_for_request',
    unified_wait_for_response: 'browser_wait_for_response',

    // Storage
    unified_get_local_storage: 'browser_get_local_storage',
    unified_set_local_storage: 'browser_set_local_storage',
    unified_remove_local_storage: 'browser_remove_local_storage',
    unified_get_session_storage: 'browser_get_session_storage',
    unified_set_session_storage: 'browser_set_session_storage',
    unified_remove_session_storage: 'browser_remove_session_storage',
    unified_query_indexeddb: 'browser_query_indexeddb',

    // Multi-Context
    unified_create_context: 'browser_create_context',
    unified_switch_context: 'browser_switch_context',
    unified_list_contexts: 'browser_list_contexts',
    unified_close_context: 'browser_close_context',

    // Visual Testing
    unified_screenshot_baseline: 'browser_screenshot_baseline',
    unified_screenshot_compare: 'browser_screenshot_compare',

    // Video Recording
    unified_start_video: 'browser_start_video',
    unified_stop_video: 'browser_stop_video',

    // Auth Persistence
    unified_save_auth_state: 'browser_save_auth_state',
    unified_load_auth_state: 'browser_load_auth_state',

    // Accessibility
    unified_accessibility_audit: 'browser_accessibility_audit',

    // Geolocation & Permissions
    unified_set_geolocation: 'browser_set_geolocation',
    unified_grant_permissions: 'browser_grant_permissions',
    unified_clear_permissions: 'browser_clear_permissions',
    unified_set_timezone: 'browser_set_timezone',
    unified_set_locale: 'browser_set_locale',

    // Downloads
    unified_list_downloads: 'browser_list_downloads',
    unified_trigger_download: 'browser_trigger_download',

    // DOM Mutations
    unified_observe_mutations: 'browser_observe_mutations',
    unified_get_mutations: 'browser_get_mutations',
    unified_stop_mutation_observer: 'browser_stop_mutation_observer',

    // Page Errors
    unified_page_errors: 'browser_page_errors',
};

/**
 * Categories for routing
 */
export const ADVANCED_CATEGORIES = {
    'iframe': 'Navigate and interact within iframes',
    'shadow-dom': 'Traverse and interact with Shadow DOM elements',
    'network-interception': 'Intercept, mock, and modify network requests',
    'storage': 'Access localStorage, sessionStorage, and IndexedDB',
    'multi-context': 'Create and manage isolated browser contexts',
    'visual-testing': 'Screenshot comparison and visual regression testing',
    'video-recording': 'Record browser interactions as video',
    'auth-persistence': 'Save and restore authentication state',
    'accessibility': 'Accessibility auditing and analysis',
    'geolocation-permissions': 'Set geolocation, timezone, locale, and permissions',
    'download-management': 'Download file management',
    'dom-mutations': 'Observe and query DOM changes',
    'page-errors': 'Capture uncaught JavaScript exceptions',
};
