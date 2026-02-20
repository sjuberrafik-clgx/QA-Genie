/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NOTIFIER — Multi-Channel Pipeline Notification Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Sends pipeline notifications to configured channels:
 *   - Slack (via webhook)
 *   - Microsoft Teams (via webhook)
 *   - Console (always — for logging)
 *
 * Integrates with EventBridge to auto-trigger on pipeline completion,
 * test failures, bugs filed, and self-healing outcomes.
 *
 * @module sdk-orchestrator/notifier
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { getEventBridge, EVENT_TYPES } = require('./event-bridge');
const { loadEnv, truncate } = require('./utils');

// ─── Notification Types ─────────────────────────────────────────────────────

const NOTIFY_EVENTS = {
    PIPELINE_COMPLETE: 'pipeline_complete',
    PIPELINE_FAILED: 'pipeline_failed',
    TESTS_FAILED: 'tests_failed',
    BUG_FILED: 'bug_filed',
    SELF_HEAL_SUCCESS: 'self_heal_success',
    SELF_HEAL_FAILED: 'self_heal_failed',
};

// ─── Notifier ───────────────────────────────────────────────────────────────

class Notifier {
    /**
     * @param {Object} [options]
     * @param {string} [options.slackWebhookUrl]  - Slack incoming webhook URL
     * @param {string} [options.teamsWebhookUrl]   - Teams incoming webhook URL
     * @param {boolean} [options.enabled=true]
     * @param {boolean} [options.verbose=false]
     */
    constructor(options = {}) {
        loadEnv();

        this.slackUrl = options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL || null;
        this.teamsUrl = options.teamsWebhookUrl || process.env.TEAMS_WEBHOOK_URL || null;
        this.enabled = options.enabled !== false;
        this.verbose = options.verbose || false;

        this._subscribed = false;
    }

    /**
     * Subscribe to EventBridge events to auto-send notifications.
     */
    subscribe() {
        if (this._subscribed) return;

        const bridge = getEventBridge();

        bridge.on(EVENT_TYPES.RUN_COMPLETE, (event) => {
            const { ticketId, success, duration, error } = event.data;

            if (success) {
                this.notify(NOTIFY_EVENTS.PIPELINE_COMPLETE, {
                    runId: event.runId,
                    ticketId,
                    duration,
                });
            } else {
                this.notify(NOTIFY_EVENTS.PIPELINE_FAILED, {
                    runId: event.runId,
                    ticketId,
                    duration,
                    error: truncate(error, 300),
                });
            }
        });

        this._subscribed = true;
        this._log('Notifier subscribed to EventBridge');
    }

    /**
     * Send a notification to all configured channels.
     *
     * @param {string} eventType - One of NOTIFY_EVENTS
     * @param {Object} data      - Event-specific payload
     */
    async notify(eventType, data) {
        if (!this.enabled) return;

        const message = this._formatMessage(eventType, data);

        // Console (always)
        this._log(`[${eventType}] ${message.text}`);

        // Slack
        if (this.slackUrl) {
            await this._sendSlack(message).catch(err =>
                this._log(`Slack notification failed: ${err.message}`, 'warn')
            );
        }

        // Teams
        if (this.teamsUrl) {
            await this._sendTeams(message).catch(err =>
                this._log(`Teams notification failed: ${err.message}`, 'warn')
            );
        }
    }

    // ─── Message Formatting ─────────────────────────────────────────

