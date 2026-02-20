/**
 * Stable Test Script Template
 * 
 * This template provides a robust foundation for generated Playwright scripts
 * with proper browser lifecycle management, dynamic navigation, and recovery.
 * 
 * Template Version: 1.0.0
 * 
 * USAGE:
 * The ScriptGenerator agent should use this template as a base and customize:
 * - TICKET_ID: Replace with actual ticket ID
 * - TEST_TITLE: Replace with descriptive title
 * - testCases: Add actual test case implementations
 */

// ============================================
// TEMPLATE CONFIGURATION
// ============================================
const TICKET_ID = '{{TICKET_ID}}';  // Will be replaced by generator
const TEST_TITLE = '{{TEST_TITLE}}'; // Will be replaced by generator

// ============================================
// IMPORTS - Always use CommonJS requires
// ============================================
const { test, expect } = require('@playwright/test');
const { launchBrowser, safeNavigate } = require('../../../tests/config/browser-manager');
const { userTokens, baseUrl } = require('../../../tests/test-data/testData');

// ============================================
// TEST SUITE
// ============================================
test.describe(`${TICKET_ID}: ${TEST_TITLE}`, () => {
    let browser, context, page;

    // =========================================
    // LIFECYCLE HOOKS - Per-test isolation
    // =========================================
    test.beforeEach(async () => {
        // Launch fresh browser for each test (isolation)
        const launched = await launchBrowser();
        browser = launched.browser;
        context = launched.context;
        page = launched.page;
    });

    test.afterEach(async () => {
        // Clean up after each test
        await cleanupBrowser();
    });

    // =========================================
    // HELPER FUNCTIONS - Reusable patterns
    // =========================================

    /**
     * Safe browser cleanup with error handling
     */
    async function cleanupBrowser() {
        try {
            if (page && !page.isClosed()) {
                await page.close().catch(() => { });
            }
            if (context) {
                await context.close().catch(() => { });
            }
            if (browser) {
                await browser.close().catch(() => { });
            }
        } catch (e) {
            console.warn('⚠️ Cleanup warning:', e.message);
        }
    }

    /**
     * Handle application popups/modals automatically
     * This function checks for common popup patterns and dismisses them
     * Called after navigation to ensure clean test state
     */
    async function handlePopups() {
        const popupPatterns = [
            {
                name: 'Welcome Modal',
                detectSelectors: [
                    'text=Welcome to OneHome',
                    '[role="dialog"]:has-text("Welcome")',
                    '.modal:has-text("Welcome")'
                ],
                dismissSelectors: [
                    'button:has-text("Continue")',
                    'button:has-text("Got it")',
                    'button:has-text("Close")'
                ]
            },
            {
                name: 'Cookie Consent',
                detectSelectors: [
                    'text=Accept Cookies',
                    '[class*="cookie"]'
                ],
                dismissSelectors: [
                    'button:has-text("Accept")',
                    'button:has-text("Accept All")'
                ]
            },
            {
                name: 'Survey/Feedback',
                detectSelectors: [
                    'text=Take a Survey',
                    'text=Feedback',
                    '[class*="survey"]'
                ],
                dismissSelectors: [
                    'button:has-text("No Thanks")',
                    'button:has-text("Close")'
                ]
            },
            {
                name: 'Generic Modal',
                detectSelectors: [
                    '[role="dialog"]:visible',
                    '.modal:visible'
                ],
                dismissSelectors: [
                    'button:has-text("Close")',
                    'button:has-text("OK")',
                    '[aria-label="Close"]'
                ]
            }
        ];

        for (const popup of popupPatterns) {
            for (const detectSelector of popup.detectSelectors) {
                try {
                    const popupElement = page.locator(detectSelector).first();
                    if (await popupElement.isVisible({ timeout: 2000 })) {
                        console.log(`🔔 Detected popup: ${popup.name}`);

                        // Try each dismiss selector
                        for (const dismissSelector of popup.dismissSelectors) {
                            try {
                                const dismissBtn = page.locator(dismissSelector).first();
                                if (await dismissBtn.isVisible({ timeout: 1000 })) {
                                    await dismissBtn.click();
                                    await page.waitForTimeout(1000);
                                    console.log(`✅ Dismissed popup: ${popup.name}`);
                                    break;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                        break; // Move to next popup type
                    }
                } catch (e) {
                    continue;
                }
            }
        }
    }

    /**
     * Dynamic navigation with multiple strategies
     * @param {string} token - User token for authentication
     * @param {string} targetPage - Target page type (optional)
     */
    async function navigateToApp(token = userTokens.canopy, targetPage = null) {
        console.log('🔗 Navigating to application...');

        const url = `${baseUrl}token=${token}`;
        await safeNavigate(page, url);

        // Handle any popups that appear after initial load
        await handlePopups();

        // If target page specified, try to navigate there
        if (targetPage) {
            await navigateToPage(targetPage);
            // Handle any popups that appear after navigation
            await handlePopups();
        }
    }

    /**
     * Navigate to a specific page using dynamic link discovery
     * @param {string} pageType - Type of page (e.g., 'terms', 'privacy', 'settings')
     */
    async function navigateToPage(pageType) {
        console.log(`🔗 Navigating to ${pageType} page...`);

        const linkSelectors = {
            'terms': [
                'a:has-text("Terms of Use")',
                'a:has-text("Terms of Service")',
                'a:has-text("Terms & Policies")',
                'a[href*="/legal"]',
                'a[href*="/terms"]',
                'footer a:has-text("Terms")'
            ],
            'privacy': [
                'a:has-text("Privacy Policy")',
                'a:has-text("Privacy")',
                'a[href*="/privacy"]',
                'footer a:has-text("Privacy")'
            ],
            'settings': [
                'a:has-text("Settings")',
                'button:has-text("Settings")',
                '[aria-label*="settings"]'
            ]
        };

        const selectors = linkSelectors[pageType] || [`a:has-text("${pageType}")`];

        for (const selector of selectors) {
            try {
                const link = page.locator(selector).first();
                if (await link.isVisible({ timeout: 3000 })) {
                    console.log(`✓ Found link: ${selector}`);
                    await link.click();
                    await page.waitForLoadState('networkidle');
                    return true;
                }
            } catch (e) {
                continue;
            }
        }

        console.warn(`⚠️ Could not find ${pageType} link - using fallback`);
        return false;
    }

    /**
     * Click a tab or button with dynamic discovery
     * @param {string} tabName - Name of the tab to click
     */
    async function clickTab(tabName) {
        const selectors = [
            `button:has-text("${tabName}")`,
            `a:has-text("${tabName}")`,
            `[role="tab"]:has-text("${tabName}")`,
            `li:has-text("${tabName}")`
        ];

        for (const selector of selectors) {
            try {
                const tab = page.locator(selector).first();
                if (await tab.isVisible({ timeout: 2000 })) {
                    await tab.click();
                    await page.waitForLoadState('networkidle');
                    return true;
                }
            } catch (e) {
                continue;
            }
        }

        return false;
    }

    /**
     * Verify element exists with multiple selector strategies
     * @param {string[]} selectors - Array of selectors to try
     * @param {string} description - What we're looking for
     */
    async function verifyElementExists(selectors, description) {
        console.log(`🔍 Verifying: ${description}`);

        for (const selector of selectors) {
            try {
                const element = page.locator(selector).first();
                if (await element.isVisible({ timeout: 5000 })) {
                    console.log(`✓ Found: ${description}`);
                    return element;
                }
            } catch (e) {
                continue;
            }
        }

        throw new Error(`Element not found: ${description}`);
    }

    /**
     * Scroll to element with retry
     * @param {string} selector - Element selector
     */
    async function scrollToElement(selector) {
        try {
            const element = page.locator(selector).first();
            await element.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
        } catch (e) {
            console.warn(`⚠️ Could not scroll to: ${selector}`);
        }
    }

    // =========================================
    // TEST CASES - Will be generated dynamically
    // =========================================

    test('TC1: Example test case template', async () => {
        // 1. Navigate to application
        await navigateToApp(userTokens.canopy);

        // 2. Navigate to target page
        await navigateToPage('terms');

        // 3. Click specific tab if needed
        await clickTab('Terms of Service');

        // 4. Verify expected content
        await verifyElementExists(
            ['text=Expected Content', 'h1:has-text("Expected")'],
            'Expected content on page'
        );

        // 5. Additional assertions
        // await expect(page.locator('selector')).toBeVisible();
    });

    // Additional test cases would be generated here...
});

// ============================================
// TEMPLATE METADATA
// ============================================
module.exports = {
    templateVersion: '1.0.0',
    features: [
        'Per-test browser isolation',
        'Dynamic navigation with fallbacks',
        'Reusable helper functions',
        'Error recovery patterns',
        'Multi-selector strategies'
    ]
};
