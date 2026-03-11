/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * PROGRAMMATIC EXECUTOR — Anthropic Technique 1: Programmatic Tool Calling
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Allows an LLM agent to submit a short JavaScript function that calls multiple MCP
 * tools in a single round-trip. This eliminates the repeated LLM→MCP→LLM loop that
 * burns ~800 tokens per tool call, reducing a 6-call exploration from ~4,800 tokens
 * to ~1,200 (the script text + one result).
 *
 * Security model:
 *   - Scripts run in a Node `vm.Script` sandbox with an explicit allowlist of globals.
 *   - Only the `tools` proxy (MCP tool calls) and a minimal `console` are exposed.
 *   - `require`, `import`, `process`, `fs`, `net`, `child_process` are NOT available.
 *   - Hard 30-second timeout per execution (configurable via env).
 *   - Max script length: 5,000 characters.
 *   - Max 20 tool calls per script (prevents infinite loops).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

import vm from 'node:vm';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SCRIPT_LENGTH = 5000;
const MAX_TOOL_CALLS = 20;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.MCP_EXECUTE_TIMEOUT) || 30000;

// Tool name mapping: short names → unified names
// Agents write `tools.navigate(...)` instead of `tools.unified_navigate(...)`
const SHORT_TO_UNIFIED = {
    navigate: 'unified_navigate',
    navigate_back: 'unified_navigate_back',
    reload: 'unified_reload',
    snapshot: 'unified_snapshot',
    click: 'unified_click',
    type: 'unified_type',
    hover: 'unified_hover',
    fill_form: 'unified_fill_form',
    select_option: 'unified_select_option',
    press_key: 'unified_press_key',
    check: 'unified_check',
    uncheck: 'unified_uncheck',
    get_by_role: 'unified_get_by_role',
    get_by_text: 'unified_get_by_text',
    get_by_label: 'unified_get_by_label',
    get_by_test_id: 'unified_get_by_test_id',
    is_visible: 'unified_is_visible',
    is_enabled: 'unified_is_enabled',
    get_text_content: 'unified_get_text_content',
    get_attribute: 'unified_get_attribute',
    get_input_value: 'unified_get_input_value',
    get_page_url: 'unified_get_page_url',
    get_page_title: 'unified_get_page_title',
    wait_for: 'unified_wait_for',
    wait_for_element: 'unified_wait_for_element',
    wait_for_response: 'unified_wait_for_response',
    expect_url: 'unified_expect_url',
    expect_title: 'unified_expect_title',
    expect_element_text: 'unified_expect_element_text',
    screenshot: 'unified_screenshot',
    evaluate: 'unified_evaluate',
    browser_close: 'unified_browser_close',
    handle_dialog: 'unified_handle_dialog',
};

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * MCP tool definition for `unified_execute_exploration`.
 * Exposed in tools/list alongside other always-loaded tools.
 */
export const EXECUTE_EXPLORATION_DEFINITION = {
    name: 'unified_execute_exploration',
    description: [
        'Execute a batch exploration script that calls multiple MCP tools in a single round-trip.',
        'The script is an async function receiving a `tools` proxy object.',
        'Use short tool names (e.g., tools.navigate, tools.snapshot, tools.click).',
        'Returns the script\'s return value as the tool result.',
        'Max 20 tool calls per script, 30s timeout, 5000 char limit.',
    ].join(' '),
    inputSchema: {
        type: 'object',
        properties: {
            script: {
                type: 'string',
                description: [
                    'An async JavaScript function body as a string.',
                    'Receives `tools` parameter — call tools like:',
                    '  await tools.navigate({ url: "..." })',
                    '  await tools.snapshot({ filter: { interactiveOnly: true } })',
                    '  await tools.click({ element: "Submit" })',
                    'Return a value to send back as the tool result.',
                ].join('\n'),
            },
            templateName: {
                type: 'string',
                description: 'Optional: name of a pre-built exploration template to execute instead of a raw script.',
            },
            templateArgs: {
                type: 'object',
                description: 'Optional: arguments to pass to the exploration template.',
            },
        },
        required: [],
    },
    _meta: {
        source: 'custom',
        category: 'execution',
    },
};

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute a programmatic exploration script in a sandboxed context.
 *
 * @param {object} params
 * @param {string} params.script - Async function body as string
 * @param {string} [params.templateName] - Template name (alternative to raw script)
 * @param {object} [params.templateArgs] - Template arguments
 * @param {Function} routeToolCall - async (toolName, args) => result — provided by server.js
 * @param {object} [templates] - Map of templateName → template function
 * @returns {Promise<object>} Execution result with tool call log
 */
