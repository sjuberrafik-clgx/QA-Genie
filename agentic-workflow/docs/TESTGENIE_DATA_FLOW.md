# TestGenie Data Flow - Dynamic Data Generation

## Overview

**CRITICAL:** All test case data (Jira info, pre-conditions, test cases) must be **dynamically generated** from Jira tickets, not hardcoded.

---

## 📊 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  USER INPUT                                                  │
│  https://<JIRA_BASE_URL>/browse/AOTF-16461                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Extract Ticket Key                                 │
│  • Parse URL → Extract 'AOTF-16461'                         │
│  • Validate format (PROJECT-NUMBER)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Fetch from Jira (Atlassian MCP)                   │
│  • Tool: mcp_atlassian_atl_getJiraIssue                     │
│  • CloudId: <JIRA_CLOUD_ID from .env>                      │
│  • IssueIdOrKey: <TICKET_KEY>                                │
│                                                              │
│  Response:                                                   │
│  {                                                           │
│    key: "AOTF-16461",                                       │
│    fields: {                                                │
│      summary: "Add Roomvo clause verification",            │
│      description: "...",                                    │
│      acceptanceCriteria: "...",                             │
│      environment: "UAT",                                    │
│      ...                                                    │
│    }                                                         │
│  }                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Parse & Transform Data                             │
│                                                              │
│  A. Extract Jira Info:                                      │
│     jiraInfo = {                                            │
│       number: ticketData.key,  ← "AOTF-16461"              │
│       title: ticketData.fields.summary,  ← "Add Roomvo..." │
│       url: userProvidedUrl  ← Original URL                  │
│     }                                                        │
│                                                              │
│  B. Generate Pre-Conditions:                                │
│     • Parse description & environment                       │
│     • Extract user state requirements                       │
│     • Identify page/context prerequisites                   │
│     → "User is authenticated, on property details page"    │
│                                                              │
│  C. Generate Test Cases:                                    │
│     • Parse acceptance criteria                             │
│     • Create test case structure (TC-1, TC-2, ...)         │
│     • Generate test steps (1.1, 1.2, ...)                  │
│     • Optimize and consolidate steps                        │
│     • Set expected = actual for new test cases             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Validate Generated Data                            │
│  • validateTestCases(testCases)                             │
│  • Check required fields (id, title, steps)                 │
│  • Verify step structure (id, action, expected, actual)     │
│  • Ensure at least one test case exists                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Generate Excel with Template                       │
│  • generateTestCaseExcel(jiraInfo, preConditions, testCases)│
│  • Apply Doremon Team template                              │
│  • Enforce colors, fonts, widths                            │
│  • Save to test-cases/AOTF-16461.xlsx                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  OUTPUT                                                      │
│  • Excel file: test-cases/AOTF-16461.xlsx                   │
│  • Markdown display in chat                                 │
│  • File path for user                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Helper Functions

### 1. Extract Ticket Key
```javascript
function extractTicketKey(url) {
  // Input: "https://<your-org>.atlassian.net/browse/AOTF-16461"
  // Output: "AOTF-16461"
  const match = url.match(/browse\/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}
```

### 2. Fetch Jira Ticket
```javascript
async function fetchJiraTicket({ cloudId, issueIdOrKey }) {
  // Use Atlassian MCP tool
  const ticketData = await mcp_atlassian_atl_getJiraIssue({
    cloudId: process.env.JIRA_CLOUD_ID, // From .env
    issueIdOrKey: issueIdOrKey,
    fields: ['summary', 'description', 'acceptanceCriteria']
  });
  return ticketData;
}
```

### 3. Generate Pre-Conditions
```javascript
function generatePreConditions(ticketData) {
  // Analyze ticket description and environment
  const desc = ticketData.fields.description.toLowerCase();
  const conditions = [];
  
  // Check for authentication
  if (desc.includes('authenticated') || desc.includes('logged in')) {
    conditions.push('User is authenticated');
  }
  
  // Check for page context
  if (desc.includes('property details')) {
    conditions.push('User is on property details page');
  } else if (desc.includes('search')) {
    conditions.push('User is on search results page');
  }
  
  // Check for data requirements
  if (desc.includes('mls') || desc.includes('listing')) {
    conditions.push('Valid property listing data available');
  }
  
  return conditions.length > 0 ? conditions.join(', ') : 'No specific pre-conditions';
}
```

### 4. Generate Test Cases from Acceptance Criteria
```javascript
async function generateTestCasesFromAcceptanceCriteria(ticketData) {
  // Parse acceptance criteria
  const criteria = ticketData.fields.acceptanceCriteria || 
                   extractAcceptanceCriteriaFromDescription(ticketData.fields.description);
  
  const testCases = [];
  let tcNumber = 1;
  
  // For each criterion, create a test case
  for (const criterion of criteria) {
    const testCase = {
      id: `TC-${tcNumber}`,
      title: generateTestCaseTitle(criterion),
      steps: generateTestSteps(criterion, tcNumber)
    };
    
    testCases.push(testCase);
    tcNumber++;
  }
  
  return testCases;
}

function generateTestSteps(criterion, tcNumber) {
  // Generate optimized test steps from criterion
  // Consolidate repetitive steps
  // Use format: 1.1, 1.2, 1.3, etc.
  const steps = [];
  let stepNumber = 1;
  
  // Example logic:
  // - First step: Launch/navigate
  // - Middle steps: Perform actions
  // - Last step: Verify result
  
  return steps.map(step => ({
    id: `${tcNumber}.${stepNumber++}`,
    action: step.action,
    expected: step.expected,
    actual: step.expected  // Default to expected for new test cases
  }));
}
```

