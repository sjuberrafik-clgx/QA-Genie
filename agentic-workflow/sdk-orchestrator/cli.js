#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ORCHESTRATOR CLI — Command-Line Pipeline Runner
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node agentic-workflow/sdk-orchestrator/cli.js --ticket AOTF-16339 --mode full
 *   node agentic-workflow/sdk-orchestrator/cli.js --ticket AOTF-16339 --mode heal
 *   node agentic-workflow/sdk-orchestrator/cli.js --tickets AOTF-001,AOTF-002 --parallel
 *   node agentic-workflow/sdk-orchestrator/cli.js --server              # Start HTTP server
 *   node agentic-workflow/sdk-orchestrator/cli.js --ticket X --ci       # CI mode (JSON output)
 *
 * Options:
 *   --ticket, -t      Jira ticket ID (e.g., AOTF-16339)
 *   --tickets         Comma-separated ticket IDs for parallel execution
 *   --mode, -m        Pipeline mode: full | generate | heal | execute (default: full)
 *   --env, -e         Environment: UAT | INT | PROD (default: UAT)
 *   --parallel        Run multiple tickets in parallel batches
 *   --ci              CI mode: headless, JSON stdout, structured exit codes
 *   --server          Start HTTP pipeline server (Phase 1)
 *   --port            Server port override (default: 3100 or SERVER_PORT env)
 *   --verbose, -v     Enable verbose logging
 *   --dry-run         Show what would run without executing
 *   --help, -h        Show this help
 *
 * Exit Codes (CI mode):
 *   0 — All tests passed
 *   1 — Test failures detected
 *   2 — Pipeline error (infrastructure/config)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { SDKOrchestrator } = require('./index');

// ─── Argument Parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = {
        ticket: null,
        tickets: [],
        mode: 'full',
        environment: 'UAT',
        parallel: false,
        ci: false,
        server: false,
        port: null,
        verbose: false,
        dryRun: false,
        help: false,
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        switch (arg) {
            case '--ticket':
            case '-t':
                args.ticket = next;
                i++;
                break;
            case '--tickets':
                args.tickets = (next || '').split(',').map(s => s.trim()).filter(Boolean);
                i++;
                break;
            case '--mode':
            case '-m':
                args.mode = next;
                i++;
                break;
            case '--env':
            case '-e':
                args.environment = (next || 'UAT').toUpperCase();
                i++;
                break;
            case '--parallel':
                args.parallel = true;
                break;
            case '--ci':
                args.ci = true;
                break;
            case '--server':
                args.server = true;
                break;
            case '--port':
                args.port = parseInt(next, 10);
                i++;
                break;
            case '--verbose':
            case '-v':
                args.verbose = true;
                break;
            case '--dry-run':
                args.dryRun = true;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                // Positional: treat as ticket ID if no flag provided
                if (!arg.startsWith('-') && !args.ticket) {
                    args.ticket = arg;
                }
                break;
        }
    }

    return args;
}

function showHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║            SDK ORCHESTRATOR — Pipeline CLI                   ║
╚══════════════════════════════════════════════════════════════╝

Usage:
  node sdk-orchestrator/cli.js --ticket <ID> [options]
  node sdk-orchestrator/cli.js --tickets <ID1>,<ID2> --parallel
  node sdk-orchestrator/cli.js --server [--port 3100]

Options:
  --ticket, -t <ID>      Jira ticket ID (e.g., AOTF-16339)
  --tickets <IDs>        Comma-separated ticket IDs
  --mode, -m <mode>      Pipeline mode (default: full)
                           full     — Full pipeline: test cases → script → execute → heal
                           generate — Skip test cases, just generate script + execute
                           heal     — Execute existing script + self-heal failures
                           execute  — Just run existing script, report results
  --env, -e <env>        Target environment: UAT | INT | PROD (default: UAT)
  --parallel             Process multiple tickets in parallel batches
  --ci                   CI mode: sets headless, outputs JSON, structured exit codes
  --server               Start HTTP pipeline server instead of running a pipeline
  --port <port>          Server port (default: 3100 or SERVER_PORT env var)
  --verbose, -v          Enable detailed logging
  --dry-run              Show pipeline plan without executing
  --help, -h             Show this help message

