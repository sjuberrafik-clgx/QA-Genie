/**
 * Sort utilities for test report suite/spec ordering.
 * Mirrors Allure's "Sort by: Order Earliest" functionality.
 */

export const SORT_OPTIONS = [
    { value: 'order-earliest', label: 'Order Earliest' },
    { value: 'order-latest', label: 'Order Latest' },
    { value: 'duration-desc', label: 'Duration (longest)' },
    { value: 'duration-asc', label: 'Duration (shortest)' },
    { value: 'name-asc', label: 'Name A\u2013Z' },
    { value: 'name-desc', label: 'Name Z\u2013A' },
    { value: 'status', label: 'Status' },
];

/**
 * Apply sort to a flat array of specs.
 */
export function sortSpecs(specs, sortMode) {
    const sorted = [...specs];
    switch (sortMode) {
        case 'order-latest':
            sorted.reverse();
            break;
        case 'duration-desc':
            sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
            break;
        case 'duration-asc':
            sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
            break;
        case 'name-asc':
            sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
        case 'name-desc':
            sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
            break;
        case 'status': {
            const order = { failed: 0, broken: 1, skipped: 2, passed: 3, unknown: 4 };
            sorted.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
            break;
        }
        default: // order-earliest — keep original
            break;
    }
    return sorted;
}

/**
 * Apply sort to suites (sorts by total spec count).
 */
export function sortSuites(suites, sortMode) {
    const sorted = [...suites];
    const countSpecs = (suite) => {
        let c = suite.specs?.length || 0;
        for (const sub of (suite.suites || [])) c += countSpecs(sub);
        return c;
    };
    switch (sortMode) {
        case 'order-latest':
            sorted.reverse();
            break;
        case 'duration-desc':
        case 'duration-asc': {
            const dur = (suite) => (suite.specs || []).reduce((a, s) => a + (s.duration || 0), 0);
            sorted.sort((a, b) => sortMode === 'duration-desc' ? dur(b) - dur(a) : dur(a) - dur(b));
            break;
        }
        case 'name-asc':
            sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
        case 'name-desc':
            sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
            break;
        case 'status': {
            // Suites with failures first
            const score = (suite) => {
                const specs = suite.specs || [];
                if (specs.some(s => s.status === 'failed')) return 0;
                if (specs.some(s => s.status === 'broken')) return 1;
                return 2;
            };
            sorted.sort((a, b) => score(a) - score(b));
            break;
        }
        default:
            break;
    }
    return sorted;
}
