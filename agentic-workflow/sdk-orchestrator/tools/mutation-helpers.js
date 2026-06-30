/**
 * Jira mutation guardrails, approval flow, and preview/receipt builders.
 * Extracted from custom-tools.js
 */

const { isNonEmptyString, getLatestUserMessageText, resolveActiveSessionId } = require('./general-helpers');

const JIRA_MUTATION_GUARDRAILS = {
    create_jira_ticket: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'create a new Jira ticket',
    },
    assign_jira_ticket: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'reassign a Jira ticket',
    },
    link_jira_issues: {
        provider: 'jira',
        resourceType: 'ticket-link',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'create a link between two Jira issues',
    },
    remove_jira_issue_link: {
        provider: 'jira',
        resourceType: 'ticket-link',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'remove a Jira issue link',
    },
    transition_jira_ticket: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'change Jira ticket status',
    },
    update_jira_ticket: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'update Jira ticket fields (including fix versions)',
    },
    log_jira_work: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'log Jira work',
    },
    update_jira_estimates: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'update Jira estimates',
    },
    delete_jira_ticket: {
        provider: 'jira',
        resourceType: 'ticket',
        effect: 'delete',
        impactLevel: 'destructive',
        requiresApproval: true,
        actionLabel: 'delete a Jira ticket',
    },
    delete_jira_comment: {
        provider: 'jira',
        resourceType: 'ticket-comment',
        effect: 'delete',
        impactLevel: 'destructive',
        requiresApproval: true,
        actionLabel: 'delete a Jira comment',
    },
    edit_jira_comment: {
        provider: 'jira',
        resourceType: 'ticket-comment',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'edit a Jira comment',
    },
    create_confluence_page: {
        provider: 'confluence',
        resourceType: 'page',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'create a Confluence page',
    },
    update_confluence_page: {
        provider: 'confluence',
        resourceType: 'page',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'update a Confluence page',
    },
    delete_confluence_page: {
        provider: 'confluence',
        resourceType: 'page',
        effect: 'delete',
        impactLevel: 'destructive',
        requiresApproval: true,
        actionLabel: 'delete a Confluence page',
    },
    attach_session_evidence_to_jira: {
        provider: 'jira',
        resourceType: 'ticket-attachment',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'attach session evidence to a Jira ticket',
    },
    attach_session_images_to_jira: {
        provider: 'jira',
        resourceType: 'ticket-attachment',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'attach session images to a Jira ticket',
    },
    attach_video_frames_to_jira: {
        provider: 'jira',
        resourceType: 'ticket-attachment',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'attach video frame evidence to a Jira ticket',
    },
    attach_file_to_jira: {
        provider: 'jira',
        resourceType: 'ticket-attachment',
        effect: 'write',
        impactLevel: 'medium',
        requiresApproval: true,
        actionLabel: 'attach a file to a Jira ticket',
    },
    add_comment_with_media: {
        provider: 'jira',
        resourceType: 'ticket-comment',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'add a comment with media attachments to a Jira ticket',
    },
    add_comment_with_images: {
        provider: 'jira',
        resourceType: 'ticket-comment',
        effect: 'write',
        impactLevel: 'high',
        requiresApproval: true,
        actionLabel: 'add a comment with inline images to a Jira ticket',
    },
    delete_jira_attachment: {
        provider: 'jira',
        resourceType: 'ticket-attachment',
        effect: 'delete',
        impactLevel: 'destructive',
        requiresApproval: true,
        actionLabel: 'delete an attachment from a Jira ticket',
    },
};

function normalizeMutationDisplayValue(value) {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : '(empty)';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        const normalizedItems = value
            .map(item => normalizeMutationDisplayValue(item))
            .filter(item => item && item !== '(empty)');
        return normalizedItems.length > 0 ? normalizedItems.join(', ') : '(empty)';
    }
    if (typeof value === 'object') {
        if (isNonEmptyString(value.display)) return value.display.trim();
        if (isNonEmptyString(value.label)) return value.label.trim();
        if (isNonEmptyString(value.displayName)) return value.displayName.trim();
        if (isNonEmptyString(value.name)) return value.name.trim();
        if (isNonEmptyString(value.summary)) return value.summary.trim();
        if (isNonEmptyString(value.title)) return value.title.trim();
        if (isNonEmptyString(value.key)) return value.key.trim();
        if (isNonEmptyString(value.id)) return value.id.trim();
        try {
            return JSON.stringify(value);
        } catch {
            return '(object)';
        }
    }
    return String(value);
}

function serializeMutationRawValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const items = value
            .map(item => serializeMutationRawValue(item))
            .filter(Boolean);
        return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '';
    }
    if (typeof value === 'object') {
        if (isNonEmptyString(value.raw)) return value.raw.trim();
        if (isNonEmptyString(value.markdown)) return value.markdown.trim();
        if (isNonEmptyString(value.display)) return value.display.trim();
        if (isNonEmptyString(value.label)) return value.label.trim();
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return '';
        }
    }
    return String(value).trim();
}

function detectMutationValueKind(value, rawValue = '') {
    if (value === null || value === undefined || rawValue.length === 0) return 'empty';
    if (Array.isArray(value)) return 'list';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'object') return 'json';
    if (/^#{1,6}\s/m.test(rawValue) || /^\s*[-*+]\s+/m.test(rawValue) || /^\s*\d+\.\s+/m.test(rawValue) || (rawValue.includes('|') && rawValue.includes('\n'))) {
        return 'markdown';
    }
    return 'text';
}

function getMutationFieldImportance(field = '') {
    const normalizedField = String(field || '').toLowerCase();
    if (['summary', 'description', 'project', 'issuetype', 'issueType', 'status', 'transition', 'parent', 'relatedissue', 'relatedIssueKey'].includes(normalizedField)) {
        return 'primary';
    }
    if (['priority', 'labels', 'assignee', 'environment', 'originalestimate', 'remainingestimate'].includes(normalizedField)) {
        return 'secondary';
    }
    return 'supporting';
}

function getMutationFieldGroup(field = '') {
    const normalizedField = String(field || '').toLowerCase();
    if (['summary', 'description', 'comment'].includes(normalizedField)) return 'content';
    if (['project', 'issuetype', 'issueType', 'status', 'transition', 'parent', 'assignee', 'relatedissue', 'relatedIssueKey'].includes(normalizedField)) return 'routing';
    return 'metadata';
}

function buildMutationValueDescriptor(value, fallbackDisplay = '(empty)') {
    const raw = serializeMutationRawValue(value);
    const rawText = raw || '';
    const kind = detectMutationValueKind(value, rawText);
    const lineCount = rawText.length > 0 ? rawText.split(/\r?\n/).length : 0;
    const isLongText = rawText.length > 180 || lineCount > 4;

    return {
        raw: rawText,
        kind,
        lineCount,
        isLongText,
        display: fallbackDisplay,
    };
}

function normalizeMutationNotes(notes = []) {
    if (!Array.isArray(notes)) return [];
    return notes
        .filter(isNonEmptyString)
        .map(note => note.trim())
        .filter(Boolean);
}

function normalizeMutationChanges(changes = []) {
    if (!Array.isArray(changes)) return [];

    return changes
        .map(change => {
            if (!change || typeof change !== 'object') return null;

            const beforeDisplay = normalizeMutationDisplayValue(change.beforeDisplay ?? change.before);
            const afterDisplay = normalizeMutationDisplayValue(change.afterDisplay ?? change.after);
            const beforeDescriptor = buildMutationValueDescriptor(change.beforeRaw ?? change.before, beforeDisplay);
            const afterDescriptor = buildMutationValueDescriptor(change.afterRaw ?? change.after, afterDisplay);
            const explicitChangeType = isNonEmptyString(change.changeType) ? change.changeType.trim() : '';
            const changeType = explicitChangeType || (() => {
                const beforeEmpty = beforeDisplay === '(empty)';
                const afterEmpty = afterDisplay === '(empty)';
                if (beforeEmpty && !afterEmpty) return 'add';
                if (!beforeEmpty && afterEmpty) return 'remove';
                if (beforeDisplay === afterDisplay) return 'unchanged';
                return 'replace';
            })();

            if (changeType === 'unchanged' && !change.includeUnchanged) {
                return null;
            }

            return {
                field: isNonEmptyString(change.field) ? change.field.trim() : 'value',
                label: isNonEmptyString(change.label) ? change.label.trim() : (isNonEmptyString(change.field) ? change.field.trim() : 'Value'),
                changeType,
                beforeDisplay,
                afterDisplay,
                beforeRaw: beforeDescriptor.raw,
                afterRaw: afterDescriptor.raw,
                beforeKind: beforeDescriptor.kind,
                afterKind: afterDescriptor.kind,
                beforeLineCount: beforeDescriptor.lineCount,
                afterLineCount: afterDescriptor.lineCount,
                isLongText: beforeDescriptor.isLongText || afterDescriptor.isLongText,
                importance: isNonEmptyString(change.importance) ? change.importance.trim() : getMutationFieldImportance(change.field),
                group: isNonEmptyString(change.group) ? change.group.trim() : getMutationFieldGroup(change.field),
            };
        })
        .filter(Boolean);
}

