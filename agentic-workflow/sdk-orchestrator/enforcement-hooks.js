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
const { ObservationRecorder } = require('./observation-recorder');

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
        this.currentPageKey = null;
        this.visitedPages = [];
        this.pageEvidenceByUrl = new Map();
        this.snapshotData = [];          // Captured selector data from snapshots
        this.specFileCreated = false;
        this.toolCallCount = 0;
        this.deniedCalls = [];
        this.validationResults = [];
        this.runtimeObservations = [];
        this.lastRuntimeBlocker = null;
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

function parseToolResultPayload(result) {
    if (!result) return null;
    if (typeof result === 'object') return result;
    if (typeof result !== 'string') return null;

    const trimmed = result.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function extractRuntimeObservation(toolName, result) {
    const payload = parseToolResultPayload(result);

    if (payload?.blockerState?.present && payload.blockerState.blocker) {
        return { toolName, source: 'blockerState', blocker: payload.blockerState.blocker };
    }

    if (payload?.blockerDetected) {
        return { toolName, source: 'blockerDetected', blocker: payload.blockerDetected };
    }

    if (payload?.errorCode === 'RUNTIME_BLOCKER' && payload?.blocker) {
        return { toolName, source: 'runtimeError', blocker: payload.blocker };
    }

    if (typeof result === 'string' && /Tool execution failed \[RUNTIME_BLOCKER\]:/i.test(result)) {
        return {
            toolName,
            source: 'runtimeErrorText',
            blocker: {
                kind: /native dialog/i.test(result) ? 'native-dialog' : 'unknown-blocker',
                message: result,
            },
        };
    }

    return null;
}

function executeExplorationIncludesNavigate(toolArgs = {}) {
    const template = String(toolArgs.templateName || '').toLowerCase();
    if (template === 'explore_page' || template === 'login_and_navigate') {
        return true;
    }

    const script = String(toolArgs.script || '').toLowerCase();
    return script.includes('tools.navigate(') || script.includes('.navigate(');
}

function executeExplorationIncludesSnapshot(toolArgs = {}) {
    const template = String(toolArgs.templateName || '').toLowerCase();
    if (template === 'explore_page' || template === 'login_and_navigate') {
        return true;
    }

    const script = String(toolArgs.script || '').toLowerCase();
    return script.includes('tools.snapshot(') || script.includes('.snapshot(');
}

const SELECTOR_VALIDATION_TOOL_PATTERNS = [
    'unified_get_by_role',
    'unified_get_by_test_id',
    'unified_get_by_label',
    'unified_get_by_text',
    'unified_get_by_placeholder',
    'unified_get_by_alt_text',
    'unified_get_by_title',
];

const CONTENT_EXTRACTION_TOOL_PATTERNS = [
    'unified_get_text_content',
    'unified_get_attribute',
    'unified_get_inner_text',
    'unified_get_input_value',
];

const URL_VERIFICATION_TOOL_PATTERNS = [
    'unified_get_page_url',
    'unified_expect_url',
];

function matchesToolPattern(toolName = '', patterns = []) {
    const normalized = String(toolName).toLowerCase();
    return patterns.some(pattern => normalized.includes(String(pattern).toLowerCase()));
}

function normalizePageKey(rawUrl) {
    if (typeof rawUrl !== 'string') {
        return null;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        parsed.search = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        const noHash = trimmed.split('#')[0];
        const noQuery = noHash.split('?')[0];
        return noQuery || trimmed;
    }
}

function ensurePageEvidenceRecord(state, pageKey) {
    if (!pageKey) {
        return null;
    }

    if (!state.pageEvidenceByUrl.has(pageKey)) {
        state.pageEvidenceByUrl.set(pageKey, {
            selectorValidated: false,
            contentExtracted: false,
            urlVerified: false,
            touchedBy: {
                selector: [],
                content: [],
                url: [],
            },
            sources: [],
            updatedAt: new Date().toISOString(),
        });
        state.visitedPages.push(pageKey);
    }

    return state.pageEvidenceByUrl.get(pageKey);
}

function registerVisitedPage(state, rawUrl, source = null) {
    const pageKey = normalizePageKey(rawUrl);
    if (!pageKey) {
        return null;
    }

    const record = ensurePageEvidenceRecord(state, pageKey);
    if (record && source && !record.sources.includes(source)) {
        record.sources.push(source);
    }

    if (record) {
        record.updatedAt = new Date().toISOString();
    }

    state.currentPageKey = pageKey;
    return pageKey;
}

function markPageEvidence(state, evidenceType, toolName, rawUrl = null) {
    let pageKey = null;
    if (rawUrl) {
        pageKey = registerVisitedPage(state, rawUrl, `url:${toolName}`);
    }

    if (!pageKey) {
        pageKey = state.currentPageKey;
    }

    if (!pageKey) {
        return false;
    }

    const record = ensurePageEvidenceRecord(state, pageKey);
    if (!record) {
        return false;
    }

    if (evidenceType === 'selector') {
        record.selectorValidated = true;
    } else if (evidenceType === 'content') {
        record.contentExtracted = true;
    } else if (evidenceType === 'url') {
        record.urlVerified = true;
    }

    const touchedBy = record.touchedBy[evidenceType] || [];
    if (toolName && !touchedBy.includes(toolName)) {
        touchedBy.push(toolName);
    }
    record.touchedBy[evidenceType] = touchedBy;
    record.updatedAt = new Date().toISOString();
    return true;
}

function extractUrlCandidatesFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const candidates = new Set();
    const pushCandidate = (value) => {
        const normalized = normalizePageKey(value);
        if (normalized) {
            candidates.add(normalized);
        }
    };

    pushCandidate(payload.url);
    pushCandidate(payload.currentUrl);
    pushCandidate(payload.pageUrl);
    pushCandidate(payload.href);

    if (Array.isArray(payload.pagesVisited)) {
        payload.pagesVisited.forEach(pushCandidate);
    }

    if (Array.isArray(payload.snapshots)) {
        payload.snapshots.forEach(snapshot => pushCandidate(snapshot?.url));
    }

    const nestedPayloads = [payload.data, payload.result];
    for (const nested of nestedPayloads) {
        if (!nested || typeof nested !== 'object') {
            continue;
        }
        pushCandidate(nested.url);
        pushCandidate(nested.currentUrl);
        pushCandidate(nested.pageUrl);
        if (Array.isArray(nested.pagesVisited)) {
            nested.pagesVisited.forEach(pushCandidate);
        }
        if (Array.isArray(nested.snapshots)) {
            nested.snapshots.forEach(snapshot => pushCandidate(snapshot?.url));
        }
    }

    return [...candidates];
}

