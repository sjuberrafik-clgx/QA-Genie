const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://aotf-uat.corelogic.com/en-US';
const TOKEN = 'eyJPU04iOiJDQU5PUFlfQU9URl9VQVQiLCJjb250YWN0aWQiOiI0MDI2NjIyIiwiZW1haWwiOiJzanViZXJyYWZpayt1YXRAY290YWxpdHkuY29tIiwiYWdlbnRpZCI6IjExMDcyMCJ9';
const DEFAULT_ID = '5f69424c-3753-39d0-8d86-e1b812610e62';

test.describe('AOTF UAT - Major Functionality Tests', () => {
  
  test('TC001 - Page Load and Welcome Dialog', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Verify page loads successfully
    await expect(page).toHaveTitle(/OneHome/);
    
    // Check for welcome dialog
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeVisible({ timeout: 10000 });
    
    // Close welcome dialog
    await continueButton.click();
    await page.waitForTimeout(2000);
  });

  test('TC002 - Navigation Menu Visibility', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss welcome dialog if present
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Verify main navigation elements
    await expect(page.getByRole('button', { name: 'Buy / Rent' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Properties' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Marketplace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  });

  test('TC003 - Property Search Filters', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Verify search filter buttons are present
    await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home Types (3)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Any Price' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Beds & Baths' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
    
    console.log('✓ All search filters are visible');
  });

  test('TC004 - Home Types Filter Interaction', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Click Home Types filter
    const homeTypesBtn = page.getByRole('button', { name: 'Home Types (3)' });
    await homeTypesBtn.click();
    await page.waitForTimeout(1000);
    
    // Verify filter panel opens (look for Apply button)
    const applyButtons = page.getByRole('button', { name: 'Apply' });
    await expect(applyButtons.first()).toBeVisible();
    
    console.log('✓ Home Types filter opens successfully');
  });

  test('TC005 - Price Filter Interaction', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Click Price filter
    const priceBtn = page.getByRole('button', { name: 'Any Price' });
    await priceBtn.click();
    await page.waitForTimeout(1000);
    
    // Verify price filter panel opens
    const applyButtons = page.getByRole('button', { name: 'Apply' });
    await expect(applyButtons.first()).toBeVisible();
    
    console.log('✓ Price filter opens successfully');
  });

  test('TC006 - Beds and Baths Filter', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Click Beds & Baths filter
    const bedsBtn = page.getByRole('button', { name: 'Beds & Baths' });
    await bedsBtn.click();
    await page.waitForTimeout(1000);
    
    // Verify filter panel opens
    const applyButtons = page.getByRole('button', { name: 'Apply' });
    await expect(applyButtons.first()).toBeVisible();
    
    console.log('✓ Beds & Baths filter opens successfully');
  });

  test('TC007 - Save Search Functionality', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Verify Save Search button is visible
    const saveSearchBtn = page.getByRole('button', { name: 'Save Search' });
    await expect(saveSearchBtn).toBeVisible();
    
    console.log('✓ Save Search button is accessible');
  });

  test('TC008 - Clear Filters Functionality', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Verify Clear filters button
    const clearBtn = page.getByRole('button', { name: 'Clear filters' });
    await expect(clearBtn).toBeVisible();
    
    console.log('✓ Clear filters button is accessible');
  });

  test('TC009 - My Properties Navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
    
    // Click My Properties link
    const myPropsLink = page.getByRole('link', { name: 'My Properties' });
    await expect(myPropsLink).toBeVisible();
    
    await myPropsLink.click();
    await page.waitForTimeout(3000);
    
    // Verify navigation occurred
    expect(page.url()).toContain('/favorites');
    
    console.log('✓ My Properties navigation works');
  });

  test('TC010 - Map View Loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/properties/map?searchId=new-search&token=${TOKEN}&defaultId=${DEFAULT_ID}`);
    
    // Dismiss dialog
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    }
    
    // Verify URL contains map view
    expect(page.url()).toContain('/properties/map');
    
    // Take screenshot of map view
    await page.screenshot({ path: 'tests/screenshots/map-view.png', fullPage: true });
    
    console.log('✓ Map view loads successfully');
  });

});
