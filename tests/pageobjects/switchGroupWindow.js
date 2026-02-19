class SwitchGroupWindow {

    get container() { return this.page.locator('.blade-container .group-switch-blade'); }
    get title() { return this.page.locator('.group-switch-blade h1'); }
    get description() { return this.page.locator('.group-switch-blade .main-content p'); }
    get currentAgentName() { return this.page.locator('.group-switch-blade .agent-name'); }
    get currentGroupName() { return this.page.locator('.group-info.radio.selected .group-name'); }
    get groupNames() { return this.page.locator('fieldset.groups .group-info .group-name'); }
    get groupEmails() { return this.page.locator('fieldset.groups .group-info .email'); }
    get saveButton() { return this.page.locator('.modal-dialog aotf-button button.primary'); }
    get cancelButton() { return this.page.locator('.group-switch-blade aotf-button button.textlink'); }
    get firstNotSelectedGroupRadioButton() { return this.page.locator('.group-switch-blade .group-info.radio:not(.selected)').first().locator('.radio-indicator'); }
    get firstNotSelectedGroupName() { return this.page.locator('.group-switch-blade .group-info.radio:not(.selected)').first().locator('.group-name'); }
}

module.exports = SwitchGroupWindow;