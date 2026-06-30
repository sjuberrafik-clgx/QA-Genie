/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOM HTML GENERATOR — Bespoke, Agent-Authored HTML Artifacts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Unlike html-report-generator.js (schema-driven: the agent picks section types and a
 * fixed renderer decides every visual), this writer gives the agent FULL creative
 * control. The agent authors the entire HTML document — markup, CSS, and JavaScript —
 * exactly the way VS Code Copilot Chat produces hand-crafted, single-file web pages.
 *
 * The output is a self-contained .html file written to the standard documents output
 * directory, so it is auto-attached in chat via the generated-artifact policy.
 *
 * @module scripts/custom-html-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { getOutputDir, generateFileName } = require('./doc-design-system');

/**
 * Detect whether the supplied string is already a complete HTML document.
 * @param {string} html
 * @returns {boolean}
 */
function isFullDocument(html) {
    const head = String(html || '').slice(0, 600).toLowerCase();
    return head.includes('<!doctype') || head.includes('<html');
}

/**
 * Wrap a body-only fragment in a minimal, unopinionated HTML shell. This is a
 * fallback only — the agent is expected to author a full document for full control.
 * @param {string} fragment
 * @param {string} title
 * @returns {string}
 */
function wrapFragment(fragment, title) {
    const safeTitle = String(title || 'Document').replace(/[<>]/g, '');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
</head>
<body>
${fragment}
</body>
</html>`;
}

/**
 * Persist an agent-authored HTML document to disk.
 *
 * @param {Object} options
 * @param {string} options.title - Document title (drives the output filename).
 * @param {string} options.html - The COMPLETE HTML document authored by the agent.
 * @param {string} [options.filename] - Optional base filename (without extension).
 * @param {string} [options.outputPath] - Optional explicit output path.
 * @returns {Promise<Object>} { success, filePath, fileName, fileSize, fileSizeHuman }
 */
async function generateCustomHtml(options = {}) {
    const { title, html, filename, outputPath } = options;

    if (!html || typeof html !== 'string' || !html.trim()) {
        return {
            success: false,
            error: 'No HTML content provided. Author a complete, self-contained <!DOCTYPE html> document in the "html" parameter.',
        };
    }

    const document = isFullDocument(html) ? html : wrapFragment(html, title);

    const baseName = filename
        ? String(filename).replace(/\.html?$/i, '')
        : (title || 'Document');
    const fileName = generateFileName(baseName, '.html');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, document, 'utf8');

    const byteLength = Buffer.byteLength(document, 'utf8');
    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        fileSize: byteLength,
        fileSizeHuman: `${(byteLength / 1024).toFixed(1)} KB`,
        wrappedFragment: !isFullDocument(html),
    };
}

module.exports = { generateCustomHtml, isFullDocument };
