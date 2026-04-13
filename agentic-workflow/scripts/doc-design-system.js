/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOCUMENT DESIGN SYSTEM v2 — Award-Winning Branding, Colors, Typography
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides premium visual defaults for all document generators (PPTX, DOCX, PDF,
 * Excel, HTML, Infographic, Markdown, Video). The LLM can override ANY of these
 * per-document via tool parameters.
 *
 * v2 additions: gradients, shadows/elevation, border-radius tokens, opacity,
 * modular type scale, consistent spacing scale, brand kit system,
 * background patterns, status badge variants, animation tokens.
 *
 * This is NOT a template system — it's a design token library. The LLM decides
 * structure; this module provides consistent visual language.
 *
 * @module scripts/doc-design-system
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Theme Definitions ──────────────────────────────────────────────────────

const THEMES = {
    'modern-blue': {
        name: 'Modern Blue',
        primary: '#0066CC',
        primaryDark: '#004C99',
        primaryLight: '#E3F0FF',
        accent: '#00B4D8',
        accentDark: '#0090AD',
        success: '#28A745',
        successLight: '#D4EDDA',
        warning: '#FFC107',
        warningLight: '#FFF3CD',
        danger: '#DC3545',
        dangerLight: '#F8D7DA',
        neutral: '#6C757D',
        background: '#FFFFFF',
        surface: '#F8F9FA',
        surfaceAlt: '#E9ECEF',
        text: '#212529',
        textSecondary: '#6C757D',
        textOnPrimary: '#FFFFFF',
        border: '#DEE2E6',
        borderLight: '#F0F0F0',
        chartColors: ['#0066CC', '#00B4D8', '#28A745', '#FFC107', '#DC3545', '#6F42C1', '#FD7E14', '#20C997'],
        gradients: {
            primary: { start: '#0066CC', end: '#004C99', angle: 135 },
            accent: { start: '#00B4D8', end: '#0090AD', angle: 135 },
            hero: { start: '#0066CC', end: '#00B4D8', angle: 120 },
            surface: { start: '#FFFFFF', end: '#F8F9FA', angle: 180 },
            dark: { start: '#1A1A2E', end: '#16213E', angle: 135 },
        },
    },
    'dark-professional': {
        name: 'Dark Professional',
        primary: '#4A90D9',
        primaryDark: '#2C6FB5',
        primaryLight: '#1E3A5F',
        accent: '#F5A623',
        accentDark: '#D4890A',
        success: '#7ED321',
        successLight: '#2D3F1A',
        warning: '#F5A623',
        warningLight: '#3F3018',
        danger: '#D0021B',
        dangerLight: '#3F1018',
        neutral: '#9B9B9B',
        background: '#1E1E2E',
        surface: '#2D2D3F',
        surfaceAlt: '#3D3D50',
        text: '#E8E8E8',
        textSecondary: '#9B9B9B',
        textOnPrimary: '#FFFFFF',
        border: '#4A4A5A',
        borderLight: '#3A3A4A',
        chartColors: ['#4A90D9', '#F5A623', '#7ED321', '#BD10E0', '#D0021B', '#50E3C2', '#B8E986', '#FF6B6B'],
        gradients: {
            primary: { start: '#4A90D9', end: '#2C6FB5', angle: 135 },
            accent: { start: '#F5A623', end: '#D4890A', angle: 135 },
            hero: { start: '#1E1E2E', end: '#2D2D3F', angle: 120 },
            surface: { start: '#2D2D3F', end: '#1E1E2E', angle: 180 },
            dark: { start: '#0F0F1A', end: '#1E1E2E', angle: 135 },
        },
    },
    'corporate-green': {
        name: 'Corporate Green',
        primary: '#2E7D32',
        primaryDark: '#1B5E20',
        primaryLight: '#E8F5E9',
        accent: '#00ACC1',
        accentDark: '#00838F',
        success: '#43A047',
        successLight: '#E8F5E9',
        warning: '#FB8C00',
        warningLight: '#FFF3E0',
        danger: '#E53935',
        dangerLight: '#FFEBEE',
        neutral: '#757575',
        background: '#FFFFFF',
        surface: '#F1F8E9',
        surfaceAlt: '#DCEDC8',
        text: '#212121',
        textSecondary: '#757575',
        textOnPrimary: '#FFFFFF',
        border: '#C8E6C9',
        borderLight: '#E0F2E1',
        chartColors: ['#2E7D32', '#00ACC1', '#FB8C00', '#8E24AA', '#E53935', '#00897B', '#5E35B1', '#F4511E'],
        gradients: {
            primary: { start: '#2E7D32', end: '#1B5E20', angle: 135 },
            accent: { start: '#00ACC1', end: '#00838F', angle: 135 },
            hero: { start: '#2E7D32', end: '#00ACC1', angle: 120 },
            surface: { start: '#FFFFFF', end: '#F1F8E9', angle: 180 },
            dark: { start: '#1B3A1E', end: '#0D2E11', angle: 135 },
        },
    },
    'warm-minimal': {
        name: 'Warm Minimal',
        primary: '#D84315',
        primaryDark: '#BF360C',
        primaryLight: '#FBE9E7',
        accent: '#FFB300',
        accentDark: '#FF8F00',
        success: '#43A047',
        successLight: '#E8F5E9',
        warning: '#FFB300',
        warningLight: '#FFF8E1',
        danger: '#C62828',
        dangerLight: '#FFEBEE',
        neutral: '#8D6E63',
        background: '#FFFBF5',
        surface: '#FFF3E0',
        surfaceAlt: '#FFE0B2',
        text: '#3E2723',
        textSecondary: '#8D6E63',
        textOnPrimary: '#FFFFFF',
        border: '#FFCCBC',
        borderLight: '#FFE0D0',
        chartColors: ['#D84315', '#FFB300', '#43A047', '#1565C0', '#6A1B9A', '#00838F', '#EF6C00', '#AD1457'],
        gradients: {
            primary: { start: '#D84315', end: '#BF360C', angle: 135 },
            accent: { start: '#FFB300', end: '#FF8F00', angle: 135 },
            hero: { start: '#D84315', end: '#FFB300', angle: 120 },
            surface: { start: '#FFFBF5', end: '#FFF3E0', angle: 180 },
            dark: { start: '#3E2723', end: '#4E342E', angle: 135 },
        },
    },
};

