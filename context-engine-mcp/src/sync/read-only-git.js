/**
 * Read-only git runner. Every command is checked against an allowlist before it
 * reaches the git binary: remote access is limited to ls-remote/fetch/clone and
 * everything else must be local-only.
 *
 * @module context-engine-mcp/sync/read-only-git
 */

import { execFile } from 'node:child_process';

export const NO_PUSH_URL = 'no-push://context-engine-read-only';

const REMOTE_READ = new Set(['ls-remote', 'fetch', 'clone']);
const LOCAL_ONLY = new Set(['rev-parse', 'diff', 'log', 'show', 'cat-file', 'rev-list', 'status', 'checkout', 'config', 'version', 'merge-base']);

// Options that can run arbitrary programs or rewrite repo config during a remote read.
const FORBIDDEN_OPTION = /^(--upload-pack|-u$|--receive-pack|--exec|--config|-c$|--template|--separate-git-dir|--recurse-submodules|--push)/;

export class ReadOnlyViolation extends Error {
    constructor(message) {
        super(`read-only guard: ${message}`);
        this.name = 'ReadOnlyViolation';
        this.code = 'CE_READ_ONLY_VIOLATION';
    }
}

export function assertReadOnly(args) {
    if (!Array.isArray(args) || args.length === 0) throw new ReadOnlyViolation('empty git command');
    const [sub, ...rest] = args.map(String);
    if (!REMOTE_READ.has(sub) && !LOCAL_ONLY.has(sub)) {
        throw new ReadOnlyViolation(`"git ${sub}" is not allowed`);
    }
    const bad = rest.find((a) => FORBIDDEN_OPTION.test(a));
    if (bad) throw new ReadOnlyViolation(`option "${bad}" is not allowed on "git ${sub}"`);

    if (sub === 'config') {
        const isGet = rest.length === 2 && rest[0] === '--get';
        const isPushLock = rest.length === 3 && rest[0] === '--local'
            && rest[1] === 'remote.origin.pushurl' && rest[2] === NO_PUSH_URL;
        if (!isGet && !isPushLock) throw new ReadOnlyViolation('git config may only read values or disable push');
    }
    if (sub === 'checkout' && !rest.includes('--detach')) {
        throw new ReadOnlyViolation('git checkout must use --detach (no local branch writes)');
    }
    if (sub === 'fetch') {
        const badDest = rest.find((a) => a.includes(':') && !/^\+?refs\/[^:]+:refs\/ce\//.test(a));
        if (badDest) throw new ReadOnlyViolation(`fetch refspec "${badDest}" must write only under refs/ce/`);
    }
}

export function redactUrlCredentials(text) {
    return String(text || '').replace(/(https?:\/\/)[^@\s/]+@/g, '$1***@');
}

/**
 * @param {string[]} args  git arguments (subcommand first)
 * @param {{cwd?: string, timeout?: number}} [opts]
 * @returns {Promise<string>} stdout
 */
export async function runGit(args, opts = {}) {
    assertReadOnly(args);
    return new Promise((resolve, reject) => {
        execFile('git', ['-c', 'core.longpaths=true', ...args], {
            cwd: opts.cwd,
            timeout: opts.timeout || 600_000,
            maxBuffer: 256 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }, (err, stdout, stderr) => {
            if (err) {
                const lines = redactUrlCredentials(stderr || err.message).split('\n').map((s) => s.trim()).filter(Boolean);
                const msg = lines.find((l) => /fatal|error|denied|not found|allow list/i.test(l)) || lines.pop() || 'git failed';
                return reject(new Error(msg));
            }
            resolve(stdout);
        });
    });
}

export function disablePush(dir, git = runGit) {
    return git(['config', '--local', 'remote.origin.pushurl', NO_PUSH_URL], { cwd: dir });
}
