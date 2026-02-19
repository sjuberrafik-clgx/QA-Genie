/**
 * Assertion Configuration Helper
 * ================================
 * Provides framework-agnostic access to assertion configurations
 * Used by scriptgenerator agent for generating robust test scripts
 * 
 * @version 1.0.0
 * @see assertion-config.json
 */

const fs = require('fs');
const path = require('path');

class AssertionConfigHelper {
    constructor(configPath = null) {
        // Default to project root assertion-config.json
        this.configPath = configPath || path.join(__dirname, '..', 'config', 'assertion-config.json');
        this.config = null;
        this.loadConfig();
    }

    /**
     * Load configuration from JSON file
     */
    loadConfig() {
        try {
            const configContent = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configContent);
        } catch (error) {
            throw new Error(`Failed to load assertion config: ${error.message}`);
        }
    }

    /**
     * Get the currently active framework
     * @returns {string} Active framework name (e.g., 'playwright', 'selenium')
     */
    getActiveFramework() {
        return this.config.activeFramework;
    }

    /**
     * Set the active framework
     * @param {string} framework - Framework name
     */
    setActiveFramework(framework) {
        const available = Object.keys(this.config.frameworks);
        if (!available.includes(framework)) {
            throw new Error(`Unknown framework '${framework}'. Available: ${available.join(', ')}`);
        }
        this.config.activeFramework = framework;
    }

    /**
     * Get framework configuration
     * @param {string} framework - Optional framework name (defaults to active)
     * @returns {Object} Framework configuration
     */
    getFrameworkConfig(framework = null) {
        const fw = framework || this.config.activeFramework;
        return this.config.frameworks[fw];
    }

    /**
     * Get import statement for the active framework
     * @returns {string} Import statement
     */
    getImportStatement() {
        const framework = this.getFrameworkConfig();
        return framework.import.statement;
    }

    /**
     * Get all assertions for a specific category
     * @param {string} category - Category name (visibility, state, content, etc.)
     * @param {string} framework - Optional framework name
     * @returns {Object} Assertions in the category
     */
    getAssertionsByCategory(category, framework = null) {
        const fw = this.getFrameworkConfig(framework);
        return fw.assertions[category] || {};
    }

    /**
     * Get all auto-retrying assertions
     * @param {string} framework - Optional framework name
     * @returns {Object} Auto-retrying assertions grouped by category
     */
    getAutoRetryingAssertions(framework = null) {
        const fw = this.getFrameworkConfig(framework);
        const result = {};

        for (const [category, assertions] of Object.entries(fw.assertions)) {
            const autoRetrying = {};
            for (const [name, config] of Object.entries(assertions)) {
                if (config.autoRetry) {
                    autoRetrying[name] = config;
                }
            }
            if (Object.keys(autoRetrying).length > 0) {
                result[category] = autoRetrying;
            }
        }
        return result;
    }

    /**
     * Get assertion by name (searches all categories)
     * @param {string} assertionName - Name of the assertion
     * @param {string} framework - Optional framework name
     * @returns {Object|null} Assertion configuration or null
     */
    getAssertion(assertionName, framework = null) {
        const fw = this.getFrameworkConfig(framework);

        for (const [category, assertions] of Object.entries(fw.assertions)) {
            if (assertions[assertionName]) {
                return {
                    category,
                    ...assertions[assertionName]
                };
            }
        }
        return null;
    }

    /**
     * Find assertions by tag
     * @param {string} tag - Tag to search for
     * @param {string} framework - Optional framework name
     * @returns {Array} Matching assertions
     */
    findAssertionsByTag(tag, framework = null) {
        const fw = this.getFrameworkConfig(framework);
        const results = [];

        for (const [category, assertions] of Object.entries(fw.assertions)) {
            for (const [name, config] of Object.entries(assertions)) {
                if (config.tags && config.tags.includes(tag)) {
                    results.push({
                        name,
                        category,
                        ...config
                    });
                }
            }
        }
        return results;
    }

    /**
     * Get anti-patterns to avoid
     * @param {string} framework - Optional framework name
     * @returns {Array} Anti-patterns
     */
    getAntiPatterns(framework = null) {
        const fw = this.getFrameworkConfig(framework);
        return fw.antiPatterns || [];
    }

    /**
     * Get best practices
     * @param {string} priority - Filter by priority (required, recommended, optional)
     * @param {string} framework - Optional framework name
     * @returns {Array} Best practices
     */
    getBestPractices(priority = null, framework = null) {
        const fw = this.getFrameworkConfig(framework);
        const practices = fw.bestPractices || [];

        if (priority) {
            return practices.filter(p => p.priority === priority);
        }
        return practices;
    }

    /**
     * Get selector strategies in priority order
     * @param {string} framework - Optional framework name
     * @returns {Array} Selector strategies sorted by rank
     */
    getSelectorStrategies(framework = null) {
        const fw = this.getFrameworkConfig(framework);
        const strategies = fw.selectorStrategies?.priority || [];
        return strategies.sort((a, b) => a.rank - b.rank);
    }

    /**
     * Get global settings
     * @returns {Object} Global settings
     */
    getGlobalSettings() {
        return this.config.globalSettings;
    }

    /**
     * Generate assertion code for a specific validation need
     * @param {string} validationType - Type of validation (visibility, text, enabled, etc.)
     * @param {Object} options - Options for generating the assertion
     * @returns {string} Generated assertion code
     */
    generateAssertion(validationType, options = {}) {
        const {
            locator = 'element',
            expected = '',
            customMessage = '',
            soft = false
        } = options;

        const fw = this.getFrameworkConfig();
        const activeFramework = this.config.activeFramework;

        // Map validation type to framework-specific assertion
        const mappings = {
            playwright: {
                visibility: `await expect(${locator}${customMessage ? `, '${customMessage}'` : ''}).toBeVisible()`,
                hidden: `await expect(${locator}).toBeHidden()`,
                enabled: `await expect(${locator}).toBeEnabled()`,
                disabled: `await expect(${locator}).toBeDisabled()`,
                text: `await expect(${locator}).toHaveText(${typeof expected === 'string' ? `'${expected}'` : expected})`,
                containsText: `await expect(${locator}).toContainText('${expected}')`,
                value: `await expect(${locator}).toHaveValue('${expected}')`,
                checked: `await expect(${locator}).toBeChecked()`,
                focused: `await expect(${locator}).toBeFocused()`,
                count: `await expect(${locator}).toHaveCount(${expected})`,
                url: `await expect(page).toHaveURL(${typeof expected === 'string' ? `'${expected}'` : expected})`,
                title: `await expect(page).toHaveTitle(${typeof expected === 'string' ? `'${expected}'` : expected})`,
                attribute: `await expect(${locator}).toHaveAttribute('${options.attribute}', '${expected}')`
            },
            selenium: {
                visibility: `await driver.wait(until.elementIsVisible(${locator}), ${this.getGlobalSettings().defaultTimeout})`,
                hidden: `await driver.wait(until.elementIsNotVisible(${locator}), ${this.getGlobalSettings().defaultTimeout})`,
                enabled: `await driver.wait(until.elementIsEnabled(${locator}), ${this.getGlobalSettings().defaultTimeout})`,
                text: `await driver.wait(until.elementTextIs(${locator}, '${expected}'), ${this.getGlobalSettings().defaultTimeout})`,
                containsText: `await driver.wait(until.elementTextContains(${locator}, '${expected}'), ${this.getGlobalSettings().defaultTimeout})`,
                url: `await driver.wait(until.urlContains('${expected}'), ${this.getGlobalSettings().defaultTimeout})`,
                title: `await driver.wait(until.titleContains('${expected}'), ${this.getGlobalSettings().defaultTimeout})`
            },
            cypress: {
                visibility: `cy.get(${locator}).should('be.visible')`,
                hidden: `cy.get(${locator}).should('not.be.visible')`,
                enabled: `cy.get(${locator}).should('be.enabled')`,
                disabled: `cy.get(${locator}).should('be.disabled')`,
                text: `cy.get(${locator}).should('have.text', '${expected}')`,
                containsText: `cy.get(${locator}).should('contain', '${expected}')`,
                value: `cy.get(${locator}).should('have.value', '${expected}')`,
                checked: `cy.get(${locator}).should('be.checked')`,
                focused: `cy.get(${locator}).should('be.focused')`,
                count: `cy.get(${locator}).should('have.length', ${expected})`,
                url: `cy.url().should('include', '${expected}')`,
                title: `cy.title().should('include', '${expected}')`
            },
            webdriverio: {
                visibility: `await expect($(${locator})).toBeDisplayed()`,
                hidden: `await expect($(${locator})).not.toBeDisplayed()`,
                enabled: `await expect($(${locator})).toBeEnabled()`,
                disabled: `await expect($(${locator})).toBeDisabled()`,
                text: `await expect($(${locator})).toHaveText('${expected}')`,
                containsText: `await expect($(${locator})).toHaveTextContaining('${expected}')`,
                value: `await expect($(${locator})).toHaveValue('${expected}')`,
                checked: `await expect($(${locator})).toBeSelected()`,
                focused: `await expect($(${locator})).toBeFocused()`,
                url: `await expect(browser).toHaveUrlContaining('${expected}')`,
                title: `await expect(browser).toHaveTitleContaining('${expected}')`
            }
        };

        const frameworkMappings = mappings[activeFramework];
        if (!frameworkMappings || !frameworkMappings[validationType]) {
            throw new Error(`Validation type '${validationType}' not supported for framework '${activeFramework}'`);
        }

        let code = frameworkMappings[validationType];

        // Add soft assertion prefix for Playwright
        if (soft && activeFramework === 'playwright') {
            code = code.replace('await expect(', 'await expect.soft(');
        }

        return code;
    }

    /**
     * Generate assertion template with all common validations
     * @param {string} elementType - Type of element (button, input, link, etc.)
     * @returns {Object} Template with common assertions
     */
    generateAssertionTemplate(elementType) {
        const templates = {
            button: {
                preAction: ['visibility', 'enabled'],
                postAction: ['visibility'],
                optional: ['text', 'focused']
            },
            input: {
                preAction: ['visibility', 'enabled', 'focused'],
                postAction: ['value'],
                optional: ['attribute']
            },
            link: {
                preAction: ['visibility'],
                postAction: ['url'],
                optional: ['text', 'attribute']
            },
            checkbox: {
                preAction: ['visibility', 'enabled'],
                postAction: ['checked'],
                optional: []
            },
            modal: {
                preAction: [],
                postAction: ['visibility'],
                optional: ['text', 'containsText']
            },
            page: {
                preAction: [],
                postAction: ['url', 'title'],
                optional: []
            }
        };

        return templates[elementType] || templates.button;
    }

    /**
     * Validate code against anti-patterns
     * @param {string} code - Code to validate
     * @param {string} framework - Optional framework name
     * @returns {Array} Array of detected anti-pattern violations
     */
    validateCode(code, framework = null) {
        const antiPatterns = this.getAntiPatterns(framework);
        const violations = [];

        for (const ap of antiPatterns) {
            if (code.includes(ap.pattern) || new RegExp(ap.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(code)) {
                violations.push({
                    id: ap.id,
                    pattern: ap.pattern,
                    reason: ap.reason,
                    replacement: ap.replacement,
                    severity: ap.severity
                });
            }
        }

        return violations;
    }

    /**
     * Get available frameworks
     * @returns {Array} List of available framework names
     */
    getAvailableFrameworks() {
        return Object.keys(this.config.frameworks);
    }

    /**
     * Export configuration summary for documentation
     * @returns {Object} Summary object
     */
    exportSummary() {
        const framework = this.getFrameworkConfig();
        const categories = Object.keys(framework.assertions);
        const totalAssertions = categories.reduce((sum, cat) => {
            return sum + Object.keys(framework.assertions[cat]).length;
        }, 0);

        return {
            framework: this.config.activeFramework,
            version: framework.version,
            documentation: framework.documentation,
            totalAssertions,
            categories,
            antiPatternsCount: (framework.antiPatterns || []).length,
            bestPracticesCount: (framework.bestPractices || []).length
        };
    }
}

