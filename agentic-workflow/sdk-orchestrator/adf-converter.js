/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Markdown → Atlassian Document Format (ADF) Converter
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Converts markdown-formatted text (as produced by LLM agents like BugGenie)
 * into Jira-compatible ADF (Atlassian Document Format) v1 documents.
 *
 * Supported markdown patterns:
 *   - Headings (#, ##, ###)
 *   - Bold (**text**), inline code (`code`)
 *   - Mentions: @[Display Name](accountId:xxx) → ADF mention node (triggers Jira notifications)
 *   - Ordered lists (1. item)
 *   - Unordered lists (- item, * item)
 *   - Markdown tables (| col1 | col2 |)
 *   - Horizontal rules (---, ***)
 *   - Plain paragraphs with line breaks
 *
 * @module adf-converter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const SEMANTIC_CALLOUTS = [
    {
        kind: 'CAUTION',
        pattern: /^(?:#{1,6}\s*)?(?:\*\*)?(observation(?:\s+summary)?|issue(?:\s+summary)?|blocker|problem)(?:\*\*)?(?:\s*[:\-]|$)/i,
    },
    {
        kind: 'WARNING',
        pattern: /^(?:#{1,6}\s*)?(?:\*\*)?(risk(?:\s+summary)?|warning|concern)(?:\*\*)?(?:\s*[:\-]|$)/i,
    },
];

const ALERT_PANEL_TYPES = {
    NOTE: 'info',
    TIP: 'success',
    IMPORTANT: 'note',
    WARNING: 'warning',
    CAUTION: 'error',
    SUCCESS: 'success',
};

const ALERT_WIKI_META = {
    NOTE: { title: 'Note', borderColor: '#93C5FD', titleBGColor: '#DBEAFE', bgColor: '#EFF6FF' },
    TIP: { title: 'Tip', borderColor: '#99F6E4', titleBGColor: '#CCFBF1', bgColor: '#F0FDFA' },
    IMPORTANT: { title: 'Important', borderColor: '#C4B5FD', titleBGColor: '#EDE9FE', bgColor: '#F5F3FF' },
    WARNING: { title: 'Warning', borderColor: '#FCD34D', titleBGColor: '#FDE68A', bgColor: '#FFFBEB' },
    CAUTION: { title: 'Observation', borderColor: '#FDA4AF', titleBGColor: '#FFE4E6', bgColor: '#FFF1F2' },
    SUCCESS: { title: 'Success', borderColor: '#86EFAC', titleBGColor: '#DCFCE7', bgColor: '#F0FDF4' },
};

function getSemanticCalloutMatch(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('> [!')) return null;

    for (const callout of SEMANTIC_CALLOUTS) {
        const match = trimmed.match(callout.pattern);
        if (match) {
            return {
                kind: callout.kind,
                label: String(match[1] || '').replace(/\s+summary$/i, ''),
            };
        }
    }

    return null;
}

function formatSemanticLabel(value, fallback = 'Observation') {
    const label = String(value || fallback)
        .replace(/[-_]+/g, ' ')
        .trim();

    if (!label) return fallback;

    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function normalizeSemanticCallouts(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown || '';

    const lines = markdown.split('\n');
    const output = [];
    let index = 0;
    let inCodeFence = false;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (/^```/.test(trimmed)) {
            inCodeFence = !inCodeFence;
            output.push(line);
            index += 1;
            continue;
        }

        if (!inCodeFence) {
            const match = getSemanticCalloutMatch(line);
            if (match) {
                output.push(`> [!${match.kind}]`);

                while (index < lines.length) {
                    const blockLine = lines[index];
                    const blockTrimmed = blockLine.trim();

                    if (/^```/.test(blockTrimmed)) {
                        break;
                    }

                    if (!blockTrimmed) {
                        output.push('>');
                        index += 1;
                        break;
                    }

                    output.push(`> ${blockLine.trimEnd()}`);
                    index += 1;
                }

                continue;
            }
        }

        output.push(line);
        index += 1;
    }

    return output.join('\n');
}

function buildPanelNode(alertKind, blockLines) {
    const paragraphs = [];
    let paragraphLines = [];

    for (const line of blockLines) {
        const trimmed = String(line || '').trim();
        if (!trimmed) {
            if (paragraphLines.length > 0) {
                paragraphs.push(makeTextParagraph(paragraphLines.join(' ')));
                paragraphLines = [];
            }
            continue;
        }

        paragraphLines.push(trimmed);
    }

    if (paragraphLines.length > 0) {
        paragraphs.push(makeTextParagraph(paragraphLines.join(' ')));
    }

    return {
        type: 'panel',
        attrs: { panelType: ALERT_PANEL_TYPES[String(alertKind || '').toUpperCase()] || 'info' },
        content: paragraphs.length > 0 ? paragraphs : [makeTextParagraph('')],
    };
}

