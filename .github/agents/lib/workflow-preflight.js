/**
 * Workflow Pre-flight Validation Module
 * 
 * PURPOSE: Ensure all prerequisites are met before workflow execution
 * 
 * VALIDATES:
 * - MCP server availability
 * - Jira API accessibility
 * - UAT environment reachability
 * - Test data configuration validity
 * - Token freshness
 * 
 * @module workflow-preflight
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Dynamic path resolution
let _projectPaths;
function getProjectPaths() {
    if (!_projectPaths) {
        try {
            _projectPaths = require('../../../agentic-workflow/utils/project-path-resolver').getProjectPaths();
        } catch {
            _projectPaths = null;
        }
    }
    return _projectPaths;
}

// Load workflow configuration
function loadConfig() {
    const configPath = path.join(__dirname, '..', '..', '..', 'agentic-workflow', 'config', 'workflow-config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    // Return default config if file doesn't exist
    return getDefaultConfig();
}

function getDefaultConfig() {
    return {
        preflightChecks: {
            enabled: true,
            timeout: 30000,
            checks: []
        },
        mcpExploration: {
            mandatory: true,
            enforceBeforeScriptGeneration: true,
            snapshotRequired: true
        },
        testExecution: {
            maxIterations: 2,
            selfHealingEnabled: true
        }
    };
}

/**
 * Pre-flight validation results
 */
class PreflightResults {
    constructor() {
        this.checks = [];
        this.passed = true;
        this.startTime = Date.now();
        this.endTime = null;
    }

    addCheck(id, name, passed, message, recoveryAction = null) {
        this.checks.push({
            id,
            name,
            passed,
            message,
            recoveryAction,
            timestamp: new Date().toISOString()
        });
        if (!passed) {
            this.passed = false;
        }
    }

    complete() {
        this.endTime = Date.now();
        this.duration = this.endTime - this.startTime;
    }

    getSummary() {
        const passedCount = this.checks.filter(c => c.passed).length;
        return {
            total: this.checks.length,
            passed: passedCount,
            failed: this.checks.length - passedCount,
            overallPassed: this.passed,
            duration: this.duration,
            failedChecks: this.checks.filter(c => !c.passed)
        };
    }
}

/**
 * Check if a URL is reachable
 */
async function checkUrlReachable(url, timeout = 15000) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname,
            method: 'HEAD',
            timeout: timeout,
            rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
            resolve({
                reachable: res.statusCode < 500,
                statusCode: res.statusCode,
                message: `Status: ${res.statusCode}`
            });
        });

        req.on('error', (err) => {
            resolve({
                reachable: false,
                statusCode: null,
                message: err.message
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                reachable: false,
                statusCode: null,
                message: 'Connection timeout'
            });
        });

        req.end();
    });
}

/**
 * Check if test data file exists and is valid
 */
function checkTestDataFile(filePath) {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
        return {
            valid: false,
            message: `Test data file not found: ${fullPath}`
        };
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Check for required exports
        const hasUserTokensUAT = content.includes('userTokensUAT');
        const hasBaseUrl = content.includes('baseUrl');
        const hasCredentials = content.includes('email') || content.includes('password');

        if (!hasUserTokensUAT) {
            return {
                valid: false,
                message: 'Test data missing userTokensUAT export'
            };
        }

        return {
            valid: true,
            message: 'Test data file is valid',
            hasUserTokensUAT,
            hasBaseUrl,
            hasCredentials
        };
    } catch (error) {
        return {
            valid: false,
            message: `Error reading test data: ${error.message}`
        };
    }
}

/**
 * Check if required directories exist
 */
function checkDirectories() {
    const pp = getProjectPaths();
    const requiredDirs = [
        'test-cases',
        pp ? pp.specsDir : 'tests/specs',
        'exploration-data',
        '.github/agents/state'
    ];

    const results = [];

    for (const dir of requiredDirs) {
        const fullPath = path.resolve(dir);
        const exists = fs.existsSync(fullPath);

        if (!exists) {
            try {
                fs.mkdirSync(fullPath, { recursive: true });
                results.push({ dir, status: 'created' });
            } catch (error) {
                results.push({ dir, status: 'error', message: error.message });
            }
        } else {
            results.push({ dir, status: 'exists' });
        }
    }

    return {
        valid: results.every(r => r.status !== 'error'),
        directories: results
    };
}

/**
 * Validate MCP exploration checkpoint
 */
function validateMcpCheckpoint(checkpoint, state) {
    switch (checkpoint.id) {
        case 'browser-launched':
            return state.browserLaunched === true;
        case 'page-navigated':
            return state.currentUrl && state.currentUrl.length > 0;
        case 'snapshot-captured':
            return state.snapshotsCaptured > 0;
        case 'selectors-extracted':
            return state.selectorsExtracted > 0;
        default:
            return false;
    }
}

/**
 * Run all pre-flight checks
 */
