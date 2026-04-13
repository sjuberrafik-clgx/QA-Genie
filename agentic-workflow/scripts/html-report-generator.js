/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HTML REPORT GENERATOR — Interactive Single-File HTML Reports
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates self-contained HTML reports with:
 *   - Embedded CSS (no CDN dependency for styles)
 *   - Interactive Chart.js charts (CDN for runtime interactivity)
 *   - Collapsible sections
 *   - Dark/light mode toggle
 *   - Print-optimized CSS
 *   - Navigation sidebar
 *   - Search functionality
 *   - Responsive design
 *
 * Supported section types (18 total):
 *   heading, paragraph, bullets, numbered-list, table,
 *   code-block, callout, page-break, two-column,
 *   cover, pull-quote, sidebar, metric-strip, info-card-grid,
 *   chart, diagram, infographic
 *
 * @module scripts/html-report-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { resolveTheme, TYPOGRAPHY, getOutputDir, generateFileName } = require('./doc-design-system');
const { renderForHybridOutput, cleanupBrowser } = require('./shared/diagram-engine');

// ─── HTML Section Renderers ─────────────────────────────────────────────────

function esc(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toBase64DataUri(content, mimeType) {
    return `data:${mimeType};base64,${Buffer.from(String(content || ''), 'utf8').toString('base64')}`;
}

function renderCover(section) {
    const title = esc(section.title || section.text || 'Document');
    const subtitle = section.subtitle ? `<p class="text-xl text-secondary mt-4">${esc(section.subtitle)}</p>` : '';
    const meta = [];
    if (section.author) meta.push(esc(section.author));
    if (section.date) meta.push(esc(section.date));
    else meta.push(new Date().toLocaleDateString());
    if (section.version) meta.push(`v${esc(section.version)}`);
    const metaLine = meta.length ? `<p class="text-sm text-secondary mt-8">${meta.join('  |  ')}</p>` : '';

    return `<section class="cover-page flex flex-col items-center justify-center min-h-[60vh] text-center border-b-4 border-primary mb-8 pb-8">
    <div class="w-16 h-1 bg-primary mb-8"></div>
    <h1 class="text-5xl font-bold text-primary">${title}</h1>
    ${subtitle}${metaLine}
</section>`;
}

function renderHeading(section) {
    const level = Math.min(Math.max(section.level || 1, 1), 6);
    const text = esc(section.text || section.content || '');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const sizes = { 1: 'text-3xl', 2: 'text-2xl', 3: 'text-xl', 4: 'text-lg', 5: 'text-base', 6: 'text-sm' };
    const topClass = level === 1 ? 'mt-10 border-b border-border pb-2' : 'mt-6';
    return `<h${level} id="${id}" class="${sizes[level]} font-bold text-primary ${topClass} mb-3 nav-heading" data-level="${level}">${text}</h${level}>`;
}

function renderParagraph(section) {
    return `<p class="text-body leading-relaxed mb-4">${esc(section.text || section.content || '')}</p>`;
}

function renderBullets(section) {
    const items = Array.isArray(section.items) ? section.items : (Array.isArray(section.bullets) ? section.bullets : []);
    const lis = items.map(i => `    <li class="mb-1">${esc(typeof i === 'string' ? i : i.text || '')}</li>`).join('\n');
    return `<ul class="list-disc list-inside mb-4 text-body space-y-1">\n${lis}\n</ul>`;
}

function renderNumberedList(section) {
    const items = Array.isArray(section.items) ? section.items : [];
    const lis = items.map(i => `    <li class="mb-1">${esc(typeof i === 'string' ? i : i.text || '')}</li>`).join('\n');
    return `<ol class="list-decimal list-inside mb-4 text-body space-y-1">\n${lis}\n</ol>`;
}

function renderTable(section) {
    const headers = section.headers || [];
    const rows = section.rows || [];
    const title = section.title ? `<h4 class="text-lg font-semibold mb-2">${esc(section.title)}</h4>` : '';
    const ths = headers.map(h => `<th class="px-4 py-2 text-left text-sm font-semibold text-on-primary bg-primary">${esc(h)}</th>`).join('');
    const trs = rows.map((row, ri) => {
        const cells = (Array.isArray(row) ? row : Object.values(row)).map(c => `<td class="px-4 py-2 text-sm">${esc(c)}</td>`).join('');
        return `<tr class="${ri % 2 === 0 ? 'bg-surface' : ''}">${cells}</tr>`;
    }).join('\n');

    return `${title}<div class="overflow-x-auto mb-4"><table class="w-full border-collapse border border-border rounded">
    <thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody>
</table></div>`;
}

function renderCodeBlock(section) {
    const code = esc(section.code || section.content || '');
    const lang = section.language ? `<div class="text-xs text-secondary uppercase mb-1">${esc(section.language)}</div>` : '';
    return `<div class="mb-4">${lang}<pre class="bg-surface rounded-lg p-4 overflow-x-auto text-sm font-mono border border-border"><code>${code}</code></pre></div>`;
}

function renderCallout(section) {
    const text = esc(section.text || section.content || '');
    const type = section.calloutType || 'info';
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '❌' };
    const colors = { info: 'border-primary bg-primary/5', success: 'border-green-500 bg-green-500/5', warning: 'border-yellow-500 bg-yellow-500/5', danger: 'border-red-500 bg-red-500/5' };
    return `<div class="mb-4 p-4 rounded-lg border-l-4 ${colors[type] || colors.info}">
    <span class="mr-2">${icons[type] || icons.info}</span>${text}
</div>`;
}

