/**
 * QA Automation Pipeline Executor for AOTF-17029
 * 
 * This script orchestrates the complete jira-to-automation workflow:
 * 1. Pre-flight validation
 * 2. Workflow initialization
 * 3. TestGenie invocation (test case generation)
 * 4. ScriptGenerator invocation (MCP exploration + automation)
 * 5. Test execution with self-healing
 * 6. Result reporting
 */

const path = require('path');
const fs = require('fs');

// Configuration
const TICKET_ID = 'AOTF-17029';
const JIRA_URL = 'https://corelogic.atlassian.net/browse/AOTF-17029';
const ENVIRONMENT = 'UAT';
const MLS = 'Canopy';
const TARGET_URL = 'https://aotf-uat.corelogic.com/en-US/properties/map?token=eyJPU04iOiJDQU5PUFlfQU9URl9VQVQiLCJjb250YWN0aWQiOiI0MDIxNDA2IiwiZW1haWwiOiJjYW5vcHl1YXQwMDlAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiODI5OTkifQ%3D%3D&searchId=a1e7872a-0777-307f-a1bf-0816fe1c7967';

console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║     QA AUTOMATION PIPELINE - AOTF-17029                                    ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

console.log('📋 Configuration:');
console.log(`   Ticket: ${TICKET_ID}`);
console.log(`   Jira URL: ${JIRA_URL}`);
console.log(`   Environment: ${ENVIRONMENT}`);
console.log(`   MLS: ${MLS}`);
console.log(`   Target URL: ${TARGET_URL}\n`);

console.log('🚀 Pipeline will execute the following stages:');
console.log('   1️⃣  Pre-flight validation');
console.log('   2️⃣  Initialize workflow state');
console.log('   3️⃣  Invoke TestGenie (Jira → Excel test cases)');
console.log('   4️⃣  Verify workflow progression');
console.log('   5️⃣  Invoke ScriptGenerator (MCP exploration → Playwright script)');
console.log('   6️⃣  Auto-execute tests with self-healing');
console.log('   7️⃣  Generate final report\n');

console.log('⏱️  Estimated completion time: 4-5 minutes\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STAGE 1: PRE-FLIGHT VALIDATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Check required directories
const requiredDirs = [
    'agentic-workflow/test-cases',
    'agentic-workflow/exploration-data',
    'tests/specs',
    'tests/test-data',
    '.github/agents/lib',
    '.github/agents/state'
];

console.log('📁 Checking required directories...');
let allDirsExist = true;
for (const dir of requiredDirs) {
    const exists = fs.existsSync(dir);
    console.log(`   ${exists ? '✅' : '❌'} ${dir}`);
    if (!exists) {
        allDirsExist = false;
    }
}

if (!allDirsExist) {
    console.error('\n❌ Pre-flight validation failed - Missing required directories');
    process.exit(1);
}

// Check test data file
console.log('\n📊 Checking test data file...');
const testDataPath = 'tests/test-data/testData.js';
if (fs.existsSync(testDataPath)) {
    console.log(`   ✅ ${testDataPath}`);
} else {
    console.error(`   ❌ ${testDataPath} - NOT FOUND`);
    process.exit(1);
}

console.log('\n✅ Pre-flight validation PASSED\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STAGE 2: WORKFLOW INITIALIZATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Load workflow coordinator
const { WorkflowCoordinator } = require('../.github/agents/lib/workflow-coordinator');
const coordinator = new WorkflowCoordinator();

console.log('🔄 Initializing workflow...');
const workflow = coordinator.initializeWorkflow(TICKET_ID, 'jira-to-automation', {
    environment: ENVIRONMENT,
    mls: MLS,
    targetUrl: TARGET_URL,
    jiraUrl: JIRA_URL
});

console.log(`   ✅ Workflow ID: ${workflow.id}`);
console.log(`   ✅ Current Stage: ${workflow.currentStage}`);
console.log(`   ✅ Status: ${workflow.status}\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STAGE 3: TESTGENIE INVOCATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🎯 Preparing TestGenie invocation prompt...\n');

const testgeniePrompt = `Generate test cases for ticket ${TICKET_ID}

**MANDATORY REQUIREMENTS:**

1. **Jira Ticket Analysis:**
   - Fetch ticket: ${JIRA_URL}
   - Extract acceptance criteria
   - Identify test scenarios
   - WorkflowId: ${workflow.id}

2. **Test Case Generation:**
   - Create comprehensive test steps
   - Cover ALL acceptance criteria
   - Use ${MLS} ${ENVIRONMENT} test data context
   - Start with "1.1 Launch OneHome application"
   - Combine steps when they exceed 1.5 logical actions
   
3. **DUAL OUTPUT (MANDATORY):**
   a) **Display in Chat:** Complete test case table using this EXACT format:
   
   | Test Step ID | Specific Activity or Action | Expected Results | Actual Results |
   |--------------|----------------------------|------------------|----------------|
   | 1.1 | Launch OneHome application | App loads successfully | |
   
   b) **Export to Excel:** Save to agentic-workflow/test-cases/${TICKET_ID}.xlsx
      - Use agentic-workflow/scripts/excel-template-generator.js
      - Include all test cases with proper formatting
      - Add headers, colors, borders

4. **Quality Requirements:**
   - NO truncation - display ALL test cases in chat
   - NO summarization - complete coverage
   - Each step should be detailed and actionable

Environment: ${ENVIRONMENT}
MLS: ${MLS}
Test Data: Use userTokens.canopy from tests/test-data/testData.js`;

console.log('📤 TestGenie prompt prepared. Ready to invoke subagent.\n');
console.log('⏳ Waiting for TestGenie to complete...\n');
console.log('   This will:');
console.log('   → Fetch Jira ticket details');
console.log('   → Generate comprehensive test cases');
console.log('   → Display test cases in chat (full tables)');
console.log('   → Export to Excel file\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚠️  ORCHESTRATOR ACTION REQUIRED');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('The orchestrator must now invoke TestGenie subagent with the above prompt.');
console.log('After TestGenie completes, the orchestrator will:');
console.log('   1. Verify Excel file exists at agentic-workflow/test-cases/AOTF-17029.xlsx');
console.log('   2. Check workflow state progression');
console.log('   3. Invoke ScriptGenerator subagent for MCP exploration\n');

console.log('💡 Next Step: Orchestrator will call runSubagent() for TestGenie\n');

// Export context for orchestrator
module.exports = {
    ticketId: TICKET_ID,
    workflowId: workflow.id,
    testgeniePrompt,
    environment: ENVIRONMENT,
    mls: MLS,
    targetUrl: TARGET_URL,
    jiraUrl: JIRA_URL
};
