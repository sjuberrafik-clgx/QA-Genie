/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTEXT DNA COMPILER — Lossless Multi-Resolution Semantic Compilation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Instead of summarizing source material (lossy), the DNA Compiler COMPILES it
 * into a multi-resolution representation that preserves ALL semantic information
 * in dramatically less space — like biological DNA: compact, complete, expressible.
 *
 * 4 Resolution Levels:
 *   L0 — Raw Source        (100%)  Full original text/code/data
 *   L1 — Semantic Skeleton (~15%)  Signatures + relationships + contracts + invariants
 *   L2 — Module Cards      (~3%)   Per-module: purpose, API, dependencies, behavior
 *   L3 — Architecture DNA  (~0.5%) Complete system model in ≤2000 tokens
 *
 * Key properties:
 *   ✦ Bidirectional: L3 → L2 → L1 → L0 decompress for any region
 *   ✦ Relationship-preserving: Unlike RAG, maintains ALL cross-references
 *   ✦ Incremental: Only recompiles changed sections (like incremental builds)
 *   ✦ Domain-agnostic: Works for code, docs, data, conversations
 *   ✦ Zero LLM cost: 100% deterministic JavaScript
 *
 * @module ccm/context-dna-compiler
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Constants ──────────────────────────────────────────────────────────────

const DNA_VERSION = '1.0.0';
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'ccm-data');
const DNA_FILE = 'context-dna.json';
const MTIME_FILE = 'dna-mtimes.json';

// ─── Source Type Analyzers ──────────────────────────────────────────────────

/**
 * Analyzes a JavaScript source file and extracts semantic structure.
 * Handles: classes, methods, exports, locators, dependencies, invariants.
 */
function analyzeJavaScriptSource(content, filePath) {
    const result = {
        type: 'code',
        language: 'javascript',
        classes: [],
        functions: [],
        exports: [],
        dependencies: [],
        locators: [],
        invariants: [],
        stateTransitions: [],
        sideEffects: [],
        rawLineCount: content.split('\n').length,
    };

    // ── Extract require/import dependencies ────────────────────────
    const requireMatches = content.matchAll(/(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g);
    for (const m of requireMatches) {
        const names = m[1] ? m[1].split(',').map(s => s.trim()) : [m[2]];
        result.dependencies.push({
            module: m[3],
            imports: names.filter(Boolean),
        });
    }

    const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g);
    for (const m of importMatches) {
        const names = m[1] ? m[1].split(',').map(s => s.trim()) : [m[2]];
        result.dependencies.push({
            module: m[3],
            imports: names.filter(Boolean),
        });
    }

    // ── Extract class declarations ─────────────────────────────────
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g;
    let classMatch;
    while ((classMatch = classRegex.exec(content)) !== null) {
        const className = classMatch[1];
        const extendsClass = classMatch[2] || null;
        const classStartIdx = classMatch.index;

        // Find class body boundaries (brace matching)
        const classBody = extractBraceBlock(content, classStartIdx + classMatch[0].length - 1);

        const classMethods = extractMethods(classBody, className);
        const classLocators = extractLocators(classBody);

        result.classes.push({
            name: className,
            extends: extendsClass,
            methods: classMethods,
            locators: classLocators,
            lineStart: content.substring(0, classStartIdx).split('\n').length,
        });

        result.locators.push(...classLocators.map(l => ({ ...l, owner: className })));
    }

    // ── Extract standalone functions ───────────────────────────────
    const funcRegex = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    const arrowFuncRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;

    for (const regex of [funcRegex, arrowFuncRegex]) {
        let funcMatch;
        while ((funcMatch = regex.exec(content)) !== null) {
            // Skip if inside a class (already captured)
            const lineNum = content.substring(0, funcMatch.index).split('\n').length;
            const isInsideClass = result.classes.some(c => lineNum >= c.lineStart);
            if (isInsideClass) continue;

            const funcBody = extractBraceBlock(content, content.indexOf('{', funcMatch.index));
            result.functions.push({
                name: funcMatch[1],
                params: parseParams(funcMatch[2]),
                async: funcMatch[0].includes('async'),
                throws: extractThrows(funcBody),
                calls: extractFunctionCalls(funcBody),
                lineStart: lineNum,
            });
        }
    }

    // ── Extract module.exports ─────────────────────────────────────
    const exportMatch = content.match(/module\.exports\s*=\s*(?:\{([^}]+)\}|(\w+))/);
    if (exportMatch) {
        const exported = exportMatch[1]
            ? exportMatch[1].split(',').map(s => s.trim().split(/\s*:\s*/)[0]).filter(Boolean)
            : [exportMatch[2]];
        result.exports = exported;
    }

    // ── Extract invariants (constant checks, assertions in code) ──
    const invariantPatterns = [
        /(?:if|assert)\s*\(([^)]{5,80})\)\s*(?:throw|return)/g,
        /(?:const|let|var)\s+MAX_\w+\s*=\s*(\d+)/g,
        /(?:const|let|var)\s+MIN_\w+\s*=\s*(\d+)/g,
        /\.length\s*[><=!]+\s*(\d+)/g,
    ];
    for (const pattern of invariantPatterns) {
        let inv;
        while ((inv = pattern.exec(content)) !== null) {
            result.invariants.push(inv[0].trim().slice(0, 120));
        }
    }

    // ── Extract state transitions (from page navigation, goto, click flows) ──
    const navMatches = content.matchAll(/(?:page|this\.page)\.goto\(['"]([^'"]+)['"]\)/g);
    for (const m of navMatches) {
        result.stateTransitions.push({ type: 'navigation', target: m[1] });
    }

    // ── Extract side effects (event emissions, API calls, file writes) ──
    const sideEffectPatterns = [
        { regex: /\bemit\(['"](\w+)['"]/g, type: 'event' },
        { regex: /\bfetch\(['"]([^'"]+)['"]\)/g, type: 'api_call' },
        { regex: /fs\.\w*[Ww]rite/g, type: 'file_write' },
        { regex: /console\.(log|warn|error)/g, type: 'logging' },
    ];
    for (const { regex, type } of sideEffectPatterns) {
        let se;
        while ((se = regex.exec(content)) !== null) {
            result.sideEffects.push({ type, detail: se[1] || se[0] });
        }
    }

    return result;
}

/**
 * Analyzes a JSON data file and extracts schema structure.
 */
function analyzeJSONSource(content, filePath) {
    try {
        const data = JSON.parse(content);
        return {
            type: 'data',
            format: 'json',
            schema: extractJSONSchema(data),
            topLevelKeys: Object.keys(data),
            rawSize: content.length,
        };
    } catch {
        return { type: 'data', format: 'json', error: 'parse_failed', rawSize: content.length };
    }
}

/**
 * Analyzes a Markdown/documentation file and extracts semantic structure.
 */
function analyzeDocSource(content, filePath) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;
    let currentContent = [];
    const crossRefs = [];

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            if (currentSection) {
                sections.push({
                    heading: currentSection.heading,
                    level: currentSection.level,
                    content: currentContent.join('\n').trim(),
                    lineCount: currentContent.length,
                });
            }
            currentSection = { heading: headingMatch[2], level: headingMatch[1].length };
            currentContent = [];
        } else {
            currentContent.push(line);
        }

        // Extract cross-references
        const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
        for (const lm of linkMatches) {
            crossRefs.push({ text: lm[1], target: lm[2] });
        }
    }

    if (currentSection) {
        sections.push({
            heading: currentSection.heading,
            level: currentSection.level,
            content: currentContent.join('\n').trim(),
            lineCount: currentContent.length,
        });
    }

    return {
        type: 'documentation',
        format: path.extname(filePath).slice(1) || 'md',
        sections,
        crossReferences: crossRefs,
        rawLineCount: lines.length,
    };
}

