/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * INTENT DETECTOR — Automatic Knowledge Base Query Intent Analysis
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Analyzes user queries and agent task descriptions to determine when
 * external knowledge base content should be fetched. Uses multiple signals:
 *
 *   1. Domain terminology matching (from grounding-config.json)
 *   2. Feature name matching (from featureMap)
 *   3. Custom trigger terms (configurable per project)
 *   4. Trigger patterns (regex patterns like "how does .* work")
 *   5. Acronym expansion (MLS → "Multiple Listing Service")
 *
 * Produces a confidence score (0–1) and returns suggested queries
 * optimized for the knowledge base provider's search API.
 *
 * Zero LLM calls — purely deterministic term matching + scoring.
 *
 * @module intent-detector
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;

// Term weights for confidence scoring
const WEIGHTS = {
    domainTerm: 0.25,          // Known domain abbreviation (MLS, ECFM, etc.)
    domainTermDefinition: 0.15, // Query matches a term's definition
    featureName: 0.20,          // Exact feature name match
    featureKeyword: 0.12,       // Feature keyword match
    triggerTerm: 0.20,          // Custom trigger term ("acceptance criteria", "requirement")
    triggerPattern: 0.25,       // Pattern match ("how does .* work", "what is .*")
    questionWord: 0.08,         // Contains question words (what, how, why, explain)
    multiTermBonus: 0.10,       // Bonus when multiple signals fire
};

// Question words that suggest the user is asking for domain knowledge
const QUESTION_INDICATORS = [
    'what is', 'what are', 'how does', 'how do', 'how to',
    'why does', 'why is', 'explain', 'describe', 'tell me about',
    'definition of', 'meaning of', 'purpose of', 'difference between',
    'when should', 'where is', 'which', 'can you explain',
];

// ─── Intent Detector ────────────────────────────────────────────────────────

class IntentDetector {
    /**
     * @param {Object} config - Intent detection configuration
     * @param {Object}   [config.domainTerminology]  - Term → definition map
     * @param {Array}    [config.featureMap]          - Feature objects with name, keywords
     * @param {string[]} [config.triggerTerms]        - Custom trigger terms
     * @param {string[]} [config.triggerPatterns]     - Regex trigger patterns
     * @param {number}   [config.confidenceThreshold] - Minimum confidence to trigger fetch
     * @param {boolean}  [config.verbose]
     */
    constructor(config = {}) {
        this.terminology = config.domainTerminology || {};
        this.featureMap = config.featureMap || [];
        this.triggerTerms = (config.triggerTerms || []).map(t => t.toLowerCase());
        this.triggerPatterns = (config.triggerPatterns || []).map(p => {
            try {
                return new RegExp(p, 'i');
            } catch {
                return null;
            }
        }).filter(Boolean);
        this.confidenceThreshold = config.confidenceThreshold || DEFAULT_CONFIDENCE_THRESHOLD;
        this.verbose = config.verbose || false;

        // Build lookup structures
        this._termKeys = Object.keys(this.terminology).map(k => k.toLowerCase());
        this._termDefinitions = Object.values(this.terminology).map(v => v.toLowerCase());
        this._featureNames = this.featureMap.map(f => f.name.toLowerCase());
        this._featureKeywords = this.featureMap.flatMap(f => (f.keywords || []).map(k => k.toLowerCase()));

        // Build acronym expansion map
        this._acronymMap = new Map();
        for (const [term, def] of Object.entries(this.terminology)) {
            if (term.length <= 6 && term === term.toUpperCase()) {
                // Likely an acronym
                this._acronymMap.set(term.toLowerCase(), def.toLowerCase());
            }
        }
    }

