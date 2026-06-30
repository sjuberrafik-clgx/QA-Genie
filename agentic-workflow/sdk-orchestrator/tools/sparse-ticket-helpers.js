/**
 * Sparse ticket scoring and knowledge base query builders.
 * Extracted from custom-tools.js
 */

const { normalizeJiraText, normalizeWhitespace } = require('./evidence-helpers');
const { countStructuredClauses } = require('./jira-comment-helpers');

function computeSparseTicketScore(ticket = {}) {
    const summary = normalizeJiraText(ticket.summary);
    const description = normalizeJiraText(ticket.description);
    const acceptanceCriteria = normalizeJiraText(ticket.acceptanceCriteria);
    const labels = Array.isArray(ticket.labels) ? ticket.labels.filter(Boolean) : [];
    const components = Array.isArray(ticket.components) ? ticket.components.filter(Boolean) : [];
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    const commentText = comments.map(comment => normalizeJiraText(comment?.body)).filter(Boolean).join('\n');
    const commentStructuredClauses = countStructuredClauses(commentText);

    const reasons = [];
    let score = 0;

    const complexityPatterns = [
        /integration/i,
        /workflow/i,
        /filter/i,
        /search/i,
        /auth/i,
        /roomvo/i,
        /widget/i,
        /mls/i,
        /lead management/i,
        /consumer funnel/i,
        /pricing|monthly cost|emc/i,
    ];
    const contextText = [summary, description, acceptanceCriteria, commentText, labels.join(' '), components.join(' ')].join(' ');
    const complexitySignalCount = complexityPatterns.filter(pattern => pattern.test(contextText)).length;
    const structuredClauses = countStructuredClauses(acceptanceCriteria);

    if (!summary) {
        score += 20;
        reasons.push('Ticket summary is missing.');
    } else if (summary.length < 18) {
        score += 8;
        reasons.push('Ticket summary is very short.');
    }

    if (!description) {
        score += 30;
        reasons.push('Description is missing.');
    } else if (description.length < 160) {
        score += 15;
        reasons.push('Description is too short to explain the user flow clearly.');
    }

    if (!acceptanceCriteria) {
        score += 35;
        reasons.push('Acceptance criteria are missing.');
    } else {
        if (acceptanceCriteria.length < 120) {
            score += 15;
            reasons.push('Acceptance criteria are very brief.');
        }
        if (structuredClauses < 2) {
            score += 10;
            reasons.push('Acceptance criteria are not structured into distinct checks or scenarios.');
        }
    }

    if (labels.length === 0) {
        score += 5;
        reasons.push('No labels are present to help infer feature context.');
    }

    if (components.length === 0) {
        score += 5;
        reasons.push('No components are present to help infer feature ownership.');
    }

    if (complexitySignalCount >= 2 && (description.length + acceptanceCriteria.length) < 320) {
        score += 15;
        reasons.push('Ticket mentions a feature with non-trivial complexity but provides limited detail.');
    }

    if (commentText.length >= 140) {
        score = Math.max(0, score - 12);
    }

    if (commentStructuredClauses >= 2) {
        score = Math.max(0, score - 8);
    }

    const finalScore = Math.min(100, score);
    const threshold = 45;

    return {
        score: finalScore,
        threshold,
        isSparse: finalScore >= threshold,
        reasons,
        metrics: {
            summaryLength: summary.length,
            descriptionLength: description.length,
            acceptanceCriteriaLength: acceptanceCriteria.length,
            commentLength: commentText.length,
            commentCount: comments.length,
            commentStructuredClauses,
            structuredClauses,
            labelCount: labels.length,
            componentCount: components.length,
            complexitySignalCount,
        },
    };
}

function buildSparseKbQueries(ticket = {}) {
    const summary = normalizeJiraText(ticket.summary);
    const labels = Array.isArray(ticket.labels) ? ticket.labels.filter(Boolean) : [];
    const components = Array.isArray(ticket.components) ? ticket.components.filter(Boolean) : [];
    const acceptanceCriteria = normalizeJiraText(ticket.acceptanceCriteria);

    const supportTerms = [...labels, ...components]
        .map(term => normalizeJiraText(term))
        .filter(term => term.length > 2)
        .slice(0, 4);

    const firstAcLine = acceptanceCriteria.split(/\n+/).map(line => line.trim()).find(Boolean) || '';
    const queries = [
        [summary, supportTerms.join(' '), 'acceptance criteria requirements'].filter(Boolean).join(' '),
        [summary, supportTerms.join(' '), 'user story business rules'].filter(Boolean).join(' '),
        [summary, firstAcLine, 'workflow specification'].filter(Boolean).join(' '),
    ];

    return [...new Set(queries.map(q => normalizeWhitespace(q)).filter(q => q.length > 0))].slice(0, 3);
}

async function enrichSparseTicketWithKnowledgeBase(ticket, options = {}) {
    const sparseAssessment = computeSparseTicketScore(ticket);
    const groundingStore = options.groundingStore;

    const enrichment = {
        forcedByLogic: sparseAssessment.isSparse,
        sparseAssessment,
        queries: [],
        results: [],
        matches: [],
        topPage: null,
        error: null,
    };

    if (!sparseAssessment.isSparse || !groundingStore) {
        if (sparseAssessment.isSparse && !groundingStore) {
            enrichment.error = 'Grounding store unavailable for KB enrichment.';
        }
        return enrichment;
    }

    const queries = buildSparseKbQueries(ticket);
    enrichment.queries = queries;

    try {
        const aggregated = new Map();

        for (const query of queries) {
            const result = await groundingStore.queryKnowledgeBase(query, {
                agentName: options.agentName || 'testgenie',
                maxResults: 3,
                skipIntentCheck: true,
            });

            for (const item of (result.results || [])) {
                const key = item.id || item.url || `${query}:${item.title}`;
                if (!aggregated.has(key)) {
                    aggregated.set(key, {
                        id: item.id || null,
                        title: item.title,
                        url: item.url,
                        space: item.space,
                        lastModified: item.lastModified,
                        excerpt: normalizeWhitespace(item.excerpt || item.content || '').slice(0, 500),
                    });
                }
            }

            enrichment.results.push({
                query,
                resultCount: result.results?.length || 0,
                fromCache: !!result.fromCache,
            });

            if (aggregated.size >= 5) break;
        }

        const aggregatedResults = [...aggregated.values()].slice(0, 5);
        enrichment.matches = aggregatedResults;

        if (aggregatedResults.length > 0 && groundingStore._kbConnector && aggregatedResults[0].id) {
            try {
                const page = await groundingStore._kbConnector.getPage(aggregatedResults[0].id);
                if (page) {
                    enrichment.topPage = {
                        id: page.id,
                        title: page.title,
                        url: page.url,
                        space: page.space,
                        contentSnippet: normalizeWhitespace(page.content || page.excerpt || '').slice(0, 1200),
                    };
                }
            } catch (pageError) {
                enrichment.error = `KB page fetch failed: ${pageError.message}`;
            }
        }
    } catch (error) {
        enrichment.error = error.message;
    }

    return enrichment;
}

// ─── TTL Cache for Tool Results ─────────────────────────────────────────────

module.exports = {
    computeSparseTicketScore,
    buildSparseKbQueries,
    enrichSparseTicketWithKnowledgeBase,
};
