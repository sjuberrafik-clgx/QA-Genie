/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * EXPLORATION TEMPLATES — Pre-built scripts for unified_execute_exploration
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Reusable, parameterized exploration scripts that agents can invoke by name
 * instead of writing raw JavaScript. Each template:
 *   - Validates its required arguments
 *   - Builds a script string ready for the programmatic executor
 *   - Follows security constraints (no require/import/process)
 *
 * Templates reduce LLM hallucination risk by providing tested, working patterns.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Template: explore_page
 *
 * Navigates to a URL, waits for load, takes a filtered snapshot,
 * extracts page info (URL, title), and returns everything.
 * This replaces 4 sequential tool calls with 1.
 */
const explorePage = {
    name: 'explore_page',
    description: 'Navigate to a URL and capture a full exploration snapshot (URL, title, filtered elements)',
    requiredArgs: ['url'],
    optionalArgs: ['filter', 'waitForSelector'],
    build(args) {
        const url = JSON.stringify(args.url || '');
        const filter = JSON.stringify(args.filter || { interactiveOnly: true });
        const waitSel = args.waitForSelector ? JSON.stringify(args.waitForSelector) : null;

        return `
            const nav = await tools.navigate({ url: ${url} });
            ${waitSel ? `await tools.wait_for_element({ selector: ${waitSel}, state: 'visible', timeout: 10000 });` : ''}
            const snap = await tools.snapshot({ filter: ${filter} });
            const url = await tools.get_page_url();
            const title = await tools.get_page_title();
            return { nav, url, title, elementCount: (snap.elements || []).length, elements: snap.elements };
        `;
    },
};

/**
 * Template: verify_elements
 *
 * Check visibility and enabled state of multiple selectors on the current page.
 * Returns a map of selector → { visible, enabled, text }.
 */
const verifyElements = {
    name: 'verify_elements',
    description: 'Verify visibility, enabled state, and text content of multiple selectors',
    requiredArgs: ['selectors'],
    optionalArgs: [],
    build(args) {
        const selectors = JSON.stringify(args.selectors || []);
        return `
            const selectors = ${selectors};
            const results = {};
            for (const sel of selectors) {
                try {
                    const visible = await tools.is_visible({ selector: sel });
                    const enabled = await tools.is_enabled({ selector: sel });
                    let text = null;
                    try { text = await tools.get_text_content({ selector: sel }); } catch {}
                    results[sel] = { visible, enabled, text, found: true };
                } catch (err) {
                    results[sel] = { visible: false, enabled: false, text: null, found: false, error: err.message };
                }
            }
            return results;
        `;
    },
};

/**
 * Template: login_and_navigate
 *
 * Navigate to the app URL (which typically includes an auth token),
 * wait for the page to load, dismiss any known popups, and take a snapshot.
 */
const loginAndNavigate = {
    name: 'login_and_navigate',
    description: 'Navigate to auth-token URL, wait for load, take initial exploration snapshot',
    requiredArgs: ['url'],
    optionalArgs: ['waitForSelector', 'filter'],
    build(args) {
        const url = JSON.stringify(args.url || '');
        const filter = JSON.stringify(args.filter || {});
        const waitSel = args.waitForSelector ? JSON.stringify(args.waitForSelector) : null;
        return `
            await tools.navigate({ url: ${url} });
            ${waitSel ? `await tools.wait_for_element({ selector: ${waitSel}, state: 'visible', timeout: 15000 });` : ''}
            const url = await tools.get_page_url();
            const title = await tools.get_page_title();
            const snap = await tools.snapshot(${filter !== '{}' ? `{ filter: ${filter} }` : '{}'});
            return { url, title, elements: snap.elements, elementCount: (snap.elements || []).length };
        `;
    },
};

/**
 * Template: extract_content
 *
 * Extract text content and attributes from multiple elements.
 * Useful for building assertion data without multiple round-trips.
 */
