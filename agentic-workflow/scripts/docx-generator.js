/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOCX GENERATOR — Context-Driven Word Document Generation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates professional Word documents from a flexible sections array.
 * The LLM decides structure; this module handles rendering.
 *
 * Supported section types:
 *   heading, paragraph, bullets, numbered-list, table, image,
 *   code-block, callout, page-break, two-column,
 *   cover, pull-quote, sidebar, metric-strip, info-card-grid,
 *   diagram, chart, infographic
 *
 * @module scripts/docx-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const docx = require('docx');
const fs = require('fs');
const path = require('path');
const { resolveTheme, resolveFont, TYPOGRAPHY, SPACING, getOutputDir, generateFileName, hexToRGB } = require('./doc-design-system');
const { renderForEmbed: renderDiagramForEmbed, cleanupBrowser: cleanupDiagramBrowser } = require('./shared/diagram-engine');
const { renderChartForEmbed, cleanupBrowser: cleanupChartBrowser } = require('./shared/chart-renderer');
const { renderInfographicForEmbed, cleanupBrowser: cleanupInfographicBrowser } = require('./shared/infographic-components');

const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    HeadingLevel, AlignmentType, BorderStyle, WidthType,
    ImageRun, PageBreak, TableOfContents, Header, Footer,
    ShadingType, TabStopPosition, TabStopType, convertInchesToTwip,
} = docx;

// ─── Section Renderers ──────────────────────────────────────────────────────

function renderHeading(section, theme) {
    const level = section.level || 1;
    const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
    };

    return [
        new Paragraph({
            text: section.text || section.content || '',
            heading: headingMap[level] || HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
        }),
    ];
}

function renderParagraph(section, theme, font) {
    const text = section.text || section.content || '';
    const runs = parseTextRuns(text, theme, font);

    return [
        new Paragraph({
            children: runs,
            spacing: { before: SPACING.docx.paragraphSpacing.before, after: SPACING.docx.paragraphSpacing.after },
        }),
    ];
}

function renderBullets(section, theme, font) {
    const items = Array.isArray(section.items) ? section.items : (Array.isArray(section.bullets) ? section.bullets : []);

    return items.map(item => {
        const text = typeof item === 'string' ? item : (item.text || '');
        return new Paragraph({
            children: [new TextRun({ text, font: font, size: TYPOGRAPHY.docx.body })],
            bullet: { level: 0 },
            spacing: { before: 40, after: 40 },
        });
    });
}

function renderNumberedList(section, theme, font) {
    const items = Array.isArray(section.items) ? section.items : [];

    return items.map(item => {
        const text = typeof item === 'string' ? item : (item.text || '');
        return new Paragraph({
            children: [new TextRun({ text, font: font, size: TYPOGRAPHY.docx.body })],
            numbering: { reference: 'default-numbering', level: 0 },
            spacing: { before: 40, after: 40 },
        });
    });
}

function renderTable(section, theme, font) {
    const headers = section.headers || (section.tableData && section.tableData.headers) || [];
    const rows = section.rows || (section.tableData && section.tableData.rows) || [];
    const elements = [];

    // Table title
    if (section.title) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: section.title, bold: true, font: font, size: TYPOGRAPHY.docx.heading3 })],
            spacing: { before: 200, after: 100 },
        }));
    }

    const primary = theme.primary.replace('#', '');
    const surface = theme.surface.replace('#', '');

    // Build header row
    const headerCells = headers.map(h => new TableCell({
        children: [new Paragraph({
            children: [new TextRun({ text: String(h), bold: true, font: font, size: TYPOGRAPHY.docx.body, color: 'FFFFFF' })],
            alignment: AlignmentType.CENTER,
        })],
        shading: { fill: primary, type: ShadingType.CLEAR },
        verticalAlign: docx.VerticalAlign.CENTER,
    }));

    // Build data rows
    const dataRows = rows.map((row, ri) => {
        const cells = (Array.isArray(row) ? row : Object.values(row)).map(cell =>
            new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({ text: String(cell ?? ''), font: font, size: TYPOGRAPHY.docx.body })],
                })],
                shading: ri % 2 === 0 ? { fill: surface, type: ShadingType.CLEAR } : undefined,
            })
        );
        return new TableRow({ children: cells });
    });

    const allRows = [];
    if (headerCells.length) allRows.push(new TableRow({ children: headerCells, tableHeader: true }));
    allRows.push(...dataRows);

    if (allRows.length) {
        elements.push(new Table({
            rows: allRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
        }));
    }

    return elements;
}

