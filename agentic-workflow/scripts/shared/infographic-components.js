/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * INFOGRAPHIC COMPONENTS — HTML → PNG Composable Visual Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pre-built infographic layouts rendered as high-quality PNG images via a
 * headless browser. Theme-aware, embeddable in PPTX, DOCX, PDF, and HTML.
 *
 * Component types:
 *   stat-poster, comparison, process-flow, kpi-dashboard, status-board
 *
 * Usage:
 *   const { renderInfographic } = require('./infographic-components');
 *   const result = await renderInfographic({
 *       type: 'stat-poster',
 *       data: { value: '98.5%', label: 'Uptime', trend: '+0.3%' },
 *       theme: 'modern-blue',
 *   });
 *   // result = { success, pngPath, width, height }
 *
 * @module scripts/shared/infographic-components
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { resolveTheme } = require('../doc-design-system');

// ─── Constants ──────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../../test-artifacts/infographics');
const RENDER_TIMEOUT_MS = 15000;

// ─── Browser Pool ───────────────────────────────────────────────────────────

let _browser = null;
let _context = null;
let _launchPromise = null;

async function getBrowser() {
    if (_browser && _browser.isConnected()) return { browser: _browser, context: _context };
    if (_launchPromise) return _launchPromise;
    _launchPromise = (async () => {
        const { chromium } = require('playwright');
        _browser = await chromium.launch({ headless: true });
        _context = await _browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
        _launchPromise = null;
        return { browser: _browser, context: _context };
    })();
    return _launchPromise;
}

async function cleanupBrowser() {
    if (_context) { await _context.close().catch(() => { }); _context = null; }
    if (_browser) { await _browser.close().catch(() => { }); _browser = null; }
    _launchPromise = null;
}

// ─── Theme → CSS Variables ──────────────────────────────────────────────────

function themeToCSS(themeName) {
    const t = resolveTheme(themeName);
    return `
        --primary: ${t.primary};
        --primary-light: ${t.primaryLight || t.primary + '22'};
        --accent: ${t.accent};
        --bg: ${t.background};
        --surface: ${t.surface};
        --text: ${t.text};
        --text-secondary: ${t.textSecondary || '#6B7280'};
        --border: ${t.border || '#E5E7EB'};
        --success: ${t.success || '#22C55E'};
        --warning: ${t.warning || '#F59E0B'};
        --danger: ${t.danger || '#EF4444'};
        --font: 'Segoe UI', 'Calibri', Arial, sans-serif;
    `;
}

// ─── Component Templates ────────────────────────────────────────────────────

/**
 * Stat Poster: Big number + label + trend + optional progress ring
 */
function buildStatPoster(data, cssVars) {
    const { value = '0', label = '', trend = '', icon = '📊', trendDirection = 'up' } = data;
    const trendColor = trendDirection === 'up' ? 'var(--success)' : trendDirection === 'down' ? 'var(--danger)' : 'var(--text-secondary)';
    const trendArrow = trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→';

    return `
    <div style="width: 400px; height: 280px; background: var(--surface); border-radius: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid var(--border); padding: 24px;">
        <div style="font-size: 48px; margin-bottom: 8px;">${icon}</div>
        <div style="font-size: 56px; font-weight: 700; color: var(--primary); line-height: 1; letter-spacing: -2px;">${sanitize(String(value))}</div>
        <div style="font-size: 16px; color: var(--text-secondary); margin-top: 8px; text-transform: uppercase; letter-spacing: 2px;">${sanitize(label)}</div>
        ${trend ? `<div style="font-size: 14px; color: ${trendColor}; margin-top: 12px; font-weight: 600;">${trendArrow} ${sanitize(String(trend))}</div>` : ''}
    </div>`;
}

/**
 * Comparison: Side-by-side cards for before/after or A vs B
 */
