/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FRAMEWORK DETECTOR — Universal Test Framework Detection
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Scans a project directory and detects which test framework(s) it uses,
 * then returns the appropriate command to run tests.
 *
 * Supports: Playwright, WebDriverIO, Cypress, Jest, Mocha, Vitest, Selenium,
 * and any npm-script-based runner as fallback.
 *
 * @module sdk-orchestrator/framework-detector
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Framework config file signatures ────────────────────────────────────────

const FRAMEWORK_CONFIG_PATTERNS = [
    {
        framework: 'playwright',
        configFiles: ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'playwright.config.cjs'],
        packages: ['@playwright/test', 'playwright'],
        scriptKeywords: ['playwright'],
        testFilePatterns: ['.spec.js', '.spec.ts', '.spec.mjs'],
    },
    {
        framework: 'webdriverio',
        configFiles: ['wdio.conf.js', 'wdio.conf.ts', 'wdio.conf.mjs', 'wdio.conf.cjs', 'wdio.conf.local.js'],
        packages: ['webdriverio', '@wdio/cli', '@wdio/local-runner'],
        scriptKeywords: ['wdio', 'webdriverio'],
        testFilePatterns: ['.e2e.js', '.e2e.ts', '.test.js', '.test.ts', '.spec.js', '.spec.ts'],
    },
    {
        framework: 'cypress',
        configFiles: ['cypress.config.js', 'cypress.config.ts', 'cypress.config.mjs', 'cypress.config.cjs', 'cypress.json'],
        packages: ['cypress'],
        scriptKeywords: ['cypress'],
        testFilePatterns: ['.cy.js', '.cy.ts', '.cy.jsx', '.cy.tsx'],
    },
    {
        framework: 'jest',
        configFiles: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'],
        packages: ['jest', '@jest/core'],
        scriptKeywords: ['jest'],
        testFilePatterns: ['.test.js', '.test.ts', '.test.jsx', '.test.tsx', '.spec.js', '.spec.ts'],
    },
    {
        framework: 'vitest',
        configFiles: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vitest.config.cjs'],
        packages: ['vitest'],
        scriptKeywords: ['vitest'],
        testFilePatterns: ['.test.js', '.test.ts', '.spec.js', '.spec.ts'],
    },
    {
        framework: 'mocha',
        configFiles: ['.mocharc.yml', '.mocharc.yaml', '.mocharc.json', '.mocharc.js', '.mocharc.cjs'],
        packages: ['mocha'],
        scriptKeywords: ['mocha'],
        testFilePatterns: ['.test.js', '.test.ts', '.spec.js', '.spec.ts'],
    },
    {
        framework: 'selenium',
        configFiles: [],
        packages: ['selenium-webdriver', 'selenium-standalone'],
        scriptKeywords: ['selenium'],
        testFilePatterns: ['.test.js', '.test.ts', '.spec.js', '.spec.ts'],
    },
];

// ─── Run command templates per framework ─────────────────────────────────────

