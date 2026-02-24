/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GROUNDING SETUP — CLI for Index Management
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Interactive CLI for setting up and managing the grounding index.
 *
 * Commands:
 *   node scripts/grounding-setup.js init      — Create starter config + build index
 *   node scripts/grounding-setup.js rebuild    — Force rebuild of grounding index
 *   node scripts/grounding-setup.js stats      — Show index statistics
 *   node scripts/grounding-setup.js validate   — Validate grounding-config.json
 *   node scripts/grounding-setup.js query <q>  — Test a grounding query
 *
 * @module grounding-setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const AGENTIC_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(AGENTIC_DIR, '..');
const CONFIG_PATH = path.join(AGENTIC_DIR, 'config', 'grounding-config.json');
const SCHEMA_PATH = path.join(AGENTIC_DIR, 'config', 'grounding-config.schema.json');

// ─── CLI Entry ──────────────────────────────────────────────────────────────

const command = process.argv[2] || 'help';
const args = process.argv.slice(3);

(async () => {
    try {
        switch (command) {
            case 'init':
                await runInit();
                break;
            case 'rebuild':
                await runRebuild();
                break;
            case 'stats':
                await runStats();
                break;
            case 'validate':
                await runValidate();
                break;
            case 'query':
                await runQuery(args.join(' '));
                break;
            case 'add-feature':
                await runAddFeature(args);
                break;
            case 'add-term':
                await runAddTerm(args);
                break;
            case 'add-rule':
                await runAddRule(args);
                break;
            case 'list':
                await runList(args[0]);
                break;
            case 'help':
            default:
                printHelp();
                break;
        }
    } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
})();

// ─── Commands ───────────────────────────────────────────────────────────────

async function runInit() {
    console.log('\n🔧 Initializing Grounding System...\n');

    // Check if config already exists
    if (fs.existsSync(CONFIG_PATH)) {
        console.log(`  ✅ Config already exists: ${path.relative(PROJECT_ROOT, CONFIG_PATH)}`);
        console.log('  Skipping config generation. Use "rebuild" to re-index.\n');
    } else {
        console.log('  📝 Creating grounding-config.json from project scan...');
        const config = autoGenerateConfig();
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
        console.log(`  ✅ Config created: ${path.relative(PROJECT_ROOT, CONFIG_PATH)}`);
    }

    // Build index
    console.log('\n  📊 Building grounding index...');
    const { GroundingStore } = require('../grounding/grounding-store');
    const store = new GroundingStore({
        configPath: CONFIG_PATH,
        projectRoot: PROJECT_ROOT,
        verbose: true,
    });

    const result = store.buildIndex();
    console.log(`\n  ✅ Index built successfully!`);
    console.log(`     Chunks: ${result.chunks}`);
    console.log(`     Files:  ${result.files}`);
    console.log(`     Selectors: ${result.selectors}`);
    console.log(`     Time:   ${result.elapsed}ms`);

    // Print summary
    const stats = store.getStats();
    console.log(`\n  📈 Index Statistics:`);
    console.log(`     Project:     ${stats.projectName} (${stats.projectId})`);
    console.log(`     Features:    ${stats.features}`);
    console.log(`     Terminology: ${stats.terminologyEntries} entries`);
    console.log(`     Rules:       ${stats.customRules} custom rules`);
    if (stats.index) {
        console.log(`     Terms:       ${stats.index.totalTerms}`);
        console.log(`     Avg Doc Len: ${stats.index.avgDocLen} tokens`);
        console.log(`     By Type:     ${JSON.stringify(stats.index.byType)}`);
    }
    if (stats.selectors) {
        console.log(`     Selectors:   ${stats.selectors.totalSelectors}`);
        console.log(`     Avg Reliability: ${stats.selectors.avgReliability}`);
    }
    console.log('');
}

async function runRebuild() {
    console.log('\n🔄 Rebuilding Grounding Index...\n');

    if (!fs.existsSync(CONFIG_PATH)) {
        console.log('  ⚠ No grounding-config.json found. Run "init" first.');
        return;
    }

    const { GroundingStore } = require('../grounding/grounding-store');
    const store = new GroundingStore({
        configPath: CONFIG_PATH,
        projectRoot: PROJECT_ROOT,
        verbose: true,
    });

    const result = store.buildIndex({ force: true });
    console.log(`\n  ✅ Rebuilt: ${result.chunks} chunks, ${result.selectors} selectors, ${result.files} files (${result.elapsed}ms)`);
    console.log('');
}

