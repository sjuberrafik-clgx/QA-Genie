/**
 * Enum for mortgage questionnaire
 * @readonly
 * @enum {string} PropertyTypes
 * @property {string} singleFamilyHome
 * @property {string} townhouse
 * @property {string} condominium
 * @property {string} multiFamilyHome
 * @property {string} mobileHome
 */
const PropertyTypes = {
    singleFamilyHome: 'SINGLE_FAMILY',
    townhouse: 'TOWNHOME',
    condominium: 'CONDOMINIUM',
    multiFamilyHome: 'MULTI_FAMILY_HOME',
    mobileHome: 'MOBILE_HOME'
}

/**
 * Enum for mortgage questionnaire
 * @readonly
 * @enum {string} UsageOption
 * @property {string} primaryHome
 * @property {string} secondaryHome
 * @property {string} rentalProperty
 */
const UsageOption = {
    primaryHome: 'PRIMARY_HOME',
    secondaryHome: 'SECONDARY_HOME',
    rentalProperty: 'INVESTMENT_RENTAL_PROPERTY'
}

/**
 * Enum for mortgage questionnaire
 * @readonly
 * @enum {string} CreditScore
 * @property {string} excellent
 * @property {string} good
 * @property {string} fair
 * @property {string} poor
 */
const CreditScore = {
    excellent: 'EXCELLENT',
    good: 'SOME_CREDIT_PROBLEMS',
    fair: 'MAJOR_CREDIT_PROBLEMS',
    poor: 'LITTLE_OR_NO_CREDIT_HISTORY'
}

/**
 * Enum for mortgage questionnaire
 * @readonly
 * @enum {string} BankruptcyForeclosure
 * @property {string} no
 * @property {string} yesBankruptcy
 * @property {string} yesForeclosure
 * @property {string} yesBoth
 */
const BankruptcyForeclosure = {
    no: 'no-bankruptcy',
    yesBankruptcy: 'yes-bankruptcy',
    yesForeclosure: 'yes-foreclosure',
    yesBoth: 'yes-both'
}

module.exports = {
    PropertyTypes,
    UsageOption,
    CreditScore,
    BankruptcyForeclosure
}
