/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CHART RENDERER — High-Quality Chart Images via Chart.js + Headless Browser
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Renders data visualizations as PNG images using Chart.js in a headless
 * Chromium browser (via Playwright). Produces charts far superior to
 * PptxGenJS built-in charts, and usable across PPTX, DOCX, PDF, HTML.
 *
 * Supported chart types:
 *   bar, line, pie, doughnut, radar, polarArea, scatter, bubble,
 *   gauge (custom), waterfall (custom), treemap (plugin), heatmap (custom)
 *
 * Usage:
 *   const { renderChart, renderChartBatch } = require('./chart-renderer');
 *   const result = await renderChart({
 *       type: 'bar',
 *       data: { labels: ['Q1','Q2'], datasets: [{ data: [10,20] }] },
 *       theme: 'modern-blue',
 *   });
 *   // result = { success, pngPath, width, height }
 *
 * @module scripts/shared/chart-renderer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { resolveTheme } = require('../doc-design-system');

// ─── Constants ──────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../../test-artifacts/charts');
const CHARTJS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const RENDER_TIMEOUT_MS = 15000;

// ─── Shared Browser (reuses diagram-engine's browser when possible) ─────────

let _browser = null;
let _context = null;
let _launchPromise = null;

async function getBrowser() {
    if (_browser && _browser.isConnected()) return { browser: _browser, context: _context };
    if (_launchPromise) return _launchPromise;

    _launchPromise = (async () => {
        const { chromium } = require('playwright');
        _browser = await chromium.launch({ headless: true });
        _context = await _browser.newContext({
            viewport: { width: 1200, height: 800 },
            deviceScaleFactor: 2,
        });
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

// ─── Theme → Chart.js Color Palette ─────────────────────────────────────────

/**
 * Generate a Chart.js-compatible color palette from document theme tokens.
 */
function buildChartPalette(themeName) {
    const theme = resolveTheme(themeName);

    // Base palette from theme
    const colors = [
        theme.primary,
        theme.accent,
        theme.success || '#22C55E',
        theme.warning || '#F59E0B',
        theme.danger || '#EF4444',
        theme.primaryLight || lighten(theme.primary, 0.3),
        theme.accentDark || darken(theme.accent, 0.2),
        '#8B5CF6', // violet
        '#06B6D4', // cyan
        '#F97316', // orange
        '#EC4899', // pink
        '#14B8A6', // teal
    ];

    return {
        colors,
        gridColor: theme.border || '#E5E7EB',
        textColor: theme.text || '#1F2937',
        backgroundColor: 'transparent',
        fontFamily: "'Segoe UI', 'Calibri', Arial, sans-serif",
    };
}

function lighten(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.min(255, Math.round(r + (255 - r) * amount));
    const ng = Math.min(255, Math.round(g + (255 - g) * amount));
    const nb = Math.min(255, Math.round(b + (255 - b) * amount));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function darken(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.max(0, Math.round(r * (1 - amount)));
    const ng = Math.max(0, Math.round(g * (1 - amount)));
    const nb = Math.max(0, Math.round(b * (1 - amount)));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// ─── Chart Configuration Builders ───────────────────────────────────────────

/**
 * Build a complete Chart.js config from user options + theme palette.
 */
function buildChartConfig(opts, palette) {
    const { type, data, options: userOptions = {} } = opts;

    // Apply theme colors to datasets if not already colored
    const themedData = { ...data };
    if (themedData.datasets) {
        themedData.datasets = themedData.datasets.map((ds, i) => {
            const color = palette.colors[i % palette.colors.length];
            const defaults = {};

            if (['pie', 'doughnut', 'polarArea'].includes(type)) {
                defaults.backgroundColor = themedData.labels
                    ? themedData.labels.map((_, j) => palette.colors[j % palette.colors.length] + 'CC')
                    : palette.colors.map(c => c + 'CC');
                defaults.borderColor = '#FFFFFF';
                defaults.borderWidth = 2;
            } else if (['radar'].includes(type)) {
                defaults.backgroundColor = color + '33';
                defaults.borderColor = color;
                defaults.borderWidth = 2;
                defaults.pointBackgroundColor = color;
            } else if (['scatter', 'bubble'].includes(type)) {
                defaults.backgroundColor = color + '99';
                defaults.borderColor = color;
            } else {
                // bar, line, etc.
                defaults.backgroundColor = color + 'CC';
                defaults.borderColor = color;
                defaults.borderWidth = type === 'line' ? 3 : 1;
                if (type === 'line') {
                    defaults.tension = 0.3;
                    defaults.fill = false;
                    defaults.pointRadius = 4;
                    defaults.pointHoverRadius = 6;
                }
            }

            return { ...defaults, ...ds };
        });
    }

    // Build scale config for cartesian charts
    const isCartesian = ['bar', 'line', 'scatter', 'bubble'].includes(type);
    const scales = isCartesian ? {
        x: {
            grid: { color: palette.gridColor + '66', drawBorder: false },
            ticks: { color: palette.textColor, font: { family: palette.fontFamily, size: 12 } },
        },
        y: {
            grid: { color: palette.gridColor + '66', drawBorder: false },
            ticks: { color: palette.textColor, font: { family: palette.fontFamily, size: 12 } },
            beginAtZero: true,
        },
    } : undefined;

    const config = {
        type,
        data: themedData,
        options: {
            responsive: false,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: palette.textColor,
                        font: { family: palette.fontFamily, size: 12 },
                        padding: 16,
                        usePointStyle: true,
                    },
                },
                title: {
                    display: !!opts.chartTitle,
                    text: opts.chartTitle || '',
                    color: palette.textColor,
                    font: { family: palette.fontFamily, size: 16, weight: '600' },
                    padding: { bottom: 16 },
                },
                tooltip: { enabled: false },
            },
            ...(scales ? { scales } : {}),
            ...userOptions,
        },
    };

    return config;
}

/**
 * Build a gauge chart (custom doughnut with center text).
 * Note: returns config WITHOUT the plugin — the plugin is injected in HTML template.
 */
function buildGaugeConfig(opts, palette) {
    const { value = 0, max = 100, label = '' } = opts;
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    const color = pct >= 80 ? (palette.colors[2] || '#22C55E') :
        pct >= 50 ? (palette.colors[3] || '#F59E0B') :
            (palette.colors[4] || '#EF4444');

    return {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [pct, 100 - pct],
                backgroundColor: [color, palette.gridColor + '33'],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            animation: false,
            circumference: 270,
            rotation: -135,
            cutout: '75%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
            },
        },
        // Metadata for the HTML template to create the plugin
        _gauge: { pct: Math.round(pct), label, textColor: palette.textColor, fontFamily: palette.fontFamily },
    };
}