function renderCodeBlock(section, theme, font) {
    const code = section.code || section.content || '';
    const language = section.language || '';

    const elements = [];

    if (language) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: language.toUpperCase(), font: TYPOGRAPHY.fontFamily.mono, size: TYPOGRAPHY.docx.small, color: theme.textSecondary.replace('#', ''), italics: true })],
            spacing: { before: 120, after: 0 },
        }));
    }

    // Code content in monospace with background
    const lines = code.split('\n');
    for (const line of lines) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: line || ' ', font: TYPOGRAPHY.fontFamily.mono, size: TYPOGRAPHY.docx.small })],
            shading: { fill: theme.surface.replace('#', ''), type: ShadingType.CLEAR },
            spacing: { before: 0, after: 0 },
        }));
    }

    return elements;
}

function renderCallout(section, theme, font) {
    const text = section.text || section.content || '';
    const calloutType = section.calloutType || 'info';

    const colorMap = {
        info: theme.primary,
        success: theme.success,
        warning: theme.warning,
        danger: theme.danger,
    };
    const color = (colorMap[calloutType] || theme.primary).replace('#', '');

    const iconMap = { info: '\u2139\uFE0F', success: '\u2705', warning: '\u26A0\uFE0F', danger: '\u274C' };
    const icon = iconMap[calloutType] || '\u2139\uFE0F';

    return [
        new Paragraph({
            children: [
                new TextRun({ text: `${icon}  `, font: font, size: TYPOGRAPHY.docx.body }),
                new TextRun({ text, font: font, size: TYPOGRAPHY.docx.body, color }),
            ],
            border: {
                left: { style: BorderStyle.THICK, size: 6, color },
            },
            shading: { fill: theme.surface.replace('#', ''), type: ShadingType.CLEAR },
            spacing: { before: 120, after: 120 },
            indent: { left: 200 },
        }),
    ];
}

function renderImage(section) {
    const imgPath = section.imagePath || section.image || '';
    if (!imgPath || !fs.existsSync(imgPath)) {
        return [new Paragraph({ text: `[Image not found: ${imgPath}]` })];
    }

    const imgData = fs.readFileSync(imgPath);
    const width = section.width || 500;
    const height = section.height || 350;

    const elements = [
        new Paragraph({
            children: [
                new ImageRun({ data: imgData, transformation: { width, height }, type: 'png' }),
            ],
            alignment: AlignmentType.CENTER,
        }),
    ];

    if (section.caption) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: section.caption, italics: true, size: TYPOGRAPHY.docx.caption, color: '6C757D' })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 120 },
        }));
    }

    return elements;
}

function renderPageBreak() {
    return [
        new Paragraph({ children: [new PageBreak()] }),
    ];
}

