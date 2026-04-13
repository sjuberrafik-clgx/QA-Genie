/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VISUAL PRIMITIVES — Format-Agnostic Building Blocks for Award-Winning Docs
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All generators (PPTX, DOCX, PDF, HTML) use these primitives to produce
 * consistent visual vocabulary. Each function returns a descriptor object that
 * the format-specific renderer translates.
 *
 * @module scripts/shared/visual-primitives
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { ELEVATION, BORDER_RADIUS, OPACITY, STATUS_BADGES, TYPOGRAPHY, blendColors, hexToRGBA } = require('../doc-design-system');

function clonePptxShadow(shadow) {
    return shadow && typeof shadow === 'object' ? { ...shadow } : shadow;
}

// ─── Card Primitive ─────────────────────────────────────────────────────────

/**
 * Creates a card descriptor — a rounded box with optional shadow and accent.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {string} [opts.fill] - Background hex color
 * @param {'none'|'subtle'|'medium'|'dramatic'} [opts.elevation='subtle']
 * @param {'none'|'small'|'medium'|'large'} [opts.radius='medium']
 * @param {string} [opts.borderColor] - Border hex color (null = no border)
 * @param {'top'|'left'|'bottom'|null} [opts.accentEdge=null] - Colored accent edge
 * @param {string} [opts.accentColor] - Accent edge color
 * @returns {Object} Card descriptor
 */
function createCard(opts) {
    return {
        primitive: 'card',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        fill: opts.fill || '#FFFFFF',
        elevation: opts.elevation || 'subtle',
        radius: opts.radius || 'medium',
        borderColor: opts.borderColor || null,
        accentEdge: opts.accentEdge || null,
        accentColor: opts.accentColor || null,
        shadow: ELEVATION[opts.elevation || 'subtle'],
        radiusValue: BORDER_RADIUS[opts.radius || 'medium'],
    };
}

// ─── Gradient Rectangle ─────────────────────────────────────────────────────

/**
 * Creates a gradient rectangle descriptor.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {string} opts.startColor - Hex
 * @param {string} opts.endColor - Hex
 * @param {number} [opts.angle=135] - Gradient angle in degrees
 * @param {'none'|'small'|'medium'|'large'} [opts.radius='none']
 * @returns {Object}
 */
function createGradientRect(opts) {
    return {
        primitive: 'gradient-rect',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        startColor: opts.startColor,
        endColor: opts.endColor,
        angle: opts.angle || 135,
        radius: opts.radius || 'none',
        radiusValue: BORDER_RADIUS[opts.radius || 'none'],
    };
}

// ─── Accent Bar ─────────────────────────────────────────────────────────────

/**
 * Creates a decorative accent bar (thin colored line used for visual hierarchy).
 * @param {Object} opts
 * @param {'top'|'left'|'bottom'|'right'} opts.position
 * @param {number} opts.x - Reference x
 * @param {number} opts.y - Reference y
 * @param {number} opts.length - Bar length
 * @param {string} opts.color - Hex color
 * @param {number} [opts.thickness=0.04] - In inches for PPTX
 * @returns {Object}
 */
function createAccentBar(opts) {
    const thickness = opts.thickness || 0.04;
    const isVertical = opts.position === 'left' || opts.position === 'right';
    return {
        primitive: 'accent-bar',
        x: opts.x,
        y: opts.y,
        w: isVertical ? thickness : opts.length,
        h: isVertical ? opts.length : thickness,
        color: opts.color,
        position: opts.position,
    };
}

// ─── Icon Badge (Numbered Circle) ───────────────────────────────────────────

/**
 * Creates a numbered/icon circle badge for process steps.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number|string} opts.label - Number or icon text (e.g., '1', '✓', 'A')
 * @param {string} opts.color - Background hex color
 * @param {string} [opts.textColor='#FFFFFF']
 * @param {number} [opts.size=0.4] - Diameter in inches
 * @returns {Object}
 */
