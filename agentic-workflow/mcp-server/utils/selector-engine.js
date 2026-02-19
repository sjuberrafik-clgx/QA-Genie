/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * UNIQUE SELECTOR ENGINE (USE) — Single Source of Truth for Selector Generation
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The central algorithm that replaces ALL fragmented selector logic across the codebase.
 * Every consumer (bridge click/type/hover, script generator, exploration runner) delegates
 * to this engine for consistent, ranked, uniqueness-validated selectors.
 *
 * Architecture:
 *   1. Capture   — enriched DOM walker feeds element fingerprints
 *   2. Score     — each candidate selector is scored on stability + uniqueness
 *   3. Validate  — live `querySelectorAll` count confirms match === 1
 *   4. Compose   — if no single attr is unique, build chained / filtered selectors
 *   5. Emit      — winning selector goes into exploration data & generated scripts
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// DYNAMIC PATTERN DETECTORS
// ---------------------------------------------------------------------------

/**
 * Detect auto-generated / unstable HTML IDs that should NOT be used as selectors.
 * Returns true if the ID looks dynamic and will change across page loads.
 */
function isDynamicId(id) {
    if (!id || typeof id !== 'string') return true;

    // UUID pattern  (e.g. "550e8400-e29b-41d4-a716-446655440000")
    if (/[0-9a-f]{8}-[0-9a-f]{4}/.test(id)) return true;

    // React/Next.js auto-IDs  (":r0:", ":r1a:", "__next-xxx")
    if (/^:r[0-9a-z]+:/.test(id) || /^__next/.test(id)) return true;

    // MUI / CSS-in-JS generated  ("mui-12345", "css-a1b2c3", "jss-xxxxx")
    if (/^(mui|css|jss|sc)-[a-z0-9]{4,}/i.test(id)) return true;

    // Radix UI ids  ("radix-:r0:")
    if (/^radix-/.test(id)) return true;

    // Heavily numeric — more digits than alpha chars
    const digits = (id.match(/\d/g) || []).length;
    const alphas = (id.match(/[a-zA-Z]/g) || []).length;
    if (digits > 4 && digits > alphas) return true;

    // Hex-hash suffix  ("component-3af2c1e")
    if (/[a-f0-9]{6,}$/i.test(id) && id.length > 10) return true;

    return false;
}

/**
 * Detect text content that changes across runs (dates, counts, prices, etc.).
 * Returns true if the text is unstable.
 */
function isDynamicText(text) {
    if (!text || typeof text !== 'string') return true;
    if (text.length > 200) return true; // Too long to be a stable selector

    // Date/time patterns
    if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(text)) return true;
    if (/\d{1,2}:\d{2}(:\d{2})?/.test(text)) return true;

    // Relative time
    if (/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.test(text)) return true;
    if (/just now|a moment ago/i.test(text)) return true;

    // Prices
    if (/\$[\d,]+(\.\d{2})?/.test(text)) return true;

    // Counts / metrics
    if (/\d+\s+(results?|items?|listings?|properties|matches|records)/i.test(text)) return true;
    if (/showing\s+\d+/i.test(text)) return true;
    if (/page\s+\d+\s+of\s+\d+/i.test(text)) return true;

    return false;
}

/**
 * Extract the stable portion of dynamic text for regex-based matching.
 * e.g. "Showing 42 results for homes" → "results for homes"
 */
function extractStableTextPortion(text) {
    if (!text) return null;

    // Remove leading/trailing numbers and whitespace
    let stable = text
        .replace(/^\d[\d,]*\s*/g, '')          // leading numbers
        .replace(/\s*\d[\d,]*$/g, '')          // trailing numbers
        .replace(/\$[\d,]+(\.\d{2})?/g, '')    // prices
        .replace(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g, '') // dates
        .replace(/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago/gi, '')
        .trim();

    // Need at least 3 meaningful chars to be useful
    return stable.length >= 3 ? stable : null;
}


// ---------------------------------------------------------------------------
// SELECTOR CANDIDATE GENERATORS
// ---------------------------------------------------------------------------

/**
 * Generate ALL possible selector candidates for an element, each with a stability score.
 * Does NOT filter by uniqueness yet — that happens in the scoring/validation step.
 *
 * @param {Object} element - Enriched element data from snapshot DOM walker
 * @returns {Array<{type: string, selector: string, locator: string, score: number, cssSelector: string}>}
 */
