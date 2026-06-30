/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WORKFLOW BLUEPRINT — Contract, Validation & Graph Utilities
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A blueprint is a declarative, source-agnostic description of a multi-agent
 * workflow. Agent nodes reference agents by CATALOG ID (core:<mode> or
 * workspace:<wsId>:<assetId>), so default and custom Studio agents are
 * interchangeable. The WorkflowConductor executes a validated blueprint.
 *
 * Design rules:
 *   - The graph MUST be a DAG (acyclic). Loops are out of scope for v1; use
 *     per-node retry instead.
 *   - Parallelism is IMPLICIT: any nodes whose dependencies are all satisfied
 *     run concurrently (bounded by config.maxParallel in the conductor).
 *   - Exactly one `start` node; at least one `end` node.
 *   - Conditional branching is expressed via edge `when` expressions evaluated
 *     by the safe condition-eval module (no code execution).
 *
 * This module is PURE: no I/O, no sessions. It only validates structure and
 * provides graph helpers, so it is trivially unit-testable.
 *
 * @module sdk-orchestrator/workflow-blueprint
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { validateExpression } = require('./condition-eval');

const NODE_TYPES = Object.freeze({
    START: 'start',
    END: 'end',
    AGENT: 'agent',
    CONDITION: 'condition',
    APPROVAL: 'approval',
    TOOL: 'tool',
});

const NODE_TYPE_SET = new Set(Object.values(NODE_TYPES));

const CATALOG_ID_RE = /^(core:[A-Za-z0-9_-]+|workspace:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)$/;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

function getOutgoing(blueprint, nodeId) {
    return (blueprint.edges || []).filter(e => e.from === nodeId);
}

function getIncoming(blueprint, nodeId) {
    return (blueprint.edges || []).filter(e => e.to === nodeId);
}

function getNode(blueprint, nodeId) {
    return (blueprint.nodes || []).find(n => n.id === nodeId) || null;
}

function getNodesByType(blueprint, type) {
    return (blueprint.nodes || []).filter(n => n.type === type);
}

// ─── Cycle detection (DFS three-color) ──────────────────────────────────────

/**
 * Detect a cycle in the directed graph.
 * @returns {string[]|null} the cycle path (node ids) or null if acyclic.
 */
function findCycle(nodes, edges) {
    const adj = new Map();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
        if (adj.has(e.from)) adj.get(e.from).push(e.to);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(nodes.map(n => [n.id, WHITE]));
    const stack = [];

    function dfs(u) {
        color.set(u, GRAY);
        stack.push(u);
        for (const v of (adj.get(u) || [])) {
            if (!color.has(v)) continue; // dangling edge — handled elsewhere
            if (color.get(v) === GRAY) {
                // found a back-edge → cycle from v..u + v
                const idx = stack.indexOf(v);
                return stack.slice(idx).concat(v);
            }
            if (color.get(v) === WHITE) {
                const c = dfs(v);
                if (c) return c;
            }
        }
        color.set(u, BLACK);
        stack.pop();
        return null;
    }

    for (const n of nodes) {
        if (color.get(n.id) === WHITE) {
            const c = dfs(n.id);
            if (c) return c;
        }
    }
    return null;
}

/**
 * Topologically sort blueprint nodes (Kahn's algorithm).
 * @returns {string[]} ordered node ids
 * @throws if the graph is cyclic
 */
function topoSort(blueprint) {
    const nodes = blueprint.nodes || [];
    const edges = blueprint.edges || [];
    const indegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, []]));

    for (const e of edges) {
        if (!indegree.has(e.to) || !adj.has(e.from)) continue;
        indegree.set(e.to, indegree.get(e.to) + 1);
        adj.get(e.from).push(e.to);
    }

    // Deterministic order: queue seeded by node declaration order
    const queue = nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id);
    const order = [];

    while (queue.length) {
        const u = queue.shift();
        order.push(u);
        for (const v of adj.get(u)) {
            indegree.set(v, indegree.get(v) - 1);
            if (indegree.get(v) === 0) queue.push(v);
        }
    }

    if (order.length !== nodes.length) {
        throw new Error('Cannot topologically sort: blueprint contains a cycle');
    }
    return order;
}

// ─── Reachability ───────────────────────────────────────────────────────────

