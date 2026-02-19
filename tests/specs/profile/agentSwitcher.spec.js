const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { userTokens, usersForInt, tenAgents } = require('../../test-data/testData');

// Use tenAgents credentials - account with 5+ agents for agent switching functionality
const theCredentials = process.env.USE_UAT === 'true' ? tenAgents : usersForInt?.firstUser?.credentials;

test.describe.serial('Agent Switcher Functionality', () => {

    let browser;
    let context;
    let page;
    let Pomanager;
    let generalFunctions;
    let loginFunctions;
    let homePage;
    let userProfilePopUp;
    let agentBranding;
    let welcomePopUp;
    let agent1;

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
        agentBranding = Pomanager.agentBranding();
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

        // Open profile and navigate to agent preferences
        await homePage.userProfile.waitFor({ state: 'visible', timeout: 30000 });
        await homePage.userProfile.click();
        await page.waitForTimeout(1000);
        agent1 = await userProfilePopUp.agentName.textContent();
        await userProfilePopUp.viewProfileLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);

        // Click on agent preferences tab (3rd menu button)
        await userProfilePopUp.profileMenuButtons.nth(2).waitFor({ state: 'visible', timeout: 10000 });
        await userProfilePopUp.profileMenuButtons.nth(2).click();
        await page.waitForTimeout(2000);
    }, 120000); // Set beforeAll timeout to 120 seconds

    test.afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    test('verify Agent Preferences header is displayed', async () => {
        await expect(userProfilePopUp.AgentPreferencesHeader).toContainText('Agent Preferences');
    });

    test('verify Agent Preferences text is displayed', async () => {
        await expect(userProfilePopUp.AgentPreferencesText).toContainText(
            'OneHome search results and PropertyFit™ are based on your agent searches and your preferences.'
        );
    });

    test('verify Your Agent heading is displayed', async () => {
        await expect(userProfilePopUp.agentTitle).toContainText('Your Agent');
    });

    test('verify Your Group heading is displayed', async () => {
        await expect(userProfilePopUp.groupsTitle).toContainText('Your Group');
    });

    test('verify current agent name is displayed correctly', async () => {
        await expect(userProfilePopUp.currentAgentName).toHaveText(agent1);
    });

    test('switch agent and cancel should restore previous agent', async () => {
        const beforeName = await userProfilePopUp.currentAgentName.textContent();
        
        await userProfilePopUp.editButton.click();
        await expect(userProfilePopUp.groupContent).not.toBeVisible();
        
        await userProfilePopUp.dropdownButton.click();
        await userProfilePopUp.dropdownList.first().click();
        await userProfilePopUp.cancelButton.click();
        
        const afterName = await userProfilePopUp.currentAgentName.textContent();
        expect(afterName).toEqual(beforeName);
    });

    test('switch to a different agent', async () => {
        // Skip on mobile
        test.skip(process.env.MOBILE === 'true', 'Test skipped on mobile');

        await userProfilePopUp.editButton.click();
        await expect(userProfilePopUp.groupContent).not.toBeVisible();
        
        await userProfilePopUp.dropdownButton.click();
        await userProfilePopUp.dropdownList.first().click();
        await userProfilePopUp.saveButton.click();
        await page.waitForTimeout(2000);
        
        await expect(userProfilePopUp.confirmationPopUp).toContainText('Are you sure you want to switch agent?');
        await userProfilePopUp.confirmationConfirm.click();
        await page.waitForTimeout(2000);
        
        // Handle agent branding continue CTA if displayed
        try {
            await agentBranding.continueCTA.waitFor({ state: 'visible', timeout: 5000 });
            await agentBranding.continueCTA.click();
        } catch (e) {
            // Agent branding not displayed
        }
        
        const agent2 = await userProfilePopUp.currentAgentName.textContent();
        
        // Verify agent name in profile dropdown
        await homePage.userProfile.click();
        await expect(userProfilePopUp.agentName).toHaveText(agent2);
    });
});
