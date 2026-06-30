/**
 * Chat Constants — Shared constants for the chat session manager ecosystem.
 * @module sdk-orchestrator/chat-utils/chat-constants
 */

const path = require('path');

// ─── Chat Event Types ───────────────────────────────────────────────────────

const CHAT_EVENTS = {
    DELTA: 'chat_delta',
    MESSAGE: 'chat_message',
    TOOL_START: 'chat_tool_start',
    TOOL_COMPLETE: 'chat_tool_complete',
    TOOL_PROGRESS: 'chat_tool_progress',
    REASONING: 'chat_reasoning',
    IDLE: 'chat_idle',
    ERROR: 'chat_error',
    FOLLOWUP: 'chat_followup',
    USER_INPUT_REQUEST: 'chat_user_input_request',
    USER_INPUT_COMPLETE: 'chat_user_input_complete',
    // Delegation sub-thread (a specialist running on the master's behalf)
    DELEGATION_START: 'chat_delegation_start',
    DELEGATION_DELTA: 'chat_delegation_delta',
    DELEGATION_TOOL_START: 'chat_delegation_tool_start',
    DELEGATION_TOOL_COMPLETE: 'chat_delegation_tool_complete',
    DELEGATION_COMPLETE: 'chat_delegation_complete',
};

// ─── Numeric Constants ──────────────────────────────────────────────────────

const MAX_ASSISTANT_IMAGE_BYTES = 6 * 1024 * 1024;
// SSE replay caps — applied when a client (re)connects and the server replays
// recent messages. Replay must stay lightweight to avoid flooding the browser
// renderer with multi-MB payloads (root cause of Chrome STATUS_BREAKPOINT
// crashes on new-chat / stop). Full attachment bytes are NOT replayed; the
// client fetches them on demand via the /history endpoint.
const MAX_SSE_REPLAY_MESSAGES = 20;
const MAX_REPLAY_CONTENT_CHARS = 20000;
const MAX_REPLAY_REASONING_CHARS = 8000;
// Coalescing window for high-frequency per-token DELTA/REASONING SSE events.
// Extended-thinking models emit thousands of these per response; forwarding each
// as its own SSE frame floods the browser EventSource parser and starves the
// renderer (Chrome STATUS_BREAKPOINT). Per-token deltas are accumulated and
// flushed at most once per this window (transparent to the client, which simply
// concatenates deltaContent). Any non-delta event flushes pending deltas first to
// preserve ordering. ~50ms keeps streaming visually smooth while cutting frame
// volume 10-50x.
const SSE_DELTA_COALESCE_MS = 50;
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const RECOVERY_HISTORY_LIMIT = 20;
const MAX_RECOVERY_TRANSCRIPT_CHARS = 8000;
const SESSION_TITLE_MAX_LENGTH = 72;
const SESSION_TITLE_TRUNCATED_LENGTH = 69;
const MAX_PERSISTED_SESSION_ATTACHMENTS = 30;
// Byte budget (decoded image bytes) for retained inline session attachments. The
// count cap alone (30) can still pin hundreds of MB if every item is a large
// screenshot, which inflates SSE frames and server heap. Evict oldest inline
// images beyond this budget so a long session (e.g. many BugGenie tickets) stays
// bounded. Videos/documents are stored as file paths, not inline, so they don't
// count against this budget.
const MAX_PERSISTED_SESSION_ATTACHMENT_BYTES = 64 * 1024 * 1024; // ~64 MB decoded
const MAX_PERSISTED_VIDEO_CONTEXT_ITEMS = 12;
const MAX_PERSISTED_VIDEO_FRAMES_PER_ITEM = 120;
// Per-session byte budget for the on-disk inline attachment store (assistant
// images published into the transcript). Image bytes are served on demand via
// the attachment endpoint instead of being inlined as base64 in history/SSE,
// so the renderer never holds the full set at once (Chrome STATUS_BREAKPOINT).
// Oldest stored files are evicted once a session exceeds this budget.
const MAX_SESSION_ATTACHMENT_STORE_BYTES = 64 * 1024 * 1024; // ~64 MB on disk per session
// Backstop cap on the number of messages returned by getHistory(). Attachments
// are now lightweight references, so the dominant cost is text; this bounds the
// JSON payload the browser must parse on session open. The frontend renders a
// windowed subset anyway, and realistic sessions are far below this ceiling.
const MAX_HISTORY_MESSAGES = 300;

// ─── Session State Enums ────────────────────────────────────────────────────

const GENERIC_SESSION_TITLES = new Set([
    'hi', 'hello', 'hey', 'help', 'start', 'new chat', 'chat', 'session',
]);

const SESSION_RUNTIME_STATES = {
    QUEUED: 'queued',
    INITIALIZING: 'initializing',
    ACTIVE: 'active',
    RESUME_REQUIRED: 'resume_required',
    RECOVERING: 'recovering',
    FAILED: 'failed',
    ARCHIVED: 'archived',
};

const SESSION_EXECUTION_STATES = {
    IDLE: 'idle',
    RUNNING: 'running',
    WAITING_FOR_INPUT: 'waiting_for_input',
    ERROR: 'error',
};

// ─── Regex Patterns ─────────────────────────────────────────────────────────

const USER_INPUT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_INPUT_REQUEST_ID_RE = /^uir_[a-z0-9_\-]+$/i;

const CHAT_SHELL_TOOL_PATTERNS = [
    'runinterminal', 'run_in_terminal', 'powershell', 'terminal',
    'bash', 'cmd', 'shell', 'execute_command',
];

// ─── Shared Micro-Helpers ───────────────────────────────────────────────────

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
    CHAT_EVENTS,
    MAX_ASSISTANT_IMAGE_BYTES,
    MAX_SSE_REPLAY_MESSAGES,
    MAX_REPLAY_CONTENT_CHARS,
    MAX_REPLAY_REASONING_CHARS,
    SSE_DELTA_COALESCE_MS,
    PROJECT_ROOT,
    USER_INPUT_TIMEOUT_MS,
    RECOVERY_HISTORY_LIMIT,
    MAX_RECOVERY_TRANSCRIPT_CHARS,
    SESSION_TITLE_MAX_LENGTH,
    SESSION_TITLE_TRUNCATED_LENGTH,
    MAX_PERSISTED_SESSION_ATTACHMENTS,
    MAX_PERSISTED_SESSION_ATTACHMENT_BYTES,
    MAX_SESSION_ATTACHMENT_STORE_BYTES,
    MAX_HISTORY_MESSAGES,
    MAX_PERSISTED_VIDEO_CONTEXT_ITEMS,
    MAX_PERSISTED_VIDEO_FRAMES_PER_ITEM,
    GENERIC_SESSION_TITLES,
    SESSION_RUNTIME_STATES,
    SESSION_EXECUTION_STATES,
    USER_INPUT_UUID_RE,
    USER_INPUT_REQUEST_ID_RE,
    CHAT_SHELL_TOOL_PATTERNS,
    isNonEmptyString,
    toPositiveInt,
};
