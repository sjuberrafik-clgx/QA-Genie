class agentBranding{

    constructor(page) {
        this.page = page;
    }

    get continueCTA() { return this.page.getByRole('button',{name :'Continue'}); }
    get closeCTA() { return this.page.locator('aotf-close-button'); }
    get modalButton() { return this.page.locator('.welcome-container .buttons button'); }
    get ContinueAgentPopUp() { return this.page.locator('[data-test-id="welcome-modal"] .primary'); }
    get ContinueAgentCard() { return this.page.locator('.content-wrapper .picture-card-content'); }
    get agentBrandingContainer() { return this.page.locator('[data-test-id="welcome-modal"]'); }
    
}
module.exports= agentBranding;