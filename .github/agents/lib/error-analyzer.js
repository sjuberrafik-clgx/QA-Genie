/**
 * AI-Powered Error Analyzer
 * Analyzes Playwright test failures and provides intelligent fix suggestions
 * 
 * @module ErrorAnalyzer
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

/**
 * Common Playwright error patterns and their fixes
 */
const ErrorPatterns = {
    // Selector Errors
    SELECTOR_NOT_FOUND: {
        patterns: [
            /locator\..*: Target page, context or browser has been closed/i,
            /Error: locator\..*: Timeout \d+ms exceeded/i,
            /waiting for locator\('(.+)'\)/i,
            /locator resolved to \d+ elements/i
        ],
        category: 'SELECTOR',
        severity: 'HIGH',
        suggestions: [
            'Use more specific selector with getByRole() or getByTestId()',
            'Add explicit wait: await page.waitForSelector(selector)',
            'Check if element is inside iframe or shadow DOM',
            'Verify element exists in current page state'
        ]
    },

    MULTIPLE_ELEMENTS: {
        patterns: [
            /strict mode violation.*locator resolved to (\d+) elements/i,
            /locator resolved to (\d+) elements/i
        ],
        category: 'SELECTOR',
        severity: 'MEDIUM',
        suggestions: [
            'Add .first() or .nth(index) to select specific element',
            'Use more specific selector to match single element',
            'Add filter: locator.filter({ hasText: "specific text" })'
        ]
    },

    // Timeout Errors
    NAVIGATION_TIMEOUT: {
        patterns: [
            /page\.goto: Timeout \d+ms exceeded/i,
            /Navigation timeout of \d+ms exceeded/i,
            /ERR_NAME_NOT_RESOLVED/i,
            /net::ERR_CONNECTION_REFUSED/i
        ],
        category: 'NETWORK',
        severity: 'HIGH',
        suggestions: [
            'Check if UAT environment is accessible',
            'Increase navigation timeout: page.goto(url, { timeout: 60000 })',
            'Verify base URL is correct in testData.js',
            'Check VPN/network connectivity'
        ]
    },

    ACTION_TIMEOUT: {
        patterns: [
            /locator\.(click|fill|type|press): Timeout \d+ms exceeded/i,
            /Timeout \d+ms exceeded.*waiting for/i
        ],
        category: 'TIMEOUT',
        severity: 'MEDIUM',
        suggestions: [
            'Add waitForLoadState() before action',
            'Increase action timeout: { timeout: 30000 }',
            'Check if element is obscured by overlay/modal',
            'Verify element is interactable (not disabled)'
        ]
    },

    // Assertion Errors
    VISIBILITY_ASSERTION: {
        patterns: [
            /expect\(.*\)\.toBeVisible/i,
            /Expected.*to be visible/i,
            /Locator expected to be visible/i
        ],
        category: 'ASSERTION',
        severity: 'MEDIUM',
        suggestions: [
            'Verify element selector is correct',
            'Check if element appears after async operation',
            'Add explicit wait before assertion',
            'Check if content is conditionally rendered'
        ]
    },

    TEXT_ASSERTION: {
        patterns: [
            /expect\(.*\)\.toContainText/i,
            /expect\(.*\)\.toHaveText/i,
            /Expected string:.*Received string:/i
        ],
        category: 'ASSERTION',
        severity: 'MEDIUM',
        suggestions: [
            'Verify expected text matches actual content',
            'Use regex for flexible matching: expect(locator).toHaveText(/pattern/i)',
            'Check for dynamic content or loading states',
            'Trim whitespace: expect(locator).toContainText(text.trim())'
        ]
    },

    URL_ASSERTION: {
        patterns: [
            /expect\(.*\)\.toHaveURL/i,
            /Page URL.*does not match/i
        ],
        category: 'ASSERTION',
        severity: 'LOW',
        suggestions: [
            'Use regex pattern: expect(page).toHaveURL(/.*pattern.*/)',
            'Wait for navigation to complete first',
            'Check for redirects or URL parameters'
        ]
    },

    // Browser/Context Errors
    BROWSER_CLOSED: {
        patterns: [
            /Target page, context or browser has been closed/i,
            /browser has been closed/i,
            /Protocol error.*Target closed/i
        ],
        category: 'BROWSER',
        severity: 'CRITICAL',
        suggestions: [
            'Ensure browser is not closed prematurely in afterAll()',
            'Check for uncaught exceptions crashing the browser',
            'Verify launchBrowser() is called in beforeAll()',
            'Add proper error handling in test hooks'
        ]
    },

    // Authentication Errors
    AUTH_ERROR: {
        patterns: [
            /401 Unauthorized/i,
            /403 Forbidden/i,
            /token.*expired/i,
            /authentication.*failed/i
        ],
        category: 'AUTH',
        severity: 'HIGH',
        suggestions: [
            'Refresh user tokens in testData.js',
            'Verify token format: token=<base64_encoded>',
            'Check if UAT user account is still active',
            'Ensure correct userTokens variant is used'
        ]
    },

    // Framework Errors
    IMPORT_ERROR: {
        patterns: [
            /Cannot find module/i,
            /Module not found/i,
            /require\(\) of ES Module/i
        ],
        category: 'FRAMEWORK',
        severity: 'CRITICAL',
        suggestions: [
            'Verify relative import paths are correct',
            'Use require() not import in .spec.js files',
            'Check if module exists in specified path',
            'Run npm install to ensure dependencies'
        ]
    },

    SYNTAX_ERROR: {
        patterns: [
            /SyntaxError:/i,
            /Unexpected token/i,
            /Cannot use import statement/i
        ],
        category: 'FRAMEWORK',
        severity: 'CRITICAL',
        suggestions: [
            'Use CommonJS require() not ES6 import',
            'Check for missing semicolons or brackets',
            'Verify async/await syntax is correct',
            'Ensure file extension is .spec.js not .spec.ts'
        ]
    }
};

