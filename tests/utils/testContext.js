// Define and annotate imports separately for functions

/** @type {import('../pageobjects/POmanager')} */
let Pomanager = require('../pageobjects/POmanager');

/** @type {import('../business-functions/general')} */
let generalFunctions = require('../business-functions/general');

/** @type {import('../business-functions/login')} */
let loginFunctions = require('../business-functions/login');

/** @type {import('../business-functions/favorites')} */
let favoritesFunctions = require('../business-functions/favorites');








// Define and annotate imports separately for page objects

/** @type {import('../pageobjects/loginPage')} */
let loginPage = require('../pageobjects/loginPage');

/** @type {import('../pageobjects/homePage')} */
let homePage = require('../pageobjects/homePage');

/** @type {import('../pageobjects/agentBranding')} */
let agentBrandingPage = require('../pageobjects/agentBranding');

/** @type {import('../business-functions/search')} */
let searchFunctions = require('../business-functions/search');

/** @type {import('../pageobjects/compareAllPopUp')} */
const skipAllComparePopUp = require('../pageobjects/compareAllPopUp');

/** @type {import('../pageobjects/searchPanel')} */
let searchPanel = require('../pageobjects/searchPanel');

/** @type {import('../pageobjects/authenticationPopUp')} */
let authenticationPopUp = require('../pageobjects/authenticationPopUp');

/** @type {import('../pageobjects/logoutPage')} */
let logoutPage = require('../pageobjects/logoutPage');

/** @type {import('../pageobjects/onehomeOwner')} */
let oneHomeOwner = require('../pageobjects/onehomeOwner');

/** @type {import('../pageobjects/propertyDetails')} */
let propertyDetails = require('../pageobjects/propertyDetails');

/** @type {import('../pageobjects/planner')} */
let plannerPage = require('../pageobjects/planner');

/** @type {import('../pageobjects/favoritesPage')} */
let favoritesPage = require('../pageobjects/favoritesPage');

/** @type {import('../pageobjects/offLimitsAgentPopUp')} */
let offLimitsAgentPopUp = require('../pageobjects/offLimitsAgentPopUp');

/** @type {import('../business-functions/propertyDetails')} */
let propertyDetailsFunctions = require('../business-functions/propertyDetails');

/** @type {import('../business-functions/note')} */
let noteFunctions = require('../business-functions/note');

/** @type {import('../pageobjects/addNotesWindow')} */
let addNotesWindow = require('../pageobjects/addNotesWindow');

/** @type {import('../pageobjects/detailsCard')} */
let detailsCard = require('../pageobjects/detailsCard');

/** @type {import('../pageobjects/notificationsMenuDropDown')} */
let notificationsMenuDropDown = require('../pageobjects/notificationsMenuDropDown');

// Combine everything in module.exports

module.exports = {
    Pomanager,
    generalFunctions,
    loginFunctions,
    favoritesFunctions,
    homePage,
    loginPage,
    agentBrandingPage,
    searchFunctions,
    skipAllComparePopUp,
    searchPanel,
    authenticationPopUp,
    logoutPage,
    oneHomeOwner,
    propertyDetails,
    plannerPage,
    favoritesPage,
    offLimitsAgentPopUp,
    propertyDetailsFunctions,
    noteFunctions,
    addNotesWindow,
    detailsCard,
    notificationsMenuDropDown,
};