function extractAlertPanelTitle(alertKind, blockLines) {
    const firstContentLine = Array.isArray(blockLines)
        ? blockLines.find(line => String(line || '').trim().length > 0)
        : '';
    const match = getSemanticCalloutMatch(firstContentLine || '');
    if (match?.label) {
        return formatSemanticLabel(match.label);
    }

    return ALERT_WIKI_META[String(alertKind || '').toUpperCase()]?.title || 'Note';
}

// ─── Inline text parser ─────────────────────────────────────────────────────

/**
 * Parse inline markdown formatting into Jira-safe ADF text nodes.
 * Handles: **bold**, `code`, **`code`** (falls back to code-only),
 *          @[Display Name](accountId:xxx) → ADF mention nodes, and plain text.
 *
 * @param {string} text - Raw inline text with potential markdown formatting
 * @returns {Array} Array of ADF text/mention/inlineCode nodes
 */
function parseInlineMarks(text) {
    if (!text || typeof text !== 'string') return [{ type: 'text', text: '' }];

    const nodes = [];
    // Jira does not allow code+strong on the same node, so **`code`** degrades to code-only.
    // Mention syntax: @[Display Name](accountId:xxx) → ADF mention node
    const inlineRegex = /@\[([^\]]+)\]\(accountId:([^)]+)\)|\*\*`([^`]+)`\*\*|\*\*([^*]+)\*\*|`([^`]+)`/g;

    let lastIndex = 0;
    let match;

    while ((match = inlineRegex.exec(text)) !== null) {
        // Add any plain text before this match
        if (match.index > lastIndex) {
            const plain = text.slice(lastIndex, match.index);
            if (plain) nodes.push({ type: 'text', text: plain });
        }

        if (match[1] !== undefined && match[2] !== undefined) {
            // @[Display Name](accountId:xxx) → ADF mention node (triggers Jira notifications)
            nodes.push({
                type: 'mention',
                attrs: {
                    id: match[2].trim(),
                    text: `@${match[1].trim()}`,
                    accessLevel: '',
                },
            });
        } else if (match[3] !== undefined) {
            nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] });
        } else if (match[4] !== undefined) {
            // **bold** → text with strong mark
            nodes.push({ type: 'text', text: match[4], marks: [{ type: 'strong' }] });
        } else if (match[5] !== undefined) {
            // `code` → text with code mark
            nodes.push({ type: 'text', text: match[5], marks: [{ type: 'code' }] });
        }

        lastIndex = match.index + match[0].length;
    }

    // Add any remaining plain text
    if (lastIndex < text.length) {
        const remaining = text.slice(lastIndex);
        if (remaining) nodes.push({ type: 'text', text: remaining });
    }

    if (nodes.length === 0) {
        return [{ type: 'text', text: text || '' }];
    }

    return nodes;
}

function ensureInlineContent(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return [{ type: 'text', text: '' }];
    }

    const validInlineTypes = new Set(['text', 'mention']);
    const normalized = nodes.filter(node => node && typeof node === 'object' && validInlineTypes.has(node.type));
    return normalized.length > 0 ? normalized : [{ type: 'text', text: '' }];
}

/**
 * Creates an ADF paragraph node from inline-formatted text.
 * @param {string} text
 * @returns {Object} ADF paragraph node
 */
function makeTextParagraph(text) {
    return {
        type: 'paragraph',
        content: ensureInlineContent(parseInlineMarks(text)),
    };
}

// ─── Table parser ───────────────────────────────────────────────────────────

/**
 * Parse markdown table rows into an array of cell arrays.
 * Handles header row, separator row, and data rows.
 *
 * @param {string[]} tableLines - Array of markdown table lines (| col1 | col2 |)
 * @returns {{ headers: string[], rows: string[][] }}
 */
function parseMarkdownTable(tableLines) {
    const cleaned = tableLines.map(line => {
        // Remove leading/trailing pipes and trim
        let l = line.trim();
        if (l.startsWith('|')) l = l.slice(1);
        if (l.endsWith('|')) l = l.slice(0, -1);
        return l.split('|').map(cell => cell.trim());
    });

    if (cleaned.length < 2) {
        return { headers: cleaned[0] || [], rows: [] };
    }

    const headers = cleaned[0];

    // Skip separator row (e.g., |---|---|---|)
    const dataStart = /^[-:\s|]+$/.test(tableLines[1]?.replace(/\|/g, '').trim()) ? 2 : 1;
    const rows = cleaned.slice(dataStart);

    return { headers, rows };
}

/**
 * Convert parsed table data into an ADF table node.
 * @param {{ headers: string[], rows: string[][] }} tableData
 * @returns {Object} ADF table node
 */
