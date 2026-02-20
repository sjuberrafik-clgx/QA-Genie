/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MCP Real-Time Exploration Runner v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * OPTIMIZED MCP EXECUTION ENGINE using both:
 * - Playwright MCP (primary for interactions)
 * - Chrome DevTools MCP (specialized tasks)
 * 
 * This module provides:
 * - Correct tool name mappings
 * - Unified exploration workflow
 * - Automatic selector generation from snapshots
 * - Robust error handling
 * 
 * Usage: Called by agents to perform live browser exploration
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { MCP_TOOLS, TOOL_ALIASES, Tools } = require('./shared/mcp-tool-names');
const { SelectorEngineLite } = require('../mcp-server/utils/selector-engine-cjs.cjs');

// Backwards-compatible alias � MCP_COMMANDS maps to canonical MCP_TOOLS
const MCP_COMMANDS = MCP_TOOLS;

// Import shared ExplorationSession (single source of truth)
const { ExplorationSession, parseSnapshotYaml: _parseSnapshotYaml } = require('./shared/exploration-session');

/**
 * Parse Playwright MCP snapshot YAML into structured elements
 */
function parseSnapshotYaml(snapshotYaml) {
    const elements = [];
    if (!snapshotYaml || typeof snapshotYaml !== 'string') return elements;

    const lines = snapshotYaml.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const refMatch = trimmed.match(/\[ref=([^\]]+)\]/);
        if (!refMatch) continue;

        const ref = refMatch[1];
        const roleMatch = trimmed.match(/^-?\s*(\w+)/);
        const role = roleMatch ? roleMatch[1] : 'unknown';

        const nameMatch = trimmed.match(/:\s*(.+)$/);
        let name = '';
        if (nameMatch) {
            name = nameMatch[1].trim();
            if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
        }

        const urlMatch = trimmed.match(/\/url:\s*([^\s\]]+)/);
        const url = urlMatch ? urlMatch[1] : null;

        const cursorMatch = trimmed.match(/\[cursor=([^\]]+)\]/);
        const cursor = cursorMatch ? cursorMatch[1] : null;

        elements.push({
            ref,
            role,
            name,
            url,
            cursor,
            isClickable: cursor === 'pointer' || ['button', 'link', 'checkbox', 'menuitem'].includes(role),
            selector: generatePlaywrightSelector(role, name, ref),
            rawLine: trimmed
        });
    }
    return elements;
}

/**
 * Exploration Plan Generator
 * Creates step-by-step instructions for the agent to execute
 */
function createExplorationInstructions(ticketId, testCases, options = {}) {
    const baseUrl = options.baseUrl || '';
    const token = options.token || '';

    console.log('═'.repeat(70));
    console.log('🎭 MCP EXPLORATION INSTRUCTIONS v2.0');
    console.log('═'.repeat(70));
    console.log(`\n📋 Ticket: ${ticketId}`);
    console.log(`🌐 Environment: ${options.environment || 'UAT'}`);
    console.log(`🔗 Base URL: ${baseUrl || 'Not specified'}`);
    console.log('');
    console.log('CRITICAL: Execute these MCP commands IN ORDER:');
    console.log('─'.repeat(70));

    const instructions = [];
    let stepNum = 1;

    // Step 1: Navigate (using PLAYWRIGHT MCP)
    instructions.push({
        step: stepNum++,
        action: 'NAVIGATE TO APPLICATION',
        mcpTool: MCP_COMMANDS.PLAYWRIGHT.navigate,
        params: {
            url: `${baseUrl}${token ? `?token=${token}` : ''}`
        },
        purpose: 'Load the application with authentication'
    });

    // Step 2: Wait for page
    instructions.push({
        step: stepNum++,
        action: 'WAIT FOR PAGE LOAD',
        mcpTool: MCP_COMMANDS.PLAYWRIGHT.waitFor,
        params: { time: 2 },
        purpose: 'Wait for page to stabilize'
    });

    // Step 3: Take Snapshot (PLAYWRIGHT - returns refs for clicking)
    instructions.push({
        step: stepNum++,
        action: 'CAPTURE PAGE SNAPSHOT',
        mcpTool: MCP_COMMANDS.PLAYWRIGHT.snapshot,
        params: {},
        purpose: 'Get accessibility tree with element refs for clicking',
        important: 'STORE the refs from this snapshot to use in click operations'
    });

    // Step 4: Handle popup if present
    instructions.push({
        step: stepNum++,
        action: 'HANDLE POPUP (if present)',
        mcpTool: MCP_COMMANDS.PLAYWRIGHT.click,
        params: { element: 'Continue/OK button', ref: 'GET_FROM_SNAPSHOT' },
        purpose: 'Dismiss any modals or popups',
        conditional: true
    });

    // Add test case specific steps
    if (testCases && testCases.length > 0) {
        for (const tc of testCases) {
            instructions.push({
                step: stepNum++,
                action: `EXPLORE FOR: ${tc.name || tc.description || 'Test Case'}`,
                substeps: [
                    `Take snapshot: ${MCP_COMMANDS.PLAYWRIGHT.snapshot}`,
                    'Find target element ref in snapshot output',
                    `Click element: ${MCP_COMMANDS.PLAYWRIGHT.click} with { element: "description", ref: "eXX" }`,
                    `Verify with snapshot: ${MCP_COMMANDS.PLAYWRIGHT.snapshot}`
                ],
                testCaseId: tc.id
            });
        }
    }

    // Final snapshot
    instructions.push({
        step: stepNum++,
        action: 'FINAL STATE CAPTURE',
        mcpTool: MCP_COMMANDS.PLAYWRIGHT.snapshot,
        params: {},
        purpose: 'Capture final state for script generation'
    });

    return instructions;
}