export async function executeExploration({ script, templateName, templateArgs }, routeToolCall, templates = {}) {
    // ── Resolve script source ────────────────────────────────────────────
    let scriptSource = script;

    if (templateName) {
        const template = templates[templateName];
        if (!template) {
            return {
                success: false,
                error: `Unknown template: ${templateName}. Available: ${Object.keys(templates).join(', ')}`,
            };
        }
        scriptSource = template.build(templateArgs || {});
    }

    if (!scriptSource || typeof scriptSource !== 'string') {
        return {
            success: false,
            error: 'Either "script" or "templateName" is required.',
        };
    }

    // ── Validation ───────────────────────────────────────────────────────
    if (scriptSource.length > MAX_SCRIPT_LENGTH) {
        return {
            success: false,
            error: `Script exceeds max length (${scriptSource.length} > ${MAX_SCRIPT_LENGTH}).`,
        };
    }

    // Block dangerous patterns — defence in depth (vm sandbox is primary)
    const BLOCKED_PATTERNS = [
        /\brequire\s*\(/,
        /\bimport\s+/,
        /\bprocess\b/,
        /\b(child_process|exec|spawn|fork)\b/,
        /\bglobalThis\b/,
        /\bFunction\s*\(/,
        /\beval\s*\(/,
    ];

    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(scriptSource)) {
            return {
                success: false,
                error: `Script contains blocked pattern: ${pattern.toString()}`,
            };
        }
    }

    // ── Build sandboxed tools proxy ──────────────────────────────────────
    const callLog = [];
    let callCount = 0;

    const toolsProxy = new Proxy({}, {
        get(_target, prop) {
            // Resolve short name → unified name
            const unifiedName = SHORT_TO_UNIFIED[prop] || `unified_${prop}`;

            return async (args = {}) => {
                callCount++;
                if (callCount > MAX_TOOL_CALLS) {
                    throw new Error(`Exceeded max tool calls (${MAX_TOOL_CALLS}). Simplify the script.`);
                }

                const startTime = Date.now();
                try {
                    const result = await routeToolCall(unifiedName, args);
                    const elapsed = Date.now() - startTime;
                    callLog.push({
                        tool: unifiedName,
                        shortName: prop,
                        args,
                        success: true,
                        elapsed,
                    });
                    return result;
                } catch (err) {
                    const elapsed = Date.now() - startTime;
                    callLog.push({
                        tool: unifiedName,
                        shortName: prop,
                        args,
                        success: false,
                        error: err.message,
                        elapsed,
                    });
                    throw err;
                }
            };
        },
    });

    // Minimal console for script debugging (logged server-side only)
    const sandboxConsole = {
        log: (...msgs) => console.error('[ExecScript]', ...msgs),
        error: (...msgs) => console.error('[ExecScript:ERR]', ...msgs),
        warn: (...msgs) => console.error('[ExecScript:WARN]', ...msgs),
    };

    // ── Execute in VM sandbox ────────────────────────────────────────────
    const timeoutMs = DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    try {
        // Wrap the script in an async IIFE that receives `tools` and `console`
        const wrappedScript = `
            (async function __exploration__(tools, console) {
                "use strict";
                ${scriptSource}
            })
        `;

        const vmScript = new vm.Script(wrappedScript, {
            filename: 'exploration-script.js',
            timeout: timeoutMs,
        });

        // Create a restricted context — NO Node globals
        const context = vm.createContext({
            // Minimal safe globals
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            RegExp,
            Map,
            Set,
            Promise,
            Error,
            TypeError,
            RangeError,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            encodeURIComponent,
            decodeURIComponent,
            setTimeout: undefined,  // Explicitly blocked
            setInterval: undefined, // Explicitly blocked
            fetch: undefined,       // Explicitly blocked
            require: undefined,     // Explicitly blocked
        });

        // Run the wrapper to get the async function
        const explorationFn = vmScript.runInContext(context, { timeout: timeoutMs });

        // Execute the exploration function with the tools proxy
        const result = await explorationFn(toolsProxy, sandboxConsole);

        const elapsed = Date.now() - startTime;

        return {
            success: true,
            result,
            stats: {
                toolCalls: callLog.length,
                totalElapsed: elapsed,
                callLog,
            },
        };
    } catch (err) {
        const elapsed = Date.now() - startTime;
        const isTimeout = err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
            err.message.includes('timed out');

        return {
            success: false,
            error: isTimeout
                ? `Script timed out after ${timeoutMs}ms. Reduce tool calls or simplify logic.`
                : err.message,
            stats: {
                toolCalls: callLog.length,
                totalElapsed: elapsed,
                callLog,
            },
        };
    }
}
