/**
 * Phase 3.4 Integration Smoke Test
 * Tests diagram/chart/infographic in PPTX, DOCX, and PDF generators.
 */
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, 'test-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const mermaidCode = `graph TD
    A[Jira Ticket] -->|fetch| B[TestGenie]
    B -->|generate| C[Test Cases]
    C -->|script| D[ScriptGen]
    D -->|execute| E[Playwright]
    E -->|report| F[BugGenie]`;

const chartData = {
    type: 'radar',
    labels: ['Speed', 'Coverage', 'Quality', 'Reliability', 'Maintainability'],
    datasets: [{ name: 'Sprint 42', values: [85, 92, 78, 95, 88] }],
};

(async () => {
    let ok = 0, fail = 0;

    // ─── PPTX ─────────────────────────────────────────────
    console.log('=== PPTX Integration ===');
    try {
        const { generatePptx } = require('./scripts/pptx-generator');
        const result = await generatePptx({
            title: 'Phase 3.4 Integration',
            theme: 'modern-blue',
            outputPath: path.join(OUT, 'integration-pptx.pptx'),
            slides: [
                { type: 'title', title: 'Phase 3.4 — Full Visual Integration' },
                { type: 'diagram', title: 'QA Workflow', mermaidCode },
                { type: 'chart', title: 'Radar Chart (Advanced)', chartData: { type: 'radar', labels: chartData.labels, datasets: chartData.datasets } },
                { type: 'chart', title: 'Bar Chart (Native)', chartData: { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'], datasets: [{ name: 'Revenue', values: [100, 150, 200, 250] }] } },
                {
                    type: 'infographic', title: 'KPI Dashboard', infographicType: 'kpi-dashboard', data: {
                        title: 'Sprint Metrics', metrics: [
                            { label: 'Tests', value: '156', status: 'good' },
                            { label: 'Pass Rate', value: '94%', status: 'good' },
                            { label: 'Bugs', value: '7', status: 'warning' },
                        ]
                    }
                },
                {
                    type: 'infographic', title: 'Test Status', infographicType: 'status-board', data: {
                        title: 'Results', items: [
                            { name: 'Login flow', status: 'pass', duration: '2.1s' },
                            { name: 'Search', status: 'fail', detail: 'Timeout' },
                            { name: 'Compare', status: 'skip' },
                        ]
                    }
                },
            ],
        });
        console.log(`  PPTX: ${result.success ? 'PASS' : 'FAIL'} — ${result.slideCount} slides, ${result.fileSizeHuman}`);
        ok += result.success ? 1 : 0;
        fail += result.success ? 0 : 1;
    } catch (e) {
        console.log(`  PPTX: FAIL — ${e.message}`);
        fail++;
    }

    // ─── DOCX ─────────────────────────────────────────────
    console.log('\n=== DOCX Integration ===');
    try {
        const { generateDocx } = require('./scripts/docx-generator');
        const result = await generateDocx({
            title: 'Phase 3.4 Integration',
            theme: 'corporate-green',
            outputPath: path.join(OUT, 'integration-docx.docx'),
            sections: [
                { type: 'heading', text: 'Workflow Diagram', level: 1 },
                { type: 'diagram', mermaidCode, caption: 'QA Automation Pipeline' },
                { type: 'heading', text: 'Performance Chart', level: 1 },
                { type: 'chart', title: 'Team Radar', chartData: { type: 'radar', labels: chartData.labels, datasets: chartData.datasets } },
                { type: 'heading', text: 'Sprint Dashboard', level: 1 },
                { type: 'infographic', infographicType: 'stat-poster', data: { value: '98.5%', label: 'Uptime', icon: '🎯', trend: '+0.3%', trendDirection: 'up' }, caption: 'Current Sprint Uptime' },
            ],
        });
        console.log(`  DOCX: ${result.success ? 'PASS' : 'FAIL'} — ${result.sectionCount} sections, ${result.fileSizeHuman}`);
        ok += result.success ? 1 : 0;
        fail += result.success ? 0 : 1;
    } catch (e) {
        console.log(`  DOCX: FAIL — ${e.message}`);
        fail++;
    }

    // ─── PDF ──────────────────────────────────────────────
    console.log('\n=== PDF Integration ===');
    try {
        const { generatePdf } = require('./scripts/pdf-generator');
        const result = await generatePdf({
            title: 'Phase 3.4 Integration',
            theme: 'dark-professional',
            outputPath: path.join(OUT, 'integration-pdf.pdf'),
            sections: [
                { type: 'heading', text: 'Workflow Diagram', level: 1 },
                { type: 'diagram', mermaidCode, caption: 'QA Pipeline' },
                { type: 'heading', text: 'Chart', level: 1 },
                { type: 'chart', chartData: { type: 'gauge', value: 87, max: 100, label: 'Quality Score' }, caption: 'Sprint Quality' },
                { type: 'heading', text: 'Infographic', level: 1 },
                {
                    type: 'infographic', infographicType: 'process-flow', data: {
                        steps: [
                            { title: 'Plan', description: 'Requirements' },
                            { title: 'Build', description: 'Automate' },
                            { title: 'Test', description: 'Execute' },
                            { title: 'Ship', description: 'Deploy' },
                        ]
                    }
                },
            ],
        });
        console.log(`  PDF: ${result.success ? 'PASS' : 'FAIL'} — ${result.pageCount} pages, ${result.fileSizeHuman}`);
        ok += result.success ? 1 : 0;
        fail += result.success ? 0 : 1;
    } catch (e) {
        console.log(`  PDF: FAIL — ${e.message}`);
        fail++;
    }

    console.log(`\n=== Results: ${ok}/3 passed, ${fail}/3 failed ===`);
    if (fail) process.exitCode = 1;
})();
