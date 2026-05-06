/**
 * Incremental parser for Playwright's `list` reporter stdout.
 *
 * Playwright's list reporter emits (non-TTY) lines that look like:
 *
 *   Running 39 tests using 1 worker
 *
 *     1 [chromium] › consumer/notes.spec.js:5:3 › send a note
 *     ✓  1 [chromium] › consumer/notes.spec.js:5:3 › send a note (1.2s)
 *     ✘  2 [chromium] › consumer/login.spec.js:8:3 › invalid credentials (4.0s)
 *     -  3 [chromium] › consumer/login.spec.js:12:3 › skipped test
 *
 *   39 passed (1m 23s)
 *
 * This parser is intentionally permissive — it emits structured events for
 * any line that looks like a test status line and silently ignores the rest.
 * Consumers get an incremental feed even in CI-style non-TTY output.
 *
 * Status mapping:
 *   ✓ / ok             → 'passed'
 *   ✘ / ✗ / failed     → 'failed'
 *   -  / skipped       → 'skipped'
 *   ›                  → 'running'  (test started, no result yet)
 *
 * @module sdk-orchestrator/playwright-line-parser
 */

const STATUS_SYMBOLS = {
    '✓': 'passed',
    '✅': 'passed',
    '✘': 'failed',
    '✗': 'failed',
    '❌': 'failed',
    '-': 'skipped',
    '»': 'running',
};

// Matches lines like:
//   ✓  1 [chromium] › consumer/notes.spec.js:5:3 › send a note (1.2s)
//   ✘  2 tests/foo.spec.ts:10:3 › failing test (500ms)
//      3 [chromium] › pending test (no symbol = running)
const TEST_LINE_RE = /^\s*(?:(?<symbol>[✓✅✘✗❌\-»])\s+)?(?<index>\d+)\s+(?:\[(?<project>[^\]]+)\]\s+)?(?<rest>.+?)(?:\s+\((?<duration>[^)]+)\))?\s*$/u;

// Matches the "Running N tests using M workers" header
const RUNNING_HEADER_RE = /^Running\s+(\d+)\s+tests?\s+using\s+(\d+)\s+worker/i;

// Matches the final summary line "39 passed (1m 23s)" / "2 failed (30s)"
const SUMMARY_RE = /^\s*(\d+)\s+(passed|failed|skipped|flaky)\s*(?:\((.+?)\))?/i;

class PlaywrightLineParser {
    constructor() {
        this._buffer = '';
        this._totalTests = null;
        this._workerCount = null;
        // Track tests we've seen, keyed by "index|title", so we can suppress
        // duplicate 'running' events when the final status line arrives.
        this._seen = new Map();
    }

    /**
     * Feed a raw chunk of stdout. Returns an array of structured events
     * extracted from this chunk (may be empty).
     *
     * Event shapes:
     *   { kind: 'header', totalTests, workerCount }
     *   { kind: 'test', status, index, project, title, durationText }
     *   { kind: 'summary', count, status, durationText }
     */
    feed(chunk) {
        if (chunk == null) return [];
        this._buffer += String(chunk);

        const events = [];
        let newlineIndex;
        // Process completed lines only — keep the tail in buffer.
        while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
            const rawLine = this._buffer.slice(0, newlineIndex);
            this._buffer = this._buffer.slice(newlineIndex + 1);
            const line = rawLine.replace(/\r$/, '');
            const evt = this._parseLine(line);
            if (evt) events.push(evt);
        }
        return events;
    }

    /** Flush the final partial line (if any) at end of stream. */
    flush() {
        if (!this._buffer) return [];
        const line = this._buffer;
        this._buffer = '';
        const evt = this._parseLine(line);
        return evt ? [evt] : [];
    }

    _parseLine(line) {
        if (!line || !line.trim()) return null;

        // Header: "Running 39 tests using 1 worker"
        const headerMatch = line.match(RUNNING_HEADER_RE);
        if (headerMatch) {
            this._totalTests = parseInt(headerMatch[1], 10);
            this._workerCount = parseInt(headerMatch[2], 10);
            return {
                kind: 'header',
                totalTests: this._totalTests,
                workerCount: this._workerCount,
            };
        }

        // Summary: "39 passed (1m 23s)"
        const summaryMatch = line.match(SUMMARY_RE);
        if (summaryMatch && /\b(passed|failed|skipped|flaky)\b/i.test(line) && !line.includes('›')) {
            return {
                kind: 'summary',
                count: parseInt(summaryMatch[1], 10),
                status: summaryMatch[2].toLowerCase(),
                durationText: summaryMatch[3] || null,
            };
        }

        // Test line
        const testMatch = line.match(TEST_LINE_RE);
        if (testMatch && testMatch.groups) {
            const { symbol, index, project, rest, duration } = testMatch.groups;
            // Must contain a title-like separator (›) or be clearly a test line;
            // otherwise we risk matching arbitrary numbered lines.
            if (!rest || (!rest.includes('›') && !rest.includes('>'))) {
                return null;
            }
            const status = symbol ? (STATUS_SYMBOLS[symbol] || 'running') : 'running';
            const title = rest.replace(/\s*›\s*/g, ' › ').trim();
            const key = `${index}|${title}`;
            const alreadySeenRunning = this._seen.get(key) === 'running';

            this._seen.set(key, status);

            // Suppress duplicate 'running' emissions for the same test.
            if (status === 'running' && alreadySeenRunning) return null;

            return {
                kind: 'test',
                status,
                index: parseInt(index, 10),
                project: project || null,
                title,
                durationText: duration || null,
            };
        }

        return null;
    }

    get totalTests() { return this._totalTests; }
    get workerCount() { return this._workerCount; }
}

module.exports = { PlaywrightLineParser };