    /**
     * Analyze a query/task description and determine KB fetch intent.
     *
     * @param {string} query - User query or task description
     * @returns {IntentResult}
     */
    detect(query) {
        if (!query || typeof query !== 'string' || query.trim().length < 3) {
            return this._emptyResult();
        }

        const queryLower = query.toLowerCase().trim();
        const signals = [];
        const matchedTerms = [];
        const matchedFeatures = [];
        let rawScore = 0;

        // ── 1. Domain terminology matching ──
        for (const termKey of this._termKeys) {
            if (this._containsWord(queryLower, termKey)) {
                rawScore += WEIGHTS.domainTerm;
                matchedTerms.push(termKey.toUpperCase());
                signals.push(`domainTerm:${termKey}`);
            }
        }

        // ── 2. Domain term definition matching ──
        for (let i = 0; i < this._termDefinitions.length; i++) {
            const def = this._termDefinitions[i];
            // Check if significant words from the definition appear in the query
            const defWords = def.split(/\s+/).filter(w => w.length > 4);
            const matchCount = defWords.filter(w => queryLower.includes(w)).length;
            if (defWords.length > 0 && matchCount / defWords.length >= 0.4) {
                rawScore += WEIGHTS.domainTermDefinition;
                signals.push(`termDef:${this._termKeys[i]}`);
            }
        }

        // ── 3. Feature name matching ──
        for (let i = 0; i < this._featureNames.length; i++) {
            const featureName = this._featureNames[i];
            if (queryLower.includes(featureName)) {
                rawScore += WEIGHTS.featureName;
                matchedFeatures.push(this.featureMap[i].name);
                signals.push(`featureName:${featureName}`);
            }
        }

        // ── 4. Feature keyword matching ──
        const matchedKeywords = new Set();
        for (const keyword of this._featureKeywords) {
            if (keyword.length > 2 && this._containsWord(queryLower, keyword)) {
                rawScore += WEIGHTS.featureKeyword;
                matchedKeywords.add(keyword);
                signals.push(`featureKeyword:${keyword}`);
            }
        }

        // Map matched keywords back to features
        for (const feature of this.featureMap) {
            const keywords = (feature.keywords || []).map(k => k.toLowerCase());
            if (keywords.some(k => matchedKeywords.has(k)) && !matchedFeatures.includes(feature.name)) {
                matchedFeatures.push(feature.name);
            }
        }

        // ── 5. Custom trigger terms ──
        for (const term of this.triggerTerms) {
            if (queryLower.includes(term)) {
                rawScore += WEIGHTS.triggerTerm;
                matchedTerms.push(term);
                signals.push(`triggerTerm:${term}`);
            }
        }

        // ── 6. Trigger pattern matching ──
        for (const pattern of this.triggerPatterns) {
            if (pattern.test(queryLower)) {
                rawScore += WEIGHTS.triggerPattern;
                signals.push(`triggerPattern:${pattern.source}`);
            }
        }

        // ── 7. Question word detection ──
        for (const qi of QUESTION_INDICATORS) {
            if (queryLower.includes(qi)) {
                rawScore += WEIGHTS.questionWord;
                signals.push(`question:${qi}`);
                break; // Only count once
            }
        }

        // ── 8. Multi-signal bonus ──
        const signalCategories = new Set(signals.map(s => s.split(':')[0]));
        if (signalCategories.size >= 2) {
            rawScore += WEIGHTS.multiTermBonus;
            signals.push('multiSignalBonus');
        }
        if (signalCategories.size >= 3) {
            rawScore += WEIGHTS.multiTermBonus;
            signals.push('strongMultiSignalBonus');
        }

        // Normalize confidence to 0–1 range
        const confidence = Math.min(1, Math.round(rawScore * 100) / 100);
        const shouldFetch = confidence >= this.confidenceThreshold;

        // Build optimized search queries for the KB provider
        const suggestedQueries = this._buildSuggestedQueries(query, matchedTerms, matchedFeatures);

        const result = {
            shouldFetch,
            confidence,
            matchedTerms: [...new Set(matchedTerms)],
            matchedFeatures: [...new Set(matchedFeatures)],
            suggestedQueries,
            signals,
        };

        this._log(`Intent: ${shouldFetch ? 'FETCH' : 'SKIP'} (confidence=${confidence}) — ${signals.length} signals`);

        return result;
    }

    /**
     * Quick check if a query likely needs KB content.
     * Faster than full detect() — no signal details.
     *
     * @param {string} query
     * @returns {boolean}
     */
    shouldFetch(query) {
        return this.detect(query).shouldFetch;
    }

    // ─── Internal Helpers ───────────────────────────────────────────

    /**
     * Build optimized search queries for the KB provider.
     * Takes the original query and enriches it with expanded terms.
     *
     * @param {string} originalQuery
     * @param {string[]} matchedTerms
     * @param {string[]} matchedFeatures
     * @returns {string[]}
     */
    _buildSuggestedQueries(originalQuery, matchedTerms, matchedFeatures) {
        const queries = new Set();

        // Original query (always included)
        queries.add(originalQuery.trim());

        // Expand acronyms in the query
        let expanded = originalQuery;
        for (const [acronym, definition] of this._acronymMap) {
            const regex = new RegExp(`\\b${this._escapeRegex(acronym)}\\b`, 'gi');
            if (regex.test(expanded)) {
                expanded = expanded.replace(regex, definition.split(' — ')[0].trim());
            }
        }
        if (expanded !== originalQuery) {
            queries.add(expanded.trim());
        }

        // Feature-specific query
        for (const feature of matchedFeatures) {
            queries.add(feature);
        }

        // Combined domain terms query
        if (matchedTerms.length > 0) {
            queries.add(matchedTerms.join(' '));
        }

        return [...queries].slice(0, 4); // Max 4 suggested queries
    }

    /**
     * Check if a word appears as a whole word in text.
     * Prevents "at" matching "authentication".
     *
     * @param {string} text - Haystack (lowercase)
     * @param {string} word - Needle (lowercase)
     * @returns {boolean}
     */
    _containsWord(text, word) {
        if (word.length <= 2) {
            // Short words need word boundary matching
            const regex = new RegExp(`\\b${this._escapeRegex(word)}\\b`, 'i');
            return regex.test(text);
        }
        // Longer words can use simple includes (more permissive but faster)
        return text.includes(word);
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _emptyResult() {
        return {
            shouldFetch: false,
            confidence: 0,
            matchedTerms: [],
            matchedFeatures: [],
            suggestedQueries: [],
            signals: [],
        };
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[IntentDetector] ${message}`);
        }
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IntentResult
 * @property {boolean}  shouldFetch     - Whether KB content should be fetched
 * @property {number}   confidence      - Confidence score (0–1)
 * @property {string[]} matchedTerms    - Domain terms that matched
 * @property {string[]} matchedFeatures - Features that matched
 * @property {string[]} suggestedQueries - Optimized queries for KB search
 * @property {string[]} signals         - Debug: which matching rules fired
 */

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { IntentDetector };