function renderPageBreak() {
    return '<div class="page-break border-t border-border my-8"></div>';
}

function renderTwoColumn(section) {
    const left = esc(section.leftContent || section.left || '');
    const right = esc(section.rightContent || section.right || '');
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
    <div class="text-body">${left}</div>
    <div class="text-body">${right}</div>
</div>`;
}

function renderPullQuote(section) {
    const text = esc(section.text || section.content || '');
    const attribution = section.attribution || section.author || '';
    const attr = attribution ? `<p class="text-right text-sm text-secondary mt-2">&mdash; ${esc(attribution)}</p>` : '';
    return `<blockquote class="border-l-4 border-primary pl-6 pr-4 py-3 my-6 italic text-xl text-primary bg-primary/5 rounded-r-lg">
    <p>&ldquo;${text}&rdquo;</p>${attr}
</blockquote>`;
}

function renderSidebarSection(section) {
    const text = esc(section.text || section.content || '');
    const title = section.title ? `<h4 class="font-bold text-primary mb-2">${esc(section.title)}</h4>` : '';
    return `<div class="bg-primary/5 border-l-4 border-primary rounded-r-lg p-4 mb-4">
    ${title}<p class="text-body">${text}</p>
</div>`;
}

function renderMetricStrip(section) {
    const metrics = section.metrics || [];
    const cards = metrics.map(m => {
        const statusColors = { good: 'text-green-600', warning: 'text-yellow-600', critical: 'text-red-600' };
        const statusBorders = { good: 'border-green-500', warning: 'border-yellow-500', critical: 'border-red-500' };
        const sc = statusColors[m.status] || 'text-primary';
        const sb = statusBorders[m.status] || 'border-primary';
        const change = m.change ? `<div class="text-xs ${sc}">${esc(m.change)}</div>` : '';
        return `<div class="bg-surface rounded-lg p-4 text-center border-t-4 ${sb}">
            <div class="text-2xl font-bold text-primary">${esc(m.value)}</div>
            <div class="text-sm text-secondary mt-1">${esc(m.label)}</div>
            ${change}
        </div>`;
    }).join('\n');
    return `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">${cards}</div>`;
}

function renderInfoCardGrid(section) {
    const cards = section.cards || section.items || [];
    const html = cards.map(card => {
        const icon = card.icon ? `<div class="text-3xl mb-2">${esc(card.icon)}</div>` : '';
        const title = card.title ? `<h4 class="font-bold text-primary mb-1">${esc(card.title)}</h4>` : '';
        const desc = card.description || card.text || '';
        return `<div class="bg-surface rounded-lg p-4 border border-border">
            ${icon}${title}
            <p class="text-sm text-secondary">${esc(desc)}</p>
        </div>`;
    }).join('\n');
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">${html}</div>`;
}

