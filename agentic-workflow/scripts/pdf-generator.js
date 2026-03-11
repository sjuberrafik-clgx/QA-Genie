/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PDF GENERATOR — Context-Driven PDF Document Generation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dual strategy:
 *   1. pdf-lib for structured content (fast, no browser dependency)
 *   2. Chromium HTML→PDF fallback for rich visual fidelity
 *
 * Supported section types (18 total):
 *   heading, paragraph, bullets, numbered-list, table,
 *   code-block, callout, page-break, two-column,
 *   cover, pull-quote, sidebar, metric-strip, info-card-grid,
 *   diagram, chart, infographic
 *
 * @module scripts/pdf-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { resolveTheme, TYPOGRAPHY, SPACING, getOutputDir, generateFileName, hexToRGB } = require('./doc-design-system');
const { renderForEmbed: renderDiagramForEmbed, cleanupBrowser: cleanupDiagramBrowser } = require('./shared/diagram-engine');
const { renderChartForEmbed, cleanupBrowser: cleanupChartBrowser } = require('./shared/chart-renderer');
const { renderInfographicForEmbed, cleanupBrowser: cleanupInfographicBrowser } = require('./shared/infographic-components');

// ─── Constants & Config ─────────────────────────────────────────────────────

const PAGE_WIDTH = 595.28;   // A4 points
const PAGE_HEIGHT = 841.89;
const MARGIN = SPACING.pdf.margin;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;
const LINE_HEIGHT_FACTORS = { title: 1.5, heading: 1.4, body: 1.35, small: 1.3 };

// ─── PDF Writer State ───────────────────────────────────────────────────────

class PDFWriter {
    constructor(pdfDoc, theme) {
        this.doc = pdfDoc;
        this.theme = theme;
        this.page = null;
        this.yPos = 0;
        this.fonts = {};
        this.pageCount = 0;
    }

    async init() {
        this.fonts.regular = await this.doc.embedFont(StandardFonts.Helvetica);
        this.fonts.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
        this.fonts.italic = await this.doc.embedFont(StandardFonts.HelveticaOblique);
        this.fonts.mono = await this.doc.embedFont(StandardFonts.Courier);
        this.fonts.monoBold = await this.doc.embedFont(StandardFonts.CourierBold);
        this.addPage();
    }

    addPage() {
        this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        this.yPos = PAGE_HEIGHT - MARGIN.top;
        this.pageCount++;
    }

    ensureSpace(needed) {
        if (this.yPos - needed < MARGIN.bottom) {
            this.addFooter();
            this.addPage();
        }
    }

    drawText(text, { font, size, color, x, maxWidth, align } = {}) {
        font = font || this.fonts.regular;
        size = size || TYPOGRAPHY.pdf.body;
        color = color || this.themeColor('text');
        x = x || MARGIN.left;
        maxWidth = maxWidth || CONTENT_WIDTH;

        const lines = this.wrapText(text, font, size, maxWidth);
        const lineHeight = size * LINE_HEIGHT_FACTORS.body;

        for (const line of lines) {
            this.ensureSpace(lineHeight);
            let drawX = x;
            if (align === 'center') {
                const w = font.widthOfTextAtSize(line, size);
                drawX = x + (maxWidth - w) / 2;
            } else if (align === 'right') {
                const w = font.widthOfTextAtSize(line, size);
                drawX = x + maxWidth - w;
            }
            this.page.drawText(line, { x: drawX, y: this.yPos, size, font, color });
            this.yPos -= lineHeight;
        }
    }

