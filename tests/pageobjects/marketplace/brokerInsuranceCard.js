module.exports = class BrokerInsuranceCard {
    constructor(parentContainer) {
        this.container = parentContainer;
    }

    get title() { return this.container.$('.title'); }
    get agentName() { return this.container.$('.agent-name'); }
    get licence() { return this.container.$('.license'); }
    get visitWebsiteButton() {
        return driver.isMobile ?
            this.container.$('.visit-website-button-2 a') :
            this.container.$('.visit-website-button-1 a'); }

    get phoneNumber() { return this.container.$('.phone a'); }
    get email() { return this.container.$('.email a'); }
}
