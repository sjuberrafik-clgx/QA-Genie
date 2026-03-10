/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ENFORCEMENT HOOKS — Structural Rule Enforcement
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Session hooks that STRUCTURALLY ENFORCE rules currently expressed only as
 * prompt instructions in .agent.md files. The AI physically cannot violate
 * these rules, regardless of prompt engineering quality.
 *
 * Hook types:
 *   onPreToolUse   — blocks disallowed actions before execution
 *   onPostToolUse  — validates outputs after execution
 *   onErrorOccurred — intelligent recovery strategies
 *   onUserPromptSubmitted — prompt enrichment
 *   onSessionStart — context injection
 *
 * @module enforcement-hooks
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { ExplorationQualityAnalyzer, DECISION: OODA_DECISION } = require('./ooda-loop');

// ─── State Tracking ─────────────────────────────────────────────────────────

/**
 * Per-session state tracker for enforcement decisions.
 * Tracks what the agent has done so far to enforce sequencing rules.
 */
class SessionEnforcementState {
    constructor() {
        this.createdAt = Date.now();
        this.mcpNavigateCalled = false;
        this.mcpSnapshotCalled = false;
        this.mcpSelectorValidated = false;   // get_by_role / get_by_test_id / get_by_label / get_by_text called
        this.mcpContentExtracted = false;    // get_text_content / get_attribute called
        this.mcpUrlVerified = false;         // get_page_url / expect_url called
        this.mcpStateChecked = false;        // is_visible / is_enabled / is_checked / is_hidden called
        this.mcpAssertionVerified = false;   // expect_element_text / expect_title / expect_checked / expect_enabled called
        this.frameworkInventoryScanned = false; // get_framework_inventory called (Phase 1.5)
        this.snapshotData = [];          // Captured selector data from snapshots
        this.specFileCreated = false;
        this.toolCallCount = 0;
        this.deniedCalls = [];
        this.validationResults = [];
    }
}

// Track state per session
const sessionStates = new Map();

// TTL cleanup: sweep stale entries every 5 minutes (30-min max age)
const SESSION_STATE_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of sessionStates) {
        if (now - state.createdAt > SESSION_STATE_TTL_MS) {
            sessionStates.delete(id);
        }
    }
}, 5 * 60 * 1000).unref();

function getState(sessionId) {
    if (!sessionStates.has(sessionId)) {
        sessionStates.set(sessionId, new SessionEnforcementState());
    }
    return sessionStates.get(sessionId);
}

// ─── Hook Factory ───────────────────────────────────────────────────────────

/**
 * Create enforcement hooks for a specific agent role.
 *
 * @param {string} agentName  - Agent role
 * @param {Object} options    - { config, learningStore, verbose }
 * @returns {Object} SessionHooks compatible with Copilot SDK
 */
