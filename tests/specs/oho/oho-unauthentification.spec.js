const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { firstUser } = require('../../test-data/testData').usersForBrowsers.chrome;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const { on } = require('events');
const { normalize } = require('../../utils/general');




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
   test.describe('oneHomeOwner', () => {

      test.beforeAll(async () => {
         await generalFunctions.openOneHome()
         await generalFunctions.openRandomProperty();
         await page.waitForTimeout(1500);

      });

      test('OHO | Claim My Home Form - unauthenticated user', async () => {

         const address = await propertyDetails.oneLineAddress.textContent();
         //console.log(address);
         await oneHomeOwner.claimMyHomeCard.scrollIntoViewIfNeeded();
         expect(await oneHomeOwner.claimMyHomeCard).toContainText(title);
         expect(await oneHomeOwner.claimMyHomeCard).toContainText(titleDescription);
         expect(await oneHomeOwner.claimMyHomeCta.isEnabled()).toBe(true);
         await oneHomeOwner.claimMyHomeCta.click();

         expect(await oneHomeOwner.myHomeModalDialog).toBeVisible();
         expect(await oneHomeOwner.myHomeModalDialog).toContainText(myHomeModalDialogTitle);
         expect(await oneHomeOwner.myHomeModalDialog).toContainText(titleDescription);
         expect(await oneHomeOwner.oHwTextLink).toBeEnabled();

         const [newPage] = await Promise.all([
            context.waitForEvent('page'),
            oneHomeOwner.oHwTextLink.click(),
         ]);
         await newPage.waitForLoadState('load');
         await expect(newPage).toHaveTitle('OneHomeowner');
         await newPage.close();
         await expect(page).toHaveTitle('[U] OneHome™ | Property Listing');

         expect(await oneHomeOwner.myHomeModalDialog).toBeVisible();
         const addressValue = await oneHomeOwner.yourPropertyAddress.inputValue(); 
         await oneHomeOwner.ValidationEmptyFields();
         //Validation For Wrong Entry Fields Error
         await oneHomeOwner.ValidationWrongEntryFields();
         //validation for something went wrong error for address
         await oneHomeOwner.validationAddressBox(addressValue);
         //fill valid data and verify thank you message
         await oneHomeOwner.yourPropertyAddress.fill(addressValue);
         await oneHomeOwner.claimButtonEnabled.isEnabled();
         await oneHomeOwner.claimButtonEnabled.click();
         expect(await oneHomeOwner.confirmationModalDialog).toBeVisible();
         expect(await oneHomeOwner.oHwTextLinkOnConfirmationModalDialog).toBeEnabled();
         await oneHomeOwner.gotItButtonOnConfirmationModalDialog.click();

      });

   });


});











