const BrokerInsuranceCard = require('./brokerInsuranceCard');
const Header = require("./header");

class InsuranceOptionsPage {
    get marketplaceInsuranceOptions() { return $$('.quote-card'); }
    get brokerInsuranceOptions() { return $$('.agent-recommendation-card'); }
    get insuranceError() { return $('.insurance-error-panel'); }
    get header() { return new Header(); }

    /**
     * @param {Element} cardElement
     * @returns {BrokerInsuranceCard}
     */
    getBrokerInsuranceCard(cardElement) { return new BrokerInsuranceCard(cardElement); }
}

module.exports = new InsuranceOptionsPage();
