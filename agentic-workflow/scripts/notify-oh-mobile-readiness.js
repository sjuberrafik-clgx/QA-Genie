#!/usr/bin/env node

const path = require('path');
const { JiraReadinessMonitor, fetchReleaseReadyTickets } = require('../sdk-orchestrator/jira-readiness-monitor');
const { Notifier } = require('../sdk-orchestrator/notifier');
const { loadEnv, loadWorkflowConfig } = require('../sdk-orchestrator/utils');

async function main() {
    const args = new Set(process.argv.slice(2));
    const dryRun = args.has('--dry-run');
    const notifyCurrent = args.has('--notify-current');
    const releaseMode = args.has('--release');
    if (!dryRun && !notifyCurrent) {
        throw new Error('Use --dry-run to preview or --notify-current to send the current matching list.');
    }

    loadEnv();
    const rootConfig = loadWorkflowConfig();
    const config = releaseMode
        ? (rootConfig.releaseReadinessMonitor || {})
        : (rootConfig.ticketReadinessMonitor || {});
    const monitor = new JiraReadinessMonitor({
        config: { ...config, enabled: true },
        ...(releaseMode ? {
            statePath: path.join(__dirname, '..', 'test-artifacts', 'jira-release-readiness-monitor.json'),
            fetchReport: () => fetchReleaseReadyTickets(config),
        } : {}),
        notifier: new Notifier(releaseMode ? {
            enabled: true,
            slackWebhookUrl: process.env.AOTF_RELEASE_SLACK_WEBHOOK_URL || null,
            teamsWebhookUrl: process.env.AOTF_RELEASE_TEAMS_WEBHOOK_URL || null,
            useDefaultEnvironmentWebhooks: false,
        } : { enabled: true }),
        logger: message => console.log(message),
    });
    const result = await monitor.runOnce({ dryRun, notifyCurrent: true });

    if (dryRun) {
        if (releaseMode) console.log(`Active release: ${result.context.title.replace(' tickets ready for QA', '')}`);
        console.table(result.tickets.map(ticket => ({
            'ISSUE TYPE': ticket.issueType,
            'Issue key': ticket.issueKey,
            Summary: ticket.summary,
            Status: ticket.status,
            'Related Modules': ticket.relatedModules,
            Assignee: ticket.assignee,
            'Story Points': ticket.storyPoints,
        })));
        console.log(`\n${result.tickets.length} matching ticket(s). No notification sent.`);
    } else {
        console.log(
            `Webhook accepted for ${result.readyTickets.length} ticket(s). ` +
            'Verify the Power Automate run history for downstream Teams delivery.'
        );
    }
}

main().catch(error => {
    console.error(`Jira readiness notification failed: ${error.message}`);
    process.exitCode = 1;
});