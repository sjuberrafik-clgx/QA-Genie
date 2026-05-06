/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OUTPUT PARSER — Multi-Framework Test Output Parser Registry
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Wraps framework-specific output parsers behind a uniform interface so
 * execute_test can stream per-test events regardless of which test runner
 * produced the output.
 *
 * Each parser exposes:
 *   feed(chunk)  → Event[]     (incremental line-by-line parsing)
 *   flush()      → Event[]     (drain buffered lines)
 *   getResults() → { total, passed, failed, skipped, failedTests }
 *
 * Events follow the same shape used by PlaywrightLineParser:
 *   { kind: 'header', totalTests, workerCount }
 *   { kind: 'test', status, index, project, title, durationText }
 *   { kind: 'summary', count, status, durationText }
 *
 * @module sdk-orchestrator/output-parser
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Base class ──────────────────────────────────────────────────────────────

class BaseOutputParser {
    constructor() {
        this._total = 0;
        this._passed = 0;
        this._failed = 0;
        this._skipped = 0;
        this._failedTests = [];
    }

    /** Feed a raw stdout/stderr chunk. Returns structured events. */
    feed(/* chunk */) { return []; }

    /** Flush any buffered content. Returns final events. */
    flush() { return []; }

    /** Get aggregated results after parsing is complete. */
    getResults() {
        return {
            total: this._total,
            passed: this._passed,
            failed: this._failed,
            skipped: this._skipped,
            failedTests: [...this._failedTests],
        };
    }
}

// ─── Playwright parser (wraps existing PlaywrightLineParser) ─────────────────

class PlaywrightOutputParser extends BaseOutputParser {
    constructor() {
        super();
        const { PlaywrightLineParser } = require('./playwright-line-parser');
        this._inner = new PlaywrightLineParser();
    }

    feed(chunk) {
        const events = this._inner.feed(chunk);
        this._trackEvents(events);
        return events;
    }

    flush() {
        const events = this._inner.flush();
        this._trackEvents(events);
        return events;
    }

    _trackEvents(events) {
        for (const evt of events) {
            if (evt.kind === 'header') {
                this._total = evt.totalTests || 0;
            } else if (evt.kind === 'test' && evt.status !== 'running') {
                if (evt.status === 'passed') this._passed++;
                else if (evt.status === 'failed') {
                    this._failed++;
                    this._failedTests.push(evt.title || `test-${this._failed}`);
                }
                else if (evt.status === 'skipped') this._skipped++;
            }
        }
    }
}

// ─── WebDriverIO spec-reporter parser ────────────────────────────────────────
//
// WebDriverIO's spec reporter output looks like:
//
//   [chrome 120.0.6099.109 linux #0-0] » /test/specs/login.e2e.js
//   [chrome 120.0.6099.109 linux #0-0] Login Page
//   [chrome 120.0.6099.109 linux #0-0]    ✓ should login with valid credentials (2456ms)
//   [chrome 120.0.6099.109 linux #0-0]    ✗ should deny invalid password
//   ...
//   Spec Files:      1 passed, 1 failed, 2 total (100% completed) in 00:00:15
//   ...

class WdioOutputParser extends BaseOutputParser {
    constructor() {
        super();
        this._buffer = '';
        this._testIndex = 0;
        this._currentProject = null;
    }

    feed(chunk) {
        if (chunk == null) return [];
        this._buffer += String(chunk);
        const events = [];
        let newlineIdx;
        while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
            const line = this._buffer.slice(0, newlineIdx).replace(/\r$/, '');
            this._buffer = this._buffer.slice(newlineIdx + 1);
            const evt = this._parseLine(line);
            if (evt) events.push(evt);
        }
        return events;
    }

    flush() {
        if (!this._buffer) return [];
        const evt = this._parseLine(this._buffer);
        this._buffer = '';
        return evt ? [evt] : [];
    }

    _parseLine(line) {
        if (!line || !line.trim()) return null;

        // Detect browser context: [chrome 120... #0-0]
        const ctxMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
        const content = ctxMatch ? ctxMatch[2] : line.trim();
        if (ctxMatch && !this._currentProject) {
            this._currentProject = ctxMatch[1].split(/\s+/)[0]; // e.g. "chrome"
        }

        // Passed test: ✓ should do something (123ms)
        const passedMatch = content.match(/^\s*[✓✅]\s+(.+?)(?:\s+\((\d+(?:\.\d+)?(?:ms|s|m))\))?\s*$/);
        if (passedMatch) {
            this._testIndex++;
            this._passed++;
            this._total++;
            return {
                kind: 'test',
                status: 'passed',
                index: this._testIndex,
                project: this._currentProject,
                title: passedMatch[1].trim(),
                durationText: passedMatch[2] || null,
            };
        }

        // Failed test: ✗ should deny invalid password
        const failedMatch = content.match(/^\s*[✗✘❌]\s+(.+?)(?:\s+\((\d+(?:\.\d+)?(?:ms|s|m))\))?\s*$/);
        if (failedMatch) {
            this._testIndex++;
            this._failed++;
            this._total++;
            const title = failedMatch[1].trim();
            this._failedTests.push(title);
            return {
                kind: 'test',
                status: 'failed',
                index: this._testIndex,
                project: this._currentProject,
                title,
                durationText: failedMatch[2] || null,
            };
        }

        // Skipped test: - should be skipped
        const skippedMatch = content.match(/^\s*-\s+(.+)$/);
        if (skippedMatch && !content.includes('Spec Files') && !content.includes('passing') && !content.includes('failing')) {
            this._testIndex++;
            this._skipped++;
            this._total++;
            return {
                kind: 'test',
                status: 'skipped',
                index: this._testIndex,
                project: this._currentProject,
                title: skippedMatch[1].trim(),
                durationText: null,
            };
        }

        // Summary line: Spec Files: 1 passed, 1 failed, 2 total
        const summaryMatch = line.match(/Spec Files:\s*(\d+)\s+passed.*?(\d+)\s+total/i);
        if (summaryMatch) {
            return {
                kind: 'summary',
                count: parseInt(summaryMatch[1], 10),
                status: 'passed',
                durationText: null,
            };
        }

        return null;
    }
}

