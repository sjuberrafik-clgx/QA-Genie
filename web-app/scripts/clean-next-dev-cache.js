const fs = require('fs');
const path = require('path');

const distDir = process.env.NEXT_DIST_DIR || '.next-dev';
const nextDir = path.join(__dirname, '..', distDir);

try {
    fs.rmSync(nextDir, { recursive: true, force: true });
    console.log(`[dev] Cleared ${distDir} so the dev server starts from clean React/RSC artifacts.`);
} catch (error) {
    console.warn(`[dev] Unable to clear ${distDir}: ${error.message}`);
}