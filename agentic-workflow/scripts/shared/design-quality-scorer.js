/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESIGN QUALITY SCORER — Post-Generation Quality Analysis
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Scores generated documents 0-100 based on objective design quality metrics:
 * - Color contrast (WCAG AA compliance)
 * - Text density per section/slide
 * - Visual variety (content type distribution)
 * - Typography hierarchy (heading levels)
 * - Brand compliance (theme color usage)
 * - Layout balance (content distribution)
 * - Section count adequacy
 *
 * Integrated with SDK as `get_design_score` tool.
 *
 * @module scripts/shared/design-quality-scorer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { THEMES, hexToRGB } = require('../doc-design-system');

// ─── WCAG Contrast Helpers ───────────────────────────────────────────────────

/**
 * Calculate relative luminance per WCAG 2.1.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {number} Relative luminance (0-1)
 */
function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors (WCAG 2.1).
 * @param {string} hex1 - Hex color #RRGGBB
 * @param {string} hex2 - Hex color #RRGGBB
 * @returns {number} Contrast ratio (1-21)
 */
function contrastRatio(hex1, hex2) {
    const rgb1 = hexToRGB(hex1);
    const rgb2 = hexToRGB(hex2);
    const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

// ─── Scoring Functions ───────────────────────────────────────────────────────

/**
 * Score color contrast compliance (WCAG AA: 4.5:1 for normal text).
 * Tests primary theme colors against white and dark backgrounds.
 * Weight: 20
 */
function scoreColorContrast(theme) {
    const themeColors = THEMES[theme] || THEMES['modern-blue'];
    const textOnWhite = contrastRatio(themeColors.textDark || '#1A1A2E', '#FFFFFF');
    const primaryOnWhite = contrastRatio(themeColors.primary, '#FFFFFF');
    const textOnDark = contrastRatio(themeColors.textLight || '#E8E8E8', themeColors.primaryDark || '#004C99');

    let score = 0;
    // Text on white should be >= 4.5:1 (WCAG AA)
    if (textOnWhite >= 4.5) score += 40;
    else if (textOnWhite >= 3.0) score += 20;

    // Primary color on white — at least 3:1 for large text
    if (primaryOnWhite >= 3.0) score += 30;
    else if (primaryOnWhite >= 2.0) score += 15;

    // Text on dark background
    if (textOnDark >= 4.5) score += 30;
    else if (textOnDark >= 3.0) score += 15;

    const details = {
        textOnWhiteRatio: Math.round(textOnWhite * 10) / 10,
        primaryOnWhiteRatio: Math.round(primaryOnWhite * 10) / 10,
        textOnDarkRatio: Math.round(textOnDark * 10) / 10,
        wcagAA: textOnWhite >= 4.5,
    };

    return { score, details };
}

/**
 * Score text density — warn if sections are text-heavy.
 * Ideal: 20-150 words per section/slide. Penalize > 200.
 * Weight: 15
 */
function scoreTextDensity(sections) {
    if (!sections.length) return { score: 0, details: { reason: 'no sections' } };

    const wordCounts = sections.map(s => {
        const text = [s.content, s.text, ...(s.items || []), ...(s.bullets || [])].filter(Boolean).join(' ');
        return text.split(/\s+/).filter(w => w.length > 0).length;
    });

    const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    const overloaded = wordCounts.filter(w => w > 200).length;

    let score = 100;
    if (avgWords > 200) score -= 40;
    else if (avgWords > 150) score -= 20;
    if (overloaded > 0) score -= overloaded * 10;
    if (avgWords < 5 && sections.length > 3) score -= 20; // too sparse

    return {
        score: Math.max(0, score),
        details: {
            avgWordsPerSection: Math.round(avgWords),
            overloadedSections: overloaded,
            totalSections: sections.length,
        },
    };
}

/**
 * Score visual variety — penalize monotonous content (e.g., all bullets).
 * Reward diverse section types.
 * Weight: 20
 */
function scoreVisualVariety(sections) {
    if (!sections.length) return { score: 0, details: { reason: 'no sections' } };

    const types = sections.map(s => s.type);
    const uniqueTypes = new Set(types);
    const totalTypes = uniqueTypes.size;

    // Check for consecutive same-type runs
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < types.length; i++) {
        if (types[i] === types[i - 1]) { currentRun++; maxRun = Math.max(maxRun, currentRun); }
        else currentRun = 1;
    }

    // Visual types that break text monotony
    const visualTypes = ['chart', 'diagram', 'infographic', 'image', 'table', 'cover', 'metric-strip', 'info-card-grid', 'pull-quote', 'sidebar'];
    const visualCount = types.filter(t => visualTypes.includes(t)).length;
    const visualRatio = visualCount / types.length;

    let score = 0;
    // Reward type diversity
    if (totalTypes >= 6) score += 40;
    else if (totalTypes >= 4) score += 30;
    else if (totalTypes >= 2) score += 20;
    else score += 5;

    // Penalize long same-type runs (3+ consecutive bullets is boring)
    if (maxRun <= 2) score += 30;
    else if (maxRun <= 3) score += 15;

    // Reward visual content mix
    if (visualRatio >= 0.3) score += 30;
    else if (visualRatio >= 0.15) score += 20;
    else if (visualRatio > 0) score += 10;

    return {
        score: Math.min(100, score),
        details: {
            uniqueTypes: totalTypes,
            maxConsecutiveRun: maxRun,
            visualContentRatio: Math.round(visualRatio * 100) + '%',
            typeBreakdown: Object.fromEntries([...uniqueTypes].map(t => [t, types.filter(x => x === t).length])),
        },
    };
}