function renderChart(section, chartIndex) {
    const cd = section.chartData || {};
    const chartType = cd.type || section.chartType || 'bar';
    const datasets = (cd.datasets || cd.data || []).map((ds, i) => ({
        label: ds.name || ds.label || `Series ${i + 1}`,
        data: ds.values || ds.data || [],
    }));
    const labels = cd.labels || [];
    const chartId = `chart-${chartIndex}`;
    const title = section.title ? `<h4 class="text-lg font-semibold mb-2">${esc(section.title)}</h4>` : '';

    const config = JSON.stringify({
        type: chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'bottom' } },
        },
    });

    return `${title}<div class="mb-6 bg-surface rounded-lg p-4 border border-border">
    <canvas id="${chartId}" height="250"></canvas>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            new Chart(document.getElementById('${chartId}'), ${config});
        });
    </script>
</div>`;
}

async function renderDiagram(section, theme, diagramIndex) {
    const mermaidCode = section.mermaidCode || section.code || '';
    if (!mermaidCode) return '<p class="text-secondary italic">[Diagram: No Mermaid code provided]</p>';

    const title = section.title ? `<h4 class="text-lg font-semibold mb-2">${esc(section.title)}</h4>` : '';
    const caption = section.caption ? `<p class="diagram-caption text-sm text-secondary mt-3">${esc(section.caption)}</p>` : '';
    const themeName = section.theme || theme?._name || 'modern-blue';
    const outputName = section.outputName || `html-diagram-${diagramIndex}`;

    let fallbackMarkup = '<p class="text-secondary italic">[Diagram fallback unavailable]</p>';
    const renderResult = await renderForHybridOutput({
        mermaidCode,
        theme: themeName,
        outputName,
    });

    if (renderResult.success && renderResult.svgContent) {
        const svgDataUri = toBase64DataUri(renderResult.svgContent, 'image/svg+xml');
        fallbackMarkup = `<img src="${svgDataUri}" alt="${esc(section.title || 'Mermaid diagram')}" loading="lazy" />`;
    }

    const liveCode = mermaidCode.replace(/<\/script/gi, '<\\/script');

    return `${title}<section class="diagram-block mb-6" data-diagram-block="true">
    <div class="diagram-fallback" data-diagram-fallback="true">${fallbackMarkup}</div>
    <div class="diagram-live" data-diagram-live="true">
        <div class="mermaid">${liveCode}</div>
    </div>
    ${caption}
</section>`;
}

function renderInfographicPlaceholder(section) {
    const type = section.infographicType || section.componentType || 'stat-poster';
    return `<div class="bg-surface border border-border rounded-lg p-6 mb-4 text-center text-secondary italic">
    [Infographic: ${esc(type)} — rendered as image in other formats]
</div>`;
}

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
    cover: renderCover,
    'pull-quote': renderPullQuote,
    sidebar: renderSidebarSection,
    'metric-strip': renderMetricStrip,
    'info-card-grid': renderInfoCardGrid,
    chart: renderChart,
    diagram: renderDiagram,
    infographic: renderInfographicPlaceholder,
};

// ─── CSS Generator ──────────────────────────────────────────────────────────

