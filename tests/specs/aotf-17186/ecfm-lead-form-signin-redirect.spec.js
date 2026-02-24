/**
 * @ticket AOTF-17186
 * @feature ECFM - Lead Form Sign In Redirect
 * @framework Playwright + JavaScript (CommonJS)
 * @environment UAT
 * @generated 2026-02-24
 * @description Verify Lead Form Sign In redirects to OneHome application instead of Agent Profile page
 * 
 * Selectors validated via MCP live exploration on 2026-02-24
 */

const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { PopupHandler } = require('../../utils/popupHandler');

// Test data - Agent Profile page for Canopy MLS
const AGENT_PROFILE_URL = 'https://aotf-uat.corelogic.com/en-US/profile/3957E9BB';
const TEST_CREDENTIALS = {
    email: 'test5.11@mailinator.com',
    password: 'Qwerty0!'
};

test.describe.serial('Consumer - ECFM Lead Form Sign In Redirect', () => {
    let browser, context, page;
    let poManager, popups;

    test.beforeAll(async () => {
        ({ browser, context, page } = await launchBrowser());
        poManager = new POmanager(page);
        popups = new PopupHandler(page);
    });

    test.afterAll(async () => {
        if (page && !page.isClosed()) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    // ─── Selectors (captured from MCP exploration) ───────────────────────
    const selectors = {
        // Agent Profile Page
        connectSignInButton: 'button:has-text("Connect / Sign In")',
        agentNameHeading: 'h1:has-text("Marie Leduc")',
        
        // Lead Form Page
        signInHereButton: 'button:has-text("Sign in here")',
        leadFormEmailInput: 'input[placeholder="Enter email address"]',
        continueWithEmailButton: 'button:has-text("Continue with Email")',
        closeButton: '[data-test-id="close-button"]',
        
        // Sign In Page
        signInEmailInput: '#user-registration-email',
        signInPasswordInput: '#user-registration-password-unique',
        signInButton: '#signIn-button',
        welcomeHeader: '#notChromelessHeader'
    };

    test('TC1.1: Launch OneHome application and navigate to Agent Profile page', async () => {
        // Navigate to Agent Profile page
        await page.goto(AGENT_PROFILE_URL, { waitUntil: 'networkidle' });
        
        // Verify Agent Profile page is loaded
        await expect(page).toHaveURL(/\/profile\/3957E9BB/);
        
        // Verify Agent name is displayed
        const agentHeading = page.locator(selectors.agentNameHeading);
        await expect(agentHeading).toBeVisible();
    });

    test('TC1.2: Verify Lead Form is displayed after clicking Connect/Sign In button', async () => {
        // Click on "Connect / Sign In" button
        const connectButton = page.locator(selectors.connectSignInButton);
        await expect(connectButton).toBeVisible();
        await connectButton.click();

        // Wait for Lead Form to appear
        await page.waitForLoadState('networkidle');

        // Verify navigation to lead-email-entry page
        await expect(page).toHaveURL(/\/lead-management\/lead-email-entry/);

        // Verify "Sign in here" button is visible in Lead Form
        const signInHereButton = page.locator(selectors.signInHereButton);
        await expect(signInHereButton).toBeVisible();

        // Verify Email input field is visible
        const emailInput = page.locator(selectors.leadFormEmailInput);
        await expect(emailInput).toBeVisible();
    });

    test('TC1.3: Click "Sign in here" link and verify navigation to Sign In page', async () => {
        // Click on "Sign in here" button in Lead Form
        const signInHereButton = page.locator(selectors.signInHereButton);
        await signInHereButton.click();

        // Wait for Sign In page to load
        await page.waitForLoadState('networkidle');

        // Verify navigation to SSO Sign In page
        await expect(page).toHaveURL(/clientsso\.corelogic\.com.*startSSO/);

        // Verify Sign In page elements
        const welcomeHeader = page.locator(selectors.welcomeHeader);
        await expect(welcomeHeader).toContainText('Welcome to OneHome');

        // Verify email input is present
        const emailInput = page.locator(selectors.signInEmailInput);
        await expect(emailInput).toBeVisible();

        // Verify password input is present
        const passwordInput = page.locator(selectors.signInPasswordInput);
        await expect(passwordInput).toBeVisible();
    });

    test('TC1.4: Enter credentials and sign in - Verify redirect to OneHome (BUG: redirects to Agent Profile)', async () => {
        // Enter email
        const emailInput = page.locator(selectors.signInEmailInput);
        await emailInput.fill(TEST_CREDENTIALS.email);

        // Enter password
        const passwordInput = page.locator(selectors.signInPasswordInput);
        await passwordInput.fill(TEST_CREDENTIALS.password);

        // Click Sign In button
        const signInButton = page.locator(selectors.signInButton);
        await expect(signInButton).toBeVisible();
        await signInButton.click();

        // Wait for redirect after authentication
        await page.waitForLoadState('networkidle');
        await page.waitForURL(/aotf-uat\.corelogic\.com/, { timeout: 30000 });

        // Get current URL after redirect
        const currentUrl = page.url();

        // Expected: User should be redirected to OneHome application landing page (/properties/map)
        // Bug: User is redirected back to Agent Profile page instead
        
        // This assertion checks for the EXPECTED behavior (OneHome landing page)
        // If the bug exists, this test will FAIL - which is the correct behavior for a bug verification test
        await expect(page).toHaveURL(/\/properties\/map/, {
            timeout: 10000,
        });

        // Additional verification: Page should show OneHome map view, not Agent Profile
        // If redirected to Agent Profile (bug condition), the URL would contain /profile/
        const isRedirectedToAgentProfile = currentUrl.includes('/profile/');
        
        if (isRedirectedToAgentProfile) {
            // Log bug condition for reporting
            console.log('BUG DETECTED: User redirected to Agent Profile page instead of OneHome application');
            console.log('Actual URL:', currentUrl);
            console.log('Expected URL pattern: /properties/map');
        }

        // Dismiss any popups that may appear after login
        await popups.dismissAll();
    });
});
