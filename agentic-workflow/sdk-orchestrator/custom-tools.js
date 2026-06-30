/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOM TOOLS — SDK Tool Definitions
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Exposes existing system capabilities (framework inventory, error analysis,
 * script validation, learning store, assertion config, popup handler) as
 * Copilot SDK tools that the AI can call during sessions.
 *
 * Helper functions have been extracted to tools/ modules for reusability.
 * The createCustomTools() function below creates all SDK tools per agent role.
 *
 * @module custom-tools
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { markdownToAdf, markdownToWikiMarkup, injectMentionSyntax } = require('./adf-converter');
const {
    normalizeJiraTicketInput,
    normalizeConfluencePageInput,
} = require('./atlassian-url-utils');

// ─── Extracted helper modules ────────────────────────────────────────────────
const {
    VALID_IMAGE_MIME_TYPES, VALID_VIDEO_MIME_TYPES,
    COMMENT_IMAGE_EXTENSIONS, COMMENT_IMAGE_MIME_MAP,
    COMMENT_VIDEO_EXTENSIONS, COMMENT_VIDEO_MIME_MAP,
    JIRA_MAX_ATTACHMENT_SIZE, JIRA_TICKET_KEY_PATTERN,
    PROJECT_ROOT,
    SAFE_COMMIT_ROOT_PREFIXES, SAFE_COMMIT_ROOT_FILES,
    SAFE_COMMIT_EXCLUDED_PREFIXES, SAFE_COMMIT_EXCLUDED_EXTENSIONS,
} = require('./tools/constants');

const {
    isNonEmptyString, applyMentions,
    resolveActiveSessionId, getActiveSessionEntry,
    isValidTicketKey, getLatestUserMessageText,
    getConfluenceProvider, formatConfluencePage,
    formatConfluenceSpace, annotateConfluenceTreeDepth,
    classifyJiraTimeTrackingIntent,
} = require('./tools/general-helpers');

const {
    PPTX_SUPPORTED_SLIDE_TYPES,
    isPlainObject, collectStructuredTextValues, hasStructuredTextValue,
    slideHasAnyContent, getSlideTableShape, validatePptxSlides,
    getJiraTimeTrackingIntentContext, classifyJiraLabelIntent,
    buildJiraTimeIntentGuardResult,
} = require('./tools/pptx-validation');

const {
    JIRA_MUTATION_GUARDRAILS,
    normalizeMutationDisplayValue, serializeMutationRawValue,
    detectMutationValueKind, getMutationFieldImportance,
    getMutationFieldGroup, buildMutationValueDescriptor,
    normalizeMutationNotes, normalizeMutationChanges,
    buildMutationSubject, getMutationOperationKind,
    buildMutationPreview, buildMutationReceipt,
    buildMutationResultGuardrail, createMutationFieldChange,
    formatMutationPreviewLine, normalizeApprovalText,
    buildExpectedJiraMutationApproval, buildJiraMutationGuardrailMetadata,
    buildJiraMutationPreviewLines, isApprovalAnswer,
    buildJiraMutationApprovalPrompt, buildJiraMutationApprovalFailure,
    requireJiraMutationApproval,
} = require('./tools/mutation-helpers');

const {
    getJiraAttachmentConfig, getJiraApiConfig,
    buildJiraIssueApiUrl, buildJiraAgileApiUrl, buildJiraBrowseUrl,
    splitCommaSeparated, normalizeMaxResults, parseJsonObjectInput,
    parseJiraErrorBody, buildJiraErrorHint, formatJiraErrorResponse,
    normalizeJiraUser, escapeJqlString,
    buildJiraTextSearchJql, buildJiraEpicSearchJql,
    executeJiraIssueSearch,
    formatJiraSearchIssue, formatJiraIssueReference,
    formatJiraSubtasks, formatJiraIssueLinks,
    formatJiraEpicRelationship, formatJiraEpicSearchResult,
    formatJiraEpicDetails, selectJiraSubtaskIssueType,
    fetchJiraCreateIssueTypes,
    formatJiraDateTime, buildJiraAttachmentUrl,
    sanitizeFileName, buildMultipartPayload, buildJiraAttachmentHeaders,
} = require('./tools/jira-api-helpers');

const {
    getEvidenceItemTimestamp, resolveEvidenceScopeMessageId,
    isEvidenceItemInScope, collectSessionEvidence,
    collectSessionDocuments, findSessionDocument,
    selectVideoFrames, resolveWorkspaceFilePath,
    createUniqueAttachmentFileName, formatAttachmentSize,
    createCommentScreenshotFileName, createCommentFrameFileName,
    createAdfTextNode, appendAdfBulletSection,
    buildJiraMediaCommentWikiBody, buildJiraMediaCommentAdf,
    cleanupJiraMediaCommentPlan, getImageMimeTypeForFile,
    uploadJiraAttachment,
    stripHtmlTags, normalizeWhitespace, extractTextFromAdf,
    normalizeJiraText, attachEvidenceToJira, addCommentWithMediaToJira,
} = require('./tools/evidence-helpers');

const {
    normalizeJiraCommentVisibility, getJiraCommentCollection,
    buildRenderedCommentLookup, formatSingleJiraComment,
    formatJiraComments, buildJiraIssueCommentsUrl,
    fetchCompleteJiraComments,
    formatJiraTimetracking, formatJiraFieldCapability,
    countStructuredClauses,
} = require('./tools/jira-comment-helpers');

const {
    computeSparseTicketScore, buildSparseKbQueries,
    enrichSparseTicketWithKnowledgeBase,
} = require('./tools/sparse-ticket-helpers');

const { ToolResultCache, getToolCache,
    normalizeDeleteConfirmationText,
    buildExpectedJiraDeleteConfirmation,
    buildJiraDeleteFallbackSuggestions,
} = require('./tools/tool-cache');

const {
    formatJiraTicket,
    fetchJiraTicketState,
} = require('./tools/jira-ticket-formatter');

function normalizeJiraLabelList(value) {
    const labels = Array.isArray(value)
        ? value
        : isNonEmptyString(value)
            ? splitCommaSeparated(value)
            : [];

    return Array.from(new Set(labels
        .filter(isNonEmptyString)
        .map(label => label.trim())
        .filter(Boolean)));
}

function buildJiraMutationSubject({ ticketId, ticketUrl, summary, title, label }) {
    const resolvedTitle = isNonEmptyString(summary)
        ? summary.trim()
        : (isNonEmptyString(title) ? title.trim() : '');

    return buildMutationSubject({
        id: ticketId,
        url: ticketUrl,
        title: resolvedTitle,
        label: isNonEmptyString(label)
            ? label.trim()
            : [ticketId, resolvedTitle].filter(Boolean).join(' - '),
    });
}

const {
    _relativePathIfInside, _findPlaywrightProjectRoot,
    _saveTestReport, _resolveWorkspaceSpecTarget,
    _countSpecFiles, _resolveLocalPlaywrightBinary,
    _findMatchingNpmScript, _shellSplit,
} = require('./tools/execution-helpers');

// ─── Environment loader ─────────────────────────────────────────────────────
function loadEnvVars() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
    } catch { /* dotenv may not be installed */ }
}
loadEnvVars();

/**
 * Create all custom tools for a specific agent role.
 *
 * @param {Function} defineTool     - SDK defineTool function
 * @param {string}   agentName      - Agent role
 * @param {Object}   deps           - Dependencies (learningStore, config)
 * @returns {Array}  Array of tool definitions
 */
