'use client';

import { useState, useRef, useEffect } from 'react';
import { getFallbackAgentCatalog, getAgentConfig, normalizeAgentCatalogItem } from '@/lib/agent-options';
import { SparkleIcon, TPMIcon, DocumentIcon, CodeIcon, BugIcon, TaskIcon, FileIcon } from '@/components/Icons';

/* ── Icon mapping per agent (references Icons.js components) ─────────────── */
const ICON_MAP = {
    sparkle: SparkleIcon,
    tpm: TPMIcon,
    document: DocumentIcon,
    docgenie: DocumentIcon,
    code: CodeIcon,
    bug: BugIcon,
    task: TaskIcon,
    file: FileIcon,
};

function AgentIcon({ icon, className = 'w-4 h-4' }) {
    const Component = ICON_MAP[icon] || ICON_MAP.sparkle;
    return <Component className={className} />;
}

/**
 * Agent Selector — pill-group style, placed in the chat header.
 * When user selects a different agent, the parent creates a new session.
 */
export default function AgentSelect({ value, onChange, disabled = false, className = '', agents = null, includeCustom = false }) {
    const [tooltipAgent, setTooltipAgent] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const containerRef = useRef(null);

    const normalizedAgents = (Array.isArray(agents) && agents.length > 0 ? agents : getFallbackAgentCatalog())
        .map(normalizeAgentCatalogItem);
    // Custom agents get their own launcher — keep the built-in pill row uncluttered.
    const availableAgents = includeCustom
        ? normalizedAgents
        : normalizedAgents.filter((agent) => !agent.isCustom);
    const activeAgent = getAgentConfig(value, normalizedAgents);
    const activeIsCustom = activeAgent?.isCustom === true;

    const handleSelect = (agentId) => {
        if (disabled) return;
        if (agentId === value) return;
        onChange(agentId);
    };

    const handleMouseEnter = (e, agent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setTooltipAgent(agent);
        setTooltipPos({
            x: rect.left + rect.width / 2,
            y: rect.bottom + 8,
        });
    };

    return (
        <div ref={containerRef} className={`relative flex min-w-0 items-center ${className}`}>
            <div className={`flex w-full max-w-full items-center gap-0.5 rounded-xl border bg-surface-50/80 p-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:overflow-visible 2xl:flex-nowrap 2xl:overflow-x-auto ${disabled ? 'opacity-60 pointer-events-none' : ''} border-surface-200/60`}>
                {availableAgents.map((agent) => {
                    const isActive = agent.id === activeAgent.id;
                    return (
                        <button
                            key={agent.id}
                            type="button"
                            onClick={() => handleSelect(agent.id)}
                            onMouseEnter={(e) => handleMouseEnter(e, agent)}
                            onMouseLeave={() => setTooltipAgent(null)}
                            className={`
                                relative flex shrink-0 items-center gap-1.5 px-2 py-1.5 rounded-[10px] text-[10.5px] font-semibold sm:px-2.5 sm:text-[11px] lg:flex-[0_0_auto]
                                transition-all duration-150 cursor-pointer select-none whitespace-nowrap
                                ${isActive
                                    ? `${agent.activeClass} shadow-sm`
                                    : `text-surface-500 hover:text-surface-700 hover:bg-surface-100`
                                }
                            `}
                            title={agent.description}
                        >
                            <AgentIcon icon={agent.icon} className="w-3.5 h-3.5" />
                            <span>{agent.label}</span>
                        </button>
                    );
                })}
                {/* Show the active custom agent as a highlighted chip so users always know what's running,
                    even though custom agents live in a separate launcher. */}
                {!includeCustom && activeIsCustom && (
                    <div
                        className={`relative flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[10.5px] font-semibold sm:text-[11px] ${activeAgent.activeClass || 'bg-violet-600 text-white'} shadow-sm ring-1 ring-white/30`}
                        title={`Custom agent from ${activeAgent.workspaceName || 'Studio workspace'}`}
                    >
                        <AgentIcon icon={activeAgent.icon || 'sparkle'} className="w-3.5 h-3.5" />
                        <span className="truncate max-w-[8rem]">{activeAgent.label}</span>
                        <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide">Custom</span>
                    </div>
                )}
            </div>

            {/* Floating tooltip */}
            {tooltipAgent && (
                <div
                    className="fixed z-50 px-3 py-2 rounded-lg bg-surface-900 text-white text-[11px] shadow-lg max-w-[200px] pointer-events-none"
                    style={{
                        left: tooltipPos.x,
                        top: tooltipPos.y,
                        transform: 'translateX(-50%)',
                    }}
                >
                    <div className="font-semibold mb-0.5">{tooltipAgent.label}</div>
                    <div className="text-surface-300 leading-snug">{tooltipAgent.description}</div>
                </div>
            )}
        </div>
    );
}

/**
 * Compact agent badge — shows in session lists and headers.
 */
export function AgentBadge({ agentMode, agent = null, size = 'sm' }) {
    const resolvedAgent = agent ? normalizeAgentCatalogItem(agent) : getAgentConfig(agentMode);

    const sizeClasses = size === 'xs'
        ? 'text-[9px] px-1.5 py-0.5 gap-0.5'
        : 'text-[10px] px-2 py-0.5 gap-1';

    return (
        <span className={`inline-flex items-center rounded-full font-semibold ${sizeClasses} ${resolvedAgent.badgeBg} ${resolvedAgent.badgeText}`}>
            <AgentIcon icon={resolvedAgent.icon} className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
            {resolvedAgent.shortLabel}
        </span>
    );
}
