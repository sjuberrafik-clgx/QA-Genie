/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROVENANCE SYSTEM — Assertion Extraction, Tagging, and Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Every factual claim in LLM output gets traced back to its source context.
 * The system answers: "WHERE did the LLM learn this? HOW confident are we?"
 *
 * Three components:
 *   1. AssertionExtractor — Pulls factual claims from generated .spec.js code
 *   2. ProvenanceTagger — Tags each assertion with its DNA source chain
 *   3. ProvenanceVerifier — Cross-checks tagged assertions against live state
 *
 * This enables the output confidence rendering:
 *   ✅ VERIFIED  — Selector from L0 source, validated by snapshot
 *   ⚠️ INFERRED  — Derived from L2 card, plausible but unverified
 *   ❌ UNGROUNDED — No source found, likely hallucinated
 *
 * Zero LLM cost — 100% deterministic JavaScript.
 *
 * @module ccm/provenance
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { CONFIDENCE_LEVELS } = require('./coverage-map');

// ─── Assertion Types ────────────────────────────────────────────────────────

const ASSERTION_TYPES = {
    SELECTOR: 'selector',       // page.locator('.class'), getByRole('button')
    URL: 'url',                 // expect(page).toHaveURL(...)
    TEXT: 'text',               // expect(el).toContainText(...)
    IMPORT: 'import',           // require('../../pageobjects/...')
    METHOD_CALL: 'method_call', // poManager.getLoginPage()
    API_PATTERN: 'api_pattern', // waitForResponse, page.route
    NAVIGATION: 'navigation',   // page.goto(), navigate
    CONFIG: 'config',           // baseUrl, userTokens, credentials
};


// ═══════════════════════════════════════════════════════════════════════════════
// ASSERTION EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════════

class AssertionExtractor {
    /**
     * Extract factual claims from generated Playwright .spec.js code.
     *
     * @param {string} code - Generated test script content
     * @returns {Object[]} Array of extracted assertions
     */
    extract(code) {
        const assertions = [];
        const lines = code.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lineNum = i + 1;

            // Selectors
            this._extractSelectors(line, lineNum, assertions);
            // URL assertions
            this._extractURLs(line, lineNum, assertions);
            // Text assertions
            this._extractTextAssertions(line, lineNum, assertions);
            // Imports
            this._extractImports(line, lineNum, assertions);
            // Method calls on page objects
            this._extractMethodCalls(line, lineNum, assertions);
            // Navigation
            this._extractNavigation(line, lineNum, assertions);
            // Config references
            this._extractConfigRefs(line, lineNum, assertions);
        }

