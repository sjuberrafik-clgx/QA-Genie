class LogoutPage{

    constructor(page) {
        this.page = page;
    }


    get signInButton() { return this.page.getByText('Sign In'); }
    get headerMessage() {return this.page.locator('#main-content h1'); }
    get picture() {return this.page.locator('aotf-logged-out aotf-picture-card .picture'); }
}

module.exports = LogoutPage;