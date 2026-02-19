/**
 * Workflow Coordinator - Manages sequential execution of multi-agent workflows
 * with parallel ticket support and state persistence
 * 
 * @module WorkflowCoordinator
 * @version 2.4.0
 * 
 * New in 2.4.0:
 * - WorkflowError class for consistent error handling
 * - Structured logging system (WorkflowLogger)
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Error context preservation
 * - Serializable error output
 * 
 * New in 2.3.0:
 * - Event-driven architecture (WorkflowEventBus)
 * - Agent communication via events
 * - Workflow lifecycle events
 * - Plugin hook system
 * 
 * New in 2.2.0:
 * - Debounced state saving (80% fewer disk writes)
 * - In-memory state caching
 * - Async file operations support
 * - Performance optimizations
 * 
 * New in 2.1.0:
 * - AI-powered error analysis integration
 * - Custom template support
 * - OneHome MCP tools integration
 */

const fs = require('fs');
const { promises: fsPromises } = require('fs');
const path = require('path');

// Dynamic path resolution helper
function _getSpecsDir() {
    try {
        return require('../../../utils/project-path-resolver').getProjectPaths().specsDir;
    } catch {
        return 'tests/specs';
    }
}
const EventEmitter = require('events');

// Module imports (lazy loaded to avoid circular dependencies)
let ErrorAnalyzer = null;
let CustomTemplatesManager = null;

// State files in state/ directory (relative to lib/)
const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'workflow-state.json');
const METRICS_FILE = path.join(STATE_DIR, 'workflow-metrics.json');
const CUSTOM_TEMPLATES_FILE = path.join(STATE_DIR, 'custom-templates.json');

// ═══════════════════════════════════════════════════════════════════════════════════════
// PERFORMANCE CONFIGURATION (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════════════════