function buildComparison(data, cssVars) {
    const { left = {}, right = {}, vsLabel = 'VS' } = data;

    function card(item, accentColor) {
        const metrics = (item.metrics || []).map(m => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
                <span style="color: var(--text-secondary); font-size: 13px;">${sanitize(m.label || '')}</span>
                <span style="font-weight: 600; color: var(--text); font-size: 13px;">${sanitize(String(m.value || ''))}</span>
            </div>
        `).join('');

        return `
        <div style="flex: 1; background: var(--surface); border-radius: 12px; padding: 20px; border-top: 4px solid ${accentColor}; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
            <div style="font-size: 18px; font-weight: 700; color: var(--text); margin-bottom: 4px;">${sanitize(item.title || '')}</div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">${sanitize(item.subtitle || '')}</div>
            ${metrics}
        </div>`;
    }

    return `
    <div style="width: 700px; display: flex; gap: 16px; align-items: stretch;">
        ${card(left, 'var(--danger)')}
        <div style="display: flex; align-items: center; justify-content: center; width: 48px; flex-shrink: 0;">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px;">${sanitize(vsLabel)}</div>
        </div>
        ${card(right, 'var(--success)')}
    </div>`;
}

/**
 * Process Flow: Numbered steps with connecting arrows
 */
function buildProcessFlow(data, cssVars) {
    const { steps = [] } = data;

    const stepHtml = steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return `
        <div style="display: flex; align-items: center;">
            <div style="width: 160px; text-align: center;">
                <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; margin: 0 auto 8px;">${i + 1}</div>
                <div style="font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.3;">${sanitize(step.title || '')}</div>
                ${step.description ? `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${sanitize(step.description)}</div>` : ''}
            </div>
            ${!isLast ? '<div style="width: 40px; height: 2px; background: var(--accent); margin: 0 4px; position: relative; top: -12px;"><div style="position: absolute; right: -4px; top: -4px; width: 0; height: 0; border-left: 8px solid var(--accent); border-top: 5px solid transparent; border-bottom: 5px solid transparent;"></div></div>' : ''}
        </div>`;
    }).join('');

    return `
    <div style="display: flex; align-items: flex-start; justify-content: center; padding: 24px;">
        ${stepHtml}
    </div>`;
}

/**
 * KPI Dashboard: Grid of metric cards
 */
function buildKPIDashboard(data, cssVars) {
    const { metrics = [], title = '' } = data;

    const cards = metrics.map(m => {
        const statusColor = m.status === 'good' ? 'var(--success)' :
            m.status === 'warning' ? 'var(--warning)' :
                m.status === 'critical' ? 'var(--danger)' : 'var(--primary)';
        return `
        <div style="background: var(--surface); border-radius: 12px; padding: 20px; border-left: 4px solid ${statusColor}; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">${sanitize(m.label || '')}</div>
            <div style="font-size: 32px; font-weight: 700; color: var(--text); margin: 8px 0 4px;">${sanitize(String(m.value || ''))}</div>
            ${m.change ? `<div style="font-size: 13px; color: ${statusColor}; font-weight: 500;">${sanitize(String(m.change))}</div>` : ''}
        </div>`;
    }).join('');

    return `
    <div style="width: 800px; padding: 24px;">
        ${title ? `<div style="font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 20px;">${sanitize(title)}</div>` : ''}
        <div style="display: grid; grid-template-columns: repeat(${Math.min(metrics.length, 4)}, 1fr); gap: 16px;">
            ${cards}
        </div>
    </div>`;
}

/**
 * Status Board: Test execution result summary
 */
function buildStatusBoard(data, cssVars) {
    const { items = [], title = 'Test Status' } = data;

    const rows = items.map(item => {
        const statusColors = {
            pass: { bg: '#DCFCE7', text: '#166534', icon: '✓' },
            fail: { bg: '#FEE2E2', text: '#991B1B', icon: '✗' },
            skip: { bg: '#FEF3C7', text: '#92400E', icon: '○' },
            pending: { bg: '#E0E7FF', text: '#3730A3', icon: '◷' },
        };
        const s = statusColors[item.status] || statusColors.pending;

        return `
        <div style="display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border);">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: ${s.bg}; color: ${s.text}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0;">${s.icon}</div>
            <div style="flex: 1; margin-left: 12px;">
                <div style="font-size: 14px; font-weight: 500; color: var(--text);">${sanitize(item.name || '')}</div>
                ${item.detail ? `<div style="font-size: 12px; color: var(--text-secondary);">${sanitize(item.detail)}</div>` : ''}
            </div>
            ${item.duration ? `<div style="font-size: 12px; color: var(--text-secondary); flex-shrink: 0;">${sanitize(item.duration)}</div>` : ''}
        </div>`;
    }).join('');

    return `
    <div style="width: 600px; background: var(--surface); border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <div style="padding: 16px 20px; background: var(--primary); color: white; font-weight: 700; font-size: 16px;">${sanitize(title)}</div>
        ${rows}
    </div>`;
}

// ─── Sanitizer ──────────────────────────────────────────────────────────────

function sanitize(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HTML Page Builder ──────────────────────────────────────────────────────

function buildInfographicPage(componentHtml, cssVars) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root { ${cssVars} }
        body { background: transparent; font-family: var(--font); display: flex; justify-content: center; align-items: flex-start; padding: 16px; }
        #infographic { display: inline-block; }
    </style>
</head>
<body>
    <div id="infographic">${componentHtml}</div>
    <script>window.__infoDone = true;</script>
</body>
</html>`;
}

// ─── Component Registry ─────────────────────────────────────────────────────

const COMPONENT_BUILDERS = {
    'stat-poster': buildStatPoster,
    'comparison': buildComparison,
    'process-flow': buildProcessFlow,
    'kpi-dashboard': buildKPIDashboard,
    'status-board': buildStatusBoard,
};

// ─── Core Rendering ─────────────────────────────────────────────────────────

/**
 * Render an infographic component as a PNG image.
 *
 * @param {Object} opts
 * @param {string} opts.type - Component type: stat-poster, comparison, process-flow, kpi-dashboard, status-board
 * @param {Object} opts.data - Component-specific data
 * @param {string} [opts.theme='modern-blue'] - Document theme
 * @param {string} [opts.outputName] - Custom filename
 * @param {string} [opts.outputDir] - Custom output dir
 * @returns {Promise<{success: boolean, pngPath?: string, width?: number, height?: number, error?: string}>}
 */
async function renderInfographic(opts) {
    const { type, data, theme = 'modern-blue', outputName, outputDir } = opts;

    if (!type || !COMPONENT_BUILDERS[type]) {
        return { success: false, error: `Unknown infographic type: ${type}. Available: ${Object.keys(COMPONENT_BUILDERS).join(', ')}` };
    }
    if (!data) return { success: false, error: 'data is required' };

    const cssVars = themeToCSS(theme);
    const builder = COMPONENT_BUILDERS[type];
    const componentHtml = builder(data, cssVars);
    const html = buildInfographicPage(componentHtml, cssVars);

    const outDir = outputDir || OUTPUT_DIR;
    fs.mkdirSync(outDir, { recursive: true });

    const baseName = outputName || `infographic-${type}-${Date.now()}`;
    const pngPath = path.join(outDir, `${baseName}.png`);

    let page = null;
    try {
        const { context } = await getBrowser();
        page = await context.newPage();

        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__infoDone === true, null, { timeout: RENDER_TIMEOUT_MS });

        const el = await page.$('#infographic');
        if (!el) return { success: false, error: 'Infographic container not found' };

        const bbox = await el.boundingBox();
        const pngBuffer = await el.screenshot({ type: 'png', omitBackground: true });
        fs.writeFileSync(pngPath, pngBuffer);

        return {
            success: true,
            pngPath,
            width: Math.ceil(bbox.width),
            height: Math.ceil(bbox.height),
        };
    } catch (err) {
        return { success: false, error: `Infographic render failed: ${err.message}` };
    } finally {
        if (page) await page.close().catch(() => { });
    }
}

/**
 * Render multiple infographics. Reuses browser.
 */
async function renderInfographicBatch(components, sharedOpts = {}) {
    if (!Array.isArray(components) || !components.length) return [];
    const results = [];
    for (const comp of components) {
        results.push(await renderInfographic({ ...sharedOpts, ...comp }));
    }
    return results;
}

/**
 * Render infographic for embedding in documents.
 */
async function renderInfographicForEmbed(opts) {
    const { ticketId, slideIndex, ...infoOpts } = opts;
    const outputName = ticketId
        ? `${ticketId}-slide${slideIndex || 0}-infographic`
        : `embed-infographic-${Date.now()}`;

    const result = await renderInfographic({ ...infoOpts, outputName });
    if (!result.success) return { imagePath: null, width: 0, height: 0, error: result.error };
    return { imagePath: result.pngPath, width: result.width, height: result.height };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    renderInfographic,
    renderInfographicBatch,
    renderInfographicForEmbed,
    cleanupBrowser,
    COMPONENT_TYPES: Object.keys(COMPONENT_BUILDERS),
};
