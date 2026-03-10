/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DIAGRAM ENGINE — Mermaid → SVG/PNG via Headless Browser
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Renders Mermaid DSL diagrams to SVG and PNG using Playwright headless Chromium.
 * Theme-aware: injects CSS that matches document design tokens.
 *
 * Supported Mermaid diagram types:
 *   flowchart, sequence, classDiagram, stateDiagram, erDiagram,
 *   pie, gantt, journey, gitGraph, mindmap, timeline, quadrantChart,
 *   sankey, xychart, block
 *
 * Usage:
 *   const { renderDiagram, renderDiagramBatch, cleanupBrowser } = require('./diagram-engine');
 *   const result = await renderDiagram({ mermaidCode: 'graph TD; A-->B;', theme: 'modern-blue' });
 *   // result = { svgPath, pngPath, width, height, success }
 *
 * @module scripts/shared/diagram-engine
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { THEMES, resolveTheme } = require('../doc-design-system');

// ─── Constants ──────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../../test-artifacts/diagrams');
const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const RENDER_TIMEOUT_MS = 15000;
const MAX_CODE_LENGTH = 50000;

// ─── Browser Pool (singleton — reused across calls) ─────────────────────────

let _browser = null;
let _browserContext = null;
let _browserLaunchPromise = null;

/**
 * Get or create a shared browser instance. Reuses a single Chromium process
 * across all rendering calls for performance.
 */
async function getBrowser() {
    if (_browser && _browser.isConnected()) return { browser: _browser, context: _browserContext };

    // Prevent duplicate launches if called concurrently
    if (_browserLaunchPromise) return _browserLaunchPromise;

    _browserLaunchPromise = (async () => {
        const { chromium } = require('playwright');
        _browser = await chromium.launch({ headless: true });
        _browserContext = await _browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 2, // Retina-quality rendering
        });
        _browserLaunchPromise = null;
        return { browser: _browser, context: _browserContext };
    })();

    return _browserLaunchPromise;
}

/**
 * Close the shared browser. Call when done with all rendering.
 */
async function cleanupBrowser() {
    if (_browserContext) { await _browserContext.close().catch(() => { }); _browserContext = null; }
    if (_browser) { await _browser.close().catch(() => { }); _browser = null; }
    _browserLaunchPromise = null;
}

// ─── Theme Mapping ──────────────────────────────────────────────────────────

/**
 * Map document theme tokens to Mermaid theme CSS overrides.
 */
function buildThemeCSS(themeName) {
    const theme = resolveTheme(themeName);
    return `
        .mermaid {
            font-family: 'Segoe UI', 'Calibri', Arial, sans-serif;
        }
        /* Node styling */
        .node rect, .node polygon, .node circle, .node ellipse {
            fill: ${theme.surface} !important;
            stroke: ${theme.primary} !important;
            stroke-width: 2px !important;
        }
        .node .label { color: ${theme.text} !important; }
        /* Edge styling */
        .edgePath .path { stroke: ${theme.accent} !important; stroke-width: 2px !important; }
        .edgeLabel { background-color: ${theme.background} !important; color: ${theme.text} !important; }
        .arrowheadPath { fill: ${theme.accent} !important; }
        /* Cluster styling */
        .cluster rect { fill: ${theme.surface} !important; stroke: ${theme.border} !important; }
        .cluster text { fill: ${theme.textSecondary || theme.text} !important; }
        /* Section / swimlane */
        .section { fill: ${theme.surface} !important; stroke: ${theme.border} !important; }
        /* Sequence diagram */
        .actor { fill: ${theme.primary} !important; stroke: ${theme.primaryDark || theme.primary} !important; }
        .actor text, .messageText { fill: ${theme.background} !important; }
        .messageLine0, .messageLine1 { stroke: ${theme.accent} !important; }
        .note { fill: ${theme.surface} !important; stroke: ${theme.border} !important; }
        /* Gantt */
        .task { fill: ${theme.primary} !important; stroke: ${theme.primaryDark || theme.primary} !important; }
        .taskText { fill: #FFFFFF !important; }
        .grid .tick line { stroke: ${theme.border} !important; }
        /* Pie */
        .pieTitleText { fill: ${theme.text} !important; }
        /* General text */
        text { fill: ${theme.text} !important; }
        .title { fill: ${theme.text} !important; }
    `;
}

/**
 * Map document theme to Mermaid built-in theme name.
 */
function getMermaidTheme(themeName) {
    const themeMap = {
        'modern-blue': 'default',
        'dark-professional': 'dark',
        'corporate-green': 'forest',
        'warm-minimal': 'neutral',
    };
    return themeMap[themeName] || 'default';
}

// ─── HTML Template ──────────────────────────────────────────────────────────

/**
 * Build the full HTML page that renders a Mermaid diagram.
 */
