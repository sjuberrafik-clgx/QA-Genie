/**
 * Diagram Engine — Smoke Test
 */
const { renderDiagram, renderDiagramBatch, cleanupBrowser, detectDiagramType, validateMermaidCode } = require('./scripts/shared/diagram-engine');

(async () => {
    console.log('=== Sync Helper Tests ===');
    console.log('detect flowchart:', detectDiagramType('graph TD; A-->B;'));
    console.log('detect sequence:', detectDiagramType('sequenceDiagram\nAlice->>Bob: Hi'));
    console.log('detect gantt:', detectDiagramType('gantt\ntitle My Gantt'));
    console.log('detect pie:', detectDiagramType('pie\n"A": 40'));
    console.log('detect unknown:', detectDiagramType('hello world'));
    console.log('validate OK:', validateMermaidCode('graph TD; A-->B;'));
    console.log('validate empty:', validateMermaidCode(''));
    console.log('validate bad:', validateMermaidCode('hello world'));
    console.log('');

    console.log('=== Render Test 1: Flowchart ===');
    const r1 = await renderDiagram({
        mermaidCode: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do Something]
    B -->|No| D[Do Other Thing]
    C --> E[End]
    D --> E`,
        theme: 'modern-blue',
        outputName: 'test-flowchart',
    });
    console.log('Result:', JSON.stringify(r1, null, 2));

    console.log('');
    console.log('=== Render Test 2: Sequence Diagram ===');
    const r2 = await renderDiagram({
        mermaidCode: `sequenceDiagram
    participant A as User
    participant B as Browser
    participant C as Server
    A->>B: Click Login
    B->>C: POST /auth
    C-->>B: 200 OK + Token
    B-->>A: Redirect to Dashboard`,
        theme: 'dark-professional',
        outputName: 'test-sequence',
    });
    console.log('Result:', JSON.stringify(r2, null, 2));

    console.log('');
    console.log('=== Render Test 3: Pie Chart ===');
    const r3 = await renderDiagram({
        mermaidCode: `pie title Test Results
    "Passed" : 42
    "Failed" : 8
    "Skipped" : 5`,
        theme: 'corporate-green',
        outputName: 'test-pie',
    });
    console.log('Result:', JSON.stringify(r3, null, 2));

    console.log('');
    console.log('=== Render Test 4: Gantt ===');
    const r4 = await renderDiagram({
        mermaidCode: `gantt
    title QA Workflow
    dateFormat YYYY-MM-DD
    section Planning
        Analysis     :a1, 2024-01-01, 5d
        Test Design  :a2, after a1, 3d
    section Execution
        Automate     :b1, after a2, 7d
        Run Tests    :b2, after b1, 2d
    section Review
        Bug Report   :c1, after b2, 3d`,
        theme: 'warm-minimal',
        outputName: 'test-gantt',
    });
    console.log('Result:', JSON.stringify(r4, null, 2));

    console.log('');
    console.log('=== Render Test 5: Invalid Code ===');
    const r5 = await renderDiagram({
        mermaidCode: 'this is not valid mermaid',
        outputName: 'test-invalid',
    });
    console.log('Result:', JSON.stringify(r5, null, 2));

    console.log('');
    console.log('=== Batch Render Test ===');
    const batch = await renderDiagramBatch([
        { mermaidCode: 'graph LR; X-->Y;', outputName: 'batch-1' },
        { mermaidCode: 'graph TB; M-->N;', outputName: 'batch-2' },
    ], { theme: 'modern-blue' });
    console.log('Batch results:', batch.length, 'diagrams');
    batch.forEach((r, i) => console.log(`  [${i}] success=${r.success}, ${r.width}x${r.height}`));

    await cleanupBrowser();
    console.log('');
    console.log('=== All tests complete ===');
})().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
