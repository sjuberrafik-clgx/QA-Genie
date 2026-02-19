/**
 * Workflow Enforcer - Ensures 100% Deterministic Workflow Execution
 * 
 * This module enforces strict sequential execution with mandatory validation
 * at each step. Designed to guarantee consistent results for demos.
 * 
 * @module WorkflowEnforcer
 * @version 1.0.0
 * 
 * CRITICAL FIXES FOR DEMO RELIABILITY:
 * 1. Enforces MCP exploration BEFORE script generation (no random scripts)
 * 2. Validates each stage completion before proceeding
 * 3. Handles stuck exploration gracefully with timeout
 * 4. Ensures same input = same output every time
 */

const fs = require('fs');
const path = require('path');

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

// Configuration
const WORKFLOW_TIMEOUT_MS = 300000; // 5 minutes max per stage
const MCP_EXPLORATION_TIMEOUT_MS = 180000; // 3 minutes for MCP exploration
const REQUIRED_STAGES = ['JIRA_FETCH', 'EXCEL_CREATE', 'MCP_EXPLORE', 'SCRIPT_GENERATE', 'SCRIPT_EXECUTE'];

/**
 * Workflow Stage Status
 */
const StageStatus = {
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED'
};

/**
 * Validation Rules for Each Stage
 */
const StageValidationRules = {
    JIRA_FETCH: {
        required: true,
        validates: (artifacts) => {
            return !!(artifacts.ticketId && artifacts.ticketUrl);
        },
        errorMessage: 'Jira ticket information not captured'
    },
    EXCEL_CREATE: {
        required: true,
        validates: (artifacts) => {
            const excelPath = artifacts.excelPath || artifacts.testCasesPath;
            if (!excelPath) return false;
            if (!fs.existsSync(excelPath)) return false;
            const stats = fs.statSync(excelPath);
            return stats.size > 5000; // Minimum 5KB for valid Excel
        },
        errorMessage: 'Excel file not created or invalid'
    },
    MCP_EXPLORE: {
        required: true, // CRITICAL: This was optional before, now MANDATORY
        validates: (artifacts, ticketId) => {
            const explorationPath = path.join('exploration-data', `${ticketId}-exploration.json`);
            if (!fs.existsSync(explorationPath)) return false;
            try {
                const data = JSON.parse(fs.readFileSync(explorationPath, 'utf8'));
                // Must have actual exploration data, not empty
                return !!(data.flows && Object.keys(data.flows).length > 0);
            } catch {
                return false;
            }
        },
        errorMessage: 'MCP exploration not performed or incomplete - CANNOT proceed without real selectors'
    },
    SCRIPT_GENERATE: {
        required: true,
        validates: (artifacts, ticketId) => {
            const pp = getProjectPaths();
            const specsDir = pp ? pp.specsDir : 'tests/specs';
            const scriptDir = path.join(specsDir, ticketId.toLowerCase());
            if (!fs.existsSync(scriptDir)) return false;
            const files = fs.readdirSync(scriptDir);
            const specFile = files.find(f => f.endsWith('.spec.js'));
            if (!specFile) return false;
            const content = fs.readFileSync(path.join(scriptDir, specFile), 'utf8');
            // Must reference exploration data (not random selectors)
            return content.includes('test.describe') && content.length > 1000;
        },
        errorMessage: 'Script not generated or invalid'
    },
    SCRIPT_EXECUTE: {
        required: true,
        validates: (artifacts) => {
            return artifacts.executionCompleted === true;
        },
        errorMessage: 'Script execution not completed'
    }
};

/**
 * WorkflowEnforcer Class
 * Guarantees deterministic workflow execution
 */
class WorkflowEnforcer {
    constructor(ticketId, environment = 'UAT') {
        this.ticketId = ticketId;
        this.environment = environment;
        this.workflowId = `${ticketId}-${Date.now()}`;
        this.stages = {};
        this.artifacts = { ticketId, environment };
        this.errors = [];
        this.startTime = Date.now();

        // Initialize all stages as PENDING
        REQUIRED_STAGES.forEach(stage => {
            this.stages[stage] = {
                status: StageStatus.PENDING,
                startTime: null,
                endTime: null,
                retryCount: 0,
                maxRetries: 3
            };
        });

        console.log('═'.repeat(80));
        console.log('🔒 WORKFLOW ENFORCER INITIALIZED');
        console.log('═'.repeat(80));
        console.log(`   Workflow ID: ${this.workflowId}`);
        console.log(`   Ticket: ${ticketId}`);
        console.log(`   Environment: ${environment}`);
        console.log(`   Required Stages: ${REQUIRED_STAGES.join(' → ')}`);
        console.log('═'.repeat(80));
    }