// ─── Generic / Exit-Code based parser (fallback for unknown frameworks) ──────
//
// For frameworks we don't have a specific parser for, we do our best:
// - Parse "N passing", "N failing", "N pending" patterns (common in Mocha/Jest)
// - Track ✓/✗ symbols in output
// - Ultimately, the exit code determines pass/fail

class GenericOutputParser extends BaseOutputParser {
    constructor() {
        super();
        this._buffer = '';
        this._testIndex = 0;
    }

    feed(chunk) {
        if (chunk == null) return [];
        this._buffer += String(chunk);
        const events = [];
        let newlineIdx;
        while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
            const line = this._buffer.slice(0, newlineIdx).replace(/\r$/, '');
            this._buffer = this._buffer.slice(newlineIdx + 1);
            const evt = this._parseLine(line);
            if (evt) events.push(evt);
        }
        return events;
    }

    flush() {
        if (!this._buffer) return [];
        const evt = this._parseLine(this._buffer);
        this._buffer = '';
        return evt ? [evt] : [];
    }

    _parseLine(line) {
        if (!line || !line.trim()) return null;
        const trimmed = line.trim();

        // "N passing (Xms)" — Mocha/Jest style
        const passingMatch = trimmed.match(/^(\d+)\s+passing(?:\s+\((.+?)\))?/i);
        if (passingMatch) {
            const count = parseInt(passingMatch[1], 10);
            this._passed = count;
            this._total = Math.max(this._total, this._passed + this._failed + this._skipped);
            return { kind: 'summary', count, status: 'passed', durationText: passingMatch[2] || null };
        }

        // "N failing"
        const failingMatch = trimmed.match(/^(\d+)\s+failing/i);
        if (failingMatch) {
            const count = parseInt(failingMatch[1], 10);
            this._failed = count;
            this._total = Math.max(this._total, this._passed + this._failed + this._skipped);
            return { kind: 'summary', count, status: 'failed', durationText: null };
        }

        // "N pending" / "N skipped"
        const pendingMatch = trimmed.match(/^(\d+)\s+(?:pending|skipped)/i);
        if (pendingMatch) {
            this._skipped = parseInt(pendingMatch[1], 10);
            this._total = Math.max(this._total, this._passed + this._failed + this._skipped);
            return { kind: 'summary', count: this._skipped, status: 'skipped', durationText: null };
        }

        // Individual test: ✓ / ✗ prefixed lines
        const passLine = trimmed.match(/^[✓✅]\s+(.+?)(?:\s+\((.+?)\))?\s*$/);
        if (passLine) {
            this._testIndex++;
            this._passed++;
            this._total++;
            return {
                kind: 'test', status: 'passed', index: this._testIndex,
                project: null, title: passLine[1].trim(), durationText: passLine[2] || null,
            };
        }

        const failLine = trimmed.match(/^[✗✘❌]\s+(.+?)(?:\s+\((.+?)\))?\s*$/);
        if (failLine) {
            this._testIndex++;
            this._failed++;
            this._total++;
            const title = failLine[1].trim();
            this._failedTests.push(title);
            return {
                kind: 'test', status: 'failed', index: this._testIndex,
                project: null, title, durationText: failLine[2] || null,
            };
        }

        // Jest-style: "Tests: N passed, N failed, N total"
        const jestSummary = trimmed.match(/^Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(\d+)\s+total/i);
        if (jestSummary) {
            this._passed = parseInt(jestSummary[1] || '0', 10);
            this._failed = parseInt(jestSummary[2] || '0', 10);
            this._total = parseInt(jestSummary[3], 10);
            this._skipped = this._total - this._passed - this._failed;
            return { kind: 'summary', count: this._total, status: this._failed > 0 ? 'failed' : 'passed', durationText: null };
        }

        // "Test Suites: N passed, N failed, N total" (Jest)
        const jestSuiteSummary = trimmed.match(/^Test Suites:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(\d+)\s+total/i);
        if (jestSuiteSummary) {
            return { kind: 'summary', count: parseInt(jestSuiteSummary[3], 10), status: 'passed', durationText: null };
        }

        return null;
    }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Get the appropriate output parser for a framework.
 * @param {string} framework - 'playwright' | 'webdriverio' | 'cypress' | 'jest' | 'mocha' | 'vitest' | 'unknown'
 * @returns {BaseOutputParser}
 */