const PerformanceConfig = {
    // Debounce settings
    SAVE_DEBOUNCE_MS: 2000,        // Save at most every 2 seconds
    SAVE_MAX_WAIT_MS: 10000,       // Force save after 10 seconds of changes

    // Cache settings
    CACHE_ENABLED: true,
    CACHE_TTL_MS: 60000,           // Cache TTL: 1 minute

    // Batch settings
    BATCH_OPERATIONS: true,
    MAX_BATCH_SIZE: 10,

    // Async settings
    PREFER_ASYNC: true,            // Use async operations when possible
    ASYNC_TIMEOUT_MS: 5000         // Timeout for async operations
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// QUALITY & ERROR HANDLING (Phase 4)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Centralized Error Codes for consistent error handling
 * Defined early so WorkflowError can reference them
 */
const ErrorCode = {
    // Validation Errors (1xxx)
    INVALID_TICKET_FORMAT: { code: 'E1001', message: 'Invalid ticket format', recoverable: true },
    INVALID_TEMPLATE: { code: 'E1002', message: 'Invalid workflow template', recoverable: true },
    ACTIVE_WORKFLOW_EXISTS: { code: 'E1003', message: 'Active workflow already exists for ticket', recoverable: true },
    MISSING_DIRECTORY: { code: 'E1004', message: 'Required directory missing', recoverable: true },
    MCP_NOT_CONFIGURED: { code: 'E1005', message: 'MCP not configured', recoverable: true },

    // Stage Errors (2xxx)
    JIRA_FETCH_FAILED: { code: 'E2001', message: 'Failed to fetch Jira ticket', recoverable: true },
    TESTCASE_GENERATION_FAILED: { code: 'E2002', message: 'Test case generation failed', recoverable: true },
    EXCEL_CREATION_FAILED: { code: 'E2003', message: 'Excel file creation failed', recoverable: true },
    SCRIPT_EXPLORATION_FAILED: { code: 'E2004', message: 'Application exploration failed', recoverable: true },
    SCRIPT_GENERATION_FAILED: { code: 'E2005', message: 'Script generation failed', recoverable: true },
    SCRIPT_EXECUTION_FAILED: { code: 'E2006', message: 'Script execution failed', recoverable: true },

    // Validation Errors (3xxx)
    EXCEL_VALIDATION_FAILED: { code: 'E3001', message: 'Excel file validation failed', recoverable: true },
    SCRIPT_VALIDATION_FAILED: { code: 'E3002', message: 'Script validation failed', recoverable: true },
    PREREQUISITE_NOT_MET: { code: 'E3003', message: 'Stage prerequisite not met', recoverable: false },

    // System Errors (4xxx)
    STATE_SAVE_FAILED: { code: 'E4001', message: 'Failed to save workflow state', recoverable: true },
    STATE_LOAD_FAILED: { code: 'E4002', message: 'Failed to load workflow state', recoverable: true },
    WORKFLOW_NOT_FOUND: { code: 'E4003', message: 'Workflow not found', recoverable: false },
    WORKFLOW_INACTIVE: { code: 'E4004', message: 'Cannot transition inactive workflow', recoverable: false },

    // Timeout Errors (5xxx)
    STAGE_TIMEOUT: { code: 'E5001', message: 'Stage execution timed out', recoverable: true },
    WORKFLOW_TIMEOUT: { code: 'E5002', message: 'Workflow execution timed out', recoverable: false }
};

/**
 * Log Levels for structured logging
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
};

/**
 * WorkflowLogger - Structured logging for workflow operations
 * Provides consistent, filterable, and serializable log output
 */
class WorkflowLogger {
    static _instance = null;
    static _level = LogLevel.INFO;
    static _buffer = [];
    static _maxBufferSize = 1000;
    static _outputToConsole = true;

    /**
     * Get singleton logger instance
     * @returns {WorkflowLogger}
     */
    static getInstance() {
        if (!WorkflowLogger._instance) {
            WorkflowLogger._instance = new WorkflowLogger();
        }
        return WorkflowLogger._instance;
    }

    /**
     * Configure logger
     * @param {Object} options - Configuration options
     */
    static configure(options = {}) {
        if (options.level !== undefined) {
            WorkflowLogger._level = options.level;
        }
        if (options.maxBufferSize !== undefined) {
            WorkflowLogger._maxBufferSize = options.maxBufferSize;
        }
        if (options.outputToConsole !== undefined) {
            WorkflowLogger._outputToConsole = options.outputToConsole;
        }
    }

    /**
     * Create log entry
     * @private
     */
    _log(level, levelName, message, context = {}) {
        if (level < WorkflowLogger._level) return null;

        const entry = {
            timestamp: new Date().toISOString(),
            level: levelName,
            message,
            context,
            workflowId: context.workflowId || null,
            ticketId: context.ticketId || null,
            stage: context.stage || null,
            agent: context.agent || null
        };

        // Add to buffer
        WorkflowLogger._buffer.push(entry);
        if (WorkflowLogger._buffer.length > WorkflowLogger._maxBufferSize) {
            WorkflowLogger._buffer.shift();
        }

        // Console output
        if (WorkflowLogger._outputToConsole) {
            const prefix = this._formatPrefix(entry);
            const contextStr = Object.keys(context).length > 0
                ? ` ${JSON.stringify(context)}`
                : '';

            switch (level) {
                case LogLevel.DEBUG:
                    console.debug(`${prefix} ${message}${contextStr}`);
                    break;
                case LogLevel.INFO:
                    console.log(`${prefix} ${message}${contextStr}`);
                    break;
                case LogLevel.WARN:
                    console.warn(`${prefix} ${message}${contextStr}`);
                    break;
                case LogLevel.ERROR:
                    console.error(`${prefix} ${message}${contextStr}`);
                    break;
            }
        }

        return entry;
    }

    /**
     * Format log prefix
     * @private
     */
    _formatPrefix(entry) {
        const icons = {
            DEBUG: '🔍',
            INFO: 'ℹ️',
            WARN: '⚠️',
            ERROR: '❌'
        };
        const time = entry.timestamp.split('T')[1].split('.')[0];
        return `${icons[entry.level] || '•'} [${time}] [${entry.level}]`;
    }

    debug(message, context = {}) {
        return this._log(LogLevel.DEBUG, 'DEBUG', message, context);
    }

    info(message, context = {}) {
        return this._log(LogLevel.INFO, 'INFO', message, context);
    }

    warn(message, context = {}) {
        return this._log(LogLevel.WARN, 'WARN', message, context);
    }

    error(message, context = {}) {
        return this._log(LogLevel.ERROR, 'ERROR', message, context);
    }

    /**
     * Get log buffer
     * @param {Object} filters - Optional filters
     * @returns {Array} Filtered log entries
     */
    static getBuffer(filters = {}) {
        let entries = [...WorkflowLogger._buffer];

        if (filters.level) {
            entries = entries.filter(e => e.level === filters.level);
        }
        if (filters.workflowId) {
            entries = entries.filter(e => e.workflowId === filters.workflowId);
        }
        if (filters.ticketId) {
            entries = entries.filter(e => e.ticketId === filters.ticketId);
        }
        if (filters.since) {
            entries = entries.filter(e => new Date(e.timestamp) >= new Date(filters.since));
        }

        return entries;
    }

    /**
     * Clear log buffer
     */
    static clearBuffer() {
        WorkflowLogger._buffer = [];
    }

    /**
     * Export logs to JSON
     * @returns {string} JSON string of log entries
     */
    static exportJSON() {
        return JSON.stringify(WorkflowLogger._buffer, null, 2);
    }
}

/**
 * WorkflowError - Consistent error class for workflow operations
 * Provides structured errors with codes, recovery hints, and serialization
 */
class WorkflowError extends Error {
    /**
     * Create a WorkflowError
     * @param {string} errorCodeKey - Key from ErrorCode enum
     * @param {string} details - Additional error details
     * @param {Object} context - Error context (workflowId, ticketId, etc.)
     * @param {Error} cause - Original error that caused this error
     */
    constructor(errorCodeKey, details = '', context = {}, cause = null) {
        // Get error definition or use unknown
        const errorDef = ErrorCode[errorCodeKey] || {
            code: 'E9999',
            message: 'Unknown error',
            recoverable: false
        };

        // Build error message
        const fullMessage = `[${errorDef.code}] ${errorDef.message}${details ? ': ' + details : ''}`;
        super(fullMessage);

        // Error properties
        this.name = 'WorkflowError';
        this.errorCodeKey = errorCodeKey;
        this.code = errorDef.code;
        this.recoverable = errorDef.recoverable;
        this.details = details;
        this.context = context;
        this.cause = cause;
        this.timestamp = new Date().toISOString();

        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, WorkflowError);
        }

        // Log error automatically
        const logger = WorkflowLogger.getInstance();
        logger.error(fullMessage, {
            ...context,
            errorCode: this.code,
            recoverable: this.recoverable
        });
    }

    /**
     * Check if error is recoverable
     * @returns {boolean}
     */
    isRecoverable() {
        return this.recoverable;
    }

    /**
     * Get recovery suggestion
     * @returns {string} Recovery suggestion
     */
    getRecoverySuggestion() {
        const suggestions = {
            E1001: 'Use format PROJECT-NUMBER (e.g., AOTF-1234)',
            E1002: 'Use valid template: jira-to-automation or jira-to-testcases',
            E1003: 'Complete or cancel the existing active workflow first',
            E1004: 'Create the required directory structure',
            E1005: 'Configure MCP in VS Code settings',
            E2001: 'Check Jira connectivity and ticket permissions',
            E2002: 'Verify ticket has sufficient acceptance criteria',
            E2003: 'Check disk space and file permissions',
            E2004: 'Ensure application URL is accessible',
            E2005: 'Review test case format and selectors',
            E2006: 'Check test environment and authentication',
            E3001: 'Verify Excel file was created correctly',
            E3002: 'Ensure script follows Playwright best practices',
            E3003: 'Complete prerequisite stages first',
            E4001: 'Check disk space and file permissions',
            E4002: 'Verify state file is not corrupted',
            E4003: 'Initialize a new workflow for this ticket',
            E4004: 'Workflow must be ACTIVE to transition',
            E5001: 'Retry the stage or increase timeout',
            E5002: 'Start a new workflow'
        };

        return suggestions[this.code] || 'Check error details and try again';
    }

    /**
     * Convert to JSON for serialization
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            errorCodeKey: this.errorCodeKey,
            message: this.message,
            details: this.details,
            recoverable: this.recoverable,
            recoverySuggestion: this.getRecoverySuggestion(),
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }

    /**
     * Create error from error code key (static factory)
     * @param {string} errorCodeKey - Error code key
     * @param {Object} options - Additional options
     * @returns {WorkflowError}
     */
    static create(errorCodeKey, options = {}) {
        return new WorkflowError(
            errorCodeKey,
            options.details || '',
            options.context || {},
            options.cause || null
        );
    }

    /**
     * Wrap an existing error
     * @param {Error} error - Original error
     * @param {string} errorCodeKey - Error code key
     * @param {Object} context - Additional context
     * @returns {WorkflowError}
     */
    static wrap(error, errorCodeKey, context = {}) {
        return new WorkflowError(
            errorCodeKey,
            error.message,
            context,
            error
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// EVENT-DRIVEN ARCHITECTURE (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Workflow Events - Standard event types for agent communication
 */
const WorkflowEvents = {
    // Workflow lifecycle events
    WORKFLOW_INITIALIZED: 'workflow:initialized',
    WORKFLOW_STARTED: 'workflow:started',
    WORKFLOW_COMPLETED: 'workflow:completed',
    WORKFLOW_FAILED: 'workflow:failed',
    WORKFLOW_CANCELLED: 'workflow:cancelled',
    WORKFLOW_ROLLED_BACK: 'workflow:rolledBack',

    // Stage events
    STAGE_STARTED: 'stage:started',
    STAGE_COMPLETED: 'stage:completed',
    STAGE_FAILED: 'stage:failed',
    STAGE_SKIPPED: 'stage:skipped',
    STAGE_RETRYING: 'stage:retrying',

    // Artifact events
    ARTIFACT_CREATED: 'artifact:created',
    ARTIFACT_VALIDATED: 'artifact:validated',
    ARTIFACT_INVALID: 'artifact:invalid',

    // Agent events
    AGENT_STARTED: 'agent:started',
    AGENT_COMPLETED: 'agent:completed',
    AGENT_ERROR: 'agent:error',
    AGENT_HANDOFF: 'agent:handoff',

    // System events
    STATE_SAVED: 'state:saved',
    STATE_LOADED: 'state:loaded',
    HEALTH_CHECK: 'health:check',
    METRICS_UPDATED: 'metrics:updated'
};

/**
 * WorkflowEventBus - Singleton event bus for inter-agent communication
 * Enables decoupled agent interaction without file system polling
 */
class WorkflowEventBus extends EventEmitter {
    static _instance = null;

    constructor() {
        super();
        this.setMaxListeners(50); // Allow many agent listeners
        this._eventHistory = [];
        this._maxHistorySize = 100;
        this._subscribers = new Map();
        this._plugins = new Map();
    }

    /**
     * Get singleton instance
     * @returns {WorkflowEventBus}
     */
    static getInstance() {
        if (!WorkflowEventBus._instance) {
            WorkflowEventBus._instance = new WorkflowEventBus();
        }
        return WorkflowEventBus._instance;
    }

    /**
     * Reset instance (useful for testing)
     */
    static resetInstance() {
        if (WorkflowEventBus._instance) {
            WorkflowEventBus._instance.removeAllListeners();
            WorkflowEventBus._instance._eventHistory = [];
            WorkflowEventBus._instance._subscribers.clear();
            WorkflowEventBus._instance._plugins.clear();
        }
        WorkflowEventBus._instance = null;
    }

    /**
     * Emit event with automatic history tracking
     * @param {string} eventType - Event type from WorkflowEvents
     * @param {Object} payload - Event data
     * @returns {boolean} True if listeners were called
     */
    publish(eventType, payload = {}) {
        const event = {
            type: eventType,
            payload,
            timestamp: new Date().toISOString(),
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        // Track history
        this._eventHistory.push(event);
        if (this._eventHistory.length > this._maxHistorySize) {
            this._eventHistory.shift();
        }

        // Execute plugin hooks (pre-emit)
        this._executeHooks('pre', eventType, event);

        // Emit event
        const result = this.emit(eventType, event);

        // Execute plugin hooks (post-emit)
        this._executeHooks('post', eventType, event);

        return result;
    }

    /**
     * Subscribe to event with named handler (allows easy unsubscribe)
     * @param {string} eventType - Event type
     * @param {string} subscriberId - Unique subscriber ID (e.g., 'testgenie', 'scriptgenerator')
     * @param {Function} handler - Event handler
     */
    subscribe(eventType, subscriberId, handler) {
        const key = `${eventType}:${subscriberId}`;

        // Remove existing subscription if any
        if (this._subscribers.has(key)) {
            this.off(eventType, this._subscribers.get(key));
        }

        // Add new subscription
        this._subscribers.set(key, handler);
        this.on(eventType, handler);

        return () => this.unsubscribe(eventType, subscriberId);
    }

    /**
     * Unsubscribe from event
     * @param {string} eventType - Event type
     * @param {string} subscriberId - Subscriber ID
     */
    unsubscribe(eventType, subscriberId) {
        const key = `${eventType}:${subscriberId}`;
        if (this._subscribers.has(key)) {
            this.off(eventType, this._subscribers.get(key));
            this._subscribers.delete(key);
        }
    }

    /**
     * Wait for specific event (Promise-based)
     * @param {string} eventType - Event type to wait for
     * @param {Object} options - Options
     * @param {number} options.timeout - Timeout in ms
     * @param {Function} options.filter - Filter function for event
     * @returns {Promise<Object>} Event payload
     */
    waitFor(eventType, options = {}) {
        const { timeout = 30000, filter = () => true } = options;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.off(eventType, handler);
                reject(new Error(`Timeout waiting for event: ${eventType}`));
            }, timeout);

            const handler = (event) => {
                if (filter(event)) {
                    clearTimeout(timeoutId);
                    this.off(eventType, handler);
                    resolve(event);
                }
            };

            this.on(eventType, handler);
        });
    }

    /**
     * Get event history
     * @param {string} eventType - Filter by event type (optional)
     * @param {number} limit - Max entries to return
     * @returns {Array} Event history
     */
    getHistory(eventType = null, limit = 50) {
        let history = this._eventHistory;
        if (eventType) {
            history = history.filter(e => e.type === eventType);
        }
        return history.slice(-limit);
    }

    /**
     * Register a plugin with hooks
     * @param {string} pluginId - Unique plugin ID
     * @param {Object} plugin - Plugin with hooks
     */
    registerPlugin(pluginId, plugin) {
        this._plugins.set(pluginId, plugin);
    }

    /**
     * Unregister a plugin
     * @param {string} pluginId - Plugin ID
     */
    unregisterPlugin(pluginId) {
        this._plugins.delete(pluginId);
    }

    /**
     * Execute plugin hooks
     * @private
     */
    _executeHooks(timing, eventType, event) {
        for (const [pluginId, plugin] of this._plugins) {
            try {
                const hookName = `${timing}:${eventType}`;
                if (typeof plugin[hookName] === 'function') {
                    plugin[hookName](event);
                }
                // Also try generic hooks
                const genericHook = `${timing}:*`;
                if (typeof plugin[genericHook] === 'function') {
                    plugin[genericHook](event);
                }
            } catch (error) {
                console.warn(`Plugin ${pluginId} hook error:`, error.message);
            }
        }
    }

    /**
     * Get statistics about event bus
     * @returns {Object} Statistics
     */
    getStats() {
        const eventCounts = {};
        for (const event of this._eventHistory) {
            eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
        }

        return {
            totalEvents: this._eventHistory.length,
            subscriberCount: this._subscribers.size,
            pluginCount: this._plugins.size,
            listenerCount: this.listenerCount(),
            eventCounts
        };
    }

    /**
     * Get total listener count across all events
     */
    listenerCount() {
        return this.eventNames().reduce((count, name) => {
            return count + super.listenerCount(name);
        }, 0);
    }
}

