/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * INTELLIGENT ROUTER
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 
 * Routes tool calls to the appropriate MCP bridge (Playwright or ChromeDevTools)
 * based on:
 * - Tool name and source mapping
 * - Current context and browser state
 * - Tool capabilities and requirements
 * - Performance considerations
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import { getToolSource, getSourceToolName, getToolCategory, ALL_TOOLS } from '../tools/tool-definitions.js';

/**
 * Intelligent Router for MCP tool calls
 */
export class IntelligentRouter {
    constructor(playwrightBridge, chromeDevToolsBridge) {
        this.playwrightBridge = playwrightBridge;
        this.chromeDevToolsBridge = chromeDevToolsBridge;

        // Link ChromeDevTools bridge to Playwright bridge for shared page access
        if (this.chromeDevToolsBridge.setPlaywrightBridge) {
            this.chromeDevToolsBridge.setPlaywrightBridge(this.playwrightBridge);
        }

        // Track current state for intelligent routing decisions
        this.state = {
            lastToolUsed: null,
            lastBridgeUsed: null,
            browserConnected: false,
            performanceTraceActive: false,
            currentPageUrl: null,
        };

        // Routing statistics for optimization
        this.stats = {
            playwrightCalls: 0,
            chromeDevToolsCalls: 0,
            fallbacksUsed: 0,
            errors: 0,
        };
    }

    /**
     * Route a tool call to the appropriate bridge
     * @param {string} toolName - Unified tool name
     * @param {object} args - Tool arguments
     * @returns {Promise<any>} - Tool result
     */
    async route(toolName, args) {
        console.error(`[Router] Routing tool: ${toolName}`);

        const source = getToolSource(toolName);
        const sourceToolName = getSourceToolName(toolName);
        const category = getToolCategory(toolName);

        console.error(`[Router] Source: ${source}, Original tool: ${sourceToolName}, Category: ${category}`);

        try {
            let result;

            // Intelligent routing based on tool source and current state
            if (source === 'playwright') {
                result = await this.routeToPlaywright(sourceToolName, args, category);
                this.stats.playwrightCalls++;
            } else if (source === 'chromedevtools') {
                result = await this.routeToChromeDevTools(sourceToolName, args, category);
                this.stats.chromeDevToolsCalls++;
            } else if (source === 'hybrid') {
                result = await this.routeHybrid(toolName, sourceToolName, args, category);
            } else {
                throw new Error(`Unknown tool source: ${source}`);
            }

            // Update state after successful call
            this.state.lastToolUsed = toolName;
            this.state.lastBridgeUsed = source;

            // Track URL for context
            if (toolName === 'unified_navigate' && result) {
                this.state.currentPageUrl = args.url;
            }

            return result;
        } catch (error) {
            this.stats.errors++;
            console.error(`[Router] Error routing ${toolName}: ${error.message}`);

            // Try fallback routing if primary fails
            return await this.handleRoutingError(toolName, sourceToolName, args, category, error);
        }
    }

    /**
     * Route to Playwright MCP bridge
     */
    async routeToPlaywright(toolName, args, category) {
        console.error(`[Router] Executing via Playwright: ${toolName}`);

        // Ensure Playwright bridge is connected
        if (!this.playwrightBridge.isConnected()) {
            await this.playwrightBridge.connect();
            this.state.browserConnected = true;
        }

        return await this.playwrightBridge.callTool(toolName, args);
    }

    /**
     * Route to ChromeDevTools MCP bridge
     */
    async routeToChromeDevTools(toolName, args, category) {
        console.error(`[Router] Executing via ChromeDevTools: ${toolName}`);

        // Ensure ChromeDevTools bridge is connected
        if (!this.chromeDevToolsBridge.isConnected()) {
            await this.chromeDevToolsBridge.connect();
        }

        // Track performance trace state
        if (toolName === 'performance_start_trace') {
            this.state.performanceTraceActive = true;
        } else if (toolName === 'performance_stop_trace') {
            this.state.performanceTraceActive = false;
        }

        return await this.chromeDevToolsBridge.callTool(toolName, args);
    }

