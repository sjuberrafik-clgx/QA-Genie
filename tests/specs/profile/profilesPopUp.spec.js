const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { userTokens, usersForBrowsers, agentSwitch, agentswitchs } = require('../../test-data/testData');

// Use credentials based on environment
const credentials = process.env.USE_UAT === 'true' ? agentSwitch : usersForBrowsers.chrome.firstUser.credentials;
const firstName = process.env.USE_UAT === 'true' ? agentswitchs.firstName : usersForBrowsers.chrome.firstUser.username.firstName;
const lastName = process.env.USE_UAT === 'true' ? agentswitchs.lastName : usersForBrowsers.chrome.firstUser.username.lastName;

test.describe.serial('User profile popup:', () => {

    let browser;
    let context;
    let page;
    let Pomanager;
    let generalFunctions;
    let loginFunctions;
    let homePage;
    let userProfilePopUp;
    let welcomePopUp;

    test.beforeAll(async () => {
        const launchedBrowser = await launchBrowser();
        browser = launchedBrowser.browser;
        context = launchedBrowser.context;
        page = launchedBrowser.page;

        // Initialize POmanager and get all page objects
        Pomanager = new POmanager(page);
        generalFunctions = Pomanager.generalFunctions();
        loginFunctions = Pomanager.loginFunctions();
        homePage = Pomanager.homePage();
        userProfilePopUp = Pomanager.userProfilePopUp();
        welcomePopUp = Pomanager.welcomePopUp();

        await generalFunctions.openOneHome(userTokens.registered);
        await loginFunctions.signInAndWaitForPropertiesGrid(credentials);
        
        // Wait for page to stabilize and handle any popups
        await page.waitForTimeout(3000);
        
        // Handle welcome popup if displayed using page object
        try {
            if (await welcomePopUp.container.isVisible()) {
                await welcomePopUp.closeButton.click();
                await page.waitForTimeout(1000);
            }
        } catch (e) {
            // Welcome popup not displayed, continue
        }

        await homePage.userProfile.waitFor({ state: 'visible', timeout: 30000 });
        await homePage.userProfile.click();
    }, 120000); // Set beforeAll timeout to 120 seconds

    test.afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    test('user name should correspond to expected one', async () => {
        const userNameText = await userProfilePopUp.userName.textContent();
        expect(userNameText).toEqual(`${firstName} ${lastName}`);
    });

    test('View Profile should be displayed', async () => {
        await expect(userProfilePopUp.viewProfileLink).toBeVisible();
    });

    test('current agent name should be displayed', async () => {
        await expect(userProfilePopUp.agentName).toBeVisible();
    });

    test('group name should be displayed', async () => {
        await expect(userProfilePopUp.currentGroupName).toBeVisible();
    });

    test('PropertyFit Preferences should be displayed', async () => {
        await expect(userProfilePopUp.propertyPreferences).toBeVisible();
    });

    test('Sign Out button should be displayed', async () => {
        await expect(userProfilePopUp.signOutButton).toBeVisible();
    });
});
