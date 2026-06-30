/**
 * Test execution helpers: Excel generation, Playwright binary resolution,
 * spec file discovery, npm script matching.
 * Extracted from custom-tools.js
 */
const path = require('path');
const fs = require('fs');

// ─── Helper: Create simple Excel file ───────────────────────────────────────
async function createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps) {
    try {
        // Try ExcelJS first (common dependency)
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Test Cases');

        // Header info
        sheet.addRow(['Ticket ID', ticketId]);
        sheet.addRow(['Test Suite', testSuiteName]);
        sheet.addRow(['Pre-Conditions', preConditions || '']);
        sheet.addRow([]);

        // Table header
        const headerRow = sheet.addRow(['Test Step ID', 'Specific Activity or Action', 'Expected Results', 'Actual Results']);
        headerRow.font = { bold: true };

        // Data rows
        for (const step of steps) {
            sheet.addRow([
                step.stepId || step.id || '',
                step.action || step.specificActivity || '',
                step.expected || step.expectedResults || '',
                step.actual || step.actualResults || '',
            ]);
        }

        // Auto-width columns
        sheet.columns.forEach(col => {
            let maxLen = 10;
            col.eachCell(cell => {
                const len = cell.value ? String(cell.value).length : 0;
                if (len > maxLen) maxLen = Math.min(len, 80);
            });
            col.width = maxLen + 2;
        });

        await workbook.xlsx.writeFile(outputPath);
    } catch {
        // ExcelJS not available — write as tab-separated text with .xlsx extension
        const lines = [
            `Ticket ID\t${ticketId}`,
            `Test Suite\t${testSuiteName}`,
            `Pre-Conditions\t${preConditions || ''}`,
            '',
            'Test Step ID\tSpecific Activity or Action\tExpected Results\tActual Results',
            ...steps.map(s =>
                `${s.stepId || s.id || ''}\t${s.action || s.specificActivity || ''}\t${s.expected || s.expectedResults || ''}\t${s.actual || s.actualResults || ''}`
            ),
        ];
        fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    }
}

function _relativePathIfInside(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    if (!relative) {
        return '.';
    }

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }

    return relative.replace(/\\/g, '/');
}

function _findPlaywrightProjectRoot(candidatePath) {
    if (!candidatePath || !fs.existsSync(candidatePath)) return null;

    let currentPath;
    try {
        const stats = fs.statSync(candidatePath);
        currentPath = stats.isDirectory() ? candidatePath : path.dirname(candidatePath);
    } catch {
        return null;
    }

    const configFiles = [
        'playwright.config.js',
        'playwright.config.ts',
        'playwright.config.mjs',
        'playwright.config.cjs',
    ];

    let packageJsonFallback = null;

    while (true) {
        const hasPlaywrightConfig = configFiles.some(fileName =>
            fs.existsSync(path.join(currentPath, fileName))
        );
        if (hasPlaywrightConfig) {
            return currentPath;
        }

        if (!packageJsonFallback && fs.existsSync(path.join(currentPath, 'package.json'))) {
            packageJsonFallback = currentPath;
        }

        const parent = path.dirname(currentPath);
        if (parent === currentPath) {
            break;
        }

        currentPath = parent;
    }

    return packageJsonFallback;
}

// ─── Helper: Save raw test report for Reports dashboard ─────────────────────
function _saveTestReport(ticketId, runId, specPath, playwrightResult) {
    try {
        const reportsDir = path.join(__dirname, '..', 'test-artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const fileName = `${ticketId}-${runId}-test-results.json`;
        const filePath = path.join(reportsDir, fileName);
        const payload = {
            ticketId,
            runId,
            mode: 'chat',
            specPath: specPath || null,
            timestamp: new Date().toISOString(),
            playwrightResult,
        };
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');

        // ── Emit REPORT_SAVED event for real-time dashboard updates ──
        try {
            const { getEventBridge, EVENT_TYPES } = require('./event-bridge');
            const eventBridge = getEventBridge();
            eventBridge.push(EVENT_TYPES.REPORT_SAVED, runId, {
                ticketId,
                fileName,
                filePath,
                timestamp: payload.timestamp,
            });
        } catch { /* EventBridge not available — non-critical */ }

        return filePath;
    } catch {
        return null;
    }
}

// ─── Helper: Resolve outside-workspace path to local specs by basename ──────
function _resolveWorkspaceSpecTarget(projectRoot, candidatePath, preferDirectory = false) {
    const searchName = path.basename(candidatePath || '').toLowerCase();
    if (!searchName) return null;

    const searchDirs = [
        path.join(projectRoot, 'tests', 'specs'),
        path.join(projectRoot, 'tests-scratch', 'specs'),
    ];
    const folderMatches = [];
    const fileMatches = [];

    function searchRecursive(dir, depth = 0) {
        if (depth > 5 || !fs.existsSync(dir)) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const entryPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name.toLowerCase() === searchName) {
                        const specCount = _countSpecFiles(entryPath);
                        if (specCount > 0) {
                            folderMatches.push({ path: entryPath, specCount });
                        }
                    }
                    searchRecursive(entryPath, depth + 1);
                } else if (entry.isFile() && entry.name.toLowerCase() === searchName && entry.name.endsWith('.spec.js')) {
                    fileMatches.push(entryPath);
                }
            }
        } catch {
            // ignore unreadable folders
        }
    }

    for (const dir of searchDirs) {
        searchRecursive(dir);
    }

    if (preferDirectory) {
        if (folderMatches.length === 1) return folderMatches[0].path;
        if (folderMatches.length === 0 && fileMatches.length === 1) return fileMatches[0];
        return null;
    }

    if (fileMatches.length === 1) return fileMatches[0];
    if (fileMatches.length === 0 && folderMatches.length === 1) return folderMatches[0].path;
    return null;
}

