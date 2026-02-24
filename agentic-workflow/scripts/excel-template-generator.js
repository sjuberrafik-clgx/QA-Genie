/**
 * Excel Template Generator
 * Creates standardized Excel files for manual test cases with strict formatting
 * This is the SINGLE SOURCE OF TRUTH for test case Excel formatting
 * 
 * Usage:
 *   const { generateTestCaseExcel } = require('./scripts/excel-template-generator.js');
 *   await generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath);
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Standard color scheme for test case Excel files
 */
const COLORS = {
    DOREMON_BLUE: 'FF0066CC',      // Doremon team branding
    HEADER_BG: 'FF4472C4',          // Table header background
    HEADER_TEXT: 'FFFFFFFF',        // Table header text (white)
    TEST_CASE_TITLE_BG: 'FFD9E2F3', // Test case title background (light blue)
    SEPARATOR_BG: 'FFE7E6E6',       // Section separator (light gray)
    BLACK_TEXT: 'FF000000'          // Standard text
};

/**
 * Standard column widths
 */
const COLUMN_WIDTHS = {
    STEP_ID: 15,
    ACTION: 55,
    EXPECTED: 45,
    ACTUAL: 45
};

/**
 * Generate a standardized test case Excel file
 * 
 * ⚠️ IMPORTANT: All data should be dynamically fetched from Jira, not hardcoded
 * 
 * @param {Object} jiraInfo - Jira ticket information (fetched from Jira API)
 * @param {string} jiraInfo.number - Ticket number from Jira (e.g., "AOTF-16461")
 * @param {string} jiraInfo.title - Ticket title from Jira
 * @param {string} jiraInfo.url - Ticket URL from user input
 * @param {string} preConditions - Pre-conditions generated from ticket context
 * @param {Array} testCases - Array of test case objects generated from acceptance criteria
 * @param {string} outputPath - Full path where Excel file should be saved
 * @returns {Promise<string>} - Path to created Excel file
 */
