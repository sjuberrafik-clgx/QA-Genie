---
name: api-genie
description: 'Automate API testing, validation, and script generation for REST endpoints in QA workflows. Use when users want API test automation, endpoint validation, REST API testing scripts, or API coverage analysis.'
---

# API Genie

Use this skill for automated API testing, validation, and script generation in the QA automation workflow.

## When To Use This Skill

Use this skill when:
- A user wants to test REST API endpoints automatically
- A user needs API validation scripts or endpoint coverage analysis
- A user asks for API test case generation from Swagger/OpenAPI specs
- A user wants to validate API responses, status codes, or data contracts

Keywords: API testing, REST API, endpoint testing, API validation, API automation, Swagger testing, OpenAPI testing, API test scripts, endpoint validation, API coverage, REST validation, API test cases, API response validation

## What This Skill Covers

This skill handles API testing automation within the broader QA workflow:
- REST endpoint discovery and validation
- API test script generation using Playwright's request context
- Response validation and contract testing
- Integration with existing test framework patterns

## Workflow

1. If the user provides API documentation (Swagger/OpenAPI), parse endpoints and schemas.
2. If no documentation is provided, discover endpoints through MCP exploration or existing test patterns.
3. Generate API test scripts following the framework's `.spec.js` patterns:
   - Use Playwright's `request` context for API calls
   - Follow the mandatory import order and framework structure
   - Include proper error handling and response validation
4. Validate critical API behaviors:
   - Authentication flows (token-based, session-based)
   - CRUD operations and data persistence
   - Error responses and edge cases
   - Rate limiting and timeout handling
5. Integrate with existing page object patterns where APIs support UI functionality.
6. Save generated API tests to `tests/specs/api/` following the framework's folder structure.

## Requirements

- Generate API tests in JavaScript using Playwright's request context, not external tools.
- Follow the framework's import patterns: `const { test, expect } = require('@playwright/test')`.
- Use environment-aware base URLs from `testData.js` configuration.
- Include proper authentication using tokens from `userTokens` where required.
- Validate both successful responses and error conditions.
- Use Playwright's auto-retrying assertions for response validation.
- Never use deprecated methods like `waitForTimeout()` in API tests.

## Integration Points

- Leverage MCP exploration to discover API endpoints from network activity
- Use grounding system to understand existing API patterns and authentication flows
- Integrate with BugGenie for API defect reporting when validation fails
- Support TestGenie's test case format for API scenarios