function createEnforcementHooks(agentName, options = {}) {
    const { config = {}, learningStore = null, groundingStore = null, verbose = false } = options;
    const mcpConfig = config.mcpExploration || {};

    // Initialize OODA exploration quality analyzer (for scriptgenerator)
    const qualityAnalyzer = (agentName === 'scriptgenerator')
        ? new ExplorationQualityAnalyzer({ config, groundingStore, verbose })
        : null;

    // Generate a STABLE fallback session ID for this hook instance.
    // Previously, `invocation.sessionId || randomUUID()` generated a NEW random
    // UUID on every tool call if sessionId was undefined, meaning each call got
    // a fresh enforcement state. MCP-first sequencing (mcpNavigateCalled,
    // mcpSnapshotCalled) broke completely — the agent could write .spec.js
    // files without ever navigating because each check saw a blank state.
    const stableFallbackId = `${agentName}-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const log = (msg) => {
        if (verbose) console.log(`[EnforcementHooks:${agentName}] ${msg}`);
    };

    const hooks = {};

    // ─────────────────────────────────────────────────────────────────
    // onPreToolUse — Intercept tool calls BEFORE execution
    // ─────────────────────────────────────────────────────────────────
    hooks.onPreToolUse = async (input, invocation) => {
        const state = getState(invocation.sessionId || stableFallbackId);
        state.toolCallCount++;

        const toolName = input.toolName;
        const toolArgs = input.toolArgs || {};

        // ── RULE 0: Block shell/terminal tools for scriptgenerator ─
        // The ScriptGenerator must use MCP tools for browser exploration,
        // NEVER shell-based Playwright scripts or direct test execution.
        if (agentName === 'scriptgenerator') {
            const shellToolPatterns = [
                'runInTerminal', 'powershell', 'terminal', 'bash', 'cmd',
                'run_in_terminal', 'execute_command', 'shell',
            ];
            const isShellTool = shellToolPatterns.some(p =>
                toolName.toLowerCase().includes(p.toLowerCase())
            );

            if (isShellTool) {
                // Also check if trying to run playwright test execution
                const cmdArg = toolArgs.command || toolArgs.cmd || '';
                log(`🚫 DENIED: Shell/terminal tool "${toolName}" blocked for scriptgenerator`);
                state.deniedCalls.push({
                    tool: toolName,
                    reason: 'Shell/terminal tools are prohibited for scriptgenerator — use MCP tools instead',
                    timestamp: new Date().toISOString(),
                });

                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        '⛔ BLOCKED: Shell/terminal tools are PROHIBITED for the ScriptGenerator agent.\n\n' +
                        'You MUST use MCP tools for browser exploration:\n' +
                        '- unified_navigate → open URLs\n' +
                        '- unified_snapshot → capture accessibility tree\n' +
                        '- unified_click / unified_type → interact with elements\n\n' +
                        'Do NOT use runInTerminal, powershell, or any shell command.\n' +
                        'Do NOT run npx playwright test — test execution is handled by a later pipeline stage.',
                };
            }
        }

        // ── RULE 1: MCP-First for scriptgenerator ──────────────────
        // ScriptGenerator must navigate before creating any files
        if (agentName === 'scriptgenerator') {

            // Track framework inventory scan (Phase 1.5)
            if (toolName === 'get_framework_inventory') {
                state.frameworkInventoryScanned = true;
                log('✅ Framework inventory scanned — reusable code discovered');
            }

            // Track MCP navigation
            if (toolName.includes('unified_navigate')) {
                state.mcpNavigateCalled = true;
                log('✅ MCP navigate called — exploration started');
            }

            // Track MCP snapshot
            if (toolName.includes('unified_snapshot')) {
                state.mcpSnapshotCalled = true;
                log('✅ MCP snapshot called — selectors captured');
            }

            // Track programmatic execution (Anthropic Technique 1)
            // execute_exploration batches multiple tool calls — credit the checks that the
            // script implicitly performs. The executor logs every tool call it makes, so the
            // agent still performs real MCP exploration, just more efficiently.
            if (toolName.includes('unified_execute_exploration')) {
                // A batch exploration script inherently navigates and snapshots
                state.mcpNavigateCalled = true;
                state.mcpSnapshotCalled = true;
                log('✅ MCP batch exploration executed — navigate + snapshot credited');
            }

            // Track semantic selector validation (get_by_role, get_by_test_id, get_by_label, get_by_text, get_by_placeholder, get_by_alt_text, get_by_title)
            if (toolName.includes('unified_get_by_role') || toolName.includes('unified_get_by_test_id') ||
                toolName.includes('unified_get_by_label') || toolName.includes('unified_get_by_text') ||
                toolName.includes('unified_get_by_placeholder') || toolName.includes('unified_get_by_alt_text') ||
                toolName.includes('unified_get_by_title')) {
                state.mcpSelectorValidated = true;
                log('✅ MCP semantic selector validated — element confirmed');
            }

            // Track content extraction (get_text_content, get_attribute, get_inner_text, get_input_value)
            if (toolName.includes('unified_get_text_content') || toolName.includes('unified_get_attribute') ||
                toolName.includes('unified_get_inner_text') || toolName.includes('unified_get_input_value')) {
                state.mcpContentExtracted = true;
                log('✅ MCP content extracted — assertion data captured');
            }

            // Track URL verification (get_page_url, expect_url)
            if (toolName.includes('unified_get_page_url') || toolName.includes('unified_expect_url')) {
                state.mcpUrlVerified = true;
                log('✅ MCP URL verified — navigation state confirmed');
            }

            // Track element state checks (is_visible, is_enabled, is_checked, is_hidden, is_disabled)
            if (toolName.includes('unified_is_visible') || toolName.includes('unified_is_enabled') ||
                toolName.includes('unified_is_checked') || toolName.includes('unified_is_hidden') ||
                toolName.includes('unified_is_disabled') || toolName.includes('unified_is_editable')) {
                state.mcpStateChecked = true;
                log('✅ MCP element state checked — interactability confirmed');
            }

            // Track MCP assertion verification (expect_element_text, expect_title, expect_checked, etc.)
            if (toolName.includes('unified_expect_element_text') || toolName.includes('unified_expect_title') ||
                toolName.includes('unified_expect_checked') || toolName.includes('unified_expect_enabled') ||
                toolName.includes('unified_expect_disabled') || toolName.includes('unified_expect_element_attribute') ||
                toolName.includes('unified_expect_element_value') || toolName.includes('unified_expect_element_class') ||
                toolName.includes('unified_expect_focused') || toolName.includes('unified_expect_attached') ||
                toolName.includes('unified_verify_text_visible') || toolName.includes('unified_verify_element_visible')) {
                state.mcpAssertionVerified = true;
                log('✅ MCP assertion verified — pre-validated expected values');
            }

            // Block file creation before MCP exploration
            // When MCP_EXPLORATION_ENABLED=false (.env), exploration is intentionally
            // skipped — do NOT block file creation in that case.
            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
            if (explorationEnabled && mcpConfig.blockScriptCreationWithoutExploration !== false) {
                const isFileWrite = ['write_file', 'create_file', 'edit'].some(t =>
                    toolName.includes(t)
                );

                if (isFileWrite) {
                    // Check if creating a .spec.js file
                    const filePath = toolArgs.filePath || toolArgs.path || '';
                    const isSpecFile = filePath.endsWith('.spec.js');

                    if (isSpecFile && !state.mcpNavigateCalled) {
                        log('🚫 DENIED: Attempted to create .spec.js before MCP navigation');
                        state.deniedCalls.push({
                            tool: toolName,
                            reason: 'MCP exploration must happen before script creation',
                            timestamp: new Date().toISOString(),
                        });

                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You must perform MCP exploration BEFORE creating the spec file.\n\n' +
                                'Required steps:\n' +
                                '1. Call unified_navigate to open the target URL\n' +
                                '2. Call unified_snapshot to capture the accessibility tree\n' +
                                '3. Extract real selectors from the snapshot\n' +
                                '4. THEN create the .spec.js file with validated selectors\n\n' +
                                'This rule is structurally enforced and cannot be bypassed.',
                        };
                    }

                    if (isSpecFile && !state.mcpSnapshotCalled) {
                        // Check if this denial was caused by OODA quality reset
                        const lastSnapshot = state.snapshotData.length > 0
                            ? state.snapshotData[state.snapshotData.length - 1]
                            : null;
                        const wasQualityReset = lastSnapshot && lastSnapshot.quality &&
                            lastSnapshot.quality.decision === OODA_DECISION.RETRY_RECOMMENDED;

                        log(`🚫 DENIED: Attempted to create .spec.js without ${wasQualityReset ? 'quality' : ''} snapshot`);
                        return {
                            permissionDecision: 'deny',
                            additionalContext: wasQualityReset
                                ? '⛔ BLOCKED: Your last snapshot was LOW QUALITY (OODA score: ' +
                                `${lastSnapshot.quality.score}, decision: RETRY_RECOMMENDED).\n\n` +
                                'Issues detected:\n' +
                                lastSnapshot.quality.warnings.map(w => `  • ${w}`).join('\n') + '\n\n' +
                                'You MUST obtain a quality snapshot before creating the spec file:\n' +
                                '1. Wait for the page to fully load (waitForLoadState, waitForSelector)\n' +
                                '2. Dismiss any popups blocking the content\n' +
                                '3. Call unified_snapshot again\n' +
                                '4. The snapshot must score ≥30 to proceed.'
                                : '⛔ BLOCKED: You navigated but did not take a snapshot.\n' +
                                'Call unified_snapshot first to capture live selectors.',
                        };
                    }

                    // ── RULE 1b: Deep exploration enforcement ──────────
                    // DENY script creation without semantic selector validation
                    if (isSpecFile && !state.mcpSelectorValidated) {
                        log('🚫 DENIED: No semantic selector validation before .spec.js creation');
                        state.deniedCalls.push({
                            tool: toolName,
                            reason: 'Semantic selector validation required before script creation',
                            timestamp: new Date().toISOString(),
                        });
                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You must validate selectors with semantic lookup tools before creating the spec file.\n\n' +
                                'Call at least ONE of these to confirm elements exist:\n' +
                                '- unified_get_by_role (find element by ARIA role + name)\n' +
                                '- unified_get_by_test_id (find element by data-testid)\n' +
                                '- unified_get_by_label (find element by label text)\n' +
                                '- unified_get_by_text (find element by visible text)\n\n' +
                                'This confirms selectors exist on the live page and captures exact accessible names.\n' +
                                'Scripts with unvalidated selectors fail nearly 100% of the time.',
                        };
                    }

                    // DENY script creation without content extraction
                    if (isSpecFile && !state.mcpContentExtracted) {
                        log('🚫 DENIED: No content extraction before .spec.js creation');
                        state.deniedCalls.push({
                            tool: toolName,
                            reason: 'Content extraction required for accurate assertions',
                            timestamp: new Date().toISOString(),
                        });
                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You must extract content for assertion values before creating the spec file.\n\n' +
                                'Call at least ONE of these to capture REAL expected values:\n' +
                                '- unified_get_text_content (extract text for toContainText assertions)\n' +
                                '- unified_get_attribute (extract href/data-* for toHaveAttribute assertions)\n' +
                                '- unified_get_inner_text (extract rendered text)\n' +
                                '- unified_get_input_value (extract current input value)\n\n' +
                                'Guessed assertion values cause test failures. Use real values from the live page.',
                        };
                    }

                    // DENY script creation without framework inventory scan (Phase 1.5)
                    if (isSpecFile && !state.frameworkInventoryScanned) {
                        log('🚫 DENIED: No framework inventory scan before .spec.js creation');
                        state.deniedCalls.push({
                            tool: toolName,
                            reason: 'Framework inventory scan required before script creation (Phase 1.5)',
                            timestamp: new Date().toISOString(),
                        });
                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You must scan the existing framework codebase before creating the spec file.\n\n' +
                                'Call the `get_framework_inventory` tool to discover:\n' +
                                '- Page objects (POmanager, WelcomePopUp, AgentBranding, etc.)\n' +
                                '- Business functions (login, search, general, propertyDetails, etc.)\n' +
                                '- Utilities (PopupHandler for popup dismissal)\n' +
                                '- Test data (userTokens, baseUrl, credentials)\n\n' +
                                'You MUST use existing reusable methods instead of writing duplicated code.\n' +
                                'This is Phase 1.5 — required AFTER MCP exploration and BEFORE script generation.',
                        };
                    }

                    // WARN (allow) if no element state checks were performed
                    if (isSpecFile && !state.mcpStateChecked) {
                        log('⚠️ WARN: No element state checks before .spec.js creation');
                        return {
                            permissionDecision: 'allow',
                            additionalContext:
                                '⚠️ WARNING: You have not checked element states during exploration.\n\n' +
                                'Consider calling:\n' +
                                '- unified_is_visible / unified_is_enabled (verify interactability)\n' +
                                '- unified_is_checked (verify checkbox/radio state)\n\n' +
                                'This helps prevent scripts that interact with hidden or disabled elements.',
                        };
                    }

                    if (isSpecFile) {
                        state.specFileCreated = true;
                    }
                }
            }
        }

        // ── RULE 2: BLOCK waitForTimeout in generated code ─────────
        if (agentName === 'scriptgenerator') {
            const isFileWrite2 = ['write_file', 'create_file', 'edit'].some(t =>
                toolName.includes(t)
            );

            if (isFileWrite2) {
                const content2 = toolArgs.content || toolArgs.newString || '';
                if (content2.includes('waitForTimeout')) {
                    log('🚫 DENIED: waitForTimeout detected in generated code');
                    state.deniedCalls.push({
                        tool: toolName,
                        reason: 'Code contains page.waitForTimeout() anti-pattern',
                        timestamp: new Date().toISOString(),
                    });
                    return {
                        permissionDecision: 'deny',
                        additionalContext:
                            '⛔ BLOCKED: Your code contains page.waitForTimeout() which is a PROHIBITED anti-pattern (AP003).\n\n' +
                            'Replace ALL occurrences with condition-based waits:\n' +
                            '- await page.waitForLoadState("networkidle") — wait for all requests to settle\n' +
                            '- await expect(element).toBeVisible() — wait for element to appear\n' +
                            '- await page.waitForSelector(selector) — wait for DOM element\n' +
                            '- await element.waitFor({ state: "visible" }) — explicit wait on locator\n' +
                            '- await popups.waitForPageReady() — network idle + dismiss popups\n\n' +
                            'Fix the code and try creating the file again.',
                    };
                }
            }
        }

        // ── RULE 3: Block non-retrying assertions ──────────────────
        if (agentName === 'scriptgenerator') {
            const isFileWrite = ['write_file', 'create_file', 'edit'].some(t =>
                toolName.includes(t)
            );

            if (isFileWrite) {
                const content = toolArgs.content || toolArgs.newString || '';
                const nonRetrying = [
                    /expect\(\s*await\s+\w+\.textContent\(\)\s*\)/,
                    /expect\(\s*await\s+\w+\.isVisible\(\)\s*\)/,
                    /expect\(\s*await\s+\w+\.isEnabled\(\)\s*\)/,
                    /expect\([^)]*\|\|\s*true\s*\)\s*\.\s*toBeTruthy/,
                ];

                const violations = nonRetrying.filter(p => p.test(content));
                if (violations.length > 0) {
                    return {
                        permissionDecision: 'allow',
                        additionalContext:
                            `⚠️ WARNING: ${violations.length} non-retrying assertion(s) detected.\n` +
                            'Use Playwright auto-retrying assertions instead:\n' +
                            '- await expect(el).toContainText() instead of expect(await el.textContent())\n' +
                            '- await expect(el).toBeVisible() instead of expect(await el.isVisible())\n' +
                            '- await expect(el).toBeEnabled() instead of expect(await el.isEnabled())\n' +
                            'Please fix before proceeding.',
                    };
                }
            }
        }

        // Default: allow
        return { permissionDecision: 'allow' };
    };

    // ─────────────────────────────────────────────────────────────────
    // onPostToolUse — Validate outputs AFTER execution
    // ─────────────────────────────────────────────────────────────────
    hooks.onPostToolUse = async (input, invocation) => {
        const state = getState(invocation.sessionId || stableFallbackId);
        const toolName = input.toolName;

        // ── Context Engineering: Trim bloated tool results to save context budget ──
        // MCP snapshots, network requests, console messages can be 50K+ chars.
        // Trimming here reduces what enters the conversation history.
        try {
            const { getContextEngine } = require('./context-engine');
            const contextEngine = getContextEngine();
            if (contextEngine && typeof input.result === 'string' && input.result.length > 2000) {
                const trimmed = contextEngine.trimToolResult(toolName, input.result);
                if (trimmed && trimmed.length < input.result.length) {
                    const saved = input.result.length - trimmed.length;
                    log(`📦 Tool result trimmed: ${toolName} ${input.result.length} → ${trimmed.length} chars (saved ${saved})`);
                    input.result = trimmed;
                }
            }
        } catch (trimErr) {
            // Non-blocking: if trimming fails, use original result
        }

        // ── After MCP snapshot: OODA quality assessment ────────────
        if (toolName.includes('unified_snapshot')) {
            const result = input.result || '';
            const resultLength = typeof result === 'string' ? result.length : 0;

            // OODA: Assess snapshot quality (Observe→Orient→Decide→Act)
            let qualityAssessment = null;
            if (qualityAnalyzer) {
                // Try to extract current page URL for feature map comparison
                const pageUrl = (typeof result === 'string' && result.match(/url["']?\s*[:=]\s*["']([^"']+)/i))?.[1] || '';
                qualityAssessment = qualityAnalyzer.assess(result, { pageUrl });
                log(`OODA Snapshot Quality: ${qualityAssessment.decision} (score: ${qualityAssessment.score}, ` +
                    `elements: ${qualityAssessment.elementCount}, roles: ${qualityAssessment.roleDiversity})`);
            }

            // Cache enriched snapshot data (replaces minimal {timestamp, resultLength})
            state.snapshotData.push({
                timestamp: new Date().toISOString(),
                resultLength,
                ...(qualityAssessment ? {
                    quality: {
                        decision: qualityAssessment.decision,
                        score: qualityAssessment.score,
                        elementCount: qualityAssessment.elementCount,
                        roleDiversity: qualityAssessment.roleDiversity,
                        warnings: qualityAssessment.warnings,
                    }
                } : {}),
            });
            log(`Snapshot data cached (${state.snapshotData.length} total)`);

            // If quality is low, enforce structural consequences
            if (qualityAssessment && qualityAssessment.decision !== OODA_DECISION.ACCEPT) {
                const severity = qualityAssessment.decision === OODA_DECISION.RETRY_RECOMMENDED ? '🚨' : '⚠️';

                // ── OODA ENFORCEMENT: Reset snapshot flag on RETRY_RECOMMENDED ──
                // This converts the existing pre-tool gate into a quality-aware gate.
                // The agent CANNOT create a .spec.js until it obtains a good snapshot.
                if (qualityAssessment.decision === OODA_DECISION.RETRY_RECOMMENDED) {
                    state.mcpSnapshotCalled = false;
                    log('🚨 OODA: mcpSnapshotCalled reset to FALSE — spec creation blocked until quality snapshot obtained');
                }

                return {
                    additionalContext:
                        `${severity} OODA SNAPSHOT QUALITY ${qualityAssessment.decision}:\n` +
                        qualityAssessment.warnings.map(w => `  • ${w}`).join('\n') + '\n\n' +
                        (qualityAssessment.recommendation || 'Consider re-snapshotting after page fully loads.') +
                        (qualityAssessment.decision === OODA_DECISION.RETRY_RECOMMENDED
                            ? '\n\n⛔ Script creation is BLOCKED until you obtain a quality snapshot. ' +
                            'Navigate to the target page, wait for full load, dismiss popups, then call unified_snapshot again.'
                            : ''),
                };
            }
        }

        // ── Dynamic ID Detection: warn when selectors contain random IDs ─
        // Patterns like #input-text-hp0r4mgrm3v or #collapsible-yw91x0xqelm
        // are dynamically generated and will break on the next page render.
        if (toolName.includes('unified_get_by') || toolName.includes('unified_snapshot')) {
            const resultStr = typeof input.result === 'string' ? input.result : JSON.stringify(input.result || '');
            const dynamicIdPattern = /#[a-z]+-[a-z0-9]{6,}/gi;
            const dynamicMatches = resultStr.match(dynamicIdPattern);
            if (dynamicMatches && dynamicMatches.length > 0) {
                const unique = [...new Set(dynamicMatches)].slice(0, 5);
                log(`⚠️ Dynamic ID(s) detected in selectors: ${unique.join(', ')}`);
                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        `🚫 DYNAMIC SELECTOR BLOCKED: Found ${dynamicMatches.length} dynamically-generated ID(s): ${unique.join(', ')}\n\n` +
                        'These IDs change on every page render and WILL break your script.\n' +
                        'You MUST use stable selectors instead:\n' +
                        '- getByRole("button", { name: "..." }) — ARIA role + accessible name\n' +
                        '- getByLabel("...") — form field labels\n' +
                        '- getByText("...") — visible text content\n' +
                        '- locator("[data-test-id=\\"...\\""]") — data-test-id attribute\n\n' +
                        'Re-run get_by_role or get_by_label to find a stable alternative.',
                };
            }
        }

        // ── Path guard: block .spec.js writes to web-app/ ─────────
        if (agentName === 'scriptgenerator') {
            const isFileWrite = ['write_file', 'create_file', 'edit'].some(t =>
                toolName.includes(t)
            );

            if (isFileWrite) {
                const filePath = input.toolArgs?.filePath || input.toolArgs?.path || '';
                const normalizedPath = filePath.replace(/\\/g, '/');

                if (normalizedPath.includes('web-app/') && filePath.endsWith('.spec.js')) {
                    const correctedPath = normalizedPath.replace(
                        /web-app\/tests\/specs\//,
                        'tests/specs/'
                    ).replace(
                        /web-app\/tests\//,
                        'tests/specs/'
                    );
                    log(`⛔ BLOCKED: spec write to web-app/ — suggested: ${correctedPath}`);
                    return {
                        permissionDecision: 'deny',
                        additionalContext:
                            '⛔ WRONG DIRECTORY: .spec.js files must NEVER be written under web-app/. ' +
                            'web-app/ is a separate Next.js project. ' +
                            `Write to: ${correctedPath}`,
                    };
                }

                // ── After .spec.js write: auto-validate ─────────────────────
                if (filePath.endsWith('.spec.js')) {
                    log('Auto-validating generated spec file...');

                    try {
                        const { validateGeneratedScript } = require('../scripts/validate-script');
                        const content = fs.readFileSync(filePath, 'utf-8');

                        // Suppress console.log during validation
                        const origLog = console.log;
                        console.log = () => { };
                        const result = validateGeneratedScript(filePath, content);
                        console.log = origLog;

                        state.validationResults.push(result);

                        if (!result.valid) {
                            return {
                                additionalContext:
                                    '🚨 AUTO-VALIDATION FAILED:\n' +
                                    result.errors.join('\n') + '\n\n' +
                                    (result.warnings.length > 0
                                        ? 'Warnings:\n' + result.warnings.join('\n') + '\n\n'
                                        : '') +
                                    'Please fix these issues in the spec file before proceeding.',
                            };
                        }

                        if (result.warnings.length > 0) {
                            return {
                                additionalContext:
                                    '⚠️ Validation passed with warnings:\n' +
                                    result.warnings.join('\n'),
                            };
                        }

                        log('✅ Auto-validation passed');
                    } catch (error) {
                        log(`Validation error: ${error.message}`);
                    }
                }
            }
        }

        return {};
    };

    // ─────────────────────────────────────────────────────────────────
    // onErrorOccurred — Intelligent recovery strategies
    // ─────────────────────────────────────────────────────────────────
    hooks.onErrorOccurred = async (input, invocation) => {
        const errorMsg = input.error || '';
        const context = input.errorContext || '';

        log(`Error in ${context}: ${errorMsg.substring(0, 100)}`);

        // MCP connection errors — retry
        if (errorMsg.includes('MCP') || errorMsg.includes('connection refused')) {
            return {
                errorHandling: 'retry',
                additionalContext: 'MCP server may not be ready. Retrying after brief wait.',
            };
        }

        // Timeout errors — retry with guidance
        if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
            return {
                errorHandling: 'retry',
                additionalContext: 'Operation timed out. Try increasing timeout or waiting for page load.',
            };
        }

        // Auth errors — abort (can't recover without new tokens)
        if (errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('token')) {
            return {
                errorHandling: 'abort',
                additionalContext: 'Authentication failure. Check tokens in testData.js.',
            };
        }

        // Default: skip and continue
        return { errorHandling: 'skip' };
    };

    // ─────────────────────────────────────────────────────────────────
    // onSessionStart — Inject initial context
    // ─────────────────────────────────────────────────────────────────
    hooks.onSessionStart = async (input, invocation) => {
        const state = getState(invocation.sessionId || stableFallbackId);

        log(`Session started [${input.source}]`);

        // Inject learning context at session start
        let additionalContext = '';

        if (learningStore && agentName === 'scriptgenerator') {
            const stats = learningStore.getStats();
            if (stats.totalFailures > 0) {
                additionalContext +=
                    `\n📊 Learning Store: ${stats.totalFailures} historical failures, ` +
                    `${stats.totalStableSelectors} stable selector mappings available.\n` +
                    'Use the get_historical_failures tool to check if your target page has known issues.\n';
            }
        }

        return { additionalContext };
    };

    // ─────────────────────────────────────────────────────────────────
    // onSessionEnd — Cleanup state
    // ─────────────────────────────────────────────────────────────────
    hooks.onSessionEnd = async (input, invocation) => {
        const sessionId = invocation.sessionId || stableFallbackId;
        const state = getState(sessionId);

        log(`Session ended [${input.reason}] — ${state.toolCallCount} tool calls, ${state.deniedCalls.length} denied`);

        // Cleanup
        sessionStates.delete(sessionId);
    };

    return hooks;
}

// ─── Exports ────────────────────────────────────────────────────────────────

// ─── Public Accessor: Snapshot Quality Data ────────────────────────────────

/**
 * Returns snapshot quality data for the most recent session matching the given
 * agent name prefix. Used by the `get_snapshot_quality` SDK tool.
 *
 * @param {string} agentNamePrefix  - Agent name to match (e.g. 'scriptgenerator')
 * @returns {Object|null} Snapshot quality summary or null if no data
 */
function getSnapshotQualityData(agentNamePrefix) {
    // Find session matching the agent prefix (most recent wins)
    let latestState = null;
    let latestTime = 0;
    for (const [id, state] of sessionStates) {
        if (id.startsWith(agentNamePrefix) && state.createdAt > latestTime) {
            latestState = state;
            latestTime = state.createdAt;
        }
    }

    if (!latestState || latestState.snapshotData.length === 0) {
        return null;
    }

    const snapshots = latestState.snapshotData;
    const qualitySnapshots = snapshots.filter(s => s.quality);
    const latestSnapshot = snapshots[snapshots.length - 1];
    const acceptCount = qualitySnapshots.filter(s => s.quality.decision === 'ACCEPT').length;
    const warnCount = qualitySnapshots.filter(s => s.quality.decision === 'WARN').length;
    const retryCount = qualitySnapshots.filter(s => s.quality.decision === 'RETRY_RECOMMENDED').length;

    return {
        totalSnapshots: snapshots.length,
        qualityAssessed: qualitySnapshots.length,
        summary: { accepted: acceptCount, warned: warnCount, retryRecommended: retryCount },
        latestSnapshot: latestSnapshot.quality ? {
            decision: latestSnapshot.quality.decision,
            score: latestSnapshot.quality.score,
            elementCount: latestSnapshot.quality.elementCount,
            roleDiversity: latestSnapshot.quality.roleDiversity,
            warnings: latestSnapshot.quality.warnings,
            timestamp: latestSnapshot.timestamp,
        } : { decision: 'NOT_ASSESSED', timestamp: latestSnapshot.timestamp },
        allSnapshots: qualitySnapshots.map(s => ({
            decision: s.quality.decision,
            score: s.quality.score,
            elementCount: s.quality.elementCount,
            roleDiversity: s.quality.roleDiversity,
            warnings: s.quality.warnings,
            timestamp: s.timestamp,
        })),
        canCreateSpec: latestState.mcpSnapshotCalled,
    };
}

// ─── Cognitive Phase Enforcement ────────────────────────────────────────────

/**
 * Phase-specific enforcement rules for the Cognitive QA Loop.
 *
 * Each phase gets structural constraints that PHYSICALLY prevent the LLM
 * from violating the separation of concerns:
 *
 *   Analyst   → NO MCP, NO file writes (pure reasoning)
 *   Explorer  → NO file writes, ONLY MCP tools
 *   Coder     → NO MCP, ALLOW file writes
 *   Reviewer  → NO MCP, NO file writes (pure reasoning)
 *   DryRun    → NO file writes, ONLY selector-checking MCP tools
 */

const COGNITIVE_PHASE_RULES = {
    'cognitive-analyst': {
        allowMCP: false,
        allowFileWrite: false,
        allowedToolPatterns: [], // No tools at all — pure reasoning
        description: 'Analyst phase: pure reasoning only — no MCP or file operations',
    },
    'cognitive-explorer-nav': {
        allowMCP: true,
        allowFileWrite: false,
        allowedToolPatterns: ['unified_'], // All MCP tools
        blockedToolPatterns: ['write_file', 'create_file', 'edit'],
        description: 'Explorer phase: MCP exploration only — no file writes',
    },
    'cognitive-explorer-interact': {
        allowMCP: true,
        allowFileWrite: false,
        allowedToolPatterns: ['unified_'],
        blockedToolPatterns: ['write_file', 'create_file', 'edit'],
        description: 'Explorer-interact phase: MCP interaction only — no file writes',
    },
    'cognitive-coder': {
        allowMCP: false,
        allowFileWrite: true,
        blockedToolPatterns: ['unified_'],
        description: 'Coder phase: file writes only — no MCP exploration',
    },
    'cognitive-reviewer': {
        allowMCP: false,
        allowFileWrite: false,
        allowedToolPatterns: [],
        description: 'Reviewer phase: pure reasoning only — no MCP or file operations',
    },
    'cognitive-dryrun': {
        allowMCP: true,
        allowFileWrite: false,
        allowedToolPatterns: [
            'unified_navigate', 'unified_get_by_role', 'unified_get_by_test_id',
            'unified_get_by_label', 'unified_get_by_text', 'unified_get_by_placeholder',
            'unified_is_visible', 'unified_is_enabled', 'unified_snapshot',
            'unified_get_page_url', 'unified_get_text_content', 'unified_get_attribute',
        ],
        blockedToolPatterns: ['write_file', 'create_file', 'edit'],
        description: 'DryRun phase: selector verification only — limited MCP, no file writes',
    },
};

/**
 * Create enforcement hooks for a cognitive phase.
 *
 * @param {string} phaseName - Cognitive phase agent name (e.g., 'cognitive-analyst')
 * @param {Object} [options] - { verbose }
 * @returns {Object} SessionHooks compatible with Copilot SDK
 */
function createCognitiveEnforcementHooks(phaseName, options = {}) {
    const { verbose = false } = options;
    const rules = COGNITIVE_PHASE_RULES[phaseName];

    if (!rules) {
        // Unknown phase — fall back to standard scriptgenerator hooks
        return createEnforcementHooks('scriptgenerator', options);
    }

    const stableFallbackId = `${phaseName}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const log = (msg) => { if (verbose) console.log(`[CognitiveEnforcement:${phaseName}] ${msg}`); };

    const hooks = {};

    hooks.onPreToolUse = async (input, invocation) => {
        const toolName = input.toolName || '';
        const toolArgs = input.toolArgs || {};

        // ── Block MCP tools when not allowed ────────────────────────
        if (!rules.allowMCP && toolName.includes('unified_')) {
            log(`🚫 DENIED: MCP tool "${toolName}" blocked in ${phaseName}`);
            return {
                permissionDecision: 'deny',
                additionalContext:
                    `⛔ BLOCKED: MCP tools are not available in the ${phaseName} phase.\n` +
                    `${rules.description}\n` +
                    'Complete your analysis using the context already provided.',
            };
        }

        // ── Block file writes when not allowed ──────────────────────
        const isFileWrite = ['write_file', 'create_file', 'edit'].some(t => toolName.includes(t));
        if (!rules.allowFileWrite && isFileWrite) {
            log(`🚫 DENIED: File write "${toolName}" blocked in ${phaseName}`);
            return {
                permissionDecision: 'deny',
                additionalContext:
                    `⛔ BLOCKED: File creation/editing is not available in the ${phaseName} phase.\n` +
                    `${rules.description}\n` +
                    'Output your analysis in the response text, not as files.',
            };
        }

        // ── Block shell/terminal tools always ───────────────────────
        const shellToolPatterns = ['runInTerminal', 'powershell', 'terminal', 'bash', 'cmd', 'run_in_terminal', 'shell'];
        const isShellTool = shellToolPatterns.some(p => toolName.toLowerCase().includes(p.toLowerCase()));
        if (isShellTool) {
            log(`🚫 DENIED: Shell tool "${toolName}" blocked in ${phaseName}`);
            return {
                permissionDecision: 'deny',
                additionalContext: '⛔ BLOCKED: Shell/terminal tools are prohibited in cognitive phases.',
            };
        }

        // ── DryRun: only allow specific MCP tools ───────────────────
        if (phaseName === 'cognitive-dryrun' && toolName.includes('unified_')) {
            const allowed = rules.allowedToolPatterns.some(pattern => toolName.includes(pattern));
            if (!allowed) {
                log(`🚫 DENIED: MCP tool "${toolName}" not in DryRun allowlist`);
                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        `⛔ BLOCKED: "${toolName}" is not allowed during dry-run validation.\n` +
                        'Only selector verification tools are permitted:\n' +
                        '- unified_navigate, unified_snapshot\n' +
                        '- unified_get_by_role, unified_get_by_test_id, unified_get_by_label, unified_get_by_text\n' +
                        '- unified_is_visible, unified_is_enabled\n' +
                        '- unified_get_page_url, unified_get_text_content',
                };
            }
        }

        // ── Block waitForTimeout in coder ───────────────────────────
        if (phaseName === 'cognitive-coder' && isFileWrite) {
            const content = toolArgs.content || toolArgs.newString || '';
            if (content.includes('waitForTimeout')) {
                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        '⛔ BLOCKED: page.waitForTimeout() is a PROHIBITED anti-pattern.\n' +
                        'Use condition-based waits: waitForLoadState(), toBeVisible(), waitForSelector().',
                };
            }
        }

        return { permissionDecision: 'allow' };
    };

    hooks.onPostToolUse = async (input, invocation) => {
        // ── Auto-validate spec files written by Coder ───────────────
        if (phaseName === 'cognitive-coder') {
            const toolName = input.toolName || '';
            const isFileWrite = ['write_file', 'create_file'].some(t => toolName.includes(t));
            const filePath = input.toolArgs?.filePath || input.toolArgs?.path || '';

            if (isFileWrite && filePath.endsWith('.spec.js')) {
                log('Auto-validating generated spec file...');
                try {
                    const { validateGeneratedScript } = require('../scripts/validate-script');
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const origLog = console.log;
                    console.log = () => { };
                    const result = validateGeneratedScript(filePath, content);
                    console.log = origLog;

                    if (!result.valid) {
                        return {
                            additionalContext:
                                '🚨 AUTO-VALIDATION FAILED:\n' +
                                result.errors.join('\n') + '\n\n' +
                                'Please fix these issues in the spec file.',
                        };
                    }
                } catch (error) {
                    log(`Validation error: ${error.message}`);
                }
            }
        }

        return {};
    };

    hooks.onErrorOccurred = async (input, invocation) => {
        const errorMsg = input.error || '';

        if (errorMsg.includes('MCP') || errorMsg.includes('connection refused')) {
            return { errorHandling: 'retry', additionalContext: 'MCP server may not be ready. Retrying.' };
        }
        if (errorMsg.includes('timeout')) {
            return { errorHandling: 'retry', additionalContext: 'Timed out. Retrying with extended wait.' };
        }
        return { errorHandling: 'skip' };
    };

    hooks.onSessionStart = async (input, invocation) => {
        log(`Cognitive phase session started: ${phaseName}`);
        return { additionalContext: '' };
    };

    return hooks;
}

