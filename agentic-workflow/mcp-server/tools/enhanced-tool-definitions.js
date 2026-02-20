/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ENHANCED TOOL DEFINITIONS - Deep Exploration Capabilities
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Additional tools based on Playwright cheatsheet analysis to enable:
 * - Deep application exploration
 * - Accurate and unique selector generation
 * - Comprehensive state verification
 * - Full DOM/element introspection
 * 
 * These tools complement the existing unified tools in tool-definitions.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Enhanced Categories:
 * - page-info: Page URL, title, state inspection
 * - element-state: Element visibility, enabled state, values
 * - element-content: Text, HTML, attributes extraction
 * - form-control: Check, uncheck, clear, focus, blur
 * - navigation-extended: Reload, forward, history
 * - cookies: Cookie management
 * - downloads: File download handling
 * - multi-page: Tab/window detection and management
 * - scroll: Scroll control and visibility
 * - selectors: Advanced selector generation
 */

export const ENHANCED_TOOLS = [
    // ═══════════════════════════════════════════════════════════════════════════════
    // PAGE INFORMATION TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_get_page_url',
        description: 'Get the current page URL. Essential for validating navigation and page state.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'page-info',
            readOnly: true,
            playwrightMethod: 'page.url()'
        }
    },
    {
        name: 'unified_get_page_title',
        description: 'Get the current page title. Useful for SEO testing and page identification.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'page-info',
            readOnly: true,
            playwrightMethod: 'await page.title()'
        }
    },
    {
        name: 'unified_get_viewport_size',
        description: 'Get the current viewport size (width and height).',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'page-info',
            readOnly: true,
            playwrightMethod: 'page.viewportSize()'
        }
    },
    {
        name: 'unified_is_page_closed',
        description: 'Check if the current page/tab is closed.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'page-info',
            readOnly: true,
            playwrightMethod: 'page.isClosed()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXTENDED NAVIGATION TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_reload',
        description: 'Reload the current page. Useful for testing cache behavior and state reset.',
        inputSchema: {
            type: 'object',
            properties: {
                waitUntil: {
                    type: 'string',
                    enum: ['load', 'domcontentloaded', 'networkidle'],
                    description: 'When to consider reload complete. Defaults to load.'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'navigation',
            readOnly: false,
            playwrightMethod: 'await page.reload()'
        }
    },
    {
        name: 'unified_navigate_forward',
        description: 'Navigate forward in browser history.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'navigation',
            readOnly: false,
            playwrightMethod: 'await page.goForward()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ELEMENT CONTENT EXTRACTION TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_get_text_content',
        description: 'Get the text content of an element (includes hidden text). Returns raw text including whitespace.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.textContent()'
        }
    },
    {
        name: 'unified_get_inner_text',
        description: 'Get the visible inner text of an element (excludes hidden text). Better for user-visible text.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.innerText()'
        }
    },
    {
        name: 'unified_get_inner_html',
        description: 'Get the inner HTML of an element. Useful for DOM inspection and content verification.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.innerHTML()'
        }
    },
    {
        name: 'unified_get_outer_html',
        description: 'Get the outer HTML of an element (includes the element itself). Full element inspection.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.outerHTML()'
        }
    },
    {
        name: 'unified_get_attribute',
        description: 'Get a specific attribute value from an element (href, src, data-*, etc.).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                attribute: {
                    type: 'string',
                    description: 'Attribute name to get (e.g., href, src, data-testid)'
                }
            },
            required: ['attribute']
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.getAttribute(name)'
        }
    },
    {
        name: 'unified_get_input_value',
        description: 'Get the current value of an input, textarea, or select element.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.inputValue()'
        }
    },
    {
        name: 'unified_get_bounding_box',
        description: 'Get element bounding box (x, y, width, height). Essential for visual testing and coordinate calculations.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-content',
            readOnly: true,
            playwrightMethod: 'await element.boundingBox()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ELEMENT STATE CHECKING TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_is_visible',
        description: 'Check if an element is visible on the page.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isVisible()'
        }
    },
    {
        name: 'unified_is_hidden',
        description: 'Check if an element is hidden on the page.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isHidden()'
        }
    },
    {
        name: 'unified_is_enabled',
        description: 'Check if an element is enabled (not disabled).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isEnabled()'
        }
    },
    {
        name: 'unified_is_disabled',
        description: 'Check if an element is disabled.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isDisabled()'
        }
    },
    {
        name: 'unified_is_checked',
        description: 'Check if a checkbox or radio button is checked.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isChecked()'
        }
    },
    {
        name: 'unified_is_editable',
        description: 'Check if an element is editable (can receive input).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'element-state',
            readOnly: true,
            playwrightMethod: 'await element.isEditable()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // WAIT FOR ELEMENT STATE TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_wait_for_element',
        description: 'Wait for an element to reach a specific state (attached, visible, hidden, detached).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                state: {
                    type: 'string',
                    enum: ['attached', 'visible', 'hidden', 'detached'],
                    description: 'State to wait for'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default: 30000)'
                }
            },
            required: ['state']
        },
        _meta: {
            source: 'playwright',
            category: 'wait',
            readOnly: false,
            playwrightMethod: 'await element.waitFor({ state })'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // FORM CONTROL TOOLS (CHECK, UNCHECK, CLEAR, FOCUS, BLUR)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_check',
        description: 'Check a checkbox (ensures it becomes checked).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                force: {
                    type: 'boolean',
                    description: 'Force check even if element is not actionable'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.check()'
        }
    },
    {
        name: 'unified_uncheck',
        description: 'Uncheck a checkbox (ensures it becomes unchecked).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                force: {
                    type: 'boolean',
                    description: 'Force uncheck even if element is not actionable'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.uncheck()'
        }
    },
    {
        name: 'unified_clear_input',
        description: 'Clear the value of an input or textarea element.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.clear()'
        }
    },
    {
        name: 'unified_focus',
        description: 'Focus on an element. Useful for triggering focus-related behaviors.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.focus()'
        }
    },
    {
        name: 'unified_blur',
        description: 'Remove focus from an element. Triggers blur/change events.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.blur()'
        }
    },
    {
        name: 'unified_select_text',
        description: 'Focus on an element and select all its text content.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'form-control',
            readOnly: false,
            playwrightMethod: 'await element.selectText()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // SCROLL TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_scroll_into_view',
        description: 'Scroll an element into view if it is not already visible in the viewport.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'scroll',
            readOnly: false,
            playwrightMethod: 'await element.scrollIntoViewIfNeeded()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // KEYBOARD EXTENDED TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_keyboard_type',
        description: 'Type text character by character (triggers keydown/keypress/keyup for each).',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to type'
                },
                delay: {
                    type: 'number',
                    description: 'Delay between key presses in milliseconds'
                }
            },
            required: ['text']
        },
        _meta: {
            source: 'playwright',
            category: 'keyboard',
            readOnly: false,
            playwrightMethod: 'await page.keyboard.type(text, { delay })'
        }
    },
    {
        name: 'unified_keyboard_down',
        description: 'Hold a key down (without releasing). Useful for modifier keys.',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key to hold down (e.g., Shift, Control, Alt)'
                }
            },
            required: ['key']
        },
        _meta: {
            source: 'playwright',
            category: 'keyboard',
            readOnly: false,
            playwrightMethod: 'await page.keyboard.down(key)'
        }
    },
    {
        name: 'unified_keyboard_up',
        description: 'Release a key that is being held down.',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key to release (e.g., Shift, Control, Alt)'
                }
            },
            required: ['key']
        },
        _meta: {
            source: 'playwright',
            category: 'keyboard',
            readOnly: false,
            playwrightMethod: 'await page.keyboard.up(key)'
        }
    },
    {
        name: 'unified_press_sequentially',
        description: 'Type text into focused element one character at a time with delay (triggers key handlers).',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                text: {
                    type: 'string',
                    description: 'Text to type'
                },
                delay: {
                    type: 'number',
                    description: 'Delay between key presses in milliseconds (default: 100)'
                }
            },
            required: ['text']
        },
        _meta: {
            source: 'playwright',
            category: 'keyboard',
            readOnly: false,
            playwrightMethod: 'await element.pressSequentially(text, { delay })'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // MOUSE EXTENDED TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_mouse_down',
        description: 'Press the mouse button down at current position.',
        inputSchema: {
            type: 'object',
            properties: {
                button: {
                    type: 'string',
                    enum: ['left', 'right', 'middle'],
                    description: 'Mouse button to press'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'mouse',
            readOnly: false,
            playwrightMethod: 'await page.mouse.down({ button })'
        }
    },
    {
        name: 'unified_mouse_up',
        description: 'Release the mouse button.',
        inputSchema: {
            type: 'object',
            properties: {
                button: {
                    type: 'string',
                    enum: ['left', 'right', 'middle'],
                    description: 'Mouse button to release'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'mouse',
            readOnly: false,
            playwrightMethod: 'await page.mouse.up({ button })'
        }
    },
    {
        name: 'unified_mouse_dblclick_xy',
        description: 'Double-click at specific coordinates.',
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
            category: 'mouse',
            readOnly: false,
            playwrightMethod: 'await page.mouse.dblclick(x, y)'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // COOKIE MANAGEMENT TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_get_cookies',
        description: 'Get all cookies for the current browser context.',
        inputSchema: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional URLs to filter cookies'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'cookies',
            readOnly: true,
            playwrightMethod: 'await context.cookies()'
        }
    },
    {
        name: 'unified_add_cookies',
        description: 'Add cookies to the browser context. Essential for session management and auth testing.',
        inputSchema: {
            type: 'object',
            properties: {
                cookies: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Cookie name' },
                            value: { type: 'string', description: 'Cookie value' },
                            domain: { type: 'string', description: 'Cookie domain' },
                            path: { type: 'string', description: 'Cookie path' },
                            expires: { type: 'number', description: 'Expiration timestamp' },
                            httpOnly: { type: 'boolean', description: 'HTTP only flag' },
                            secure: { type: 'boolean', description: 'Secure flag' },
                            sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'], description: 'SameSite policy' }
                        },
                        required: ['name', 'value']
                    },
                    description: 'Array of cookies to add'
                }
            },
            required: ['cookies']
        },
        _meta: {
            source: 'playwright',
            category: 'cookies',
            readOnly: false,
            playwrightMethod: 'await context.addCookies(cookies)'
        }
    },
    {
        name: 'unified_clear_cookies',
        description: 'Clear cookies from the browser context.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Clear only cookies with this name'
                },
                domain: {
                    type: 'string',
                    description: 'Clear only cookies for this domain'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'cookies',
            readOnly: false,
            playwrightMethod: 'await context.clearCookies()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // MULTI-PAGE/TAB MANAGEMENT TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_wait_for_new_page',
        description: 'Wait for a new page/tab to be opened (e.g., from clicking target="_blank" link).',
        inputSchema: {
            type: 'object',
            properties: {
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default: 30000)'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'multi-page',
            readOnly: false,
            playwrightMethod: 'const newPage = await context.waitForEvent("page")'
        }
    },
    {
        name: 'unified_bring_to_front',
        description: 'Bring the current page/tab to front (make it active).',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'multi-page',
            readOnly: false,
            playwrightMethod: 'await page.bringToFront()'
        }
    },
    {
        name: 'unified_list_all_pages',
        description: 'List all pages/tabs in the current browser context.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        _meta: {
            source: 'playwright',
            category: 'multi-page',
            readOnly: true,
            playwrightMethod: 'context.pages()'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // DOWNLOAD HANDLING TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_wait_for_download',
        description: 'Wait for a download to start and capture it.',
        inputSchema: {
            type: 'object',
            properties: {
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'download',
            readOnly: false,
            playwrightMethod: 'const download = await page.waitForEvent("download")'
        }
    },
    {
        name: 'unified_save_download',
        description: 'Save a captured download to a file.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to save the downloaded file'
                }
            },
            required: ['path']
        },
        _meta: {
            source: 'playwright',
            category: 'download',
            readOnly: false,
            playwrightMethod: 'await download.saveAs(path)'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADVANCED ELEMENT SELECTION TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_get_by_text',
        description: 'Select element containing specific text.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to search for'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact text (default: false)'
                }
            },
            required: ['text']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByText(text)'
        }
    },
    {
        name: 'unified_get_by_label',
        description: 'Select form element by its associated label text.',
        inputSchema: {
            type: 'object',
            properties: {
                label: {
                    type: 'string',
                    description: 'Label text'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact text (default: false)'
                }
            },
            required: ['label']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByLabel(label)'
        }
    },
    {
        name: 'unified_get_by_role',
        description: 'Select element by ARIA role and accessible name.',
        inputSchema: {
            type: 'object',
            properties: {
                role: {
                    type: 'string',
                    description: 'ARIA role (button, link, textbox, checkbox, etc.)'
                },
                name: {
                    type: 'string',
                    description: 'Accessible name of the element'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact name (default: false)'
                }
            },
            required: ['role']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByRole(role, { name })'
        }
    },
    {
        name: 'unified_get_by_placeholder',
        description: 'Select input element by placeholder text.',
        inputSchema: {
            type: 'object',
            properties: {
                placeholder: {
                    type: 'string',
                    description: 'Placeholder text'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact text (default: false)'
                }
            },
            required: ['placeholder']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByPlaceholder(placeholder)'
        }
    },
    {
        name: 'unified_get_by_alt_text',
        description: 'Select image element by alt text.',
        inputSchema: {
            type: 'object',
            properties: {
                altText: {
                    type: 'string',
                    description: 'Alt text'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact text (default: false)'
                }
            },
            required: ['altText']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByAltText(altText)'
        }
    },
    {
        name: 'unified_get_by_title',
        description: 'Select element by title attribute.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Title attribute value'
                },
                exact: {
                    type: 'boolean',
                    description: 'Match exact text (default: false)'
                }
            },
            required: ['title']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByTitle(title)'
        }
    },
    {
        name: 'unified_get_by_test_id',
        description: 'Select element by data-testid attribute.',
        inputSchema: {
            type: 'object',
            properties: {
                testId: {
                    type: 'string',
                    description: 'Test ID value'
                }
            },
            required: ['testId']
        },
        _meta: {
            source: 'playwright',
            category: 'selectors',
            readOnly: true,
            playwrightMethod: 'page.getByTestId(testId)'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ASSERTION TOOLS (for test validation)
    // ═══════════════════════════════════════════════════════════════════════════════
    {
        name: 'unified_expect_url',
        description: 'Assert that the page URL matches expected value or pattern.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Expected URL or URL pattern'
                },
                contains: {
                    type: 'string',
                    description: 'String that URL should contain'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout for assertion'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(page).toHaveURL(url)'
        }
    },
    {
        name: 'unified_expect_title',
        description: 'Assert that the page title matches expected value.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Expected page title'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout for assertion'
                }
            },
            required: ['title']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(page).toHaveTitle(title)'
        }
    },
    {
        name: 'unified_expect_element_text',
        description: 'Assert that an element contains specific text.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                text: {
                    type: 'string',
                    description: 'Expected text content'
                },
                ignoreCase: {
                    type: 'boolean',
                    description: 'Ignore case when matching'
                }
            },
            required: ['text']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toContainText(text)'
        }
    },
    {
        name: 'unified_expect_element_value',
        description: 'Assert that an input element has a specific value.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                value: {
                    type: 'string',
                    description: 'Expected value'
                }
            },
            required: ['value']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toHaveValue(value)'
        }
    },
    {
        name: 'unified_expect_element_class',
        description: 'Assert that an element has a specific CSS class.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                className: {
                    type: 'string',
                    description: 'Expected CSS class'
                }
            },
            required: ['className']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toHaveClass(className)'
        }
    },
    {
        name: 'unified_expect_element_attribute',
        description: 'Assert that an element has a specific attribute with optional value.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                attribute: {
                    type: 'string',
                    description: 'Attribute name'
                },
                value: {
                    type: 'string',
                    description: 'Expected attribute value (optional)'
                }
            },
            required: ['attribute']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toHaveAttribute(name, value)'
        }
    },
    {
        name: 'unified_expect_element_css',
        description: 'Assert that an element has a specific CSS property value.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                property: {
                    type: 'string',
                    description: 'CSS property name (e.g., display, color)'
                },
                value: {
                    type: 'string',
                    description: 'Expected CSS value'
                }
            },
            required: ['property', 'value']
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toHaveCSS(property, value)'
        }
    },
    {
        name: 'unified_expect_checked',
        description: 'Assert that a checkbox or radio is checked.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                },
                checked: {
                    type: 'boolean',
                    description: 'Expected checked state (default: true)'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toBeChecked()'
        }
    },
    {
        name: 'unified_expect_enabled',
        description: 'Assert that an element is enabled.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toBeEnabled()'
        }
    },
    {
        name: 'unified_expect_disabled',
        description: 'Assert that an element is disabled.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toBeDisabled()'
        }
    },
    {
        name: 'unified_expect_focused',
        description: 'Assert that an element is focused.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toBeFocused()'
        }
    },
    {
        name: 'unified_expect_attached',
        description: 'Assert that an element is attached to the DOM.',
        inputSchema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'Element reference from snapshot'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector if ref not available'
                }
            }
        },
        _meta: {
            source: 'playwright',
            category: 'assertions',
            readOnly: true,
            playwrightMethod: 'await expect(element).toBeAttached()'
        }
    }
];

