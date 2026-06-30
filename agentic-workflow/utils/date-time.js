/**
 * Date/time utilities shared across the QA automation framework.
 * Canonical source for IST (India Standard Time) formatting.
 */

/**
 * Returns the current date/time formatted for IST timezone.
 * Uses Intl API for reliable timezone conversion.
 * @returns {string} e.g. "7/5/2026, 2:30:45 pm"
 */
function getDateAndTimeIST() {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Returns current date/time in IST as an ISO-like string (YYYY-MM-DD HH:mm:ss).
 * Used for test-cycle labels and report timestamps.
 * @returns {string} e.g. "2026-05-07 14:30:45"
 */
function getDateAndTimeISTiso() {
    const istOffset = 5.5 * 60;
    const istDate = new Date(Date.now() + istOffset * 60 * 1000);
    return istDate.toISOString().replace(/T/, ' ').replace(/\..+/, '');
}

module.exports = { getDateAndTimeIST, getDateAndTimeISTiso };