async function runStats() {
    console.log('\n📊 Grounding Index Statistics\n');

    if (!fs.existsSync(CONFIG_PATH)) {
        console.log('  ⚠ No grounding-config.json found. Run "init" first.');
        return;
    }

    const { GroundingStore } = require('../grounding/grounding-store');
    const store = new GroundingStore({
        configPath: CONFIG_PATH,
        projectRoot: PROJECT_ROOT,
    });

    store.ensureInitialized();
    const stats = store.getStats();

    console.log(`  Project:        ${stats.projectName} (${stats.projectId})`);
    console.log(`  Initialized:    ${stats.initialized}`);
    console.log(`  Last Build:     ${stats.lastBuildTime || 'never'}`);
    console.log(`  Tracked Files:  ${stats.trackedFiles}`);
    console.log(`  Features:       ${stats.features}`);
    console.log(`  Terminology:    ${stats.terminologyEntries} entries`);
    console.log(`  Custom Rules:   ${stats.customRules}`);

    if (stats.index) {
        console.log(`\n  Index:`);
        console.log(`    Total Chunks:  ${stats.index.totalChunks}`);
        console.log(`    Total Terms:   ${stats.index.totalTerms}`);
        console.log(`    Avg Doc Len:   ${stats.index.avgDocLen} tokens`);
        console.log(`    By Type:       ${JSON.stringify(stats.index.byType, null, 2)}`);
    }

    if (stats.selectors) {
        console.log(`\n  Selector Registry:`);
        console.log(`    Total:         ${stats.selectors.totalSelectors}`);
        console.log(`    Avg Reliability: ${stats.selectors.avgReliability}`);
        console.log(`    By Source:     ${JSON.stringify(stats.selectors.bySource, null, 2)}`);
        console.log(`    By Type:       ${JSON.stringify(stats.selectors.byType, null, 2)}`);
    }

    console.log('');
}

async function runValidate() {
    console.log('\n🔍 Validating grounding-config.json...\n');

    if (!fs.existsSync(CONFIG_PATH)) {
        console.log('  ❌ Config file not found. Run "init" first.');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const errors = [];
    const warnings = [];

    // Required fields
    if (!config.version) errors.push('Missing "version" field');
    if (!config.project?.id) errors.push('Missing "project.id" field');
    if (!config.project?.applicationName) errors.push('Missing "project.applicationName" field');

    // Project ID format
    if (config.project?.id && !/^[a-z0-9][a-z0-9_-]*$/.test(config.project.id)) {
        errors.push(`Invalid project.id "${config.project.id}" — must be lowercase alphanumeric with hyphens/underscores`);
    }

    // Validate index sources exist
    for (const source of (config.indexSources || [])) {
        const absPath = path.resolve(PROJECT_ROOT, source.path);
        if (!fs.existsSync(absPath)) {
            warnings.push(`Index source not found: ${source.path}`);
        }
    }

    // Validate feature map references
    for (const feature of (config.featureMap || [])) {
        if (!feature.name) {
            errors.push('Feature map entry missing "name"');
        }
        for (const po of (feature.pageObjects || [])) {
            const poPath = path.resolve(PROJECT_ROOT, 'tests', 'pageobjects', po);
            if (!fs.existsSync(poPath)) {
                warnings.push(`Feature "${feature.name}" references missing page object: ${po}`);
            }
        }
        for (const bf of (feature.businessFunctions || [])) {
            const bfPath = path.resolve(PROJECT_ROOT, 'tests', 'business-functions', bf);
            if (!fs.existsSync(bfPath)) {
                warnings.push(`Feature "${feature.name}" references missing business function: ${bf}`);
            }
        }
    }

    // Index settings validation
    const settings = config.indexSettings || {};
    if (settings.chunkSize && (settings.chunkSize < 20 || settings.chunkSize > 500)) {
        errors.push(`chunkSize ${settings.chunkSize} out of range [20, 500]`);
    }
    if (settings.chunkOverlap && settings.chunkOverlap >= (settings.chunkSize || 80)) {
        errors.push('chunkOverlap must be less than chunkSize');
    }

    // Print results
    if (errors.length === 0 && warnings.length === 0) {
        console.log('  ✅ Configuration is valid!');
    } else {
        for (const err of errors) {
            console.log(`  ❌ ERROR: ${err}`);
        }
        for (const warn of warnings) {
            console.log(`  ⚠ WARNING: ${warn}`);
        }
    }

    console.log(`\n  Summary: ${errors.length} errors, ${warnings.length} warnings`);
    if (errors.length > 0) process.exit(1);
    console.log('');
}

async function runQuery(queryText) {
    if (!queryText) {
        console.log('Usage: node scripts/grounding-setup.js query <search text>');
        return;
    }

    console.log(`\n🔍 Query: "${queryText}"\n`);

    const { GroundingStore } = require('../grounding/grounding-store');
    const store = new GroundingStore({
        configPath: CONFIG_PATH,
        projectRoot: PROJECT_ROOT,
    });
    store.ensureInitialized();

    const results = store.query(queryText, { maxChunks: 5 });

    if (results.length === 0) {
        console.log('  No results found.');
        return;
    }

    console.log(`  Found ${results.length} results:\n`);
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        console.log(`  ── Result ${i + 1} ──────────────────────`);
        console.log(`  File:  ${r.filePath} (L${r.startLine}-${r.endLine})`);
        console.log(`  Type:  ${r.type}`);
        console.log(`  Score: ${r.score}`);
        console.log(`  Terms: ${r.matchedTerms.join(', ')}`);
        if (r.metadata?.classes?.length > 0) console.log(`  Classes: ${r.metadata.classes.join(', ')}`);
        if (r.metadata?.methods?.length > 0) console.log(`  Methods: ${r.metadata.methods.map(m => m.name).join(', ')}`);
        if (r.metadata?.locators?.length > 0) console.log(`  Locators: ${r.metadata.locators.length} found`);
        console.log(`  Preview: ${r.content.split('\n').slice(0, 5).join('\n  ')}`);
        console.log('');
    }
}

