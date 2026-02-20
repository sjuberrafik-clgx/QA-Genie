/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUPERVISOR SESSION — Persistent Pipeline Overseer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A long-lived AI session that oversees the full pipeline run. Unlike the
 * specialist agent sessions (testgenie, scriptgenerator, etc.) which are
 * created/destroyed per stage, the supervisor persists throughout the entire
 * run and maintains conversational memory across all stages.
 *
 * Responsibilities:
 *   1. Pre-stage briefing — reviews context and guides each specialist agent
 *   2. Post-stage review — evaluates outputs and decides if intervention needed
 *   3. Cross-stage reasoning — identifies patterns spanning multiple stages
 *   4. Escalation handling — makes informed decisions when quality gates fail
 *   5. Final run summary — produces an audit trail of the complete pipeline
 *
 * The supervisor does NOT replace the specialist agents — it coordinates them.
 * Think of it as a QA lead who reviews work, asks questions, and redirects
 * when things go off track.
 *
 * @module sdk-orchestrator/supervisor-session
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { loadAgentPrompt } = require('./agent-sessions');

// ─── Supervisor Prompt ──────────────────────────────────────────────────────

const SUPERVISOR_SYSTEM_PROMPT = `
You are the Pipeline Supervisor — a senior QA engineering lead overseeing an automated test generation pipeline.

## Your Role
You do NOT generate test cases or write automation scripts yourself. Instead, you:
- Review intermediate outputs from specialist agents (TestGenie, ScriptGenerator, BugGenie)
- Identify quality issues, missing coverage, or strategic mistakes BEFORE they cascade
- Provide concise, actionable guidance that shapes downstream agent behavior
- Make routing decisions when the pipeline hits ambiguity or failures

## Communication Style
- Be concise — your responses are injected into other agents' context windows
- Be actionable — say exactly what needs to change, not vague suggestions
- Be decisional — choose ONE path when there are multiple options
- Reference specific test steps, selectors, or code patterns by name

## Tools Available
You have shared context tools to read/write the pipeline's knowledge store:
- write_shared_context: Record your decisions, constraints, and notes
- read_shared_context: Query what other agents have done so far
- register_artifact: Track file outputs
- answer_question: Respond to questions from specialist agents

## Decision Framework
When reviewing stage outputs, evaluate:
1. **Completeness** — Does the output cover all acceptance criteria from the ticket?
2. **Correctness** — Are test steps/selectors/assertions accurate?
3. **Efficiency** — Are there redundant steps that can be consolidated?
4. **Risk** — What's most likely to break in execution?

Always record your decisions via write_shared_context so downstream agents benefit from your reasoning.
`.trim();

// ─── Supervisor Session Manager ─────────────────────────────────────────────

class SupervisorSession {
    /**
     * @param {Object} options
     * @param {Object} options.sessionFactory - AgentSessionFactory instance
     * @param {Object} options.contextStore   - SharedContextStore for this run
     * @param {Object} [options.config]       - workflow-config.json
     * @param {boolean} [options.verbose]
     */
    constructor(options) {
        this.sessionFactory = options.sessionFactory;
        this.contextStore = options.contextStore;
        this.config = options.config || {};
        this.verbose = options.verbose || false;

        this._session = null;
        this._sessionId = null;
        this._conversationHistory = [];
        this._stageReviews = new Map();
        this._isActive = false;
    }

    // ─── Lifecycle ──────────────────────────────────────────────────

    /**
     * Initialize the supervisor session. Call once at pipeline start.
     * The session persists until destroy() is called.
     *
     * @param {string} ticketId - The ticket being processed
     * @param {string} [ticketSummary] - Brief ticket description for context
     */
    async initialize(ticketId, ticketSummary = '') {
        if (this._isActive) {
            this._log('Supervisor already active — skipping re-init');
            return;
        }

        this._log('Initializing supervisor session...');

        const supervisorContext = [
            SUPERVISOR_SYSTEM_PROMPT,
            '',
            '## Current Pipeline Run',
            `- Ticket: ${ticketId}`,
            ticketSummary ? `- Summary: ${ticketSummary}` : '',
            `- Pipeline mode: ${this.config.sdk?.modes ? 'full' : 'unknown'}`,
            '',
        ].filter(Boolean).join('\n');

        const sessionInfo = await this.sessionFactory.createAgentSession('orchestrator', {
            ticketContext: supervisorContext,
            contextStore: this.contextStore,
        });

        this._session = sessionInfo.session;
        this._sessionId = sessionInfo.sessionId;
        this._isActive = true;

        // Initial briefing
        const briefing = await this._send(
            `Pipeline starting for ticket ${ticketId}. ` +
            `${ticketSummary ? `Ticket summary: ${ticketSummary}. ` : ''}` +
            `Record any initial constraints or decisions via write_shared_context. ` +
            `Respond with "Ready" when you have no initial concerns.`
        );

        this._log(`Supervisor initialized. Initial response: ${briefing.substring(0, 150)}...`);

        this.contextStore.recordDecision(
            'supervisor',
            `Pipeline supervision started for ${ticketId}`,
            'Supervisor session active — will review each stage output'
        );
    }

