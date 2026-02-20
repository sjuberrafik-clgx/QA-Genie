const fs = require('fs');
const path = require('path');

/**
 * Validate generated script follows framework conventions
 */
function validateGeneratedScript(scriptPath, scriptContent) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ VALIDATING GENERATED SCRIPT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const errors = [];
    const warnings = [];

    // 1. File Extension Check
    if (!scriptPath.endsWith('.spec.js')) {
        errors.push(`❌ CRITICAL: File must use .spec.js extension, not ${path.extname(scriptPath)}`);
        console.log(`❌ File extension: ${path.extname(scriptPath)} (MUST be .spec.js)`);
    } else {
        console.log('✅ File extension: .spec.js');
    }

    // 2. Import Style Check (CommonJS)
    if (scriptContent.includes('import {') || scriptContent.includes('import *')) {
        errors.push('❌ CRITICAL: Must use require(), not ES6 import statements');
        console.log('❌ Import style: ES6 imports (MUST use require())');
    } else if (scriptContent.includes("require('@playwright/test')")) {
        console.log('✅ Import style: CommonJS require()');
    } else {
        errors.push('❌ CRITICAL: Missing required imports');
    }

    // 3. Browser Setup Check
    if (!scriptContent.includes('launchBrowser()') && !scriptContent.includes('launchBrowser(')) {
        errors.push('❌ CRITICAL: Must use launchBrowser() from config/config.js or config/browser-manager.js, not manual browser setup');
        console.log('❌ Browser setup: Manual (MUST use launchBrowser())');
    } else {
        console.log('✅ Browser setup: launchBrowser()');
    }

    // 4. POmanager Check
    if (scriptContent.includes('class ') && scriptContent.includes('Page {')) {
        errors.push('❌ CRITICAL: Must use POmanager, not custom page object classes');
        console.log('❌ Page objects: Custom classes (MUST use POmanager)');
    } else if (scriptContent.includes('new POmanager') || scriptContent.includes('POmanager')) {
        console.log('✅ Page objects: POmanager');
    } else {
        warnings.push('⚠️ WARNING: POmanager not detected - ensure page objects are used correctly');
    }

    // 5. Authentication Check
    if (!scriptContent.includes('userTokens')) {
        warnings.push('⚠️ WARNING: userTokens not detected - may need manual authentication');
        console.log('⚠️ Authentication: Manual (SHOULD use userTokens)');
    } else {
        console.log('✅ Authentication: userTokens');
    }

    // 6. Browser Cleanup Check
    if (!scriptContent.includes('test.afterAll') && !scriptContent.includes('test.afterEach')) {
        errors.push('❌ CRITICAL: Missing test.afterAll() or test.afterEach() browser cleanup');
        console.log('❌ Browser cleanup: Missing afterAll/afterEach()');
    } else if (!scriptContent.includes('browser.close()') && !scriptContent.includes('cleanup')) {
        errors.push('❌ CRITICAL: Missing browser.close() or cleanup in afterAll/afterEach()');
        console.log('❌ Browser cleanup: No browser.close()');
    } else {
        console.log('✅ Browser cleanup: Proper lifecycle hooks with browser.close()');
    }

    // 7. TypeScript Syntax Check
    if (scriptContent.includes(': Page') || scriptContent.includes(': string') ||
        scriptContent.includes('async (): Promise<')) {
        errors.push('❌ CRITICAL: Contains TypeScript syntax - must be pure JavaScript');
        console.log('❌ Language: TypeScript (MUST be JavaScript)');
    } else {
        console.log('✅ Language: JavaScript');
    }

    // 8. URL Hardcoding Check — detect any environment URLs hardcoded in scripts
    let ppVal;
    try { ppVal = require('../utils/project-path-resolver').getProjectPaths(); } catch { ppVal = null; }
    const knownUrls = [
        ppVal?.environments?.UAT?.baseUrl,
        'https://uat-oh.onehome.com'
    ].filter(Boolean);
    const hasHardcodedUrl = knownUrls.some(u => u && scriptContent.includes(u));
    if (hasHardcodedUrl) {
        warnings.push('⚠️ WARNING: URL hardcoded - should use baseUrl from testData');
        console.log('⚠️ URLs: Hardcoded (SHOULD use baseUrl)');
    } else if (scriptContent.includes('baseUrl')) {
        console.log('✅ URLs: Using baseUrl from testData');
    }

    // 8b. Hardcoded Token Check — detect token= in URLs (will expire)
    const tokenInUrl = scriptContent.match(/['"`][^'"`]*token=[a-zA-Z0-9._-]{20,}[^'"`]*['"`]/g);
    if (tokenInUrl && tokenInUrl.length > 0) {
        errors.push(`❌ CRITICAL: Found ${tokenInUrl.length}x hardcoded token in URL — must use userTokens from testData.js`);
        console.log(`❌ Tokens: ${tokenInUrl.length}x hardcoded token= in URL (MUST use userTokens)`);
    }

    // 8c. PopupHandler Check — must use PopupHandler utility, not inline popup code
    if (!scriptContent.includes('PopupHandler') && !scriptContent.includes('popupHandler')) {
        const hasInlinePopup = /async\s+function\s+dismiss\w*\s*\(/i.test(scriptContent) ||
            scriptContent.includes('welcome-modal') ||
            scriptContent.includes('welcomeModal') ||
            scriptContent.includes('welcome-container');
        if (hasInlinePopup) {
            errors.push('❌ CRITICAL: Inline popup dismissal code detected — must use PopupHandler from utils/popupHandler.js');
            console.log('❌ Popup handling: Inline code (MUST use PopupHandler)');
        }
    } else {
        console.log('✅ Popup handling: PopupHandler utility');
    }

    // 8d. Context/Browser Cleanup Check — afterAll must close page + context + browser
    if (scriptContent.includes('test.afterAll')) {
        const missingCleanup = [];
        if (!scriptContent.includes('context.close()') && !scriptContent.includes('context?.close()')) {
            missingCleanup.push('context.close()');
        }
        if (!scriptContent.includes('browser.close()') && !scriptContent.includes('browser?.close()')) {
            missingCleanup.push('browser.close()');
        }
        if (missingCleanup.length > 0) {
            errors.push(`❌ CRITICAL: afterAll missing cleanup: ${missingCleanup.join(', ')} — will leak browser processes`);
            console.log(`❌ Cleanup: Missing ${missingCleanup.join(', ')} in afterAll`);
        }
    }

    // 9. Helper Functions Check (code optimization)
    const helperFunctionMatches = scriptContent.match(/const \w+ = async \(/g) || [];
    const helperCount = helperFunctionMatches.length;

    if (helperCount >= 3) {
        console.log(`✅ Code optimization: ${helperCount} helper functions (excellent)`);
    } else if (helperCount >= 1) {
        console.log(`⚠️ Code optimization: ${helperCount} helper functions (acceptable)`);
    } else {
        warnings.push('⚠️ WARNING: No helper functions detected - consider DRY principle');
        console.log('⚠️ Code optimization: No helper functions (consider refactoring)');
    }

    // 10. Script Length Check
    const lines = scriptContent.split('\n').length;
    if (lines <= 250) {
        console.log(`✅ Script length: ${lines} lines (optimal)`);
    } else if (lines <= 350) {
        console.log(`⚠️ Script length: ${lines} lines (acceptable but could be optimized)`);
    } else {
        warnings.push(`⚠️ WARNING: Script is ${lines} lines - consider more helper functions`);
        console.log(`⚠️ Script length: ${lines} lines (needs optimization)`);
    }

    // 11. Selector Quality Check — detect broken/guessed selector patterns
    const brokenSelectorPatterns = [
        { pattern: /page\.locator\(\s*'\[data-mcp-ref=/g, label: '[data-mcp-ref=...] (non-existent DOM attribute)' },
        { pattern: /page\.locator\(\s*'\[data-ref="/g, label: '[data-ref="..."] (non-existent DOM attribute)' },
        { pattern: /page\.getByTestId\(\s*'s1e\d+'\s*\)/g, label: 'getByTestId("s1eXX") (uses internal snapshot ref as testId)' },
        { pattern: /page\.locator\(\s*'\[ref="/g, label: '[ref="..."] (internal snapshot ref, not a DOM attribute)' },
    ];

    let brokenSelectorCount = 0;
    for (const { pattern, label } of brokenSelectorPatterns) {
        const matches = scriptContent.match(pattern);
        if (matches && matches.length > 0) {
            brokenSelectorCount += matches.length;
            errors.push(`❌ CRITICAL: Found ${matches.length}x broken selector pattern: ${label}`);
            console.log(`❌ Selector quality: ${matches.length}x ${label}`);
        }
    }

    // Detect fragile bare-tag selectors (e.g. page.locator('div'), page.click('button'))
    const bareTagPattern = /(?:page\.locator|page\.click|page\.fill|page\.type)\(\s*'(div|span|button|input|a|select|textarea|label|ul|li|p|h[1-6])'\s*\)/g;
    const bareTagMatches = scriptContent.match(bareTagPattern);
    if (bareTagMatches && bareTagMatches.length > 0) {
        warnings.push(`⚠️ WARNING: Found ${bareTagMatches.length}x bare-tag selector (fragile, will match multiple elements)`);
        console.log(`⚠️ Selector quality: ${bareTagMatches.length}x bare-tag selectors`);
    }

    // Check for dynamic-looking text in exact-match selectors
    const dynamicTextInSelector = /page\.getByText\(\s*'[^']*(\$[\d,]+|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d+\s+results?)[^']*'\s*\)/g;
    const dynamicTextMatches = scriptContent.match(dynamicTextInSelector);
    if (dynamicTextMatches && dynamicTextMatches.length > 0) {
        warnings.push(`⚠️ WARNING: Found ${dynamicTextMatches.length}x selector with dynamic text (prices/dates/counts) - will break across runs`);
        console.log(`⚠️ Selector quality: ${dynamicTextMatches.length}x dynamic text in selectors`);
    }

    if (brokenSelectorCount === 0 && (!bareTagMatches || bareTagMatches.length === 0)) {
        console.log('✅ Selector quality: No broken or fragile selector patterns detected');
    }

    // 12. Anti-Pattern Detection (AP001-AP006 from assertion-config)
    console.log('\n── Anti-Pattern Detection ──');

    // AP001: Non-retrying text assertion
    const ap001 = scriptContent.match(/expect\(\s*await\s+\w+\.textContent\(\)\s*\)\s*\.\s*(toEqual|toContain|toBe)\(/g);
    if (ap001 && ap001.length > 0) {
        errors.push(`❌ AP001: ${ap001.length}x non-retrying text assertion — use await expect(element).toHaveText() or toContainText() instead`);
        console.log(`❌ AP001: ${ap001.length}x expect(await el.textContent()).toEqual/toContain (non-retrying)`);
    }

    // AP002: Non-retrying visibility check
    const ap002 = scriptContent.match(/expect\(\s*await\s+\w+\.isVisible\(\)\s*\)\s*\.\s*toBe\(\s*true\s*\)/g);
    if (ap002 && ap002.length > 0) {
        errors.push(`❌ AP002: ${ap002.length}x non-retrying visibility check — use await expect(element).toBeVisible() instead`);
        console.log(`❌ AP002: ${ap002.length}x expect(await el.isVisible()).toBe(true) (non-retrying)`);
    }

    // AP003: Arbitrary waitForTimeout
    const ap003 = scriptContent.match(/page\.waitForTimeout\(\s*\d+\s*\)/g);
    if (ap003 && ap003.length > 0) {
        warnings.push(`⚠️ AP003: ${ap003.length}x waitForTimeout() — replace with condition-based waits (waitFor, toBeVisible, waitForLoadState)`);
        console.log(`⚠️ AP003: ${ap003.length}x page.waitForTimeout() (use condition-based waits instead)`);
    }

    // AP004: Non-retrying enabled check
    const ap004 = scriptContent.match(/expect\(\s*await\s+\w+\.isEnabled\(\)\s*\)\s*\.\s*toBe\(\s*true\s*\)/g);
    if (ap004 && ap004.length > 0) {
        errors.push(`❌ AP004: ${ap004.length}x non-retrying enabled check — use await expect(element).toBeEnabled() instead`);
        console.log(`❌ AP004: ${ap004.length}x expect(await el.isEnabled()).toBe(true) (non-retrying)`);
    }

    // AP005: Non-retrying class check
    const ap005 = scriptContent.match(/expect\(\s*await\s+\w+\.getAttribute\(\s*['"]class['"]\s*\)\s*\)\s*\.\s*toContain\(/g);
    if (ap005 && ap005.length > 0) {
        errors.push(`❌ AP005: ${ap005.length}x non-retrying class check — use await expect(element).toHaveClass() instead`);
        console.log(`❌ AP005: ${ap005.length}x expect(await el.getAttribute('class')).toContain (non-retrying)`);
    }

    // AP006: Vacuous assertions (|| true).toBeTruthy()
    const ap006 = scriptContent.match(/expect\([^)]*\|\|\s*true\s*\)\s*\.\s*toBeTruthy\(\)/g);
    if (ap006 && ap006.length > 0) {
        errors.push(`❌ AP006: ${ap006.length}x vacuous assertion (|| true).toBeTruthy() — always passes, replace with real assertion`);
        console.log(`❌ AP006: ${ap006.length}x expect(x || true).toBeTruthy() (vacuous — always passes)`);
    }

    // Deprecated method: .type() (use .fill() or .pressSequentially())
    const deprecatedType = scriptContent.match(/\.\s*type\(\s*['"][^'"]*['"]/g);
    if (deprecatedType && deprecatedType.length > 0) {
        warnings.push(`⚠️ DEPRECATED: ${deprecatedType.length}x .type() — use .fill() or .pressSequentially() instead`);
        console.log(`⚠️ DEPRECATED: ${deprecatedType.length}x .type() (use .fill() or .pressSequentially())`);
    }

    // Deprecated method: .waitForNavigation()
    const deprecatedNav = scriptContent.match(/\.waitForNavigation\(/g);
    if (deprecatedNav && deprecatedNav.length > 0) {
        warnings.push(`⚠️ DEPRECATED: ${deprecatedNav.length}x .waitForNavigation() — use waitForURL() or waitForLoadState() instead`);
        console.log(`⚠️ DEPRECATED: ${deprecatedNav.length}x .waitForNavigation() (use waitForURL() or waitForLoadState())`);
    }

    // 13. Serial Execution Check
    if (scriptContent.includes('test.describe(') && !scriptContent.includes('test.describe.serial(')) {
        warnings.push('⚠️ WARNING: test.describe() without .serial — tests sharing browser state should use test.describe.serial()');
        console.log('⚠️ Execution mode: test.describe() (SHOULD use test.describe.serial() for shared-state tests)');
    } else if (scriptContent.includes('test.describe.serial(')) {
        console.log('✅ Execution mode: test.describe.serial()');
    }

    // 14. Popup Handler Check
    if (!scriptContent.includes('popupHandler') && !scriptContent.includes('PopupHandler') &&
        !scriptContent.includes('dismissWelcome') && !scriptContent.includes('dismissAll')) {
        const hasCustomPopup = scriptContent.includes('welcome-modal') || scriptContent.includes('welcomeModal');
        if (hasCustomPopup) {
            warnings.push('⚠️ WARNING: Custom popup handler detected — use PopupHandler from utils/popupHandler.js instead');
            console.log('⚠️ Popup handling: Custom inline (SHOULD use PopupHandler utility)');
        }
    } else {
        console.log('✅ Popup handling: PopupHandler utility');
    }

    const apCount = [ap001, ap002, ap003, ap004, ap005, ap006].filter(m => m && m.length > 0).length;
    if (apCount === 0) {
        console.log('✅ Anti-patterns: None detected');
    }

    // 15. Import-Exists Validation — verify all require() paths resolve to real files
    console.log('\n── Import-Exists Validation ──');
    const requireMatches = [...scriptContent.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)];
    let phantomCount = 0;
    const scriptDir = path.dirname(scriptPath);

    for (const match of requireMatches) {
        const importPath = match[1];
        // Skip node_modules / @playwright imports (they don't start with ./ or ../)
        // The regex already filters to relative paths only

        // Resolve relative to the script's directory
        let resolvedPath = path.resolve(scriptDir, importPath);
        // Try with .js extension if not already specified
        const candidates = [resolvedPath];
        if (!resolvedPath.endsWith('.js')) candidates.push(resolvedPath + '.js');
        if (!resolvedPath.endsWith('.json')) candidates.push(resolvedPath + '.json');
        // Also try as directory with index.js
        candidates.push(path.join(resolvedPath, 'index.js'));

        const exists = candidates.some(c => fs.existsSync(c));
        if (!exists) {
            phantomCount++;
            errors.push(`❌ PHANTOM IMPORT: require('${importPath}') — file does not exist at ${resolvedPath}`);
            console.log(`❌ PHANTOM: require('${importPath}') → file not found`);
        }
    }

    if (phantomCount === 0 && requireMatches.length > 0) {
        console.log(`✅ Import paths: All ${requireMatches.length} require() paths resolve to existing files`);
    } else if (requireMatches.length === 0) {
        console.log('⚠️ Import paths: No relative require() statements found');
    }

    console.log('');

    // Display Results
    if (errors.length > 0) {
        console.log('🚨 VALIDATION FAILED - CRITICAL ERRORS:\n');
        errors.forEach(err => console.log(`   ${err}`));
        console.log('');
        console.log('❌ Script does NOT follow framework conventions!');
        return { valid: false, errors, warnings };
    }

    if (warnings.length > 0) {
        console.log('⚠️ WARNINGS:\n');
        warnings.forEach(warn => console.log(`   ${warn}`));
        console.log('');
    }

    console.log('✅ Script validation passed - ready for execution\n');
    return { valid: true, errors: [], warnings };
}

// Execute if run directly
if (require.main === module) {
    const scriptPath = process.argv[2];
    if (!scriptPath) {
        console.error('Usage: node validate-script.js <path-to-script>');
        process.exit(1);
    }

    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    const result = validateGeneratedScript(scriptPath, scriptContent);

    process.exit(result.valid ? 0 : 1);
}

module.exports = { validateGeneratedScript };
