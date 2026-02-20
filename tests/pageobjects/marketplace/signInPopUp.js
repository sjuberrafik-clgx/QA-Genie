class SignInPopUp {
    get container() { return $('[data-qa="confirmation-modal"]'); }
    get title() { return this.container.$('h1'); }
    get declineButton() { return this.container.$('.tertiary'); }
    get signInButton() { return this.container.$('.primary'); }
}

module.exports = new SignInPopUp();
