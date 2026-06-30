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

    async listChatAgents(options = {}) {
        const params = new URLSearchParams();
        if (options.includeInactive) params.set('includeInactive', 'true');
        if (options.includeDraft) params.set('includeDraft', 'true');
        const qs = params.toString();
        const url = qs ? `${EP.chatAgents}?${qs}` : EP.chatAgents;
        return this._fetch(url, { retries: 0, timeout: TIMEOUTS.HEALTH });
    }

    // ─── Pipeline ───────────────────────────────────────────────
    async startPipeline(identifier, mode = 'full', environment = 'UAT', model = 'gpt-4o', options = {}) {
        const payload = {
            mode,
            environment,
            model,
            triggeredBy: 'web-app',
        };

        const normalizedIdentifier = typeof identifier === 'string' ? identifier.trim() : '';
        const normalizedTicketId = typeof options.ticketId === 'string' ? options.ticketId.trim() : '';
        const normalizedRunId = typeof options.runId === 'string' ? options.runId.trim() : '';

        if (normalizedTicketId) {
            payload.ticketId = normalizedTicketId;
        }
        if (normalizedRunId) {
            payload.runId = normalizedRunId;
        }

        if (!payload.ticketId && !payload.runId) {
            if (options.identifierType === 'custom') {
                payload.runId = normalizedIdentifier;
            } else {
                payload.ticketId = normalizedIdentifier;
            }
        }

        if (typeof options.frameworkMode === 'string' && options.frameworkMode.trim()) {
            payload.frameworkMode = options.frameworkMode.trim();
        }

        if (typeof options.appUrl === 'string' && options.appUrl.trim()) {
            payload.appUrl = options.appUrl.trim();
        }

        if (typeof options.testCaseSource === 'string' && options.testCaseSource.trim()) {
            payload.testCaseSource = options.testCaseSource.trim();
        }

        if (options.testDataOverride !== undefined) {
            payload.testDataOverride = options.testDataOverride;
        }

        if (typeof options.executionTarget === 'string' && options.executionTarget.trim()) {
            payload.executionTarget = options.executionTarget.trim();
        }

        if (options.mission && typeof options.mission === 'object') {
            payload.mission = options.mission;
        }

        return this._fetch(EP.pipelineRun, {
            method: 'POST',
            body: JSON.stringify(payload),
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

    async getPipelineCommandOutput(runId, limit = 300, options = {}) {
        const query = new URLSearchParams();
        if (limit) query.set('limit', String(limit));
        if (Number.isFinite(options.sinceSeq)) query.set('since', String(options.sinceSeq));
        if (Array.isArray(options.kinds) && options.kinds.length > 0) {
            query.set('kinds', options.kinds.join(','));
        }
        const qs = query.toString();
        const { sinceSeq: _sinceSeq, kinds: _kinds, ...fetchOptions } = options;
        return this._fetch(`${EP.pipelineCommandOutput(runId)}${qs ? `?${qs}` : ''}`, {
            timeout: TIMEOUTS.RUN_STATUS,
            ...fetchOptions,
        });
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

    // ─── Terminal Sessions ─────────────────────────────────────
    async listTerminalSessions() {
        return this._fetch(EP.terminalSessions, { retries: 0, timeout: TIMEOUTS.RUN_STATUS });
    }

    async createTerminalSession(options = {}) {
        return this._fetch(EP.terminalSessions, {
            method: 'POST',
            body: JSON.stringify(options),
            retries: 0,
            timeout: TIMEOUTS.PIPELINE_START,
        });
    }

    async getTerminalSession(sessionId) {
        return this._fetch(EP.terminalSession(sessionId), { retries: 0, timeout: TIMEOUTS.RUN_STATUS });
    }

    async getTerminalSessionOutput(sessionId, limit = 300) {
        const query = new URLSearchParams();
        if (limit) query.set('limit', String(limit));
        const qs = query.toString();
        return this._fetch(`${EP.terminalSessionOutput(sessionId)}${qs ? `?${qs}` : ''}`, {
            retries: 0,
            timeout: TIMEOUTS.RUN_STATUS,
        });
    }

    async sendTerminalInput(sessionId, input, options = {}) {
        return this._fetch(EP.terminalSessionInput(sessionId), {
            method: 'POST',
            body: JSON.stringify({
                input,
                appendNewline: options.appendNewline === true,
            }),
            headers: options.token ? { 'X-Terminal-Token': options.token } : undefined,
            retries: 0,
        });
    }

    async sendTerminalCommand(sessionId, command, options = {}) {
        return this._fetch(EP.terminalSessionCommand(sessionId), {
            method: 'POST',
            body: JSON.stringify({ command }),
            headers: options.token ? { 'X-Terminal-Token': options.token } : undefined,
            retries: 0,
        });
    }

    async resizeTerminalSession(sessionId, cols, rows, options = {}) {
        return this._fetch(EP.terminalSessionResize(sessionId), {
            method: 'POST',
            body: JSON.stringify({ cols, rows }),
            headers: options.token ? { 'X-Terminal-Token': options.token } : undefined,
            retries: 0,
        });
    }

    async terminateTerminalSession(sessionId, options = {}) {
        return this._fetch(EP.terminalSessionTerminate(sessionId), {
            method: 'POST',
            body: JSON.stringify({
                force: options.force !== false,
                reason: options.reason,
            }),
            headers: options.token ? { 'X-Terminal-Token': options.token } : undefined,
            retries: 0,
        });
    }

    // ─── Chat ───────────────────────────────────────────────────
    async createChatSession(model, agentId = null, agentMode = null) {
        return this._fetch(EP.chatSessions, {
            method: 'POST',
            body: JSON.stringify({ model, agentId, agentMode }),
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

    // ─── Studio ────────────────────────────────────────────────
    async listStudioWorkspaces() {
        return this._fetch(EP.studioWorkspaces, { retries: 0 });
    }

    async createStudioWorkspace(payload) {
        return this._fetch(EP.studioWorkspaces, {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async getStudioWorkspaceCatalog(workspaceId) {
        return this._fetch(EP.studioWorkspaceCatalog(workspaceId), { retries: 0 });
    }

    async getStudioWorkspaceTree(workspaceId, depth = 4) {
        const query = new URLSearchParams({ depth: String(depth) }).toString();
        return this._fetch(`${EP.studioWorkspaceTree(workspaceId)}?${query}`, { retries: 0 });
    }

    async createStudioAsset(workspaceId, payload) {
        return this._fetch(EP.studioWorkspaceAssets(workspaceId), {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async generateStudioDescription(payload) {
        return this._fetch(EP.studioGenerateDescription, {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async listStudioCapabilityProfiles() {
        return this._fetch(EP.studioCapabilityProfiles, { retries: 0 });
    }

    async publishStudioAgent(workspaceId, agentId, options = {}) {
        return this._fetch(EP.studioWorkspaceAgentPublish(workspaceId, agentId), {
            method: 'POST',
            body: JSON.stringify(options),
            retries: 0,
        });
    }

    async setStudioAgentActivation(workspaceId, agentId, active) {
        return this._fetch(EP.studioWorkspaceAgentActivation(workspaceId, agentId), {
            method: 'POST',
            body: JSON.stringify({ active }),
            retries: 0,
        });
    }

    async getStudioWorkspaceFile(workspaceId, filePath) {
        const query = new URLSearchParams({ path: filePath }).toString();
        return this._fetch(`${EP.studioWorkspaceFile(workspaceId)}?${query}`, { retries: 0 });
    }

    async saveStudioWorkspaceFile(workspaceId, payload) {
        return this._fetch(EP.studioWorkspaceFile(workspaceId), {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async deleteStudioWorkspace(workspaceId, { force = false } = {}) {
        const query = force ? `?${new URLSearchParams({ force: 'true' }).toString()}` : '';
        return this._fetch(`${EP.studioWorkspaceDelete(workspaceId)}${query}`, {
            method: 'DELETE',
            retries: 0,
        });
    }

    async deleteStudioAgent(workspaceId, agentId) {
        return this._fetch(EP.studioWorkspaceAgentDelete(workspaceId, agentId), {
            method: 'DELETE',
            retries: 0,
        });
    }

    async deleteStudioSkill(workspaceId, skillId) {
        return this._fetch(EP.studioWorkspaceSkillDelete(workspaceId, skillId), {
            method: 'DELETE',
            retries: 0,
        });
    }

    async getStudioSkill(workspaceId, skillId) {
        return this._fetch(EP.studioWorkspaceSkill(workspaceId, skillId), { retries: 0 });
    }

    async updateStudioSkill(workspaceId, skillId, payload) {
        return this._fetch(EP.studioWorkspaceSkill(workspaceId, skillId), {
            method: 'PUT',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async validateStudioSkill(workspaceId, skillId) {
        return this._fetch(EP.studioWorkspaceSkillValidate(workspaceId, skillId), {
            method: 'POST',
            retries: 0,
        });
    }

    async autoFixSkillFormat(workspaceId, skillId) {
        return this._fetch(EP.studioWorkspaceSkillAutoFix(workspaceId, skillId), {
            method: 'POST',
            retries: 0,
        });
    }

    async testSkillMatch(message, activeAgent = null) {
        return this._fetch(EP.studioSkillTestMatch, {
            method: 'POST',
            body: JSON.stringify({ message, activeAgent }),
            retries: 0,
        });
    }

    async deleteStudioMcpServer(workspaceId, mcpId) {
        return this._fetch(EP.studioWorkspaceMcpDelete(workspaceId, mcpId), {
            method: 'DELETE',
            retries: 0,
        });
    }

    async deleteStudioWorkspaceFile(workspaceId, filePath) {
        const query = new URLSearchParams({ path: filePath }).toString();
        return this._fetch(`${EP.studioWorkspaceFileDelete(workspaceId)}?${query}`, {
            method: 'DELETE',
            retries: 0,
        });
    }

    // ─── Studio — Templates ────────────────────────────────────
    async listStudioTemplates(options = {}) {
        const query = new URLSearchParams();
        if (options.category) query.set('category', options.category);
        if (options.search) query.set('search', options.search);
        if (options.source) query.set('source', options.source);
        const qs = query.toString();
        return this._fetch(`${EP.studioTemplates}${qs ? '?' + qs : ''}`, { retries: 0 });
    }

    async getStudioTemplate(templateId) {
        return this._fetch(EP.studioTemplate(templateId), { retries: 0 });
    }

    async createStudioTemplate(payload) {
        return this._fetch(EP.studioTemplates, {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async forkStudioTemplate(templateId, overrides = {}) {
        return this._fetch(EP.studioTemplateFork(templateId), {
            method: 'POST',
            body: JSON.stringify(overrides),
            retries: 0,
        });
    }

    async deleteStudioTemplate(templateId) {
        return this._fetch(EP.studioTemplate(templateId), {
            method: 'DELETE',
            retries: 0,
        });
    }

    // ─── Studio — Export / Import ──────────────────────────────
    async exportStudioAgent(workspaceId, agentId, format = 'json') {
        const query = new URLSearchParams({ format }).toString();
        return this._fetch(`${EP.studioAgentExport(workspaceId, agentId)}?${query}`, { retries: 0 });
    }

    async importStudioAgent(payload) {
        return this._fetch(EP.studioImportAgent, {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    async getStudioExportFormats() {
        return this._fetch(EP.studioExportFormats, { retries: 0 });
    }

    // ─── Studio — MCP Registry ─────────────────────────────────
    async listMcpRegistry(options = {}) {
        const query = new URLSearchParams();
        if (options.category) query.set('category', options.category);
        const qs = query.toString();
        return this._fetch(`${EP.studioMcpRegistry}${qs ? '?' + qs : ''}`, { retries: 0 });
    }

    async getMcpRegistryServer(serverId) {
        return this._fetch(EP.studioMcpRegistryServer(serverId), { retries: 0 });
    }

    async testMcpConnection(payload) {
        return this._fetch(EP.studioMcpRegistryTest, {
            method: 'POST',
            body: JSON.stringify(payload),
            retries: 0,
        });
    }

    // ─── Studio — Agent Validation ─────────────────────────────
    async validateStudioAgent(workspaceId, agentId) {
        return this._fetch(EP.studioAgentValidate(workspaceId, agentId), {
            method: 'POST',
            retries: 0,
        });
    }

    // ─── Studio — Analytics ────────────────────────────────────
    async getStudioAnalytics() {
        return this._fetch(EP.studioAnalytics, { retries: 0 });
    }

    async getStudioAgentAnalytics(agentId) {
        return this._fetch(EP.studioAnalyticsAgent(agentId), { retries: 0 });
    }

    async recordStudioAnalyticsEvent(event) {
        return this._fetch(EP.studioAnalyticsRecord, {
            method: 'POST',
            body: JSON.stringify(event),
            retries: 0,
        });
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

    getTerminalWebSocketUrl(sessionId, options = {}) {
        const base = new URL(this.baseUrl);
        base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
        base.pathname = EP.terminalWs;
        const params = new URLSearchParams({ sessionId });
        if (typeof options.token === 'string' && options.token) {
            params.set('token', options.token);
        }
        base.search = params.toString();
        return base.toString();
    }
}

// Singleton instance
export const apiClient = new ApiClient();
export { isAbortError };
export default apiClient;
