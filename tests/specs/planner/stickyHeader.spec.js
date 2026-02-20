const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { credentials } = require('../../test-data/testData')
const userTokens = require('../../test-data/testData').userTokens;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const PlannerPage = require('../../pageobjects/planner');




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

} = ctx;




test.describe.serial('Sticky Header in Planner Page', () => {

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

        await generalFunctions.openOneHome(userTokens.registered);
        await loginFunctions.signInAndWaitForPropertiesGrid(credentials);
        // await page.waitForTimeout(5000);

    });

    test.afterAll(async () => {

        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();

    });

    test('Switching to selling mode and check the sticky header', async () => {

        const plannerPage = new PlannerPage(page);
        await homePage.plannerPage.click();
       // await browser.pause(2000);
        await plannerPage.sellingModeSwitcher.click();
        //await browser.pause(2000);

        // Select any selling mode card
        await plannerPage.sellingmodecard.click();
        const footer = plannerPage.thisDoesntApplyToMeButton;
        //await browser.pause(5000);
        await footer.scrollIntoViewIfNeeded();
       // await browser.pause(2000);

        // Verify the Sticky header present at the top after the scrollDown action.
        await expect(plannerPage.stickyHeader).toBeVisible();
        await expect(plannerPage.taskbar).toBeVisible();


    });

});