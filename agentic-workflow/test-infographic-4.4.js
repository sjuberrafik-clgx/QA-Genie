const { generateInfographic, cleanupBrowser } = require('./scripts/infographic-generator');

(async () => {
    const tests = [
        {
            name: 'executive-summary',
            options: {
                template: 'executive-summary',
                outputPath: 'test-artifacts/infographic-exec-summary.png',
                data: {
                    title: 'Q4 2025 Executive Summary',
                    subtitle: 'Strong Growth Across All Business Units',
                    metrics: [
                        { label: 'Revenue', value: '$4.2B', change: '+18%', status: 'good' },
                        { label: 'Users', value: '12M', change: '+32%', status: 'good' },
                        { label: 'Churn', value: '2.1%', change: '-0.5%', status: 'warning' },
                        { label: 'NPS', value: '78', change: '+12', status: 'good' },
                    ],
                    highlights: [
                        'Completed cloud migration ahead of schedule',
                        'Launched 3 new product lines in APAC',
                        'Achieved SOC 2 Type II certification',
                        'Reduced customer support response time by 35%',
                    ],
                    conclusion: 'The company is well-positioned for continued growth in FY2026 with strong fundamentals across all key metrics.',
                },
            },
        },
        {
            name: 'process-flow',
            options: {
                template: 'process-flow',
                outputPath: 'test-artifacts/infographic-process.png',
                data: {
                    title: 'CI/CD Pipeline',
                    steps: [
                        { title: 'Code Commit', description: 'Developer pushes code to feature branch' },
                        { title: 'Automated Tests', description: 'Unit tests, integration tests, and linting run automatically' },
                        { title: 'Code Review', description: 'Peer review and approval via pull request' },
                        { title: 'Build & Deploy', description: 'Docker image built and deployed to staging' },
                        { title: 'Production Release', description: 'One-click deployment to production with rollback capability' },
                    ],
                },
            },
        },
        {
            name: 'timeline',
            options: {
                template: 'timeline',
                outputPath: 'test-artifacts/infographic-timeline.png',
                data: {
                    title: 'Product Roadmap 2025',
                    events: [
                        { date: 'Jan 2025', title: 'Platform V3 Launch', description: 'Complete rewrite with microservices architecture' },
                        { date: 'Apr 2025', title: 'Mobile App V2', description: 'iOS and Android apps with biometric authentication' },
                        { date: 'Jul 2025', title: 'AI Features', description: 'Machine learning powered recommendations and analytics' },
                        { date: 'Oct 2025', title: 'Enterprise Tier', description: 'SSO, custom branding, and dedicated support' },
                    ],
                },
            },
        },
        {
            name: 'comparison',
            options: {
                template: 'comparison',
                outputPath: 'test-artifacts/infographic-comparison.png',
                data: {
                    title: 'Before vs After Migration',
                    leftLabel: 'Legacy System',
                    rightLabel: 'New Platform',
                    items: [
                        { label: 'Deploy Time', left: '4 hours', right: '12 minutes' },
                        { label: 'Uptime', left: '99.5%', right: '99.99%' },
                        { label: 'Response Time', left: '800ms', right: '120ms' },
                        { label: 'Cost/Month', left: '$45K', right: '$18K' },
                    ],
                },
            },
        },
        {
            name: 'data-story',
            options: {
                template: 'data-story',
                outputPath: 'test-artifacts/infographic-data-story.png',
                data: {
                    title: 'Growth Story',
                    sections: [
                        { icon: '📈', title: 'Revenue Growth', value: '+42%', description: 'Year-over-year revenue growth exceeded targets' },
                        { icon: '👥', title: 'Team Expansion', value: '180 → 320', description: 'Hired across engineering, product, and sales' },
                        { icon: '🌍', title: 'Global Presence', value: '12 Markets', description: 'Expanded from 4 to 12 international markets' },
                        { icon: '⭐', title: 'Customer Rating', value: '4.8/5.0', description: 'Average rating across app stores and review sites' },
                    ],
                },
            },
        },
    ];

    let passed = 0;
    for (const t of tests) {
        try {
            const result = await generateInfographic(t.options);
            if (result.success) {
                console.log(`PASS: ${t.name} — ${result.fileSizeHuman} (${result.width}x${result.height})`);
                passed++;
            } else {
                console.log(`FAIL: ${t.name} — ${result.error}`);
            }
        } catch (e) {
            console.log(`FAIL: ${t.name} — ${e.message}`);
        }
    }

    await cleanupBrowser();
    console.log(`\n${passed}/${tests.length} passed`);
})();