function buildRenderPage(mermaidCode, themeName) {
    const mermaidTheme = getMermaidTheme(themeName);
    const customCSS = buildThemeCSS(themeName);

    // Sanitize mermaid code for embedding in HTML
    const safeCode = mermaidCode
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: transparent; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 20px; }
        #diagram-container { display: inline-block; }
        ${customCSS}
    </style>
</head>
<body>
    <div id="diagram-container">
        <pre class="mermaid">${safeCode}</pre>
    </div>
    <script src="${MERMAID_CDN_URL}"></script>
    <script>
        (async () => {
            try {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: '${mermaidTheme}',
                    securityLevel: 'strict',
                    fontFamily: 'Segoe UI, Calibri, Arial, sans-serif',
                    fontSize: 14,
                    flowchart: { htmlLabels: true, curve: 'basis', padding: 15 },
                    sequence: { actorMargin: 80, messageFontSize: 13 },
                    gantt: { fontSize: 12, barHeight: 25, barGap: 6 },
                    pie: { textPosition: 0.75 },
                    themeVariables: {
                        fontSize: '14px',
                    },
                });
                await mermaid.run({ querySelector: '.mermaid' });
                // Signal completion
                window.__mermaidDone = true;
            } catch (err) {
                window.__mermaidError = err.message || String(err);
                window.__mermaidDone = true;
            }
        })();
    </script>
