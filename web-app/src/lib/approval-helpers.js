/**
 * Pure utility functions for approval/mutation-preview logic.
 * Extracted from UserInputPrompt.js to keep the component lean.
 */

const USER_INPUT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_INPUT_REQUEST_ID_RE = /^uir_[a-z0-9_\-]+$/i;

function getFallbackQuestion(inputType = 'default') {
    if (inputType === 'credentials') return 'The agent needs your username and password to continue.';
    if (inputType === 'password') return 'The agent needs your password to continue.';
    if (inputType === 'confirmation') return 'The agent needs your confirmation to continue.';
    return 'The agent needs your input to continue.';
}

function sanitizePromptQuestion(question, inputType = 'default') {
    if (typeof question !== 'string' || question.trim().length === 0) {
        return getFallbackQuestion(inputType);
    }

    const trimmed = question.trim();
    if (USER_INPUT_UUID_RE.test(trimmed) || USER_INPUT_REQUEST_ID_RE.test(trimmed)) {
        return getFallbackQuestion(inputType);
    }

    return trimmed;
}

function getStructuredMutationPreview(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

    const candidate = meta.mutationPreview && typeof meta.mutationPreview === 'object'
        ? meta.mutationPreview
        : meta.preview && typeof meta.preview === 'object'
            ? meta.preview
            : null;

    if (!candidate || Array.isArray(candidate)) return null;
    if (!Array.isArray(candidate.changes) && !Array.isArray(candidate.notes)) return null;
    return candidate;
}

