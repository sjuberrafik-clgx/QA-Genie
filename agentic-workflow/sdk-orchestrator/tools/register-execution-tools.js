/**
 * Execution tools: test case excel, find tests, execute test, run command
 * Extracted from custom-tools.js createCustomTools()
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { PROJECT_ROOT } = require('./constants');
/**
 * Register tools for this category.
 * @param {Array} tools - The tools array to push into
 * @param {Function} defineTool - SDK defineTool function
 * @param {string} agentName - Agent role
 * @param {Object} deps - Dependencies
 */
function register(tools, defineTool, agentName, deps) {
    const { learningStore, config, contextStore, groundingStore } = deps;
    const toolCache = require('./tool-cache').getToolCache();

    if (['testgenie'].includes(agentName)) {
        tools.push(defineTool('generate_test_case_excel', {
            description:
                'Generates a test case Excel file from structured test case data. ' +
                'Takes ticket ID, test suite name, pre-conditions, and an array of test steps, ' +
                'then creates an .xlsx file in agentic-workflow/test-cases/.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                    testSuiteName: {
                        type: 'string',
                        description: 'Name of the test suite (e.g., "Consumer - Travel Time Edit Dropdown")',
                    },
                    preConditions: {
                        type: 'string',
                        description: 'Pre-conditions text (e.g., "1: For Consumer: User is authenticated")',
                    },
                    testSteps: {
                        type: 'string',
                        description: 'JSON array string of test step objects with fields: stepId, action, expected, actual',
                    },
                },
                required: ['ticketId', 'testSuiteName', 'testSteps'],
            },
            handler: async ({ ticketId, testSuiteName, preConditions, testSteps }) => {
                try {
                    // Broadcast progress: parsing
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Parsing test case data for ${ticketId}...`, step: 1,
                        });
                    }
                    let steps;
                    try {
                        steps = JSON.parse(testSteps);
                    } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid testSteps JSON: ${e.message}` });
                    }

                    // Broadcast progress: generating
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Generating Excel workbook (${steps.length} steps)...`, step: 2,
                        });
                    }

                    // Try using the excel-template-generator script
                    const generatorPath = path.join(__dirname, '..', 'scripts', 'excel-template-generator.js');
                    if (fs.existsSync(generatorPath)) {
                        try {
                            const generator = require(generatorPath);
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) {
                                fs.mkdirSync(outputDir, { recursive: true });
                            }

                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);

                            // The generator exports generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath)
                            // where jiraInfo = { number, title, url } and testCases = [{ id, title, steps: [...] }]
                            if (typeof generator.generateTestCaseExcel === 'function') {
                                // Build the jiraInfo shape the generator expects
                                const jiraInfo = {
                                    number: ticketId,
                                    title: testSuiteName,
                                    url: `${(process.env.JIRA_BASE_URL || 'https://jira.atlassian.net/').replace(/\/+$/, '')}/browse/${ticketId}`,
                                };

                                // Convert flat steps array into the testCases shape the generator expects
                                // Input steps: [{ stepId, action, expected, actual }]
                                // Generator expects: [{ id, title, steps: [{ id, action, expected, actual }] }]
                                const testCases = [{
                                    id: 'TC-01',
                                    title: testSuiteName,
                                    steps: steps.map(s => ({
                                        id: s.stepId || s.id || '',
                                        action: s.action || s.activity || '',
                                        expected: s.expected || s.expectedResult || '',
                                        actual: s.actual || s.actualResults || s.actualResult || '',
                                    })),
                                }];

                                await generator.generateTestCaseExcel(
                                    jiraInfo,
                                    preConditions || '',
                                    testCases,
                                    outputPath,
                                );
                            } else if (typeof generator.generateExcel === 'function') {
                                // Legacy fallback if export name changes back
                                await generator.generateExcel({
                                    ticketId,
                                    testSuiteName,
                                    preConditions: preConditions || '',
                                    testSteps: steps,
                                    outputPath,
                                });
                            } else {
                                // Generator module has unexpected export — create simple Excel via fallback
                                await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            }

                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel file created: ${path.basename(outputPath)}`,
                            });
                        } catch (genError) {
                            // Fall back to simple Excel creation
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                            await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel created (fallback): ${path.basename(outputPath)}`,
                                warning: `Generator error: ${genError.message}`,
                            });
                        }
                    }

                    // No generator script — create simple CSV-style output
                    const outputDir = path.join(__dirname, '..', 'test-cases');
                    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                    const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                    await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);

                    return JSON.stringify({
                        success: true,
                        path: outputPath,
                        stepCount: steps.length,
                        message: `Excel created: ${path.basename(outputPath)}`,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Excel generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12c: find_test_files
    // Available to: scriptgenerator, codereviewer
    // Recursively searches the workspace for test files/folders by name,
    // ticket ID, or keyword. Use BEFORE execute_test when the user gives
    // a partial name instead of a full path.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('find_test_files', {
            description:
                'Search the workspace for test spec files and folders by name, ticket ID, or keyword. ' +
                'Recursively scans tests/specs/, tests-scratch/specs/, and any configured spec directories. ' +
                'Use this BEFORE execute_test when the user provides a partial name (e.g., "planner", ' +
                '"AOTF-16337", "notes", "profile") instead of a full path. Returns matching file/folder paths.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search term — file name, folder name, ticket ID, or keyword (case-insensitive)',
                    },
                    type: {
                        type: 'string',
                        enum: ['file', 'folder', 'both'],
                        description: 'Filter results by type (default: "both")',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, type: filterType }) => {
                const projectRoot = path.join(__dirname, '..', '..');
                const searchType = filterType || 'both';
                const results = [];
                const normalizedQuery = String(query || '').trim().replace(/^['"]|['"]$/g, '');

                if (!normalizedQuery) {
                    return JSON.stringify({
                        success: false,
                        error: 'Query cannot be empty.',
                    }, null, 2);
                }

                // If user passed a direct absolute path, validate and return immediately.
                if (path.isAbsolute(normalizedQuery) && fs.existsSync(normalizedQuery)) {
                    try {
                        const stats = fs.statSync(normalizedQuery);
                        const relativePath = _relativePathIfInside(projectRoot, normalizedQuery);

                        if (stats.isDirectory() && (searchType === 'folder' || searchType === 'both')) {
                            const specFileCount = _countSpecFiles(normalizedQuery);
                            results.push({
                                name: path.basename(normalizedQuery),
                                path: normalizedQuery,
                                relativePath,
                                type: 'folder',
                                specFileCount,
                            });
                        } else if (stats.isFile() && (searchType === 'file' || searchType === 'both')) {
                            results.push({
                                name: path.basename(normalizedQuery),
                                path: normalizedQuery,
                                relativePath,
                                type: 'file',
                                size: stats.size,
                                modified: stats.mtime.toISOString(),
                                isSpec: normalizedQuery.endsWith('.spec.js'),
                            });
                        }

                        return JSON.stringify({
                            success: true,
                            query: normalizedQuery,
                            directPathMatch: true,
                            matchCount: results.length,
                            results,
                            searchedDirectories: [normalizedQuery],
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Could not inspect path: ${error.message}`,
                        }, null, 2);
                    }
                }

                // Directories to search
                const searchDirs = [
                    path.join(projectRoot, 'tests', 'specs'),
                    path.join(projectRoot, 'tests-scratch', 'specs'),
                ];

                // Also check workflow config for additional spec directories
                try {
                    const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
                    if (fs.existsSync(configPath)) {
                        const wfConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                        const specDir = wfConfig?.projectPaths?.specsDir;
                        if (specDir) {
                            const resolved = path.isAbsolute(specDir) ? specDir : path.join(projectRoot, specDir);
                            if (!searchDirs.includes(resolved)) searchDirs.push(resolved);
                        }
                    }
                } catch { /* ignore config read errors */ }

                const queryLower = normalizedQuery.toLowerCase();

                function scanDir(dir, depth = 0) {
                    if (depth > 5 || !fs.existsSync(dir)) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const entryPath = path.join(dir, entry.name);
                            const nameLower = entry.name.toLowerCase();
                            const matches = nameLower.includes(queryLower);

                            if (entry.isDirectory()) {
                                if (matches && (searchType === 'folder' || searchType === 'both')) {
                                    // Count .spec.js files inside matching folder
                                    const specFiles = _countSpecFiles(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'folder',
                                        specFileCount: specFiles,
                                    });
                                }
                                // Always recurse into subdirectories
                                scanDir(entryPath, depth + 1);
                            } else if (entry.isFile()) {
                                if (matches && (searchType === 'file' || searchType === 'both')) {
                                    const stats = fs.statSync(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'file',
                                        size: stats.size,
                                        modified: stats.mtime.toISOString(),
                                        isSpec: entry.name.endsWith('.spec.js'),
                                    });
                                }
                            }
                        }
                    } catch { /* permission errors */ }
                }

                for (const dir of searchDirs) {
                    scanDir(dir);
                }

                return JSON.stringify({
                    success: true,
                    query: normalizedQuery,
                    matchCount: results.length,
                    results: results.slice(0, 50), // Cap at 50 results
                    searchedDirectories: searchDirs.map(d => path.relative(projectRoot, d).replace(/\\/g, '/')),
                }, null, 2);
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12b: execute_test
    // Available to: scriptgenerator, codereviewer
    // Runs test files using auto-detected framework (Playwright, WebDriverIO,
    // Cypress, Jest, Mocha, Vitest) and saves results for the Reports dashboard.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('execute_test', {
            description:
                'Execute test files using auto-detected framework and return structured results. ' +
                'Auto-detects the test framework (Playwright, WebDriverIO, Cypress, Jest, Mocha, Vitest) ' +
                'from config files and package.json, then runs the appropriate command. ' +
                'Saves raw results to test-artifacts/reports/ for the Reports dashboard. ' +
                'Returns a summary with pass/fail counts, failed test names, and error details. ' +
                'Supports workspace-relative paths, absolute paths, folders, and external project paths. ' +
                'For external paths, auto-detects the project root and framework.',
            parameters: {
                type: 'object',
                properties: {
                    specPath: {
                        type: 'string',
                        description: 'Path to a test file OR a folder containing test files (absolute or relative to workspace root). Can also be a keyword like "planner" or "notes" — auto-discovery will find it. Supports .spec.js, .test.js, .e2e.js, .cy.js, .spec.ts, .test.ts files.',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., AOTF-16461) for labeling the report. If omitted, derived from the folder name.',
                    },
                    framework: {
                        type: 'string',
                        description: 'Test framework to use. Default: "auto" (auto-detect from config files). Options: auto, playwright, webdriverio, cypress, jest, mocha, vitest.',
                    },
                },
                required: ['specPath'],
            },
            handler: async ({ specPath, ticketId, framework: frameworkHint }) => {
                const { runCommand } = require('./terminal-runner');
                const projectRoot = path.join(__dirname, '..', '..');
                const normalizedSpecPath = String(specPath || '').trim().replace(/^['"]|['"]$/g, '');

                if (!normalizedSpecPath) {
                    return JSON.stringify({
                        success: false,
                        error: 'specPath is required.',
                    });
                }

                // Broadcast progress: resolving spec
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('execute_test', {
                        phase: 'test', message: `Resolving test spec: ${normalizedSpecPath}...`, step: 1,
                    });
                }

                // Resolve spec path
                let resolvedSpec = path.isAbsolute(normalizedSpecPath)
                    ? normalizedSpecPath
                    : path.join(projectRoot, normalizedSpecPath);

                let isDirectory = false;
                let executionRoot = projectRoot;
                let externalExecution = false;

                // ── Auto-discovery: if not found, search by name ──
                if (!fs.existsSync(resolvedSpec)) {
                    const searchName = path.basename(normalizedSpecPath).toLowerCase();
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
                                    if (entry.name.toLowerCase().includes(searchName)) {
                                        // Record the FOLDER itself — do NOT expand to individual files
                                        const specCount = _countSpecFiles(entryPath);
                                        if (specCount > 0) {
                                            folderMatches.push({ path: entryPath, specCount });
                                        }
                                    }
                                    searchRecursive(entryPath, depth + 1);
                                } else if (entry.isFile() && entry.name.toLowerCase().includes(searchName) && /\.(spec|test|e2e|cy)\.(js|ts|mjs|cjs)$/.test(entry.name)) {
                                    fileMatches.push(entryPath);
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    for (const dir of searchDirs) {
                        searchRecursive(dir);
                    }

                    // Prefer folder matches over individual file matches
                    if (folderMatches.length === 1) {
                        resolvedSpec = folderMatches[0].path;
                        isDirectory = true;
                    } else if (folderMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple folder matches found for "${normalizedSpecPath}". Please specify which one.`,
                            matches: folderMatches.map(m => ({
                                path: path.relative(projectRoot, m.path).replace(/\\/g, '/'),
                                specCount: m.specCount,
                            })),
                        });
                    } else if (fileMatches.length === 1) {
                        resolvedSpec = fileMatches[0];
                    } else if (fileMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple file matches found for "${normalizedSpecPath}". Please specify the exact file.`,
                            matches: fileMatches.map(m => path.relative(projectRoot, m).replace(/\\/g, '/')),
                        });
                    } else {
                        return JSON.stringify({
                            success: false,
                            error: `Spec file/folder not found: "${normalizedSpecPath}". No matches in tests/specs/ or tests-scratch/specs/.`,
                        });
                    }
                } else {
                    // Path exists — check if it's a directory
                    isDirectory = fs.statSync(resolvedSpec).isDirectory();
                }

                const workspaceRelativePath = _relativePathIfInside(projectRoot, resolvedSpec);
                if (!workspaceRelativePath) {
                    // Use universal findProjectRoot — detects ANY framework, not just Playwright
                    const { findProjectRoot } = require('./framework-detector');
                    const externalRoot = findProjectRoot(resolvedSpec);
                    if (externalRoot) {
                        executionRoot = externalRoot;
                        externalExecution = true;
                    } else {
                        // Fallback: remap to a workspace spec target when possible.
                        const workspaceMatch = _resolveWorkspaceSpecTarget(projectRoot, resolvedSpec, isDirectory);
                        if (workspaceMatch) {
                            resolvedSpec = workspaceMatch;
                            isDirectory = fs.statSync(resolvedSpec).isDirectory();
                            executionRoot = projectRoot;
                            externalExecution = false;
                        } else {
                            return JSON.stringify({
                                success: false,
                                error: `Spec path is outside this workspace and no project root was found: "${normalizedSpecPath}".`,
                                hint: 'Use a workspace path under tests/specs, or provide a path inside a project with package.json or a test framework config file.',
                            });
                        }
                    }
                }

                // If it's a directory, verify it has test files (any framework)
                if (isDirectory) {
                    const { countTestFiles } = require('./framework-detector');
                    const testFileCount = countTestFiles(resolvedSpec);
                    if (testFileCount === 0) {
                        return JSON.stringify({
                            success: false,
                            error: `Folder "${normalizedSpecPath}" exists but contains no test files (.spec.js, .test.js, .e2e.js, .cy.js, etc.).`,
                        });
                    }
                }

                // Derive ticketId from path if not provided
                let derivedTicketId;
                if (ticketId) {
                    derivedTicketId = ticketId;
                } else if (isDirectory) {
                    // For folders: use the folder name itself (e.g., "planner" → "PLANNER")
                    derivedTicketId = path.basename(resolvedSpec).toUpperCase();
                } else {
                    // For files: use the parent folder name (e.g., "aotf-16461/file.spec.js" → "AOTF-16461")
                    derivedTicketId = path.basename(path.dirname(resolvedSpec)).toUpperCase();
                }
                derivedTicketId = derivedTicketId || 'UNKNOWN';

                const runId = `chat_${derivedTicketId}_${Date.now()}`;

                try {
                    const relativePath = _relativePathIfInside(executionRoot, resolvedSpec);
                    if (!relativePath) {
                        return JSON.stringify({
                            success: false,
                            error: `Resolved spec path is not inside execution root: "${resolvedSpec}".`,
                        });
                    }

                    // For directories, pass directly; for files, framework-specific
                    // escaping is handled inside the command construction block below.

                    const scopeSuffix = externalExecution
                        ? ` (external root: ${path.basename(executionRoot)})`
                        : '';

                    // Broadcast progress: running
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test', message: isDirectory
                                ? `Running all specs in ${path.basename(resolvedSpec)}${scopeSuffix}...`
                                : `Running ${path.basename(resolvedSpec)}${scopeSuffix}...`,
                            step: 2,
                        });
                    }

                    let output;
                    let exitCode = 0;
                    let timedOut = false;
                    let aborted = false;
                    let lastProgressEmit = 0;

                    // ── Framework detection + command construction ──
                    const { detectFramework, buildRunCommand: buildFwCommand } = require('./framework-detector');
                    const { getParserForFramework, parseJsonResults } = require('./output-parser');

                    const fwHint = (frameworkHint || 'auto').toLowerCase().trim();
                    let detectedFramework = 'playwright'; // default for this workspace
                    let detection = null;

                    if (fwHint !== 'auto' && fwHint !== 'playwright') {
                        detectedFramework = fwHint;
                    } else if (externalExecution || fwHint === 'auto') {
                        detection = detectFramework(executionRoot);
                        if (detection.confidence !== 'low') {
                            detectedFramework = detection.framework;
                        }
                    }

                    const os = require('os');
                    const jsonOutputFile = path.join(
                        os.tmpdir(),
                        `test-json-${runId}.json`
                    );

                    // Get framework-appropriate output parser for streaming
                    const outputParser = getParserForFramework(detectedFramework);

                    let eventBridge = null;
                    let bridgeTypes = null;
                    try {
                        const bridgeModule = require('./event-bridge');
                        eventBridge = bridgeModule.getEventBridge();
                        bridgeTypes = bridgeModule.EVENT_TYPES;
                    } catch { /* EventBridge not available — chat broadcast only */ }

                    let testsSeen = 0;
                    let testsPassed = 0;
                    let testsFailed = 0;
                    let totalFromHeader = null;

                    const broadcastTestEvent = (evt) => {
                        if (evt.kind === 'header') {
                            totalFromHeader = evt.totalTests;
                            if (deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('execute_test', {
                                    phase: 'test',
                                    message: `Starting ${evt.totalTests} test${evt.totalTests === 1 ? '' : 's'} (${evt.workerCount} worker${evt.workerCount === 1 ? '' : 's'})`,
                                    step: 2,
                                    totalTests: evt.totalTests,
                                });
                            }
                            if (eventBridge && bridgeTypes) {
                                eventBridge.push(bridgeTypes.TEST_PROGRESS, runId, {
                                    kind: 'start',
                                    totalTests: evt.totalTests,
                                    workerCount: evt.workerCount,
                                    ticketId: derivedTicketId,
                                });
                            }
                            return;
                        }
                        if (evt.kind === 'test') {
                            if (evt.status === 'passed') testsPassed++;
                            else if (evt.status === 'failed') testsFailed++;
                            if (evt.status !== 'running') testsSeen++;

                            // Chat progress — throttled and terse
                            if (deps?.chatManager?.broadcastToolProgress && evt.status !== 'running') {
                                const now = Date.now();
                                if (now - lastProgressEmit >= 500) {
                                    lastProgressEmit = now;
                                    const totalLabel = totalFromHeader ? `/${totalFromHeader}` : '';
                                    deps.chatManager.broadcastToolProgress('execute_test', {
                                        phase: 'test',
                                        message: `${testsSeen}${totalLabel} — ${testsPassed} passed, ${testsFailed} failed`,
                                        step: 2,
                                        testIndex: evt.index,
                                        testTitle: evt.title,
                                        testStatus: evt.status,
                                    });
                                }
                            }
                            if (eventBridge && bridgeTypes) {
                                eventBridge.push(bridgeTypes.TEST_RESULT, runId, {
                                    ticketId: derivedTicketId,
                                    index: evt.index,
                                    title: evt.title,
                                    project: evt.project,
                                    status: evt.status,
                                    durationText: evt.durationText,
                                    runningTotals: { seen: testsSeen, passed: testsPassed, failed: testsFailed },
                                });
                            }
                        }
                    };

                    const streamChunk = (chunk, stream) => {
                        if (!chunk) return;
                        // Feed into structured parser (emits per-test events)
                        if (stream === 'stdout') {
                            try {
                                const events = outputParser.feed(chunk);
                                for (const evt of events) broadcastTestEvent(evt);
                            } catch { /* parser must never break execution */ }
                        }

                        // Legacy throttled progress fallback — keeps stderr visible and
                        // covers any output the structured parser didn't match.
                        if (!deps?.chatManager?.broadcastToolProgress) return;
                        const now = Date.now();
                        if (now - lastProgressEmit < 1500) return;
                        // Only emit legacy progress for stderr (stdout handled above)
                        if (stream !== 'stderr') return;
                        lastProgressEmit = now;
                        const firstLine = String(chunk)
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .find((line) => line.length > 0);
                        if (!firstLine) return;
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine,
                            step: 2,
                            stream,
                        });
                    };

                    // ── Framework-aware command construction ──
                    // For Playwright (this workspace's primary framework), use the proven
                    // dual-reporter strategy. For other frameworks, use buildRunCommand.
                    let runCommandName, runCommandArgs, execStrategy;
                    const childEnv = {
                        ...process.env,
                        FORCE_COLOR: '0',
                        CI: process.env.CI || '1',
                    };

                    if (detectedFramework === 'playwright') {
                        const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                        const reporterArg = '--reporter=list,json';
                        const playwrightTarget = isDirectory
                            ? relativePath
                            : relativePath.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');
                        const playwrightArgs = ['playwright', 'test', playwrightTarget, reporterArg];

                        runCommandName = npxCommand;
                        runCommandArgs = playwrightArgs;
                        execStrategy = 'npx';

                        const matchingScript = _findMatchingNpmScript(executionRoot, resolvedSpec, isDirectory);
                        const localPlaywright = _resolveLocalPlaywrightBinary(executionRoot);

                        if (matchingScript) {
                            const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                            runCommandName = npmCommand;
                            runCommandArgs = ['run', matchingScript.scriptName, '--', reporterArg];
                            execStrategy = `npm-script:${matchingScript.scriptName}`;
                        } else if (localPlaywright) {
                            runCommandName = localPlaywright.command;
                            runCommandArgs = ['test', playwrightTarget, reporterArg];
                            execStrategy = 'local-binary';
                        }

                        // Playwright-specific JSON output env vars
                        childEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonOutputFile;
                        childEnv.PLAYWRIGHT_JSON_OUTPUT_FILE = jsonOutputFile;
                    } else {
                        // Non-Playwright: use framework detector to build the right command
                        const fwCmd = buildFwCommand(
                            detection || { framework: detectedFramework, configFile: null, projectRoot: executionRoot, detectedScripts: [] },
                            relativePath,
                            { json: true, jsonOutputFile }
                        );
                        runCommandName = fwCmd.command;
                        runCommandArgs = fwCmd.args;
                        execStrategy = `${detectedFramework}:${fwCmd.strategy}`;
                        Object.assign(childEnv, fwCmd.env || {});
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: `Framework: ${detectedFramework} | Strategy: ${execStrategy}`,
                            step: 2,
                        });
                    }

                    try {
                        const result = await runCommand({
                            command: runCommandName,
                            args: runCommandArgs,
                            cwd: executionRoot,
                            timeoutMs: 300000,
                            abortSignal: deps?.abortSignal || null,
                            env: childEnv,
                            onStdout: (chunk) => streamChunk(chunk, 'stdout'),
                            onStderr: (chunk) => streamChunk(chunk, 'stderr'),
                        });
                        output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
                        exitCode = result.exitCode ?? 0;
                    } catch (execError) {
                        // Playwright exits non-zero on test failures — its stdout contains the JSON report.
                        output = [execError.stdout || '', execError.stderr || ''].filter(Boolean).join('\n');
                        exitCode = Number.isInteger(execError.exitCode) ? execError.exitCode : 1;
                        timedOut = execError.timedOut === true;
                        aborted = execError.aborted === true;

                        // Spawn-level failure (ENOENT, EACCES, etc.) — return structured diagnostics
                        // instead of an opaque "error with spawning the process" message so the agent
                        // can actually recover.
                        if (execError.code === 'SPAWN_ERROR' || execError.code === 'ENOENT') {
                            try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                            return JSON.stringify({
                                success: false,
                                error: `Failed to launch test runner (${execError.code}): ${execError.message}`,
                                diagnostics: {
                                    reason: 'SPAWN_FAILED',
                                    framework: detectedFramework,
                                    strategy: execStrategy,
                                    command: runCommandName,
                                    args: runCommandArgs,
                                    executionRoot,
                                    externalExecution,
                                    hasPackageJson: fs.existsSync(path.join(executionRoot, 'package.json')),
                                    hasNodeModules: fs.existsSync(path.join(executionRoot, 'node_modules')),
                                },
                                hint: !fs.existsSync(path.join(executionRoot, 'node_modules'))
                                    ? `The project at "${executionRoot}" has no node_modules. Run "npm install" there first.`
                                    : `The ${detectedFramework} runner could not be launched in "${executionRoot}". Verify the framework is installed (check node_modules/.bin/).`,
                                runId,
                            });
                        }

                        if (!output) {
                            output = execError.message || '';
                        }
                    }

                    if (aborted) {
                        try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                        return JSON.stringify({
                            success: false,
                            cancelled: true,
                            error: 'Test execution cancelled.',
                            runId,
                            executionRoot,
                            externalExecution,
                        });
                    }

                    if (timedOut && !output) {
                        try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                        return JSON.stringify({
                            success: false,
                            error: 'Test execution timed out after 300s with no output.',
                            runId,
                            executionRoot,
                            externalExecution,
                        });
                    }

                    // Flush any residual buffered line from the streaming parser
                    try {
                        const tailEvents = outputParser.flush();
                        for (const evt of tailEvents) broadcastTestEvent(evt);
                    } catch { /* parser tail flush is best-effort */ }

                    // Strip dotenv banner and other non-JSON preamble from stdout
                    const cleanedOutput = output.replace(/^\[dotenv[^\]]*\][^\n]*\n?/gm, '').trim();

                    // Parse JSON — prefer the tempfile (dual-reporter writes there), fall back
                    // to stdout parsing for backward compat / older Playwright versions.
                    const { extractJSON: parseJSON } = require('./utils');
                    let jsonResult = null;
                    let parseSource = null;

                    if (fs.existsSync(jsonOutputFile)) {
                        try {
                            const fileContent = fs.readFileSync(jsonOutputFile, 'utf-8');
                            if (fileContent && fileContent.trim().length > 0) {
                                jsonResult = JSON.parse(fileContent);
                                parseSource = 'file';
                            }
                        } catch { /* fall through to stdout parse */ }
                    }

                    if (!jsonResult) {
                        try {
                            jsonResult = parseJSON(cleanedOutput);
                            parseSource = 'stdout';
                        } catch {
                            // Could not parse JSON — for non-Playwright frameworks, use
                            // the streaming parser's aggregated results as fallback.
                            const streamResults = outputParser.getResults();
                            if (streamResults.total > 0 || detectedFramework !== 'playwright') {
                                _saveTestReport(derivedTicketId, runId, resolvedSpec, {
                                    rawOutput: output.substring(0, 50000),
                                    framework: detectedFramework,
                                    streamResults,
                                });
                                try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }

                                const effectiveFailedCount = streamResults.failed;
                                if (deps?.chatManager?.broadcastToolProgress) {
                                    deps.chatManager.broadcastToolProgress('execute_test', {
                                        phase: 'test',
                                        message: streamResults.total > 0
                                            ? `${streamResults.passed}/${streamResults.total} passed, ${streamResults.failed} failed`
                                            : `Exit code: ${exitCode}`,
                                        step: 3,
                                    });
                                }

                                return JSON.stringify({
                                    success: exitCode === 0 && streamResults.failed === 0,
                                    totalCount: streamResults.total,
                                    passedCount: streamResults.passed,
                                    failedCount: effectiveFailedCount,
                                    failedTests: streamResults.failedTests,
                                    runnerErrors: [],
                                    reportSaved: true,
                                    runId,
                                    isFolder: isDirectory,
                                    executionRoot,
                                    externalExecution,
                                    framework: detectedFramework,
                                    strategy: execStrategy,
                                    parseSource: 'stream',
                                    streamedCount: testsSeen,
                                    message: streamResults.total > 0
                                        ? `${streamResults.passed}/${streamResults.total} tests passed`
                                        : (exitCode === 0 ? 'Command succeeded (no structured results)' : `Command failed with exit code ${exitCode}`),
                                });
                            }

                            // No stream results and no JSON — save raw output as error
                            _saveTestReport(derivedTicketId, runId, resolvedSpec, {
                                rawError: output.substring(0, 50000),
                            });
                            try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                            return JSON.stringify({
                                success: false,
                                error: `Test output could not be parsed as JSON (framework: ${detectedFramework})`,
                                rawOutput: output.substring(0, 2000),
                                reportSaved: true,
                                runId,
                                executionRoot,
                                externalExecution,
                                framework: detectedFramework,
                            });
                        }
                    }

                    // Clean up the JSON tempfile — we've already read it
                    try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }

                    // Extract results using framework-aware parser
                    const { totalSpecs, passed, failed, failedTests, runnerErrors } = parseJsonResults(jsonResult, detectedFramework);

                    const syntheticFailures = totalSpecs === 0 ? runnerErrors.length : 0;
                    const effectiveFailedCount = failed + syntheticFailures;

                    // Save raw report for dashboard
                    _saveTestReport(derivedTicketId, runId, resolvedSpec, jsonResult);

                    // Broadcast progress: results
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: totalSpecs > 0
                                ? `${passed}/${totalSpecs} passed, ${failed} failed`
                                : (runnerErrors[0] ? `No tests found: ${runnerErrors[0]}` : 'No tests found in output'),
                            step: 3,
                        });
                    }

                    return JSON.stringify({
                        success: failed === 0 && totalSpecs > 0,
                        totalCount: totalSpecs,
                        passedCount: passed,
                        failedCount: effectiveFailedCount,
                        failedTests,
                        runnerErrors,
                        reportSaved: true,
                        runId,
                        isFolder: isDirectory,
                        executionRoot,
                        externalExecution,
                        framework: detectedFramework,
                        strategy: execStrategy,
                        parseSource,
                        streamedCount: testsSeen,
                        message: totalSpecs > 0
                            ? `${passed}/${totalSpecs} tests passed`
                            : (runnerErrors[0] ? `No tests found: ${runnerErrors[0]}` : 'No tests found in output'),
                    });
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: error.message?.substring(0, 1000) || 'Unknown execute_test error',
                        diagnostics: {
                            reason: 'HANDLER_EXCEPTION',
                            errorName: error.name || null,
                            errorCode: error.code || null,
                            specPath: normalizedSpecPath,
                        },
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12c: run_command — Universal Shell Command Runner
    // Available to: scriptgenerator, codereviewer
    // Runs ANY shell command in a specified directory. This is the
    // universal escape hatch for non-Playwright test runners, bash
    // scripts, Python, WebDriverIO, Selenium, custom CLIs, etc.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        // Safety: blocked destructive command patterns
        const BLOCKED_COMMAND_PATTERNS = [
            /\brm\s+(-rf?|--recursive)\s+[/\\]/i,
            /\bformat\s+[A-Z]:/i,
            /\bdel\s+\/s\s+\/q\s+[A-Z]:/i,
            /\bmkfs\b/i,
            /\bdd\s+if=/i,
            /\bshutdown\b/i,
            /\breboot\b/i,
            /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,  // fork bomb
            /\bkill\s+-9\s+(-1|0)\b/,
            /\btaskkill\s+\/f\s+\/im\s+\*/i,
        ];
        const MAX_TIMEOUT_SECONDS = 600;
        const DEFAULT_TIMEOUT_SECONDS = 300;
        const MAX_OUTPUT_CHARS = 50 * 1024;

        tools.push(defineTool('run_command', {
            description:
                'Run any shell command in a specified directory and return stdout/stderr. ' +
                'Use this for non-Playwright test runners (WebDriverIO, Selenium, Cypress, Jest, Mocha), ' +
                'bash/shell scripts, Python scripts, npm/yarn commands, or any CLI tool. ' +
                'Supports absolute paths for working directory. Returns exit code, stdout, and stderr. ' +
                'For structured test results with pass/fail parsing, prefer execute_test instead.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The full command to run (e.g., "npx wdio run wdio.conf.js", "npm test", "python -m pytest", "bash ./run-tests.sh"). Will be split into command + args automatically.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command. Absolute path required. Defaults to workspace root.',
                    },
                    timeoutSeconds: {
                        type: 'number',
                        description: `Max execution time in seconds. Default: ${DEFAULT_TIMEOUT_SECONDS}, Max: ${MAX_TIMEOUT_SECONDS}.`,
                    },
                    env: {
                        type: 'object',
                        description: 'Additional environment variables to merge with process.env. Keys are variable names, values are strings.',
                    },
                },
                required: ['command'],
            },
            handler: async ({ command, cwd, timeoutSeconds, env: extraEnv }) => {
                const { runCommand } = require('./terminal-runner');
                const projectRoot = path.join(__dirname, '..', '..');

                const rawCommand = String(command || '').trim();
                if (!rawCommand) {
                    return JSON.stringify({ success: false, error: 'command is required.' });
                }

                // Safety check: block destructive commands
                for (const pattern of BLOCKED_COMMAND_PATTERNS) {
                    if (pattern.test(rawCommand)) {
                        return JSON.stringify({
                            success: false,
                            error: `Command blocked for safety: matches destructive pattern "${pattern.source}".`,
                            blocked: true,
                        });
                    }
                }

                // Resolve working directory
                let resolvedCwd = projectRoot;
                if (cwd) {
                    const cwdStr = String(cwd).trim();
                    if (cwdStr) {
                        resolvedCwd = path.isAbsolute(cwdStr) ? cwdStr : path.join(projectRoot, cwdStr);
                    }
                }
                if (!fs.existsSync(resolvedCwd)) {
                    return JSON.stringify({
                        success: false,
                        error: `Working directory does not exist: "${resolvedCwd}".`,
                    });
                }
                try {
                    if (!fs.statSync(resolvedCwd).isDirectory()) {
                        return JSON.stringify({
                            success: false,
                            error: `Path is not a directory: "${resolvedCwd}".`,
                        });
                    }
                } catch (e) {
                    return JSON.stringify({
                        success: false,
                        error: `Cannot access working directory: "${resolvedCwd}" — ${e.message}`,
                    });
                }

                // Resolve timeout
                const timeout = Math.min(
                    Math.max(1, Number(timeoutSeconds) || DEFAULT_TIMEOUT_SECONDS),
                    MAX_TIMEOUT_SECONDS,
                );

                // Parse command string into command + args
                // Handles quoted strings and Windows .cmd extensions
                const parts = _shellSplit(rawCommand);
                const cmdName = parts[0];
                const cmdArgs = parts.slice(1);

                // On Windows, if the command is a common npm/npx/yarn/node tool, append .cmd
                let resolvedCmdName = cmdName;
                if (process.platform === 'win32') {
                    const CMD_TOOLS = ['npx', 'npm', 'yarn', 'pnpm', 'tsc', 'eslint', 'prettier', 'wdio', 'cypress', 'jest', 'mocha', 'vitest'];
                    if (CMD_TOOLS.includes(cmdName.toLowerCase()) && !cmdName.endsWith('.cmd')) {
                        resolvedCmdName = `${cmdName}.cmd`;
                    }
                }

                // Build environment
                const childEnv = {
                    ...process.env,
                    FORCE_COLOR: '0',
                    ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
                };

                // Broadcast progress
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('run_command', {
                        phase: 'command',
                        message: `Running: ${rawCommand.length > 120 ? rawCommand.substring(0, 120) + '…' : rawCommand}`,
                        step: 1,
                        cwd: resolvedCwd,
                    });
                }

                let lastProgressEmit = 0;
                const streamProgress = (chunk, stream) => {
                    if (!deps?.chatManager?.broadcastToolProgress) return;
                    const now = Date.now();
                    if (now - lastProgressEmit < 2000) return;
                    lastProgressEmit = now;
                    const text = String(chunk || '').trim();
                    if (!text) return;
                    const snippet = text.split(/\r?\n/).find(l => l.trim()) || '';
                    deps.chatManager.broadcastToolProgress('run_command', {
                        phase: 'command',
                        message: snippet.length > 160 ? snippet.substring(0, 160) + '…' : snippet,
                        step: 2,
                        stream,
                    });
                };

                try {
                    const result = await runCommand({
                        command: resolvedCmdName,
                        args: cmdArgs,
                        cwd: resolvedCwd,
                        timeoutMs: timeout * 1000,
                        abortSignal: deps?.abortSignal || null,
                        env: childEnv,
                        onStdout: (chunk) => streamProgress(chunk, 'stdout'),
                        onStderr: (chunk) => streamProgress(chunk, 'stderr'),
                    });

                    const stdout = (result.stdout || '').substring(0, MAX_OUTPUT_CHARS);
                    const stderr = (result.stderr || '').substring(0, MAX_OUTPUT_CHARS);
                    const exitCode = result.exitCode ?? 0;

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('run_command', {
                            phase: 'command',
                            message: exitCode === 0 ? 'Command completed successfully' : `Command exited with code ${exitCode}`,
                            step: 3,
                        });
                    }

                    return JSON.stringify({
                        success: exitCode === 0,
                        exitCode,
                        stdout,
                        stderr,
                        timedOut: false,
                        durationMs: result.durationMs || null,
                        command: rawCommand,
                        cwd: resolvedCwd,
                    });
                } catch (execError) {
                    const stdout = (execError.stdout || '').substring(0, MAX_OUTPUT_CHARS);
                    const stderr = (execError.stderr || '').substring(0, MAX_OUTPUT_CHARS);
                    const exitCode = Number.isInteger(execError.exitCode) ? execError.exitCode : 1;
                    const timedOut = execError.timedOut === true;
                    const aborted = execError.aborted === true;

                    if (aborted) {
                        return JSON.stringify({
                            success: false,
                            exitCode,
                            stdout,
                            stderr,
                            timedOut: false,
                            cancelled: true,
                            durationMs: execError.durationMs || null,
                            command: rawCommand,
                            cwd: resolvedCwd,
                            error: 'Command cancelled.',
                        });
                    }

                    if (execError.code === 'SPAWN_ERROR' || execError.code === 'ENOENT') {
                        return JSON.stringify({
                            success: false,
                            exitCode,
                            stdout,
                            stderr,
                            timedOut,
                            durationMs: execError.durationMs || null,
                            command: rawCommand,
                            cwd: resolvedCwd,
                            error: `Failed to launch command: ${execError.message}`,
                            hint: execError.code === 'ENOENT'
                                ? `Command "${cmdName}" not found. Check spelling, or ensure it is installed and in PATH.`
                                : 'The command could not be started. Verify the executable exists.',
                        });
                    }

                    return JSON.stringify({
                        success: exitCode === 0,
                        exitCode,
                        stdout,
                        stderr,
                        timedOut,
                        durationMs: execError.durationMs || null,
                        command: rawCommand,
                        cwd: resolvedCwd,
                        ...(timedOut ? { error: `Command timed out after ${timeout}s.` } : {}),
                    });
                }
            },
        }));
    }

}

module.exports = { register };
