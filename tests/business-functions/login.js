
const loginPage = require('../pageobjects/loginPage');
const welcomePopUp = require('../pageobjects/welcomePopUp');
const compareAllPopUp = require('../pageobjects/compareAllPopUp');
const agentBranding = require('../pageobjects/agentBranding');
const homePage = require('../pageobjects/homePage');
const generalFunctions = require('../business-functions/general');
const logoutPage = require('../pageobjects/logoutPage');
const userProfilePopUp = require('../pageobjects/userProfilePopUp');
const activateAccount = require('../pageobjects/activateAccount');
// const { expect } = require('allure-playwright');
const { stat } = require('fs');
const { test, expect } = require('@playwright/test');



class LoginFunctions {

    constructor(page) {

        this.page = page;
        this.loginPage = new loginPage(page);
        this.welcomePopUp = new welcomePopUp(page);
        this.compareAllPopUp = new compareAllPopUp(page);
        this.agentBranding = new agentBranding(page);
        this.homePage = new homePage(page);
        this.generalFunctions = new generalFunctions(page);
        this.logoutPage = new logoutPage(page);
        this.userProfilePopUp = new userProfilePopUp(page);
        this.activateAccount = new activateAccount(page);





    }
    async signInAndWaitForPropertiesGrid(credentials) {

        if (!credentials) {
            credentials = await this.getCredentials();
        }

        await this.openSignInPageAndLogin(credentials);
        await this.page.waitForLoadState('domcontentloaded');
        await this.compareAllPopUp.skipAllComparePopUp();
        return await this.generalFunctions.waitForGridIsDisplayed();
    }

    async signInAndWaitForMapIsLoaded(credentials) {

        if (!credentials) {
            credentials = await this.getCredentials();
        }
        await this.openSignInPageAndLogin(credentials);
        await this.page.waitForLoadState('load');
        await this.page.waitForLoadState('networkidle');
        await this.compareAllPopUp.skipAllComparePopUp();
        return await this.generalFunctions.waitForMapIsLoaded();


    }

    async openSignInPageAndLogin(credentials) {
        if (!credentials) {
            credentials = await this.getCredentials();
        }

        await this.homePage.signInButton.click();
        await this.signIn(credentials);
    }

    async signIn(credentials) {
        if (!credentials) {
            credentials = await this.getCredentials();
        }
        await this.enterCredentialsClickSignIn(credentials);
    }

    async enterCredentialsClickSignIn(credentials) {

        await this.loginPage.emailInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.loginPage.emailInput.fill(credentials.email);
        await this.loginPage.passwordInput.fill(credentials.password);
        await this.loginPage.signInButton.click();
        await this.page.waitForLoadState('load');
        await this.page.waitForLoadState('networkidle');

        // Handle agent branding popup if displayed
        try {
            await this.agentBranding.continueCTA.waitFor({ state: 'visible', timeout: 5000 });
            await this.agentBranding.continueCTA.click();
        } catch (e) {
            // Agent branding not displayed, continue
        }

        // Handle welcome popup if displayed
        try {
            await this.welcomePopUp.container.waitFor({ state: 'visible', timeout: 5000 });
            await this.welcomePopUp.closeButton.click();
        } catch (e) {
            // Welcome popup not displayed, continue
        }
    }


    async signOut() {
        await this.page.waitForLoadState('networkidle');
        await this.homePage.userProfile.waitFor({ state: 'visible', timeout: 10000 });
        await this.homePage.userProfile.click({ force: true });
        await this.userProfilePopUp.signOutButton.click();
        await this.page.waitForLoadState('load');
        await expect(this.logoutPage.signInButton).toBeVisible();

    }

    async sendValue(Password) {
        await this.activateAccount.enterPassword.fill(Password);
    }

    async getCredentials() {

        const { canopy } = require('../test-data/testData').userCredentials;
        return canopy;
    }

}

module.exports = LoginFunctions;