function renderTwoColumn(section, theme, font) {
    // Approximate two-column using a table with invisible borders
    const leftContent = section.leftContent || section.left || '';
    const rightContent = section.rightContent || section.right || '';

    return [
        new Table({
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({
                                children: parseTextRuns(leftContent, theme, font),
                            })],
                            borders: noBorders(),
                            width: { size: 50, type: WidthType.PERCENTAGE },
                        }),
                        new TableCell({
                            children: [new Paragraph({
                                children: parseTextRuns(rightContent, theme, font),
                            })],
                            borders: noBorders(),
                            width: { size: 50, type: WidthType.PERCENTAGE },
                        }),
                    ],
                }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
        }),
    ];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseTextRuns(text, theme, font) {
    // Simple bold/italic markdown parsing
    const runs = [];
    const parts = String(text).split(/(\*\*[^*]+\*\*|__[^_]+__|_[^_]+_|\*[^*]+\*)/g);

    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('**') && part.endsWith('**')) {
            runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font, size: TYPOGRAPHY.docx.body }));
        } else if (part.startsWith('_') && part.endsWith('_')) {
            runs.push(new TextRun({ text: part.slice(1, -1), italics: true, font, size: TYPOGRAPHY.docx.body }));
        } else {
            runs.push(new TextRun({ text: part, font, size: TYPOGRAPHY.docx.body }));
        }
    }

    return runs.length ? runs : [new TextRun({ text: String(text), font, size: TYPOGRAPHY.docx.body })];
}

function noBorders() {
    const none = { style: BorderStyle.NONE, size: 0 };
    return { top: none, bottom: none, left: none, right: none };
}

// ─── Magazine Quality Section Renderers ─────────────────────────────────────

function renderCover(section, theme, font) {
    const primary = theme.primary.replace('#', '');
    const elements = [];

    // Spacer for dramatic top margin
    elements.push(new Paragraph({ spacing: { before: 2400 } }));

    // Accent bar (simulated with colored paragraph)
    elements.push(new Paragraph({
        children: [new TextRun({ text: ' ', font, size: 4 })],
        shading: { fill: primary, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 200 },
    }));

    // Main title
    elements.push(new Paragraph({
        children: [new TextRun({ text: section.title || section.text || 'Document', bold: true, font, size: 56, color: primary })],
        spacing: { before: 400, after: 120 },
        alignment: AlignmentType.LEFT,
    }));

    // Subtitle
    if (section.subtitle) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: section.subtitle, font, size: 28, color: theme.textSecondary.replace('#', '') })],
            spacing: { after: 400 },
        }));
    }

    // Metadata (author, date, version)
    const metaParts = [];
    if (section.author) metaParts.push(section.author);
    if (section.date) metaParts.push(section.date);
    else metaParts.push(new Date().toLocaleDateString());
    if (section.version) metaParts.push(`v${section.version}`);

    if (metaParts.length) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: metaParts.join('  |  '), font, size: TYPOGRAPHY.docx.body, color: theme.textSecondary.replace('#', '') })],
            spacing: { before: 200 },
        }));
    }

    // Page break after cover
    elements.push(new Paragraph({ children: [new PageBreak()] }));
    return elements;
}

function renderPullQuote(section, theme, font) {
    const text = section.text || section.content || '';
    const attribution = section.attribution || section.author || '';
    const primary = theme.primary.replace('#', '');

    const elements = [
        new Paragraph({
            children: [new TextRun({ text: `\u201C${text}\u201D`, italics: true, font, size: 28, color: primary })],
            border: { left: { style: BorderStyle.THICK, size: 8, color: primary } },
            indent: { left: 400, right: 400 },
            spacing: { before: 300, after: 80 },
        }),
    ];

    if (attribution) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: `\u2014 ${attribution}`, font, size: TYPOGRAPHY.docx.body, color: theme.textSecondary.replace('#', '') })],
            indent: { left: 400 },
            alignment: AlignmentType.RIGHT,
            spacing: { after: 200 },
        }));
    }

    return elements;
}