</body>
</html>`;
}

// ─── Core Rendering ─────────────────────────────────────────────────────────

/**
 * Render a single Mermaid diagram to SVG and PNG.
 *
 * @param {Object} opts
 * @param {string} opts.mermaidCode - Mermaid DSL string
 * @param {string} [opts.theme='modern-blue'] - Document theme name
 * @param {string} [opts.outputName] - Custom filename (without extension)
 * @param {string} [opts.outputDir] - Custom output directory
 * @param {boolean} [opts.svg=true] - Export SVG file
 * @param {boolean} [opts.png=true] - Export PNG file
 * @param {number} [opts.scale=2] - PNG scale factor (1=72dpi, 2=144dpi, 3=216dpi)
 * @param {number} [opts.maxWidth] - Max width in pixels (diagram will be scaled down if wider)
 * @returns {Promise<{success: boolean, svgPath?: string, pngPath?: string, svgContent?: string, width?: number, height?: number, error?: string}>}
 */
async function renderDiagram(opts) {
    const {
        mermaidCode,
        theme = 'modern-blue',
        outputName,
        outputDir,
        svg: exportSvg = true,
        png: exportPng = true,
        scale = 2,
        maxWidth,
    } = opts;

    // ── Input validation ──
    if (!mermaidCode || typeof mermaidCode !== 'string') {
        return { success: false, error: 'mermaidCode is required and must be a string' };
    }
    if (mermaidCode.length > MAX_CODE_LENGTH) {
        return { success: false, error: `mermaidCode exceeds max length of ${MAX_CODE_LENGTH} characters` };
    }

    const outDir = outputDir || OUTPUT_DIR;
    fs.mkdirSync(outDir, { recursive: true });

    const baseName = outputName || `diagram-${Date.now()}`;
    const svgPath = path.join(outDir, `${baseName}.svg`);
    const pngPath = path.join(outDir, `${baseName}.png`);

    let page = null;
    try {
        const { context } = await getBrowser();
        page = await context.newPage();

        // Load the Mermaid rendering page
        const html = buildRenderPage(mermaidCode, theme);
        await page.setContent(html, { waitUntil: 'networkidle' });

        // Wait for Mermaid to finish rendering
        await page.waitForFunction(() => window.__mermaidDone === true, null, { timeout: RENDER_TIMEOUT_MS });

        // Check for errors
        const renderError = await page.evaluate(() => window.__mermaidError);
        if (renderError) {
            return { success: false, error: `Mermaid render error: ${renderError}` };
        }

        // Extract SVG from the rendered diagram
        const diagramEl = await page.$('#diagram-container svg');
        if (!diagramEl) {
            return { success: false, error: 'No SVG element found after rendering' };
        }

        // Get bounding box for dimensions
        const bbox = await diagramEl.boundingBox();
        let width = Math.ceil(bbox.width);
        let height = Math.ceil(bbox.height);

        // Extract SVG content
        const svgContent = await diagramEl.evaluate(el => el.outerHTML);

        // ── SVG Export ──
        if (exportSvg) {
            // Clean up SVG: add xmlns, viewBox, remove max-width constraints
            const cleanSvg = svgContent
                .replace(/<svg /, `<svg xmlns="http://www.w3.org/2000/svg" `)
                .replace(/style="[^"]*max-width:[^;"]*;?/g, (match) => match.replace(/max-width:[^;"]*;?/, ''));
            fs.writeFileSync(svgPath, cleanSvg, 'utf-8');
        }

        // ── PNG Export ──
        if (exportPng) {
            // If maxWidth specified and diagram is wider, scale the viewport
            if (maxWidth && width > maxWidth) {
                const ratio = maxWidth / width;
                height = Math.ceil(height * ratio);
                width = maxWidth;
            }

            const pngBuffer = await diagramEl.screenshot({
                type: 'png',
                omitBackground: true,
            });
            fs.writeFileSync(pngPath, pngBuffer);
        }

        return {
            success: true,
            svgPath: exportSvg ? svgPath : undefined,
            pngPath: exportPng ? pngPath : undefined,
            svgContent: exportSvg ? svgContent : undefined,
            width,
            height,
        };
    } catch (err) {
        return { success: false, error: `Diagram render failed: ${err.message}` };
    } finally {
        if (page) await page.close().catch(() => { });
    }
}

// ─── Batch Rendering ────────────────────────────────────────────────────────

/**
 * Render multiple Mermaid diagrams. Reuses a single browser instance.
 *
 * @param {Array<{mermaidCode: string, theme?: string, outputName?: string}>} diagrams
 * @param {Object} [sharedOpts] - Shared options applied to all diagrams
 * @returns {Promise<Array<{success: boolean, svgPath?: string, pngPath?: string, width?: number, height?: number, error?: string}>>}
 */
async function renderDiagramBatch(diagrams, sharedOpts = {}) {
    if (!Array.isArray(diagrams) || diagrams.length === 0) {
        return [];
    }

    const results = [];
    for (const diagram of diagrams) {
        const opts = { ...sharedOpts, ...diagram };
        const result = await renderDiagram(opts);
        results.push(result);
    }
    return results;
}

// ─── Mermaid Code Helpers ───────────────────────────────────────────────────

/**
 * Detect the Mermaid diagram type from the code.
 * @param {string} code - Mermaid DSL
 * @returns {string} Diagram type (e.g., 'flowchart', 'sequence', 'class', 'gantt', etc.)
 */
function detectDiagramType(code) {
    const trimmed = code.trim().toLowerCase();
    const typePatterns = [
        { type: 'flowchart', pattern: /^(flowchart|graph)\s/ },
        { type: 'sequence', pattern: /^sequencediagram/ },
        { type: 'class', pattern: /^classdiagram/ },
        { type: 'state', pattern: /^statediagram/ },
        { type: 'er', pattern: /^erdiagram/ },
        { type: 'pie', pattern: /^pie/ },
        { type: 'gantt', pattern: /^gantt/ },
        { type: 'journey', pattern: /^journey/ },
        { type: 'gitGraph', pattern: /^gitgraph/ },
        { type: 'mindmap', pattern: /^mindmap/ },
        { type: 'timeline', pattern: /^timeline/ },
        { type: 'quadrant', pattern: /^quadrantchart/ },
        { type: 'sankey', pattern: /^sankey/ },
        { type: 'xychart', pattern: /^xychart/ },
        { type: 'block', pattern: /^block/ },
    ];
    for (const { type, pattern } of typePatterns) {
        if (pattern.test(trimmed)) return type;
    }
    return 'unknown';
}

/**
 * Validate Mermaid code syntax (basic structural check).
 * @param {string} code
 * @returns {{ valid: boolean, type: string, error?: string }}
 */
function validateMermaidCode(code) {
    if (!code || typeof code !== 'string') {
        return { valid: false, type: 'unknown', error: 'Code is required' };
    }
    const trimmed = code.trim();
    if (trimmed.length < 5) {
        return { valid: false, type: 'unknown', error: 'Code too short to be a valid diagram' };
    }
    const type = detectDiagramType(trimmed);
    if (type === 'unknown') {
        return { valid: false, type, error: 'Unrecognized diagram type. Code must start with a valid Mermaid directive.' };
    }
    return { valid: true, type };
}

// ─── PPTX Integration Helper ───────────────────────────────────────────────

/**
 * Render a Mermaid diagram and return the path ready for PPTX/DOCX/PDF embedding.
 * This is the primary function generators should call.
 *
 * @param {Object} opts
 * @param {string} opts.mermaidCode - Mermaid DSL
 * @param {string} [opts.theme] - Document theme
 * @param {string} [opts.ticketId] - Ticket ID for naming
 * @param {number} [opts.slideIndex] - Slide index for naming
 * @returns {Promise<{imagePath: string|null, width: number, height: number, error?: string}>}
 */
async function renderForEmbed(opts) {
    const { mermaidCode, theme, ticketId, slideIndex } = opts;

    const outputName = ticketId
        ? `${ticketId}-slide${slideIndex || 0}-diagram`
        : `embed-${Date.now()}`;

    const result = await renderDiagram({
        mermaidCode,
        theme,
        outputName,
        svg: false, // PNG only for embedding
        png: true,
        scale: 2,
    });

    if (!result.success) {
        return { imagePath: null, width: 0, height: 0, error: result.error };
    }

    return {
        imagePath: result.pngPath,
        width: result.width,
        height: result.height,
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    renderDiagram,
    renderDiagramBatch,
    renderForEmbed,
    cleanupBrowser,
    detectDiagramType,
    validateMermaidCode,
    buildThemeCSS,
};
