const fs = require('fs');
const path = require('path');

const { getJiraApiConfig } = require('./tools/jira-api-helpers');
const { ensureDir } = require('./utils');

const DEFAULT_JQL = 'project in (16907) AND labels in (aotf-mobile-app) AND status in ("- UAT -", "- Finished -") ORDER BY Rank ASC';
const DEFAULT_STATE_PATH = path.join(__dirname, '..', 'test-artifacts', 'jira-readiness-monitor.json');
const DEFAULT_RELEASE_NAME_PATTERN = '^R5\\.\\d+(?:\\.\\d+)?$';

function displayFieldValue(value) {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (Array.isArray(value)) {
        const items = value.map(displayFieldValue).filter(item => item !== 'Not set');
        return items.length > 0 ? items.join(', ') : 'Not set';
    }
    if (typeof value === 'object') {
        return value.value || value.name || value.displayName || value.key || 'Not set';
    }
    return String(value);
}

function mapIssue(issue, jiraConfig, config) {
    const fields = issue.fields || {};
    return {
        issueType: displayFieldValue(fields.issuetype),
        issueKey: issue.key,
        summary: displayFieldValue(fields.summary),
        status: displayFieldValue(fields.status),
        relatedModules: displayFieldValue(fields[config.relatedModulesField]),
        assignee: displayFieldValue(fields.assignee),
        storyPoints: displayFieldValue(fields[config.storyPointsField]),
        url: `${jiraConfig.browseBaseUrl}/browse/${issue.key}`,
    };
}