/**
 * OneHome-specific error patterns
 */
const OneHomePatterns = {
    MLS_CONTEXT_ERROR: {
        patterns: [
            /MLS.*not found/i,
            /Canopy|Stellar|CRMLS/i
        ],
        category: 'ONEHOME',
        suggestions: [
            'Verify MLS context matches test user token',
            'Check if property is available in specified MLS'
        ]
    },

    PROPERTY_NOT_FOUND: {
        patterns: [
            /property.*not found/i,
            /no results/i,
            /0 properties/i
        ],
        category: 'ONEHOME',
        suggestions: [
            'Verify search criteria returns results',
            'Check if test property still exists in UAT',
            'Use dynamic property selection instead of hardcoded ID'
        ]
    },

    TOKEN_FORMAT_ERROR: {
        patterns: [
            /invalid.*token/i,
            /malformed.*token/i
        ],
        category: 'ONEHOME',
        suggestions: [
            'Regenerate token from UAT environment',
            'Verify base64 encoding is correct',
            'Check token structure: {OSN, contactid, email, agentid}'
        ]
    }
};

/**
 * Error Analyzer Class
 */
class ErrorAnalyzer {
    constructor() {
        this.patterns = { ...ErrorPatterns, ...OneHomePatterns };
        this.analysisHistory = [];
    }

    /**
     * Analyze test error output and provide intelligent suggestions
     * @param {string} errorOutput - Raw error output from test execution
     * @param {Object} context - Additional context (scriptPath, testName, etc.)
     * @returns {Object} Analysis result with suggestions
     */
    analyze(errorOutput, context = {}) {
        const analysis = {
            timestamp: new Date().toISOString(),
            context,
            rawError: errorOutput,
            matchedPatterns: [],
            suggestions: [],
            autoFixable: false,
            autoFix: null,
            severity: 'UNKNOWN',
            category: 'UNKNOWN'
        };

        // Match error against known patterns
        for (const [patternName, patternDef] of Object.entries(this.patterns)) {
            for (const regex of patternDef.patterns) {
                const match = errorOutput.match(regex);
                if (match) {
                    analysis.matchedPatterns.push({
                        name: patternName,
                        match: match[0],
                        captured: match.slice(1)
                    });
                    analysis.suggestions.push(...patternDef.suggestions);
                    analysis.category = patternDef.category;
                    analysis.severity = patternDef.severity || 'MEDIUM';
                    break;
                }
            }
        }

        // Deduplicate suggestions
        analysis.suggestions = [...new Set(analysis.suggestions)];

        // Check if auto-fixable
        analysis.autoFixable = this.canAutoFix(analysis);
        if (analysis.autoFixable) {
            analysis.autoFix = this.generateAutoFix(analysis, context);
        }

        // Generate AI-powered additional insights
        analysis.aiInsights = this.generateAIInsights(analysis, context);

        // Store in history
        this.analysisHistory.push(analysis);

        return analysis;
    }

    /**
     * Check if error can be auto-fixed
     * @param {Object} analysis - Analysis result
     * @returns {boolean} True if auto-fixable
     */
    canAutoFix(analysis) {
        const autoFixablePatterns = [
            'MULTIPLE_ELEMENTS',
            'ACTION_TIMEOUT',
            'VISIBILITY_ASSERTION'
        ];

        return analysis.matchedPatterns.some(p =>
            autoFixablePatterns.includes(p.name)
        );
    }

