/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * STUDIO ASSET DESCRIPTION GENERATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates rich, multi-section descriptions for Studio scaffold assets
 * (agents, skills, MCP servers, files) using the Copilot SDK.
 *
 * The generator:
 *   1. Loads 1–2 curated exemplars from repo (@testgenie, @scriptgenerator,
 *      repo-commit-push skill, unified-automation MCP) per asset type.
 *   2. Builds a structured prompt asking the model to return JSON with a short
 *      summary + long-form description body.
 *   3. Calls a lightweight one-shot SDK session (no tools, no MCP, no streaming)
 *      via the existing AgentSessionFactory.createLightweightSession helper.
 *   4. Parses the JSON (tolerant to code fences) and returns structured output.
 *
 * Consumed by the POST /api/studio/generate-description route (server.js) and
 * the Studio page's "✨ Generate with AI" button.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { ensureSkillFrontmatter } = require('./studio-workspace-registry');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const ASSET_TYPES = new Set(['agent', 'skill', 'mcp-server', 'file']);

// Per-type exemplar files (relative to project root). Trimmed at read time.
const EXEMPLAR_SOURCES = {
    agent: [
        '.github/agents/testgenie.agent.md',
        '.github/agents/scriptgenerator.agent.md',
    ],
    skill: [
        '.github/skills/repo-commit-push/SKILL.md',
        '.github/skills/ppt/SKILL.md',
    ],
    'mcp-server': [
        'agentic-workflow/mcp-server/server.js',
    ],
    file: [
        '.github/agents/README.md',
    ],
};

const EXEMPLAR_CHAR_BUDGET = 4000; // per exemplar
const DEFAULT_TIMEOUT_MS = 60000;

// ─── Exemplar loader ────────────────────────────────────────────────────────

function readExemplar(relPath, charBudget = EXEMPLAR_CHAR_BUDGET) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    if (!fs.existsSync(absPath)) return null;
    try {
        const raw = fs.readFileSync(absPath, 'utf8');
        // Trim frontmatter-style code fences in agent .md files
        const cleaned = raw
            .replace(/^[`]{3,}chatagent\s*\n---[\s\S]*?---\s*\n/, '')
            .replace(/\n[`]{3,}\s*$/, '')
            .trim();
        if (cleaned.length <= charBudget) return cleaned;
        return cleaned.slice(0, charBudget) + '\n\n[...truncated for prompt context]';
    } catch {
        return null;
    }
}

function loadExemplarsFor(type) {
    const sources = EXEMPLAR_SOURCES[type] || [];
    const items = [];
    for (const rel of sources) {
        const body = readExemplar(rel);
        if (body) items.push({ path: rel, body });
    }
    return items;
}

// ─── Prompt builder ─────────────────────────────────────────────────────────

function buildSystemPrompt(type) {
    const typeLabels = {
        agent: 'a custom chat agent (prompt.md body)',
        skill: 'a reusable skill (SKILL.md body) that gives agents local guidance',
        'mcp-server': 'a local MCP server (README.md body describing tools, setup, and usage)',
        file: 'a supporting workspace file (markdown notes, config drafts, or reference docs)',
    };

    const skillFrontmatterRule = type === 'skill'
        ? [
            '',
            'CRITICAL: For skills, the `longContext` MUST start with YAML frontmatter:',
            '```',
            '---',
            'name: lowercase-hyphenated-name',
            "description: 'One-line description including trigger language (e.g., Use when...). Max 1024 chars.'",
            '---',
            '```',
            'The body after frontmatter MUST include a `## When To Use This Skill` section with bullet triggers,',
            'a `Keywords:` line with comma-separated discovery terms, and a `## Instructions` section.',
        ].join('\n')
        : '';

    return [
        'You are an expert technical writer embedded in a QA automation workflow.',
        `Your job is to draft ${typeLabels[type] || 'a workspace asset'} for a Studio scaffold.`,
        '',
        'Requirements:',
        '- Output ONLY a single JSON object with the exact keys below — no prose, no code fences.',
        '- `summary`: one-line description (max 140 chars).',
        '- `longContext`: multi-section Markdown body (200–600 words) that becomes the asset file content.',
        '- `responsibilities`: array of 3–6 short action-oriented bullets.',
        '- `whenToUse`: array of 2–4 short bullets describing trigger situations.',
        skillFrontmatterRule,
        '',
        'Writing rules:',
        '- Be concrete, not generic. Use the user\'s Intent to shape specific behaviors and tools.',
        '- Mirror the structure and tone of the Exemplars provided (headings, bullet style).',
        '- Do NOT invent product names or tools that were not referenced.',
        '- No emojis unless an exemplar uses them.',
        '- No time estimates.',
    ].join('\n');
}

function buildUserPrompt({ type, name, intent, exemplars }) {
    const exemplarBlock = exemplars.length === 0
        ? '(No exemplars available — rely on general best practices for this asset type.)'
        : exemplars.map((ex, i) => [
            `### Exemplar ${i + 1}: ${ex.path}`,
            '```',
            ex.body,
            '```',
        ].join('\n')).join('\n\n');

    return [
        `Asset type: ${type}`,
        `Proposed name: ${name || '(not provided)'}`,
        `User intent: ${intent || '(not provided — infer a reasonable scope from the name)'}`,
        '',
        '## Exemplars (for tone & structure only — do not copy verbatim)',
        exemplarBlock,
        '',
        '## Output',
        'Return a single JSON object matching the schema described in the system message.',
    ].join('\n');
}

