const fs = require('fs');
const fsP = fs.promises;
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_ROOT = path.join(PROJECT_ROOT, 'studio-workspaces');
const DEFAULT_RUNTIME_ROOT = path.join(PROJECT_ROOT, 'agentic-workflow', 'studio-runtime');
const WORKSPACE_FOLDERS = ['agents', 'skills', 'mcp-servers', 'files', 'notes'];
const TREE_IGNORED = new Set(['.git', '.next', 'build', 'dist', 'node_modules']);
const ASSET_TYPES = new Set(['agent', 'skill', 'mcp-server', 'file']);
const AGENT_TOOL_PROFILES = new Set(['full', 'testgenie', 'scriptgenerator', 'buggenie', 'taskgenie', 'filegenie', 'docgenie', 'codereviewer']);

function createStatusError(message, status = 400, code = null) {
    const error = new Error(message);
    error.status = status;
    if (code) error.code = code;
    return error;
}

function toProjectRelative(targetPath) {
    return path.relative(PROJECT_ROOT, targetPath).split(path.sep).join('/');
}

function normalizeRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function slugify(value, fallback = 'item') {
    const normalized = String(value || '')
        .normalize('NFKD')
        .replace(/[^\w\s.-]/g, '')
        .trim()
        .toLowerCase();

    const slug = normalized
        .replace(/[\s_.]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return slug || fallback;
}

function sanitizeDisplayName(value, label) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) throw createStatusError(`Missing ${label}`);
    return cleaned;
}

function validateIdentifier(value, label) {
    const cleaned = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(cleaned)) {
        throw createStatusError(`Invalid ${label}: ${value}`);
    }
    return cleaned;
}

function normalizeFileName(value) {
    const cleaned = sanitizeDisplayName(value, 'file name');
    const extension = path.extname(cleaned);

    if (!extension) {
        return `${slugify(cleaned, 'note')}.md`;
    }

    const stem = path.basename(cleaned, extension);
    return `${slugify(stem, 'file')}${extension.toLowerCase()}`;
}

function normalizeAgentToolProfile(value) {
    const normalized = String(value || 'full').trim().toLowerCase();
    if (normalized === 'tpm') return 'full';
    if (!AGENT_TOOL_PROFILES.has(normalized)) {
        throw createStatusError(`Unsupported agent toolProfile: ${value}`, 400, 'invalid_tool_profile');
    }
    return normalized;
}

function normalizeFollowupMode(value, toolProfile) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) return normalized;
    return toolProfile === 'full' ? 'default' : toolProfile;
}

