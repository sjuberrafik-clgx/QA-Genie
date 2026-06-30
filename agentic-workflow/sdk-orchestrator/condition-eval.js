/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONDITION EVALUATOR — Safe Deterministic Boolean Expressions (zero-LLM)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Evaluates the boolean expressions used by workflow blueprint condition nodes and
 * conditional edges (`when`). The grammar is intentionally tiny and is parsed by a
 * hand-written recursive-descent parser.
 *
 * SECURITY: This module NEVER uses eval() / new Function() on caller input. User
 * expressions come from saved blueprints (and, transitively, from Studio users), so
 * arbitrary code execution must be impossible. Identifier paths are resolved against
 * the supplied context object with explicit prototype-pollution guards
 * (__proto__ / prototype / constructor are rejected).
 *
 * Grammar (lowest → highest precedence):
 *   expr        := orExpr
 *   orExpr      := andExpr ( "||" andExpr )*
 *   andExpr     := notExpr ( "&&" notExpr )*
 *   notExpr     := "!" notExpr | comparison
 *   comparison  := additive ( ("==" | "!=" | ">=" | "<=" | ">" | "<") additive )?
 *   additive    := primary
 *   primary     := NUMBER | STRING | "true" | "false" | "null"
 *                | funcCall | path | "(" expr ")"
 *   funcCall    := IDENT "(" ( expr ( "," expr )* )? ")"
 *   path        := IDENT ( "." IDENT | "[" NUMBER "]" )*
 *
 * Supported functions: contains(a,b), startsWith(a,b), endsWith(a,b), length(a),
 *                      lower(a), upper(a)
 *
 * @module sdk-orchestrator/condition-eval
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// ─── Tokenizer ──────────────────────────────────────────────────────────────

const TOKEN = {
    NUMBER: 'NUMBER',
    STRING: 'STRING',
    IDENT: 'IDENT',
    OP: 'OP',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    LBRACKET: 'LBRACKET',
    RBRACKET: 'RBRACKET',
    DOT: 'DOT',
    COMMA: 'COMMA',
    EOF: 'EOF',
};

const MULTI_CHAR_OPS = ['==', '!=', '>=', '<=', '&&', '||'];
const SINGLE_CHAR_OPS = ['>', '<', '!'];

function tokenize(input) {
    const tokens = [];
    const src = String(input);
    let i = 0;

    while (i < src.length) {
        const ch = src[i];

        // Whitespace
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

        // Strings (single or double quoted, with backslash escapes)
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let val = '';
            i++;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    const next = src[i + 1];
                    val += (next === 'n') ? '\n' : (next === 't') ? '\t' : next;
                    i += 2;
                } else {
                    val += src[i];
                    i++;
                }
            }
            if (i >= src.length) throw new Error('Unterminated string literal');
            i++; // closing quote
            tokens.push({ type: TOKEN.STRING, value: val });
            continue;
        }

        // Numbers (integer or decimal)
        if (ch >= '0' && ch <= '9') {
            let num = '';
            while (i < src.length && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) {
                num += src[i];
                i++;
            }
            tokens.push({ type: TOKEN.NUMBER, value: parseFloat(num) });
            continue;
        }

        // Identifiers (letters, digits, underscore; must start with letter/underscore)
        if (/[A-Za-z_]/.test(ch)) {
            let ident = '';
            while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) {
                ident += src[i];
                i++;
            }
            tokens.push({ type: TOKEN.IDENT, value: ident });
            continue;
        }

        // Multi-char operators
        const two = src.slice(i, i + 2);
        if (MULTI_CHAR_OPS.includes(two)) {
            tokens.push({ type: TOKEN.OP, value: two });
            i += 2;
            continue;
        }

        // Single-char operators & punctuation
        if (SINGLE_CHAR_OPS.includes(ch)) { tokens.push({ type: TOKEN.OP, value: ch }); i++; continue; }
        if (ch === '(') { tokens.push({ type: TOKEN.LPAREN, value: ch }); i++; continue; }
        if (ch === ')') { tokens.push({ type: TOKEN.RPAREN, value: ch }); i++; continue; }
        if (ch === '[') { tokens.push({ type: TOKEN.LBRACKET, value: ch }); i++; continue; }
        if (ch === ']') { tokens.push({ type: TOKEN.RBRACKET, value: ch }); i++; continue; }
        if (ch === '.') { tokens.push({ type: TOKEN.DOT, value: ch }); i++; continue; }
        if (ch === ',') { tokens.push({ type: TOKEN.COMMA, value: ch }); i++; continue; }

        throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }

    tokens.push({ type: TOKEN.EOF });
    return tokens;
}

