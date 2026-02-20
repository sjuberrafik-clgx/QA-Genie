const generalFunctions = require('../business-functions/general');
const homePage = require('../pageobjects/homePage');



class Search {

    constructor(page) {

        this.page = page;

        this.generalFunctions = new generalFunctions(page);
        this.homePage = new homePage(page);
    }

    async openSearchViaDropDown() {

        //await this.homePage.buyRentDropDown.hover();
        await this.page.waitForTimeout(2000);
        await this.homePage.buyRentDropDown.waitFor({ state: 'visible', timeout: 6000 });
        await this.homePage.buyRentDropDown.click();
        await this.page.waitForTimeout(2000);
        await this.homePage.newSearchOption.waitFor({ state: 'visible', timeout: 3000 });
        await this.homePage.newSearchOption.click();

        return await this.generalFunctions.waitForGridIsDisplayed();
    }




}
module.exports = Search;