async function pathExists(targetPath) {
    try {
        await fsP.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function ensureDir(dirPath) {
    await fsP.mkdir(dirPath, { recursive: true });
}

async function ensureUniqueDirectoryName(parentDir, desiredName) {
    let candidate = desiredName;
    let suffix = 2;

    while (await pathExists(path.join(parentDir, candidate))) {
        candidate = `${desiredName}-${suffix}`;
        suffix += 1;
    }

    return candidate;
}

async function readJson(filePath) {
    const content = await fsP.readFile(filePath, 'utf8');
    return JSON.parse(content);
}

async function writeJson(filePath, value) {
    await fsP.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function listDirectoryEntries(dirPath) {
    try {
        return await fsP.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

function buildWorkspaceReadme(manifest) {
    return [
        `# ${manifest.name}`,
        '',
        'This workspace is isolated from the built-in product agents and skills.',
        '',
        '## Folders',
        '- agents: custom agent manifests and prompts',
        '- skills: workspace-local skill packages',
        '- mcp-servers: custom MCP server code and manifests',
        '- files: notes, configs, and supporting assets',
        '- notes: workspace planning and documentation',
        '',
        '## Lifecycle',
        '- Agents begin in draft state.',
        '- Publish an agent to make it eligible for chat runtime resolution.',
        '- Activate an already published agent to expose it in the merged chat catalog.',
    ].join('\n');
}

function buildAgentPromptTemplate(name, description) {
    return [
        `# ${name}`,
        '',
        '## Purpose',
        description || 'Describe the problem this agent solves and when it should be used.',
        '',
        '## Responsibilities',
        '- Define the primary tasks this agent owns.',
        '- Call out the tools, skills, or MCP servers it can rely on.',
        '- Define the output format and guardrails for responses.',
        '',
        '## Runtime Notes',
        '- Adjust `toolProfile` in `agent.json` to inherit a core execution profile.',
        '- Publish and activate the agent from Studio once the prompt and manifest are ready.',
    ].join('\n');
}

function buildSkillTemplate(name, description, options = {}) {
    const skillName = slugify(name, 'skill');
    const descText = (description || 'Describe what this skill provides and when agents should use it.').slice(0, 1024);
    const keywords = Array.isArray(options.keywords) ? options.keywords : [];

    const frontmatter = [
        '---',
        `name: ${skillName}`,
        `description: '${descText.replace(/'/g, "''")}'`,
    ];
    if (keywords.length > 0) {
        frontmatter.push(`keywords: ${JSON.stringify(keywords)}`);
    }
    if (options.allowedTools && options.allowedTools.length > 0) {
        frontmatter.push(`allowed-tools: ${JSON.stringify(options.allowedTools)}`);
    }
    if (options.agentBinding) {
        frontmatter.push(`agent: ${options.agentBinding}`);
    }
    frontmatter.push('---');

    const body = [
        '',
        `# ${name}`,
        '',
        'Use this skill for [describe purpose] in this repository.',
        '',
        '## When To Use This Skill',
        '',
        'Use this skill when:',
        '- [Describe the first trigger condition]',
        '- [Describe another trigger condition]',
        '',
        `Keywords: ${keywords.length > 0 ? keywords.join(', ') : '[add comma-separated keywords]'}`,
        '',
        '## Instructions',
        '',
        description || '- Add concrete rules, examples, or project conventions.',
        '',
        '## Examples',
        '',
        '- [Add usage examples or sample interactions]',
    ];

    return frontmatter.join('\n') + '\n' + body.join('\n');
}

/**
 * Validate a SKILL.md body against Anthropic skill format constraints.
 * Returns { valid, warnings[], errors[], suggestions[] }.
 *
 * Validation levels:
 *   errors     — MUST fix (blocks save). Missing frontmatter, name, description.
 *   warnings   — SHOULD fix. Name format, body length, missing sections.
 *   suggestions — NICE to have. Examples section, trigger language in description.
 */
function validateSkillContent(content) {
    const errors = [];
    const warnings = [];
    const suggestions = [];

    if (!content || typeof content !== 'string') {
        errors.push('Skill content is empty');
        return { valid: false, warnings, errors, suggestions };
    }

    // Parse frontmatter — REQUIRED per Claude standard
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
        errors.push('Missing YAML frontmatter (must start with --- and end with ---). Use Auto-Fix to generate it.');
    } else {
        const fmBody = fmMatch[1];
        const nameMatch = fmBody.match(/^name:\s*(.+)$/m);
        const descMatch = fmBody.match(/^description:\s*(.+)$/m);

        if (!nameMatch) {
            errors.push('Frontmatter missing required field: name');
        } else {
            const nameVal = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
            if (nameVal.length > 64) errors.push(`Skill name exceeds 64 characters (${nameVal.length})`);
            if (!/^[a-z0-9][a-z0-9-]*$/.test(nameVal)) {
                errors.push('Skill name must use only lowercase letters, numbers, and hyphens (Claude standard)');
            }
        }

        if (!descMatch) {
            errors.push('Frontmatter missing required field: description');
        } else {
            const descVal = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
            if (descVal.length > 1024) errors.push(`Skill description exceeds 1024 characters (${descVal.length})`);
            if (!descVal) errors.push('Skill description must be non-empty');
            // Check for trigger language in description (best practice)
            const hasTriggerLanguage = /\b(use when|use for|when the user|when users|when working|when asked)\b/i.test(descVal);
            if (!hasTriggerLanguage) {
                warnings.push('Description should include trigger language (e.g., "Use when..." or "when the user...") for better skill discovery');
            }
        }
    }

    // Body length check
    const bodyPart = fmMatch ? content.slice(fmMatch[0].length) : content;
    const bodyLines = bodyPart.split('\n').length;
    if (bodyLines > 500) warnings.push(`Skill body is ${bodyLines} lines (recommended max: 500)`);

    // Required sections check
    if (!content.includes('## When To Use')) {
        warnings.push('Missing recommended section: "## When To Use This Skill"');
    }
    if (!content.includes('Keywords:')) {
        warnings.push('Missing recommended Keywords line for skill discovery');
    }
    if (!content.includes('## Examples')) {
        suggestions.push('Consider adding a "## Examples" section with sample interactions');
    }

    return { valid: errors.length === 0, warnings, errors, suggestions };
}

/**
 * Parse the Keywords: line from a SKILL.md body.
 * Returns an array of keyword strings.
 */
function parseSkillKeywords(content) {
    if (!content) return [];
    const keywords = new Set();
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^Keywords\s*:\s*(.+)$/i);
        if (match) {
            for (const kw of match[1].split(',')) {
                const cleaned = kw.trim();
                if (cleaned) keywords.add(cleaned);
            }
        }
    }
    return [...keywords];
}

/**
 * Update the Keywords: line in a SKILL.md body with the given keywords array.
 * If no Keywords: line exists, appends one after the ## When To Use section.
 */
function updateSkillKeywordsLine(content, keywords) {
    if (!content || !Array.isArray(keywords)) return content;
    const newLine = `Keywords: ${keywords.join(', ')}`;

    // Replace existing Keywords: line
    if (/^Keywords\s*:/im.test(content)) {
        return content.replace(/^Keywords\s*:.*$/im, newLine);
    }

    // Insert after "## When To Use" section bullets (before next ## heading or blank line gap)
    const lines = content.split('\n');
    let insertIdx = -1;
    let inWhenToUse = false;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+When To Use/i.test(lines[i])) {
            inWhenToUse = true;
            continue;
        }
        if (inWhenToUse) {
            if (/^##\s+/.test(lines[i])) {
                insertIdx = i;
                break;
            }
            // After the last bullet or content line
            if (lines[i].trim() === '' && i > 0 && lines[i - 1].trim() !== '') {
                insertIdx = i;
                break;
            }
        }
    }

    if (insertIdx >= 0) {
        lines.splice(insertIdx, 0, newLine, '');
        return lines.join('\n');
    }

    // Fallback: append at end
    return content + '\n\n' + newLine + '\n';
}

/**
 * Ensure a SKILL.md body has valid YAML frontmatter.
 * If frontmatter is missing, prepends it using the provided metadata.
 * If frontmatter exists but is missing name/description, fills from metadata.
 *
 * @param {string} content - Raw SKILL.md content
 * @param {Object} metadata - { id, name, description }
 * @returns {{ content: string, modified: boolean }}
 */
