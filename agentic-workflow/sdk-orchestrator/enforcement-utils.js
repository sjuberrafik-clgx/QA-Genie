/**
 * Enforcement Utilities — Shared helpers for enforcement hooks.
 * Extracted from enforcement-hooks.js for reuse and maintainability.
 * @module sdk-orchestrator/enforcement-utils
 */

// ─── Tool Pattern Constants ─────────────────────────────────────────────────

const SELECTOR_VALIDATION_TOOL_PATTERNS = [
    'unified_get_by_role',
    'unified_get_by_test_id',
    'unified_get_by_label',
    'unified_get_by_text',
    'unified_get_by_placeholder',
    'unified_get_by_alt_text',
    'unified_get_by_title',
];

const CONTENT_EXTRACTION_TOOL_PATTERNS = [
    'unified_get_text_content',
    'unified_get_attribute',
    'unified_get_inner_text',
    'unified_get_input_value',
];

const URL_VERIFICATION_TOOL_PATTERNS = [
    'unified_get_page_url',
    'unified_expect_url',
];

// ─── Parsing & Observation ──────────────────────────────────────────────────

function parseToolResultPayload(result) {
    if (!result) return null;
    if (typeof result === 'object') return result;
    if (typeof result !== 'string') return null;

    const trimmed = result.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function extractRuntimeObservation(toolName, result) {
    const payload = parseToolResultPayload(result);

    if (payload?.blockerState?.present && payload.blockerState.blocker) {
        return { toolName, source: 'blockerState', blocker: payload.blockerState.blocker };
    }

    if (payload?.blockerDetected) {
        return { toolName, source: 'blockerDetected', blocker: payload.blockerDetected };
    }

    if (payload?.errorCode === 'RUNTIME_BLOCKER' && payload?.blocker) {
        return { toolName, source: 'runtimeError', blocker: payload.blocker };
    }

    if (typeof result === 'string' && /Tool execution failed \[RUNTIME_BLOCKER\]:/i.test(result)) {
        return {
            toolName,
            source: 'runtimeErrorText',
            blocker: {
                kind: /native dialog/i.test(result) ? 'native-dialog' : 'unknown-blocker',
                message: result,
            },
        };
    }

    return null;
}

// ─── Exploration Detection ──────────────────────────────────────────────────

function executeExplorationIncludesNavigate(toolArgs = {}) {
    const template = String(toolArgs.templateName || '').toLowerCase();
    if (template === 'explore_page' || template === 'login_and_navigate') {
        return true;
    }

    const script = String(toolArgs.script || '').toLowerCase();
    return script.includes('tools.navigate(') || script.includes('.navigate(');
}

function executeExplorationIncludesSnapshot(toolArgs = {}) {
    const template = String(toolArgs.templateName || '').toLowerCase();
    if (template === 'explore_page' || template === 'login_and_navigate') {
        return true;
    }

    const script = String(toolArgs.script || '').toLowerCase();
    return script.includes('tools.snapshot(') || script.includes('.snapshot(');
}

// ─── Tool Pattern Matching ──────────────────────────────────────────────────

function matchesToolPattern(toolName = '', patterns = []) {
    const normalized = String(toolName).toLowerCase();
    return patterns.some(pattern => normalized.includes(String(pattern).toLowerCase()));
}

// ─── Page Evidence Tracking ─────────────────────────────────────────────────

function normalizePageKey(rawUrl) {
    if (typeof rawUrl !== 'string') {
        return null;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        parsed.search = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        const noHash = trimmed.split('#')[0];
        const noQuery = noHash.split('?')[0];
        return noQuery || trimmed;
    }
}

function ensurePageEvidenceRecord(state, pageKey) {
    if (!pageKey) {
        return null;
    }

    if (!state.pageEvidenceByUrl.has(pageKey)) {
        state.pageEvidenceByUrl.set(pageKey, {
            selectorValidated: false,
            contentExtracted: false,
            urlVerified: false,
            touchedBy: {
                selector: [],
                content: [],
                url: [],
            },
            sources: [],
            updatedAt: new Date().toISOString(),
        });
        state.visitedPages.push(pageKey);
    }

    return state.pageEvidenceByUrl.get(pageKey);
}

function registerVisitedPage(state, rawUrl, source = null) {
    const pageKey = normalizePageKey(rawUrl);
    if (!pageKey) {
        return null;
    }

    const record = ensurePageEvidenceRecord(state, pageKey);
    if (record && source && !record.sources.includes(source)) {
        record.sources.push(source);
    }

    if (record) {
        record.updatedAt = new Date().toISOString();
    }

    state.currentPageKey = pageKey;
    return pageKey;
}

function markPageEvidence(state, evidenceType, toolName, rawUrl = null) {
    let pageKey = null;
    if (rawUrl) {
        pageKey = registerVisitedPage(state, rawUrl, `url:${toolName}`);
    }

    if (!pageKey) {
        pageKey = state.currentPageKey;
    }

    if (!pageKey) {
        return false;
    }

    const record = ensurePageEvidenceRecord(state, pageKey);
    if (!record) {
        return false;
    }

    if (evidenceType === 'selector') {
        record.selectorValidated = true;
    } else if (evidenceType === 'content') {
        record.contentExtracted = true;
    } else if (evidenceType === 'url') {
        record.urlVerified = true;
    }

    const touchedBy = record.touchedBy[evidenceType] || [];
    if (toolName && !touchedBy.includes(toolName)) {
        touchedBy.push(toolName);
    }
    record.touchedBy[evidenceType] = touchedBy;
    record.updatedAt = new Date().toISOString();
    return true;
}

// ─── URL Extraction ─────────────────────────────────────────────────────────

function extractUrlCandidatesFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const candidates = new Set();
    const pushCandidate = (value) => {
        const normalized = normalizePageKey(value);
        if (normalized) {
            candidates.add(normalized);
        }
    };

    pushCandidate(payload.url);
    pushCandidate(payload.currentUrl);
    pushCandidate(payload.pageUrl);
    pushCandidate(payload.href);

    if (Array.isArray(payload.pagesVisited)) {
        payload.pagesVisited.forEach(pushCandidate);
    }

    if (Array.isArray(payload.snapshots)) {
        payload.snapshots.forEach(snapshot => pushCandidate(snapshot?.url));
    }

    const nestedPayloads = [payload.data, payload.result];
    for (const nested of nestedPayloads) {
        if (!nested || typeof nested !== 'object') {
            continue;
        }
        pushCandidate(nested.url);
        pushCandidate(nested.currentUrl);
        pushCandidate(nested.pageUrl);
        if (Array.isArray(nested.pagesVisited)) {
            nested.pagesVisited.forEach(pushCandidate);
        }
        if (Array.isArray(nested.snapshots)) {
            nested.snapshots.forEach(snapshot => pushCandidate(snapshot?.url));
        }
    }

    return [...candidates];
}