// Singleton instance for easy import
let instance = null;

/**
 * Get singleton instance of AssertionConfigHelper
 * @param {string} configPath - Optional custom config path
 * @returns {AssertionConfigHelper}
 */
function getAssertionHelper(configPath = null) {
    if (!instance) {
        instance = new AssertionConfigHelper(configPath);
    }
    return instance;
}

// Export for use in agents and tests
module.exports = {
    AssertionConfigHelper,
    getAssertionHelper
};

// CLI usage
if (require.main === module) {
    const helper = getAssertionHelper();

    console.log('\n📋 Assertion Configuration Summary');
    console.log('===================================\n');

    const summary = helper.exportSummary();
    console.log(`Active Framework: ${summary.framework}`);
    console.log(`Version: ${summary.version}`);
    console.log(`Documentation: ${summary.documentation}`);
    console.log(`Total Assertions: ${summary.totalAssertions}`);
    console.log(`Categories: ${summary.categories.join(', ')}`);
    console.log(`Anti-patterns: ${summary.antiPatternsCount}`);
    console.log(`Best Practices: ${summary.bestPracticesCount}`);

    console.log('\n🎯 Selector Strategies (Priority Order):');
    helper.getSelectorStrategies().forEach(s => {
        console.log(`  ${s.rank}. ${s.strategy} - ${s.description}`);
    });

    console.log('\n⚠️ Anti-patterns to Avoid:');
    helper.getAntiPatterns().slice(0, 3).forEach(ap => {
        console.log(`  ❌ ${ap.pattern}`);
        console.log(`     → Use: ${ap.replacement}`);
    });

    console.log('\n✅ Required Best Practices:');
    helper.getBestPractices('required').forEach(bp => {
        console.log(`  • ${bp.description}`);
    });
}