const RUN_COMMAND_TEMPLATES = {
    playwright: {
        command: 'npx',
        baseArgs: ['playwright', 'test'],
        targetArgStyle: 'positional',      // npx playwright test <target>
        jsonReporter: ['--reporter=list,json'],
        envForJson: (tmpFile) => ({
            PLAYWRIGHT_JSON_OUTPUT_NAME: tmpFile,
            PLAYWRIGHT_JSON_OUTPUT_FILE: tmpFile,
        }),
    },
    webdriverio: {
        command: 'npx',
        baseArgs: ['wdio', 'run'],
        configArg: true,                    // npx wdio run <config> --spec <target>
        targetArgStyle: 'spec-flag',        // --spec <target>
        jsonReporter: [],
        envForJson: () => ({}),
    },
    cypress: {
        command: 'npx',
        baseArgs: ['cypress', 'run'],
        targetArgStyle: 'spec-flag',        // --spec <target>
        jsonReporter: ['--reporter', 'json'],
        envForJson: () => ({}),
    },
    jest: {
        command: 'npx',
        baseArgs: ['jest'],
        targetArgStyle: 'positional',       // npx jest <target>
        jsonReporter: ['--json', '--verbose'],
        envForJson: () => ({}),
    },
    vitest: {
        command: 'npx',
        baseArgs: ['vitest', 'run'],
        targetArgStyle: 'positional',       // npx vitest run <target>
        jsonReporter: ['--reporter=json'],
        envForJson: () => ({}),
    },
    mocha: {
        command: 'npx',
        baseArgs: ['mocha'],
        targetArgStyle: 'positional',       // npx mocha <target>
        jsonReporter: ['--reporter', 'json'],
        envForJson: () => ({}),
    },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect the test framework used in a project directory.
 *
 * @param {string} projectPath - Absolute path to a file or directory in the project
 * @returns {{ framework: string, confidence: string, configFile: string|null, projectRoot: string, packageManager: string, detectedScripts: Array, runTemplate: object|null }}
 */
function detectFramework(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) {
        return _unknownResult(projectPath);
    }

    const projectRoot = findProjectRoot(projectPath);
    if (!projectRoot) {
        return _unknownResult(projectPath);
    }

    const scores = new Map(); // framework → { score, configFile, scripts }

    // Pass 1: Config file detection (highest signal — 50 points)
    for (const pattern of FRAMEWORK_CONFIG_PATTERNS) {
        for (const configFile of pattern.configFiles) {
            const configPath = path.join(projectRoot, configFile);
            if (fs.existsSync(configPath)) {
                _addScore(scores, pattern.framework, 50, configPath, null);
                break; // one config file is enough per framework
            }
        }
    }

    // Pass 2: package.json dependency detection (30 points)
    const pkg = _readPackageJson(projectRoot);
    if (pkg) {
        const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
            ...(pkg.peerDependencies || {}),
        };

        for (const pattern of FRAMEWORK_CONFIG_PATTERNS) {
            for (const pkgName of pattern.packages) {
                if (allDeps[pkgName]) {
                    _addScore(scores, pattern.framework, 30, null, null);
                    break;
                }
            }
        }

        // Pass 3: npm script keyword detection (20 points)
        if (pkg.scripts && typeof pkg.scripts === 'object') {
            const scriptEntries = Object.entries(pkg.scripts);
            for (const pattern of FRAMEWORK_CONFIG_PATTERNS) {
                for (const [scriptName, scriptBody] of scriptEntries) {
                    const bodyLower = (scriptBody || '').toLowerCase();
                    const nameLower = scriptName.toLowerCase();
                    for (const keyword of pattern.scriptKeywords) {
                        if (bodyLower.includes(keyword) || nameLower.includes(keyword)) {
                            _addScore(scores, pattern.framework, 20, null, { name: scriptName, body: scriptBody });
                            break;
                        }
                    }
                }
            }
        }
    }

    // Determine winner
    let bestFramework = 'unknown';
    let bestScore = 0;
    let bestConfigFile = null;
    let bestScripts = [];

    for (const [fw, data] of scores.entries()) {
        if (data.score > bestScore) {
            bestScore = data.score;
            bestFramework = fw;
            bestConfigFile = data.configFile;
            bestScripts = data.scripts;
        }
    }

    const confidence = bestScore >= 50 ? 'high' : bestScore >= 30 ? 'medium' : 'low';
    const packageManager = detectPackageManager(projectRoot);

    return {
        framework: bestFramework,
        confidence,
        configFile: bestConfigFile,
        projectRoot,
        packageManager,
        detectedScripts: bestScripts,
        runTemplate: RUN_COMMAND_TEMPLATES[bestFramework] || null,
    };
}

