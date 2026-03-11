/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTEXT ENGINE — Priority-Aware Context Packing & Compaction System
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the core context engineering principles from Anthropic's research:
 *   - Priority-aware packing: Allocates token budget to highest-signal components
 *   - Compaction: Summarizes stale context to reclaim attention budget
 *   - Tool result trimming: Clears or compresses old tool outputs
 *   - Prompt deduplication: Shared prompt layers with inheritance
 *   - Dynamic refresh: Mid-session context updates via tools
 *   - Structured note-taking: Agents persist discoveries outside context window
 *
 * Key insight: "Find the smallest possible set of high-signal tokens that
 * maximize the likelihood of some desired outcome." — Anthropic
 *
 * @module sdk-orchestrator/context-engine
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    enabled: true,
    maxContextChars: 120_000,

    // Priority-aware budget allocation (higher = more important, allocated first)
    priorities: {
        basePrompt: { priority: 100, budgetPercent: 35, compressible: false },
        ticketContext: { priority: 90, budgetPercent: 10, compressible: false },
        groundingContext: { priority: 85, budgetPercent: 15, compressible: true },
        frameworkInventory: { priority: 70, budgetPercent: 15, compressible: true },
        assertionConfig: { priority: 65, budgetPercent: 5, compressible: true },
        historicalFailures: { priority: 55, budgetPercent: 5, compressible: true },
        kbContext: { priority: 50, budgetPercent: 5, compressible: true },
        sharedContext: { priority: 45, budgetPercent: 10, compressible: true },
    },

    // Compaction settings
    compaction: {
        enabled: true,
        stageCompaction: true,          // Compact prior-stage entries into summaries
        toolResultClearing: true,       // Clear raw tool results (keep summary only)
        maxRawEntriesPerStage: 10,      // Keep only N most recent raw entries per stage
        compactionTriggerEntries: 30,   // Trigger compaction when entries exceed this
    },

    // Tool result trimming
    toolResultTrimming: {
        enabled: true,
        maxSnapshotElements: 50,        // Trim snapshot accessibility trees to N elements
        maxToolResultChars: 2000,       // Max chars per individual tool result in history
        clearCompletedToolResults: true, // Clear tool results from message history after processing
    },

    // Per-phase tool profiles for cognitive loop
    phaseToolProfiles: {
        'cognitive-analyst': { tools: [], maxTools: 0 },
        'cognitive-explorer-nav': {
            tools: [
                'navigate', 'navigate_back', 'reload', 'get_page_url', 'get_page_title',
                'snapshot', 'get_by_role', 'get_by_text', 'get_by_label', 'get_by_test_id',
                'get_by_alt_text', 'get_by_placeholder', 'get_by_title',
                'click', 'type', 'fill_form', 'select_option', 'check', 'uncheck',
                'hover', 'press_key', 'handle_dialog',
                'is_visible', 'is_enabled', 'is_checked', 'is_hidden',
                'get_text_content', 'get_attribute', 'get_input_value', 'get_inner_text',
                'wait_for', 'wait_for_element',
                'expect_url', 'expect_title', 'expect_element_text',
                'screenshot', 'tabs',
            ],
            maxTools: 35
        },
        'cognitive-explorer-interact': {
            tools: [
                'navigate', 'snapshot', 'click', 'type', 'fill_form', 'select_option',
                'check', 'uncheck', 'hover', 'press_key', 'handle_dialog',
                'is_visible', 'is_enabled', 'get_text_content', 'get_attribute',
                'wait_for', 'wait_for_element', 'screenshot',
            ],
            maxTools: 20
        },
        'cognitive-coder': { tools: [], maxTools: 0 },
        'cognitive-reviewer': { tools: [], maxTools: 0 },
        'cognitive-dryrun': {
            tools: [
                'navigate', 'snapshot', 'get_by_role', 'get_by_text', 'get_by_label',
                'get_by_test_id', 'is_visible', 'is_enabled', 'get_text_content',
                'get_attribute', 'get_page_url', 'wait_for_element', 'screenshot',
            ],
            maxTools: 15
        },
    },

    // Agent-specific context relevance filters
    agentContextFilters: {
        testgenie: ['ticketContext', 'groundingContext', 'kbContext', 'sharedContext'],
        scriptgenerator: ['ticketContext', 'groundingContext', 'frameworkInventory', 'historicalFailures', 'assertionConfig', 'sharedContext'],
        buggenie: ['ticketContext', 'groundingContext', 'videoContext', 'sharedContext'],
        codereviewer: ['frameworkInventory', 'groundingContext', 'assertionConfig'],
        taskgenie: ['ticketContext', 'sharedContext'],
    },
};