function generateCSS(theme) {
    return `
:root {
    --primary: ${theme.primary};
    --primary-dark: ${theme.primaryDark || theme.primary};
    --primary-light: ${theme.primaryLight || '#E3F0FF'};
    --accent: ${theme.accent || theme.primary};
    --bg: ${theme.background || '#FFFFFF'};
    --surface: ${theme.surface || '#F8F9FA'};
    --text: ${theme.text || '#212529'};
    --text-secondary: ${theme.textSecondary || '#6C757D'};
    --text-on-primary: ${theme.textOnPrimary || '#FFFFFF'};
    --border: ${theme.border || '#DEE2E6'};
    --success: ${theme.success || '#28A745'};
    --warning: ${theme.warning || '#FFC107'};
    --danger: ${theme.danger || '#DC3545'};
    --font: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

[data-theme="dark"] {
    --bg: #1a1a2e;
    --surface: #16213e;
    --text: #e0e0e0;
    --text-secondary: #a0a0a0;
    --border: #2a2a4a;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    transition: background 0.3s, color 0.3s;
}

/* Layout */
.app-container { display: flex; min-height: 100vh; }
.sidebar-nav {
    width: 260px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 1.5rem 1rem;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    overflow-y: auto;
    z-index: 50;
    transition: transform 0.3s;
}
.sidebar-nav.hidden { transform: translateX(-100%); }
.main-content {
    flex: 1;
    margin-left: 260px;
    padding: 2rem 3rem;
    max-width: 900px;
    transition: margin-left 0.3s;
}
.main-content.full { margin-left: 0; max-width: 100%; }

/* Top bar */
.top-bar {
    position: fixed;
    top: 0;
    right: 0;
    left: 260px;
    height: 50px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 1.5rem;
    gap: 0.75rem;
    z-index: 40;
    transition: left 0.3s;
}
.top-bar.full { left: 0; }

.main-content { padding-top: 70px; }

/* Sidebar nav items */
.nav-list { list-style: none; }
.nav-list a {
    display: block;
    padding: 0.35rem 0.5rem;
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.85rem;
    border-radius: 4px;
    transition: background 0.2s, color 0.2s;
}
.nav-list a:hover { background: var(--primary-light); color: var(--primary); }
.nav-list .level-2 { padding-left: 1.25rem; font-size: 0.8rem; }
.nav-list .level-3 { padding-left: 2rem; font-size: 0.75rem; }

/* Search */
.search-input {
    width: 100%;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
    outline: none;
    transition: border 0.2s;
}
.search-input:focus { border-color: var(--primary); }
.search-highlight { background: rgba(255, 200, 0, 0.3); border-radius: 2px; }

/* Buttons */
.icon-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    color: var(--text);
    font-size: 0.9rem;
    transition: background 0.2s;
}
.icon-btn:hover { background: var(--surface); }

.diagram-block {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 14px;
    padding: 1rem;
}

.diagram-fallback,
.diagram-live {
    width: 100%;
}

.diagram-fallback {
    display: block;
}

.diagram-fallback img {
    width: 100%;
    height: auto;
    display: block;
}

.diagram-live {
    display: none;
}

.diagram-block.diagram-rendered .diagram-live {
    display: block;
}

.diagram-block.diagram-rendered .diagram-fallback {
    display: none;
}

.diagram-caption {
    text-align: center;
}

/* Utilities for content rendering */
.text-body { color: var(--text); }
.text-primary { color: var(--primary); }
.text-secondary { color: var(--text-secondary); }
.text-on-primary { color: var(--text-on-primary); }
.bg-primary { background-color: var(--primary); }
.bg-surface { background-color: var(--surface); }
.border-primary { border-color: var(--primary); }
.border-border { border-color: var(--border); }

.bg-primary\\/5 { background-color: color-mix(in srgb, var(--primary) 5%, transparent); }

/* Collapsible */
.collapsible-toggle { cursor: pointer; user-select: none; }
.collapsible-toggle::before { content: '▸ '; transition: transform 0.2s; display: inline-block; }
.collapsible-toggle.open::before { content: '▾ '; }
.collapsible-content { overflow: hidden; transition: max-height 0.3s ease; }
.collapsible-content.collapsed { max-height: 0 !important; }

/* Cover page */
.cover-page { border-bottom-color: var(--primary); }

/* Print */
@media print {
    .sidebar-nav, .top-bar { display: none !important; }
    .main-content { margin-left: 0 !important; padding: 1rem !important; max-width: 100% !important; padding-top: 1rem !important; }
    .page-break { page-break-before: always; }
    .collapsible-content { max-height: none !important; }
    body { background: #fff; color: #000; }
}

@media (max-width: 768px) {
    .sidebar-nav { transform: translateX(-100%); }
    .sidebar-nav.visible { transform: translateX(0); }
    .main-content { margin-left: 0; padding: 1rem; }
    .top-bar { left: 0; }
}
`;
}

