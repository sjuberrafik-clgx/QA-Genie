const { generateHtmlReport } = require('./scripts/html-report-generator');

(async () => {
    const result = await generateHtmlReport({
        title: 'Annual Report 2025',
        author: 'Doremon Team',
        outputPath: 'test-artifacts/magazine-html.html',
        collapsible: true,
        sections: [
            { type: 'cover', title: 'Annual Report 2025', subtitle: 'Driving Innovation Forward', author: 'Doremon Team', version: '2.0' },
            { type: 'heading', text: 'Executive Summary', level: 1 },
            { type: 'paragraph', text: 'This report covers key achievements and strategic initiatives across all business units during fiscal year 2025.' },
            { type: 'pull-quote', text: 'Innovation is not about saying yes to everything. It is about saying no to all but the most crucial features.', attribution: 'Steve Jobs' },
            { type: 'sidebar', title: 'Key Insight', text: 'Our customer satisfaction scores increased by 23% year-over-year, driven by AI-powered support tools.' },
            {
                type: 'metric-strip', metrics: [
                    { label: 'Revenue', value: '$4.2B', change: '+18%', status: 'good' },
                    { label: 'Users', value: '12M', change: '+32%', status: 'good' },
                    { label: 'Churn', value: '2.1%', change: '-0.5%', status: 'warning' },
                    { label: 'NPS', value: '78', change: '+12', status: 'good' },
                ]
            },
            { type: 'heading', text: 'Strategic Initiatives', level: 1 },
            {
                type: 'info-card-grid', cards: [
                    { icon: '🚀', title: 'Launch Speed', description: 'Reduced deployment time by 40% with CI/CD automation.' },
                    { icon: '🔒', title: 'Security', description: 'Zero critical vulnerabilities in production for 180 days.' },
                    { icon: '📊', title: 'Analytics', description: 'Real-time dashboards now serve 5000+ daily active users.' },
                    { icon: '🌍', title: 'Global Reach', description: 'Expanded to 12 new markets across APAC and EMEA.' },
                ]
            },
            {
                type: 'chart', title: 'Quarterly Revenue', chartData: {
                    type: 'bar',
                    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                    datasets: [{ name: 'Revenue ($M)', values: [950, 1050, 1100, 1100] }],
                }
            },
            { type: 'heading', text: 'Financial Details', level: 2 },
            { type: 'table', title: 'Revenue by Quarter', headers: ['Quarter', 'Revenue', 'Growth', 'Margin'], rows: [['Q1', '$950M', '15%', '22%'], ['Q2', '$1.05B', '18%', '24%'], ['Q3', '$1.1B', '20%', '25%'], ['Q4', '$1.1B', '19%', '24%']] },
            { type: 'bullets', items: ['Completed platform migration to cloud-native', 'Launched mobile app v3 with biometric auth', 'Achieved SOC 2 Type II compliance'] },
            { type: 'code-block', language: 'bash', code: 'npm run deploy --env=production\nnpm run test -- --coverage' },
            { type: 'callout', text: 'All financial projections for FY2026 indicate continued strong growth trajectory.', calloutType: 'success' },
            { type: 'two-column', left: 'The product team shipped 47 features across 12 releases.', right: 'Customer support resolved 98.5% of tickets within SLA targets.' },
            { type: 'diagram', mermaidCode: 'graph TD\\n    A[Start] --> B[Process]\\n    B --> C[End]' },
        ],
    });
    console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); });