    /**
     * Route hybrid tools that can use either MCP
     */
    async routeHybrid(unifiedToolName, sourceToolName, args, category) {
        console.error(`[Router] Routing hybrid tool: ${unifiedToolName}`);

        // Intelligence-based decision for hybrid tools
        const decision = this.decideHybridRouting(unifiedToolName, category);

        if (decision === 'playwright') {
            return await this.routeToPlaywright(sourceToolName, args, category);
        } else {
            return await this.routeToChromeDevTools(sourceToolName, args, category);
        }
    }

    /**
     * Decide which bridge to use for hybrid tools
     */
    decideHybridRouting(toolName, category) {
        // Network tools: ChromeDevTools provides better detail
        if (category === 'network') {
            return 'chromedevtools';
        }

        // Performance tools: Always ChromeDevTools
        if (category === 'performance') {
            return 'chromedevtools';
        }

        // Console messages: ChromeDevTools for timestamps
        if (toolName.includes('console') && this.state.performanceTraceActive) {
            return 'chromedevtools';
        }

        // Evaluation: Use the last used bridge for consistency
        if (category === 'debugging' && this.state.lastBridgeUsed) {
            return this.state.lastBridgeUsed;
        }

        // Default to Playwright for most operations
        return 'playwright';
    }

    /**
     * Handle routing errors with fallback logic
     */
    async handleRoutingError(toolName, sourceToolName, args, category, error) {
        console.error(`[Router] Attempting fallback for ${toolName}`);
        this.stats.fallbacksUsed++;

        const source = getToolSource(toolName);

        // Try the alternate bridge
        try {
            if (source === 'playwright') {
                // Try equivalent ChromeDevTools tool
                const fallbackTool = this.findFallbackTool(toolName, 'chromedevtools');
                if (fallbackTool) {
                    console.error(`[Router] Using fallback: ${fallbackTool}`);
                    return await this.routeToChromeDevTools(fallbackTool, args, category);
                }
            } else if (source === 'chromedevtools') {
                // Try equivalent Playwright tool
                const fallbackTool = this.findFallbackTool(toolName, 'playwright');
                if (fallbackTool) {
                    console.error(`[Router] Using fallback: ${fallbackTool}`);
                    return await this.routeToPlaywright(fallbackTool, args, category);
                }
            }
        } catch (fallbackError) {
            console.error(`[Router] Fallback also failed: ${fallbackError.message}`);
        }

        // If no fallback available, throw original error
        throw error;
    }

    /**
     * Find a fallback tool in the alternate MCP
     */
    findFallbackTool(toolName, targetSource) {
        const fallbackMap = {
            // Playwright -> ChromeDevTools fallbacks
            'browser_evaluate': 'evaluate_script',
            'browser_console_messages': 'list_console_messages',
            'browser_network_requests': 'list_network_requests',
            'browser_snapshot': 'take_snapshot',

            // ChromeDevTools -> Playwright fallbacks
            'evaluate_script': 'browser_evaluate',
            'list_console_messages': 'browser_console_messages',
            'list_network_requests': 'browser_network_requests',
            'take_snapshot': 'browser_snapshot',
        };

        return fallbackMap[toolName] || null;
    }

    /**
     * Get routing statistics
     */
    getStats() {
        return {
            ...this.stats,
            totalCalls: this.stats.playwrightCalls + this.stats.chromeDevToolsCalls,
            playwrightPercentage: this.stats.playwrightCalls /
                (this.stats.playwrightCalls + this.stats.chromeDevToolsCalls) * 100 || 0,
            chromeDevToolsPercentage: this.stats.chromeDevToolsCalls /
                (this.stats.playwrightCalls + this.stats.chromeDevToolsCalls) * 100 || 0,
        };
    }

    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Reset router state
     */
    reset() {
        this.state = {
            lastToolUsed: null,
            lastBridgeUsed: null,
            browserConnected: false,
            performanceTraceActive: false,
            currentPageUrl: null,
        };
        console.error('[Router] State reset');
    }
}

