# Unified Automation MCP Server

A custom Model Context Protocol (MCP) server that combines the power of **Playwright MCP** and **ChromeDevTools MCP** into a single, intelligent automation interface.

## 🚀 Features

### Combined Tool Power

| Feature | Playwright MCP | ChromeDevTools MCP | Unified Server |
|---------|---------------|-------------------|----------------|
| Navigation | ✅ | ✅ | ✅ (Uses Playwright) |
| Accessibility Snapshots | ✅ | ✅ | ✅ (Uses Playwright) |
| Element Interactions | ✅ | ✅ | ✅ (Uses Playwright) |
| Performance Tracing | ❌ | ✅ | ✅ (Uses CDP) |
| Network Monitoring | ✅ | ✅ | ✅ (Chooses best) |
| Device Emulation | ✅ | ✅ | ✅ (Uses CDP) |
| Test Assertions | ✅ | ❌ | ✅ (Uses Playwright) |
| Script Generation | ❌ | ❌ | ✅ (Built-in) |

### Intelligent Routing

The server automatically routes tool calls to the most appropriate underlying MCP:

- **Playwright MCP**: Navigation, interactions, snapshots, form filling, test assertions
- **ChromeDevTools MCP**: Performance tracing, detailed network analysis, emulation

### Unified Tool Names

All tools use a consistent `unified_*` naming convention, making it easy to use without remembering which MCP provides which tool.

## 📦 Installation

```bash
cd mcp-server
npm install
```

## 🔧 Configuration

### VS Code MCP Settings

Add to your VS Code settings (`.vscode/mcp.json` or user settings):

```json
{
  "mcpServers": {
    "unified-automation": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/server.js"],
      "env": {
        "MCP_HEADLESS": "true",
        "MCP_BROWSER": "chromium"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_HEADLESS` | Run browser in headless mode | `true` |
| `MCP_BROWSER` | Browser type (chromium/firefox/webkit) | `chromium` |
| `MCP_VIEWPORT_WIDTH` | Viewport width | `1280` |
| `MCP_VIEWPORT_HEIGHT` | Viewport height | `720` |
| `MCP_TIMEOUT` | Default timeout (ms) | `30000` |
| `MCP_LOG_LEVEL` | Log level (debug/info/warn/error) | `info` |

## 🛠️ Available Tools

### Navigation Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_navigate` | Navigate to URL | Playwright |
| `unified_navigate_back` | Go back in history | Playwright |

### Snapshot Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_snapshot` | Accessibility tree snapshot (preferred) | Playwright |
| `unified_screenshot` | Visual screenshot | Playwright |
| `unified_take_snapshot_cdp` | DOM snapshot | ChromeDevTools |

### Interaction Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_click` | Click element | Playwright |
| `unified_type` | Type text | Playwright |
| `unified_hover` | Hover over element | Playwright |
| `unified_drag` | Drag and drop | Playwright |
| `unified_select_option` | Select dropdown option | Playwright |
| `unified_press_key` | Press keyboard key | Playwright |
| `unified_fill_form` | Fill multiple form fields | Playwright |
| `unified_file_upload` | Upload files | Playwright |

### Wait Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_wait_for` | Wait for text/time | Playwright |

### Network Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_network_requests` | List network requests | Playwright |
| `unified_network_requests_cdp` | Detailed network (with timing) | ChromeDevTools |
| `unified_get_network_request` | Get specific request details | ChromeDevTools |

### Performance Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_performance_start_trace` | Start performance trace | ChromeDevTools |
| `unified_performance_stop_trace` | Stop trace and get metrics | ChromeDevTools |
| `unified_performance_analyze` | Analyze performance insights | ChromeDevTools |

### Debugging Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_evaluate` | Evaluate JavaScript | Playwright |
| `unified_evaluate_cdp` | Evaluate via CDP | ChromeDevTools |
| `unified_run_playwright_code` | Run Playwright code snippet | Playwright |
| `unified_console_messages` | Get console messages | Playwright |
| `unified_console_messages_cdp` | Console with timestamps | ChromeDevTools |

