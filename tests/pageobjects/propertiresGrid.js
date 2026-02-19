//const Property = require('./property');
//const _ = require("lodash");



class PropertiesGrid {

    constructor(page) {

        this.page = page;
    }


    get propertiesListContainer() { return this.page.locator('.properties-list-container'); }
    get displayedProperties() { return this.page.locator('.property-container') }
    get searchProgress() { return this.page.locator('.searching'); }
    get propertyContainer() { return this.page.locator('.property-container'); }
    get propertyPinIcons() { return this.propertyContainer.$$('button[class="btn-pin"]'); }
    get noResults() { return isMobile ? this.page.locator('.properties-map .no-results-mobile') : this.page.locator('.properties-list .no-results'); }
    get loadMoreButton() { return this.page.locator('.button.small.primary.collapse'); }
    get mapIcon() { return this.page.locator('button.btn-pin'); }
    get mapPin() { return this.page.locator('.map-overlay.selected'); }
    get searchResults() { return this.page.locator(".properties-header h2"); }
    get propertyContent() { return this.page.locator('.property-wrapper .property-content'); }
    getProperty(propertyElement) { return new Property(propertyElement); }
    get BedsCountOnPropertyCard() { return this.page.locator('[data-qa="beds"]'); }
    get compareButton() { return this.page.locator(".btn-compare > button"); }

    get firstContainer() { return this.page.locator('(//*[@class="map property-container"])[1]'); }
    get compareOnGridFirstList() { return this.page.locator('(//*[text()="Compare"])[2]'); }
    // get searchResults() {return  $("[data-qa='listings-number']")}
    //get searchResults() {return $(".properties-header > h2")}
    get imgBasedProperties() { return this.page.locator("[class='feature-pic']"); }
    get notificationcloseButton() { return this.page.locator("//div[@class='heading']//span[@class='dark icon small ng-star-inserted']//*[name()='svg']"); }
    get tooltipListButton() { return this.page.locator("div.tooltip-inner"); }
    get listbutton() { return this.page.locator("aotf-radio-icon-button:nth-child(3) > aotf-input-element > div > div.input"); }
    get noImgeProperties() { return this.page.locator('.no-image'); }
    get mapPins() { return this.page.locator("div.map-overlay"); }


    async waitForPropertyIsVisible() {
        return await this.propertyContainer.first().isVisible({timeout: 4000});
    }


    async hoverOnRandomProperty() {

        const randomProperty = _.sample(await this.displayedProperties)
        await randomProperty.waitForDisplayed()
        await randomProperty.scrollIntoView();
        await randomProperty.moveTo()
        return randomProperty;
    }
}

module.exports = PropertiesGrid;
