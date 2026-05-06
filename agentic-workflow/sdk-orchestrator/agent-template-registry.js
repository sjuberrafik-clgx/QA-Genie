/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT TEMPLATE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages a catalog of reusable agent templates that users can browse, fork,
 * and customize. Templates are divided into two tiers:
 *
 *   1. **Built-in templates** — Hardcoded domain-specific templates for QA
 *      automation (TestGenie, ScriptGenerator, BugGenie, etc.) plus generic
 *      utility templates (API Tester, Accessibility Auditor, etc.).
 *
 *   2. **User templates** — Persisted to disk under studio-workspaces/_templates/.
 *      Created when a user "saves as template" from an existing agent.
 *
 * Consumed by:
 *   - GET  /api/studio/templates          — list all templates
 *   - GET  /api/studio/templates/:id      — get single template
 *   - POST /api/studio/templates          — create user template
 *   - POST /api/studio/templates/:id/fork — fork template into a workspace
 *   - DELETE /api/studio/templates/:id    — delete user template
 *
 * @module sdk-orchestrator/agent-template-registry
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const fsP = fs.promises;
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'studio-workspaces', '_templates');

// ─── Built-in Template Catalog ──────────────────────────────────────────────

const CATEGORIES = [
    { id: 'qa-automation', label: 'QA Automation', icon: 'test', color: 'blue' },
    { id: 'devops', label: 'DevOps', icon: 'terminal', color: 'emerald' },
    { id: 'support', label: 'Support', icon: 'chat', color: 'amber' },
    { id: 'research', label: 'Research', icon: 'search', color: 'violet' },
    { id: 'content', label: 'Content', icon: 'document', color: 'indigo' },
    { id: 'custom', label: 'Custom', icon: 'code', color: 'slate' },
];