// ─── Document Quality Analyzer ──────────────────────────────────────────────

/**
 * Validates document generation tool outputs for structural quality.
 * Runs as a post-tool-use analyzer for DocGenie's generate_* tools.
 */
class DocumentQualityAnalyzer {
    constructor(config = {}) {
        this.minSections = config.minSections || 2;
        this.maxSections = config.maxSections || 100;
        this.warnThreshold = config.warnThreshold || 60;
    }

    analyze(toolResult) {
        let result;
        try { result = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult; } catch { return null; }
        if (!result || !result.success) return null;

        const issues = [];
        let score = 100;

        // File size check (< 1KB is suspiciously small, > 50MB is excessive)
        if (result.fileSize && result.fileSize < 1024) {
            issues.push('Document is suspiciously small (< 1 KB) — may be missing content.');
            score -= 20;
        }
        if (result.fileSize && result.fileSize > 50 * 1024 * 1024) {
            issues.push('Document exceeds 50 MB — may contain unoptimized images.');
            score -= 15;
        }

        // Section/slide/sheet count validation
        const count = result.sectionCount || result.slideCount || result.sheetCount || 0;
        if (count < this.minSections) {
            issues.push(`Only ${count} content items generated — expected at least ${this.minSections}.`);
            score -= 25;
        }
        if (count > this.maxSections) {
            issues.push(`${count} content items generated — exceeds maximum of ${this.maxSections}. Consider splitting.`);
            score -= 10;
        }

        const decision = score >= this.warnThreshold ? 'ACCEPT' : 'WARN';
        return { score, decision, issues, fileSize: result.fileSizeHuman, itemCount: count };
    }
}

module.exports = {
    createEnforcementHooks,
    createCognitiveEnforcementHooks,
    SessionEnforcementState,
    getSnapshotQualityData,
    DocumentQualityAnalyzer,
    COGNITIVE_PHASE_RULES,
};
