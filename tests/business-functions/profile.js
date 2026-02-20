const ProfilePage = require('../pageobjects/profilePage');

class ProfileFunctions {
    constructor(page) {
        this.page = page;
        this.profilePage = new ProfilePage(page);
    }

    isDefined(value) {
        return value !== undefined && value !== null;
    }

    async editProfileDetails(userDetails) {
        if (userDetails.firstName !== '' && userDetails.lastName !== '') {
            await this.profilePage.firstNameInput.waitFor({ state: 'visible', timeout: 5000 });
            await this.profilePage.firstNameInput.fill(userDetails.firstName);
            await this.profilePage.lastNameInput.fill(userDetails.lastName);
        }

        if (this.isDefined(userDetails.phoneNumber)) {
            await this.profilePage.phoneNumberInput.fill(userDetails.phoneNumber);
        }

        if (this.isDefined(userDetails.phoneType)) {
            await this.profilePage.selectPhoneType(userDetails.phoneType);
        }
    }

    async saveProfileChanges() {
        await this.profilePage.saveButton.click();
        await this.page.waitForLoadState('networkidle');
    }

    async openEditProfile() {
        await this.profilePage.editButton2.waitFor({ state: 'visible', timeout: 5000 });
        await this.profilePage.editButton2.click();
    }

    async cancelProfileChanges() {
        await this.profilePage.cancelButton.click();
    }
}

module.exports = ProfileFunctions;
