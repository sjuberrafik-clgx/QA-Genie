// Smoke test: verify terminal-runner can spawn .cmd launchers on Windows without EINVAL.
const { runCommand } = require('../sdk-orchestrator/terminal-runner');

(async () => {
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    try {
        const r = await runCommand({
            command: cmd,
            args: ['--version'],
            timeoutMs: 20000,
            onStdout: (c) => process.stdout.write('[OUT] ' + c),
            onStderr: (c) => process.stderr.write('[ERR] ' + c),
        });
        console.log('EXIT', r.exitCode, 'OK');
        process.exit(0);
    } catch (e) {
        console.log('FAIL', e.code, e.message);
        process.exit(1);
    }
})();
