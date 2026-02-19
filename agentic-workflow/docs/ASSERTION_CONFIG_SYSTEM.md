# Assertion Configuration System

## Overview

The **Assertion Configuration System** provides a framework-agnostic, centralized way to manage test assertions across different automation frameworks. This enables consistent test generation regardless of whether you're using Playwright, Selenium, Cypress, or WebdriverIO.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ASSERTION CONFIGURATION SYSTEM                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐   │
│  │ assertion-config.   │────►│ AssertionConfigHelper            │   │
│  │ schema.json         │     │ (utils/assertionConfigHelper.js) │   │
│  │ (Validation)        │     └──────────────────────────────────┘   │
│  └─────────────────────┘                    │                        │
│                                             ▼                        │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐   │
│  │ assertion-config.   │────►│ ScriptGenerator Agent            │   │
│  │ json                │     │ (.github/agents/scriptgenerator) │   │
│  │ (Configuration)     │     └──────────────────────────────────┘   │
│  └─────────────────────┘                    │                        │
│                                             ▼                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    GENERATED TEST SCRIPTS                       ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────────┐   ││
│  │  │Playwright│ │Selenium │ │ Cypress │ │ WebdriverIO         │   ││
│  │  │.spec.js  │ │.test.js │ │.cy.js   │ │ .e2e.js             │   ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Check Active Framework

```javascript
const { getAssertionHelper } = require('./utils/assertionConfigHelper');
const helper = getAssertionHelper();

console.log(helper.getActiveFramework()); // 'playwright'
```

### 2. Switch Framework

Edit `assertion-config.json`:

```json
{
    "activeFramework": "selenium"
}
```

Or programmatically:

```javascript
helper.setActiveFramework('selenium');
```

### 3. Generate Framework-Specific Assertion

```javascript
// Generates correct assertion for active framework
const code = helper.generateAssertion('visibility', {
    locator: 'page.getByRole("button")',
    customMessage: 'Submit button should be visible'
});

// Playwright: await expect(page.getByRole("button"), 'Submit button should be visible').toBeVisible()
// Selenium:   await driver.wait(until.elementIsVisible(element), 30000)
// Cypress:    cy.get(page.getByRole("button")).should('be.visible')
```

## Configuration Structure

### assertion-config.json

```json
{
    "$schema": "./assertion-config.schema.json",
    "version": "1.0.0",
    "activeFramework": "playwright",
    "globalSettings": {
        "defaultTimeout": 30000,
        "retryCount": 3,
        "softAssertionsEnabled": true,
        "screenshotOnFailure": true,
        "customMessagesRequired": true
    },
    "frameworks": {
        "playwright": { ... },
        "selenium": { ... },
        "cypress": { ... },
        "webdriverio": { ... }
    }
}
```

### Framework Configuration

Each framework has:

| Property | Description |
|----------|-------------|
| `name` | Display name |
| `version` | Recommended version |
| `documentation` | Official docs URL |
| `import` | Import statement for scripts |
| `assertions` | Categorized assertion definitions |
| `antiPatterns` | Code patterns to avoid |
| `bestPractices` | Recommended patterns |
| `selectorStrategies` | Selector priority order |

## Assertion Categories

### 1. Visibility Assertions

| Assertion | Playwright | Selenium | Cypress | WebdriverIO |
|-----------|------------|----------|---------|-------------|
| Element visible | `toBeVisible()` | `until.elementIsVisible()` | `should('be.visible')` | `toBeDisplayed()` |
| Element hidden | `toBeHidden()` | `until.elementIsNotVisible()` | `should('not.be.visible')` | `not.toBeDisplayed()` |
| In viewport | `toBeInViewport()` | N/A | N/A | `toBeDisplayedInViewport()` |
| Exists in DOM | `toBeAttached()` | `until.elementLocated()` | `should('exist')` | `toExist()` |

### 2. State Assertions

| Assertion | Playwright | Selenium | Cypress | WebdriverIO |
|-----------|------------|----------|---------|-------------|
| Enabled | `toBeEnabled()` | `until.elementIsEnabled()` | `should('be.enabled')` | `toBeEnabled()` |
| Disabled | `toBeDisabled()` | N/A | `should('be.disabled')` | `toBeDisabled()` |
| Checked | `toBeChecked()` | `until.elementIsSelected()` | `should('be.checked')` | `toBeSelected()` |
| Focused | `toBeFocused()` | N/A | `should('be.focused')` | `toBeFocused()` |
| Editable | `toBeEditable()` | N/A | N/A | N/A |

### 3. Content Assertions

