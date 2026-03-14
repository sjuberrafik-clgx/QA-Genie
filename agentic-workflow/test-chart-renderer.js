/**
 * Chart Renderer — Smoke Test
 */
const { renderChart, renderChartBatch, cleanupBrowser } = require('./scripts/shared/chart-renderer');

(async () => {
    console.log('=== Chart Renderer Tests ===\n');

    // 1. Bar chart
    console.log('Test 1: Bar Chart');
    const r1 = await renderChart({
        type: 'bar',
        chartTitle: 'Sprint Velocity',
        data: {
            labels: ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'Sprint 5'],
            datasets: [
                { label: 'Planned', data: [30, 35, 28, 40, 32] },
                { label: 'Completed', data: [28, 33, 30, 38, 35] },
            ],
        },
        theme: 'modern-blue',
        outputName: 'test-bar',
    });
    console.log(`  success=${r1.success}, size=${r1.width}x${r1.height}`);

    // 2. Line chart
    console.log('Test 2: Line Chart');
    const r2 = await renderChart({
        type: 'line',
        chartTitle: 'Defect Trend',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [
                { label: 'Critical', data: [5, 3, 8, 2, 1, 0] },
                { label: 'Major', data: [12, 10, 15, 8, 6, 4] },
                { label: 'Minor', data: [20, 18, 22, 15, 12, 10] },
            ],
        },
        theme: 'dark-professional',
        outputName: 'test-line',
    });
    console.log(`  success=${r2.success}, size=${r2.width}x${r2.height}`);

    // 3. Pie chart
    console.log('Test 3: Pie Chart');
    const r3 = await renderChart({
        type: 'pie',
        chartTitle: 'Test Coverage by Module',
        data: {
            labels: ['Auth', 'Search', 'Profile', 'Payments', 'Settings'],
            datasets: [{ data: [92, 85, 78, 55, 95] }],
        },
        theme: 'corporate-green',
        outputName: 'test-pie',
        width: 600,
        height: 600,
    });
    console.log(`  success=${r3.success}, size=${r3.width}x${r3.height}`);

    // 4. Doughnut
    console.log('Test 4: Doughnut Chart');
    const r4 = await renderChart({
        type: 'doughnut',
        chartTitle: 'Browser Share',
        data: {
            labels: ['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'],
            datasets: [{ data: [65, 15, 12, 5, 3] }],
        },
        theme: 'warm-minimal',
        outputName: 'test-doughnut',
    });
    console.log(`  success=${r4.success}, size=${r4.width}x${r4.height}`);

    // 5. Radar
    console.log('Test 5: Radar Chart');
    const r5 = await renderChart({
        type: 'radar',
        chartTitle: 'Skill Assessment',
        data: {
            labels: ['Automation', 'Manual Testing', 'API', 'Performance', 'Security', 'Mobile'],
            datasets: [
                { label: 'Current', data: [90, 75, 85, 60, 50, 70] },
                { label: 'Target', data: [95, 85, 90, 80, 75, 85] },
            ],
        },
        outputName: 'test-radar',
    });
    console.log(`  success=${r5.success}, size=${r5.width}x${r5.height}`);

    // 6. Gauge
    console.log('Test 6: Gauge Chart');
    const r6 = await renderChart({
        type: 'gauge',
        value: 87,
        max: 100,
        label: 'Pass Rate',
        outputName: 'test-gauge',
        width: 400,
        height: 400,
    });
    console.log(`  success=${r6.success}, size=${r6.width}x${r6.height}`);

    // 7. Waterfall
    console.log('Test 7: Waterfall Chart');
    const r7 = await renderChart({
        type: 'waterfall',
        values: [100, 20, -35, 15, -10, 90],
        labels: ['Start', 'Feature A', 'Bug Fixes', 'Feature B', 'Tech Debt', 'Total'],
        chartTitle: 'Backlog Movement',
        outputName: 'test-waterfall',
    });
    console.log(`  success=${r7.success}, size=${r7.width}x${r7.height}`);

    // 8. Scatter
    console.log('Test 8: Scatter Chart');
    const r8 = await renderChart({
        type: 'scatter',
        chartTitle: 'Test Duration vs Complexity',
        data: {
            datasets: [{
                label: 'Tests',
                data: Array.from({ length: 20 }, () => ({
                    x: Math.round(Math.random() * 10),
                    y: Math.round(Math.random() * 60 + 10),
                })),
            }],
        },
        outputName: 'test-scatter',
    });
    console.log(`  success=${r8.success}, size=${r8.width}x${r8.height}`);

    // Verify files
    console.log('\n=== Generated Files ===');
    const chartDir = require('path').resolve(__dirname, 'test-artifacts/charts');
    const files = require('fs').readdirSync(chartDir);
    files.forEach(f => {
        const s = require('fs').statSync(chartDir + '/' + f);
        console.log(`  ${f}: ${(s.size / 1024).toFixed(1)} KB`);
    });

    await cleanupBrowser();
    console.log('\n=== All chart tests complete ===');
})().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
