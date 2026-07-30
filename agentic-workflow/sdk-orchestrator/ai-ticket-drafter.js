/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AI TICKET DRAFTER — Draft-Only Agent Run for Scheduled Ticket Creation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Runs BugGenie (bugs) or TaskGenie (tasks) in a DRAFT-ONLY mode: the agent
 * composes a complete Jira ticket from a natural-language prompt plus optional
 * screenshots/recording, then calls the `propose_jira_ticket` tool. The resolved
 * fields are captured and returned for human review — NOTHING is written to Jira.
 *
 * Guarantees the run cannot mutate Jira:
 *   1. All Jira/Confluence write tools are removed from the tool set.
 *   2. `create_jira_ticket` is replaced by `propose_jira_ticket` (no network I/O).
 *   3. `chatManager` is null, so any residual gated write fails closed.
 *
 * The actual creation is deferred to the scheduler's `jira.ai-create` action,
 * which fires at the scheduled time after the human approved the draft.
 *
 * @module sdk-orchestrator/ai-ticket-drafter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createCustomTools } = require('./custom-tools');
const { createProposeJiraTicketTool, DRAFT_EXCLUDED_TOOL_NAMES } = require('./tools/propose-jira-ticket-tool');

const AGENT_BY_ISSUE_TYPE = { bug: 'buggenie', task: 'taskgenie' };
const VALID_DRAFT_AGENTS = new Set(['buggenie', 'taskgenie']);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AI_DRAFT_TIMEOUT_MS, 10) || 180000;
const MAX_SDK_VIDEO_FRAMES = 8;

const IMAGE_EXT_BY_MIME = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function toolName(tool) {
    return tool?.name || tool?.definition?.name || '';
}

/**
 * Resolve the agent name for a given issue type / explicit agent choice.
 * @param {string} [agent]     - Explicit agent ('buggenie' | 'taskgenie')
 * @param {string} [issueType] - Issue type ('Bug' | 'Task' | ...)
 * @returns {string|null}
 */
function resolveAgent(agent, issueType) {
    if (isNonEmptyString(agent) && VALID_DRAFT_AGENTS.has(agent.trim().toLowerCase())) {
        return agent.trim().toLowerCase();
    }
    const key = isNonEmptyString(issueType) ? issueType.trim().toLowerCase() : 'bug';
    return AGENT_BY_ISSUE_TYPE[key] || 'buggenie';
}

class AiTicketDrafter {
    /**
     * @param {Object} deps
     * @param {Function} deps.getFactory - async () => AgentSessionFactory
     * @param {Function} [deps.logger]   - (message, level) => void
     */
    constructor({ getFactory, logger } = {}) {
        if (typeof getFactory !== 'function') {
            throw new Error('AiTicketDrafter requires a getFactory function.');
        }
        this.getFactory = getFactory;
        this.log = typeof logger === 'function' ? logger : () => {};
    }

