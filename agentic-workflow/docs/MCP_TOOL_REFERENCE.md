# MCP Tool Reference Guide

## Overview

This document provides a comprehensive reference for all MCP (Model Context Protocol) tools available in the automation framework. The system uses two MCP servers with distinct capabilities.

---

## MCP Servers

### Unified Automation MCP (`unified_*`)
**Single unified server combining Playwright MCP and Chrome DevTools MCP capabilities.**

| Category | Tool Name | Description |
|----------|-----------|-------------|
| **Navigation** | `unified_navigate` | Navigate to a URL |
| | `unified_navigate_back` | Go back in history |
| | `unified_tabs` | List/create/close/select tabs |
| **Snapshots** | `unified_snapshot` | Get accessibility tree with refs (PREFERRED) |
| **Interactions** | `unified_click` | Click element by ref/description |
| | `unified_type` | Type text into element |
| | `unified_hover` | Hover over element |
| | `unified_drag` | Drag from one element to another |
| | `unified_select_option` | Select option from dropdown |
| **Forms** | `unified_fill_form` | Fill multiple form fields |
| **Wait** | `unified_wait_for` | Wait for text/condition/time |
| **Advanced** | `unified_evaluate` | Evaluate JavaScript |
| | `unified_run_code` | Run Playwright code snippet |
| **Debug** | `unified_console_messages` | Get console messages |
| | `unified_network_requests` | Get network requests |
| **Setup** | `unified_install` | Install browser binaries |

### Chrome DevTools Features (Integrated)
**Advanced features routed automatically via intelligent routing.**

| Category | Tool Name | Description |
|----------|-----------|-------------|
| **JavaScript** | `unified_evaluate_script` | Execute JS in page context |
| **Forms** | `unified_fill` | Fill single input |
| | `unified_fill_form` | Fill multiple form elements |
| **Network** | `unified_list_network_requests` | List all network requests |
| | `unified_get_network_request` | Get specific request details |
| **Performance** | `unified_performance_start_trace` | Start perf trace |
| | `unified_performance_stop_trace` | Stop trace, get CWV scores |
| | `unified_performance_analyze_insight` | Analyze perf insight |
| **Page Control** | `unified_resize_page` | Resize browser window |
| | `unified_emulate` | Emulate network/device |
| **Files/Dialogs** | `unified_upload_file` | Upload file via input |
| | `unified_handle_dialog` | Accept/dismiss dialogs |
| **Wait** | `unified_wait_for` | Wait for text to appear |

---

## Tool Selection Guide

### The Intelligent Router
The unified MCP server automatically routes calls to the appropriate backend:
- **Playwright MCP**: Navigation, snapshots, clicks, typing, forms, tabs
- **Chrome DevTools MCP**: Performance traces, network analysis, complex JS evaluation

### General Automation:
- ✅ Navigating to URLs → `unified_navigate`
- ✅ Taking accessibility snapshots → `unified_snapshot`
- ✅ Clicking, typing, or hovering → `unified_click`, `unified_type`, `unified_hover`
- ✅ Filling forms → `unified_fill_form`
- ✅ Managing browser tabs → `unified_tabs`
- ✅ Basic wait operations → `unified_wait_for`

### Performance & Network Analysis:
- ✅ Executing complex JavaScript → `unified_evaluate_cdp`
- ✅ Measuring performance (Core Web Vitals) → `unified_performance_*`
- ✅ Analyzing network requests → `unified_network_*`
- ✅ Handling browser dialogs → `unified_handle_dialog`
- ✅ Uploading files → `unified_upload_file`

---

## Common Workflows

### Basic Page Exploration
```
1. unified_navigate (url)
2. unified_wait_for (time: 2)
3. unified_snapshot ()
4. unified_click (element, ref from snapshot)
```

### Performance Testing
```
1. unified_performance_start_trace (reload: true)
2. [page loads and interactions]
3. unified_performance_stop_trace ()
4. Review CWV scores (LCP, CLS, INP)
```

### Form Submission
```
1. unified_snapshot ()
2. unified_fill_form (fields array with refs)
3. unified_click (submit button ref)
```

### Handle Dialog
```
1. unified_handle_dialog (action: "accept" or "dismiss")
```

---

## Important Notes

### Snapshot vs Screenshot
- **`browser_snapshot`** (Playwright): Returns accessibility tree with `ref=` attributes for element interaction. **PREFERRED** for automation.
- Screenshots are visual only and cannot be used for interaction.

### Element References
- Snapshots return elements with `ref=` attributes (e.g., `ref=s1e5`)
- Use these refs in click/type/hover operations
- Refs are session-specific and expire after page changes

### Error Handling
- Always check for popup/modal blocking before interactions
- Use `browser_wait_for` to ensure page stability
- Retry failed interactions with fresh snapshots

---

## Configuration Files

| File | Purpose |
|------|---------|
| `mcp-unified-tools.js` | Single source of truth for tool names |
| `mcp-orchestrator.js` | Workflow orchestration and prompts |
| `mcp-workflow-bridge.js` | Bridge between MCP and workflow system |
| `mcp-exploration-runner.js` | Real-time exploration engine |

---

## Starting MCP Server

```bash
# Start Unified Automation MCP server
node mcp-server/server.js
```

---

*Document generated: 2025*
*Framework Version: 3.0 (Unified MCP)*
