const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { firstUser } = require('../../test-data/testData').usersForBrowsers.chrome;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const { on } = require('events');
const { normalize } = require('../../utils/general');
const CompareAllPopUp = require('../../pageobjects/compareAllPopUp');




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
   logoutPage,
   oneHomeOwner,
   propertyDetails,
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
      oneHomeOwner = Pomanager.oneHomeOwner();
      propertyDetails = Pomanager.propertyDetails();

   });

   test.afterAll(async () => {

      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();

   });

   const title = 'Manage my Home';
   const titleDescription = 'Stay on top of home value, maintenance, and finances—all in one place. Make smarter decisions and grow your wealth effortlessly.';
   const myHomeModalDialogTitle = 'Claim Your Home to Access OneHomeowner Dashboard';
   test.describe.serial('oneHomeOwner', () => {

      test.beforeAll(async () => {
         await generalFunctions.openOneHome();
         await loginFunctions.openSignInPageAndLogin(firstUser.credentials);
         await page.waitForLoadState('load');
         if (await agentBrandingPage.agentBrandingContainer.isEnabled({ timeout: 5000 })) {

            expect(await agentBrandingPage.continueCTA.textContent()).toEqual(" Continue ");
            await agentBrandingPage.continueCTA.click();

         }
         if (await skipAllComparePopUp.skipAllButton.isEnabled({ timeout: 5000 })) {
            await skipAllComparePopUp.skipAllButton.click();

         }
         await generalFunctions.openRandomProperty();
         await page.waitForTimeout(1500);

      });

      test('OHO | Claim My Home Form - authenticated user - default Values', async () => {

         await page.pause();

         const address = await propertyDetails.oneLineAddress.textContent();
         //console.log(address);
         await oneHomeOwner.claimMyHomeCard.scrollIntoViewIfNeeded();
         // expect(await oneHomeOwner.claimMyHomeCard).toContainText(title);
         // expect(await oneHomeOwner.claimMyHomeCard).toContainText(titleDescription);
         // expect(await oneHomeOwner.claimMyHomeCta.isEnabled()).toBe(true);
         // await oneHomeOwner.claimMyHomeCta.click();

         // expect(await oneHomeOwner.myHomeModalDialog).toBeVisible();
         // expect(await oneHomeOwner.myHomeModalDialog).toContainText(myHomeModalDialogTitle);
         // expect(await oneHomeOwner.myHomeModalDialog).toContainText(titleDescription);
         // expect(await oneHomeOwner.oHwTextLink).toBeEnabled();

         // const [newPage] = await Promise.all([
         //    context.waitForEvent('page'),
         //    oneHomeOwner.oHwTextLink.click(),
         // ]);

         // await newPage.waitForLoadState('load');
         // await expect(newPage).toHaveTitle('OneHomeowner');
         // await newPage.close();
         // await expect(page).toHaveTitle('[U] OneHome™ | Property Listing');
         // expect(await oneHomeOwner.myHomeModalDialog).toBeVisible();
         // await oneHomeOwner.claimButtonEnabled.isEnabled();
         // await oneHomeOwner.claimButtonEnabled.click();
         // //await oneHomeOwner.myHomeModalDialog.waitFor({ state: 'visible', timeout: 5000 });
         // await page.waitForTimeout(2000);
         // await expect(oneHomeOwner.confirmationModalDialog).toBeVisible({ timeout: 3000 });
         // await expect(oneHomeOwner.oHwTextLinkOnConfirmationModalDialog).toBeEnabled();
         // await oneHomeOwner.gotItButtonOnConfirmationModalDialog.click();


      });

      test('OHO | Claim My Home Form - authenticated user - claim OHO for the another user', async () => {
         //await page.pause();
         await oneHomeOwner.claimMyHomeCta.click();
         const address = await propertyDetails.oneLineAddress.textContent();

         await oneHomeOwner.ValidationEmptyFields();              //Validation For Empty Fields Error
         await oneHomeOwner.ValidationWrongEntryFields();        //Validation For Wrong Entry Fields Error
         await oneHomeOwner.validationAddressBox(address);  //validation for something went wrong error for address
         //fill valid data and verify thank you message
         // await oneHomeOwner.firstName.fill(firstNameValue);
         // await oneHomeOwner.lastName.fill(lastNameValue);
         // await oneHomeOwner.emailAddress.fill(address);
         await oneHomeOwner.yourPropertyAddress.fill(address);
         await oneHomeOwner.claimButtonEnabled.isEnabled();
         await oneHomeOwner.claimButtonEnabled.click();
         await oneHomeOwner.myHomeModalDialog.waitFor({ state: 'visible' });
         await expect(oneHomeOwner.confirmationModalDialog).toBeVisible();
         await expect(oneHomeOwner.oHwTextLinkOnConfirmationModalDialog).toBeEnabled();
         await oneHomeOwner.gotItButtonOnConfirmationModalDialog.click();


      });

   });


});











