/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT CONFIG EXPORTER / IMPORTER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Multi-format export/import for agent configurations.
 * Supports: JSON, YAML, .agent.md (VS Code format), TypeScript
 *
 * Consumed by:
 *   - GET  /api/studio/workspaces/:id/agents/:agentId/export?format=yaml
 *   - POST /api/studio/import-agent  (body: { format, content, workspaceId })
 *
 * @module sdk-orchestrator/agent-config-exporter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const SUPPORTED_EXPORT_FORMATS = ['json', 'yaml', 'agent-md', 'typescript'];

// ─── YAML Serializer (minimal, no dependency) ──────────────────────────────

function toYamlValue(value, indent = 0) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
        if (value.includes('\n')) {
            const pad = ' '.repeat(indent + 2);
            return `|\n${value.split('\n').map(line => `${pad}${line}`).join('\n')}`;
        }
        if (/[:#{}[\],&*?|>!%@`]/.test(value) || value === '' || value !== value.trim()) {
            return JSON.stringify(value);
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const pad = ' '.repeat(indent);
        return '\n' + value.map(item => {
            if (typeof item === 'object' && item !== null) {
                const objYaml = toYamlObject(item, indent + 2);
                // First key on same line as dash
                const lines = objYaml.split('\n').filter(l => l.trim());
                if (lines.length === 0) return `${pad}- {}`;
                const first = lines[0].trimStart();
                const rest = lines.slice(1).map(l => `${pad}  ${l.trimStart()}`);
                return [`${pad}- ${first}`, ...rest].join('\n');
            }
            return `${pad}- ${toYamlValue(item, indent + 2)}`;
        }).join('\n');
    }
    if (typeof value === 'object') {
        return '\n' + toYamlObject(value, indent + 2);
    }
    return String(value);
}

function toYamlObject(obj, indent = 0) {
    const pad = ' '.repeat(indent);
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    return entries.map(([key, val]) => {
        const yamlVal = toYamlValue(val, indent);
        if (yamlVal.startsWith('\n')) {
            return `${pad}${key}:${yamlVal}`;
        }
        return `${pad}${key}: ${yamlVal}`;
    }).join('\n');
}

function objectToYaml(obj) {
    return toYamlObject(obj, 0) + '\n';
}

// ─── YAML Parser (minimal, handles common cases) ───────────────────────────

function parseYaml(text) {
    // Simple YAML parser for agent configs (flat + one level nested)
    const result = {};
    const lines = text.split('\n');
    let currentKey = null;
    let currentIndent = 0;
    let currentObj = result;
    const stack = [{ obj: result, indent: -1 }];
    let inMultiLine = false;
    let multiLineKey = '';
    let multiLineValue = '';
    let multiLineIndent = 0;

    for (const rawLine of lines) {
        // Skip comments and empty lines
        if (rawLine.trim().startsWith('#') || rawLine.trim() === '') {
            if (inMultiLine) multiLineValue += '\n';
            continue;
        }

        const lineIndent = rawLine.search(/\S/);

        // Handle multi-line strings
        if (inMultiLine) {
            if (lineIndent > multiLineIndent) {
                multiLineValue += (multiLineValue ? '\n' : '') + rawLine.trim();
                continue;
            } else {
                currentObj[multiLineKey] = multiLineValue;
                inMultiLine = false;
            }
        }

        const trimmed = rawLine.trim();

        // Array item
        if (trimmed.startsWith('- ')) {
            const arrayVal = trimmed.slice(2).trim();
            if (currentKey && !Array.isArray(currentObj[currentKey])) {
                currentObj[currentKey] = [];
            }
            if (currentKey) {
                currentObj[currentKey].push(parseYamlScalar(arrayVal));
            }
            continue;
        }

        // Key-value pair
        const kvMatch = trimmed.match(/^([^:]+?):\s*(.*)/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            const val = kvMatch[2].trim();

            // Pop stack to correct indentation level
            while (stack.length > 1 && lineIndent <= stack[stack.length - 1].indent) {
                stack.pop();
            }
            currentObj = stack[stack.length - 1].obj;

            if (val === '' || val === '|' || val === '>') {
                if (val === '|' || val === '>') {
                    inMultiLine = true;
                    multiLineKey = key;
                    multiLineValue = '';
                    multiLineIndent = lineIndent;
                } else {
                    // Nested object or array will follow
                    currentObj[key] = {};
                    stack.push({ obj: currentObj[key], indent: lineIndent });
                }
                currentKey = key;
            } else {
                currentObj[key] = parseYamlScalar(val);
                currentKey = key;
            }
            currentIndent = lineIndent;
        }
    }

    if (inMultiLine) {
        currentObj[multiLineKey] = multiLineValue;
    }

    return result;
}