/**
 * Build a waterfall chart (stacked bar with invisible base segments).
 */
function buildWaterfallConfig(opts, palette) {
    const { values = [], labels = [] } = opts;

    const bases = [];
    const gains = [];
    const losses = [];
    let running = 0;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (i === 0 || i === values.length - 1) {
            // Start/end totals
            bases.push(0);
            gains.push(v >= 0 ? v : 0);
            losses.push(v < 0 ? Math.abs(v) : 0);
        } else if (v >= 0) {
            bases.push(running);
            gains.push(v);
            losses.push(0);
        } else {
            bases.push(running + v);
            gains.push(0);
            losses.push(Math.abs(v));
        }
        running += (i > 0 && i < values.length - 1) ? v : (i === 0 ? v : 0);
    }

    return {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Base', data: bases, backgroundColor: 'transparent', borderWidth: 0 },
                { label: 'Increase', data: gains, backgroundColor: palette.colors[2] + 'CC', borderColor: palette.colors[2] },
                { label: 'Decrease', data: losses, backgroundColor: palette.colors[4] + 'CC', borderColor: palette.colors[4] },
            ],
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: palette.textColor, font: { family: palette.fontFamily, size: 12 } },
                },
                y: {
                    stacked: true,
                    grid: { color: palette.gridColor + '66' },
                    ticks: { color: palette.textColor, font: { family: palette.fontFamily, size: 12 } },
                },
            },
        },
    };
}

// ─── HTML Template ──────────────────────────────────────────────────────────

function buildChartPage(config, width, height) {
    // Extract gauge metadata before serializing
    const gaugeData = config._gauge;
    const cleanConfig = { ...config };
    delete cleanConfig._gauge;

    const configJson = JSON.stringify(cleanConfig);

    // Build gauge plugin code if needed
    const gaugePluginCode = gaugeData ? `
        config.plugins = [{
            id: 'gaugeCenter',
            afterDraw: function(chart) {
                var ctx = chart.ctx;
                var w = chart.width;
                var h = chart.height;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.fillStyle = '${gaugeData.textColor}';
                ctx.font = 'bold 36px ${gaugeData.fontFamily.replace(/'/g, "\\'")}';
                ctx.fillText('${gaugeData.pct}%', w / 2, h / 2 + 5);
                ctx.font = '14px ${gaugeData.fontFamily.replace(/'/g, "\\'")}';
                ctx.fillStyle = '${gaugeData.textColor}AA';
                ctx.fillText('${gaugeData.label.replace(/'/g, "\\'")}', w / 2, h / 2 + 30);
                ctx.restore();
            }
        }];
    ` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; }
        body { background: transparent; }
        #chart-container { width: ${width}px; height: ${height}px; }
    </style>
