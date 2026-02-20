
const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { credentials } = require('../../test-data/testData')
const userTokens = require('../../test-data/testData').userTokens;
const agentBranding = require('../../pageobjects/agentBranding');
const ctx = require('../../utils/testContext');
const _ = require('lodash');
const MarketPlaceDropDownItems  = require('../../enums/marketplace').MarketplaceMenuItems;


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


test.describe.serial('Agent Preview Mode(BCC) restricts:', () => {

    let property;
    let propertyId;

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
        offLimitsAgentPopUp = Pomanager.offLimitsAgentPopUp();
       
        await generalFunctions.openOneHome(userTokens.agentForRegisteredYESMLS);
      

    });

    //Run only for UAT cause INT sites with market place module is not found
    if (process.env.USE_UAT === 'true') {

        test.describe('when opening Marketplace', () => {
            test.beforeAll(async () => {

                await homePage.marketplaceDropDown.click();
                await homePage.getMarketplaceDropDownItem(MarketPlaceDropDownItems.marketplace).click();
                
            });

            test.afterAll(async () => {
                await offLimitsAgentPopUp.okButton.click();
            });

            test('restricting pop up should appear with corresponding title', async () => {
          
    
                //await page.waitForTimeout(2000); 
                expect(await offLimitsAgentPopUp.titleWithH1.textContent()).toEqual('Sorry, this page is off limits in Agent Preview mode');
            });

            test('restricting pop up should appear with corresponding text', async () => {
                expect(await offLimitsAgentPopUp.text.textContent()).toEqual('You\'re currently viewing the OneHome portal ' +
                    'as your client sees it. Some pages aren\'t available to view in this mode.');
            });
        });
    }

    // test.describe('when favoriting some property', () => {
    //     before(async () => {
    //         await property.favouriteIcon.click();
    //     });

    //     test.describe('restricting pop up', () => {
    //         after(async () => {
    //             await offLimitsAgentPopUp.okButton.click();
    //         });

    //         test('should appear with corresponding title', async () => {
    //             expect(await offLimitsAgentPopUp.title.textContent()).toEqual('Sorry, that\'s off limits in Agent Preview mode');
    //         });

    //         test('should have corresponding text', async () => {
    //             expect(await offLimitsAgentPopUp.text.textContent()).toEqual('You\'re viewing the OneHome portal as your client sees it, ' +
    //                 'but you can\'t make any changes or complete any tasks on their behalf.');
    //         });
    //     });

    //     // test.describe('on Favorited tab', () => {
    //     //     afterAll(async () => {
    //     //         await homePage.logo.click();
    //     //     });

    //     //     test('the property should be absent', async () => {
    //     //         await favoritesFunctions.openFavorites();
    //     //         if (await favoritesPage.getPropertiesAmount() !== 0) {
    //     //             const propertiesIds = await Promise.all(favoritesPage.displayedProperties
    //     //                 .map(async (element) => (await favoritesPage.getProperty(element)).id.textContent()));
    //     //             expect(propertiesIds).not.toContain(propertyId);
    //     //         } else {
    //     //             expect(await favoritesPage.propertyContainer.isVisible()).toBeFalsy();
    //     //         }
    //     //     });
    //     // });
    // });

    // describe.skip('when disliking some property', () => {
    //     before(async () => {
    //         await property.dislikeIcon.waitForClickableAndClick();
    //     });

    //     describe('restricting pop up', () => {
    //         after(async () => {
    //             await offLimitsAgentPopUp.okButton.waitForClickableAndClick();
    //         });

    //         it('should appear with corresponding title', async () => {
    //             expect(await offLimitsAgentPopUp.title.getText()).toEqual('Sorry, that\'s off limits in Agent Preview mode');
    //         });

    //         it('should have corresponding text', async () => {
    //             expect(await offLimitsAgentPopUp.text.getText()).toEqual('You\'re viewing the OneHome portal as your client sees it, ' +
    //                 'but you can\'t make any changes or complete any tasks on their behalf.');
    //         });
    //     });

    //     describe('on Not for Me sub tab', () => {
    //         after(async () => {
    //             await homePage.logo.waitForClickableAndClick();
    //             await generalFunctions.waitForGridIsDisplayed();
    //         });

    //         it('the property should be absent', async () => {
    //             await favoritesFunctions.openFavorites();
    //             await favoritesPage.openDislikesTab();
    //             if (await favoritesPage.getPropertiesAmount() !== 0) {
    //                 const propertiesIds = await favoritesPage.displayedProperties
    //                     .map(async (element) => (await favoritesPage.getProperty(element)).id.waitForDisplayedAndGetText());
    //                 expect(propertiesIds).not.toContain(propertyId);
    //             } else {
    //                 expect(await favoritesPage.propertyContainer.isDisplayed()).toBeFalsy();
    //             }
    //         });
    //     });
    // });

    // TODO unskip when AOTF-6214 will be fixed

    test.describe('when saving search', () => {
        test.beforeAll(async () => {
            // TODO Once AOTF-5604 is fixed apply BF openSearchViaDropDown for mobile

            await searchFunctions.openSearchViaDropDown();
            await searchPanel.saveSearchButton.click();
        });

        test.afterAll(async () => {
            await offLimitsAgentPopUp.okButton.click();
        });

        test('restricting pop up should appear with corresponding title', async () => {
            expect(await offLimitsAgentPopUp.title.textContent()).toEqual('Sorry, that\'s off limits in Agent Preview mode');
        });

        test('restricting pop up should appear with corresponding text', async () => {
            expect(await offLimitsAgentPopUp.text.textContent()).toEqual('You\'re viewing the OneHome portal as your client sees it, ' +
                'but you can\'t make any changes or complete any tasks on their behalf.');
        });
    });
});