/**
 * Enhanced tool mapping for bridge routing
 */
export const ENHANCED_TOOL_MAPPING = {
    // Page info
    unified_get_page_url: 'browser_get_page_url',
    unified_get_page_title: 'browser_get_page_title',
    unified_get_viewport_size: 'browser_get_viewport_size',
    unified_is_page_closed: 'browser_is_page_closed',

    // Navigation extended
    unified_reload: 'browser_reload',
    unified_navigate_forward: 'browser_navigate_forward',

    // Element content
    unified_get_text_content: 'browser_get_text_content',
    unified_get_inner_text: 'browser_get_inner_text',
    unified_get_inner_html: 'browser_get_inner_html',
    unified_get_outer_html: 'browser_get_outer_html',
    unified_get_attribute: 'browser_get_attribute',
    unified_get_input_value: 'browser_get_input_value',
    unified_get_bounding_box: 'browser_get_bounding_box',

    // Element state
    unified_is_visible: 'browser_is_visible',
    unified_is_hidden: 'browser_is_hidden',
    unified_is_enabled: 'browser_is_enabled',
    unified_is_disabled: 'browser_is_disabled',
    unified_is_checked: 'browser_is_checked',
    unified_is_editable: 'browser_is_editable',

    // Wait
    unified_wait_for_element: 'browser_wait_for_element',

    // Form control
    unified_check: 'browser_check',
    unified_uncheck: 'browser_uncheck',
    unified_clear_input: 'browser_clear_input',
    unified_focus: 'browser_focus',
    unified_blur: 'browser_blur',
    unified_select_text: 'browser_select_text',

    // Scroll
    unified_scroll_into_view: 'browser_scroll_into_view',

    // Keyboard
    unified_keyboard_type: 'browser_keyboard_type',
    unified_keyboard_down: 'browser_keyboard_down',
    unified_keyboard_up: 'browser_keyboard_up',
    unified_press_sequentially: 'browser_press_sequentially',

    // Mouse
    unified_mouse_down: 'browser_mouse_down',
    unified_mouse_up: 'browser_mouse_up',
    unified_mouse_dblclick_xy: 'browser_mouse_dblclick_xy',

    // Cookies
    unified_get_cookies: 'browser_get_cookies',
    unified_add_cookies: 'browser_add_cookies',
    unified_clear_cookies: 'browser_clear_cookies',

    // Multi-page
    unified_wait_for_new_page: 'browser_wait_for_new_page',
    unified_bring_to_front: 'browser_bring_to_front',
    unified_list_all_pages: 'browser_list_all_pages',

    // Downloads
    unified_wait_for_download: 'browser_wait_for_download',
    unified_save_download: 'browser_save_download',

    // Selectors
    unified_get_by_text: 'browser_get_by_text',
    unified_get_by_label: 'browser_get_by_label',
    unified_get_by_role: 'browser_get_by_role',
    unified_get_by_placeholder: 'browser_get_by_placeholder',
    unified_get_by_alt_text: 'browser_get_by_alt_text',
    unified_get_by_title: 'browser_get_by_title',
    unified_get_by_test_id: 'browser_get_by_test_id',

    // Assertions
    unified_expect_url: 'browser_expect_url',
    unified_expect_title: 'browser_expect_title',
    unified_expect_element_text: 'browser_expect_element_text',
    unified_expect_element_value: 'browser_expect_element_value',
    unified_expect_element_class: 'browser_expect_element_class',
    unified_expect_element_attribute: 'browser_expect_element_attribute',
    unified_expect_element_css: 'browser_expect_element_css',
    unified_expect_checked: 'browser_expect_checked',
    unified_expect_enabled: 'browser_expect_enabled',
    unified_expect_disabled: 'browser_expect_disabled',
    unified_expect_focused: 'browser_expect_focused',
    unified_expect_attached: 'browser_expect_attached',
};

/**
 * Get all enhanced tools (combine with existing)
 */
export function getAllEnhancedTools() {
    return ENHANCED_TOOLS;
}

/**
 * Export tool categories for documentation
 */
export const ENHANCED_CATEGORIES = {
    'page-info': 'Page URL, title, viewport, and state inspection',
    'element-content': 'Extract text, HTML, attributes from elements',
    'element-state': 'Check visibility, enabled state, checked state',
    'form-control': 'Check, uncheck, clear, focus, blur operations',
    'scroll': 'Scroll elements into view',
    'keyboard': 'Extended keyboard operations (down, up, type)',
    'mouse': 'Extended mouse operations (down, up, double-click)',
    'cookies': 'Cookie management (get, add, clear)',
    'multi-page': 'Multi-tab/window management',
    'download': 'File download handling',
    'selectors': 'Advanced element selection strategies',
    'assertions': 'Test assertion methods'
};
