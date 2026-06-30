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
    MAX_VIDEOS_PER_MESSAGE: 2,
    MAX_VIDEO_SIZE_BYTES: 200 * 1024 * 1024, // 200 MB per video
    // Hard caps on the in-memory React arrays for the chat timeline. Independent
    // of the on-screen virtualization (<Virtuoso> physically mounts only the rows
    // near the viewport) — these bound the JS heap + the cost of rebuilding and
    // sorting the timeline on every SSE event. A very long agent or orchestrator
    // session would otherwise grow these without limit (renderer churn → Chrome
    // STATUS_BREAKPOINT). Oldest items are dropped on overflow; the full transcript
    // remains available server-side via the /history endpoint.
    MAX_RENDERED_MESSAGES: 400,
    MAX_RENDERED_TOOL_GROUPS: 60,
    // Chat renderer memory guards — keep the live streaming buffers and retained
    // tool-result payloads bounded so long agent runs don't exhaust the renderer
    // heap (Chrome STATUS_BREAKPOINT). The full, untruncated content still arrives
    // on message finalization from the server.
    MAX_STREAMING_CONTENT_CHARS: 200_000,   // ~200 KB live streaming text buffer
    MAX_STREAMING_REASONING_CHARS: 120_000, // ~120 KB live streaming reasoning buffer
    MAX_TOOL_RESULT_DISPLAY_CHARS: 20_000,  // cap stored tool-result strings (large MCP snapshots)
    // Inline image attachments (base64 dataUrl) are retained in React state for the
    // whole session. Across many agent runs (e.g. creating several BugGenie tickets
    // with screenshots in one chat), the accumulated base64 exhausts the renderer
    // heap and Chrome aborts the tab (STATUS_BREAKPOINT). Keep full inline bytes only
    // for the most recent images (by count AND total bytes); older inline images are
    // evicted to a lightweight descriptor. Full bytes remain available server-side via
    // the /history endpoint.
    MAX_RETAINED_ATTACHMENT_IMAGES: 12,            // newest inline images kept fully decodable
    MAX_RETAINED_ATTACHMENT_BYTES: 48 * 1024 * 1024, // ~48 MB total base64 retained in state
    // Approval / user-input prompts accumulate in React state across a session. Each
    // gated Jira write (e.g. commenting on several tickets in one chat) appends one
    // prompt; without a cap the array grows unbounded over long sessions. Keep only
    // the most recent prompts mounted — older resolved prompts add no value.
    MAX_RETAINED_USER_INPUT_REQUESTS: 40,
    // Bound the SSE event queue so a reconnect burst (server replays buffered events)
    // can't spike the renderer heap before the batched flush drains it.
    MAX_QUEUED_SSE_EVENTS: 600,
    // Byte-budget backstop for the SSE queue. The server strips inline base64 from
    // outbound frames, but this guards against any large payload (e.g. a stray
    // dataUrl) accumulating in the queue faster than it drains — drop oldest events
    // once the queued bytes exceed this ceiling.
    MAX_QUEUED_SSE_BYTES: 24 * 1024 * 1024, // ~24 MB of queued event payload
};

// ─── Renderer Memory Guard ──────────────────────────────────────────────────
// Runtime safety net for the chat view. The Chrome STATUS_BREAKPOINT ("Aw, Snap!")
// crash on long, image-heavy sessions is driven by DOM-node count + decoded image
// bitmaps — the "Other (HTML)" heap category — NOT the JS heap. performance.memory
// only measures the JS heap, so it cannot even observe this class of crash. The
// guard samples DOM nodes + the mounted-image pixel budget (the proxies that DO
// track the dangerous category) and sheds load (shrinks the render window, evicts
// old inline images) before the renderer is aborted.
export const MEMORY_GUARD = {
    ENABLED: true,
    SAMPLE_MS: 5_000,              // how often to sample the DOM / image budget
    INITIAL_DELAY_MS: 1_500,       // let the first paint settle before sampling
    MAX_DOM_NODES: 12_000,         // shed load above this many live DOM elements
    MAX_IMAGE_PIXELS: 24_000_000,  // Σ (naturalW × naturalH) of mounted <img> (~96 MB RGBA)
    COOLDOWN_MS: 10_000,           // minimum gap between successive load-shed actions
};

// ─── Allowed Document Types ─────────────────────────────────────────────────

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const ALLOWED_DOC_TYPES = {
    'application/pdf': { ext: '.pdf', label: 'PDF' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', label: 'Word' },
    'application/msword': { ext: '.doc', label: 'Word' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', label: 'PowerPoint' },
    'application/vnd.ms-powerpoint': { ext: '.ppt', label: 'PowerPoint' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', label: 'Excel' },
    'application/vnd.ms-excel': { ext: '.xls', label: 'Excel' },
    'text/csv': { ext: '.csv', label: 'CSV' },
    'text/plain': { ext: '.txt', label: 'Text' },
    'text/markdown': { ext: '.md', label: 'Markdown' },
    'application/json': { ext: '.json', label: 'JSON' },
};

// ─── Allowed Video Types ────────────────────────────────────────────────────

export const ALLOWED_VIDEO_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
];

export const ALLOWED_VIDEO_EXTENSIONS = {
    'video/mp4': { ext: '.mp4', label: 'MP4' },
    'video/webm': { ext: '.webm', label: 'WebM' },
    'video/quicktime': { ext: '.mov', label: 'MOV' },
    'video/x-msvideo': { ext: '.avi', label: 'AVI' },
    'video/x-matroska': { ext: '.mkv', label: 'MKV' },
};

export const VIDEO_EXT_TO_MIME = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
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
    ...ALLOWED_VIDEO_TYPES,
    // Also include extensions for browsers that don't match MIME
    '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.csv', '.txt', '.md', '.json',
    '.mp4', '.webm', '.mov', '.avi', '.mkv',
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
    // Delegation sub-thread (a specialist running on the master's behalf)
    CHAT_DELEGATION_START: 'chat_delegation_start',
    CHAT_DELEGATION_DELTA: 'chat_delegation_delta',
    CHAT_DELEGATION_TOOL_START: 'chat_delegation_tool_start',
    CHAT_DELEGATION_TOOL_COMPLETE: 'chat_delegation_tool_complete',
    CHAT_DELEGATION_COMPLETE: 'chat_delegation_complete',
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
