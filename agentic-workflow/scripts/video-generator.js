/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VIDEO GENERATOR (Experimental) — Animated Slide Video from Sections
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Converts document sections into an animated video (WebM) using Playwright's
 * built-in video recording. Each section becomes a full-screen HTML "slide"
 * displayed for a configurable duration with CSS transitions between them.
 *
 * Strategy:
 *   1. Build a single HTML page with all slides as divs
 *   2. Use CSS animations for slide transitions (fade, slide-left, zoom)
 *   3. Record the page via Playwright's context video recording → WebM
 *   4. Also exports individual slide PNGs as a storyboard
 *
 * Output: WebM or MP4 video + optional PNG storyboard
 * Dependencies: Playwright (already installed), ffmpeg-static + fluent-ffmpeg (for MP4)
 *
 * @module scripts/video-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { resolveTheme, getOutputDir, generateFileName, hexToRGB } = require('./doc-design-system');

// ─── MP4 Conversion (ffmpeg) ─────────────────────────────────────────────────

let _ffmpegPath = null;
function getFfmpegPath() {
    if (_ffmpegPath) return _ffmpegPath;
    try {
        _ffmpegPath = require('ffmpeg-static');
        return _ffmpegPath;
    } catch {
        return null;
    }
}

/**
 * Convert a WebM file to MP4 (H.264 + AAC container).
 * @param {string} webmPath - Path to source .webm file
 * @param {string} mp4Path  - Path for output .mp4 file
 * @returns {Promise<string>} Resolved mp4Path on success
 */
function convertToMp4(webmPath, mp4Path) {
    return new Promise((resolve, reject) => {
        const ffmpegBin = getFfmpegPath();
        if (!ffmpegBin) {
            return reject(new Error('ffmpeg-static not installed. Run: npm install ffmpeg-static fluent-ffmpeg'));
        }
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg.setFfmpegPath(ffmpegBin);
        ffmpeg(webmPath)
            .outputOptions([
                '-c:v', 'libx264',     // H.264 codec — universal playback
                '-pix_fmt', 'yuv420p', // Compatibility with all players
                '-preset', 'fast',
                '-crf', '23',          // Good quality, reasonable size
                '-movflags', '+faststart', // Streaming-friendly
                '-an',                 // No audio track (slides are silent)
            ])
            .output(mp4Path)
            .on('end', () => resolve(mp4Path))
            .on('error', (err) => reject(new Error(`MP4 conversion failed: ${err.message}`)))
            .run();
    });
}

let _browser = null;

async function getBrowser() {
    if (_browser && _browser.isConnected()) return _browser;
    const { chromium } = require('playwright');
    _browser = await chromium.launch({ headless: true });
    return _browser;
}

async function cleanupBrowser() {
    if (_browser) { await _browser.close().catch(() => { }); _browser = null; }
}

// ─── HTML Escape ─────────────────────────────────────────────────────────────

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Slide Renderers (HTML per section type) ─────────────────────────────────

function renderTitleSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;
        background:linear-gradient(135deg, ${theme.primary} 0%, ${theme.primaryDark} 100%);color:white;text-align:center;padding:80px">
        <h1 style="font-size:64px;font-weight:800;margin:0;text-shadow:0 4px 20px rgba(0,0,0,0.3)">${esc(section.text || section.title)}</h1>
        ${section.subtitle ? `<p style="font-size:28px;opacity:0.85;margin-top:24px">${esc(section.subtitle)}</p>` : ''}
        ${section.author ? `<p style="font-size:20px;opacity:0.6;margin-top:40px">${esc(section.author)}</p>` : ''}
    </div>`;
}

function renderContentSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;padding:80px;
        background:${theme.background}">
        ${section.title ? `<h2 style="font-size:42px;font-weight:700;color:${theme.primary};margin:0 0 32px 0">${esc(section.title)}</h2>` : ''}
        <p style="font-size:24px;line-height:1.7;color:${theme.textDark}">${esc(section.content || section.text)}</p>
    </div>`;
}