// ─── Auto-Generate Config ───────────────────────────────────────────────────

function autoGenerateConfig() {
    console.log('  Scanning project structure...');

    const config = {
        $schema: './grounding-config.schema.json',
        version: '1.0.0',
        project: {
            id: path.basename(PROJECT_ROOT).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, ''),
            applicationName: 'My Application',
            applicationDescription: 'Application under test',
            primaryUrl: '',
            authMethod: 'none',
            authNotes: '',
        },
        featureMap: [],
        domainTerminology: {},
        customGroundingRules: [],
        indexSources: [],
        indexSettings: {
            chunkSize: 80,
            chunkOverlap: 20,
            maxIndexEntries: 5000,
            classAwareChunking: true,
            extractMethodSignatures: true,
            extractLocators: true,
            fileExtensions: ['.js', '.json'],
            excludePatterns: ['node_modules', 'package-lock', '.spec.js'],
        },
        retrievalSettings: {
            maxChunksPerQuery: 10,
            minRelevanceScore: 0.12,
            boostFactors: {
                exactMatch: 3.0,
                fileNameMatch: 2.0,
                methodNameMatch: 2.5,
                locatorMatch: 2.0,
                featureKeywordMatch: 1.5,
            },
            agentBoosts: {
                scriptgenerator: ['locator', 'selector', 'getByRole', 'getByText', 'click', 'fill'],
                testgenie: ['feature', 'scenario', 'user', 'verify'],
                buggenie: ['error', 'fail', 'timeout', 'bug'],
                codereviewer: ['pattern', 'import', 'require', 'expect'],
            },
        },
        selectorRegistry: {
            enabled: true,
            priorityOrder: ['data-qa', 'data-test-id', 'getByRole', 'aria-label', 'getByText', 'css-class', 'xpath'],
            reliabilityScores: {
                'data-qa': 0.95,
                'data-test-id': 0.95,
                'getByRole': 0.85,
                'aria-label': 0.80,
                'getByText': 0.70,
                'css-class': 0.50,
                'xpath': 0.30,
            },
        },
        explorationFreshness: {
            maxAgeDays: 14,
            warnAgeDays: 7,
            autoInvalidate: false,
        },
    };

    // Auto-detect index sources
    const sourceCandidates = [
        { path: 'tests/pageobjects', type: 'pageObject', desc: 'Page Object classes' },
        { path: 'tests/business-functions', type: 'businessFunction', desc: 'Business flow functions' },
        { path: 'tests/utils', type: 'utility', desc: 'Utility functions' },
        { path: 'tests/config', type: 'config', desc: 'Framework configuration' },
        { path: 'tests/test-data', type: 'testData', desc: 'Test data and tokens' },
        { path: 'agentic-workflow/exploration-data', type: 'exploration', desc: 'MCP exploration snapshots' },
        // Fallback paths
        { path: 'pageobjects', type: 'pageObject', desc: 'Page Object classes' },
        { path: 'helpers', type: 'businessFunction', desc: 'Helper functions' },
        { path: 'utils', type: 'utility', desc: 'Utility functions' },
    ];

    const added = new Set();
    for (const candidate of sourceCandidates) {
        if (added.has(candidate.type)) continue;
        if (fs.existsSync(path.resolve(PROJECT_ROOT, candidate.path))) {
            config.indexSources.push({
                path: candidate.path,
                type: candidate.type,
                description: candidate.desc,
            });
            added.add(candidate.type);
            console.log(`    Found: ${candidate.path} → ${candidate.type}`);
        }
    }

    // Auto-detect feature folders from specs
    const specsDir = path.resolve(PROJECT_ROOT, 'tests', 'specs');
    if (fs.existsSync(specsDir)) {
        try {
            const folders = fs.readdirSync(specsDir, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name);
            for (const folder of folders) {
                config.featureMap.push({
                    name: folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: `Tests in specs/${folder}/`,
                    pages: [],
                    pageObjects: [],
                    businessFunctions: [],
                    keywords: [folder.toLowerCase()],
                });
            }
            console.log(`    Detected ${folders.length} feature folder(s) from specs/`);
        } catch { /* skip */ }
    }

    return config;
}