function parseYamlScalar(value) {
    if (value === 'null' || value === '~') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === '[]') return [];
    if (value === '{}') return {};
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

// ─── Export Functions ───────────────────────────────────────────────────────

function buildExportPayload(agent, promptContent = '') {
    return {
        name: agent.name,
        description: agent.description || '',
        model: agent.model || { id: 'claude-sonnet-4-6', speed: 'standard' },
        toolProfile: agent.toolProfile || 'full',
        followupMode: agent.followupMode || 'default',
        capabilities: agent.capabilities || {},
        mcpServers: agent.mcpServers || [],
        skills: agent.skills || [],
        tags: agent.tags || [],
        category: agent.category || 'custom',
        permissionMode: agent.permissionMode || 'default',
        maxTurns: agent.maxTurns || 50,
        maxBudgetUsd: agent.maxBudgetUsd || null,
        systemPrompt: promptContent,
    };
}

function exportAsJson(agent, promptContent = '') {
    const payload = buildExportPayload(agent, promptContent);
    return {
        format: 'json',
        content: JSON.stringify(payload, null, 2),
        filename: `${agent.id || 'agent'}.agent.json`,
        mimeType: 'application/json',
    };
}

function exportAsYaml(agent, promptContent = '') {
    const payload = buildExportPayload(agent, promptContent);
    const yamlContent = [
        '# Agent Configuration',
        `# Exported: ${new Date().toISOString()}`,
        '',
        objectToYaml(payload),
    ].join('\n');

    return {
        format: 'yaml',
        content: yamlContent,
        filename: `${agent.id || 'agent'}.agent.yaml`,
        mimeType: 'text/yaml',
    };
}

function exportAsAgentMd(agent, promptContent = '') {
    const config = buildExportPayload(agent, promptContent);
    const { systemPrompt, ...meta } = config;

    const mdContent = [
        '```chatagent',
        '---',
        `name: ${meta.name}`,
        `description: "${meta.description}"`,
        `model: ${meta.model?.id || 'claude-sonnet-4-6'}`,
        `toolProfile: ${meta.toolProfile}`,
        `category: ${meta.category}`,
        meta.tags.length > 0 ? `tags: [${meta.tags.join(', ')}]` : null,
        meta.maxTurns ? `maxTurns: ${meta.maxTurns}` : null,
        meta.maxBudgetUsd ? `maxBudgetUsd: ${meta.maxBudgetUsd}` : null,
        '---',
        '',
        systemPrompt || '# Agent Prompt\n\nAdd your agent instructions here.',
        '',
        '```',
    ].filter(line => line !== null).join('\n');

    return {
        format: 'agent-md',
        content: mdContent,
        filename: `${agent.id || 'agent'}.agent.md`,
        mimeType: 'text/markdown',
    };
}

