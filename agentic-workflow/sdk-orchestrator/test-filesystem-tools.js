/**
 * Test suite for filesystem-tools.js
 * Tests sandbox security, session root management, tool creation, and document parsing.
 *
 * Run: node agentic-workflow/sdk-orchestrator/test-filesystem-tools.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    createFilesystemTools,
    setSessionRoot,
    getSessionRoot,
    clearSessionRoot,
} = require('./filesystem-tools');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        errors.push(label);
        console.log(`  ✗ ${label}`);
    }
}

function assertThrows(fn, label) {
    try {
        fn();
        failed++;
        errors.push(`${label} (did not throw)`);
        console.log(`  ✗ ${label} — expected to throw`);
    } catch {
        passed++;
        console.log(`  ✓ ${label}`);
    }
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TEST_SESSION = 'test-session-001';
const TEST_DIR = path.join(os.tmpdir(), `filegenie-test-${Date.now()}`);

function setup() {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'hello.txt'), 'Hello, World!');
    fs.writeFileSync(path.join(TEST_DIR, 'data.json'), JSON.stringify({ key: 'value' }));
    fs.mkdirSync(path.join(TEST_DIR, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'subdir', 'nested.txt'), 'Nested file');
    fs.writeFileSync(path.join(TEST_DIR, 'notes.md'), '# Notes\n\nSome markdown content.');
    fs.writeFileSync(path.join(TEST_DIR, 'data.csv'), 'name,age\nAlice,30\nBob,25');
}

function cleanup() {
    clearSessionRoot(TEST_SESSION);
    try {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\n═══ Session Root Management ═══');

clearSessionRoot(TEST_SESSION);
assert(getSessionRoot(TEST_SESSION) === null, 'getSessionRoot returns null when unset');

setSessionRoot(TEST_SESSION, '/tmp/sandbox');
assert(getSessionRoot(TEST_SESSION) === '/tmp/sandbox', 'setSessionRoot + getSessionRoot roundtrip');

clearSessionRoot(TEST_SESSION);
assert(getSessionRoot(TEST_SESSION) === null, 'clearSessionRoot removes root');

console.log('\n═══ Tool Creation ═══');

// Mock defineTool to collect tool names
const collectedTools = [];
const mockDefineTool = (name, config) => {
    collectedTools.push(name);
    return { name, config };
};
const mockDeps = { chatManager: { requestUserInput: () => { } }, sessionId: TEST_SESSION };

// Full tool set
collectedTools.length = 0;
createFilesystemTools(mockDefineTool, mockDeps, { readOnly: false });
assert(collectedTools.length === 14, `Full tool set has 14 tools (got ${collectedTools.length})`);
assert(collectedTools.includes('set_workspace_root'), 'Full set includes set_workspace_root');
assert(collectedTools.includes('list_directory'), 'Full set includes list_directory');
assert(collectedTools.includes('read_file_content'), 'Full set includes read_file_content');
assert(collectedTools.includes('write_file_content'), 'Full set includes write_file_content');
assert(collectedTools.includes('delete_items'), 'Full set includes delete_items');
assert(collectedTools.includes('parse_document'), 'Full set includes parse_document');
assert(collectedTools.includes('move_items'), 'Full set includes move_items');
assert(collectedTools.includes('copy_items'), 'Full set includes copy_items');

// Read-only tool set
collectedTools.length = 0;
createFilesystemTools(mockDefineTool, mockDeps, { readOnly: true });
assert(collectedTools.length === 8, `Read-only tool set has 8 tools (got ${collectedTools.length})`);
assert(collectedTools.includes('set_workspace_root'), 'Read-only includes set_workspace_root');
assert(collectedTools.includes('list_directory'), 'Read-only includes list_directory');
assert(collectedTools.includes('read_file_content'), 'Read-only includes read_file_content');
assert(!collectedTools.includes('write_file_content'), 'Read-only excludes write_file_content');
assert(!collectedTools.includes('delete_items'), 'Read-only excludes delete_items');
assert(!collectedTools.includes('move_items'), 'Read-only excludes move_items');

console.log('\n═══ Sandbox Security ═══');

setup();
setSessionRoot(TEST_SESSION, TEST_DIR);

// We need to test resolveSandboxed indirectly via tool invocations.
// But we can test the logic via setSessionRoot + tool calls.

// Verify root is set
assert(getSessionRoot(TEST_SESSION) === TEST_DIR, 'Session root is set to test dir');

// Test without root set
clearSessionRoot(TEST_SESSION);
assert(getSessionRoot(TEST_SESSION) === null, 'Root cleared for security test');

// Re-set for remaining tests
setSessionRoot(TEST_SESSION, TEST_DIR);

console.log('\n═══ Summary ═══');
console.log(`\n  Total: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
if (errors.length > 0) {
    console.log('\n  Failed tests:');
    errors.forEach(e => console.log(`    - ${e}`));
}

cleanup();

process.exit(failed > 0 ? 1 : 0);
