/**
 * PPTX slide validation and Jira label intent classification.
 * Extracted from custom-tools.js
 */
const {
    isNonEmptyString,
    getLatestUserMessageText,
    classifyJiraTimeTrackingIntent,
} = require('./general-helpers');
const { buildJiraBrowseUrl } = require('./jira-api-helpers');

const PPTX_SUPPORTED_SLIDE_TYPES = new Set([
    'title', 'content', 'bullets', 'two-column', 'table', 'chart', 'image', 'quote',
    'section-break', 'comparison', 'summary', 'timeline', 'process-flow',
    'stats-dashboard', 'icon-grid', 'pyramid', 'matrix-quadrant', 'agenda',
    'team-profiles', 'before-after', 'funnel', 'roadmap', 'swot', 'hero-image',
    'closing', 'diagram', 'data-story', 'infographic',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectStructuredTextValues(value, output = []) {
    if (isNonEmptyString(value)) {
        output.push(value.trim());
        return output;
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectStructuredTextValues(item, output));
        return output;
    }

    if (isPlainObject(value)) {
        ['heading', 'title', 'subtitle', 'label', 'name', 'text', 'description', 'content', 'value', 'note']
            .forEach(key => {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    collectStructuredTextValues(value[key], output);
                }
            });

        if (Array.isArray(value.items)) {
            collectStructuredTextValues(value.items, output);
        }
    }

    return output;
}

function hasStructuredTextValue(value) {
    return collectStructuredTextValues(value, []).length > 0;
}

function slideHasAnyContent(slide, keys) {
    return keys.some(key => hasStructuredTextValue(slide[key]));
}

function getSlideTableShape(slide) {
    const tableData = isPlainObject(slide.tableData) ? slide.tableData : {};
    const rows = Array.isArray(tableData.rows) && tableData.rows.length
        ? tableData.rows
        : (Array.isArray(slide.rows) ? slide.rows : []);

    let headers = Array.isArray(tableData.headers) && tableData.headers.length
        ? tableData.headers
        : (Array.isArray(slide.headers) ? slide.headers : []);

    if (!headers.length && rows.length && isPlainObject(rows[0])) {
        headers = Object.keys(rows[0]);
    }

    return { headers, rows };
}

