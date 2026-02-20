const { type } = require("os");

class OffLimitsAgentPopUp {

    constructor(page) {
        this.page = page;
    }
    get container() { return this.page.locator('ngb-modal-window .modal-container'); }
    get okButton() { return this.container.getByRole('button', { type: 'button' }); }
    get title() { return this.container.getByText(`Sorry, that's off limits in Agent Preview mode`); }
    //title selector is not working for one test case so added new one with h1 tag
    get titleWithH1() { return this.page.locator('ngb-modal-window .modal-container h1'); }
    get titleAP() { return this.container.locator('h2'); }
    get text() { return this.container.locator('p'); }
}

module.exports = OffLimitsAgentPopUp;