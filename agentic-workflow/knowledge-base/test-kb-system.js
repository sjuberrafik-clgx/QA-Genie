#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KNOWLEDGE BASE SYSTEM — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Runs deterministic unit tests against the KB system without requiring
 * live Confluence/Notion/SharePoint connections.
 *
 * Usage:  node agentic-workflow/knowledge-base/test-kb-system.js
 *
 * Tests cover:
 *   - KBProvider abstract class & utilities
 *   - IntentDetector scoring & thresholds
 *   - KBCache BM25 indexing, TTL, LRU eviction
 *   - KBConnector orchestration
 *   - Provider factory
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

let passed = 0;
let failed = 0;
let testName = '';

function describe(name, fn) {
    console.log(`\n═══ ${name} ═══`);
    fn();
}

function it(name, fn) {
    testName = name;
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || `Assertion failed in "${testName}"`);
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertAbove(actual, threshold, msg) {
    if (actual <= threshold) {
        throw new Error(msg || `Expected ${actual} > ${threshold}`);
    }
}

function assertBelow(actual, threshold, msg) {
    if (actual >= threshold) {
        throw new Error(msg || `Expected ${actual} < ${threshold}`);
    }
}

// ─── Test: KBProvider Base Class ────────────────────────────────────────────

describe('KBProvider Base Class', () => {
    const { KBProvider, htmlToPlainText, createExcerpt } = require('./kb-provider');

    it('should not instantiate directly', () => {
        try {
            new KBProvider({ type: 'test', name: 'Test' });
            assert(false, 'Should have thrown');
        } catch (e) {
            assert(e.message.includes('abstract'), `Expected abstract error, got: ${e.message}`);
        }
    });

    it('should convert HTML to plain text', () => {
        const html = '<p>Hello <strong>World</strong></p><br/><ul><li>Item 1</li><li>Item 2</li></ul>';
        const text = htmlToPlainText(html);
        assert(text.includes('Hello'));
        assert(text.includes('World'));
        assert(text.includes('Item 1'));
        assert(!text.includes('<p>'));
        assert(!text.includes('<strong>'));
    });

    it('should strip Confluence storage format macros', () => {
        const html = '<ac:structured-macro ac:name="code"><ac:plain-text-body>console.log("hi")</ac:plain-text-body></ac:structured-macro>';
        const text = htmlToPlainText(html);
        // Should remove or simplify Confluence macros
        assert(!text.includes('<ac:'));
    });

    it('should create excerpts with max length', () => {
        const longText = 'A'.repeat(500);
        const excerpt = createExcerpt(longText, 200);
        assert(excerpt.length <= 203); // 200 + '...'
    });

    it('should handle empty strings in utilities', () => {
        assertEqual(htmlToPlainText(''), '');
        assertEqual(htmlToPlainText(null), '');
        assertEqual(createExcerpt('', 100), '');
    });
});

// ─── Test: IntentDetector ───────────────────────────────────────────────────

describe('IntentDetector', () => {
    const { IntentDetector } = require('./intent-detector');

    const detector = new IntentDetector({
        domainTerminology: {
            'MLS': 'Multiple Listing Service',
            'ONMLS': 'Ontario MLS',
            'ECFM': 'Enhanced Consumer Funnel Management',
            'EMC': 'Estimated Monthly Cost',
            'TOS': 'Terms of Service',
        },
        featureMap: [
            { name: 'Property Search', keywords: ['search', 'filter', 'map', 'grid'] },
            { name: 'Login', keywords: ['login', 'auth', 'token'] },
            { name: 'Favorites', keywords: ['favorites', 'saved', 'bookmarks'] },
        ],
        triggerTerms: ['confluence', 'wiki', 'documentation', 'how does', 'what is',
            'requirements', 'specification', 'acceptance criteria'],
        confidenceThreshold: 0.3,
    });

    it('should detect domain terms', () => {
        const result = detector.detect('what is MLS');
        assert(result.shouldFetch, 'Should fetch for domain term "MLS"');
        assert(result.matchedTerms.length > 0);
    });

    it('should detect trigger terms', () => {
        const result = detector.detect('check confluence wiki documentation for login');
        assert(result.shouldFetch, `Should fetch for trigger terms, confidence=${result.confidence}, signals=${JSON.stringify(result.signals)}`);
    });

    it('should detect feature names', () => {
        const result = detector.detect('How does property search work?');
        assert(result.matchedFeatures.length > 0 || result.matchedTerms.length > 0);
    });

    it('should NOT trigger on generic queries', () => {
        const result = detector.detect('hello');
        assert(!result.shouldFetch, 'Should NOT fetch for generic query "hello"');
        assertBelow(result.confidence, 0.3);
    });

    it('should give higher confidence for multiple signals', () => {
        const single = detector.detect('MLS');
        const multi = detector.detect('what is MLS documentation on confluence');
        assertAbove(multi.confidence, single.confidence);
    });

    it('should handle empty queries', () => {
        const result = detector.detect('');
        assert(!result.shouldFetch);
        assertEqual(result.confidence, 0);
    });

    it('should handle case insensitivity', () => {
        const upper = detector.detect('ONMLS');
        const lower = detector.detect('onmls');
        assertEqual(upper.shouldFetch, lower.shouldFetch);
    });

    it('should detect question patterns', () => {
        const result = detector.detect('How does the property search filter work?');
        assert(result.signals?.questionWord > 0 || result.confidence > 0);
    });

    it('should provide suggested queries', () => {
        const result = detector.detect('property search filters');
        // suggestedQueries should be an array
        assert(Array.isArray(result.suggestedQueries));
    });

    it('should support acronym expansion', () => {
        const result = detector.detect('MLS onboarding process');
        assert(result.matchedTerms.length > 0 || result.confidence > 0, `Expected MLS to be detected, confidence=${result.confidence}`);
    });
});

