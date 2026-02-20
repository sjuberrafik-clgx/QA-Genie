/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROJECT PATH RESOLVER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Central utility that resolves all project directory paths dynamically.
 * All files in the workflow MUST use this resolver instead of hardcoding paths.
 * 
 * Resolution order:
 *   1. Environment variables (.env)
 *   2. workflow-config.json → projectPaths
 *   3. Auto-detection (scan filesystem)
 *   4. Built-in defaults (current regression suite structure)
 * 
 * Framework modes:
 *   "full"  → Existing codebase detected (POmanager, launchBrowser, testData)
 *   "basic" → No existing codebase; generate standalone Playwright scripts
 *   "auto"  → Auto-detect based on filesystem (default)
 * 
 * @module project-path-resolver
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Load .env if present ───────────────────────────────────────────────────
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
    // dotenv not installed or .env missing — continue with defaults
}

// ─── Load workflow-config.json ──────────────────────────────────────────────

function loadWorkflowConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
            return {};
        }
    }
    return {};
}

// ─── Auto-Detection ─────────────────────────────────────────────────────────

/**
 * Detect whether the host project has a full automation framework.
 * Looks for key files: POmanager.js, config.js, testData.js
 * Searches from the workspace root (parent of agentic-workflow/).
 */
function detectFrameworkMode(projectRoot) {
    const markers = [
        { name: 'POmanager', paths: ['tests/pageobjects/POmanager.js', 'pageobjects/POmanager.js'] },
        { name: 'config', paths: ['tests/config/config.js', 'config/config.js'] },
        { name: 'testData', paths: ['tests/test-data/testData.js', 'test-data/testData.js'] },
    ];

    let found = 0;
    for (const marker of markers) {
        for (const p of marker.paths) {
            if (fs.existsSync(path.resolve(projectRoot, p))) {
                found++;
                break;
            }
        }
    }

    // All three markers present → full framework
    if (found >= 3) return 'full';
    // Some markers → partial (treat as full with warnings)
    if (found >= 1) return 'full';
    // None → basic standalone mode
    return 'basic';
}

/**
 * Auto-detect a directory by scanning common locations.
 * Returns the first match relative to projectRoot, or null.
 */
function autoDetectPath(projectRoot, candidates) {
    for (const candidate of candidates) {
        if (fs.existsSync(path.resolve(projectRoot, candidate))) {
            return candidate;
        }
    }
    return null;
}

// ─── Resolve Paths ──────────────────────────────────────────────────────────

/**
 * Build the resolved project paths object.
 * Called once and cached for the lifetime of the process.
 */
