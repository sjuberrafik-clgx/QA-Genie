const AddNotesWindow = require('../pageobjects/addNotesWindow');
const DetailsCard = require('../pageobjects/detailsCard');

class NoteFunctions {
    constructor(page) {
        this.page = page;
        this.addNotesWindow = new AddNotesWindow(page);
        this.detailsCard = new DetailsCard(page);
    }

    async waitForNotesLoadIndicator() {
        try {
            const isVisible = await this.addNotesWindow.newNoteLoadIndicator.isVisible({ timeout: 7000 });
            if (isVisible) {
                await this.addNotesWindow.newNoteLoadIndicator.waitFor({ state: 'hidden', timeout: 15000 });
            }
        } catch (error) {
            // Load indicator not found or already hidden
        }
    }

    async openAddNoteWindow() {
        await this.detailsCard.addNoteLink.waitFor({ state: 'visible', timeout: 10000 });
        await this.detailsCard.addNoteLink.click();
        await this.addNotesWindow.container.waitFor({ state: 'visible', timeout: 10000 });
    }

    async addNoteAndWaitTillLoaded() {
        await this.addNotesWindow.addNoteButton.click();
        await this.waitForNotesLoadIndicator();
    }

    async closeNotesWindow() {
        await this.addNotesWindow.closeButton.click();
        await this.page.waitForTimeout(500);
    }

    async enterNoteText(noteText) {
        await this.addNotesWindow.textField.waitFor({ state: 'visible', timeout: 5000 });
        await this.addNotesWindow.textField.fill(noteText);
    }

    async getNoteHeaderCount() {
        const headerText = await this.addNotesWindow.header.textContent();
        const match = headerText.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
    }
}

module.exports = NoteFunctions;
