/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ORCHESTRATOR — Shared Utilities
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Common utilities shared across pipeline-runner, self-healing, server, and
 * other sdk-orchestrator modules. Eliminates duplication and provides a
 * single source of truth for cross-cutting helpers.
 *
 * @module sdk-orchestrator/utils
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── JSON Extraction ────────────────────────────────────────────────────────

/**
 * Extract a JSON object from a string that may contain non-JSON content
 * (e.g., npm install logs, shell output mixed with JSON).
 *
 * @param {string} str - Raw string possibly containing a JSON object
 * @returns {Object} Parsed JSON object
 * @throws {SyntaxError} If no valid JSON object found
 */
function extractJSON(str) {
    const firstBrace = str.indexOf('{');
    const lastBrace = str.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(str.substring(firstBrace, lastBrace + 1));
    }
    return JSON.parse(str);
}

// ─── Configuration Helpers ──────────────────────────────────────────────────

/**
 * Load workflow-config.json with BOM handling.
 *
 * @param {string} [configDir] - Directory containing workflow-config.json
 * @returns {Object} Parsed configuration
 */
function loadWorkflowConfig(configDir) {
    const configPath = path.join(configDir || path.join(__dirname, '..'), 'config', 'workflow-config.json');
    try {
        let content = fs.readFileSync(configPath, 'utf-8');
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        return JSON.parse(content);
    } catch (error) {
        console.error(`Failed to load workflow-config.json: ${error.message}`);
        return {};
    }
}

/**
 * Load environment variables from .env file.
 *
 * @param {string} [envDir] - Directory containing .env file
 */
function loadEnv(envDir) {
    try {
        require('dotenv').config({ path: path.join(envDir || path.join(__dirname, '..'), '.env'), override: true });
    } catch {
        // dotenv not installed — continue with process.env
    }
}

/**
 * Get SDK timeout for a specific stage from workflow-config.json.
 * Falls back to provided default if config value not found.
 *
 * @param {Object} config - Loaded workflow-config.json
 * @param {string} stage  - Stage name (testgenie, scriptgenerator, buggenie, execution, healing)
 * @param {number} defaultMs - Default timeout in milliseconds
 * @returns {number} Timeout in milliseconds
 */
function getStageTimeout(config, stage, defaultMs) {
    const timeout = config?.sdk?.timeouts?.[stage];
    if (typeof timeout === 'number' && timeout > 0) {
        return timeout;
    }
    return defaultMs;
}

// ─── ID Generation ──────────────────────────────────────────────────────────

/**
 * Generate a unique run ID.
 * Format: run_<timestamp>_<random> for human readability + uniqueness.
 *
 * @returns {string} Unique run ID
 */
function generateRunId() {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    return `run_${ts}_${rand}`;
}

/**
 * Generate a unique batch ID.
 *
 * @returns {string} Unique batch ID
 */
function generateBatchId() {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    return `batch_${ts}_${rand}`;
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

/**
 * Format milliseconds into a human-readable duration string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2m 15s", "45s", "1h 3m")
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Truncate a string to a maximum length, appending '...' if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 500) {
    if (!str || str.length <= maxLen) return str || '';
    return str.substring(0, maxLen) + '...';
}

// ─── File System Helpers ────────────────────────────────────────────────────

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Safely write JSON to a file (atomic write via temp + rename).
 * @param {string} filePath
 * @param {Object} data
 */
function writeJSONSync(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Safely read JSON from a file, returning defaultValue on any error.
 * @param {string} filePath
 * @param {*} defaultValue
 * @returns {*}
 */
function readJSONSync(filePath, defaultValue = null) {
    try {
        let content = fs.readFileSync(filePath, 'utf-8');
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
        return JSON.parse(content);
    } catch {
        return defaultValue;
    }
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validate a Jira ticket ID format.
 * @param {string} ticketId
 * @returns {boolean}
 */
function isValidTicketId(ticketId) {
    return /^[A-Z][A-Z0-9]+-\d+$/i.test(ticketId);
}

/**
 * Validate pipeline mode.
 * @param {string} mode
 * @returns {boolean}
 */
function isValidMode(mode) {
    return ['full', 'testcase', 'generate', 'heal', 'execute'].includes(mode);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    extractJSON,
    loadWorkflowConfig,
    loadEnv,
    getStageTimeout,
    generateRunId,
    generateBatchId,
    formatDuration,
    truncate,
    ensureDir,
    writeJSONSync,
    readJSONSync,
    isValidTicketId,
    isValidMode,
};
