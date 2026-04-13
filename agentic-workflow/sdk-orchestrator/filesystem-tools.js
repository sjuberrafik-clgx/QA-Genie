/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILESYSTEM TOOLS — Local File/Folder/Document Interaction for FileGenie
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides sandboxed filesystem and document parsing tools for the FileGenie
 * agent. All paths are resolved relative to a per-session workspace root
 * that the user must set before any operations.
 *
 * Security:
 *   - Path traversal prevention (resolves + startsWith check after realpathSync)
 *   - Blocked system directories (Windows + Unix)
 *   - File size limits (configurable)
 *   - Destructive operations require user confirmation via onUserInputRequest
 *
 * @module filesystem-tools
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const rename = promisify(fs.rename);
const copyFile = promisify(fs.copyFile);
const rm = promisify(fs.rm);
const realpath = promisify(fs.realpath);

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_READ_SIZE = 10 * 1024 * 1024;   // 10 MB for text reads
const MAX_PARSE_SIZE = 50 * 1024 * 1024;   // 50 MB for document parsing
const MAX_LIST_DEPTH = 10;
const MAX_LIST_ENTRIES = 2000;
const MAX_SEARCH_RESULTS = 100;

/** System directories that must never be accessed */
const BLOCKED_PATHS_WIN = [
    'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
    'c:\\programdata', 'c:\\$recycle.bin', 'c:\\system volume information',
];
const BLOCKED_PATHS_UNIX = [
    '/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var/run',
];
const BLOCKED_PATHS = process.platform === 'win32' ? BLOCKED_PATHS_WIN : BLOCKED_PATHS_UNIX;

// ─── Per-Session Workspace Root Store ───────────────────────────────────────

/** Maps sessionId → { root: string, confirmed: boolean } */
const _sessionRoots = new Map();

function setSessionRoot(sessionId, rootPath) {
    _sessionRoots.set(sessionId, { root: rootPath, confirmed: true });
}

function getSessionRoot(sessionId) {
    return _sessionRoots.get(sessionId)?.root || null;
}

function clearSessionRoot(sessionId) {
    _sessionRoots.delete(sessionId);
}

// ─── Sandbox Security ───────────────────────────────────────────────────────

/**
 * Resolve a user-supplied path within the sandbox root.
 * Throws if the path escapes the sandbox or is in a blocked directory.
 *
 * @param {string} sessionId
 * @param {string} userPath  - Relative or absolute path from the user
 * @returns {string} Resolved absolute path guaranteed inside sandbox
 */
function resolveSandboxed(sessionId, userPath) {
    const root = getSessionRoot(sessionId);
    if (!root) {
        throw new Error('No workspace root set. Call set_workspace_root first.');
    }

    // Resolve relative to sandbox root
    const resolved = path.resolve(root, userPath);

    // Normalize for comparison (lowercase on Windows)
    const normalizedResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;

    // Path traversal check
    if (!normalizedResolved.startsWith(normalizedRoot)) {
        throw new Error(`Access denied: path "${userPath}" is outside the workspace root.`);
    }

    // Blocked directory check
    for (const blocked of BLOCKED_PATHS) {
        if (normalizedResolved.startsWith(blocked)) {
            throw new Error(`Access denied: "${userPath}" is in a protected system directory.`);
        }
    }

    return resolved;
}

/**
 * Same as resolveSandboxed but additionally resolves symlinks to ensure
 * the real target is still within the sandbox.
 */
async function resolveSandboxedReal(sessionId, userPath) {
    const resolved = resolveSandboxed(sessionId, userPath);

    // Also check real path (after symlink resolution) if the path exists
    if (fs.existsSync(resolved)) {
        const real = await realpath(resolved);
        const root = getSessionRoot(sessionId);
        const normalizedReal = process.platform === 'win32' ? real.toLowerCase() : real;
        const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;

        if (!normalizedReal.startsWith(normalizedRoot)) {
            throw new Error(`Access denied: "${userPath}" is a symlink pointing outside the workspace.`);
        }

        for (const blocked of BLOCKED_PATHS) {
            if (normalizedReal.startsWith(blocked)) {
                throw new Error(`Access denied: symlink target is in a protected system directory.`);
            }
        }
        return real;
    }

    return resolved;
}

/**
 * Recursively search the workspace root for files matching a given filename.
 * Used as an auto-search fallback when open_file_native / open_containing_folder
 * can't find a file at the user-supplied path.
 *
 * @param {string} root - Absolute workspace root path
 * @param {string} filename - The basename to search for (e.g., "report.pptx")
 * @param {number} [limit=10] - Max results to return
 * @returns {Promise<string[]>} Array of absolute paths that match
 */
async function findFileInWorkspace(root, filename, limit = 10) {
    const results = [];
    const cmpName = process.platform === 'win32' ? filename.toLowerCase() : filename;

    async function walk(dir) {
        if (results.length >= limit) return;
        let items;
        try {
            items = await readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const item of items) {
            if (results.length >= limit) break;
            if (item.name === 'node_modules' || item.name === '.git' || item.name.startsWith('.')) continue;

            const full = path.join(dir, item.name);
            if (item.isDirectory()) {
                await walk(full);
            } else {
                const itemName = process.platform === 'win32' ? item.name.toLowerCase() : item.name;
                if (itemName === cmpName) {
                    results.push(full);
                }
            }
        }
    }

    await walk(root);
    return results;
}

// ─── Confirmation for Destructive Ops ───────────────────────────────────────

/**
 * Request user confirmation through the existing onUserInputRequest mechanism.
 * The agent's SDK session will pause until the user approves or rejects.
 *
 * @param {Object} deps - Tool dependencies (must include chatManager)
 * @param {string} sessionId
 * @param {string} description - Human-readable description of what will happen
 * @returns {Promise<boolean>} true if approved
 */
