/**
 * Workflow Agent System - Library Exports
 * 
 * Clean entry point for all workflow coordination modules.
 * Import from this index instead of individual files.
 * 
 * @module @agents/lib
 * @version 1.0.0
 * 
 * @example
 * const { WorkflowCoordinator, WorkflowEventBus, WorkflowError, WorkflowLogger } = require('./lib');
 */

// Core coordinator and components
const {
  WorkflowCoordinator,
  WorkflowEventBus,
  WorkflowEvents,
  WorkflowError,
  WorkflowLogger,
  PerformanceConfig,
  WorkflowStage,
  ErrorCode
} = require('./workflow-coordinator');

// Error analysis
const { ErrorAnalyzer } = require('./error-analyzer');

// Custom templates
const { CustomTemplatesManager } = require('./custom-templates');

// Quality gates
const { QualityGates } = require('./quality-gates');

// Workflow recovery
const { WorkflowRecoveryManager, RecoveryStrategies, getRecoveryManager } = require('./workflow-recovery');

// Workflow enforcer
const { WorkflowEnforcer, StageStatus } = require('./workflow-enforcer');

// Note: system-analysis.js is documentation only, not a functional module

// ═══════════════════════════════════════════════════════════════════════════════════════
// NAMED EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core workflow classes
  WorkflowCoordinator,
  WorkflowEventBus,
  WorkflowEvents,
  WorkflowError,
  WorkflowLogger,

  // Workflow stages and errors
  WorkflowStage,
  ErrorCode,

  // Performance utilities
  PerformanceConfig,

  // Extensions
  ErrorAnalyzer,
  CustomTemplatesManager,

  // Quality & Recovery
  QualityGates,
  WorkflowRecoveryManager,
  RecoveryStrategies,
  getRecoveryManager,
  WorkflowEnforcer,
  StageStatus,

  // Factory function for quick setup
  createWorkflowSystem() {
    const eventBus = new WorkflowEventBus();
    const coordinator = new WorkflowCoordinator();

    // Wire up event bus
    eventBus.emitWorkflowEvent('system:initialized', {
      version: '2.4.0',
      timestamp: new Date().toISOString()
    });

    return {
      coordinator,
      eventBus,
      logger: WorkflowLogger
    };
  }
};
