const { test, expect } = require('@playwright/test');
const { launchBrowser } = require('../../config/config');
const POmanager = require('../../pageobjects/POmanager');
const { usersForNotes } = require('../../test-data/testData');
const ctx = require('../../utils/testContext');

let {
    Pomanager,
    generalFunctions,
    loginFunctions,
    homePage,
    propertyDetailsFunctions,
    noteFunctions,
    addNotesWindow,
    notificationsMenuDropDown
} = ctx;

// Use chrome users for notes tests
const users = usersForNotes.chrome;

test.describe.serial('Notes: When receiving note for another user in group', () => {

    let browser;
    let context;
    let page;
    const noteText = `Auto test note ${new Date()}`;
    let propertyAddress;

    test.beforeAll(async () => {
        const launchedBrowser = await launchBrowser();
        browser = launchedBrowser.browser;
        context = launchedBrowser.context;
        page = launchedBrowser.page;

        Pomanager = new POmanager(page);
        generalFunctions = Pomanager.generalFunctions();
        loginFunctions = Pomanager.loginFunctions();
        homePage = Pomanager.homePage();
        propertyDetailsFunctions = Pomanager.propertyDetailsFunctions();
        noteFunctions = Pomanager.noteFunctions();
        addNotesWindow = Pomanager.addNotesWindow();
        notificationsMenuDropDown = Pomanager.notificationsMenuDropDown();

        // First user adds a note
        await generalFunctions.openOneHome(users.firstUser.token);
        await loginFunctions.signInAndWaitForPropertiesGrid(users.firstUser.credentials);

        // Open a random property
        await propertyDetailsFunctions.openRandomPropertyFromGrid();
        await page.waitForTimeout(2000);

        // Get property address
        propertyAddress = await propertyDetailsFunctions.getPropertyAddressLine1();

        // Open notes and add a note
        await noteFunctions.openAddNoteWindow();
        await addNotesWindow.textField.fill(noteText);
        await addNotesWindow.closeButton.click();
        
        // Sign out first user
        await loginFunctions.signOut();

        // Wait for backend processing
        await page.waitForTimeout(2000);

        // Navigate to new page and login as second user
        await page.goto('https://www.google.com');
        await generalFunctions.openOneHome(users.secondUser.token);
        await loginFunctions.openSignInPageAndLogin(users.secondUser.credentials);
        await page.waitForTimeout(3000);

        // Click notifications button
        await homePage.notificationsButton.waitFor({ state: 'visible', timeout: 10000 });
        await homePage.notificationsButton.click();
    });

    test.afterAll(async () => {
        // Read notification if left unread
        try {
            const hasUnread = await homePage.unreadNotifications.isVisible();
            if (hasUnread) {
                await homePage.notificationsButton.click();
                await homePage.notificationsButton.click();
            }
        } catch (e) {
            // Ignore errors during cleanup
        }

        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    test('notification title should be displayed', async () => {
        await expect(notificationsMenuDropDown.title).toBeVisible();
    });

    test('notification message should correspond to note text', async () => {
        const notificationNoteText = noteText.slice(0, 41) + '...';
        await expect(notificationsMenuDropDown.lastNotificationMessage).toHaveText(notificationNoteText);
    });

    test('View Comments button should be displayed on notifications menu', async () => {
        await expect(notificationsMenuDropDown.viewComments).toBeVisible();
    });

    test.describe('after clicking on View Comments', () => {
        test.beforeAll(async () => {
            await notificationsMenuDropDown.viewComments.click();
            await noteFunctions.waitForNotesLoadIndicator();
        });

        test.afterAll(async () => {
            try {
                await addNotesWindow.closeButton.click();
            } catch (e) {
                // Ignore if close button not available
            }
        });

        test('this note should be displayed on property details page at Notes window', async () => {
            await expect(addNotesWindow.previousNoteText).toHaveText(noteText);
        });

        test('property address should correspond to expected one', async () => {
            await expect(addNotesWindow.addressHouseStreet).toHaveText(propertyAddress);
        });
    });
});
