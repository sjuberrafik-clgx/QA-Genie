
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { credentials } = require('../../test-data/testData')
const userTokens = require('../../test-data/testData').userTokens;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const _ = require('lodash');


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
    plannerPage,
    favoritesPage,
    favoritesFunctions,
    offLimitsAgentPopUp,
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
        plannerPage = Pomanager.plannerPage();
        offLimitsAgentPopUp = Pomanager.offLimitsAgentPopUp();
        // await page.pause();
        await generalFunctions.openOneHome(userTokens.agentForRegisteredYESMLS);
        await homePage.plannerPage.click();

        // await loginFunctions.signInAndWaitForPropertiesGrid(credentials);
        // await page.waitForTimeout(5000);

    });

    test.afterAll(async () => {

        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();

    });

    test('content should be displayed', async () => {
        await expect(plannerPage.container).toBeVisible();
    });

    test.describe('when Get Started is clicked', () => {
        test.beforeAll(async () => {
            await plannerPage.getStartedButton.click();
        });

        test('planner cards should be displayed', async () => {
            const plannerCards = await plannerPage.plannerCards.elementHandles();
           // console.log('plannerCards.length', plannerCards.length);
            if (plannerCards.length > 0) {
                await Promise.all(
                    plannerCards.map(async (element) => {
                        const isVisible = await element.isVisible();  // Wait for the visibility check
                        expect(isVisible).toBeTruthy();  // Assert that the element is visible (true)
                    })
                );
            } else {
                console.log('No planner cards found.');
            }
        });

        test('when switched to Selling mode, corresponding action tabs should be displayed', async () => {
            await plannerPage.sellingModeSwitcher.click();

            const sellActionTabs = await plannerPage.sellActionTabs.elementHandles();
            const sellActionTabNames = await Promise.all(sellActionTabs.map(async (el) => (await el.textContent() || '').trim()));
            await expect(sellActionTabNames).toEqual(['Get Ready 0/4', 'Sell Property 0/4', 'Close 0/4']);
        });

        test.describe('when some card is clicked', () => {
            test.beforeAll(async () => {
                const plannerCards = await plannerPage.plannerCards.elementHandles();
                await _.sample(plannerCards).click();
            });

            test('task window should be displayed', async () => {
                await expect(plannerPage.container).toBeVisible();
            });

            test.describe('when "Mark as Complete" is clicked', () => {
                test.beforeAll(async () => {
                    await plannerPage.markAsCompleteButton.click();
                });

                test.afterAll(async () => {
                    await offLimitsAgentPopUp.okButton.click();
                });

                test('restricting pop up should appear with corresponding title', async () => {
                    //console.log('offLimitsAgentPopUp.title.textContent()', await offLimitsAgentPopUp.title.textContent());
                    expect(await offLimitsAgentPopUp.title.textContent()).toEqual(`Sorry, that's off limits in Agent Preview mode`);
                });

                test('restricting pop up should appear with corresponding text', async () => {
                    expect(await offLimitsAgentPopUp.text.textContent()).toEqual(`You're viewing the OneHome portal as your client sees it, but you can't make any changes or complete any tasks on their behalf.`);
                });
            });

            test.describe('when "This doesn\'t apply to me" is clicked', () => {
                test.beforeAll(async () => {
                    await plannerPage.thisDoesntApplyToMeButton.click();
                });

                test('restricting pop up should appear with corresponding title', async () => {
                    expect(await offLimitsAgentPopUp.title.textContent()).toEqual(`Sorry, that's off limits in Agent Preview mode`);
                });

                test('restricting pop up should appear with corresponding text', async () => {
                    expect(await offLimitsAgentPopUp.text.textContent()).toEqual(`You're viewing the OneHome portal as your client sees it, but you can't make any changes or complete any tasks on their behalf.`);
                });
            });
        });
   
    });

});










