class PlannerPage {

    constructor(page) {
        this.page = page;
    }

    // Task window elements
    get container() { return this.page.locator('ngb-modal-window .task-blade'); }
    get markAsCompleteButton() { return this.page.locator('.actions button.textlink-secondary'); }
    get thisDoesntApplyToMeButton() { return this.page.locator('.actions button.textlink'); }
    get tasksContainer() { return this.page.locator('.planner .planner-tasks'); }


    get container() { return this.page.locator('aotf-planner-tasks .planner-tasks'); }
    get getStartedButton() { return this.page.locator('section.first-visit button'); }
    get sellingModeSwitcher() { return this.page.locator('.mode-switcher a[href*="sell"]'); }
    get actionTabsDropDown() { return this.page.locator('aotf-dropdown button.dropdown-toggle'); }
    get sellActionTabs() { return this.page.locator('.action-tabs.sell a'); }
    get plannerCards() { return this.page.locator('.task-list aotf-planner-card button'); }
    get StartButton() { return this.page.locator('span=Get Started'); }
    get sellingmodecard() { return this.page.locator('.task-button .card.turquoise'); }
    get stickyHeader() { return this.page.locator('aotf-close-button.blade-close'); }
    get taskbar() { return this.page.locator('section.nav'); }

    //Planner cards elements

    get taskCard() { return this.page.locator('.blade-container .task-blade'); }
    get sellPropertyTab() { return this.page.locator('a[href*="/planner/sell/property"]'); }
    get paragraphOnCard() { return this.page.locator('.blade-container .task-blade .body'); };

}

module.exports = PlannerPage;