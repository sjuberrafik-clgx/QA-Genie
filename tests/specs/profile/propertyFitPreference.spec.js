const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { userTokens, usersForInt, agentSwitch } = require('../../test-data/testData');

// Use credentials based on environment - agentSwitch works for UAT (yes06@mailinator.com)
const theCredentials = process.env.USE_UAT === 'true' ? agentSwitch : usersForInt?.firstUser?.credentials;

test.describe.serial('Property Fit Score Display', () => {

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
        await loginFunctions.signInAndWaitForPropertiesGrid(theCredentials);

        // Wait for page to stabilize after login
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(5000);
        
        // Handle welcome popup if displayed using page object
        try {
            await welcomePopUp.container.waitFor({ state: 'visible', timeout: 5000 });
            await welcomePopUp.closeButton.click();
            await page.waitForTimeout(1000);
        } catch (e) {
            // Welcome popup not displayed, continue
        }

        await homePage.userProfile.waitFor({ state: 'visible', timeout: 30000 });
        await homePage.userProfile.click();
        await userProfilePopUp.propertyPreferences.click();
    }, 120000); // Set beforeAll timeout to 120 seconds

    test.afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    test('Property Preferences skipped questions should not be displayed', async () => {
        await userProfilePopUp.changePropertyPreferences.click();
        await expect(userProfilePopUp.propertyPreferenceFirstQuestionTab).toBeVisible();

        const selectedListingTypes = [];
        let selectedCount = 0;

        // Select first 5 options
        for (let i = 0; i < 5; i++) {
            await page.waitForTimeout(1000);
            selectedListingTypes.push(await userProfilePopUp.leftCardText.textContent());
            await userProfilePopUp.leftCheckMark.click();
            selectedCount++;
        }
        await page.waitForTimeout(2000);

        // Skip remaining questions and record skipped types
        const skippedListingTypes = [];
        for (let j = 5; j < 7; j++) {
            skippedListingTypes.push(await userProfilePopUp.leftCardText.textContent());
            skippedListingTypes.push(await userProfilePopUp.rightCardText.textContent());
            await userProfilePopUp.skipOption.click();
            await page.waitForTimeout(1000);
        }
        await userProfilePopUp.doneButton.click();

        // Go back to property preferences
        await homePage.userProfile.click();
        await userProfilePopUp.propertyPreferences.click();

        // Get updated property preferences list
        const preferenceItems = userProfilePopUp.myPropertyPreferencesList;
        const count = await preferenceItems.count();
        const updatedPropertyPreferencesList = [];
        for (let i = 0; i < count; i++) {
            updatedPropertyPreferencesList.push(await preferenceItems.nth(i).textContent());
        }

        // Verify skipped types are not in the updated list
        let skippedNotIncluded = true;
        for (const skippedType of skippedListingTypes) {
            if (updatedPropertyPreferencesList.includes(skippedType)) {
                skippedNotIncluded = false;
                break;
            }
        }
        expect(skippedNotIncluded).toBeTruthy();
    });

    test('Top Features skipped should not be displayed', async () => {
        await userProfilePopUp.changeMyTopFeatures.click();
        await userProfilePopUp.firePlace.click();
        await userProfilePopUp.hardWoodFlooring.click();
        await userProfilePopUp.finishedBasement.click();
        await userProfilePopUp.nextButton.click();

        // Get exterior features list before skipping
        const exteriorItems = userProfilePopUp.exteriorFeaturesList;
        const exteriorCount = await exteriorItems.count();
        const skippedExteriorOptions = [];
        for (let i = 0; i < exteriorCount; i++) {
            skippedExteriorOptions.push(await exteriorItems.nth(i).textContent());
        }

        await userProfilePopUp.skipOptionMyTopFeatures.click();
        await userProfilePopUp.exteriornextButton.click();
        await userProfilePopUp.doneButton.click();

        // Go back to property preferences
        await homePage.userProfile.click();
        await userProfilePopUp.propertyPreferences.click();

        // Click on top features tab (2nd menu button)
        await userProfilePopUp.profileMenuButtons.nth(1).click();

        // Get updated top features list
        const topFeaturesItems = userProfilePopUp.myTopFeaturesList;
        const topFeaturesCount = await topFeaturesItems.count();
        const updatedTopFeaturesList = [];
        for (let i = 0; i < topFeaturesCount; i++) {
            updatedTopFeaturesList.push(await topFeaturesItems.nth(i).textContent());
        }

        // Verify skipped exterior options are not in the updated list
        let skippedNotIncluded = true;
        for (const skippedOption of skippedExteriorOptions) {
            if (updatedTopFeaturesList.includes(skippedOption)) {
                skippedNotIncluded = false;
                break;
            }
        }
        expect(skippedNotIncluded).toBeTruthy();
    });
});
