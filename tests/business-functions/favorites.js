const homePage = require("../pageobjects/homePage");
const favoritesPage = require("../pageobjects/favoritesPage");
const generalFunctions = require("./general");
const {expect} = require('@playwright/test');
//const notForYouPopUp = require("../pageobjects/notForYouPopUp");

class FavoritesFunctions {
  constructor(page) {
    this.page = page;
    this.homePage = new homePage(page);
    this.favoritesPage = new favoritesPage(page);
    this.generalFunctions = new generalFunctions(page);

  }


  async openFavorites() {
   
    await this.homePage.myProperties.click();
    await this.favoritesPage.loaderSpinner.isVisible();
    await expect(this.favoritesPage.loaderSpinner).toBeVisible();
    await this.favoritesPage.noResults.isVisible({timeout: 4000}) || await this.favoritesPage.propertyContainer.isVisible({timeout: 4000})
    // await this.generalFunctions.declineFeedbackPopUp();


  }

  async dislikePropertyOnHomePage(property) {
    await property.dislikeIcon.click();
    if (await notForYouPopUp.container.isVisible({timeout: 5000}))
      await notForYouPopUp.gotItButton.click();
    await property.selectedDislikeIcon.waitForElementState("visible", { timeout: 5000 });
  }

  async openFiltersPanel() {
    await this.favoritesPage.filtersButton.click();
  }


  async selectOptionsInFiltersPanel(options) {
    for (const option of options) {
      const optionElement = await this.favoritesPage.getOptionElement(option);
      const checkbox = await this.favoritesPage.getFiltersCheckbox(optionElement);
      await checkbox.click();
    }
    await this.favoritesPage.applyFiltersButton.click();
    await this.favoritesPage.loaderSpinner.isDisplayed()
    await browser.pause(3000);
    expect(await this.favoritesPage.loaderSpinner.isDisplayed()).toBe(false);
  }

  async selectSortingOption(optionText) {
    await this.favoritesPage.sortingDropdown.waitForClickable({ timeout: 5000 });
    await this.favoritesPage.sortingDropdown.click();
    const option = await this.favoritesPage.sortingOptions.find(async (el) => {
      const text = await el.getText();
      return text === optionText;
    });
    await option.click();
  }

  async clearFilters() {
    await this.openFiltersPanel();
    await this.favoritesPage.clearFiltersButton.waitForClickableAndClick();
  }

  //clearFiltersAndCloseFiltersPanel
  async clearFiltersAndCloseFiltersPanel() {
    await this.openFiltersPanel();
    await this.favoritesPage.clearFiltersButton.waitForClickableAndClick();
    await this.favoritesPage.filtersButton.waitForClickableAndClick();
  }

}

module.exports = FavoritesFunctions;
