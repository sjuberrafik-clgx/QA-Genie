/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXCEL REPORT GENERATOR — Context-Driven Excel/Spreadsheet Generation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates professional Excel workbooks from a flexible sheets array.
 * This is SEPARATE from TestGenie's test-case Excel (excel-template-generator.js).
 *
 * Supported sheet content types:
 *   data-table, summary-card, chart-data, key-value, matrix
 *
 * @module scripts/excel-report-generator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { resolveTheme, TYPOGRAPHY, getOutputDir, generateFileName, hexToARGB } = require('./doc-design-system');

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_COL_WIDTH = 20;
const HEADER_ROW_HEIGHT = 30;
const DATA_ROW_HEIGHT = 22;
const TITLE_ROW_HEIGHT = 40;

// ─── Sheet Renderers ────────────────────────────────────────────────────────

function renderDataTable(ws, content, theme, fontName) {
    const headers = content.headers || [];
    const rows = content.rows || [];
    const title = content.title || '';

    let rowIndex = 1;

    // Title row
    if (title) {
        ws.mergeCells(rowIndex, 1, rowIndex, Math.max(headers.length, 1));
        const titleCell = ws.getCell(rowIndex, 1);
        titleCell.value = title;
        titleCell.font = { name: fontName, size: 14, bold: true, color: { argb: hexToARGB(theme.primary) } };
        titleCell.alignment = { vertical: 'middle' };
        ws.getRow(rowIndex).height = TITLE_ROW_HEIGHT;
        rowIndex += 2; // blank spacer row
    }

    // Headers
    if (headers.length) {
        for (let ci = 0; ci < headers.length; ci++) {
            const cell = ws.getCell(rowIndex, ci + 1);
            cell.value = headers[ci];
            cell.font = { name: fontName, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.primary) } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thinBorder(theme);
            ws.getColumn(ci + 1).width = content.columnWidths ? content.columnWidths[ci] || DEFAULT_COL_WIDTH : DEFAULT_COL_WIDTH;
        }
        ws.getRow(rowIndex).height = HEADER_ROW_HEIGHT;
        rowIndex++;
    }

    // Data rows
    for (let ri = 0; ri < rows.length; ri++) {
        const rowData = Array.isArray(rows[ri]) ? rows[ri] : Object.values(rows[ri]);
        for (let ci = 0; ci < rowData.length; ci++) {
            const cell = ws.getCell(rowIndex, ci + 1);
            cell.value = rowData[ci] ?? '';
            cell.font = { name: fontName, size: 10 };
            cell.alignment = { vertical: 'middle', wrapText: true };
            cell.border = thinBorder(theme);

            // Alternating row fill
            if (ri % 2 === 0) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.surface) } };
            }
        }
        ws.getRow(rowIndex).height = DATA_ROW_HEIGHT;
        rowIndex++;
    }

    // Auto-filter on header
    if (headers.length && rows.length) {
        const headerRow = title ? 3 : 1;
        ws.autoFilter = {
            from: { row: headerRow, column: 1 },
            to: { row: headerRow + rows.length, column: headers.length },
        };
    }

    return rowIndex;
}

