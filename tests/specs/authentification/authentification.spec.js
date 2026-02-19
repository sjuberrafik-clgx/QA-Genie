const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { firstUser } = require('../../test-data/testData').usersForBrowsers.chrome;
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
   skipAllComparePopUp,
   searchPanel,
   authenticationPopUp,
   logoutPage
} = ctx;


test.describe.serial('Authentication functionality:', () => {

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
      skipAllComparePopUp = Pomanager.skipAllComparePopUp();
      searchPanel = Pomanager.searchPanel();
      authenticationPopUp = Pomanager.authenticationPopUp();
      logoutPage = Pomanager.logoutPage();

   });

   test.afterAll(async () => {

      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();

   });

   const errorMessage = 'That email/password combination doesn\'t match. Please try again.';

   test.describe('when logging in via Sign In page', async () => {

      test.beforeAll(async () => {
         await generalFunctions.openOneHomeAndClickOnSignInButton();
      });

      test.afterAll(async () => {
         await loginFunctions.signOut();
      });

      test('with invalid email should result in error message', async () => {

         await loginFunctions.enterCredentialsClickSignIn({
            email: 'test_agent@mail.com',
            password: 'Qwerty#123'
         });

         await expect(loginPage.incorrectCredentialsAlert).toHaveText(errorMessage);

      });

      test('with valid credentials should result in displayed profile icon', async () => {

         await loginFunctions.signIn(firstUser.credentials);
         await page.waitForTimeout(3000);
         if (await agentBrandingPage.agentBrandingContainer.isVisible({ timeout: 5000 })) {
            expect(await agentBrandingPage.continueCTA.textContent()).toEqual(" Continue ");
            await agentBrandingPage.continueCTA.click();
         }
         await page.waitForTimeout(1000);
         if (await skipAllComparePopUp.skipAllButton.isVisible({ timeout: 5000 })) {
            await skipAllComparePopUp.skipAllButton.click();
         }
         await expect(homePage.userProfile).toBeVisible();


      });

   });

   test.describe('when logging in via authentication popup when saving search', async () => {

      test.beforeAll(async () => {

         await searchFunctions.openSearchViaDropDown();
         await searchPanel.saveSearchButton.click();
         await authenticationPopUp.signInButton2.waitFor({ state: 'visible', timeout: 5000 });
         await authenticationPopUp.signInButton2.click();

      });

      test.afterAll(async () => {
         await loginFunctions.signOut();
      });

      test('with invalid password should result in error message', async () => {

         await loginFunctions.enterCredentialsClickSignIn({
            email: 'test_agent@mail.com',
            password: 'Qwerty#123'
         });
         await expect(loginPage.incorrectCredentialsAlert).toHaveText(errorMessage);

      });

      test('with valid credentials should result in displayed profile icon', async () => {

         await loginFunctions.signIn(firstUser.credentials);
         await page.waitForLoadState('load');
         await page.waitForTimeout(3000);
         await expect(homePage.userProfile).toBeVisible();;

      });

   });

   test.describe('when Sign out', () => {

      test.beforeAll(async () => {

         await loginFunctions.openSignInPageAndLogin(firstUser.credentials);
         await page.waitForTimeout(3000);
         // await page.waitForLoadState('load');
         await loginFunctions.signOut();
      });

      test('relevant message should be displayed', async () => {
         await expect(logoutPage.headerMessage).toHaveText("Let's Do This Again Sometime");
      });

      test('image should be displayed', async () => {
         await expect(logoutPage.picture).toBeVisible();
      });

      test('Sign in button should be clickable', async () => {
         await expect(logoutPage.signInButton).toBeVisible();
         await expect(logoutPage.signInButton).toBeEnabled();
      });
   });

});