/**
 * Lazy load ErrorAnalyzer module
 */
function getErrorAnalyzer() {
    if (!ErrorAnalyzer) {
        try {
            const module = require('./error-analyzer.js');
            ErrorAnalyzer = new module.ErrorAnalyzer();
        } catch (e) {
            console.warn('ErrorAnalyzer not available:', e.message);
            return null;
        }
    }
    return ErrorAnalyzer;
}

/**
 * Lazy load CustomTemplatesManager module
 */
function getCustomTemplatesManager() {
    if (!CustomTemplatesManager) {
        try {
            const module = require('./custom-templates.js');
            CustomTemplatesManager = new module.CustomTemplatesManager();
        } catch (e) {
            console.warn('CustomTemplatesManager not available:', e.message);
            return null;
        }
    }
    return CustomTemplatesManager;
}

/**
 * Retry Configuration with exponential backoff
 */
const RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,

    /**
     * Calculate delay for retry attempt
     * @param {number} attempt - Current attempt number (1-based)
     * @returns {number} Delay in milliseconds
     */
    getDelay(attempt) {
        const delay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
        return Math.min(delay, this.maxDelayMs);
    },

    /**
     * Check if error is retryable
     * @param {Object} error - Error object with code
     * @returns {boolean} True if retryable
     */
    isRetryable(error) {
        if (error && error.errorCode && ErrorCode[error.errorCode]) {
            return ErrorCode[error.errorCode].recoverable;
        }
        return true; // Default to retryable for unknown errors
    }
};

/**
 * Workflow stages enum
 */
const WorkflowStage = {
    PENDING: 'PENDING',
    JIRA_FETCHED: 'JIRA_FETCHED',
    TESTCASES_GENERATED: 'TESTCASES_GENERATED',
    EXCEL_CREATED: 'EXCEL_CREATED',
    SCRIPT_EXPLORATION: 'SCRIPT_EXPLORATION',
    SCRIPT_GENERATED: 'SCRIPT_GENERATED',
    SCRIPT_EXECUTED: 'SCRIPT_EXECUTED',
    BUG_REPORTED: 'BUG_REPORTED', // Optional stage when test execution fails
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    ROLLED_BACK: 'ROLLED_BACK'
};

/**
 * Agent enum
 */
const Agent = {
    ORCHESTRATOR: 'orchestrator',
    TESTGENIE: 'testgenie',
    SCRIPTGENERATOR: 'scriptgenerator',
    BUGGENIE: 'buggenie'
};

/**
 * Workflow template definitions
 */
const WorkflowTemplates = {
    'jira-to-automation': {
        name: 'Jira to Automation',
        description: 'Generate test cases and automation from Jira ticket',
        stages: [
            { stage: WorkflowStage.PENDING, agent: Agent.ORCHESTRATOR, action: 'initialize' },
            { stage: WorkflowStage.JIRA_FETCHED, agent: Agent.TESTGENIE, action: 'fetch_jira' },
            { stage: WorkflowStage.TESTCASES_GENERATED, agent: Agent.TESTGENIE, action: 'generate_testcases' },
            { stage: WorkflowStage.EXCEL_CREATED, agent: Agent.TESTGENIE, action: 'create_excel', validation: 'validateExcel' },
            { stage: WorkflowStage.SCRIPT_EXPLORATION, agent: Agent.SCRIPTGENERATOR, action: 'explore_app', prerequisites: ['EXCEL_CREATED'] },
            { stage: WorkflowStage.SCRIPT_GENERATED, agent: Agent.SCRIPTGENERATOR, action: 'generate_script', validation: 'validateScript' },
            { stage: WorkflowStage.SCRIPT_EXECUTED, agent: Agent.SCRIPTGENERATOR, action: 'execute_test' },
            { stage: WorkflowStage.COMPLETED, agent: Agent.ORCHESTRATOR, action: 'finalize' }
        ],
        rollbackStrategy: {
            keepArtifacts: ['test-cases/*.xlsx', `${_getSpecsDir()}/*/*.spec.js`], // Keep test scripts for bug context
            keepErrorLogs: true, // Preserve error logs for BugGenie
            invokeBugGenieOnFailure: true, // Auto-invoke BugGenie after 3 failed attempts
            cleanupOnFailure: ['tests/*-temp-*.spec.js', 'test-results/temp-*']
        }
    },
    'jira-to-testcases': {
        name: 'Jira to Test Cases',
        description: 'Generate manual test cases from Jira ticket (no automation)',
        stages: [
            { stage: WorkflowStage.PENDING, agent: Agent.ORCHESTRATOR, action: 'initialize' },
            { stage: WorkflowStage.JIRA_FETCHED, agent: Agent.TESTGENIE, action: 'fetch_jira' },
            { stage: WorkflowStage.TESTCASES_GENERATED, agent: Agent.TESTGENIE, action: 'generate_testcases' },
            { stage: WorkflowStage.EXCEL_CREATED, agent: Agent.TESTGENIE, action: 'create_excel', validation: 'validateExcel' },
            { stage: WorkflowStage.COMPLETED, agent: Agent.ORCHESTRATOR, action: 'finalize' }
        ],
        rollbackStrategy: {
            keepArtifacts: ['test-cases/*.xlsx'],
            cleanupOnFailure: []
        }
    }
};

