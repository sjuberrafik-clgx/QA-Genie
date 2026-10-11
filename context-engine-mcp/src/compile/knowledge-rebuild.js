/**
 * Recompiles Repo Mesh knowledge (contracts, graph, business rules) from the local
 * clones by running the existing rebuild CLI in a child process. Local only — no git, no network.
 *
 * @module context-engine-mcp/compile/knowledge-rebuild
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

function parseJsonAfter(label, text) {
    const line = text.split('\n').find((l) => l.trim().startsWith(`${label}:`));
    if (!line) return null;
    try {
        return JSON.parse(line.slice(line.indexOf(':') + 1).trim());
    } catch {
        return null;
    }
}

export function parseRebuildOutput(stdout) {
    const text = String(stdout || '');
    const repos = text.match(/Repos on disk:\s*(\d+)/);
    const dna = parseJsonAfter('DNA', text);
    const rules = parseJsonAfter('Rules', text);
    return {
        reposOnDisk: repos ? Number(repos[1]) : null,
        contracts: dna,
        rules: rules ? { rules: rules.rules, features: rules.features, builtAt: rules.builtAt || null } : null,
    };
}

function run(file, args, opts) {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [file, ...args], { ...opts, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ')));
            resolve(stdout);
        });
    });
}

/**
 * @param {{workspaceRoot: string, timeoutMs?: number, runner?: Function}} opts
 * @returns {Promise<{ok: boolean, durationMs: number, reposOnDisk?: number, contracts?: object, rules?: object, error?: string}>}
 */
export async function rebuildKnowledge({ workspaceRoot, timeoutMs = 300_000, runner = run }) {
    const cwd = path.join(workspaceRoot, 'agentic-workflow');
    const script = path.join(cwd, 'scripts', 'repo-mesh-setup.js');
    const started = Date.now();
    try {
        const stdout = await runner(script, ['rebuild'], { cwd, timeout: timeoutMs });
        const parsed = parseRebuildOutput(stdout);
        const ok = Boolean(parsed.contracts && parsed.rules);
        return { ok, durationMs: Date.now() - started, ...parsed, ...(ok ? {} : { error: 'rebuild output could not be parsed' }) };
    } catch (err) {
        return { ok: false, durationMs: Date.now() - started, error: err.message };
    }
}
