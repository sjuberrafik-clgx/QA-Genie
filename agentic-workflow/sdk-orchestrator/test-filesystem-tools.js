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
const SECOND_TEST_SESSION = 'test-session-002';
const ALT_TEST_DIR = path.join(os.tmpdir(), `filegenie-test-alt-${Date.now()}`);

function setup() {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(ALT_TEST_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'hello.txt'), 'Hello, World!');
    fs.writeFileSync(path.join(TEST_DIR, 'data.json'), JSON.stringify({ key: 'value' }));
    fs.mkdirSync(path.join(TEST_DIR, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'subdir', 'nested.txt'), 'Nested file');
    fs.writeFileSync(path.join(TEST_DIR, 'notes.md'), '# Notes\n\nSome markdown content.');
    fs.writeFileSync(path.join(TEST_DIR, 'data.csv'), 'name,age\nAlice,30\nBob,25');

    fs.writeFileSync(path.join(ALT_TEST_DIR, 'alt.txt'), 'Alternate root');
}

function cleanup() {
    clearSessionRoot(TEST_SESSION);
    clearSessionRoot(SECOND_TEST_SESSION);
    clearSessionRoot('default');
    try {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
    try {
        fs.rmSync(ALT_TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
}

function getToolConfig(tools, name) {
    const tool = tools.find(entry => entry.name === name);
    return tool?.config;
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
assert(collectedTools.length === 16, `Full tool set has 16 tools (got ${collectedTools.length})`);
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
assert(collectedTools.length === 10, `Read-only tool set has 10 tools (got ${collectedTools.length})`);
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

console.log('\n═══ Session-Scoped Tool Resolution ═══');

const liveSessionContext = { sessionId: null };
const liveSessionDeps = {
    chatManager: { requestUserInput: () => { } },
    sessionContext: liveSessionContext,
    getSessionId: () => liveSessionContext.sessionId,
};
const liveTools = createFilesystemTools(mockDefineTool, liveSessionDeps, { readOnly: false });
const setWorkspaceRootTool = getToolConfig(liveTools, 'set_workspace_root');
const listDirectoryTool = getToolConfig(liveTools, 'list_directory');

liveSessionContext.sessionId = TEST_SESSION;
clearSessionRoot(TEST_SESSION);
clearSessionRoot('default');

(async () => {
    const setRootResult = JSON.parse(await setWorkspaceRootTool.handler({ path: TEST_DIR }));
    assert(setRootResult.success, 'set_workspace_root succeeds with live session context');
    assert(getSessionRoot(TEST_SESSION) === TEST_DIR, 'set_workspace_root stores root under the active session');
    assert(getSessionRoot('default') === null, 'set_workspace_root does not fall back to default when session context is available');

    const listResult = JSON.parse(await listDirectoryTool.handler({ path: '.' }));
    assert(listResult.success, 'list_directory succeeds with a session-scoped root');
    assert(listResult.entries.some(entry => entry.path === 'hello.txt'), 'list_directory reads from the active session root');

    const secondSessionContext = { sessionId: SECOND_TEST_SESSION };
    const secondTools = createFilesystemTools(mockDefineTool, {
        chatManager: { requestUserInput: () => { } },
        sessionContext: secondSessionContext,
        getSessionId: () => secondSessionContext.sessionId,
    }, { readOnly: false });
    const secondSetRootTool = getToolConfig(secondTools, 'set_workspace_root');
    const secondListTool = getToolConfig(secondTools, 'list_directory');

    const secondSetRootResult = JSON.parse(await secondSetRootTool.handler({ path: ALT_TEST_DIR }));
    assert(secondSetRootResult.success, 'set_workspace_root succeeds for a second session');
    assert(getSessionRoot(SECOND_TEST_SESSION) === ALT_TEST_DIR, 'second session stores its own workspace root');
    assert(getSessionRoot(TEST_SESSION) === TEST_DIR, 'first session root is preserved when a second session sets its root');

    const secondListResult = JSON.parse(await secondListTool.handler({ path: '.' }));
    assert(secondListResult.success, 'list_directory succeeds for the second session');
    assert(secondListResult.entries.some(entry => entry.path === 'alt.txt'), 'second session resolves files from its own root');
    assert(!secondListResult.entries.some(entry => entry.path === 'hello.txt'), 'second session does not inherit the first session root');

    console.log('\n═══ Summary ═══');
    console.log(`\n  Total: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
    if (errors.length > 0) {
        console.log('\n  Failed tests:');
        errors.forEach(e => console.log(`    - ${e}`));
    }

    cleanup();

    process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
    failed++;
    errors.push(error.message);
    console.error(error);
    cleanup();
    process.exit(1);
});