async function fetchReadyTickets(config = {}, fetchImpl = fetch) {
    const jiraConfig = getJiraApiConfig();
    if (jiraConfig.error) throw new Error(jiraConfig.error);

    const effectiveConfig = {
        jql: config.jql || DEFAULT_JQL,
        relatedModulesField: config.relatedModulesField || 'components',
        storyPointsField: config.storyPointsField || 'customfield_10006',
    };
    const requestedFields = [
        'issuetype',
        'summary',
        'status',
        effectiveConfig.relatedModulesField,
        'assignee',
        effectiveConfig.storyPointsField,
    ];
    const issues = [];
    let nextPageToken;

    do {
        const response = await fetchImpl(`${jiraConfig.apiBase}/search/jql`, {
            method: 'POST',
            headers: jiraConfig.headers,
            body: JSON.stringify({
                jql: effectiveConfig.jql,
                maxResults: 100,
                fields: requestedFields,
                ...(nextPageToken ? { nextPageToken } : {}),
            }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const details = body.errorMessages?.join('; ') || JSON.stringify(body.errors || body);
            throw new Error(`Jira readiness search failed (${response.status}): ${details}`);
        }
        issues.push(...(body.issues || []));
        nextPageToken = body.nextPageToken;
    } while (nextPageToken);

    return issues.map(issue => mapIssue(issue, jiraConfig, effectiveConfig));
}

function plannedReleaseTime(version) {
    const value = version.releaseDate || version.startDate;
    const timestamp = value ? Date.parse(`${value}T00:00:00Z`) : Number.POSITIVE_INFINITY;
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function releaseNumberParts(name) {
    const match = String(name || '').match(/R(\d+(?:\.\d+)*)/i);
    return match ? match[1].split('.').map(Number) : [];
}

function compareReleaseVersions(left, right) {
    const leftTime = plannedReleaseTime(left);
    const rightTime = plannedReleaseTime(right);
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    const leftParts = releaseNumberParts(left.name);
    const rightParts = releaseNumberParts(right.name);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index++) {
        const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (difference !== 0) return difference;
    }
    return Number(left.id) - Number(right.id);
}

function selectActiveUnreleasedRelease(versions, config = {}) {
    let releasePattern;
    try {
        releasePattern = new RegExp(config.releaseNamePattern || DEFAULT_RELEASE_NAME_PATTERN, 'i');
    } catch (error) {
        throw new Error(`Invalid releaseNamePattern: ${error.message}`);
    }

    const candidates = (Array.isArray(versions) ? versions : [])
        .filter(version => !version.released && !version.archived && releasePattern.test(version.name || ''))
        .sort(compareReleaseVersions);
    return candidates[0] || null;
}

function buildReleaseJql(release, config = {}) {
    const projectKey = String(config.projectKey || 'AOTF').trim();
    if (!/^[A-Z][A-Z0-9_]*$/i.test(projectKey)) throw new Error(`Invalid Jira project key: ${projectKey}`);
    if (!/^\d+$/.test(String(release?.id || ''))) throw new Error('Active Jira release has an invalid version ID.');
    const statuses = Array.isArray(config.statuses) && config.statuses.length > 0
        ? config.statuses
        : ['- UAT -', '- Finished -'];
    const statusJql = statuses.map(status => `"${String(status).replace(/["\\]/g, '\\$&')}"`).join(', ');
    return `project = ${projectKey} AND fixVersion = ${release.id} AND status in (${statusJql}) ORDER BY Rank ASC`;
}

async function fetchReleaseReadyTickets(config = {}, fetchImpl = fetch) {
    const jiraConfig = getJiraApiConfig();
    if (jiraConfig.error) throw new Error(jiraConfig.error);
    const projectKey = config.projectKey || 'AOTF';
    const versionsResponse = await fetchImpl(
        `${jiraConfig.apiBase}/project/${encodeURIComponent(projectKey)}/versions`,
        { headers: jiraConfig.headers }
    );
    const versions = await versionsResponse.json().catch(() => []);
    if (!versionsResponse.ok) {
        throw new Error(`Jira release lookup failed (${versionsResponse.status}).`);
    }
    const release = selectActiveUnreleasedRelease(versions, config);
    if (!release) {
        return {
            tickets: [],
            release: null,
            context: { key: 'release:none', title: 'AOTF release tickets ready for QA', scopeLabel: 'no planned unreleased release' },
            jql: null,
        };
    }

    const jql = buildReleaseJql(release, config);
    const tickets = await fetchReadyTickets({ ...config, jql }, fetchImpl);
    return {
        tickets,
        release,
        context: {
            key: `release:${release.id}`,
            title: `${release.name} tickets ready for QA`,
            scopeLabel: `unreleased ${release.name}`,
        },
        jql,
    };
}

function ticketSignature(ticket, contextKey = 'default') {
    const signature = `${ticket.issueKey}::${ticket.status}`;
    return contextKey === 'default' ? signature : `${contextKey}::${signature}`;
}

class JiraReadinessMonitor {
    constructor(options = {}) {
        this.config = {
            enabled: false,
            pollIntervalMs: 15 * 60 * 1000,
            notifyOnStartup: false,
            jql: DEFAULT_JQL,
            relatedModulesField: 'components',
            storyPointsField: 'customfield_10006',
            ...(options.config || {}),
        };
        this.statePath = options.statePath || DEFAULT_STATE_PATH;
        this.notifier = options.notifier;
        this.fetchReport = options.fetchReport || (options.fetchTickets
            ? async () => ({ tickets: await options.fetchTickets(), context: { key: 'default' }, jql: this.config.jql })
            : async () => ({ tickets: await fetchReadyTickets(this.config), context: { key: 'default' }, jql: this.config.jql }));
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this._timer = null;
        this._running = false;
    }

    _readState() {
        try {
            if (!fs.existsSync(this.statePath)) return null;
            const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return Array.isArray(parsed.signatures) ? parsed : null;
        } catch (error) {
            this.logger(`[JiraReadinessMonitor] Ignoring unreadable state: ${error.message}`, 'warn');
            return null;
        }
    }

    _writeState(tickets, context = {}) {
        ensureDir(path.dirname(this.statePath));
        const tempPath = `${this.statePath}.tmp`;
        const contextKey = context.key || 'default';
        fs.writeFileSync(tempPath, JSON.stringify({
            updatedAt: new Date().toISOString(),
            context,
            signatures: tickets.map(ticket => ticketSignature(ticket, contextKey)),
        }, null, 2));
        fs.renameSync(tempPath, this.statePath);
    }

    async runOnce(options = {}) {
        if (this._running) return { skipped: true, reason: 'already-running' };
        this._running = true;
        try {
            const report = await this.fetchReport();
            const tickets = Array.isArray(report) ? report : (report.tickets || []);
            const context = Array.isArray(report) ? { key: 'default' } : (report.context || { key: 'default' });
            const contextKey = context.key || 'default';
            const priorState = this._readState();
            const notifyCurrent = options.notifyCurrent === true;
            const shouldBaseline = !priorState && !this.config.notifyOnStartup && !notifyCurrent;
            const priorSignatures = new Set(priorState?.signatures || []);
            const readyTickets = notifyCurrent
                ? tickets
                : tickets.filter(ticket => !priorSignatures.has(ticketSignature(ticket, contextKey)));

            if (!options.dryRun && !shouldBaseline && readyTickets.length > 0) {
                if (!this.notifier || typeof this.notifier.sendTicketReadinessReport !== 'function') {
                    throw new Error('No Slack or Teams notifier is available for the Jira readiness report.');
                }
                await this.notifier.sendTicketReadinessReport({
                    tickets: readyTickets,
                    totalMatching: tickets.length,
                    jql: Array.isArray(report) ? this.config.jql : report.jql,
                    title: context.title,
                    scopeLabel: context.scopeLabel,
                    release: Array.isArray(report) ? null : report.release,
                });
            }

            if (!options.dryRun) this._writeState(tickets, context);
            this.logger(
                `[JiraReadinessMonitor] Found ${tickets.length}; ${shouldBaseline ? 'baseline saved' : `${readyTickets.length} new status entr${readyTickets.length === 1 ? 'y' : 'ies'}`}.`,
                'info'
            );
            return { tickets, readyTickets: shouldBaseline ? [] : readyTickets, baselined: shouldBaseline, context };
        } finally {
            this._running = false;
        }
    }

    start() {
        if (!this.config.enabled || this._timer) return false;
        const pollIntervalMs = Math.max(Number(this.config.pollIntervalMs) || 0, 60000);
        this.runOnce().catch(error => this.logger(`[JiraReadinessMonitor] ${error.message}`, 'error'));
        this._timer = setInterval(() => {
            this.runOnce().catch(error => this.logger(`[JiraReadinessMonitor] ${error.message}`, 'error'));
        }, pollIntervalMs);
        this._timer.unref?.();
        this.logger(`[JiraReadinessMonitor] Started (${pollIntervalMs}ms interval).`, 'info');
        return true;
    }

    stop() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
    }
}

module.exports = {
    DEFAULT_JQL,
    DEFAULT_RELEASE_NAME_PATTERN,
    JiraReadinessMonitor,
    buildReleaseJql,
    compareReleaseVersions,
    displayFieldValue,
    fetchReleaseReadyTickets,
    fetchReadyTickets,
    mapIssue,
    selectActiveUnreleasedRelease,
    ticketSignature,
};