// ─── Response parser ────────────────────────────────────────────────────────

function extractJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null;

    // Strip markdown code fences if present
    let cleaned = text.trim()
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/, '')
        .trim();

    // If the model wrapped JSON in extra prose, extract the first {...} block
    if (!cleaned.startsWith('{')) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function normalizeResult(parsed, { name, intent, type }) {
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const longContext = typeof parsed?.longContext === 'string' ? parsed.longContext.trim() : '';
    const responsibilities = Array.isArray(parsed?.responsibilities)
        ? parsed.responsibilities.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
        : [];
    const whenToUse = Array.isArray(parsed?.whenToUse)
        ? parsed.whenToUse.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
        : [];

    if (!summary && !longContext) {
        throw Object.assign(new Error('Model response was empty or unparseable'), { status: 502, code: 'generator_empty' });
    }

    let finalLongContext = longContext || [
        `# ${name || 'Asset'}`,
        '',
        summary || intent || 'Describe the purpose and behavior of this asset.',
    ].join('\n');

    // Post-processing: ensure skill longContext has YAML frontmatter
    if (type === 'skill') {
        const fmResult = ensureSkillFrontmatter(finalLongContext, {
            name: name,
            description: summary || intent || '',
        });
        finalLongContext = fmResult.content;
    }

    return {
        type,
        name,
        intent,
        summary: summary || (intent ? intent.slice(0, 140) : `Studio ${type}: ${name || 'draft'}`),
        longContext: finalLongContext,
        sections: { responsibilities, whenToUse },
    };
}

// ─── Generator ──────────────────────────────────────────────────────────────

class StudioAssetGenerator {
    /**
     * @param {Object} options
     * @param {Function} options.getFactory  - async () => AgentSessionFactory (required to create lightweight sessions)
     * @param {string}   [options.defaultModel] - Optional model override
     * @param {boolean}  [options.verbose]
     */
    constructor({ getFactory, defaultModel, verbose = false } = {}) {
        if (typeof getFactory !== 'function') {
            throw new Error('StudioAssetGenerator requires getFactory()');
        }
        this.getFactory = getFactory;
        this.defaultModel = defaultModel || null;
        this.verbose = verbose;
    }

    _log(...args) {
        if (this.verbose) console.log('[StudioAssetGenerator]', ...args);
    }

    /**
     * Generate a rich description for a Studio scaffold asset.
     *
     * @param {Object} input
     * @param {'agent'|'skill'|'mcp-server'|'file'} input.type
     * @param {string} input.name    - Proposed asset name
     * @param {string} [input.intent] - Short description of what this asset should do
     * @param {string} [input.model]  - Override LLM model
     * @returns {Promise<{ type:string, name:string, intent:string, summary:string, longContext:string, sections:Object }>}
     */
    async generateAssetDescription({ type, name, intent, model } = {}) {
        const normalizedType = String(type || '').trim().toLowerCase();
        if (!ASSET_TYPES.has(normalizedType)) {
            const err = new Error(`Unsupported asset type: ${type}`);
            err.status = 400;
            err.code = 'invalid_type';
            throw err;
        }

        const cleanName = String(name || '').trim();
        const cleanIntent = String(intent || '').trim();

        if (!cleanName && !cleanIntent) {
            const err = new Error('Provide at least a name or an intent to generate a description.');
            err.status = 400;
            err.code = 'missing_input';
            throw err;
        }

        const exemplars = loadExemplarsFor(normalizedType);
        const systemPrompt = buildSystemPrompt(normalizedType);
        const userPrompt = buildUserPrompt({ type: normalizedType, name: cleanName, intent: cleanIntent, exemplars });

        const factory = await this.getFactory();
        if (!factory || typeof factory.createLightweightSession !== 'function') {
            const err = new Error('LLM session factory unavailable');
            err.status = 503;
            err.code = 'factory_unavailable';
            throw err;
        }

        this._log(`Generating ${normalizedType} description for "${cleanName || cleanIntent}" (exemplars: ${exemplars.length})`);

        const session = await factory.createLightweightSession(
            `studio-asset-generator:${normalizedType}`,
            systemPrompt,
            { model: model || this.defaultModel || undefined }
        );

        let raw = '';
        try {
            raw = await session.sendAndWait(userPrompt, DEFAULT_TIMEOUT_MS);
        } finally {
            try { await session.destroy(); } catch { /* ignore */ }
        }

        const parsed = extractJson(raw);
        if (!parsed) {
            const err = new Error('Model did not return valid JSON');
            err.status = 502;
            err.code = 'generator_unparseable';
            err.details = { rawSnippet: (raw || '').slice(0, 400) };
            throw err;
        }

        return normalizeResult(parsed, { name: cleanName, intent: cleanIntent, type: normalizedType });
    }
}

module.exports = { StudioAssetGenerator, ASSET_TYPES };