function generateCandidates(element) {
    const candidates = [];
    const e = element;

    // -- Rank 1: Test IDs (most stable — explicitly added for automation) --
    if (e.dataTestId) {
        candidates.push({
            type: 'testId',
            selector: `[data-testid="${e.dataTestId}"]`,
            locator: `page.getByTestId('${esc(e.dataTestId)}')`,
            cssSelector: `[data-testid="${e.dataTestId}"]`,
            score: 10,
            strategy: 'data-testid',
        });
    }

    // Also check data-test-id and data-qa variants if stored separately
    if (e.dataTestIdAlt) {
        candidates.push({
            type: 'testId',
            selector: `[data-test-id="${e.dataTestIdAlt}"]`,
            locator: `page.locator('[data-test-id="${esc(e.dataTestIdAlt)}"]')`,
            cssSelector: `[data-test-id="${e.dataTestIdAlt}"]`,
            score: 10,
            strategy: 'data-test-id',
        });
    }
    if (e.dataQa) {
        candidates.push({
            type: 'testId',
            selector: `[data-qa="${e.dataQa}"]`,
            locator: `page.locator('[data-qa="${esc(e.dataQa)}"]')`,
            cssSelector: `[data-qa="${e.dataQa}"]`,
            score: 10,
            strategy: 'data-qa',
        });
    }

    // -- Rank 2: Role + Accessible Name (semantic, Playwright-recommended) --
    if (e.role && e.computedLabel && !isDynamicText(e.computedLabel)) {
        const roleName = mapAriaRole(e.role, e.tag);
        if (roleName && roleName !== 'generic') {
            candidates.push({
                type: 'role+name',
                selector: `role=${roleName}[name="${e.computedLabel}"]`,
                locator: `page.getByRole('${roleName}', { name: '${esc(e.computedLabel)}' })`,
                cssSelector: `[role="${roleName}"][aria-label="${e.computedLabel}"]`,
                score: 9,
                strategy: 'role+name',
            });
        }
    }

    // -- Rank 3: Stable HTML ID --
    if (e.id && !isDynamicId(e.id)) {
        candidates.push({
            type: 'id',
            selector: `#${e.id}`,
            locator: `page.locator('#${esc(e.id)}')`,
            cssSelector: `#${e.id}`,
            score: 8,
            strategy: 'id',
        });
    }

    // -- Rank 4: Role + Name (regex, for partially dynamic text) --
    if (e.role && e.computedLabel && isDynamicText(e.computedLabel)) {
        const stablePart = extractStableTextPortion(e.computedLabel);
        const roleName = mapAriaRole(e.role, e.tag);
        if (stablePart && roleName && roleName !== 'generic') {
            candidates.push({
                type: 'role+name-regex',
                selector: `role=${roleName}[name*="${stablePart}"]`,
                locator: `page.getByRole('${roleName}', { name: /${escRegex(stablePart)}/i })`,
                cssSelector: null, // regex locator has no pure CSS equivalent
                score: 7,
                strategy: 'role+name-regex',
            });
        }
    }

    // -- Rank 5: ARIA Label --
    if (e.ariaLabel && !isDynamicText(e.ariaLabel)) {
        candidates.push({
            type: 'ariaLabel',
            selector: `[aria-label="${e.ariaLabel}"]`,
            locator: `page.locator('[aria-label="${esc(e.ariaLabel)}"]')`,
            cssSelector: `[aria-label="${e.ariaLabel}"]`,
            score: 7,
            strategy: 'aria-label',
        });
    }

    // -- Rank 6: Label (for inputs) --
    if (e.associatedLabel && !isDynamicText(e.associatedLabel)) {
        candidates.push({
            type: 'label',
            selector: `label:has-text("${e.associatedLabel}") + ${e.tag}`,
            locator: `page.getByLabel('${esc(e.associatedLabel)}')`,
            cssSelector: null,
            score: 6,
            strategy: 'label',
        });
    }

    // -- Rank 7: Placeholder --
    if (e.placeholder && !isDynamicText(e.placeholder)) {
        candidates.push({
            type: 'placeholder',
            selector: `[placeholder="${e.placeholder}"]`,
            locator: `page.getByPlaceholder('${esc(e.placeholder)}')`,
            cssSelector: `[placeholder="${e.placeholder}"]`,
            score: 6,
            strategy: 'placeholder',
        });
    }

    // -- Rank 8: Alt text (images) --
    if (e.alt && !isDynamicText(e.alt)) {
        candidates.push({
            type: 'alt',
            selector: `[alt="${e.alt}"]`,
            locator: `page.getByAltText('${esc(e.alt)}')`,
            cssSelector: `[alt="${e.alt}"]`,
            score: 6,
            strategy: 'alt-text',
        });
    }

    // -- Rank 9: Title attribute --
    if (e.title && !isDynamicText(e.title)) {
        candidates.push({
            type: 'title',
            selector: `[title="${e.title}"]`,
            locator: `page.getByTitle('${esc(e.title)}')`,
            cssSelector: `[title="${e.title}"]`,
            score: 5,
            strategy: 'title',
        });
    }

    // -- Rank 10: Name attribute (for form elements) --
    if (e.name) {
        candidates.push({
            type: 'name',
            selector: `[name="${e.name}"]`,
            locator: `page.locator('[name="${esc(e.name)}"]')`,
            cssSelector: `[name="${e.name}"]`,
            score: 5,
            strategy: 'name-attr',
        });
    }

    // -- Rank 11: Stable text content --
    if (e.text && e.text.length > 0 && e.text.length <= 80 && !isDynamicText(e.text)) {
        candidates.push({
            type: 'text',
            selector: `text="${e.text}"`,
            locator: `page.getByText('${esc(e.text)}', { exact: true })`,
            cssSelector: null,
            score: 4,
            strategy: 'text-content',
        });
    }

    // -- Rank 12: Href for links --
    if (e.href && e.tag === 'a') {
        // Use only the pathname to avoid domain differences across envs
        try {
            const pathname = new URL(e.href).pathname;
            if (pathname && pathname !== '/' && pathname.length < 100) {
                candidates.push({
                    type: 'href',
                    selector: `a[href*="${pathname}"]`,
                    locator: `page.locator('a[href*="${esc(pathname)}"]')`,
                    cssSelector: `a[href*="${pathname}"]`,
                    score: 3,
                    strategy: 'href-path',
                });
            }
        } catch {
            // relative href or invalid URL — use as-is if short enough
            if (e.href.length < 100 && !e.href.startsWith('javascript:')) {
                candidates.push({
                    type: 'href',
                    selector: `a[href="${e.href}"]`,
                    locator: `page.locator('a[href="${esc(e.href)}"]')`,
                    cssSelector: `a[href="${e.href}"]`,
                    score: 3,
                    strategy: 'href',
                });
            }
        }
    }

    return candidates;
}


