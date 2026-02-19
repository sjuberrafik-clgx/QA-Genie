/**
 * API Client — HTTP wrapper for SDK Pipeline Server.
 * All endpoint paths are sourced from api-config.js (single source of truth).
 * Timeouts & retry settings use shared constants.
 */

import { API_CONFIG } from './api-config';
import { TIMEOUTS, RETRY } from './constants';

const { endpoints: EP } = API_CONFIG;

const ERROR_MAP = {
    'Failed to fetch': `Backend unreachable — check if the server is running at ${API_CONFIG.baseUrl}`,
    'NetworkError': 'Network error — check your connection',
    'AbortError': 'Request timed out — the server may be busy processing',
    'Load failed': `Backend unreachable — check if the server is running at ${API_CONFIG.baseUrl}`,
};

function friendlyError(err) {
    for (const [key, msg] of Object.entries(ERROR_MAP)) {
        if (err.message?.includes(key)) return new Error(msg);
    }
    return err;
}

class ApiClient {
    constructor(baseUrl = API_CONFIG.baseUrl) {
        this.baseUrl = baseUrl;
    }

    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const timeout = options.timeout || TIMEOUTS.DEFAULT;
        const maxRetries = options.retries ?? RETRY.DEFAULT_RETRIES;

        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            try {
                const res = await fetch(url, {
                    headers: { 'Content-Type': 'application/json', ...options.headers },
                    ...options,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}: ${res.statusText}`);
                }
                return res.json();
            } catch (err) {
                clearTimeout(timer);
                lastError = err;
                if (err.message?.startsWith('HTTP ')) throw err;
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, RETRY.DELAY_MS));
                }
            }
        }
        throw friendlyError(lastError);
    }

    // ─── Health ─────────────────────────────────────────────────
    async health() { return this._fetch(EP.health, { retries: 0, timeout: TIMEOUTS.HEALTH }); }
    async ready() { return this._fetch(EP.ready, { retries: 0, timeout: TIMEOUTS.HEALTH }); }

    // ─── Pipeline ───────────────────────────────────────────────
    async startPipeline(ticketId, mode = 'full', environment = 'UAT', model = 'gpt-4o') {
        return this._fetch(EP.pipelineRun, {
            method: 'POST',
            body: JSON.stringify({ ticketId, mode, environment, model, triggeredBy: 'web-app' }),
            timeout: TIMEOUTS.PIPELINE_START,
            retries: 0,
        });
    }

    async startBatch(ticketIds, mode = 'full', environment = 'UAT') {
        return this._fetch(EP.pipelineBatch, {
            method: 'POST',
            body: JSON.stringify({ ticketIds, mode, environment, triggeredBy: 'web-app' }),
            timeout: TIMEOUTS.PIPELINE_START,
            retries: 0,
        });
    }

    async cancelPipeline(runId) {
        return this._fetch(EP.pipelineCancel(runId), { method: 'POST', retries: 0 });
    }

    async forceCancelPipeline(runId, reason) {
        return this._fetch(EP.pipelineForceCancel(runId), {
            method: 'POST',
            body: JSON.stringify({ reason }),
            retries: 0,
        });
    }

    async listRuns(filters = {}) {
        const qs = new URLSearchParams(filters).toString();
        return this._fetch(`${EP.pipelineRuns}${qs ? '?' + qs : ''}`);
    }

    async getRunStatus(runId) {
        return this._fetch(EP.pipelineStatus(runId), { timeout: TIMEOUTS.RUN_STATUS });
    }

    async getRunResults(runId) {
        return this._fetch(EP.pipelineResults(runId));
    }

    // ─── Chat ───────────────────────────────────────────────────
    async createChatSession(model, agentMode = null) {
        return this._fetch(EP.chatSessions, {
            method: 'POST',
            body: JSON.stringify({ model, agentMode }),
        });
    }

    async listChatSessions() {
        return this._fetch(EP.chatSessions);
    }

    async getChatHistory(sessionId) {
        return this._fetch(EP.chatHistory(sessionId));
    }

    async sendChatMessage(sessionId, content, attachments, model) {
        return this._fetch(EP.chatMessages(sessionId), {
            method: 'POST',
            body: JSON.stringify({ content, attachments, model }),
            timeout: TIMEOUTS.CHAT_MESSAGE,
            retries: 0,
        });
    }

    async abortChat(sessionId) {
        return this._fetch(EP.chatAbort(sessionId), { method: 'POST', retries: 0 });
    }

    async deleteChatSession(sessionId) {
        return this._fetch(EP.chatSession(sessionId), { method: 'DELETE' });
    }

    // ─── Reports ────────────────────────────────────────────────
    async listReports() { return this._fetch(EP.reports); }
    async getReport(fileName) { return this._fetch(EP.report(encodeURIComponent(fileName))); }
    async getConsolidatedReport(params = {}) {
        const query = new URLSearchParams();
        if (params.since) query.set('since', params.since);
        if (params.runId) query.set('runId', params.runId);
        const qs = query.toString();
        return this._fetch(`${EP.consolidatedReport}${qs ? '?' + qs : ''}`);
    }

    // ─── Analytics ──────────────────────────────────────────────
    async getAnalyticsOverview() { return this._fetch(EP.analyticsOverview); }
    async getFailureTrends(limit = 50) { return this._fetch(`${EP.analyticsFailures}?limit=${limit}`); }
    async getSelectorData() { return this._fetch(EP.analyticsSelectors); }
    async getRunTrends() { return this._fetch(EP.analyticsRuns); }

    // ─── SSE Stream URLs ────────────────────────────────────────
    getPipelineStreamUrl(runId) {
        return `${this.baseUrl}${EP.pipelineStream(runId)}`;
    }

    getGlobalStreamUrl() {
        return `${this.baseUrl}${EP.pipelineStreamGlobal}`;
    }

    getChatStreamUrl(sessionId) {
        return `${this.baseUrl}${EP.chatStream(sessionId)}`;
    }
}

// Singleton instance
export const apiClient = new ApiClient();
export default apiClient;
