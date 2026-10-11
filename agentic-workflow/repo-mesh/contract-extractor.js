/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRACT EXTRACTOR — Java/Spring + YAML/Properties → QA Contracts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Deterministic, zero-LLM extraction of the QA-relevant CONTRACT surface from
 * backend microservices. We never index raw business logic — only the things a
 * QA test needs to ground itself and assert against the full stack:
 *
 *   • REST endpoints   (@RestController / @*Mapping)   → UI → API edges
 *   • Kafka topics     (@KafkaListener / KafkaTemplate / Spring Cloud Stream)
 *   • Elastic indices  (@Document / @Field / repositories)
 *   • Data models      (DTOs / records / events / entities + their fields)
 *   • Config / flags   (application.yml / .properties keys)
 *
 * Pure string analysis (regex), mirroring the style of ccm/context-dna-compiler.js.
 * Output is a normalized partial-contract object per file; contract-dna.js
 * aggregates these into per-service contracts.
 *
 * @module repo-mesh/contract-extractor
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');

const HTTP_MAPPINGS = {
    GetMapping: 'GET',
    PostMapping: 'POST',
    PutMapping: 'PUT',
    DeleteMapping: 'DELETE',
    PatchMapping: 'PATCH',
};

// ─── Public dispatch ────────────────────────────────────────────────────────

/**
 * Extract a partial contract from a single file, dispatched by extension.
 * @param {string} relPath
 * @param {string} content
 * @returns {Object|null} partial contract or null if unsupported/empty
 */
function extractFileContracts(relPath, content) {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.java') return extractJavaContracts(content, relPath);
    if (ext === '.yml' || ext === '.yaml') return extractYamlContracts(content, relPath);
    if (ext === '.properties') return extractPropertiesContracts(content, relPath);
    return null;
}

// ─── Java ───────────────────────────────────────────────────────────────────