// ─── Add Feature ────────────────────────────────────────────────────────────

async function runAddFeature(args) {
    if (args.length === 0) {
        console.log(`
  Usage: node agentic-workflow/scripts/grounding-setup.js add-feature <name> [options]

  Options (key=value format):
    desc="Feature description"
    pages="/page1,/page2"
    pageObjects="file1.js,file2.js"
    businessFunctions="func1.js,func2.js"
    keywords="kw1,kw2,kw3"

  Examples:
    node agentic-workflow/scripts/grounding-setup.js add-feature "Mortgage Calculator" desc="EMC widget" pages="/property/mortgage" keywords="mortgage,EMC,payment"
    node agentic-workflow/scripts/grounding-setup.js add-feature "Saved Searches" keywords="saved,search,alert"
`);
        return;
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const name = args[0];

    // Check for duplicates
    if (config.featureMap.some(f => f.name.toLowerCase() === name.toLowerCase())) {
        console.log(`\n  ⚠ Feature "${name}" already exists. Edit grounding-config.json manually to update it.`);
        return;
    }

    // Parse key=value options
    const opts = parseKeyValueArgs(args.slice(1));

    const feature = {
        name,
        description: opts.desc || opts.description || '',
        pages: opts.pages ? opts.pages.split(',').map(s => s.trim()) : [],
        pageObjects: opts.pageObjects ? opts.pageObjects.split(',').map(s => s.trim()) : [],
        businessFunctions: opts.businessFunctions ? opts.businessFunctions.split(',').map(s => s.trim()) : [],
        keywords: opts.keywords
            ? opts.keywords.split(',').map(s => s.trim())
            : [name.toLowerCase().replace(/\s+/g, ' ')],
    };

    config.featureMap.push(feature);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    console.log(`\n  ✅ Feature added: "${name}"`);
    console.log(`     Pages:     ${feature.pages.join(', ') || '(none)'}`);
    console.log(`     Objects:   ${feature.pageObjects.join(', ') || '(none)'}`);
    console.log(`     Functions: ${feature.businessFunctions.join(', ') || '(none)'}`);
    console.log(`     Keywords:  ${feature.keywords.join(', ')}`);
    console.log(`\n  💡 Run "rebuild" to update the index with the new feature.\n`);
}

// ─── Add Terminology ────────────────────────────────────────────────────────

async function runAddTerm(args) {
    if (args.length < 2) {
        console.log(`
  Usage: node agentic-workflow/scripts/grounding-setup.js add-term <abbreviation> <definition>

  Examples:
    node agentic-workflow/scripts/grounding-setup.js add-term HOA "Homeowner Association — monthly fees charged by property communities"
    node agentic-workflow/scripts/grounding-setup.js add-term ARV "After Repair Value — estimated property value post-renovation"
    node agentic-workflow/scripts/grounding-setup.js add-term IDX "Internet Data Exchange — system for sharing MLS listings"
`);
        return;
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const term = args[0];
    const definition = args.slice(1).join(' ');

    if (config.domainTerminology[term]) {
        console.log(`\n  ⚠ Term "${term}" already exists: "${config.domainTerminology[term]}"`);
        console.log(`  Updating with new definition...`);
    }

    config.domainTerminology[term] = definition;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    console.log(`\n  ✅ Term added: ${term} = "${definition}"`);
    console.log(`\n  💡 Run "rebuild" to update the index.\n`);
}

// ─── Add Rule ───────────────────────────────────────────────────────────────

async function runAddRule(args) {
    if (args.length === 0) {
        console.log(`
  Usage: node agentic-workflow/scripts/grounding-setup.js add-rule <rule text>

  Examples:
    node agentic-workflow/scripts/grounding-setup.js add-rule "Mortgage tests must verify EMC values against fixture data"
    node agentic-workflow/scripts/grounding-setup.js add-rule "Never hardcode MLS-specific URLs — use testData tokens"
`);
        return;
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const rule = args.join(' ');

    if (config.customGroundingRules.includes(rule)) {
        console.log(`\n  ⚠ Rule already exists: "${rule}"`);
        return;
    }

    config.customGroundingRules.push(rule);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    console.log(`\n  ✅ Rule added (#${config.customGroundingRules.length}): "${rule}"`);
    console.log(`\n  💡 Run "rebuild" to update the index.\n`);
}

// ─── List ───────────────────────────────────────────────────────────────────

async function runList(section) {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log('\n  ⚠ No grounding-config.json found. Run "init" first.\n');
        return;
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

    if (!section || section === 'features') {
        console.log('\n  📝 Features:');
        for (const f of config.featureMap) {
            console.log(`    • ${f.name} — ${f.description || '(no description)'}`);
            if (f.pages.length) console.log(`      Pages: ${f.pages.join(', ')}`);
            if (f.keywords.length) console.log(`      Keywords: ${f.keywords.join(', ')}`);
        }
    }

    if (!section || section === 'terms') {
        console.log('\n  📚 Terminology:');
        for (const [term, def] of Object.entries(config.domainTerminology)) {
            console.log(`    • ${term} — ${def}`);
        }
    }

    if (!section || section === 'rules') {
        console.log('\n  📏 Rules:');
        config.customGroundingRules.forEach((r, i) => {
            console.log(`    ${i + 1}. ${r}`);
        });
    }

    console.log('');
}

// ─── Parse key=value Arguments ──────────────────────────────────────────────

function parseKeyValueArgs(args) {
    const result = {};
    let current = args.join(' ');

    // Match key="value" or key=value patterns
    const regex = /(\w+)=(?:"([^"]*)"|([^\s]+))/g;
    let match;
    while ((match = regex.exec(current)) !== null) {
        result[match[1]] = match[2] !== undefined ? match[2] : match[3];
    }

    return result;
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`
  🌐 Grounding Setup — Local Context for LLM Agents

  Usage: node agentic-workflow/scripts/grounding-setup.js <command>

  Commands:
    init        Create grounding-config.json and build initial index
    rebuild     Force full index rebuild
    stats       Show index statistics
    validate    Validate grounding-config.json against schema
    query <q>   Test a grounding query (e.g., "search panel filter locators")
    add-feature Add a new feature to the grounding config
    add-term    Add a new domain term/abbreviation
    add-rule    Add a new custom grounding rule
    list        List features, terms, and/or rules (list features|terms|rules)
    help        Show this help message

  Examples:
    node agentic-workflow/scripts/grounding-setup.js init
    node agentic-workflow/scripts/grounding-setup.js query "login authentication token"
    node agentic-workflow/scripts/grounding-setup.js add-feature "Saved Searches" keywords="saved,search,alert"
    node agentic-workflow/scripts/grounding-setup.js add-term HOA "Homeowner Association fees"
    node agentic-workflow/scripts/grounding-setup.js add-rule "Always dismiss popups before assertions"
    node agentic-workflow/scripts/grounding-setup.js list features
    node agentic-workflow/scripts/grounding-setup.js stats
`);
}
