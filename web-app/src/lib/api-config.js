/**
 * API Configuration — Backend SDK Server Connection
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3100';

export const API_CONFIG = {
    baseUrl: BACKEND_URL,
    endpoints: {
        // Health
        health: '/health',
        ready: '/ready',
        models: '/api/models',

        // Pipeline
        pipelineRun: '/api/pipeline/run',
        pipelineBatch: '/api/pipeline/batch',
        pipelineCancel: (runId) => `/api/pipeline/cancel/${runId}`,
        pipelineForceCancel: (runId) => `/api/pipeline/force-cancel/${runId}`,
        pipelineRuns: '/api/pipeline/runs',
        pipelineStatus: (runId) => `/api/pipeline/status/${runId}`,
        pipelineStream: (runId) => `/api/pipeline/stream/${runId}`,
        pipelineStreamGlobal: '/api/pipeline/stream',

        // Chat
        chatSessions: '/api/chat/sessions',
        chatSession: (id) => `/api/chat/sessions/${id}`,
        chatMessages: (id) => `/api/chat/sessions/${id}/messages`,
        chatStream: (id) => `/api/chat/sessions/${id}/stream`,
        chatHistory: (id) => `/api/chat/sessions/${id}/history`,
        chatAbort: (id) => `/api/chat/sessions/${id}/abort`,
        chatUserInput: (id) => `/api/chat/sessions/${id}/user-input`,
        chatWorkspaceRoot: (id) => `/api/chat/sessions/${id}/workspace-root`,
        chatUploadVideo: '/api/chat/upload-video',

        // Filesystem (FileGenie directory picker)
        filesystemBrowse: '/api/filesystem/browse',
        filesystemQuickAccess: '/api/filesystem/quick-access',
        filesystemPickDirectory: '/api/filesystem/pick-directory',

        // Reports (per-execution Playwright test results)
        reports: '/api/reports',
        report: (fileName) => `/api/reports/${fileName}`,
        consolidatedReport: '/api/reports/consolidated',
    },
};