function renderSummaryCard(ws, content, theme, fontName) {
    const title = content.title || 'Summary';
    const metrics = content.metrics || [];

    let rowIndex = 1;

    // Title
    ws.mergeCells(rowIndex, 1, rowIndex, 3);
    const titleCell = ws.getCell(rowIndex, 1);
    titleCell.value = title;
    titleCell.font = { name: fontName, size: 14, bold: true, color: { argb: hexToARGB(theme.primary) } };
    ws.getRow(rowIndex).height = TITLE_ROW_HEIGHT;
    rowIndex += 2;

    // Metric cards (label | value | change)
    for (const metric of metrics) {
        const labelCell = ws.getCell(rowIndex, 1);
        labelCell.value = metric.label || '';
        labelCell.font = { name: fontName, size: 11, bold: true };
        labelCell.alignment = { vertical: 'middle' };

        const valueCell = ws.getCell(rowIndex, 2);
        valueCell.value = metric.value ?? '';
        valueCell.font = { name: fontName, size: 14, bold: true, color: { argb: hexToARGB(theme.primary) } };
        valueCell.alignment = { horizontal: 'center', vertical: 'middle' };

        if (metric.change !== undefined) {
            const changeCell = ws.getCell(rowIndex, 3);
            const isPositive = String(metric.change).startsWith('+') || Number(metric.change) > 0;
            changeCell.value = metric.change;
            changeCell.font = {
                name: fontName, size: 10,
                color: { argb: hexToARGB(isPositive ? theme.success : theme.danger) },
            };
            changeCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        ws.getRow(rowIndex).height = 28;
        rowIndex++;
    }

    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 20;
    ws.getColumn(3).width = 15;

    return rowIndex;
}

function renderKeyValue(ws, content, theme, fontName) {
    const title = content.title || '';
    const pairs = content.pairs || content.data || [];

    let rowIndex = 1;

    if (title) {
        ws.mergeCells(rowIndex, 1, rowIndex, 2);
        const titleCell = ws.getCell(rowIndex, 1);
        titleCell.value = title;
        titleCell.font = { name: fontName, size: 14, bold: true, color: { argb: hexToARGB(theme.primary) } };
        ws.getRow(rowIndex).height = TITLE_ROW_HEIGHT;
        rowIndex += 2;
    }

    for (const pair of pairs) {
        const keyCell = ws.getCell(rowIndex, 1);
        keyCell.value = pair.key || pair.label || '';
        keyCell.font = { name: fontName, size: 11, bold: true };
        keyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.surface) } };
        keyCell.border = thinBorder(theme);

        const valCell = ws.getCell(rowIndex, 2);
        valCell.value = pair.value ?? '';
        valCell.font = { name: fontName, size: 11 };
        valCell.alignment = { wrapText: true };
        valCell.border = thinBorder(theme);

        ws.getRow(rowIndex).height = DATA_ROW_HEIGHT;
        rowIndex++;
    }

    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 45;

    return rowIndex;
}

function renderMatrix(ws, content, theme, fontName) {
    const title = content.title || '';
    const rowHeaders = content.rowHeaders || [];
    const colHeaders = content.colHeaders || [];
    const matrix = content.matrix || content.data || [];

    let rowIndex = 1;

    if (title) {
        ws.mergeCells(rowIndex, 1, rowIndex, colHeaders.length + 1);
        const titleCell = ws.getCell(rowIndex, 1);
        titleCell.value = title;
        titleCell.font = { name: fontName, size: 14, bold: true, color: { argb: hexToARGB(theme.primary) } };
        ws.getRow(rowIndex).height = TITLE_ROW_HEIGHT;
        rowIndex += 2;
    }

    // Column headers (offset by 1 for row header column)
    const cornerCell = ws.getCell(rowIndex, 1);
    cornerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.primary) } };
    cornerCell.border = thinBorder(theme);

    for (let ci = 0; ci < colHeaders.length; ci++) {
        const cell = ws.getCell(rowIndex, ci + 2);
        cell.value = colHeaders[ci];
        cell.font = { name: fontName, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.primary) } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder(theme);
        ws.getColumn(ci + 2).width = 18;
    }
    ws.getRow(rowIndex).height = HEADER_ROW_HEIGHT;
    ws.getColumn(1).width = 25;
    rowIndex++;

    // Data rows with row headers
    for (let ri = 0; ri < matrix.length; ri++) {
        // Row header
        const rhCell = ws.getCell(rowIndex, 1);
        rhCell.value = rowHeaders[ri] || '';
        rhCell.font = { name: fontName, size: 11, bold: true };
        rhCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.surface) } };
        rhCell.border = thinBorder(theme);

        // Data cells
        const rowData = Array.isArray(matrix[ri]) ? matrix[ri] : Object.values(matrix[ri]);
        for (let ci = 0; ci < rowData.length; ci++) {
            const cell = ws.getCell(rowIndex, ci + 2);
            cell.value = rowData[ci] ?? '';
            cell.font = { name: fontName, size: 10 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thinBorder(theme);

            if (ri % 2 === 0) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(theme.surface) } };
            }
        }

        ws.getRow(rowIndex).height = DATA_ROW_HEIGHT;
        rowIndex++;
    }

    return rowIndex;
}

