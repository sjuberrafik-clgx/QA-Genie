'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · DRIVER/CDP · LAUNCH — start Chromium and hand back its CDP endpoint
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Spawns a Chromium/Chrome process with remote debugging enabled and parses the
 * `DevTools listening on ws://…` line from stderr. We do NOT bundle a browser: we
 * REUSE the Chromium binary Playwright already installed (via executablePath, WITHOUT
 * using Playwright to drive it), or a system Chrome/Edge, or GLASS_CHROMIUM_PATH.
 * That keeps the "drop the Playwright dependency" goal reachable while avoiding a
 * second ~150 MB browser download.
 *
 * Chromium 111+ rejects CDP WebSocket upgrades from non-matching origins, so we pass
 * `--remote-allow-origins=*` — required for a raw client to attach.
 *
 * @module glass-mcp/driver/cdp/launch
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Locate a Chromium-family executable. Order: explicit env → Playwright's binary
 * (reused, not driven) → system Chrome/Edge/Chromium.
 * @returns {string|null}
 */
function findChromium() {
    const envPath = process.env.GLASS_CHROMIUM_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;

    for (const mod of ['playwright', 'playwright-core', '@playwright/test']) {
        try {
            const pw = require(mod);
            const exe = pw.chromium && pw.chromium.executablePath && pw.chromium.executablePath();
            if (exe && fs.existsSync(exe)) return exe;
        } catch { /* try next module */ }
    }

    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const candidates = process.platform === 'win32'
        ? [
            path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(pfx86, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(pfx86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        ]
        : process.platform === 'darwin'
            ? [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ]
            : [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/microsoft-edge',
            ];
    for (const c of candidates) if (c && fs.existsSync(c)) return c;
    return null;
}

const DEFAULT_ARGS = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
];

/** Sanitize a "W,H" window-size string, falling back to a safe default. */
function parseWindowSize(value, fallback) {
    const m = typeof value === 'string' && value.match(/^\s*(\d{3,5})\s*[,x]\s*(\d{3,5})\s*$/);
    return m ? `${m[1]},${m[2]}` : fallback;
}

/**
 * Launch Chromium and resolve to a handle exposing its browser-level CDP WS URL.
 * @param {{executablePath?:string, headless?:boolean, port?:number, userDataDir?:string,
 *          viewport?:{width:number,height:number}, args?:string[], timeout?:number}} [opts]
 * @returns {Promise<{browserWsUrl:string, process:import('child_process').ChildProcess,
 *          userDataDir:string, executablePath:string, close:()=>void}>}
 */
async function launchChromium(opts = {}) {
    const exe = opts.executablePath || findChromium();
    if (!exe) {
        const e = new Error('No Chromium/Chrome executable found. Set GLASS_CHROMIUM_PATH or install Playwright chromium (`npx playwright install chromium`).');
        e.code = 'GLASS_NO_CHROMIUM';
        throw e;
    }

    const ownsUserDataDir = !opts.userDataDir;
    const userDataDir = opts.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cdp-'));
    const headless = opts.headless !== false;

    const args = [
        `--remote-debugging-port=${opts.port || 0}`, // 0 = OS-assigned free port
        `--user-data-dir=${userDataDir}`,
        '--remote-allow-origins=*', // Chromium 111+ CDP origin allowlist
        ...DEFAULT_ARGS,
    ];
    if (headless) args.push('--headless=new', '--disable-gpu');
    // Window sizing: default to a maximized / full-size window in BOTH modes so tests
    // render at full resolution. An explicit viewport wins; headed uses the real monitor
    // via --start-maximized; headless has no window manager, so approximate "maximized"
    // with a full-HD window (overridable via GLASS_WINDOW_SIZE, e.g. "2560,1440").
    if (opts.viewport) {
        args.push(`--window-size=${opts.viewport.width},${opts.viewport.height}`);
    } else if (headless) {
        args.push(`--window-size=${parseWindowSize(process.env.GLASS_WINDOW_SIZE, '1920,1080')}`);
    } else {
        args.push('--start-maximized');
    }
    if (process.platform === 'linux') args.push('--no-sandbox');
    for (const a of opts.args || []) args.push(a);

    const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false });

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        if (ownsUserDataDir) {
            // Best-effort; the profile dir may still be locked for a moment on Windows.
            try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
        }
    };

    try {
        const browserWsUrl = await waitForWsEndpoint(proc, opts.timeout || 30000);
        return { browserWsUrl, process: proc, userDataDir, executablePath: exe, close };
    } catch (e) {
        close();
        throw e;
    }
}

/** Resolve the browser CDP WS URL by watching stderr for the DevTools banner. */
function waitForWsEndpoint(proc, timeout) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out (${timeout}ms) waiting for Chromium DevTools endpoint.`));
        }, timeout);
        const onData = (chunk) => {
            buf += chunk.toString();
            const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (m) { cleanup(); resolve(m[1].trim()); }
        };
        const onExit = (code) => {
            cleanup();
            reject(new Error(`Chromium exited (code ${code}) before announcing a DevTools endpoint.\n${buf.slice(-600)}`));
        };
        function cleanup() {
            clearTimeout(timer);
            if (proc.stderr) proc.stderr.removeListener('data', onData);
            proc.removeListener('exit', onExit);
        }
        if (proc.stderr) proc.stderr.on('data', onData);
        proc.once('exit', onExit);
    });
}

module.exports = { launchChromium, findChromium };
