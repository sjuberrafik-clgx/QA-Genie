
class HomeProQuestionnaireCard {
    get checkboxList() { return $$('.checkbox-mock'); }
    get radiobuttonList() { return $$('.radio-mock')}
    get nextButton() { return $('.next-button button'); }
}

module.exports = new HomeProQuestionnaireCard();
