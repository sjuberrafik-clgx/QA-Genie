'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tryRenderAlert } from '@/components/ChatAlert';
import { CheckIcon, ChevronDownIcon, ExclamationIcon, XIcon } from '@/components/Icons';
import { normalizeSemanticCallouts } from '@/lib/semantic-highlighting';
import {
    getApprovalDecision,
    getApprovalTone,
    getProviderLabel,
    getEffectLabel,
    getImpactLabel,
    normalizeOption,
    isLikelyMarkdownText,
    getChangeValueDescriptor,
    derivePreviewOperationKind,
    partitionApprovalChanges,
    cleanDisplayText,
    getCleanDisplay,
} from '@/lib/approval-helpers';

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

    if (descriptor.rawStripped) {
        return (
            <div className="space-y-2">
                <div className="rounded-lg border border-surface-200/80 bg-white/80 px-3 py-2 text-[12px] leading-6 text-surface-700 break-words">
                    {descriptor.display}
                </div>
                <div className="text-[10px] leading-5 text-surface-400">
                    Long-form raw content was summarized to keep the chat stream stable.
                </div>
            </div>
        );
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

export { ApprovalPromptCard, MutationPreviewBlock };
