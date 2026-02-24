/**
 * @ticket AOTF-16461
 * @feature ONMLS - OneHome - Add Roomvo clause in Terms of Use and Privacy Policy
 * @framework Playwright + JavaScript (CommonJS)
 * @environment UAT
 * @generated 2026-02-24
 * Selectors validated via MCP live exploration on 2026-02-24
 */

// 1. Playwright
const { test, expect } = require('@playwright/test');
// 2. Config
const { launchBrowser } = require('../../config/config');
// 3. Page Object Manager
const POmanager = require('../../pageobjects/POmanager');
// 4. Popup Handler (centralized popup dismiss logic)
const { PopupHandler } = require('../../utils/popupHandler');
// 5. Test data
const { userTokens, baseUrl } = require('../../test-data/testData');

const ROOMVO_TERMS_URL_REGEX = /^https?:\/\/get\.roomvo\.com\/terms_of_use\/?/i;
const ROOMVO_PRIVACY_URL_REGEX = /^https?:\/\/get\.roomvo\.com\/privacy_policy\/?/i;

test.describe.serial('AOTF-16461 | Roomvo clause in Terms of Service', () => {
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

  function getOriginFromBaseUrl() {
    // baseUrl includes a trailing '?' in this framework (e.g., .../properties/map?)
    return new URL(baseUrl).origin;
  }

  async function navigateToOneHome(token = userTokens.itso || userTokens.canopy) {
    const url = `${baseUrl}token=${token}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await popups.waitForPageReady();
  }

  async function openTermsOfService(token = userTokens.itso || userTokens.canopy) {
    const origin = getOriginFromBaseUrl();
    const legalTermsUrl = `${origin}/en-US/legal?token=${token}#terms`;

    await page.goto(legalTermsUrl, { waitUntil: 'domcontentloaded' });

    // Ensure the Terms page is loaded
    await expect(page.getByRole('heading', { name: 'OneHome Terms of Service' })).toBeVisible({ timeout: 30000 });
  }

  async function openExternalLinkAndVerify(linkLocator, urlRegex) {
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);

    await linkLocator.scrollIntoViewIfNeeded();
    await linkLocator.click();

    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState('domcontentloaded');
      await expect(popup).toHaveURL(urlRegex);
      await popup.close();
      return;
    }

    // Fallback if link opens in same tab
    await expect(page).toHaveURL(urlRegex);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'OneHome Terms of Service' })).toBeVisible();
  }

  test('Verify Roomvo clause and external links on Terms of Service', async () => {
    // Step 1: Launch OneHome
    await navigateToOneHome();

    // Step 2-3: Open Terms of Service and ensure the page is loaded
    await openTermsOfService();

    // Step 4: Verify Roomvo disclaimer text exists (added under section 14(C) per ticket)
    const roomvoClause = page.getByText(
      /Roomvo\.?\s*Some of the Services may utilize the Roomvo visualizer to reimagine rooms\./i
    );
    await expect(roomvoClause).toBeVisible();

    // Step 5: Verify the disclaimer includes both Roomvo links
    const roomvoTermsLink = page.locator('a[href*="get.roomvo.com/terms_of_use"]').first();
    const roomvoPrivacyLink = page.locator('a[href*="get.roomvo.com/privacy_policy"]').first();

    await expect(roomvoTermsLink).toBeVisible();
    await expect(roomvoPrivacyLink).toBeVisible();

    await expect(roomvoTermsLink).toHaveAttribute('href', /get\.roomvo\.com\/terms_of_use/i);
    await expect(roomvoPrivacyLink).toHaveAttribute('href', /get\.roomvo\.com\/privacy_policy/i);

    // Step 6-7: Open each external link and verify it loads
    await openExternalLinkAndVerify(roomvoTermsLink, ROOMVO_TERMS_URL_REGEX);
    await openExternalLinkAndVerify(roomvoPrivacyLink, ROOMVO_PRIVACY_URL_REGEX);

    // Step 8: Confirm user can continue using Terms page after external navigation
    await expect(page.getByRole('heading', { name: 'OneHome Terms of Service' })).toBeVisible();
  });
});
