/**
 * Deterministic business-rule compilation for application features.
 * Raw source stays on disk; persisted rules contain compact cards and evidence handles.
 */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const RULE_DNA_VERSION = '1.0.0';
const MAX_TEXT = 240;

function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function applicationFromPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/').match(/projects\/([^/]+)\//)?.[1] || null;
}

function truncate(value, max = MAX_TEXT) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function hash(value, length = 16) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function lineRange(sourceFile, node) {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { startLine: start, endLine: end };
}

function sourceText(sourceFile, node, max = MAX_TEXT) {
    return truncate(node?.getText(sourceFile) || '', max);
}

function literalValue(sourceFile, node) {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return JSON.stringify(node.text);
    if (ts.isNumericLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) return '[]';
    if (ts.isObjectLiteralExpression(node) && node.properties.length === 0) return '{}';
    return sourceText(sourceFile, node, 120);
}

function classifyRule(text) {
    const value = normalize(text);
    if (/permission|access|auth|signed in|view mode|off limits/.test(value)) return 'permission';
    if (/initial|start|default|initialize/.test(value)) return 'initial-state';
    if (/maximum|minimum|limit|full|column|slot|length/.test(value)) return 'limit';
    if (/persist|storage|restore|cache|group id/.test(value)) return 'persistence';
    if (/toast|notification|analytics|emit|send message/.test(value)) return 'side-effect';
    if (/mobile|desktop|breakpoint|min width|max width|responsive/.test(value)) return 'responsive';
    if (/remove|add|toggle|replace|select|deselect|becomes|returns/.test(value)) return 'transition';
    if (/error|invalid|unknown|does nothing|no op|guard/.test(value)) return 'guard';
    return 'behavior';
}

function callName(call, sourceFile) {
    if (!ts.isCallExpression(call)) return null;
    const expression = call.expression;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (ts.isIdentifier(expression)) return expression.text;
    return sourceText(sourceFile, expression, 80);
}

