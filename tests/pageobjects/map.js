//const MapProperty = require('./mapProperty');

class Map {


    constructor(page) {
        this.page = page;
    }



    get expandSelectedMapCard() { return $('agm-map .selected > span > span'); }
    get propertyPinList() { return this.page.locator('.map-overlay').all(); }
    get propertiesClusterList() { return this.page.locator('div.map-cluster-overlay').all(); }
    get propertyCardAddress() { return $('.address-content address'); }
    get loadingIndicator() { return this.page.locator('.map-loader [data-qa="loader"]'); }
    get desktopProperty() { return $('div [class="property-container map loaded"]'); }
    get desktopPropertyOnCompare() { return $('div [class="property-container map card-pointer loaded"]'); }
    get mobileProperty() { return $('.properties-map>aotf-property-map-card'); }
    get displayedTile() { return driver.isMobile ? this.mobileProperty : this.desktopProperty; }
    get noResultsTile() { return this.page.locator('.no-results-mobile'); }
    get expandPropertyList() { return $$('[icon="dropdown-arrow-small"]:not([class=expand-icon])'); }
    get collapsePropertyList() { return $('[icon="dropdown-arrow-small"].expand-icon'); }
    get drawOnMamButton() { return $('.gm-svpc'); }
    get mapZoomPlusButton() { return $('[class=gm-control-active]:nth-child(1)'); }
    get mapZoomMinusButton() { return $('[class=gm-control-active]:nth-child(3)'); }
    get mapViewButton() { return $('[data-qa="map-view-button"]'); }
    get mapViewCurrentState() { return $('[class="button tertiary"][aria-label]'); }
    get mapViewOptions() { return this.mapViewButton.$$(':nth-child(2) button'); }
    get parcelDisclaimerButton() { return $('button=Parcel disclaimer'); }
    get rightBottomCornerElements() { return $('button=Parcel disclaimer').$('..').$$('div[style*="bottom"]'); }
    get termOfUseButton() { return $('a=Terms of Use'); }
    get reportMapErrorButton() { return $('a=Report a map error'); }
    get selectedPin() { return $('div.map-overlay.selected'); }
    get selectedPropertyCard() { return $('.property-container.selected'); }
    get openAgentProfile() { return '.avatar'; }
    get boundaries() { return $('[label="Boundaries"]'); }
    get schools() { return $('[label="Schools"]'); }

    //Points of Interest
    get pointsOfInterestButton() { return $('[label="Points of Interest"] .integration-dropdown'); }
    get pointsOfInterestDropDown() { return $('.dropdown-menu.show'); }
    get pointsOfInterestDropDownTitle() { return this.pointsOfInterestDropDown.$('legend'); }
    get pointsOfInterestDropDownClearButton() { return this.pointsOfInterestDropDown.$('button[class*="textlink-secondary"]'); }
    get pointsOfInterestDropDownApplyButton() { return this.pointsOfInterestDropDown.$('button:not([class*="textlink-secondary"])'); }
    get pointsOfInterestListOfOptions() { return $$('.dropdown-menu.show ul>li'); }
    get pointsOfInterestSelectedCheckbox() { return $('.enabled.selected'); }
    get pointsOfInterestSelectedButton() { return this.pointsOfInterestSelectedCheckbox.$('span.checkbox-label'); }

    get CardPin() { return $$('.overlay-container .map-overlay') };

    get multiUnitContainer() { return $$('.loader .property-inner-container .multi-unit-container') };
    get multiUnitContainerHeader() { return $$('.loader .property-inner-container .multi-unit-container .multi-unit-header') }
    get ListsOnMultiPinCard() { return $$('div.multi-unit-inner-container div:nth-child(1) a div') };

    get multiPinsClose() { return $('div.multi-unit-header aotf-close-button button aotf-icon span svg') }
    get driveTime() { return $('[label="Drive Time"]') }
    get driveTimeFooterPara() { return $('[label="Drive Time"] .legal') }

    get clusterPins() { return $('.overlay-container .map-cluster-overlay') }

    get mapMultipins() { return $$(".map-overlay") }
    get clusterMultiPins() { return $$(".overlay-container .map-cluster-overlay") }
    get multUnitPins() { return $$(".multi-unit-overlay.map-overlay") }
    get parcelDisclaimer() { return $("#map-text-button-container") }
    get labesOnMap() { return $$("div:nth-child(16) > div:nth-child(2)") }
    get propertyCardOnMap() { return $("aotf-property-map-card.overlap-pin ") }
    get agentDiscardButton() { return $("div[class='property-container map loaded'] aotf-exclude-button span[class='icon small']") }
    get agentDiscardActiveButton() { return $("div[class='property-container map loaded'] aotf-exclude-button span[class='icon small'] svg [fill='#D31313']"); }
    get agentDiscardInactiveButton() { return $("div[class='property-container map loaded'] aotf-exclude-button span[class='icon small'] svg [fill='#4577B6']"); }
    get propertyMLSIdOnMapCard() { return $("div[class='property-container map loaded'] div.mls "); }
    get imageContainerOnMapCard() { return $("div[class='property-container map loaded'] div[class='image-container']"); }





    /**
     * @returns {MapProperty}
     */
    async getProperty() {
        if (driver.isMobile) {
            return new MapProperty(this.mobileProperty);
        }

        const desktopPropertyElement = await this.desktopProperty;
        return new MapProperty(await desktopPropertyElement);
    }
    async getPropertyOnCompareMap() {
        if (driver.isMobile) {
            return new MapProperty(this.mobileProperty);
        }

        const desktopPropertyElement = await this.desktopPropertyOnCompare;
        return new MapProperty(await desktopPropertyElement);
    }

    /**
     * @param {String} price
     * @returns {boolean}
     */
    checkValidPriceFormatForPin(price) {
        return RegExp('^\\$\\d*[.,]?\\d*?[KM]?$').test(price)
    }
}

module.exports = Map;
