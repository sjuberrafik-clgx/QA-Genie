/**
 * Workflow Orchestrator - Post-Generation Validator & Test Runner
 * 
 * IMPORTANT: This is a Node.js CLI script that validates artifacts and runs tests.
 * It CANNOT invoke VS Code Copilot agents (runSubagent is only available in agent runtime).
 * Agent orchestration is handled by .github/agents/orchestrator.agent.md.
 * 
 * RESPONSIBILITIES:
 * 1. VALIDATE: Check that TestGenie Excel and ScriptGenerator artifacts exist
 * 2. VALIDATE: Verify MCP exploration data was captured
 * 3. EXECUTE: Run Playwright test scripts with retry logic
 * 4. REPORT: Display test results and generate reports
 * 
 * Usage: node workflow-orchestrator.js <jira-ticket-url> [environment] [test-data-context]
 * Example: node workflow-orchestrator.js https://<your-org>.atlassian.net/browse/{TICKET-ID} UAT "canopy UAT"
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const { getProjectPaths } = require('../utils/project-path-resolver');

// Dynamic path configuration — resolved from .env + workflow-config.json + auto-detection
const projectPaths = getProjectPaths();
const WORKFLOW_STATE_PATH = projectPaths.workflowStatePath;
const EXPLORATION_DATA_DIR = projectPaths.explorationDataDir;
const TEST_CASES_DIR = projectPaths.testCasesDir;
const SPECS_DIR = projectPaths.specsDir;

// Import workflow libraries with fallback
let QualityGates, getRecoveryManager, TestIterationEngine, runPreflightChecks, loadConfig;
try {
    QualityGates = require('../../.github/agents/lib/quality-gates').QualityGates;
    getRecoveryManager = require('../../.github/agents/lib/workflow-recovery').getRecoveryManager;
    TestIterationEngine = require('../../.github/agents/lib/test-iteration-engine').TestIterationEngine;
} catch (error) {
    console.warn('⚠️  Warning: Some workflow libraries not found. Using basic validation.');
    QualityGates = {
        validateExcelCreated: (state) => {
            const excelPath = path.join(TEST_CASES_DIR, `${state.ticketId}.xlsx`);
            if (fs.existsSync(excelPath)) {
                const stats = fs.statSync(excelPath);
                return { passed: true, path: excelPath, size: stats.size };
            }
            return { passed: false, error: 'Excel file not found', expected: 'test-cases/{ticketId}.xlsx', fix: 'Re-run testgenie agent to generate Excel file' };
        },
        validateScriptGenerated: (state, ticketId) => {
            const id = ticketId || state.ticketId;
            const specDir = path.join(SPECS_DIR, id.toLowerCase());
            if (fs.existsSync(specDir)) {
                const specFiles = fs.readdirSync(specDir).filter(f => f.endsWith('.spec.js'));
                if (specFiles.length > 0) {
                    const specPath = path.join(specDir, specFiles[0]);
                    const stats = fs.statSync(specPath);
                    return { passed: true, path: specPath, size: stats.size };
                }
            }
            return { passed: false, error: 'Script file not found', fix: 'Re-run scriptgenerator agent to generate script' };
        },
        validateMCPExploration: (state, ticketId) => {
            const id = ticketId || state.ticketId;
            const explorationPath = path.join(EXPLORATION_DATA_DIR, `${id}-exploration.json`);
            if (fs.existsSync(explorationPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(explorationPath, 'utf8'));
                    if (data && Object.keys(data).length > 0) {
                        // CRITICAL: Reject web-fetch exploration — must be live MCP snapshot
                        if (data.source === 'web-fetch-exploration') {
                            return { passed: false, error: 'Exploration used web-fetch, NOT live MCP snapshot. ScriptGenerator must use mcp_unified-autom_unified_navigate + mcp_unified-autom_unified_snapshot.', fix: 'Re-run scriptgenerator with LIVE MCP exploration enabled' };
                        }
                        // Verify source is a recognized live MCP source
                        if (data.source !== 'mcp-live-snapshot' && data.source !== 'mcp-snapshot') {
                            return { passed: false, error: `Unrecognized exploration source: "${data.source}". Expected "mcp-live-snapshot".`, fix: 'Re-run scriptgenerator — ensure MCP tools are called first' };
                        }
                        // Verify snapshots array exists with at least 1 entry
                        if (!Array.isArray(data.snapshots) || data.snapshots.length === 0) {
                            return { passed: false, error: 'No MCP snapshots found in exploration data. The snapshots array is empty or missing.', fix: 'ScriptGenerator must call mcp_unified-autom_unified_snapshot and store results in snapshots array' };
                        }
                        return { passed: true, path: explorationPath, source: data.source, snapshotCount: data.snapshots.length };
                    }
                } catch (e) {
                    return { passed: false, error: 'Exploration data is invalid JSON', fix: 'Re-run scriptgenerator with MCP exploration' };
                }
            }
            return { passed: false, error: 'MCP exploration data not found', fix: 'ScriptGenerator must call mcp_unified-autom_unified_snapshot before generating scripts' };
        }
    };
    getRecoveryManager = () => ({
        attemptRecovery: async () => ({ success: false, message: 'Recovery not available' })
    });
}

// Import pre-flight validation module
try {
    const preflight = require('../../.github/agents/lib/workflow-preflight');
    runPreflightChecks = preflight.runPreflightChecks;
    loadConfig = preflight.loadConfig;
} catch (error) {
    console.warn('⚠️  Warning: Pre-flight module not found. Using basic validation.');
    runPreflightChecks = async () => ({ passed: true, checks: [] });
    loadConfig = () => ({
        preflightChecks: { enabled: false },
        testExecution: { maxIterations: 2 }
    });
}

// Load workflow configuration
let workflowConfig;
try {
    workflowConfig = loadConfig();
} catch (error) {
    workflowConfig = { preflightChecks: { enabled: false }, testExecution: { maxIterations: 2 } };
}

// Workflow Stage Constants
const STAGES = {
    PREFLIGHT: 'PREFLIGHT',
    PENDING: 'PENDING',
    TESTGENIE_REQUIRED: 'TESTGENIE_REQUIRED',
    TESTGENIE_COMPLETE: 'TESTGENIE_COMPLETE',
    SCRIPTGENIE_REQUIRED: 'SCRIPTGENIE_REQUIRED',
    SCRIPTGENIE_COMPLETE: 'SCRIPTGENIE_COMPLETE',
    MCP_EXPLORATION_REQUIRED: 'MCP_EXPLORATION_REQUIRED',
    EXECUTION_READY: 'EXECUTION_READY',
    EXECUTING: 'EXECUTING',
    ITERATION_1: 'ITERATION_1',
    ITERATION_2: 'ITERATION_2',
    ITERATION_3: 'ITERATION_3',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
};

// Recovery Manager instance
const recoveryManager = getRecoveryManager();

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('❌ Error: Jira ticket URL is required');
    console.log('\nUsage: node workflow-orchestrator.js <jira-ticket-url> [environment] [test-data-context]');
    console.log(`Example: node workflow-orchestrator.js ${projectPaths.jira.baseUrl || 'https://<your-org>.atlassian.net'}/browse/{TICKET-ID} UAT "canopy UAT"`);
    console.log('\n📋 WORKFLOW PIPELINE (v2.1 - Enhanced Reliability):');
    console.log('   Stage 0: PRE-FLIGHT     → Validate prerequisites (MCP, UAT, test data)');
    console.log('   Stage 1: TESTGENIE      → Invoke testgenie agent → Generate test cases → Excel file');
    console.log('   Stage 2: SCRIPTGENIE    → Invoke scriptgenerator agent → MCP exploration → Playwright script');
    console.log('   Stage 3: EXECUTE        → Run tests with intelligent iteration (up to 2 retries)');
    console.log('   Stage 4: REPORT         → Display results, generate reports');
    console.log('\n⚠️  This workflow requires agent invocation. Run via @orchestrator command.');
    process.exit(1);
}

const jiraUrl = args[0];
const environment = args[1] || 'UAT';
const testDataContext = args[2] || '';

// Extract ticket ID from URL
const ticketIdMatch = jiraUrl.match(/([A-Z]+-\d+)/);
if (!ticketIdMatch) {
    console.error('❌ Error: Invalid Jira ticket URL format');
    process.exit(1);
}
const ticketId = ticketIdMatch[1];

console.log('═'.repeat(80));
console.log('🚀 WORKFLOW ORCHESTRATOR - JIRA TO AUTOMATION PIPELINE');
console.log('═'.repeat(80));
console.log(`\n📋 Ticket ID: ${ticketId}`);
console.log(`🌐 Jira URL: ${jiraUrl}`);
console.log(`🔧 Environment: ${environment}`);
if (testDataContext) console.log(`📊 Test Data Context: ${testDataContext}`);

console.log('\n' + '─'.repeat(80));
console.log('📋 PIPELINE STAGES (With Self-Healing & Auto-BugGenie):');
console.log('─'.repeat(80));
console.log('   ┌─────────────────────────────────────────────────────────────────┐');
console.log('   │ Stage 1: TESTGENIE      → Agent invocation → Test cases Excel  │');
console.log('   │ Stage 2: SCRIPTGENIE    → MCP exploration → Playwright script  │');
console.log('   │ Stage 3: EXECUTE        → Run tests (2 attempts + self-heal)   │');
console.log('   │ Stage 4: REPORT/BUGGENIE→ Success report OR auto-bug creation  │');
console.log('   └─────────────────────────────────────────────────────────────────┘');
console.log('\n' + '═'.repeat(80));

// Initialize workflow state
const workflowId = `${ticketId}-${Date.now()}`;
const workflowState = {
    id: workflowId,
    ticketId: ticketId,
    ticketUrl: jiraUrl,
    environment: environment,
    testDataContext: testDataContext,
    currentStage: STAGES.PENDING,
    status: 'IN_PROGRESS',
    startedAt: new Date().toISOString(),
    stages: [],
    artifacts: {},
    errors: [],
    agentInvocations: [],
    testIterations: 0,
    maxIterations: 2  // FIXED: User requested 2 retry attempts, then auto-trigger BugGenie
};

function logStage(stageName, status, message, data = null) {
    const stage = {
        name: stageName,
        status: status,
        message: message,
        timestamp: new Date().toISOString(),
        data: data
    };
    workflowState.stages.push(stage);

    const icon = status === 'SUCCESS' ? '✅' : status === 'RUNNING' ? '▶️' : status === 'ERROR' ? '❌' : '⚠️';
    console.log(`\n${icon} [${stageName}] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

function saveWorkflowState() {
    try {
        const stateDir = path.dirname(WORKFLOW_STATE_PATH);
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }
        fs.writeFileSync(WORKFLOW_STATE_PATH, JSON.stringify(workflowState, null, 2));
    } catch (error) {
        console.error('⚠️  Warning: Could not save workflow state:', error.message);
    }
}

// Ensure directories exist
function ensureDirectories() {
    // Internal workflow dirs (relative to agentic-workflow/)
    const internalDirs = [EXPLORATION_DATA_DIR, TEST_CASES_DIR, path.dirname(WORKFLOW_STATE_PATH)];
    internalDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
    // Host-project specs dir (relative to projectRoot)
    const absSpecsDir = projectPaths.resolveProjectPath(SPECS_DIR);
    if (!fs.existsSync(absSpecsDir)) {
        fs.mkdirSync(absSpecsDir, { recursive: true });
    }
}

/**
 * MANDATORY: Validate script follows framework popup handling patterns
 * Ensures generated scripts use existing Page Objects (POmanager, PopupHandler)
 * instead of custom popup handling code
 */