const BUILTIN_TEMPLATES = [
    {
        id: 'tpl-testgenie',
        name: 'TestGenie',
        description: 'Generate test cases from Jira tickets with Excel export and markdown display.',
        category: 'qa-automation',
        tags: ['jira', 'test-cases', 'excel', 'qa'],
        icon: 'document',
        color: 'blue',
        source: 'builtin',
        popularity: 95,
        config: {
            toolProfile: 'testgenie',
            followupMode: 'testgenie',
            capabilities: { browser: false, jira: true, filesystem: 'none' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 50,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Generate comprehensive test cases from Jira tickets.',
            '',
            '## Responsibilities',
            '- Fetch and analyze Jira ticket details (summary, description, acceptance criteria)',
            '- Generate test cases following the standard format with Test Step ID, Specific Activity, Expected Results, and Actual Results',
            '- Export test cases as Excel files and display as markdown tables',
            '- Cover all possible scenarios with optimized, non-redundant test steps',
            '',
            '## Output Format',
            '- Both chat markdown tables AND Excel export are required',
            '- Follow the Pre-Conditions + Test Steps format strictly',
        ].join('\n'),
    },
    {
        id: 'tpl-scriptgenerator',
        name: 'ScriptGenerator',
        description: 'Create Playwright automation scripts via MCP exploration with live selector extraction.',
        category: 'qa-automation',
        tags: ['playwright', 'automation', 'mcp', 'browser'],
        icon: 'code',
        color: 'emerald',
        source: 'builtin',
        popularity: 90,
        config: {
            toolProfile: 'scriptgenerator',
            followupMode: 'scriptgenerator',
            capabilities: { browser: true, jira: false, filesystem: 'none' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [{ name: 'unified-automation', type: 'builtin' }],
            skills: [],
            permissionMode: 'default',
            maxTurns: 50,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Generate production-ready Playwright test scripts using MCP exploration.',
            '',
            '## Responsibilities',
            '- Navigate to target pages using MCP tools before writing any code',
            '- Extract real selectors from accessibility snapshots — never guess selectors',
            '- Generate .spec.js files following the framework pattern (CommonJS, serial describe)',
            '- Use PopupHandler for popup dismissal, POmanager for page objects',
            '',
            '## MCP-First Architecture',
            '- First tool call MUST be mcp_unified-autom_unified_navigate',
            '- Call snapshot on every page under test',
            '- Save exploration data to exploration-data/',
        ].join('\n'),
    },
    {
        id: 'tpl-buggenie',
        name: 'BugGenie',
        description: 'Create well-structured defect tickets in Jira from test failures and bug reports.',
        category: 'qa-automation',
        tags: ['jira', 'bugs', 'defects', 'qa'],
        icon: 'bug',
        color: 'red',
        source: 'builtin',
        popularity: 85,
        config: {
            toolProfile: 'buggenie',
            followupMode: 'buggenie',
            capabilities: { browser: false, jira: true, filesystem: 'none' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 30,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Create detailed defect tickets in Jira from test failures.',
            '',
            '## Responsibilities',
            '- Analyze test failure details (screenshots, logs, error traces)',
            '- Create structured bug tickets with Steps to Reproduce, Expected/Actual behavior',
            '- Include environment details, MLS information, and attachments',
            '- Follow the two-step review process before submission',
        ].join('\n'),
    },
    {
        id: 'tpl-taskgenie',
        name: 'TaskGenie',
        description: 'Create linked Testing tasks in Jira with auto-assignment and embedded test cases.',
        category: 'qa-automation',
        tags: ['jira', 'tasks', 'assignment', 'qa'],
        icon: 'task',
        color: 'amber',
        source: 'builtin',
        popularity: 80,
        config: {
            toolProfile: 'taskgenie',
            followupMode: 'taskgenie',
            capabilities: { browser: false, jira: true, filesystem: 'none' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 30,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Create linked Testing tasks in Jira with proper assignment.',
            '',
            '## Responsibilities',
            '- Create Testing issue type tasks linked to parent stories/tickets',
            '- Auto-assign to current user or named team members',
            '- Optionally embed test cases in the task description',
        ].join('\n'),
    },
    {
        id: 'tpl-api-tester',
        name: 'API Tester',
        description: 'Generate and execute API test suites for REST/GraphQL endpoints with assertion validation.',
        category: 'qa-automation',
        tags: ['api', 'rest', 'graphql', 'testing'],
        icon: 'code',
        color: 'cyan',
        source: 'builtin',
        popularity: 70,
        config: {
            toolProfile: 'full',
            followupMode: 'default',
            capabilities: { browser: false, jira: false, filesystem: 'read' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 50,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Generate API test suites for REST and GraphQL endpoints.',
            '',
            '## Responsibilities',
            '- Analyze API documentation or OpenAPI specs',
            '- Generate comprehensive test cases for all endpoints',
            '- Include positive, negative, and edge case scenarios',
            '- Validate response schemas, status codes, and business logic',
        ].join('\n'),
    },
    {
        id: 'tpl-accessibility-auditor',
        name: 'Accessibility Auditor',
        description: 'Audit web pages for WCAG 2.1 compliance using MCP snapshots and ARIA analysis.',
        category: 'qa-automation',
        tags: ['accessibility', 'wcag', 'aria', 'audit'],
        icon: 'search',
        color: 'violet',
        source: 'builtin',
        popularity: 65,
        config: {
            toolProfile: 'scriptgenerator',
            followupMode: 'default',
            capabilities: { browser: true, jira: false, filesystem: 'none' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [{ name: 'unified-automation', type: 'builtin' }],
            skills: [],
            permissionMode: 'default',
            maxTurns: 40,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Audit web pages for accessibility compliance against WCAG 2.1 guidelines.',
            '',
            '## Responsibilities',
            '- Navigate to target pages using MCP tools',
            '- Analyze ARIA roles, labels, and landmarks from snapshots',
            '- Identify accessibility violations and rank by severity',
            '- Generate remediation recommendations',
        ].join('\n'),
    },
    {
        id: 'tpl-data-validator',
        name: 'Data Validator',
        description: 'Validate data integrity, schema conformance, and business rule compliance across datasets.',
        category: 'qa-automation',
        tags: ['data', 'validation', 'schema', 'integrity'],
        icon: 'document',
        color: 'teal',
        source: 'builtin',
        popularity: 60,
        config: {
            toolProfile: 'filegenie',
            followupMode: 'default',
            capabilities: { browser: false, jira: false, filesystem: 'read' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 40,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Validate data integrity and schema conformance across datasets.',
            '',
            '## Responsibilities',
            '- Analyze CSV, JSON, and database exports for schema compliance',
            '- Detect duplicates, missing fields, and type mismatches',
            '- Validate business rules and cross-reference constraints',
            '- Generate validation reports with severity levels',
        ].join('\n'),
    },
    {
        id: 'tpl-release-planner',
        name: 'Release Planner',
        description: 'Plan and track release readiness across squads with checklist generation and Jira sync.',
        category: 'devops',
        tags: ['release', 'planning', 'jira', 'devops'],
        icon: 'task',
        color: 'emerald',
        source: 'builtin',
        popularity: 55,
        config: {
            toolProfile: 'full',
            followupMode: 'default',
            capabilities: { browser: false, jira: true, filesystem: 'read' },
            model: { id: 'claude-sonnet-4-6', speed: 'standard' },
            mcpServers: [],
            skills: [],
            permissionMode: 'default',
            maxTurns: 50,
            maxBudgetUsd: null,
        },
        promptTemplate: [
            '# {{AGENT_NAME}}',
            '',
            '## Purpose',
            'Plan release readiness and generate checklists synchronized with Jira.',
            '',
            '## Responsibilities',
            '- Query Jira for sprint/release tickets and their status',
            '- Generate readiness checklists with go/no-go criteria',
            '- Track cross-squad dependencies and blockers',
            '- Produce release notes drafts from completed tickets',
        ].join('\n'),
    },
];

const BUILTIN_BY_ID = new Map(BUILTIN_TEMPLATES.map(t => [t.id, t]));

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureDir(dirPath) {
    await fsP.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath) {
    try { await fsP.access(targetPath); return true; } catch { return false; }
}

async function readJson(filePath) {
    return JSON.parse(await fsP.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
    await fsP.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function slugify(value) {
    return String(value || '')
        .normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().toLowerCase()
        .replace(/[\s_.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'template';
}

// ─── Registry Class ─────────────────────────────────────────────────────────

class AgentTemplateRegistry {
    constructor(options = {}) {
        this.templatesDir = options.templatesDir || TEMPLATES_DIR;
    }

    /** List all templates (builtin + user), optionally filtered by category or search. */
    async listTemplates(options = {}) {
        const { category, search, source } = options;
        const all = [...BUILTIN_TEMPLATES];

        // Load user templates
        const userTemplates = await this._loadUserTemplates();
        all.push(...userTemplates);

        let filtered = all;

        if (source === 'builtin') {
            filtered = filtered.filter(t => t.source === 'builtin');
        } else if (source === 'user') {
            filtered = filtered.filter(t => t.source === 'user');
        }

        if (category) {
            filtered = filtered.filter(t => t.category === category);
        }

        if (search) {
            const q = search.toLowerCase();
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q) ||
                (t.tags || []).some(tag => tag.toLowerCase().includes(q))
            );
        }

        // Sort by popularity descending, then name ascending
        filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name));

        return {
            items: filtered,
            total: filtered.length,
            categories: CATEGORIES,
        };
    }

    /** Get a single template by ID. */
    async getTemplate(templateId) {
        const builtin = BUILTIN_BY_ID.get(templateId);
        if (builtin) return { ...builtin };

        const userPath = path.join(this.templatesDir, templateId, 'template.json');
        if (await pathExists(userPath)) {
            return readJson(userPath);
        }

        const error = new Error(`Template not found: ${templateId}`);
        error.status = 404;
        throw error;
    }

    /** Create a user template from an agent config. */
    async createTemplate(payload = {}) {
        await ensureDir(this.templatesDir);

        const name = String(payload.name || '').trim();
        if (!name) {
            const error = new Error('Template name is required');
            error.status = 400;
            throw error;
        }

        const id = `tpl-user-${slugify(name)}-${Date.now().toString(36)}`;
        const now = new Date().toISOString();

        const template = {
            id,
            name,
            description: String(payload.description || '').trim(),
            category: payload.category || 'custom',
            tags: Array.isArray(payload.tags) ? payload.tags.map(t => String(t).trim()).filter(Boolean) : [],
            icon: payload.icon || 'code',
            color: payload.color || 'slate',
            source: 'user',
            popularity: 0,
            config: {
                toolProfile: payload.config?.toolProfile || 'full',
                followupMode: payload.config?.followupMode || 'default',
                capabilities: payload.config?.capabilities || { browser: true, jira: true, filesystem: 'read' },
                model: payload.config?.model || { id: 'claude-sonnet-4-6', speed: 'standard' },
                mcpServers: Array.isArray(payload.config?.mcpServers) ? payload.config.mcpServers : [],
                skills: Array.isArray(payload.config?.skills) ? payload.config.skills : [],
                permissionMode: payload.config?.permissionMode || 'default',
                maxTurns: payload.config?.maxTurns || 50,
                maxBudgetUsd: payload.config?.maxBudgetUsd || null,
            },
            promptTemplate: payload.promptTemplate || '',
            createdAt: now,
            updatedAt: now,
            forkedFrom: payload.forkedFrom || null,
        };

        const templateDir = path.join(this.templatesDir, id);
        await ensureDir(templateDir);
        await writeJson(path.join(templateDir, 'template.json'), template);

        if (template.promptTemplate) {
            await fsP.writeFile(path.join(templateDir, 'prompt.md'), template.promptTemplate, 'utf8');
        }

        return template;
    }

    /** Fork a template — returns config + prompt ready for workspace asset creation. */
    async forkTemplate(templateId, overrides = {}) {
        const template = await this.getTemplate(templateId);
        const agentName = overrides.name || template.name;

        // Expand prompt template variables
        let prompt = template.promptTemplate || '';
        prompt = prompt.replace(/\{\{AGENT_NAME\}\}/g, agentName);

        return {
            name: agentName,
            description: overrides.description || template.description,
            config: {
                ...template.config,
                ...overrides.config,
            },
            promptBody: prompt,
            forkedFrom: {
                templateId: template.id,
                templateName: template.name,
                forkedAt: new Date().toISOString(),
            },
        };
    }

    /** Delete a user template. Built-in templates cannot be deleted. */
    async deleteTemplate(templateId) {
        if (BUILTIN_BY_ID.has(templateId)) {
            const error = new Error('Cannot delete built-in templates');
            error.status = 403;
            throw error;
        }

        const templateDir = path.join(this.templatesDir, templateId);
        if (!await pathExists(templateDir)) {
            const error = new Error(`Template not found: ${templateId}`);
            error.status = 404;
            throw error;
        }

        await fsP.rm(templateDir, { recursive: true, force: true });
        return { id: templateId, deleted: true };
    }

    // ─── Private ────────────────────────────────────────────────────────────

    async _loadUserTemplates() {
        if (!await pathExists(this.templatesDir)) return [];

        const entries = await fsP.readdir(this.templatesDir, { withFileTypes: true });
        const templates = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifestPath = path.join(this.templatesDir, entry.name, 'template.json');
            if (!await pathExists(manifestPath)) continue;

            try {
                const template = await readJson(manifestPath);
                template.source = 'user';
                templates.push(template);
            } catch {
                // Skip corrupt templates
            }
        }

        return templates;
    }
}

module.exports = { AgentTemplateRegistry, CATEGORIES, BUILTIN_TEMPLATES };