function extractNavigateUrlsFromExecuteExplorationArgs(toolArgs = {}) {
    const urls = new Set();
    const templateUrl = toolArgs?.templateArgs?.url;
    if (typeof templateUrl === 'string') {
        const normalized = normalizePageKey(templateUrl);
        if (normalized) {
            urls.add(normalized);
        }
    }

    const script = String(toolArgs.script || '');
    if (!script) {
        return [...urls];
    }

    const navigateRegex = /(?:tools\.)?navigate\s*\(\s*(?:\{[^}]*\burl\s*:\s*["'`]([^"'`]+)["'`][^}]*\}|["'`]([^"'`]+)["'`])/g;
    let match;
    while ((match = navigateRegex.exec(script)) !== null) {
        const candidate = match[1] || match[2];
        const normalized = normalizePageKey(candidate);
        if (normalized) {
            urls.add(normalized);
        }
    }

    return [...urls];
}

function replayExecuteExplorationCallLog(state, payload) {
    const callLog = Array.isArray(payload?.stats?.callLog) ? payload.stats.callLog : [];
    if (callLog.length === 0) {
        return;
    }

    let activePageKey = state.currentPageKey;

    for (const entry of callLog) {
        if (!entry || entry.success === false) {
            continue;
        }

        const toolName = String(entry.tool || entry.shortName || '');
        const args = entry.args || {};

        if (toolName.includes('unified_navigate')) {
            state.mcpNavigateCalled = true;
            const pageKey = registerVisitedPage(state, args.url || args.href, 'execute_exploration:callLog');
            if (pageKey) {
                activePageKey = pageKey;
            }
        }

        if (toolName.includes('unified_snapshot')) {
            state.mcpSnapshotCalled = true;
        }

        if (matchesToolPattern(toolName, SELECTOR_VALIDATION_TOOL_PATTERNS)) {
            state.mcpSelectorValidated = true;
            if (activePageKey) {
                markPageEvidence(state, 'selector', toolName, activePageKey);
            }
        }

        if (matchesToolPattern(toolName, CONTENT_EXTRACTION_TOOL_PATTERNS)) {
            state.mcpContentExtracted = true;
            if (activePageKey) {
                markPageEvidence(state, 'content', toolName, activePageKey);
            }
        }

        if (matchesToolPattern(toolName, URL_VERIFICATION_TOOL_PATTERNS)) {
            state.mcpUrlVerified = true;
            const explicitUrl = typeof args.url === 'string' && /^https?:\/\//i.test(args.url) ? args.url : null;
            if (explicitUrl || activePageKey) {
                markPageEvidence(state, 'url', toolName, explicitUrl || activePageKey);
            }
        }
    }
}

// ─── Evidence Analysis ──────────────────────────────────────────────────────

function getMissingPerPageEvidence(state) {
    const missing = [];

    for (const pageKey of state.visitedPages) {
        const record = state.pageEvidenceByUrl.get(pageKey);
        if (!record) {
            continue;
        }

        const gaps = [];
        if (!record.selectorValidated) {
            gaps.push('selector');
        }
        if (!record.contentExtracted) {
            gaps.push('content');
        }
        if (!record.urlVerified) {
            gaps.push('url');
        }

        if (gaps.length > 0) {
            missing.push({ page: pageKey, missing: gaps });
        }
    }

    return missing;
}

function formatRuntimeObservationContext(observation) {
    const blocker = observation.blocker || {};
    const classification = blocker.classification || {};
    const blockerKind = blocker.kind || 'runtime blocker';
    const blockerLabel = blockerKind === 'native-dialog'
        ? 'native browser dialog'
        : blockerKind === 'dom-modal'
            ? 'blocking modal/overlay'
            : 'runtime blocker';
    const detail = blocker.message || blocker.text || blocker.selectorHint || 'No blocker details available.';
    const recovery = blockerKind === 'native-dialog'
        ? 'Call unified_handle_dialog before retrying the blocked interaction.'
        : classification.autoRecoverable === false
            ? `Do NOT blindly retry. Resolve the blocker (${classification.category || blockerKind}) before continuing.`
            : 'Use blocker recovery, re-check page state, then retry the interaction.';

    return (
        `🚨 RUNTIME BLOCKER OBSERVED during ${observation.toolName}: ${blockerLabel}\n` +
        `Details: ${detail}\n\n` +
        'Do NOT continue interacting with underlying elements until the blocker is cleared.\n' +
        recovery
    );
}

module.exports = {
    // Constants
    SELECTOR_VALIDATION_TOOL_PATTERNS,
    CONTENT_EXTRACTION_TOOL_PATTERNS,
    URL_VERIFICATION_TOOL_PATTERNS,
    // Parsing
    parseToolResultPayload,
    extractRuntimeObservation,
    // Exploration detection
    executeExplorationIncludesNavigate,
    executeExplorationIncludesSnapshot,
    // Tool matching
    matchesToolPattern,
    // Page evidence
    normalizePageKey,
    ensurePageEvidenceRecord,
    registerVisitedPage,
    markPageEvidence,
    // URL extraction
    extractUrlCandidatesFromPayload,
    extractNavigateUrlsFromExecuteExplorationArgs,
    replayExecuteExplorationCallLog,
    // Evidence analysis
    getMissingPerPageEvidence,
    formatRuntimeObservationContext,
};
