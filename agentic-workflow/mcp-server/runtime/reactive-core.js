/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * REACTIVE CORE  — Event-driven perception bus  (Phase 2 of the Cognitive Browser Runtime)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Turns the resident agent's pushes (perception deltas + the instant blocker signal) and
 * browser-level events (native dialogs, navigation) into AWAITABLE primitives — so Node
 * reacts to the page instead of polling it.
 *
 *      BEFORE (pull):  loop { getBlockingState() [full DOM evaluate]; sleep(50ms) } x up to 15
 *      AFTER  (push):  await reactiveCore.observePostAction()  ->  resolves the instant a modal
 *                      is pushed, or as soon as the DOM goes quiet (zero extra DOM round-trips)
 *
 * This is the module the bridge's _capturePostActionBlocker delegates to when the resident
 * agent is active, collapsing the fixed 750ms observation tax to near-zero in the common case.
 *
 * Subscribes to (emitted by the bridge):
 *   • 'perception-delta'  — structural change batch from the resident agent
 *   • 'perception-ready'  — resident agent announced readiness
 *   • 'blocker'           — modal/overlay appeared or cleared (in-page detection, pushed)
 *   • 'native-dialog'     — alert/confirm/prompt (Playwright page 'dialog' event)
 *   • 'navigation'        — frame navigated (CDP / Playwright)
 *
 * Pure Node + an EventManager. No Playwright dependency — unit-testable in isolation.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { EventManager } from '../utils/event-manager.js';

export class ReactiveCore {
    /**
     * @param {import('events').EventEmitter} emitter - The bridge (source of perception events).
     * @param {object} [options]
     * @param {EventManager} [options.eventManager] - Shared event bus (one is created if omitted).
     */
    constructor(emitter, options = {}) {
        this._emitter = emitter;
        this._eventManager = options.eventManager || new EventManager({ bufferSize: options.bufferSize ?? 1000 });

        /** Current blocker state, kept current by pushes. */
        this._blocker = { present: false, info: null, at: 0 };
        /** Timestamp of the most recent perception delta (for quiescence detection). */
        this._lastDeltaAt = 0;
        /** Pending one-shot waiters for a blocker appearance. */
        this._blockerWaiters = [];

        this._stats = { deltas: 0, blockerAppear: 0, blockerClear: 0, navigations: 0, nativeDialogs: 0 };
        this._wire();
    }

    get eventManager() { return this._eventManager; }
    get blocker() { return this._blocker; }
    hasBlocker() { return this._blocker.present; }

    _wire() {
        this._onPerceptionDelta = (d) => {
            this._lastDeltaAt = Date.now();
            this._stats.deltas += 1;
            this._eventManager.push('mutation', d, 'resident-agent');
        };
        this._onPerceptionReady = (d) => {
            this._eventManager.push('mutation', { ...d, ready: true }, 'resident-agent');
        };
        this._onBlockerEvt = (b) => this._handleBlocker(b);
        this._onNativeDialog = (d) => this._handleBlocker({ present: true, kind: 'native-dialog', ...d });
        this._onNavigation = (n) => {
            this._stats.navigations += 1;
            // Navigation tears down the page → any DOM blocker is gone.
            if (this._blocker.present && this._blocker.info?.kind !== 'native-dialog') {
                this._handleBlocker({ present: false, reason: 'navigation' });
            }
            this._eventManager.push('navigation', n, 'browser');
        };

        this._emitter.on('perception-delta', this._onPerceptionDelta);
        this._emitter.on('perception-ready', this._onPerceptionReady);
        this._emitter.on('blocker', this._onBlockerEvt);
        this._emitter.on('native-dialog', this._onNativeDialog);
        this._emitter.on('navigation', this._onNavigation);
    }

