const { generatePdf } = require('./scripts/pdf-generator');

(async () => {
    const result = await generatePdf({
        title: 'Annual Report 2025',
        author: 'Doremon Team',
        outputPath: 'test-artifacts/magazine-pdf.pdf',
        watermark: 'DRAFT',
        includeTableOfContents: true,
        pageBorders: true,
        sections: [
            { type: 'cover', title: 'Annual Report 2025', subtitle: 'Driving Innovation Forward', author: 'Doremon Team', version: '2.0' },
            { type: 'heading', text: 'Executive Summary', level: 1 },
            { type: 'paragraph', text: 'This report covers key achievements and strategic initiatives across all business units during fiscal year 2025.' },
            { type: 'pull-quote', text: 'Innovation is not about saying yes to everything. It is about saying no to all but the most crucial features.', attribution: 'Steve Jobs' },
            { type: 'sidebar', title: 'Key Insight', text: 'Our customer satisfaction scores increased by 23% year-over-year, driven by AI-powered support tools and proactive engagement strategies.' },
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
                    { icon: 'R', title: 'Launch Speed', description: 'Reduced deployment time by 40% with CI/CD automation.' },
                    { icon: 'S', title: 'Security', description: 'Zero critical vulnerabilities in production for 180 days.' },
                    { icon: 'A', title: 'Analytics', description: 'Real-time dashboards now serve 5000+ daily active users.' },
                    { icon: 'G', title: 'Global Reach', description: 'Expanded to 12 new markets across APAC and EMEA.' },
                ]
            },
            { type: 'heading', text: 'Financial Summary', level: 2 },
            { type: 'table', headers: ['Quarter', 'Revenue', 'Growth', 'Margin'], rows: [['Q1', '$950M', '15%', '22%'], ['Q2', '$1.05B', '18%', '24%'], ['Q3', '$1.1B', '20%', '25%'], ['Q4', '$1.1B', '19%', '24%']] },
            { type: 'bullets', items: ['Completed platform migration to cloud-native', 'Launched mobile app v3 with biometric auth', 'Achieved SOC 2 Type II compliance'] },
            { type: 'callout', text: 'All financial projections for FY2026 indicate continued strong growth trajectory.', calloutType: 'success' },
            { type: 'two-column', left: 'The product team shipped 47 features across 12 releases, maintaining zero-downtime deployments throughout the year.', right: 'Customer support resolved 98.5% of tickets within SLA targets. Average resolution time decreased by 15%.' },
        ],
    });
    console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); });
