/**
 * Test Iteration Engine with Playwright MCP
 * Intelligently fixes failing tests using live application exploration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class TestIterationEngine {
    constructor() {
        this.maxIterations = 2;  // ALIGNED: 2 iterations then auto-BugGenie
        this.mcpAvailable = false;
    }

    /**
     * Run tests and iterate with MCP until they pass
     */
    async runTestsWithIteration(ticketId, specPath, environment, testDataUrl) {
        console.log('\n' + '═'.repeat(80));
        console.log('🔄 TEST ITERATION ENGINE');
        console.log('═'.repeat(80));

        let iteration = 0;
        let allTestsPassed = false;
        let lastError = null;

        while (iteration < this.maxIterations && !allTestsPassed) {
            iteration++;

            console.log(`\n📍 ITERATION ${iteration}/${this.maxIterations}`);
            console.log('━'.repeat(80));

            // Run tests
            const testResult = await this.runTests(specPath);

            if (testResult.passed) {
                console.log(`\n✅ All tests passed on iteration ${iteration}!`);
                allTestsPassed = true;
                break;
            }

            // Tests failed - analyze and fix
            console.log(`\n❌ Tests failed: ${testResult.failedCount}/${testResult.totalCount}`);
            console.log(`   Failed tests: ${testResult.failedTests.join(', ')}`);

            if (iteration < this.maxIterations) {
                console.log(`\n🔧 Attempting to fix tests using Playwright MCP...`);

                const fixResult = await this.fixTestsWithMCP(
                    ticketId,
                    specPath,
                    testResult,
                    environment,
                    testDataUrl
                );

                if (!fixResult.success) {
                    console.warn(`⚠️  Could not auto-fix tests: ${fixResult.error}`);
                    lastError = fixResult.error;
                    break;
                }

                console.log(`✅ Applied ${fixResult.changesCount} fixes to test file`);
            }
        }

        return {
            success: allTestsPassed,
            iterations: iteration,
            lastError: lastError,
            message: allTestsPassed
                ? `Tests passed after ${iteration} iteration(s)`
                : `Tests still failing after ${iteration} iterations`
        };
    }

    /**
     * Run Playwright tests and collect results
     */
    async runTests(specPath) {
        try {
            // Normalize path to use forward slashes for Playwright CLI
            const normalizedPath = specPath.replace(/\\/g, '/');
            console.log(`\n🧪 Executing tests: ${normalizedPath}`);

            const output = execSync(
                `npx playwright test "${normalizedPath}" --reporter=json`,
                { encoding: 'utf-8', stdio: 'pipe' }
            );

            // Parse JSON output
            const result = JSON.parse(output);
            const totalTests = result.suites[0]?.specs?.length || 0;
            const failedTests = result.suites[0]?.specs?.filter(s => s.tests[0].status === 'failed') || [];

            return {
                passed: failedTests.length === 0,
                totalCount: totalTests,
                failedCount: failedTests.length,
                failedTests: failedTests.map(s => s.title)
            };

        } catch (error) {
            // Parse error output for failed tests
            const errorOutput = error.stdout || error.message;

            // Extract failed test names from output
            const failedTests = this.parseFailedTests(errorOutput);

            return {
                passed: false,
                totalCount: failedTests.length,
                failedCount: failedTests.length,
                failedTests: failedTests,
                error: errorOutput
            };
        }
    }

    /**
     * Parse failed test names from output
     */
    parseFailedTests(output) {
        const failedTests = [];
        const regex = /›\s+(.+?)$/gm;
        let match;

        while ((match = regex.exec(output)) !== null) {
            if (match[1] && !failedTests.includes(match[1])) {
                failedTests.push(match[1].trim());
            }
        }

        return failedTests.length > 0 ? failedTests : ['Unknown test'];
    }

    /**
     * Fix failing tests using Playwright MCP exploration
     */
    async fixTestsWithMCP(ticketId, specPath, testResult, environment, testDataUrl) {
        console.log('\n🔍 Launching Playwright MCP for live exploration...');

        try {
            // This would call the scriptgenerator agent with MCP instructions
            // For now, we'll create a prompt for the agent

            const fixPrompt = `URGENT: Fix failing tests for ${ticketId} using Playwright MCP

Test file: ${specPath}
Failed tests: ${testResult.failedTests.join(', ')}
Environment: ${environment}
Test Data: ${testDataUrl}

ERROR ANALYSIS:
${testResult.error ? testResult.error.substring(0, 500) : 'Tests timing out - selectors not found'}

🚨 MANDATORY STEPS TO FIX:

1. **Launch Playwright MCP Browser**
   - Use: unified_navigate to open the application
   - Navigate to the test URL with proper authentication tokens

2. **Take DOM Snapshot**
   - Use: unified_snapshot({ verbose: true })
   - Analyze the actual DOM structure
   - Find the correct selectors for elements

3. **Identify Missing/Incorrect Selectors**
   - Compare expected selectors vs actual DOM
   - Look for buttons, links, forms with the target functionality
   - Check multiple selector strategies: role, text, test-id, class

4. **Update Test File**
   - Replace incorrect selectors with working ones from DOM
   - Add fallback selectors for reliability
   - Update helper functions with correct element locators

5. **Verify Fix**
   - Close browser after exploration
   - The workflow will re-run tests automatically

AVAILABLE MCP TOOLS:
- unified_navigate: Navigate to URL
- unified_snapshot: Get DOM structure
- unified_take_screenshot: Visual verification
- unified_console_messages: Check for JS errors
- unified_evaluate: Run custom JS to test selectors
- unified_wait_for: Wait for elements
- unified_close: Cleanup

FOCUS: Find the actual selectors for the failing elements and update the test file.
DO NOT assume selectors - ALWAYS use MCP to verify against live application.`;

            console.log('\n📝 Calling scriptgenerator agent for MCP-based fixes...');
            console.log(fixPrompt);

            // In a real implementation, this would invoke the scriptgenerator agent
            // For now, return a placeholder

            return {
                success: false,
                error: 'MCP fix requires manual agent invocation',
                changesCount: 0
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = { TestIterationEngine };
