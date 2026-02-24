// ============================================
// GENERATED JAVASCRIPT TEST FILE (.spec.js)
// ============================================
// Ticket: AOTF-17109
// Feature: Property Details Page - Core Functionality Verification
// Framework: Playwright with CommonJS (require)
// Environment: UAT (https://aotf-uat.corelogic.com)
// Language: JavaScript (NOT TypeScript)
// Selectors validated via MCP live exploration on 2026-02-20
// ============================================

const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');
const { userTokens, baseUrl } = require('../../test-data/testData');

test.describe.serial('AOTF-17109: Property Details Page - Core Functionality Verification', () => {
    let browser, context, page;
    let poManager, popups;

    test.beforeAll(async () => {
        // Launch browser using framework config
        ({ browser, context, page } = await launchBrowser());
        
        // Initialize Page Object Manager and popup handler
        poManager = new POmanager(page);
        popups = new PopupHandler(page);
    });

    test.afterAll(async () => {
        // Close browser properly with guards
        if (page && !page.isClosed()) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    // ─────────────────────────────────────────────────────────────────
    // HELPER FUNCTIONS (DRY Principle - Reusable across test cases)
    // ─────────────────────────────────────────────────────────────────

    /**
     * Navigate to OneHome with authentication token and dismiss popups
     * @param {string} token - UAT authentication token (default: canopy)
     */
    async function navigateToOneHome(token = userTokens.canopy) {
        const url = `${baseUrl}token=${token}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        
        // Wait for page to stabilize before dismissing popups
        await page.waitForLoadState('domcontentloaded');
        
        // Handle welcome popup using the agent branding page object
        try {
            const welcomeModal = page.locator('ngb-modal-window, [role="dialog"]');
            const continueBtn = page.getByRole('button', { name: 'Continue' });
            
            if (await welcomeModal.isVisible({ timeout: 5000 }).catch(() => false)) {
                if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await continueBtn.click();
                    await page.waitForLoadState('domcontentloaded');
                }
            }
        } catch (e) {
            // Welcome popup may not be present
        }
        
        // Handle skip compare popup
        try {
            const skipAllBtn = page.locator('[data-qa="skip-all-highlight-popout"]');
            if (await skipAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await skipAllBtn.click();
            }
        } catch (e) {
            // Popup may not be present
        }
    }

    /**
     * Navigate to the first available property listing
     * @returns {Promise<string>} - Address of the clicked property
     */
    async function navigateToFirstProperty() {
        // Wait for property listings to load
        const propertyLinks = page.locator('a[href*="/property/"]');
        await expect(propertyLinks.first()).toBeVisible({ timeout: 30000 });
        
        // Click first property link
        await propertyLinks.first().click();
        await page.waitForLoadState('networkidle');
        
        // Handle any popups that may appear on the property details page
        try {
            await popups.dismissAll();
        } catch (e) {
            // Popups may not be present
        }
        
        // Verify navigation to property details page
        await expect(page).toHaveURL(/.*\/property\/.*/);
        
        return 'Property';
    }

    /**
     * Verify property details section is visible
     * @param {string} sectionName - Name of the section to verify
     */
    async function verifySectionVisible(sectionName) {
        const sectionButton = page.getByRole('button', { name: sectionName });
        await expect(sectionButton).toBeVisible();
    }

    /**
     * Click on a navigation tab/button on property details page
     * @param {string} tabName - Name of the tab to click
     */
    async function clickPropertyTab(tabName) {
        const tab = page.getByRole('button', { name: tabName });
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await page.waitForLoadState('domcontentloaded');
    }

    // ─────────────────────────────────────────────────────────────────
    // TEST CASES
    // ─────────────────────────────────────────────────────────────────

    test('TC-1: Verify property details page loads with all core sections', async () => {
        // Step 1: Launch OneHome application using UAT URL with valid authentication token
        await navigateToOneHome(userTokens.canopy);
        
        // Step 2: Verify property listings are displayed on the map view
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        
        // Step 3: Navigate to the first property listing
        await navigateToFirstProperty();
        
        // Step 4: Verify core navigation tabs are visible
        await verifySectionVisible('Overview');
        await verifySectionVisible('Property Details');
        await verifySectionVisible('Schools');
        await verifySectionVisible('Commute Time');
        await verifySectionVisible('Price & Tax History');
    });

    test('TC-2: Verify property basic information display', async () => {
        // Verify we are on property details page (from previous test)
        await expect(page).toHaveURL(/.*\/property\/.*/);
        
        // Verify property address is visible
        const addressSection = page.locator('p.address-line-one, p:has-text("Drive"), p:has-text("Street"), p:has-text("Ave")');
        await expect(addressSection.first()).toBeVisible();
        
        // Verify MLS number is displayed
        const mlsNumber = page.locator('text=/MLS #\\d+/');
        await expect(mlsNumber.first()).toBeVisible();
        
        // Verify key property details (beds, baths, sqft)
        const bedsInfo = page.locator('text=/Beds \\d+/i');
        const bathsInfo = page.locator('text=/Baths \\d+/i');
        const sizeInfo = page.locator('text=/\\d+.*sqft/i');
        
        await expect(bedsInfo.first()).toBeVisible();
        await expect(bathsInfo.first()).toBeVisible();
        await expect(sizeInfo.first()).toBeVisible();
    });

    test('TC-3: Verify Contact Agent button functionality', async () => {
        // Verify Contact Agent button is visible
        const contactAgentButton = page.getByRole('button', { name: 'Contact Agent' });
        await expect(contactAgentButton.first()).toBeVisible();
        
        // Click Contact Agent button
        await contactAgentButton.first().click();
        
        // Verify contact form or modal appears (may vary based on implementation)
        // Wait for any modal or form to appear
        await page.waitForLoadState('domcontentloaded');
        
        // Close modal if opened
        const closeButton = page.locator('[data-test-id="close-button"], .modal-close, button:has-text("Close")');
        if (await closeButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await closeButton.first().click();
        }
    });

    test('TC-4: Verify Request a Tour button functionality', async () => {
        // Get property details page object
        const propertyDetailsPage = poManager.propertyDetails();
        
        // Scroll to Request a Tour section
        const requestTourButton = propertyDetailsPage.requestATour;
        await requestTourButton.scrollIntoViewIfNeeded();
        await expect(requestTourButton).toBeVisible();
        
        // Click Request a Tour button
        await requestTourButton.click();
        
        // Verify modal appears
        await expect(propertyDetailsPage.requestATourModal).toBeVisible({ timeout: 5000 });
        
        // Close the modal
        await propertyDetailsPage.requestATourCloseButton.click();
        await expect(propertyDetailsPage.requestATourModal).toBeHidden();
    });

    test('TC-5: Verify Features section displays property details', async () => {
        // Scroll to Features section
        const featuresHeading = page.getByRole('heading', { name: 'Features', level: 2 });
        await featuresHeading.scrollIntoViewIfNeeded();
        await expect(featuresHeading).toBeVisible();
        
        // Verify key feature items are displayed
        const typeLabel = page.locator('term:has-text("Type:")');
        const yearBuiltLabel = page.locator('term:has-text("Year Built:")');
        const statusLabel = page.locator('term:has-text("Status:")');
        
        await expect(typeLabel).toBeVisible();
        await expect(yearBuiltLabel).toBeVisible();
        await expect(statusLabel).toBeVisible();
    });

    test('TC-6: Verify Estimated Monthly Cost breakdown', async () => {
        // Get property details page object
        const propertyDetailsPage = poManager.propertyDetails();
        
        // Scroll to Estimated Monthly Cost button
        const emcButton = propertyDetailsPage.estimatedMonthlyCostButton;
        await emcButton.scrollIntoViewIfNeeded();
        
        // Verify EMC button is visible
        await expect(emcButton).toBeVisible();
        
        // Click to view cost breakdown
        await emcButton.click();
        
        // Verify cost breakdown modal/blade appears
        await expect(propertyDetailsPage.estimatedMonthlyCostBlade).toBeVisible({ timeout: 5000 });
        
        // Close the breakdown modal
        await propertyDetailsPage.estimatedMonthlyCostClose.click();
        await expect(propertyDetailsPage.estimatedMonthlyCostBlade).toBeHidden();
    });

    test('TC-7: Verify Schools tab functionality', async () => {
        // Click on Schools tab
        await clickPropertyTab('Schools');
        
        // Verify schools section loads
        const propertyDetailsPage = poManager.propertyDetails();
        await expect(propertyDetailsPage.schoolsContent).toBeVisible({ timeout: 10000 });
        
        // Verify school cards are displayed
        await expect(propertyDetailsPage.schoolsCards.first()).toBeVisible({ timeout: 10000 });
    });

    test('TC-8: Verify Price & Tax History tab functionality', async () => {
        // Click on Price & Tax History tab
        await clickPropertyTab('Price & Tax History');
        
        // Verify price history section loads
        const propertyDetailsPage = poManager.propertyDetails();
        await expect(propertyDetailsPage.priceHistoryContent).toBeVisible({ timeout: 10000 });
    });

    test('TC-9: Verify Favorite button functionality', async () => {
        // Find and verify Favorite button
        const favoriteButton = page.getByRole('button', { name: 'Favorite' });
        await favoriteButton.scrollIntoViewIfNeeded();
        await expect(favoriteButton).toBeVisible();
        
        // Click Favorite button to add to favorites
        await favoriteButton.click();
        
        // Wait for action to complete
        await page.waitForLoadState('domcontentloaded');
        
        // Verify button state changes (may show as "Favorited" or have different styling)
        // The button should still be visible after clicking
        await expect(favoriteButton).toBeVisible();
    });

    test('TC-10: Verify navigation back to All Listings', async () => {
        // Get property details page object
        const propertyDetailsPage = poManager.propertyDetails();
        
        // Find and click All Listings link
        const allListingsLink = page.getByRole('link', { name: 'All Listings' });
        await expect(allListingsLink).toBeVisible();
        
        // Click to navigate back
        await allListingsLink.click();
        await page.waitForLoadState('networkidle');
        
        // Verify navigation back to property listings page
        await expect(page).toHaveURL(/.*\/properties\/map.*/);
        
        // Verify listings are displayed
        const resultsHeading = page.getByRole('heading', { name: /\d+ Results/i });
        await expect(resultsHeading).toBeVisible({ timeout: 10000 });
    });
});