function normalizeApprovalText(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function hasApprovalOptions(options = []) {
    if (!Array.isArray(options) || options.length === 0) return false;
    const labels = options.map((option) => normalizeApprovalText(typeof option === 'string' ? option : (option?.label || option?.text || option?.value || '')));
    const hasApprove = labels.some(label => /(APPROVE|CONFIRM|PROCEED)/.test(label));
    const hasCancel = labels.some(label => /(CANCEL|REJECT|DENY|NO)/.test(label));
    return hasApprove || hasCancel;
}

function isApprovalPrompt(type, preview, question = '', options = [], meta = {}) {
    if (type === 'confirmation') return true;
    if (preview) return true;
    if (meta?.guardrail?.requiresApproval) return true;

    const normalizedQuestion = normalizeApprovalText(question);
    return hasApprovalOptions(options)
        || normalizedQuestion.includes('APPROVAL REQUIRED')
        || normalizedQuestion.includes('APPROVE CHANGE')
        || normalizedQuestion.includes('APPROVE JIRA')
        || normalizedQuestion.includes('APPROVE CONFLUENCE');
}

function getApprovalDecision(answer, auto = false) {
    if (auto) {
        return {
            state: 'timed_out',
            label: 'Approval expired',
            detail: 'No response was received in time. Retry is required before the change can continue.',
        };
    }

    const normalized = normalizeApprovalText(answer);
    if (!normalized) {
        return {
            state: 'answered',
            label: 'Response recorded',
            detail: 'The agent received a response for this request.',
        };
    }

    if (/(APPROVE|YES|PROCEED|CONFIRM)/.test(normalized)) {
        return {
            state: 'approved',
            label: 'Change approved',
            detail: 'The mutation was approved and can proceed.',
        };
    }

    if (/(CANCEL|REJECT|NO|DENY)/.test(normalized)) {
        return {
            state: 'rejected',
            label: 'Change cancelled',
            detail: 'The mutation was not approved and was stopped.',
        };
    }

    return {
        state: 'answered',
        label: 'Response recorded',
        detail: 'The agent received a response for this request.',
    };
}

function getApprovalTone(preview, decisionState = 'pending') {
    if (decisionState === 'approved') {
        return {
            shell: 'border-emerald-300/65 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92)_46%,rgba(236,253,245,0.86))] shadow-[0_16px_38px_rgba(16,185,129,0.16)]',
            rail: 'from-emerald-500 via-teal-500 to-sky-500',
            badge: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/90',
            soft: 'border-emerald-200/70 bg-white/84',
            subtle: 'text-emerald-700',
            button: 'border-emerald-300 bg-white text-emerald-700 shadow-[0_1px_0_rgba(255,255,255,0.8)]',
        };
    }

    if (decisionState === 'rejected' || decisionState === 'timed_out') {
        return {
            shell: 'border-slate-300/80 bg-[linear-gradient(145deg,rgba(248,250,252,0.97),rgba(255,255,255,0.94)_48%,rgba(241,245,249,0.9))] shadow-[0_14px_34px_rgba(148,163,184,0.18)]',
            rail: decisionState === 'timed_out'
                ? 'from-slate-500 via-amber-400 to-slate-400'
                : 'from-slate-500 via-slate-400 to-slate-300',
            badge: decisionState === 'timed_out'
                ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/90'
                : 'bg-slate-200 text-slate-700 ring-1 ring-slate-300/85',
            soft: 'border-slate-200/70 bg-white/86',
            subtle: decisionState === 'timed_out' ? 'text-amber-700' : 'text-slate-700',
            button: 'border-slate-300 bg-white text-slate-700 shadow-[0_1px_0_rgba(255,255,255,0.8)]',
        };
    }

    if (preview?.effect === 'delete') {
        return {
            shell: 'border-rose-300/70 bg-[linear-gradient(145deg,rgba(255,241,242,0.96),rgba(255,255,255,0.92)_48%,rgba(255,247,237,0.9))] shadow-[0_16px_36px_rgba(244,63,94,0.15)]',
            rail: 'from-rose-500 via-orange-500 to-amber-400',
            badge: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200/90',
            soft: 'border-rose-200/70 bg-white/84',
            subtle: 'text-rose-700',
            button: 'border-rose-300 bg-white text-rose-700 shadow-[0_1px_0_rgba(255,255,255,0.8)]',
        };
    }

    return {
        shell: 'border-amber-300/75 bg-[linear-gradient(145deg,rgba(255,251,235,0.97),rgba(255,255,255,0.93)_48%,rgba(255,247,237,0.9))] shadow-[0_18px_40px_rgba(251,191,36,0.16)]',
        rail: 'from-amber-500 via-orange-400 to-yellow-300',
        badge: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/90',
        soft: 'border-amber-200/70 bg-white/84',
        subtle: 'text-amber-700',
        button: 'border-amber-300 bg-white text-amber-700 shadow-[0_1px_0_rgba(255,255,255,0.8)]',
    };
}

function getProviderLabel(preview) {
    if (preview?.provider === 'confluence') return 'Confluence';
    return 'Jira';
}

function getEffectLabel(preview) {
    if (preview?.effect === 'delete') return 'Destructive';
    if (preview?.effect === 'write') return 'Write';
    return 'Review';
}

function getImpactLabel(preview) {
    if (!preview?.impactLevel) return 'High impact';
    return String(preview.impactLevel).replace(/_/g, ' ');
}

function normalizeOption(option) {
    const label = typeof option === 'string'
        ? option
        : (option?.label || option?.text || String(option));
    const value = typeof option === 'object' && option?.value ? option.value : label;
    const normalized = normalizeApprovalText(label);
    const kind = normalized.includes('APPROVE') || normalized.includes('CONFIRM') || normalized.includes('PROCEED')
        ? 'approve'
        : normalized.includes('CANCEL') || normalized.includes('REJECT') || normalized.includes('NO')
            ? 'cancel'
            : 'neutral';

    return { label, value, kind };
}

function isLikelyMarkdownText(value) {
    if (typeof value !== 'string') return false;
    if (value.includes('|') && value.includes('\n')) return true;
    if (/^#{1,6}\s/m.test(value)) return true;
    if (/^\s*[-*+]\s+/m.test(value)) return true;
    if (/^\s*\d+\.\s+/m.test(value)) return true;
    if (/\[[^\]]+\]\([^\)]+\)/.test(value)) return true;
    return false;
}

