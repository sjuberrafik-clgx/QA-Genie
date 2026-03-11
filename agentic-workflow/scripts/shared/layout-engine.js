/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAYOUT ENGINE — Smart Content-Aware Layout Calculator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Analyzes content volume and computes optimal layouts: grid positions, font
 * size adjustments, column counts, card sizing. Used by all generators to
 * produce responsive, balanced visual output.
 *
 * @module scripts/shared/layout-engine
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { SPACING, TYPOGRAPHY } = require('../doc-design-system');

// ─── Grid Calculator ────────────────────────────────────────────────────────

/**
 * Calculate grid positions for N items in a given area.
 * Automatically picks rows/cols for best visual balance.
 *
 * @param {Object} opts
 * @param {number} opts.count - Number of items
 * @param {number} opts.areaX - Area left edge
 * @param {number} opts.areaY - Area top edge
 * @param {number} opts.areaW - Area width
 * @param {number} opts.areaH - Area height
 * @param {number} [opts.gap=0.2] - Gap between items (inches for PPTX)
 * @param {number} [opts.maxCols] - Force max columns
 * @returns {{ cols: number, rows: number, itemW: number, itemH: number, positions: Array<{x, y, w, h}> }}
 */
function calculateGrid(opts) {
    const { count, areaX, areaY, areaW, areaH, gap = 0.2, maxCols } = opts;
    if (count === 0) return { cols: 0, rows: 0, itemW: 0, itemH: 0, positions: [] };

    // Compute optimal column count
    let cols;
    if (maxCols) {
        cols = Math.min(count, maxCols);
    } else if (count <= 2) cols = count;
    else if (count <= 4) cols = Math.min(count, 4);
    else if (count <= 6) cols = 3;
    else if (count <= 8) cols = 4;
    else cols = Math.min(Math.ceil(Math.sqrt(count)), 5);

    const rows = Math.ceil(count / cols);
    const itemW = (areaW - (cols - 1) * gap) / cols;
    const itemH = (areaH - (rows - 1) * gap) / rows;

    const positions = [];
    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push({
            x: areaX + col * (itemW + gap),
            y: areaY + row * (itemH + gap),
            w: itemW,
            h: itemH,
        });
    }

    return { cols, rows, itemW, itemH, positions };
}

// ─── Text Density Analyzer ──────────────────────────────────────────────────

/**
 * Analyze text content to determine density and suggest layout mode.
 *
 * @param {string} text
 * @param {Object} [area] - Available area { w, h } in inches
 * @returns {{ wordCount: number, charCount: number, density: 'sparse'|'normal'|'dense'|'overflow', suggestedFontAdjust: number }}
 */
function analyzeTextDensity(text, area) {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const charCount = (text || '').length;

    // For a standard PPTX content area (9" × 5.8"), thresholds:
    let density;
    let suggestedFontAdjust = 0;

    if (wordCount <= 30) {
        density = 'sparse';
        suggestedFontAdjust = 2; // can increase font size
    } else if (wordCount <= 80) {
        density = 'normal';
    } else if (wordCount <= 150) {
        density = 'dense';
        suggestedFontAdjust = -1;
    } else {
        density = 'overflow';
        suggestedFontAdjust = -2;
    }

    return { wordCount, charCount, density, suggestedFontAdjust };
}

// ─── Bullet Auto-Layout ─────────────────────────────────────────────────────

/**
 * Determine if bullet list should be single column or split into two columns.
 * @param {number} bulletCount
 * @param {number} [threshold=6] - Split after this many items
 * @returns {{ columns: 1|2, itemsPerColumn: number }}
 */
function computeBulletLayout(bulletCount, threshold = 6) {
    if (bulletCount <= threshold) {
        return { columns: 1, itemsPerColumn: bulletCount };
    }
    return {
        columns: 2,
        itemsPerColumn: Math.ceil(bulletCount / 2),
    };
}

// ─── Table Auto-Sizing ──────────────────────────────────────────────────────

/**
 * Compute optimal table column widths and font size based on content + available space.
 * @param {Object} opts
 * @param {Array<string>} opts.headers
 * @param {Array<Array>} opts.rows
 * @param {number} opts.areaW - Available width in inches
 * @returns {{ colWidths: number[], fontSize: number, isCompact: boolean }}
 */
