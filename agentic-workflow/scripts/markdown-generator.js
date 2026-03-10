/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MARKDOWN GENERATOR — Styled GitHub-Flavored Markdown Documents
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates richly-formatted Markdown with:
 *   - GitHub-flavored Markdown (GFM)
 *   - Mermaid diagram blocks
 *   - Badges (shields.io style)
 *   - Collapsible details sections
 *   - Table formatting with alignment
 *   - Admonition blocks (> [!NOTE], > [!WARNING])
 *   - Auto-TOC generation
 *   - Front matter (YAML)
 *
 * Supported section types (16 total):
 *   heading, paragraph, bullets, numbered-list, table,
 *   code-block, callout, page-break, two-column,
 *   cover, pull-quote, sidebar, metric-strip, info-card-grid,
 *   diagram, badge
 *
 * @module scripts/markdown-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { getOutputDir, generateFileName } = require('./doc-design-system');

// ─── Section Renderers ──────────────────────────────────────────────────────

function renderCover(section) {
    const title = section.title || section.text || 'Document';
    const subtitle = section.subtitle || '';
    const meta = [];
    if (section.author) meta.push(`**Author:** ${section.author}`);
    if (section.date) meta.push(`**Date:** ${section.date}`);
    else meta.push(`**Date:** ${new Date().toLocaleDateString()}`);
    if (section.version) meta.push(`**Version:** ${section.version}`);

    return `# ${title}\n\n${subtitle ? `*${subtitle}*\n\n` : ''}${meta.join(' | ')}\n\n---\n`;
}

function renderHeading(section) {
    const level = Math.min(Math.max(section.level || 1, 1), 6);
    const text = section.text || section.content || '';
    return `${'#'.repeat(level)} ${text}\n`;
}

function renderParagraph(section) {
    return `${section.text || section.content || ''}\n`;
}

function renderBullets(section) {
    const items = Array.isArray(section.items) ? section.items : (Array.isArray(section.bullets) ? section.bullets : []);
    return items.map(i => `- ${typeof i === 'string' ? i : i.text || ''}`).join('\n') + '\n';
}

function renderNumberedList(section) {
    const items = Array.isArray(section.items) ? section.items : [];
    return items.map((i, idx) => `${idx + 1}. ${typeof i === 'string' ? i : i.text || ''}`).join('\n') + '\n';
}

function renderTable(section) {
    const headers = section.headers || [];
    const rows = section.rows || [];
    if (!headers.length && !rows.length) return '';

    const title = section.title ? `**${section.title}**\n\n` : '';
    const headerRow = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map(row => {
        const cells = Array.isArray(row) ? row : Object.values(row);
        return `| ${cells.join(' | ')} |`;
    }).join('\n');

    return `${title}${headerRow}\n${separator}\n${dataRows}\n`;
}

function renderCodeBlock(section) {
    const code = section.code || section.content || '';
    const language = section.language || '';
    return `\`\`\`${language}\n${code}\n\`\`\`\n`;
}

function renderCallout(section) {
    const text = section.text || section.content || '';
    const type = section.calloutType || 'info';
    const typeMap = { info: 'NOTE', success: 'TIP', warning: 'WARNING', danger: 'CAUTION' };
    const ghType = typeMap[type] || 'NOTE';
    return `> [!${ghType}]\n> ${text.split('\n').join('\n> ')}\n`;
}

function renderPageBreak() {
    return '---\n';
}

function renderTwoColumn(section) {
    const left = section.leftContent || section.left || '';
    const right = section.rightContent || section.right || '';
    // Use a table for two-column layout in Markdown
    return `| | |\n|---|---|\n| ${left.replace(/\|/g, '\\|')} | ${right.replace(/\|/g, '\\|')} |\n`;
}

function renderPullQuote(section) {
    const text = section.text || section.content || '';
    const attribution = section.attribution || section.author || '';
    const attr = attribution ? `\n>\n> — *${attribution}*` : '';
    return `> *"${text}"*${attr}\n`;
}

function renderSidebar(section) {
    const text = section.text || section.content || '';
    const title = section.title || 'Note';
    return `<details open>\n<summary><strong>${title}</strong></summary>\n\n${text}\n\n</details>\n`;
}

function renderMetricStrip(section) {
    const metrics = section.metrics || [];
    const header = `| ${metrics.map(m => `**${m.label}**`).join(' | ')} |`;
    const sep = `| ${metrics.map(() => ':---:').join(' | ')} |`;
    const values = `| ${metrics.map(m => `**${m.value}** ${m.change || ''}`).join(' | ')} |`;
    return `${header}\n${sep}\n${values}\n`;
}

