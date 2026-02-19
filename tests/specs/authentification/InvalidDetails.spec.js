const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { firstUser } = require('../../test-data/testData').usersForBrowsers.chrome;
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
    logoutPage
} = ctx;


test.describe.serial('Login with incorrect password 5 times', () => {

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

        await generalFunctions.openOneHomeAndClickOnSignInButton(userTokens.registeredTestAgent);

    });

    test.afterAll(async () => {

        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();

    });

    const errorMessage = 'That email/password combination doesn\'t match. Please try again.';

    test('Login with valid credentials', async () => {

        await loginFunctions.enterCredentialsClickSignIn({
            email: 'test_agent@mailinator.com',
            password: 'Qwerty#123'
        });

        if (await agentBrandingPage.agentBrandingContainer.isEnabled({ timeout: 5000 })) {

            expect(await agentBrandingPage.continueCTA.textContent()).toEqual(" Continue ");
            await agentBrandingPage.continueCTA.click();

        }
        await skippAllComparePopUp.skipAllComparePopUp();
        expect(await homePage.userProfile.isVisible()).toBe(true);
        await loginFunctions.signOut();
    });

    test('Sign in with incorrect password and cancel ResetPassword', async () => {

        await homePage.signInButton.click();

        let count = 0;
        while (count < 5) {

            await loginFunctions.enterCredentialsClickSignIn({
                email: '123@gmail.com',
                password: 'Benten'
            });
            await page.waitForTimeout(1500);
            if (count < 4) {
                await expect(loginPage.incorrectCredentialsAlert).toHaveText(errorMessage);
            }
            count++;
        }

        await expect(loginPage.AccountLocked).toHaveText('Your account is locked');
        await loginPage.cancelResetPassword.click();
        await loginPage.welcomeSignInPage.waitFor({ state: 'visible', timeout: 5000 });
        await expect(loginPage.welcomeSignInPage).toHaveText('Welcome to OneHome');

    });

    test('Sign in with incorrect password and click on reset Password', async () => {

        await loginFunctions.enterCredentialsClickSignIn({
            email: '123@gmail.com',
            password: 'Benten'
        });

        await expect(loginPage.AccountLocked).toHaveText('Your account is locked');
        await page.waitForTimeout(4000);
        await loginPage.resetPasswordButton.click();
        await expect(loginPage.resetPasswordPage).toContainText('Forgot Your Password?')
    })

});