function renderBulletsSlide(section, theme) {
    const items = section.items || section.bullets || [];
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;padding:80px;
        background:${theme.background}">
        ${section.title ? `<h2 style="font-size:42px;font-weight:700;color:${theme.primary};margin:0 0 40px 0">${esc(section.title)}</h2>` : ''}
        <ul style="list-style:none;padding:0;margin:0">
            ${items.map(item => `<li style="font-size:26px;line-height:1.6;color:${theme.textDark};margin-bottom:16px;padding-left:32px;
                position:relative"><span style="position:absolute;left:0;color:${theme.accent}">●</span>${esc(item)}</li>`).join('')}
        </ul>
    </div>`;
}

function renderTableSlide(section, theme) {
    const headers = section.headers || [];
    const rows = section.rows || [];
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;padding:60px;
        background:${theme.background}">
        ${section.title ? `<h2 style="font-size:36px;font-weight:700;color:${theme.primary};margin:0 0 32px 0">${esc(section.title)}</h2>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:20px">
            ${headers.length ? `<thead><tr>${headers.map(h => `<th style="background:${theme.primary};color:white;padding:16px 20px;text-align:left;font-weight:600">${esc(h)}</th>`).join('')}</tr></thead>` : ''}
            <tbody>${rows.map((row, i) => `<tr style="background:${i % 2 === 0 ? theme.surface : theme.background}">
                ${row.map(cell => `<td style="padding:14px 20px;border-bottom:1px solid ${theme.border || '#E0E0E0'};color:${theme.textDark}">${esc(cell)}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
    </div>`;
}

function renderMetricSlide(section, theme) {
    const metrics = section.metrics || [];
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:60px;
        background:${theme.background}">
        ${section.title ? `<h2 style="font-size:42px;font-weight:700;color:${theme.primary};margin:0 0 48px 0">${esc(section.title)}</h2>` : ''}
        <div style="display:flex;gap:40px;justify-content:center;flex-wrap:wrap">
            ${metrics.map(m => `<div style="text-align:center;padding:32px 40px;background:${theme.surface};border-radius:16px;
                min-width:180px;border-top:4px solid ${theme.accent}">
                <div style="font-size:48px;font-weight:800;color:${theme.primary}">${esc(m.value)}</div>
                <div style="font-size:16px;color:${theme.textSecondary};margin-top:8px">${esc(m.label)}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

function renderQuoteSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:100px;
        background:linear-gradient(135deg, ${theme.surface} 0%, ${theme.background} 100%)">
        <div style="font-size:80px;color:${theme.accent};opacity:0.3;line-height:1">\u201C</div>
        <blockquote style="font-size:32px;font-style:italic;color:${theme.textDark};text-align:center;max-width:800px;
            line-height:1.6;margin:0">${esc(section.content || section.text || section.quote)}</blockquote>
        ${section.attribution ? `<p style="font-size:18px;color:${theme.textSecondary};margin-top:32px">\u2014 ${esc(section.attribution)}</p>` : ''}
    </div>`;
}

function renderCalloutSlide(section, theme) {
    const colors = { info: theme.primary, warning: theme.warning, success: theme.success, error: theme.danger, tip: theme.accent };
    const icons = { info: '\u2139\uFE0F', warning: '\u26A0\uFE0F', success: '\u2705', error: '\u274C', tip: '\uD83D\uDCA1' };
    const variant = section.variant || 'info';
    const color = colors[variant] || theme.primary;
    const icon = icons[variant] || '\u2139\uFE0F';
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;
        background:${theme.background}">
        <div style="max-width:800px;padding:48px;border-radius:16px;background:${theme.surface};border-left:6px solid ${color}">
            <div style="font-size:40px;margin-bottom:16px">${icon}</div>
            ${section.title ? `<h3 style="font-size:28px;color:${color};margin:0 0 16px 0">${esc(section.title)}</h3>` : ''}
            <p style="font-size:22px;line-height:1.6;color:${theme.textDark};margin:0">${esc(section.content || section.text)}</p>
        </div>
    </div>`;
}

function renderImageSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:40px;
        background:${theme.background}">
        ${section.title ? `<h2 style="font-size:36px;font-weight:700;color:${theme.primary};margin:0 0 24px 0">${esc(section.title)}</h2>` : ''}
        <div style="width:80%;height:60%;background:${theme.surface};border-radius:16px;display:flex;align-items:center;justify-content:center;
            font-size:18px;color:${theme.textSecondary}">
            ${section.src ? `<img src="${esc(section.src)}" style="max-width:100%;max-height:100%;border-radius:12px" />` : '[Image Placeholder]'}
        </div>
        ${section.caption ? `<p style="font-size:16px;color:${theme.textSecondary};margin-top:16px">${esc(section.caption)}</p>` : ''}
    </div>`;
}

function renderClosingSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;
        background:linear-gradient(135deg, ${theme.primaryDark} 0%, ${theme.primary} 50%, ${theme.accent} 100%);color:white;text-align:center;padding:80px">
        <h2 style="font-size:52px;font-weight:800;margin:0">${esc(section.text || section.title || 'Thank You')}</h2>
        ${section.subtitle ? `<p style="font-size:24px;opacity:0.85;margin-top:24px">${esc(section.subtitle)}</p>` : ''}
        ${section.contact ? `<p style="font-size:18px;opacity:0.6;margin-top:40px">${esc(section.contact)}</p>` : ''}
    </div>`;
}

function renderSectionBreakSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;align-items:center;
        background:${theme.surface};text-align:center;padding:80px">
        <div style="width:60px;height:4px;background:${theme.accent};border-radius:2px;margin-bottom:32px"></div>
        <h2 style="font-size:48px;font-weight:700;color:${theme.primary};margin:0">${esc(section.text || section.title)}</h2>
        ${section.subtitle ? `<p style="font-size:22px;color:${theme.textSecondary};margin-top:16px">${esc(section.subtitle)}</p>` : ''}
    </div>`;
}

function renderTwoColumnSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;padding:60px;background:${theme.background}">
        ${section.title ? `<h2 style="font-size:36px;font-weight:700;color:${theme.primary};margin:0 0 32px 0">${esc(section.title)}</h2>` : ''}
        <div style="display:flex;gap:40px">
            <div style="flex:1;font-size:22px;line-height:1.7;color:${theme.textDark}">${esc(section.left || '')}</div>
            <div style="width:2px;background:${theme.accent};opacity:0.3"></div>
            <div style="flex:1;font-size:22px;line-height:1.7;color:${theme.textDark}">${esc(section.right || '')}</div>
        </div>
    </div>`;
}