function createCustomTools(defineTool, agentName, deps = {}) {
    const { learningStore, config, contextStore, groundingStore } = deps;
    const tools = [];

    tools.push(defineTool('commit_and_push_repo_changes', {
        description:
            'Safely commit and push repo changes for web-app/project work. ' +
            'Stages only source/config/skill/project files under .github/, agentic-workflow/, web-app/, and selected root config files. ' +
            'Automatically excludes test files, unit/integration tests, logs, test results, reports, exploration data, test cases, generated artifacts, and common temporary files. ' +
            'Use dryRun=true to preview exactly what would be committed before pushing.',
        parameters: {
            type: 'object',
            properties: {
                commitMessage: {
                    type: 'string',
                    description: 'Optional git commit message. If omitted, a concise message is generated from the staged safe files.',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, preview included and excluded files without staging, committing, or pushing.',
                },
                includePaths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional extra repo-relative files or folders to include when the needed change sits outside the default safe web-app/orchestrator/skills scope.',
                },
            },
        },
        handler: async ({ commitMessage, dryRun, includePaths }) => {
            try {
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('commit_and_push_repo_changes', {
                        phase: 'git',
                        message: dryRun ? 'Previewing safe git commit scope...' : 'Preparing safe git commit and push...',
                        step: 1,
                    });
                }

                const result = await runSafeCommitAndPush({ commitMessage, dryRun, includePaths }, deps);

                if (deps?.chatManager?.broadcastToolProgress && result?.success && !dryRun) {
                    deps.chatManager.broadcastToolProgress('commit_and_push_repo_changes', {
                        phase: 'git',
                        message: `Committed ${result.stagedFiles.length} files on ${result.branch}; pushing changes...`,
                        step: 2,
                    });
                }

                return JSON.stringify(result, null, 2);
            } catch (error) {
                return JSON.stringify({
                    success: false,
                    error: error.message,
                    stdout: error.stdout || '',
                    stderr: error.stderr || '',
                }, null, 2);
            }
        },
    }));

    if (agentName === 'docgenie') {
        tools.push(defineTool('list_session_documents', {
            description:
                'List document files uploaded in the current chat session. ' +
                'Use this before parsing a workbook, PDF, or deck attached by the user.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: {
                        type: 'string',
                        description: 'Optional chat session ID. Defaults to the current active session.',
                    },
                    latestOnly: {
                        type: 'boolean',
                        description: 'If true, restrict results to the latest evidence message when possible.',
                    },
                },
            },
            handler: async ({ sessionId, latestOnly }) => {
                const sessionResult = getActiveSessionEntry(sessionId, deps);
                if (sessionResult.error) {
                    return JSON.stringify({ success: false, error: sessionResult.error });
                }

                const { documents, scopeMessageId } = collectSessionDocuments(sessionResult.entry, { latestOnly });
                return JSON.stringify({
                    success: true,
                    sessionId: sessionResult.sessionId,
                    scopeMessageId,
                    totalDocuments: documents.length,
                    documents: documents.map((doc, index) => ({
                        index: index + 1,
                        filename: doc.filename || path.basename(doc.path),
                        mediaType: doc.media_type || '',
                        size: doc.size || 0,
                        messageId: doc.messageId || '',
                        timestamp: doc.timestamp || '',
                    })),
                }, null, 2);
            },
        }));

        tools.push(defineTool('parse_session_document', {
            description:
                'Parse a document uploaded in the current chat session by filename. ' +
                'Supports spreadsheet-specific options like sheet filtering and row sampling.',
            parameters: {
                type: 'object',
                properties: {
                    filename: {
                        type: 'string',
                        description: 'Optional uploaded filename to parse. Defaults to the latest uploaded document.',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Optional chat session ID. Defaults to the current active session.',
                    },
                    latestOnly: {
                        type: 'boolean',
                        description: 'If true, scope parsing to the latest evidence message when possible.',
                    },
                    maxChars: {
                        type: 'number',
                        description: 'Maximum characters to return for text-based documents.',
                    },
                    maxRows: {
                        type: 'number',
                        description: 'Maximum rows per sheet when parsing spreadsheets.',
                    },
                    sheets: {
                        type: 'string',
                        description: 'Comma-separated sheet names to parse for spreadsheets.',
                    },
                },
            },
            handler: async ({ filename, sessionId, latestOnly, maxChars, maxRows, sheets }) => {
                try {
                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    const { documents, scopeMessageId, match } = findSessionDocument(sessionResult.entry, filename, { latestOnly });
                    if (!match) {
                        return JSON.stringify({
                            success: false,
                            error: documents.length === 0
                                ? 'No uploaded documents are currently available in this chat session.'
                                : `No uploaded document matched "${filename}".`,
                            availableDocuments: documents.map(doc => doc.filename || path.basename(doc.path)),
                            scopeMessageId,
                        }, null, 2);
                    }

                    const { parseDocument } = require('./filesystem-tools');
                    const options = {};
                    if (Number.isFinite(Number(maxChars)) && Number(maxChars) > 0) options.maxChars = Number(maxChars);
                    if (Number.isFinite(Number(maxRows)) && Number(maxRows) > 0) options.maxRows = Number(maxRows);
                    if (isNonEmptyString(sheets)) {
                        options.sheets = sheets.split(',').map(sheet => sheet.trim()).filter(Boolean);
                    }

                    const result = await parseDocument(match.path, options);
                    return JSON.stringify({
                        success: true,
                        sessionId: sessionResult.sessionId,
                        scopeMessageId,
                        filename: match.filename || path.basename(match.path),
                        mediaType: match.media_type || '',
                        ...result,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));
    }

    tools.push(defineTool('publish_image_to_chat', {
        description:
            'Publish a local image file into the active chat as an assistant message. ' +
            'Use this after taking a screenshot or generating an image artifact when the user asked to see proof inline in chat. ' +
            'Provide a short caption such as the MLS name or validation result.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or workspace-relative path to an image file (png, jpg, jpeg, gif, webp).',
                },
                caption: {
                    type: 'string',
                    description: 'Optional text shown above the image in the assistant message.',
                },
                altText: {
                    type: 'string',
                    description: 'Optional alt text for the image.',
                },
                sessionId: {
                    type: 'string',
                    description: 'Optional chat session ID. Defaults to the current active session.',
                },
            },
            required: ['filePath'],
        },
        handler: async ({ filePath, caption, altText, sessionId }) => {
            try {
                const sessionResult = getActiveSessionEntry(sessionId, deps);
                if (sessionResult.error) {
                    return JSON.stringify({ success: false, error: sessionResult.error });
                }

                const rawPath = String(filePath || '').trim();
                const resolvedPath = path.isAbsolute(rawPath)
                    ? rawPath
                    : path.join(__dirname, '..', '..', rawPath);

                if (!fs.existsSync(resolvedPath)) {
                    return JSON.stringify({ success: false, error: `Image file not found: ${resolvedPath}` });
                }

                const mimeType = getImageMimeTypeForFile(resolvedPath);
                if (!mimeType || !VALID_IMAGE_MIME_TYPES.has(mimeType)) {
                    return JSON.stringify({
                        success: false,
                        error: 'Unsupported image file. Supported extensions: .png, .jpg, .jpeg, .gif, .webp',
                    });
                }

                const publishResult = deps.chatManager.publishAssistantImage(sessionResult.sessionId, {
                    filePath: resolvedPath,
                    caption,
                    altText,
                });

                return JSON.stringify({
                    success: true,
                    sessionId: sessionResult.sessionId,
                    messageId: publishResult.messageId,
                    filePath: resolvedPath,
                    attachment: {
                        name: publishResult.attachment.name,
                        type: publishResult.attachment.type,
                        size: publishResult.attachment.size,
                    },
                }, null, 2);
            } catch (error) {
                return JSON.stringify({ success: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL 1: get_framework_inventory
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('get_framework_inventory', {
            description:
                'Scans the test framework codebase and returns all available page object classes, ' +
                'methods, locators, business functions, utility functions, popup handlers, and ' +
                'test data exports. Use this BEFORE writing any imports to know what already exists.',
            parameters: {
                type: 'object',
                properties: {
                    includeLocators: {
                        type: 'boolean',
                        description: 'Include locator strings from page objects (default: false)',
                    },
                },
            },
            handler: async ({ includeLocators }) => {
                try {
                    const { getFrameworkInventoryCache, getInventorySummary } =
                        require('../utils/project-path-resolver');
                    const inventory = getFrameworkInventoryCache();

                    if (includeLocators) {
                        return JSON.stringify(inventory, null, 2);
                    }
                    return getInventorySummary(inventory);
                } catch (error) {
                    return `Error loading framework inventory: ${error.message}`;
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 2: validate_generated_script
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('validate_generated_script', {
            description:
                'Validates a generated Playwright .spec.js file against framework conventions. ' +
                'Checks for anti-patterns (AP001-AP006), phantom imports, deprecated methods, ' +
                'selector quality, serial execution, popup handler usage, and more. ' +
                'Returns a structured report with errors and warnings.',
            parameters: {
                type: 'object',
                properties: {
                    scriptPath: {
                        type: 'string',
                        description: 'Absolute or workspace-relative path to the .spec.js file',
                    },
                },
                required: ['scriptPath'],
            },
            handler: async ({ scriptPath }) => {
                try {
                    // Broadcast progress: starting validation
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('validate_generated_script', {
                            phase: 'validation', message: `Validating ${path.basename(scriptPath || '')}...`, step: 1,
                        });
                    }
                    const { validateGeneratedScript } = require('../scripts/validate-script');
                    const resolvedPath = path.isAbsolute(scriptPath)
                        ? scriptPath
                        : path.join(__dirname, '..', '..', scriptPath);

                    if (!fs.existsSync(resolvedPath)) {
                        return JSON.stringify({ valid: false, errors: [`File not found: ${resolvedPath}`] });
                    }

                    const content = fs.readFileSync(resolvedPath, 'utf-8');
                    // Capture console output
                    const originalLog = console.log;
                    const logs = [];
                    console.log = (...args) => logs.push(args.join(' '));

                    const result = validateGeneratedScript(resolvedPath, content);

                    console.log = originalLog;

                    return JSON.stringify({
                        valid: result.valid,
                        errors: result.errors,
                        warnings: result.warnings,
                        consoleOutput: logs.join('\n'),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ valid: false, errors: [`Validation error: ${error.message}`] });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 3: get_historical_failures
    // Available to: scriptgenerator (for learning from past mistakes)
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName) && learningStore) {
        tools.push(defineTool('get_historical_failures', {
            description:
                'Returns historical failure data from previous test runs. Shows which selectors ' +
                'broke, what fixes worked, and common issues per page/feature. Use this to avoid ' +
                'repeating known mistakes and to prefer stable selectors.',
            parameters: {
                type: 'object',
                properties: {
                    page: {
                        type: 'string',
                        description: 'Page URL or feature name to filter failures for',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to filter failures for',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of failures to return (default: 20)',
                    },
                },
            },
            handler: async ({ page, ticketId, limit }) => {
                const cache = getToolCache();
                const cacheKey = `historical_failures:${ticketId || ''}:${page || ''}:${limit || 20}`;

                return cache.getOrCompute(cacheKey, async () => {
                    try {
                        let failures;
                        if (ticketId) {
                            failures = learningStore.getFailuresForTicket(ticketId);
                        } else if (page) {
                            failures = learningStore.getFailuresForPage(page);
                        } else {
                            failures = learningStore.getRecentFailures(limit || 20);
                        }

                        const stableMappings = learningStore.getStableSelectors(page);

                        return JSON.stringify({
                            failures,
                            stableSelectors: stableMappings,
                            summary: `${failures.length} historical failures found, ${stableMappings.length} stable selector mappings`,
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({ failures: [], error: error.message });
                    }
                }, 2 * 60 * 1000); // 2 min TTL — failures update more frequently
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 4: get_exploration_data
    // Available to: scriptgenerator, codereviewer
    // ───────────────────────────────────────────────────────────────────
    const validateExplorationPayload = (data, expectedTicketId = null) => {
        const errors = [];
        const warnings = [];
        const semanticMetrics = [];

        const INTERACTIVE_ROLES = new Set([
            'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox',
            'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
            'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
            'treeitem', 'gridcell', 'columnheader', 'rowheader',
            'input', 'select', 'textarea',
        ]);

        const NON_SEMANTIC_ROLES = new Set(['generic', 'presentation', 'none', 'separator']);
        const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');
        const hasSignal = (...values) => values.some(value => asTrimmedString(value).length > 0);

        const getSnapshotSemanticMetrics = (snapshot) => {
            const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
            const roleSet = new Set();
            let selectorAnchoredElements = 0;
            let contentBearingElements = 0;
            let semanticElements = 0;
            let interactiveElements = 0;

            for (const element of elements) {
                if (!element || typeof element !== 'object' || Array.isArray(element)) {
                    continue;
                }

                const role = asTrimmedString(element.role || element.ariaRole).toLowerCase();
                const strategy = asTrimmedString(element.strategy).toLowerCase();
                const selector = asTrimmedString(element.selector || element.css || element.xpath);

                const hasSelectorAnchor = hasSignal(
                    element.ref,
                    element.selector,
                    element.css,
                    element.xpath,
                    element.testId,
                    element.dataTestId,
                    element.dataQa,
                    element.bestSelector,
                    element.locator,
                    element.ariaLabel
                );

                const hasContentSignal = hasSignal(
                    element.text,
                    element.name,
                    element.placeholder,
                    element.value,
                    element.label,
                    element.title,
                    element.ariaLabel,
                    element.alt
                );

                const hasSemanticSignal = role.length > 0 ||
                    strategy.startsWith('get_by_') ||
                    hasSignal(element.ariaLabel, element.label);

                const hasInteractiveSignal = INTERACTIVE_ROLES.has(role) ||
                    ['get_by_role', 'get_by_test_id', 'get_by_label', 'get_by_text', 'get_by_placeholder'].includes(strategy) ||
                    /(button|input|select|textarea|\[role=|\ba\[)/i.test(selector);

                if (hasSelectorAnchor) {
                    selectorAnchoredElements++;
                }
                if (hasContentSignal) {
                    contentBearingElements++;
                }
                if (hasSemanticSignal) {
                    semanticElements++;
                }
                if (hasInteractiveSignal) {
                    interactiveElements++;
                }

                if (role && !NON_SEMANTIC_ROLES.has(role)) {
                    roleSet.add(role);
                }
            }

            return {
                selectorAnchoredElements,
                contentBearingElements,
                semanticElements,
                interactiveElements,
                roleDiversity: roleSet.size,
                totalElements: elements.length,
            };
        };

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return {
                valid: false,
                errors: ['explorationData must be a JSON object'],
                warnings,
                normalized: null,
            };
        }

        const allowedSources = new Set(['mcp-live-snapshot', 'mcp-snapshot']);
        if (!allowedSources.has(data.source)) {
            errors.push('source must be "mcp-live-snapshot" or "mcp-snapshot"');
        }

        if (!Array.isArray(data.snapshots) || data.snapshots.length === 0) {
            errors.push('snapshots array must be non-empty');
        } else {
            data.snapshots.forEach((snapshot, index) => {
                if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
                    errors.push(`snapshots[${index}] must be an object`);
                    return;
                }
                if (!snapshot.url || typeof snapshot.url !== 'string') {
                    errors.push(`snapshots[${index}].url must be a non-empty string`);
                }
                if (!Array.isArray(snapshot.elements) || snapshot.elements.length === 0) {
                    errors.push(`snapshots[${index}].elements must be a non-empty array`);
                    return;
                }

                const invalidElementCount = snapshot.elements.filter((el) => {
                    if (!el || typeof el !== 'object' || Array.isArray(el)) return true;
                    return !(el.ref || el.role || el.name || el.selector || el.text);
                }).length;

                if (invalidElementCount > 0) {
                    errors.push(`snapshots[${index}].elements contains ${invalidElementCount} invalid element(s) missing ref/role/name/selector/text`);
                }

                const metrics = getSnapshotSemanticMetrics(snapshot);
                semanticMetrics.push({ index, ...metrics, url: snapshot.url });

                const minSelectors = Math.min(2, metrics.totalElements);
                const minContentSignals = Math.min(2, metrics.totalElements);
                const minSemanticSignals = Math.min(2, metrics.totalElements);
                const minRoleDiversity = metrics.totalElements >= 6 ? 2 : 1;
                const minInteractiveSignals = metrics.totalElements >= 3 ? 1 : 0;

                if (metrics.selectorAnchoredElements < minSelectors) {
                    errors.push(
                        `snapshots[${index}] semantic depth failure: expected >=${minSelectors} selector-anchored element(s), got ${metrics.selectorAnchoredElements}`
                    );
                }

                if (metrics.contentBearingElements < minContentSignals) {
                    errors.push(
                        `snapshots[${index}] semantic depth failure: expected >=${minContentSignals} content-bearing element(s), got ${metrics.contentBearingElements}`
                    );
                }

                if (metrics.semanticElements < minSemanticSignals) {
                    errors.push(
                        `snapshots[${index}] semantic depth failure: expected >=${minSemanticSignals} semantic element(s) (role/aria/get_by), got ${metrics.semanticElements}`
                    );
                }

                if (metrics.roleDiversity < minRoleDiversity) {
                    errors.push(
                        `snapshots[${index}] semantic depth failure: expected role diversity >=${minRoleDiversity}, got ${metrics.roleDiversity}`
                    );
                }

                if (metrics.interactiveElements < minInteractiveSignals) {
                    errors.push(
                        `snapshots[${index}] semantic depth failure: expected >=${minInteractiveSignals} interactive evidence element(s), got ${metrics.interactiveElements}`
                    );
                }

                if (metrics.totalElements < 5) {
                    warnings.push(
                        `snapshots[${index}] has only ${metrics.totalElements} element(s); consider deeper exploration for stronger selector coverage`
                    );
                }
            });
        }

        if (data.pagesVisited !== undefined && !Array.isArray(data.pagesVisited)) {
            errors.push('pagesVisited must be an array when provided');
        }

        if (expectedTicketId && data.ticketId && data.ticketId !== expectedTicketId) {
            warnings.push(`ticketId mismatch: expected ${expectedTicketId}, got ${data.ticketId}`);
        }

        const selectorCount = Number.isFinite(data.selectorCount)
            ? data.selectorCount
            : (Array.isArray(data.snapshots)
                ? data.snapshots.reduce((sum, snap) => sum + ((snap?.elements?.length) || 0), 0)
                : 0);

        const normalized = {
            ...data,
            ticketId: data.ticketId || expectedTicketId || null,
            timestamp: data.timestamp || new Date().toISOString(),
            pagesVisited: Array.isArray(data.pagesVisited) ? data.pagesVisited : [],
            popupsDetected: Array.isArray(data.popupsDetected) ? data.popupsDetected : [],
            selectorCount,
            semanticDepth: {
                validatedSnapshots: semanticMetrics.length,
                metrics: semanticMetrics,
            },
        };

        if (normalized.pagesVisited.length === 0) {
            warnings.push('pagesVisited is empty; include visited URLs for stronger traceability');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            normalized,
        };
    };

    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('get_exploration_data', {
            description:
                'Returns previously captured MCP exploration data for a ticket. Contains ' +
                'accessibility snapshots, extracted selectors, page URLs visited, and detected popups.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId }) => {
                try {
                    const explorationDir = path.join(__dirname, '..', 'exploration-data');
                    const explorationFile = path.join(explorationDir, `${ticketId}-exploration.json`);

                    if (!fs.existsSync(explorationFile)) {
                        return JSON.stringify({
                            found: false,
                            message: `No exploration data found for ${ticketId}. MCP exploration must be performed first.`,
                        });
                    }

                    const data = JSON.parse(fs.readFileSync(explorationFile, 'utf-8'));
                    const validation = validateExplorationPayload(data, ticketId);

                    if (!validation.valid) {
                        return JSON.stringify({
                            found: false,
                            corrupted: true,
                            message: `Exploration data for ${ticketId} is invalid and cannot be trusted for script generation.`,
                            validationErrors: validation.errors,
                            warnings: validation.warnings,
                            fix: 'Re-run MCP exploration and save_exploration_data to regenerate a valid artifact.',
                        }, null, 2);
                    }

                    const normalized = validation.normalized;
                    return JSON.stringify({
                        found: true,
                        source: normalized.source,
                        timestamp: normalized.timestamp,
                        pagesVisited: normalized.pagesVisited,
                        selectorCount: normalized.selectorCount,
                        popupsDetected: normalized.popupsDetected,
                        snapshotCount: (normalized.snapshots || []).length,
                        warnings: validation.warnings,
                        data: normalized,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ found: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 5: analyze_test_failure
    // Available to: scriptgenerator (self-healing), buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('analyze_test_failure', {
            description:
                'Analyzes Playwright test failure output using AI-powered pattern matching. ' +
                'Categorizes errors (SELECTOR, NETWORK, TIMEOUT, ASSERTION, BROWSER, AUTH), ' +
                'provides fix suggestions, and generates auto-fix objects when possible.',
            parameters: {
                type: 'object',
                properties: {
                    errorOutput: {
                        type: 'string',
                        description: 'The raw error output from Playwright test execution',
                    },
                    scriptPath: {
                        type: 'string',
                        description: 'Path to the failing script (for auto-fix context)',
                    },
                },
                required: ['errorOutput'],
            },
            handler: async ({ errorOutput, scriptPath }) => {
                try {
                    const { ErrorAnalyzer } = require('../../.github/agents/lib/error-analyzer');
                    const analyzer = new ErrorAnalyzer();
                    const analysis = analyzer.analyze(errorOutput, { scriptPath });
                    const report = analyzer.generateReport(analysis);

                    return JSON.stringify({
                        category: analysis.category,
                        severity: analysis.severity,
                        autoFixable: analysis.autoFixable,
                        suggestions: analysis.suggestions,
                        aiInsights: analysis.aiInsights,
                        report,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: `Analysis failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 6: get_assertion_config
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('get_assertion_config', {
            description:
                'Returns assertion patterns and rules for the current framework. Provides ' +
                'recommended assertion strategies per element type (text, visibility, count, URL, etc.) ' +
                'along with anti-pattern rules to avoid.',
            parameters: {
                type: 'object',
                properties: {
                    pageType: {
                        type: 'string',
                        description: 'Type of page being tested (e.g., "property-details", "search-results", "login")',
                    },
                },
            },
            handler: async ({ pageType }) => {
                const cache = getToolCache();
                const cacheKey = `assertion_config:${pageType || 'default'}`;

                return cache.getOrCompute(cacheKey, async () => {
                    try {
                        const AssertionConfigHelper = require('../utils/assertionConfigHelper');
                        const helper = new AssertionConfigHelper();
                        const framework = helper.getActiveFramework();
                        const assertions = helper.getAssertionsByCategory(pageType || 'default');
                        const antiPatterns = helper.getAntiPatterns ? helper.getAntiPatterns() : [];

                        return JSON.stringify({
                            framework,
                            assertions,
                            antiPatterns,
                            tips: [
                                'Always use auto-retrying assertions (toBeVisible, toContainText, toBeEnabled)',
                                'Never use expect(await el.textContent()).toContain() — use await expect(el).toContainText()',
                                'Never use expect(await el.isVisible()).toBe(true) — use await expect(el).toBeVisible()',
                            ],
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({ error: `Config load failed: ${error.message}` });
                    }
                });
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 7: suggest_popup_handler
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('suggest_popup_handler', {
            description:
                'Analyzes exploration data to determine which PopupHandler methods to use. ' +
                'Classifies detected popups as handled (existing method available) or unhandled ' +
                '(needs new method). Returns popup handling code recommendations.',
            parameters: {
                type: 'object',
                properties: {
                    explorationJson: {
                        type: 'string',
                        description: 'JSON string of exploration data containing popupsDetected array',
                    },
                },
                required: ['explorationJson'],
            },
            handler: async ({ explorationJson }) => {
                try {
                    const { PopupHandler } = require('../../tests/utils/popupHandler');
                    const explorationData = JSON.parse(explorationJson);
                    const suggestions = PopupHandler.suggestPopupHandler(explorationData);
                    return JSON.stringify(suggestions, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        error: error.message,
                        fallback: 'Use popups.dismissAll() as a safe default',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 8: run_quality_gate
    // Available to: all agents (for self-validation)
    // ───────────────────────────────────────────────────────────────────
    tools.push(defineTool('run_quality_gate', {
        description:
            'Runs a specific quality gate check. Gates: "excel" (validates test case Excel), ' +
            '"exploration" (validates MCP exploration data), "script" (validates generated script), ' +
            '"execution" (validates test results).',
        parameters: {
            type: 'object',
            properties: {
                gate: {
                    type: 'string',
                    description: 'Quality gate to run: "excel" | "exploration" | "script" | "execution"',
                },
                artifactPath: {
                    type: 'string',
                    description: 'Path to the artifact to validate',
                },
                ticketId: {
                    type: 'string',
                    description: 'Ticket ID for context',
                },
            },
            required: ['gate', 'artifactPath'],
        },
        handler: async ({ gate, artifactPath, ticketId }) => {
            try {
                // Broadcast progress: running gate
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('run_quality_gate', {
                        phase: 'quality_gate', message: `Running ${gate} quality gate...`, step: 1,
                    });
                }
                const { QualityGates } = require('../../.github/agents/lib/quality-gates');
                const workflow = {
                    ticketId,
                    artifacts: {
                        excelPath: gate === 'excel' ? artifactPath : undefined,
                        explorationPath: gate === 'exploration' ? artifactPath : undefined,
                        specPath: gate === 'script' ? artifactPath : undefined,
                    },
                };

                let result;
                switch (gate) {
                    case 'excel':
                        result = QualityGates.validateExcelCreated(workflow);
                        break;
                    case 'exploration':
                        result = QualityGates.validateMCPExploration(workflow, ticketId);
                        break;
                    case 'script':
                        result = QualityGates.validateScriptGenerated(workflow, ticketId);
                        break;
                    case 'execution':
                        if (!fs.existsSync(artifactPath)) {
                            result = {
                                passed: false,
                                error: `Execution artifact not found: ${artifactPath}`,
                                fix: 'Run execution stage and provide a valid results artifact path',
                            };
                        } else {
                            const stats = fs.statSync(artifactPath);
                            result = {
                                passed: stats.size > 0,
                                size: stats.size,
                                path: artifactPath,
                                error: stats.size > 0 ? null : 'Execution artifact is empty',
                            };
                        }
                        break;
                    default:
                        result = { passed: false, error: `Unknown gate: ${gate}` };
                }

                return JSON.stringify(result, null, 2);
            } catch (error) {
                return JSON.stringify({ passed: false, error: error.message });
            }
        },
    }));

    // ───────────────────────────────────────────────────────────────────
    // TOOL 9: save_exploration_data
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('save_exploration_data', {
            description:
                'Saves MCP exploration data to the exploration-data directory. ' +
                'Data must conform to the exploration schema with source, snapshots, ' +
                'selectorCount, pagesVisited, and popupsDetected fields.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID',
                    },
                    explorationData: {
                        type: 'string',
                        description: 'JSON string of exploration data to save',
                    },
                },
                required: ['ticketId', 'explorationData'],
            },
            handler: async ({ ticketId, explorationData }) => {
                try {
                    const parsed = JSON.parse(explorationData);
                    const validation = validateExplorationPayload(parsed, ticketId);

                    if (!validation.valid) {
                        return JSON.stringify({
                            saved: false,
                            error: 'Exploration payload validation failed',
                            validationErrors: validation.errors,
                            warnings: validation.warnings,
                        });
                    }

                    const data = validation.normalized;

                    const explorationDir = path.join(__dirname, '..', 'exploration-data');
                    if (!fs.existsSync(explorationDir)) {
                        fs.mkdirSync(explorationDir, { recursive: true });
                    }

                    const filePath = path.join(explorationDir, `${ticketId}-exploration.json`);
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

                    return JSON.stringify({
                        saved: true,
                        path: filePath,
                        selectorCount: data.selectorCount || 0,
                        pagesVisited: data.pagesVisited || [],
                        warnings: validation.warnings,
                    });
                } catch (error) {
                    return JSON.stringify({ saved: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 10: get_test_results
    // Available to: buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie'].includes(agentName)) {
        tools.push(defineTool('get_test_results', {
            description:
                'Retrieves the latest test execution results for a ticket. Returns pass/fail counts, ' +
                'failure details, error messages, and screenshots if available.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID',
                    },
                    specPath: {
                        type: 'string',
                        description: 'Path to the spec file (if known)',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, specPath }) => {
                try {
                    // Look for test results in standard locations
                    const resultsDir = path.join(__dirname, '..', 'test-results');
                    const testResultsDir = path.join(__dirname, '..', '..', 'test-results');

                    // Scan for JSON result files
                    const searchDirs = [resultsDir, testResultsDir].filter(d => fs.existsSync(d));
                    const results = [];

                    for (const dir of searchDirs) {
                        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
                        for (const file of files) {
                            try {
                                const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
                                results.push({ file, data });
                            } catch { /* skip invalid JSON */ }
                        }
                    }

                    return JSON.stringify({
                        ticketId,
                        resultsFound: results.length,
                        results: results.slice(-5), // Last 5 results
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11: fetch_jira_ticket
    // Available to: testgenie, buggenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['testgenie', 'buggenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('fetch_jira_ticket', {
            description:
                'Fetches Jira ticket details (summary, description, acceptance criteria, labels, ' +
                'status, priority, issue type, components, fix versions, time tracking, parent relationship, subtasks, and issue links) via the Atlassian REST API. ' +
                'For TestGenie, also computes a sparse-ticket score and forces KB enrichment when coverage context is insufficient.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or full Jira browse URL (e.g., "AOTF-16339" or "https://corelogic.atlassian.net/browse/AOTF-16339")',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = normalizeJiraTicketInput(ticketId, latestUserMessage);
                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve a Jira ticket key from the provided input.',
                            hint: 'Pass a Jira ticket key like AOTF-16339 or a full Jira browse URL.',
                        });
                    }

                    const resolvedTicketId = normalizedTicket.ticketId;

                    // Broadcast progress: starting
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                            phase: 'jira', message: `Fetching ticket ${resolvedTicketId} from Jira API...`, step: 1,
                        });
                    }
                    loadEnvVars();
                    const baseUrl = process.env.JIRA_BASE_URL;
                    if (!baseUrl && !process.env.JIRA_CLOUD_ID) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_BASE_URL or JIRA_CLOUD_ID must be set in agentic-workflow/.env',
                            hint: 'Copy .env.example to .env and configure Jira settings',
                        });
                    }
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    // Try Atlassian REST v3 via cloud (preferred)
                    let url;
                    if (cloudId) {
                        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${resolvedTicketId}?expand=renderedFields`;
                    } else {
                        url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${resolvedTicketId}?expand=renderedFields`;
                    }

                    const headers = { 'Accept': 'application/json' };
                    if (email && apiToken) {
                        headers['Authorization'] = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
                    }

                    const response = await fetch(url, { headers });

                    if (!response.ok) {
                        // Fall back to basic fields without auth
                        const fallbackUrl = `${baseUrl.replace(/\/$/, '')}/rest/api/2/issue/${resolvedTicketId}`;
                        const fallbackResp = await fetch(fallbackUrl, {
                            headers: { 'Accept': 'application/json', ...headers },
                        });
                        if (!fallbackResp.ok) {
                            return JSON.stringify({
                                success: false,
                                error: `Failed to fetch ${resolvedTicketId}: HTTP ${response.status} (cloud) / ${fallbackResp.status} (direct)`,
                                hint: 'Ensure JIRA_EMAIL and JIRA_API_TOKEN are set in agentic-workflow/.env',
                            });
                        }
                        const data = await fallbackResp.json();
                        const formatted = formatJiraTicket(data, resolvedTicketId);
                        if (formatted.commentsTruncated) {
                            const completeComments = await fetchCompleteJiraComments(resolvedTicketId, { baseUrl, cloudId: '', headers });
                            if (completeComments) {
                                formatted.comments = completeComments.comments;
                                formatted.commentCount = completeComments.commentCount;
                                formatted.commentsTruncated = completeComments.commentsTruncated;
                            }
                        }
                        if (normalizedTicket.jiraBaseUrl) {
                            const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalizedTicket.jiraBaseUrl });
                            if (!jiraConfig.error) {
                                formatted.ticketUrl = buildJiraBrowseUrl(jiraConfig, resolvedTicketId);
                            }
                        }
                        formatted.resolvedFrom = normalizedTicket.source;
                        formatted.sourceUrl = normalizedTicket.sourceUrl || null;
                        formatted.sparseAssessment = computeSparseTicketScore(formatted);

                        if (agentName === 'testgenie') {
                            if (deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                                    phase: 'jira', message: `Ticket ${resolvedTicketId} fetched — evaluating coverage completeness...`, step: 2,
                                });
                            }
                            const kbEnrichment = await enrichSparseTicketWithKnowledgeBase(formatted, {
                                agentName,
                                groundingStore,
                            });
                            formatted.kbAutoEnrichment = kbEnrichment;

                            if (kbEnrichment.forcedByLogic && deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                                    phase: 'kb', message: `Sparse ticket detected for ${resolvedTicketId} — forcing KB enrichment...`, step: 3,
                                });
                            }
                        }

                        return JSON.stringify(formatted, null, 2);
                    }

                    const data = await response.json();
                    // Broadcast progress: parsing complete
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                            phase: 'jira', message: `Ticket ${resolvedTicketId} fetched — parsing fields...`, step: 2,
                        });
                    }
                    const formatted = formatJiraTicket(data, resolvedTicketId);
                    if (formatted.commentsTruncated) {
                        const completeComments = await fetchCompleteJiraComments(resolvedTicketId, { baseUrl, cloudId, headers });
                        if (completeComments) {
                            formatted.comments = completeComments.comments;
                            formatted.commentCount = completeComments.commentCount;
                            formatted.commentsTruncated = completeComments.commentsTruncated;
                        }
                    }
                    if (normalizedTicket.jiraBaseUrl) {
                        const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalizedTicket.jiraBaseUrl });
                        if (!jiraConfig.error) {
                            formatted.ticketUrl = buildJiraBrowseUrl(jiraConfig, resolvedTicketId);
                        }
                    }
                    formatted.resolvedFrom = normalizedTicket.source;
                    formatted.sourceUrl = normalizedTicket.sourceUrl || null;
                    formatted.sparseAssessment = computeSparseTicketScore(formatted);

                    if (agentName === 'testgenie') {
                        const kbEnrichment = await enrichSparseTicketWithKnowledgeBase(formatted, {
                            agentName,
                            groundingStore,
                        });
                        formatted.kbAutoEnrichment = kbEnrichment;

                        if (kbEnrichment.forcedByLogic && deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('fetch_jira_ticket', {
                                phase: 'kb', message: `Sparse ticket detected for ${resolvedTicketId} — forcing KB enrichment...`, step: 3,
                            });
                        }
                    }

                    return JSON.stringify(formatted, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira fetch error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a2: get_jira_current_user
    // Available to: buggenie, testgenie, taskgenie
    // Returns the authenticated Jira user's accountId and displayName.
    // Use this before create_jira_ticket to auto-assign tickets to the
    // requesting user.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_current_user', {
            description:
                'Returns the currently authenticated Jira user\'s account ID and display name. ' +
                'Call this BEFORE create_jira_ticket when you need to assign the new ticket ' +
                'to the user who is requesting the task. The returned accountId can be passed ' +
                'as assigneeAccountId to create_jira_ticket.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => {
                try {
                    loadEnvVars();
                    const cloudId = (process.env.JIRA_CLOUD_ID || '').replace(/"/g, '');
                    const baseUrl = process.env.JIRA_BASE_URL;
                    const email = process.env.JIRA_EMAIL || process.env.ATLASSIAN_EMAIL || '';
                    const apiToken = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN || '';

                    if (!email || !apiToken) {
                        return JSON.stringify({
                            success: false,
                            error: 'JIRA_EMAIL and JIRA_API_TOKEN are required',
                        });
                    }

                    const headers = {
                        'Accept': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
                    };

                    const url = cloudId
                        ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`
                        : `${(baseUrl || '').replace(/\/$/, '')}/rest/api/3/myself`;

                    const response = await fetch(url, { method: 'GET', headers });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        return JSON.stringify({
                            success: false,
                            error: `Failed to fetch current user: HTTP ${response.status}`,
                            details: errorBody,
                        });
                    }

                    const userData = await response.json();
                    return JSON.stringify({
                        success: true,
                        accountId: userData.accountId,
                        displayName: userData.displayName,
                        emailAddress: userData.emailAddress || email,
                        active: userData.active,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Error fetching current user: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a3: search_jira_issues
    // Available to: buggenie, testgenie, taskgenie
    // Searches Jira issues using enhanced JQL search with legacy fallback.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('search_jira_issues', {
            description:
                'Searches Jira issues using enhanced JQL search with a legacy search fallback when needed. ' +
                'Use this to find issues by JQL or a plain-text query before reading, linking, assigning, or updating them.',
            parameters: {
                type: 'object',
                properties: {
                    jql: {
                        type: 'string',
                        description: 'Optional explicit Jira JQL query.',
                    },
                    query: {
                        type: 'string',
                        description: 'Optional plain-text query to search in Jira issue text. Used when jql is omitted.',
                    },
                    projectKey: {
                        type: 'string',
                        description: 'Optional Jira project key to scope plain-text search when jql is omitted.',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of issues to return (default 10, max 50).',
                    },
                    fields: {
                        type: 'string',
                        description: 'Optional comma-separated Jira fields to request. Defaults to summary,status,priority,issuetype,assignee,reporter,labels,created,updated.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: [],
            },
            handler: async ({ jql, query, projectKey, maxResults, fields, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(jql) && !isNonEmptyString(query)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide jql or query to search Jira issues.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedMaxResults = Math.max(1, Math.min(Number(maxResults) || 10, 50));
                    const resolvedJql = isNonEmptyString(jql)
                        ? jql.trim()
                        : buildJiraTextSearchJql(query, projectKey);

                    if (!isNonEmptyString(resolvedJql)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not build a Jira search query from the provided inputs.',
                        });
                    }

                    const requestedFields = splitCommaSeparated(fields);
                    const resolvedFields = requestedFields.length > 0
                        ? requestedFields
                        : ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'labels', 'created', 'updated'];

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('search_jira_issues', {
                            phase: 'jira', message: 'Searching Jira issues...', step: 1,
                        });
                    }

                    const payload = {
                        jql: resolvedJql,
                        maxResults: resolvedMaxResults,
                        fields: resolvedFields,
                        fieldsByKeys: false,
                    };

                    let endpoint = 'enhanced-jql';
                    let response = await fetch(`${jiraConfig.apiBase}/search/jql`, {
                        method: 'POST',
                        headers: jiraConfig.headers,
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok && [404, 405, 501].includes(response.status)) {
                        endpoint = 'legacy-search-fallback';
                        response = await fetch(`${jiraConfig.apiBase}/search`, {
                            method: 'POST',
                            headers: jiraConfig.headers,
                            body: JSON.stringify(payload),
                        });
                    }

                    if (!response.ok) {
                        const rawBody = await response.text();
                        const formattedError = formatJiraErrorResponse('Issue search failed', response.status, rawBody);
                        return JSON.stringify({
                            success: false,
                            error: formattedError.message,
                            details: formattedError.details,
                            errorMessages: formattedError.errorMessages,
                            fieldErrors: formattedError.fieldErrors,
                            hint: formattedError.hint,
                            jql: resolvedJql,
                            endpoint,
                        }, null, 2);
                    }

                    const data = await response.json();
                    const issues = (Array.isArray(data.issues) ? data.issues : Array.isArray(data.values) ? data.values : [])
                        .map(formatJiraSearchIssue)
                        .filter(issue => issue?.key)
                        .map(issue => ({
                            ...issue,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, issue.key),
                        }));

                    return JSON.stringify({
                        success: true,
                        endpoint,
                        jql: resolvedJql,
                        query: isNonEmptyString(query) ? query.trim() : undefined,
                        projectKey: isNonEmptyString(projectKey) ? projectKey.trim() : undefined,
                        issueCount: issues.length,
                        total: typeof data.total === 'number' ? data.total : issues.length,
                        maxResults: resolvedMaxResults,
                        issues,
                        nextPageToken: data.nextPageToken || data.nextPage || undefined,
                        isLast: typeof data.isLast === 'boolean' ? data.isLast : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira issue search error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a3b: search_jira_epics
    // Available to: buggenie, testgenie, taskgenie
    // Searches only Jira epics using Epic-scoped JQL.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('search_jira_epics', {
            description:
                'Searches Jira epics using Epic-scoped JQL with an enhanced search fallback. ' +
                'Use this when the user asks to find epics by free text, project, or explicit JQL.',
            parameters: {
                type: 'object',
                properties: {
                    jql: {
                        type: 'string',
                        description: 'Optional explicit Jira JQL query that should return Epic issues.',
                    },
                    query: {
                        type: 'string',
                        description: 'Optional plain-text query used when jql is omitted.',
                    },
                    projectKey: {
                        type: 'string',
                        description: 'Optional Jira project key to scope Epic search when jql is omitted.',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of epics to return (default 10, max 50).',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: [],
            },
            handler: async ({ jql, query, projectKey, maxResults, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(jql) && !isNonEmptyString(query) && !isNonEmptyString(projectKey)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide jql, query, or projectKey to search Jira epics.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedMaxResults = normalizeMaxResults(maxResults);
                    const resolvedJql = isNonEmptyString(jql)
                        ? jql.trim()
                        : buildJiraEpicSearchJql(query, projectKey);

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('search_jira_epics', {
                            phase: 'jira', message: 'Searching Jira epics...', step: 1,
                        });
                    }

                    const searchResult = await executeJiraIssueSearch(jiraConfig, {
                        jql: resolvedJql,
                        maxResults: resolvedMaxResults,
                        fields: ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'labels', 'created', 'updated'],
                    });

                    if (!searchResult.success) {
                        return JSON.stringify({
                            success: false,
                            error: searchResult.formattedError.message,
                            details: searchResult.formattedError.details,
                            errorMessages: searchResult.formattedError.errorMessages,
                            fieldErrors: searchResult.formattedError.fieldErrors,
                            hint: searchResult.formattedError.hint,
                            jql: resolvedJql,
                            endpoint: searchResult.endpoint,
                        }, null, 2);
                    }

                    const data = searchResult.data;
                    const epics = (Array.isArray(data.issues) ? data.issues : Array.isArray(data.values) ? data.values : [])
                        .map(issue => formatJiraEpicSearchResult(issue, jiraConfig))
                        .filter(epic => epic?.key);

                    return JSON.stringify({
                        success: true,
                        endpoint: searchResult.endpoint,
                        jql: resolvedJql,
                        query: isNonEmptyString(query) ? query.trim() : undefined,
                        projectKey: isNonEmptyString(projectKey) ? projectKey.trim() : undefined,
                        epicCount: epics.length,
                        total: typeof data.total === 'number' ? data.total : epics.length,
                        maxResults: resolvedMaxResults,
                        epics,
                        nextPageToken: data.nextPageToken || data.nextPage || undefined,
                        isLast: typeof data.isLast === 'boolean' ? data.isLast : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira epic search error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a3c: get_jira_epic
    // Available to: buggenie, testgenie, taskgenie
    // Returns Jira epic details via Jira Software Epic API with issue fallback.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_epic', {
            description:
                'Fetches Jira Epic details using the Jira Software Epic API with an issue-details fallback. ' +
                'Use this when the user asks to read an Epic, summarize its details, or inspect Epic metadata.',
            parameters: {
                type: 'object',
                properties: {
                    epicIdOrKey: {
                        type: 'string',
                        description: 'Jira Epic key, issue ID, or full Jira browse URL.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: ['epicIdOrKey'],
            },
            handler: async ({ epicIdOrKey, jiraBaseUrl }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedEpic = normalizeJiraTicketInput(epicIdOrKey, latestUserMessage);
                    const resolvedEpicId = normalizedEpic.ticketId || String(epicIdOrKey || '').trim();

                    if (!isNonEmptyString(resolvedEpicId)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve a Jira Epic key or issue ID from the provided input.',
                            hint: 'Pass a Jira Epic key like AOTF-17620, a numeric issue ID, or a full Jira browse URL.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalizedEpic.jiraBaseUrl || jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('get_jira_epic', {
                            phase: 'jira', message: `Fetching Jira epic ${resolvedEpicId}...`, step: 1,
                        });
                    }

                    const agileUrl = buildJiraAgileApiUrl(jiraConfig, `/epic/${encodeURIComponent(resolvedEpicId)}`);
                    const issueUrl = `${buildJiraIssueApiUrl(jiraConfig, resolvedEpicId)}?expand=renderedFields`;

                    const [agileResponse, issueResponse] = await Promise.all([
                        fetch(agileUrl, { method: 'GET', headers: jiraConfig.headers }),
                        fetch(issueUrl, { method: 'GET', headers: jiraConfig.headers }),
                    ]);

                    let agileEpic = null;
                    let agileError = null;
                    if (agileResponse.ok) {
                        agileEpic = await agileResponse.json();
                    } else {
                        agileError = formatJiraErrorResponse('Epic lookup failed', agileResponse.status, await agileResponse.text());
                    }

                    let issueData = null;
                    let issueError = null;
                    if (issueResponse.ok) {
                        issueData = await issueResponse.json();
                    } else {
                        issueError = formatJiraErrorResponse('Epic issue fallback failed', issueResponse.status, await issueResponse.text());
                    }

                    if (!agileEpic && !issueData) {
                        return JSON.stringify({
                            success: false,
                            error: agileError?.message || issueError?.message || `Failed to fetch Jira epic ${resolvedEpicId}.`,
                            details: agileError?.details || issueError?.details,
                            hint: agileResponse.status === 400 || agileResponse.status === 404
                                ? 'Jira Software Epic APIs may be unavailable for this project type. Try reading the issue directly with fetch_jira_ticket if you only need raw issue details.'
                                : (agileError?.hint || issueError?.hint),
                        }, null, 2);
                    }

                    if (issueData && String(issueData.fields?.issuetype?.name || '').toLowerCase() !== 'epic' && !agileEpic) {
                        return JSON.stringify({
                            success: false,
                            error: `${resolvedEpicId} is not a Jira Epic.`,
                            issueType: issueData.fields?.issuetype?.name || '',
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, issueData.key || resolvedEpicId),
                        }, null, 2);
                    }

                    return JSON.stringify(formatJiraEpicDetails(issueData, jiraConfig, agileEpic, resolvedEpicId), null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira epic lookup error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a3d: get_jira_epic_issues
    // Available to: buggenie, testgenie, taskgenie
    // Lists issues that belong to a Jira epic, with JQL fallback.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_epic_issues', {
            description:
                'Lists issues contained in a Jira Epic using the Jira Software Epic API with JQL fallback for team-managed style parent relationships. ' +
                'Use this when the user asks which issues are inside an Epic.',
            parameters: {
                type: 'object',
                properties: {
                    epicIdOrKey: {
                        type: 'string',
                        description: 'Jira Epic key, issue ID, or full Jira browse URL.',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of issues to return (default 25, max 50).',
                    },
                    fields: {
                        type: 'string',
                        description: 'Optional comma-separated Jira fields to request for returned issues.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: ['epicIdOrKey'],
            },
            handler: async ({ epicIdOrKey, maxResults, fields, jiraBaseUrl }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedEpic = normalizeJiraTicketInput(epicIdOrKey, latestUserMessage);
                    const resolvedEpicId = normalizedEpic.ticketId || String(epicIdOrKey || '').trim();

                    if (!isNonEmptyString(resolvedEpicId)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve a Jira Epic key or issue ID from the provided input.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: normalizedEpic.jiraBaseUrl || jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedMaxResults = normalizeMaxResults(maxResults, 25);
                    const requestedFields = splitCommaSeparated(fields);
                    const resolvedFields = requestedFields.length > 0
                        ? requestedFields
                        : ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'labels', 'created', 'updated'];

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('get_jira_epic_issues', {
                            phase: 'jira', message: `Fetching issues for epic ${resolvedEpicId}...`, step: 1,
                        });
                    }

                    const params = new URLSearchParams();
                    params.set('maxResults', String(resolvedMaxResults));
                    params.set('fields', resolvedFields.join(','));

                    const agileResponse = await fetch(
                        `${buildJiraAgileApiUrl(jiraConfig, `/epic/${encodeURIComponent(resolvedEpicId)}/issue`)}?${params.toString()}`,
                        { method: 'GET', headers: jiraConfig.headers }
                    );

                    if (agileResponse.ok) {
                        const data = await agileResponse.json();
                        const issues = (Array.isArray(data.issues) ? data.issues : Array.isArray(data.values) ? data.values : [])
                            .map(formatJiraSearchIssue)
                            .filter(issue => issue?.key)
                            .map(issue => ({
                                ...issue,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, issue.key),
                            }));

                        return JSON.stringify({
                            success: true,
                            endpoint: 'agile-epic-issues',
                            epicKey: resolvedEpicId,
                            epicUrl: buildJiraBrowseUrl(jiraConfig, resolvedEpicId),
                            issueCount: issues.length,
                            total: typeof data.total === 'number' ? data.total : issues.length,
                            maxResults: resolvedMaxResults,
                            issues,
                            startAt: typeof data.startAt === 'number' ? data.startAt : 0,
                            isLast: typeof data.isLast === 'boolean' ? data.isLast : undefined,
                        }, null, 2);
                    }

                    const agileError = formatJiraErrorResponse('Epic issue listing failed', agileResponse.status, await agileResponse.text());
                    const fallbackJqls = [
                        { endpoint: 'jql-parent-fallback', jql: `parent = "${escapeJqlString(resolvedEpicId)}" ORDER BY updated DESC` },
                        { endpoint: 'jql-epic-link-fallback', jql: `"Epic Link" = "${escapeJqlString(resolvedEpicId)}" ORDER BY updated DESC` },
                    ];
                    let lastSuccessfulFallbackResult = null;

                    for (const fallback of fallbackJqls) {
                        const searchResult = await executeJiraIssueSearch(jiraConfig, {
                            jql: fallback.jql,
                            maxResults: resolvedMaxResults,
                            fields: resolvedFields,
                        });

                        if (!searchResult.success) {
                            continue;
                        }

                        const data = searchResult.data;
                        const issues = (Array.isArray(data.issues) ? data.issues : Array.isArray(data.values) ? data.values : [])
                            .map(formatJiraSearchIssue)
                            .filter(issue => issue?.key)
                            .map(issue => ({
                                ...issue,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, issue.key),
                            }));

                        const fallbackResult = {
                            success: true,
                            endpoint: fallback.endpoint,
                            fallbackFrom: 'agile-epic-issues',
                            epicKey: resolvedEpicId,
                            epicUrl: buildJiraBrowseUrl(jiraConfig, resolvedEpicId),
                            jql: fallback.jql,
                            issueCount: issues.length,
                            total: typeof data.total === 'number' ? data.total : issues.length,
                            maxResults: resolvedMaxResults,
                            issues,
                        };

                        if (issues.length > 0 || fallback.endpoint === 'jql-epic-link-fallback') {
                            return JSON.stringify(fallbackResult, null, 2);
                        }

                        lastSuccessfulFallbackResult = fallbackResult;
                    }

                    if (lastSuccessfulFallbackResult) {
                        return JSON.stringify(lastSuccessfulFallbackResult, null, 2);
                    }

                    return JSON.stringify({
                        success: false,
                        error: agileError.message,
                        details: agileError.details,
                        errorMessages: agileError.errorMessages,
                        fieldErrors: agileError.fieldErrors,
                        hint: 'Jira Software Epic APIs may be unavailable for this project type. If this is a classic project, verify Epic access. If this is team-managed, parent-based fallback may be required for this specific board configuration.',
                        epicKey: resolvedEpicId,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira epic issue listing error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a3e: list_jira_issues_without_epic
    // Available to: taskgenie
    // Lists issues that are not assigned to any Epic.
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'taskgenie') {
        tools.push(defineTool('list_jira_issues_without_epic', {
            description:
                'Lists Jira issues that are not assigned to any Epic using the Jira Software Epic none endpoint. ' +
                'Use this when the user asks which issues are still unassigned to an Epic within a project or JQL scope.',
            parameters: {
                type: 'object',
                properties: {
                    projectKey: {
                        type: 'string',
                        description: 'Optional Jira project key used to scope the search when jql is omitted.',
                    },
                    jql: {
                        type: 'string',
                        description: 'Optional JQL used to scope the search before Jira filters to issues without an Epic.',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of issues to return (default 25, max 50).',
                    },
                    fields: {
                        type: 'string',
                        description: 'Optional comma-separated Jira fields to request for returned issues.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: [],
            },
            handler: async ({ projectKey, jql, maxResults, fields, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(jql) && !isNonEmptyString(projectKey)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide projectKey or jql to scope issues without an Epic.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedMaxResults = normalizeMaxResults(maxResults, 25);
                    const requestedFields = splitCommaSeparated(fields);
                    const resolvedFields = requestedFields.length > 0
                        ? requestedFields
                        : ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'labels', 'created', 'updated'];
                    const resolvedScopeJql = isNonEmptyString(jql)
                        ? jql.trim()
                        : `project = "${projectKey.trim()}"`;

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('list_jira_issues_without_epic', {
                            phase: 'jira', message: 'Listing Jira issues without an Epic...', step: 1,
                        });
                    }

                    const params = new URLSearchParams();
                    params.set('jql', resolvedScopeJql);
                    params.set('maxResults', String(resolvedMaxResults));
                    params.set('fields', resolvedFields.join(','));

                    const response = await fetch(
                        `${buildJiraAgileApiUrl(jiraConfig, '/epic/none/issue')}?${params.toString()}`,
                        { method: 'GET', headers: jiraConfig.headers }
                    );

                    if (!response.ok) {
                        const formattedError = formatJiraErrorResponse('Issues-without-epic lookup failed', response.status, await response.text());
                        return JSON.stringify({
                            success: false,
                            error: formattedError.message,
                            details: formattedError.details,
                            errorMessages: formattedError.errorMessages,
                            fieldErrors: formattedError.fieldErrors,
                            hint: response.status === 400 || response.status === 404
                                ? 'Jira Software Epic none endpoints may be unavailable for this project type. Use search_jira_issues with project-scoped JQL as a fallback until parent-based no-epic discovery is added for team-managed projects.'
                                : formattedError.hint,
                            jql: resolvedScopeJql,
                        }, null, 2);
                    }

                    const data = await response.json();
                    const issues = (Array.isArray(data.issues) ? data.issues : Array.isArray(data.values) ? data.values : [])
                        .map(formatJiraSearchIssue)
                        .filter(issue => issue?.key)
                        .map(issue => ({
                            ...issue,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, issue.key),
                        }));

                    return JSON.stringify({
                        success: true,
                        endpoint: 'agile-epic-none-issues',
                        projectKey: isNonEmptyString(projectKey) ? projectKey.trim() : undefined,
                        jql: resolvedScopeJql,
                        issueCount: issues.length,
                        total: typeof data.total === 'number' ? data.total : issues.length,
                        maxResults: resolvedMaxResults,
                        issues,
                        startAt: typeof data.startAt === 'number' ? data.startAt : 0,
                        isLast: typeof data.isLast === 'boolean' ? data.isLast : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Issues-without-epic lookup error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a4: search_jira_users
    // Available to: buggenie, testgenie, taskgenie
    // Returns assignable Jira users for a target issue or project.
    // Also used to resolve display names to accountIds for @mentions.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('search_jira_users', {
            description:
                'Searches Jira users who are assignable to a target issue or project. ' +
                'Use this before create_jira_ticket when the user asks to assign work to a named person such as Monica or Khushboo. ' +
                'Also use this to resolve display names to accountIds for @mentions in comments and descriptions. ' +
                'Prefer issueKey when available so results are filtered to users Jira can actually assign on that issue.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Name or email fragment to search for (for example "Monica" or "khushboo").',
                    },
                    issueKey: {
                        type: 'string',
                        description: 'Optional Jira issue key or browse URL to scope assignable-user lookup to a specific issue.',
                    },
                    projectKey: {
                        type: 'string',
                        description: 'Optional Jira project key to scope assignable-user lookup for new issues. Defaults to JIRA_PROJECT_KEY when issueKey is omitted.',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of users to return (default 10, max 50).',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, issueKey, projectKey, maxResults, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(query)) {
                        return JSON.stringify({
                            success: false,
                            error: 'query is required to search Jira users.',
                        });
                    }

                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedIssue = isNonEmptyString(issueKey)
                        ? normalizeJiraTicketInput(issueKey, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (issueKey && !normalizedIssue.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve issueKey into a Jira ticket key.',
                            hint: 'Pass an issue key like AOTF-17620 or a full Jira browse URL.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedIssue.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedProjectKey = isNonEmptyString(projectKey)
                        ? projectKey.trim()
                        : ((process.env.JIRA_PROJECT_KEY || '').trim() || '');

                    if (!normalizedIssue.ticketId && !resolvedProjectKey) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide issueKey or projectKey to scope assignable-user lookup.',
                            hint: 'TaskGenie uses assignable-user search, which requires either an issue or a project context.',
                        });
                    }

                    const params = new URLSearchParams();
                    params.set('query', query.trim());
                    params.set('maxResults', String(Math.max(1, Math.min(Number(maxResults) || 10, 50))));
                    if (normalizedIssue.ticketId) {
                        params.set('issueKey', normalizedIssue.ticketId);
                    } else {
                        params.set('project', resolvedProjectKey);
                    }

                    const response = await fetch(`${jiraConfig.apiBase}/user/assignable/search?${params.toString()}`, {
                        method: 'GET',
                        headers: jiraConfig.headers,
                    });

                    if (!response.ok) {
                        return JSON.stringify({
                            success: false,
                            error: `Assignable-user lookup failed: HTTP ${response.status}`,
                            details: await response.text(),
                            hint: 'Verify the Jira user has Browse users and groups or Assign issues permission for the target issue/project.',
                        }, null, 2);
                    }

                    const users = (await response.json()).map(normalizeJiraUser).filter(Boolean);
                    const normalizedQuery = query.trim().toLowerCase();
                    const exactMatches = users.filter(user =>
                        String(user.displayName || '').trim().toLowerCase() === normalizedQuery
                        || String(user.emailAddress || '').trim().toLowerCase() === normalizedQuery
                    );
                    const recommendedUser = exactMatches.length === 1
                        ? exactMatches[0]
                        : (users.length === 1 ? users[0] : undefined);

                    return JSON.stringify({
                        success: true,
                        query: query.trim(),
                        scope: normalizedIssue.ticketId
                            ? { issueKey: normalizedIssue.ticketId }
                            : { projectKey: resolvedProjectKey },
                        userCount: users.length,
                        users,
                        exactMatchCount: exactMatches.length,
                        recommendedUser,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira user search error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a5: assign_jira_ticket
    // Available to: taskgenie
    // Assigns or reassigns an existing Jira issue.
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'taskgenie') {
        tools.push(defineTool('assign_jira_ticket', {
            description:
                'Assigns or reassigns an existing Jira ticket to a specific user. ' +
                'Use assigneeAccountId when already known, or assigneeQuery to resolve a single assignable Jira user for the target issue before assigning.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL to assign.',
                    },
                    assigneeAccountId: {
                        type: 'string',
                        description: 'Atlassian account ID of the assignee. Preferred when already known.',
                    },
                    assigneeQuery: {
                        type: 'string',
                        description: 'Optional name or email fragment to resolve against Jira assignable users for this issue.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, assigneeAccountId, assigneeQuery, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(assigneeAccountId) && !isNonEmptyString(assigneeQuery)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide assigneeAccountId or assigneeQuery to assign a Jira ticket.',
                        });
                    }

                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = normalizeJiraTicketInput(ticketId, latestUserMessage);
                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve ticketId into a Jira ticket key.',
                            hint: 'Pass a Jira key like AOTF-17620 or a full Jira browse URL.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketState = await fetchJiraTicketState(jiraConfig, normalizedTicket.ticketId, ['summary', 'assignee']);
                    if (!ticketState.success) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                            error: ticketState.error,
                            details: ticketState.details,
                            errorMessages: ticketState.errorMessages,
                            fieldErrors: ticketState.fieldErrors,
                            hint: ticketState.hint,
                        }, null, 2);
                    }

                    const currentTicket = ticketState.ticket;
                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);

                    let resolvedAssignee = null;
                    let candidates = [];
                    if (isNonEmptyString(assigneeAccountId)) {
                        resolvedAssignee = { accountId: assigneeAccountId.trim() };
                    } else {
                        const params = new URLSearchParams();
                        params.set('query', assigneeQuery.trim());
                        params.set('issueKey', normalizedTicket.ticketId);
                        params.set('maxResults', '10');

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('assign_jira_ticket', {
                                phase: 'jira', message: `Resolving assignee for ${normalizedTicket.ticketId}...`, step: 1,
                            });
                        }

                        const searchResponse = await fetch(`${jiraConfig.apiBase}/user/assignable/search?${params.toString()}`, {
                            method: 'GET',
                            headers: jiraConfig.headers,
                        });

                        if (!searchResponse.ok) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `Assignable-user lookup failed: HTTP ${searchResponse.status}`,
                                details: await searchResponse.text(),
                                hint: 'Verify the Jira user has Assign issues permission and can browse assignable users for this ticket.',
                            }, null, 2);
                        }

                        candidates = (await searchResponse.json()).map(normalizeJiraUser).filter(Boolean);
                        const normalizedQuery = assigneeQuery.trim().toLowerCase();
                        const exactMatches = candidates.filter(user =>
                            String(user.displayName || '').trim().toLowerCase() === normalizedQuery
                            || String(user.emailAddress || '').trim().toLowerCase() === normalizedQuery
                        );

                        if (exactMatches.length === 1) {
                            resolvedAssignee = exactMatches[0];
                        } else if (candidates.length === 1) {
                            resolvedAssignee = candidates[0];
                        } else if (candidates.length === 0) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `No assignable Jira users matched "${assigneeQuery.trim()}" for ${normalizedTicket.ticketId}.`,
                            }, null, 2);
                        } else {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `Multiple assignable Jira users matched "${assigneeQuery.trim()}" for ${normalizedTicket.ticketId}. Use assigneeAccountId to disambiguate.`,
                                candidates,
                            }, null, 2);
                        }
                    }

                    const resolvedAssigneeLabel = resolvedAssignee.displayName || resolvedAssignee.emailAddress || resolvedAssignee.accountId || 'Unknown user';
                    const assignChanges = [createMutationFieldChange({
                        field: 'assignee',
                        label: 'Assignee',
                        before: currentTicket.assignee,
                        after: resolvedAssigneeLabel,
                        includeUnchanged: true,
                    })].filter(Boolean);
                    const assignNotes = [
                        isNonEmptyString(assigneeQuery) ? `Resolved from query: ${assigneeQuery.trim()}` : '',
                    ].filter(Boolean);
                    const assignPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('assign_jira_ticket'),
                        title: `Approve assignment for ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: currentTicket.summary,
                        }),
                        changes: assignChanges,
                        notes: assignNotes,
                        consequence: 'Jira ownership will change and watchers or assignee notifications may be sent.',
                    });
                    const assignPreviewLines = buildJiraMutationPreviewLines([], assignPreview);

                    const assignApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'assign_jira_ticket',
                        ticketId: normalizedTicket.ticketId,
                        consequence: 'Jira ownership will change and watchers or assignee notifications may be sent.',
                        previewLines: assignPreviewLines,
                        preview: assignPreview,
                    });

                    if (!assignApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: assignApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: assignPreviewLines,
                            preview: assignPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('assign_jira_ticket', {
                            phase: 'jira', message: `Assigning ${normalizedTicket.ticketId}...`, step: isNonEmptyString(assigneeQuery) ? 2 : 1,
                        });
                    }

                    const assignResponse = await fetch(buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, '/assignee'), {
                        method: 'PUT',
                        headers: jiraConfig.headers,
                        body: JSON.stringify({ accountId: resolvedAssignee.accountId }),
                    });

                    if (!assignResponse.ok && assignResponse.status !== 204) {
                        const rawBody = await assignResponse.text();
                        const formattedError = formatJiraErrorResponse('Issue assignment failed', assignResponse.status, rawBody);
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: formattedError.message,
                            details: formattedError.details,
                            errorMessages: formattedError.errorMessages,
                            fieldErrors: formattedError.fieldErrors,
                            hint: formattedError.hint,
                            attemptedAssignee: resolvedAssignee,
                        }, null, 2);
                    }

                    const assignReceipt = buildMutationReceipt({
                        guardrail: assignApproval.guardrail,
                        title: `Assigned ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: currentTicket.summary,
                        }),
                        changes: assignChanges,
                        notes: assignNotes,
                        outcome: `${normalizedTicket.ticketId} is now assigned to ${resolvedAssigneeLabel}.`,
                        approval: { approved: true, mode: assignApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        ticketUrl,
                        assignee: resolvedAssignee,
                        resolvedFromQuery: isNonEmptyString(assigneeQuery) ? assigneeQuery.trim() : undefined,
                        candidateCount: candidates.length > 0 ? candidates.length : undefined,
                        receipt: assignReceipt,
                        guardrail: buildMutationResultGuardrail(assignApproval.guardrail, {
                            approved: true,
                            mode: assignApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira assignment error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11a6: get_jira_ticket_capabilities
    // Available to: buggenie, testgenie, taskgenie
    // Returns editable field metadata and available workflow transitions.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_ticket_capabilities', {
            description:
                'Inspects a Jira ticket for editable fields, custom field exposure, and available status transitions. ' +
                'Use this before attempting field updates, status changes, or estimate changes so the agent can see what Jira allows.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to inspect (e.g., "AOTF-17250")',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for the returned browse link.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, jiraBaseUrl }) => {
                try {
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('get_jira_ticket_capabilities', {
                            phase: 'jira', message: `Inspecting Jira capabilities for ${ticketId}...`, step: 1,
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const editMetaUrl = buildJiraIssueApiUrl(jiraConfig, ticketId, '/editmeta');
                    const transitionsUrl = `${buildJiraIssueApiUrl(jiraConfig, ticketId, '/transitions')}?expand=transitions.fields`;

                    const [editMetaResp, transitionsResp] = await Promise.all([
                        fetch(editMetaUrl, { method: 'GET', headers: jiraConfig.headers }),
                        fetch(transitionsUrl, { method: 'GET', headers: jiraConfig.headers }),
                    ]);

                    const errors = [];
                    let editableFields = [];
                    let availableTransitions = [];

                    if (editMetaResp.ok) {
                        const editMetaData = await editMetaResp.json();
                        editableFields = Object.entries(editMetaData.fields || {})
                            .map(([fieldId, fieldMeta]) => formatJiraFieldCapability(fieldId, fieldMeta));
                    } else {
                        errors.push(`editmeta failed: HTTP ${editMetaResp.status} — ${await editMetaResp.text()}`);
                    }

                    if (transitionsResp.ok) {
                        const transitionsData = await transitionsResp.json();
                        availableTransitions = (transitionsData.transitions || []).map(transition => ({
                            id: transition.id,
                            name: transition.name || '',
                            toStatus: transition.to?.name || '',
                            toStatusCategory: transition.to?.statusCategory?.key || '',
                            hasScreen: Boolean(transition.hasScreen),
                            requiredFields: Object.entries(transition.fields || {})
                                .filter(([, fieldMeta]) => fieldMeta?.required)
                                .map(([fieldId, fieldMeta]) => formatJiraFieldCapability(fieldId, fieldMeta)),
                        }));
                    } else {
                        errors.push(`transitions failed: HTTP ${transitionsResp.status} — ${await transitionsResp.text()}`);
                    }

                    if (errors.length > 0 && editableFields.length === 0 && availableTransitions.length === 0) {
                        return JSON.stringify({
                            success: false,
                            ticketId,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                            errors,
                        }, null, 2);
                    }

                    const firstClassEditableFieldIds = new Set(['summary', 'description', 'priority', 'labels', 'fixVersions', 'timetracking']);
                    const editableCustomFields = editableFields.filter(field => field.fieldId.startsWith('customfield_'));
                    const editableButNotFirstClass = editableFields.filter(field => !firstClassEditableFieldIds.has(field.fieldId));

                    return JSON.stringify({
                        success: true,
                        ticketId,
                        ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                        editableFields,
                        editableCustomFields,
                        editableButNotFirstClass,
                        availableTransitions,
                        customToolCoverage: {
                            readFields: ['summary', 'description', 'acceptanceCriteria', 'storyPoints', 'status', 'priority', 'labels', 'fixVersions', 'components', 'assignee', 'reporter', 'created', 'updated', 'sprint', 'timetracking', 'epic', 'parent', 'subtasks', 'issueLinks'],
                            createFields: ['projectKey', 'summary', 'description', 'issueType', 'priority', 'labels', 'environment', 'linkedIssueKey', 'linkType', 'parentIssueKey', 'assigneeAccountId', 'originalEstimate', 'remainingEstimate'],
                            updateFields: ['summary', 'description', 'priority', 'labels', 'addLabels', 'fixVersions', 'addFixVersions', 'removeFixVersions', 'comment'],
                            versionOperations: ['get_jira_project_versions'],
                            discoveryOperations: ['search_jira_issues', 'search_jira_epics'],
                            dedicatedOperations: ['get_jira_epic', 'get_jira_epic_issues', 'list_jira_issues_without_epic', 'transition_jira_ticket', 'delete_jira_ticket', 'delete_jira_comment', 'edit_jira_comment', 'log_jira_work', 'update_jira_estimates', 'link_jira_issues', 'remove_jira_issue_link', 'search_jira_users', ...(agentName === 'taskgenie' ? ['assign_jira_ticket'] : [])],
                        },
                        knownFieldAliases: {
                            acceptanceCriteria: ['customfield_10037', 'customfield_10038'],
                            storyPoints: ['story_points', 'customfield_10016'],
                            timetracking: ['timetracking'],
                        },
                        errors: errors.length > 0 ? errors : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira capability inspection error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b: create_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('create_jira_ticket', {
            description:
                'Creates a new Jira ticket via the Atlassian REST API. ' +
                'Used by BugGenie to file defect tickets, TestGenie to create Testing tasks, and TaskGenie to create linked Testing tasks or true subtasks. ' +
                'Supports linking to a related ticket, creating a true subtask under a parent ticket, and assigning to a specific user. ' +
                'Estimate fields are available only for explicit original/remaining estimate requests, not generic Time Tracking hour entry. ' +
                'Returns the created ticket key and URL.',
            parameters: {
                type: 'object',
                properties: {
                    projectKey: {
                        type: 'string',
                        description: 'Jira project key (e.g., "AOTF"). Defaults to JIRA_PROJECT_KEY env var.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Defect ticket summary/title',
                    },
                    description: {
                        type: 'string',
                        description: 'Full defect description including Steps to Reproduce, Expected/Actual Behaviour, Environment',
                    },
                    issueType: {
                        type: 'string',
                        description: 'Issue type (default: "Bug")',
                    },
                    priority: {
                        type: 'string',
                        description: 'Priority level: Highest, High, Medium, Low, Lowest (default: "Medium")',
                    },
                    labels: {
                        type: 'string',
                        description: 'Comma-separated labels to apply only when the user explicitly asks for labels (e.g., "automation,regression,uat"). Omit by default and never infer labels for new tickets.',
                    },
                    environment: {
                        type: 'string',
                        description: 'Environment where defect was found (e.g., "UAT", "INT", "PROD")',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Jira base URL extracted from user-provided ticket URLs (e.g., "https://corelogic.atlassian.net"). Overrides JIRA_BASE_URL env var for the returned ticket URL. Extract this from any Jira URL the user pastes — take everything before "/browse/".',
                    },
                    linkedIssueKey: {
                        type: 'string',
                        description: 'Key of an existing Jira issue to link this ticket to (e.g., "AOTF-17250"). Creates a "relates to" link by default. Use this when creating Testing tasks to link them to the parent ticket.',
                    },
                    parentIssueKey: {
                        type: 'string',
                        description: 'Key of an existing Jira issue to create this ticket under as a true Jira subtask. Cannot be combined with linkedIssueKey.',
                    },
                    linkType: {
                        type: 'string',
                        description: 'Jira issue link type name (default: "Relates"). Common values: "Relates", "Blocks", "is tested by". Only used when linkedIssueKey is provided.',
                    },
                    assigneeAccountId: {
                        type: 'string',
                        description: 'Atlassian account ID of the user to assign the ticket to. Get this from the get_jira_current_user tool to assign to yourself.',
                    },
                    originalEstimate: {
                        type: 'string',
                        description: 'Optional original estimate for Jira time tracking (for example "2h" or "1d"). Use only when the user explicitly asks to set the original estimate field.',
                    },
                    remainingEstimate: {
                        type: 'string',
                        description: 'Optional remaining estimate for Jira time tracking (for example "1h" or "4d"). Use only when the user explicitly asks to set the remaining estimate field.',
                    },
                    mentions: {
                        type: 'string',
                        description: 'Optional JSON array of users to @mention in the description. Each entry: {"accountId":"...","displayName":"..."}. Use search_jira_users to resolve names first. Mention nodes trigger Jira notifications.',
                    },
                    evidenceCommentMode: {
                        type: 'string',
                        description: 'Optional BugGenie evidence presentation mode. Use "attachments" (default) to attach active chat evidence only, or "comment" to add an evidence comment with inline screenshots, preview frames, and recording file names after ticket creation.',
                    },
                },
                required: ['summary', 'description'],
            },
            handler: async ({ projectKey, summary, description, issueType, priority, labels, environment, jiraBaseUrl, linkedIssueKey, parentIssueKey, linkType, assigneeAccountId, originalEstimate, remainingEstimate, mentions, evidenceCommentMode }) => {
                try {
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: 'Preparing Jira ticket payload...', step: 1,
                        });
                    }
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const labelIntentContext = classifyJiraLabelIntent(latestUserMessage);
                    const requestedLabels = normalizeJiraLabelList(labels);
                    const normalizedLinkedIssue = isNonEmptyString(linkedIssueKey)
                        ? normalizeJiraTicketInput(linkedIssueKey, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };
                    const normalizedParentIssue = isNonEmptyString(parentIssueKey)
                        ? normalizeJiraTicketInput(parentIssueKey, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };
                    const resolvedEvidenceCommentMode = isNonEmptyString(evidenceCommentMode)
                        ? evidenceCommentMode.trim().toLowerCase()
                        : 'attachments';

                    if (!['attachments', 'comment'].includes(resolvedEvidenceCommentMode)) {
                        return JSON.stringify({
                            success: false,
                            error: 'evidenceCommentMode must be either "attachments" or "comment" when provided.',
                        });
                    }

                    if (linkedIssueKey && !normalizedLinkedIssue.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve linkedIssueKey into a Jira ticket key.',
                            hint: 'Pass linkedIssueKey as a Jira key like AOTF-17250 or a full Jira browse URL.',
                        });
                    }

                    if (parentIssueKey && !normalizedParentIssue.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve parentIssueKey into a Jira ticket key.',
                            hint: 'Pass parentIssueKey as a Jira key like AOTF-17620 or a full Jira browse URL.',
                        });
                    }

                    if (normalizedLinkedIssue.ticketId && normalizedParentIssue.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'parentIssueKey cannot be combined with linkedIssueKey in the same request.',
                            hint: 'Use parentIssueKey for a true Jira subtask, or linkedIssueKey for a loose related issue link.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedLinkedIssue.jiraBaseUrl || normalizedParentIssue.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({
                            success: false,
                            error: jiraConfig.error,
                        });
                    }

                    let resolvedProject = projectKey || process.env.JIRA_PROJECT_KEY || 'AOTF';
                    let resolvedType = issueType || 'Bug';
                    const resolvedPriority = priority || 'Medium';

                    const issuePayload = {
                        fields: {
                            project: { key: resolvedProject },
                            summary,
                            description: markdownToAdf(applyMentions(description, mentions)),
                            issuetype: { name: resolvedType },
                            priority: { name: resolvedPriority },
                        },
                    };

                    if (normalizedParentIssue.ticketId) {
                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                                phase: 'jira', message: `Resolving parent ticket ${normalizedParentIssue.ticketId} for subtask creation...`, step: 2,
                            });
                        }

                        const parentResponse = await fetch(`${buildJiraIssueApiUrl(jiraConfig, normalizedParentIssue.ticketId)}?fields=project`, {
                            method: 'GET',
                            headers: jiraConfig.headers,
                        });

                        if (!parentResponse.ok) {
                            return JSON.stringify({
                                success: false,
                                error: `Failed to fetch parent issue ${normalizedParentIssue.ticketId}: HTTP ${parentResponse.status}`,
                                details: await parentResponse.text(),
                            }, null, 2);
                        }

                        const parentData = await parentResponse.json();
                        const parentProjectKey = parentData.fields?.project?.key || '';
                        if (!parentProjectKey) {
                            return JSON.stringify({
                                success: false,
                                error: `Parent issue ${normalizedParentIssue.ticketId} did not expose a Jira project key.`,
                            });
                        }

                        if (isNonEmptyString(projectKey) && projectKey.trim() !== parentProjectKey) {
                            return JSON.stringify({
                                success: false,
                                error: `projectKey ${projectKey.trim()} does not match parent issue project ${parentProjectKey}.`,
                                hint: 'True subtasks must live in the same Jira project as their parent issue.',
                            });
                        }

                        const issueTypeMetadata = await fetchJiraCreateIssueTypes(jiraConfig, parentProjectKey);
                        if (issueTypeMetadata.error) {
                            return JSON.stringify({
                                success: false,
                                error: issueTypeMetadata.error,
                                details: issueTypeMetadata.details,
                            }, null, 2);
                        }

                        const subtaskSelection = selectJiraSubtaskIssueType(issueTypeMetadata.issueTypes, issueType);
                        if (!subtaskSelection.selected) {
                            return JSON.stringify({
                                success: false,
                                error: isNonEmptyString(issueType)
                                    ? `Issue type ${issueType} is not available as a subtask in project ${parentProjectKey}.`
                                    : `No subtask-capable issue type is available in project ${parentProjectKey}.`,
                                availableSubtaskIssueTypes: subtaskSelection.availableSubtasks.map(item => ({ id: item.id || '', name: item.name || '' })),
                            }, null, 2);
                        }

                        resolvedProject = parentProjectKey;
                        resolvedType = subtaskSelection.selected.name || resolvedType;
                        issuePayload.fields.project = { key: resolvedProject };
                        issuePayload.fields.parent = { key: normalizedParentIssue.ticketId };
                        issuePayload.fields.issuetype = subtaskSelection.selected.id
                            ? { id: subtaskSelection.selected.id }
                            : { name: resolvedType };
                    }

                    if (requestedLabels.length > 0 && labelIntentContext.intent === 'allow') {
                        issuePayload.fields.labels = requestedLabels;
                    }
                    const normalizedEnvironment = isNonEmptyString(environment)
                        ? String(environment).trim()
                        : '';
                    if (normalizedEnvironment) {
                        issuePayload.fields.environment = normalizedEnvironment;
                    }
                    if (assigneeAccountId) {
                        issuePayload.fields.assignee = { accountId: assigneeAccountId };
                    }
                    if (originalEstimate || remainingEstimate) {
                        issuePayload.fields.timetracking = {};
                        if (originalEstimate) issuePayload.fields.timetracking.originalEstimate = originalEstimate;
                        if (remainingEstimate) issuePayload.fields.timetracking.remainingEstimate = remainingEstimate;
                    }

                    const createChanges = [
                        createMutationFieldChange({ field: 'project', label: 'Project', before: '', after: resolvedProject }),
                        createMutationFieldChange({ field: 'issueType', label: 'Issue type', before: '', after: resolvedType }),
                        createMutationFieldChange({ field: 'summary', label: 'Summary', before: '', after: summary }),
                        createMutationFieldChange({ field: 'description', label: 'Description', before: '', after: description }),
                        createMutationFieldChange({ field: 'priority', label: 'Priority', before: '', after: resolvedPriority }),
                        createMutationFieldChange({ field: 'labels', label: 'Labels', before: '', after: issuePayload.fields.labels || [] }),
                        createMutationFieldChange({ field: 'environment', label: 'Environment', before: '', after: normalizedEnvironment }),
                        createMutationFieldChange({ field: 'assignee', label: 'Assignee account', before: '', after: issuePayload.fields.assignee?.accountId || '' }),
                        createMutationFieldChange({ field: 'parent', label: 'Parent issue', before: '', after: issuePayload.fields.parent?.key || '' }),
                        createMutationFieldChange({ field: 'originalEstimate', label: 'Original estimate', before: '', after: issuePayload.fields.timetracking?.originalEstimate || '' }),
                        createMutationFieldChange({ field: 'remainingEstimate', label: 'Remaining estimate', before: '', after: issuePayload.fields.timetracking?.remainingEstimate || '' }),
                    ].filter(Boolean);
                    const createNotes = [
                        normalizedLinkedIssue.ticketId ? `Will link the new ticket to ${normalizedLinkedIssue.ticketId}${isNonEmptyString(linkType) ? ` using ${linkType.trim()}` : ''}.` : '',
                        String(issueType || 'Bug').trim().toLowerCase() === 'bug' && resolvedEvidenceCommentMode === 'comment'
                            ? 'After ticket creation, active chat evidence will be posted as a Jira comment with inline screenshots, preview frames, and recording file names.'
                            : '',
                    ].filter(Boolean);
                    const createPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('create_jira_ticket'),
                        title: 'Approve Jira ticket creation',
                        subject: buildMutationSubject({
                            title: summary,
                            label: `New ${resolvedType} ticket`,
                        }),
                        changes: createChanges,
                        notes: createNotes,
                        consequence: 'Jira will create a new issue that can trigger notifications, assignments, and downstream workflow updates.',
                    });
                    const createPreviewLines = buildJiraMutationPreviewLines([], createPreview);

                    const createApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'create_jira_ticket',
                        ticketId: normalizedParentIssue.ticketId || normalizedLinkedIssue.ticketId || null,
                        relatedIssueKey: normalizedLinkedIssue.ticketId || null,
                        consequence: 'Jira will create a new issue that can trigger notifications, assignments, and downstream workflow updates.',
                        previewLines: createPreviewLines,
                        preview: createPreview,
                    });

                    if (!createApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: createApproval,
                            ticketId: normalizedParentIssue.ticketId || normalizedLinkedIssue.ticketId || undefined,
                            ticketUrl: undefined,
                            previewLines: createPreviewLines,
                            preview: createPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: `Creating ${normalizedParentIssue.ticketId ? resolvedType : (issueType || 'Bug')} ticket in Jira...`, step: normalizedParentIssue.ticketId ? 3 : 2,
                        });
                    }

                    const cloneCreatePayload = payload => JSON.parse(JSON.stringify(payload));
                    const buildEnvironmentAdf = value => ({
                        type: 'doc',
                        version: 1,
                        content: [{
                            type: 'paragraph',
                            content: [{ type: 'text', text: value }],
                        }],
                    });
                    const appendEnvironmentFallbackToDescription = (descriptionDoc, value) => {
                        const nextDescription = cloneCreatePayload(descriptionDoc || { type: 'doc', version: 1, content: [] });
                        if (!Array.isArray(nextDescription.content)) {
                            nextDescription.content = [];
                        }
                        nextDescription.content.push({
                            type: 'paragraph',
                            content: [{ type: 'text', text: `Environment fallback: ${value}` }],
                        });
                        return nextDescription;
                    };
                    const classifyEnvironmentCreateError = parsedError => {
                        const environmentMessage = String(parsedError.fieldErrors?.environment || '').toLowerCase();
                        const combinedMessages = [
                            ...parsedError.errorMessages,
                            ...Object.values(parsedError.fieldErrors || {}),
                            parsedError.details,
                        ]
                            .filter(Boolean)
                            .join(' ')
                            .toLowerCase();

                        const hasEnvironmentSignal = Boolean(parsedError.fieldErrors?.environment)
                            || combinedMessages.includes('environment');
                        if (!hasEnvironmentSignal) {
                            return { isEnvironmentRelated: false, action: null, reason: '' };
                        }

                        const environmentContext = `${environmentMessage} ${combinedMessages}`;
                        if (/(atlassian document format|\badf\b|operation value must be atlassian document format)/.test(environmentContext)) {
                            return { isEnvironmentRelated: true, action: 'retry-adf', reason: 'adf-required' };
                        }

                        if (/(cannot be set|not on the appropriate screen|unknown|does not exist|not valid for this operation|field .* cannot be set|is not supported)/.test(environmentContext)) {
                            return { isEnvironmentRelated: true, action: 'retry-omit', reason: 'not-settable' };
                        }

                        return { isEnvironmentRelated: true, action: 'retry-omit', reason: 'validation-mismatch' };
                    };

                    const baseCreatePayload = cloneCreatePayload(issuePayload);
                    let requestPayload = cloneCreatePayload(issuePayload);
                    let environmentHandlingMode = normalizedEnvironment ? 'plain-text' : 'not-provided';
                    let environmentFallbackReason = '';
                    const createAttempts = [];
                    let createResponse = null;
                    let createFailure = null;

                    for (let attempt = 1; attempt <= 3; attempt++) {
                        const includesEnvironmentField = Object.prototype.hasOwnProperty.call(requestPayload.fields || {}, 'environment');
                        const response = await fetch(`${jiraConfig.apiBase}/issue`, {
                            method: 'POST',
                            headers: jiraConfig.headers,
                            body: JSON.stringify(requestPayload),
                        });

                        const attemptLog = {
                            attempt,
                            mode: environmentHandlingMode,
                            includesEnvironmentField,
                            status: response.status,
                        };
                        createAttempts.push(attemptLog);

                        if (response.ok) {
                            createResponse = response;
                            break;
                        }

                        const errorBody = await response.text();
                        const parsedError = parseJiraErrorBody(errorBody);
                        const formattedError = formatJiraErrorResponse('Failed to create ticket', response.status, errorBody, {
                            includesDescription: true,
                            includesEnvironment: includesEnvironmentField,
                        });

                        createFailure = {
                            status: response.status,
                            message: formattedError.message,
                            details: formattedError.details,
                            errorMessages: formattedError.errorMessages,
                            fieldErrors: formattedError.fieldErrors,
                            hint: formattedError.hint,
                        };

                        if (!(response.status === 400 && normalizedEnvironment)) {
                            break;
                        }

                        const classification = classifyEnvironmentCreateError(parsedError);
                        if (!classification.isEnvironmentRelated) {
                            break;
                        }

                        if (classification.action === 'retry-adf' && environmentHandlingMode !== 'adf') {
                            environmentHandlingMode = 'adf';
                            environmentFallbackReason = classification.reason;
                            requestPayload = cloneCreatePayload(baseCreatePayload);
                            requestPayload.fields.environment = buildEnvironmentAdf(normalizedEnvironment);

                            if (deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                                    phase: 'jira',
                                    message: 'Jira rejected plain-text environment; retrying with rich text environment format...',
                                    step: normalizedParentIssue.ticketId ? 3 : 2,
                                });
                            }
                            continue;
                        }

                        if (environmentHandlingMode !== 'omitted-after-validation-error') {
                            environmentHandlingMode = 'omitted-after-validation-error';
                            environmentFallbackReason = classification.reason;
                            requestPayload = cloneCreatePayload(baseCreatePayload);
                            delete requestPayload.fields.environment;
                            requestPayload.fields.description = appendEnvironmentFallbackToDescription(
                                requestPayload.fields.description,
                                normalizedEnvironment
                            );

                            if (deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                                    phase: 'jira',
                                    message: 'Jira rejected environment field for this project; retrying without environment and preserving details in description...',
                                    step: normalizedParentIssue.ticketId ? 3 : 2,
                                });
                            }
                            continue;
                        }

                        break;
                    }

                    if (!createResponse) {
                        return JSON.stringify({
                            success: false,
                            error: createFailure?.message || 'Failed to create ticket',
                            details: createFailure?.details,
                            errorMessages: createFailure?.errorMessages,
                            fieldErrors: createFailure?.fieldErrors,
                            hint: createFailure?.hint,
                            status: createFailure?.status,
                            failurePhase: 'jira-create',
                            environmentHandling: {
                                mode: environmentHandlingMode,
                                value: normalizedEnvironment || undefined,
                                fallbackReason: environmentFallbackReason || undefined,
                                attempts: createAttempts,
                            },
                        }, null, 2);
                    }

                    const data = await createResponse.json();
                    const ticketKey = data.key;
                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, ticketKey);

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                            phase: 'jira', message: `Ticket ${ticketKey} created${normalizedLinkedIssue.ticketId ? ' — linking issues...' : ''}`, step: normalizedLinkedIssue.ticketId ? 4 : (normalizedParentIssue.ticketId ? 4 : 3),
                        });
                    }

                    let linkResult = null;
                    if (normalizedLinkedIssue.ticketId) {
                        try {
                            const resolvedLinkType = linkType || 'Relates';
                            const linkPayload = {
                                type: { name: resolvedLinkType },
                                inwardIssue: { key: ticketKey },
                                outwardIssue: { key: normalizedLinkedIssue.ticketId },
                            };

                            const linkResp = await fetch(`${jiraConfig.apiBase}/issueLink`, {
                                method: 'POST',
                                headers: jiraConfig.headers,
                                body: JSON.stringify(linkPayload),
                            });

                            if (linkResp.ok || linkResp.status === 201) {
                                linkResult = { success: true, linkedTo: normalizedLinkedIssue.ticketId, linkType: resolvedLinkType };
                            } else {
                                const linkErr = await linkResp.text();
                                linkResult = { success: false, error: `Link failed: HTTP ${linkResp.status}`, details: linkErr };
                            }
                        } catch (linkError) {
                            linkResult = { success: false, error: `Link error: ${linkError.message}` };
                        }
                    }

                    let evidenceAttachments;
                    let evidenceComment;
                    if (String(resolvedType).toLowerCase() === 'bug') {
                        const sessionResult = getActiveSessionEntry(undefined, deps);
                        if (!sessionResult.error) {
                            const attachmentConfig = getJiraAttachmentConfig({ baseUrl: jiraBaseUrl || jiraConfig.baseUrl });
                            if (!attachmentConfig.error) {
                                if (deps?.chatManager?.broadcastToolProgress) {
                                    deps.chatManager.broadcastToolProgress('create_jira_ticket', {
                                        phase: 'jira', message: resolvedEvidenceCommentMode === 'comment'
                                            ? `Ticket ${ticketKey} created — adding chat evidence comment...`
                                            : `Ticket ${ticketKey} created — attaching chat evidence...`, step: normalizedLinkedIssue.ticketId || normalizedParentIssue.ticketId ? 5 : 4,
                                    });
                                }

                                if (resolvedEvidenceCommentMode === 'comment') {
                                    evidenceComment = await addCommentWithMediaToJira({
                                        ticketKey,
                                        comment: [
                                            '**Active chat evidence attached for this bug ticket.**',
                                            'Screenshots and selected preview frames are shown inline below when available.',
                                            'Original recordings are listed by file name in the Video evidence section when available.',
                                        ].join('\n'),
                                        jiraConfig: attachmentConfig,
                                        apiConfig: jiraConfig,
                                        entry: sessionResult.entry,
                                        activeEvidenceMessageId: sessionResult.entry?.sessionContext?.activeEvidenceMessageId,
                                        includeVideoFrames: true,
                                        maxVideoFrames: 4,
                                        toolName: 'create_jira_ticket',
                                        deps,
                                    });

                                    if (!evidenceComment.success && /^No images or videos were available/i.test(String(evidenceComment.error || ''))) {
                                        evidenceComment = undefined;
                                    }
                                } else {
                                    evidenceAttachments = await attachEvidenceToJira({
                                        ticketKey,
                                        jiraConfig: attachmentConfig,
                                        entry: sessionResult.entry,
                                        activeEvidenceMessageId: sessionResult.entry?.sessionContext?.activeEvidenceMessageId,
                                    });
                                    if (!evidenceAttachments.hasEvidence) {
                                        evidenceAttachments = undefined;
                                    }
                                }
                            }
                        }
                    }

                    const receiptNotes = [
                        normalizedLinkedIssue.ticketId && linkResult?.success
                            ? `Linked ${ticketKey} to ${normalizedLinkedIssue.ticketId} using ${linkResult.linkType || linkType || 'Relates'}.`
                            : '',
                        normalizedLinkedIssue.ticketId && linkResult && linkResult.success === false
                            ? `Linking to ${normalizedLinkedIssue.ticketId} failed: ${linkResult.error}`
                            : '',
                        evidenceAttachments?.hasEvidence
                            ? `Attached ${evidenceAttachments.totals?.images || 0} screenshot(s), ${evidenceAttachments.totals?.videos || 0} recording(s), and ${evidenceAttachments.totals?.frames || 0} frame image(s) from the active chat evidence.`
                            : '',
                        evidenceComment?.success
                            ? `Added an evidence comment with ${evidenceComment.uploaded?.images || 0} inline screenshot(s), ${evidenceComment.uploaded?.frames || 0} preview frame(s), and ${evidenceComment.uploaded?.videos || 0} listed recording name(s) from the active chat evidence.`
                            : '',
                        evidenceComment && evidenceComment.success === false && isNonEmptyString(evidenceComment.error)
                            ? `Adding the evidence comment failed: ${evidenceComment.error}`
                            : '',
                        normalizedEnvironment && environmentHandlingMode === 'adf'
                            ? 'Environment field fallback: Jira required rich text, so environment was retried in Atlassian Document Format.'
                            : '',
                        normalizedEnvironment && environmentHandlingMode === 'omitted-after-validation-error'
                            ? 'Environment field fallback: Jira rejected the environment field for this project, so the environment value was preserved in description text.'
                            : '',
                    ].filter(Boolean);
                    const createReceipt = buildMutationReceipt({
                        guardrail: createApproval.guardrail,
                        title: `Created ${ticketKey}`,
                        subject: buildJiraMutationSubject({
                            ticketId: ticketKey,
                            ticketUrl,
                            summary,
                        }),
                        changes: createChanges,
                        notes: [...createNotes, ...receiptNotes],
                        outcome: `Created Jira ${resolvedType.toLowerCase()} ${ticketKey} in project ${resolvedProject}.`,
                        approval: { approved: true, mode: createApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketKey,
                        ticketId: data.id,
                        ticketUrl,
                        summary,
                        issueType: resolvedType,
                        priority: resolvedPriority,
                        project: resolvedProject,
                        assignee: assigneeAccountId ? { accountId: assigneeAccountId } : undefined,
                        parent: normalizedParentIssue.ticketId ? { key: normalizedParentIssue.ticketId } : undefined,
                        link: linkResult || undefined,
                        evidenceCommentMode: resolvedEvidenceCommentMode,
                        environmentHandling: {
                            mode: environmentHandlingMode,
                            value: normalizedEnvironment || undefined,
                            fallbackReason: environmentFallbackReason || undefined,
                            attempts: createAttempts,
                        },
                        receipt: createReceipt,
                        guardrail: buildMutationResultGuardrail(createApproval.guardrail, {
                            approved: true,
                            mode: createApproval.mode,
                        }),
                        evidenceAttachments,
                        evidenceComment,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira creation error: ${error.message}`,
                        details: isNonEmptyString(error?.details) ? error.details : undefined,
                        errorMessages: Array.isArray(error?.errorMessages) && error.errorMessages.length > 0 ? error.errorMessages : undefined,
                        fieldErrors: error?.fieldErrors && typeof error.fieldErrors === 'object' ? error.fieldErrors : undefined,
                        status: Number.isFinite(error?.status) ? Number(error.status) : undefined,
                        failurePhase: 'exception',
                        hint: isNonEmptyString(error?.hint)
                            ? error.hint
                            : 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    }, null, 2);
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b0: link_jira_issues
    // Available to: buggenie, testgenie, taskgenie
    // Creates a link between two existing Jira issues.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('link_jira_issues', {
            description:
                'Creates a link between two existing Jira issues. ' +
                'Use this when you need to associate two tickets (e.g., relates to, blocks, is blocked by, duplicates). ' +
                'This does NOT create a new ticket — it only links two existing ones.',
            parameters: {
                type: 'object',
                properties: {
                    inwardIssueKey: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL for the inward (source) issue.',
                    },
                    outwardIssueKey: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL for the outward (target) issue.',
                    },
                    linkType: {
                        type: 'string',
                        description: 'Link type name. Common values: "Relates" (default), "Blocks", "Duplicate", "Cloners". Use get_jira_ticket_capabilities to see available link types.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL override.',
                    },
                },
                required: ['inwardIssueKey', 'outwardIssueKey'],
            },
            handler: async ({ inwardIssueKey, outwardIssueKey, linkType, jiraBaseUrl }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedInward = normalizeJiraTicketInput(inwardIssueKey, latestUserMessage);
                    const normalizedOutward = normalizeJiraTicketInput(outwardIssueKey, latestUserMessage);

                    if (!normalizedInward.ticketId) {
                        return JSON.stringify({ success: false, error: 'Could not resolve inwardIssueKey to a valid Jira ticket key.' });
                    }
                    if (!normalizedOutward.ticketId) {
                        return JSON.stringify({ success: false, error: 'Could not resolve outwardIssueKey to a valid Jira ticket key.' });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedInward.jiraBaseUrl || normalizedOutward.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedLinkType = (linkType || 'Relates').trim();
                    const inwardUrl = buildJiraBrowseUrl(jiraConfig, normalizedInward.ticketId);
                    const outwardUrl = buildJiraBrowseUrl(jiraConfig, normalizedOutward.ticketId);

                    // Build mutation preview for approval
                    const linkChanges = [createMutationFieldChange({
                        field: 'issueLink',
                        label: 'Issue Link',
                        before: '',
                        after: `${resolvedLinkType}: ${normalizedInward.ticketId} ↔ ${normalizedOutward.ticketId}`,
                    })].filter(Boolean);

                    const linkPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('link_jira_issues'),
                        title: `Approve linking ${normalizedInward.ticketId} ↔ ${normalizedOutward.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedInward.ticketId,
                            ticketUrl: inwardUrl,
                        }),
                        changes: linkChanges,
                        notes: [`Link type: ${resolvedLinkType}`, `Target: ${normalizedOutward.ticketId}`],
                        consequence: `A "${resolvedLinkType}" link will be created between ${normalizedInward.ticketId} and ${normalizedOutward.ticketId}.`,
                    });
                    const linkPreviewLines = buildJiraMutationPreviewLines([], linkPreview);

                    // Request approval
                    const approval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'link_jira_issues',
                        ticketId: normalizedInward.ticketId,
                        relatedIssueKey: normalizedOutward.ticketId,
                        consequence: `A "${resolvedLinkType}" link will be created between ${normalizedInward.ticketId} and ${normalizedOutward.ticketId}.`,
                        previewLines: linkPreviewLines,
                        preview: linkPreview,
                    });

                    if (!approval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval,
                            ticketId: normalizedInward.ticketId,
                            ticketUrl: inwardUrl,
                            previewLines: linkPreviewLines,
                            preview: linkPreview,
                        }), null, 2);
                    }

                    // Broadcast progress
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('link_jira_issues', {
                            phase: 'jira',
                            message: `Creating ${resolvedLinkType} link: ${normalizedInward.ticketId} ↔ ${normalizedOutward.ticketId}...`,
                            step: 1,
                        });
                    }

                    // POST to /issueLink
                    const linkPayload = {
                        type: { name: resolvedLinkType },
                        inwardIssue: { key: normalizedInward.ticketId },
                        outwardIssue: { key: normalizedOutward.ticketId },
                    };

                    const linkResp = await fetch(`${jiraConfig.apiBase}/issueLink`, {
                        method: 'POST',
                        headers: jiraConfig.headers,
                        body: JSON.stringify(linkPayload),
                    });

                    if (!linkResp.ok && linkResp.status !== 201) {
                        const errText = await linkResp.text();
                        return JSON.stringify({
                            success: false,
                            error: `Issue link creation failed: HTTP ${linkResp.status}`,
                            details: errText,
                            inwardIssue: normalizedInward.ticketId,
                            outwardIssue: normalizedOutward.ticketId,
                            linkType: resolvedLinkType,
                        }, null, 2);
                    }

                    const receipt = buildMutationReceipt({
                        guardrail: approval.guardrail,
                        title: `Linked ${normalizedInward.ticketId} ↔ ${normalizedOutward.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedInward.ticketId,
                            ticketUrl: inwardUrl,
                        }),
                        changes: linkChanges,
                        notes: [`Link type: ${resolvedLinkType}`, `Target: ${normalizedOutward.ticketId}`],
                        outcome: `Created "${resolvedLinkType}" link between ${normalizedInward.ticketId} and ${normalizedOutward.ticketId}.`,
                        approval: { approved: true, mode: approval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        inwardIssue: normalizedInward.ticketId,
                        inwardIssueUrl: inwardUrl,
                        outwardIssue: normalizedOutward.ticketId,
                        outwardIssueUrl: outwardUrl,
                        linkType: resolvedLinkType,
                        receipt,
                        guardrail: buildMutationResultGuardrail(approval.guardrail, {
                            approved: true,
                            mode: approval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Issue link creation error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b1: remove_jira_issue_link
    // Available to: buggenie, testgenie, taskgenie
    // Removes an existing Jira issue link by link ID or ticket pair.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('remove_jira_issue_link', {
            description:
                'Removes an existing Jira issue link. ' +
                'Use this only when the user explicitly asks to unlink tickets or remove an associated link. ' +
                'The safest mode is to provide ticketId plus relatedIssueKey so the tool can resolve the correct link ID before deleting it.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Source Jira ticket key or browse URL that currently contains the associated link.',
                    },
                    relatedIssueKey: {
                        type: 'string',
                        description: 'Related Jira ticket key or browse URL for the link that should be removed.',
                    },
                    linkId: {
                        type: 'string',
                        description: 'Optional explicit Jira issue-link ID. When omitted, the tool resolves the link from ticketId and relatedIssueKey.',
                    },
                    linkType: {
                        type: 'string',
                        description: 'Optional Jira link type name or direction label to disambiguate when multiple links exist between the same tickets.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                },
                required: [],
            },
            handler: async ({ ticketId, relatedIssueKey, linkId, linkType, jiraBaseUrl }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = isNonEmptyString(ticketId)
                        ? normalizeJiraTicketInput(ticketId, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };
                    const normalizedRelatedIssue = isNonEmptyString(relatedIssueKey)
                        ? normalizeJiraTicketInput(relatedIssueKey, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (!isNonEmptyString(linkId) && !normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide ticketId when linkId is not supplied.',
                        });
                    }

                    if (!isNonEmptyString(linkId) && !normalizedRelatedIssue.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide relatedIssueKey when linkId is not supplied.',
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl || normalizedRelatedIssue.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    let resolvedLink = null;
                    if (isNonEmptyString(linkId)) {
                        resolvedLink = {
                            id: linkId.trim(),
                            relatedIssueKey: normalizedRelatedIssue.ticketId || '',
                            type: {
                                id: '',
                                name: linkType || '',
                                inward: '',
                                outward: '',
                            },
                        };
                    } else {
                        const response = await fetch(`${buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId)}?fields=issuelinks`, {
                            method: 'GET',
                            headers: jiraConfig.headers,
                        });

                        if (!response.ok) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `Failed to load issue links for ${normalizedTicket.ticketId}: HTTP ${response.status}`,
                                details: await response.text(),
                            }, null, 2);
                        }

                        const issueData = await response.json();
                        const availableLinks = formatJiraIssueLinks(issueData.fields || {});
                        const normalizedLinkType = isNonEmptyString(linkType) ? linkType.trim().toLowerCase() : '';
                        const matches = availableLinks.filter(link => {
                            if (link.relatedIssueKey !== normalizedRelatedIssue.ticketId) return false;
                            if (!normalizedLinkType) return true;

                            return [link.type.name, link.type.inward, link.type.outward]
                                .filter(Boolean)
                                .some(value => String(value).trim().toLowerCase() === normalizedLinkType);
                        });

                        if (matches.length === 0) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `No issue link found between ${normalizedTicket.ticketId} and ${normalizedRelatedIssue.ticketId}.`,
                                availableLinks: availableLinks.map(link => ({
                                    id: link.id,
                                    relatedIssueKey: link.relatedIssueKey,
                                    type: link.type,
                                })),
                            }, null, 2);
                        }

                        if (matches.length > 1) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl: buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId),
                                error: `Multiple issue links matched ${normalizedTicket.ticketId} -> ${normalizedRelatedIssue.ticketId}. Provide linkType or linkId to disambiguate.`,
                                matches: matches.map(link => ({
                                    id: link.id,
                                    relatedIssueKey: link.relatedIssueKey,
                                    type: link.type,
                                })),
                            }, null, 2);
                        }

                        resolvedLink = matches[0];
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);
                    const resolvedRelatedIssueKey = resolvedLink.relatedIssueKey || normalizedRelatedIssue.ticketId || '';
                    const linkLabel = resolvedLink.type?.name || linkType || 'Issue link';
                    const linkChanges = [createMutationFieldChange({
                        field: 'issueLink',
                        label: 'Issue link',
                        before: `${linkLabel}: ${resolvedRelatedIssueKey}${resolvedLink.id ? ` (${resolvedLink.id})` : ''}`,
                        after: '',
                    })].filter(Boolean);
                    const linkNotes = [
                        resolvedLink.id ? `Link id: ${resolvedLink.id}` : '',
                    ].filter(Boolean);
                    const linkPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('remove_jira_issue_link'),
                        title: `Approve unlink for ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                        }),
                        changes: linkChanges,
                        notes: linkNotes,
                        consequence: 'The linked issues will no longer appear associated in Jira and dependency context can be lost from both tickets.',
                    });
                    const linkPreviewLines = buildJiraMutationPreviewLines([], linkPreview);

                    const linkApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'remove_jira_issue_link',
                        ticketId: normalizedTicket.ticketId,
                        relatedIssueKey: resolvedRelatedIssueKey,
                        consequence: 'The linked issues will no longer appear associated in Jira and dependency context can be lost from both tickets.',
                        previewLines: linkPreviewLines,
                        preview: linkPreview,
                    });

                    if (!linkApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: linkApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: linkPreviewLines,
                            preview: linkPreview,
                        }), null, 2);
                    }

                    const deleteResponse = await fetch(`${jiraConfig.apiBase}/issueLink/${encodeURIComponent(resolvedLink.id)}`, {
                        method: 'DELETE',
                        headers: jiraConfig.headers,
                    });

                    if (!deleteResponse.ok && deleteResponse.status !== 204) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId || undefined,
                            ticketUrl: normalizedTicket.ticketId ? ticketUrl : undefined,
                            error: `Issue link delete failed: HTTP ${deleteResponse.status}`,
                            details: await deleteResponse.text(),
                        }, null, 2);
                    }

                    const linkReceipt = buildMutationReceipt({
                        guardrail: linkApproval.guardrail,
                        title: `Removed link from ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                        }),
                        changes: linkChanges,
                        notes: linkNotes,
                        outcome: `Removed the ${linkLabel} association between ${normalizedTicket.ticketId} and ${resolvedRelatedIssueKey}.`,
                        approval: { approved: true, mode: linkApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId || undefined,
                        ticketUrl: normalizedTicket.ticketId ? ticketUrl : undefined,
                        removedLink: {
                            id: resolvedLink.id,
                            relatedIssueKey: resolvedRelatedIssueKey,
                            type: resolvedLink.type || undefined,
                        },
                        receipt: linkReceipt,
                        guardrail: buildMutationResultGuardrail(linkApproval.guardrail, {
                            approved: true,
                            mode: linkApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Issue link removal error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b2: delete_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // Permanently deletes a Jira issue. Gated by the shared approval
    // component so the user must confirm in the UI.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('delete_jira_ticket', {
            description:
                'Permanently deletes a Jira ticket through the Jira REST API. ' +
                'Use this only when the user explicitly asks to delete an issue. ' +
                'The shared Jira approval component prompts the user for confirmation before the delete is executed.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL to delete.',
                    },
                    confirmationText: {
                        type: 'string',
                        description: 'Explicit confirmation phrase. Use DELETE <ticketId> (or DELETE <ticketId> WITH SUBTASKS).',
                    },
                    deleteSubtasks: {
                        type: 'boolean',
                        description: 'When true, Jira will also delete the issue subtasks.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for browse links and Jira routing.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional short reason describing why the ticket is being deleted.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, confirmationText, deleteSubtasks, jiraBaseUrl, reason }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = isNonEmptyString(ticketId)
                        ? normalizeJiraTicketInput(ticketId, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide ticketId as a Jira key like AOTF-17250 or a full Jira browse URL.',
                        }, null, 2);
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);
                    const expectedConfirmation = buildExpectedJiraDeleteConfirmation(normalizedTicket.ticketId, Boolean(deleteSubtasks));
                    const providedConfirmation = normalizeDeleteConfirmationText(
                        isNonEmptyString(confirmationText) ? confirmationText : latestUserMessage
                    );

                    if (providedConfirmation !== expectedConfirmation) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `Deletion requires explicit confirmation phrase \"${expectedConfirmation}\" before Jira delete can proceed.`,
                            expectedConfirmation,
                            confirmationReceived: isNonEmptyString(confirmationText)
                                ? normalizeDeleteConfirmationText(confirmationText)
                                : undefined,
                            hint: deleteSubtasks
                                ? 'Confirm parent and subtask deletion explicitly using the WITH SUBTASKS phrase.'
                                : 'Use DELETE <ticketId> exactly in the latest user instruction or confirmationText.',
                        }, null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('delete_jira_ticket', {
                            phase: 'jira', message: `Inspecting ${normalizedTicket.ticketId} before deletion...`, step: 1,
                        });
                    }

                    const issueResponse = await fetch(`${buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId)}?fields=summary,status,subtasks,issuetype`, {
                        method: 'GET',
                        headers: jiraConfig.headers,
                    });

                    if (!issueResponse.ok) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `Failed to inspect Jira ticket before delete: HTTP ${issueResponse.status}`,
                            details: await issueResponse.text(),
                        }, null, 2);
                    }

                    const issueData = await issueResponse.json();
                    const subtasks = Array.isArray(issueData.fields?.subtasks)
                        ? issueData.fields.subtasks.map(subtask => ({
                            key: subtask.key || '',
                            summary: subtask.fields?.summary || '',
                            status: subtask.fields?.status?.name || '',
                            issueType: subtask.fields?.issuetype?.name || '',
                        }))
                        : [];

                    if (subtasks.length > 0 && !deleteSubtasks) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `${normalizedTicket.ticketId} has ${subtasks.length} subtasks and Jira will not delete it without explicit subtask confirmation.`,
                            expectedConfirmation: buildExpectedJiraDeleteConfirmation(normalizedTicket.ticketId, true),
                            subtasks,
                            hint: 'If the user really wants to delete the parent ticket and its subtasks, call again with deleteSubtasks: true.',
                            suggestedFallbacks: buildJiraDeleteFallbackSuggestions(normalizedTicket.ticketId, true),
                        }, null, 2);
                    }

                    // ── Approval gate ──
                    const deleteChanges = [
                        createMutationFieldChange({
                            field: 'ticket',
                            label: 'Issue',
                            changeType: 'remove',
                            before: `${normalizedTicket.ticketId} — ${issueData.fields?.summary || '(no summary)'}`,
                            after: null,
                            includeUnchanged: true,
                        }),
                        createMutationFieldChange({
                            field: 'status',
                            label: 'Status',
                            changeType: 'remove',
                            before: issueData.fields?.status?.name || '',
                            after: null,
                            includeUnchanged: true,
                        }),
                        subtasks.length > 0
                            ? createMutationFieldChange({
                                field: 'subtasks',
                                label: 'Subtasks (will also be deleted)',
                                changeType: 'remove',
                                before: subtasks.map(s => `${s.key}: ${s.summary}`).join(', '),
                                after: null,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const deletePreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('delete_jira_ticket'),
                        title: `Approve deletion of ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: issueData.fields?.summary || '',
                        }),
                        changes: deleteChanges,
                        notes: [
                            isNonEmptyString(reason) ? `Reason: ${reason.trim()}` : '',
                            deleteSubtasks && subtasks.length > 0 ? `${subtasks.length} subtask(s) will also be permanently deleted.` : '',
                        ].filter(Boolean),
                        consequence: 'The Jira ticket and all its data will be permanently deleted. This action cannot be undone.',
                    });
                    const deletePreviewLines = buildJiraMutationPreviewLines([], deletePreview);

                    const deleteApproval = {
                        approved: true,
                        mode: 'explicit-delete-confirmation',
                        guardrail: buildJiraMutationGuardrailMetadata('delete_jira_ticket'),
                    };

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('delete_jira_ticket', {
                            phase: 'jira', message: `Deleting ${normalizedTicket.ticketId} from Jira...`, step: 2,
                        });
                    }

                    const query = new URLSearchParams();
                    if (deleteSubtasks) {
                        query.set('deleteSubtasks', 'true');
                    }

                    const deleteUrl = `${buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId)}${query.toString() ? `?${query.toString()}` : ''}`;
                    const deleteResponse = await fetch(deleteUrl, {
                        method: 'DELETE',
                        headers: jiraConfig.headers,
                    });

                    if (!deleteResponse.ok && deleteResponse.status !== 204) {
                        const details = await deleteResponse.text();
                        const permissionHint = deleteResponse.status === 403
                            ? 'Jira requires Browse projects and Delete issues permission for this project before a ticket can be deleted.'
                            : undefined;
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `Jira ticket delete failed: HTTP ${deleteResponse.status}`,
                            details,
                            hint: permissionHint,
                            suggestedFallbacks: buildJiraDeleteFallbackSuggestions(normalizedTicket.ticketId, Boolean(deleteSubtasks)),
                        }, null, 2);
                    }

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        ticketUrl,
                        deletedIssue: {
                            key: normalizedTicket.ticketId,
                            summary: issueData.fields?.summary || '',
                            status: issueData.fields?.status?.name || '',
                            issueType: issueData.fields?.issuetype?.name || '',
                        },
                        deletedSubtasks: deleteSubtasks ? subtasks : undefined,
                        confirmationAccepted: expectedConfirmation,
                        reason: isNonEmptyString(reason) ? reason.trim() : undefined,
                        guardrail: buildMutationResultGuardrail(deleteApproval.guardrail, {
                            approved: true,
                            mode: deleteApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira delete error: ${error.message}`,
                    }, null, 2);
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b3a: delete_jira_comment
    // Available to: buggenie, testgenie, taskgenie
    // Permanently deletes a comment on a Jira ticket. Gated by the
    // shared approval component so the user must confirm in the UI.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('delete_jira_comment', {
            description:
                'Permanently deletes a single comment from a Jira ticket via the Jira REST API. ' +
                'The shared Jira approval component prompts the user before the delete is executed; ' +
                'no inline confirmation phrase is required from the caller.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL that owns the comment (for example "AOTF-17250").',
                    },
                    commentId: {
                        type: 'string',
                        description: 'Numeric Jira comment ID to delete. Retrieve it via get_jira_ticket_comments if unknown.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to override environment defaults.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional short reason describing why the comment is being deleted.',
                    },
                },
                required: ['ticketId', 'commentId'],
            },
            handler: async ({ ticketId, commentId, jiraBaseUrl, reason }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = isNonEmptyString(ticketId)
                        ? normalizeJiraTicketInput(ticketId, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide ticketId as a Jira key like AOTF-17250 or a full Jira browse URL.',
                        }, null, 2);
                    }

                    const trimmedCommentId = isNonEmptyString(commentId) ? String(commentId).trim() : '';
                    if (!trimmedCommentId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide commentId as the numeric Jira comment identifier.',
                            hint: 'Use get_jira_ticket_comments to list comment IDs for this ticket.',
                        }, null, 2);
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);

                    // Prefetch comment body so the approval preview shows what is being deleted.
                    let existingCommentBody = '';
                    let existingCommentAuthor = '';
                    try {
                        const fetchUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, `/comment/${encodeURIComponent(trimmedCommentId)}`);
                        const fetchResp = await fetch(fetchUrl, { method: 'GET', headers: jiraConfig.headers });
                        if (fetchResp.ok) {
                            const commentPayload = await fetchResp.json();
                            existingCommentBody = extractTextFromAdf(commentPayload?.body) || '';
                            existingCommentAuthor = commentPayload?.author?.displayName || '';
                        }
                    } catch (_fetchError) { /* best-effort preview only */ }

                    const commentPreviewText = existingCommentBody.length > 240
                        ? `${existingCommentBody.slice(0, 240).trim()}…`
                        : existingCommentBody;

                    const commentSubjectLabel = `Comment ${trimmedCommentId} on ${normalizedTicket.ticketId}`;
                    const commentChanges = [
                        createMutationFieldChange({
                            field: 'comment',
                            label: 'Comment',
                            changeType: 'remove',
                            before: commentPreviewText || '(content unavailable)',
                            after: null,
                            includeUnchanged: true,
                        }),
                        existingCommentAuthor
                            ? createMutationFieldChange({
                                field: 'author',
                                label: 'Author',
                                changeType: 'remove',
                                before: existingCommentAuthor,
                                after: null,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const commentPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('delete_jira_comment'),
                        title: `Approve comment deletion on ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: commentSubjectLabel,
                        }),
                        changes: commentChanges,
                        notes: [
                            `Comment ID: ${trimmedCommentId}`,
                            isNonEmptyString(reason) ? `Reason: ${reason.trim()}` : '',
                        ].filter(Boolean),
                        consequence: 'The comment content will be permanently removed from Jira and cannot be restored.',
                    });
                    const commentPreviewLines = buildJiraMutationPreviewLines([], commentPreview);

                    const commentApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'delete_jira_comment',
                        ticketId: normalizedTicket.ticketId,
                        commentId: trimmedCommentId,
                        consequence: 'The comment content will be permanently removed from Jira and cannot be restored.',
                        previewLines: commentPreviewLines,
                        preview: commentPreview,
                    });

                    if (!commentApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: commentApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: commentPreviewLines,
                            preview: commentPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('delete_jira_comment', {
                            phase: 'jira',
                            message: `Deleting comment ${trimmedCommentId} on ${normalizedTicket.ticketId}...`,
                            step: 1,
                        });
                    }

                    const deleteUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, `/comment/${encodeURIComponent(trimmedCommentId)}`);
                    const deleteResponse = await fetch(deleteUrl, {
                        method: 'DELETE',
                        headers: jiraConfig.headers,
                    });

                    if (!deleteResponse.ok && deleteResponse.status !== 204) {
                        const details = await deleteResponse.text();
                        let hint;
                        if (deleteResponse.status === 403) {
                            hint = 'Jira requires Delete own comments or Delete all comments permission for this project. Ask the project admin to grant it, or have the comment author delete it instead.';
                        } else if (deleteResponse.status === 404) {
                            hint = 'Jira could not find that comment. Verify the commentId against get_jira_ticket_comments output and confirm the ticket key is correct.';
                        } else if (deleteResponse.status === 401) {
                            hint = 'Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN in the .env file.';
                        }
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            commentId: trimmedCommentId,
                            ticketUrl,
                            error: `Jira comment delete failed: HTTP ${deleteResponse.status}`,
                            details,
                            hint,
                        }, null, 2);
                    }

                    const commentReceipt = buildMutationReceipt({
                        guardrail: commentApproval.guardrail,
                        title: `Deleted comment on ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: commentSubjectLabel,
                        }),
                        changes: commentChanges,
                        notes: [
                            `Comment ID: ${trimmedCommentId}`,
                            isNonEmptyString(reason) ? `Reason: ${reason.trim()}` : '',
                        ].filter(Boolean),
                        outcome: `Comment ${trimmedCommentId} was permanently removed from ${normalizedTicket.ticketId}.`,
                        approval: { approved: true, mode: commentApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        commentId: trimmedCommentId,
                        ticketUrl,
                        commentsUrl: buildJiraIssueCommentsUrl(jiraConfig, normalizedTicket.ticketId),
                        reason: isNonEmptyString(reason) ? reason.trim() : undefined,
                        receipt: commentReceipt,
                        guardrail: buildMutationResultGuardrail(commentApproval.guardrail, {
                            approved: true,
                            mode: commentApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira comment delete error: ${error.message}`,
                    }, null, 2);
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b3b: edit_jira_comment
    // Available to: buggenie, testgenie, taskgenie
    // Updates the body of an existing Jira comment. Gated by the
    // shared approval component so the user can preview and confirm.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('edit_jira_comment', {
            description:
                'Edits the body of an existing Jira comment via the Jira REST API. ' +
                'The shared Jira approval component previews the old and new text before any write is sent.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL that owns the comment (for example "AOTF-17250").',
                    },
                    commentId: {
                        type: 'string',
                        description: 'Numeric Jira comment ID to update. Retrieve it via get_jira_ticket_comments if unknown.',
                    },
                    body: {
                        type: 'string',
                        description: 'New Markdown body for the comment. Will be converted to Atlassian Document Format automatically.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to override environment defaults.',
                    },
                    mentions: {
                        type: 'string',
                        description: 'Optional JSON array of users to @mention in the comment. Each entry: {"accountId":"...","displayName":"..."}. Use search_jira_users to resolve names first. Mention nodes trigger Jira notifications.',
                    },
                },
                required: ['ticketId', 'commentId', 'body'],
            },
            handler: async ({ ticketId, commentId, body, jiraBaseUrl, mentions }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = isNonEmptyString(ticketId)
                        ? normalizeJiraTicketInput(ticketId, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide ticketId as a Jira key like AOTF-17250 or a full Jira browse URL.',
                        }, null, 2);
                    }

                    const trimmedCommentId = isNonEmptyString(commentId) ? String(commentId).trim() : '';
                    if (!trimmedCommentId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide commentId as the numeric Jira comment identifier.',
                            hint: 'Use get_jira_ticket_comments to list comment IDs for this ticket.',
                        }, null, 2);
                    }

                    if (!isNonEmptyString(body)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide the new comment body as a non-empty Markdown string.',
                        }, null, 2);
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);

                    // Prefetch existing comment for before/after preview.
                    let existingCommentBody = '';
                    let existingCommentAuthor = '';
                    try {
                        const fetchUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, `/comment/${encodeURIComponent(trimmedCommentId)}`);
                        const fetchResp = await fetch(fetchUrl, { method: 'GET', headers: jiraConfig.headers });
                        if (fetchResp.ok) {
                            const commentPayload = await fetchResp.json();
                            existingCommentBody = extractTextFromAdf(commentPayload?.body) || '';
                            existingCommentAuthor = commentPayload?.author?.displayName || '';
                        }
                    } catch (_fetchError) { /* best-effort preview only */ }

                    const truncate = (value) => {
                        if (!isNonEmptyString(value)) return '';
                        const trimmed = value.trim();
                        return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
                    };

                    const editChanges = [
                        createMutationFieldChange({
                            field: 'comment',
                            label: 'Comment body',
                            changeType: 'replace',
                            before: truncate(existingCommentBody) || '(content unavailable)',
                            after: truncate(body),
                            includeUnchanged: true,
                        }),
                        existingCommentAuthor
                            ? createMutationFieldChange({
                                field: 'author',
                                label: 'Author',
                                changeType: 'unchanged',
                                before: existingCommentAuthor,
                                after: existingCommentAuthor,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const commentSubjectLabel = `Comment ${trimmedCommentId} on ${normalizedTicket.ticketId}`;
                    const editPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('edit_jira_comment'),
                        title: `Approve comment edit on ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: commentSubjectLabel,
                        }),
                        changes: editChanges,
                        notes: [`Comment ID: ${trimmedCommentId}`],
                        consequence: 'Jira will replace the existing comment body and notify watchers who subscribe to comment activity.',
                    });
                    const editPreviewLines = buildJiraMutationPreviewLines([], editPreview);

                    const editApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'edit_jira_comment',
                        ticketId: normalizedTicket.ticketId,
                        commentId: trimmedCommentId,
                        consequence: 'Jira will replace the existing comment body and notify watchers who subscribe to comment activity.',
                        previewLines: editPreviewLines,
                        preview: editPreview,
                    });

                    if (!editApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: editApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: editPreviewLines,
                            preview: editPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('edit_jira_comment', {
                            phase: 'jira',
                            message: `Updating comment ${trimmedCommentId} on ${normalizedTicket.ticketId}...`,
                            step: 1,
                        });
                    }

                    const editUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, `/comment/${encodeURIComponent(trimmedCommentId)}`);
                    const editResponse = await fetch(editUrl, {
                        method: 'PUT',
                        headers: jiraConfig.headers,
                        body: JSON.stringify({ body: markdownToAdf(applyMentions(body, mentions)) }),
                    });

                    if (!editResponse.ok) {
                        const details = await editResponse.text();
                        let hint;
                        if (editResponse.status === 403) {
                            hint = 'Jira requires Edit own comments or Edit all comments permission for this project. Ask the project admin to grant it, or have the comment author edit it instead.';
                        } else if (editResponse.status === 404) {
                            hint = 'Jira could not find that comment. Verify the commentId against get_jira_ticket_comments output and confirm the ticket key is correct.';
                        } else if (editResponse.status === 400) {
                            hint = 'Jira rejected the comment payload. Check that the body is valid Markdown convertible to ADF.';
                        }
                        const formattedError = formatJiraErrorResponse('Comment edit failed', editResponse.status, details, {
                            includesDescription: true,
                        });
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            commentId: trimmedCommentId,
                            ticketUrl,
                            error: formattedError.message || `Jira comment edit failed: HTTP ${editResponse.status}`,
                            details,
                            hint: hint || formattedError.hint,
                            errorMessages: formattedError.errorMessages,
                            fieldErrors: formattedError.fieldErrors,
                        }, null, 2);
                    }

                    let updatedComment = null;
                    try {
                        updatedComment = await editResponse.json();
                    } catch (_jsonError) {
                        updatedComment = null;
                    }

                    const editReceipt = buildMutationReceipt({
                        guardrail: editApproval.guardrail,
                        title: `Updated comment on ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: commentSubjectLabel,
                        }),
                        changes: editChanges,
                        notes: [`Comment ID: ${trimmedCommentId}`],
                        outcome: `Comment ${trimmedCommentId} on ${normalizedTicket.ticketId} was updated.`,
                        approval: { approved: true, mode: editApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        commentId: trimmedCommentId,
                        ticketUrl,
                        commentsUrl: buildJiraIssueCommentsUrl(jiraConfig, normalizedTicket.ticketId),
                        updatedAt: updatedComment?.updated || null,
                        author: updatedComment?.author?.displayName || null,
                        updateAuthor: updatedComment?.updateAuthor?.displayName || null,
                        receipt: editReceipt,
                        guardrail: buildMutationResultGuardrail(editApproval.guardrail, {
                            approved: true,
                            mode: editApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira comment edit error: ${error.message}`,
                    }, null, 2);
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b3c: delete_jira_attachment
    // Available to: buggenie, testgenie, taskgenie
    // Permanently deletes an attachment from a Jira ticket. Gated by the
    // shared approval component so the user must confirm in the UI.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('delete_jira_attachment', {
            description:
                'Permanently deletes an attachment from a Jira ticket via the Jira REST API. ' +
                'Requires the numeric attachment ID (get it from the ticket\'s attachment list via get_jira_ticket). ' +
                'The shared Jira approval component prompts the user before the delete is executed.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket key or browse URL that owns the attachment (for context and browse links).',
                    },
                    attachmentId: {
                        type: 'string',
                        description: 'Numeric Jira attachment ID to delete. Retrieve it from the ticket\'s attachment list via get_jira_ticket.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to override environment defaults.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional short reason describing why the attachment is being deleted.',
                    },
                },
                required: ['ticketId', 'attachmentId'],
            },
            handler: async ({ ticketId, attachmentId, jiraBaseUrl, reason }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = isNonEmptyString(ticketId)
                        ? normalizeJiraTicketInput(ticketId, latestUserMessage)
                        : { ticketId: null, jiraBaseUrl: null, source: 'none' };

                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide ticketId as a Jira key like AOTF-17250 or a full Jira browse URL.',
                        }, null, 2);
                    }

                    const trimmedAttachmentId = isNonEmptyString(attachmentId) ? String(attachmentId).trim() : '';
                    if (!trimmedAttachmentId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide attachmentId as the numeric Jira attachment identifier.',
                            hint: 'Use get_jira_ticket to list attachments and their IDs for this ticket.',
                        }, null, 2);
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);

                    // Prefetch attachment metadata for the approval preview.
                    let attachmentName = '';
                    let attachmentSize = '';
                    let attachmentMimeType = '';
                    try {
                        const attachApiBase = jiraConfig.cloudId
                            ? `https://api.atlassian.com/ex/jira/${jiraConfig.cloudId}/rest/api/3`
                            : `${(jiraConfig.baseUrl || '').replace(/\/+$/, '')}/rest/api/3`;
                        const fetchUrl = `${attachApiBase}/attachment/${encodeURIComponent(trimmedAttachmentId)}`;
                        const fetchResp = await fetch(fetchUrl, { method: 'GET', headers: jiraConfig.headers });
                        if (fetchResp.ok) {
                            const attachPayload = await fetchResp.json();
                            attachmentName = attachPayload?.filename || '';
                            attachmentSize = attachPayload?.size
                                ? `${(attachPayload.size / 1024).toFixed(1)} KB`
                                : '';
                            attachmentMimeType = attachPayload?.mimeType || '';
                        }
                    } catch (_fetchError) { /* best-effort preview only */ }

                    const attachSubjectLabel = attachmentName
                        ? `${attachmentName} on ${normalizedTicket.ticketId}`
                        : `Attachment ${trimmedAttachmentId} on ${normalizedTicket.ticketId}`;

                    const attachDelChanges = [
                        createMutationFieldChange({
                            field: 'attachment',
                            label: 'Attachment',
                            changeType: 'remove',
                            before: attachmentName
                                ? `${attachmentName}${attachmentSize ? ` (${attachmentSize})` : ''}`
                                : `Attachment ID ${trimmedAttachmentId}`,
                            after: null,
                            includeUnchanged: true,
                        }),
                        attachmentMimeType
                            ? createMutationFieldChange({
                                field: 'mimeType',
                                label: 'MIME type',
                                changeType: 'remove',
                                before: attachmentMimeType,
                                after: null,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const attachDelPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('delete_jira_attachment'),
                        title: `Approve attachment deletion on ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: attachSubjectLabel,
                        }),
                        changes: attachDelChanges,
                        notes: [
                            `Attachment ID: ${trimmedAttachmentId}`,
                            isNonEmptyString(reason) ? `Reason: ${reason.trim()}` : '',
                        ].filter(Boolean),
                        consequence: 'The attachment will be permanently removed from the Jira issue and cannot be restored.',
                    });
                    const attachDelPreviewLines = buildJiraMutationPreviewLines([], attachDelPreview);

                    const attachDelApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'delete_jira_attachment',
                        ticketId: normalizedTicket.ticketId,
                        consequence: 'The attachment will be permanently removed from the Jira issue and cannot be restored.',
                        previewLines: attachDelPreviewLines,
                        preview: attachDelPreview,
                    });

                    if (!attachDelApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: attachDelApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: attachDelPreviewLines,
                            preview: attachDelPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('delete_jira_attachment', {
                            phase: 'jira',
                            message: `Deleting attachment ${trimmedAttachmentId} from ${normalizedTicket.ticketId}...`,
                            step: 1,
                        });
                    }

                    const attachApiBase = jiraConfig.cloudId
                        ? `https://api.atlassian.com/ex/jira/${jiraConfig.cloudId}/rest/api/3`
                        : `${(jiraConfig.baseUrl || '').replace(/\/+$/, '')}/rest/api/3`;
                    const deleteAttachUrl = `${attachApiBase}/attachment/${encodeURIComponent(trimmedAttachmentId)}`;
                    const deleteAttachResponse = await fetch(deleteAttachUrl, {
                        method: 'DELETE',
                        headers: jiraConfig.headers,
                    });

                    if (!deleteAttachResponse.ok && deleteAttachResponse.status !== 204) {
                        const details = await deleteAttachResponse.text();
                        const permissionHint = deleteAttachResponse.status === 403
                            ? 'Jira requires Delete own attachments or Delete all attachments permission for this project.'
                            : undefined;
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            attachmentId: trimmedAttachmentId,
                            error: `Jira attachment delete failed: HTTP ${deleteAttachResponse.status}`,
                            details,
                            hint: permissionHint,
                        }, null, 2);
                    }

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        ticketUrl,
                        attachmentId: trimmedAttachmentId,
                        deletedAttachment: {
                            id: trimmedAttachmentId,
                            filename: attachmentName || undefined,
                            mimeType: attachmentMimeType || undefined,
                        },
                        reason: isNonEmptyString(reason) ? reason.trim() : undefined,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira attachment delete error: ${error.message}`,
                    }, null, 2);
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b4: transition_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // Performs workflow transitions via Jira transitions API.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('transition_jira_ticket', {
            description:
                'Transitions a Jira ticket to another workflow status using Jira transition rules. ' +
                'Use this for status changes like Open → In Progress or Ready for QA → Done.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to transition (for example "AOTF-17250")',
                    },
                    targetStatus: {
                        type: 'string',
                        description: 'Target status or transition name to resolve dynamically (for example "Done" or "QA Review").',
                    },
                    transitionId: {
                        type: 'string',
                        description: 'Optional explicit Jira transition ID when known.',
                    },
                    resolution: {
                        type: 'string',
                        description: 'Optional Jira resolution name to set during the transition when required.',
                    },
                    comment: {
                        type: 'string',
                        description: 'Optional comment to add as part of the transition.',
                    },
                    fieldsJson: {
                        type: 'string',
                        description: 'Optional JSON object string of Jira fields required by the transition screen.',
                    },
                    updateJson: {
                        type: 'string',
                        description: 'Optional JSON object string for Jira update operations required by the transition screen.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for the returned browse link.',
                    },
                    mentions: {
                        type: 'string',
                        description: 'Optional JSON array of users to @mention in the transition comment. Each entry: {"accountId":"...","displayName":"..."}. Use search_jira_users to resolve names first.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, targetStatus, transitionId, resolution, comment, fieldsJson, updateJson, jiraBaseUrl, mentions }) => {
                try {
                    if (!isNonEmptyString(targetStatus) && !isNonEmptyString(transitionId)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide either targetStatus or transitionId to transition a Jira ticket.',
                        });
                    }

                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = normalizeJiraTicketInput(ticketId, latestUserMessage);
                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve ticketId into a Jira ticket key.',
                            hint: 'Pass a Jira key like AOTF-17250 or a full Jira browse URL.',
                        });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('transition_jira_ticket', {
                            phase: 'jira', message: `Resolving transition for ${normalizedTicket.ticketId}...`, step: 1,
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);
                    const ticketState = await fetchJiraTicketState(jiraConfig, normalizedTicket.ticketId, ['summary', 'status']);
                    if (!ticketState.success) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: ticketState.error,
                            details: ticketState.details,
                            errorMessages: ticketState.errorMessages,
                            fieldErrors: ticketState.fieldErrors,
                            hint: ticketState.hint,
                        }, null, 2);
                    }

                    const currentTicket = ticketState.ticket;

                    const parsedFields = parseJsonObjectInput(fieldsJson, 'fieldsJson');
                    if (parsedFields.error) return JSON.stringify({ success: false, error: parsedFields.error });

                    const parsedUpdate = parseJsonObjectInput(updateJson, 'updateJson');
                    if (parsedUpdate.error) return JSON.stringify({ success: false, error: parsedUpdate.error });

                    const transitionsUrl = `${buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, '/transitions')}?expand=transitions.fields`;
                    const transitionsResp = await fetch(transitionsUrl, {
                        method: 'GET',
                        headers: jiraConfig.headers,
                    });

                    if (!transitionsResp.ok) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `Failed to load transitions: HTTP ${transitionsResp.status}`,
                            details: await transitionsResp.text(),
                        }, null, 2);
                    }

                    const transitionsData = await transitionsResp.json();
                    const transitions = transitionsData.transitions || [];
                    const target = String(targetStatus || '').trim().toLowerCase();

                    let resolvedTransition = null;
                    if (isNonEmptyString(transitionId)) {
                        resolvedTransition = transitions.find(transition => String(transition.id) === String(transitionId).trim()) || null;
                    } else {
                        const toStatusMatches = transitions.filter(transition => String(transition.to?.name || '').trim().toLowerCase() === target);
                        const nameMatches = transitions.filter(transition => String(transition.name || '').trim().toLowerCase() === target);

                        if (toStatusMatches.length === 1) {
                            resolvedTransition = toStatusMatches[0];
                        } else if (nameMatches.length === 1) {
                            resolvedTransition = nameMatches[0];
                        } else if (toStatusMatches.length + nameMatches.length === 1) {
                            resolvedTransition = [...toStatusMatches, ...nameMatches][0];
                        } else if (toStatusMatches.length + nameMatches.length > 1) {
                            return JSON.stringify({
                                success: false,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl,
                                error: `Multiple transitions matched "${targetStatus}". Use transitionId instead.`,
                                matches: [...toStatusMatches, ...nameMatches].map(transition => ({
                                    id: transition.id,
                                    name: transition.name || '',
                                    toStatus: transition.to?.name || '',
                                })),
                            }, null, 2);
                        }
                    }

                    if (!resolvedTransition) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: `No Jira transition matched ${transitionId ? `ID ${transitionId}` : `status "${targetStatus}"`}.`,
                            availableTransitions: transitions.map(transition => ({
                                id: transition.id,
                                name: transition.name || '',
                                toStatus: transition.to?.name || '',
                            })),
                        }, null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('transition_jira_ticket', {
                            phase: 'jira', message: `Transitioning ${normalizedTicket.ticketId} to ${resolvedTransition.to?.name || resolvedTransition.name}...`, step: 2,
                        });
                    }

                    const transitionTargetStatus = resolvedTransition.to?.name || resolvedTransition.name || '';
                    const transitionChanges = [
                        createMutationFieldChange({
                            field: 'status',
                            label: 'Status',
                            before: currentTicket.status,
                            after: transitionTargetStatus,
                            includeUnchanged: true,
                        }),
                        createMutationFieldChange({
                            field: 'resolution',
                            label: 'Resolution',
                            before: '',
                            after: resolution || '',
                        }),
                    ].filter(Boolean);
                    const transitionNotes = [
                        resolvedTransition.name ? `Transition action: ${resolvedTransition.name}` : '',
                        isNonEmptyString(comment) ? 'Includes a transition comment.' : '',
                    ].filter(Boolean);
                    const transitionPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('transition_jira_ticket'),
                        title: `Approve transition for ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: currentTicket.summary,
                        }),
                        changes: transitionChanges,
                        notes: transitionNotes,
                        consequence: 'Jira will change workflow state and may trigger automation, notifications, and reporting changes.',
                    });
                    const transitionPreviewLines = buildJiraMutationPreviewLines([], transitionPreview);

                    const transitionApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'transition_jira_ticket',
                        ticketId: normalizedTicket.ticketId,
                        consequence: 'Jira will change workflow state and may trigger automation, notifications, and reporting changes.',
                        previewLines: transitionPreviewLines,
                        preview: transitionPreview,
                    });

                    if (!transitionApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: transitionApproval,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            previewLines: transitionPreviewLines,
                            preview: transitionPreview,
                        }), null, 2);
                    }

                    const payload = {
                        transition: { id: resolvedTransition.id },
                    };

                    const fields = parsedFields.value ? { ...parsedFields.value } : {};
                    if (resolution && !fields.resolution) {
                        fields.resolution = { name: resolution };
                    }
                    if (Object.keys(fields).length > 0) {
                        payload.fields = fields;
                    }

                    const update = parsedUpdate.value ? { ...parsedUpdate.value } : {};
                    if (comment) {
                        const existingComments = Array.isArray(update.comment) ? update.comment : [];
                        update.comment = [...existingComments, { add: { body: markdownToAdf(applyMentions(comment, mentions)) } }];
                    }
                    if (Object.keys(update).length > 0) {
                        payload.update = update;
                    }

                    const transitionResp = await fetch(buildJiraIssueApiUrl(jiraConfig, ticketId, '/transitions'), {
                        method: 'POST',
                        headers: jiraConfig.headers,
                        body: JSON.stringify(payload),
                    });

                    if (!transitionResp.ok) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            transition: {
                                id: resolvedTransition.id,
                                name: resolvedTransition.name || '',
                                toStatus: resolvedTransition.to?.name || '',
                                requiredFields: Object.entries(resolvedTransition.fields || {})
                                    .filter(([, fieldMeta]) => fieldMeta?.required)
                                    .map(([fieldId, fieldMeta]) => formatJiraFieldCapability(fieldId, fieldMeta)),
                            },
                            error: `Transition failed: HTTP ${transitionResp.status}`,
                            details: await transitionResp.text(),
                        }, null, 2);
                    }

                    const transitionReceipt = buildMutationReceipt({
                        guardrail: transitionApproval.guardrail,
                        title: `Transitioned ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: currentTicket.summary,
                        }),
                        changes: transitionChanges,
                        notes: transitionNotes,
                        outcome: `${normalizedTicket.ticketId} moved from ${currentTicket.status || 'its current state'} to ${transitionTargetStatus}.`,
                        approval: { approved: true, mode: transitionApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        ticketUrl,
                        transition: {
                            id: resolvedTransition.id,
                            name: resolvedTransition.name || '',
                            toStatus: resolvedTransition.to?.name || '',
                        },
                        updated: ['status-transition', ...(comment ? ['comment'] : []), ...(resolution ? ['resolution'] : [])],
                        receipt: transitionReceipt,
                        guardrail: buildMutationResultGuardrail(transitionApproval.guardrail, {
                            approved: true,
                            mode: transitionApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira transition error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b: attach_session_evidence_to_jira
    // Available to: buggenie
    // Attaches screenshots and video evidence from the current chat session to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('attach_session_evidence_to_jira', {
            description:
                'Attaches the active stored evidence from the current chat session to an existing Jira ticket. ' +
                'Uploads screenshots and the original video recording when it fits Jira limits. ' +
                'Use attach_video_frames_to_jira only when frame images are explicitly needed.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach evidence to (e.g., "AOTF-17300")',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve stored evidence from. Use the current session ID.',
                    },
                    frameTimestamps: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Optional: specific frame timestamps (in seconds) to attach from uploaded videos.',
                    },
                },
                required: ['ticketKey'],
            },
            handler: async ({ ticketKey, sessionId, frameTimestamps }) => {
                try {
                    loadEnvVars();
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    // ── Approval gate ──
                    const evidencePreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('attach_session_evidence_to_jira'),
                        title: `Approve evidence attachment to ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [createMutationFieldChange({
                            field: 'attachment',
                            label: 'Session evidence',
                            before: null,
                            after: 'Screenshots + video recordings from current session',
                        })].filter(Boolean),
                        consequence: 'Evidence files will be permanently attached to the Jira issue.',
                    });
                    const evidencePreviewLines = buildJiraMutationPreviewLines([], evidencePreview);
                    const evidenceApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'attach_session_evidence_to_jira',
                        ticketId: ticketKey,
                        consequence: 'Evidence files will be permanently attached to the Jira issue.',
                        previewLines: evidencePreviewLines,
                        preview: evidencePreview,
                    });
                    if (!evidenceApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: evidenceApproval,
                            ticketId: ticketKey,
                            previewLines: evidencePreviewLines,
                            preview: evidencePreview,
                        }), null, 2);
                    }

                    const uploadResult = await attachEvidenceToJira({
                        ticketKey,
                        jiraConfig,
                        entry: sessionResult.entry,
                        activeEvidenceMessageId: sessionResult.entry?.sessionContext?.activeEvidenceMessageId,
                        frameTimestamps,
                    });

                    if (!uploadResult.hasEvidence) {
                        return JSON.stringify({
                            success: false,
                            error: 'No screenshots or video evidence found in the current session.',
                        });
                    }

                    return JSON.stringify({
                        success: uploadResult.success,
                        ticketKey,
                        sessionId: sessionResult.sessionId,
                        ...uploadResult,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Attachment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b1: attach_session_images_to_jira
    // Available to: buggenie
    // Attaches images from the current chat session to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('attach_session_images_to_jira', {
            description:
                'Attaches screenshots from the active chat evidence scope to an existing Jira ticket. ' +
                'Use this to retry screenshot uploads when bug creation already happened.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach images to (e.g., "AOTF-17300")',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve stored attachments from. Use the current session ID.',
                    },
                },
                required: ['ticketKey'],
            },
            handler: async ({ ticketKey, sessionId }) => {
                try {
                    loadEnvVars();
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    // ── Approval gate ──
                    const imgPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('attach_session_images_to_jira'),
                        title: `Approve image attachment to ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [createMutationFieldChange({
                            field: 'attachment',
                            label: 'Session images',
                            before: null,
                            after: 'Screenshots from current session',
                        })].filter(Boolean),
                        consequence: 'Image files will be permanently attached to the Jira issue.',
                    });
                    const imgPreviewLines = buildJiraMutationPreviewLines([], imgPreview);
                    const imgApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'attach_session_images_to_jira',
                        ticketId: ticketKey,
                        consequence: 'Image files will be permanently attached to the Jira issue.',
                        previewLines: imgPreviewLines,
                        preview: imgPreview,
                    });
                    if (!imgApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: imgApproval,
                            ticketId: ticketKey,
                            previewLines: imgPreviewLines,
                            preview: imgPreview,
                        }), null, 2);
                    }

                    const uploadResult = await attachEvidenceToJira({
                        ticketKey,
                        jiraConfig,
                        entry: sessionResult.entry,
                        activeEvidenceMessageId: sessionResult.entry?.sessionContext?.activeEvidenceMessageId,
                        includeVideos: false,
                    });

                    if (uploadResult.totals.images === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'No images found in the current session. The user may not have attached any screenshots.',
                        });
                    }

                    return JSON.stringify({
                        success: uploadResult.success,
                        ticketKey,
                        sessionId: sessionResult.sessionId,
                        totalAttachments: uploadResult.totals.images,
                        uploaded: uploadResult.uploaded.images,
                        failed: uploadResult.failed.images,
                        results: uploadResult.imageResults,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Attachment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b2: analyze_video_recording
    // Available to: buggenie
    // Extracts frames from uploaded video and provides structured context
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('analyze_video_recording', {
            description:
                'Analyzes a screen recording video from the current chat session. ' +
                'Extracts key frames using ffmpeg, returns video metadata and frame information. ' +
                'The extracted frames are automatically attached as images for vision analysis. ' +
                'Call this when the user mentions they have uploaded a video/recording of a bug.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve video context from. Use the current session ID.',
                    },
                },
                required: [],
            },
            handler: async ({ sessionId }) => {
                try {
                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    const videoCtx = sessionResult.entry.videoContext;

                    if (!videoCtx || videoCtx.length === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'No video recordings found in the current session. The user may not have uploaded a video yet.',
                        });
                    }

                    // Return info for all videos in the session
                    const results = videoCtx.map(v => ({
                        filename: v.filename,
                        duration: `${v.duration}s`,
                        frameCount: v.frameCount,
                        resolution: v.metadata ? `${v.metadata.width}x${v.metadata.height}` : 'unknown',
                        codec: v.metadata?.codec || 'unknown',
                        frames: v.frames.map(f => ({
                            timestamp: `${f.timestamp}s`,
                            path: f.path,
                        })),
                    }));

                    return JSON.stringify({
                        success: true,
                        sessionId: sessionResult.sessionId,
                        videoCount: results.length,
                        videos: results,
                        instructions: 'The video frames are attached as images in chronological order. '
                            + 'Analyze them to identify: (1) the user flow/steps, (2) where the defect manifests, '
                            + '(3) expected vs actual behavior, (4) timestamps of key moments.',
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video analysis error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b3: attach_video_frames_to_jira
    // Available to: buggenie
    // Attaches key video frames to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'buggenie') {
        tools.push(defineTool('attach_video_frames_to_jira', {
            description:
                'Attaches key video frames from a screen recording to a Jira ticket. ' +
                'Uploads the most important frames (timestamps where bugs are visible) as JPEG images. ' +
                'Call this after creating a bug ticket when the user provided a video recording.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach frames to (e.g., "AOTF-17300")',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Chat session ID to retrieve video frames from.',
                    },
                    frameTimestamps: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Optional: specific frame timestamps (in seconds) to attach. If omitted, attaches up to 8 evenly-spaced frames.',
                    },
                },
                required: ['ticketKey'],
            },
            handler: async ({ ticketKey, sessionId, frameTimestamps }) => {
                try {
                    loadEnvVars();
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const sessionResult = getActiveSessionEntry(sessionId, deps);
                    if (sessionResult.error) {
                        return JSON.stringify({ success: false, error: sessionResult.error });
                    }

                    // ── Approval gate ──
                    const framesPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('attach_video_frames_to_jira'),
                        title: `Approve video frame attachment to ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [createMutationFieldChange({
                            field: 'attachment',
                            label: 'Video frames',
                            before: null,
                            after: Array.isArray(frameTimestamps) && frameTimestamps.length > 0
                                ? `${frameTimestamps.length} frame(s) at timestamps ${frameTimestamps.join(', ')}s`
                                : 'Key frames from video recording',
                        })].filter(Boolean),
                        consequence: 'Video frame images will be permanently attached to the Jira issue.',
                    });
                    const framesPreviewLines = buildJiraMutationPreviewLines([], framesPreview);
                    const framesApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'attach_video_frames_to_jira',
                        ticketId: ticketKey,
                        consequence: 'Video frame images will be permanently attached to the Jira issue.',
                        previewLines: framesPreviewLines,
                        preview: framesPreview,
                    });
                    if (!framesApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: framesApproval,
                            ticketId: ticketKey,
                            previewLines: framesPreviewLines,
                            preview: framesPreview,
                        }), null, 2);
                    }

                    const uploadResult = await attachEvidenceToJira({
                        ticketKey,
                        jiraConfig,
                        entry: sessionResult.entry,
                        activeEvidenceMessageId: sessionResult.entry?.sessionContext?.activeEvidenceMessageId,
                        frameTimestamps,
                        includeImages: false,
                        includeFrames: true,
                        includeVideos: false,
                    });

                    if (uploadResult.totals.videos === 0) {
                        return JSON.stringify({ success: false, error: 'No video recordings found in session' });
                    }

                    return JSON.stringify({
                        success: uploadResult.success,
                        ticketKey,
                        sessionId: sessionResult.sessionId,
                        totalFrames: uploadResult.totals.frames,
                        uploaded: uploadResult.uploaded.frames,
                        failed: uploadResult.failed.frames,
                        results: uploadResult.frameResults,
                        videoRecordings: uploadResult.videoRecordings.length > 0 ? uploadResult.videoRecordings : undefined,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video frame attachment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b4: attach_file_to_jira
    // Available to: testgenie, buggenie, taskgenie, orchestrator
    // Attaches any local file (e.g., .xlsx, .pdf, .json) to a Jira ticket
    // ───────────────────────────────────────────────────────────────────
    if (['testgenie', 'buggenie', 'taskgenie', 'orchestrator'].includes(agentName)) {
        tools.push(defineTool('attach_file_to_jira', {
            description:
                'Attaches a local file from the workspace to an existing Jira ticket. ' +
                'Supports any file type including .xlsx, .pdf, .json, .txt, .png, .csv, etc. ' +
                'Use this to upload generated test case Excel files, reports, or other artifacts to Jira tickets.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key to attach the file to (e.g., "AOTF-17300")',
                    },
                    filePath: {
                        type: 'string',
                        description: 'Absolute or workspace-relative path to the file to upload (e.g., "agentic-workflow/test-cases/AOTF-12345-test-cases.xlsx")',
                    },
                    fileName: {
                        type: 'string',
                        description: 'Optional: override the file name used in Jira. Defaults to the original file name.',
                    },
                },
                required: ['ticketKey', 'filePath'],
            },
            handler: async ({ ticketKey, filePath: rawFilePath, fileName }) => {
                try {
                    loadEnvVars();
                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-17300.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    // Resolve file path — support absolute and workspace-relative paths
                    let resolvedPath = rawFilePath;
                    if (!path.isAbsolute(resolvedPath)) {
                        const workspaceRoot = path.resolve(__dirname, '..', '..');
                        resolvedPath = path.resolve(workspaceRoot, resolvedPath);
                    }

                    if (!fs.existsSync(resolvedPath)) {
                        return JSON.stringify({ success: false, error: `File not found: ${rawFilePath}` });
                    }

                    const stat = fs.statSync(resolvedPath);
                    if (!stat.isFile()) {
                        return JSON.stringify({ success: false, error: `Path is not a file: ${rawFilePath}` });
                    }

                    // Jira attachment size limit: 50 MB
                    const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
                    if (stat.size > MAX_ATTACHMENT_SIZE) {
                        return JSON.stringify({
                            success: false,
                            error: `File exceeds Jira 50 MB attachment limit (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`,
                        });
                    }

                    const actualFileName = fileName || path.basename(resolvedPath);
                    const ext = path.extname(actualFileName).toLowerCase();

                    // MIME type mapping for common file types
                    const MIME_MAP = {
                        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        '.xls': 'application/vnd.ms-excel',
                        '.pdf': 'application/pdf',
                        '.json': 'application/json',
                        '.csv': 'text/csv',
                        '.txt': 'text/plain',
                        '.md': 'text/markdown',
                        '.html': 'text/html',
                        '.xml': 'application/xml',
                        '.zip': 'application/zip',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.webp': 'image/webp',
                        '.svg': 'image/svg+xml',
                        '.log': 'text/plain',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    };
                    const mimeType = MIME_MAP[ext] || 'application/octet-stream';

                    // ── Approval gate ──
                    const filePreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('attach_file_to_jira'),
                        title: `Approve file attachment to ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [createMutationFieldChange({
                            field: 'attachment',
                            label: 'File attachment',
                            before: null,
                            after: `${actualFileName} (${(stat.size / 1024).toFixed(1)} KB)`,
                        })].filter(Boolean),
                        notes: [`MIME type: ${mimeType}`],
                        consequence: 'File will be permanently attached to the Jira issue.',
                    });
                    const filePreviewLines = buildJiraMutationPreviewLines([], filePreview);
                    const fileApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'attach_file_to_jira',
                        ticketId: ticketKey,
                        consequence: 'File will be permanently attached to the Jira issue.',
                        previewLines: filePreviewLines,
                        preview: filePreview,
                    });
                    if (!fileApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: fileApproval,
                            ticketId: ticketKey,
                            previewLines: filePreviewLines,
                            preview: filePreview,
                        }), null, 2);
                    }

                    const buffer = fs.readFileSync(resolvedPath);

                    if (deps.chatManager) {
                        deps.chatManager.broadcastToolProgress('attach_file_to_jira', {
                            phase: 'uploading',
                            detail: `Uploading ${actualFileName} (${(stat.size / 1024).toFixed(1)} KB) to ${ticketKey}…`,
                        });
                    }

                    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);
                    const result = await uploadJiraAttachment(
                        attachUrl,
                        jiraConfig,
                        actualFileName,
                        mimeType,
                        buffer,
                        'JiraFileAttach'
                    );

                    if (deps.chatManager) {
                        deps.chatManager.broadcastToolProgress('attach_file_to_jira', {
                            phase: result.success ? 'complete' : 'failed',
                            detail: result.success
                                ? `✅ ${actualFileName} attached to ${ticketKey}`
                                : `❌ Upload failed: ${result.error}`,
                        });
                    }

                    return JSON.stringify({
                        success: result.success,
                        ticketKey,
                        fileName: actualFileName,
                        fileSize: stat.size,
                        mimeType,
                        error: result.error || undefined,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `File attachment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b5a: add_comment_with_media
    // Available to: buggenie, testgenie, taskgenie
    // Uploads images and videos as Jira attachments, renders images/preview
    // frames inline, and lists recording names inside the same comment.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('add_comment_with_media', {
            description:
                'Adds a Jira comment with mixed media in one flow. ' +
                'Uploads screenshots, preview frames, and video recordings as issue attachments, ' +
                'renders screenshots and preview frames inline in the comment, and lists video recording names ' +
                'in a dedicated Video evidence section. Jira Cloud does not support inline video playback ' +
                'for this REST workflow, so recordings are attached to the issue and named in the comment instead. ' +
                'Supports local file paths and the current chat session evidence.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key (for example "AOTF-16369").',
                    },
                    comment: {
                        type: 'string',
                        description: 'Markdown text for the comment body. Inline images and preview frames are appended below this text.',
                    },
                    imagePaths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional absolute or workspace-relative image paths to upload into the comment (.png, .jpg, .jpeg, .gif, .webp, .svg).',
                    },
                    videoPaths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional absolute or workspace-relative video paths to upload into the comment (.mp4, .webm, .mov, .avi, .mkv).',
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Optional chat session ID to pull stored screenshots and recordings from. Defaults to the active chat session.',
                    },
                    messageId: {
                        type: 'string',
                        description: 'Optional evidence message ID to scope session media to a specific uploaded prompt.',
                    },
                    latestOnly: {
                        type: 'boolean',
                        description: 'Optional: when true, use only the latest evidence-bearing session message instead of the active evidence scope.',
                    },
                    includeVideoFrames: {
                        type: 'boolean',
                        description: 'Optional: include extracted or stored video preview frames inline in the comment. Defaults to true.',
                    },
                    frameTimestamps: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Optional: preferred frame timestamps in seconds for inline video previews.',
                    },
                    maxVideoFrames: {
                        type: 'number',
                        description: 'Optional maximum number of inline preview frames to add. Defaults to 4.',
                    },
                    imageLayout: {
                        type: 'string',
                        description: 'Optional ADF layout for inline images: "center" (default), "wrap-left", "wrap-right", "wide", "full-width".',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL override.',
                    },
                },
                required: ['ticketKey', 'comment'],
            },
            handler: async ({ ticketKey, comment, imagePaths, videoPaths, sessionId, messageId, latestOnly, includeVideoFrames, frameTimestamps, maxVideoFrames, imageLayout, jiraBaseUrl }) => {
                try {
                    loadEnvVars();

                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-16369.' });
                    }

                    const explicitImages = Array.isArray(imagePaths) ? imagePaths.filter(isNonEmptyString) : [];
                    const explicitVideos = Array.isArray(videoPaths) ? videoPaths.filter(isNonEmptyString) : [];
                    const wantsSessionEvidence = explicitImages.length === 0 && explicitVideos.length === 0
                        ? true
                        : isNonEmptyString(sessionId) || isNonEmptyString(messageId) || latestOnly === true;

                    let sessionResult = null;
                    if (wantsSessionEvidence) {
                        const resolvedSession = getActiveSessionEntry(sessionId, deps);
                        if (!resolvedSession.error) {
                            sessionResult = resolvedSession;
                        } else if (explicitImages.length === 0 && explicitVideos.length === 0) {
                            return JSON.stringify({ success: false, error: resolvedSession.error });
                        }
                    }

                    const jiraConfig = getJiraAttachmentConfig({ baseUrl: jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }
                    const apiConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (apiConfig.error) {
                        return JSON.stringify({ success: false, error: apiConfig.error });
                    }

                    // ── Approval gate ──
                    const mediaCount = explicitImages.length + explicitVideos.length + (sessionResult ? 1 : 0);
                    const commentSnippet = isNonEmptyString(comment) && comment.length > 120
                        ? comment.slice(0, 120).trim() + '…'
                        : (comment || '').trim();
                    const mediaPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('add_comment_with_media'),
                        title: `Approve media comment on ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [
                            createMutationFieldChange({
                                field: 'comment',
                                label: 'Comment body',
                                before: null,
                                after: commentSnippet || '(empty)',
                            }),
                            createMutationFieldChange({
                                field: 'attachment',
                                label: 'Media attachments',
                                before: null,
                                after: [
                                    explicitImages.length > 0 ? `${explicitImages.length} image(s)` : '',
                                    explicitVideos.length > 0 ? `${explicitVideos.length} video(s)` : '',
                                    sessionResult ? 'Session evidence' : '',
                                ].filter(Boolean).join(', ') || 'Session evidence',
                            }),
                        ].filter(Boolean),
                        consequence: 'A comment with media will be permanently added to the Jira issue.',
                    });
                    const mediaPreviewLines = buildJiraMutationPreviewLines([], mediaPreview);
                    const mediaApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'add_comment_with_media',
                        ticketId: ticketKey,
                        consequence: 'A comment with media will be permanently added to the Jira issue.',
                        previewLines: mediaPreviewLines,
                        preview: mediaPreview,
                    });
                    if (!mediaApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: mediaApproval,
                            ticketId: ticketKey,
                            previewLines: mediaPreviewLines,
                            preview: mediaPreview,
                        }), null, 2);
                    }

                    const result = await addCommentWithMediaToJira({
                        ticketKey,
                        comment,
                        jiraConfig,
                        apiConfig,
                        imagePaths: explicitImages,
                        videoPaths: explicitVideos,
                        entry: sessionResult?.entry,
                        messageId,
                        activeEvidenceMessageId: sessionResult?.entry?.sessionContext?.activeEvidenceMessageId,
                        latestOnly: latestOnly === true,
                        includeVideoFrames: includeVideoFrames !== false,
                        frameTimestamps,
                        maxVideoFrames: Math.max(1, Math.min(Number(maxVideoFrames) || 4, 8)),
                        imageLayout,
                        toolName: 'add_comment_with_media',
                        deps,
                    });

                    return JSON.stringify({
                        success: result.success,
                        ticketKey,
                        ticketUrl: buildJiraBrowseUrl(apiConfig, ticketKey),
                        sessionId: sessionResult?.sessionId || undefined,
                        ...result,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Jira mixed-media comment error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11b5: add_comment_with_images
    // Available to: buggenie, testgenie, taskgenie
    // Uploads image files as ticket attachments AND creates a comment
    // with those images rendered inline via ADF mediaSingle nodes.
    // This is the Jira-native approach: same mechanism the Jira UI uses
    // when you paste/drag images into a comment.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('add_comment_with_images', {
            description:
                'Adds a comment to a Jira ticket with inline images. ' +
                'Uploads image files as ticket attachments, then creates a comment with the images ' +
                'embedded inline using ADF mediaSingle nodes — the same mechanism the Jira UI uses. ' +
                'The comment body (markdown) appears above the embedded images. ' +
                'Use this instead of separate attach_file_to_jira + update_jira_ticket calls when ' +
                'you need images to appear INSIDE the comment body, not just as ticket-level attachments.',
            parameters: {
                type: 'object',
                properties: {
                    ticketKey: {
                        type: 'string',
                        description: 'Jira ticket key (e.g., "AOTF-16369")',
                    },
                    comment: {
                        type: 'string',
                        description: 'Markdown text for the comment body. Images will be appended below this text.',
                    },
                    filePaths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of absolute or workspace-relative paths to image files to embed in the comment (.png, .jpg, .jpeg, .gif, .webp, .svg).',
                    },
                    imageLayout: {
                        type: 'string',
                        description: 'Optional ADF layout for images: "center" (default), "wrap-left", "wrap-right", "wide", "full-width".',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL override.',
                    },
                },
                required: ['ticketKey', 'comment', 'filePaths'],
            },
            handler: async ({ ticketKey, comment, filePaths, imageLayout, jiraBaseUrl }) => {
                try {
                    loadEnvVars();

                    if (!isValidTicketKey(ticketKey)) {
                        return JSON.stringify({ success: false, error: 'Invalid ticket key format. Expected values like AOTF-16369.' });
                    }
                    if (!isNonEmptyString(comment)) {
                        return JSON.stringify({ success: false, error: 'Comment text is required.' });
                    }
                    if (!Array.isArray(filePaths) || filePaths.length === 0) {
                        return JSON.stringify({ success: false, error: 'At least one file path is required in filePaths array.' });
                    }

                    const jiraConfig = getJiraAttachmentConfig();
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }
                    const apiConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (apiConfig.error) {
                        return JSON.stringify({ success: false, error: apiConfig.error });
                    }

                    const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
                    const IMAGE_MIME_MAP = {
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.webp': 'image/webp',
                        '.svg': 'image/svg+xml',
                    };
                    const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
                    const workspaceRoot = path.resolve(__dirname, '..', '..');
                    const layout = imageLayout || 'center';

                    // ── Step 1: Validate and resolve all file paths ──
                    const resolvedFiles = [];
                    for (const rawPath of filePaths) {
                        let resolved = rawPath;
                        if (!path.isAbsolute(resolved)) {
                            resolved = path.resolve(workspaceRoot, resolved);
                        }
                        if (!fs.existsSync(resolved)) {
                            return JSON.stringify({ success: false, error: `File not found: ${rawPath}` });
                        }
                        const stat = fs.statSync(resolved);
                        if (!stat.isFile()) {
                            return JSON.stringify({ success: false, error: `Path is not a file: ${rawPath}` });
                        }
                        if (stat.size > MAX_ATTACHMENT_SIZE) {
                            return JSON.stringify({ success: false, error: `File exceeds 50 MB limit: ${rawPath} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)` });
                        }
                        const ext = path.extname(resolved).toLowerCase();
                        if (!IMAGE_EXTENSIONS.has(ext)) {
                            return JSON.stringify({ success: false, error: `Unsupported image format: ${ext}. Supported: ${[...IMAGE_EXTENSIONS].join(', ')}` });
                        }
                        resolvedFiles.push({
                            resolved,
                            fileName: path.basename(resolved),
                            mimeType: IMAGE_MIME_MAP[ext] || 'application/octet-stream',
                            size: stat.size,
                        });
                    }

                    // ── Approval gate ──
                    const commentImgSnippet = isNonEmptyString(comment) && comment.length > 120
                        ? comment.slice(0, 120).trim() + '…'
                        : (comment || '').trim();
                    const commentImgPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('add_comment_with_images'),
                        title: `Approve comment with inline images on ${ticketKey}`,
                        subject: buildJiraMutationSubject({ ticketId: ticketKey }),
                        changes: [
                            createMutationFieldChange({
                                field: 'comment',
                                label: 'Comment body',
                                before: null,
                                after: commentImgSnippet || '(empty)',
                            }),
                            createMutationFieldChange({
                                field: 'attachment',
                                label: 'Inline images',
                                before: null,
                                after: `${resolvedFiles.length} image(s): ${resolvedFiles.map(f => f.fileName).join(', ')}`,
                            }),
                        ].filter(Boolean),
                        consequence: 'Images will be uploaded and a comment with inline images will be permanently added to the Jira issue.',
                    });
                    const commentImgPreviewLines = buildJiraMutationPreviewLines([], commentImgPreview);
                    const commentImgApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'add_comment_with_images',
                        ticketId: ticketKey,
                        consequence: 'Images will be uploaded and a comment with inline images will be permanently added to the Jira issue.',
                        previewLines: commentImgPreviewLines,
                        preview: commentImgPreview,
                    });
                    if (!commentImgApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: commentImgApproval,
                            ticketId: ticketKey,
                            previewLines: commentImgPreviewLines,
                            preview: commentImgPreview,
                        }), null, 2);
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('add_comment_with_images', {
                            phase: 'uploading',
                            detail: `Uploading ${resolvedFiles.length} image(s) to ${ticketKey}…`,
                        });
                    }

                    // ── Step 2: Upload each image as a ticket attachment ──
                    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);
                    const uploadedAttachments = [];
                    const failedUploads = [];

                    for (const file of resolvedFiles) {
                        const buffer = fs.readFileSync(file.resolved);
                        const result = await uploadJiraAttachment(
                            attachUrl, jiraConfig, file.fileName, file.mimeType, buffer, 'CommentImg'
                        );
                        if (result.success && result.attachmentMeta) {
                            uploadedAttachments.push({
                                id: String(result.attachmentMeta.id || ''),
                                filename: result.attachmentMeta.filename || file.fileName,
                                mimeType: result.attachmentMeta.mimeType || file.mimeType,
                                size: result.attachmentMeta.size || file.size,
                                contentUrl: result.attachmentMeta.content || '',
                            });
                        } else if (result.success) {
                            // Upload succeeded but no metadata — can't embed inline
                            failedUploads.push({ fileName: file.fileName, error: 'Upload succeeded but Jira did not return attachment metadata for inline embedding.' });
                        } else {
                            failedUploads.push({ fileName: file.fileName, error: result.error });
                        }
                    }

                    if (uploadedAttachments.length === 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'All image uploads failed. Cannot create comment with inline images.',
                            failedUploads,
                        });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('add_comment_with_images', {
                            phase: 'commenting',
                            detail: `Creating comment on ${ticketKey} with ${uploadedAttachments.length} inline image(s)…`,
                        });
                    }

                    // ── Step 3: Post comment with inline images (multi-strategy) ──
                    //
                    // WHY THIS APPROACH:
                    // Jira Cloud ADF mediaSingle nodes require a Media Services UUID
                    // (not the numeric attachment ID) and a valid collection name.
                    // The REST API v3 attachment upload returns numeric IDs, and the
                    // Media Services token exchange needed for proper UUIDs requires
                    // Forge/Connect app scopes not available to basic API token auth.
                    //
                    // SOLUTION: Use the REST API v2 endpoint with wiki markup notation.
                    // In Jira wiki markup, `!filename.png!` renders inline images by
                    // resolving the filename against the issue's attachment list.
                    // Jira's server-side wiki→ADF converter handles all the Media
                    // Services plumbing natively — exactly what the Jira UI does.
                    //
                    // Strategy A: REST API v2 + wiki markup (primary — most reliable)
                    // Strategy B: REST API v3 + ADF mediaSingle with mediaApiFileId
                    // Strategy C: REST API v3 + ADF text-link fallback
                    //
                    let commentResult = { success: false };

                    // ── Strategy A: REST API v2 + wiki markup with !filename.png! ──
                    // This is the breakthrough: Jira v2 accepts wiki notation as a plain
                    // string in the `body` field. When Jira encounters `!filename.png!`,
                    // it resolves the filename against the issue's attachments and renders
                    // the image inline — the same mechanism the Jira web UI uses.
                    try {
                        // Build v2 API URL (swap /rest/api/3 → /rest/api/2)
                        const v2Base = apiConfig.cloudId
                            ? `https://api.atlassian.com/ex/jira/${apiConfig.cloudId}/rest/api/2`
                            : `${(apiConfig.baseUrl || '').replace(/\/+$/, '')}/rest/api/2`;
                        const v2CommentUrl = `${v2Base}/issue/${ticketKey}/comment`;

                        // Convert markdown comment to wiki markup + append image references
                        const wikiComment = markdownToWikiMarkup(comment);
                        const imageRefs = uploadedAttachments
                            .map(att => `!${att.filename}|thumbnail!`)
                            .join('\n');
                        const wikiBody = wikiComment + '\n\n' + imageRefs;

                        const v2Resp = await fetch(v2CommentUrl, {
                            method: 'POST',
                            headers: apiConfig.headers,
                            body: JSON.stringify({ body: wikiBody }),
                        });

                        if (v2Resp.ok) {
                            let data = null;
                            try { data = await v2Resp.json(); } catch (_) { /* best-effort */ }
                            commentResult = {
                                success: true,
                                commentId: data?.id || null,
                                strategy: 'v2-wiki-markup',
                            };
                        }
                    } catch (_v2Err) {
                        // Non-fatal: fall through to ADF strategies
                    }

                    // ── Strategy B: REST API v3 + ADF mediaSingle with mediaApiFileId ──
                    // If v2 wiki markup fails, try v3 ADF with resolved Media Services UUIDs.
                    if (!commentResult.success) {
                        try {
                            // Resolve mediaApiFileId UUIDs from the issue's attachment list
                            const issueAttUrl = buildJiraIssueApiUrl(apiConfig, ticketKey, '?fields=attachment');
                            const issueAttResp = await fetch(issueAttUrl, {
                                method: 'GET',
                                headers: apiConfig.headers,
                            });
                            if (issueAttResp.ok) {
                                const issueData = await issueAttResp.json();
                                const jiraAttachments = issueData?.fields?.attachment || [];
                                for (const att of uploadedAttachments) {
                                    const match = jiraAttachments.find(a => String(a.id) === String(att.id));
                                    if (match?.mediaApiFileId) {
                                        att.mediaFileId = match.mediaApiFileId;
                                    }
                                }
                            }
                        } catch (_) { /* non-fatal */ }

                        const hasMediaFileIds = uploadedAttachments.some(a => a.mediaFileId);
                        if (hasMediaFileIds) {
                            const commentUrl = buildJiraIssueApiUrl(apiConfig, ticketKey, '/comment');
                            const adf = markdownToAdf(comment);
                            for (const att of uploadedAttachments) {
                                const mediaId = att.mediaFileId || att.id;
                                adf.content.push({
                                    type: 'mediaSingle',
                                    attrs: { layout },
                                    content: [{
                                        type: 'media',
                                        attrs: {
                                            id: mediaId,
                                            type: 'file',
                                            collection: '',
                                        },
                                    }],
                                });
                            }
                            const resp = await fetch(commentUrl, {
                                method: 'POST',
                                headers: apiConfig.headers,
                                body: JSON.stringify({ body: adf }),
                            });
                            if (resp.ok) {
                                let data = null;
                                try { data = await resp.json(); } catch (_) { /* best-effort */ }
                                commentResult = {
                                    success: true,
                                    commentId: data?.id || null,
                                    strategy: 'v3-adf-mediaFileId',
                                };
                            }
                        }
                    }

                    // ── Strategy C: REST API v3 + ADF text-link fallback ──
                    // Last resort — always works. Comment text + bullet list linking each image.
                    if (!commentResult.success) {
                        const commentUrl = buildJiraIssueApiUrl(apiConfig, ticketKey, '/comment');
                        const fallbackAdf = markdownToAdf(comment);
                        fallbackAdf.content.push({
                            type: 'paragraph',
                            content: [{ type: 'text', text: '📎 Attached images:', marks: [{ type: 'strong' }] }],
                        });

                        const attachmentListItems = uploadedAttachments.map(att => ({
                            type: 'listItem',
                            content: [{
                                type: 'paragraph',
                                content: att.contentUrl
                                    ? [{ type: 'text', text: att.filename, marks: [{ type: 'link', attrs: { href: att.contentUrl } }] }]
                                    : [{ type: 'text', text: `${att.filename} (attachment #${att.id})` }],
                            }],
                        }));

                        fallbackAdf.content.push({
                            type: 'bulletList',
                            content: attachmentListItems,
                        });

                        const resp = await fetch(commentUrl, {
                            method: 'POST',
                            headers: apiConfig.headers,
                            body: JSON.stringify({ body: fallbackAdf }),
                        });

                        if (resp.ok) {
                            let data = null;
                            try { data = await resp.json(); } catch (_) { /* best-effort */ }
                            commentResult = {
                                success: true,
                                commentId: data?.id || null,
                                strategy: 'v3-adf-text-links',
                                note: 'Inline media embedding was not available — images are attached to the ticket and linked in the comment.',
                            };
                        } else {
                            const errText = await resp.text();
                            commentResult = {
                                success: false,
                                error: `Comment creation failed (all strategies exhausted). Last error: HTTP ${resp.status}: ${errText.slice(0, 300)}`,
                            };
                        }
                    }

                    const ticketUrl = buildJiraBrowseUrl(apiConfig, ticketKey);

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('add_comment_with_images', {
                            phase: commentResult.success ? 'complete' : 'failed',
                            detail: commentResult.success
                                ? `✅ Comment with ${uploadedAttachments.length} image(s) added to ${ticketKey}`
                                : `❌ ${commentResult.error}`,
                        });
                    }

                    return JSON.stringify({
                        success: commentResult.success,
                        ticketKey,
                        ticketUrl,
                        commentId: commentResult.commentId || undefined,
                        strategy: commentResult.strategy || undefined,
                        imagesUploaded: uploadedAttachments.length,
                        imagesFailed: failedUploads.length,
                        uploadedAttachments: uploadedAttachments.map(a => ({
                            id: a.id,
                            filename: a.filename,
                            mediaFileId: a.mediaFileId || undefined,
                        })),
                        failedUploads: failedUploads.length > 0 ? failedUploads : undefined,
                        note: commentResult.note || undefined,
                        error: commentResult.error || undefined,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Comment with images error: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11c: update_jira_ticket
    // Available to: buggenie, testgenie, taskgenie
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('update_jira_ticket', {
            description:
                'Updates an existing Jira ticket via the Atlassian REST API. ' +
                'Can update summary, description, labels, priority, fix versions, or add comments. ' +
                'Use this when the user asks to edit, update, or modify an existing Jira ticket.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to update (e.g., "AOTF-17250")',
                    },
                    summary: {
                        type: 'string',
                        description: 'New summary/title for the ticket (optional \u2014 only if changing title)',
                    },
                    description: {
                        type: 'string',
                        description: 'New description for the ticket in markdown format (optional). Supports bold, tables, headings, lists, and inline code \u2014 automatically converted to Jira ADF. Do not combine bold and inline code on the same text span.',
                    },
                    comment: {
                        type: 'string',
                        description: 'Add a comment to the ticket (optional). Supports markdown formatting.',
                    },
                    priority: {
                        type: 'string',
                        description: 'New priority: Highest, High, Medium, Low, Lowest (optional)',
                    },
                    labels: {
                        type: 'string',
                        description: 'Comma-separated labels to SET on the ticket (replaces existing labels). Optional.',
                    },
                    addLabels: {
                        type: 'string',
                        description: 'Comma-separated labels to ADD to existing labels (without removing current ones). Optional.',
                    },
                    fixVersions: {
                        type: 'string',
                        description: 'Comma-separated version names to SET as Fix Version/s on the ticket (replaces all existing fix versions). Use version names exactly as they appear in Jira (e.g., "v1.2.0" or "Sprint 42"). Optional.',
                    },
                    addFixVersions: {
                        type: 'string',
                        description: 'Comma-separated version names to ADD to existing Fix Version/s (without removing current ones). Optional.',
                    },
                    removeFixVersions: {
                        type: 'string',
                        description: 'Comma-separated version names to REMOVE from existing Fix Version/s. Optional.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Jira base URL extracted from user-provided ticket URLs. Overrides JIRA_BASE_URL env var for the returned ticket URL.',
                    },
                    mentions: {
                        type: 'string',
                        description: 'Optional JSON array of users to @mention in the description or comment. Each entry: {"accountId":"...","displayName":"..."}. Use search_jira_users to resolve names first. Mention nodes trigger Jira notifications.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, summary, description, comment, priority, labels, addLabels, fixVersions, addFixVersions, removeFixVersions, jiraBaseUrl, mentions }) => {
                try {
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedTicket = normalizeJiraTicketInput(ticketId, latestUserMessage);
                    if (!normalizedTicket.ticketId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve ticketId into a Jira ticket key.',
                            hint: 'Pass a Jira key like AOTF-17250 or a full Jira browse URL.',
                        });
                    }

                    if (deps?.chatManager?.shouldBlockMasterWriteAfterDelegation) {
                        const delegationGuard = deps.chatManager.shouldBlockMasterWriteAfterDelegation(
                            deps.sessionContext || null,
                            'update_jira_ticket',
                            { ticketId: normalizedTicket.ticketId, comment }
                        );
                        if (delegationGuard?.blocked) {
                            return JSON.stringify({
                                success: false,
                                error: delegationGuard.message,
                                blockedBy: 'delegated_specialist_write_guard',
                            });
                        }
                    }

                    // Broadcast progress: starting
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('update_jira_ticket', {
                            phase: 'jira', message: `Updating ticket ${normalizedTicket.ticketId}...`, step: 1,
                        });
                    }
                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl: jiraBaseUrl || normalizedTicket.jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({
                            success: false,
                            error: jiraConfig.error,
                        });
                    }

                    const ticketUrl = buildJiraBrowseUrl(jiraConfig, normalizedTicket.ticketId);
                    const ticketState = await fetchJiraTicketState(jiraConfig, normalizedTicket.ticketId, ['summary', 'description', 'priority', 'labels', 'fixVersions']);
                    if (!ticketState.success) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            error: ticketState.error,
                            details: ticketState.details,
                            errorMessages: ticketState.errorMessages,
                            fieldErrors: ticketState.fieldErrors,
                            hint: ticketState.hint,
                        }, null, 2);
                    }

                    const currentTicket = ticketState.ticket;

                    const results = { updated: [], errors: [], errorMessages: [], fieldErrors: {}, hint: '' };
                    const replacementLabels = labels ? normalizeJiraLabelList(labels) : currentTicket.labels;
                    const additionalLabels = addLabels ? normalizeJiraLabelList(addLabels) : [];
                    const finalLabels = Array.from(new Set([...(Array.isArray(replacementLabels) ? replacementLabels : []), ...additionalLabels]));

                    // ── Fix Versions computation ──
                    const currentFixVersionNames = (currentTicket.fixVersions || []).map(v => v.name);
                    let finalFixVersionNames = currentFixVersionNames;
                    const hasFixVersionChange = Boolean(fixVersions || addFixVersions || removeFixVersions);
                    if (fixVersions) {
                        // SET mode: replace all existing fix versions
                        finalFixVersionNames = fixVersions.split(',').map(v => v.trim()).filter(Boolean);
                    } else {
                        if (addFixVersions) {
                            const toAdd = addFixVersions.split(',').map(v => v.trim()).filter(Boolean);
                            finalFixVersionNames = Array.from(new Set([...finalFixVersionNames, ...toAdd]));
                        }
                        if (removeFixVersions) {
                            const toRemove = new Set(removeFixVersions.split(',').map(v => v.trim().toLowerCase()));
                            finalFixVersionNames = finalFixVersionNames.filter(name => !toRemove.has(name.toLowerCase()));
                        }
                    }

                    const fieldChanges = [
                        createMutationFieldChange({ field: 'summary', label: 'Summary', before: currentTicket.summary, after: summary || currentTicket.summary }),
                        createMutationFieldChange({ field: 'description', label: 'Description', before: currentTicket.description, after: description || currentTicket.description }),
                        createMutationFieldChange({ field: 'priority', label: 'Priority', before: currentTicket.priority, after: priority || currentTicket.priority }),
                        (labels || addLabels) ? createMutationFieldChange({ field: 'labels', label: 'Labels', before: currentTicket.labels, after: finalLabels }) : null,
                        hasFixVersionChange ? createMutationFieldChange({ field: 'fixVersions', label: 'Fix Version/s', before: currentFixVersionNames, after: finalFixVersionNames }) : null,
                        comment ? createMutationFieldChange({ field: 'comment', label: 'New comment', before: null, after: comment }) : null,
                    ].filter(Boolean);
                    const updateNotes = [
                        addLabels ? `Adds labels: ${additionalLabels.join(', ')}` : '',
                        addFixVersions ? `Adds fix versions: ${addFixVersions}` : '',
                        removeFixVersions ? `Removes fix versions: ${removeFixVersions}` : '',
                        comment ? `Adds comment: "${String(comment).slice(0, 280)}${String(comment).length > 280 ? '…' : ''}"` : '',
                    ].filter(Boolean);

                    // ── Update issue fields (summary, description, priority, labels, fixVersions) ──
                    const fieldsUpdate = {};
                    if (summary) fieldsUpdate.summary = summary;
                    if (description) fieldsUpdate.description = markdownToAdf(applyMentions(description, mentions));
                    if (priority) fieldsUpdate.priority = { name: priority };
                    if (labels) fieldsUpdate.labels = labels.split(',').map(l => l.trim());
                    if (fixVersions) fieldsUpdate.fixVersions = finalFixVersionNames.map(name => ({ name }));

                    // A Jira mutation requires approval whenever ANY write is requested — not
                    // just direct field overwrites. Comments, incremental label additions, and
                    // fix-version add/remove are all permanent writes to Jira and MUST go through
                    // the approval gate. (Previously only `fieldsUpdate` was considered, so a
                    // comment-only / addLabels-only / fixVersion-add-only update silently
                    // bypassed the Approve/Cancel prompt.)
                    const needsApproval = Object.keys(fieldsUpdate).length > 0
                        || Boolean(comment)
                        || Boolean(addLabels)
                        || Boolean(addFixVersions)
                        || Boolean(removeFixVersions);
                    let updateApproval = {
                        approved: true,
                        guardrail: buildJiraMutationGuardrailMetadata('update_jira_ticket', {
                            impactLevel: needsApproval ? 'high' : 'medium',
                            requiresApproval: needsApproval,
                        }),
                        mode: 'not-required',
                    };

                    // Accurate, non-alarming consequence: only say "overwrite fields"
                    // when actual field overwrites are requested. A comment/label/
                    // fix-version-only update does NOT overwrite existing fields.
                    const hasFieldOverwrites = Object.keys(fieldsUpdate).length > 0;
                    const updateConsequence = hasFieldOverwrites
                        ? 'Jira will overwrite existing ticket fields and may notify watchers or trigger automation.'
                        : (comment && !addLabels && !addFixVersions && !removeFixVersions
                            ? 'Jira will add a new comment to the ticket and may notify watchers.'
                            : 'Jira will apply the listed additions to the ticket and may notify watchers or trigger automation.');

                    if (needsApproval) {
                        const updatePreview = buildMutationPreview({
                            guardrail: updateApproval.guardrail,
                            title: `Approve update for ${normalizedTicket.ticketId}`,
                            subject: buildJiraMutationSubject({
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl,
                                summary: currentTicket.summary,
                            }),
                            changes: fieldChanges,
                            notes: updateNotes,
                            consequence: updateConsequence,
                        });
                        const updatePreviewLines = buildJiraMutationPreviewLines([], updatePreview);

                        updateApproval = await requireJiraMutationApproval({
                            deps,
                            toolName: 'update_jira_ticket',
                            ticketId: normalizedTicket.ticketId,
                            consequence: updateConsequence,
                            previewLines: updatePreviewLines,
                            preview: updatePreview,
                        });

                        if (!updateApproval.approved) {
                            return JSON.stringify(buildJiraMutationApprovalFailure({
                                approval: updateApproval,
                                ticketId: normalizedTicket.ticketId,
                                ticketUrl,
                                previewLines: updatePreviewLines,
                                preview: updatePreview,
                            }), null, 2);
                        }
                    }

                    if (Object.keys(fieldsUpdate).length > 0) {
                        const updateUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId);
                        const updateResp = await fetch(updateUrl, {
                            method: 'PUT',
                            headers: jiraConfig.headers,
                            body: JSON.stringify({ fields: fieldsUpdate }),
                        });
                        if (!updateResp.ok) {
                            const errBody = await updateResp.text();
                            const formattedError = formatJiraErrorResponse('Field update failed', updateResp.status, errBody, {
                                includesDescription: Boolean(description),
                            });
                            results.errors.push(formattedError.message);
                            results.errorMessages.push(...(formattedError.errorMessages || []));
                            Object.assign(results.fieldErrors, formattedError.fieldErrors || {});
                            if (!results.hint) results.hint = formattedError.hint;
                        } else {
                            results.updated.push('fields');
                        }
                    }

                    // \u2500\u2500 Add labels without removing existing ones \u2500\u2500
                    if (addLabels) {
                        const addUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId);
                        const addResp = await fetch(addUrl, {
                            method: 'PUT',
                            headers: jiraConfig.headers,
                            body: JSON.stringify({
                                update: {
                                    labels: addLabels.split(',').map(l => ({ add: l.trim() })),
                                },
                            }),
                        });
                        if (!addResp.ok) {
                            const errBody = await addResp.text();
                            const formattedError = formatJiraErrorResponse('Add labels failed', addResp.status, errBody);
                            results.errors.push(formattedError.message);
                            results.errorMessages.push(...(formattedError.errorMessages || []));
                            Object.assign(results.fieldErrors, formattedError.fieldErrors || {});
                            if (!results.hint) results.hint = formattedError.hint;
                        } else {
                            results.updated.push('labels-added');
                        }
                    }

                    // ── Add/Remove fix versions without replacing ──
                    if ((addFixVersions || removeFixVersions) && !fixVersions) {
                        const fixVersionOps = [];
                        if (addFixVersions) {
                            addFixVersions.split(',').map(v => v.trim()).filter(Boolean).forEach(name => {
                                fixVersionOps.push({ add: { name } });
                            });
                        }
                        if (removeFixVersions) {
                            removeFixVersions.split(',').map(v => v.trim()).filter(Boolean).forEach(name => {
                                fixVersionOps.push({ remove: { name } });
                            });
                        }
                        if (fixVersionOps.length > 0) {
                            const fvUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId);
                            const fvResp = await fetch(fvUrl, {
                                method: 'PUT',
                                headers: jiraConfig.headers,
                                body: JSON.stringify({
                                    update: { fixVersions: fixVersionOps },
                                }),
                            });
                            if (!fvResp.ok) {
                                const errBody = await fvResp.text();
                                const formattedError = formatJiraErrorResponse('Fix versions update failed', fvResp.status, errBody);
                                results.errors.push(formattedError.message);
                                results.errorMessages.push(...(formattedError.errorMessages || []));
                                Object.assign(results.fieldErrors, formattedError.fieldErrors || {});
                                if (!results.hint) results.hint = formattedError.hint;
                            } else {
                                results.updated.push('fixVersions-updated');
                            }
                        }
                    }

                    // \u2500\u2500 Add comment \u2500\u2500
                    if (comment) {
                        const commentUrl = buildJiraIssueApiUrl(jiraConfig, normalizedTicket.ticketId, '/comment');
                        const commentResp = await fetch(commentUrl, {
                            method: 'POST',
                            headers: jiraConfig.headers,
                            body: JSON.stringify({ body: markdownToAdf(applyMentions(comment, mentions)) }),
                        });
                        if (!commentResp.ok) {
                            const errBody = await commentResp.text();
                            const formattedError = formatJiraErrorResponse('Comment failed', commentResp.status, errBody, {
                                includesDescription: true,
                            });
                            results.errors.push(formattedError.message);
                            results.errorMessages.push(...(formattedError.errorMessages || []));
                            Object.assign(results.fieldErrors, formattedError.fieldErrors || {});
                            if (!results.hint) results.hint = formattedError.hint;
                        } else {
                            results.updated.push('comment');
                        }
                    }

                    if (results.errors.length > 0 && results.updated.length === 0) {
                        return JSON.stringify({
                            success: false,
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            errors: results.errors,
                            errorMessages: results.errorMessages.length > 0 ? results.errorMessages : undefined,
                            fieldErrors: Object.keys(results.fieldErrors).length > 0 ? results.fieldErrors : undefined,
                            hint: results.hint || 'Verify JIRA_EMAIL and JIRA_API_TOKEN have write permissions for this ticket',
                        }, null, 2);
                    }

                    const appliedChanges = [
                        results.updated.includes('fields') ? fieldChanges.filter(change => ['summary', 'description', 'priority'].includes(change.field) || (change.field === 'labels' && Boolean(labels)) || (change.field === 'fixVersions' && Boolean(fixVersions))) : [],
                        results.updated.includes('labels-added') ? fieldChanges.filter(change => change.field === 'labels') : [],
                        results.updated.includes('fixVersions-updated') ? fieldChanges.filter(change => change.field === 'fixVersions') : [],
                    ].flat();
                    const dedupedChanges = appliedChanges.filter((change, index, changes) => changes.findIndex(candidate => candidate.field === change.field) === index);
                    const receiptNotes = [
                        ...updateNotes,
                        results.errors.length > 0 ? `Partial completion: ${results.errors.join(' | ')}` : '',
                    ].filter(Boolean);
                    const updateReceipt = buildMutationReceipt({
                        guardrail: updateApproval.guardrail,
                        title: `Updated ${normalizedTicket.ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId: normalizedTicket.ticketId,
                            ticketUrl,
                            summary: summary || currentTicket.summary,
                        }),
                        changes: dedupedChanges,
                        notes: receiptNotes,
                        outcome: results.errors.length > 0
                            ? `${normalizedTicket.ticketId} was updated with partial errors.`
                            : `${normalizedTicket.ticketId} was updated successfully.`,
                        approval: { approved: true, mode: updateApproval.mode },
                    });

                    return JSON.stringify({
                        success: true,
                        ticketId: normalizedTicket.ticketId,
                        ticketUrl,
                        updated: results.updated,
                        errors: results.errors.length > 0 ? results.errors : undefined,
                        receipt: updateReceipt,
                        guardrail: buildMutationResultGuardrail(updateApproval.guardrail, {
                            approved: true,
                            mode: updateApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira update error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11c2: get_jira_project_versions
    // Available to: buggenie, testgenie, taskgenie
    // Lists all versions (Fix Versions) for a Jira project.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('get_jira_project_versions', {
            description:
                'Lists all versions (Fix Version/s) available in a Jira project. ' +
                'Use this to discover valid version names before setting fixVersions on a ticket via update_jira_ticket. ' +
                'Returns version name, id, released status, and release date.',
            parameters: {
                type: 'object',
                properties: {
                    projectKey: {
                        type: 'string',
                        description: 'Jira project key (e.g., "AOTF"). Defaults to JIRA_PROJECT_KEY env var.',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL override.',
                    },
                },
                required: [],
            },
            handler: async ({ projectKey, jiraBaseUrl }) => {
                try {
                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const resolvedProject = projectKey || process.env.JIRA_PROJECT_KEY || 'AOTF';
                    const versionsUrl = `${jiraConfig.apiBase}/project/${resolvedProject}/versions`;
                    const resp = await fetch(versionsUrl, {
                        method: 'GET',
                        headers: jiraConfig.headers,
                    });

                    if (!resp.ok) {
                        const errBody = await resp.text();
                        return JSON.stringify({
                            success: false,
                            error: `Failed to fetch versions for project ${resolvedProject}: HTTP ${resp.status}`,
                            details: errBody,
                        }, null, 2);
                    }

                    const data = await resp.json();
                    const versions = (Array.isArray(data) ? data : []).map(v => ({
                        id: v.id,
                        name: v.name,
                        description: v.description || '',
                        released: v.released || false,
                        archived: v.archived || false,
                        releaseDate: v.releaseDate || null,
                        startDate: v.startDate || null,
                    }));

                    return JSON.stringify({
                        success: true,
                        projectKey: resolvedProject,
                        totalVersions: versions.length,
                        versions,
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira versions fetch error: ${error.message}`,
                        hint: 'Check network connectivity and Jira credentials in agentic-workflow/.env',
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11d: log_jira_work
    // Available to: buggenie, testgenie, taskgenie
    // Adds a Jira worklog entry to an issue.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('log_jira_work', {
            description:
                'Logs time spent against a Jira ticket using the worklog API. ' +
                'Use this when the user wants to add hours, log work, or update Time Tracking on an existing ticket. ' +
                'In this workflow, generic Time Tracking requests map to worklogs, not estimates.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to log work against (for example "AOTF-17250")',
                    },
                    timeSpent: {
                        type: 'string',
                        description: 'Human-readable time spent string such as "30m", "2h", or "1d".',
                    },
                    timeSpentSeconds: {
                        type: 'number',
                        description: 'Alternative to timeSpent. Use seconds when the caller already has a numeric duration.',
                    },
                    started: {
                        type: 'string',
                        description: 'Optional worklog start timestamp. Defaults to the current UTC time if omitted.',
                    },
                    comment: {
                        type: 'string',
                        description: 'Optional worklog comment in markdown.',
                    },
                    adjustEstimate: {
                        type: 'string',
                        description: 'Optional Jira estimate adjustment mode such as "auto", "leave", "new", or "manual".',
                    },
                    newEstimate: {
                        type: 'string',
                        description: 'Optional new remaining estimate when adjustEstimate="new".',
                    },
                    reduceBy: {
                        type: 'string',
                        description: 'Optional estimate reduction amount when adjustEstimate="manual".',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for the returned browse link.',
                    },
                    mentions: {
                        type: 'string',
                        description: 'Optional JSON array of users to @mention in the worklog comment. Each entry: {"accountId":"...","displayName":"..."}. Use search_jira_users to resolve names first.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, timeSpent, timeSpentSeconds, started, comment, adjustEstimate, newEstimate, reduceBy, jiraBaseUrl, mentions }) => {
                try {
                    if (!isNonEmptyString(timeSpent) && !(typeof timeSpentSeconds === 'number' && timeSpentSeconds > 0)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide either timeSpent or timeSpentSeconds when logging Jira work.',
                        });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('log_jira_work', {
                            phase: 'jira', message: `Logging work for ${ticketId}...`, step: 1,
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const intentContext = getJiraTimeTrackingIntentContext(deps);
                    if (intentContext.intent === 'estimate') {
                        return JSON.stringify(buildJiraTimeIntentGuardResult({
                            mode: 'worklog-from-estimate',
                            ticketId,
                            jiraConfig,
                            intentContext,
                        }), null, 2);
                    }
                    if (intentContext.intent === 'mixed') {
                        return JSON.stringify(buildJiraTimeIntentGuardResult({
                            mode: 'mixed',
                            ticketId,
                            jiraConfig,
                            intentContext,
                        }), null, 2);
                    }

                    const query = new URLSearchParams();
                    if (adjustEstimate) query.set('adjustEstimate', adjustEstimate);
                    if (newEstimate) query.set('newEstimate', newEstimate);
                    if (reduceBy) query.set('reduceBy', reduceBy);

                    const payload = {
                        started: formatJiraDateTime(started),
                    };

                    if (isNonEmptyString(timeSpent)) payload.timeSpent = timeSpent.trim();
                    if (typeof timeSpentSeconds === 'number' && timeSpentSeconds > 0) payload.timeSpentSeconds = timeSpentSeconds;
                    if (comment) payload.comment = markdownToAdf(applyMentions(comment, mentions));

                    const worklogTicketUrl = buildJiraBrowseUrl(jiraConfig, ticketId);
                    const worklogDisplayTime = isNonEmptyString(timeSpent)
                        ? timeSpent.trim()
                        : (typeof timeSpentSeconds === 'number' && timeSpentSeconds > 0 ? `${timeSpentSeconds}s` : '(unspecified)');
                    const worklogChanges = [
                        createMutationFieldChange({
                            field: 'timeSpent',
                            label: 'Time logged',
                            changeType: 'add',
                            before: null,
                            after: worklogDisplayTime,
                            includeUnchanged: true,
                        }),
                        isNonEmptyString(comment)
                            ? createMutationFieldChange({
                                field: 'worklogComment',
                                label: 'Worklog comment',
                                changeType: 'add',
                                before: null,
                                after: comment.length > 240 ? `${comment.slice(0, 240)}…` : comment,
                                includeUnchanged: true,
                            })
                            : null,
                        isNonEmptyString(adjustEstimate)
                            ? createMutationFieldChange({
                                field: 'adjustEstimate',
                                label: 'Estimate adjustment',
                                changeType: 'replace',
                                before: '(Jira default)',
                                after: adjustEstimate,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const worklogPreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('log_jira_work'),
                        title: `Approve time log for ${ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId,
                            ticketUrl: worklogTicketUrl,
                        }),
                        changes: worklogChanges,
                        notes: [
                            `Start: ${payload.started}`,
                        ],
                        consequence: 'Jira will record the worklog entry and may adjust the remaining estimate based on adjustEstimate.',
                    });
                    const worklogPreviewLines = buildJiraMutationPreviewLines([], worklogPreview);

                    const worklogApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'log_jira_work',
                        ticketId,
                        consequence: 'Jira will record the worklog entry and may adjust the remaining estimate based on adjustEstimate.',
                        previewLines: worklogPreviewLines,
                        preview: worklogPreview,
                    });

                    if (!worklogApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: worklogApproval,
                            ticketId,
                            ticketUrl: worklogTicketUrl,
                            previewLines: worklogPreviewLines,
                            preview: worklogPreview,
                        }), null, 2);
                    }

                    const worklogUrl = `${buildJiraIssueApiUrl(jiraConfig, ticketId, '/worklog')}${query.toString() ? `?${query.toString()}` : ''}`;
                    const response = await fetch(worklogUrl, {
                        method: 'POST',
                        headers: jiraConfig.headers,
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok) {
                        const details = await response.text();
                        return JSON.stringify({
                            success: false,
                            ticketId,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                            error: `Worklog failed: HTTP ${response.status}`,
                            details,
                            hint: details.toLowerCase().includes('time tracking')
                                ? 'Jira time tracking may be disabled for this project or instance.'
                                : 'Verify the Jira user has Work on issues permission.',
                        }, null, 2);
                    }

                    const worklog = await response.json();
                    return JSON.stringify({
                        success: true,
                        ticketId,
                        ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                        worklog: {
                            id: worklog.id,
                            started: worklog.started || payload.started,
                            timeSpent: worklog.timeSpent || payload.timeSpent || '',
                            timeSpentSeconds: typeof worklog.timeSpentSeconds === 'number' ? worklog.timeSpentSeconds : payload.timeSpentSeconds || null,
                        },
                        guardrail: buildMutationResultGuardrail(worklogApproval.guardrail, {
                            approved: true,
                            mode: worklogApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira worklog error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 11e: update_jira_estimates
    // Available to: buggenie, testgenie, taskgenie
    // Updates Jira timetracking estimates for an existing ticket.
    // ───────────────────────────────────────────────────────────────────
    if (['buggenie', 'testgenie', 'taskgenie'].includes(agentName)) {
        tools.push(defineTool('update_jira_estimates', {
            description:
                'Updates Jira original and remaining estimates for an existing ticket. ' +
                'Use this only for explicit originalEstimate or remainingEstimate changes without modifying summary, labels, or comments. ' +
                'Do not use this for generic Time Tracking, add-hours, or worklog requests.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID to update estimates for (for example "AOTF-17250")',
                    },
                    originalEstimate: {
                        type: 'string',
                        description: 'Optional new original estimate (for example "2h" or "1d").',
                    },
                    remainingEstimate: {
                        type: 'string',
                        description: 'Optional new remaining estimate (for example "45m" or "3d").',
                    },
                    jiraBaseUrl: {
                        type: 'string',
                        description: 'Optional Jira base URL to use for the returned browse link.',
                    },
                },
                required: ['ticketId'],
            },
            handler: async ({ ticketId, originalEstimate, remainingEstimate, jiraBaseUrl }) => {
                try {
                    if (!isNonEmptyString(originalEstimate) && !isNonEmptyString(remainingEstimate)) {
                        return JSON.stringify({
                            success: false,
                            error: 'Provide originalEstimate and/or remainingEstimate to update Jira estimates.',
                        });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('update_jira_estimates', {
                            phase: 'jira', message: `Updating estimates for ${ticketId}...`, step: 1,
                        });
                    }

                    const jiraConfig = getJiraApiConfig({ jiraBaseUrl });
                    if (jiraConfig.error) {
                        return JSON.stringify({ success: false, error: jiraConfig.error });
                    }

                    const intentContext = getJiraTimeTrackingIntentContext(deps);
                    if (intentContext.intent === 'worklog') {
                        return JSON.stringify(buildJiraTimeIntentGuardResult({
                            mode: 'estimate-from-worklog',
                            ticketId,
                            jiraConfig,
                            intentContext,
                        }), null, 2);
                    }
                    if (intentContext.intent === 'mixed') {
                        return JSON.stringify(buildJiraTimeIntentGuardResult({
                            mode: 'mixed',
                            ticketId,
                            jiraConfig,
                            intentContext,
                        }), null, 2);
                    }

                    const edit = {};
                    if (originalEstimate) edit.originalEstimate = originalEstimate;
                    if (remainingEstimate) edit.remainingEstimate = remainingEstimate;

                    const estimateTicketUrl = buildJiraBrowseUrl(jiraConfig, ticketId);
                    const estimateChanges = [
                        isNonEmptyString(originalEstimate)
                            ? createMutationFieldChange({
                                field: 'originalEstimate',
                                label: 'Original estimate',
                                changeType: 'replace',
                                before: '(current value)',
                                after: originalEstimate,
                                includeUnchanged: true,
                            })
                            : null,
                        isNonEmptyString(remainingEstimate)
                            ? createMutationFieldChange({
                                field: 'remainingEstimate',
                                label: 'Remaining estimate',
                                changeType: 'replace',
                                before: '(current value)',
                                after: remainingEstimate,
                                includeUnchanged: true,
                            })
                            : null,
                    ].filter(Boolean);

                    const estimatePreview = buildMutationPreview({
                        guardrail: buildJiraMutationGuardrailMetadata('update_jira_estimates'),
                        title: `Approve estimate update for ${ticketId}`,
                        subject: buildJiraMutationSubject({
                            ticketId,
                            ticketUrl: estimateTicketUrl,
                        }),
                        changes: estimateChanges,
                        notes: [],
                        consequence: 'Jira time-tracking fields will be overwritten for this ticket and sprint burn-down reports will recalculate.',
                    });
                    const estimatePreviewLines = buildJiraMutationPreviewLines([], estimatePreview);

                    const estimateApproval = await requireJiraMutationApproval({
                        deps,
                        toolName: 'update_jira_estimates',
                        ticketId,
                        consequence: 'Jira time-tracking fields will be overwritten for this ticket and sprint burn-down reports will recalculate.',
                        previewLines: estimatePreviewLines,
                        preview: estimatePreview,
                    });

                    if (!estimateApproval.approved) {
                        return JSON.stringify(buildJiraMutationApprovalFailure({
                            approval: estimateApproval,
                            ticketId,
                            ticketUrl: estimateTicketUrl,
                            previewLines: estimatePreviewLines,
                            preview: estimatePreview,
                        }), null, 2);
                    }

                    const response = await fetch(buildJiraIssueApiUrl(jiraConfig, ticketId), {
                        method: 'PUT',
                        headers: jiraConfig.headers,
                        body: JSON.stringify({
                            update: {
                                timetracking: [{ edit }],
                            },
                        }),
                    });

                    if (!response.ok) {
                        return JSON.stringify({
                            success: false,
                            ticketId,
                            ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                            error: `Estimate update failed: HTTP ${response.status}`,
                            details: await response.text(),
                        }, null, 2);
                    }

                    return JSON.stringify({
                        success: true,
                        ticketId,
                        ticketUrl: buildJiraBrowseUrl(jiraConfig, ticketId),
                        updated: Object.keys(edit),
                        guardrail: buildMutationResultGuardrail(estimateApproval.guardrail, {
                            approved: true,
                            mode: estimateApproval.mode,
                        }),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: `Jira estimate update error: ${error.message}`,
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12: generate_test_case_excel
    // Available to: testgenie
    // ───────────────────────────────────────────────────────────────────
    if (['testgenie'].includes(agentName)) {
        tools.push(defineTool('generate_test_case_excel', {
            description:
                'Generates a test case Excel file from structured test case data. ' +
                'Takes ticket ID, test suite name, pre-conditions, and an array of test steps, ' +
                'then creates an .xlsx file in agentic-workflow/test-cases/.',
            parameters: {
                type: 'object',
                properties: {
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., "AOTF-16339")',
                    },
                    testSuiteName: {
                        type: 'string',
                        description: 'Name of the test suite (e.g., "Consumer - Travel Time Edit Dropdown")',
                    },
                    preConditions: {
                        type: 'string',
                        description: 'Pre-conditions text (e.g., "1: For Consumer: User is authenticated")',
                    },
                    testSteps: {
                        type: 'string',
                        description: 'JSON array string of test step objects with fields: stepId, action, expected, actual',
                    },
                },
                required: ['ticketId', 'testSuiteName', 'testSteps'],
            },
            handler: async ({ ticketId, testSuiteName, preConditions, testSteps }) => {
                try {
                    // Broadcast progress: parsing
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Parsing test case data for ${ticketId}...`, step: 1,
                        });
                    }
                    let steps;
                    try {
                        steps = JSON.parse(testSteps);
                    } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid testSteps JSON: ${e.message}` });
                    }

                    // Broadcast progress: generating
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_test_case_excel', {
                            phase: 'excel', message: `Generating Excel workbook (${steps.length} steps)...`, step: 2,
                        });
                    }

                    // Try using the excel-template-generator script
                    const generatorPath = path.join(__dirname, '..', 'scripts', 'excel-template-generator.js');
                    if (fs.existsSync(generatorPath)) {
                        try {
                            const generator = require(generatorPath);
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) {
                                fs.mkdirSync(outputDir, { recursive: true });
                            }

                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);

                            // The generator exports generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath)
                            // where jiraInfo = { number, title, url } and testCases = [{ id, title, steps: [...] }]
                            if (typeof generator.generateTestCaseExcel === 'function') {
                                // Build the jiraInfo shape the generator expects
                                const jiraInfo = {
                                    number: ticketId,
                                    title: testSuiteName,
                                    url: `${(process.env.JIRA_BASE_URL || 'https://jira.atlassian.net/').replace(/\/+$/, '')}/browse/${ticketId}`,
                                };

                                // Convert flat steps array into the testCases shape the generator expects
                                // Input steps: [{ stepId, action, expected, actual }]
                                // Generator expects: [{ id, title, steps: [{ id, action, expected, actual }] }]
                                const testCases = [{
                                    id: 'TC-01',
                                    title: testSuiteName,
                                    steps: steps.map(s => ({
                                        id: s.stepId || s.id || '',
                                        action: s.action || s.activity || '',
                                        expected: s.expected || s.expectedResult || '',
                                        actual: s.actual || s.actualResults || s.actualResult || '',
                                    })),
                                }];

                                await generator.generateTestCaseExcel(
                                    jiraInfo,
                                    preConditions || '',
                                    testCases,
                                    outputPath,
                                );
                            } else if (typeof generator.generateExcel === 'function') {
                                // Legacy fallback if export name changes back
                                await generator.generateExcel({
                                    ticketId,
                                    testSuiteName,
                                    preConditions: preConditions || '',
                                    testSteps: steps,
                                    outputPath,
                                });
                            } else {
                                // Generator module has unexpected export — create simple Excel via fallback
                                await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            }

                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel file created: ${path.basename(outputPath)}`,
                            });
                        } catch (genError) {
                            // Fall back to simple Excel creation
                            const outputDir = path.join(__dirname, '..', 'test-cases');
                            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                            const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                            await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);
                            return JSON.stringify({
                                success: true,
                                path: outputPath,
                                stepCount: steps.length,
                                message: `Excel created (fallback): ${path.basename(outputPath)}`,
                                warning: `Generator error: ${genError.message}`,
                            });
                        }
                    }

                    // No generator script — create simple CSV-style output
                    const outputDir = path.join(__dirname, '..', 'test-cases');
                    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                    const outputPath = path.join(outputDir, `${ticketId}-test-cases.xlsx`);
                    await createSimpleExcel(outputPath, ticketId, testSuiteName, preConditions, steps);

                    return JSON.stringify({
                        success: true,
                        path: outputPath,
                        stepCount: steps.length,
                        message: `Excel created: ${path.basename(outputPath)}`,
                    });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Excel generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12c: find_test_files
    // Available to: scriptgenerator, codereviewer
    // Recursively searches the workspace for test files/folders by name,
    // ticket ID, or keyword. Use BEFORE execute_test when the user gives
    // a partial name instead of a full path.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('find_test_files', {
            description:
                'Search the workspace for test spec files and folders by name, ticket ID, or keyword. ' +
                'Recursively scans tests/specs/, tests-scratch/specs/, and any configured spec directories. ' +
                'Use this BEFORE execute_test when the user provides a partial name (e.g., "planner", ' +
                '"AOTF-16337", "notes", "profile") instead of a full path. Returns matching file/folder paths.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search term — file name, folder name, ticket ID, or keyword (case-insensitive)',
                    },
                    type: {
                        type: 'string',
                        enum: ['file', 'folder', 'both'],
                        description: 'Filter results by type (default: "both")',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, type: filterType }) => {
                const projectRoot = path.join(__dirname, '..', '..');
                const searchType = filterType || 'both';
                const results = [];
                const normalizedQuery = String(query || '').trim().replace(/^['"]|['"]$/g, '');

                if (!normalizedQuery) {
                    return JSON.stringify({
                        success: false,
                        error: 'Query cannot be empty.',
                    }, null, 2);
                }

                // If user passed a direct absolute path, validate and return immediately.
                if (path.isAbsolute(normalizedQuery) && fs.existsSync(normalizedQuery)) {
                    try {
                        const stats = fs.statSync(normalizedQuery);
                        const relativePath = _relativePathIfInside(projectRoot, normalizedQuery);

                        if (stats.isDirectory() && (searchType === 'folder' || searchType === 'both')) {
                            const specFileCount = _countSpecFiles(normalizedQuery);
                            results.push({
                                name: path.basename(normalizedQuery),
                                path: normalizedQuery,
                                relativePath,
                                type: 'folder',
                                specFileCount,
                            });
                        } else if (stats.isFile() && (searchType === 'file' || searchType === 'both')) {
                            results.push({
                                name: path.basename(normalizedQuery),
                                path: normalizedQuery,
                                relativePath,
                                type: 'file',
                                size: stats.size,
                                modified: stats.mtime.toISOString(),
                                isSpec: normalizedQuery.endsWith('.spec.js'),
                            });
                        }

                        return JSON.stringify({
                            success: true,
                            query: normalizedQuery,
                            directPathMatch: true,
                            matchCount: results.length,
                            results,
                            searchedDirectories: [normalizedQuery],
                        }, null, 2);
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Could not inspect path: ${error.message}`,
                        }, null, 2);
                    }
                }

                // Directories to search
                const searchDirs = [
                    path.join(projectRoot, 'tests', 'specs'),
                    path.join(projectRoot, 'tests-scratch', 'specs'),
                ];

                // Also check workflow config for additional spec directories
                try {
                    const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
                    if (fs.existsSync(configPath)) {
                        const wfConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                        const specDir = wfConfig?.projectPaths?.specsDir;
                        if (specDir) {
                            const resolved = path.isAbsolute(specDir) ? specDir : path.join(projectRoot, specDir);
                            if (!searchDirs.includes(resolved)) searchDirs.push(resolved);
                        }
                    }
                } catch { /* ignore config read errors */ }

                const queryLower = normalizedQuery.toLowerCase();

                function scanDir(dir, depth = 0) {
                    if (depth > 5 || !fs.existsSync(dir)) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const entryPath = path.join(dir, entry.name);
                            const nameLower = entry.name.toLowerCase();
                            const matches = nameLower.includes(queryLower);

                            if (entry.isDirectory()) {
                                if (matches && (searchType === 'folder' || searchType === 'both')) {
                                    // Count .spec.js files inside matching folder
                                    const specFiles = _countSpecFiles(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'folder',
                                        specFileCount: specFiles,
                                    });
                                }
                                // Always recurse into subdirectories
                                scanDir(entryPath, depth + 1);
                            } else if (entry.isFile()) {
                                if (matches && (searchType === 'file' || searchType === 'both')) {
                                    const stats = fs.statSync(entryPath);
                                    results.push({
                                        name: entry.name,
                                        path: entryPath,
                                        relativePath: path.relative(projectRoot, entryPath).replace(/\\/g, '/'),
                                        type: 'file',
                                        size: stats.size,
                                        modified: stats.mtime.toISOString(),
                                        isSpec: entry.name.endsWith('.spec.js'),
                                    });
                                }
                            }
                        }
                    } catch { /* permission errors */ }
                }

                for (const dir of searchDirs) {
                    scanDir(dir);
                }

                return JSON.stringify({
                    success: true,
                    query: normalizedQuery,
                    matchCount: results.length,
                    results: results.slice(0, 50), // Cap at 50 results
                    searchedDirectories: searchDirs.map(d => path.relative(projectRoot, d).replace(/\\/g, '/')),
                }, null, 2);
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12b: execute_test
    // Available to: scriptgenerator, codereviewer
    // Runs test files using auto-detected framework (Playwright, WebDriverIO,
    // Cypress, Jest, Mocha, Vitest) and saves results for the Reports dashboard.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        tools.push(defineTool('execute_test', {
            description:
                'Execute test files using auto-detected framework and return structured results. ' +
                'Auto-detects the test framework (Playwright, WebDriverIO, Cypress, Jest, Mocha, Vitest) ' +
                'from config files and package.json, then runs the appropriate command. ' +
                'Saves raw results to test-artifacts/reports/ for the Reports dashboard. ' +
                'Returns a summary with pass/fail counts, failed test names, and error details. ' +
                'Supports workspace-relative paths, absolute paths, folders, and external project paths. ' +
                'For external paths, auto-detects the project root and framework.',
            parameters: {
                type: 'object',
                properties: {
                    specPath: {
                        type: 'string',
                        description: 'Path to a test file OR a folder containing test files (absolute or relative to workspace root). Can also be a keyword like "planner" or "notes" — auto-discovery will find it. Supports .spec.js, .test.js, .e2e.js, .cy.js, .spec.ts, .test.ts files.',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Jira ticket ID (e.g., AOTF-16461) for labeling the report. If omitted, derived from the folder name.',
                    },
                    framework: {
                        type: 'string',
                        description: 'Test framework to use. Default: "auto" (auto-detect from config files). Options: auto, playwright, webdriverio, cypress, jest, mocha, vitest.',
                    },
                },
                required: ['specPath'],
            },
            handler: async ({ specPath, ticketId, framework: frameworkHint }) => {
                const { runCommand } = require('./terminal-runner');
                const projectRoot = path.join(__dirname, '..', '..');
                const normalizedSpecPath = String(specPath || '').trim().replace(/^['"]|['"]$/g, '');

                if (!normalizedSpecPath) {
                    return JSON.stringify({
                        success: false,
                        error: 'specPath is required.',
                    });
                }

                // Broadcast progress: resolving spec
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('execute_test', {
                        phase: 'test', message: `Resolving test spec: ${normalizedSpecPath}...`, step: 1,
                    });
                }

                // Resolve spec path
                let resolvedSpec = path.isAbsolute(normalizedSpecPath)
                    ? normalizedSpecPath
                    : path.join(projectRoot, normalizedSpecPath);

                let isDirectory = false;
                let executionRoot = projectRoot;
                let externalExecution = false;

                // ── Auto-discovery: if not found, search by name ──
                if (!fs.existsSync(resolvedSpec)) {
                    const searchName = path.basename(normalizedSpecPath).toLowerCase();
                    const searchDirs = [
                        path.join(projectRoot, 'tests', 'specs'),
                        path.join(projectRoot, 'tests-scratch', 'specs'),
                    ];
                    const folderMatches = [];
                    const fileMatches = [];

                    function searchRecursive(dir, depth = 0) {
                        if (depth > 5 || !fs.existsSync(dir)) return;
                        try {
                            const entries = fs.readdirSync(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                const entryPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    if (entry.name.toLowerCase().includes(searchName)) {
                                        // Record the FOLDER itself — do NOT expand to individual files
                                        const specCount = _countSpecFiles(entryPath);
                                        if (specCount > 0) {
                                            folderMatches.push({ path: entryPath, specCount });
                                        }
                                    }
                                    searchRecursive(entryPath, depth + 1);
                                } else if (entry.isFile() && entry.name.toLowerCase().includes(searchName) && /\.(spec|test|e2e|cy)\.(js|ts|mjs|cjs)$/.test(entry.name)) {
                                    fileMatches.push(entryPath);
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    for (const dir of searchDirs) {
                        searchRecursive(dir);
                    }

                    // Prefer folder matches over individual file matches
                    if (folderMatches.length === 1) {
                        resolvedSpec = folderMatches[0].path;
                        isDirectory = true;
                    } else if (folderMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple folder matches found for "${normalizedSpecPath}". Please specify which one.`,
                            matches: folderMatches.map(m => ({
                                path: path.relative(projectRoot, m.path).replace(/\\/g, '/'),
                                specCount: m.specCount,
                            })),
                        });
                    } else if (fileMatches.length === 1) {
                        resolvedSpec = fileMatches[0];
                    } else if (fileMatches.length > 1) {
                        return JSON.stringify({
                            success: false,
                            error: `Multiple file matches found for "${normalizedSpecPath}". Please specify the exact file.`,
                            matches: fileMatches.map(m => path.relative(projectRoot, m).replace(/\\/g, '/')),
                        });
                    } else {
                        return JSON.stringify({
                            success: false,
                            error: `Spec file/folder not found: "${normalizedSpecPath}". No matches in tests/specs/ or tests-scratch/specs/.`,
                        });
                    }
                } else {
                    // Path exists — check if it's a directory
                    isDirectory = fs.statSync(resolvedSpec).isDirectory();
                }

                const workspaceRelativePath = _relativePathIfInside(projectRoot, resolvedSpec);
                if (!workspaceRelativePath) {
                    // Use universal findProjectRoot — detects ANY framework, not just Playwright
                    const { findProjectRoot } = require('./framework-detector');
                    const externalRoot = findProjectRoot(resolvedSpec);
                    if (externalRoot) {
                        executionRoot = externalRoot;
                        externalExecution = true;
                    } else {
                        // Fallback: remap to a workspace spec target when possible.
                        const workspaceMatch = _resolveWorkspaceSpecTarget(projectRoot, resolvedSpec, isDirectory);
                        if (workspaceMatch) {
                            resolvedSpec = workspaceMatch;
                            isDirectory = fs.statSync(resolvedSpec).isDirectory();
                            executionRoot = projectRoot;
                            externalExecution = false;
                        } else {
                            return JSON.stringify({
                                success: false,
                                error: `Spec path is outside this workspace and no project root was found: "${normalizedSpecPath}".`,
                                hint: 'Use a workspace path under tests/specs, or provide a path inside a project with package.json or a test framework config file.',
                            });
                        }
                    }
                }

                // If it's a directory, verify it has test files (any framework)
                if (isDirectory) {
                    const { countTestFiles } = require('./framework-detector');
                    const testFileCount = countTestFiles(resolvedSpec);
                    if (testFileCount === 0) {
                        return JSON.stringify({
                            success: false,
                            error: `Folder "${normalizedSpecPath}" exists but contains no test files (.spec.js, .test.js, .e2e.js, .cy.js, etc.).`,
                        });
                    }
                }

                // Derive ticketId from path if not provided
                let derivedTicketId;
                if (ticketId) {
                    derivedTicketId = ticketId;
                } else if (isDirectory) {
                    // For folders: use the folder name itself (e.g., "planner" → "PLANNER")
                    derivedTicketId = path.basename(resolvedSpec).toUpperCase();
                } else {
                    // For files: use the parent folder name (e.g., "aotf-16461/file.spec.js" → "AOTF-16461")
                    derivedTicketId = path.basename(path.dirname(resolvedSpec)).toUpperCase();
                }
                derivedTicketId = derivedTicketId || 'UNKNOWN';

                const runId = `chat_${derivedTicketId}_${Date.now()}`;

                try {
                    const relativePath = _relativePathIfInside(executionRoot, resolvedSpec);
                    if (!relativePath) {
                        return JSON.stringify({
                            success: false,
                            error: `Resolved spec path is not inside execution root: "${resolvedSpec}".`,
                        });
                    }

                    // For directories, pass directly; for files, framework-specific
                    // escaping is handled inside the command construction block below.

                    const scopeSuffix = externalExecution
                        ? ` (external root: ${path.basename(executionRoot)})`
                        : '';

                    // Broadcast progress: running
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test', message: isDirectory
                                ? `Running all specs in ${path.basename(resolvedSpec)}${scopeSuffix}...`
                                : `Running ${path.basename(resolvedSpec)}${scopeSuffix}...`,
                            step: 2,
                        });
                    }

                    let output;
                    let exitCode = 0;
                    let timedOut = false;
                    let aborted = false;
                    let lastProgressEmit = 0;

                    // ── Framework detection + command construction ──
                    const { detectFramework, buildRunCommand: buildFwCommand } = require('./framework-detector');
                    const { getParserForFramework, parseJsonResults } = require('./output-parser');

                    const fwHint = (frameworkHint || 'auto').toLowerCase().trim();
                    let detectedFramework = 'playwright'; // default for this workspace
                    let detection = null;

                    if (fwHint !== 'auto' && fwHint !== 'playwright') {
                        detectedFramework = fwHint;
                    } else if (externalExecution || fwHint === 'auto') {
                        detection = detectFramework(executionRoot);
                        if (detection.confidence !== 'low') {
                            detectedFramework = detection.framework;
                        }
                    }

                    const os = require('os');
                    const jsonOutputFile = path.join(
                        os.tmpdir(),
                        `test-json-${runId}.json`
                    );

                    // Get framework-appropriate output parser for streaming
                    const outputParser = getParserForFramework(detectedFramework);

                    let eventBridge = null;
                    let bridgeTypes = null;
                    try {
                        const bridgeModule = require('./event-bridge');
                        eventBridge = bridgeModule.getEventBridge();
                        bridgeTypes = bridgeModule.EVENT_TYPES;
                    } catch { /* EventBridge not available — chat broadcast only */ }

                    let testsSeen = 0;
                    let testsPassed = 0;
                    let testsFailed = 0;
                    let totalFromHeader = null;

                    const broadcastTestEvent = (evt) => {
                        if (evt.kind === 'header') {
                            totalFromHeader = evt.totalTests;
                            if (deps?.chatManager?.broadcastToolProgress) {
                                deps.chatManager.broadcastToolProgress('execute_test', {
                                    phase: 'test',
                                    message: `Starting ${evt.totalTests} test${evt.totalTests === 1 ? '' : 's'} (${evt.workerCount} worker${evt.workerCount === 1 ? '' : 's'})`,
                                    step: 2,
                                    totalTests: evt.totalTests,
                                });
                            }
                            if (eventBridge && bridgeTypes) {
                                eventBridge.push(bridgeTypes.TEST_PROGRESS, runId, {
                                    kind: 'start',
                                    totalTests: evt.totalTests,
                                    workerCount: evt.workerCount,
                                    ticketId: derivedTicketId,
                                });
                            }
                            return;
                        }
                        if (evt.kind === 'test') {
                            if (evt.status === 'passed') testsPassed++;
                            else if (evt.status === 'failed') testsFailed++;
                            if (evt.status !== 'running') testsSeen++;

                            // Chat progress — throttled and terse
                            if (deps?.chatManager?.broadcastToolProgress && evt.status !== 'running') {
                                const now = Date.now();
                                if (now - lastProgressEmit >= 500) {
                                    lastProgressEmit = now;
                                    const totalLabel = totalFromHeader ? `/${totalFromHeader}` : '';
                                    deps.chatManager.broadcastToolProgress('execute_test', {
                                        phase: 'test',
                                        message: `${testsSeen}${totalLabel} — ${testsPassed} passed, ${testsFailed} failed`,
                                        step: 2,
                                        testIndex: evt.index,
                                        testTitle: evt.title,
                                        testStatus: evt.status,
                                    });
                                }
                            }
                            if (eventBridge && bridgeTypes) {
                                eventBridge.push(bridgeTypes.TEST_RESULT, runId, {
                                    ticketId: derivedTicketId,
                                    index: evt.index,
                                    title: evt.title,
                                    project: evt.project,
                                    status: evt.status,
                                    durationText: evt.durationText,
                                    runningTotals: { seen: testsSeen, passed: testsPassed, failed: testsFailed },
                                });
                            }
                        }
                    };

                    const streamChunk = (chunk, stream) => {
                        if (!chunk) return;
                        // Feed into structured parser (emits per-test events)
                        if (stream === 'stdout') {
                            try {
                                const events = outputParser.feed(chunk);
                                for (const evt of events) broadcastTestEvent(evt);
                            } catch { /* parser must never break execution */ }
                        }

                        // Legacy throttled progress fallback — keeps stderr visible and
                        // covers any output the structured parser didn't match.
                        if (!deps?.chatManager?.broadcastToolProgress) return;
                        const now = Date.now();
                        if (now - lastProgressEmit < 1500) return;
                        // Only emit legacy progress for stderr (stdout handled above)
                        if (stream !== 'stderr') return;
                        lastProgressEmit = now;
                        const firstLine = String(chunk)
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .find((line) => line.length > 0);
                        if (!firstLine) return;
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine,
                            step: 2,
                            stream,
                        });
                    };

                    // ── Framework-aware command construction ──
                    // For Playwright (this workspace's primary framework), use the proven
                    // dual-reporter strategy. For other frameworks, use buildRunCommand.
                    let runCommandName, runCommandArgs, execStrategy;
                    const childEnv = {
                        ...process.env,
                        FORCE_COLOR: '0',
                        CI: process.env.CI || '1',
                    };

                    if (detectedFramework === 'playwright') {
                        const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                        const reporterArg = '--reporter=list,json';
                        const playwrightTarget = isDirectory
                            ? relativePath
                            : relativePath.replace(/[+.*?^${}()|[\]\\]/g, '\\$&');
                        const playwrightArgs = ['playwright', 'test', playwrightTarget, reporterArg];

                        runCommandName = npxCommand;
                        runCommandArgs = playwrightArgs;
                        execStrategy = 'npx';

                        const matchingScript = _findMatchingNpmScript(executionRoot, resolvedSpec, isDirectory);
                        const localPlaywright = _resolveLocalPlaywrightBinary(executionRoot);

                        if (matchingScript) {
                            const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                            runCommandName = npmCommand;
                            runCommandArgs = ['run', matchingScript.scriptName, '--', reporterArg];
                            execStrategy = `npm-script:${matchingScript.scriptName}`;
                        } else if (localPlaywright) {
                            runCommandName = localPlaywright.command;
                            runCommandArgs = ['test', playwrightTarget, reporterArg];
                            execStrategy = 'local-binary';
                        }

                        // Playwright-specific JSON output env vars
                        childEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonOutputFile;
                        childEnv.PLAYWRIGHT_JSON_OUTPUT_FILE = jsonOutputFile;
                    } else {
                        // Non-Playwright: use framework detector to build the right command
                        const fwCmd = buildFwCommand(
                            detection || { framework: detectedFramework, configFile: null, projectRoot: executionRoot, detectedScripts: [] },
                            relativePath,
                            { json: true, jsonOutputFile }
                        );
                        runCommandName = fwCmd.command;
                        runCommandArgs = fwCmd.args;
                        execStrategy = `${detectedFramework}:${fwCmd.strategy}`;
                        Object.assign(childEnv, fwCmd.env || {});
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: `Framework: ${detectedFramework} | Strategy: ${execStrategy}`,
                            step: 2,
                        });
                    }

                    try {
                        const result = await runCommand({
                            command: runCommandName,
                            args: runCommandArgs,
                            cwd: executionRoot,
                            timeoutMs: 300000,
                            abortSignal: deps?.abortSignal || null,
                            env: childEnv,
                            onStdout: (chunk) => streamChunk(chunk, 'stdout'),
                            onStderr: (chunk) => streamChunk(chunk, 'stderr'),
                        });
                        output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
                        exitCode = result.exitCode ?? 0;
                    } catch (execError) {
                        // Playwright exits non-zero on test failures — its stdout contains the JSON report.
                        output = [execError.stdout || '', execError.stderr || ''].filter(Boolean).join('\n');
                        exitCode = Number.isInteger(execError.exitCode) ? execError.exitCode : 1;
                        timedOut = execError.timedOut === true;
                        aborted = execError.aborted === true;

                        // Spawn-level failure (ENOENT, EACCES, etc.) — return structured diagnostics
                        // instead of an opaque "error with spawning the process" message so the agent
                        // can actually recover.
                        if (execError.code === 'SPAWN_ERROR' || execError.code === 'ENOENT') {
                            try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                            return JSON.stringify({
                                success: false,
                                error: `Failed to launch test runner (${execError.code}): ${execError.message}`,
                                diagnostics: {
                                    reason: 'SPAWN_FAILED',
                                    framework: detectedFramework,
                                    strategy: execStrategy,
                                    command: runCommandName,
                                    args: runCommandArgs,
                                    executionRoot,
                                    externalExecution,
                                    hasPackageJson: fs.existsSync(path.join(executionRoot, 'package.json')),
                                    hasNodeModules: fs.existsSync(path.join(executionRoot, 'node_modules')),
                                },
                                hint: !fs.existsSync(path.join(executionRoot, 'node_modules'))
                                    ? `The project at "${executionRoot}" has no node_modules. Run "npm install" there first.`
                                    : `The ${detectedFramework} runner could not be launched in "${executionRoot}". Verify the framework is installed (check node_modules/.bin/).`,
                                runId,
                            });
                        }

                        if (!output) {
                            output = execError.message || '';
                        }
                    }

                    if (aborted) {
                        try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                        return JSON.stringify({
                            success: false,
                            cancelled: true,
                            error: 'Test execution cancelled.',
                            runId,
                            executionRoot,
                            externalExecution,
                        });
                    }

                    if (timedOut && !output) {
                        try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                        return JSON.stringify({
                            success: false,
                            error: 'Test execution timed out after 300s with no output.',
                            runId,
                            executionRoot,
                            externalExecution,
                        });
                    }

                    // Flush any residual buffered line from the streaming parser
                    try {
                        const tailEvents = outputParser.flush();
                        for (const evt of tailEvents) broadcastTestEvent(evt);
                    } catch { /* parser tail flush is best-effort */ }

                    // Strip dotenv banner and other non-JSON preamble from stdout
                    const cleanedOutput = output.replace(/^\[dotenv[^\]]*\][^\n]*\n?/gm, '').trim();

                    // Parse JSON — prefer the tempfile (dual-reporter writes there), fall back
                    // to stdout parsing for backward compat / older Playwright versions.
                    const { extractJSON: parseJSON } = require('./utils');
                    let jsonResult = null;
                    let parseSource = null;

                    if (fs.existsSync(jsonOutputFile)) {
                        try {
                            const fileContent = fs.readFileSync(jsonOutputFile, 'utf-8');
                            if (fileContent && fileContent.trim().length > 0) {
                                jsonResult = JSON.parse(fileContent);
                                parseSource = 'file';
                            }
                        } catch { /* fall through to stdout parse */ }
                    }

                    if (!jsonResult) {
                        try {
                            jsonResult = parseJSON(cleanedOutput);
                            parseSource = 'stdout';
                        } catch {
                            // Could not parse JSON — for non-Playwright frameworks, use
                            // the streaming parser's aggregated results as fallback.
                            const streamResults = outputParser.getResults();
                            if (streamResults.total > 0 || detectedFramework !== 'playwright') {
                                _saveTestReport(derivedTicketId, runId, resolvedSpec, {
                                    rawOutput: output.substring(0, 50000),
                                    framework: detectedFramework,
                                    streamResults,
                                });
                                try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }

                                const effectiveFailedCount = streamResults.failed;
                                if (deps?.chatManager?.broadcastToolProgress) {
                                    deps.chatManager.broadcastToolProgress('execute_test', {
                                        phase: 'test',
                                        message: streamResults.total > 0
                                            ? `${streamResults.passed}/${streamResults.total} passed, ${streamResults.failed} failed`
                                            : `Exit code: ${exitCode}`,
                                        step: 3,
                                    });
                                }

                                return JSON.stringify({
                                    success: exitCode === 0 && streamResults.failed === 0,
                                    totalCount: streamResults.total,
                                    passedCount: streamResults.passed,
                                    failedCount: effectiveFailedCount,
                                    failedTests: streamResults.failedTests,
                                    runnerErrors: [],
                                    reportSaved: true,
                                    runId,
                                    isFolder: isDirectory,
                                    executionRoot,
                                    externalExecution,
                                    framework: detectedFramework,
                                    strategy: execStrategy,
                                    parseSource: 'stream',
                                    streamedCount: testsSeen,
                                    message: streamResults.total > 0
                                        ? `${streamResults.passed}/${streamResults.total} tests passed`
                                        : (exitCode === 0 ? 'Command succeeded (no structured results)' : `Command failed with exit code ${exitCode}`),
                                });
                            }

                            // No stream results and no JSON — save raw output as error
                            _saveTestReport(derivedTicketId, runId, resolvedSpec, {
                                rawError: output.substring(0, 50000),
                            });
                            try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }
                            return JSON.stringify({
                                success: false,
                                error: `Test output could not be parsed as JSON (framework: ${detectedFramework})`,
                                rawOutput: output.substring(0, 2000),
                                reportSaved: true,
                                runId,
                                executionRoot,
                                externalExecution,
                                framework: detectedFramework,
                            });
                        }
                    }

                    // Clean up the JSON tempfile — we've already read it
                    try { fs.existsSync(jsonOutputFile) && fs.unlinkSync(jsonOutputFile); } catch { /* ignore */ }

                    // Extract results using framework-aware parser
                    const { totalSpecs, passed, failed, failedTests, runnerErrors } = parseJsonResults(jsonResult, detectedFramework);

                    const syntheticFailures = totalSpecs === 0 ? runnerErrors.length : 0;
                    const effectiveFailedCount = failed + syntheticFailures;

                    // Save raw report for dashboard
                    _saveTestReport(derivedTicketId, runId, resolvedSpec, jsonResult);

                    // Broadcast progress: results
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('execute_test', {
                            phase: 'test',
                            message: totalSpecs > 0
                                ? `${passed}/${totalSpecs} passed, ${failed} failed`
                                : (runnerErrors[0] ? `No tests found: ${runnerErrors[0]}` : 'No tests found in output'),
                            step: 3,
                        });
                    }

                    return JSON.stringify({
                        success: failed === 0 && totalSpecs > 0,
                        totalCount: totalSpecs,
                        passedCount: passed,
                        failedCount: effectiveFailedCount,
                        failedTests,
                        runnerErrors,
                        reportSaved: true,
                        runId,
                        isFolder: isDirectory,
                        executionRoot,
                        externalExecution,
                        framework: detectedFramework,
                        strategy: execStrategy,
                        parseSource,
                        streamedCount: testsSeen,
                        message: totalSpecs > 0
                            ? `${passed}/${totalSpecs} tests passed`
                            : (runnerErrors[0] ? `No tests found: ${runnerErrors[0]}` : 'No tests found in output'),
                    });
                } catch (error) {
                    return JSON.stringify({
                        success: false,
                        error: error.message?.substring(0, 1000) || 'Unknown execute_test error',
                        diagnostics: {
                            reason: 'HANDLER_EXCEPTION',
                            errorName: error.name || null,
                            errorCode: error.code || null,
                            specPath: normalizedSpecPath,
                        },
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 12c: run_command — Universal Shell Command Runner
    // Available to: scriptgenerator, codereviewer
    // Runs ANY shell command in a specified directory. This is the
    // universal escape hatch for non-Playwright test runners, bash
    // scripts, Python, WebDriverIO, Selenium, custom CLIs, etc.
    // ───────────────────────────────────────────────────────────────────
    if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
        // Safety: blocked destructive command patterns
        const BLOCKED_COMMAND_PATTERNS = [
            /\brm\s+(-rf?|--recursive)\s+[/\\]/i,
            /\bformat\s+[A-Z]:/i,
            /\bdel\s+\/s\s+\/q\s+[A-Z]:/i,
            /\bmkfs\b/i,
            /\bdd\s+if=/i,
            /\bshutdown\b/i,
            /\breboot\b/i,
            /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,  // fork bomb
            /\bkill\s+-9\s+(-1|0)\b/,
            /\btaskkill\s+\/f\s+\/im\s+\*/i,
        ];
        const MAX_TIMEOUT_SECONDS = 600;
        const DEFAULT_TIMEOUT_SECONDS = 300;
        const MAX_OUTPUT_CHARS = 50 * 1024;

        tools.push(defineTool('run_command', {
            description:
                'Run any shell command in a specified directory and return stdout/stderr. ' +
                'Use this for non-Playwright test runners (WebDriverIO, Selenium, Cypress, Jest, Mocha), ' +
                'bash/shell scripts, Python scripts, npm/yarn commands, or any CLI tool. ' +
                'Supports absolute paths for working directory. Returns exit code, stdout, and stderr. ' +
                'For structured test results with pass/fail parsing, prefer execute_test instead.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The full command to run (e.g., "npx wdio run wdio.conf.js", "npm test", "python -m pytest", "bash ./run-tests.sh"). Will be split into command + args automatically.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'Working directory for the command. Absolute path required. Defaults to workspace root.',
                    },
                    timeoutSeconds: {
                        type: 'number',
                        description: `Max execution time in seconds. Default: ${DEFAULT_TIMEOUT_SECONDS}, Max: ${MAX_TIMEOUT_SECONDS}.`,
                    },
                    env: {
                        type: 'object',
                        description: 'Additional environment variables to merge with process.env. Keys are variable names, values are strings.',
                    },
                },
                required: ['command'],
            },
            handler: async ({ command, cwd, timeoutSeconds, env: extraEnv }) => {
                const { runCommand } = require('./terminal-runner');
                const projectRoot = path.join(__dirname, '..', '..');

                const rawCommand = String(command || '').trim();
                if (!rawCommand) {
                    return JSON.stringify({ success: false, error: 'command is required.' });
                }

                // Safety check: block destructive commands
                for (const pattern of BLOCKED_COMMAND_PATTERNS) {
                    if (pattern.test(rawCommand)) {
                        return JSON.stringify({
                            success: false,
                            error: `Command blocked for safety: matches destructive pattern "${pattern.source}".`,
                            blocked: true,
                        });
                    }
                }

                // Resolve working directory
                let resolvedCwd = projectRoot;
                if (cwd) {
                    const cwdStr = String(cwd).trim();
                    if (cwdStr) {
                        resolvedCwd = path.isAbsolute(cwdStr) ? cwdStr : path.join(projectRoot, cwdStr);
                    }
                }
                if (!fs.existsSync(resolvedCwd)) {
                    return JSON.stringify({
                        success: false,
                        error: `Working directory does not exist: "${resolvedCwd}".`,
                    });
                }
                try {
                    if (!fs.statSync(resolvedCwd).isDirectory()) {
                        return JSON.stringify({
                            success: false,
                            error: `Path is not a directory: "${resolvedCwd}".`,
                        });
                    }
                } catch (e) {
                    return JSON.stringify({
                        success: false,
                        error: `Cannot access working directory: "${resolvedCwd}" — ${e.message}`,
                    });
                }

                // Resolve timeout
                const timeout = Math.min(
                    Math.max(1, Number(timeoutSeconds) || DEFAULT_TIMEOUT_SECONDS),
                    MAX_TIMEOUT_SECONDS,
                );

                // Parse command string into command + args
                // Handles quoted strings and Windows .cmd extensions
                const parts = _shellSplit(rawCommand);
                const cmdName = parts[0];
                const cmdArgs = parts.slice(1);

                // On Windows, if the command is a common npm/npx/yarn/node tool, append .cmd
                let resolvedCmdName = cmdName;
                if (process.platform === 'win32') {
                    const CMD_TOOLS = ['npx', 'npm', 'yarn', 'pnpm', 'tsc', 'eslint', 'prettier', 'wdio', 'cypress', 'jest', 'mocha', 'vitest'];
                    if (CMD_TOOLS.includes(cmdName.toLowerCase()) && !cmdName.endsWith('.cmd')) {
                        resolvedCmdName = `${cmdName}.cmd`;
                    }
                }

                // Build environment
                const childEnv = {
                    ...process.env,
                    FORCE_COLOR: '0',
                    ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
                };

                // Broadcast progress
                if (deps?.chatManager?.broadcastToolProgress) {
                    deps.chatManager.broadcastToolProgress('run_command', {
                        phase: 'command',
                        message: `Running: ${rawCommand.length > 120 ? rawCommand.substring(0, 120) + '…' : rawCommand}`,
                        step: 1,
                        cwd: resolvedCwd,
                    });
                }

                let lastProgressEmit = 0;
                const streamProgress = (chunk, stream) => {
                    if (!deps?.chatManager?.broadcastToolProgress) return;
                    const now = Date.now();
                    if (now - lastProgressEmit < 2000) return;
                    lastProgressEmit = now;
                    const text = String(chunk || '').trim();
                    if (!text) return;
                    const snippet = text.split(/\r?\n/).find(l => l.trim()) || '';
                    deps.chatManager.broadcastToolProgress('run_command', {
                        phase: 'command',
                        message: snippet.length > 160 ? snippet.substring(0, 160) + '…' : snippet,
                        step: 2,
                        stream,
                    });
                };

                try {
                    const result = await runCommand({
                        command: resolvedCmdName,
                        args: cmdArgs,
                        cwd: resolvedCwd,
                        timeoutMs: timeout * 1000,
                        abortSignal: deps?.abortSignal || null,
                        env: childEnv,
                        onStdout: (chunk) => streamProgress(chunk, 'stdout'),
                        onStderr: (chunk) => streamProgress(chunk, 'stderr'),
                    });

                    const stdout = (result.stdout || '').substring(0, MAX_OUTPUT_CHARS);
                    const stderr = (result.stderr || '').substring(0, MAX_OUTPUT_CHARS);
                    const exitCode = result.exitCode ?? 0;

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('run_command', {
                            phase: 'command',
                            message: exitCode === 0 ? 'Command completed successfully' : `Command exited with code ${exitCode}`,
                            step: 3,
                        });
                    }

                    return JSON.stringify({
                        success: exitCode === 0,
                        exitCode,
                        stdout,
                        stderr,
                        timedOut: false,
                        durationMs: result.durationMs || null,
                        command: rawCommand,
                        cwd: resolvedCwd,
                    });
                } catch (execError) {
                    const stdout = (execError.stdout || '').substring(0, MAX_OUTPUT_CHARS);
                    const stderr = (execError.stderr || '').substring(0, MAX_OUTPUT_CHARS);
                    const exitCode = Number.isInteger(execError.exitCode) ? execError.exitCode : 1;
                    const timedOut = execError.timedOut === true;
                    const aborted = execError.aborted === true;

                    if (aborted) {
                        return JSON.stringify({
                            success: false,
                            exitCode,
                            stdout,
                            stderr,
                            timedOut: false,
                            cancelled: true,
                            durationMs: execError.durationMs || null,
                            command: rawCommand,
                            cwd: resolvedCwd,
                            error: 'Command cancelled.',
                        });
                    }

                    if (execError.code === 'SPAWN_ERROR' || execError.code === 'ENOENT') {
                        return JSON.stringify({
                            success: false,
                            exitCode,
                            stdout,
                            stderr,
                            timedOut,
                            durationMs: execError.durationMs || null,
                            command: rawCommand,
                            cwd: resolvedCwd,
                            error: `Failed to launch command: ${execError.message}`,
                            hint: execError.code === 'ENOENT'
                                ? `Command "${cmdName}" not found. Check spelling, or ensure it is installed and in PATH.`
                                : 'The command could not be started. Verify the executable exists.',
                        });
                    }

                    return JSON.stringify({
                        success: exitCode === 0,
                        exitCode,
                        stdout,
                        stderr,
                        timedOut,
                        durationMs: execError.durationMs || null,
                        command: rawCommand,
                        cwd: resolvedCwd,
                        ...(timedOut ? { error: `Command timed out after ${timeout}s.` } : {}),
                    });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOLS 13-16: Shared Context Store (Agent Collaboration)
    // Available to: ALL agents (when contextStore is provided)
    // ───────────────────────────────────────────────────────────────────
    if (contextStore) {
        // TOOL 13: write_shared_context
        tools.push(defineTool('write_shared_context', {
            description:
                'Write to the shared context store that persists across agent sessions. ' +
                'Use this to record decisions (with reasoning), constraints discovered, ' +
                'questions for other agents, or general observations. Later agents will ' +
                'see what you wrote and understand WHY you made your choices.',
            parameters: {
                type: 'object',
                properties: {
                    entryType: {
                        type: 'string',
                        description: 'Type: "decision" | "constraint" | "question" | "note"',
                    },
                    content: {
                        type: 'string',
                        description: 'The decision, constraint, question, or note text',
                    },
                    reasoning: {
                        type: 'string',
                        description: 'Why this decision was made (required for decisions)',
                    },
                    targetAgent: {
                        type: 'string',
                        description: 'For questions: which agent should answer (e.g., "testgenie", "scriptgenerator")',
                    },
                    impact: {
                        type: 'string',
                        description: 'For constraints: how this affects downstream agents',
                    },
                },
                required: ['entryType', 'content'],
            },
            handler: async ({ entryType, content, reasoning, targetAgent, impact }) => {
                try {
                    let result;
                    switch (entryType) {
                        case 'decision':
                            result = contextStore.recordDecision(agentName, content, reasoning || '');
                            break;
                        case 'constraint':
                            result = contextStore.recordConstraint(agentName, content, impact || '');
                            break;
                        case 'question':
                            const qId = contextStore.postQuestion(agentName, targetAgent || 'coordinator', content);
                            result = { questionId: qId, status: 'posted' };
                            break;
                        case 'note':
                            result = contextStore.addNote(agentName, content);
                            break;
                        default:
                            return JSON.stringify({ error: `Unknown entry type: ${entryType}` });
                    }
                    return JSON.stringify({ success: true, entryType, result });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 14: read_shared_context
        tools.push(defineTool('read_shared_context', {
            description:
                'Read from the shared context store to understand what previous agents decided, ' +
                'what constraints exist, what artifacts are available, and any pending questions. ' +
                'Use this BEFORE making decisions to understand the full picture.',
            parameters: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'string',
                        description: 'Filter by: "all" | "decisions" | "constraints" | "artifacts" | "questions" | "agent:{name}"',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max entries to return (default: 50)',
                    },
                },
            },
            handler: async ({ filter, limit }) => {
                try {
                    const maxItems = limit || 50;

                    if (filter === 'artifacts') {
                        return JSON.stringify(contextStore.getAllArtifacts(), null, 2);
                    }
                    if (filter === 'questions') {
                        return JSON.stringify(contextStore.getPendingQuestions(), null, 2);
                    }

                    let queryFilter = { limit: maxItems };
                    if (filter === 'decisions') queryFilter.type = 'decision';
                    else if (filter === 'constraints') queryFilter.type = 'constraint';
                    else if (filter?.startsWith('agent:')) queryFilter.agent = filter.split(':')[1];

                    const entries = contextStore.query(queryFilter);
                    return JSON.stringify({
                        count: entries.length,
                        entries,
                        stats: contextStore.getStats(),
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 15: register_artifact
        tools.push(defineTool('register_artifact', {
            description:
                'Register an artifact (file output) in the shared context so other agents can find it. ' +
                'Every file you create should be registered here with a descriptive key.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Artifact key: "testCases" | "exploration" | "specFile" | "bugTicket" | custom',
                    },
                    filePath: {
                        type: 'string',
                        description: 'Absolute or workspace-relative path to the artifact file',
                    },
                    summary: {
                        type: 'string',
                        description: 'Brief description of what the artifact contains',
                    },
                },
                required: ['key', 'filePath'],
            },
            handler: async ({ key, filePath, summary }) => {
                try {
                    contextStore.registerArtifact(agentName, key, filePath, { summary: summary || '' });
                    return JSON.stringify({ success: true, key, path: filePath });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 16: answer_question
        tools.push(defineTool('answer_question', {
            description:
                'Answer a pending question from another agent. Check read_shared_context with ' +
                'filter "questions" to see pending questions directed at you.',
            parameters: {
                type: 'object',
                properties: {
                    questionId: {
                        type: 'string',
                        description: 'The question ID to answer (from read_shared_context)',
                    },
                    answer: {
                        type: 'string',
                        description: 'Your answer to the question',
                    },
                },
                required: ['questionId', 'answer'],
            },
            handler: async ({ questionId, answer }) => {
                try {
                    contextStore.answerQuestion(agentName, questionId, answer);
                    return JSON.stringify({ success: true, questionId });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    // GROUNDING TOOLS (17-20) — Local context search for ALL agents
    // ═══════════════════════════════════════════════════════════════════

    if (groundingStore) {

        // TOOL 17: search_project_context
        tools.push(defineTool('search_project_context', {
            description:
                'Search the local project codebase for relevant code snippets, page objects, ' +
                'business functions, selectors, and utilities using BM25 full-text search. ' +
                'Use this when you need to find existing code, understand how a feature is implemented, ' +
                'or locate selectors/locators for a specific page or component.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query — e.g., "login authentication token", "search filter price beds", "property detail page locators"',
                    },
                    scope: {
                        type: 'string',
                        description: 'Optional scope filter: "pageObject", "businessFunction", "utility", "config", "testData", "exploration", or leave empty for all',
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum results to return (default: 8)',
                    },
                },
                required: ['query'],
            },
            handler: async ({ query, scope, maxResults }) => {
                try {
                    // Use queryForAgent to apply agent-specific boosts from grounding-config
                    const results = groundingStore.queryForAgent
                        ? groundingStore.queryForAgent(agentName, query, {
                            maxChunks: maxResults || 8,
                            scope: scope || undefined,
                        })
                        : groundingStore.query(query, {
                            maxChunks: maxResults || 8,
                            scope: scope || undefined,
                        });
                    return JSON.stringify({
                        success: true,
                        resultCount: results.length,
                        results: results.map(r => ({
                            filePath: r.filePath,
                            startLine: r.startLine,
                            endLine: r.endLine,
                            type: r.type,
                            score: r.score,
                            matchedTerms: r.matchedTerms,
                            classes: r.metadata?.classes || [],
                            methods: (r.metadata?.methods || []).map(m => m.name),
                            locators: (r.metadata?.locators || []).length,
                            preview: r.content.split('\n').slice(0, 8).join('\n'),
                        })),
                    });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 18: get_feature_map
        tools.push(defineTool('get_feature_map', {
            description:
                'Get detailed information about a specific feature, including its pages, page objects, ' +
                'business functions, test data, and related code snippets. Use this to understand ' +
                'what already exists for a feature before generating new tests or scripts.',
            parameters: {
                type: 'object',
                properties: {
                    featureName: {
                        type: 'string',
                        description: 'The feature name — e.g., "Search", "Login", "Property Details", "Favorites"',
                    },
                },
                required: ['featureName'],
            },
            handler: async ({ featureName }) => {
                try {
                    const context = groundingStore.getFeatureContext(featureName);
                    if (!context) {
                        // List available features
                        const domain = groundingStore.getDomainContext();
                        return JSON.stringify({
                            success: false,
                            message: `Feature "${featureName}" not found in feature map`,
                            availableFeatures: (domain.features || []).map(f => f.name),
                        });
                    }
                    return JSON.stringify({ success: true, feature: context });
                } catch (error) {
                    return JSON.stringify({ error: error.message });
                }
            },
        }));

        // TOOL 19: get_selector_recommendations
        // Available to: scriptgenerator, codereviewer
        if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
            tools.push(defineTool('get_selector_recommendations', {
                description:
                    'Get recommended selectors for a specific page or element. Returns selectors ' +
                    'ranked by reliability (data-qa > getByRole > aria-label > getByText > css-class > xpath). ' +
                    'Use this to find the most stable selector for an element instead of guessing.',
                parameters: {
                    type: 'object',
                    properties: {
                        pageUrl: {
                            type: 'string',
                            description: 'URL or page identifier — e.g., "/search", "/property/123", "SearchPage"',
                        },
                        elementHint: {
                            type: 'string',
                            description: 'Description of the element — e.g., "search button", "price filter", "login form"',
                        },
                    },
                    required: ['pageUrl'],
                },
                handler: async ({ pageUrl, elementHint }) => {
                    try {
                        const recommendations = groundingStore.getSelectorRecommendations(pageUrl, elementHint);
                        return JSON.stringify({
                            success: true,
                            pageUrl,
                            selectorCount: recommendations.length,
                            selectors: recommendations.slice(0, 15),
                        });
                    } catch (error) {
                        return JSON.stringify({ error: error.message });
                    }
                },
            }));
        }

        // TOOL 20: check_existing_coverage
        // Available to: scriptgenerator, testgenie
        if (['scriptgenerator', 'testgenie'].includes(agentName)) {
            tools.push(defineTool('check_existing_coverage', {
                description:
                    'Check if automation scripts already exist for a specific feature, page, or ticket. ' +
                    'Returns existing spec files and their test names. Use this BEFORE generating new tests ' +
                    'to avoid creating duplicate automation coverage.',
                parameters: {
                    type: 'object',
                    properties: {
                        featureName: {
                            type: 'string',
                            description: 'Feature name to check — e.g., "Search", "Login"',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'Jira ticket ID — e.g., "AOTF-16337"',
                        },
                        pagePath: {
                            type: 'string',
                            description: 'Page URL path — e.g., "/search", "/property"',
                        },
                    },
                },
                handler: async ({ featureName, ticketId, pagePath }) => {
                    try {
                        const coverage = groundingStore.checkExistingCoverage({
                            featureName,
                            ticketId,
                            pagePath,
                        });
                        return JSON.stringify({ success: true, ...coverage });
                    } catch (error) {
                        return JSON.stringify({ error: error.message });
                    }
                },
            }));
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // REPO MESH TOOLS — Federated Contract Mesh (backend microservice repos)
    // Full-stack grounding + assertion targeting: UI → API → Kafka → Elastic.
    // Registered only when repoMesh is enabled (config flag or REPO_MESH_ENABLED).
    // ═══════════════════════════════════════════════════════════════════
    try {
        const { getRepoMesh } = require('../repo-mesh');
        const repoMesh = getRepoMesh();
        if (repoMesh.enabled) {
            repoMesh.initialize();

            // TOOL: search_contracts — ALL agents
            tools.push(defineTool('search_contracts', {
                description:
                    'Search the backend Federated Contract Mesh for the REST endpoints, Kafka topics, ' +
                    'Elastic indices, and data models relevant to a query. Returns compact service ' +
                    'contract cards. Use to ground test generation in REAL backend names instead of guessing.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'e.g., "consumer profile update", "save a favorite", "search listings"' },
                        maxServices: { type: 'number', description: 'Max services to return (default: 4)' },
                    },
                    required: ['query'],
                },
                handler: async ({ query, maxServices }) => {
                    try {
                        const res = repoMesh.searchContracts(query, { maxServices: maxServices || 4 });
                        return JSON.stringify({ success: true, ...res });
                    } catch (error) {
                        return JSON.stringify({ error: error.message });
                    }
                },
            }));

            // TOOL: trace_full_stack — scriptgenerator, testgenie, codereviewer
            if (['scriptgenerator', 'testgenie', 'codereviewer'].includes(agentName)) {
                tools.push(defineTool('trace_full_stack', {
                    description:
                        'Trace a UI feature (or free-text query) to its full-stack BLAST RADIUS — the backend ' +
                        'services, REST endpoints, Kafka topics (produced/consumed), and Elastic indices it touches. ' +
                        'Use this to know exactly which topic/index to assert against for end-to-end verification.',
                    parameters: {
                        type: 'object',
                        properties: {
                            feature: { type: 'string', description: 'Feature name from the grounding feature map (e.g., "Favorites", "Property Search") or a free-text query.' },
                        },
                        required: ['feature'],
                    },
                    handler: async ({ feature }) => {
                        try {
                            const trace = repoMesh.traceFullStack(feature, { maxServices: 6 });
                            if (!trace) return JSON.stringify({ success: false, message: `No full-stack trace found for "${feature}".` });
                            return JSON.stringify({ success: true, trace });
                        } catch (error) {
                            return JSON.stringify({ error: error.message });
                        }
                    },
                }));
            }

            // TOOL: get_service_contract — scriptgenerator, codereviewer
            if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
                tools.push(defineTool('get_service_contract', {
                    description:
                        'Get the contract for a specific backend service at a chosen resolution: ' +
                        'L1 (full endpoints/topics/indices/models), L2 (compact card), or L3 (system index). ' +
                        'Use L2 by default; drill to L1 only when you need exact fields or every endpoint.',
                    parameters: {
                        type: 'object',
                        properties: {
                            serviceName: { type: 'string', description: 'e.g., "aotf-consumer-profiles-service"' },
                            resolution: { type: 'string', description: '"L1" | "L2" | "L3" (default L2)' },
                        },
                        required: ['serviceName'],
                    },
                    handler: async ({ serviceName, resolution }) => {
                        try {
                            const contract = repoMesh.getServiceContract(serviceName, resolution || 'L2');
                            return JSON.stringify(contract
                                ? { success: true, contract }
                                : { success: false, message: `Service "${serviceName}" not found in mesh. Run repo-mesh-setup sync first.` });
                        } catch (error) {
                            return JSON.stringify({ error: error.message });
                        }
                    },
                }));
            }

            // TOOL: get_event_schema + get_index_mapping — scriptgenerator
            if (agentName === 'scriptgenerator') {
                tools.push(defineTool('get_event_schema', {
                    description:
                        'For a Kafka topic, return which services produce/consume it and the candidate payload ' +
                        'models (with fields). Use to build expectKafkaEvent() matchers grounded in real schemas.',
                    parameters: {
                        type: 'object',
                        properties: { topic: { type: 'string', description: 'Kafka topic name, e.g., "consumers"' } },
                        required: ['topic'],
                    },
                    handler: async ({ topic }) => {
                        try {
                            return JSON.stringify({ success: true, ...repoMesh.getEventSchema(topic) });
                        } catch (error) {
                            return JSON.stringify({ error: error.message });
                        }
                    },
                }));

                tools.push(defineTool('get_index_mapping', {
                    description:
                        'For an Elastic index, return which services write it and the document field mapping. ' +
                        'Use to build expectElasticDoc() queries grounded in real field names.',
                    parameters: {
                        type: 'object',
                        properties: { index: { type: 'string', description: 'Elastic index name, e.g., "listing_sentiments"' } },
                        required: ['index'],
                    },
                    handler: async ({ index }) => {
                        try {
                            return JSON.stringify({ success: true, ...repoMesh.getIndexMapping(index) });
                        } catch (error) {
                            return JSON.stringify({ error: error.message });
                        }
                    },
                }));
            }

            // TOOL: verify_backend_assertions — scriptgenerator, codereviewer
            // Anti-hallucination guardrail: confirm topics/indices in a spec are real.
            if (['scriptgenerator', 'codereviewer'].includes(agentName)) {
                tools.push(defineTool('verify_backend_assertions', {
                    description:
                        'Verify that the Kafka topics and Elastic indices referenced in a generated ' +
                        'spec (expectKafkaEvent/expectElasticDoc) actually exist in the backend contracts. ' +
                        'Returns ungrounded references (likely hallucinations) with "did you mean" suggestions. ' +
                        'Run this BEFORE executing a full-stack test.',
                    parameters: {
                        type: 'object',
                        properties: {
                            code: { type: 'string', description: 'The .spec.js source code to verify.' },
                        },
                        required: ['code'],
                    },
                    handler: async ({ code }) => {
                        try {
                            const { ContractVerifier } = require('../repo-mesh/contract-verifier');
                            const verifier = new ContractVerifier({ mesh: repoMesh });
                            return JSON.stringify({ success: true, ...verifier.verify(code || '') });
                        } catch (error) {
                            return JSON.stringify({ error: error.message });
                        }
                    },
                }));
            }
        }
    } catch (meshErr) {
        // The mesh is optional — never let it break tool registration.
        if (process.env.REPO_MESH_DEBUG === 'true') console.error('[repo-mesh tools] skipped:', meshErr.message);
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 21: get_snapshot_quality
    // Available to: scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (agentName === 'scriptgenerator') {
        tools.push(defineTool('get_snapshot_quality', {
            description:
                'Returns OODA quality assessment data for all MCP snapshots taken in the current session. ' +
                'Shows per-snapshot scores, element counts, role diversity, warnings, and whether ' +
                'script creation is currently allowed. Use this to check if your exploration data ' +
                'is sufficient before creating the .spec.js file.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => {
                try {
                    const { getSnapshotQualityData } = require('./enforcement-hooks');
                    const data = getSnapshotQualityData('scriptgenerator');

                    if (!data) {
                        return JSON.stringify({
                            success: false,
                            message: 'No snapshot data available. Call unified_snapshot first.',
                        });
                    }

                    return JSON.stringify({
                        success: true,
                        totalSnapshots: data.totalSnapshots,
                        qualityAssessed: data.qualityAssessed,
                        summary: data.summary,
                        canCreateSpec: data.canCreateSpec,
                        latestSnapshot: data.latestSnapshot,
                        allSnapshots: data.allSnapshots,
                        guidance: data.canCreateSpec
                            ? 'Script creation is ALLOWED — your latest snapshot passed quality checks.'
                            : 'Script creation is BLOCKED — your latest snapshot scored below the retry threshold. ' +
                            'Wait for the page to fully load, dismiss popups, and call unified_snapshot again.',
                    }, null, 2);
                } catch (error) {
                    return JSON.stringify({ success: false, error: error.message });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 22: search_knowledge_base
    // Available to: ALL agents
    // Search external KB (Confluence, Notion, SharePoint) for documentation
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore) {
            tools.push(defineTool('search_knowledge_base', {
                description:
                    'Search the external Knowledge Base (Confluence, Notion, SharePoint, etc.) for documentation, ' +
                    'requirements, specifications, business rules, or domain knowledge. Returns ranked results ' +
                    'from configured KB providers. Use when you need context about application features, ' +
                    'acceptance criteria, architecture decisions, or business processes that aren\'t in the codebase.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query — e.g., "property search filters", "login authentication flow", "MLS onboarding"',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum results to return (default: 5)',
                        },
                        spaceKey: {
                            type: 'string',
                            description: 'Optional: restrict search to a specific space/project key',
                        },
                        skipIntentCheck: {
                            type: 'boolean',
                            description: 'Skip intent detection and force a live KB search (default: false). Use when a query returns 0 results but you know KB content exists.',
                        },
                    },
                    required: ['query'],
                },
                handler: async ({ query, maxResults, spaceKey, skipIntentCheck }) => {
                    const toolCache = getToolCache();
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const directPage = normalizeConfluencePageInput(query, latestUserMessage);

                    // Check TTL cache
                    const cacheKey = `kb_search_${query}_${maxResults || 5}_${spaceKey || ''}_${skipIntentCheck || false}`;
                    const cached = toolCache.get(cacheKey);
                    if (cached) return cached;

                    // Broadcast progress: searching KB
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('search_knowledge_base', {
                            phase: 'kb', message: `Searching knowledge base for "${query.substring(0, 60)}"...`, step: 1,
                        });
                    }

                    try {
                        if (directPage.pageId && gStore._kbConnector) {
                            const page = await gStore._kbConnector.getPage(directPage.pageId);
                            if (page) {
                                const response = JSON.stringify({
                                    success: true,
                                    query,
                                    resultCount: 1,
                                    fromCache: false,
                                    directPageFetch: true,
                                    pageId: directPage.pageId,
                                    results: [{
                                        title: page.title,
                                        excerpt: page.excerpt || page.content?.substring(0, 300) || '',
                                        url: page.url,
                                        space: page.space,
                                        lastModified: page.lastModified,
                                        id: page.id,
                                        labels: page.metadata?.labels || [],
                                    }],
                                }, null, 2);

                                toolCache.set(cacheKey, response, 300000);
                                return response;
                            }
                        }

                        let result = await gStore.queryKnowledgeBase(query, {
                            agentName,
                            maxResults: maxResults || 5,
                            spaceKey: spaceKey || undefined,
                            skipIntentCheck: skipIntentCheck || false,
                        });

                        // Auto-retry: if intent detection blocked or returned 0 results,
                        // silently retry once with skipIntentCheck to ensure Confluence is always queried
                        if (!skipIntentCheck && (result.blocked || (result.results.length === 0 && !result.error))) {
                            const retryReason = result.blocked
                                ? `intent blocked (confidence=${result.intent?.confidence?.toFixed(2) || '?'})`
                                : 'zero results with intent pass';
                            console.log(`[KB Tool] Auto-retrying with skipIntentCheck=true: ${retryReason}`);
                            result = await gStore.queryKnowledgeBase(query, {
                                agentName,
                                maxResults: maxResults || 5,
                                spaceKey: spaceKey || undefined,
                                skipIntentCheck: true,
                            });
                            result._autoRetried = true;
                        }

                        if (result.error && result.results.length === 0) {
                            return JSON.stringify({
                                success: false,
                                error: result.error,
                                message: 'Knowledge Base is not configured or unavailable. Check .env for CONFLUENCE_BASE_URL and KB_ENABLED.',
                            });
                        }

                        const response = JSON.stringify({
                            success: true,
                            query,
                            resultCount: result.results.length,
                            fromCache: result.fromCache || false,
                            intent: result.intent ? {
                                confidence: result.intent.confidence,
                                matchedTerms: result.intent.matchedTerms,
                                matchedFeatures: result.intent.matchedFeatures,
                            } : null,
                            results: (result.results || []).map(r => ({
                                title: r.title,
                                excerpt: r.excerpt || r.content?.substring(0, 300) || '',
                                url: r.url,
                                space: r.space,
                                lastModified: r.lastModified,
                                id: r.id,
                                labels: r.metadata?.labels || [],
                            })),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 300000); // 5-min cache
                        return response;
                    } catch (error) {
                        return JSON.stringify({ success: false, error: error.message });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 23: get_knowledge_base_page
    // Available to: ALL agents
    // Fetch full content of a specific KB page by ID
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('get_knowledge_base_page', {
                description:
                    'Fetch the full content of a specific Knowledge Base page by its ID. ' +
                    'Use this after search_knowledge_base to get detailed content of a relevant page. ' +
                    'Also supports fetching a page tree (page with all child pages).',
                parameters: {
                    type: 'object',
                    properties: {
                        pageId: {
                            type: 'string',
                            description: 'Page ID to fetch — obtained from search_knowledge_base results',
                        },
                        includeChildren: {
                            type: 'boolean',
                            description: 'Also fetch child pages (default: false)',
                        },
                        maxDepth: {
                            type: 'number',
                            description: 'Max depth for child page traversal (default: 2)',
                        },
                    },
                    required: ['pageId'],
                },
                handler: async ({ pageId, includeChildren, maxDepth }) => {
                    const toolCache = getToolCache();
                    const latestUserMessage = getLatestUserMessageText(deps);
                    const normalizedPage = normalizeConfluencePageInput(pageId, latestUserMessage);

                    if (!normalizedPage.pageId) {
                        return JSON.stringify({
                            success: false,
                            error: 'Could not resolve a Confluence page ID from the provided input.',
                            hint: 'Pass a numeric Confluence page ID or a full Confluence page URL.',
                        });
                    }

                    const cacheKey = `kb_page_${normalizedPage.pageId}_${includeChildren || false}`;
                    const cached = toolCache.get(cacheKey);
                    if (cached) return cached;

                    try {
                        const connector = gStore._kbConnector;
                        let pages;

                        if (includeChildren) {
                            pages = await connector.getPageTree(normalizedPage.pageId, {
                                depth: maxDepth || 2,
                            });
                        } else {
                            const page = await connector.getPage(normalizedPage.pageId);
                            pages = page ? [page] : [];
                        }

                        if (pages.length === 0) {
                            return JSON.stringify({
                                success: false,
                                error: `Page ${normalizedPage.pageId} not found`,
                            });
                        }

                        const response = JSON.stringify({
                            success: true,
                            pageId: normalizedPage.pageId,
                            resolvedFrom: normalizedPage.source,
                            sourceUrl: normalizedPage.sourceUrl,
                            pageCount: pages.length,
                            pages: pages.map(p => ({
                                id: p.id,
                                title: p.title,
                                content: p.content?.substring(0, 8000) || '',
                                url: p.url,
                                space: p.space,
                                lastModified: p.lastModified,
                                labels: p.metadata?.labels || [],
                                author: p.metadata?.author || '',
                            })),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 600000); // 10-min cache
                        return response;
                    } catch (error) {
                        return JSON.stringify({ success: false, error: error.message });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24a: search_confluence_content
    // Available to: ALL agents when Confluence grounding is enabled
    // Dedicated Confluence discovery search with structured output.
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('search_confluence_content', {
                description:
                    'Search Confluence pages directly for documentation, requirements, runbooks, or feature notes. ' +
                    'Prefer this over generic knowledge-base search when the user explicitly wants Confluence discovery, space-scoped search, or navigation-ready page results.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search text to match in Confluence page content or titles.',
                        },
                        spaceKey: {
                            type: 'string',
                            description: 'Optional Confluence space key to scope the search.',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of pages to return (default 10, max 50).',
                        },
                        labels: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Optional Confluence labels to filter by.',
                        },
                    },
                    required: ['query'],
                },
                handler: async ({ query, spaceKey, maxResults, labels }) => {
                    try {
                        if (!isNonEmptyString(query)) {
                            return JSON.stringify({
                                success: false,
                                error: 'query is required to search Confluence content.',
                            });
                        }

                        const provider = getConfluenceProvider(gStore);
                        if (!provider) {
                            return JSON.stringify({
                                success: false,
                                error: 'Confluence provider is not configured in the Knowledge Base connector.',
                            });
                        }

                        const toolCache = getToolCache();
                        const cacheKey = `confluence_search_${query.trim()}_${spaceKey || ''}_${normalizeMaxResults(maxResults)}_${JSON.stringify(labels || [])}`;
                        const cached = toolCache.get(cacheKey);
                        if (cached) return cached;

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('search_confluence_content', {
                                phase: 'kb', message: 'Searching Confluence content...', step: 1,
                            });
                        }

                        const results = await provider.search(query.trim(), {
                            spaceKey: isNonEmptyString(spaceKey) ? spaceKey.trim() : undefined,
                            maxResults: normalizeMaxResults(maxResults),
                            labels: Array.isArray(labels) ? labels.filter(isNonEmptyString).map(label => label.trim()) : undefined,
                            includeBody: true,
                        });

                        const response = JSON.stringify({
                            success: true,
                            query: query.trim(),
                            spaceKey: isNonEmptyString(spaceKey) ? spaceKey.trim() : undefined,
                            resultCount: results.length,
                            results: results.map(page => formatConfluencePage(page)),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 300000);
                        return response;
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Confluence search error: ${error.message}`,
                        });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24b: get_confluence_page_details
    // Available to: ALL agents when Confluence grounding is enabled
    // Fetches a single Confluence page with navigation-friendly metadata.
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('get_confluence_page_details', {
                description:
                    'Fetch a Confluence page by page ID or full page URL and return navigation-ready metadata, labels, author, version, and content. ' +
                    'Use this when the user gives a Confluence URL or needs an exact page summary.',
                parameters: {
                    type: 'object',
                    properties: {
                        pageId: {
                            type: 'string',
                            description: 'Confluence page ID or full Confluence page URL.',
                        },
                        includeContent: {
                            type: 'boolean',
                            description: 'Include page body content in the response (default true).',
                        },
                        contentMaxChars: {
                            type: 'number',
                            description: 'Maximum number of content characters to return when includeContent is true (default 8000).',
                        },
                    },
                    required: ['pageId'],
                },
                handler: async ({ pageId, includeContent, contentMaxChars }) => {
                    try {
                        const latestUserMessage = getLatestUserMessageText(deps);
                        const normalizedPage = normalizeConfluencePageInput(pageId, latestUserMessage);
                        if (!normalizedPage.pageId) {
                            return JSON.stringify({
                                success: false,
                                error: 'Could not resolve a Confluence page ID from the provided input.',
                                hint: 'Pass a numeric page ID like 189467646 or a full Confluence page URL.',
                            });
                        }

                        const connector = gStore._kbConnector;
                        const toolCache = getToolCache();
                        const resolvedIncludeContent = includeContent !== false;
                        const resolvedMaxChars = Math.max(0, Number(contentMaxChars) || 8000);
                        const cacheKey = `confluence_page_${normalizedPage.pageId}_${resolvedIncludeContent}_${resolvedMaxChars}`;
                        const cached = toolCache.get(cacheKey);
                        if (cached) return cached;

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('get_confluence_page_details', {
                                phase: 'kb', message: `Fetching Confluence page ${normalizedPage.pageId}...`, step: 1,
                            });
                        }

                        const page = await connector.getPage(normalizedPage.pageId);
                        if (!page) {
                            return JSON.stringify({
                                success: false,
                                error: `Confluence page ${normalizedPage.pageId} not found.`,
                            });
                        }

                        const response = JSON.stringify({
                            success: true,
                            pageId: normalizedPage.pageId,
                            resolvedFrom: normalizedPage.source,
                            sourceUrl: normalizedPage.sourceUrl,
                            page: formatConfluencePage(page, {
                                includeContent: resolvedIncludeContent,
                                contentMaxChars: resolvedMaxChars,
                            }),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 600000);
                        return response;
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Confluence page fetch error: ${error.message}`,
                        });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24c: list_confluence_spaces
    // Available to: ALL agents when Confluence grounding is enabled
    // Lists accessible Confluence spaces.
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('list_confluence_spaces', {
                description:
                    'List accessible Confluence spaces with keys, names, URLs, and descriptions. ' +
                    'Use this before searching or browsing a specific space when the user does not know the exact space key.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Optional text filter to narrow spaces by key or name.',
                        },
                    },
                    required: [],
                },
                handler: async ({ query }) => {
                    try {
                        const provider = getConfluenceProvider(gStore);
                        if (!provider) {
                            return JSON.stringify({
                                success: false,
                                error: 'Confluence provider is not configured in the Knowledge Base connector.',
                            });
                        }

                        const toolCache = getToolCache();
                        const normalizedQuery = isNonEmptyString(query) ? query.trim().toLowerCase() : '';
                        const cacheKey = `confluence_spaces_${normalizedQuery}`;
                        const cached = toolCache.get(cacheKey);
                        if (cached) return cached;

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('list_confluence_spaces', {
                                phase: 'kb', message: 'Listing Confluence spaces...', step: 1,
                            });
                        }

                        const spaces = await provider.listSpaces();
                        const filtered = normalizedQuery
                            ? spaces.filter(space => {
                                const key = String(space?.key || '').toLowerCase();
                                const name = String(space?.name || '').toLowerCase();
                                return key.includes(normalizedQuery) || name.includes(normalizedQuery);
                            })
                            : spaces;

                        const response = JSON.stringify({
                            success: true,
                            query: normalizedQuery || undefined,
                            spaceCount: filtered.length,
                            spaces: filtered.map(formatConfluenceSpace),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 600000);
                        return response;
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Confluence space listing error: ${error.message}`,
                        });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24d: list_confluence_pages_in_space
    // Available to: ALL agents when Confluence grounding is enabled
    // Lists pages inside a Confluence space with optional query filter.
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('list_confluence_pages_in_space', {
                description:
                    'List Confluence pages within a specific space, optionally filtered by a query. ' +
                    'Use this when the user knows the space but needs to browse or narrow the available pages.',
                parameters: {
                    type: 'object',
                    properties: {
                        spaceKey: {
                            type: 'string',
                            description: 'Confluence space key to browse.',
                        },
                        query: {
                            type: 'string',
                            description: 'Optional text filter for page content/title within the space.',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of pages to return (default 10, max 50).',
                        },
                    },
                    required: ['spaceKey'],
                },
                handler: async ({ spaceKey, query, maxResults }) => {
                    try {
                        if (!isNonEmptyString(spaceKey)) {
                            return JSON.stringify({
                                success: false,
                                error: 'spaceKey is required to list Confluence pages.',
                            });
                        }

                        const provider = getConfluenceProvider(gStore);
                        if (!provider) {
                            return JSON.stringify({
                                success: false,
                                error: 'Confluence provider is not configured in the Knowledge Base connector.',
                            });
                        }

                        const resolvedQuery = isNonEmptyString(query) ? query.trim() : '';
                        const resolvedSpaceKey = spaceKey.trim();
                        const resolvedMaxResults = normalizeMaxResults(maxResults);
                        const toolCache = getToolCache();
                        const cacheKey = `confluence_space_pages_${resolvedSpaceKey}_${resolvedQuery}_${resolvedMaxResults}`;
                        const cached = toolCache.get(cacheKey);
                        if (cached) return cached;

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('list_confluence_pages_in_space', {
                                phase: 'kb', message: `Listing pages in Confluence space ${resolvedSpaceKey}...`, step: 1,
                            });
                        }

                        const pages = await provider.search(resolvedQuery, {
                            spaceKey: resolvedSpaceKey,
                            maxResults: resolvedMaxResults,
                            includeBody: false,
                            cqlFilter: 'ORDER BY lastModified DESC',
                        });

                        const response = JSON.stringify({
                            success: true,
                            spaceKey: resolvedSpaceKey,
                            query: resolvedQuery || undefined,
                            pageCount: pages.length,
                            pages: pages.map(page => formatConfluencePage(page)),
                        }, null, 2);

                        toolCache.set(cacheKey, response, 300000);
                        return response;
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Confluence page listing error: ${error.message}`,
                        });
                    }
                },
            }));
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24e: get_confluence_page_tree
    // Available to: ALL agents when Confluence grounding is enabled
    // Returns a navigation tree for a Confluence page and its descendants.
    // ───────────────────────────────────────────────────────────────────
    {
        const gStore = groundingStore;
        if (gStore && gStore._kbConnector) {
            tools.push(defineTool('get_confluence_page_tree', {
                description:
                    'Return a Confluence page and its descendants as a navigation tree. ' +
                    'Use this to inspect direct children or walk a documentation hierarchy from a known root page.',
                parameters: {
                    type: 'object',
                    properties: {
                        pageId: {
                            type: 'string',
                            description: 'Root Confluence page ID or full page URL.',
                        },
                        maxDepth: {
                            type: 'number',
                            description: 'Maximum traversal depth including the root page (default 2, max 5).',
                        },
                        includeRoot: {
                            type: 'boolean',
                            description: 'Include the root page in the returned tree (default true).',
                        },
                        directChildrenOnly: {
                            type: 'boolean',
                            description: 'Return only direct children of the root page.',
                        },
                    },
                    required: ['pageId'],
                },
                handler: async ({ pageId, maxDepth, includeRoot, directChildrenOnly }) => {
                    try {
                        const latestUserMessage = getLatestUserMessageText(deps);
                        const normalizedPage = normalizeConfluencePageInput(pageId, latestUserMessage);
                        if (!normalizedPage.pageId) {
                            return JSON.stringify({
                                success: false,
                                error: 'Could not resolve a Confluence page ID from the provided input.',
                                hint: 'Pass a numeric page ID like 189467646 or a full Confluence page URL.',
                            });
                        }

                        const provider = getConfluenceProvider(gStore);
                        if (!provider) {
                            return JSON.stringify({
                                success: false,
                                error: 'Confluence provider is not configured in the Knowledge Base connector.',
                            });
                        }

                        const resolvedDepth = Math.max(1, Math.min(Number(maxDepth) || 2, 5));
                        const resolvedIncludeRoot = includeRoot !== false;
                        const toolCache = getToolCache();
                        const cacheKey = `confluence_tree_${normalizedPage.pageId}_${resolvedDepth}_${resolvedIncludeRoot}_${Boolean(directChildrenOnly)}`;
                        const cached = toolCache.get(cacheKey);
                        if (cached) return cached;

                        if (deps?.chatManager?.broadcastToolProgress) {
                            deps.chatManager.broadcastToolProgress('get_confluence_page_tree', {
                                phase: 'kb', message: `Loading Confluence page tree for ${normalizedPage.pageId}...`, step: 1,
                            });
                        }

                        const pages = await provider.getPageTree(normalizedPage.pageId, {
                            depth: resolvedDepth,
                            includeBody: false,
                        });

                        const annotatedPages = annotateConfluenceTreeDepth(pages, normalizedPage.pageId)
                            .filter(entry => resolvedIncludeRoot || String(entry.page?.id || '') !== normalizedPage.pageId)
                            .filter(entry => !directChildrenOnly || entry.depth === 1)
                            .map(entry => formatConfluencePage(entry.page, { depth: entry.depth }));

                        const response = JSON.stringify({
                            success: true,
                            pageId: normalizedPage.pageId,
                            resolvedFrom: normalizedPage.source,
                            sourceUrl: normalizedPage.sourceUrl,
                            maxDepth: resolvedDepth,
                            includeRoot: resolvedIncludeRoot,
                            directChildrenOnly: Boolean(directChildrenOnly),
                            pageCount: annotatedPages.length,
                            pages: annotatedPages,
                        }, null, 2);

                        toolCache.set(cacheKey, response, 300000);
                        return response;
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            error: `Confluence page tree error: ${error.message}`,
                        });
                    }
                },
            }));
        }
    }

    // ─── CONTEXT ENGINEERING TOOLS ──────────────────────────────────────
    // Tools for dynamic context management: mid-session grounding refresh,
    // structured note-taking, and context budget diagnostics.
    // These implement the "just-in-time" retrieval and "structured note-taking"
    // patterns from Anthropic's context engineering research.

    // TOOL CE-1: refresh_grounding_context
    // Enables agents to pull fresh grounding data mid-session when they
    // discover new features/pages not in the initial context injection.
    if (groundingStore && ['scriptgenerator', 'codereviewer'].includes(agentName)) {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('refresh_grounding_context', {
            description:
                'Refresh grounding context mid-session. Call this when you discover the test involves ' +
                'features or pages not present in your initial context. Returns updated code chunks, ' +
                'selectors, and feature map data for the specified feature or query.',
            parameters: {
                type: 'object',
                properties: {
                    feature: {
                        type: 'string',
                        description: 'Feature name to query grounding for (e.g., "Property Search", "Map View", "Favorites")',
                    },
                    query: {
                        type: 'string',
                        description: 'Free-form search query for code context (e.g., "login flow popup handler")',
                    },
                    ticketId: {
                        type: 'string',
                        description: 'Ticket ID for exploration freshness check',
                    },
                },
            },
            handler: async ({ feature, query, ticketId }) => {
                try {
                    const refreshed = contextEngine.refreshGroundingContext(
                        groundingStore, agentName, { feature, query, ticketId }
                    );
                    if (refreshed && refreshed.length > 0) {
                        return `Grounding context refreshed (${refreshed.length} chars):\n\n${refreshed}`;
                    }
                    return 'No additional grounding context found for this query.';
                } catch (error) {
                    return `Grounding refresh failed: ${error.message}`;
                }
            },
        }));
    }

    // TOOL CE-2: write_agent_note
    // Structured note-taking: agents persist discoveries outside the context window.
    // Notes are available to the same or other agents in later sessions.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('write_agent_note', {
            description:
                'Persist a discovery or observation outside the context window. ' +
                'Notes survive across sessions and are injected into later agent contexts. ' +
                'Use for: selector patterns, page behavior quirks, popup patterns, load timing issues, ' +
                'or any insight that future agents should know.',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: 'Note category: "discovery", "pattern", "warning", "selector", "fix"',
                        enum: ['discovery', 'pattern', 'warning', 'selector', 'fix'],
                    },
                    content: {
                        type: 'string',
                        description: 'The note content — be specific and actionable',
                    },
                    page: {
                        type: 'string',
                        description: 'Optional: which page this applies to (e.g., "/search", "/property-detail")',
                    },
                },
                required: ['category', 'content'],
            },
            handler: async ({ category, content, page }) => {
                const note = contextEngine.recordAgentNote(agentName, category, content, { page });

                // Also record in SharedContextStore if available
                if (contextStore) {
                    contextStore.addNote(agentName, `[${category}] ${content}`, { page, noteId: note.id });
                }

                return `Note recorded: [${category}] ${content.slice(0, 80)}...`;
            },
        }));
    }

    // TOOL CE-3: get_agent_notes
    // Retrieve notes from current and previous agents.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('get_agent_notes', {
            description:
                'Retrieve notes written by agents during this pipeline run. ' +
                'Useful for checking what previous agents discovered about pages, selectors, or issues.',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: 'Filter by category: "discovery", "pattern", "warning", "selector", "fix"',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max notes to return (default: 10)',
                    },
                },
            },
            handler: async ({ category, limit }) => {
                const notes = contextEngine.getAgentNotes({ category, limit: limit || 10 });
                if (notes.length === 0) {
                    return 'No agent notes found for this query.';
                }
                return notes.map(n =>
                    `[${n.category}] ${n.agent} (${n.timestamp}): ${n.content}` +
                    (n.metadata?.page ? ` | page: ${n.metadata.page}` : '')
                ).join('\n');
            },
        }));
    }

    // TOOL CE-4: get_context_budget
    // Diagnostics tool: shows agents how much context budget they're using.
    {
        const { getContextEngine } = require('./context-engine');
        const contextEngine = getContextEngine();

        tools.push(defineTool('get_context_budget', {
            description:
                'Check context budget utilization and metrics. Shows how much of the context window ' +
                'is being used, which components were included/compressed/dropped, and estimated token savings.',
            parameters: { type: 'object', properties: {} },
            handler: async () => {
                const metrics = contextEngine.getMetrics();
                return JSON.stringify({
                    totalPackCalls: metrics.totalPackCalls,
                    totalCompactions: metrics.totalCompactions,
                    estimatedTokensSaved: metrics.totalTokensSaved,
                    averageBudgetUtilization: metrics.averageBudgetUtilization + '%',
                    noteCount: metrics.noteCount,
                    componentStats: metrics.componentStats,
                }, null, 2);
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 24: generate_pptx
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_pptx', {
            description:
                'Generates a professional PowerPoint (.pptx) file from a flexible slides array. ' +
                '28 slide types: title, content, bullets, two-column, table, chart, image, quote, ' +
                'section-break, comparison, summary, timeline, process-flow, stats-dashboard, icon-grid, ' +
                'pyramid, matrix-quadrant, agenda, team-profiles, before-after, funnel, roadmap, swot, ' +
                'hero-image, closing, diagram, data-story, infographic. Comparison slides should use ' +
                'leftTitle/rightTitle with leftItems/rightItems or leftContent/rightContent. Two-column slides ' +
                'can use leftContent/rightContent or leftItems/rightItems. Summary slides should use metrics ' +
                'plus highlights/summaryPoints. Table slides accept tableData.headers/tableData.rows or top-level ' +
                'headers/rows. Diagram slides require mermaidCode, diagramImage, or imagePath. The tool validates ' +
                'slide payloads and returns warnings when the layout is likely to be weak. Supports transitions ' +
                '(fade/push/wipe) and brand kits. Returns the file path to the generated .pptx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Presentation title (shown on title slide)' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    slides: {
                        type: 'string',
                        description:
                            'JSON array string of slide objects. Example comparison slide: ' +
                            '[{"type":"comparison","title":"Current vs Future","leftTitle":"Current funnel","leftItems":["Shared listing link","Sign-in gate"],"rightTitle":"Enhanced funnel","rightItems":["Profile share entry","Request access path"]}]. ' +
                            'Optional slide metadata such as narrativeRole, layoutMode, densityTarget, cardStyle, chartStrategy, renderHints, and sourceRefs may be included for planning and downstream quality checks.',
                    },
                },
                required: ['title', 'slides'],
            },
            handler: async ({ title, author, theme, slides }) => {
                try {
                    let parsedSlides;
                    try { parsedSlides = JSON.parse(slides); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid slides JSON: ${e.message}` });
                    }

                    const validation = validatePptxSlides(parsedSlides);
                    if (validation.errors.length > 0) {
                        return JSON.stringify({
                            success: false,
                            error: 'PPTX slide validation failed. Fix the slide payload before retrying.',
                            validation,
                        });
                    }

                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_pptx', {
                            phase: 'document', message: `Generating PPTX (${parsedSlides.length} slides)...`, step: 1,
                        });
                    }
                    const { generatePptx } = require(path.join(__dirname, '..', 'scripts', 'pptx-generator.js'));
                    const result = await generatePptx({ title, author, theme, slides: parsedSlides });

                    if (result && result.success) {
                        result.validation = {
                            checkedSlides: parsedSlides.length,
                            warningCount: validation.warnings.length,
                            warnings: validation.warnings,
                        };

                        if (validation.warnings.length > 0) {
                            result.warnings = validation.warnings;
                        }
                    }

                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `PPTX generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 25: generate_docx
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_docx', {
            description:
                'Generates a professional Word (.docx) file from a flexible sections array. ' +
                '18 section types: heading, paragraph, bullets, numbered-list, table, code-block, callout, ' +
                'image, page-break, two-column, cover, pull-quote, sidebar, metric-strip, info-card-grid, ' +
                'diagram, chart, infographic. Supports TOC, running headers/footers. Returns the file path ' +
                'to the generated .docx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    includeTableOfContents: { type: 'boolean', description: 'Whether to include a Table of Contents page (default: false)' },
                    headerText: { type: 'string', description: 'Running header text (top-right of each page)' },
                    footerText: { type: 'string', description: 'Running footer text (centered at bottom)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Each section: { type, text?, content?, items?, headers?, rows?, ... }' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, includeTableOfContents, headerText, footerText, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_docx', {
                            phase: 'document', message: `Generating DOCX (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateDocx } = require(path.join(__dirname, '..', 'scripts', 'docx-generator.js'));
                    const result = await generateDocx({ title, author, theme, includeTableOfContents, headerText, footerText, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `DOCX generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 26: generate_pdf
    // Available to: docgenie (also buggenie for report attachments)
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_pdf', {
            description:
                'Generates a professional PDF file from a flexible sections array. ' +
                '18 section types: heading, paragraph, bullets, numbered-list, table, code-block, callout, ' +
                'page-break, two-column, cover, pull-quote, sidebar, metric-strip, info-card-grid, ' +
                'diagram, chart, infographic. Supports watermark, TOC, and page borders. Returns the file ' +
                'path to the generated .pdf.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    watermark: { type: 'string', description: 'Optional watermark text displayed diagonally on all pages (e.g. DRAFT, CONFIDENTIAL)' },
                    includeTableOfContents: { type: 'boolean', description: 'Whether to include a Table of Contents page (default: false)' },
                    pageBorders: { type: 'boolean', description: 'Whether to add subtle accent borders to content pages (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Each section: { type, text?, content?, items?, headers?, rows?, ... }' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, watermark, includeTableOfContents, pageBorders, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_pdf', {
                            phase: 'document', message: `Generating PDF (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generatePdf } = require(path.join(__dirname, '..', 'scripts', 'pdf-generator.js'));
                    const result = await generatePdf({ title, author, theme, watermark, includeTableOfContents, pageBorders, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `PDF generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 27: generate_excel_report
    // Available to: docgenie (also buggenie for report attachments)
    // NOTE: This is SEPARATE from TestGenie's generate_test_case_excel
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_excel_report', {
            description:
                'Generates a professional Excel (.xlsx) workbook from a flexible sheets array. ' +
                'NOT the same as generate_test_case_excel (which is TestGenie-only). ' +
                'Each sheet can be: data-table, summary-card, key-value, matrix, or chart-data. ' +
                'Returns the file path to the generated .xlsx.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Workbook title (used for metadata + filename)' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    sheets: { type: 'string', description: 'JSON array string of sheet objects. Each: { name, contentType, content: { headers?, rows?, metrics?, pairs?, ... } }' },
                },
                required: ['title', 'sheets'],
            },
            handler: async ({ title, author, theme, sheets }) => {
                try {
                    let parsedSheets;
                    try { parsedSheets = JSON.parse(sheets); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sheets JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_excel_report', {
                            phase: 'document', message: `Generating Excel report (${parsedSheets.length} sheets)...`, step: 1,
                        });
                    }
                    const { generateExcelReport } = require(path.join(__dirname, '..', 'scripts', 'excel-report-generator.js'));
                    const result = await generateExcelReport({ title, author, theme, sheets: parsedSheets });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Excel report generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 28: generate_diagram
    // Available to: docgenie, buggenie, scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie', 'scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('generate_diagram', {
            description:
                'Renders a Mermaid diagram as SVG and/or PNG. Supports flowchart, sequence, class, state, ' +
                'ER, pie, gantt, and other Mermaid diagram types. Theme-aware rendering with high-quality output. ' +
                'Returns file paths to the generated SVG and PNG files.',
            parameters: {
                type: 'object',
                properties: {
                    mermaidCode: { type: 'string', description: 'Mermaid DSL code (e.g., "graph TD\\nA-->B")' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                    svg: { type: 'boolean', description: 'Generate SVG output (default: true)' },
                    png: { type: 'boolean', description: 'Generate PNG output (default: true)' },
                },
                required: ['mermaidCode'],
            },
            handler: async ({ mermaidCode, theme, outputName, svg, png }) => {
                try {
                    const { renderDiagram, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'diagram-engine.js'));
                    const result = await renderDiagram({
                        mermaidCode, theme: theme || 'modern-blue', outputName,
                        svg: svg !== false, png: png !== false,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Diagram generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 29: generate_chart_image
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_chart_image', {
            description:
                'Renders a high-quality chart as a PNG image using Chart.js. Supports: bar, line, pie, doughnut, ' +
                'radar, polarArea, scatter, bubble, gauge, waterfall. Theme-aware with professional styling. ' +
                'Returns the file path to the generated PNG.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Chart type: bar, line, pie, doughnut, radar, polarArea, scatter, bubble, gauge, waterfall' },
                    chartTitle: { type: 'string', description: 'Chart title (displayed above chart)' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string: { labels: [...], datasets: [{ label, data: [...] }] }. For gauge: { value, max, label }. For waterfall: { labels: [...], values: [...] }.' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                },
                required: ['type', 'data'],
            },
            handler: async ({ type, chartTitle, theme, data, outputName }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { renderChart, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'chart-renderer.js'));
                    const result = await renderChart({
                        type, chartTitle, theme: theme || 'modern-blue', outputName,
                        ...parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Chart generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 30: generate_infographic
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_infographic', {
            description:
                'Renders a pre-built infographic component as a high-quality PNG image. ' +
                'Component types: stat-poster (big number + trend), comparison (side-by-side A vs B), ' +
                'process-flow (numbered steps), kpi-dashboard (metric cards grid), ' +
                'status-board (test results table with pass/fail/skip). Theme-aware.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Component type: stat-poster, comparison, process-flow, kpi-dashboard, status-board' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string with component-specific data. stat-poster: { value, label, trend, icon }. comparison: { left: {title, metrics}, right: {title, metrics} }. process-flow: { steps: [{title, description}] }. kpi-dashboard: { title, metrics: [{label, value, status}] }. status-board: { title, items: [{name, status, detail}] }.' },
                    outputName: { type: 'string', description: 'Base filename without extension (optional)' },
                },
                required: ['type', 'data'],
            },
            handler: async ({ type, theme, data, outputName }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { renderInfographic, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'shared', 'infographic-components.js'));
                    const result = await renderInfographic({
                        type, theme: theme || 'modern-blue', outputName, data: parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Infographic generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 31: generate_html_report
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_html_report', {
            description:
                'Generates a self-contained interactive HTML report. Features: dark mode toggle, ' +
                'sidebar navigation, live search with highlighting, collapsible sections, print CSS, ' +
                'Chart.js charts, and Mermaid diagrams. 18 section types: heading, paragraph, bullets, ' +
                'numbered-list, table, code-block, callout, page-break, two-column, cover, pull-quote, ' +
                'sidebar, metric-strip, info-card-grid, diagram, chart, infographic, image. ' +
                'Returns the file path to the generated .html.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Report title' },
                    author: { type: 'string', description: 'Author name' },
                    theme: { type: 'string', description: 'Theme name: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    darkMode: { type: 'boolean', description: 'Start in dark mode (default: false)' },
                    collapsible: { type: 'boolean', description: 'Make h1 sections collapsible (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as DOCX/PDF sections.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, theme, darkMode, collapsible, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_html_report', {
                            phase: 'document', message: `Generating HTML report (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateHtmlReport } = require(path.join(__dirname, '..', 'scripts', 'html-report-generator.js'));
                    const result = await generateHtmlReport({ title, author, theme, darkMode, collapsible, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `HTML report generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 32: generate_infographic_poster
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('generate_infographic_poster', {
            description:
                'Generates a full-page infographic poster as a high-resolution PNG image (retina 2×). ' +
                'Uses headless Chromium to render beautiful poster templates. ' +
                '5 templates: executive-summary (metrics + highlights + conclusion), ' +
                'data-story (2-column card grid with icons), comparison (side-by-side table), ' +
                'process-flow (numbered steps with connecting lines), timeline (alternating events). ' +
                'Output is 3840px wide (retina). Different from generate_infographic which renders components.',
            parameters: {
                type: 'object',
                properties: {
                    template: { type: 'string', description: 'Template: executive-summary, data-story, comparison, process-flow, timeline' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal (default: modern-blue)' },
                    data: { type: 'string', description: 'JSON string with template-specific data. executive-summary: { title, subtitle, metrics: [{label, value}], highlights: [str], conclusion }. data-story: { title, cards: [{icon, title, value, description}] }. comparison: { title, headers: [str], rows: [[str]] }. process-flow: { title, steps: [{title, description}] }. timeline: { title, events: [{date, title, description}] }.' },
                    width: { type: 'number', description: 'Canvas width in pixels (default: 1920, rendered at 2× = 3840px output)' },
                    outputPath: { type: 'string', description: 'Custom output path (auto-generated if omitted)' },
                },
                required: ['template', 'data'],
            },
            handler: async ({ template, theme, data, width, outputPath }) => {
                try {
                    let parsedData;
                    try { parsedData = JSON.parse(data); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid data JSON: ${e.message}` });
                    }
                    const { generateInfographic, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'infographic-generator.js'));
                    const result = await generateInfographic({
                        template, theme: theme || 'modern-blue', width: width || 1920, outputPath, data: parsedData,
                    });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Infographic poster generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 35: generate_video
    // Available to: docgenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie'].includes(agentName)) {
        tools.push(defineTool('generate_video', {
            description:
                'EXPERIMENTAL: Generates a WebM video from document sections. Each section becomes a ' +
                'full-screen 1920×1080 animated slide with CSS transitions. Uses Playwright video recording. ' +
                'Transitions: fade, slide-left, slide-up, zoom, none. ' +
                'Optionally exports a PNG storyboard of individual slides. ' +
                'Supports same section types as PPTX/DOCX (title, bullets, table, metric-strip, quote, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Video title (used for filename)' },
                    theme: { type: 'string', description: 'Theme: modern-blue, dark-professional, corporate-green, warm-minimal' },
                    transition: { type: 'string', description: 'Transition type: fade, slide-left, slide-up, zoom, none (default: fade)' },
                    durationPerSlide: { type: 'number', description: 'Seconds per slide (default: 4)' },
                    storyboard: { type: 'boolean', description: 'Also export individual slide PNGs (default: false)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as PPTX/DOCX.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, theme, transition, durationPerSlide, storyboard, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_video', {
                            phase: 'document', message: `Generating video (${parsedSections.length} slides, ${transition || 'fade'} transition)...`, step: 1,
                        });
                    }
                    const { generateVideo, cleanupBrowser } = require(path.join(__dirname, '..', 'scripts', 'video-generator.js'));
                    const result = await generateVideo({ title, theme, transition, durationPerSlide, storyboard, sections: parsedSections });
                    await cleanupBrowser();
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Video generation failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 34: get_design_score
    // Available to: docgenie, buggenie
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie'].includes(agentName)) {
        tools.push(defineTool('get_design_score', {
            description:
                'Scores a document\'s design quality 0-100 based on 7 criteria: color contrast (WCAG), ' +
                'text density, visual variety, typography hierarchy, brand compliance, layout balance, ' +
                'and section count. Returns a letter grade (A+ to F), detailed breakdown per category, ' +
                'and actionable recommendations. Use BEFORE finalizing a document to catch quality issues.',
            parameters: {
                type: 'object',
                properties: {
                    theme: { type: 'string', description: 'Theme name used for the document' },
                    format: { type: 'string', description: 'Output format: pptx, docx, pdf, html, markdown' },
                    title: { type: 'string', description: 'Document title' },
                    author: { type: 'string', description: 'Author name' },
                    sections: { type: 'string', description: 'JSON array string of sections/slides that will be or have been generated' },
                },
                required: ['sections'],
            },
            handler: async ({ theme, format, title, author, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    const { scoreDesignQuality } = require(path.join(__dirname, '..', 'scripts', 'shared', 'design-quality-scorer.js'));
                    const result = scoreDesignQuality({ sections: parsedSections, theme, format, title, author });
                    return JSON.stringify({ success: true, ...result });
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Design scoring failed: ${error.message}` });
                }
            },
        }));
    }

    // ───────────────────────────────────────────────────────────────────
    // TOOL 33: generate_markdown
    // Available to: docgenie, buggenie, scriptgenerator
    // ───────────────────────────────────────────────────────────────────
    if (['docgenie', 'buggenie', 'scriptgenerator'].includes(agentName)) {
        tools.push(defineTool('generate_markdown', {
            description:
                'Generates a styled GitHub-flavored Markdown (.md) file. Features: YAML front matter, ' +
                'auto-generated Table of Contents, GFM tables, Mermaid diagram blocks, ' +
                'admonitions ([!NOTE], [!TIP], [!WARNING], [!CAUTION]), shields.io badges, ' +
                'collapsible details sections. 16 section types: heading, paragraph, bullets, ' +
                'numbered-list, table, code-block, callout, page-break, two-column, cover, pull-quote, ' +
                'sidebar, metric-strip, info-card-grid, diagram, badge. Returns the file path to the generated .md.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Document title (used in front matter and heading)' },
                    author: { type: 'string', description: 'Author name (front matter)' },
                    tags: { type: 'string', description: 'Comma-separated tags for YAML front matter (e.g. "qa,testing,report")' },
                    includeFrontMatter: { type: 'boolean', description: 'Include YAML front matter header (default: true)' },
                    includeTableOfContents: { type: 'boolean', description: 'Auto-generate Table of Contents (default: true)' },
                    sections: { type: 'string', description: 'JSON array string of section objects. Same format as DOCX/PDF sections.' },
                },
                required: ['title', 'sections'],
            },
            handler: async ({ title, author, tags, includeFrontMatter, includeTableOfContents, sections }) => {
                try {
                    let parsedSections;
                    try { parsedSections = JSON.parse(sections); } catch (e) {
                        return JSON.stringify({ success: false, error: `Invalid sections JSON: ${e.message}` });
                    }
                    const parsedTags = tags ? tags.split(',').map(t => t.trim()) : undefined;
                    if (deps?.chatManager?.broadcastToolProgress) {
                        deps.chatManager.broadcastToolProgress('generate_markdown', {
                            phase: 'document', message: `Generating Markdown (${parsedSections.length} sections)...`, step: 1,
                        });
                    }
                    const { generateMarkdown } = require(path.join(__dirname, '..', 'scripts', 'markdown-generator.js'));
                    const result = await generateMarkdown({ title, author, tags: parsedTags, includeFrontMatter, includeTableOfContents, sections: parsedSections });
                    return JSON.stringify(result);
                } catch (error) {
                    return JSON.stringify({ success: false, error: `Markdown generation failed: ${error.message}` });
                }
            },
        }));
    }

    return tools;
}

module.exports = {
    createCustomTools,
    getToolCache,
    formatJiraTicket,
    collectSessionEvidence,
    attachEvidenceToJira,
    addCommentWithMediaToJira,
    computeSparseTicketScore,
    buildSparseKbQueries,
    enrichSparseTicketWithKnowledgeBase,
};