/**
 * Format instructions for agent display
 */
function formatInstructionsForAgent(instructions) {
    const lines = [];

    lines.push('\n📋 STEP-BY-STEP MCP EXPLORATION COMMANDS:\n');

    for (const inst of instructions) {
        lines.push(`\n### Step ${inst.step}: ${inst.action}`);

        if (inst.mcpTool) {
            lines.push(`**Tool:** \`${inst.mcpTool}\``);
            lines.push(`**Params:** \`${JSON.stringify(inst.params)}\``);
        }

        if (inst.purpose) {
            lines.push(`**Purpose:** ${inst.purpose}`);
        }

        if (inst.substeps) {
            lines.push('**Substeps:**');
            inst.substeps.forEach((s, i) => {
                lines.push(`  ${i + 1}. ${s}`);
            });
        }
    }

    return lines.join('\n');
}

/**
 * Parse MCP snapshot response into structured data
 */
function parseSnapshotResponse(snapshotText) {
    const elements = [];

    if (!snapshotText || typeof snapshotText !== 'string') {
        return elements;
    }

    // MCP snapshot format: [ref] role "name" [attributes]
    // Example: [ref=e1] button "Submit" [focused]
    // Example: [ref=e2] link "Terms of Service" [url=https://...]

    const lines = snapshotText.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Extract ref
        const refMatch = trimmed.match(/\[ref=([^\]]+)\]/);
        const ref = refMatch ? refMatch[1] : null;

        // Skip lines without refs (they're not interactable)
        if (!ref) continue;

        // Extract role (word after ref)
        const afterRef = trimmed.substring(refMatch ? refMatch.index + refMatch[0].length : 0).trim();
        const parts = afterRef.split(/\s+/);
        const role = parts[0] || 'unknown';

        // Extract name in quotes
        const nameMatch = trimmed.match(/"([^"]+)"/);
        const name = nameMatch ? nameMatch[1] : '';

        // Extract URL if present
        const urlMatch = trimmed.match(/\[url=([^\]]+)\]/);
        const url = urlMatch ? urlMatch[1] : null;

        elements.push({
            ref,
            role,
            name,
            url,
            rawLine: trimmed,
            // Generate best Playwright selector
            selector: generatePlaywrightSelector(role, name)
        });
    }

    return elements;
}

/**
 * Generate optimal Playwright selector from element info.
 * Uses SelectorEngineLite for CJS-compatible role mapping and detection.
 * Full SelectorEngine scoring is done at snapshot capture time in the MCP bridge.
 */
function generatePlaywrightSelector(role, name, ref = null) {
    // Build a role-based selector (the primary strategy from ARIA snapshot data)
    let roleSelector = null;
    if (name && role !== 'generic' && role !== 'unknown') {
        const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '\\"');
        const ariaRole = SelectorEngineLite.mapAriaRole(role) || role;
        if (ariaRole) {
            roleSelector = `page.getByRole('${ariaRole}', { name: '${escapedName}' })`;
        }
    }

    // Text fallback for roles without a mapping
    let textSelector = null;
    if (!roleSelector && name && name.length < 100 && !SelectorEngineLite.isDynamicText(name)) {
        const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '\\"');
        textSelector = `page.getByText('${escapedName}')`;
    }

    return {
        byRef: ref ? `page.locator('[ref="${ref}"]')` : null,
        byRole: roleSelector,
        recommended: roleSelector || textSelector,
        strategy: roleSelector ? `role:${role}` : (textSelector ? 'text' : 'ref'),
        stabilityScore: roleSelector ? 9 : (textSelector ? 4 : 1),
        fallback: textSelector || (ref ? `page.locator('[ref="${ref}"]')` : null),
    };
}

/**
 * Save exploration results for script generation
 */
