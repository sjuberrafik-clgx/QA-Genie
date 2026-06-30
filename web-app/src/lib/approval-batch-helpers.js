/**
 * Pure helper functions for ApprovalBatch — fingerprinting, status extraction,
 * subject/title/provider resolution, and option value extraction.
 * Extracted from ApprovalBatch.js to keep the component focused on rendering.
 */

import {
    getApprovalDecision,
    getStructuredMutationPreview,
    normalizeApprovalText,
} from '@/lib/approval-helpers';

/** Stable similarity fingerprint for a request — matching fingerprints surface as a "similar" group. */
export function fingerprintRequest(req) {
    const meta = req?.meta || {};
    const preview = getStructuredMutationPreview(meta);
    const guardrail = meta.guardrail || preview?.guardrail || {};
    const provider = guardrail.provider || preview?.provider || 'generic';
    const action = guardrail.actionLabel || preview?.title || req?.question || '';
    const resource = guardrail.resourceType || preview?.effect || '';
    return `${provider}|${resource}|${String(action).trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function getRequestStatus(req) {
    if (!req?.resolved) return 'pending';
    const decision = getApprovalDecision(req.resolvedAnswer, !!req.auto);
    return decision.state;
}

export function getRequestSubject(req) {
    const preview = getStructuredMutationPreview(req?.meta);
    return preview?.subject?.id || preview?.subject?.label || preview?.subject?.title || null;
}

export function getRequestTitle(req) {
    const preview = getStructuredMutationPreview(req?.meta);
    return preview?.subject?.title || preview?.title || req?.question?.split('\n')[0] || 'Approval request';
}

export function getRequestProviderLabel(req) {
    const meta = req?.meta || {};
    const preview = getStructuredMutationPreview(meta);
    const provider = meta.guardrail?.provider || preview?.provider;
    if (provider === 'confluence') return 'Confluence';
    if (provider === 'jira') return 'Jira';
    return 'Change';
}

export function getRequestActionLabel(req) {
    const meta = req?.meta || {};
    const preview = getStructuredMutationPreview(meta);
    return meta.guardrail?.actionLabel || preview?.title || 'Review change';
}

/** Extract approve/reject option values from an approval request (fall back to canonical strings). */
export function getApprovalValues(req) {
    const options = Array.isArray(req?.options) ? req.options : [];
    let approveValue = 'Approve change';
    let rejectValue = 'Cancel';

    for (const option of options) {
        const label = typeof option === 'string' ? option : (option?.label || option?.text || '');
        const value = typeof option === 'object' && option?.value ? option.value : label;
        const normalized = normalizeApprovalText(label);
        if (/(APPROVE|CONFIRM|PROCEED|YES)/.test(normalized)) approveValue = value;
        else if (/(CANCEL|REJECT|DENY|NO)/.test(normalized)) rejectValue = value;
    }

    return { approveValue, rejectValue };
}