async function requestConfirmation(deps, sessionId, description) {
    if (!deps?.chatManager?.requestUserInput) {
        // If chat manager not available, default to allowed (pipeline mode)
        console.warn('[FileGenie] No chatManager for confirmation — auto-approving');
        return true;
    }

    const response = await deps.chatManager.requestUserInput(
        `⚠️ **FileGenie wants to perform a destructive operation:**\n\n${description}\n\nDo you approve?`,
        ['Yes, proceed', 'No, cancel'],
        { type: 'confirmation', sessionId }
    );

    const answer = typeof response === 'string' ? response : response?.answer;

    const approved = typeof answer === 'string' && (
        answer.toLowerCase().includes('yes') ||
        answer.toLowerCase().includes('proceed') ||
        answer.toLowerCase().includes('approve')
    );

    return approved;
}

// ─── Helper Utilities ───────────────────────────────────────────────────────

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getActiveSessionId(deps) {
    return deps?.getSessionId?.() || deps?.sessionContext?.sessionId || deps?.sessionId || 'default';
}

function getExtension(filePath) {
    return path.extname(filePath).toLowerCase();
}

function getMimeType(filePath) {
    const ext = getExtension(filePath);
    const mimeMap = {
        '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
        '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python',
        '.html': 'text/html', '.css': 'text/css', '.xml': 'text/xml',
        '.csv': 'text/csv', '.yaml': 'text/yaml', '.yml': 'text/yaml',
        '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.zip': 'application/zip', '.tar': 'application/x-tar',
    };
    return mimeMap[ext] || 'application/octet-stream';
}

/** Check if a file extension is typically text-readable */
function isTextFile(filePath) {
    const textExts = new Set([
        '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.java',
        '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.swift', '.kt', '.scala',
        '.html', '.htm', '.css', '.scss', '.less', '.xml', '.svg', '.csv', '.tsv',
        '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bash',
        '.bat', '.cmd', '.ps1', '.sql', '.graphql', '.proto', '.makefile', '.dockerfile',
        '.gitignore', '.gitattributes', '.editorconfig', '.eslintrc', '.prettierrc',
        '.log', '.spec.js', '.test.js', '.spec.ts', '.test.ts',
    ]);
    const ext = getExtension(filePath);
    const name = path.basename(filePath).toLowerCase();
    return textExts.has(ext) || ['makefile', 'dockerfile', 'readme', 'license', 'changelog'].includes(name);
}

// ─── Directory Listing Helper ───────────────────────────────────────────────

async function listDirectoryRecursive(dirPath, depth, maxDepth, entries, root) {
    if (depth > maxDepth || entries.length >= MAX_LIST_ENTRIES) return;

    let items;
    try {
        items = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
        entries.push({ path: path.relative(root, dirPath), error: err.message });
        return;
    }

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    for (const item of items) {
        if (entries.length >= MAX_LIST_ENTRIES) break;

        // Skip hidden/system entries
        if (item.name.startsWith('.') && depth > 0) continue;
        if (item.name === 'node_modules' || item.name === '__pycache__') continue;

        const fullPath = path.join(dirPath, item.name);
        const relativePath = path.relative(root, fullPath);

        if (item.isDirectory()) {
            entries.push({
                name: item.name,
                path: relativePath,
                type: 'directory',
            });
            if (depth < maxDepth) {
                await listDirectoryRecursive(fullPath, depth + 1, maxDepth, entries, root);
            }
        } else {
            try {
                const fstat = await stat(fullPath);
                entries.push({
                    name: item.name,
                    path: relativePath,
                    type: 'file',
                    size: fstat.size,
                    sizeFormatted: formatSize(fstat.size),
                    modified: fstat.mtime.toISOString(),
                    extension: getExtension(item.name),
                });
            } catch {
                entries.push({
                    name: item.name,
                    path: relativePath,
                    type: 'file',
                    error: 'Could not read file metadata',
                });
            }
        }
    }
}

// ─── Document Parsers ───────────────────────────────────────────────────────

/**
 * Parse a PDF file and extract text content.
 */
async function parsePdf(filePath, options = {}) {
    const pdfParse = require('pdf-parse');
    const buffer = await readFile(filePath);
    if (buffer.length > MAX_PARSE_SIZE) {
        throw new Error(`PDF too large: ${formatSize(buffer.length)} (max: ${formatSize(MAX_PARSE_SIZE)})`);
    }

    const data = await pdfParse(buffer);
    let text = data.text || '';

    if (options.maxChars && text.length > options.maxChars) {
        text = text.substring(0, options.maxChars) + `\n\n[...truncated at ${options.maxChars} characters. Total: ${data.text.length} characters]`;
    }

    return {
        type: 'pdf',
        text,
        pageCount: data.numpages,
        metadata: data.info || {},
        charCount: data.text.length,
    };
}

/**
 * Parse a Word document (.docx) and extract text.
 */
async function parseDocx(filePath, options = {}) {
    const mammoth = require('mammoth');
    const buffer = await readFile(filePath);
    if (buffer.length > MAX_PARSE_SIZE) {
        throw new Error(`DOCX too large: ${formatSize(buffer.length)} (max: ${formatSize(MAX_PARSE_SIZE)})`);
    }

    const result = await mammoth.extractRawText({ buffer });
    let text = result.value || '';

    if (options.maxChars && text.length > options.maxChars) {
        text = text.substring(0, options.maxChars) + `\n\n[...truncated at ${options.maxChars} characters]`;
    }

    return {
        type: 'docx',
        text,
        charCount: result.value.length,
        warnings: result.messages.filter(m => m.type === 'warning').map(m => m.message),
    };
}

/**
 * Parse a PowerPoint file (.pptx) and extract text from all slides.
 * PPTX files are ZIP archives containing XML. We extract text from slide XML
 * without depending on fragile PPTX parsing libraries.
 */