const extractContent = {
    name: 'extract_content',
    description: 'Extract text content and attributes from multiple selectors for assertion data',
    requiredArgs: ['targets'],
    optionalArgs: [],
    build(args) {
        // targets: Array<{ selector: string, attributes?: string[] }>
        const targets = JSON.stringify(args.targets || []);
        return `
            const targets = ${targets};
            const results = {};
            for (const target of targets) {
                const sel = target.selector;
                const entry = { text: null, attributes: {} };
                try {
                    entry.text = await tools.get_text_content({ selector: sel });
                    if (target.attributes) {
                        for (const attr of target.attributes) {
                            try {
                                entry.attributes[attr] = await tools.get_attribute({ selector: sel, attribute: attr });
                            } catch {}
                        }
                    }
                    entry.found = true;
                } catch (err) {
                    entry.found = false;
                    entry.error = err.message;
                }
                results[sel] = entry;
            }
            return results;
        `;
    },
};

/**
 * Template: interact_and_verify
 *
 * Perform an interaction (click, type, select) then verify the result
 * by taking a snapshot and checking element states.
 */
const interactAndVerify = {
    name: 'interact_and_verify',
    description: 'Perform an interaction then verify page state changed as expected',
    requiredArgs: ['action'],
    optionalArgs: ['verifySelectors', 'verifyUrl', 'filter'],
    build(args) {
        const action = args.action || {};
        const verifySelectors = JSON.stringify(args.verifySelectors || []);
        const verifyUrl = args.verifyUrl ? JSON.stringify(args.verifyUrl) : null;
        const filter = JSON.stringify(args.filter || { interactiveOnly: true });

        // Build the action call
        let actionCode = '';
        if (action.type === 'click') {
            actionCode = `await tools.click({ element: ${JSON.stringify(action.element || action.selector)} });`;
        } else if (action.type === 'type') {
            actionCode = `await tools.type({ element: ${JSON.stringify(action.element || action.selector)}, text: ${JSON.stringify(action.text || '')} });`;
        } else if (action.type === 'select') {
            actionCode = `await tools.select_option({ element: ${JSON.stringify(action.element || action.selector)}, value: ${JSON.stringify(action.value || '')} });`;
        } else if (action.type === 'fill_form') {
            actionCode = `await tools.fill_form({ values: ${JSON.stringify(action.values || [])} });`;
        }

        return `
            // Perform the action
            ${actionCode}

            // Wait for page to settle
            await tools.wait_for({ event: 'networkidle', timeout: 5000 }).catch(() => {});

            // Take post-action snapshot
            const snap = await tools.snapshot({ filter: ${filter} });
            const currentUrl = await tools.get_page_url();

            // Verify selectors if specified
            const verifySelectors = ${verifySelectors};
            const verifications = {};
            for (const sel of verifySelectors) {
                try {
                    verifications[sel] = {
                        visible: await tools.is_visible({ selector: sel }),
                        text: await tools.get_text_content({ selector: sel }).catch(() => null),
                    };
                } catch (err) {
                    verifications[sel] = { visible: false, error: err.message };
                }
            }

            return {
                action: ${JSON.stringify(action)},
                currentUrl,
                ${verifyUrl ? `urlMatch: currentUrl.includes(${verifyUrl}),` : ''}
                elements: snap.elements,
                elementCount: (snap.elements || []).length,
                verifications,
            };
        `;
    },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const TEMPLATES = {
    explore_page: explorePage,
    verify_elements: verifyElements,
    login_and_navigate: loginAndNavigate,
    extract_content: extractContent,
    interact_and_verify: interactAndVerify,
};

/**
 * Get all registered templates (for tools/list metadata).
 * @returns {Object} Map of template name → { name, description, requiredArgs, optionalArgs }
 */
export function getTemplateRegistry() {
    const registry = {};
    for (const [name, tmpl] of Object.entries(TEMPLATES)) {
        registry[name] = {
            name: tmpl.name,
            description: tmpl.description,
            requiredArgs: tmpl.requiredArgs,
            optionalArgs: tmpl.optionalArgs || [],
        };
    }
    return registry;
}

/**
 * Get the templates map for the programmatic executor.
 * @returns {Object} Map of templateName → { build(args) }
 */
export function getTemplates() {
    return TEMPLATES;
}
