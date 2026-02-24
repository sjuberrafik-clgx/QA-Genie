/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEXT INDEXER — Pure-JS TF-IDF / BM25 Retrieval Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides chunking, tokenization, and ranked retrieval over source code files
 * without any external dependencies (no vector DB, no embedding API).
 *
 * Key features:
 *   - Class-aware chunking that keeps methods + locators together
 *   - Method signature and locator extraction for boosted retrieval
 *   - BM25 scoring with configurable parameters
 *   - Serializable index for disk persistence (no re-indexing on restart)
 *   - File-level staleness detection via mtime tracking
 *
 * @module text-indexer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Stopwords ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
    'or', 'but', 'not', 'with', 'this', 'that', 'from', 'by', 'as', 'be', 'was',
    'are', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'if', 'then', 'else', 'when',
    'up', 'out', 'so', 'no', 'we', 'he', 'she', 'they', 'you', 'i', 'my',
    'me', 'your', 'our', 'their', 'its', 'am', 'were', 'being', 'get', 'set',
    'var', 'let', 'const', 'function', 'return', 'new', 'true', 'false', 'null',
    'undefined', 'typeof', 'instanceof', 'class', 'extends', 'super', 'import',
    'export', 'default', 'require', 'module', 'exports', 'async', 'await',
    'try', 'catch', 'throw', 'finally', 'if', 'else', 'switch', 'case', 'break',
    'continue', 'for', 'while', 'do', 'each', 'map', 'filter', 'some', 'every',
]);

// ─── Lightweight Porter Stemmer (simplified) ────────────────────────────────

/**
 * Minimal stemmer — handles common English suffixes.
 * Not a full Porter stemmer but sufficient for code search where most terms
 * are method names, CSS classes, and technical terms.
 */
