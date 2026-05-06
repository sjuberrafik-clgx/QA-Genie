const path = require('path');
const { generateDocx } = require('./docx-generator');

async function main() {
    const outputPath = path.join(
        __dirname,
        '..',
        'test-artifacts',
        'documents',
        'Agentic-AI-QA-Automation-Platform-Use-Case.docx'
    );

    const sections = [
        {
            type: 'cover',
            title: 'Agentic AI-Powered QA Automation Platform',
            subtitle: 'Project Overview, Use Case, and Additional Details',
            author: 'GitHub Copilot',
            date: 'April 27, 2026',
            version: '1.0',
        },
        {
            type: 'heading',
            level: 1,
            text: 'Executive Summary',
        },
        {
            type: 'paragraph',
            text: 'This project is an agentic AI-powered QA automation platform that converts Jira user stories into fully executable Playwright automation with minimal manual effort. It coordinates specialized AI agents to read requirements, generate manual test cases, explore the live application under test, create production-ready scripts, execute those scripts with self-healing logic, and automatically report failures back into Jira with evidence.',
        },
        {
            type: 'paragraph',
            text: 'The primary business use case is to remove the delay and inconsistency between requirement definition and regression coverage. Instead of manually translating Jira tickets into test cases, automation code, execution steps, and bug reports, the platform performs that workflow end-to-end through an enforced pipeline with validation gates at every stage.',
        },
        {
            type: 'heading',
            level: 1,
            text: 'Primary Use Case',
        },
        {
            type: 'paragraph',
            text: 'The platform is designed for QA teams that receive feature requests, defect fixes, and acceptance criteria in Jira and need to turn those requirements into reliable browser automation quickly. It is especially suited for UAT-centric web application testing where selector accuracy, repeatability, and issue traceability are critical.',
        },
        {
            type: 'numbered-list',
            items: [
                'A Jira ticket URL is provided as the starting input to the workflow.',
                'The system reads the ticket summary, description, and acceptance criteria directly from Jira.',
                'TestGenie generates structured manual test cases in both Excel and markdown formats for traceability and review.',
                'ScriptGenerator opens the live application through MCP, navigates the relevant flows, captures accessibility snapshots, and extracts real selectors from the DOM.',
                'The system generates Playwright .spec.js automation using verified selectors and existing framework patterns such as page objects, config helpers, popup handling, and environment-aware test data.',
                'The generated automation is executed through the Playwright runner with retry-aware validation and self-healing logic.',
                'If execution still fails after healing attempts, BugGenie creates a structured Jira defect with reproduction steps, environment details, and evidence attachments.',
                'Execution artifacts and reports are stored for auditability and review.',
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Business Value',
        },
        {
            type: 'bullets',
            items: [
                'Reduces the time required to move from requirement to automated coverage.',
                'Improves consistency across test case format, selector strategy, and automation structure.',
                'Increases reliability by using live application exploration instead of guessed locators.',
                'Provides direct traceability between Jira requirements, generated tests, execution outcomes, and reported defects.',
                'Enables reusable knowledge through a learning store, grounding context, and knowledge base integration.',
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'System Architecture',
        },
        {
            type: 'table',
            title: 'Core Agent Roles',
            headers: ['Agent', 'Primary Responsibility', 'Key Output'],
            rows: [
                ['Orchestrator', 'Coordinates the full workflow and enforces stage order and quality gates', 'End-to-end pipeline execution'],
                ['TestGenie', 'Converts Jira acceptance criteria into structured manual test cases', 'Excel and markdown test cases'],
                ['ScriptGenerator', 'Explores the application via MCP and generates Playwright automation', '.spec.js files using verified selectors'],
                ['BugGenie', 'Creates Jira defect tickets for unresolved failures', 'Bug tickets with evidence and reproduction steps'],
                ['TaskGenie', 'Creates linked testing tasks and subtasks in Jira', 'Assigned Jira testing work items'],
                ['CodeReviewer', 'Reviews generated automation for quality and framework compliance', 'Quality findings and remediation guidance'],
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Pipeline Stages',
        },
        {
            type: 'table',
            title: 'Workflow Sequence',
            headers: ['Stage', 'Purpose', 'Validation Focus'],
            rows: [
                ['Preflight', 'Checks environment readiness before work starts', 'UAT reachability, Jira access, MCP availability, framework files'],
                ['Jira Fetch', 'Collects requirement and metadata from Jira', 'Ticket completeness and issue-type context'],
                ['Excel Create', 'Builds standardized manual test case output', 'Structure, required fields, and formatting rules'],
                ['MCP Explore', 'Navigates the live app and captures real UI state', 'Snapshot depth, role diversity, page readiness'],
                ['Script Generate', 'Creates Playwright automation using real selectors', 'Import order, selector strategy, framework patterns'],
                ['Script Execute', 'Runs generated automation in the target environment', 'Pass or fail result accuracy'],
                ['Self-Heal', 'Attempts targeted script repair for recoverable failures', 'Selector recovery and successful re-run'],
                ['BugGenie', 'Creates defects when failures remain unresolved', 'Ticket structure, evidence, environment details'],
                ['Report', 'Publishes execution outputs for stakeholders', 'Artifact generation and result visibility'],
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Technology Stack',
        },
        {
            type: 'table',
            title: 'Implementation Stack',
            headers: ['Area', 'Technology'],
            rows: [
                ['Test automation framework', 'Playwright with JavaScript and CommonJS'],
                ['AI orchestration layer', 'GitHub Copilot SDK with custom agent sessions and pipeline runner'],
                ['Live browser exploration', 'Custom unified-automation-mcp server'],
                ['Issue management', 'Jira Cloud REST API v2 and v3'],
                ['Knowledge integration', 'Confluence, Notion, SharePoint, and custom REST knowledge sources'],
                ['Grounding engine', 'BM25 and TF-IDF indexing over local project context'],
                ['Manual test case export', 'ExcelJS standardized template generator'],
                ['Document generation', 'DOCX generation using the docx library and repository design system'],
                ['Execution reporting', 'Playwright HTML reporting and Allure integration'],
                ['Configuration model', 'JSON config files with schema validation and dotenv environment support'],
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Additional Details',
        },
        {
            type: 'bullets',
            items: [
                'The platform follows an MCP-first architecture, meaning selectors are extracted from live application snapshots rather than inferred from requirements alone.',
                'The self-healing engine supports closed-loop recovery by analyzing execution failures, discovering alternative selectors, patching scripts, and retrying execution up to the configured limit.',
                'An OODA-based health and quality loop evaluates both environment readiness and exploration quality without requiring extra LLM calls, reducing cost and improving determinism.',
                'A tool broker allows cross-agent delegation so that specialized agents can access approved capabilities from other agent domains without changing sessions.',
                'The knowledge base connector supplements local code grounding with project documentation from Confluence, Notion, SharePoint, or custom APIs, improving contextual accuracy.',
                'The workflow stores artifacts such as test cases, snapshots, execution reports, and bug evidence to preserve traceability across runs.',
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Supported Integrations',
        },
        {
            type: 'table',
            title: 'External and Internal Integrations',
            headers: ['Integration', 'Supported Capabilities'],
            rows: [
                ['Jira Cloud', 'Read tickets, create bugs and testing tasks, update issues, transition status, add comments, attach files, log work, manage estimates, and link issues'],
                ['Confluence', 'Search documentation spaces and retrieve page content for grounding'],
                ['Notion', 'Search and consume domain documentation for agents'],
                ['SharePoint', 'Use enterprise documentation as a grounding source'],
                ['Unified MCP', 'Navigate, inspect, interact, wait, assert, and capture state from the live application'],
                ['ExcelJS', 'Generate branded and standardized test case spreadsheets'],
                ['Allure and Playwright reports', 'Provide execution output and stakeholder-facing reporting'],
            ],
        },
        {
            type: 'heading',
            level: 1,
            text: 'Conclusion',
        },
        {
            type: 'paragraph',
            text: 'This platform provides a practical, production-oriented approach to AI-driven QA automation. It connects requirements, test design, browser exploration, automation generation, execution, healing, and defect reporting into a single governed workflow. As a result, teams gain faster coverage, better consistency, stronger traceability, and lower manual effort across the QA lifecycle.',
        },
    ];

    const result = await generateDocx({
        title: 'Agentic AI-Powered QA Automation Platform',
        author: 'GitHub Copilot',
        includeTableOfContents: true,
        headerText: 'Project Use Case and Additional Details',
        footerText: 'Generated for project documentation attachment',
        theme: 'modern-blue',
        font: 'Aptos',
        sections,
        outputPath,
    });

    if (!result.success) {
        throw new Error(result.error || 'DOCX generation failed');
    }

    console.log(`DOCX created: ${result.filePath}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});