function renderInfoCardGrid(section) {
    const cards = section.cards || section.items || [];
    return cards.map(card => {
        const icon = card.icon ? `${card.icon} ` : '';
        const title = card.title ? `**${icon}${card.title}**` : '';
        const desc = card.description || card.text || '';
        return `${title}\n${desc}\n`;
    }).join('\n');
}

function renderDiagram(section) {
    const code = section.mermaidCode || section.code || '';
    if (!code) return '*[Diagram: No Mermaid code provided]*\n';
    return `\`\`\`mermaid\n${code}\n\`\`\`\n`;
}

function renderBadge(section) {
    const badges = section.badges || [];
    return badges.map(b => {
        const label = encodeURIComponent(b.label || '');
        const value = encodeURIComponent(b.value || '');
        const color = (b.color || 'blue').replace('#', '');
        return `![${b.label}](https://img.shields.io/badge/${label}-${value}-${color})`;
    }).join(' ') + '\n';
}

const SECTION_RENDERERS = {
    heading: renderHeading,
    paragraph: renderParagraph,
    bullets: renderBullets,
    'numbered-list': renderNumberedList,
    table: renderTable,
    'code-block': renderCodeBlock,
    callout: renderCallout,
    'page-break': renderPageBreak,
    'two-column': renderTwoColumn,
    cover: renderCover,
    'pull-quote': renderPullQuote,
    sidebar: renderSidebar,
    'metric-strip': renderMetricStrip,
    'info-card-grid': renderInfoCardGrid,
    diagram: renderDiagram,
    badge: renderBadge,
};

// ─── TOC Generator ──────────────────────────────────────────────────────────

function generateTOC(sections) {
    const headings = sections.filter(s => s.type === 'heading');
    if (!headings.length) return '';

    const lines = ['## Table of Contents\n'];
    for (const h of headings) {
        const level = h.level || 1;
        const text = h.text || h.content || '';
        const anchor = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const indent = '  '.repeat(Math.max(level - 1, 0));
        lines.push(`${indent}- [${text}](#${anchor})`);
    }
    lines.push('');
    return lines.join('\n');
}

// ─── Front Matter ───────────────────────────────────────────────────────────

function generateFrontMatter(options) {
    const fm = { title: options.title || 'Document' };
    if (options.author) fm.author = options.author;
    fm.date = new Date().toISOString().split('T')[0];
    if (options.tags) fm.tags = options.tags;
    if (options.description) fm.description = options.description;
    fm.generator = 'DocGenie Markdown Generator';

    const lines = ['---'];
    for (const [key, val] of Object.entries(fm)) {
        if (Array.isArray(val)) {
            lines.push(`${key}:`);
            val.forEach(v => lines.push(`  - ${v}`));
        } else {
            lines.push(`${key}: ${JSON.stringify(val)}`);
        }
    }
    lines.push('---\n');
    return lines.join('\n');
}

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a styled GitHub-flavored Markdown document.
 *
 * @param {Object} options
 * @param {string} options.title - Document title
 * @param {string} [options.author] - Author name
 * @param {Array}  options.sections - Array of section definitions
 * @param {string} [options.outputPath] - Custom output path
 * @param {boolean} [options.includeFrontMatter] - Add YAML front matter
 * @param {boolean} [options.includeTableOfContents] - Add auto-generated TOC
 * @param {string[]} [options.tags] - Document tags
 * @param {string} [options.description] - Document description
 * @returns {Promise<Object>} { success, filePath, fileName, sectionCount, fileSize }
 */
async function generateMarkdown(options) {
    const { title, sections = [], outputPath, includeFrontMatter = true, includeTableOfContents = true } = options;

    if (!sections.length) {
        return { success: false, error: 'No sections provided' };
    }

    const parts = [];

    // Front matter
    if (includeFrontMatter) {
        parts.push(generateFrontMatter(options));
    }

    // TOC
    if (includeTableOfContents) {
        parts.push(generateTOC(sections));
    }

    // Render sections
    for (const section of sections) {
        const renderer = SECTION_RENDERERS[section.type];
        if (renderer) {
            parts.push(renderer(section));
        } else {
            parts.push(`*[Unknown section type: ${section.type}]*\n`);
        }
    }

    // Footer
    parts.push(`\n---\n*Generated by DocGenie — ${new Date().toLocaleDateString()}*\n`);

    const content = parts.join('\n');

    // Write file
    const fileName = generateFileName(title || 'Document', '.md');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, content, 'utf8');

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        sectionCount: sections.length,
        fileSize: content.length,
        fileSizeHuman: `${(content.length / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generateMarkdown, SECTION_RENDERERS };
