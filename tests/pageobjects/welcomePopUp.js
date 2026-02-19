class WelcomePopUp {

  constructor(page){
    this.page = page;
  }

    get container() { return this.page.locator('.welcome-container'); }
    get welcomeModal() { return this.page.locator('[data-test-id="welcome-modal"]'); }
    get closeButton() { return this.page.locator('.modal-dialog aotf-close-button button'); }
    
}

module.exports =  WelcomePopUp;