/**
 * Score typography hierarchy — verify heading levels aren't skipped.
 * Weight: 15
 */
function scoreTypographyHierarchy(sections) {
    const headings = sections.filter(s => s.type === 'heading');
    if (!headings.length) {
        return { score: sections.length <= 3 ? 80 : 40, details: { reason: 'no headings found', penalty: sections.length > 3 ? 'long doc without headings' : 'short doc, acceptable' } };
    }

    const levels = headings.map(h => h.level || 1);
    let score = 100;
    const issues = [];

    // Check for skipped levels (e.g., h1 → h3 without h2)
    for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
            issues.push(`Skipped from h${levels[i - 1]} to h${levels[i]}`);
            score -= 15;
        }
    }

    // Check document starts with h1
    if (levels[0] !== 1) {
        issues.push('Document does not start with h1');
        score -= 10;
    }

    // Check reasonable heading density
    const headingRatio = headings.length / sections.length;
    if (headingRatio > 0.5) { issues.push('Too many headings vs content'); score -= 10; }
    if (headingRatio < 0.05 && sections.length > 10) { issues.push('Very few headings for document length'); score -= 10; }

    return { score: Math.max(0, score), details: { headingLevels: levels, issues, headingRatio: Math.round(headingRatio * 100) + '%' } };
}

/**
 * Score brand compliance — check if theme colors are known/valid.
 * Weight: 10
 */
function scoreBrandCompliance(theme, options = {}) {
    const knownThemes = Object.keys(THEMES);
    const isKnown = knownThemes.includes(theme);

    let score = isKnown ? 60 : 20;

    // Check for title (brand presence)
    if (options.title) score += 20;
    // Check for author (attribution)
    if (options.author) score += 20;

    return {
        score: Math.min(100, score),
        details: {
            themeValid: isKnown,
            themeName: theme || 'not specified',
            hasTitle: !!options.title,
            hasAuthor: !!options.author,
        },
    };
}

/**
 * Score layout balance — content distribution across sections.
 * Weight: 10
 */
function scoreLayoutBalance(sections) {
    if (sections.length < 2) return { score: 70, details: { reason: 'too few sections to evaluate' } };

    // Calculate content weight per section
    const weights = sections.map(s => {
        const textLen = [s.content, s.text, ...(s.items || []), ...(s.bullets || [])].filter(Boolean).join(' ').length;
        const hasVisual = ['chart', 'diagram', 'infographic', 'image', 'table', 'cover'].includes(s.type);
        return textLen + (hasVisual ? 200 : 0);
    });

    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    const variance = weights.reduce((sum, w) => sum + Math.pow(w - avgWeight, 2), 0) / weights.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgWeight > 0 ? stdDev / avgWeight : 0; // coefficient of variation

    let score = 100;
    // High CV means unbalanced — some sections are much heavier than others
    if (cv > 2.0) score -= 40;
    else if (cv > 1.5) score -= 25;
    else if (cv > 1.0) score -= 10;

    return {
        score: Math.max(0, score),
        details: {
            avgContentWeight: Math.round(avgWeight),
            coefficientOfVariation: Math.round(cv * 100) / 100,
            heaviestSection: Math.max(...weights),
            lightestSection: Math.min(...weights),
        },
    };
}

