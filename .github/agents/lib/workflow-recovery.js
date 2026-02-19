/**
 * Workflow Recovery Manager
 * 
 * Handles workflow failures, retries, and recovery strategies
 * for the multi-agent test automation system.
 * 
 * @module WorkflowRecovery
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state', 'workflow-state.json');
const RECOVERY_LOG = path.join(__dirname, '..', 'state', 'recovery-log.json');

/**
 * Recovery strategies for different failure types
 */
const RecoveryStrategies = {
    EXCEL_NOT_FOUND: {
        action: 'SKIP_VALIDATION',
        description: 'Excel file not found - attempt to find by pattern',
        autoRecover: true,
        handler: async (workflow, context) => {
            const ticketId = workflow.ticketId;
            const possiblePaths = [
                `test-cases/${ticketId}.xlsx`,
                `test-artifacts/test-cases/${ticketId}.xlsx`,
                `test-cases/${ticketId.toLowerCase()}.xlsx`
            ];

            for (const testPath of possiblePaths) {
                if (fs.existsSync(testPath)) {
                    console.log(`✅ Recovery: Found Excel at ${testPath}`);
                    workflow.artifacts = workflow.artifacts || {};
                    workflow.artifacts.testCasesPath = testPath;
                    workflow.artifacts.excelPath = testPath;
                    return { success: true, path: testPath };
                }
            }

            return { success: false, message: 'No Excel file found in any location' };
        }
    },

    MCP_NOT_ACTIVE: {
        action: 'SKIP_MCP_EXPLORATION',
        description: 'MCP not available - generate script with default selectors',
        autoRecover: false,
        handler: async (workflow, context) => {
            console.warn('⚠️ MCP not active - script will use default selectors');
            console.warn('   Scripts may need manual selector updates');
            return { success: true, warning: 'MCP skipped - manual review required' };
        }
    },

    SCRIPT_EXECUTION_FAILED: {
        action: 'RETRY_WITH_DEBUG',
        description: 'Script execution failed - retry with debug mode',
        autoRecover: true,
        maxRetries: 2,
        handler: async (workflow, context) => {
            const { retryCount = 0, scriptPath } = context;

            if (retryCount >= 2) {
                return { success: false, message: 'Max retries exceeded' };
            }

            console.log(`🔄 Retry ${retryCount + 1}/2: Re-running script with debug info...`);
            return {
                success: true,
                retryCount: retryCount + 1,
                action: 'RETRY'
            };
        }
    },

    BROWSER_CLOSED: {
        action: 'REINITIALIZE_BROWSER',
        description: 'Browser closed unexpectedly - reinitialize',
        autoRecover: true,
        handler: async (workflow, context) => {
            console.log('🔄 Recovery: Reinitializing browser...');
            return { success: true, action: 'REINITIALIZE_BROWSER' };
        }
    },

    NAVIGATION_TIMEOUT: {
        action: 'RETRY_NAVIGATION',
        description: 'Navigation timed out - retry with increased timeout',
        autoRecover: true,
        handler: async (workflow, context) => {
            console.log('🔄 Recovery: Retrying navigation with extended timeout...');
            return { success: true, timeout: 90000 };
        }
    }
};

/**
 * WorkflowRecoveryManager - Manages workflow recovery operations
 */
class WorkflowRecoveryManager {
    constructor() {
        this.recoveryLog = this.loadRecoveryLog();
    }

    /**
     * Load recovery log from file
     */
    loadRecoveryLog() {
        try {
            if (fs.existsSync(RECOVERY_LOG)) {
                return JSON.parse(fs.readFileSync(RECOVERY_LOG, 'utf8'));
            }
        } catch (error) {
            console.warn('⚠️ Could not load recovery log:', error.message);
        }
        return { recoveries: [] };
    }

    /**
     * Save recovery log to file
     */
    saveRecoveryLog() {
        try {
            const dir = path.dirname(RECOVERY_LOG);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(RECOVERY_LOG, JSON.stringify(this.recoveryLog, null, 2));
        } catch (error) {
            console.warn('⚠️ Could not save recovery log:', error.message);
        }
    }

    /**
     * Analyze error and determine recovery strategy
     * @param {Error|string} error - The error to analyze
     * @returns {Object} - Recovery strategy
     */
    analyzeError(error) {
        const errorMessage = error.message || error.toString();

        // Pattern matching for error types
        if (/Excel file not found/i.test(errorMessage)) {
            return { type: 'EXCEL_NOT_FOUND', strategy: RecoveryStrategies.EXCEL_NOT_FOUND };
        }

        if (/MCP.*not.*active|Playwright MCP/i.test(errorMessage)) {
            return { type: 'MCP_NOT_ACTIVE', strategy: RecoveryStrategies.MCP_NOT_ACTIVE };
        }

        if (/Target page.*closed|browser has been closed/i.test(errorMessage)) {
            return { type: 'BROWSER_CLOSED', strategy: RecoveryStrategies.BROWSER_CLOSED };
        }

        if (/Navigation timeout|page\.goto.*Timeout/i.test(errorMessage)) {
            return { type: 'NAVIGATION_TIMEOUT', strategy: RecoveryStrategies.NAVIGATION_TIMEOUT };
        }

        if (/test.*failed|execution.*failed/i.test(errorMessage)) {
            return { type: 'SCRIPT_EXECUTION_FAILED', strategy: RecoveryStrategies.SCRIPT_EXECUTION_FAILED };
        }

        return { type: 'UNKNOWN', strategy: null };
    }

