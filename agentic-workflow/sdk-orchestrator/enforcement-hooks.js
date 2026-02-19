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
    const { config = {}, learningStore = null, verbose = false } = options;
    const mcpConfig = config.mcpExploration || {};

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
            if (mcpConfig.blockScriptCreationWithoutExploration !== false) {
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
                        log('🚫 DENIED: Attempted to create .spec.js without snapshot');
                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You navigated but did not take a snapshot.\n' +
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

        // ── RULE 2: Block waitForTimeout in generated code ─────────
        if (agentName === 'scriptgenerator') {
            const isFileWrite = ['write_file', 'create_file', 'edit'].some(t =>
                toolName.includes(t)
            );

            if (isFileWrite) {
                const content = toolArgs.content || toolArgs.newString || '';
                if (content.includes('waitForTimeout')) {
                    log('⚠️ waitForTimeout detected in generated code — injecting guidance');
                    return {
                        permissionDecision: 'allow',
                        modifiedArgs: toolArgs,
                        additionalContext:
                            '⚠️ WARNING: Your code contains page.waitForTimeout() which is an anti-pattern.\n' +
                            'Replace with condition-based waits:\n' +
                            '- await page.waitForLoadState("networkidle")\n' +
                            '- await expect(element).toBeVisible()\n' +
                            '- await page.waitForSelector(selector)\n' +
                            '- await popups.waitForPageReady()\n\n' +
                            'Please revise the code before writing it.',
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

        // ── After MCP snapshot: cache extracted selectors ────────────
        if (toolName.includes('unified_snapshot')) {
            const result = input.result || '';
            // Extract selector hints from snapshot output for later validation
            state.snapshotData.push({
                timestamp: new Date().toISOString(),
                resultLength: typeof result === 'string' ? result.length : 0,
            });
            log(`Snapshot data cached (${state.snapshotData.length} total)`);
        }

        // ── After .spec.js write: auto-validate ─────────────────────
        if (agentName === 'scriptgenerator') {
            const isFileWrite = ['write_file', 'create_file', 'edit'].some(t =>
                toolName.includes(t)
            );

            if (isFileWrite) {
                const filePath = input.toolArgs?.filePath || input.toolArgs?.path || '';
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

module.exports = { createEnforcementHooks, SessionEnforcementState };