    wrapText(text, font, size, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = font.widthOfTextAtSize(testLine, size);
            if (width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines.length ? lines : [''];
    }

    themeColor(key) {
        const colorMap = {
            text: this.theme.text,
            textSecondary: this.theme.textSecondary,
            primary: this.theme.primary,
            surface: this.theme.surface,
            success: this.theme.success,
            warning: this.theme.warning,
            danger: this.theme.danger,
        };
        const hex = colorMap[key] || colorMap.text;
        const { r, g, b } = hexToRGB(hex);
        return rgb(r / 255, g / 255, b / 255);
    }

    addFooter() {
        const footerY = MARGIN.bottom - 20;
        if (footerY < 10) return;
        const text = `Page ${this.pageCount}  |  Powered by Doremon Team`;
        this.page.drawText(text, {
            x: MARGIN.left,
            y: footerY,
            size: TYPOGRAPHY.pdf.caption,
            font: this.fonts.italic,
            color: this.themeColor('textSecondary'),
        });
    }

    addSpace(pts) {
        this.yPos -= pts;
    }
}

// ─── Section Renderers ──────────────────────────────────────────────────────

function renderHeading(writer, section) {
    const level = section.level || 1;
    const sizeMap = { 1: TYPOGRAPHY.pdf.heading1, 2: TYPOGRAPHY.pdf.heading2, 3: TYPOGRAPHY.pdf.heading3 };
    const size = sizeMap[level] || TYPOGRAPHY.pdf.heading1;
    const text = section.text || section.content || '';

    writer.addSpace(level === 1 ? 20 : 14);
    writer.ensureSpace(size * 2);

    // Accent line for H1
    if (level === 1) {
        const { r, g, b } = hexToRGB(writer.theme.primary);
        writer.page.drawRectangle({
            x: MARGIN.left,
            y: writer.yPos + 2,
            width: 50,
            height: 3,
            color: rgb(r / 255, g / 255, b / 255),
        });
        writer.addSpace(8);
    }

    writer.drawText(text, { font: writer.fonts.bold, size, color: writer.themeColor('primary') });
    writer.addSpace(6);
}

function renderParagraph(writer, section) {
    const text = section.text || section.content || '';
    writer.drawText(text);
    writer.addSpace(SPACING.pdf.sectionGap / 2);
}

function renderBullets(writer, section) {
    const items = Array.isArray(section.items) ? section.items : (Array.isArray(section.bullets) ? section.bullets : []);
    const bulletChar = '\u2022';

    for (const item of items) {
        const text = typeof item === 'string' ? item : (item.text || '');
        writer.ensureSpace(TYPOGRAPHY.pdf.body * 1.5);
        writer.drawText(`${bulletChar}  ${text}`, { x: MARGIN.left + 15 });
    }
    writer.addSpace(6);
}

function renderNumberedList(writer, section) {
    const items = Array.isArray(section.items) ? section.items : [];

    items.forEach((item, i) => {
        const text = typeof item === 'string' ? item : (item.text || '');
        writer.ensureSpace(TYPOGRAPHY.pdf.body * 1.5);
        writer.drawText(`${i + 1}.  ${text}`, { x: MARGIN.left + 15 });
    });
    writer.addSpace(6);
}

function renderTable(writer, section) {
    const headers = section.headers || [];
    const rows = section.rows || [];
    if (!headers.length && !rows.length) return;

    const colCount = headers.length || (rows[0] ? (Array.isArray(rows[0]) ? rows[0].length : Object.keys(rows[0]).length) : 1);
    const colWidth = CONTENT_WIDTH / colCount;
    const rowHeight = 22;
    const fontSize = TYPOGRAPHY.pdf.small;

    // Title
    if (section.title) {
        writer.addSpace(8);
        writer.drawText(section.title, { font: writer.fonts.bold, size: TYPOGRAPHY.pdf.heading3 });
        writer.addSpace(4);
    }

    // Header row
    if (headers.length) {
        writer.ensureSpace(rowHeight + 4);
        const { r, g, b } = hexToRGB(writer.theme.primary);
        writer.page.drawRectangle({
            x: MARGIN.left,
            y: writer.yPos - rowHeight + 4,
            width: CONTENT_WIDTH,
            height: rowHeight,
            color: rgb(r / 255, g / 255, b / 255),
        });

        headers.forEach((h, ci) => {
            writer.page.drawText(String(h), {
                x: MARGIN.left + ci * colWidth + 6,
                y: writer.yPos - 12,
                size: fontSize,
                font: writer.fonts.bold,
                color: rgb(1, 1, 1),
            });
        });
        writer.yPos -= rowHeight;
    }

    // Data rows
    for (let ri = 0; ri < rows.length; ri++) {
        writer.ensureSpace(rowHeight + 4);
        const rowData = Array.isArray(rows[ri]) ? rows[ri] : Object.values(rows[ri]);

        // Alternating row background
        if (ri % 2 === 0) {
            const { r, g, b } = hexToRGB(writer.theme.surface);
            writer.page.drawRectangle({
                x: MARGIN.left,
                y: writer.yPos - rowHeight + 4,
                width: CONTENT_WIDTH,
                height: rowHeight,
                color: rgb(r / 255, g / 255, b / 255),
            });
        }

        rowData.forEach((cell, ci) => {
            writer.page.drawText(String(cell ?? '').substring(0, 50), {
                x: MARGIN.left + ci * colWidth + 6,
                y: writer.yPos - 12,
                size: fontSize,
                font: writer.fonts.regular,
                color: writer.themeColor('text'),
            });
        });
        writer.yPos -= rowHeight;
    }

    writer.addSpace(10);
}

function renderCodeBlock(writer, section) {
    const code = section.code || section.content || '';
    const language = section.language || '';
    const lines = code.split('\n');
    const lineHeight = TYPOGRAPHY.pdf.small * 1.4;
    const blockHeight = lines.length * lineHeight + 16;

    writer.ensureSpace(Math.min(blockHeight, 200));

    if (language) {
        writer.drawText(language.toUpperCase(), {
            font: writer.fonts.italic,
            size: TYPOGRAPHY.pdf.caption,
            color: writer.themeColor('textSecondary'),
        });
        writer.addSpace(2);
    }

    // Background
    const { r, g, b } = hexToRGB(writer.theme.surface);
    const bgHeight = Math.min(lines.length * lineHeight + 12, writer.yPos - MARGIN.bottom);
    writer.page.drawRectangle({
        x: MARGIN.left,
        y: writer.yPos - bgHeight,
        width: CONTENT_WIDTH,
        height: bgHeight,
        color: rgb(r / 255, g / 255, b / 255),
    });

    writer.addSpace(6);
    for (const line of lines) {
        writer.ensureSpace(lineHeight);
        writer.drawText(line || ' ', {
            font: writer.fonts.mono,
            size: TYPOGRAPHY.pdf.small,
            x: MARGIN.left + 10,
        });
    }
    writer.addSpace(8);
}

function renderCallout(writer, section) {
    const text = section.text || section.content || '';
    const calloutType = section.calloutType || 'info';

    const colorMap = {
        info: writer.theme.primary,
        success: writer.theme.success,
        warning: writer.theme.warning,
        danger: writer.theme.danger,
    };
    const hex = colorMap[calloutType] || writer.theme.primary;
    const { r, g, b } = hexToRGB(hex);
    const accentColor = rgb(r / 255, g / 255, b / 255);

    const lines = writer.wrapText(text, writer.fonts.regular, TYPOGRAPHY.pdf.body, CONTENT_WIDTH - 30);
    const blockHeight = lines.length * TYPOGRAPHY.pdf.body * 1.4 + 16;

    writer.ensureSpace(blockHeight);

    // Background
    const { r: sr, g: sg, b: sb } = hexToRGB(writer.theme.surface);
    writer.page.drawRectangle({
        x: MARGIN.left,
        y: writer.yPos - blockHeight,
        width: CONTENT_WIDTH,
        height: blockHeight,
        color: rgb(sr / 255, sg / 255, sb / 255),
    });

    // Left accent bar
    writer.page.drawRectangle({
        x: MARGIN.left,
        y: writer.yPos - blockHeight,
        width: 4,
        height: blockHeight,
        color: accentColor,
    });

    writer.addSpace(8);
    writer.drawText(text, { x: MARGIN.left + 15 });
    writer.addSpace(8);
}

function renderPageBreak(writer) {
    writer.addFooter();
    writer.addPage();
}

function renderTwoColumn(writer, section) {
    const leftText = section.leftContent || section.left || '';
    const rightText = section.rightContent || section.right || '';
    const halfWidth = (CONTENT_WIDTH - 20) / 2;

    // Save Y for right column
    const startY = writer.yPos;

    // Left column
    const leftLines = writer.wrapText(leftText, writer.fonts.regular, TYPOGRAPHY.pdf.body, halfWidth);
    for (const line of leftLines) {
        writer.ensureSpace(TYPOGRAPHY.pdf.body * 1.35);
        writer.page.drawText(line, {
            x: MARGIN.left,
            y: writer.yPos,
            size: TYPOGRAPHY.pdf.body,
            font: writer.fonts.regular,
            color: writer.themeColor('text'),
        });
        writer.yPos -= TYPOGRAPHY.pdf.body * 1.35;
    }
    const leftEndY = writer.yPos;

    // Right column
    writer.yPos = startY;
    const rightLines = writer.wrapText(rightText, writer.fonts.regular, TYPOGRAPHY.pdf.body, halfWidth);
    for (const line of rightLines) {
        writer.page.drawText(line, {
            x: MARGIN.left + halfWidth + 20,
            y: writer.yPos,
            size: TYPOGRAPHY.pdf.body,
            font: writer.fonts.regular,
            color: writer.themeColor('text'),
        });
        writer.yPos -= TYPOGRAPHY.pdf.body * 1.35;
    }
    const rightEndY = writer.yPos;

    writer.yPos = Math.min(leftEndY, rightEndY);
    writer.addSpace(10);
}

// ─── Section Type Router ────────────────────────────────────────────────────

// ─── Rich Visual Section Renderers (Async — Headless Browser + Image Embed) ─

async function renderDiagramSection(writer, section) {
    const mermaidCode = section.mermaidCode || section.code || '';
    if (!mermaidCode) { renderParagraph(writer, { text: '[Diagram: No Mermaid code provided]' }); return; }

    const result = await renderDiagramForEmbed({
        mermaidCode,
        theme: section.theme || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        renderParagraph(writer, { text: `[Diagram render failed: ${result.error || 'unknown error'}]` });
        return;
    }

    await embedPngInPdf(writer, result.imagePath, section);
}

async function renderChartSection(writer, section) {
    const cd = section.chartData || {};
    const result = await renderChartForEmbed({
        type: cd.type || section.chartType || 'bar',
        data: { labels: cd.labels || [], datasets: (cd.datasets || cd.data || []).map((ds, i) => ({ label: ds.name || ds.label || `Series ${i + 1}`, data: ds.values || ds.data || [] })) },
        chartTitle: section.title,
        theme: section.theme || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
        value: cd.value, max: cd.max, label: cd.label,
        values: cd.values, labels: cd.labels,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        renderParagraph(writer, { text: `[Chart render failed: ${result.error || 'unknown error'}]` });
        return;
    }

    if (section.title) {
        writer.addSpace(8);
        writer.drawText(section.title, { font: writer.fonts.bold, size: TYPOGRAPHY.pdf.heading3, color: writer.themeColor('primary') });
        writer.addSpace(4);
    }
    await embedPngInPdf(writer, result.imagePath, section);
}

async function renderInfographicSection(writer, section) {
    const result = await renderInfographicForEmbed({
        type: section.infographicType || section.componentType || 'stat-poster',
        data: section.data || {},
        theme: section.theme || 'modern-blue',
        ticketId: section.ticketId,
        slideIndex: 0,
    });

    if (!result.imagePath || !fs.existsSync(result.imagePath)) {
        renderParagraph(writer, { text: `[Infographic render failed: ${result.error || 'unknown error'}]` });
        return;
    }

    await embedPngInPdf(writer, result.imagePath, section);
}

async function embedPngInPdf(writer, imgPath, section) {
    const imgBytes = fs.readFileSync(imgPath);
    const pngImage = await writer.doc.embedPng(imgBytes);
    const dims = pngImage.scale(1);
    const maxW = section.width || CONTENT_WIDTH;
    const scale = Math.min(maxW / dims.width, 1);
    const drawW = dims.width * scale;
    const drawH = dims.height * scale;

    writer.ensureSpace(drawH + 20);
    const x = MARGIN.left + (CONTENT_WIDTH - drawW) / 2;
    writer.page.drawImage(pngImage, { x, y: writer.yPos - drawH, width: drawW, height: drawH });
    writer.yPos -= drawH + 10;

    if (section.caption) {
        writer.drawText(section.caption, {
            font: writer.fonts.italic,
            size: TYPOGRAPHY.pdf.caption,
            color: writer.themeColor('textSecondary'),
            align: 'center',
        });
        writer.addSpace(6);
    }
}

// ─── Magazine Quality Section Renderers (Phase 4.2) ─────────────────────────

function renderCover(writer, section) {
    // Full-page cover design with gradient bar, title, subtitle, metadata
    const theme = writer.theme;
    const { r: pr, g: pg, b: pb } = hexToRGB(theme.primary);
    const primaryColor = rgb(pr / 255, pg / 255, pb / 255);

    // Full-width gradient accent bar at top
    writer.page.drawRectangle({
        x: 0, y: PAGE_HEIGHT - 8,
        width: PAGE_WIDTH, height: 8,
        color: primaryColor,
    });

    // Secondary thin bar below
    const { r: ar, g: ag, b: ab } = hexToRGB(theme.accent || theme.primary);
    writer.page.drawRectangle({
        x: 0, y: PAGE_HEIGHT - 12,
        width: PAGE_WIDTH, height: 4,
        color: rgb(ar / 255, ag / 255, ab / 255),
    });

    // Decorative vertical bar on left
    writer.page.drawRectangle({
        x: MARGIN.left - 10, y: PAGE_HEIGHT * 0.25,
        width: 4, height: PAGE_HEIGHT * 0.4,
        color: primaryColor,
    });

    // Main title — centered, large
    writer.yPos = PAGE_HEIGHT * 0.55;
    writer.drawText(section.title || section.text || 'Document', {
        font: writer.fonts.bold,
        size: 32,
        color: writer.themeColor('primary'),
        align: 'center',
    });

    // Subtitle
    if (section.subtitle) {
        writer.addSpace(8);
        writer.drawText(section.subtitle, {
            font: writer.fonts.italic,
            size: 16,
            color: writer.themeColor('textSecondary'),
            align: 'center',
        });
    }

    // Metadata line (author, date, version)
    const metaParts = [];
    if (section.author) metaParts.push(section.author);
    if (section.date) metaParts.push(section.date);
    else metaParts.push(new Date().toLocaleDateString());
    if (section.version) metaParts.push(`v${section.version}`);

    if (metaParts.length) {
        writer.addSpace(30);
        writer.drawText(metaParts.join('  |  '), {
            font: writer.fonts.regular,
            size: TYPOGRAPHY.pdf.body,
            color: writer.themeColor('textSecondary'),
            align: 'center',
        });
    }

    // Bottom accent line
    writer.page.drawRectangle({
        x: PAGE_WIDTH * 0.3, y: MARGIN.bottom + 40,
        width: PAGE_WIDTH * 0.4, height: 2,
        color: primaryColor,
    });

    // Force new page after cover
    writer.addFooter();
    writer.addPage();
}

function renderPullQuote(writer, section) {
    const text = section.text || section.content || '';
    const attribution = section.attribution || section.author || '';
    const { r: pr, g: pg, b: pb } = hexToRGB(writer.theme.primary);
    const primaryColor = rgb(pr / 255, pg / 255, pb / 255);

    const lines = writer.wrapText(text, writer.fonts.italic, 14, CONTENT_WIDTH - 60);
    const lineHeight = 14 * 1.5;
    const blockHeight = lines.length * lineHeight + (attribution ? 30 : 10) + 20;

    writer.ensureSpace(blockHeight);

    // Left accent border
    writer.page.drawRectangle({
        x: MARGIN.left + 15,
        y: writer.yPos - blockHeight + 10,
        width: 4,
        height: blockHeight - 10,
        color: primaryColor,
    });

    // Quote text
    writer.addSpace(10);
    for (const line of lines) {
        writer.page.drawText(line, {
            x: MARGIN.left + 30,
            y: writer.yPos,
            size: 14,
            font: writer.fonts.italic,
            color: writer.themeColor('primary'),
        });
        writer.yPos -= lineHeight;
    }

    // Attribution
    if (attribution) {
        writer.addSpace(6);
        writer.drawText(`\u2014 ${attribution}`, {
            font: writer.fonts.regular,
            size: TYPOGRAPHY.pdf.body,
            color: writer.themeColor('textSecondary'),
            x: MARGIN.left + 30,
        });
    }
    writer.addSpace(12);
}

function renderSidebar(writer, section) {
    const text = section.text || section.content || '';
    const sidebarTitle = section.title || '';
    const { r: br, g: bg2, b: bb } = hexToRGB(writer.theme.primaryLight || writer.theme.surface);
    const { r: pr, g: pg, b: pb } = hexToRGB(writer.theme.primary);

    const titleLines = sidebarTitle ? writer.wrapText(sidebarTitle, writer.fonts.bold, TYPOGRAPHY.pdf.heading3, CONTENT_WIDTH - 30) : [];
    const bodyLines = writer.wrapText(text, writer.fonts.regular, TYPOGRAPHY.pdf.body, CONTENT_WIDTH - 30);
    const titleHeight = titleLines.length * TYPOGRAPHY.pdf.heading3 * 1.4;
    const bodyHeight = bodyLines.length * TYPOGRAPHY.pdf.body * 1.35;
    const blockHeight = titleHeight + bodyHeight + 24;

    writer.ensureSpace(blockHeight);

    // Background
    writer.page.drawRectangle({
        x: MARGIN.left,
        y: writer.yPos - blockHeight,
        width: CONTENT_WIDTH,
        height: blockHeight,
        color: rgb(br / 255, bg2 / 255, bb / 255),
    });

    // Left accent border
    writer.page.drawRectangle({
        x: MARGIN.left,
        y: writer.yPos - blockHeight,
        width: 4,
        height: blockHeight,
        color: rgb(pr / 255, pg / 255, pb / 255),
    });

    // Title
    writer.addSpace(8);
    for (const line of titleLines) {
        writer.page.drawText(line, {
            x: MARGIN.left + 14,
            y: writer.yPos,
            size: TYPOGRAPHY.pdf.heading3,
            font: writer.fonts.bold,
            color: rgb(pr / 255, pg / 255, pb / 255),
        });
        writer.yPos -= TYPOGRAPHY.pdf.heading3 * 1.4;
    }

    // Body
    writer.addSpace(4);
    for (const line of bodyLines) {
        writer.page.drawText(line, {
            x: MARGIN.left + 14,
            y: writer.yPos,
            size: TYPOGRAPHY.pdf.body,
            font: writer.fonts.regular,
            color: writer.themeColor('text'),
        });
        writer.yPos -= TYPOGRAPHY.pdf.body * 1.35;
    }
    writer.addSpace(10);
}

function renderMetricStrip(writer, section) {
    const metrics = section.metrics || [];
    if (!metrics.length) return;

    const cardWidth = CONTENT_WIDTH / metrics.length;
    const cardHeight = 65;

    writer.addSpace(8);
    writer.ensureSpace(cardHeight + 10);

    const startY = writer.yPos;

    for (let i = 0; i < metrics.length; i++) {
        const m = metrics[i];
        const x = MARGIN.left + i * cardWidth;

        // Status color for top border
        const statusColors = { good: writer.theme.success, warning: writer.theme.warning, critical: writer.theme.danger };
        const statusHex = statusColors[m.status] || writer.theme.primary;
        const { r: sr, g: sg, b: sb } = hexToRGB(statusHex);

        // Card background
        const { r: bgr, g: bgg, b: bgb } = hexToRGB(writer.theme.surface);
        writer.page.drawRectangle({
            x: x + 2, y: startY - cardHeight,
            width: cardWidth - 4, height: cardHeight,
            color: rgb(bgr / 255, bgg / 255, bgb / 255),
        });

        // Top accent bar
        writer.page.drawRectangle({
            x: x + 2, y: startY,
            width: cardWidth - 4, height: 3,
            color: rgb(sr / 255, sg / 255, sb / 255),
        });

        // Value (large, centered)
        const valText = String(m.value || '');
        const valWidth = writer.fonts.bold.widthOfTextAtSize(valText, 18);
        writer.page.drawText(valText, {
            x: x + (cardWidth - valWidth) / 2,
            y: startY - 22,
            size: 18,
            font: writer.fonts.bold,
            color: writer.themeColor('primary'),
        });

        // Label (small, centered)
        const lblText = m.label || '';
        const lblWidth = writer.fonts.regular.widthOfTextAtSize(lblText, TYPOGRAPHY.pdf.small);
        writer.page.drawText(lblText, {
            x: x + (cardWidth - lblWidth) / 2,
            y: startY - 40,
            size: TYPOGRAPHY.pdf.small,
            font: writer.fonts.regular,
            color: writer.themeColor('textSecondary'),
        });

        // Change indicator
        if (m.change) {
            const chgText = String(m.change);
            const chgWidth = writer.fonts.regular.widthOfTextAtSize(chgText, TYPOGRAPHY.pdf.caption);
            writer.page.drawText(chgText, {
                x: x + (cardWidth - chgWidth) / 2,
                y: startY - 55,
                size: TYPOGRAPHY.pdf.caption,
                font: writer.fonts.regular,
                color: rgb(sr / 255, sg / 255, sb / 255),
            });
        }
    }

    writer.yPos = startY - cardHeight - 10;
}

function renderInfoCardGrid(writer, section) {
    const cards = section.cards || section.items || [];
    if (!cards.length) return;

    const colCount = 2;
    const cardWidth = (CONTENT_WIDTH - 15) / colCount;
    const cardHeight = 70;

    writer.addSpace(8);

    for (let i = 0; i < cards.length; i += colCount) {
        writer.ensureSpace(cardHeight + 8);
        const startY = writer.yPos;

        for (let j = 0; j < colCount; j++) {
            const card = cards[i + j];
            if (!card) continue;

            const x = MARGIN.left + j * (cardWidth + 15);

            // Card background
            const { r: bgr, g: bgg, b: bgb } = hexToRGB(writer.theme.surface);
            writer.page.drawRectangle({
                x, y: startY - cardHeight,
                width: cardWidth, height: cardHeight,
                color: rgb(bgr / 255, bgg / 255, bgb / 255),
            });

            // Icon
            let textY = startY - 16;
            if (card.icon) {
                writer.page.drawText(card.icon, {
                    x: x + 8, y: textY,
                    size: 16, font: writer.fonts.regular,
                    color: writer.themeColor('primary'),
                });
                textY -= 18;
            }

            // Title
            if (card.title) {
                writer.page.drawText(card.title, {
                    x: x + 8, y: textY,
                    size: TYPOGRAPHY.pdf.heading3,
                    font: writer.fonts.bold,
                    color: writer.themeColor('primary'),
                });
                textY -= 16;
            }

            // Description — wrap to card width
            if (card.description || card.text) {
                const desc = card.description || card.text;
                const descLines = writer.wrapText(desc, writer.fonts.regular, TYPOGRAPHY.pdf.small, cardWidth - 16);
                for (const line of descLines.slice(0, 2)) { // max 2 lines
                    writer.page.drawText(line, {
                        x: x + 8, y: textY,
                        size: TYPOGRAPHY.pdf.small,
                        font: writer.fonts.regular,
                        color: writer.themeColor('textSecondary'),
                    });
                    textY -= TYPOGRAPHY.pdf.small * 1.3;
                }
            }
        }

        writer.yPos = startY - cardHeight - 6;
    }
}

function renderTableOfContents(writer, sections) {
    // Generate TOC from heading sections with dot leaders
    const headings = sections.filter(s => s.type === 'heading');
    if (!headings.length) return;

    writer.drawText('Table of Contents', {
        font: writer.fonts.bold,
        size: TYPOGRAPHY.pdf.heading1,
        color: writer.themeColor('primary'),
    });
    writer.addSpace(12);

    const dotChar = '.';
    for (let i = 0; i < headings.length; i++) {
        const h = headings[i];
        const level = h.level || 1;
        const indent = (level - 1) * 20;
        const text = h.text || h.content || '';
        const font = level === 1 ? writer.fonts.bold : writer.fonts.regular;
        const size = level === 1 ? TYPOGRAPHY.pdf.body : TYPOGRAPHY.pdf.small;

        writer.ensureSpace(size * 1.5);

        // Text on left
        const maxTextWidth = CONTENT_WIDTH - indent - 40;
        const truncated = text.length > 60 ? text.substring(0, 57) + '...' : text;
        writer.page.drawText(truncated, {
            x: MARGIN.left + indent,
            y: writer.yPos,
            size, font,
            color: writer.themeColor('text'),
        });

        // Dot leaders
        const textWidth = font.widthOfTextAtSize(truncated, size);
        const dotsStart = MARGIN.left + indent + textWidth + 4;
        const dotsEnd = MARGIN.left + CONTENT_WIDTH - 30;
        const dotWidth = writer.fonts.regular.widthOfTextAtSize(dotChar, TYPOGRAPHY.pdf.small);
        let dx = dotsStart;
        while (dx < dotsEnd) {
            writer.page.drawText(dotChar, {
                x: dx, y: writer.yPos,
                size: TYPOGRAPHY.pdf.small,
                font: writer.fonts.regular,
                color: writer.themeColor('textSecondary'),
            });
            dx += dotWidth + 1;
        }

        writer.yPos -= size * 1.6;
    }

    writer.addSpace(10);
    // Page break after TOC
    writer.addFooter();
    writer.addPage();
}

// ─── Utility: Watermark ─────────────────────────────────────────────────────

function applyWatermark(writer, text) {
    // Rotated semi-transparent text across the page center
    const pages = writer.doc.getPages();
    for (const page of pages) {
        page.drawText(text, {
            x: PAGE_WIDTH * 0.15,
            y: PAGE_HEIGHT * 0.35,
            size: 60,
            font: writer.fonts.bold,
            color: rgb(0.85, 0.85, 0.85),
            rotate: { type: 'degrees', angle: 45 },
            opacity: 0.15,
        });
    }
}

// ─── Utility: Page Borders ──────────────────────────────────────────────────

function applyPageBorders(writer, { startPage = 1 } = {}) {
    // Subtle accent border on content pages (skip cover)
    const { r, g, b } = hexToRGB(writer.theme.border || writer.theme.primary);
    const borderColor = rgb(r / 255, g / 255, b / 255);
    const pages = writer.doc.getPages();
    const inset = 20;

    for (let i = startPage; i < pages.length; i++) {
        const page = pages[i];
        // Top border
        page.drawRectangle({
            x: inset, y: PAGE_HEIGHT - inset,
            width: PAGE_WIDTH - 2 * inset, height: 0.5,
            color: borderColor,
        });
        // Bottom border
        page.drawRectangle({
            x: inset, y: inset,
            width: PAGE_WIDTH - 2 * inset, height: 0.5,
            color: borderColor,
        });
        // Left border
        page.drawRectangle({
            x: inset, y: inset,
            width: 0.5, height: PAGE_HEIGHT - 2 * inset,
            color: borderColor,
        });
        // Right border
        page.drawRectangle({
            x: PAGE_WIDTH - inset, y: inset,
            width: 0.5, height: PAGE_HEIGHT - 2 * inset,
            color: borderColor,
        });
    }
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
    'page-break': renderPageBreak,
    'two-column': renderTwoColumn,
    // Magazine quality (Phase 4.2)
    cover: renderCover,
    'pull-quote': renderPullQuote,
    sidebar: renderSidebar,
    'metric-strip': renderMetricStrip,
    'info-card-grid': renderInfoCardGrid,
    // Rich visuals (Phase 3.4)
    diagram: renderDiagramSection,
    chart: renderChartSection,
    infographic: renderInfographicSection,
};

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a PDF document from a flexible sections array.
 *
 * @param {Object} options
 * @param {string} options.title - Document title
 * @param {string} [options.author] - Author
 * @param {Array}  options.sections - Array of section definitions
 * @param {string|Object} [options.theme] - Theme name or override object
 * @param {string} [options.outputPath] - Custom output path
 * @returns {Promise<Object>} { success, filePath, fileName, pageCount, fileSize }
 */
async function generatePdf(options) {
    const { title, author, sections = [], theme: themeInput, outputPath, watermark, includeTableOfContents, pageBorders } = options;

    if (!sections.length) {
        return { success: false, error: 'No sections provided' };
    }

    const theme = resolveTheme(themeInput);
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(title || 'Document');
    pdfDoc.setAuthor(author || 'DocGenie — Doremon Team');
    pdfDoc.setCreationDate(new Date());

    const writer = new PDFWriter(pdfDoc, theme);
    await writer.init();

    // Title page (skip if first section is a cover)
    const hasCover = sections[0]?.type === 'cover';
    if (!hasCover) {
        writer.addSpace(40);
        writer.drawText(title || 'Document', {
            font: writer.fonts.bold,
            size: TYPOGRAPHY.pdf.title,
            color: writer.themeColor('primary'),
            align: 'center',
        });

        if (author) {
            writer.addSpace(10);
            writer.drawText(`${author}  |  ${new Date().toLocaleDateString()}`, {
                font: writer.fonts.italic,
                size: TYPOGRAPHY.pdf.body,
                color: writer.themeColor('textSecondary'),
                align: 'center',
            });
        }

        writer.addSpace(30);
    }

    // Table of contents (after cover/title, before content)
    if (includeTableOfContents) {
        if (!hasCover) {
            writer.addFooter();
            writer.addPage();
        }
        renderTableOfContents(writer, sections);
    }

    // Render sections (some renderers like diagram/chart/infographic are async)
    for (const section of sections) {
        const renderer = SECTION_RENDERERS[section.type];
        if (renderer) {
            const result = renderer(writer, section);
            if (result && typeof result.then === 'function') await result;
        } else {
            renderParagraph(writer, { text: section.content || `[Unknown section type: ${section.type}]` });
        }
    }

    // Cleanup headless browser pools if used
    const asyncTypes = new Set(sections.map(s => s.type));
    if (asyncTypes.has('diagram')) await cleanupDiagramBrowser();
    if (asyncTypes.has('chart')) await cleanupChartBrowser();
    if (asyncTypes.has('infographic')) await cleanupInfographicBrowser();

    // Post-processing: watermark
    if (watermark) {
        applyWatermark(writer, typeof watermark === 'string' ? watermark : 'DRAFT');
    }

    // Post-processing: page borders
    if (pageBorders !== false) {
        applyPageBorders(writer, { startPage: hasCover ? 1 : 0 });
    }

    // Final footer
    writer.addFooter();

    // Write file
    const fileName = generateFileName(title || 'Document', '.pdf');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        pageCount: writer.pageCount,
        sectionCount: sections.length,
        fileSize: pdfBytes.length,
        fileSizeHuman: `${(pdfBytes.length / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generatePdf, SECTION_RENDERERS };
