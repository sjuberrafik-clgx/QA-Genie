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
    authenticationPopUp,
    detailsCard
} = ctx;

// Use chrome users for notes tests
const users = usersForNotes.chrome;

test.describe.serial('Notes functionality: When adding a note not signed in', () => {

    let browser;
    let context;
    let page;

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
        authenticationPopUp = Pomanager.authenticationPopUp();
        detailsCard = Pomanager.detailsCard();

        // Open OneHome without signing in
        await generalFunctions.openOneHome(users.firstUser.token);
        await generalFunctions.waitForGridIsDisplayed();
        
        // Open a random property from grid
        await propertyDetailsFunctions.openRandomPropertyFromGrid();
        await page.waitForTimeout(2000);
        
        // Click add note link
        await detailsCard.addNoteLink.waitFor({ state: 'visible', timeout: 10000 });
        await detailsCard.addNoteLink.click();
    });

    test.afterAll(async () => {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    test('Sign in request should have expected title', async () => {
        await expect(authenticationPopUp.title).toHaveText("Haven't we seen you before?");
    });

    test('Sign in button should be enabled', async () => {
        await expect(authenticationPopUp.signInButton).toBeEnabled();
    });
});

test.describe.serial('Notes functionality: When adding a note after signed in', () => {

    let browser;
    let context;
    let page;

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
        detailsCard = Pomanager.detailsCard();

        // Open OneHome and sign in
        await generalFunctions.openOneHome(users.firstUser.token);
        await loginFunctions.signInAndWaitForPropertiesGrid(users.firstUser.credentials);
        
        // Open a random property from grid
        await propertyDetailsFunctions.openRandomPropertyFromGrid();
        await page.waitForTimeout(2000);
        
        // Open add note window
        await noteFunctions.openAddNoteWindow();
    });

    test.afterAll(async () => {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    test('address should be displayed', async () => {
        await expect(addNotesWindow.address).toBeVisible();
    });

    test('text field should be displayed', async () => {
        await expect(addNotesWindow.textField).toBeVisible();
    });

    test('Add Note button should be disabled initially', async () => {
        await expect(addNotesWindow.addNoteButton).toBeDisabled();
    });

    test('list of previous notes if any should be displayed', async () => {
        await expect(addNotesWindow.previousNotesContainer).toBeVisible();
    });

    test.describe('after adding note text', () => {
        const currentDateTime = new Date();
        const noteText = `Auto test note ${currentDateTime}`;

        test.beforeAll(async () => {
            await addNotesWindow.textField.fill(noteText);
        });

        test('Add Note button should become enabled', async () => {
            await expect(addNotesWindow.addNoteButton).toBeEnabled();
        });

        test.describe('after reopening the window', () => {
            test.beforeAll(async () => {
                await addNotesWindow.closeButton.click();
                await page.waitForTimeout(2000);
                await noteFunctions.openAddNoteWindow();
            });

            test('note in text area should correspond to the previously entered text', async () => {
                // Re-enter note text after reopening
                await addNotesWindow.textField.fill(noteText);
                const value = await addNotesWindow.textField.inputValue();
                expect(value).toEqual(noteText);
            });

            test('Add Note button should be enabled', async () => {
                await expect(addNotesWindow.addNoteButton).toBeEnabled();
            });

            test.describe('after pressing Add Note button', () => {
                let previousNotesNumber;

                test.beforeAll(async () => {
                    const headerText = await addNotesWindow.header.textContent();
                    const match = headerText.match(/\d+/);
                    previousNotesNumber = match ? parseInt(match[0]) : 0;
                    
                    await addNotesWindow.addNoteButton.click();
                    await page.waitForTimeout(2000);
                });

                test('text in note history should correspond to the entered text', async () => {
                    await expect(addNotesWindow.LatestNoteText).toHaveText(noteText);
                });

                test('username of note creator should appear in notes history', async () => {
                    const expectedUsername = `${users.firstUser.username.firstName} ${users.firstUser.username.lastName}`;
                    await expect(addNotesWindow.username).toHaveText(expectedUsername);
                });

                test('window title with the number of notes should be updated', async () => {
                    const expectedNumberOfNotes = `Notes (${previousNotesNumber + 1})`;
                    await expect(addNotesWindow.header).toHaveText(expectedNumberOfNotes);
                });
            });
        });
    });
});