function validatePptxSlides(slides) {
    if (!Array.isArray(slides)) {
        return {
            errors: ['The slides parameter must parse to a JSON array of slide objects.'],
            warnings: [],
        };
    }

    const errors = [];
    const warnings = [];
    const supportedTypes = [...PPTX_SUPPORTED_SLIDE_TYPES].join(', ');

    slides.forEach((slide, index) => {
        const slideNumber = index + 1;

        if (!isPlainObject(slide)) {
            errors.push(`Slide ${slideNumber} must be an object.`);
            return;
        }

        const type = isNonEmptyString(slide.type) ? slide.type.trim() : '';
        if (!type) {
            errors.push(`Slide ${slideNumber} is missing a type.`);
            return;
        }

        if (!PPTX_SUPPORTED_SLIDE_TYPES.has(type)) {
            errors.push(`Slide ${slideNumber} uses unknown type "${type}". Supported types: ${supportedTypes}.`);
            return;
        }

        switch (type) {
            case 'content':
            case 'quote':
                if (!slideHasAnyContent(slide, ['content', 'text'])) {
                    errors.push(`Slide ${slideNumber} (${type}) requires text content.`);
                }
                break;

            case 'bullets':
                if (!Array.isArray(slide.bullets) || slide.bullets.length === 0) {
                    errors.push(`Slide ${slideNumber} (bullets) requires a non-empty bullets array.`);
                }
                break;

            case 'two-column': {
                const leftHasContent = slideHasAnyContent(slide, ['leftContent', 'left', 'leftItems', 'leftBullets', 'leftPoints']);
                const rightHasContent = slideHasAnyContent(slide, ['rightContent', 'right', 'rightItems', 'rightBullets', 'rightPoints']);
                if (!leftHasContent || !rightHasContent) {
                    errors.push(`Slide ${slideNumber} (two-column) requires content on both sides. Use leftContent/rightContent or leftItems/rightItems.`);
                }
                break;
            }

            case 'comparison': {
                const leftHasContent = slideHasAnyContent(slide, ['leftContent', 'left', 'leftItems', 'leftBullets', 'leftPoints']);
                const rightHasContent = slideHasAnyContent(slide, ['rightContent', 'right', 'rightItems', 'rightBullets', 'rightPoints']);
                if (!leftHasContent || !rightHasContent) {
                    errors.push(`Slide ${slideNumber} (comparison) requires content on both sides. Use leftTitle/rightTitle with leftItems/rightItems or leftContent/rightContent.`);
                }
                break;
            }

            case 'summary': {
                const hasMetrics = Array.isArray(slide.metrics) && slide.metrics.length > 0;
                const hasHighlights = slideHasAnyContent(slide, ['highlights', 'summaryPoints', 'bullets']);
                if (!hasMetrics && !hasHighlights) {
                    errors.push(`Slide ${slideNumber} (summary) requires metrics and/or highlights.`);
                }
                if (Array.isArray(slide.metrics) && slide.metrics.length > 4) {
                    warnings.push(`Slide ${slideNumber} (summary) has ${slide.metrics.length} metrics. The current renderer emphasizes the first 4.`);
                }
                break;
            }

            case 'table': {
                const { headers, rows } = getSlideTableShape(slide);
                if (!headers.length || !rows.length) {
                    errors.push(`Slide ${slideNumber} (table) requires headers and rows. Use tableData.headers/tableData.rows or top-level headers/rows.`);
                }
                if (headers.length > 6) {
                    warnings.push(`Slide ${slideNumber} (table) has ${headers.length} columns. The slide may become hard to read without splitting the table.`);
                }
                break;
            }

            case 'chart': {
                const chartData = isPlainObject(slide.chartData) ? slide.chartData : null;
                if (!chartData) {
                    errors.push(`Slide ${slideNumber} (chart) requires chartData with labels and datasets.`);
                    break;
                }

                const hasLabels = Array.isArray(chartData.labels) && chartData.labels.length > 0;
                const hasDatasets = Array.isArray(chartData.datasets)
                    && chartData.datasets.some(dataset => Array.isArray(dataset?.data) && dataset.data.length > 0);

                if (!hasLabels || !hasDatasets) {
                    errors.push(`Slide ${slideNumber} (chart) requires non-empty chartData.labels and chartData.datasets[].data.`);
                }
                break;
            }

            case 'image':
            case 'hero-image':
                if (!slideHasAnyContent(slide, ['imagePath'])) {
                    errors.push(`Slide ${slideNumber} (${type}) requires imagePath.`);
                }
                break;

            case 'diagram':
                if (!slideHasAnyContent(slide, ['mermaidCode', 'diagramImage', 'imagePath'])) {
                    errors.push(`Slide ${slideNumber} (diagram) requires mermaidCode, diagramImage, or imagePath.`);
                }
                break;

            case 'stats-dashboard':
                if (!Array.isArray(slide.metrics) || slide.metrics.length === 0) {
                    errors.push(`Slide ${slideNumber} (stats-dashboard) requires a non-empty metrics array.`);
                }
                break;

            case 'process-flow':
                if (!Array.isArray(slide.steps) || slide.steps.length === 0) {
                    errors.push(`Slide ${slideNumber} (process-flow) requires a non-empty steps array.`);
                }
                break;

            case 'funnel':
                if (!Array.isArray(slide.stages) || slide.stages.length === 0) {
                    errors.push(`Slide ${slideNumber} (funnel) requires a non-empty stages array.`);
                }
                break;

            case 'roadmap':
                if (!Array.isArray(slide.phases) || slide.phases.length === 0) {
                    errors.push(`Slide ${slideNumber} (roadmap) requires a non-empty phases array.`);
                }
                break;

            default:
                break;
        }
    });

    // ── Deck-level composition check: nudge toward rich, varied slide types ──
    // Non-blocking warnings only. The generate_pptx handler surfaces these to the
    // agent so it can regenerate a more visual deck instead of a wall of text.
    const typedSlides = slides
        .filter(isPlainObject)
        .map(s => (isNonEmptyString(s.type) ? s.type.trim() : ''))
        .filter(Boolean);

    if (typedSlides.length >= 4) {
        const PLAIN_SLIDE_TYPES = new Set(['content', 'bullets']);
        const distinctTypes = new Set(typedSlides);
        const plainCount = typedSlides.filter(type => PLAIN_SLIDE_TYPES.has(type)).length;
        const plainShare = plainCount / typedSlides.length;

        if (distinctTypes.size < 4) {
            warnings.push(
                `Deck uses only ${distinctTypes.size} distinct slide type(s). Aim for at least 4-5 ` +
                '(e.g., stats-dashboard, process-flow, timeline, comparison, roadmap, data-story) so the deck is visually rich.',
            );
        }

        if (plainShare > 0.5) {
            warnings.push(
                `Deck is ${Math.round(plainShare * 100)}% plain content/bullets slides. Convert most of them into ` +
                'semantic visual slides (stats-dashboard, process-flow, comparison, timeline, data-story) and keep plain text slides to about 40% or less.',
            );
        }

        let currentRun = 0;
        let longestPlainRun = 0;
        typedSlides.forEach(type => {
            currentRun = PLAIN_SLIDE_TYPES.has(type) ? currentRun + 1 : 0;
            if (currentRun > longestPlainRun) longestPlainRun = currentRun;
        });
        if (longestPlainRun > 2) {
            warnings.push(
                `Deck has ${longestPlainRun} plain content/bullets slides in a row. Break up long text runs with a ` +
                'visual or process slide so the deck does not read as a wall of text.',
            );
        }
    }

    return { errors, warnings };
}

