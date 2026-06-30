#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENTIC WORKFLOW — PROJECT SETUP SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run this once when setting up the agentic workflow in a new project:
 *   node scripts/setup-project.js
 *
 * What it does:
 *   1. Checks for .env — copies from .env.example if missing
 *   2. Detects framework mode (full existing framework vs. fresh start)
 *   3. Scaffolds stub files if no existing framework is detected
 *   4. Creates required directories
 *   5. Validates the setup
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// Resolve paths relative to the agentic-workflow root
const AGENTIC_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(AGENTIC_ROOT, '..');

console.log('═'.repeat(70));
console.log('🚀 AGENTIC WORKFLOW — PROJECT SETUP');
console.log('═'.repeat(70));
console.log(`   Agentic Workflow Dir : ${AGENTIC_ROOT}`);
console.log(`   Host Project Root    : ${PROJECT_ROOT}`);
console.log('');

// ─── Step 1: .env file ─────────────────────────────────────────────────────

const envPath = path.join(AGENTIC_ROOT, '.env');
const envExamplePath = path.join(AGENTIC_ROOT, '.env.example');

if (fs.existsSync(envPath)) {
    console.log('✅ .env file found');
} else if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('📝 Created .env from .env.example — please fill in your values');
} else {
    console.log('⚠️  No .env.example found — skipping .env creation');
}

// ─── Step 2: Detect Framework Mode ─────────────────────────────────────────

// Inline detection (mirrors project-path-resolver.js logic)
function detectFrameworkMode(root) {
    const markers = [
        ['POmanager', ['tests/pageobjects/POmanager.js', 'pageobjects/POmanager.js']],
        ['config', ['tests/config/config.js', 'config/config.js']],
        ['testData', ['tests/test-data/testData.js', 'test-data/testData.js']],
    ];
    let found = 0;
    const details = [];
    for (const [name, paths] of markers) {
        let detected = false;
        for (const p of paths) {
            if (fs.existsSync(path.resolve(root, p))) {
                details.push(`   ✅ ${name} → ${p}`);
                detected = true;
                found++;
                break;
            }
        }
        if (!detected) {
            details.push(`   ❌ ${name} → not found`);
        }
    }
    return { mode: found >= 3 ? 'full' : found >= 1 ? 'full' : 'basic', found, details };
}

console.log('\n🔍 Detecting framework mode...');
const detection = detectFrameworkMode(PROJECT_ROOT);
detection.details.forEach(d => console.log(d));
console.log(`\n   Framework Mode: ${detection.mode.toUpperCase()} (${detection.found}/3 markers found)`);

// ─── Step 3: Scaffold Stubs (basic mode only) ──────────────────────────────