function renderSidebar(section, theme, font) {
    // Sidebar as a full-width table with colored background cell
    const content = section.text || section.content || '';
    const sidebarTitle = section.title || '';
    const bg = (theme.primaryLight || theme.surface).replace('#', '');
    const primary = theme.primary.replace('#', '');
    const cellChildren = [];
    if (sidebarTitle) {
        cellChildren.push(new Paragraph({
            children: [new TextRun({ text: sidebarTitle, bold: true, font, size: TYPOGRAPHY.docx.heading3, color: primary })],
            spacing: { after: 80 },
        }));
    }
    cellChildren.push(new Paragraph({
        children: parseTextRuns(content, theme, font),
        spacing: { before: 40, after: 40 },
    }));

    return [
        new Table({
            rows: [new TableRow({
                children: [
                    new TableCell({
                        children: cellChildren,
                        shading: { fill: bg, type: ShadingType.CLEAR },
                        borders: {
                            left: { style: BorderStyle.THICK, size: 6, color: primary },
                            top: { style: BorderStyle.NONE, size: 0 },
                            bottom: { style: BorderStyle.NONE, size: 0 },
                            right: { style: BorderStyle.NONE, size: 0 },
                        },
                        width: { size: 100, type: WidthType.PERCENTAGE },
                    }),
                ],
            })],
            width: { size: 100, type: WidthType.PERCENTAGE },
        }),
    ];
}

function renderMetricStrip(section, theme, font) {
    // Row of metric cards as table cells
    const metrics = section.metrics || [];
    if (!metrics.length) return [];

    const primary = theme.primary.replace('#', '');
    const surface = theme.surface.replace('#', '');

    const cells = metrics.map(m => {
        const statusColors = { good: theme.success, warning: theme.warning, critical: theme.danger };
        const statusColor = (statusColors[m.status] || theme.primary).replace('#', '');

        return new TableCell({
            children: [
                new Paragraph({
                    children: [new TextRun({ text: String(m.value || ''), bold: true, font, size: 32, color: primary })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 20 },
                }),
                new Paragraph({
                    children: [new TextRun({ text: m.label || '', font, size: TYPOGRAPHY.docx.small, color: theme.textSecondary.replace('#', '') })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 20 },
                }),
                ...(m.change ? [new Paragraph({
                    children: [new TextRun({ text: String(m.change), font, size: TYPOGRAPHY.docx.caption, color: statusColor })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 60 },
                })] : []),
            ],
            shading: { fill: surface, type: ShadingType.CLEAR },
            borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: statusColor },
                bottom: { style: BorderStyle.NONE, size: 0 },
                left: { style: BorderStyle.NONE, size: 0 },
                right: { style: BorderStyle.NONE, size: 0 },
            },
            verticalAlign: docx.VerticalAlign.CENTER,
        });
    });

    return [
        new Table({
            rows: [new TableRow({ children: cells })],
            width: { size: 100, type: WidthType.PERCENTAGE },
        }),
    ];
}

function renderInfoCardGrid(section, theme, font) {
    // 2-column grid of info cards
    const cards = section.cards || section.items || [];
    if (!cards.length) return [];

    const primary = theme.primary.replace('#', '');
    const surface = theme.surface.replace('#', '');
    const rows = [];

    for (let i = 0; i < cards.length; i += 2) {
        const pair = [cards[i], cards[i + 1]];
        const cells = pair.map(card => {
            if (!card) return new TableCell({ children: [new Paragraph({ text: '' })], borders: noBorders() });
            const content = [];
            if (card.icon) content.push(new Paragraph({
                children: [new TextRun({ text: card.icon, font, size: 36 })],
                spacing: { after: 40 },
            }));
            if (card.title) content.push(new Paragraph({
                children: [new TextRun({ text: card.title, bold: true, font, size: TYPOGRAPHY.docx.heading3, color: primary })],
                spacing: { after: 40 },
            }));
            if (card.description || card.text) content.push(new Paragraph({
                children: [new TextRun({ text: card.description || card.text, font, size: TYPOGRAPHY.docx.body, color: theme.textSecondary.replace('#', '') })],
            }));
            return new TableCell({
                children: content.length ? content : [new Paragraph({ text: '' })],
                shading: { fill: surface, type: ShadingType.CLEAR },
                borders: noBorders(),
                width: { size: 48, type: WidthType.PERCENTAGE },
            });
        });
        rows.push(new TableRow({ children: cells }));
    }

    return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
}

// ─── Rich Visual Section Renderers (Async — Headless Browser) ───────────────

