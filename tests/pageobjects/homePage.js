//const SavedSearchAndListingDropDown = require("./savedSearchAndListingDropDown");

class HomePage {

  constructor(page) {
    this.page = page;
  }



  get buyRentDropDown() { return this.page.locator('[data-qa="nav-dropdown-properties-buy-rent"] button'); }
  get newSearchOption() { return this.page.locator('[data-qa="nav-dropdown-properties-new-search"]'); }
  get marketplaceDropDown() { return this.page.locator('[data-qa="nav-dropdown-undefined"] button'); }
  getMarketplaceDropDownItem(itemName) { return this.page.locator("ul.show").getByText(itemName, { exact: true }); }
  get listOfMarketplaceDropDownOptions() { return this.page.locator('[data-qa="nav-dropdown-undefined"] li a').all(); }
  get newSearchButton() { return this.page.locator(".new-search-button a"); }
  get comparePropertiesButton() { return this.page.locator('[label="@@COMPARE_CTA"]'); }
  get signInButton() { return this.page.getByText("Sign In"); }
  get myProperties() { return this.page.locator('[data-qa="nav-favorites"]'); }

  get plannerPage() {
    return this.page.locator('a[href*="planner"]');
  }

  get newSearchHyperlink() {
    return this.page.locator('a[href*="properties"]');
  }

  get savedSearchAndListingDropDown() {
    return new SavedSearchAndListingDropDown(this.page);
  }
  get userProfile() {
    return this.page.locator('aotf-user-profile-dropdown [data-qa="user-menu-toggle"]');
  }
  get logo() {
    return this.page.locator("header .logo > a");
  }
  get map() {
    return this.page.locator("ng-component .properties-map");
  }
  get loader() {
    return this.page.locator('[data-qa="loader"]');
  }
  get notificationsButton() {
    return this.page.locator("aotf-notification-menu  button");
  }
  get unreadNotifications() {
    return this.page.locator("aotf-notification-menu  button .notifications-unread");
  }
  get marketplaceDropDown() {
    return this.page.locator('[data-qa="nav-dropdown-undefined"] button');
  }
  get compareCounter() { return driver.isMobile ? this.page.locator(".compare-total") : this.page.locator('[class="tally"]'); }

  get replacepopup() { return this.page.locator(".compare-replace-modal p"); }

  get openAgentInfo() {
    return this.page.locator("aotf-agent-info-card button");
  }
  get agentName() {
    return this.page.locator('div[class="basic-info"]');
  }
  get agentPhone() {
    return this.page.locator(".agent-contact-info [href*=tel]");
  }
  get agentEmail() {
    return this.page.locator(".agent-contact-info [href*=mailto]");
  }
  get agentLicenseNum() {
    return this.page.locator(".license-number");
  }
  get gridView() { return this.page.locator('aotf-radio-icon-button label [data-tooltip="View as Map"]'); }
  get gridViewActive() { return this.page.locator("aotf-radio-icon-button[class='active'] div[data-tooltip='View as Map']"); }
  get tileView() { return this.page.locator('aotf-radio-icon-button label [data-tooltip="View as Cards"]'); }
  get singleLineView() {
    return this.page.locator(".button-group aotf-radio-icon-button:nth-child(3)");
  }
  // get singleLineView() {
  //   return $(".nav-buttons button:nth-child(3)");
  // }
  get searchCriteriaAndExportToCsv() {
    return this.page.locator(".lower-header .search-criteria-export");
  }
  get searchCriteria() {
    return this.page.locator("span=Search Criteria");
  }
  get Lists() {
    return this.page.locator(".multi-column-table .complete-row");
  }
  get Lists2() {
    return this.page.locator(".listings .property-container");
  }
  get results() {
    return this.page.locator(".lower-header .results");
  }
  get help() {
    return this.page.locator(".help-button-right button");
  }
  get faqContainer() {
    return this.page.locator(".main .faq-container");
  }
  get faqCards() {
    return this.page.locator(".cards-container .card .card");
  }
  get openedContainer() {
    return this.page.locator(".faq-category-container .accordion-container");
  }
  get expandQuestions() {
    return this.page.locator(".accordion-container .accordion-item");
  }
  get contentInQuestions() {
    return this.page.locator(".accordion-item .inner-content");
  }
  get signOut() {
    return this.page.locator("button=Sign Out");
  }
  get Header() {
    return this.page.locator("div.card h1.header-text");
  }
  get faqHeader() {
    return $$("div.card h1.header-text");
  }

  get socialmediaIcons() {
    return $$("aotf-agent-social-media-icons a");
  }

  get faqContainerInLine() {
    return $(".faq-menu .menu-item");
  }
  get helpSearchField() {
    return $(".input-element .input-wrapper .textbox-icon-margin");
  }
  get suggestionsDropDown() {
    return $(".search-wrapper .dropdown-menu");
  }
  get firstSuggestion() {
    return $(".search-wrapper .dropdown-menu li:nth-child(2)");
  }
  get agentIcon() {
    return $(".agent-container .agent-avatar");
  }

  get helpFooter() {
    return $(".footer-nav .marketing-cta");
  }
  get helpSearchField() {
    return $(".input-element .input-wrapper .textbox-icon-margin");
  }
  get suggestionsDropDown() {
    return $(".search-wrapper .dropdown-menu");
  }
  get firstSuggestion() {
    return $(".search-wrapper .dropdown-menu li:nth-child(2)");
  }
  get openedContainer() {
    return $(".faq-category-container .accordion-container");
  }

  get sortByDropdown() {
    return $(".properties-sort .dropdown-toggle");
  }
  get sortByDropownMenu() {
    return $(".properties-sort  .dropdown-menu");
  }
  get propertyFitScoreOption() {
    return $("button=PropertyFit™ Score");
  }
  get PFSPercentageOnGrid() {
    return $$(".fit-score .match-score");
  }

  get resultsTotal() {
    return $('[data-qa="listings-listingNumber"]');
  }
  get savedSearches() {
    return $('[data-qa="nav-dropdown-properties-map"]');
  }

  //AgentBranding
  get agentBranding() {
    return $("[class='background-cover-primary']");
  }

  get nonAgentBranding() {
    return $("[class='background-cover']");
  }
  get frHelpText() { return $("button=Assistance") }

  get favButton() { return $$(".listings .property-container aotf-favourite-button aotf-button button") }
  get dislikeButton() { return $$(".listings .property-container aotf-dislike-button aotf-button button") }
  get navigationBottomLine() { return $("div.properties-header.sticky") }
  get anyPriceButton() { return $(".filter-buttons  aotf-filter-price-range") }





}

module.exports = HomePage;
