/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * READINESS MONITOR SCHEDULER — Background Jira readiness pollers
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Starts long-running JiraReadinessMonitor pollers so the readiness webhooks fire
 * automatically instead of only via the manual `notify:*` npm scripts:
 *
 *   - OH Mobile QA readiness  → SLACK_WEBHOOK_URL / TEAMS_WEBHOOK_URL
 *   - AOTF Release readiness  → AOTF_RELEASE_SLACK_WEBHOOK_URL / AOTF_RELEASE_TEAMS_WEBHOOK_URL
 *
 * Enablement + interval are resolved from environment variables, which override
 * the matching workflow-config.json sections (ticketReadinessMonitor /
 * releaseReadinessMonitor):
 *
 *   OH_MOBILE_READINESS_ENABLED / OH_MOBILE_READINESS_POLL_INTERVAL_MS
 *   AOTF_RELEASE_READINESS_ENABLED / AOTF_RELEASE_READINESS_POLL_INTERVAL_MS
 *
 * Each poller baselines silently on its first run (no startup spam) and then only
 * sends a webhook when a ticket's status changes into the ready set. Deduplication
 * state is shared with the manual scripts via the same test-artifacts state files.
 *
 * @module sdk-orchestrator/readiness-monitor-scheduler
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const { JiraReadinessMonitor, fetchReleaseReadyTickets } = require('./jira-readiness-monitor');
const { Notifier } = require('./notifier');

const MIN_POLL_INTERVAL_MS = 60000;

/**
 * Parse a boolean-ish environment value. Returns undefined when unset/unknown so
 * the caller can fall back to config.
 */
function parseBoolEnv(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

/**
 * Parse a poll-interval environment value (ms). Returns undefined when unset or
 * invalid; otherwise clamps to the minimum supported interval.
 */
function parseIntervalEnv(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.max(parsed, MIN_POLL_INTERVAL_MS);
}

/**
 * Resolve whether a monitor is enabled: env flag wins, else config, else false.
 */
function resolveEnabled(envValue, configValue) {
    const envParsed = parseBoolEnv(envValue);
    if (envParsed !== undefined) return envParsed;
    return configValue === true;
}

/**
 * Start the background readiness pollers.
 *
 * @param {Object} [options]
 * @param {Object} [options.config]   - Parsed workflow-config.json (top-level).
 * @param {Function} [options.logger] - (message, level) logger.
 * @returns {{ monitors: Array, stop: Function }}
 */
function startReadinessMonitors(options = {}) {
    const rootConfig = options.config || {};
    const logger = typeof options.logger === 'function' ? options.logger : () => {};
    const artifactsDir = path.join(__dirname, '..', 'test-artifacts');

    const specs = [
        {
            id: 'oh-mobile',
            label: 'OH Mobile QA readiness',
            enabledEnv: process.env.OH_MOBILE_READINESS_ENABLED,
            intervalEnv: process.env.OH_MOBILE_READINESS_POLL_INTERVAL_MS,
            domainConfig: rootConfig.ticketReadinessMonitor || {},
            statePath: path.join(artifactsDir, 'jira-readiness-monitor.json'),
            hasWebhook: Boolean(process.env.SLACK_WEBHOOK_URL || process.env.TEAMS_WEBHOOK_URL),
            missingWebhookHint: 'Set SLACK_WEBHOOK_URL or TEAMS_WEBHOOK_URL',
            buildNotifier: () => new Notifier({ enabled: true }),
            buildFetchReport: null,
        },
        {
            id: 'aotf-release',
            label: 'AOTF Release readiness',
            enabledEnv: process.env.AOTF_RELEASE_READINESS_ENABLED,
            intervalEnv: process.env.AOTF_RELEASE_READINESS_POLL_INTERVAL_MS,
            domainConfig: rootConfig.releaseReadinessMonitor || {},
            statePath: path.join(artifactsDir, 'jira-release-readiness-monitor.json'),
            hasWebhook: Boolean(process.env.AOTF_RELEASE_SLACK_WEBHOOK_URL || process.env.AOTF_RELEASE_TEAMS_WEBHOOK_URL),
            missingWebhookHint: 'Set AOTF_RELEASE_SLACK_WEBHOOK_URL or AOTF_RELEASE_TEAMS_WEBHOOK_URL',
            buildNotifier: () => new Notifier({
                enabled: true,
                slackWebhookUrl: process.env.AOTF_RELEASE_SLACK_WEBHOOK_URL || null,
                teamsWebhookUrl: process.env.AOTF_RELEASE_TEAMS_WEBHOOK_URL || null,
                useDefaultEnvironmentWebhooks: false,
            }),
            buildFetchReport: (domainConfig) => () => fetchReleaseReadyTickets(domainConfig),
        },
    ];

    const started = [];

    for (const spec of specs) {
        const enabled = resolveEnabled(spec.enabledEnv, spec.domainConfig.enabled);
        if (!enabled) {
            logger(`[ReadinessScheduler] ${spec.label} disabled — skipping.`, 'info');
            continue;
        }
        if (!spec.hasWebhook) {
            logger(`[ReadinessScheduler] ${spec.label} enabled but no webhook configured — skipping. ${spec.missingWebhookHint}.`, 'warn');
            continue;
        }

        const intervalOverride = parseIntervalEnv(spec.intervalEnv);
        const monitorConfig = {
            ...spec.domainConfig,
            enabled: true,
            ...(intervalOverride ? { pollIntervalMs: intervalOverride } : {}),
        };

        try {
            const monitor = new JiraReadinessMonitor({
                config: monitorConfig,
                statePath: spec.statePath,
                notifier: spec.buildNotifier(),
                logger: (message, level) => logger(message, level),
                ...(spec.buildFetchReport ? { fetchReport: spec.buildFetchReport(spec.domainConfig) } : {}),
            });
            const didStart = monitor.start();
            if (didStart) {
                started.push({ id: spec.id, label: spec.label, monitor });
                const everyMs = monitorConfig.pollIntervalMs || monitor.config.pollIntervalMs;
                logger(`[ReadinessScheduler] ${spec.label} poller started (every ${everyMs}ms).`, 'info');
            }
        } catch (error) {
            logger(`[ReadinessScheduler] Failed to start ${spec.label}: ${error.message}`, 'error');
        }
    }

    if (started.length === 0) {
        logger('[ReadinessScheduler] No readiness pollers started.', 'info');
    }

    return {
        monitors: started,
        stop() {
            for (const entry of started) {
                try {
                    entry.monitor.stop();
                } catch {
                    // ignore
                }
            }
        },
    };
}

module.exports = {
    startReadinessMonitors,
    parseBoolEnv,
    parseIntervalEnv,
    resolveEnabled,
    MIN_POLL_INTERVAL_MS,
};
