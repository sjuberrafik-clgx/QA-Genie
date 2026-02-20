/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * UNIT TESTS — SelectorEngine (Unique Selector Engine)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Run: node agentic-workflow/mcp-server/utils/selector-engine.test.js
 *
 * Tests cover:
 *   1. isDynamicId — rejects auto-generated IDs
 *   2. isDynamicText — detects unstable text
 *   3. generateCandidates — correct ranking of candidates
 *   4. generateUniqueSelector — picks the best unique selector
 *   5. resolveCssSelector — bridge-level CSS resolution
 *   6. Composite / filtered / nth selectors
 *   7. Edge cases (empty elements, missing attributes)
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { SelectorEngine } from './selector-engine.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        failures.push(testName);
        console.log(`  ❌ ${testName}`);
    }
}

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        failures.push(`${testName} — expected: "${expected}", got: "${actual}"`);
        console.log(`  ❌ ${testName}`);
        console.log(`     expected: "${expected}"`);
        console.log(`     actual:   "${actual}"`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: isDynamicId
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 isDynamicId');

assert(SelectorEngine.isDynamicId('550e8400-e29b-41d4-a716-446655440000'), 'rejects UUID');
assert(SelectorEngine.isDynamicId(':r0:'), 'rejects React auto-ID :r0:');
assert(SelectorEngine.isDynamicId(':r1a:'), 'rejects React auto-ID :r1a:');
assert(SelectorEngine.isDynamicId('__next-route-announcer'), 'rejects __next- prefix');
assert(SelectorEngine.isDynamicId('mui-12345'), 'rejects MUI auto-ID');
assert(SelectorEngine.isDynamicId('css-a1b2c3'), 'rejects CSS-in-JS auto-ID');
assert(SelectorEngine.isDynamicId('jss-12345ab'), 'rejects JSS auto-ID');
assert(SelectorEngine.isDynamicId('sc-dkrFOg'), 'rejects styled-components ID');
assert(SelectorEngine.isDynamicId('radix-:r0:'), 'rejects Radix UI ID');
assert(SelectorEngine.isDynamicId('component-3af2c1e9'), 'rejects hex-hash suffix');
assert(SelectorEngine.isDynamicId('el-12345678'), 'rejects heavily numeric ID');

assert(!SelectorEngine.isDynamicId('search-input'), 'accepts stable ID: search-input');
assert(!SelectorEngine.isDynamicId('header'), 'accepts stable ID: header');
assert(!SelectorEngine.isDynamicId('login-button'), 'accepts stable ID: login-button');
assert(!SelectorEngine.isDynamicId('nav-menu'), 'accepts stable ID: nav-menu');
assert(!SelectorEngine.isDynamicId('footer'), 'accepts stable ID: footer');

assert(SelectorEngine.isDynamicId(null), 'rejects null');
assert(SelectorEngine.isDynamicId(''), 'rejects empty string');
assert(SelectorEngine.isDynamicId(undefined), 'rejects undefined');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: isDynamicText
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 isDynamicText');

assert(SelectorEngine.isDynamicText('12/25/2024'), 'rejects date 12/25/2024');
assert(SelectorEngine.isDynamicText('2024-01-15'), 'rejects date 2024-01-15');
assert(SelectorEngine.isDynamicText('14:30:00'), 'rejects time 14:30:00');
assert(SelectorEngine.isDynamicText('5 minutes ago'), 'rejects "5 minutes ago"');
assert(SelectorEngine.isDynamicText('just now'), 'rejects "just now"');
assert(SelectorEngine.isDynamicText('$1,250,000'), 'rejects price $1,250,000');
assert(SelectorEngine.isDynamicText('$499.99'), 'rejects price $499.99');
assert(SelectorEngine.isDynamicText('42 results'), 'rejects "42 results"');
assert(SelectorEngine.isDynamicText('Showing 15 items'), 'rejects "Showing 15 items"');
assert(SelectorEngine.isDynamicText('page 2 of 10'), 'rejects "page 2 of 10"');
assert(SelectorEngine.isDynamicText('3 days ago'), 'rejects "3 days ago"');

assert(!SelectorEngine.isDynamicText('Search'), 'accepts stable text: Search');
assert(!SelectorEngine.isDynamicText('Log In'), 'accepts stable text: Log In');
assert(!SelectorEngine.isDynamicText('Terms of Service'), 'accepts stable text: Terms of Service');
assert(!SelectorEngine.isDynamicText('Submit Application'), 'accepts stable text: Submit Application');

assert(SelectorEngine.isDynamicText(null), 'rejects null');
assert(SelectorEngine.isDynamicText(''), 'rejects empty string');
assert(SelectorEngine.isDynamicText('x'.repeat(201)), 'rejects text > 200 chars');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: generateCandidates
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 generateCandidates');

// Element with data-testid → top candidate
{
    const el = { ref: 's1e1', tag: 'button', role: 'button', dataTestId: 'submit-btn', text: 'Submit', computedLabel: 'Submit' };
    const candidates = SelectorEngine.generateCandidates(el);
    assert(candidates.length >= 2, 'button with testId generates ≥2 candidates');
    assertEqual(candidates[0].type, 'testId', 'testId is first candidate');
    assertEqual(candidates[0].score, 10, 'testId has score 10');
    assert(candidates[0].locator.includes('getByTestId'), 'testId locator uses getByTestId');
}

// Element with role + name
{
    const el = { ref: 's1e2', tag: 'a', role: 'link', computedLabel: 'Home', text: 'Home' };
    const candidates = SelectorEngine.generateCandidates(el);
    const roleCandidate = candidates.find(c => c.type === 'role+name');
    assert(roleCandidate !== undefined, 'link with name generates role+name candidate');
    assertEqual(roleCandidate.score, 9, 'role+name has score 9');
    assert(roleCandidate.locator.includes("getByRole('link'"), 'role+name locator has correct role');
}

// Element with stable ID
{
    const el = { ref: 's1e3', tag: 'input', id: 'email-input', computedLabel: 'Email' };
    const candidates = SelectorEngine.generateCandidates(el);
    const idCandidate = candidates.find(c => c.type === 'id');
    assert(idCandidate !== undefined, 'element with stable ID generates id candidate');
    assertEqual(idCandidate.score, 8, 'id has score 8');
    assertEqual(idCandidate.cssSelector, '#email-input', 'id CSS selector is correct');
}

// Element with dynamic ID → no id candidate
{
    const el = { ref: 's1e4', tag: 'div', id: 'mui-12345', text: 'Panel' };
    const candidates = SelectorEngine.generateCandidates(el);
    const idCandidate = candidates.find(c => c.type === 'id');
    assert(idCandidate === undefined, 'element with dynamic ID does NOT generate id candidate');
}

// Element with aria-label
{
    const el = { ref: 's1e5', tag: 'button', ariaLabel: 'Close dialog', computedLabel: 'Close dialog' };
    const candidates = SelectorEngine.generateCandidates(el);
    const ariaCandidate = candidates.find(c => c.type === 'ariaLabel');
    assert(ariaCandidate !== undefined, 'element with ariaLabel generates ariaLabel candidate');
    assertEqual(ariaCandidate.score, 7, 'ariaLabel has score 7');
}

// Element with placeholder
{
    const el = { ref: 's1e6', tag: 'input', placeholder: 'Enter city', computedLabel: 'Enter city' };
    const candidates = SelectorEngine.generateCandidates(el);
    const phCandidate = candidates.find(c => c.type === 'placeholder');
    assert(phCandidate !== undefined, 'input with placeholder generates placeholder candidate');
    assert(phCandidate.locator.includes('getByPlaceholder'), 'placeholder uses getByPlaceholder');
}

// Element with associated label
{
    const el = { ref: 's1e7', tag: 'input', associatedLabel: 'Email Address', computedLabel: 'Email Address' };
    const candidates = SelectorEngine.generateCandidates(el);
    const labelCandidate = candidates.find(c => c.type === 'label');
    assert(labelCandidate !== undefined, 'input with label generates label candidate');
    assert(labelCandidate.locator.includes('getByLabel'), 'label uses getByLabel');
}

// Element with alt text (image)
{
    const el = { ref: 's1e8', tag: 'img', alt: 'Company Logo' };
    const candidates = SelectorEngine.generateCandidates(el);
    const altCandidate = candidates.find(c => c.type === 'alt');
    assert(altCandidate !== undefined, 'image with alt generates alt candidate');
    assert(altCandidate.locator.includes('getByAltText'), 'alt uses getByAltText');
}

// Element with dynamic text → generates role+name-regex
{
    const el = { ref: 's1e9', tag: 'span', role: 'status', computedLabel: 'Showing 42 results for homes', text: 'Showing 42 results for homes' };
    const candidates = SelectorEngine.generateCandidates(el);
    const regexCandidate = candidates.find(c => c.type === 'role+name-regex');
    assert(regexCandidate !== undefined, 'dynamic text generates role+name-regex candidate');
    assertEqual(regexCandidate.score, 7, 'role+name-regex has score 7');
    assert(regexCandidate.locator.includes('/'), 'regex locator contains regex pattern');
}

// Empty element → no candidates
{
    const el = { ref: 's1e10', tag: 'div' };
    const candidates = SelectorEngine.generateCandidates(el);
    assertEqual(candidates.length, 0, 'element with no attributes generates 0 candidates');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: generateUniqueSelector
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 generateUniqueSelector');

// Best unique candidate wins
{
    const el = { ref: 's1e1', tag: 'button', role: 'button', dataTestId: 'submit-btn', text: 'Submit', computedLabel: 'Submit' };
    const matchCounts = { '[data-testid="submit-btn"]': 1, 'role=button[name="Submit"]': 3 };
    const result = SelectorEngine.generateUniqueSelector(el, matchCounts);
    assert(result.isUnique, 'picks a unique candidate');
    assertEqual(result.strategy, 'data-testid', 'picks testId when unique');
    assert(result.primary.includes('getByTestId'), 'primary is getByTestId');
    assertEqual(result.matchCount, 1, 'matchCount is 1');
    assertEqual(result.stabilityScore, 10, 'stability score is 10');
}

// Falls through to role+name when testId is not unique
{
    const el = { ref: 's1e2', tag: 'button', role: 'button', dataTestId: 'btn', text: 'Save', computedLabel: 'Save' };
    const matchCounts = { '[data-testid="btn"]': 5, 'role=button[name="Save"]': 1 };
    const result = SelectorEngine.generateUniqueSelector(el, matchCounts);
    assert(result.isUnique, 'finds a unique candidate at lower rank');
    assertEqual(result.strategy, 'role+name', 'picks role+name when testId is not unique');
    assertEqual(result.stabilityScore, 9, 'stability score is 9');
}

// No unique candidate available → uses highest scored
{
    const el = { ref: 's1e3', tag: 'button', role: 'button', text: 'OK', computedLabel: 'OK' };
    const matchCounts = { 'role=button[name="OK"]': 3, 'text="OK"': 5 };
    const result = SelectorEngine.generateUniqueSelector(el, matchCounts);
    // Should still produce a result (best available)
    assert(result.primary !== null, 'produces a selector even when none are unique');
}

// Element with NO attributes → fallback
{
    const el = { ref: 's1e4', tag: 'div' };
    const result = SelectorEngine.generateUniqueSelector(el, {});
    assert(result.primary.includes('div'), 'fallback uses tag name');
    assertEqual(result.stabilityScore, 1, 'fallback has stability score 1');
}

// Pre-computed selector data passes through
{
    const el = {
        ref: 's1e5', tag: 'button', dataTestId: 'my-btn',
        selector: { primary: "page.getByTestId('my-btn')", strategy: 'data-testid', stabilityScore: 10, isUnique: true, matchCount: 1 }
    };
    // When using processSnapshotElements, the existing selector data is preserved
    const result = SelectorEngine.generateUniqueSelector(el, { '[data-testid="my-btn"]': 1 });
    assert(result.primary.includes('getByTestId'), 'selector data is generated correctly');
}

// Fallback candidate is populated
{
    const el = { ref: 's1e6', tag: 'button', role: 'button', dataTestId: 'save-btn', ariaLabel: 'Save changes', computedLabel: 'Save changes', text: 'Save' };
    const matchCounts = { '[data-testid="save-btn"]': 1 };
    const result = SelectorEngine.generateUniqueSelector(el, matchCounts);
    assert(result.fallback !== null, 'fallback candidate is provided');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: resolveCssSelector (bridge-level)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 resolveCssSelector');

assertEqual(
    SelectorEngine.resolveCssSelector({ dataTestId: 'search-btn', id: 'btn1', ariaLabel: 'Search' }),
    '[data-testid="search-btn"]',
    'prefers dataTestId over id and ariaLabel'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ id: 'login-form', ariaLabel: 'Login', name: 'login' }),
    '#login-form',
    'prefers stable id over ariaLabel'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ id: 'mui-54321', ariaLabel: 'Close', name: 'close-btn' }),
    '[aria-label="Close"]',
    'skips dynamic id, uses ariaLabel'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ name: 'email', placeholder: 'Enter email' }),
    '[name="email"]',
    'uses name attribute'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ placeholder: 'Search...', text: 'Find' }),
    '[placeholder="Search..."]',
    'uses placeholder'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ text: 'Log In' }),
    'text="Log In"',
    'uses stable text'
);