CI Exit Codes:
  0 — All tests passed
  1 — Test failures detected
  2 — Pipeline infrastructure error

Examples:
  node sdk-orchestrator/cli.js -t AOTF-16339 -m full
  node sdk-orchestrator/cli.js -t AOTF-16339 -m heal -v
  node sdk-orchestrator/cli.js --tickets AOTF-001,AOTF-002 --parallel
  node sdk-orchestrator/cli.js -t AOTF-16339 --ci --env UAT
  node sdk-orchestrator/cli.js --server --port 3100
`);
}

// ─── Progress Display ───────────────────────────────────────────────────────

function createProgressHandler() {
    const stageSymbols = {
        preflight: '🔍',
        testgenie: '📝',
        qg_excel: '🔒',
        scriptgenerator: '⚙️',
        qg_script: '🔒',
        execute: '🧪',
        healing: '🔧',
        buggenie: '🐛',
        report: '📊',
    };

    return (stage, message) => {
        const symbol = stageSymbols[stage] || '▸';
        const time = new Date().toLocaleTimeString();
        console.log(`  ${symbol} [${time}] ${stage.toUpperCase()}: ${message}`);
    };
}

function printResult(result) {
    console.log('\n' + '═'.repeat(60));
    console.log(`  RESULT: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`  Ticket: ${result.ticketId}`);
    console.log(`  Mode:   ${result.mode}`);
    console.log(`  Time:   ${result.duration}`);
    console.log('═'.repeat(60));

    if (result.stageResults) {
        console.log('\n  Stage Results:');
        for (const [stage, info] of Object.entries(result.stageResults)) {
            const icon = info.success ? '✅' : '❌';
            console.log(`    ${icon} ${stage}: ${info.message || 'done'}`);
        }
    }

    if (result.artifacts) {
        console.log('\n  Artifacts:');
        for (const [name, filePath] of Object.entries(result.artifacts)) {
            if (filePath) {
                console.log(`    📄 ${name}: ${path.basename(String(filePath))}`);
            }
        }
    }

    if (result.error) {
        console.log(`\n  ❌ Error: ${result.error}`);
    }

    console.log('');
}

// ─── CI Mode Helpers ────────────────────────────────────────────────────────

function setupCIMode() {
    process.env.HEADLESS = 'true';
    process.env.MCP_HEADLESS = 'true';
    process.env.CI = 'true';
}

function writeCISummary(results) {
    // Write GitHub Actions step summary if available
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
        const lines = [
            '## QA Pipeline Results',
            '',
            '| Ticket | Mode | Status | Duration |',
            '|--------|------|--------|----------|',
        ];
        for (const r of results) {
            const status = r.success ? ':white_check_mark: Pass' : ':x: Fail';
            lines.push(`| ${r.ticketId} | ${r.mode} | ${status} | ${r.duration} |`);
        }
        if (results.some(r => r.error)) {
            lines.push('', '### Errors', '');
            for (const r of results.filter(r => r.error)) {
                lines.push(`- **${r.ticketId}**: ${r.error}`);
            }
        }
        try {
            fs.appendFileSync(summaryFile, lines.join('\n') + '\n');
        } catch { /* non-critical */ }
    }
}

