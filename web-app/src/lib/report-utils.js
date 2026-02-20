/**
 * Shared report utilities — eliminates duplicate helper functions across
 * ConsolidatedReport, TestResultTree, and history/page.
 */

/**
 * Recursively count all specs in a suite tree.
 */
export function countAllSpecs(suite) {
    let c = suite.specs?.length || 0;
    for (const sub of (suite.suites || [])) c += countAllSpecs(sub);
    return c;
}

/**
 * Recursively filter a suite tree, keeping only specs that match filterFn.
 * Returns null when both specs and sub-suites are empty after filtering.
 */
export function filterSuiteTree(suite, filterFn) {
    const filteredSpecs = (suite.specs || []).filter(filterFn);
    const filteredSubs = (suite.suites || [])
        .map(sub => filterSuiteTree(sub, filterFn))
        .filter(sub => sub !== null);
    if (filteredSpecs.length === 0 && filteredSubs.length === 0) return null;
    return { ...suite, specs: filteredSpecs, suites: filteredSubs };
}

/**
 * Human-friendly relative date formatter (Today / Yesterday / short date).
 */
export function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;

    // Today
    if (diff < 24 * 60 * 60 * 1000 && d.getDate() === now.getDate()) {
        return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) {
        return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