    _handleBlocker(b) {
        const present = !!b.present;
        this._blocker = { present, info: present ? b : null, at: Date.now() };
        if (present) this._stats.blockerAppear += 1; else this._stats.blockerClear += 1;
        if (b.kind === 'native-dialog') this._stats.nativeDialogs += 1;
        this._eventManager.push('dialog', b, b.kind === 'native-dialog' ? 'browser' : 'resident-agent');

        if (present) {
            const waiters = this._blockerWaiters;
            this._blockerWaiters = [];
            for (const w of waiters) w.resolve(b);
        }
    }

    /**
     * Await a blocker appearing within timeoutMs. Resolves immediately if one is already
     * present; resolves null on timeout. No DOM round-trips — purely push-driven.
     */
    waitForBlocker({ timeoutMs = 800 } = {}) {
        if (this._blocker.present) return Promise.resolve(this._blocker.info);
        return new Promise((resolve) => {
            const waiter = { resolve: null };
            const timer = setTimeout(() => {
                this._blockerWaiters = this._blockerWaiters.filter((w) => w !== waiter);
                resolve(null);
            }, timeoutMs);
            waiter.resolve = (b) => { clearTimeout(timer); resolve(b); };
            this._blockerWaiters.push(waiter);
        });
    }

    /**
     * Resolve when the DOM has been quiet (no perception delta) for quietMs, or at timeoutMs.
     * Local-timestamp based — never touches the browser.
     */
    waitForQuiescence({ quietMs = 120, timeoutMs = 800 } = {}) {
        const start = Date.now();
        // If we've never seen a delta, treat "now" as the last activity instant.
        if (!this._lastDeltaAt) this._lastDeltaAt = start;
        return new Promise((resolve) => {
            const check = () => {
                const sinceDelta = Date.now() - this._lastDeltaAt;
                if (sinceDelta >= quietMs) return resolve({ quiet: true, waitedMs: Date.now() - start });
                if (Date.now() - start >= timeoutMs) return resolve({ quiet: false, waitedMs: Date.now() - start });
                setTimeout(check, Math.min(quietMs, 40));
            };
            check();
        });
    }

    /**
     * The push-driven replacement for the post-action blocker poll. Resolves as soon as a
     * blocker is pushed, OR once the DOM settles (quietMs of no mutations), whichever first —
     * bounded by maxMs. Returns { blocker, settled, waitedMs }.
     */
    async observePostAction({ maxMs = 750, quietMs = 120 } = {}) {
        const start = Date.now();
        if (this._blocker.present) {
            return { blocker: this._blocker.info, settled: false, waitedMs: 0 };
        }
        const blockerP = this.waitForBlocker({ timeoutMs: maxMs }).then((b) => ({ kind: 'blocker', b }));
        const quietP = this.waitForQuiescence({ quietMs, timeoutMs: maxMs }).then((q) => ({ kind: 'quiet', q }));
        const winner = await Promise.race([blockerP, quietP]);
        if (winner.kind === 'blocker' && winner.b) {
            return { blocker: winner.b, settled: false, waitedMs: Date.now() - start };
        }
        // DOM settled first; do one last check for a blocker that may have raced in.
        return { blocker: this._blocker.present ? this._blocker.info : null, settled: true, waitedMs: Date.now() - start };
    }

    /** Recent events for diagnostics / the event-stream tool surface. */
    getEvents(options = {}) {
        return this._eventManager.getEvents(options);
    }

    stats() {
        return { ...this._stats, blocker: this._blocker, lastDeltaAt: this._lastDeltaAt };
    }

    /** Detach all listeners (call on bridge cleanup). */
    dispose() {
        this._emitter.off('perception-delta', this._onPerceptionDelta);
        this._emitter.off('perception-ready', this._onPerceptionReady);
        this._emitter.off('blocker', this._onBlockerEvt);
        this._emitter.off('native-dialog', this._onNativeDialog);
        this._emitter.off('navigation', this._onNavigation);
        for (const w of this._blockerWaiters) w.resolve(null);
        this._blockerWaiters = [];
    }
}

export default ReactiveCore;
