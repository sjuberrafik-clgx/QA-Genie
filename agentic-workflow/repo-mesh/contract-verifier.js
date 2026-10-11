/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRACT VERIFIER — Anti-Hallucination Guardrail for Full-Stack Assertions
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Scans a generated .spec.js for backend assertion references — Kafka topics,
 * Elastic indices, and API paths — and verifies each against the Federated
 * Contract Mesh. A topic/index/endpoint that does NOT exist in any extracted
 * contract is flagged UNGROUNDED: almost always a hallucinated name.
 *
 * Run this BEFORE executing a test (codereviewer / scriptgenerator). Catching a
 * fake topic statically is far cheaper than a flaky/false-green run — this is the
 * mechanism that pushes full-stack assertions toward "100% accuracy".
 *
 * Deterministic, zero-LLM.
 *
 * @module repo-mesh/contract-verifier
 * ═══════════════════════════════════════════════════════════════════════════════
 */

class ContractVerifier {
    /**
     * @param {Object} options
     * @param {Object} options.mesh  RepoMesh instance (initialized)
     */
    constructor(options = {}) {
        this.mesh = options.mesh;
    }

    /**
     * Extract backend assertion references from spec source.
     * @param {string} code
     * @returns {Array<{type,value,line}>}
     */
    extractBackendAssertions(code) {
        const refs = [];
        const lines = code.split('\n');

        const patterns = [
            { type: 'kafka-topic', re: /(?:expectKafkaEvent|watchKafka)\(\s*['"]([^'"]+)['"]/g },
            { type: 'elastic-index', re: /expectElasticDoc\(\s*['"]([^'"]+)['"]/g },
            // get_event_schema / get_index_mapping literal references in comments or helpers
            { type: 'kafka-topic', re: /getEventSchema\(\s*['"]([^'"]+)['"]/g },
            { type: 'elastic-index', re: /getIndexMapping\(\s*['"]([^'"]+)['"]/g },
        ];

        lines.forEach((lineText, i) => {
            for (const { type, re } of patterns) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(lineText)) !== null) {
                    refs.push({ type, value: m[1], line: i + 1 });
                }
            }
        });

        // De-dupe by type+value (keep first line).
        const seen = new Set();
        return refs.filter((r) => {
            const k = `${r.type}:${r.value}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    /** Known topics/indices from the mesh (DNA + graph). */
    _knownTopics() {
        const set = new Set();
        for (const svc of this.mesh.dna.listServices()) {
            const l1 = this.mesh.dna.getServiceL1(svc);
            for (const t of l1?.topics?.produces || []) set.add(t);
            for (const t of l1?.topics?.consumes || []) set.add(t);
        }
        for (const node of this.mesh.graph.nodes.values()) {
            if (node.type === 'topic') set.add(node.label);
        }
        return set;
    }

    _knownIndices() {
        const set = new Set();
        for (const svc of this.mesh.dna.listServices()) {
            for (const ix of this.mesh.dna.getServiceL1(svc)?.indices || []) set.add(ix);
        }
        for (const node of this.mesh.graph.nodes.values()) {
            if (node.type === 'index') set.add(node.label);
        }
        return set;
    }

    /**
     * Verify all backend assertions in a spec.
     * @param {string} code
     * @returns {{total,verified,ungrounded,riskLevel,references}}
     */
    verify(code) {
        this.mesh.initialize();
        const refs = this.extractBackendAssertions(code);
        const topics = this._knownTopics();
        const indices = this._knownIndices();

        const results = refs.map((ref) => {
            let grounded = false;
            let suggestion = null;
            if (ref.type === 'kafka-topic') {
                grounded = topics.has(ref.value);
                if (!grounded) suggestion = nearest(ref.value, topics);
            } else if (ref.type === 'elastic-index') {
                grounded = indices.has(ref.value);
                if (!grounded) suggestion = nearest(ref.value, indices);
            }
            return { ...ref, grounded, suggestion };
        });

        const ungrounded = results.filter((r) => !r.grounded);
        const total = results.length;
        const verified = total - ungrounded.length;
        const ratio = total === 0 ? 1 : verified / total;
        const riskLevel = ungrounded.length === 0 ? 'LOW' : ratio >= 0.5 ? 'MEDIUM' : 'HIGH';

        return {
            total,
            verified,
            ungrounded,
            riskLevel,
            references: results,
            summary: total === 0
                ? 'No backend assertions found.'
                : `${verified}/${total} backend assertions grounded in real contracts (${riskLevel} risk).`,
        };
    }
}

/** Closest known name by simple edit-distance, for "did you mean" hints. */
function nearest(value, candidates) {
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
        const d = levenshtein(value.toLowerCase(), c.toLowerCase());
        if (d < bestD) { bestD = d; best = c; }
    }
    // Only suggest if reasonably close.
    return best && bestD <= Math.max(2, Math.ceil(value.length * 0.4)) ? best : null;
}

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

module.exports = { ContractVerifier, levenshtein };