function summarizeEffects(statement, sourceFile) {
    const effects = [];
    function visit(node) {
        if (effects.length >= 3) return;
        if (ts.isReturnStatement(node)) {
            effects.push(node.expression ? `returns ${literalValue(sourceFile, node.expression)}` : 'returns');
            return;
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            effects.push(`${sourceText(sourceFile, node.left, 80)} becomes ${literalValue(sourceFile, node.right)}`);
            return;
        }
        if (ts.isCallExpression(node)) {
            const name = sourceText(sourceFile, node.expression, 100);
            if (!/^expect\b/.test(name)) effects.push(`calls ${name}`);
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(statement);
    return [...new Set(effects)];
}

function createTemplate({ statement, type, context, evidence, trigger, expectations, actions, key }) {
    return {
        key,
        statement: truncate(statement),
        type: type || classifyRule(`${statement} ${context || ''}`),
        context: truncate(context || '', 180),
        trigger: truncate(trigger || '', 160),
        expectations: (expectations || []).map((item) => truncate(item, 180)).slice(0, 5),
        actions: (actions || []).map((item) => truncate(item, 120)).slice(0, 5),
        evidence,
    };
}

function extractProductionTemplates(sourceFile, filePath, repository, contentHash) {
    const templates = [];
    const methodNames = new Set();
    const methodEvidence = new Map();

    function evidence(node) {
        return {
            kind: 'source',
            repository,
            path: filePath,
            ...lineRange(sourceFile, node),
            contentHash,
        };
    }

    function visit(node, methodName = null) {
        let activeMethod = methodName;
        if (ts.isMethodDeclaration(node) && node.name) {
            activeMethod = sourceText(sourceFile, node.name, 80);
            methodNames.add(activeMethod);
            methodEvidence.set(activeMethod, evidence(node));
        }

        if (ts.isPropertyDeclaration(node) && node.name && node.initializer && ts.isNewExpression(node.initializer)) {
            const ctor = sourceText(sourceFile, node.initializer.expression, 80);
            if (/BehaviorSubject|ReplaySubject/.test(ctor)) {
                const property = sourceText(sourceFile, node.name, 80);
                const initial = literalValue(sourceFile, node.initializer.arguments?.[0]);
                templates.push(createTemplate({
                    key: `initial:${property}`,
                    statement: `${property} initializes to ${initial}`,
                    type: 'initial-state',
                    context: activeMethod || 'class state',
                    evidence: [evidence(node)],
                }));
            }
        }

        if (ts.isIfStatement(node)) {
            const condition = sourceText(sourceFile, node.expression, 160);
            const effects = summarizeEffects(node.thenStatement, sourceFile);
            if (effects.length > 0) {
                templates.push(createTemplate({
                    key: `if:${activeMethod || 'module'}:${condition}`,
                    statement: `When ${condition}, ${effects.join('; ')}`,
                    context: activeMethod || 'conditional behavior',
                    trigger: condition,
                    expectations: effects,
                    evidence: [evidence(node)],
                }));
            }
        }

        if (ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isConditionalExpression(node.right)) {
            const target = sourceText(sourceFile, node.left, 100);
            const condition = sourceText(sourceFile, node.right.condition, 140);
            const whenTrue = literalValue(sourceFile, node.right.whenTrue);
            const whenFalse = literalValue(sourceFile, node.right.whenFalse);
            templates.push(createTemplate({
                key: `conditional:${activeMethod || 'module'}:${target}`,
                statement: `${target} becomes ${whenTrue} when ${condition}; otherwise ${whenFalse}`,
                type: /breakpoint|min-width|max-width/i.test(`${condition} ${whenTrue} ${whenFalse}`) ? 'responsive' : 'transition',
                context: activeMethod || 'conditional assignment',
                trigger: condition,
                expectations: [`${target} = ${whenTrue}`, `${target} = ${whenFalse}`],
                evidence: [evidence(node)],
            }));
        }

        ts.forEachChild(node, (child) => visit(child, activeMethod));
    }

    visit(sourceFile);
    return { templates, methodNames, methodEvidence };
}

function expectationText(call, sourceFile) {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return null;
    const matcher = call.expression.name.text;
    const expectCall = call.expression.expression;
    if (!ts.isCallExpression(expectCall) || sourceText(sourceFile, expectCall.expression, 30) !== 'expect') return null;
    const actual = sourceText(sourceFile, expectCall.arguments[0], 100);
    const expected = call.arguments.map((argument) => literalValue(sourceFile, argument)).join(', ');
    return `${actual} ${matcher}${expected ? ` ${expected}` : ''}`;
}

function extractTestTemplates(sourceFile, filePath, repository, contentHash) {
    const templates = [];

    function walk(node, suites = []) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const name = node.expression.text;
            const titleNode = node.arguments[0];
            const callback = node.arguments[1];
            const title = titleNode && ts.isStringLiteralLike(titleNode) ? titleNode.text : null;
            if (name === 'describe' && title && callback) {
                ts.forEachChild(callback, (child) => walk(child, [...suites, title]));
                return;
            }
            if ((name === 'it' || name === 'test') && title && callback) {
                const expectations = [];
                const actions = [];
                function inspect(child) {
                    if (ts.isCallExpression(child)) {
                        const expectation = expectationText(child, sourceFile);
                        if (expectation) expectations.push(expectation);
                        else {
                            const called = callName(child, sourceFile);
                            if (called && !['describe', 'it', 'test', 'expect', 'subscribe'].includes(called)) {
                                actions.push(sourceText(sourceFile, child, 120));
                            }
                        }
                    }
                    ts.forEachChild(child, inspect);
                }
                inspect(callback);
                if (expectations.length > 0) {
                    templates.push(createTemplate({
                        key: `test:${suites.join('>')}:${title}`,
                        statement: title.replace(/^should\s+/i, ''),
                        context: suites.join(' > '),
                        expectations,
                        actions,
                        evidence: [{
                            kind: 'unit-test',
                            repository,
                            path: filePath,
                            ...lineRange(sourceFile, node),
                            contentHash,
                        }],
                    }));
                }
                return;
            }
        }
        ts.forEachChild(node, (child) => walk(child, suites));
    }

    walk(sourceFile);
    return templates;
}

function extractRuleTemplates(content, filePath) {
    const repository = filePath.replace(/\\/g, '/').split('/')[0] || 'unknown';
    const contentHash = hash(content);
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const isTest = /\.(?:spec|test)\.[jt]sx?$/i.test(filePath);
    if (isTest) {
        return {
            templates: extractTestTemplates(sourceFile, filePath, repository, contentHash),
            methodNames: new Set(),
            methodEvidence: new Map(),
        };
    }
    return extractProductionTemplates(sourceFile, filePath, repository, contentHash);
}

