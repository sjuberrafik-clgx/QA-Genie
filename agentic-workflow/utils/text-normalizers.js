/**
 * Text normalization utilities shared across the agentic workflow.
 * Provides two canonical variants — aggressive (for keyword matching)
 * and gentle (for display text / whitespace cleanup).
 */

/**
 * Aggressive text normalization — strips all non-alphanumeric characters,
 * collapses whitespace, lowercases. Used for keyword matching and skill lookup.
 * @param {string} value
 * @returns {string}
 */
function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Gentle text normalization — lowercases and collapses whitespace only.
 * Preserves punctuation. Used for display text and selector matching.
 * @param {string} value
 * @returns {string}
 */
function collapseWhitespace(value) {
    return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = { normalizeText, collapseWhitespace };
