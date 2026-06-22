/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * PLAYWRIGHT DIRECT BRIDGE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Direct integration with Playwright (no subprocess spawning)
 * This solves the timeout issues by using Playwright's API directly.
 * 
 * ENHANCED: Now includes 55+ additional methods from Playwright cheatsheet
 * for deep application exploration and accurate selector generation.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { chromium, firefox, webkit } from 'playwright';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { applyEnhancedMethods } from './enhanced-playwright-methods.js';
import { applyAdvancedMethods } from './advanced-playwright-methods.js';
import { applyIntelligentPrimitives } from './intelligent-primitives-methods.js';
import { SelectorEngine } from '../utils/selector-engine.js';
import { BlockerRegistry } from '../utils/blocker-registry.js';
// Cognitive Browser Runtime (CBR) — feature-flagged perception/control layer (default OFF).
import { getResidentAgentSource, RESIDENT_AGENT_VERSION } from '../runtime/resident-agent.js';
import { PerceptionStore } from '../runtime/perception-store.js';
import { ReactiveCore } from '../runtime/reactive-core.js';
import { HealStore } from '../runtime/heal-store.js';
import { HealingResolver } from '../runtime/healing-resolver.js';
import { VisionFusion } from '../runtime/vision-fusion.js';
import { AppGraph } from '../runtime/app-graph.js';
import { GraphRecorder } from '../runtime/graph-recorder.js';
import { IntentProtocol } from '../runtime/intent-protocol.js';
import { PlaywrightTransport } from '../transport/playwright-transport.js';
import { RawCdpTransport } from '../transport/raw-cdp-transport.js';
import { TransportRouter } from '../transport/transport-router.js';

const require = createRequire(import.meta.url);

/**
 * Direct Playwright Bridge - Uses Playwright library directly
 * Enhanced with deep exploration capabilities
 */
