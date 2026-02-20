//const SetBoundariesBlock = require('./setBoundaryBlock');

class SearchPanel {

    constructor(page) {
        this.page = page;   
    }

    
    get searchInputField() { return $('.search-control input'); }
    get clearSearchInputButton() { return $('[label="Clear search"] button'); }
    get searchInputDropdown() { return $('aotf-location-search ul.show'); }
    get firstSearchFieldDropDownOption() { return $$('aotf-location-search ul.show button.dropdown-item')[0]; }
    get firstSearchFieldDropDownOptionId() { return $$('.line2 aotf-highlight')[0]; }
    get firstLocationsDropDownOption() { return $('ul .option-title.locations + li button'); }
    get listingsAddressesDropDownOptions() { return $$('.street-address .line1'); }
    get locationDropDownOptions() { return $$('.search-wrapper li:not([class="inventory"]) > .dropdown-item'); }
    get listingsDropdown() { return $('aotf-saved-search-dropdown .dropdown-toggle.selected-button'); }
    get listingsDropdown2() { return $('[data-qa="saved-search-dropdown"]'); }
    get savedSearches() { return $('.my-saved-search-item>button'); }

    get fields() { return $$("aotf-properties-search-dropdown .dropdown-toggle"); }

    get buyRentButton() { return $('[class="dropdown-toggle nav-button"]') }
    get rentRadioButton() { return $('[value="FOR_RENT"] div.radio-mock'); }
    get buyRadioButton() { return $('[value="FOR_SALE"] div.radio-mock'); }
    get applyBuyOrRentButton() { return $('aotf-filter-listing-type .submit button'); }
    get loadMoreCTA() { return $('span=LOAD MORE'); }
    get propertySubType() { return $$('.subtype span'); }

    get other() { return $$('aotf-filter-property-type aotf-checkbox span'); }
    get multifamily() { return $$('aotf-checkbox span'); }

    get BuyButton() { return $('aotf-filter-listing-type > aotf-properties-search-dropdown > div'); }
    get homeTypesButton() { return $('aotf-filter-property-type .dropdown-toggle button'); }
    get homeTypesButton2() { return $('aotf-filter-property-type .dropdown-toggle'); }

    get homeTypeOptions() { return $$('aotf-filter-property-type aotf-checkbox'); }
    get CheckedHomeTypeOptions() { return $$("aotf-filter-property-type aotf-checkbox :checked"); }
    get closeButton() { return $('aotf-close-button button'); }
    get numberOfListings() { return $('[data-qa="listings-listingNumber"]'); }

    get loadMoreCTA() { return $('span=LOAD MORE'); }
    get propertySubType() { return $$('.subtype span'); }

    get conditionallySold() { return $('span=Conditionally Sold') };
    get house() { return $('span=House') };
    get coOp() { return $('span=Co-Op') };
    get apartment() { return $('span=Apartment') };
    get condominium() { return $('span=Condominium') };
    get townhouse() { return $('span=Townhouse') };



    /**
     * @param {Element} optionElement
     */
    getHomeTypeCheckbox(optionElement) {
        return optionElement.$('..').$('.checkbox-mock');
    }

    /**
     * @param {PropertyTypeFilter} text
     */
    getCheckboxByText(text) { return $('aotf-filter-property-type').$(`.checkbox-mock=${text}`); }
    get applyHomeTypesButton() { return $('aotf-filter-property-type .submit button'); }


    // Price Dropdown
    get priceButton() { return $('aotf-filter-price-range .dropdown-toggle'); }
    get openedPriceBlock() { return $('aotf-filter-price-range .dropdown-toggle[aria-expanded="true"]'); }
    get priceSelectionBlock() { return new SetBoundariesBlock('aotf-filter-price-range'); }
    get applyPriceButton() { return $('aotf-filter-price-range .submit button'); }

    get sqFeetButton() { return $('aotf-filter-sq-feet .dropdown-toggle button'); }
    get openedSizeBlock() { return $('aotf-filter-sq-feet .dropdown-toggle[aria-expanded="true"]'); }
    get sizeSelectionBlock() { return new SetBoundariesBlock('aotf-filter-sq-feet'); }
    get sizeSectionInDropDown() { return new SetBoundariesBlock('[data-qa="sq-feet-section"]'); }
    get applySizeButton() { return $('div[class="view-homes"] button[class="button primary fullWidth"]'); }

    get bungalowCheckBox() { return $('.styles-filter .checkbox-mock'); }
    get colonialCheckBox() { return $$('.styles-filter .checkbox-mock')[3]; }

    //get auctionCheckBox() { return $$('aotf-filter-listing-type aotf-input-element')[5];}
    // get auctionCheckBox() { return $$('.buy-filter div.checkbox-mock')[4];}
    get auctionCheckBox() { return $('span=Auction'); }

    get selectStories() {
        return $$('.stories-filter .checkbox-mock');
    }

    selectFeature(numFeature) {
        return $$('.features-filter .checkbox-mock')[numFeature - 1];
    }

