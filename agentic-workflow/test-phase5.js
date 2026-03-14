/**
 * Test Phase 5: SDK Tools + Design Quality Scorer
 * Tests: generate_html_report, generate_infographic_poster, generate_markdown, get_design_score
 */

const path = require('path');

async function testPhase5() {
    const results = [];

    // ─── Test 1: Design Quality Scorer (core module) ─────────────────
    console.log('Test 1: Design Quality Scorer...');
    try {
        const { scoreDesignQuality, WEIGHTS } = require('./scripts/shared/design-quality-scorer.js');

        // Good document
        const good = scoreDesignQuality({
            sections: [
                { type: 'cover', text: 'Test Report' },
                { type: 'heading', level: 1, text: 'Introduction' },
                { type: 'paragraph', content: 'This is a comprehensive quality report covering all key metrics.' },
                { type: 'heading', level: 2, text: 'Key Metrics' },
                { type: 'metric-strip', metrics: [{ label: 'Score', value: '95%' }] },
                { type: 'chart', chartType: 'bar', data: {} },
                { type: 'heading', level: 2, text: 'Analysis' },
                { type: 'table', headers: ['Item', 'Status'], rows: [['Test 1', 'Pass']] },
                { type: 'diagram', definition: 'flowchart LR\n  A-->B' },
                { type: 'callout', variant: 'info', content: 'Important note about quality.' },
            ],
            theme: 'modern-blue',
            format: 'docx',
            title: 'Quality Report',
            author: 'DocGenie',
        });

        console.log(`  Score: ${good.score}/100 (${good.grade})`);
        console.log(`  Recommendations: ${good.recommendations.length}`);
        results.push({ test: 'Design Scorer - Good Doc', pass: good.score >= 60, score: good.score, grade: good.grade });

        // Bad document (all bullets, no headings, no title)
        const bad = scoreDesignQuality({
            sections: [
                { type: 'bullets', items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] },
                { type: 'bullets', items: ['x', 'y', 'z'] },
                { type: 'bullets', items: ['1', '2', '3'] },
                { type: 'bullets', items: ['more', 'items', 'here'] },
            ],
            theme: 'invalid-theme',
            format: 'docx',
        });

        console.log(`  Bad doc score: ${bad.score}/100 (${bad.grade})`);
        results.push({ test: 'Design Scorer - Bad Doc', pass: bad.score < good.score, badScore: bad.score, goodScore: good.score });

        // Verify all weight categories sum to 100
        const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
        results.push({ test: 'Weights sum to 100', pass: totalWeight === 100, totalWeight });

    } catch (err) {
        results.push({ test: 'Design Scorer', pass: false, error: err.message });
    }

    // ─── Test 2: HTML Report Generator ───────────────────────────────
    console.log('\nTest 2: HTML Report Generator...');
    try {
        const { generateHtmlReport } = require('./scripts/html-report-generator.js');
        const result = await generateHtmlReport({
            title: 'SDK Test Report',
            author: 'Phase 5',
            theme: 'corporate-green',
            darkMode: false,
            collapsible: true,
            sections: [
                { type: 'heading', level: 1, text: 'Overview' },
                { type: 'paragraph', content: 'Testing SDK tool registration.' },
                { type: 'callout', variant: 'info', content: 'This tests the HTML report generator via SDK.' },
                { type: 'table', headers: ['Tool', 'Status'], rows: [['generate_html_report', 'Active'], ['generate_markdown', 'Active']] },
            ],
        });
        console.log(`  ${result.success ? 'PASS' : 'FAIL'}: ${result.fileSizeHuman}`);
        results.push({ test: 'HTML Report Generator', pass: result.success, size: result.fileSizeHuman });
    } catch (err) {
        results.push({ test: 'HTML Report Generator', pass: false, error: err.message });
    }

    // ─── Test 3: Infographic Poster Generator ────────────────────────
    console.log('\nTest 3: Infographic Poster Generator...');
    try {
        const { generateInfographic, cleanupBrowser } = require('./scripts/infographic-generator.js');
        const result = await generateInfographic({
            template: 'executive-summary',
            theme: 'dark-professional',
            data: {
                title: 'SDK Tools Dashboard',
                subtitle: 'Phase 5 Verification',
                metrics: [
                    { label: 'Tools Added', value: '4' },
                    { label: 'Tools Updated', value: '3' },
                    { label: 'Total Tools', value: '34' },
                ],
                highlights: ['HTML reports with dark mode', 'Infographic poster templates', 'Markdown with GFM features', 'Design quality scoring'],
                conclusion: 'All SDK tools registered and verified.',
            },
        });
        await cleanupBrowser();
        console.log(`  ${result.success ? 'PASS' : 'FAIL'}: ${result.fileSizeHuman} (${result.dimensions?.width}x${result.dimensions?.height})`);
        results.push({ test: 'Infographic Poster', pass: result.success, size: result.fileSizeHuman });
    } catch (err) {
        results.push({ test: 'Infographic Poster', pass: false, error: err.message });
    }

    // ─── Test 4: Markdown Generator ──────────────────────────────────
    console.log('\nTest 4: Markdown Generator...');
    try {
        const { generateMarkdown } = require('./scripts/markdown-generator.js');
        const result = await generateMarkdown({
            title: 'SDK Tool Catalog',
            author: 'Phase 5',
            tags: ['sdk', 'tools', 'phase5'],
            includeFrontMatter: true,
            includeTableOfContents: true,
            sections: [
                { type: 'heading', level: 1, text: 'New Tools' },
                { type: 'table', headers: ['#', 'Tool Name', 'Format'], rows: [['31', 'generate_html_report', 'HTML'], ['32', 'generate_infographic_poster', 'PNG'], ['33', 'generate_markdown', 'MD'], ['34', 'get_design_score', 'JSON']] },
                { type: 'callout', variant: 'tip', content: 'Use get_design_score before finalizing any document.' },
            ],
        });
        console.log(`  ${result.success ? 'PASS' : 'FAIL'}: ${result.fileSizeHuman}`);
        results.push({ test: 'Markdown Generator', pass: result.success, size: result.fileSizeHuman });
    } catch (err) {
        results.push({ test: 'Markdown Generator', pass: false, error: err.message });
    }

    // ─── Summary ─────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════');
    console.log('Phase 5 Test Results:');
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✓' : '✗'} ${r.test}${r.error ? ` — ${r.error}` : ''}`);
    }
    console.log(`\n  ${passed}/${total} tests passed`);
    console.log('═══════════════════════════════════════════════');

    return { passed, total, results };
}

testPhase5().catch(console.error);
