'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';

// ───────────────────────────────────────────────────────────────
// MCP Designer — Visual MCP server management and connection testing
// ───────────────────────────────────────────────────────────────

const STATUS_STYLES = {
    ok: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Connected' },
    error: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Error' },
    timeout: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Timeout' },
    unknown: { bg: 'bg-surface-50', text: 'text-surface-500', dot: 'bg-surface-400', label: 'Not Tested' },
};

export default function McpDesigner({ onAttach, onClose }) {
    const [servers, setServers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [toolProfiles, setToolProfiles] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [selected, setSelected] = useState(null);
    const [testResults, setTestResults] = useState({});
    const [testing, setTesting] = useState(null);
    const [loading, setLoading] = useState(true);

    // Custom connection form
    const [showCustom, setShowCustom] = useState(false);
    const [customForm, setCustomForm] = useState({ name: '', url: '', type: 'url', description: '' });

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const res = await apiClient.listMcpRegistry({ category: selectedCategory });
                setServers(res.items || []);
                if (res.categories) setCategories(res.categories);
                if (res.toolProfiles) setToolProfiles(res.toolProfiles);
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [selectedCategory]);

    const testConnection = useCallback(async (server) => {
        try {
            setTesting(server.id);
            const result = await apiClient.testMcpConnection({ serverId: server.id });
            setTestResults(prev => ({ ...prev, [server.id]: result }));
        } catch (err) {
            setTestResults(prev => ({ ...prev, [server.id]: { status: 'error', error: err.message } }));
        } finally {
            setTesting(null);
        }
    }, []);

    const testCustomConnection = useCallback(async () => {
        if (!customForm.url) return;
        try {
            setTesting('custom');
            const result = await apiClient.testMcpConnection({
                connection: { type: customForm.type, url: customForm.url },
            });
            setTestResults(prev => ({ ...prev, custom: result }));
        } catch (err) {
            setTestResults(prev => ({ ...prev, custom: { status: 'error', error: err.message } }));
        } finally {
            setTesting(null);
        }
    }, [customForm]);

    const filteredServers = selectedCategory
        ? servers.filter(s => s.category === selectedCategory)
        : servers;

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-surface-200 bg-white px-6 py-4">
                <div>
                    <h2 className="text-lg font-bold text-surface-900">MCP Server Designer</h2>
                    <p className="text-[12px] text-surface-500">{servers.length} servers in registry</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCustom(!showCustom)}
                        className="rounded-xl border border-surface-200 px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50"
                    >
                        {showCustom ? 'Hide Custom' : '+ Custom Server'}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="rounded-xl border border-surface-200 px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50">
                            Close
                        </button>
                    )}
                </div>
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-100 bg-surface-50/50 px-6 py-3">
                <button
                    onClick={() => setSelectedCategory(null)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${!selectedCategory ? 'bg-surface-900 text-white' : 'bg-white text-surface-600 hover:bg-surface-100'}`}
                >
                    All
                </button>
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${selectedCategory === cat.id ? 'bg-surface-900 text-white' : 'bg-white text-surface-600 hover:bg-surface-100'}`}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Custom Connection Form */}
            {showCustom && (
                <div className="border-b border-surface-200 bg-surface-50/80 px-6 py-4">
                    <h4 className="mb-3 text-[13px] font-bold text-surface-800">Add Custom MCP Server</h4>
                    <div className="grid grid-cols-3 gap-3">
                        <input
                            type="text"
                            placeholder="Server name"
                            value={customForm.name}
                            onChange={e => setCustomForm(p => ({ ...p, name: e.target.value }))}
                            className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] placeholder:text-surface-400 focus:border-blue-300 focus:outline-none"
                        />
                        <input
                            type="text"
                            placeholder="URL (https://...)"
                            value={customForm.url}
                            onChange={e => setCustomForm(p => ({ ...p, url: e.target.value }))}
                            className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] placeholder:text-surface-400 focus:border-blue-300 focus:outline-none"
                        />
                        <div className="flex gap-2">
                            <select
                                value={customForm.type}
                                onChange={e => setCustomForm(p => ({ ...p, type: e.target.value }))}
                                className="flex-1 rounded-xl border border-surface-200 bg-white px-3 py-2 text-[12px] focus:border-blue-300 focus:outline-none"
                            >
                                <option value="url">URL</option>
                                <option value="local">Local Command</option>
                            </select>
                            <button
                                onClick={testCustomConnection}
                                disabled={testing === 'custom' || !customForm.url}
                                className="rounded-xl bg-surface-900 px-3 py-2 text-[11px] font-semibold text-white hover:bg-surface-800 disabled:opacity-50"
                            >
                                {testing === 'custom' ? 'Testing...' : 'Test'}
                            </button>
                        </div>
                    </div>
                    {testResults.custom && (
                        <div className={`mt-2 rounded-lg px-3 py-2 text-[11px] ${STATUS_STYLES[testResults.custom.status]?.bg || 'bg-surface-50'} ${STATUS_STYLES[testResults.custom.status]?.text || 'text-surface-600'}`}>
                            {testResults.custom.status === 'ok' ? 'Connection successful' : `Error: ${testResults.custom.error}`}
                            {testResults.custom.latencyMs && ` (${testResults.custom.latencyMs}ms)`}
                        </div>
                    )}
                </div>
            )}

            {/* Server List */}
            <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="py-16 text-center text-[13px] text-surface-400">Loading MCP registry...</div>
                    ) : (
                        <div className="space-y-3">
                            {filteredServers.map(server => {
                                const testResult = testResults[server.id];
                                const statusStyle = STATUS_STYLES[testResult?.status] || STATUS_STYLES.unknown;
                                const isTesting = testing === server.id;
                                const isSelected = selected?.id === server.id;

                                return (
                                    <div
                                        key={server.id}
                                        onClick={() => setSelected(server)}
                                        className={`cursor-pointer rounded-2xl border p-4 transition-all ${isSelected ? 'border-blue-300 bg-blue-50/50 shadow-md' : 'border-surface-200 bg-white hover:border-surface-300 hover:shadow-sm'}`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-[14px] font-bold text-surface-900">{server.name}</h4>
                                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${server.source === 'builtin' ? 'bg-blue-100 text-blue-700' : 'bg-surface-100 text-surface-500'}`}>
                                                        {server.source}
                                                    </span>
                                                    <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[9px] font-semibold text-surface-500">
                                                        {server.category}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-[12px] leading-4 text-surface-500">{server.description}</p>
                                            </div>

                                            <div className="ml-4 flex items-center gap-2">
                                                {/* Status Indicator */}
                                                <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                                                    <div className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                                                    {statusStyle.label}
                                                </div>

                                                {/* Test Button */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); testConnection(server); }}
                                                    disabled={isTesting}
                                                    className="rounded-lg border border-surface-200 px-2.5 py-1 text-[10px] font-semibold text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                                                >
                                                    {isTesting ? 'Testing...' : 'Test'}
                                                </button>

                                                {/* Attach Button */}
                                                {onAttach && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onAttach(server); }}
                                                        className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-blue-700"
                                                    >
                                                        Attach
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Capabilities */}
                                        {server.capabilities?.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {server.capabilities.map(cap => (
                                                    <span key={cap} className="rounded bg-surface-100 px-1.5 py-0.5 text-[9px] font-medium text-surface-500">{cap}</span>
                                                ))}
                                            </div>
                                        )}

                                        {/* Test Result Details */}
                                        {testResult?.error && (
                                            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">
                                                {testResult.error}
                                            </div>
                                        )}

                                        {/* Setup Hint */}
                                        {server.setupHint && !server.isConfigured && (
                                            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                                                Setup: {server.setupHint}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Detail Panel */}
                {selected && (
                    <div className="w-72 border-l border-surface-200 bg-white p-5 overflow-y-auto">
                        <h3 className="text-[15px] font-bold text-surface-900">{selected.name}</h3>
                        <p className="mt-2 text-[12px] leading-4 text-surface-600">{selected.description}</p>

                        <div className="mt-4 space-y-2">
                            <InfoRow label="Category" value={selected.category} />
                            <InfoRow label="Source" value={selected.source} />
                            <InfoRow label="Tools" value={String(selected.toolCount || '?')} />
                            <InfoRow label="Connection" value={selected.connection?.type || 'unknown'} />
                            <InfoRow label="Configured" value={selected.isConfigured ? 'Yes' : 'No'} />
                        </div>

                        {selected.capabilities?.length > 0 && (
                            <div className="mt-4">
                                <div className="mb-1.5 text-[11px] font-semibold text-surface-500">Capabilities</div>
                                <div className="flex flex-wrap gap-1">
                                    {selected.capabilities.map(cap => (
                                        <span key={cap} className="rounded bg-surface-100 px-2 py-0.5 text-[10px] text-surface-600">{cap}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selected.connection?.envVars?.length > 0 && (
                            <div className="mt-4">
                                <div className="mb-1.5 text-[11px] font-semibold text-surface-500">Required Env Vars</div>
                                {selected.connection.envVars.map(v => (
                                    <div key={v} className="rounded bg-surface-50 px-2 py-1 text-[10px] font-mono text-surface-600">{v}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Tool Profiles Footer */}
            {toolProfiles.length > 0 && (
                <div className="border-t border-surface-200 bg-surface-50/50 px-6 py-3">
                    <div className="mb-1.5 text-[11px] font-semibold text-surface-500">Tool Profile Presets</div>
                    <div className="flex flex-wrap gap-2">
                        {toolProfiles.map(p => (
                            <div key={p.id} className="rounded-lg border border-surface-200 bg-white px-3 py-1.5">
                                <div className="text-[11px] font-semibold text-surface-700">{p.name}</div>
                                <div className="text-[10px] text-surface-500">{p.description}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function InfoRow({ label, value }) {
    return (
        <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium text-surface-400">{label}</span>
            <span className="text-[11px] font-semibold text-surface-700">{value}</span>
        </div>
    );
}