function getParserForFramework(framework) {
    switch (framework) {
        case 'playwright':
            return new PlaywrightOutputParser();
        case 'webdriverio':
            return new WdioOutputParser();
        case 'jest':
        case 'mocha':
        case 'vitest':
        case 'cypress':
        default:
            return new GenericOutputParser();
    }
}

/**
 * Parse structured JSON results from different frameworks.
 * Each framework produces different JSON shapes — this normalizes them.
 *
 * @param {object} jsonResult - Parsed JSON from test runner output
 * @param {string} framework - Framework name
 * @returns {{ totalSpecs: number, passed: number, failed: number, failedTests: string[], runnerErrors: string[] }}
 */
function parseJsonResults(jsonResult, framework) {
    if (!jsonResult) {
        return { totalSpecs: 0, passed: 0, failed: 0, failedTests: [], runnerErrors: [] };
    }

    switch (framework) {
        case 'playwright':
            return _parsePlaywrightJson(jsonResult);
        case 'jest':
            return _parseJestJson(jsonResult);
        case 'mocha':
            return _parseMochaJson(jsonResult);
        case 'cypress':
            return _parseCypressJson(jsonResult);
        default:
            // Try Playwright format first (most common in this workspace), then Jest
            if (jsonResult.suites) return _parsePlaywrightJson(jsonResult);
            if (jsonResult.testResults) return _parseJestJson(jsonResult);
            if (jsonResult.stats) return _parseMochaJson(jsonResult);
            return { totalSpecs: 0, passed: 0, failed: 0, failedTests: [], runnerErrors: [] };
    }
}

// ─── JSON result parsers ─────────────────────────────────────────────────────

function _parsePlaywrightJson(result) {
    const suites = result.suites || [];
    let totalSpecs = 0, passed = 0, failed = 0;
    const failedTests = [];

    const walkSuites = (list) => {
        for (const suite of list) {
            for (const spec of (suite.specs || [])) {
                totalSpecs++;
                const test = spec.tests?.[0];
                if (test?.status === 'passed' || test?.status === 'expected') {
                    passed++;
                } else if (test?.status === 'failed' || test?.status === 'unexpected') {
                    failed++;
                    failedTests.push(spec.title);
                }
            }
            if (suite.suites) walkSuites(suite.suites);
        }
    };
    walkSuites(suites);

    const runnerErrors = Array.isArray(result.errors)
        ? result.errors.map(e => e?.message || String(e || '')).filter(Boolean)
        : [];

    return { totalSpecs, passed, failed, failedTests, runnerErrors };
}

function _parseJestJson(result) {
    let totalSpecs = 0, passed = 0, failed = 0;
    const failedTests = [];

    if (result.numTotalTests != null) {
        totalSpecs = result.numTotalTests;
        passed = result.numPassedTests || 0;
        failed = result.numFailedTests || 0;
    }

    if (Array.isArray(result.testResults)) {
        for (const suite of result.testResults) {
            for (const test of (suite.testResults || [])) {
                if (test.status === 'failed') {
                    failedTests.push(test.fullName || test.title || 'unknown');
                }
            }
        }
    }

    const runnerErrors = [];
    if (Array.isArray(result.testResults)) {
        for (const suite of result.testResults) {
            if (suite.message) runnerErrors.push(suite.message);
        }
    }

    return { totalSpecs, passed, failed, failedTests, runnerErrors };
}

function _parseMochaJson(result) {
    const stats = result.stats || {};
    const totalSpecs = stats.tests || 0;
    const passed = stats.passes || 0;
    const failed = stats.failures || 0;
    const failedTests = [];

    if (Array.isArray(result.failures)) {
        for (const f of result.failures) {
            failedTests.push(f.fullTitle || f.title || 'unknown');
        }
    }

    const runnerErrors = [];
    return { totalSpecs, passed, failed, failedTests, runnerErrors };
}

function _parseCypressJson(result) {
    let totalSpecs = 0, passed = 0, failed = 0;
    const failedTests = [];

    if (result.stats) {
        totalSpecs = result.stats.tests || 0;
        passed = result.stats.passes || 0;
        failed = result.stats.failures || 0;
    }

    if (Array.isArray(result.results)) {
        for (const suite of result.results) {
            for (const test of (suite.tests || [])) {
                if (test.state === 'failed') {
                    failedTests.push(test.title || 'unknown');
                }
            }
        }
    }

    return { totalSpecs, passed, failed, failedTests, runnerErrors: [] };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    BaseOutputParser,
    PlaywrightOutputParser,
    WdioOutputParser,
    GenericOutputParser,
    getParserForFramework,
    parseJsonResults,
};
