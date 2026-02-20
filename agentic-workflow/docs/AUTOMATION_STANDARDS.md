# 🚀 Automation Scripting Standards

## Overview
This document defines the coding standards and best practices for automated test scripts in the PW_regression-suite framework. All generated scripts MUST follow these guidelines.

---

## 📁 Project Structure Standards

### File Organization
```
tests/
├── specs/
│   └── {ticket-id}/           # Folder per Jira ticket
│       └── {feature}.spec.js  # Test spec file
├── pageobjects/               # Page Object classes
├── business-functions/        # Reusable business logic
├── config/                    # Configuration files
├── test-data/                 # Test data files
└── utils/                     # Utility functions
```

### Naming Conventions
- **Spec files**: `{feature-name}.spec.js` (lowercase, hyphen-separated)
- **Page Objects**: `{pageName}.js` (camelCase)
- **Business Functions**: `{domain}.js` (camelCase)
- **Test describe blocks**: `{TICKET-ID}: {Feature Description}`
- **Test names**: Action-oriented, descriptive (`'should display CTA on desktop'`)

---

## 🏗️ Code Structure Standards

### 1. Import Order (Top of File)
```javascript
// 1. Playwright imports
const { test, expect } = require('@playwright/test');

// 2. Config imports
const { launchBrowser } = require('../../config/config');

// 3. Page Object Manager
const POmanager = require('../../pageobjects/POmanager');

// 4. Popup Handler (centralized popup dismiss logic)
const { PopupHandler } = require('../../utils/popupHandler');

// 5. Test data
const { userTokens } = require('../../test-data/testData');
```

### 2. Test Configuration Section
```javascript
// ========================================
// TEST CONFIGURATION
// ========================================
const BASE_URL = process.env.UAT_URL || '<your-uat-base-url>';
const PROPERTY_PATH = '/en-US/property/...';

// Selectors should be centralized
const SELECTORS = {
    featureName: {
        element: 'selector'
    }
};
```

### 3. Test Suite Structure
```javascript
test.describe.serial('{TICKET-ID}: {Feature}', () => {
    let browser, context, page;
    let Pomanager;
    // ... page object declarations

    // HELPER FUNCTIONS (DRY)
    const helperFunction = async () => { };

    test.beforeAll(async () => {
        // Browser launch
        // POmanager initialization
        // Page object initialization
    });

    test.afterAll(async () => {
        // MANDATORY cleanup
        if (page && !page.isClosed()) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
    });

    test('TC1: Test name @tag', async () => {
        // Test implementation
    });
});
```

---

## ✅ MUST-FOLLOW Rules

### 1. Use POmanager Pattern
```javascript
// ✅ CORRECT - Use POmanager
Pomanager = new POmanager(page);
generalFunctions = Pomanager.generalFunctions();
homePage = Pomanager.homePage();

// ❌ WRONG - Direct instantiation (unless page object not in POmanager)
const homePage = new HomePage(page);
```

### 2. Use Existing Business Functions
```javascript
// ✅ CORRECT - Use existing functions
await generalFunctions.openOneHome(token);
await loginFunctions.signInAndWaitForPropertiesGrid(credentials);

// ❌ WRONG - Duplicate navigation logic
await page.goto(url);
await page.waitForLoadState();
// ... manual popup handling
```

### 3. Proper Browser Cleanup (MANDATORY)
```javascript
test.afterAll(async () => {
    // Always check before closing
    if (page && !page.isClosed()) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
});
```

### 4. Use Test Data from testData.js
```javascript
// ✅ CORRECT
const { userTokens, credentials } = require('../../test-data/testData');
await generalFunctions.openOneHome(userTokens.registered);

// ❌ WRONG - Hardcoded tokens
const token = 'eyJPU04i...';
```

### 5. Handle Popups Properly
```javascript
// ✅ CORRECT - Use PopupHandler utility
const { PopupHandler } = require('../../utils/popupHandler');
const popups = new PopupHandler(page);
await popups.waitForPageReady();  // network idle + dismiss all popups

// Also available through POmanager:
await poManager.dismissAllPopups();

// ❌ WRONG - Manual popup handling without try-catch
await page.locator('.popup-close').click();
```

---

## 🎯 Selector Best Practices

### Priority Order
1. `data-qa` attributes (highest priority)
2. ARIA roles and labels
3. Semantic HTML elements
4. CSS classes (only if stable)

```javascript
// ✅ BEST - data-qa attribute
page.locator('[data-qa="submit-button"]')

// ✅ GOOD - ARIA role
page.getByRole('button', { name: 'Submit' })

// ⚠️ ACCEPTABLE - CSS class (if stable)
page.locator('.submit-button')

// ❌ AVOID - XPath or fragile selectors
page.locator('//div[3]/button[1]')
```

### Use .first() for Multiple Matches
```javascript
// ✅ CORRECT - Explicit first element
page.locator('.cta-button').first()

// ❌ WRONG - Strict mode violation risk
page.locator('.cta-button')  // May match multiple
```

---

## 📐 Code Size Guidelines

### Maximum Lines per File
- **Spec file**: 300-400 lines max
- **Helper functions**: Extract to separate file if > 50 lines
- **Test case**: 30-50 lines max (excluding comments)

### When to Refactor
1. **Duplicate code** → Extract to helper function
2. **Similar selectors** → Create SELECTORS constant object
3. **Complex setup** → Move to beforeAll or business function
4. **Multiple viewports** → Use data-driven approach with loops

---

## 🏷️ Tagging Standards

```javascript
test('TC1: Description @smoke @critical', async () => {});
test('TC2: Description @functional @regression', async () => {});
test('TC3: Description @mobile @responsive', async () => {});
test('TC4: Description @auth @security', async () => {});
```

### Tag Categories
- `@smoke` - Critical path tests
- `@critical` - High priority
- `@functional` - Feature tests
- `@regression` - Full regression
- `@mobile` - Mobile viewport tests
- `@responsive` - Breakpoint tests
- `@auth` - Authentication tests
- `@visual` - UI/Layout tests

---

## 🔄 Lightweight Code Checklist

Before finalizing generated code, verify:

- [ ] Uses POmanager pattern (not direct page object instantiation)
- [ ] Reuses existing business functions where possible
- [ ] No duplicate selector definitions
- [ ] Helper functions extracted for repeated logic
- [ ] Proper browser cleanup in afterAll
- [ ] Test data from testData.js (no hardcoded tokens)
- [ ] Selectors use data-qa or ARIA roles
- [ ] Tags added for test filtering
- [ ] Comments are minimal but meaningful
- [ ] No console.log in production tests (use expect assertions)
- [ ] File under 400 lines

---

## 📝 Code Review Checklist

### Structure
- [ ] Correct import order
- [ ] TEST CONFIGURATION section present
- [ ] SELECTORS object defined
- [ ] Helper functions have JSDoc comments

### Quality
- [ ] DRY principle followed
- [ ] No hardcoded values
- [ ] Proper error handling (try-catch where needed)
- [ ] Timeouts are reasonable (not excessive)

### Framework Compliance
- [ ] Uses launchBrowser() from config
- [ ] Uses POmanager for page objects
- [ ] Uses existing business functions
- [ ] Follows existing spec file patterns

---

## 🚀 Powered by Doremon Team
