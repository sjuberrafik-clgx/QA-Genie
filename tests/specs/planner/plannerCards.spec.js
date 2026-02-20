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




test.describe.serial('RCO - OneHome: Planner Typo', () => {

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

    test('Switching to selling mode and check the typo is updated from look to looking', async () => {


        const plannerPage = new PlannerPage(page);
        // Click on Planner Page
        await homePage.plannerPage.click();
        await plannerPage.sellingModeSwitcher.click();

        // // select sellPropertytab And select the first card
        await plannerPage.sellPropertyTab.click();
        await plannerPage.plannerCards.first().click();

        // // verify the card opened is make repairs and Inp
        await expect(plannerPage.taskCard).toBeVisible();
        await expect(plannerPage.taskCard).toContainText("Make Repairs and Imp");

        // // Verify it has the paragraph
        const paragraph = "Start freshening up your space - whether it's just fixing that loose doorknob or remodeling the whole kitchen. Try looking at your home from an outside perspective and change the things that might prevent you from buying it.";
        expect(await plannerPage.taskCard).toContainText(paragraph);

        // // Get the paragraph present on the card & verify if it has 'looking'
        //  const getParagraphoncard = await plannerPage.paragraphOnCard.textContent();
        //expect(getParagraphoncard.includes("looking")).toBe(true);
        expect(await plannerPage.paragraphOnCard.textContent()).toContain('looking');

    });

});