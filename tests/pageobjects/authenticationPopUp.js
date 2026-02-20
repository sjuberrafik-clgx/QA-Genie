class AuthenticationPopUp {
    constructor(page) {
        this.page = page;
    }

    get container() {
        return this.page.locator('.authentication-modal');
    }

    get title() {
        return this.page.locator("//ngb-modal-window[@role='dialog']//h1[1]");
    }

    get declineButton() {
        return this.container.locator('[data-test-id="close-button"]');
    }

    get signInButton() {
        return this.container.locator('.primary');
    }

    
    get signInButton2() {
        return this.container.getByRole('button', { name: 'Sign In' }); 
    }
}

module.exports = AuthenticationPopUp;