---

## 📋 Data Structure Requirements

### Jira Info (Required)
```javascript
{
  number: string,   // From Jira API (e.g., "AOTF-16461")
  title: string,    // From Jira API (ticket summary)
  url: string       // User provided URL
}
```

### Pre-Conditions (Optional)
```javascript
string  // Generated from ticket context
// Examples:
// - "User is authenticated and on property details page"
// - "Valid MLS listing data available"
// - "User has saved searches configured"
```

### Test Cases (Required, minimum 1)
```javascript
[
  {
    id: string,       // "TC-1", "TC-2", etc.
    title: string,    // Generated from criterion
    steps: [
      {
        id: string,         // "1.1", "1.2", etc.
        action: string,     // What to do
        expected: string,   // What should happen
        actual: string      // What actually happened (default to expected)
      }
    ]
  }
]
```

---

## ❌ Common Mistakes to Avoid

### 1. Hardcoding Values
```javascript
// ❌ WRONG - Hardcoded values
const jiraInfo = {
  number: 'AOTF-16461',
  title: 'Add Roomvo clause',
  url: 'https://...'
};

// ✅ CORRECT - Dynamic from Jira
const ticketData = await fetchJiraTicket(ticketKey);
const jiraInfo = {
  number: ticketData.key,
  title: ticketData.fields.summary,
  url: userProvidedUrl
};
```

### 2. Manual Test Case Creation
```javascript
// ❌ WRONG - Manually written test cases
const testCases = [
  { id: 'TC-1', title: 'Test something', steps: [...] }
];

// ✅ CORRECT - Generated from criteria
const testCases = await generateTestCasesFromAcceptanceCriteria(ticketData);
```

### 3. Skipping Validation
```javascript
// ❌ WRONG - No validation
await generateTestCaseExcel(jiraInfo, preConditions, testCases, path);

// ✅ CORRECT - Always validate first
const validation = validateTestCases(testCases);
if (!validation.valid) {
  throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
}
await generateTestCaseExcel(jiraInfo, preConditions, testCases, path);
```

---

## 🎯 Example: Complete Flow

```javascript
async function generateTestCasesForTicket(ticketUrl) {
  // 1. Extract ticket key
  const ticketKey = extractTicketKey(ticketUrl);
  console.log(`📌 Ticket: ${ticketKey}`);
  
  // 2. Fetch from Jira
  console.log('🔍 Fetching ticket data from Jira...');
  const ticketData = await fetchJiraTicket({
    cloudId: process.env.JIRA_CLOUD_ID, // From .env
    issueIdOrKey: ticketKey
  });
  
  // 3. Prepare Jira info (DYNAMIC)
  const jiraInfo = {
    number: ticketData.key,
    title: ticketData.fields.summary,
    url: ticketUrl
  };
  console.log(`📋 Title: ${jiraInfo.title}`);
  
  // 4. Generate pre-conditions (DYNAMIC)
  const preConditions = generatePreConditions(ticketData);
  console.log(`🔧 Pre-conditions: ${preConditions}`);
  
  // 5. Generate test cases (DYNAMIC)
  console.log('🧪 Generating test cases from acceptance criteria...');
  const testCases = await generateTestCasesFromAcceptanceCriteria(ticketData);
  console.log(`✅ Generated ${testCases.length} test cases`);
  
  // 6. Validate
  const validation = validateTestCases(testCases);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }
  
  // 7. Generate Excel
  const outputPath = path.resolve('test-cases', `${jiraInfo.number}.xlsx`);
  await generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath);
  
  console.log(`📊 Excel created: ${outputPath}`);
  return outputPath;
}

// Usage
const url = 'https://<your-org>.atlassian.net/browse/AOTF-16461';
await generateTestCasesForTicket(url);
```

---

## 🔄 Dynamic vs Static

| Aspect | ❌ Static (Wrong) | ✅ Dynamic (Correct) |
|--------|------------------|---------------------|
| Jira Info | Hardcoded strings | Fetched from Jira API |
| Pre-Conditions | Manual text | Generated from ticket context |
| Test Cases | Written manually | Generated from acceptance criteria |
| Test Steps | Copy-pasted | Optimized and consolidated |
| Flexibility | Works for one ticket only | Works for any ticket |

---

## 📚 Related Documentation

- **Template System:** `docs/EXCEL_TEMPLATE_SYSTEM.md`
- **TestGenie Agent:** `.github/agents/testgenie.agent.md`
- **Template Generator:** `scripts/excel-template-generator.js`
- **Implementation Summary:** `docs/EXCEL_TEMPLATE_IMPLEMENTATION.md`

---

🚀💙 **Powered by Doremon Team** 💙🚀

**Key Principle:** Everything is dynamic, nothing is hardcoded.
