const MarketplaceAbstractPage = require('./marketplaceAbstractPage');

class HomeProUserDetailsCard extends MarketplaceAbstractPage {
    get firstNameInput() { return $('.first-name input'); }
    get phoneNumberInput() { return $('input[placeholder="Enter phone number"]'); }
    get lastNameInput() { return $('input[placeholder="Enter last name"]'); }
    get emailInput() { return $('.insurance-questionnaire__email input'); }
}

module.exports = new HomeProUserDetailsCard();