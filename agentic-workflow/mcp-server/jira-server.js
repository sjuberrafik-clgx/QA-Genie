/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * JIRA MCP SERVER — Same Jira tools the web app uses, exposed to VS Code Copilot Chat
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A thin, standalone MCP server that reuses the EXACT core Jira functions from the
 * SDK orchestrator (agentic-workflow/sdk-orchestrator/tools/*). It authenticates with
 * the same credentials in agentic-workflow/.env (JIRA_EMAIL, JIRA_API_TOKEN,
 * JIRA_CLOUD_ID / JIRA_BASE_URL) — no OAuth login required.
 *
 * Approval note: In the web app, writes gate through requireJiraMutationApproval().
 * In VS Code Copilot Chat, the editor's native tool-confirmation prompt IS the approval
 * gate — every write tool below is confirmed by you before it runs.
 *
 * Transport: stdio (spawned by VS Code from .vscode/mcp.json).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as dotenvConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load Jira credentials from agentic-workflow/.env (single source of truth).
// quiet: true keeps stdout clean — on stdio, stdout IS the JSON-RPC channel.
dotenvConfig({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

// ── Reuse the SAME core Jira functions the web-app SDK tools call ────────────
const SDK_TOOLS = path.resolve(__dirname, '..', 'sdk-orchestrator', 'tools');
const {
    createScheduledAiTicketCore, // superset of create (supports assignee/parent/linked)
    postJiraCommentCore,
    transitionJiraTicketCore,
} = require(path.join(SDK_TOOLS, 'jira-transition-core.js'));
const {
    getJiraApiConfig,
    buildJiraIssueApiUrl,
    buildJiraBrowseUrl,
} = require(path.join(SDK_TOOLS, 'jira-api-helpers.js'));
const { formatJiraTicket } = require(path.join(SDK_TOOLS, 'jira-ticket-formatter.js'));
const { fetchCompleteJiraComments } = require(path.join(SDK_TOOLS, 'jira-comment-helpers.js'));
const { normalizeJiraTicketInput } = require(path.resolve(__dirname, '..', 'sdk-orchestrator', 'atlassian-url-utils.js'));
const { markdownToAdf } = require(path.resolve(__dirname, '..', 'sdk-orchestrator', 'adf-converter.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true };
}

function resolveTicket(ticketId) {
    const normalized = normalizeJiraTicketInput(ticketId);
    if (!normalized.ticketId) {
        return { error: `Could not resolve "${ticketId}" into a Jira ticket key. Pass a key like AOTF-16339 or a full browse URL.` };
    }
    return normalized;
}

// ── Handlers ──────────────────────────────────────────────────────────────────
async function fetchJiraTicket({ ticketId }) {
    const normalized = resolveTicket(ticketId);
    if (normalized.error) return fail({ success: false, error: normalized.error });

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalized.jiraBaseUrl });
    if (jiraConfig.error) return fail({ success: false, error: jiraConfig.error });

    const url = buildJiraIssueApiUrl(jiraConfig, normalized.ticketId) + '?expand=renderedFields';
    const resp = await fetch(url, { headers: jiraConfig.headers });
    if (!resp.ok) {
        return fail({
            success: false,
            error: `Failed to fetch ${normalized.ticketId}: HTTP ${resp.status}`,
            details: await resp.text(),
        });
    }

    const data = await resp.json();
    const formatted = formatJiraTicket(data, normalized.ticketId);

    if (formatted.commentsTruncated) {
        const complete = await fetchCompleteJiraComments(normalized.ticketId, {
            baseUrl: jiraConfig.baseUrl,
            cloudId: jiraConfig.cloudId,
            headers: jiraConfig.headers,
        });
        if (complete) {
            formatted.comments = complete.comments;
            formatted.commentCount = complete.commentCount;
            formatted.commentsTruncated = complete.commentsTruncated;
        }
    }
    formatted.ticketUrl = buildJiraBrowseUrl(jiraConfig, normalized.ticketId);
    return ok(formatted);
}

async function createJiraTicket(args = {}) {
    const labels = isNonEmptyString(args.labels)
        ? args.labels.split(',').map(l => l.trim()).filter(Boolean)
        : undefined;
    const result = await createScheduledAiTicketCore({ ...args, labels });
    return result.success ? ok(result) : fail(result);
}

async function addJiraComment({ ticketId, comment }) {
    const normalized = resolveTicket(ticketId);
    if (normalized.error) return fail({ success: false, error: normalized.error });
    const result = await postJiraCommentCore({
        ticketId: normalized.ticketId,
        comment,
        jiraBaseUrl: normalized.jiraBaseUrl,
    });
    return result.success ? ok(result) : fail(result);
}

async function updateJiraTicket({ ticketId, summary, description, priority, labels, comment }) {
    const normalized = resolveTicket(ticketId);
    if (normalized.error) return fail({ success: false, error: normalized.error });

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalized.jiraBaseUrl });
    if (jiraConfig.error) return fail({ success: false, error: jiraConfig.error });

    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalized.ticketId);
    const fields = {};
    if (isNonEmptyString(summary)) fields.summary = summary.trim();
    if (isNonEmptyString(description)) fields.description = markdownToAdf(description);
    if (isNonEmptyString(priority)) fields.priority = { name: priority.trim() };
    if (isNonEmptyString(labels)) fields.labels = labels.split(',').map(l => l.trim()).filter(Boolean);

    const updated = [];
    const errors = [];

    if (Object.keys(fields).length > 0) {
        const resp = await fetch(buildJiraIssueApiUrl(jiraConfig, normalized.ticketId), {
            method: 'PUT',
            headers: jiraConfig.headers,
            body: JSON.stringify({ fields }),
        });
        if (resp.ok) updated.push('fields');
        else errors.push(`Field update failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    if (isNonEmptyString(comment)) {
        const resp = await fetch(buildJiraIssueApiUrl(jiraConfig, normalized.ticketId, '/comment'), {
            method: 'POST',
            headers: jiraConfig.headers,
            body: JSON.stringify({ body: markdownToAdf(comment) }),
        });
        if (resp.ok) updated.push('comment');
        else errors.push(`Comment failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    if (updated.length === 0 && errors.length === 0) {
        return fail({ success: false, ticketId: normalized.ticketId, ticketUrl, error: 'Nothing to update. Provide at least one of: summary, description, priority, labels, comment.' });
    }

    const result = {
        success: errors.length === 0,
        ticketId: normalized.ticketId,
        ticketUrl,
        updated,
        errors: errors.length > 0 ? errors : undefined,
        outcome: `Updated ${normalized.ticketId}: ${updated.join(', ') || 'no changes applied'}.`,
    };
    return result.success ? ok(result) : fail(result);
}

async function transitionJiraTicket({ ticketId, targetStatus, transitionId, resolution, comment }) {
    const normalized = resolveTicket(ticketId);
    if (normalized.error) return fail({ success: false, error: normalized.error });
    const result = await transitionJiraTicketCore({
        ticketId: normalized.ticketId,
        targetStatus,
        transitionId,
        resolution,
        comment,
        jiraBaseUrl: normalized.jiraBaseUrl,
    });
    return result.success ? ok(result) : fail(result);
}

async function getJiraTicketComments({ ticketId }) {
    const normalized = resolveTicket(ticketId);
    if (normalized.error) return fail({ success: false, error: normalized.error });

    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalized.jiraBaseUrl });
    if (jiraConfig.error) return fail({ success: false, error: jiraConfig.error });

    const complete = await fetchCompleteJiraComments(normalized.ticketId, {
        baseUrl: jiraConfig.baseUrl,
        cloudId: jiraConfig.cloudId,
        headers: jiraConfig.headers,
    });
    if (!complete) {
        return fail({ success: false, ticketId: normalized.ticketId, error: 'Failed to load comments.' });
    }
    return ok({
        success: true,
        ticketId: normalized.ticketId,
        ticketUrl: buildJiraBrowseUrl(jiraConfig, normalized.ticketId),
        ...complete,
    });
}

async function getJiraCurrentUser() {
    const jiraConfig = getJiraApiConfig();
    if (jiraConfig.error) return fail({ success: false, error: jiraConfig.error });
    const resp = await fetch(`${jiraConfig.apiBase}/myself`, { headers: jiraConfig.headers });
    if (!resp.ok) {
        return fail({ success: false, error: `Failed to load current user: HTTP ${resp.status}`, details: await resp.text() });
    }
    const me = await resp.json();
    return ok({
        success: true,
        accountId: me.accountId,
        displayName: me.displayName,
        emailAddress: me.emailAddress || null,
    });
}

async function searchJiraIssues({ jql, maxResults }) {
    if (!isNonEmptyString(jql)) return fail({ success: false, error: 'A non-empty JQL query is required.' });
    const jiraConfig = getJiraApiConfig();
    if (jiraConfig.error) return fail({ success: false, error: jiraConfig.error });

    const limit = Math.min(Math.max(parseInt(maxResults, 10) || 25, 1), 100);
    const resp = await fetch(`${jiraConfig.apiBase}/search/jql`, {
        method: 'POST',
        headers: jiraConfig.headers,
        body: JSON.stringify({
            jql,
            maxResults: limit,
            fields: ['summary', 'status', 'issuetype', 'priority', 'assignee'],
        }),
    });
    if (!resp.ok) {
        return fail({ success: false, error: `JQL search failed: HTTP ${resp.status}`, details: await resp.text() });
    }
    const data = await resp.json();
    const issues = (data.issues || []).map(issue => ({
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || '',
        issueType: issue.fields?.issuetype?.name || '',
        priority: issue.fields?.priority?.name || '',
        assignee: issue.fields?.assignee?.displayName || null,
        url: buildJiraBrowseUrl(jiraConfig, issue.key),
    }));
    return ok({ success: true, jql, count: issues.length, issues });
}

// ── Tool registry ─────────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'fetch_jira_ticket',
        description: 'Fetch full Jira ticket details (summary, description, acceptance criteria, status, priority, issue type, labels, components, fix versions, assignee, reporter, parent, subtasks, issue links, and comments). Accepts a ticket key (AOTF-16339) or a full Jira browse URL.',
        inputSchema: {
            type: 'object',
            properties: { ticketId: { type: 'string', description: 'Jira ticket key or full browse URL.' } },
            required: ['ticketId'],
            additionalProperties: false,
        },
        handler: fetchJiraTicket,
    },
    {
        name: 'create_jira_ticket',
        description: 'Create a new Jira ticket (Bug / Story / Task / Sub-task). Supports optional assignment, linking to a related issue, and creating a true subtask under a parent. Description accepts markdown (converted to Jira ADF).',
        inputSchema: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Ticket summary/title.' },
                description: { type: 'string', description: 'Ticket description in markdown.' },
                issueType: { type: 'string', description: 'Bug | Story | Task | Sub-task. Default Task.' },
                projectKey: { type: 'string', description: 'Jira project key. Defaults to JIRA_PROJECT_KEY (AOTF).' },
                priority: { type: 'string', description: 'Highest | High | Medium | Low | Lowest. Default Medium.' },
                labels: { type: 'string', description: 'Comma-separated labels. Omit unless requested.' },
                assigneeAccountId: { type: 'string', description: 'Atlassian account ID to assign (get via get_jira_current_user).' },
                parentIssueKey: { type: 'string', description: 'Parent issue key to create this as a true subtask under.' },
                linkedIssueKey: { type: 'string', description: 'Existing issue key to link this ticket to.' },
                linkType: { type: 'string', description: 'Link type name (default "Relates"). Used with linkedIssueKey.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
        handler: createJiraTicket,
    },
    {
        name: 'add_jira_comment',
        description: 'Add a comment to an existing Jira ticket. Comment body accepts markdown (converted to Jira ADF).',
        inputSchema: {
            type: 'object',
            properties: {
                ticketId: { type: 'string', description: 'Jira ticket key or full browse URL.' },
                comment: { type: 'string', description: 'Comment body in markdown.' },
            },
            required: ['ticketId', 'comment'],
            additionalProperties: false,
        },
        handler: addJiraComment,
    },
    {
        name: 'update_jira_ticket',
        description: 'Update fields on an existing Jira ticket (summary, description, priority, labels) and/or add a comment. Only provided fields are changed. Description/comment accept markdown.',
        inputSchema: {
            type: 'object',
            properties: {
                ticketId: { type: 'string', description: 'Jira ticket key or full browse URL.' },
                summary: { type: 'string', description: 'New summary.' },
                description: { type: 'string', description: 'New description in markdown (replaces existing).' },
                priority: { type: 'string', description: 'New priority name.' },
                labels: { type: 'string', description: 'Comma-separated labels (replaces existing set).' },
                comment: { type: 'string', description: 'Comment to add in markdown.' },
            },
            required: ['ticketId'],
            additionalProperties: false,
        },
        handler: updateJiraTicket,
    },
    {
        name: 'transition_jira_ticket',
        description: 'Change a Jira ticket status by resolving the target status/transition against the ticket workflow. Provide targetStatus (e.g., "In Progress") or an explicit transitionId.',
        inputSchema: {
            type: 'object',
            properties: {
                ticketId: { type: 'string', description: 'Jira ticket key or full browse URL.' },
                targetStatus: { type: 'string', description: 'Target status or transition name (e.g., "Done").' },
                transitionId: { type: 'string', description: 'Explicit Jira transition ID (alternative to targetStatus).' },
                resolution: { type: 'string', description: 'Optional resolution name to set on transition.' },
                comment: { type: 'string', description: 'Optional comment to post with the transition.' },
            },
            required: ['ticketId'],
            additionalProperties: false,
        },
        handler: transitionJiraTicket,
    },
    {
        name: 'get_jira_ticket_comments',
        description: 'Fetch all comments on a Jira ticket (fully paginated).',
        inputSchema: {
            type: 'object',
            properties: { ticketId: { type: 'string', description: 'Jira ticket key or full browse URL.' } },
            required: ['ticketId'],
            additionalProperties: false,
        },
        handler: getJiraTicketComments,
    },
    {
        name: 'get_jira_current_user',
        description: 'Return the authenticated Jira user (accountId, displayName, email). Use the accountId to self-assign tickets.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: getJiraCurrentUser,
    },
    {
        name: 'search_jira_issues',
        description: 'Search Jira issues with a JQL query. Returns key, summary, status, type, priority, and assignee for each match.',
        inputSchema: {
            type: 'object',
            properties: {
                jql: { type: 'string', description: 'JQL query, e.g., "project = AOTF AND status = \\"In Progress\\"".' },
                maxResults: { type: 'number', description: 'Max results (1-100, default 25).' },
            },
            required: ['jql'],
            additionalProperties: false,
        },
        handler: searchJiraIssues,
    },
];

const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

// ── Server bootstrap ────────────────────────────────────────────────────────
const server = new Server(
    { name: 'jira-mcp', version: '1.0.0' },
    { capabilities: { tools: { listChanged: false } } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_MAP.get(name);
    if (!tool) {
        return fail({ success: false, error: `Unknown tool: ${name}` });
    }
    try {
        return await tool.handler(args || {});
    } catch (error) {
        return fail({ success: false, error: `${name} failed: ${error.message}` });
    }
});

server.onerror = (error) => console.error('[JiraMCP] Server error:', error);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[JiraMCP] Jira MCP server running on stdio');
}

main().catch((error) => {
    console.error('[JiraMCP] Fatal:', error);
    process.exit(1);
});