async function parsePptx(filePath, options = {}) {
    const { createReadStream } = require('fs');
    const unzipper = require('unzipper');

    const buffer = await readFile(filePath);
    if (buffer.length > MAX_PARSE_SIZE) {
        throw new Error(`PPTX too large: ${formatSize(buffer.length)} (max: ${formatSize(MAX_PARSE_SIZE)})`);
    }

    // Fallback: basic ZIP-based XML text extraction
    const slides = [];
    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        // Sort slide entries numerically (slide1.xml, slide2.xml, ...)
        const slideEntries = entries
            .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
            .sort((a, b) => {
                const numA = parseInt(a.entryName.match(/slide(\d+)/)[1]);
                const numB = parseInt(b.entryName.match(/slide(\d+)/)[1]);
                return numA - numB;
            });

        for (const entry of slideEntries) {
            const xml = entry.getData().toString('utf8');
            // Extract text from <a:t> tags (PowerPoint text elements)
            const textParts = [];
            const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            let match;
            while ((match = regex.exec(xml)) !== null) {
                if (match[1].trim()) textParts.push(match[1]);
            }
            slides.push({
                slideNumber: slides.length + 1,
                text: textParts.join(' '),
            });
        }
    } catch (zipError) {
        throw new Error(`Failed to parse PPTX: ${zipError.message}. Install adm-zip: npm install adm-zip`);
    }

    let fullText = slides.map(s => `--- Slide ${s.slideNumber} ---\n${s.text}`).join('\n\n');
    if (options.maxChars && fullText.length > options.maxChars) {
        fullText = fullText.substring(0, options.maxChars) + `\n\n[...truncated at ${options.maxChars} characters]`;
    }

    return {
        type: 'pptx',
        text: fullText,
        slideCount: slides.length,
        slides,
        charCount: fullText.length,
    };
}

/**
 * Parse an Excel file (.xlsx) and extract data.
 */
async function parseXlsx(filePath, options = {}) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = [];
    for (const worksheet of workbook.worksheets) {
        if (options.sheets && !options.sheets.includes(worksheet.name)) continue;

        const rows = [];
        let rowCount = 0;
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (options.maxRows && rowCount >= options.maxRows) return;
            rows.push({
                row: rowNumber,
                values: row.values.slice(1).map(v => {
                    if (v === null || v === undefined) return '';
                    if (typeof v === 'object' && v.text) return v.text;
                    if (typeof v === 'object' && v.result !== undefined) return v.result;
                    return String(v);
                }),
            });
            rowCount++;
        });

        sheets.push({
            name: worksheet.name,
            rowCount: worksheet.rowCount,
            columnCount: worksheet.columnCount,
            data: rows,
        });
    }

    return {
        type: 'xlsx',
        sheetCount: sheets.length,
        sheets,
    };
}

/**
 * Auto-detect document type and parse.
 */
