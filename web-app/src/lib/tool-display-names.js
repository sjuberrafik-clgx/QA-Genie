/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Tool Display Names — Maps raw tool names to human-friendly labels, categories,
 * and colors for rendering in the chat UI.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── Category Definitions with Colors ────────────────────────────────────────

export const TOOL_CATEGORIES = {
    browser: { label: 'Browser', color: 'blue' },
    interaction: { label: 'Interaction', color: 'indigo' },
    selector: { label: 'Selector', color: 'cyan' },
    state: { label: 'State', color: 'teal' },
    assertion: { label: 'Assertion', color: 'emerald' },
    wait: { label: 'Wait', color: 'amber' },
    advanced: { label: 'Advanced', color: 'purple' },
    jira: { label: 'Jira', color: 'green' },
    validation: { label: 'Validation', color: 'orange' },
    execution: { label: 'Execution', color: 'red' },
    excel: { label: 'Excel', color: 'emerald' },
    grounding: { label: 'Grounding', color: 'violet' },
    context: { label: 'Context', color: 'slate' },
    pipeline: { label: 'Pipeline', color: 'sky' },
    framework: { label: 'Framework', color: 'zinc' },
    kb: { label: 'Knowledge', color: 'fuchsia' },
    filesystem: { label: 'Filesystem', color: 'cyan' },
};

// ─── Display Name Registry ───────────────────────────────────────────────────