function extractJavaContracts(content, relPath) {
    const result = {
        source: relPath,
        language: 'java',
        package: null,
        types: [],
        rest: [],
        kafka: { listeners: [], producers: [] },
        elastic: { documents: [], repositories: [] },
        models: [],
        configKeys: [],
    };

    const pkg = content.match(/package\s+([\w.]+)\s*;/);
    if (pkg) result.package = pkg[1];

    // ── Type declarations (class/record/enum/interface) ──────────────
    const typeRegex = /(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:public|final|abstract|static|\s)*\b(class|record|enum|interface)\s+(\w+)/g;
    let tm;
    while ((tm = typeRegex.exec(content)) !== null) {
        result.types.push({ kind: tm[1], name: tm[2], index: tm.index });
    }

    // ── REST controllers ─────────────────────────────────────────────
    const isController = /@RestController\b|@Controller\b/.test(content);
    let basePath = '';
    const classMapping = content.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/);
    if (classMapping) basePath = classMapping[1];

    if (isController) {
        // Method-level shorthand mappings (@GetMapping etc.)
        for (const [annotation, httpMethod] of Object.entries(HTTP_MAPPINGS)) {
            const re = new RegExp(`@${annotation}\\s*(?:\\(([^)]*)\\))?`, 'g');
            let m;
            while ((m = re.exec(content)) !== null) {
                const argBlob = m[1] || '';
                result.rest.push(buildEndpoint(httpMethod, argBlob, basePath, content, m.index));
            }
        }
        // @RequestMapping with explicit method=
        const rmRe = /@RequestMapping\s*\(([^)]*method[^)]*)\)/g;
        let rm;
        while ((rm = rmRe.exec(content)) !== null) {
            const argBlob = rm[1];
            const httpMethod = (argBlob.match(/RequestMethod\.(\w+)/) || [, 'GET'])[1];
            result.rest.push(buildEndpoint(httpMethod, argBlob, basePath, content, rm.index));
        }
    }

    // ── Kafka listeners ──────────────────────────────────────────────
    const klRe = /@KafkaListener\s*\(([^)]*)\)/g;
    let kl;
    while ((kl = klRe.exec(content)) !== null) {
        const argBlob = kl[1];
        const topics = extractStringList(argBlob, /topics\s*=\s*(\{[^}]*\}|["'][^"']+["'])/);
        const pattern = (argBlob.match(/topicPattern\s*=\s*["']([^"']+)["']/) || [])[1];
        const groupId = (argBlob.match(/groupId\s*=\s*["']([^"']+)["']/) || [])[1] || null;
        result.kafka.listeners.push({
            topics: topics.length ? topics : (pattern ? [pattern] : []),
            isPattern: !!pattern,
            groupId,
            method: nextMethodName(content, kl.index),
        });
    }

    // ── Kafka producers (KafkaTemplate.send / StreamBridge.send) ──────
    const sendRe = /(?:kafkaTemplate|streamBridge|template)\s*\.\s*send\s*\(\s*([A-Za-z0-9_."']+)/g;
    let sm;
    while ((sm = sendRe.exec(content)) !== null) {
        const raw = sm[1].replace(/["']/g, '');
        result.kafka.producers.push({ topic: raw, dynamic: /[A-Z_]{3,}/.test(sm[1]) && !sm[1].includes('"') });
    }
    // @SendTo
    const sendToRe = /@SendTo\s*\(\s*["']([^"']+)["']/g;
    let st;
    while ((st = sendToRe.exec(content)) !== null) {
        result.kafka.producers.push({ topic: st[1], dynamic: false, via: 'SendTo' });
    }

    // ── Elastic @Document ────────────────────────────────────────────
    const docRe = /@Document\s*\(([^)]*)\)/g;
    let dm;
    while ((dm = docRe.exec(content)) !== null) {
        const indexName = (dm[1].match(/(?:indexName|index)\s*=\s*["']([^"']+)["']/) || [])[1]
            || extractFirstString(dm[1]);
        result.elastic.documents.push({
            indexName: indexName || null,
            className: nextTypeName(result.types, dm.index),
            fields: extractEsFields(content, dm.index),
        });
    }
    // Elastic repositories
    const repoRe = /interface\s+(\w+)\s+extends\s+[\w<>,\s]*ElasticsearchRepository\s*<\s*(\w+)\s*,/g;
    let rr;
    while ((rr = repoRe.exec(content)) !== null) {
        result.elastic.repositories.push({ name: rr[1], entity: rr[2] });
    }

    // ── Data models (DTO/record/event/entity + fields) ────────────────
    for (const t of result.types) {
        if (!/Dto|DTO|Request|Response|Event|Entity|Model|Payload|Record/.test(t.name) && t.kind !== 'record') {
            continue;
        }
        result.models.push({
            name: t.name,
            kind: t.kind,
            fields: t.kind === 'record'
                ? extractRecordComponents(content, t.index)
                : extractClassFields(content, t.index),
        });
    }

    return result;
}

function buildEndpoint(httpMethod, argBlob, basePath, content, atIndex) {
    let p = (argBlob.match(/(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/) || [])[1] || '';
    const full = joinPath(basePath, p);
    return {
        httpMethod,
        path: full || basePath || '/',
        produces: (argBlob.match(/produces\s*=\s*["']([^"']+)["']/) || [])[1] || null,
        method: nextMethodName(content, atIndex),
    };
}

function joinPath(base, p) {
    if (!base) return p;
    if (!p) return base;
    return (base.replace(/\/$/, '') + '/' + p.replace(/^\//, '')).replace(/\/+/g, '/');
}

/** Find the name of the method declared after a given index. */
function nextMethodName(content, fromIndex) {
    const slice = content.slice(fromIndex, fromIndex + 600);
    const m = slice.match(/(?:public|private|protected|\s)[\w<>,\[\]\s]+\s+(\w+)\s*\(/);
    return m ? m[1] : null;
}

/** Find the name of the type declared at/after a given index. */
function nextTypeName(types, fromIndex) {
    const after = types.filter((t) => t.index >= fromIndex).sort((a, b) => a.index - b.index);
    return after.length ? after[0].name : null;
}

function extractStringList(blob, keyRegex) {
    const m = blob.match(keyRegex);
    if (!m) return [];
    const raw = m[1];
    const strings = [...raw.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    return strings;
}

function extractFirstString(blob) {
    const m = blob.match(/["']([^"']+)["']/);
    return m ? m[1] : null;
}

function extractEsFields(content, fromIndex) {
    const body = braceBlockAfter(content, fromIndex);
    const fields = [];
    const fieldRe = /@Field\s*\(([^)]*)\)\s*(?:private|public|protected)?\s*([\w<>,\s]+?)\s+(\w+)\s*;/g;
    let m;
    while ((m = fieldRe.exec(body)) !== null) {
        const esType = (m[1].match(/type\s*=\s*FieldType\.(\w+)/) || [])[1] || null;
        const named = (m[1].match(/name\s*=\s*["']([^"']+)["']/) || [])[1];
        fields.push({ name: named || m[3], javaType: m[2].trim(), esType });
    }
    return fields;
}

function extractClassFields(content, fromIndex) {
    const body = braceBlockAfter(content, fromIndex);
    const fields = [];
    const fieldRe = /(?:private|protected|public)\s+(?:final\s+)?([\w<>,\.\[\]\s]+?)\s+(\w+)\s*(?:=|;)/g;
    let m;
    while ((m = fieldRe.exec(body)) !== null) {
        const type = m[1].trim();
        if (type === 'static' || /\(/.test(type)) continue;
        fields.push({ name: m[2], type });
        if (fields.length >= 60) break;
    }
    return fields;
}

function extractRecordComponents(content, fromIndex) {
    const slice = content.slice(fromIndex, fromIndex + 1200);
    const m = slice.match(/record\s+\w+\s*\(([^)]*)\)/);
    if (!m) return [];
    return m[1]
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
            const parts = c.replace(/@\w+\s*/g, '').trim().split(/\s+/);
            return { name: parts[parts.length - 1], type: parts.slice(0, -1).join(' ') };
        })
        .filter((f) => f.name);
}

/** Return the {...} block starting at the first '{' after fromIndex. */
function braceBlockAfter(content, fromIndex) {
    const open = content.indexOf('{', fromIndex);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
            depth--;
            if (depth === 0) return content.slice(open, i + 1);
        }
    }
    return content.slice(open, fromIndex + 4000);
}

// ─── YAML (Spring application.yml) ──────────────────────────────────────────

function extractYamlContracts(content, relPath) {
    const flat = flattenYaml(content);
    return contractsFromFlatConfig(flat, relPath, 'yaml');
}

function extractPropertiesContracts(content, relPath) {
    const flat = {};
    for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('!')) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        flat[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return contractsFromFlatConfig(flat, relPath, 'properties');
}

/**
 * Build the Kafka/Elastic/config contract surface from a flattened config map.
 * Handles Spring Cloud Stream bindings, raw kafka topics, and elastic indices.
 */
function contractsFromFlatConfig(flat, relPath, language) {
    const result = {
        source: relPath,
        language,
        applicationName: flat['spring.application.name'] || null,
        serverPort: flat['server.port'] || null,
        rest: [],
        kafka: { listeners: [], producers: [], bindings: [] },
        elastic: { documents: [], repositories: [], indices: [] },
        models: [],
        configKeys: [],
    };

    for (const [key, value] of Object.entries(flat)) {
        // Spring Cloud Stream binding destinations → topics
        const bindMatch = key.match(/spring\.cloud\.stream\.bindings\.([\w-]+)\.destination$/);
        if (bindMatch) {
            const binding = bindMatch[1];
            const direction = /-out-|output|producer|supply|supplier/i.test(binding) ? 'out'
                : /-in-|input|consumer|process/i.test(binding) ? 'in' : 'unknown';
            result.kafka.bindings.push({ binding, destination: value, direction });
            if (direction === 'out') result.kafka.producers.push({ topic: value, via: 'stream-binding', binding });
            else result.kafka.listeners.push({ topics: [value], via: 'stream-binding', binding });
            continue;
        }
        // Explicit kafka topic-ish keys
        if (/kafka.*\.topic(s)?$/i.test(key) || /\.topic-name$/i.test(key)) {
            value.split(',').map((v) => v.trim()).filter(Boolean).forEach((topic) => {
                result.kafka.producers.push({ topic, via: 'config-key', key });
            });
            continue;
        }
        // Elastic index names
        if (/elasticsearch.*index.*name$/i.test(key) || /\.index-name$/i.test(key) || /\.es-index$/i.test(key)) {
            result.elastic.indices.push({ indexName: value, key });
            continue;
        }
        // Feature flags / toggles
        if (/feature|toggle|enabled$|flag/i.test(key)) {
            result.configKeys.push({ key, value });
        }
    }

    result.props = flat;
    return result;
}

/**
 * Minimal indentation-based YAML → flat dotted-key map.
 * Supports nested maps and scalar values (the Spring config subset we need).
 * Lists and multi-doc separators are skipped (not needed for contracts).
 */
function flattenYaml(content) {
    const flat = {};
    const stack = []; // { indent, key }
    const lines = content.split('\n');
    for (let raw of lines) {
        if (!raw.trim() || raw.trim().startsWith('#') || raw.trim() === '---') continue;
        if (raw.trim().startsWith('- ')) continue; // skip list items
        const indent = raw.match(/^\s*/)[0].length;
        const line = raw.trim();
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const key = line.slice(0, colon).trim();
        let value = line.slice(colon + 1).trim();
        // Pop stack to current indent level
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const dotted = [...stack.map((s) => s.key), key].join('.');
        if (value === '' || value === '|' || value === '>') {
            stack.push({ indent, key });
        } else {
            value = value.replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '');
            flat[dotted] = value;
        }
    }
    return flat;
}

module.exports = {
    extractFileContracts,
    extractJavaContracts,
    extractYamlContracts,
    extractPropertiesContracts,
    flattenYaml,
};
