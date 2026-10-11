#!/usr/bin/env node
/**
 * Environment diagnosis: git, registry, data dir, clone presence, and read-only GitHub reachability.
 *
 *   node scripts/diagnose.js
 */

import fs from 'node:fs';
import { createContextEngine } from '../src/index.js';
import { runGit } from '../src/sync/read-only-git.js';

const checks = [];
const record = (name, ok, detail) => checks.push({ check: name, ok, detail });

async function main() {
    try {
        record('git binary', true, (await runGit(['version'])).trim());
    } catch (err) {
        record('git binary', false, err.message);
    }

    let engine;
    try {
        engine = createContextEngine(process.env);
        record('registry', true, `${engine.config.registry.repos.length} repos · access=${engine.config.registry.access}`);
    } catch (err) {
        record('registry', false, err.message);
        return;
    }

    const { config, freshness } = engine;
    try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.accessSync(config.dataDir, fs.constants.W_OK);
        record('data dir', true, config.dataDir);
    } catch (err) {
        record('data dir', false, err.message);
    }

    const repos = freshness.repos();
    const present = repos.filter((r) => freshness.isPresent(r)).length;
    record('local clones', present > 0, `${present}/${repos.length} present`);

    try {
        const probe = await freshness.resolveRemote(repos[0]);
        record('GitHub read access', true, `${repos[0].name} → ${probe.ref} (${probe.sha.slice(0, 10)})`);
    } catch (err) {
        const vpn = /allow list/i.test(err.message) ? ' — connect the Appgate VPN' : '';
        record('GitHub read access', false, `${err.message}${vpn}`);
    }
}

main().finally(() => {
    console.table(checks);
    process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
});
