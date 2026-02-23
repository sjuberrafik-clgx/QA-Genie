/**
 * Shared Constants — Single source of truth for magic numbers, limits, and enums.
 * Import from '@/lib/constants' wherever these values are needed.
 */

// ─── Network Timeouts (ms) ──────────────────────────────────────────────────

export const TIMEOUTS = {
    DEFAULT: 30_000,
    HEALTH: 5_000,
    PIPELINE_START: 15_000,
    CHAT_MESSAGE: 60_000,
    RUN_STATUS: 10_000,
};

// ─── Retry Configuration ────────────────────────────────────────────────────

export const RETRY = {
    DEFAULT_RETRIES: 1,
    DELAY_MS: 2_000,
};

// ─── UI Limits ──────────────────────────────────────────────────────────────

export const LIMITS = {
    TITLE_MAX_LENGTH: 60,
    TITLE_TRUNCATED_LENGTH: 57,
};

// ─── SSE Event Types ────────────────────────────────────────────────────────

export const SSE_EVENT_TYPES = {
    // Pipeline events
    RUN_START: 'run_start',
    RUN_COMPLETE: 'run_complete',
    STAGE_START: 'stage_start',
    STAGE_PROGRESS: 'stage_progress',
    STAGE_COMPLETE: 'stage_complete',
    TOOL_CALL: 'tool_call',
    TOOL_RESULT: 'tool_result',
    AI_DELTA: 'ai_delta',
    ERROR: 'error',
    STREAM_END: 'stream_end',
    REPORT_SAVED: 'report_saved',
    // Chat events
    CHAT_DELTA: 'chat_delta',
    CHAT_MESSAGE: 'chat_message',
    CHAT_TOOL_START: 'chat_tool_start',
    CHAT_TOOL_COMPLETE: 'chat_tool_complete',
    CHAT_REASONING: 'chat_reasoning',
    CHAT_IDLE: 'chat_idle',
    CHAT_ERROR: 'chat_error',
    CHAT_FOLLOWUP: 'chat_followup',
};

/** Flat list of all SSE event type strings — used for EventSource.addEventListener */
export const SSE_EVENT_TYPE_LIST = Object.values(SSE_EVENT_TYPES);

// ─── SSE Reconnect ──────────────────────────────────────────────────────────

export const MAX_RECONNECT_DELAY_MS = 15_000;

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Truncate a string for use as a session title.
 * @param {string} text
 * @param {number} [max=LIMITS.TITLE_MAX_LENGTH]
 * @returns {string}
 */
export function truncateTitle(text, max = LIMITS.TITLE_MAX_LENGTH) {
    if (!text || text.length <= max) return text || '';
    return text.substring(0, LIMITS.TITLE_TRUNCATED_LENGTH) + '...';
}
