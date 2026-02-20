const Header = require('./header');

class HomeProfessionals {
    get header() { return new Header(); }
    get popularProjectsCard() { return $$('.popular-projects'); }
    get mostPopularProjectsList() { return $$('.popular-projects__content a'); }
    get progressBar() { return $('[role="progressbar"]'); }
    get painting() { return $('[data-qa="ha-painting"] a')}
    get paintingExterior() { return $$('.radio-mock')[1]}
    get homeImprovementProjectsCard() { return $('.home-improvement-projects'); }
    get homeImprovementProjectsList() { return $$('.home-improvement-projects__content a'); }
    get mostPopularProjectsTitle() { return $$('.popular-projects__content a .popular-projects__cta-title'); }
    get otherProjectsList() { return $$('.home-improvement-projects__content a'); }
    get otherProjectsTitle(){ return $$('.home-improvement-projects__content .home-improvement-projects__cta-title'); }
    get pageTitle() { return $('.content__title'); }
    get options() { return $('.content__options'); }
    get consumerQuestions() { return $('[data-qa="ha-consumer-questions-dropdown"]'); }
    get optionClick() { return $$('.content__options .radio-mock'); }
    get optionText() { return $$('.radio-mock .radio-label'); }
    get next() { return $('span=Next'); }
    get close() { return $('.aotf__header-icon svg'); }
    get resultsTitle() { return $('.header-text .header-title'); }
}

module.exports = new HomeProfessionals();