function instantiateRule(feature, template, confidence = 'derived') {
    const semanticKey = `${normalize(feature)}|${template.key}|${normalize(template.statement)}`;
    return {
        id: `rule:${hash(semanticKey)}`,
        semanticHash: hash(`${semanticKey}|${JSON.stringify(template.expectations)}`),
        feature,
        statement: template.statement,
        type: template.type,
        truthLane: 'implemented',
        confidence,
        context: template.context,
        trigger: template.trigger,
        expectations: template.expectations,
        actions: template.actions,
        evidence: template.evidence,
    };
}

function instantiateIntendedRule(feature, definition, catalogPath) {
    const statement = truncate(definition.statement || definition.rule || '');
    const key = `${normalize(feature)}|intended|${normalize(statement)}`;
    return {
        id: `rule:${hash(key)}`,
        semanticHash: hash(key),
        feature,
        statement,
        type: definition.type || classifyRule(statement),
        truthLane: 'intended',
        confidence: definition.confidence || 'curated',
        context: truncate(definition.context || 'feature catalog'),
        trigger: truncate(definition.trigger || ''),
        expectations: (definition.expectations || []).map((item) => truncate(item, 180)).slice(0, 5),
        actions: [],
        evidence: [{ kind: 'requirement', repository: 'workspace', path: catalogPath, startLine: null, endLine: null }],
    };
}

function rankRule(rule, queryTerms) {
    const confidence = { corroborated: 4, asserted: 3, curated: 3, derived: 2 }[rule.confidence] || 1;
    const haystack = normalize(`${rule.statement} ${rule.context} ${rule.type} ${rule.trigger}`);
    const matches = queryTerms.filter((term) => haystack.includes(term)).length;
    const laneBonus = rule.truthLane === 'intended' ? 1 : 0;
    return (matches * 10) + confidence + laneBonus;
}

class RuleDNA {
    constructor(options = {}) {
        this.persistPath = path.resolve(options.persistPath || path.join(__dirname, '..', 'repo-mesh-data', 'rule-dna.json'));
        this.frontendRoot = path.resolve(options.frontendRoot || path.join(__dirname, '..', 'repo-mesh-data', 'frontend'));
        this.maxFilesPerFeature = options.maxFilesPerFeature || 24;
        this._rules = new Map();
        this._byFeature = new Map();
        this._aliases = new Map();
        this._builtAt = null;
        this._repoHeads = new Map();
    }

    load() {
        try {
            const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
            this._rules = new Map((data.rules || []).map((rule) => [rule.id, rule]));
            this._byFeature = new Map(Object.entries(data.byFeature || {}));
            this._aliases = new Map(Object.entries(data.aliases || {}));
            this._builtAt = data.builtAt || null;
            return true;
        } catch {
            return false;
        }
    }

    save() {
        fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
        const data = {
            version: RULE_DNA_VERSION,
            builtAt: new Date().toISOString(),
            stats: this.stats(),
            rules: [...this._rules.values()],
            byFeature: Object.fromEntries(this._byFeature),
            aliases: Object.fromEntries(this._aliases),
        };
        fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
        this._builtAt = data.builtAt;
    }