function buildMutationSubject(subject = {}) {
    const id = isNonEmptyString(subject.id) ? subject.id.trim() : '';
    const url = isNonEmptyString(subject.url) ? subject.url.trim() : undefined;
    const title = isNonEmptyString(subject.title) ? subject.title.trim() : '';
    const label = isNonEmptyString(subject.label)
        ? subject.label.trim()
        : [id, title].filter(Boolean).join(' - ');

    return {
        id,
        url,
        title,
        label: label || id || title || 'Target resource',
    };
}

function getMutationOperationKind(changes = [], effect = 'write') {
    if (effect === 'delete') return 'delete';
    if (!Array.isArray(changes) || changes.length === 0) return effect === 'write' ? 'update' : effect;

    const changeTypes = changes
        .map(change => isNonEmptyString(change?.changeType) ? change.changeType.trim() : '')
        .filter(Boolean);

    if (changeTypes.length > 0 && changeTypes.every(type => type === 'add')) return 'create';
    if (changeTypes.length > 0 && changeTypes.every(type => type === 'remove')) return 'remove';
    return 'update';
}

function buildMutationPreview({ guardrail, title, subject, changes, notes, consequence }) {
    const normalizedGuardrail = guardrail || {};
    const normalizedChanges = normalizeMutationChanges(changes);
    return {
        displayVersion: 2,
        kind: 'mutation-preview',
        provider: normalizedGuardrail.provider || 'jira',
        resourceType: normalizedGuardrail.resourceType || 'ticket',
        effect: normalizedGuardrail.effect || 'write',
        operationKind: getMutationOperationKind(normalizedChanges, normalizedGuardrail.effect || 'write'),
        impactLevel: normalizedGuardrail.impactLevel || 'high',
        actionLabel: normalizedGuardrail.actionLabel || 'apply a mutation',
        title: isNonEmptyString(title) ? title.trim() : 'Approval required',
        subject: buildMutationSubject(subject),
        changes: normalizedChanges,
        notes: normalizeMutationNotes(notes),
        consequence: isNonEmptyString(consequence) ? consequence.trim() : undefined,
    };
}

function buildMutationReceipt({ guardrail, title, subject, changes, notes, outcome, approval }) {
    const normalizedGuardrail = guardrail || {};
    const normalizedChanges = normalizeMutationChanges(changes);
    return {
        displayVersion: 2,
        kind: 'mutation-receipt',
        provider: normalizedGuardrail.provider || 'jira',
        resourceType: normalizedGuardrail.resourceType || 'ticket',
        effect: normalizedGuardrail.effect || 'write',
        operationKind: getMutationOperationKind(normalizedChanges, normalizedGuardrail.effect || 'write'),
        impactLevel: normalizedGuardrail.impactLevel || 'high',
        actionLabel: normalizedGuardrail.actionLabel || 'apply a mutation',
        title: isNonEmptyString(title) ? title.trim() : 'Mutation completed',
        subject: buildMutationSubject(subject),
        changes: normalizedChanges,
        notes: normalizeMutationNotes(notes),
        outcome: isNonEmptyString(outcome) ? outcome.trim() : undefined,
        approval: approval && typeof approval === 'object'
            ? {
                approved: approval.approved !== false,
                mode: approval.mode || 'unknown',
            }
            : undefined,
    };
}