    // ─── Stage Hooks ────────────────────────────────────────────────

    /**
     * Called BEFORE a specialist agent stage runs.
     * The supervisor reviews current context and provides guidance.
     *
     * @param {string} stageName - e.g., 'testgenie', 'scriptgenerator'
     * @param {Object} stageContext - Context being passed to the stage
     * @returns {string} Supervisor guidance (injected into specialist's context)
     */
    async briefStage(stageName, stageContext = {}) {
        if (!this._isActive) return '';

        const prompt = this._buildBriefingPrompt(stageName, stageContext);
        const guidance = await this._send(prompt);

        this._stageReviews.set(`${stageName}_brief`, {
            timestamp: new Date().toISOString(),
            guidance: guidance.substring(0, 500),
        });

        // Record the guidance as a decision
        this.contextStore.recordDecision(
            'supervisor',
            `Pre-${stageName} guidance: ${guidance.substring(0, 200)}`,
            `Reviewed context before ${stageName} stage`
        );

        return guidance;
    }

    /**
     * Called AFTER a specialist agent stage completes.
     * The supervisor reviews the output and flags issues.
     *
     * @param {string} stageName - e.g., 'testgenie', 'scriptgenerator'
     * @param {Object} stageResult - Result from the completed stage
     * @returns {Object} { approved: boolean, feedback: string, action: string }
     */
    async reviewStage(stageName, stageResult) {
        if (!this._isActive) {
            return { approved: true, feedback: '', action: 'continue' };
        }

        const prompt = this._buildReviewPrompt(stageName, stageResult);
        const review = await this._send(prompt);

        // Parse the supervisor's review for actionable decisions
        const parsed = this._parseReview(review);

        this._stageReviews.set(`${stageName}_review`, {
            timestamp: new Date().toISOString(),
            approved: parsed.approved,
            feedback: parsed.feedback.substring(0, 500),
            action: parsed.action,
        });

        this.contextStore.recordDecision(
            'supervisor',
            `Post-${stageName} review: ${parsed.approved ? 'APPROVED' : 'FLAGGED'} — ${parsed.feedback.substring(0, 150)}`,
            review.substring(0, 300)
        );

        this._log(`Stage ${stageName} review: ${parsed.approved ? '✅ Approved' : '⚠️ Flagged'} — ${parsed.action}`);

        return parsed;
    }

    /**
     * Ask the supervisor a question mid-pipeline.
     * Used by the coordinator when it needs strategic input.
     *
     * @param {string} question - The question
     * @param {Object} [additionalContext] - Extra context to include
     * @returns {string} The supervisor's response
     */
    async consult(question, additionalContext = {}) {
        if (!this._isActive) return 'Supervisor not active';

        const contextBlock = additionalContext.context
            ? `\n\nAdditional context:\n${JSON.stringify(additionalContext, null, 2).substring(0, 1000)}`
            : '';

        const response = await this._send(
            `Coordinator question: ${question}${contextBlock}\n\n` +
            `Provide a clear, decisive answer. If you need to record a decision, use write_shared_context.`
        );

        return response;
    }

    /**
     * Generate a final pipeline summary.
     * Called at the end of the run for audit trail.
     *
     * @param {Object} pipelineResult - Final pipeline result object
     * @returns {string} Formatted summary
     */
    async summarize(pipelineResult) {
        if (!this._isActive) return '';

        const prompt = [
            '## Pipeline Complete — Generate Summary',
            '',
            `Overall result: ${pipelineResult.success ? 'SUCCESS' : 'FAILED'}`,
            `Stages completed: ${pipelineResult.stagesCompleted || 'unknown'}`,
            `Duration: ${pipelineResult.durationMs ? Math.round(pipelineResult.durationMs / 1000) + 's' : 'unknown'}`,
            '',
            'Review the shared context store (use read_shared_context with filter "all") and produce:',
            '1. A 2-3 sentence executive summary',
            '2. Key decisions that shaped the outcome',
            '3. Risks or issues for the next run',
            '4. Record your summary via write_shared_context as a note',
        ].join('\n');

        const summary = await this._send(prompt);

        this.contextStore.addNote('supervisor', `Pipeline summary: ${summary.substring(0, 500)}`);

        return summary;
    }

    /**
     * Destroy the supervisor session and clean up.
     */
    async destroy() {
        if (!this._isActive) return;

        this._log('Destroying supervisor session...');
        this._isActive = false;

        if (this._sessionId) {
            await this.sessionFactory.destroySession(this._sessionId).catch(() => { });
        }

        this._session = null;
        this._sessionId = null;
    }

    // ─── State ──────────────────────────────────────────────────────

