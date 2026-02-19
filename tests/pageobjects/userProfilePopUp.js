class UserProfilePopUp {

    constructor(page) {
        this.page = page;
    }

    get viewProfileLink() { return this.page.locator('aotf-user-profile-dropdown aotf-button[link="profile"] a'); }
    get signOutButton() { return this.page.getByText("Sign Out"); }
    get userName() { return this.page.locator('aotf-user-profile-dropdown .user-name'); }
    get agentName() { return this.page.locator('aotf-user-profile-dropdown .agent-name'); }
    get currentGroupName() { return this.page.locator('aotf-user-profile-dropdown .group-name'); }
    get listOfGroupEmails() { return this.page.locator('aotf-user-profile-dropdown .email'); }
    get switchGroupButton() { return this.page.locator('[data-qa="change-group-button"] button'); }
    get switchGroupButtonText() { return this.page.locator('[data-qa="change-group-button"] button > span'); }
    get propertyPreferences() { return this.page.locator('[tokenlink="profile/property-fit"]'); }
    get notificationPreferences() { return this.page.locator('[tokenlink="profile/notifications"]'); }
    get viewPage() { return this.page.locator('aotf-picture-card h1'); }
    get agentTitle() { return this.page.locator('.your-agent h2'); }
    get groupsTitle() { return this.page.locator('.your-groups h2'); }
    get groupContent() { return this.page.locator('.your-groups'); }
    get currentAgentName() { return this.page.locator('[data-qa="agent-preferences-agent-name"]'); }
    get profileButton() { return this.page.locator('aotf-user-profile-dropdown [data-qa="user-menu-toggle"]'); }
    get profileMenuButtons() { return this.page.locator('.profile-menu aotf-button a'); }
    get AgentPreferencesHeader() { return this.page.locator('[data-qa="agent-preferences-header"]'); }
    get AgentPreferencesText() { return this.page.locator('aotf-agent-preferences p'); }
    get editButton() { return this.page.locator('.your-agent aotf-button button'); }
    get saveButton() { return this.page.locator('.save-cancel-container [data-qa="agent-preferences-save-button"]'); }
    get cancelButton() { return this.page.locator('.save-cancel-container [data-qa="agent-preferences-cancel-button"]'); }
    get dropdownButton() { return this.page.locator('aotf-agent-dropdown [data-qa="agent-dropdown-toggle"]'); }
    get dropdownList() { return this.page.locator('aotf-agent-dropdown .dropdown-item'); }
    get confirmationPopUp() { return this.page.locator('[data-qa="confirmation-modal"] h1'); }
    get confirmationPopUpText() { return this.page.locator('[data-qa="confirmation-modal"] p'); }
    get confirmationConfirm() { return this.page.locator('.dialog-buttons [data-qa="confirmation-modal-confirm"] button'); }
    get changePropertyPreferences() { return this.page.locator('[data-qa="property-preferences-change"]'); }
    get propertyPreferenceFirstQuestionTab() { return this.page.locator('.question .onboarding-content'); }
    get leftCardText() { return this.page.locator('[data-qa="onboarding-question-1"] aotf-onboarding-card div p'); }
    get rightCardText() { return this.page.locator('[data-qa="onboarding-question-2"] aotf-onboarding-card div p'); }
    get leftCheckMark() { return this.page.locator('[data-qa="onboarding-question-1"] .checkmark'); }
    get skipOption() { return this.page.locator('[data-qa="onboarding-question-skip"]'); }
    get doneButton() { return this.page.locator('[data-qa="onboarding-done-start"]'); }
    get myPropertyPreferencesList() { return this.page.locator('.preferences ul li'); }
    get changeMyTopFeatures() { return this.page.locator('.features [data-qa="top-features-change"]'); }
    get firePlace() { return this.page.locator('//*[span="Fireplace"]'); }
    get hardWoodFlooring() { return this.page.locator('//*[span="Hardwood Flooring"]'); }
    get finishedBasement() { return this.page.locator('//*[span="Finished Basement"]'); }
    get nextButton() { return this.page.locator('//*[span="Next"]'); }
    get exteriorFeaturesList() { return this.page.locator('.feature-selection li'); }
    get skipOptionMyTopFeatures() { return this.page.locator('[data-qa="onboarding-exterior-skip"]'); }
    get exteriornextButton() { return this.page.locator('[data-qa="onboarding-priority-next"]'); }
    get myTopFeaturesList() { return this.page.locator('.features ul li'); }

    // PropertyFit Preferences
    get propertyFitToggleButton() { return this.page.locator('button[aria-checked]'); }

}

module.exports = UserProfilePopUp;