if (detection.mode === 'basic') {
    console.log('\n📦 No existing framework detected. Scaffolding starter files...\n');

    const stubs = [
        {
            path: 'tests/config/config.js',
            content: `/**
 * Browser Configuration — Starter Stub
 * Replace this with your actual browser launch logic.
 */
const { chromium } = require('@playwright/test');

async function launchBrowser() {
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
}

module.exports = { launchBrowser };
`,
        },
        {
            path: 'tests/pageobjects/POmanager.js',
            content: `/**
 * Page Object Manager — Starter Stub
 * Add your page object classes here and expose them via the constructor.
 */
class POmanager {
    constructor(page) {
        this.page = page;
    }
    generalFunctions() {
        return {
            openOneHome: async (token) => {
                const baseUrl = process.env.UAT_URL || 'http://localhost:3000';
                await this.page.goto(baseUrl);
            },
        };
    }
    homePage() {
        return { signInButton: this.page.getByRole('button', { name: 'Sign In' }) };
    }
}

module.exports = POmanager;
`,
        },
        {
            path: 'tests/test-data/testData.js',
            content: `/**
 * Test Data — Starter Stub
 * Fill in your environment tokens, credentials, and base URLs.
 * Reads from .env where possible.
 */
require('dotenv').config();

const baseUrl = process.env.UAT_URL || 'http://localhost:3000';

const userTokens = {
    registered: process.env.UAT_TOKEN || 'REPLACE_WITH_YOUR_TOKEN',
};

const credentials = {
    email: process.env.TEST_EMAIL || 'user@example.com',
    password: process.env.TEST_PASSWORD || '',
};

module.exports = { userTokens, credentials, baseUrl };
`,
        },
        {
            path: 'tests/business-functions/login.js',
            content: `/**
 * Login Business Functions — Starter Stub
 */
class LoginFunctions {
    constructor(page) {
        this.page = page;
    }
    async signIn(email, password) {
        // Replace with your actual login flow
        await this.page.fill('input[type="email"]', email);
        await this.page.fill('input[type="password"]', password);
        await this.page.click('button[type="submit"]');
    }
}

module.exports = LoginFunctions;
`,
        },
        {
            path: 'tests/utils/general.js',
            content: `/**
 * General Utilities — Starter Stub
 */
const { getDateAndTimeISTiso } = require('../../agentic-workflow/utils/date-time');

function getDateAndTimeIST() {
    return getDateAndTimeISTiso();
}

module.exports = { getDateAndTimeIST };
`,
        },
    ];

    for (const stub of stubs) {
        const fullPath = path.resolve(PROJECT_ROOT, stub.path);
        if (fs.existsSync(fullPath)) {
            console.log(`   ⏭️  Exists: ${stub.path}`);
        } else {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, stub.content, 'utf-8');
            console.log(`   ✅ Created: ${stub.path}`);
        }
    }
} else {
    console.log('\n✅ Existing framework detected — no scaffold needed.');
}

// ─── Step 4: Ensure Required Directories ────────────────────────────────────

console.log('\n📁 Ensuring required directories exist...');

const requiredDirs = [
    path.join(AGENTIC_ROOT, 'test-cases'),
    path.join(AGENTIC_ROOT, 'exploration-data'),
    path.join(AGENTIC_ROOT, 'test-results'),
    path.join(AGENTIC_ROOT, 'test-artifacts', 'reports'),
    path.join(AGENTIC_ROOT, '.github', 'agents', 'state'),
    path.resolve(PROJECT_ROOT, 'tests', 'specs'),
];

for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`   ✅ Created: ${path.relative(PROJECT_ROOT, dir)}`);
    } else {
        console.log(`   ✓  Exists:  ${path.relative(PROJECT_ROOT, dir)}`);
    }
}

// ─── Step 5: Validate Setup ─────────────────────────────────────────────────

console.log('\n🔍 Validating setup...\n');

const checks = [
    { name: '.env file', pass: fs.existsSync(envPath) },
    { name: 'config/workflow-config.json', pass: fs.existsSync(path.join(AGENTIC_ROOT, 'config', 'workflow-config.json')) },
    { name: '.vscode/mcp.json (MCP servers)', pass: fs.existsSync(path.join(AGENTIC_ROOT, '.vscode', 'mcp.json')) },
    { name: 'package.json', pass: fs.existsSync(path.join(AGENTIC_ROOT, 'package.json')) },
    { name: 'mcp-server/package.json', pass: fs.existsSync(path.join(AGENTIC_ROOT, 'mcp-server', 'package.json')) },
    { name: 'playwright.config.js', pass: fs.existsSync(path.join(AGENTIC_ROOT, 'playwright.config.js')) },
    { name: '.github/agents/ (agent definitions)', pass: fs.existsSync(path.join(AGENTIC_ROOT, '.github', 'agents', 'orchestrator.agent.md')) },
];

let allPass = true;
for (const c of checks) {
    console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}`);
    if (!c.pass) allPass = false;
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
if (allPass) {
    console.log('✅ SETUP COMPLETE — Ready to use the agentic workflow!');
} else {
    console.log('⚠️  SETUP COMPLETE with warnings — review the items above.');
}
console.log('═'.repeat(70));

console.log('\n📋 Next Steps:');
console.log('   1. Edit .env with your Jira, environment URLs, and tokens');
console.log('   2. Run: npm install');
console.log('   3. Open the agentic-workflow/ folder in VS Code');
console.log('   4. MCP servers will auto-activate from .vscode/mcp.json');
console.log('   5. Use @orchestrator <jira-url> to start the pipeline');
console.log('');