| Assertion | Playwright | Selenium | Cypress | WebdriverIO |
|-----------|------------|----------|---------|-------------|
| Exact text | `toHaveText()` | `until.elementTextIs()` | `should('have.text')` | `toHaveText()` |
| Contains text | `toContainText()` | `until.elementTextContains()` | `should('contain')` | `toHaveTextContaining()` |
| Input value | `toHaveValue()` | N/A | `should('have.value')` | `toHaveValue()` |
| Element count | `toHaveCount()` | N/A | `should('have.length')` | `toHaveChildren()` |

### 4. Attribute Assertions

| Assertion | Playwright | Selenium | Cypress | WebdriverIO |
|-----------|------------|----------|---------|-------------|
| Has attribute | `toHaveAttribute()` | N/A | `should('have.attr')` | `toHaveAttribute()` |
| Has class | `toHaveClass()` | N/A | `should('have.class')` | `toHaveElementClass()` |
| Has CSS | `toHaveCSS()` | N/A | `should('have.css')` | N/A |
| Has ID | `toHaveId()` | N/A | `should('have.id')` | `toHaveId()` |

### 5. Page Assertions

| Assertion | Playwright | Selenium | Cypress | WebdriverIO |
|-----------|------------|----------|---------|-------------|
| URL matches | `toHaveURL()` | `until.urlContains()` | `cy.url().should('include')` | `toHaveUrl()` |
| Title matches | `toHaveTitle()` | `until.titleContains()` | `cy.title().should('include')` | `toHaveTitle()` |

## Anti-Patterns

The system detects and prevents these common mistakes:

### High Severity

| ID | Pattern | Problem | Solution |
|----|---------|---------|----------|
| AP001 | `expect(await el.textContent()).toEqual(text)` | No auto-retry | `await expect(el).toHaveText(text)` |
| AP002 | `expect(await el.isVisible()).toBe(true)` | Snapshot in time | `await expect(el).toBeVisible()` |
| AP003 | `await page.waitForTimeout(ms)` | Arbitrary wait | Use assertions or `waitForLoadState` |

### Medium Severity

| ID | Pattern | Problem | Solution |
|----|---------|---------|----------|
| AP004 | `expect(await el.isEnabled()).toBe(true)` | No retry | `await expect(el).toBeEnabled()` |
| AP005 | `expect(await el.getAttribute('class')).toContain(cls)` | No retry | `await expect(el).toHaveClass(/cls/)` |
| AP006 | `if (await el.isVisible()) { }` | Race condition | `el.waitFor({ state: 'visible' }).catch(...)` |

## Best Practices

### Required (Must Follow)

| ID | Practice |
|----|----------|
| BP001 | Always use auto-retrying assertions for DOM elements |
| BP010 | Validate page state after navigation |

### Recommended

| ID | Practice |
|----|----------|
| BP002 | Add custom error messages for clarity |
| BP003 | Use soft assertions for non-critical checks |
| BP004 | Use regex for flexible text matching |
| BP005 | Use `toContainText` for partial matches |
| BP006 | Chain multiple assertions for complete validation |

### Optional

| ID | Practice |
|----|----------|
| BP007 | Use `expect.poll` for API/custom retry logic |
| BP008 | Use `expect.toPass` for complex retry blocks |
| BP009 | Configure custom timeout for slow elements |

## Selector Strategies

### Playwright (Priority Order)

1. `getByRole` - Accessibility-based (most resilient)
2. `getByTestId` - Data attribute (stable for automation)
3. `getByLabel` - Form field friendly
4. `getByPlaceholder` - Input placeholder text
5. `getByText` - Visible text content
6. `getByAltText` - Image alt text
7. `locator` - CSS/XPath fallback

### Selenium (Priority Order)

1. `By.id` - Most stable
2. `By.name` - Name attribute
3. `By.css` - CSS selector
4. `By.xpath` - Most flexible
5. `By.linkText` - Exact link text
6. `By.partialLinkText` - Partial link text

### Cypress (Priority Order)

1. `data-cy` - Custom Cypress attribute
2. `data-testid` - Generic test ID
3. `id` - ID selector
4. `class` - CSS class

## Adding a New Framework

To add support for a new framework (e.g., TestCafe):

### 1. Update Schema

Add the new framework to the `activeFramework` enum in `assertion-config.schema.json`:

```json
"activeFramework": {
    "enum": ["playwright", "selenium", "cypress", "webdriverio", "puppeteer", "testcafe"]
}
```

### 2. Add Framework Configuration

Add to `assertion-config.json`:

