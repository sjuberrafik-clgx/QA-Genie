class CompareAllPopUp {

    constructor(page) { 
        this.page = page;
    }

    get popUpContent() { return this.page.locator('.tour-step'); }
    get skipAllButton() { return this.page.locator('.tour-step-popper [styletype="textlink"]') };
    get popUpContent2() { return this.page.locator('aotf-highlight-popout div div.step-text') };
    get skipAllButton() { return this.page.locator('[data-qa="skip-all-highlight-popout"]') };
    get notificationPopUp() { return this.page.locator('.notifications.ng-star-inserted'); }



    async skipAllComparePopUp() {
        try {
            // Wait briefly for the popup to potentially appear
            await this.page.waitForTimeout(1000);
            if (await this.skipAllButton.isVisible({ timeout: 3000 })) {
                await this.skipAllButton.click();
            }
        } catch (e) {
            // Compare popup not displayed, continue
        }
    }
}

module.exports = CompareAllPopUp;
