const baseURL = require('../test-data/testData').baseUrl;
const { expect } = require('@playwright/test');
const agentBranding = require('../pageobjects/agentBranding');
const mapView = require('../pageobjects/map');
const propertiesGrid = require('../pageobjects/propertiresGrid');
const homePage = require('../pageobjects/homePage');



class GeneralFunctions {

  constructor(page) {
    this.page = page;
    this.agentBranding = new agentBranding(page);
    this.mapView = new mapView(page);
    this.propertiesGrid = new propertiesGrid(page);
    this.homePage = new homePage(page);

  }


  async open(token) {

    const fullURL = `${baseURL}token=${token}`;
    await this.page.goto(fullURL);
    // console.log(`Navigated to URL: ${fullURL}`);
    //return this.page.goto(fullURL);


  }

  async openOneHome(token) {

    if (!token) {
      token = await this.getToken();
    }
    await this.open(token);
    await this.page.waitForLoadState('networkidle');

    // Handle agent branding popup if visible
    try {
      if (await this.agentBranding.agentBrandingContainer.isVisible({ timeout: 5000 })) {
        await this.agentBranding.closeCTA.click();
      }
    } catch (e) {
      // Agent branding popup not displayed, continue
    }
    await this.page.waitForLoadState('load');

  }

  async openOneHomeAndClickOnSignInButton(token) {

    if (!token) {
      token = await this.getToken();
    }
    await this.open(token);
    await this.page.waitForLoadState('domcontentloaded');

    // Handle agent branding popup if visible
    try {
      if (await this.agentBranding.agentBrandingContainer.isVisible({ timeout: 5000 })) {
        await this.agentBranding.continueCTA.click();
      }
    } catch (e) {
      // Agent branding popup not displayed, continue
    }
    await this.homePage.signInButton.click();
  }

  async waitForMapIsLoaded() {

    // Wait for loading indicator to disappear (if it appears)
    try {
      await this.mapView.loadingIndicator.waitFor({ state: 'visible', timeout: 5000 });
      await this.mapView.loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 });
    } catch {
      // Indicator never appeared — continue
    }

    // Wait until property pins, clusters, or "no results" tile are visible.
    // NOTE: page.waitForFunction() runs in the browser context where Playwright
    // locators are not available. Use locator-based waits instead.
    try {
      await Promise.race([
        this.mapView.propertyPinList[0].first().waitFor({ state: 'visible', timeout: 30000 }),
        this.mapView.propertiesClusterList[0].first().waitFor({ state: 'visible', timeout: 30000 }),
        this.mapView.noResultsTile.waitFor({ state: 'visible', timeout: 30000 }),
      ]);
    } catch {
      // Timeout — proceed anyway (map might be in an unexpected state)
    }

  }

  async waitForGridIsDisplayed() {

    return await this.propertiesGrid.waitForPropertyIsVisible();

  }


  async getToken() {

    const { canopy } = require('../test-data/testData').userTokens;
    return canopy;
  }

  async openRandomProperty() {
    try {
      // Locate all property elements
      const displayedProperties = await this.propertiesGrid.displayedProperties;
      await displayedProperties.first().waitFor({ state: 'visible', timeout: 10000 });
      const properties = await displayedProperties.elementHandles();
      if (properties.length === 0) {
        console.log('No properties found');
        return;
      }

      // Select a random property
      const randomIndex = Math.floor(Math.random() * properties.length);
      const randomProperty = properties[randomIndex];

      // Click on the selected property
      await randomProperty.click();
    } catch (error) {
      console.log('Could not open a random property:', error);
    }
  }









}

module.exports = GeneralFunctions;