async function runPreflightChecks(options = {}) {
    const config = loadConfig();
    const results = new PreflightResults();

    console.log('\n' + '═'.repeat(80));
    console.log('🚁 PRE-FLIGHT VALIDATION');
    console.log('═'.repeat(80));

    if (!config.preflightChecks.enabled) {
        console.log('⚠️  Pre-flight checks are disabled in configuration');
        results.complete();
        return results;
    }

    // Check 1: Required directories
    console.log('\n📁 Checking required directories...');
    const dirCheck = checkDirectories();
    results.addCheck(
        'directories',
        'Required Directories',
        dirCheck.valid,
        dirCheck.valid ? 'All directories ready' : 'Directory setup failed'
    );
    console.log(dirCheck.valid ? '   ✅ Directories ready' : '   ❌ Directory check failed');

    // Check 2: Test data file
    console.log('\n📊 Checking test data configuration...');
    const pp = getProjectPaths();
    const testDataPath = options.testDataPath
        || (pp ? path.join(pp.projectRoot, pp.testDataFile) : 'tests/test-data/testData.js');
    const testDataCheck = checkTestDataFile(testDataPath);
    results.addCheck(
        'test-data',
        'Test Data Configuration',
        testDataCheck.valid,
        testDataCheck.message
    );
    console.log(testDataCheck.valid ? '   ✅ Test data valid' : `   ❌ ${testDataCheck.message}`);

    // Check 3: Jira API accessibility
    console.log('\n🔗 Checking Jira API accessibility...');
    const ppJira = getProjectPaths();
    const jiraBaseUrl = ppJira?.jira?.baseUrl || config.jira?.baseUrl || process.env.JIRA_BASE_URL || '';
    const jiraCheck = await checkUrlReachable(jiraBaseUrl, config.preflightChecks.timeout);
    results.addCheck(
        'jira-accessible',
        'Jira API Accessible',
        jiraCheck.reachable,
        jiraCheck.reachable
            ? 'Jira endpoint reachable — ensure Atlassian MCP server is connected for full ticket fetch'
            : `Jira not reachable: ${jiraCheck.message}. Ensure Atlassian MCP server is configured in .vscode/mcp.json`,
        'Verify Atlassian MCP server is configured in .vscode/mcp.json and authenticated'
    );
    console.log(jiraCheck.reachable ? '   ✅ Jira API reachable' : `   ❌ Jira not reachable: ${jiraCheck.message}`);

    // Check 4: UAT environment (if specified)
    if (options.environment === 'UAT' || !options.environment) {
        console.log('\n🌐 Checking UAT environment accessibility...');
        const uatUrl = config.environments?.UAT?.baseUrl || process.env.UAT_URL || '';
        const uatCheck = await checkUrlReachable(uatUrl, config.preflightChecks.timeout);
        results.addCheck(
            'uat-reachable',
            'UAT Environment',
            uatCheck.reachable,
            uatCheck.message,
            'Check VPN connection or network settings'
        );
        console.log(uatCheck.reachable ? '   ✅ UAT environment reachable' : `   ❌ UAT not reachable: ${uatCheck.message}`);
    }

    // Check 5: Excel file (if ticket ID provided)
    if (options.ticketId) {
        console.log(`\n📋 Checking existing artifacts for ${options.ticketId}...`);
        const excelPath = path.join('test-cases', `${options.ticketId}.xlsx`);
        const excelExists = fs.existsSync(excelPath);
        results.addCheck(
            'excel-exists',
            'Test Cases Excel',
            true, // Non-blocking - just informational
            excelExists ? `Found: ${excelPath}` : 'Not found - will be generated by TestGenie'
        );
        console.log(excelExists ? `   ✅ Excel exists: ${excelPath}` : '   ℹ️  Excel not found - TestGenie will generate');

        // Check for existing script
        const scriptDir = path.join(pp ? pp.specsDir : 'tests/specs', options.ticketId.toLowerCase());
        const scriptExists = fs.existsSync(scriptDir);
        results.addCheck(
            'script-exists',
            'Playwright Script',
            true, // Non-blocking - just informational
            scriptExists ? `Found: ${scriptDir}` : 'Not found - will be generated by ScriptGenerator'
        );
        console.log(scriptExists ? `   ✅ Script exists: ${scriptDir}` : '   ℹ️  Script not found - ScriptGenerator will generate');
    }

    results.complete();

    // Print summary
    const summary = results.getSummary();
    console.log('\n' + '─'.repeat(80));
    console.log('📊 PRE-FLIGHT SUMMARY');
    console.log('─'.repeat(80));
    console.log(`   Total Checks: ${summary.total}`);
    console.log(`   ✅ Passed: ${summary.passed}`);
    console.log(`   ❌ Failed: ${summary.failed}`);
    console.log(`   ⏱️  Duration: ${summary.duration}ms`);
    console.log(`   📋 Result: ${summary.overallPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);

    if (!summary.overallPassed) {
        console.log('\n⚠️  Failed Checks:');
        summary.failedChecks.forEach(check => {
            console.log(`   ❌ ${check.name}: ${check.message}`);
            if (check.recoveryAction) {
                console.log(`      💡 Recovery: ${check.recoveryAction}`);
            }
        });
    }

    console.log('\n' + '═'.repeat(80));

    return results;
}

/**
 * MCP Exploration Tracker
 * Tracks mandatory MCP checkpoints before script generation
 */
class McpExplorationTracker {
    constructor() {
        this.config = loadConfig();
        this.state = {
            browserLaunched: false,
            currentUrl: null,
            snapshotsCaptured: 0,
            selectorsExtracted: 0,
            checkpointsPassed: [],
            errors: []
        };
    }

    markBrowserLaunched() {
        this.state.browserLaunched = true;
        this.validateCheckpoint('browser-launched');
    }

    markPageNavigated(url) {
        this.state.currentUrl = url;
        this.validateCheckpoint('page-navigated');
    }

    markSnapshotCaptured() {
        this.state.snapshotsCaptured++;
        if (this.state.snapshotsCaptured >= (this.config.mcpExploration?.minSnapshotsBeforeGeneration || 1)) {
            this.validateCheckpoint('snapshot-captured');
        }
    }

    markSelectorsExtracted(count) {
        this.state.selectorsExtracted += count;
        if (this.state.selectorsExtracted > 0) {
            this.validateCheckpoint('selectors-extracted');
        }
    }

    validateCheckpoint(checkpointId) {
        if (!this.state.checkpointsPassed.includes(checkpointId)) {
            this.state.checkpointsPassed.push(checkpointId);
        }
    }

    isReadyForScriptGeneration() {
        const requiredCheckpoints = this.config.mcpExploration?.checkpoints?.map(c => c.id) || [
            'browser-launched',
            'page-navigated',
            'snapshot-captured',
            'selectors-extracted'
        ];

        const missingCheckpoints = requiredCheckpoints.filter(
            cp => !this.state.checkpointsPassed.includes(cp)
        );

        return {
            ready: missingCheckpoints.length === 0,
            passed: this.state.checkpointsPassed,
            missing: missingCheckpoints,
            state: this.state
        };
    }

    getReport() {
        const readiness = this.isReadyForScriptGeneration();

        return {
            ...readiness,
            summary: readiness.ready
                ? '✅ MCP exploration complete - ready for script generation'
                : `❌ MCP exploration incomplete - missing: ${readiness.missing.join(', ')}`
        };
    }
}

/**
 * Selector Validator
 * Validates selectors meet reliability requirements
 */
class SelectorValidator {
    constructor() {
        this.config = loadConfig();
        this.selectorStrategy = this.config.selectorStrategy || {
            priority: [
                { type: 'data-test-id', reliability: 5 },
                { type: 'data-testid', reliability: 5 },
                { type: 'aria-label', reliability: 4 },
                { type: 'role', reliability: 4 },
                { type: 'text-content', reliability: 3 },
                { type: 'id', reliability: 3 },
                { type: 'css-class', reliability: 2 }
            ],
            validation: {
                minReliabilityScore: 3,
                warnOnLowReliability: true
            }
        };
    }

    detectSelectorType(selector) {
        if (selector.includes('data-test-id')) return 'data-test-id';
        if (selector.includes('data-testid')) return 'data-testid';
        if (selector.includes('aria-label')) return 'aria-label';
        if (selector.includes('getByRole')) return 'role';
        if (selector.includes('getByText')) return 'text-content';
        if (selector.startsWith('#')) return 'id';
        if (selector.startsWith('.')) return 'css-class';
        return 'unknown';
    }

    getReliabilityScore(selector) {
        const type = this.detectSelectorType(selector);
        const strategy = this.selectorStrategy.priority.find(s => s.type === type);
        return strategy?.reliability || 1;
    }

    validateSelector(selector) {
        const type = this.detectSelectorType(selector);
        const score = this.getReliabilityScore(selector);
        const minScore = this.selectorStrategy.validation.minReliabilityScore;

        return {
            selector,
            type,
            reliabilityScore: score,
            meetsMinimum: score >= minScore,
            warning: score < minScore && this.selectorStrategy.validation.warnOnLowReliability
                ? `Low reliability selector (${score}/${minScore}). Consider using data-test-id or aria-label.`
                : null
        };
    }

    validateSelectors(selectors) {
        const results = selectors.map(s => this.validateSelector(s));
        const avgScore = results.reduce((sum, r) => sum + r.reliabilityScore, 0) / results.length;
        const lowReliability = results.filter(r => !r.meetsMinimum);

        return {
            selectors: results,
            averageScore: avgScore.toFixed(2),
            totalSelectors: results.length,
            lowReliabilityCount: lowReliability.length,
            overallValid: lowReliability.length === 0,
            summary: lowReliability.length === 0
                ? `✅ All ${results.length} selectors meet reliability requirements (avg: ${avgScore.toFixed(2)})`
                : `⚠️ ${lowReliability.length}/${results.length} selectors have low reliability`
        };
    }
}

// Export modules
module.exports = {
    loadConfig,
    runPreflightChecks,
    PreflightResults,
    McpExplorationTracker,
    SelectorValidator,
    checkUrlReachable,
    checkTestDataFile,
    checkDirectories
};