// ─── Elevation / Shadow Tokens ──────────────────────────────────────────────

const ELEVATION = {
    none: { blur: 0, offset: 0, opacity: 0 },
    subtle: { blur: 4, offset: 2, opacity: 0.08, color: '#000000' },
    medium: { blur: 8, offset: 4, opacity: 0.12, color: '#000000' },
    dramatic: { blur: 16, offset: 8, opacity: 0.18, color: '#000000' },
    // PPTX shadow params (PptxGenJS format)
    pptx: {
        none: {},
        subtle: { type: 'outer', blur: 3, offset: 1.5, opacity: 0.2, color: '000000', angle: 270 },
        medium: { type: 'outer', blur: 6, offset: 3, opacity: 0.3, color: '000000', angle: 270 },
        dramatic: { type: 'outer', blur: 10, offset: 5, opacity: 0.4, color: '000000', angle: 270 },
    },
};

// ─── Border Radius Tokens ───────────────────────────────────────────────────

const BORDER_RADIUS = {
    none: 0,
    small: 0.04,     // inches for PPTX
    medium: 0.08,
    large: 0.16,
    pill: 0.5,
    // px equivalents for HTML/CSS
    px: { none: 0, small: 4, medium: 8, large: 16, pill: 9999 },
};

// ─── Opacity Tokens ─────────────────────────────────────────────────────────

const OPACITY = {
    overlayLight: 0.1,
    overlayMedium: 0.3,
    overlayHeavy: 0.6,
    overlayDark: 0.85,
    disabled: 0.5,
    hover: 0.08,
};

// ─── Animation Tokens (PPTX transitions) ────────────────────────────────────

const ANIMATIONS = {
    slideTransition: { type: 'fade', duration: 0.5 },
    sectionTransition: { type: 'push', duration: 0.7 },
    titleEntrance: { type: 'zoom', duration: 0.6 },
    bulletBuild: { delayBetween: 0.3, type: 'appear' },
};