// ---------------------------------------------------------------------------
// COMPOSITE / CHAINED SELECTOR BUILDERS
// ---------------------------------------------------------------------------

/**
 * Build a scoped (chained) selector using a parent element as context.
 * e.g. page.locator('[data-testid="search-panel"]').getByRole('button', { name: 'Search' })
 *
 * @param {Object} element - Target element with parentRef
 * @param {Object} parentElement - Parent element with its own resolved selector
 * @param {Object} bestCandidate - The best (but non-unique) candidate for the target
 * @returns {Object|null} Composite selector or null if cannot build
 */
function buildCompositeSelector(element, parentElement, bestCandidate) {
    if (!parentElement || !bestCandidate) return null;

    // Find the best unique selector for the parent
    const parentCandidates = generateCandidates(parentElement);
    const parentBest = parentCandidates.find(c => c.score >= 5); // Need a reasonably stable parent
    if (!parentBest) return null;

    return {
        type: 'composite',
        locator: `${parentBest.locator}.locator('${bestCandidate.cssSelector || bestCandidate.selector}')`,
        locatorChained: `${parentBest.locator}.${bestCandidate.locator.replace('page.', '')}`,
        score: Math.min(parentBest.score, bestCandidate.score) - 1, // Slightly lower than components
        strategy: `composite:${parentBest.strategy}>${bestCandidate.strategy}`,
        isComposite: true,
    };
}