    get bedsButton() { return $('aotf-filter-bedroom-count button'); }
    get bedNumberOptions() { return $$('.bedroom-count aotf-radio-button'); }
    get applyBedsButton() { return $('aotf-filter-bedroom-count .submit button'); }
    get bedBathCountInMoreSection() { return $("aotf-filter-bedroom-bathroom[data-qa='bedroom-count-section']") }
    get moreButton() { return $('[data-qa="more-dropdown"]'); }
    get openedMoreBlock() { return $('aotf-filter-more .dropdown-toggle[aria-expanded="true"]'); }
    get bathsSelectionBlock() { return new SetBoundariesBlock('[data-qa="baths-section"]'); }
    get halfBathsSelectionBlock() { return new SetBoundariesBlock('[data-qa="half-baths-section"]'); }
    get applyMoreFilterButton() { return $('.btn-view button'); }
    get lotSizeSelectionBlock() { return new SetBoundariesBlock('aotf-filter-lot-size') }

    get bedsAndBaths() { return $('aotf-filter-bedroom-bathroom') };
    get bedsAndBathsTab() { return $('aotf-filter-bedroom-bathroom .dropdown-menu') }

    get zeroInBedsAndBaths() { return $$('aotf-radio-button:nth-child(1) .input') }
    get applyBedsAndBaths() { return $('aotf-filter-bedroom-bathroom .dropdown-menu .submit .button-label') }

    get bedRoomNumbers() { return $$('.bedroom-filter .button-group .input') }
    get bathRoomNumbers() { return $$('.baths-filter .button-group .input') }

    get lotSizeSectionHeader() { return $('label=Lot Size') }
    get garageCheckBox() { return $('span=Garage') }
    get parkingCheckBox() { return $('span=Parking') }
    get furnishedCheckBox() { return $('span=Furnished') }
    get petsAllowedCheckBox() { return $('span=Pets Allowed') }
    get poolCheckBox() { return $('span=Pool') }

    get firePlace() { return $('span=Fireplace') }
    get squareFootage() { return $('[data-qa="sq-feet-section"]') }
    get stories() { return $('.more .stories-filter') }
    get oneStory() { return $('span=1 Story') }
    get twoStory() { return $('span=2+ Stories') }
    get yearBuilt() { return $('.more .year-built') }

    get buyButton() { return $('aotf-filter-listing-type > aotf-properties-search-dropdown > div'); }
    get buy() { return $$('[class="dropdown-toggle button collapse tertiary"]'); }


    get buyRadioButton2() { return $('span=Buy'); }
    get comingSoon() { return $('span=Coming Soon') }
    get forSale() { return $('span=For Sale') };
    get pending() { return $('span=Pending') };
    get underContract() { return $('span=Active Under Contract') };
    get auctionCheckBox() { return $$('aotf-filter-listing-type aotf-input-element')[6]; }
    get forclosure() { return $$('aotf-filter-listing-type aotf-input-element')[7]; }
    get newconstruction() { return $$('aotf-filter-listing-type aotf-input-element')[8]; }
    get openedMoreBlock() { return $('aotf-filter-more .dropdown-toggle[aria-expanded="true"]'); }

    get inputKeyword() { return $('[data-qa="more-dropdown"] .keywords .input-wrapper .textbox-icon-margin') }
    get addKeyword() { return $('.add-button .button'); }

    get auctionradiobutton() { return $('span=Auction') }
    get activeundercontactradiobutton() { return $('span=Active Under Contract') };
    get soldradiobutton() { return $('span=Recently Sold') }
    get openhousesearchoption() { return $('aotf-filter-open-house div.open-house-filter') }
    get inpersonopenhouse() { return $('span=In Person') }
    get virtualopenhouse() { return $('span=Virtual') }
    get openhousepropertycard() { return $('aotf-property-open-house div.callout.open-house span.open') }
    get apply() { return $('span=Apply') }

    //media search 

    get mediaSearchbyMls() { return $('[class = "inventory"] button figure img.thumbnail'); }


    get resetButton() {
        return driver.isMobile ?
            $('.view-homes .textlink') :
            $('.search-submit-controls .reset-button button');
    }
    get saveSearchButton() {
            return this.page.locator('.search-submit-controls .save-search-button button');
    }
    get searchCriteriaButton() { return $('aotf-filter-params button'); }

    get sortingDropDown() {
        return driver.isMobile ?
            $('aotf-sort-dropdown button.dropdown-toggle') :
            $('aotf-sort-dropdown .dropdown-toggle');
    }

    // By style 

    get add() { return $('span=Add') }
    get minInAnyPrice() { return $('.filter-buttons  aotf-filter-price-range  [label="Min."] [class="select--class select-field large"]') }
    get maxInAnyPrice() { return $('.filter-buttons  aotf-filter-price-range  [label="Max."] [class="select--class select-field large"]') }
    get dropDownOptions() { return $$('[class="select--dropdown"] [class="select--class select-field select-item large"]') }

    /**
     * @param {SortingDropDownItems} text
     */
    getSortingParameterByText(text) {
        return $('aotf-sort-dropdown').$(`.dropdown-item=${text}`);
    }



}

module.exports = SearchPanel;
