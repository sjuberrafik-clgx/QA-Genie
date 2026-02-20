const propertiesGrid = require('../pageobjects/propertiresGrid');
const propertyDetails = require('../pageobjects/propertyDetails');

class PropertyDetailsFunctions {
    constructor(page) {
        this.page = page;
        this.propertiesGrid = new propertiesGrid(page);
        this.propertyDetails = new propertyDetails(page);
    }

    async openRandomPropertyFromGrid() {
        try {
            const displayedProperties = this.propertiesGrid.displayedProperties;
            await displayedProperties.first().waitFor({ state: 'visible', timeout: 10000 });

            const count = await displayedProperties.count();
            if (count === 0) {
                console.log('No properties found');
                return null;
            }

            // Get random property
            const randomIndex = Math.floor(Math.random() * count);
            const randomProperty = displayedProperties.nth(randomIndex);

            // Get property details before clicking
            const propertyData = {
                status: '',
                price: ''
            };

            try {
                const statusElement = randomProperty.locator('.status');
                if (await statusElement.count() > 0) {
                    propertyData.status = await statusElement.first().textContent();
                }
            } catch (e) {
                // Status not found
            }

            try {
                const priceElement = randomProperty.locator('[data-qa="house-price"]');
                if (await priceElement.count() > 0) {
                    propertyData.price = await priceElement.first().textContent();
                }
            } catch (e) {
                // Price not found
            }

            // Click to open details
            await randomProperty.click();
            await this.propertyDetails.propertyDetails.waitFor({ state: 'visible', timeout: 15000 });

            return propertyData;
        } catch (error) {
            console.log('Could not open random property:', error);
            return null;
        }
    }

    async openPropertyByNumberFromGrid(propertyNumber = 1) {
        try {
            const displayedProperties = this.propertiesGrid.displayedProperties;
            await displayedProperties.first().waitFor({ state: 'visible', timeout: 10000 });

            const property = displayedProperties.nth(propertyNumber - 1);

            let propertyPrice = '';
            try {
                const priceElement = property.locator('[data-qa="house-price"]');
                if (await priceElement.count() > 0) {
                    propertyPrice = await priceElement.first().textContent();
                }
            } catch (e) {
                // Price not found
            }

            await property.click();
            await this.propertyDetails.propertyDetails.waitFor({ state: 'visible', timeout: 15000 });

            return propertyPrice;
        } catch (error) {
            console.log('Could not open property by number:', error);
            return null;
        }
    }

    async getPropertyAddressLine1() {
        const addressLine1 = this.page.locator('.header address [data-qa="address-line1"]');
        await addressLine1.waitFor({ state: 'visible', timeout: 5000 });
        return (await addressLine1.textContent()).trim();
    }

    async waitForPropertyDetailsLoaded() {
        await this.propertyDetails.propertyDetails.waitFor({ state: 'visible', timeout: 15000 });
    }
}

module.exports = PropertyDetailsFunctions;
