'use client';

import { memo, useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tryRenderAlert } from '@/components/ChatAlert';
import { ChatBubbleIcon, CheckIcon, ChevronDownIcon, ExclamationIcon, XIcon } from '@/components/Icons';
import { normalizeSemanticCallouts } from '@/lib/semantic-highlighting';

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
    const raw = side === 'before'
        ? (change.beforeRaw ?? display ?? '')
        : (change.afterRaw ?? display ?? '');
    const kind = side === 'before' ? change.beforeKind : change.afterKind;
    const rawText = typeof raw === 'string' ? raw : String(raw || '');
    const lineCount = rawText ? rawText.split(/\r?\n/).length : 0;
    const isLongText = Boolean(change.isLongText) || rawText.length > 180 || lineCount > 4;
    return {
        display: display || '(empty)',
        raw: rawText,
        kind: kind || (isLikelyMarkdownText(rawText) ? 'markdown' : 'text'),
        isLongText,
        lineCount,
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
    // Strip surrounding bullet/dash markers like "- Started -" -> "Started"
    text = text.replace(/^[\s\-–—•·*]+/, '').replace(/[\s\-–—•·*]+$/, '');
    // Collapse internal whitespace/newlines
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
    return null; // signal caller to render transition chip
}

function ApprovalChangeValue({ change, operationKind }) {
    const before = getCleanDisplay(change?.beforeDisplay);
    const after = getCleanDisplay(change?.afterDisplay);
    const isEmpty = (v) => !v || v === '(empty)';

    const renderChip = (text, variant = 'neutral') => {
        const base = 'inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-[12px] font-semibold leading-5 break-words';
        const styles = variant === 'before'
            ? 'bg-surface-100 text-surface-500 line-through decoration-surface-400/60'
            : variant === 'after'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70'
                : 'bg-surface-100 text-surface-700';
        return <span className={`${base} ${styles}`}>{text}</span>;
    };

    if (operationKind === 'create' || change?.changeType === 'add' || isEmpty(before)) {
        return <div className="flex flex-wrap items-center gap-1.5">{renderChip(after, 'after')}</div>;
    }

    if (change?.changeType === 'remove' || isEmpty(after)) {
        return (
            <div className="flex flex-wrap items-center gap-1.5">
                {renderChip(before, 'before')}
                <span className="text-[11px] font-medium text-rose-600">removed</span>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {renderChip(before, 'before')}
            <svg className="h-3.5 w-3.5 text-surface-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L13.586 11H4a1 1 0 110-2h9.586l-3.293-3.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            {renderChip(after, 'after')}
        </div>
    );
}

function ApprovalMetadataList({ changes, operationKind }) {
    if (!Array.isArray(changes) || changes.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {changes.map((change, index) => (
                <div key={`${change.field || 'meta'}_${index}`} className="rounded-xl border border-white/90 bg-white/90 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">
                        {change.label || change.field || 'Field'}
                    </div>
                    <div className="mt-1.5">
                        <ApprovalChangeValue change={change} operationKind={operationKind} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function ApprovalDocumentChange({ change, operationKind }) {
    const beforeDescriptor = getChangeValueDescriptor(change, 'before');
    const afterDescriptor = getChangeValueDescriptor(change, 'after');
    const showBefore = operationKind !== 'create'
        && change.changeType !== 'add'
        && beforeDescriptor.display !== '(empty)';

    return (
        <div className="rounded-2xl border border-white/90 bg-white/85 px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">
                    {change.label || change.field || 'Field'}
                </div>
                <span className="inline-flex items-center rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                    {change.changeType}
                </span>
            </div>

            {showBefore ? (
                <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-surface-200/80 bg-surface-50/90 px-3 py-2.5">
                        <div className="type-meta-label">Current</div>
                        <div className="mt-2 text-[12px] leading-6 text-surface-700 overflow-x-auto">
                            <ApprovalValueBlock descriptor={beforeDescriptor} />
                        </div>
                    </div>
                    <div className="rounded-xl border border-surface-200/80 bg-white px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                        <div className="type-meta-label">Proposed</div>
                        <div className="mt-2 text-[12px] leading-6 text-surface-700 overflow-x-auto">
                            <ApprovalValueBlock descriptor={afterDescriptor} />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mt-3 rounded-xl border border-surface-200/80 bg-white px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                    <div className="type-meta-label">{operationKind === 'create' ? 'Draft content' : 'Proposed content'}</div>
                    <div className="mt-2 text-[12px] leading-6 text-surface-700 overflow-x-auto">
                        <ApprovalValueBlock descriptor={afterDescriptor} />
                    </div>
                </div>
            )}
        </div>
    );
}

function ApprovalValueBlock({ descriptor }) {
    if (!descriptor || descriptor.display === '(empty)') {
        return <span className="text-surface-400">(empty)</span>;
    }

    if (descriptor.isLongText) {
        if (descriptor.kind === 'markdown' || isLikelyMarkdownText(descriptor.raw)) {
            return (
                <div className="chat-markdown text-[12px] leading-6 text-surface-700">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            blockquote({ children, ...props }) {
                                const alert = tryRenderAlert(children);
                                if (alert) return alert;
                                return <blockquote {...props}>{children}</blockquote>;
                            },
                        }}
                    >{normalizeSemanticCallouts(descriptor.raw)}</ReactMarkdown>
                </div>
            );
        }

        return (
            <pre className="whitespace-pre-wrap break-words text-[12px] leading-6 text-surface-700 font-sans">
                {descriptor.raw}
            </pre>
        );
    }

    return <span className="break-words">{descriptor.display}</span>;
}

function MutationPreviewBlock({ preview }) {
    if (!preview) return null;

    const subjectLabel = preview.subject?.label || preview.subject?.id || preview.subject?.title || 'Target resource';
    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    const notes = Array.isArray(preview.notes) ? preview.notes : [];

    return (
        <div className="rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-amber-700 font-semibold">
                <span>{preview.title || 'Mutation preview'}</span>
                <span className="normal-case text-amber-600">{subjectLabel}</span>
            </div>

            {changes.length > 0 && (
                <div className="space-y-1.5">
                    {changes.map((change, index) => (
                        <div key={`${change.field || 'field'}_${index}`} className="rounded-md bg-amber-50/70 px-2.5 py-2 border border-amber-100/80">
                            <div className="text-[11px] font-semibold text-surface-700">{change.label || change.field || 'Field'}</div>
                            <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-surface-600 sm:grid-cols-2 sm:gap-2">
                                <div>
                                    <span className="font-medium text-surface-500">Before: </span>
                                    <span>{change.beforeDisplay || '(empty)'}</span>
                                </div>
                                <div>
                                    <span className="font-medium text-surface-500">After: </span>
                                    <span>{change.afterDisplay || '(empty)'}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {notes.length > 0 && (
                <div className="space-y-1">
                    {notes.map((note, index) => (
                        <div key={`note_${index}`} className="text-[11px] text-surface-600 leading-relaxed">
                            {note}
                        </div>
                    ))}
                </div>
            )}

            {preview.consequence && (
                <div className="text-[11px] text-surface-600 leading-relaxed">
                    <span className="font-medium text-surface-700">Consequence: </span>
                    {preview.consequence}
                </div>
            )}
        </div>
    );
}

// Named exports — re-used by the ApprovalBatch tray component to classify,
// fingerprint, and render grouped approval requests without duplicating logic.
export {
    isApprovalPrompt,
    getStructuredMutationPreview,
    getApprovalDecision,
    normalizeApprovalText,
    ApprovalPromptCard,
};

function ApprovalPromptCard({
    requestId,
    preview,
    safeQuestion,
    options,
    resolved,
    resolvedAnswer,
    auto,
    onSubmit,
    disabled,
    submitting,
}) {
    const [detailsExpanded, setDetailsExpanded] = useState(false);

    const decision = getApprovalDecision(resolvedAnswer, auto);
    const tone = getApprovalTone(preview, resolved ? decision.state : 'pending');
    const changes = Array.isArray(preview?.changes) ? preview.changes : [];
    const notes = Array.isArray(preview?.notes) ? preview.notes : [];
    const providerLabel = getProviderLabel(preview);
    const effectLabel = getEffectLabel(preview);
    const approvalOptions = (Array.isArray(options) ? options : []).map(normalizeOption);
    const subjectTitle = preview?.subject?.label || preview?.subject?.title || preview?.subject?.id || 'Target resource';
    const operationKind = derivePreviewOperationKind(preview);
    const operationLabel = operationKind === 'create'
        ? 'Create'
        : operationKind === 'delete'
            ? 'Delete'
            : operationKind === 'update'
                ? 'Update'
                : 'Review';
    const { summaryChange, metadataChanges, documentChanges } = partitionApprovalChanges(changes);
    const cleanedSummaryValue = cleanDisplayText(summaryChange?.afterDisplay || preview?.subject?.title || subjectTitle);
    const cleanedSubjectTitle = cleanDisplayText(subjectTitle);
    const showPrimaryContent = Boolean(cleanedSummaryValue) && cleanedSummaryValue !== cleanedSubjectTitle;
    const summaryValue = cleanedSummaryValue;
    const compactMetadata = metadataChanges.slice(0, operationKind === 'create' ? 6 : 4);
    const remainingMetadataCount = Math.max(0, metadataChanges.length - compactMetadata.length);
    const hasRichReviewContent = documentChanges.length > 0 || metadataChanges.length > compactMetadata.length || notes.length > 0 || (!preview && !!safeQuestion);

    const statusCopy = resolved
        ? decision.label
        : 'Review required';
    const statusDetail = resolved
        ? decision.detail
        : `The agent is blocked until you approve or cancel this ${providerLabel.toLowerCase()} change.`;

    return (
        <div className="space-y-1.5">
            <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider px-1 ${tone.subtle}`}>
                {resolved ? (
                    decision.state === 'approved'
                        ? <CheckIcon className="w-3.5 h-3.5" />
                        : decision.state === 'rejected'
                            ? <XIcon className="w-3.5 h-3.5" />
                            : <ExclamationIcon className="w-3.5 h-3.5" />
                ) : (
                    <ExclamationIcon className="w-3.5 h-3.5" />
                )}
                {resolved ? 'Approval Review' : 'Approval Required'}
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold normal-case ${tone.badge} ${!resolved ? 'animate-pulse' : ''}`}>
                    {resolved ? statusCopy : 'waiting'}
                </span>
            </div>

            <div className={`relative overflow-hidden rounded-[22px] border shadow-sm ${tone.shell}`}>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(255,255,255,0.55),transparent_42%),radial-gradient(circle_at_86%_2%,rgba(255,255,255,0.38),transparent_34%)]" />
                <div className={`absolute inset-y-0 left-0 w-[5px] bg-gradient-to-b ${tone.rail}`} />
                <div className="absolute inset-x-4 top-0 h-px bg-white/85" />

                <div className="relative pl-6 pr-5 py-5 space-y-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-3 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500">
                                <span className="text-surface-600">{providerLabel} approval</span>
                                <span className="text-surface-300" aria-hidden="true">•</span>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${tone.badge}`}>
                                    {operationLabel}
                                </span>
                                {effectLabel && effectLabel !== 'Review' && effectLabel.toUpperCase() !== operationLabel.toUpperCase() && (
                                    <>
                                        <span className="text-surface-300" aria-hidden="true">•</span>
                                        <span className="text-surface-500">{effectLabel}</span>
                                    </>
                                )}
                                <span className="text-surface-300" aria-hidden="true">•</span>
                                <span className="text-surface-500 normal-case tracking-normal">{getImpactLabel(preview)}</span>
                            </div>

                            <div>
                                <h3 className="type-card-title text-[1.1rem] text-surface-900 tracking-[-0.03em]">
                                    {preview?.title || 'Review proposed change'}
                                </h3>
                                <p className="mt-1.5 text-[13px] leading-6 text-surface-600 max-w-3xl">
                                    {statusDetail}
                                </p>
                                {showPrimaryContent && (
                                    <div className="mt-3.5 rounded-[18px] border border-white/90 bg-white/90 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.07)] max-w-3xl">
                                        <div className="type-meta-label">Primary content</div>
                                        <div className="mt-1.5 text-[14px] font-semibold leading-6 text-surface-900 break-words">
                                            {summaryValue}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`rounded-[18px] border px-3.5 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft} min-w-[228px]`}>
                            <div className="type-meta-label">Target</div>
                            <div className="mt-1.5 text-[13px] font-semibold leading-5 text-surface-800 break-words">
                                {preview?.subject?.url ? (
                                    <a
                                        href={preview.subject.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-brand-700 hover:text-brand-800 hover:underline"
                                    >
                                        {subjectTitle}
                                    </a>
                                ) : subjectTitle}
                            </div>
                            {preview?.subject?.id && preview.subject.id !== subjectTitle && (
                                <div className="mt-1 text-[11px] text-surface-500">{preview.subject.id}</div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.82fr)]">
                        <div className={`rounded-[18px] border px-4 py-3.5 shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="type-meta-label">Change summary</div>
                                    <div className="mt-1 text-[13px] leading-6 text-surface-600">
                                        {operationKind === 'create'
                                            ? `Draft contains ${changes.length} field${changes.length === 1 ? '' : 's'}.`
                                            : `${changes.length} field${changes.length === 1 ? '' : 's'} will change.`}
                                    </div>
                                </div>
                                {remainingMetadataCount > 0 && (
                                    <span className="inline-flex items-center rounded-full bg-white/80 border border-surface-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-500 shrink-0">
                                        +{remainingMetadataCount} more
                                    </span>
                                )}
                            </div>

                            {compactMetadata.length > 0 ? (
                                <div className="mt-3.5">
                                    <ApprovalMetadataList changes={compactMetadata} operationKind={operationKind} />
                                </div>
                            ) : (
                                <div className="mt-3 text-[12px] text-surface-500">
                                    {documentChanges.length > 0
                                        ? 'Long-form content is available in review details.'
                                        : 'No structured field changes were provided.'}
                                </div>
                            )}
                        </div>

                        <div className="space-y-3.5">
                            {preview?.consequence && (
                                <div className={`rounded-[18px] border px-4 py-3.5 shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft}`}>
                                    <div className="type-meta-label">Consequence</div>
                                    <p className="mt-1.5 text-[13px] leading-6 text-surface-700">{preview.consequence}</p>
                                </div>
                            )}

                            {documentChanges.length > 0 && (
                                <div className={`rounded-[18px] border px-4 py-3.5 shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft}`}>
                                    <div className="type-meta-label">Content review</div>
                                    <p className="mt-1.5 text-[13px] leading-6 text-surface-700">
                                        {documentChanges.length} long-form section{documentChanges.length === 1 ? '' : 's'} available in review details.
                                    </p>
                                </div>
                            )}

                            <div className={`rounded-[18px] border px-4 py-3.5 shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft}`}>
                                <div className="type-meta-label">Decision state</div>
                                <p className="mt-1.5 text-[13px] leading-6 text-surface-700">{resolved ? decision.detail : 'No mutation will be applied until you explicitly choose an action.'}</p>
                            </div>
                        </div>
                    </div>

                    {hasRichReviewContent && (
                        <div className={`rounded-[18px] border shadow-[0_8px_22px_rgba(15,23,42,0.06)] ${tone.soft}`}>
                            <button
                                type="button"
                                onClick={() => setDetailsExpanded(prev => !prev)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
                            >
                                <div>
                                    <div className="type-meta-label">Review details</div>
                                    <div className="mt-1.5 text-[13px] text-surface-600">
                                        Inspect full field review, content sections, and additional notes.
                                    </div>
                                </div>
                                <ChevronDownIcon className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${detailsExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {detailsExpanded && (
                                <div className="border-t border-white/75 px-4 py-4 space-y-4">
                                    {documentChanges.length > 0 && (
                                        <div className="space-y-3">
                                            <div className="type-meta-label">Content sections</div>
                                            {documentChanges.map((change, index) => (
                                                <ApprovalDocumentChange
                                                    key={`${change.field || 'document'}_${index}`}
                                                    change={change}
                                                    operationKind={operationKind}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {metadataChanges.length > compactMetadata.length && (
                                        <div className="space-y-3">
                                            <div className="type-meta-label">Additional fields</div>
                                            <ApprovalMetadataList
                                                changes={metadataChanges.slice(compactMetadata.length)}
                                                operationKind={operationKind}
                                            />
                                        </div>
                                    )}

                                    {notes.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="type-meta-label">Notes</div>
                                            <div className="rounded-[16px] border border-white/90 bg-white/90 px-3.5 py-3 text-[12px] leading-6 text-surface-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
                                                {notes.map((note, index) => (
                                                    <div key={`note_${index}`} className={index > 0 ? 'mt-2' : ''}>{note}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {!preview && safeQuestion && (
                                        <div className="space-y-2">
                                            <div className="type-meta-label">Request summary</div>
                                            <div className="rounded-[16px] border border-dashed border-surface-300 bg-surface-50/80 px-3.5 py-3 text-[12px] leading-6 text-surface-600 whitespace-pre-wrap">
                                                {safeQuestion}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {!resolved && (
                        <div className="sticky bottom-0 z-[1] -mx-5 mt-1 border-t border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.36),rgba(255,255,255,0.95))] px-5 pb-2 pt-4 backdrop-blur-sm">
                            <div className="flex flex-wrap items-center gap-2.5">
                                {approvalOptions.length > 0 ? approvalOptions.map((option, index) => {
                                    const baseClasses = option.kind === 'approve'
                                        ? 'gradient-brand text-white border-transparent shadow-[0_10px_24px_rgba(37,99,235,0.28)] hover:-translate-y-px hover:shadow-[0_14px_28px_rgba(37,99,235,0.32)] focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2'
                                        : option.kind === 'cancel'
                                            ? `${tone.button} hover:bg-surface-50 focus-visible:ring-2 focus-visible:ring-surface-300 focus-visible:ring-offset-2`
                                            : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-50 focus-visible:ring-2 focus-visible:ring-surface-300 focus-visible:ring-offset-2';

                                    return (
                                        <button
                                            key={`${option.label}_${index}`}
                                            type="button"
                                            onClick={() => onSubmit(requestId, option.value)}
                                            disabled={disabled || submitting}
                                            className={`px-4 py-2 rounded-xl border text-[12px] font-semibold transition-all duration-200 outline-none disabled:opacity-50 disabled:cursor-not-allowed ${baseClasses}`}
                                        >
                                            {submitting && option.kind === 'approve' ? 'Submitting…' : option.label}
                                        </button>
                                    );
                                }) : (
                                    <button
                                        type="button"
                                        onClick={() => onSubmit(requestId, 'Approve change')}
                                        disabled={disabled || submitting}
                                        className="px-4 py-2 rounded-xl border border-transparent gradient-brand text-white text-[12px] font-semibold shadow-[0_10px_24px_rgba(37,99,235,0.28)] hover:-translate-y-px hover:shadow-[0_14px_28px_rgba(37,99,235,0.32)] focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? 'Submitting…' : 'Approve change'}
                                    </button>
                                )}

                                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-surface-500">
                                    <svg className="h-3.5 w-3.5 text-surface-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                    </svg>
                                    Your decision is final. The agent resumes immediately.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * UserInputPrompt — inline timeline card shown when the agent calls ask_user / ask_questions.
 *
 * Renders in two states:
 * - **Pending**: question + input area (textarea or option buttons) + submit button
 * - **Resolved**: question + submitted answer (read-only, greyed out)
 *
 * Supports types:
 * - **default**: text input with optional option buttons
 * - **credentials**: dual masked inputs for username + password
 * - **password**: single masked input
 *
 * Designed to match the existing chat timeline visual language (tool calls, reasoning blocks).
 */
export default memo(UserInputPrompt);

function UserInputPrompt({ requestId, question, options = [], resolved, resolvedAnswer, auto, onSubmit, disabled, type = 'default', meta = {} }) {
    const [selectedOption, setSelectedOption] = useState('');
    const [freeText, setFreeText] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);
    const usernameRef = useRef(null);

    const safeQuestion = sanitizePromptQuestion(question, type);
    const safeOptions = Array.isArray(options) ? options : [];
    const hasOptions = safeOptions.length > 0;
    const isCredentials = type === 'credentials';
    const isPasswordOnly = type === 'password';
    const mutationPreview = getStructuredMutationPreview(meta);
    const isApprovalRequest = isApprovalPrompt(type, mutationPreview, safeQuestion, safeOptions, meta);

    // Auto-focus the input when the prompt appears
    useEffect(() => {
        if (!resolved && !isApprovalRequest) {
            const ref = isCredentials ? usernameRef : inputRef;
            if (ref.current) {
                const timer = setTimeout(() => ref.current?.focus(), 150);
                return () => clearTimeout(timer);
            }
        }
    }, [resolved, isCredentials, isApprovalRequest]);

    const handleSubmit = async () => {
        let answer;

        if (isCredentials) {
            if (!username.trim() || !password.trim()) return;
            answer = { username: username.trim(), password: password.trim() };
        } else if (isPasswordOnly) {
            if (!freeText.trim()) return;
            answer = freeText.trim();
        } else {
            answer = hasOptions
                ? (selectedOption || freeText || '').trim()
                : freeText.trim();
        }

        if (!answer || submitting) return;

        setSubmitting(true);
        try {
            await onSubmit(requestId, answer);
        } catch {
            // Error handled by parent
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const canSubmit = isCredentials
        ? !!(username.trim() && password.trim())
        : isPasswordOnly
            ? !!freeText.trim()
            : hasOptions
                ? !!(selectedOption || freeText.trim())
                : !!freeText.trim();

    if (isApprovalRequest) {
        return (
            <ApprovalPromptCard
                requestId={requestId}
                preview={mutationPreview}
                safeQuestion={safeQuestion}
                options={safeOptions}
                resolved={resolved}
                resolvedAnswer={resolvedAnswer}
                auto={auto}
                onSubmit={onSubmit}
                disabled={disabled}
                submitting={submitting}
            />
        );
    }

    // ─── Resolved state ─────────────────────────────────────────
    if (resolved) {
        return (
            <div className="space-y-1.5">
                {/* Header */}
                <div className="flex items-center gap-2 text-[11px] font-semibold text-surface-500 uppercase tracking-wider px-1">
                    <ChatBubbleIcon className="w-3.5 h-3.5" />
                    Agent Question
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-600 text-[10px] font-bold normal-case">
                        {auto ? 'auto-answered' : 'answered'}
                    </span>
                </div>

                <div className="rounded-xl border border-surface-200/80 bg-surface-50/60 overflow-hidden">
                    {/* Question */}
                    <div className="px-4 py-3 border-b border-surface-200/60 space-y-3">
                        <p className="text-sm text-surface-700 whitespace-pre-wrap leading-relaxed">{safeQuestion}</p>
                        <MutationPreviewBlock preview={mutationPreview} />
                    </div>
                    {/* Answer */}
                    <div className="px-4 py-2.5 bg-surface-50 flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 flex-shrink-0 text-accent-500 mt-0.5" />
                        <p className="text-sm text-surface-600 whitespace-pre-wrap leading-relaxed">
                            {isCredentials
                                ? '🔐 Credentials provided (hidden for security)'
                                : isPasswordOnly
                                    ? '••••••••'
                                    : resolvedAnswer}
                            {auto && <span className="ml-2 text-[10px] text-surface-400 font-medium">(timeout)</span>}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Pending state (awaiting user response) ─────────────────
    return (
        <div className="space-y-1.5">
            {/* Header */}
            <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-600 uppercase tracking-wider px-1">
                <ChatBubbleIcon className="w-3.5 h-3.5" />
                Agent Needs Your Input
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold normal-case animate-pulse">
                    waiting
                </span>
            </div>

            <div className="rounded-xl border-2 border-amber-300/70 bg-amber-50/40 overflow-hidden shadow-sm shadow-amber-200/30">
                {/* Question */}
                <div className="px-4 py-3 border-b border-amber-200/60 space-y-3">
                    <p className="text-sm text-surface-800 whitespace-pre-wrap leading-relaxed font-medium">{safeQuestion}</p>
                    <MutationPreviewBlock preview={mutationPreview} />
                </div>

                {/* Input area */}
                <div className="px-4 py-3 space-y-3">
                    {/* Credential inputs (username + password) */}
                    {isCredentials && (
                        <div className="space-y-2.5">
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">
                                    Username / Email
                                </label>
                                <input
                                    ref={usernameRef}
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            // Focus password field
                                            const pwField = e.target.closest('.space-y-2\\.5')?.querySelector('input[type="password"], input[type="text"]:last-of-type');
                                            pwField?.focus();
                                        }
                                    }}
                                    placeholder="Enter your username or email"
                                    disabled={disabled || submitting}
                                    autoComplete="username"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSubmit();
                                            }
                                        }}
                                        placeholder="Enter your password"
                                        disabled={disabled || submitting}
                                        autoComplete="current-password"
                                        className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 pr-10 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600 transition-colors"
                                        tabIndex={-1}
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            {showPassword ? (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                            ) : (
                                                <>
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </>
                                            )}
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                {hasOptions && safeOptions.map((opt, i) => {
                                    const label = typeof opt === 'string' ? opt : (opt.label || opt.text || String(opt));
                                    return (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => onSubmit(requestId, typeof opt === 'object' && opt.value ? opt.value : label)}
                                            disabled={disabled || submitting}
                                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-200 bg-white text-surface-600 hover:border-surface-300 hover:bg-surface-50 transition-all disabled:opacity-50"
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                                <div className="flex-1" />
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={!canSubmit || disabled || submitting}
                                    className="px-5 py-1.5 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md hover:shadow-brand-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                                >
                                    {submitting ? (
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded-full border-2 border-white/60 border-t-white animate-spin" />
                                            Logging in...
                                        </span>
                                    ) : (
                                        '🔐 Login'
                                    )}
                                </button>
                            </div>
                            <p className="text-[10px] text-surface-400 leading-relaxed">
                                🔒 Credentials are used only for this session and are never stored. Press Enter or click Login.
                            </p>
                        </div>
                    )}

                    {/* Password-only input */}
                    {isPasswordOnly && (
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    ref={inputRef}
                                    type={showPassword ? 'text' : 'password'}
                                    value={freeText}
                                    onChange={(e) => setFreeText(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Enter password..."
                                    disabled={disabled || submitting}
                                    autoComplete="current-password"
                                    className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 pr-10 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600 transition-colors"
                                    tabIndex={-1}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!canSubmit || disabled || submitting}
                                className="flex-shrink-0 px-4 py-2 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Submit
                            </button>
                        </div>
                    )}

                    {/* Standard input (option buttons + free text) — only for default type */}
                    {!isCredentials && !isPasswordOnly && (
                        <>
                            {/* Option buttons (if the agent provided choices) */}
                            {hasOptions && (
                                <div className="flex flex-wrap gap-2">
                                    {options.map((opt, i) => {
                                        const label = typeof opt === 'string' ? opt : (opt.label || opt.text || String(opt));
                                        const isSelected = selectedOption === label;
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedOption(isSelected ? '' : label);
                                                    setFreeText(''); // Clear free text when selecting an option
                                                }}
                                                disabled={disabled || submitting}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected
                                                    ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                                                    : 'border-surface-200 bg-white text-surface-700 hover:border-brand-200 hover:bg-brand-50/30'
                                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Free-text input */}
                            <div className="flex gap-2">
                                <textarea
                                    ref={inputRef}
                                    value={freeText}
                                    onChange={(e) => {
                                        setFreeText(e.target.value);
                                        if (hasOptions) setSelectedOption(''); // Clear option selection when typing
                                    }}
                                    onKeyDown={handleKeyDown}
                                    placeholder={hasOptions ? 'Or type your own answer...' : 'Type your response...'}
                                    disabled={disabled || submitting}
                                    rows={1}
                                    className="flex-1 resize-none rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    style={{ maxHeight: '100px' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={!canSubmit || disabled || submitting}
                                    className="flex-shrink-0 px-4 py-2 rounded-lg gradient-brand text-white text-xs font-semibold shadow-sm shadow-brand-500/20 hover:shadow-md hover:shadow-brand-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                                >
                                    {submitting ? (
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded-full border-2 border-white/60 border-t-white animate-spin" />
                                            Sending
                                        </span>
                                    ) : (
                                        'Submit'
                                    )}
                                </button>
                            </div>

                            <p className="text-[10px] text-surface-400 leading-relaxed">
                                The AI agent is waiting for your response to continue. Press Enter or click Submit.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
