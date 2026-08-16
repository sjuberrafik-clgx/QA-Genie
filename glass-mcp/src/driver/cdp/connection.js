'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER/CDP · CONNECTION — zero-dependency Chrome DevTools Protocol client
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A lean CDP transport built on Node's native global `WebSocket` (Node ≥ 21) — no
 * `ws`, no `chrome-remote-interface`, no Playwright. This is the wire under the
 * "own the driver" goal: one persistent socket, request/response id-matching,
 * pipelined commands, and per-target sessions via FLATTENED attach (single WS for
 * the browser + every page/OOPIF, routed by `sessionId`).
 *
 *   const conn = await CdpConnection.connect(browserWsUrl);
 *   const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
 *   const page = conn.session(sessionId);
 *   await page.send('Page.enable');
 *   page.on('Page.loadEventFired', () => { ... });
 *
 * Deterministic + observable: every command resolves/rejects exactly once; a socket
 * close rejects all in-flight commands and emits `disconnect`.
 *
 * @module glass-mcp/driver/cdp/connection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { EventEmitter } = require('node:events');

const DEFAULT_TIMEOUT = 30000;

class CdpConnection extends EventEmitter {
    /**
     * @param {WebSocket} ws an OPEN native WebSocket to a CDP endpoint
     * @param {{timeout?:number}} [opts]
     */
    constructor(ws, opts = {}) {
        super();
        this.setMaxListeners(0); // many verbs subscribe to session-scoped events
        this._ws = ws;
        this._id = 0;
        this._sent = 0;
        this._pending = new Map();
        this._sessionListeners = new Map();
        this._closed = false;
        this._timeout = opts.timeout || DEFAULT_TIMEOUT;
        this._stats = {
            sentBytes: 0,
            receivedMessages: 0,
            receivedBytes: 0,
            responses: 0,
            events: 0,
            dispatchedEvents: 0,
            droppedEvents: 0,
            malformedMessages: 0,
            maxPending: 0,
            eventMethods: new Map(),
        };
        ws.addEventListener('message', (ev) => this._onMessage(ev));
        ws.addEventListener('close', () => this._onClose(new Error('CDP websocket closed')));
        ws.addEventListener('error', () => { /* the close handler performs rejection/cleanup */ });
    }

    /**
     * Open a WebSocket to a CDP endpoint and resolve once the socket is connected.
     * @param {string} wsUrl e.g. ws://127.0.0.1:PORT/devtools/browser/GUID
     * @param {{timeout?:number}} [opts]
     * @returns {Promise<CdpConnection>}
     */
    static connect(wsUrl, opts = {}) {
        return new Promise((resolve, reject) => {
            let ws;
            try { ws = new WebSocket(wsUrl); } catch (e) { return reject(e); }
            const cleanup = () => {
                ws.removeEventListener('open', onOpen);
                ws.removeEventListener('error', onError);
            };
            const onOpen = () => { cleanup(); resolve(new CdpConnection(ws, opts)); };
            const onError = () => { cleanup(); reject(new Error('failed to connect CDP websocket: ' + wsUrl)); };
            ws.addEventListener('open', onOpen);
            ws.addEventListener('error', onError);
        });
    }