/**
 * Tool recommendation engine for script generation
 */
export class ToolRecommendationEngine {
    /**
     * Get recommended tools for a specific automation task
     * @param {string} task - Task description
     * @returns {Array} - Recommended tools with reasoning
     */
    static getRecommendations(task) {
        const taskLower = task.toLowerCase();
        const recommendations = [];

        // Navigation tasks
        if (taskLower.includes('navigate') || taskLower.includes('go to') || taskLower.includes('open')) {
            recommendations.push({
                tool: 'unified_navigate',
                reason: 'Primary navigation tool with proper page load handling',
                priority: 1,
            });
        }

        // Interaction tasks
        if (taskLower.includes('click')) {
            recommendations.push({
                tool: 'unified_snapshot',
                reason: 'Required to get element refs before clicking',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_click',
                reason: 'Click element using ref from snapshot',
                priority: 2,
            });
        }

        if (taskLower.includes('type') || taskLower.includes('enter') || taskLower.includes('input')) {
            recommendations.push({
                tool: 'unified_snapshot',
                reason: 'Required to get element refs before typing',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_type',
                reason: 'Type text into input element',
                priority: 2,
            });
        }

        // Form tasks
        if (taskLower.includes('form') || taskLower.includes('fill')) {
            recommendations.push({
                tool: 'unified_fill_form',
                reason: 'Efficient multi-field form filling',
                priority: 1,
            });
        }

        // Performance tasks
        if (taskLower.includes('performance') || taskLower.includes('trace') || taskLower.includes('metrics')) {
            recommendations.push({
                tool: 'unified_performance_start_trace',
                reason: 'Start performance trace using ChromeDevTools',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_performance_stop_trace',
                reason: 'Stop trace and get metrics',
                priority: 2,
            });
        }

        // Network monitoring
        if (taskLower.includes('network') || taskLower.includes('api') || taskLower.includes('request')) {
            recommendations.push({
                tool: 'unified_network_requests_cdp',
                reason: 'ChromeDevTools provides detailed network timing',
                priority: 1,
            });
        }

        // Network interception / mocking
        if (taskLower.includes('intercept') || taskLower.includes('mock') || taskLower.includes('block') || taskLower.includes('route')) {
            recommendations.push({
                tool: 'unified_route_intercept',
                reason: 'Intercept, mock, abort, or log network requests',
                priority: 1,
            });
        }

        // Iframe tasks
        if (taskLower.includes('iframe') || taskLower.includes('frame')) {
            recommendations.push({
                tool: 'unified_list_frames',
                reason: 'List available iframes on the page',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_switch_to_frame',
                reason: 'Switch to a specific iframe for interaction',
                priority: 2,
            });
        }

        // Shadow DOM tasks
        if (taskLower.includes('shadow') || taskLower.includes('web component')) {
            recommendations.push({
                tool: 'unified_shadow_pierce',
                reason: 'Pierce shadow DOM to interact with shadow elements',
                priority: 1,
            });
        }

        // Storage tasks
        if (taskLower.includes('storage') || taskLower.includes('localstorage') || taskLower.includes('sessionstorage') || taskLower.includes('indexeddb')) {
            recommendations.push({
                tool: 'unified_get_local_storage',
                reason: 'Read localStorage values',
                priority: 1,
            });
        }

        // Auth / login persistence
        if (taskLower.includes('auth') || taskLower.includes('login') || taskLower.includes('session')) {
            recommendations.push({
                tool: 'unified_save_auth_state',
                reason: 'Save authentication state for reuse across tests',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_load_auth_state',
                reason: 'Restore saved authentication state',
                priority: 2,
            });
        }

        // Accessibility tasks
        if (taskLower.includes('accessibility') || taskLower.includes('a11y') || taskLower.includes('aria') || taskLower.includes('wcag')) {
            recommendations.push({
                tool: 'unified_accessibility_audit',
                reason: 'Run accessibility audit with WCAG checks',
                priority: 1,
            });
        }

        // Geolocation tasks
        if (taskLower.includes('geolocation') || taskLower.includes('location') || taskLower.includes('gps')) {
            recommendations.push({
                tool: 'unified_set_geolocation',
                reason: 'Set browser geolocation coordinates',
                priority: 1,
            });
        }

        // Visual testing / comparison
        if (taskLower.includes('visual') || taskLower.includes('compare') || taskLower.includes('baseline') || taskLower.includes('regression')) {
            recommendations.push({
                tool: 'unified_screenshot_baseline',
                reason: 'Capture baseline screenshot for comparison',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_screenshot_compare',
                reason: 'Compare screenshots for visual regressions',
                priority: 2,
            });
        }

        // Video recording
        if (taskLower.includes('video') || taskLower.includes('record')) {
            recommendations.push({
                tool: 'unified_start_video',
                reason: 'Start video recording of browser session',
                priority: 1,
            });
        }

        // Download tasks
        if (taskLower.includes('download')) {
            recommendations.push({
                tool: 'unified_trigger_download',
                reason: 'Trigger and capture file downloads',
                priority: 1,
            });
        }

        // Multi-context / incognito
        if (taskLower.includes('incognito') || taskLower.includes('context') || taskLower.includes('isolated')) {
            recommendations.push({
                tool: 'unified_create_context',
                reason: 'Create isolated browser context (incognito-like)',
                priority: 1,
            });
        }

        // Screenshot/snapshot tasks
        if (taskLower.includes('screenshot')) {
            recommendations.push({
                tool: 'unified_screenshot',
                reason: 'Capture page screenshot',
                priority: 1,
            });
        }

        if (taskLower.includes('snapshot') || taskLower.includes('state') || taskLower.includes('elements')) {
            recommendations.push({
                tool: 'unified_snapshot',
                reason: 'Accessibility snapshot is preferred for automation',
                priority: 1,
            });
        }

        // Wait tasks
        if (taskLower.includes('wait')) {
            recommendations.push({
                tool: 'unified_wait_for',
                reason: 'Wait for text, element, or time',
                priority: 1,
            });
        }

        // Verification/assertion tasks
        if (taskLower.includes('verify') || taskLower.includes('assert') || taskLower.includes('check')) {
            recommendations.push({
                tool: 'unified_verify_text_visible',
                reason: 'Verify text is visible on page',
                priority: 1,
            });
            recommendations.push({
                tool: 'unified_verify_element_visible',
                reason: 'Verify element is visible by role',
                priority: 2,
            });
        }

        // Sort by priority
        return recommendations.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Get the best tool for a specific action
     */
    static getBestToolForAction(action) {
        const actionMap = {
            navigate: 'unified_navigate',
            click: 'unified_click',
            type: 'unified_type',
            hover: 'unified_hover',
            select: 'unified_select_option',
            drag: 'unified_drag',
            wait: 'unified_wait_for',
            screenshot: 'unified_screenshot',
            snapshot: 'unified_snapshot',
            evaluate: 'unified_evaluate',
            network: 'unified_network_requests_cdp',
            performance: 'unified_performance_start_trace',
            console: 'unified_console_messages_cdp',
            verify: 'unified_verify_text_visible',
            form: 'unified_fill_form',
            upload: 'unified_file_upload',
            dialog: 'unified_handle_dialog',
            tabs: 'unified_tabs',
            close: 'unified_browser_close',
            // Advanced tools
            iframe: 'unified_list_frames',
            shadow: 'unified_shadow_pierce',
            intercept: 'unified_route_intercept',
            storage: 'unified_get_local_storage',
            auth: 'unified_save_auth_state',
            accessibility: 'unified_accessibility_audit',
            geolocation: 'unified_set_geolocation',
            visual: 'unified_screenshot_baseline',
            video: 'unified_start_video',
            download: 'unified_trigger_download',
            context: 'unified_create_context',
            mutation: 'unified_observe_mutations',
            permission: 'unified_grant_permissions',
        };

        return actionMap[action.toLowerCase()] || null;
    }
}
