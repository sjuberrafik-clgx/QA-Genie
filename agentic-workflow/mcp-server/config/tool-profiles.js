/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TOOL PROFILES — Dynamic Tool Scoping
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * With 141 tools, sending every schema in every request consumes ~30-40K tokens of
 * context window. Most sessions use only 25-35 tools. This module defines category-based
 * profiles that filter which tools are exposed per session, dramatically reducing token
 * usage while preserving full functionality.
 *
 * KEY DESIGN DECISION:
 *   Filtering is at tools/list level only — the tools/call handler still routes ANY
 *   valid tool name regardless of whether it was listed. This means even if a tool is
 *   "hidden" from a profile, the agent can still call it if instructed via prompt.
 *   This is a safety net: filtering optimizes context, not capabilities.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Tool profiles map profile names to arrays of allowed _meta.category values.
 * 
 * Categories available across tool definition files:
 * 
 * Core (tool-definitions.js):
 *   navigation, snapshot, interaction, form, wait, tab, dialog,
 *   debugging, network, performance, emulation, testing, browser, pdf
 * 
 * Enhanced (enhanced-tool-definitions.js):
 *   page-info, element-content, element-state, form-control, scroll,
 *   keyboard, mouse, cookies, multi-page, download, selectors, assertions
 * 
 * Advanced (advanced-tool-definitions.js):
 *   iframe, shadow-dom, network-interception, storage, accessibility,
 *   video, auth, mutation, geolocation, locale, timezone, permissions
 */

export const TOOL_PROFILES = {
    /**
     * CORE — The essential exploration toolkit (~65 tools)
     * Used by ScriptGenerator for standard UI exploration & script generation.
     * Covers: navigate, snapshot, click, type, select, fill, get element info,
     * check visibility/state, wait, assert, find by role/text/label/testid, browser lifecycle.
     */
    core: [
        'navigation',       // navigate, navigate_back, navigate_forward, reload
        'snapshot',          // snapshot, screenshot, screenshot_baseline, screenshot_compare
        'interaction',       // click, type, hover, drag, check, uncheck, select_option, etc.
        'form',              // fill_form, file_upload
        'wait',              // wait_for, wait_for_element, wait_for_response, wait_for_download
        'page-info',         // get_page_url, get_page_title, get_viewport_size, is_page_closed
        'element-content',   // get_text_content, get_inner_text, get_inner_html, get_outer_html, get_attribute, get_input_value, get_bounding_box
        'element-state',     // is_visible, is_enabled, is_checked, is_disabled, is_editable, is_hidden
        'selectors',         // get_by_role, get_by_text, get_by_label, get_by_placeholder, get_by_test_id, get_by_alt_text, get_by_title, generate_locator
        'assertions',        // expect_url, expect_title, expect_element_text, expect_element_attribute, expect_element_value, expect_element_class, expect_element_css, expect_attached, expect_checked, expect_disabled, expect_enabled, expect_focused
        'form-control',      // clear_input, select_text, focus, blur, select_option, press_key
        'browser',           // browser_close, browser_install
        'dialog',            // handle_dialog
        'tab',               // tabs, bring_to_front, list_all_pages
        'testing',           // accessibility_audit, verify_element_visible, verify_text_visible, verify_value
    ],

    /**
     * ADVANCED — Extended toolkit for complex scenarios (~76 tools)
     * Adds: iframes, shadow DOM, network interception, storage, cookies,
     * keyboard/mouse precision, multi-page, downloads, performance, debugging.
     */
    advanced: [
        'iframe',             // frame_action, switch_to_frame, switch_to_main_frame, list_frames
        'shadow-dom',         // shadow_dom_query, shadow_pierce
        'network-interception', // route_intercept, route_list, route_remove, get_network_request, network_requests
        'storage',            // get_local_storage, set_local_storage, remove_local_storage, get_session_storage, set_session_storage, remove_session_storage, query_indexeddb
        'cookies',            // get_cookies, add_cookies, clear_cookies
        'keyboard',           // press_key, keyboard_type, keyboard_down, keyboard_up, press_sequentially
        'mouse',              // mouse_click_xy, mouse_dblclick_xy, mouse_move_xy, mouse_drag_xy, mouse_down, mouse_up, mouse_wheel
        'scroll',             // scroll_into_view
        'multi-page',         // wait_for_new_page, list_all_pages, tabs
        'download',           // list_downloads, save_download, trigger_download, wait_for_download
        'performance',        // performance_analyze, performance_start_trace, performance_stop_trace
        'debugging',          // console_messages, console_messages_cdp, evaluate, evaluate_cdp, page_errors
        'emulation',          // emulate, resize
        'network',            // network_requests, network_requests_cdp, get_network_request, wait_for_request, wait_for_response
        'pdf',                // pdf_save
        'video',              // start_video, stop_video
        'auth',               // save_auth_state, load_auth_state
        'mutation',           // observe_mutations, get_mutations, stop_mutation_observer
        'geolocation',        // set_geolocation
        'locale',             // set_locale
        'timezone',           // set_timezone
        'permissions',        // grant_permissions, clear_permissions
        'accessibility',      // accessibility_audit, take_snapshot_cdp
        'context',            // create_context, close_context, switch_context, list_contexts
    ],

    // ═══════════════════════════════════════════════════════════════════════
    // COGNITIVE QA LOOP — Phase-Specific Profiles
    // ═══════════════════════════════════════════════════════════════════════
    // Each micro-phase of the Cognitive ScriptGenerator gets ONLY the tools
    // it needs, radically reducing context window pressure (~4K–10K tokens
    // per phase vs ~30K for the full core profile).

    /**
     * EXPLORER-NAV — Navigation + discovery tools for the Explorer phase (~35 tools)
     * Covers: navigate, snapshot, find elements by semantic selectors, check states,
     * extract content for assertions, verify page URLs/titles.
     * Excludes: interaction tools (click/type/fill) — those use explorer-interact.
     */
    'explorer-nav': [
        'navigation',        // navigate, navigate_back, navigate_forward, reload
        'snapshot',          // snapshot, screenshot
        'selectors',         // get_by_role, get_by_text, get_by_label, get_by_test_id, etc.
        'element-state',     // is_visible, is_enabled, is_checked, is_hidden, is_disabled
        'element-content',   // get_text_content, get_inner_text, get_attribute, get_input_value
        'page-info',         // get_page_url, get_page_title, get_viewport_size
        'assertions',        // expect_url, expect_title, expect_element_text, etc.
        'wait',              // wait_for, wait_for_element
        'testing',           // verify_element_visible, verify_text_visible
    ],

    /**
     * EXPLORER-INTERACT — Interaction tools for the Explorer phase (~25 tools)
     * Used when the Explorer needs to click buttons, fill forms, or type text
     * to navigate through the application flow and reach deeper pages.
     */
    'explorer-interact': [
        'navigation',        // navigate, navigate_back, reload
        'snapshot',          // snapshot (re-snapshot after interaction)
        'interaction',       // click, type, hover, drag, select_option, check
        'form',              // fill_form, file_upload
        'form-control',      // clear_input, focus, blur, press_key
        'selectors',         // get_by_role, get_by_text (to find what to interact with)
        'element-state',     // is_visible, is_enabled (pre-check before interaction)
        'wait',              // wait_for, wait_for_element (wait after interaction)
        'dialog',            // handle_dialog (popups after interaction)
        'tab',               // tabs, list_all_pages (new tabs opened by clicks)
    ],

    /**
     * DRYRUN — Minimal selector verification tools (~15 tools)
     * Used by the Dry-Run Validator to re-verify that all selectors in the
     * generated script still resolve to real elements on the page.
     */
    dryrun: [
        'navigation',        // navigate to each page
        'selectors',         // get_by_role, get_by_test_id, etc. (verify selector resolves)
        'element-state',     // is_visible, is_enabled (confirm element is interactable)
        'page-info',         // get_page_url, get_page_title (verify navigation state)
        'snapshot',          // snapshot (if re-discovery needed)
    ],

    /**
     * FULL — All 141 tools. Used as fallback or for default (no agent) sessions.
     * This is equivalent to the current behavior (no filtering).
     */
    full: null, // null = no filtering, return ALL_TOOLS
};

