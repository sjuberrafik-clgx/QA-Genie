'use client';

import { memo } from 'react';

/**
 * CognitiveInsights — Real-time cognitive reasoning visibility.
 *
 * Displays the cognitive complexity tier, inference-time scaling parameters,
 * and OODA health check results during active pipeline runs. This gives
 * users visibility into HOW the system is thinking, not just WHAT it's doing.
 */

const TIER_CONFIG = {
    simple: {
        label: 'Simple',
        color: 'text-accent-600',
        bg: 'bg-accent-50',
        ring: 'ring-accent-200',
        icon: '⚡',
        description: 'Fast track — minimal resources, straightforward flow',
    },
    moderate: {
        label: 'Moderate',
        color: 'text-brand-600',
        bg: 'bg-brand-50',
        ring: 'ring-brand-200',
        icon: '🧠',
        description: 'Balanced — standard reasoning depth across all stages',
    },
    complex: {
        label: 'Complex',
        color: 'text-purple-600',
        bg: 'bg-purple-50',
        ring: 'ring-purple-200',
        icon: '🌳',
        description: 'Deep analysis — ToT multi-hypothesis, extended healing, supervisor active',
    },
};

function CognitiveInsights({ insights }) {
    if (!insights) return null;

    const tier = insights.tier || 'moderate';
    const tierConfig = TIER_CONFIG[tier] || TIER_CONFIG.moderate;
    const scaling = insights.scaling || {};
    const ooda = insights.ooda;

    return (
        <div className="glass-card rounded-2xl p-5 border-l-4 border-l-purple-400">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-base">
                    {tierConfig.icon}
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-surface-900">Cognitive Insights</h2>
                    <p className="text-[10px] text-surface-500 uppercase tracking-wider">Inference-Time Scaling</p>
                </div>
                {/* Tier Badge */}
                <span className={`ml-auto px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ring-1 ${tierConfig.bg} ${tierConfig.color} ${tierConfig.ring}`}>
                    {tierConfig.label}
                </span>
            </div>

            {/* Tier Description */}
            <p className="text-xs text-surface-600 mb-4">{tierConfig.description}</p>

            {/* Scaling Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <ScalingMetric
                    label="Healing Iterations"
                    value={scaling.healingMaxIterations ?? '—'}
                    subtext={tier === 'complex' ? 'risk-adjusted' : null}
                />
                <ScalingMetric
                    label="Exec Timeout"
                    value={scaling.executionTimeoutMs ? `${Math.round(scaling.executionTimeoutMs / 1000)}s` : '—'}
                />
                <ScalingMetric
                    label="BugGenie Depth"
                    value={scaling.bugGenieAnalysisDepth || '—'}
                    capitalize
                />
                <ScalingMetric
                    label="Supervisor"
                    value={scaling.supervisorReviewDepth || '—'}
                    capitalize
                />
            </div>

            {/* OODA Health (if available) */}
            {ooda && (
                <div className="flex items-center gap-3 pt-3 border-t border-surface-100">
                    <span className={`w-2 h-2 rounded-full ${ooda.score >= 70 ? 'bg-accent-500' : ooda.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="text-xs text-surface-600">
                        OODA Health: <span className="font-semibold">{ooda.score}/100</span>
                        <span className="text-surface-400 ml-1">({ooda.decision})</span>
                    </span>
                    {ooda.duration && (
                        <span className="text-[10px] text-surface-400 ml-auto">{ooda.duration}ms</span>
                    )}
                </div>
            )}
        </div>
    );
}

function ScalingMetric({ label, value, subtext, capitalize }) {
    return (
        <div className="bg-surface-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-sm font-bold text-surface-900 ${capitalize ? 'capitalize' : ''}`}>{value}</p>
            {subtext && <p className="text-[10px] text-surface-400 mt-0.5">{subtext}</p>}
        </div>
    );
}

export default memo(CognitiveInsights);