// ─── JavaScript Generator ───────────────────────────────────────────────────

function generateJS() {
    return `
(function() {
    // Dark/light toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            const root = document.documentElement;
            const isDark = root.getAttribute('data-theme') === 'dark';
            root.setAttribute('data-theme', isDark ? 'light' : 'dark');
            themeBtn.textContent = isDark ? '🌙' : '☀️';
        });
    }

    // Sidebar toggle
    const sidebarBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const topBar = document.getElementById('top-bar');
    if (sidebarBtn && sidebar) {
        sidebarBtn.addEventListener('click', function() {
            sidebar.classList.toggle('hidden');
            mainContent.classList.toggle('full');
            topBar.classList.toggle('full');
        });
    }

    // Build nav from headings
    const navList = document.getElementById('nav-list');
    const headings = document.querySelectorAll('.nav-heading');
    if (navList && headings.length) {
        headings.forEach(function(h) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#' + h.id;
            a.textContent = h.textContent;
            a.className = 'level-' + h.getAttribute('data-level');
            a.addEventListener('click', function(e) {
                e.preventDefault();
                h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            li.appendChild(a);
            navList.appendChild(li);
        });
    }

    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const query = this.value.trim().toLowerCase();
            // Remove old highlights
            document.querySelectorAll('.search-highlight').forEach(function(el) {
                const parent = el.parentNode;
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            });
            if (!query || query.length < 2) return;
            // Search in main content
            const walker = document.createTreeWalker(
                document.getElementById('main-content'),
                NodeFilter.SHOW_TEXT, null
            );
            const matches = [];
            while (walker.nextNode()) {
                if (walker.currentNode.textContent.toLowerCase().includes(query)) {
                    matches.push(walker.currentNode);
                }
            }
            // Highlight first 50 matches
            matches.slice(0, 50).forEach(function(node) {
                const text = node.textContent;
                const idx = text.toLowerCase().indexOf(query);
                if (idx === -1) return;
                const before = document.createTextNode(text.substring(0, idx));
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.textContent = text.substring(idx, idx + query.length);
                const after = document.createTextNode(text.substring(idx + query.length));
                const parent = node.parentNode;
                parent.insertBefore(before, node);
                parent.insertBefore(mark, node);
                parent.insertBefore(after, node);
                parent.removeChild(node);
            });
            // Scroll to first
            const first = document.querySelector('.search-highlight');
            if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // Collapsible sections
    document.querySelectorAll('.collapsible-toggle').forEach(function(toggle) {
        toggle.addEventListener('click', function() {
            this.classList.toggle('open');
            const content = this.nextElementSibling;
            if (content && content.classList.contains('collapsible-content')) {
                content.classList.toggle('collapsed');
            }
        });
    });
})();
`;
}

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a self-contained interactive HTML report.
 *
 * @param {Object} options
 * @param {string} options.title - Report title
 * @param {string} [options.author] - Author name
 * @param {Array}  options.sections - Array of section definitions
 * @param {string|Object} [options.theme] - Theme name or override
 * @param {string} [options.outputPath] - Custom output path
 * @param {boolean} [options.darkMode] - Start in dark mode
 * @param {boolean} [options.collapsible] - Make h1 sections collapsible
 * @returns {Promise<Object>} { success, filePath, fileName, sectionCount, fileSize }
 */