    /**
     * Generate auto-fix code transformation
     * @param {Object} analysis - Analysis result
     * @param {Object} context - Context with script content
     * @returns {Object} Auto-fix instructions
     */
    generateAutoFix(analysis, context) {
        const fixes = [];

        for (const pattern of analysis.matchedPatterns) {
            switch (pattern.name) {
                case 'MULTIPLE_ELEMENTS':
                    fixes.push({
                        type: 'ADD_FIRST',
                        description: 'Add .first() to select single element',
                        transform: (code) => {
                            // Find the problematic locator and add .first()
                            return code.replace(
                                /(page\.(locator|getBy\w+)\([^)]+\))(?!\.first\(\))/g,
                                '$1.first()'
                            );
                        }
                    });
                    break;

                case 'ACTION_TIMEOUT':
                    fixes.push({
                        type: 'INCREASE_TIMEOUT',
                        description: 'Increase action timeout to 30 seconds',
                        transform: (code) => {
                            return code.replace(
                                /\.(click|fill|type)\(\)/g,
                                '.$1({ timeout: 30000 })'
                            );
                        }
                    });
                    fixes.push({
                        type: 'ADD_WAIT',
                        description: 'Add waitForLoadState before actions',
                        transform: (code) => {
                            return code.replace(
                                /(await page\.goto\([^)]+\));/g,
                                "$1;\n        await page.waitForLoadState('networkidle');"
                            );
                        }
                    });
                    break;

                case 'VISIBILITY_ASSERTION':
                    fixes.push({
                        type: 'ADD_WAIT_FOR_SELECTOR',
                        description: 'Add explicit wait before visibility check',
                        transform: (code) => {
                            return code.replace(
                                /await expect\(([^)]+)\)\.toBeVisible\(\)/g,
                                'await $1.waitFor({ state: "visible", timeout: 10000 });\n        await expect($1).toBeVisible()'
                            );
                        }
                    });
                    break;
            }
        }

        return {
            fixes,
            apply: (scriptContent) => {
                let modified = scriptContent;
                for (const fix of fixes) {
                    modified = fix.transform(modified);
                }
                return modified;
            }
        };
    }

    /**
     * Generate AI-powered insights based on error context
     * @param {Object} analysis - Analysis result
     * @param {Object} context - Additional context
     * @returns {Object} AI insights
     */
    generateAIInsights(analysis, context) {
        const insights = {
            rootCause: null,
            recommendedApproach: null,
            preventionTips: [],
            relatedErrors: []
        };

        // Determine root cause based on category
        switch (analysis.category) {
            case 'SELECTOR':
                insights.rootCause = 'Element selection issue - the selector may be too generic, the element may not exist, or timing issues';
                insights.recommendedApproach = 'Use Playwright MCP to re-explore the application and capture fresh selectors from the live DOM';
                insights.preventionTips = [
                    'Prefer getByRole() and getByTestId() over CSS selectors',
                    'Always validate selector uniqueness during exploration',
                    'Add data-testid attributes to critical UI elements'
                ];
                break;

            case 'NETWORK':
                insights.rootCause = 'Network connectivity or environment availability issue';
                insights.recommendedApproach = 'Verify UAT environment status and check network/VPN connectivity';
                insights.preventionTips = [
                    'Add health check before test execution',
                    'Implement retry logic for network operations',
                    'Use environment status monitoring'
                ];
                break;

            case 'TIMEOUT':
                insights.rootCause = 'Operation took longer than expected - could be slow network, heavy page, or waiting for wrong element';
                insights.recommendedApproach = 'Increase timeouts and add proper wait conditions';
                insights.preventionTips = [
                    'Use waitForLoadState() after navigation',
                    'Set appropriate timeout values based on operation type',
                    'Consider using waitForSelector() for dynamic content'
                ];
                break;

            case 'ASSERTION':
                insights.rootCause = 'Expected value does not match actual value - could be data change, timing issue, or incorrect expectation';
                insights.recommendedApproach = 'Review expected values and add flexibility with regex patterns';
                insights.preventionTips = [
                    'Use flexible matchers (toContainText vs toHaveText)',
                    'Account for dynamic/changing content',
                    'Add soft assertions for non-critical checks'
                ];
                break;

            case 'BROWSER':
                insights.rootCause = 'Browser lifecycle management issue - browser closed unexpectedly';
                insights.recommendedApproach = 'Review test hooks (beforeAll, afterAll) and ensure proper browser handling';
                insights.preventionTips = [
                    'Always close browser in afterAll(), not after each test',
                    'Add error handling to prevent uncaught exceptions',
                    'Verify launchBrowser() configuration'
                ];
                break;

            case 'AUTH':
                insights.rootCause = 'Authentication failure - token expired, invalid, or user account issue';
                insights.recommendedApproach = 'Regenerate UAT tokens and verify user account status';
                insights.preventionTips = [
                    'Implement token refresh mechanism',
                    'Use dedicated test accounts',
                    'Monitor token expiration'
                ];
                break;

            case 'FRAMEWORK':
                insights.rootCause = 'Code structure or import issue - likely JavaScript/TypeScript mismatch';
                insights.recommendedApproach = 'Ensure script follows .spec.js framework patterns with CommonJS require()';
                insights.preventionTips = [
                    'Always use .spec.js extension',
                    'Use require() not import',
                    'Follow existing test patterns'
                ];
                break;

            case 'ONEHOME':
                insights.rootCause = 'OneHome application-specific issue - MLS, property, or token related';
                insights.recommendedApproach = 'Verify test data and MLS configuration matches UAT environment';
                insights.preventionTips = [
                    'Use dynamic test data selection',
                    'Verify MLS context in user token',
                    'Check property availability before test'
                ];
                break;
        }

        // Find related historical errors
        insights.relatedErrors = this.findRelatedErrors(analysis);

        return insights;
    }

    /**
     * Find related errors from history
     * @param {Object} analysis - Current analysis
     * @returns {Array} Related error summaries
     */
    findRelatedErrors(analysis) {
        return this.analysisHistory
            .filter(h => h.category === analysis.category && h !== analysis)
            .slice(-3)
            .map(h => ({
                timestamp: h.timestamp,
                patterns: h.matchedPatterns.map(p => p.name),
                resolved: h.resolved || false
            }));
    }

    /**
     * Generate comprehensive error report
     * @param {Object} analysis - Analysis result
     * @returns {string} Formatted error report
     */
    generateReport(analysis) {
        const lines = [
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '🔍 AI ERROR ANALYSIS REPORT',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            `📊 Category: ${analysis.category}`,
            `⚠️ Severity: ${analysis.severity}`,
            `🔧 Auto-fixable: ${analysis.autoFixable ? '✅ YES' : '❌ NO'}`,
            '',
            '📝 Matched Patterns:',
            ...analysis.matchedPatterns.map(p => `   • ${p.name}: ${p.match.substring(0, 60)}...`),
            '',
            '💡 Suggestions:',
            ...analysis.suggestions.slice(0, 5).map((s, i) => `   ${i + 1}. ${s}`),
            '',
            '🧠 AI Insights:',
            `   Root Cause: ${analysis.aiInsights.rootCause}`,
            `   Recommended: ${analysis.aiInsights.recommendedApproach}`,
            '',
            '🛡️ Prevention Tips:',
            ...analysis.aiInsights.preventionTips.map(t => `   • ${t}`),
            ''
        ];

        if (analysis.autoFixable && analysis.autoFix) {
            lines.push('🔧 Auto-Fix Available:');
            analysis.autoFix.fixes.forEach(fix => {
                lines.push(`   • ${fix.type}: ${fix.description}`);
            });
            lines.push('');
        }

        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        return lines.join('\n');
    }

    /**
     * Apply auto-fix to script file
     * @param {string} scriptPath - Path to script file
     * @param {Object} autoFix - Auto-fix object from analysis
     * @returns {Object} Result with success status and modified content
     */
    applyAutoFix(scriptPath, autoFix) {
        try {
            const originalContent = fs.readFileSync(scriptPath, 'utf8');
            const modifiedContent = autoFix.apply(originalContent);

            if (originalContent === modifiedContent) {
                return {
                    success: false,
                    message: 'No changes were applied - patterns not found in code'
                };
            }

            // Backup original
            const backupPath = scriptPath + '.backup';
            fs.writeFileSync(backupPath, originalContent, 'utf8');

            // Write modified
            fs.writeFileSync(scriptPath, modifiedContent, 'utf8');

            return {
                success: true,
                message: 'Auto-fix applied successfully',
                backupPath,
                changes: autoFix.fixes.map(f => f.description)
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to apply auto-fix: ${error.message}`
            };
        }
    }

    /**
     * Get analysis statistics
     * @returns {Object} Analysis statistics
     */
    getStatistics() {
        const stats = {
            totalAnalyses: this.analysisHistory.length,
            byCategory: {},
            bySeverity: {},
            autoFixRate: 0
        };

        let autoFixable = 0;

        for (const analysis of this.analysisHistory) {
            stats.byCategory[analysis.category] = (stats.byCategory[analysis.category] || 0) + 1;
            stats.bySeverity[analysis.severity] = (stats.bySeverity[analysis.severity] || 0) + 1;
            if (analysis.autoFixable) autoFixable++;
        }

        stats.autoFixRate = stats.totalAnalyses > 0
            ? Math.round((autoFixable / stats.totalAnalyses) * 100)
            : 0;

        return stats;
    }
}

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ErrorAnalyzer,
        ErrorPatterns,
        OneHomePatterns
    };
}