    /**
     * Generate an AI ticket draft. Never writes to Jira.
     *
     * @param {Object} params
     * @param {string} [params.agent]          - 'buggenie' | 'taskgenie'
     * @param {string} [params.issueType]      - 'Bug' | 'Task' | ...
     * @param {string} [params.projectKey]
     * @param {string} params.prompt           - Natural-language description of the issue/task
     * @param {string} [params.priority]
     * @param {string} [params.linkedIssueKey] - Parent/related ticket for linked Testing tasks
     * @param {string} [params.parentIssueKey] - Parent for a true subtask
     * @param {Object[]} [params.attachments]  - [{ type:'image', media_type, data }, { type:'video', tempPath, media_type, filename }]
     * @param {number} [params.timeoutMs]
     * @returns {Promise<Object>} { ok, draftId, agent, draft, agentResponse } or { ok:false, error, agentResponse }
     */
    async generateDraft(params = {}) {
        const {
            agent, issueType, projectKey, prompt, priority,
            linkedIssueKey, parentIssueKey, attachments, timeoutMs,
        } = params;

        if (!isNonEmptyString(prompt)) {
            return { ok: false, error: 'A prompt describing the issue or task is required.' };
        }

        const resolvedAgent = resolveAgent(agent, issueType);
        let factory;
        try {
            factory = await this.getFactory();
        } catch (err) {
            return { ok: false, error: err.message || 'Agent session factory is not available yet. Try again in a moment.' };
        }
        if (!factory) {
            return { ok: false, error: 'Agent session factory is not available yet. Try again in a moment.' };
        }

        const draftId = `draft_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

        // ── Build the draft-only tool set: role tools minus writes, plus propose ──
        let capturedDraft = null;
        const toolDeps = {
            config: factory.config,
            learningStore: factory.learningStore || null,
            contextStore: null,
            groundingStore: factory._groundingStore || null,
        };
        const baseTools = createCustomTools(factory.defineTool, resolvedAgent, toolDeps)
            .filter(t => !DRAFT_EXCLUDED_TOOL_NAMES.has(toolName(t)));
        const proposeTool = createProposeJiraTicketTool(factory.defineTool, (draft) => { capturedDraft = draft; });
        const toolsOverride = [...baseTools, proposeTool];

        // ── Convert attachments into SDK file attachments (images + video frames) ──
        const { sdkAttachments, tempFiles, videoContextPrompt } = await this._buildSdkAttachments(attachments);

        let sessionId = null;
        let agentResponse = '';
        try {
            const sessionInfo = await factory.createAgentSession(resolvedAgent, {
                toolsOverride,
                chatManager: null,
                disableMCP: true,
                disableBroker: true,
                ticketId: parentIssueKey || linkedIssueKey || null,
                taskDescription: prompt,
            });
            sessionId = sessionInfo.sessionId;

            const fullPrompt = this._buildDirectivePrompt({
                issueType, prompt, resolvedAgent, linkedIssueKey, parentIssueKey, videoContextPrompt,
            });

            this.log(`[AiDraft] ${resolvedAgent} drafting (${sdkAttachments.length} attachment(s), draftId=${draftId})`, 'info');
            agentResponse = await factory.sendAndWait(sessionInfo.session, fullPrompt, {
                timeout: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
                attachments: sdkAttachments,
            });
        } catch (err) {
            this.log(`[AiDraft] Draft run failed: ${err.message}`, 'error');
            return { ok: false, error: `Draft generation failed: ${err.message}`, agentResponse };
        } finally {
            this._cleanupTempFiles(tempFiles);
            if (sessionId) {
                try { await factory.destroySession(sessionId); } catch { /* best-effort */ }
            }
        }

        if (!capturedDraft) {
            return {
                ok: false,
                error: 'The agent did not produce a ticket draft. Try rephrasing the request or adding more detail.',
                agentResponse,
            };
        }

        // Merge agent-proposed fields with request context / sensible defaults.
        const draft = {
            projectKey: capturedDraft.projectKey || (isNonEmptyString(projectKey) ? projectKey.trim() : null),
            issueType: capturedDraft.issueType || (isNonEmptyString(issueType) ? issueType.trim() : (resolvedAgent === 'taskgenie' ? 'Task' : 'Bug')),
            summary: capturedDraft.summary,
            description: capturedDraft.description,
            priority: capturedDraft.priority || (isNonEmptyString(priority) ? priority.trim() : 'Medium'),
            labels: Array.isArray(capturedDraft.labels) ? capturedDraft.labels : [],
            environment: capturedDraft.environment || null,
            linkedIssueKey: capturedDraft.linkedIssueKey || (isNonEmptyString(linkedIssueKey) ? linkedIssueKey.trim() : null),
            parentIssueKey: capturedDraft.parentIssueKey || (isNonEmptyString(parentIssueKey) ? parentIssueKey.trim() : null),
            linkType: capturedDraft.linkType || null,
            assigneeAccountId: capturedDraft.assigneeAccountId || null,
        };

        this.log(`[AiDraft] Draft ready (${draft.issueType}: ${draft.summary})`, 'info');
        return { ok: true, draftId, agent: resolvedAgent, draft, agentResponse };
    }

    /**
     * Build the draft-mode directive prompt sent to the agent.
     * @private
     */
    _buildDirectivePrompt({ issueType, prompt, resolvedAgent, linkedIssueKey, parentIssueKey, videoContextPrompt }) {
        const typeLabel = isNonEmptyString(issueType) ? issueType.trim() : (resolvedAgent === 'taskgenie' ? 'Task' : 'Bug');
        const lines = [
            `You are operating in DRAFT MODE for a SCHEDULED Jira ticket.`,
            `Compose a complete, high-quality ${typeLabel} ticket based on the request below and any attached screenshots or recording frames.`,
            `When the ticket is fully composed, call the propose_jira_ticket tool EXACTLY ONCE with all fields (summary, description, issueType, priority${resolvedAgent === 'taskgenie' ? ', linkedIssueKey, assigneeAccountId' : ''}).`,
            ``,
            `CRITICAL: Do NOT create the ticket. The create_jira_ticket tool is intentionally unavailable. propose_jira_ticket only records a draft for human review — the ticket will be created later, at a scheduled time, after a person approves it.`,
        ];
        if (resolvedAgent === 'taskgenie' && isNonEmptyString(linkedIssueKey)) {
            lines.push(
                ``,
                `This is a linked Testing task. Set linkedIssueKey to "${linkedIssueKey.trim()}" and assign it to the current user (resolve your accountId with get_jira_current_user).`
            );
        }
        if (resolvedAgent === 'taskgenie' && isNonEmptyString(parentIssueKey)) {
            lines.push(``, `Create this under parent "${parentIssueKey.trim()}" (set parentIssueKey).`);
        }
        lines.push(``, `Request:`, prompt.trim());
        if (isNonEmptyString(videoContextPrompt)) {
            lines.push(``, videoContextPrompt.trim());
        }
        return lines.join('\n');
    }

    /**
     * Convert frontend attachments into SDK file attachments. Images are decoded
     * to temp files; videos are frame-sampled via the VideoAnalyzer. Returns the
     * SDK attachments, the temp files to clean up, and a video-context prompt.
     * @private
     */
    async _buildSdkAttachments(attachments) {
        const sdkAttachments = [];
        const tempFiles = [];
        let videoContextPrompt = '';

        if (!Array.isArray(attachments) || attachments.length === 0) {
            return { sdkAttachments, tempFiles, videoContextPrompt };
        }

        const tempDir = os.tmpdir();
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i] || {};
            try {
                if (att.type === 'image' && isNonEmptyString(att.data)) {
                    const ext = IMAGE_EXT_BY_MIME[att.media_type] || '.png';
                    const filePath = path.join(tempDir, `aidraft-img-${Date.now()}-${i}${ext}`);
                    fs.writeFileSync(filePath, Buffer.from(att.data, 'base64'));
                    tempFiles.push(filePath);
                    sdkAttachments.push({ type: 'file', path: filePath, displayName: `attachment-${i + 1}${ext}` });
                } else if (att.type === 'video' && isNonEmptyString(att.tempPath) && fs.existsSync(att.tempPath)) {
                    const { createVideoAnalyzer } = require('./video-analyzer');
                    const analyzer = createVideoAnalyzer();
                    const result = await analyzer.buildVideoContext(att.tempPath);
                    if (result?.frames?.length) {
                        // Track every extracted frame (SDK + high-res) for cleanup.
                        for (const frame of result.frames) tempFiles.push(frame.path);
                        const sdkFrames = (result.sdkFrames && result.sdkFrames.length > 0) ? result.sdkFrames : result.frames;
                        for (const sf of sdkFrames) tempFiles.push(sf.path);

                        const sampled = this._sampleFrames(sdkFrames, MAX_SDK_VIDEO_FRAMES);
                        for (const frame of sampled) {
                            sdkAttachments.push({ type: 'file', path: frame.path, displayName: `video-frame-${frame.timestamp}s.jpg` });
                        }
                        if (isNonEmptyString(result.contextPrompt)) {
                            videoContextPrompt += (videoContextPrompt ? '\n\n' : '') + result.contextPrompt;
                        }
                        this.log(`[AiDraft] Sampled ${sampled.length}/${sdkFrames.length} frames from recording`, 'info');
                    }
                }
            } catch (err) {
                this.log(`[AiDraft] Attachment ${i} skipped: ${err.message}`, 'warn');
            }
        }

        return { sdkAttachments, tempFiles, videoContextPrompt };
    }

    /**
     * Sample up to `max` frames (first + last + evenly spaced) for the model.
     * @private
     */
    _sampleFrames(frames, max) {
        if (!Array.isArray(frames) || frames.length <= max) return frames || [];
        const sampled = [frames[0]];
        const inner = max - 2;
        const step = (frames.length - 2) / (inner + 1);
        for (let k = 1; k <= inner; k++) {
            const idx = Math.min(Math.round(step * k), frames.length - 2);
            if (idx > 0) sampled.push(frames[idx]);
        }
        sampled.push(frames[frames.length - 1]);
        return sampled;
    }

    /** @private */
    _cleanupTempFiles(tempFiles) {
        if (!Array.isArray(tempFiles)) return;
        for (const fp of tempFiles) {
            try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* best-effort */ }
        }
    }
}

module.exports = {
    AiTicketDrafter,
    resolveAgent,
    VALID_DRAFT_AGENTS,
};
