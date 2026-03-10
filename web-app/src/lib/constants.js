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
    MAX_IMAGES_PER_MESSAGE: 10,
    MAX_IMAGE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB per image
    MAX_DOCS_PER_MESSAGE: 5,
    MAX_DOC_SIZE_BYTES: 50 * 1024 * 1024, // 50 MB per document
};

// ─── Allowed Document Types ─────────────────────────────────────────────────

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const ALLOWED_DOC_TYPES = {
    'application/pdf':                                                      { ext: '.pdf',  label: 'PDF' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', label: 'Word' },
    'application/msword':                                                   { ext: '.doc',  label: 'Word' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', label: 'PowerPoint' },
    'application/vnd.ms-powerpoint':                                        { ext: '.ppt',  label: 'PowerPoint' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':     { ext: '.xlsx', label: 'Excel' },
    'application/vnd.ms-excel':                                             { ext: '.xls',  label: 'Excel' },
    'text/csv':                                                             { ext: '.csv',  label: 'CSV' },
    'text/plain':                                                           { ext: '.txt',  label: 'Text' },
    'text/markdown':                                                        { ext: '.md',   label: 'Markdown' },
    'application/json':                                                     { ext: '.json', label: 'JSON' },
};

/** File extensions → MIME type lookup (for files where browser reports empty/generic MIME) */
export const DOC_EXT_TO_MIME = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
};

/** Combined accept string for <input type="file"> */
export const FILE_ACCEPT_STRING = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    ...Object.keys(ALLOWED_DOC_TYPES),
    // Also include extensions for browsers that don't match MIME
    '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.csv', '.txt', '.md', '.json',
].join(',');

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
    // Cognitive events
    COGNITIVE_SCALING: 'cognitive_scaling',
    OODA_HEALTH: 'ooda_health_check',
    // Chat events
    CHAT_DELTA: 'chat_delta',
    CHAT_MESSAGE: 'chat_message',
    CHAT_TOOL_START: 'chat_tool_start',
    CHAT_TOOL_COMPLETE: 'chat_tool_complete',
    CHAT_TOOL_PROGRESS: 'chat_tool_progress',
    CHAT_REASONING: 'chat_reasoning',
    CHAT_IDLE: 'chat_idle',
    CHAT_ERROR: 'chat_error',
    CHAT_FOLLOWUP: 'chat_followup',
    CHAT_USER_INPUT_REQUEST: 'chat_user_input_request',
    CHAT_USER_INPUT_COMPLETE: 'chat_user_input_complete',
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
