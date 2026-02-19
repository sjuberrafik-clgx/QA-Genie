class ProfilePage {
    constructor(page) {
        this.page = page;
    }

    get editButton() { return this.page.locator('[data-qa="edit-button"]'); }
    get editButton2() { return this.page.locator('span:text("Edit")'); }
    get firstNameInput() { return this.page.locator('[data-qa="input-first-name"] input'); }
    get lastNameInput() { return this.page.locator('[data-qa="input-last-name"] input'); }
    get phoneNumberInput() { return this.page.locator('[data-qa="input-phone"] input'); }
    get phoneTypeDropDown() { return this.page.locator('[label="Phone type"] select'); }
    get residentialAddressInput() { return this.page.locator('[data-qa="input-addressline1"] input'); }
    get aptSuiteInput() { return this.page.locator('[data-qa="input-addressline2"] input'); }
    get cityInput() { return this.page.locator('[data-qa="input-city"] input'); }
    get stateDropDown() { return this.page.locator('[label="State"] select'); }
    get zipInput() { return this.page.locator('[data-qa="input-zip"] input'); }
    get clearAddressButton() { return this.page.locator('[label="Clear search"] button'); }
    get saveButton() { return this.page.locator('[data-qa="save-button"] button'); }
    get cancelButton() { return this.page.locator('[data-qa="cancel-button"] button'); }

    get invalidFirstNameError() { return this.page.locator('span[data-qa="invalid-firstname-error"]'); }
    get invalidLastNameError() { return this.page.locator('span[data-qa="invalid-lastname-error"]'); }
    get firstNameMaxLenError() { return this.page.locator('span[data-qa="firstname-maxlength-error"]'); }
    get lastNameMaxLenError() { return this.page.locator('span[data-qa="lastname-maxlength-error"]'); }

    get autocompleteAddressOptions() { return this.page.locator('ul.dropdown-menu.show'); }
    get firstAddressFieldDropDownOption() { return this.page.locator('aotf-address-autocomplete .dropdown-menu button').first(); }
    get confirmationOfSavingPopUp() { return this.page.locator('aotf-toast .header'); }
    get addressLoadIndicator() { return this.page.locator('[data-qa="input-addressline1"] [aria-label="Loading"]'); }

    async selectPhoneType(phoneType) {
        await this.phoneTypeDropDown.selectOption({ label: phoneType });
    }

    async selectState(state) {
        await this.stateDropDown.selectOption({ label: state });
    }
}

module.exports = ProfilePage;