/**
 * Build a filter-refined selector.
 * e.g. page.getByRole('button').filter({ hasText: 'Submit' })
 *
 * @param {Object} element - Target element
 * @param {Object} bestCandidate - Best non-unique candidate
 * @returns {Object|null}
 */
function buildFilteredSelector(element, bestCandidate) {
    if (!bestCandidate || !element.text) return null;

    const filterText = element.text.substring(0, 60);
    if (isDynamicText(filterText)) return null;

    return {
        type: 'filtered',
        locator: `${bestCandidate.locator}.filter({ hasText: '${esc(filterText)}' })`,
        score: bestCandidate.score - 1,
        strategy: `filtered:${bestCandidate.strategy}+text`,
        isFiltered: true,
    };
}

/**
 * Build an nth-index selector (last resort for disambiguation).
 * e.g. page.getByRole('button', { name: 'Save' }).nth(0)
 *
 * @param {Object} bestCandidate - Best non-unique candidate
 * @param {number} nthIndex - 0-based position among matches
 * @returns {Object}
 */
function buildNthSelector(bestCandidate, nthIndex) {
    return {
        type: 'nth',
        locator: `${bestCandidate.locator}.nth(${nthIndex})`,
        score: Math.max(1, bestCandidate.score - 3),
        strategy: `nth:${bestCandidate.strategy}[${nthIndex}]`,
        isNth: true,
    };
}


// ---------------------------------------------------------------------------
// THE CORE ALGORITHM — generateUniqueSelector()
// ---------------------------------------------------------------------------

/**
 * Generate the best unique Playwright selector for an element.
 *
 * @param {Object} element - Enriched element from snapshot DOM walker
 * @param {Object} matchCounts - Map of { candidateSelector: numberOfDOMMatches }
 * @param {Object} [options] - Optional config
 * @param {Map} [options.allElements] - All elements in the snapshot (for composite building)
 * @returns {{
 *   primary: string,       // Best Playwright locator string  (e.g. "page.getByRole('button', { name: 'Search' })")
 *   fallback: string|null, // Second-best option
 *   composite: string|null,// Parent-scoped option (if primary isn't unique)
 *   strategy: string,      // Strategy name used
 *   stabilityScore: number, // 1-10 stability rating
 *   isUnique: boolean,     // Whether primary matches exactly 1 element
 *   matchCount: number,    // How many DOM elements the primary selector matches
 *   cssSelector: string|null // Pure CSS selector for bridge operations
 * }}
 */
function generateUniqueSelector(element, matchCounts = {}, options = {}) {
    const candidates = generateCandidates(element);

    if (candidates.length === 0) {
        // Absolute fallback — tag + nth (should be extremely rare)
        return {
            primary: `page.locator('${element.tag || 'div'}').nth(${element.nthIndex || 0})`,
            fallback: null,
            composite: null,
            strategy: 'tag-nth-fallback',
            stabilityScore: 1,
            isUnique: false,
            matchCount: -1,
            cssSelector: element.tag || 'div',
        };
    }

    // Sort candidates by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Find the best UNIQUE candidate (matchCount === 1)
    let primaryCandidate = null;
    let fallbackCandidate = null;

    for (const candidate of candidates) {
        const count = matchCounts[candidate.selector] ?? matchCounts[candidate.cssSelector] ?? -1;
        candidate.matchCount = count;
        candidate.isUnique = count === 1;

        if (candidate.isUnique && !primaryCandidate) {
            primaryCandidate = candidate;
        } else if (!fallbackCandidate && candidate !== primaryCandidate) {
            fallbackCandidate = candidate;
        }

        if (primaryCandidate && fallbackCandidate) break;
    }

    // If no unique single-attribute candidate, try composite strategies
    let compositeCandidate = null;
    if (!primaryCandidate) {
        const bestNonUnique = candidates[0]; // highest scored, even if not unique

        // Strategy A: Parent scoping
        if (options.allElements && element.parentRef) {
            const parentElement = options.allElements.get(element.parentRef);
            if (parentElement) {
                compositeCandidate = buildCompositeSelector(element, parentElement, bestNonUnique);
            }
        }

        // Strategy B: Filter refinement
        if (!compositeCandidate) {
            compositeCandidate = buildFilteredSelector(element, bestNonUnique);
        }

        // Strategy C: nth() indexing (last resort)
        if (!compositeCandidate && element.nthIndex !== undefined) {
            compositeCandidate = buildNthSelector(bestNonUnique, element.nthIndex);
        }

        // Use composite as primary if no single-attr is unique
        if (compositeCandidate) {
            primaryCandidate = compositeCandidate;
            fallbackCandidate = bestNonUnique;
        } else {
            // Give up on uniqueness — use the highest-scored candidate anyway
            primaryCandidate = bestNonUnique;
        }
    }

    return {
        primary: primaryCandidate.locator || primaryCandidate.locatorChained,
        fallback: fallbackCandidate ? fallbackCandidate.locator : null,
        composite: compositeCandidate ? (compositeCandidate.locatorChained || compositeCandidate.locator) : null,
        strategy: primaryCandidate.strategy,
        stabilityScore: primaryCandidate.score,
        isUnique: primaryCandidate.isUnique ?? (primaryCandidate.matchCount === 1),
        matchCount: primaryCandidate.matchCount ?? -1,
        cssSelector: primaryCandidate.cssSelector || (candidates[0] ? candidates[0].cssSelector : null),
    };
}


