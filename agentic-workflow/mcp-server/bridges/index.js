/**
 * Bridges Index
 * Export all bridge implementations
 * 
 * The direct bridges are the canonical implementations used by server.js.
 */

// Primary exports: Direct bridges (used by server.js)
export { PlaywrightDirectBridge, PlaywrightDirectBridge as PlaywrightBridge } from './playwright-bridge-direct.js';
export { ChromeDevToolsDirectBridge, ChromeDevToolsDirectBridge as ChromeDevToolsBridge } from './chromedevtools-bridge-direct.js';
