function normalize(str) {
  // Remove all non-alphanumeric and non-space characters
  return str.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function getDateAndTimeIST() {
  const formatDate = (d = new Date()) => {
    // Convert to IST by adjusting the time
    const istOffset = 5.5 * 60; // IST is UTC + 5:30 hours, so 5.5 hours * 60 minutes
    const istDate = new Date(d.getTime() + (istOffset * 60 * 1000)); // Add the IST offset in milliseconds

    return istDate.toISOString().replace(/T/, ' ').replace(/\..+/, '').replace('Z', '');
  };
  return formatDate();
}

module.exports = { normalize, getDateAndTimeIST };