/**
 * Score section count adequacy based on document type.
 * Weight: 10
 */
function scoreSectionCount(sections, format) {
    const count = sections.length;
    let score = 100;
    const issues = [];

    if (format === 'pptx') {
        if (count < 3) { score -= 30; issues.push('Very few slides — presentation may lack depth'); }
        if (count > 40) { score -= 20; issues.push('Many slides — consider consolidating'); }
    } else {
        if (count < 2) { score -= 30; issues.push('Very few sections'); }
        if (count > 50) { score -= 15; issues.push('Many sections — consider summarizing'); }
    }

    // Cover/intro check
    const hasCover = sections.some(s => s.type === 'cover' || (s.type === 'title' && sections.indexOf(s) === 0));
    if (!hasCover && count > 5) { score -= 10; issues.push('No cover/title section for a substantial document'); }

    return { score: Math.max(0, score), details: { sectionCount: count, hasCover, issues } };
}

// ─── Main Scorer ─────────────────────────────────────────────────────────────

const WEIGHTS = {
    colorContrast: 20,
    textDensity: 15,
    visualVariety: 20,
    typographyHierarchy: 15,
    brandCompliance: 10,
    layoutBalance: 10,
    sectionCount: 10,
};

/**
 * Score a document's design quality.
 *
 * @param {Object} options
 * @param {Array} options.sections - Array of section/slide objects
 * @param {string} [options.theme] - Theme name
 * @param {string} [options.format] - Output format (pptx, docx, pdf, html, markdown)
 * @param {string} [options.title] - Document title
 * @param {string} [options.author] - Author
 * @returns {Object} { score, grade, breakdown, recommendations }
 */
function scoreDesignQuality(options) {
    const { sections = [], theme = 'modern-blue', format = 'docx', title, author } = options;

    const results = {
        colorContrast: scoreColorContrast(theme),
        textDensity: scoreTextDensity(sections),
        visualVariety: scoreVisualVariety(sections),
        typographyHierarchy: scoreTypographyHierarchy(sections),
        brandCompliance: scoreBrandCompliance(theme, { title, author }),
        layoutBalance: scoreLayoutBalance(sections),
        sectionCount: scoreSectionCount(sections, format),
    };

    // Weighted total
    let totalScore = 0;
    const breakdown = {};
    for (const [key, weight] of Object.entries(WEIGHTS)) {
        const catScore = results[key].score;
        const weighted = (catScore / 100) * weight;
        totalScore += weighted;
        breakdown[key] = {
            score: catScore,
            weight,
            weighted: Math.round(weighted * 10) / 10,
            details: results[key].details,
        };
    }

    totalScore = Math.round(totalScore);

    // Grade
    let grade;
    if (totalScore >= 90) grade = 'A+';
    else if (totalScore >= 80) grade = 'A';
    else if (totalScore >= 70) grade = 'B';
    else if (totalScore >= 60) grade = 'C';
    else if (totalScore >= 50) grade = 'D';
    else grade = 'F';

    // Recommendations
    const recommendations = [];
    if (results.colorContrast.score < 70) recommendations.push('Improve color contrast — some text may not meet WCAG AA (4.5:1 ratio).');
    if (results.textDensity.score < 70) recommendations.push('Reduce text density — some sections have over 200 words. Break into smaller sections or use visuals.');
    if (results.visualVariety.score < 60) recommendations.push('Add visual variety — include charts, diagrams, images, or infographics to break text monotony.');
    if (results.typographyHierarchy.score < 70) recommendations.push('Fix heading hierarchy — avoid skipping heading levels (h1 → h3 without h2).');
    if (results.brandCompliance.score < 60) recommendations.push('Ensure brand compliance — use a known theme and include title/author metadata.');
    if (results.layoutBalance.score < 60) recommendations.push('Balance content — some sections are much heavier than others. Redistribute content more evenly.');
    if (results.sectionCount.score < 70) recommendations.push('Adjust section count — the document may have too few or too many sections for its type.');

    if (recommendations.length === 0) recommendations.push('Excellent design quality! No major issues detected.');

    return {
        score: totalScore,
        grade,
        format,
        theme,
        sectionCount: sections.length,
        breakdown,
        recommendations,
    };
}

module.exports = { scoreDesignQuality, contrastRatio, WEIGHTS };
