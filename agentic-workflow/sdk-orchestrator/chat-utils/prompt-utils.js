/**
 * Prompt Utilities — Instruction extraction, URL routing, and tool name helpers.
 * @module sdk-orchestrator/chat-utils/prompt-utils
 */

const { CHAT_SHELL_TOOL_PATTERNS } = require('./chat-constants');

/**
 * Extract critical sections from copilot-instructions.md instead of blind
 * truncation.  Returns a combined string containing only the sections the
 * agent actually needs (framework patterns, import order, popup handling,
 * selector strategy, code quality targets, terminology).
 *
 * If the file changes its heading structure, the function gracefully falls
 * back to the first 12 000 characters so nothing is silently lost.
 */
function extractCriticalInstructions(fullText) {
    const SECTION_HEADINGS = [
        '### Import Order',
        '### Framework Pattern',
        '### File Header Template',
        '### Selector Strategy',
        '### Popup Handling',
        '### Automation Scope',
        '### Code Quality Targets',
        '## Naming Conventions',
        '## Terminology',
    ];

    const MAX_SECTION_CHARS = 1500;
    const sections = [];
    for (const heading of SECTION_HEADINGS) {
        const idx = fullText.indexOf(heading);
        if (idx === -1) continue;
        const level = heading.startsWith('###') ? '###' : '##';
        const rest = fullText.substring(idx + heading.length);
        const escapedLevel = level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nextHeading = rest.search(new RegExp(`^${escapedLevel} `, 'm'));
        let sectionText = nextHeading === -1
            ? fullText.substring(idx)
            : fullText.substring(idx, idx + heading.length + nextHeading);
        sectionText = sectionText.trim();
        if (sectionText.length > MAX_SECTION_CHARS) {
            sectionText = sectionText.substring(0, MAX_SECTION_CHARS) + '\n… (truncated)';
        }
        sections.push(sectionText);
    }

    if (sections.length === 0) {
        return fullText.substring(0, 6000);
    }
    return sections.join('\n\n');
}

/**
 * When running inside the SDK (web app / pipeline), MCP tool names use the
 * RAW format: unified_navigate.  The .agent.md files use the VS Code format:
 * mcp_unified-autom_unified_navigate.  Strip the prefix so the LLM calls the
 * correct tool name.
 */
function stripVSCodeToolPrefix(text) {
    return text.replace(/mcp_unified-autom_unified_/g, 'unified_');
}

function buildAtlassianRoutingHint(urlContext) {
    if (!urlContext || urlContext.atlassianUrls.length === 0) return '';

    const lines = [
        '[INTERNAL ROUTING HINT]',
        'The user message contains Atlassian URLs. Resolve them with Jira/KB tools before answering.',
    ];

    for (const jiraIssue of urlContext.jiraIssues) {
        lines.push(`- Jira issue URL detected: use fetch_jira_ticket with "${jiraIssue.issueKey}" or the full URL.`);
    }

    for (const confluencePage of urlContext.confluencePages) {
        lines.push(`- Confluence page URL detected: use get_knowledge_base_page with "${confluencePage.pageId}" or the full URL.`);
        lines.push('- Do not claim the page requires browser login when KB connector or Atlassian MCP tools are available.');
    }

    lines.push('Fetch the referenced Jira or Confluence content first, then summarize only the requested portion.');
    return lines.join('\n');
}

function isShellLikeToolName(toolName) {
    const normalized = String(toolName || '').toLowerCase();
    if (!normalized) return false;
    return CHAT_SHELL_TOOL_PATTERNS.some(pattern => normalized.includes(pattern));
}

module.exports = {
    extractCriticalInstructions,
    stripVSCodeToolPrefix,
    buildAtlassianRoutingHint,
    isShellLikeToolName,
};
