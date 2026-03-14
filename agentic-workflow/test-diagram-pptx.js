/**
 * Test: PPTX with Mermaid diagram slide (end-to-end integration)
 */
const { generatePptx } = require('./scripts/pptx-generator');

(async () => {
    console.log('Generating PPTX with Mermaid diagram slides...');

    const result = await generatePptx({
        title: 'Diagram Engine Integration Test',
        subtitle: 'Phase 3.1 Validation',
        theme: 'modern-blue',
        outputPath: './test-artifacts/diagram-integration-test.pptx',
        slides: [
            { type: 'title', title: 'Diagram Engine Test', subtitle: 'Mermaid → PNG → PPTX Integration' },
            {
                type: 'diagram',
                title: 'QA Workflow — Flowchart',
                mermaidCode: `graph TD
    A[Jira Ticket] --> B[TestGenie]
    B --> C[Test Cases]
    C --> D[ScriptGenerator]
    D --> E[Playwright Scripts]
    E --> F{Tests Pass?}
    F -->|Yes| G[Report]
    F -->|No| H[BugGenie]
    H --> I[Defect Ticket]`,
            },
            {
                type: 'diagram',
                title: 'Authentication Sequence',
                mermaidCode: `sequenceDiagram
    participant U as User
    participant B as Browser
    participant API as Auth API
    U->>B: Enter credentials
    B->>API: POST /login
    API-->>B: JWT Token
    B->>B: Store token
    B-->>U: Redirect to dashboard`,
            },
            {
                type: 'diagram',
                title: 'Test Results Distribution',
                mermaidCode: `pie title Sprint 42 Results
    "Passed" : 85
    "Failed" : 10
    "Skipped" : 5`,
            },
            {
                type: 'diagram',
                title: 'Project Timeline',
                mermaidCode: `gantt
    title Phase 3 Implementation
    dateFormat YYYY-MM-DD
    section Diagram Engine
        Core rendering   :done, a1, 2025-01-01, 5d
        Theme integration :active, a2, after a1, 3d
    section Chart Renderer
        Chart.js setup   :b1, after a2, 4d
        Image export     :b2, after b1, 2d
    section Integration
        PPTX embed       :c1, after b2, 3d
        Testing          :c2, after c1, 2d`,
            },
            { type: 'closing', title: 'Thank You', subtitle: 'Diagram Engine Demo Complete', contactInfo: 'DocGenie v2' },
        ],
    });

    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.success) {
        console.log('\n✅ PPTX with Mermaid diagrams generated successfully!');
        console.log(`   File: ${result.filePath}`);
        console.log(`   Size: ${result.fileSizeHuman}`);
        console.log(`   Slides: ${result.slideCount}`);
    } else {
        console.error('\n❌ Failed:', result.error);
        process.exit(1);
    }
})();
