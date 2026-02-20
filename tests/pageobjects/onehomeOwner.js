const { expect } = require('@playwright/test');
class OneHomeOwner {


  constructor(page) {
    this.page = page;
  }



  get claimMyHomeCard() { return this.page.locator('.container.tile'); } // selector on right side block
  get claimMyHomeCta() { return this.page.locator('.cards-container-insights [aria-label="ONEHOMEOWNER_CTA"]'); } // selector on right side block
  get myHomeModalDialog() { return this.page.locator('.claim-my-home-widget-dialog'); }
  get myHomeModalDialogCloseButton() { return this.page.locator('aotf-close-button.modal-close'); } // close button on modal dialog
  get oHwTextLink() { return this.page.locator('.modal-body-bottom aotf-button a'); } // selector for the oHw text link
  get firstName() { return this.page.locator('input[placeholder="Enter first name"]'); } // selector for the first name input field
  get lastName() { return this.page.locator('input[placeholder="Enter last name"]'); } // selector for the last name input field
  get emailAddress() { return this.page.locator('input[placeholder="Enter your email address"]'); } // selector for the email address input field
  get yourPropertyAddress() { return this.page.locator('input[placeholder="Enter your property address"]'); } // selector for the property address input field
  get closeButton() { return this.page.locator('div[class="dialog-buttons"] button[type="button"]'); } // close button on modal dialog
  get claimButtonDisabled() { return this.page.locator('.button.primary.collapse.disabled'); } // claim button on modal dialog
  get claimButtonEnabled() { return this.page.locator('[aria-label="ONEHOMEOWNER_CLAIM_CTA"].button.primary.collapse'); } // claim button on modal dialog
  get confirmationModalDialog() { return this.page.locator('.claim-my-home-confirmation-widget-dialog.modal-dialog'); } // confirmation message after form submission
  get oHwTextLinkOnConfirmationModalDialog() { return this.page.locator('.claim-my-home-confirmation-content aotf-button a'); } // close button on confirmation modal dialog
  get gotItButtonOnConfirmationModalDialog() { return this.page.locator('aotf-button[label="GOT_IT_LABEL"] button'); } // "Got it" button on confirmation modal dialog

  //validation1 locators
  get firstNameEmptyError() { return this.page.locator('.validation span[data-qa="firstname-empty-error"]'); }
  get lastNameEmptyError() { return this.page.locator('.validation span[data-qa="lastname-empty-error"]').nth(0); }
  get emailEmptyError() { return this.page.locator('.validation span[data-qa="lastname-empty-error"]').nth(1); }
  get propertyAddressEmptyError() { return this.page.locator('.validation span[data-qa="address-autocomplete-required-error"]'); }

  //validation2 locators
  get invalidFirstNameError() { return this.page.locator('.validation span[data-qa="invalid-firstname-error"]'); }
  get invalidLastNameError() { return this.page.locator('.validation span[data-qa="invalid-lastname-error"]'); }
  get invalidEmailError() { return this.page.locator('.validation span[data-qa="lastname-empty-error"]'); }
  get invalidPropertyAddressError() { return this.page.locator('.validation span[data-qa="address-autocomplete-invalid-error"]'); }
  get somethingWentWrongError() { return this.page.locator('div.error-message'); }



  async ValidationEmptyFields() {

    //Validation For Empty Fields Error 
    await this.firstName.click();
    await this.firstName.fill('');
    await this.lastName.click();
    await this.lastName.fill('');
    await this.emailAddress.click();
    await this.emailAddress.fill('');
    await this.yourPropertyAddress.click();
    await this.yourPropertyAddress.fill('');

    await expect(this.claimButtonDisabled).toBeDisabled();
    await expect(this.firstNameEmptyError).toHaveText('Please enter your first name.');
    await expect(this.lastNameEmptyError).toHaveText('Please enter your last name.');
    await expect(this.emailEmptyError).toHaveText('Please enter a valid email address');
    await expect(this.propertyAddressEmptyError).toHaveText('Please enter your address.');
  }

  async ValidationWrongEntryFields() {

    //validation  wrong entry fields 
    await this.firstName.fill('1234');
    await this.lastName.fill('1234');
    await this.emailAddress.fill('1234');
    await this.yourPropertyAddress.fill('@@@');

    await expect(this.claimButtonDisabled).toBeDisabled();
    await expect(this.invalidFirstNameError).toHaveText('Please enter a valid name.');
    await expect(this.invalidLastNameError).toHaveText('Please enter a valid name.');
    await expect(this.invalidEmailError).toHaveText('Please enter a valid email address');
    await expect(this.invalidPropertyAddressError).toHaveText('Please enter a valid address.');


  }

  async validationAddressBox(inputValue) {

    const addressParts = inputValue.split(',');
    addressParts.pop();
    const modifiedAddress = addressParts.join(',').trim();
    // console.log(modifiedAddress);
    //await this.page.pause();
    await this.fillValidData();
    await this.yourPropertyAddress.fill(modifiedAddress);
    await this.page.waitForTimeout(1000);
    await this.yourPropertyAddress.click(); //click outside to close the address suggestion box
    await this.claimButtonEnabled.click();
    await this.somethingWentWrongError.isVisible();
    console.log(await this.somethingWentWrongError.textContent());
    expect(await this.somethingWentWrongError.textContent()).toEqual('The property address should be structured as follows: [Address, City, State ZIPcode]');

  }

  async fillValidData() {
    await this.firstName.fill('John');
    await this.page.waitForTimeout(500);
    await this.lastName.fill('Doe');
    await this.page.waitForTimeout(500);
    await this.emailAddress.fill('john.doe@example.com');
    expect(await this.claimButtonEnabled).toBeEnabled();
  }



}

module.exports = OneHomeOwner;