/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * SERVER CONFIGURATION
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Configuration management for the Unified Automation MCP Server
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
    // Server settings
    server: {
        name: 'unified-automation-mcp',
        version: '1.0.0',
        logLevel: 'info', // 'debug', 'info', 'warn', 'error'
    },

    // Playwright MCP settings
    playwright: {
        // headless: undefined — resolved at runtime from env var MCP_HEADLESS
        // Leaving undefined so the bridge constructor's ?? operator can read
        // process.env.MCP_HEADLESS. Previously hardcoded `false` short-circuited
        // the nullish coalescing and silently ignored the env var.
        browser: 'chromium', // 'chromium', 'firefox', 'webkit'
        viewport: {
            width: 1280,
            height: 720,
        },
        timeout: 60000,
        toolCallTimeout: 120000, // Per-tool-call timeout (ms) — prevents indefinite hangs
        waitForNetworkIdle: true,
        capabilities: ['vision', 'pdf', 'testing'],
    },

    // ChromeDevTools MCP settings
    chromeDevTools: {
        port: 9222,
        timeout: 30000,
    },

    // Routing preferences
    routing: {
        // Prefer Playwright for these categories
        preferPlaywright: [
            'navigation',
            'interaction',
            'snapshot',
            'form',
            'tab',
            'dialog',
            'testing',
        ],
        // Prefer ChromeDevTools for these categories
        preferChromeDevTools: [
            'performance',
            'network',
            'emulation',
        ],
        // Enable fallback routing
        enableFallback: true,
    },
};

/**
 * Server Configuration Class
 */
export class ServerConfig {
    constructor(userConfig = {}) {
        this.config = this.mergeConfig(DEFAULT_CONFIG, userConfig);
        this.validateConfig();
    }

    /**
     * Deep merge configuration objects
     */
    mergeConfig(defaults, overrides) {
        const result = { ...defaults };

        for (const key of Object.keys(overrides)) {
            if (
                overrides[key] &&
                typeof overrides[key] === 'object' &&
                !Array.isArray(overrides[key])
            ) {
                result[key] = this.mergeConfig(defaults[key] || {}, overrides[key]);
            } else {
                result[key] = overrides[key];
            }
        }

        return result;
    }

    /**
     * Validate configuration
     */
    validateConfig() {
        // Validate browser type
        const validBrowsers = ['chromium', 'firefox', 'webkit'];
        if (!validBrowsers.includes(this.config.playwright.browser)) {
            console.warn(`[Config] Invalid browser: ${this.config.playwright.browser}. Using chromium.`);
            this.config.playwright.browser = 'chromium';
        }

        // Validate timeout
        if (this.config.playwright.timeout < 1000) {
            console.warn('[Config] Timeout too low. Setting to 1000ms minimum.');
            this.config.playwright.timeout = 1000;
        }

        // Validate viewport
        if (this.config.playwright.viewport.width < 320) {
            this.config.playwright.viewport.width = 320;
        }
        if (this.config.playwright.viewport.height < 240) {
            this.config.playwright.viewport.height = 240;
        }
    }

    /**
     * Get server configuration
     */
    get server() {
        return this.config.server;
    }

    /**
     * Get Playwright configuration
     */
    get playwright() {
        return this.config.playwright;
    }

    /**
     * Get ChromeDevTools configuration
     */
    get chromeDevTools() {
        return this.config.chromeDevTools;
    }

    /**
     * Get routing configuration
     */
    get routing() {
        return this.config.routing;
    }

    /**
     * Update configuration at runtime
     */
    update(path, value) {
        const parts = path.split('.');
        let current = this.config;

        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        current[parts[parts.length - 1]] = value;
        this.validateConfig();
    }

    /**
     * Export configuration as JSON
     */
    toJSON() {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * Load configuration from environment variables
     */
    static fromEnvironment() {
        const config = {};

        // Server settings
        if (process.env.MCP_LOG_LEVEL) {
            config.server = { logLevel: process.env.MCP_LOG_LEVEL };
        }

        // Playwright settings
        if (process.env.MCP_HEADLESS !== undefined) {
            config.playwright = config.playwright || {};
            config.playwright.headless = process.env.MCP_HEADLESS === 'true';
        }

        if (process.env.MCP_BROWSER) {
            config.playwright = config.playwright || {};
            config.playwright.browser = process.env.MCP_BROWSER;
        }

        if (process.env.MCP_VIEWPORT_WIDTH && process.env.MCP_VIEWPORT_HEIGHT) {
            config.playwright = config.playwright || {};
            config.playwright.viewport = {
                width: parseInt(process.env.MCP_VIEWPORT_WIDTH, 10),
                height: parseInt(process.env.MCP_VIEWPORT_HEIGHT, 10),
            };
        }

        if (process.env.MCP_TIMEOUT) {
            config.playwright = config.playwright || {};
            config.playwright.timeout = parseInt(process.env.MCP_TIMEOUT, 10);
        }

        // ChromeDevTools settings
        if (process.env.MCP_CDP_PORT) {
            config.chromeDevTools = { port: parseInt(process.env.MCP_CDP_PORT, 10) };
        }

        return new ServerConfig(config);
    }
}

/**
 * Configuration presets for common use cases
 */
export const CONFIG_PRESETS = {
    // Default balanced configuration
    default: DEFAULT_CONFIG,

    // Optimized for test script generation
    testing: {
        playwright: {
            headless: true,
            capabilities: ['testing'],
            timeout: 60000,
        },
        routing: {
            preferPlaywright: ['navigation', 'interaction', 'snapshot', 'testing'],
            enableFallback: true,
        },
    },

    // Optimized for performance analysis
    performance: {
        playwright: {
            headless: true,
        },
        chromeDevTools: {
            timeout: 120000,
        },
        routing: {
            preferChromeDevTools: ['performance', 'network'],
            enableFallback: true,
        },
    },

    // Optimized for debugging (headed mode)
    debug: {
        playwright: {
            headless: false,
            timeout: 120000,
        },
        server: {
            logLevel: 'debug',
        },
    },

    // Optimized for CI/CD environments
    ci: {
        playwright: {
            headless: true,
            timeout: 60000,
            viewport: {
                width: 1920,
                height: 1080,
            },
        },
        routing: {
            enableFallback: true,
        },
    },
};