assertEqual(
    SelectorEngine.resolveCssSelector({ text: '$1,250,000', tag: 'span', role: 'status' }),
    'span[role="status"]',
    'skips dynamic text, uses tag+role'
);

assertEqual(
    SelectorEngine.resolveCssSelector(null),
    null,
    'returns null for null input'
);

assertEqual(
    SelectorEngine.resolveCssSelector({}),
    null,
    'returns null for empty object'
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: processSnapshotElements
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 processSnapshotElements');

{
    const elements = [
        { ref: 's1e1', tag: 'button', role: 'button', dataTestId: 'submit', computedLabel: 'Submit', text: 'Submit' },
        { ref: 's1e2', tag: 'a', role: 'link', computedLabel: 'Home', text: 'Home', parentRef: 's1e1' },
        { ref: 's1e3', tag: 'input', placeholder: 'Search', computedLabel: 'Search' },
    ];
    const matchCounts = {
        '[data-testid="submit"]': 1,
        'role=button[name="Submit"]': 1,
        'role=link[name="Home"]': 1,
        '[placeholder="Search"]': 1,
    };

    const enriched = SelectorEngine.processSnapshotElements(elements, matchCounts);

    assertEqual(enriched.length, 3, 'returns same number of elements');
    assert(enriched[0].selector !== undefined, 'element 0 has .selector property');
    assert(enriched[0].selector.primary !== undefined, 'element 0 has .selector.primary');
    assert(enriched[0].selector.strategy !== undefined, 'element 0 has .selector.strategy');
    assert(typeof enriched[0].selector.stabilityScore === 'number', 'element 0 has numeric stabilityScore');
    assert(enriched[1].selector.primary !== undefined, 'element 1 has .selector.primary');
    assert(enriched[2].selector.primary !== undefined, 'element 2 has .selector.primary');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: mapAriaRole
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 mapAriaRole');

assertEqual(SelectorEngine.mapAriaRole('button', 'button'), 'button', 'explicit role "button" maps correctly');
assertEqual(SelectorEngine.mapAriaRole(null, 'a'), 'link', 'implicit role for <a> is link');
assertEqual(SelectorEngine.mapAriaRole(null, 'button'), 'button', 'implicit role for <button> is button');
assertEqual(SelectorEngine.mapAriaRole(null, 'input'), 'textbox', 'implicit role for <input> is textbox');
assertEqual(SelectorEngine.mapAriaRole(null, 'select'), 'combobox', 'implicit role for <select> is combobox');
assertEqual(SelectorEngine.mapAriaRole(null, 'textarea'), 'textbox', 'implicit role for <textarea> is textbox');
assertEqual(SelectorEngine.mapAriaRole(null, 'nav'), 'navigation', 'implicit role for <nav> is navigation');
assertEqual(SelectorEngine.mapAriaRole(null, 'h1'), 'heading', 'implicit role for <h1> is heading');
assertEqual(SelectorEngine.mapAriaRole(null, 'img'), 'img', 'implicit role for <img> is img');
assertEqual(SelectorEngine.mapAriaRole('presentation', 'div'), null, 'role "presentation" returns null');
assertEqual(SelectorEngine.mapAriaRole(null, 'div'), null, 'no implicit role for <div>');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Edge cases & broken pattern rejection
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🧪 Edge cases');

// Verify no broken patterns appear in generated locators
{
    const el = { ref: 's1e99', tag: 'button', role: 'button', computedLabel: 'Click Me', text: 'Click Me' };
    const result = SelectorEngine.generateUniqueSelector(el, {});
    assert(!result.primary.includes('data-mcp-ref'), 'no data-mcp-ref in locator');
    assert(!result.primary.includes('data-ref'), 'no data-ref in locator');
    assert(!result.primary.includes("getByTestId('s1e"), 'no internal ref as testId');
}

// href-based selectors for links
{
    const el = { ref: 's1e100', tag: 'a', href: 'https://example.com/about-us', computedLabel: 'About' };
    const candidates = SelectorEngine.generateCandidates(el);
    const hrefCandidate = candidates.find(c => c.type === 'href');
    assert(hrefCandidate !== undefined, 'link with href generates href candidate');
    assert(hrefCandidate.locator.includes('/about-us'), 'href candidate uses pathname');
}

// title attribute
{
    const el = { ref: 's1e101', tag: 'button', title: 'Settings menu' };
    const candidates = SelectorEngine.generateCandidates(el);
    const titleCandidate = candidates.find(c => c.type === 'title');
    assert(titleCandidate !== undefined, 'element with title generates title candidate');
    assert(titleCandidate.locator.includes('getByTitle'), 'title uses getByTitle');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ❌ ${f}`));
}
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
