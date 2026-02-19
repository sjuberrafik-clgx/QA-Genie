class propertyDetails {

    constructor(page) {
        this.page = page;
    }

    get listings() {
        return this.page.locator('.listings .property-container');
    }

    get propertyDetails() {
        return this.page.locator('.container #main-content');
    }

    get viewAllPhotosButton() {
        return this.page.locator("aotf-button.image-count-button");
    }

    get gallerygridview() {
        return this.page.locator(".gallery-tile-container .tile-container");
    }

    get galleryAddress() {
        return this.page.locator('div.address-header');
    }

    get galleryHeader() {
        return this.page.locator('span:text("Gallery")');
    }

    get galleryImages() {
        return this.page.locator('div.image-card-container');
    }

    get photoHeader() {
        return this.page.locator(':text-is("Photos")');
    }

    get image() {
        return this.page.locator("div.featured-image.swiper-zoom-container");
    }

    get closeButton() {
        return this.page.locator('[data-test-id="close-button"]');
    }
    get viewAllPhotosButton() {
        return this.page.locator("aotf-button.image-count-button");
    }

    get requestATour() {
        return this.page.getByRole('button', { name: 'Request a Tour' });
    }

    get requestATourModal() {
        return this.page.locator('.modal-dialog .schedule-tour-blade');
    }

    get requestATourCloseButton() {
        return this.page.locator('.modal-content  .sticky-header .modal-close');
    }

    get neighbourhoodSection() {
        return this.page.locator('.property .getting-around .loader');
    }

    get loadMoreSchoolsButton() {
        return this.page.locator(".showmore");
    }

    get schoolsContent() {
        return this.page.locator(".schools-nearby-content");
    }
    get schoolsCards() {
        return this.page.locator(".all-school-cards .cards");
    }

    get estimatedMonthlyCostButton() {
        return this.page.locator("[data-qa=monthly-breakdown-link]");
    }

    get estimatedMonthlyCostClose() {
        return this.page.locator("[data-test-id=close-button]");
    }

    get estimatedMonthlyCostBlade() {
        return this.page.locator(".modal-content .monthly-cost-blade");
    }


    get estimatedMonthlyCostButton() {
        return this.page.locator("[data-qa=monthly-breakdown-link]");
    }

    get estimatedMonthlyCostClose() {
        return this.page.locator("[data-test-id=close-button]");
    }

    get mortgageMortgageTermDropDown() { return this.page.locator('[title="Mortgage - Principal & Interest"]'); }

    get mortgageDownPaymentPercentInput() { return this.page.locator('[data-qa="input-downpayment-percent"] input'); }

    get publicRecordDataButton() {
        return this.page.locator('[data-qa="public-record-button"]');
    }

    get publicRecordDataSectionTitle() {
        return this.page.locator(".public-record-container h2");
    }

    get closePublicRecordsWindowButton() {
        return this.page.locator(".modal-dialog aotf-close-button button");
    }

    get priceHistoryContent() {
        return this.page.locator('[id="PRICE_AND_TAX_HISTORY"] .price-history-section');
    }

    get viewInsights() {
        return this.page.locator("div[class='loader small'] button[type='button']");
    }

    get closeViewInsights() {
        return this.page.locator('[data-test-id="close-button"]');
    }

    get demographicsSection() { return this.page.locator('.demographics-section') }

    get marketTrendsSection() { return this.page.locator('.market-trends-section') }

    get allListingsButton() {
        return this.page.locator(".navigate-back .button");
    }

    get shareButton() { return this.page.locator('[data-qa="share-button"] .share-icon'); }
    get emailButton() { return this.page.locator('div[class="property-banner"] li:nth-child(1) a:nth-child(1)'); }
    get copyLinkButton() { return this.page.locator('div[class="property-banner"] li:nth-child(2) a:nth-child(1)'); }
    get oneLineAddress() { return this.page.locator('p.address-line-one'); }







    // Carousal Navigation
    get navigationBar() {
        return this.page.locator('.property-banner .navigation-wrapper');
    }

    get propertyDetailsButton() {
        return this.page.locator('.navigation-wrapper .action-tabs [aria-label="Property Details"]');
    }

    get overviewButton() {
        return this.page.locator('.action-tabs [aria-label="Overview"] .button');
    }

    get schoolsButton() {
        return this.page.locator('.action-tabs [aria-label="Schools"] .button');
    }

    get timeTravelButton() {
        return this.page.locator('.navigation-wrapper .action-tabs [aria-label="Travel Time"]');
    }

    get priceAndTaxHistoryButton() {
        return this.page.locator('.action-tabs [aria-label="Price & Tax History"] .button');
    }

    // Reimagine Space (Virtual Staging) - AOTF-15066
    // Selector captured: 2026-01-06
    // Method: getByRole button with name containing 'Reimagine'
    // Rationale: Using accessible role-based selector for the Reimagine Space CTA button
    // Desktop shows "Reimagine Space", Mobile shows "Reimagine"
    get reimagineSpaceButton() {
        return this.page.getByRole('button', { name: /Reimagine/i });
    }

    // View All Photos button
    get viewAllPhotosButton() {
        return this.page.getByRole('button', { name: 'ALT_OPEN_FULLSCREEN' });
    }
}
module.exports = propertyDetails;