function stem(word) {
    if (word.length < 4) return word;

    // Common suffixes in descending length
    const suffixes = [
        ['ational', 'ate'], ['tional', 'tion'], ['ation', 'ate'],
        ['iness', 'i'], ['ness', ''], ['ment', ''],
        ['ible', ''], ['able', ''], ['ful', ''],
        ['ous', ''], ['ive', ''], ['ing', ''],
        ['tion', ''], ['sion', ''], ['ies', 'y'],
        ['ally', 'al'], ['ence', ''], ['ance', ''],
        ['ed', ''], ['er', ''], ['ly', ''],
        ['es', ''], ['s', ''],
    ];

    for (const [suffix, replacement] of suffixes) {
        if (word.endsWith(suffix) && word.length - suffix.length + replacement.length >= 3) {
            return word.slice(0, -suffix.length) + replacement;
        }
    }
    return word;
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/**
 * Tokenize text into searchable terms.
 *
 * Handles code patterns:
 *   - camelCase → ['camel', 'case']
 *   - snake_case → ['snake', 'case']
 *   - PascalCase → ['pascal', 'case']
 *   - file.method() → ['file', 'method']
 *   - CSS selectors → preserved as additional tokens
 *
 * @param {string} text - Raw text to tokenize
 * @param {Object} [options]
 * @param {boolean} [options.stem=true] - Apply stemming
 * @param {boolean} [options.removeStopwords=true] - Remove stopwords
 * @param {boolean} [options.preserveCompound=true] - Keep compound terms alongside splits
 * @returns {string[]} Array of tokens (may contain duplicates for TF scoring)
 */
function tokenize(text, options = {}) {
    const doStem = options.stem !== false;
    const removeStops = options.removeStopwords !== false;
    const preserveCompound = options.preserveCompound !== false;

    if (!text || typeof text !== 'string') return [];

    const tokens = [];

    // 1. Extract compound identifiers (camelCase, PascalCase, snake_case)
    //    and split them into sub-tokens while preserving the original
    const identifiers = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];

    for (const id of identifiers) {
        const lower = id.toLowerCase();

        // Split camelCase/PascalCase
        const parts = id.replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .toLowerCase()
            .split(/[\s_]+/)
            .filter(p => p.length > 0);

        if (preserveCompound && parts.length > 1) {
            tokens.push(lower); // keep compound
        }

        for (const part of parts) {
            if (part.length >= 2) {
                tokens.push(part);
            }
        }
    }

    // 2. Extract quoted strings (selectors, test IDs)
    const quoted = text.match(/['"`]([^'"`]{2,})['"`]/g) || [];
    for (const q of quoted) {
        const inner = q.slice(1, -1).toLowerCase().trim();
        if (inner.length >= 2 && inner.length <= 100) {
            tokens.push(inner);
            // Also tokenize the inner content
            const innerParts = inner.split(/[^a-z0-9]+/).filter(p => p.length >= 2);
            tokens.push(...innerParts);
        }
    }

    // 3. Extract selectors (CSS-like patterns)
    const selectors = text.match(/[.#]\w[\w-]*/g) || [];
    for (const sel of selectors) {
        tokens.push(sel.toLowerCase());
    }

    // 4. Extract data attributes
    const dataAttrs = text.match(/data-[\w-]+/gi) || [];
    for (const attr of dataAttrs) {
        tokens.push(attr.toLowerCase());
    }

    // Apply stopword removal and stemming
    const processed = [];
    for (const token of tokens) {
        if (removeStops && STOPWORDS.has(token)) continue;
        if (token.length < 2) continue;
        processed.push(doStem ? stem(token) : token);
    }

    return processed;
}

// ─── Chunking ───────────────────────────────────────────────────────────────

/**
 * Chunk a source file into overlapping segments with metadata.
 *
 * @param {string} content - File content
 * @param {string} filePath - Relative file path (for metadata)
 * @param {Object} [options]
 * @param {number} [options.chunkSize=80] - Lines per chunk
 * @param {number} [options.chunkOverlap=20] - Overlap lines
 * @param {string} [options.type='unknown'] - Content type classification
 * @param {boolean} [options.classAware=true] - Keep class methods together
 * @returns {Object[]} Array of chunk objects
 */
function chunk(content, filePath, options = {}) {
    const chunkSize = options.chunkSize || 80;
    const overlap = options.chunkOverlap || 20;
    const type = options.type || 'unknown';
    const classAware = options.classAware !== false;

    const lines = content.split('\n');

    if (lines.length <= chunkSize) {
        // Small file — single chunk
        return [{
            id: `${filePath}:1-${lines.length}`,
            filePath,
            startLine: 1,
            endLine: lines.length,
            content: content,
            type,
            metadata: extractMetadata(content, filePath, type),
        }];
    }

    if (classAware) {
        return classAwareChunk(content, lines, filePath, chunkSize, overlap, type);
    }

    // Simple fixed-size chunking with overlap
    return fixedChunk(lines, filePath, chunkSize, overlap, type);
}

/**
 * Class-aware chunking that keeps methods together.
 */
function classAwareChunk(content, lines, filePath, chunkSize, overlap, type) {
    const chunks = [];
    const boundaries = findMethodBoundaries(lines);

    if (boundaries.length === 0) {
        return fixedChunk(lines, filePath, chunkSize, overlap, type);
    }

    let currentStart = 0;
    let currentEnd = 0;

    for (let i = 0; i < boundaries.length; i++) {
        const boundary = boundaries[i];

        // If adding this method would exceed chunk size, finalize current chunk
        if (boundary.end - currentStart > chunkSize && currentEnd > currentStart) {
            const chunkContent = lines.slice(currentStart, currentEnd).join('\n');
            chunks.push({
                id: `${filePath}:${currentStart + 1}-${currentEnd}`,
                filePath,
                startLine: currentStart + 1,
                endLine: currentEnd,
                content: chunkContent,
                type,
                metadata: extractMetadata(chunkContent, filePath, type),
            });

            // Start new chunk with overlap
            currentStart = Math.max(currentEnd - overlap, boundary.start);
        }

        currentEnd = boundary.end;
    }

    // Finalize remaining content
    if (currentEnd > currentStart || currentStart < lines.length) {
        const finalEnd = Math.max(currentEnd, lines.length);
        const chunkContent = lines.slice(currentStart, finalEnd).join('\n');
        if (chunkContent.trim()) {
            chunks.push({
                id: `${filePath}:${currentStart + 1}-${finalEnd}`,
                filePath,
                startLine: currentStart + 1,
                endLine: finalEnd,
                content: chunkContent,
                type,
                metadata: extractMetadata(chunkContent, filePath, type),
            });
        }
    }

    return chunks.length > 0 ? chunks : fixedChunk(lines, filePath, chunkSize, overlap, type);
}

/**
 * Simple fixed-size chunking with overlap.
 */
function fixedChunk(lines, filePath, chunkSize, overlap, type) {
    const chunks = [];
    const step = chunkSize - overlap;

    for (let i = 0; i < lines.length; i += step) {
        const end = Math.min(i + chunkSize, lines.length);
        const chunkContent = lines.slice(i, end).join('\n');

        if (chunkContent.trim()) {
            chunks.push({
                id: `${filePath}:${i + 1}-${end}`,
                filePath,
                startLine: i + 1,
                endLine: end,
                content: chunkContent,
                type,
                metadata: extractMetadata(chunkContent, filePath, type),
            });
        }

        if (end >= lines.length) break;
    }

    return chunks;
}

/**
 * Find method/function boundaries in source code.
 */
function findMethodBoundaries(lines) {
    const boundaries = [];
    let braceDepth = 0;
    let currentMethod = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Detect method/function starts
        const methodMatch = trimmed.match(
            /^(?:async\s+)?(?:(?:get|set)\s+)?(\w+)\s*\([^)]*\)\s*\{?$/
        ) || trimmed.match(
            /^(?:async\s+)?(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{?$/
        ) || trimmed.match(
            /^(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/
        );

        if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
            if (currentMethod && currentMethod.start < i) {
                currentMethod.end = i;
                boundaries.push({ ...currentMethod });
            }
            currentMethod = { start: i, end: i, name: methodMatch[1] };
        }

        // Track brace depth for method end detection
        for (const ch of line) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
        }

        // Class start — treat as a boundary
        if (trimmed.match(/^class\s+\w+/)) {
            if (currentMethod) {
                currentMethod.end = i;
                boundaries.push({ ...currentMethod });
            }
            currentMethod = { start: i, end: i, name: `class:${trimmed.match(/class\s+(\w+)/)?.[1] || 'unknown'}` };
        }
    }

    // Close last method
    if (currentMethod) {
        currentMethod.end = lines.length;
        boundaries.push(currentMethod);
    }

    return boundaries;
}

// ─── Metadata Extraction ────────────────────────────────────────────────────

/**
 * Extract structured metadata from a code chunk.
 */
function extractMetadata(content, filePath, type) {
    const meta = {
        classes: [],
        methods: [],
        locators: [],
        exports: [],
    };

    // Class names
    const classMatches = content.matchAll(/class\s+(\w+)/g);
    for (const m of classMatches) {
        meta.classes.push(m[1]);
    }

    // Method signatures (async or sync)
    const methodMatches = content.matchAll(
        /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/g
    );
    for (const m of methodMatches) {
        const name = m[1];
        if (!['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) {
            meta.methods.push({ name, params: m[2].trim() });
        }
    }

    // Locator patterns (page.locator, getByRole, getByText, etc.)
    const locatorMatches = content.matchAll(
        /(?:this\.(\w+)\s*=\s*)?(?:page|this\.page)\s*\.\s*(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByAltText)\s*\(\s*(['"`])(.*?)\3/g
    );
    for (const m of locatorMatches) {
        meta.locators.push({
            name: m[1] || null,
            method: m[2],
            selector: m[4],
        });
    }

    // Also detect locator() with complex selectors
    const cssLocators = content.matchAll(
        /(?:this\.(\w+)\s*=\s*)?(?:page|this\.page)\s*\.\s*locator\s*\(\s*(['"`])([^'"`]+)\2/g
    );
    for (const m of cssLocators) {
        if (!meta.locators.some(l => l.selector === m[3])) {
            meta.locators.push({
                name: m[1] || null,
                method: 'locator',
                selector: m[3],
            });
        }
    }

    // Export names
    const exportMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (exportMatch) {
        meta.exports = exportMatch[1].split(',').map(e => e.trim()).filter(Boolean);
    }
    const defaultExport = content.match(/module\.exports\s*=\s*(\w+)/);
    if (defaultExport && !exportMatch) {
        meta.exports = [defaultExport[1]];
    }

    return meta;
}

// ─── TF-IDF / BM25 Index ───────────────────────────────────────────────────

/**
 * BM25 search index over code chunks.
 *
 * BM25 parameters:
 *   k1 = 1.5 — term frequency saturation. Higher = more weight to repeated terms.
 *   b  = 0.75 — length normalization. 0 = no normalization, 1 = full.
 *
 * For code search, we use slightly lower b (0.6) because shorter chunks
 * (e.g., a single locator line) should not be penalized vs. longer method bodies.
 */
class BM25Index {
    constructor(options = {}) {
        this.k1 = options.k1 || 1.5;
        this.b = options.b || 0.6;
        this.chunks = [];           // [{id, filePath, content, tokens, type, metadata, ...}]
        this.docFreq = new Map();   // term → number of chunks containing it
        this.avgDocLen = 0;         // average tokens per chunk
        this.totalDocs = 0;
        this._built = false;
    }

    /**
     * Add chunks to the index.
     * @param {Object[]} chunks - Array from chunk() function
     */
    addChunks(chunks) {
        for (const c of chunks) {
            const tokens = tokenize(c.content);
            this.chunks.push({
                ...c,
                tokens,
                tokenSet: new Set(tokens),
                tokenFreq: buildFreqMap(tokens),
            });
        }
        this._built = false;
    }

    /**
     * Build the index (compute IDF, avgDocLen).
     * Must be called after all chunks are added and before search.
     */
    build() {
        this.totalDocs = this.chunks.length;
        this.docFreq.clear();

        let totalTokens = 0;
        for (const chunk of this.chunks) {
            totalTokens += chunk.tokens.length;
            for (const term of chunk.tokenSet) {
                this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
            }
        }

        this.avgDocLen = this.totalDocs > 0 ? totalTokens / this.totalDocs : 1;
        this._built = true;
    }

    /**
     * Search the index with BM25 scoring.
     *
     * @param {string} queryText - Natural language or code query
     * @param {Object} [options]
     * @param {number} [options.topK=10] - Max results
     * @param {number} [options.minScore=0.1] - Min relevance score
     * @param {string} [options.typeFilter] - Filter by chunk type
     * @param {Object} [options.boostFactors] - Per-match-type boost multipliers
     * @param {string[]} [options.boostTerms] - Additional terms to boost
     * @returns {Object[]} Ranked results: [{chunk, score, matchedTerms}]
     */
    search(queryText, options = {}) {
        if (!this._built) this.build();

        const topK = options.topK || 10;
        const minScore = options.minScore || 0.1;
        const boostFactors = options.boostFactors || {};
        const boostTerms = options.boostTerms || [];

        const queryTokens = tokenize(queryText, { stem: true, removeStopwords: true });
        if (boostTerms.length > 0) {
            const boostTokens = tokenize(boostTerms.join(' '), { stem: true, removeStopwords: true });
            // Add boost tokens with lower weight (they'll still contribute to IDF scoring)
            queryTokens.push(...boostTokens);
        }

        if (queryTokens.length === 0) return [];

        const queryTokenSet = new Set(queryTokens);
        const queryLower = queryText.toLowerCase();
        const results = [];

        for (const chunk of this.chunks) {
            // Type filter
            if (options.typeFilter && chunk.type !== options.typeFilter) continue;

            let score = 0;
            const matchedTerms = [];

            for (const term of queryTokenSet) {
                const tf = chunk.tokenFreq.get(term) || 0;
                if (tf === 0) continue;

                matchedTerms.push(term);

                // BM25 score component
                const df = this.docFreq.get(term) || 0;
                const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);
                const docLen = chunk.tokens.length;
                const tfNorm = (tf * (this.k1 + 1)) /
                    (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLen)));

                score += idf * tfNorm;
            }

            if (score <= 0) continue;

            // Apply boost factors
            score = applyBoosts(score, chunk, queryLower, boostFactors);

            if (score >= minScore) {
                results.push({ chunk, score, matchedTerms });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Get index statistics.
     */
    getStats() {
        return {
            totalChunks: this.chunks.length,
            totalTerms: this.docFreq.size,
            avgDocLen: Math.round(this.avgDocLen),
            byType: countByType(this.chunks),
            built: this._built,
        };
    }

    /**
     * Serialize index to JSON for disk persistence.
     */
    toJSON() {
        return {
            k1: this.k1,
            b: this.b,
            chunks: this.chunks.map(c => ({
                id: c.id,
                filePath: c.filePath,
                startLine: c.startLine,
                endLine: c.endLine,
                content: c.content,
                type: c.type,
                metadata: c.metadata,
                // Don't serialize tokens/tokenFreq — they'll be rebuilt from content
            })),
            buildTimestamp: new Date().toISOString(),
        };
    }

    /**
     * Restore index from JSON (avoids re-reading files).
     * @param {Object} json - Output of toJSON()
     * @returns {BM25Index}
     */
    static fromJSON(json) {
        const index = new BM25Index({ k1: json.k1, b: json.b });
        for (const c of json.chunks) {
            const tokens = tokenize(c.content);
            index.chunks.push({
                ...c,
                tokens,
                tokenSet: new Set(tokens),
                tokenFreq: buildFreqMap(tokens),
            });
        }
        index.build();
        return index;
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildFreqMap(tokens) {
    const freq = new Map();
    for (const t of tokens) {
        freq.set(t, (freq.get(t) || 0) + 1);
    }
    return freq;
}

function countByType(chunks) {
    const counts = {};
    for (const c of chunks) {
        counts[c.type] = (counts[c.type] || 0) + 1;
    }
    return counts;
}

/**
 * Apply boost multipliers based on match characteristics.
 */
function applyBoosts(baseScore, chunk, queryLower, boostFactors) {
    let score = baseScore;

    // File name match boost
    if (boostFactors.fileNameMatch) {
        const fileName = chunk.filePath.split(/[/\\]/).pop().toLowerCase().replace('.js', '');
        const queryWords = queryLower.split(/\s+/);
        for (const word of queryWords) {
            if (word.length >= 3 && fileName.includes(word)) {
                score *= boostFactors.fileNameMatch;
                break;
            }
        }
    }

    // Method name match boost
    if (boostFactors.methodNameMatch && chunk.metadata?.methods) {
        const methodNames = chunk.metadata.methods.map(m => m.name.toLowerCase());
        const queryWords = queryLower.split(/\s+/);
        for (const word of queryWords) {
            if (word.length >= 3 && methodNames.some(m => m.includes(word))) {
                score *= boostFactors.methodNameMatch;
                break;
            }
        }
    }

    // Locator match boost
    if (boostFactors.locatorMatch && chunk.metadata?.locators?.length > 0) {
        if (queryLower.includes('selector') || queryLower.includes('locator') ||
            queryLower.includes('getby') || queryLower.includes('data-qa') ||
            queryLower.includes('click') || queryLower.includes('fill')) {
            score *= boostFactors.locatorMatch;
        }
    }

    // Exact match boost — query appears literally in the content
    if (boostFactors.exactMatch) {
        const words = queryLower.split(/\s+/).filter(w => w.length >= 4);
        for (const word of words) {
            if (chunk.content.toLowerCase().includes(word)) {
                score *= 1 + (boostFactors.exactMatch - 1) * 0.3; // partial exact boost
                break;
            }
        }
    }

    return score;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    tokenize,
    stem,
    chunk,
    extractMetadata,
    findMethodBoundaries,
    BM25Index,
};