    build({ graph, featureCatalog = null, catalogPath = 'agentic-workflow/config/feature-catalog.json' }) {
        this._rules.clear();
        this._byFeature.clear();
        this._aliases.clear();
        const parseCache = new Map();
        const catalogByName = new Map((featureCatalog?.features || []).map((entry) => [entry.name, entry]));

        for (const node of graph.nodes.values()) {
            if (node.type !== 'feature') continue;
            const feature = node.label;
            const catalogEntry = catalogByName.get(feature);
            const aliases = [...new Set([...(node.meta?.aliases || []), ...(catalogEntry?.aliases || [])])];
            this._aliases.set(normalize(feature), feature);
            for (const alias of aliases) this._aliases.set(normalize(alias), feature);

            const candidates = [...new Set(node.meta?.sources || [])].slice(0, this.maxFilesPerFeature);
            const expanded = [...candidates];
            for (const source of candidates) {
                if (/\.ts$/i.test(source) && !/\.spec\.ts$/i.test(source)) {
                    const sibling = source.replace(/\.ts$/i, '.spec.ts');
                    if (fs.existsSync(path.join(this.frontendRoot, sibling))) expanded.push(sibling);
                }
            }

            const productionMethods = new Set();
            const productionEvidence = new Map();
            const extracted = [];
            for (const source of [...new Set(expanded)].slice(0, this.maxFilesPerFeature * 2)) {
                if (!/\.[jt]sx?$/i.test(source)) continue;
                const absolute = path.join(this.frontendRoot, source);
                if (!fs.existsSync(absolute)) continue;
                let parsed = parseCache.get(absolute);
                if (!parsed) {
                    const content = fs.readFileSync(absolute, 'utf-8');
                    parsed = extractRuleTemplates(content, source);
                    parseCache.set(absolute, parsed);
                }
                parsed.methodNames.forEach((method) => productionMethods.add(method));
                for (const [method, methodSource] of parsed.methodEvidence || []) {
                    if (!productionEvidence.has(method)) productionEvidence.set(method, []);
                    productionEvidence.get(method).push(methodSource);
                }
                extracted.push(...parsed.templates);
            }

            const rules = [];
            for (const template of extracted) {
                const isTest = template.evidence.some((item) => item.kind === 'unit-test');
                const actionMethods = template.actions
                    .map((action) => action.match(/\.([A-Za-z_$][\w$]*)\s*\(/)?.[1])
                    .filter(Boolean);
                const corroborated = isTest && actionMethods.some((method) => productionMethods.has(method));
                const testApplication = applicationFromPath(template.evidence.find((item) => item.kind === 'unit-test')?.path);
                const supportingSources = [];
                const supportingKeys = new Set();
                if (corroborated) {
                    for (const method of actionMethods) {
                        const candidates = productionEvidence.get(method) || [];
                        const selected = candidates.find((item) => applicationFromPath(item.path) === testApplication) || candidates[0];
                        if (!selected) continue;
                        const key = `${selected.path}:${selected.startLine}:${selected.endLine}`;
                        if (supportingKeys.has(key)) continue;
                        supportingKeys.add(key);
                        supportingSources.push(selected);
                    }
                }
                const enrichedTemplate = supportingSources.length > 0
                    ? { ...template, evidence: [...template.evidence, ...supportingSources] }
                    : template;
                rules.push(instantiateRule(feature, enrichedTemplate, corroborated ? 'corroborated' : isTest ? 'asserted' : 'derived'));
            }
            for (const definition of catalogEntry?.businessRules || []) {
                if (definition?.statement || definition?.rule) {
                    rules.push(instantiateIntendedRule(feature, definition, catalogPath));
                }
            }

            const ids = [];
            for (const rule of rules) {
                if (this._rules.has(rule.id)) continue;
                rule.evidence = (rule.evidence || []).map((item) => ({
                    ...item,
                    commitSha: item.repository && item.repository !== 'workspace'
                        ? this._repositoryHead(item.repository)
                        : null,
                }));
                this._rules.set(rule.id, rule);
                ids.push(rule.id);
            }
            if (ids.length > 0) this._byFeature.set(feature, ids);
        }

        this.save();
        return this.stats();
    }

    resolveFeature(feature) {
        return this._aliases.get(normalize(feature)) || feature;
    }

    getRules(feature, options = {}) {
        const canonical = this.resolveFeature(feature);
        const maxRules = Math.max(1, Math.min(Number(options.maxRules) || 5, 5));
        const lanes = new Set(options.truthLanes || []);
        const types = new Set(options.types || []);
        const queryTerms = normalize(options.query || '').split(' ').filter((term) => term.length > 2);
        return (this._byFeature.get(canonical) || [])
            .map((id) => this._rules.get(id))
            .filter(Boolean)
            .filter((rule) => lanes.size === 0 || lanes.has(rule.truthLane))
            .filter((rule) => types.size === 0 || types.has(rule.type))
            .map((rule) => ({ rule, score: rankRule(rule, queryTerms) }))
            .sort((left, right) => right.score - left.score || left.rule.id.localeCompare(right.rule.id))
            .slice(0, maxRules)
            .map(({ rule }) => rule);
    }

    getRule(ruleId) {
        return this._rules.get(ruleId) || null;
    }

    getFeatureStats(feature) {
        const canonical = this.resolveFeature(feature);
        const rules = (this._byFeature.get(canonical) || []).map((id) => this._rules.get(id)).filter(Boolean);
        const byLane = {};
        const byType = {};
        const byConfidence = {};
        for (const rule of rules) {
            byLane[rule.truthLane] = (byLane[rule.truthLane] || 0) + 1;
            byType[rule.type] = (byType[rule.type] || 0) + 1;
            byConfidence[rule.confidence] = (byConfidence[rule.confidence] || 0) + 1;
        }
        return { feature: canonical, total: rules.length, byLane, byType, byConfidence };
    }

    getEvidence(ruleId, options = {}) {
        const rule = this.getRule(ruleId);
        if (!rule) return null;
        const contextLines = Math.max(0, Math.min(Number(options.contextLines) || 3, 10));
        const windows = [];
        for (const evidence of rule.evidence || []) {
            if (!evidence.path || evidence.startLine == null) continue;
            const absolute = path.join(this.frontendRoot, evidence.path);
            if (!fs.existsSync(absolute)) continue;
            const content = fs.readFileSync(absolute, 'utf-8');
            const lines = content.split(/\r?\n/);
            const currentContentHash = hash(content);
            const startLine = Math.max(1, evidence.startLine - contextLines);
            const endLine = Math.min(lines.length, evidence.endLine + contextLines);
            windows.push({
                ...evidence,
                stale: !!evidence.contentHash && evidence.contentHash !== currentContentHash,
                startLine,
                endLine,
                content: lines.slice(startLine - 1, endLine).join('\n'),
            });
        }
        return { rule, windows };
    }

    _repositoryHead(repository) {
        if (this._repoHeads.has(repository)) return this._repoHeads.get(repository);
        let sha = null;
        try {
            sha = execFileSync('git', ['-C', path.join(this.frontendRoot, repository), 'rev-parse', 'HEAD'], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5000,
            }).trim() || null;
        } catch {
            sha = null;
        }
        this._repoHeads.set(repository, sha);
        return sha;
    }