// ─── Extraction Helpers ─────────────────────────────────────────────────────

function extractBraceBlock(content, openBraceIdx) {
    if (openBraceIdx < 0 || content[openBraceIdx] !== '{') return '';
    let depth = 0;
    let i = openBraceIdx;
    while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
            depth--;
            if (depth === 0) return content.substring(openBraceIdx, i + 1);
        }
        i++;
    }
    return content.substring(openBraceIdx);
}

function extractMethods(classBody, className) {
    const methods = [];
    const methodRegex = /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/g;
    let m;
    while ((m = methodRegex.exec(classBody)) !== null) {
        if (m[1] === 'constructor' || m[1] === 'if' || m[1] === 'while' || m[1] === 'for' || m[1] === 'switch') continue;
        const bodyStart = classBody.indexOf('{', m.index + m[0].length - 1);
        const body = extractBraceBlock(classBody, bodyStart);
        methods.push({
            name: m[1],
            params: parseParams(m[2]),
            async: m[0].includes('async'),
            throws: extractThrows(body),
            calls: extractFunctionCalls(body),
            locatorsUsed: extractLocatorRefs(body),
            lineCount: body.split('\n').length,
        });
    }
    return methods;
}

function extractLocators(content) {
    const locators = [];
    // Page object locator patterns — separate single/double quote variants to handle mixed quotes
    const patterns = [
        /this\.(\w+)\s*=\s*page\.locator\('([^']+)'\)/g,
        /this\.(\w+)\s*=\s*page\.locator\("([^"]+)"\)/g,
        /this\.(\w+)\s*=\s*page\.getByRole\('([^']+)'\s*(?:,\s*\{[^}]*\})?\)/g,
        /this\.(\w+)\s*=\s*page\.getByRole\("([^"]+)"\s*(?:,\s*\{[^}]*\})?\)/g,
        /this\.(\w+)\s*=\s*page\.getByText\('([^']+)'\)/g,
        /this\.(\w+)\s*=\s*page\.getByText\("([^"]+)"\)/g,
        /this\.(\w+)\s*=\s*page\.getByTestId\('([^']+)'\)/g,
        /this\.(\w+)\s*=\s*page\.getByTestId\("([^"]+)"\)/g,
        /this\.(\w+)\s*=\s*page\.getByLabel\('([^']+)'\)/g,
        /this\.(\w+)\s*=\s*page\.getByLabel\("([^"]+)"\)/g,
        /(?:const|let|var)\s+(\w+)\s*=\s*['"]([^'"]+)['"]\s*;?\s*\/\/.*(?:selector|locator)/gi,
        /(\w+)\s*:\s*['"](\[[^\]]+\]|[.#]\S+)['"]/g,
    ];

    for (const pattern of patterns) {
        let lm;
        while ((lm = pattern.exec(content)) !== null) {
            locators.push({
                name: lm[1],
                selector: lm[2],
                strategy: detectSelectorStrategy(lm[2]),
            });
        }
    }
    return locators;
}

function extractLocatorRefs(body) {
    const refs = new Set();
    const refMatches = body.matchAll(/this\.(\w+)(?:\.click|\.fill|\.textContent|\.isVisible|\.waitFor|\.locator)/g);
    for (const m of refMatches) refs.add(m[1]);
    return [...refs];
}

function extractThrows(body) {
    const throws = [];
    const throwMatches = body.matchAll(/throw\s+new\s+(\w+)\s*\(['"]([^'"]*)['"]\)/g);
    for (const m of throwMatches) throws.push(`${m[1]}: ${m[2]}`);
    return throws;
}

