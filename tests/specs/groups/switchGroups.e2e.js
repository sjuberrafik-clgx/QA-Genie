const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { credentials } = require('../../test-data/testData')
const userTokens = require('../../test-data/testData').userTokens;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const { describe } = require('node:test');





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




test.describe.serial('Groups functionality: Switching Groups', () => {

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

    describe('Switch Group window', () => {

        test.beforeAll(async () => {
        });
        test.afterAll(async () => {
        });

        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });
        test('', async () => {
        });


    });
    describe('Switch Group window', () => {

        test.beforeAll(async () => {
        });

        test('', async () => {

        });
        test('', async () => {


        });
    });

    });