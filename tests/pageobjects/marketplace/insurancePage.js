const MarketplaceAbstractPage = require('./marketplaceAbstractPage');

class InsurancePage extends MarketplaceAbstractPage {
    get container() { return $('section.route-insurance'); }
    get addressInput() { return $('#text-input-address'); }
    get closeInsuranceWindow() { return $('[icon="close"]>*'); }
    get firstNameInput() { return $('.insurance-questionnaire__first-name input'); }
    get lastNameInput() { return $('.insurance-questionnaire__last-name input'); }
    get emailInput() { return $('.insurance-questionnaire__email input'); }
    get phoneNumberInput() { return $('.insurance-questionnaire__phone input'); }
    get firstNameValidationMessage() { return $('.insurance-questionnaire__first-name .validation span'); }
    get lastNameValidationMessage() { return $('.insurance-questionnaire__last-name .validation span'); }
    get emailValidationMessage() { return $('.insurance-questionnaire__email .validation div'); }
    get phoneValidationMessage() { return $('.insurance-questionnaire__phone .validation div'); }
    get addressValidationMessage() { return $('.typeahead-input__input .validation span'); }
    get LetsStartbutton() { return $('div.lets-start_button span.button-label'); }
    get insuranceflowpage() { return $('aotf-insurance-form'); }
    get FormContent() { return $('div.form-content'); }
    get FormHeader() { return $('h2.form-header'); }
    get nextbutton() { return $('[class="next-button"]'); }
    get FormFill() { return $('input#text-input-address') }
    get GetInsurance() { return $('[class ="verticals brokerlinx-border"] [data-qa ="insurance-rates-button"]'); }
    get backbutton() { return $('aotf-button.back-button'); }
    get next() { return $('div.next-button'); }
    get userflow() { return $('div.top-content'); }
    get Indicator() { return $('div.radio-mock '); }
    get closebutton() { return $('span.icon.light path'); }
    get surebutton() { return $('div.dialog-buttons button.button.primary'); }
    get Howitworks() { return $('aotf-how-it-works'); }
    get Findyourpolicy() { return $('div.info-section.policy'); }
    get Readytoseequotes() { return $('div.see-your-quote__content'); }
}

module.exports = new InsurancePage();