function ensureSkillFrontmatter(content, metadata = {}) {
    const raw = content || '';
    const skillName = slugify(metadata.id || metadata.name || 'skill', 'skill');
    const descText = (metadata.description || 'Describe what this skill provides and when agents should use it.').replace(/'/g, "''").slice(0, 1024);

    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

    if (!fmMatch) {
        // No frontmatter at all — prepend it
        const frontmatter = [
            '---',
            `name: ${skillName}`,
            `description: '${descText}'`,
            '---',
            '',
        ].join('\n');
        return { content: frontmatter + raw, modified: true };
    }

    // Frontmatter exists — fill in missing fields
    let fmBody = fmMatch[1];
    let modified = false;
    const hasName = /^name:\s*.+$/m.test(fmBody);
    const hasDesc = /^description:\s*.+$/m.test(fmBody);

    if (!hasName) {
        fmBody = `name: ${skillName}\n` + fmBody;
        modified = true;
    }
    if (!hasDesc) {
        fmBody = fmBody + `\ndescription: '${descText}'`;
        modified = true;
    }

    if (!modified) return { content: raw, modified: false };

    const newFrontmatter = `---\n${fmBody}\n---\n`;
    return { content: newFrontmatter + raw.slice(fmMatch[0].length), modified: true };
}

function buildFileTemplate(name, description) {
    return [
        `# ${name}`,
        '',
        description || 'Add workspace notes, config drafts, or implementation details here.',
    ].join('\n');
}

function buildMcpServerTemplate(name) {
    return [
        '/**',
        ` * Studio MCP scaffold for ${name}.`,
        ' * Replace this stub with a real MCP server implementation before publishing.',
        ' */',
        '',
        "throw new Error('Studio MCP scaffold is not implemented yet. Replace server.js with a real MCP server before publishing.');",
        '',
    ].join('\n');
}

function deriveDefaultCapabilities(toolProfile) {
    switch (toolProfile) {
        case 'scriptgenerator':
            return { browser: true, jira: false, filesystem: 'none' };
        case 'testgenie':
        case 'buggenie':
        case 'taskgenie':
            return { browser: false, jira: true, filesystem: 'none' };
        case 'filegenie':
            return { browser: false, jira: false, filesystem: 'write' };
        case 'docgenie':
        case 'codereviewer':
            return { browser: false, jira: false, filesystem: 'none' };
        case 'full':
        default:
            return { browser: true, jira: true, filesystem: 'read' };
    }
}

function normalizeCapabilities(value, toolProfile) {
    const defaults = deriveDefaultCapabilities(toolProfile);
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const filesystem = String(source.filesystem || defaults.filesystem || 'none').trim().toLowerCase();
    const normalizedFilesystem = ['none', 'read', 'write'].includes(filesystem)
        ? filesystem
        : defaults.filesystem;

    return {
        browser: typeof source.browser === 'boolean' ? source.browser : defaults.browser,
        jira: typeof source.jira === 'boolean' ? source.jira : defaults.jira,
        filesystem: normalizedFilesystem,
    };
}

function buildFileRef(rootDir, absolutePath, label = null) {
    return {
        label,
        path: toProjectRelative(absolutePath),
        relativePath: path.relative(rootDir, absolutePath).split(path.sep).join('/'),
    };
}

class StudioWorkspaceRegistry {
    constructor(options = {}) {
        this.sourceRoot = options.sourceRoot || DEFAULT_SOURCE_ROOT;
        this.runtimeRoot = options.runtimeRoot || DEFAULT_RUNTIME_ROOT;
    }

    get sourceRootRelative() {
        return toProjectRelative(this.sourceRoot);
    }

    get runtimeRootRelative() {
        return toProjectRelative(this.runtimeRoot);
    }

    async ensureBaseStructure() {
        await Promise.all([
            ensureDir(this.sourceRoot),
            ensureDir(this.runtimeRoot),
        ]);
    }

    async listWorkspaces() {
        await this.ensureBaseStructure();
        const entries = await listDirectoryEntries(this.sourceRoot);
        const workspaces = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            try {
                workspaces.push(await this.getWorkspaceSummary(entry.name));
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }

        return workspaces.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    }

    async createWorkspace({ name, description = '', createdBy = 'studio-ui' } = {}) {
        await this.ensureBaseStructure();

        const displayName = sanitizeDisplayName(name, 'workspace name');
        const workspaceId = await ensureUniqueDirectoryName(this.sourceRoot, slugify(displayName, 'workspace'));
        const now = new Date().toISOString();
        const sourceRoot = path.join(this.sourceRoot, workspaceId);
        const runtimeRoot = path.join(this.runtimeRoot, workspaceId);

        await ensureDir(sourceRoot);
        await ensureDir(runtimeRoot);
        await Promise.all(WORKSPACE_FOLDERS.map(folder => ensureDir(path.join(sourceRoot, folder))));

        const manifest = {
            kind: 'studio-workspace',
            version: 1,
            id: workspaceId,
            name: displayName,
            description: String(description || '').trim(),
            status: 'draft',
            visibility: 'workspace',
            createdBy,
            createdAt: now,
            updatedAt: now,
            paths: {
                root: toProjectRelative(sourceRoot),
                manifest: toProjectRelative(path.join(sourceRoot, 'workspace.json')),
                readme: toProjectRelative(path.join(sourceRoot, 'README.md')),
                agents: toProjectRelative(path.join(sourceRoot, 'agents')),
                skills: toProjectRelative(path.join(sourceRoot, 'skills')),
                mcpServers: toProjectRelative(path.join(sourceRoot, 'mcp-servers')),
                files: toProjectRelative(path.join(sourceRoot, 'files')),
                notes: toProjectRelative(path.join(sourceRoot, 'notes')),
            },
            runtime: {
                root: toProjectRelative(runtimeRoot),
            },
        };

        await Promise.all([
            writeJson(path.join(sourceRoot, 'workspace.json'), manifest),
            fsP.writeFile(path.join(sourceRoot, 'README.md'), `${buildWorkspaceReadme(manifest)}\n`, 'utf8'),
        ]);

        return this.getWorkspaceSummary(workspaceId);
    }

    async getWorkspaceSummary(workspaceId) {
        const manifest = await this._readWorkspaceManifest(workspaceId);
        const catalog = await this.getWorkspaceCatalog(workspaceId);

        return {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            status: manifest.status,
            visibility: manifest.visibility,
            createdBy: manifest.createdBy,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            sourceRoot: manifest.paths.root,
            runtimeRoot: manifest.runtime.root,
            counts: catalog.counts,
        };
    }

    async getWorkspaceCatalog(workspaceId) {
        const manifest = await this._readWorkspaceManifest(workspaceId);
        const paths = this._getWorkspacePaths(workspaceId);

        const [agents, skills, mcpServers, files] = await Promise.all([
            this._listManifestAssets(paths.root, paths.agents, 'agent.json', 'agent'),
            this._listManifestAssets(paths.root, paths.skills, 'skill.json', 'skill'),
            this._listManifestAssets(paths.root, paths.mcpServers, 'mcp.json', 'mcp-server'),
            this._listFileAssets(paths.root, paths.files, paths.files),
        ]);

        return {
            workspace: {
                id: manifest.id,
                name: manifest.name,
                description: manifest.description,
                status: manifest.status,
                visibility: manifest.visibility,
                createdBy: manifest.createdBy,
                createdAt: manifest.createdAt,
                updatedAt: manifest.updatedAt,
                sourceRoot: manifest.paths.root,
                runtimeRoot: manifest.runtime.root,
                readmePath: manifest.paths.readme,
                manifestPath: manifest.paths.manifest,
            },
            counts: {
                agents: agents.length,
                skills: skills.length,
                mcpServers: mcpServers.length,
                files: files.length,
            },
            assets: {
                agents,
                skills,
                mcpServers,
                files,
            },
        };
    }

    async getWorkspaceTree(workspaceId, options = {}) {
        const depth = Math.max(1, Math.min(Number.parseInt(options.depth, 10) || 4, 6));
        const manifest = await this._readWorkspaceManifest(workspaceId);
        const paths = this._getWorkspacePaths(workspaceId);

        return {
            workspace: {
                id: manifest.id,
                name: manifest.name,
                sourceRoot: manifest.paths.root,
            },
            depth,
            tree: await this._buildTree(paths.root, paths.root, depth),
        };
    }

    async createAsset(workspaceId, payload = {}) {
        const manifest = await this._readWorkspaceManifest(workspaceId);
        const type = String(payload.type || '').trim();

        if (!ASSET_TYPES.has(type)) {
            throw createStatusError(`Unsupported asset type: ${type}`);
        }

        const asset = await this._createAsset(manifest, {
            type,
            name: payload.name,
            description: payload.description,
            longContext: payload.longContext,
        });

        return {
            asset,
            catalog: await this.getWorkspaceCatalog(workspaceId),
        };
    }

    async getWorkspaceAgent(workspaceId, agentId) {
        const asset = await this._readAssetManifest(workspaceId, 'agent', agentId, 'agent.json');
        return this._decorateManifestAsset(asset.workspaceRoot, 'agent', asset.assetDir, asset.manifestPath, asset.manifest);
    }

    async getSkill(workspaceId, skillId) {
        const asset = await this._readAssetManifest(workspaceId, 'skill', skillId, 'skill.json');
        const skillFile = path.join(asset.assetDir, asset.manifest.entry?.instruction || 'SKILL.md');
        let skillContent = '';
        try {
            skillContent = await fsP.readFile(skillFile, 'utf8');
        } catch (_) { /* skill file may not exist yet */ }

        // List supporting files (references/ directory, etc.)
        const supportingFiles = [];
        try {
            const entries = await fsP.readdir(asset.assetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'skill.json' || entry.name === 'SKILL.md') continue;
                supportingFiles.push({
                    name: entry.name,
                    isDirectory: entry.isDirectory(),
                    path: `skills/${skillId}/${entry.name}`,
                });
            }
        } catch (_) { /* ignore readdir errors */ }

        // Merge keywords from SKILL.md body into the response (bidirectional sync)
        const bodyKeywords = parseSkillKeywords(skillContent);
        const manifestKeywords = Array.isArray(asset.manifest.keywords) ? asset.manifest.keywords : [];
        const mergedKeywords = [...new Set([...manifestKeywords, ...bodyKeywords])];

        const decorated = this._decorateManifestAsset(asset.workspaceRoot, 'skill', asset.assetDir, asset.manifestPath, asset.manifest);
        return {
            ...decorated,
            keywords: mergedKeywords,
            skillContent,
            supportingFiles,
            validation: validateSkillContent(skillContent),
        };
    }

    async updateSkill(workspaceId, skillId, payload = {}) {
        const { manifest, manifestPath, assetDir } = await this._readAssetManifest(workspaceId, 'skill', skillId, 'skill.json');
        const now = new Date().toISOString();

        const nextManifest = { ...manifest, updatedAt: now };

        if (payload.name !== undefined) nextManifest.name = sanitizeDisplayName(payload.name, 'Skill name');
        if (payload.description !== undefined) nextManifest.description = String(payload.description || '').trim().slice(0, 1024);
        if (Array.isArray(payload.keywords)) nextManifest.keywords = payload.keywords.map(k => String(k).trim()).filter(Boolean);
        if (Array.isArray(payload.allowedTools)) nextManifest.allowedTools = payload.allowedTools.map(t => String(t).trim()).filter(Boolean);
        if (Array.isArray(payload.agentBindings)) nextManifest.agentBindings = payload.agentBindings.map(a => String(a).trim()).filter(Boolean);
        if (payload.alwaysActiveForBoundAgents !== undefined) nextManifest.alwaysActiveForBoundAgents = !!payload.alwaysActiveForBoundAgents;

        const writes = [writeJson(manifestPath, nextManifest)];

        // Update SKILL.md content if provided
        if (payload.skillContent !== undefined) {
            // Ensure frontmatter before validation
            const fmResult = ensureSkillFrontmatter(payload.skillContent, {
                id: manifest.id || skillId,
                name: payload.name || manifest.name,
                description: payload.description || manifest.description,
            });

            const validation = validateSkillContent(fmResult.content);
            if (!validation.valid) {
                throw createStatusError(
                    `Skill content validation failed: ${validation.errors.join('; ')}`,
                    400,
                    'skill_validation_error'
                );
            }

            // Bidirectional keyword sync: if manifest keywords were updated, update the SKILL.md body
            let finalContent = fmResult.content;
            if (Array.isArray(payload.keywords) && payload.keywords.length > 0) {
                finalContent = updateSkillKeywordsLine(finalContent, payload.keywords);
            }

            const skillFile = path.join(assetDir, manifest.entry?.instruction || 'SKILL.md');
            writes.push(fsP.writeFile(skillFile, finalContent, 'utf8'));

            // Sync keywords from SKILL.md back to manifest
            const bodyKeywords = parseSkillKeywords(finalContent);
            if (bodyKeywords.length > 0) {
                nextManifest.keywords = [...new Set([...(nextManifest.keywords || []), ...bodyKeywords])];
            }
        } else if (Array.isArray(payload.keywords) && payload.keywords.length > 0) {
            // Keywords updated without content change — update the Keywords: line in existing SKILL.md
            const skillFile = path.join(assetDir, manifest.entry?.instruction || 'SKILL.md');
            try {
                const existing = await fsP.readFile(skillFile, 'utf8');
                const updated = updateSkillKeywordsLine(existing, payload.keywords);
                if (updated !== existing) {
                    writes.push(fsP.writeFile(skillFile, updated, 'utf8'));
                }
            } catch (_) { /* skill file may not exist */ }
        }

        await Promise.all(writes);
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId), now);

        return this.getSkill(workspaceId, skillId);
    }

    async validateSkill(workspaceId, skillId) {
        const skill = await this.getSkill(workspaceId, skillId);
        return {
            id: skillId,
            name: skill.name,
            validation: skill.validation,
        };
    }

    async publishAgent(workspaceId, agentId, options = {}) {
        const activate = options.activate !== false;
        const { manifest, manifestPath, assetDir } = await this._readAssetManifest(workspaceId, 'agent', agentId, 'agent.json');
        const now = new Date().toISOString();
        const toolProfile = normalizeAgentToolProfile(manifest.toolProfile || manifest.baseAgent || 'full');
        const promptFile = String(manifest.entry?.prompt || '').trim();

        if (!promptFile) {
            throw createStatusError('Agent manifest must define entry.prompt before publishing', 400, 'missing_prompt_entry');
        }

        const promptPath = path.join(assetDir, promptFile);
        if (!await pathExists(promptPath)) {
            throw createStatusError(`Prompt file not found: ${toProjectRelative(promptPath)}`, 400, 'missing_prompt_file');
        }

        const nextManifest = {
            ...manifest,
            status: 'published',
            toolProfile,
            followupMode: normalizeFollowupMode(manifest.followupMode, toolProfile),
            capabilities: normalizeCapabilities(manifest.capabilities, toolProfile),
            updatedAt: now,
            activation: {
                ...(manifest.activation && typeof manifest.activation === 'object' ? manifest.activation : {}),
                active: activate,
                publishedAt: manifest.activation?.publishedAt || now,
                activatedAt: activate ? now : (manifest.activation?.activatedAt || null),
            },
        };

        await writeJson(manifestPath, nextManifest);
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId), now);

        return {
            agent: this._decorateManifestAsset(this._getWorkspacePaths(workspaceId).root, 'agent', assetDir, manifestPath, nextManifest),
            catalog: await this.getWorkspaceCatalog(workspaceId),
        };
    }

    async setAgentActivation(workspaceId, agentId, active) {
        const desiredActive = !!active;
        const { manifest, manifestPath, assetDir } = await this._readAssetManifest(workspaceId, 'agent', agentId, 'agent.json');
        if (manifest.status !== 'published') {
            throw createStatusError('Only published agents can be activated', 409, 'agent_not_published');
        }

        const now = new Date().toISOString();
        const nextManifest = {
            ...manifest,
            updatedAt: now,
            activation: {
                ...(manifest.activation && typeof manifest.activation === 'object' ? manifest.activation : {}),
                active: desiredActive,
                publishedAt: manifest.activation?.publishedAt || now,
                activatedAt: desiredActive ? now : null,
            },
        };

        await writeJson(manifestPath, nextManifest);
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId), now);

        return {
            agent: this._decorateManifestAsset(this._getWorkspacePaths(workspaceId).root, 'agent', assetDir, manifestPath, nextManifest),
            catalog: await this.getWorkspaceCatalog(workspaceId),
        };
    }

    async deleteWorkspace(workspaceId, options = {}) {
        const manifest = await this._readWorkspaceManifest(workspaceId);
        const paths = this._getWorkspacePaths(manifest.id);
        const force = options.force === true || String(options.force || '').toLowerCase() === 'true';

        const catalog = await this.getWorkspaceCatalog(manifest.id);
        const activeAgents = (catalog.assets.agents || []).filter(agent => agent.status === 'published' && agent.isActive);
        if (activeAgents.length > 0 && !force) {
            const error = createStatusError(
                `Workspace has ${activeAgents.length} active published agent(s). Pass force=true to delete anyway.`,
                409,
                'workspace_has_active_agents'
            );
            error.details = {
                activeAgents: activeAgents.map(agent => ({ id: agent.id, name: agent.name })),
            };
            throw error;
        }

        const runtimeRoot = path.join(this.runtimeRoot, manifest.id);
        await fsP.rm(paths.root, { recursive: true, force: true });
        await fsP.rm(runtimeRoot, { recursive: true, force: true });

        return {
            id: manifest.id,
            deleted: true,
            removedActiveAgents: activeAgents.map(agent => agent.id),
        };
    }

    async deleteAsset(workspaceId, type, assetId) {
        if (!ASSET_TYPES.has(type)) {
            throw createStatusError(`Unsupported asset type: ${type}`, 400, 'invalid_asset_type');
        }
        if (type === 'file') {
            throw createStatusError('Use deleteFile for file assets', 400, 'invalid_asset_type');
        }

        const manifestFile = type === 'agent' ? 'agent.json' : type === 'skill' ? 'skill.json' : 'mcp.json';
        const { assetDir } = await this._readAssetManifest(workspaceId, type, assetId, manifestFile);
        const paths = this._getWorkspacePaths(workspaceId);

        this._assertPathUnderRoot(assetDir, paths.root);
        await fsP.rm(assetDir, { recursive: true, force: true });
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId));

        return {
            id: assetId,
            type,
            deleted: true,
            catalog: await this.getWorkspaceCatalog(workspaceId),
        };
    }

    async deleteFile(workspaceId, requestedPath) {
        const paths = this._getWorkspacePaths(workspaceId);
        const { absolutePath, relativePath } = this._resolveWorkspaceFilePath(workspaceId, requestedPath);

        // Only allow deletion inside the files/ subtree — protect manifests, README, agents/skills/mcp folders.
        const filesRoot = `${path.resolve(paths.files)}${path.sep}`;
        if (!absolutePath.startsWith(filesRoot)) {
            throw createStatusError(
                `Only files under files/ can be deleted: ${relativePath}`,
                403,
                'workspace_file_protected'
            );
        }

        if (!await pathExists(absolutePath)) {
            throw createStatusError(`Workspace file not found: ${relativePath}`, 404, 'workspace_file_not_found');
        }

        const stat = await fsP.stat(absolutePath);
        if (stat.isDirectory()) {
            throw createStatusError(`Path is a directory, not a file: ${relativePath}`, 400, 'workspace_path_is_directory');
        }

        await fsP.unlink(absolutePath);
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId));

        return {
            path: relativePath,
            deleted: true,
            catalog: await this.getWorkspaceCatalog(workspaceId),
        };
    }

    _assertPathUnderRoot(targetPath, root) {
        const resolvedRoot = `${path.resolve(root)}${path.sep}`;
        const resolvedTarget = path.resolve(targetPath);
        if (resolvedTarget !== path.resolve(root) && !resolvedTarget.startsWith(resolvedRoot)) {
            throw createStatusError(`Path escapes workspace root: ${targetPath}`, 403, 'workspace_path_escape');
        }
    }

    async readWorkspaceFile(workspaceId, requestedPath) {
        const { absolutePath, relativePath } = this._resolveWorkspaceFilePath(workspaceId, requestedPath);

        try {
            const content = await fsP.readFile(absolutePath, 'utf8');
            return {
                path: toProjectRelative(absolutePath),
                relativePath,
                extension: path.extname(absolutePath).toLowerCase() || null,
                isManifest: path.basename(absolutePath).endsWith('.json'),
                content,
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw createStatusError(`Workspace file not found: ${relativePath}`, 404, 'workspace_file_not_found');
            }
            throw error;
        }
    }

    async writeWorkspaceFile(workspaceId, requestedPath, content) {
        const { absolutePath } = this._resolveWorkspaceFilePath(workspaceId, requestedPath);
        if (!await pathExists(absolutePath)) {
            throw createStatusError(`Workspace file not found: ${requestedPath}`, 404, 'workspace_file_not_found');
        }

        const now = new Date().toISOString();
        const extension = path.extname(absolutePath).toLowerCase();
        let nextContent = String(content ?? '');

        if (extension === '.json') {
            let parsed;
            try {
                parsed = JSON.parse(nextContent);
            } catch (error) {
                throw createStatusError(`Invalid JSON: ${error.message}`, 400, 'invalid_json');
            }

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                parsed.updatedAt = now;

                if (parsed.kind === 'studio-agent') {
                    const toolProfile = normalizeAgentToolProfile(parsed.toolProfile || parsed.baseAgent || 'full');
                    parsed.toolProfile = toolProfile;
                    parsed.followupMode = normalizeFollowupMode(parsed.followupMode, toolProfile);
                    parsed.capabilities = normalizeCapabilities(parsed.capabilities, toolProfile);
                    parsed.activation = {
                        active: !!parsed.activation?.active,
                        publishedAt: parsed.activation?.publishedAt || null,
                        activatedAt: parsed.activation?.active ? (parsed.activation?.activatedAt || now) : null,
                    };
                }
            }

            nextContent = `${JSON.stringify(parsed, null, 2)}\n`;
        }

        await fsP.writeFile(absolutePath, nextContent, 'utf8');
        await this._touchWorkspace(await this._readWorkspaceManifest(workspaceId), now);

        return this.readWorkspaceFile(workspaceId, requestedPath);
    }

    async _createAsset(manifest, { type, name, description = '', longContext = '' }) {
        const workspaceId = manifest.id;
        const paths = this._getWorkspacePaths(workspaceId);
        const displayName = sanitizeDisplayName(name, `${type} name`);
        const now = new Date().toISOString();
        const richBody = typeof longContext === 'string' ? longContext.trim() : '';
        let result = null;

        if (type === 'agent') {
            const assetId = await ensureUniqueDirectoryName(paths.agents, slugify(displayName, 'agent'));
            const assetDir = path.join(paths.agents, assetId);
            const toolProfile = 'full';
            const assetManifest = {
                kind: 'studio-agent',
                version: 1,
                id: assetId,
                name: displayName,
                shortLabel: displayName.slice(0, 3).toUpperCase(),
                description: String(description || '').trim(),
                workspaceId,
                status: 'draft',
                visibility: 'workspace',
                surfaces: ['chat'],
                baseAgent: 'tpm',
                toolProfile,
                followupMode: 'default',
                capabilities: normalizeCapabilities({}, toolProfile),
                model: { id: 'claude-sonnet-4-6', speed: 'standard' },
                mcpServers: [],
                skills: [],
                tags: [],
                category: 'custom',
                permissionMode: 'default',
                maxTurns: 50,
                maxBudgetUsd: null,
                activation: {
                    active: false,
                    publishedAt: null,
                    activatedAt: null,
                },
                entry: {
                    prompt: 'prompt.md',
                },
                createdAt: now,
                updatedAt: now,
            };

            const agentPromptBody = richBody || buildAgentPromptTemplate(displayName, description);
            await ensureDir(assetDir);

            // Auto-populate agent's skills[] with all existing workspace skills
            const workspaceSkillIds = await this._getWorkspaceSkillIds(paths.skills);
            assetManifest.skills = workspaceSkillIds;

            await Promise.all([
                writeJson(path.join(assetDir, 'agent.json'), assetManifest),
                fsP.writeFile(path.join(assetDir, 'prompt.md'), `${agentPromptBody}\n`, 'utf8'),
            ]);

            // Backfill: add this agent to all existing workspace skills' agentBindings
            await this._backfillSkillBindings(paths.skills, assetId);

            result = this._decorateManifestAsset(paths.root, 'agent', assetDir, path.join(assetDir, 'agent.json'), assetManifest);
        }

        if (type === 'skill') {
            const assetId = await ensureUniqueDirectoryName(paths.skills, slugify(displayName, 'skill'));
            const assetDir = path.join(paths.skills, assetId);

            let skillBody = richBody || buildSkillTemplate(displayName, description);

            // Ensure frontmatter is present (covers AI-generated richBody that may lack it)
            const fmResult = ensureSkillFrontmatter(skillBody, {
                id: assetId,
                name: displayName,
                description: description,
            });
            skillBody = fmResult.content;

            // Parse keywords from the generated body for bidirectional sync
            const bodyKeywords = parseSkillKeywords(skillBody);

            // Auto-populate agentBindings with all agents in the same workspace
            const autoBindings = await this._getWorkspaceAgentIds(paths.agents);

            const assetManifest = {
                kind: 'studio-skill',
                version: 1,
                id: assetId,
                name: displayName,
                description: String(description || '').trim(),
                workspaceId,
                status: 'draft',
                keywords: bodyKeywords,
                allowedTools: [],
                agentBindings: autoBindings,
                alwaysActiveForBoundAgents: false,
                entry: {
                    instruction: 'SKILL.md',
                },
                createdAt: now,
                updatedAt: now,
            };

            await ensureDir(assetDir);
            await Promise.all([
                writeJson(path.join(assetDir, 'skill.json'), assetManifest),
                fsP.writeFile(path.join(assetDir, 'SKILL.md'), `${skillBody}\n`, 'utf8'),
            ]);

            result = this._decorateManifestAsset(paths.root, 'skill', assetDir, path.join(assetDir, 'skill.json'), assetManifest);
        }

        if (type === 'mcp-server') {
            const assetId = await ensureUniqueDirectoryName(paths.mcpServers, slugify(displayName, 'mcp-server'));
            const assetDir = path.join(paths.mcpServers, assetId);
            const assetManifest = {
                kind: 'studio-mcp-server',
                version: 1,
                id: assetId,
                name: displayName,
                description: String(description || '').trim(),
                workspaceId,
                status: 'draft',
                enabled: false,
                connection: {
                    type: 'local',
                    command: 'node',
                    args: ['server.js'],
                },
                entry: {
                    server: 'server.js',
                },
                createdAt: now,
                updatedAt: now,
            };

            await ensureDir(assetDir);
            const mcpWrites = [
                writeJson(path.join(assetDir, 'mcp.json'), assetManifest),
                fsP.writeFile(path.join(assetDir, 'server.js'), buildMcpServerTemplate(displayName), 'utf8'),
            ];
            if (richBody) {
                mcpWrites.push(fsP.writeFile(path.join(assetDir, 'README.md'), `${richBody}\n`, 'utf8'));
            }
            await Promise.all(mcpWrites);

            result = this._decorateManifestAsset(paths.root, 'mcp-server', assetDir, path.join(assetDir, 'mcp.json'), assetManifest);
        }

        if (type === 'file') {
            const fileName = await this._createUniqueFileName(paths.files, normalizeFileName(displayName));
            const filePath = path.join(paths.files, fileName);
            const fileBody = richBody || buildFileTemplate(displayName, description);

            await fsP.writeFile(filePath, `${fileBody}\n`, 'utf8');

            result = {
                type,
                id: fileName,
                name: displayName,
                status: 'draft',
                path: toProjectRelative(filePath),
                relativePath: path.relative(paths.root, filePath).split(path.sep).join('/'),
            };
        }

        await this._touchWorkspace(manifest, now);
        return result;
    }

    async _touchWorkspace(manifest, updatedAt = new Date().toISOString()) {
        const nextManifest = {
            ...manifest,
            updatedAt,
        };

        await writeJson(this._getWorkspacePaths(manifest.id).manifest, nextManifest);
    }

    async _createUniqueFileName(parentDir, initialFileName) {
        const extension = path.extname(initialFileName);
        const stem = path.basename(initialFileName, extension);
        let candidate = initialFileName;
        let suffix = 2;

        while (await pathExists(path.join(parentDir, candidate))) {
            candidate = `${stem}-${suffix}${extension}`;
            suffix += 1;
        }

        return candidate;
    }

    async _readWorkspaceManifest(workspaceId) {
        const safeWorkspaceId = validateIdentifier(workspaceId, 'workspaceId');
        const manifestPath = this._getWorkspacePaths(safeWorkspaceId).manifest;

        try {
            return await readJson(manifestPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw createStatusError(`Workspace not found: ${safeWorkspaceId}`, 404, 'workspace_not_found');
            }
            throw error;
        }
    }

    async _readAssetManifest(workspaceId, type, assetId, manifestFileName) {
        const paths = this._getWorkspacePaths(workspaceId);
        const safeAssetId = validateIdentifier(assetId, `${type}Id`);
        const parentDir = type === 'agent'
            ? paths.agents
            : type === 'skill'
                ? paths.skills
                : paths.mcpServers;
        const assetDir = path.join(parentDir, safeAssetId);
        const manifestPath = path.join(assetDir, manifestFileName);

        try {
            const manifest = await readJson(manifestPath);
            return { manifest, manifestPath, assetDir, workspaceRoot: paths.root };
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw createStatusError(`${type} not found: ${safeAssetId}`, 404, `${type}_not_found`);
            }
            throw error;
        }
    }

    _getWorkspacePaths(workspaceId) {
        const safeWorkspaceId = validateIdentifier(workspaceId, 'workspaceId');
        const root = path.join(this.sourceRoot, safeWorkspaceId);

        return {
            root,
            manifest: path.join(root, 'workspace.json'),
            agents: path.join(root, 'agents'),
            skills: path.join(root, 'skills'),
            mcpServers: path.join(root, 'mcp-servers'),
            files: path.join(root, 'files'),
            notes: path.join(root, 'notes'),
        };
    }

    /**
     * Get all agent IDs from a workspace's agents directory.
     * Used to auto-populate agentBindings when a skill is created.
     * @param {string} agentsDir - Absolute path to the workspace's agents/ directory
     * @returns {Promise<string[]>} Agent IDs
     */
    async _getWorkspaceAgentIds(agentsDir) {
        try {
            if (!fs.existsSync(agentsDir)) return [];
            const entries = await fsP.readdir(agentsDir, { withFileTypes: true });
            const ids = [];
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const manifestPath = path.join(agentsDir, entry.name, 'agent.json');
                if (fs.existsSync(manifestPath)) {
                    ids.push(entry.name);
                }
            }
            return ids;
        } catch {
            return [];
        }
    }

    /**
     * Get all skill IDs from a workspace's skills directory.
     * Used to auto-populate agent's skills[] when an agent is created.
     * @param {string} skillsDir - Absolute path to the workspace's skills/ directory
     * @returns {Promise<string[]>} Skill IDs
     */
    async _getWorkspaceSkillIds(skillsDir) {
        try {
            if (!fs.existsSync(skillsDir)) return [];
            const entries = await fsP.readdir(skillsDir, { withFileTypes: true });
            const ids = [];
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const manifestPath = path.join(skillsDir, entry.name, 'skill.json');
                if (fs.existsSync(manifestPath)) {
                    ids.push(entry.name);
                }
            }
            return ids;
        } catch {
            return [];
        }
    }

    /**
     * Backfill: add a new agent ID to all existing skills' agentBindings in the workspace.
     * Called when an agent is created so existing skills auto-bind to the new agent.
     * @param {string} skillsDir - Absolute path to the workspace's skills/ directory
     * @param {string} agentId - The new agent's ID to add
     */
    async _backfillSkillBindings(skillsDir, agentId) {
        try {
            if (!fs.existsSync(skillsDir)) return;
            const entries = await fsP.readdir(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const manifestPath = path.join(skillsDir, entry.name, 'skill.json');
                if (!fs.existsSync(manifestPath)) continue;
                try {
                    const manifest = JSON.parse(await fsP.readFile(manifestPath, 'utf8'));
                    const bindings = Array.isArray(manifest.agentBindings) ? manifest.agentBindings : [];
                    if (!bindings.includes(agentId)) {
                        manifest.agentBindings = [...bindings, agentId];
                        manifest.updatedAt = new Date().toISOString();
                        await writeJson(manifestPath, manifest);
                    }
                } catch {
                    // Skip malformed manifests
                }
            }
        } catch {
            // Non-blocking — don't fail agent creation if backfill errors
        }
    }

    _resolveWorkspaceFilePath(workspaceId, requestedPath) {
        const paths = this._getWorkspacePaths(workspaceId);
        const normalizedInput = normalizeRelativePath(requestedPath);
        if (!normalizedInput) {
            throw createStatusError('Missing workspace file path', 400, 'missing_workspace_file_path');
        }

        const rootRelative = toProjectRelative(paths.root);
        const relativePath = normalizedInput.startsWith(`${rootRelative}/`)
            ? normalizedInput.slice(rootRelative.length + 1)
            : normalizedInput;

        const absolutePath = path.resolve(paths.root, relativePath);
        const normalizedRoot = `${path.resolve(paths.root)}${path.sep}`;
        if (absolutePath !== path.resolve(paths.root) && !absolutePath.startsWith(normalizedRoot)) {
            throw createStatusError(`Path escapes workspace root: ${requestedPath}`, 403, 'workspace_path_escape');
        }

        return {
            absolutePath,
            relativePath: path.relative(paths.root, absolutePath).split(path.sep).join('/'),
        };
    }

    _decorateManifestAsset(workspaceRoot, type, assetDir, manifestPath, manifest) {
        const files = this._buildAssetFiles(workspaceRoot, assetDir, manifestPath, manifest);
        const activation = manifest.activation && typeof manifest.activation === 'object' ? manifest.activation : {};
        const toolProfile = type === 'agent'
            ? normalizeAgentToolProfile(manifest.toolProfile || manifest.baseAgent || 'full')
            : null;
        const capabilities = type === 'agent'
            ? normalizeCapabilities(manifest.capabilities, toolProfile)
            : null;
        const promptPath = type === 'agent' && typeof manifest.entry?.prompt === 'string'
            ? toProjectRelative(path.join(assetDir, manifest.entry.prompt))
            : null;

        return {
            type,
            id: manifest.id,
            name: manifest.name,
            shortLabel: manifest.shortLabel || null,
            description: manifest.description,
            status: manifest.status,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            path: toProjectRelative(assetDir),
            manifestPath: toProjectRelative(manifestPath),
            relativePath: path.relative(workspaceRoot, assetDir).split(path.sep).join('/'),
            visibility: manifest.visibility || null,
            workspaceId: manifest.workspaceId || null,
            toolProfile,
            baseAgent: manifest.baseAgent || null,
            followupMode: type === 'agent' ? normalizeFollowupMode(manifest.followupMode, toolProfile) : null,
            capabilities,
            surfaces: Array.isArray(manifest.surfaces) ? manifest.surfaces : [],
            isActive: activation.active === true,
            publishedAt: activation.publishedAt || null,
            activatedAt: activation.activatedAt || null,
            promptPath,
            files,
        };
    }

    _buildAssetFiles(workspaceRoot, assetDir, manifestPath, manifest) {
        const files = [buildFileRef(workspaceRoot, manifestPath, 'Manifest')];
        const entries = manifest.entry && typeof manifest.entry === 'object' && !Array.isArray(manifest.entry)
            ? manifest.entry
            : {};

        for (const [entryKey, entryValue] of Object.entries(entries)) {
            if (typeof entryValue !== 'string' || !entryValue.trim()) continue;
            files.push(buildFileRef(workspaceRoot, path.join(assetDir, entryValue), entryKey.charAt(0).toUpperCase() + entryKey.slice(1)));
        }

        return files;
    }

    async _listManifestAssets(workspaceRoot, parentDir, manifestFileName, type) {
        const entries = await listDirectoryEntries(parentDir);
        const assets = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (TREE_IGNORED.has(entry.name)) continue;

            const assetDir = path.join(parentDir, entry.name);
            const manifestPath = path.join(assetDir, manifestFileName);
            if (!await pathExists(manifestPath)) continue;

            const manifest = await readJson(manifestPath);
            assets.push(this._decorateManifestAsset(workspaceRoot, type, assetDir, manifestPath, manifest));
        }

        return assets.sort((left, right) => left.name.localeCompare(right.name));
    }

    async _listFileAssets(workspaceRoot, currentDir, baseDir) {
        const entries = await listDirectoryEntries(currentDir);
        const files = [];

        for (const entry of entries) {
            if (TREE_IGNORED.has(entry.name)) continue;

            const target = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this._listFileAssets(workspaceRoot, target, baseDir));
                continue;
            }

            const relativePath = path.relative(baseDir, target).split(path.sep).join('/');
            files.push({
                type: 'file',
                id: relativePath,
                name: entry.name,
                extension: path.extname(entry.name) || null,
                path: toProjectRelative(target),
                relativePath: path.relative(workspaceRoot, target).split(path.sep).join('/'),
            });
        }

        return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }

    async _buildTree(rootPath, currentPath, depth) {
        const stats = await fsP.stat(currentPath);
        const baseNode = {
            name: path.basename(currentPath),
            path: toProjectRelative(currentPath),
            relativePath: path.relative(rootPath, currentPath).split(path.sep).join('/'),
            type: stats.isDirectory() ? 'directory' : 'file',
        };

        if (!stats.isDirectory()) {
            baseNode.size = stats.size;
            return baseNode;
        }

        if (depth <= 0) {
            baseNode.truncated = true;
            return baseNode;
        }

        const entries = await listDirectoryEntries(currentPath);
        const children = [];

        for (const entry of entries) {
            if (TREE_IGNORED.has(entry.name)) continue;
            const childPath = path.join(currentPath, entry.name);
            children.push(await this._buildTree(rootPath, childPath, depth - 1));
        }

        baseNode.children = children.sort((left, right) => {
            if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
            return left.name.localeCompare(right.name);
        });

        return baseNode;
    }
}

module.exports = {
    StudioWorkspaceRegistry,
    DEFAULT_SOURCE_ROOT,
    DEFAULT_RUNTIME_ROOT,
    validateSkillContent,
    ensureSkillFrontmatter,
    parseSkillKeywords,
    updateSkillKeywordsLine,
};