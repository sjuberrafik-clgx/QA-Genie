/**
 * Browser Manager - Robust browser lifecycle management for Playwright tests
 * 
 * This module provides stable browser management that prevents premature closures
 * and handles common browser lifecycle issues in the test framework.
 * 
 * @module BrowserManager
 * @version 1.0.0
 */

const { chromium, firefox, webkit } = require('playwright');

/**
 * BrowserManager class for robust browser lifecycle management
 */
class BrowserManager {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isInitialized = false;
        this.initializationPromise = null;
    }

    /**
     * Initialize browser with retry logic
     * @param {Object} options - Configuration options
     * @returns {Object} - { browser, context, page }
     */
    async initialize(options = {}) {
        // Prevent multiple simultaneous initializations
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this._doInitialize(options);
        return this.initializationPromise;
    }

    async _doInitialize(options = {}) {
        const {
            browserType = process.env.BROWSER_TYPE || 'chromium',
            headless = process.env.HEADLESS !== 'false',
            viewport = headless ? { width: 1280, height: 720 } : null,
            retries = 3,
            timeout = parseInt(process.env.NAVIGATION_TIMEOUT, 10) || 30000
        } = options;

        let lastError;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`🚀 Browser initialization attempt ${attempt}/${retries}...`);

                // Clean up any existing browser first
                await this.cleanup();

                const launchOptions = {
                    headless,
                    args: [
                        '--start-maximized',
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox'
                    ],
                    timeout
                };

                // Launch browser based on type
                switch (browserType) {
                    case 'firefox':
                        this.browser = await firefox.launch(launchOptions);
                        break;
                    case 'webkit':
                        this.browser = await webkit.launch(launchOptions);
                        break;
                    case 'chromium':
                    default:
                        this.browser = await chromium.launch(launchOptions);
                        break;
                }

                // Create context with viewport
                this.context = await this.browser.newContext({
                    viewport,
                    ignoreHTTPSErrors: true,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                });

                // Create page
                this.page = await this.context.newPage();

                // Set default timeouts
                this.page.setDefaultTimeout(30000);
                this.page.setDefaultNavigationTimeout(60000);

                // Add event listeners for debugging
                this.page.on('pageerror', (error) => {
                    console.error('❌ Page error:', error.message);
                });

                this.page.on('crash', () => {
                    console.error('💥 Page crashed! Attempting recovery...');
                    this.isInitialized = false;
                });

                this.context.on('close', () => {
                    console.log('⚠️ Context closed');
                    this.isInitialized = false;
                });

                this.isInitialized = true;
                console.log('✅ Browser initialized successfully');

                return { browser: this.browser, context: this.context, page: this.page };

            } catch (error) {
                lastError = error;
                console.error(`❌ Browser initialization attempt ${attempt} failed:`, error.message);

                if (attempt < retries) {
                    console.log(`⏳ Waiting 2 seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        throw new Error(`Failed to initialize browser after ${retries} attempts: ${lastError?.message}`);
    }

    /**
     * Get current page or create new one if needed
     * @returns {Page} - Playwright page object
     */
    async getPage() {
        if (!this.isInitialized || !this.page || this.page.isClosed()) {
            console.log('⚠️ Page not available, reinitializing...');
            await this.initialize();
        }
        return this.page;
    }

    /**
     * Create a new page in the same context
     * @returns {Page} - New Playwright page object
     */
    async newPage() {
        if (!this.context) {
            await this.initialize();
        }
        return this.context.newPage();
    }

    /**
     * Check if browser is still active
     * @returns {boolean}
     */
    isActive() {
        return this.isInitialized &&
            this.browser &&
            this.browser.isConnected() &&
            this.page &&
            !this.page.isClosed();
    }

    /**
     * Clean up all browser resources
     */
    async cleanup() {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.close().catch(() => { });
            }
            if (this.context) {
                await this.context.close().catch(() => { });
            }
            if (this.browser) {
                await this.browser.close().catch(() => { });
            }
        } catch (error) {
            console.warn('⚠️ Cleanup warning:', error.message);
        } finally {
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
            this.initializationPromise = null;
        }
    }

    /**
     * Reset page state (navigate to blank, clear cookies)
     */
    async resetState() {
        if (this.isActive()) {
            try {
                await this.page.goto('about:blank');
                await this.context.clearCookies();
            } catch (error) {
                console.warn('⚠️ State reset warning:', error.message);
            }
        }
    }
}

// Singleton instance for shared use
let browserManagerInstance = null;

/**
 * Get singleton browser manager instance
 * @returns {BrowserManager}
 */
function getBrowserManager() {
    if (!browserManagerInstance) {
        browserManagerInstance = new BrowserManager();
    }
    return browserManagerInstance;
}

/**
 * Enhanced launchBrowser function with retry and recovery
 * Drop-in replacement for the existing launchBrowser
 * @returns {Object} - { browser, context, page }
 */
async function launchBrowser(options = {}) {
    const manager = getBrowserManager();
    return manager.initialize(options);
}

/**
 * Safe navigation with automatic recovery
 * @param {Page} page - Playwright page
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 */
async function safeNavigate(page, url, options = {}) {
    const {
        timeout = 60000,
        waitUntil = 'domcontentloaded',
        retries = 3
    } = options;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`🔗 Navigating to: ${url.substring(0, 80)}...`);
            await page.goto(url, { timeout, waitUntil });
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            console.log('✅ Navigation successful');
            return;
        } catch (error) {
            console.error(`❌ Navigation attempt ${attempt} failed:`, error.message);

            if (attempt < retries) {
                console.log('⏳ Retrying navigation...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                throw error;
            }
        }
    }
}

module.exports = {
    BrowserManager,
    getBrowserManager,
    launchBrowser,
    safeNavigate
};