// ─── Test: KBCache ──────────────────────────────────────────────────────────

describe('KBCache', () => {
    const { KBCache } = require('./kb-cache');
    const path = require('path');
    const fs = require('fs');

    // Use a temp path for testing
    const testCacheDir = path.join(__dirname, '..', 'knowledge-base-data');
    const testCacheFile = 'test-kb-cache.json';
    const testCachePath = path.join(testCacheDir, testCacheFile);

    // Clean up before tests
    try { fs.unlinkSync(testCachePath); } catch { /* ignore */ }

    const cache = new KBCache({
        cacheDir: testCacheDir,
        cacheFile: testCacheFile,
        ttlMinutes: 1,
        maxEntries: 5,
        verbose: false,
    });

    it('should add pages to cache', () => {
        const result = cache.addPages([
            { id: 'p1', title: 'Property Search Guide', content: 'How to search for properties using MLS filters and map view', space: 'DOCS', url: 'http://test/p1', lastModified: new Date().toISOString(), metadata: {} },
            { id: 'p2', title: 'Login Authentication', content: 'Token-based authentication flow for consumer and agent portals', space: 'DOCS', url: 'http://test/p2', lastModified: new Date().toISOString(), metadata: {} },
            { id: 'p3', title: 'MLS Configuration', content: 'How to configure MLS syndication and data distribution settings', space: 'DOCS', url: 'http://test/p3', lastModified: new Date().toISOString(), metadata: {} },
        ]);

        assertEqual(result.added, 3);
        const stats = cache.getStats();
        assertEqual(stats.totalPages, 3);
    });

    it('should search cache by content', () => {
        const searchResult = cache.search('property search filters');
        assert(searchResult.results.length > 0, 'Should find results for "property search filters"');
        assertEqual(searchResult.results[0].title, 'Property Search Guide');
    });

    it('should search cache by title', () => {
        const searchResult = cache.search('login authentication');
        assert(searchResult.results.length > 0, `Should find results, got ${searchResult.results.length}`);
        assertEqual(searchResult.results[0].title, 'Login Authentication');
    });

    it('should get page by ID', () => {
        const result = cache.getPage('p2');
        assert(result.page !== null);
        assertEqual(result.page.title, 'Login Authentication');
    });

    it('should return null for missing page', () => {
        const result = cache.getPage('nonexistent');
        assertEqual(result.page, null);
    });

    it('should enforce LRU max entries', () => {
        // Add more pages to exceed maxEntries (5)
        for (let i = 4; i <= 8; i++) {
            cache.addPages([{
                id: `p${i}`, title: `Page ${i}`, content: `Content for page ${i}`,
                space: 'DOCS', url: `http://test/p${i}`, lastModified: new Date().toISOString(), metadata: {},
            }]);
        }
        const stats = cache.getStats();
        assert(stats.totalPages <= 5, `Should not exceed maxEntries=5, got ${stats.totalPages}`);
    });

    it('should persist to disk', () => {
        assert(fs.existsSync(testCachePath), 'Cache file should exist');
        const data = JSON.parse(fs.readFileSync(testCachePath, 'utf-8'));
        assert(data.pages && Object.keys(data.pages).length > 0);
    });

    it('should report stats', () => {
        const stats = cache.getStats();
        assert(typeof stats.totalPages === 'number');
        assert(typeof stats.stalePages === 'number');
    });

    // Clean up
    try { fs.unlinkSync(testCachePath); } catch { /* ignore */ }
});

// ─── Test: KBConnector Factory ──────────────────────────────────────────────

describe('KBConnector — Provider Factory', () => {
    const { createProvider } = require('./kb-connector');

    it('should create Confluence provider', () => {
        const provider = createProvider({
            type: 'confluence',
            name: 'Test Confluence',
            baseUrl: 'https://test.atlassian.net/wiki',
        });
        assert(provider !== null);
        assertEqual(provider.type, 'confluence');
    });

    it('should create Custom provider', () => {
        const provider = createProvider({
            type: 'custom',
            name: 'Test Custom',
            baseUrl: 'https://wiki.test.com/api',
        });
        assert(provider !== null);
        assertEqual(provider.type, 'custom');
    });

    it('should throw for unknown provider type', () => {
        try {
            createProvider({ type: 'invalid', name: 'Bad' });
            assert(false, 'Should have thrown');
        } catch (e) {
            assert(e.message.includes('Unknown') || e.message.includes('unsupported') || e.message.includes('invalid'));
        }
    });
});

