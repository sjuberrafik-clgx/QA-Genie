//write enums for the filter types checkboxes her
const Status = {
    ForSale: 'For Sale',
    ForRent: 'For Rent',
    OpenHouses: 'Open Houses',
    NewListings: 'New Listings',
    PriceReduced: 'Price Reduced',
    ComingSoon: 'Coming Soon',
    VirtualTours: 'Virtual Tours',
    Pending: 'Pending',
    ComingSoon: 'Coming Soon',
    Rented: 'Rented',
    Sold: 'Sold',
    ActiveUnderContract : 'Active Under Contract',
}

const SortBy = {
    HighToLow: 'Highest Price First',
    LowToHigh: 'Lowest Price First',
    Newest: 'Status',
    Oldest: 'Oldest',
    MostRelevant: 'Most Relevant',
}

module.exports = {
    Status,
    SortBy,
}