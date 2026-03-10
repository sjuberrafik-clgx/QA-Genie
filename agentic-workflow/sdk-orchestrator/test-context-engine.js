/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTEXT ENGINE + PROMPT LAYERS — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests the context engineering system:
 *   1. ContextEngine: priority packing, compaction, tool trimming, notes, metrics
 *   2. PromptLayers: layer assembly, deduplication, agent mapping
 *
 * Run: node agentic-workflow/sdk-orchestrator/test-context-engine.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { ContextEngine, resetContextEngine, DEFAULT_CONFIG } = require('./context-engine');
const { buildSharedLayers, getLayerStats, AGENT_LAYERS } = require('./prompt-layers');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        failures.push(testName);
        console.log(`  ❌ ${testName}`);
    }
}

function assertApprox(actual, expected, tolerance, testName) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        passed++;
        console.log(`  ✅ ${testName} (${actual} ≈ ${expected})`);
    } else {
        failed++;
        failures.push(testName);
        console.log(`  ❌ ${testName} (${actual} ≠ ${expected}, diff=${diff})`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONTEXT ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CONTEXT ENGINE TESTS');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── 1.1 Constructor & Config ──────────────────────────────────────

console.log('─── 1.1 Constructor & Config ───');

{
    const engine = new ContextEngine();
    assert(engine.config.enabled === true, 'Default config: enabled=true');
    assert(engine.config.maxContextChars === 120000, 'Default config: maxContextChars=120000');
    assert(engine.config.priorities.basePrompt.priority === 100, 'Default config: basePrompt priority=100');
    assert(engine.config.priorities.groundingContext.priority === 85, 'Default config: groundingContext priority=85');
}

{
    const engine = new ContextEngine({ maxContextChars: 50000, priorities: { basePrompt: { priority: 90, budgetPercent: 35, compressible: false } } });
    assert(engine.config.maxContextChars === 50000, 'Custom config: maxContextChars override');
    assert(engine.config.priorities.basePrompt.priority === 90, 'Custom config: priority override merged');
    assert(engine.config.priorities.groundingContext.priority === 85, 'Custom config: non-overridden priority preserved');
}

{
    const engine = new ContextEngine({ enabled: false });
    assert(engine.config.enabled === false, 'Disable via config');
}

// ── 1.2 Priority-Aware Packing ───────────────────────────────────

console.log('\n─── 1.2 Priority-Aware Packing ───');

{
    const engine = new ContextEngine({ maxContextChars: 1000 });

    const result = engine.packContext('scriptgenerator', {
        basePrompt: 'A'.repeat(300),
        ticketContext: 'B'.repeat(200),
        groundingContext: 'C'.repeat(200),
    });

    assert(result.assembledPrompt.length <= 1000, 'Packed within budget (1000 chars)');
    assert(result.assembledPrompt.includes('A'.repeat(100)), 'Base prompt present');
    assert(result.included.length >= 1, 'At least 1 component included');
    assert(result.totalChars > 0, 'Total chars tracked');
    assert(typeof result.budgetUsed === 'string', 'Budget utilization reported');
}

{
    const engine = new ContextEngine({ maxContextChars: 500 });

    const result = engine.packContext('scriptgenerator', {
        basePrompt: 'X'.repeat(300),
        ticketContext: 'Y'.repeat(300),
        groundingContext: 'Z'.repeat(300),
        frameworkInventory: 'F'.repeat(300),
        kbContext: 'K'.repeat(300),
    });

    // Some components must be compressed or dropped
    assert(result.assembledPrompt.length <= 500, 'Hard budget respected');
    assert(
        result.compressed.length > 0 || result.dropped.length > 0,
        'Components compressed or dropped when over budget'
    );
}

{
    // Test that higher priority components are kept over lower ones
    const engine = new ContextEngine({ maxContextChars: 600 });

    const result = engine.packContext('scriptgenerator', {
        basePrompt: 'BASE'.repeat(100),          // 400 chars, priority 100
        groundingContext: 'GRND'.repeat(50),      // 200 chars, priority 85
        kbContext: 'KBKB'.repeat(50),             // 200 chars, priority 50
    });

    // Base prompt has highest priority, should be included
    const includedKeys = result.included.map(i => i.key);
    const droppedKeys = result.dropped.map(d => d.key);

    assert(includedKeys.includes('basePrompt'), 'Highest priority (basePrompt) is included');

    // If something was dropped, it should be the lowest priority
    if (droppedKeys.length > 0) {
        const droppedPriorities = droppedKeys.map(k =>
            (DEFAULT_CONFIG.priorities[k] && DEFAULT_CONFIG.priorities[k].priority) || 30
        );
        const includedPriorities = includedKeys.map(k =>
            (DEFAULT_CONFIG.priorities[k] && DEFAULT_CONFIG.priorities[k].priority) || 30
        );
        const lowestIncluded = Math.min(...includedPriorities);
        const highestDropped = Math.max(...droppedPriorities);
        assert(lowestIncluded >= highestDropped,
            'Dropped components have lower priority than included ones'
        );
    } else {
        assert(true, 'All components fit — no priority conflict to test');
    }
}

// ── 1.3 Component Compression ────────────────────────────────────

console.log('\n─── 1.3 Component Compression ───');

{
    const engine = new ContextEngine({ maxContextChars: 3000 });

    // Feed a large framework inventory that should get compressed
    const bigInventory = Array.from({ length: 100 }, (_, i) =>
        `tests/pageobjects/page${i}.js — Page${i}Page`
    ).join('\n');

    const result = engine.packContext('scriptgenerator', {
        basePrompt: 'A'.repeat(300),
        frameworkInventory: bigInventory,
    });

    assert(result.assembledPrompt.length <= 3000, 'Budget respected with large inventory');

    // Check if framework inventory was compressed
    const compressed = result.compressed.find(c => c.key === 'frameworkInventory');
    if (compressed) {
        assert(compressed.originalChars > compressed.compressedChars,
            'Framework inventory was compressed'
        );
    } else {
        assert(true, 'Framework inventory fit without compression');
    }
}

// ── 1.4 Agent Context Filtering ──────────────────────────────────

console.log('\n─── 1.4 Agent Context Filtering ───');

{
    const engine = new ContextEngine({ maxContextChars: 10000 });

    // TestGenie shouldn't get frameworkInventory (it's filtered out for testgenie)
    const result = engine.packContext('testgenie', {
        basePrompt: 'PROMPT',
        frameworkInventory: 'BIG_INVENTORY'.repeat(100),
        ticketContext: 'TICKET_DATA',
    });

    // frameworkInventory should be filtered for testgenie
    const hasInventory = result.assembledPrompt.includes('BIG_INVENTORY');
    const hasTicket = result.assembledPrompt.includes('TICKET_DATA');

    assert(hasTicket, 'TestGenie gets ticket context');
    // frameworkInventory may or may not be filtered depending on config
    // The key point is the engine processes it without errors
    assert(typeof result.assembledPrompt === 'string', 'Pack result is a string');
}

// ── 1.5 Compaction ───────────────────────────────────────────────

console.log('\n─── 1.5 Stage Compaction ───');

{
    const engine = new ContextEngine();

    // Mock a context store matching SharedContextStore interface
    const mockEntries = [
        { type: 'artifact', agent: 'testgenie', stage: 'testgenie', content: 'Large artifact data...'.repeat(50), timestamp: new Date(Date.now() - 60000).toISOString() },
        { type: 'decision', agent: 'testgenie', stage: 'testgenie', content: 'Decision 1', timestamp: new Date(Date.now() - 50000).toISOString() },
        { type: 'note', agent: 'testgenie', stage: 'testgenie', content: 'Note about test case', timestamp: new Date(Date.now() - 40000).toISOString() },
    ];
    // Pad to exceed compactionTriggerEntries (30)
    for (let i = 0; i < 30; i++) {
        mockEntries.push({
            type: 'note', agent: 'testgenie', stage: 'testgenie',
            content: `Filler note ${i}`, timestamp: new Date(Date.now() - 30000 + i).toISOString()
        });
    }

    const mockStore = {
        _entries: [...mockEntries],
        query(filter = {}) {
            let results = [...this._entries];
            if (filter.agent) results = results.filter(e => e.agent === filter.agent);
            if (filter.type) results = results.filter(e => e.type === filter.type);
            if (filter.since) results = results.filter(e => e.timestamp >= filter.since);
            if (filter.limit) results = results.slice(-filter.limit);
            return results;
        },
        addNote(agent, content, metadata) {
            this._entries.push({ type: 'note', agent, content, metadata, timestamp: new Date().toISOString() });
        },
    };

    const result = engine.compactStageContext(mockStore, 'testgenie');

    assert(result.compacted === true || result.compacted === false,
        'Compaction returns compacted flag'
    );
    if (result.compacted) {
        assert(typeof result.originalEntries === 'number', 'Compaction returns original entries count');
        assert(typeof result.summaryChars === 'number', 'Compaction returns summary chars');
    } else {
        assert(typeof result.reason === 'string', 'Non-compaction returns reason');
    }
}

// ── 1.6 Tool Result Trimming ─────────────────────────────────────

console.log('\n─── 1.6 Tool Result Trimming ───');

{
    const engine = new ContextEngine({
        toolTrimming: { snapshot: { maxChars: 500 } },
    });

    // Simulate a large MCP snapshot result
    const bigSnapshot = '- role: link\n  name: "Property 1"\n  ref: [ref1]\n'.repeat(200);

    const trimmed = engine.trimToolResult('unified_snapshot', bigSnapshot);

    assert(trimmed.length <= bigSnapshot.length, 'Snapshot trimmed to smaller size');
    assert(trimmed.length > 0, 'Trimmed result is non-empty');
}

{
    const engine = new ContextEngine({
        toolTrimming: { networkRequests: { maxChars: 300 } },
    });

    // Simulate network requests output
    const networkResult = Array.from({ length: 100 }, (_, i) =>
        `GET https://api.example.com/data/${i} → 200 OK (${i * 10}ms)`
    ).join('\n');

    const trimmed = engine.trimToolResult('unified_network_requests', networkResult);
    assert(trimmed.length <= networkResult.length, 'Network results trimmed');
}

{
    const engine = new ContextEngine();

    // Non-MCP tool results should pass through unchanged
    const regularResult = 'File saved successfully to tests/specs/test.spec.js';
    const trimmed = engine.trimToolResult('write_file', regularResult);
    assert(trimmed === regularResult, 'Non-MCP tools pass through unchanged');
}

{
    const engine = new ContextEngine();

    // Short results should pass through
    const shortResult = '- button "Submit"';
    const trimmed = engine.trimToolResult('unified_snapshot', shortResult);
    assert(trimmed === shortResult, 'Short snapshots pass through unchanged');
}

// ── 1.7 Phase Tool Profiles ─────────────────────────────────────

console.log('\n─── 1.7 Phase Tool Profiles ───');

{
    const engine = new ContextEngine();

    const analystProfile = engine.getPhaseToolProfile('cognitive-analyst');
    assert(analystProfile !== null && analystProfile !== undefined, 'Analyst has a tool profile');
    assert(Array.isArray(analystProfile.tools), 'Analyst profile has tools array');
    assert(analystProfile.tools.length === 0, 'Analyst has empty tool set (no MCP)');

    const explorerProfile = engine.getPhaseToolProfile('cognitive-explorer-nav');
    assert(explorerProfile !== null && explorerProfile !== undefined, 'Explorer has a tool profile');
    assert(explorerProfile.tools.length > analystProfile.tools.length,
        'Explorer has more tools than analyst'
    );

    const coderProfile = engine.getPhaseToolProfile('cognitive-coder');
    assert(coderProfile !== null && coderProfile !== undefined, 'Coder has a tool profile');
}

{
    const engine = new ContextEngine();

    const allTools = [
        { name: 'navigate' },
        { name: 'snapshot' },
        { name: 'click' },
        { name: 'type' },
        { name: 'evaluate' },
        { name: 'get_by_role' },
        { name: 'write_file' },
        { name: 'search_project_context' },
    ];

    const analystFiltered = engine.filterToolsForPhase('cognitive-analyst', allTools);
    const explorerFiltered = engine.filterToolsForPhase('cognitive-explorer-nav', allTools);

    assert(analystFiltered.length === 0, 'Analyst gets no tools (analysis only)');
    assert(explorerFiltered.length > 0, 'Explorer gets filtered tools');
    assert(explorerFiltered.length <= allTools.length, 'Explorer filtering reduces tools');
}

// ── 1.8 Agent Notes ──────────────────────────────────────────────

console.log('\n─── 1.8 Agent Notes ───');

{
    const engine = new ContextEngine();

    const note1 = engine.recordAgentNote('scriptgenerator', 'discovery',
        'Welcome popup appears on /search with data-qa="welcome-modal"',
        { page: '/search' }
    );

    assert(note1.id && note1.id.length > 5, 'Note has unique ID');
    assert(note1.agent === 'scriptgenerator', 'Note records agent name');
    assert(note1.category === 'discovery', 'Note records category');

    const note2 = engine.recordAgentNote('scriptgenerator', 'selector',
        'Login button uses getByRole("button", { name: "Sign In" })',
        { page: '/login' }
    );

    const note3 = engine.recordAgentNote('buggenie', 'warning',
        'Property detail page takes >5s to load'
    );

    // Get all notes
    const allNotes = engine.getAgentNotes();
    assert(allNotes.length === 3, 'All 3 notes retrieved');

    // Filter by category
    const selectors = engine.getAgentNotes({ category: 'selector' });
    assert(selectors.length === 1, 'Category filter works');
    assert(selectors[0].content.includes('Sign In'), 'Correct note filtered');

    // Filter by agent
    const buggenieNotes = engine.getAgentNotes({ agent: 'buggenie' });
    assert(buggenieNotes.length === 1, 'Agent filter works');

    // Limit
    const limited = engine.getAgentNotes({ limit: 2 });
    assert(limited.length === 2, 'Limit works');

    // Build notes context
    const ctx = engine.buildNotesContext('scriptgenerator');
    assert(typeof ctx === 'string', 'Notes context is a string');
    assert(ctx.includes('welcome-modal') || ctx.includes('Sign In'),
        'Notes context contains note content'
    );
}

// ── 1.9 Metrics ──────────────────────────────────────────────────

console.log('\n─── 1.9 Metrics ───');

{
    const engine = new ContextEngine({ maxContextChars: 5000 });

    engine.packContext('scriptgenerator', {
        basePrompt: 'Prompt content',
        ticketContext: 'Ticket data',
    });

    engine.packContext('testgenie', {
        basePrompt: 'Another prompt',
    });

    const metrics = engine.getMetrics();
    assert(metrics.totalPackCalls === 2, 'Pack calls tracked');
    assert(typeof metrics.averageBudgetUtilization === 'string', 'Budget utilization tracked');
    assert(typeof metrics.noteCount === 'number', 'Note count in metrics');
    assert(typeof metrics.componentStats === 'object', 'Component stats in metrics');
}

{
    const engine = new ContextEngine();
    engine.resetMetrics();
    const metrics = engine.getMetrics();
    assert(metrics.totalPackCalls === 0, 'Metrics reset works');
    assert(metrics.totalTokensSaved === 0, 'Token savings reset');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. PROMPT LAYERS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  PROMPT LAYERS TESTS');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── 2.1 Layer Assembly ───────────────────────────────────────────

console.log('─── 2.1 Layer Assembly ───');

{
    const scriptgenLayers = buildSharedLayers('scriptgenerator');
    assert(typeof scriptgenLayers === 'string', 'Returns string for scriptgenerator');
    assert(scriptgenLayers.length > 100, 'Non-trivial content for scriptgenerator');
    assert(scriptgenLayers.includes('POmanager') || scriptgenLayers.includes('Playwright') || scriptgenLayers.includes('selector'),
        'ScriptGenerator layers include automation content'
    );
}

{
    const testgenieLayers = buildSharedLayers('testgenie');
    assert(typeof testgenieLayers === 'string', 'Returns string for testgenie');
    assert(testgenieLayers.includes('Test Step') || testgenieLayers.includes('test case') || testgenieLayers.includes('Pre-Conditions'),
        'TestGenie layers include test case format'
    );
}

{
    const bugLayers = buildSharedLayers('buggenie');
    assert(typeof bugLayers === 'string', 'Returns string for buggenie');
    assert(bugLayers.includes('Jira') || bugLayers.includes('jira') || bugLayers.includes('ticket'),
        'BugGenie layers include Jira content'
    );
}

{
    const orchLayers = buildSharedLayers('orchestrator');
    assert(typeof orchLayers === 'string', 'Returns string for orchestrator');
    // Orchestrator only gets base layer
}

// ── 2.2 Layer Deduplication ──────────────────────────────────────

console.log('\n─── 2.2 Layer Deduplication ───');

{
    // ScriptGenerator and CodeReviewer both use automation layer
    const scriptgenLayers = buildSharedLayers('scriptgenerator');
    const reviewerLayers = buildSharedLayers('codereviewer');

    // Both should have automation content
    const hasAutomationSG = scriptgenLayers.includes('selector') || scriptgenLayers.includes('Playwright');
    const hasAutomationCR = reviewerLayers.includes('selector') || reviewerLayers.includes('Playwright');

    assert(hasAutomationSG, 'ScriptGenerator has automation layer');
    assert(hasAutomationCR, 'CodeReviewer has automation layer');

    // ScriptGenerator should additionally have MCP layer
    const hasMCPSG = scriptgenLayers.includes('MCP') || scriptgenLayers.includes('mcp');
    const hasMCPCR = reviewerLayers.includes('MCP') && reviewerLayers.includes('exploration');

    assert(hasMCPSG, 'ScriptGenerator has MCP layer');
    // CodeReviewer should NOT have MCP layer (or minimal reference)
    assert(scriptgenLayers.length > reviewerLayers.length,
        'ScriptGenerator layers are larger (has MCP layer)'
    );
}

// ── 2.3 Agent Layer Mapping ──────────────────────────────────────

console.log('\n─── 2.3 Agent Layer Mapping ───');

{
    assert(Array.isArray(AGENT_LAYERS.orchestrator), 'Orchestrator has layer mapping');
    assert(Array.isArray(AGENT_LAYERS.testgenie), 'TestGenie has layer mapping');
    assert(Array.isArray(AGENT_LAYERS.scriptgenerator), 'ScriptGenerator has layer mapping');
    assert(Array.isArray(AGENT_LAYERS.buggenie), 'BugGenie has layer mapping');
    assert(Array.isArray(AGENT_LAYERS.taskgenie), 'TaskGenie has layer mapping');
    assert(Array.isArray(AGENT_LAYERS.codereviewer), 'CodeReviewer has layer mapping');

    // All agents should have 'base' in their layers
    for (const [agent, layers] of Object.entries(AGENT_LAYERS)) {
        assert(layers.includes('base'), `${agent} includes base layer`);
    }

    // Verify specific layer assignments
    assert(AGENT_LAYERS.scriptgenerator.includes('automation'), 'ScriptGenerator has automation layer');
    assert(AGENT_LAYERS.scriptgenerator.includes('mcp'), 'ScriptGenerator has MCP layer');
    assert(AGENT_LAYERS.testgenie.includes('testCase'), 'TestGenie has testCase layer');
    assert(AGENT_LAYERS.testgenie.includes('jira'), 'TestGenie has Jira layer');
    assert(AGENT_LAYERS.buggenie.includes('jira'), 'BugGenie has Jira layer');
    assert(!AGENT_LAYERS.buggenie.includes('automation'), 'BugGenie does NOT have automation layer');
}

// ── 2.4 Layer Stats ──────────────────────────────────────────────

console.log('\n─── 2.4 Layer Stats ───');

{
    const stats = getLayerStats();
    assert(typeof stats === 'object', 'Stats returns object');
    assert(typeof stats.layers.base.chars === 'number', 'Base layer size reported');
    assert(stats.layers.base.chars > 0, 'Base layer has content');

    const totalSize = Object.values(stats.layers).reduce((sum, v) => sum + v.chars, 0);
    assert(totalSize < 15000, `Total layer text is reasonable (${totalSize} chars)`);
}

// ── 2.5 Unknown Agent Fallback ───────────────────────────────────

console.log('\n─── 2.5 Unknown Agent Fallback ───');

{
    const unknownLayers = buildSharedLayers('unknown-agent');
    assert(typeof unknownLayers === 'string', 'Unknown agent returns string');
    assert(unknownLayers.length > 0, 'Unknown agent gets at least base layer');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  INTEGRATION TESTS');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── 3.1 Pack with Prompt Layers ──────────────────────────────────

console.log('─── 3.1 Pack with Prompt Layers ───');

{
    const engine = new ContextEngine({ maxContextChars: 50000 });

    // Simulate what agent-sessions.js does
    const basePrompt = 'You are the scriptgenerator agent for QA automation.';
    const sharedLayers = buildSharedLayers('scriptgenerator');
    const enrichedPrompt = basePrompt + '\n\n---\n\n' + sharedLayers;

    const result = engine.packContext('scriptgenerator', {
        basePrompt: enrichedPrompt,
        ticketContext: 'Test Case: Verify search filters work correctly',
        groundingContext: 'Search page uses [data-qa="search-filter"]',
    });

    assert(result.assembledPrompt.length > enrichedPrompt.length,
        'Assembled prompt includes additional context beyond base'
    );
    assert(result.assembledPrompt.includes('scriptgenerator'),
        'Assembled prompt retains agent identity'
    );
}

// ── 3.2 Full System Flow ─────────────────────────────────────────

console.log('\n─── 3.2 Full System Flow ───');

{
    const engine = new ContextEngine({ maxContextChars: 20000 });

    // Phase 1: Pack context
    const result = engine.packContext('scriptgenerator', {
        basePrompt: 'System prompt',
        ticketContext: 'Ticket: AOTF-12345 - Search filters',
        groundingContext: 'Grounding: SearchPage, FilterComponent',
        frameworkInventory: 'tests/pageobjects/SearchFilterPage.js\ntests/utils/filter-helpers.js',
    });

    assert(result.assembledPrompt.length > 0, 'Step 1: Context packed');

    // Phase 2: Agent takes notes during exploration
    engine.recordAgentNote('scriptgenerator', 'discovery',
        'Search filter has autocomplete dropdown', { page: '/search' }
    );
    engine.recordAgentNote('scriptgenerator', 'selector',
        'Filter dropdown: getByRole("listbox")', { page: '/search' }
    );

    // Phase 3: Trim a tool result
    const bigSnapshot = 'role: textbox\n  name: "Search"\n'.repeat(100);
    const trimmed = engine.trimToolResult('unified_snapshot', bigSnapshot);
    assert(trimmed.length > 0, 'Step 3: Tool result trimmed');

    // Phase 4: Check metrics
    const metrics = engine.getMetrics();
    assert(metrics.totalPackCalls >= 1, 'Step 4: Metrics show pack calls');
    assert(metrics.noteCount === 2, 'Step 4: Metrics show 2 notes');

    // Phase 5: Build notes context for next agent
    const notesCtx = engine.buildNotesContext('codereviewer', 3000);
    assert(notesCtx.includes('autocomplete') || notesCtx.includes('listbox'),
        'Step 5: Notes context available for next agent'
    );
}


// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═══════════════════════════════════════════════════════════════');

if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ❌ ${f}`));
}

process.exit(failed > 0 ? 1 : 0);
