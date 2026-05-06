'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';

// ───────────────────────────────────────────────────────────────
// Template Gallery — Browsable catalog of agent templates
// ───────────────────────────────────────────────────────────────

const CATEGORY_STYLES = {
    'qa-automation': { bg: 'bg-blue-50', text: 'text-blue-700', accent: 'border-blue-200' },
    devops: { bg: 'bg-emerald-50', text: 'text-emerald-700', accent: 'border-emerald-200' },
    support: { bg: 'bg-amber-50', text: 'text-amber-700', accent: 'border-amber-200' },
    research: { bg: 'bg-violet-50', text: 'text-violet-700', accent: 'border-violet-200' },
    content: { bg: 'bg-indigo-50', text: 'text-indigo-700', accent: 'border-indigo-200' },
    custom: { bg: 'bg-slate-50', text: 'text-slate-700', accent: 'border-slate-200' },
};

export default function TemplateGallery({ onFork, onClose }) {
    const [templates, setTemplates] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const res = await apiClient.listStudioTemplates({
                    category: selectedCategory,
                    search: search || null,
                });
                setTemplates(res.items || []);
                if (res.categories) setCategories(res.categories);
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [selectedCategory, search]);

    const handleFork = useCallback(async (template) => {
        try {
            const forked = await apiClient.forkStudioTemplate(template.id);
            onFork?.(forked, template);
        } catch (err) {
            alert(`Fork failed: ${err.message}`);
        }
    }, [onFork]);

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-surface-200 bg-white px-6 py-4">
                <div>
                    <h2 className="text-lg font-bold text-surface-900">Template Gallery</h2>
                    <p className="text-[12px] text-surface-500">{templates.length} templates available</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="rounded-lg border border-surface-200 px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50">
                        Close
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-100 bg-surface-50/50 px-6 py-3">
                <button
                    onClick={() => setSelectedCategory(null)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${!selectedCategory ? 'bg-surface-900 text-white' : 'bg-white text-surface-600 hover:bg-surface-100'}`}
                >
                    All
                </button>
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${selectedCategory === cat.id ? 'bg-surface-900 text-white' : 'bg-white text-surface-600 hover:bg-surface-100'}`}
                    >
                        {cat.label}
                    </button>
                ))}
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="ml-auto w-48 rounded-xl border border-surface-200 bg-white px-3 py-1.5 text-[12px] placeholder:text-surface-400 focus:border-blue-300 focus:outline-none"
                />
            </div>

            {/* Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="py-16 text-center text-[13px] text-surface-400">Loading templates...</div>
                    ) : templates.length === 0 ? (
                        <div className="py-16 text-center text-[13px] text-surface-400">No templates match your search.</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {templates.map(t => {
                                const style = CATEGORY_STYLES[t.category] || CATEGORY_STYLES.custom;
                                const isSelected = selected?.id === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => setSelected(t)}
                                        className={`group rounded-2xl border p-4 text-left shadow-sm transition-all ${isSelected ? 'border-blue-400 bg-blue-50/50 ring-2 ring-blue-200' : 'border-surface-200 bg-white hover:border-surface-300 hover:shadow-md'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${style.bg} ${style.text}`}>{t.category}</span>
                                            <span className={`text-[10px] font-semibold ${t.source === 'builtin' ? 'text-violet-600' : 'text-surface-400'}`}>{t.source}</span>
                                        </div>
                                        <h4 className="mt-2 text-[14px] font-bold text-surface-900 group-hover:text-blue-700">{t.name}</h4>
                                        <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-surface-500">{t.description}</p>
                                        {t.tags?.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {t.tags.slice(0, 3).map(tag => (
                                                    <span key={tag} className="rounded bg-surface-100 px-1.5 py-0.5 text-[9px] font-medium text-surface-500">{tag}</span>
                                                ))}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Detail Panel */}
                {selected && (
                    <div className="w-80 border-l border-surface-200 bg-white p-6 overflow-y-auto">
                        <h3 className="text-[16px] font-bold text-surface-900">{selected.name}</h3>
                        <p className="mt-2 text-[13px] leading-5 text-surface-600">{selected.description}</p>

                        <div className="mt-4 space-y-3">
                            <DetailRow label="Category" value={selected.category} />
                            <DetailRow label="Source" value={selected.source} />
                            <DetailRow label="Tool Profile" value={selected.config?.toolProfile || 'full'} />
                            <DetailRow label="Model" value={selected.config?.model?.id || 'default'} />
                            <DetailRow label="Permission" value={selected.config?.permissionMode || 'default'} />
                            <DetailRow label="Max Turns" value={String(selected.config?.maxTurns || 50)} />
                        </div>

                        {selected.tags?.length > 0 && (
                            <div className="mt-4">
                                <div className="mb-1 text-[11px] font-semibold text-surface-500">Tags</div>
                                <div className="flex flex-wrap gap-1">
                                    {selected.tags.map(tag => (
                                        <span key={tag} className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-600">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selected.config?.mcpServers?.length > 0 && (
                            <div className="mt-4">
                                <div className="mb-1 text-[11px] font-semibold text-surface-500">MCP Servers</div>
                                {selected.config.mcpServers.map(s => (
                                    <div key={s.name} className="rounded-lg bg-surface-50 px-2 py-1 text-[11px] text-surface-600">{s.name}</div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={() => handleFork(selected)}
                            className="mt-6 w-full rounded-xl bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
                        >
                            Fork & Customize
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailRow({ label, value }) {
    return (
        <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-surface-400">{label}</span>
            <span className="text-[12px] font-semibold text-surface-700">{value}</span>
        </div>
    );
}
