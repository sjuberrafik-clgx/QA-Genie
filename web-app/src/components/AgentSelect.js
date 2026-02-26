'use client';

import { useState, useRef, useEffect } from 'react';
import { AGENT_MODES, getAgentConfig } from '@/lib/agent-options';
import { SparkleIcon, DocumentIcon, CodeIcon, BugIcon, TaskIcon } from '@/components/Icons';

/* ── Icon mapping per agent (references Icons.js components) ─────────────── */
const ICON_MAP = {
    sparkle: SparkleIcon,
    document: DocumentIcon,
    code: CodeIcon,
    bug: BugIcon,
    task: TaskIcon,
};

function AgentIcon({ icon, className = 'w-4 h-4' }) {
    const Component = ICON_MAP[icon] || ICON_MAP.sparkle;
    return <Component className={className} />;
}

/**
 * Agent Selector — pill-group style, placed in the chat header.
 * When user selects a different agent, the parent creates a new session.
 */
export default function AgentSelect({ value, onChange, disabled = false, className = '' }) {
    const [tooltipAgent, setTooltipAgent] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const containerRef = useRef(null);

    const activeAgent = getAgentConfig(value);

    const handleSelect = (agentValue) => {
        if (disabled) return;
        if (agentValue === value) return; // same agent — do nothing
        onChange(agentValue);
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
        <div ref={containerRef} className={`relative flex items-center ${className}`}>
            <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border bg-surface-50/80 ${disabled ? 'opacity-60 pointer-events-none' : ''} border-surface-200/60`}>
                {AGENT_MODES.map((agent) => {
                    const isActive = agent.value === value;
                    return (
                        <button
                            key={agent.value ?? 'default'}
                            type="button"
                            onClick={() => handleSelect(agent.value)}
                            onMouseEnter={(e) => handleMouseEnter(e, agent)}
                            onMouseLeave={() => setTooltipAgent(null)}
                            className={`
                                relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[11px] font-semibold
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
export function AgentBadge({ agentMode, size = 'sm' }) {
    const agent = getAgentConfig(agentMode);
    if (agent.value === null) return null; // No badge for default mode

    const sizeClasses = size === 'xs'
        ? 'text-[9px] px-1.5 py-0.5 gap-0.5'
        : 'text-[10px] px-2 py-0.5 gap-1';

    return (
        <span className={`inline-flex items-center rounded-full font-semibold ${sizeClasses} ${agent.badgeBg} ${agent.badgeText}`}>
            <AgentIcon icon={agent.icon} className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
            {agent.shortLabel}
        </span>
    );
}
