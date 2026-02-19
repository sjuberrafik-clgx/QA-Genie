module.exports = class MarketplaceAbstractPage {
    constructor() {
        if (this.constructor === MarketplaceAbstractPage) {
            throw new Error("Abstract classes can't be instantiated.");
        }
    }

    get addressSearchField() { return $('#text-input-address'); }
    get addressesList() { return $('.typeahead-component__datalist'); }
    get firstAddressInList() { return $$('.typeahead-component__datalist__item')[0]; }
    get submitButton() { return $('button[type="submit"]'); }
    get loader() { return $('[data-qa="loader"]'); }
}
