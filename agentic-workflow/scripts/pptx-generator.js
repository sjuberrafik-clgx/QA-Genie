/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PPTX GENERATOR v2 — Award-Winning PowerPoint Presentation Generation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates stunning, premium PowerPoint presentations using a visual
 * primitives engine, smart layout system, and modern design tokens.
 *
 * Supported slide types (28 total):
 *   ORIGINAL 11: title, content, bullets, two-column, table, chart, image,
 *                quote, section-break, comparison, summary
 *   NEW 17: timeline, process-flow, stats-dashboard, icon-grid, pyramid,
 *           matrix-quadrant, agenda, team-profiles, before-after, funnel,
 *           roadmap, swot, hero-image, closing, diagram, data-story,
 *           infographic
 *
 * @module scripts/pptx-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const { resolveTheme, resolveFont, resolveLogoPath, TYPOGRAPHY, SPACING, ELEVATION, ANIMATIONS, STATUS_BADGES, getOutputDir, generateFileName, blendColors, hexToRGBA } = require('./doc-design-system');
const { createCard, createGradientRect, createAccentBar, createIconBadge, createMetricCard, createCalloutBox, createStatusBadge, createProgressBar, createConnectorArrow, pptxRenderers } = require('./shared/visual-primitives');
const { calculateGrid, analyzeTextDensity, computeBulletLayout, computeTableLayout, calculateTimelineLayout, calculateProcessFlowLayout, calculateFunnelLayout, calculateQuadrantLayout, calculateRoadmapLayout, goldenSplit } = require('./shared/layout-engine');
const { renderForEmbed, cleanupBrowser: cleanupDiagramBrowser } = require('./shared/diagram-engine');
const { renderChartForEmbed, cleanupBrowser: cleanupChartBrowser } = require('./shared/chart-renderer');
const { renderInfographicForEmbed, cleanupBrowser: cleanupInfographicBrowser } = require('./shared/infographic-components');

// ─── Slide Renderers (v2 — Visual Primitives Engine) ────────────────────────

function renderTitleSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    const sp = SPACING.pptx;

    // Hero gradient background (blended midpoint — pptxgenjs limitation)
    const grad = theme.gradients || {};
    const heroStart = (grad.hero && grad.hero.start) || theme.primary;
    const heroEnd = (grad.hero && grad.hero.end) || theme.primaryDark;
    s.background = { fill: blendColors(heroStart, heroEnd, 0.45).replace('#', '') };

    // Decorative accent bar at top
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'top', x: 0, y: 0,
        length: sp.slideWidth, color: theme.accent, thickness: 0.06,
    }));

    // Subtle geometric decoration — bottom-right corner accent
    s.addShape(pres.ShapeType.roundRect, {
        x: sp.slideWidth - 3.5, y: 5.5, w: 4.0, h: 2.5,
        fill: { color: blendColors(heroEnd, '#FFFFFF', 0.1).replace('#', '') },
        rectRadius: 0.2,
        rotate: -8,
    });

    // Title text with display font
    s.addText(slide.title || 'Untitled Presentation', {
        x: sp.margin.x + 0.3, y: 1.6, w: sp.slideWidth - sp.margin.x * 2 - 0.6, h: 1.8,
        fontSize: TYPOGRAPHY.pptx.titleSlide.title,
        fontFace: TYPOGRAPHY.fontFamily.display || font,
        color: theme.textOnPrimary,
        bold: true,
        align: 'left',
        valign: 'bottom',
        lineSpacing: 42,
    });

    // Accent underline below title
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'horizontal', x: sp.margin.x + 0.3, y: 3.55,
        length: 2.5, color: theme.accent, thickness: 0.05,
    }));

    // Subtitle
    if (slide.subtitle) {
        s.addText(slide.subtitle, {
            x: sp.margin.x + 0.3, y: 3.75, w: sp.slideWidth - sp.margin.x * 2 - 0.6, h: 0.9,
            fontSize: TYPOGRAPHY.pptx.titleSlide.subtitle,
            fontFace: font,
            color: theme.textOnPrimary,
            align: 'left',
            valign: 'top',
        });
    }

    // Date / Author — bottom left with subtle styling
    const meta = [];
    if (slide.author) meta.push(slide.author);
    if (slide.date) meta.push(slide.date);
    else meta.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

    if (meta.length) {
        s.addText(meta.join('  \u2022  '), {
            x: sp.margin.x + 0.3, y: 5.8, w: 5, h: 0.5,
            fontSize: TYPOGRAPHY.pptx.contentSlide.caption,
            fontFace: font,
            color: theme.textOnPrimary,
            align: 'left',
        });
    }

    return s;
}

function renderContentSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const content = slide.content || '';
    const density = analyzeTextDensity(content, SPACING.pptx.contentArea);
    const fontSize = TYPOGRAPHY.pptx.contentSlide.body + density.suggestedFontAdjust;

    // Content card with subtle elevation
    const ca = SPACING.pptx.contentArea;
    pptxRenderers.renderCard(s, pres, createCard({
        x: ca.x - 0.1, y: ca.y - 0.1, w: ca.w + 0.2, h: ca.h + 0.2,
        fill: theme.surface, elevation: 'subtle', radius: 'medium',
        accentEdge: 'left', accentColor: theme.primary,
    }));

    s.addText(content, {
        x: ca.x + 0.15, y: ca.y, w: ca.w - 0.15, h: ca.h,
        fontSize,
        fontFace: font,
        color: theme.text,
        valign: 'top',
        wrap: true,
        paraSpaceAfter: 8,
        lineSpacing: 20,
    });

    return s;
}

function renderBulletsSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    const ca = SPACING.pptx.contentArea;
    const layout = computeBulletLayout(bullets.length);

    if (layout.columns === 1) {
        // Single column — icon-accented bullets
        const textItems = bullets.map((b, i) => {
            const text = typeof b === 'string' ? b : (b.text || '');
            const color = (b && b.color) ? b.color : theme.text;
            return {
                text: `  ${text}`,
                options: {
                    fontSize: layout.fontSize || TYPOGRAPHY.pptx.contentSlide.body,
                    fontFace: font,
                    color,
                    bullet: { type: 'number', numberStartAt: 0, code: '25CF' },
                    indentLevel: 0,
                    paraSpaceBefore: 6,
                    paraSpaceAfter: 6,
                },
            };
        });

        // Subtle background card
        pptxRenderers.renderCard(s, pres, createCard({
            x: ca.x - 0.05, y: ca.y - 0.05, w: ca.w + 0.1, h: ca.h + 0.1,
            fill: theme.surface, elevation: 'none', radius: 'small',
        }));

        s.addText(textItems, {
            x: ca.x + 0.15, y: ca.y + 0.1, w: ca.w - 0.3, h: ca.h - 0.2,
            valign: 'top',
        });
    } else {
        // Two-column layout for many bullets
        const mid = Math.ceil(bullets.length / 2);
        const colW = ca.w / 2 - 0.15;

        [bullets.slice(0, mid), bullets.slice(mid)].forEach((colBullets, ci) => {
            const colX = ca.x + ci * (colW + 0.3);

            pptxRenderers.renderCard(s, pres, createCard({
                x: colX - 0.05, y: ca.y - 0.05, w: colW + 0.1, h: ca.h + 0.1,
                fill: theme.surface, elevation: 'none', radius: 'small',
            }));

            const textItems = colBullets.map(b => {
                const text = typeof b === 'string' ? b : (b.text || '');
                return {
                    text: `  ${text}`,
                    options: {
                        fontSize: layout.fontSize || TYPOGRAPHY.pptx.contentSlide.body - 1,
                        fontFace: font,
                        color: theme.text,
                        bullet: { type: 'number', numberStartAt: 0, code: '25CF' },
                        paraSpaceBefore: 4, paraSpaceAfter: 4,
                    },
                };
            });

            s.addText(textItems, {
                x: colX + 0.1, y: ca.y + 0.1, w: colW - 0.2, h: ca.h - 0.2,
                valign: 'top',
            });
        });
    }

    return s;
}

function renderTwoColumnSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;
    const split = goldenSplit(ca.w, slide.invertSplit ? 'right-major' : 'left-major');
    const leftW = split.major;
    const rightW = split.minor;
    const gap = 0.3;

    // Left card
    pptxRenderers.renderCard(s, pres, createCard({
        x: ca.x, y: ca.y, w: leftW, h: ca.h,
        fill: theme.surface, elevation: 'subtle', radius: 'small',
        accentEdge: 'top', accentColor: theme.primary,
    }));

    const leftContent = slide.leftContent || slide.left || '';
    s.addText(leftContent, {
        x: ca.x + 0.15, y: ca.y + 0.15, w: leftW - 0.3, h: ca.h - 0.3,
        fontSize: TYPOGRAPHY.pptx.contentSlide.body,
        fontFace: font,
        color: theme.text,
        valign: 'top',
        wrap: true,
        lineSpacing: 20,
    });

    // Right card
    const rightX = ca.x + leftW + gap;
    pptxRenderers.renderCard(s, pres, createCard({
        x: rightX, y: ca.y, w: rightW, h: ca.h,
        fill: theme.surface, elevation: 'subtle', radius: 'small',
        accentEdge: 'top', accentColor: theme.accent,
    }));

    const rightContent = slide.rightContent || slide.right || '';
    s.addText(rightContent, {
        x: rightX + 0.15, y: ca.y + 0.15, w: rightW - 0.3, h: ca.h - 0.3,
        fontSize: TYPOGRAPHY.pptx.contentSlide.body,
        fontFace: font,
        color: theme.text,
        valign: 'top',
        wrap: true,
        lineSpacing: 20,
    });

    return s;
}

function renderTableSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const td = slide.tableData || {};
    const headers = td.headers || [];
    const rows = td.rows || [];
    const ca = SPACING.pptx.contentArea;

    const tableLayout = computeTableLayout({ headers, rows, areaW: ca.w });

    const headerRow = headers.map(h => ({
        text: String(h),
        options: {
            bold: true,
            color: theme.textOnPrimary,
            fill: { color: theme.primary },
            fontSize: tableLayout.fontSize,
            fontFace: font,
            align: 'center',
            valign: 'middle',
        },
    }));

    const dataRows = rows.map((row, ri) => {
        const cells = Array.isArray(row) ? row : Object.values(row);
        return cells.map(cell => {
            const cellText = String(cell ?? '');
            // Status cell detection — apply badge colors
            const statusKey = cellText.toLowerCase().replace(/\s+/g, '');
            const statusBadge = STATUS_BADGES[statusKey];

            return {
                text: cellText,
                options: {
                    fontSize: tableLayout.fontSize - 1,
                    fontFace: font,
                    color: statusBadge ? statusBadge.text : theme.text,
                    fill: { color: statusBadge ? statusBadge.bg : (ri % 2 === 0 ? theme.surface : theme.background) },
                    bold: !!statusBadge,
                    border: [
                        { pt: 0.5, color: theme.borderLight || theme.border },
                        { pt: 0.5, color: theme.borderLight || theme.border },
                        { pt: 0.5, color: theme.borderLight || theme.border },
                        { pt: 0.5, color: theme.borderLight || theme.border },
                    ],
                    valign: 'middle',
                },
            };
        });
    });

    const allRows = headerRow.length ? [headerRow, ...dataRows] : dataRows;
    const colW = tableLayout.colWidths || Array(Math.max(headers.length, 1)).fill(ca.w / Math.max(headers.length, 1));

    if (allRows.length) {
        s.addTable(allRows, {
            x: ca.x, y: ca.y, w: ca.w,
            colW,
            rowH: 0.38,
            autoPage: true,
            autoPageRepeatHeader: true,
        });
    }

    return s;
}

async function renderChartSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const cd = slide.chartData || {};
    const chartType = (cd.type || 'bar').toLowerCase();
    const labels = cd.labels || [];
    const datasets = cd.datasets || cd.data || [];

    // Chart types natively supported by PptxGenJS
    const nativeTypes = { bar: true, column: true, line: true, pie: true, doughnut: true, area: true };

    const ca = SPACING.pptx.contentArea;

    if (nativeTypes[chartType]) {
        // ─── Native PptxGenJS chart ─────────────────────────────────
        const typeMap = {
            bar: pres.ChartType.bar,
            column: pres.ChartType.bar,
            line: pres.ChartType.line,
            pie: pres.ChartType.pie,
            doughnut: pres.ChartType.doughnut,
            area: pres.ChartType.area,
        };

        const pptxType = typeMap[chartType] || pres.ChartType.bar;

        const chartDataArr = datasets.map((ds, i) => ({
            name: ds.name || ds.label || `Series ${i + 1}`,
            labels,
            values: ds.values || ds.data || [],
        }));

        if (chartDataArr.length && labels.length) {
            pptxRenderers.renderCard(s, pres, createCard({
                x: ca.x + 0.2, y: ca.y - 0.05, w: ca.w - 0.4, h: ca.h + 0.1,
                fill: theme.surface, elevation: 'subtle', radius: 'medium',
            }));

            s.addChart(pptxType, chartDataArr, {
                x: ca.x + 0.5, y: ca.y + 0.1, w: ca.w - 1, h: ca.h - 0.4,
                showLegend: datasets.length > 1,
                legendPos: 'b',
                legendFontSize: 9,
                showTitle: false,
                chartColors: theme.chartColors.slice(0, datasets.length),
                valAxisLabelFontSize: 9,
                catAxisLabelFontSize: 9,
                catAxisLineShow: false,
                valAxisLineShow: false,
                catGridLine: { style: 'none' },
                valGridLine: { color: (theme.borderLight || theme.border).replace('#', ''), style: 'dash', size: 0.5 },
            });
        }
    } else {
        // ─── Advanced chart via headless Chart.js → PNG ─────────────
        const embedResult = await renderChartForEmbed({
            type: chartType,
            data: { labels, datasets: datasets.map((ds, i) => ({ label: ds.name || ds.label || `Series ${i + 1}`, data: ds.values || ds.data || [] })) },
            chartTitle: slide.title,
            theme: slide.theme || theme._name || 'modern-blue',
            ticketId: slide.ticketId,
            slideIndex: slide.slideIndex,
            // Pass through gauge/waterfall specific fields
            value: cd.value, max: cd.max, label: cd.label,
            values: cd.values, labels: cd.labels,
        });

        if (embedResult.imagePath && fs.existsSync(embedResult.imagePath)) {
            pptxRenderers.renderCard(s, pres, createCard({
                x: ca.x + 0.3, y: ca.y - 0.05, w: ca.w - 0.6, h: ca.h + 0.1,
                fill: '#FFFFFF', elevation: 'medium', radius: 'small',
            }));
            s.addImage({
                path: embedResult.imagePath,
                x: ca.x + 0.5, y: ca.y + 0.1, w: ca.w - 1, h: ca.h - 0.3,
                sizing: { type: 'contain', w: ca.w - 1, h: ca.h - 0.3 },
            });
        } else {
            pptxRenderers.renderCalloutBox(s, pres, createCalloutBox({
                x: ca.x + 0.5, y: ca.y + 0.5, w: ca.w - 1, h: ca.h - 1,
                type: 'warning', title: 'Chart Render Failed',
                content: embedResult.error || 'Unknown error rendering chart.',
            }), font);
        }
    }

    // Chart description below if provided
    if (slide.description) {
        s.addText(slide.description, {
            x: SPACING.pptx.contentArea.x, y: 6.6, w: SPACING.pptx.contentArea.w, h: 0.4,
            fontSize: TYPOGRAPHY.pptx.contentSlide.caption,
            fontFace: font,
            color: theme.textSecondary,
            align: 'center',
            italic: true,
        });
    }

    return s;
}

function renderImageSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    if (slide.title) addSlideHeader(s, pres, slide.title, theme, font);

    const imgPath = slide.imagePath || slide.image || '';
    const ca = SPACING.pptx.contentArea;

    if (imgPath && fs.existsSync(imgPath)) {
        // Image frame with shadow
        const imgY = slide.title ? ca.y + 0.05 : 0.4;
        const imgH = slide.title ? ca.h - 0.5 : 6.4;

        pptxRenderers.renderCard(s, pres, createCard({
            x: ca.x + 0.4, y: imgY - 0.08, w: ca.w - 0.8, h: imgH + 0.16,
            fill: '#FFFFFF', elevation: 'medium', radius: 'small',
        }));

        s.addImage({
            path: imgPath,
            x: ca.x + 0.5, y: imgY,
            w: ca.w - 1, h: imgH,
            sizing: { type: 'contain', w: ca.w - 1, h: imgH },
            rounding: true,
        });
    }

    if (slide.caption) {
        s.addText(slide.caption, {
            x: SPACING.pptx.margin.x, y: 6.7, w: ca.w, h: 0.4,
            fontSize: TYPOGRAPHY.pptx.contentSlide.caption,
            fontFace: font,
            color: theme.textSecondary,
            align: 'center',
            italic: true,
        });
    }

    return s;
}

function renderQuoteSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    s.background = { fill: theme.surface };

    const sp = SPACING.pptx;

    // Decorative accent bar on left
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'left', x: 0, y: 0,
        length: sp.slideHeight, color: theme.primary, thickness: 0.08,
    }));

    // Large quote mark with accent color
    s.addText('\u201C', {
        x: 0.8, y: 1.0, w: 1.2, h: 1.2,
        fontSize: 96,
        fontFace: TYPOGRAPHY.fontFamily.serif || 'Georgia',
        color: theme.accent,
        bold: true,
    });

    // Quote text in serif font for elegance
    s.addText(slide.quote || slide.content || '', {
        x: 1.5, y: 2.2, w: 8.5, h: 2.8,
        fontSize: 22,
        fontFace: TYPOGRAPHY.fontFamily.serif || 'Georgia',
        color: theme.text,
        italic: true,
        valign: 'middle',
        wrap: true,
        lineSpacing: 32,
    });

    // Thin accent divider before attribution
    if (slide.attribution || slide.author) {
        pptxRenderers.renderAccentBar(s, createAccentBar({
            position: 'horizontal', x: 7.5, y: 5.2,
            length: 2.5, color: theme.accent, thickness: 0.03,
        }));

        s.addText(`\u2014 ${slide.attribution || slide.author}`, {
            x: 1.5, y: 5.35, w: 8.5, h: 0.5,
            fontSize: 14,
            fontFace: font,
            color: theme.textSecondary,
            align: 'right',
        });
    }

    return s;
}

function renderSectionBreakSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    const sp = SPACING.pptx;

    // Dark gradient background
    const grad = theme.gradients || {};
    const darkStart = (grad.dark && grad.dark.start) || theme.primaryDark;
    const darkEnd = (grad.dark && grad.dark.end) || theme.primary;
    s.background = { fill: blendColors(darkStart, darkEnd, 0.5).replace('#', '') };

    // Large decorative number/icon if provided
    if (slide.sectionNumber) {
        s.addText(String(slide.sectionNumber), {
            x: 0.8, y: 0.8, w: 2, h: 2,
            fontSize: 72,
            fontFace: TYPOGRAPHY.fontFamily.display || font,
            color: blendColors(theme.accent, '#FFFFFF', 0.3).replace('#', ''),
            bold: true,
            align: 'left',
        });
    }

    // Accent bar
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'horizontal', x: 1.0, y: 3.3,
        length: 3.0, color: theme.accent, thickness: 0.06,
    }));

    // Section title
    s.addText(slide.title || 'Section', {
        x: 1.0, y: 3.5, w: sp.slideWidth - 2.0, h: 1.2,
        fontSize: TYPOGRAPHY.pptx.sectionBreak.title,
        fontFace: TYPOGRAPHY.fontFamily.display || font,
        color: theme.textOnPrimary,
        bold: true,
        align: 'left',
        valign: 'middle',
    });

    if (slide.subtitle) {
        s.addText(slide.subtitle, {
            x: 1.0, y: 4.7, w: sp.slideWidth - 2.0, h: 0.8,
            fontSize: TYPOGRAPHY.pptx.contentSlide.body,
            fontFace: font,
            color: blendColors(theme.textOnPrimary, '#FFFFFF', 0.3).replace('#', ''),
            align: 'left',
        });
    }

    return s;
}

function renderComparisonSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;
    const halfW = ca.w / 2 - 0.2;

    // Left card with primary accent
    pptxRenderers.renderCard(s, pres, createCard({
        x: ca.x, y: ca.y, w: halfW, h: ca.h,
        fill: theme.surface, elevation: 'subtle', radius: 'medium',
        accentEdge: 'top', accentColor: theme.primary,
    }));

    const leftLabel = slide.leftLabel || slide.optionA || 'Option A';
    // Label badge
    pptxRenderers.renderIconBadge(s, pres, createIconBadge({
        x: ca.x + 0.15, y: ca.y + 0.15, size: 0.35,
        icon: 'A', color: theme.primary, textColor: '#FFFFFF',
    }), font);
    s.addText(leftLabel, {
        x: ca.x + 0.6, y: ca.y + 0.15, w: halfW - 0.8, h: 0.4,
        fontSize: 14, fontFace: font, color: theme.primary, bold: true, valign: 'middle',
    });

    s.addText(slide.leftContent || slide.left || '', {
        x: ca.x + 0.2, y: ca.y + 0.7, w: halfW - 0.4, h: ca.h - 0.9,
        fontSize: 11, fontFace: font, color: theme.text, valign: 'top', wrap: true, lineSpacing: 18,
    });

    // VS divider
    s.addText('VS', {
        x: ca.x + halfW - 0.1, y: ca.y + ca.h / 2 - 0.2, w: 0.6, h: 0.4,
        fontSize: 12, fontFace: font, color: theme.textSecondary,
        bold: true, align: 'center', valign: 'middle',
    });

    // Right card with accent color
    const rightX = ca.x + halfW + 0.4;
    pptxRenderers.renderCard(s, pres, createCard({
        x: rightX, y: ca.y, w: halfW, h: ca.h,
        fill: theme.surface, elevation: 'subtle', radius: 'medium',
        accentEdge: 'top', accentColor: theme.accent,
    }));

    const rightLabel = slide.rightLabel || slide.optionB || 'Option B';
    pptxRenderers.renderIconBadge(s, pres, createIconBadge({
        x: rightX + 0.15, y: ca.y + 0.15, size: 0.35,
        icon: 'B', color: theme.accent, textColor: '#FFFFFF',
    }), font);
    s.addText(rightLabel, {
        x: rightX + 0.6, y: ca.y + 0.15, w: halfW - 0.8, h: 0.4,
        fontSize: 14, fontFace: font, color: theme.accent, bold: true, valign: 'middle',
    });

    s.addText(slide.rightContent || slide.right || '', {
        x: rightX + 0.2, y: ca.y + 0.7, w: halfW - 0.4, h: ca.h - 0.9,
        fontSize: 11, fontFace: font, color: theme.text, valign: 'top', wrap: true, lineSpacing: 18,
    });

    return s;
}

function renderSummarySlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title || 'Summary', theme, font);

    const metrics = Array.isArray(slide.metrics) ? slide.metrics : [];
    const ca = SPACING.pptx.contentArea;

    // Metric cards using layout engine grid
    const grid = calculateGrid({
        count: Math.min(metrics.length, 4),
        areaX: ca.x, areaY: ca.y,
        areaW: ca.w, areaH: 1.8,
        gap: 0.2,
    });

    metrics.slice(0, 4).forEach((metric, i) => {
        const pos = grid.positions[i];
        if (!pos) return;

        pptxRenderers.renderMetricCard(s, pres, createMetricCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            value: String(metric.value ?? ''),
            label: metric.label || '',
            change: metric.change,
            accentColor: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            fill: theme.surface,
        }), font);
    });

    // Key highlights with check-mark bullets in card
    const highlights = slide.highlights || slide.bullets || [];
    if (highlights.length) {
        const highlightY = ca.y + (metrics.length ? 2.2 : 0);
        const highlightH = ca.h - (metrics.length ? 2.2 : 0);

        pptxRenderers.renderCard(s, pres, createCard({
            x: ca.x - 0.05, y: highlightY - 0.05, w: ca.w + 0.1, h: highlightH + 0.1,
            fill: theme.surface, elevation: 'none', radius: 'small',
            accentEdge: 'left', accentColor: theme.accent,
        }));

        const textItems = highlights.map(h => ({
            text: `  ${typeof h === 'string' ? h : h.text || ''}`,
            options: {
                fontSize: 12, fontFace: font, color: theme.text,
                bullet: { code: '2713' },
                paraSpaceAfter: 6,
            },
        }));

        s.addText(textItems, {
            x: ca.x + 0.15, y: highlightY + 0.1, w: ca.w - 0.3, h: highlightH - 0.2,
            valign: 'top',
        });
    }

    return s;
}

// ─── Shared Helpers (v2) ────────────────────────────────────────────────────

function addSlideHeader(slide, pres, title, theme, font) {
    if (!title) return;

    // Gradient-accent top bar
    const sp = SPACING.pptx;
    const barColor = blendColors(theme.primary, theme.accent, 0.3).replace('#', '');
    slide.addShape('rect', {
        x: 0, y: 0, w: sp.slideWidth, h: 0.06,
        fill: { color: barColor },
    });

    // Title text
    slide.addText(title, {
        x: sp.titleArea.x,
        y: sp.titleArea.y,
        w: sp.titleArea.w,
        h: sp.titleArea.h,
        fontSize: TYPOGRAPHY.pptx.contentSlide.heading,
        fontFace: TYPOGRAPHY.fontFamily.display || font,
        color: theme.primary,
        bold: true,
        valign: 'bottom',
    });

    // Accent underline
    slide.addShape('rect', {
        x: sp.titleArea.x,
        y: sp.titleArea.y + sp.titleArea.h + 0.05,
        w: 2.5,
        h: 0.04,
        fill: { color: theme.accent },
    });
}

function addFooter(pres, theme, font, brandKit) {
    const footerText = (brandKit && brandKit.slideDefaults && brandKit.slideDefaults.footerText)
        || 'Powered by Doremon Team';

    pres.defineSlideMaster({
        title: 'DEFAULT',
        background: { fill: theme.background },
        objects: [
            // Bottom accent line
            {
                rect: {
                    x: 0, y: 6.95, w: 13.33, h: 0.02,
                    fill: { color: (theme.borderLight || theme.border).replace('#', '') },
                },
            },
            {
                text: {
                    text: footerText,
                    options: {
                        x: 0.5, y: 7.05, w: 5, h: 0.3,
                        fontSize: 7.5, fontFace: font, color: theme.textSecondary,
                    },
                },
            },
            {
                text: {
                    text: '{{slideNumber}} / {{totalSlides}}',
                    options: {
                        x: 10.5, y: 7.05, w: 2.5, h: 0.3,
                        fontSize: 7.5, fontFace: font, color: theme.textSecondary, align: 'right',
                    },
                },
            },
        ],
    });
}

// ─── NEW SLIDE TYPES (v2 — 16 additional types) ────────────────────────────

function renderTimelineSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const items = Array.isArray(slide.items) ? slide.items : [];
    const ca = SPACING.pptx.contentArea;
    const layout = calculateTimelineLayout({ count: items.length, areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h });

    // Timeline axis line
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'horizontal', x: ca.x, y: layout.lineY,
        length: ca.w, color: theme.border, thickness: 0.03,
    }));

    items.forEach((item, i) => {
        const node = layout.nodes[i];
        if (!node) return;

        // Node dot
        pptxRenderers.renderIconBadge(s, pres, createIconBadge({
            x: node.x, y: node.y, size: 0.3,
            icon: String(i + 1), color: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            textColor: '#FFFFFF',
        }), font);

        // Label card above/below alternating
        const above = i % 2 === 0;
        const cardW = 1.8;
        const cardX = node.centerX - cardW / 2;
        const cardY = above ? layout.lineY - 1.8 : layout.lineY + 0.4;

        pptxRenderers.renderCard(s, pres, createCard({
            x: cardX, y: cardY, w: cardW, h: 1.3,
            fill: theme.surface, elevation: 'subtle', radius: 'small',
            accentEdge: 'top', accentColor: theme.chartColors[i % theme.chartColors.length] || theme.primary,
        }));

        // Date/label
        s.addText(item.date || item.label || `Step ${i + 1}`, {
            x: cardX + 0.1, y: cardY + 0.08, w: cardW - 0.2, h: 0.3,
            fontSize: 9, fontFace: font, color: theme.primary, bold: true,
        });

        // Description
        s.addText(item.description || item.text || '', {
            x: cardX + 0.1, y: cardY + 0.4, w: cardW - 0.2, h: 0.8,
            fontSize: 8.5, fontFace: font, color: theme.text, valign: 'top', wrap: true,
        });
    });

    return s;
}

function renderProcessFlowSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const steps = Array.isArray(slide.steps) ? slide.steps : [];
    const ca = SPACING.pptx.contentArea;
    const layout = calculateProcessFlowLayout({ count: steps.length, areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h });

    steps.forEach((step, i) => {
        const pos = layout.steps[i];
        if (!pos) return;

        // Step card
        pptxRenderers.renderCard(s, pres, createCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            fill: theme.surface, elevation: 'subtle', radius: 'medium',
            accentEdge: 'top', accentColor: theme.chartColors[i % theme.chartColors.length] || theme.primary,
        }));

        // Step number badge
        pptxRenderers.renderIconBadge(s, pres, createIconBadge({
            x: pos.x + pos.w / 2 - 0.2, y: pos.y + 0.1, size: 0.4,
            icon: String(i + 1), color: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            textColor: '#FFFFFF',
        }), font);

        // Step title
        s.addText(step.title || step.name || `Step ${i + 1}`, {
            x: pos.x + 0.1, y: pos.y + 0.6, w: pos.w - 0.2, h: 0.35,
            fontSize: 10, fontFace: font, color: theme.text, bold: true, align: 'center',
        });

        // Step description
        if (step.description) {
            s.addText(step.description, {
                x: pos.x + 0.1, y: pos.y + 0.95, w: pos.w - 0.2, h: pos.h - 1.15,
                fontSize: 8.5, fontFace: font, color: theme.textSecondary, align: 'center', valign: 'top', wrap: true,
            });
        }

        // Arrow to next
        if (i < steps.length - 1) {
            const nextPos = layout.steps[i + 1];
            if (nextPos) {
                pptxRenderers.renderConnectorArrow(s, pres, createConnectorArrow({
                    x1: pos.x + pos.w, y1: pos.y + pos.h / 2,
                    x2: nextPos.x, y2: nextPos.y + nextPos.h / 2,
                    color: theme.accent, thickness: 1.5, arrowHead: true,
                }));
            }
        }
    });

    return s;
}

function renderStatsDashboardSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title || 'Dashboard', theme, font);

    const metrics = Array.isArray(slide.metrics) ? slide.metrics : [];
    const ca = SPACING.pptx.contentArea;

    // Top row: metric cards
    const grid = calculateGrid({
        count: Math.min(metrics.length, 6), areaX: ca.x, areaY: ca.y,
        areaW: ca.w, areaH: 1.6, gap: 0.15,
    });

    metrics.slice(0, 6).forEach((m, i) => {
        const pos = grid.positions[i];
        if (!pos) return;

        pptxRenderers.renderMetricCard(s, pres, createMetricCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            value: String(m.value ?? ''),
            label: m.label || '',
            change: m.change,
            accentColor: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            fill: theme.surface,
        }), font);
    });

    // Bottom section: chart or highlights
    const bottomY = ca.y + 1.9;
    const bottomH = ca.h - 2.0;

    if (slide.chartData) {
        const cd = slide.chartData;
        const typeMap = { bar: pres.ChartType.bar, line: pres.ChartType.line, pie: pres.ChartType.pie, doughnut: pres.ChartType.doughnut, area: pres.ChartType.area };
        const pptxType = typeMap[(cd.type || 'bar').toLowerCase()] || pres.ChartType.bar;
        const datasets = cd.datasets || cd.data || [];
        const chartDataArr = datasets.map((ds, i) => ({
            name: ds.name || ds.label || `Series ${i + 1}`,
            labels: cd.labels || [],
            values: ds.values || ds.data || [],
        }));

        if (chartDataArr.length) {
            pptxRenderers.renderCard(s, pres, createCard({
                x: ca.x, y: bottomY - 0.05, w: ca.w, h: bottomH + 0.1,
                fill: theme.surface, elevation: 'subtle', radius: 'small',
            }));
            s.addChart(pptxType, chartDataArr, {
                x: ca.x + 0.3, y: bottomY + 0.1, w: ca.w - 0.6, h: bottomH - 0.3,
                showLegend: true, legendPos: 'b', legendFontSize: 8,
                chartColors: theme.chartColors,
                valAxisLabelFontSize: 8, catAxisLabelFontSize: 8,
            });
        }
    } else if (slide.highlights) {
        const textItems = slide.highlights.map(h => ({
            text: `  ${typeof h === 'string' ? h : h.text || ''}`,
            options: { fontSize: 11, fontFace: font, color: theme.text, bullet: { code: '25CF' }, paraSpaceAfter: 5 },
        }));
        s.addText(textItems, { x: ca.x + 0.2, y: bottomY, w: ca.w - 0.4, h: bottomH, valign: 'top' });
    }

    return s;
}

function renderIconGridSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const items = Array.isArray(slide.items) ? slide.items : [];
    const ca = SPACING.pptx.contentArea;
    const grid = calculateGrid({ count: items.length, areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h, gap: 0.2, maxCols: 4 });

    items.forEach((item, i) => {
        const pos = grid.positions[i];
        if (!pos) return;

        pptxRenderers.renderCard(s, pres, createCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            fill: theme.surface, elevation: 'subtle', radius: 'medium',
        }));

        // Icon circle
        const iconText = item.icon || item.emoji || String(i + 1);
        pptxRenderers.renderIconBadge(s, pres, createIconBadge({
            x: pos.x + pos.w / 2 - 0.25, y: pos.y + 0.15, size: 0.5,
            icon: iconText, color: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            textColor: '#FFFFFF',
        }), font);

        // Item title
        s.addText(item.title || item.label || '', {
            x: pos.x + 0.1, y: pos.y + 0.75, w: pos.w - 0.2, h: 0.35,
            fontSize: 10, fontFace: font, color: theme.text, bold: true, align: 'center',
        });

        // Item description
        if (item.description) {
            s.addText(item.description, {
                x: pos.x + 0.1, y: pos.y + 1.1, w: pos.w - 0.2, h: pos.h - 1.25,
                fontSize: 8.5, fontFace: font, color: theme.textSecondary, align: 'center', valign: 'top', wrap: true,
            });
        }
    });

    return s;
}

function renderPyramidSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const levels = Array.isArray(slide.levels) ? slide.levels : [];
    const ca = SPACING.pptx.contentArea;
    const count = levels.length;
    if (count === 0) return s;

    const pyramidH = ca.h - 0.2;
    const levelH = pyramidH / count;
    const maxW = ca.w * 0.8;
    const minW = maxW * 0.25;

    levels.forEach((level, i) => {
        const ratio = (i + 1) / count;
        const w = minW + (maxW - minW) * ratio;
        const x = ca.x + (ca.w - w) / 2;
        const y = ca.y + (count - 1 - i) * levelH;

        s.addShape(pres.ShapeType.roundRect, {
            x, y, w, h: levelH - 0.08,
            fill: { color: (theme.chartColors[i % theme.chartColors.length] || theme.primary).replace('#', '') },
            rectRadius: 0.05,
        });

        s.addText(level.label || level.title || `Level ${i + 1}`, {
            x, y, w, h: levelH - 0.08,
            fontSize: 11, fontFace: font, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
        });
    });

    return s;
}

function renderMatrixQuadrantSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const quadrants = slide.quadrants || [];
    const ca = SPACING.pptx.contentArea;
    const layout = calculateQuadrantLayout({ areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h, gap: 0.15 });

    const labels = [
        quadrants[0] || { title: 'Q1', content: '' },
        quadrants[1] || { title: 'Q2', content: '' },
        quadrants[2] || { title: 'Q3', content: '' },
        quadrants[3] || { title: 'Q4', content: '' },
    ];

    const colors = [theme.primary, theme.accent, theme.success || theme.primary, theme.warning || theme.accent];

    layout.quadrants.forEach((pos, i) => {
        pptxRenderers.renderCard(s, pres, createCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            fill: theme.surface, elevation: 'subtle', radius: 'small',
            accentEdge: 'top', accentColor: colors[i],
        }));

        s.addText(labels[i].title || `Q${i + 1}`, {
            x: pos.x + 0.15, y: pos.y + 0.1, w: pos.w - 0.3, h: 0.35,
            fontSize: 12, fontFace: font, color: colors[i].replace('#', ''), bold: true,
        });

        s.addText(labels[i].content || labels[i].description || '', {
            x: pos.x + 0.15, y: pos.y + 0.5, w: pos.w - 0.3, h: pos.h - 0.65,
            fontSize: 9.5, fontFace: font, color: theme.text, valign: 'top', wrap: true,
        });
    });

    // Axis labels
    if (slide.xAxis) {
        s.addText(slide.xAxis, {
            x: ca.x, y: ca.y + ca.h + 0.05, w: ca.w, h: 0.25,
            fontSize: 9, fontFace: font, color: theme.textSecondary, align: 'center',
        });
    }
    if (slide.yAxis) {
        s.addText(slide.yAxis, {
            x: ca.x - 0.6, y: ca.y, w: 0.5, h: ca.h,
            fontSize: 9, fontFace: font, color: theme.textSecondary, align: 'center', valign: 'middle',
            rotate: 270,
        });
    }

    return s;
}

function renderAgendaSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title || 'Agenda', theme, font);

    const items = Array.isArray(slide.items) ? slide.items : [];
    const ca = SPACING.pptx.contentArea;

    items.forEach((item, i) => {
        const y = ca.y + i * (ca.h / Math.max(items.length, 1));
        const h = ca.h / Math.max(items.length, 1) - 0.1;

        // Number badge
        pptxRenderers.renderIconBadge(s, pres, createIconBadge({
            x: ca.x, y: y + 0.05, size: 0.4,
            icon: String(i + 1), color: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            textColor: '#FFFFFF',
        }), font);

        // Item text
        s.addText(typeof item === 'string' ? item : (item.title || item.text || ''), {
            x: ca.x + 0.55, y: y, w: ca.w - 0.6, h: h,
            fontSize: 13, fontFace: font, color: theme.text, valign: 'middle',
        });

        // Divider
        if (i < items.length - 1) {
            pptxRenderers.renderAccentBar(s, createAccentBar({
                position: 'horizontal', x: ca.x + 0.55, y: y + h,
                length: ca.w - 0.6, color: theme.borderLight || theme.border, thickness: 0.015,
            }));
        }
    });

    return s;
}

function renderTeamProfilesSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title || 'Team', theme, font);

    const members = Array.isArray(slide.members) ? slide.members : [];
    const ca = SPACING.pptx.contentArea;
    const grid = calculateGrid({ count: members.length, areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h, gap: 0.2, maxCols: 4 });

    members.forEach((member, i) => {
        const pos = grid.positions[i];
        if (!pos) return;

        pptxRenderers.renderCard(s, pres, createCard({
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            fill: theme.surface, elevation: 'subtle', radius: 'medium',
        }));

        // Avatar circle with initials
        const initials = (member.name || '??').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        pptxRenderers.renderIconBadge(s, pres, createIconBadge({
            x: pos.x + pos.w / 2 - 0.3, y: pos.y + 0.15, size: 0.6,
            icon: initials, color: theme.chartColors[i % theme.chartColors.length] || theme.primary,
            textColor: '#FFFFFF',
        }), font);

        // Name
        s.addText(member.name || '', {
            x: pos.x + 0.1, y: pos.y + 0.85, w: pos.w - 0.2, h: 0.35,
            fontSize: 11, fontFace: font, color: theme.text, bold: true, align: 'center',
        });

        // Role
        if (member.role || member.title) {
            s.addText(member.role || member.title, {
                x: pos.x + 0.1, y: pos.y + 1.15, w: pos.w - 0.2, h: 0.25,
                fontSize: 9, fontFace: font, color: theme.textSecondary, align: 'center',
            });
        }
    });

    return s;
}

function renderBeforeAfterSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;
    const halfW = ca.w / 2 - 0.2;

    // "Before" card
    pptxRenderers.renderCard(s, pres, createCard({
        x: ca.x, y: ca.y, w: halfW, h: ca.h,
        fill: '#FEF2F2', elevation: 'subtle', radius: 'medium',
        accentEdge: 'top', accentColor: '#EF4444',
    }));
    s.addText(slide.beforeLabel || 'Before', {
        x: ca.x + 0.15, y: ca.y + 0.1, w: halfW - 0.3, h: 0.4,
        fontSize: 14, fontFace: font, color: 'EF4444', bold: true,
    });
    s.addText(slide.before || '', {
        x: ca.x + 0.15, y: ca.y + 0.6, w: halfW - 0.3, h: ca.h - 0.8,
        fontSize: 11, fontFace: font, color: theme.text, valign: 'top', wrap: true,
    });

    // Arrow between
    s.addText('\u27A1', {
        x: ca.x + halfW - 0.05, y: ca.y + ca.h / 2 - 0.2, w: 0.5, h: 0.4,
        fontSize: 24, color: theme.accent, align: 'center', valign: 'middle',
    });

    // "After" card
    const rightX = ca.x + halfW + 0.4;
    pptxRenderers.renderCard(s, pres, createCard({
        x: rightX, y: ca.y, w: halfW, h: ca.h,
        fill: '#F0FDF4', elevation: 'subtle', radius: 'medium',
        accentEdge: 'top', accentColor: '#22C55E',
    }));
    s.addText(slide.afterLabel || 'After', {
        x: rightX + 0.15, y: ca.y + 0.1, w: halfW - 0.3, h: 0.4,
        fontSize: 14, fontFace: font, color: '22C55E', bold: true,
    });
    s.addText(slide.after || '', {
        x: rightX + 0.15, y: ca.y + 0.6, w: halfW - 0.3, h: ca.h - 0.8,
        fontSize: 11, fontFace: font, color: theme.text, valign: 'top', wrap: true,
    });

    return s;
}

function renderFunnelSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const stages = Array.isArray(slide.stages) ? slide.stages : [];
    const ca = SPACING.pptx.contentArea;
    const layout = calculateFunnelLayout({ count: stages.length, areaX: ca.x + 1, areaY: ca.y, areaW: ca.w - 2, areaH: ca.h });

    stages.forEach((stage, i) => {
        const pos = layout.layers[i];
        if (!pos) return;

        // Funnel segment
        s.addShape(pres.ShapeType.roundRect, {
            x: pos.x, y: pos.y, w: pos.w, h: pos.h,
            fill: { color: (theme.chartColors[i % theme.chartColors.length] || theme.primary).replace('#', '') },
            rectRadius: 0.05,
        });

        // Label + value
        const text = `${stage.label || stage.name || `Stage ${i + 1}`}${stage.value ? `  —  ${stage.value}` : ''}`;
        s.addText(text, {
            x: pos.x + 0.1, y: pos.y, w: pos.w - 0.2, h: pos.h,
            fontSize: 11, fontFace: font, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
        });
    });

    return s;
}

function renderRoadmapSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title || 'Roadmap', theme, font);

    const phases = Array.isArray(slide.phases) ? slide.phases : [];
    const ca = SPACING.pptx.contentArea;
    const layout = calculateRoadmapLayout({ count: phases.length, areaX: ca.x, areaY: ca.y, areaW: ca.w, areaH: ca.h });

    phases.forEach((phase, i) => {
        const row = layout.rows[i];
        if (!row) return;

        // Lane background
        pptxRenderers.renderCard(s, pres, createCard({
            x: row.labelX, y: row.labelY, w: ca.w, h: row.barH,
            fill: i % 2 === 0 ? theme.surface : theme.background, elevation: 'none', radius: 'none',
        }));

        // Phase label
        s.addText(phase.name || phase.label || `Phase ${i + 1}`, {
            x: row.labelX + 0.1, y: row.labelY + 0.02, w: 1.5, h: row.barH - 0.04,
            fontSize: 9, fontFace: font, color: theme.textSecondary, bold: true, valign: 'middle',
        });

        // Compute bar position from phase start/end percentages
        const pStart = (phase.start || 0) / 100;
        const pEnd = (phase.end || 100) / 100;
        const barX = row.barX + row.barMaxW * pStart;
        const barW = row.barMaxW * (pEnd - pStart);

        // Bar
        s.addShape(pres.ShapeType.roundRect, {
            x: barX, y: row.barY + row.barH * 0.15, w: barW, h: row.barH * 0.7,
            fill: { color: (theme.chartColors[i % theme.chartColors.length] || theme.primary).replace('#', '') },
            rectRadius: 0.05,
        });

        // Bar label
        s.addText(phase.name || `Phase ${i + 1}`, {
            x: barX + 0.05, y: row.barY + row.barH * 0.15, w: barW - 0.1, h: row.barH * 0.7,
            fontSize: 8, fontFace: font, color: 'FFFFFF', valign: 'middle', wrap: true,
        });
    });

    return s;
}

function renderSwotSlide(pres, slide, theme, font) {
    return renderMatrixQuadrantSlide(pres, {
        ...slide,
        title: slide.title || 'SWOT Analysis',
        quadrants: [
            { title: 'Strengths', content: formatListContent(slide.strengths) },
            { title: 'Weaknesses', content: formatListContent(slide.weaknesses) },
            { title: 'Opportunities', content: formatListContent(slide.opportunities) },
            { title: 'Threats', content: formatListContent(slide.threats) },
        ],
    }, theme, font);
}

function renderHeroImageSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    const sp = SPACING.pptx;

    // Full-bleed image
    const imgPath = slide.imagePath || slide.image || '';
    if (imgPath && fs.existsSync(imgPath)) {
        s.addImage({
            path: imgPath, x: 0, y: 0, w: sp.slideWidth, h: sp.slideHeight,
            sizing: { type: 'cover', w: sp.slideWidth, h: sp.slideHeight },
        });
    } else {
        // Fallback gradient background
        const grad = theme.gradients || {};
        s.background = { fill: blendColors(grad.hero?.start || theme.primary, grad.hero?.end || theme.accent, 0.5).replace('#', '') };
    }

    // Dark overlay at bottom for text
    s.addShape(pres.ShapeType.rect, {
        x: 0, y: sp.slideHeight * 0.5, w: sp.slideWidth, h: sp.slideHeight * 0.5,
        fill: { color: '000000', transparency: 50 },
    });

    // Title over image
    s.addText(slide.title || '', {
        x: 0.8, y: sp.slideHeight * 0.52, w: sp.slideWidth - 1.6, h: 1.2,
        fontSize: 32, fontFace: TYPOGRAPHY.fontFamily.display || font,
        color: 'FFFFFF', bold: true, valign: 'bottom',
    });

    if (slide.subtitle) {
        s.addText(slide.subtitle, {
            x: 0.8, y: sp.slideHeight * 0.52 + 1.3, w: sp.slideWidth - 1.6, h: 0.6,
            fontSize: 16, fontFace: font, color: 'EEEEEE', valign: 'top',
        });
    }

    return s;
}

function renderClosingSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    const sp = SPACING.pptx;

    // Dark gradient background
    const grad = theme.gradients || {};
    const darkStart = (grad.dark && grad.dark.start) || theme.primaryDark;
    const darkEnd = (grad.dark && grad.dark.end) || theme.primary;
    s.background = { fill: blendColors(darkStart, darkEnd, 0.5).replace('#', '') };

    // Decorative accent line
    pptxRenderers.renderAccentBar(s, createAccentBar({
        position: 'horizontal', x: sp.slideWidth / 2 - 1.5, y: 2.8,
        length: 3.0, color: theme.accent, thickness: 0.05,
    }));

    // Main message
    s.addText(slide.message || slide.title || 'Thank You', {
        x: 1.0, y: 3.0, w: sp.slideWidth - 2.0, h: 1.5,
        fontSize: 36, fontFace: TYPOGRAPHY.fontFamily.display || font,
        color: theme.textOnPrimary, bold: true,
        align: 'center', valign: 'middle',
    });

    // Contact / subtitle
    if (slide.contact || slide.subtitle) {
        s.addText(slide.contact || slide.subtitle, {
            x: 1.0, y: 4.7, w: sp.slideWidth - 2.0, h: 0.8,
            fontSize: 14, fontFace: font, color: theme.textOnPrimary,
            align: 'center',
        });
    }

    return s;
}

async function renderDiagramSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    if (slide.title) addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;

    // If a pre-rendered diagram image is provided, embed it directly
    let imgPath = slide.diagramImage || slide.imagePath || '';

    // If mermaidCode is provided but no pre-rendered image, render it now
    if (!imgPath && slide.mermaidCode) {
        const embedResult = await renderForEmbed({
            mermaidCode: slide.mermaidCode,
            theme: slide.theme || theme._name || 'modern-blue',
            ticketId: slide.ticketId,
            slideIndex: slide.slideIndex,
        });
        if (embedResult.imagePath) {
            imgPath = embedResult.imagePath;
        } else {
            // Render failed — show error callout
            pptxRenderers.renderCalloutBox(s, pres, createCalloutBox({
                x: ca.x + 0.5, y: ca.y + 0.5, w: ca.w - 1, h: ca.h - 1,
                type: 'warning', title: 'Diagram Render Failed',
                content: embedResult.error || 'Unknown error rendering Mermaid diagram.',
            }), font);
            return s;
        }
    }

    if (imgPath && fs.existsSync(imgPath)) {
        // Card frame around diagram
        pptxRenderers.renderCard(s, pres, createCard({
            x: ca.x + 0.3, y: ca.y - 0.05, w: ca.w - 0.6, h: ca.h + 0.1,
            fill: '#FFFFFF', elevation: 'medium', radius: 'small',
        }));
        s.addImage({
            path: imgPath,
            x: ca.x + 0.5, y: ca.y + 0.1, w: ca.w - 1, h: ca.h - 0.3,
            sizing: { type: 'contain', w: ca.w - 1, h: ca.h - 0.3 },
        });
    } else {
        // No diagram source at all
        pptxRenderers.renderCalloutBox(s, pres, createCalloutBox({
            x: ca.x + 0.5, y: ca.y + 0.5, w: ca.w - 1, h: ca.h - 1,
            type: 'info', title: 'Diagram Placeholder',
            content: 'No diagram image or Mermaid code was provided for this slide.',
        }), font);
    }

    return s;
}

function renderDataStorySlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;
    const split = goldenSplit(ca.w);

    // Left: narrative text
    pptxRenderers.renderCard(s, pres, createCard({
        x: ca.x, y: ca.y, w: split.major, h: ca.h,
        fill: theme.surface, elevation: 'subtle', radius: 'small',
        accentEdge: 'left', accentColor: theme.primary,
    }));

    s.addText(slide.narrative || slide.content || '', {
        x: ca.x + 0.2, y: ca.y + 0.15, w: split.major - 0.4, h: ca.h - 0.3,
        fontSize: 11, fontFace: font, color: theme.text, valign: 'top', wrap: true, lineSpacing: 20,
    });

    // Right: key metric + insight
    const rightX = ca.x + split.major + 0.3;
    const rightW = split.minor;

    if (slide.metric) {
        pptxRenderers.renderMetricCard(s, pres, createMetricCard({
            x: rightX, y: ca.y, w: rightW, h: 1.5,
            value: String(slide.metric.value ?? ''),
            label: slide.metric.label || '',
            change: slide.metric.change,
            accentColor: theme.primary,
            fill: theme.surface,
        }), font);
    }

    if (slide.insight) {
        pptxRenderers.renderCalloutBox(s, pres, createCalloutBox({
            x: rightX, y: ca.y + (slide.metric ? 1.7 : 0), w: rightW, h: ca.h - (slide.metric ? 1.7 : 0),
            type: 'info', title: 'Key Insight',
            content: slide.insight,
        }), font);
    }

    return s;
}

// ─── Utility ────────────────────────────────────────────────────────────────

function formatListContent(items) {
    if (!items) return '';
    if (typeof items === 'string') return items;
    if (Array.isArray(items)) return items.map(i => `\u2022 ${typeof i === 'string' ? i : i.text || ''}`).join('\n');
    return '';
}

// ─── Slide Type Router (v2 — 28 types) ─────────────────────────────────────

async function renderInfographicSlide(pres, slide, theme, font) {
    const s = pres.addSlide();
    if (slide.title) addSlideHeader(s, pres, slide.title, theme, font);

    const ca = SPACING.pptx.contentArea;
    const embedResult = await renderInfographicForEmbed({
        type: slide.infographicType || slide.componentType || 'stat-poster',
        data: slide.data || {},
        theme: slide.theme || theme._name || 'modern-blue',
        ticketId: slide.ticketId,
        slideIndex: slide.slideIndex,
    });

    if (embedResult.imagePath && fs.existsSync(embedResult.imagePath)) {
        pptxRenderers.renderCard(s, pres, createCard({
            x: ca.x + 0.3, y: ca.y - 0.05, w: ca.w - 0.6, h: ca.h + 0.1,
            fill: '#FFFFFF', elevation: 'medium', radius: 'small',
        }));
        s.addImage({
            path: embedResult.imagePath,
            x: ca.x + 0.5, y: ca.y + 0.1, w: ca.w - 1, h: ca.h - 0.3,
            sizing: { type: 'contain', w: ca.w - 1, h: ca.h - 0.3 },
        });
    } else {
        pptxRenderers.renderCalloutBox(s, pres, createCalloutBox({
            x: ca.x + 0.5, y: ca.y + 0.5, w: ca.w - 1, h: ca.h - 1,
            type: 'warning', title: 'Infographic Render Failed',
            content: embedResult.error || 'Unknown error rendering infographic component.',
        }), font);
    }

    return s;
}

const SLIDE_RENDERERS = {
    // Original 11
    title: renderTitleSlide,
    content: renderContentSlide,
    bullets: renderBulletsSlide,
    'two-column': renderTwoColumnSlide,
    table: renderTableSlide,
    chart: renderChartSlide,
    image: renderImageSlide,
    quote: renderQuoteSlide,
    'section-break': renderSectionBreakSlide,
    comparison: renderComparisonSlide,
    summary: renderSummarySlide,
    // New 17
    timeline: renderTimelineSlide,
    'process-flow': renderProcessFlowSlide,
    'stats-dashboard': renderStatsDashboardSlide,
    'icon-grid': renderIconGridSlide,
    pyramid: renderPyramidSlide,
    'matrix-quadrant': renderMatrixQuadrantSlide,
    agenda: renderAgendaSlide,
    'team-profiles': renderTeamProfilesSlide,
    'before-after': renderBeforeAfterSlide,
    funnel: renderFunnelSlide,
    roadmap: renderRoadmapSlide,
    swot: renderSwotSlide,
    'hero-image': renderHeroImageSlide,
    closing: renderClosingSlide,
    diagram: renderDiagramSlide,
    'data-story': renderDataStorySlide,
    infographic: renderInfographicSlide,
};

// ─── Main Generator (v2) ────────────────────────────────────────────────────

/**
 * Generate a PowerPoint presentation from a flexible slides array.
 *
 * @param {Object} options
 * @param {string} options.title - Presentation title
 * @param {string} [options.subtitle] - Subtitle for metadata
 * @param {string} [options.author] - Author for metadata
 * @param {Array} options.slides - Array of slide definitions (27 types supported)
 * @param {string|Object} [options.theme] - Theme name or override object
 * @param {string} [options.font] - Font override
 * @param {string} [options.brandKit] - Brand kit name (loads from config/brand-kits/)
 * @param {string} [options.outputPath] - Custom output path (auto-generated if omitted)
 * @param {string} [options.transition] - Default slide transition (fade|push|wipe|none)
 * @returns {Promise<Object>} { success, filePath, fileName, slideCount, fileSize }
 */
async function generatePptx(options) {
    const { title, subtitle, author, slides = [], theme: themeInput, font: fontInput, brandKit: brandKitName, outputPath, transition } = options;

    if (!slides.length) {
        return { success: false, error: 'No slides provided' };
    }

    const theme = resolveTheme(themeInput, brandKitName);
    const font = resolveFont(fontInput, brandKitName);

    const pres = new PptxGenJS();
    pres.title = title || 'Presentation';
    pres.subject = subtitle || '';
    pres.author = author || 'DocGenie \u2014 Doremon Team';
    pres.company = 'Doremon Team';
    pres.layout = 'LAYOUT_WIDE'; // 13.33" \u00d7 7.5"

    // Resolve default transition
    const defaultTransition = transition || 'fade';
    const transitionMap = ANIMATIONS.slideTransitions || {};
    const transObj = transitionMap[defaultTransition] || null;

    // Add footer master (with brand kit support)
    let brandKit = null;
    if (brandKitName) {
        try {
            const { loadBrandKit } = require('./doc-design-system');
            brandKit = loadBrandKit(brandKitName);
        } catch (_) { /* use defaults */ }
    }
    addFooter(pres, theme, font, brandKit);

    // Render each slide (some renderers like diagram are async)
    for (const slide of slides) {
        const renderer = SLIDE_RENDERERS[slide.type];
        if (renderer) {
            const result = renderer(pres, slide, theme, font);
            if (result && typeof result.then === 'function') await result;
        } else {
            // Fallback: treat unknown types as content slide
            renderContentSlide(pres, { ...slide, content: slide.content || `[Unknown slide type: ${slide.type}]` }, theme, font);
        }
    }

    // Cleanup headless browser pools if used
    const usedDiagrams = slides.some(s => s.type === 'diagram' && s.mermaidCode);
    const usedAdvancedCharts = slides.some(s => s.type === 'chart' && !({ bar: 1, column: 1, line: 1, pie: 1, doughnut: 1, area: 1 })[(s.chartData?.type || 'bar').toLowerCase()]);
    const usedInfographics = slides.some(s => s.type === 'infographic');
    if (usedDiagrams) await cleanupDiagramBrowser();
    if (usedAdvancedCharts) await cleanupChartBrowser();
    if (usedInfographics) await cleanupInfographicBrowser();

    // Write file
    const fileName = generateFileName(title || 'Presentation', '.pptx');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await pres.writeFile({ fileName: filePath });

    const stats = fs.statSync(filePath);

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        slideCount: slides.length,
        slideTypes: [...new Set(slides.map(s => s.type))],
        fileSize: stats.size,
        fileSizeHuman: `${(stats.size / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generatePptx, SLIDE_RENDERERS };