    compareObservations(feature, observations = []) {
        const canonical = this.resolveFeature(feature);
        const featureRuleIds = new Set(this._byFeature.get(canonical) || []);
        const results = [];
        for (const observation of observations.slice(0, 10)) {
            const rule = this._rules.get(observation.ruleId);
            if (!rule || !featureRuleIds.has(observation.ruleId)) {
                results.push({ ruleId: observation.ruleId, verdict: 'unknown-rule', actual: truncate(observation.actual || '') });
                continue;
            }
            const outcome = ['pass', 'fail', 'not-observed'].includes(observation.outcome)
                ? observation.outcome
                : 'not-observed';
            results.push({
                ruleId: rule.id,
                statement: rule.statement,
                truthLane: rule.truthLane,
                expectedTruthLane: rule.truthLane,
                observedTruthLane: 'observed',
                verdict: outcome,
                actual: truncate(observation.actual || '', 200),
            });
        }
        return {
            feature: canonical,
            results,
            summary: {
                passed: results.filter((item) => item.verdict === 'pass').length,
                failed: results.filter((item) => item.verdict === 'fail').length,
                notObserved: results.filter((item) => item.verdict === 'not-observed').length,
                unknownRules: results.filter((item) => item.verdict === 'unknown-rule').length,
                conflicts: results.filter((item) => item.verdict === 'fail').length,
            },
            conflicts: results.filter((item) => item.verdict === 'fail').map((item) => ({
                ruleId: item.ruleId,
                kind: `${item.expectedTruthLane}-vs-${item.observedTruthLane}`,
                expected: item.statement,
                actual: item.actual,
            })),
        };
    }

    stats() {
        const rules = [...this._rules.values()];
        const byType = {};
        const byLane = {};
        const byConfidence = {};
        for (const rule of rules) {
            byType[rule.type] = (byType[rule.type] || 0) + 1;
            byLane[rule.truthLane] = (byLane[rule.truthLane] || 0) + 1;
            byConfidence[rule.confidence] = (byConfidence[rule.confidence] || 0) + 1;
        }
        return {
            rules: rules.length,
            features: this._byFeature.size,
            byType,
            byLane,
            byConfidence,
            builtAt: this._builtAt,
        };
    }
}

module.exports = {
    RULE_DNA_VERSION,
    RuleDNA,
    classifyRule,
    extractRuleTemplates,
    instantiateRule,
    normalize,
};