// ─── Context Engine ─────────────────────────────────────────────────────────

class ContextEngine {

    /**
     * @param {Object} config - Context engineering configuration (merged with defaults)
     */
    constructor(config = {}) {
        this.config = this._mergeConfig(DEFAULT_CONFIG, config);
        this._metrics = {
            totalPackCalls: 0,
            totalCompactions: 0,
            totalTokensSaved: 0,
            averageBudgetUtilization: 0,
            componentStats: {},
        };
        this._agentNotes = new Map();  // agentName → [notes]

        // CCM integration — lazy-loaded to avoid circular dependencies
        this._ccm = null;
        this._ccmConfig = config.cognitiveContextMesh || null;
    }

    /**
     * Get or initialize the Cognitive Context Mesh instance.
     * Lazy-loaded on first use. Returns null if CCM is disabled.
     * @returns {Object|null} CognitiveContextMesh instance
     */
    getCCM() {
        if (this._ccm) return this._ccm;
        if (!this._ccmConfig || !this._ccmConfig.enabled) return null;
        try {
            const { CognitiveContextMesh } = require('../ccm');
            this._ccm = new CognitiveContextMesh(this._ccmConfig);
            return this._ccm;
        } catch {
            return null;
        }
    }

    /**
     * Initialize CCM with source paths. Call once at pipeline startup.
     * @param {string[]} sourcePaths - Directories to compile
     * @returns {Promise<Object|null>} Init result or null if disabled
     */
    async initializeCCM(sourcePaths) {
        const ccm = this.getCCM();
        if (!ccm) return null;
        return ccm.initialize(sourcePaths);
    }