// ---------------------------------------------------------------------------
// BRIDGE-LEVEL SELECTOR RESOLUTION (for click/type/hover at runtime)
// ---------------------------------------------------------------------------

/**
 * Resolve a CSS selector for bridge operations (click, type, hover, etc.).
 * This replaces the old inline ternary chains in _resolveSelector / click / type / hover.
 *
 * Returns a simple CSS string (not a Playwright locator) suitable for page.click(selector).
 *
 * @param {Object} refData - Element data from snapshotRefs
 * @returns {string} CSS selector
 */
function resolveCssSelector(refData) {
    if (!refData) return null;

    // Priority 1: Test IDs
    if (refData.dataTestId) return `[data-testid="${refData.dataTestId}"]`;

    // Priority 2: Stable HTML ID
    if (refData.id && !isDynamicId(refData.id)) return `#${refData.id}`;

    // Priority 3: ARIA label
    if (refData.ariaLabel) return `[aria-label="${refData.ariaLabel}"]`;

    // Priority 4: Name attribute
    if (refData.name) return `[name="${refData.name}"]`;

    // Priority 5: Placeholder
    if (refData.placeholder) return `[placeholder="${refData.placeholder}"]`;

    // Priority 6: Title
    if (refData.title) return `[title="${refData.title}"]`;

    // Priority 7: Stable text
    if (refData.text && refData.text.length <= 80 && !isDynamicText(refData.text)) {
        return `text="${refData.text}"`;
    }

    // Priority 8: Tag + role combination (less stable but better than bare tag)
    if (refData.role && refData.tag) return `${refData.tag}[role="${refData.role}"]`;

    // Priority 9: Tag only (fragile — last resort for CSS)
    if (refData.tag) return refData.tag;

    return null;
}


// ---------------------------------------------------------------------------
// UNIQUENESS VALIDATION (runs inside page.evaluate at snapshot time)
// ---------------------------------------------------------------------------

/**
 * Generate the JavaScript code that runs inside page.evaluate() to count
 * how many DOM elements match each candidate CSS selector.
 *
 * This is injected into the page during the enriched snapshot pass.
 *
 * @param {Array<Object>} elements - All captured elements with their candidate selectors
 * @returns {string} JavaScript code string for page.evaluate()
 */
function generateUniquenessValidationScript(elements) {
    // Build a map of selectorString → true for all candidates we want to validate
    const selectorsToCheck = new Set();

    for (const el of elements) {
        const candidates = generateCandidates(el);
        for (const c of candidates) {
            if (c.cssSelector) {
                selectorsToCheck.add(c.cssSelector);
            }
        }
    }

    return `
        (function() {
            const selectors = ${JSON.stringify([...selectorsToCheck])};
            const counts = {};
            for (const sel of selectors) {
                try {
                    counts[sel] = document.querySelectorAll(sel).length;
                } catch(e) {
                    counts[sel] = -1; // invalid selector
                }
            }
            return counts;
        })()
    `;
}


// ---------------------------------------------------------------------------
// ARIA ROLE MAPPING HELPERS
// ---------------------------------------------------------------------------