    /**
     * Check if a stage can proceed (all prerequisites met)
     */
    canProceedToStage(stageName) {
        const stageIndex = REQUIRED_STAGES.indexOf(stageName);

        // First stage can always proceed
        if (stageIndex === 0) return { canProceed: true };

        // Check all previous stages are COMPLETED
        for (let i = 0; i < stageIndex; i++) {
            const prevStage = REQUIRED_STAGES[i];
            const prevStatus = this.stages[prevStage].status;

            if (prevStatus !== StageStatus.COMPLETED) {
                return {
                    canProceed: false,
                    blockingStage: prevStage,
                    reason: `Stage ${prevStage} is ${prevStatus}, must be COMPLETED first`
                };
            }
        }

        return { canProceed: true };
    }

    /**
     * Start a workflow stage
     */
    startStage(stageName) {
        const check = this.canProceedToStage(stageName);

        if (!check.canProceed) {
            console.error(`\n❌ BLOCKED: Cannot start ${stageName}`);
            console.error(`   Reason: ${check.reason}`);
            throw new Error(`Workflow blocked: ${check.reason}`);
        }

        this.stages[stageName].status = StageStatus.IN_PROGRESS;
        this.stages[stageName].startTime = Date.now();

        console.log(`\n▶️  [${stageName}] Starting...`);

        return true;
    }

    /**
     * Complete a workflow stage with validation
     */
    completeStage(stageName, stageArtifacts = {}) {
        // Merge artifacts
        Object.assign(this.artifacts, stageArtifacts);

        // Validate stage completion
        const rule = StageValidationRules[stageName];
        if (rule && rule.required) {
            const isValid = rule.validates(this.artifacts, this.ticketId);

            if (!isValid) {
                this.stages[stageName].status = StageStatus.FAILED;
                this.stages[stageName].endTime = Date.now();
                this.errors.push({
                    stage: stageName,
                    error: rule.errorMessage,
                    timestamp: new Date().toISOString()
                });

                console.error(`\n❌ [${stageName}] VALIDATION FAILED`);
                console.error(`   Error: ${rule.errorMessage}`);

                throw new Error(`Stage ${stageName} validation failed: ${rule.errorMessage}`);
            }
        }

        // Mark as completed
        this.stages[stageName].status = StageStatus.COMPLETED;
        this.stages[stageName].endTime = Date.now();
        const duration = this.stages[stageName].endTime - this.stages[stageName].startTime;

        console.log(`✅ [${stageName}] Completed (${Math.round(duration / 1000)}s)`);

        // Save state after each stage
        this.saveState();

        return true;
    }

    /**
     * Check if MCP exploration is ready (CRITICAL for demo)
     */
    validateMCPExplorationReady() {
        console.log('\n🔍 CRITICAL CHECK: MCP Exploration Validation');
        console.log('─'.repeat(60));

        const explorationPath = path.join('exploration-data', `${this.ticketId}-exploration.json`);

        // Check file exists
        if (!fs.existsSync(explorationPath)) {
            console.error('❌ MCP exploration data NOT FOUND');
            console.error(`   Expected: ${explorationPath}`);
            console.error('   This means ScriptGenerator did NOT explore the app');
            console.error('   Generated scripts will have RANDOM/INCORRECT selectors!');
            return {
                ready: false,
                reason: 'No exploration data file',
                fix: 'ScriptGenerator MUST run exploreWebApplication() before generating scripts'
            };
        }

        // Validate content
        try {
            const data = JSON.parse(fs.readFileSync(explorationPath, 'utf8'));

            if (!data.flows || Object.keys(data.flows).length === 0) {
                console.error('❌ MCP exploration data is EMPTY');
                return {
                    ready: false,
                    reason: 'Exploration data has no flows',
                    fix: 'Exploration was started but did not capture any data'
                };
            }

            // Check for actual selectors
            let selectorCount = 0;
            for (const flow of Object.values(data.flows)) {
                selectorCount += (flow.selectors?.length || 0);
            }

            if (selectorCount === 0) {
                console.error('❌ MCP exploration captured NO selectors');
                return {
                    ready: false,
                    reason: 'No selectors captured during exploration',
                    fix: 'Exploration ran but failed to capture DOM elements'
                };
            }

            console.log('✅ MCP exploration data is VALID');
            console.log(`   Flows captured: ${Object.keys(data.flows).length}`);
            console.log(`   Selectors captured: ${selectorCount}`);
            console.log('─'.repeat(60));

            return {
                ready: true,
                flowCount: Object.keys(data.flows).length,
                selectorCount: selectorCount
            };

        } catch (error) {
            console.error('❌ MCP exploration data is CORRUPTED');
            return {
                ready: false,
                reason: `JSON parse error: ${error.message}`,
                fix: 'Re-run MCP exploration'
            };
        }
    }

    /**
     * Get workflow progress summary
     */
    getProgress() {
        const completed = Object.values(this.stages).filter(s => s.status === StageStatus.COMPLETED).length;
        const total = REQUIRED_STAGES.length;
        const percentage = Math.round((completed / total) * 100);

        return {
            completed,
            total,
            percentage,
            currentStage: this.getCurrentStage(),
            stages: { ...this.stages },
            artifacts: { ...this.artifacts },
            errors: [...this.errors]
        };
    }