function computeTableLayout(opts) {
    const { headers, rows, areaW } = opts;
    const colCount = headers.length || (rows[0] && rows[0].length) || 1;
    const isWide = colCount > 6;
    const isCompact = colCount > 4;

    // Proportional widths based on header text length
    const headerLengths = headers.map(h => String(h).length);
    const totalLen = headerLengths.reduce((a, b) => a + b, 0) || colCount;
    const colWidths = headerLengths.map(l => (l / totalLen) * areaW);

    // Ensure minimum column width
    const minWidth = 0.8;
    const adjustedWidths = colWidths.map(w => Math.max(w, minWidth));
    const totalAdj = adjustedWidths.reduce((a, b) => a + b, 0);
    const scale = areaW / totalAdj;
    const finalWidths = adjustedWidths.map(w => w * scale);

    const fontSize = isWide ? 8 : isCompact ? 9 : 10;

    return { colWidths: finalWidths, fontSize, isCompact };
}

// ─── Timeline Layout ────────────────────────────────────────────────────────

/**
 * Calculate positions for horizontal timeline milestones.
 * @param {Object} opts
 * @param {number} opts.count - Number of milestones
 * @param {number} opts.areaX
 * @param {number} opts.areaY
 * @param {number} opts.areaW
 * @param {number} opts.areaH
 * @param {number} [opts.nodeSize=0.35]
 * @returns {{ lineY: number, nodes: Array<{x, y, labelY}>, lineStart: number, lineEnd: number }}
 */
function calculateTimelineLayout(opts) {
    const { count, areaX, areaY, areaW, areaH, nodeSize = 0.35 } = opts;
    if (count === 0) return { lineY: 0, nodes: [], lineStart: 0, lineEnd: 0 };

    const lineY = areaY + areaH * 0.4;
    const padding = 0.5;
    const usableW = areaW - padding * 2;
    const spacing = count > 1 ? usableW / (count - 1) : 0;

    const nodes = [];
    for (let i = 0; i < count; i++) {
        const cx = areaX + padding + (count > 1 ? i * spacing : usableW / 2);
        const isAbove = i % 2 === 0;
        nodes.push({
            x: cx - nodeSize / 2,
            y: lineY - nodeSize / 2,
            centerX: cx,
            labelY: isAbove ? lineY - nodeSize - 0.6 : lineY + nodeSize + 0.15,
            labelAlign: isAbove ? 'bottom' : 'top',
        });
    }

    return {
        lineY,
        nodes,
        lineStart: areaX + padding,
        lineEnd: areaX + padding + usableW,
    };
}

// ─── Process Flow Layout ────────────────────────────────────────────────────

/**
 * Calculate positions for horizontal process flow steps with arrows.
 * @param {Object} opts
 * @param {number} opts.count - Number of steps (3-6 recommended)
 * @param {number} opts.areaX
 * @param {number} opts.areaY
 * @param {number} opts.areaW
 * @param {number} opts.areaH
 * @param {number} [opts.arrowWidth=0.3]
 * @returns {{ steps: Array<{x, y, w, h}>, arrows: Array<{x1, y1, x2, y2}> }}
 */
function calculateProcessFlowLayout(opts) {
    const { count, areaX, areaY, areaW, areaH, arrowWidth = 0.3 } = opts;
    if (count === 0) return { steps: [], arrows: [] };

    const totalArrowSpace = (count - 1) * arrowWidth;
    const stepW = (areaW - totalArrowSpace) / count;
    const stepH = Math.min(areaH * 0.6, 2.5);
    const stepY = areaY + (areaH - stepH) / 2;

    const steps = [];
    const arrows = [];

    for (let i = 0; i < count; i++) {
        const sx = areaX + i * (stepW + arrowWidth);
        steps.push({ x: sx, y: stepY, w: stepW, h: stepH });

        if (i < count - 1) {
            arrows.push({
                x1: sx + stepW + 0.02,
                y1: stepY + stepH / 2,
                x2: sx + stepW + arrowWidth - 0.02,
                y2: stepY + stepH / 2,
            });
        }
    }

    return { steps, arrows };
}

// ─── Funnel Layout ──────────────────────────────────────────────────────────

/**
 * Calculate trapezoid layers for a funnel diagram.
 * @param {Object} opts
 * @param {number} opts.count - Number of layers (3-6 recommended)
 * @param {number} opts.areaX
 * @param {number} opts.areaY
 * @param {number} opts.areaW
 * @param {number} opts.areaH
 * @param {number} [opts.gap=0.08]
 * @returns {{ layers: Array<{x, y, w, h, topW, bottomW}> }}
 */
