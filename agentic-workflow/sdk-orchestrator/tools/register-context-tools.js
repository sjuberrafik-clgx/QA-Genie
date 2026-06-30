/**
 * Context tools: shared context, artifact registry, question answering
 * Extracted from custom-tools.js createCustomTools()
 */

/**
 * Register tools for this category.
 * @param {Array} tools - The tools array to push into
 * @param {Function} defineTool - SDK defineTool function
 * @param {string} agentName - Agent role
 * @param {Object} deps - Dependencies
 */
function register(tools, defineTool, agentName, deps) {
    const { learningStore, config, contextStore, groundingStore } = deps;
    const toolCache = require('./tool-cache').getToolCache();

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

}

module.exports = { register };