function exportAsTypeScript(agent, promptContent = '') {
    const payload = buildExportPayload(agent, promptContent);
    const tsContent = [
        `/**`,
        ` * Agent: ${payload.name}`,
        ` * ${payload.description}`,
        ` * Generated: ${new Date().toISOString()}`,
        ` */`,
        '',
        `const { agent, tool } = require('@21st-sdk/agent');`,
        '',
        `const ${camelCase(payload.name)}Agent = agent({`,
        `  name: ${JSON.stringify(payload.name)},`,
        `  model: ${JSON.stringify(payload.model?.id || 'claude-sonnet-4-6')},`,
        `  description: ${JSON.stringify(payload.description)},`,
        `  system: ${JSON.stringify(payload.systemPrompt || '')},`,
        payload.mcpServers.length > 0 ? `  mcpServers: ${JSON.stringify(payload.mcpServers, null, 4)},` : null,
        payload.maxTurns ? `  maxTurns: ${payload.maxTurns},` : null,
        payload.maxBudgetUsd ? `  maxBudgetUsd: ${payload.maxBudgetUsd},` : null,
        `});`,
        '',
        `module.exports = { ${camelCase(payload.name)}Agent };`,
        '',
    ].filter(line => line !== null).join('\n');

    return {
        format: 'typescript',
        content: tsContent,
        filename: `${agent.id || 'agent'}.agent.js`,
        mimeType: 'application/javascript',
    };
}

function camelCase(str) {
    return String(str || 'agent')
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^./, c => c.toLowerCase());
}

// ─── Import Functions ───────────────────────────────────────────────────────

function detectFormat(content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('```chatagent')) return 'agent-md';
    if (trimmed.startsWith('{')) return 'json';
    if (trimmed.includes('const ') && trimmed.includes('agent(')) return 'typescript';
    // Default to yaml
    return 'yaml';
}

function importFromJson(content) {
    const parsed = JSON.parse(content);
    return normalizeImportedConfig(parsed);
}

function importFromYaml(content) {
    // Strip comment header lines
    const cleaned = content.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    const parsed = parseYaml(cleaned);
    return normalizeImportedConfig(parsed);
}

function importFromAgentMd(content) {
    // Extract content between ```chatagent ... ```
    const match = content.match(/```chatagent\s*\n---\n([\s\S]*?)\n---\s*\n([\s\S]*?)\n```/);
    if (!match) {
        throw new Error('Invalid .agent.md format: missing chatagent code fence with frontmatter');
    }

    const frontmatter = parseYaml(match[1]);
    const systemPrompt = match[2].trim();

    return normalizeImportedConfig({
        ...frontmatter,
        systemPrompt,
    });
}

function importAgent(content, format) {
    const detected = format || detectFormat(content);

    switch (detected) {
        case 'json': return importFromJson(content);
        case 'yaml': return importFromYaml(content);
        case 'agent-md': return importFromAgentMd(content);
        default:
            throw new Error(`Unsupported import format: ${detected}`);
    }
}

function normalizeImportedConfig(raw) {
    return {
        name: raw.name || 'Imported Agent',
        description: raw.description || '',
        model: typeof raw.model === 'object' ? raw.model : { id: raw.model || 'claude-sonnet-4-6', speed: 'standard' },
        toolProfile: raw.toolProfile || 'full',
        followupMode: raw.followupMode || 'default',
        capabilities: raw.capabilities || { browser: true, jira: true, filesystem: 'read' },
        mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers : [],
        skills: Array.isArray(raw.skills) ? raw.skills : [],
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        category: raw.category || 'custom',
        permissionMode: raw.permissionMode || 'default',
        maxTurns: raw.maxTurns || 50,
        maxBudgetUsd: raw.maxBudgetUsd || null,
        systemPrompt: raw.systemPrompt || '',
    };
}

// ─── Main Export Function ───────────────────────────────────────────────────

function exportAgent(agent, promptContent = '', format = 'json') {
    switch (format) {
        case 'json': return exportAsJson(agent, promptContent);
        case 'yaml': return exportAsYaml(agent, promptContent);
        case 'agent-md': return exportAsAgentMd(agent, promptContent);
        case 'typescript': return exportAsTypeScript(agent, promptContent);
        default:
            throw new Error(`Unsupported export format: ${format}. Supported: ${SUPPORTED_EXPORT_FORMATS.join(', ')}`);
    }
}

module.exports = {
    exportAgent,
    importAgent,
    detectFormat,
    SUPPORTED_EXPORT_FORMATS,
    objectToYaml,
    parseYaml,
};
