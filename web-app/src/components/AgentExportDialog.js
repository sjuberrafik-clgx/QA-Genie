'use client';

import { useCallback, useState } from 'react';
import apiClient from '@/lib/api-client';

// ───────────────────────────────────────────────────────────────
// Agent Export Dialog — Multi-format export with copy/download
// ───────────────────────────────────────────────────────────────

const FORMATS = [
    { value: 'json', label: 'JSON', description: 'Standard JSON config', icon: '{ }' },
    { value: 'yaml', label: 'YAML', description: 'YAML config file', icon: '---' },
    { value: 'agent-md', label: '.agent.md', description: 'VS Code agent format', icon: 'MD' },
    { value: 'typescript', label: 'TypeScript', description: '21st.dev SDK format', icon: 'TS' },
];

export default function AgentExportDialog({ workspaceId, agentId, agentName, onClose }) {
    const [selectedFormat, setSelectedFormat] = useState('json');
    const [exported, setExported] = useState(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleExport = useCallback(async (format) => {
        try {
            setSelectedFormat(format);
            setLoading(true);
            setCopied(false);
            const result = await apiClient.exportStudioAgent(workspaceId, agentId, format);
            setExported(result);
        } catch (err) {
            setExported({ content: `Error: ${err.message}`, filename: 'error.txt' });
        } finally {
            setLoading(false);
        }
    }, [workspaceId, agentId]);

    const handleCopy = useCallback(() => {
        if (!exported?.content) return;
        navigator.clipboard.writeText(exported.content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [exported]);

    const handleDownload = useCallback(() => {
        if (!exported?.content) return;
        const blob = new Blob([exported.content], { type: exported.mimeType || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exported.filename || 'agent-export.txt';
        a.click();
        URL.revokeObjectURL(url);
    }, [exported]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="w-full max-w-2xl rounded-2xl border border-surface-200 bg-white shadow-xl" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4">
                    <div>
                        <h3 className="text-[15px] font-bold text-surface-900">Export Agent</h3>
                        <p className="text-[12px] text-surface-500">{agentName || agentId}</p>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100">
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                    </button>
                </div>

                {/* Format Selector */}
                <div className="flex gap-2 border-b border-surface-100 px-6 py-3">
                    {FORMATS.map(fmt => (
                        <button
                            key={fmt.value}
                            onClick={() => handleExport(fmt.value)}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${selectedFormat === fmt.value ? 'border-blue-300 bg-blue-50' : 'border-surface-200 bg-white hover:border-surface-300'}`}
                        >
                            <span className="text-[11px] font-mono font-bold text-surface-500">{fmt.icon}</span>
                            <div>
                                <div className="text-[12px] font-semibold text-surface-800">{fmt.label}</div>
                                <div className="text-[10px] text-surface-400">{fmt.description}</div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Content Preview */}
                <div className="px-6 py-4">
                    {loading ? (
                        <div className="flex h-48 items-center justify-center text-[13px] text-surface-400">Exporting...</div>
                    ) : exported ? (
                        <div className="relative">
                            <pre className="max-h-72 overflow-auto rounded-xl border border-surface-200 bg-surface-50 p-4 font-mono text-[11px] leading-5 text-surface-700">
                                {exported.content}
                            </pre>
                            <div className="absolute right-3 top-3 flex gap-1.5">
                                <button
                                    onClick={handleCopy}
                                    className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-surface-600 shadow-sm hover:bg-surface-50"
                                >
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                                <button
                                    onClick={handleDownload}
                                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-blue-700"
                                >
                                    Download
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex h-48 items-center justify-center text-[13px] text-surface-400">
                            Select a format above to preview the export
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end border-t border-surface-200 px-6 py-3">
                    <button onClick={onClose} className="rounded-xl border border-surface-200 px-4 py-2 text-[12px] font-semibold text-surface-600 hover:bg-surface-50">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
