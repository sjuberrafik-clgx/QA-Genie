/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * UNIFIED TOOL DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Complete tool definitions combining Playwright MCP and ChromeDevTools MCP capabilities.
 * Each tool includes:
 * - name: Unique tool identifier
 * - description: What the tool does
 * - inputSchema: JSON Schema for parameters
 * - source: Which underlying MCP provides this (playwright/chromedevtools/hybrid)
 * - category: Functional category for routing decisions
 * 
 * ENHANCED: Now includes 55+ additional tools from Playwright cheatsheet analysis
 * for deep application exploration and accurate selector generation.
 * See: enhanced-tool-definitions.js for the full enhanced toolkit
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { ENHANCED_TOOLS, ENHANCED_TOOL_MAPPING } from './enhanced-tool-definitions.js';
import { ADVANCED_TOOLS, ADVANCED_TOOL_MAPPING } from './advanced-tool-definitions.js';

/**
 * Tool Categories:
 * - navigation: Page navigation and URL management
 * - interaction: User interactions (click, type, hover, etc.)
 * - snapshot: Page state capture (accessibility tree, screenshots)
 * - network: Network request monitoring and analysis
 * - performance: Performance tracing and metrics
 * - debugging: Console messages, script evaluation
 * - form: Form filling and file uploads
 * - tab: Browser tab management
 * - dialog: Dialog/modal handling
 * - emulation: Device emulation and viewport
 * 
 * Enhanced Categories (NEW):
 * - page-info: Page URL, title, viewport inspection
 * - element-content: Text, HTML, attributes extraction
 * - element-state: Visibility, enabled, checked states
 * - form-control: Check, uncheck, clear, focus, blur
 * - cookies: Cookie management
 * - multi-page: Tab/window management
 * - download: File download handling
 * - selectors: Advanced element selection (getByRole, getByLabel, etc.)
 * - assertions: Built-in test assertions
 */

