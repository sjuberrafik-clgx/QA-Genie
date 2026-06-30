/**
 * Shared constants used across tool modules.
 * Extracted from custom-tools.js
 */
const path = require('path');

const VALID_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VALID_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']);
const COMMENT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const COMMENT_IMAGE_MIME_MAP = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};
const COMMENT_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const COMMENT_VIDEO_MIME_MAP = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
};
const JIRA_MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const JIRA_TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SAFE_COMMIT_ROOT_PREFIXES = [
    '.github/skills/',
    'agentic-workflow/sdk-orchestrator/',
    'agentic-workflow/config/',
    'agentic-workflow/docs/',
    'agentic-workflow/utils/',
    'web-app/',
];
const SAFE_COMMIT_ROOT_FILES = new Set([
    'README.md',
    'package.json',
    'package-lock.json',
    'playwright.config.js',
    '.gitignore',
    '.github/copilot-instructions.md',
]);
const SAFE_COMMIT_EXCLUDED_PREFIXES = [
    'tests/',
    'test-artifacts/',
    'test-results/',
    'playwright-report/',
    'agentic-workflow/test-artifacts/',
    'agentic-workflow/test-results/',
    'agentic-workflow/exploration-data/',
    'agentic-workflow/test-cases/',
    'agentic-workflow/grounding-data/',
    'agentic-workflow/knowledge-base-data/',
    'agentic-workflow/learning-data/',
    'agentic-workflow/ccm-data/',
    'web-app/playwright-report/',
    'web-app/test-results/',
    'web-app/Users/',
];
const SAFE_COMMIT_EXCLUDED_EXTENSIONS = new Set(['.log', '.pptx', '.docx', '.pdf', '.xls', '.xlsx', '.webm', '.mp4']);

module.exports = {
    VALID_IMAGE_MIME_TYPES,
    VALID_VIDEO_MIME_TYPES,
    COMMENT_IMAGE_EXTENSIONS,
    COMMENT_IMAGE_MIME_MAP,
    COMMENT_VIDEO_EXTENSIONS,
    COMMENT_VIDEO_MIME_MAP,
    JIRA_MAX_ATTACHMENT_SIZE,
    JIRA_TICKET_KEY_PATTERN,
    PROJECT_ROOT,
    SAFE_COMMIT_ROOT_PREFIXES,
    SAFE_COMMIT_ROOT_FILES,
    SAFE_COMMIT_EXCLUDED_PREFIXES,
    SAFE_COMMIT_EXCLUDED_EXTENSIONS,
};