async function generateHtmlReport(options) {
    const { title, author, sections = [], theme: themeInput, outputPath, darkMode, collapsible } = options;

    if (!sections.length) {
        return { success: false, error: 'No sections provided' };
    }

    const theme = resolveTheme(themeInput);

    // Render sections
    let chartIndex = 0;
    const hasMermaid = sections.some(s => s.type === 'diagram');
    const hasChart = sections.some(s => s.type === 'chart');

    let bodyHtml = '';
    let inCollapsible = false;

    try {
        for (const section of sections) {
            // Collapsible wrapping for h1 sections
            if (collapsible && section.type === 'heading' && section.level === 1) {
                if (inCollapsible) bodyHtml += '</div>\n';
                const renderer = SECTION_RENDERERS[section.type];
                const headingHtml = renderer ? renderer(section) : '';
                bodyHtml += headingHtml.replace(/class="([^"]*)"/, 'class="$1 collapsible-toggle"');
                bodyHtml += '<div class="collapsible-content">\n';
                inCollapsible = true;
                continue;
            }

            const renderer = SECTION_RENDERERS[section.type];
            if (renderer) {
                let renderedSection;
                if (section.type === 'chart') {
                    renderedSection = renderer(section, chartIndex++);
                } else if (section.type === 'diagram') {
                    renderedSection = renderer(section, theme, chartIndex++);
                } else {
                    renderedSection = renderer(section);
                }

                bodyHtml += (renderedSection && typeof renderedSection.then === 'function')
                    ? await renderedSection
                    : renderedSection;
            } else {
                bodyHtml += `<p class="text-secondary italic mb-4">[Unknown section type: ${esc(section.type)}]</p>`;
            }
            bodyHtml += '\n';
        }
    } finally {
        if (hasMermaid) {
            await cleanupBrowser().catch(() => { });
        }
    }

    if (inCollapsible) bodyHtml += '</div>\n';

    // Assemble full HTML
    const css = generateCSS(theme);
    const js = generateJS();
    const themeAttr = darkMode ? ' data-theme="dark"' : '';
    const now = new Date().toISOString();

    const html = `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title || 'Report')}</title>
    <meta name="author" content="${esc(author || 'DocGenie')}">
    <meta name="generator" content="DocGenie HTML Report Generator">
    <meta name="date" content="${now}">
    <style>${css}</style>
    ${hasChart ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>' : ''}
    ${hasMermaid ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>' : ''}
</head>
<body>
    <nav class="sidebar-nav" id="sidebar">
        <h3 class="text-sm font-bold text-secondary uppercase tracking-wide mb-3">Navigation</h3>
        <ul class="nav-list" id="nav-list"></ul>
    </nav>

    <div class="top-bar" id="top-bar">
        <button class="icon-btn" id="sidebar-toggle" title="Toggle sidebar">☰</button>
        <input type="text" class="search-input" id="search-input" placeholder="Search..." />
        <button class="icon-btn" id="theme-toggle" title="Toggle dark/light mode">${darkMode ? '☀️' : '🌙'}</button>
        <button class="icon-btn" onclick="window.print()" title="Print / Export PDF">🖨️</button>
    </div>

    <main class="main-content" id="main-content">
${bodyHtml}
        <footer class="mt-12 pt-4 border-t border-border text-sm text-secondary text-center">
            Generated by DocGenie &mdash; ${esc(author || 'Doremon Team')} &mdash; ${new Date().toLocaleDateString()}
        </footer>
    </main>

    ${hasMermaid ? `<script>
        document.addEventListener('DOMContentLoaded', async function() {
            if (!window.mermaid) return;

            const blocks = Array.from(document.querySelectorAll('[data-diagram-block="true"]'));
            if (!blocks.length) return;

            try {
                mermaid.initialize({ startOnLoad: false, theme: "default" });
                await mermaid.run({ querySelector: '.diagram-live .mermaid' });

                blocks.forEach(function(block) {
                    if (block.querySelector('.diagram-live svg')) {
                        block.classList.add('diagram-rendered');
                    }
                });
            } catch (error) {
                console.warn('Mermaid runtime unavailable, using fallback diagrams.', error);
            }
        });
    </script>` : ''}
    <script>${js}</script>
</body>
</html>`;

    // Write file
    const fileName = generateFileName(title || 'Report', '.html');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, html, 'utf8');

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        sectionCount: sections.length,
        fileSize: html.length,
        fileSizeHuman: `${(html.length / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generateHtmlReport, SECTION_RENDERERS };
