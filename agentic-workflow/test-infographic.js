/**
 * Infographic Components — Smoke Test
 */
const { renderInfographic, renderInfographicBatch, cleanupBrowser, COMPONENT_TYPES } = require('./scripts/shared/infographic-components');

(async () => {
    console.log('Available component types:', COMPONENT_TYPES);
    console.log('');

    // 1. Stat Poster
    console.log('Test 1: Stat Poster');
    const r1 = await renderInfographic({
        type: 'stat-poster',
        data: { value: '98.5%', label: 'Test Pass Rate', trend: '+2.3% from last sprint', trendDirection: 'up', icon: '🎯' },
        theme: 'modern-blue',
        outputName: 'test-stat-poster',
    });
    console.log(`  success=${r1.success}, ${r1.width}x${r1.height}`);

    // 2. Comparison
    console.log('Test 2: Comparison');
    const r2 = await renderInfographic({
        type: 'comparison',
        data: {
            left: {
                title: 'Before Automation',
                subtitle: 'Manual Testing',
                metrics: [
                    { label: 'Test Execution Time', value: '8 hours' },
                    { label: 'Coverage', value: '45%' },
                    { label: 'Defects Caught', value: '12/sprint' },
                    { label: 'Regression Cycles', value: '2/month' },
                ],
            },
            right: {
                title: 'After Automation',
                subtitle: 'Playwright + CI/CD',
                metrics: [
                    { label: 'Test Execution Time', value: '25 min' },
                    { label: 'Coverage', value: '87%' },
                    { label: 'Defects Caught', value: '38/sprint' },
                    { label: 'Regression Cycles', value: '15/month' },
                ],
            },
        },
        theme: 'corporate-green',
        outputName: 'test-comparison',
    });
    console.log(`  success=${r2.success}, ${r2.width}x${r2.height}`);

    // 3. Process Flow
    console.log('Test 3: Process Flow');
    const r3 = await renderInfographic({
        type: 'process-flow',
        data: {
            steps: [
                { title: 'Jira Ticket', description: 'Fetch requirements' },
                { title: 'TestGenie', description: 'Generate test cases' },
                { title: 'ScriptGen', description: 'Create Playwright scripts' },
                { title: 'Execute', description: 'Run on UAT' },
                { title: 'BugGenie', description: 'Report defects' },
            ],
        },
        theme: 'dark-professional',
        outputName: 'test-process-flow',
    });
    console.log(`  success=${r3.success}, ${r3.width}x${r3.height}`);

    // 4. KPI Dashboard
    console.log('Test 4: KPI Dashboard');
    const r4 = await renderInfographic({
        type: 'kpi-dashboard',
        data: {
            title: 'Sprint 42 — QA Metrics',
            metrics: [
                { label: 'Total Tests', value: '156', change: '+12 from S41', status: 'good' },
                { label: 'Pass Rate', value: '94.2%', change: '+1.8%', status: 'good' },
                { label: 'Avg Duration', value: '3.2s', change: '-0.5s', status: 'good' },
                { label: 'Open Bugs', value: '7', change: '+3', status: 'warning' },
                { label: 'Critical Bugs', value: '1', change: '-2', status: 'critical' },
                { label: 'Flaky Tests', value: '4', change: '+1', status: 'warning' },
            ],
        },
        outputName: 'test-kpi-dashboard',
    });
    console.log(`  success=${r4.success}, ${r4.width}x${r4.height}`);

    // 5. Status Board
    console.log('Test 5: Status Board');
    const r5 = await renderInfographic({
        type: 'status-board',
        data: {
            title: 'AOTF-12345 — Test Results',
            items: [
                { name: 'Login with valid credentials', status: 'pass', duration: '2.1s' },
                { name: 'Search for properties in Toronto', status: 'pass', duration: '4.5s' },
                { name: 'Apply price filter $500K-$1M', status: 'pass', duration: '3.2s' },
                { name: 'View property details', status: 'fail', detail: 'Timeout on EMC widget', duration: '30.0s' },
                { name: 'Save to favorites', status: 'skip', detail: 'Blocked by login issue' },
                { name: 'Compare two properties', status: 'pending' },
            ],
        },
        theme: 'warm-minimal',
        outputName: 'test-status-board',
    });
    console.log(`  success=${r5.success}, ${r5.width}x${r5.height}`);

    // Check output files
    console.log('');
    console.log('=== Generated Files ===');
    const dir = require('path').resolve(__dirname, 'test-artifacts/infographics');
    require('fs').readdirSync(dir).forEach(f => {
        const s = require('fs').statSync(dir + '/' + f);
        console.log(`  ${f}: ${(s.size / 1024).toFixed(1)} KB`);
    });

    await cleanupBrowser();
    console.log('\n=== All infographic tests complete ===');
})().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