// ─── Helper: Count .spec.js files inside a directory ─────────────────────────
function _countSpecFiles(dir) {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.spec.js')) count++;
            else if (entry.isDirectory()) count += _countSpecFiles(path.join(dir, entry.name));
        }
    } catch { /* ignore */ }
    return count;
}

// ─── Helper: Detect a locally-installed Playwright CLI in an exec root ──────
// Returns { command, args } for the most reliable way to invoke Playwright,
// or null if Playwright isn't installed locally (caller should fall back to npx).
function _resolveLocalPlaywrightBinary(executionRoot) {
    if (!executionRoot) return null;
    const binDir = path.join(executionRoot, 'node_modules', '.bin');
    const candidates = process.platform === 'win32'
        ? ['playwright.cmd', 'playwright.CMD', 'playwright']
        : ['playwright'];
    for (const name of candidates) {
        const full = path.join(binDir, name);
        try {
            if (fs.existsSync(full)) {
                return { command: full, args: [] };
            }
        } catch { /* ignore */ }
    }
    return null;
}

// ─── Helper: Find a matching npm script for a spec path ─────────────────────
// When a user runs a suite like `tests/specs/consumer`, external projects
// often define a tailored script (e.g., `"consumer": "playwright test ..."`) that
// carries the right config, workers, and retries. Prefer that over raw
// `npx playwright test <path>` when an unambiguous match exists.
function _findMatchingNpmScript(executionRoot, resolvedSpec, isDirectory) {
    if (!executionRoot || !resolvedSpec) return null;
    const pkgPath = path.join(executionRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
        return null;
    }
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : null;
    if (!scripts) return null;

    // Only auto-match for directory targets — for single spec files the user's
    // intent is unambiguous and a script could run a broader scope than requested.
    if (!isDirectory) return null;

    const specBase = path.basename(resolvedSpec).toLowerCase();
    if (!specBase) return null;

    // Candidate script name patterns, in priority order.
    const candidatePatterns = [
        specBase,
        `test:${specBase}`,
        `${specBase}:test`,
        `e2e:${specBase}`,
        `test-${specBase}`,
        `${specBase}-test`,
    ];

    const normalizedSpec = resolvedSpec.replace(/\\/g, '/').toLowerCase();

    for (const candidate of candidatePatterns) {
        const scriptBody = scripts[candidate];
        if (!scriptBody || typeof scriptBody !== 'string') continue;
        const bodyLower = scriptBody.toLowerCase();
        // Must be a Playwright invocation AND mention the target dir (basename at minimum)
        // to avoid hijacking an unrelated script that happens to share the name.
        if (!/playwright(\s|$)/.test(bodyLower) && !bodyLower.includes('playwright test')) continue;
        const refsPath = bodyLower.includes(specBase) || bodyLower.includes(normalizedSpec);
        if (!refsPath) continue;
        return { scriptName: candidate, scriptBody };
    }
    return null;
}

/**
 * Split a shell command string into [command, ...args], respecting quotes.
 * Simple implementation for common cases — not a full POSIX shell parser.
 */
function _shellSplit(commandStr) {
    const parts = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escape = false;

    for (let i = 0; i < commandStr.length; i++) {
        const ch = commandStr[i];

        if (escape) {
            current += ch;
            escape = false;
            continue;
        }
        if (ch === '\\' && !inSingle) {
            escape = true;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
            if (current.length > 0) {
                parts.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current.length > 0) parts.push(current);
    return parts.length > 0 ? parts : [commandStr];
}


module.exports = {
    _relativePathIfInside,
    _findPlaywrightProjectRoot,
    _saveTestReport,
    _resolveWorkspaceSpecTarget,
    _countSpecFiles,
    _resolveLocalPlaywrightBinary,
    _findMatchingNpmScript,
    _shellSplit,
};