function reachableFrom(startId, edges) {
    const adj = new Map();
    for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from).push(e.to);
    }
    const seen = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
        const u = stack.pop();
        for (const v of (adj.get(u) || [])) {
            if (!seen.has(v)) { seen.add(v); stack.push(v); }
        }
    }
    return seen;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a blueprint's structure and referential integrity.
 *
 * @param {Object} blueprint
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateBlueprint(blueprint) {
    const errors = [];
    const warnings = [];

    if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
        return { valid: false, errors: ['blueprint must be an object'], warnings };
    }
    if (!isNonEmptyString(blueprint.id)) errors.push('blueprint.id is required (non-empty string)');
    if (!isNonEmptyString(blueprint.name)) errors.push('blueprint.name is required (non-empty string)');

    const nodes = Array.isArray(blueprint.nodes) ? blueprint.nodes : null;
    const edges = Array.isArray(blueprint.edges) ? blueprint.edges : [];
    if (!nodes || nodes.length === 0) {
        errors.push('blueprint.nodes must be a non-empty array');
        return { valid: false, errors, warnings };
    }
    if (!Array.isArray(blueprint.edges)) {
        errors.push('blueprint.edges must be an array');
    }

    // ── Node validation ──
    const ids = new Set();
    for (const n of nodes) {
        if (!n || typeof n !== 'object') { errors.push('each node must be an object'); continue; }
        if (!isNonEmptyString(n.id)) { errors.push('each node requires a non-empty id'); continue; }
        if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
        ids.add(n.id);

        if (!NODE_TYPE_SET.has(n.type)) {
            errors.push(`node '${n.id}': invalid type '${n.type}' (expected one of ${[...NODE_TYPE_SET].join(', ')})`);
            continue;
        }

        if (n.type === NODE_TYPES.AGENT) {
            if (!isNonEmptyString(n.agent)) {
                errors.push(`agent node '${n.id}': 'agent' (catalog id) is required`);
            } else if (!CATALOG_ID_RE.test(n.agent)) {
                errors.push(`agent node '${n.id}': 'agent' must be a catalog id like 'core:testgenie' or 'workspace:<wsId>:<assetId>' (got '${n.agent}')`);
            }
        }
        if (n.type === NODE_TYPES.CONDITION) {
            if (!isNonEmptyString(n.expression)) {
                errors.push(`condition node '${n.id}': 'expression' is required`);
            } else {
                const v = validateExpression(n.expression);
                if (!v.valid) errors.push(`condition node '${n.id}': invalid expression — ${v.error}`);
            }
        }
        if (n.type === NODE_TYPES.APPROVAL && !isNonEmptyString(n.prompt)) {
            errors.push(`approval node '${n.id}': 'prompt' is required`);
        }
        if (n.type === NODE_TYPES.TOOL && !isNonEmptyString(n.tool)) {
            errors.push(`tool node '${n.id}': 'tool' is required`);
        }
    }

    // ── Start/End cardinality ──
    const starts = getNodesByType(blueprint, NODE_TYPES.START);
    const ends = getNodesByType(blueprint, NODE_TYPES.END);
    if (starts.length !== 1) errors.push(`exactly one 'start' node is required (found ${starts.length})`);
    if (ends.length < 1) errors.push(`at least one 'end' node is required (found ${ends.length})`);

    // ── Edge referential integrity ──
    for (const e of edges) {
        if (!e || typeof e !== 'object') { errors.push('each edge must be an object'); continue; }
        if (!isNonEmptyString(e.from) || !isNonEmptyString(e.to)) {
            errors.push('each edge requires non-empty from and to');
            continue;
        }
        if (!ids.has(e.from)) errors.push(`edge references unknown 'from' node: ${e.from}`);
        if (!ids.has(e.to)) errors.push(`edge references unknown 'to' node: ${e.to}`);
        if (e.from === e.to) errors.push(`edge cannot be a self-loop on '${e.from}'`);
        if (e.when !== undefined) {
            const v = validateExpression(e.when);
            if (!v.valid) errors.push(`edge ${e.from}→${e.to}: invalid 'when' expression — ${v.error}`);
        }
        if (e.dataMapping !== undefined && (typeof e.dataMapping !== 'object' || Array.isArray(e.dataMapping))) {
            errors.push(`edge ${e.from}→${e.to}: 'dataMapping' must be an object`);
        }
    }

    // ── Acyclicity (only meaningful if structure is otherwise sound) ──
    if (errors.length === 0) {
        const cycle = findCycle(nodes, edges);
        if (cycle) errors.push(`blueprint must be acyclic (DAG); cycle detected: ${cycle.join(' → ')}`);
    }

    // ── Reachability (warnings — non-fatal but flagged) ──
    if (errors.length === 0 && starts.length === 1) {
        const reach = reachableFrom(starts[0].id, edges);
        for (const n of nodes) {
            if (n.type !== NODE_TYPES.START && !reach.has(n.id)) {
                warnings.push(`node '${n.id}' is unreachable from start`);
            }
        }
        // every non-end reachable node should have an outgoing edge
        for (const n of nodes) {
            if (n.type !== NODE_TYPES.END && reach.has(n.id) && getOutgoing(blueprint, n.id).length === 0) {
                warnings.push(`node '${n.id}' has no outgoing edge and is not an end node`);
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
    NODE_TYPES,
    CATALOG_ID_RE,
    validateBlueprint,
    topoSort,
    findCycle,
    reachableFrom,
    getOutgoing,
    getIncoming,
    getNode,
    getNodesByType,
};
