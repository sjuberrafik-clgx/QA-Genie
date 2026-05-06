'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';

// ───────────────────────────────────────────────────────────────
// Agent Analytics Dashboard
// ───────────────────────────────────────────────────────────────

export default function AgentAnalyticsDashboard({ onClose }) {
    const [summary, setSummary] = useState(null);
    const [selectedAgent, setSelectedAgent] = useState(null);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const res = await apiClient.getStudioAnalytics();
                setSummary(res);
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    useEffect(() => {
        if (!selectedAgent) { setDetail(null); return; }
        async function load() {
            try {
                const res = await apiClient.getStudioAgentAnalytics(selectedAgent);
                setDetail(res);
            } catch {
                setDetail(null);
            }
        }
        load();
    }, [selectedAgent]);

    if (loading) {
        return <div className="flex h-full items-center justify-center text-[13px] text-surface-400">Loading analytics...</div>;
    }

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-surface-200 bg-white px-6 py-4">
                <div>
                    <h2 className="text-lg font-bold text-surface-900">Agent Analytics</h2>
                    <p className="text-[12px] text-surface-500">
                        {summary?.totalAgents || 0} agents tracked | {summary?.totalInvocations || 0} total invocations
                    </p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="rounded-xl border border-surface-200 px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50">
                        Close
                    </button>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Agent List */}
                <div className="w-80 border-r border-surface-200 overflow-y-auto p-4">
                    {(summary?.agents || []).length === 0 ? (
                        <div className="py-12 text-center text-[12px] text-surface-400">No analytics recorded yet. Agent usage data will appear here after agents are used in chat.</div>
                    ) : (
                        <div className="space-y-2">
                            {(summary?.agents || []).map(agent => (
                                <button
                                    key={agent.agentId}
                                    onClick={() => setSelectedAgent(agent.agentId)}
                                    className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedAgent === agent.agentId ? 'border-blue-300 bg-blue-50' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[13px] font-semibold text-surface-800">{agent.agentName}</span>
                                        <span className="text-[10px] font-bold text-surface-400">{agent.totalInvocations}x</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 text-[10px]">
                                        <span className={agent.successRate >= 80 ? 'text-emerald-600' : agent.successRate >= 50 ? 'text-amber-600' : 'text-red-600'}>
                                            {agent.successRate}% success
                                        </span>
                                        <span className="text-surface-400">{agent.avgResponseTimeMs}ms avg</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail Panel */}
                <div className="flex-1 overflow-y-auto p-6">
                    {!detail ? (
                        <div className="flex h-full items-center justify-center text-[13px] text-surface-400">
                            Select an agent to view detailed analytics
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <h3 className="text-[16px] font-bold text-surface-900">{detail.agentName}</h3>

                            {/* Metrics Grid */}
                            <div className="grid grid-cols-4 gap-3">
                                <MetricCard label="Invocations" value={detail.totalInvocations} />
                                <MetricCard label="Success Rate" value={`${detail.successRate}%`} color={detail.successRate >= 80 ? 'emerald' : detail.successRate >= 50 ? 'amber' : 'red'} />
                                <MetricCard label="Avg Response" value={`${detail.avgResponseTimeMs}ms`} />
                                <MetricCard label="Total Tokens" value={formatNumber(detail.totalTokens)} />
                            </div>

                            {/* Token Breakdown */}
                            <div className="rounded-xl border border-surface-200 bg-white p-4">
                                <h4 className="mb-3 text-[13px] font-bold text-surface-800">Token Usage</h4>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <div className="text-[10px] font-medium text-surface-400">Input</div>
                                        <div className="text-[16px] font-bold text-surface-800">{formatNumber(detail.totalInputTokens)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-medium text-surface-400">Output</div>
                                        <div className="text-[16px] font-bold text-surface-800">{formatNumber(detail.totalOutputTokens)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-medium text-surface-400">Total</div>
                                        <div className="text-[16px] font-bold text-blue-700">{formatNumber(detail.totalTokens)}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Top Tools */}
                            {detail.topTools?.length > 0 && (
                                <div className="rounded-xl border border-surface-200 bg-white p-4">
                                    <h4 className="mb-3 text-[13px] font-bold text-surface-800">Top Tool Calls</h4>
                                    <div className="space-y-1.5">
                                        {detail.topTools.slice(0, 10).map(t => {
                                            const maxCount = detail.topTools[0]?.count || 1;
                                            const pct = Math.round((t.count / maxCount) * 100);
                                            return (
                                                <div key={t.tool} className="flex items-center gap-3">
                                                    <span className="w-40 truncate text-[11px] font-mono text-surface-600">{t.tool}</span>
                                                    <div className="flex-1">
                                                        <div className="h-2 rounded-full bg-surface-100">
                                                            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                                                        </div>
                                                    </div>
                                                    <span className="w-8 text-right text-[10px] font-bold text-surface-500">{t.count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Recent Sessions */}
                            {detail.recentSessions?.length > 0 && (
                                <div className="rounded-xl border border-surface-200 bg-white p-4">
                                    <h4 className="mb-3 text-[13px] font-bold text-surface-800">Recent Sessions</h4>
                                    <div className="space-y-1">
                                        {detail.recentSessions.map((s, i) => (
                                            <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[11px] hover:bg-surface-50">
                                                <div className={`h-2 w-2 rounded-full ${s.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                <span className="font-mono text-surface-500">{s.sessionId?.slice(0, 8) || 'N/A'}</span>
                                                <span className="text-surface-400">{s.durationMs ? `${s.durationMs}ms` : '-'}</span>
                                                <span className="ml-auto text-surface-400">{new Date(s.timestamp).toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Recent Errors */}
                            {detail.recentErrors?.length > 0 && (
                                <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
                                    <h4 className="mb-3 text-[13px] font-bold text-red-800">Recent Errors</h4>
                                    <div className="space-y-1">
                                        {detail.recentErrors.map((e, i) => (
                                            <div key={i} className="rounded-lg bg-white px-3 py-2 text-[11px] text-red-700">
                                                {e.message}
                                                <span className="ml-2 text-[9px] text-red-400">{new Date(e.timestamp).toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function MetricCard({ label, value, color = 'blue' }) {
    const colorClasses = {
        blue: 'text-blue-700',
        emerald: 'text-emerald-700',
        amber: 'text-amber-700',
        red: 'text-red-700',
    };
    return (
        <div className="rounded-xl border border-surface-200 bg-white p-3 text-center">
            <div className={`text-[18px] font-bold ${colorClasses[color] || colorClasses.blue}`}>{value}</div>
            <div className="mt-0.5 text-[10px] font-medium text-surface-400">{label}</div>
        </div>
    );
}

function formatNumber(n) {
    if (!n) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
}