async function renderDiagram(section, theme, font) {
    const mermaidCode = section.mermaidCode || section.code || '';
    if (!mermaidCode) return [new Paragraph({ text: '[Diagram: No Mermaid code provided]' })];

    const result = await renderDiagramForEmbed({
        mermaidCode,
        theme: section.theme || theme._name || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        return [new Paragraph({
            children: [new TextRun({ text: `[Diagram render failed: ${result.error || 'unknown error'}]`, color: 'CC0000', font })],
        })];
    }

    return renderImage({ imagePath: result.imagePath, caption: section.caption, width: section.width || 550, height: section.height || 350 });
}

async function renderChart(section, theme, font) {
    const cd = section.chartData || {};
    const chartType = cd.type || section.chartType || 'bar';
    const result = await renderChartForEmbed({
        type: chartType,
        data: { labels: cd.labels || [], datasets: (cd.datasets || cd.data || []).map((ds, i) => ({ label: ds.name || ds.label || `Series ${i + 1}`, data: ds.values || ds.data || [] })) },
        chartTitle: section.title,
        theme: section.theme || theme._name || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
        value: cd.value, max: cd.max, label: cd.label,
        values: cd.values, labels: cd.labels,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        return [new Paragraph({
            children: [new TextRun({ text: `[Chart render failed: ${result.error || 'unknown error'}]`, color: 'CC0000', font })],
        })];
    }

    const elements = [];
    if (section.title) {
        elements.push(new Paragraph({
            children: [new TextRun({ text: section.title, bold: true, font, size: TYPOGRAPHY.docx.heading3 })],
            spacing: { before: 200, after: 100 },
        }));
    }
    elements.push(...renderImage({ imagePath: result.imagePath, caption: section.caption, width: section.width || 550, height: section.height || 350 }));
    return elements;
}

async function renderInfographic(section, theme, font) {
    const result = await renderInfographicForEmbed({
        type: section.infographicType || section.componentType || 'stat-poster',
        data: section.data || {},
        theme: section.theme || theme._name || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        return [new Paragraph({
            children: [new TextRun({ text: `[Infographic render failed: ${result.error || 'unknown error'}]`, color: 'CC0000', font })],
        })];
    }

    return renderImage({ imagePath: result.imagePath, caption: section.caption, width: section.width || 550, height: section.height || 300 });
}

// ─── Section Type Router ────────────────────────────────────────────────────

const SECTION_RENDERERS = {
    heading: renderHeading,
    paragraph: renderParagraph,
    bullets: renderBullets,
    'numbered-list': renderNumberedList,
    table: renderTable,
    'code-block': renderCodeBlock,
    callout: renderCallout,
    image: renderImage,
    'page-break': renderPageBreak,
    'two-column': renderTwoColumn,
    // Magazine quality (Phase 4.1)
    cover: renderCover,
    'pull-quote': renderPullQuote,
    sidebar: renderSidebar,
    'metric-strip': renderMetricStrip,
    'info-card-grid': renderInfoCardGrid,
    // Rich visuals (Phase 3.4)
    diagram: renderDiagram,
    chart: renderChart,
    infographic: renderInfographic,
};

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a Word document from a flexible sections array.
 *
 * @param {Object} options
 * @param {string} options.title - Document title
 * @param {string} [options.author] - Author
 * @param {boolean} [options.includeTableOfContents] - Add TOC page
 * @param {string} [options.headerText] - Running header text
 * @param {string} [options.footerText] - Running footer text
 * @param {Array} options.sections - Array of section definitions
 * @param {string|Object} [options.theme] - Theme name or override object
 * @param {string} [options.font] - Font override
 * @param {string} [options.outputPath] - Custom output path
 * @returns {Promise<Object>} { success, filePath, fileName, sectionCount, fileSize }
 */
async function generateDocx(options) {
    const { title, author, includeTableOfContents, headerText, footerText, sections = [], theme: themeInput, font: fontInput, outputPath } = options;

    if (!sections.length) {
        return { success: false, error: 'No sections provided' };
    }

    const theme = resolveTheme(themeInput);
    const font = resolveFont(fontInput);
    const primary = theme.primary.replace('#', '');

    // Build all section children
    const children = [];

    // Title page (skip if first section is a cover)
    const hasCover = sections[0]?.type === 'cover';
    if (!hasCover) {
        children.push(
            new Paragraph({
                children: [new TextRun({ text: title || 'Document', bold: true, font, size: TYPOGRAPHY.docx.title, color: primary })],
                spacing: { before: 600, after: 200 },
                alignment: AlignmentType.CENTER,
            })
        );

        if (author) {
            children.push(new Paragraph({
                children: [new TextRun({ text: `${author}  |  ${new Date().toLocaleDateString()}`, font, size: TYPOGRAPHY.docx.body, color: theme.textSecondary.replace('#', '') })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            }));
        }
    }

    // TOC
    if (includeTableOfContents) {
        children.push(new TableOfContents('Table of Contents', {
            hyperlink: true,
            headingStyleRange: '1-3',
        }));
        children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Render each section (some renderers like diagram/chart/infographic are async)
    for (const section of sections) {
        const renderer = SECTION_RENDERERS[section.type];
        if (renderer) {
            let elements = renderer(section, theme, font);
            if (elements && typeof elements.then === 'function') elements = await elements;
            children.push(...elements);
        } else {
            // Fallback: treat as paragraph
            const elements = renderParagraph({ text: section.content || `[Unknown section type: ${section.type}]` }, theme, font);
            children.push(...elements);
        }
    }

    // Cleanup headless browser pools if used
    const asyncTypes = new Set(sections.map(s => s.type));
    if (asyncTypes.has('diagram')) await cleanupDiagramBrowser();
    if (asyncTypes.has('chart')) await cleanupChartBrowser();
    if (asyncTypes.has('infographic')) await cleanupInfographicBrowser();

    // Build document
    const doc = new Document({
        creator: author || 'DocGenie — Doremon Team',
        title: title || 'Document',
        description: `Generated by DocGenie on ${new Date().toISOString()}`,
        styles: {
            default: {
                document: {
                    run: { font, size: TYPOGRAPHY.docx.body },
                },
                heading1: {
                    run: { font, size: TYPOGRAPHY.docx.heading1, bold: true, color: primary },
                    paragraph: { spacing: { before: 360, after: 120 } },
                },
                heading2: {
                    run: { font, size: TYPOGRAPHY.docx.heading2, bold: true, color: primary },
                    paragraph: { spacing: { before: 240, after: 80 } },
                },
                heading3: {
                    run: { font, size: TYPOGRAPHY.docx.heading3, bold: true },
                    paragraph: { spacing: { before: 200, after: 60 } },
                },
            },
        },
        numbering: {
            config: [{
                reference: 'default-numbering',
                levels: [{
                    level: 0,
                    format: docx.LevelFormat.DECIMAL,
                    text: '%1.',
                    alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                }],
            }],
        },
        sections: [{
            properties: {
                page: {
                    margin: SPACING.docx.margin,
                },
            },
            headers: headerText ? {
                default: new Header({
                    children: [new Paragraph({
                        children: [new TextRun({ text: headerText, font, size: TYPOGRAPHY.docx.small, color: theme.textSecondary.replace('#', ''), italics: true })],
                        alignment: AlignmentType.RIGHT,
                    })],
                }),
            } : undefined,
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        children: [new TextRun({ text: footerText || 'Powered by Doremon Team', font, size: TYPOGRAPHY.docx.caption, color: theme.textSecondary.replace('#', '') })],
                        alignment: AlignmentType.CENTER,
                    })],
                }),
            },
            children,
        }],
    });

    // Write file
    const fileName = generateFileName(title || 'Document', '.docx');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        sectionCount: sections.length,
        fileSize: buffer.length,
        fileSizeHuman: `${(buffer.length / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generateDocx, SECTION_RENDERERS };