function renderChartData(ws, content, theme, fontName) {
    // Render chart-ready data as a table (Excel charts are complex; we provide formatted data)
    return renderDataTable(ws, {
        title: content.title || 'Chart Data',
        headers: content.headers || content.labels || [],
        rows: content.rows || content.series || [],
        columnWidths: content.columnWidths,
    }, theme, fontName);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function thinBorder(theme) {
    const color = { argb: hexToARGB(theme.border || '#E5E7EB') };
    return {
        top: { style: 'thin', color },
        bottom: { style: 'thin', color },
        left: { style: 'thin', color },
        right: { style: 'thin', color },
    };
}

// ─── Content Type Router ────────────────────────────────────────────────────

const SHEET_RENDERERS = {
    'data-table': renderDataTable,
    'summary-card': renderSummaryCard,
    'key-value': renderKeyValue,
    matrix: renderMatrix,
    'chart-data': renderChartData,
};

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a professional Excel workbook from a flexible sheets array.
 *
 * @param {Object} options
 * @param {string} options.title - Workbook title (used for metadata + filename)
 * @param {string} [options.author] - Author
 * @param {Array}  options.sheets - Array of sheet definitions
 *   Each: { name, contentType, content: { headers, rows, ... } }
 * @param {string|Object} [options.theme] - Theme name or override object
 * @param {string} [options.outputPath] - Custom output path
 * @returns {Promise<Object>} { success, filePath, fileName, sheetCount, fileSize }
 */
async function generateExcelReport(options) {
    const { title, author, sheets = [], theme: themeInput, outputPath } = options;

    if (!sheets.length) {
        return { success: false, error: 'No sheets provided' };
    }

    const theme = resolveTheme(themeInput);
    const fontName = TYPOGRAPHY.fontFamily.primary;

    const wb = new ExcelJS.Workbook();
    wb.creator = author || 'DocGenie — Doremon Team';
    wb.created = new Date();
    wb.modified = new Date();
    wb.properties.date1904 = false;

    for (const sheetDef of sheets) {
        const sheetName = (sheetDef.name || 'Sheet').substring(0, 31); // Excel sheet name limit
        const ws = wb.addWorksheet(sheetName);
        const contentType = sheetDef.contentType || 'data-table';
        const renderer = SHEET_RENDERERS[contentType] || SHEET_RENDERERS['data-table'];

        // Sheet tab color
        ws.properties.tabColor = { argb: hexToARGB(theme.primary) };

        // Print setup
        ws.pageSetup.orientation = 'landscape';
        ws.pageSetup.fitToPage = true;
        ws.pageSetup.fitToWidth = 1;
        ws.pageSetup.fitToHeight = 0;

        // Header/footer
        const headerFooter = ws.headerFooter || {};
        headerFooter.oddFooter = `&L${title || 'Report'}&C&P / &N&RPowered by Doremon Team`;
        ws.headerFooter = headerFooter;

        renderer(ws, sheetDef.content || sheetDef, theme, fontName);
    }

    // Write file
    const fileName = generateFileName(title || 'Report', '.xlsx');
    const outDir = getOutputDir();
    const filePath = outputPath || path.join(outDir, fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await wb.xlsx.writeFile(filePath);
    const stats = fs.statSync(filePath);

    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        sheetCount: sheets.length,
        fileSize: stats.size,
        fileSizeHuman: `${(stats.size / 1024).toFixed(1)} KB`,
    };
}

module.exports = { generateExcelReport, SHEET_RENDERERS };
