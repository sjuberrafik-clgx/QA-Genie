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
    'TimeoutError': 'Request timed out — the server may be busy processing',
    'AbortError': 'Request timed out — the server may be busy processing',
    'Load failed': `Backend unreachable — check if the server is running at ${API_CONFIG.baseUrl}`,
};

function friendlyError(err) {
    for (const [key, msg] of Object.entries(ERROR_MAP)) {
        if (err.name === key || err.message?.includes(key)) return new Error(msg);
    }
    return err;
}

function isAbortError(err) {
    return err?.name === 'AbortError'
        || err?.name === 'TimeoutError'
        || err?.code === 20
        || /aborted|abort/i.test(err?.message || '');
}

function createCombinedSignal(timeoutSignal, externalSignal) {
    if (!externalSignal) {
        return { signal: timeoutSignal, cleanup: () => { } };
    }

    if (timeoutSignal.aborted) {
        return { signal: timeoutSignal, cleanup: () => { } };
    }

    if (externalSignal.aborted) {
        return { signal: externalSignal, cleanup: () => { } };
    }

    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        return {
            signal: AbortSignal.any([timeoutSignal, externalSignal]),
            cleanup: () => { },
        };
    }

    const controller = new AbortController();

    const forwardAbort = (event) => {
        const source = event?.target;
        const reason = source?.reason
            || (source === timeoutSignal
                ? new DOMException('Request timed out', 'TimeoutError')
                : new DOMException('Request aborted', 'AbortError'));

        if (!controller.signal.aborted) {
            controller.abort(reason);
        }
    };

    timeoutSignal.addEventListener('abort', forwardAbort);
    externalSignal.addEventListener('abort', forwardAbort);

    return {
        signal: controller.signal,
        cleanup: () => {
            timeoutSignal.removeEventListener('abort', forwardAbort);
            externalSignal.removeEventListener('abort', forwardAbort);
        },
    };
}

class ApiClient {
    constructor(baseUrl = API_CONFIG.baseUrl) {
        this.baseUrl = baseUrl;
    }

    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const {
            timeout = TIMEOUTS.DEFAULT,
            retries = RETRY.DEFAULT_RETRIES,
            signal: externalSignal,
            headers,
            ...fetchOptions
        } = options;
        const maxRetries = retries;

        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const timeoutController = new AbortController();
            const timer = setTimeout(() => {
                timeoutController.abort(new DOMException('Request timed out', 'TimeoutError'));
            }, timeout);
            const { signal, cleanup } = createCombinedSignal(timeoutController.signal, externalSignal);

            try {
                const res = await fetch(url, {
                    headers: { 'Content-Type': 'application/json', ...headers },
                    ...fetchOptions,
                    signal,
                });

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    const error = new Error(body.error || `HTTP ${res.status}: ${res.statusText}`);
                    error.status = res.status;
                    if (body.code) error.code = body.code;
                    if (body.runtimeState) error.runtimeState = body.runtimeState;
                    if (typeof body.recoverable === 'boolean') error.recoverable = body.recoverable;
                    throw error;
                }
                return res.json();
            } catch (err) {
                if (err.message?.startsWith('HTTP ')) throw err;

                if (externalSignal?.aborted) {
                    throw err;
                }

                const timedOut = timeoutController.signal.aborted && !externalSignal?.aborted;
                lastError = timedOut
                    ? new DOMException('Request timed out', 'TimeoutError')
                    : err;

                if (attempt < maxRetries && !isAbortError(err)) {
                    await new Promise(r => setTimeout(r, RETRY.DELAY_MS));
                }
                if (attempt < maxRetries && timedOut) {
                    await new Promise(r => setTimeout(r, RETRY.DELAY_MS));
                }
                if (isAbortError(err) && !timedOut) {
                    throw err;
                }
            } finally {
                clearTimeout(timer);
                cleanup();
            }
        }
        throw friendlyError(lastError);
    }

    // ─── Health ─────────────────────────────────────────────────
    async health() { return this._fetch(EP.health, { retries: 0, timeout: TIMEOUTS.HEALTH }); }
    async ready() { return this._fetch(EP.ready, { retries: 0, timeout: TIMEOUTS.HEALTH }); }
    async getModelCatalog(refresh = false, options = {}) {
        const query = refresh ? '?refresh=true' : '';
        return this._fetch(`${EP.models}${query}`, {
            retries: 0,
            timeout: TIMEOUTS.HEALTH,
            ...options,
        });
    }

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

    async getPipelineEvidenceSummary(runId, limit = 12, options = {}) {
        const query = new URLSearchParams();
        if (limit) query.set('limit', String(limit));
        const qs = query.toString();
        return this._fetch(`${EP.pipelineEvidenceSummary(runId)}${qs ? `?${qs}` : ''}`, {
            timeout: TIMEOUTS.RUN_STATUS,
            ...options,
        });
    }

    getPipelineArtifactUrl(filePath, options = {}) {
        if (!filePath) return null;
        const query = new URLSearchParams({ path: filePath });
        query.set('disposition', options.download ? 'attachment' : 'inline');
        return `${this.baseUrl}${EP.pipelineArtifact}?${query.toString()}`;
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

    async getChatSessionStatus(sessionId) {
        return this._fetch(EP.chatStatus(sessionId), { retries: 0 });
    }

    async resumeChatSession(sessionId) {
        return this._fetch(EP.chatResume(sessionId), { method: 'POST', retries: 0 });
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

    /**
     * Submit a user's answer to a pending ask_user / ask_questions request.
     * @param {string} sessionId
     * @param {string} requestId - ID of the pending user-input request
     * @param {string|Object} answer - The user's answer text, or structured object (e.g., { username, password })
     */
    async submitUserInput(sessionId, requestId, answer) {
        return this._fetch(EP.chatUserInput(sessionId), {
            method: 'POST',
            body: JSON.stringify({ requestId, answer }),
            retries: 0,
        });
    }

    async deleteChatSession(sessionId) {
        return this._fetch(EP.chatSession(sessionId), { method: 'DELETE' });
    }

    // ─── Filesystem (FileGenie Directory Picker) ────────────────
    async browseDirectory(dirPath) {
        const qs = new URLSearchParams({ path: dirPath, dirsOnly: 'true' }).toString();
        return this._fetch(`${EP.filesystemBrowse}?${qs}`, { retries: 0 });
    }

    async getQuickAccess() {
        return this._fetch(EP.filesystemQuickAccess, { retries: 0 });
    }

    async pickDirectory() {
        return this._fetch(EP.filesystemPickDirectory, { method: 'POST', retries: 0, timeout: 65000 });
    }

    async openFileInNativeApp(filePath) {
        return this._fetch(EP.filesystemOpenFile, {
            method: 'POST',
            body: JSON.stringify({ path: filePath }),
            retries: 0,
        });
    }

    async openFolderInNativeApp(filePath) {
        return this._fetch(EP.filesystemOpenFolder, {
            method: 'POST',
            body: JSON.stringify({ path: filePath }),
            retries: 0,
        });
    }

    async setWorkspaceRoot(sessionId, dirPath) {
        return this._fetch(EP.chatWorkspaceRoot(sessionId), {
            method: 'POST',
            body: JSON.stringify({ path: dirPath }),
            retries: 0,
        });
    }

    async getWorkspaceRoot(sessionId) {
        return this._fetch(EP.chatWorkspaceRoot(sessionId), { retries: 0 });
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
export { isAbortError };
export default apiClient;
