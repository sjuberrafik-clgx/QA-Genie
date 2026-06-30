const { spawn } = require('child_process');

process.env.NEXT_DIST_DIR = process.env.NEXT_DIST_DIR || '.next-dev';

require('./clean-next-dev-cache');

const nextBin = require.resolve('next/dist/bin/next');
const port = process.env.PORT || '3001';

const child = spawn(process.execPath, [nextBin, 'dev', '--port', port], {
    stdio: 'inherit',
    env: process.env,
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.exit(0);
        return;
    }
    process.exit(code || 0);
});