</head>
<body>
    <div id="chart-container">
        <canvas id="chart" width="${width}" height="${height}"></canvas>
    </div>
    <script src="${CHARTJS_CDN}"></script>
    <script>
        (function() {
            try {
                var config = ${configJson};
                ${gaugePluginCode}
                var ctx = document.getElementById('chart').getContext('2d');
                new Chart(ctx, config);
                window.__chartDone = true;
            } catch (err) {
                window.__chartError = err.message || String(err);
                window.__chartDone = true;
            }
        })();
    </script>
</body>
</html>`;
}

// ─── Core Rendering ─────────────────────────────────────────────────────────

/**
 * Render a chart as a PNG image.
 *
 * @param {Object} opts
 * @param {string} opts.type - Chart type: bar, line, pie, doughnut, radar, polarArea, scatter, bubble, gauge, waterfall
 * @param {Object} [opts.data] - Chart.js data config (labels + datasets). Required for standard types.
 * @param {Object} [opts.options] - Chart.js options overrides
 * @param {string} [opts.chartTitle] - Title displayed on chart
 * @param {string} [opts.theme='modern-blue'] - Document theme
 * @param {string} [opts.outputName] - Custom output filename (without .png)
 * @param {string} [opts.outputDir] - Custom output directory
 * @param {number} [opts.width=800] - Canvas width in px
 * @param {number} [opts.height=500] - Canvas height in px
 * @param {number} [opts.value] - Gauge: current value
 * @param {number} [opts.max] - Gauge: max value
 * @param {string} [opts.label] - Gauge: center label
 * @param {Array} [opts.values] - Waterfall: array of numeric values
 * @param {Array} [opts.labels] - Waterfall: array of labels matching values
 * @returns {Promise<{success: boolean, pngPath?: string, width?: number, height?: number, error?: string}>}
 */
async function renderChart(opts) {
    const {
        type,
        theme = 'modern-blue',
        outputName,
        outputDir,
        width = 800,
        height = 500,
    } = opts;

    if (!type) return { success: false, error: 'Chart type is required' };

    const palette = buildChartPalette(theme);
    const outDir = outputDir || OUTPUT_DIR;
    fs.mkdirSync(outDir, { recursive: true });

    const baseName = outputName || `chart-${type}-${Date.now()}`;
    const pngPath = path.join(outDir, `${baseName}.png`);

    // Build config based on chart type
    let config;
    if (type === 'gauge') {
        config = buildGaugeConfig(opts, palette);
    } else if (type === 'waterfall') {
        config = buildWaterfallConfig(opts, palette);
    } else {
        if (!opts.data) return { success: false, error: 'data is required for standard chart types' };
        config = buildChartConfig(opts, palette);
    }

    let page = null;
    try {
        const { context } = await getBrowser();
        page = await context.newPage();

        const html = buildChartPage(config, width, height);
        await page.setContent(html, { waitUntil: 'networkidle' });

        await page.waitForFunction(() => window.__chartDone === true, null, { timeout: RENDER_TIMEOUT_MS });

        const chartError = await page.evaluate(() => window.__chartError);
        if (chartError) {
            return { success: false, error: `Chart.js error: ${chartError}` };
        }

        const canvasEl = await page.$('#chart');
        if (!canvasEl) {
            return { success: false, error: 'Canvas element not found' };
        }

        const pngBuffer = await canvasEl.screenshot({
            type: 'png',
            omitBackground: true,
        });
        fs.writeFileSync(pngPath, pngBuffer);

        return {
            success: true,
            pngPath,
            width,
            height,
        };
    } catch (err) {
        return { success: false, error: `Chart render failed: ${err.message}` };
    } finally {
        if (page) await page.close().catch(() => { });
    }
}

/**
 * Render multiple charts. Reuses browser instance.
 */
async function renderChartBatch(charts, sharedOpts = {}) {
    if (!Array.isArray(charts) || charts.length === 0) return [];
    const results = [];
    for (const chart of charts) {
        results.push(await renderChart({ ...sharedOpts, ...chart }));
    }
    return results;
}

/**
 * Render a chart and return path ready for embedding in documents.
 */
async function renderChartForEmbed(opts) {
    const { ticketId, slideIndex, ...chartOpts } = opts;
    const outputName = ticketId
        ? `${ticketId}-slide${slideIndex || 0}-chart`
        : `embed-chart-${Date.now()}`;

    const result = await renderChart({ ...chartOpts, outputName });

    if (!result.success) {
        return { imagePath: null, width: 0, height: 0, error: result.error };
    }
    return { imagePath: result.pngPath, width: result.width, height: result.height };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    renderChart,
    renderChartBatch,
    renderChartForEmbed,
    cleanupBrowser,
    buildChartPalette,
};
