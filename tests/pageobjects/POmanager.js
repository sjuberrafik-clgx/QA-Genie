//function imports
const GeneralFunctions = require('../business-functions/general');
const LoginFunctions = require('../business-functions/login');
const search = require('../business-functions/search');
const favoritesFunctions = require('../business-functions/favorites');
const NoteFunctions = require('../business-functions/note');
const PropertyDetailsFunctions = require('../business-functions/propertyDetails');
const ProfileFunctions = require('../business-functions/profile');

//page object imports
const loginPage = require('../pageobjects/loginPage');
const homePage = require('../pageobjects/homePage');
const skipAllComparePopUp = require('../pageobjects/compareAllPopUp');
const searchPanel = require('../pageobjects/searchPanel');
const AuthenticationPopUp = require('../pageobjects/authenticationPopUp');
const logoutPage = require('../pageobjects/logoutPage');
const OneHomeOwner = require('../pageobjects/onehomeOwner');
const PropertyDetails = require('../pageobjects/propertyDetails');
const plannerPage = require('./planner');
const favoritesPage = require('../pageobjects/favoritesPage');
const offLimitsAgentPopUp = require('../pageobjects/offLimitsAgentPopUp');
const AddNotesWindow = require('../pageobjects/addNotesWindow');
const DetailsCard = require('../pageobjects/detailsCard');
const NotificationsMenuDropDown = require('../pageobjects/notificationsMenuDropDown');
const ProfilePage = require('../pageobjects/profilePage');
const UserProfilePopUp = require('../pageobjects/userProfilePopUp');
const WelcomePopUp = require('../pageobjects/welcomePopUp');
const AgentBranding = require('../pageobjects/agentBranding');



class POmanager {

    constructor(page) {
        this.page = page;

        // Function instances
        this.generalFunctionsInstance = new GeneralFunctions(page);
        this.loginFunctionsInstance = new LoginFunctions(page);
        this.favoritesFunctionsInstance = new favoritesFunctions(page);
        this.noteFunctionsInstance = new NoteFunctions(page);
        this.propertyDetailsFunctionsInstance = new PropertyDetailsFunctions(page);
        this.profileFunctionsInstance = new ProfileFunctions(page);



        // Page object instances
        this.loginPageInstance = new loginPage(page);
        this.homePageInstance = new homePage(page);
        this.skipAllComparePopUpInstance = new skipAllComparePopUp(page);
        this.searchInstance = new search(page);
        this.searchPanelInstance = new searchPanel(page);
        this.authenticationPopUpInstance = new AuthenticationPopUp(page);
        this.logoutPageInstance = new logoutPage(page);
        this.oneHomeOwnerInstance = new OneHomeOwner(page);
        this.propertyDetailsInstance = new PropertyDetails(page);
        this.plannerPageInstance = new plannerPage(page);
        this.favoritesPageInstance = new favoritesPage(page);
        this.offLimitsAgentPopUpInstance = new offLimitsAgentPopUp(page);
        this.addNotesWindowInstance = new AddNotesWindow(page);
        this.detailsCardInstance = new DetailsCard(page);
        this.notificationsMenuDropDownInstance = new NotificationsMenuDropDown(page);
        this.profilePageInstance = new ProfilePage(page);
        this.userProfilePopUpInstance = new UserProfilePopUp(page);
        this.welcomePopUpInstance = new WelcomePopUp(page);
        this.agentBrandingInstance = new AgentBranding(page);



    }

    // All Function methods

    generalFunctions() { return this.generalFunctionsInstance; }

    loginFunctions() { return this.loginFunctionsInstance; }

    SearchFunctions() { return this.searchInstance; }

    favoritesFunctions() { return this.favoritesFunctionsInstance; }
    // this.agentBranding() { return this.agentBrandingInstance; }


    //Page object methods 
    loginPage() { return this.loginPageInstance; }

    homePage() { return this.homePageInstance; }

    skipAllComparePopUp() { return this.skipAllComparePopUpInstance; }

    searchPanel() { return this.searchPanelInstance; }

    authenticationPopUp() { return this.authenticationPopUpInstance; }

    logoutPage() { return this.logoutPageInstance; }

    oneHomeOwner() { return this.oneHomeOwnerInstance; }

    propertyDetails() { return this.propertyDetailsInstance; }

    plannerPage() { return this.plannerPageInstance; }

    favoritesPage() { return this.favoritesPageInstance; }

    offLimitsAgentPopUp() { return this.offLimitsAgentPopUpInstance; }

    // Notes module page objects and functions
    noteFunctions() { return this.noteFunctionsInstance; }

    propertyDetailsFunctions() { return this.propertyDetailsFunctionsInstance; }

    addNotesWindow() { return this.addNotesWindowInstance; }

    detailsCard() { return this.detailsCardInstance; }

    notificationsMenuDropDown() { return this.notificationsMenuDropDownInstance; }

    // Profile module
    profileFunctions() { return this.profileFunctionsInstance; }

    profilePage() { return this.profilePageInstance; }

    userProfilePopUp() { return this.userProfilePopUpInstance; }

    welcomePopUp() { return this.welcomePopUpInstance; }

    agentBranding() { return this.agentBrandingInstance; }

    // ─── PopupHandler facade methods ─────────────────────────────
    // These delegate to PopupHandler so generated scripts can call
    // poManager.dismissAllPopups() as documented in copilot-instructions.

    /**
     * Dismiss ALL known popups. Delegates to PopupHandler.dismissAll().
     */
    async dismissAllPopups() {
        const { PopupHandler } = require('../utils/popupHandler');
        const handler = new PopupHandler(this.page);
        await handler.dismissAll();
    }

    /**
     * Return a PopupHandler instance bound to the current page.
     */
    popupHandler() {
        const { PopupHandler } = require('../utils/popupHandler');
        return new PopupHandler(this.page);
    }
}
module.exports = POmanager;