function createIconBadge(opts) {
    const label = opts.label ?? opts.icon ?? opts.text ?? '';

    return {
        primitive: 'icon-badge',
        x: opts.x,
        y: opts.y,
        label: String(label),
        color: opts.color,
        textColor: opts.textColor || '#FFFFFF',
        size: opts.size || 0.4,
    };
}

// ─── Divider ────────────────────────────────────────────────────────────────

/**
 * Creates a decorative horizontal divider.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.width
 * @param {'solid'|'dashed'|'dotted'|'gradient-fade'} [opts.style='solid']
 * @param {string} opts.color - Hex color
 * @param {number} [opts.thickness=1] - In points
 * @returns {Object}
 */
function createDivider(opts) {
    return {
        primitive: 'divider',
        x: opts.x,
        y: opts.y,
        width: opts.width,
        style: opts.style || 'solid',
        color: opts.color,
        thickness: opts.thickness || 1,
    };
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

/**
 * Creates a horizontal progress bar.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.w - Total bar width
 * @param {number} opts.value - Current value
 * @param {number} opts.max - Maximum value
 * @param {string} opts.fillColor - Fill hex
 * @param {string} [opts.trackColor='#E9ECEF'] - Track background hex
 * @param {number} [opts.height=0.15] - Bar height in inches
 * @param {'none'|'small'|'pill'} [opts.radius='pill']
 * @returns {Object}
 */
function createProgressBar(opts) {
    const ratio = Math.min(Math.max(opts.value / (opts.max || 1), 0), 1);
    return {
        primitive: 'progress-bar',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        fillWidth: opts.w * ratio,
        value: opts.value,
        max: opts.max,
        ratio,
        fillColor: opts.fillColor,
        trackColor: opts.trackColor || '#E9ECEF',
        height: opts.height || 0.15,
        radius: opts.radius || 'pill',
        radiusValue: BORDER_RADIUS[opts.radius || 'pill'],
    };
}

// ─── Status Badge ───────────────────────────────────────────────────────────

/**
 * Creates a colored pill badge for status display.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {'pass'|'fail'|'pending'|'inProgress'|'blocked'|'skipped'} opts.variant
 * @param {string} [opts.label] - Override default label text
 * @returns {Object}
 */
function createStatusBadge(opts) {
    const variant = STATUS_BADGES[opts.variant] || STATUS_BADGES.pending;
    return {
        primitive: 'status-badge',
        x: opts.x,
        y: opts.y,
        label: opts.label || variant.label,
        bg: variant.bg,
        textColor: variant.text,
        borderColor: variant.border,
        radius: 'pill',
        radiusValue: BORDER_RADIUS.pill,
    };
}

// ─── Metric Card ────────────────────────────────────────────────────────────

/**
 * Creates a KPI metric card with value, label, optional change indicator.
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {string|number} opts.value - Main metric value
 * @param {string} opts.label - Metric label
 * @param {number} [opts.change] - Percentage change (positive=up, negative=down)
 * @param {string} opts.accentColor - Main color for value text
 * @param {string} [opts.fill] - Card background
 * @param {'none'|'subtle'|'medium'} [opts.elevation='subtle']
 * @returns {Object}
 */
function createMetricCard(opts) {
    const changeDir = opts.change > 0 ? 'up' : opts.change < 0 ? 'down' : 'flat';
    const changeColor = changeDir === 'up' ? '#28A745' : changeDir === 'down' ? '#DC3545' : '#6C757D';
    const changeIcon = changeDir === 'up' ? '▲' : changeDir === 'down' ? '▼' : '●';

    return {
        primitive: 'metric-card',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        value: String(opts.value),
        label: opts.label,
        change: opts.change,
        changeDir,
        changeColor,
        changeIcon,
        changeText: opts.change != null ? `${changeIcon} ${Math.abs(opts.change)}%` : null,
        accentColor: opts.accentColor,
        fill: opts.fill || '#FFFFFF',
        elevation: opts.elevation || 'subtle',
        shadow: ELEVATION[opts.elevation || 'subtle'],
        radius: BORDER_RADIUS.medium,
    };
}

// ─── Callout Box ────────────────────────────────────────────────────────────

/**
 * Creates a styled callout box (info, warning, success, danger).
 * @param {Object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {'info'|'success'|'warning'|'danger'} opts.type
 * @param {string} opts.content - Text content
 * @param {string} [opts.title] - Optional title
 * @returns {Object}
 */
function createCalloutBox(opts) {
    const calloutStyles = {
        info: { icon: 'ℹ', bg: '#E3F0FF', border: '#0066CC', text: '#004C99' },
        success: { icon: '✓', bg: '#D4EDDA', border: '#28A745', text: '#155724' },
        warning: { icon: '⚠', bg: '#FFF3CD', border: '#FFC107', text: '#856404' },
        danger: { icon: '✕', bg: '#F8D7DA', border: '#DC3545', text: '#721C24' },
    };
    const style = calloutStyles[opts.type] || calloutStyles.info;

    return {
        primitive: 'callout-box',
        x: opts.x,
        y: opts.y,
        w: opts.w,
        h: opts.h,
        type: opts.type,
        content: opts.content,
        title: opts.title || null,
        icon: style.icon,
        bgColor: style.bg,
        borderColor: style.border,
        textColor: style.text,
        radius: BORDER_RADIUS.medium,
    };
}

// ─── Connector Arrow ────────────────────────────────────────────────────────

/**
 * Creates a connector arrow between two points (for process flows, timelines).
 * @param {Object} opts
 * @param {number} opts.x1 - Start x
 * @param {number} opts.y1 - Start y
 * @param {number} opts.x2 - End x
 * @param {number} opts.y2 - End y
 * @param {string} opts.color - Hex color
 * @param {number} [opts.thickness=1.5]
 * @param {boolean} [opts.arrowHead=true]
 * @returns {Object}
 */
function createConnectorArrow(opts) {
    return {
        primitive: 'connector-arrow',
        x1: opts.x1,
        y1: opts.y1,
        x2: opts.x2,
        y2: opts.y2,
        color: opts.color,
        thickness: opts.thickness || 1.5,
        arrowHead: opts.arrowHead !== false,
    };
}

// ─── Background Pattern ─────────────────────────────────────────────────────

/**
 * Creates a background pattern overlay descriptor.
 * For PPTX: rendered as semi-transparent shapes
 * For HTML: rendered as CSS repeating patterns
 * @param {Object} opts
 * @param {'dot-grid'|'diagonal-lines'|'topographic'|'subtle-grid'|'none'} opts.type
 * @param {string} opts.color - Pattern color (used with opacity)
 * @param {number} [opts.opacity=0.05] - How visible the pattern is
 * @returns {Object}
 */
function createBackgroundPattern(opts) {
    return {
        primitive: 'background-pattern',
        type: opts.type || 'none',
        color: opts.color,
        opacity: opts.opacity || 0.05,
    };
}

// ─── PPTX Renderers (translate primitives to PptxGenJS calls) ───────────────

const pptxRenderers = {

    /**
     * Render a card primitive onto a PptxGenJS slide.
     * @param {Object} slide - PptxGenJS slide
     * @param {Object} pres - PptxGenJS presentation (for ShapeType)
     * @param {Object} card - Card descriptor from createCard()
     */
    renderCard(slide, pres, card) {
        const shapeOpts = {
            x: card.x,
            y: card.y,
            w: card.w,
            h: card.h,
            fill: { color: card.fill.replace('#', '') },
            rectRadius: card.radiusValue,
        };

        // Border
        if (card.borderColor) {
            shapeOpts.line = { color: card.borderColor.replace('#', ''), width: 0.75 };
        }

        // Shadow
        if (card.elevation !== 'none') {
            const shadow = clonePptxShadow(ELEVATION.pptx[card.elevation] || {});
            if (shadow && Object.keys(shadow).length > 0) {
                shapeOpts.shadow = shadow;
            }
        }

        slide.addShape(pres.ShapeType.roundRect, shapeOpts);

        // Accent edge
        if (card.accentEdge && card.accentColor) {
            const bar = createAccentBar({
                position: card.accentEdge,
                x: card.accentEdge === 'left' ? card.x : card.x,
                y: card.accentEdge === 'top' ? card.y : card.y,
                length: (card.accentEdge === 'left' || card.accentEdge === 'right') ? card.h : card.w,
                color: card.accentColor,
                thickness: 0.05,
            });
            slide.addShape('rect', {
                x: bar.x, y: bar.y, w: bar.w, h: bar.h,
                fill: { color: bar.color.replace('#', '') },
            });
        }
    },

    /**
     * Render a gradient rectangle. PptxGenJS doesn't support gradients natively
     * on arbitrary shapes, so we simulate with a solid fill using the blended
     * midpoint color, plus a semi-transparent overlay.
     */
    renderGradientRect(slide, pres, rect) {
        const midColor = blendColors(rect.startColor, rect.endColor, 0.5);
        slide.addShape(pres.ShapeType.roundRect, {
            x: rect.x, y: rect.y, w: rect.w, h: rect.h,
            fill: { color: midColor.replace('#', '') },
            rectRadius: rect.radiusValue,
        });
    },

    /**
     * Render an accent bar on a slide.
     */
    renderAccentBar(slide, bar) {
        slide.addShape('rect', {
            x: bar.x, y: bar.y, w: bar.w, h: bar.h,
            fill: { color: bar.color.replace('#', '') },
        });
    },

    /**
     * Render an icon badge (numbered circle).
     */
    renderIconBadge(slide, pres, badge, font) {
        slide.addShape(pres.ShapeType.ellipse, {
            x: badge.x, y: badge.y, w: badge.size, h: badge.size,
            fill: { color: badge.color.replace('#', '') },
        });
        slide.addText(badge.label, {
            x: badge.x, y: badge.y, w: badge.size, h: badge.size,
            fontSize: badge.size * 28,
            fontFace: font || TYPOGRAPHY.fontFamily.primary,
            color: badge.textColor.replace('#', ''),
            bold: true,
            align: 'center',
            valign: 'middle',
        });
    },

    /**
     * Render a progress bar.
     */
    renderProgressBar(slide, pres, bar) {
        // Track
        slide.addShape(pres.ShapeType.roundRect, {
            x: bar.x, y: bar.y, w: bar.w, h: bar.height,
            fill: { color: bar.trackColor.replace('#', '') },
            rectRadius: bar.radiusValue,
        });
        // Fill
        if (bar.fillWidth > 0) {
            slide.addShape(pres.ShapeType.roundRect, {
                x: bar.x, y: bar.y, w: bar.fillWidth, h: bar.height,
                fill: { color: bar.fillColor.replace('#', '') },
                rectRadius: bar.radiusValue,
            });
        }
    },

    /**
     * Render a status badge pill.
     */
    renderStatusBadge(slide, pres, badge, font) {
        const w = Math.max(badge.label.length * 0.12 + 0.3, 1.0);
        const h = 0.3;
        slide.addShape(pres.ShapeType.roundRect, {
            x: badge.x, y: badge.y, w, h,
            fill: { color: badge.bg.replace('#', '') },
            line: { color: badge.borderColor.replace('#', ''), width: 0.5 },
            rectRadius: BORDER_RADIUS.pill,
        });
        slide.addText(badge.label, {
            x: badge.x, y: badge.y, w, h,
            fontSize: 9, fontFace: font || TYPOGRAPHY.fontFamily.primary,
            color: badge.textColor.replace('#', ''),
            bold: true, align: 'center', valign: 'middle',
        });
    },

    /**
     * Render a metric card on a slide.
     */
    renderMetricCard(slide, pres, mc, font) {
        // Card background
        this.renderCard(slide, pres, createCard({
            x: mc.x, y: mc.y, w: mc.w, h: mc.h,
            fill: mc.fill, elevation: mc.elevation,
            accentEdge: 'top', accentColor: mc.accentColor,
        }));

        // Value
        slide.addText(mc.value, {
            x: mc.x + 0.1, y: mc.y + 0.15, w: mc.w - 0.2, h: mc.h * 0.45,
            fontSize: TYPOGRAPHY.pptx.metric.value,
            fontFace: font || TYPOGRAPHY.fontFamily.primary,
            color: mc.accentColor.replace('#', ''),
            bold: true, align: 'center', valign: 'bottom',
        });

        // Label
        slide.addText(mc.label, {
            x: mc.x + 0.1, y: mc.y + mc.h * 0.55, w: mc.w - 0.2, h: mc.h * 0.2,
            fontSize: TYPOGRAPHY.pptx.metric.label,
            fontFace: font || TYPOGRAPHY.fontFamily.primary,
            color: '6C757D', align: 'center', valign: 'top',
        });

        // Change indicator
        if (mc.changeText) {
            slide.addText(mc.changeText, {
                x: mc.x + 0.1, y: mc.y + mc.h * 0.75, w: mc.w - 0.2, h: mc.h * 0.2,
                fontSize: TYPOGRAPHY.pptx.metric.change,
                fontFace: font || TYPOGRAPHY.fontFamily.primary,
                color: mc.changeColor.replace('#', ''),
                bold: true, align: 'center', valign: 'top',
            });
        }
    },

    /**
     * Render a callout box.
     */
    renderCalloutBox(slide, pres, cb, font) {
        // Background
        slide.addShape(pres.ShapeType.roundRect, {
            x: cb.x, y: cb.y, w: cb.w, h: cb.h,
            fill: { color: cb.bgColor.replace('#', '') },
            rectRadius: cb.radius,
        });
        // Left accent border
        slide.addShape('rect', {
            x: cb.x, y: cb.y, w: 0.05, h: cb.h,
            fill: { color: cb.borderColor.replace('#', '') },
        });
        // Icon
        slide.addText(cb.icon, {
            x: cb.x + 0.15, y: cb.y + 0.05, w: 0.3, h: 0.3,
            fontSize: 16, color: cb.borderColor.replace('#', ''),
            align: 'center', valign: 'middle',
        });
        // Title
        const textY = cb.y + 0.05;
        if (cb.title) {
            slide.addText(cb.title, {
                x: cb.x + 0.5, y: textY, w: cb.w - 0.7, h: 0.3,
                fontSize: 12, fontFace: font || TYPOGRAPHY.fontFamily.primary,
                color: cb.textColor.replace('#', ''), bold: true,
            });
        }
        // Content
        slide.addText(cb.content, {
            x: cb.x + 0.5, y: cb.title ? textY + 0.3 : textY, w: cb.w - 0.7, h: cb.h - (cb.title ? 0.45 : 0.15),
            fontSize: 11, fontFace: font || TYPOGRAPHY.fontFamily.primary,
            color: cb.textColor.replace('#', ''), valign: 'top', wrap: true,
        });
    },

    /**
     * Render a connector arrow between two points.
     */
    renderConnectorArrow(slide, pres, arrow) {
        const dx = arrow.x2 - arrow.x1;
        const dy = arrow.y2 - arrow.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        const lineOpts = {
            x: arrow.x1, y: arrow.y1,
            w: Math.abs(dx) || 0.01,
            h: Math.abs(dy) || 0.01,
            line: { color: arrow.color.replace('#', ''), width: arrow.thickness },
        };

        if (arrow.arrowHead) {
            lineOpts.line.endArrowType = 'triangle';
        }

        slide.addShape(pres.ShapeType.line, lineOpts);
    },
};

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    // Primitive creators
    createCard,
    createGradientRect,
    createAccentBar,
    createIconBadge,
    createDivider,
    createProgressBar,
    createStatusBadge,
    createMetricCard,
    createCalloutBox,
    createConnectorArrow,
    createBackgroundPattern,
    // PPTX renderers
    pptxRenderers,
};