/**
 * Map HTML tag + explicit role to the ARIA role Playwright expects.
 * Handles implicit roles (e.g. <a> → link, <button> → button).
 */
function mapAriaRole(explicitRole, tag) {
    if (explicitRole && explicitRole !== 'presentation' && explicitRole !== 'none') {
        return explicitRole;
    }

    // Implicit roles by tag
    const implicitRoles = {
        a: 'link',
        button: 'button',
        input: 'textbox',       // refined further by type in the DOM walker
        select: 'combobox',
        textarea: 'textbox',
        img: 'img',
        nav: 'navigation',
        main: 'main',
        header: 'banner',
        footer: 'contentinfo',
        aside: 'complementary',
        form: 'form',
        table: 'table',
        tr: 'row',
        th: 'columnheader',
        td: 'cell',
        ul: 'list',
        ol: 'list',
        li: 'listitem',
        h1: 'heading',
        h2: 'heading',
        h3: 'heading',
        h4: 'heading',
        h5: 'heading',
        h6: 'heading',
        dialog: 'dialog',
        details: 'group',
        summary: 'button',
        progress: 'progressbar',
        meter: 'meter',
        output: 'status',
    };

    return implicitRoles[tag] || null;
}


// ---------------------------------------------------------------------------
// ENRICHED SNAPSHOT ELEMENT BUILDER
// ---------------------------------------------------------------------------

/**
 * Build the enriched element fingerprint from raw DOM node data.
 * Called inside page.evaluate() during snapshot capture.
 * Returns a flat object with all attributes the selector engine needs.
 *
 * This is the JS source that runs IN THE BROWSER during snapshot.
 */
const ENRICHED_DOM_WALKER_SOURCE = `
(function() {
    const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];
    const interactiveRoles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem', 'tab', 'combobox', 'option', 'switch', 'slider', 'spinbutton', 'searchbox'];
    const refs = [];
    const counter = { value: 0 };
    const refMap = {};  // nodeIndex → ref  (for parentRef lookback)

    function walk(node, parentRef) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName;
        const tagLower = tag.toLowerCase();
        const role = node.getAttribute('role');
        const isInteractive = interactiveTags.includes(tag) ||
            interactiveRoles.includes(role) ||
            node.onclick != null ||
            node.hasAttribute('onclick') ||
            (node.tabIndex >= 0 && node.tabIndex !== -1);

        // Capture if interactive OR has identifying attributes
        const hasId = !!node.id;
        const hasTestId = node.hasAttribute('data-testid') || node.hasAttribute('data-test-id') || node.hasAttribute('data-qa');
        const hasAriaLabel = node.hasAttribute('aria-label');

        if (isInteractive || hasId || hasTestId || hasAriaLabel || role) {
            const ref = 's1e' + (++counter.value);
            const rect = node.getBoundingClientRect();

            // Compute the best accessible label
            const ariaLabel = node.getAttribute('aria-label') || undefined;
            const placeholder = node.placeholder || undefined;
            const title = node.getAttribute('title') || undefined;
            const alt = node.getAttribute('alt') || undefined;
            const text = (node.innerText || node.value || '').substring(0, 500).trim() || undefined;
            const textShort = text ? text.substring(0, 100) : undefined;
            const computedLabel = ariaLabel || placeholder || title || alt || textShort || undefined;

            // Get associated label for form elements
            let associatedLabel = undefined;
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
                if (node.id) {
                    const labelEl = document.querySelector('label[for="' + node.id + '"]');
                    if (labelEl) associatedLabel = labelEl.innerText.trim().substring(0, 100);
                }
                if (!associatedLabel && node.closest('label')) {
                    associatedLabel = node.closest('label').innerText.trim().substring(0, 100);
                }
            }

            // Compute nthIndex — position among siblings with same tag+role
            let nthIndex = 0;
            if (node.parentElement) {
                const siblings = Array.from(node.parentElement.children);
                const sameKind = siblings.filter(s =>
                    s.tagName === tag && (s.getAttribute('role') || '') === (role || '')
                );
                nthIndex = sameKind.indexOf(node);
            }

            // Input type refinement
            let inputType = undefined;
            if (tag === 'INPUT') {
                inputType = node.type || 'text';
            }

            const element = {
                ref,
                tag: tagLower,
                role: role || undefined,
                text: textShort,
                textFull: text,
                id: node.id || undefined,
                name: node.getAttribute('name') || undefined,
                className: typeof node.className === 'string' ? node.className : undefined,
                type: node.type || undefined,
                inputType,
                href: node.href || undefined,
                placeholder,
                ariaLabel,
                ariaDescribedBy: node.getAttribute('aria-describedby') || undefined,
                ariaRoleDescription: node.getAttribute('aria-roledescription') || undefined,
                title,
                alt,
                computedLabel,
                associatedLabel,
                dataTestId: node.getAttribute('data-testid') || undefined,
                dataTestIdAlt: node.getAttribute('data-test-id') || undefined,
                dataQa: node.getAttribute('data-qa') || undefined,
                visible: rect.width > 0 && rect.height > 0,
                bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
                nthIndex,
                parentRef: parentRef || undefined,
                isInteractive,
            };

            refs.push(element);
            refMap[counter.value] = ref;

            // Children use this element's ref as parentRef
            for (const child of node.children) {
                walk(child, ref);
            }
        } else {
            // Non-captured element — pass through parentRef unchanged
            for (const child of node.children) {
                walk(child, parentRef);
            }
        }
    }

    walk(document.body, null);
    return refs;
})()
`;


