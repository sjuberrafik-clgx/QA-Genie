/**
 * Enum for price and size boundary values
 * @readonly
 * @enum {string} BoundaryType
 * @property {string} min
 * @property {string} max
 */
const BoundaryType = {
    min: 'Minimum',
    max: 'Maximum'
}

/**
 * Enum for boundary filter types
 * @readonly
 * @enum {string} FilterType
 * @property {string} price
 * @property {string} size
 */
const FilterType = {
    price: 'Price',
    size: 'Square Footage',
    baths: 'Baths',
    halfBaths: 'Half Baths',
    beds: 'Beds',
    buyOrRent: 'Buy/Rent',
    lotSize: 'Lot Size'
}

/**
 * Enum for property types filter
 * @readonly
 * @enum {string} FilterType
 * @property {string} house
 * @property {string} condominium
 * @property {string} townhome
 */
const PropertyTypeFilter = {
    house: 'House',
    condominium: 'Condominium',
    townhouse: 'Townhouse',
    other:'Other',
}

/**
 * Enum for property types
 * @readonly
 * @type {Map<string, string>} PropertyType
 */
const PropertyType = new Map([
    [PropertyTypeFilter.house, 'Single Family Residence'],
    [PropertyTypeFilter.condominium, 'Condominium'],
    [PropertyTypeFilter.townhouse, 'Townhouse'],
    [PropertyTypeFilter.other, 'Other'],
]);

/**
 * Enum for sorting dropdown items
 * @readonly
 * @enum {string} SortingDropDownItems
 * @property {string} newest
 * @property {string} lowerPrice
 * @property {string} higherPrice
 */

 const SortingDropDownItems = {
    newest: 'Newest',
    lowerPrice: 'Lowest Price First',
    higherPrice: 'Highest Price First',
    propertyfitscore: 'PropertyFit™ Score',
    status: 'Status'
}

module.exports = {
    BoundaryType,
    FilterType,
    PropertyTypeFilter,
    PropertyType,
    SortingDropDownItems
}