// ─── Parser (recursive descent → AST) ───────────────────────────────────────

const KEYWORD_LITERALS = { true: true, false: false, null: null };

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    _peek() { return this.tokens[this.pos]; }
    _next() { return this.tokens[this.pos++]; }
    _expect(type) {
        const t = this._next();
        if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type}${t.value !== undefined ? ` ('${t.value}')` : ''}`);
        return t;
    }

    parse() {
        const node = this._parseOr();
        if (this._peek().type !== TOKEN.EOF) {
            throw new Error(`Unexpected trailing token: ${this._peek().value}`);
        }
        return node;
    }

    _parseOr() {
        let left = this._parseAnd();
        while (this._peek().type === TOKEN.OP && this._peek().value === '||') {
            this._next();
            const right = this._parseAnd();
            left = { kind: 'logical', op: '||', left, right };
        }
        return left;
    }

    _parseAnd() {
        let left = this._parseNot();
        while (this._peek().type === TOKEN.OP && this._peek().value === '&&') {
            this._next();
            const right = this._parseNot();
            left = { kind: 'logical', op: '&&', left, right };
        }
        return left;
    }

    _parseNot() {
        if (this._peek().type === TOKEN.OP && this._peek().value === '!') {
            this._next();
            return { kind: 'not', operand: this._parseNot() };
        }
        return this._parseComparison();
    }

    _parseComparison() {
        const left = this._parsePrimary();
        const t = this._peek();
        if (t.type === TOKEN.OP && ['==', '!=', '>=', '<=', '>', '<'].includes(t.value)) {
            this._next();
            const right = this._parsePrimary();
            return { kind: 'compare', op: t.value, left, right };
        }
        return left;
    }

    _parsePrimary() {
        const t = this._peek();

        if (t.type === TOKEN.NUMBER) { this._next(); return { kind: 'literal', value: t.value }; }
        if (t.type === TOKEN.STRING) { this._next(); return { kind: 'literal', value: t.value }; }

        if (t.type === TOKEN.LPAREN) {
            this._next();
            const expr = this._parseOr();
            this._expect(TOKEN.RPAREN);
            return expr;
        }

        if (t.type === TOKEN.IDENT) {
            // keyword literal?
            if (Object.prototype.hasOwnProperty.call(KEYWORD_LITERALS, t.value)) {
                this._next();
                return { kind: 'literal', value: KEYWORD_LITERALS[t.value] };
            }
            // function call?
            if (this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === TOKEN.LPAREN) {
                return this._parseFuncCall();
            }
            // path
            return this._parsePath();
        }

        throw new Error(`Unexpected token in expression: ${t.type}${t.value !== undefined ? ` ('${t.value}')` : ''}`);
    }

    _parseFuncCall() {
        const name = this._expect(TOKEN.IDENT).value;
        this._expect(TOKEN.LPAREN);
        const args = [];
        if (this._peek().type !== TOKEN.RPAREN) {
            args.push(this._parseOr());
            while (this._peek().type === TOKEN.COMMA) {
                this._next();
                args.push(this._parseOr());
            }
        }
        this._expect(TOKEN.RPAREN);
        return { kind: 'call', name, args };
    }

    _parsePath() {
        const segments = [{ key: this._expect(TOKEN.IDENT).value }];
        for (;;) {
            const t = this._peek();
            if (t.type === TOKEN.DOT) {
                this._next();
                segments.push({ key: this._expect(TOKEN.IDENT).value });
            } else if (t.type === TOKEN.LBRACKET) {
                this._next();
                const idx = this._expect(TOKEN.NUMBER).value;
                this._expect(TOKEN.RBRACKET);
                segments.push({ index: idx });
            } else {
                break;
            }
        }
        return { kind: 'path', segments };
    }
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

function resolvePath(segments, ctx) {
    let cur = ctx;
    for (const seg of segments) {
        if (cur === null || cur === undefined) return undefined;
        if (seg.key !== undefined) {
            if (FORBIDDEN_KEYS.has(seg.key)) throw new Error(`Forbidden property access: ${seg.key}`);
            cur = cur[seg.key];
        } else {
            cur = cur[seg.index];
        }
    }
    return cur;
}

function isTruthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
}

function compare(op, a, b) {
    if (op === '==') return looseEq(a, b);
    if (op === '!=') return !looseEq(a, b);
    // ordering: numeric when both coerce to numbers, else string compare
    const na = Number(a), nb = Number(b);
    const numeric = !Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '' && a !== null && b !== null;
    const x = numeric ? na : String(a);
    const y = numeric ? nb : String(b);
    if (op === '>') return x > y;
    if (op === '<') return x < y;
    if (op === '>=') return x >= y;
    if (op === '<=') return x <= y;
    return false;
}

function looseEq(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    // number/string cross-compare
    if (typeof a === 'number' || typeof b === 'number') {
        const na = Number(a), nb = Number(b);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
    }
    return String(a) === String(b);
}

const FUNCTIONS = {
    contains(a, b) {
        if (Array.isArray(a)) return a.includes(b);
        if (a === null || a === undefined) return false;
        return String(a).includes(String(b));
    },
    startsWith(a, b) { return String(a ?? '').startsWith(String(b ?? '')); },
    endsWith(a, b) { return String(a ?? '').endsWith(String(b ?? '')); },
    length(a) {
        if (a === null || a === undefined) return 0;
        if (Array.isArray(a) || typeof a === 'string') return a.length;
        if (typeof a === 'object') return Object.keys(a).length;
        return 0;
    },
    lower(a) { return String(a ?? '').toLowerCase(); },
    upper(a) { return String(a ?? '').toUpperCase(); },
};

function evalNode(node, ctx) {
    switch (node.kind) {
        case 'literal':
            return node.value;
        case 'path':
            return resolvePath(node.segments, ctx);
        case 'logical': {
            const l = evalNode(node.left, ctx);
            if (node.op === '&&') return isTruthy(l) ? isTruthy(evalNode(node.right, ctx)) : false;
            return isTruthy(l) ? true : isTruthy(evalNode(node.right, ctx));
        }
        case 'not':
            return !isTruthy(evalNode(node.operand, ctx));
        case 'compare':
            return compare(node.op, evalNode(node.left, ctx), evalNode(node.right, ctx));
        case 'call': {
            const fn = FUNCTIONS[node.name];
            if (!fn) throw new Error(`Unknown function: ${node.name}`);
            const args = node.args.map(a => evalNode(a, ctx));
            return fn(...args);
        }
        default:
            throw new Error(`Unknown AST node kind: ${node.kind}`);
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse an expression into an AST. Throws on syntax error.
 * @param {string} expression
 * @returns {Object} AST root node
 */
function parse(expression) {
    return new Parser(tokenize(expression)).parse();
}

/**
 * Validate an expression's syntax without evaluating it.
 * @param {string} expression
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateExpression(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') {
        return { valid: false, error: 'expression must be a non-empty string' };
    }
    try {
        parse(expression);
        return { valid: true, error: null };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

/**
 * Evaluate an expression against a context object and return a boolean.
 * Never throws on evaluation — returns false on error (fail-closed) unless
 * options.throwOnError is set.
 *
 * @param {string} expression
 * @param {Object} [ctx] - Context (e.g., { steps: {...}, run: {...} })
 * @param {Object} [options]
 * @param {boolean} [options.throwOnError=false]
 * @returns {boolean}
 */
function evaluate(expression, ctx = {}, options = {}) {
    try {
        const ast = parse(expression);
        return isTruthy(evalNode(ast, ctx));
    } catch (err) {
        if (options.throwOnError) throw err;
        return false;
    }
}

module.exports = {
    parse,
    evaluate,
    validateExpression,
    // exported for unit testing
    _internals: { tokenize, isTruthy, compare, resolvePath },
};