function buildMutationResultGuardrail(guardrail, approval, overrides = {}) {
    if (!guardrail) return undefined;

    return {
        provider: guardrail.provider || 'jira',
        resourceType: guardrail.resourceType || 'ticket',
        effect: guardrail.effect || 'write',
        impactLevel: guardrail.impactLevel || 'high',
        requiresApproval: guardrail.requiresApproval === true,
        actionLabel: guardrail.actionLabel || 'apply a mutation',
        approval: approval && typeof approval === 'object'
            ? {
                approved: approval.approved !== false,
                mode: approval.mode || 'unknown',
            }
            : undefined,
        ...overrides,
    };
}

function createMutationFieldChange({ field, label, before, after, changeType, includeUnchanged = false }) {
    const beforeDisplay = normalizeMutationDisplayValue(before);
    const afterDisplay = normalizeMutationDisplayValue(after);
    const beforeDescriptor = buildMutationValueDescriptor(before, beforeDisplay);
    const afterDescriptor = buildMutationValueDescriptor(after, afterDisplay);
    const resolvedChangeType = changeType || (() => {
        const beforeEmpty = beforeDisplay === '(empty)';
        const afterEmpty = afterDisplay === '(empty)';
        if (beforeEmpty && !afterEmpty) return 'add';
        if (!beforeEmpty && afterEmpty) return 'remove';
        if (beforeDisplay === afterDisplay) return 'unchanged';
        return 'replace';
    })();

    if (resolvedChangeType === 'unchanged' && !includeUnchanged) {
        return null;
    }

    return {
        field,
        label: label || field,
        changeType: resolvedChangeType,
        beforeDisplay,
        afterDisplay,
        beforeRaw: beforeDescriptor.raw,
        afterRaw: afterDescriptor.raw,
        beforeKind: beforeDescriptor.kind,
        afterKind: afterDescriptor.kind,
        beforeLineCount: beforeDescriptor.lineCount,
        afterLineCount: afterDescriptor.lineCount,
        isLongText: beforeDescriptor.isLongText || afterDescriptor.isLongText,
        importance: getMutationFieldImportance(field),
        group: getMutationFieldGroup(field),
        includeUnchanged,
    };
}

function formatMutationPreviewLine(change) {
    if (!change || typeof change !== 'object') return '';

    const label = change.label || change.field || 'Value';
    if (change.changeType === 'add') {
        return `${label}: set to ${change.afterDisplay}`;
    }
    if (change.changeType === 'remove') {
        return `${label}: removed (${change.beforeDisplay})`;
    }
    return `${label}: ${change.beforeDisplay} -> ${change.afterDisplay}`;
}

