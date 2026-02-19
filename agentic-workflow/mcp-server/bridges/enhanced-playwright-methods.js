/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ENHANCED PLAYWRIGHT BRIDGE - Deep Exploration Methods
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Implements all enhanced tools from Playwright cheatsheet for:
 * - Deep application exploration
 * - Accurate selector generation
 * - Comprehensive state verification
 * - Full DOM/element introspection
 * 
 * Usage: Import and extend PlaywrightDirectBridge with these methods
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { SelectorEngine } from '../utils/selector-engine.js';

/**
 * Enhanced methods to be mixed into PlaywrightDirectBridge
 * These provide deep exploration capabilities
 */
export const EnhancedPlaywrightMethods = {

    // ═══════════════════════════════════════════════════════════════════════════════
    // PAGE INFORMATION METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Get current page URL
     */
    async getPageUrl() {
        return {
            success: true,
            url: this.page.url()
        };
    },

    /**
     * Get current page title
     */
    async getPageTitle() {
        const title = await this.page.title();
        return {
            success: true,
            title
        };
    },

    /**
     * Get viewport size
     */
    async getViewportSize() {
        const size = this.page.viewportSize();
        return {
            success: true,
            width: size?.width,
            height: size?.height
        };
    },

    /**
     * Check if page is closed
     */
    async isPageClosed() {
        return {
            success: true,
            closed: this.page.isClosed()
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXTENDED NAVIGATION METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Reload the current page
     */
    async reload(args = {}) {
        const { waitUntil = 'load' } = args;
        await this.page.reload({ waitUntil });
        return {
            success: true,
            url: this.page.url()
        };
    },

    /**
     * Navigate forward in history
     */
    async navigateForward() {
        await this.page.goForward();
        return {
            success: true,
            url: this.page.url()
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ELEMENT CONTENT EXTRACTION METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Resolve selector from ref or selector string.
     * Delegates to SelectorEngine for consistent, ranked resolution.
     */
    _resolveSelector(args) {
        const { ref, selector } = args;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                const resolved = SelectorEngine.resolveCssSelector(refData);
                if (resolved) return resolved;
                throw new Error(`Could not resolve a stable selector for ref "${ref}". Take a new snapshot.`);
            }
            throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
        }
        return selector;
    },

    /**
     * Get text content of element
     */
    async getTextContent(args) {
        const selector = this._resolveSelector(args);
        const text = await this.page.locator(selector).textContent();
        return {
            success: true,
            textContent: text,
            selector
        };
    },

    /**
     * Get inner text of element (visible text only)
     */
    async getInnerText(args) {
        const selector = this._resolveSelector(args);
        const text = await this.page.locator(selector).innerText();
        return {
            success: true,
            innerText: text,
            selector
        };
    },

    /**
     * Get inner HTML of element
     */
    async getInnerHtml(args) {
        const selector = this._resolveSelector(args);
        const html = await this.page.locator(selector).innerHTML();
        return {
            success: true,
            innerHTML: html,
            selector
        };
    },

    /**
     * Get outer HTML of element
     */
    async getOuterHtml(args) {
        const selector = this._resolveSelector(args);
        // outerHTML requires evaluate
        const html = await this.page.locator(selector).evaluate(el => el.outerHTML);
        return {
            success: true,
            outerHTML: html,
            selector
        };
    },

    /**
     * Get attribute value
     */
    async getAttribute(args) {
        const { attribute } = args;
        const selector = this._resolveSelector(args);
        const value = await this.page.locator(selector).getAttribute(attribute);
        return {
            success: true,
            attribute,
            value,
            selector
        };
    },

    /**
     * Get input value
     */
    async getInputValue(args) {
        const selector = this._resolveSelector(args);
        const value = await this.page.locator(selector).inputValue();
        return {
            success: true,
            value,
            selector
        };
    },

    /**
     * Get bounding box
     */
    async getBoundingBox(args) {
        const selector = this._resolveSelector(args);
        const box = await this.page.locator(selector).boundingBox();
        return {
            success: true,
            boundingBox: box,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ELEMENT STATE CHECKING METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Check if element is visible
     */
    async isVisible(args) {
        const selector = this._resolveSelector(args);
        const visible = await this.page.locator(selector).isVisible();
        return {
            success: true,
            visible,
            selector
        };
    },

    /**
     * Check if element is hidden
     */
    async isHidden(args) {
        const selector = this._resolveSelector(args);
        const hidden = await this.page.locator(selector).isHidden();
        return {
            success: true,
            hidden,
            selector
        };
    },

    /**
     * Check if element is enabled
     */
    async isEnabled(args) {
        const selector = this._resolveSelector(args);
        const enabled = await this.page.locator(selector).isEnabled();
        return {
            success: true,
            enabled,
            selector
        };
    },

    /**
     * Check if element is disabled
     */
    async isDisabled(args) {
        const selector = this._resolveSelector(args);
        const disabled = await this.page.locator(selector).isDisabled();
        return {
            success: true,
            disabled,
            selector
        };
    },

    /**
     * Check if checkbox/radio is checked
     */
    async isChecked(args) {
        const selector = this._resolveSelector(args);
        const checked = await this.page.locator(selector).isChecked();
        return {
            success: true,
            checked,
            selector
        };
    },

    /**
     * Check if element is editable
     */
    async isEditable(args) {
        const selector = this._resolveSelector(args);
        const editable = await this.page.locator(selector).isEditable();
        return {
            success: true,
            editable,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // WAIT FOR ELEMENT STATE METHOD
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Wait for element to reach specific state
     */
    async waitForElement(args) {
        const { state, timeout = 30000 } = args;
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).waitFor({ state, timeout });
        return {
            success: true,
            state,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // FORM CONTROL METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Check a checkbox
     */
    async check(args) {
        const { force = false } = args;
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).check({ force });
        return {
            success: true,
            checked: true,
            selector
        };
    },

    /**
     * Uncheck a checkbox
     */
    async uncheck(args) {
        const { force = false } = args;
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).uncheck({ force });
        return {
            success: true,
            checked: false,
            selector
        };
    },

    /**
     * Clear input field
     */
    async clearInput(args) {
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).clear();
        return {
            success: true,
            cleared: true,
            selector
        };
    },

    /**
     * Focus on element
     */
    async focus(args) {
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).focus();
        return {
            success: true,
            focused: true,
            selector
        };
    },

    /**
     * Remove focus from element (blur)
     */
    async blur(args) {
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).blur();
        return {
            success: true,
            blurred: true,
            selector
        };
    },

    /**
     * Select all text in element
     */
    async selectText(args) {
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).selectText();
        return {
            success: true,
            textSelected: true,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // SCROLL METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Scroll element into view
     */
    async scrollIntoView(args) {
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).scrollIntoViewIfNeeded();
        return {
            success: true,
            scrolledIntoView: true,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // KEYBOARD EXTENDED METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Type text character by character
     */
    async keyboardType(args) {
        const { text, delay } = args;
        await this.page.keyboard.type(text, { delay });
        return {
            success: true,
            typed: text
        };
    },

    /**
     * Hold a key down
     */
    async keyboardDown(args) {
        const { key } = args;
        await this.page.keyboard.down(key);
        return {
            success: true,
            keyDown: key
        };
    },

    /**
     * Release a key
     */
    async keyboardUp(args) {
        const { key } = args;
        await this.page.keyboard.up(key);
        return {
            success: true,
            keyUp: key
        };
    },

    /**
     * Type text sequentially into element
     */
    async pressSequentially(args) {
        const { text, delay = 100 } = args;
        const selector = this._resolveSelector(args);
        await this.page.locator(selector).pressSequentially(text, { delay });
        return {
            success: true,
            typed: text,
            selector
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // MOUSE EXTENDED METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Press mouse button down
     */
    async mouseDown(args = {}) {
        const { button = 'left' } = args;
        await this.page.mouse.down({ button });
        return {
            success: true,
            button,
            action: 'down'
        };
    },

    /**
     * Release mouse button
     */
    async mouseUp(args = {}) {
        const { button = 'left' } = args;
        await this.page.mouse.up({ button });
        return {
            success: true,
            button,
            action: 'up'
        };
    },

    /**
     * Double-click at coordinates
     */
    async mouseDblclickXY(args) {
        const { x, y } = args;
        await this.page.mouse.dblclick(x, y);
        return {
            success: true,
            x,
            y,
            action: 'dblclick'
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // COOKIE MANAGEMENT METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Get all cookies
     */
    async getCookies(args = {}) {
        const { urls } = args;
        const cookies = await this.context.cookies(urls);
        return {
            success: true,
            cookies,
            count: cookies.length
        };
    },

    /**
     * Add cookies
     */
    async addCookies(args) {
        const { cookies } = args;
        await this.context.addCookies(cookies);
        return {
            success: true,
            added: cookies.length
        };
    },

    /**
     * Clear cookies
     */
    async clearCookies(args = {}) {
        const { name, domain } = args;
        const options = {};
        if (name) options.name = name;
        if (domain) options.domain = domain;

        await this.context.clearCookies(Object.keys(options).length ? options : undefined);
        return {
            success: true,
            cleared: true,
            filter: options
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // MULTI-PAGE MANAGEMENT METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Wait for new page/tab to open
     */
    async waitForNewPage(args = {}) {
        const { timeout = 30000 } = args;
        const newPage = await this.context.waitForEvent('page', { timeout });

        // Store reference to new page
        this._lastNewPage = newPage;

        return {
            success: true,
            url: newPage.url(),
            newPageAvailable: true
        };
    },

    /**
     * Bring page to front
     */
    async bringToFront() {
        await this.page.bringToFront();
        return {
            success: true,
            broughtToFront: true
        };
    },

    /**
     * List all pages
     */
    async listAllPages() {
        const pages = this.context.pages();
        return {
            success: true,
            pages: pages.map((p, i) => ({
                index: i,
                url: p.url(),
                isCurrent: p === this.page,
                isClosed: p.isClosed()
            })),
            count: pages.length
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // DOWNLOAD HANDLING METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Wait for download
     */
    async waitForDownload(args = {}) {
        const { timeout = 30000 } = args;
        const download = await this.page.waitForEvent('download', { timeout });

        // Store download reference
        this._lastDownload = download;

        return {
            success: true,
            suggestedFilename: download.suggestedFilename(),
            url: download.url()
        };
    },

    /**
     * Save download to file
     */
    async saveDownload(args) {
        const { path } = args;

        if (!this._lastDownload) {
            return {
                success: false,
                error: 'No download available. Call waitForDownload first.'
            };
        }

        await this._lastDownload.saveAs(path);
        return {
            success: true,
            savedTo: path
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADVANCED SELECTOR METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Get element by text
     */
    async getByText(args) {
        const { text, exact = false } = args;
        const locator = this.page.getByText(text, { exact });
        const count = await locator.count();

        // Get info about matched elements
        const elements = [];
        for (let i = 0; i < Math.min(count, 10); i++) {
            const el = locator.nth(i);
            elements.push({
                index: i,
                visible: await el.isVisible(),
                text: await el.textContent()
            });
        }

        return {
            success: true,
            count,
            elements,
            locator: `getByText("${text}")`
        };
    },

    /**
     * Get element by label
     */
    async getByLabel(args) {
        const { label, exact = false } = args;
        const locator = this.page.getByLabel(label, { exact });
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByLabel("${label}")`
        };
    },

    /**
     * Get element by role
     */
    async getByRole(args) {
        const { role, name, exact = false } = args;
        const options = {};
        if (name) options.name = name;
        if (exact) options.exact = exact;

        const locator = this.page.getByRole(role, Object.keys(options).length ? options : undefined);
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByRole("${role}"${name ? `, { name: "${name}" }` : ''})`
        };
    },

    /**
     * Get element by placeholder
     */
    async getByPlaceholder(args) {
        const { placeholder, exact = false } = args;
        const locator = this.page.getByPlaceholder(placeholder, { exact });
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByPlaceholder("${placeholder}")`
        };
    },

    /**
     * Get element by alt text
     */
    async getByAltText(args) {
        const { altText, exact = false } = args;
        const locator = this.page.getByAltText(altText, { exact });
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByAltText("${altText}")`
        };
    },

    /**
     * Get element by title
     */
    async getByTitle(args) {
        const { title, exact = false } = args;
        const locator = this.page.getByTitle(title, { exact });
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByTitle("${title}")`
        };
    },

    /**
     * Get element by test ID
     */
    async getByTestId(args) {
        const { testId } = args;
        const locator = this.page.getByTestId(testId);
        const count = await locator.count();

        return {
            success: true,
            count,
            found: count > 0,
            locator: `getByTestId("${testId}")`
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════════
    // ASSERTION METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Assert URL
     */
    async expectUrl(args) {
        const { url, contains, timeout = 5000 } = args;
        try {
            if (url) {
                await this.page.waitForURL(url, { timeout });
            } else if (contains) {
                await this.page.waitForURL(u => u.href.includes(contains), { timeout });
            }
            return {
                success: true,
                passed: true,
                currentUrl: this.page.url()
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                currentUrl: this.page.url(),
                error: e.message
            };
        }
    },

    /**
     * Assert title
     */
    async expectTitle(args) {
        const { title, timeout = 5000 } = args;
        try {
            await this.page.waitForFunction(
                expectedTitle => document.title === expectedTitle || document.title.includes(expectedTitle),
                title,
                { timeout }
            );
            return {
                success: true,
                passed: true,
                currentTitle: await this.page.title()
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                currentTitle: await this.page.title(),
                error: e.message
            };
        }
    },

    /**
     * Assert element contains text
     */
    async expectElementText(args) {
        const { text, ignoreCase = false } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const actualText = await element.textContent();

            const matches = ignoreCase
                ? actualText.toLowerCase().includes(text.toLowerCase())
                : actualText.includes(text);

            return {
                success: matches,
                passed: matches,
                expected: text,
                actual: actualText,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element value
     */
    async expectElementValue(args) {
        const { value } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const actualValue = await element.inputValue();
            const matches = actualValue === value;

            return {
                success: matches,
                passed: matches,
                expected: value,
                actual: actualValue,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element has class
     */
    async expectElementClass(args) {
        const { className } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const classes = await element.getAttribute('class');
            const hasClass = classes?.split(' ').includes(className);

            return {
                success: hasClass,
                passed: hasClass,
                expected: className,
                actual: classes,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element has attribute
     */
    async expectElementAttribute(args) {
        const { attribute, value } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const actualValue = await element.getAttribute(attribute);
            const hasAttribute = actualValue !== null;
            const matches = value ? actualValue === value : hasAttribute;

            return {
                success: matches,
                passed: matches,
                attribute,
                expected: value || '(any)',
                actual: actualValue,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element CSS property
     */
    async expectElementCss(args) {
        const { property, value } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const actualValue = await element.evaluate(
                (el, prop) => getComputedStyle(el).getPropertyValue(prop),
                property
            );
            const matches = actualValue === value;

            return {
                success: matches,
                passed: matches,
                property,
                expected: value,
                actual: actualValue,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert checkbox is checked
     */
    async expectChecked(args) {
        const { checked = true } = args;
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const isChecked = await element.isChecked();
            const matches = isChecked === checked;

            return {
                success: matches,
                passed: matches,
                expected: checked,
                actual: isChecked,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element is enabled
     */
    async expectEnabled(args) {
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const isEnabled = await element.isEnabled();

            return {
                success: isEnabled,
                passed: isEnabled,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element is disabled
     */
    async expectDisabled(args) {
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const isDisabled = await element.isDisabled();

            return {
                success: isDisabled,
                passed: isDisabled,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element is focused
     */
    async expectFocused(args) {
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const isFocused = await element.evaluate(el => document.activeElement === el);

            return {
                success: isFocused,
                passed: isFocused,
                selector
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    },

    /**
     * Assert element is attached to DOM
     */
    async expectAttached(args) {
        const selector = this._resolveSelector(args);
        try {
            const element = this.page.locator(selector);
            const count = await element.count();
            const isAttached = count > 0;

            return {
                success: isAttached,
                passed: isAttached,
                selector,
                count
            };
        } catch (e) {
            return {
                success: false,
                passed: false,
                error: e.message,
                selector
            };
        }
    }
};

/**
 * Extended tool map for routing enhanced tools
 */
export const ENHANCED_TOOL_MAP = {
    // Page info
    'browser_get_page_url': 'getPageUrl',
    'browser_get_page_title': 'getPageTitle',
    'browser_get_viewport_size': 'getViewportSize',
    'browser_is_page_closed': 'isPageClosed',

    // Navigation
    'browser_reload': 'reload',
    'browser_navigate_forward': 'navigateForward',

    // Element content
    'browser_get_text_content': 'getTextContent',
    'browser_get_inner_text': 'getInnerText',
    'browser_get_inner_html': 'getInnerHtml',
    'browser_get_outer_html': 'getOuterHtml',
    'browser_get_attribute': 'getAttribute',
    'browser_get_input_value': 'getInputValue',
    'browser_get_bounding_box': 'getBoundingBox',

    // Element state
    'browser_is_visible': 'isVisible',
    'browser_is_hidden': 'isHidden',
    'browser_is_enabled': 'isEnabled',
    'browser_is_disabled': 'isDisabled',
    'browser_is_checked': 'isChecked',
    'browser_is_editable': 'isEditable',

    // Wait
    'browser_wait_for_element': 'waitForElement',

    // Form control
    'browser_check': 'check',
    'browser_uncheck': 'uncheck',
    'browser_clear_input': 'clearInput',
    'browser_focus': 'focus',
    'browser_blur': 'blur',
    'browser_select_text': 'selectText',

    // Scroll
    'browser_scroll_into_view': 'scrollIntoView',

    // Keyboard
    'browser_keyboard_type': 'keyboardType',
    'browser_keyboard_down': 'keyboardDown',
    'browser_keyboard_up': 'keyboardUp',
    'browser_press_sequentially': 'pressSequentially',

    // Mouse
    'browser_mouse_down': 'mouseDown',
    'browser_mouse_up': 'mouseUp',
    'browser_mouse_dblclick_xy': 'mouseDblclickXY',

    // Cookies
    'browser_get_cookies': 'getCookies',
    'browser_add_cookies': 'addCookies',
    'browser_clear_cookies': 'clearCookies',

    // Multi-page
    'browser_wait_for_new_page': 'waitForNewPage',
    'browser_bring_to_front': 'bringToFront',
    'browser_list_all_pages': 'listAllPages',

    // Downloads
    'browser_wait_for_download': 'waitForDownload',
    'browser_save_download': 'saveDownload',

    // Selectors
    'browser_get_by_text': 'getByText',
    'browser_get_by_label': 'getByLabel',
    'browser_get_by_role': 'getByRole',
    'browser_get_by_placeholder': 'getByPlaceholder',
    'browser_get_by_alt_text': 'getByAltText',
    'browser_get_by_title': 'getByTitle',
    'browser_get_by_test_id': 'getByTestId',

    // Assertions
    'browser_expect_url': 'expectUrl',
    'browser_expect_title': 'expectTitle',
    'browser_expect_element_text': 'expectElementText',
    'browser_expect_element_value': 'expectElementValue',
    'browser_expect_element_class': 'expectElementClass',
    'browser_expect_element_attribute': 'expectElementAttribute',
    'browser_expect_element_css': 'expectElementCss',
    'browser_expect_checked': 'expectChecked',
    'browser_expect_enabled': 'expectEnabled',
    'browser_expect_disabled': 'expectDisabled',
    'browser_expect_focused': 'expectFocused',
    'browser_expect_attached': 'expectAttached',
};

/**
 * Apply enhanced methods to PlaywrightDirectBridge
 */
export function applyEnhancedMethods(bridgeInstance) {
    Object.assign(bridgeInstance, EnhancedPlaywrightMethods);

    // Extend the tool map
    const originalCallTool = bridgeInstance.callTool.bind(bridgeInstance);

    bridgeInstance.callTool = async function (toolName, args = {}) {
        // Check if it's an enhanced tool
        const methodName = ENHANCED_TOOL_MAP[toolName];
        if (methodName && typeof this[methodName] === 'function') {
            await this.ensureConnected();
            console.error(`[PlaywrightDirect] Calling enhanced tool: ${toolName} -> ${methodName}`);
            return await this[methodName](args);
        }

        // Fall back to original
        return originalCallTool(toolName, args);
    };

    return bridgeInstance;
}