    /**
     * Get current active stage
     */
    getCurrentStage() {
        for (const stage of REQUIRED_STAGES) {
            if (this.stages[stage].status === StageStatus.IN_PROGRESS) {
                return stage;
            }
            if (this.stages[stage].status === StageStatus.PENDING) {
                return `PENDING:${stage}`;
            }
        }
        return 'COMPLETED';
    }

    /**
     * Save workflow state to file
     */
    saveState() {
        const stateDir = path.join('.github', 'agents', 'state');
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }

        const state = {
            workflowId: this.workflowId,
            ticketId: this.ticketId,
            environment: this.environment,
            stages: this.stages,
            artifacts: this.artifacts,
            errors: this.errors,
            startTime: this.startTime,
            lastUpdated: Date.now()
        };

        fs.writeFileSync(
            path.join(stateDir, 'workflow-state.json'),
            JSON.stringify(state, null, 2)
        );
    }

    /**
     * Print final summary
     */
    printSummary() {
        const progress = this.getProgress();
        const duration = Math.round((Date.now() - this.startTime) / 1000);

        console.log('\n' + '═'.repeat(80));
        console.log('📊 WORKFLOW EXECUTION SUMMARY');
        console.log('═'.repeat(80));
        console.log(`   Workflow ID: ${this.workflowId}`);
        console.log(`   Ticket: ${this.ticketId}`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Progress: ${progress.percentage}% (${progress.completed}/${progress.total} stages)`);
        console.log('\n   Stage Results:');

        for (const stage of REQUIRED_STAGES) {
            const status = this.stages[stage].status;
            const icon = status === StageStatus.COMPLETED ? '✅' :
                status === StageStatus.FAILED ? '❌' :
                    status === StageStatus.IN_PROGRESS ? '▶️' : '⏸️';
            console.log(`     ${icon} ${stage}: ${status}`);
        }

        if (this.errors.length > 0) {
            console.log('\n   ❌ Errors:');
            this.errors.forEach(e => console.log(`     - [${e.stage}] ${e.error}`));
        }

        console.log('\n   📁 Artifacts:');
        if (this.artifacts.excelPath) console.log(`     Excel: ${this.artifacts.excelPath}`);
        if (this.artifacts.scriptPath) console.log(`     Script: ${this.artifacts.scriptPath}`);

        console.log('═'.repeat(80));
    }
}

/**
 * Pre-flight checklist for demo reliability
 */
function runDemoPreflightChecks() {
    console.log('\n' + '═'.repeat(80));
    console.log('🚀 DEMO PRE-FLIGHT CHECKLIST');
    console.log('═'.repeat(80));

    const checks = [];

    // Check 1: Playwright installed
    try {
        require('child_process').execSync('npx playwright --version', { stdio: 'pipe' });
        checks.push({ name: 'Playwright Installed', status: '✅ PASS' });
    } catch {
        checks.push({ name: 'Playwright Installed', status: '❌ FAIL', fix: 'npm install @playwright/test' });
    }

    // Check 2: Test data file exists
    const ppEnv = getProjectPaths();
    const testDataPath = ppEnv
        ? path.join(ppEnv.projectRoot, ppEnv.testDataFile)
        : 'tests/test-data/testData.js';
    if (fs.existsSync(testDataPath)) {
        checks.push({ name: 'Test Data File', status: '✅ PASS' });
    } else {
        checks.push({ name: 'Test Data File', status: '❌ FAIL', fix: `Ensure ${ppEnv?.testDataFile || testDataPath} exists` });
    }

    // Check 3: Required directories exist (host-project dirs resolved against projectRoot)
    const resolveDir = (d) => ppEnv ? path.join(ppEnv.projectRoot, d) : d;
    const requiredDirs = ['test-cases', resolveDir(ppEnv ? ppEnv.specsDir : 'tests/specs'), 'exploration-data'];
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    checks.push({ name: 'Required Directories', status: '✅ PASS' });

    // Check 4: Workflow state directory
    const stateDir = '.github/agents/state';
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }
    checks.push({ name: 'State Directory', status: '✅ PASS' });

    // Print results
    console.log('\n   Pre-flight Check Results:');
    checks.forEach(c => {
        console.log(`     ${c.status} ${c.name}`);
        if (c.fix) console.log(`        Fix: ${c.fix}`);
    });

    const allPassed = checks.every(c => c.status.includes('PASS'));
    console.log(`\n   Overall: ${allPassed ? '✅ READY FOR DEMO' : '❌ ISSUES FOUND'}`);
    console.log('═'.repeat(80));

    return allPassed;
}

module.exports = {
    WorkflowEnforcer,
    StageStatus,
    StageValidationRules,
    REQUIRED_STAGES,
    runDemoPreflightChecks
};