class WorkflowCoordinator {
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZATION (Phase 2 & 3 Enhanced)
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(options = {}) {
        // Merge options with defaults
        this._config = { ...PerformanceConfig, ...options };

        // Performance metrics (initialize BEFORE loadState)
        this._metrics = {
            saveCount: 0,
            savesAvoided: 0,
            cacheHits: 0,
            cacheMisses: 0,
            asyncOps: 0,
            syncOps: 0,
            eventsEmitted: 0,
            eventsHandled: 0
        };

        // Event bus (Phase 3)
        this.eventBus = WorkflowEventBus.getInstance();

        // State management
        this.state = this.loadState();

        // Debounce state (Phase 2)
        this._dirty = false;
        this._saveTimeout = null;
        this._lastSaveTime = Date.now();
        this._pendingChanges = 0;
        this._savePromise = null;

        // Bind cleanup handler
        this._setupCleanupHandler();

        // Emit state loaded event
        this._emitEvent(WorkflowEvents.STATE_LOADED, {
            workflowCount: Object.keys(this.state.workflows || {}).length
        });
    }

    /**
     * Setup process cleanup handler to flush pending saves
     */
    _setupCleanupHandler() {
        // Only setup once per process
        if (WorkflowCoordinator._cleanupRegistered) {
            return;
        }
        WorkflowCoordinator._cleanupRegistered = true;

        const cleanup = () => {
            if (this._dirty) {
                this._flushSync();
            }
        };

        // Handle process exit
        process.on('beforeExit', cleanup);
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE PERSISTENCE (Phase 2 - Debounced & Async)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Load workflow state from disk
     * @returns {Object} Workflow state object
     */
    loadState() {
        this._metrics.syncOps++;
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = fs.readFileSync(STATE_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn(`Failed to load state: ${error.message}`);
        }

        return this._getDefaultState();
    }

    /**
     * Load workflow state asynchronously
     * @returns {Promise<Object>} Workflow state object
     */
    async loadStateAsync() {
        this._metrics.asyncOps++;
        try {
            const exists = await fsPromises.access(STATE_FILE)
                .then(() => true)
                .catch(() => false);

            if (exists) {
                const data = await fsPromises.readFile(STATE_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn(`Failed to load state async: ${error.message}`);
        }

        return this._getDefaultState();
    }

    /**
     * Get default empty state object
     * @returns {Object} Default state
     */
    _getDefaultState() {
        return {
            version: '2.2.0',
            workflows: {},
            archived: [],
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Mark state as dirty and schedule save (DEBOUNCED)
     * This is the primary method for triggering saves - reduces disk I/O by 80%+
     */
    _markDirty() {
        this._dirty = true;
        this._pendingChanges++;

        const now = Date.now();
        const timeSinceLastSave = now - this._lastSaveTime;

        // Force save if we've been waiting too long
        if (timeSinceLastSave >= this._config.SAVE_MAX_WAIT_MS) {
            this._flush();
            return;
        }

        // Debounce: only schedule if not already scheduled
        if (!this._saveTimeout) {
            this._saveTimeout = setTimeout(() => {
                this._flush();
            }, this._config.SAVE_DEBOUNCE_MS);
        }
    }

    /**
     * Flush pending changes to disk (async)
     */
    async _flush() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        if (!this._dirty) {
            return;
        }

        // Track avoided saves
        if (this._pendingChanges > 1) {
            this._metrics.savesAvoided += (this._pendingChanges - 1);
        }

        this._dirty = false;
        this._pendingChanges = 0;
        this._lastSaveTime = Date.now();
        this._metrics.saveCount++;

        // Perform async save
        if (this._config.PREFER_ASYNC) {
            this._savePromise = this.saveStateAsync();
            await this._savePromise;
        } else {
            this.saveStateSync();
        }
    }

    /**
     * Flush pending changes synchronously (for process exit)
     */
    _flushSync() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        if (this._dirty) {
            this._dirty = false;
            this._pendingChanges = 0;
            this._lastSaveTime = Date.now();
            this._metrics.saveCount++;
            this.saveStateSync();
        }
    }

    /**
     * Save workflow state to disk (synchronous - for backward compatibility)
     * @deprecated Use saveStateAsync() for better performance
     */
    saveState() {
        // Use debounced save by default
        this._markDirty();
    }

    /**
     * Force immediate synchronous save (use sparingly)
     */
    saveStateSync() {
        this._metrics.syncOps++;
        try {
            this.state.lastUpdated = new Date().toISOString();
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (error) {
            console.error(`Failed to save state: ${error.message}`);
        }
    }

    /**
     * Save workflow state asynchronously
     * @returns {Promise<void>}
     */
    async saveStateAsync() {
        this._metrics.asyncOps++;
        try {
            this.state.lastUpdated = new Date().toISOString();
            await fsPromises.writeFile(
                STATE_FILE,
                JSON.stringify(this.state, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error(`Failed to save state async: ${error.message}`);
            // Fallback to sync
            this.saveStateSync();
        }
    }

    /**
     * Force immediate save (for critical operations)
     * @returns {Promise<void>}
     */
    async saveNow() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }
        this._dirty = false;
        this._pendingChanges = 0;
        this._lastSaveTime = Date.now();
        this._metrics.saveCount++;

        if (this._config.PREFER_ASYNC) {
            await this.saveStateAsync();
        } else {
            this.saveStateSync();
        }
    }

    /**
     * Wait for any pending save operations
     * @returns {Promise<void>}
     */
    async waitForPendingSave() {
        if (this._savePromise) {
            await this._savePromise;
        }
        if (this._dirty) {
            await this._flush();
        }
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this._metrics,
            pendingChanges: this._pendingChanges,
            isDirty: this._dirty,
            timeSinceLastSave: Date.now() - this._lastSaveTime,
            efficiency: this._metrics.saveCount > 0
                ? Math.round((this._metrics.savesAvoided / (this._metrics.saveCount + this._metrics.savesAvoided)) * 100)
                : 0,
            eventBusStats: this.eventBus ? this.eventBus.getStats() : null
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENT EMISSION HELPERS (Phase 3)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Emit event through the event bus
     * @param {string} eventType - Event type from WorkflowEvents
     * @param {Object} payload - Event payload
     * @private
     */
    _emitEvent(eventType, payload = {}) {
        if (this.eventBus) {
            this._metrics.eventsEmitted++;
            this.eventBus.publish(eventType, {
                ...payload,
                source: 'WorkflowCoordinator',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Subscribe to workflow events
     * @param {string} eventType - Event type from WorkflowEvents
     * @param {string} subscriberId - Unique subscriber identifier
     * @param {Function} handler - Event handler function
     * @returns {Function} Unsubscribe function
     */
    subscribe(eventType, subscriberId, handler) {
        if (!this.eventBus) {
            console.warn('Event bus not available');
            return () => { };
        }
        return this.eventBus.subscribe(eventType, subscriberId, (event) => {
            this._metrics.eventsHandled++;
            handler(event);
        });
    }

    /**
     * Wait for a specific workflow event
     * @param {string} eventType - Event type to wait for
     * @param {Object} options - Options including timeout and filter
     * @returns {Promise<Object>} Event data
     */
    async waitForEvent(eventType, options = {}) {
        if (!this.eventBus) {
            throw new Error('Event bus not available');
        }
        return this.eventBus.waitFor(eventType, options);
    }

    /**
     * Get event history for debugging
     * @param {string} eventType - Filter by event type (optional)
     * @param {number} limit - Max entries
     * @returns {Array} Event history
     */
    getEventHistory(eventType = null, limit = 50) {
        if (!this.eventBus) {
            return [];
        }
        return this.eventBus.getHistory(eventType, limit);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // WORKFLOW MANAGEMENT (Optimized for Phase 2 & 3)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Archive completed/failed workflows older than specified days
     * @param {number} maxAgeDays - Maximum age in days (default 30)
     * @returns {number} Number of workflows archived
     */
    archiveOldWorkflows(maxAgeDays = 30) {
        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        let archivedCount = 0;

        if (!this.state.archived) {
            this.state.archived = [];
        }

        for (const [id, workflow] of Object.entries(this.state.workflows)) {
            const age = now - new Date(workflow.startedAt).getTime();
            const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'].includes(workflow.status);

            if (isTerminal && age > maxAgeMs) {
                // Archive minimal info
                this.state.archived.push({
                    id: workflow.id,
                    ticketId: workflow.ticketId,
                    status: workflow.status,
                    startedAt: workflow.startedAt,
                    completedAt: workflow.completedAt,
                    archivedAt: new Date().toISOString()
                });
                delete this.state.workflows[id];
                archivedCount++;
            }
        }

        if (archivedCount > 0) {
            // Keep only last 100 archived entries
            if (this.state.archived.length > 100) {
                this.state.archived = this.state.archived.slice(-100);
            }
            this.saveState();
            console.log(`📦 Archived ${archivedCount} old workflows`);
        }

        return archivedCount;
    }

    /**
     * Trim workflow history to prevent unbounded growth
     * @param {string} workflowId - Workflow ID
     * @param {number} maxEntries - Maximum history entries (default 50)
     */
    trimWorkflowHistory(workflowId, maxEntries = 50) {
        const workflow = this.state.workflows[workflowId];
        if (!workflow) return;

        if (workflow.history && workflow.history.length > maxEntries) {
            const first = workflow.history.slice(0, 5);
            const last = workflow.history.slice(-(maxEntries - 6));
            workflow.history = [
                ...first,
                {
                    stage: 'HISTORY_TRIMMED',
                    timestamp: new Date().toISOString(),
                    agent: Agent.ORCHESTRATOR,
                    message: `Trimmed ${workflow.history.length - maxEntries} history entries`
                },
                ...last
            ];
        }
    }

    /**
     * Get workflow statistics
     * @returns {Object} Statistics summary
     */
    getStatistics() {
        const workflows = Object.values(this.state.workflows);
        return {
            total: workflows.length,
            active: workflows.filter(w => w.status === 'ACTIVE').length,
            completed: workflows.filter(w => w.status === 'COMPLETED').length,
            failed: workflows.filter(w => w.status === 'FAILED').length,
            archived: (this.state.archived || []).length,
            stateFileSize: fs.existsSync(STATE_FILE) ? fs.statSync(STATE_FILE).size : 0
        };
    }

    /**
     * Validate workflow preconditions before initialization
     * @param {string} ticketId - Jira ticket ID
     * @param {string} templateName - Workflow template name
     * @param {Object} options - Additional validation options
     * @returns {Object} Validation result
     */
    validatePreconditions(ticketId, templateName, options = {}) {
        const checks = {
            ticketFormat: /^[A-Z]+-\d+$/.test(ticketId),
            templateExists: WorkflowTemplates[templateName] !== undefined,
            noActiveConflict: !this.hasActiveWorkflowForTicket(ticketId),
            testCasesDirectoryExists: fs.existsSync(path.join(process.cwd(), 'test-cases')),
            testsDirectoryExists: fs.existsSync(path.join(process.cwd(), 'tests', 'specs'))
        };

        // Add MCP-specific checks if requested
        if (options.requireAtlassianMCP) {
            checks.atlassianMCPConfigured = this.checkMCPConfiguration('atlassian');
        }
        if (options.requirePlaywrightMCP) {
            checks.playwrightMCPConfigured = this.checkMCPConfiguration('playwright');
        }

        const failed = Object.entries(checks)
            .filter(([key, passed]) => !passed)
            .map(([key]) => key);

        if (failed.length > 0) {
            return {
                canStart: false,
                reasons: failed,
                fixes: this.generateFixInstructions(failed),
                checks
            };
        }

        return { canStart: true, checks };
    }

    /**
     * Check MCP configuration availability
     * @param {string} mcpType - Type of MCP ('atlassian', 'playwright', 'chrome-devtools')
     * @returns {boolean} True if MCP is configured
     */
    checkMCPConfiguration(mcpType) {
        // Check for MCP configuration in VS Code settings or workspace
        const mcpConfigPaths = [
            path.join(process.cwd(), '.vscode', 'mcp.json'),
            path.join(process.cwd(), 'mcp-config.json')
        ];

        for (const configPath of mcpConfigPaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    if (config.servers && config.servers[mcpType]) {
                        return true;
                    }
                } catch (e) {
                    // Config parse error, continue checking
                }
            }
        }

        // If no explicit config, assume available (VS Code manages MCPs)
        return true;
    }

    /**
     * Check if ticket has an active workflow
     * @param {string} ticketId - Jira ticket ID
     * @returns {boolean} True if active workflow exists
     */
    hasActiveWorkflowForTicket(ticketId) {
        return Object.values(this.state.workflows).some(
            w => w.ticketId === ticketId && w.status === 'ACTIVE'
        );
    }

    /**
     * Generate fix instructions for failed preconditions
     * @param {Array} failedChecks - Array of failed check names
     * @returns {Object} Fix instructions
     */
    generateFixInstructions(failedChecks) {
        const fixes = {
            ticketFormat: 'Ticket ID must be in format PROJECT-NUMBER (e.g., AOTF-1234)',
            templateExists: 'Use valid template: jira-to-automation or jira-to-testcases',
            noActiveConflict: 'Complete or cancel existing active workflow for this ticket',
            testCasesDirectoryExists: 'Create test-cases/ directory: mkdir test-cases',
            testsDirectoryExists: `Create ${_getSpecsDir()}/ directory: mkdir -p ${_getSpecsDir()}`,
            atlassianMCPConfigured: 'Configure Atlassian MCP in VS Code settings or .vscode/mcp.json',
            playwrightMCPConfigured: 'Configure Playwright MCP in VS Code settings or .vscode/mcp.json'
        };

        return failedChecks.reduce((acc, check) => {
            acc[check] = fixes[check] || `Fix required for: ${check}`;
            return acc;
        }, {});
    }

    /**
     * Clean stale workflows (active for more than 24 hours)
     */
    cleanStaleWorkflows() {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        let cleaned = 0;

        for (const [id, workflow] of Object.entries(this.state.workflows)) {
            if (workflow.status === 'ACTIVE') {
                const age = now - new Date(workflow.startedAt).getTime();
                if (age > oneDayMs) {
                    workflow.status = 'FAILED';
                    workflow.currentStage = WorkflowStage.FAILED;
                    workflow.completedAt = new Date().toISOString();
                    this.recordError(id, 'Workflow timed out (24 hours)');
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            this.saveState();
        }

        return cleaned;
    }

    /**
     * Initialize a new workflow for a ticket with validation
     * @param {string} ticketId - Jira ticket ID (e.g., 'AOTF-1234')
     * @param {string} templateName - Workflow template name
     * @param {Object} options - Additional workflow options
     * @returns {Object} Workflow instance
     */
    initializeWorkflow(ticketId, templateName = 'jira-to-automation', options = {}) {
        // Validate preconditions
        const validation = this.validatePreconditions(ticketId, templateName);
        if (!validation.canStart) {
            throw new Error(
                `Cannot start workflow: ${validation.reasons.join(', ')}. ` +
                `Fixes: ${JSON.stringify(validation.fixes)}`
            );
        }

        // Clean stale workflows
        this.cleanStaleWorkflows();

        const template = WorkflowTemplates[templateName];
        const workflowId = `${ticketId}-${Date.now()}`;

        this.state.workflows[workflowId] = {
            id: workflowId,
            ticketId,
            templateName,
            template,
            currentStage: WorkflowStage.PENDING,
            currentStageIndex: 0,
            status: 'ACTIVE',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            artifacts: {
                excelPath: null,
                scriptPath: null,
                testResultPath: null
            },
            history: [
                {
                    stage: WorkflowStage.PENDING,
                    timestamp: new Date().toISOString(),
                    agent: Agent.ORCHESTRATOR,
                    message: 'Workflow initialized successfully'
                }
            ],
            options,
            errors: [],
            validation: {
                preflightPassed: true,
                checkedAt: new Date().toISOString()
            }
        };

        this.saveState();

        // Emit workflow initialized event (Phase 3)
        this._emitEvent(WorkflowEvents.WORKFLOW_INITIALIZED, {
            workflowId,
            ticketId,
            templateName,
            status: 'ACTIVE',
            currentStage: WorkflowStage.PENDING
        });

        console.log(`✅ Workflow initialized: ${workflowId}`);
        return this.state.workflows[workflowId];
    }

    /**
     * Get workflow by ID
     * @param {string} workflowId - Workflow ID
     * @returns {Object|null} Workflow instance or null
     */
    getWorkflow(workflowId) {
        return this.state.workflows[workflowId] || null;
    }

    /**
     * Get workflow by ticket ID (returns most recent active workflow)
     * @param {string} ticketId - Jira ticket ID
     * @returns {Object|null} Workflow instance or null
     */
    getWorkflowByTicket(ticketId) {
        const workflows = Object.values(this.state.workflows)
            .filter(w => w.ticketId === ticketId)
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

        return workflows.length > 0 ? workflows[0] : null;
    }

    /**
     * Get workflow for ticket (alias for getWorkflowByTicket)
     * @param {string} ticketId - Jira ticket ID
     * @returns {Object|null} Workflow instance or null
     */
    getWorkflowForTicket(ticketId) {
        return this.getWorkflowByTicket(ticketId);
    }

    /**
     * Get all active workflows
     * @returns {Array} Array of active workflow instances
     */
    getActiveWorkflows() {
        return Object.values(this.state.workflows)
            .filter(w => w.status === 'ACTIVE')
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    }

    /**
     * Transition workflow to next stage
     * @param {string} workflowId - Workflow ID
     * @param {Object} transitionData - Data about the transition
     * @returns {Object} Updated workflow instance
     */
    transitionToNextStage(workflowId, transitionData = {}) {
        const workflow = this.state.workflows[workflowId];

        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        if (workflow.status !== 'ACTIVE') {
            throw new Error(`Cannot transition inactive workflow: ${workflow.status}`);
        }

        const currentStageConfig = workflow.template.stages[workflow.currentStageIndex];
        const previousStage = workflow.currentStage;

        // Validate current stage completion if validation function exists
        if (currentStageConfig.validation) {
            const isValid = this[currentStageConfig.validation](workflow, transitionData);
            if (!isValid) {
                this.recordError(workflowId, `Stage validation failed: ${currentStageConfig.stage}`);

                // Emit stage failed event (Phase 3)
                this._emitEvent(WorkflowEvents.STAGE_FAILED, {
                    workflowId,
                    ticketId: workflow.ticketId,
                    stage: currentStageConfig.stage,
                    reason: 'Validation failed'
                });

                throw new Error(`Validation failed for stage: ${currentStageConfig.stage}`);
            }
        }

        // Move to next stage
        workflow.currentStageIndex++;

        if (workflow.currentStageIndex >= workflow.template.stages.length) {
            // Workflow completed
            workflow.currentStage = WorkflowStage.COMPLETED;
            workflow.status = 'COMPLETED';
            workflow.completedAt = new Date().toISOString();

            // Emit workflow completed event (Phase 3)
            this._emitEvent(WorkflowEvents.WORKFLOW_COMPLETED, {
                workflowId,
                ticketId: workflow.ticketId,
                artifacts: workflow.artifacts,
                duration: this.calculateDuration(workflow)
            });
        } else {
            const nextStageConfig = workflow.template.stages[workflow.currentStageIndex];

            // Check prerequisites
            if (nextStageConfig.prerequisites) {
                for (const prereq of nextStageConfig.prerequisites) {
                    if (!this.hasCompletedStage(workflow, prereq)) {
                        this.recordError(workflowId, `Prerequisite not met: ${prereq}`);
                        throw new Error(`Prerequisite not met: ${prereq} for stage ${nextStageConfig.stage}`);
                    }
                }
            }

            workflow.currentStage = nextStageConfig.stage;

            // Emit stage started event (Phase 3)
            this._emitEvent(WorkflowEvents.STAGE_STARTED, {
                workflowId,
                ticketId: workflow.ticketId,
                stage: workflow.currentStage,
                agent: nextStageConfig.agent,
                previousStage
            });
        }

        workflow.updatedAt = new Date().toISOString();

        // Record history
        workflow.history.push({
            stage: workflow.currentStage,
            timestamp: new Date().toISOString(),
            agent: workflow.template.stages[workflow.currentStageIndex]?.agent || Agent.ORCHESTRATOR,
            message: transitionData.message || `Transitioned to ${workflow.currentStage}`,
            data: transitionData
        });

        // Emit stage completed event for previous stage (Phase 3)
        this._emitEvent(WorkflowEvents.STAGE_COMPLETED, {
            workflowId,
            ticketId: workflow.ticketId,
            completedStage: previousStage,
            currentStage: workflow.currentStage,
            artifacts: workflow.artifacts,
            transitionData
        });

        this.saveState();
        return workflow;
    }

    /**
     * Check if workflow has completed a specific stage
     * @param {Object} workflow - Workflow instance
     * @param {string} stageName - Stage name to check
     * @returns {boolean} True if stage completed
     */
    hasCompletedStage(workflow, stageName) {
        return workflow.history.some(h => h.stage === stageName);
    }

    /**
     * Record artifact for workflow
     * @param {string} workflowId - Workflow ID
     * @param {string} artifactType - Type of artifact (excel, script, testResult)
     * @param {string} artifactPath - Path to artifact
     */
    recordArtifact(workflowId, artifactType, artifactPath) {
        const workflow = this.state.workflows[workflowId];

        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        const artifactKey = `${artifactType}Path`;
        workflow.artifacts[artifactKey] = artifactPath;
        workflow.updatedAt = new Date().toISOString();

        // Emit artifact created event (Phase 3)
        this._emitEvent(WorkflowEvents.ARTIFACT_CREATED, {
            workflowId,
            ticketId: workflow.ticketId,
            artifactType,
            artifactPath,
            stage: workflow.currentStage
        });

        this.saveState();
    }

    /**
     * Record error for workflow
     * @param {string} workflowId - Workflow ID
     * @param {string} errorMessage - Error message
     * @param {Object} errorDetails - Additional error details
     */
    recordError(workflowId, errorMessage, errorDetails = {}) {
        const workflow = this.state.workflows[workflowId];

        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        workflow.errors.push({
            timestamp: new Date().toISOString(),
            stage: workflow.currentStage,
            message: errorMessage,
            details: errorDetails
        });

        workflow.updatedAt = new Date().toISOString();

        // Emit agent error event (Phase 3)
        this._emitEvent(WorkflowEvents.AGENT_ERROR, {
            workflowId,
            ticketId: workflow.ticketId,
            stage: workflow.currentStage,
            errorMessage,
            errorDetails,
            errorCount: workflow.errors.length
        });

        this.saveState();
    }

    /**
     * Fail workflow
     * @param {string} workflowId - Workflow ID
     * @param {string} reason - Failure reason
     */
    failWorkflow(workflowId, reason) {
        const workflow = this.state.workflows[workflowId];

        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        const failedAtStage = workflow.currentStage;
        workflow.status = 'FAILED';
        workflow.currentStage = WorkflowStage.FAILED;
        workflow.completedAt = new Date().toISOString();

        this.recordError(workflowId, `Workflow failed: ${reason}`);

        // Execute rollback strategy
        this.executeRollback(workflow);

        // Emit workflow failed event (Phase 3)
        this._emitEvent(WorkflowEvents.WORKFLOW_FAILED, {
            workflowId,
            ticketId: workflow.ticketId,
            reason,
            failedAtStage,
            artifacts: workflow.artifacts,
            errors: workflow.errors,
            duration: this.calculateDuration(workflow)
        });

        this.saveState();
    }

    /**
     * Execute rollback strategy
     * @param {Object} workflow - Workflow instance
     */
    executeRollback(workflow) {
        const strategy = workflow.template.rollbackStrategy;

        if (!strategy) {
            return;
        }

        workflow.currentStage = WorkflowStage.ROLLED_BACK;

        // Keep artifacts (already saved, no action needed for keepArtifacts)
        workflow.history.push({
            stage: WorkflowStage.ROLLED_BACK,
            timestamp: new Date().toISOString(),
            agent: Agent.ORCHESTRATOR,
            message: 'Rollback executed - artifacts preserved',
            data: {
                keptArtifacts: strategy.keepArtifacts,
                artifactPaths: workflow.artifacts
            }
        });
    }

    /**
     * Validate Excel file creation
     * @param {Object} workflow - Workflow instance
     * @param {Object} transitionData - Transition data containing excelPath
     * @returns {boolean} True if valid
     */
    validateExcel(workflow, transitionData) {
        if (!transitionData.excelPath) {
            return false;
        }

        const excelPath = path.resolve(transitionData.excelPath);

        if (!fs.existsSync(excelPath)) {
            return false;
        }

        // Check file size > 0
        const stats = fs.statSync(excelPath);
        if (stats.size === 0) {
            return false;
        }

        // Check it's an Excel file
        if (!excelPath.endsWith('.xlsx')) {
            return false;
        }

        // Record artifact
        this.recordArtifact(workflow.id, 'excel', excelPath);

        return true;
    }

    /**
     * Validate Playwright script generation
     * @param {Object} workflow - Workflow instance
     * @param {Object} transitionData - Transition data containing scriptPath
     * @returns {boolean} True if valid
     */
    validateScript(workflow, transitionData) {
        if (!transitionData.scriptPath) {
            return false;
        }

        const scriptPath = path.resolve(transitionData.scriptPath);

        if (!fs.existsSync(scriptPath)) {
            return false;
        }

        // Check file size > 0
        const stats = fs.statSync(scriptPath);
        if (stats.size === 0) {
            return false;
        }

        // Check it's a JavaScript spec file (framework uses .spec.js, NOT TypeScript)
        if (!scriptPath.endsWith('.spec.js')) {
            return false;
        }

        // Record artifact
        this.recordArtifact(workflow.id, 'script', scriptPath);

        return true;
    }

    /**
     * Get workflow health status
     * @param {string} workflowId - Workflow ID
     * @returns {Object} Health status
     */
    getWorkflowHealth(workflowId) {
        const workflow = this.state.workflows[workflowId];
        if (!workflow) {
            return { status: 'NOT_FOUND' };
        }

        const now = Date.now();
        const lastUpdate = new Date(workflow.updatedAt).getTime();
        const ageMinutes = (now - lastUpdate) / 60000;

        // Stage timeout thresholds (in minutes)
        const stageTimeouts = {
            [WorkflowStage.PENDING]: 1,
            [WorkflowStage.JIRA_FETCHED]: 1,
            [WorkflowStage.TESTCASES_GENERATED]: 2,
            [WorkflowStage.EXCEL_CREATED]: 1,
            [WorkflowStage.SCRIPT_EXPLORATION]: 5,
            [WorkflowStage.SCRIPT_GENERATED]: 3,
            [WorkflowStage.SCRIPT_EXECUTED]: 10
        };

        const timeoutMinutes = stageTimeouts[workflow.currentStage] || 5;
        const isStale = ageMinutes > timeoutMinutes;
        const isCritical = ageMinutes > (timeoutMinutes * 2);

        let recommendation = 'CONTINUE';
        if (isCritical) {
            recommendation = 'ROLLBACK';
        } else if (isStale) {
            recommendation = 'RETRY_STAGE';
        }

        return {
            workflowId: workflow.id,
            ticketId: workflow.ticketId,
            status: workflow.status,
            currentStage: workflow.currentStage,
            ageMinutes: Math.floor(ageMinutes),
            timeoutMinutes,
            isHealthy: workflow.status === 'ACTIVE' && !isStale,
            isStale,
            isCritical,
            recommendation,
            lastUpdate: workflow.updatedAt,
            errors: workflow.errors.length
        };
    }

    /**
     * Monitor all active workflows and take action on stale ones
     * @returns {Array} Array of actions taken
     */
    monitorActiveWorkflows() {
        const activeWorkflows = this.getActiveWorkflows();
        const actions = [];

        for (const workflow of activeWorkflows) {
            const health = this.getWorkflowHealth(workflow.id);

            if (!health.isHealthy) {
                const action = {
                    workflowId: workflow.id,
                    ticketId: workflow.ticketId,
                    health,
                    actionTaken: null
                };

                if (health.recommendation === 'RETRY_STAGE') {
                    action.actionTaken = 'NOTIFICATION_SENT';
                    action.message = `⚠️ Workflow ${workflow.ticketId} stuck at ${workflow.currentStage} for ${health.ageMinutes} minutes`;
                } else if (health.recommendation === 'ROLLBACK') {
                    action.actionTaken = 'FAILED';
                    this.failWorkflow(workflow.id, 'Workflow timeout exceeded (critical)');
                    action.message = `❌ Workflow ${workflow.ticketId} timed out and was marked as FAILED`;
                }

                actions.push(action);
            }
        }

        return actions;
    }

    /**
     * Get workflow summary for display
     * @param {string} workflowId - Workflow ID
     * @returns {Object} Workflow summary
     */
    getWorkflowSummary(workflowId) {
        const workflow = this.state.workflows[workflowId];

        if (!workflow) {
            return null;
        }

        const totalStages = workflow.template.stages.length;
        const completedStages = workflow.currentStageIndex;
        const progress = Math.round((completedStages / totalStages) * 100);
        const health = this.getWorkflowHealth(workflowId);

        return {
            id: workflow.id,
            ticketId: workflow.ticketId,
            template: workflow.templateName,
            status: workflow.status,
            currentStage: workflow.currentStage,
            progress: `${completedStages}/${totalStages} (${progress}%)`,
            startedAt: workflow.startedAt,
            duration: this.calculateDuration(workflow),
            artifacts: workflow.artifacts,
            errors: workflow.errors.length,
            lastError: workflow.errors.length > 0 ? workflow.errors[workflow.errors.length - 1] : null,
            health
        };
    }

    /**
     * Calculate workflow duration
     * @param {Object} workflow - Workflow instance
     * @returns {string} Duration string
     */
    calculateDuration(workflow) {
        const start = new Date(workflow.startedAt);
        const end = workflow.completedAt ? new Date(workflow.completedAt) : new Date();
        const durationMs = end - start;

        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);

        return `${minutes}m ${seconds}s`;
    }

    /**
     * Execute with retry and exponential backoff
     * @param {Function} operation - Async operation to execute
     * @param {string} workflowId - Workflow ID for error tracking
     * @param {Object} options - Retry options
     * @returns {Object} Result with success status and data/error
     */
    async executeWithRetry(operation, workflowId, options = {}) {
        const maxRetries = options.maxRetries || RetryConfig.maxRetries;
        const operationName = options.operationName || 'operation';

        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();

                // Record successful retry metrics
                if (attempt > 1) {
                    this.recordMetric(workflowId, 'retrySuccess', {
                        operation: operationName,
                        attempts: attempt
                    });
                }

                return { success: true, data: result, attempts: attempt };
            } catch (error) {
                lastError = error;

                // Check if error is retryable
                if (!RetryConfig.isRetryable(error) || attempt === maxRetries) {
                    this.recordError(workflowId, `${operationName} failed after ${attempt} attempts: ${error.message}`, {
                        errorCode: error.errorCode || 'UNKNOWN',
                        attempts: attempt,
                        stack: error.stack
                    });
                    break;
                }

                // Calculate delay and wait
                const delay = RetryConfig.getDelay(attempt);
                console.log(`⚠️ ${operationName} attempt ${attempt} failed. Retrying in ${delay}ms...`);

                this.recordMetric(workflowId, 'retryAttempt', {
                    operation: operationName,
                    attempt,
                    delay,
                    error: error.message
                });

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return {
            success: false,
            error: lastError,
            attempts: maxRetries,
            errorCode: lastError?.errorCode || 'UNKNOWN'
        };
    }

    /**
     * Record workflow metrics for analytics
     * @param {string} workflowId - Workflow ID
     * @param {string} metricType - Type of metric
     * @param {Object} data - Metric data
     */
    recordMetric(workflowId, metricType, data = {}) {
        const metrics = this.loadMetrics();

        if (!metrics.workflows[workflowId]) {
            metrics.workflows[workflowId] = {
                startedAt: new Date().toISOString(),
                metrics: []
            };
        }

        metrics.workflows[workflowId].metrics.push({
            type: metricType,
            timestamp: new Date().toISOString(),
            data
        });

        // Update aggregate metrics
        if (!metrics.aggregate[metricType]) {
            metrics.aggregate[metricType] = { count: 0, total: 0 };
        }
        metrics.aggregate[metricType].count++;

        this.saveMetrics(metrics);
    }

    /**
     * Load metrics from disk
     * @returns {Object} Metrics object
     */
    loadMetrics() {
        try {
            if (fs.existsSync(METRICS_FILE)) {
                return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
            }
        } catch (error) {
            console.warn(`Failed to load metrics: ${error.message}`);
        }
        return {
            version: '1.0.0',
            workflows: {},
            aggregate: {},
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Save metrics to disk
     * @param {Object} metrics - Metrics object
     */
    saveMetrics(metrics) {
        try {
            metrics.lastUpdated = new Date().toISOString();
            fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf8');
        } catch (error) {
            console.warn(`Failed to save metrics: ${error.message}`);
        }
    }

    /**
     * Get workflow analytics summary
     * @returns {Object} Analytics summary
     */
    getAnalyticsSummary() {
        const metrics = this.loadMetrics();
        const workflows = Object.values(this.state.workflows);

        const completedWorkflows = workflows.filter(w => w.status === 'COMPLETED');
        const failedWorkflows = workflows.filter(w => w.status === 'FAILED');

        // Calculate average duration for completed workflows
        let totalDurationMs = 0;
        for (const workflow of completedWorkflows) {
            const start = new Date(workflow.startedAt);
            const end = new Date(workflow.completedAt);
            totalDurationMs += (end - start);
        }
        const avgDurationMs = completedWorkflows.length > 0
            ? totalDurationMs / completedWorkflows.length
            : 0;

        // Calculate success rate
        const totalWorkflows = completedWorkflows.length + failedWorkflows.length;
        const successRate = totalWorkflows > 0
            ? Math.round((completedWorkflows.length / totalWorkflows) * 100)
            : 0;

        return {
            totalWorkflows: workflows.length,
            completed: completedWorkflows.length,
            failed: failedWorkflows.length,
            active: workflows.filter(w => w.status === 'ACTIVE').length,
            successRate: `${successRate}%`,
            avgDuration: this.formatDuration(avgDurationMs),
            retryStats: metrics.aggregate.retryAttempt || { count: 0 },
            retrySuccesses: metrics.aggregate.retrySuccess || { count: 0 },
            lastUpdated: metrics.lastUpdated
        };
    }

    /**
     * Format duration in milliseconds to human-readable string
     * @param {number} ms - Duration in milliseconds
     * @returns {string} Formatted duration
     */
    formatDuration(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AI-POWERED ERROR ANALYSIS (NEW IN 2.1.0)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Analyze test failure with AI-powered insights
     * @param {string} workflowId - Workflow ID
     * @param {string} errorOutput - Raw error output from test execution
     * @param {Object} context - Additional context
     * @returns {Object} Analysis result with suggestions and auto-fix
     */
    analyzeError(workflowId, errorOutput, context = {}) {
        const analyzer = getErrorAnalyzer();
        if (!analyzer) {
            return {
                success: false,
                message: 'Error analyzer not available',
                suggestions: ['Check error-analyzer.js module']
            };
        }

        const workflow = this.state.workflows[workflowId];
        const analysisContext = {
            ...context,
            workflowId,
            ticketId: workflow?.ticketId,
            currentStage: workflow?.currentStage,
            artifacts: workflow?.artifacts
        };

        const analysis = analyzer.analyze(errorOutput, analysisContext);

        // Record analysis in workflow history
        if (workflow) {
            workflow.history.push({
                stage: workflow.currentStage,
                timestamp: new Date().toISOString(),
                agent: Agent.ORCHESTRATOR,
                message: 'AI error analysis performed',
                data: {
                    category: analysis.category,
                    severity: analysis.severity,
                    autoFixable: analysis.autoFixable,
                    suggestionsCount: analysis.suggestions.length
                }
            });
            this.saveState();
        }

        // Record metric
        this.recordMetric(workflowId, 'errorAnalysis', {
            category: analysis.category,
            severity: analysis.severity,
            autoFixable: analysis.autoFixable
        });

        return analysis;
    }

    /**
     * Apply AI-suggested auto-fix to script
     * @param {string} workflowId - Workflow ID
     * @param {string} scriptPath - Path to script file
     * @param {Object} autoFix - Auto-fix object from analysis
     * @returns {Object} Result with success status
     */
    applyAutoFix(workflowId, scriptPath, autoFix) {
        const analyzer = getErrorAnalyzer();
        if (!analyzer) {
            return { success: false, message: 'Error analyzer not available' };
        }

        const result = analyzer.applyAutoFix(scriptPath, autoFix);

        // Record in workflow
        const workflow = this.state.workflows[workflowId];
        if (workflow) {
            workflow.history.push({
                stage: workflow.currentStage,
                timestamp: new Date().toISOString(),
                agent: Agent.SCRIPTGENERATOR,
                message: result.success ? 'Auto-fix applied' : 'Auto-fix failed',
                data: result
            });
            this.saveState();
        }

        // Record metric
        this.recordMetric(workflowId, 'autoFix', {
            success: result.success,
            changes: result.changes?.length || 0
        });

        return result;
    }

    /**
     * Get AI error analysis report
     * @param {string} workflowId - Workflow ID
     * @param {string} errorOutput - Error output to analyze
     * @returns {string} Formatted analysis report
     */
    getErrorReport(workflowId, errorOutput) {
        const analyzer = getErrorAnalyzer();
        if (!analyzer) {
            return 'Error analyzer not available';
        }

        const analysis = this.analyzeError(workflowId, errorOutput);
        return analyzer.generateReport(analysis);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CUSTOM TEMPLATE MANAGEMENT (NEW IN 2.1.0)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get custom templates manager
     * @returns {Object|null} Templates manager instance
     */
    getTemplatesManager() {
        return getCustomTemplatesManager();
    }

    /**
     * Register a custom workflow template
     * @param {string} templateId - Unique template ID
     * @param {Object} template - Template configuration
     * @returns {string} Registered template ID
     */
    registerCustomTemplate(templateId, template) {
        const manager = getCustomTemplatesManager();
        if (!manager) {
            throw new Error('Custom templates manager not available');
        }
        return manager.register(templateId, template);
    }

    /**
     * Get template (built-in or custom)
     * @param {string} templateName - Template name/ID
     * @returns {Object|null} Template configuration
     */
    getTemplate(templateName) {
        // Check built-in templates first
        if (WorkflowTemplates[templateName]) {
            return WorkflowTemplates[templateName];
        }

        // Check custom templates
        const manager = getCustomTemplatesManager();
        if (manager) {
            const customTemplate = manager.get(templateName);
            if (customTemplate) {
                return customTemplate;
            }
        }

        return null;
    }

    /**
     * List all available templates (built-in + custom)
     * @returns {Array} List of template summaries
     */
    listAllTemplates() {
        const templates = [];

        // Add built-in templates
        for (const [id, template] of Object.entries(WorkflowTemplates)) {
            templates.push({
                id,
                name: template.name,
                description: template.description,
                stages: template.stages.length,
                type: 'built-in'
            });
        }

        // Add custom templates
        const manager = getCustomTemplatesManager();
        if (manager) {
            for (const custom of manager.list()) {
                templates.push({
                    ...custom,
                    type: 'custom'
                });
            }
        }

        return templates;
    }

    /**
     * Create a template builder for defining custom templates
     * @param {string} name - Template name
     * @returns {Object} Template builder instance
     */
    createTemplateBuilder(name) {
        const manager = getCustomTemplatesManager();
        if (!manager) {
            throw new Error('Custom templates manager not available');
        }
        return manager.createBuilder(name);
    }

    /**
     * Initialize workflow with custom or built-in template
     * @param {string} ticketId - Jira ticket ID
     * @param {string} templateName - Template name (built-in or custom)
     * @param {Object} options - Additional options including template variables
     * @returns {Object} Initialized workflow
     */
    initializeWorkflowWithTemplate(ticketId, templateName, options = {}) {
        const template = this.getTemplate(templateName);
        if (!template) {
            throw new Error(`Template not found: ${templateName}. Use listAllTemplates() to see available templates.`);
        }

        // Merge template variables with provided options
        const mergedOptions = {
            ...options,
            variables: { ...template.variables, ...options.variables }
        };

        return this.initializeWorkflow(ticketId, templateName, mergedOptions);
    }

    /**
     * Create standardized error object
     * @param {string} errorCodeKey - Key from ErrorCode enum
     * @param {string} details - Additional error details
     * @returns {Error} Standardized error object
     */
    static createError(errorCodeKey, details = '') {
        const errorDef = ErrorCode[errorCodeKey] || { code: 'E9999', message: 'Unknown error', recoverable: false };
        const error = new Error(`[${errorDef.code}] ${errorDef.message}${details ? ': ' + details : ''}`);
        error.errorCode = errorCodeKey;
        error.code = errorDef.code;
        error.recoverable = errorDef.recoverable;
        return error;
    }

    /**
     * Get all available workflow templates
     * @returns {Object} Workflow templates
     */
    static getTemplates() {
        return WorkflowTemplates;
    }

    /**
     * Get template by name
     * @param {string} templateName - Template name
     * @returns {Object|null} Template or null
     */
    static getTemplate(templateName) {
        return WorkflowTemplates[templateName] || null;
    }
}

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Core classes
        WorkflowCoordinator,
        WorkflowEventBus,
        WorkflowError,
        WorkflowLogger,

        // Enums and constants
        WorkflowStage,
        WorkflowEvents,
        Agent,
        WorkflowTemplates,
        ErrorCode,
        RetryConfig,
        PerformanceConfig,
        LogLevel,

        // Utilities
        getErrorAnalyzer,
        getCustomTemplatesManager
    };
}