function getJiraTimeTrackingIntentContext(deps) {
    const latestUserMessage = getLatestUserMessageText(deps);
    if (!latestUserMessage) {
        return { intent: 'unknown', signals: [], latestUserMessage: '' };
    }

    const classification = classifyJiraTimeTrackingIntent(latestUserMessage);
    return {
        ...classification,
        latestUserMessage,
    };
}

function classifyJiraLabelIntent(messageText) {
    if (!isNonEmptyString(messageText)) {
        return { intent: 'unknown', signals: [] };
    }

    const normalized = messageText.toLowerCase().replace(/\s+/g, ' ').trim();
    const signalMatchers = [
        {
            intent: 'disallow',
            label: 'without labels phrase',
            pattern: /\bwithout labels?\b/,
        },
        {
            intent: 'disallow',
            label: 'no labels phrase',
            pattern: /\bno labels?\b/,
        },
        {
            intent: 'disallow',
            label: 'omit labels phrase',
            pattern: /\b(?:omit|skip|exclude) labels?\b/,
        },
        {
            intent: 'disallow',
            label: 'do not add labels phrase',
            pattern: /\bdo not\s+(?:add|include|use|set|apply)\s+labels?\b/,
        },
        {
            intent: 'disallow',
            label: 'do not label phrase',
            pattern: /\bdo not\s+label\b/,
        },
        {
            intent: 'disallow',
            label: 'dont add labels phrase',
            pattern: /\bdon'?t\s+(?:add|include|use|set|apply)\s+labels?\b/,
        },
        {
            intent: 'disallow',
            label: 'dont label phrase',
            pattern: /\bdon'?t\s+label\b/,
        },
        {
            intent: 'allow',
            label: 'label action phrase',
            pattern: /\b(?:add|include|use|set|apply)\s+labels?\b/,
        },
        {
            intent: 'allow',
            label: 'with labels phrase',
            pattern: /\bwith labels?\b/,
        },
        {
            intent: 'allow',
            label: 'label with phrase',
            pattern: /\blabel(?: the)?(?: jira)?(?: ticket| issue)?(?: it| this)?\s+with\b/,
        },
        {
            intent: 'allow',
            label: 'tag with phrase',
            pattern: /\btag(?: the)?(?: jira)?(?: ticket| issue)?(?: it| this)?\s+with\b/,
        },
        {
            intent: 'allow',
            label: 'labels field phrase',
            pattern: /\blabels?\s*[:=]\s*\S/,
        },
        {
            intent: 'allow',
            label: 'tags field phrase',
            pattern: /\btags?\s*[:=]\s*\S/,
        },
    ];

    const matchedSignals = signalMatchers
        .filter(signal => signal.pattern.test(normalized))
        .map(signal => ({ intent: signal.intent, label: signal.label }));

    if (matchedSignals.some(signal => signal.intent === 'disallow')) {
        return {
            intent: 'disallow',
            signals: matchedSignals.filter(signal => signal.intent === 'disallow'),
        };
    }

    if (matchedSignals.some(signal => signal.intent === 'allow')) {
        return {
            intent: 'allow',
            signals: matchedSignals.filter(signal => signal.intent === 'allow'),
        };
    }

    return { intent: 'unknown', signals: [] };
}