function tableToAdf(tableData) {
    const { headers, rows } = tableData;
    const columnCount = Math.max(headers.length, 1);
    const normalizedHeaders = headers.length > 0 ? headers : [''];
    const normalizeRow = (row) => {
        const cells = Array.isArray(row) ? row.slice(0, columnCount) : [];
        while (cells.length < columnCount) {
            cells.push('');
        }
        return cells;
    };

    // Build header row
    const headerRow = {
        type: 'tableRow',
        content: normalizedHeaders.map(h => ({
            type: 'tableHeader',
            attrs: {},
            content: [makeTextParagraph(h)],
        })),
    };

    // Build data rows
    const dataRows = rows.map(row => ({
        type: 'tableRow',
        content: normalizeRow(row).map(cell => ({
            type: 'tableCell',
            attrs: {},
            content: [makeTextParagraph(cell)],
        })),
    }));

    return {
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: [headerRow, ...dataRows],
    };
}

// ─── List parser ────────────────────────────────────────────────────────────

/**
 * Build an ADF list node from consecutive list items.
 * @param {string[]} items - Array of list item texts (without bullet/number prefix)
 * @param {'bulletList'|'orderedList'} listType
 * @returns {Object} ADF list node
 */
function buildListNode(items, listType) {
    return {
        type: listType,
        content: items.map(item => ({
            type: 'listItem',
            content: [makeTextParagraph(item)],
        })),
    };
}

// ─── Main converter ─────────────────────────────────────────────────────────

/**
 * Convert a markdown-formatted string into an ADF document.
 *
 * @param {string} markdown - Markdown text (as produced by LLM agents)
 * @returns {Object} ADF document object ready for Jira REST API
 */
function markdownToAdf(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
        };
    }

    markdown = normalizeSemanticCallouts(markdown);

    const lines = markdown.split('\n');
    const content = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // ── Skip empty lines ──
        if (!trimmed) {
            i++;
            continue;
        }

        const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS)\]\s*$/i);
        if (alertMatch) {
            const blockLines = [];
            i++;

            while (i < lines.length) {
                const blockMatch = lines[i].match(/^\s*>\s?(.*)$/);
                if (!blockMatch) break;
                blockLines.push(blockMatch[1]);
                i++;
            }

            content.push(buildPanelNode(alertMatch[1], blockLines));
            continue;
        }

        // ── Headings: # ## ### ──
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = Math.min(headingMatch[1].length, 6);
            content.push({
                type: 'heading',
                attrs: { level },
                content: parseInlineMarks(headingMatch[2]),
            });
            i++;
            continue;
        }

        // ── Horizontal rule: --- or *** ──
        if (/^[-*_]{3,}$/.test(trimmed)) {
            content.push({ type: 'rule' });
            i++;
            continue;
        }

        // ── Table: lines starting with | ──
        if (trimmed.startsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            if (tableLines.length >= 2) {
                const tableData = parseMarkdownTable(tableLines);
                content.push(tableToAdf(tableData));
            } else {
                // Single pipe line — treat as paragraph
                content.push(makeTextParagraph(tableLines[0].trim()));
            }
            continue;
        }

        // ── Ordered list: 1. item, 2. item ──
        const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (orderedMatch) {
            const items = [];
            while (i < lines.length) {
                const m = lines[i].trim().match(/^\d+[.)]\s+(.+)$/);
                if (!m) break;
                items.push(m[1]);
                i++;
            }
            content.push(buildListNode(items, 'orderedList'));
            continue;
        }

        // ── Unordered list: - item, * item ──
        const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        if (bulletMatch) {
            const items = [];
            while (i < lines.length) {
                const m = lines[i].trim().match(/^[-*+]\s+(.+)$/);
                if (!m) break;
                items.push(m[1]);
                i++;
            }
            content.push(buildListNode(items, 'bulletList'));
            continue;
        }

        // ── Plain paragraph (may contain inline formatting) ──
        // Collect consecutive non-empty, non-special lines into one paragraph
        const paraLines = [];
        while (i < lines.length) {
            const l = lines[i].trim();
            if (!l) break; // empty line ends paragraph
            if (l.startsWith('#') || l.startsWith('|') || /^[-*_]{3,}$/.test(l)) break;
            if (/^\d+[.)]\s+/.test(l) && paraLines.length > 0) break; // new list starts
            if (/^[-*+]\s+/.test(l) && paraLines.length > 0) break;   // bullet list starts
            paraLines.push(l);
            i++;
        }
        if (paraLines.length > 0) {
            content.push(makeTextParagraph(paraLines.join(' ')));
        }
    }

    // Safeguard: ensure at least one content node
    if (content.length === 0) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: markdown || '' }] });
    }

    return {
        type: 'doc',
        version: 1,
        content,
    };
}

