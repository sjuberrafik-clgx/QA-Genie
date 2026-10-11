/**
 * Small result helpers shared by the server and the tools.
 *
 * @module context-engine-mcp/util/result
 */

export class ContextEngineError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'ContextEngineError';
        this.code = code;
        if (details) this.details = details;
    }
}

export function fromError(error) {
    return {
        ok: false,
        code: error?.code || 'CE_ERROR',
        error: error?.message || String(error),
        ...(error?.details ? { details: error.details } : {}),
    };
}

export function short(sha) {
    return sha ? sha.slice(0, 10) : null;
}

/** Serialises a payload, replacing it with a bounded notice when it exceeds the budget. */
export function toText(payload, maxChars) {
    const text = JSON.stringify(payload);
    if (text.length <= maxChars) return { text, payload };
    const bounded = {
        ok: payload.ok !== false,
        truncated: true,
        note: `Output exceeded ${maxChars} characters. Narrow the request (fewer repos, a pathPrefix, or a lower limit).`,
        preview: text.slice(0, Math.max(0, maxChars - 300)),
    };
    return { text: JSON.stringify(bounded), payload: bounded };
}

/** Minimal JSON-schema subset validation for tool inputs (types, required, enums, bounds). */
export function validateArgs(schema, args) {
    const errors = [];
    const props = schema.properties || {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
    for (const key of schema.required || []) if (args[key] === undefined) errors.push(`"${key}" is required`);
    for (const [key, value] of Object.entries(args)) {
        const spec = props[key];
        if (!spec) { if (schema.additionalProperties === false) errors.push(`unknown argument "${key}"`); continue; }
        if (spec.type === 'array') {
            if (!Array.isArray(value)) { errors.push(`"${key}" must be an array`); continue; }
            if (spec.minItems && value.length < spec.minItems) errors.push(`"${key}" needs at least ${spec.minItems} item(s)`);
            if (spec.maxItems && value.length > spec.maxItems) errors.push(`"${key}" allows at most ${spec.maxItems} item(s)`);
            if (spec.items?.type === 'string' && value.some((v) => typeof v !== 'string' || !v)) errors.push(`"${key}" items must be non-empty strings`);
        } else if (spec.type === 'integer') {
            if (!Number.isInteger(value)) errors.push(`"${key}" must be an integer`);
            else if ((spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum)) {
                errors.push(`"${key}" must be between ${spec.minimum} and ${spec.maximum}`);
            }
        } else if (spec.type && typeof value !== spec.type) {
            errors.push(`"${key}" must be a ${spec.type}`);
        } else if (spec.maxLength && value.length > spec.maxLength) {
            errors.push(`"${key}" is longer than ${spec.maxLength} characters`);
        }
    }
    return errors;
}
