/**
 * Test Case Formatter
 * Converts test cases from CSV to formatted Excel
 * Usage: node scripts/format-test-cases.js <input-file>
 * 
 * Examples:
 *   node scripts/format-test-cases.js test-cases/AOTF-15066.csv
 * 
 * Generates a professionally formatted Excel file with:
 * - Jira ticket information
 * - Pre-conditions
 * - Test cases with steps, actions, expected and actual results
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// Parse CSV file with proper handling of quoted fields and escaped quotes
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rows = [];

  lines.forEach(line => {
    if (line.trim()) {
      const fields = [];
      let current = '';
      let inQuotes = false;
      let i = 0;

      while (i < line.length) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // Escaped quote - add one quote
            current += '"';
            i += 2;
            continue;
          } else {
            // Toggle quote state
            inQuotes = !inQuotes;
            i++;
            continue;
          }
        }

        if (char === ',' && !inQuotes) {
          // End of field
          fields.push(current.trim());
          current = '';
          i++;
          continue;
        }

        current += char;
        i++;
      }

      // Add last field
      fields.push(current.trim());

      rows.push(fields);
    }
  });

  return rows;
}

// Extract test case structure from parsed CSV
function extractTestCases(rows) {
  const testCases = [];
  let currentTestCase = null;
  let jiraInfo = {};
  let preConditions = '';
  let headerFound = false;

  for (let i = 0; i < rows.length; i++) {
    const [col1, col2, col3, col4, col5, col6] = rows[i];

    // Extract Jira information
    if (col1 === 'Jira Ticket Number') {
      jiraInfo.number = col2;
      continue;
    } else if (col1 === 'Jira Ticket Title') {
      jiraInfo.title = col2;
      continue;
    } else if (col1 === 'Jira Ticket URL') {
      jiraInfo.url = col2;
      continue;
    } else if (col1 && col1.includes('Pre-Conditions')) {
      preConditions = col2;
      continue;
    }

    // Skip header row
    if (col1 === 'Test Case ID' && col2 === 'Test Case Title') {
      headerFound = true;
      continue;
    }

    // Skip empty rows
    if (!col1 || col1.trim() === '') {
      continue;
    }

    // Process test case rows (format: TC-1, Title, 1.1, Action, Expected, Actual)
    if (headerFound && col1.match(/^TC-\d+$/)) {
      // Check if this is a new test case or continuation
      if (!currentTestCase || currentTestCase.id !== col1) {
        // Save previous test case
        if (currentTestCase) {
          testCases.push(currentTestCase);
        }
        // Start new test case
        currentTestCase = {
          id: col1,
          title: col2,
          steps: []
        };
      }

      // Add test step
      if (col3) { // Test Step ID
        currentTestCase.steps.push({
          id: col3,
          action: col4 || '',
          expected: col5 || '',
          actual: col6 || ''
        });
      }
    }
  }

  // Add last test case
  if (currentTestCase) {
    testCases.push(currentTestCase);
  }

  return { jiraInfo, preConditions, testCases };
}

// Generate Excel format
async function generateExcel(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Test Cases');

  // Add Doremon Team header
  const titleRow = worksheet.addRow(['🚀💙 Powered by Doremon Team 💙🚀']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0066CC' } };
  titleRow.alignment = { horizontal: 'center' };
  worksheet.mergeCells(1, 1, 1, 4);

  worksheet.addRow([]);

  // Add Jira information with proper formatting
  const jiraNumberRow = worksheet.addRow(['Jira Ticket Number:', data.jiraInfo.number]);
  jiraNumberRow.getCell(1).font = { bold: true };
  worksheet.mergeCells(jiraNumberRow.number, 2, jiraNumberRow.number, 4);

  const jiraTitleRow = worksheet.addRow(['Jira Ticket Title:', data.jiraInfo.title]);
  jiraTitleRow.getCell(1).font = { bold: true };
  worksheet.mergeCells(jiraTitleRow.number, 2, jiraTitleRow.number, 4);

  const jiraUrlRow = worksheet.addRow(['Jira Ticket URL:', data.jiraInfo.url]);
  jiraUrlRow.getCell(1).font = { bold: true };
  jiraUrlRow.getCell(2).font = { color: { argb: 'FF0066CC' }, underline: true };
  worksheet.mergeCells(jiraUrlRow.number, 2, jiraUrlRow.number, 4);

  worksheet.addRow([]);

  // Add Pre-Conditions
  if (data.preConditions) {
    const preCondRow = worksheet.addRow(['Pre-Conditions (If any):', data.preConditions]);
    preCondRow.getCell(1).font = { bold: true };
    worksheet.mergeCells(preCondRow.number, 2, preCondRow.number, 4);
    worksheet.addRow([]);
  }

  // Add separator
  const separatorRow = worksheet.addRow(['', '', '', '']);
  separatorRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' }
  };

  // Add test cases
  data.testCases.forEach((testCase, index) => {
    worksheet.addRow([]);

    // Test case title with ID
    const titleRow = worksheet.addRow([`${testCase.id}: ${testCase.title}`]);
    titleRow.font = { bold: true, size: 12, color: { argb: 'FF000000' } };
    titleRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E2F3' }
    };
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, 4);

    // Table header
    const headerRow = worksheet.addRow(['Test Step ID', 'Specific Activity or Action', 'Expected Results', 'Actual Results']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Test steps
    testCase.steps.forEach(step => {
      const stepRow = worksheet.addRow([step.id, step.action, step.expected, step.actual]);
      stepRow.alignment = { vertical: 'top', wrapText: true };
    });
  });

  // Format columns
  worksheet.columns = [
    { key: 'id', width: 15 },
    { key: 'action', width: 55 },
    { key: 'expected', width: 45 },
    { key: 'actual', width: 45 }
  ];

  // Add borders to all cells and set row heights
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.height = rowNumber === 1 ? 25 : null; // Auto height for most rows
    }
    row.eachCell((cell) => {
      if (rowNumber > 8) { // Only add borders to test case section
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
      }
      if (!cell.alignment) {
        cell.alignment = { vertical: 'top', wrapText: true };
      }
    });
  });

  await workbook.xlsx.writeFile(outputPath);
  console.log(`✅ Excel file created: ${outputPath}`);
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node scripts/format-test-cases.js <input-file>');
    console.log('\nExamples:');
    console.log('  node scripts/format-test-cases.js test-cases/AOTF-15066.csv');
    console.log('\nNote: This will generate a properly formatted Excel file (.xlsx)');
    process.exit(1);
  }

  const inputFile = args[0];

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  console.log(`📖 Reading: ${inputFile}`);

  // Parse CSV
  const rows = parseCSV(inputFile);
  const data = extractTestCases(rows);

  console.log(`📊 Found ${data.testCases.length} test cases`);

  if (data.testCases.length === 0) {
    console.error('❌ Error: No test cases found in the CSV file');
    console.log('Please check the CSV format. Expected format:');
    console.log('- Header: Test Case ID, Test Case Title, Test Step ID, Specific Activity or Action, Expected Results, Actual Results');
    console.log('- Data rows: TC-1, Title, 1.1, Action, Expected, Actual');
    process.exit(1);
  }

  const baseName = path.basename(inputFile, path.extname(inputFile));
  const dirName = path.dirname(inputFile);

  // Generate Excel file only
  const excelPath = path.join(dirName, `${baseName}.xlsx`);
  await generateExcel(data, excelPath);

  console.log('\n✨ Formatting complete!');
  console.log(`📁 Output file: ${excelPath}`);
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