export class PlaywrightDirectBridge extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            headless: config.headless ?? (process.env.MCP_HEADLESS !== 'false'),
            browser: config.browser ?? process.env.MCP_BROWSER ?? 'chromium',
            viewport: config.viewport ?? { width: 1280, height: 720 },
            timeout: config.timeout ?? (parseInt(process.env.MCP_TIMEOUT) || 30000),
            autoDismissKnownPopups: config.autoDismissKnownPopups ?? true,
            autoDismissDiscoveredBlockers: config.autoDismissDiscoveredBlockers ?? true,
            blockerRegistryEnabled: config.blockerRegistryEnabled ?? true,
            blockerRegistryPath: config.blockerRegistryPath,
            // CBR feature flags (default OFF via env; legacy behavior untouched).
            residentAgent: config.residentAgent ?? (process.env.MCP_RESIDENT_AGENT === 'true'),
            visionFusion: config.visionFusion ?? (process.env.MCP_VISION_FUSION === 'true'),
            appGraph: config.appGraph ?? (process.env.MCP_APP_GRAPH === 'true'),
            rawCdp: config.rawCdp ?? (process.env.MCP_RAW_CDP === 'true'),
            ...config,
            blockerRecovery: {
                postActionObservationMs: config.blockerRecovery?.postActionObservationMs ?? 750,
                pollIntervalMs: config.blockerRecovery?.pollIntervalMs ?? 50,
                allowEscapeKey: config.blockerRecovery?.allowEscapeKey ?? true,
                allowBackdropClick: config.blockerRecovery?.allowBackdropClick ?? false,
            },
        };

        this.browser = null;
        this.context = null;
        this.page = null;
        this.connected = false;
        this.snapshotRefs = new Map(); // Store element references from snapshots
        this._snapshotCache = null; // { key, payload } — enables near-free repeated snapshots

        // ── Cognitive Browser Runtime (CBR) — feature-flagged perception/control layer ──
        // Resident perception agent (P1): live in-page Digital Twin + delta push.
        this._residentAgentEnabled = this.config.residentAgent === true;
        this._perceptionStore = new PerceptionStore();
        this._residentBindingExposed = false;
        // Event-driven reactive core (P2): push-based blocker/quiescence awaits (resident is its source).
        this._reactiveCore = this._residentAgentEnabled ? new ReactiveCore(this) : null;
        // Self-healing resolver + learning store (P4): re-anchor broken selectors by stable identity.
        this._healStore = this._residentAgentEnabled ? new HealStore({ persist: this.config.healPersist !== false }) : null;
        this._healingResolver = this._residentAgentEnabled
            ? new HealingResolver(this, { healStore: this._healStore, onHeal: (h) => this.emit('selector-heal', h) })
            : null;
        // Vision+DOM+AX fusion (P5): fills names for DOM-blind elements (icon-only, canvas).
        this._visionFusionEnabled = this.config.visionFusion === true;
        this._visionFusion = this._visionFusionEnabled
            ? new VisionFusion(this, { maxVisionCalls: this.config.maxVisionCalls ?? 8 })
            : null;
        // Application knowledge graph (P6): records page states + labeled journeys (offline reasoning).
        this._appGraphEnabled = this.config.appGraph === true;
        this._appGraph = this._appGraphEnabled ? new AppGraph({ persist: this.config.appGraphPersist !== false }) : null;
        this._graphRecorder = this._appGraph ? new GraphRecorder(this, this._appGraph) : null;
        // Semantic intent protocol (P7): perceive/act/await/observe + transparent resolution audit.
        this._intent = new IntentProtocol(this);
        // Raw-CDP fast-path transport (P3): lazily initialized on first use.
        this._rawCdpEnabled = this.config.rawCdp === true;
        this._transport = null;
        this._visionResolve = false; // set transiently by act() for vision-assisted target resolution

        // Storage for multi-page and download handling
        this._lastNewPage = null;
        this._lastDownload = null;
        this._trackedPages = new WeakSet();
        this._tabIds = new WeakMap();
        this._nextTabId = 1;

        // Event capture storage (ring buffers with configurable max size)
        this._consoleMessages = [];
        this._networkRequests = new Map();
        this._pageErrors = [];
        this._dialogs = [];
        this._activeDialog = null;
        this._pendingDialogHandler = null;
        this._maxConsoleMessages = config.maxConsoleMessages ?? 1000;
        this._maxNetworkRequests = config.maxNetworkRequests ?? 500;
        this._maxPageErrors = config.maxPageErrors ?? 100;
        this._captureConsole = config.captureConsole ?? true;
        this._captureNetwork = config.captureNetwork ?? true;
        this._popupHandlerClass = undefined;
        this._blockerRegistry = new BlockerRegistry({
            enabled: this.config.blockerRegistryEnabled,
            registryPath: this.config.blockerRegistryPath,
        });

        // Apply enhanced methods from Playwright cheatsheet
        applyEnhancedMethods(this);

        // Apply advanced methods (iframe, shadow DOM, network interception, storage, etc.)
        applyAdvancedMethods(this);

        // Apply intelligent primitives (act / observe / extract) — high-level,
        // self-healing, single round-trip. Wraps callTool, so it is applied last.
        applyIntelligentPrimitives(this);
    }

    /**
     * Check if bridge is connected
     */
    isConnected() {
        return this.connected && this.browser !== null;
    }

    /**
     * Connect/Launch browser
     */
    async connect() {
        if (this.connected) {
            console.error('[PlaywrightDirect] Already connected');
            return;
        }

        console.error(`[PlaywrightDirect] Launching ${this.config.browser}...`);

        try {
            // Select browser type
            const browserType = {
                chromium: chromium,
                firefox: firefox,
                webkit: webkit,
            }[this.config.browser] || chromium;

            // Launch browser
            this.browser = await browserType.launch({
                headless: this.config.headless,
            });

            // Create context with viewport
            this.context = await this.browser.newContext({
                viewport: this.config.viewport,
            });

            // Snapshot-cache invalidation. With the resident perception agent (P1) the in-page
            // Digital Twin maintains window.__mcpDomSeq itself and streams deltas to Node;
            // otherwise install the lightweight standalone DOM-version counter.
            if (this._residentAgentEnabled) {
                await this._installResidentAgent();
            } else {
                await this.context.addInitScript(() => {
                    try {
                        if (window.__mcpDomSeqInstalled) return;
                        window.__mcpDomSeqInstalled = true;
                        window.__mcpDomSeq = 0;
                        const bump = () => { window.__mcpDomSeq = (window.__mcpDomSeq || 0) + 1; };
                        const observe = () => {
                            if (!document.documentElement) return;
                            try {
                                new MutationObserver(bump).observe(document.documentElement, {
                                    subtree: true, childList: true, attributes: true,
                                });
                            } catch (e) { /* no-op */ }
                        };
                        if (document.readyState === 'loading') {
                            document.addEventListener('DOMContentLoaded', observe, { once: true });
                        } else {
                            observe();
                        }
                    } catch (e) { /* no-op */ }
                });
            }

            // Create initial page
            this.page = await this.context.newPage();
            this.page.setDefaultTimeout(this.config.timeout);

            // Attach event listeners for console, network, errors
            this._attachEventListeners(this.page);

            this.connected = true;
            console.error('[PlaywrightDirect] Browser launched successfully');
            console.error('[PlaywrightDirect] Enhanced tools available: 90+ capabilities');
            console.error('[PlaywrightDirect] Event capture: console=' + this._captureConsole + ' network=' + this._captureNetwork);
        } catch (error) {
            console.error('[PlaywrightDirect] Failed to launch browser:', error.message);
            throw error;
        }
    }

    /**
     * Attach event listeners for console messages, network requests, page errors, and dialogs.
     * Called on initial page and should be called on any new page (tab) that is tracked.
     */
    _attachEventListeners(page) {
        if (!page) return;
        if (this._trackedPages.has(page)) return;

        this._trackedPages.add(page);
        this._ensureTabId(page);

        // ── Console Messages ──
        if (this._captureConsole) {
            page.on('console', (msg) => {
                const entry = {
                    type: msg.type(),           // 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace'
                    text: msg.text(),
                    location: msg.location(),    // { url, lineNumber, columnNumber }
                    timestamp: Date.now(),
                };
                this._consoleMessages.push(entry);
                // Ring buffer: evict oldest when over capacity
                if (this._consoleMessages.length > this._maxConsoleMessages) {
                    this._consoleMessages.shift();
                }
                this.emit('console', entry);
            });
        }

        // ── Page Errors (uncaught exceptions) ──
        page.on('pageerror', (error) => {
            const entry = {
                message: error.message,
                stack: error.stack,
                timestamp: Date.now(),
            };
            this._pageErrors.push(entry);
            if (this._pageErrors.length > this._maxPageErrors) {
                this._pageErrors.shift();
            }
            this.emit('pageerror', entry);
        });

        // ── Network Requests ──
        if (this._captureNetwork) {
            page.on('request', (request) => {
                const id = request.url() + '|' + Date.now() + '|' + Math.random().toString(36).slice(2, 8);
                const entry = {
                    id,
                    url: request.url(),
                    method: request.method(),
                    headers: request.headers(),
                    postData: request.postData(),
                    resourceType: request.resourceType(),
                    timestamp: Date.now(),
                    status: null,
                    responseHeaders: null,
                    responseBody: null,
                    duration: null,
                    failure: null,
                };
                this._networkRequests.set(id, entry);
                // Ring buffer for Map
                if (this._networkRequests.size > this._maxNetworkRequests) {
                    const firstKey = this._networkRequests.keys().next().value;
                    this._networkRequests.delete(firstKey);
                }
                // Tag request with id for response matching
                request.__mcpId = id;
            });

            page.on('response', (response) => {
                const request = response.request();
                const id = request.__mcpId;
                if (id && this._networkRequests.has(id)) {
                    const entry = this._networkRequests.get(id);
                    entry.status = response.status();
                    entry.statusText = response.statusText();
                    entry.responseHeaders = response.headers();
                    entry.duration = Date.now() - entry.timestamp;
                    this.emit('response', entry);
                }
            });

            page.on('requestfailed', (request) => {
                const id = request.__mcpId;
                if (id && this._networkRequests.has(id)) {
                    const entry = this._networkRequests.get(id);
                    entry.failure = request.failure()?.errorText || 'Unknown failure';
                    entry.duration = Date.now() - entry.timestamp;
                    this.emit('requestfailed', entry);
                }
            });
        }

        // ── Dialogs (alert, confirm, prompt, beforeunload) ──
        page.on('dialog', async (dialog) => {
            const entry = {
                id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                kind: 'native-dialog',
                type: dialog.type(),
                message: dialog.message(),
                defaultValue: dialog.defaultValue(),
                timestamp: Date.now(),
                handled: false,
                blocking: true,
                dialogHandle: dialog,
            };
            this._dialogs.push(entry);
            this._activeDialog = entry;
            this.emit('dialog', entry);
            // Feed the reactive core (P2) so post-action observation resolves instantly.
            this.emit('native-dialog', { id: entry.id, type: entry.type, message: entry.message });

            const pendingHandler = this._pendingDialogHandler;
            if (pendingHandler) {
                this._pendingDialogHandler = null;
                try {
                    await this._resolveDialog(entry, pendingHandler);
                } catch (error) {
                    entry.error = error.message;
                }
            }
        });

        page.on('close', () => {
            // WeakMap entries are GC-managed; refresh active page if needed.
            if (page === this.page) {
                const remainingPages = this.context?.pages?.() || [];
                this.page = remainingPages[0] || null;
            }
        });
    }

    _ensureTabId(page) {
        if (!page) return null;

        let tabId = this._tabIds.get(page);
        if (!tabId) {
            tabId = `tab-${this._nextTabId++}`;
            this._tabIds.set(page, tabId);
        }

        return tabId;
    }

    _getTabDescriptors() {
        const pages = this.context?.pages?.() || [];
        return pages.map((page, index) => ({
            page,
            index,
            tabId: this._ensureTabId(page),
            url: typeof page.url === 'function' ? page.url() : '',
            active: page === this.page,
        }));
    }

    _resolveTabTarget({ index, tabId } = {}) {
        const tabs = this._getTabDescriptors();

        if (tabId) {
            return tabs.find((tab) => tab.tabId === tabId) || null;
        }

        if (index !== undefined) {
            return tabs.find((tab) => tab.index === index) || null;
        }

        return null;
    }

    /**
     * Ensure connected before operations
     */
    async ensureConnected() {
        // Check actual browser/page health, not just the boolean flag.
        // If the browser crashed mid-session (OOM, user closed window in headed mode),
        // this.connected is still true but the page object is dead.
        if (this.connected) {
            const browserAlive = this.browser && this.browser.isConnected();
            const pageAlive = this.page && !this.page.isClosed();
            if (!browserAlive || !pageAlive) {
                console.error('[PlaywrightDirect] Browser/page is dead — reconnecting...');
                // Reset stale state
                this.browser = null;
                this.context = null;
                this.page = null;
                this.connected = false;
            }
        }
        if (!this.connected) {
            await this.connect();
        }
    }

    _serializeBlocker(entry) {
        if (!entry) return null;

        const classification = entry.classification || this._classifyBlocker(entry);

        return {
            id: entry.id || null,
            kind: entry.kind || 'unknown',
            type: entry.type || null,
            message: entry.message || null,
            blocking: entry.blocking !== false,
            selectorHint: entry.selectorHint || null,
            role: entry.role || null,
            ariaLabel: entry.ariaLabel || null,
            text: entry.text || null,
            dismissControls: entry.dismissControls || [],
            bounds: entry.bounds || null,
            zIndex: entry.zIndex || null,
            timestamp: entry.timestamp || null,
            handled: entry.handled === true,
            handledAt: entry.handledAt || null,
            action: entry.action || null,
            classification,
            focusTrap: entry.focusTrap === true,
            bodyOverflowLocked: entry.bodyOverflowLocked === true,
            occlusion: entry.occlusion || null,
        };
    }

    _buildBlockedResult(action, blocker, extra = {}) {
        const serialized = this._serializeBlocker(blocker);
        const recommendedAction = serialized?.kind === 'native-dialog'
            ? 'handle_dialog'
            : serialized?.classification?.recommendedAction || 'dismiss_modal_or_retry';
        const blockerLabel = serialized?.kind === 'native-dialog'
            ? `native dialog${serialized?.message ? `: ${serialized.message}` : ''}`
            : serialized?.kind === 'dom-modal'
                ? `blocking modal${serialized?.text ? `: ${serialized.text}` : ''}`
                : 'runtime blocker';

        return {
            success: false,
            error: `Blocked by ${blockerLabel}`,
            errorCode: 'RUNTIME_BLOCKER',
            blocker: serialized,
            recovery: {
                recommendedAction,
                retryable: serialized?.classification?.retryable !== false,
            },
            ...extra,
        };
    }

    _normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    _classifyBlocker(blocker) {
        if (!blocker) {
            return {
                category: 'unknown',
                severity: 'medium',
                confidence: 0,
                autoRecoverable: false,
                retryable: true,
                recommendedAction: 'inspect_blocker',
                reasons: ['missing-blocker'],
            };
        }

        if (blocker.kind === 'native-dialog') {
            return {
                category: 'browser-dialog',
                severity: 'high',
                confidence: 1,
                autoRecoverable: false,
                retryable: true,
                recommendedAction: 'handle_dialog',
                reasons: ['native-dialog'],
            };
        }

        const textParts = [
            blocker.text,
            blocker.message,
            blocker.ariaLabel,
            blocker.role,
            ...(blocker.dismissControls || []).flatMap((control) => [control.text, control.ariaLabel]),
        ].filter(Boolean);
        const normalized = this._normalizeText(textParts.join(' ')).toLowerCase();
        const dismissLabels = (blocker.dismissControls || [])
            .map((control) => this._normalizeText(`${control.text || ''} ${control.ariaLabel || ''}`).toLowerCase())
            .filter(Boolean);

        const hasKeyword = (patterns) => patterns.some((pattern) => pattern.test(normalized));
        const hasDismissKeyword = (patterns) => dismissLabels.some((label) => patterns.some((pattern) => pattern.test(label)));

        if (hasKeyword([/session expired/, /sign in/, /log ?in/, /authenticate/, /re-auth/, /password/, /access denied/])) {
            return {
                category: 'auth-required',
                severity: 'high',
                confidence: 0.92,
                autoRecoverable: false,
                retryable: false,
                recommendedAction: 'refresh_auth',
                reasons: ['auth-keywords'],
            };
        }

        if (hasKeyword([/error/, /failed/, /unavailable/, /exception/, /try again later/, /problem occurred/])) {
            return {
                category: 'app-error',
                severity: 'high',
                confidence: 0.9,
                autoRecoverable: false,
                retryable: false,
                recommendedAction: 'inspect_application_error',
                reasons: ['error-keywords'],
            };
        }

        if (hasKeyword([/terms/, /privacy/, /consent/, /permission/, /allow access/, /location access/, /cookies?/])) {
            return {
                category: 'consent-required',
                severity: 'high',
                confidence: 0.88,
                autoRecoverable: false,
                retryable: false,
                recommendedAction: 'review_consent_prompt',
                reasons: ['consent-keywords'],
            };
        }

        if (hasKeyword([/loading/, /please wait/, /fetching/, /initializing/, /spinner/, /processing/])) {
            return {
                category: 'loading-interstitial',
                severity: 'medium',
                confidence: 0.82,
                autoRecoverable: true,
                retryable: true,
                recommendedAction: 'wait_for_overlay_to_clear',
                reasons: ['loading-keywords'],
            };
        }

        if (blocker.kind === 'dom-occlusion' || blocker.occlusion?.pointsBlocked > 0 || blocker.focusTrap === true) {
            return {
                category: 'occluding-overlay',
                severity: 'medium',
                confidence: 0.72,
                autoRecoverable: (blocker.dismissControls || []).length > 0,
                retryable: true,
                recommendedAction: (blocker.dismissControls || []).length > 0 ? 'auto_dismiss_blocker' : 'inspect_blocker',
                reasons: ['target-occlusion-or-focus-trap'],
            };
        }

        if (hasKeyword([/tour/, /welcome/, /getting started/, /onboarding/, /tips?/, /hot sheet/, /news/, /alerts?/]) || hasDismissKeyword([/close/, /dismiss/, /skip/, /not now/, /got it/, /continue/, /ok\b/, /i('| a)m ready/, /i('| a)ve read this/, /read later/, /understood/])) {
            return {
                category: 'informational-modal',
                severity: 'low',
                confidence: 0.8,
                autoRecoverable: true,
                retryable: true,
                recommendedAction: 'auto_dismiss_blocker',
                reasons: ['informational-keywords-or-safe-dismiss'],
            };
        }

        return {
            category: 'unknown-modal',
            severity: 'medium',
            confidence: 0.4,
            autoRecoverable: false,
            retryable: true,
            recommendedAction: 'inspect_blocker',
            reasons: ['fallback-unknown'],
        };
    }

    _isSafeDismissControl(control, classification) {
        if (!control) return false;
        if (!classification?.autoRecoverable) return false;

        const label = this._normalizeText(`${control.text || ''} ${control.ariaLabel || ''}`).toLowerCase();
        if (!label) {
            return /close|dismiss|dialog-close|modal-close/i.test(control.selectorHint || '');
        }

        if (/(accept|allow|agree|consent|enable|turn on|yes|submit|confirm|log ?in|sign in)/i.test(label)) {
            return false;
        }

        return /(close|dismiss|skip|not now|later|got it|continue|ok\b|cancel|understood|i('| a)ve read this|read later)/i.test(label);
    }

    _rankDismissControls(blocker, classification) {
        const scoreControl = (control) => {
            const label = this._normalizeText(`${control.text || ''} ${control.ariaLabel || ''}`).toLowerCase();
            let score = 0;
            if (/(i('| a)ve read this|dismiss|close)/i.test(label)) score += 50;
            if (/(skip|not now|later|got it|understood)/i.test(label)) score += 40;
            if (/(continue|ok\b|cancel)/i.test(label)) score += 25;
            if (control.selectorHint && /(data-testid|data-test-id|aria-label|button:has-text|text=)/i.test(control.selectorHint)) score += 10;
            if (!this._isSafeDismissControl(control, classification)) score -= 100;
            return score;
        };

        return [...(blocker.dismissControls || [])]
            .map((control) => ({ control, score: scoreControl(control) }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)
            .map((entry) => entry.control);
    }

    _recordResolvedBlocker(blocker, classification, strategy, control = null) {
        try {
            this._blockerRegistry?.recordResolution({
                blocker,
                classification,
                strategy,
                control,
                source: 'playwright-bridge',
            });
        } catch (error) {
            console.error(`[PlaywrightDirect] Failed to persist blocker resolution: ${error.message}`);
        }
    }

    async _dismissUsingRegistry(blocker, classification) {
        const registryMatch = this._blockerRegistry?.findResolution(blocker, classification);
        if (!registryMatch?.preferredStrategy) {
            return { success: false, skipped: true, reason: 'no blocker registry match' };
        }

        const preferred = registryMatch.preferredStrategy;

        if (preferred.name === 'escape-key') {
            const escapeResult = await this._dismissWithEscape(blocker, classification);
            if (escapeResult.success) {
                this._recordResolvedBlocker(blocker, classification, 'escape-key');
            }
            return {
                ...escapeResult,
                strategy: 'registry-escape-key',
                registryMatch,
            };
        }

        if (preferred.controlSelectorHint && typeof this.page?.click === 'function') {
            try {
                await this.page.click(preferred.controlSelectorHint);
                const resolution = await this._waitForBlockerResolution(blocker.id);
                if (resolution.success) {
                    this._recordResolvedBlocker(blocker, classification, 'registry-control', {
                        selectorHint: preferred.controlSelectorHint,
                        text: preferred.controlText,
                    });
                }
                return {
                    success: resolution.success,
                    dismissed: resolution.success,
                    strategy: 'registry-control',
                    registryMatch,
                    remainingBlocker: resolution.remainingBlocker || null,
                };
            } catch (error) {
                return {
                    success: false,
                    dismissed: false,
                    strategy: 'registry-control',
                    registryMatch,
                    error: error.message,
                };
            }
        }

        return { success: false, skipped: true, reason: 'unsupported registry strategy', registryMatch };
    }

    async _waitForBlockerResolution(previousBlockerId, timeoutMs = 400) {
        const pollIntervalMs = this.config.blockerRecovery?.pollIntervalMs || 50;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
            const blockerState = await this.getBlockingState();
            if (!blockerState.present) {
                return { success: true, remainingBlocker: null };
            }

            if (previousBlockerId && blockerState.blocker?.id && blockerState.blocker.id !== previousBlockerId) {
                return { success: false, remainingBlocker: blockerState.blocker, replaced: true };
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        const remaining = await this.getBlockingState();
        return {
            success: !remaining.present,
            remainingBlocker: remaining.blocker || null,
        };
    }

    async _dismissViaDiscoveredControls(blocker, classification) {
        if (!this.config.autoDismissDiscoveredBlockers) {
            return { success: false, skipped: true, reason: 'autoDismissDiscoveredBlockers disabled' };
        }

        const controls = this._rankDismissControls(blocker, classification);
        if (controls.length === 0) {
            return { success: false, skipped: true, reason: 'no safe discovered dismiss controls' };
        }

        for (const control of controls) {
            if (!control.selectorHint || typeof this.page?.click !== 'function') {
                continue;
            }

            try {
                await this.page.click(control.selectorHint);
                const resolution = await this._waitForBlockerResolution(blocker.id);
                if (resolution.success) {
                    this._recordResolvedBlocker(blocker, classification, 'discovered-control', control);
                    return {
                        success: true,
                        dismissed: true,
                        strategy: 'discovered-control',
                        control,
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    dismissed: false,
                    strategy: 'discovered-control',
                    control,
                    error: error.message,
                };
            }
        }

        return {
            success: false,
            dismissed: false,
            strategy: 'discovered-control',
            reason: 'controls did not clear blocker',
        };
    }

    async _dismissWithEscape(blocker, classification) {
        if (!classification?.autoRecoverable || !this.config.blockerRecovery?.allowEscapeKey) {
            return { success: false, skipped: true, reason: 'escape disabled or blocker not auto-recoverable' };
        }

        if (typeof this.page?.keyboard?.press !== 'function') {
            return { success: false, skipped: true, reason: 'keyboard press unavailable' };
        }

        try {
            await this.page.keyboard.press('Escape');
            const resolution = await this._waitForBlockerResolution(blocker.id);
            if (resolution.success) {
                this._recordResolvedBlocker(blocker, classification, 'escape-key');
            }
            return {
                success: resolution.success,
                dismissed: resolution.success,
                strategy: 'escape-key',
                remainingBlocker: resolution.remainingBlocker || null,
            };
        } catch (error) {
            return {
                success: false,
                dismissed: false,
                strategy: 'escape-key',
                error: error.message,
            };
        }
    }

    async _attemptBlockerRecovery(action, target, blocker, options = {}) {
        const serialized = this._serializeBlocker(blocker);
        const classification = serialized?.classification || this._classifyBlocker(blocker);
        const attempts = [];

        if (!serialized?.kind?.startsWith('dom-') || options.tryAutoDismiss === false) {
            return {
                recovered: false,
                classification,
                attempts,
            };
        }

        const knownDismissal = await this.dismissKnownPopups();
        attempts.push({ strategy: 'known-popup-handler', ...knownDismissal });
        let blockerState = await this.getBlockingState(options);
        if (!blockerState.present) {
            this._recordResolvedBlocker(blocker, classification, 'known-popup-handler');
            return {
                recovered: true,
                classification,
                attempts,
            };
        }

        const registryDismissal = await this._dismissUsingRegistry(blockerState.blocker, classification);
        attempts.push(registryDismissal);
        blockerState = await this.getBlockingState(options);
        if (!blockerState.present) {
            return {
                recovered: true,
                classification,
                attempts,
            };
        }

        const discoveredDismissal = await this._dismissViaDiscoveredControls(blockerState.blocker, classification);
        attempts.push(discoveredDismissal);
        blockerState = await this.getBlockingState(options);
        if (!blockerState.present) {
            return {
                recovered: true,
                classification,
                attempts,
            };
        }

        const escapeDismissal = await this._dismissWithEscape(blockerState.blocker, classification);
        attempts.push(escapeDismissal);
        blockerState = await this.getBlockingState(options);
        return {
            recovered: !blockerState.present,
            classification,
            attempts,
            remainingBlocker: blockerState.blocker || null,
            action,
            target,
        };
    }

    async recoverCurrentBlocker(options = {}) {
        const blockerState = options.existingBlocker
            ? { present: true, blocker: options.existingBlocker }
            : await this.getBlockingState(options);

        if (!blockerState?.present || !blockerState.blocker) {
            return {
                recovered: false,
                skipped: true,
                reason: 'no active blocker',
            };
        }

        return this._attemptBlockerRecovery(
            options.action || 'recover_current_blocker',
            options.target || options.targetSelector || null,
            blockerState.blocker,
            options,
        );
    }

    async _detectDomModalBlocker(options = {}) {
        if (!this.page || this.page.isClosed()) {
            return null;
        }

        try {
            return await this.page.evaluate(({ targetSelector }) => {
                const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();
                const escapeText = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                // Page chrome that is NOT a dismissable modal even when positioned / high z-index:
                // maps (Google/Mapbox/Leaflet) and raw canvases routinely cover the viewport and
                // intercept pointer events, but they ARE the page — flagging them as blockers
                // produces false RUNTIME_BLOCKER errors on legitimate clicks.
                const EXCLUDED_CHROME_SELECTOR = '.gm-style,.gmnoprint,.gm-style-cc,canvas,[class*="mapboxgl"],.leaflet-container,.leaflet-pane,[class*="map-canvas" i],[class*="mapCanvas" i]';
                const isExcludedChrome = (element) => {
                    if (!element || typeof element.matches !== 'function') return false;
                    try {
                        if (element.matches(EXCLUDED_CHROME_SELECTOR)) return true;
                        if (typeof element.closest === 'function' &&
                            element.closest('.gm-style,[class*="mapboxgl"],.leaflet-container')) return true;
                    } catch { /* invalid selector / detached node */ }
                    return false;
                };
                const isBodyScrollLocked = () => {
                    try {
                        const bodyOverflow = window.getComputedStyle(document.body).overflow;
                        const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
                        return ['hidden', 'clip'].includes(bodyOverflow) || ['hidden', 'clip'].includes(htmlOverflow);
                    } catch { return false; }
                };
                const hasModalSignal = (element) => {
                    if (!element || typeof element.matches !== 'function') return false;
                    try {
                        if (element.matches('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) return true;
                        return !!element.querySelector('[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
                    } catch { return false; }
                };
                const safeQuerySelector = (selector) => {
                    if (!selector || typeof selector !== 'string') return null;
                    if (/^text=|^xpath=|>>|:has-text\(/i.test(selector)) return null;
                    try {
                        return document.querySelector(selector);
                    } catch {
                        return null;
                    }
                };
                const toStableId = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'blocker';
                const toSelectorHint = (element) => {
                    if (!element) return null;
                    if (element.id) return `#${element.id}`;
                    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-qa');
                    if (testId) return `[data-testid="${testId}"]`;
                    const ariaLabel = element.getAttribute('aria-label');
                    if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
                    const text = normalizeText(element.textContent).slice(0, 80);
                    if (text && (element.tagName?.toLowerCase() === 'button' || element.getAttribute('role') === 'button')) {
                        return `button:has-text("${escapeText(text)}")`;
                    }
                    if (element.getAttribute('role')) return `[role="${element.getAttribute('role')}"]`;
                    if (element.classList?.length) return `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join('.')}`;
                    return element.tagName.toLowerCase();
                };
                const findBlockingRoot = (element, targetElement) => {
                    let current = element;
                    while (current && current !== document.body) {
                        if (targetElement && (current === targetElement || current.contains(targetElement))) {
                            return null;
                        }
                        if (isExcludedChrome(current)) {
                            // The element on top is map/canvas page chrome, not a real overlay —
                            // let Playwright's native actionability handle it instead of blocking.
                            return null;
                        }
                        // Interactive controls are never modal blockers — a plain button/link/
                        // input (e.g. "View Public Record Data") sitting over the click point is
                        // handled by Playwright's native actionability, not flagged as an overlay.
                        if (current.matches?.('button,a,input,select,textarea,label') &&
                            !current.matches?.('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) {
                            return null;
                        }
                        const style = window.getComputedStyle(current);
                        const rect = current.getBoundingClientRect();
                        const zIndex = Number.parseInt(style.zIndex || '0', 10) || 0;
                        const area = rect.width * rect.height;
                        const coverage = area / Math.max(window.innerWidth * window.innerHeight, 1);
                        const isDialogLike = current.matches?.('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
                        const positioned = ['fixed', 'sticky', 'absolute'].includes(style.position);
                        // A positioned occluder blocks only when it is a real dialog OR a large
                        // overlay (covers a meaningful share of the viewport) — not any small
                        // positioned element that merely overlaps the click point.
                        const significantOverlay = (positioned || zIndex >= 5) && coverage >= 0.2;
                        if ((isDialogLike || significantOverlay) && area > 0 && style.pointerEvents !== 'none') {
                            return current;
                        }
                        current = current.parentElement;
                    }
                    return null;
                };

                const isVisible = (element) => {
                    if (!element) return false;
                    const style = window.getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };

                const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
                const candidates = new Set();
                document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="dialog"],[class*="overlay"],[class*="popup"],[class*="alert"],[class*="notice"],[class*="toast"],[id*="modal" i],[id*="popup" i],[id*="dialog" i]').forEach((element) => {
                    if (!isExcludedChrome(element)) candidates.add(element);
                });
                Array.from(document.body?.children || []).forEach((element) => {
                    if (isExcludedChrome(element)) return;
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const coverage = (rect.width * rect.height) / viewportArea;
                    const zIndex = Number.parseInt(style.zIndex || '0', 10) || 0;
                    const isOverlayPosition = style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute';
                    const interceptsPointerEvents = style.pointerEvents !== 'none';
                    // A large positioned element is only treated as a blocker when it carries a real
                    // modal signal (dialog / aria-modal) or locks body scroll. Untagged full-bleed
                    // layout chrome (maps, hero sections, sticky shells) must NOT be flagged.
                    const looksModal = hasModalSignal(element) || isBodyScrollLocked();
                    if (isOverlayPosition && interceptsPointerEvents && coverage > 0.15 && zIndex >= 5 && looksModal) {
                        candidates.add(element);
                    }
                });

                const targetElement = safeQuerySelector(targetSelector);
                if (targetElement && isVisible(targetElement)) {
                    const rect = targetElement.getBoundingClientRect();
                    const points = [
                        { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) },
                        { x: rect.left + Math.min(Math.max(rect.width - 2, 0), 6), y: rect.top + Math.min(Math.max(rect.height - 2, 0), 6) },
                        { x: rect.right - Math.min(Math.max(rect.width - 2, 0), 6), y: rect.bottom - Math.min(Math.max(rect.height - 2, 0), 6) },
                    ].filter((point) => point.x >= 0 && point.y >= 0 && point.x <= window.innerWidth && point.y <= window.innerHeight);

                    let blockedPoints = 0;
                    let blockingRoot = null;
                    for (const point of points) {
                        const hit = document.elementFromPoint(point.x, point.y);
                        if (!hit || hit === targetElement || targetElement.contains(hit)) {
                            continue;
                        }
                        const root = findBlockingRoot(hit, targetElement);
                        if (root) {
                            blockedPoints += 1;
                            blockingRoot = root;
                        }
                    }

                    if (blockingRoot && blockedPoints > 0) {
                        blockingRoot.__mcpOcclusion = {
                            targetSelector,
                            pointsBlocked: blockedPoints,
                            hitSelector: toSelectorHint(blockingRoot),
                        };
                        candidates.add(blockingRoot);
                    }
                }

                const isRealBlocker = (element) => {
                    // A genuine blocker is a dialog, a real occluder of the target, or a large
                    // positioned overlay (optionally with body-scroll lock / modal markup).
                    // Interactive controls (button/link/input) are explicitly NOT blockers, so a
                    // plain button matching [class*="notice"] etc. cannot be a false positive.
                    if (element.matches?.('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) return true;
                    if (element.matches?.('button,a,input,select,textarea,label')) return false;
                    if (element.__mcpOcclusion?.pointsBlocked > 0) return true;
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const coverage = (rect.width * rect.height) / viewportArea;
                    const positioned = ['fixed', 'sticky', 'absolute'].includes(style.position);
                    return positioned && coverage >= 0.2 && (isBodyScrollLocked() || hasModalSignal(element));
                };

                const ranked = Array.from(candidates)
                    .filter((element) => isVisible(element) && !isExcludedChrome(element) && isRealBlocker(element))
                    .map((element) => {
                        const rect = element.getBoundingClientRect();
                        const style = window.getComputedStyle(element);
                        const coverage = (rect.width * rect.height) / viewportArea;
                        const zIndex = Number.parseInt(style.zIndex || '0', 10) || 0;
                        const focusableCount = element.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])').length;
                        const activeElement = document.activeElement;
                        const focusTrap = !!activeElement && element.contains(activeElement) && focusableCount >= 2;
                        const bodyOverflowLocked = ['hidden', 'clip'].includes(window.getComputedStyle(document.body).overflow) ||
                            ['hidden', 'clip'].includes(window.getComputedStyle(document.documentElement).overflow);
                        const occlusion = element.__mcpOcclusion || null;
                        const dismissControls = Array.from(element.querySelectorAll('button,[role="button"],[aria-label*="close" i],[aria-label*="ok" i],[aria-label*="dismiss" i],[aria-label*="skip" i],[aria-label*="continue" i]'))
                            .slice(0, 5)
                            .map((control) => ({
                                text: normalizeText(control.textContent).slice(0, 80),
                                ariaLabel: control.getAttribute('aria-label') || null,
                                selectorHint: toSelectorHint(control),
                            }));

                        const isDialogLike = element.matches?.('dialog,[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="dialog"],[class*="popup"],[class*="alert"],[class*="notice"]');
                        const kind = occlusion?.pointsBlocked > 0
                            ? 'dom-occlusion'
                            : isDialogLike
                                ? 'dom-modal'
                                : 'dom-overlay';
                        const stableId = `${kind}-${toStableId(`${toSelectorHint(element) || ''}-${element.getAttribute('role') || ''}-${element.getAttribute('aria-label') || ''}-${normalizeText(element.textContent).slice(0, 80)}`)}`;

                        return {
                            score: (coverage * 1000) + zIndex + (occlusion?.pointsBlocked ? 2000 : 0) + (focusTrap ? 120 : 0) + (bodyOverflowLocked ? 40 : 0),
                            blocker: {
                                id: stableId,
                                kind,
                                blocking: true,
                                role: element.getAttribute('role') || null,
                                ariaLabel: element.getAttribute('aria-label') || null,
                                selectorHint: toSelectorHint(element),
                                text: normalizeText(element.textContent).slice(0, 200),
                                zIndex,
                                bounds: {
                                    x: rect.x,
                                    y: rect.y,
                                    width: rect.width,
                                    height: rect.height,
                                },
                                dismissControls,
                                focusTrap,
                                bodyOverflowLocked,
                                occlusion,
                                timestamp: Date.now(),
                            },
                        };
                    })
                    .sort((left, right) => right.score - left.score);

                return ranked[0]?.blocker || null;
            }, { targetSelector: options.targetSelector || null });
        } catch (error) {
            console.error(`[PlaywrightDirect] DOM blocker detection failed: ${error.message}`);
            return null;
        }
    }

    async _resolveDialog(entry, handler) {
        const dialog = entry?.dialogHandle;
        if (!dialog) {
            throw new Error('No active dialog available to resolve');
        }

        if (handler.accept) {
            await dialog.accept(handler.promptText || '');
        } else {
            await dialog.dismiss();
        }

        entry.handled = true;
        entry.handledAt = Date.now();
        entry.action = handler.accept ? 'accepted' : 'dismissed';
        entry.promptText = handler.promptText || null;
        entry.dialogHandle = null;

        if (this._activeDialog?.id === entry.id) {
            this._activeDialog = null;
        }

        this.emit('dialog-handled', this._serializeBlocker(entry));

        return {
            success: true,
            action: entry.action,
            blocker: this._serializeBlocker(entry),
        };
    }

    async getBlockingState(options = {}) {
        const includeDom = options.includeDom !== false;

        const activeDialog = this._activeDialog && this._activeDialog.handled !== true
            ? this._serializeBlocker(this._activeDialog)
            : null;

        if (activeDialog) {
            return {
                present: true,
                blocker: activeDialog,
                blockers: [activeDialog],
            };
        }

        const domModal = includeDom ? await this._detectDomModalBlocker(options) : null;
        const serializedDomModal = domModal ? this._serializeBlocker(domModal) : null;
        return {
            present: !!serializedDomModal,
            blocker: serializedDomModal,
            blockers: serializedDomModal ? [serializedDomModal] : [],
        };
    }

    _getPopupHandlerClass() {
        if (this._popupHandlerClass !== undefined) {
            return this._popupHandlerClass;
        }

        try {
            const popupModule = require('../../../tests/utils/popupHandler.js');
            this._popupHandlerClass = popupModule?.PopupHandler || null;
        } catch (error) {
            console.error(`[PlaywrightDirect] PopupHandler unavailable: ${error.message}`);
            this._popupHandlerClass = null;
        }

        return this._popupHandlerClass;
    }

    async dismissKnownPopups() {
        if (!this.config.autoDismissKnownPopups) {
            return { success: false, skipped: true, reason: 'autoDismissKnownPopups disabled' };
        }

        const PopupHandler = this._getPopupHandlerClass();
        if (!PopupHandler) {
            return { success: false, skipped: true, reason: 'PopupHandler unavailable' };
        }

        try {
            const popupHandler = new PopupHandler(this.page);
            await popupHandler.dismissAll();
            const remaining = await this.getBlockingState();
            return {
                success: !remaining.present,
                dismissed: true,
                remainingBlocker: remaining.blocker || null,
            };
        } catch (error) {
            return {
                success: false,
                dismissed: false,
                error: error.message,
            };
        }
    }

    async _guardInteraction(action, target, options = {}) {
        const guardOptions = {
            ...options,
            targetSelector: typeof target === 'string' ? target : options.targetSelector,
        };

        let blockerState = await this.getBlockingState(guardOptions);
        if (blockerState.present && blockerState.blocker?.kind?.startsWith('dom-') && options.tryAutoDismiss !== false) {
            const recovery = await this._attemptBlockerRecovery(action, target, blockerState.blocker, guardOptions);
            blockerState = await this.getBlockingState(guardOptions);
            if (!blockerState.present) {
                return null;
            }

            return this._buildBlockedResult(action, blockerState.blocker, {
                target,
                attemptedRecovery: recovery,
            });
        }

        if (!blockerState.present) {
            return null;
        }

        return this._buildBlockedResult(action, blockerState.blocker, { target });
    }

    async _capturePostActionBlocker(action, target, waitMs = this.config.blockerRecovery?.postActionObservationMs || 750) {
        const pollIntervalMs = this.config.blockerRecovery?.pollIntervalMs || 50;

        // ── Event-driven path (P2) ──────────────────────────────────────────
        // With the resident agent + reactive core active, replace the poll loop with: ONE
        // immediate check (catches synchronous / already-present modals fast), then — only if
        // nothing is there yet — await a PUSHED blocker signal or DOM quiescence. No continuous
        // polling: the common no-blocker path costs a single getBlockingState instead of
        // ~waitMs/pollIntervalMs DOM round-trips.
        if (this._reactiveCore && this._residentAgentEnabled) {
            const targetSel = typeof target === 'string' ? target : null;
            let blockerState = await this.getBlockingState({ targetSelector: targetSel });
            if (!blockerState.present) {
                const observed = await this._reactiveCore.observePostAction({
                    maxMs: waitMs,
                    quietMs: Math.max(60, pollIntervalMs * 2),
                });
                const blockerLikely = observed.blocker || (this._activeDialog && this._activeDialog.handled !== true);
                if (!blockerLikely) return null;
                blockerState = await this.getBlockingState({ targetSelector: targetSel });
                if (!blockerState.present) return null;
            }
            const recovery = await this._attemptBlockerRecovery(action, target, blockerState.blocker, { includeDom: true });
            const remaining = await this.getBlockingState();
            if (!remaining.present) return null;
            return this._buildBlockedResult(action, remaining.blocker, {
                target,
                actionPerformed: true,
                attemptedRecovery: recovery,
            });
        }

        // ── Legacy poll path (resident agent off) ───────────────────────────
        const deadline = Date.now() + waitMs;
        // Event-driven early exit: once the DOM has been quiet for a couple of
        // polls and no blocker is present, nothing more is going to pop up — so
        // return immediately instead of burning the full observation window.
        // While the DOM keeps mutating (async modal still rendering), keep
        // watching up to the cap so late popups are still caught & dismissed.
        const STABLE_POLLS = 2;
        let lastSeq = await this._readDomSeqQuick();
        let stablePolls = 0;
        while (Date.now() <= deadline) {
            const blockerState = await this.getBlockingState({ targetSelector: typeof target === 'string' ? target : null });
            if (blockerState.present) {
                const recovery = await this._attemptBlockerRecovery(action, target, blockerState.blocker, { includeDom: true });
                const remaining = await this.getBlockingState();
                if (!remaining.present) {
                    return null;
                }

                return this._buildBlockedResult(action, remaining.blocker, {
                    target,
                    actionPerformed: true,
                    attemptedRecovery: recovery,
                });
            }

            const seq = await this._readDomSeqQuick();
            if (seq === lastSeq) {
                if (++stablePolls >= STABLE_POLLS) return null; // settled — nothing popped up
            } else {
                stablePolls = 0;
                lastSeq = seq;
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return null;
    }

    /**
     * Call a tool by name
     * Note: Enhanced methods are injected by applyEnhancedMethods() and override this
     */
    async callTool(toolName, args = {}) {
        await this.ensureConnected();

        console.error(`[PlaywrightDirect] Calling tool: ${toolName}`);

        // Map tool names to methods
        const toolMap = {
            'browser_navigate': () => this.navigate(args),
            'browser_navigate_back': () => this.navigateBack(),
            'browser_snapshot': () => this.snapshot(args),
            'browser_click': () => this.click(args),
            'browser_type': () => this.type(args),
            'browser_hover': () => this.hover(args),
            'browser_drag': () => this.drag(args),
            'browser_select_option': () => this.selectOption(args),
            'browser_fill_form': () => this.fillForm(args),
            'browser_wait_for': () => this.waitFor(args),
            'browser_wait_for_load_state': () => this.waitForLoadState(args),
            'browser_wait_for_navigation': () => this.waitForNavigation(args),
            'browser_tabs': () => this.manageTabs(args),
            'browser_create_tab': () => this.createTab(args),
            'browser_evaluate': () => this.evaluate(args),
            'browser_run_code': () => this.runCode(args),
            'browser_console_messages': () => this.getConsoleMessages(args),
            'browser_network_requests': () => this.getNetworkRequests(args),
            'browser_page_errors': () => this.getPageErrors(args),
            'browser_install': () => this.install(),
            'browser_press_key': () => this.pressKey(args),
            'browser_screenshot': () => this.screenshot(args),
            'browser_take_screenshot': () => this.screenshot(args),  // Alias for unified_screenshot mapping
            'browser_close': () => this.close(),
            'browser_file_upload': () => this.fileUpload(args),
            'browser_handle_dialog': () => this.handleDialog(args),
            'browser_resize': () => this.resize(args),
            'browser_generate_locator': () => this.generateLocator(args),
            'browser_verify_element_visible': () => this.verifyElementVisible(args),
            'browser_verify_text_visible': () => this.verifyTextVisible(args),
            'browser_verify_value': () => this.verifyValue(args),
            'browser_pdf_save': () => this.savePdf(args),
            'browser_mouse_click_xy': () => this.mouseClickXY(args),
            'browser_mouse_move_xy': () => this.mouseMoveXY(args),
            'browser_mouse_drag_xy': () => this.mouseDragXY(args),
            'browser_mouse_wheel': () => this.mouseWheel(args),

            // ── Advanced: Iframe ──
            'browser_list_frames': () => this.listFrames(),
            'browser_switch_to_frame': () => this.switchToFrame(args),
            'browser_switch_to_main_frame': () => this.switchToMainFrame(),
            'browser_frame_action': () => this.frameAction(args),

            // ── Advanced: Shadow DOM ──
            'browser_shadow_dom_query': () => this.shadowDomQuery(args),
            'browser_shadow_pierce': () => this.shadowPierce(args),

            // ── Advanced: Network Interception ──
            'browser_route_intercept': () => this.routeIntercept(args),
            'browser_route_remove': () => this.routeRemove(args),
            'browser_route_list': () => this.routeList(),
            'browser_wait_for_request': () => this.waitForRequest(args),
            'browser_wait_for_response': () => this.waitForResponse(args),

            // ── Advanced: Storage ──
            'browser_get_local_storage': () => this.getLocalStorage(args),
            'browser_set_local_storage': () => this.setLocalStorage(args),
            'browser_remove_local_storage': () => this.removeLocalStorage(args),
            'browser_get_session_storage': () => this.getSessionStorage(args),
            'browser_set_session_storage': () => this.setSessionStorage(args),
            'browser_remove_session_storage': () => this.removeSessionStorage(args),
            'browser_query_indexeddb': () => this.queryIndexedDB(args),

            // ── Advanced: Multi-Context ──
            'browser_create_context': () => this.createContext(args),
            'browser_switch_context': () => this.switchContext(args),
            'browser_list_contexts': () => this.listContexts(),
            'browser_close_context': () => this.closeContext(args),

            // ── Advanced: Visual Testing ──
            'browser_screenshot_baseline': () => this.screenshotBaseline(args),
            'browser_screenshot_compare': () => this.screenshotCompare(args),
            'browser_collect_virtualized_list': () => this.collectVirtualizedList(args),
            'browser_snapshot_diff': () => this.snapshotDiff(args),

            // ── Advanced: Video Recording ──
            'browser_start_video': () => this.startVideoRecording(args),
            'browser_stop_video': () => this.stopVideoRecording(),

            // ── Advanced: Auth Persistence ──
            'browser_save_auth_state': () => this.saveAuthState(args),
            'browser_load_auth_state': () => this.loadAuthState(args),

            // ── Advanced: Accessibility ──
            'browser_accessibility_audit': () => this.accessibilityAudit(args),

            // ── Advanced: Geolocation & Permissions ──
            'browser_set_geolocation': () => this.setGeolocation(args),
            'browser_grant_permissions': () => this.grantPermissions(args),
            'browser_clear_permissions': () => this.clearPermissions(),
            'browser_set_timezone': () => this.setTimezone(args),
            'browser_set_locale': () => this.setLocale(args),

            // ── Advanced: Downloads ──
            'browser_list_downloads': () => this.listDownloads(),
            'browser_trigger_download': () => this.triggerDownload(args),

            // ── Advanced: DOM Mutations ──
            'browser_observe_mutations': () => this.observeMutations(args),
            'browser_get_mutations': () => this.getMutations(args),
            'browser_stop_mutation_observer': () => this.stopMutationObserver(),
        };

        const handler = toolMap[toolName];
        if (!handler) {
            throw new Error(`Unknown Playwright tool: ${toolName}`);
        }

        return await handler();
    }

    /**
     * Navigate to URL
     */
    async navigate(args) {
        const { url, waitUntil = 'load' } = args;
        console.error(`[PlaywrightDirect] Navigating to: ${url}`);

        await this.page.goto(url, { waitUntil });
        this._invalidateSnapshotCache();
        // P6: record the arrival state + the transition that brought us here (when enabled).
        if (this._graphRecorder) { try { await this._graphRecorder.recordCurrent({ snapshot: true }); } catch (e) { /* non-fatal */ } }
        return { success: true, url: this.page.url(), title: await this.page.title() };
    }

    /**
     * Navigate back
     */
    async navigateBack() {
        await this.page.goBack();
        this._invalidateSnapshotCache();
        return { success: true, url: this.page.url() };
    }

    /**
     * Install the resident perception agent (P1 Digital Twin) on the context: expose the duplex
     * __cbrPush binding (page → perception store + reactive-core events) and inject the agent
     * source so the page maintains a live element model and streams structural deltas. Idempotent.
     */
    async _installResidentAgent() {
        if (!this._residentBindingExposed) {
            try {
                await this.context.exposeBinding('__cbrPush', (source, payload) => {
                    try { this._perceptionStore.applyPush(source?.page, payload); } catch (e) { /* isolated */ }
                    if (payload && payload.type === 'perception-delta') {
                        this.emit('perception-delta', { ...payload });
                    } else if (payload && payload.type === 'ready') {
                        this.emit('perception-ready', { ...payload });
                    } else if (payload && payload.type === 'blocker') {
                        // In-page modal/overlay detection — pushed the instant it changes.
                        this.emit('blocker', { ...payload });
                    }
                });
                this._residentBindingExposed = true;
            } catch (e) {
                console.error('[PlaywrightDirect] exposeBinding(__cbrPush) failed:', e.message);
            }
        }
        try {
            await this.context.addInitScript(getResidentAgentSource());
            console.error('[PlaywrightDirect] Resident perception agent installed (Digital Twin v' + RESIDENT_AGENT_VERSION + ')');
        } catch (e) {
            console.error('[PlaywrightDirect] resident agent injection failed:', e.message);
        }
    }

    /**
     * Lazily build the transport router (P3). Pairs a Playwright transport with a raw-CDP
     * transport (Chromium) and prefers raw-CDP for hot ops, falling back transparently. Returns
     * null when the raw-CDP fast path is disabled.
     */
    _getTransport() {
        if (!this._rawCdpEnabled) return null;
        if (!this._transport) {
            const getPage = () => this.page;
            this._transport = new TransportRouter(
                {
                    playwright: new PlaywrightTransport(getPage),
                    rawCdp: new RawCdpTransport(getPage, { browser: this.config.browser }),
                },
                { preferRaw: true },
            );
        }
        return this._transport;
    }

    /**
     * Fast click of a snapshot ref via the raw-CDP transport: clicks the element's center using
     * the Digital Twin's bounds (no actionability round-trip). Falls back to the normal click()
     * when the transport/bounds are unavailable. Returns { success, via, ref }.
     */
    async fastClickRef(ref) {
        const transport = this._getTransport();
        const el = this.snapshotRefs.get(ref);
        const b = el?.bounds;
        if (!transport || !b || b.width <= 0 || b.height <= 0) {
            const fallback = await this.click({ ref });
            return { success: fallback?.success !== false, via: 'playwright-click', ref };
        }
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        await transport.clickAt(x, y);
        return { success: true, via: 'transport', ref, point: { x: Math.round(x), y: Math.round(y) } };
    }

    /**
     * Take accessibility snapshot with optional server-side filtering
     * (Anthropic Technique 2: Dynamic Filtering)
     */
    async snapshot(args = {}) {
        const {
            verbose = false,
            includeAria = false,
            filter,
            autoFilter = true,
            useCache = true,
            vision = false,
        } = args;

        // Ensure page is available and ready
        if (!this.page) {
            throw new Error('No page available. Please navigate to a URL first.');
        }

        // ── Cache check (Pillar 1: near-free repeated snapshots) ─────────────
        // A cheap DOM-version read decides whether anything changed since the
        // last snapshot. If not, return the cached payload without re-walking
        // the DOM or re-validating selectors.
        const domVersion = await this._readDomVersion();
        const filterKey = JSON.stringify(filter || (autoFilter ? 'auto' : null));
        const visionKey = (vision && this._visionFusion) ? '|vision=1' : '';
        const cacheKey = `${domVersion.url}|seq=${domVersion.seq}|n=${domVersion.count}|v=${verbose}|a=${includeAria}|f=${filterKey}${visionKey}`;
        if (useCache && this._snapshotCache && this._snapshotCache.key === cacheKey) {
            return { ...this._snapshotCache.payload, _cache: { hit: true, domVersion: domVersion.seq } };
        }

        console.error('[PlaywrightDirect] Taking accessibility snapshot...');

        // ARIA tree only when explicitly requested. It is an expensive full-tree
        // serialization that duplicates the enriched DOM walk, so it is excluded
        // from the default (compact) path to cut latency and tokens.
        let ariaTree = null;
        if (verbose || includeAria) {
            try {
                ariaTree = await this.page.locator('body').ariaSnapshot({ timeout: 10000 });
            } catch (ariaError) {
                console.error('[PlaywrightDirect] ARIA snapshot failed:', ariaError.message);
            }
        }

        // Element fingerprints. With the resident agent active, read the live maintained model
        // (incremental — no full re-walk); otherwise run the enriched DOM walker. Always falls
        // back to the walker on any miss.
        let elements = null;
        if (this._residentAgentEnabled) {
            try {
                const perceived = await this.page.evaluate(
                    () => (window.__cbr ? window.__cbr.perceive({ refreshLayout: true }) : null)
                );
                if (perceived && Array.isArray(perceived.elements) && perceived.elements.length) {
                    elements = perceived.elements;
                }
            } catch (e) {
                console.error('[PlaywrightDirect] resident perceive failed, falling back to walker:', e.message);
            }
        }
        if (!elements) {
            elements = await this.page.evaluate(SelectorEngine.getEnrichedDomWalkerSource());
        }

        // Uniqueness validation — count how many DOM nodes each candidate matches.
        let matchCounts = {};
        try {
            matchCounts = await this.page.evaluate(SelectorEngine.getUniquenessValidationScript(elements));
        } catch (valError) {
            console.error('[PlaywrightDirect] Uniqueness validation failed (non-fatal):', valError.message);
        }

        // Score & rank selectors per element.
        const fullElements = SelectorEngine.processSnapshotElements(elements, matchCounts);

        // Store the FULL (pre-filter) set so any ref resolves for later
        // interactions, even when filtered out of the agent-facing view.
        this.snapshotRefs.clear();
        for (const el of fullElements) {
            this.snapshotRefs.set(el.ref, el);
        }

        // ── Vision+DOM+AX fusion (P5) ─────────────────────────────────────────
        // Fill names for DOM-blind elements (icon-only buttons, canvas) before filtering so the
        // fused names participate. Budget-capped; only when requested (vision:true) AND enabled.
        let visionResult = null;
        if (vision && this._visionFusion) {
            try {
                visionResult = await this._visionFusion.fuse(fullElements);
            } catch (e) {
                console.error('[PlaywrightDirect] vision fusion failed (non-fatal):', e.message);
            }
        }

        // ── Filtering: explicit when provided, automatic when the page is large ─
        const preFilterCount = fullElements.length;
        let viewElements = fullElements;
        const explicitFilter = filter && Object.keys(filter).length > 0;
        let appliedFilter = explicitFilter ? filter : (autoFilter ? this._computeAutoFilter(preFilterCount) : null);
        if (appliedFilter) {
            viewElements = this._applySnapshotFilters(fullElements, appliedFilter);
            console.error(`[PlaywrightDirect] Filtering: ${preFilterCount} → ${viewElements.length} elements`);
        }

        const blockerState = await this.getBlockingState();
        const payload = {
            url: this.page.url(),
            title: await this.page.title(),
            blockerState,
            elementCount: viewElements.length,
            elements: verbose ? viewElements : this._toCompactElements(viewElements),
            _filtering: appliedFilter
                ? { applied: true, before: preFilterCount, after: viewElements.length, auto: !explicitFilter }
                : { applied: false, total: preFilterCount },
        };
        if (visionResult) payload._vision = { provider: visionResult.provider, fused: visionResult.fusedCount, ambiguous: visionResult.ambiguousCount };
        if (verbose || includeAria) payload.ariaTree = ariaTree;
        if (verbose) payload.verbose = true;

        this._snapshotCache = { key: cacheKey, payload };
        return { ...payload, _cache: { hit: false, domVersion: domVersion.seq } };
    }

    /**
     * Read a cheap DOM-version signature used as the snapshot cache key.
     * `seq` is bumped by a MutationObserver installed at context creation, so it
     * reflects any DOM change since the last read. Falls back to element count.
     */
    async _readDomVersion() {
        try {
            return await this.page.evaluate(() => ({
                seq: (typeof window.__mcpDomSeq === 'number') ? window.__mcpDomSeq : null,
                count: document.getElementsByTagName('*').length,
                url: location.href,
            }));
        } catch {
            return { seq: null, count: -1, url: this.page ? this.page.url() : '' };
        }
    }

    /** Invalidate the cached snapshot payload (called on navigation). */
    _invalidateSnapshotCache() {
        this._snapshotCache = null;
    }

    /** Lean read of just the DOM mutation counter, for hot poll loops. */
    async _readDomSeqQuick() {
        try {
            return await this.page.evaluate(() => (typeof window.__mcpDomSeq === 'number' ? window.__mcpDomSeq : -1));
        } catch {
            return -1;
        }
    }

    /**
     * Decide an automatic filter when the element set is large enough that
     * returning everything would bloat the agent context.
     */
    _computeAutoFilter(count) {
        const threshold = this.config.snapshotAutoFilterThreshold ?? 60;
        if (count <= threshold) return null;
        return {
            interactiveOnly: true,
            visibleOnly: true,
            maxElements: this.config.snapshotMaxElements ?? 150,
        };
    }

    /**
     * Project full enriched elements down to a compact, token-lean shape.
     * Keeps only what an agent needs to reason and act: ref, role, name,
     * winning selector, and a few interaction hints. Full fingerprints remain
     * available via snapshotRefs (for interactions) and verbose mode.
     */
    _toCompactElements(elements) {
        return elements.map((el) => {
            const name = el.computedLabel || el.ariaLabel || el.associatedLabel || el.text || el.name || el.placeholder;
            // Prefer a semantic ARIA role (e.g. input → textbox, a → link) over the raw tag.
            const role = el.role || SelectorEngine.mapAriaRole(el.role, el.tag) || el.tag;
            const out = { ref: el.ref, role };
            if (el.tag && role !== el.tag) out.tag = el.tag;
            if (name) out.name = String(name).substring(0, 120);
            // Playwright locator the agent should use (e.g. getByRole/getByTestId);
            // the bridge resolves refs to CSS independently for interactions.
            if (el.selector?.primary) out.selector = el.selector.primary;
            if (el.selector && el.selector.isUnique === false) out.ambiguous = true;
            if (el.inputType) out.inputType = el.inputType;
            if (el.isInteractive) out.interactive = true;
            if (el.visible === false) out.visible = false;
            // Vision-fused name (P5): transparent provenance — the caller sees the name came
            // from visual perception, not the DOM (QA-integrity).
            if (el.fusedName) { out.visualSource = el.visualSource; out.visualConfidence = el.visualConfidence; }
            return out;
        });
    }

    /**
     * Apply snapshot filters to enriched elements.
     * Filters are applied sequentially — each narrows the set further.
     *
     * @param {Array} elements - Enriched element array from SelectorEngine
     * @param {Object} filter - Filter options from tool input
     * @returns {Array} Filtered elements
     */
    _applySnapshotFilters(elements, filter) {
        const {
            roles,
            interactiveOnly,
            visibleOnly,
            excludeRoles,
            namePattern,
            maxElements,
        } = filter;

        // Interactive ARIA roles for the interactiveOnly filter
        const INTERACTIVE_ROLES = new Set([
            'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox',
            'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
            'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
            'treeitem', 'gridcell', 'columnheader', 'rowheader',
            'input', 'select', 'textarea', 'a',
        ]);

        // Default exclude roles (decorative/structural)
        const DEFAULT_EXCLUDE = new Set(['generic', 'presentation', 'separator', 'none']);
        const excludeSet = excludeRoles
            ? new Set(excludeRoles.map(r => r.toLowerCase()))
            : null;

        let nameRegex = null;
        if (namePattern) {
            try {
                // CWE-1333 fix: escape user input to prevent ReDoS
                const escaped = namePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                nameRegex = new RegExp(escaped, 'i');
            } catch {
                console.error(`[PlaywrightDirect] Invalid namePattern regex: ${namePattern}`);
            }
        }

        let filtered = elements.filter(el => {
            const role = (el.role || el.ariaRole || '').toLowerCase();
            const tag = (el.tag || el.tagName || '').toLowerCase();

            // Filter by specific roles
            if (roles && roles.length > 0) {
                const roleSet = new Set(roles.map(r => r.toLowerCase()));
                if (!roleSet.has(role) && !roleSet.has(tag)) {
                    return false;
                }
            }

            // Filter to interactive elements only
            if (interactiveOnly) {
                if (!INTERACTIVE_ROLES.has(role) && !INTERACTIVE_ROLES.has(tag)) {
                    // Also check for contenteditable or common interactive tags
                    const isEditable = el.contentEditable === 'true' || el.isContentEditable;
                    if (!isEditable) return false;
                }
            }

            // Exclude specific roles
            if (excludeSet) {
                if (excludeSet.has(role)) return false;
            } else if (DEFAULT_EXCLUDE.has(role)) {
                // Apply default exclusions when no custom excludeRoles specified
                // AND at least one other filter is active (don't exclude by default alone)
                if (roles || interactiveOnly || visibleOnly) {
                    return false;
                }
            }

            // Visible only
            if (visibleOnly) {
                if (el.ariaHidden === 'true' || el.hidden === true) {
                    return false;
                }
            }

            // Name pattern matching
            if (nameRegex) {
                const name = el.name || el.ariaLabel || el.text || el.innerText || '';
                if (!nameRegex.test(name)) {
                    return false;
                }
            }

            return true;
        });

        // Apply max elements limit
        if (maxElements && maxElements > 0 && filtered.length > maxElements) {
            filtered = filtered.slice(0, maxElements);
        }

        return filtered;
    }

    /**
     * Click element
     */
    async click(args) {
        const {
            element,
            ref,
            description,
            button = 'left',
            doubleClick = false,
            modifiers = [],
            force = false,
        } = args;

        let selector;
        if (ref) {
            // Use SelectorEngine for consistent, ranked selector resolution
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else if (element) {
            selector = element;
        } else if (description) {
            selector = `text=${description}`;
        }

        if (!selector) {
            throw new Error('click requires one of: ref, element, or description');
        }

        console.error(`[PlaywrightDirect] Clicking: ${selector}`);
        // force:true bypasses the custom overlay/blocker guard and relies on Playwright's
        // native actionability (auto-scroll + trusted event). Use when a click is falsely
        // blocked by page chrome such as a map/canvas.
        const blocked = force ? null : await this._guardInteraction('click', selector, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        const clickOptions = {
            button,
            modifiers,
            clickCount: doubleClick ? 2 : 1,
        };

        await this.page.click(selector, clickOptions);
        const postActionBlocker = await this._capturePostActionBlocker('click', selector);
        if (postActionBlocker) {
            return {
                success: true,
                clicked: selector,
                button,
                doubleClick,
                blockerDetected: postActionBlocker.blocker,
                requiresRecovery: true,
            };
        }

        return { success: true, clicked: selector, button, doubleClick };
    }

    /**
     * Type text
     */
    async type(args) {
        const {
            element,
            ref,
            text,
            clear = false,
            slowly = false,
            submit = false,
            force = false,
        } = args;

        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        if (!selector) {
            throw new Error('type requires one of: ref or element');
        }

        if (typeof text !== 'string') {
            throw new Error('type requires text as a string');
        }

        console.error(`[PlaywrightDirect] Typing into: ${selector}`);

        const blocked = force ? null : await this._guardInteraction('type', selector, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        if (clear) {
            await this.page.fill(selector, '');
        }

        // Use locator.pressSequentially (modern, fires trusted key events that framework
        // inputs such as Angular/React forms listen for) instead of the deprecated page.type.
        const locator = this.page.locator(selector);
        if (slowly) {
            if (typeof locator.pressSequentially === 'function') {
                await locator.pressSequentially(text, { delay: 100 });
            } else {
                await locator.type(text, { delay: 100 });
            }
        } else if (typeof locator.pressSequentially === 'function') {
            await locator.pressSequentially(text);
        } else {
            await locator.type(text);
        }

        if (submit) {
            await this.page.press(selector, 'Enter');
        }

        const postActionBlocker = await this._capturePostActionBlocker('type', selector);
        if (postActionBlocker) {
            return {
                success: true,
                typed: text,
                into: selector,
                slowly,
                submitted: submit,
                blockerDetected: postActionBlocker.blocker,
                requiresRecovery: true,
            };
        }

        return { success: true, typed: text, into: selector, slowly, submitted: submit };
    }

    /**
     * Hover over element
     */
    async hover(args) {
        const { element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        const blocked = await this._guardInteraction('hover', selector, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        await this.page.hover(selector);
        const postActionBlocker = await this._capturePostActionBlocker('hover', selector);
        if (postActionBlocker) {
            return {
                success: true,
                hovered: selector,
                blockerDetected: postActionBlocker.blocker,
                requiresRecovery: true,
            };
        }

        return { success: true, hovered: selector };
    }

    /**
     * Drag element
     */
    async drag(args) {
        const source = args.source ?? args.startElement;
        const target = args.target ?? args.endElement;
        const sourceRef = args.sourceRef ?? args.startRef;
        const targetRef = args.targetRef ?? args.endRef;
        let sourceSelector = source;
        let targetSelector = target;

        if (sourceRef) {
            const refData = this.snapshotRefs.get(sourceRef);
            if (refData) sourceSelector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Source ref "${sourceRef}" not found in snapshot.`);
        }
        if (targetRef) {
            const refData = this.snapshotRefs.get(targetRef);
            if (refData) targetSelector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Target ref "${targetRef}" not found in snapshot.`);
        }

        if (!sourceSelector || !targetSelector) {
            throw new Error('Drag requires source/sourceRef and target/targetRef (legacy aliases start*/end* are also supported).');
        }

        await this.page.dragAndDrop(sourceSelector, targetSelector);
        return { success: true, from: sourceSelector, to: targetSelector };
    }

    /**
     * Select option
     */
    async selectOption(args) {
        const { element, ref, value, values, label } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) selector = SelectorEngine.resolveCssSelector(refData);
            else throw new Error(`Element ref "${ref}" not found in snapshot.`);
        } else {
            selector = element;
        }

        if (!selector) {
            throw new Error('select_option requires ref or element selector.');
        }

        let options;
        if (label) {
            options = { label };
        } else if (Array.isArray(values) && values.length > 0) {
            options = values;
        } else if (typeof value === 'string' && value.length > 0) {
            options = { value };
        } else {
            throw new Error('select_option requires label, value, or values[] to choose an option.');
        }

        const blocked = await this._guardInteraction('select_option', selector, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        await this.page.selectOption(selector, options);
        const postActionBlocker = await this._capturePostActionBlocker('select_option', selector);
        if (postActionBlocker) {
            return {
                success: true,
                selected: label || value || values,
                selector,
                blockerDetected: postActionBlocker.blocker,
                requiresRecovery: true,
            };
        }

        return { success: true, selected: label || value || values, selector };
    }

    /**
     * Fill form
     */
    async fillForm(args) {
        const { fields } = args;
        const results = [];

        const blocked = await this._guardInteraction('fill_form', 'form', { includeDom: true });
        if (blocked) {
            return blocked;
        }

        for (const field of fields) {
            const { element, ref, value } = field;
            let selector;
            if (ref) {
                const refData = this.snapshotRefs.get(ref);
                if (refData) selector = SelectorEngine.resolveCssSelector(refData);
                else throw new Error(`Field ref "${ref}" not found in snapshot.`);
            } else {
                selector = element;
            }

            await this.page.fill(selector, value);
            results.push({ selector, value, success: true });
        }

        const postActionBlocker = await this._capturePostActionBlocker('fill_form', 'form');
        if (postActionBlocker) {
            return {
                success: true,
                filled: results,
                blockerDetected: postActionBlocker.blocker,
                requiresRecovery: true,
            };
        }

        return { success: true, filled: results };
    }

    /**
     * Wait for condition
     */
    async waitFor(args) {
        const { text, textGone, selector, state, time } = args;

        const target = text
            ? `text=${text}`
            : textGone
                ? `textGone=${textGone}`
                : selector || `time=${time || 0}`;
        const blocked = await this._guardInteraction('wait_for', target, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        if (time) {
            await this.page.waitForTimeout(time * 1000);
            return { success: true, waited: `${time} seconds` };
        }

        if (textGone) {
            try {
                await this.page.waitForSelector(`text=${textGone}`, { state: state || 'hidden' });
                return { success: true, gone: textGone };
            } catch (error) {
                const postWaitBlocker = await this.getBlockingState();
                if (postWaitBlocker.present) {
                    return this._buildBlockedResult('wait_for', postWaitBlocker.blocker, {
                        target: `textGone=${textGone}`,
                        errorCode: 'RUNTIME_BLOCKER',
                    });
                }
                throw error;
            }
        }

        if (text) {
            try {
                await this.page.waitForSelector(`text=${text}`, { state: state || 'visible' });
                return { success: true, found: text };
            } catch (error) {
                const postWaitBlocker = await this.getBlockingState();
                if (postWaitBlocker.present) {
                    return this._buildBlockedResult('wait_for', postWaitBlocker.blocker, {
                        target: `text=${text}`,
                        errorCode: 'RUNTIME_BLOCKER',
                    });
                }
                throw error;
            }
        }

        if (selector) {
            try {
                await this.page.waitForSelector(selector, { state: state || 'visible' });
                return { success: true, found: selector };
            } catch (error) {
                const postWaitBlocker = await this.getBlockingState();
                if (postWaitBlocker.present) {
                    return this._buildBlockedResult('wait_for', postWaitBlocker.blocker, {
                        target: selector,
                        errorCode: 'RUNTIME_BLOCKER',
                    });
                }
                throw error;
            }
        }

        return { success: false, error: 'No wait condition specified' };
    }

    /**
     * Wait for page load state
     */
    async waitForLoadState(args = {}) {
        const { state = 'load', timeout } = args;

        const blocked = await this._guardInteraction('wait_for_load_state', `state=${state}`, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        try {
            const options = {};
            if (typeof timeout === 'number') options.timeout = timeout;
            await this.page.waitForLoadState(state, options);
            return {
                success: true,
                state,
                url: this.page.url(),
                title: await this.page.title(),
            };
        } catch (error) {
            const postWaitBlocker = await this.getBlockingState();
            if (postWaitBlocker.present) {
                return this._buildBlockedResult('wait_for_load_state', postWaitBlocker.blocker, {
                    target: `state=${state}`,
                    errorCode: 'RUNTIME_BLOCKER',
                });
            }
            throw error;
        }
    }

    /**
     * Wait for navigation/URL transition
     */
    async waitForNavigation(args = {}) {
        const { urlPattern, url, waitUntil = 'load', timeout } = args;
        const targetPattern = urlPattern || url || '**';

        const blocked = await this._guardInteraction('wait_for_navigation', targetPattern, { includeDom: true });
        if (blocked) {
            return blocked;
        }

        try {
            const options = { waitUntil };
            if (typeof timeout === 'number') options.timeout = timeout;
            await this.page.waitForURL(targetPattern, options);
            return {
                success: true,
                url: this.page.url(),
                urlPattern: targetPattern,
                waitUntil,
            };
        } catch (error) {
            const postWaitBlocker = await this.getBlockingState();
            if (postWaitBlocker.present) {
                return this._buildBlockedResult('wait_for_navigation', postWaitBlocker.blocker, {
                    target: targetPattern,
                    errorCode: 'RUNTIME_BLOCKER',
                });
            }
            throw error;
        }
    }

    async createTab(args = {}) {
        return this.manageTabs({ ...args, action: 'create' });
    }

    /**
     * Manage tabs
     */
    async manageTabs(args) {
        const { action, index, tabId, url, activate = true } = args;
        const normalizedAction = action === 'new' ? 'create' : action;

        switch (normalizedAction) {
            case 'list':
                return {
                    tabs: this._getTabDescriptors().map(({ page, ...tab }) => tab),
                    activeTabId: this.page ? this._ensureTabId(this.page) : null,
                };

            case 'create': {
                const newPage = await this.context.newPage();
                this._attachEventListeners(newPage);
                const createdTabId = this._ensureTabId(newPage);

                if (url) {
                    await newPage.goto(url);
                }

                if (activate !== false) {
                    this.page = newPage;
                    await newPage.bringToFront();
                }

                const updatedPages = this.context.pages();
                return {
                    success: true,
                    action: 'create',
                    index: updatedPages.indexOf(newPage),
                    tabId: createdTabId,
                    url: newPage.url(),
                    title: await newPage.title(),
                    active: activate !== false,
                    activeTabId: this.page ? this._ensureTabId(this.page) : createdTabId,
                    totalTabs: updatedPages.length,
                };
            }

            case 'close': {
                const target = this._resolveTabTarget({ index, tabId });

                if (target) {
                    const wasActive = target.page === this.page;
                    const closedTabId = target.tabId;
                    await target.page.close();

                    if (wasActive) {
                        const fallbackPage = this.context.pages()[0] || await this.context.newPage();
                        if (fallbackPage && fallbackPage !== target.page) {
                            this._attachEventListeners(fallbackPage);
                            this.page = fallbackPage;
                        }
                    }

                    return {
                        success: true,
                        closed: target.index,
                        closedTabId,
                        activeTabId: this.page ? this._ensureTabId(this.page) : null,
                    };
                }

                return { success: true, closed: index, closedTabId: tabId || null };
            }

            case 'select': {
                const target = this._resolveTabTarget({ index, tabId });

                if (target) {
                    this.page = target.page;
                    await this.page.bringToFront();

                    return {
                        success: true,
                        selected: target.index,
                        tabId: target.tabId,
                        activeTabId: target.tabId,
                    };
                }

                return { success: true, selected: index, tabId: tabId || null };
            }

            default:
                return { error: `Unknown tab action: ${action}` };
        }
    }

    /**
     * Evaluate JavaScript in the browser context (sandboxed by Chromium).
     * Only simple return-value expressions are allowed — no multi-statement
     * scripts, assignment to globals, or network/FS access from Node.
     *
     * Security: CWE-94 mitigation — block dangerous patterns before execution.
     */
    async evaluate(args) {
        const { script, expression } = args;
        const code = script || expression;

        if (!code || typeof code !== 'string') {
            return { error: 'evaluate() requires a non-empty string script or expression' };
        }

        // Block patterns that indicate code-injection attempts in browser context
        const blockedPatterns = [
            /\brequire\s*\(/i,
            /\bprocess\b/i,
            /\b__dirname\b/i,
            /\b__filename\b/i,
            /\bglobalThis\b/i,
            /\bimport\s*\(/i,
        ];
        for (const pattern of blockedPatterns) {
            if (pattern.test(code)) {
                return { error: `evaluate() blocked: expression contains disallowed pattern "${pattern.source}"` };
            }
        }

        const result = await this.page.evaluate(code);
        return { result };
    }

    /**
     * Run Playwright code — DISABLED for security (CWE-94).
     *
     * This method previously used `new Function()` to execute arbitrary
     * Node.js code with full access to the Playwright page, context, and
     * browser objects. This is equivalent to `eval()` and enables arbitrary
     * remote code execution for any caller that can invoke MCP tools.
     *
     * Use the individual MCP action tools (click, fill, navigate, etc.)
     * instead of arbitrary code execution.
     */
    async runCode(_args) {
        return {
            error: 'runCode() has been disabled for security reasons (CWE-94: Code Injection). '
                + 'Use the individual MCP action tools (click, fill, navigate, snapshot, etc.) instead.',
        };
    }

    /**
     * Get console messages (captured via event listeners)
     */
    async getConsoleMessages(args = {}) {
        const { type, limit, clear = false, since } = args;

        let messages = [...this._consoleMessages];

        // Filter by type if specified (log, error, warning, info, debug, trace)
        if (type) {
            messages = messages.filter(m => m.type === type);
        }

        // Filter by timestamp if specified
        if (since) {
            messages = messages.filter(m => m.timestamp >= since);
        }

        // Apply limit (return most recent N)
        if (limit && limit > 0) {
            messages = messages.slice(-limit);
        }

        // Optionally clear captured messages
        if (clear) {
            this._consoleMessages = [];
        }

        return {
            messages,
            total: messages.length,
            capturing: this._captureConsole,
            bufferSize: this._consoleMessages.length,
        };
    }

    /**
     * Get network requests (captured via event listeners)
     */
    async getNetworkRequests(args = {}) {
        const { url, method, resourceType, status, limit, clear = false, since } = args;

        let requests = Array.from(this._networkRequests.values());

        // Filter by URL pattern (substring match)
        if (url) {
            requests = requests.filter(r => r.url.includes(url));
        }

        // Filter by HTTP method
        if (method) {
            requests = requests.filter(r => r.method.toUpperCase() === method.toUpperCase());
        }

        // Filter by resource type (document, script, stylesheet, image, xhr, fetch, etc.)
        if (resourceType) {
            requests = requests.filter(r => r.resourceType === resourceType);
        }

        // Filter by status code
        if (status) {
            requests = requests.filter(r => r.status === status);
        }

        // Filter by timestamp
        if (since) {
            requests = requests.filter(r => r.timestamp >= since);
        }

        // Apply limit (return most recent N)
        if (limit && limit > 0) {
            requests = requests.slice(-limit);
        }

        // Strip large fields for response (headers can be verbose)
        const compactRequests = requests.map(r => ({
            url: r.url,
            method: r.method,
            resourceType: r.resourceType,
            status: r.status,
            statusText: r.statusText,
            duration: r.duration,
            failure: r.failure,
            timestamp: r.timestamp,
            postData: r.postData ? r.postData.substring(0, 500) : null,
        }));

        // Optionally clear captured requests
        if (clear) {
            this._networkRequests.clear();
        }

        return {
            requests: compactRequests,
            total: compactRequests.length,
            capturing: this._captureNetwork,
            bufferSize: this._networkRequests.size,
        };
    }

    /**
     * Get page errors (uncaught exceptions captured via event listeners)
     */
    async getPageErrors(args = {}) {
        const { limit, clear = false, since } = args;

        let errors = [...this._pageErrors];

        if (since) {
            errors = errors.filter(e => e.timestamp >= since);
        }

        if (limit && limit > 0) {
            errors = errors.slice(-limit);
        }

        if (clear) {
            this._pageErrors = [];
        }

        return {
            errors,
            total: errors.length,
            bufferSize: this._pageErrors.length,
        };
    }

    /**
     * Press keyboard key
     */
    async pressKey(args) {
        const { key } = args;
        await this.page.keyboard.press(key);
        return { success: true, pressed: key };
    }

    /**
     * Take screenshot
     */
    async screenshot(args = {}) {
        const { path, fullPage = false } = args;

        const buffer = await this.page.screenshot({ fullPage, path });
        return {
            success: true,
            path: path || 'screenshot taken',
            base64: buffer.toString('base64').substring(0, 100) + '...',
        };
    }

    /**
     * Install browser (no-op for direct integration)
     */
    async install() {
        return { success: true, message: 'Browser already available via Playwright' };
    }

    /**
     * Close browser
     */
    async close() {
        // Always reset state even if browser.close() throws — otherwise
        // ensureConnected() sees stale connected=true and tries to use a dead
        // page object, causing cascading "Target closed" errors.
        try {
            if (this._reactiveCore) { try { this._reactiveCore.dispose(); } catch (e) { /* non-fatal */ } }
            if (this._healStore) { try { this._healStore.flush(); } catch (e) { /* non-fatal */ } }
            if (this._appGraph) { try { this._appGraph.flush(); } catch (e) { /* non-fatal */ } }
            if (this._transport) { try { await this._transport.dispose(); } catch (e) { /* non-fatal */ } }
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.error('[PlaywrightDirect] Browser close error (non-fatal):', error.message);
        } finally {
            this.browser = null;
            this.context = null;
            this.page = null;
            this.connected = false;
        }
        return { success: true };
    }

    /**
     * Upload file(s)
     */
    async fileUpload(args) {
        const { paths, element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else if (element) {
            selector = element;
        } else {
            selector = 'input[type="file"]';
        }

        const fileInput = await this.page.$(selector);
        if (fileInput) {
            await fileInput.setInputFiles(paths);
            return { success: true, uploaded: paths };
        }
        return { success: false, error: 'File input not found' };
    }

    /**
     * Handle browser dialogs
     */
    async handleDialog(args) {
        const { accept, promptText } = args;

        if (this._activeDialog?.dialogHandle && this._activeDialog.handled !== true) {
            return await this._resolveDialog(this._activeDialog, { accept, promptText });
        }

        this._pendingDialogHandler = { accept, promptText };

        return {
            success: true,
            action: accept ? 'accept_pending' : 'dismiss_pending',
            waiting: true,
            message: 'Dialog handler armed for the next native browser dialog.',
        };
    }

    /**
     * Resize browser viewport
     */
    async resize(args) {
        const { width, height } = args;
        await this.page.setViewportSize({ width, height });
        return { success: true, width, height };
    }

    /**
     * Generate locator for element
     */
    async generateLocator(args) {
        const { element, ref } = args;

        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                const locators = [];
                if (refData.id) locators.push(`#${refData.id}`);
                if (refData.name) locators.push(`[name="${refData.name}"]`);
                if (refData.ariaLabel) locators.push(`[aria-label="${refData.ariaLabel}"]`);
                if (refData.text) locators.push(`text=${refData.text}`);
                return { success: true, locators, element: refData };
            }
        }

        return { success: false, error: 'Could not generate locator' };
    }

    /**
     * Verify element is visible
     */
    async verifyElementVisible(args) {
        const { element, ref } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
            return { success: true, visible: true, selector };
        } catch (e) {
            return { success: false, visible: false, selector, error: e.message };
        }
    }

    /**
     * Verify text is visible on page
     */
    async verifyTextVisible(args) {
        const { text } = args;

        try {
            await this.page.waitForSelector(`text=${text}`, { state: 'visible', timeout: 5000 });
            return { success: true, visible: true, text };
        } catch (e) {
            return { success: false, visible: false, text, error: e.message };
        }
    }

    /**
     * Verify element has specific value
     */
    async verifyValue(args) {
        const { element, ref, value } = args;
        let selector;
        if (ref) {
            const refData = this.snapshotRefs.get(ref);
            if (refData) {
                selector = SelectorEngine.resolveCssSelector(refData);
            } else {
                throw new Error(`Element ref "${ref}" not found in snapshot. Take a new snapshot first.`);
            }
        } else {
            selector = element;
        }

        const actualValue = await this.page.$eval(selector, el => el.value || el.textContent);
        const matches = actualValue === value;
        return { success: matches, expected: value, actual: actualValue, matches };
    }

    /**
     * Save page as PDF
     */
    async savePdf(args) {
        const { filename = 'page.pdf' } = args;
        await this.page.pdf({ path: filename });
        return { success: true, filename };
    }

    /**
     * Click at specific X,Y coordinates
     */
    async mouseClickXY(args) {
        const { x, y, button = 'left' } = args;
        await this.page.mouse.click(x, y, { button });
        return { success: true, x, y, button };
    }

    /**
     * Move mouse to specific coordinates
     */
    async mouseMoveXY(args) {
        const { x, y } = args;
        await this.page.mouse.move(x, y);
        return { success: true, x, y };
    }

    /**
     * Drag from one coordinate to another
     */
    async mouseDragXY(args) {
        const { startX, startY, endX, endY } = args;
        await this.page.mouse.move(startX, startY);
        await this.page.mouse.down();
        await this.page.mouse.move(endX, endY);
        await this.page.mouse.up();
        return { success: true, from: { x: startX, y: startY }, to: { x: endX, y: endY } };
    }

    /**
     * Scroll using mouse wheel
     */
    async mouseWheel(args) {
        const { deltaX = 0, deltaY = 0 } = args;
        await this.page.mouse.wheel(deltaX, deltaY);
        return { success: true, deltaX, deltaY };
    }

    /**
     * Cleanup
     */
    async cleanup() {
        await this.close();
    }
}

export { PlaywrightDirectBridge as PlaywrightBridge };