// ─── Test: KBConnector Orchestration ────────────────────────────────────────

describe('KBConnector — Orchestration', () => {
    const { KnowledgeBaseConnector } = require('./kb-connector');

    it('should initialize with empty providers', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: { enabled: true, domainTerms: [], triggerTerms: [], confidenceThreshold: 0.3 },
        });
        await connector.initialize();
        assert(connector._initialized);
    });

    it('should return empty results when no providers', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: { enabled: true, domainTerms: ['test'], triggerTerms: ['wiki'], confidenceThreshold: 0.3 },
        });
        await connector.initialize();
        const result = await connector.query('test wiki query');
        assert(Array.isArray(result.results));
    });

    it('should build empty context when no results', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: { enabled: false },
        });
        await connector.initialize();
        const context = await connector.buildKBContext('some query');
        assertEqual(context, '');
    });

    it('should format context with budget limit', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: { enabled: false },
            retrieval: { maxContentChars: 100 },
        });
        await connector.initialize();

        // Manually insert cache data to test formatting
        if (connector._cache) {
            connector._cache.addPages([{
                id: 'test1', title: 'Test Page', content: 'A'.repeat(500),
                space: 'S', url: 'http://x', lastModified: new Date().toISOString(), metadata: {},
            }]);
        }

        const context = await connector.buildKBContext('test', { maxChars: 100 });
        // Context should be truncated to budget
        assert(context.length <= 200, `Context too long: ${context.length}`); // some overhead for headers
    });
});

// ─── Test: Intent-Blocked Signaling ─────────────────────────────────────────

describe('Intent-Blocked Signaling', () => {
    const { KnowledgeBaseConnector } = require('./kb-connector');

    it('should include blocked=true when intent blocks a query', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: {
                enabled: true,
                domainTerms: [],
                triggerTerms: ['confluence'],
                confidenceThreshold: 0.5,
            },
        });
        await connector.initialize();

        // "hello" should not pass intent detection
        const result = await connector.query('hello');
        assert(result.blocked === true, `Expected blocked=true, got blocked=${result.blocked}`);
        assert(typeof result.reason === 'string', 'Expected reason string');
        assert(result.reason.includes('Intent confidence too low'), `Unexpected reason: ${result.reason}`);
        assertEqual(result.results.length, 0);
    });

    it('should NOT include blocked when intent passes', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: {
                enabled: true,
                domainTerms: ['wiki'],
                triggerTerms: ['confluence'],
                confidenceThreshold: 0.1,
            },
            groundingConfig: {
                domainTerminology: { 'wiki': 'Knowledge base' },
                featureMap: [],
            },
        });
        await connector.initialize();

        const result = await connector.query('wiki confluence documentation');
        assert(!result.blocked, `Expected no blocked field, got blocked=${result.blocked}`);
    });

    it('should bypass intent with skipIntentCheck=true', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: {
                enabled: true,
                domainTerms: [],
                triggerTerms: [],
                confidenceThreshold: 0.9, // very high threshold
            },
        });
        await connector.initialize();

        // Without skipIntentCheck, "hello" would be blocked
        const blocked = await connector.query('hello');
        assert(blocked.blocked === true, 'Should be blocked without skip');

        // With skipIntentCheck, should NOT be blocked
        const passed = await connector.query('hello', { skipIntentCheck: true });
        assert(!passed.blocked, 'Should not be blocked with skipIntentCheck');
    });
});

// ─── Test: Grounding Config Wiring ──────────────────────────────────────────

describe('Grounding Config Wiring', () => {
    const { KnowledgeBaseConnector } = require('./kb-connector');

    it('should use domainTerminology from groundingConfig for intent detection', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: {
                enabled: true,
                triggerTerms: [],
                confidenceThreshold: 0.1,
            },
            groundingConfig: {
                domainTerminology: {
                    'NFH': 'New Feature Highlight',
                    'MLS': 'Multiple Listing Service',
                },
                featureMap: [
                    { name: 'Property Search', keywords: ['search', 'filter'] },
                ],
            },
        });
        await connector.initialize();

        // "NFH" should pass because it's in domainTerminology via groundingConfig
        const result = await connector.query('NFH');
        assert(!result.blocked, `Expected NFH to pass intent, blocked=${result.blocked}, reason=${result.reason}`);
    });

    it('should detect featureMap names from groundingConfig', async () => {
        const connector = new KnowledgeBaseConnector({
            enabled: true,
            providers: [],
            cache: { enabled: true, ttlMinutes: 5, maxEntries: 10 },
            intentDetection: {
                enabled: true,
                triggerTerms: [],
                confidenceThreshold: 0.1,
            },
            groundingConfig: {
                domainTerminology: {},
                featureMap: [
                    { name: 'Property Search', keywords: ['search', 'filter', 'map'] },
                ],
            },
        });
        await connector.initialize();

        // "property search" should match feature name
        const result = await connector.query('property search');
        assert(!result.blocked, `Expected feature match to pass intent, blocked=${result.blocked}`);
    });
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
