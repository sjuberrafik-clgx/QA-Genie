/**
 * Quality Gates for Test Automation Workflow
 * Validates artifacts and enforces quality standards at each workflow stage
 * 
 * Usage:
 *   const { QualityGates } = require('./.github/agents/lib/quality-gates');
 *   const result = QualityGates.validateExcelCreated(workflowState);
 *   if (!result.passed) throw new Error(result.error);
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Dynamic path resolution
let _projectPaths;
function getProjectPaths() {
    if (!_projectPaths) {
        try {
            _projectPaths = require('../../../utils/project-path-resolver').getProjectPaths();
        } catch {
            _projectPaths = null;
        }
    }
    return _projectPaths;
}

const QualityGates = {

    /**
     * Gate 1: Excel File Quality Validation
     * Ensures test cases Excel file exists and meets quality standards
     */
    validateExcelCreated: (workflow) => {
        // FLAW FIX: Check both excelPath AND testCasesPath (orchestrator uses testCasesPath)
        let excelPath = workflow.artifacts?.excelPath || workflow.artifacts?.testCasesPath;

        // Normalize path for cross-platform compatibility
        if (excelPath) {
            excelPath = path.normalize(excelPath);
        }

        // Check existence
        if (!excelPath || !fs.existsSync(excelPath)) {
            // FLAW FIX: Try to find Excel file by ticketId pattern as fallback
            const ticketId = workflow.ticketId;
            if (ticketId) {
                const possiblePaths = [
                    path.join('test-cases', `${ticketId}.xlsx`),
                    path.join('test-artifacts', 'test-cases', `${ticketId}.xlsx`)
                ];
                for (const fallbackPath of possiblePaths) {
                    if (fs.existsSync(fallbackPath)) {
                        excelPath = fallbackPath;
                        break;
                    }
                }
            }

            if (!excelPath || !fs.existsSync(excelPath)) {
                return {
                    passed: false,
                    error: 'Excel file not found',
                    expected: excelPath || 'test-cases/{ticketId}.xlsx',
                    fix: 'Re-run testgenie agent to generate Excel file'
                };
            }
        }

        // Check file size
        const stats = fs.statSync(excelPath);
        if (stats.size < 5000) { // Less than 5KB likely empty
            return {
                passed: false,
                error: 'Excel file too small (likely empty or corrupted)',
                size: stats.size,
                minSize: 5000,
                fix: 'Check testgenie output for errors and regenerate'
            };
        }

        // Check file extension
        if (path.extname(excelPath) !== '.xlsx') {
            return {
                passed: false,
                error: 'Invalid file extension (expected .xlsx)',
                actual: path.extname(excelPath),
                fix: 'Ensure testgenie generates proper Excel format'
            };
        }

        // TODO: Add XLSX content validation when xlsx module available
        // const validation = validateExcelContent(excelPath);

        return {
            passed: true,
            size: stats.size,
            path: excelPath,
            message: 'Excel file validated successfully'
        };
    },

    /**
     * Gate 2: MCP Exploration Data Validation
     * Ensures ScriptGenerator performed LIVE MCP application exploration (not web-fetch)
     */
    validateMCPExploration: (workflow, ticketId) => {
        const explorationPath = path.join(
            process.cwd(),
            'exploration-data',
            `${ticketId}-exploration.json`
        );

        // Check exploration file exists
        if (!fs.existsSync(explorationPath)) {
            return {
                passed: false,
                error: 'MCP exploration data not found',
                expected: explorationPath,
                fix: 'ScriptGenerator MUST perform LIVE MCP exploration (mcp_unified-autom_unified_navigate + mcp_unified-autom_unified_snapshot) before generating scripts'
            };
        }

        // Parse exploration data
        let exploration;
        try {
            exploration = JSON.parse(fs.readFileSync(explorationPath, 'utf8'));
        } catch (error) {
            return {
                passed: false,
                error: 'MCP exploration data corrupted or invalid JSON',
                details: error.message,
                fix: 'Re-run MCP exploration'
            };
        }

        // ── NEW: Load workflow-config.json mcpExploration settings ──
        let mcpConfig = { minSnapshotsBeforeGeneration: 1 };
        try {
            const wfConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'workflow-config.json'), 'utf8'));
            if (wfConfig.mcpExploration) {
                mcpConfig = { ...mcpConfig, ...wfConfig.mcpExploration };
            }
        } catch (e) { /* use defaults */ }

        const minSnapshots = mcpConfig.minSnapshotsBeforeGeneration || 1;

        // ── CRITICAL: Reject web-fetch exploration — MUST be live MCP snapshot ──
        if (exploration.source === 'web-fetch-exploration') {
            return {
                passed: false,
                error: 'Exploration used web-fetch, NOT live MCP snapshot. This is invalid.',
                actualSource: exploration.source,
                requiredSource: 'mcp-live-snapshot',
                fix: 'ScriptGenerator MUST call mcp_unified-autom_unified_navigate and mcp_unified-autom_unified_snapshot for LIVE exploration. Do NOT use fetch_webpage as a substitute.'
            };
        }

        // ── CRITICAL: Verify source is explicitly "mcp-live-snapshot" ──
        if (exploration.source !== 'mcp-live-snapshot' && exploration.source !== 'mcp-snapshot') {
            return {
                passed: false,
                error: `Exploration source "${exploration.source}" is not a recognized live MCP source`,
                requiredSource: 'mcp-live-snapshot',
                fix: 'Exploration data must have "source": "mcp-live-snapshot" — this is set automatically when using MCP tools'
            };
        }

        // ── CRITICAL: Verify snapshots array exists with real data ──
        const hasSnapshots = Array.isArray(exploration.snapshots) && exploration.snapshots.length >= minSnapshots;
        if (!hasSnapshots) {
            return {
                passed: false,
                error: `No MCP snapshots recorded (need at least ${minSnapshots}, found ${(exploration.snapshots || []).length})`,
                fix: 'ScriptGenerator must call mcp_unified-autom_unified_snapshot at least once per page and store results in snapshots array'
            };
        }

        // ── Verify element refs from accessibility tree ──
        const hasElementRefs = exploration.snapshots.some(snap =>
            Array.isArray(snap.elements) && snap.elements.length > 0 &&
            snap.elements.some(el => el.ref || el.role || el.name || el.ariaLabel)
        );

        // Validate exploration data structure
        const checks = {
            hasLiveSource: exploration.source === 'mcp-live-snapshot' || exploration.source === 'mcp-snapshot',
            hasSnapshots: hasSnapshots,
            hasElementRefs: hasElementRefs,
            hasTimestamp: !!exploration.timestamp,
            hasPageTitle: !!exploration.pageTitle || exploration.snapshots.some(s => !!s.pageTitle),
            recentExploration: exploration.timestamp &&
                (Date.now() - new Date(exploration.timestamp).getTime()) < 1800000 // 30 minutes (tightened from 1 hour)
        };

        const failed = Object.entries(checks)
            .filter(([key, passed]) => !passed)
            .map(([key]) => key);

        // hasLiveSource and hasSnapshots are hard failures
        const hardFailures = failed.filter(f => ['hasLiveSource', 'hasSnapshots'].includes(f));
        if (hardFailures.length > 0) {
            return {
                passed: false,
                error: 'MCP exploration missing critical data (live source or snapshots)',
                failedChecks: failed,
                hardFailures: hardFailures,
                checks: checks,
                fix: 'Re-run ScriptGenerator with LIVE MCP exploration — ensure mcp_unified-autom_unified_navigate and mcp_unified-autom_unified_snapshot are called'
            };
        }

        // Soft failures (warn but pass)
        if (failed.length > 0) {
            return {
                passed: true,
                warnings: failed,
                exploration: exploration,
                snapshotCount: exploration.snapshots.length,
                elementCount: exploration.snapshots.reduce((sum, s) => sum + (s.elements?.length || 0), 0),
                message: `MCP exploration validated with warnings: ${failed.join(', ')}`
            };
        }

        return {
            passed: true,
            exploration: exploration,
            snapshotCount: exploration.snapshots.length,
            elementCount: exploration.snapshots.reduce((sum, s) => sum + (s.elements?.length || 0), 0),
            source: exploration.source,
            message: 'MCP exploration validated successfully (live snapshot confirmed)'
        };
    },

    /**
     * Gate 3: Playwright Script Quality Validation
     * Ensures generated script meets quality and best practice standards
     */
    validateScriptGenerated: (workflow, ticketId) => {
        const scriptPath = workflow.artifacts?.scriptPath;

        // Check if script path is a directory (contains multiple files)
        let scriptFilePath = scriptPath;
        if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).isDirectory()) {
            // Find .spec.js file in directory
            const files = fs.readdirSync(scriptPath);
            const specFile = files.find(f => f.endsWith('.spec.js'));

            if (!specFile) {
                return {
                    passed: false,
                    error: 'No .spec.js file found in script directory',
                    directory: scriptPath,
                    files: files,
                    fix: 'Ensure scriptgenerator creates .spec.js file'
                };
            }

            scriptFilePath = path.join(scriptPath, specFile);
        }

        // Check script file exists
        if (!scriptFilePath || !fs.existsSync(scriptFilePath)) {
            return {
                passed: false,
                error: 'Playwright script not found',
                expected: scriptFilePath || `${(getProjectPaths()?.specsDir || 'tests/specs')}/${ticketId.toLowerCase()}/*.spec.js`,
                fix: 'Check scriptgenerator output for errors'
            };
        }

        // Read script content
        const content = fs.readFileSync(scriptFilePath, 'utf8');

        // Quality checks
        const checks = {
            hasTestCases: /test\(/.test(content),
            hasExpectations: /expect\(/.test(content),
            hasDescribe: /test\.describe/.test(content),
            usesGetByRole: /getByRole\(/.test(content),
            hasBeforeAll: /beforeAll/.test(content),
            hasAfterAll: /afterAll/.test(content),
            minLength: content.length > 1000,
            noExcessiveHardWaits: !/waitForTimeout\(\d{5,}\)/.test(content), // No waits >10s
            hasExplorationReference: content.includes('MCP exploration') ||
                content.includes('Generated with accurate selectors') ||
                content.includes('live exploration') ||
                content.includes('Generated by Unified Automation MCP Server') ||
                content.includes('Auto-generated test script'),
            hasRequireStatements: /require\(/.test(content), // CommonJS
            hasTestData: /testData|userTokens|baseUrl/.test(content)
        };

        // Calculate quality score
        const score = Object.values(checks).filter(v => v).length;
        const total = Object.keys(checks).length;
        const percentage = Math.round((score / total) * 100);

        // Quality threshold
        const QUALITY_THRESHOLD = 70; // 70% minimum

        if (percentage < QUALITY_THRESHOLD) {
            const failedChecks = Object.entries(checks)
                .filter(([k, v]) => !v)
                .map(([k]) => k);

            return {
                passed: false,
                error: `Script quality below threshold (${percentage}% < ${QUALITY_THRESHOLD}%)`,
                score: percentage,
                threshold: QUALITY_THRESHOLD,
                failedChecks: failedChecks,
                checks: checks,
                fix: 'Improve script generation to include best practices and MCP-derived selectors'
            };
        }

        return {
            passed: true,
            score: percentage,
            path: scriptFilePath,
            linesOfCode: content.split('\n').length,
            checks: checks,
            message: `Script quality validated (${percentage}%)`
        };
    },

    /**
     * Gate 4: Script Execution Dry-Run (Optional)
     * Tests if generated script can execute without errors
     */
    validateScriptExecutable: async (workflow, ticketId) => {
        const scriptPath = workflow.artifacts?.scriptPath;

        // Find actual spec file if scriptPath is directory
        let scriptFilePath = scriptPath;
        if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).isDirectory()) {
            const files = fs.readdirSync(scriptPath);
            const specFile = files.find(f => f.endsWith('.spec.js'));
            if (specFile) {
                scriptFilePath = path.join(scriptPath, specFile);
            }
        }

        if (!fs.existsSync(scriptFilePath)) {
            return {
                passed: false,
                error: 'Script file not found for execution test',
                path: scriptFilePath
            };
        }

        try {
            // Run first test only (TC1 or first test found)
            const result = execSync(
                `npx playwright test "${scriptFilePath}" --grep "TC1" --reporter=list`,
                {
                    timeout: 90000, // 90 seconds max
                    encoding: 'utf8',
                    cwd: process.cwd(),
                    stdio: 'pipe'
                }
            );

            // Check if test passed
            const hasPassing = /✓|passed/i.test(result);
            const hasFailing = /✗|failed/i.test(result);

            if (hasFailing && !hasPassing) {
                return {
                    passed: false,
                    error: 'Dry-run execution failed - all tests failed',
                    output: result.substring(0, 1000),
                    fix: 'Debug script selectors and logic using headed mode'
                };
            }

            return {
                passed: true,
                result: result.substring(0, 500),
                message: 'Script executed successfully in dry-run'
            };

        } catch (error) {
            // Execution error (syntax, timeout, etc.)
            const output = error.stdout || error.stderr || error.message;

            return {
                passed: false,
                error: 'Script execution error during dry-run',
                details: output.substring(0, 1000),
                exitCode: error.status,
                fix: 'Fix syntax errors, timeouts, or runtime issues in generated script'
            };
        }
    },

    /**
     * Helper: Validate Test Data Configuration
     * Ensures UAT test data is available and properly configured
     */
    validateTestData: (environment = 'UAT') => {
        const ppQg = getProjectPaths();
        const testDataPath = ppQg
            ? path.join(ppQg.projectRoot, ppQg.testDataFile)
            : path.join(process.cwd(), 'tests', 'test-data', 'testData.js');

        if (!fs.existsSync(testDataPath)) {
            return {
                passed: false,
                error: 'Test data file not found',
                expected: testDataPath,
                fix: `Create ${ppQg?.testDataFile || 'tests/test-data/testData.js'} with UAT configuration`
            };
        }

        // Read test data file
        const content = fs.readFileSync(testDataPath, 'utf8');

        // Check for UAT configuration
        const checks = {
            hasUserTokens: /userTokens/.test(content),
            hasBaseUrl: /baseUrl/.test(content),
            hasCanopyToken: /canopy/.test(content),
            hasExports: /module\.exports/.test(content)
        };

        const failed = Object.entries(checks)
            .filter(([k, v]) => !v)
            .map(([k]) => k);

        if (failed.length > 0) {
            return {
                passed: false,
                error: 'Test data configuration incomplete',
                failedChecks: failed,
                fix: 'Add missing test data properties to testData.js'
            };
        }

        return {
            passed: true,
            path: testDataPath,
            message: 'Test data configuration validated'
        };
    },

    /**
     * Helper: Complete Workflow Validation
     * Runs all quality gates and returns comprehensive report
     */
    validateWorkflowComplete: async (workflow, ticketId) => {
        const results = {
            timestamp: new Date().toISOString(),
            workflowId: workflow.id,
            ticketId: ticketId,
            gates: {}
        };

        // Run all gates
        results.gates.excel = QualityGates.validateExcelCreated(workflow);
        results.gates.exploration = QualityGates.validateMCPExploration(workflow, ticketId);
        results.gates.script = QualityGates.validateScriptGenerated(workflow, ticketId);
        results.gates.testData = QualityGates.validateTestData();

        // Optional: Dry-run execution
        if (process.env.ENABLE_DRY_RUN !== 'false') {
            results.gates.execution = await QualityGates.validateScriptExecutable(workflow, ticketId);
        }

        // Calculate overall pass/fail
        const gateResults = Object.values(results.gates);
        const passedCount = gateResults.filter(g => g.passed).length;
        const totalCount = gateResults.length;

        results.summary = {
            passed: passedCount === totalCount,
            passedCount: passedCount,
            totalCount: totalCount,
            percentage: Math.round((passedCount / totalCount) * 100),
            failedGates: Object.entries(results.gates)
                .filter(([name, result]) => !result.passed)
                .map(([name]) => name)
        };

        return results;
    }
};

module.exports = { QualityGates };