async function parseDocument(filePath, options = {}) {
    const ext = getExtension(filePath);
    switch (ext) {
        case '.pdf': return parsePdf(filePath, options);
        case '.docx': case '.doc': return parseDocx(filePath, options);
        case '.pptx': case '.ppt': return parsePptx(filePath, options);
        case '.xlsx': case '.xls': return parseXlsx(filePath, options);
        case '.csv': {
            const text = await readFile(filePath, 'utf8');
            return { type: 'csv', text: options.maxChars ? text.substring(0, options.maxChars) : text, charCount: text.length };
        }
        case '.json': {
            const text = await readFile(filePath, 'utf8');
            return { type: 'json', text: options.maxChars ? text.substring(0, options.maxChars) : text, charCount: text.length };
        }
        case '.md': case '.txt': {
            const text = await readFile(filePath, 'utf8');
            return { type: ext.replace('.', ''), text: options.maxChars ? text.substring(0, options.maxChars) : text, charCount: text.length };
        }
        default:
            throw new Error(`Unsupported document type: ${ext}. Supported: .pdf, .docx, .pptx, .xlsx, .csv, .json, .md, .txt`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create all filesystem tools for the FileGenie agent.
 *
 * @param {Function} defineTool  - Copilot SDK defineTool function
 * @param {Object}   deps        - { chatManager, sessionId }
 * @param {Object}   [options]   - { readOnly: true } for TPM subset
 * @returns {Array} Array of tool definitions
 */
function createFilesystemTools(defineTool, deps = {}, options = {}) {
    const tools = [];
    const readOnly = options.readOnly || false;

    // ───────────────────────────────────────────────────────────────────
    // TOOL: set_workspace_root
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('set_workspace_root', {
        description:
            'Set the workspace root directory for this session. All file operations will be ' +
            'sandboxed to this directory. Must be called before any other filesystem tool. ' +
            'The path must be an existing directory on the local machine.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute path to the root directory (e.g., "C:\\\\Users\\\\me\\\\Documents" or "/home/user/project")',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath }) => {
            try {
                const resolved = path.resolve(userPath);

                // Check blocked paths
                const normalizedResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
                for (const blocked of BLOCKED_PATHS) {
                    if (normalizedResolved.startsWith(blocked) || normalizedResolved === blocked) {
                        return JSON.stringify({ success: false, error: `Cannot use system directory: ${resolved}` });
                    }
                }

                // Check if directory exists
                if (!fs.existsSync(resolved)) {
                    return JSON.stringify({ success: false, error: `Directory does not exist: ${resolved}` });
                }
                const stats = await stat(resolved);
                if (!stats.isDirectory()) {
                    return JSON.stringify({ success: false, error: `Path is not a directory: ${resolved}` });
                }

                // Derive sessionId from deps or use a default
                const sessionId = getActiveSessionId(deps);
                setSessionRoot(sessionId, resolved);

                // Quick stats about the directory
                const items = await readdir(resolved);
                const fileCount = items.filter(i => {
                    try { return fs.statSync(path.join(resolved, i)).isFile(); } catch { return false; }
                }).length;
                const dirCount = items.filter(i => {
                    try { return fs.statSync(path.join(resolved, i)).isDirectory(); } catch { return false; }
                }).length;

                return JSON.stringify({
                    success: true,
                    root: resolved,
                    itemCount: items.length,
                    files: fileCount,
                    directories: dirCount,
                    message: `Workspace root set to: ${resolved} (${fileCount} files, ${dirCount} folders)`,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: list_directory
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('list_directory', {
        description:
            'List files and folders in a directory within the workspace. ' +
            'Returns names, sizes, modification dates, and types. ' +
            'Use recursive mode to see the full tree structure.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Directory path relative to workspace root (default: "." for root)',
                },
                recursive: {
                    type: 'boolean',
                    description: 'If true, list contents recursively (default: false)',
                },
                maxDepth: {
                    type: 'number',
                    description: 'Maximum recursion depth (default: 3, max: 10)',
                },
            },
            required: [],
        },
        handler: async ({ path: userPath = '.', recursive = false, maxDepth = 3 }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);
                const root = getSessionRoot(sessionId);

                const stats = await stat(resolved);
                if (!stats.isDirectory()) {
                    return JSON.stringify({ success: false, error: 'Path is not a directory' });
                }

                const entries = [];
                const depth = recursive ? Math.min(maxDepth, MAX_LIST_DEPTH) : 0;
                await listDirectoryRecursive(resolved, 0, depth, entries, root);

                return JSON.stringify({
                    success: true,
                    directory: path.relative(root, resolved) || '.',
                    entryCount: entries.length,
                    entries,
                    truncated: entries.length >= MAX_LIST_ENTRIES,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: read_file_content
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('read_file_content', {
        description:
            'Read the text contents of a file within the workspace. ' +
            'Supports text files (code, markdown, JSON, CSV, config files, etc.). ' +
            'Use startLine/endLine for large files. Max file size: 10 MB.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root',
                },
                startLine: {
                    type: 'number',
                    description: 'Start reading from this line number (1-based, optional)',
                },
                endLine: {
                    type: 'number',
                    description: 'Read up to this line number (1-based, inclusive, optional)',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath, startLine, endLine }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);

                const stats = await stat(resolved);
                if (stats.isDirectory()) {
                    return JSON.stringify({ success: false, error: 'Path is a directory, not a file. Use list_directory instead.' });
                }
                if (stats.size > MAX_READ_SIZE) {
                    return JSON.stringify({ success: false, error: `File too large: ${formatSize(stats.size)}. Max: ${formatSize(MAX_READ_SIZE)}` });
                }

                if (!isTextFile(resolved)) {
                    return JSON.stringify({
                        success: false,
                        error: `"${path.basename(resolved)}" does not appear to be a text file. Use parse_document for PDF/DOCX/PPTX/XLSX.`,
                    });
                }

                let content = await readFile(resolved, 'utf8');

                if (startLine || endLine) {
                    const lines = content.split('\n');
                    const start = Math.max(1, startLine || 1) - 1;
                    const end = Math.min(lines.length, endLine || lines.length);
                    content = lines.slice(start, end).join('\n');
                    return JSON.stringify({
                        success: true,
                        path: userPath,
                        content,
                        lineRange: { start: start + 1, end, total: lines.length },
                    });
                }

                return JSON.stringify({
                    success: true,
                    path: userPath,
                    content,
                    size: stats.size,
                    sizeFormatted: formatSize(stats.size),
                    lineCount: content.split('\n').length,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: get_file_info
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('get_file_info', {
        description:
            'Get detailed metadata about a file: size, created/modified dates, ' +
            'extension, MIME type, and whether it is text-readable.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File or directory path relative to workspace root',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);
                const stats = await stat(resolved);

                return JSON.stringify({
                    success: true,
                    path: userPath,
                    name: path.basename(resolved),
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    sizeFormatted: formatSize(stats.size),
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    extension: stats.isFile() ? getExtension(resolved) : null,
                    mimeType: stats.isFile() ? getMimeType(resolved) : null,
                    isTextFile: stats.isFile() ? isTextFile(resolved) : false,
                    permissions: stats.mode.toString(8),
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: get_directory_stats
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('get_directory_stats', {
        description:
            'Get aggregate statistics about a directory: total files, total size, ' +
            'file type breakdown, largest files, and oldest/newest files. ' +
            'Useful for understanding what needs to be organized.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Directory path relative to workspace root (default: ".")',
                },
            },
            required: [],
        },
        handler: async ({ path: userPath = '.' }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);

                const typeBreakdown = {};
                const allFiles = [];
                let totalSize = 0;
                let dirCount = 0;

                async function scan(dir) {
                    const items = await readdir(dir, { withFileTypes: true });
                    for (const item of items) {
                        if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
                        const full = path.join(dir, item.name);
                        if (item.isDirectory()) {
                            dirCount++;
                            await scan(full);
                        } else {
                            try {
                                const fstat = await stat(full);
                                const ext = getExtension(item.name) || '(no extension)';
                                typeBreakdown[ext] = (typeBreakdown[ext] || 0) + 1;
                                totalSize += fstat.size;
                                allFiles.push({
                                    name: item.name,
                                    path: path.relative(resolved, full),
                                    size: fstat.size,
                                    modified: fstat.mtime,
                                });
                            } catch { /* skip inaccessible */ }
                        }
                    }
                }

                await scan(resolved);

                // Sort for top lists
                const largest = [...allFiles].sort((a, b) => b.size - a.size).slice(0, 10)
                    .map(f => ({ name: f.name, path: f.path, size: formatSize(f.size) }));
                const newest = [...allFiles].sort((a, b) => b.modified - a.modified).slice(0, 5)
                    .map(f => ({ name: f.name, path: f.path, modified: f.modified.toISOString() }));
                const oldest = [...allFiles].sort((a, b) => a.modified - b.modified).slice(0, 5)
                    .map(f => ({ name: f.name, path: f.path, modified: f.modified.toISOString() }));

                // Sort type breakdown by count descending
                const sortedTypes = Object.entries(typeBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});

                return JSON.stringify({
                    success: true,
                    directory: userPath,
                    totalFiles: allFiles.length,
                    totalDirectories: dirCount,
                    totalSize: formatSize(totalSize),
                    totalSizeBytes: totalSize,
                    typeBreakdown: sortedTypes,
                    largestFiles: largest,
                    newestFiles: newest,
                    oldestFiles: oldest,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: search_files
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('search_files', {
        description:
            'Search for files by name pattern or content. Supports glob-like name matching ' +
            'and content text search within text files. Returns matching file paths with context.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query — file name pattern (e.g., "*.pdf", "report") or content text to search for',
                },
                path: {
                    type: 'string',
                    description: 'Directory to search within (relative to workspace root, default: ".")',
                },
                contentSearch: {
                    type: 'boolean',
                    description: 'If true, search within file contents instead of names (default: false)',
                },
                extensions: {
                    type: 'string',
                    description: 'Comma-separated list of extensions to filter (e.g., ".js,.ts,.md")',
                },
            },
            required: ['query'],
        },
        handler: async ({ query, path: userPath = '.', contentSearch = false, extensions }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);
                const root = getSessionRoot(sessionId);
                const results = [];

                const extFilter = extensions
                    ? new Set(extensions.split(',').map(e => e.trim().toLowerCase().replace(/^\.?/, '.')))
                    : null;

                // Build name pattern from query (simple glob support)
                const nameRegex = !contentSearch
                    ? new RegExp(query.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i')
                    : null;

                const contentRegex = contentSearch ? new RegExp(query, 'ig') : null;

                async function searchDir(dir) {
                    if (results.length >= MAX_SEARCH_RESULTS) return;
                    let items;
                    try {
                        items = await readdir(dir, { withFileTypes: true });
                    } catch { return; }

                    for (const item of items) {
                        if (results.length >= MAX_SEARCH_RESULTS) break;
                        if (item.name === 'node_modules' || item.name.startsWith('.')) continue;

                        const full = path.join(dir, item.name);

                        if (item.isDirectory()) {
                            // Check directory name for name search
                            if (!contentSearch && nameRegex.test(item.name)) {
                                results.push({ path: path.relative(root, full), type: 'directory', name: item.name });
                            }
                            await searchDir(full);
                        } else {
                            if (extFilter && !extFilter.has(getExtension(item.name))) continue;

                            if (!contentSearch) {
                                if (nameRegex.test(item.name)) {
                                    const fstat = await stat(full).catch(() => null);
                                    results.push({
                                        path: path.relative(root, full),
                                        type: 'file',
                                        name: item.name,
                                        size: fstat ? formatSize(fstat.size) : 'unknown',
                                    });
                                }
                            } else if (isTextFile(full)) {
                                try {
                                    const fstat = await stat(full);
                                    if (fstat.size > 5 * 1024 * 1024) continue; // Skip large files for content search
                                    const content = await readFile(full, 'utf8');
                                    const matches = content.match(contentRegex);
                                    if (matches) {
                                        // Find first match context
                                        const idx = content.toLowerCase().indexOf(query.toLowerCase());
                                        const contextStart = Math.max(0, idx - 50);
                                        const contextEnd = Math.min(content.length, idx + query.length + 50);
                                        const context = content.substring(contextStart, contextEnd);

                                        results.push({
                                            path: path.relative(root, full),
                                            type: 'file',
                                            name: item.name,
                                            matchCount: matches.length,
                                            context: (contextStart > 0 ? '...' : '') + context + (contextEnd < content.length ? '...' : ''),
                                        });
                                    }
                                } catch { /* skip unreadable */ }
                            }
                        }
                    }
                }

                await searchDir(resolved);

                return JSON.stringify({
                    success: true,
                    query,
                    searchType: contentSearch ? 'content' : 'name',
                    resultCount: results.length,
                    results,
                    truncated: results.length >= MAX_SEARCH_RESULTS,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: parse_document
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('parse_document', {
        description:
            'Parse and extract text/data from documents (PDF, Word, PowerPoint, Excel, CSV, JSON, Markdown, text). ' +
            'Auto-detects the file type by extension. Use this for summarization, content extraction, ' +
            'and document analysis tasks.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root',
                },
                maxChars: {
                    type: 'number',
                    description: 'Maximum characters to return (default: no limit, use for large files)',
                },
                sheets: {
                    type: 'string',
                    description: 'For Excel files: comma-separated sheet names to parse (default: all sheets)',
                },
                maxRows: {
                    type: 'number',
                    description: 'For Excel files: maximum rows per sheet (default: all rows)',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath, maxChars, sheets, maxRows }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);

                const options = {};
                if (maxChars) options.maxChars = maxChars;
                if (sheets) options.sheets = sheets.split(',').map(s => s.trim());
                if (maxRows) options.maxRows = maxRows;

                const result = await parseDocument(resolved, options);

                return JSON.stringify({
                    success: true,
                    path: userPath,
                    ...result,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL: get_document_summary
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('get_document_summary', {
        description:
            'Get a quick overview/summary of a document without reading the full content. ' +
            'Returns the first ~2000 characters plus structural metadata (page count, ' +
            'slide count, sheet names, headings, etc.).',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);
                const fstat = await stat(resolved);

                const result = await parseDocument(resolved, { maxChars: 2000 });

                return JSON.stringify({
                    success: true,
                    path: userPath,
                    fileName: path.basename(resolved),
                    fileSize: formatSize(fstat.size),
                    ...result,
                });
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ═══════════════════════════════════════════════════════════════════
    // WRITE TOOLS (only included when readOnly is false)
    // ═══════════════════════════════════════════════════════════════════

    if (!readOnly) {

        // ───────────────────────────────────────────────────────────────
        // TOOL: write_file_content
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('write_file_content', {
            description:
                'Create or overwrite a text file. This is a DESTRUCTIVE operation that ' +
                'will ask for user confirmation. The file is created if it does not exist. ' +
                'Parent directories are created automatically.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to workspace root',
                    },
                    content: {
                        type: 'string',
                        description: 'The text content to write to the file',
                    },
                },
                required: ['path', 'content'],
            },
            handler: async ({ path: userPath, content }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    const resolved = resolveSandboxed(sessionId, userPath);

                    const exists = fs.existsSync(resolved);
                    const action = exists ? 'overwrite' : 'create';
                    const sizeInfo = exists ? ` (current: ${formatSize(fs.statSync(resolved).size)})` : '';

                    const approved = await requestConfirmation(deps, sessionId,
                        `**${action.toUpperCase()}** file: \`${userPath}\`${sizeInfo}\n` +
                        `New content size: ${formatSize(Buffer.byteLength(content, 'utf8'))}`);

                    if (!approved) {
                        return JSON.stringify({ success: false, error: 'Operation cancelled by user.' });
                    }

                    // Create parent dirs if needed
                    const dir = path.dirname(resolved);
                    if (!fs.existsSync(dir)) {
                        await mkdir(dir, { recursive: true });
                    }

                    await writeFile(resolved, content, 'utf8');

                    return JSON.stringify({
                        success: true,
                        action,
                        path: userPath,
                        size: formatSize(Buffer.byteLength(content, 'utf8')),
                        message: `File ${action}d: ${userPath}`,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

        // ───────────────────────────────────────────────────────────────
        // TOOL: create_directory
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('create_directory', {
            description:
                'Create a new directory (and all parent directories if needed). ' +
                'This is safe — no confirmation required.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path relative to workspace root',
                    },
                },
                required: ['path'],
            },
            handler: async ({ path: userPath }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    const resolved = resolveSandboxed(sessionId, userPath);

                    if (fs.existsSync(resolved)) {
                        return JSON.stringify({ success: true, path: userPath, message: 'Directory already exists.', existed: true });
                    }

                    await mkdir(resolved, { recursive: true });

                    return JSON.stringify({
                        success: true,
                        path: userPath,
                        message: `Directory created: ${userPath}`,
                        existed: false,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

        // ───────────────────────────────────────────────────────────────
        // TOOL: move_items
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('move_items', {
            description:
                'Move one or more files/folders to a destination directory. ' +
                'This is a DESTRUCTIVE operation — user confirmation is required. ' +
                'The destination directory is created if it does not exist.',
            parameters: {
                type: 'object',
                properties: {
                    sources: {
                        type: 'string',
                        description: 'JSON array of source paths relative to workspace root (e.g., \'["file1.txt", "docs/report.pdf"]\')',
                    },
                    destination: {
                        type: 'string',
                        description: 'Destination directory path relative to workspace root',
                    },
                },
                required: ['sources', 'destination'],
            },
            handler: async ({ sources: sourcesJson, destination }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    let sources;
                    try {
                        sources = JSON.parse(sourcesJson);
                    } catch {
                        // Try comma-separated fallback
                        sources = sourcesJson.split(',').map(s => s.trim());
                    }

                    if (!Array.isArray(sources) || sources.length === 0) {
                        return JSON.stringify({ success: false, error: 'sources must be a non-empty array' });
                    }

                    // Resolve all paths
                    const resolvedDest = resolveSandboxed(sessionId, destination);
                    const resolvedSources = sources.map(s => ({
                        original: s,
                        resolved: resolveSandboxed(sessionId, s),
                    }));

                    // Confirm
                    const description = `**MOVE** ${sources.length} item(s) to \`${destination}\`:\n` +
                        sources.map(s => `  - \`${s}\``).join('\n');
                    const approved = await requestConfirmation(deps, sessionId, description);
                    if (!approved) {
                        return JSON.stringify({ success: false, error: 'Operation cancelled by user.' });
                    }

                    // Create destination if needed
                    if (!fs.existsSync(resolvedDest)) {
                        await mkdir(resolvedDest, { recursive: true });
                    }

                    const results = [];
                    for (const src of resolvedSources) {
                        try {
                            const destPath = path.join(resolvedDest, path.basename(src.resolved));
                            await rename(src.resolved, destPath);
                            results.push({ source: src.original, status: 'moved' });
                        } catch (err) {
                            results.push({ source: src.original, status: 'failed', error: err.message });
                        }
                    }

                    const moved = results.filter(r => r.status === 'moved').length;
                    return JSON.stringify({
                        success: moved > 0,
                        movedCount: moved,
                        failedCount: results.length - moved,
                        destination,
                        results,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

        // ───────────────────────────────────────────────────────────────
        // TOOL: copy_items
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('copy_items', {
            description:
                'Copy one or more files to a destination directory. ' +
                'Creates the destination directory if needed.',
            parameters: {
                type: 'object',
                properties: {
                    sources: {
                        type: 'string',
                        description: 'JSON array of source file paths relative to workspace root',
                    },
                    destination: {
                        type: 'string',
                        description: 'Destination directory path relative to workspace root',
                    },
                },
                required: ['sources', 'destination'],
            },
            handler: async ({ sources: sourcesJson, destination }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    let sources;
                    try {
                        sources = JSON.parse(sourcesJson);
                    } catch {
                        sources = sourcesJson.split(',').map(s => s.trim());
                    }

                    const resolvedDest = resolveSandboxed(sessionId, destination);
                    if (!fs.existsSync(resolvedDest)) {
                        await mkdir(resolvedDest, { recursive: true });
                    }

                    const results = [];
                    for (const src of sources) {
                        try {
                            const resolvedSrc = await resolveSandboxedReal(sessionId, src);
                            const destPath = path.join(resolvedDest, path.basename(resolvedSrc));

                            const srcStat = await stat(resolvedSrc);
                            if (srcStat.isDirectory()) {
                                // Recursive directory copy
                                await copyDir(resolvedSrc, destPath);
                            } else {
                                await copyFile(resolvedSrc, destPath);
                            }
                            results.push({ source: src, status: 'copied' });
                        } catch (err) {
                            results.push({ source: src, status: 'failed', error: err.message });
                        }
                    }

                    const copied = results.filter(r => r.status === 'copied').length;
                    return JSON.stringify({
                        success: copied > 0,
                        copiedCount: copied,
                        failedCount: results.length - copied,
                        destination,
                        results,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

        // ───────────────────────────────────────────────────────────────
        // TOOL: rename_item
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('rename_item', {
            description:
                'Rename a file or folder. This is a DESTRUCTIVE operation — ' +
                'user confirmation is required.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Current path relative to workspace root',
                    },
                    newName: {
                        type: 'string',
                        description: 'New name for the file/folder (just the name, not a path)',
                    },
                },
                required: ['path', 'newName'],
            },
            handler: async ({ path: userPath, newName }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    const resolved = await resolveSandboxedReal(sessionId, userPath);

                    // Ensure newName doesn't contain path separators
                    if (newName.includes('/') || newName.includes('\\')) {
                        return JSON.stringify({ success: false, error: 'newName must be a name, not a path. Use move_items for moving.' });
                    }

                    const newPath = path.join(path.dirname(resolved), newName);
                    // Verify new path is still sandboxed
                    const root = getSessionRoot(sessionId);
                    const normalizedNew = process.platform === 'win32' ? newPath.toLowerCase() : newPath;
                    const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
                    if (!normalizedNew.startsWith(normalizedRoot)) {
                        return JSON.stringify({ success: false, error: 'Rename target would be outside workspace.' });
                    }

                    const approved = await requestConfirmation(deps, sessionId,
                        `**RENAME** \`${path.basename(resolved)}\` → \`${newName}\` in \`${path.relative(root, path.dirname(resolved)) || '.'}\``);
                    if (!approved) {
                        return JSON.stringify({ success: false, error: 'Operation cancelled by user.' });
                    }

                    await rename(resolved, newPath);

                    return JSON.stringify({
                        success: true,
                        oldName: path.basename(resolved),
                        newName,
                        directory: path.relative(root, path.dirname(resolved)) || '.',
                        message: `Renamed: ${path.basename(resolved)} → ${newName}`,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

        // ───────────────────────────────────────────────────────────────
        // TOOL: delete_items
        // ───────────────────────────────────────────────────────────────
        tools.push(defineTool('delete_items', {
            description:
                'Delete one or more files or folders. This is a DESTRUCTIVE and IRREVERSIBLE ' +
                'operation — user confirmation is required. Folders are deleted recursively.',
            parameters: {
                type: 'object',
                properties: {
                    paths: {
                        type: 'string',
                        description: 'JSON array of paths relative to workspace root to delete',
                    },
                },
                required: ['paths'],
            },
            handler: async ({ paths: pathsJson }) => {
                try {
                    const sessionId = getActiveSessionId(deps);
                    let paths;
                    try {
                        paths = JSON.parse(pathsJson);
                    } catch {
                        paths = pathsJson.split(',').map(s => s.trim());
                    }

                    if (!Array.isArray(paths) || paths.length === 0) {
                        return JSON.stringify({ success: false, error: 'paths must be a non-empty array' });
                    }

                    // Resolve all and check they exist
                    const items = [];
                    for (const p of paths) {
                        const resolved = await resolveSandboxedReal(sessionId, p);
                        const exists = fs.existsSync(resolved);
                        const fstat = exists ? await stat(resolved) : null;
                        items.push({
                            original: p,
                            resolved,
                            exists,
                            type: fstat?.isDirectory() ? 'directory' : 'file',
                            size: fstat ? formatSize(fstat.size) : 'N/A',
                        });
                    }

                    const existing = items.filter(i => i.exists);
                    if (existing.length === 0) {
                        return JSON.stringify({ success: false, error: 'None of the specified paths exist.' });
                    }

                    const description = `**DELETE** ${existing.length} item(s) (⚠️ IRREVERSIBLE):\n` +
                        existing.map(i => `  - \`${i.original}\` (${i.type}, ${i.size})`).join('\n');
                    const approved = await requestConfirmation(deps, sessionId, description);
                    if (!approved) {
                        return JSON.stringify({ success: false, error: 'Operation cancelled by user.' });
                    }

                    const results = [];
                    for (const item of existing) {
                        try {
                            await rm(item.resolved, { recursive: true, force: true });
                            results.push({ path: item.original, status: 'deleted' });
                        } catch (err) {
                            results.push({ path: item.original, status: 'failed', error: err.message });
                        }
                    }

                    const deleted = results.filter(r => r.status === 'deleted').length;
                    return JSON.stringify({
                        success: deleted > 0,
                        deletedCount: deleted,
                        failedCount: results.length - deleted,
                        results,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));

    } // end if (!readOnly)

    // ── Native File/Folder Opening (available in both read-only and full modes) ────

    /**
     * Map file extensions to friendly application names for user feedback.
     */
    const APP_NAME_MAP = {
        '.xlsx': 'Microsoft Excel', '.xls': 'Microsoft Excel', '.csv': 'Microsoft Excel',
        '.docx': 'Microsoft Word', '.doc': 'Microsoft Word',
        '.pptx': 'Microsoft PowerPoint', '.ppt': 'Microsoft PowerPoint',
        '.pdf': 'PDF Viewer',
        '.html': 'Default Browser', '.htm': 'Default Browser',
        '.png': 'Image Viewer', '.jpg': 'Image Viewer', '.jpeg': 'Image Viewer',
        '.gif': 'Image Viewer', '.webp': 'Image Viewer', '.svg': 'Image Viewer', '.bmp': 'Image Viewer',
        '.mp4': 'Video Player', '.mkv': 'Video Player', '.avi': 'Video Player',
        '.mov': 'Video Player', '.wmv': 'Video Player', '.webm': 'Video Player',
        '.mp3': 'Audio Player', '.wav': 'Audio Player', '.flac': 'Audio Player', '.aac': 'Audio Player',
        '.txt': 'Text Editor', '.md': 'Text Editor', '.log': 'Text Editor',
        '.json': 'Text Editor', '.xml': 'Text Editor', '.yaml': 'Text Editor', '.yml': 'Text Editor',
        '.js': 'Code Editor', '.ts': 'Code Editor', '.py': 'Code Editor', '.java': 'Code Editor',
        '.zip': 'Archive Manager', '.rar': 'Archive Manager', '.7z': 'Archive Manager', '.tar': 'Archive Manager',
    };

    // TOOL: open_file_native
    tools.push(defineTool('open_file_native', {
        description:
            'Open a file with its default native desktop application (e.g., Excel for .xlsx, ' +
            'Word for .docx, default browser for .html, video player for .mp4). ' +
            'Use this when the user asks to "open", "launch", "view in app", or "show" a file. ' +
            'The file must exist within the workspace root. If the file is not found at the given path, ' +
            'the tool automatically searches the entire workspace for a matching filename. ' +
            'The server calls the OS-native open command (start/open/xdg-open) — works because the server runs on the user\'s local machine.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root (e.g., "test-cases/AOTF-12345.xlsx")',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);

                // Verify it's a file — auto-search workspace if not found at given path
                let targetPath = resolved;
                let autoSearched = false;
                if (!fs.existsSync(targetPath)) {
                    const root = getSessionRoot(sessionId);
                    const basename = path.basename(userPath);
                    if (root && basename) {
                        const matches = await findFileInWorkspace(root, basename);
                        if (matches.length === 1) {
                            targetPath = matches[0];
                            autoSearched = true;
                        } else if (matches.length > 1) {
                            return JSON.stringify({
                                success: false,
                                error: `File not found at "${userPath}". Multiple matches found in workspace — please specify which one:`,
                                suggestions: matches.map(m => path.relative(root, m)),
                            });
                        }
                    }
                    if (!autoSearched) {
                        return JSON.stringify({ success: false, error: `File not found: ${userPath} (also searched entire workspace)` });
                    }
                }
                const fstat = await stat(targetPath);
                if (fstat.isDirectory()) {
                    return JSON.stringify({ success: false, error: `"${userPath}" is a directory. Use open_containing_folder instead.` });
                }

                const ext = path.extname(targetPath).toLowerCase();
                const appName = APP_NAME_MAP[ext] || 'Default Application';

                // Call the server API endpoint to do the actual OS open
                const http = require('http');
                const serverPort = process.env.PORT || 3001;
                const result = await new Promise((resolve, reject) => {
                    const postData = JSON.stringify({ path: targetPath });
                    const req = http.request({
                        hostname: '127.0.0.1',
                        port: serverPort,
                        path: '/api/filesystem/open-file',
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
                    }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                            catch { resolve({ status: res.statusCode, body: data }); }
                        });
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });

                if (result.status === 200 && result.body?.opened) {
                    const response = {
                        success: true,
                        message: `Opened "${path.basename(targetPath)}" in ${appName}`,
                        file: path.basename(targetPath),
                        extension: ext,
                        application: appName,
                        fullPath: targetPath,
                    };
                    if (autoSearched) {
                        const root = getSessionRoot(sessionId);
                        response.note = `File was not at "${userPath}" — found at "${path.relative(root, targetPath)}" (auto-searched workspace)`;
                    }
                    return JSON.stringify(response);
                } else {
                    return JSON.stringify({
                        success: false,
                        error: result.body?.error || `Server returned status ${result.status}`,
                    });
                }
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // TOOL: open_containing_folder
    tools.push(defineTool('open_containing_folder', {
        description:
            'Open the containing folder of a file (or a folder itself) in the native file explorer ' +
            '(Windows Explorer, macOS Finder, or Linux file manager). On Windows/macOS, when given ' +
            'a file path, the file will be highlighted/selected in the explorer. ' +
            'If the path is not found, the tool automatically searches the entire workspace for a matching filename. ' +
            'Use this when the user asks to "open folder", "reveal in explorer", "show in finder", ' +
            'or "go to folder".',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File or folder path relative to workspace root',
                },
            },
            required: ['path'],
        },
        handler: async ({ path: userPath }) => {
            try {
                const sessionId = getActiveSessionId(deps);
                const resolved = await resolveSandboxedReal(sessionId, userPath);

                // Auto-search workspace if not found at given path
                let targetPath = resolved;
                let autoSearched = false;
                if (!fs.existsSync(targetPath)) {
                    const root = getSessionRoot(sessionId);
                    const basename = path.basename(userPath);
                    if (root && basename) {
                        const matches = await findFileInWorkspace(root, basename);
                        if (matches.length === 1) {
                            targetPath = matches[0];
                            autoSearched = true;
                        } else if (matches.length > 1) {
                            return JSON.stringify({
                                success: false,
                                error: `Path not found at "${userPath}". Multiple matches found in workspace — please specify which one:`,
                                suggestions: matches.map(m => path.relative(root, m)),
                            });
                        }
                    }
                    if (!autoSearched) {
                        return JSON.stringify({ success: false, error: `Path not found: ${userPath} (also searched entire workspace)` });
                    }
                }

                const fstat = await stat(targetPath);
                const isFile = !fstat.isDirectory();

                const http = require('http');
                const serverPort = process.env.PORT || 3001;
                const result = await new Promise((resolve, reject) => {
                    const postData = JSON.stringify({ path: targetPath });
                    const req = http.request({
                        hostname: '127.0.0.1',
                        port: serverPort,
                        path: '/api/filesystem/open-folder',
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
                    }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                            catch { resolve({ status: res.statusCode, body: data }); }
                        });
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });

                if (result.status === 200 && result.body?.opened) {
                    const folderName = isFile ? path.basename(path.dirname(targetPath)) : path.basename(targetPath);
                    const response = {
                        success: true,
                        message: isFile
                            ? `Revealed "${path.basename(targetPath)}" in ${process.platform === 'darwin' ? 'Finder' : 'File Explorer'}`
                            : `Opened "${folderName}" in ${process.platform === 'darwin' ? 'Finder' : 'File Explorer'}`,
                        target: path.basename(targetPath),
                        folder: isFile ? path.dirname(targetPath) : targetPath,
                    };
                    if (autoSearched) {
                        const root = getSessionRoot(sessionId);
                        response.note = `Path was not at "${userPath}" — found at "${path.relative(root, targetPath)}" (auto-searched workspace)`;
                    }
                    return JSON.stringify(response);
                } else {
                    return JSON.stringify({
                        success: false,
                        error: result.body?.error || `Server returned status ${result.status}`,
                    });
                }
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    return tools;
}

// ─── Helper: recursive directory copy ───────────────────────────────────────

async function copyDir(src, dest) {
    await mkdir(dest, { recursive: true });
    const items = await readdir(src, { withFileTypes: true });
    for (const item of items) {
        const srcPath = path.join(src, item.name);
        const destPath = path.join(dest, item.name);
        if (item.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            await copyFile(srcPath, destPath);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    createFilesystemTools,
    setSessionRoot,
    getSessionRoot,
    clearSessionRoot,
    parseDocument,
    BLOCKED_PATHS,
};
