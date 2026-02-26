#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KB-SETUP — Knowledge Base Connector CLI
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manage the Knowledge Base connector — initialize, sync, query, validate.
 *
 * Usage:
 *   node agentic-workflow/scripts/kb-setup.js init       # Initialize providers + test connections
 *   node agentic-workflow/scripts/kb-setup.js sync       # Pre-sync configured pages into cache
 *   node agentic-workflow/scripts/kb-setup.js query "search filters"  # Test a query
 *   node agentic-workflow/scripts/kb-setup.js stats      # Show cache/provider statistics
 *   node agentic-workflow/scripts/kb-setup.js clear      # Clear local cache
 *   node agentic-workflow/scripts/kb-setup.js validate   # Validate config + credentials
 *   node agentic-workflow/scripts/kb-setup.js spaces     # List available spaces/sites
 *
 * @module kb-setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (!process.env[key]) process.env[key] = value;
        }
    }
}

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'grounding-config.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error('❌ grounding-config.json not found at:', CONFIG_PATH);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function log(msg) {
    console.log(`  ${msg}`);
}

function header(title) {
    console.log('');
    console.log(`═══ ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdInit() {
    header('Initialize Knowledge Base');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};

    if (!kbConfig.enabled) {
        log('⚠ Knowledge Base is disabled in grounding-config.json');
        log('  Set "knowledgeBase.enabled": true to enable.');
        return;
    }

    const { getKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
    const connector = getKnowledgeBaseConnector(kbConfig);

    log('Initializing providers...');
    await connector.initialize();

    // Test connections
    log('');
    log('Testing connections:');
    for (const provider of connector._providers || []) {
        try {
            const result = await provider.testConnection();
            if (result.connected) {
                log(`  ✅ ${provider.getProviderName()}: Connected (${result.latencyMs}ms)`);
            } else {
                log(`  ❌ ${provider.getProviderName()}: ${result.message}`);
            }
        } catch (err) {
            log(`  ❌ ${provider.getProviderName()}: ${err.message}`);
        }
    }

    log('');
    log('✅ Knowledge Base initialized');
}

async function cmdSync() {
    header('Sync Knowledge Base');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};

    if (!kbConfig.enabled) {
        log('⚠ Knowledge Base is disabled.');
        return;
    }

    const { getKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
    const connector = getKnowledgeBaseConnector(kbConfig);
    await connector.initialize();

    const syncPageIds = kbConfig.sync?.syncPageIds || [];
    const syncSpaceKeys = kbConfig.sync?.syncSpaceKeys || [];

    if (syncPageIds.length === 0 && syncSpaceKeys.length === 0) {
        log('No syncPageIds or syncSpaceKeys configured.');
        log('Add page IDs to sync in grounding-config.json → knowledgeBase.sync.syncPageIds');
        return;
    }

    log(`Syncing: ${syncPageIds.length} page(s), ${syncSpaceKeys.length} space(s)...`);

    const result = await connector.syncPages({
        pageIds: syncPageIds,
        spaceKeys: syncSpaceKeys,
    });

    log(`✅ Synced ${result.synced} page(s)`);
    if (result.errors?.length > 0) {
        log(`⚠ ${result.errors.length} error(s):`);
        for (const err of result.errors) {
            log(`  - ${err}`);
        }
    }
}

async function cmdQuery(queryText) {
    header(`Query: "${queryText}"`);

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};

    if (!kbConfig.enabled) {
        log('⚠ Knowledge Base is disabled.');
        return;
    }

    const { getKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
    const connector = getKnowledgeBaseConnector(kbConfig);
    await connector.initialize();

    const result = await connector.query(queryText, { maxResults: 10 });

    if (result.intent) {
        log(`Intent: confidence=${result.intent.confidence.toFixed(2)}, shouldFetch=${result.intent.shouldFetch}`);
        if (result.intent.matchedTerms?.length > 0) {
            log(`  Matched terms: ${result.intent.matchedTerms.join(', ')}`);
        }
        if (result.intent.matchedFeatures?.length > 0) {
            log(`  Matched features: ${result.intent.matchedFeatures.join(', ')}`);
        }
    }

    log(`Source: ${result.fromCache ? 'cache' : 'live API'}`);
    log(`Results: ${result.results.length}`);
    log('');

    for (const r of result.results) {
        log(`📄 ${r.title}`);
        log(`   ID: ${r.id} | Space: ${r.space} | Modified: ${r.lastModified}`);
        if (r.url) log(`   URL: ${r.url}`);
        if (r.excerpt) log(`   ${r.excerpt.substring(0, 150)}...`);
        log('');
    }

    // Also show formatted context
    const context = await connector.buildKBContext(queryText, { maxChars: 2000 });
    if (context) {
        header('Formatted Context (as injected into agent)');
        console.log(context);
    }
}

async function cmdStats() {
    header('Knowledge Base Statistics');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};

    if (!kbConfig.enabled) {
        log('⚠ Knowledge Base is disabled.');
        return;
    }

    const { getKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
    const connector = getKnowledgeBaseConnector(kbConfig);
    await connector.initialize();

    // Provider stats
    log('Providers:');
    for (const provider of connector._providers || []) {
        log(`  • ${provider.getProviderName()} (${provider.type})`);
    }

    // Cache stats
    if (connector._cache) {
        const stats = connector._cache.getStats();
        log('');
        log('Cache:');
        log(`  Total entries: ${stats.totalEntries}`);
        log(`  Expired entries: ${stats.expiredEntries}`);
        log(`  Cache file size: ${stats.fileSizeKB || 0} KB`);
        log(`  TTL: ${kbConfig.cache?.ttlMinutes || 30} min`);
        log(`  Max entries: ${kbConfig.cache?.maxEntries || 200}`);
    }

    // Intent detection config
    if (kbConfig.intentDetection?.enabled !== false) {
        log('');
        log('Intent Detection:');
        log(`  Domain terms: ${(kbConfig.intentDetection?.domainTerms || []).length}`);
        log(`  Trigger terms: ${(kbConfig.intentDetection?.triggerTerms || []).length}`);
        log(`  Confidence threshold: ${kbConfig.intentDetection?.confidenceThreshold || 0.3}`);
    }
}

async function cmdClear() {
    header('Clear Knowledge Base Cache');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};
    const cachePath = path.join(__dirname, '..', kbConfig.cache?.persistPath || 'knowledge-base-data/kb-cache.json');

    if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        log(`✅ Deleted cache file: ${cachePath}`);
    } else {
        log('No cache file found.');
    }

    // Also reset singleton
    try {
        const { resetKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
        if (resetKnowledgeBaseConnector) resetKnowledgeBaseConnector();
    } catch { /* ignore */ }

    log('Cache cleared.');
}

async function cmdValidate() {
    header('Validate Knowledge Base Configuration');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};
    let valid = true;

    // Check enabled
    log(`enabled: ${kbConfig.enabled ? '✅ true' : '⚠ false'}`);

    // Check providers
    const providers = kbConfig.providers || [];
    log(`providers: ${providers.length} configured`);
    for (const p of providers) {
        log(`  • ${p.name} (${p.type}): ${p.enabled !== false ? '✅ enabled' : '⚠ disabled'}`);

        if (p.type === 'confluence') {
            const baseUrl = p.baseUrl || process.env.CONFLUENCE_BASE_URL;
            const email = process.env.JIRA_EMAIL;
            const token = process.env.JIRA_API_TOKEN;

            if (!baseUrl) { log('    ❌ Missing CONFLUENCE_BASE_URL'); valid = false; }
            else log(`    baseUrl: ${baseUrl}`);

            if (!email) { log('    ❌ Missing JIRA_EMAIL'); valid = false; }
            else log(`    email: ${email}`);

            if (!token) { log('    ❌ Missing JIRA_API_TOKEN'); valid = false; }
            else log(`    token: ${'*'.repeat(8)}...set`);
        }
    }

    // Check cache config
    if (kbConfig.cache) {
        log(`cache: ttl=${kbConfig.cache.ttlMinutes || 30}min, max=${kbConfig.cache.maxEntries || 200}`);
    }

    // Check intent detection
    if (kbConfig.intentDetection) {
        log(`intentDetection: threshold=${kbConfig.intentDetection.confidenceThreshold || 0.3}`);
        log(`  domainTerms: ${(kbConfig.intentDetection.domainTerms || []).length}`);
        log(`  triggerTerms: ${(kbConfig.intentDetection.triggerTerms || []).length}`);
    }

    log('');
    log(valid ? '✅ Configuration is valid' : '❌ Configuration has issues — fix the errors above');
}

async function cmdSpaces() {
    header('Available Spaces / Sites');

    const config = loadConfig();
    const kbConfig = config.knowledgeBase || {};

    if (!kbConfig.enabled) {
        log('⚠ Knowledge Base is disabled.');
        return;
    }

    const { getKnowledgeBaseConnector } = require('../knowledge-base/kb-connector');
    const connector = getKnowledgeBaseConnector(kbConfig);
    await connector.initialize();

    for (const provider of connector._providers || []) {
        log(`${provider.getProviderName()} (${provider.type}):`);
        try {
            const spaces = await provider.listSpaces();
            for (const s of spaces) {
                log(`  • ${s.key}: ${s.name}${s.url ? ` — ${s.url}` : ''}`);
            }
        } catch (err) {
            log(`  ❌ Error: ${err.message}`);
        }
        log('');
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const [command, ...args] = process.argv.slice(2);

    if (!command) {
        console.log(`
Knowledge Base CLI — Manage external KB connections

Usage:
  node kb-setup.js <command> [args]

Commands:
  init               Initialize providers and test connections
  sync               Pre-sync configured pages into local cache
  query <text>       Search the Knowledge Base
  stats              Show cache and provider statistics
  clear              Clear local cache
  validate           Validate configuration and credentials
  spaces             List available spaces/sites from all providers
`);
        process.exit(0);
    }

    try {
        switch (command) {
            case 'init': await cmdInit(); break;
            case 'sync': await cmdSync(); break;
            case 'query': await cmdQuery(args.join(' ')); break;
            case 'stats': await cmdStats(); break;
            case 'clear': await cmdClear(); break;
            case 'validate': await cmdValidate(); break;
            case 'spaces': await cmdSpaces(); break;
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        if (process.env.DEBUG) console.error(error.stack);
        process.exit(1);
    }
}

main();