export const UNIFIED_TOOLS = [
    // ═══════════════════════════════════════════════════════════════════════════════
    // NAVIGATION TOOLS (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_navigate',
        description: 'Navigate to a URL. Uses Playwright MCP for reliable navigation with proper page load handling.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to navigate to'
                },
                waitUntil: {
                    type: 'string',
                    enum: ['load', 'domcontentloaded', 'networkidle'],
                    description: 'When to consider navigation complete. Defaults to load.'
                }
            },
            required: ['url']
        },
        _meta: {
            source: 'playwright',
            category: 'navigation',
            readOnly: false
        }
    },
    {
        name: 'unified_navigate_back',
        description: 'Go back to the previous page in browser history.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'navigation',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // SNAPSHOT & SCREENSHOT TOOLS (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_snapshot',
        description: 'Capture accessibility snapshot of the current page. Returns a structured tree with element refs that can be used for interactions. This is PREFERRED over screenshots for automation.',
        inputSchema: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'Optional filename to save snapshot as markdown'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'snapshot',
            readOnly: true
        }
    },
    {
        name: 'unified_screenshot',
        description: 'Take a screenshot of the current page. Use for visual verification but NOT for element interactions.',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['png', 'jpeg'],
                    description: 'Image format. Defaults to png.'
                },
                filename: {
                    type: 'string',
                    description: 'File name to save screenshot'
                },
                element: {
                    type: 'string',
                    description: 'Human-readable element description to screenshot specific element'
                },
                ref: {
                    type: 'string',
                    description: 'Element ref from snapshot for element screenshot'
                },
                fullPage: {
                    type: 'boolean',
                    description: 'Take full page screenshot instead of viewport'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'snapshot',
            readOnly: true
        }
    },
    {
        name: 'unified_take_snapshot_cdp',
        description: 'Take a DOM snapshot using ChromeDevTools. Useful for detailed DOM inspection.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'chromedevtools',
            category: 'snapshot',
            readOnly: true
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERACTION TOOLS (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_click',
        description: 'Click on an element. Uses ref from snapshot for accurate targeting.',
        inputSchema: {
            type: 'object',
            properties: {
                element: {
                    type: 'string',
                    description: 'Human-readable element description'
                },
                ref: {
                    type: 'string',
                    description: 'Exact target element reference from page snapshot'
                },
                doubleClick: {
                    type: 'boolean',
                    description: 'Whether to perform double click'
                },
                button: {
                    type: 'string',
                    enum: ['left', 'right', 'middle'],
                    description: 'Mouse button to click'
                },
                modifiers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Modifier keys to press (Ctrl, Shift, Alt, Meta)'
                }
            },
            required: ['ref']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },
    {
        name: 'unified_type',
        description: 'Type text into an editable element.',
        inputSchema: {
            type: 'object',
            properties: {
                element: {
                    type: 'string',
                    description: 'Human-readable element description'
                },
                ref: {
                    type: 'string',
                    description: 'Exact target element reference from page snapshot'
                },
                text: {
                    type: 'string',
                    description: 'Text to type'
                },
                submit: {
                    type: 'boolean',
                    description: 'Whether to press Enter after typing'
                },
                slowly: {
                    type: 'boolean',
                    description: 'Type one character at a time for key handlers'
                }
            },
            required: ['ref', 'text']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },
    {
        name: 'unified_hover',
        description: 'Hover over an element.',
        inputSchema: {
            type: 'object',
            properties: {
                element: {
                    type: 'string',
                    description: 'Human-readable element description'
                },
                ref: {
                    type: 'string',
                    description: 'Exact target element reference from page snapshot'
                }
            },
            required: ['ref']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },
    {
        name: 'unified_drag',
        description: 'Drag and drop from one element to another.',
        inputSchema: {
            type: 'object',
            properties: {
                startElement: {
                    type: 'string',
                    description: 'Human-readable source element description'
                },
                startRef: {
                    type: 'string',
                    description: 'Source element reference from snapshot'
                },
                endElement: {
                    type: 'string',
                    description: 'Human-readable target element description'
                },
                endRef: {
                    type: 'string',
                    description: 'Target element reference from snapshot'
                }
            },
            required: ['startRef', 'endRef']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },
    {
        name: 'unified_select_option',
        description: 'Select option(s) in a dropdown.',
        inputSchema: {
            type: 'object',
            properties: {
                element: {
                    type: 'string',
                    description: 'Human-readable element description'
                },
                ref: {
                    type: 'string',
                    description: 'Exact target element reference from page snapshot'
                },
                values: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Values to select'
                }
            },
            required: ['ref', 'values']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },
    {
        name: 'unified_press_key',
        description: 'Press a keyboard key.',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key to press (e.g., Enter, Escape, ArrowDown)'
                }
            },
            required: ['key']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // COORDINATE-BASED INTERACTIONS (Vision mode)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_mouse_click_xy',
        description: 'Click at specific X,Y coordinates. Use when ref-based click is not possible.',
        inputSchema: {
            type: 'object',
            properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' }
            },
            required: ['x', 'y']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false,
            requiresCapability: 'vision'
        }
    },
    {
        name: 'unified_mouse_move_xy',
        description: 'Move mouse to specific coordinates.',
        inputSchema: {
            type: 'object',
            properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' }
            },
            required: ['x', 'y']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false,
            requiresCapability: 'vision'
        }
    },
    {
        name: 'unified_mouse_drag_xy',
        description: 'Drag from one coordinate to another.',
        inputSchema: {
            type: 'object',
            properties: {
                startX: { type: 'number', description: 'Start X coordinate' },
                startY: { type: 'number', description: 'Start Y coordinate' },
                endX: { type: 'number', description: 'End X coordinate' },
                endY: { type: 'number', description: 'End Y coordinate' }
            },
            required: ['startX', 'startY', 'endX', 'endY']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false,
            requiresCapability: 'vision'
        }
    },
    {
        name: 'unified_mouse_wheel',
        description: 'Scroll using mouse wheel.',
        inputSchema: {
            type: 'object',
            properties: {
                deltaX: { type: 'number', description: 'Horizontal scroll delta' },
                deltaY: { type: 'number', description: 'Vertical scroll delta' }
            },
            required: ['deltaX', 'deltaY']
        },
        _meta: {
            source: 'playwright',
            category: 'interaction',
            readOnly: false,
            requiresCapability: 'vision'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // FORM TOOLS (Hybrid: Playwright + ChromeDevTools)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_fill_form',
        description: 'Fill multiple form fields at once.',
        inputSchema: {
            type: 'object',
            properties: {
                fields: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            ref: { type: 'string', description: 'Element ref from snapshot' },
                            value: { type: 'string', description: 'Value to fill' }
                        },
                        required: ['ref', 'value']
                    },
                    description: 'Array of fields to fill'
                }
            },
            required: ['fields']
        },
        _meta: {
            source: 'playwright',
            category: 'form',
            readOnly: false
        }
    },
    {
        name: 'unified_file_upload',
        description: 'Upload file(s) through a file input.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Absolute paths to files to upload'
                }
            },
            required: ['paths']
        },
        _meta: {
            source: 'playwright',
            category: 'form',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // WAIT & SYNC TOOLS (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_wait_for',
        description: 'Wait for text to appear, disappear, or for a specific time.',
        inputSchema: {
            type: 'object',
            properties: {
                time: {
                    type: 'number',
                    description: 'Time to wait in seconds'
                },
                text: {
                    type: 'string',
                    description: 'Text to wait for to appear'
                },
                textGone: {
                    type: 'string',
                    description: 'Text to wait for to disappear'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'wait',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // TAB MANAGEMENT (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_tabs',
        description: 'Manage browser tabs: list, create, close, or select.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'create', 'close', 'select'],
                    description: 'Tab operation to perform'
                },
                index: {
                    type: 'number',
                    description: 'Tab index for close/select operations'
                }
            },
            required: ['action']
        },
        _meta: {
            source: 'playwright',
            category: 'tab',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // DIALOG HANDLING (Primary: Playwright MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_handle_dialog',
        description: 'Handle browser dialogs (alert, confirm, prompt).',
        inputSchema: {
            type: 'object',
            properties: {
                accept: {
                    type: 'boolean',
                    description: 'Whether to accept the dialog'
                },
                promptText: {
                    type: 'string',
                    description: 'Text to enter in prompt dialog'
                }
            },
            required: ['accept']
        },
        _meta: {
            source: 'playwright',
            category: 'dialog',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // SCRIPT EVALUATION (Hybrid: Both MCPs have this)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_evaluate',
        description: 'Evaluate JavaScript in page context. Uses Playwright MCP by default.',
        inputSchema: {
            type: 'object',
            properties: {
                function: {
                    type: 'string',
                    description: 'JavaScript function to evaluate: () => { /* code */ }'
                },
                element: {
                    type: 'string',
                    description: 'Element description if evaluating on specific element'
                },
                ref: {
                    type: 'string',
                    description: 'Element ref if evaluating on specific element'
                }
            },
            required: ['function']
        },
        _meta: {
            source: 'playwright',
            category: 'debugging',
            readOnly: false
        }
    },
    {
        name: 'unified_evaluate_cdp',
        description: 'Evaluate JavaScript using ChromeDevTools Protocol. Better for low-level operations.',
        inputSchema: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: 'JavaScript expression to evaluate'
                },
                awaitPromise: {
                    type: 'boolean',
                    description: 'Whether to await promise results'
                }
            },
            required: ['expression']
        },
        _meta: {
            source: 'chromedevtools',
            category: 'debugging',
            readOnly: false
        }
    },
    {
        name: 'unified_run_playwright_code',
        description: 'Run raw Playwright code snippet for complex automation.',
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Playwright code: async (page) => { /* code */ }'
                }
            },
            required: ['code']
        },
        _meta: {
            source: 'playwright',
            category: 'debugging',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSOLE MESSAGES (Both MCPs)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_console_messages',
        description: 'Get console messages from the page. Uses Playwright MCP.',
        inputSchema: {
            type: 'object',
            properties: {
                level: {
                    type: 'string',
                    enum: ['verbose', 'info', 'warning', 'error'],
                    description: 'Minimum log level to return'
                },
                filename: {
                    type: 'string',
                    description: 'File to save messages to'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'debugging',
            readOnly: true
        }
    },
    {
        name: 'unified_console_messages_cdp',
        description: 'Get console messages using ChromeDevTools. More detailed with timestamps.',
        inputSchema: {
            type: 'object',
            properties: {
                types: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Message types to filter'
                },
                pageSize: {
                    type: 'number',
                    description: 'Number of messages to return'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'debugging',
            readOnly: true
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // NETWORK MONITORING (Both MCPs - ChromeDevTools is better)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_network_requests',
        description: 'List all network requests made by the page.',
        inputSchema: {
            type: 'object',
            properties: {
                includeStatic: {
                    type: 'boolean',
                    description: 'Include static resources (images, fonts, etc.)'
                },
                filename: {
                    type: 'string',
                    description: 'File to save network log to'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'network',
            readOnly: true
        }
    },
    {
        name: 'unified_network_requests_cdp',
        description: 'List network requests using ChromeDevTools. Provides more detailed timing info.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: {
                    type: 'string',
                    description: 'Filter requests by URL pattern'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'network',
            readOnly: true
        }
    },
    {
        name: 'unified_get_network_request',
        description: 'Get detailed info about a specific network request.',
        inputSchema: {
            type: 'object',
            properties: {
                reqid: {
                    type: 'string',
                    description: 'Request ID from network request list'
                }
            },
            required: ['reqid']
        },
        _meta: {
            source: 'chromedevtools',
            category: 'network',
            readOnly: true
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // PERFORMANCE TOOLS (Primary: ChromeDevTools MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_performance_start_trace',
        description: 'Start performance tracing to capture detailed metrics.',
        inputSchema: {
            type: 'object',
            properties: {
                reload: {
                    type: 'boolean',
                    description: 'Reload page when starting trace'
                },
                autoStop: {
                    type: 'boolean',
                    description: 'Auto-stop trace after page load'
                },
                filePath: {
                    type: 'string',
                    description: 'Path to save trace file'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'performance',
            readOnly: false
        }
    },
    {
        name: 'unified_performance_stop_trace',
        description: 'Stop performance tracing and get results.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to save trace file'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'performance',
            readOnly: false
        }
    },
    {
        name: 'unified_performance_analyze',
        description: 'Analyze performance insights from a trace.',
        inputSchema: {
            type: 'object',
            properties: {
                insightSetId: {
                    type: 'string',
                    description: 'Insight set ID from trace'
                },
                insightName: {
                    type: 'string',
                    description: 'Specific insight to analyze'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'performance',
            readOnly: true
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // EMULATION (Primary: ChromeDevTools MCP)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_emulate',
        description: 'Emulate a device or set custom device metrics.',
        inputSchema: {
            type: 'object',
            properties: {
                device: {
                    type: 'string',
                    description: 'Device name to emulate (e.g., "iPhone 12")'
                },
                width: {
                    type: 'number',
                    description: 'Custom viewport width'
                },
                height: {
                    type: 'number',
                    description: 'Custom viewport height'
                },
                deviceScaleFactor: {
                    type: 'number',
                    description: 'Device pixel ratio'
                },
                mobile: {
                    type: 'boolean',
                    description: 'Whether to emulate mobile'
                }
            }
        },
        _meta: {
            source: 'chromedevtools',
            category: 'emulation',
            readOnly: false
        }
    },
    {
        name: 'unified_resize',
        description: 'Resize browser window or viewport.',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', description: 'New width' },
                height: { type: 'number', description: 'New height' }
            },
            required: ['width', 'height']
        },
        _meta: {
            source: 'playwright',
            category: 'emulation',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // TEST ASSERTION TOOLS (Primary: Playwright MCP - testing capability)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_generate_locator',
        description: 'Generate a robust locator for an element to use in tests.',
        inputSchema: {
            type: 'object',
            properties: {
                element: {
                    type: 'string',
                    description: 'Human-readable element description'
                },
                ref: {
                    type: 'string',
                    description: 'Element ref from snapshot'
                }
            },
            required: ['ref']
        },
        _meta: {
            source: 'playwright',
            category: 'testing',
            readOnly: true,
            requiresCapability: 'testing'
        }
    },
    {
        name: 'unified_verify_element_visible',
        description: 'Verify an element is visible on the page.',
        inputSchema: {
            type: 'object',
            properties: {
                role: {
                    type: 'string',
                    description: 'ARIA role of the element'
                },
                accessibleName: {
                    type: 'string',
                    description: 'Accessible name of the element'
                }
            },
            required: ['role', 'accessibleName']
        },
        _meta: {
            source: 'playwright',
            category: 'testing',
            readOnly: false,
            requiresCapability: 'testing'
        }
    },
    {
        name: 'unified_verify_text_visible',
        description: 'Verify specific text is visible on the page.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to verify'
                }
            },
            required: ['text']
        },
        _meta: {
            source: 'playwright',
            category: 'testing',
            readOnly: false,
            requiresCapability: 'testing'
        }
    },
    {
        name: 'unified_verify_value',
        description: 'Verify an element has a specific value.',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Element type'
                },
                element: {
                    type: 'string',
                    description: 'Element description'
                },
                ref: {
                    type: 'string',
                    description: 'Element ref from snapshot'
                },
                value: {
                    type: 'string',
                    description: 'Expected value'
                }
            },
            required: ['ref', 'value']
        },
        _meta: {
            source: 'playwright',
            category: 'testing',
            readOnly: false,
            requiresCapability: 'testing'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // BROWSER CONTROL
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_browser_close',
        description: 'Close the browser and cleanup resources.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'browser',
            readOnly: false
        }
    },
    {
        name: 'unified_browser_install',
        description: 'Install browser if not already installed.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'browser',
            readOnly: false
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // PDF GENERATION (Playwright MCP - pdf capability)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_pdf_save',
        description: 'Save page as PDF document.',
        inputSchema: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'PDF filename'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'pdf',
            readOnly: true,
            requiresCapability: 'pdf'
        }
    }
];

/**
 * Tool name mapping from unified to source MCPs
 */
export const TOOL_MAPPING = {
    // Playwright MCP mappings
    unified_navigate: 'browser_navigate',
    unified_navigate_back: 'browser_navigate_back',
    unified_snapshot: 'browser_snapshot',
    unified_screenshot: 'browser_take_screenshot',
    unified_click: 'browser_click',
    unified_type: 'browser_type',
    unified_hover: 'browser_hover',
    unified_drag: 'browser_drag',
    unified_select_option: 'browser_select_option',
    unified_press_key: 'browser_press_key',
    unified_fill_form: 'browser_fill_form',
    unified_file_upload: 'browser_file_upload',
    unified_wait_for: 'browser_wait_for',
    unified_tabs: 'browser_tabs',
    unified_handle_dialog: 'browser_handle_dialog',
    unified_evaluate: 'browser_evaluate',
    unified_run_playwright_code: 'browser_run_code',
    unified_console_messages: 'browser_console_messages',
    unified_network_requests: 'browser_network_requests',
    unified_resize: 'browser_resize',
    unified_generate_locator: 'browser_generate_locator',
    unified_verify_element_visible: 'browser_verify_element_visible',
    unified_verify_text_visible: 'browser_verify_text_visible',
    unified_verify_value: 'browser_verify_value',
    unified_browser_close: 'browser_close',
    unified_browser_install: 'browser_install',
    unified_pdf_save: 'browser_pdf_save',
    unified_mouse_click_xy: 'browser_mouse_click_xy',
    unified_mouse_move_xy: 'browser_mouse_move_xy',
    unified_mouse_drag_xy: 'browser_mouse_drag_xy',
    unified_mouse_wheel: 'browser_mouse_wheel',

    // ChromeDevTools MCP mappings
    unified_evaluate_cdp: 'evaluate_script',
    unified_console_messages_cdp: 'list_console_messages',
    unified_network_requests_cdp: 'list_network_requests',
    unified_get_network_request: 'get_network_request',
    unified_performance_start_trace: 'performance_start_trace',
    unified_performance_stop_trace: 'performance_stop_trace',
    unified_performance_analyze: 'performance_analyze_insight',
    unified_emulate: 'emulate',
    unified_take_snapshot_cdp: 'take_snapshot',

    // Merge enhanced tool mappings
    ...ENHANCED_TOOL_MAPPING,

    // Merge advanced tool mappings (iframe, shadow DOM, network interception, storage, etc.)
    ...ADVANCED_TOOL_MAPPING,
};

/**
 * Combined tools: Core UNIFIED_TOOLS + ENHANCED_TOOLS + ADVANCED_TOOLS
 * This provides 150+ tools for comprehensive zero-limitation automation
 */
export const ALL_TOOLS = [...UNIFIED_TOOLS, ...ENHANCED_TOOLS, ...ADVANCED_TOOLS];

/**
 * Get tool source from tool name (searches both core and enhanced)
 */
export function getToolSource(toolName) {
    const tool = ALL_TOOLS.find(t => t.name === toolName);
    return tool?._meta?.source || 'playwright';
}

/**
 * Get tool category from tool name (searches both core and enhanced)
 */
export function getToolCategory(toolName) {
    const tool = ALL_TOOLS.find(t => t.name === toolName);
    return tool?._meta?.category || 'unknown';
}

/**
 * Get the source tool name for routing
 */
export function getSourceToolName(unifiedToolName) {
    return TOOL_MAPPING[unifiedToolName] || unifiedToolName;
}

/**
 * Get tool by name
 */
export function getToolByName(toolName) {
    return ALL_TOOLS.find(t => t.name === toolName);
}

/**
 * Get all tools by category
 */
export function getToolsByCategory(category) {
    return ALL_TOOLS.filter(t => t._meta?.category === category);
}

/**
 * Get tool statistics
 */
export function getToolStats() {
    const categories = {};
    ALL_TOOLS.forEach(t => {
        const cat = t._meta?.category || 'unknown';
        categories[cat] = (categories[cat] || 0) + 1;
    });

    return {
        total: ALL_TOOLS.length,
        core: UNIFIED_TOOLS.length,
        enhanced: ENHANCED_TOOLS.length,
        advanced: ADVANCED_TOOLS.length,
        byCategory: categories
    };
}