function renderGenericSlide(section, theme) {
    return `<div class="slide" style="display:flex;flex-direction:column;justify-content:center;padding:80px;background:${theme.background}">
        ${section.title ? `<h2 style="font-size:42px;font-weight:700;color:${theme.primary};margin:0 0 24px 0">${esc(section.title)}</h2>` : ''}
        <p style="font-size:24px;line-height:1.7;color:${theme.textDark}">${esc(section.content || section.text || JSON.stringify(section))}</p>
    </div>`;
}

// ─── Slide Router ────────────────────────────────────────────────────────────

const SLIDE_RENDERERS = {
    title: renderTitleSlide,
    cover: renderTitleSlide,
    heading: renderContentSlide,
    paragraph: renderContentSlide,
    content: renderContentSlide,
    bullets: renderBulletsSlide,
    'numbered-list': renderBulletsSlide,
    table: renderTableSlide,
    'metric-strip': renderMetricSlide,
    'stats-dashboard': renderMetricSlide,
    'info-card-grid': renderMetricSlide,
    quote: renderQuoteSlide,
    'pull-quote': renderQuoteSlide,
    callout: renderCalloutSlide,
    sidebar: renderCalloutSlide,
    image: renderImageSlide,
    diagram: renderImageSlide,
    chart: renderImageSlide,
    infographic: renderImageSlide,
    closing: renderClosingSlide,
    summary: renderClosingSlide,
    'section-break': renderSectionBreakSlide,
    'page-break': renderSectionBreakSlide,
    'two-column': renderTwoColumnSlide,
    comparison: renderTwoColumnSlide,
};