function getCIExitCode(results) {
    const hasInfraError = results.some(r => r.error && !r.stageResults?.execute);
    if (hasInfraError) return 2;
    const hasFailures = results.some(r => !r.success);
    return hasFailures ? 1 : 0;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    if (args.help) {
        showHelp();
        process.exit(0);
    }

    // ─── Server Mode ────────────────────────────────────────────────
    if (args.server) {
        const { startServer } = require('./server');
        const port = args.port || parseInt(process.env.SERVER_PORT, 10) || 3100;
        await startServer({ port, verbose: args.verbose });
        return; // Server runs indefinitely
    }

    // ─── CI Mode Setup ──────────────────────────────────────────────
    if (args.ci) {
        setupCIMode();
    }

    // Validate inputs
    const ticketIds = args.tickets.length > 0 ? args.tickets : (args.ticket ? [args.ticket] : []);

    if (ticketIds.length === 0) {
        if (!args.ci) {
            console.error('❌ Error: No ticket ID provided. Use --ticket <ID> or --tickets <ID1>,<ID2>');
            console.error('   Run with --help for usage information.');
        } else {
            process.stdout.write(JSON.stringify({ error: 'No ticket ID provided' }) + '\n');
        }
        process.exit(2);
    }

    const validModes = ['full', 'generate', 'heal', 'execute'];
    if (!validModes.includes(args.mode)) {
        if (!args.ci) {
            console.error(`❌ Error: Invalid mode "${args.mode}". Valid modes: ${validModes.join(', ')}`);
        } else {
            process.stdout.write(JSON.stringify({ error: `Invalid mode: ${args.mode}` }) + '\n');
        }
        process.exit(2);
    }

    // Dry run — just show plan
    if (args.dryRun) {
        const plan = {
            tickets: ticketIds,
            mode: args.mode,
            environment: args.environment,
            parallel: args.parallel,
            ci: args.ci,
        };

        if (args.ci) {
            process.stdout.write(JSON.stringify({ dryRun: true, plan }) + '\n');
        } else {
            console.log('\n📋 DRY RUN — Pipeline Plan:');
            console.log(`   Tickets:     ${ticketIds.join(', ')}`);
            console.log(`   Mode:        ${args.mode}`);
            console.log(`   Environment: ${args.environment}`);
            console.log(`   Parallel:    ${args.parallel}`);
            console.log(`   CI:          ${args.ci}`);
            console.log(`   Verbose:     ${args.verbose}`);
            console.log('\n   No actions taken.');
        }
        process.exit(0);
    }

    // Initialize orchestrator
    if (!args.ci) console.log('\n🚀 Initializing SDK Orchestrator...');
    const orchestrator = new SDKOrchestrator({ verbose: args.verbose });

    const allResults = [];

    try {
        await orchestrator.start();
        if (!args.ci) console.log('✅ Orchestrator ready.\n');

        const onProgress = args.ci ? () => { } : createProgressHandler();

        if (args.parallel && ticketIds.length > 1) {
            // Parallel execution
            if (!args.ci) console.log(`🔀 Running ${ticketIds.length} tickets in parallel...\n`);
            const results = await orchestrator.runParallel(ticketIds, {
                mode: args.mode,
                onProgress,
            });

            allResults.push(...results);

            if (!args.ci) {
                for (const result of results) {
                    printResult(result);
                }
                const successCount = results.filter(r => r.success).length;
                console.log(`\n📊 Summary: ${successCount}/${results.length} pipelines succeeded.`);
            }
        } else {
            // Sequential execution
            for (const ticketId of ticketIds) {
                if (!args.ci) console.log(`\n▶ Pipeline: ${ticketId} [${args.mode}]\n`);
                const result = await orchestrator.runPipeline(ticketId, {
                    mode: args.mode,
                    onProgress,
                });
                allResults.push(result);
                if (!args.ci) printResult(result);
            }
        }

        // CI output
        if (args.ci) {
            process.stdout.write(JSON.stringify({
                success: allResults.every(r => r.success),
                results: allResults,
                summary: {
                    total: allResults.length,
                    passed: allResults.filter(r => r.success).length,
                    failed: allResults.filter(r => !r.success).length,
                },
            }, null, 2) + '\n');

            writeCISummary(allResults);
            process.exit(getCIExitCode(allResults));
        }
    } catch (error) {
        if (args.ci) {
            process.stdout.write(JSON.stringify({
                success: false,
                error: error.message,
                results: allResults,
            }) + '\n');
            process.exit(2);
        } else {
            console.error(`\n💥 Fatal error: ${error.message}`);
            if (args.verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    } finally {
        await orchestrator.stop().catch(() => { });
    }
}

// Run
main().catch(err => {
    console.error(`Unhandled error: ${err.message}`);
    process.exit(1);
});