/**
 * Map agent modes to their optimal tool profile.
 * 
 * ScriptGenerator uses 'core' by default (saves ~25K tokens).
 * Default (no agent) uses 'full' for maximum flexibility.
 */
export const AGENT_TOOL_PROFILES = {
    scriptgenerator: 'core',
    // These agents don't connect to unified-automation MCP at all,
    // but if they ever do, they'd only need core tools.
    testgenie: 'core',
    buggenie: 'core',
    codereviewer: 'core',

    // ── Cognitive QA Loop Phase Profiles ──
    // Each micro-phase of the cognitive loop gets a minimal tool set.
    // Analyst and Coder get NO MCP tools (pure reasoning / code generation).
    'cognitive-analyst': null,          // No MCP tools needed (pure reasoning)
    'cognitive-explorer-nav': 'explorer-nav',
    'cognitive-explorer-interact': 'explorer-interact',
    'cognitive-coder': null,            // No MCP tools needed (code generation)
    'cognitive-reviewer': null,         // No MCP tools needed (code review)
    'cognitive-dryrun': 'dryrun',

    // Default (null / unspecified) agent mode → full toolkit
    default: 'full',
};

/**
 * Get the combined set of allowed categories for a given profile name.
 * 
 * @param {string} profileName - 'core', 'advanced', or 'full'
 * @returns {string[]|null} Array of category names, or null for 'full' (no filter)
 */
export function getProfileCategories(profileName) {
    const profile = TOOL_PROFILES[profileName];

    if (profileName === 'full' || !profile) {
        return null; // No filtering
    }

    if (profileName === 'advanced') {
        // Advanced = core + advanced categories combined
        return [...(TOOL_PROFILES.core || []), ...profile];
    }

    return profile;
}

/**
 * Get the recommended tool profile for a given agent mode.
 * 
 * @param {string|null} agentMode - Agent mode identifier
 * @returns {string} Profile name ('core', 'advanced', or 'full')
 */
export function getProfileForAgent(agentMode) {
    return AGENT_TOOL_PROFILES[agentMode] || AGENT_TOOL_PROFILES.default;
}
