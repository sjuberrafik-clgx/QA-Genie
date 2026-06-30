/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK PERMISSION RESPONSE — single source of truth for onPermissionRequest replies
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS (do not change the kind without reading this):
 *
 * Every Copilot SDK session created by this app passes an `onPermissionRequest`
 * handler that auto-approves privileged tool calls (browser/MCP, file read/write,
 * shell). The SDK itself models the approval as a PermissionRequestResult whose
 * `approveAll` helper returns `{ kind: 'approved' }`.
 *
 * However, the BUNDLED CLI runtime (`@github/copilot`, spawned over JSON-RPC by
 * `@github/copilot-sdk`) routes the SDK-over-RPC permission-prompt response
 * through an internal mapper that only accepts INTERACTIVE *decision* kinds:
 *
 *     approve-once | approve-for-session | approve-for-location | reject | user-not-available
 *
 * Returning `{ kind: 'approved' }` falls through to that mapper's `default`
 * branch and throws **"unexpected user permission response"**, which fails EVERY
 * privileged tool call (independent of headless/headed). The CLI's RPC schema
 * accepts BOTH `approved` and `approve-once`, but only `approve-once` survives the
 * decision mapper (it maps approve-once → approved).
 *
 * FIX: always reply with `{ kind: 'approve-once' }`. This auto-approves the single
 * pending request with no rule-writing side effects. Real gating is intentionally
 * handled elsewhere (the app's own `onPreToolUse` enforcement hooks and the global
 * Jira mutation approval guardrail) — NOT here.
 *
 * Keep this as the ONLY place that produces the approval reply so the three
 * session-creation sites (chat-session-manager.js, agent-sessions.js ×2) can never
 * drift back to `approved`.
 *
 * @module sdk-orchestrator/permission-response
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * The permission-decision kind the bundled CLI accepts for an auto-approval.
 * Maps to `{ kind: 'approved' }` inside the CLI's decision mapper.
 * @type {'approve-once'}
 */
const PERMISSION_APPROVE_KIND = 'approve-once';

/**
 * Build a fresh auto-approval response for an SDK `onPermissionRequest` handler.
 *
 * A new object is returned on every call so the SDK/CLI can never observe a shared
 * (and potentially mutated/frozen) instance across requests.
 *
 * @returns {{ kind: 'approve-once' }} The CLI-compatible auto-approval decision.
 */
function approveAllPermissions() {
    return { kind: PERMISSION_APPROVE_KIND };
}

module.exports = {
    PERMISSION_APPROVE_KIND,
    approveAllPermissions,
};