    _formatMessage(eventType, data) {
        switch (eventType) {
            case NOTIFY_EVENTS.PIPELINE_COMPLETE:
                return {
                    text: `Pipeline passed for ${data.ticketId} (${data.duration})`,
                    color: '#36a64f', // green
                    emoji: ':white_check_mark:',
                    title: 'Pipeline Complete',
                    fields: [
                        { title: 'Ticket', value: data.ticketId, short: true },
                        { title: 'Duration', value: data.duration, short: true },
                        { title: 'Run ID', value: data.runId, short: true },
                    ],
                };

            case NOTIFY_EVENTS.PIPELINE_FAILED:
                return {
                    text: `Pipeline failed for ${data.ticketId}: ${data.error || 'unknown error'}`,
                    color: '#e01e5a', // red
                    emoji: ':x:',
                    title: 'Pipeline Failed',
                    fields: [
                        { title: 'Ticket', value: data.ticketId, short: true },
                        { title: 'Duration', value: data.duration, short: true },
                        { title: 'Error', value: data.error || 'Unknown', short: false },
                        { title: 'Run ID', value: data.runId, short: true },
                    ],
                };

            case NOTIFY_EVENTS.TESTS_FAILED:
                return {
                    text: `Tests failed for ${data.ticketId}: ${data.failedCount} failure(s)`,
                    color: '#ff9f1c', // orange
                    emoji: ':warning:',
                    title: 'Tests Failed',
                    fields: [
                        { title: 'Ticket', value: data.ticketId, short: true },
                        { title: 'Failed', value: `${data.failedCount}/${data.totalCount}`, short: true },
                    ],
                };

            case NOTIFY_EVENTS.SELF_HEAL_SUCCESS:
                return {
                    text: `Self-healing succeeded for ${data.ticketId} (${data.iterations} iteration(s))`,
                    color: '#2eb886', // teal
                    emoji: ':wrench:',
                    title: 'Self-Healing Success',
                    fields: [
                        { title: 'Ticket', value: data.ticketId, short: true },
                        { title: 'Iterations', value: String(data.iterations), short: true },
                        { title: 'Fixes', value: String(data.fixesApplied), short: true },
                    ],
                };

            case NOTIFY_EVENTS.SELF_HEAL_FAILED:
                return {
                    text: `Self-healing failed for ${data.ticketId} after ${data.iterations} iterations`,
                    color: '#e01e5a',
                    emoji: ':x:',
                    title: 'Self-Healing Failed',
                    fields: [
                        { title: 'Ticket', value: data.ticketId, short: true },
                        { title: 'Iterations', value: String(data.iterations), short: true },
                    ],
                };

            case NOTIFY_EVENTS.BUG_FILED:
                return {
                    text: `Bug ticket created for ${data.ticketId}`,
                    color: '#6f42c1', // purple
                    emoji: ':bug:',
                    title: 'Bug Ticket Filed',
                    fields: [
                        { title: 'Source Ticket', value: data.ticketId, short: true },
                    ],
                };

            default:
                return {
                    text: `Pipeline event: ${eventType}`,
                    color: '#cccccc',
                    emoji: ':robot_face:',
                    title: eventType,
                    fields: [],
                };
        }
    }

    // ─── Channel Senders ────────────────────────────────────────────

    async _sendSlack(message) {
        const payload = {
            text: `${message.emoji} *${message.title}*\n${message.text}`,
            attachments: [{
                color: message.color,
                fields: message.fields.map(f => ({
                    title: f.title,
                    value: f.value,
                    short: f.short,
                })),
                footer: 'QA Pipeline Server',
                ts: Math.floor(Date.now() / 1000),
            }],
        };

        const response = await fetch(this.slackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Slack webhook returned ${response.status}`);
        }
    }

    async _sendTeams(message) {
        // Adaptive Card format for Teams
        const payload = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: message.color.replace('#', ''),
            summary: message.text,
            sections: [{
                activityTitle: `${message.emoji} ${message.title}`,
                activitySubtitle: message.text,
                facts: message.fields.map(f => ({
                    name: f.title,
                    value: f.value,
                })),
                markdown: true,
            }],
        };

        const response = await fetch(this.teamsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Teams webhook returned ${response.status}`);
        }
    }

    // ─── Logging ────────────────────────────────────────────────────

    _log(msg, level = 'info') {
        const prefix = '[Notifier]';
        if (level === 'error') console.error(`${prefix} ❌ ${msg}`);
        else if (level === 'warn') console.warn(`${prefix} ⚠️ ${msg}`);
        else if (this.verbose || level === 'info') console.log(`${prefix} ${msg}`);
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { Notifier, NOTIFY_EVENTS };
