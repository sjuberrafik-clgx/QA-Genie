class AddNotesWindow {
    constructor(page) {
        this.page = page;
    }

    get header() {
        return this.page.locator("div.sticky-header h1");
    }

    get container() {
        return this.page.locator("div.open-note-blade");
    }

    get address() {
        return this.page.locator("section.add-notes-container address");
    }

    get addressHouseStreet() {
        return this.page.locator("section.add-notes-container address p").first();
    }

    get textField() {
        return this.page.locator(".input-textarea-wrapper textarea");
    }

    get addNoteButton() {
        return this.page.locator('[data-qa="blade-add-note-button"] button');
    }

    get newNoteLoadIndicator() {
        return this.page.locator('div[aria-label="Loading"]');
    }

    get previousNotesContainer() {
        return this.page.locator("section.property-notes-container");
    }

    get noPreviousNotes() {
        return this.page.locator("section.property-notes-container .no-notes");
    }

    get propertyNoteList() {
        return this.page.locator("aotf-property-note .property-note");
    }

    get closeButton() {
        return this.page.locator("aotf-close-button.modal-close button");
    }

    get username() {
        return this.page.locator(
            ".property-notes-container div:last-of-type > aotf-property-note div.user-name"
        );
    }

    get noteDate() {
        return this.page.locator(
            ".property-notes-container div:last-of-type > aotf-property-note div.submission-date"
        );
    }

    get LatestNoteDate() {
        return this.page.locator(
            ".property-notes-container div:first-of-type > aotf-property-note div.submission-date"
        );
    }

    get previousNoteText() {
        return this.page.locator(
            ".property-notes-container div:last-of-type > aotf-property-note div.note-content"
        );
    }

    get LatestNoteText() {
        return this.page.locator(
            ".property-notes-container div:first-of-type > aotf-property-note div.note-content"
        );
    }

    get addNoteButton2() {
        return this.page.locator('[data-qa="add-note-button"] button');
    }

    get agentBrandingAddNoteButton() {
        return this.page.locator(".agent-branding .card-body .button");
    }
}

module.exports = AddNotesWindow;