    /**
     * Send a CDP command and await its result. Optionally scoped to a `sessionId`
     * (flattened mode) so page/OOPIF traffic rides the same browser socket.
     * @param {string} method e.g. 'Page.navigate'
     * @param {object} [params]
     * @param {string} [sessionId]
     * @returns {Promise<object>} the CDP `result`
     */
    send(method, params = {}, sessionId) {
        if (this._closed) return Promise.reject(new Error('CDP connection is closed'));
        const id = ++this._id;
        this._sent++;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        let payload;
        try { payload = JSON.stringify(msg); } catch (e) { return Promise.reject(e); }
        this._stats.sentBytes += Buffer.byteLength(payload);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pending.delete(id)) reject(new Error(`CDP timeout after ${this._timeout}ms: ${method}`));
            }, this._timeout);
            this._pending.set(id, { resolve, reject, timer });
            this._stats.maxPending = Math.max(this._stats.maxPending, this._pending.size);
            try {
                this._ws.send(payload);
            } catch (e) {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(e);
            }
        });
    }

    /** A thin, `sessionId`-bound view of this connection (Playwright-CDPSession-like). */
    session(sessionId) {
        return new CdpSession(this, sessionId);
    }

    _onMessage(ev) {
        let msg;
        let data;
        try {
            data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
            this._stats.receivedMessages++;
            this._stats.receivedBytes += Buffer.byteLength(data);
            msg = JSON.parse(data);
        } catch {
            this._stats.malformedMessages++;
            return;
        }

        // Command response (id present + tracked).
        if (msg.id !== undefined && this._pending.has(msg.id)) {
            this._stats.responses++;
            const { resolve, reject, timer } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            clearTimeout(timer);
            if (msg.error) reject(cdpError(msg.error, msg.id));
            else resolve(msg.result || {});
            return;
        }

        // Protocol event: dispatch only to channels that have subscribers.
        if (msg.method) {
            this._stats.events++;
            const methodStats = this._stats.eventMethods.get(msg.method) || { count: 0, bytes: 0 };
            methodStats.count++;
            methodStats.bytes += Buffer.byteLength(data);
            this._stats.eventMethods.set(msg.method, methodStats);

            let dispatched = false;
            if (this.listenerCount('event') > 0) {
                this.emit('event', msg);
                dispatched = true;
            }
            if (this.listenerCount(msg.method) > 0) {
                this.emit(msg.method, msg.params, msg.sessionId);
                dispatched = true;
            }
            if (msg.sessionId && this._emitSession(msg.sessionId, msg.method, msg.params)) {
                dispatched = true;
            }
            if (dispatched) this._stats.dispatchedEvents++;
            else this._stats.droppedEvents++;
        }
    }

    _subscribe(sessionId, event, handler, once = false) {
        const key = sessionEventKey(sessionId, event);
        let listeners = this._sessionListeners.get(key);
        if (!listeners) {
            listeners = new Set();
            this._sessionListeners.set(key, listeners);
        }
        listeners.add({ handler, once });
    }

    _unsubscribe(sessionId, event, handler) {
        const key = sessionEventKey(sessionId, event);
        const listeners = this._sessionListeners.get(key);
        if (!listeners) return;
        for (const listener of listeners) {
            if (listener.handler === handler) listeners.delete(listener);
        }
        if (listeners.size === 0) this._sessionListeners.delete(key);
    }

    _emitSession(sessionId, event, params) {
        const key = sessionEventKey(sessionId, event);
        const listeners = this._sessionListeners.get(key);
        if (!listeners || listeners.size === 0) return false;
        for (const listener of [...listeners]) {
            if (listener.once) listeners.delete(listener);
            listener.handler(params);
        }
        if (listeners.size === 0) this._sessionListeners.delete(key);
        return true;
    }

    _onClose(err) {
        if (this._closed) return;
        this._closed = true;
        for (const { reject, timer } of this._pending.values()) {
            clearTimeout(timer);
            reject(err);
        }
        this._pending.clear();
        this._sessionListeners.clear();
        this.emit('disconnect', err);
    }

    get closed() { return this._closed; }

    /** Total CDP commands sent over this connection (for benchmarking round-trips). */
    get sentCount() { return this._sent; }

    get transportStats() {
        return {
            sentCommands: this._sent,
            sentBytes: this._stats.sentBytes,
            receivedMessages: this._stats.receivedMessages,
            receivedBytes: this._stats.receivedBytes,
            responses: this._stats.responses,
            events: this._stats.events,
            dispatchedEvents: this._stats.dispatchedEvents,
            droppedEvents: this._stats.droppedEvents,
            malformedMessages: this._stats.malformedMessages,
            pending: this._pending.size,
            maxPending: this._stats.maxPending,
            eventMethods: Object.fromEntries(this._stats.eventMethods),
        };
    }

    async close() {
        if (this._closed) return;
        try { this._ws.close(); } catch { /* ignore */ }
        this._onClose(new Error('CDP connection closed by client'));
    }
}

/** `sessionId`-bound wrapper: `send`/`on`/`off` without repeating the session id. */
class CdpSession {
    constructor(conn, sessionId) {
        this._conn = conn;
        this.sessionId = sessionId;
    }
    send(method, params) { return this._conn.send(method, params, this.sessionId); }
    on(event, handler) { this._conn._subscribe(this.sessionId, event, handler); return this; }
    once(event, handler) { this._conn._subscribe(this.sessionId, event, handler, true); return this; }
    off(event, handler) { this._conn._unsubscribe(this.sessionId, event, handler); return this; }
}

function sessionEventKey(sessionId, event) {
    return `${sessionId}\u0000${event}`;
}

function cdpError(err, id) {
    const e = new Error(`${err.message || 'CDP error'}${err.data ? ` (${err.data})` : ''}`);
    e.code = err.code;
    e.cdpId = id;
    return e;
}

module.exports = { CdpConnection, CdpSession };