// ---------------------------------------------------------------------------
// STRING HELPERS
// ---------------------------------------------------------------------------

/** Escape single quotes for Playwright locator strings */
function esc(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Escape special regex chars */
function escRegex(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * The SelectorEngine — main public interface.
 * Import this object and call its methods.
 */
const SelectorEngine = {
    /**
     * Core algorithm: generate the best unique selector for an element.
     * @see generateUniqueSelector for full JSDoc
     */
    generateUniqueSelector,

    /**
     * Resolve a CSS selector from snapshot ref data (for bridge click/type/hover).
     * @see resolveCssSelector
     */
    resolveCssSelector,

    /**
     * Generate all candidate selectors for an element (for debugging/inspection).
     * @see generateCandidates
     */
    generateCandidates,

    /**
     * Build a composite (parent-scoped) selector.
     * @see buildCompositeSelector
     */
    buildCompositeSelector,

    /**
     * Build a filter-refined selector.
     * @see buildFilteredSelector
     */
    buildFilteredSelector,

    /**
     * Build an nth-index selector.
     * @see buildNthSelector
     */
    buildNthSelector,

    /**
     * Get the JS source code for the enriched DOM walker.
     * Run this via page.evaluate() during snapshot capture.
     */
    getEnrichedDomWalkerSource() {
        return ENRICHED_DOM_WALKER_SOURCE;
    },

    /**
     * Get the JS code for uniqueness validation.
     * Run via page.evaluate() AFTER the DOM walker.
     * @param {Array} elements - Elements returned by the DOM walker
     * @returns {string} JS code string
     */
    getUniquenessValidationScript(elements) {
        return generateUniquenessValidationScript(elements);
    },

    /**
     * Process all snapshot elements: generate + score + validate selectors.
     * This is the main entry point called after snapshot capture.
     *
     * @param {Array} elements - Raw elements from enriched DOM walker
     * @param {Object} matchCounts - Uniqueness counts from validation script
     * @returns {Array} Elements enriched with .selector property
     */
    processSnapshotElements(elements, matchCounts = {}) {
        // Build allElements map for composite selector building
        const allElements = new Map();
        for (const el of elements) {
            allElements.set(el.ref, el);
        }

        return elements.map(el => {
            const selectorResult = generateUniqueSelector(el, matchCounts, { allElements });
            return {
                ...el,
                selector: selectorResult,
            };
        });
    },

    /**
     * Detect if an HTML ID is auto-generated / dynamic.
     */
    isDynamicId,

    /**
     * Detect if text content is unstable across runs.
     */
    isDynamicText,

    /**
     * Map tag/role to ARIA role name.
     */
    mapAriaRole,
};


// ---------------------------------------------------------------------------
// EXPORTS — ESM (mcp-server uses "type": "module")
// ---------------------------------------------------------------------------

export { SelectorEngine };
export default SelectorEngine;