function getChangeValueDescriptor(change, side) {
    const display = side === 'before' ? change.beforeDisplay : change.afterDisplay;
    const raw = side === 'before' ? change.beforeRaw : change.afterRaw;
    const kind = side === 'before' ? change.beforeKind : change.afterKind;
    const rawText = typeof raw === 'string' ? raw : '';
    const lineCount = rawText ? rawText.split(/\r?\n/).length : 0;
    const rawStripped = Boolean(change.rawStripped || (change.isLongText && !rawText));
    const isLongText = Boolean(change.isLongText) || rawText.length > 180 || lineCount > 4;
    return {
        display: display || '(empty)',
        raw: rawText,
        kind: kind || (isLikelyMarkdownText(rawText) ? 'markdown' : 'text'),
        isLongText,
        lineCount,
        rawStripped,
    };
}

function getNormalizedFieldName(change) {
    return String(change?.field || '').trim().toLowerCase();
}

function derivePreviewOperationKind(preview) {
    if (typeof preview?.operationKind === 'string' && preview.operationKind.trim().length > 0) {
        return preview.operationKind.trim().toLowerCase();
    }

    const changes = Array.isArray(preview?.changes) ? preview.changes : [];
    const effect = String(preview?.effect || '').trim().toLowerCase();
    if (effect === 'delete') return 'delete';
    if (changes.length === 0) return 'review';

    const changeTypes = changes.map(change => String(change?.changeType || '').trim().toLowerCase()).filter(Boolean);
    if (changeTypes.length > 0 && changeTypes.every(type => type === 'add')) return 'create';
    if (changeTypes.length > 0 && changeTypes.every(type => type === 'remove')) return 'remove';
    return 'update';
}

function isDocumentLikeChange(change) {
    const field = getNormalizedFieldName(change);
    return change?.group === 'content'
        || ['summary', 'description', 'comment', 'body', 'details', 'steps', 'expected', 'actual'].includes(field)
        || Boolean(change?.isLongText);
}

function getPreviewSummaryChange(changes = []) {
    return changes.find((change) => getNormalizedFieldName(change) === 'summary') || null;
}

function partitionApprovalChanges(changes = []) {
    const summaryChange = getPreviewSummaryChange(changes);
    return {
        summaryChange,
        metadataChanges: changes.filter((change) => change !== summaryChange && !isDocumentLikeChange(change)),
        documentChanges: changes.filter((change) => change !== summaryChange && isDocumentLikeChange(change)),
    };
}

function cleanDisplayText(value) {
    if (value === null || value === undefined) return '';
    let text = String(value).trim();
    if (!text || text === '(empty)') return text;
    text = text.replace(/^[\s\-–—•·*]+/, '').replace(/[\s\-–—•·*]+$/, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text || '(empty)';
}

function getCleanDisplay(value) {
    const cleaned = cleanDisplayText(value);
    return cleaned || '(empty)';
}

function getCompactChangeValue(change, operationKind) {
    if (!change) return '(empty)';
    if (operationKind === 'create' || change.changeType === 'add' || change.beforeDisplay === '(empty)') {
        return getCleanDisplay(change.afterDisplay);
    }
    if (change.changeType === 'remove') {
        return `${getCleanDisplay(change.beforeDisplay)} removed`;
    }
    return null;
}

export {
    getFallbackQuestion,
    sanitizePromptQuestion,
    getStructuredMutationPreview,
    normalizeApprovalText,
    hasApprovalOptions,
    isApprovalPrompt,
    getApprovalDecision,
    getApprovalTone,
    getProviderLabel,
    getEffectLabel,
    getImpactLabel,
    normalizeOption,
    isLikelyMarkdownText,
    getChangeValueDescriptor,
    getNormalizedFieldName,
    derivePreviewOperationKind,
    isDocumentLikeChange,
    getPreviewSummaryChange,
    partitionApprovalChanges,
    cleanDisplayText,
    getCleanDisplay,
    getCompactChangeValue,
};
