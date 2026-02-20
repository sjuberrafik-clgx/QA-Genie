const ExcelJS = require('exceljs');
const path = require('path');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Test Cases');

  let r = 1;
  ws.getCell(`A${r}`).value = '🚀💙 Powered by Doremon Team 💙🚀';
  r += 2;
  ws.getCell(`A${r}`).value = 'Jira Ticket Number:- AOTF-17109';
  ws.getCell(`A${r+1}`).value = 'Jira Ticket Title:- Saved commute time destination wipes out after page refresh';
  ws.getCell(`A${r+2}`).value = 'Jira Ticket URL:- ';
  r += 4;
  ws.getCell(`A${r}`).value = 'Pre-Conditions (If any): 1: For Consumer: User is authenticated/unauthenticated; Environment: PROD';
  r += 2;

  // Test Case 1
  ws.getCell(`A${r}`).value = '## Test Case 1: Verify saved commute destination persists after refresh (authenticated)';
  r += 1;
  ws.addRow([]);
  ws.addRow(['Test Step ID', 'Specific Activity or Action', 'Expected Results', 'Actual Results']);
  const steps1 = [
    ['1.1', 'Launch OneHome application', 'User should be able to launch OneHome application', 'User is able to launch OneHome application'],
    ['1.2', 'Navigate to the property page (use provided PROD URL) and open Commute Time section', 'User should be able to navigate to property page and open Commute Time section', 'User is able to navigate to property page and open Commute Time section'],
    ['1.3', 'Enter a valid destination in the Commute Time search field', 'User should be able to enter a destination', 'User is able to enter a destination'],
    ['1.4', 'Click Calculate Commute Time to save the destination', 'User should be able to save the commute destination using Calculate Commute Time', 'User is able to save the commute destination using Calculate Commute Time'],
    ['1.5', 'Refresh the page', 'User should be able to see the previously saved commute destination after refresh', 'User is able to see the previously saved commute destination after refresh'],
    ['1.6', 'Repeat with a different destination and confirm new value persists after refresh', 'User should be able to overwrite saved destination and see updated value after refresh', 'User is able to overwrite saved destination and see updated value after refresh']
  ];
  steps1.forEach(s => ws.addRow(s));
  r += steps1.length + 3;

  // Test Case 2
  ws.getCell(`A${r}`).value = '## Test Case 2: Verify behavior for unauthenticated or token-based sessions (edge case)';
  r += 1;
  ws.addRow([]);
  ws.addRow(['Test Step ID', 'Specific Activity or Action', 'Expected Results', 'Actual Results']);
  const steps2 = [
    ['2.1', 'Launch OneHome application (incognito/private window to simulate unauthenticated)', 'User should be able to launch OneHome application', 'User is able to launch OneHome application'],
    ['2.2', 'Navigate to same property URL and open Commute Time section', 'User should be able to open Commute Time section in unauthenticated session', 'User is able to open Commute Time section in unauthenticated session'],
    ['2.3', 'Enter a destination and click Calculate Commute Time', 'User should be able to save the commute destination in unauthenticated session', 'User is able to save the commute destination in unauthenticated session'],
    ['2.4', 'Refresh the page', 'User should be able to see the previously saved commute destination after refresh (if supported)', 'User is able to see the previously saved commute destination after refresh'],
    ['2.5', 'If destination does NOT persist, capture network requests and console logs, and attach video/screenshots to the ticket', 'User should be able to reproduce failure and collect logs for triage', 'User is able to reproduce failure and collect logs for triage']
  ];
  steps2.forEach(s => ws.addRow(s));

  // Adjust column widths
  ws.columns = [
    {key: 'a', width: 15},
    {key: 'b', width: 80},
    {key: 'c', width: 60},
    {key: 'd', width: 60}
  ];

  const outPath = path.resolve('agentic-workflow','test-cases','AOTF-17109.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Created Excel at '+outPath);
})();