async function generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath) {
    // Validation
    if (!jiraInfo || !jiraInfo.number || !jiraInfo.title || !jiraInfo.url) {
        throw new Error('❌ Missing required Jira information (number, title, url)');
    }

    if (!testCases || testCases.length === 0) {
        throw new Error('❌ No test cases provided');
    }

    // ═══════════════════════════════════════════════════════════════
    // PATH RESOLUTION: Always resolve relative paths from workspace root,
    // not from the current working directory. This prevents nested directory
    // creation when scripts are run from subdirectories.
    // ═══════════════════════════════════════════════════════════════
    if (!path.isAbsolute(outputPath)) {
        const workspaceRoot = path.resolve(__dirname, '..', '..');
        outputPath = path.resolve(workspaceRoot, outputPath);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Test Cases');

    // Configure column widths (FIXED - DO NOT CHANGE)
    worksheet.columns = [
        { key: 'stepId', width: COLUMN_WIDTHS.STEP_ID },
        { key: 'action', width: COLUMN_WIDTHS.ACTION },
        { key: 'expected', width: COLUMN_WIDTHS.EXPECTED },
        { key: 'actual', width: COLUMN_WIDTHS.ACTUAL }
    ];

    let currentRow = 1;

    // ═══════════════════════════════════════════════════════════════
    // SECTION 1: DOREMON TEAM HEADER
    // ═══════════════════════════════════════════════════════════════
    const titleRow = worksheet.getRow(currentRow);
    worksheet.mergeCells(currentRow, 1, currentRow, 4);
    titleRow.getCell(1).value = '🚀💙 Powered by Doremon Team 💙🚀';
    titleRow.getCell(1).font = {
        bold: true,
        size: 14,
        color: { argb: COLORS.DOREMON_BLUE }
    };
    titleRow.getCell(1).alignment = {
        horizontal: 'center',
        vertical: 'middle'
    };
    titleRow.height = 25;
    currentRow++;

    // Empty row
    currentRow++;

    // ═══════════════════════════════════════════════════════════════
    // SECTION 2: JIRA TICKET INFORMATION
    // ═══════════════════════════════════════════════════════════════

    // Jira Ticket Number
    const jiraNumberRow = worksheet.getRow(currentRow);
    jiraNumberRow.getCell(1).value = 'Jira Ticket Number:';
    jiraNumberRow.getCell(1).font = { bold: true };
    jiraNumberRow.getCell(2).value = jiraInfo.number;
    worksheet.mergeCells(currentRow, 2, currentRow, 4);
    currentRow++;

    // Jira Ticket Title
    const jiraTitleRow = worksheet.getRow(currentRow);
    jiraTitleRow.getCell(1).value = 'Jira Ticket Title:';
    jiraTitleRow.getCell(1).font = { bold: true };
    jiraTitleRow.getCell(2).value = jiraInfo.title;
    worksheet.mergeCells(currentRow, 2, currentRow, 4);
    currentRow++;

    // Jira Ticket URL
    const jiraUrlRow = worksheet.getRow(currentRow);
    jiraUrlRow.getCell(1).value = 'Jira Ticket URL:';
    jiraUrlRow.getCell(1).font = { bold: true };
    jiraUrlRow.getCell(2).value = jiraInfo.url;
    jiraUrlRow.getCell(2).font = {
        color: { argb: COLORS.DOREMON_BLUE },
        underline: true
    };
    worksheet.mergeCells(currentRow, 2, currentRow, 4);
    currentRow++;

    // Empty row
    currentRow++;

    // ═══════════════════════════════════════════════════════════════
    // SECTION 3: PRE-CONDITIONS
    // ═══════════════════════════════════════════════════════════════
    if (preConditions && preConditions.trim()) {
        const preCondRow = worksheet.getRow(currentRow);
        preCondRow.getCell(1).value = 'Pre-Conditions (If any):';
        preCondRow.getCell(1).font = { bold: true };
        preCondRow.getCell(2).value = preConditions;
        worksheet.mergeCells(currentRow, 2, currentRow, 4);
        currentRow++;

        // Empty row
        currentRow++;
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 4: SEPARATOR BAR
    // ═══════════════════════════════════════════════════════════════
    const separatorRow = worksheet.getRow(currentRow);
    for (let col = 1; col <= 4; col++) {
        separatorRow.getCell(col).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.SEPARATOR_BG }
        };
    }
    currentRow++;

    // ═══════════════════════════════════════════════════════════════
    // SECTION 5: TEST CASES
    // ═══════════════════════════════════════════════════════════════
    testCases.forEach((testCase, index) => {
        // Empty row before each test case
        currentRow++;

        // Test Case Title Row
        const titleRow = worksheet.getRow(currentRow);
        worksheet.mergeCells(currentRow, 1, currentRow, 4);
        titleRow.getCell(1).value = `${testCase.id}: ${testCase.title}`;
        titleRow.getCell(1).font = {
            bold: true,
            size: 12,
            color: { argb: COLORS.BLACK_TEXT }
        };
        titleRow.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.TEST_CASE_TITLE_BG }
        };
        titleRow.getCell(1).alignment = {
            horizontal: 'left',
            vertical: 'middle'
        };
        currentRow++;

        // Table Header Row
        const headerRow = worksheet.getRow(currentRow);
        headerRow.getCell(1).value = 'Test Step ID';
        headerRow.getCell(2).value = 'Specific Activity or Action';
        headerRow.getCell(3).value = 'Expected Results';
        headerRow.getCell(4).value = 'Actual Results';

        // Header styling
        for (let col = 1; col <= 4; col++) {
            const cell = headerRow.getCell(col);
            cell.font = {
                bold: true,
                color: { argb: COLORS.HEADER_TEXT }
            };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLORS.HEADER_BG }
            };
            cell.alignment = {
                horizontal: 'center',
                vertical: 'middle'
            };
            cell.border = {
                top: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                left: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                bottom: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                right: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } }
            };
        }
        currentRow++;

        // Test Step Rows
        testCase.steps.forEach(step => {
            const stepRow = worksheet.getRow(currentRow);
            stepRow.getCell(1).value = step.id;
            stepRow.getCell(2).value = step.action;
            stepRow.getCell(3).value = step.expected;
            stepRow.getCell(4).value = step.actual;

            // Step row styling
            for (let col = 1; col <= 4; col++) {
                const cell = stepRow.getCell(col);
                cell.alignment = {
                    vertical: 'top',
                    wrapText: true
                };
                cell.border = {
                    top: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                    left: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                    bottom: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } },
                    right: { style: 'thin', color: { argb: COLORS.BLACK_TEXT } }
                };
            }
            currentRow++;
        });
    });

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write the file
    await workbook.xlsx.writeFile(outputPath);

    // Verify file was created
    if (!fs.existsSync(outputPath)) {
        throw new Error(`❌ Failed to create Excel file: ${outputPath}`);
    }

    const stats = fs.statSync(outputPath);
    console.log(`✅ Excel file created: ${outputPath} (${stats.size} bytes)`);

    return outputPath;
}

/**
 * Validate test case data structure before generating Excel
 * 
 * @param {Array} testCases - Array of test case objects to validate
 * @returns {Object} - Validation result { valid: boolean, errors: string[] }
 */
function validateTestCases(testCases) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(testCases)) {
        errors.push('Test cases must be an array');
        return { valid: false, errors, warnings };
    }

    testCases.forEach((testCase, index) => {
        if (!testCase.id) {
            errors.push(`Test case ${index + 1}: Missing 'id' field`);
        }
        if (!testCase.title) {
            errors.push(`Test case ${index + 1}: Missing 'title' field`);
        }
        if (!testCase.steps || !Array.isArray(testCase.steps)) {
            errors.push(`Test case ${index + 1}: Missing or invalid 'steps' array`);
        } else {
            testCase.steps.forEach((step, stepIndex) => {
                if (!step.id) {
                    errors.push(`Test case ${index + 1}, Step ${stepIndex + 1}: Missing 'id'`);
                }
                if (!step.action) {
                    errors.push(`Test case ${index + 1}, Step ${stepIndex + 1}: Missing 'action'`);
                }
                if (!step.expected) {
                    errors.push(`Test case ${index + 1}, Step ${stepIndex + 1}: Missing 'expected'`);
                }
                if (!step.actual) {
                    warnings.push(`Test case ${index + 1}, Step ${stepIndex + 1}: Missing 'actual' — Actual Results should be populated (e.g., "User is able to [action]")`);
                }
            });
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

module.exports = {
    generateTestCaseExcel,
    validateTestCases,
    COLORS,
    COLUMN_WIDTHS
};
