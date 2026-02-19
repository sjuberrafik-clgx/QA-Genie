/**
 * Test Case Excel Validator
 * Validates that generated Excel files strictly follow the Doremon Team template
 * 
 * Usage:
 *   node scripts/validate-test-case-excel.js test-cases/AOTF-16461.xlsx
 * 
 * Returns:
 *   - Exit code 0 if file passes all validation checks
 *   - Exit code 1 if file fails validation with detailed error messages
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Expected template colors
const EXPECTED_COLORS = {
    DOREMON_BLUE: 'FF0066CC',
    HEADER_BG: 'FF4472C4',
    HEADER_TEXT: 'FFFFFFFF',
    TEST_CASE_TITLE_BG: 'FFD9E2F3',
    SEPARATOR_BG: 'FFE7E6E6'
};

// Expected column widths (with tolerance)
const EXPECTED_COLUMN_WIDTHS = {
    1: { min: 14, max: 16, name: 'Test Step ID' },
    2: { min: 54, max: 56, name: 'Specific Activity or Action' },
    3: { min: 44, max: 46, name: 'Expected Results' },
    4: { min: 44, max: 46, name: 'Actual Results' }
};

class ExcelValidator {
    constructor(filePath) {
        this.filePath = filePath;
        this.errors = [];
        this.warnings = [];
        this.workbook = null;
        this.worksheet = null;
    }

    /**
     * Run all validation checks
     */
    async validate() {
        console.log(`\n🔍 Validating: ${this.filePath}\n`);

        // Check file exists
        if (!fs.existsSync(this.filePath)) {
            this.addError('File does not exist');
            return this.getResults();
        }

        // Check file extension
        if (!this.filePath.endsWith('.xlsx')) {
            this.addError('File must have .xlsx extension');
            return this.getResults();
        }

        // Load workbook
        try {
            this.workbook = new ExcelJS.Workbook();
            await this.workbook.xlsx.readFile(this.filePath);
        } catch (error) {
            this.addError(`Failed to load Excel file: ${error.message}`);
            return this.getResults();
        }

        // Check worksheet exists
        this.worksheet = this.workbook.getWorksheet('Test Cases');
        if (!this.worksheet) {
            this.addError('Worksheet "Test Cases" not found');
            return this.getResults();
        }

        // Run validation checks
        this.validateColumnWidths();
        this.validateDoremonHeader();
        this.validateJiraInformation();
        this.validateTableHeaders();
        this.validateBorders();

        return this.getResults();
    }

    /**
     * Validate column widths match template
     */
    validateColumnWidths() {
        const columns = this.worksheet.columns;

        for (let i = 0; i < 4; i++) {
            const col = columns[i];
            const colNum = i + 1;
            const expected = EXPECTED_COLUMN_WIDTHS[colNum];
            const actualWidth = col.width || 10;

            if (actualWidth < expected.min || actualWidth > expected.max) {
                this.addWarning(
                    `Column ${colNum} (${expected.name}): Width is ${actualWidth.toFixed(1)}, ` +
                    `expected ${expected.min}-${expected.max}`
                );
            }
        }
    }

    /**
     * Validate Doremon Team header (Row 1)
     */
    validateDoremonHeader() {
        const row1 = this.worksheet.getRow(1);
        const cell = row1.getCell(1);
        const value = cell.value;

        // Check text content
        if (!value || !value.toString().includes('Doremon Team')) {
            this.addError('Row 1: Missing "Powered by Doremon Team" header');
            return;
        }

        // Check font color
        if (cell.font && cell.font.color) {
            const colorArgb = cell.font.color.argb;
            if (colorArgb !== EXPECTED_COLORS.DOREMON_BLUE) {
                this.addWarning(
                    `Row 1: Header color is ${colorArgb}, expected ${EXPECTED_COLORS.DOREMON_BLUE}`
                );
            }
        }

        // Check font size
        if (cell.font && cell.font.size !== 14) {
            this.addWarning(`Row 1: Header font size is ${cell.font.size}, expected 14`);
        }

        // Check if bold
        if (!cell.font || !cell.font.bold) {
            this.addWarning('Row 1: Header should be bold');
        }

        // Check merged cells
        const merges = this.worksheet._merges;
        const hasMerge = Object.keys(merges).some(range => {
            return range.startsWith('A1:') && range.includes('D1');
        });

        if (!hasMerge) {
            this.addWarning('Row 1: Header should be merged across columns A-D');
        }
    }

    /**
     * Validate Jira information section
     */
    validateJiraInformation() {
        const requiredLabels = [
            'Jira Ticket Number',
            'Jira Ticket Title',
            'Jira Ticket URL'
        ];

        let foundCount = 0;
        for (let rowNum = 2; rowNum <= 10; rowNum++) {
            const row = this.worksheet.getRow(rowNum);
            const cellValue = row.getCell(1).value;

            if (cellValue) {
                const valueStr = cellValue.toString();
                requiredLabels.forEach(label => {
                    if (valueStr.includes(label)) {
                        foundCount++;

                        // Check if bold
                        if (!row.getCell(1).font || !row.getCell(1).font.bold) {
                            this.addWarning(`${label} label should be bold`);
                        }
                    }
                });
            }
        }

        if (foundCount < 3) {
            this.addError(
                `Missing Jira information: Found ${foundCount}/3 required labels ` +
                `(Ticket Number, Title, URL)`
            );
        }
    }

    /**
     * Validate test case table headers
     */
    validateTableHeaders() {
        const expectedHeaders = [
            'Test Step ID',
            'Specific Activity or Action',
            'Expected Results',
            'Actual Results'
        ];

        let headerRowNum = null;

        // Find header row
        for (let rowNum = 8; rowNum <= 20; rowNum++) {
            const row = this.worksheet.getRow(rowNum);
            const cell1 = row.getCell(1).value;
            const cell2 = row.getCell(2).value;

            if (cell1 && cell1.toString().includes('Test Step ID') &&
                cell2 && cell2.toString().includes('Specific Activity')) {
                headerRowNum = rowNum;
                break;
            }
        }

        if (!headerRowNum) {
            this.addError('Test case table header row not found');
            return;
        }

        const headerRow = this.worksheet.getRow(headerRowNum);

        // Validate header text
        for (let i = 0; i < 4; i++) {
            const cell = headerRow.getCell(i + 1);
            const value = cell.value;

            if (!value || !value.toString().includes(expectedHeaders[i].split(' ')[0])) {
                this.addError(
                    `Column ${i + 1} header incorrect: Expected "${expectedHeaders[i]}", ` +
                    `got "${value}"`
                );
            }

            // Check header background color
            if (cell.fill && cell.fill.fgColor) {
                const colorArgb = cell.fill.fgColor.argb;
                if (colorArgb !== EXPECTED_COLORS.HEADER_BG) {
                    this.addWarning(
                        `Header cell background: Got ${colorArgb}, expected ${EXPECTED_COLORS.HEADER_BG}`
                    );
                }
            }

            // Check header text color
            if (cell.font && cell.font.color) {
                const colorArgb = cell.font.color.argb;
                if (colorArgb !== EXPECTED_COLORS.HEADER_TEXT) {
                    this.addWarning(
                        `Header text color: Got ${colorArgb}, expected ${EXPECTED_COLORS.HEADER_TEXT}`
                    );
                }
            }

            // Check if bold
            if (!cell.font || !cell.font.bold) {
                this.addWarning(`Header cell ${i + 1} should be bold`);
            }
        }
    }

    /**
     * Validate borders are applied to table cells
     */
    validateBorders() {
        let headerRowNum = null;

        // Find header row
        for (let rowNum = 8; rowNum <= 20; rowNum++) {
            const row = this.worksheet.getRow(rowNum);
            const cell1 = row.getCell(1).value;

            if (cell1 && cell1.toString().includes('Test Step ID')) {
                headerRowNum = rowNum;
                break;
            }
        }

        if (!headerRowNum) {
            return; // Already reported as error
        }

        // Check at least one data row has borders
        let foundBorders = false;
        const dataRow = this.worksheet.getRow(headerRowNum + 1);

        for (let col = 1; col <= 4; col++) {
            const cell = dataRow.getCell(col);
            if (cell.border && cell.border.top && cell.border.left) {
                foundBorders = true;
                break;
            }
        }

        if (!foundBorders) {
            this.addWarning('Table cells should have borders');
        }
    }

    /**
     * Add an error
     */
    addError(message) {
        this.errors.push(message);
    }

    /**
     * Add a warning
     */
    addWarning(message) {
        this.warnings.push(message);
    }

    /**
     * Get validation results
     */
    getResults() {
        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings
        };
    }
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage: node scripts/validate-test-case-excel.js <excel-file>');
        console.log('\nExample:');
        console.log('  node scripts/validate-test-case-excel.js test-cases/AOTF-16461.xlsx');
        process.exit(1);
    }

    const filePath = args[0];
    const validator = new ExcelValidator(filePath);
    const results = await validator.validate();

    // Display results
    if (results.errors.length > 0) {
        console.log('❌ VALIDATION FAILED\n');
        console.log('Errors:');
        results.errors.forEach((error, index) => {
            console.log(`  ${index + 1}. ${error}`);
        });
    } else {
        console.log('✅ VALIDATION PASSED\n');
    }

    if (results.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        results.warnings.forEach((warning, index) => {
            console.log(`  ${index + 1}. ${warning}`);
        });
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`Summary: ${results.errors.length} errors, ${results.warnings.length} warnings`);
    console.log('═'.repeat(70) + '\n');

    // Exit with appropriate code
    process.exit(results.errors.length === 0 ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Validation error:', error.message);
        process.exit(1);
    });
}

module.exports = { ExcelValidator };