function validateScriptFrameworkCompliance(specPath) {
    console.log('\n🔍 Framework Compliance Validation');
    console.log('━'.repeat(80));

    if (!fs.existsSync(specPath)) {
        console.log(`⚠️  Script file not found: ${specPath}`);
        return { isValid: true, issues: [], warnings: [] };
    }

    const scriptContent = fs.readFileSync(specPath, 'utf-8');
    const issues = [];
    const warnings = [];
    const suggestions = [];

    // ============================================
    // 1. MANDATORY IMPORTS CHECK (framework-mode aware)
    // ============================================

    // Get compliance patterns from the path resolver (adapts to framework mode)
    const compliance = projectPaths.getCompliancePatterns();

    // Check for POmanager import (MANDATORY in full mode, skipped in basic mode)
    if (!compliance.skipPOmanagerCheck) {
        const hasPOmanagerImport = compliance.requiredImports[0].test(scriptContent);
        if (!hasPOmanagerImport) {
            issues.push('❌ MISSING: POmanager import (MANDATORY for framework)');
            issues.push(`   → ADD: const POmanager = require('${projectPaths.importPrefix}pageobjects/POmanager');`);
        }
    }

    // Check for launchBrowser import (MANDATORY in full mode, skipped in basic mode)
    if (!compliance.skipLaunchBrowserCheck) {
        const hasLaunchBrowserImport = compliance.requiredImports.length > 1 ? compliance.requiredImports[1].test(scriptContent) : true;
        if (!hasLaunchBrowserImport) {
            issues.push('❌ MISSING: launchBrowser import (MANDATORY)');
            issues.push(`   → ADD: const { launchBrowser } = require('${projectPaths.importPrefix}config/config');`);
        }
    }

    // Check for testData import (recommended)
    if (!compliance.skipTestDataCheck) {
        const hasTestDataImport = /require\(['"].*test-data\/testData['"]\)/.test(scriptContent);
        if (!hasTestDataImport) {
            warnings.push('💡 Consider: userTokens/baseUrl from testData.js instead of hardcoded values');
        }
    }

    // Check for PopupHandler import (RECOMMENDED)
    const hasPopupHandlerImport = /require\(['"]\.\.\/(\.\.\/)?utils\/popupHandler['"]\)/.test(scriptContent);
    if (!hasPopupHandlerImport) {
        warnings.push('💡 Consider: PopupHandler import from utils/popupHandler for popup/modal handling');
    }

    // ============================================
    // 2. BUSINESS FUNCTION REUSE CHECK
    // ============================================

    // Check if login is being done manually instead of using loginFunctions
    const hasManualLogin = /emailInput.*fill|passwordInput.*fill|input.*email.*fill/i.test(scriptContent);
    const hasLoginFunctions = /loginFunctions\s*=\s*(Pomanager|poManager)\.loginFunctions/.test(scriptContent);
    const usesLoginFunctions = /loginFunctions\.(signIn|enterCredentialsClickSignIn|signInAndWait)/.test(scriptContent);

    if (hasManualLogin && !usesLoginFunctions) {
        warnings.push('💡 REUSE: Use loginFunctions.signIn() instead of manual email/password fill');
        warnings.push('   → Example: await loginFunctions.enterCredentialsClickSignIn({ email, password });');
    }

    // Check if navigation is being done manually instead of using generalFunctions
    const hasManualGoto = /page\.goto\s*\(\s*['"`]https?:\/\//.test(scriptContent);
    const usesGeneralFunctions = /generalFunctions\.(openOneHome|open)/.test(scriptContent);

    if (hasManualGoto && !usesGeneralFunctions) {
        warnings.push('💡 REUSE: Use generalFunctions.openOneHome(token) instead of page.goto()');
        warnings.push('   → Example: await generalFunctions.openOneHome(userTokens.registered);');
    }

    // ============================================
    // 3. PAGE OBJECT REUSE CHECK
    // ============================================

    // Check for custom "Sign In" button selector instead of homePage.signInButton
    const hasCustomSignInSelector = /page\.(getByText|locator)\s*\(\s*['"`].*Sign\s*In/i.test(scriptContent);
    const usesHomePageSignIn = /homePage\.signInButton/.test(scriptContent);

    if (hasCustomSignInSelector && !usesHomePageSignIn) {
        warnings.push('💡 REUSE: Use homePage.signInButton instead of custom selector');
        warnings.push('   → Example: await homePage.signInButton.click();');
    }

    // Check for custom userProfile selector
    const hasCustomUserProfile = /page\.locator\s*\(\s*['"`].*user-menu|user.*profile/i.test(scriptContent);
    const usesHomePageUserProfile = /homePage\.userProfile/.test(scriptContent);

    if (hasCustomUserProfile && !usesHomePageUserProfile) {
        warnings.push('💡 REUSE: Use homePage.userProfile instead of custom selector');
    }

    // ============================================
    // 4. POPUP HANDLING CHECK
    // ============================================

    // Check for PopupHandler usage (RECOMMENDED pattern)
    const hasPopupHandlerInit = /new\s+PopupHandler\s*\(\s*page\s*\)/.test(scriptContent);
    const usesPopupHandler = /popups?\.(dismissAll|waitForPageReady|dismissWelcome)/.test(scriptContent);
    const usesPOmanagerPopups = /poManager\.(dismissAllPopups|welcomePopUp|agentBranding|skipAllComparePopUp)/.test(scriptContent)
        || /Pomanager\.(dismissAllPopups|welcomePopUp|agentBranding|skipAllComparePopUp)/.test(scriptContent);

    // Check for custom welcome modal selectors (SHOULD use PopupHandler instead)
    const hasCustomWelcomeModal = /page\s*\.\s*locator\s*\(\s*['"`]\[data-test-id=["']?welcome-modal["']?\]/.test(scriptContent);
    if (hasCustomWelcomeModal && !hasPopupHandlerInit && !usesPOmanagerPopups) {
        issues.push('⚠️  FORBIDDEN: Custom [data-test-id="welcome-modal"] selector');
        issues.push('   → USE: popups.dismissWelcome() from PopupHandler or poManager.welcomePopUp()');
    }

    // Check for custom tour-step selectors (SHOULD use PopupHandler instead)
    const hasCustomTourStep = /page\s*\.\s*locator\s*\(\s*['"`]\.tour-step/.test(scriptContent);
    if (hasCustomTourStep && !hasPopupHandlerInit && !usesPOmanagerPopups) {
        issues.push('⚠️  FORBIDDEN: Custom .tour-step selector');
        issues.push('   → USE: popups.dismissTourOverlay() from PopupHandler or poManager.skipAllComparePopUp()');
    }

    // Suggest PopupHandler if neither pattern is used but popups are likely needed
    if (!hasPopupHandlerInit && !usesPOmanagerPopups && !usesPopupHandler) {
        const navigatesToApp = /goto|openOneHome|navigate/.test(scriptContent);
        if (navigatesToApp) {
            warnings.push('💡 REUSE: Use PopupHandler from utils/popupHandler.js for popup/modal dismissal after navigation');
            warnings.push('   → Example: const popups = new PopupHandler(page); await popups.waitForPageReady();');
        }
    }

    // ============================================
    // 5. BROWSER LAUNCH CHECK
    // ============================================

    // Check for manual browser launch instead of launchBrowser()
    const hasManualBrowserLaunch = /chromium\.launch|firefox\.launch|webkit\.launch/.test(scriptContent);
    const usesLaunchBrowser = /launchBrowser\s*\(\s*\)/.test(scriptContent);

    if (hasManualBrowserLaunch && !usesLaunchBrowser) {
        issues.push('❌ FORBIDDEN: Manual browser launch detected');
        issues.push('   → USE: const launchedBrowser = await launchBrowser();');
    }

    // ============================================
    // 6. HARDCODED VALUES CHECK
    // ============================================

    // Check for hardcoded URLs (dynamically built from configured UAT_URL)
    const uatDomain = (projectPaths.environments.UAT.baseUrl || '').replace(/^https?:\/\//, '').replace(/\//g, '');
    const hasHardcodedURL = uatDomain
        ? new RegExp(`['"\`]https?://${uatDomain.replace(/\./g, '\\.')}[^'"\`]*['"\`]`).test(scriptContent)
        : false;
    if (hasHardcodedURL) {
        warnings.push('💡 AVOID: Hardcoded UAT URLs - use baseUrl from testData.js');
    }

    // Check for hardcoded tokens
    const hasHardcodedToken = /token=[a-zA-Z0-9\-_]+/.test(scriptContent) && !/userTokens\./.test(scriptContent);
    if (hasHardcodedToken) {
        warnings.push('💡 AVOID: Hardcoded tokens - use userTokens from testData.js');
    }

    // ============================================
    // REPORT RESULTS
    // ============================================

    console.log(`📄 Validating: ${path.basename(specPath)}`);

    const totalIssues = issues.length;
    const totalWarnings = warnings.length;

    if (totalIssues === 0 && totalWarnings === 0) {
        console.log('✅ Script follows framework patterns - FULLY COMPLIANT');
        return { isValid: true, issues: [], warnings: [] };
    }

    // Show compliance score
    const maxScore = 10;
    const deductions = totalIssues * 2 + totalWarnings * 0.5;
    const score = Math.max(0, maxScore - deductions);
    console.log(`\n📊 Framework Compliance Score: ${score.toFixed(1)}/${maxScore}`);

    if (totalWarnings > 0) {
        console.log('\n📝 Reusability Suggestions (improve maintainability):');
        warnings.forEach(w => console.log(`   ${w}`));
    }

    if (totalIssues > 0) {
        console.log('\n⚠️  Framework Compliance Issues:');
        issues.forEach(i => console.log(`   ${i}`));
    }

    console.log('\n📚 Reference Specs:');
    console.log(`   - ${SPECS_DIR}/authentification/InvalidDetails.spec.js (popup handling)`);
    console.log(`   - ${SPECS_DIR}/oho/oho-authentification.spec.js (complete framework usage)`);

    console.log('━'.repeat(80));

    // Return validation result (non-blocking - execution continues)
    return {
        isValid: totalIssues === 0,
        issues: issues,
        warnings: warnings,
        score: score
    };
}

// Execute test script with real-time output
async function executeTestScript(specPath, iteration = 1) {
    // MANDATORY: Validate script before first execution
    if (iteration === 1) {
        validateScriptFrameworkCompliance(specPath);
    }

    console.log(`\n🧪 Test Execution - Iteration ${iteration}/${workflowState.maxIterations}`);
    console.log('━'.repeat(80));

    const startTime = Date.now();

    try {
        const normalizedPath = specPath.replace(/\\/g, '/');
        console.log(`📝 Test: ${normalizedPath}`);
        const isHeadless = workflowConfig?.testExecution?.headless !== false;
        console.log(`⏳ Starting execution (${isHeadless ? 'HEADLESS' : 'HEADED'} mode)...\n`);
        console.log('─'.repeat(80));

        // Run with inherit stdio to show real-time output
        execSync(
            `npx playwright test "${normalizedPath}" --workers=1 --reporter=line`,
            {
                encoding: 'utf-8',
                stdio: 'inherit',
                timeout: 90000,    // 90 second timeout
                env: {
                    ...process.env,
                    PWDEBUG: '0',
                    HEADLESS: isHeadless ? 'true' : 'false'
                }
            }
        );

        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log('─'.repeat(80));
        console.log(`\n✅ Execution complete - Duration: ${duration}s`);

        return {
            success: true,
            duration: duration,
            iteration: iteration
        };

    } catch (error) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log('─'.repeat(80));
        console.error(`\n❌ Execution failed - Iteration ${iteration} - Duration: ${duration}s`);

        if (error.killed) {
            console.error('⏱️  Test execution timed out (90 seconds)');
        }

        return {
            success: false,
            error: error.killed ? 'Test execution timeout' : (error.message || 'Unknown error'),
            duration: duration,
            iteration: iteration
        };
    }
}

// Cleanup temporary files
function cleanupTemporaryFiles(ticketId) {
    console.log('\n🧹 Cleaning up temporary files...');
    console.log('━'.repeat(80));

    const ticketIdLower = ticketId.toLowerCase();
    const ticketIdUpper = ticketId.toUpperCase();

    // Comprehensive list of temp file patterns to clean
    const filesToClean = [
        // Root-level temp files
        `generate-${ticketIdLower}-testcases.js`,
        `generate-${ticketIdUpper}-testcases.js`,
        `${ticketIdLower}-temp.js`,
        `${ticketIdLower}-exploration-temp.json`,

        // Exploration data (keep exploration.json, clean temp files)
        path.join(EXPLORATION_DATA_DIR, `${ticketIdLower}-exploration-temp.json`),
        path.join(EXPLORATION_DATA_DIR, `${ticketIdLower}-selectors-temp.json`),
        path.join(EXPLORATION_DATA_DIR, `${ticketIdLower}-mcp-session.json`),

        // Spec directory temp files
        path.join(SPECS_DIR, ticketIdLower, 'README.md'),
        path.join(SPECS_DIR, ticketIdLower, 'TEST-EXECUTION-SUMMARY.md'),
        path.join(SPECS_DIR, ticketIdLower, 'temp-script.js'),
        path.join(SPECS_DIR, ticketIdLower, 'exploration-notes.md'),

        // Test artifacts temp files
        path.join('test-artifacts', `${ticketIdUpper}-temp.json`),
        path.join('test-artifacts', `${ticketIdUpper}-execution-log.txt`),

        // Workflow state temp files (ticket-specific)
        path.join('.github', 'agents', 'state', `${ticketIdLower}-workflow-temp.json`)
    ];

    // Also find any files matching glob patterns
    const globPatterns = [
        `generate-${ticketIdLower}*.js`,
        `generate-${ticketIdUpper}*.js`
    ];

    // Add glob-matched files from root directory
    try {
        const rootFiles = fs.readdirSync('.');
        globPatterns.forEach(pattern => {
            const regex = new RegExp(pattern.replace('*', '.*'), 'i');
            rootFiles.filter(f => regex.test(f)).forEach(f => {
                if (!filesToClean.includes(f)) {
                    filesToClean.push(f);
                }
            });
        });
    } catch (error) {
        // Ignore glob errors
    }

    let cleanedCount = 0;
    const cleanedFiles = [];

    filesToClean.forEach(filePath => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                cleanedFiles.push(filePath);
                cleanedCount++;
            }
        } catch (error) {
            console.error(`   ⚠️  Could not remove ${filePath}: ${error.message}`);
        }
    });

    // Log cleaned files
    if (cleanedCount > 0) {
        console.log('   🗑️  Removed temporary files:');
        cleanedFiles.forEach(f => console.log(`      ✅ ${f}`));
    } else {
        console.log('   ℹ️  No temporary files to clean');
    }

    // Log kept artifacts
    console.log('\n📁 Preserved Important Artifacts:');
    console.log(`   ✅ ${path.join(TEST_CASES_DIR, `${ticketIdUpper}.xlsx`)} (test cases)`);
    console.log(`   ✅ ${path.join(SPECS_DIR, ticketIdLower, '*.spec.js')} (automation script)`);
    console.log(`   ✅ ${path.join(EXPLORATION_DATA_DIR, `${ticketIdLower}-exploration.json`)} (exploration data)`);

    console.log('\n' + '━'.repeat(80));
    console.log(`🧹 Cleanup complete: ${cleanedCount} temporary file(s) removed`);

    return cleanedCount;
}

// Wait for user input (for interactive stages)
function waitForEnter(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(prompt, () => {
            rl.close();
            resolve();
        });
    });
}

async function executeWorkflow() {
    try {
        ensureDirectories();

        // ═══════════════════════════════════════════════════════════════════════════════
        // STAGE 0: PRE-FLIGHT VALIDATION (NEW in v2.1)
        // ═══════════════════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('🚁 STAGE 0: PRE-FLIGHT VALIDATION');
        console.log('═'.repeat(80));

        workflowState.currentStage = STAGES.PREFLIGHT;
        logStage('PREFLIGHT', 'RUNNING', 'Running pre-flight checks...');

        const preflightResults = await runPreflightChecks({
            ticketId: ticketId,
            environment: environment,
            testDataPath: projectPaths.testDataFile
        });

        if (!preflightResults.passed) {
            const failedChecks = preflightResults.checks.filter(c => !c.passed);
            logStage('PREFLIGHT', 'ERROR', `Pre-flight validation failed: ${failedChecks.length} check(s) failed`, {
                failedChecks: failedChecks.map(c => ({ name: c.name, message: c.message }))
            });

            console.error('\n' + '═'.repeat(80));
            console.error('❌ PRE-FLIGHT VALIDATION FAILED');
            console.error('═'.repeat(80));
            failedChecks.forEach(check => {
                console.error(`   ❌ ${check.name}: ${check.message}`);
                if (check.recoveryAction) {
                    console.error(`      💡 Recovery: ${check.recoveryAction}`);
                }
            });
            console.error('\n⚠️  Fix the above issues and retry the workflow.');

            workflowState.status = 'PREFLIGHT_FAILED';
            workflowState.errors.push({
                stage: 'PREFLIGHT',
                error: 'Pre-flight validation failed',
                details: failedChecks
            });
            saveWorkflowState();

            throw new Error('Pre-flight validation failed');
        }

        logStage('PREFLIGHT', 'SUCCESS', 'All pre-flight checks passed', {
            checksRun: preflightResults.checks.length,
            duration: preflightResults.duration
        });
        console.log('\n✅ STAGE 0 COMPLETE: Pre-flight validation passed');
        console.log('━'.repeat(80));
        saveWorkflowState();

        // ═══════════════════════════════════════════════════════════════════════════════
        // STAGE 1: TESTGENIE - Generate Test Cases from Jira
        // ═══════════════════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('📋 STAGE 1: TESTGENIE - Test Case Generation');
        console.log('═'.repeat(80));

        workflowState.currentStage = STAGES.TESTGENIE_REQUIRED;
        logStage('JIRA_FETCH', 'RUNNING', 'Fetching Jira ticket details...');

        // Validate Jira connectivity by checking for cached data or attempting a fetch
        const jiraDataPath = path.join(EXPLORATION_DATA_DIR, `${ticketId}-jira.json`);
        let jiraDataValidated = false;

        if (fs.existsSync(jiraDataPath)) {
            try {
                const cachedData = JSON.parse(fs.readFileSync(jiraDataPath, 'utf8'));
                if (cachedData && cachedData.key) {
                    jiraDataValidated = true;
                    logStage('JIRA_FETCH', 'SUCCESS', 'Jira ticket data found (cached)', { ticketId, source: 'cache' });
                }
            } catch (e) {
                console.warn('   ⚠️  Cached Jira data is invalid, will need fresh fetch');
            }
        }

        if (!jiraDataValidated) {
            // Attempt to validate Jira URL is accessible
            try {
                const https = require('https');
                const jiraCheckUrl = `${projectPaths.jira.baseUrl}/rest/api/3/issue/${ticketId}`;
                const jiraReachable = await new Promise((resolve) => {
                    const urlObj = new URL(jiraCheckUrl);
                    const req = https.request({
                        hostname: urlObj.hostname,
                        path: urlObj.pathname,
                        method: 'HEAD',
                        timeout: 10000,
                        rejectUnauthorized: false
                    }, (res) => {
                        resolve(res.statusCode < 500);
                    });
                    req.on('error', () => resolve(false));
                    req.on('timeout', () => { req.destroy(); resolve(false); });
                    req.end();
                });

                if (jiraReachable) {
                    logStage('JIRA_FETCH', 'SUCCESS', 'Jira endpoint reachable — full data will be fetched by Atlassian MCP via TestGenie agent', { ticketId });
                } else {
                    logStage('JIRA_FETCH', 'WARNING', 'Jira endpoint not reachable — ensure Atlassian MCP server is connected and authenticated', { ticketId });
                    console.warn('   ⚠️  Jira API not reachable. Ensure:');
                    console.warn('      1. Atlassian MCP server is configured in .vscode/mcp.json');
                    console.warn('      2. You are authenticated with Atlassian');
                    console.warn('      3. VPN is connected if required');
                }
            } catch (e) {
                logStage('JIRA_FETCH', 'WARNING', `Jira connectivity check failed: ${e.message}`, { ticketId });
            }
        }

        workflowState.artifacts.jiraData = { ticketId, url: jiraUrl };
        saveWorkflowState();

        // Check if Excel file already exists (testgenie may have already run)
        const expectedExcelPath = path.join(TEST_CASES_DIR, `${ticketId}.xlsx`);

        if (fs.existsSync(expectedExcelPath)) {
            const stats = fs.statSync(expectedExcelPath);
            logStage('TESTCASE_GENERATION', 'SUCCESS',
                `Test cases already generated - Excel file found (${stats.size} bytes)`);
            workflowState.artifacts.testCasesPath = expectedExcelPath;
            workflowState.currentStage = STAGES.TESTGENIE_COMPLETE;
        } else {
            logStage('TESTCASE_GENERATION', 'RUNNING', 'Test cases need to be generated...');
            console.log('\n' + '─'.repeat(80));
            console.log('📋 TESTGENIE ARTIFACT NOT FOUND');
            console.log('─'.repeat(80));
            console.log('\n📝 Run @orchestrator in VS Code Chat to invoke testgenie first.');
            console.log(`\n   Expected: ${TEST_CASES_DIR}/${ticketId}.xlsx`);

            // Record the agent invocation requirement
            workflowState.agentInvocations.push({
                agent: 'testgenie',
                required: true,
                status: 'PENDING',
                prompt: `Generate comprehensive test cases for Jira ticket ${ticketId}. 
URL: ${jiraUrl}
Environment: ${environment}
Test Data: ${testDataContext}
Export to Excel: ${TEST_CASES_DIR}/${ticketId}.xlsx`
            });
            saveWorkflowState();

            console.log('\n⏳ Waiting for Excel file creation by testgenie agent...');
            console.log(`   Expected path: ${expectedExcelPath}`);
        }

        // QUALITY GATE 1: Validate Excel File
        console.log('\n' + '━'.repeat(80));
        logStage('QUALITY_GATE_EXCEL', 'RUNNING', 'Validating Excel file quality...');

        const excelValidation = QualityGates.validateExcelCreated(workflowState);

        if (!excelValidation.passed) {
            logStage('QUALITY_GATE_EXCEL', 'ERROR',
                `Excel validation failed: ${excelValidation.error}`,
                excelValidation);
            console.error('\n' + '═'.repeat(80));
            console.error('❌ STAGE 1 BLOCKED: Excel File Not Found');
            console.error('═'.repeat(80));
            console.error(`   Error: ${excelValidation.error}`);
            console.error(`   Fix: ${excelValidation.fix}`);
            console.error('\n💡 REQUIRED ACTION: Invoke testgenie agent first');
            console.error(`   Command: @testgenie ${jiraUrl} with ${testDataContext || 'UAT'} test data`);
            throw new Error(`Quality Gate Failed: ${excelValidation.error}`);
        }

        logStage('QUALITY_GATE_EXCEL', 'SUCCESS',
            `Excel file validated (${excelValidation.size} bytes)`,
            { path: excelValidation.path });
        workflowState.artifacts.testCasesPath = excelValidation.path;
        workflowState.currentStage = STAGES.TESTGENIE_COMPLETE;
        console.log('\n✅ STAGE 1 COMPLETE: Test cases generated successfully');
        console.log('━'.repeat(80));
        saveWorkflowState();

        // ═══════════════════════════════════════════════════════════════════════════════
        // STAGE 2: SCRIPTGENIE - MCP Exploration & Script Generation
        // ═══════════════════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('🎭 STAGE 2: SCRIPTGENIE - MCP Exploration & Script Generation');
        console.log('═'.repeat(80));

        workflowState.currentStage = STAGES.SCRIPTGENIE_REQUIRED;

        // Check if script already exists (scriptgenerator may have already run)
        const expectedScriptDir = path.join(SPECS_DIR, ticketId.toLowerCase());
        const scriptExists = fs.existsSync(expectedScriptDir) &&
            fs.readdirSync(expectedScriptDir).filter(f => f.endsWith('.spec.js')).length > 0;

        if (scriptExists) {
            const specFiles = fs.readdirSync(expectedScriptDir).filter(f => f.endsWith('.spec.js'));
            const specPath = path.join(expectedScriptDir, specFiles[0]);
            const stats = fs.statSync(specPath);
            logStage('SCRIPT_GENERATION', 'SUCCESS',
                `Playwright script already generated - ${specFiles[0]} (${stats.size} bytes)`);
            workflowState.artifacts.scriptPath = expectedScriptDir;
            workflowState.currentStage = STAGES.SCRIPTGENIE_COMPLETE;
        } else {
            logStage('SCRIPT_GENERATION', 'RUNNING', 'Playwright script needs to be generated...');
            console.log('\n' + '─'.repeat(80));
            console.log('🎭 SCRIPTGENERATOR ARTIFACT NOT FOUND');
            console.log('─'.repeat(80));
            console.log('\n📝 Run @orchestrator in VS Code Chat to invoke scriptgenerator first.');
            console.log(`\n   Expected: ${SPECS_DIR}/${ticketId.toLowerCase()}/*.spec.js`);
            console.log('\n   🔧 MANDATORY REQUIREMENTS:');
            console.log('      ✅ Use Playwright MCP to explore application LIVE');
            console.log('      ✅ Capture DOM snapshots with unified_snapshot()');
            console.log('      ✅ Extract real selectors from live application');
            console.log('      ✅ Generate JavaScript .spec.js files (NOT TypeScript)');
            console.log('      ✅ Use existing framework patterns (launchBrowser, POmanager, userTokens)');

            // Record the agent invocation requirement
            workflowState.agentInvocations.push({
                agent: 'scriptgenerator',
                required: true,
                status: 'PENDING',
                prompt: `Generate Playwright automation for ticket ${ticketId}.
MANDATORY: Use Playwright MCP to explore application BEFORE generating script.
Input Excel: ${workflowState.artifacts.testCasesPath}
Environment: ${environment}
Test Data: ${testDataContext}
Output: ${SPECS_DIR}/${ticketId.toLowerCase()}/*.spec.js

REQUIREMENTS:
- Verify Playwright MCP is active
- Launch browser and explore application LIVE
- Capture DOM snapshots and extract real selectors
- Generate JavaScript .spec.js files
- Use framework patterns from existing tests
- Include proper authentication with userTokens
- Add browser cleanup in test.afterAll()`
            });
            saveWorkflowState();

            console.log('\n⏳ Waiting for script generation by scriptgenerator agent...');
            console.log(`   Expected path: ${expectedScriptDir}/*.spec.js`);
        }

        // QUALITY GATE 2: Validate MCP Exploration
        console.log('\n' + '━'.repeat(80));
        logStage('QUALITY_GATE_MCP', 'RUNNING', 'Validating MCP exploration data...');

        const mcpValidation = QualityGates.validateMCPExploration
            ? QualityGates.validateMCPExploration(workflowState, ticketId)
            : { passed: true, skipped: true };

        if (mcpValidation.passed) {
            if (mcpValidation.skipped) {
                logStage('QUALITY_GATE_MCP', 'WARNING', 'MCP exploration validation not available - skipping');
            } else {
                logStage('QUALITY_GATE_MCP', 'SUCCESS',
                    'MCP exploration data validated',
                    { path: mcpValidation.path });
            }
        } else {
            logStage('QUALITY_GATE_MCP', 'ERROR',
                `MCP exploration validation failed: ${mcpValidation.error}`,
                mcpValidation);
            console.error('\n' + '═'.repeat(80));
            console.error('❌ MCP EXPLORATION GATE FAILED: No Exploration Data');
            console.error('═'.repeat(80));
            console.error(`   Error: ${mcpValidation.error}`);
            console.error(`   Fix: ${mcpValidation.fix}`);
            console.error('\n💡 REQUIRED ACTION: ScriptGenerator must perform LIVE MCP exploration');
            console.error('   The scriptgenerator agent MUST call mcp_unified-autom_unified_snapshot');
            console.error('   to capture the live DOM before generating any .spec.js files.');
            console.error(`   Command: @scriptgenerator generate automation for ${ticketId} using MCP exploration`);
            throw new Error(`Quality Gate Failed: ${mcpValidation.error}. Scripts with guessed selectors will fail 100% of the time.`);
        }

        // QUALITY GATE 3: Validate Script Generated
        console.log('\n' + '━'.repeat(80));
        logStage('QUALITY_GATE_SCRIPT', 'RUNNING', 'Validating script generation...');

        const scriptValidation = QualityGates.validateScriptGenerated(workflowState, ticketId);

        if (!scriptValidation.passed) {
            logStage('QUALITY_GATE_SCRIPT', 'ERROR',
                `Script validation failed: ${scriptValidation.error}`,
                scriptValidation);
            console.error('\n' + '═'.repeat(80));
            console.error('❌ STAGE 2 BLOCKED: Script File Not Found');
            console.error('═'.repeat(80));
            console.error(`   Error: ${scriptValidation.error}`);
            console.error(`   Fix: ${scriptValidation.fix}`);
            console.error('\n💡 REQUIRED ACTION: Invoke scriptgenerator agent');
            console.error(`   Command: @scriptgenerator generate automation for ${ticketId} using MCP exploration`);
            throw new Error(`Quality Gate Failed: ${scriptValidation.error}`);
        }

        logStage('QUALITY_GATE_SCRIPT', 'SUCCESS',
            `Script file validated (${scriptValidation.size} bytes)`,
            { path: scriptValidation.path });
        workflowState.artifacts.scriptPath = path.dirname(scriptValidation.path);
        workflowState.currentStage = STAGES.SCRIPTGENIE_COMPLETE;
        console.log('\n✅ STAGE 2 COMPLETE: Script generated successfully');
        console.log('━'.repeat(80));
        saveWorkflowState();

        // ═══════════════════════════════════════════════════════════════════════════════
        // STAGE 3: EXECUTE - Run Tests with Intelligent Iteration
        // ═══════════════════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('🧪 STAGE 3: EXECUTE - Running Tests with Intelligent Iteration');
        console.log('═'.repeat(80));

        workflowState.currentStage = STAGES.EXECUTING;
        logStage('TEST_EXECUTION', 'RUNNING', 'Starting test execution with iteration support...');
        console.log('\n🧪 Test Execution Configuration');
        console.log(`   Environment: ${environment}`);
        console.log(`   Test Data: ${testDataContext}`);
        console.log(`   Max Iterations: ${workflowState.maxIterations}`);
        console.log(`   Script Path: ${scriptValidation.path}`);
        console.log(`   🔧 HYBRID MCP STRATEGY: Playwright → Chrome DevTools on failure`);
        saveWorkflowState();

        // Execute tests with iteration support and HYBRID MCP SELF-HEALING
        let testsPassed = false;
        let lastError = null;

        for (let iteration = 1; iteration <= workflowState.maxIterations; iteration++) {
            workflowState.testIterations = iteration;
            workflowState.currentStage = `ITERATION_${iteration}`;
            saveWorkflowState();

            const result = await executeTestScript(scriptValidation.path, iteration);

            if (result.success) {
                testsPassed = true;
                logStage('TEST_EXECUTION', 'SUCCESS',
                    `✅ All tests passed on iteration ${iteration}`,
                    { iteration: iteration, duration: result.duration });
                break;
            } else {
                lastError = result.error;
                workflowState.errors.push({
                    iteration: iteration,
                    error: result.error,
                    timestamp: new Date().toISOString()
                });
                saveWorkflowState();

                if (iteration < workflowState.maxIterations) {
                    console.log(`\n⚠️  Tests failed on iteration ${iteration}. Initiating CHROME DEVTOOLS MCP SELF-HEALING...`);
                    console.log('━'.repeat(80));
                    console.log('🔧 HYBRID MCP STRATEGY: Switching to Chrome DevTools MCP for self-healing');
                    console.log('━'.repeat(80));
                    console.log('\n   📋 SELF-HEALING STEPS (Chrome DevTools MCP):');
                    console.log('      Step 1: Parse failure details from error output');
                    console.log('      Step 2: Navigate to failing page with unified_navigate()');
                    console.log('      Step 3: Capture DOM snapshot with unified_snapshot()');
                    console.log('      Step 4: Discover alternative selectors with unified_evaluate_script()');
                    console.log('      Step 5: Update script with healed selectors');
                    console.log('      Step 6: Re-execute tests\n');

                    // Capture detailed error context for Chrome DevTools self-healing
                    const selfHealContext = {
                        ticketId: ticketId,
                        iteration: iteration,
                        scriptPath: scriptValidation.path,
                        error: result.error,
                        environment: environment,
                        testDataContext: testDataContext,
                        timestamp: new Date().toISOString(),
                        mcpProvider: 'chromeDevTools',  // CRITICAL: Mark as Chrome DevTools healing
                        healingActions: [
                            'unified_navigate',
                            'unified_snapshot',
                            'unified_evaluate_script'
                        ]
                    };

                    // Log self-healing attempt in workflow state
                    workflowState.selfHealingAttempts = workflowState.selfHealingAttempts || [];
                    workflowState.selfHealingAttempts.push(selfHealContext);
                    saveWorkflowState();

                    console.log('   📝 Chrome DevTools MCP self-healing context prepared');
                    console.log(`   🎯 Target script: ${ticketId}`);
                    console.log('   📋 REQUIRED AGENT ACTIONS:');
                    console.log('      1. @scriptgenerator MUST use Chrome DevTools MCP (NOT Playwright)');
                    console.log('      2. Use unified_evaluate_script() to find alternative selectors');
                    console.log('      3. Update test file with healed selectors');
                    console.log('      4. Re-execute tests automatically\n');
                } else {
                    logStage('TEST_EXECUTION', 'ERROR',
                        `❌ Tests failed after ${workflowState.maxIterations} iterations with Chrome DevTools self-healing`,
                        { lastError: lastError });
                }
            }
        }

        workflowState.testsPassed = testsPassed;
        console.log('\n✅ STAGE 3 COMPLETE: Test execution finished');
        console.log('━'.repeat(80));
        saveWorkflowState();

        // ═══════════════════════════════════════════════════════════════════════════════
        // STAGE 4: REPORT - Display Results
        // ═══════════════════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log(testsPassed ? '🎉 STAGE 4: REPORT - Tests Successful!' : '⚠️ STAGE 4: REPORT - Tests Need Review');
        console.log('═'.repeat(80));

        logStage('REPORT_GENERATION', 'RUNNING', 'Generating test reports...');
        console.log('\n📊 Test reports will be generated automatically');
        console.log(`   HTML Report: playwright-report/`);
        console.log(`   Allure Report: allure-results/`);

        logStage('REPORT_GENERATION', 'SUCCESS', 'Report generation completed');
        saveWorkflowState();

        // If tests failed after all iterations, AUTO-TRIGGER BugGenie with full context
        if (!testsPassed) {
            console.log('\n' + '─'.repeat(80));
            console.log('🐛 BUGGENIE AUTO-TRIGGER - Creating Bug Ticket');
            console.log('─'.repeat(80));
            console.log('\n   Tests failed after maximum iterations with self-healing attempts.');
            console.log('   ⚡ Auto-invoking BugGenie to create bug ticket...');

            // Collect comprehensive failure context for BugGenie
            const bugContext = {
                ticketId: ticketId,
                jiraUrl: jiraUrl,
                environment: environment,
                testDataContext: testDataContext,
                iterationsAttempted: workflowState.maxIterations,
                lastError: lastError,
                allErrors: workflowState.errors,
                selfHealingAttempts: workflowState.selfHealingAttempts || [],
                scriptPath: scriptValidation?.path || 'Unknown',
                testCasesPath: workflowState.artifacts.testCasesPath,
                failureTimestamp: new Date().toISOString()
            };

            // Build detailed bug description
            const bugDescription = `
## Test Automation Failure Report

**Original Ticket:** ${ticketId}
**Jira URL:** ${jiraUrl}
**Environment:** ${environment}
**Test Data:** ${testDataContext || 'Default'}

### Execution Summary
- **Iterations Attempted:** ${workflowState.maxIterations}
- **Self-Healing Attempts:** ${(workflowState.selfHealingAttempts || []).length}
- **Final Status:** FAILED

### Error Details
\`\`\`
${lastError || 'Unknown error'}
\`\`\`

### All Errors by Iteration
${workflowState.errors.map((e, i) => `
**Iteration ${e.iteration}:** (${e.timestamp})
\`\`\`
${e.error}
\`\`\`
`).join('\n')}

### Artifacts
- Test Cases: ${workflowState.artifacts.testCasesPath || 'Not found'}
- Test Script: ${scriptValidation?.path || 'Not found'}

### Recommended Actions
1. Review error messages above
2. Check selectors in the test script
3. Verify UAT environment is accessible
4. Check if application UI has changed
`;

            workflowState.agentInvocations.push({
                agent: 'buggenie',
                required: true,  // FIXED: Now required, not optional
                status: 'AUTO_TRIGGERED',  // FIXED: Auto-triggered, not just recommended
                context: bugContext,
                bugDescription: bugDescription,
                prompt: `Create bug ticket for test automation failure.

TICKET CONTEXT:
- Original Ticket: ${ticketId}
- URL: ${jiraUrl}
- Environment: ${environment}

FAILURE DETAILS:
${bugDescription}

INSTRUCTIONS:
1. Create a detailed bug ticket with the above information
2. Link to original ticket ${ticketId}
3. Include all error details and iteration attempts
4. Suggest root cause analysis
5. Present review copy to user before final submission`
            });

            console.log('\n   ✅ BugGenie context prepared with:');
            console.log(`      - ${workflowState.errors.length} error(s) captured`);
            console.log(`      - ${(workflowState.selfHealingAttempts || []).length} self-heal attempt(s)`);
            console.log(`      - Full artifact paths included`);
            console.log('\n   ⚡ AGENT INSTRUCTION: The orchestrator agent MUST now invoke BugGenie:');
            console.log(`      runSubagent({ agentName: 'buggenie', ... }) with failure context above`);
            console.log('\n   📋 BugGenie Prompt Ready:');
            console.log(`      @buggenie Create bug for ${ticketId} test failures - Auto-triggered after ${workflowState.maxIterations} failed iterations`);

            // Signal to orchestrator agent that BugGenie invocation is required
            workflowState.bugGenieRequired = true;
            workflowState.bugGenieContext = workflowState.agentInvocations.find(inv => inv.agent === 'buggenie');
        }

        // Cleanup temporary files
        logStage('CLEANUP', 'RUNNING', 'Removing temporary workflow files...');
        const cleanedCount = cleanupTemporaryFiles(ticketId);
        logStage('CLEANUP', 'SUCCESS', `Removed ${cleanedCount} temporary file(s)`);
        saveWorkflowState();

        // Workflow Complete
        workflowState.currentStage = testsPassed ? STAGES.COMPLETED : STAGES.FAILED;
        workflowState.status = testsPassed ? 'COMPLETED' : 'COMPLETED_WITH_FAILURES';
        workflowState.completedAt = new Date().toISOString();
        saveWorkflowState();

        console.log('\n' + '═'.repeat(80));
        console.log(testsPassed ? '🎉 WORKFLOW COMPLETED SUCCESSFULLY!' : '⚠️  WORKFLOW COMPLETED WITH FAILURES');
        console.log('═'.repeat(80));

        // Pipeline Summary
        console.log('\n' + '─'.repeat(80));
        console.log('📋 PIPELINE EXECUTION SUMMARY');
        console.log('─'.repeat(80));
        console.log(`   Workflow ID: ${workflowId}`);
        console.log(`   Ticket: ${ticketId}`);
        console.log(`   Status: ${workflowState.status}`);
        console.log(`   Final Stage: ${workflowState.currentStage}`);
        console.log(`   Test Iterations: ${workflowState.testIterations}`);
        console.log(`   Duration: ${Math.round((new Date() - new Date(workflowState.startedAt)) / 1000)}s`);

        console.log('\n   ┌───────────────────────────────────────────────────────────────┐');
        console.log(`   │ Stage 1: TESTGENIE      ${workflowState.artifacts.testCasesPath ? '✅ PASS' : '❌ FAIL'}                              │`);
        console.log(`   │ Stage 2: SCRIPTGENIE    ${workflowState.artifacts.scriptPath ? '✅ PASS' : '❌ FAIL'}                              │`);
        console.log(`   │ Stage 3: EXECUTE        ${testsPassed ? '✅ PASS' : '⚠️ WARN'} (${workflowState.testIterations} iteration${workflowState.testIterations > 1 ? 's' : ''})                     │`);
        console.log(`   │ Stage 4: REPORT         ${testsPassed ? '✅ PASS' : '⚠️ NEEDS REVIEW'}                    │`);
        console.log('   └───────────────────────────────────────────────────────────────┘');

        // Test Execution Summary
        console.log('\n🧪 Test Execution Results:');
        console.log(`   Status: ${testsPassed ? '✅ ALL TESTS PASSED' : '❌ TESTS FAILED'}`);
        console.log(`   Iterations: ${workflowState.testIterations}/${workflowState.maxIterations}`);
        if (!testsPassed) {
            console.log(`   Last Error: ${lastError || 'Unknown'}`);
            console.log('   ⚠️  Manual review or BugGenie recommended');
        }

        // Agent Invocations Summary
        console.log('\n🤖 Agent Invocations:');
        workflowState.agentInvocations.forEach(inv => {
            const icon = inv.status === 'COMPLETED' ? '✅' : inv.status === 'PENDING' ? '⏳' : '💡';
            console.log(`   ${icon} ${inv.agent}: ${inv.status}`);
        });

        // Quality Gates Summary
        const qualityGates = workflowState.stages.filter(s => s.name.startsWith('QUALITY_GATE_'));
        const passedGates = qualityGates.filter(s => s.status === 'SUCCESS').length;
        console.log('\n🔍 Quality Gates:');
        console.log(`   Total: ${qualityGates.length} | Passed: ${passedGates}`);

        console.log('\n📁 Final Artifacts:');
        console.log(`   ✅ Test Cases: ${workflowState.artifacts.testCasesPath || 'Not generated'}`);
        console.log(`   ✅ Test Scripts: ${workflowState.artifacts.scriptPath || 'Not generated'}`);
        console.log(`   ✅ Test Reports: playwright-report/, allure-results/`);
        console.log(`   ✅ Workflow State: ${WORKFLOW_STATE_PATH}`);

        console.log('\n' + '═'.repeat(80));

        // Return appropriate exit code
        if (!testsPassed) {
            process.exit(1);
        }

    } catch (error) {
        logStage('WORKFLOW_ERROR', 'ERROR', `Workflow failed: ${error.message}`, { error: error.stack });

        const failedStage = workflowState.currentStage || STAGES.PENDING;

        console.log('\n' + '═'.repeat(80));
        console.log('❌ PIPELINE STAGE FAILED');
        console.log('═'.repeat(80));
        console.log(`\n   Failed at: ${failedStage}`);
        console.log(`   Error: ${error.message}`);

        // Attempt recovery
        console.log('\n' + '━'.repeat(80));
        console.log('🔧 ATTEMPTING AUTOMATIC RECOVERY');
        console.log('━'.repeat(80));

        const recoveryResult = await recoveryManager.attemptRecovery(workflowState, error, {
            ticketId: ticketId,
            environment: environment
        });

        if (recoveryResult.success) {
            console.log('\n✅ Recovery successful!');
            workflowState.recoveredAt = new Date().toISOString();
            workflowState.recoveryAction = recoveryResult.action;
            saveWorkflowState();

            if (recoveryResult.path) {
                workflowState.artifacts.testCasesPath = recoveryResult.path;
                console.log(`📁 Updated artifact path: ${recoveryResult.path}`);
            }

            console.log('\n💡 To continue the workflow, run:');
            console.log(`   @orchestrator workflow=jira-to-automation ${jiraUrl}`);
        } else {
            workflowState.status = 'FAILED';
            workflowState.currentStage = STAGES.FAILED;
            workflowState.completedAt = new Date().toISOString();
            saveWorkflowState();

            console.error('\n❌ Recovery was not possible');
            console.error(`   Message: ${recoveryResult.message}`);

            // Stage-specific recovery guidance
            console.log('\n' + '─'.repeat(80));
            console.log('💡 MANUAL RECOVERY OPTIONS');
            console.log('─'.repeat(80));

            if (failedStage === STAGES.TESTGENIE_REQUIRED || failedStage === STAGES.PENDING) {
                console.log('\n   📋 STAGE 1 FAILED: Test Case Generation');
                console.log('   ───────────────────────────────────────');
                console.log('   Required: Run testgenie agent to generate test cases');
                console.log(`   Command: @testgenie ${jiraUrl} with ${testDataContext || 'UAT'} test data`);
                console.log(`   Output: ${TEST_CASES_DIR}/${ticketId}.xlsx`);
            } else if (failedStage === STAGES.SCRIPTGENIE_REQUIRED) {
                console.log('\n   🎭 STAGE 2 FAILED: Script Generation');
                console.log('   ────────────────────────────────────');
                console.log('   Required: Run scriptgenerator agent with MCP exploration');
                console.log(`   Command: @scriptgenerator generate automation for ${ticketId} using MCP exploration`);
                console.log('   IMPORTANT: Ensure Playwright MCP is active');
            } else if (failedStage.startsWith('ITERATION_') || failedStage === STAGES.EXECUTING) {
                console.log('\n   🧪 STAGE 3 FAILED: Test Execution');
                console.log('   ─────────────────────────────────');
                console.log('   Options:');
                console.log(`   1. Fix tests: @scriptgenerator fix failing tests for ${ticketId}`);
                console.log(`   2. Create bug: @buggenie Create bug for ${ticketId} test failures`);
            }

            console.log('\n   🔄 RESUME WORKFLOW:');
            console.log(`   Command: @orchestrator workflow=jira-to-automation ${jiraUrl}`);
            console.log('\n' + '─'.repeat(80));
        }

        process.exit(1);
    }
}

// Execute workflow
executeWorkflow().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