function extractNavigateUrlsFromExecuteExplorationArgs(toolArgs = {}) {
    const urls = new Set();
    const templateUrl = toolArgs?.templateArgs?.url;
    if (typeof templateUrl === 'string') {
        const normalized = normalizePageKey(templateUrl);
        if (normalized) {
            urls.add(normalized);
        }
    }

    const script = String(toolArgs.script || '');
    if (!script) {
        return [...urls];
    }

    const navigateRegex = /(?:tools\.)?navigate\s*\(\s*(?:\{[^}]*\burl\s*:\s*["'`]([^"'`]+)["'`][^}]*\}|["'`]([^"'`]+)["'`])/g;
    let match;
    while ((match = navigateRegex.exec(script)) !== null) {
        const candidate = match[1] || match[2];
        const normalized = normalizePageKey(candidate);
        if (normalized) {
            urls.add(normalized);
        }
    }

    return [...urls];
}

function replayExecuteExplorationCallLog(state, payload) {
    const callLog = Array.isArray(payload?.stats?.callLog) ? payload.stats.callLog : [];
    if (callLog.length === 0) {
        return;
    }

    let activePageKey = state.currentPageKey;

    for (const entry of callLog) {
        if (!entry || entry.success === false) {
            continue;
        }

        const toolName = String(entry.tool || entry.shortName || '');
        const args = entry.args || {};

        if (toolName.includes('unified_navigate')) {
            state.mcpNavigateCalled = true;
            const pageKey = registerVisitedPage(state, args.url || args.href, 'execute_exploration:callLog');
            if (pageKey) {
                activePageKey = pageKey;
            }
        }

        if (toolName.includes('unified_snapshot')) {
            state.mcpSnapshotCalled = true;
        }

        if (matchesToolPattern(toolName, SELECTOR_VALIDATION_TOOL_PATTERNS)) {
            state.mcpSelectorValidated = true;
            if (activePageKey) {
                markPageEvidence(state, 'selector', toolName, activePageKey);
            }
        }

        if (matchesToolPattern(toolName, CONTENT_EXTRACTION_TOOL_PATTERNS)) {
            state.mcpContentExtracted = true;
            if (activePageKey) {
                markPageEvidence(state, 'content', toolName, activePageKey);
            }
        }

        if (matchesToolPattern(toolName, URL_VERIFICATION_TOOL_PATTERNS)) {
            state.mcpUrlVerified = true;
            const explicitUrl = typeof args.url === 'string' && /^https?:\/\//i.test(args.url) ? args.url : null;
            if (explicitUrl || activePageKey) {
                markPageEvidence(state, 'url', toolName, explicitUrl || activePageKey);
            }
        }
    }
}

function getMissingPerPageEvidence(state) {
    const missing = [];

    for (const pageKey of state.visitedPages) {
        const record = state.pageEvidenceByUrl.get(pageKey);
        if (!record) {
            continue;
        }

        const gaps = [];
        if (!record.selectorValidated) {
            gaps.push('selector');
        }
        if (!record.contentExtracted) {
            gaps.push('content');
        }
        if (!record.urlVerified) {
            gaps.push('url');
        }

        if (gaps.length > 0) {
            missing.push({ page: pageKey, missing: gaps });
        }
    }

    return missing;
}

function formatRuntimeObservationContext(observation) {
    const blocker = observation.blocker || {};
    const classification = blocker.classification || {};
    const blockerKind = blocker.kind || 'runtime blocker';
    const blockerLabel = blockerKind === 'native-dialog'
        ? 'native browser dialog'
        : blockerKind === 'dom-modal'
            ? 'blocking modal/overlay'
            : 'runtime blocker';
    const detail = blocker.message || blocker.text || blocker.selectorHint || 'No blocker details available.';
    const recovery = blockerKind === 'native-dialog'
        ? 'Call unified_handle_dialog before retrying the blocked interaction.'
        : classification.autoRecoverable === false
            ? `Do NOT blindly retry. Resolve the blocker (${classification.category || blockerKind}) before continuing.`
            : 'Use blocker recovery, re-check page state, then retry the interaction.';

    return (
        `🚨 RUNTIME BLOCKER OBSERVED during ${observation.toolName}: ${blockerLabel}\n` +
        `Details: ${detail}\n\n` +
        'Do NOT continue interacting with underlying elements until the blocker is cleared.\n' +
        recovery
    );
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
    const observationRecorder = new ObservationRecorder({ projectRoot: path.join(__dirname, '..', '..') });
    const runId = options.runId || null;
    const ticketId = options.ticketId || null;
    const scenarioId = options.scenarioId || null;
    const authState = options.authState || null;
    const contextStore = options.contextStore || null;

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

            const explorationEnabled = process.env.MCP_EXPLORATION_ENABLED !== 'false';
            if (explorationEnabled && state.toolCallCount === 1) {
                const isFirstMcpNavigationAction = toolName.includes('unified_navigate') ||
                    (toolName.includes('unified_execute_exploration') && executeExplorationIncludesNavigate(toolArgs));

                if (!isFirstMcpNavigationAction) {
                    log(`🚫 DENIED: First tool call must perform MCP navigation, received "${toolName}"`);
                    state.deniedCalls.push({
                        tool: toolName,
                        reason: 'First tool call must perform MCP navigation',
                        timestamp: new Date().toISOString(),
                    });

                    return {
                        permissionDecision: 'deny',
                        additionalContext:
                            '⛔ BLOCKED: First tool call must perform MCP navigation.\n\n' +
                            'Allowed first calls:\n' +
                            '1. unified_navigate\n' +
                            '2. unified_execute_exploration with a script/template that includes navigate\n\n' +
                            `Received: ${toolName}`,
                    };
                }
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
                registerVisitedPage(state, toolArgs.url || toolArgs.href, `pre:${toolName}`);
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
                const hasNavigate = executeExplorationIncludesNavigate(toolArgs);
                const hasSnapshot = executeExplorationIncludesSnapshot(toolArgs);
                const scriptedNavigateUrls = extractNavigateUrlsFromExecuteExplorationArgs(toolArgs);

                if (hasNavigate) {
                    state.mcpNavigateCalled = true;
                }
                if (hasSnapshot) {
                    state.mcpSnapshotCalled = true;
                }
                if (scriptedNavigateUrls.length > 0) {
                    scriptedNavigateUrls.forEach(url =>
                        registerVisitedPage(state, url, 'pre:execute_exploration:script')
                    );
                }

                if (hasNavigate || hasSnapshot) {
                    log(`✅ MCP batch exploration executed — credits: navigate=${hasNavigate}, snapshot=${hasSnapshot}`);
                } else {
                    log('⚠️ MCP batch exploration executed without explicit navigate/snapshot steps in script/template');
                }
            }

            // Track semantic selector validation (get_by_role, get_by_test_id, get_by_label, get_by_text, get_by_placeholder, get_by_alt_text, get_by_title)
            if (matchesToolPattern(toolName, SELECTOR_VALIDATION_TOOL_PATTERNS)) {
                state.mcpSelectorValidated = true;
                markPageEvidence(state, 'selector', toolName);
                log('✅ MCP semantic selector validated — element confirmed');
            }

            // Track content extraction (get_text_content, get_attribute, get_inner_text, get_input_value)
            if (matchesToolPattern(toolName, CONTENT_EXTRACTION_TOOL_PATTERNS)) {
                state.mcpContentExtracted = true;
                markPageEvidence(state, 'content', toolName);
                log('✅ MCP content extracted — assertion data captured');
            }

            // Track URL verification (get_page_url, expect_url)
            if (matchesToolPattern(toolName, URL_VERIFICATION_TOOL_PATTERNS)) {
                state.mcpUrlVerified = true;
                const explicitUrl = typeof toolArgs.url === 'string' && /^https?:\/\//i.test(toolArgs.url)
                    ? toolArgs.url
                    : null;
                markPageEvidence(state, 'url', toolName, explicitUrl);
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

                    // DENY script creation without URL state verification
                    if (isSpecFile && !state.mcpUrlVerified) {
                        log('🚫 DENIED: No URL verification before .spec.js creation');
                        state.deniedCalls.push({
                            tool: toolName,
                            reason: 'URL verification required before script creation',
                            timestamp: new Date().toISOString(),
                        });
                        return {
                            permissionDecision: 'deny',
                            additionalContext:
                                '⛔ BLOCKED: You must verify page URL state before creating the spec file.\n\n' +
                                'Call at least ONE of these on each explored page:\n' +
                                '- unified_get_page_url (capture the current URL)\n' +
                                '- unified_expect_url (assert URL pattern or exact URL)\n\n' +
                                'URL evidence is mandatory for reliable multi-page flow generation.',
                        };
                    }

                    // DENY script creation if ANY visited page lacks selector/content/url evidence
                    if (isSpecFile) {
                        const missingCoverage = getMissingPerPageEvidence(state);
                        if (missingCoverage.length > 0) {
                            const missingLines = missingCoverage.slice(0, 8)
                                .map(item => `- ${item.page}: missing ${item.missing.join(', ')} evidence`)
                                .join('\n');
                            const overflowLine = missingCoverage.length > 8
                                ? `\n- ...${missingCoverage.length - 8} additional page(s) missing evidence`
                                : '';

                            log(`🚫 DENIED: Per-page coverage incomplete for ${missingCoverage.length} visited page(s)`);
                            state.deniedCalls.push({
                                tool: toolName,
                                reason: `Per-page evidence incomplete (${missingCoverage.length} page(s))`,
                                timestamp: new Date().toISOString(),
                            });

                            return {
                                permissionDecision: 'deny',
                                additionalContext:
                                    '⛔ BLOCKED: Per-page exploration coverage is incomplete.\n\n' +
                                    'Before writing a .spec.js file, EVERY visited page must have:\n' +
                                    '1. Selector evidence (unified_get_by_role/test_id/label/text...)\n' +
                                    '2. Content evidence (unified_get_text_content/get_attribute/get_inner_text/get_input_value)\n' +
                                    '3. URL evidence (unified_get_page_url or unified_expect_url)\n\n' +
                                    'Pages still missing evidence:\n' +
                                    `${missingLines}${overflowLine}`,
                            };
                        }
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
        const toolArgs = input.toolArgs || {};
        const rawResultPayload = parseToolResultPayload(input.result);
        let runtimeObservationContext = null;

        const runtimeObservation = extractRuntimeObservation(toolName, input.result);
        if (runtimeObservation) {
            const storedObservation = {
                ...runtimeObservation,
                timestamp: new Date().toISOString(),
            };
            state.lastRuntimeBlocker = storedObservation;
            state.runtimeObservations.push(storedObservation);
            log(`🚨 Runtime blocker observed via ${toolName}: ${runtimeObservation.blocker.kind || 'unknown'}`);
            runtimeObservationContext = formatRuntimeObservationContext(runtimeObservation);

            if (runId) {
                const recorded = observationRecorder.recordObservation({
                    runId,
                    ticketId,
                    scenarioId,
                    source: 'enforcement-hook',
                    type: 'runtime-blocker',
                    severity: runtimeObservation.blocker?.classification?.severity || 'warning',
                    stage: agentName,
                    toolName,
                    message: runtimeObservation.blocker?.message || runtimeObservation.blocker?.text || 'Runtime blocker observed',
                    metadata: {
                        blocker: runtimeObservation.blocker || null,
                        blockerSource: runtimeObservation.source || null,
                        authState,
                        screenshotRecommended: true,
                    },
                    artifactPath: runtimeObservation.blocker?.screenshotPath || null,
                });

                if (contextStore) {
                    contextStore.addNote('enforcement-hooks',
                        `Runtime blocker recorded for ${toolName}: ${runtimeObservation.blocker?.kind || 'unknown'}`,
                        { observationLogPath: recorded.logPath }
                    );
                }
            }
        }

        if (agentName === 'scriptgenerator') {
            if (toolName.includes('unified_execute_exploration') && rawResultPayload && typeof rawResultPayload === 'object') {
                replayExecuteExplorationCallLog(state, rawResultPayload);
            }

            if (toolName.includes('unified_navigate')) {
                registerVisitedPage(state, toolArgs.url || toolArgs.href, `post:${toolName}:args`);
            }

            const payloadUrls = extractUrlCandidatesFromPayload(rawResultPayload);
            if (payloadUrls.length > 0) {
                const latestUrl = payloadUrls[payloadUrls.length - 1];
                registerVisitedPage(state, latestUrl, `post:${toolName}:result`);

                if (matchesToolPattern(toolName, SELECTOR_VALIDATION_TOOL_PATTERNS)) {
                    state.mcpSelectorValidated = true;
                    markPageEvidence(state, 'selector', toolName, latestUrl);
                }

                if (matchesToolPattern(toolName, CONTENT_EXTRACTION_TOOL_PATTERNS)) {
                    state.mcpContentExtracted = true;
                    markPageEvidence(state, 'content', toolName, latestUrl);
                }

                if (matchesToolPattern(toolName, URL_VERIFICATION_TOOL_PATTERNS)) {
                    state.mcpUrlVerified = true;
                    markPageEvidence(state, 'url', toolName, latestUrl);
                }
            } else {
                if (matchesToolPattern(toolName, SELECTOR_VALIDATION_TOOL_PATTERNS)) {
                    state.mcpSelectorValidated = true;
                    markPageEvidence(state, 'selector', toolName);
                }

                if (matchesToolPattern(toolName, CONTENT_EXTRACTION_TOOL_PATTERNS)) {
                    state.mcpContentExtracted = true;
                    markPageEvidence(state, 'content', toolName);
                }

                if (matchesToolPattern(toolName, URL_VERIFICATION_TOOL_PATTERNS)) {
                    state.mcpUrlVerified = true;
                    markPageEvidence(state, 'url', toolName);
                }
            }
        }

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

                if (runId) {
                    const recorded = observationRecorder.recordObservation({
                        runId,
                        ticketId,
                        scenarioId,
                        source: 'enforcement-hook',
                        type: 'snapshot-quality',
                        severity: qualityAssessment.decision === OODA_DECISION.RETRY_RECOMMENDED ? 'warning' : 'info',
                        stage: agentName,
                        toolName,
                        message: `Snapshot quality ${qualityAssessment.decision} (${qualityAssessment.score})`,
                        metadata: {
                            score: qualityAssessment.score,
                            decision: qualityAssessment.decision,
                            warnings: qualityAssessment.warnings,
                            recommendation: qualityAssessment.recommendation,
                            authState,
                        },
                    });

                    if (contextStore) {
                        contextStore.addNote('enforcement-hooks',
                            `Snapshot quality recorded: ${qualityAssessment.decision} (${qualityAssessment.score})`,
                            { observationLogPath: recorded.logPath }
                        );
                    }
                }

                // ── OODA ENFORCEMENT: Reset snapshot flag on RETRY_RECOMMENDED ──
                // This converts the existing pre-tool gate into a quality-aware gate.
                // The agent CANNOT create a .spec.js until it obtains a good snapshot.
                if (qualityAssessment.decision === OODA_DECISION.RETRY_RECOMMENDED) {
                    state.mcpSnapshotCalled = false;
                    log('🚨 OODA: mcpSnapshotCalled reset to FALSE — spec creation blocked until quality snapshot obtained');
                }

                return {
                    additionalContext:
                        (runtimeObservationContext ? `${runtimeObservationContext}\n\n` : '') +
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

        return runtimeObservationContext
            ? { additionalContext: runtimeObservationContext }
            : {};
    };

    // ─────────────────────────────────────────────────────────────────
    // onErrorOccurred — Intelligent recovery strategies
    // ─────────────────────────────────────────────────────────────────
    hooks.onErrorOccurred = async (input, invocation) => {
        const errorMsg = input.error || '';
        const context = input.errorContext || '';
        const state = getState(invocation.sessionId || stableFallbackId);

        log(`Error in ${context}: ${errorMsg.substring(0, 100)}`);

        if (errorMsg.includes('RUNTIME_BLOCKER') || errorMsg.includes('Blocked by native dialog') || errorMsg.includes('Blocked by modal')) {
            const lastObservation = state.lastRuntimeBlocker;
            const blockerClassification = lastObservation?.blocker?.classification || {};
            return {
                errorHandling: blockerClassification.autoRecoverable === false ? 'abort' : 'retry',
                additionalContext: lastObservation
                    ? formatRuntimeObservationContext(lastObservation)
                    : 'Runtime blocker detected. Clear the blocking dialog/modal before retrying the previous action.',
            };
        }

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
        runtimeObservations: latestState.runtimeObservations.length,
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
    const baseHooks = createEnforcementHooks('scriptgenerator', options);

    if (!rules) {
        // Unknown phase — fall back to standard scriptgenerator hooks
        return createEnforcementHooks('scriptgenerator', options);
    }

    const stableFallbackId = `${phaseName}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const phaseSessionState = new Map();
    const getPhaseState = (sessionId) => {
        if (!phaseSessionState.has(sessionId)) {
            phaseSessionState.set(sessionId, { toolCallCount: 0 });
        }
        return phaseSessionState.get(sessionId);
    };
    const log = (msg) => { if (verbose) console.log(`[CognitiveEnforcement:${phaseName}] ${msg}`); };

    const hooks = {};

    hooks.onPreToolUse = async (input, invocation) => {
        const toolName = input.toolName || '';
        const toolArgs = input.toolArgs || {};
        const phaseState = getPhaseState(invocation.sessionId || stableFallbackId);
        phaseState.toolCallCount++;

        if (phaseName === 'cognitive-explorer-nav' && process.env.MCP_EXPLORATION_ENABLED !== 'false' && phaseState.toolCallCount === 1) {
            const isFirstMcpNavigationAction = toolName.includes('unified_navigate') ||
                (toolName.includes('unified_execute_exploration') && executeExplorationIncludesNavigate(toolArgs));

            if (!isFirstMcpNavigationAction) {
                log(`🚫 DENIED: First cognitive explorer tool call must perform navigation, received "${toolName}"`);
                return {
                    permissionDecision: 'deny',
                    additionalContext:
                        '⛔ BLOCKED: The first tool call in cognitive explorer navigation phase must perform MCP navigation.\n' +
                        'Call unified_navigate first, or unified_execute_exploration with a navigate step.',
                };
            }
        }

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
        if (input.toolName?.includes('unified_') && typeof baseHooks.onPostToolUse === 'function') {
            const baseResult = await baseHooks.onPostToolUse(input, invocation);
            if (baseResult?.permissionDecision === 'deny' || baseResult?.additionalContext) {
                return baseResult;
            }
        }

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

        if ((rules.allowMCP || errorMsg.includes('RUNTIME_BLOCKER')) && typeof baseHooks.onErrorOccurred === 'function') {
            const baseResult = await baseHooks.onErrorOccurred(input, invocation);
            if (baseResult?.additionalContext || baseResult?.errorHandling !== 'skip') {
                return baseResult;
            }
        }

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

    hooks.onSessionEnd = async (input, invocation) => {
        phaseSessionState.delete(invocation.sessionId || stableFallbackId);
        return {};
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
        const toolWarnings = [
            ...(Array.isArray(result.warnings) ? result.warnings : []),
            ...(Array.isArray(result.validation?.warnings) ? result.validation.warnings : []),
        ].filter(Boolean);
        const uniqueWarnings = [...new Set(toolWarnings)];

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

        if (uniqueWarnings.length > 0) {
            issues.push(...uniqueWarnings.slice(0, 5));
            score -= Math.min(20, uniqueWarnings.length * 5);
        }

        if (Array.isArray(result.slideTypes) && count >= 6 && result.slideTypes.length < 3) {
            issues.push('Deck uses very few slide types for a multi-slide presentation — output may feel repetitive or template-like.');
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