function buildJiraTimeIntentGuardResult({ mode, ticketId, jiraConfig, intentContext }) {
    const ticketUrl = ticketId && jiraConfig ? buildJiraBrowseUrl(jiraConfig, ticketId) : undefined;

    if (mode === 'estimate-from-worklog') {
        return {
            success: false,
            ticketId,
            ticketUrl,
            error: 'This request looks like a Jira worklog/time entry, not an estimate change.',
            hint: 'When the user says "Time Tracking", "add hours", or other generic time-entry phrases, use log_jira_work. Reserve update_jira_estimates for explicit originalEstimate or remainingEstimate changes.',
            suggestedTool: 'log_jira_work',
            detectedIntent: intentContext.intent,
            detectedSignals: intentContext.signals.map(signal => signal.label),
            sourceMessage: intentContext.latestUserMessage,
        };
    }

    if (mode === 'worklog-from-estimate') {
        return {
            success: false,
            ticketId,
            ticketUrl,
            error: 'This request looks like an estimate change, not a Jira worklog entry.',
            hint: 'Use update_jira_estimates only when the user explicitly asks to change originalEstimate or remainingEstimate. Use log_jira_work for generic hour entry or Time Tracking requests.',
            suggestedTool: 'update_jira_estimates',
            detectedIntent: intentContext.intent,
            detectedSignals: intentContext.signals.map(signal => signal.label),
            sourceMessage: intentContext.latestUserMessage,
        };
    }

    if (mode === 'mixed') {
        return {
            success: false,
            ticketId,
            ticketUrl,
            error: 'The current request mixes worklog language and estimate language.',
            hint: 'Ask whether the user wants to log work or update original/remaining estimates before changing Jira time tracking fields.',
            suggestedAction: 'clarify_time_tracking_intent',
            detectedIntent: intentContext.intent,
            detectedSignals: intentContext.signals.map(signal => signal.label),
            sourceMessage: intentContext.latestUserMessage,
        };
    }

    return null;
}


module.exports = {
    PPTX_SUPPORTED_SLIDE_TYPES,
    isPlainObject,
    collectStructuredTextValues,
    hasStructuredTextValue,
    slideHasAnyContent,
    getSlideTableShape,
    validatePptxSlides,
    getJiraTimeTrackingIntentContext,
    classifyJiraLabelIntent,
    buildJiraTimeIntentGuardResult,
};
