/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EVENT BRIDGE — Unified Pipeline Event Stream
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Normalizes events from multiple sources (pipeline progress, SDK tool calls,
 * AI responses, session errors) into a single typed event stream. Powers:
 *
 *   - Server-Sent Events (SSE) for real-time clients
 *   - Run store stage updates
 *   - Notification triggers
 *   - CLI progress display
 *
 * Event Schema:
 *   {
 *     type: 'stage_start' | 'stage_complete' | 'stage_progress' |
 *           'tool_call' | 'tool_result' | 'ai_delta' |
 *           'run_start' | 'run_complete' | 'error',
 *     runId: string,
 *     timestamp: ISO-8601,
 *     data: { ... event-specific payload }
 *   }
 *
 * @module sdk-orchestrator/event-bridge
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { EventEmitter } = require('events');

// ─── Event Types ────────────────────────────────────────────────────────────

const EVENT_TYPES = {
    RUN_START: 'run_start',
    RUN_COMPLETE: 'run_complete',
    STAGE_START: 'stage_start',
    STAGE_PROGRESS: 'stage_progress',
    STAGE_COMPLETE: 'stage_complete',
    TOOL_CALL: 'tool_call',
    TOOL_RESULT: 'tool_result',
    AI_DELTA: 'ai_delta',
    ERROR: 'error',
    REPORT_SAVED: 'report_saved',
};

// ─── Event Bridge ───────────────────────────────────────────────────────────

class EventBridge extends EventEmitter {
    constructor() {
        super();
        // Increase max listeners — each SSE client adds listeners
        this.setMaxListeners(100);

        // Per-run event buffers for late-joining clients
        this._runBuffers = new Map();
        this._maxBufferSize = 200;
    }

    /**
     * Emit a structured event and buffer it for the run.
     *
     * @param {string} type   - Event type from EVENT_TYPES
     * @param {string} runId  - Pipeline run ID
     * @param {Object} data   - Event-specific payload
     */
    push(type, runId, data = {}) {
        const event = {
            type,
            runId,
            timestamp: new Date().toISOString(),
            data,
        };

        // Buffer for run
        if (!this._runBuffers.has(runId)) {
            this._runBuffers.set(runId, []);
        }
        const buffer = this._runBuffers.get(runId);
        buffer.push(event);
        if (buffer.length > this._maxBufferSize) {
            buffer.shift(); // Evict oldest
        }

        // Emit to general listeners
        this.emit('event', event);
        // Emit to run-specific listeners
        this.emit(`event:${runId}`, event);
        // Emit to type-specific listeners
        this.emit(type, event);
    }

    /**
     * Create a pipeline progress callback compatible with PipelineRunner.
     * Maps (stage, message) calls to structured events on this bridge.
     *
     * @param {string} runId
     * @returns {Function} onProgress(stage, message) callback
     */
    createProgressCallback(runId) {
        return (stage, message) => {
            if (message.startsWith('Starting ')) {
                this.push(EVENT_TYPES.STAGE_START, runId, { stage, message });
            } else if (message === 'Completed' || message.includes('passed') || message.includes('generated')) {
                this.push(EVENT_TYPES.STAGE_COMPLETE, runId, {
                    stage,
                    message,
                    success: !message.includes('failed') && !message.includes('BLOCKED'),
                });
            } else if (message.startsWith('BLOCKED') || message.startsWith('ERROR')) {
                this.push(EVENT_TYPES.STAGE_COMPLETE, runId, {
                    stage,
                    message,
                    success: false,
                });
            } else {
                this.push(EVENT_TYPES.STAGE_PROGRESS, runId, { stage, message });
            }
        };
    }

    /**
     * Hook into an AgentSessionFactory's session events.
     * Call this after creating a session to wire tool/delta events.
     *
     * @param {string} runId      - Pipeline run ID
     * @param {Object} session    - SDK session object
     * @param {string} agentName  - Agent name for context
     * @returns {Function[]} Unsubscribe functions — call to clean up
     */
    bridgeSessionEvents(runId, session, agentName) {
        const unsubscribers = [];

        // Tool execution start
        if (typeof session.on === 'function') {
            const unsub1 = session.on('tool.execution_start', (event) => {
                this.push(EVENT_TYPES.TOOL_CALL, runId, {
                    agent: agentName,
                    toolName: event?.data?.toolName || 'unknown',
                });
            });
            if (unsub1) unsubscribers.push(unsub1);

            // Tool execution end
            const unsub2 = session.on('tool.execution_end', (event) => {
                this.push(EVENT_TYPES.TOOL_RESULT, runId, {
                    agent: agentName,
                    toolName: event?.data?.toolName || 'unknown',
                    success: event?.data?.success ?? true,
                });
            });
            if (unsub2) unsubscribers.push(unsub2);

            // AI response deltas
            const unsub3 = session.on('assistant.message_delta', (event) => {
                this.push(EVENT_TYPES.AI_DELTA, runId, {
                    agent: agentName,
                    delta: event?.data?.deltaContent || '',
                });
            });
            if (unsub3) unsubscribers.push(unsub3);

            // Session errors
            const unsub4 = session.on('session.error', (event) => {
                this.push(EVENT_TYPES.ERROR, runId, {
                    agent: agentName,
                    error: event?.data?.message || event?.data?.error || 'Unknown session error',
                });
            });
            if (unsub4) unsubscribers.push(unsub4);
        }

        return unsubscribers;
    }

    /**
     * Get buffered events for a run (for late-joining SSE clients).
     *
     * @param {string} runId
     * @returns {Object[]} Array of events
     */
    getRunEvents(runId) {
        return this._runBuffers.get(runId) || [];
    }

    /**
     * Clean up event buffer for a completed run.
     * Call after run completion + a grace period.
     *
     * @param {string} runId
     */
    cleanupRun(runId) {
        this._runBuffers.delete(runId);
    }

    /**
     * Format an event as an SSE data string.
     *
     * @param {Object} event
     * @returns {string} SSE-formatted string
     */
    static formatSSE(event) {
        const lines = [];
        lines.push(`event: ${event.type}`);
        lines.push(`data: ${JSON.stringify(event)}`);
        lines.push(''); // Trailing newline required by SSE spec
        return lines.join('\n') + '\n';
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get the global EventBridge singleton.
 * @returns {EventBridge}
 */
function getEventBridge() {
    if (!_instance) {
        _instance = new EventBridge();
    }
    return _instance;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { EventBridge, EVENT_TYPES, getEventBridge };
