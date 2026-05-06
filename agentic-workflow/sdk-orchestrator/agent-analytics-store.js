/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT ANALYTICS STORE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Collects and serves per-agent usage metrics: invocation count, success rate,
 * average response time, token consumption, tool call frequency, and errors.
 *
 * Storage: JSON file at agentic-workflow/learning-data/agent-analytics.json
 * Metrics are updated in real-time via recordEvent() and served as snapshots.
 *
 * Consumed by:
 *   - GET /api/studio/analytics                — all agents summary
 *   - GET /api/studio/analytics/:agentId       — single agent detail
 *   - POST /api/studio/analytics/record        — record an event (internal)
 *
 * @module sdk-orchestrator/agent-analytics-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const fsP = fs.promises;
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STORE_PATH = path.join(PROJECT_ROOT, 'agentic-workflow', 'learning-data', 'agent-analytics.json');

// ─── Store Class ────────────────────────────────────────────────────────────

class AgentAnalyticsStore {
    constructor(options = {}) {
        this._storePath = options.storePath || DEFAULT_STORE_PATH;
        this._data = null;
        this._dirty = false;
        this._flushTimer = null;
    }

    /** Load data from disk (lazy, on first access). */
    async _ensureLoaded() {
        if (this._data) return;
        try {
            const raw = await fsP.readFile(this._storePath, 'utf8');
            this._data = JSON.parse(raw);
        } catch {
            this._data = { agents: {}, lastUpdated: null };
        }
    }

    /** Flush data to disk (debounced). */
    _scheduleSave() {
        if (this._flushTimer) return;
        this._dirty = true;
        this._flushTimer = setTimeout(async () => {
            this._flushTimer = null;
            if (!this._dirty || !this._data) return;
            try {
                await fsP.mkdir(path.dirname(this._storePath), { recursive: true });
                await fsP.writeFile(this._storePath, JSON.stringify(this._data, null, 2), 'utf8');
                this._dirty = false;
            } catch {
                // Ignore write errors — analytics are best-effort
            }
        }, 2000);
    }

    /** Record a single agent interaction event. */
    async recordEvent(event) {
        await this._ensureLoaded();

        const agentId = event.agentId || 'unknown';
        if (!this._data.agents[agentId]) {
            this._data.agents[agentId] = {
                agentId,
                agentName: event.agentName || agentId,
                totalInvocations: 0,
                successCount: 0,
                errorCount: 0,
                totalTokens: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalResponseTimeMs: 0,
                toolCallCounts: {},
                errors: [],
                sessions: [],
                firstSeen: new Date().toISOString(),
                lastSeen: null,
            };
        }

        const record = this._data.agents[agentId];
        record.totalInvocations += 1;
        record.lastSeen = new Date().toISOString();
        record.agentName = event.agentName || record.agentName;

        if (event.success !== false) {
            record.successCount += 1;
        } else {
            record.errorCount += 1;
            if (event.error) {
                record.errors.push({
                    message: String(event.error).slice(0, 200),
                    timestamp: new Date().toISOString(),
                });
                // Keep only last 50 errors
                if (record.errors.length > 50) {
                    record.errors = record.errors.slice(-50);
                }
            }
        }

        if (event.tokens) {
            record.totalTokens += (event.tokens.total || 0);
            record.totalInputTokens += (event.tokens.input || 0);
            record.totalOutputTokens += (event.tokens.output || 0);
        }

        if (event.responseTimeMs) {
            record.totalResponseTimeMs += event.responseTimeMs;
        }

        if (event.toolCalls && typeof event.toolCalls === 'object') {
            for (const [tool, count] of Object.entries(event.toolCalls)) {
                record.toolCallCounts[tool] = (record.toolCallCounts[tool] || 0) + (count || 1);
            }
        }

        if (event.sessionId) {
            record.sessions.push({
                sessionId: event.sessionId,
                timestamp: new Date().toISOString(),
                success: event.success !== false,
                durationMs: event.responseTimeMs || null,
            });
            // Keep only last 100 sessions
            if (record.sessions.length > 100) {
                record.sessions = record.sessions.slice(-100);
            }
        }

        this._data.lastUpdated = new Date().toISOString();
        this._scheduleSave();

        return { recorded: true, agentId };
    }

    /** Get analytics summary for all agents. */
    async getSummary() {
        await this._ensureLoaded();

        const agents = Object.values(this._data.agents).map(record => {
            const successRate = record.totalInvocations > 0
                ? Math.round((record.successCount / record.totalInvocations) * 100)
                : 0;
            const avgResponseTimeMs = record.totalInvocations > 0
                ? Math.round(record.totalResponseTimeMs / record.totalInvocations)
                : 0;

            return {
                agentId: record.agentId,
                agentName: record.agentName,
                totalInvocations: record.totalInvocations,
                successRate,
                avgResponseTimeMs,
                totalTokens: record.totalTokens,
                errorCount: record.errorCount,
                lastSeen: record.lastSeen,
                firstSeen: record.firstSeen,
            };
        });

        agents.sort((a, b) => b.totalInvocations - a.totalInvocations);

        return {
            agents,
            totalAgents: agents.length,
            totalInvocations: agents.reduce((sum, a) => sum + a.totalInvocations, 0),
            totalTokens: agents.reduce((sum, a) => sum + a.totalTokens, 0),
            lastUpdated: this._data.lastUpdated,
        };
    }

    /** Get detailed analytics for a specific agent. */
    async getAgentDetail(agentId) {
        await this._ensureLoaded();

        const record = this._data.agents[agentId];
        if (!record) {
            return null;
        }

        const successRate = record.totalInvocations > 0
            ? Math.round((record.successCount / record.totalInvocations) * 100)
            : 0;
        const avgResponseTimeMs = record.totalInvocations > 0
            ? Math.round(record.totalResponseTimeMs / record.totalInvocations)
            : 0;

        // Top tools by usage
        const topTools = Object.entries(record.toolCallCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20)
            .map(([tool, count]) => ({ tool, count }));

        // Recent sessions
        const recentSessions = (record.sessions || []).slice(-20).reverse();

        // Recent errors
        const recentErrors = (record.errors || []).slice(-10).reverse();

        return {
            agentId: record.agentId,
            agentName: record.agentName,
            totalInvocations: record.totalInvocations,
            successCount: record.successCount,
            errorCount: record.errorCount,
            successRate,
            avgResponseTimeMs,
            totalTokens: record.totalTokens,
            totalInputTokens: record.totalInputTokens,
            totalOutputTokens: record.totalOutputTokens,
            topTools,
            recentSessions,
            recentErrors,
            firstSeen: record.firstSeen,
            lastSeen: record.lastSeen,
        };
    }

    /** Clear all analytics data. */
    async clear() {
        this._data = { agents: {}, lastUpdated: null };
        this._dirty = true;
        this._scheduleSave();
        return { cleared: true };
    }
}

module.exports = { AgentAnalyticsStore };