// ─── Status Badge Variants ──────────────────────────────────────────────────

const STATUS_BADGES = {
    pass: { bg: '#D4EDDA', text: '#155724', border: '#C3E6CB', label: 'PASS' },
    fail: { bg: '#F8D7DA', text: '#721C24', border: '#F5C6CB', label: 'FAIL' },
    pending: { bg: '#FFF3CD', text: '#856404', border: '#FFE69C', label: 'PENDING' },
    inProgress: { bg: '#CCE5FF', text: '#004085', border: '#B8DAFF', label: 'IN PROGRESS' },
    blocked: { bg: '#E2E3E5', text: '#383D41', border: '#D6D8DB', label: 'BLOCKED' },
    skipped: { bg: '#F0F0F0', text: '#6C757D', border: '#DEE2E6', label: 'SKIPPED' },
};

// ─── Typography (Modular Scale — 1.25 Major Third ratio) ────────────────────

const TYPE_SCALE_RATIO = 1.25;
const TYPE_BASE = 11; // base size in points

const TYPOGRAPHY = {
    scaleRatio: TYPE_SCALE_RATIO,
    base: TYPE_BASE,
    fontFamily: {
        primary: 'Calibri',
        secondary: 'Arial',
        mono: 'Consolas',
        display: 'Calibri Light',  // thin/light for hero titles
        serif: 'Georgia',          // for quotes, editorial
    },
    fontWeight: {
        light: 300,
        regular: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
    },
    // Modular scale sizes (base 11pt × 1.25 ratio)
    fontSize: {
        xs: 8,                                          // 8pt
        sm: 9,                                          // 9pt
        body: TYPE_BASE,                                // 11pt
        lg: Math.round(TYPE_BASE * TYPE_SCALE_RATIO),   // 14pt
        h4: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 2), // 17pt
        h3: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 3), // 21pt
        h2: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 4), // 27pt
        h1: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 5), // 34pt
        display: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 6), // 42pt
        hero: Math.round(TYPE_BASE * TYPE_SCALE_RATIO ** 7),    // 53pt
    },
    // PPTX-specific sizes (points)
    pptx: {
        titleSlide: { title: 42, subtitle: 18 },
        contentSlide: { heading: 27, subheading: 21, body: 14, caption: 10 },
        sectionBreak: { title: 34, subtitle: 17 },
        hero: { stat: 64, label: 14 },
        metric: { value: 32, label: 11, change: 10 },
    },
    // DOCX-specific sizes (half-points for docx lib)
    docx: {
        title: 56,     // 28pt
        heading1: 44,  // 22pt
        heading2: 36,  // 18pt
        heading3: 30,  // 15pt
        body: 22,      // 11pt
        small: 18,     // 9pt
        caption: 16,   // 8pt
    },
    // PDF-specific sizes (points for pdf-lib)
    pdf: {
        title: 28,
        heading1: 22,
        heading2: 18,
        heading3: 15,
        body: 11,
        small: 9,
        caption: 8,
    },
    letterSpacing: {
        tight: -0.02,   // em units
        normal: 0,
        wide: 0.05,
        extraWide: 0.1,
    },
};

// ─── Spacing Scale (4px base unit) ──────────────────────────────────────────

const SPACE_UNIT = 4; // base unit in pixels

const SPACING_SCALE = {
    '0': 0,
    '1': SPACE_UNIT,         // 4px
    '2': SPACE_UNIT * 2,     // 8px
    '3': SPACE_UNIT * 3,     // 12px
    '4': SPACE_UNIT * 4,     // 16px
    '6': SPACE_UNIT * 6,     // 24px
    '8': SPACE_UNIT * 8,     // 32px
    '12': SPACE_UNIT * 12,   // 48px
    '16': SPACE_UNIT * 16,   // 64px
    '24': SPACE_UNIT * 24,   // 96px
};