    /**
     * Attempt to recover from an error
     * @param {Object} workflow - Current workflow state
     * @param {Error|string} error - The error to recover from
     * @param {Object} context - Additional context
     * @returns {Object} - Recovery result
     */
    async attemptRecovery(workflow, error, context = {}) {
        const analysis = this.analyzeError(error);

        const recoveryEntry = {
            timestamp: new Date().toISOString(),
            workflowId: workflow.id,
            ticketId: workflow.ticketId,
            errorType: analysis.type,
            originalError: error.message || error.toString(),
            strategyUsed: analysis.strategy?.action || 'NONE'
        };

        if (!analysis.strategy) {
            console.error('❌ No recovery strategy available for this error type');
            recoveryEntry.result = 'NO_STRATEGY';
            this.recoveryLog.recoveries.push(recoveryEntry);
            this.saveRecoveryLog();
            return { success: false, message: 'No recovery strategy available' };
        }

        console.log(`\n🔧 RECOVERY: Attempting ${analysis.strategy.action}`);
        console.log(`   Description: ${analysis.strategy.description}`);

        if (!analysis.strategy.autoRecover) {
            console.warn('⚠️ This recovery requires manual intervention');
            recoveryEntry.result = 'MANUAL_REQUIRED';
            this.recoveryLog.recoveries.push(recoveryEntry);
            this.saveRecoveryLog();
            return { success: false, message: 'Manual intervention required', strategy: analysis.strategy };
        }

        try {
            const result = await analysis.strategy.handler(workflow, context);
            recoveryEntry.result = result.success ? 'SUCCESS' : 'FAILED';
            recoveryEntry.details = result;

            this.recoveryLog.recoveries.push(recoveryEntry);
            this.saveRecoveryLog();

            if (result.success) {
                console.log('✅ Recovery successful');
            } else {
                console.error('❌ Recovery failed:', result.message);
            }

            return result;
        } catch (recoveryError) {
            console.error('❌ Recovery handler failed:', recoveryError.message);
            recoveryEntry.result = 'HANDLER_ERROR';
            recoveryEntry.handlerError = recoveryError.message;
            this.recoveryLog.recoveries.push(recoveryEntry);
            this.saveRecoveryLog();
            return { success: false, message: recoveryError.message };
        }
    }

    /**
     * Get recovery statistics
     */
    getStatistics() {
        const stats = {
            total: this.recoveryLog.recoveries.length,
            successful: 0,
            failed: 0,
            byType: {}
        };

        for (const entry of this.recoveryLog.recoveries) {
            if (entry.result === 'SUCCESS') {
                stats.successful++;
            } else {
                stats.failed++;
            }

            stats.byType[entry.errorType] = (stats.byType[entry.errorType] || 0) + 1;
        }

        return stats;
    }

    /**
     * Resume a failed workflow from last successful stage
     * @param {string} workflowId - Workflow ID to resume
     */
    async resumeWorkflow(workflowId) {
        console.log(`\n🔄 Attempting to resume workflow: ${workflowId}`);

        try {
            if (!fs.existsSync(STATE_FILE)) {
                throw new Error('Workflow state file not found');
            }

            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

            if (state.id !== workflowId && state.ticketId !== workflowId) {
                throw new Error(`Workflow ${workflowId} not found in state file`);
            }

            // Find last successful stage
            const stages = state.stages || [];
            const lastSuccessIndex = stages.map((s, i) => s.status === 'SUCCESS' ? i : -1)
                .filter(i => i >= 0)
                .pop();

            if (lastSuccessIndex === undefined) {
                console.log('⚠️ No successful stages found - workflow must be restarted');
                return { success: false, message: 'No successful stages to resume from' };
            }

            const lastSuccessStage = stages[lastSuccessIndex];
            console.log(`✅ Found last successful stage: ${lastSuccessStage.name}`);
            console.log(`   Resuming from stage ${lastSuccessIndex + 1}...`);

            // Update state for resume
            state.status = 'ACTIVE';
            state.resumedAt = new Date().toISOString();
            state.resumedFromStage = lastSuccessStage.name;

            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

            return {
                success: true,
                resumeFrom: lastSuccessStage.name,
                stageIndex: lastSuccessIndex,
                workflow: state
            };

        } catch (error) {
            console.error('❌ Failed to resume workflow:', error.message);
            return { success: false, message: error.message };
        }
    }
}

// Singleton instance
let recoveryManagerInstance = null;

function getRecoveryManager() {
    if (!recoveryManagerInstance) {
        recoveryManagerInstance = new WorkflowRecoveryManager();
    }
    return recoveryManagerInstance;
}

module.exports = {
    WorkflowRecoveryManager,
    RecoveryStrategies,
    getRecoveryManager
};