function saveExplorationResults(ticketId, explorationData) {
    const outputDir = path.join(__dirname, '..', 'exploration-data');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${ticketId}-exploration.json`);

    fs.writeFileSync(outputPath, JSON.stringify(explorationData, null, 2));

    console.log(`\n💾 Exploration data saved: ${outputPath}`);

    return outputPath;
}

/**
 * Main exploration runner
 * This coordinates the exploration and script generation
 */
async function runExploration(ticketId, testCases, options = {}) {
    console.log('\n' + '═'.repeat(70));
    console.log('🚀 MCP EXPLORATION ENGINE v2.0');
    console.log('═'.repeat(70));

    // Create session
    const session = new ExplorationSession(ticketId, options);

    // Generate instructions
    const instructions = createExplorationInstructions(ticketId, testCases, options);

    // Display formatted instructions
    console.log(formatInstructionsForAgent(instructions));

    // Return session with helper methods
    return {
        session,
        instructions,
        tools: MCP_COMMANDS,

        // Quick tool access
        toolNames: {
            navigate: MCP_COMMANDS.PLAYWRIGHT.navigate,
            snapshot: MCP_COMMANDS.PLAYWRIGHT.snapshot,
            click: MCP_COMMANDS.PLAYWRIGHT.click,
            type: MCP_COMMANDS.PLAYWRIGHT.type,
            waitFor: MCP_COMMANDS.PLAYWRIGHT.waitFor
        },

        // Recording methods
        recordNavigation: (url) => {
            session.currentUrl = url;
            session.pagesVisited.push(url);
            return session.record(MCP_COMMANDS.PLAYWRIGHT.navigate, { url });
        },

        recordSnapshot: (snapshotYaml) => {
            const result = session.storeSnapshot(snapshotYaml);
            session.record(MCP_COMMANDS.PLAYWRIGHT.snapshot, {}, { elementCount: result.elements.length });
            return result;
        },

        recordClick: (ref, elementName) => {
            return session.record(MCP_COMMANDS.PLAYWRIGHT.click, { ref, element: elementName });
        },

        recordType: (ref, text, elementName) => {
            return session.record(MCP_COMMANDS.PLAYWRIGHT.type, { ref, text, element: elementName });
        },

        recordWait: (params) => {
            return session.record(MCP_COMMANDS.PLAYWRIGHT.waitFor, params);
        },

        // Search helpers
        findElement: (role, nameContains) => session.findElements(role, nameContains),
        getElement: (ref) => session.getElement(ref),

        // Finalization
        getSummary: () => session.getSummary(),
        export: () => session.export(),

        finalize: () => {
            const summary = session.getSummary();
            const dataPath = saveExplorationResults(ticketId, session.export());

            console.log('\n' + '═'.repeat(70));
            console.log('📊 EXPLORATION SUMMARY');
            console.log('═'.repeat(70));
            console.log(`   Session ID: ${summary.sessionId}`);
            console.log(`   Duration: ${summary.duration}ms`);
            console.log(`   Recordings: ${summary.totalRecordings}`);
            console.log(`   Snapshots: ${summary.totalSnapshots}`);
            console.log(`   Elements: ${summary.uniqueElements}`);
            console.log(`   Pages: ${summary.pagesVisited.length}`);

            // Generate script if we have data
            if (summary.totalSnapshots > 0 && MCPScriptGenerator) {
                console.log('\n🔧 Generating Playwright script from exploration...');
                const generator = new MCPScriptGenerator(session.export());
                const scriptPath = generator.save();
                return { success: true, dataPath, scriptPath, summary };
            }

            return { success: true, dataPath, summary };
        }
    };
}

// Export
module.exports = {
    runExploration,
    createExplorationInstructions,
    formatInstructionsForAgent,
    parseSnapshotYaml,
    generatePlaywrightSelector,
    saveExplorationResults,
    ExplorationSession,
    MCP_COMMANDS,
    Tools
};

// CLI for testing
if (require.main === module) {
    const ticketId = process.argv[2] || 'AOTF-16461';

    console.log('\n📚 MCP TOOLS REFERENCE:');
    console.log('─'.repeat(50));
    console.log('PLAYWRIGHT MCP (Primary):');
    Object.entries(MCP_COMMANDS.PLAYWRIGHT).forEach(([key, val]) => {
        console.log(`  ${key.padEnd(18)} → ${val}`);
    });
    console.log('\nCHROME DEVTOOLS MCP (Specialized):');
    Object.entries(MCP_COMMANDS.CHROME).forEach(([key, val]) => {
        console.log(`  ${key.padEnd(18)} → ${val}`);
    });
    console.log('─'.repeat(50));

    runExploration(ticketId, [
        { id: 'TC1', name: 'Verify Roomvo clause in Terms of Service' },
        { id: 'TC2', name: 'Verify Roomvo clause in Privacy Policy' },
        { id: 'TC3', name: 'Test Roomvo external links' }
    ], {
        environment: 'UAT',
        baseUrl: process.env.UAT_URL || 'https://<your-app-uat>.example.com/en-US/legal/terms-of-use'
    }).then(result => {
        console.log('\n' + '═'.repeat(70));
        console.log('✅ READY FOR EXPLORATION');
        console.log('═'.repeat(70));
        console.log('\nExecute MCP tools and record results:');
        console.log('  result.recordNavigation(url)');
        console.log('  result.recordSnapshot(yamlContent)');
        console.log('  result.recordClick(ref, elementName)');
        console.log('  result.finalize()');
    });
}
