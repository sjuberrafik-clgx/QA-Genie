class DetailsCard {
    constructor(page) {
        this.page = page;
    }

    get status() {
        return this.page.locator('aotf-property-detail-card .status');
    }

    get price() {
        return this.page.locator('aotf-property-detail-card [data-qa="house-price"]');
    }

    get dislikeButton() {
        return this.page.locator('[class="dropdown-toggle dislike-button icon disliked"]');
    }

    get favouriteButton() {
        return this.page.locator("aotf-button[class='icon'] span[class='blue-medium icon small'] svg");
    }

    get favouritedIcon() {
        return this.page.locator('.favourited');
    }

    get dislikedIcon() {
        return this.page.locator('.disliked');
    }

    get monthlyPrice() {
        return this.page.locator('aotf-monthly-cost-detail [data-qa="total-price"]');
    }

    get breakdownOfCostButton() {
        return this.page.locator('aotf-property-detail-card [data-qa="monthly-breakdown-link"]');
    }

    get addNoteLink() {
        return this.page.locator('span').filter({ hasText: 'Contact Agent' }).first();
    }

    get requestTourButton() {
        return this.page.locator('[data-qa="schedule-tour-button"] button');
    }
}

module.exports = DetailsCard;