function normalizeApprovalText(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function buildExpectedJiraMutationApproval(toolName, context = {}) {
    const guardrail = buildJiraMutationGuardrailMetadata(toolName) || {};
    const ticketId = isNonEmptyString(context.ticketId) ? context.ticketId.trim().toUpperCase() : '';
    const relatedIssueKey = isNonEmptyString(context.relatedIssueKey) ? context.relatedIssueKey.trim().toUpperCase() : '';
    const commentId = isNonEmptyString(context.commentId) ? String(context.commentId).trim().toUpperCase() : '';

    if (guardrail.provider === 'confluence') {
        switch (toolName) {
            case 'create_confluence_page':
                return 'APPROVE CREATE CONFLUENCE PAGE';
            case 'update_confluence_page':
                return ticketId ? `APPROVE UPDATE PAGE ${ticketId}` : 'APPROVE UPDATE CONFLUENCE PAGE';
            case 'delete_confluence_page':
                return ticketId ? `APPROVE DELETE PAGE ${ticketId}` : 'APPROVE DELETE CONFLUENCE PAGE';
            default:
                return 'APPROVE CONFLUENCE MUTATION';
        }
    }

    switch (toolName) {
        case 'create_jira_ticket':
            return 'APPROVE CREATE JIRA TICKET';
        case 'assign_jira_ticket':
            return ticketId ? `APPROVE ASSIGN ${ticketId}` : 'APPROVE ASSIGN JIRA TICKET';
        case 'remove_jira_issue_link':
            if (ticketId && relatedIssueKey) return `APPROVE UNLINK ${ticketId} ${relatedIssueKey}`;
            if (ticketId) return `APPROVE UNLINK ${ticketId}`;
            return 'APPROVE UNLINK JIRA ISSUES';
        case 'transition_jira_ticket':
            return ticketId ? `APPROVE TRANSITION ${ticketId}` : 'APPROVE TRANSITION JIRA TICKET';
        case 'update_jira_ticket':
            return ticketId ? `APPROVE UPDATE ${ticketId}` : 'APPROVE UPDATE JIRA TICKET';
        case 'delete_jira_comment':
            if (ticketId && commentId) return `APPROVE DELETE COMMENT ${commentId} ON ${ticketId}`;
            if (commentId) return `APPROVE DELETE COMMENT ${commentId}`;
            return 'APPROVE DELETE JIRA COMMENT';
        case 'edit_jira_comment':
            if (ticketId && commentId) return `APPROVE EDIT COMMENT ${commentId} ON ${ticketId}`;
            if (commentId) return `APPROVE EDIT COMMENT ${commentId}`;
            return 'APPROVE EDIT JIRA COMMENT';
        case 'log_jira_work':
            return ticketId ? `APPROVE LOG WORK ${ticketId}` : 'APPROVE LOG JIRA WORK';
        case 'update_jira_estimates':
            return ticketId ? `APPROVE UPDATE ESTIMATES ${ticketId}` : 'APPROVE UPDATE JIRA ESTIMATES';
        default:
            return 'APPROVE JIRA MUTATION';
    }
}

function buildJiraMutationGuardrailMetadata(toolName, overrides = {}) {
    const base = JIRA_MUTATION_GUARDRAILS[toolName];
    if (!base) return null;
    return {
        ...base,
        ...overrides,
    };
}

function buildJiraMutationPreviewLines(lines = [], preview = null) {
    const fromStructuredPreview = preview && typeof preview === 'object' && Array.isArray(preview.changes)
        ? preview.changes.map(formatMutationPreviewLine).filter(Boolean)
        : [];
    const fromNotes = preview && typeof preview === 'object' && Array.isArray(preview.notes)
        ? preview.notes.filter(isNonEmptyString).map(note => note.trim())
        : [];
    const filtered = [...fromStructuredPreview, ...fromNotes, ...(Array.isArray(lines)
        ? lines.filter(isNonEmptyString).map(line => line.trim())
        : [])];

    return filtered.length > 0 ? filtered : ['No preview details were provided.'];
}

function isApprovalAnswer(answer) {
    const normalized = normalizeApprovalText(
        typeof answer === 'string'
            ? answer
            : answer?.answer
    );

    return normalized.includes('APPROVE')
        || normalized.includes('YES')
        || normalized.includes('PROCEED');
}

function buildJiraMutationApprovalPrompt({ guardrail, previewLines, preview, consequence, expectedApproval }) {
    const builtPreviewLines = buildJiraMutationPreviewLines(previewLines, preview);
    const previewText = builtPreviewLines
        .slice(0, 4)
        .map(line => `- ${line}`)
        .join('\n');
    const providerLabel = guardrail?.provider === 'confluence' ? 'Confluence' : 'Jira';
    const extraLineCount = Math.max(0, builtPreviewLines.length - 4);

    return [
        `**Approval required for ${providerLabel} change**`,
        '',
        `The agent is about to ${guardrail.actionLabel}.`,
        'Review the change summary below, then choose Approve change or Cancel.',
        '',
        'Top changes:',
        previewText,
        extraLineCount > 0 ? `- +${extraLineCount} more detail line${extraLineCount === 1 ? '' : 's'} available in the review panel.` : '',
        '',
        `Impact: ${String(guardrail.impactLevel || 'high').toUpperCase()}`,
        isNonEmptyString(consequence) ? `Consequence: ${consequence.trim()}` : '',
        '',
        'Select Approve change to continue.',
        `If chat approval is unavailable, reply with: ${expectedApproval}`,
    ].filter(Boolean).join('\n');
}

function buildJiraMutationApprovalFailure({ approval, ticketId, ticketUrl, previewLines, preview }) {
    const rejected = approval.mode === 'rejected';
    const structuredPreview = preview && typeof preview === 'object'
        ? preview
        : buildMutationPreview({
            guardrail: approval.guardrail,
            subject: { id: ticketId, url: ticketUrl },
            changes: [],
            notes: buildJiraMutationPreviewLines(previewLines),
        });

    return {
        success: false,
        ticketId,
        ticketUrl,
        error: rejected
            ? 'Jira mutation was cancelled because approval was not granted.'
            : 'This Jira mutation requires explicit approval before it can continue.',
        hint: rejected
            ? 'Retry only after explicitly approving the change.'
            : 'Approve the change in chat, or reply with the exact approval phrase and retry.',
        expectedApproval: approval.expectedApproval,
        preview: structuredPreview,
        previewLines: buildJiraMutationPreviewLines(previewLines, structuredPreview),
        guardrail: buildMutationResultGuardrail(approval.guardrail, { approved: false, mode: approval.mode }, {
            approvalMode: approval.mode,
        }),
        latestUserMessage: !rejected && isNonEmptyString(approval.latestUserMessage)
            ? approval.latestUserMessage
            : undefined,
    };
}

async function requireJiraMutationApproval({ deps, toolName, previewLines, preview, consequence, ticketId, relatedIssueKey, commentId }) {
    const guardrail = buildJiraMutationGuardrailMetadata(toolName);
    if (!guardrail?.requiresApproval) {
        return {
            approved: true,
            guardrail,
            mode: 'not-required',
            expectedApproval: null,
            preview,
        };
    }

    const latestUserMessage = getLatestUserMessageText(deps);
    const expectedApproval = buildExpectedJiraMutationApproval(toolName, { ticketId, relatedIssueKey, commentId });
    const resolvedPreview = preview && typeof preview === 'object'
        ? preview
        : buildMutationPreview({
            guardrail,
            subject: { id: ticketId },
            changes: [],
            notes: buildJiraMutationPreviewLines(previewLines),
            consequence,
        });

    if (deps?.chatManager?.broadcastToolProgress) {
        deps.chatManager.broadcastToolProgress(toolName, {
            phase: 'approval',
            message: 'Awaiting explicit user approval...',
        });
    }

    if (typeof deps?.chatManager?.requestUserInput === 'function') {
        const sessionId = resolveActiveSessionId(undefined, deps) || 'default';
        const response = await deps.chatManager.requestUserInput(
            buildJiraMutationApprovalPrompt({
                guardrail,
                previewLines,
                preview: resolvedPreview,
                consequence,
                expectedApproval,
            }),
            ['Approve change', 'Cancel'],
            {
                type: 'confirmation',
                sessionId,
                mutationPreview: resolvedPreview,
                guardrail,
                expectedApproval,
            }
        );

        if (isApprovalAnswer(response)) {
            return {
                approved: true,
                guardrail,
                mode: 'interactive',
                expectedApproval,
                preview: resolvedPreview,
            };
        }

        return {
            approved: false,
            guardrail,
            mode: 'rejected',
            expectedApproval,
            latestUserMessage,
            preview: resolvedPreview,
        };
    }

    if (normalizeApprovalText(latestUserMessage).includes(normalizeApprovalText(expectedApproval))) {
        return {
            approved: true,
            guardrail,
            mode: 'latest-user-message',
            expectedApproval,
            preview: resolvedPreview,
        };
    }

    return {
        approved: false,
        guardrail,
        mode: 'missing-confirmation',
        expectedApproval,
        latestUserMessage,
        preview: resolvedPreview,
    };
}


module.exports = {
    JIRA_MUTATION_GUARDRAILS,
    normalizeMutationDisplayValue,
    serializeMutationRawValue,
    detectMutationValueKind,
    getMutationFieldImportance,
    getMutationFieldGroup,
    buildMutationValueDescriptor,
    normalizeMutationNotes,
    normalizeMutationChanges,
    buildMutationSubject,
    getMutationOperationKind,
    buildMutationPreview,
    buildMutationReceipt,
    buildMutationResultGuardrail,
    createMutationFieldChange,
    formatMutationPreviewLine,
    normalizeApprovalText,
    buildExpectedJiraMutationApproval,
    buildJiraMutationGuardrailMetadata,
    buildJiraMutationPreviewLines,
    isApprovalAnswer,
    buildJiraMutationApprovalPrompt,
    buildJiraMutationApprovalFailure,
    requireJiraMutationApproval,
};
