
//const MapProperty = require("./mapProperty"); 


class FavoritesPage {


  constructor(page) {
    this.page = page;
  }
  get favoritesTab() { return this.page.locator('//button[.//span[contains(text(), "Favorites (")]]'); }
  get dislikes() { return this.page.locator('//button[.//span[contains(text(), "Dislikes (")]]'); }
  get agentPicks() { return this.page.locator('//button[.//span[contains(text(), "Agent Picks (")]]'); }
  get discards() { return this.page.locator('//button[.//span[contains(text(), "Agent Discards (")]]'); }

  get myproperties() { return this.page.locator("ul > li:nth-child(2) > a > span") }
  get favMsg() { return this.page.locator("div.favorites-tile-wrapper > p") }
  get loadMore() { return this.page.locator(".button.small.primary.collapse") }
  get filtersButton() { return this.page.locator(".filters-button") }
  get applyFiltersButton() { return this.page.locator("span=Apply") }
  get clearFiltersButton() { return this.page.locator("span=Clear filters") }


  get sortingDropdown() { return this.page.locator('span=Sort By:').locator('..'); }
  get sortingOptions() { return this.page.locator('ul.dropdown-menu.show li button'); }


  get myPropertiesTabs() {
    return this.page.locator(".tabs-wrapper ul li");
  }

  get toolTip() {
    return this.page.locator(".tooltip-icon .tooltip-button");
  }

  get toolTipContent() {
    return this.page.locator(".tooltip .tooltip-inner");
  }

  get favoritesHeading() {
    return this.myPropertiesSubSections.first();

  }

  get agentPickTab() {
    return this.page.locator("*=Agent Pick");
  }
  get mapToggle() {
    return this.page.locator('[class="button icon"]');
  }
  get displayedProperties() {
    return this.page.locator("aotf-property-card .property-container");
  }
  get numberOfProperties() {
    return this.page.locator(".active button");
  }
  get propertyIds() {
    return this.page.locator("aotf-property-card .mls > p");
  }
  get noResults() {
    return this.page.locator("aotf-favorites-tiles");
  }
  get noResultsTitle() {
    return this.noResults.locator(".title");
  }
  get noResultsBody() {
    return this.noResults.locator(".body");
  }
  get propertyContainer() {
    return this.page.locator(".tile-container aotf-property-card");
  }
  get propertyPinList1() {
    return this.page.locator(".map-overlay");
  }
  get propertyCard() {
    return this.page.locator(".property-container.map");
  }
  get footer() {
    return this.page.locator("[class=footer-content]");
  }
  get logo() {
    return this.page.locator("[class=logo]");
  }
  get mapPin() {
    return this.page.locator(".overlay-container .map-overlay");
  }

  get loadMore() { return this.page.locator(".load-more .button") }


  // DriveTime

  get driveTime() {
    return this.page.locator("[data-qa=integration-dropdown-map-int-car]");
  }
  get dropDown() {
    return this.page.locator("button.dropdown-item");
  }
  get apply() {
    return this.page.locator(
      "aotf-button .button.button.textlink.collapse [class=button-label]"
    );
  }
  get drivePin() {
    return this.page.locator("div:nth-child(2)>div > div:nth-child(3) > div");
  }
  get driveCard() {
    return this.page.locator("p.inrix-marker-address");
  }
  get myPropertiesSubSections() { return this.page.locator(".tabs-wrapper ul li button") }
  get mapSwitchButtonInDesktop() { return this.page.locator("DIV.show-map-switch-desktop") }
  get SlashSymbolForAllBucketsWhileLoading() { return this.page.locator("div.tabs-wrapper ul") }
  get loaderSpinner() { return this.page.locator(".loading-icon") }





  async getProperty(propertyElement) {
    return new MapProperty(propertyElement);
  }

  async getPropertiesAmount() {
    const getPropertiesCounterValue =
      await this.numberOfProperties.waitForDisplayedAndGetText();

    return parseInt(getPropertiesCounterValue.split("(").pop(), 10);
  }

  async openFavoritedTab() {
    await this.myPropertiesTabs.first().click();
    await this.page.waitForTimeout(3000);
    await this.noResults.isVisible({ timeout: 4000 }) ||
      await this.propertyContainer.isVisible({ timeout: 4000 });
  }

  async openDislikesTab() {
    await this.dislikes.click();
    await this.page.waitForTimeout(3000);

    await this.noResults.isVisible({ timeout: 4000 }) ||
      await this.propertyContainer.isVisible({ timeout: 4000 });
  }

  async openAgentPicksTab() {
    await this.agentPickTab.waitForClickableAndClick();
    await this.noResults.isVisible({ timeout: 4000 }) ||
      await this.propertyContainer.isVisible({ timeout: 4000 });
  }

  async openDiscardsTab() {
    await this.discards.waitForClickableAndClick();
    await this.page.waitForTimeout(3000);

    await this.noResults.isVisible({ timeout: 4000 }) ||
      await this.propertyContainer.isVisible({ timeout: 4000 });
  }
  get filterButton() {
    return this.page.locator("button.button.tertiary.collapse");
  }
  get sortBy() {
    return this.page.locator(".dropdown-toggle.selected-button");
  }
  get clearFilter() {
    return this.page.locator(".button.textlink.collapse.ng-star-inserted");
  }
  get applyFilterButton() {
    return this.page.locator("//span[text()='Apply']");
  }

  get showHideMapCTA() {
    return this.page.locator("button.button.icon");
  }
  get agentDiscardBadge() { return this.page.locator("aotf-agent-exclude .agent-exclude") };


}

module.exports = FavoritesPage;