/**
 * Walk up from a candidate path to find the nearest project root
 * (directory containing package.json, or a recognized test framework config).
 *
 * Unlike the old _findPlaywrightProjectRoot, this accepts ANY project —
 * not just Playwright projects.
 *
 * @param {string} candidatePath - Absolute path (file or directory)
 * @returns {string|null} - Project root path or null
 */
function findProjectRoot(candidatePath) {
    if (!candidatePath || !fs.existsSync(candidatePath)) return null;

    let currentPath;
    try {
        const stats = fs.statSync(candidatePath);
        currentPath = stats.isDirectory() ? candidatePath : path.dirname(candidatePath);
    } catch {
        return null;
    }

    // Collect all known config file names across all frameworks
    const allConfigFiles = new Set();
    for (const pattern of FRAMEWORK_CONFIG_PATTERNS) {
        for (const cf of pattern.configFiles) {
            allConfigFiles.add(cf);
        }
    }

    let packageJsonFallback = null;

    while (true) {
        // Check for any framework config file
        for (const configFile of allConfigFiles) {
            if (fs.existsSync(path.join(currentPath, configFile))) {
                return currentPath;
            }
        }

        // package.json is a weaker signal but valid
        if (!packageJsonFallback && fs.existsSync(path.join(currentPath, 'package.json'))) {
            packageJsonFallback = currentPath;
        }

        const parent = path.dirname(currentPath);
        if (parent === currentPath) break;
        currentPath = parent;
    }

    return packageJsonFallback;
}

/**
 * Build the full command + args to run tests for a detected framework.
 *
 * @param {object} detection - Result from detectFramework()
 * @param {string} target - Relative path to spec file or folder
 * @param {object} [options] - Additional options
 * @param {boolean} [options.json] - Include JSON reporter args
 * @param {string} [options.jsonOutputFile] - Temp file for JSON output (Playwright)
 * @returns {{ command: string, args: string[], env: object, strategy: string }}
 */
function buildRunCommand(detection, target, options = {}) {
    const { framework, configFile, projectRoot, detectedScripts } = detection;
    const template = RUN_COMMAND_TEMPLATES[framework];
    const isWindows = process.platform === 'win32';

    // Strategy 1: matching npm script (any framework)
    const matchingScript = _findMatchingScript(detectedScripts, projectRoot, target);
    if (matchingScript) {
        const npmCmd = isWindows ? 'npm.cmd' : 'npm';
        return {
            command: npmCmd,
            args: ['run', matchingScript.name, '--'],
            env: {},
            strategy: `npm-script:${matchingScript.name}`,
        };
    }

    // Strategy 2: local binary
    if (template) {
        const localBin = _resolveLocalBinary(projectRoot, template.baseArgs[0]);
        if (localBin) {
            const args = [...template.baseArgs.slice(1)];
            _appendTarget(args, template, target, configFile, projectRoot);
            if (options.json && template.jsonReporter) {
                args.push(...template.jsonReporter);
            }
            const env = options.json && options.jsonOutputFile && template.envForJson
                ? template.envForJson(options.jsonOutputFile)
                : {};
            return {
                command: localBin,
                args,
                env,
                strategy: 'local-binary',
            };
        }
    }

    // Strategy 3: npx (fallback)
    if (template) {
        const npxCmd = isWindows ? 'npx.cmd' : 'npx';
        const args = [...template.baseArgs];
        _appendTarget(args, template, target, configFile, projectRoot);
        if (options.json && template.jsonReporter) {
            args.push(...template.jsonReporter);
        }
        const env = options.json && options.jsonOutputFile && template.envForJson
            ? template.envForJson(options.jsonOutputFile)
            : {};
        return {
            command: npxCmd,
            args,
            env,
            strategy: 'npx',
        };
    }

    // Strategy 4: unknown framework — try npm test or npx with target
    const npxCmd = isWindows ? 'npx.cmd' : 'npx';
    return {
        command: npxCmd,
        args: ['--', target],
        env: {},
        strategy: 'npx-passthrough',
    };
}

