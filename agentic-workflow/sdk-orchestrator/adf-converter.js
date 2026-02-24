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

// ─── Inline text parser ─────────────────────────────────────────────────────

/**
 * Parse inline markdown formatting (bold, code, bold+code) into ADF text nodes.
 * Handles: **bold**, `code`, **`bold code`**, and plain text.
 *
 * @param {string} text - Raw inline text with potential markdown formatting
 * @returns {Array} Array of ADF text/inlineCode nodes
 */
function parseInlineMarks(text) {
    if (!text || typeof text !== 'string') return [{ type: 'text', text: text || '' }];

    const nodes = [];
    // Regex: match **`code`** (bold+code), **bold**, `code`, or plain text
    const inlineRegex = /\*\*`([^`]+)`\*\*|\*\*([^*]+)\*\*|`([^`]+)`/g;

    let lastIndex = 0;
    let match;

    while ((match = inlineRegex.exec(text)) !== null) {
        // Add any plain text before this match
        if (match.index > lastIndex) {
            const plain = text.slice(lastIndex, match.index);
            if (plain) nodes.push({ type: 'text', text: plain });
        }

        if (match[1] !== undefined) {
            // **`bold code`** → text with both strong + code marks
            nodes.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }, { type: 'code' }] });
        } else if (match[2] !== undefined) {
            // **bold** → text with strong mark
            nodes.push({ type: 'text', text: match[2], marks: [{ type: 'strong' }] });
        } else if (match[3] !== undefined) {
            // `code` → text with code mark
            nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] });
        }

        lastIndex = match.index + match[0].length;
    }

    // Add any remaining plain text
    if (lastIndex < text.length) {
        const remaining = text.slice(lastIndex);
        if (remaining) nodes.push({ type: 'text', text: remaining });
    }

    // If nothing was parsed, return the original text as a single node
    if (nodes.length === 0) {
        return [{ type: 'text', text }];
    }

    return nodes;
}

/**
 * Creates an ADF paragraph node from inline-formatted text.
 * @param {string} text
 * @returns {Object} ADF paragraph node
 */
function makeTextParagraph(text) {
    return {
        type: 'paragraph',
        content: parseInlineMarks(text),
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

    // Build header row
    const headerRow = {
        type: 'tableRow',
        content: headers.map(h => ({
            type: 'tableHeader',
            attrs: {},
            content: [makeTextParagraph(h)],
        })),
    };

    // Build data rows
    const dataRows = rows.map(row => ({
        type: 'tableRow',
        content: row.map(cell => ({
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
            content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown || '' }] }],
        };
    }

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
        content.push({ type: 'paragraph', content: [{ type: 'text', text: markdown }] });
    }

    return {
        type: 'doc',
        version: 1,
        content,
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = { markdownToAdf, parseInlineMarks, parseMarkdownTable };