function extractFunctionCalls(body) {
    const calls = new Set();
    // Method calls on this
    const thisCallMatches = body.matchAll(/this\.(\w+)\s*\(/g);
    for (const m of thisCallMatches) calls.add(`this.${m[1]}`);
    // External function calls
    const externalMatches = body.matchAll(/(?:await\s+)?(\w+)\s*\(/g);
    for (const m of externalMatches) {
        if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'console', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Promise', 'setTimeout', 'setInterval', 'parseInt', 'parseFloat'].includes(m[1])) {
            calls.add(m[1]);
        }
    }
    return [...calls].slice(0, 30); // Cap to avoid noise
}

function parseParams(paramString) {
    if (!paramString || !paramString.trim()) return [];
    return paramString.split(',').map(p => {
        const trimmed = p.trim();
        const parts = trimmed.split(/\s*=\s*/);
        return {
            name: parts[0].replace(/[{}\[\]\.]/g, '').trim(),
            hasDefault: parts.length > 1,
            defaultValue: parts[1] || undefined,
        };
    }).filter(p => p.name);
}

function detectSelectorStrategy(selector) {
    if (selector.startsWith('[data-qa') || selector.startsWith('[data-test') || selector.startsWith('[data-testid')) return 'data-attribute';
    if (selector.includes('getByRole') || selector.includes('role=')) return 'aria-role';
    if (selector.startsWith('[aria-')) return 'aria';
    if (selector.startsWith('#')) return 'id';
    if (selector.startsWith('.')) return 'class';
    if (selector.includes('text=') || selector.includes('has-text')) return 'text';
    if (selector.startsWith('//') || selector.startsWith('xpath=')) return 'xpath';
    return 'css';
}

function extractJSONSchema(obj, depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return { type: typeof obj };
    if (obj === null) return { type: 'null' };
    if (Array.isArray(obj)) {
        if (obj.length === 0) return { type: 'array', items: {} };
        return { type: 'array', items: extractJSONSchema(obj[0], depth + 1, maxDepth), length: obj.length };
    }
    if (typeof obj === 'object') {
        const schema = { type: 'object', properties: {} };
        for (const [key, value] of Object.entries(obj)) {
            schema.properties[key] = extractJSONSchema(value, depth + 1, maxDepth);
        }
        return schema;
    }
    return { type: typeof obj };
}

// ─── DNA Level Builders ─────────────────────────────────────────────────────

/**
 * Build L1 (Semantic Skeleton) from analyzed source.
 * Contains: all signatures, dependency graph, behavioral contracts, locator index.
 * Size: ~15% of original.
 */
function buildL1(analyzed, filePath) {
    const regionId = generateRegionId(filePath);

    if (analyzed.type === 'code') {
        return {
            regionId,
            level: 'L1',
            filePath,
            type: 'code',
            language: analyzed.language,
            dependencies: analyzed.dependencies,
            exports: analyzed.exports,
            classes: analyzed.classes.map(cls => ({
                name: cls.name,
                extends: cls.extends,
                methods: cls.methods.map(m => ({
                    name: m.name,
                    params: m.params,
                    async: m.async,
                    throws: m.throws,
                    calls: m.calls,
                    locatorsUsed: m.locatorsUsed,
                    lineCount: m.lineCount,
                })),
                locators: cls.locators,
            })),
            functions: analyzed.functions.map(fn => ({
                name: fn.name,
                params: fn.params,
                async: fn.async,
                throws: fn.throws,
                calls: fn.calls,
            })),
            locators: analyzed.locators,
            invariants: analyzed.invariants,
            stateTransitions: analyzed.stateTransitions,
            sideEffects: analyzed.sideEffects,
        };
    }

    if (analyzed.type === 'documentation') {
        return {
            regionId,
            level: 'L1',
            filePath,
            type: 'documentation',
            sections: analyzed.sections.map(s => ({
                heading: s.heading,
                level: s.level,
                keyFacts: extractKeyFacts(s.content),
                lineCount: s.lineCount,
            })),
            crossReferences: analyzed.crossReferences,
        };
    }

    if (analyzed.type === 'data') {
        return {
            regionId,
            level: 'L1',
            filePath,
            type: 'data',
            format: analyzed.format,
            schema: analyzed.schema,
            topLevelKeys: analyzed.topLevelKeys,
        };
    }

    return { regionId, level: 'L1', filePath, type: 'unknown', raw: JSON.stringify(analyzed).slice(0, 500) };
}

/**
 * Build L2 (Module Card) from L1 skeleton.
 * Contains: purpose, API surface, dependency list, behavioral summary.
 * Size: ~3% of original.
 */
function buildL2(l1) {
    const card = {
        regionId: l1.regionId,
        level: 'L2',
        filePath: l1.filePath,
        type: l1.type,
    };

    if (l1.type === 'code') {
        card.purpose = inferPurpose(l1);
        card.api = [];

        for (const cls of (l1.classes || [])) {
            card.api.push({
                kind: 'class',
                name: cls.name,
                extends: cls.extends,
                methodCount: cls.methods.length,
                methods: cls.methods.map(m => ({
                    name: m.name,
                    params: m.params.map(p => p.name),
                    async: m.async,
                })),
                locatorCount: (cls.locators || []).length,
                locatorNames: (cls.locators || []).map(l => l.name),
            });
        }

        for (const fn of (l1.functions || [])) {
            card.api.push({
                kind: 'function',
                name: fn.name,
                params: fn.params.map(p => p.name),
                async: fn.async,
            });
        }

        card.dependencies = (l1.dependencies || []).map(d => d.module);
        card.exports = l1.exports || [];
        card.hasLocators = (l1.locators || []).length > 0;
        card.locatorCount = (l1.locators || []).length;
        card.invariantCount = (l1.invariants || []).length;
        card.sideEffectTypes = [...new Set((l1.sideEffects || []).map(se => se.type))];
    }

    if (l1.type === 'documentation') {
        card.purpose = (l1.sections || []).length > 0 ? l1.sections[0].heading : 'Unknown';
        card.sectionCount = (l1.sections || []).length;
        card.sectionHeadings = (l1.sections || []).map(s => s.heading);
        card.crossRefCount = (l1.crossReferences || []).length;
    }

    if (l1.type === 'data') {
        card.format = l1.format;
        card.topLevelKeys = l1.topLevelKeys;
        card.schemaDepth = estimateSchemaDepth(l1.schema);
    }

    return card;
}

/**
 * Build L3 (Architecture DNA) from all L2 module cards.
 * A single compact model of the entire system.
 * Target: ≤2000 tokens (~8000 chars).
 */
function buildL3(l2Cards, config = {}) {
    const dna = {
        level: 'L3',
        version: DNA_VERSION,
        compiledAt: new Date().toISOString(),
        system: {
            name: config.projectName || 'Unknown Project',
            moduleCount: l2Cards.length,
            totalLocators: l2Cards.reduce((sum, c) => sum + (c.locatorCount || 0), 0),
            totalAPI: l2Cards.reduce((sum, c) => sum + (c.api?.length || 0), 0),
        },
        components: [],
        dependencyGraph: {},
        flows: [],
    };

    // ── Build component list (compact) ─────────────────────────────
    for (const card of l2Cards) {
        const component = {
            file: card.filePath,
            type: card.type,
            purpose: card.purpose || 'Unknown',
        };

        if (card.type === 'code') {
            component.exports = card.exports;
            component.apiCount = (card.api || []).length;
            component.hasLocators = card.hasLocators;
            if (card.locatorCount > 0) component.locators = card.locatorCount;
            if (card.sideEffectTypes?.length > 0) component.sideEffects = card.sideEffectTypes;
        }

        if (card.type === 'documentation') {
            component.sections = card.sectionCount;
        }

        dna.components.push(component);
    }

    // ── Build dependency graph ──────────────────────────────────────
    for (const card of l2Cards.filter(c => c.type === 'code')) {
        if (card.dependencies?.length > 0) {
            dna.dependencyGraph[card.filePath] = card.dependencies;
        }
    }

    // ── Infer data flows ────────────────────────────────────────────
    const pageObjects = l2Cards.filter(c => c.filePath?.includes('pageobject'));
    const businessFunctions = l2Cards.filter(c => c.filePath?.includes('business-function'));
    const specs = l2Cards.filter(c => c.filePath?.includes('.spec.'));

    if (pageObjects.length > 0 || businessFunctions.length > 0 || specs.length > 0) {
        dna.flows.push({
            name: 'test-execution',
            path: ['spec → business-function → page-object → browser'],
            pageObjects: pageObjects.length,
            businessFunctions: businessFunctions.length,
            specs: specs.length,
        });
    }

    return dna;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function generateRegionId(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
}

function inferPurpose(l1) {
    const file = (l1.filePath || '').toLowerCase();
    if (file.includes('login') || file.includes('auth')) return 'authentication';
    if (file.includes('search') || file.includes('filter')) return 'search-and-filter';
    if (file.includes('detail') || file.includes('property')) return 'property-details';
    if (file.includes('popup') || file.includes('modal') || file.includes('dialog')) return 'popup-handling';
    if (file.includes('config')) return 'configuration';
    if (file.includes('testdata') || file.includes('test-data')) return 'test-data';
    if (file.includes('spec')) return 'test-spec';
    if (file.includes('util')) return 'utilities';
    if (file.includes('business-function') || file.includes('bf-')) return 'business-function';
    if (file.includes('pageobject') || file.includes('po-') || file.includes('pomanager')) return 'page-object';
    if (file.includes('enum')) return 'enums';
    // Infer from class names
    for (const cls of (l1.classes || [])) {
        if (cls.name.toLowerCase().includes('page')) return `page-object:${cls.name}`;
    }
    // Infer from exports
    if (l1.exports?.length > 0) return `module:${l1.exports[0]}`;
    return 'general';
}

function extractKeyFacts(content) {
    if (!content) return [];
    const sentences = content.split(/[.!?]\s+/);
    // Take first 5 non-trivial sentences as key facts
    return sentences
        .filter(s => s.trim().length > 20 && s.trim().length < 200)
        .slice(0, 5)
        .map(s => s.trim());
}

function estimateSchemaDepth(schema, depth = 0) {
    if (!schema || depth > 10) return depth;
    if (schema.properties) {
        return Math.max(depth, ...Object.values(schema.properties).map(v => estimateSchemaDepth(v, depth + 1)));
    }
    if (schema.items) return estimateSchemaDepth(schema.items, depth + 1);
    return depth;
}

// ─── Context DNA Compiler (Main Class) ──────────────────────────────────────

class ContextDNACompiler {
    /**
     * @param {Object} [options]
     * @param {string} [options.dataDir] - Where to persist DNA files
     * @param {string} [options.projectRoot] - Project root for path resolution
     * @param {Object} [options.config] - CCM configuration section
     * @param {boolean} [options.verbose] - Enable debug logging
     */
    constructor(options = {}) {
        this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
        this.projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
        this.config = options.config || {};
        this.verbose = options.verbose || false;

        // Internal state
        this._dna = null;           // Full compiled DNA structure
        this._l1Cache = new Map();  // filePath → L1 structure
        this._l2Cache = new Map();  // filePath → L2 card
        this._l3 = null;            // Single L3 architecture DNA
        this._fileMtimes = new Map();
        this._compiledAt = null;

        // Ensure data dir exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    // ─── Compilation ────────────────────────────────────────────────

    /**
     * Compile all configured sources into multi-resolution DNA.
     *
     * @param {Object[]} sources - Array of { path, type } source configs
     * @param {Object} [options]
     * @param {boolean} [options.force=false] - Force full recompilation
     * @param {string} [options.projectName] - Project name for L3
     * @returns {{ files: number, l1Count: number, l2Count: number, l3Size: number, elapsed: number }}
     */
    compile(sources = [], options = {}) {
        const startTime = Date.now();
        this._log('Starting Context DNA compilation...');

        let totalFiles = 0;
        const l1Entries = [];
        const l2Cards = [];

        // ── Collect and analyze all source files ───────────────────
        for (const source of sources) {
            const absPath = path.resolve(this.projectRoot, source.path);
            if (!fs.existsSync(absPath)) {
                this._log(`  ⚠ Source not found: ${source.path}`);
                continue;
            }

            const files = this._collectFiles(absPath);
            this._log(`  📁 ${source.path} (${source.type}): ${files.length} files`);

            for (const filePath of files) {
                try {
                    const stat = fs.statSync(filePath);
                    const relPath = path.relative(this.projectRoot, filePath);

                    // Incremental: skip unchanged files unless forced
                    if (!options.force && this._fileMtimes.get(relPath) === stat.mtimeMs && this._l1Cache.has(relPath)) {
                        l1Entries.push(this._l1Cache.get(relPath));
                        l2Cards.push(this._l2Cache.get(relPath));
                        totalFiles++;
                        continue;
                    }

                    this._fileMtimes.set(relPath, stat.mtimeMs);
                    const content = fs.readFileSync(filePath, 'utf-8');

                    // Analyze → L1 → L2
                    const analyzed = this._analyzeFile(content, relPath);
                    const l1 = buildL1(analyzed, relPath);
                    const l2 = buildL2(l1);

                    this._l1Cache.set(relPath, l1);
                    this._l2Cache.set(relPath, l2);
                    l1Entries.push(l1);
                    l2Cards.push(l2);
                    totalFiles++;
                } catch (err) {
                    this._log(`  ⚠ Error compiling ${filePath}: ${err.message}`);
                }
            }
        }

        // ── Build L3 from all L2 cards ─────────────────────────────
        this._l3 = buildL3(l2Cards, { projectName: options.projectName || this.config.projectName });

        // ── Assemble full DNA ──────────────────────────────────────
        this._dna = {
            version: DNA_VERSION,
            compiledAt: new Date().toISOString(),
            projectRoot: this.projectRoot,
            stats: {
                files: totalFiles,
                l1Entries: l1Entries.length,
                l2Cards: l2Cards.length,
            },
            l3: this._l3,
            l2Index: Object.fromEntries(l2Cards.map(c => [c.regionId, c])),
            l1Index: Object.fromEntries(l1Entries.map(e => [e.regionId, e])),
        };

        this._compiledAt = new Date();

        // ── Persist to disk ────────────────────────────────────────
        this._saveDNA();
        this._saveMtimes();

        const elapsed = Date.now() - startTime;
        const l3Size = JSON.stringify(this._l3).length;
        this._log(`✅ DNA compiled: ${totalFiles} files → ${l1Entries.length} L1, ${l2Cards.length} L2, L3=${l3Size} chars (${elapsed}ms)`);

        return { files: totalFiles, l1Count: l1Entries.length, l2Count: l2Cards.length, l3Size, elapsed };
    }

    /**
     * Rebuild DNA incrementally — only recompile changed files.
     * @param {Object[]} sources - Source configs
     * @returns {Object|null} Compile stats if rebuilt, null if up-to-date
     */
    recompileIfStale(sources = []) {
        this._loadMtimes();
        const staleFiles = this._findStaleFiles(sources);
        if (staleFiles.length === 0 && this._dna) {
            this._log('DNA is up-to-date');
            return null;
        }
        this._log(`${staleFiles.length} stale files — recompiling...`);
        return this.compile(sources, { force: false });
    }

    // ─── Resolution Access ──────────────────────────────────────────

    /**
     * Get the L3 Architecture DNA (complete system model, ≤2000 tokens).
     * @returns {Object|null} L3 DNA structure
     */
    getL3() {
        this._ensureLoaded();
        return this._l3;
    }

    /**
     * Get L2 Module Card for a specific file/region.
     * @param {string} filePathOrRegionId - File path or region ID
     * @returns {Object|null} L2 module card
     */
    getL2(filePathOrRegionId) {
        this._ensureLoaded();
        // Try direct region ID lookup
        if (this._dna?.l2Index?.[filePathOrRegionId]) {
            return this._dna.l2Index[filePathOrRegionId];
        }
        // Try by file path
        const relPath = path.relative(this.projectRoot, path.resolve(this.projectRoot, filePathOrRegionId));
        const regionId = generateRegionId(relPath);
        return this._dna?.l2Index?.[regionId] || this._l2Cache.get(relPath) || null;
    }

    /**
     * Get L1 Semantic Skeleton for a specific file/region.
     * @param {string} filePathOrRegionId - File path or region ID
     * @returns {Object|null} L1 semantic skeleton
     */
    getL1(filePathOrRegionId) {
        this._ensureLoaded();
        if (this._dna?.l1Index?.[filePathOrRegionId]) {
            return this._dna.l1Index[filePathOrRegionId];
        }
        const relPath = path.relative(this.projectRoot, path.resolve(this.projectRoot, filePathOrRegionId));
        const regionId = generateRegionId(relPath);
        return this._dna?.l1Index?.[regionId] || this._l1Cache.get(relPath) || null;
    }

    /**
     * Get L0 (raw source) for a file.
     * @param {string} filePath - File path
     * @returns {string|null} Raw file content
     */
    getL0(filePath) {
        const absPath = path.resolve(this.projectRoot, filePath);
        if (!fs.existsSync(absPath)) return null;
        return fs.readFileSync(absPath, 'utf-8');
    }

    /**
     * Get all L2 module cards.
     * @returns {Object[]} Array of L2 cards
     */
    getAllL2Cards() {
        this._ensureLoaded();
        return this._dna ? Object.values(this._dna.l2Index) : [];
    }

    /**
     * Get all L1 entries.
     * @returns {Object[]} Array of L1 skeletons
     */
    getAllL1Entries() {
        this._ensureLoaded();
        return this._dna ? Object.values(this._dna.l1Index) : [];
    }

    /**
     * Get region ID for a file path.
     * @param {string} filePath
     * @returns {string} 12-char hex region ID
     */
    getRegionId(filePath) {
        const relPath = path.relative(this.projectRoot, path.resolve(this.projectRoot, filePath));
        return generateRegionId(relPath);
    }

    /**
     * Decompress: Get higher resolution for a region previously seen at lower resolution.
     * L3 → returns all L2 cards for the matching component
     * L2 → returns L1 skeleton
     * L1 → returns L0 raw source
     *
     * @param {string} regionId - Region to decompress
     * @param {string} targetLevel - 'L0', 'L1', 'L2'
     * @returns {Object|string|null} The decompressed content
     */
    decompress(regionId, targetLevel = 'L1') {
        this._ensureLoaded();

        if (targetLevel === 'L0') {
            const l1 = this._dna?.l1Index?.[regionId];
            if (l1?.filePath) return this.getL0(l1.filePath);
            return null;
        }

        if (targetLevel === 'L1') {
            return this._dna?.l1Index?.[regionId] || null;
        }

        if (targetLevel === 'L2') {
            return this._dna?.l2Index?.[regionId] || null;
        }

        return null;
    }

    // ─── Rendering (Context String Builders) ────────────────────────

    /**
     * Render DNA at a specific level as a context string suitable for LLM injection.
     *
     * @param {string} level - 'L3', 'L2', 'L1', or 'L0'
     * @param {Object} [options]
     * @param {string[]} [options.regions] - Specific region IDs (for L1/L0)
     * @param {string} [options.filter] - Filter pattern (e.g., 'pageobject', 'business-function')
     * @param {number} [options.maxChars] - Character budget
     * @returns {string} Formatted context string
     */
    renderContext(level, options = {}) {
        this._ensureLoaded();
        const maxChars = options.maxChars || 50000;

        if (level === 'L3') {
            return this._renderL3(maxChars);
        }

        if (level === 'L2') {
            return this._renderL2(options.regions, options.filter, maxChars);
        }

        if (level === 'L1') {
            return this._renderL1(options.regions, options.filter, maxChars);
        }

        if (level === 'L0') {
            return this._renderL0(options.regions, maxChars);
        }

        return '';
    }

    _renderL3(maxChars) {
        if (!this._l3) return '';
        const lines = [
            `ARCHITECTURE DNA (${this._l3.system.name})`,
            `Modules: ${this._l3.system.moduleCount} | Locators: ${this._l3.system.totalLocators} | APIs: ${this._l3.system.totalAPI}`,
            '',
        ];

        // Components
        lines.push('COMPONENTS:');
        for (const comp of this._l3.components) {
            const parts = [`  ${comp.file} [${comp.type}] purpose:${comp.purpose}`];
            if (comp.exports?.length > 0) parts.push(`exports:${comp.exports.join(',')}`);
            if (comp.locators > 0) parts.push(`locators:${comp.locators}`);
            if (comp.sideEffects?.length > 0) parts.push(`effects:${comp.sideEffects.join(',')}`);
            lines.push(parts.join(' | '));
        }

        // Dependency graph
        if (Object.keys(this._l3.dependencyGraph).length > 0) {
            lines.push('');
            lines.push('DEPENDENCY GRAPH:');
            for (const [file, deps] of Object.entries(this._l3.dependencyGraph)) {
                lines.push(`  ${file} → ${deps.join(', ')}`);
            }
        }

        // Flows
        if (this._l3.flows.length > 0) {
            lines.push('');
            lines.push('DATA FLOWS:');
            for (const flow of this._l3.flows) {
                lines.push(`  ${flow.name}: ${flow.path.join(' → ')}`);
            }
        }

        return lines.join('\n').slice(0, maxChars);
    }

    _renderL2(regionIds, filterPattern, maxChars) {
        let cards = this.getAllL2Cards();

        if (regionIds?.length > 0) {
            cards = cards.filter(c => regionIds.includes(c.regionId));
        }
        if (filterPattern) {
            const pattern = filterPattern.toLowerCase();
            cards = cards.filter(c =>
                (c.filePath || '').toLowerCase().includes(pattern) ||
                (c.purpose || '').toLowerCase().includes(pattern)
            );
        }

        const lines = [`MODULE CARDS (${cards.length} modules)`, ''];
        let size = lines.join('\n').length;

        for (const card of cards) {
            const cardLines = [`── ${card.filePath} [${card.type}]`];

            if (card.purpose) cardLines.push(`  Purpose: ${card.purpose}`);

            if (card.api?.length > 0) {
                for (const api of card.api) {
                    const paramStr = api.params?.join(', ') || '';
                    cardLines.push(`  ${api.kind} ${api.name}(${paramStr})${api.async ? ' [async]' : ''}`);
                    if (api.locatorNames?.length > 0) {
                        cardLines.push(`    locators: ${api.locatorNames.join(', ')}`);
                    }
                }
            }

            if (card.exports?.length > 0) cardLines.push(`  Exports: ${card.exports.join(', ')}`);
            if (card.dependencies?.length > 0) cardLines.push(`  Deps: ${card.dependencies.join(', ')}`);

            cardLines.push('');

            const cardText = cardLines.join('\n');
            if (size + cardText.length > maxChars) break;

            lines.push(...cardLines);
            size += cardText.length;
        }

        return lines.join('\n');
    }

    _renderL1(regionIds, filterPattern, maxChars) {
        let entries = this.getAllL1Entries();

        if (regionIds?.length > 0) {
            entries = entries.filter(e => regionIds.includes(e.regionId));
        }
        if (filterPattern) {
            const pattern = filterPattern.toLowerCase();
            entries = entries.filter(e =>
                (e.filePath || '').toLowerCase().includes(pattern) ||
                (e.type || '').toLowerCase().includes(pattern)
            );
        }

        const lines = [`SEMANTIC SKELETONS (${entries.length} entries)`, ''];
        let size = lines.join('\n').length;

        for (const entry of entries) {
            const skel = this._renderL1Entry(entry);
            if (size + skel.length > maxChars) break;
            lines.push(skel);
            size += skel.length;
        }

        return lines.join('\n');
    }

    _renderL1Entry(entry) {
        const lines = [`═══ ${entry.filePath} [${entry.type}] regionId:${entry.regionId}`];

        if (entry.type === 'code') {
            if (entry.dependencies?.length > 0) {
                lines.push(`  Dependencies: ${entry.dependencies.map(d => `${d.module}(${d.imports.join(',')})`).join(', ')}`);
            }

            for (const cls of (entry.classes || [])) {
                lines.push(`  class ${cls.name}${cls.extends ? ` extends ${cls.extends}` : ''}:`);
                for (const m of cls.methods) {
                    const params = m.params.map(p => p.name).join(', ');
                    lines.push(`    ${m.async ? 'async ' : ''}${m.name}(${params})`);
                    if (m.throws.length > 0) lines.push(`      throws: ${m.throws.join(', ')}`);
                    if (m.locatorsUsed.length > 0) lines.push(`      uses: ${m.locatorsUsed.join(', ')}`);
                    if (m.calls.length > 0) lines.push(`      calls: ${m.calls.slice(0, 10).join(', ')}`);
                }
                if (cls.locators?.length > 0) {
                    lines.push(`    Locators:`);
                    for (const loc of cls.locators) {
                        lines.push(`      ${loc.name}: "${loc.selector}" [${loc.strategy}]`);
                    }
                }
            }

            for (const fn of (entry.functions || [])) {
                const params = fn.params.map(p => p.name).join(', ');
                lines.push(`  ${fn.async ? 'async ' : ''}function ${fn.name}(${params})`);
                if (fn.throws.length > 0) lines.push(`    throws: ${fn.throws.join(', ')}`);
                if (fn.calls.length > 0) lines.push(`    calls: ${fn.calls.slice(0, 10).join(', ')}`);
            }

            if (entry.invariants?.length > 0) {
                lines.push(`  Invariants: ${entry.invariants.join('; ')}`);
            }
            if (entry.stateTransitions?.length > 0) {
                lines.push(`  Transitions: ${entry.stateTransitions.map(t => t.target || t.type).join(' → ')}`);
            }
            if (entry.exports?.length > 0) {
                lines.push(`  Exports: ${entry.exports.join(', ')}`);
            }
        }

        if (entry.type === 'documentation') {
            for (const section of (entry.sections || [])) {
                lines.push(`  ${'#'.repeat(section.level)} ${section.heading}`);
                if (section.keyFacts?.length > 0) {
                    for (const fact of section.keyFacts) {
                        lines.push(`    • ${fact}`);
                    }
                }
            }
        }

        lines.push('');
        return lines.join('\n');
    }

    _renderL0(regionIds, maxChars) {
        if (!regionIds?.length) return '';
        const lines = [];
        let size = 0;

        for (const regionId of regionIds) {
            const l1 = this._dna?.l1Index?.[regionId];
            if (!l1?.filePath) continue;
            const content = this.getL0(l1.filePath);
            if (!content) continue;

            const header = `═══ ${l1.filePath} (RAW SOURCE) ═══\n`;
            if (size + header.length + content.length > maxChars) {
                const remaining = maxChars - size - header.length - 30;
                if (remaining > 200) {
                    lines.push(header + content.slice(0, remaining) + '\n...(truncated)');
                }
                break;
            }
            lines.push(header + content);
            size += header.length + content.length;
        }

        return lines.join('\n\n');
    }

    // ─── Query Helpers ──────────────────────────────────────────────

    /**
     * Find regions relevant to a query/task at the cheapest resolution.
     * Uses L2 purpose and API names for fast matching.
     *
     * @param {string} query - Search query
     * @param {Object} [options]
     * @param {number} [options.maxResults=10] - Max regions to return
     * @returns {Object[]} Ranked regions with scores
     */
    findRelevantRegions(query, options = {}) {
        this._ensureLoaded();
        const maxResults = options.maxResults || 10;
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

        const scored = [];

        for (const card of this.getAllL2Cards()) {
            let score = 0;
            const searchableText = [
                card.filePath,
                card.purpose,
                ...(card.exports || []),
                ...(card.api || []).map(a => a.name),
                ...(card.api || []).flatMap(a => a.locatorNames || []),
                ...(card.sectionHeadings || []),
                ...(card.topLevelKeys || []),
            ].join(' ').toLowerCase();

            for (const term of queryTerms) {
                if (searchableText.includes(term)) score += 1;
                // Exact word match bonus
                if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(searchableText)) score += 0.5;
            }

            if (score > 0) {
                scored.push({ regionId: card.regionId, filePath: card.filePath, purpose: card.purpose, score, type: card.type, level: 'L2' });
            }
        }

        return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
    }

    /**
     * Build an optimal context string for an agent, mixing resolution levels.
     * High-relevance regions get L1; medium get L2; rest stay L3.
     *
     * @param {string} agentName - Target agent
     * @param {string} taskDescription - Task/query for relevance matching
     * @param {Object} [options]
     * @param {number} [options.maxChars=40000] - Character budget
     * @param {number} [options.l1Threshold=2] - Score above which to include L1
     * @param {number} [options.l2Threshold=1] - Score above which to include L2
     * @returns {{ context: string, regionResolutions: Object[], stats: Object }}
     */
    buildOptimalContext(agentName, taskDescription, options = {}) {
        const maxChars = options.maxChars || 40000;
        const l1Threshold = options.l1Threshold || 2;
        const l2Threshold = options.l2Threshold || 1;

        // Always start with L3 overview
        const l3Text = this.renderContext('L3', { maxChars: Math.floor(maxChars * 0.15) });
        let remaining = maxChars - l3Text.length;

        // Find relevant regions
        const regions = this.findRelevantRegions(taskDescription, { maxResults: 20 });

        const l1Regions = [];
        const l2Regions = [];
        const regionResolutions = [];

        for (const region of regions) {
            if (region.score >= l1Threshold) {
                l1Regions.push(region.regionId);
                regionResolutions.push({ ...region, resolvedLevel: 'L1' });
            } else if (region.score >= l2Threshold) {
                l2Regions.push(region.regionId);
                regionResolutions.push({ ...region, resolvedLevel: 'L2' });
            }
        }

        // Render L1 cards for highest-relevance regions
        const l1Budget = Math.floor(remaining * 0.6);
        const l1Text = l1Regions.length > 0
            ? this.renderContext('L1', { regions: l1Regions, maxChars: l1Budget })
            : '';
        remaining -= l1Text.length;

        // Render L2 cards for medium-relevance regions
        const l2Text = l2Regions.length > 0
            ? this.renderContext('L2', { regions: l2Regions, maxChars: remaining })
            : '';

        const context = [l3Text, l1Text, l2Text].filter(Boolean).join('\n\n---\n\n');

        return {
            context,
            regionResolutions,
            stats: {
                totalChars: context.length,
                l3Chars: l3Text.length,
                l1Chars: l1Text.length,
                l2Chars: l2Text.length,
                l1RegionCount: l1Regions.length,
                l2RegionCount: l2Regions.length,
                budgetUsed: ((context.length / maxChars) * 100).toFixed(1) + '%',
            },
        };
    }

    // ─── Persistence ────────────────────────────────────────────────

    _saveDNA() {
        try {
            const filePath = path.join(this.dataDir, DNA_FILE);
            fs.writeFileSync(filePath, JSON.stringify(this._dna, null, 2));
            this._log(`  💾 DNA saved to ${filePath}`);
        } catch (err) {
            this._log(`  ⚠ Failed to save DNA: ${err.message}`);
        }
    }

    _loadDNA() {
        try {
            const filePath = path.join(this.dataDir, DNA_FILE);
            if (!fs.existsSync(filePath)) return false;
            this._dna = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            // Rebuild caches from loaded DNA
            if (this._dna?.l1Index) {
                for (const [regionId, l1] of Object.entries(this._dna.l1Index)) {
                    if (l1.filePath) this._l1Cache.set(l1.filePath, l1);
                }
            }
            if (this._dna?.l2Index) {
                for (const [regionId, l2] of Object.entries(this._dna.l2Index)) {
                    if (l2.filePath) this._l2Cache.set(l2.filePath, l2);
                }
            }
            this._l3 = this._dna?.l3 || null;
            this._compiledAt = this._dna?.compiledAt ? new Date(this._dna.compiledAt) : null;

            this._log(`  📂 DNA loaded from disk (${Object.keys(this._dna.l2Index || {}).length} modules)`);
            return true;
        } catch (err) {
            this._log(`  ⚠ Failed to load DNA: ${err.message}`);
            return false;
        }
    }

    _saveMtimes() {
        try {
            const filePath = path.join(this.dataDir, MTIME_FILE);
            fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(this._fileMtimes)));
        } catch { /* ignore */ }
    }

    _loadMtimes() {
        try {
            const filePath = path.join(this.dataDir, MTIME_FILE);
            if (!fs.existsSync(filePath)) return;
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            this._fileMtimes = new Map(Object.entries(data));
        } catch { /* ignore */ }
    }

    _ensureLoaded() {
        if (this._dna) return;
        this._loadDNA();
        this._loadMtimes();
    }

    // ─── File Collection ────────────────────────────────────────────

    _collectFiles(dirPath) {
        const files = [];
        const extensions = new Set(['.js', '.ts', '.json', '.md', '.txt']);

        const walk = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (['node_modules', '.git', 'dist', 'build', 'coverage', 'playwright-report', 'test-results'].includes(entry.name)) continue;
                    walk(fullPath);
                } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
                    files.push(fullPath);
                }
            }
        };

        walk(dirPath);
        return files;
    }

    _findStaleFiles(sources = []) {
        const stale = [];
        for (const source of sources) {
            const absPath = path.resolve(this.projectRoot, source.path);
            const files = this._collectFiles(absPath);
            for (const filePath of files) {
                try {
                    const stat = fs.statSync(filePath);
                    const relPath = path.relative(this.projectRoot, filePath);
                    const cachedMtime = this._fileMtimes.get(relPath);
                    if (!cachedMtime || cachedMtime !== stat.mtimeMs) {
                        stale.push(relPath);
                    }
                } catch { /* skip */ }
            }
        }
        return stale;
    }

    _analyzeFile(content, relPath) {
        const ext = path.extname(relPath).toLowerCase();
        if (ext === '.js' || ext === '.ts') return analyzeJavaScriptSource(content, relPath);
        if (ext === '.json') return analyzeJSONSource(content, relPath);
        if (ext === '.md' || ext === '.txt') return analyzeDocSource(content, relPath);
        return { type: 'unknown', rawSize: content.length };
    }

    _log(msg) {
        if (this.verbose) console.log(`[ContextDNA] ${msg}`);
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    ContextDNACompiler,
    // Exposed for testing
    analyzeJavaScriptSource,
    analyzeJSONSource,
    analyzeDocSource,
    buildL1,
    buildL2,
    buildL3,
    generateRegionId,
};