function calculateFunnelLayout(opts) {
    const { count, areaX, areaY, areaW, areaH, gap = 0.08 } = opts;
    if (count === 0) return { layers: [] };

    const layerH = (areaH - (count - 1) * gap) / count;
    const centerX = areaX + areaW / 2;
    const minWidth = areaW * 0.3;
    const widthStep = (areaW - minWidth) / Math.max(count - 1, 1);

    const layers = [];
    for (let i = 0; i < count; i++) {
        const topW = areaW - i * widthStep;
        const bottomW = i < count - 1 ? areaW - (i + 1) * widthStep : minWidth;
        layers.push({
            x: centerX - topW / 2,
            y: areaY + i * (layerH + gap),
            w: topW,
            h: layerH,
            topW,
            bottomW,
        });
    }

    return { layers };
}

// ─── Quadrant Matrix Layout ─────────────────────────────────────────────────

/**
 * Calculate 2×2 quadrant positions (for SWOT, BCG matrix, Eisenhower).
 * @param {Object} opts
 * @param {number} opts.areaX
 * @param {number} opts.areaY
 * @param {number} opts.areaW
 * @param {number} opts.areaH
 * @param {number} [opts.gap=0.1]
 * @returns {{ quadrants: Array<{x, y, w, h, position: string}>, centerX: number, centerY: number }}
 */
function calculateQuadrantLayout(opts) {
    const { areaX, areaY, areaW, areaH, gap = 0.1 } = opts;
    const halfW = (areaW - gap) / 2;
    const halfH = (areaH - gap) / 2;

    return {
        quadrants: [
            { x: areaX, y: areaY, w: halfW, h: halfH, position: 'top-left' },
            { x: areaX + halfW + gap, y: areaY, w: halfW, h: halfH, position: 'top-right' },
            { x: areaX, y: areaY + halfH + gap, w: halfW, h: halfH, position: 'bottom-left' },
            { x: areaX + halfW + gap, y: areaY + halfH + gap, w: halfW, h: halfH, position: 'bottom-right' },
        ],
        centerX: areaX + areaW / 2,
        centerY: areaY + areaH / 2,
    };
}

// ─── Roadmap/Gantt Layout ───────────────────────────────────────────────────

/**
 * Calculate horizontal bar positions for a roadmap/gantt chart.
 * @param {Object} opts
 * @param {number} opts.count - Number of items
 * @param {number} opts.areaX
 * @param {number} opts.areaY
 * @param {number} opts.areaW
 * @param {number} opts.areaH
 * @param {number} [opts.labelWidth=2.0] - Width reserved for labels
 * @param {number} [opts.gap=0.1]
 * @returns {{ rows: Array<{labelX, labelY, barX, barY, barMaxW, barH}>, barAreaX: number, barAreaW: number }}
 */
function calculateRoadmapLayout(opts) {
    const { count, areaX, areaY, areaW, areaH, labelWidth = 2.0, gap = 0.1 } = opts;
    if (count === 0) return { rows: [], barAreaX: 0, barAreaW: 0 };

    const barAreaX = areaX + labelWidth + 0.2;
    const barAreaW = areaW - labelWidth - 0.2;
    const rowH = (areaH - (count - 1) * gap) / count;

    const rows = [];
    for (let i = 0; i < count; i++) {
        const ry = areaY + i * (rowH + gap);
        rows.push({
            labelX: areaX,
            labelY: ry,
            barX: barAreaX,
            barY: ry,
            barMaxW: barAreaW,
            barH: rowH,
        });
    }

    return { rows, barAreaX, barAreaW };
}

// ─── Golden Ratio Helper ────────────────────────────────────────────────────

const GOLDEN_RATIO = 1.618;

/**
 * Split an area into two parts using the golden ratio.
 * @param {number} totalWidth
 * @param {'left-major'|'right-major'} [bias='left-major']
 * @returns {{ major: number, minor: number }}
 */
function goldenSplit(totalWidth, bias = 'left-major') {
    const major = totalWidth / GOLDEN_RATIO;
    const minor = totalWidth - major;
    return bias === 'left-major'
        ? { major, minor }
        : { major: minor, minor: major };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    calculateGrid,
    analyzeTextDensity,
    computeBulletLayout,
    computeTableLayout,
    calculateTimelineLayout,
    calculateProcessFlowLayout,
    calculateFunnelLayout,
    calculateQuadrantLayout,
    calculateRoadmapLayout,
    goldenSplit,
    GOLDEN_RATIO,
};
