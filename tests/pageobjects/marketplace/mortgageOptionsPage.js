const BrokerInsuranceCard = require('./brokerInsuranceCard');

class MortgageOptionsPage{
    get signInButton() { return $('.sign-in-banner button'); }
    get signInBanner() { return $('.sign-in-banner'); }
    get signInBannerText() { return $$('.sign-in-banner span')[0]; }
    get closeButton() { return $('aotf-marketplace-header button'); }
    get brokerMortgageOptions() { return $$('.agent-recommendation-card'); }
    get brokerMortgageOption() { return $('aotf-agent-recommendation-card .agent-recommendation-card'); }

    /**
     * @param {Element} cardElement
     * @returns {BrokerInsuranceCard}
     */
    getBrokerMortgageCard(cardElement) { return new BrokerInsuranceCard(cardElement); }

}

module.exports = new MortgageOptionsPage();
