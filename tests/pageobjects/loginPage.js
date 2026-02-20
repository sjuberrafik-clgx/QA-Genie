class LoginPage {

    constructor(page) {
        this.page = page;
    }

    get emailInput() { return this.page.locator('#user-registration-email'); }
    get passwordInput() { return this.page.locator('#user-registration-password-unique'); }
    get signInButton() { return this.page.locator('#signIn-button'); }
    get incorrectCredentialsAlert() { return this.page.locator('div.alert.alert-danger'); }
    get heading() { return this.page.locator('#user-registration'); }
    get passwordbutton() {return this.page.locator('a.forgot-your-password')}

    get AccountLocked() { return this.page.locator('.picture-card .picture-card-content h1') }
    get cancelResetPassword() { return this.page.getByRole('button', { name: 'Cancel' }) }
    get resetPassword() { return this.page.locator('div aotf-button button[aria-label="Reset Password"]') }
    get welcomeSignInPage() { return this.page.locator('div.user-registration .padding-medium')}
    get resetPasswordPage()  { return this.page.locator('.card-body')}
    get incorrectCredDangerAlert() { return this.page.locator('div.alert.alert-danger') }
   get resetPasswordButton() { return this.page.locator('div aotf-button button[aria-label="Reset Password"]') }
}

module.exports = LoginPage;