    /**
     * CCM-enhanced context packing. Uses DNA-compiled multi-resolution context
     * instead of raw framework scan. Falls back to standard packContext() if CCM
     * is not available or not initialized.
     *
     * @param {string} agentName - Agent role identifier
     * @param {Object} components - Same as packContext()
     * @param {Object} [options]
     * @param {string} [options.taskDescription] - Task description for CCM navigation
     * @returns {Object} PackResult with optional CCM metadata
     */
    packContextWithCCM(agentName, components, options = {}) {
        const ccm = this.getCCM();
        if (!ccm || !options.taskDescription) {
            return this.packContext(agentName, components, options);
        }

        try {
            // Get CCM-optimized framework inventory and grounding context
            const ccmFramework = ccm.generateFrameworkInventory(agentName, options.taskDescription);
            const ccmGrounding = ccm.generateGroundingContext(options.taskDescription);

            // Replace raw components with CCM-optimized versions where available
            const enhancedComponents = { ...components };
            if (ccmFramework) enhancedComponents.frameworkInventory = ccmFramework;
            if (ccmGrounding) enhancedComponents.groundingContext = ccmGrounding;

            // Pack with enhanced components
            const result = this.packContext(agentName, enhancedComponents, options);
            result.ccmEnhanced = true;
            result.ccmCoverage = ccm.getCoverageStats();
            return result;
        } catch {
            // Fallback to standard packing
            return this.packContext(agentName, components, options);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // P0: PRIORITY-AWARE CONTEXT PACKING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Packs context components into the budget using priority ordering.
     * Highest-priority components are allocated first; lower-priority components
     * are compressed or dropped if budget is insufficient.
     *
     * @param {string} agentName - Target agent role
     * @param {Object} components - Named context components
     * @param {string} components.basePrompt - Agent system prompt
     * @param {string} [components.ticketContext] - Jira ticket details
     * @param {string} [components.groundingContext] - Grounding RAG context
     * @param {string} [components.frameworkInventory] - Framework scan results
     * @param {string} [components.assertionConfig] - Assertion patterns
     * @param {string} [components.historicalFailures] - Past failure context
     * @param {string} [components.kbContext] - Knowledge base context
     * @param {string} [components.sharedContext] - SharedContextStore summary
     * @param {Object} [options] - Packing options
     * @returns {PackResult}
     */
    packContext(agentName, components, options = {}) {
        this._metrics.totalPackCalls++;
        const maxChars = options.maxChars || this.config.maxContextChars;
        const result = {
            assembledPrompt: '',
            totalChars: 0,
            budgetUsed: 0,
            included: [],
            compressed: [],
            dropped: [],
            metrics: {},
        };

        // Step 1: Filter to only components relevant to this agent
        const relevantKeys = this.config.agentContextFilters[agentName] || Object.keys(this.config.priorities);
        const allKeys = ['basePrompt', ...relevantKeys]; // basePrompt always included

        // Step 2: Sort components by priority (descending)
        const sortedComponents = allKeys
            .filter(key => components[key] && components[key].length > 0)
            .map(key => ({
                key,
                content: components[key],
                chars: components[key].length,
                ...this.config.priorities[key],
            }))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        // Step 3: Allocate budget top-down
        let remaining = maxChars;
        const sections = [];

        for (const comp of sortedComponents) {
            const budgetForThis = Math.floor(maxChars * (comp.budgetPercent || 10) / 100);

            if (comp.chars <= remaining) {
                // Fits entirely
                sections.push({ key: comp.key, content: comp.content });
                remaining -= comp.chars;
                result.included.push({ key: comp.key, chars: comp.chars, priority: comp.priority });
            } else if (remaining > 500 && comp.compressible) {
                // Compress to fit
                const compressed = this._compressComponent(comp.key, comp.content, remaining);
                if (compressed.length > 0) {
                    sections.push({ key: comp.key, content: compressed });
                    remaining -= compressed.length;
                    result.compressed.push({
                        key: comp.key,
                        originalChars: comp.chars,
                        compressedChars: compressed.length,
                        priority: comp.priority,
                    });
                }
            } else if (remaining > 200) {
                // Last resort: take what we can
                const truncated = comp.content.slice(0, remaining - 50) + '\n...(truncated due to context budget)';
                sections.push({ key: comp.key, content: truncated });
                remaining -= truncated.length;
                result.compressed.push({
                    key: comp.key,
                    originalChars: comp.chars,
                    compressedChars: truncated.length,
                    priority: comp.priority,
                });
            } else {
                // Drop entirely
                result.dropped.push({ key: comp.key, chars: comp.chars, priority: comp.priority });
            }
        }

        // Step 4: Assemble
        const assembled = [];
        for (const section of sections) {
            if (section.key === 'basePrompt') {
                assembled.push(section.content);
            } else {
                assembled.push(`\n\n<${section.key}>\n${section.content}\n</${section.key}>`);
            }
        }

        result.assembledPrompt = assembled.join('');
        result.totalChars = result.assembledPrompt.length;
        result.budgetUsed = ((result.totalChars / maxChars) * 100).toFixed(1);

        // Metrics
        result.metrics = {
            maxBudget: maxChars,
            used: result.totalChars,
            utilization: result.budgetUsed + '%',
            componentsIncluded: result.included.length,
            componentsCompressed: result.compressed.length,
            componentsDropped: result.dropped.length,
            charsSaved: sortedComponents.reduce((sum, c) => sum + c.chars, 0) - result.totalChars,
        };

        this._updateMetrics(result);
        return result;
    }

    /**
     * Compress a context component to fit within a character budget.
     * Uses component-specific compression strategies.
     */
    _compressComponent(key, content, maxChars) {
        switch (key) {
            case 'frameworkInventory':
                return this._compressFrameworkInventory(content, maxChars);
            case 'historicalFailures':
                return this._compressHistoricalFailures(content, maxChars);
            case 'groundingContext':
                return this._compressGroundingContext(content, maxChars);
            case 'sharedContext':
                return this._compressSharedContext(content, maxChars);
            case 'kbContext':
                return content.slice(0, maxChars - 20) + '\n...(truncated)';
            case 'assertionConfig':
                return this._compressAssertionConfig(content, maxChars);
            default:
                return content.slice(0, maxChars - 20) + '\n...(truncated)';
        }
    }

    /**
     * Compress framework inventory: keep paths and method signatures, drop locator strings
     */
    _compressFrameworkInventory(content, maxChars) {
        const lines = content.split('\n');
        const compressed = [];
        let currentSize = 0;

        for (const line of lines) {
            // Always keep file headers and class names
            if (line.includes('File:') || line.includes('Class:') || line.includes('###') ||
                line.includes('.js') || line.startsWith('#')) {
                if (currentSize + line.length + 1 < maxChars - 100) {
                    compressed.push(line);
                    currentSize += line.length + 1;
                }
            }
            // Keep method signatures but drop locator values
            else if (line.includes('method:') || line.includes('()') || line.includes('async ')) {
                if (currentSize + line.length + 1 < maxChars - 100) {
                    compressed.push(line);
                    currentSize += line.length + 1;
                }
            }
            // Skip locator strings, detailed descriptions
            else if (currentSize + line.length + 1 < maxChars - 200) {
                compressed.push(line);
                currentSize += line.length + 1;
            }
        }

        if (compressed.length < lines.length) {
            compressed.push(`\n(compressed: ${lines.length - compressed.length} lines omitted to fit context budget)`);
        }

        return compressed.join('\n');
    }

    /**
     * Compress historical failures: keep only the most recent and most relevant
     */
    _compressHistoricalFailures(content, maxChars) {
        const entries = content.split('\n---\n');
        if (entries.length <= 3) return content.slice(0, maxChars);

        // Keep first (oldest pattern) and last 3 (most recent)
        const kept = [
            entries[0],
            '...(older failures omitted)',
            ...entries.slice(-3),
        ];

        const result = kept.join('\n---\n');
        return result.length <= maxChars ? result : result.slice(0, maxChars - 20) + '\n...(truncated)';
    }

    /**
     * Compress grounding context: keep rules, terminology, feature map; trim code chunks
     */
    _compressGroundingContext(content, maxChars) {
        const lines = content.split('\n');
        const highPriority = [];
        const lowPriority = [];
        let inCodeSection = false;

        for (const line of lines) {
            if (line.includes('CRITICAL RULES:') || line.includes('TERMINOLOGY:') ||
                line.includes('FEATURE MAP:') || line.includes('MATCHED FEATURES:')) {
                inCodeSection = false;
                highPriority.push(line);
            } else if (line.includes('RELEVANT CODE CONTEXT:')) {
                inCodeSection = true;
                lowPriority.push(line);
            } else if (inCodeSection) {
                lowPriority.push(line);
            } else {
                highPriority.push(line);
            }
        }

        const highText = highPriority.join('\n');
        if (highText.length >= maxChars) {
            return highText.slice(0, maxChars - 20) + '\n...(truncated)';
        }

        const remainingBudget = maxChars - highText.length - 50;
        if (remainingBudget > 200 && lowPriority.length > 0) {
            const lowText = lowPriority.join('\n').slice(0, remainingBudget);
            return highText + '\n' + lowText + '\n(code context compressed)';
        }

        return highText;
    }

    /**
     * Compress shared context: keep decisions and constraints, compact notes
     */
    _compressSharedContext(content, maxChars) {
        const lines = content.split('\n');
        const sections = [];
        let currentSection = null;
        let currentLines = [];

        for (const line of lines) {
            if (line.startsWith('## ')) {
                if (currentSection) {
                    sections.push({ header: currentSection, lines: currentLines });
                }
                currentSection = line;
                currentLines = [];
            } else {
                currentLines.push(line);
            }
        }
        if (currentSection) {
            sections.push({ header: currentSection, lines: currentLines });
        }

        // Priority: Decisions > Constraints > Artifacts > Questions
        const priorityOrder = [
            'Previous Agent Decisions', 'Known Constraints',
            'Available Artifacts', 'Questions for You',
        ];

        const sorted = sections.sort((a, b) => {
            const aIdx = priorityOrder.findIndex(p => a.header.includes(p));
            const bIdx = priorityOrder.findIndex(p => b.header.includes(p));
            return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        });

        const result = [];
        let size = 0;
        for (const section of sorted) {
            const text = section.header + '\n' + section.lines.join('\n');
            if (size + text.length < maxChars - 50) {
                result.push(text);
                size += text.length;
            }
        }

        return result.join('\n');
    }

    /**
     * Compress assertion config: keep best practices and anti-patterns headlines only
     */
    _compressAssertionConfig(content, maxChars) {
        try {
            const config = JSON.parse(content);
            const summary = {
                activeFramework: config.activeFramework,
                bestPractices: (config.bestPractices || []).slice(0, 3).map(bp => bp.name || bp),
                antiPatterns: (config.antiPatterns || []).slice(0, 3).map(ap => ap.id || ap),
            };
            return JSON.stringify(summary, null, 2);
        } catch {
            return content.slice(0, maxChars);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // P2: SHARED CONTEXT COMPACTION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Compact SharedContextStore entries from completed stages into summaries.
     * Preserves decisions and artifacts but compresses verbose entries.
     *
     * @param {SharedContextStore} contextStore - The store to compact
     * @param {string} completedStage - Stage name that just completed
     * @returns {CompactionResult}
     */
    compactStageContext(contextStore, completedStage) {
        if (!this.config.compaction.enabled || !this.config.compaction.stageCompaction) {
            return { compacted: false, reason: 'disabled' };
        }

        const entries = contextStore.query({});
        if (entries.length < this.config.compaction.compactionTriggerEntries) {
            return { compacted: false, reason: 'below_threshold', entryCount: entries.length };
        }

        this._metrics.totalCompactions++;

        // Group entries by stage/agent
        const stageEntries = entries.filter(e =>
            e.agent !== completedStage &&
            e.timestamp < new Date().toISOString()
        );

        // Build compacted summaries per prior agent
        const agentGroups = {};
        for (const entry of stageEntries) {
            const agent = entry.agent || 'unknown';
            if (!agentGroups[agent]) agentGroups[agent] = [];
            agentGroups[agent].push(entry);
        }

        const summaries = [];
        for (const [agent, agentEntries] of Object.entries(agentGroups)) {
            const summary = this._buildAgentSummary(agent, agentEntries);
            summaries.push(summary);
        }

        // Store compacted summary as a single note
        const compactedText = summaries.join('\n\n');
        contextStore.addNote('context-engine',
            `[COMPACTED] Prior stage summaries:\n${compactedText}`,
            { type: 'compaction', stage: completedStage, originalEntries: stageEntries.length }
        );

        return {
            compacted: true,
            originalEntries: stageEntries.length,
            summaryChars: compactedText.length,
            estimatedTokensSaved: Math.floor((stageEntries.reduce((s, e) =>
                s + (e.content?.length || 0) + (e.reasoning?.length || 0), 0) - compactedText.length) / 4),
        };
    }

    /**
     * Build a compact summary for a single agent's entries
     */
    _buildAgentSummary(agent, entries) {
        const decisions = entries.filter(e => e.type === 'decision');
        const artifacts = entries.filter(e => e.type === 'artifact');
        const constraints = entries.filter(e => e.type === 'constraint');
        const notes = entries.filter(e => e.type === 'note' && !e.metadata?.type?.includes('compaction'));

        const parts = [`### ${agent}`];

        if (decisions.length > 0) {
            parts.push(`Decisions: ${decisions.map(d => d.content).join('; ')}`);
        }
        if (artifacts.length > 0) {
            parts.push(`Artifacts: ${artifacts.map(a => {
                const key = a.metadata?.key || 'unknown';
                const path = a.metadata?.path || a.content;
                return `${key}→${path}`;
            }).join(', ')}`);
        }
        if (constraints.length > 0) {
            parts.push(`Constraints: ${constraints.map(c => c.content).join('; ')}`);
        }
        if (notes.length > 3) {
            parts.push(`Notes (${notes.length}): ${notes.slice(-3).map(n => n.content.slice(0, 80)).join('; ')}`);
        } else if (notes.length > 0) {
            parts.push(`Notes: ${notes.map(n => n.content.slice(0, 100)).join('; ')}`);
        }

        return parts.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════
    // P3: TOOL RESULT TRIMMING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Trim a tool result to be context-efficient.
     * Used in enforcement hooks post-tool processing.
     *
     * @param {string} toolName - MCP tool name
     * @param {*} result - Raw tool result
     * @returns {*} Trimmed result
     */
    trimToolResult(toolName, result) {
        if (!this.config.toolResultTrimming.enabled) return result;

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

        // Snapshot trimming: keep only the most relevant elements
        if (toolName.includes('snapshot') || toolName.includes('take_snapshot')) {
            return this._trimSnapshot(result);
        }

        // Network request results: keep status + URL only
        if (toolName.includes('network_request')) {
            return this._trimNetworkResult(result);
        }

        // Console messages: keep errors only
        if (toolName.includes('console_message')) {
            return this._trimConsoleMessages(result);
        }

        // Generic size limit
        const maxChars = this.config.toolResultTrimming.maxToolResultChars;
        if (resultStr.length > maxChars) {
            if (typeof result === 'string') {
                return result.slice(0, maxChars) + `\n...(trimmed: ${resultStr.length - maxChars} chars removed)`;
            }
            return JSON.stringify(result, null, 2).slice(0, maxChars) + '\n...(trimmed)';
        }

        return result;
    }

    /**
     * Trim accessibility snapshot to keep only actionable elements
     */
    _trimSnapshot(result) {
        const maxElements = this.config.toolResultTrimming.maxSnapshotElements;

        if (typeof result === 'string') {
            const lines = result.split('\n');
            if (lines.length <= maxElements) return result;

            // Keep first N lines + summary
            const kept = lines.slice(0, maxElements);
            kept.push(`\n...(${lines.length - maxElements} more elements — use get_by_role/get_by_text for specific lookups)`);
            return kept.join('\n');
        }

        if (result && typeof result === 'object') {
            // If it's a structured snapshot with children array
            if (Array.isArray(result.children) && result.children.length > maxElements) {
                const trimmed = { ...result };
                trimmed.children = result.children.slice(0, maxElements);
                trimmed._trimmed = {
                    originalCount: result.children.length,
                    keptCount: maxElements,
                    message: 'Use semantic locators (get_by_role, get_by_text) for elements not shown',
                };
                return trimmed;
            }
        }

        return result;
    }

    /**
     * Trim network request results to essentials
     */
    _trimNetworkResult(result) {
        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch { return result; }
        }

        if (Array.isArray(result)) {
            return result.map(r => ({
                url: r.url,
                status: r.status,
                method: r.method,
                ...(r.error ? { error: r.error } : {}),
            }));
        }

        return result;
    }

    /**
     * Trim console messages: keep errors and warnings, drop info/debug
     */
    _trimConsoleMessages(result) {
        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch { return result; }
        }

        if (Array.isArray(result)) {
            return result.filter(m =>
                m.type === 'error' || m.type === 'warning' || m.level === 'error' || m.level === 'warn'
            );
        }

        return result;
    }

    // ═══════════════════════════════════════════════════════════════════
    // P4: PER-PHASE TOOL PROFILE PRUNING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Get the allowed tool set for a cognitive phase.
     * Returns null if no restrictions (full access).
     *
     * @param {string} phaseName - Cognitive phase name (e.g., 'cognitive-explorer-nav')
     * @returns {Object|null} Tool profile with allowed tools list
     */
    getPhaseToolProfile(phaseName) {
        return this.config.phaseToolProfiles[phaseName] || null;
    }

    /**
     * Filter MCP tools to only those allowed for a cognitive phase.
     * Returns the original list if no profile is defined.
     *
     * @param {string} phaseName - Cognitive phase name
     * @param {Array} availableTools - Full list of available MCP tools
     * @returns {Array} Filtered tools
     */
    filterToolsForPhase(phaseName, availableTools) {
        const profile = this.getPhaseToolProfile(phaseName);
        if (!profile || profile.tools.length === 0) return [];

        return availableTools.filter(tool => {
            const toolBase = (tool.name || tool)
                .replace(/^mcp_unified-autom_unified_/, '')
                .replace(/^unified_/, '');
            return profile.tools.includes(toolBase);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // P6: STRUCTURED AGENT NOTE-TAKING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Record an agent note that persists outside the context window.
     * Notes can be retrieved by the same or other agents in later sessions.
     *
     * @param {string} agentName - Agent writing the note
     * @param {string} category - Note category (discovery, pattern, warning, selector, fix)
     * @param {string} content - Note content
     * @param {Object} [metadata] - Additional metadata
     */
    recordAgentNote(agentName, category, content, metadata = {}) {
        if (!this._agentNotes.has(agentName)) {
            this._agentNotes.set(agentName, []);
        }

        const note = {
            id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            agent: agentName,
            category,
            content,
            metadata,
            timestamp: new Date().toISOString(),
        };

        this._agentNotes.get(agentName).push(note);

        // Keep only last 50 notes per agent
        const notes = this._agentNotes.get(agentName);
        if (notes.length > 50) {
            this._agentNotes.set(agentName, notes.slice(-50));
        }

        return note;
    }

    /**
     * Retrieve notes for context injection
     *
     * @param {Object} [filter] - Filter criteria
     * @param {string} [filter.agent] - Filter by agent
     * @param {string} [filter.category] - Filter by category
     * @param {number} [filter.limit] - Max notes to return
     * @returns {Array} Matching notes
     */
    getAgentNotes(filter = {}) {
        let allNotes = [];

        if (filter.agent) {
            allNotes = this._agentNotes.get(filter.agent) || [];
        } else {
            for (const notes of this._agentNotes.values()) {
                allNotes.push(...notes);
            }
        }

        if (filter.category) {
            allNotes = allNotes.filter(n => n.category === filter.category);
        }

        // Sort by timestamp descending (most recent first)
        allNotes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        if (filter.limit) {
            allNotes = allNotes.slice(0, filter.limit);
        }

        return allNotes;
    }

    /**
     * Build a notes context string for injection into agent prompts
     */
    buildNotesContext(agentName, maxChars = 2000) {
        const notes = this.getAgentNotes({ limit: 20 });
        if (notes.length === 0) return '';

        const sections = ['AGENT NOTES (from current run):'];
        let size = sections[0].length;

        for (const note of notes) {
            const line = `- [${note.category}] ${note.agent}: ${note.content}`;
            if (size + line.length + 1 > maxChars) break;
            sections.push(line);
            size += line.length + 1;
        }

        return sections.join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════
    // P5: DYNAMIC GROUNDING REFRESH
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Refresh grounding context mid-session.
     * Called when an agent discovers new features/pages that need grounding data.
     *
     * @param {Object} groundingStore - The grounding store instance
     * @param {string} agentName - Requesting agent
     * @param {Object} refreshRequest - What to refresh
     * @param {string} [refreshRequest.feature] - Feature name to query
     * @param {string} [refreshRequest.query] - Free-form search query
     * @param {string} [refreshRequest.ticketId] - Ticket for exploration freshness
     * @returns {string} Updated grounding context
     */
    refreshGroundingContext(groundingStore, agentName, refreshRequest) {
        if (!groundingStore) return '';

        try {
            return groundingStore.buildGroundingContext(agentName, {
                taskDescription: refreshRequest.query || refreshRequest.feature || '',
                ticketId: refreshRequest.ticketId || null,
                summary: false,
            });
        } catch (err) {
            return `(grounding refresh failed: ${err.message})`;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // METRICS & DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Get context engine performance metrics
     */
    getMetrics() {
        return {
            ...this._metrics,
            noteCount: Array.from(this._agentNotes.values()).reduce((sum, notes) => sum + notes.length, 0),
        };
    }

    /**
     * Reset metrics (for testing)
     */
    resetMetrics() {
        this._metrics = {
            totalPackCalls: 0,
            totalCompactions: 0,
            totalTokensSaved: 0,
            averageBudgetUtilization: 0,
            componentStats: {},
        };
    }

    _updateMetrics(packResult) {
        const saved = packResult.metrics.charsSaved || 0;
        this._metrics.totalTokensSaved += Math.floor(saved / 4); // ~4 chars/token

        const n = this._metrics.totalPackCalls;
        const util = parseFloat(packResult.budgetUsed);
        this._metrics.averageBudgetUtilization = (
            (this._metrics.averageBudgetUtilization * (n - 1) + util) / n
        ).toFixed(1);

        // Track per-component stats
        for (const item of [...packResult.included, ...packResult.compressed]) {
            const key = item.key;
            if (!this._metrics.componentStats[key]) {
                this._metrics.componentStats[key] = { included: 0, compressed: 0, dropped: 0, totalChars: 0 };
            }
            const stat = this._metrics.componentStats[key];
            if (packResult.compressed.find(c => c.key === key)) {
                stat.compressed++;
            } else {
                stat.included++;
            }
            stat.totalChars += item.compressedChars || item.chars || 0;
        }
        for (const item of packResult.dropped) {
            if (!this._metrics.componentStats[item.key]) {
                this._metrics.componentStats[item.key] = { included: 0, compressed: 0, dropped: 0, totalChars: 0 };
            }
            this._metrics.componentStats[item.key].dropped++;
        }
    }

    /**
     * Deep merge config objects
     */
    _mergeConfig(defaults, overrides) {
        const merged = { ...defaults };
        for (const [key, value] of Object.entries(overrides)) {
            if (value && typeof value === 'object' && !Array.isArray(value) && typeof defaults[key] === 'object') {
                merged[key] = this._mergeConfig(defaults[key], value);
            } else if (value !== undefined) {
                merged[key] = value;
            }
        }
        return merged;
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get the singleton ContextEngine instance.
 * @param {Object} [config] - Configuration overrides (only used on first call)
 *                             Falls back to workflow-config.json → sdk.contextEngineering if no config provided
 */
function getContextEngine(config) {
    if (!_instance) {
        let resolvedConfig = config;
        if (!resolvedConfig || Object.keys(resolvedConfig).length === 0) {
            // Try to auto-load from workflow-config.json
            try {
                const fs = require('fs');
                const path = require('path');
                const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
                if (fs.existsSync(configPath)) {
                    const wfConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                    resolvedConfig = wfConfig?.sdk?.contextEngineering || {};
                }
            } catch (_) {
                // Silently fall back to defaults
            }
        }
        _instance = new ContextEngine(resolvedConfig);
    }
    return _instance;
}

/**
 * Reset singleton (for testing)
 */
function resetContextEngine() {
    _instance = null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    ContextEngine,
    getContextEngine,
    resetContextEngine,
    DEFAULT_CONFIG,
};
