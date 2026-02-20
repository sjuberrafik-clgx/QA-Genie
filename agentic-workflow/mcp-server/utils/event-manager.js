/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * EVENT MANAGER — Real-Time Browser Event Streaming
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Central event bus for all browser events. Collects console messages, network requests,
 * page errors, dialogs, DOM mutations, and custom events from all bridges and provides
 * a unified API for querying and streaming them.
 * 
 * Features:
 *   - Ring-buffered event storage per category
 *   - Subscription system for real-time streaming (SSE/WebSocket)
 *   - Event filtering by type, source, timestamp
 *   - Aggregate statistics
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';

/**
 * @typedef {'console' | 'network' | 'pageerror' | 'dialog' | 'mutation' | 'navigation' | 'custom'} EventCategory
 */

export class EventManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.setMaxListeners(50);

        this._bufferSize = options.bufferSize ?? 2000;
        this._enabled = true;

        /** @type {Map<EventCategory, Array<object>>} */
        this._buffers = new Map([
            ['console', []],
            ['network', []],
            ['pageerror', []],
            ['dialog', []],
            ['mutation', []],
            ['navigation', []],
            ['custom', []],
        ]);

        /** @type {Map<string, { category: EventCategory, filter?: Function, callback: Function }>} */
        this._subscriptions = new Map();

        this._stats = {
            totalEvents: 0,
            eventsByCategory: {},
            startTime: Date.now(),
        };
    }

    /**
     * Push an event into the manager
     * @param {EventCategory} category 
     * @param {object} data 
     * @param {string} [source] - Bridge source identifier
     */
    push(category, data, source = 'unknown') {
        if (!this._enabled) return;

        const event = {
            id: `${category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            category,
            source,
            timestamp: Date.now(),
            data,
        };

        // Store in ring buffer
        const buffer = this._buffers.get(category);
        if (buffer) {
            buffer.push(event);
            if (buffer.length > this._bufferSize) {
                buffer.shift();
            }
        }

        // Update stats
        this._stats.totalEvents++;
        this._stats.eventsByCategory[category] = (this._stats.eventsByCategory[category] || 0) + 1;

        // Emit globally
        this.emit('event', event);
        this.emit(category, event);

        // Notify subscribers
        for (const [, sub] of this._subscriptions) {
            if (sub.category === category || sub.category === '*') {
                if (!sub.filter || sub.filter(event)) {
                    try { sub.callback(event); } catch (e) { /* ignore subscriber errors */ }
                }
            }
        }
    }

    /**
     * Get buffered events
     */
    getEvents(options = {}) {
        const { category, since, limit, type, url, source } = options;

        let events;
        if (category && category !== '*') {
            events = [...(this._buffers.get(category) || [])];
        } else {
            // Merge all categories
            events = [];
            for (const buffer of this._buffers.values()) {
                events.push(...buffer);
            }
            events.sort((a, b) => a.timestamp - b.timestamp);
        }

        // Apply filters
        if (since) events = events.filter(e => e.timestamp >= since);
        if (source) events = events.filter(e => e.source === source);
        if (type) events = events.filter(e => e.data?.type === type);
        if (url) events = events.filter(e => e.data?.url?.includes(url));

        // Apply limit (most recent N)
        if (limit && limit > 0) events = events.slice(-limit);

        return {
            events,
            total: events.length,
        };
    }

    /**
     * Subscribe to events
     * @returns {string} Subscription ID
     */
    subscribe(category, callback, filter = null) {
        const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this._subscriptions.set(id, { category, callback, filter });
        return id;
    }

    /**
     * Unsubscribe
     */
    unsubscribe(subscriptionId) {
        return this._subscriptions.delete(subscriptionId);
    }

    /**
     * Clear events in a category (or all)
     */
    clear(category = null) {
        if (category) {
            const buffer = this._buffers.get(category);
            if (buffer) buffer.length = 0;
        } else {
            for (const buffer of this._buffers.values()) {
                buffer.length = 0;
            }
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        const bufferSizes = {};
        for (const [cat, buf] of this._buffers) {
            bufferSizes[cat] = buf.length;
        }

        return {
            ...this._stats,
            bufferSizes,
            subscriptions: this._subscriptions.size,
            uptime: Date.now() - this._stats.startTime,
        };
    }

    /**
     * Enable/disable event collection
     */
    setEnabled(enabled) {
        this._enabled = enabled;
    }

    /**
     * Connect to a PlaywrightDirectBridge and pipe its events
     */
    connectBridge(bridge, sourceName = 'playwright') {
        if (!bridge) return;

        bridge.on('console', (data) => this.push('console', data, sourceName));
        bridge.on('pageerror', (data) => this.push('pageerror', data, sourceName));
        bridge.on('response', (data) => this.push('network', data, sourceName));
        bridge.on('requestfailed', (data) => this.push('network', { ...data, failed: true }, sourceName));
        bridge.on('dialog', (data) => this.push('dialog', data, sourceName));
    }
}