// ─── Mention preprocessor ───────────────────────────────────────────────────

/**
 * Inject structured mention syntax into markdown text before ADF conversion.
 * Replaces @DisplayName patterns with @[DisplayName](accountId:xxx) so the
 * ADF converter emits proper Jira mention nodes (which trigger notifications).
 *
 * @param {string} text - Markdown text that may contain @name mentions
 * @param {Array<{accountId: string, displayName: string}>} mentions - Resolved mention data
 * @returns {string} Text with @name patterns replaced by structured mention syntax
 */
function injectMentionSyntax(text, mentions) {
    if (!text || !Array.isArray(mentions) || mentions.length === 0) return text || '';

    let result = text;
    // Sort by display name length descending to avoid partial matches
    const sorted = [...mentions]
        .filter(m => m && m.accountId && m.displayName)
        .sort((a, b) => b.displayName.length - a.displayName.length);

    for (const { accountId, displayName } of sorted) {
        // Match @DisplayName (case-insensitive, word boundary)
        // Avoid replacing if already in structured syntax
        const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`@(?!\\[)${escaped}\\b`, 'gi');
        result = result.replace(pattern, `@[${displayName}](accountId:${accountId})`);
    }

    return result;
}

// ─── Markdown → Jira Wiki Markup converter ──────────────────────────────────
// Converts basic markdown to Jira wiki markup notation.
// Used by the add_comment_with_images tool to create comments via the REST API v2
// endpoint, which accepts wiki markup strings and lets Jira's server-side renderer
// resolve `!filename.png!` references against issue attachments for true inline images.
function markdownToWikiMarkup(md) {
    if (!md || typeof md !== 'string') return '';
    let wiki = normalizeSemanticCallouts(md);
    // Code blocks FIRST (before inline code): ```lang\ncode\n``` → {code:lang}\ncode\n{code}
    wiki = wiki.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return lang ? `{code:${lang}}\n${code}{code}` : `{code}\n${code}{code}`;
    });
    // Headings: ## Heading → h2. Heading
    wiki = wiki.replace(/^#{6}\s+(.+)$/gm, 'h6. $1');
    wiki = wiki.replace(/^#{5}\s+(.+)$/gm, 'h5. $1');
    wiki = wiki.replace(/^#{4}\s+(.+)$/gm, 'h4. $1');
    wiki = wiki.replace(/^#{3}\s+(.+)$/gm, 'h3. $1');
    wiki = wiki.replace(/^#{2}\s+(.+)$/gm, 'h2. $1');
    wiki = wiki.replace(/^#{1}\s+(.+)$/gm, 'h1. $1');
    // Bold: **text** → *text*
    wiki = wiki.replace(/\*\*(.+?)\*\*/g, '*$1*');
    // Italic: _text_ or *text* (after bold conversion) — Jira uses _text_
    // (markdown italic with single * already conflicts with Jira bold, so leave _ as-is)
    // Inline code: `code` → {{code}} (single backticks only, not inside {code} blocks)
    wiki = wiki.replace(/`([^`]+)`/g, '{{$1}}');
    // Unordered list: - item or * item → * item (Jira uses * for bullets)
    wiki = wiki.replace(/^[\s]*[-]\s+/gm, '* ');
    // Ordered list: 1. item → # item
    wiki = wiki.replace(/^[\s]*\d+\.\s+/gm, '# ');
    // Links: [text](url) → [text|url]
    wiki = wiki.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');
    // Horizontal rule: --- or *** → ----
    wiki = wiki.replace(/^[-*]{3,}$/gm, '----');
    wiki = wiki.replace(/(^|\n)>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS)\]\s*\n((?:>\s?.*(?:\n|$))*)/g, (_, prefix, kind, body) => {
        const normalizedKind = String(kind || '').toUpperCase();
        const panelMeta = ALERT_WIKI_META[normalizedKind] || ALERT_WIKI_META.NOTE;
        const blockLines = body
            .split(/\r?\n/)
            .map(line => {
                const match = line.match(/^>\s?(.*)$/);
                return match ? match[1] : '';
            });
        const content = blockLines.join('\n').trim();
        const title = extractAlertPanelTitle(normalizedKind, blockLines);

        return `${prefix}{panel:title=${title}|borderStyle=solid|borderColor=${panelMeta.borderColor}|titleBGColor=${panelMeta.titleBGColor}|bgColor=${panelMeta.bgColor}}\n${content}\n{panel}`;
    });
    return wiki.trim();
}

// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = { markdownToAdf, markdownToWikiMarkup, normalizeSemanticCallouts, parseInlineMarks, parseMarkdownTable, injectMentionSyntax };