```json
"testcafe": {
    "name": "TestCafe",
    "version": "^3.0.0",
    "documentation": "https://testcafe.io/documentation/402837/guides",
    "import": {
        "statement": "import { Selector, t } from 'testcafe';",
        "destructure": ["Selector", "t"]
    },
    "assertions": {
        "visibility": {
            "ok": {
                "syntax": "await t.expect(Selector(selector).visible).ok()",
                "description": "Assert element is visible",
                "autoRetry": true,
                "example": "await t.expect(Selector('#submit').visible).ok();",
                "tags": ["visibility", "ui"]
            }
        }
        // ... more assertions
    },
    "antiPatterns": [],
    "bestPractices": [],
    "selectorStrategies": {
        "priority": [
            { "rank": 1, "strategy": "data-testid", "description": "Test ID", "example": "Selector('[data-testid=\"submit\"]')" }
        ]
    }
}
```

### 3. Update Helper (Optional)

If the framework has unique patterns, update `assertionConfigHelper.js`:

```javascript
const mappings = {
    // ... existing frameworks
    testcafe: {
        visibility: `await t.expect(Selector(${locator}).visible).ok()`,
        // ... more mappings
    }
};
```

## API Reference

### AssertionConfigHelper Methods

| Method | Description |
|--------|-------------|
| `getActiveFramework()` | Get current framework name |
| `setActiveFramework(name)` | Change active framework |
| `getFrameworkConfig(name?)` | Get framework configuration |
| `getImportStatement()` | Get import statement for scripts |
| `getAssertionsByCategory(category)` | Get assertions in a category |
| `getAutoRetryingAssertions()` | Get all auto-retry assertions |
| `getAssertion(name)` | Find assertion by name |
| `findAssertionsByTag(tag)` | Find assertions by tag |
| `getAntiPatterns()` | Get anti-patterns list |
| `getBestPractices(priority?)` | Get best practices |
| `getSelectorStrategies()` | Get selector priorities |
| `generateAssertion(type, options)` | Generate assertion code |
| `generateAssertionTemplate(elementType)` | Get assertion template |
| `validateCode(code)` | Check for anti-patterns |
| `getAvailableFrameworks()` | List all frameworks |
| `exportSummary()` | Export config summary |

## CLI Usage

Run the helper directly for a quick summary:

```bash
node utils/assertionConfigHelper.js
```

Output:
```
📋 Assertion Configuration Summary
===================================

Active Framework: playwright
Version: ^1.40.0
Documentation: https://playwright.dev/docs/test-assertions
Total Assertions: 45
Categories: visibility, state, content, attribute, page, network, accessibility, advanced, generic
Anti-patterns: 6
Best Practices: 10

🎯 Selector Strategies (Priority Order):
  1. getByRole - Accessibility-based, most resilient
  2. getByTestId - Data attribute, stable for automation
  ...

⚠️ Anti-patterns to Avoid:
  ❌ expect(await element.textContent()).toEqual(text)
     → Use: await expect(element).toHaveText(text)
  ...

✅ Required Best Practices:
  • Always use auto-retrying assertions for DOM elements
  • Validate page state after navigation
```

## Integration with ScriptGenerator Agent

The ScriptGenerator agent automatically:

1. **Reads active framework** from `assertion-config.json`
2. **Uses correct import statements** for the framework
3. **Applies assertion syntax** specific to the framework
4. **Validates generated code** against anti-patterns
5. **Ensures best practices** are followed

### Agent Workflow

```
1. Load assertion-config.json
2. Determine active framework
3. For each test step:
   a. Identify validation need (visibility, content, etc.)
   b. Look up assertion in appropriate category
   c. Apply correct syntax
   d. Add custom error message (if BP002 applies)
   e. Use soft assertion for non-critical checks (if BP003 applies)
4. Validate complete script against anti-patterns
5. Generate framework-compliant test file
```

## Troubleshooting

### "Unknown framework" Error

Ensure the framework is defined in both:
- `assertion-config.json` → `frameworks` object
- `assertion-config.schema.json` → `activeFramework` enum

### Validation Type Not Supported

Check if the validation type exists in `generateAssertion()` mappings:

```javascript
// Available types:
visibility, hidden, enabled, disabled, text, containsText, 
value, checked, focused, count, url, title, attribute
```

### Anti-pattern Detection False Positive

Some patterns may be valid in specific contexts. Review the `antiPatterns` array and adjust if needed:

```json
"antiPatterns": [
    {
        "id": "AP001",
        "pattern": "...",
        "severity": "high"  // Change to "medium" or remove if needed
    }
]
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-05 | Initial release with Playwright, Selenium, Cypress, WebdriverIO |

---

**Maintained by:** QA Automation Team  
**Last Updated:** February 5, 2026