    /**
     * Get the supervisor's review history.
     *
     * @returns {Object} stage → review mapping
     */
    getReviewHistory() {
        const result = {};
        for (const [key, value] of this._stageReviews) {
            result[key] = value;
        }
        return result;
    }

    /**
     * Get the conversation turn count.
     *
     * @returns {number}
     */
    getConversationLength() {
        return this._conversationHistory.length;
    }

    get isActive() {
        return this._isActive;
    }

    // ─── Internal ───────────────────────────────────────────────────

    /**
     * Send a message to the persistent supervisor session.
     * Tracks conversation history for auditing.
     */
    async _send(prompt) {
        const turn = {
            role: 'coordinator',
            content: prompt,
            timestamp: new Date().toISOString(),
        };
        this._conversationHistory.push(turn);

        try {
            const response = await this.sessionFactory.sendAndWait(
                this._session,
                prompt,
                { timeout: 90000 } // 90s per supervisor turn
            );

            this._conversationHistory.push({
                role: 'supervisor',
                content: response.substring(0, 2000),
                timestamp: new Date().toISOString(),
            });

            return response;
        } catch (error) {
            const errorMsg = `Supervisor error: ${error.message}`;
            this._log(`❌ ${errorMsg}`);
            this._conversationHistory.push({
                role: 'error',
                content: errorMsg,
                timestamp: new Date().toISOString(),
            });
            return errorMsg;
        }
    }

    /**
     * Build the pre-stage briefing prompt.
     */
    _buildBriefingPrompt(stageName, stageContext) {
        const parts = [
            `## Pre-Stage Briefing: ${stageName.toUpperCase()}`,
            '',
            `The ${stageName} agent is about to run. Review the current shared context ` +
            `(use read_shared_context) and provide guidance.`,
            '',
        ];

        switch (stageName) {
            case 'testgenie':
                parts.push(
                    'Focus on:',
                    '- Are there any ticket constraints we should flag?',
                    '- Any specific test areas to prioritize?',
                    '- Should the agent cover edge cases or stick to happy paths?'
                );
                break;
            case 'scriptgenerator':
                parts.push(
                    'Focus on:',
                    '- Review the test cases artifact — are they complete enough for automation?',
                    '- Are there any known selectors or popup issues to warn about?',
                    '- Should the agent use any specific patterns from the codebase?'
                );
                break;
            case 'execute':
                parts.push(
                    'Focus on:',
                    '- Review the generated spec file — any obvious issues before we run it?',
                    '- Are there environment-specific concerns (UAT flakiness, etc.)?'
                );
                break;
            case 'buggenie':
                parts.push(
                    'Focus on:',
                    '- Summarize the failure for the bug ticket',
                    '- What was attempted during healing?',
                    '- What is the most likely root cause?'
                );
                break;
            default:
                parts.push(`Provide any relevant guidance for the ${stageName} stage.`);
        }

        parts.push(
            '',
            'Respond with concise guidance (max 3-4 bullet points). ' +
            'Record key decisions via write_shared_context.'
        );

        return parts.join('\n');
    }

    /**
     * Build the post-stage review prompt.
     */
    _buildReviewPrompt(stageName, stageResult) {
        const parts = [
            `## Post-Stage Review: ${stageName.toUpperCase()}`,
            '',
            `Result: ${stageResult.success ? 'SUCCESS' : 'FAILED'}`,
        ];

        if (stageResult.message) {
            parts.push(`Message: ${stageResult.message}`);
        }
        if (stageResult.error) {
            parts.push(`Error: ${String(stageResult.error).substring(0, 500)}`);
        }
        if (stageResult.warnings?.length) {
            parts.push(`Warnings: ${stageResult.warnings.join('; ')}`);
        }

        parts.push(
            '',
            'Evaluate this result and respond in EXACTLY this format:',
            'APPROVED: yes/no',
            'ACTION: continue/retry/escalate/abort',
            'FEEDBACK: <your concise assessment>',
            '',
            'Also record your assessment via write_shared_context.'
        );

        return parts.join('\n');
    }

    /**
     * Parse the supervisor's review response into structured data.
     */
    _parseReview(reviewText) {
        const text = reviewText.toLowerCase();

        // Extract structured fields
        const approvedMatch = reviewText.match(/APPROVED:\s*(yes|no)/i);
        const actionMatch = reviewText.match(/ACTION:\s*(continue|retry|escalate|abort)/i);
        const feedbackMatch = reviewText.match(/FEEDBACK:\s*(.+?)(?:\n|$)/i);

        const approved = approvedMatch
            ? approvedMatch[1].toLowerCase() === 'yes'
            : !text.includes('reject') && !text.includes('not approved') && !text.includes('flagged');

        const action = actionMatch
            ? actionMatch[1].toLowerCase()
            : approved ? 'continue' : 'retry';

        const feedback = feedbackMatch
            ? feedbackMatch[1].trim()
            : reviewText.substring(0, 300);

        return { approved, action, feedback };
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[Supervisor] ${message}`);
        }
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { SupervisorSession };
