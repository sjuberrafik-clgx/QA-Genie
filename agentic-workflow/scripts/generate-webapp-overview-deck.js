/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEB APP OVERVIEW DECK — Cognitive QA Automation Platform
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates a polished, executive-ready PowerPoint about the QA Automation web app.
 * Story spine requested by the user:
 *   1. Problem & Solution
 *   2. How it works (end-to-end flow)
 *   3. Security
 *   4. Benefits & Roadmap
 *
 * Rendered through the repository's premium PPTX engine (scripts/pptx-generator.js).
 *
 * Run: node agentic-workflow/scripts/generate-webapp-overview-deck.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const { generatePptx } = require('./pptx-generator');

const OUTPUT_PATH = path.join(
    __dirname, '..', 'test-artifacts', 'documents', 'Cognitive-QA-Platform-Overview.pptx',
);

const slides = [
    // ─── 1. Cover ───────────────────────────────────────────────────────────
    {
        type: 'title',
        title: 'Cognitive QA Automation Platform',
        subtitle: 'One AI-powered workspace that turns Jira tickets into executable, self-healing Playwright coverage',
    },

    // ─── 2. Problem & Solution ──────────────────────────────────────────────
    {
        type: 'comparison',
        title: 'From manual QA bottleneck to autonomous coverage',
        leftTitle: 'The problem — manual QA today',
        leftItems: [
            'Test cases written by hand from every Jira ticket',
            'Selectors found by manually clicking through the live app',
            'Playwright scripts hand-coded, then break when the UI shifts',
            'Failure triage and bug filing are manual and disconnected',
            'Knowledge stays siloed; coverage and status are hard to see',
        ],
        rightTitle: 'The solution — our platform',
        rightItems: [
            'AI agents generate optimized test cases straight from the ticket',
            'Live MCP browser exploration extracts real, grounded selectors',
            'Framework-aware Playwright scripts auto-generated and self-healed',
            'Bugs and testing tasks created and linked in Jira automatically',
            'Dashboard, chat, history, and reports unified in one workspace',
        ],
    },

    // ─── 3. How it works — end-to-end flow ──────────────────────────────────
    {
        type: 'process-flow',
        title: 'How it works — end to end',
        steps: [
            { title: 'Jira intake', description: 'Capture ticket intent, acceptance criteria, and constraints' },
            { title: 'Test cases', description: 'Generate optimized manual coverage, exported to review-ready Excel' },
            { title: 'Live exploration', description: 'Navigate the real app via MCP and extract grounded selectors' },
            { title: 'Script generation', description: 'Build framework-aligned Playwright automation from real patterns' },
            { title: 'Execute & heal', description: 'Run, self-heal failures, then report or file linked Jira defects' },
        ],
    },

    // ─── 4. Security ────────────────────────────────────────────────────────
    {
        type: 'icon-grid',
        title: 'Security & trust by design',
        items: [
            { icon: '🔒', title: 'Approval-gated writes', description: 'Every Jira change routes through a human approval guardrail before it executes' },
            { icon: '👁️', title: 'Read-only integrations', description: 'External Atlassian access is restricted to read-only retrieval tools' },
            { icon: '🛡️', title: 'Least-privilege agents', description: 'Each agent uses only its role tools; cross-agent calls are permissioned and rate-limited' },
            { icon: '🔑', title: 'Secrets in config', description: 'Credentials and tokens live in environment config, never hard-coded in scripts' },
            { icon: '⚙️', title: 'Deterministic guardrails', description: 'OODA health and quality checks validate runs with zero LLM calls or data exposure' },
            { icon: '📂', title: 'Local-first grounding', description: 'Codebase context is indexed locally, keeping proprietary detail in your environment' },
        ],
    },

    // ─── 5. Benefits ────────────────────────────────────────────────────────
    {
        type: 'summary',
        title: 'Benefits that compound',
        metrics: [
            { value: '5', label: 'Stages automated' },
            { value: '7', label: 'Specialist AI agents' },
            { value: '3', label: 'Ways to run: chat, CLI, dashboard' },
            { value: '1', label: 'Connected workspace' },
        ],
        highlights: [
            'Faster cycle time: tickets become executable coverage without manual scripting',
            'Less selector drift: automation grounded in live exploration and project context',
            'Built-in resilience: failures self-heal and convert into structured Jira defects',
            'Full traceability: test cases, runs, bugs, and tasks stay linked to the work',
        ],
    },

    // ─── 6. Roadmap ─────────────────────────────────────────────────────────
    {
        type: 'timeline',
        title: 'Roadmap — what comes next',
        items: [
            { label: 'Live today', description: '7-agent pipeline, MCP exploration, dashboard, grounding, knowledge base, and OODA checks' },
            { label: 'Near term', description: 'Deeper analytics, broader cross-browser coverage, and richer Studio agent publishing' },
            { label: 'Mid term', description: 'CI/CD-native runs, scheduled regression, and expanded knowledge-base providers' },
            { label: 'Future', description: 'Multi-project scale, stronger self-healing, and continuous learning from run history' },
        ],
    },

    // ─── 7. Closing ─────────────────────────────────────────────────────────
    {
        type: 'closing',
        message: 'Ship quality faster — with AI agents on your QA team',
        contact: 'Cognitive QA Automation Platform',
    },
];

(async () => {
    const result = await generatePptx({
        title: 'Cognitive QA Automation Platform',
        subtitle: 'Web App Overview',
        author: 'QA Automation Platform',
        theme: 'modern-blue',
        transition: 'fade',
        slides,
        outputPath: OUTPUT_PATH,
    });

    if (!result.success) {
        console.error('Deck generation failed:', result.error);
        process.exit(1);
    }

    console.log('Deck generated successfully');
    console.log('  File:', result.filePath);
    console.log('  Slides:', result.slideCount, '|', result.slideTypes.join(', '));
    console.log('  Size:', result.fileSizeHuman);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