const TOOL_DISPLAY_MAP = {
    // ── MCP Browser Tools (unified-automation) ──
    'mcp_unified-autom_unified_navigate': { label: 'Navigate to Page', category: 'browser' },
    'mcp_unified-autom_unified_navigate_back': { label: 'Navigate Back', category: 'browser' },
    'mcp_unified-autom_unified_navigate_forward': { label: 'Navigate Forward', category: 'browser' },
    'mcp_unified-autom_unified_reload': { label: 'Reload Page', category: 'browser' },
    'mcp_unified-autom_unified_get_page_url': { label: 'Get Page URL', category: 'browser' },
    'mcp_unified-autom_unified_get_page_title': { label: 'Get Page Title', category: 'browser' },
    'mcp_unified-autom_unified_browser_close': { label: 'Close Browser', category: 'browser' },
    'mcp_unified-autom_unified_tabs': { label: 'List Browser Tabs', category: 'browser' },
    'mcp_unified-autom_unified_resize': { label: 'Resize Viewport', category: 'browser' },
    'mcp_unified-autom_unified_pdf_save': { label: 'Save as PDF', category: 'browser' },
    'mcp_unified-autom_unified_list_all_pages': { label: 'List All Pages', category: 'browser' },

    // ── MCP Snapshot / Selector Tools ──
    'mcp_unified-autom_unified_snapshot': { label: 'Capture Page Snapshot', category: 'selector' },
    'mcp_unified-autom_unified_get_by_role': { label: 'Find by ARIA Role', category: 'selector' },
    'mcp_unified-autom_unified_get_by_text': { label: 'Find by Text', category: 'selector' },
    'mcp_unified-autom_unified_get_by_label': { label: 'Find by Label', category: 'selector' },
    'mcp_unified-autom_unified_get_by_test_id': { label: 'Find by Test ID', category: 'selector' },
    'mcp_unified-autom_unified_get_by_placeholder': { label: 'Find by Placeholder', category: 'selector' },
    'mcp_unified-autom_unified_get_by_alt_text': { label: 'Find by Alt Text', category: 'selector' },
    'mcp_unified-autom_unified_get_by_title': { label: 'Find by Title', category: 'selector' },
    'mcp_unified-autom_unified_generate_locator': { label: 'Generate Locator', category: 'selector' },
    'mcp_unified-autom_unified_shadow_dom_query': { label: 'Shadow DOM Query', category: 'selector' },
    'mcp_unified-autom_unified_shadow_pierce': { label: 'Shadow DOM Pierce', category: 'selector' },

    // ── MCP Interaction Tools ──
    'mcp_unified-autom_unified_click': { label: 'Click Element', category: 'interaction' },
    'mcp_unified-autom_unified_type': { label: 'Type Text', category: 'interaction' },
    'mcp_unified-autom_unified_fill_form': { label: 'Fill Form', category: 'interaction' },
    'mcp_unified-autom_unified_select_option': { label: 'Select Option', category: 'interaction' },
    'mcp_unified-autom_unified_check': { label: 'Check Checkbox', category: 'interaction' },
    'mcp_unified-autom_unified_uncheck': { label: 'Uncheck Checkbox', category: 'interaction' },
    'mcp_unified-autom_unified_hover': { label: 'Hover Element', category: 'interaction' },
    'mcp_unified-autom_unified_press_key': { label: 'Press Key', category: 'interaction' },
    'mcp_unified-autom_unified_press_sequentially': { label: 'Type Sequentially', category: 'interaction' },
    'mcp_unified-autom_unified_drag': { label: 'Drag Element', category: 'interaction' },
    'mcp_unified-autom_unified_focus': { label: 'Focus Element', category: 'interaction' },
    'mcp_unified-autom_unified_blur': { label: 'Blur Element', category: 'interaction' },
    'mcp_unified-autom_unified_select_text': { label: 'Select Text', category: 'interaction' },
    'mcp_unified-autom_unified_clear_input': { label: 'Clear Input', category: 'interaction' },
    'mcp_unified-autom_unified_file_upload': { label: 'Upload File', category: 'interaction' },
    'mcp_unified-autom_unified_handle_dialog': { label: 'Handle Dialog', category: 'interaction' },
    'mcp_unified-autom_unified_scroll_into_view': { label: 'Scroll Into View', category: 'interaction' },
    'mcp_unified-autom_unified_keyboard_type': { label: 'Keyboard Input', category: 'interaction' },
    'mcp_unified-autom_unified_keyboard_down': { label: 'Key Down', category: 'interaction' },
    'mcp_unified-autom_unified_keyboard_up': { label: 'Key Up', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_click_xy': { label: 'Mouse Click XY', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_dblclick_xy': { label: 'Double Click XY', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_move_xy': { label: 'Mouse Move XY', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_drag_xy': { label: 'Mouse Drag XY', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_down': { label: 'Mouse Down', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_up': { label: 'Mouse Up', category: 'interaction' },
    'mcp_unified-autom_unified_mouse_wheel': { label: 'Mouse Wheel', category: 'interaction' },
    'mcp_unified-autom_unified_bring_to_front': { label: 'Bring to Front', category: 'interaction' },
    'mcp_unified-autom_unified_trigger_download': { label: 'Trigger Download', category: 'interaction' },

    // ── MCP State / Read Tools ──
    'mcp_unified-autom_unified_is_visible': { label: 'Check Visibility', category: 'state' },
    'mcp_unified-autom_unified_is_enabled': { label: 'Check Enabled', category: 'state' },
    'mcp_unified-autom_unified_is_checked': { label: 'Check Checked', category: 'state' },
    'mcp_unified-autom_unified_is_disabled': { label: 'Check Disabled', category: 'state' },
    'mcp_unified-autom_unified_is_editable': { label: 'Check Editable', category: 'state' },
    'mcp_unified-autom_unified_is_hidden': { label: 'Check Hidden', category: 'state' },
    'mcp_unified-autom_unified_is_focused': { label: 'Check Focused', category: 'state' },
    'mcp_unified-autom_unified_is_page_closed': { label: 'Check Page Closed', category: 'state' },
    'mcp_unified-autom_unified_get_text_content': { label: 'Get Text Content', category: 'state' },
    'mcp_unified-autom_unified_get_inner_text': { label: 'Get Inner Text', category: 'state' },
    'mcp_unified-autom_unified_get_inner_html': { label: 'Get Inner HTML', category: 'state' },
    'mcp_unified-autom_unified_get_outer_html': { label: 'Get Outer HTML', category: 'state' },
    'mcp_unified-autom_unified_get_attribute': { label: 'Get Attribute', category: 'state' },
    'mcp_unified-autom_unified_get_input_value': { label: 'Get Input Value', category: 'state' },
    'mcp_unified-autom_unified_get_bounding_box': { label: 'Get Bounding Box', category: 'state' },
    'mcp_unified-autom_unified_get_viewport_size': { label: 'Get Viewport Size', category: 'state' },

    // ── MCP Assertion Tools ──
    'mcp_unified-autom_unified_expect_url': { label: 'Assert URL', category: 'assertion' },
    'mcp_unified-autom_unified_expect_title': { label: 'Assert Title', category: 'assertion' },
    'mcp_unified-autom_unified_expect_element_text': { label: 'Assert Element Text', category: 'assertion' },
    'mcp_unified-autom_unified_expect_element_attribute': { label: 'Assert Attribute', category: 'assertion' },
    'mcp_unified-autom_unified_expect_element_class': { label: 'Assert CSS Class', category: 'assertion' },
    'mcp_unified-autom_unified_expect_element_css': { label: 'Assert CSS Style', category: 'assertion' },
    'mcp_unified-autom_unified_expect_element_value': { label: 'Assert Element Value', category: 'assertion' },
    'mcp_unified-autom_unified_expect_attached': { label: 'Assert Attached', category: 'assertion' },
    'mcp_unified-autom_unified_expect_checked': { label: 'Assert Checked', category: 'assertion' },
    'mcp_unified-autom_unified_expect_disabled': { label: 'Assert Disabled', category: 'assertion' },
    'mcp_unified-autom_unified_expect_enabled': { label: 'Assert Enabled', category: 'assertion' },
    'mcp_unified-autom_unified_expect_focused': { label: 'Assert Focused', category: 'assertion' },
    'mcp_unified-autom_unified_verify_element_visible': { label: 'Verify Visible', category: 'assertion' },
    'mcp_unified-autom_unified_verify_text_visible': { label: 'Verify Text Visible', category: 'assertion' },
    'mcp_unified-autom_unified_verify_value': { label: 'Verify Value', category: 'assertion' },

    // ── MCP Wait Tools ──
    'mcp_unified-autom_unified_wait_for': { label: 'Wait for Condition', category: 'wait' },
    'mcp_unified-autom_unified_wait_for_element': { label: 'Wait for Element', category: 'wait' },
    'mcp_unified-autom_unified_wait_for_response': { label: 'Wait for Response', category: 'wait' },
    'mcp_unified-autom_unified_wait_for_request': { label: 'Wait for Request', category: 'wait' },
    'mcp_unified-autom_unified_wait_for_new_page': { label: 'Wait for New Page', category: 'wait' },
    'mcp_unified-autom_unified_wait_for_download': { label: 'Wait for Download', category: 'wait' },

    // ── MCP Screenshot / Visual Tools ──
    'mcp_unified-autom_unified_screenshot': { label: 'Take Screenshot', category: 'browser' },
    'mcp_unified-autom_unified_screenshot_baseline': { label: 'Save Screenshot Baseline', category: 'browser' },
    'mcp_unified-autom_unified_screenshot_compare': { label: 'Compare Screenshots', category: 'browser' },
    'mcp_unified-autom_unified_start_video': { label: 'Start Video Recording', category: 'browser' },
    'mcp_unified-autom_unified_stop_video': { label: 'Stop Video Recording', category: 'browser' },

    // ── MCP Advanced / CDP Tools ──
    'mcp_unified-autom_unified_evaluate': { label: 'Evaluate JS', category: 'advanced' },
    'mcp_unified-autom_unified_evaluate_cdp': { label: 'Evaluate Script (CDP)', category: 'advanced' },
    'mcp_unified-autom_unified_run_playwright_code': { label: 'Run Playwright Code', category: 'advanced' },
    'mcp_unified-autom_unified_console_messages': { label: 'Console Messages', category: 'advanced' },
    'mcp_unified-autom_unified_console_messages_cdp': { label: 'Console Messages (CDP)', category: 'advanced' },
    'mcp_unified-autom_unified_network_requests': { label: 'Network Requests', category: 'advanced' },
    'mcp_unified-autom_unified_network_requests_cdp': { label: 'Network Requests (CDP)', category: 'advanced' },
    'mcp_unified-autom_unified_page_errors': { label: 'Page Errors', category: 'advanced' },
    'mcp_unified-autom_unified_take_snapshot_cdp': { label: 'DOM Snapshot (CDP)', category: 'advanced' },
    'mcp_unified-autom_unified_performance_analyze': { label: 'Analyze Performance', category: 'advanced' },
    'mcp_unified-autom_unified_performance_start_trace': { label: 'Start Trace', category: 'advanced' },
    'mcp_unified-autom_unified_performance_stop_trace': { label: 'Stop Trace', category: 'advanced' },
    'mcp_unified-autom_unified_accessibility_audit': { label: 'Accessibility Audit', category: 'advanced' },

    // ── MCP Context / Storage Tools ──
    'mcp_unified-autom_unified_get_local_storage': { label: 'Get Local Storage', category: 'advanced' },
    'mcp_unified-autom_unified_set_local_storage': { label: 'Set Local Storage', category: 'advanced' },
    'mcp_unified-autom_unified_remove_local_storage': { label: 'Remove Local Storage', category: 'advanced' },
    'mcp_unified-autom_unified_get_session_storage': { label: 'Get Session Storage', category: 'advanced' },
    'mcp_unified-autom_unified_set_session_storage': { label: 'Set Session Storage', category: 'advanced' },
    'mcp_unified-autom_unified_remove_session_storage': { label: 'Remove Session Storage', category: 'advanced' },
    'mcp_unified-autom_unified_get_cookies': { label: 'Get Cookies', category: 'advanced' },
    'mcp_unified-autom_unified_add_cookies': { label: 'Add Cookies', category: 'advanced' },
    'mcp_unified-autom_unified_clear_cookies': { label: 'Clear Cookies', category: 'advanced' },
    'mcp_unified-autom_unified_query_indexeddb': { label: 'Query IndexedDB', category: 'advanced' },

    // ── MCP Frame / Context Tools ──
    'mcp_unified-autom_unified_frame_action': { label: 'Frame Action', category: 'browser' },
    'mcp_unified-autom_unified_switch_to_frame': { label: 'Switch to Frame', category: 'browser' },
    'mcp_unified-autom_unified_switch_to_main_frame': { label: 'Switch to Main Frame', category: 'browser' },
    'mcp_unified-autom_unified_list_frames': { label: 'List Frames', category: 'browser' },
    'mcp_unified-autom_unified_create_context': { label: 'Create Context', category: 'browser' },
    'mcp_unified-autom_unified_close_context': { label: 'Close Context', category: 'browser' },
    'mcp_unified-autom_unified_switch_context': { label: 'Switch Context', category: 'browser' },
    'mcp_unified-autom_unified_list_contexts': { label: 'List Contexts', category: 'browser' },

    // ── MCP Route / Network Interception Tools ──
    'mcp_unified-autom_unified_route_intercept': { label: 'Intercept Route', category: 'advanced' },
    'mcp_unified-autom_unified_route_list': { label: 'List Routes', category: 'advanced' },
    'mcp_unified-autom_unified_route_remove': { label: 'Remove Route', category: 'advanced' },
    'mcp_unified-autom_unified_get_network_request': { label: 'Get Network Request', category: 'advanced' },

    // ── MCP Emulation / Browser Config Tools ──
    'mcp_unified-autom_unified_emulate': { label: 'Emulate Device', category: 'browser' },
    'mcp_unified-autom_unified_set_geolocation': { label: 'Set Geolocation', category: 'browser' },
    'mcp_unified-autom_unified_set_locale': { label: 'Set Locale', category: 'browser' },
    'mcp_unified-autom_unified_set_timezone': { label: 'Set Timezone', category: 'browser' },
    'mcp_unified-autom_unified_grant_permissions': { label: 'Grant Permissions', category: 'browser' },
    'mcp_unified-autom_unified_clear_permissions': { label: 'Clear Permissions', category: 'browser' },
    'mcp_unified-autom_unified_browser_install': { label: 'Install Browser', category: 'browser' },

    // ── MCP Auth / Download Tools ──
    'mcp_unified-autom_unified_save_auth_state': { label: 'Save Auth State', category: 'browser' },
    'mcp_unified-autom_unified_load_auth_state': { label: 'Load Auth State', category: 'browser' },
    'mcp_unified-autom_unified_save_download': { label: 'Save Download', category: 'browser' },
    'mcp_unified-autom_unified_list_downloads': { label: 'List Downloads', category: 'browser' },

    // ── MCP Mutation / Observer Tools ──
    'mcp_unified-autom_unified_observe_mutations': { label: 'Observe DOM Mutations', category: 'advanced' },
    'mcp_unified-autom_unified_get_mutations': { label: 'Get DOM Mutations', category: 'advanced' },
    'mcp_unified-autom_unified_stop_mutation_observer': { label: 'Stop Mutation Observer', category: 'advanced' },

    // ── Atlassian MCP Tools ──
    'mcp_atlassian_atl_searchJiraIssuesUsingJql': { label: 'Search Jira (JQL)', category: 'jira' },
    'mcp_atlassian_atl_getJiraIssue': { label: 'Get Jira Issue', category: 'jira' },
    'mcp_atlassian_atl_createJiraIssue': { label: 'Create Jira Issue', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'mcp_atlassian_atl_editJiraIssue': { label: 'Edit Jira Issue', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'mcp_atlassian_atl_addCommentToJiraIssue': { label: 'Add Jira Comment', category: 'jira', effect: 'write', impactLevel: 'medium', requiresConfirmation: false },
    'mcp_atlassian_atl_getVisibleJiraProjects': { label: 'List Jira Projects', category: 'jira' },
    'mcp_atlassian_atl_getTransitionsForJiraIssue': { label: 'Get Jira Transitions', category: 'jira' },
    'mcp_atlassian_atl_transitionJiraIssue': { label: 'Transition Jira Issue', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'mcp_atlassian_atl_lookupJiraAccountId': { label: 'Lookup Jira Account', category: 'jira' },
    'mcp_atlassian_atl_search': { label: 'Search Atlassian', category: 'jira' },
    'mcp_atlassian_atl_fetch': { label: 'Fetch Atlassian API', category: 'jira' },
    'mcp_atlassian_atl_atlassianUserInfo': { label: 'Atlassian User Info', category: 'jira' },
    'mcp_atlassian_atl_getConfluencePage': { label: 'Get Confluence Page', category: 'kb' },
    'mcp_atlassian_atl_searchConfluenceUsingCql': { label: 'Search Confluence', category: 'kb' },
    'mcp_atlassian_atl_createConfluencePage': { label: 'Create Confluence Page', category: 'kb', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'mcp_atlassian_atl_updateConfluencePage': { label: 'Update Confluence Page', category: 'kb', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'mcp_atlassian_atl_getConfluenceSpaces': { label: 'List Confluence Spaces', category: 'kb' },

    // ── Custom SDK Tools ──
    'get_framework_inventory': { label: 'Scan Framework Inventory', category: 'framework' },
    'validate_generated_script': { label: 'Validate Script', category: 'validation' },
    'get_historical_failures': { label: 'Get Historical Failures', category: 'framework' },
    'get_exploration_data': { label: 'Get Exploration Data', category: 'framework' },
    'analyze_test_failure': { label: 'Analyze Test Failure', category: 'validation' },
    'get_assertion_config': { label: 'Get Assertion Config', category: 'framework' },
    'suggest_popup_handler': { label: 'Suggest Popup Handler', category: 'framework' },
    'run_quality_gate': { label: 'Run Quality Gate', category: 'validation' },
    'save_exploration_data': { label: 'Save Exploration Data', category: 'framework' },
    'get_test_results': { label: 'Get Test Results', category: 'execution' },
    'fetch_jira_ticket': { label: 'Fetch Jira Ticket', category: 'jira' },
    'get_jira_current_user': { label: 'Get Jira User', category: 'jira' },
    'search_jira_issues': { label: 'Search Jira Issues', category: 'jira' },
    'search_jira_epics': { label: 'Search Jira Epics', category: 'jira' },
    'get_jira_epic': { label: 'Get Jira Epic', category: 'jira' },
    'get_jira_epic_issues': { label: 'Get Jira Epic Issues', category: 'jira' },
    'list_jira_issues_without_epic': { label: 'List Jira Issues Without Epic', category: 'jira' },
    'search_jira_users': { label: 'Search Assignable Jira Users', category: 'jira' },
    'assign_jira_ticket': { label: 'Assign Jira Ticket', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'get_jira_ticket_capabilities': { label: 'Inspect Jira Capabilities', category: 'jira' },
    'create_jira_ticket': { label: 'Create Jira Ticket', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'remove_jira_issue_link': { label: 'Remove Jira Issue Link', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'attach_session_evidence_to_jira': { label: 'Attach Evidence to Jira', category: 'jira' },
    'attach_session_images_to_jira': { label: 'Attach Images to Jira', category: 'jira' },
    'attach_video_frames_to_jira': { label: 'Attach Video Evidence to Jira', category: 'jira' },
    'delete_jira_ticket': { label: 'Delete Jira Ticket', category: 'jira', effect: 'delete', impactLevel: 'destructive', requiresConfirmation: true },
    'transition_jira_ticket': { label: 'Transition Jira Ticket', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'log_jira_work': { label: 'Log Jira Work (Time Tracking)', category: 'jira', effect: 'write', impactLevel: 'medium', requiresConfirmation: false },
    'update_jira_estimates': { label: 'Update Jira Estimates (Original/Remaining)', category: 'jira', effect: 'write', impactLevel: 'medium', requiresConfirmation: false },
    'update_jira_ticket': { label: 'Update Jira Ticket', category: 'jira', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'generate_test_case_excel': { label: 'Generate Test Case Excel', category: 'excel' },
    'find_test_files': { label: 'Find Test Files', category: 'framework' },
    'execute_test': { label: 'Execute Test Suite', category: 'execution' },
    'write_shared_context': { label: 'Write Shared Context', category: 'context' },
    'read_shared_context': { label: 'Read Shared Context', category: 'context' },
    'register_artifact': { label: 'Register Artifact', category: 'context' },
    'answer_question': { label: 'Answer Question', category: 'context' },
    'search_project_context': { label: 'Search Project Context', category: 'grounding' },
    'get_feature_map': { label: 'Get Feature Map', category: 'grounding' },
    'get_selector_recommendations': { label: 'Get Selector Recommendations', category: 'grounding' },
    'check_existing_coverage': { label: 'Check Existing Coverage', category: 'grounding' },
    'get_snapshot_quality': { label: 'Get Snapshot Quality', category: 'validation' },
    'search_knowledge_base': { label: 'Search Knowledge Base', category: 'kb' },
    'get_knowledge_base_page': { label: 'Get KB Page', category: 'kb' },
    'search_confluence_content': { label: 'Search Confluence Content', category: 'kb' },
    'get_confluence_page_details': { label: 'Get Confluence Page Details', category: 'kb' },
    'list_confluence_spaces': { label: 'List Confluence Spaces', category: 'kb' },
    'list_confluence_pages_in_space': { label: 'List Confluence Pages', category: 'kb' },
    'get_confluence_page_tree': { label: 'Get Confluence Page Tree', category: 'kb' },
    'create_confluence_page': { label: 'Create Confluence Page', category: 'kb', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'update_confluence_page': { label: 'Update Confluence Page', category: 'kb', effect: 'write', impactLevel: 'high', requiresConfirmation: true },
    'delete_confluence_page': { label: 'Delete Confluence Page', category: 'kb', effect: 'delete', impactLevel: 'destructive', requiresConfirmation: true },
    'refresh_grounding_context': { label: 'Refresh Grounding Context', category: 'grounding' },
    'write_agent_note': { label: 'Write Agent Note', category: 'context' },
    'get_agent_notes': { label: 'Get Agent Notes', category: 'context' },
    'get_context_budget': { label: 'Get Context Budget', category: 'context' },
    'list_session_documents': { label: 'List Session Documents', category: 'context' },
    'parse_session_document': { label: 'Parse Session Document', category: 'context' },

    // ── Filesystem Tools (FileGenie) ──
    'set_workspace_root': { label: 'Set Workspace Root', category: 'filesystem' },
    'list_directory': { label: 'List Directory', category: 'filesystem' },
    'read_file_content': { label: 'Read File', category: 'filesystem' },
    'get_file_info': { label: 'Get File Info', category: 'filesystem' },
    'get_directory_stats': { label: 'Directory Statistics', category: 'filesystem' },
    'search_files': { label: 'Search Files', category: 'filesystem' },
    'parse_document': { label: 'Parse Document', category: 'filesystem' },
    'get_document_summary': { label: 'Summarize Document', category: 'filesystem' },
    'write_file_content': { label: 'Write File', category: 'filesystem' },
    'create_directory': { label: 'Create Directory', category: 'filesystem' },
    'move_items': { label: 'Move Items', category: 'filesystem' },
    'copy_items': { label: 'Copy Items', category: 'filesystem' },
    'rename_item': { label: 'Rename Item', category: 'filesystem' },
    'delete_items': { label: 'Delete Items', category: 'filesystem' },
};

// ─── Helper: get display info for a tool ─────────────────────────────────────

/**
 * Get the display label, category, and color for a raw tool name.
 * Falls back to a cleaned-up version of the raw name if not in the registry.
 *
 * @param {string} rawName - The raw tool name (e.g., 'mcp_unified-autom_unified_navigate')
 * @returns {{ label: string, category: string, categoryLabel: string, color: string, effect: string, impactLevel: string, requiresConfirmation: boolean }}
 */
export function getToolDisplay(rawName) {
    const entry = TOOL_DISPLAY_MAP[rawName];

    if (entry) {
        const cat = TOOL_CATEGORIES[entry.category] || TOOL_CATEGORIES.context;
        return {
            label: entry.label,
            category: entry.category,
            categoryLabel: cat.label,
            color: cat.color,
            effect: entry.effect || 'read',
            impactLevel: entry.impactLevel || 'low',
            requiresConfirmation: entry.requiresConfirmation === true,
        };
    }

    // Fallback: clean up the raw name to something presentable
    let cleaned = rawName;

    // Strip common prefixes
    cleaned = cleaned
        .replace(/^mcp_unified-autom_unified_/, '')
        .replace(/^mcp_atlassian_atl_/, '')
        .replace(/^mcp_microsoft_pla_browser_/, '');

    // Convert snake_case to Title Case
    cleaned = cleaned
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Guess category from prefix
    let category = 'context';
    if (rawName.startsWith('mcp_unified-autom_unified_')) category = 'browser';
    else if (rawName.startsWith('mcp_atlassian_')) category = 'jira';
    else if (rawName.startsWith('mcp_microsoft_pla_')) category = 'browser';

    const cat = TOOL_CATEGORIES[category] || TOOL_CATEGORIES.context;
    return {
        label: cleaned,
        category,
        categoryLabel: cat.label,
        color: cat.color,
        effect: 'read',
        impactLevel: 'low',
        requiresConfirmation: false,
    };
}

// ─── Category Color Classes (for Tailwind) ───────────────────────────────────

/**
 * Get Tailwind CSS classes for a category color.
 * Returns bg, text, and border classes for badges/tags.
 *
 * @param {string} color - The color name from TOOL_CATEGORIES
 * @returns {{ bg: string, text: string, border: string }}
 */
export function getCategoryColorClasses(color) {
    const colorMap = {
        blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
        indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
        cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
        teal: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200' },
        emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
        amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
        purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
        green: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
        orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
        red: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
        violet: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200' },
        slate: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
        rose: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200' },
        sky: { bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-200' },
        zinc: { bg: 'bg-zinc-100', text: 'text-zinc-600', border: 'border-zinc-200' },
        fuchsia: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-600', border: 'border-fuchsia-200' },
    };
    return colorMap[color] || colorMap.slate;
}
