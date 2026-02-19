const MarketplaceAbstractPage = require('./marketplaceAbstractPage');

class MortgagePage extends MarketplaceAbstractPage {
    get nextButton() { return $('.next-button button'); }
    get submitButton() { return $('.next-button button'); }
    get backButton() { return $('.back-button button'); }
    get searchAreaInput() { return $('input#text-input-quote-address'); }
    get estimatedPriceInput() { return $('.estimated-price-input input'); }
    get firstNameInput() { return $('.first-name-input input'); }
    get firstNameValidationMessage() { return $('.first-name-input .validation span'); }
    get lastNameInput() { return $('.last-name-input input'); }
    get lastNameValidationMessage() { return $('.last-name-input .validation span'); }
    get addressSearchField() { return $('.current-address-input input'); }
    get addressValidationMessage() { return $('.current-address-input .validation span'); }
    get areasList() { return $('.address-selector__city-selector .typeahead-component__datalist'); }
    get emailInput() { return $('.email-address-input input'); }
    get emailValidationMessage() { return $('.email-address-input .validation span div'); }
    get phoneNumberInput() { return $('.phone-input input'); }
    get phoneValidationMessage() { return $('.phone-input .validation span div'); }
    get dateOfBirthInput() { return $('.dob-input input'); }
    get dateOfBirthValidationMessage() { return $('.dob-input .validation span'); }
    get additionalBankruptcyQuestion() { return $('.card-step-9 h1'); }
    get additionalForeclosureQuestion() { return $('.card-step-10 h1'); }
    get sliderOutput() { return $('.card-step-9 .subheader'); }
    get formHeader() { return $('.card-wrapper>*:nth-child(1)'); }
    get downPaymentInput() { return $('.down-payment-input input'); }
    get percentageInput() { return $('.percentage-input input'); }

    /**
     * @param {string} item
     */
    getItemOption(item) {
        return $(`aotf-radio-button[value=${item}] span.indicator`);
    }

    /**
     * @param {string} item
     */
    getBankruptcyForeclosureOption(item) {
        return $(`.${item} span.indicator`);
    }
}

module.exports = new MortgagePage();