function resolveProjectPaths() {
    const config = loadWorkflowConfig();
    const configPaths = config.projectPaths || {};

    // Project root = parent of agentic-workflow/ (where the host project lives)
    // If agentic-workflow IS the root (standalone), use cwd
    // NOTE: The workspace root may NOT have a package.json — look for tests/ or .github/
    //       instead, which are reliable markers of the host project root.
    const agenticDir = path.resolve(__dirname, '..');
    const parentDir = path.resolve(agenticDir, '..');
    const hasProjectMarker = fs.existsSync(path.join(parentDir, 'tests'))
        || fs.existsSync(path.join(parentDir, '.github'))
        || fs.existsSync(path.join(parentDir, 'package.json'));
    const projectRoot = hasProjectMarker
        ? parentDir
        : process.cwd();

    // Framework mode
    const envMode = process.env.FRAMEWORK_MODE;
    const cfgMode = configPaths.frameworkMode;
    let frameworkMode = envMode || cfgMode || 'auto';
    if (frameworkMode === 'auto') {
        frameworkMode = detectFrameworkMode(projectRoot);
    }

    // ── Resolve each path ──
    // Priority: env var → workflow-config.json → auto-detect → default

    const specsDir = process.env.SPECS_DIR
        || configPaths.specsDir
        || autoDetectPath(projectRoot, ['tests/specs', 'specs', 'test/specs', 'e2e/specs'])
        || 'tests/specs';

    const pageObjectsDir = process.env.PAGE_OBJECTS_DIR
        || configPaths.pageObjectsDir
        || autoDetectPath(projectRoot, ['tests/pageobjects', 'pageobjects', 'test/pageobjects'])
        || 'tests/pageobjects';

    const configDir = process.env.CONFIG_DIR
        || configPaths.configDir
        || autoDetectPath(projectRoot, ['tests/config', 'config', 'test/config'])
        || 'tests/config';

    const testDataFile = process.env.TEST_DATA_FILE
        || configPaths.testDataFile
        || autoDetectPath(projectRoot, [
            'tests/test-data/testData.js',
            'test-data/testData.js',
            'tests/fixtures/testData.js',
            'fixtures/testData.js',
        ])
        || 'tests/test-data/testData.js';

    const businessFunctionsDir = process.env.BUSINESS_FUNCTIONS_DIR
        || configPaths.businessFunctionsDir
        || autoDetectPath(projectRoot, ['tests/business-functions', 'business-functions', 'tests/helpers'])
        || 'tests/business-functions';

    const utilsDir = process.env.UTILS_DIR
        || configPaths.utilsDir
        || autoDetectPath(projectRoot, ['tests/utils', 'utils', 'test/utils'])
        || 'tests/utils';

    const enumsDir = process.env.ENUMS_DIR
        || configPaths.enumsDir
        || autoDetectPath(projectRoot, ['tests/enums', 'enums'])
        || 'tests/enums';

    const importPrefix = configPaths.importPrefix || '../../';

    // ── Internal workflow paths (always relative to agentic-workflow/) ──

    const explorationDataDir = 'exploration-data';
    const testCasesDir = 'test-cases';
    const testArtifactsDir = 'test-artifacts';
    const workflowStateDir = '.github/agents/state';
    const workflowStatePath = path.join(workflowStateDir, 'workflow-state.json');

    // ── Jira config (env vars override workflow-config.json) ──

    const jira = {
        cloudId: process.env.JIRA_CLOUD_ID || config.jira?.cloudId || '',
        baseUrl: process.env.JIRA_BASE_URL || config.jira?.baseUrl || '',
        projectKey: process.env.JIRA_PROJECT_KEY || config.jira?.defaultProject?.key || '',
        projectName: process.env.JIRA_PROJECT_NAME || config.jira?.defaultProject?.name || '',
        projectId: process.env.JIRA_PROJECT_ID || config.jira?.defaultProject?.id || '',
    };

    // ── Environment URLs (env vars override workflow-config.json) ──

    const environments = {
        UAT: {
            baseUrl: process.env.UAT_URL || config.environments?.UAT?.baseUrl || '',
        },
        DEV: {
            baseUrl: process.env.DEV_URL || config.environments?.DEV?.baseUrl || '',
        },
        INT: {
            baseUrl: process.env.INT_URL || config.environments?.INT?.baseUrl || '',
        },
        PROD: {
            baseUrl: process.env.PROD_URL || config.environments?.PROD?.baseUrl || '',
        },
    };

    return Object.freeze({
        // Where the host project lives
        projectRoot,

        // Framework detection
        frameworkMode,

        // Host project directories (relative to projectRoot)
        specsDir,
        pageObjectsDir,
        configDir,
        testDataFile,
        businessFunctionsDir,
        utilsDir,
        enumsDir,
        importPrefix,

        // Internal workflow directories (relative to agentic-workflow/)
        explorationDataDir,
        testCasesDir,
        testArtifactsDir,
        workflowStateDir,
        workflowStatePath,

        // Jira
        jira,

        // Environments
        environments,

        // ── Helper functions ──

        /** Resolve a path relative to the host project root */
        resolveProjectPath(...segments) {
            return path.resolve(projectRoot, ...segments);
        },

        /** Resolve the spec folder for a given ticket ID */
        resolveSpecDir(ticketId) {
            return path.join(specsDir, ticketId.toLowerCase());
        },

        /** Build a require() import path for generated scripts
         *  (relative from specs/{ticket}/ to the target directory) */
        buildImportPath(targetDir) {
            return importPrefix + targetDir.replace(/^tests\//, '');
        },

        /** Get import statements for generated scripts based on framework mode */
        getScriptImports() {
            if (frameworkMode === 'basic') {
                return {
                    header: [
                        "const { test, expect } = require('@playwright/test');",
                    ],
                    beforeAll: [
                        '    const browser = await test.chromium?.launch() || null;',
                        '    const context = browser ? await browser.newContext() : null;',
                        '    page = context ? await context.newPage() : null;',
                    ],
                    usePOmanager: false,
                    useLaunchBrowser: false,
                };
            }
            // Full framework mode
            return {
                header: [
                    "const { test, expect } = require('@playwright/test');",
                    `const { launchBrowser } = require('${importPrefix}config/config');`,
                    `const POmanager = require('${importPrefix}pageobjects/POmanager');`,
                    `const { userTokens } = require('${importPrefix}test-data/testData');`,
                ],
                beforeAll: [
                    '    const launched = await launchBrowser();',
                    '    browser = launched.browser;',
                    '    context = launched.context;',
                    '    page = launched.page;',
                    '',
                    '    Pomanager = new POmanager(page);',
                    '    generalFunctions = Pomanager.generalFunctions();',
                    '    homePage = Pomanager.homePage();',
                ],
                usePOmanager: true,
                useLaunchBrowser: true,
            };
        },

        /** Build regex patterns for framework compliance validation */
        getCompliancePatterns() {
            if (frameworkMode === 'basic') {
                // In basic mode, only check for Playwright test structure
                return {
                    requiredImports: [/require\(['"]@playwright\/test['"]\)/],
                    optionalImports: [],
                    skipPOmanagerCheck: true,
                    skipLaunchBrowserCheck: true,
                    skipTestDataCheck: true,
                };
            }
            // Full framework mode — strict compliance
            const pfx = importPrefix.replace(/\//g, '\\/').replace(/\./g, '\\.');
            return {
                requiredImports: [
                    new RegExp(`require\\(['"]${pfx}pageobjects\\/POmanager['"]\\)`),
                    new RegExp(`require\\(['"]${pfx}config\\/(config|browser-manager)['"]\\)`),
                ],
                optionalImports: [
                    new RegExp(`require\\(['"]${pfx}test-data\\/testData['"]\\)`),
                ],
                skipPOmanagerCheck: false,
                skipLaunchBrowserCheck: false,
                skipTestDataCheck: false,
            };
        },

        /** Print a summary of resolved paths (for debugging / setup) */
        printSummary() {
            console.log('═'.repeat(70));
            console.log('📁 PROJECT PATH RESOLVER — Resolved Configuration');
            console.log('═'.repeat(70));
            console.log(`   Framework Mode : ${frameworkMode}`);
            console.log(`   Project Root   : ${projectRoot}`);
            console.log(`   Specs Dir      : ${specsDir}`);
            console.log(`   Page Objects   : ${pageObjectsDir}`);
            console.log(`   Config Dir     : ${configDir}`);
            console.log(`   Test Data      : ${testDataFile}`);
            console.log(`   Biz Functions  : ${businessFunctionsDir}`);
            console.log(`   Utils Dir      : ${utilsDir}`);
            console.log(`   Import Prefix  : ${importPrefix}`);
            console.log(`   Jira Base URL  : ${jira.baseUrl || '(not configured)'}`);
            console.log(`   Jira Project   : ${jira.projectKey || '(not configured)'}`);
            console.log(`   UAT URL        : ${environments.UAT.baseUrl || '(not configured)'}`);
            console.log('═'.repeat(70));
        },
    });
}

// ─── Framework Inventory ────────────────────────────────────────────────────

/**
 * Introspect framework files and extract exported classes, methods, locators.
 * This makes the system *introspective* — agents can discover what actually
 * exists in the codebase rather than relying on hardcoded markdown references.
 *
 * @param {Object} projectPathsObj - Resolved project paths (from resolveProjectPaths)
 * @returns {Object} inventory — { pageObjects, businessFunctions, utilities, testDataExports, popupHandlers }
 */
function getFrameworkInventory(projectPathsObj) {
    const inventory = {
        pageObjects: [],
        businessFunctions: [],
        utilities: [],
        testDataExports: [],
        popupHandlers: [],
    };

    const projectRoot = projectPathsObj.projectRoot;

    // ── Helper: extract exported members from a JS file ──
    function extractExports(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath, '.js');
            const result = {
                file: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
                fileName,
                content: null, // raw content — only stored for small files
                className: null,
                methods: [],
                locators: [],
                exports: [],
            };

            // Detect class name: class Foo { ... } or class Foo extends ...
            const classMatch = content.match(/class\s+(\w+)\s*(?:extends\s+\w+\s*)?\{/);
            if (classMatch) {
                result.className = classMatch[1];
            }

            // Extract async methods: async methodName(
            const asyncMethods = [...content.matchAll(/async\s+(\w+)\s*\(/g)];
            for (const m of asyncMethods) {
                if (m[1] !== 'constructor') result.methods.push(m[1]);
            }

            // Extract non-async prototype-style methods:  methodName( ) { or methodName = (
            const syncMethods = [...content.matchAll(/^\s+(\w+)\s*\([^)]*\)\s*\{/gm)];
            for (const m of syncMethods) {
                if (!['constructor', 'if', 'for', 'while', 'switch', 'catch', 'try'].includes(m[1]) &&
                    !result.methods.includes(m[1])) {
                    result.methods.push(m[1]);
                }
            }

            // Extract locator properties: this.someName = page.locator(...) / page.getByRole(...)
            const locatorPatterns = [
                /this\.(\w+)\s*=\s*(?:this\.)?page\.(locator|getByRole|getByText|getByTestId|getByLabel|getByPlaceholder|getByAltText)\s*\(/g,
            ];
            for (const pattern of locatorPatterns) {
                const matches = [...content.matchAll(pattern)];
                for (const m of matches) {
                    if (!result.locators.includes(m[1])) {
                        result.locators.push(m[1]);
                    }
                }
            }

            // Extract module.exports keys: module.exports = { a, b, c } or module.exports = ClassName
            const namedExports = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
            if (namedExports) {
                result.exports = namedExports[1].split(',').map(e => e.trim().split(':')[0].trim()).filter(Boolean);
            }
            const defaultExport = content.match(/module\.exports\s*=\s*(\w+)\s*;/);
            if (defaultExport) {
                result.exports.push(defaultExport[1]);
            }

            // Store raw content only for files < 5KB (useful for small configs/utilities)
            if (content.length < 5120) {
                result.content = content;
            }

            return result;
        } catch {
            return null;
        }
    }

    // ── Helper: scan a directory for .js files ──
    function scanDir(dirRelative) {
        const absDir = path.resolve(projectRoot, dirRelative);
        if (!fs.existsSync(absDir)) return [];
        try {
            return fs.readdirSync(absDir)
                .filter(f => f.endsWith('.js') && !f.endsWith('.spec.js') && !f.endsWith('.test.js'))
                .map(f => path.join(absDir, f));
        } catch {
            return [];
        }
    }

    // ── Scan page objects ──
    const poFiles = scanDir(projectPathsObj.pageObjectsDir);
    for (const f of poFiles) {
        const info = extractExports(f);
        if (info) inventory.pageObjects.push(info);
    }

    // ── Scan business functions ──
    const bfFiles = scanDir(projectPathsObj.businessFunctionsDir);
    for (const f of bfFiles) {
        const info = extractExports(f);
        if (info) inventory.businessFunctions.push(info);
    }

    // ── Scan utilities ──
    const utilFiles = scanDir(projectPathsObj.utilsDir);
    for (const f of utilFiles) {
        const info = extractExports(f);
        if (info) {
            inventory.utilities.push(info);
            // Detect popup handlers specifically
            if (info.className && /popup|modal|handler/i.test(info.className)) {
                inventory.popupHandlers.push(info);
            } else if (info.methods.some(m => /dismiss|popup|modal|close.*popup/i.test(m))) {
                inventory.popupHandlers.push(info);
            }
        }
    }

    // ── Extract test data exports ──
    const testDataPath = path.resolve(projectRoot, projectPathsObj.testDataFile);
    if (fs.existsSync(testDataPath)) {
        const tdInfo = extractExports(testDataPath);
        if (tdInfo) {
            inventory.testDataExports = tdInfo.exports;
        }
    }

    return inventory;
}

/**
 * Get a formatted summary string of the framework inventory
 * suitable for injecting into agent prompts or logs.
 */
function getInventorySummary(inventory) {
    const lines = [];
    lines.push('═══ Framework Inventory ═══');

    if (inventory.pageObjects.length > 0) {
        lines.push(`\n📦 Page Objects (${inventory.pageObjects.length} files):`);
        for (const po of inventory.pageObjects) {
            lines.push(`  • ${po.fileName}${po.className ? ` [class ${po.className}]` : ''}`);
            if (po.methods.length > 0) lines.push(`    Methods: ${po.methods.join(', ')}`);
            if (po.locators.length > 0) lines.push(`    Locators: ${po.locators.join(', ')}`);
        }
    }

    if (inventory.businessFunctions.length > 0) {
        lines.push(`\n📋 Business Functions (${inventory.businessFunctions.length} files):`);
        for (const bf of inventory.businessFunctions) {
            lines.push(`  • ${bf.fileName}${bf.className ? ` [class ${bf.className}]` : ''}`);
            if (bf.methods.length > 0) lines.push(`    Methods: ${bf.methods.join(', ')}`);
        }
    }

    if (inventory.utilities.length > 0) {
        lines.push(`\n🔧 Utilities (${inventory.utilities.length} files):`);
        for (const u of inventory.utilities) {
            lines.push(`  • ${u.fileName}${u.className ? ` [class ${u.className}]` : ''}`);
            if (u.methods.length > 0) lines.push(`    Methods: ${u.methods.join(', ')}`);
        }
    }

    if (inventory.popupHandlers.length > 0) {
        lines.push(`\n🛡️ Popup Handlers (${inventory.popupHandlers.length} detected):`);
        for (const ph of inventory.popupHandlers) {
            lines.push(`  • ${ph.fileName}: ${ph.methods.join(', ')}`);
        }
    }

    if (inventory.testDataExports.length > 0) {
        lines.push(`\n📊 Test Data Exports: ${inventory.testDataExports.join(', ')}`);
    }

    return lines.join('\n');
}

// ─── Singleton ──────────────────────────────────────────────────────────────
// Compute once, reuse everywhere.

let _resolved = null;
let _inventory = null;

function getProjectPaths() {
    if (!_resolved) {
        _resolved = resolveProjectPaths();
    }
    return _resolved;
}

/**
 * Get the framework inventory (cached singleton).
 * Scans page objects, business functions, utilities, and test data
 * to discover what's actually available in the codebase.
 */
function getFrameworkInventoryCache() {
    if (!_inventory) {
        const pp = getProjectPaths();
        _inventory = getFrameworkInventory(pp);
    }
    return _inventory;
}

/** Force re-resolution (useful after .env changes during setup) */
function resetProjectPaths() {
    _resolved = null;
    _inventory = null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    getProjectPaths,
    resetProjectPaths,
    detectFrameworkMode,
    resolveProjectPaths,
    getFrameworkInventory,
    getFrameworkInventoryCache,
    getInventorySummary,
};