// ─── Transition CSS ──────────────────────────────────────────────────────────

const TRANSITIONS = {
    fade: {
        enter: 'animation: fadeIn 0.8s ease-out forwards',
        keyframes: '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }',
    },
    'slide-left': {
        enter: 'animation: slideLeft 0.6s ease-out forwards',
        keyframes: '@keyframes slideLeft { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }',
    },
    'slide-up': {
        enter: 'animation: slideUp 0.6s ease-out forwards',
        keyframes: '@keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }',
    },
    zoom: {
        enter: 'animation: zoomIn 0.7s ease-out forwards',
        keyframes: '@keyframes zoomIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }',
    },
    none: {
        enter: '',
        keyframes: '',
    },
};

// ─── Build Full HTML Page ────────────────────────────────────────────────────

function buildVideoHTML(slides, theme, transition, durationPerSlide) {
    const trans = TRANSITIONS[transition] || TRANSITIONS.fade;
    const totalDuration = slides.length * durationPerSlide;

    const slidesHtml = slides.map((html, i) => {
        const delay = i * durationPerSlide;
        const exitDelay = delay + durationPerSlide - 0.5;
        return `<div class="slide-wrapper" style="
            position:absolute;top:0;left:0;width:100%;height:100%;
            opacity:0;
            animation: slideShow${i} ${totalDuration}s linear forwards;
        ">${html}</div>
        <style>
            @keyframes slideShow${i} {
                ${((delay / totalDuration) * 100).toFixed(2)}% { opacity: 0; }
                ${(((delay + 0.5) / totalDuration) * 100).toFixed(2)}% { opacity: 1; }
                ${((exitDelay / totalDuration) * 100).toFixed(2)}% { opacity: 1; }
                ${(((exitDelay + 0.5) / totalDuration) * 100).toFixed(2)}% { opacity: 0; }
            }
        </style>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: 'Inter', system-ui, sans-serif; overflow: hidden; }
    .slide { width: 1920px; height: 1080px; position: relative; }
    .slide-wrapper { z-index: 1; }
    ${trans.keyframes}
</style>
</head>
<body style="width:1920px;height:1080px;position:relative;background:${theme.background}">
${slidesHtml}
</body>
</html>`;
}

// ─── Build Storyboard HTML (single slide per page) ───────────────────────────

function buildStoryboardSlideHTML(slideHtml, theme) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: 'Inter', system-ui, sans-serif; overflow: hidden; }
    .slide { width: 1920px; height: 1080px; }
</style>
</head>
<body style="width:1920px;height:1080px;background:${theme.background}">
${slideHtml}
</body>
</html>`;
}

// ─── Main Generator ──────────────────────────────────────────────────────────

/**
 * Generate a video (WebM) from document sections.
 *
 * @param {Object} options
 * @param {string} options.title - Video title (used for filename)
 * @param {Array}  options.sections - Array of section objects (same as PPTX/DOCX)
 * @param {string} [options.theme] - Theme name
 * @param {string} [options.transition] - Transition type: fade, slide-left, slide-up, zoom, none (default: fade)
 * @param {number} [options.durationPerSlide] - Seconds per slide (default: 4)
 * @param {boolean} [options.storyboard] - Also export individual slide PNGs (default: false)
 * @param {string} [options.format] - Output format: 'webm' (default) or 'mp4'
 * @param {string} [options.outputPath] - Custom output path
 * @returns {Promise<Object>} { success, filePath, fileName, slideCount, duration, fileSize, storyboardDir? }
 */
async function generateVideo(options) {
    const { title = 'Video', sections = [], theme: themeInput, transition = 'fade',
        durationPerSlide = 4, storyboard = false, format = 'mp4', outputPath } = options;

    if (!sections.length) {
        return { success: false, error: 'No sections provided' };
    }

    const theme = resolveTheme(themeInput);

    // Convert sections to slide HTML
    const slideHtmls = sections.map(section => {
        const renderer = SLIDE_RENDERERS[section.type] || renderGenericSlide;
        return renderer(section, theme);
    });

    const totalDuration = sections.length * durationPerSlide;
    const videoHtml = buildVideoHTML(slideHtmls, theme, transition, durationPerSlide);

    const browser = await getBrowser();
    const outDir = getOutputDir();
    const fileName = generateFileName(title, '.webm');
    const filePath = outputPath || path.join(outDir, fileName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Create context with video recording enabled
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        recordVideo: {
            dir: dir,
            size: { width: 1920, height: 1080 },
        },
    });

    const page = await context.newPage();

    try {
        // Load the animated HTML and let it play through
        await page.setContent(videoHtml, { waitUntil: 'networkidle' });

        // Wait for the full animation duration + buffer
        await page.waitForTimeout((totalDuration + 1) * 1000);

        // Close page to finalize video
        await page.close();
        await context.close();

        // Playwright saves video with auto-generated name; find and rename it
        const videoFiles = fs.readdirSync(dir).filter(f => f.endsWith('.webm')).sort((a, b) => {
            return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs;
        });

        if (videoFiles.length > 0) {
            const latestVideo = path.join(dir, videoFiles[0]);
            if (latestVideo !== filePath) {
                fs.renameSync(latestVideo, filePath);
            }
        }

        // Storyboard: render individual slides as PNGs
        let storyboardDir = null;
        if (storyboard) {
            storyboardDir = filePath.replace('.webm', '-storyboard');
            if (!fs.existsSync(storyboardDir)) fs.mkdirSync(storyboardDir, { recursive: true });

            const sbContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
            const sbPage = await sbContext.newPage();

            for (let i = 0; i < slideHtmls.length; i++) {
                const slideHtml = buildStoryboardSlideHTML(slideHtmls[i], theme);
                await sbPage.setContent(slideHtml, { waitUntil: 'networkidle' });
                const pngPath = path.join(storyboardDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
                await sbPage.screenshot({ path: pngPath, type: 'png' });
            }

            await sbPage.close();
            await sbContext.close();
        }

        // ─── MP4 Conversion (if requested) ─────────────────────────────────
        let finalPath = filePath;
        if (format === 'mp4') {
            const mp4Path = filePath.replace(/\.webm$/i, '.mp4');
            try {
                await convertToMp4(filePath, mp4Path);
                // Remove intermediate WebM after successful conversion
                if (fs.existsSync(mp4Path) && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                finalPath = mp4Path;
            } catch (convErr) {
                // Keep WebM as fallback if MP4 conversion fails
                console.warn(`MP4 conversion failed, keeping WebM: ${convErr.message}`);
            }
        }

        const stats = fs.existsSync(finalPath) ? fs.statSync(finalPath) : null;
        const fileSize = stats ? stats.size : 0;

        return {
            success: true,
            filePath: finalPath,
            fileName: path.basename(finalPath),
            slideCount: sections.length,
            duration: `${totalDuration}s`,
            transition,
            durationPerSlide,
            fileSize,
            fileSizeHuman: fileSize < 1024 ? `${fileSize} B` : fileSize < 1048576 ? `${(fileSize / 1024).toFixed(1)} KB` : `${(fileSize / 1048576).toFixed(1)} MB`,
            ...(storyboardDir ? { storyboardDir, storyboardSlides: slideHtmls.length } : {}),
        };
    } catch (error) {
        try { await page.close(); } catch (_) { }
        try { await context.close(); } catch (_) { }
        return { success: false, error: `Video generation failed: ${error.message}` };
    }
}

module.exports = { generateVideo, cleanupBrowser, convertToMp4, SLIDE_RENDERERS, TRANSITIONS };
