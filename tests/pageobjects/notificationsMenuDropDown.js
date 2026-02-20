class NotificationsMenuDropDown {
    constructor(page) {
        this.page = page;
    }

    get title() {
        return this.page.locator('.notifications-menu .title');
    }

    get listOfResults() {
        return this.page.locator('.notifications-menu .results ul');
    }

    get lastNotificationComment() {
        return this.page.locator('.notifications-menu .results ul li').first().locator('.comment');
    }

    get lastNotificationMessage() {
        return this.page.locator('.notifications-menu .results ul li').first().locator('.message');
    }

    get viewComments() {
        return this.page.locator('.notifications-menu .results ul li').first().locator('.view');
    }
}

module.exports = NotificationsMenuDropDown;
