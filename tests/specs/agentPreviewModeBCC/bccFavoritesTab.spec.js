const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { credentials } = require('../../test-data/testData')
const userTokens = require('../../test-data/testData').userTokens;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');






let {
    Pomanager,
    generalFunctions,
    loginFunctions,
    homePage,
    loginPage,
    agentBrandingPage,
    searchFunctions,
    skippAllComparePopUp,
    searchPanel,
    authenticationPopUp,
    logoutPage,
    favoritesPage,
    favoritesFunctions,
} = ctx;




test.describe.serial('Agent Preview Mode(BCC): Favorites tab', () => {

    let browser;
    let context;
    let page;
   
    test.beforeAll(async () => {

        const launchedBrowser = await launchBrowser();
        browser = launchedBrowser.browser;
        context = launchedBrowser.context;
        page = launchedBrowser.page;
        agentBrandingPage = new agentBranding(page);
        Pomanager = new POmanager(page);
        generalFunctions = Pomanager.generalFunctions();
        loginFunctions = Pomanager.loginFunctions();
        loginPage = Pomanager.loginPage();
        homePage = Pomanager.homePage();
        searchFunctions = Pomanager.SearchFunctions();
        skippAllComparePopUp = Pomanager.skipAllComparePopUp();
        searchPanel = Pomanager.searchPanel();
        authenticationPopUp = Pomanager.authenticationPopUp();
        logoutPage = Pomanager.logoutPage();
        favoritesPage = Pomanager.favoritesPage();
        favoritesFunctions = Pomanager.favoritesFunctions();
       // await page.pause();
        await generalFunctions.openOneHome(userTokens.agentForRegisteredYESMLS);
        await favoritesFunctions.openFavorites();
        
        // await loginFunctions.signInAndWaitForPropertiesGrid(credentials);
        // await page.waitForTimeout(5000);

    });

    test.afterAll(async () => {

        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();

    });

   test('content should be displayed', async () => {
        const isVisible = await favoritesPage.propertyContainer.first().isVisible() || await favoritesPage.noResults.isVisible();
        expect(isVisible).toBeTruthy();
    });

    test('agent should be able to open Not for Me sub tab', async () => {
        await favoritesPage.openDislikesTab();
        const isVisible = await favoritesPage.propertyContainer.first().isVisible() || await favoritesPage.noResults.isVisible();
        expect(isVisible).toBeTruthy();
    });

});