'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · SEE — affordance-first perception orchestrator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   see(page) → one in-page pass (extract) → score (salience, novelty vs baseline)
 *             → cluster + budget (pack) → durable handles + audit.
 *
 * Output is a pure function of (DOM, viewport, baseline, budget): the same page
 * yields byte-identical perception, enabling caching, reproducible QA, and diffs.
 * The baseline (structural-hash set from the previous see()) lives in session
 * memory — no disk, no workspace coupling.
 *
 * @module glass-mcp/perception/see
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { glassExtract } = require('./extract');
const { scoreAll } = require('./salience');
const { pack } = require('./pack');

class Perceiver {
    constructor(opts = {}) {
        this.baseline = new Set();
        this.tokenBudget = opts.tokenBudget || 1500;
        this.maxElements = opts.maxElements || 1500;
    }

    resetBaseline() {
        this.baseline = new Set();
    }

    /**
     * Perceive the page (or a Playwright Page/Frame) as a ranked affordance menu.
     * @param {import('playwright').Page} page
     * @param {{tokenBudget?:number, maxElements?:number, keepBaseline?:boolean}} [opts]
     */
    async see(page, opts = {}) {
        const t0 = Date.now();
        const { candidates, stats } = await page.evaluate(glassExtract, {
            maxElements: opts.maxElements || this.maxElements,
        });

        const baseline = this.baseline;
        scoreAll(candidates, baseline);
        const novelVsBaseline = baseline.size
            ? candidates.reduce((n, c) => n + (baseline.has(c.sph) ? 0 : 1), 0)
            : 0;

        const { affordances, budget } = pack(candidates, {
            tokenBudget: opts.tokenBudget || this.tokenBudget,
        });

        // Advance the baseline to this pass (unless the caller wants to keep it).
        if (!opts.keepBaseline) this.baseline = new Set(candidates.map((c) => c.sph));

        return {
            url: stats.url,
            title: stats.title,
            budget: {
                tokens: budget.tokens,
                used: budget.used,
                elementsConsidered: stats.considered,
                returned: affordances.length,
                clusters: budget.clusters,
                truncated: stats.truncated,
            },
            affordances,
            audit: {
                pass: 'single',
                ms: Date.now() - t0,
                elementsConsidered: stats.considered,
                returned: affordances.length,
                novelVsBaseline,
                visionUsed: false,
            },
        };
    }
}

module.exports = { Perceiver };
