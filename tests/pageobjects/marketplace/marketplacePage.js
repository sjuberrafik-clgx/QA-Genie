class MarketplacePage {
    get seePremiumsButton() { return $('.button-label=See Premiums').$('..'); }
    get marketplacePicture() { return $('aotf-marketplace-header img'); }
    get cardTitles() { return $$('aotf-card .card__details--title'); }
    get seeRatesButton() { return $('span=See Rates').$('..'); }
    get findAProButton() { return $('.button-label=Find a Pro').$('..'); }
    get whatsTheAddress() { return $('.top-content .address-form-content .address-form_header') }
    get closeButton() { return('.aotf__header-icon svg') };    
    get confirmButton() { return $('[data-qa="confirmation-modal-confirm"] button'); }
}

module.exports = new MarketplacePage();