### Emulation Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_emulate` | Emulate device | ChromeDevTools |
| `unified_resize` | Resize viewport | Playwright |

### Test Assertion Tools

| Tool | Description | Source |
|------|-------------|--------|
| `unified_generate_locator` | Generate test locator | Playwright |
| `unified_verify_element_visible` | Verify element visibility | Playwright |
| `unified_verify_text_visible` | Verify text visibility | Playwright |
| `unified_verify_value` | Verify element value | Playwright |

### Browser Control

| Tool | Description | Source |
|------|-------------|--------|
| `unified_tabs` | Manage browser tabs | Playwright |
| `unified_handle_dialog` | Handle dialogs | Playwright |
| `unified_browser_close` | Close browser | Playwright |
| `unified_browser_install` | Install browser | Playwright |

## 📝 Usage Examples

### Basic Navigation and Interaction

```
User: Navigate to https://example.com and click the login button

Agent uses:
1. unified_navigate (url: "https://example.com")
2. unified_snapshot () - get element refs
3. unified_click (ref: "button-login", element: "Login button")
```

### Form Filling

```
User: Fill in the registration form

Agent uses:
1. unified_snapshot () - get form field refs
2. unified_fill_form (fields: [
     { ref: "input-name", value: "John Doe" },
     { ref: "input-email", value: "john@example.com" }
   ])
```

### Performance Analysis

```
User: Analyze page load performance

Agent uses:
1. unified_performance_start_trace (reload: true)
2. unified_performance_stop_trace ()
3. unified_performance_analyze (insightName: "LCP")
```

### Network Monitoring

```
User: Show me all API calls made by the page

Agent uses:
1. unified_network_requests_cdp (filter: "/api/")
2. unified_get_network_request (reqid: "req-123") - for details
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Unified MCP Server                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Client    │───▶│ Intelligent     │───▶│   Tools     │ │
│  │  (VS Code)  │    │    Router       │    │ Definitions │ │
│  └─────────────┘    └────────┬────────┘    └─────────────┘ │
│                              │                              │
│         ┌────────────────────┼────────────────────┐        │
│         ▼                    ▼                    ▼        │
│  ┌─────────────┐      ┌─────────────┐      ┌───────────┐  │
│  │ Playwright  │      │   Script    │      │   Chrome  │  │
│  │   Bridge    │      │  Generator  │      │ DevTools  │  │
│  └──────┬──────┘      └─────────────┘      │  Bridge   │  │
│         │                                   └─────┬─────┘  │
└─────────┼─────────────────────────────────────────┼────────┘
          │                                         │
          ▼                                         ▼
   ┌─────────────┐                           ┌─────────────┐
   │ Playwright  │                           │ ChromeDevT. │
   │    MCP      │                           │    MCP      │
   └─────────────┘                           └─────────────┘
```

## 🔄 Tool Selection Logic

The intelligent router uses the following logic:

1. **Category-based routing**: Tools are categorized and routed to the best-suited MCP
2. **Fallback support**: If primary MCP fails, automatically tries the alternate
3. **Context awareness**: Considers current state (e.g., active performance trace)
4. **Consistency**: Hybrid tools prefer the last-used bridge for consistency

### Routing Rules

| Category | Primary MCP | Fallback |
|----------|-------------|----------|
| Navigation | Playwright | ChromeDevTools |
| Interaction | Playwright | - |
| Snapshot | Playwright | ChromeDevTools |
| Network | ChromeDevTools | Playwright |
| Performance | ChromeDevTools | - |
| Testing | Playwright | - |
| Debugging | Context-based | Both |

## 🧪 Testing

```bash
cd mcp-server
npm test
```

## 📄 Protocol Compliance

This server implements MCP specification version **2025-11-25**, supporting:

- JSON-RPC 2.0 message format
- Standard lifecycle (initialize → operation → shutdown)
- Tools capability with listChanged notifications
- Proper error handling and response codes

## 🤝 Contributing

1. Add new tools to `tools/tool-definitions.js`
2. Update routing logic in `router/intelligent-router.js`
3. Add tests to `test-server.js`
4. Update this documentation

## 📜 License

ISC
