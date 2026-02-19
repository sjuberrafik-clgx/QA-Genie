/**
 * Unified Automation MCP Server - Main Index
 * 
 * Export all public APIs for programmatic usage.
 * NOTE: Bridge exports are aligned with the direct bridges used by server.js.
 */

// Server
export { UnifiedAutomationServer } from './server.js';

// Tools
export {
    UNIFIED_TOOLS,
    TOOL_MAPPING,
    getToolSource,
    getToolCategory,
    getSourceToolName
} from './tools/tool-definitions.js';

// Router
export {
    IntelligentRouter,
    ToolRecommendationEngine
} from './router/intelligent-router.js';

// Bridges — Direct implementations (canonical, used by server.js)
export {
    PlaywrightDirectBridge,
    PlaywrightBridge
} from './bridges/playwright-bridge-direct.js';
export {
    ChromeDevToolsDirectBridge,
    ChromeDevToolsBridge
} from './bridges/chromedevtools-bridge-direct.js';

// Configuration
export {
    ServerConfig,
    CONFIG_PRESETS
} from './config/server-config.js';

// Utilities
export {
    ScriptGenerator,
    LocatorGenerator
} from './utils/script-generator.js';