        return assertions;
    }

    _extractSelectors(line, lineNum, assertions) {
        // data-testid selectors
        const testIdMatch = line.match(/getByTestId\(['"`]([^'"`]+)['"`]\)/);
        if (testIdMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: `[data-testid="${testIdMatch[1]}"]`,
                strategy: 'data-testid',
                line: lineNum,
                raw: line,
            });
        }

        // Role-based selectors
        const roleMatch = line.match(/getByRole\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*name:\s*['"`]([^'"`]*)['"`])?\)/);
        if (roleMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: `role=${roleMatch[1]}${roleMatch[2] ? `[name="${roleMatch[2]}"]` : ''}`,
                strategy: 'role',
                line: lineNum,
                raw: line,
            });
        }

        // Text-based selectors
        const textMatch = line.match(/getByText\(['"`]([^'"`]+)['"`]\)/);
        if (textMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: `text="${textMatch[1]}"`,
                strategy: 'text',
                line: lineNum,
                raw: line,
            });
        }

        // Label selectors
        const labelMatch = line.match(/getByLabel\(['"`]([^'"`]+)['"`]\)/);
        if (labelMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: `label="${labelMatch[1]}"`,
                strategy: 'label',
                line: lineNum,
                raw: line,
            });
        }

        // CSS selectors via locator()
        const locatorMatch = line.match(/(?:page|frame)\.locator\(['"`]([^'"`]+)['"`]\)/);
        if (locatorMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: locatorMatch[1],
                strategy: this._detectSelectorStrategy(locatorMatch[1]),
                line: lineNum,
                raw: line,
            });
        }

        // aria-label attribute selectors
        const ariaMatch = line.match(/\[aria-label=['"]([^'"]+)['"]\]/);
        if (ariaMatch) {
            assertions.push({
                type: ASSERTION_TYPES.SELECTOR,
                value: `[aria-label="${ariaMatch[1]}"]`,
                strategy: 'aria-label',
                line: lineNum,
                raw: line,
            });
        }
    }

    _extractURLs(line, lineNum, assertions) {
        const urlMatch = line.match(/toHaveURL\(['"`]([^'"`]+)['"`]\)/);
        if (urlMatch) {
            assertions.push({ type: ASSERTION_TYPES.URL, value: urlMatch[1], line: lineNum, raw: line });
        }
        const expectUrlMatch = line.match(/expect_url.*['"`]([^'"`]+)['"`]/);
        if (expectUrlMatch) {
            assertions.push({ type: ASSERTION_TYPES.URL, value: expectUrlMatch[1], line: lineNum, raw: line });
        }
    }

    _extractTextAssertions(line, lineNum, assertions) {
        const textMatch = line.match(/toContainText\(['"`]([^'"`]+)['"`]\)/);
        if (textMatch) {
            assertions.push({ type: ASSERTION_TYPES.TEXT, value: textMatch[1], line: lineNum, raw: line });
        }
        const haveTextMatch = line.match(/toHaveText\(['"`]([^'"`]+)['"`]\)/);
        if (haveTextMatch) {
            assertions.push({ type: ASSERTION_TYPES.TEXT, value: haveTextMatch[1], line: lineNum, raw: line });
        }
    }

    _extractImports(line, lineNum, assertions) {
        const requireMatch = line.match(/require\(['"`]([^'"`]+)['"`]\)/);
        if (requireMatch) {
            assertions.push({ type: ASSERTION_TYPES.IMPORT, value: requireMatch[1], line: lineNum, raw: line });
        }
    }

    _extractMethodCalls(line, lineNum, assertions) {
        // PO manager method calls: poManager.getXxxPage()
        const poMatch = line.match(/poManager\.(\w+)\(\)/);
        if (poMatch) {
            assertions.push({ type: ASSERTION_TYPES.METHOD_CALL, value: `POmanager.${poMatch[1]}`, line: lineNum, raw: line });
        }

        // Business function calls (anything invoked on a page object)
        const bizMatch = line.match(/(\w+Page|\w+Modal|\w+Component)\.(\w+)\(/);
        if (bizMatch) {
            assertions.push({
                type: ASSERTION_TYPES.METHOD_CALL,
                value: `${bizMatch[1]}.${bizMatch[2]}`,
                line: lineNum,
                raw: line,
            });
        }
    }

    _extractNavigation(line, lineNum, assertions) {
        const gotoMatch = line.match(/page\.goto\(['"`]([^'"`]+)['"`]\)/);
        if (gotoMatch) {
            assertions.push({ type: ASSERTION_TYPES.NAVIGATION, value: gotoMatch[1], line: lineNum, raw: line });
        }
    }

    _extractConfigRefs(line, lineNum, assertions) {
        // References to testData exports
        const configMatch = line.match(/(userTokens|credentials|baseUrl)(?:\.(\w+))?/);
        if (configMatch) {
            assertions.push({
                type: ASSERTION_TYPES.CONFIG,
                value: configMatch[2] ? `${configMatch[1]}.${configMatch[2]}` : configMatch[1],
                line: lineNum,
                raw: line,
            });
        }
    }

    _detectSelectorStrategy(selector) {
        if (selector.startsWith('#')) return 'id';
        if (selector.startsWith('.')) return 'class';
        if (selector.includes('[data-testid')) return 'data-testid';
        if (selector.includes('[data-qa')) return 'data-qa';
        if (selector.includes('[aria-')) return 'aria';
        if (selector.startsWith('//') || selector.startsWith('xpath=')) return 'xpath';
        if (selector.includes('>>')) return 'chained';
        return 'css';
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PROVENANCE TAGGER
// ═══════════════════════════════════════════════════════════════════════════════

class ProvenanceTagger {
    /**
     * @param {Object} coverageMap - CoverageMap instance
     * @param {Object} dnaCompiler - ContextDNACompiler instance
     */
    constructor(coverageMap, dnaCompiler) {
        this.coverageMap = coverageMap;
        this.dnaCompiler = dnaCompiler;
    }

    /**
     * Tag each assertion with its provenance (source DNA region + confidence).
     *
     * @param {Object[]} assertions - From AssertionExtractor.extract()
     * @returns {Object[]} Assertions with provenance metadata
     */
    tag(assertions) {
        return assertions.map(assertion => {
            const provenance = this._findProvenance(assertion);
            return {
                ...assertion,
                provenance: {
                    source: provenance.source,
                    regionId: provenance.regionId,
                    level: provenance.level,
                    confidence: provenance.confidence,
                    status: provenance.status,
                    chain: provenance.chain,
                },
            };
        });
    }

    _findProvenance(assertion) {
        // Build search query from assertion value
        const searchQuery = assertion.value || '';

        // Search DNA for matching regions
        const matchedRegions = this.dnaCompiler.findRelevantRegions(searchQuery, { maxResults: 5 });

        if (matchedRegions.length === 0) {
            return {
                source: null,
                regionId: null,
                level: null,
                confidence: 0,
                status: CONFIDENCE_LEVELS.UNGROUNDED,
                chain: ['No matching source found in context DNA'],
            };
        }

        // Find best match with coverage
        let bestMatch = null;
        let bestConfidence = 0;

        for (const region of matchedRegions) {
            const coverage = this.coverageMap.getRegionCoverage(region.regionId);
            const contentMatch = this._checkContentMatch(assertion, region);
            const effectiveConfidence = (coverage.confidence || 0) * contentMatch;

            if (effectiveConfidence > bestConfidence) {
                bestConfidence = effectiveConfidence;
                bestMatch = {
                    source: region.filePath,
                    regionId: region.regionId,
                    level: coverage.level,
                    confidence: parseFloat(effectiveConfidence.toFixed(3)),
                    status: this._confidenceToStatus(effectiveConfidence),
                    chain: this._buildChain(assertion, region, coverage),
                };
            }
        }

        return bestMatch || {
            source: matchedRegions[0].filePath,
            regionId: matchedRegions[0].regionId,
            level: null,
            confidence: 0,
            status: CONFIDENCE_LEVELS.UNGROUNDED,
            chain: ['Region exists in DNA but not in current context window'],
        };
    }

    _checkContentMatch(assertion, region) {
        // Higher match if the assertion type aligns with region type
        if (assertion.type === ASSERTION_TYPES.SELECTOR) {
            if (region.type === 'page-object') return 1.0;
            if (region.type === 'business-function') return 0.7;
            return 0.3;
        }
        if (assertion.type === ASSERTION_TYPES.METHOD_CALL) {
            if (region.type === 'page-object' || region.type === 'business-function') return 0.9;
            return 0.4;
        }
        if (assertion.type === ASSERTION_TYPES.IMPORT) {
            return 0.8; // Imports are structural — always somewhat reliable
        }
        if (assertion.type === ASSERTION_TYPES.CONFIG) {
            if (region.type === 'config' || region.type === 'test-data') return 1.0;
            return 0.3;
        }
        return 0.5;
    }

    _buildChain(assertion, region, coverage) {
        const chain = [];
        if (coverage.level) {
            chain.push(`Source: ${region.filePath} at ${coverage.level} resolution`);
            if (coverage.agents && coverage.agents.length > 0) {
                chain.push(`Injected for: ${coverage.agents.join(', ')}`);
            }
        } else {
            chain.push(`Source: ${region.filePath} (in DNA but not in context window)`);
        }
        chain.push(`Assertion type: ${assertion.type}, strategy: ${assertion.strategy || 'N/A'}`);
        return chain;
    }

    _confidenceToStatus(confidence) {
        if (confidence >= 0.8) return CONFIDENCE_LEVELS.VERIFIED;
        if (confidence >= 0.4) return CONFIDENCE_LEVELS.INFERRED;
        return CONFIDENCE_LEVELS.UNGROUNDED;
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PROVENANCE VERIFIER
// ═══════════════════════════════════════════════════════════════════════════════

class ProvenanceVerifier {
    /**
     * Verify tagged assertions against a live MCP snapshot or static analysis.
     * Performs verification WITHOUT the LLM — deterministic code analysis only.
     *
     * @param {Object} dnaCompiler - ContextDNACompiler instance
     */
    constructor(dnaCompiler) {
        this.dnaCompiler = dnaCompiler;
    }

    /**
     * Verify a batch of tagged assertions.
     *
     * @param {Object[]} taggedAssertions - From ProvenanceTagger.tag()
     * @param {Object} [verificationContext] - Optional live data
     * @param {Object[]} [verificationContext.snapshotElements] - MCP snapshot elements
     * @param {string[]} [verificationContext.availableExports] - Known exports from framework
     * @returns {Object}
     */
    verify(taggedAssertions, verificationContext = {}) {
        const results = taggedAssertions.map(assertion => {
            const verification = this._verifyAssertion(assertion, verificationContext);
            return {
                ...assertion,
                verification: {
                    verified: verification.verified,
                    method: verification.method,
                    details: verification.details,
                    finalConfidence: verification.finalConfidence,
                    finalStatus: verification.finalStatus,
                },
            };
        });

        // Summary
        const verified = results.filter(r => r.verification.finalStatus === CONFIDENCE_LEVELS.VERIFIED);
        const inferred = results.filter(r => r.verification.finalStatus === CONFIDENCE_LEVELS.INFERRED);
        const ungrounded = results.filter(r => r.verification.finalStatus === CONFIDENCE_LEVELS.UNGROUNDED);

        return {
            results,
            summary: {
                total: results.length,
                verified: verified.length,
                inferred: inferred.length,
                ungrounded: ungrounded.length,
                verifiedPercent: results.length > 0 ? ((verified.length / results.length) * 100).toFixed(1) + '%' : '0%',
                riskLevel: ungrounded.length / results.length > 0.3 ? 'HIGH'
                    : ungrounded.length / results.length > 0.15 ? 'MEDIUM' : 'LOW',
                riskItems: ungrounded.map(u => ({
                    line: u.line,
                    type: u.type,
                    value: u.value,
                    reason: u.verification.details,
                })),
            },
        };
    }

    _verifyAssertion(assertion, context) {
        switch (assertion.type) {
            case ASSERTION_TYPES.SELECTOR:
                return this._verifySelector(assertion, context);
            case ASSERTION_TYPES.IMPORT:
                return this._verifyImport(assertion);
            case ASSERTION_TYPES.METHOD_CALL:
                return this._verifyMethodCall(assertion);
            case ASSERTION_TYPES.CONFIG:
                return this._verifyConfig(assertion);
            default:
                return this._defaultVerification(assertion);
        }
    }

    _verifySelector(assertion, context) {
        // Check against MCP snapshot if available
        if (context.snapshotElements && context.snapshotElements.length > 0) {
            const found = context.snapshotElements.some(el => {
                if (assertion.strategy === 'data-testid') {
                    return el.testId === assertion.value.replace(/\[data-testid="(.*)"\]/, '$1');
                }
                if (assertion.strategy === 'role') {
                    return el.role === assertion.value.split('=')[1]?.split('[')[0];
                }
                if (assertion.strategy === 'text') {
                    return (el.text || '').includes(assertion.value.replace(/text="(.*)"/, '$1'));
                }
                return false;
            });

            if (found) {
                return {
                    verified: true,
                    method: 'mcp-snapshot',
                    details: 'Selector found in live MCP snapshot',
                    finalConfidence: 0.95,
                    finalStatus: CONFIDENCE_LEVELS.VERIFIED,
                };
            }
        }

        // Check against DNA L1 locators
        const l1 = assertion.provenance?.regionId
            ? this.dnaCompiler.getL1(assertion.provenance.regionId)
            : null;

        if (l1 && l1.locators) {
            const locatorMatch = l1.locators.some(loc =>
                assertion.value.includes(loc.value) || loc.value.includes(assertion.value)
            );
            if (locatorMatch) {
                return {
                    verified: true,
                    method: 'dna-l1-locators',
                    details: 'Selector matches locator in L1 semantic skeleton',
                    finalConfidence: assertion.provenance?.confidence || 0.7,
                    finalStatus: CONFIDENCE_LEVELS.VERIFIED,
                };
            }
        }

        // Selector reliability scoring by strategy
        const strategyScores = {
            'data-testid': 0.6, 'data-qa': 0.6, 'id': 0.5,
            'role': 0.5, 'aria-label': 0.45, 'label': 0.45,
            'text': 0.4, 'class': 0.25, 'css': 0.2, 'xpath': 0.15,
        };
        const strategyScore = strategyScores[assertion.strategy] || 0.2;

        return {
            verified: false,
            method: 'strategy-heuristic',
            details: `Unverified selector (${assertion.strategy} strategy, base reliability: ${strategyScore})`,
            finalConfidence: Math.max(assertion.provenance?.confidence || 0, strategyScore) * 0.7,
            finalStatus: strategyScore >= 0.5 ? CONFIDENCE_LEVELS.INFERRED : CONFIDENCE_LEVELS.UNGROUNDED,
        };
    }

    _verifyImport(assertion) {
        const importPath = assertion.value;

        // Check if import maps to a known DNA region
        const allL2 = this.dnaCompiler.getAllL2Cards ? this.dnaCompiler.getAllL2Cards() : [];
        const matchedFile = allL2.find(card =>
            importPath.includes(card.filePath?.split('/').pop()?.replace('.js', '') || '')
        );

        if (matchedFile) {
            return {
                verified: true,
                method: 'dna-file-match',
                details: `Import resolves to known file: ${matchedFile.filePath}`,
                finalConfidence: 0.9,
                finalStatus: CONFIDENCE_LEVELS.VERIFIED,
            };
        }

        // Standard framework imports are always valid
        const knownImports = ['@playwright/test', '../../config/config', '../../pageobjects/POmanager',
            '../../utils/popupHandler', '../../test-data/testData'];
        if (knownImports.some(k => importPath.includes(k))) {
            return {
                verified: true,
                method: 'known-import',
                details: 'Standard framework import',
                finalConfidence: 1.0,
                finalStatus: CONFIDENCE_LEVELS.VERIFIED,
            };
        }

        return {
            verified: false,
            method: 'unresolved',
            details: `Import path not found in DNA: ${importPath}`,
            finalConfidence: 0.2,
            finalStatus: CONFIDENCE_LEVELS.UNGROUNDED,
        };
    }

    _verifyMethodCall(assertion) {
        const [className, methodName] = assertion.value.split('.');

        // Search DNA L1 for the method
        const allL2 = this.dnaCompiler.getAllL2Cards ? this.dnaCompiler.getAllL2Cards() : [];
        for (const card of allL2) {
            if (card.api && card.api.some(m => m.name === methodName || m.name === assertion.value)) {
                return {
                    verified: true,
                    method: 'dna-api-match',
                    details: `Method ${assertion.value} found in ${card.filePath} API surface`,
                    finalConfidence: 0.85,
                    finalStatus: CONFIDENCE_LEVELS.VERIFIED,
                };
            }
        }

        return {
            verified: false,
            method: 'unresolved',
            details: `Method ${assertion.value} not found in any DNA region`,
            finalConfidence: 0.15,
            finalStatus: CONFIDENCE_LEVELS.UNGROUNDED,
        };
    }

    _verifyConfig(assertion) {
        // Known config exports
        const knownConfigs = ['userTokens', 'credentials', 'baseUrl', 'launchBrowser'];
        const configName = assertion.value.split('.')[0];
        if (knownConfigs.includes(configName)) {
            return {
                verified: true,
                method: 'known-config',
                details: `Known framework configuration: ${configName}`,
                finalConfidence: 0.95,
                finalStatus: CONFIDENCE_LEVELS.VERIFIED,
            };
        }

        return {
            verified: false,
            method: 'unknown-config',
            details: `Configuration ${assertion.value} not recognized`,
            finalConfidence: 0.3,
            finalStatus: CONFIDENCE_LEVELS.INFERRED,
        };
    }

    _defaultVerification(assertion) {
        const provenanceConf = assertion.provenance?.confidence || 0;
        return {
            verified: provenanceConf >= 0.7,
            method: 'provenance-passthrough',
            details: `Confidence from provenance: ${provenanceConf}`,
            finalConfidence: provenanceConf,
            finalStatus: provenanceConf >= 0.7 ? CONFIDENCE_LEVELS.VERIFIED
                : provenanceConf >= 0.3 ? CONFIDENCE_LEVELS.INFERRED
                    : CONFIDENCE_LEVELS.UNGROUNDED,
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE RENDERER — Human-readable provenance reports
// ═══════════════════════════════════════════════════════════════════════════════

class ConfidenceRenderer {
    /**
     * Render verification results as a markdown report.
     *
     * @param {Object} verificationResult - From ProvenanceVerifier.verify()
     * @returns {string} Markdown report
     */
    renderReport(verificationResult) {
        const { results, summary } = verificationResult;
        const lines = [];

        lines.push('# Provenance Verification Report');
        lines.push('');
        lines.push(`**Total assertions:** ${summary.total} | **Verified:** ${summary.verified} | **Inferred:** ${summary.inferred} | **Ungrounded:** ${summary.ungrounded}`);
        lines.push(`**Risk level:** ${summary.riskLevel} | **Verified rate:** ${summary.verifiedPercent}`);
        lines.push('');

        // Group by status
        const grouped = { verified: [], inferred: [], ungrounded: [] };
        for (const result of results) {
            const status = result.verification.finalStatus;
            if (status === CONFIDENCE_LEVELS.VERIFIED) grouped.verified.push(result);
            else if (status === CONFIDENCE_LEVELS.INFERRED) grouped.inferred.push(result);
            else grouped.ungrounded.push(result);
        }

        if (grouped.ungrounded.length > 0) {
            lines.push('## Ungrounded Assertions (Potential Hallucinations)');
            lines.push('');
            for (const item of grouped.ungrounded) {
                lines.push(`- **Line ${item.line}** [${item.type}]: \`${item.value}\``);
                lines.push(`  - ${item.verification.details}`);
                if (item.provenance?.chain) {
                    lines.push(`  - Chain: ${item.provenance.chain.join(' → ')}`);
                }
            }
            lines.push('');
        }

        if (grouped.inferred.length > 0) {
            lines.push('## Inferred Assertions (Plausible but Unverified)');
            lines.push('');
            for (const item of grouped.inferred) {
                lines.push(`- **Line ${item.line}** [${item.type}]: \`${item.value}\` (confidence: ${item.verification.finalConfidence})`);
            }
            lines.push('');
        }

        if (grouped.verified.length > 0) {
            lines.push(`## Verified Assertions (${grouped.verified.length} items)`);
            lines.push('');
            lines.push(`All verified via: ${[...new Set(grouped.verified.map(v => v.verification.method))].join(', ')}`);
        }

        return lines.join('\n');
    }

    /**
     * Render inline annotations for a generated script.
     * Adds confidence comments next to assertions.
     *
     * @param {string} code - Original generated code
     * @param {Object[]} verifiedAssertions - Results with verification
     * @returns {string} Annotated code
     */
    renderInlineAnnotations(code, verifiedAssertions) {
        const lines = code.split('\n');
        const annotationMap = new Map();

        for (const assertion of verifiedAssertions) {
            if (!assertion.line) continue;
            const icon = assertion.verification.finalStatus === CONFIDENCE_LEVELS.VERIFIED ? '✅'
                : assertion.verification.finalStatus === CONFIDENCE_LEVELS.INFERRED ? '⚠️' : '❌';
            const annotation = `${icon} ${assertion.verification.finalStatus.toUpperCase()} (${assertion.verification.method})`;

            // Only annotate non-verified items to reduce noise
            if (assertion.verification.finalStatus !== CONFIDENCE_LEVELS.VERIFIED) {
                const existing = annotationMap.get(assertion.line - 1) || [];
                existing.push(annotation);
                annotationMap.set(assertion.line - 1, existing);
            }
        }

        // Insert annotations
        const annotatedLines = [];
        for (let i = 0; i < lines.length; i++) {
            const annotations = annotationMap.get(i);
            if (annotations) {
                annotatedLines.push(`${lines[i]}  // ${annotations.join(', ')}`);
            } else {
                annotatedLines.push(lines[i]);
            }
        }

        return annotatedLines.join('\n');
    }
}


// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    AssertionExtractor,
    ProvenanceTagger,
    ProvenanceVerifier,
    ConfidenceRenderer,
    ASSERTION_TYPES,
};
