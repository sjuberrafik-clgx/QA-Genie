class ActivateAccount{

     constructor(page) {

        this.page = page;

    }

    get activateAccount() { return $('button.button.reverse.collapse'); }
    get closeButton() {return $('span.icon.light.small'); }
    get yesImSure() { return $('button.button.primary.collapse'); }
    get view() { return $('ul.horizontal-menu'); }

    get crossIconSixOrMoreCharacters() { return $('.input-password ul li:nth-child(1) .close-icon .icon')};
    get crossIconOneOrMoreUpAndLowLetters() { return $('.input-password ul li:nth-child(2) .close-icon .icon')};
    get crossIconOneOrMoreNum() { return $('.input-password ul li:nth-child(3) .close-icon .icon')};
    get crossIconOoneOrMoreSpecialChar() { return $('.input-password ul li:nth-child(4) .close-icon .icon')};

    get checkIconSixOrMoreCharacters() { return $('.input-password ul li:nth-child(1) .check-icon .icon')};
    get checkIconOneOrMoreUpAndLowLetters() { return $('.input-password ul li:nth-child(2) .check-icon .icon')};
    get checkIconOneOrMoreNum() { return $('.input-password ul li:nth-child(3) .check-icon .icon')};
    get checkIconOneOrMoreSpecialChar() { return $('.input-password ul li:nth-child(4) .check-icon .icon')};
    
    get enterPassword() { return this.page.locator('.input-password .input-wrapper [placeholder="Enter password"]')};
}

module.exports =ActivateAccount;