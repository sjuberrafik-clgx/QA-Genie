#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ORCHESTRATOR — Integration Test Suite
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Comprehensive test of all SDK components using the real @github/copilot-sdk.
 * Tests each module independently and then runs an end-to-end simulation.
 *
 * Usage: node sdk-orchestrator/integration-test.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    return { name, fn };
}

async function runTest(t) {
    try {
        await t.fn();
        passed++;
        results.push({ name: t.name, status: '✅ PASS' });
        console.log(`  ✅ ${t.name}`);
    } catch (error) {
        failed++;
        results.push({ name: t.name, status: '❌ FAIL', error: error.message });
        console.log(`  ❌ ${t.name}: ${error.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ─── Test Definitions ───────────────────────────────────────────────────────

const tests = [

    test('ADF converter: combined bold and code falls back to code-only', async () => {
        const { parseInlineMarks, markdownToAdf } = require('./adf-converter');

        const nodes = parseInlineMarks('Event **`Building Details - Click on Map Thumbnail`** fired');
        const codeNode = nodes.find(node => Array.isArray(node.marks) && node.marks.some(mark => mark.type === 'code'));

        assert(codeNode, 'Expected code-marked node');
        assertEqual(codeNode.marks.map(mark => mark.type).join(','), 'code', 'Expected bold+code input to degrade to code-only');

        const adf = markdownToAdf('**Description :-**\n1. Observe **`Building Details - Click on Map Thumbnail`** in Mixpanel.');
        const hasInvalidMarkCombo = (value) => {
            if (Array.isArray(value)) return value.some(hasInvalidMarkCombo);
            if (!value || typeof value !== 'object') return false;
            if (value.type === 'text') {
                const marks = Array.isArray(value.marks) ? value.marks.map(mark => mark.type) : [];
                return marks.includes('strong') && marks.includes('code');
            }
            return Object.values(value).some(hasInvalidMarkCombo);
        };

        assert(!hasInvalidMarkCombo(adf), 'Expected Jira-safe ADF without strong+code combinations');
    }),

    test('ADF converter: semantic observation markers become Jira panels', async () => {
        const { normalizeSemanticCallouts, markdownToAdf } = require('./adf-converter');

        const normalized = normalizeSemanticCallouts('Observation summary:\nMatrix opens under the standard shell instead of full-screen details.');
        assert(normalized.includes('> [!CAUTION]'), 'Expected semantic observation content to normalize into a caution alert');

        const adf = markdownToAdf('Observation summary:\nMatrix opens under the standard shell instead of full-screen details.');
        const panelNode = (adf.content || []).find(node => node.type === 'panel');

        assert(panelNode, 'Expected an ADF panel node');
        assertEqual(panelNode.attrs?.panelType, 'error', 'Expected observation content to render as an error panel');
        assert(JSON.stringify(panelNode).includes('Observation summary'), 'Expected the observation label to remain visible inside the panel');
    }),

    test('ADF converter: semantic observation markers become wiki panels for media comments', async () => {
        const { markdownToWikiMarkup } = require('./adf-converter');

        const wiki = markdownToWikiMarkup('Observation: Property preview opens in the regular app shell.');

        assert(wiki.includes('{panel:title=Observation'), 'Expected semantic observation content to render as a wiki panel');
        assert(wiki.includes('Property preview opens in the regular app shell.'), 'Expected panel body to preserve the observation message');
    }),

    // ── ADF Mention Node Tests ──────────────────────────────────────
    test('ADF converter: parseInlineMarks produces mention nodes from structured syntax', async () => {
        const { parseInlineMarks } = require('./adf-converter');

        const nodes = parseInlineMarks('CC: @[Daniel Ramirez](accountId:5e1234567890abcdef) and @[Olga Yolkina](accountId:abc987654321)');

        const mentionNodes = nodes.filter(n => n.type === 'mention');
        assertEqual(mentionNodes.length, 2, 'Expected 2 mention nodes');

        assertEqual(mentionNodes[0].attrs.id, '5e1234567890abcdef', 'First mention accountId');
        assertEqual(mentionNodes[0].attrs.text, '@Daniel Ramirez', 'First mention display text');
        assertEqual(mentionNodes[0].attrs.accessLevel, '', 'First mention accessLevel should be empty string');

        assertEqual(mentionNodes[1].attrs.id, 'abc987654321', 'Second mention accountId');
        assertEqual(mentionNodes[1].attrs.text, '@Olga Yolkina', 'Second mention display text');
    }),

    test('ADF converter: mentions coexist with bold, code, and plain text', async () => {
        const { parseInlineMarks } = require('./adf-converter');

        const nodes = parseInlineMarks('**Important:** @[Daniel Ramirez](accountId:abc123) please review `config.js`');

        const types = nodes.map(n => n.type);
        assert(types.includes('mention'), 'Expected a mention node');
        assert(types.includes('text'), 'Expected text nodes');

        const boldNode = nodes.find(n => Array.isArray(n.marks) && n.marks.some(m => m.type === 'strong'));
        assert(boldNode, 'Expected a bold text node');

        const codeNode = nodes.find(n => Array.isArray(n.marks) && n.marks.some(m => m.type === 'code'));
        assert(codeNode, 'Expected a code text node');
    }),

    test('ADF converter: markdownToAdf embeds mention nodes in paragraphs', async () => {
        const { markdownToAdf } = require('./adf-converter');

        const adf = markdownToAdf('Hello @[Daniel Ramirez](accountId:5e123abc)\n\nSecond paragraph');

        assert(adf.type === 'doc', 'Expected doc node');
        assert(adf.version === 1, 'Expected version 1');
        assert(adf.content.length >= 1, 'Expected at least 1 content node');

        // Find the mention node anywhere in the ADF tree
        const findMentions = (node) => {
            if (node.type === 'mention') return [node];
            if (Array.isArray(node.content)) return node.content.flatMap(findMentions);
            return [];
        };
        const mentions = adf.content.flatMap(findMentions);
        assertEqual(mentions.length, 1, 'Expected 1 mention node in ADF');
        assertEqual(mentions[0].attrs.id, '5e123abc', 'Mention accountId in ADF');
    }),

    test('ADF converter: injectMentionSyntax replaces @Name with structured syntax', async () => {
        const { injectMentionSyntax } = require('./adf-converter');

        const text = 'CC: @Daniel Ramirez, @Olga Yolkina';
        const mentions = [
            { accountId: 'acc-daniel', displayName: 'Daniel Ramirez' },
            { accountId: 'acc-olga', displayName: 'Olga Yolkina' },
        ];
        const result = injectMentionSyntax(text, mentions);

        assert(result.includes('@[Daniel Ramirez](accountId:acc-daniel)'), 'Expected Daniel mention syntax');
        assert(result.includes('@[Olga Yolkina](accountId:acc-olga)'), 'Expected Olga mention syntax');
        assert(!result.includes('@Daniel Ramirez,'), 'Plain @Daniel should be replaced');
    }),

    test('ADF converter: injectMentionSyntax skips already-structured mentions', async () => {
        const { injectMentionSyntax } = require('./adf-converter');

        const text = 'CC: @[Daniel Ramirez](accountId:acc-daniel)';
        const mentions = [{ accountId: 'acc-daniel', displayName: 'Daniel Ramirez' }];
        const result = injectMentionSyntax(text, mentions);

        // Should not double-wrap: count occurrences of accountId
        const count = (result.match(/accountId:acc-daniel/g) || []).length;
        assertEqual(count, 1, 'Should not double-wrap already structured mentions');
    }),

    test('ADF converter: injectMentionSyntax handles empty/null gracefully', async () => {
        const { injectMentionSyntax } = require('./adf-converter');

        assertEqual(injectMentionSyntax('', []), '', 'Empty text returns empty');
        assertEqual(injectMentionSyntax('hello', null), 'hello', 'Null mentions returns text unchanged');
        assertEqual(injectMentionSyntax('hello', []), 'hello', 'Empty mentions returns text unchanged');
        assertEqual(injectMentionSyntax(null, [{ accountId: 'x', displayName: 'Y' }]), '', 'Null text returns empty');
    }),

    test('ADF converter: end-to-end mention pipeline produces valid ADF', async () => {
        const { markdownToAdf, injectMentionSyntax } = require('./adf-converter');

        const markdown = '**Status Update**\n\nCC: @Daniel Ramirez, @Kamal Ghafur\n\nPlease review the changes above.';
        const mentions = [
            { accountId: '5e-daniel-id', displayName: 'Daniel Ramirez' },
            { accountId: '5e-kamal-id', displayName: 'Kamal Ghafur' },
        ];
        const processed = injectMentionSyntax(markdown, mentions);
        const adf = markdownToAdf(processed);

        assert(adf.type === 'doc', 'Valid ADF doc');
        assert(adf.version === 1, 'ADF version 1');

        // Find all mentions in the tree
        const findMentions = (node) => {
            if (node.type === 'mention') return [node];
            if (Array.isArray(node.content)) return node.content.flatMap(findMentions);
            return [];
        };
        const foundMentions = adf.content.flatMap(findMentions);
        assertEqual(foundMentions.length, 2, 'Expected 2 mention nodes');

        const ids = foundMentions.map(m => m.attrs.id).sort();
        assert(ids.includes('5e-daniel-id'), 'Daniel mention present');
        assert(ids.includes('5e-kamal-id'), 'Kamal mention present');

        // Verify no plain @Name text survived
        const allText = JSON.stringify(adf);
        assert(!allText.includes('"@Daniel Ramirez,'), 'No leftover plain @mention text');
    }),

    test('Atlassian URL utils: parses Jira and Confluence URLs', async () => {
        const {
            parseAtlassianUrl,
            normalizeJiraTicketInput,
            normalizeConfluencePageInput,
        } = require('./atlassian-url-utils');

        const jira = parseAtlassianUrl('https://corelogic.atlassian.net/browse/AOTF-16514');
        assertEqual(jira.product, 'jira', 'Expected Jira product');
        assertEqual(jira.issueKey, 'AOTF-16514', 'Expected Jira issue key');
        assertEqual(jira.baseUrl, 'https://corelogic.atlassian.net', 'Expected Jira base URL');

        const confluence = parseAtlassianUrl('https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/Enhanced+Consumer+Funnel+Management+Test+Data+UAT+PROD');
        assertEqual(confluence.product, 'confluence', 'Expected Confluence product');
        assertEqual(confluence.pageId, '189467646', 'Expected Confluence page ID');
        assertEqual(confluence.spaceKey, 'AOTF', 'Expected Confluence space key');

        const normalizedJira = normalizeJiraTicketInput('Please read https://corelogic.atlassian.net/browse/AOTF-16514');
        assertEqual(normalizedJira.ticketId, 'AOTF-16514', 'Expected Jira normalization from URL');

        const normalizedConfluence = normalizeConfluencePageInput('See https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/Enhanced+Consumer+Funnel+Management+Test+Data+UAT+PROD');
        assertEqual(normalizedConfluence.pageId, '189467646', 'Expected Confluence normalization from URL');
    }),

    // ── 1. SDK Dynamic Import ───────────────────────────────────────
    test('SDK loads via dynamic import', async () => {
        const sdk = await import('@github/copilot-sdk');
        assert(sdk.CopilotClient, 'CopilotClient not exported');
        assert(sdk.defineTool, 'defineTool not exported');
        assert(sdk.CopilotSession, 'CopilotSession not exported');
    }),

    // ── 2. CopilotClient Lifecycle ──────────────────────────────────
    test('CopilotClient start and stop', async () => {
        const sdk = await import('@github/copilot-sdk');
        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();
        assert(client, 'Client is null');
        // If we get here, start() worked
        // Stop should not throw
        // Note: client.stop() may not exist as a method — the SDK might use destroy()
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 3. Learning Store CRUD ──────────────────────────────────────
    test('LearningStore: record, query, and persist', async () => {
        const { LearningStore } = require('./learning-store');
        const testStorePath = path.join(__dirname, '..', 'learning-data', 'test-store.json');

        // Clean up any previous test store
        if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

        const ls = new LearningStore(testStorePath);

        // Record failure
        ls.recordFailure({
            ticketId: 'TEST-001',
            page: '/test-page',
            errorType: 'SELECTOR_NOT_FOUND',
            selector: '.old-selector',
            fix: 'getByRole("button")',
            outcome: 'fixed',
            method: 'integration-test',
        });

        // Query by ticket
        const failures = ls.getFailuresForTicket('TEST-001');
        assertEqual(failures.length, 1, 'Expected 1 failure for TEST-001');
        assertEqual(failures[0].errorType, 'SELECTOR_NOT_FOUND');

        // Record stable selector
        ls.recordStableSelector({
            page: '/test-page',
            element: 'submit-btn',
            tried: ['.old-selector', '#old-id'],
            stable: 'getByRole("button", { name: "Submit" })',
            confidence: 0.95,
        });

        const selectors = ls.getStableSelectors('/test-page');
        assertEqual(selectors.length, 1, 'Expected 1 stable selector');
        assertEqual(selectors[0].confidence, 0.95);

        // Record page pattern
        ls.recordPagePattern({
            url: '/test-page',
            popups: ['welcome-modal'],
            commonIssues: ['SELECTOR_NOT_FOUND'],
            avgLoadTime: 2500,
        });

        const pattern = ls.getPagePattern('/test-page');
        assert(pattern, 'Page pattern not found');
        assertEqual(pattern.popups[0], 'welcome-modal');

        // Stats
        const stats = ls.getStats();
        assertEqual(stats.totalFailures, 1);
        assertEqual(stats.totalStableSelectors, 1);
        assertEqual(stats.totalPagePatterns, 1);
        assertEqual(stats.fixRate, 100);

        // Persistence
        ls.save();
        assert(fs.existsSync(testStorePath), 'Store file not saved');

        // Re-load from disk
        const ls2 = new LearningStore(testStorePath);
        assertEqual(ls2.getStats().totalFailures, 1, 'Persisted data not loaded');

        // Clean up
        fs.unlinkSync(testStorePath);
    }),

    // ── 4. Enforcement Hooks ────────────────────────────────────────
    test('Enforcement: MCP-first rule blocks spec creation', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { verbose: false });

        // Attempt to create .spec.js before navigation
        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            { sessionId: 'test-session-1' }
        );
        assertEqual(result.permissionDecision, 'deny', 'Should deny spec before navigate');
    }),

    test('Enforcement: allows spec after required exploration steps', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { verbose: false });

        // Navigate
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_navigate', toolArgs: { url: 'http://test.com' } },
            { sessionId: 'test-session-2' }
        );

        // Snapshot
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_snapshot', toolArgs: {} },
            { sessionId: 'test-session-2' }
        );

        // Semantic selector validation
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_by_role', toolArgs: { role: 'button', name: 'Search' } },
            { sessionId: 'test-session-2' }
        );

        // Content extraction
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_text_content', toolArgs: { selector: 'body' } },
            { sessionId: 'test-session-2' }
        );

        // URL state verification
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_page_url', toolArgs: {} },
            { sessionId: 'test-session-2' }
        );

        // Framework inventory discovery
        await hooks.onPreToolUse(
            { toolName: 'get_framework_inventory', toolArgs: {} },
            { sessionId: 'test-session-2' }
        );

        // Now spec creation should be allowed
        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            { sessionId: 'test-session-2' }
        );
        assert(
            !result.permissionDecision || result.permissionDecision === 'allow',
            `Expected allow, got ${result?.permissionDecision}`
        );
    }),

    test('Enforcement: blocks spec when a visited page lacks evidence', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', { verbose: false });
        const inv = { sessionId: 'test-session-2b' };

        // Page 1 gets full evidence
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_navigate', toolArgs: { url: 'http://test.com/page-1' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_snapshot', toolArgs: {} },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_by_role', toolArgs: { role: 'button', name: 'Search' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_text_content', toolArgs: { selector: 'body' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_page_url', toolArgs: {} },
            inv
        );

        // Page 2 gets selector evidence only
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_navigate', toolArgs: { url: 'http://test.com/page-2' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_by_role', toolArgs: { role: 'button', name: 'Apply' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'get_framework_inventory', toolArgs: {} },
            inv
        );

        const denied = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            inv
        );
        assertEqual(denied.permissionDecision, 'deny', 'Should deny when per-page evidence is incomplete');
        assert((denied.additionalContext || '').includes('page-2'), 'Denial should identify the uncovered page');

        // Finish missing evidence on page 2
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_text_content', toolArgs: { selector: 'body' } },
            inv
        );
        await hooks.onPreToolUse(
            { toolName: 'mcp_unified-autom_unified_get_page_url', toolArgs: {} },
            inv
        );

        const allowed = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'tests/test.spec.js' } },
            inv
        );
        assert(
            !allowed.permissionDecision || allowed.permissionDecision === 'allow',
            `Expected allow after full per-page evidence, got ${allowed?.permissionDecision}`
        );
    }),

    test('Enforcement: non-scriptgenerator agents are not blocked', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('testgenie', { verbose: false });

        const result = await hooks.onPreToolUse(
            { toolName: 'create_file', toolArgs: { filePath: 'test-cases/test.xlsx' } },
            { sessionId: 'test-session-3' }
        );
        assert(
            !result.permissionDecision || result.permissionDecision === 'allow',
            'TestGenie should not be blocked by MCP-first rule'
        );
    }),

    test('Enforcement: all 5 hook types created', async () => {
        const { createEnforcementHooks } = require('./enforcement-hooks');
        const hooks = createEnforcementHooks('scriptgenerator', {});
        const expected = ['onPreToolUse', 'onPostToolUse', 'onErrorOccurred', 'onSessionStart', 'onSessionEnd'];
        for (const h of expected) {
            assert(typeof hooks[h] === 'function', `Missing hook: ${h}`);
        }
    }),

    // ── 5. Custom Tools with Real SDK ───────────────────────────────
    test('Custom tools: defineTool creates valid tool objects', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});
        assert(tools.length >= 7, `Expected ≥7 tools for scriptgenerator, got ${tools.length}`);

        // Check tool names
        const names = tools.map(t => t.name);
        assert(names.includes('get_framework_inventory'), 'Missing get_framework_inventory');
        assert(names.includes('validate_generated_script'), 'Missing validate_generated_script');
        assert(names.includes('save_exploration_data'), 'Missing save_exploration_data');
    }),

    test('Custom tools: role-based filtering works', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sgTools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});
        const bgTools = createCustomTools(sdk.defineTool, 'buggenie', {});

        const sgNames = sgTools.map(t => t.name);
        const bgNames = bgTools.map(t => t.name);

        assert(sgNames.includes('save_exploration_data'), 'scriptgenerator should have save_exploration_data');
        assert(sgNames.includes('validate_generated_script'), 'scriptgenerator should have validate_generated_script');
        assert(bgNames.includes('get_test_results'), 'buggenie should have get_test_results');
        assert(bgNames.includes('transition_jira_ticket'), 'buggenie should have transition_jira_ticket');
        assert(bgNames.includes('delete_jira_ticket'), 'buggenie should have delete_jira_ticket');
        assert(!bgNames.includes('save_exploration_data'), 'buggenie should NOT have save_exploration_data');
        assert(!bgNames.includes('validate_generated_script'), 'buggenie should NOT have validate_generated_script');
    }),

    test('Custom tools: get_framework_inventory returns real data', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');
        const tools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});

        const inventoryTool = tools.find(t => t.name === 'get_framework_inventory');
        assert(inventoryTool, 'get_framework_inventory tool not found');
        assert(typeof inventoryTool.handler === 'function', 'Tool missing handler');

        const result = await inventoryTool.handler({ includeLocators: false });
        assert(typeof result === 'string', 'Expected string result');
        assert(result.includes('Framework Inventory'), 'Expected Framework Inventory header');
        assert(result.includes('POmanager') || result.includes('Utilities'), 'Expected framework content');
    }),

    test('Custom tools: save_exploration_data enforces per-snapshot semantic depth', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');
        const tools = createCustomTools(sdk.defineTool, 'scriptgenerator', {});

        const saveTool = tools.find(t => t.name === 'save_exploration_data');
        assert(saveTool, 'save_exploration_data tool not found');

        const weakPayload = {
            source: 'mcp-live-snapshot',
            ticketId: 'TEST-SEMDEPTH',
            snapshots: [
                {
                    url: 'http://test.com/page-1',
                    elements: [
                        { name: 'single-card', text: 'Only element', ref: 's1e1' },
                    ],
                },
            ],
            selectorCount: 1,
            pagesVisited: ['http://test.com/page-1'],
            popupsDetected: [],
        };

        const result = JSON.parse(await saveTool.handler({
            ticketId: 'TEST-SEMDEPTH',
            explorationData: JSON.stringify(weakPayload),
        }));

        assertEqual(result.saved, false, 'Weak snapshots should fail semantic depth validation');
        const validationErrors = Array.isArray(result.validationErrors) ? result.validationErrors : [];
        assert(
            validationErrors.some(msg => String(msg).includes('semantic depth failure')),
            'Expected semantic depth failure in validation errors'
        );
    }),

    // ── 6. Agent Session Factory ────────────────────────────────────
    test('SessionFactory: loads agent prompts from .agent.md files', async () => {
        // Test the internal loadAgentPrompt function via the module
        const agentDir = path.join(__dirname, '..', '..', '.github', 'agents');
        const agents = ['testgenie', 'scriptgenerator', 'buggenie', 'codereviewer'];

        for (const agent of agents) {
            const agentFile = path.join(agentDir, `${agent}.agent.md`);
            assert(fs.existsSync(agentFile), `Agent file missing: ${agent}.agent.md`);
        }
    }),

    test('SessionFactory: creates session with real SDK', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { AgentSessionFactory } = require('./agent-sessions');
        const { LearningStore } = require('./learning-store');

        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();

        const factory = new AgentSessionFactory({
            client,
            defineTool: sdk.defineTool,
            model: 'claude-sonnet-4-20250514',
            config: {},
            learningStore: new LearningStore(),
            verbose: false,
        });

        // Create a testgenie session
        const { session, sessionId, agentName } = await factory.createAgentSession('testgenie', {
            ticketContext: 'Integration test context',
        });

        assert(session, 'Session not created');
        assert(sessionId, 'Missing sessionId');
        assertEqual(agentName, 'testgenie');

        // Cleanup
        await factory.destroySession(sessionId);
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 7. Pipeline Runner Mechanics ────────────────────────────────
    test('Pipeline: preflight checks pass', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        // Run just preflight
        const ctx = { ticketId: 'TEST-001', mode: 'full', startTime: Date.now(), stageResults: {} };
        const result = await runner._runPreflight(ctx);
        assertEqual(result.success, true, `Preflight should pass, got: ${result.message}`);
        assert(result.checks.length >= 4, 'Expected at least 4 preflight checks');
    }),

    test('Pipeline: quality gate validates missing artifact', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        const ctx = { ticketId: 'TEST-001', specPath: null };
        const result = await runner._runQualityGate('script', ctx);
        assertEqual(result.success, false, 'Script QG should fail with null specPath');
    }),

    test('Pipeline: report generation creates JSON file', async () => {
        const { PipelineRunner } = require('./pipeline-runner');
        const runner = new PipelineRunner({
            sessionFactory: null,
            selfHealing: null,
            config: {},
            verbose: false,
        });

        const ctx = {
            ticketId: 'TEST-REPORT',
            mode: 'execute',
            startTime: Date.now(),
            stageResults: { 'execute': { success: true, message: 'ok' } },
            testResults: { passed: true, totalCount: 5, failedCount: 0 },
            specPath: null,
            testCasesPath: null,
            explorationPath: null,
            healingResult: null,
        };

        const result = await runner._generateReport(ctx);
        assertEqual(result.success, true, 'Report generation should succeed');
        assert(result.reportPath, 'Report path missing');
        assert(fs.existsSync(result.reportPath), 'Report file not created');

        // Verify report content
        const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
        assertEqual(report.ticketId, 'TEST-REPORT');
        assertEqual(report.mode, 'execute');
        assert(report.testResults.passed, 'Test results should show passed');

        // Clean up
        fs.unlinkSync(result.reportPath);
    }),

    // ── 8. SDKOrchestrator Full Lifecycle ───────────────────────────
    test('SDKOrchestrator: full start/stop lifecycle', async () => {
        const { SDKOrchestrator } = require('./index');
        const orch = new SDKOrchestrator({ verbose: false });

        await orch.start();

        // Verify all components initialized
        assert(orch.isRunning, 'Should be running');
        assert(orch.client, 'Client missing');
        assert(orch.sessionFactory, 'SessionFactory missing');
        assert(orch.selfHealing, 'SelfHealing missing');
        assert(orch.pipelineRunner, 'PipelineRunner missing');
        assert(orch.learningStore, 'LearningStore missing');

        // Verify config loaded
        assertEqual(orch.options.model, 'claude-sonnet-4', 'Model should be from config');
        assertEqual(orch.options.maxHealingIterations, 3, 'Max healing should be 3');

        await orch.stop();
        assertEqual(orch.isRunning, false, 'Should stop cleanly');
    }),

    // ── 9. CLI Dry Run ──────────────────────────────────────────────
    test('CLI: dry-run produces correct plan output', async () => {
        const { execSync } = require('child_process');
        const cliPath = path.join(__dirname, 'cli.js');

        const output = execSync(
            `node "${cliPath}" --ticket TEST-CLI --mode heal --dry-run`,
            { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
        );

        assert(output.includes('DRY RUN'), 'Should show DRY RUN');
        assert(output.includes('TEST-CLI'), 'Should include ticket');
        assert(output.includes('heal'), 'Should include mode');
    }),

    // ── 10. Config Loading with BOM Handling ────────────────────────
    test('Config loads despite BOM character', async () => {
        const { SDKOrchestrator } = require('./index');
        const orch = new SDKOrchestrator({});

        // Config should be loaded (our BOM fix works)
        assert(Object.keys(orch.config).length > 0, 'Config is empty');
        assert(orch.config.sdk, 'SDK config section missing');
        assert(orch.config.pipeline, 'Pipeline config section missing');
    }),

    // ── 11. Pipeline Mode Stage Mapping ─────────────────────────────
    test('Pipeline: mode-stage mapping is correct', async () => {
        const { MODE_STAGES, STAGES } = require('./pipeline-runner');

        assertEqual(MODE_STAGES.full.length, 10, 'Full mode should have 10 stages');
        assertEqual(MODE_STAGES.heal.length, 3, 'Heal mode should have 3 stages');
        assertEqual(MODE_STAGES.execute.length, 2, 'Execute mode should have 2 stages');

        assert(MODE_STAGES.full[0] === STAGES.PREFLIGHT, 'Full starts with preflight');
        assert(MODE_STAGES.full[MODE_STAGES.full.length - 1] === STAGES.REPORT, 'Full ends with report');
        assert(MODE_STAGES.generate.includes(STAGES.QG_EXPLORATION), 'Generate includes exploration quality gate');
        assert(MODE_STAGES.heal.includes(STAGES.SELF_HEAL), 'Heal includes healing');
    }),

    // ── 12. Session Config: Permission & Input Handlers ─────────────
    test('SessionConfig: includes onPermissionRequest handler', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { AgentSessionFactory } = require('./agent-sessions');

        const client = new sdk.CopilotClient({ autoStart: true, autoRestart: false });
        await client.start();

        const factory = new AgentSessionFactory({
            client,
            defineTool: sdk.defineTool,
            model: 'claude-sonnet-4-20250514',
            config: {},
            verbose: false,
        });

        // Verify session creates successfully (proves config is valid)
        const { session, sessionId } = await factory.createAgentSession('testgenie', {});
        assert(session, 'Session with permission handler should create');

        await factory.destroySession(sessionId);
        if (typeof client.stop === 'function') await client.stop();
        else if (typeof client.destroy === 'function') await client.destroy();
    }),

    // ── 13. TestGenie Custom Tools ──────────────────────────────────
    test('Custom tools: testgenie has fetch_jira_ticket and generate_test_case_excel', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const names = tools.map(t => t.name);

        assert(names.includes('fetch_jira_ticket'), 'testgenie should have fetch_jira_ticket');
        assert(names.includes('get_jira_epic'), 'testgenie should have get_jira_epic');
        assert(names.includes('search_jira_epics'), 'testgenie should have search_jira_epics');
        assert(names.includes('get_jira_epic_issues'), 'testgenie should have get_jira_epic_issues');
        assert(names.includes('generate_test_case_excel'), 'testgenie should have generate_test_case_excel');
        assert(tools.length >= 3, `Expected ≥3 tools for testgenie, got ${tools.length}`);
    }),

    test('Custom tools: testgenie exposes KB tools when grounding is enabled', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const confluenceProvider = {
            getProviderType: () => 'confluence',
            search: async () => [],
            listSpaces: async () => [],
            getPageTree: async () => [],
        };

        const groundingStore = {
            queryForAgent: () => [],
            queryKnowledgeBase: async () => ({ results: [], fromCache: false, intent: null }),
            getFeatureContext: () => null,
            getDomainContext: () => ({ features: [] }),
            checkExistingCoverage: () => ({ existingSpecs: [], totalSpecs: 0, coverage: 'none' }),
            _kbConnector: {
                getPage: async () => ({ id: '1', title: 'Test Page', content: 'content' }),
                getPageTree: async () => [],
                getProviderByType: (type) => (type === 'confluence' ? confluenceProvider : null),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'testgenie', { groundingStore });
        const names = tools.map(t => t.name);

        assert(names.includes('search_knowledge_base'), 'testgenie should expose search_knowledge_base when grounding is enabled');
        assert(names.includes('get_knowledge_base_page'), 'testgenie should expose get_knowledge_base_page when KB connector is initialized');
        assert(names.includes('search_confluence_content'), 'testgenie should expose search_confluence_content when Confluence provider is available');
        assert(names.includes('get_confluence_page_details'), 'testgenie should expose get_confluence_page_details when Confluence provider is available');
        assert(names.includes('list_confluence_spaces'), 'testgenie should expose list_confluence_spaces when Confluence provider is available');
        assert(names.includes('list_confluence_pages_in_space'), 'testgenie should expose list_confluence_pages_in_space when Confluence provider is available');
        assert(names.includes('get_confluence_page_tree'), 'testgenie should expose get_confluence_page_tree when Confluence provider is available');
    }),

    test('Custom tools: sparse-ticket scorer flags weak Jira tickets', async () => {
        const { computeSparseTicketScore } = require('./custom-tools');

        const sparse = computeSparseTicketScore({
            summary: 'Search filters',
            description: 'Need update.',
            acceptanceCriteria: '',
            labels: [],
            components: [],
        });

        const rich = computeSparseTicketScore({
            summary: 'Search filters should persist on returning from property details',
            description: 'Authenticated consumer applies city, price, beds, and baths filters on search results, opens a listing, returns to results, and expects all selected filters and result counts to persist without reset.',
            acceptanceCriteria: '- Apply filters for city, price, beds, and baths\n- Open a property detail page\n- Return to search results\n- Verify filters persist and results remain scoped\n- Verify no reset occurs',
            labels: ['search', 'consumer'],
            components: ['Search'],
        });

        assert(sparse.isSparse, 'Weak ticket should be marked sparse');
        assert(sparse.score >= sparse.threshold, 'Sparse ticket score should cross threshold');
        assert(!rich.isSparse, 'Detailed ticket should not be marked sparse');
        assert(rich.score < rich.threshold, 'Detailed ticket should stay below threshold');
    }),

    test('Custom tools: sparse-ticket scorer uses rich comments as context', async () => {
        const { computeSparseTicketScore } = require('./custom-tools');

        const commentRich = computeSparseTicketScore({
            summary: 'Search filters should persist when returning from listing details',
            description: 'Need update.',
            acceptanceCriteria: '- Persist selected filters\n- Return to the same scoped results',
            labels: [],
            components: [],
            comments: [{
                body: 'Given an authenticated consumer using sample listing `12345678`, apply city, price, beds, and baths filters, open the property details page, return to results, and verify the filtered result count and selected chips remain unchanged.',
            }],
        });

        assert(!commentRich.isSparse, 'Comment-rich ticket should not be marked sparse');
        assert(commentRich.metrics.commentLength > 100, 'Expected comment length to contribute to sparse scoring');
        assert(commentRich.metrics.commentStructuredClauses >= 1, 'Expected structured comment content to be tracked');
    }),

    test('Custom tools: fetch_jira_ticket forces KB enrichment for sparse tickets', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const groundingStore = {
            queryKnowledgeBase: async (query) => ({
                results: [{
                    id: 'kb-1',
                    title: 'Search Filter Requirements',
                    url: 'https://kb.example/search-filter-requirements',
                    space: 'QA',
                    lastModified: '2026-03-10T00:00:00.000Z',
                    excerpt: `Excerpt for ${query}`,
                }],
                fromCache: false,
                intent: null,
            }),
            _kbConnector: {
                getPage: async () => ({
                    id: 'kb-1',
                    title: 'Search Filter Requirements',
                    url: 'https://kb.example/search-filter-requirements',
                    space: 'QA',
                    content: 'Detailed KB content for persistent search filter behavior.',
                }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'testgenie', { groundingStore });
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                key: 'AOTF-999',
                fields: {
                    summary: 'Search filters',
                    description: 'Need update.',
                    issuetype: { name: 'Story' },
                    priority: { name: 'Medium' },
                    labels: [],
                    components: [],
                },
                renderedFields: {
                    description: '<p>Need update.</p>',
                },
            }),
        });

        try {
            const result = await jiraTool.handler({ ticketId: 'AOTF-999' });
            const parsed = JSON.parse(result);

            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assert(parsed.sparseAssessment?.isSparse, 'Sparse assessment should mark ticket as sparse');
            assert(parsed.kbAutoEnrichment?.forcedByLogic, 'KB enrichment should be forced by sparse-ticket logic');
            assert((parsed.kbAutoEnrichment?.matches || []).length > 0, 'KB enrichment should attach KB matches');
            assert(parsed.kbAutoEnrichment?.topPage?.title === 'Search Filter Requirements', 'Top KB page should be included');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    // ── 13b. BugGenie Custom Tools include fetch_jira_ticket ────────
    test('Custom tools: buggenie has fetch_jira_ticket and create_jira_ticket', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'buggenie', {});
        const names = tools.map(t => t.name);

        assert(names.includes('fetch_jira_ticket'), 'buggenie should have fetch_jira_ticket (for reading existing tickets)');
        assert(names.includes('get_jira_epic'), 'buggenie should have get_jira_epic');
        assert(names.includes('search_jira_epics'), 'buggenie should have search_jira_epics');
        assert(names.includes('get_jira_epic_issues'), 'buggenie should have get_jira_epic_issues');
        assert(names.includes('create_jira_ticket'), 'buggenie should have create_jira_ticket');
        assert(names.includes('get_test_results'), 'buggenie should have get_test_results');
        assert(tools.length >= 4, `Expected ≥4 tools for buggenie, got ${tools.length}`);
    }),

    test('Custom tools: create_jira_ticket sends environment as plain text', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-create-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'buggenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const payload = JSON.parse(options.body);
            assertEqual(payload.fields.environment, 'PROD', 'Expected environment to be forwarded as plain text');
            assertEqual(payload.fields.description.type, 'doc', 'Expected description to remain an ADF document');
            return {
                ok: true,
                status: 201,
                json: async () => ({ key: 'AOTF-999', id: '999' }),
            };
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                summary: 'Duplicate map thumbnail event',
                description: '**Description :-** Duplicate Mixpanel event on map thumbnail click.',
                environment: 'PROD',
            }));

            assertEqual(parsed.success, true, 'Expected Jira create success');
            assertEqual(parsed.ticketKey, 'AOTF-999', 'Expected created ticket key');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket omits labels unless the user explicitly asks for them', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-create-no-label-intent';
        const deps = {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[sessionId, {
                    messages: [{ role: 'user', content: 'Create a testing task for AOTF-200.' }],
                }]]),
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const payload = JSON.parse(options.body);
            assertEqual(payload.fields.labels, undefined, 'Expected labels to be omitted when the user did not request them');
            return {
                ok: true,
                status: 201,
                json: async () => ({ key: 'AOTF-1000', id: '1000' }),
            };
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                issueType: 'Task',
                summary: 'Testing - AOTF-200',
                description: 'Create a testing task without default labels.',
                labels: 'qa,testing',
            }));

            assertEqual(parsed.success, true, 'Expected Jira create success');
            assertEqual(parsed.ticketKey, 'AOTF-1000', 'Expected created ticket key');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket preserves labels when the user explicitly requests them', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-create-label-intent';
        const deps = {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[sessionId, {
                    messages: [{ role: 'user', content: 'Create a testing task for AOTF-200 and add labels qa, testing.' }],
                }]]),
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const payload = JSON.parse(options.body);
            assertEqual(payload.fields.labels.join(','), 'qa,testing', 'Expected explicitly requested labels to be preserved');
            return {
                ok: true,
                status: 201,
                json: async () => ({ key: 'AOTF-1001', id: '1001' }),
            };
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                issueType: 'Task',
                summary: 'Testing - AOTF-200',
                description: 'Create a testing task with explicit labels.',
                labels: 'qa, testing',
            }));

            assertEqual(parsed.success, true, 'Expected Jira create success');
            assertEqual(parsed.ticketKey, 'AOTF-1001', 'Expected created ticket key');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket honors explicit no-label wording over supplied labels', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-create-no-label-override';
        const deps = {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[sessionId, {
                    messages: [{ role: 'user', content: 'Create a testing task for AOTF-200 without labels.' }],
                }]]),
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const payload = JSON.parse(options.body);
            assertEqual(payload.fields.labels, undefined, 'Expected explicit no-label wording to strip supplied labels');
            return {
                ok: true,
                status: 201,
                json: async () => ({ key: 'AOTF-1002', id: '1002' }),
            };
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                issueType: 'Task',
                summary: 'Testing - AOTF-200',
                description: 'Create a testing task while forcing no labels.',
                labels: 'qa,testing',
            }));

            assertEqual(parsed.success, true, 'Expected Jira create success');
            assertEqual(parsed.ticketKey, 'AOTF-1002', 'Expected created ticket key');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket blocks when approval is denied', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-create-denied' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Cancel' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'buggenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        global.fetch = async () => {
            throw new Error('create_jira_ticket should not call Jira when approval is denied');
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                summary: 'Blocked create',
                description: 'Should stop before Jira mutation.',
            }));

            assertEqual(parsed.success, false, 'Expected approval failure');
            assertEqual(parsed.guardrail.approvalMode, 'rejected', 'Expected rejected approval mode');
        } finally {
            global.fetch = originalFetch;
        }
    }),

    test('Custom tools: update_jira_ticket sends Jira-safe rich description payload', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-update-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'buggenie', deps);
        const updateTool = tools.find(t => t.name === 'update_jira_ticket');
        assert(updateTool, 'update_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        const hasInvalidMarkCombo = (value) => {
            if (Array.isArray(value)) return value.some(hasInvalidMarkCombo);
            if (!value || typeof value !== 'object') return false;
            if (value.type === 'text') {
                const marks = Array.isArray(value.marks) ? value.marks.map(mark => mark.type) : [];
                return marks.includes('strong') && marks.includes('code');
            }
            return Object.values(value).some(hasInvalidMarkCombo);
        };

        global.fetch = async (url, options = {}) => {
            if ((options.method || 'GET') === 'GET'
                && url.includes('/issue/AOTF-999?fields=')
                && url.includes('summary%2Cdescription%2Cpriority%2Clabels')
                && url.includes('expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-999',
                        fields: {
                            summary: 'Original summary',
                            description: { type: 'doc', version: 1, content: [] },
                            priority: { name: 'Medium' },
                            labels: ['triage'],
                        },
                        renderedFields: {
                            description: 'Old description',
                        },
                    }),
                };
            }

            if ((options.method || 'GET') === 'PUT' && url.endsWith('/issue/AOTF-999')) {
                const payload = JSON.parse(options.body);
                assert(payload.fields.description, 'Expected description field in Jira update payload');
                assert(!hasInvalidMarkCombo(payload.fields.description), 'Expected Jira-safe ADF with no strong+code combination');
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected Jira call: ${options.method || 'GET'} ${url}`);
        };

        try {
            const parsed = JSON.parse(await updateTool.handler({
                ticketId: 'AOTF-999',
                description: '**Description :-**\n1. Observe **`Building Details - Click on Map Thumbnail`** in Mixpanel.',
            }));

            assertEqual(parsed.success, true, 'Expected Jira update success');
            assert(parsed.updated.includes('fields'), 'Expected fields update to be reported');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
            assertEqual(parsed.receipt.kind, 'mutation-receipt', 'Expected structured update receipt');
            assert(parsed.receipt.changes.some(change => change.field === 'description'), 'Expected description diff in receipt');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: update_jira_ticket returns rich text diagnostics on Jira 400', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-update-failure' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'buggenie', deps);
        const updateTool = tools.find(t => t.name === 'update_jira_ticket');
        assert(updateTool, 'update_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            if ((options.method || 'GET') === 'GET'
                && url.includes('/issue/AOTF-999?fields=')
                && url.includes('summary%2Cdescription%2Cpriority%2Clabels')
                && url.includes('expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-999',
                        fields: {
                            summary: 'Original summary',
                            description: { type: 'doc', version: 1, content: [] },
                            priority: { name: 'Medium' },
                            labels: ['triage'],
                        },
                        renderedFields: {
                            description: 'Old description',
                        },
                    }),
                };
            }

            if ((options.method || 'GET') === 'PUT' && url.endsWith('/issue/AOTF-999')) {
                return {
                    ok: false,
                    status: 400,
                    text: async () => JSON.stringify({
                        errorMessages: ['INVALID_INPUT'],
                        errors: {
                            description: 'Operation value must be Atlassian Document Format',
                        },
                    }),
                };
            }

            throw new Error(`Unexpected Jira call: ${options.method || 'GET'} ${url}`);
        };

        try {
            const parsed = JSON.parse(await updateTool.handler({
                ticketId: 'AOTF-999',
                description: '**Description :-**\n1. Observe **`Building Details - Click on Map Thumbnail`** in Mixpanel.',
            }));

            assertEqual(parsed.success, false, 'Expected Jira update failure');
            assertEqual(parsed.fieldErrors.description, 'Operation value must be Atlassian Document Format', 'Expected field-level Jira error to be surfaced');
            assert(parsed.hint.includes('code-only'), 'Expected Jira-safe rich text hint');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: taskgenie exposes Jira issue, epic, capability, assignment, delete, link removal, transition, worklog, and estimate tools', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const names = tools.map(t => t.name);

        assert(names.includes('search_jira_issues'), 'taskgenie should expose search_jira_issues');
        assert(names.includes('search_jira_epics'), 'taskgenie should expose search_jira_epics');
        assert(names.includes('get_jira_epic'), 'taskgenie should expose get_jira_epic');
        assert(names.includes('get_jira_epic_issues'), 'taskgenie should expose get_jira_epic_issues');
        assert(names.includes('list_jira_issues_without_epic'), 'taskgenie should expose list_jira_issues_without_epic');
        assert(names.includes('get_jira_ticket_capabilities'), 'taskgenie should expose get_jira_ticket_capabilities');
        assert(names.includes('search_jira_users'), 'taskgenie should expose search_jira_users');
        assert(names.includes('assign_jira_ticket'), 'taskgenie should expose assign_jira_ticket');
        assert(names.includes('delete_jira_ticket'), 'taskgenie should expose delete_jira_ticket');
        assert(names.includes('remove_jira_issue_link'), 'taskgenie should expose remove_jira_issue_link');
        assert(names.includes('transition_jira_ticket'), 'taskgenie should expose transition_jira_ticket');
        assert(names.includes('log_jira_work'), 'taskgenie should expose log_jira_work');
        assert(names.includes('update_jira_estimates'), 'taskgenie should expose update_jira_estimates');
    }),

    test('Custom tools: fetch_jira_ticket returns parent, subtasks, and issue links', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                key: 'AOTF-321',
                fields: {
                    summary: 'Ticket with relationships',
                    description: { type: 'doc', version: 1, content: [] },
                    issuetype: { name: 'Task' },
                    priority: { name: 'Medium' },
                    labels: ['qa'],
                    components: [],
                    parent: {
                        id: '10001',
                        key: 'AOTF-300',
                        fields: {
                            summary: 'Regression Parent',
                            status: { name: 'In Progress' },
                            issuetype: { name: 'Task' },
                            priority: { name: 'High' },
                        },
                    },
                    subtasks: [{
                        id: '10002',
                        key: 'AOTF-322',
                        fields: {
                            summary: 'Regression Subtask',
                            status: { name: 'To Do' },
                            issuetype: { name: 'Sub-task' },
                            priority: { name: 'Medium' },
                        },
                    }],
                    issuelinks: [{
                        id: '9001',
                        outwardIssue: {
                            id: '10003',
                            key: 'AOTF-999',
                            fields: {
                                summary: 'Associated Ticket',
                                status: { name: 'Done' },
                                issuetype: { name: 'Task' },
                                priority: { name: 'Low' },
                            },
                        },
                        type: {
                            id: '10000',
                            name: 'Relates',
                            inward: 'relates to',
                            outward: 'relates to',
                        },
                    }],
                },
                renderedFields: {
                    description: '<p>Tracked ticket</p>',
                },
            }),
        });

        try {
            const parsed = JSON.parse(await jiraTool.handler({ ticketId: 'AOTF-321' }));
            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assertEqual(parsed.parent.key, 'AOTF-300', 'Expected parent issue key');
            assertEqual(parsed.subtasks.length, 1, 'Expected one subtask');
            assertEqual(parsed.subtasks[0].key, 'AOTF-322', 'Expected normalized subtask key');
            assertEqual(parsed.issueLinks.length, 1, 'Expected one issue link');
            assertEqual(parsed.issueLinks[0].id, '9001', 'Expected issue link id');
            assertEqual(parsed.issueLinks[0].relatedIssueKey, 'AOTF-999', 'Expected related issue key');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: search_jira_users returns assignable Jira users and recommended match', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const searchTool = tools.find(t => t.name === 'search_jira_users');
        assert(searchTool, 'search_jira_users tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let requestedUrl = '';
        global.fetch = async (url) => {
            requestedUrl = String(url);
            return {
                ok: true,
                status: 200,
                json: async () => ([
                    {
                        accountId: 'acct-1',
                        displayName: 'Monica Kathiresan',
                        emailAddress: 'monica@example.com',
                        active: true,
                        accountType: 'atlassian',
                        self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-1',
                    },
                ]),
            };
        };

        try {
            const parsed = JSON.parse(await searchTool.handler({
                query: 'Monica Kathiresan',
                issueKey: 'AOTF-17620',
            }));
            assertEqual(parsed.success, true, 'Expected Jira user search success');
            assert(requestedUrl.includes('/user/assignable/search?'), 'Expected assignable search endpoint');
            assert(requestedUrl.includes('issueKey=AOTF-17620'), 'Expected issue-scoped assignable lookup');
            assertEqual(parsed.userCount, 1, 'Expected one user result');
            assertEqual(parsed.recommendedUser.accountId, 'acct-1', 'Expected recommended user accountId');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: search_jira_issues uses enhanced Jira search and returns normalized issues', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const searchTool = tools.find(t => t.name === 'search_jira_issues');
        assert(searchTool, 'search_jira_issues tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let requestedUrl = '';
        let requestedPayload = null;
        global.fetch = async (url, options = {}) => {
            requestedUrl = String(url);
            requestedPayload = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    total: 1,
                    issues: [{
                        id: '10001',
                        key: 'AOTF-321',
                        self: 'https://example.atlassian.net/rest/api/3/issue/AOTF-321',
                        fields: {
                            summary: 'Travel time regression',
                            status: { name: 'In Progress' },
                            issuetype: { name: 'Bug' },
                            priority: { name: 'High' },
                            assignee: {
                                accountId: 'acct-1',
                                displayName: 'Monica Kathiresan',
                                active: true,
                                self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-1',
                            },
                            reporter: {
                                accountId: 'acct-2',
                                displayName: 'QA Reporter',
                                active: true,
                                self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-2',
                            },
                            labels: ['travel-time', 'regression'],
                            created: '2026-04-09T10:00:00.000+0000',
                            updated: '2026-04-09T10:05:00.000+0000',
                        },
                    }],
                }),
            };
        };

        try {
            const parsed = JSON.parse(await searchTool.handler({
                query: 'travel time',
                projectKey: 'AOTF',
                maxResults: 5,
            }));
            assertEqual(parsed.success, true, 'Expected Jira issue search success');
            assert(requestedUrl.endsWith('/search/jql'), 'Expected enhanced Jira search endpoint');
            assertEqual(requestedPayload.maxResults, 5, 'Expected maxResults to be forwarded');
            assert(requestedPayload.jql.includes('project = "AOTF"'), 'Expected project-scoped JQL');
            assert(requestedPayload.jql.includes('text ~'), 'Expected text search JQL');
            assertEqual(parsed.issueCount, 1, 'Expected one Jira issue result');
            assertEqual(parsed.issues[0].key, 'AOTF-321', 'Expected normalized Jira issue key');
            assertEqual(parsed.issues[0].assignee.accountId, 'acct-1', 'Expected normalized assignee');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: search_jira_epics uses epic-scoped JQL and returns normalized epics', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const searchTool = tools.find(t => t.name === 'search_jira_epics');
        assert(searchTool, 'search_jira_epics tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let requestedUrl = '';
        let requestedPayload = null;
        global.fetch = async (url, options = {}) => {
            requestedUrl = String(url);
            requestedPayload = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    total: 1,
                    issues: [{
                        id: '10010',
                        key: 'AOTF-900',
                        self: 'https://example.atlassian.net/rest/api/3/issue/AOTF-900',
                        fields: {
                            summary: 'Consumer Search Modernization',
                            status: { name: 'In Progress' },
                            issuetype: { name: 'Epic' },
                            priority: { name: 'High' },
                            assignee: {
                                accountId: 'acct-1',
                                displayName: 'Monica Kathiresan',
                                active: true,
                                self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-1',
                            },
                            reporter: {
                                accountId: 'acct-2',
                                displayName: 'QA Reporter',
                                active: true,
                                self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-2',
                            },
                            labels: ['consumer', 'epic'],
                            created: '2026-04-09T10:00:00.000+0000',
                            updated: '2026-04-09T10:05:00.000+0000',
                        },
                    }],
                }),
            };
        };

        try {
            const parsed = JSON.parse(await searchTool.handler({
                query: 'consumer search',
                projectKey: 'AOTF',
                maxResults: 5,
            }));
            assertEqual(parsed.success, true, 'Expected Jira epic search success');
            assert(requestedUrl.endsWith('/search/jql'), 'Expected enhanced Jira search endpoint');
            assertEqual(requestedPayload.maxResults, 5, 'Expected maxResults to be forwarded');
            assert(requestedPayload.jql.includes('issuetype = Epic'), 'Expected Epic-scoped JQL');
            assert(requestedPayload.jql.includes('project = "AOTF"'), 'Expected project-scoped JQL');
            assertEqual(parsed.epicCount, 1, 'Expected one Jira epic result');
            assertEqual(parsed.epics[0].key, 'AOTF-900', 'Expected normalized epic key');
            assertEqual(parsed.epics[0].name, 'Consumer Search Modernization', 'Expected epic name');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: get_jira_epic combines agile epic metadata with issue details', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const epicTool = tools.find(t => t.name === 'get_jira_epic');
        assert(epicTool, 'get_jira_epic tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url) => {
            const requestUrl = String(url);
            if (requestUrl.includes('/rest/agile/1.0/epic/AOTF-900')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 900,
                        key: 'AOTF-900',
                        name: 'Consumer Search Modernization',
                        summary: 'Consumer Search Modernization',
                        done: false,
                        colorName: 'color_5',
                    }),
                };
            }

            if (requestUrl.includes('/rest/api/3/issue/AOTF-900?expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: '10010',
                        key: 'AOTF-900',
                        fields: {
                            summary: 'Consumer Search Modernization',
                            description: { type: 'doc', version: 1, content: [] },
                            issuetype: { name: 'Epic' },
                            status: { name: 'In Progress' },
                            priority: { name: 'High' },
                            labels: ['consumer', 'epic'],
                            components: [{ name: 'Search' }],
                            assignee: {
                                accountId: 'acct-1',
                                displayName: 'Monica Kathiresan',
                                active: true,
                            },
                            reporter: {
                                accountId: 'acct-2',
                                displayName: 'QA Reporter',
                                active: true,
                            },
                            created: '2026-04-09T10:00:00.000+0000',
                            updated: '2026-04-09T10:05:00.000+0000',
                        },
                        renderedFields: {
                            description: '<p>Epic description</p>',
                        },
                    }),
                };
            }

            throw new Error(`Unexpected URL: ${url}`);
        };

        try {
            const parsed = JSON.parse(await epicTool.handler({ epicIdOrKey: 'AOTF-900' }));
            assertEqual(parsed.success, true, 'Expected Jira epic lookup success');
            assertEqual(parsed.epicKey, 'AOTF-900', 'Expected epic key');
            assertEqual(parsed.name, 'Consumer Search Modernization', 'Expected epic name');
            assertEqual(parsed.issueType, 'Epic', 'Expected issue type Epic');
            assertEqual(parsed.status, 'In Progress', 'Expected epic status');
            assertEqual(parsed.sourceEndpoint, 'agile-epic', 'Expected agile endpoint to be primary source');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: get_jira_epic_issues falls back to JQL when agile epic issues are unavailable', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const epicIssuesTool = tools.find(t => t.name === 'get_jira_epic_issues');
        assert(epicIssuesTool, 'get_jira_epic_issues tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        const seenUrls = [];
        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            seenUrls.push(requestUrl);

            if (requestUrl.includes('/rest/agile/1.0/epic/AOTF-900/issue')) {
                return {
                    ok: false,
                    status: 404,
                    text: async () => JSON.stringify({ errorMessages: ['Epic issues endpoint unavailable'] }),
                };
            }

            if (requestUrl.endsWith('/search/jql')) {
                const payload = JSON.parse(options.body);
                if (payload.jql.includes('parent = "AOTF-900"')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            total: 1,
                            issues: [{
                                id: '10011',
                                key: 'AOTF-901',
                                self: 'https://example.atlassian.net/rest/api/3/issue/AOTF-901',
                                fields: {
                                    summary: 'Persist search filters on return',
                                    status: { name: 'To Do' },
                                    issuetype: { name: 'Story' },
                                    priority: { name: 'Medium' },
                                    assignee: null,
                                    reporter: null,
                                    labels: ['consumer'],
                                    created: '2026-04-09T10:00:00.000+0000',
                                    updated: '2026-04-09T10:05:00.000+0000',
                                },
                            }],
                        }),
                    };
                }
            }

            throw new Error(`Unexpected URL: ${url}`);
        };

        try {
            const parsed = JSON.parse(await epicIssuesTool.handler({ epicIdOrKey: 'AOTF-900' }));
            assertEqual(parsed.success, true, 'Expected Jira epic issues fallback success');
            assertEqual(parsed.endpoint, 'jql-parent-fallback', 'Expected parent-based fallback endpoint');
            assertEqual(parsed.issueCount, 1, 'Expected one issue in epic');
            assertEqual(parsed.issues[0].key, 'AOTF-901', 'Expected normalized issue key');
            assert(seenUrls.some(url => url.includes('/rest/agile/1.0/epic/AOTF-900/issue')), 'Expected agile endpoint attempt first');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: list_jira_issues_without_epic uses agile none endpoint and returns normalized issues', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const noEpicTool = tools.find(t => t.name === 'list_jira_issues_without_epic');
        assert(noEpicTool, 'list_jira_issues_without_epic tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let requestedUrl = '';
        global.fetch = async (url) => {
            requestedUrl = String(url);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    total: 1,
                    issues: [{
                        id: '10012',
                        key: 'AOTF-950',
                        self: 'https://example.atlassian.net/rest/api/3/issue/AOTF-950',
                        fields: {
                            summary: 'Unassigned backlog cleanup',
                            status: { name: 'Backlog' },
                            issuetype: { name: 'Task' },
                            priority: { name: 'Low' },
                            assignee: null,
                            reporter: null,
                            labels: ['backlog'],
                            created: '2026-04-09T10:00:00.000+0000',
                            updated: '2026-04-09T10:05:00.000+0000',
                        },
                    }],
                }),
            };
        };

        try {
            const parsed = JSON.parse(await noEpicTool.handler({ projectKey: 'AOTF', maxResults: 10 }));
            assertEqual(parsed.success, true, 'Expected issues-without-epic success');
            assert(requestedUrl.includes('/rest/agile/1.0/epic/none/issue?'), 'Expected agile epic none endpoint');
            assert(requestedUrl.includes('project'), 'Expected scoped project JQL in request');
            assertEqual(parsed.issueCount, 1, 'Expected one issue without epic');
            assertEqual(parsed.issues[0].key, 'AOTF-950', 'Expected normalized issue key');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: assign_jira_ticket resolves assignee query and updates Jira assignee', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-assign-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const assignTool = tools.find(t => t.name === 'assign_jira_ticket');
        assert(assignTool, 'assign_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        const seenCalls = [];
        global.fetch = async (url, options = {}) => {
            seenCalls.push({ url: String(url), method: options.method || 'GET', body: options.body || null });

            if ((options.method || 'GET') === 'GET'
                && String(url).includes('/issue/AOTF-17620?fields=')
                && String(url).includes('summary%2Cassignee')
                && String(url).includes('expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-17620',
                        fields: {
                            summary: 'Existing testing task',
                            assignee: { displayName: 'Unassigned' },
                        },
                        renderedFields: {},
                    }),
                };
            }

            if ((options.method || 'GET') === 'GET' && String(url).includes('/user/assignable/search?')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ([{
                        accountId: 'acct-1',
                        displayName: 'Monica Kathiresan',
                        emailAddress: 'monica@example.com',
                        active: true,
                        accountType: 'atlassian',
                        self: 'https://example.atlassian.net/rest/api/3/user?accountId=acct-1',
                    }]),
                };
            }

            if ((options.method || 'GET') === 'PUT' && String(url).endsWith('/issue/AOTF-17620/assignee')) {
                const payload = JSON.parse(options.body);
                assertEqual(payload.accountId, 'acct-1', 'Expected resolved accountId in assignee payload');
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected assignment call: ${options.method || 'GET'} ${url}`);
        };

        try {
            const parsed = JSON.parse(await assignTool.handler({
                ticketId: 'AOTF-17620',
                assigneeQuery: 'Monica Kathiresan',
            }));
            assertEqual(parsed.success, true, 'Expected Jira assignment success');
            assertEqual(seenCalls.length, 3, 'Expected state lookup, search, and assign requests');
            assert(seenCalls[1].url.includes('issueKey=AOTF-17620'), 'Expected issue-scoped assignee resolution');
            assertEqual(parsed.assignee.accountId, 'acct-1', 'Expected assigned accountId in result');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
            assertEqual(parsed.receipt.kind, 'mutation-receipt', 'Expected structured assignment receipt');
            assertEqual(parsed.receipt.changes[0].field, 'assignee', 'Expected assignee change in receipt');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket supports true subtasks via parentIssueKey', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-create-subtask-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            const method = options.method || 'GET';

            if (method === 'GET' && requestUrl.includes('/issue/AOTF-17620?fields=project')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-17620',
                        fields: { project: { key: 'AOTF' } },
                    }),
                };
            }

            if (method === 'GET' && requestUrl.includes('/issue/createmeta/AOTF/issuetypes')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        issueTypes: [
                            { id: '3', name: 'Task', subtask: false },
                            { id: '5', name: 'Sub-task', subtask: true },
                        ],
                    }),
                };
            }

            if (method === 'POST' && requestUrl.endsWith('/rest/api/3/issue')) {
                const payload = JSON.parse(options.body);
                assertEqual(payload.fields.project.key, 'AOTF', 'Expected parent project to be reused');
                assertEqual(payload.fields.parent.key, 'AOTF-17620', 'Expected parentIssueKey in Jira payload');
                assertEqual(payload.fields.issuetype.id, '5', 'Expected subtask issue type id');
                return {
                    ok: true,
                    status: 201,
                    json: async () => ({ key: 'AOTF-17630', id: '17630' }),
                };
            }

            throw new Error(`Unexpected Jira call: ${method} ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                summary: 'Testing - Release 5.22R',
                description: 'Create regression testing subtask.',
                parentIssueKey: 'AOTF-17620',
                assigneeAccountId: 'acct-1',
            }));
            assertEqual(parsed.success, true, 'Expected Jira subtask create success');
            assertEqual(parsed.parent.key, 'AOTF-17620', 'Expected parent to be returned');
            assertEqual(parsed.ticketKey, 'AOTF-17630', 'Expected created subtask key');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
            assertEqual(parsed.receipt.kind, 'mutation-receipt', 'Expected structured creation receipt');
            assert(parsed.receipt.changes.some(change => change.field === 'parent'), 'Expected parent field in create receipt');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: create_jira_ticket rejects parentIssueKey plus linkedIssueKey', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const createTool = tools.find(t => t.name === 'create_jira_ticket');
        assert(createTool, 'create_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';
        global.fetch = async () => {
            throw new Error('create_jira_ticket should not call Jira when parentIssueKey and linkedIssueKey are both provided');
        };

        try {
            const parsed = JSON.parse(await createTool.handler({
                summary: 'Invalid combined create',
                description: 'Should fail before Jira call.',
                parentIssueKey: 'AOTF-17620',
                linkedIssueKey: 'AOTF-17521',
            }));
            assertEqual(parsed.success, false, 'Expected validation failure');
            assert(parsed.error.includes('parentIssueKey cannot be combined with linkedIssueKey'), 'Expected mutual exclusion error');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: remove_jira_issue_link resolves and deletes an associated link', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-unlink-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const removeTool = tools.find(t => t.name === 'remove_jira_issue_link');
        assert(removeTool, 'remove_jira_issue_link tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let deleteUrl = '';
        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            const method = options.method || 'GET';

            if (method === 'GET' && requestUrl.includes('/issue/AOTF-17620?fields=issuelinks')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        fields: {
                            issuelinks: [{
                                id: '9001',
                                outwardIssue: {
                                    id: '10003',
                                    key: 'AOTF-17521',
                                    fields: {
                                        summary: 'Previous Regression Ticket',
                                        status: { name: 'Done' },
                                        issuetype: { name: 'Task' },
                                        priority: { name: 'Medium' },
                                    },
                                },
                                type: {
                                    id: '10000',
                                    name: 'Relates',
                                    inward: 'relates to',
                                    outward: 'relates to',
                                },
                            }],
                        },
                    }),
                };
            }

            if (method === 'DELETE' && requestUrl.includes('/issueLink/9001')) {
                deleteUrl = requestUrl;
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected Jira call: ${method} ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await removeTool.handler({
                ticketId: 'AOTF-17620',
                relatedIssueKey: 'AOTF-17521',
            }));
            assertEqual(parsed.success, true, 'Expected issue link removal success');
            assert(deleteUrl.includes('/issueLink/9001'), 'Expected delete call for resolved issue link id');
            assertEqual(parsed.removedLink.relatedIssueKey, 'AOTF-17521', 'Expected removed related issue key');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
            assertEqual(parsed.receipt.kind, 'mutation-receipt', 'Expected structured unlink receipt');
            assert(parsed.receipt.changes.some(change => change.field === 'issueLink'), 'Expected issue link diff in receipt');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: fetch_jira_ticket returns time tracking values when Jira provides them', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                key: 'AOTF-321',
                fields: {
                    summary: 'Ticket with time tracking',
                    description: { type: 'doc', version: 1, content: [] },
                    issuetype: { name: 'Task' },
                    priority: { name: 'Medium' },
                    labels: ['qa'],
                    components: [],
                    timetracking: {
                        originalEstimate: '2h',
                        originalEstimateSeconds: 7200,
                        remainingEstimate: '1h',
                        remainingEstimateSeconds: 3600,
                        timeSpent: '1h',
                        timeSpentSeconds: 3600,
                    },
                },
                renderedFields: {
                    description: '<p>Tracked ticket</p>',
                },
            }),
        });

        try {
            const parsed = JSON.parse(await jiraTool.handler({ ticketId: 'AOTF-321' }));
            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assertEqual(parsed.timetracking.originalEstimate, '2h', 'Expected original estimate to be exposed');
            assertEqual(parsed.timetracking.remainingEstimate, '1h', 'Expected remaining estimate to be exposed');
            assertEqual(parsed.timetracking.timeSpent, '1h', 'Expected time spent to be exposed');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: fetch_jira_ticket returns normalized Jira comments', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                key: 'AOTF-654',
                fields: {
                    summary: 'Ticket with comments',
                    description: { type: 'doc', version: 1, content: [] },
                    issuetype: { name: 'Story' },
                    priority: { name: 'Medium' },
                    labels: ['qa'],
                    components: [],
                    comment: {
                        comments: [{
                            id: '10001',
                            author: { displayName: 'QA Lead' },
                            body: {
                                type: 'doc',
                                version: 1,
                                content: [{
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Use sample listing 12345678 for validation.' }],
                                }],
                            },
                            created: '2026-04-01T10:00:00.000+0000',
                            updated: '2026-04-01T10:15:00.000+0000',
                            visibility: { type: 'role', value: 'Administrators', identifier: 'Administrators' },
                        }],
                        total: 1,
                        maxResults: 1,
                        startAt: 0,
                    },
                },
                renderedFields: {
                    description: '<p>Tracked ticket</p>',
                },
            }),
        });

        try {
            const parsed = JSON.parse(await jiraTool.handler({ ticketId: 'AOTF-654' }));
            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assertEqual(parsed.commentCount, 1, 'Expected comment count to be exposed');
            assertEqual(parsed.commentsTruncated, false, 'Expected comments to be complete');
            assertEqual(parsed.comments.length, 1, 'Expected one normalized comment');
            assertEqual(parsed.comments[0].author, 'QA Lead', 'Expected comment author');
            assert(parsed.comments[0].body.includes('12345678'), 'Expected comment body to be normalized');
            assertEqual(parsed.comments[0].visibility.type, 'role', 'Expected comment visibility to be preserved');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: fetch_jira_ticket hydrates truncated comments from Jira comments endpoint', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        const seenUrls = [];
        global.fetch = async (url) => {
            const requestUrl = String(url);
            seenUrls.push(requestUrl);

            if (requestUrl.includes('/issue/AOTF-777?expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-777',
                        fields: {
                            summary: 'Ticket with truncated comments',
                            description: { type: 'doc', version: 1, content: [] },
                            issuetype: { name: 'Story' },
                            priority: { name: 'Medium' },
                            labels: ['qa'],
                            components: [],
                            comment: {
                                comments: [{
                                    id: '10001',
                                    author: { displayName: 'QA Lead' },
                                    body: {
                                        type: 'doc',
                                        version: 1,
                                        content: [{
                                            type: 'paragraph',
                                            content: [{ type: 'text', text: 'First visible comment.' }],
                                        }],
                                    },
                                }],
                                total: 2,
                                maxResults: 1,
                                startAt: 0,
                            },
                        },
                        renderedFields: {
                            description: '<p>Tracked ticket</p>',
                        },
                    }),
                };
            }

            if (requestUrl.includes('/issue/AOTF-777/comment')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        comments: [
                            {
                                id: '10001',
                                author: { displayName: 'QA Lead' },
                                body: {
                                    type: 'doc',
                                    version: 1,
                                    content: [{
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'First visible comment.' }],
                                    }],
                                },
                            },
                            {
                                id: '10002',
                                author: { displayName: 'Product Owner' },
                                body: {
                                    type: 'doc',
                                    version: 1,
                                    content: [{
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'Second comment with listing 7654321.' }],
                                    }],
                                },
                            },
                        ],
                        total: 2,
                        maxResults: 100,
                        startAt: 0,
                    }),
                };
            }

            throw new Error(`Unexpected Jira call: ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await jiraTool.handler({ ticketId: 'AOTF-777' }));
            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assertEqual(parsed.commentCount, 2, 'Expected full comment count after hydration');
            assertEqual(parsed.commentsTruncated, false, 'Expected truncation to be cleared after hydration');
            assertEqual(parsed.comments.length, 2, 'Expected all comments to be returned');
            assert(parsed.comments[1].body.includes('7654321'), 'Expected hydrated comment body');
            assert(seenUrls.some(url => url.includes('/issue/AOTF-777/comment')), 'Expected Jira comments endpoint to be called');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: fetch_jira_ticket accepts Jira browse URLs', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');
        assert(jiraTool, 'fetch_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let requestedUrl = '';
        global.fetch = async (url) => {
            requestedUrl = String(url);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    key: 'AOTF-321',
                    fields: {
                        summary: 'Ticket with URL input',
                        description: { type: 'doc', version: 1, content: [] },
                        issuetype: { name: 'Task' },
                        priority: { name: 'Medium' },
                        labels: ['qa'],
                        components: [],
                    },
                    renderedFields: {
                        description: '<p>Tracked ticket</p>',
                    },
                }),
            };
        };

        try {
            const parsed = JSON.parse(await jiraTool.handler({ ticketId: 'https://corelogic.atlassian.net/browse/AOTF-321' }));
            assertEqual(parsed.success, true, 'Expected Jira fetch success');
            assert(requestedUrl.includes('/issue/AOTF-321'), 'Expected fetch to resolve ticket key from URL');
            assertEqual(parsed.sourceUrl, 'https://corelogic.atlassian.net/browse/AOTF-321', 'Expected source URL to be preserved');
            assertEqual(parsed.ticketUrl, 'https://corelogic.atlassian.net/browse/AOTF-321', 'Expected ticketUrl to use Jira browse base URL from pasted URL');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: get_knowledge_base_page accepts Confluence page URLs', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const groundingStore = {
            _kbConnector: {
                getPage: async (pageId) => ({
                    id: pageId,
                    title: 'Enhanced Consumer Funnel Management Test Data UAT PROD',
                    content: 'Mobile App Enter Code Test Scenarios in UAT\nSection details here.',
                    url: `https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/${pageId}/Enhanced+Consumer+Funnel+Management+Test+Data+UAT+PROD`,
                    space: 'AOTF',
                    metadata: { labels: ['qa'] },
                }),
                getPageTree: async () => [],
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'testgenie', { groundingStore });
        const kbTool = tools.find(t => t.name === 'get_knowledge_base_page');
        assert(kbTool, 'get_knowledge_base_page tool not found');

        const parsed = JSON.parse(await kbTool.handler({
            pageId: 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/Enhanced+Consumer+Funnel+Management+Test+Data+UAT+PROD',
            includeChildren: false,
        }));

        assertEqual(parsed.success, true, 'Expected KB page fetch success');
        assertEqual(parsed.pageId, '189467646', 'Expected page ID to be resolved from URL');
        assertEqual(parsed.sourceUrl, 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/189467646/Enhanced+Consumer+Funnel+Management+Test+Data+UAT+PROD', 'Expected source URL to be preserved');
        assertEqual(parsed.pages[0].id, '189467646', 'Expected page content to be fetched with resolved page ID');
    }),

    test('Custom tools: Confluence discovery tools return structured navigation data', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const confluencePages = [
            {
                id: '100',
                title: 'Release Notes',
                content: 'Release notes and launch checklist',
                excerpt: 'Release notes and launch checklist',
                url: 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/100/Release+Notes',
                space: 'AOTF',
                lastModified: '2026-04-01T00:00:00.000Z',
                metadata: {
                    labels: ['release'],
                    author: 'Taylor',
                    status: 'current',
                    version: 7,
                    parentId: null,
                },
            },
            {
                id: '101',
                title: 'Launch Checklist',
                content: 'Checklist details',
                excerpt: 'Checklist details',
                url: 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/101/Launch+Checklist',
                space: 'AOTF',
                lastModified: '2026-04-02T00:00:00.000Z',
                metadata: {
                    labels: ['launch'],
                    author: 'Taylor',
                    status: 'current',
                    version: 2,
                    parentId: '100',
                },
            },
        ];

        const confluenceProvider = {
            getProviderType: () => 'confluence',
            search: async (query, options) => {
                if (options?.spaceKey === 'AOTF' && !query) {
                    return [confluencePages[0]];
                }
                return [confluencePages[0]];
            },
            listSpaces: async () => ([
                {
                    key: 'AOTF',
                    name: 'Automation',
                    url: 'https://corelogic.atlassian.net/wiki/spaces/AOTF',
                    description: 'Automation docs',
                },
            ]),
            getPageTree: async () => confluencePages,
        };

        const groundingStore = {
            _kbConnector: {
                getProviderByType: (type) => (type === 'confluence' ? confluenceProvider : null),
                getPage: async (pageId) => confluencePages.find(page => page.id === pageId) || null,
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'testgenie', { groundingStore });

        const searchTool = tools.find(t => t.name === 'search_confluence_content');
        const pageTool = tools.find(t => t.name === 'get_confluence_page_details');
        const spacesTool = tools.find(t => t.name === 'list_confluence_spaces');
        const spacePagesTool = tools.find(t => t.name === 'list_confluence_pages_in_space');
        const treeTool = tools.find(t => t.name === 'get_confluence_page_tree');

        assert(searchTool, 'search_confluence_content tool not found');
        assert(pageTool, 'get_confluence_page_details tool not found');
        assert(spacesTool, 'list_confluence_spaces tool not found');
        assert(spacePagesTool, 'list_confluence_pages_in_space tool not found');
        assert(treeTool, 'get_confluence_page_tree tool not found');

        const searchResult = JSON.parse(await searchTool.handler({ query: 'release notes', spaceKey: 'AOTF', maxResults: 5 }));
        assertEqual(searchResult.success, true, 'Expected Confluence search success');
        assertEqual(searchResult.results[0].title, 'Release Notes', 'Expected Confluence search result title');

        const pageResult = JSON.parse(await pageTool.handler({
            pageId: 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/100/Release+Notes',
        }));
        assertEqual(pageResult.success, true, 'Expected Confluence page fetch success');
        assertEqual(pageResult.page.id, '100', 'Expected Confluence page ID to resolve from URL');
        assertEqual(pageResult.sourceUrl, 'https://corelogic.atlassian.net/wiki/spaces/AOTF/pages/100/Release+Notes', 'Expected Confluence source URL to be preserved');

        const spacesResult = JSON.parse(await spacesTool.handler({ query: 'auto' }));
        assertEqual(spacesResult.success, true, 'Expected Confluence space list success');
        assertEqual(spacesResult.spaceCount, 1, 'Expected filtered space count');

        const pagesInSpaceResult = JSON.parse(await spacePagesTool.handler({ spaceKey: 'AOTF' }));
        assertEqual(pagesInSpaceResult.success, true, 'Expected Confluence space page listing success');
        assertEqual(pagesInSpaceResult.pageCount, 1, 'Expected one page in space listing');

        const treeResult = JSON.parse(await treeTool.handler({ pageId: '100', maxDepth: 2 }));
        assertEqual(treeResult.success, true, 'Expected Confluence page tree success');
        assertEqual(treeResult.pageCount, 2, 'Expected root plus child in page tree');
        assertEqual(treeResult.pages[0].depth, 0, 'Expected root depth to be zero');
        assertEqual(treeResult.pages[1].depth, 1, 'Expected child depth to be one');
    }),

    test('Custom tools: get_jira_ticket_capabilities returns editable fields and transitions', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {});
        const capabilityTool = tools.find(t => t.name === 'get_jira_ticket_capabilities');
        assert(capabilityTool, 'get_jira_ticket_capabilities tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url) => {
            if (url.includes('/editmeta')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        fields: {
                            summary: { name: 'Summary', required: true, operations: ['set'], schema: { type: 'string' } },
                            timetracking: { name: 'Time tracking', required: false, operations: ['set'], schema: { type: 'any' } },
                            customfield_12345: {
                                name: 'MLS Name',
                                required: false,
                                operations: ['set'],
                                schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield', customId: 12345 },
                            },
                        },
                    }),
                };
            }

            if (url.includes('/transitions')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        transitions: [
                            {
                                id: '21',
                                name: 'Start Progress',
                                to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                                hasScreen: false,
                                fields: {},
                            },
                            {
                                id: '31',
                                name: 'Close',
                                to: { name: 'Done', statusCategory: { key: 'done' } },
                                hasScreen: true,
                                fields: {
                                    resolution: { name: 'Resolution', required: true, operations: ['set'], schema: { type: 'resolution' } },
                                },
                            },
                        ],
                    }),
                };
            }

            throw new Error(`Unexpected URL: ${url}`);
        };

        try {
            const parsed = JSON.parse(await capabilityTool.handler({ ticketId: 'AOTF-654' }));
            assertEqual(parsed.success, true, 'Expected capability inspection success');
            assert(parsed.editableFields.some(field => field.fieldId === 'summary'), 'Expected summary edit metadata');
            assert(parsed.editableCustomFields.some(field => field.fieldId === 'customfield_12345'), 'Expected custom field metadata');
            assert(parsed.editableButNotFirstClass.some(field => field.fieldId === 'customfield_12345'), 'Expected unsupported editable field to be surfaced');
            assertEqual(parsed.availableTransitions.length, 2, 'Expected 2 transitions');
            assert(parsed.availableTransitions.some(t => t.toStatus === 'Done'), 'Expected Done transition to be exposed');
            assert(parsed.customToolCoverage.readFields.includes('epic'), 'Expected epic read coverage');
            assert(parsed.customToolCoverage.readFields.includes('issueLinks'), 'Expected issueLinks read coverage');
            assert(parsed.customToolCoverage.createFields.includes('parentIssueKey'), 'Expected parentIssueKey create coverage');
            assert(parsed.customToolCoverage.discoveryOperations.includes('search_jira_epics'), 'Expected epic discovery capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('get_jira_epic'), 'Expected epic read capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('get_jira_epic_issues'), 'Expected epic membership capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('list_jira_issues_without_epic'), 'Expected no-epic listing capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('delete_jira_ticket'), 'Expected delete ticket capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('search_jira_users'), 'Expected user search capability');
            assert(parsed.customToolCoverage.dedicatedOperations.includes('remove_jira_issue_link'), 'Expected link removal capability');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: delete_jira_ticket requires explicit confirmation and deletes the issue', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-delete' },
            chatManager: {
                _sessions: new Map([['session-delete', {
                    messages: [{ role: 'user', content: 'DELETE AOTF-17620' }],
                }]]),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const deleteTool = tools.find(t => t.name === 'delete_jira_ticket');
        assert(deleteTool, 'delete_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        let deleteUrl = '';
        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            const method = options.method || 'GET';

            if (method === 'GET' && requestUrl.includes('/issue/AOTF-17620?fields=summary,status,subtasks,issuetype')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-17620',
                        fields: {
                            summary: 'Mistaken Jira ticket',
                            status: { name: 'Open' },
                            issuetype: { name: 'Bug' },
                            subtasks: [],
                        },
                    }),
                };
            }

            if (method === 'DELETE' && requestUrl.endsWith('/issue/AOTF-17620')) {
                deleteUrl = requestUrl;
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected Jira call: ${method} ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await deleteTool.handler({
                ticketId: 'AOTF-17620',
                confirmationText: 'DELETE AOTF-17620',
                reason: 'Created by mistake during QA triage.',
            }));

            assertEqual(parsed.success, true, 'Expected Jira delete success');
            assert(deleteUrl.endsWith('/issue/AOTF-17620'), 'Expected Jira delete endpoint to be called');
            assertEqual(parsed.deletedIssue.key, 'AOTF-17620', 'Expected deleted issue key');
            assertEqual(parsed.confirmationAccepted, 'DELETE AOTF-17620', 'Expected accepted confirmation phrase');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: delete_jira_ticket blocks parent deletion without WITH SUBTASKS confirmation', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-delete-subtasks' },
            chatManager: {
                _sessions: new Map([['session-delete-subtasks', {
                    messages: [{ role: 'user', content: 'DELETE AOTF-17621' }],
                }]]),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const deleteTool = tools.find(t => t.name === 'delete_jira_ticket');
        assert(deleteTool, 'delete_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            const method = options.method || 'GET';

            if (method === 'GET' && requestUrl.includes('/issue/AOTF-17621?fields=summary,status,subtasks,issuetype')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-17621',
                        fields: {
                            summary: 'Parent ticket with subtasks',
                            status: { name: 'Open' },
                            issuetype: { name: 'Task' },
                            subtasks: [{
                                key: 'AOTF-17622',
                                fields: {
                                    summary: 'Child verification task',
                                    status: { name: 'To Do' },
                                    issuetype: { name: 'Sub-task' },
                                },
                            }],
                        },
                    }),
                };
            }

            if (method === 'DELETE') {
                throw new Error('delete_jira_ticket should not delete when subtasks exist without explicit subtask confirmation');
            }

            throw new Error(`Unexpected Jira call: ${method} ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await deleteTool.handler({
                ticketId: 'AOTF-17621',
                confirmationText: 'DELETE AOTF-17621',
            }));

            assertEqual(parsed.success, false, 'Expected delete to be blocked when subtasks exist');
            assert(parsed.error.includes('has 1 subtasks'), 'Expected subtask safety error');
            assertEqual(parsed.expectedConfirmation, 'DELETE AOTF-17621 WITH SUBTASKS', 'Expected WITH SUBTASKS confirmation requirement');
            assertEqual(parsed.subtasks.length, 1, 'Expected subtask details to be returned');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: delete_jira_ticket returns fallback guidance on Jira 403 permission denial', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-delete-forbidden' },
            chatManager: {
                _sessions: new Map([['session-delete-forbidden', {
                    messages: [{ role: 'user', content: 'DELETE AOTF-17623' }],
                }]]),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const deleteTool = tools.find(t => t.name === 'delete_jira_ticket');
        assert(deleteTool, 'delete_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            const requestUrl = String(url);
            const method = options.method || 'GET';

            if (method === 'GET' && requestUrl.includes('/issue/AOTF-17623?fields=summary,status,subtasks,issuetype')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-17623',
                        fields: {
                            summary: 'Forbidden Jira delete',
                            status: { name: 'Open' },
                            issuetype: { name: 'Bug' },
                            subtasks: [],
                        },
                    }),
                };
            }

            if (method === 'DELETE' && requestUrl.endsWith('/issue/AOTF-17623')) {
                return {
                    ok: false,
                    status: 403,
                    text: async () => 'You do not have permission to delete this issue.',
                };
            }

            throw new Error(`Unexpected Jira call: ${method} ${requestUrl}`);
        };

        try {
            const parsed = JSON.parse(await deleteTool.handler({
                ticketId: 'AOTF-17623',
                confirmationText: 'DELETE AOTF-17623',
            }));

            assertEqual(parsed.success, false, 'Expected permission-denied delete to fail');
            assert(parsed.error.includes('HTTP 403'), 'Expected 403 error response');
            assert(parsed.hint.includes('Delete issues permission'), 'Expected permission guidance hint');
            assertEqual(parsed.suggestedFallbacks.length, 2, 'Expected two fallback suggestions');
            assertEqual(parsed.suggestedFallbacks[0].action, 'transition_jira_ticket', 'Expected transition fallback first');
            assertEqual(parsed.suggestedFallbacks[1].action, 'archive_issue', 'Expected archive fallback second');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: transition_jira_ticket resolves target status and posts transition payload', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-transition-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const transitionTool = tools.find(t => t.name === 'transition_jira_ticket');
        assert(transitionTool, 'transition_jira_ticket tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        global.fetch = async (url, options = {}) => {
            if ((options.method || 'GET') === 'GET'
                && url.includes('/issue/AOTF-777?fields=')
                && url.includes('summary%2Cstatus')
                && url.includes('expand=renderedFields')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        key: 'AOTF-777',
                        fields: {
                            summary: 'Close out regression',
                            status: { name: 'In Progress' },
                        },
                        renderedFields: {},
                    }),
                };
            }

            if (options.method === 'GET' && url.includes('/transitions')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        transitions: [{
                            id: '31',
                            name: 'Close',
                            to: { name: 'Done' },
                            hasScreen: true,
                            fields: {
                                resolution: { name: 'Resolution', required: true, operations: ['set'], schema: { type: 'resolution' } },
                            },
                        }],
                    }),
                };
            }

            if (options.method === 'POST' && url.endsWith('/transitions')) {
                const payload = JSON.parse(options.body);
                assertEqual(payload.transition.id, '31', 'Expected resolved transition id');
                assertEqual(payload.fields.resolution.name, 'Fixed', 'Expected resolution to be forwarded');
                assert(Array.isArray(payload.update.comment), 'Expected transition comment update');
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected transition call: ${options.method || 'GET'} ${url}`);
        };

        try {
            const parsed = JSON.parse(await transitionTool.handler({
                ticketId: 'AOTF-777',
                targetStatus: 'Done',
                resolution: 'Fixed',
                comment: 'Work completed',
            }));
            assertEqual(parsed.success, true, 'Expected transition success');
            assertEqual(parsed.transition.toStatus, 'Done', 'Expected transitioned status to be reported');
            assertEqual(parsed.guardrail.approval.mode, 'interactive', 'Expected interactive approval mode');
            assertEqual(parsed.receipt.kind, 'mutation-receipt', 'Expected structured transition receipt');
            assert(parsed.receipt.changes.some(change => change.field === 'status'), 'Expected status diff in receipt');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: log_jira_work and update_jira_estimates call Jira timetracking endpoints', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const deps = {
            sessionContext: { sessionId: 'session-timetracking-approval' },
            chatManager: {
                requestUserInput: async () => ({ answer: 'Approve change' }),
            },
        };

        const tools = createCustomTools(sdk.defineTool, 'taskgenie', deps);
        const worklogTool = tools.find(t => t.name === 'log_jira_work');
        const estimateTool = tools.find(t => t.name === 'update_jira_estimates');

        assert(worklogTool, 'log_jira_work tool not found');
        assert(estimateTool, 'update_jira_estimates tool not found');

        const originalFetch = global.fetch;
        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;

        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        const seenCalls = [];
        global.fetch = async (url, options = {}) => {
            seenCalls.push({ url, method: options.method || 'GET', body: options.body || null });

            if (options.method === 'POST' && url.includes('/worklog')) {
                const payload = JSON.parse(options.body);
                assertEqual(payload.timeSpent, '45m', 'Expected worklog timeSpent to be forwarded');
                return {
                    ok: true,
                    status: 201,
                    json: async () => ({ id: '9001', started: payload.started, timeSpent: payload.timeSpent, timeSpentSeconds: 2700 }),
                };
            }

            if (options.method === 'PUT' && url.endsWith('/issue/AOTF-888')) {
                const payload = JSON.parse(options.body);
                assertEqual(payload.update.timetracking[0].edit.originalEstimate, '2h', 'Expected original estimate update');
                assertEqual(payload.update.timetracking[0].edit.remainingEstimate, '30m', 'Expected remaining estimate update');
                return {
                    ok: true,
                    status: 204,
                    text: async () => '',
                };
            }

            throw new Error(`Unexpected Jira call: ${options.method || 'GET'} ${url}`);
        };

        try {
            const worklogResult = JSON.parse(await worklogTool.handler({
                ticketId: 'AOTF-888',
                timeSpent: '45m',
                comment: 'Regression validation',
            }));
            assertEqual(worklogResult.success, true, 'Expected worklog success');
            assertEqual(worklogResult.guardrail.approval.mode, 'interactive', 'Expected worklog interactive approval');

            const estimateResult = JSON.parse(await estimateTool.handler({
                ticketId: 'AOTF-888',
                originalEstimate: '2h',
                remainingEstimate: '30m',
            }));
            assertEqual(estimateResult.success, true, 'Expected estimate update success');
            assertEqual(estimateResult.guardrail.approval.mode, 'interactive', 'Expected estimate interactive approval');
            assertEqual(seenCalls.length, 2, 'Expected one worklog call and one estimate call');
        } finally {
            global.fetch = originalFetch;
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: update_jira_estimates blocks generic Time Tracking hour-entry requests', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-worklog-intent';
        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[
                    sessionId,
                    {
                        messages: [
                            { role: 'user', content: 'Add 2 hours to the Time Tracking field for AOTF-888.' },
                        ],
                    },
                ]]),
            },
        });

        const estimateTool = tools.find(t => t.name === 'update_jira_estimates');
        assert(estimateTool, 'update_jira_estimates tool not found');

        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;
        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        try {
            const result = JSON.parse(await estimateTool.handler({
                ticketId: 'AOTF-888',
                remainingEstimate: '2h',
            }));

            assertEqual(result.success, false, 'Expected estimate tool to block worklog intent');
            assertEqual(result.suggestedTool, 'log_jira_work', 'Expected estimate tool to redirect to worklog');
            assertEqual(result.detectedIntent, 'worklog', 'Expected worklog intent classification');
        } finally {
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: log_jira_work blocks explicit estimate requests', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-estimate-intent';
        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[
                    sessionId,
                    {
                        messages: [
                            { role: 'user', content: 'Update the remaining estimate to 30m for AOTF-888.' },
                        ],
                    },
                ]]),
            },
        });

        const worklogTool = tools.find(t => t.name === 'log_jira_work');
        assert(worklogTool, 'log_jira_work tool not found');

        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;
        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        try {
            const result = JSON.parse(await worklogTool.handler({
                ticketId: 'AOTF-888',
                timeSpent: '30m',
            }));

            assertEqual(result.success, false, 'Expected worklog tool to block estimate intent');
            assertEqual(result.suggestedTool, 'update_jira_estimates', 'Expected worklog tool to redirect to estimate tool');
            assertEqual(result.detectedIntent, 'estimate', 'Expected estimate intent classification');
        } finally {
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: Jira time tracking tools block mixed worklog and estimate language', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const sessionId = 'session-mixed-intent';
        const tools = createCustomTools(sdk.defineTool, 'taskgenie', {
            sessionContext: { sessionId },
            chatManager: {
                _sessions: new Map([[
                    sessionId,
                    {
                        messages: [
                            { role: 'user', content: 'Add 2 hours to Time Tracking and update the remaining estimate to 30m for AOTF-888.' },
                        ],
                    },
                ]]),
            },
        });

        const estimateTool = tools.find(t => t.name === 'update_jira_estimates');
        assert(estimateTool, 'update_jira_estimates tool not found');

        const originalBaseUrl = process.env.JIRA_BASE_URL;
        const originalEmail = process.env.JIRA_EMAIL;
        const originalToken = process.env.JIRA_API_TOKEN;
        process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
        process.env.JIRA_EMAIL = 'test@example.com';
        process.env.JIRA_API_TOKEN = 'token';

        try {
            const result = JSON.parse(await estimateTool.handler({
                ticketId: 'AOTF-888',
                remainingEstimate: '30m',
            }));

            assertEqual(result.success, false, 'Expected mixed intent to be blocked');
            assertEqual(result.suggestedAction, 'clarify_time_tracking_intent', 'Expected clarify action');
            assertEqual(result.detectedIntent, 'mixed', 'Expected mixed intent classification');
        } finally {
            process.env.JIRA_BASE_URL = originalBaseUrl;
            process.env.JIRA_EMAIL = originalEmail;
            process.env.JIRA_API_TOKEN = originalToken;
        }
    }),

    test('Custom tools: fetch_jira_ticket handler is callable', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const jiraTool = tools.find(t => t.name === 'fetch_jira_ticket');

        assert(jiraTool, 'fetch_jira_ticket tool not found');
        assert(typeof jiraTool.handler === 'function', 'Tool missing handler');

        // Call with a dummy ticket — should return structured JSON (success or error)
        const result = await jiraTool.handler({ ticketId: 'TEST-999' });
        const parsed = JSON.parse(result);
        assert(typeof parsed === 'object', 'Expected JSON object result');
        // Should have either success:true with data or success:false with error
        assert('success' in parsed || 'error' in parsed, 'Expected success or error field');
    }),

    test('Custom tools: generate_test_case_excel creates file', async () => {
        const sdk = await import('@github/copilot-sdk');
        const { createCustomTools } = require('./custom-tools');

        const tools = createCustomTools(sdk.defineTool, 'testgenie', {});
        const excelTool = tools.find(t => t.name === 'generate_test_case_excel');

        assert(excelTool, 'generate_test_case_excel tool not found');

        const testSteps = JSON.stringify([
            { stepId: '1.1', action: 'Open application', expected: 'App opens', actual: 'App opens' },
            { stepId: '1.2', action: 'Click button', expected: 'Button works', actual: 'Button works' },
        ]);

        const result = await excelTool.handler({
            ticketId: 'TEST-EXCEL',
            testSuiteName: 'Integration Test Suite',
            preConditions: 'User is authenticated',
            testSteps,
        });

        const parsed = JSON.parse(result);
        assertEqual(parsed.success, true, `Excel generation failed: ${parsed.error || 'unknown'}`);
        assertEqual(parsed.stepCount, 2, 'Expected 2 steps');
        assert(parsed.path, 'Expected file path');

        // Verify file exists
        assert(fs.existsSync(parsed.path), `Excel file not created at ${parsed.path}`);

        // Clean up
        fs.unlinkSync(parsed.path);
    }),

    test('ChatSessionManager: extracts Excel artifact from wrapped tool result', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-cases');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'TEST-ATTACHMENT-test-cases.xlsx');
        fs.writeFileSync(outputPath, 'attachment regression test');

        const wrappedResult = {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        path: outputPath,
                        message: 'Excel file created: TEST-ATTACHMENT-test-cases.xlsx',
                    }),
                },
            ],
        };

        const attachments = manager._extractToolGeneratedAttachments('generateTestCaseExcel', wrappedResult);

        assertEqual(attachments.length, 1, 'Expected wrapped Excel result to create one attachment');
        assertEqual(attachments[0].path, outputPath, 'Attachment path should match generated workbook');
        assertEqual(attachments[0].actionable, true, 'Attachment should be actionable for native open');
        assertEqual(attachments[0].kind, 'artifact', 'Attachment kind should be artifact');

        fs.unlinkSync(outputPath);
    }),

    test('ChatSessionManager: dedupes same artifact across execution_complete and execution_end', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-cases');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'TEST-DEDUPE-test-cases.xlsx');
        fs.writeFileSync(outputPath, 'dedupe regression test');

        const entry = { pendingAssistantAttachments: [], sseClients: [], archived: false };
        manager._sessions.set('test-session', entry);

        const event = {
            data: {
                toolName: 'generate_test_case_excel',
                toolCallId: 'tool-1',
                success: true,
                result: JSON.stringify({ success: true, path: outputPath, message: 'Excel file created' }),
            },
        };

        manager._handleToolExecutionFinished('test-session', entry, event, 'tool.execution_complete');
        manager._handleToolExecutionFinished('test-session', entry, event, 'tool.execution_end');

        const attachments = manager._consumePendingAssistantAttachments(entry);
        assertEqual(attachments.length, 1, 'Expected duplicate completion events to queue only one attachment');
        assertEqual(attachments[0].path, outputPath, 'Attachment path should match generated workbook');

        manager._sessions.delete('test-session');
        fs.unlinkSync(outputPath);
    }),

    test('ChatSessionManager: extracts generated artifact attachment from assistant message content', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-cases');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'TEST-CONTENT-FALLBACK-test-cases.xlsx');
        fs.writeFileSync(outputPath, 'content fallback regression test');

        const content = `Excel Export: agentic-workflow/test-cases/${path.basename(outputPath)}`;
        const attachments = manager._extractAssistantContentArtifactAttachments(content);

        assertEqual(attachments.length, 1, 'Expected assistant message content path to create one attachment');
        assertEqual(attachments[0].path, outputPath, 'Content-based attachment path should match generated workbook');
        assertEqual(attachments[0].actionable, true, 'Content-based attachment should be actionable');

        fs.unlinkSync(outputPath);
    }),

    test('ChatSessionManager: extracts generated artifact path with spaces from assistant message content', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-cases', 'artifact space dir');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'TEST CONTENT SPACE.xlsx');
        fs.writeFileSync(outputPath, 'content path with spaces regression test');

        const content = `Generated file at ${outputPath}`;
        const attachments = manager._extractAssistantContentArtifactAttachments(content);

        assertEqual(attachments.length, 1, 'Expected assistant content with spaced path to create one attachment');
        assertEqual(attachments[0].path, outputPath, 'Spaced content path should resolve to generated workbook');
        assertEqual(attachments[0].actionable, true, 'Spaced content path attachment should remain actionable');

        fs.unlinkSync(outputPath);
    }),

    test('ChatSessionManager: extracts DocGenie pptx artifact from filePath payload', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-artifacts');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'AOTF-DOCGENIE-ARTIFACT.pptx');
        fs.writeFileSync(outputPath, 'docgenie pptx extraction regression test');

        const attachments = manager._extractToolGeneratedAttachments('generate_pptx', {
            success: true,
            filePath: outputPath,
            fileName: path.basename(outputPath),
            slideCount: 6,
            message: 'PPTX generated successfully',
        });

        assertEqual(attachments.length, 1, 'Expected DocGenie filePath payload to create one artifact attachment');
        assertEqual(attachments[0].path, outputPath, 'DocGenie attachment path should match generated PPTX');
        assertEqual(attachments[0].actionable, true, 'DocGenie attachment should be actionable for native open');

        fs.unlinkSync(outputPath);
    }),

    test('ChatSessionManager: extracts spec artifact from generic tool result without a descriptor', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: {
                sdk: { grounding: { enabled: false } },
                projectPaths: { specsDir: 'tests/specs' },
            },
        });

        const outputDir = path.join(__dirname, '..', '..', 'tests', 'specs', 'artifact-regression');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'AOTF-ARTIFACT.spec.js');
        fs.writeFileSync(outputPath, 'module.exports = {};');

        const attachments = manager._extractToolGeneratedAttachments('save_script_file', {
            success: true,
            specPath: outputPath,
            message: 'Spec generated successfully',
        });

        assertEqual(attachments.length, 1, 'Expected generic tool result to create one spec attachment');
        assertEqual(attachments[0].path, outputPath, 'Spec attachment path should match generated spec');
        assertEqual(attachments[0].name, 'AOTF-ARTIFACT.spec.js', 'Spec attachment should preserve filename');

        fs.unlinkSync(outputPath);
        fs.rmdirSync(outputDir);
    }),

    test('ChatSessionManager: sanitizes generated artifact paths from assistant content', async () => {
        const { ChatSessionManager } = require('./chat-session-manager');

        const manager = new ChatSessionManager({
            client: null,
            defineTool: () => null,
            model: 'test-model',
            config: { sdk: { grounding: { enabled: false } } },
        });

        const outputDir = path.join(__dirname, '..', 'test-cases');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'TEST-SANITIZE-test-cases.xlsx');
        fs.writeFileSync(outputPath, 'sanitize regression test');

        const attachment = manager._createAssistantArtifactAttachment(outputPath, {
            label: 'Generated workbook',
            sourceTool: 'generate_test_case_excel',
        });
        const content = `Workbook saved to ${outputPath} and also linked as [download](${attachment.relativePath}).`;
        const sanitized = manager._sanitizeAssistantArtifactContent(content, [attachment]);

        assert(!sanitized.includes(outputPath), 'Sanitized content should not include the absolute file path');
        assert(!sanitized.includes(attachment.relativePath), 'Sanitized content should not include the relative file path');
        assert(sanitized.includes(attachment.name), 'Sanitized content should keep the artifact filename');
        assert(sanitized.includes('download'), 'Sanitized content should keep the markdown label text');

        fs.unlinkSync(outputPath);
    }),

    // ── 14. Learning Store Bounds ───────────────────────────────────
    test('LearningStore: respects max entry limits', async () => {
        const { LearningStore } = require('./learning-store');
        const testPath = path.join(__dirname, '..', 'learning-data', 'test-bounds.json');
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);

        const ls = new LearningStore(testPath);

        // Add 510 failures (limit is 500)
        for (let i = 0; i < 510; i++) {
            ls.recordFailure({
                ticketId: `TEST-${i}`,
                page: `/page-${i}`,
                errorType: 'TEST',
                selector: '.s',
                fix: '.f',
                outcome: 'fixed',
                method: 'test',
            });
        }

        assert(ls.getStats().totalFailures <= 500, `Expected ≤500, got ${ls.getStats().totalFailures}`);

        // Clean up
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    }),

];

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   SDK ORCHESTRATOR — Integration Test Suite');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const startTime = Date.now();

    for (const t of tests) {
        await runTest(t);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   RESULTS: ${passed} passed, ${failed} failed (${duration}s)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (failed > 0) {
        console.log('Failed tests:');
        results.filter(r => r.status.includes('FAIL')).forEach(r => {
            console.log(`  ❌ ${r.name}: ${r.error}`);
        });
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