/**
 * Detect which package manager a project uses.
 * @param {string} projectRoot
 * @returns {'npm'|'yarn'|'pnpm'}
 */
function detectPackageManager(projectRoot) {
    if (!projectRoot) return 'npm';
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
    return 'npm';
}

/**
 * Count test files matching known patterns in a directory (recursive).
 * Unlike the old _countSpecFiles, this finds files for ANY framework.
 *
 * @param {string} dir - Directory to scan
 * @param {string} [framework] - If specified, only count files matching that framework's patterns
 * @returns {number}
 */
function countTestFiles(dir, framework) {
    const extensions = new Set();
    if (framework) {
        const pattern = FRAMEWORK_CONFIG_PATTERNS.find(p => p.framework === framework);
        if (pattern) pattern.testFilePatterns.forEach(e => extensions.add(e));
    } else {
        // All known test file patterns
        for (const pattern of FRAMEWORK_CONFIG_PATTERNS) {
            pattern.testFilePatterns.forEach(e => extensions.add(e));
        }
    }

    let count = 0;
    function walk(d, depth) {
        if (depth > 5 || !fs.existsSync(d)) return;
        try {
            const entries = fs.readdirSync(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                const entryPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    walk(entryPath, depth + 1);
                } else if (entry.isFile()) {
                    for (const ext of extensions) {
                        if (entry.name.endsWith(ext)) {
                            count++;
                            break;
                        }
                    }
                }
            }
        } catch { /* ignore */ }
    }
    walk(dir, 0);
    return count;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _unknownResult(projectPath) {
    return {
        framework: 'unknown',
        confidence: 'low',
        configFile: null,
        projectRoot: projectPath || null,
        packageManager: 'npm',
        detectedScripts: [],
        runTemplate: null,
    };
}

function _addScore(scores, framework, points, configFile, script) {
    if (!scores.has(framework)) {
        scores.set(framework, { score: 0, configFile: null, scripts: [] });
    }
    const data = scores.get(framework);
    data.score += points;
    if (configFile) data.configFile = configFile;
    if (script) data.scripts.push(script);
}

function _readPackageJson(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
        return null;
    }
}

function _resolveLocalBinary(projectRoot, binaryName) {
    if (!projectRoot || !binaryName) return null;
    const binDir = path.join(projectRoot, 'node_modules', '.bin');
    const candidates = process.platform === 'win32'
        ? [`${binaryName}.cmd`, `${binaryName}.CMD`, binaryName]
        : [binaryName];
    for (const name of candidates) {
        const full = path.join(binDir, name);
        try {
            if (fs.existsSync(full)) return full;
        } catch { /* ignore */ }
    }
    return null;
}

function _findMatchingScript(detectedScripts, projectRoot, target) {
    if (!Array.isArray(detectedScripts) || detectedScripts.length === 0) return null;
    if (!target) return null;

    const targetBase = path.basename(target).toLowerCase();
    for (const script of detectedScripts) {
        const bodyLower = (script.body || '').toLowerCase();
        if (bodyLower.includes(targetBase)) {
            return script;
        }
    }
    return null;
}

function _appendTarget(args, template, target, configFile, projectRoot) {
    if (!target) return;

    if (template.configArg && configFile) {
        // WebDriverIO style: npx wdio run <config> --spec <target>
        const relConfig = path.relative(projectRoot, configFile).replace(/\\/g, '/');
        // Only add config if not already in args
        if (!args.includes(relConfig)) {
            args.push(relConfig);
        }
    }

    if (template.targetArgStyle === 'positional') {
        args.push(target);
    } else if (template.targetArgStyle === 'spec-flag') {
        args.push('--spec', target);
    }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    detectFramework,
    findProjectRoot,
    buildRunCommand,
    detectPackageManager,
    countTestFiles,
    FRAMEWORK_CONFIG_PATTERNS,
    RUN_COMMAND_TEMPLATES,
};