const SPACING = {
    scale: SPACING_SCALE,
    // PPTX (inches)
    pptx: {
        margin: { x: 0.5, y: 0.4 },
        contentArea: { x: 0.5, y: 1.2, w: 9.0, h: 5.8 },
        titleArea: { x: 0.5, y: 0.3, w: 9.0, h: 0.8 },
        slideWidth: 10,
        slideHeight: 7.5,
        cardGap: 0.2,
        sectionGap: 0.4,
    },
    // DOCX (points)
    docx: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        paragraphSpacing: { before: 120, after: 120 },
    },
    // PDF (points, 72 per inch)
    pdf: {
        margin: { top: 60, right: 50, bottom: 60, left: 50 },
        lineHeight: 1.4,
        sectionGap: 16,
    },
};

// ─── Theme Resolution ───────────────────────────────────────────────────────

/**
 * Load document design config from workflow-config.json if available.
 */
function loadDesignConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return config.documentDesign || {};
        }
    } catch { /* use defaults */ }
    return {};
}

/**
 * Load a brand kit by name from the brand-kits directory.
 * Returns null if the kit doesn't exist.
 *
 * @param {string} kitName - Brand kit filename (without .json)
 * @returns {Object|null}
 */
function loadBrandKit(kitName) {
    if (!kitName) return null;
    try {
        const kitPath = path.join(__dirname, '..', 'config', 'brand-kits', `${kitName}.json`);
        if (fs.existsSync(kitPath)) {
            return JSON.parse(fs.readFileSync(kitPath, 'utf-8'));
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * Resolve a theme by name or return the default theme.
 * Priority: toolParams.theme > brandKit > workflow-config > 'modern-blue'
 *
 * @param {string|Object} themeInput - Theme name string or override object
 * @param {string} [brandKitName] - Optional brand kit to layer on
 * @returns {Object} Resolved theme with all color tokens
 */
function resolveTheme(themeInput, brandKitName) {
    const designConfig = loadDesignConfig();

    // Start with default
    const configThemeName = designConfig.defaultTheme || 'modern-blue';
    let theme = { ...THEMES[configThemeName] || THEMES['modern-blue'] };

    // Apply config-level color overrides
    if (designConfig.primaryColor) theme.primary = designConfig.primaryColor;
    if (designConfig.accentColor) theme.accent = designConfig.accentColor;

    // Apply brand kit overrides
    const kit = loadBrandKit(brandKitName || designConfig.brandKit);
    if (kit && kit.colors) {
        theme = { ...theme, ...kit.colors };
        if (kit.gradients) theme.gradients = { ...theme.gradients, ...kit.gradients };
    }

    // Apply per-call overrides (highest priority)
    if (typeof themeInput === 'string' && THEMES[themeInput]) {
        theme = { ...THEMES[themeInput] };
    } else if (typeof themeInput === 'object' && themeInput !== null) {
        theme = { ...theme, ...themeInput };
    }

    // Ensure gradients exist (fallback to computed)
    if (!theme.gradients) {
        theme.gradients = {
            primary: { start: theme.primary, end: theme.primaryDark || theme.primary, angle: 135 },
            accent: { start: theme.accent, end: theme.accentDark || theme.accent, angle: 135 },
            hero: { start: theme.primary, end: theme.accent, angle: 120 },
            surface: { start: theme.background, end: theme.surface, angle: 180 },
            dark: { start: '#1A1A2E', end: '#16213E', angle: 135 },
        };
    }

    return theme;
}

/**
 * Resolve font family — tool param > brand kit > config > default.
 * @param {string} [fontOverride]
 * @param {string} [brandKitName]
 * @returns {string}
 */
function resolveFont(fontOverride, brandKitName) {
    if (fontOverride) return fontOverride;
    const kit = loadBrandKit(brandKitName);
    if (kit && kit.fontFamily) return kit.fontFamily;
    const designConfig = loadDesignConfig();
    return designConfig.fontFamily || TYPOGRAPHY.fontFamily.primary;
}

/**
 * Resolve logo path — tool param > brand kit > config > null.
 * @param {string} [logoOverride]
 * @param {string} [brandKitName]
 * @returns {string|null} Absolute path to logo file, or null
 */
function resolveLogoPath(logoOverride, brandKitName) {
    let logoPath = logoOverride;
    if (!logoPath) {
        const kit = loadBrandKit(brandKitName);
        if (kit && kit.logo) logoPath = kit.logo;
    }
    if (!logoPath) logoPath = loadDesignConfig().logoPath;
    if (!logoPath) return null;

    const resolved = path.isAbsolute(logoPath) ? logoPath : path.resolve(__dirname, '..', logoPath);
    return fs.existsSync(resolved) ? resolved : null;
}

/**
 * Convert hex color to ARGB for ExcelJS / PPTX (e.g., '#0066CC' → 'FF0066CC')
 */
function hexToARGB(hex) {
    const clean = (hex || '#000000').replace('#', '');
    return `FF${clean.toUpperCase()}`;
}

/**
 * Convert hex color to RGB object for pdf-lib (normalized 0-1)
 */
function hexToRGB(hex) {
    const clean = (hex || '#000000').replace('#', '');
    return {
        r: parseInt(clean.substring(0, 2), 16) / 255,
        g: parseInt(clean.substring(2, 4), 16) / 255,
        b: parseInt(clean.substring(4, 6), 16) / 255,
    };
}

/**
 * Convert hex color to CSS rgba string with optional opacity.
 * @param {string} hex
 * @param {number} [opacity=1]
 * @returns {string}
 */
function hexToRGBA(hex, opacity = 1) {
    const c = hexToRGB(hex);
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${opacity})`;
}

/**
 * Blend two hex colors by a ratio (0 = colorA, 1 = colorB).
 * Useful for creating intermediate tones.
 * @param {string} colorA
 * @param {string} colorB
 * @param {number} ratio - 0 to 1
 * @returns {string} Blended hex color
 */
function blendColors(colorA, colorB, ratio) {
    const a = hexToRGB(colorA);
    const b = hexToRGB(colorB);
    const r = Math.round((a.r * (1 - ratio) + b.r * ratio) * 255);
    const g = Math.round((a.g * (1 - ratio) + b.g * ratio) * 255);
    const bl = Math.round((a.b * (1 - ratio) + b.b * ratio) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`.toUpperCase();
}

/**
 * Get the output directory for generated documents.
 * Creates it if it doesn't exist.
 * @returns {string}
 */
function getOutputDir() {
    const dir = path.join(__dirname, '..', 'test-artifacts', 'documents');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Generate a timestamped filename.
 * @param {string} baseName - e.g., 'Test-Report'
 * @param {string} extension - e.g., '.pptx'
 * @returns {string}
 */
function generateFileName(baseName, extension) {
    const safe = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    return `${safe}_${ts}${extension}`;
}

/**
 * Resolve elevation/shadow config for a given level.
 * @param {'none'|'subtle'|'medium'|'dramatic'} level
 * @param {'pptx'|'css'|'general'} [format='general']
 * @returns {Object}
 */
function resolveElevation(level, format = 'general') {
    if (format === 'pptx') {
        const shadow = ELEVATION.pptx[level] || ELEVATION.pptx.none;
        return shadow && typeof shadow === 'object' ? { ...shadow } : shadow;
    }
    return ELEVATION[level] || ELEVATION.none;
}

/**
 * Resolve border radius for a given size.
 * @param {'none'|'small'|'medium'|'large'|'pill'} size
 * @param {'inches'|'px'} [unit='inches']
 * @returns {number}
 */
function resolveBorderRadius(size, unit = 'inches') {
    if (unit === 'px') return BORDER_RADIUS.px[size] || 0;
    return BORDER_RADIUS[size] || 0;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    THEMES,
    TYPOGRAPHY,
    SPACING,
    SPACING_SCALE,
    ELEVATION,
    BORDER_RADIUS,
    OPACITY,
    ANIMATIONS,
    STATUS_BADGES,
    resolveTheme,
    resolveFont,
    resolveLogoPath,
    resolveElevation,
    resolveBorderRadius,
    loadBrandKit,
    hexToARGB,
    hexToRGB,
    hexToRGBA,
    blendColors,
    getOutputDir,
    generateFileName,
    loadDesignConfig,
};
