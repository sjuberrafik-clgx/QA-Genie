/**
 * API Configuration — Backend SDK Server Connection
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3100';

/**
 * Resolve a server-relative path (e.g. an attachment URL returned in chat
 * history/SSE) to an absolute URL against the backend origin. Pass-through for
 * already-absolute URLs (http/https/data/blob) and empty values. Used so chat
 * image attachments — now served on demand instead of inlined as base64 — load
 * from the backend regardless of the browser origin.
 */
export function resolveBackendUrl(p) {
    if (typeof p !== 'string' || p.length === 0) return p;
    if (/^(https?:|data:|blob:)/i.test(p)) return p;
    if (p.startsWith('/')) return `${BACKEND_URL}${p}`;
    return p;
}

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
        pipelineCommandOutput: (runId) => `/api/pipeline/command-output/${runId}`,
        pipelineEvidenceSummary: (runId) => `/api/pipeline/evidence-summary/${runId}`,
        pipelineArtifact: '/api/pipeline/artifact',
        pipelineStream: (runId) => `/api/pipeline/stream/${runId}`,
        pipelineStreamGlobal: '/api/pipeline/stream',

        // Terminal
        terminalSessions: '/api/terminal/sessions',
        terminalSession: (sessionId) => `/api/terminal/sessions/${sessionId}`,
        terminalSessionOutput: (sessionId) => `/api/terminal/sessions/${sessionId}/output`,
        terminalSessionInput: (sessionId) => `/api/terminal/sessions/${sessionId}/input`,
        terminalSessionCommand: (sessionId) => `/api/terminal/sessions/${sessionId}/command`,
        terminalSessionResize: (sessionId) => `/api/terminal/sessions/${sessionId}/resize`,
        terminalSessionTerminate: (sessionId) => `/api/terminal/sessions/${sessionId}/terminate`,
        terminalWs: '/api/terminal/ws',

        // Chat
        chatAgents: '/api/chat/agents',
        chatSessions: '/api/chat/sessions',
        chatSession: (id) => `/api/chat/sessions/${id}`,
        chatStatus: (id) => `/api/chat/sessions/${id}/status`,
        chatResume: (id) => `/api/chat/sessions/${id}/resume`,
        chatMessages: (id) => `/api/chat/sessions/${id}/messages`,
        chatStream: (id) => `/api/chat/sessions/${id}/stream`,
        chatHistory: (id) => `/api/chat/sessions/${id}/history`,
        chatAbort: (id) => `/api/chat/sessions/${id}/abort`,
        chatUserInput: (id) => `/api/chat/sessions/${id}/user-input`,
        chatWorkspaceRoot: (id) => `/api/chat/sessions/${id}/workspace-root`,
        chatUploadVideo: '/api/chat/upload-video',

        // Studio
        studioWorkspaces: '/api/studio/workspaces',
        studioWorkspaceCatalog: (id) => `/api/studio/workspaces/${id}/catalog`,
        studioWorkspaceTree: (id) => `/api/studio/workspaces/${id}/tree`,
        studioWorkspaceAssets: (id) => `/api/studio/workspaces/${id}/assets`,
        studioWorkspaceFile: (id) => `/api/studio/workspaces/${id}/file`,
        studioWorkspaceAgentPublish: (workspaceId, agentId) => `/api/studio/workspaces/${workspaceId}/agents/${agentId}/publish`,
        studioWorkspaceAgentActivation: (workspaceId, agentId) => `/api/studio/workspaces/${workspaceId}/agents/${agentId}/activation`,
        studioWorkspaceDelete: (id) => `/api/studio/workspaces/${id}`,
        studioWorkspaceAgentDelete: (workspaceId, agentId) => `/api/studio/workspaces/${workspaceId}/agents/${agentId}`,
        studioWorkspaceSkillDelete: (workspaceId, skillId) => `/api/studio/workspaces/${workspaceId}/skills/${skillId}`,
        studioWorkspaceSkill: (workspaceId, skillId) => `/api/studio/workspaces/${workspaceId}/skills/${skillId}`,
        studioWorkspaceSkillValidate: (workspaceId, skillId) => `/api/studio/workspaces/${workspaceId}/skills/${skillId}/validate`,
        studioWorkspaceSkillAutoFix: (workspaceId, skillId) => `/api/studio/workspaces/${workspaceId}/skills/${skillId}/auto-fix-format`,
        studioSkillTestMatch: '/api/studio/skills/test-match',
        studioWorkspaceMcpDelete: (workspaceId, mcpId) => `/api/studio/workspaces/${workspaceId}/mcp-servers/${mcpId}`,
        studioWorkspaceFileDelete: (id) => `/api/studio/workspaces/${id}/file`,
        studioGenerateDescription: '/api/studio/generate-description',
        studioCapabilityProfiles: '/api/studio/capability-profiles',

        // Studio — Templates
        studioTemplates: '/api/studio/templates',
        studioTemplate: (id) => `/api/studio/templates/${id}`,
        studioTemplateFork: (id) => `/api/studio/templates/${id}/fork`,

        // Studio — Export / Import
        studioAgentExport: (workspaceId, agentId) => `/api/studio/workspaces/${workspaceId}/agents/${agentId}/export`,
        studioImportAgent: '/api/studio/import-agent',
        studioExportFormats: '/api/studio/export-formats',

        // Studio — MCP Registry
        studioMcpRegistry: '/api/studio/mcp-registry',
        studioMcpRegistryServer: (id) => `/api/studio/mcp-registry/${id}`,
        studioMcpRegistryTest: '/api/studio/mcp-registry/test',

        // Studio — Agent Validation
        studioAgentValidate: (workspaceId, agentId) => `/api/studio/workspaces/${workspaceId}/agents/${agentId}/validate`,

        // Studio — Analytics
        studioAnalytics: '/api/studio/analytics',
        studioAnalyticsAgent: (agentId) => `/api/studio/analytics/${agentId}`,
        studioAnalyticsRecord: '/api/studio/analytics/record',

        // Filesystem (FileGenie directory picker)
        filesystemBrowse: '/api/filesystem/browse',
        filesystemQuickAccess: '/api/filesystem/quick-access',
        filesystemPickDirectory: '/api/filesystem/pick-directory',
        filesystemOpenFile: '/api/filesystem/open-file',
        filesystemOpenFolder: '/api/filesystem/open-folder',

        // Reports (per-execution Playwright test results)
        reports: '/api/reports',
        report: (fileName) => `/api/reports/${fileName}`,
        consolidatedReport: '/api/reports/consolidated',

        // Scheduler (one-time scheduled actions)
        schedulerJobs: '/api/scheduler/jobs',
        schedulerJob: (jobId) => `/api/scheduler/jobs/${jobId}`,
        schedulerJobRunNow: (jobId) => `/api/scheduler/jobs/${jobId}/run-now`,
    },
};
